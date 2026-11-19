# resolve-set-of-forecast-questions
## Requirements
- `kalshi-weather-settled-lookup`: For every question whose `sourcePlatform` starts with `kalshi.weather.`, the operation reads Kalshi's public settled-market listing for that series (via `@red-cup-engineering/observe-set-of-kalshi-weather-markets-service`, `status: "settled"`) and matches a settled observation back to the question by recomputing `questionIdFromTicker` on the observation's own ticker, never by reconstructing a ticker out of the lossy id.
- `plains-weather-observation-chain`: For every `indian-country.plains-weather` question carrying `resolutionParameters` (`lat`, `lon`, `targetDate`, `metric`, `comparison`, `thresholdF`|`thresholdIn`), the operation chains api.weather.gov's public, keyless `/points/{lat},{lon}` -> `/gridpoints/{gridId}/{gridX},{gridY}/stations` -> `/stations/{stationId}/observations` endpoints and compares the observed maximum temperature or total precipitation for `targetDate` against the threshold.
- `goods-prices-configured-series`: For every `indian-country.goods-prices` question carrying `resolutionParameters.seriesUrl` (plus `jsonPath`, `comparison`, `threshold`), the operation reads that JSON URL and compares the value at `jsonPath` against the threshold.
- `witnessed-resolution`: Every `Resolved` datum carries a `witness` object with `sourceUrl`, `fetchedAt`, and `rawValue` -- the exact source and value the resolution was read from.
- `input-order-preserved`: The returned array carries exactly one datum per input question, in input order.
## Prohibitions
- `never-estimate`: The operation must never produce a probabilistic estimate or a guessed outcome; a question with no live confirming read from its named source stays `Open` with an explicit reason, always.
- `no-ticker-reconstruction`: The operation must never attempt to invert a question id back into an exact Kalshi ticker (lossy: a bracket strike's decimal point and a threshold's hyphen collide under the same transform); it only ever recomputes the forward `questionIdFromTicker` transform on tickers the venue itself returned.
- `no-hardcoded-credentialed-endpoint`: The operation must never call an EIA or USDA AMS endpoint that requires a registered API key; `indian-country.goods-prices` resolves only through an explicitly configured, keyless `resolutionParameters.seriesUrl`, and stays `Open` naming the credential gap otherwise.
- `tribal-elections-and-court-cases-stay-open`: The operation must never resolve `indian-country.tribal-elections` or `indian-country.court-cases` questions itself; both always report `Open`, naming the institutional source a human must confirm against.
## Laws
- `calibration-gated-stakes` | Three ways to turn capital into capital (561-group finance note) | 2026-09-04 | content/text/documents/articles/notes/2026/09/04/2026-09-04-note-on-three-ways-to-turn-capital-into-capital.md (561-group-finance-operations-services-section) | Applies to why resolution matters at all: a calibration record can only grow from resolved forecasts, and this operation is the section's only source of resolved outcomes. | A stake exists only when the org's calibration on the forecast's reference class is scored on at least thirty resolved forecasts; resolution is the falsifier's own supply line.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation and its import.meta.main guard. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/scratch-resolve-set-of-forecast-questions-20260905-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/observe-set-of-kalshi-weather-markets-service":"0.2.0"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/scratch-resolve-set-of-forecast-questions-20260905.mjs
#!/usr/bin/env node
// Resolves forecasting questions against machine-readable public sources
// (Kalshi settled markets, api.weather.gov observations, a configured
// goods-prices JSON series), or reports Open with a reason -- never an
// estimate. See the exported function's JSDoc for the full contract.
import { observeSetOfKalshiWeatherMarkets } from "@red-cup-engineering/observe-set-of-kalshi-weather-markets-service";

const KALSHI_STATUS_SETTLED = "settled";
const KALSHI_WEATHER_PREFIX = "kalshi.weather.";
const PLAINS_WEATHER_SOURCE = "indian-country.plains-weather";
const GOODS_PRICES_SOURCE = "indian-country.goods-prices";
const TRIBAL_ELECTIONS_SOURCE = "indian-country.tribal-elections";
const COURT_CASES_SOURCE = "indian-country.court-cases";
const NWS_API_BASE = "https://api.weather.gov";
const NWS_USER_AGENT = "561-group-forecasting-services-section (forecasting@561.group)";

// Scratch-fabrication note: no sibling src/ exists here to import from, so
// questionIdFromTicker is defined locally. The shipped copy in
// forecasting-services-section instead imports it from src/forecasting.mjs
// (see that section's data/records/ for the receipt naming this friction).
function questionIdFromTicker(ticker) {
  return ticker.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

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
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "resolveSetOfForecastQuestions — Resolves a set of open forecasting questions against their machine-readable public sources, or reports each as still Open with an explicit, honest reason -- never an estimate. Kalshi weather markets (sourcePlatform \"kalshi.weather.<SERIES>\") are checked against Kalshi's public settled-market listing; indian-country.plains-weather questions carrying resolutionParameters are checked against api.weather.gov's public station-observation endpoints; indian-country.goods-prices questions carrying a resolutionParameters.seriesUrl are checked against that published JSON series; indian-country.tribal-elections and indian-country.court-cases have no machine-readable source and always report Open, naming the institutional source a human must confirm against; any other sourcePlatform reports Open naming the gap.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(await resolveSetOfForecastQuestions(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/scratch-resolve-set-of-forecast-questions-20260905.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { resolveSetOfForecastQuestions } from "../scripts/scratch-resolve-set-of-forecast-questions-20260905.mjs";

const NOW = "2026-09-05T07:24:32Z";

function kalshiFetch(settledMarkets) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/trade-api/v2/markets") {
      assert.equal(parsed.searchParams.get("status"), "settled");
      return { ok: true, json: async () => ({ markets: settledMarkets, cursor: "" }) };
    }
    throw new Error(`unexpected kalshi fetch: ${url}`);
  };
}

test("a kalshi.weather.* question with no matching settled market stays Open", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "kxhighny-26sep05-t86", sourcePlatform: "kalshi.weather.KXHIGHNY" }], now: NOW },
    { fetchImpl: kalshiFetch([]) },
  );
  assert.equal(resolution.type, "Open");
  assert.equal(resolution.questionId, "kxhighny-26sep05-t86");
  assert.match(resolution.reason, /no settled Kalshi market found/u);
});

test("a kalshi.weather.* question resolves YES (outcome 1) from a settled result=yes market, matched by recomputing the ticker->id transform", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "kxhighny-26sep04-t86", sourcePlatform: "kalshi.weather.KXHIGHNY" }], now: NOW },
    { fetchImpl: kalshiFetch([{ ticker: "KXHIGHNY-26SEP04-T86", result: "yes" }]) },
  );
  assert.equal(resolution.type, "Resolved");
  assert.equal(resolution.outcome, 1);
  assert.equal(resolution.witness.rawValue, "yes");
  assert.equal(resolution.witness.sourceUrl, "https://api.elections.kalshi.com/trade-api/v2/markets/KXHIGHNY-26SEP04-T86");
});

test("a kalshi.weather.* question resolves NO (outcome 0) from a settled result=no market, including a decimal bracket ticker", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "kxhighchi-26sep04-b89-5", sourcePlatform: "kalshi.weather.KXHIGHCHI" }], now: NOW },
    { fetchImpl: kalshiFetch([{ ticker: "KXHIGHCHI-26SEP04-B89.5", result: "no" }]) },
  );
  assert.equal(resolution.type, "Resolved");
  assert.equal(resolution.outcome, 0);
});

test("a kalshi settled-market read failure leaves every question in that series Open, naming the failure", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "kxhighny-26sep04-t86", sourcePlatform: "kalshi.weather.KXHIGHNY" }], now: NOW },
    { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) },
  );
  assert.equal(resolution.type, "Open");
  assert.match(resolution.reason, /kalshi settled-market read failed/u);
});

test("an indian-country.plains-weather question with no resolutionParameters stays Open", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "pine-ridge-high-temp-90f-2026-09-10", sourcePlatform: "indian-country.plains-weather" }], now: NOW },
    {},
  );
  assert.equal(resolution.type, "Open");
  assert.match(resolution.reason, /no resolutionParameters/u);
});

function nwsFetch({ gridId = "UNR", gridX = 10, gridY = 20, stationId = "KIEN", temperaturesC = [], precipMm = [] } = {}) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/points/")) return { ok: true, json: async () => ({ properties: { gridId, gridX, gridY } }) };
    if (parsed.pathname.endsWith("/stations")) return { ok: true, json: async () => ({ features: [{ properties: { stationIdentifier: stationId } }] }) };
    if (parsed.pathname.startsWith(`/stations/${stationId}/observations`)) {
      return {
        ok: true,
        json: async () => ({
          features: [
            ...temperaturesC.map((value) => ({ properties: { temperature: { value }, precipitationLastHour: { value: null } } })),
            ...precipMm.map((value) => ({ properties: { temperature: { value: null }, precipitationLastHour: { value } } })),
          ],
        }),
      };
    }
    throw new Error(`unexpected nws fetch: ${url}`);
  };
}

test("a plains-weather maxTemperature question resolves YES when the observed max clears the threshold", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    {
      questions: [{
        id: "pine-ridge-high-temp-90f-2026-09-10",
        sourcePlatform: "indian-country.plains-weather",
        resolutionParameters: { lat: 43.02, lon: -102.56, targetDate: "2026-09-10", metric: "maxTemperature", comparison: "gte", thresholdF: 90 },
      }],
      now: NOW,
    },
    { fetchImpl: nwsFetch({ temperaturesC: [28, 32.5, 30] }) }, // 32.5C = 90.5F
  );
  assert.equal(resolution.type, "Resolved");
  assert.equal(resolution.outcome, 1);
  assert.ok(Math.abs(resolution.witness.rawValue - 90.5) < 1e-9);
});

test("a plains-weather maxTemperature question resolves NO when the observed max misses the threshold", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    {
      questions: [{
        id: "cheyenne-river-high-temp-85f-2026-09-15",
        sourcePlatform: "indian-country.plains-weather",
        resolutionParameters: { lat: 44.99, lon: -101.24, targetDate: "2026-09-15", metric: "maxTemperature", comparison: "gte", thresholdF: 85 },
      }],
      now: NOW,
    },
    { fetchImpl: nwsFetch({ temperaturesC: [20, 22] }) }, // 22C = 71.6F
  );
  assert.equal(resolution.type, "Resolved");
  assert.equal(resolution.outcome, 0);
});

test("a plains-weather precipitation question resolves YES on any measurable precipitation", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    {
      questions: [{
        id: "rosebud-measurable-precip-2026-09-12",
        sourcePlatform: "indian-country.plains-weather",
        resolutionParameters: { lat: 43.23, lon: -100.86, targetDate: "2026-09-12", metric: "precipitation", comparison: "gte" },
      }],
      now: NOW,
    },
    { fetchImpl: nwsFetch({ precipMm: [0, 0.5] }) },
  );
  assert.equal(resolution.type, "Resolved");
  assert.equal(resolution.outcome, 1);
});

test("a plains-weather question with no observations yet for the target date stays Open", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    {
      questions: [{
        id: "pine-ridge-high-temp-90f-2026-09-10",
        sourcePlatform: "indian-country.plains-weather",
        resolutionParameters: { lat: 43.02, lon: -102.56, targetDate: "2026-09-10", metric: "maxTemperature", comparison: "gte", thresholdF: 90 },
      }],
      now: NOW,
    },
    { fetchImpl: nwsFetch({}) },
  );
  assert.equal(resolution.type, "Open");
  assert.match(resolution.reason, /no api\.weather\.gov observations yet/u);
});

test("a goods-prices question with no seriesUrl configured stays Open, naming the credential fence", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "south-dakota-propane-price-above-2-2026-10", sourcePlatform: "indian-country.goods-prices" }], now: NOW },
    {},
  );
  assert.equal(resolution.type, "Open");
  assert.match(resolution.reason, /registered API key/u);
});

test("a goods-prices question with a configured seriesUrl resolves against the read numeric value", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    {
      questions: [{
        id: "south-dakota-propane-price-above-2-2026-10",
        sourcePlatform: "indian-country.goods-prices",
        resolutionParameters: { seriesUrl: "https://example.test/series.json", jsonPath: "series.latest.price", comparison: "gte", threshold: 2 },
      }],
      now: NOW,
    },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ series: { latest: { price: 2.15 } } }) }) },
  );
  assert.equal(resolution.type, "Resolved");
  assert.equal(resolution.outcome, 1);
  assert.equal(resolution.witness.rawValue, 2.15);
});

test("indian-country.tribal-elections always stays Open, naming the institutional source", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "oglala-sioux-tribe-general-election-2026", sourcePlatform: "indian-country.tribal-elections" }], now: NOW },
    {},
  );
  assert.equal(resolution.type, "Open");
  assert.match(resolution.reason, /Indianz\.com/u);
});

test("indian-country.court-cases always stays Open, naming the institutional source", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "scotus-cert-indian-country-ot2026", sourcePlatform: "indian-country.court-cases" }], now: NOW },
    {},
  );
  assert.equal(resolution.type, "Open");
  assert.match(resolution.reason, /SCOTUSblog/u);
});

test("an unrecognized sourcePlatform stays Open, naming the gap", async () => {
  const [resolution] = await resolveSetOfForecastQuestions(
    { questions: [{ id: "synthetic-demo-fed-rate-cut-september-2026", sourcePlatform: "metaculus-aib-minibench" }], now: NOW },
    {},
  );
  assert.equal(resolution.type, "Open");
  assert.match(resolution.reason, /no resolution mechanism configured/u);
});

test("preserves input order across mixed source platforms", async () => {
  const resolutions = await resolveSetOfForecastQuestions(
    {
      questions: [
        { id: "a", sourcePlatform: "indian-country.court-cases" },
        { id: "b", sourcePlatform: "kalshi.weather.KXHIGHNY" },
        { id: "c", sourcePlatform: "indian-country.tribal-elections" },
      ],
      now: NOW,
    },
    { fetchImpl: kalshiFetch([]) },
  );
  assert.deepEqual(resolutions.map((r) => r.questionId), ["a", "b", "c"]);
});

test("throws when request.now is missing", async () => {
  await assert.rejects(() => resolveSetOfForecastQuestions({ questions: [] }), TypeError);
});

test("throws when a question lacks sourcePlatform", async () => {
  await assert.rejects(() => resolveSetOfForecastQuestions({ questions: [{ id: "x" }], now: NOW }), TypeError);
});
```
## Examples
```json name="an indian-country.tribal-elections question always stays Open, no network call"
{"input":{"questions":[{"id":"oglala-sioux-tribe-general-election-2026","sourcePlatform":"indian-country.tribal-elections"}],"now":"2026-09-05T07:24:32Z"},"output":[{"type":"Open","questionId":"oglala-sioux-tribe-general-election-2026","reason":"tribal election certification is not machine-integrated; resolves manually against the tribe's own Election Board/Commission announcement or Indianz.com/Native News Online reporting"}]}
```
```json name="a goods-prices question with no configured seriesUrl stays Open, no network call"
{"input":{"questions":[{"id":"south-dakota-propane-price-above-2-2026-10","sourcePlatform":"indian-country.goods-prices"}],"now":"2026-09-05T07:24:32Z"},"output":[{"type":"Open","questionId":"south-dakota-propane-price-above-2-2026-10","reason":"no resolutionParameters.seriesUrl configured for indian-country.goods-prices (EIA and USDA AMS programmatic access both require a registered API key this operation does not hold); resolves manually against eia.gov/petroleum/heatingoilpropane or ams.usda.gov reports"}]}
```
## Traceability
- `kalshi-weather-settled-lookup` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `plains-weather-observation-chain` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `goods-prices-configured-series` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `witnessed-resolution` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
- `input-order-preserved` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `never-estimate` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
- `no-ticker-reconstruction` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
- `no-hardcoded-credentialed-endpoint` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
- `tribal-elections-and-court-cases-stay-open` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `calibration-gated-stakes`
