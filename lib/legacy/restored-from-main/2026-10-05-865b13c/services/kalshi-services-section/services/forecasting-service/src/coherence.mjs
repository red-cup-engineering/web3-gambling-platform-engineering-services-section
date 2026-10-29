/**
 * The coherence engine's core: gluing of local price intervals into one global
 * probability distribution, and the Dutch book when they do not glue.
 *
 * Vocabulary (the house's, see forecasting-service README "Entanglement"):
 *  - a market's live bid/ask is a LOCAL SECTION over its bracket: a closed interval
 *    [bid, ask] of admissible probabilities. In SignCell terms the bid is the
 *    support charge for "yes" and (1 - ask) the support charge for "no"; a well
 *    formed quote has support + refutation <= 1 (a gap, the bilattice's bottom side) and
 *    sections that cannot be glued carry both charges at once (the "both" corner: a
 *    contradiction, here a Dutch book).
 *  - a FAMILY is an overlap cover: markets whose events share an outcome space (cells),
 *    with linear relations among cell probabilities (normalisation blocks sum to 1;
 *    coupling rows are pointwise-valid inequalities such as P(weekend rain) >= P(Saturday rain)).
 *  - GLUING: a global section is a nonnegative q over the cells satisfying the block and
 *    coupling relations and lying inside every local interval. The margin LP finds the
 *    deepest such q; margin < 0 means the sections do not glue.
 *  - DUTCH BOOK: by LP duality (Farkas) the gluing failure is witnessed by a portfolio of
 *    takes (buy YES at ask / buy NO at 1 - bid) whose payoff in every joint outcome exceeds
 *    its cost. Solved directly, net of the taker fee, limited by displayed size.
 *
 * A family is plain data:
 *   { id, kind, nCells, blocks: number[][], couplings: [number, number][][],
 *     markets: [{ id, venue, cells, bids: [{price,size}], asks: [{price,size}], theta }] }
 * Prices are dollars on the YES side; `asks` ascending, `bids` descending.
 */
import { solveLP } from './simplex.mjs';

export const KALSHI_THETA = 0.07;
export const unitFee = (theta, p) => theta * p * (1 - p);
/** Kalshi's per-order taker fee: theta * C * P * (1 - P), rounded up to the cent. */
export const orderFee = (theta, count, price) => Math.ceil(theta * count * price * (1 - price) * 100 - 1e-9) / 100;

const EPS = 1e-9;

/** Legs a taker could open: buy YES at each ask level, buy NO (sell YES) at each bid level. */
export function takeLegs(family, { fees = true, capUnit = false } = {}) {
  const legs = [];
  family.markets.forEach((m, mi) => {
    for (const a of m.asks ?? []) {
      if (!(a.price < 1 - EPS) || !(a.size > 0)) continue;
      legs.push({ market: mi, side: 'yes', price: a.price, size: capUnit ? 1 : a.size, fee: fees ? unitFee(m.theta ?? KALSHI_THETA, a.price) : 0 });
    }
    for (const b of m.bids ?? []) {
      if (!(b.price > EPS) || !(b.size > 0)) continue;
      legs.push({ market: mi, side: 'no', price: 1 - b.price, size: capUnit ? 1 : b.size, fee: fees ? unitFee(m.theta ?? KALSHI_THETA, 1 - b.price) : 0 });
    }
  });
  return legs;
}

/**
 * The take LP: maximise guaranteed profit = (min over feasible joint distributions of the
 * portfolio's expected payoff, via the dual of the inner minimisation) + constants - cost - fees.
 */
export function solveDutchBook(family, options = {}) {
  const legs = takeLegs(family, options);
  const member = family.markets.map((m) => new Set(m.cells));
  const nb = family.blocks.length;
  const nc = family.couplings.length;
  const L = legs.length;
  const zp = (n) => L + n;
  const zm = (n) => L + nb + n;
  const mu = (k) => L + 2 * nb + k;
  const nVar = L + 2 * nb + nc;
  const c = new Array(nVar).fill(0);
  // yes leg: -ask - fee. no leg (buy NO at 1-bid): payout constant +1 minus price => bid - fee.
  legs.forEach((leg, i) => { c[i] = leg.side === 'yes' ? -leg.price - leg.fee : (1 - leg.price) - leg.fee; });
  for (let n = 0; n < nb; n += 1) { c[zp(n)] = 1; c[zm(n)] = -1; }
  const rows = [];
  const blockOf = new Int32Array(family.nCells).fill(-1);
  family.blocks.forEach((cells, n) => cells.forEach((j) => { blockOf[j] = n; }));
  for (let j = 0; j < family.nCells; j += 1) {
    const a = [];
    if (blockOf[j] >= 0) a.push([zp(blockOf[j]), 1], [zm(blockOf[j]), -1]);
    family.couplings.forEach((row, k) => { for (const [cell, v] of row) if (cell === j) a.push([mu(k), v]); });
    legs.forEach((leg, i) => { if (member[leg.market].has(j)) a.push([i, leg.side === 'yes' ? -1 : 1]); });
    rows.push({ a, op: '<=', b: 0 });
  }
  legs.forEach((leg, i) => rows.push({ a: [[i, 1]], op: '<=', b: leg.size }));
  const res = solveLP({ c, rows });
  if (res.status !== 'optimal') return { status: res.status, profit: 0, legs: [] };
  const chosen = [];
  legs.forEach((leg, i) => { if (res.x[i] > 1e-7) chosen.push({ leg, qty: res.x[i] }); });
  return { status: 'optimal', profit: res.objective, legs: chosen };
}

/** Minimum over feasible joint distributions of a payoff vector u (per cell). */
export function minPayoff(family, u) {
  const rows = [];
  family.blocks.forEach((cells) => rows.push({ a: cells.map((j) => [j, 1]), op: '=', b: 1 }));
  family.couplings.forEach((row) => rows.push({ a: row, op: '>=', b: 0 }));
  const res = solveLP({ c: u.map((v) => -v), rows });
  return res.status === 'optimal' ? -res.objective : -Infinity;
}

/** Exact accounting of an integer portfolio: whole contracts, per-order fee rounded up, worst-outcome payoff. */
export function evaluatePortfolio(family, picked) {
  const u = new Array(family.nCells).fill(0);
  let constant = 0; let cost = 0; let fees = 0;
  const out = [];
  for (const { leg, qty } of picked) {
    const q = Math.floor(qty + 1e-6);
    if (q <= 0) continue;
    const m = family.markets[leg.market];
    const fee = orderFee(m.theta ?? KALSHI_THETA, q, leg.price);
    cost += q * leg.price; fees += fee;
    if (leg.side === 'yes') { for (const j of m.cells) u[j] += q; }
    else { constant += q; for (const j of m.cells) u[j] -= q; }
    out.push({ ticker: m.id, venue: m.venue, side: leg.side, qty: q, price: Number(leg.price.toFixed(4)), fee });
  }
  const worst = minPayoff(family, u) + constant;
  return { legs: out, cost, fees, worstPayout: worst, guaranteed: worst - cost - fees, maxLoss: out.length ? Math.max(0, cost + fees - worst) : 0 };
}

/** Gluing margin: largest e such that some global section lies in every interval shrunk by e. e < 0: no gluing. */
export function gluingMargin(family) {
  const nq = family.nCells; const ep = nq; const em = nq + 1;
  const c = new Array(nq + 2).fill(0);
  c[ep] = 1; c[em] = -1;
  const rows = [];
  family.blocks.forEach((cells) => rows.push({ a: cells.map((j) => [j, 1]), op: '=', b: 1 }));
  family.couplings.forEach((row) => rows.push({ a: row, op: '>=', b: 0 }));
  for (const m of family.markets) {
    const bid = m.bids?.[0]?.price; const ask = m.asks?.[0]?.price;
    if (bid !== undefined && bid > EPS && m.bids[0].size > 0) rows.push({ a: [...m.cells.map((j) => [j, 1]), [ep, -1], [em, 1]], op: '>=', b: bid });
    if (ask !== undefined && ask < 1 - EPS && m.asks[0].size > 0) rows.push({ a: [...m.cells.map((j) => [j, 1]), [ep, 1], [em, -1]], op: '<=', b: ask });
  }
  rows.push({ a: [[ep, 1]], op: '<=', b: 1 }, { a: [[em, 1]], op: '<=', b: 1 });
  const res = solveLP({ c, rows });
  return res.status === 'optimal' ? res.objective : null;
}

/** Tension: feasible, but the deepest global section leaves less than this much slack (dollars). */
export const TENSION = 0.0025;

/** Verdict for one family: glued | tension | dutch-book (with fee- and depth-aware portfolio) | unsolved. */
export function assessFamily(family) {
  const margin = gluingMargin(family);
  if (margin === null) return { family: family.id, kind: family.kind, margin: null, verdict: 'unsolved' };
  if (margin >= -EPS) return { family: family.id, kind: family.kind, margin, verdict: margin < TENSION ? 'tension' : 'glued' };
  const raw = solveDutchBook(family, { fees: false, capUnit: true });
  const net = solveDutchBook(family, { fees: true });
  const book = net.legs.length ? evaluatePortfolio(family, net.legs) : null;
  return {
    family: family.id, kind: family.kind, margin, verdict: 'dutch-book',
    unitProfitBeforeFees: raw.profit, lpProfitAfterFees: net.profit,
    portfolio: book && book.guaranteed > 0.005 ? book : null,
    portfolioRaw: book,
  };
}
