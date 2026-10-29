import assert from "node:assert/strict";
import test from "node:test";
import { deriveCalibrationRecord } from "../scripts/derive-calibration-record.mjs";

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
