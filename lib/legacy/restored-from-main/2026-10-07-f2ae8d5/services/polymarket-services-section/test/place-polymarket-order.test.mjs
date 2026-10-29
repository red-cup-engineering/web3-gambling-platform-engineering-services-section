import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { placePolymarketOrder } from "../scripts/place-polymarket-order.mjs";

const INTENT = { tokenId: "32338220190071351435772801779725302244575775216413325951443816017994629993401", side: "BUY", price: 0.048, size: 10 };
// A locally generated random scalar for tests only, never a real Polymarket-armed key.
const TEST_PRIVATE_KEY_HEX = "0x" + randomBytes(32).toString("hex");

test("refuses venue-not-activated when orderExecution is refused (today's real state)", async () => {
  const result = await placePolymarketOrder({ intent: INTENT, activation: { orderExecution: "refused" } });
  assert.equal(result.type, "Reject");
  assert.equal(result.code, "venue-not-activated");
  assert.equal(result.venueWrite, false);
});

test("refuses venue-not-activated when live but no signing key is present", async () => {
  const result = await placePolymarketOrder({ intent: INTENT, activation: { orderExecution: "live" } });
  assert.equal(result.code, "venue-not-activated");
});

test("signs and posts an EIP-712 CLOB order over a fixture fetch when activated", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ success: true, orderID: "0xabc" }) };
  };
  const result = await placePolymarketOrder(
    { intent: INTENT, activation: { orderExecution: "live", credentials: { privateKey: TEST_PRIVATE_KEY_HEX } }, clob: { salt: "1" } },
    { fetchImpl },
  );
  assert.deepEqual(result, { success: true, orderID: "0xabc" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://clob.polymarket.com/order");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.order.tokenId, INTENT.tokenId);
  assert.equal(body.order.side, "BUY");
  assert.equal(body.order.makerAmount, "480000");
  assert.equal(body.order.takerAmount, "10000000");
  assert.ok(typeof body.order.signature === "string" && body.order.signature.startsWith("0x"));
  assert.ok(typeof body.order.maker === "string" && body.order.maker.startsWith("0x"));
});

test("the same order fields always produce the same digest, deterministically", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(init); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  await placePolymarketOrder({ intent: INTENT, activation: { orderExecution: "live", credentials: { privateKey: TEST_PRIVATE_KEY_HEX } }, clob: { salt: "1" } }, { fetchImpl });
  await placePolymarketOrder({ intent: INTENT, activation: { orderExecution: "live", credentials: { privateKey: TEST_PRIVATE_KEY_HEX } }, clob: { salt: "1" } }, { fetchImpl });
  const first = JSON.parse(calls[0].body).order.signature;
  const second = JSON.parse(calls[1].body).order.signature;
  assert.equal(first, second);
});

test("reports a venue-http refusal on an HTTP failure", async () => {
  const result = await placePolymarketOrder(
    { intent: INTENT, activation: { orderExecution: "live", credentials: { privateKey: TEST_PRIVATE_KEY_HEX } }, clob: { salt: "1" } },
    { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid signature" }) }) },
  );
  assert.equal(result.code, "venue-http-400");
  assert.equal(result.venueWrite, false);
});

test("refuses a non-object request", async () => {
  await assert.rejects(placePolymarketOrder(null), /request must be a JSON object/u);
});

test("refuses an invalid side", async () => {
  await assert.rejects(
    placePolymarketOrder({ intent: { ...INTENT, side: "HOLD" }, activation: { orderExecution: "refused" } }),
    /side must be "BUY" or "SELL"/u,
  );
});
