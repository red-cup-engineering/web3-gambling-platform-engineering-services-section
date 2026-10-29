import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkStakeMandate } from "../scripts/check-stake-mandate.mjs";

function freshDataRoot() {
  return mkdtempSync(join(tmpdir(), "kalshi-stake-path-mandate-"));
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

function admittedIntent(overrides = {}) {
  return { id: "ni:///sha-256;fake-intent", admitted: true, marketTicker: "KXHIGHNY-26SEP05-B85.5", stakeUsd: "10.00", ...overrides };
}

test("checkStakeMandate refuses an unarmed envelope", () => {
  const dataRoot = freshDataRoot();
  const result = checkStakeMandate({ intent: admittedIntent(), seriesTicker: "KXHIGHNY", envelope: envelope({ armed: false }), dataRoot });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /envelope-unarmed/);
});

test("checkStakeMandate refuses a series not admitted by the envelope", () => {
  const dataRoot = freshDataRoot();
  const result = checkStakeMandate({ intent: admittedIntent(), seriesTicker: "KXDENHIGH", envelope: envelope(), dataRoot });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /series-not-admitted/);
});

test("checkStakeMandate refuses an expired envelope", () => {
  const dataRoot = freshDataRoot();
  const result = checkStakeMandate({ intent: admittedIntent(), seriesTicker: "KXHIGHNY", envelope: envelope({ expiry: "2020-01-01T00:00:00.000Z" }), dataRoot });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /envelope-expired/);
});

test("checkStakeMandate refuses a stake exceeding the per-order cap", () => {
  const dataRoot = freshDataRoot();
  const result = checkStakeMandate({ intent: admittedIntent({ stakeUsd: "999.00" }), seriesTicker: "KXHIGHNY", envelope: envelope(), dataRoot });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /per-order-cap-exceeded/);
});

test("checkStakeMandate refuses a non-admitted stake intent", () => {
  const dataRoot = freshDataRoot();
  const result = checkStakeMandate({ intent: admittedIntent({ admitted: false, reason: "record #1 missing" }), seriesTicker: "KXHIGHNY", envelope: envelope(), dataRoot });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /stake intent is not admitted/);
});

test("checkStakeMandate admits a well-formed stake within every bound, and tracks the cumulative cap across calls", () => {
  const dataRoot = freshDataRoot();
  const roomyEnvelope = envelope({ perOrderCapUsd: "100", cumulativeCapUsd: "100" });
  const first = checkStakeMandate({ intent: admittedIntent({ stakeUsd: "10.00" }), seriesTicker: "KXHIGHNY", envelope: roomyEnvelope, dataRoot });
  assert.equal(first.admitted, true);
  assert.equal(first.cumulativeStakedUsdAfter, "10");

  const second = checkStakeMandate({ intent: admittedIntent({ stakeUsd: "20.00" }), seriesTicker: "KXHIGHNY", envelope: roomyEnvelope, dataRoot });
  assert.equal(second.admitted, true);
  assert.equal(second.cumulativeStakedUsdBefore, "10");
  assert.equal(second.cumulativeStakedUsdAfter, "30");

  // A third stake would push cumulative past the $100 cap (30 + 90 = 120 > 100), while staying under the $100 per-order cap.
  const third = checkStakeMandate({ intent: admittedIntent({ stakeUsd: "90.00" }), seriesTicker: "KXHIGHNY", envelope: roomyEnvelope, dataRoot });
  assert.equal(third.admitted, false);
  assert.match(third.reason, /cumulative-cap-exceeded/);
});
