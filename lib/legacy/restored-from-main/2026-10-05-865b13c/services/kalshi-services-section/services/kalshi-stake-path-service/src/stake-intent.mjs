/**
 * The Kalshi stake intent: the three-ways note's rule as an algebra --
 * "a stake exists only when three records agree: the forecast recorded
 * before the stake with its falsifier; the calibration on the reference
 * class over at least thirty resolved forecasts showing expected edge
 * after fee and spread; a Kelly fraction from that calibration capped at
 * a fixed fraction of the sleeve. No record, no stake." Pure functions
 * only; reading the forecasting journal is `scripts/derive-stake-intent.mjs`'s
 * concern.
 */

export const STAKE_INTENT_TYPE = "KalshiStakeIntent";

/** The three-ways note's own reference-class gate: at least this many resolved (scored) house-forecast rows before a calibration record counts. */
export const DEFAULT_MIN_RESOLVED_FORECASTS = 30;

/** The doctrine's fixed cap on the Kelly fraction as a fraction of the sleeve, applied on top of sizePosition's own internal MAX_DEFENSIBLE_KELLY_MULTIPLE cap. */
export const DEFAULT_MAX_SLEEVE_FRACTION = 0.05;

/**
 * Builds a refused KalshiStakeIntent naming which of the three records
 * failed.
 * @param {{marketTicker: string, referenceClass: string, reason: string, derivedAt: string} & object} fields
 * @returns {Readonly<object>}
 */
export function refuseStakeIntent(fields) {
  return Object.freeze({
    type: STAKE_INTENT_TYPE,
    version: 1,
    admitted: false,
    questionId: null,
    forecastRecordId: null,
    marketForecastRecordId: null,
    calibrationRecordId: null,
    houseProbability: null,
    marketProbability: null,
    marketPrice: null,
    side: null,
    feeRate: null,
    resolvedCalibrationCount: null,
    minResolvedForecasts: null,
    houseBrier: null,
    marketBrier: null,
    expectedEdgeAfterFee: null,
    kellyFractionRaw: null,
    maxSleeveFraction: null,
    kellyFractionCapped: null,
    sleeveRequest: null,
    sleeveResult: null,
    contracts: null,
    stakeUsd: null,
    ...fields,
  });
}

/**
 * The fee-and-spread-adjusted expected edge for a discrete yes/no stake:
 * `winProbability / price - 1`, net of a declared `feeRate` (a configured
 * approximation, not Kalshi's published fee schedule -- the fee model this
 * package uses is a declared parameter until the org cites the venue's
 * actual schedule).
 * @param {{winProbability: number, price: number, feeRate: number}} input
 * @returns {{payoffRatio: number, grossEdge: number, netEdge: number}}
 */
export function expectedEdgeAfterFee({ winProbability, price, feeRate }) {
  if (typeof winProbability !== "number" || winProbability < 0 || winProbability > 1) throw new TypeError("stake-intent: winProbability must be in [0,1]");
  if (typeof price !== "number" || price <= 0 || price >= 1) throw new TypeError("stake-intent: price must be in the open interval (0,1)");
  if (typeof feeRate !== "number" || feeRate < 0) throw new TypeError("stake-intent: feeRate must be >= 0");
  const payoffRatio = (1 - price) / price;
  const grossEdge = winProbability / price - 1;
  const netEdge = grossEdge - feeRate;
  return { payoffRatio, grossEdge, netEdge };
}

/**
 * Applies the three-ways note's fixed sleeve-fraction cap on top of an
 * already-admitted `sizePosition` result.
 * @param {{admitted: true, fraction: number, stake: string}} sleeveResult
 * @param {number} maxSleeveFraction
 * @param {string} riskCapital exact decimal string.
 * @returns {{kellyFractionCapped: number, stakeUsd: string}}
 */
export function applyMaxSleeveFraction(sleeveResult, maxSleeveFraction, riskCapital) {
  if (!sleeveResult.admitted) throw new TypeError("stake-intent: applyMaxSleeveFraction requires an admitted sleeveResult");
  const kellyFractionCapped = Math.min(sleeveResult.fraction, maxSleeveFraction);
  const risk = Number(riskCapital);
  const stakeUsd = kellyFractionCapped === sleeveResult.fraction ? sleeveResult.stake : (kellyFractionCapped * risk).toFixed(2);
  return { kellyFractionCapped, stakeUsd };
}
