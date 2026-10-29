/**
 * `combo-shadow.mjs cliff`: what the Sports Prop Combo component-leg incentive pays a maker per
 * contract on each prop leg, from the sampled combo tape. Read-only (public GET /markets for leg volume).
 *
 * For every sampled combo print: fees from the combo schedule, pool = CLIFF * fees * eligible fraction,
 * pool spread over the combo's eligible legs. Per leg i, A_i = sum_c pool_c / D_c for three denominators
 * (D = n parity upper bound, D = 3((4/3)^n - 1) three symmetric makers, D = 2^n - 1 lower bound),
 * scaled by the collector's 1-in-SAMPLE ticker sample. The rebate per maker contract is A_i / V_i with
 * V_i the leg's lifetime traded volume (an over-count of eligible maker volume, so the rebate is conservative),
 * and A_i covers only the collection window (combos before it are missed), so every figure is a lower bound
 * except that leg volume still to trade before settlement will dilute it.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comboPrintFees, comboPool, denominatorBounds, isSportsProp } from '../src/combo-incentive.mjs';
import { legMeta } from '../src/combo-pricer.mjs';

const recordDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'records', '2026-10-04-kalshi-combos');
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const r4 = (x) => (x === null || x === undefined ? null : Number(x.toFixed(4)));

/** Stream the combo tape and RFQ legs into per-leg pool sums A_i = sum_c pool_c / D_c (scaled to the whole exchange). */
async function legPools(readJsonl, SAMPLE) {
  const prints = new Map(); let t0 = Infinity; let t1 = 0;
  await readJsonl('trades.jsonl', (r) => {
    const t = Date.parse(r.created_time); const p = Number(r.yes_price_dollars); const c = Number(r.count_fp);
    if (!Number.isFinite(p) || !Number.isFinite(c)) return;
    t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    (prints.get(r.ticker) ?? prints.set(r.ticker, []).get(r.ticker)).push({ p, c });
  });
  const legsOf = new Map(); const rfqMix = { rfqs: 0, anyProp: 0, allProp: 0, legs: 0, propLegs: 0 };
  await readJsonl('rfqs.jsonl', (r) => {
    if (r.k !== 'rfq') return;
    rfqMix.rfqs += 1; const tick = r.legs.map(([t]) => t); const np = tick.filter(isSportsProp).length;
    rfqMix.legs += tick.length; rfqMix.propLegs += np; if (np) rfqMix.anyProp += 1; if (np === tick.length) rfqMix.allProp += 1;
    if (prints.has(r.ticker) && !legsOf.has(r.ticker)) legsOf.set(r.ticker, tick);
  });

  const legs = new Map(); const tot = { prints: 0, matched: 0, notional: 0, fees: 0, makerFees: 0, pool: 0 };
  const poolBySport = {};
  for (const [ticker, ps] of prints) {
    const lt = legsOf.get(ticker); tot.prints += ps.length; if (!lt) continue;
    let fees = 0; let mf = 0;
    for (const { p, c } of ps) { const f = comboPrintFees(p, c, lt); fees += f.total; mf += f.maker; tot.notional += c * p; }
    tot.matched += ps.length; tot.fees += fees; tot.makerFees += mf;
    const { pool, eligible } = comboPool(fees, lt); if (!eligible.length) continue;
    tot.pool += pool; const n = eligible.length; const d = denominatorBounds(n, 3);
    for (const leg of eligible) {
      const sport = legMeta(leg).sport; poolBySport[sport] = (poolBySport[sport] ?? 0) + pool / n;
      const a = legs.get(leg) ?? legs.set(leg, { hi: 0, k3: 0, lo: 0, combos: 0 }).get(leg);
      a.hi += (SAMPLE * pool) / d.lo; a.k3 += (SAMPLE * pool) / d.point; a.lo += (SAMPLE * pool) / d.hi; a.combos += 1;
    }
  }
  return { legs, tot, poolBySport, rfqMix, t0, t1 };
}

export async function cliff(args, { readJsonl, client, opt, log, num }) {
  const SAMPLE = opt('sample', 10); const top = opt('top', 400);
  const { legs, tot, poolBySport, rfqMix, t0, t1 } = await legPools(readJsonl, SAMPLE);
  const ranked = [...legs.entries()].sort((x, y) => y[1].hi - x[1].hi).slice(0, top);
  const vol = new Map();
  for (let i = 0; i < ranked.length; i += 100) {
    const batch = ranked.slice(i, i + 100).map(([t]) => t);
    try {
      const p = await client.call('GET', '/markets', { query: { tickers: batch.join(','), limit: 100 }, signed: false });
      for (const m of p?.markets ?? []) vol.set(m.ticker, { volume: num(m.volume_fp) ?? num(m.volume), bid: num(m.yes_bid_dollars), ask: num(m.yes_ask_dollars), status: m.status, close: m.close_time });
    } catch (e) { log('markets', e.message); }
  }
  const rows = ranked.map(([t, a]) => {
    const v = vol.get(t); const V = v?.volume;
    const per = (x) => (V ? x / V : null);
    return { ticker: t, sport: legMeta(t).sport, kind: legMeta(t).kind, combos: a.combos, poolParity: r4(a.hi), volume: V ?? null, spread: v && v.ask !== null && v.bid !== null ? r4(v.ask - v.bid) : null, status: v?.status ?? null, rebatePerContract: { hi: r4(per(a.hi)), k3: r4(per(a.k3)), lo: r4(per(a.lo)) } };
  }).filter((r) => r.volume);

  const hours = (t1 - t0) / 3600e3; const perDay = 24 / (hours || 1);
  const report = {
    generatedAt: new Date().toISOString(), windowHours: r4(hours), sample: SAMPLE,
    rules: 'pool = 0.25 * combo fees * eligible/legs; S = prod(1+F)-1; payout prop. to S over S>=0.01; combo fees taker 0.07CP(1-P) + maker 0.035CP(1-P) (uncorrelated NFL: no maker fee)',
    rfqMix: { ...rfqMix, anyPropFrac: r4(rfqMix.anyProp / rfqMix.rfqs), allPropFrac: r4(rfqMix.allProp / rfqMix.rfqs), propLegFrac: r4(rfqMix.propLegs / rfqMix.legs) },
    tape: { prints: tot.prints, matchedToLegs: tot.matched },
    perDayExchange: { notional: Math.round(SAMPLE * tot.notional * perDay), fees: Math.round(SAMPLE * tot.fees * perDay), makerFees: Math.round(SAMPLE * tot.makerFees * perDay), pool: Math.round(SAMPLE * tot.pool * perDay), poolFracOfFees: r4(tot.pool / tot.fees) },
    poolPerDayBySport: Object.fromEntries(Object.entries(poolBySport).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, Math.round(SAMPLE * v * perDay)])),
    eligibleLegs: legs.size,
    rebatePerContractQuantiles: Object.fromEntries(['hi', 'k3', 'lo'].map((k) => [k, Object.fromEntries([0.25, 0.5, 0.75, 0.9].map((q) => [q, r4(quantile(rows.map((r) => r.rebatePerContract[k]), q))]))])),
  };
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, 'cliff.json'), JSON.stringify({ report, legs: rows.slice(0, 200) }, null, 1));
  console.log(JSON.stringify(report, null, 1));
  console.log('top legs by parity pool:');
  for (const r of rows.slice(0, 25)) console.log(r.ticker.padEnd(48), r.status, 'combos', r.combos, 'pool$', r.poolParity, 'vol', r.volume, 'spr', r.spread, 'rebate/ct', JSON.stringify(r.rebatePerContract));
}

/**
 * `combo-shadow.mjs makers`: on prop legs that have settled, what the makers who supplied them actually
 * earned. Every trade has one maker, on the side opposite `taker_outcome_side`; the maker's P&L per contract
 * against the result, plus the incentive rebate A_i / V_i, is the leg-maker lane's net economics before our
 * own queue position. Public GETs only. Clustered by game (the legs of one game settle together).
 */
export async function makers(args, { readJsonl, client, opt, log, num }) {
  const SAMPLE = opt('sample', 10); const maxLegs = opt('legs', 250);
  const { legs } = await legPools(readJsonl, SAMPLE);
  const all = [...legs.keys()]; const mk = new Map();
  for (let i = 0; i < all.length; i += 100) {
    try {
      const p = await client.call('GET', '/markets', { query: { tickers: all.slice(i, i + 100).join(','), limit: 100 }, signed: false });
      for (const m of p?.markets ?? []) mk.set(m.ticker, m);
    } catch (e) { log('markets', e.message); }
  }
  const settled = all.filter((t) => ['yes', 'no'].includes(mk.get(t)?.result)).sort((a, b) => legs.get(b).k3 - legs.get(a).k3).slice(0, maxLegs);
  log('eligible legs', all.length, 'settled', settled.length);
  const rows = []; const starts = new Map();
  const startOf = async (event) => {
    if (!starts.has(event)) {
      let s = null;
      try { const p = await client.call('GET', '/milestones', { query: { limit: 1, related_event_ticker: event }, signed: false }); s = Date.parse(p?.milestones?.[0]?.start_date) || null; } catch (e) { log('milestone', event, e.message); }
      starts.set(event, s);
    }
    return starts.get(event);
  };
  for (const t of settled) {
    const won = mk.get(t).result === 'yes'; let cursor; let pnl = 0; let vol = 0; let tradesN = 0;
    const start = await startOf(mk.get(t).event_ticker); const live = { pnl: 0, vol: 0 };
    for (let page = 0; page < 50; page += 1) {
      let p; try { p = await client.call('GET', '/markets/trades', { query: { ticker: t, limit: 1000, cursor }, signed: false }); } catch (e) { log('trades', t, e.message); break; }
      for (const tr of p?.trades ?? []) {
        const y = Number(tr.yes_price_dollars); const c = Number(tr.count_fp); if (!Number.isFinite(y) || !Number.isFinite(c)) continue;
        // maker holds the side the taker did not buy: taker yes -> maker short yes at y
        const x = c * (tr.taker_outcome_side === 'yes' ? y - (won ? 1 : 0) : (won ? 1 : 0) - y);
        pnl += x; vol += c; tradesN += 1;
        if (start && Date.parse(tr.created_time) >= start) { live.pnl += x; live.vol += c; }
      }
      cursor = p?.cursor; if (!cursor) break;
    }
    if (!vol) continue;
    const a = legs.get(t); const m = legMeta(t);
    rows.push({ ticker: t, sport: m.sport, kind: m.kind, game: `${m.sport}-${m.game}`, start: start ? new Date(start).toISOString() : null, liveVolume: r4(live.vol), livePnl: r4(live.pnl), volume: r4(vol), trades: tradesN, makerPnl: r4(pnl), makerPnlPerContract: r4(pnl / vol), rebate: { hi: r4(a.hi / vol), k3: r4(a.k3 / vol), lo: r4(a.lo / vol) }, poolK3: r4(a.k3) });
  }
  const ratio = (rs, key) => {
    // contract-weighted net per contract, delta-method CI clustered by game
    const g = new Map(); for (const r of rs) { const x = g.get(r.game) ?? g.set(r.game, { n: 0, v: 0 }).get(r.game); x.n += r.makerPnl + (key ? r.poolK3 : 0); x.v += r.volume; }
    const gs = [...g.values()]; const N = gs.reduce((s, x) => s + x.n, 0); const V = gs.reduce((s, x) => s + x.v, 0); if (!V) return null;
    const R = N / V; const vr = gs.reduce((s, x) => s + (x.n - R * x.v) ** 2, 0) * gs.length / Math.max(1, gs.length - 1) / (V * V);
    return { legs: rs.length, games: gs.length, volume: Math.round(V), perContract: r4(R), ci95: [r4(R - 1.96 * Math.sqrt(vr)), r4(R + 1.96 * Math.sqrt(vr))] };
  };
  const buckets = [[0, 2000], [2000, 10000], [10000, 50000], [50000, Infinity]];
  const report = {
    generatedAt: new Date().toISOString(), settledLegs: rows.length,
    note: 'maker = the resting side of every print; P&L vs settlement; rebate = k3 pool (3 symmetric makers) / leg volume over the collection window only',
    makerOnly: ratio(rows, false), makerPlusRebate: ratio(rows, true),
    // the incentive counts only post-start maker volume on live events, so the in-play half is the lane
    preStart: ratio(rows.filter((r) => r.start).map((r) => ({ ...r, makerPnl: r.makerPnl - r.livePnl, volume: r.volume - r.liveVolume })).filter((r) => r.volume > 0), false),
    inPlay: ratio(rows.filter((r) => r.liveVolume > 0).map((r) => ({ ...r, makerPnl: r.livePnl, volume: r.liveVolume })), false),
    inPlayPlusRebate: ratio(rows.filter((r) => r.liveVolume > 0).map((r) => ({ ...r, makerPnl: r.livePnl, volume: r.liveVolume })), true),
    byVolume: Object.fromEntries(buckets.map(([lo, hi]) => { const rs = rows.filter((r) => r.volume >= lo && r.volume < hi); return [`${lo}-${hi}`, { makerOnly: ratio(rs, false), makerPlusRebate: ratio(rs, true) }]; })),
    bySport: Object.fromEntries([...new Set(rows.map((r) => r.sport))].map((sp) => { const rs = rows.filter((r) => r.sport === sp); return [sp, { makerOnly: ratio(rs, false), makerPlusRebate: ratio(rs, true) }]; })),
  };
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, 'makers.json'), JSON.stringify({ report, legs: rows }, null, 1));
  console.log(JSON.stringify(report, null, 1));
}
