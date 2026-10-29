# place-kalshi-order
## Requirements
- `refuses-when-not-activated`: Given an order intent and an activation record, the operation refuses with `venue-not-activated` whenever activation.orderExecution is not "live" or activation.credentials is absent -- the normal case while the Leader has not completed Kalshi KYC and armed credentials.
- `signs-with-rsa-pss`: When activation is live, the operation signs the real Kalshi trade-api v2 POST /portfolio/orders request with RSA-PSS SHA-256 over `${timestampMs}POST/trade-api/v2/portfolio/orders`, matching Kalshi's documented request-signing scheme, and never signs a path carrying query parameters.
- `builds-real-order-body`: When activation is live, the operation builds the real Kalshi order body (ticker, action, side, count, type "limit", yes_price or no_price in cents, client_order_id) from the supplied intent.
- `returns-venue-acknowledgement-or-refusal`: When activation is live, the operation returns the venue's own JSON response on success, or a Reject datum carrying the venue's HTTP status on failure; it never fabricates a fill.
- `injectable-network-call`: The operation accepts an injectable fetch implementation defaulting to the global fetch, so tests and fixtures never require a live placement.
## Prohibitions
- `refuses-non-object-request`: The operation must refuse a request that is not a JSON object.
- `never-reads-credentials-from-environment`: The operation must never read `process.env` or the filesystem for credentials; the caller supplies `activation.credentials` explicitly.
- `no-live-placement-in-tests`: This package's own tests must never perform a real network placement; the live-signing path is exercised only against an injected fixture fetch.
## Laws
- `order-placement-admission-refuse-while-activation-refused` | Kalshi venue-access settlement, 561 Group | v1 | kalshi-services-section/content/contracts/order-placement-admission.json | Applies to every call this operation receives while activation is not live. | The order-placement-admission contract's invariants include refuse-while-activation-refused and refuse-absent-credentials, and no-credential-disclosure; this operation refuses with venue-not-activated in both cases and never echoes a credential in its refusal detail.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file that is eligible for downstream staged package-birth assays.
- `whatwg-fetch-standard` | WHATWG | Living Standard | https://fetch.spec.whatwg.org/ | Applies to the injectable network call this operation makes when activation is live. | The operation uses the Fetch API contract for its HTTP call, real by default via the global fetch and injectable for deterministic tests.
- `kalshi-request-signing` | Kalshi | v2 | https://trading-api.readme.io/reference/api-keys | Applies to the RSA-PSS signature this operation computes over the order request. | Kalshi's trade-api v2 documents RSA-PSS SHA-256 signing over `${timestampMs}${METHOD}${path}` with headers KALSHI-ACCESS-KEY/KALSHI-ACCESS-SIGNATURE/KALSHI-ACCESS-TIMESTAMP, signing the path without query parameters.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/place-kalshi-order-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{},"devDependencies":{}}
```
## Operation
```mjs path=scripts/place-kalshi-order.mjs
#!/usr/bin/env node
// The order-placement-admission effect, behind the Kalshi venue's activation
// gate. Refuses venue-not-activated whenever activation is not live or
// carries no credentials -- the normal case while KYC is unarmed. When live,
// signs and POSTs the real Kalshi order body via an injectable fetch, never
// touching process.env or the filesystem.
import { createSign, constants } from "node:crypto";

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
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "placeKalshiOrder — Places one order on Kalshi's trade-api v2, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(await placeKalshiOrder(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/place-kalshi-order.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { placeKalshiOrder } from "../scripts/place-kalshi-order.mjs";

const INTENT = { ticker: "KXHIGHNY-26SEP05-T79", side: "yes", action: "buy", contracts: 3, priceDollars: 0.27 };
const TEST_PRIVATE_KEY_PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });

test("refuses venue-not-activated when orderExecution is refused (today's real state)", async () => {
  const result = await placeKalshiOrder({ intent: INTENT, activation: { orderExecution: "refused" } });
  assert.equal(result.type, "Reject");
  assert.equal(result.code, "venue-not-activated");
  assert.equal(result.venueWrite, false);
});

test("refuses venue-not-activated when live but credentials are absent", async () => {
  const result = await placeKalshiOrder({ intent: INTENT, activation: { orderExecution: "live" } });
  assert.equal(result.code, "venue-not-activated");
});

test("signs and posts the real order body over a fixture fetch when activated", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ order: { order_id: "ord_1", status: "resting" } }) };
  };
  const result = await placeKalshiOrder(
    { intent: INTENT, activation: { orderExecution: "live", credentials: { apiKeyId: "kid", privateKeyPem: TEST_PRIVATE_KEY_PEM } } },
    { fetchImpl, timestampMs: 1752900000000 },
  );
  assert.deepEqual(result, { order: { order_id: "ord_1", status: "resting" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.elections.kalshi.com/trade-api/v2/portfolio/orders");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.ticker, "KXHIGHNY-26SEP05-T79");
  assert.equal(body.yes_price, 27);
  assert.equal(body.count, 3);
  assert.equal(calls[0].init.headers["KALSHI-ACCESS-KEY"], "kid");
});

test("reports a venue-http refusal on an HTTP failure", async () => {
  const result = await placeKalshiOrder(
    { intent: INTENT, activation: { orderExecution: "live", credentials: { apiKeyId: "kid", privateKeyPem: TEST_PRIVATE_KEY_PEM } } },
    { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "insufficient balance" } }) }) },
  );
  assert.equal(result.code, "venue-http-400");
  assert.equal(result.venueWrite, false);
});

test("refuses a non-object request", async () => {
  await assert.rejects(placeKalshiOrder(null), /request must be a JSON object/u);
});
```
## Examples
```json name="refuses venue-not-activated when activation is refused"
{"input":{"intent":{"ticker":"KXHIGHNY-26SEP05-T79","side":"yes","action":"buy","contracts":3,"priceDollars":0.27},"activation":{"orderExecution":"refused"}},"output":{"type":"Reject","code":"venue-not-activated","detail":"Kalshi order execution requires live activation with armed credentials; venue accounts remain the founder's hands","venueWrite":false}}
```
## Traceability
- `refuses-when-not-activated` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `order-placement-admission-refuse-while-activation-refused`
- `signs-with-rsa-pss` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-request-signing`
- `builds-real-order-body` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `kalshi-request-signing`
- `returns-venue-acknowledgement-or-refusal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `whatwg-fetch-standard`
- `injectable-network-call` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `whatwg-fetch-standard`, `node-esm-operation`
- `refuses-non-object-request` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `never-reads-credentials-from-environment` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `order-placement-admission-refuse-while-activation-refused`
- `no-live-placement-in-tests` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `whatwg-fetch-standard`
