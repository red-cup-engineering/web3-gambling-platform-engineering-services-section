#!/usr/bin/env node
// The order-placement-admission effect, behind the Kalshi venue's activation
// gate. Refuses venue-not-activated whenever activation is not live or
// carries no credentials. When live, places the order through the section's
// one client (src/client.mjs: V2 order shape, Ed25519 or RSA-PSS signing)
// via an injectable fetch, never touching process.env or the filesystem.
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";
import { createKalshiClient } from "../src/client.mjs";

const DEFAULT_BASE_URL = "https://api.elections.kalshi.com";

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`place-kalshi-order: ${label} must be a JSON object`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`place-kalshi-order: ${label} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`place-kalshi-order: ${label} must be a positive integer`);
  }
  return value;
}

const reject = (code, detail) => ({ type: "Reject", code, detail, venueWrite: false });

/**
 * Places one order on Kalshi's trade-api v2, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.
 * @param {object} request A PlaceKalshiOrderRequest.
 * @param {{ticker: string, side: ("yes"|"no"), action?: ("buy"|"sell"), contracts: number, priceDollars: number}} request.intent A KalshiOrderIntent (or the fields of one) naming the order to place.
 * @param {{orderExecution: string, credentials?: {apiKeyId: string, privateKeyPem: string}}} request.activation The venue's activation record; orderExecution must be "live" and credentials must be present for a real placement.
 * @param {string} [request.clientOrderId] An idempotency key for the order; a caller-supplied value is used verbatim.
 * @param {{fetchImpl?: typeof fetch, baseUrl?: string}} [options] `fetchImpl` overrides the network call for tests; `baseUrl` overrides the production host.
 * @returns {Promise<object>} The venue's own JSON acknowledgement, or a Reject datum with code venue-not-activated or a venue-http-<status> code.
 * @throws {TypeError} When the request or its required fields are malformed.
 */
export async function placeKalshiOrder(request, options = {}) {
  requireObject(request, "request");
  const intent = requireObject(request.intent, "request.intent");
  const ticker = requireNonEmptyString(intent.ticker, "request.intent.ticker");
  const side = requireNonEmptyString(intent.side, "request.intent.side");
  const action = typeof intent.action === "string" && intent.action.length > 0 ? intent.action : "buy";
  const contracts = requirePositiveInteger(intent.contracts, "request.intent.contracts");
  const priceDollars = intent.priceDollars;
  if (typeof priceDollars !== "number" || !Number.isFinite(priceDollars) || priceDollars <= 0 || priceDollars >= 1) {
    throw new TypeError("place-kalshi-order: request.intent.priceDollars must be a finite number in (0,1)");
  }
  const activation = requireObject(request.activation, "request.activation");

  if (activation.orderExecution !== "live" || !activation.credentials) {
    return reject("venue-not-activated", "Kalshi order execution requires live activation with armed credentials; venue accounts remain the founder's hands");
  }

  const { apiKeyId, privateKeyPem } = requireObject(activation.credentials, "request.activation.credentials");
  requireNonEmptyString(apiKeyId, "request.activation.credentials.apiKeyId");
  requireNonEmptyString(privateKeyPem, "request.activation.credentials.privateKeyPem");

  const baseUrl = typeof options.baseUrl === "string" && options.baseUrl.length > 0 ? options.baseUrl : DEFAULT_BASE_URL;
  const client = createKalshiClient({ credentials: { apiKeyId, privateKeyPem }, baseUrl: `${baseUrl}/trade-api/v2`, fetchImpl: options.fetchImpl ?? fetch });
  // One YES book: a long-YES order (buy yes, sell no) is a bid, a long-NO one an ask, at the YES price.
  const longYes = (action === "buy") === (side === "yes");
  const yesPrice = side === "yes" ? priceDollars : 1 - priceDollars;
  try {
    return await client.createOrder({
      ticker, side: longYes ? "bid" : "ask", count: contracts, price: Math.round(yesPrice * 100) / 100,
      clientOrderId: typeof request.clientOrderId === "string" && request.clientOrderId.length > 0 ? request.clientOrderId : `${ticker}-${Date.now()}`,
    });
  } catch (error) {
    return { type: "Reject", code: error.status ? `venue-http-${error.status}` : `venue-${error.code}`, detail: error.detail ?? "Kalshi order placement failed", venueWrite: error.venueWrite ?? false };
  }
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "place-kalshi-order", description: "Places one order on Kalshi's trade-api v2, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.", operation: placeKalshiOrder }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
