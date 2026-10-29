#!/usr/bin/env node
// Resolves forecasting questions against machine-readable public sources
// (Kalshi settled markets, api.weather.gov observations, a configured
// goods-prices JSON series), or reports Open with a reason -- never an
// estimate. See the exported function's JSDoc for the full contract.
import { observeSetOfKalshiWeatherMarkets } from "@red-cup-engineering/kalshi-services-section/observe-set-of-kalshi-weather-markets";
import { questionIdFromTicker } from "../src/forecasting.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

const KALSHI_STATUS_SETTLED = "settled";
const KALSHI_WEATHER_PREFIX = "kalshi.weather.";
const PLAINS_WEATHER_SOURCE = "indian-country.plains-weather";
const GOODS_PRICES_SOURCE = "indian-country.goods-prices";
const TRIBAL_ELECTIONS_SOURCE = "indian-country.tribal-elections";
const COURT_CASES_SOURCE = "indian-country.court-cases";
const NWS_API_BASE = "https://api.weather.gov";
const NWS_USER_AGENT = "561-group-forecasting-services-section (forecasting@561.group)";

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`resolve-set-of-forecast-questions: ${label} must be an array`);
  return value;
}
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`resolve-set-of-forecast-questions: ${label} must be a non-empty string`);
  return value;
}
function requireIsoTimestamp(value, label) {
  requireNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`resolve-set-of-forecast-questions: ${label} must be a parseable ISO 8601 timestamp, got ${JSON.stringify(value)}`);
  return value;
}
function requireQuestion(row, index) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) throw new TypeError(`resolve-set-of-forecast-questions: request.questions[${index}] must be an object`);
  requireNonEmptyString(row.id, `request.questions[${index}].id`);
  requireNonEmptyString(row.sourcePlatform, `request.questions[${index}].sourcePlatform`);
  return row;
}

const openResolution = (questionId, reason) => ({ type: "Open", questionId, reason });
const resolvedResolution = (questionId, outcome, witness, resolvedAt) => ({ type: "Resolved", questionId, outcome, witness, resolvedAt });

async function fetchJson(url, fetchImpl, extraHeaders) {
  const response = await fetchImpl(url, { headers: { accept: "application/json", ...extraHeaders } });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  return response.json();
}

// Matches settled Kalshi observations back to a question by recomputing
// questionIdFromTicker on the observation's own ticker -- never by
// guessing a ticker back out of a lossy id.
async function resolveKalshiWeatherQuestions(questions, seriesTicker, now, fetchImpl) {
  let settled;
  try {
    settled = await observeSetOfKalshiWeatherMarkets({ seriesTickers: [seriesTicker], observedAt: now, status: KALSHI_STATUS_SETTLED }, { fetchImpl });
  } catch (error) {
    return questions.map((question) => openResolution(question.id, `kalshi settled-market read failed for series ${seriesTicker}: ${error.message}`));
  }
  const bySettledQuestionId = new Map(settled.map((observation) => [questionIdFromTicker(observation.ticker), observation]));
  return questions.map((question) => {
    const observation = bySettledQuestionId.get(question.id);
    if (!observation) {
      return openResolution(question.id, `no settled Kalshi market found for ${question.id} in series ${seriesTicker} as of ${now}`);
    }
    if (observation.result !== "yes" && observation.result !== "no") {
      return openResolution(question.id, `kalshi market ${observation.ticker} carries no definitive yes/no result yet`);
    }
    return resolvedResolution(
      question.id,
      observation.result === "yes" ? 1 : 0,
      { sourceUrl: `https://api.elections.kalshi.com/trade-api/v2/markets/${observation.ticker}`, fetchedAt: now, rawValue: observation.result },
      now,
    );
  });
}

// Chains api.weather.gov's public, keyless points -> gridpoints/stations ->
// station-observations endpoints for one question's configured
// resolutionParameters. Open (never estimated) when parameters are absent,
// no station is found, or no observation exists yet for the target date.
async function resolvePlainsWeatherQuestion(question, now, fetchImpl) {
  const parameters = question.resolutionParameters;
  if (!parameters || typeof parameters !== "object") {
    return openResolution(question.id, "no resolutionParameters (lat/lon/targetDate/metric/threshold) configured for indian-country.plains-weather; cannot read api.weather.gov without them");
  }
  const { lat, lon, targetDate, metric, comparison } = parameters;
  try {
    const point = await fetchJson(`${NWS_API_BASE}/points/${lat},${lon}`, fetchImpl, { "user-agent": NWS_USER_AGENT });
    const { gridId, gridX, gridY } = point.properties ?? {};
    if (!gridId || gridX === undefined || gridY === undefined) {
      return openResolution(question.id, `api.weather.gov points lookup for ${lat},${lon} returned no gridpoint`);
    }
    const stationsPayload = await fetchJson(`${NWS_API_BASE}/gridpoints/${gridId}/${gridX},${gridY}/stations`, fetchImpl, { "user-agent": NWS_USER_AGENT });
    const stationId = stationsPayload.features?.[0]?.properties?.stationIdentifier;
    if (!stationId) return openResolution(question.id, `no api.weather.gov observation station found near ${lat},${lon}`);
    const start = `${targetDate}T00:00:00Z`;
    const end = `${targetDate}T23:59:59Z`;
    const observationsUrl = `${NWS_API_BASE}/stations/${stationId}/observations?start=${start}&end=${end}`;
    const observationsPayload = await fetchJson(observationsUrl, fetchImpl, { "user-agent": NWS_USER_AGENT });
    const features = observationsPayload.features ?? [];
    if (features.length === 0) {
      return openResolution(question.id, `no api.weather.gov observations yet for station ${stationId} on ${targetDate}`);
    }
    if (metric === "maxTemperature") {
      const celsiusValues = features.map((feature) => feature.properties?.temperature?.value).filter((value) => typeof value === "number");
      if (celsiusValues.length === 0) return openResolution(question.id, `station ${stationId} reported no temperature readings for ${targetDate}`);
      const maxFahrenheit = (Math.max(...celsiusValues) * 9) / 5 + 32;
      const outcome = comparison === "lte" ? (maxFahrenheit <= parameters.thresholdF ? 1 : 0) : (maxFahrenheit >= parameters.thresholdF ? 1 : 0);
      return resolvedResolution(question.id, outcome, { sourceUrl: observationsUrl, fetchedAt: now, rawValue: maxFahrenheit }, now);
    }
    if (metric === "precipitation") {
      const millimeterValues = features.map((feature) => feature.properties?.precipitationLastHour?.value).filter((value) => typeof value === "number");
      const totalInches = millimeterValues.reduce((sum, value) => sum + value, 0) / 25.4;
      const thresholdIn = parameters.thresholdIn ?? 0.01;
      const outcome = comparison === "lte" ? (totalInches <= thresholdIn ? 1 : 0) : (totalInches >= thresholdIn ? 1 : 0);
      return resolvedResolution(question.id, outcome, { sourceUrl: observationsUrl, fetchedAt: now, rawValue: totalInches }, now);
    }
    return openResolution(question.id, `unrecognized indian-country.plains-weather metric ${JSON.stringify(metric)}`);
  } catch (error) {
    return openResolution(question.id, `api.weather.gov read failed: ${error.message}`);
  }
}

function readJsonPath(payload, path) {
  return String(path).split(".").reduce((accumulator, key) => (accumulator === null || accumulator === undefined ? undefined : accumulator[key]), payload);
}

// Reads a generically configured published-series JSON URL
// (resolutionParameters.seriesUrl + jsonPath + comparison + threshold).
// Open (never estimated) when no seriesUrl is configured -- true today for
// every shipped goods-prices question, since EIA and USDA AMS
// programmatic access both require a registered API key this operation
// does not hold (the house credential fence).
async function resolveGoodsPricesQuestion(question, now, fetchImpl) {
  const parameters = question.resolutionParameters;
  if (!parameters || typeof parameters.seriesUrl !== "string" || parameters.seriesUrl.length === 0) {
    return openResolution(question.id, "no resolutionParameters.seriesUrl configured for indian-country.goods-prices (EIA and USDA AMS programmatic access both require a registered API key this operation does not hold); resolves manually against eia.gov/petroleum/heatingoilpropane or ams.usda.gov reports");
  }
  const { seriesUrl, jsonPath, comparison, threshold } = parameters;
  try {
    const payload = await fetchJson(seriesUrl, fetchImpl, {});
    const value = readJsonPath(payload, jsonPath);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return openResolution(question.id, `no numeric value found at jsonPath ${jsonPath} in ${seriesUrl} yet`);
    }
    const outcome = comparison === "lte" ? (value <= threshold ? 1 : 0) : (value >= threshold ? 1 : 0);
    return resolvedResolution(question.id, outcome, { sourceUrl: seriesUrl, fetchedAt: now, rawValue: value }, now);
  } catch (error) {
    return openResolution(question.id, `indian-country.goods-prices series read failed: ${error.message}`);
  }
}

/**
 * Resolves a set of open forecasting questions against their machine-readable public sources, or reports each as still Open with an explicit, honest reason -- never an estimate. Kalshi weather markets (sourcePlatform "kalshi.weather.<SERIES>") are checked against Kalshi's public settled-market listing; indian-country.plains-weather questions carrying resolutionParameters are checked against api.weather.gov's public station-observation endpoints; indian-country.goods-prices questions carrying a resolutionParameters.seriesUrl are checked against that published JSON series; indian-country.tribal-elections and indian-country.court-cases have no machine-readable source and always report Open, naming the institutional source a human must confirm against; any other sourcePlatform reports Open naming the gap.
 * @param {object} request A ResolveSetOfForecastQuestionsRequest.
 * @param {{id: string, sourcePlatform: string, resolveAt?: string, closeAt?: string, resolutionParameters?: object}[]} request.questions Open questions to attempt resolution for.
 * @param {string} request.now ISO 8601 timestamp this resolution pass is run at.
 * @param {{fetchImpl?: typeof fetch}} [options] `fetchImpl` overrides the network call for tests and fixtures; defaults to the global fetch.
 * @returns {Promise<({type: "Resolved", questionId: string, outcome: (0|1), witness: {sourceUrl: string, fetchedAt: string, rawValue: *}, resolvedAt: string}|{type: "Open", questionId: string, reason: string})[]>} One Resolution datum per input question, in input order.
 * @throws {TypeError} When the request or a question row is malformed.
 */
export async function resolveSetOfForecastQuestions(request, options = {}) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("resolve-set-of-forecast-questions: request must be a JSON object");
  }
  const questions = requireArray(request.questions, "request.questions").map(requireQuestion);
  const now = requireIsoTimestamp(request.now, "request.now");
  const fetchImpl = options.fetchImpl ?? fetch;

  const byPlatform = new Map();
  for (const question of questions) {
    if (!byPlatform.has(question.sourcePlatform)) byPlatform.set(question.sourcePlatform, []);
    byPlatform.get(question.sourcePlatform).push(question);
  }

  const results = new Map();
  for (const [sourcePlatform, group] of byPlatform) {
    if (sourcePlatform.startsWith(KALSHI_WEATHER_PREFIX)) {
      const seriesTicker = sourcePlatform.slice(KALSHI_WEATHER_PREFIX.length);
      for (const resolution of await resolveKalshiWeatherQuestions(group, seriesTicker, now, fetchImpl)) results.set(resolution.questionId, resolution);
      continue;
    }
    if (sourcePlatform === PLAINS_WEATHER_SOURCE) {
      for (const question of group) results.set(question.id, await resolvePlainsWeatherQuestion(question, now, fetchImpl));
      continue;
    }
    if (sourcePlatform === GOODS_PRICES_SOURCE) {
      for (const question of group) results.set(question.id, await resolveGoodsPricesQuestion(question, now, fetchImpl));
      continue;
    }
    if (sourcePlatform === TRIBAL_ELECTIONS_SOURCE) {
      for (const question of group) results.set(question.id, openResolution(question.id, "tribal election certification is not machine-integrated; resolves manually against the tribe's own Election Board/Commission announcement or Indianz.com/Native News Online reporting"));
      continue;
    }
    if (sourcePlatform === COURT_CASES_SOURCE) {
      for (const question of group) results.set(question.id, openResolution(question.id, "court docket outcomes are not machine-integrated; resolves manually against SCOTUSblog's docket or Turtle Talk's case tracker"));
      continue;
    }
    for (const question of group) results.set(question.id, openResolution(question.id, `no resolution mechanism configured for sourcePlatform ${JSON.stringify(sourcePlatform)}`));
  }

  return questions.map((question) => results.get(question.id));
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "resolve-set-of-forecast-questions", description: "Resolves a set of open forecasting questions against their machine-readable public sources, or reports each as still Open with an explicit, honest reason -- never an estimate.", operation: resolveSetOfForecastQuestions }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
