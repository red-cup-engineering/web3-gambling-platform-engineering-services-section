#!/usr/bin/env node
import { runJavascriptNodeOperation } from "../../../../../../../../../../../../../computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/src/operation.mjs";
// Reads Polymarket's public CLOB GET /book and GET /price (side=buy, sell)
// endpoints for one token id, no credentials. Shape verified live 2026-09-05
// against https://clob.polymarket.com: book={market,asset_id,bids,asks},
// price={"price":"0.047"}.

const DEFAULT_BASE_URL = "https://clob.polymarket.com";

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`read-polymarket-market: ${label} must be a non-empty string`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`read-polymarket-market: ${label} must be a parseable ISO 8601 timestamp`);
  }
  return value;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLevels(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({ price: toNumberOrNull(row.price), size: toNumberOrNull(row.size) }));
}

// Polymarket's own book ordering is undocumented and not to be trusted; the
// best bid is the highest price, the best ask is the lowest, always.
function bestPrice(levels, pick) {
  const prices = levels.map((level) => level.price).filter((price) => price !== null);
  return prices.length === 0 ? null : pick(...prices);
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`read-polymarket-market: GET ${url} failed with HTTP ${response.status}`);
  return response.json();
}

/**
 * Reads Polymarket's public CLOB GET /book and GET /price (buy and sell side) endpoints for one declared token id, and returns one normalized PolymarketMarketRead record.
 * @param {object} request A PolymarketMarketReadRequest.
 * @param {string} request.tokenId The Polymarket CLOB token id to read (a decimal ERC-1155 position id string).
 * @param {string} request.observedAt ISO 8601 timestamp this read is requested for.
 * @param {string} [request.baseUrl] Polymarket CLOB base URL (default the documented production host, https://clob.polymarket.com).
 * @param {{fetchImpl?: typeof fetch}} [options] `fetchImpl` overrides the network call for tests and fixtures; defaults to the global fetch.
 * @returns {Promise<object>} A PolymarketMarketRead record with the book, best buy/sell prices, and fetch-time/source witnesses.
 * @throws {TypeError} When request.tokenId or request.observedAt are malformed.
 * @throws {Error} When a Polymarket request does not respond with an HTTP success status.
 */
export async function readPolymarketMarket(request, options = {}) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("read-polymarket-market: request must be a JSON object");
  }
  const tokenId = requireNonEmptyString(request.tokenId, "request.tokenId");
  const observedAt = requireIsoTimestamp(request.observedAt, "request.observedAt");
  const baseUrl = typeof request.baseUrl === "string" && request.baseUrl.length > 0 ? request.baseUrl : DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const bookUrl = `${baseUrl}/book?token_id=${tokenId}`;
  const buyUrl = `${baseUrl}/price?token_id=${tokenId}&side=buy`;
  const sellUrl = `${baseUrl}/price?token_id=${tokenId}&side=sell`;
  const [book, buy, sell] = await Promise.all([fetchJson(bookUrl, fetchImpl), fetchJson(buyUrl, fetchImpl), fetchJson(sellUrl, fetchImpl)]);
  const bids = normalizeLevels(book.bids);
  const asks = normalizeLevels(book.asks);

  return {
    type: "PolymarketMarketRead",
    version: 1,
    tokenId,
    market: book.market ?? null,
    bids,
    asks,
    bestBid: bestPrice(bids, Math.max),
    bestAsk: bestPrice(asks, Math.min),
    price: { buy: toNumberOrNull(buy.price), sell: toNumberOrNull(sell.price) },
    bookHash: book.hash ?? null,
    bookTimestamp: book.timestamp ?? null,
    observedAt,
    fetchedAt: new Date().toISOString(),
    source: [bookUrl, buyUrl, sellUrl],
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "read-polymarket-market", description: "Reads Polymarket's public CLOB GET /book and GET /price (buy and sell side) endpoints for one declared token id, and returns one normalized PolymarketMarketRead record.", operation: readPolymarketMarket }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
