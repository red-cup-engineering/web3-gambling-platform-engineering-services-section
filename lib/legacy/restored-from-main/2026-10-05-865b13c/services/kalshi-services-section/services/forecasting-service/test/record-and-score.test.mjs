import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { createForecast } from "../src/forecasting.mjs";
import { recordForecast } from "../scripts/record-forecast.mjs";
import { CALIBRATION_CATEGORY, CALIBRATION_OBJECT_KIND, findRecordedForecast, scoreForecast } from "../scripts/score-forecast.mjs";

test("record-forecast then score-forecast round-trips through a real tmp data root", (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "forecasting-record-score-"));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));

  const forecast = createForecast({
    questionId: "will-x-happen",
    probability: 0.75,
    rationale: "Round-trip test forecast.",
    evidenceCitations: [{ source: "test-fixture" }],
    timestamp: "2026-09-01T00:00:00.000Z",
  });

  const recordReceipt = recordForecast(forecast, { dataRoot });
  assert.match(recordReceipt.id, /^ni:\/\/\/sha-256;/u);
  assert.equal(recordReceipt.told.for, true);

  const found = findRecordedForecast(recordReceipt.id, { dataRoot });
  assert.equal(found.questionId, "will-x-happen");
  assert.equal(found.probability, 0.75);

  const scoreReceipt = scoreForecast({ forecastId: recordReceipt.id, outcome: 1 }, { dataRoot });
  assert.equal(scoreReceipt.told.for, true);
  assert.match(scoreReceipt.id, /^ni:\/\/\/sha-256;/u);
});

test("scoreForecast records a real Brier score and log score matching the worked formulas", (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "forecasting-score-values-"));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));

  const forecast = createForecast({
    questionId: "will-y-happen",
    probability: 0.8,
    rationale: "Scoring value test forecast.",
    evidenceCitations: [{ source: "test-fixture" }],
    timestamp: "2026-09-01T00:00:00.000Z",
  });
  const recordReceipt = recordForecast(forecast, { dataRoot });

  const scoreReceipt = scoreForecast({ forecastId: recordReceipt.id, outcome: 1 }, { dataRoot });
  const calibrationRecords = findCalibrationRecords(dataRoot);
  const calibrationRecord = calibrationRecords.find((row) => row.id === scoreReceipt.id);
  assert.ok(calibrationRecord, "the scored calibration record must be queryable back from the journal");
  assert.equal(calibrationRecord.record.brierScore, (0.8 - 1) ** 2);
  assert.equal(calibrationRecord.record.logScore, -Math.log(0.8));
  assert.equal(calibrationRecord.record.logScoreUndefinedReason, null);
});

test("scoreForecast throws for an outcome that is not exactly 0 or 1", (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "forecasting-score-outcome-"));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const forecast = createForecast({
    questionId: "will-z-happen",
    probability: 0.6,
    rationale: "Outcome validation test.",
    evidenceCitations: [{ source: "test-fixture" }],
    timestamp: "2026-09-01T00:00:00.000Z",
  });
  const recordReceipt = recordForecast(forecast, { dataRoot });
  assert.throws(() => scoreForecast({ forecastId: recordReceipt.id, outcome: 0.5 }, { dataRoot }), /outcome must be exactly 0 or 1/u);
});

test("findRecordedForecast throws for an id with no recorded forecast", (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "forecasting-missing-forecast-"));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  assert.throws(() => findRecordedForecast("ni:///sha-256;doesnotexist", { dataRoot }), /no recorded forecast found/u);
});

function findCalibrationRecords(dataRoot) {
  const journal = createSemanticRecordJournal({ root: dataRoot, objectKind: CALIBRATION_OBJECT_KIND });
  return journal.query({ category: CALIBRATION_CATEGORY });
}
