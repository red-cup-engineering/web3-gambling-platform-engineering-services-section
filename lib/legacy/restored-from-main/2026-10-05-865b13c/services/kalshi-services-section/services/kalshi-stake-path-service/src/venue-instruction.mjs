/**
 * The Kalshi order shape built from one mandate-admitted stake intent --
 * exactly the body `@red-cup-engineering/kalshi-services-section`'s
 * `src/client.mjs` `createOrder` already sends, so this package never opens
 * a second Kalshi execution path. Pure construction only; calling the venue
 * is `scripts/place-stake-order.mjs`'s concern.
 */


import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
export const VENUE_INSTRUCTION_TYPE = "KalshiStakeVenueInstruction";

/**
 * Deterministic client order id for one admitted intent: same intent id
 * always yields the same clientOrderId, so a retried placement is
 * idempotent at the venue rather than opening a second order.
 * @param {string} intentId
 * @returns {string}
 */
export function clientOrderIdFromIntent(intentId) {
  return `stake-${sha256Hex(intentId).slice(0, 48)}`;
}

/**
 * Builds the Kalshi order body for one admitted stake intent.
 * @param {{marketTicker: string, side: "yes"|"no", contracts: number, marketPrice: number}} intent
 * @param {string} intentId
 * @returns {{ticker: string, action: "buy", side: "yes"|"no", count: number, type: "limit", priceCents: number, clientOrderId: string}}
 */
export function buildKalshiOrder(intent, intentId) {
  if (typeof intent.marketTicker !== "string" || intent.marketTicker.length === 0) throw new TypeError("venue-instruction: marketTicker is required");
  if (intent.side !== "yes" && intent.side !== "no") throw new TypeError("venue-instruction: side must be \"yes\" or \"no\"");
  if (!Number.isInteger(intent.contracts) || intent.contracts < 1) throw new TypeError("venue-instruction: contracts must be a positive integer");
  if (typeof intent.marketPrice !== "number" || intent.marketPrice <= 0 || intent.marketPrice >= 1) throw new TypeError("venue-instruction: marketPrice must be in the open interval (0,1)");
  const priceCents = Math.round(intent.marketPrice * 100);
  return {
    ticker: intent.marketTicker,
    action: "buy",
    side: intent.side,
    count: intent.contracts,
    type: "limit",
    priceCents: Math.min(99, Math.max(1, priceCents)),
    clientOrderId: clientOrderIdFromIntent(intentId),
  };
}
