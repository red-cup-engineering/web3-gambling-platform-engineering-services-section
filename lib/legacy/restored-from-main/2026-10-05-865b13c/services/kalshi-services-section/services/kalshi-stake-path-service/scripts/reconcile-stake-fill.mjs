#!/usr/bin/env node
/**
 * Books one venue instruction against its observed settlement result as a
 * matched pair (venue instruction + acknowledgement, when live, against
 * the resolution), computing realized USD P&L on Kalshi's own $1-per-
 * contract-if-correct settlement, and rolls it into the reference class's
 * cumulative realized P&L that `halt-stake-envelope.mjs` reads for its
 * drawdown floor. Never re-derives the settlement itself -- the caller
 * supplies `settlementResult` from Kalshi's own reported result.
 */

import { resolve } from "node:path";
import { add, parse, format } from "@red-cup-engineering/energy-bank/decimal";
import { journalFor } from "../src/journal.mjs";

export const NODE_ROOT = resolve(new URL("..", import.meta.url).pathname);
export const RECONCILIATION_CATEGORY = "kalshi-stake-path.reconciliation";
export const RECONCILIATION_OBJECT_KIND = "kalshi-stake-path.reconciliation-record";

/**
 * The reference class's cumulative realized P&L: the latest reconciliation
 * row per venue instruction (so a resolved re-reconciliation supersedes an
 * earlier "unresolved" placeholder rather than double-counting it), summed
 * over every row whose outcome is not "unresolved".
 * @param {string} referenceClass
 * @param {{dataRoot?: string}} [options]
 * @returns {string} an exact decimal string; negative when the reference class is net-down.
 */
export function cumulativeRealizedPnlUsd(referenceClass, options = {}) {
  const rows = journalFor({ dataRoot: options.dataRoot, objectKind: RECONCILIATION_OBJECT_KIND, nodeRoot: NODE_ROOT }).query({ category: RECONCILIATION_CATEGORY })
    .filter((row) => row.record.referenceClass === referenceClass);
  const latestByInstruction = new Map();
  for (const row of rows) {
    const existing = latestByInstruction.get(row.record.venueInstructionId);
    if (!existing || Date.parse(row.record.reconciledAt) >= Date.parse(existing.record.reconciledAt)) {
      latestByInstruction.set(row.record.venueInstructionId, row);
    }
  }
  return format([...latestByInstruction.values()]
    .filter((row) => row.record.outcome !== "unresolved")
    .reduce((total, row) => add(total, parse(row.record.realizedPnlUsd)), parse("0")));
}

/**
 * Books one venue instruction against its settlement result.
 * @param {object} input
 * @param {object} input.venueInstruction The place-stake-order record (carries `order`, `intentId`, `acknowledgementId`).
 * @param {string} input.referenceClass The stake's calibration reference class.
 * @param {"yes"|"no"|"unresolved"} input.settlementResult Kalshi's own reported settlement result for this market, or "unresolved" when not yet settled.
 * @param {string} [input.dataRoot]
 * @param {string} [input.now]
 * @returns {{id: string} & object} the recorded reconciliation record.
 */
export function reconcileStakeFill({ venueInstruction, referenceClass, settlementResult, dataRoot, now }) {
  if (typeof venueInstruction !== "object" || venueInstruction === null || typeof venueInstruction.order !== "object") {
    throw new TypeError("reconcile-stake-fill: venueInstruction (with its order) is required");
  }
  if (typeof referenceClass !== "string" || referenceClass.length === 0) throw new TypeError("reconcile-stake-fill: referenceClass is required");
  if (!["yes", "no", "unresolved"].includes(settlementResult)) throw new TypeError('reconcile-stake-fill: settlementResult must be "yes", "no", or "unresolved"');

  const reconciledAt = now ?? new Date().toISOString();
  const { order } = venueInstruction;
  let realizedPnlUsd = "0.00";
  if (settlementResult !== "unresolved") {
    const won = settlementResult === order.side;
    const cost = (order.count * order.priceCents) / 100;
    const payoutIfWon = order.count * 1;
    realizedPnlUsd = (won ? payoutIfWon - cost : -cost).toFixed(2);
  }

  const fields = {
    type: "KalshiStakeReconciliation", version: 1,
    venueInstructionId: venueInstruction.id, acknowledgementId: venueInstruction.acknowledgementId ?? null,
    marketTicker: order.ticker, referenceClass, outcome: settlementResult, side: order.side, contracts: order.count, priceCents: order.priceCents,
    realizedPnlUsd, reconciledAt,
  };
  const receipt = journalFor({ dataRoot, objectKind: RECONCILIATION_OBJECT_KIND, nodeRoot: NODE_ROOT }).record({
    category: RECONCILIATION_CATEGORY,
    recordedAt: reconciledAt,
    record: fields,
    charge: { support: settlementResult !== "unresolved", refutation: false },
  });
  return { id: receipt.id, ...fields };
}

if (import.meta.main) {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    process.stderr.write("usage: reconcile-stake-fill.mjs <request.json>\n");
    process.exitCode = 2;
  } else {
    const { readFileSync } = await import("node:fs");
    const request = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    process.stdout.write(`${JSON.stringify(reconcileStakeFill(request), null, 2)}\n`);
  }
}
