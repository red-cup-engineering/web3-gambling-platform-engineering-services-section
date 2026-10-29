import test from 'node:test';
import assert from 'node:assert/strict';
import { solveLP } from '../src/simplex.mjs';
import { assessFamily, gluingMargin, orderFee } from '../src/coherence.mjs';
import { buildLadder, ladderFamily, ladderGroups, stationDayFamily, windowUnionFamily, parseRainRule } from '../src/coherence-families.mjs';

const q = (bid, ask, size = 100) => ({ bids: bid ? [{ price: bid, size }] : [], asks: ask ? [{ price: ask, size }] : [] });
const mkt = (ticker, strike_type, floor_strike, cap_strike, bid, ask) => ({ ticker, strike_type, floor_strike, cap_strike, yes_bid_dollars: bid, yes_ask_dollars: ask, yes_bid_size_fp: '100', yes_ask_size_fp: '100' });
const event = (markets) => ({ event_ticker: 'KXHIGHX-26OCT04', series_ticker: 'KXHIGHX', markets });
const ladder = (ms) => { const ev = event(ms); const [[s, g]] = ladderGroups(ev); return buildLadder(ev, s, g, { fee_multiplier: 1 }); };

test('simplex solves a small LP and detects infeasibility', () => {
  const r = solveLP({ c: [3, 2], rows: [{ a: [1, 1], op: '<=', b: 4 }, { a: [1, 3], op: '<=', b: 6 }] });
  assert.equal(r.status, 'optimal'); assert.ok(Math.abs(r.objective - 12) < 1e-9);
  assert.equal(solveLP({ c: [1], rows: [{ a: [1], op: '>=', b: 5 }, { a: [1], op: '<=', b: 3 }] }).status, 'infeasible');
});

test('Kalshi fee rounds up to the cent per order', () => {
  assert.equal(orderFee(0.07, 100, 0.5), 1.75);
  assert.equal(orderFee(0.07, 1, 0.5), 0.02);
});

test('bracket ladder whose asks sum below one is a Dutch book; wider asks glue', () => {
  const ms = [mkt('KXHIGHX-26OCT04-T60', 'less', null, 60, '0.20', '0.22'), mkt('KXHIGHX-26OCT04-B61.5', 'between', 60, 61, '0.30', '0.32'), mkt('KXHIGHX-26OCT04-T61', 'greater', 61, null, '0.30', '0.32')];
  const a = assessFamily(ladderFamily(ladder(ms)));
  assert.equal(a.verdict, 'dutch-book'); assert.ok(a.unitProfitBeforeFees > 0.1);
  assert.ok(a.portfolio && a.portfolio.guaranteed > 0 && a.portfolio.worstPayout >= a.portfolio.cost + a.portfolio.fees);
  const wide = [ms[0], mkt('KXHIGHX-26OCT04-B61.5', 'between', 60, 61, '0.30', '0.40'), mkt('KXHIGHX-26OCT04-T61', 'greater', 61, null, '0.30', '0.42')];
  assert.notEqual(assessFamily(ladderFamily(ladder(wide))).verdict, 'dutch-book');
});

test('cumulative >=X prices must be monotone', () => {
  const a = assessFamily(ladderFamily(ladder([mkt('KXHIGHX-26OCT04-T70', 'greater', 70, null, '0.60', '0.62'), mkt('KXHIGHX-26OCT04-T75', 'greater', 75, null, '0.70', '0.72')])));
  assert.equal(a.verdict, 'dutch-book');
});

test('per-team spread markets with equal thresholds are not one ladder', () => {
  const ev = { event_ticker: 'KXNCAAFSPREAD-26OCT03EWUUCD', series_ticker: 'KXNCAAFSPREAD', markets: [mkt('KXNCAAFSPREAD-26OCT03EWUUCD-UCD3', 'greater', 3.5, null, '0.5', '0.6'), mkt('KXNCAAFSPREAD-26OCT03EWUUCD-EWU3', 'greater', 3.5, null, '0.5', '0.6')] };
  assert.equal(ladderGroups(ev).length, 0);
});

test('station-day: the high cannot be below the low', () => {
  const lo = buildLadder({ event_ticker: 'KXLOWTX-26OCT04', series_ticker: 'KXLOWTX', markets: [] }, '', [mkt('L-a', 'greater', 70, null, '0.20', '0.22'), mkt('L-b', 'less', null, 71, '0.76', '0.79')], { fee_multiplier: 1 });
  const hiOk = buildLadder({ event_ticker: 'KXHIGHX-26OCT04', series_ticker: 'KXHIGHX', markets: [] }, '', [mkt('H-a', 'less', null, 60, '0.50', '0.52'), mkt('H-b', 'greater', 59, null, '0.46', '0.48')], { fee_multiplier: 1 });
  const hiBad = buildLadder({ event_ticker: 'KXHIGHX-26OCT04', series_ticker: 'KXHIGHX', markets: [] }, '', [mkt('H-c', 'less', null, 70, '0.90', '0.92'), mkt('H-d', 'greater', 69, null, '0.05', '0.08')], { fee_multiplier: 1 });
  assert.notEqual(assessFamily(stationDayFamily(hiOk, lo)).verdict, 'dutch-book');
  assert.equal(assessFamily(stationDayFamily(hiBad, lo)).verdict, 'dutch-book');
});

test('window union: weekend rain >= each day, <= their sum', () => {
  const w = { id: 'W', venue: 'kalshi', theta: 0.07, ...q(0.4, 0.42) };
  const d1 = { id: 'D1', venue: 'kalshi', theta: 0.07, ...q(0.7, 0.72) };
  const d2 = { id: 'D2', venue: 'kalshi', theta: 0.07, ...q(0.1, 0.12) };
  assert.equal(assessFamily(windowUnionFamily(w, [d1, d2], 'w')).verdict, 'dutch-book');
  assert.notEqual(assessFamily(windowUnionFamily({ ...w, ...q(0.74, 0.76) }, [d1, d2], 'w')).verdict, 'dutch-book');
});

test('rain rule parser reads days and windows', () => {
  assert.deepEqual(parseRainRule('If the total precipitation at CLINYC in New York City on any day within October 3, 2026 through October 4, 2026 is strictly greater than 0 inches, then'), { station: 'CLINYC', kind: 'window', from: '2026-10-03', to: '2026-10-04' });
  assert.deepEqual(parseRainRule('If the total precipitation at CLINYC in New York City in Oct 4, 2026 is strictly greater than 0 inches, then'), { station: 'CLINYC', kind: 'day', date: '2026-10-04' });
});

test('gluing margin is positive for a coherent ladder', () => {
  assert.ok(gluingMargin(ladderFamily(ladder([mkt('KXHIGHX-26OCT04-T60', 'less', null, 60, '0.20', '0.30'), mkt('KXHIGHX-26OCT04-T59', 'greater', 59, null, '0.70', '0.80')]))) > 0);
});
