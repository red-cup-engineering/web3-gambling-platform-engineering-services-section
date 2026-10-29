# read-kalshi-market
## Requirements
- `reads-one-market`: Given a Kalshi market ticker, the operation reads Kalshi's public trade-api v2 GET /markets/{ticker} endpoint and returns the market's current price fields (yes bid/ask, last price, volume, open interest, status, close time).
- `reads-one-orderbook`: The operation also reads the same market's public GET /markets/{ticker}/orderbook endpoint and returns the yes/no price-quantity ladders it reports.
- `carries-witnesses`: The returned KalshiMarketRead record carries `fetchedAt` (the wall-clock time of the network calls) and `source` (the exact URLs read) as witnesses distinct from the caller's own `observedAt` stamp.
- `injectable-network-call`: The operation accepts an injectable fetch implementation defaulting to the global fetch, so tests and fixtures never require live HTTP.
## Prohibitions
- `refuses-missing-ticker`: The operation must refuse a request whose ticker is not a non-empty string.
- `refuses-missing-observed-at`: The operation must refuse a request whose observedAt is not a parseable ISO 8601 timestamp.
- `no-credential-use`: The operation must never read Kalshi API credentials or attach authentication headers to its requests; both endpoints it reads are documented as public.
## Laws
- `market-data-provision-no-credential-use` | Kalshi venue-access settlement, 561 Group | v1 | kalshi-services-section/content/contracts/market-data-provision.json | Applies to every network call this operation makes. | The market-data-provision contract's invariants are read-only, no-credential-use, and bounded-request-count; this operation reads only the declared public GET /markets/{ticker} and GET /markets/{ticker}/orderbook endpoints and never touches credentials.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file that is eligible for downstream staged package-birth assays.
- `whatwg-fetch-standard` | WHATWG | Living Standard | https://fetch.spec.whatwg.org/ | Applies to the injectable network call this operation makes to Kalshi's public trade-api. | The operation uses the Fetch API contract (a Request URL, a Response with `.ok` and `.json()`) for its HTTP calls, real by default via the global fetch and injectable for deterministic tests.
- `kalshi-trade-api-v2-markets` | Kalshi | v2 | https://trading-api.readme.io/reference/getmarket | Applies to the GET /markets/{ticker} endpoint this operation reads. | Kalshi's trade-api v2 documents GET /markets/{ticker} as requiring no credentials for market data.
- `kalshi-trade-api-v2-orderbook` | Kalshi | v2 | https://trading-api.readme.io/reference/getmarketorderbook | Applies to the GET /markets/{ticker}/orderbook endpoint this operation reads. | Kalshi's trade-api v2 documents GET /markets/{ticker}/orderbook as returning public yes/no price-quantity ladders in cents, requiring no credentials.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/read-kalshi-market-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{},"devDependencies":{}}
```
## Operation
```mjs path=scripts/read-kalshi-market.mjs
#!/usr/bin/env node
// Reads Kalshi's public trade-api v2 GET /markets/{ticker} and GET
// /markets/{ticker}/orderbook endpoints (no credentials required for market
// data) for one declared market ticker, and returns one normalized
// KalshiMarketRead record carrying the market's current price fields, its
// orderbook ladders, and fetch-time/source witnesses. Network access is
// delegated to an injectable fetch (defaulting to the global fetch), so
// tests and fabrication examples supply fixtures instead of live HTTP.

const DEFAULT_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`read-kalshi-market: ${label} must be a non-empty string`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`read-kalshi-market: ${label} must be a parseable ISO 8601 timestamp`);
  }
  return value;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLadder(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(([priceCents, quantity]) => ({ priceDollars: toNumberOrNull(priceCents) === null ? null : priceCents / 100, quantity: toNumberOrNull(quantity) }));
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`read-kalshi-market: GET ${url} failed with HTTP ${response.status}`);
  return response.json();
}

/**
 * Reads Kalshi's public trade-api v2 GET /markets/{ticker} and GET /markets/{ticker}/orderbook endpoints for one declared market ticker, and returns one normalized KalshiMarketRead record.
 * @param {object} request A KalshiMarketReadRequest.
 * @param {string} request.ticker The Kalshi market ticker to read (e.g. "KXHIGHNY-26SEP05-T86").
 * @param {string} request.observedAt ISO 8601 timestamp this read is requested for.
 * @param {string} [request.baseUrl] Kalshi trade-api v2 base URL (default the documented production host).
 * @param {{fetchImpl?: typeof fetch}} [options] `fetchImpl` overrides the network call for tests and fixtures; defaults to the global fetch.
 * @returns {Promise<object>} A KalshiMarketRead record with the market's price fields, its orderbook, and fetch-time/source witnesses.
 * @throws {TypeError} When request.ticker or request.observedAt are malformed.
 * @throws {Error} When a Kalshi request does not respond with an HTTP success status.
 */
export async function readKalshiMarket(request, options = {}) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("read-kalshi-market: request must be a JSON object");
  }
  const ticker = requireNonEmptyString(request.ticker, "request.ticker");
  const observedAt = requireIsoTimestamp(request.observedAt, "request.observedAt");
  const baseUrl = typeof request.baseUrl === "string" && request.baseUrl.length > 0 ? request.baseUrl : DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const marketUrl = `${baseUrl}/markets/${ticker}`;
  const orderbookUrl = `${baseUrl}/markets/${ticker}/orderbook`;
  const [marketPayload, orderbookPayload] = await Promise.all([fetchJson(marketUrl, fetchImpl), fetchJson(orderbookUrl, fetchImpl)]);
  const raw = marketPayload.market ?? {};
  const orderbook = orderbookPayload.orderbook ?? {};

  return {
    type: "KalshiMarketRead",
    version: 1,
    ticker,
    status: raw.status ?? null,
    yesBid: toNumberOrNull(raw.yes_bid_dollars),
    yesAsk: toNumberOrNull(raw.yes_ask_dollars),
    lastPrice: toNumberOrNull(raw.last_price_dollars),
    volume: toNumberOrNull(raw.volume_fp),
    openInterest: toNumberOrNull(raw.open_interest_fp),
    closeTime: raw.close_time ?? null,
    orderbook: {
      yes: normalizeLadder(orderbook.yes),
      no: normalizeLadder(orderbook.no),
    },
    observedAt,
    fetchedAt: new Date().toISOString(),
    source: [marketUrl, orderbookUrl],
  };
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "readKalshiMarket — Reads Kalshi's public trade-api v2 GET /markets/{ticker} and GET /markets/{ticker}/orderbook endpoints for one declared market ticker, and returns one normalized KalshiMarketRead record.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(await readKalshiMarket(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/read-kalshi-market.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readKalshiMarket } from "../scripts/read-kalshi-market.mjs";

// Trimmed from a live sample shape recorded against
// https://api.elections.kalshi.com/trade-api/v2/markets/{ticker} and its /orderbook sibling.
const MARKET_PAYLOAD = {
  market: {
    ticker: "KXHIGHNY-26SEP05-T79",
    status: "active",
    yes_bid_dollars: "0.7400",
    yes_ask_dollars: "0.7500",
    last_price_dollars: "0.2500",
    volume_fp: "12",
    open_interest_fp: "3258.43",
    close_time: "2026-09-06T05:00:00Z",
  },
};

const ORDERBOOK_PAYLOAD = {
  orderbook: {
    yes: [[74, 120], [73, 40]],
    no: [[25, 90]],
  },
};

function fixtureFetch(byUrl) {
  return async (urlText) => {
    const match = Object.entries(byUrl).find(([suffix]) => urlText.endsWith(suffix));
    if (!match) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => match[1] };
  };
}

test("normalizes a market read with its orderbook into one KalshiMarketRead record", async () => {
  const read = await readKalshiMarket(
    { ticker: "KXHIGHNY-26SEP05-T79", observedAt: "2026-09-05T12:00:00.000Z" },
    { fetchImpl: fixtureFetch({ "/markets/KXHIGHNY-26SEP05-T79": MARKET_PAYLOAD, "/orderbook": ORDERBOOK_PAYLOAD }) },
  );
  assert.equal(read.type, "KalshiMarketRead");
  assert.equal(read.ticker, "KXHIGHNY-26SEP05-T79");
  assert.equal(read.yesBid, 0.74);
  assert.equal(read.yesAsk, 0.75);
  assert.equal(read.lastPrice, 0.25);
  assert.deepEqual(read.orderbook.yes, [{ priceDollars: 0.74, quantity: 120 }, { priceDollars: 0.73, quantity: 40 }]);
  assert.deepEqual(read.orderbook.no, [{ priceDollars: 0.25, quantity: 90 }]);
  assert.equal(read.observedAt, "2026-09-05T12:00:00.000Z");
  assert.ok(typeof read.fetchedAt === "string" && Number.isFinite(Date.parse(read.fetchedAt)));
  assert.deepEqual(read.source, [
    "https://api.elections.kalshi.com/trade-api/v2/markets/KXHIGHNY-26SEP05-T79",
    "https://api.elections.kalshi.com/trade-api/v2/markets/KXHIGHNY-26SEP05-T79/orderbook",
  ]);
});

test("throws on an HTTP failure", async () => {
  await assert.rejects(
    readKalshiMarket(
      { ticker: "KXHIGHNY-26SEP05-T79", observedAt: "2026-09-05T12:00:00.000Z" },
      { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) },
    ),
    /HTTP 500/u,
  );
});

test("refuses a missing ticker", async () => {
  await assert.rejects(readKalshiMarket({ observedAt: "2026-09-05T12:00:00.000Z" }), /ticker must be a non-empty string/u);
});

test("refuses a missing observedAt", async () => {
  await assert.rejects(readKalshiMarket({ ticker: "KXHIGHNY-26SEP05-T79" }), /observedAt must be a parseable/u);
});
```
## Examples
```json name="reads a market and its orderbook with fetch-time and source witnesses"
{"input":{"ticker":"KXHIGHNY-26SEP05-T79","observedAt":"2026-09-05T12:00:00.000Z"},"output":{"type":"KalshiMarketRead","version":1,"ticker":"KXHIGHNY-26SEP05-T79","status":"active","yesBid":0.74,"yesAsk":0.75,"lastPrice":0.25,"volume":12,"openInterest":3258.43,"closeTime":"2026-09-06T05:00:00Z","orderbook":{"yes":[{"priceDollars":0.74,"quantity":120},{"priceDollars":0.73,"quantity":40}],"no":[{"priceDollars":0.25,"quantity":90}]},"observedAt":"2026-09-05T12:00:00.000Z","fetchedAt":"2026-09-05T12:00:00.100Z","source":["https://api.elections.kalshi.com/trade-api/v2/markets/KXHIGHNY-26SEP05-T79","https://api.elections.kalshi.com/trade-api/v2/markets/KXHIGHNY-26SEP05-T79/orderbook"]}}
```
## Traceability
- `reads-one-market` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-trade-api-v2-markets`, `whatwg-fetch-standard`
- `reads-one-orderbook` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-trade-api-v2-orderbook`, `whatwg-fetch-standard`
- `carries-witnesses` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `injectable-network-call` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `whatwg-fetch-standard`, `node-esm-operation`
- `refuses-missing-ticker` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `refuses-missing-observed-at` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-credential-use` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `market-data-provision-no-credential-use`
