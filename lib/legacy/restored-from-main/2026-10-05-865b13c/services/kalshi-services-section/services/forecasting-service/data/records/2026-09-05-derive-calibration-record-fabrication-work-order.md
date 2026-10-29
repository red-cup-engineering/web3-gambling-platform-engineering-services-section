# derive-calibration-record
## Requirements
- `per-reference-class-calibration`: The operation groups scored forecast rows by `referenceClass` and, for each class with at least one resolved (house-kind) row, derives `resolvedForecastCount` (the house-kind row count), `brierScore` (mean house-kind Brier), `calibrationBins` (a deciles-by-default calibration curve over the house-kind probability/outcome pairs), and `calibrationGateMet`.
- `market-edge-when-available`: When market-kind scored rows exist for a class (the venue's implied probability, itself recorded and scored as a forecast), the operation derives `marketImpliedBrierScore` (mean market-kind Brier) and `edgeVsMarket` (`marketImpliedBrierScore - brierScore`; positive means the house forecast beat the market).
- `threshold-field`: The operation carries the resolved-forecast threshold it gates on as an explicit `minResolvedForecasts` field on every non-refused record (default 30).
- `known-reference-classes`: The operation accepts an optional `referenceClasses` list so a class with only open (unresolved) questions so far is still reported, as a refusal, rather than silently omitted.
## Prohibitions
- `zero-resolved-refusal`: The operation must return a `Reject` datum, never a calibration record, for any reference class whose resolved (house-kind) scored-forecast count is zero.
- `never-estimate-missing-market`: The operation must never estimate `marketImpliedBrierScore` or `edgeVsMarket` when no market-kind scored rows exist for a class; both must be reported `null`.
- `no-network-no-wall-clock`: The operation performs no I/O and reads no wall clock; `derivedAt` is an explicit caller-supplied input, so the operation is deterministic and fixture-free.
## Laws
- `calibration-gated-stakes` | Three ways to turn capital into capital (561-group finance note) | 2026-09-04 | content/text/documents/articles/notes/2026/09/04/2026-09-04-note-on-three-ways-to-turn-capital-into-capital.md (561-group-finance-operations-services-section) | Applies to minResolvedForecasts and the zero-resolved refusal. | A stake exists only when the org's calibration on the forecast's reference class is scored on at least thirty resolved forecasts; no calibration record, no stake, and the calibration record is itself the falsifier.
## Standards
- `brier-proper-scoring-rule` | Monthly Weather Review (American Meteorological Society) | Brier 1950, vol. 78 no. 1 | https://doi.org/10.1175/1520-0493(1950)078%3C0001:VOFEIT%3E2.0.CO;2 | Applies to the brierScore field every scored forecast row already carries and this operation aggregates. | The Brier score is a strictly proper scoring rule for probabilistic forecasts of a binary outcome; a forecaster minimizes expected penalty only by stating true belief.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/scratch-derive-calibration-record-20260905-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/forecasting":"0.3.0"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/scratch-derive-calibration-record-20260905.mjs
#!/usr/bin/env node
// Pure transform: scored forecast rows (from score-forecast.mjs, or the
// forecast-weather-markets-cli's own scoring pass) -> one calibration
// record per reference class, in the exact shape
// form-kalshi-order-intent.mjs and form-polymarket-order-intent.mjs
// consume as request.calibrationRecord (resolvedForecastCount, brierScore),
// extended with calibrationBins, the market-implied Brier and the edge
// against it where available, and the thirty-forecast threshold this
// instrument gates on -- or a Reject datum naming the class when it has
// zero resolved (house-kind) scored forecasts. No network I/O, no wall
// clock -- derivedAt is an explicit caller-supplied input (mirrors
// form-kalshi-order-intent.mjs's formedAt seam) so the operation is
// deterministic and fixture-free.
//
// Scratch-fabrication note: this circuit's birthed package shape has no
// src/ directory to import a sibling module from, so calibrationBuckets is
// imported here from the published @red-cup-engineering/forecasting
// package. The shipped copy of this operation
// (forecasting-services-section's scripts/derive-calibration-record.mjs)
// instead imports it from its own sibling src/forecasting.mjs -- see that
// section's data/records/ for the receipt naming this friction.
import { calibrationBuckets } from "@red-cup-engineering/forecasting/forecasting";

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
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "deriveCalibrationRecord — Derives one calibration record per reference class from an array of scored forecast rows -- in exactly the shape @red-cup-engineering/form-kalshi-order-intent-service and @red-cup-engineering/form-polymarket-order-intent-service consume as request.calibrationRecord (resolvedForecastCount, brierScore), extended with calibrationBins, the market-implied Brier and the edge against it where available, and the thirty-forecast threshold this instrument is gated on -- or a Reject datum naming the class when it has zero resolved (house-kind) scored forecasts.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(deriveCalibrationRecord(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/scratch-derive-calibration-record-20260905.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { deriveCalibrationRecord } from "../scripts/scratch-derive-calibration-record-20260905.mjs";

test("derives resolvedForecastCount, brierScore, and calibrationBins from house-kind rows", () => {
  const [record] = deriveCalibrationRecord({
    scoredForecasts: [
      { referenceClass: "kalshi.weather.KXHIGHNY", questionId: "q1", kind: "house", probability: 0.1, outcome: 0, brierScore: 0.01 },
      { referenceClass: "kalshi.weather.KXHIGHNY", questionId: "q2", kind: "house", probability: 0.2, outcome: 0, brierScore: 0.04 },
    ],
    derivedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(record.type, "CalibrationRecord");
  assert.equal(record.referenceClass, "kalshi.weather.KXHIGHNY");
  assert.equal(record.resolvedForecastCount, 2);
  assert.ok(Math.abs(record.brierScore - 0.025) < 1e-9);
  assert.equal(record.calibrationBins.length, 10);
  assert.equal(record.minResolvedForecasts, 30);
  assert.equal(record.calibrationGateMet, false);
});

test("derives marketImpliedBrierScore and a positive edgeVsMarket when the house forecast beats the market", () => {
  const [record] = deriveCalibrationRecord({
    scoredForecasts: [
      { referenceClass: "kalshi.weather.KXHIGHNY", questionId: "q1", kind: "house", probability: 0.1, outcome: 0, brierScore: 0.01 },
      { referenceClass: "kalshi.weather.KXHIGHNY", questionId: "q1", kind: "market", probability: 0.3, outcome: 0, brierScore: 0.09 },
    ],
    derivedAt: "2026-09-05T00:00:00Z",
  });
  assert.ok(Math.abs(record.marketImpliedBrierScore - 0.09) < 1e-9);
  assert.ok(Math.abs(record.edgeVsMarket - 0.08) < 1e-9);
});

test("never estimates marketImpliedBrierScore or edgeVsMarket when no market-kind rows exist", () => {
  const [record] = deriveCalibrationRecord({
    scoredForecasts: [{ referenceClass: "kalshi.weather.KXHIGHNY", questionId: "q1", kind: "house", probability: 0.1, outcome: 0, brierScore: 0.01 }],
    derivedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(record.marketImpliedBrierScore, null);
  assert.equal(record.edgeVsMarket, null);
});

test("refuses a reference class with zero resolved (house-kind) forecasts, even a declared-only class", () => {
  const [record] = deriveCalibrationRecord({
    scoredForecasts: [],
    referenceClasses: ["kalshi.weather.KXHIGHCHI"],
    derivedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(record.type, "Reject");
  assert.equal(record.code, "no-resolved-forecasts");
  assert.equal(record.referenceClass, "kalshi.weather.KXHIGHCHI");
});

test("still refuses a class whose only scored rows are market-kind (no house-kind resolution yet)", () => {
  const [record] = deriveCalibrationRecord({
    scoredForecasts: [{ referenceClass: "kalshi.weather.KXHIGHCHI", questionId: "q1", kind: "market", probability: 0.3, outcome: 0, brierScore: 0.09 }],
    derivedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(record.type, "Reject");
  assert.equal(record.code, "no-resolved-forecasts");
});

test("calibrationGateMet is true once resolvedForecastCount reaches minResolvedForecasts", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ referenceClass: "c", questionId: `q${i}`, kind: "house", probability: 0.1, outcome: 0, brierScore: 0.01 }));
  const [record] = deriveCalibrationRecord({ scoredForecasts: rows, derivedAt: "2026-09-05T00:00:00Z" });
  assert.equal(record.resolvedForecastCount, 30);
  assert.equal(record.calibrationGateMet, true);
});

test("throws on a malformed kind", () => {
  assert.throws(() => deriveCalibrationRecord({
    scoredForecasts: [{ referenceClass: "c", questionId: "q1", kind: "wrong", probability: 0.1, outcome: 0, brierScore: 0.01 }],
    derivedAt: "2026-09-05T00:00:00Z",
  }), TypeError);
});

test("throws when derivedAt is missing", () => {
  assert.throws(() => deriveCalibrationRecord({ scoredForecasts: [] }), TypeError);
});
```
## Examples
```json name="one reference class with both house and market resolved rows, gate not yet met"
{"input":{"scoredForecasts":[{"referenceClass":"kalshi.weather.KXHIGHNY","questionId":"kxhighny-26sep04-t86","kind":"house","probability":0.1,"outcome":0,"brierScore":0.01},{"referenceClass":"kalshi.weather.KXHIGHNY","questionId":"kxhighny-26sep04-t86","kind":"market","probability":0.3,"outcome":0,"brierScore":0.09}],"derivedAt":"2026-09-05T00:00:00Z"},"output":[{"type":"CalibrationRecord","version":1,"referenceClass":"kalshi.weather.KXHIGHNY","resolvedForecastCount":1,"brierScore":0.01,"marketImpliedBrierScore":0.09,"edgeVsMarket":0.08,"calibrationBins":[{"bucketIndex":0,"rangeLow":0,"rangeHigh":0.1,"count":0,"meanStatedProbability":null,"realizedFrequency":null},{"bucketIndex":1,"rangeLow":0.1,"rangeHigh":0.2,"count":1,"meanStatedProbability":0.1,"realizedFrequency":0},{"bucketIndex":2,"rangeLow":0.2,"rangeHigh":0.3,"count":0,"meanStatedProbability":null,"realizedFrequency":null},{"bucketIndex":3,"rangeLow":0.3,"rangeHigh":0.4,"count":0,"meanStatedProbability":null,"realizedFrequency":null},{"bucketIndex":4,"rangeLow":0.4,"rangeHigh":0.5,"count":0,"meanStatedProbability":null,"realizedFrequency":null},{"bucketIndex":5,"rangeLow":0.5,"rangeHigh":0.6,"count":0,"meanStatedProbability":null,"realizedFrequency":null},{"bucketIndex":6,"rangeLow":0.6,"rangeHigh":0.7,"count":0,"meanStatedProbability":null,"realizedFrequency":null},{"bucketIndex":7,"rangeLow":0.7,"rangeHigh":0.8,"count":0,"meanStatedProbability":null,"realizedFrequency":null},{"bucketIndex":8,"rangeLow":0.8,"rangeHigh":0.9,"count":0,"meanStatedProbability":null,"realizedFrequency":null},{"bucketIndex":9,"rangeLow":0.9,"rangeHigh":1,"count":0,"meanStatedProbability":null,"realizedFrequency":null}],"minResolvedForecasts":30,"calibrationGateMet":false,"derivedAt":"2026-09-05T00:00:00Z"}]}
```
## Traceability
- `per-reference-class-calibration` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `brier-proper-scoring-rule`
- `market-edge-when-available` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `brier-proper-scoring-rule`
- `threshold-field` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
- `known-reference-classes` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
- `zero-resolved-refusal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
- `never-estimate-missing-market` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `brier-proper-scoring-rule`
- `no-network-no-wall-clock` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
