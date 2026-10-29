import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placeStakeOrder, hasKalshiCredentials } from "../scripts/place-stake-order.mjs";

function freshDataRoot() {
  return mkdtempSync(join(tmpdir(), "kalshi-stake-path-place-"));
}

function envelope(overrides = {}) {
  return {
    type: "KalshiStakeAuthorityEnvelope", version: 1, venue: "kalshi",
    admittedSeries: ["KXHIGHNY"], perOrderCapUsd: "25", cumulativeCapUsd: "100",
    drawdownFloorFraction: 0.2, sleeve: { riskCapital: "250", survivalCapital: "0" },
    expiry: "2027-01-01T00:00:00.000Z", killPath: "halt-stake-envelope.mjs",
    signer: { host: "cold-red-gate" }, principal: { actorId: "emsenn", role: "founder" },
    armed: true, armedAt: "2026-09-05T00:00:00.000Z", haltedAt: null, haltReason: null,
    ...overrides,
  };
}

const INTENT = { id: "ni:///sha-256;fake-intent", admitted: true, marketTicker: "KXHIGHNY-26SEP05-B85.5", side: "yes", contracts: 10, marketPrice: 0.6 };
const MANDATE_CHECK = { id: "ni:///sha-256;fake-mandate-check", admitted: true };

test("hasKalshiCredentials is false when the env vars are absent", () => {
  const savedKey = process.env.KALSHI_API_KEY_ID;
  const savedPath = process.env.KALSHI_PRIVATE_KEY_PATH;
  delete process.env.KALSHI_API_KEY_ID;
  delete process.env.KALSHI_PRIVATE_KEY_PATH;
  try {
    assert.equal(hasKalshiCredentials(), false);
  } finally {
    if (savedKey !== undefined) process.env.KALSHI_API_KEY_ID = savedKey;
    if (savedPath !== undefined) process.env.KALSHI_PRIVATE_KEY_PATH = savedPath;
  }
});

test("placeStakeOrder in paper mode records the instruction and never calls the venue", async () => {
  const dataRoot = freshDataRoot();
  const result = await placeStakeOrder({ intent: INTENT, mandateCheck: MANDATE_CHECK, envelope: envelope(), paper: true, dataRoot });
  assert.equal(result.mode, "paper");
  assert.equal(result.placed, false);
  assert.equal(result.acknowledgementId, null);
  assert.equal(result.order.ticker, "KXHIGHNY-26SEP05-B85.5");
  assert.equal(result.order.side, "yes");
  assert.equal(result.order.count, 10);
  assert.equal(result.order.priceCents, 60);
  assert.equal(typeof result.id, "string");
});

test("placeStakeOrder records mode \"unarmed\" (never calls the venue) when the envelope is not armed, even with paper: false", async () => {
  const dataRoot = freshDataRoot();
  const result = await placeStakeOrder({ intent: INTENT, mandateCheck: MANDATE_CHECK, envelope: envelope({ armed: false }), paper: false, dataRoot });
  assert.equal(result.mode, "unarmed");
  assert.equal(result.placed, false);
});

test("placeStakeOrder records mode \"no-credential\" (never calls the venue) when armed but uncredentialed", async () => {
  const dataRoot = freshDataRoot();
  const savedKey = process.env.KALSHI_API_KEY_ID;
  const savedPath = process.env.KALSHI_PRIVATE_KEY_PATH;
  delete process.env.KALSHI_API_KEY_ID;
  delete process.env.KALSHI_PRIVATE_KEY_PATH;
  try {
    const result = await placeStakeOrder({ intent: INTENT, mandateCheck: MANDATE_CHECK, envelope: envelope(), paper: false, dataRoot });
    assert.equal(result.mode, "no-credential");
    assert.equal(result.placed, false);
  } finally {
    if (savedKey !== undefined) process.env.KALSHI_API_KEY_ID = savedKey;
    if (savedPath !== undefined) process.env.KALSHI_PRIVATE_KEY_PATH = savedPath;
  }
});

test("placeStakeOrder refuses a non-admitted intent or mandate check with a TypeError", async () => {
  const dataRoot = freshDataRoot();
  await assert.rejects(() => placeStakeOrder({ intent: { ...INTENT, admitted: false }, mandateCheck: MANDATE_CHECK, envelope: envelope(), dataRoot }), TypeError);
  await assert.rejects(() => placeStakeOrder({ intent: INTENT, mandateCheck: { ...MANDATE_CHECK, admitted: false }, envelope: envelope(), dataRoot }), TypeError);
});
