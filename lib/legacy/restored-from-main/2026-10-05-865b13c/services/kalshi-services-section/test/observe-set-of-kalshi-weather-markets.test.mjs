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
    targetDate: "2026-09-05",
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
    sourceUrl: "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXHIGHNY&status=open&limit=200",
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
