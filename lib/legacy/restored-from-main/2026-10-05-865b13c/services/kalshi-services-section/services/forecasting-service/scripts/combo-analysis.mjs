/**
 * Analysis half of combo-shadow.mjs: `fit` (same-game correlation from settled
 * markets) and `measure` (shadow-price every RFQ, compare to executed prints).
 * Read-only; writes only to the combo state dir and the record dir.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legMeta, pairClass, tetrachoric, correlationModel, priceCombo, wilson, isComboTicker } from '../src/combo-pricer.mjs';
import { assessFamily } from '../src/coherence.mjs';

const recordDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'records', '2026-10-04-kalshi-combos');
const SERIES = {
  NFL: ['GAME', 'TOTAL', 'SPREAD', 'TD', 'PASSYDS', 'RECYDS', 'RSHYDS', 'REC', 'PASSTDS', '1HTOTAL', 'TEAMTOTAL'],
  NCAAF: ['GAME', 'TOTAL', 'SPREAD', '1HTOTAL'],
  MLB: ['GAME', 'TOTAL', 'HIT', 'KS', 'HRR', 'RFI', 'SPREAD', 'HR', 'SB', 'TEAMTOTAL'],
  NHL: ['GAME', 'TOTAL', 'SPREAD'],
  NBA: ['GAME', 'TOTAL', 'SPREAD'],
  UEFANL: ['GAME', 'TOTAL', 'BTTS', 'SPREAD'],
  INTLFRIENDLY: ['GAME', 'TOTAL', 'BTTS', 'SPREAD'],
  EPL: ['GAME', 'TOTAL', 'BTTS', 'SPREAD'],
};

// ------------------------------------------------------------------ fit

export async function fit(args, { client, opt, log, num }) {
  const pageCap = opt('pages', 12);
  const tables = new Map(); // key -> [n11,n10,n01,n00]
  const bump = (key, a, b) => { const t = tables.get(key) ?? tables.set(key, [0, 0, 0, 0]).get(key); t[(a ? 0 : 2) + (b ? 0 : 1)] += 1; };
  let nGames = 0;
  for (const [sport, roles] of Object.entries(SERIES)) {
    const games = new Map(); // game id -> legMeta+outcome[]
    for (const role of roles) {
      const series = `KX${sport}${role}`;
      let cursor; let got = 0;
      for (let page = 0; page < pageCap; page += 1) {
        let p;
        try { p = await client.call('GET', '/markets', { query: { series_ticker: series, status: 'settled', limit: 1000, cursor }, signed: false }); } catch (e) { log('fit', series, e.message); break; }
        for (const m of p.markets ?? []) {
          if (m.result !== 'yes' && m.result !== 'no') continue;
          const meta = legMeta(m.ticker, m.event_ticker);
          (games.get(meta.game) ?? games.set(meta.game, []).get(meta.game)).push({ meta, yes: m.result === 'yes' });
          got += 1;
        }
        cursor = p.cursor; if (!cursor) break;
      }
      log('fit', series, got);
    }
    for (const [, ms0] of games) {
      const ms = ms0.length > 70 ? ms0.filter((_, i) => i % Math.ceil(ms0.length / 70) === 0) : ms0; // bounded pair count
      nGames += 1;
      for (let i = 0; i < ms.length; i += 1) for (let j = i + 1; j < ms.length; j += 1) {
        const a = ms[i]; const b = ms[j];
        if (a.meta.event === b.meta.event && (a.meta.role === 'W' || a.meta.role === 'T' || a.meta.role === 'S' || a.meta.role === 'TT')) continue; // exclusive / ladder: handled exactly, not by copula
        if (a.meta.role === 'W' && b.meta.role === 'W') continue;
        const { key } = pairClass(a.meta, b.meta);
        bump(`${sport}|${key}`, a.yes, b.yes); bump(`*|${key}`, a.yes, b.yes);
      }
    }
  }
  const classes = {};
  for (const [key, t] of tables) {
    const n = t[0] + t[1] + t[2] + t[3];
    if (n < 100) continue;
    const rho = tetrachoric(t);
    if (rho === null) continue;
    classes[key] = { rho: Number(rho.toFixed(3)), n, table: t, phi: Number(((t[0] * t[3] - t[1] * t[2]) / Math.sqrt((t[0] + t[1]) * (t[2] + t[3]) * (t[0] + t[2]) * (t[1] + t[3]) || 1)).toFixed(3)) };
  }
  const out = { fittedAt: new Date().toISOString(), method: 'pooled tetrachoric (grid ML, step .05) of yes-outcomes of settled same-game market pairs, by sport|role|role|same-team class; W=winner T=total S=spread TT=team total B=BTTS P=player/other prop; same-team s=same side o=opposite u=unknown', games: nGames, classes };
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, 'fit.json'), JSON.stringify(out, null, 1));
  console.log(`fit: ${nGames} games, ${Object.keys(classes).length} classes -> ${join(recordDir, 'fit.json')}`);
  for (const [k, c] of Object.entries(classes).filter(([k]) => k.startsWith('*|')).sort()) console.log(k.padEnd(14), 'rho', String(c.rho).padStart(6), 'phi', String(c.phi).padStart(6), 'n', c.n);
}

// ------------------------------------------------------------------ measure

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : null; };

function legProb(snapMarket) {
  if (!snapMarket) return null;
  const { bid, ask, last } = snapMarket;
  if (bid !== null && ask !== null && ask > 0 && ask - bid <= 0.12) return (bid + ask) / 2;
  return last;
}

export async function measure(args, { file, readJsonl, opt, log }) {
  const margin = opt('margin', 0.01); const sinceMs = opt('since-hours', 0) ? Date.now() - opt('since-hours', 0) * 3600e3 : 0;
  const fitFile = join(recordDir, 'fit.json');
  const fitData = existsSync(fitFile) ? JSON.parse(readFileSync(fitFile, 'utf8')) : { classes: {} };
  const scales = [0, 0.5, 1, 1.5, 2];
  const models = Object.fromEntries(scales.map((s) => [s, correlationModel(fitData, { scale: s })]));
  const rfqs = new Map(); const byTicker = new Map(); const snaps = new Map(); const sib = new Map(); const results = new Map(); const trades = [];
  await readJsonl('rfqs.jsonl', (r) => { if (r.k === 'rfq' && !rfqs.has(r.id) && r.t >= sinceMs) { rfqs.set(r.id, r); (byTicker.get(r.ticker) ?? byTicker.set(r.ticker, []).get(r.ticker)).push(r); } else if (r.k === 'st' && rfqs.has(r.id)) rfqs.get(r.id).status = r.status; });
  await readJsonl('legs.jsonl', (r) => { for (const m of r.markets) { (snaps.get(m.ticker) ?? snaps.set(m.ticker, []).get(m.ticker)).push({ t: r.t, m }); if (r.sib) (sib.get(r.event) ?? sib.set(r.event, []).get(r.event)).push({ t: r.t, markets: r.markets, mutex: r.mutex }); } });
  await readJsonl('results.jsonl', (r) => results.set(r.ticker, r.result));
  await readJsonl('trades.jsonl', (r) => trades.push(r));
  const snapAt = (ticker, t) => { const a = snaps.get(ticker); if (!a) return null; let best = null; for (const s of a) if (Math.abs(s.t - t) < 60000 && (!best || Math.abs(s.t - t) < Math.abs(best.t - t))) best = s; return best?.m ?? null; };

  const pricedCache = new Map();
  function price(rfq) {
    if (pricedCache.has(rfq.id)) return pricedCache.get(rfq.id);
    const legs = []; let ok = true; const verdicts = [];
    for (const [ticker, side] of rfq.legs) {
      const m = snapAt(ticker, rfq.t); const p = legProb(m);
      if (p === null || p === undefined) { ok = false; break; }
      const meta = legMeta(ticker);
      let pYes = p;
      // Coherence: legs of an exclusive GAME/MATCH event are renormalised so the outcome set sums to 1
      // (the engine's exclusive-set block constraint); the engine's verdict is recorded alongside.
      if (meta.role === 'W') {
        const sibs = (sib.get(meta.event) ?? []).filter((s) => Math.abs(s.t - rfq.t) < 90000).sort((x, y) => Math.abs(x.t - rfq.t) - Math.abs(y.t - rfq.t))[0];
        if (sibs && sibs.markets.length >= 2 && sibs.markets.length <= 3) {
          const ps = sibs.markets.map((x) => legProb(x));
          if (ps.every((x) => x !== null)) {
            const sum = ps.reduce((a, b) => a + b, 0);
            if (sum > 0.8 && sum < 1.3) { const mine = ps[sibs.markets.findIndex((x) => x.ticker === ticker)]; if (mine !== undefined) pYes = mine / sum; }
            const family = { id: meta.event, kind: 'exclusive-exhaustive-assumed', nCells: sibs.markets.length, blocks: [sibs.markets.map((_, i) => i)], couplings: [], markets: sibs.markets.map((x, i) => ({ id: x.ticker, venue: 'kalshi', theta: 0.07, cells: [i], bids: x.bid && x.bs ? [{ price: x.bid, size: x.bs }] : [], asks: x.ask && x.as ? [{ price: x.ask, size: x.as }] : [] })) };
            try { verdicts.push(assessFamily(family).verdict); } catch { /* engine verdict is advisory */ }
          }
        }
      }
      legs.push({ ticker, event: meta.event, side, pYes });
    }
    const fairCache = {};
    const out = ok ? { legs, verdicts, fairAt: (sc) => (fairCache[sc] ??= priceCombo(legs, models[sc], { samples: 2000 })) } : null;
    pricedCache.set(rfq.id, out); return out;
  }

  const outcomeOf = (ticker, rfq) => {
    const r = results.get(ticker); if (r) return r === 'yes';
    if (!rfq) return null;
    let all = true;
    for (const [lt, side] of rfq.legs) { const lr = results.get(lt); if (!lr) return null; if ((lr === 'yes') !== (side === 'yes')) all = false; }
    return all;
  };

  // ---- all RFQs: size distribution and priceability
  const sizes = []; let priced = 0; let legCounts = []; const crossEvent = { independent: 0, correlated: 0 };
  for (const r of rfqs.values()) {
    const pr = price(r);
    if (pr) { priced += 1; legCounts.push(r.legs.length); const games = new Set(r.legs.map(([t]) => legMeta(t).game)); (games.size === r.legs.length ? crossEvent.independent++ : crossEvent.correlated++); }
    const f = pr?.fairAt(1).fair; const sz = r.cost ?? (r.contracts && f ? r.contracts * f : null); if (sz) sizes.push(sz);
  }

  // ---- executed trades
  const rows = [];
  for (const tr of trades) {
    const tms = Date.parse(tr.created_time);
    const cands = (byTicker.get(tr.ticker) ?? []).filter((r) => r.t <= tms + 15000 && tms - r.t < 20 * 60000).sort((a, b) => Math.abs(a.t - tms) - Math.abs(b.t - tms));
    const rfq = cands[0]; if (!rfq) continue;
    const pr = price(rfq); if (!pr) continue;
    const y = Number(tr.yes_price_dollars); const c = Number(tr.count_fp); const takerYes = tr.taker_outcome_side === 'yes';
    const win = outcomeOf(tr.ticker, rfq);
    const fair = Object.fromEntries(scales.map((s) => [s, pr.fairAt(s).fair]));
    rows.push({ ticker: tr.ticker, t: tms, y, c, takerYes, win, fair, nLegs: rfq.legs.length, rfqCost: rfq.cost, rfqContracts: rfq.contracts, correlated: new Set(rfq.legs.map(([t]) => legMeta(t).game)).size < rfq.legs.length, makerCollateral: takerYes ? c * (1 - y) : c * y, takerCost: takerYes ? c * y : c * (1 - y), sports: [...new Set(rfq.legs.map(([t]) => legMeta(t).sport))].join('+'), verdicts: pr.verdicts });
  }
  // maker view: sells the side the taker buys. profit per contract = (takerYes ? y : 1-y) - (takerYes ? 1{win} : 1{lose})
  const makerEvModel = (r, F) => (r.takerYes ? r.y - F : F - r.y); // per contract
  const makerReal = (r) => (r.win === null ? null : r.takerYes ? r.y - (r.win ? 1 : 0) : (r.win ? 1 : 0) - r.y);
  const wouldWin = (r, F, m) => (r.takerYes ? F + m <= r.y : r.y <= F - m);
  const report = { generatedAt: new Date().toISOString(), margin, nRfqs: rfqs.size, nPriced: priced, nTradesRaw: trades.length, nTradesMatched: rows.length, nSettledMatched: rows.filter((r) => r.win !== null).length, fitClasses: Object.keys(fitData.classes ?? {}).length };
  report.rfqCostQuantiles = Object.fromEntries([0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((q) => [q, quantile(sizes, q)]));
  report.rfqLegCountMedian = median(legCounts); report.rfqCrossEvent = crossEvent;
  const capital = [25, 100, 300];
  report.makerCollateral = { median: median(rows.map((r) => r.makerCollateral)), p90: quantile(rows.map((r) => r.makerCollateral), 0.9), fitIn: Object.fromEntries(capital.map((k) => [k, rows.filter((r) => r.makerCollateral <= k).length / (rows.length || 1)])) };
  report.takerCost = { median: median(rows.map((r) => r.takerCost)), p90: quantile(rows.map((r) => r.takerCost), 0.9) };
  report.bySensitivity = {};
  for (const s of scales) {
    const win = rows.filter((r) => wouldWin(r, r.fair[s], margin));
    const settled = win.filter((r) => r.win !== null);
    const evPerCollateral = (rs, fn) => { const num = rs.reduce((a, r) => a + fn(r) * r.c, 0); const den = rs.reduce((a, r) => a + r.makerCollateral, 0); return den ? num / den : null; };
    report.bySensitivity[s] = {
      wouldWin: win.length, wouldWinFrac: win.length / (rows.length || 1),
      modelEvPerContract: mean(win.map((r) => makerEvModel(r, r.fair[s]))),
      modelEvPerCollateral: evPerCollateral(win, (r) => makerEvModel(r, r.fair[s])),
      allTradesModelEvPerCollateral: evPerCollateral(rows, (r) => makerEvModel(r, r.fair[s])),
      settledWin: settled.length,
      realisedEvPerCollateral: settled.length ? evPerCollateral(settled, makerReal) : null,
    };
  }
  const settledAll = rows.filter((r) => r.win !== null);
  const realised = (rs) => {
    // return on the maker's collateral per trade (collateral-weighted ratio estimator, delta-method CI, clustered by combo ticker)
    const byT = new Map(); for (const r of rs) { const g = byT.get(r.ticker) ?? byT.set(r.ticker, { pnl: 0, col: 0 }).get(r.ticker); g.pnl += makerReal(r) * r.c; g.col += r.makerCollateral; }
    const g = [...byT.values()]; const P = g.reduce((a, x) => a + x.pnl, 0); const C = g.reduce((a, x) => a + x.col, 0); if (!C) return { n: rs.length, clusters: g.length, mean: null };
    const R = P / C; const resid = g.map((x) => x.pnl - R * x.col); const v = resid.reduce((a, x) => a + x * x, 0) * g.length / Math.max(1, g.length - 1) / (C * C);
    return { n: rs.length, clusters: g.length, collateral: C, pnl: P, evPerCollateral: R, ci95: [R - 1.96 * Math.sqrt(v), R + 1.96 * Math.sqrt(v)] };
  };
  report.realisedAllTrades = realised(settledAll);
  const w1 = settledAll.filter((r) => wouldWin(r, r.fair[1], margin));
  report.realisedWouldWinFit = realised(w1);
  report.realisedWouldWinIndependent = realised(settledAll.filter((r) => wouldWin(r, r.fair[0], margin)));
  report.byCorrelated = { correlated: rows.filter((r) => r.correlated).length, independent: rows.filter((r) => !r.correlated).length };
  report.takerSideYesFrac = mean(rows.map((r) => (r.takerYes ? 1 : 0)));
  report.medianTakerPrice = median(rows.map((r) => r.y));
  // calibration of fair vs outcomes over ALL settled RFQ combos (no trade needed)
  const cal = []; for (const r of rfqs.values()) { const pr = price(r); if (!pr) continue; const o = outcomeOf(r.ticker, r); if (o === null) continue; cal.push({ f: pr.fairAt(1).fair, fi: pr.fairAt(0).fair, o: o ? 1 : 0 }); }
  const brier = (k) => mean(cal.map((c) => (c[k] - c.o) ** 2));
  report.calibration = { nSettledRfqs: cal.length, meanFair: mean(cal.map((c) => c.f)), meanOutcome: mean(cal.map((c) => c.o)), brierFitted: brier('f'), brierIndependent: brier('fi') };
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, 'measure.json'), JSON.stringify({ report, sample: rows.slice(0, 50) }, null, 1));
  console.log(JSON.stringify(report, null, 1));
}
export { cliff, makers } from './combo-cliff.mjs';
