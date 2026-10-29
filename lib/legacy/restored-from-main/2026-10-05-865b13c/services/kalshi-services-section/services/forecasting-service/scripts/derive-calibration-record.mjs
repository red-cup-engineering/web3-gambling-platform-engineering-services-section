#!/usr/bin/env node
// Pure transform: scored forecast rows -> one calibration record per
// reference class, in the shape the Kalshi/Polymarket order-intent
// formers consume (see the exported function's JSDoc for the full
// contract). No network I/O, no wall clock; derivedAt is caller-supplied.
// Fabricated via jsnode-fabrication at a scratch destination and
// hand-placed here (DESTINATION_EXISTS refusal, no in-place mode yet --
// see data/records/ for the work order and receipt); this sibling import
// replaces the scratch copy's published-package import.
import { calibrationBuckets } from "../src/forecasting.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

const DEFAULT_MIN_RESOLVED_FORECASTS = 30;
const DEFAULT_BUCKET_COUNT = 10;

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`derive-calibration-record: ${label} must be an array`);
  return value;
}
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`derive-calibration-record: ${label} must be a non-empty string`);
  return value;
}
function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`derive-calibration-record: ${label} must be a positive integer`);
  return value;
}
function requireScoredForecast(row, index) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) throw new TypeError(`derive-calibration-record: request.scoredForecasts[${index}] must be an object`);
  requireNonEmptyString(row.referenceClass, `request.scoredForecasts[${index}].referenceClass`);
  requireNonEmptyString(row.questionId, `request.scoredForecasts[${index}].questionId`);
  if (row.kind !== "house" && row.kind !== "market") throw new TypeError(`derive-calibration-record: request.scoredForecasts[${index}].kind must be "house" or "market"`);
  if (typeof row.probability !== "number" || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) {
    throw new TypeError(`derive-calibration-record: request.scoredForecasts[${index}].probability must be a finite number in [0,1]`);
  }
  if (row.outcome !== 0 && row.outcome !== 1) throw new TypeError(`derive-calibration-record: request.scoredForecasts[${index}].outcome must be exactly 0 or 1`);
  if (typeof row.brierScore !== "number" || !Number.isFinite(row.brierScore)) throw new TypeError(`derive-calibration-record: request.scoredForecasts[${index}].brierScore must be a finite number`);
  return row;
}
const reject = (referenceClass, code, detail) => ({ type: "Reject", code, referenceClass, detail });
function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Derives one calibration record per reference class from an array of scored forecast rows -- in exactly the shape @red-cup-engineering/form-kalshi-order-intent-service and @red-cup-engineering/form-polymarket-order-intent-service consume as request.calibrationRecord (resolvedForecastCount, brierScore), extended with calibrationBins, the market-implied Brier and the edge against it where available, and the thirty-forecast threshold this instrument is gated on -- or a Reject datum naming the class when it has zero resolved (house-kind) scored forecasts.
 * @param {object} request A DeriveCalibrationRecordRequest.
 * @param {{referenceClass: string, questionId: string, kind: "house"|"market", probability: number, outcome: (0|1), brierScore: number}[]} request.scoredForecasts Scored rows -- one per resolved forecast per kind (house: the org's own forecast; market: the venue's implied probability, itself recorded and scored as a forecast, when the forecast named a market).
 * @param {string[]} [request.referenceClasses] Reference classes to report even when they carry zero scored rows (e.g. a class with only open questions so far); defaults to the distinct referenceClass values found in scoredForecasts.
 * @param {number} [request.minResolvedForecasts] The resolved-forecast threshold this instrument gates on (default 30, the three-ways note's calibration-gated-stakes figure).
 * @param {number} [request.bucketCount] calibrationBuckets bucket count (default 10, deciles).
 * @param {string} request.derivedAt ISO 8601 timestamp this derivation is stamped with, supplied by the caller.
 * @returns {object[]} One CalibrationRecord or Reject datum per reference class.
 * @throws {TypeError} When the request or a scored-forecast row is malformed.
 */
export function deriveCalibrationRecord(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("derive-calibration-record: request must be a JSON object");
  }
  const scoredForecasts = requireArray(request.scoredForecasts, "request.scoredForecasts").map(requireScoredForecast);
  const minResolvedForecasts = request.minResolvedForecasts === undefined ? DEFAULT_MIN_RESOLVED_FORECASTS : requirePositiveInteger(request.minResolvedForecasts, "request.minResolvedForecasts");
  const bucketCount = request.bucketCount === undefined ? DEFAULT_BUCKET_COUNT : requirePositiveInteger(request.bucketCount, "request.bucketCount");
  const derivedAt = requireNonEmptyString(request.derivedAt, "request.derivedAt");

  const foundClasses = [...new Set(scoredForecasts.map((row) => row.referenceClass))];
  const declaredClasses = request.referenceClasses === undefined
    ? []
    : requireArray(request.referenceClasses, "request.referenceClasses").map((value, index) => requireNonEmptyString(value, `request.referenceClasses[${index}]`));
  const referenceClasses = [...new Set([...declaredClasses, ...foundClasses])];

  return referenceClasses.map((referenceClass) => {
    const rows = scoredForecasts.filter((row) => row.referenceClass === referenceClass);
    const houseRows = rows.filter((row) => row.kind === "house");
    const marketRows = rows.filter((row) => row.kind === "market");
    const resolvedForecastCount = houseRows.length;
    if (resolvedForecastCount === 0) {
      return reject(referenceClass, "no-resolved-forecasts", `zero resolved (house-kind) scored forecasts for reference class ${referenceClass}; no calibration record can be derived yet`);
    }
    const brierScoreValue = mean(houseRows.map((row) => row.brierScore));
    const marketImpliedBrierScore = mean(marketRows.map((row) => row.brierScore));
    const edgeVsMarket = marketImpliedBrierScore === null ? null : marketImpliedBrierScore - brierScoreValue;
    const calibrationBins = calibrationBuckets(houseRows.map((row) => ({ probability: row.probability, outcome: row.outcome })), { bucketCount });
    return {
      type: "CalibrationRecord",
      version: 1,
      referenceClass,
      resolvedForecastCount,
      brierScore: brierScoreValue,
      marketImpliedBrierScore,
      edgeVsMarket,
      calibrationBins,
      minResolvedForecasts,
      calibrationGateMet: resolvedForecastCount >= minResolvedForecasts,
      derivedAt,
    };
  });
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "derive-calibration-record", description: "Derives one calibration record per reference class from an array of scored forecast rows -- in exactly the shape", operation: deriveCalibrationRecord }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
