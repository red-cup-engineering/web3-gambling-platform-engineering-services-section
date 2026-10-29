import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileStakeFill } from "../scripts/reconcile-stake-fill.mjs";
import { haltStakeEnvelope } from "../scripts/halt-stake-envelope.mjs";
import { saveEnvelope } from "../src/authority-envelope.mjs";

function freshDataRoot() {
  return mkdtempSync(join(tmpdir(), "kalshi-stake-path-halt-"));
}

function envelope(overrides = {}) {
  return {
    type: "KalshiStakeAuthorityEnvelope", version: 1, venue: "kalshi",
    admittedSeries: ["KXHIGHNY"], perOrderCapUsd: "25", cumulativeCapUsd: "100",
    drawdownFloorFraction: 0.2, sleeve: { riskCapital: "100", survivalCapital: "0" },
    expiry: "2027-01-01T00:00:00.000Z", killPath: "halt-stake-envelope.mjs",
    signer: { host: "cold-red-gate" }, principal: { actorId: "emsenn", role: "founder" },
    armed: true, armedAt: "2026-09-05T00:00:00.000Z", haltedAt: null, haltReason: null,
    ...overrides,
  };
}

function venueInstruction(id, order) {
  return { id, order };
}

test("haltStakeEnvelope is a no-op on an already-unarmed envelope", () => {
  const dataRoot = freshDataRoot();
  const result = haltStakeEnvelope({ envelope: envelope({ armed: false }), dataRoot });
  assert.equal(result.tripped, false);
  assert.equal(result.reason, "already-unarmed");
});

test("haltStakeEnvelope stays armed when neither expiry nor drawdown floor is breached", () => {
  const dataRoot = freshDataRoot();
  const result = haltStakeEnvelope({ envelope: envelope(), dataRoot });
  assert.equal(result.tripped, false);
  assert.equal(result.envelope.armed, true);
});

test("haltStakeEnvelope trips on expiry", () => {
  const dataRoot = freshDataRoot();
  const result = haltStakeEnvelope({ envelope: envelope({ expiry: "2020-01-01T00:00:00.000Z" }), dataRoot });
  assert.equal(result.tripped, true);
  assert.match(result.reason, /expiry/);
  assert.equal(result.envelope.armed, false);
});

test("haltStakeEnvelope trips on a drawdown-fixture: cumulative realized losses past the sleeve's drawdownFloorFraction, and persists armed:false", () => {
  const dataRoot = freshDataRoot();
  const envelopePath = join(dataRoot, "authority-envelope.json");
  const armedEnvelope = envelope(); // riskCapital 100, drawdownFloorFraction 0.2 -> floor is a $20 loss.
  saveEnvelope(envelopePath, armedEnvelope);

  // Book a $27 realized loss under the KXHIGHNY reference class (30 "yes" contracts at 90c that
  // resolved "no" -- cost 30*0.90=$27, past the $20 floor: 0.2 * $100 riskCapital).
  reconcileStakeFill({
    venueInstruction: venueInstruction("vi-1", { ticker: "KXHIGHNY-26SEP05-B85.5", side: "yes", count: 30, priceCents: 90 }),
    referenceClass: "kalshi.weather.KXHIGHNY", settlementResult: "no", dataRoot,
  });

  const result = haltStakeEnvelope({ envelopePath, dataRoot });
  assert.equal(result.tripped, true);
  assert.match(result.reason, /drawdown/);
  assert.equal(result.envelope.armed, false);
  assert.equal(result.totalRealizedPnlUsd, "-27.00");

  const persisted = JSON.parse(readFileSync(envelopePath, "utf8"));
  assert.equal(persisted.armed, false);
  assert.equal(typeof persisted.haltedAt, "string");
});
