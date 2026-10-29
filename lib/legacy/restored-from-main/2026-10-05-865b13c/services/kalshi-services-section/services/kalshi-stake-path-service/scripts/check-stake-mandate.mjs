#!/usr/bin/env node
/**
 * Checks one derived stake intent against the deterministic authority
 * envelope (mandate -> data as-of -> strategy version -> risk-sized intent
 * -> authorization, meet-then-beat's consequential-surface loop): series
 * admission, per-order cap, cumulative cap (summed over every previously
 * admitted mandate check since the envelope was last armed), expiry, and
 * `armed`. Never places an order; a refused mandate check is a datum
 * naming exactly which bound refused it.
 */

import { resolve } from "node:path";
import { add, parse, format } from "@red-cup-engineering/energy-bank/decimal";
import { validateAuthorityEnvelope, isSeriesAdmitted, isEnvelopeExpired, exceedsPerOrderCap, exceedsCumulativeCap } from "../src/authority-envelope.mjs";
import { journalFor } from "../src/journal.mjs";

export const NODE_ROOT = resolve(new URL("..", import.meta.url).pathname);
export const MANDATE_CHECK_CATEGORY = "kalshi-stake-path.mandate-check";
export const MANDATE_CHECK_OBJECT_KIND = "kalshi-stake-path.mandate-check-record";

/**
 * The sum of `stakeUsd` over every previously admitted mandate check
 * recorded since the envelope's current `armedAt` (or over all recorded
 * history when the envelope carries no `armedAt`).
 * @param {ReturnType<typeof validateAuthorityEnvelope>} envelope
 * @param {{dataRoot?: string}} [options]
 * @returns {string} an exact decimal string.
 */
export function cumulativeStakedUsdSinceArming(envelope, options = {}) {
  const rows = journalFor({ dataRoot: options.dataRoot, objectKind: MANDATE_CHECK_OBJECT_KIND, nodeRoot: NODE_ROOT }).query({ category: MANDATE_CHECK_CATEGORY })
    .filter((row) => row.record.admitted === true)
    .filter((row) => !envelope.armedAt || Date.parse(row.record.checkedAt) >= Date.parse(envelope.armedAt));
  return format(rows.reduce((total, row) => add(total, parse(row.record.stakeUsd)), parse("0")));
}

/**
 * Checks one admitted stake intent against the authority envelope.
 * @param {{intent: object, seriesTicker: string, envelope: object, dataRoot?: string, now?: string}} input
 * @returns {{id: string, objectKind: string} & object} the recorded admitted-or-refused mandate-check record.
 */
export function checkStakeMandate({ intent, seriesTicker, envelope, dataRoot, now }) {
  if (typeof intent !== "object" || intent === null) throw new TypeError("check-stake-mandate: intent is required");
  if (typeof seriesTicker !== "string" || seriesTicker.length === 0) throw new TypeError("check-stake-mandate: seriesTicker is required");
  const validEnvelope = validateAuthorityEnvelope(envelope);
  const checkedAt = now ?? new Date().toISOString();

  const base = { type: "KalshiStakeMandateCheck", version: 1, intentId: intent.id ?? null, marketTicker: intent.marketTicker ?? null, seriesTicker, stakeUsd: intent.stakeUsd ?? null, checkedAt };
  const journal = journalFor({ dataRoot, objectKind: MANDATE_CHECK_OBJECT_KIND, nodeRoot: NODE_ROOT });
  const record = (fields) => {
    const receipt = journal.record({ category: MANDATE_CHECK_CATEGORY, recordedAt: checkedAt, record: fields, charge: { support: fields.admitted === true, refutation: fields.admitted === false } });
    return { id: receipt.id, ...fields };
  };

  const stakeUsd = intent.stakeUsd;
  if (intent.admitted !== true || typeof stakeUsd !== "string") {
    return record({ ...base, admitted: false, reason: `stake intent is not admitted: ${intent.reason ?? "no stakeUsd"}` });
  }
  if (!isSeriesAdmitted(validEnvelope, seriesTicker)) {
    return record({ ...base, admitted: false, reason: `series-not-admitted: envelope does not admit series "${seriesTicker}" (admittedSeries: ${validEnvelope.admittedSeries.join(", ")})` });
  }
  if (isEnvelopeExpired(validEnvelope, checkedAt)) {
    return record({ ...base, admitted: false, reason: `envelope-expired: expiry ${validEnvelope.expiry} is at or before now ${checkedAt}` });
  }
  if (validEnvelope.armed !== true) {
    return record({ ...base, admitted: false, reason: "envelope-unarmed: armed is false -- the founder's one arming act has not occurred" });
  }
  if (exceedsPerOrderCap(validEnvelope, stakeUsd)) {
    return record({ ...base, admitted: false, reason: `per-order-cap-exceeded: stake ${stakeUsd} exceeds perOrderCapUsd ${validEnvelope.perOrderCapUsd}` });
  }
  const cumulativeStakedUsdBefore = cumulativeStakedUsdSinceArming(validEnvelope, { dataRoot });
  if (exceedsCumulativeCap(validEnvelope, stakeUsd, cumulativeStakedUsdBefore)) {
    return record({ ...base, admitted: false, reason: `cumulative-cap-exceeded: ${cumulativeStakedUsdBefore} already staked plus ${stakeUsd} would exceed cumulativeCapUsd ${validEnvelope.cumulativeCapUsd}`, cumulativeStakedUsdBefore });
  }
  const cumulativeStakedUsdAfter = format(add(parse(cumulativeStakedUsdBefore), parse(stakeUsd)));
  return record({ ...base, admitted: true, cumulativeStakedUsdBefore, cumulativeStakedUsdAfter });
}

if (import.meta.main) {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    process.stderr.write("usage: check-stake-mandate.mjs <request.json>\n");
    process.exitCode = 2;
  } else {
    const { readFileSync } = await import("node:fs");
    const request = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    process.stdout.write(`${JSON.stringify(checkStakeMandate(request), null, 2)}\n`);
  }
}
