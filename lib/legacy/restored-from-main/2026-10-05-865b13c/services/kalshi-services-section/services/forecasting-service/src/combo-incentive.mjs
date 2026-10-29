/**
 * Kalshi Sports Prop Combo component-leg liquidity incentive (the "CLIFF" program), pure.
 *
 * Rules (help.kalshi.com article 17184676, program filed 2026-09-02, runs to 2027-01-01):
 *   pool_c   = CLIFF * fees_c * (eligible components / components)          CLIFF = 0.25
 *   S_L      = prod_i (1 + F_Li) - 1        F_Li = L's share of maker volume in eligible component outcome i
 *   payout_L = pool_c * S_L / sum_{J : S_J >= 0.01} S_J                    paid monthly as bonus credits
 * Combo fees (series fee_type 'quadratic_with_combo_maker_fees', since 2026-08-20): the taker pays
 * 0.07*C*P*(1-P) and the maker half that, except uncorrelated NFL parlays, which carry no maker fee.
 *
 * The denominator is the market's unobserved maker structure, so the marginal rebate is an interval:
 * for an entrant with small shares, dS/dv_i = 1/V_i, and over all share matrices whose columns sum to 1
 *   n  <=  sum_J S_J  <=  2^n - 1
 * (lower: prod(1+F)-1 >= sum F; upper: one maker owns every leg). K symmetric makers on every leg give
 * K((1+1/K)^n - 1), the point estimate used when K is supplied.
 */

import { legMeta } from './combo-pricer.mjs';

export const CLIFF = 0.25;
export const MIN_SCORE = 0.01;
export const COMBO_TAKER_RATE = 0.07;
export const COMBO_MAKER_RATE = 0.035;

/** A leg is an eligible component when it is a sports market that is not a winner, spread, total or BTTS. */
export function isSportsProp(ticker) {
  const m = legMeta(ticker);
  return m.role === 'P' && SPORT_SERIES.test(m.series);
}
const SPORT_SERIES = /^KX(?:NFL|NCAAF|NCAAB|NBA|WNBA|MLB|NHL|EPL|UEFA|LALIGA|LIGUE1|BUNDESLIGA|SERIEA|MLS|USL|ATP|WTA|UFC|CS2|LOL|PGA|F1|NASCAR|BOXING|CRICKET|CHESS|INTLFRIENDLY)/u;

/** Uncorrelated NFL parlay: every leg an NFL market and no two legs share a game. */
export function isUncorrelatedNfl(legTickers) {
  const metas = legTickers.map((t) => legMeta(t));
  return metas.every((m) => m.sport === 'NFL') && new Set(metas.map((m) => m.game)).size === metas.length;
}

/** Fees on one combo print of `count` contracts at yes price `p`. */
export function comboPrintFees(p, count, legTickers) {
  const q = count * p * (1 - p);
  const taker = COMBO_TAKER_RATE * q;
  const maker = isUncorrelatedNfl(legTickers) ? 0 : COMBO_MAKER_RATE * q;
  return { taker, maker, total: taker + maker };
}

/** The incentive pool a combo's fees fund, and the eligible components it is split over. */
export function comboPool(totalFees, legTickers) {
  const eligible = legTickers.filter(isSportsProp);
  return { pool: CLIFF * totalFees * (eligible.length / (legTickers.length || 1)), eligible };
}

/** Score of one participant from its maker-volume shares in each eligible component outcome. */
export const score = (shares) => shares.reduce((a, f) => a * (1 + f), 1) - 1;

/** Bounds on sum_J S_J for n eligible components; `makers` gives the symmetric-K point. */
export function denominatorBounds(n, makers = null) {
  const out = { lo: n, hi: 2 ** n - 1 };
  if (makers) out.point = makers * ((1 + 1 / makers) ** n - 1);
  return out;
}

/**
 * Payouts for an explicit share matrix shares[participant][component] (columns sum to 1):
 * participants under MIN_SCORE are dropped from the denominator and paid nothing.
 */
export function payouts(pool, shares) {
  const s = shares.map(score);
  const den = s.reduce((a, x) => a + (x >= MIN_SCORE ? x : 0), 0);
  return s.map((x) => (x >= MIN_SCORE && den > 0 ? (pool * x) / den : 0));
}
