import assert from "node:assert/strict";
import test from "node:test";
import { resolveSetOfForecastQuestions } from "../scripts/resolve-set-of-forecast-questions.mjs";

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
