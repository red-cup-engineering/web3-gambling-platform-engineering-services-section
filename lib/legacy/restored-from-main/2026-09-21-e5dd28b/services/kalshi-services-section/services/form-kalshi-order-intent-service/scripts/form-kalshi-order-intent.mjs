#!/usr/bin/env node
// Pure transform: forecast + calibration record + market read + sleeve + fee
// schedule -> a bounded Kalshi order intent, or a refusal datum. No network
// I/O, no wall clock -- formedAt is an explicit caller-supplied input so the
// operation is deterministic and fixture-free.
import { kellyFraction } from "@red-cup-engineering/position-sizing-service";
import { runJavascriptNodeOperation } from "../../../../../../../../../../../../../computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/src/operation.mjs";

const DEFAULT_FEE_RATE = 0.07;
const DEFAULT_FEE_SOURCE = "https://kalshi.com/docs/kalshi-fee-schedule.pdf";

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`form-kalshi-order-intent: ${label} must be a JSON object`);
  }
  return value;
}

function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`form-kalshi-order-intent: ${label} must be a finite number`);
  }
  return value;
}

function requireUnitInterval(value, label) {
  const n = requireFiniteNumber(value, label);
  if (n < 0 || n > 1) throw new TypeError(`form-kalshi-order-intent: ${label} must lie in [0,1]`);
  return n;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`form-kalshi-order-intent: ${label} must be a non-empty string`);
  }
  return value;
}

const reject = (code, detail) => ({ type: "Reject", code, detail, venueWrite: false });

/**
 * Forms a bounded Kalshi order intent from a forecast, a reference-class calibration record, a current market read, a risk sleeve, and a fee schedule -- or refuses with a named datum when any gating condition fails.
 * @param {object} request A FormKalshiOrderIntentRequest.
 * @param {{questionId: string, probability: number}} request.forecast The org's own forecast for the market's question.
 * @param {null|{referenceClass: string, resolvedForecastCount: number, brierScore: number, marketImpliedBrierScore: number}} request.calibrationRecord The org's calibration on this forecast's reference class; null when none exists yet.
 * @param {{ticker: string, yesBid: number, yesAsk: number, noBid: number, noAsk: number}} request.marketRead A KalshiMarketRead (or the fields of one).
 * @param {{remainingUsd: number, maxFractionOfSleeve?: number}} request.sleeve The bounded risk sleeve; maxFractionOfSleeve defaults to 1 (full Kelly).
 * @param {{feeRate?: number, source?: string}} [request.feeSchedule] Kalshi's per-contract fee rate (default 0.07) and its published source.
 * @param {string} request.formedAt ISO 8601 timestamp this intent is formed at, supplied by the caller.
 * @returns {object} A KalshiOrderIntent, or a Reject datum with code one of no-calibration-record, calibration-insufficient, no-edge-after-fees, sleeve-exhausted.
 * @throws {TypeError} When the request or its required fields are malformed.
 */
export function formKalshiOrderIntent(request) {
  requireObject(request, "request");
  const forecast = requireObject(request.forecast, "request.forecast");
  requireNonEmptyString(forecast.questionId, "request.forecast.questionId");
  const forecastProbability = requireUnitInterval(forecast.probability, "request.forecast.probability");
  const marketRead = requireObject(request.marketRead, "request.marketRead");
  const yesBid = requireFiniteNumber(marketRead.yesBid, "request.marketRead.yesBid");
  const yesAsk = requireFiniteNumber(marketRead.yesAsk, "request.marketRead.yesAsk");
  const noAsk = requireFiniteNumber(marketRead.noAsk, "request.marketRead.noAsk");
  const sleeve = requireObject(request.sleeve, "request.sleeve");
  const remainingUsd = requireFiniteNumber(sleeve.remainingUsd, "request.sleeve.remainingUsd");
  const maxFractionOfSleeve = sleeve.maxFractionOfSleeve === undefined ? 1 : requireUnitInterval(sleeve.maxFractionOfSleeve, "request.sleeve.maxFractionOfSleeve");
  const feeRate = request.feeSchedule?.feeRate ?? DEFAULT_FEE_RATE;
  const feeSource = request.feeSchedule?.source ?? DEFAULT_FEE_SOURCE;
  const formedAt = requireNonEmptyString(request.formedAt, "request.formedAt");

  const calibrationRecord = request.calibrationRecord ?? null;
  if (calibrationRecord === null) return reject("no-calibration-record", "no calibration record supplied for this reference class");
  const resolvedForecastCount = requireFiniteNumber(calibrationRecord.resolvedForecastCount, "request.calibrationRecord.resolvedForecastCount");
  if (resolvedForecastCount < 30) {
    return reject("calibration-insufficient", `calibration has ${resolvedForecastCount} resolved forecasts, fewer than the required 30`);
  }
  if (remainingUsd <= 0) return reject("sleeve-exhausted", "sleeve.remainingUsd is not positive");

  const marketImpliedProbability = (yesBid + yesAsk) / 2;
  const side = forecastProbability > marketImpliedProbability ? "yes" : "no";
  const priceDollars = side === "yes" ? yesAsk : noAsk;
  const winProbability = side === "yes" ? forecastProbability : 1 - forecastProbability;
  const payoffRatio = (1 - priceDollars) / priceDollars;
  const feeDollarsPerContract = Math.ceil(feeRate * priceDollars * (1 - priceDollars) * 100) / 100;
  const expectedEdgeAfterFeesPerContract = winProbability * (1 - priceDollars) - (1 - winProbability) * priceDollars - feeDollarsPerContract;
  if (expectedEdgeAfterFeesPerContract <= 0) return reject("no-edge-after-fees", `expected edge per contract ${expectedEdgeAfterFeesPerContract.toFixed(4)} is not positive after the ${feeRate} fee rate`);

  const fraction = kellyFraction({ winProbability, payoffRatio });
  if (fraction <= 0) return reject("no-edge-after-fees", `Kelly fraction ${fraction.toFixed(4)} is not positive`);
  const cappedFraction = Math.min(fraction, maxFractionOfSleeve);
  const contracts = Math.floor((cappedFraction * remainingUsd) / priceDollars);
  if (contracts < 1) return reject("sleeve-exhausted", `capped stake affords fewer than 1 contract at ${priceDollars} per contract`);

  return {
    type: "KalshiOrderIntent",
    version: 1,
    ticker: requireNonEmptyString(marketRead.ticker, "request.marketRead.ticker"),
    action: "buy",
    side,
    priceDollars,
    contracts,
    winProbability,
    payoffRatio,
    kellyFraction: fraction,
    cappedFraction,
    feeDollarsPerContract,
    feeSource,
    expectedEdgeAfterFeesPerContract,
    referenceClass: calibrationRecord.referenceClass ?? null,
    formedAt,
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "form-kalshi-order-intent", description: "Forms a bounded Kalshi order intent from a forecast, a reference-class calibration record, a current market read, a risk sleeve, and a fee schedule -- or refuses with a named datum when any gating condition fails.", operation: formKalshiOrderIntent }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
