import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileStakeFill, cumulativeRealizedPnlUsd } from "../scripts/reconcile-stake-fill.mjs";

function freshDataRoot() {
  return mkdtempSync(join(tmpdir(), "kalshi-stake-path-reconcile-"));
}

test("reconcileStakeFill books a winning fill: contracts * (1 - price)", () => {
  const dataRoot = freshDataRoot();
  const result = reconcileStakeFill({
    venueInstruction: { id: "vi-win", order: { ticker: "KXHIGHNY-26SEP05-B85.5", side: "yes", count: 10, priceCents: 60 } },
    referenceClass: "kalshi.weather.KXHIGHNY", settlementResult: "yes", dataRoot,
  });
  assert.equal(result.outcome, "yes");
  assert.equal(result.realizedPnlUsd, "4.00"); // 10 contracts pay $1 each = $10, cost was $6 -> +$4
});

test("reconcileStakeFill books a losing fill as the full cost, negative", () => {
  const dataRoot = freshDataRoot();
  const result = reconcileStakeFill({
    venueInstruction: { id: "vi-lose", order: { ticker: "KXHIGHNY-26SEP05-B85.5", side: "yes", count: 10, priceCents: 60 } },
    referenceClass: "kalshi.weather.KXHIGHNY", settlementResult: "no", dataRoot,
  });
  assert.equal(result.outcome, "no");
  assert.equal(result.realizedPnlUsd, "-6.00");
});

test("reconcileStakeFill records zero P&L for an unresolved market, and a later resolved reconciliation supersedes it in the cumulative total", () => {
  const dataRoot = freshDataRoot();
  const venueInstruction = { id: "vi-pending", order: { ticker: "KXHIGHNY-26SEP05-B85.5", side: "yes", count: 5, priceCents: 50 } };
  const pending = reconcileStakeFill({ venueInstruction, referenceClass: "kalshi.weather.KXHIGHNY", settlementResult: "unresolved", dataRoot });
  assert.equal(pending.realizedPnlUsd, "0.00");
  assert.equal(cumulativeRealizedPnlUsd("kalshi.weather.KXHIGHNY", { dataRoot }), "0");

  reconcileStakeFill({ venueInstruction, referenceClass: "kalshi.weather.KXHIGHNY", settlementResult: "yes", dataRoot, now: "2026-09-06T00:00:00.000Z" });
  assert.equal(cumulativeRealizedPnlUsd("kalshi.weather.KXHIGHNY", { dataRoot }), "2.5");
});
