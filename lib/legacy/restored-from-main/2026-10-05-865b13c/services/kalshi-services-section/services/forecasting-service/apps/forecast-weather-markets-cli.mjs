#!/usr/bin/env node
// The calibration-gated Kalshi weather-market forecasting loop (three-ways note,
// instrument 2): observes, forecasts, records house-vs-market evidence, scores
// against settlement, and gates any paper sizing step behind the reference
// class's own calibration record -- never a live order.
import { readFileSync } from "node:fs";
import { observeSetOfKalshiWeatherMarkets } from "@red-cup-engineering/kalshi-services-section/observe-set-of-kalshi-weather-markets";
import { deriveSetOfNwsTemperatureForecasts } from "@red-cup-engineering/kalshi-services-section/derive-set-of-nws-temperature-forecasts";
import { sizePosition } from "@red-cup-engineering/position-sizing-service/size-position";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { resolve } from "node:path";
import { normalizeQuestion, createForecast, brierScore, logScore, questionIdFromTicker, referenceClassFromSeries, DATA_ROOT_ENV_VAR } from "../src/forecasting.mjs";
import { recordForecast, FORECAST_CATEGORY, FORECAST_OBJECT_KIND, NODE_ROOT } from "../scripts/record-forecast.mjs";

/**
 * Re-exported so an existing consumer importing this app's own path
 * (`@red-cup-engineering/forecasting/forecast-weather-markets-cli`) keeps
 * working -- the canonical definitions moved to src/forecasting.mjs
 * (2026-09-05) so scripts/resolve-set-of-forecast-questions.mjs can share
 * them without a script importing this app (import law: scripts import
 * scripts and src, never apps).
 */
export { questionIdFromTicker, referenceClassFromSeries };

/** House evidence-source tag distinguishing the NWS-derived forecast row from the Kalshi market-implied row on the same questionId. */
export const HOUSE_EVIDENCE_SOURCE = "nws-forecast";
/** Market evidence-source tag for the Kalshi-implied-probability row recorded beside the house forecast. */
export const MARKET_EVIDENCE_SOURCE = "kalshi-market-implied";
/** The journal category calibration rows for this loop are written and queried under. */
export const CALIBRATION_CATEGORY = "forecasting.kalshi-weather-calibration";
/** The objectKind this loop's semantic record journal uses for calibration rows. */
export const CALIBRATION_OBJECT_KIND = "forecasting.kalshi-weather-calibration-record";

function clampOpenUnitInterval(probability) {
  return Math.min(0.999, Math.max(0.001, probability));
}


function impliedProbabilityFromMid(observation) {
  if (typeof observation.yesBid === "number" && typeof observation.yesAsk === "number" && observation.yesAsk > 0) {
    return (observation.yesBid + observation.yesAsk) / 2;
  }
  if (typeof observation.lastPrice === "number") return observation.lastPrice;
  return null;
}

function journalWithObjectKind(dataRoot, objectKind) {
  return createSemanticRecordJournal({ root: resolve(dataRoot ?? NODE_ROOT), objectKind });
}

function journalFor(dataRoot) {
  return journalWithObjectKind(dataRoot, FORECAST_OBJECT_KIND);
}

function calibrationJournalFor(dataRoot) {
  return journalWithObjectKind(dataRoot, CALIBRATION_OBJECT_KIND);
}

/**
 * Reads a weather-markets loop config (citySeries, errorModel, minResolvedForecasts, paperRiskCapital, kellyMultiple) from a JSON file.
 * @param {string} path
 * @returns {object}
 */
export function readWeatherMarketsConfig(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

/**
 * Counts previously scored house-side calibration rows for one reference class, the falsifier the three-ways note requires before any stake: a stake never exists while this count is under the declared floor.
 * @param {string} referenceClass
 * @param {{dataRoot?: string}} [options]
 * @returns {number}
 */
export function countResolvedCalibrationRows(referenceClass, options = {}) {
  const journal = calibrationJournalFor(options.dataRoot);
  return journal.query({ category: CALIBRATION_CATEGORY }).filter((row) => row.record.referenceClass === referenceClass && row.record.kind === "house").length;
}

/**
 * Builds the paper (never-placed) sleeve-shaped sizing step for one market: refuses with the calibration count when the reference class has not cleared minResolvedForecasts, otherwise sizes a discrete Kelly edge from the house/market probability gap.
 * @param {{observation: object, derivation: object, referenceClass: string, config: object}} input
 * @param {{dataRoot?: string}} [options]
 * @returns {object} a PaperWeatherMarketSizingStep: `{type, paper: true, marketTicker, referenceClass, admitted, ...}`.
 */
export function buildPaperSizingStep({ observation, derivation, referenceClass, config }, options = {}) {
  const resolved = countResolvedCalibrationRows(referenceClass, options);
  const minResolved = config.minResolvedForecasts ?? 30;
  const base = { type: "PaperWeatherMarketSizingStep", version: 1, paper: true, marketTicker: observation.ticker, referenceClass, resolvedCalibrationCount: resolved, minResolvedForecasts: minResolved };
  if (resolved < minResolved) {
    return { ...base, admitted: false, reason: `calibration gate not met: ${resolved}/${minResolved} resolved forecasts for reference class ${referenceClass}` };
  }
  const impliedProbability = impliedProbabilityFromMid(observation);
  const buyYes = derivation.probability > (impliedProbability ?? 0.5);
  const price = buyYes ? observation.yesAsk : (typeof observation.yesBid === "number" ? 1 - observation.yesBid : null);
  if (price === null || price === undefined || price <= 0 || price >= 1) {
    return { ...base, admitted: false, reason: "no valid two-sided price to size an edge against" };
  }
  const winProbability = buyYes ? derivation.probability : 1 - derivation.probability;
  const payoffRatio = (1 - price) / price;
  const sleeve = { riskCapital: config.paperRiskCapital ?? "100", survivalCapital: "0" };
  const sizing = sizePosition({ edge: { winProbability, payoffRatio }, sleeve, liabilityBeyondStake: false, kellyMultiple: config.kellyMultiple ?? 1 });
  return { ...base, side: buyYes ? "yes" : "no", price, sizing };
}

/**
 * Runs one observe-derive-record pass: reads open markets for the config's declared series, derives a house forecast per market from api.weather.gov, records the house forecast and the market's implied-probability row as ForecastingQuestion evidence, and emits (never places) a paper sizing step per market.
 * @param {{configPath: string, dataRoot?: string, now?: string, request?: typeof fetch}} input
 * @returns {Promise<{marketCount: number, forecastCount: number, results: object[]}>}
 */
export async function runObserveAndForecast({ configPath, dataRoot, now, request }) {
  const config = readWeatherMarketsConfig(configPath);
  const observedAt = now ?? new Date().toISOString();
  const seriesTickers = config.citySeries.map((row) => row.seriesTicker);
  const observations = await observeSetOfKalshiWeatherMarkets({ seriesTickers, observedAt }, { fetchImpl: request });
  const omittedMarkets = observations.filter((observation) => !observation.targetDate).map((observation) => ({
    ticker: observation.ticker,
    reason: "event ticker has no recognized weather target date",
  }));
  const brackets = observations.filter((observation) => observation.targetDate).map((observation) => ({
    marketTicker: observation.ticker,
    city: observation.seriesTicker,
    targetDate: observation.targetDate,
    strikeType: observation.strikeType,
    floorStrike: observation.floorStrike,
    capStrike: observation.capStrike,
    closeTime: observation.closeTime,
  }));
  const cityStations = config.citySeries.map((row) => ({ city: row.seriesTicker, gridId: row.gridId, gridX: row.gridX, gridY: row.gridY }));
  const derivations = await deriveSetOfNwsTemperatureForecasts({ cityStations, brackets, asOf: observedAt, errorModel: config.errorModel }, { fetchImpl: request });
  const derivationByTicker = new Map(derivations.map((derivation) => [derivation.marketTicker, derivation]));

  const results = [];
  for (const observation of observations) {
    const derivation = derivationByTicker.get(observation.ticker);
    if (!derivation) {
      if (observation.targetDate) omittedMarkets.push({
        ticker: observation.ticker,
        targetDate: observation.targetDate,
        reason: "NWS returned no matching daytime forecast period",
      });
      continue;
    }
    const referenceClass = referenceClassFromSeries(observation.seriesTicker);
    const questionId = questionIdFromTicker(observation.ticker);
    const houseProbability = clampOpenUnitInterval(derivation.probability);
    const question = normalizeQuestion({
      id: questionId,
      title: observation.title ?? observation.ticker,
      resolutionCriteria: observation.settlementSourceText || `Kalshi market ${observation.ticker}`,
      openAt: observedAt,
      closeAt: observation.closeTime,
      resolveAt: observation.settlementTime ?? observation.closeTime,
      sourcePlatform: referenceClass,
    });
    const houseForecast = createForecast({
      questionId: question.id,
      probability: houseProbability,
      rationale: `NWS forecast high ${derivation.forecastHigh}${derivation.forecastHighUnit} (${derivation.forecastPeriodName}) via ${derivation.forecastSource}; normal error model stdDev=${derivation.stdDevUsed} at lead ${derivation.leadDays}d.`,
      evidenceCitations: [{ source: HOUSE_EVIDENCE_SOURCE, url: derivation.forecastSource, note: `eventTicker=${observation.eventTicker}, targetDate=${derivation.targetDate}, period=${derivation.forecastPeriodStartTime}..${derivation.forecastPeriodEndTime}, forecastHigh=${derivation.forecastHigh}${derivation.forecastHighUnit}, stdDev=${derivation.stdDevUsed}, leadDays=${derivation.leadDays}, observedAt=${observedAt}` }],
      timestamp: observedAt,
    });
    const houseReceipt = recordForecast(houseForecast, { dataRoot });

    const impliedProbability = impliedProbabilityFromMid(observation);
    let marketReceipt = null;
    if (impliedProbability !== null) {
      const marketForecast = createForecast({
        questionId: question.id,
        probability: clampOpenUnitInterval(impliedProbability),
        rationale: `Kalshi market implied probability from mid of yes bid ${observation.yesBid} / yes ask ${observation.yesAsk} (fallback lastPrice ${observation.lastPrice}).`,
        evidenceCitations: [{ source: MARKET_EVIDENCE_SOURCE, url: observation.sourceUrl, note: `ticker=${observation.ticker}, yesBid=${observation.yesBid}, yesAsk=${observation.yesAsk}, lastPrice=${observation.lastPrice}, observedAt=${observation.observedAt}` }],
        timestamp: observedAt,
      });
      marketReceipt = recordForecast(marketForecast, { dataRoot });
    }

    const sizingStep = buildPaperSizingStep({ observation, derivation, referenceClass, config }, { dataRoot });
    results.push({ ticker: observation.ticker, questionId: question.id, referenceClass, houseProbability, impliedProbability, houseReceiptId: houseReceipt.id, marketReceiptId: marketReceipt?.id ?? null, sizingStep });
  }
  return { marketCount: observations.length, forecastCount: results.length, omittedMarkets, results };
}

/**
 * Scores every settled market Kalshi reports for the config's declared series against Kalshi's own settlement result, using the proper scoring rules already in this section (brierScore, logScore) for both the recorded house and market forecast rows, and journals each under its reference class's calibration category.
 * @param {{configPath: string, dataRoot?: string, now?: string, request?: typeof fetch}} input
 * @returns {Promise<{settledMarketCount: number, calibrationRowsWritten: number}>}
 */
export async function runScoreClosedMarkets({ configPath, dataRoot, now, request }) {
  const config = readWeatherMarketsConfig(configPath);
  const observedAt = now ?? new Date().toISOString();
  const seriesTickers = config.citySeries.map((row) => row.seriesTicker);
  const settled = await observeSetOfKalshiWeatherMarkets({ seriesTickers, observedAt, status: "settled" }, { fetchImpl: request });
  const forecastJournal = journalFor(dataRoot);
  const calibrationJournal = calibrationJournalFor(dataRoot);
  // Each forecast is scored once: daily runs see every settled market again.
  const scored = new Set(calibrationJournal.query({ category: CALIBRATION_CATEGORY }).map((row) => row.record.forecastId));

  let calibrationRowsWritten = 0;
  for (const observation of settled) {
    if (observation.result !== "yes" && observation.result !== "no") continue;
    const outcome = observation.result === "yes" ? 1 : 0;
    const questionId = questionIdFromTicker(observation.ticker);
    const referenceClass = referenceClassFromSeries(observation.seriesTicker);
    const forecastRows = forecastJournal.query({ category: FORECAST_CATEGORY }).filter((row) => row.record.questionId === questionId);
    for (const row of forecastRows) {
      if (scored.has(row.id)) continue;
      const source = row.record.evidenceCitations?.[0]?.source;
      const kind = source === MARKET_EVIDENCE_SOURCE ? "market" : source === HOUSE_EVIDENCE_SOURCE ? "house" : null;
      if (!kind) continue;
      const probability = row.record.probability;
      const brier = brierScore(probability, outcome);
      let log = null, logScoreUndefinedReason = null;
      try { log = logScore(probability, outcome); } catch (error) { logScoreUndefinedReason = error.message; }
      calibrationJournal.record({
        category: CALIBRATION_CATEGORY,
        recordedAt: observedAt,
        record: { referenceClass, forecastId: row.id, questionId, kind, probability, outcome, brierScore: brier, logScore: log, logScoreUndefinedReason, scoredAt: observedAt },
        told: { for: true, against: false },
      });
      scored.add(row.id);
      calibrationRowsWritten += 1;
    }
  }
  return { settledMarketCount: settled.length, calibrationRowsWritten };
}

/**
 * Prints, per reference class, the resolved (house-side) count, the mean house and market Brier score, and whether the thirty-resolved-forecast calibration gate the three-ways note requires is met.
 * @param {{dataRoot?: string}} [options]
 * @returns {object[]} one CalibrationReadout row per reference class.
 */
export function runCalibrationReport(options = {}) {
  const journal = calibrationJournalFor(options.dataRoot);
  const rows = journal.query({ category: CALIBRATION_CATEGORY });
  const byReferenceClass = new Map();
  for (const row of rows) {
    const referenceClass = row.record.referenceClass;
    if (!byReferenceClass.has(referenceClass)) byReferenceClass.set(referenceClass, { house: [], market: [] });
    byReferenceClass.get(referenceClass)[row.record.kind]?.push(row.record.brierScore);
  }
  const mean = (values) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);
  const minResolved = options.minResolvedForecasts ?? 30;
  return [...byReferenceClass.entries()].map(([referenceClass, buckets]) => ({
    referenceClass,
    resolvedCount: buckets.house.length,
    houseBrier: mean(buckets.house),
    marketBrier: mean(buckets.market),
    calibrationGateMet: buckets.house.length >= minResolved,
  }));
}

/**
 * Refuses to place any order: this loop is paper-only for as long as no reference class clears its calibration gate, and even once one does, placement stays a distinct, Leader-activated venue action this loop never performs.
 * @returns {{type: "PlacementRefusal", code: "paper-only-loop", detail: string}}
 */
export function refusePlacement() {
  return { type: "PlacementRefusal", code: "paper-only-loop", detail: "forecast-weather-markets-cli never places a live order; it only records forecasts and emits paper sizing steps. Live placement is a distinct, Leader-activated venue action belonging to the Kalshi order-executor office." };
}

/**
 * Resolves this CLI's dataRoot precedence: an explicit `--data-root` flag
 * wins over `DATA_ROOT_ENV_VAR`, which wins over `undefined` (record-forecast.mjs's
 * own package-root NODE_ROOT default) -- added 2026-09-05 so a deployed
 * unit can share one state root with forecasting-daily-cycle.mjs via one
 * wired environment file.
 * @param {string[]} rest - argv with the command word already removed.
 * @param {Record<string,string|undefined>} [env] - defaults to process.env.
 * @returns {string|undefined}
 */
export function resolveCliDataRoot(rest, env = process.env) {
  const dataRootFlagAt = rest.indexOf("--data-root");
  return dataRootFlagAt === -1 ? env[DATA_ROOT_ENV_VAR] : rest[dataRootFlagAt + 1];
}

async function main(argv) {
  const [command, ...rest] = argv;
  const configFlagAt = rest.indexOf("--config");
  const configPath = configFlagAt === -1
    ? resolve(new URL("../content/config/weather-markets.json", import.meta.url).pathname)
    : rest[configFlagAt + 1];
  const dataRoot = resolveCliDataRoot(rest);
  if (command === "run") return runObserveAndForecast({ configPath, dataRoot });
  if (command === "score") return runScoreClosedMarkets({ configPath, dataRoot });
  if (command === "calibration") return runCalibrationReport({ dataRoot });
  if (command === "place") return refusePlacement();
  throw new Error("usage: forecast-weather-markets-cli.mjs run|score|calibration|place [--config <path>] [--data-root <path>]");
}

runMain(({ argv }) => main(argv), {
  moduleUrl: import.meta.url,
  formatResult: (result) => `${JSON.stringify(result, null, 2)}\n`,
  formatError: (error) => `${error.message}\n`,
  exitCode: 1,
});
