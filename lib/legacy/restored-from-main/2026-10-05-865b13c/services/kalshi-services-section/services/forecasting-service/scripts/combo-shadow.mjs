#!/usr/bin/env node
/**
 * Kalshi combo shadow lane: collect | fit | measure | cliff.   SHADOW ONLY.
 * This script issues read-only GETs through the one Kalshi client (signed GET for
 * /communications/rfqs, public GETs for markets, events and the trade tape). It
 * never creates, accepts, confirms or deletes an RFQ or quote and never orders.
 *
 *   node scripts/combo-shadow.mjs collect [--interval 10] [--hours H]
 *   node scripts/combo-shadow.mjs fit     [--days 30]
 *   node scripts/combo-shadow.mjs measure [--margin 0.01]
 *
 * State (append-only JSONL, one fact per line) in ~/.local/state/561-group/settlements/forecasting-service/combos/:
 *   rfqs.jsonl    {k:'rfq'|'st', t, id, ticker, created, status, contracts, cost, legs}
 *   trades.jsonl  combo-market tape rows, deduped by trade id
 *   legs.jsonl    {k:'ev', t, event, mutex, markets:[{ticker,bid,ask,bs,as,last,exp}]} leg snapshots at discovery time
 *   results.jsonl {k:'res', t, ticker, result}   settled legs and combo markets
 */
import { createReadStream, existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKalshiClient } from '../../../src/client.mjs';
import { comboStateDir, isComboTicker, legMeta, rfqSize, correlationModel, priceCombo, tetrachoric, wilson, pairClass } from '../src/combo-pricer.mjs';

const dir = comboStateDir();
const file = (name) => join(dir, name);
const here = dirname(fileURLToPath(import.meta.url));
const num = (v) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? null : n; };
const args = process.argv.slice(2); const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : def; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString(), ...a);
const append = (name, rows) => { if (rows.length) appendFileSync(file(name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

async function readJsonl(name, onRow) {
  if (!existsSync(file(name))) return;
  const rl = createInterface({ input: createReadStream(file(name)), crlfDelay: Infinity });
  for await (const line of rl) { if (line) { try { onRow(JSON.parse(line)); } catch { /* torn line */ } } }
}

const raw = createKalshiClient();
// One house-polite lane: calls are serialized with a minimum gap, and a 429 backs off and retries.
let lastCall = 0; let chain = Promise.resolve();
const GAP = opt('gap', 200);
const SAMPLE = opt('sample', 10); // keep 1 in SAMPLE combo tickers (by hash): the lane is rate- and disk-bound, not statistics-bound
const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const sampled = (ticker) => fnv(ticker) % SAMPLE === 0;
const client = {
  call(method, path, o) {
    const run = async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const wait = lastCall + GAP - Date.now(); if (wait > 0) await sleep(wait);
        lastCall = Date.now();
        try { return await raw.call(method, path, o); } catch (e) { if (e.status !== 429 || attempt === 3) throw e; await sleep(1500 * (attempt + 1)); }
      }
      return null;
    };
    const p = chain.then(run); chain = p.catch(() => {}); return p;
  },
};

// ------------------------------------------------------------------ collect

const snapOf = (m) => ({ ticker: m.ticker, bid: num(m.yes_bid_dollars), ask: num(m.yes_ask_dollars), bs: num(m.yes_bid_size_fp), as: num(m.yes_ask_size_fp), last: num(m.last_price_dollars), exp: m.expected_expiration_time ?? m.expiration_time, res: m.result || undefined });

async function collect() {
  mkdirSync(dir, { recursive: true });
  const interval = opt('interval', 10) * 1000; const endAt = opt('hours', 0) ? Date.now() + opt('hours', 0) * 3600e3 : Infinity;
  const stateFile = file('state.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const seen = new Map(); // rfq id -> {status, t}
  const cutoff = Date.now() - 2 * 3600e3;
  await readJsonl('rfqs.jsonl', (r) => { if (r.t >= cutoff) { if (r.k === 'rfq') seen.set(r.id, { status: r.status, t: r.t, ticker: r.ticker }); else if (seen.has(r.id)) seen.get(r.id).status = r.status; } });
  const tradeIds = new Set(); const tradeCutoff = Date.now() - 3600e3;
  await readJsonl('trades.jsonl', (r) => { if (Date.parse(r.created_time) >= tradeCutoff) tradeIds.add(r.trade_id); });
  const evCache = new Map(); // event -> t of last snapshot
  const pendingRes = new Map(); // leg/combo ticker -> exp ms
  let lastSettle = 0; let minTs = state.minTs ?? Math.floor(Date.now() / 1000) - 5;
  const resolved = new Set(); await readJsonl('results.jsonl', (r) => { if (r.result) resolved.add(r.ticker); });
  await readJsonl('legs.jsonl', (r) => { for (const m of r.markets ?? []) if (!resolved.has(m.ticker) && m.exp) pendingRes.set(m.ticker, Date.parse(m.exp)); });
  let polls = 0;
  log('collect start', { dir, seen: seen.size, minTs });
  while (Date.now() < endAt) {
    const t = Date.now(); const rows = []; const newRfqs = [];
    try {
      // 1. RFQs: all open (paged until exhausted), plus the newest closed page.
      const live = new Set(); const closedNow = new Set();
      for (const status of ['open', 'closed']) {
        let cursor;
        for (let page = 0; page < (status === 'open' ? 8 : 1); page += 1) {
          const p = await client.call('GET', '/communications/rfqs', { query: { limit: 200, status, cursor } });
          for (const q of p.rfqs ?? []) {
            if (!sampled(q.market_ticker)) continue;
            (status === 'open' ? live : closedNow).add(q.id);
            const prev = seen.get(q.id);
            if (!prev) {
              const row = { k: 'rfq', t, id: q.id, ticker: q.market_ticker, created: q.created_ts, status: q.status, contracts: num(q.contracts_fp), cost: num(q.target_cost_dollars), coll: q.mve_collection_ticker, legs: (q.mve_selected_legs ?? []).map((l) => [l.market_ticker, l.side]) };
              seen.set(q.id, { status: q.status, t, ticker: q.market_ticker }); rows.push(row); newRfqs.push(row);
            } else if (prev.status !== q.status) { prev.status = q.status; rows.push({ k: 'st', t, id: q.id, status: q.status }); }
          }
          cursor = p.cursor; if (!cursor) break;
        }
      }
      for (const [id, s] of seen) if (s.status === 'open' && !live.has(id) && !closedNow.has(id)) { s.status = 'gone'; rows.push({ k: 'st', t, id, status: 'gone' }); }
      append('rfqs.jsonl', rows);
      // 2. Leg snapshots for the events of newly discovered RFQs (one event fetch per event per poll).
      const need = new Map();
      for (const r of newRfqs) if (t - Date.parse(r.created) < 90e3) for (const [mt] of r.legs) { const ev = mt.split('-').slice(0, 2).join('-'); (need.get(ev) ?? need.set(ev, new Set()).get(ev)).add(mt); }
      const snaps = []; const wantTickers = new Set(); const wEvents = [];
      for (const [ev, want] of need) { for (const mt of want) wantTickers.add(mt); if (/(GAME|MATCH|FIGHT)$/u.test(ev.split('-')[0]) && t - (evCache.get(ev) ?? 0) > 60000) wEvents.push(ev); }
      const tk = [...wantTickers];
      for (let i = 0; i < tk.length; i += 100) {
        try {
          const p = await client.call('GET', '/markets', { query: { tickers: tk.slice(i, i + 100).join(','), limit: 100 }, signed: false });
          const byEv = new Map();
          for (const m of p.markets ?? []) (byEv.get(m.event_ticker) ?? byEv.set(m.event_ticker, []).get(m.event_ticker)).push(m);
          for (const [event, ms] of byEv) snaps.push({ k: 'ev', t, event, n: ms.length, markets: ms.map(snapOf) });
          for (const m of p.markets ?? []) if (m.expected_expiration_time && !resolved.has(m.ticker)) pendingRes.set(m.ticker, Date.parse(m.expected_expiration_time));
        } catch (e) { log('markets', e.message); }
      }
      for (const ev of wEvents.slice(0, 40)) {
        try {
          const p = await client.call('GET', `/events/${ev}`, { query: { with_nested_markets: true }, signed: false });
          const all = p.event?.markets ?? p.markets ?? [];
          evCache.set(ev, t);
          snaps.push({ k: 'ev', t, event: ev, mutex: Boolean(p.event?.mutually_exclusive), n: all.length, sib: true, markets: all.slice(0, 6).map(snapOf) });
        } catch (e) { log('event', ev, e.message); }
      }
      append('legs.jsonl', snaps);
      // A combo settles after its last leg: pending until the latest leg expectation (+ the sweep's 2 min grace).
      for (const r of newRfqs) {
        if (!r.ticker || resolved.has(r.ticker) || pendingRes.has(r.ticker)) continue;
        const exps = r.legs.map(([mt]) => pendingRes.get(mt));
        pendingRes.set(r.ticker, exps.every(Boolean) ? Math.max(...exps) : Date.now() + 3 * 3600e3);
      }
      // 3. The combo trade tape since minTs (paged; the whole tape, filtered to KXMVE).
      const trades = []; let cursor; let maxTs = minTs;
      for (let page = 0; page < 40; page += 1) {
        const p = await client.call('GET', '/markets/trades', { query: { limit: 1000, min_ts: minTs, cursor }, signed: false });
        for (const tr of p.trades ?? []) {
          maxTs = Math.max(maxTs, Math.floor(Date.parse(tr.created_time) / 1000));
          if (isComboTicker(tr.ticker) && sampled(tr.ticker) && !tradeIds.has(tr.trade_id)) { tradeIds.add(tr.trade_id); trades.push({ trade_id: tr.trade_id, ticker: tr.ticker, created_time: tr.created_time, yes_price_dollars: tr.yes_price_dollars, count_fp: tr.count_fp, taker_outcome_side: tr.taker_outcome_side, seen: t }); }
        }
        cursor = p.cursor; if (!cursor) break;
        if (page === 39) log('tape page cap hit; gap possible');
      }
      minTs = Math.max(minTs, maxTs - 2); // overlap two seconds; trade ids dedupe
      append('trades.jsonl', trades);
      for (const tr of trades) if (!resolved.has(tr.ticker) && !pendingRes.has(tr.ticker)) pendingRes.set(tr.ticker, Date.now() + 3 * 3600e3);
      // 4. Settlement sweep every 5 minutes: legs/combos whose expected expiration has passed.
      if (t - lastSettle > 180e3) {
        lastSettle = t;
        const due = [...pendingRes].filter(([tk, exp]) => !resolved.has(tk) && exp < t - 120e3).map(([tk]) => tk);
        const out = [];
        for (let i = 0; i < Math.min(due.length, 2000); i += 100) {
          try {
            const p = await client.call('GET', '/markets', { query: { tickers: due.slice(i, i + 100).join(','), limit: 100 }, signed: false });
            for (const m of p.markets ?? []) if (m.result === 'yes' || m.result === 'no') { out.push({ k: 'res', t, ticker: m.ticker, result: m.result }); resolved.add(m.ticker); pendingRes.delete(m.ticker); }
          } catch (e) { log('settle', e.message); }
          await sleep(120);
        }
        append('results.jsonl', out);
        for (const tk2 of due) if (!resolved.has(tk2)) pendingRes.set(tk2, t + 25 * 60e3); // not settled yet: look again later
        log('settle sweep', { due: due.length, resolved: out.length, pending: pendingRes.size });
      }
      for (const [id, s] of seen) if (t - s.t > 2 * 3600e3) seen.delete(id);
      writeFileSync(stateFile, JSON.stringify({ minTs, t }));
      polls += 1;
      if (polls % 6 === 1) log('poll', { newRfqs: newRfqs.length, open: live.size, trades: trades.length, snaps: snaps.length, rss: Math.round(process.memoryUsage().rss / 1e6) });
    } catch (e) { log('poll error', e.message); await sleep(5000); }
    await sleep(Math.max(1000, interval - (Date.now() - t)));
  }
}

if (cmd === 'collect') await collect();
else if (cmd === 'fit' || cmd === 'measure' || cmd === 'cliff' || cmd === 'makers') {
  const mod = await import(`./combo-analysis.mjs`);
  await mod[cmd](args, { dir, file, readJsonl, client, opt, log, num });
} else { console.error('usage: combo-shadow.mjs collect|fit|measure'); process.exit(2); }
