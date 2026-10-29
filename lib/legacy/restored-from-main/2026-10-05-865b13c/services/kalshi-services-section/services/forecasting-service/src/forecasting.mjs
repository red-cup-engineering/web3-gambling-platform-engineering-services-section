/**
 * Forecasting domain semantics: canonical question/forecast record shapes,
 * proper scoring rules, and calibration-curve computation. Pure -- no I/O.
 * Seated in economics-and-business-science (forecasting-for-fee is
 * calibrated judgment sold as a service, not duplicating any sibling
 * section) as the inversion of the retired Alpaca capital-at-risk trading
 * enterprise: judgment earns a fee, no capital is ever at risk.
 */

import { slugify } from "@red-cup-engineering/computer-text-content-engineering-services-section/slugify-text";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** @typedef {{id: string, title: string, resolutionCriteria: string, openAt: string, closeAt: string, resolveAt: string, sourcePlatform: string}} ForecastingQuestion A canonical forecasting question: `id` is lowercase-hyphen; `openAt`/`closeAt`/`resolveAt` are ISO 8601; `sourcePlatform` names the venue (e.g. "metaculus-aib-minibench"). */

/** @typedef {{source: string, url?: string, note?: string}} EvidenceCitation One evidence source a forecast drew on. */

/** @typedef {{questionId: string, probability: number, rationale: string, evidenceCitations: EvidenceCitation[], timestamp: string}} ForecastRecord A canonical forecast: `probability` of YES in [0,1]; `rationale` is required non-empty reasoning (mirrors Metaculus AIB's rule that every bot forecast must post its reasoning); `timestamp` is ISO 8601. */

/**
 * Normalizes a Kalshi bracket ticker (e.g. "KXHIGHNY-26SEP05-B85.5") into
 * this section's lowercase-hyphen ForecastingQuestion id. Moved here
 * 2026-09-05 from apps/forecast-weather-markets-cli.mjs (re-exported there
 * unchanged for its existing consumers) so scripts/resolve-set-of-forecast-questions.mjs
 * can share the same transform without a script importing an app (import
 * law: scripts import scripts and src, never apps).
 * @param {string} ticker
 * @returns {string}
 */
export function questionIdFromTicker(ticker) {
  // A bracket ticker like "KXHIGHNY-26SEP05-B85.5" carries a decimal strike;
  // this id must be lowercase-hyphen only, so any run of non [a-z0-9]
  // characters (the "." here) becomes one hyphen.
  return slugify(ticker);
}

/**
 * The calibration reference class for one Kalshi weather series. Moved
 * here 2026-09-05 alongside questionIdFromTicker (see that function's doc).
 * @param {string} seriesTicker
 * @returns {string}
 */
export function referenceClassFromSeries(seriesTicker) {
  return `kalshi.weather.${seriesTicker}`;
}

/**
 * The environment variable name every deployed unit of this section reads
 * its journal data root from (one state root shared by
 * forecast-weather-markets-cli.mjs's run/score commands and
 * forecasting-daily-cycle.mjs), so one release-package-on-host
 * environment file wires all of them consistently. Added 2026-09-05
 * (coordinator ruling: one state root).
 * @type {string}
 */
export const DATA_ROOT_ENV_VAR = "FORECASTING_DAILY_CYCLE_DATA_ROOT";

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`forecasting: ${label} must be a non-empty string`);
  return value;
}

function requireIsoTimestamp(value, label) {
  requireNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`forecasting: ${label} must be a parseable ISO 8601 timestamp, got ${JSON.stringify(value)}`);
  return value;
}

function requireId(value, label) {
  requireNonEmptyString(value, label);
  if (!ID.test(value)) throw new TypeError(`forecasting: ${label} must be lowercase-hyphen (matching ${ID}), got ${JSON.stringify(value)}`);
  return value;
}

/**
 * Validates and normalizes a raw question object into a canonical, frozen
 * {@link ForecastingQuestion}. Throws a descriptive TypeError on any
 * malformed field.
 * @param {unknown} input
 * @returns {Readonly<ForecastingQuestion>}
 */
export function normalizeQuestion(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("forecasting: question must be a JSON object");
  }
  const id = requireId(input.id, "question.id");
  const title = requireNonEmptyString(input.title, "question.title");
  const resolutionCriteria = requireNonEmptyString(input.resolutionCriteria, "question.resolutionCriteria");
  const openAt = requireIsoTimestamp(input.openAt, "question.openAt");
  const closeAt = requireIsoTimestamp(input.closeAt, "question.closeAt");
  const resolveAt = requireIsoTimestamp(input.resolveAt, "question.resolveAt");
  const sourcePlatform = requireNonEmptyString(input.sourcePlatform, "question.sourcePlatform");
  if (Date.parse(closeAt) < Date.parse(openAt)) throw new TypeError("forecasting: question.closeAt must not precede question.openAt");
  if (Date.parse(resolveAt) < Date.parse(closeAt)) throw new TypeError("forecasting: question.resolveAt must not precede question.closeAt");
  return Object.freeze({ id, title, resolutionCriteria, openAt, closeAt, resolveAt, sourcePlatform });
}

function requireUnitInterval(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`forecasting: ${label} must be a finite number in [0,1], got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Validates and normalizes a raw forecast object into a canonical, frozen
 * {@link ForecastRecord}. `rationale` is required and non-empty: an AIB bot
 * forecast without stated reasoning is not admissible, and neither is one
 * here.
 * @param {unknown} input
 * @returns {Readonly<ForecastRecord>}
 */
export function createForecast(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("forecasting: forecast must be a JSON object");
  }
  const questionId = requireId(input.questionId, "forecast.questionId");
  const probability = requireUnitInterval(input.probability, "forecast.probability");
  const rationale = requireNonEmptyString(input.rationale, "forecast.rationale");
  if (!Array.isArray(input.evidenceCitations) || input.evidenceCitations.length === 0) {
    throw new TypeError("forecasting: forecast.evidenceCitations must be a non-empty array");
  }
  const evidenceCitations = input.evidenceCitations.map((citation, index) => {
    if (typeof citation !== "object" || citation === null || Array.isArray(citation)) {
      throw new TypeError(`forecasting: forecast.evidenceCitations[${index}] must be an object`);
    }
    return Object.freeze({
      source: requireNonEmptyString(citation.source, `forecast.evidenceCitations[${index}].source`),
      ...(citation.url !== undefined ? { url: requireNonEmptyString(citation.url, `forecast.evidenceCitations[${index}].url`) } : {}),
      ...(citation.note !== undefined ? { note: requireNonEmptyString(citation.note, `forecast.evidenceCitations[${index}].note`) } : {}),
    });
  });
  const timestamp = requireIsoTimestamp(input.timestamp, "forecast.timestamp");
  return Object.freeze({ questionId, probability, rationale, evidenceCitations: Object.freeze(evidenceCitations), timestamp });
}

function requireOutcome(outcome) {
  if (outcome !== 0 && outcome !== 1) throw new TypeError(`forecasting: outcome must be exactly 0 or 1, got ${JSON.stringify(outcome)}`);
  return outcome;
}

/**
 * The Brier score: the mean squared error between a stated probability and
 * the realized binary outcome. Lower is better; 0 is a perfect forecast.
 * `(probability - outcome) ** 2`.
 * @param {number} probability - in [0,1].
 * @param {0|1} outcome
 * @returns {number}
 */
export function brierScore(probability, outcome) {
  requireUnitInterval(probability, "probability");
  requireOutcome(outcome);
  return (probability - outcome) ** 2;
}

/**
 * The logarithmic (log) scoring rule: `-log(probability)` when the outcome
 * is YES, `-log(1 - probability)` when NO. Lower is better; 0 is a perfect
 * forecast, and the penalty diverges to +Infinity as a confident forecast
 * is proven wrong. `probability` must lie in the OPEN interval (0,1): at
 * probability=0 with outcome=1, `-log(0)` is undefined
 * (`Math.log(0) === -Infinity` in IEEE 754, so the negated score would be
 * `+Infinity`, not a finite number); the symmetric case (probability=1,
 * outcome=0) is undefined the same way on `1 - probability`. A calibrated
 * forecaster should never state an exact 0 or 1, so this is a validation
 * boundary, not merely a numerical inconvenience.
 * @param {number} probability - in the open interval (0,1).
 * @param {0|1} outcome
 * @returns {number}
 * @throws {TypeError} when probability is not strictly inside (0,1).
 */
export function logScore(probability, outcome) {
  requireUnitInterval(probability, "probability");
  requireOutcome(outcome);
  if (probability === 0 || probability === 1) {
    throw new TypeError(`forecasting: logScore requires probability strictly inside (0,1) -- log(0) is undefined, got probability=${probability}`);
  }
  return outcome === 1 ? -Math.log(probability) : -Math.log(1 - probability);
}

/** @typedef {{probability: number, outcome: (0|1)}} CalibrationObservation One stated probability paired with its realized binary outcome. */

/** @typedef {{bucketIndex: number, rangeLow: number, rangeHigh: number, count: number, meanStatedProbability: (number|null), realizedFrequency: (number|null)}} CalibrationBucket One calibration bucket: `rangeLow`/`rangeHigh` bound its probability range; `meanStatedProbability` and `realizedFrequency` are null when `count` is 0. */

/**
 * Computes a calibration curve: groups observations into `bucketCount`
 * equal-width probability buckets (deciles by default) and, per bucket,
 * the mean stated probability against the realized outcome frequency. A
 * perfectly calibrated forecaster has `meanStatedProbability ===
 * realizedFrequency` in every non-empty bucket.
 * @param {CalibrationObservation[]} observations
 * @param {{ bucketCount?: number }} [options] - `bucketCount` defaults to 10 (deciles).
 * @returns {CalibrationBucket[]} exactly `bucketCount` buckets, in order, including empty ones.
 */
export function calibrationBuckets(observations, options = {}) {
  const bucketCount = options.bucketCount ?? 10;
  if (!Number.isInteger(bucketCount) || bucketCount < 1) {
    throw new TypeError(`forecasting: calibrationBuckets requires an integer bucketCount >= 1, got ${JSON.stringify(bucketCount)}`);
  }
  if (!Array.isArray(observations)) throw new TypeError("forecasting: calibrationBuckets requires an array of observations");
  const bucketed = Array.from({ length: bucketCount }, () => []);
  observations.forEach((observation, index) => {
    if (typeof observation !== "object" || observation === null) throw new TypeError(`forecasting: observations[${index}] must be an object`);
    const probability = requireUnitInterval(observation.probability, `observations[${index}].probability`);
    const outcome = requireOutcome(observation.outcome);
    const bucketIndex = Math.min(bucketCount - 1, Math.floor(probability * bucketCount));
    bucketed[bucketIndex].push({ probability, outcome });
  });
  return bucketed.map((rows, bucketIndex) => {
    const rangeLow = bucketIndex / bucketCount;
    const rangeHigh = (bucketIndex + 1) / bucketCount;
    const count = rows.length;
    const meanStatedProbability = count === 0 ? null : rows.reduce((sum, row) => sum + row.probability, 0) / count;
    const realizedFrequency = count === 0 ? null : rows.reduce((sum, row) => sum + row.outcome, 0) / count;
    return Object.freeze({ bucketIndex, rangeLow, rangeHigh, count, meanStatedProbability, realizedFrequency });
  });
}
