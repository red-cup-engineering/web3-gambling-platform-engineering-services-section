#!/usr/bin/env node
// Pure transform: forecast + calibration record + market read + sleeve + fee
// schedule -> a bounded Polymarket CLOB order intent, or a refusal datum. No
// network I/O, no wall clock -- formedAt is an explicit caller-supplied
// input so the operation is deterministic and fixture-free.
import { kellyFraction } from "@red-cup-engineering/position-sizing-service";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

const DEFAULT_FEE_RATE_BPS = 0;
const DEFAULT_FEE_SOURCE = "https://docs.polymarket.com/developers/CLOB/orders/orders";
const DEFAULT_MIN_ORDER_SIZE = 5;

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`form-polymarket-order-intent: ${label} must be a JSON object`);
  }
  return value;
}

function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`form-polymarket-order-intent: ${label} must be a finite number`);
  }
  return value;
}

function requireUnitInterval(value, label) {
  const n = requireFiniteNumber(value, label);
  if (n < 0 || n > 1) throw new TypeError(`form-polymarket-order-intent: ${label} must lie in [0,1]`);
  return n;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`form-polymarket-order-intent: ${label} must be a non-empty string`);
  }
  return value;
}

const reject = (code, detail) => ({ type: "Reject", code, detail, venueWrite: false });

/**
 * Forms a bounded Polymarket CLOB order intent from a forecast, a reference-class calibration record, a current market read, a risk sleeve, and a fee schedule -- or refuses with a named datum when any gating condition fails.
 * @param {object} request A FormPolymarketOrderIntentRequest.
 * @param {{questionId: string, probability: number}} request.forecast The org's own forecast for the market's question.
 * @param {null|{referenceClass: string, resolvedForecastCount: number, brierScore: number, marketImpliedBrierScore: number}} request.calibrationRecord The org's calibration on this forecast's reference class; null when none exists yet.
 * @param {{tokenId: string, bestBid: number, bestAsk: number}} request.marketRead A PolymarketMarketRead (or the fields of one).
 * @param {{remainingUsd: number, maxFractionOfSleeve?: number}} request.sleeve The bounded risk sleeve; maxFractionOfSleeve defaults to 1 (full Kelly).
 * @param {{feeRateBps?: number, source?: string, minOrderSize?: number}} [request.feeSchedule] Polymarket's fee rate in basis points (default 0), its published source, and the venue's minimum order size (default 5 shares).
 * @param {string} request.formedAt ISO 8601 timestamp this intent is formed at, supplied by the caller.
 * @returns {object} A PolymarketOrderIntent, or a Reject datum with code one of no-calibration-record, calibration-insufficient, no-edge-after-fees, sleeve-exhausted.
 * @throws {TypeError} When the request or its required fields are malformed.
 */
export function formPolymarketOrderIntent(request) {
  requireObject(request, "request");
  const forecast = requireObject(request.forecast, "request.forecast");
  requireNonEmptyString(forecast.questionId, "request.forecast.questionId");
  const forecastProbability = requireUnitInterval(forecast.probability, "request.forecast.probability");
  const marketRead = requireObject(request.marketRead, "request.marketRead");
  const tokenId = requireNonEmptyString(marketRead.tokenId, "request.marketRead.tokenId");
  const bestBid = requireUnitInterval(marketRead.bestBid, "request.marketRead.bestBid");
  const bestAsk = requireUnitInterval(marketRead.bestAsk, "request.marketRead.bestAsk");
  const sleeve = requireObject(request.sleeve, "request.sleeve");
  const remainingUsd = requireFiniteNumber(sleeve.remainingUsd, "request.sleeve.remainingUsd");
  const maxFractionOfSleeve = sleeve.maxFractionOfSleeve === undefined ? 1 : requireUnitInterval(sleeve.maxFractionOfSleeve, "request.sleeve.maxFractionOfSleeve");
  const feeRateBps = request.feeSchedule?.feeRateBps ?? DEFAULT_FEE_RATE_BPS;
  const feeSource = request.feeSchedule?.source ?? DEFAULT_FEE_SOURCE;
  const minOrderSize = request.feeSchedule?.minOrderSize ?? DEFAULT_MIN_ORDER_SIZE;
  const formedAt = requireNonEmptyString(request.formedAt, "request.formedAt");

  const calibrationRecord = request.calibrationRecord ?? null;
  if (calibrationRecord === null) return reject("no-calibration-record", "no calibration record supplied for this reference class");
  const resolvedForecastCount = requireFiniteNumber(calibrationRecord.resolvedForecastCount, "request.calibrationRecord.resolvedForecastCount");
  if (resolvedForecastCount < 30) {
    return reject("calibration-insufficient", `calibration has ${resolvedForecastCount} resolved forecasts, fewer than the required 30`);
  }
  if (remainingUsd <= 0) return reject("sleeve-exhausted", "sleeve.remainingUsd is not positive");

  const marketImpliedProbability = (bestBid + bestAsk) / 2;
  const side = forecastProbability > marketImpliedProbability ? "BUY" : "SELL";
  const price = side === "BUY" ? bestAsk : 1 - bestBid;
  const winProbability = side === "BUY" ? forecastProbability : 1 - forecastProbability;
  const payoffRatio = (1 - price) / price;
  const feeDollarsPerShare = (feeRateBps / 10000) * price;
  const expectedEdgeAfterFeesPerShare = winProbability * (1 - price) - (1 - winProbability) * price - feeDollarsPerShare;
  if (expectedEdgeAfterFeesPerShare <= 0) {
    return reject("no-edge-after-fees", `expected edge per share ${expectedEdgeAfterFeesPerShare.toFixed(4)} is not positive after ${feeRateBps} bps fees`);
  }

  const fraction = kellyFraction({ winProbability, payoffRatio });
  if (fraction <= 0) return reject("no-edge-after-fees", `Kelly fraction ${fraction.toFixed(4)} is not positive`);
  const cappedFraction = Math.min(fraction, maxFractionOfSleeve);
  const size = (cappedFraction * remainingUsd) / price;
  if (size < minOrderSize) return reject("sleeve-exhausted", `capped stake affords ${size.toFixed(4)} shares, below the venue's minimum order size of ${minOrderSize}`);

  return {
    type: "PolymarketOrderIntent",
    version: 1,
    tokenId,
    side,
    price,
    size,
    winProbability,
    payoffRatio,
    kellyFraction: fraction,
    cappedFraction,
    feeRateBps,
    feeSource,
    expectedEdgeAfterFeesPerShare,
    referenceClass: calibrationRecord.referenceClass ?? null,
    formedAt,
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "form-polymarket-order-intent", description: "Forms a bounded Polymarket CLOB order intent from a forecast, a reference-class calibration record, a current market read, a risk sleeve, and a fee schedule -- or refuses with a named datum when any gating condition fails.", operation: formPolymarketOrderIntent }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
