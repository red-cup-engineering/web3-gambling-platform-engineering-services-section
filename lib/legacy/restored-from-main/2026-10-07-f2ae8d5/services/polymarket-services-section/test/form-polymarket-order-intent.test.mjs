import assert from "node:assert/strict";
import test from "node:test";
import { formPolymarketOrderIntent } from "../scripts/form-polymarket-order-intent.mjs";

const FORECAST = { questionId: "xi-jinping-out-before-2027", probability: 0.15 };
const MARKET_READ = { tokenId: "32338220190071351435772801779725302244575775216413325951443816017994629993401", bestBid: 0.047, bestAsk: 0.048 };
const SLEEVE = { remainingUsd: 100 };
const FORMED_AT = "2026-09-05T12:00:00.000Z";

test("refuses no-calibration-record when none is supplied", () => {
  const result = formPolymarketOrderIntent({ forecast: FORECAST, calibrationRecord: null, marketRead: MARKET_READ, sleeve: SLEEVE, formedAt: FORMED_AT });
  assert.equal(result.type, "Reject");
  assert.equal(result.code, "no-calibration-record");
  assert.equal(result.venueWrite, false);
});

test("refuses calibration-insufficient with fewer than 30 resolved forecasts", () => {
  const result = formPolymarketOrderIntent({
    forecast: FORECAST,
    calibrationRecord: { referenceClass: "geopolitical-leader-tenure", resolvedForecastCount: 5, brierScore: 0.1, marketImpliedBrierScore: 0.2 },
    marketRead: MARKET_READ,
    sleeve: SLEEVE,
    formedAt: FORMED_AT,
  });
  assert.equal(result.code, "calibration-insufficient");
});

test("forms a BUY-side intent with positive edge and thirty-resolved calibration", () => {
  const result = formPolymarketOrderIntent({
    forecast: FORECAST,
    calibrationRecord: { referenceClass: "geopolitical-leader-tenure", resolvedForecastCount: 40, brierScore: 0.02, marketImpliedBrierScore: 0.05 },
    marketRead: MARKET_READ,
    sleeve: SLEEVE,
    formedAt: FORMED_AT,
  });
  assert.equal(result.type, "PolymarketOrderIntent");
  assert.equal(result.side, "BUY");
  assert.equal(result.price, 0.048);
  assert.ok(result.size >= 5);
  assert.ok(result.kellyFraction > 0);
  assert.equal(result.referenceClass, "geopolitical-leader-tenure");
  assert.equal(result.formedAt, FORMED_AT);
});

test("refuses no-edge-after-fees when the forecast agrees with the market price", () => {
  const result = formPolymarketOrderIntent({
    forecast: { questionId: "xi-jinping-out-before-2027", probability: 0.0475 },
    calibrationRecord: { referenceClass: "geopolitical-leader-tenure", resolvedForecastCount: 40, brierScore: 0.05, marketImpliedBrierScore: 0.05 },
    marketRead: MARKET_READ,
    sleeve: SLEEVE,
    formedAt: FORMED_AT,
  });
  assert.equal(result.code, "no-edge-after-fees");
});

test("refuses sleeve-exhausted when the capped stake is below the minimum order size", () => {
  const result = formPolymarketOrderIntent({
    forecast: FORECAST,
    calibrationRecord: { referenceClass: "geopolitical-leader-tenure", resolvedForecastCount: 40, brierScore: 0.02, marketImpliedBrierScore: 0.05 },
    marketRead: MARKET_READ,
    sleeve: { remainingUsd: 0.01 },
    formedAt: FORMED_AT,
  });
  assert.equal(result.code, "sleeve-exhausted");
});

test("refuses a non-object request", () => {
  assert.throws(() => formPolymarketOrderIntent(null), /request must be a JSON object/u);
});

test("refuses a malformed forecast probability", () => {
  assert.throws(
    () => formPolymarketOrderIntent({ forecast: { questionId: "q", probability: 1.4 }, calibrationRecord: null, marketRead: MARKET_READ, sleeve: SLEEVE, formedAt: FORMED_AT }),
    /must lie in \[0,1\]/u,
  );
});
