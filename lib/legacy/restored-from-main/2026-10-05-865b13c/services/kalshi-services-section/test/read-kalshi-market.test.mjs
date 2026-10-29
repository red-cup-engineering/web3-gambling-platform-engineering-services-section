import assert from "node:assert/strict";
import test from "node:test";
import { readKalshiMarket } from "../scripts/read-kalshi-market.mjs";

// Recorded live 2026-09-05 against
// https://api.elections.kalshi.com/trade-api/v2/markets/KXHIGHNY-26SEP05-T79
// and its /orderbook sibling (trimmed orderbook ladders for fixture size).
const MARKET_PAYLOAD = {
  market: {
    ticker: "KXHIGHNY-26SEP05-T79",
    status: "active",
    yes_bid_dollars: "0.2600",
    yes_ask_dollars: "0.2700",
    no_bid_dollars: "0.7300",
    no_ask_dollars: "0.7400",
    last_price_dollars: "0.2600",
    volume_fp: "4569.81",
    open_interest_fp: "3346.31",
    close_time: "2026-09-06T05:00:00Z",
  },
};

const ORDERBOOK_PAYLOAD = {
  orderbook_fp: {
    yes_dollars: [["0.0100", "1358.00"], ["0.2600", "47.69"]],
    no_dollars: [["0.0100", "831.00"], ["0.7300", "2.00"]],
  },
};

function fixtureFetch(byUrlSuffix) {
  return async (urlText) => {
    const match = Object.entries(byUrlSuffix).find(([suffix]) => urlText.endsWith(suffix));
    if (!match) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => match[1] };
  };
}

test("normalizes a market read with its dollar-denominated orderbook into one KalshiMarketRead record", async () => {
  const read = await readKalshiMarket(
    { ticker: "KXHIGHNY-26SEP05-T79", observedAt: "2026-09-05T12:00:00.000Z" },
    { fetchImpl: fixtureFetch({ "/markets/KXHIGHNY-26SEP05-T79": MARKET_PAYLOAD, "/orderbook": ORDERBOOK_PAYLOAD }) },
  );
  assert.equal(read.type, "KalshiMarketRead");
  assert.equal(read.ticker, "KXHIGHNY-26SEP05-T79");
  assert.equal(read.yesBid, 0.26);
  assert.equal(read.yesAsk, 0.27);
  assert.equal(read.noBid, 0.73);
  assert.equal(read.noAsk, 0.74);
  assert.equal(read.lastPrice, 0.26);
  assert.equal(read.volume, 4569.81);
  assert.equal(read.openInterest, 3346.31);
  assert.deepEqual(read.orderbook.yes, [{ priceDollars: 0.01, quantity: 1358 }, { priceDollars: 0.26, quantity: 47.69 }]);
  assert.deepEqual(read.orderbook.no, [{ priceDollars: 0.01, quantity: 831 }, { priceDollars: 0.73, quantity: 2 }]);
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

test("refuses a malformed request", async () => {
  await assert.rejects(readKalshiMarket(null), /request must be a JSON object/u);
});
