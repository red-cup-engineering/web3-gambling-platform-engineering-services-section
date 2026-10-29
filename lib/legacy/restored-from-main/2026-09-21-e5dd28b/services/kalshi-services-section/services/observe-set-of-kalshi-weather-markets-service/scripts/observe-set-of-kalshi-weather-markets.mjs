#!/usr/bin/env node
import { runJavascriptNodeOperation } from "../../../../../../../../../../../../../computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/src/operation.mjs";
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
  const result = await runJavascriptNodeOperation({ name: "observe-set-of-kalshi-weather-markets", description: "Reads Kalshi's public trade-api v2 GET /markets endpoint (no credentials required for market data) for a declared list of weather/climate series tickers, and returns one normalized KalshiWeatherMarketObservation record per open market found.", operation: observeSetOfKalshiWeatherMarkets }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
