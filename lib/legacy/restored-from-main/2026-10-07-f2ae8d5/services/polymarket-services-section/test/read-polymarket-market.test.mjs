import assert from "node:assert/strict";
import test from "node:test";
import { readPolymarketMarket } from "../scripts/read-polymarket-market.mjs";

const TOKEN_ID = "32338220190071351435772801779725302244575775216413325951443816017994629993401";

// Recorded live 2026-09-05 against https://clob.polymarket.com/book and
// /price for the "Xi Jinping out before 2027?" market's Yes token
// (trimmed levels for fixture size).
const BOOK_PAYLOAD = {
  market: "0xa467b14d51f01b957109d9cbb1d6c124fab2a089d52ed8f471d23c2812e743b7",
  asset_id: TOKEN_ID,
  timestamp: "1788590367213",
  hash: "71dda042861aef780dc2d47d200f1571ed8c121c",
  bids: [{ price: "0.001", size: "10458924.05" }, { price: "0.047", size: "1115.6" }],
  asks: [{ price: "0.999", size: "2178631.05" }, { price: "0.048", size: "500" }],
};

const PRICE_BUY_PAYLOAD = { price: "0.047" };
const PRICE_SELL_PAYLOAD = { price: "0.048" };

function fixtureFetch(byUrlSubstring) {
  return async (urlText) => {
    const match = Object.entries(byUrlSubstring).find(([needle]) => urlText.includes(needle));
    if (!match) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => match[1] };
  };
}

const FETCH = fixtureFetch({
  "/price?token_id=32338220190071351435772801779725302244575775216413325951443816017994629993401&side=buy": PRICE_BUY_PAYLOAD,
  "/price?token_id=32338220190071351435772801779725302244575775216413325951443816017994629993401&side=sell": PRICE_SELL_PAYLOAD,
  "/book?token_id=32338220190071351435772801779725302244575775216413325951443816017994629993401": BOOK_PAYLOAD,
});

test("normalizes a book and buy/sell price into one PolymarketMarketRead record", async () => {
  const read = await readPolymarketMarket({ tokenId: TOKEN_ID, observedAt: "2026-09-05T12:00:00.000Z" }, { fetchImpl: FETCH });
  assert.equal(read.type, "PolymarketMarketRead");
  assert.equal(read.tokenId, TOKEN_ID);
  assert.equal(read.market, "0xa467b14d51f01b957109d9cbb1d6c124fab2a089d52ed8f471d23c2812e743b7");
  assert.equal(read.bestBid, 0.047);
  assert.equal(read.bestAsk, 0.048);
  assert.deepEqual(read.price, { buy: 0.047, sell: 0.048 });
  assert.equal(read.bids.length, 2);
  assert.equal(read.asks.length, 2);
  assert.equal(read.bookHash, "71dda042861aef780dc2d47d200f1571ed8c121c");
  assert.equal(read.observedAt, "2026-09-05T12:00:00.000Z");
  assert.ok(typeof read.fetchedAt === "string" && Number.isFinite(Date.parse(read.fetchedAt)));
  assert.equal(read.source.length, 3);
});

test("best bid is the highest bid price regardless of array order", async () => {
  const unordered = fixtureFetch({
    "/book?token_id=x": { bids: [{ price: "0.01", size: "1" }, { price: "0.9", size: "1" }, { price: "0.5", size: "1" }], asks: [{ price: "0.99", size: "1" }, { price: "0.92", size: "1" }] },
    "/price?token_id=x&side=buy": { price: "0.9" },
    "/price?token_id=x&side=sell": { price: "0.92" },
  });
  const read = await readPolymarketMarket({ tokenId: "x", observedAt: "2026-09-05T12:00:00.000Z" }, { fetchImpl: unordered });
  assert.equal(read.bestBid, 0.9);
  assert.equal(read.bestAsk, 0.92);
});

test("throws on an HTTP failure", async () => {
  await assert.rejects(
    readPolymarketMarket({ tokenId: TOKEN_ID, observedAt: "2026-09-05T12:00:00.000Z" }, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }),
    /HTTP 500/u,
  );
});

test("refuses a missing tokenId", async () => {
  await assert.rejects(readPolymarketMarket({ observedAt: "2026-09-05T12:00:00.000Z" }), /tokenId must be a non-empty string/u);
});

test("refuses a missing observedAt", async () => {
  await assert.rejects(readPolymarketMarket({ tokenId: TOKEN_ID }), /observedAt must be a parseable/u);
});

test("refuses a malformed request", async () => {
  await assert.rejects(readPolymarketMarket(null), /request must be a JSON object/u);
});
