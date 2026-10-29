#!/usr/bin/env node
/**
 * The weather desk: Kalshi's daily temperature brackets, traded by the
 * tail-premium strategy (src/tail-premium-policy.mjs) inside the limits of
 * content/config/weather-desk-policy.json.
 *
 *   cycle [--live]   one pass: read the account, halt if a halt rule trips,
 *                    price every open bracket near its date, cancel resting
 *                    sells that no longer fit, rest the new ones. Without
 *                    --live, or while unarmed, the plan is only recorded.
 *   status           cash, equity, positions, resting sells, recent fills,
 *                    settled results, and the arming record.
 *   arm <by>         arm the desk (the founder's act, named by actor).
 *   halt [reason]    unarm and withdraw every resting sell.
 *
 * The venue is the source of truth: each cycle starts from Kalshi's own
 * balance, positions and orders, never from the ledger. Every order rests
 * post-only with an expiry, so nothing stale outlives a stopped timer.
 * State and the append-only ledger live in machine state
 * (KALSHI_DESK_STATE_DIR, default ~/.local/state/561-group/settlements/
 * kalshi-services-section/weather-desk), never in the repository.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createKalshiClient } from '@red-cup-engineering/kalshi-services-section/client';
import { TEMPERATURE_MARKETS, priceTemperatureBracket, eventDate, temperatureSeries } from '@red-cup-engineering/forecasting/temperature-market-model';
import { latestStationGuidance } from '@red-cup-engineering/forecasting/nbm-station-guidance';
import { activeTemperatureHazards, observedExtremes } from '@red-cup-engineering/forecasting/station-observations';
import { planCycle, haltReason, inOpeningWindow, tailSide } from '../src/tail-premium-policy.mjs';

export const POLICY = JSON.parse(readFileSync(new URL('../content/config/weather-desk-policy.json', import.meta.url), 'utf8'));
export const stateDir = (env = process.env) => env.KALSHI_DESK_STATE_DIR ?? join(env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'kalshi-services-section', 'weather-desk');

const cents = (dollars) => Math.round(Number(dollars) * 100);
const usd = (c) => `$${(c / 100).toFixed(2)}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const eventOf = (ticker) => ticker.slice(0, ticker.lastIndexOf('-'));
const seriesOf = (ticker) => ticker.slice(0, ticker.indexOf('-'));
const localDate = (timeZone, at) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

function readArming(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'arming.json'), 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return { armed: false, armedAt: null, armedBy: null, haltedAt: null, haltReason: null };
    throw error;
  }
}
function writeArming(dir, arming) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'arming.json');
  writeFileSync(`${path}.tmp`, `${JSON.stringify(arming, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
function ledger(dir, entry) {
  mkdirSync(join(dir, 'ledger'), { recursive: true, mode: 0o700 });
  appendFileSync(join(dir, 'ledger', `${entry.at.slice(0, 10)}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

/** The account as the venue states it: cash, equity, NO positions, the desk's resting sells, and certified tails lost in thirty days. */
export async function readAccount(client, now = Date.now()) {
  const balance = await client.getBalance();
  const positionsPayload = await client.getPositions({ count_filter: 'position' });
  const orders = await client.getOrders({ status: 'resting' });
  const settlements = await client.getSettlements({ min_ts: Math.floor(now / 1000) - 30 * 86400 });
  const positions = (positionsPayload.market_positions ?? [])
    .filter((row) => Number(row.position_fp) < 0)
    .map((row) => {
      const ticker = row.ticker, eventTicker = eventOf(ticker);
      return { ticker, eventTicker, seriesTicker: seriesOf(ticker), targetDate: eventDate(eventTicker), noContracts: -Number(row.position_fp), costCents: cents(row.market_exposure_dollars) };
    });
  const resting = orders
    .filter((order) => (order.book_side ?? (order.side === 'yes' && order.action === 'sell' ? 'ask' : order.side === 'no' && order.action === 'buy' ? 'ask' : 'bid')) === 'ask')
    .map((order) => {
      const ticker = order.ticker, eventTicker = eventOf(ticker);
      return { orderId: order.order_id, ticker, eventTicker, targetDate: eventDate(eventTicker), priceCents: cents(order.yes_price_dollars), count: Math.round(Number(order.remaining_count_fp)), expiration: order.expiration_time ?? null };
    });
  const tailLosses30d = settlements.filter((row) => row.market_result === 'yes' && Number(row.no_count_fp) > 0 && temperatureSeries(seriesOf(row.ticker))).length;
  // Kalshi's balance does not set aside a resting order's collateral (seen 2026-10-03: $25.00 with
  // $16.66 resting), so equity is cash plus positions, and only cash beyond resting collateral is free.
  const cashCents = balance.balance;
  const restingCollateralCents = resting.reduce((sum, order) => sum + (100 - order.priceCents) * order.count, 0);
  return { cashCents, freeCashCents: cashCents - restingCollateralCents, portfolioCents: balance.portfolio_value, equityCents: cashCents + balance.portfolio_value, restingCollateralCents, positions, resting, tailLosses30d, settlements };
}

async function cancelAll(client, resting, dir, at, reason) {
  for (const order of resting) {
    try { await client.cancelOrder(order.orderId, order.ticker); ledger(dir, { at, kind: 'cancel', ...order, reason }); } catch (error) { ledger(dir, { at, kind: 'error', step: 'cancel', ticker: order.ticker, code: error.code, detail: error.detail ?? error.message }); }
  }
}

/** One pass of the desk. */
export async function runCycle({ live = false, env = process.env, client = createKalshiClient(), now = Date.now() } = {}) {
  const dir = stateDir(env);
  const at = new Date(now).toISOString();
  const arming = readArming(dir);
  const acting = live && arming.armed;
  const account = await readAccount(client, now);

  const halt = haltReason({ equityCents: account.equityCents, tailLosses30d: account.tailLosses30d, policy: POLICY });
  if (halt && arming.armed) {
    writeArming(dir, { ...arming, armed: false, haltedAt: at, haltReason: halt });
    if (live) await cancelAll(client, account.resting, dir, at, `halt: ${halt}`);
    ledger(dir, { at, kind: 'halt', reason: halt, equity: account.equityCents });
    return { at, halted: halt };
  }
  if (!arming.armed && arming.haltedAt && live && account.resting.length > 0) await cancelAll(client, account.resting, dir, at, 'desk is halted');

  // Every open bracket of a declared series whose event is today or tomorrow at its station.
  const held = new Set([...account.positions.map((row) => row.ticker), ...account.resting.map((row) => row.ticker)]);
  const markets = [];
  for (const series of TEMPERATURE_MARKETS.series) {
    const dates = new Set([localDate(series.timeZone, now), localDate(series.timeZone, now + 86400_000)]);
    let rows;
    try { rows = await client.getMarkets({ series_ticker: series.seriesTicker, status: 'open' }); } catch (error) {
      ledger(dir, { at, kind: 'error', step: 'markets', series: series.seriesTicker, code: error.code, detail: error.detail ?? error.message });
      continue;
    }
    for (const row of rows) {
      const targetDate = eventDate(row.event_ticker);
      const ask = Number(row.yes_ask_dollars);
      if (!dates.has(targetDate)) continue;
      if (held.has(row.ticker) || (ask > 0 && ask <= POLICY.certification.maxYesPrice + 0.02)) markets.push({ row, series, targetDate });
    }
    await pause(60);
  }

  const stations = [...new Set(TEMPERATURE_MARKETS.series.map((row) => row.station))];
  const guidance = await latestStationGuidance({ stations, now, cacheDir: join(dir, 'nbm') });
  const observed = new Map();
  // NWS temperature hazards per station; one that cannot be read refuses that station's tails.
  const hazards = new Map();
  for (const station of stations) {
    hazards.set(station, await activeTemperatureHazards({ station }).catch((error) => {
      ledger(dir, { at, kind: 'error', step: 'hazards', station, detail: error.message });
      return null;
    }));
  }
  const candidates = [];
  for (const { row, series, targetDate } of markets) {
    let obs = null;
    if (targetDate === localDate(series.timeZone, now)) {
      const key = `${series.station}/${targetDate}`;
      if (!observed.has(key)) observed.set(key, await observedExtremes({ station: series.station, date: targetDate, timeZone: series.timeZone, now }).catch((error) => ({ error: error.message })));
      obs = observed.get(key);
      if (obs?.error) { ledger(dir, { at, kind: 'error', step: 'observations', station: series.station, detail: obs.error }); obs = null; }
    }
    const market = { seriesTicker: series.seriesTicker, eventTicker: row.event_ticker, strikeType: row.strike_type, floorStrike: row.floor_strike, capStrike: row.cap_strike };
    const priced = priceTemperatureBracket(market, { guidance, observed: obs, maxGuidanceAgeHours: POLICY.certification.maxGuidanceAgeHours, now });
    let orderbook = null;
    try { orderbook = await client.getOrderbook(row.ticker, 10); } catch (error) { ledger(dir, { at, kind: 'error', step: 'orderbook', ticker: row.ticker, code: error.code }); }
    await pause(60);
    candidates.push({
      ticker: row.ticker, eventTicker: row.event_ticker, seriesTicker: series.seriesTicker, targetDate, closeTime: row.close_time,
      orderbook, priced, side: priced.priced ? tailSide(market, priced.mean) : null, hazards: hazards.get(series.station), inWindow: row.status === 'active' && inOpeningWindow({ kind: series.kind, targetDate, timeZone: series.timeZone }, POLICY.windows, now),
    });
  }

  const plan = planCycle({ candidates, positions: account.positions, resting: account.resting, cashCents: account.cashCents, equityCents: account.equityCents, policy: POLICY, now });
  const results = { cancelled: 0, placed: 0, errors: 0 };
  if (acting) {
    for (const order of plan.cancels) {
      try { await client.cancelOrder(order.orderId, order.ticker); results.cancelled += 1; ledger(dir, { at, kind: 'cancel', ...order }); } catch (error) { results.errors += 1; ledger(dir, { at, kind: 'error', step: 'cancel', ticker: order.ticker, code: error.code, detail: error.detail ?? error.message }); }
    }
    const expires = Math.floor(now / 1000) + POLICY.orders.ttlMinutes * 60;
    for (const order of plan.places) {
      const candidate = candidates.find((row) => row.ticker === order.ticker);
      const clientOrderId = `wd-${createHash('sha256').update(`${at}|${order.ticker}|${order.priceCents}|${order.count}`).digest('hex').slice(0, 32)}`;
      try {
        const ack = await client.createOrder({ ticker: order.ticker, side: 'ask', count: order.count, price: order.priceCents / 100, postOnly: true, clientOrderId, expirationTime: Math.min(expires, Math.floor(Date.parse(candidate.closeTime) / 1000)) });
        results.placed += 1;
        ledger(dir, { at, kind: 'place', ...order, clientOrderId, orderId: ack.order_id, filled: ack.fill_count, priced: candidate.priced });
      } catch (error) {
        results.errors += 1;
        ledger(dir, { at, kind: 'error', step: 'place', ticker: order.ticker, code: error.code, detail: error.detail ?? error.message, venueWrite: error.venueWrite });
      }
    }
  }
  const summary = {
    at, mode: acting ? 'live' : live ? 'unarmed' : 'paper', guidanceRun: guidance.runtime,
    cash: usd(account.cashCents), equity: usd(account.equityCents), positions: account.positions.length, resting: account.resting.length,
    candidates: candidates.length, certified: plan.places.length + account.resting.length - plan.cancels.length, plan: { cancels: plan.cancels.length, places: plan.places.length }, results,
    laneCapital: usd(plan.capitalCents),
    places: plan.places.map((order) => `${order.ticker} sell YES ${order.count}@${order.priceCents}c risk ${usd(order.riskCents)} p=${order.probability.toFixed(4)} kelly=${order.kellyFraction.toFixed(2)}`),
  };
  ledger(dir, { kind: 'cycle', ...summary, skips: plan.skips.slice(0, 200) });
  return summary;
}

export async function status({ env = process.env, client = createKalshiClient(), now = Date.now() } = {}) {
  const account = await readAccount(client, now);
  const fills = await client.getFills({ min_ts: Math.floor(now / 1000) - 7 * 86400 });
  const settled = account.settlements.filter((row) => temperatureSeries(seriesOf(row.ticker)));
  return {
    arming: readArming(stateDir(env)), bankroll: `$${POLICY.bankrollUsd}`,
    cash: usd(account.cashCents), equity: usd(account.equityCents), sinceStart: usd(account.equityCents - POLICY.bankrollUsd * 100),
    positions: account.positions.map((row) => `${row.ticker} NO x${row.noContracts} cost ${usd(row.costCents)}`),
    resting: account.resting.map((row) => `${row.ticker} sell YES ${row.count}@${row.priceCents}c`),
    fills7d: fills.map((row) => `${row.created_time} ${row.ticker} ${row.outcome_side ?? row.side} ${row.count_fp}@${row.yes_price_dollars}${row.is_taker ? ' taker' : ''}`),
    settled30d: settled.map((row) => `${row.settled_time} ${row.ticker} result=${row.market_result} NO=${row.no_count_fp} revenue=${usd(row.revenue)}`),
    tailLosses30d: account.tailLosses30d,
  };
}

async function main([command, ...rest]) {
  const dir = stateDir();
  if (command === 'cycle') return runCycle({ live: rest.includes('--live') });
  if (command === 'status') return status();
  if (command === 'arm') {
    const by = rest.join(' ').trim();
    if (!by) throw new Error('usage: kalshi-weather-desk.mjs arm <who arms it, by actor>');
    const arming = { armed: true, armedAt: new Date().toISOString(), armedBy: by, haltedAt: null, haltReason: null, policyVersion: POLICY.version };
    writeArming(dir, arming);
    ledger(dir, { at: arming.armedAt, kind: 'arm', by });
    return arming;
  }
  if (command === 'halt') {
    const at = new Date().toISOString(), reason = rest.join(' ').trim() || 'halted by hand';
    const arming = { ...readArming(dir), armed: false, haltedAt: at, haltReason: reason };
    writeArming(dir, arming);
    const client = createKalshiClient();
    const { resting } = await readAccount(client);
    await cancelAll(client, resting, dir, at, `halt: ${reason}`);
    ledger(dir, { at, kind: 'halt', reason });
    return { ...arming, cancelled: resting.length };
  }
  throw new Error('usage: kalshi-weather-desk.mjs cycle [--live] | status | arm <by> | halt [reason]');
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; },
  );
}
