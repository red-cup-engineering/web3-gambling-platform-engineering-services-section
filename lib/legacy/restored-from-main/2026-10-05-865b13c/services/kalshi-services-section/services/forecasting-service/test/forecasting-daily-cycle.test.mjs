import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { runForecastingDailyCycle, discoverKalshiQuestions, readStaticQuestions } from "../apps/forecasting-daily-cycle.mjs";
import { recordForecast, FORECAST_OBJECT_KIND, FORECAST_CATEGORY } from "../scripts/record-forecast.mjs";

const NEVER_OK = async () => ({ ok: false, status: 503, json: async () => ({}) });

function makeScratchRoot() {
  return mkdtempSync(join(tmpdir(), "forecasting-daily-cycle-test-"));
}

test("readStaticQuestions reads every content/questions/*.json file, including the plains-weather resolutionParameters this lot added", () => {
  const questions = readStaticQuestions();
  assert.ok(questions.length >= 11);
  const pineRidge = questions.find((question) => question.id === "pine-ridge-high-temp-90f-2026-09-10");
  assert.ok(pineRidge);
  assert.equal(pineRidge.resolutionParameters.thresholdF, 90);
});

test("discoverKalshiQuestions finds a Kalshi-ticker-shaped questionId recorded in the forecast journal and routes it by series prefix", () => {
  const dataRoot = makeScratchRoot();
  try {
    recordForecast(
      { questionId: "kxhighny-26sep05-t86", probability: 0.2, rationale: "test", evidenceCitations: [{ source: "nws-forecast" }], timestamp: "2026-09-05T00:00:00Z" },
      { dataRoot },
    );
    const found = discoverKalshiQuestions(dataRoot, new Set());
    assert.deepEqual(found, [{ id: "kxhighny-26sep05-t86", sourcePlatform: "kalshi.weather.KXHIGHNY" }]);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("discoverKalshiQuestions routes an unrecognized series prefix to sourcePlatform \"unknown\" rather than guessing", () => {
  const dataRoot = makeScratchRoot();
  try {
    recordForecast(
      { questionId: "kxdenhigh-26sep05-t70", probability: 0.3, rationale: "test", evidenceCitations: [{ source: "nws-forecast" }], timestamp: "2026-09-05T00:00:00Z" },
      { dataRoot },
    );
    const found = discoverKalshiQuestions(dataRoot, new Set());
    assert.deepEqual(found, [{ id: "kxdenhigh-26sep05-t70", sourcePlatform: "unknown" }]);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("runForecastingDailyCycle: with no live source confirming anything, every question reads Open and nothing is scored", async () => {
  const dataRoot = makeScratchRoot();
  try {
    const result = await runForecastingDailyCycle({ dataRoot, now: "2026-09-05T07:24:32Z", fetchImpl: NEVER_OK });
    assert.ok(result.questionCount >= 11);
    assert.ok(result.resolutions.every((resolution) => resolution.type === "Open"));
    assert.equal(result.newlyScoredCount, 0);
    assert.ok(result.calibrationRecords.every((record) => record.type === "Reject" && record.code === "no-resolved-forecasts"));
    assert.equal(result.cycleReceipt.objectKind, "forecasting.daily-cycle-record");
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("runForecastingDailyCycle scores a newly resolved Kalshi question exactly once, and a second run over the same data does not re-score it", async () => {
  const dataRoot = makeScratchRoot();
  try {
    recordForecast(
      { questionId: "kxhighny-26sep04-t86", probability: 0.1, rationale: "house", evidenceCitations: [{ source: "nws-forecast" }], timestamp: "2026-09-04T00:00:00Z" },
      { dataRoot },
    );
    recordForecast(
      { questionId: "kxhighny-26sep04-t86", probability: 0.3, rationale: "market", evidenceCitations: [{ source: "kalshi-market-implied" }], timestamp: "2026-09-04T00:00:00Z" },
      { dataRoot },
    );
    const kalshiSettledFetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/trade-api/v2/markets") {
        return { ok: true, json: async () => ({ markets: [{ ticker: "KXHIGHNY-26SEP04-T86", result: "no" }], cursor: "" }) };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };

    const first = await runForecastingDailyCycle({ dataRoot, now: "2026-09-05T07:24:32Z", fetchImpl: kalshiSettledFetch });
    assert.equal(first.newlyScoredCount, 2); // house + market rows both score
    const resolved = first.resolutions.find((resolution) => resolution.questionId === "kxhighny-26sep04-t86");
    assert.equal(resolved.type, "Resolved");
    assert.equal(resolved.outcome, 0);
    const nyRecord = first.calibrationRecords.find((record) => record.referenceClass === "kalshi.weather.KXHIGHNY");
    assert.equal(nyRecord.type, "CalibrationRecord");
    assert.equal(nyRecord.resolvedForecastCount, 1);
    assert.ok(Math.abs(nyRecord.brierScore - 0.01) < 1e-9);
    assert.ok(Math.abs(nyRecord.marketImpliedBrierScore - 0.09) < 1e-9);

    const second = await runForecastingDailyCycle({ dataRoot, now: "2026-09-05T19:30:00Z", fetchImpl: kalshiSettledFetch });
    assert.equal(second.newlyScoredCount, 0);
    const secondNyRecord = second.calibrationRecords.find((record) => record.referenceClass === "kalshi.weather.KXHIGHNY");
    assert.equal(secondNyRecord.resolvedForecastCount, 1);

    const calibrationJournal = createSemanticRecordJournal({ root: dataRoot, objectKind: "forecasting.calibration-record" });
    const calibrationRows = calibrationJournal.query({ category: "forecasting.calibration" }).filter((row) => row.record?.forecastId);
    assert.equal(calibrationRows.length, 2);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
