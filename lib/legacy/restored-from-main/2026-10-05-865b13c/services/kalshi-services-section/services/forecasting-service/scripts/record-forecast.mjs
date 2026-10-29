#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";

/** This package's own root, the default semantic-record-journal custody root (writes land at data/logs/, per house data-custody law). */
export const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The objectKind this section's semantic record journal uses for forecast records. */
export const FORECAST_OBJECT_KIND = "forecasting.forecast-record";

/** The journal category forecast records are written and queried under. */
export const FORECAST_CATEGORY = "forecasting.forecast";

/**
 * Records one canonical forecast (from fuse-forecast.mjs) into this
 * section's semantic record journal.
 * @param {import("../src/forecasting.mjs").ForecastRecord} forecast
 * @param {{dataRoot?: string, recordedAt?: string}} [options]
 * @returns {{id: string, objectKind: string, appended: number, appended: number, told: { for: boolean, against: boolean }}} the journal's record receipt.
 * @throws {TypeError} when forecast lacks a questionId.
 */
export function recordForecast(forecast, options = {}) {
  if (!forecast || typeof forecast.questionId !== "string" || forecast.questionId.length === 0) {
    throw new TypeError("record-forecast: forecast requires a non-empty questionId");
  }
  const dataRoot = resolve(options.dataRoot ?? NODE_ROOT);
  const journal = createSemanticRecordJournal({ root: dataRoot, objectKind: FORECAST_OBJECT_KIND });
  return journal.record({
    category: FORECAST_CATEGORY,
    recordedAt: options.recordedAt ?? forecast.timestamp ?? new Date().toISOString(),
    record: forecast,
    told: { for: true, against: false },
  });
}

if (import.meta.main) {
  const [path] = process.argv.slice(2);
  if (!path) {
    process.stderr.write("usage: record-forecast.mjs <forecast.json>\n");
    process.exitCode = 2;
  } else {
    const forecast = JSON.parse(readFileSync(resolve(path), "utf8"));
    process.stdout.write(`${JSON.stringify(recordForecast(forecast), null, 2)}\n`);
  }
}
