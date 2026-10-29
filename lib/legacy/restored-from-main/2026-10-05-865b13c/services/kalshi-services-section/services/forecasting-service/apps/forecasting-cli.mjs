#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ingestForecastingQuestionFromFile } from "../scripts/ingest-forecasting-question.mjs";
import { fuseForecast } from "../scripts/fuse-forecast.mjs";
import { recordForecast } from "../scripts/record-forecast.mjs";
import { scoreForecast } from "../scripts/score-forecast.mjs";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";

/**
 * Ingest a question and attributable estimates, fuse the estimates, and
 * record a forecast. The caller supplies the sources and their assessments;
 * this operation never invents evidence from the question text.
 * @param {string} questionPath - path to a question JSON file.
 * @param {string} estimatesPath - path to an array of sourced estimates.
 * @param {{dataRoot?: string}} [options]
 * @returns {{question: object, evidence: object[], forecast: object, fusion: object, receipt: object}}
 */
export function runForecastingPipeline(questionPath, estimatesPath, options = {}) {
  const question = ingestForecastingQuestionFromFile(questionPath);
  const evidence = JSON.parse(readFileSync(resolve(estimatesPath), "utf8"));
  const { forecast, fusion } = fuseForecast({ questionId: question.id, evidenceEstimates: evidence });
  const receipt = recordForecast(forecast, { dataRoot: options.dataRoot });
  return { question, evidence, forecast, fusion, receipt };
}

/**
 * Composes the separate scoring pipeline: scores a previously recorded
 * forecast against a resolved outcome and records the calibration entry.
 * @param {string} forecastId
 * @param {0|1} outcome
 * @param {{dataRoot?: string}} [options]
 * @returns {object} the calibration journal record receipt.
 */
export function runForecastingScoring(forecastId, outcome, options = {}) {
  return scoreForecast({ forecastId, outcome }, options);
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "run") {
    const [questionPath, estimatesPath] = rest;
    if (!questionPath || !estimatesPath) throw new Error("usage: forecasting-cli.mjs run <question.json> <estimates.json>");
    return runForecastingPipeline(questionPath, estimatesPath);
  }
  if (command === "score") {
    const [forecastId, outcomeArg] = rest;
    return runForecastingScoring(forecastId, Number(outcomeArg));
  }
  throw new Error('usage: forecasting-cli.mjs run <question.json> <estimates.json> | forecasting-cli.mjs score <forecastId> <outcome 0|1>');
}

runMain(({ argv }) => main(argv), {
  moduleUrl: import.meta.url,
  formatResult: (result) => `${JSON.stringify(result, null, 2)}\n`,
  formatError: (error) => `${error.message}\n`,
  exitCode: 1,
});
