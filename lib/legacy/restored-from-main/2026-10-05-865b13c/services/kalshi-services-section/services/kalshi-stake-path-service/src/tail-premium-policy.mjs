/**
 * The weather desk's one strategy, as pure functions: sell the overpriced
 * far tails of Kalshi's daily temperature brackets.
 *
 * Kalshi's mid is well calibrated across most of the range and the house's
 * NBM model adds nothing to it there (backtest 2026-08-05..10-02), but the
 * cheapest brackets trade above their frequency: brackets asked at 5c or
 * less that the fat-tailed model put at 1% or less settled yes on none of
 * 422 high-temperature markets. So the desk only ever sells YES (holds NO)
 * on a bracket the model certifies as a far tail, resting a post-only order
 * at or just inside the best competing ask, never taking. Each NO risks its
 * cost to earn the premium. The stake is the founder's walled-off,
 * re-seedable risk capital and a Kalshi contract cannot owe beyond its cost,
 * so each certified tail is sized at full Kelly (the house's kellyFraction)
 * on a conservative loss rate, and the cycle's bets on one settlement date
 * are scaled together into that date's share of the lane's capital.
 *
 * Money is handled in whole cents and whole contracts so no fill carries a
 * rounding fee.
 */

import { kellyFraction } from '@red-cup-engineering/position-sizing-service';

const cents = (dollars) => Math.round(Number(dollars) * 100);
const dollarsOf = (c) => c / 100;

/**
 * The book a resting order of ours sees: best YES bid, and the best YES ask
 * offered by others (our own sells, NO bids at 1 - price, are removed first).
 * @param {{yes_dollars?: [string,string][], no_dollars?: [string,string][]}} orderbook Kalshi's fixed-point book: bid ladders on each leg.
 * @param {{priceCents: number, count: number}[]} ownAsks our resting YES sells on this market.
 * @returns {{bestBidCents: number, bestAskCents: number|null}}
 */
export function competingBook(orderbook, ownAsks = []) {
  const own = new Map();
  for (const order of ownAsks) own.set(100 - order.priceCents, (own.get(100 - order.priceCents) ?? 0) + order.count);
  const yesBids = (orderbook?.yes_dollars ?? []).map(([p, q]) => [cents(p), Number(q)]).filter(([, q]) => q > 0);
  const noBids = (orderbook?.no_dollars ?? []).map(([p, q]) => [cents(p), Number(q) - (own.get(cents(p)) ?? 0)]).filter(([, q]) => q > 0.005);
  const bestBidCents = yesBids.reduce((best, [p]) => Math.max(best, p), 0);
  const bestNoBid = noBids.reduce((best, [p]) => Math.max(best, p), 0);
  return { bestBidCents, bestAskCents: bestNoBid > 0 ? 100 - bestNoBid : null };
}

/**
 * Where the desk would rest its sell: one cent inside the competing ask when
 * the spread leaves room, else joining it; never at or below the bid.
 * @returns {number|null} cents
 */
export function restingAskCents({ bestBidCents, bestAskCents }) {
  if (bestAskCents === null) return null;
  const price = bestAskCents - bestBidCents >= 2 ? bestAskCents - 1 : bestAskCents;
  return price > bestBidCents ? price : null;
}

/**
 * Whether a priced bracket is a certified far tail at `priceCents`, and why not.
 * @param {{probability: number, kind: "high"|"low"}} priced
 * @param {number|null} priceCents
 * @param {object} certification the policy's certification block.
 */
export function certifyTail(priced, priceCents, certification) {
  if (priceCents === null) return { ok: false, reason: 'no competing ask to rest beside' };
  const price = priceCents / 100;
  const maxP = certification.maxModelProbability[priced.kind];
  if (!(priced.probability <= maxP)) return { ok: false, reason: `model p ${priced.probability.toFixed(4)} above ${maxP}` };
  if (price < certification.minYesPrice) return { ok: false, reason: `premium ${price.toFixed(2)} below ${certification.minYesPrice}` };
  if (price > certification.maxYesPrice) return { ok: false, reason: `ask ${price.toFixed(2)} above ${certification.maxYesPrice}` };
  if (price - priced.probability < certification.minEdge) return { ok: false, reason: `edge ${(price - priced.probability).toFixed(4)} below ${certification.minEdge}` };
  return { ok: true, edge: price - priced.probability };
}

/**
 * The side of the forecast a bracket lies on: `warm` when it starts above the model's mean, `cold` when
 * it ends below it, null when it straddles the mean (and so is no far tail).
 * @param {{floorStrike?: number|null, capStrike?: number|null}} market
 * @param {number} mean
 */
export function tailSide({ floorStrike, capStrike }, mean) {
  if (Number.isFinite(floorStrike) && floorStrike > mean) return 'warm';
  if (Number.isFinite(capStrike) && capStrike < mean) return 'cold';
  return null;
}

/**
 * A tail is not certified while NWS has a hazard active at its station on the tail's own side: the error
 * model was fitted on ordinary days, and those are the days a tail's outcomes move together.
 * @param {'warm'|'cold'|null} side
 * @param {{warm: string[], cold: string[]}|null|undefined} hazards null when they could not be read.
 */
export function regimeVerdict(side, hazards) {
  if (hazards === null || hazards === undefined) return { ok: false, reason: 'NWS hazards unread at the station' };
  const active = side === 'warm' ? hazards.warm : side === 'cold' ? hazards.cold : [];
  if (active.length > 0) return { ok: false, reason: `${side} tail under ${active.join(', ')}` };
  return { ok: true };
}

/** Whether `now` is inside the policy's opening window for an event of this kind and date in the station's zone. */
export function inOpeningWindow({ kind, targetDate, timeZone }, windows, now = Date.now()) {
  const local = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  const today = `${local.year}-${local.month}-${local.day}`;
  const minutes = Number(local.hour) * 60 + Number(local.minute);
  const at = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const dayBefore = new Date(Date.parse(`${targetDate}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  const window = windows[kind];
  if (today === dayBefore) return minutes >= at(window.dayBeforeFrom) && (window.dayBeforeUntil === undefined || minutes < at(window.dayBeforeUntil));
  if (today === targetDate) return window.sameDayUntil !== undefined && minutes < at(window.sameDayUntil);
  return false;
}

/**
 * The desk's exposure, in cents, from the venue's own records: each NO
 * position's cost and each resting sell's collateral, by market, event and
 * settlement date.
 * @param {{positions: {ticker: string, eventTicker: string, targetDate: string, costCents: number}[], resting: {ticker: string, eventTicker: string, targetDate: string, priceCents: number, count: number}[]}} book
 */
export function exposure({ positions, resting }) {
  const byMarket = new Map(), byEvent = new Map(), byDate = new Map();
  let total = 0;
  const add = (row, c) => {
    byMarket.set(row.ticker, (byMarket.get(row.ticker) ?? 0) + c);
    byEvent.set(row.eventTicker, (byEvent.get(row.eventTicker) ?? 0) + c);
    byDate.set(row.targetDate, (byDate.get(row.targetDate) ?? 0) + c);
    total += c;
  };
  for (const row of positions) add(row, row.costCents);
  for (const row of resting) add(row, (100 - row.priceCents) * row.count);
  return { byMarket, byEvent, byDate, total };
}

/**
 * The full-Kelly stake, as a fraction of capital, for selling YES at
 * `priceCents` when the bracket settles yes with probability `lossRate`:
 * the NO costs 100 - price and earns price.
 */
export function tailKellyFraction(priceCents, lossRate, kellyMultiple = 1) {
  const f = kellyFraction({ winProbability: 1 - lossRate, payoffRatio: priceCents / (100 - priceCents) });
  return Math.max(0, f * kellyMultiple);
}

/**
 * One cycle's plan: which resting sells to cancel, which to place, and why
 * each candidate was passed over. Every candidate carries its venue book,
 * the house's price for it, and whether its opening window is open.
 * @param {{candidates: object[], positions: object[], resting: object[], cashCents: number, equityCents: number, policy: object, lane?: string, now?: number}} input
 * @returns {{cancels: object[], places: object[], skips: object[], capitalCents: number}}
 */
export function planCycle({ candidates, positions, resting, cashCents, equityCents, policy, lane = 'weather-tail-premium', now = Date.now() }) {
  const { certification, limits, sizing } = policy;
  const capital = Math.floor(equityCents * (policy.lanes?.[lane]?.fraction ?? 0));
  const plans = new Map();
  for (const candidate of candidates) {
    const ownAsks = resting.filter((order) => order.ticker === candidate.ticker);
    const book = competingBook(candidate.orderbook, ownAsks);
    const priceCents = restingAskCents(book);
    let verdict;
    if (!candidate.priced?.priced) verdict = { ok: false, reason: candidate.priced?.reason ?? 'not priced' };
    else if (!candidate.inWindow) verdict = { ok: false, reason: 'outside the opening window' };
    else {
      const regime = regimeVerdict(candidate.side, candidate.hazards);
      verdict = regime.ok ? certifyTail(candidate.priced, priceCents, certification) : regime;
    }
    plans.set(candidate.ticker, { candidate, book, priceCents, verdict });
  }

  // Resting sells that no longer match the plan are withdrawn, and stop counting.
  const cancels = [];
  const kept = [];
  for (const order of resting) {
    const plan = plans.get(order.ticker);
    const lapsing = order.expiration && Date.parse(order.expiration) - now < (policy.orders?.refreshWithinMinutes ?? 0) * 60_000;
    if (!plan || !plan.verdict.ok || plan.priceCents !== order.priceCents || lapsing) cancels.push({ ...order, reason: !plan ? 'market no longer a candidate' : !plan.verdict.ok ? plan.verdict.reason : plan.priceCents !== order.priceCents ? `reprice ${order.priceCents}c -> ${plan.priceCents}c` : 'refresh before expiry' });
    else kept.push(order);
  }

  const used = exposure({ positions, resting: kept });
  const skips = [];
  // Each certified tail's full-Kelly stake beyond what it already holds.
  const wants = [];
  for (const { candidate, priceCents, verdict } of plans.values()) {
    if (!verdict.ok) { skips.push({ ticker: candidate.ticker, reason: verdict.reason }); continue; }
    const lossRate = Math.max(candidate.priced.probability, sizing.lossRateFloor[candidate.priced.kind]);
    const fraction = tailKellyFraction(priceCents, lossRate, sizing.kellyMultiple);
    const want = Math.floor(fraction * capital) - (used.byMarket.get(candidate.ticker) ?? 0);
    if (fraction <= 0) { skips.push({ ticker: candidate.ticker, reason: `no Kelly edge at loss rate ${lossRate}` }); continue; }
    if (want < 100 - priceCents) { skips.push({ ticker: candidate.ticker, reason: 'already holds its Kelly stake' }); continue; }
    wants.push({ candidate, priceCents, verdict, lossRate, fraction, want });
  }
  // Simultaneous bets on one settlement date share that date's budget in proportion to their stakes.
  const byDate = new Map();
  for (const want of wants) byDate.set(want.candidate.targetDate, [...(byDate.get(want.candidate.targetDate) ?? []), want]);
  for (const [date, group] of byDate) {
    const budget = Math.floor(limits.perSettlementDateFraction * capital) - (used.byDate.get(date) ?? 0);
    const total = group.reduce((sum, row) => sum + row.want, 0);
    const scale = total > 0 ? Math.max(0, Math.min(1, budget / total)) : 0;
    for (const row of group) row.want = Math.floor(row.want * scale);
  }

  // Kalshi's balance still counts cash that resting sells will take if they fill.
  let cashLeft = cashCents - cents(limits.minCashUsd) - kept.reduce((sum, order) => sum + (100 - order.priceCents) * order.count, 0);
  const places = [];
  for (const { candidate, priceCents, verdict, lossRate, fraction, want } of wants.sort((a, b) => b.verdict.edge - a.verdict.edge)) {
    const risk = 100 - priceCents;
    const room = Math.min(
      want,
      Math.floor(limits.perEventFraction * capital) - (used.byEvent.get(candidate.eventTicker) ?? 0),
      Math.floor(limits.maxOpenFraction * capital) - used.total,
      cashLeft,
    );
    const count = Math.floor(room / risk);
    if (count < 1) { skips.push({ ticker: candidate.ticker, reason: `no room under the limits (${room}c for ${risk}c a contract)` }); continue; }
    const order = { ticker: candidate.ticker, eventTicker: candidate.eventTicker, targetDate: candidate.targetDate, seriesTicker: candidate.seriesTicker, priceCents, count, riskCents: risk * count, edge: verdict.edge, probability: candidate.priced.probability, lossRate, kellyFraction: fraction };
    places.push(order);
    for (const [map, key] of [[used.byMarket, order.ticker], [used.byEvent, order.eventTicker], [used.byDate, order.targetDate]]) map.set(key, (map.get(key) ?? 0) + order.riskCents);
    used.total += order.riskCents;
    cashLeft -= order.riskCents;
  }
  return { cancels, places, skips, capitalCents: capital };
}

/**
 * Whether the desk must halt: equity under its floor, or more far-tail
 * losses in thirty days than the policy allows (either says the certification
 * is wrong, not unlucky).
 * @param {{equityCents: number, tailLosses30d: number, policy: object}} input
 */
export function haltReason({ equityCents, tailLosses30d, policy }) {
  if (equityCents < cents(policy.halts.equityFloorUsd)) return `equity $${dollarsOf(equityCents).toFixed(2)} under the $${policy.halts.equityFloorUsd} floor`;
  if (tailLosses30d >= policy.halts.maxTailLossesIn30Days) return `${tailLosses30d} certified tails settled yes in 30 days`;
  return null;
}
