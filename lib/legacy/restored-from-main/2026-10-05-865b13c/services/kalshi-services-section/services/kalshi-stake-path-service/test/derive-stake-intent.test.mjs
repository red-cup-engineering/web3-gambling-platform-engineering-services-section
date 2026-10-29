import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { recordForecast } from "@red-cup-engineering/forecasting/record-forecast";
import {
  CALIBRATION_CATEGORY,
  CALIBRATION_OBJECT_KIND,
  HOUSE_EVIDENCE_SOURCE,
  MARKET_EVIDENCE_SOURCE,
  questionIdFromTicker,
  referenceClassFromSeries,
} from "@red-cup-engineering/forecasting/forecast-weather-markets-cli";
import { deriveStakeIntent } from "../scripts/derive-stake-intent.mjs";

const MARKET_TICKER = "KXHIGHNY-26SEP05-B85.5";
const SERIES_TICKER = "KXHIGHNY";
const REFERENCE_CLASS = referenceClassFromSeries(SERIES_TICKER);
const QUESTION_ID = questionIdFromTicker(MARKET_TICKER);
const SLEEVE = { riskCapital: "250", survivalCapital: "0" };

function freshForecastingRoot() {
  return mkdtempSync(join(tmpdir(), "kalshi-stake-path-forecasting-"));
}

function recordHouseAndMarketForecast(dataRoot, { houseProbability, marketProbability }) {
  recordForecast({
    questionId: QUESTION_ID, probability: houseProbability, rationale: "NWS point forecast plus normal error model",
    evidenceCitations: [{ source: HOUSE_EVIDENCE_SOURCE, note: "test fixture" }], timestamp: "2026-09-05T00:00:00.000Z",
  }, { dataRoot });
  recordForecast({
    questionId: QUESTION_ID, probability: marketProbability, rationale: "Kalshi market implied probability",
    evidenceCitations: [{ source: MARKET_EVIDENCE_SOURCE, note: "test fixture" }], timestamp: "2026-09-05T00:00:00.000Z",
  }, { dataRoot });
}

function writeCalibrationRows(dataRoot, { count, houseBrier, marketBrier }) {
  const journal = createSemanticRecordJournal({ root: dataRoot, objectKind: CALIBRATION_OBJECT_KIND });
  for (let index = 0; index < count; index += 1) {
    journal.record({ category: CALIBRATION_CATEGORY, recordedAt: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      record: { referenceClass: REFERENCE_CLASS, forecastId: `house-${index}`, questionId: `q-${index}`, kind: "house", probability: 0.9, outcome: 1, brierScore: houseBrier, logScore: 0.1, logScoreUndefinedReason: null, scoredAt: "2026-08-01T00:00:00.000Z" },
      told: { for: true, against: false } });
    journal.record({ category: CALIBRATION_CATEGORY, recordedAt: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      record: { referenceClass: REFERENCE_CLASS, forecastId: `market-${index}`, questionId: `q-${index}`, kind: "market", probability: 0.6, outcome: 1, brierScore: marketBrier, logScore: 0.5, logScoreUndefinedReason: null, scoredAt: "2026-08-01T00:00:00.000Z" },
      told: { for: true, against: false } });
  }
}

test("deriveStakeIntent refuses on 0/30 resolved calibration rows -- the Kelly-zero-shaped normal case", () => {
  const forecastingDataRoot = freshForecastingRoot();
  recordHouseAndMarketForecast(forecastingDataRoot, { houseProbability: 0.85, marketProbability: 0.55 });
  const intent = deriveStakeIntent({ marketTicker: MARKET_TICKER, seriesTicker: SERIES_TICKER, sleeve: SLEEVE, forecastingDataRoot });
  assert.equal(intent.admitted, false);
  assert.match(intent.reason, /record #2 not met/);
  assert.equal(intent.resolvedCalibrationCount, 0);
});

test("deriveStakeIntent refuses when no house forecast is recorded for the market -- record #1 missing", () => {
  const forecastingDataRoot = freshForecastingRoot();
  const intent = deriveStakeIntent({ marketTicker: MARKET_TICKER, seriesTicker: SERIES_TICKER, sleeve: SLEEVE, forecastingDataRoot });
  assert.equal(intent.admitted, false);
  assert.match(intent.reason, /record #1 missing/);
});

test("deriveStakeIntent refuses when calibration shows no edge (house Brier does not beat market Brier)", () => {
  const forecastingDataRoot = freshForecastingRoot();
  recordHouseAndMarketForecast(forecastingDataRoot, { houseProbability: 0.85, marketProbability: 0.55 });
  writeCalibrationRows(forecastingDataRoot, { count: 31, houseBrier: 0.30, marketBrier: 0.10 });
  const intent = deriveStakeIntent({ marketTicker: MARKET_TICKER, seriesTicker: SERIES_TICKER, sleeve: SLEEVE, forecastingDataRoot });
  assert.equal(intent.admitted, false);
  assert.match(intent.reason, /record #2 shows no edge/);
});

test("deriveStakeIntent admits on 31 resolved rows with a positive edge and returns a sleeve-sized stake", () => {
  const forecastingDataRoot = freshForecastingRoot();
  recordHouseAndMarketForecast(forecastingDataRoot, { houseProbability: 0.85, marketProbability: 0.55 });
  writeCalibrationRows(forecastingDataRoot, { count: 31, houseBrier: 0.05, marketBrier: 0.25 });
  const intent = deriveStakeIntent({
    marketTicker: MARKET_TICKER, seriesTicker: SERIES_TICKER, sleeve: SLEEVE, forecastingDataRoot,
    config: { feeRate: 0.01, maxSleeveFraction: 0.05 },
  });
  assert.equal(intent.admitted, true);
  assert.equal(intent.side, "yes");
  assert.equal(intent.resolvedCalibrationCount, 31);
  assert.ok(intent.expectedEdgeAfterFee > 0, `expected positive edge, got ${intent.expectedEdgeAfterFee}`);
  assert.ok(intent.kellyFractionCapped <= 0.05, `expected the fixed sleeve-fraction cap to hold, got ${intent.kellyFractionCapped}`);
  assert.ok(intent.contracts >= 1);
  assert.equal(typeof intent.id, "string");
});

test("deriveStakeIntent refuses when calibration is met but the house/market probabilities imply no edge after fee", () => {
  const forecastingDataRoot = freshForecastingRoot();
  // House and market probability nearly identical -- price already reflects the house view, so the
  // fee alone should push the edge non-positive.
  recordHouseAndMarketForecast(forecastingDataRoot, { houseProbability: 0.551, marketProbability: 0.55 });
  writeCalibrationRows(forecastingDataRoot, { count: 31, houseBrier: 0.05, marketBrier: 0.25 });
  const intent = deriveStakeIntent({
    marketTicker: MARKET_TICKER, seriesTicker: SERIES_TICKER, sleeve: SLEEVE, forecastingDataRoot,
    config: { feeRate: 0.05 },
  });
  assert.equal(intent.admitted, false);
  assert.match(intent.reason, /record #3 non-positive/);
});
