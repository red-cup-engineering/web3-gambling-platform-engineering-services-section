# observe-set-of-kalshi-weather-markets
## Requirements
- `fetches-declared-series`: For each series ticker named in the declared request, the operation reads Kalshi's public trade-api v2 GET /markets endpoint filtered to that series ticker and the declared status.
- `one-record-per-market`: The operation returns exactly one KalshiWeatherMarketObservation record per market Kalshi returns, carrying its ticker, series ticker, event ticker, title, strike fields, close and settlement times, settlement source text, yes bid/ask, last price, volume, open interest, status, result, and the request's observedAt stamp.
- `carries-settlement-result`: Each returned record carries Kalshi's own settlement result field verbatim (lowercase "yes", "no", or null before settlement), so a caller can score a resolved market's outcome without inventing one from price data.
- `pagination-followed`: The operation follows Kalshi's cursor pagination for a series, accumulating every page's markets up to a declared per-series page cap.
- `injectable-network-call`: The operation accepts an injectable fetch implementation defaulting to the global fetch, so callers and tests can supply fixtures instead of live HTTP.
## Prohibitions
- `refuses-non-array-series-tickers`: The operation must refuse a request whose seriesTickers is not an array of non-empty strings.
- `refuses-missing-observed-at`: The operation must refuse a request whose observedAt is not a parseable ISO 8601 timestamp.
- `no-credential-use`: The operation must never read Kalshi API credentials or attach authentication headers to its requests.
## Laws
- `market-data-provision-no-credential-use` | Kalshi venue-access settlement, 561 Group | v1 | kalshi-services-section/content/contracts/market-data-provision.json | Applies to every network call this operation makes. | The market-data-provision contract's invariants are read-only, no-credential-use, and bounded-request-count; this operation reads only the declared public GET /markets endpoint and never touches credentials.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file that is eligible for downstream staged package-birth assays.
- `whatwg-fetch-standard` | WHATWG | Living Standard | https://fetch.spec.whatwg.org/ | Applies to the injectable network call this operation makes to Kalshi's public trade-api. | The operation uses the Fetch API contract (a Request URL, a Response with `.ok` and `.json()`) for its HTTP calls, real by default via the global fetch and injectable for deterministic tests.
- `kalshi-trade-api-v2` | Kalshi | v2 | https://trading-api.readme.io/reference/getmarkets | Applies to the /markets endpoint this operation reads. | Kalshi's trade-api v2 documents that market data requires no credentials; the operation reads only the public GET /markets endpoint per series ticker with status and cursor pagination query parameters.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/observe-set-of-kalshi-weather-markets-service","packageVersion":"0.2.0","license":"UNLICENSED","dependencies":{},"devDependencies":{}}
```
## Operation
```mjs path=scripts/observe-set-of-kalshi-weather-markets.mjs
#!/usr/bin/env node
// Reads Kalshi's public trade-api v2 market endpoints (no credentials required
// for market data) for a declared list of weather/climate series tickers, and
// normalizes their open markets into one record per market. Network access is
// delegated to an injectable fetch (defaulting to the global fetch), so
// behavioral tests and fabrication examples can supply fixtures or the
// deterministic empty-series-list shortcut instead of live HTTP.

const DEFAULT_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";
const DEFAULT_STATUS = "open";
const DEFAULT_MAX_PAGES_PER_SERIES = 5;

function requireArrayOfStrings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`observe-set-of-kalshi-weather-markets: ${label} must be an array of non-empty strings`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`observe-set-of-kalshi-weather-markets: ${label} must be a parseable ISO 8601 timestamp`);
  }
  return value;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeMarket(raw, seriesTicker, observedAt) {
  return {
    type: "KalshiWeatherMarketObservation",
    version: 1,
    ticker: raw.ticker,
    seriesTicker,
    eventTicker: raw.event_ticker ?? null,
    title: raw.title ?? null,
    status: raw.status ?? null,
    strikeType: raw.strike_type ?? null,
    floorStrike: toNumberOrNull(raw.floor_strike),
    capStrike: toNumberOrNull(raw.cap_strike),
    closeTime: raw.close_time ?? null,
    settlementTime: raw.expected_expiration_time ?? raw.expiration_time ?? null,
    settlementSourceText: raw.rules_primary ?? null,
    yesBid: toNumberOrNull(raw.yes_bid_dollars),
    yesAsk: toNumberOrNull(raw.yes_ask_dollars),
    lastPrice: toNumberOrNull(raw.last_price_dollars),
    volume: toNumberOrNull(raw.volume_fp),
    openInterest: toNumberOrNull(raw.open_interest_fp),
    result: raw.result === "yes" || raw.result === "no" ? raw.result : null,
    observedAt,
  };
}

async function fetchSeriesMarkets({ baseUrl, seriesTicker, status, fetchImpl, maxPages }) {
  const markets = [];
  let cursor = "";
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${baseUrl}/markets`);
    url.searchParams.set("series_ticker", seriesTicker);
    url.searchParams.set("status", status);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetchImpl(url.toString(), { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`observe-set-of-kalshi-weather-markets: GET ${url.toString()} failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    for (const raw of payload.markets ?? []) markets.push(raw);
    cursor = payload.cursor ?? "";
    if (!cursor) break;
  }
  return markets;
}

/**
 * Reads Kalshi's public trade-api v2 GET /markets endpoint (no credentials required for market data) for a declared list of weather/climate series tickers, and returns one normalized KalshiWeatherMarketObservation record per open market found.
 * @param {object} request A KalshiWeatherMarketObservationRequest.
 * @param {string[]} request.seriesTickers Declared Kalshi series tickers to observe (e.g. "KXHIGHNY"); an empty array observes nothing.
 * @param {string} request.observedAt ISO 8601 timestamp this observation is stamped with.
 * @param {string} [request.baseUrl] Kalshi trade-api v2 base URL (default the documented production host).
 * @param {string} [request.status] The Kalshi market status filter (default "open").
 * @param {number} [request.maxPagesPerSeries] Pagination cap per series (default 5).
 * @param {{fetchImpl?: typeof fetch}} [options] `fetchImpl` overrides the network call for tests and fixtures; defaults to the global fetch.
 * @returns {Promise<object[]>} An array of KalshiWeatherMarketObservation records, one per open market.
 * @throws {TypeError} When request.seriesTickers or request.observedAt are malformed.
 * @throws {Error} When a Kalshi request does not respond with an HTTP success status.
 */
export async function observeSetOfKalshiWeatherMarkets(request, options = {}) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("observe-set-of-kalshi-weather-markets: request must be a JSON object");
  }
  const seriesTickers = requireArrayOfStrings(request.seriesTickers, "request.seriesTickers");
  const observedAt = requireIsoTimestamp(request.observedAt, "request.observedAt");
  const baseUrl = typeof request.baseUrl === "string" && request.baseUrl.length > 0 ? request.baseUrl : DEFAULT_BASE_URL;
  const status = typeof request.status === "string" && request.status.length > 0 ? request.status : DEFAULT_STATUS;
  const maxPages = Number.isInteger(request.maxPagesPerSeries) && request.maxPagesPerSeries > 0 ? request.maxPagesPerSeries : DEFAULT_MAX_PAGES_PER_SERIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  const observations = [];
  for (const seriesTicker of seriesTickers) {
    const rawMarkets = await fetchSeriesMarkets({ baseUrl, seriesTicker, status, fetchImpl, maxPages });
    for (const raw of rawMarkets) observations.push(normalizeMarket(raw, seriesTicker, observedAt));
  }
  return observations;
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "observeSetOfKalshiWeatherMarkets — Reads Kalshi's public trade-api v2 GET /markets endpoint (no credentials required for market data) for a declared list of weather/climate series tickers, and returns one normalized KalshiWeatherMarketObservation record per open market found.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(await observeSetOfKalshiWeatherMarkets(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/observe-set-of-kalshi-weather-markets.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { observeSetOfKalshiWeatherMarkets } from "../scripts/observe-set-of-kalshi-weather-markets.mjs";

// Trimmed from a live sample recorded 2026-09-04 against
// https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXHIGHNY&status=open
const PAGE_ONE = {
  cursor: "page-two",
  markets: [
    {
      ticker: "KXHIGHNY-26SEP05-T86",
      event_ticker: "KXHIGHNY-26SEP05",
      title: "Will the maximum temperature be >86° on Sep 5, 2026?",
      status: "active",
      strike_type: "greater",
      floor_strike: 86,
      close_time: "2026-09-06T05:00:00Z",
      expected_expiration_time: "2026-09-06T19:00:00Z",
      rules_primary: "If the maximum temperature recorded at New York City (CLINYC) for Sep 5, 2026, is greater than 86° fahrenheit according to The Weather Company, then the market resolves to Yes.",
      yes_bid_dollars: "0.0000",
      yes_ask_dollars: "0.0100",
      last_price_dollars: "0.0100",
      volume_fp: "1128.93",
      open_interest_fp: "1107.93",
    },
  ],
};

const PAGE_TWO = {
  cursor: "",
  markets: [
    {
      ticker: "KXHIGHNY-26SEP05-T79",
      event_ticker: "KXHIGHNY-26SEP05",
      title: "Will the maximum temperature be >=79° and <=86° on Sep 5, 2026?",
      status: "active",
      strike_type: "between",
      floor_strike: 79,
      cap_strike: 86,
      close_time: "2026-09-06T05:00:00Z",
      expected_expiration_time: "2026-09-06T19:00:00Z",
      rules_primary: "According to The Weather Company.",
      yes_bid_dollars: "0.7400",
      yes_ask_dollars: "0.7500",
      last_price_dollars: "0.2500",
      volume_fp: "0",
      open_interest_fp: "3258.43",
    },
  ],
};

function fixtureFetch(pagesByCursor) {
  return async (urlText) => {
    const url = new URL(urlText);
    const cursor = url.searchParams.get("cursor") ?? "";
    const page = pagesByCursor[cursor];
    if (!page) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => page };
  };
}

test("returns [] without any fetch call for an empty series list", async () => {
  const calls = [];
  const observations = await observeSetOfKalshiWeatherMarkets(
    { seriesTickers: [], observedAt: "2026-09-04T12:00:00.000Z" },
    { fetchImpl: async (...args) => { calls.push(args); return { ok: true, status: 200, json: async () => ({ markets: [] }) }; } },
  );
  assert.deepEqual(observations, []);
  assert.equal(calls.length, 0);
});

test("normalizes one page of markets into one record per market", async () => {
  const observations = await observeSetOfKalshiWeatherMarkets(
    { seriesTickers: ["KXHIGHNY"], observedAt: "2026-09-04T12:00:00.000Z" },
    { fetchImpl: fixtureFetch({ "": PAGE_TWO }) },
  );
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0], {
    type: "KalshiWeatherMarketObservation",
    version: 1,
    ticker: "KXHIGHNY-26SEP05-T79",
    seriesTicker: "KXHIGHNY",
    eventTicker: "KXHIGHNY-26SEP05",
    title: "Will the maximum temperature be >=79° and <=86° on Sep 5, 2026?",
    status: "active",
    strikeType: "between",
    floorStrike: 79,
    capStrike: 86,
    closeTime: "2026-09-06T05:00:00Z",
    settlementTime: "2026-09-06T19:00:00Z",
    settlementSourceText: "According to The Weather Company.",
    yesBid: 0.74,
    yesAsk: 0.75,
    lastPrice: 0.25,
    volume: 0,
    openInterest: 3258.43,
    result: null,
    observedAt: "2026-09-04T12:00:00.000Z",
  });
});

test("carries a settled market's yes/no result verbatim", async () => {
  const settled = { cursor: "", markets: [{ ...PAGE_TWO.markets[0], status: "finalized", result: "no" }] };
  const observations = await observeSetOfKalshiWeatherMarkets(
    { seriesTickers: ["KXHIGHNY"], observedAt: "2026-09-04T12:00:00.000Z", status: "settled" },
    { fetchImpl: fixtureFetch({ "": settled }) },
  );
  assert.equal(observations[0].result, "no");
  assert.equal(observations[0].status, "finalized");
});

test("reports a null result for an unsettled market", async () => {
  const observations = await observeSetOfKalshiWeatherMarkets(
    { seriesTickers: ["KXHIGHNY"], observedAt: "2026-09-04T12:00:00.000Z" },
    { fetchImpl: fixtureFetch({ "": PAGE_TWO }) },
  );
  assert.equal(observations[0].result, null);
});

test("follows cursor pagination across pages for one series", async () => {
  const observations = await observeSetOfKalshiWeatherMarkets(
    { seriesTickers: ["KXHIGHNY"], observedAt: "2026-09-04T12:00:00.000Z" },
    { fetchImpl: fixtureFetch({ "": PAGE_ONE, "page-two": PAGE_TWO }) },
  );
  assert.equal(observations.length, 2);
  assert.deepEqual(observations.map((o) => o.ticker), ["KXHIGHNY-26SEP05-T86", "KXHIGHNY-26SEP05-T79"]);
});

test("throws on an HTTP failure", async () => {
  await assert.rejects(
    observeSetOfKalshiWeatherMarkets(
      { seriesTickers: ["KXHIGHNY"], observedAt: "2026-09-04T12:00:00.000Z" },
      { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) },
    ),
    /HTTP 500/u,
  );
});

test("refuses a non-array seriesTickers", async () => {
  await assert.rejects(observeSetOfKalshiWeatherMarkets({ seriesTickers: "KXHIGHNY", observedAt: "2026-09-04T12:00:00.000Z" }), /seriesTickers must be an array/u);
});

test("refuses a missing observedAt", async () => {
  await assert.rejects(observeSetOfKalshiWeatherMarkets({ seriesTickers: [] }), /observedAt must be a parseable/u);
});
```
## Examples
```json name="empty series list returns no observations"
{"input":{"seriesTickers":[],"observedAt":"2026-09-04T12:00:00.000Z"},"output":[]}
```
```json name="empty series list with overrides still returns no observations"
{"input":{"seriesTickers":[],"observedAt":"2026-09-04T12:00:00.000Z","baseUrl":"https://api.elections.kalshi.com/trade-api/v2","status":"open","maxPagesPerSeries":2},"output":[]}
```
## Traceability
- `fetches-declared-series` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-trade-api-v2`, `whatwg-fetch-standard`
- `one-record-per-market` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-trade-api-v2`
- `carries-settlement-result` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-trade-api-v2`
- `pagination-followed` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-trade-api-v2`
- `injectable-network-call` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `whatwg-fetch-standard`, `node-esm-operation`
- `refuses-non-array-series-tickers` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `refuses-missing-observed-at` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-credential-use` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `market-data-provision-no-credential-use`
