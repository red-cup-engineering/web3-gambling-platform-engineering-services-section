#!/usr/bin/env node
// The order-placement-admission effect, behind the Kalshi venue's activation
// gate. Refuses venue-not-activated whenever activation is not live or
// carries no credentials -- the normal case while KYC is unarmed. When live,
// signs and POSTs the real Kalshi order body via an injectable fetch, never
// touching process.env or the filesystem.
import { createSign, constants } from "node:crypto";
import { runJavascriptNodeOperation } from "../../../../../../../../../../../../../computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/src/operation.mjs";

const ORDER_PATH = "/trade-api/v2/portfolio/orders";
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

function signRequest({ privateKeyPem, timestampMs, method, path }) {
  const signer = createSign("sha256");
  signer.update(`${timestampMs}${method.toUpperCase()}${path}`);
  return signer.sign({ key: privateKeyPem, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, "base64");
}

/**
 * Places one order on Kalshi's trade-api v2, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.
 * @param {object} request A PlaceKalshiOrderRequest.
 * @param {{ticker: string, side: ("yes"|"no"), action?: ("buy"|"sell"), contracts: number, priceDollars: number}} request.intent A KalshiOrderIntent (or the fields of one) naming the order to place.
 * @param {{orderExecution: string, credentials?: {apiKeyId: string, privateKeyPem: string}}} request.activation The venue's activation record; orderExecution must be "live" and credentials must be present for a real placement.
 * @param {string} [request.clientOrderId] An idempotency key for the order; a caller-supplied value is used verbatim.
 * @param {{fetchImpl?: typeof fetch, baseUrl?: string, timestampMs?: number}} [options] `fetchImpl` overrides the network call for tests; `baseUrl` overrides the production host; `timestampMs` overrides the signed timestamp for tests.
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
  const timestampMs = typeof options.timestampMs === "number" ? options.timestampMs : Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const priceCents = Math.round(priceDollars * 100);
  const body = {
    ticker,
    action,
    side,
    count: contracts,
    type: "limit",
    [side === "yes" ? "yes_price" : "no_price"]: priceCents,
    client_order_id: typeof request.clientOrderId === "string" && request.clientOrderId.length > 0 ? request.clientOrderId : `${ticker}-${timestampMs}`,
  };
  const signature = signRequest({ privateKeyPem, timestampMs, method: "POST", path: ORDER_PATH });
  const response = await fetchImpl(`${baseUrl}${ORDER_PATH}`, {
    method: "POST",
    headers: {
      "KALSHI-ACCESS-KEY": apiKeyId,
      "KALSHI-ACCESS-SIGNATURE": signature,
      "KALSHI-ACCESS-TIMESTAMP": String(timestampMs),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return reject(`venue-http-${response.status}`, payload?.error?.message ?? "Kalshi order placement failed");
  return payload;
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "place-kalshi-order", description: "Places one order on Kalshi's trade-api v2, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.", operation: placeKalshiOrder }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
