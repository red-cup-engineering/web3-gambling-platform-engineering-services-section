import assert from "node:assert/strict";
import test from "node:test";
import { formKalshiOrderIntent } from "../scripts/form-kalshi-order-intent.mjs";

const FORECAST = { questionId: "kxhighny-26sep05-t79", probability: 0.6 };
const MARKET_READ = { ticker: "KXHIGHNY-26SEP05-T79", yesBid: 0.26, yesAsk: 0.27, noBid: 0.73, noAsk: 0.74 };
const SLEEVE = { remainingUsd: 100 };
const FORMED_AT = "2026-09-05T12:00:00.000Z";

test("refuses no-calibration-record when none is supplied", () => {
  const result = formKalshiOrderIntent({ forecast: FORECAST, calibrationRecord: null, marketRead: MARKET_READ, sleeve: SLEEVE, formedAt: FORMED_AT });
  assert.equal(result.type, "Reject");
  assert.equal(result.code, "no-calibration-record");
  assert.equal(result.venueWrite, false);
});

test("refuses calibration-insufficient with fewer than 30 resolved forecasts", () => {
  const result = formKalshiOrderIntent({
    forecast: FORECAST,
    calibrationRecord: { referenceClass: "kalshi-weather", resolvedForecastCount: 12, brierScore: 0.1, marketImpliedBrierScore: 0.2 },
    marketRead: MARKET_READ,
    sleeve: SLEEVE,
    formedAt: FORMED_AT,
  });
  assert.equal(result.code, "calibration-insufficient");
});

test("forms a yes-side intent with positive edge and thirty-resolved calibration", () => {
  const result = formKalshiOrderIntent({
    forecast: FORECAST,
    calibrationRecord: { referenceClass: "kalshi-weather", resolvedForecastCount: 40, brierScore: 0.1, marketImpliedBrierScore: 0.2 },
    marketRead: MARKET_READ,
    sleeve: SLEEVE,
    formedAt: FORMED_AT,
  });
  assert.equal(result.type, "KalshiOrderIntent");
  assert.equal(result.side, "yes");
  assert.equal(result.priceDollars, 0.27);
  assert.ok(result.contracts >= 1);
  assert.ok(result.kellyFraction > 0);
  assert.equal(result.referenceClass, "kalshi-weather");
  assert.equal(result.formedAt, FORMED_AT);
});

test("refuses no-edge-after-fees when the forecast agrees with the market price", () => {
  const result = formKalshiOrderIntent({
    forecast: { questionId: "kxhighny-26sep05-t79", probability: 0.265 },
    calibrationRecord: { referenceClass: "kalshi-weather", resolvedForecastCount: 40, brierScore: 0.1, marketImpliedBrierScore: 0.1 },
    marketRead: MARKET_READ,
    sleeve: SLEEVE,
    formedAt: FORMED_AT,
  });
  assert.equal(result.code, "no-edge-after-fees");
});

test("refuses sleeve-exhausted when remainingUsd cannot afford one contract", () => {
  const result = formKalshiOrderIntent({
    forecast: FORECAST,
    calibrationRecord: { referenceClass: "kalshi-weather", resolvedForecastCount: 40, brierScore: 0.1, marketImpliedBrierScore: 0.2 },
    marketRead: MARKET_READ,
    sleeve: { remainingUsd: 0.1 },
    formedAt: FORMED_AT,
  });
  assert.equal(result.code, "sleeve-exhausted");
});

test("refuses a non-object request", () => {
  assert.throws(() => formKalshiOrderIntent(null), /request must be a JSON object/u);
});

test("refuses a malformed forecast probability", () => {
  assert.throws(
    () => formKalshiOrderIntent({ forecast: { questionId: "q", probability: 1.4 }, calibrationRecord: null, marketRead: MARKET_READ, sleeve: SLEEVE, formedAt: FORMED_AT }),
    /must lie in \[0,1\]/u,
  );
});
