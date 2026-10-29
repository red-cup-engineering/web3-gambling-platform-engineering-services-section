# form-kalshi-order-intent
## Requirements
- `requires-calibration-record`: Given a forecast, the operation forms an order intent only when a calibration record is supplied; a request with no calibrationRecord refuses with `no-calibration-record`.
- `requires-thirty-resolved-forecasts`: The operation refuses with `calibration-insufficient` when the supplied calibrationRecord's resolvedForecastCount is fewer than 30.
- `requires-positive-edge-after-fees`: The operation computes the expected per-contract edge (win probability times payout minus loss probability times stake, minus the Kalshi fee) and refuses with `no-edge-after-fees` when that edge is not positive, or when the resulting Kelly fraction is not positive.
- `caps-size-by-sleeve`: The operation sizes the position as a Kelly fraction of the calibration's edge, capped by the sleeve's own maxFractionOfSleeve, applied to the sleeve's remainingUsd; it refuses with `sleeve-exhausted` when the sleeve cannot afford even one contract at that capped stake.
- `states-fee-schedule-with-source`: The operation applies Kalshi's documented per-contract trading fee formula (`ceil(0.07 * price * (1-price) * 100) / 100` dollars, rounded up to the cent) as a parameter with a default feeRate of 0.07 and its published source, overridable by the caller.
- `pure-transformation`: The operation is a pure function of its input; it performs no network I/O and reads no wall clock -- the caller supplies `formedAt` explicitly.
## Prohibitions
- `refuses-non-object-request`: The operation must refuse a request that is not a JSON object.
- `refuses-malformed-forecast`: The operation must refuse a request whose forecast.probability is not a finite number in [0,1].
- `never-computes-kelly-itself`: The operation must never reimplement the Kelly fraction formula; it imports `kellyFraction` from the house's published position-sizing-service.
## Laws
- `order-placement-admission-bounded-order-size` | Kalshi venue-access settlement, 561 Group | v1 | kalshi-services-section/content/contracts/order-placement-admission.json | Applies to the size this operation computes for any order intent it forms. | The order-placement-admission contract's invariants include bounded-order-size; this operation caps every intent's size by the caller's declared sleeve, never sizing beyond it.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file that is eligible for downstream staged package-birth assays.
- `kelly-criterion-position-sizing` | Lenticule Science, 561 Group | 0.2.0 | @red-cup-engineering/position-sizing-service | Applies to the Kelly fraction this operation computes from the calibration's implied edge. | The published position-sizing-service exports `kellyFraction({winProbability, payoffRatio})`; this operation imports and calls it rather than restating the formula.
- `kalshi-trading-fee-schedule` | Kalshi | 2026 | https://kalshi.com/docs/kalshi-fee-schedule.pdf | Applies to the default feeRate and fee formula this operation applies before judging edge. | Kalshi's published fee schedule documents the general per-contract trading fee as `fees = ceil(0.07 * contracts * price * (1-price))` rounded up to the cent; this operation applies the per-contract form with feeRate as an overridable parameter.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/form-kalshi-order-intent-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/position-sizing-service":"0.2.0"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/form-kalshi-order-intent.mjs
#!/usr/bin/env node
// Pure transform: forecast + calibration record + market read + sleeve + fee
// schedule -> a bounded Kalshi order intent, or a refusal datum. No network
// I/O, no wall clock -- formedAt is an explicit caller-supplied input so the
// operation is deterministic and fixture-free.
import { kellyFraction } from "@red-cup-engineering/position-sizing-service";

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
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "formKalshiOrderIntent — Forms a bounded Kalshi order intent from a forecast, a reference-class calibration record, a current market read, a risk sleeve, and a fee schedule -- or refuses with a named datum when any gating condition fails.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(formKalshiOrderIntent(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/form-kalshi-order-intent.test.mjs
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
```
## Examples
```json name="refuses no-calibration-record deterministically"
{"input":{"forecast":{"questionId":"kxhighny-26sep05-t79","probability":0.6},"calibrationRecord":null,"marketRead":{"ticker":"KXHIGHNY-26SEP05-T79","yesBid":0.26,"yesAsk":0.27,"noBid":0.73,"noAsk":0.74},"sleeve":{"remainingUsd":100},"formedAt":"2026-09-05T12:00:00.000Z"},"output":{"type":"Reject","code":"no-calibration-record","detail":"no calibration record supplied for this reference class","venueWrite":false}}
```
## Traceability
- `requires-calibration-record` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `order-placement-admission-bounded-order-size`
- `requires-thirty-resolved-forecasts` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `order-placement-admission-bounded-order-size`
- `requires-positive-edge-after-fees` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-trading-fee-schedule`
- `caps-size-by-sleeve` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `order-placement-admission-bounded-order-size`, `kelly-criterion-position-sizing`
- `states-fee-schedule-with-source` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-trading-fee-schedule`
- `pure-transformation` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `refuses-non-object-request` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `refuses-malformed-forecast` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `never-computes-kelly-itself` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kelly-criterion-position-sizing`
