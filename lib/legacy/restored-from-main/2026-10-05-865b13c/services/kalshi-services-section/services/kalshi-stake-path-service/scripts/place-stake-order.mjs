#!/usr/bin/env node
/**
 * Turns one mandate-admitted stake intent into a Kalshi venue instruction.
 * With `paper: true`, an unarmed envelope, or absent
 * KALSHI_API_KEY_ID/KALSHI_PRIVATE_KEY_PATH credentials, the instruction is
 * recorded and the venue is never called. Only when armed, credentialed,
 * and not paper does it call
 * `@red-cup-engineering/kalshi-services-section`'s existing `src/client.mjs`
 * `createOrder` -- never a second Kalshi execution path -- and record the
 * acknowledgement.
 */

import { resolve } from "node:path";
import { createOrder, kalshiCredentials } from "@red-cup-engineering/kalshi-services-section/client";
import { validateAuthorityEnvelope } from "../src/authority-envelope.mjs";
import { buildKalshiOrder } from "../src/venue-instruction.mjs";
import { journalFor } from "../src/journal.mjs";

export const NODE_ROOT = resolve(new URL("..", import.meta.url).pathname);
export const VENUE_INSTRUCTION_CATEGORY = "kalshi-stake-path.venue-instruction";
export const VENUE_INSTRUCTION_OBJECT_KIND = "kalshi-stake-path.venue-instruction-record";
export const ACKNOWLEDGEMENT_CATEGORY = "kalshi-stake-path.acknowledgement";
export const ACKNOWLEDGEMENT_OBJECT_KIND = "kalshi-stake-path.acknowledgement-record";

/**
 * True when both Kalshi trade-API credential environment variables are
 * present. Presence alone is not evidence of a funded, live account
 * (@red-cup-engineering/kalshi-services-section's own activation.json
 * carries that distinction) -- it only gates whether this script attempts
 * the venue call at all.
 * @returns {boolean}
 */
export function hasKalshiCredentials() {
  return kalshiCredentials() !== null;
}

/**
 * Places (or, in every non-live mode, merely records) one Kalshi order for
 * a mandate-admitted stake intent.
 * @param {object} input
 * @param {object} input.intent The derive-stake-intent record (admitted: true), carrying marketTicker/side/contracts/marketPrice.
 * @param {object} input.mandateCheck The check-stake-mandate record (admitted: true) for this same intent.
 * @param {object} input.envelope The authority envelope.
 * @param {boolean} [input.paper] Force paper mode even when armed and credentialed; defaults to true (never places live by accident).
 * @param {string} [input.dataRoot]
 * @param {string} [input.now]
 * @returns {Promise<{id: string} & object>} the recorded venue-instruction record.
 */
export async function placeStakeOrder({ intent, mandateCheck, envelope, paper = true, dataRoot, now }) {
  if (typeof intent !== "object" || intent === null || intent.admitted !== true) throw new TypeError("place-stake-order: intent must be an admitted stake intent");
  if (typeof mandateCheck !== "object" || mandateCheck === null || mandateCheck.admitted !== true) throw new TypeError("place-stake-order: mandateCheck must be an admitted mandate check");
  const validEnvelope = validateAuthorityEnvelope(envelope);
  const recordedAt = now ?? new Date().toISOString();

  const order = buildKalshiOrder({ marketTicker: intent.marketTicker, side: intent.side, contracts: intent.contracts, marketPrice: intent.marketPrice }, intent.id);
  const envelopeSnapshot = { armed: validEnvelope.armed, expiry: validEnvelope.expiry };

  let mode;
  if (paper === true) mode = "paper";
  else if (validEnvelope.armed !== true) mode = "unarmed";
  else if (!hasKalshiCredentials()) mode = "no-credential";
  else mode = "live";

  let placed = false;
  let acknowledgementId = null;
  let venueResponseType = null;
  let venueResponseCode = null;

  if (mode === "live") {
    const venueResponse = await createOrder(order);
    venueResponseType = venueResponse.type;
    venueResponseCode = venueResponse.code ?? null;
    placed = venueResponse.type === "Accept";
    const ackReceipt = journalFor({ dataRoot, objectKind: ACKNOWLEDGEMENT_OBJECT_KIND, nodeRoot: NODE_ROOT }).record({
      category: ACKNOWLEDGEMENT_CATEGORY,
      recordedAt,
      record: { type: "KalshiStakeAcknowledgement", version: 1, intentId: intent.id, order, venueResponse, recordedAt },
      charge: { support: placed, refutation: !placed },
    });
    acknowledgementId = ackReceipt.id;
  }

  const fields = { type: "KalshiStakeVenueInstruction", version: 1, intentId: intent.id, mandateCheckId: mandateCheck.id ?? null, envelopeSnapshot, order, mode, placed, acknowledgementId, venueResponseType, venueResponseCode, recordedAt };
  const receipt = journalFor({ dataRoot, objectKind: VENUE_INSTRUCTION_OBJECT_KIND, nodeRoot: NODE_ROOT }).record({
    category: VENUE_INSTRUCTION_CATEGORY,
    recordedAt,
    record: fields,
    charge: { support: true, refutation: false },
  });
  return { id: receipt.id, ...fields };
}

if (import.meta.main) {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    process.stderr.write("usage: place-stake-order.mjs <request.json>\n");
    process.exitCode = 2;
  } else {
    const { readFileSync } = await import("node:fs");
    const request = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    const result = await placeStakeOrder(request);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
