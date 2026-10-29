import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { placeKalshiOrder } from "../scripts/place-kalshi-order.mjs";

const INTENT = { ticker: "KXHIGHNY-26SEP05-T79", side: "yes", action: "buy", contracts: 3, priceDollars: 0.27 };
const TEST_PRIVATE_KEY_PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });

test("refuses venue-not-activated when orderExecution is refused (today's real state)", async () => {
  const result = await placeKalshiOrder({ intent: INTENT, activation: { orderExecution: "refused" } });
  assert.equal(result.type, "Reject");
  assert.equal(result.code, "venue-not-activated");
  assert.equal(result.venueWrite, false);
});

test("refuses venue-not-activated when live but credentials are absent", async () => {
  const result = await placeKalshiOrder({ intent: INTENT, activation: { orderExecution: "live" } });
  assert.equal(result.code, "venue-not-activated");
});

test("signs and posts the real order body over a fixture fetch when activated", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ order: { order_id: "ord_1", status: "resting" } }) };
  };
  const result = await placeKalshiOrder(
    { intent: INTENT, activation: { orderExecution: "live", credentials: { apiKeyId: "kid", privateKeyPem: TEST_PRIVATE_KEY_PEM } } },
    { fetchImpl, timestampMs: 1752900000000 },
  );
  assert.deepEqual(result, { order: { order_id: "ord_1", status: "resting" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.elections.kalshi.com/trade-api/v2/portfolio/orders");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.ticker, "KXHIGHNY-26SEP05-T79");
  assert.equal(body.yes_price, 27);
  assert.equal(body.count, 3);
  assert.equal(calls[0].init.headers["KALSHI-ACCESS-KEY"], "kid");
});

test("reports a venue-http refusal on an HTTP failure", async () => {
  const result = await placeKalshiOrder(
    { intent: INTENT, activation: { orderExecution: "live", credentials: { apiKeyId: "kid", privateKeyPem: TEST_PRIVATE_KEY_PEM } } },
    { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "insufficient balance" } }) }) },
  );
  assert.equal(result.code, "venue-http-400");
  assert.equal(result.venueWrite, false);
});

test("refuses a non-object request", async () => {
  await assert.rejects(placeKalshiOrder(null), /request must be a JSON object/u);
});
