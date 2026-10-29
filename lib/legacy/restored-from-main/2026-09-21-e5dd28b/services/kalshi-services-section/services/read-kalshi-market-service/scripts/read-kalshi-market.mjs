#!/usr/bin/env node
import { runJavascriptNodeOperation } from "../../../../../../../../../../../../../computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/src/operation.mjs";
// Reads Kalshi's public GET /markets/{ticker} and .../orderbook endpoints for
// one ticker, no credentials. Orderbook shape verified live 2026-09-05:
// {"orderbook_fp":{"yes_dollars":[["0.01","1358.00"],...],"no_dollars":[...]}}.

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
  return rows.map(([priceDollars, quantity]) => ({ priceDollars: toNumberOrNull(priceDollars), quantity: toNumberOrNull(quantity) }));
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`read-kalshi-market: GET ${url} failed with HTTP ${response.status}`);
  return response.json();
}

/**
 * Reads Kalshi's public trade-api v2 GET /markets/{ticker} and GET /markets/{ticker}/orderbook endpoints for one declared market ticker, and returns one normalized KalshiMarketRead record.
 * @param {object} request A KalshiMarketReadRequest.
 * @param {string} request.ticker The Kalshi market ticker to read (e.g. "KXHIGHNY-26SEP05-T79").
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
  const orderbook = orderbookPayload.orderbook_fp ?? {};

  return {
    type: "KalshiMarketRead",
    version: 1,
    ticker,
    status: raw.status ?? null,
    yesBid: toNumberOrNull(raw.yes_bid_dollars),
    yesAsk: toNumberOrNull(raw.yes_ask_dollars),
    noBid: toNumberOrNull(raw.no_bid_dollars),
    noAsk: toNumberOrNull(raw.no_ask_dollars),
    lastPrice: toNumberOrNull(raw.last_price_dollars),
    volume: toNumberOrNull(raw.volume_fp),
    openInterest: toNumberOrNull(raw.open_interest_fp),
    closeTime: raw.close_time ?? null,
    orderbook: {
      yes: normalizeLadder(orderbook.yes_dollars),
      no: normalizeLadder(orderbook.no_dollars),
    },
    observedAt,
    fetchedAt: new Date().toISOString(),
    source: [marketUrl, orderbookUrl],
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "read-kalshi-market", description: "Reads Kalshi's public trade-api v2 GET /markets/{ticker} and GET /markets/{ticker}/orderbook endpoints for one declared market ticker, and returns one normalized KalshiMarketRead record.", operation: readKalshiMarket }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
