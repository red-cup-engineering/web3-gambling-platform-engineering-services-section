# place-polymarket-order
## Requirements
- `refuses-when-not-activated`: Given an order intent and an activation record, the operation refuses with `venue-not-activated` whenever activation.orderExecution is not "live" or activation.credentials is absent -- the normal case while the Leader has not completed Polymarket KYC and armed a signing key.
- `signs-eip712-clob-order`: When activation is live, the operation builds the Polymarket CTF Exchange's EIP-712 Order struct (salt, maker, signer, taker, tokenId, makerAmount, takerAmount, expiration, nonce, feeRateBps, side, signatureType) over the documented domain (name "Polymarket CTF Exchange", version "1"), and signs its digest with the house's own keccak256 and secp256k1 EVM primitives.
- `builds-real-clob-amounts`: When activation is live, the operation derives makerAmount and takerAmount from the intent's price and size at 10^6 (USDC/CTF) fixed-point scale, per the CLOB's documented maker/taker asset convention.
- `returns-venue-acknowledgement-or-refusal`: When activation is live, the operation returns the venue's own JSON response on success, or a Reject datum carrying the venue's HTTP status on failure; it never fabricates a fill.
- `injectable-network-call`: The operation accepts an injectable fetch implementation defaulting to the global fetch, so tests and fixtures never require a live placement.
## Prohibitions
- `refuses-non-object-request`: The operation must refuse a request that is not a JSON object.
- `never-reads-credentials-from-environment`: The operation must never read `process.env` or the filesystem for credentials; the caller supplies `activation.credentials` explicitly.
- `no-live-placement-in-tests`: This package's own tests must never perform a real network placement; the live-signing path is exercised only against an injected fixture fetch and a locally generated test key, never a real Polymarket-armed key.
- `never-reimplements-keccak-or-secp256k1`: The operation must never restate keccak256 or secp256k1 signing; it imports both from the house's published computer-data-cryptography-services-section.
## Laws
- `order-placement-admission-refuse-while-activation-refused` | Polymarket venue-access settlement, 561 Group | v1 | polymarket-services-section/content/contracts/order-placement-admission.json | Applies to every call this operation receives while activation is not live. | The order-placement-admission contract's invariants include refuse-while-activation-refused and refuse-absent-credentials, and no-credential-disclosure; this operation refuses with venue-not-activated in both cases and never echoes a credential in its refusal detail.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file that is eligible for downstream staged package-birth assays.
- `whatwg-fetch-standard` | WHATWG | Living Standard | https://fetch.spec.whatwg.org/ | Applies to the injectable network call this operation makes when activation is live. | The operation uses the Fetch API contract for its HTTP call, real by default via the global fetch and injectable for deterministic tests.
- `eip-712-typed-data` | Ethereum Magicians / EIP-712 | Final | https://eips.ethereum.org/EIPS/eip-712 | Applies to the domain separator and struct hash this operation computes before signing. | The operation computes `keccak256(0x1901 || domainSeparator || structHash)` per EIP-712, with the domain separator and struct hash each `keccak256` over their ABI-encoded type hash and fields, exactly as EIP-712 specifies for static (non-dynamic) struct fields.
- `polymarket-ctf-exchange-order` | Polymarket | ctf-exchange | https://docs.polymarket.com/developers/CLOB/orders/orders | Applies to the Order struct fields, domain, and POST /order endpoint this operation targets. | Polymarket's public CLOB documentation names the Order struct (salt, maker, signer, taker, tokenId, makerAmount, takerAmount, expiration, nonce, feeRateBps, side, signatureType), the EIP-712 domain name "Polymarket CTF Exchange" version "1", and POST /order as the signed-order submission endpoint; exact amount-scaling and field semantics must be re-verified against the live API before this path is ever armed with a real signing key, per this package's own README.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/place-polymarket-order-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/computer-data-cryptography-services-section":"0.1.1"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/place-polymarket-order.mjs
#!/usr/bin/env node
// The order-placement-admission effect, behind the Polymarket venue's
// activation gate. Refuses venue-not-activated whenever activation is not
// live or carries no credentials -- the normal case while KYC is unarmed.
// When live, builds and EIP-712-signs the real CTF Exchange Order struct and
// POSTs it via an injectable fetch, never touching process.env or the
// filesystem. Amount scaling and field semantics are to-verify against a
// real key per this package's README before activation is ever raised.
import { randomBytes } from "node:crypto";
import { keccak256 } from "@red-cup-engineering/computer-data-cryptography-services-section/src/keccak256.mjs";
import { signDigest, addressFromPrivateKey } from "@red-cup-engineering/computer-data-cryptography-services-section/src/evm.mjs";

const DEFAULT_BASE_URL = "https://clob.polymarket.com";
const DEFAULT_CHAIN_ID = 137;
const DEFAULT_VERIFYING_CONTRACT = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const USDC_CTF_SCALE = 1000000n;
const ORDER_TYPEHASH = keccak256(
  Buffer.from(
    "Order(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType)",
    "utf8",
  ),
);
const EIP712_DOMAIN_TYPEHASH = keccak256(Buffer.from("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)", "utf8"));

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`place-polymarket-order: ${label} must be a JSON object`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`place-polymarket-order: ${label} must be a non-empty string`);
  }
  return value;
}

function requireUnitInterval(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new TypeError(`place-polymarket-order: ${label} must be a finite number in (0,1)`);
  }
  return value;
}

function requirePositiveNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`place-polymarket-order: ${label} must be a positive finite number`);
  }
  return value;
}

const reject = (code, detail) => ({ type: "Reject", code, detail, venueWrite: false });

function uint256Word(value) {
  const n = typeof value === "bigint" ? value : BigInt(value);
  return Buffer.from(n.toString(16).padStart(64, "0"), "hex");
}

function addressWord(address) {
  return Buffer.from(address.replace(/^0x/, "").toLowerCase().padStart(64, "0"), "hex");
}

function uint8Word(value) {
  return uint256Word(BigInt(value));
}

function domainSeparator({ chainId, verifyingContract }) {
  return keccak256(
    Buffer.concat([
      EIP712_DOMAIN_TYPEHASH,
      keccak256(Buffer.from("Polymarket CTF Exchange", "utf8")),
      keccak256(Buffer.from("1", "utf8")),
      uint256Word(chainId),
      addressWord(verifyingContract),
    ]),
  );
}

function orderStructHash(order) {
  return keccak256(
    Buffer.concat([
      ORDER_TYPEHASH,
      uint256Word(order.salt),
      addressWord(order.maker),
      addressWord(order.signer),
      addressWord(order.taker),
      uint256Word(order.tokenId),
      uint256Word(order.makerAmount),
      uint256Word(order.takerAmount),
      uint256Word(order.expiration),
      uint256Word(order.nonce),
      uint256Word(order.feeRateBps),
      uint8Word(order.side),
      uint8Word(order.signatureType),
    ]),
  );
}

/**
 * Places one order on Polymarket's CLOB by building and EIP-712-signing the CTF Exchange Order struct, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.
 * @param {object} request A PlacePolymarketOrderRequest.
 * @param {{tokenId: string, side: ("BUY"|"SELL"), price: number, size: number}} request.intent A PolymarketOrderIntent (or the fields of one) naming the order to place.
 * @param {{orderExecution: string, credentials?: {privateKey: string, makerAddress?: string}}} request.activation The venue's activation record; orderExecution must be "live" and credentials.privateKey must be present for a real placement.
 * @param {{chainId?: number, verifyingContract?: string, feeRateBps?: number, expiration?: number, nonce?: number, taker?: string, signatureType?: number, salt?: (string|number)}} [request.clob] CTF Exchange domain and order parameters; all default to documented values, salt defaults to a random value when not supplied.
 * @param {{fetchImpl?: typeof fetch, baseUrl?: string}} [options] `fetchImpl` overrides the network call for tests; `baseUrl` overrides the production host.
 * @returns {Promise<object>} The venue's own JSON acknowledgement, or a Reject datum with code venue-not-activated or a venue-http-<status> code.
 * @throws {TypeError} When the request or its required fields are malformed.
 */
export async function placePolymarketOrder(request, options = {}) {
  requireObject(request, "request");
  const intent = requireObject(request.intent, "request.intent");
  const tokenId = requireNonEmptyString(intent.tokenId, "request.intent.tokenId");
  const side = requireNonEmptyString(intent.side, "request.intent.side");
  if (side !== "BUY" && side !== "SELL") throw new TypeError('place-polymarket-order: request.intent.side must be "BUY" or "SELL"');
  const price = requireUnitInterval(intent.price, "request.intent.price");
  const size = requirePositiveNumber(intent.size, "request.intent.size");
  const activation = requireObject(request.activation, "request.activation");

  if (activation.orderExecution !== "live" || !activation.credentials?.privateKey) {
    return reject("venue-not-activated", "Polymarket order execution requires live activation with an armed signing key; venue accounts remain the founder's hands");
  }

  const { privateKey } = activation.credentials;
  requireNonEmptyString(privateKey, "request.activation.credentials.privateKey");
  const maker = activation.credentials.makerAddress ?? addressFromPrivateKey(privateKey);

  const clob = requireObject(request.clob ?? {}, "request.clob");
  const chainId = clob.chainId ?? DEFAULT_CHAIN_ID;
  const verifyingContract = clob.verifyingContract ?? DEFAULT_VERIFYING_CONTRACT;
  const feeRateBps = clob.feeRateBps ?? 0;
  const expiration = clob.expiration ?? 0;
  const nonce = clob.nonce ?? 0;
  const taker = clob.taker ?? ZERO_ADDRESS;
  const signatureType = clob.signatureType ?? 0;
  const salt = clob.salt ?? BigInt(`0x${randomBytes(16).toString("hex")}`);
  const sideCode = side === "BUY" ? 0 : 1;

  const scaledSize = BigInt(Math.round(size * Number(USDC_CTF_SCALE)));
  const scaledNotional = BigInt(Math.round(size * price * Number(USDC_CTF_SCALE)));
  const makerAmount = side === "BUY" ? scaledNotional : scaledSize;
  const takerAmount = side === "BUY" ? scaledSize : scaledNotional;

  const order = { salt, maker, signer: maker, taker, tokenId, makerAmount, takerAmount, expiration, nonce, feeRateBps, side: sideCode, signatureType };
  const digest = keccak256(Buffer.concat([Buffer.from([0x19, 0x01]), domainSeparator({ chainId, verifyingContract }), orderStructHash(order)]));
  const signature = signDigest(digest, privateKey).signature;

  const baseUrl = typeof options.baseUrl === "string" && options.baseUrl.length > 0 ? options.baseUrl : DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = {
    order: {
      salt: salt.toString(),
      maker,
      signer: maker,
      taker,
      tokenId,
      makerAmount: makerAmount.toString(),
      takerAmount: takerAmount.toString(),
      expiration: String(expiration),
      nonce: String(nonce),
      feeRateBps: String(feeRateBps),
      side,
      signatureType,
      signature,
    },
    owner: maker,
    orderType: "GTC",
  };
  const response = await fetchImpl(`${baseUrl}/order`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return reject(`venue-http-${response.status}`, payload?.error ?? "Polymarket order placement failed");
  return payload;
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "placePolymarketOrder — Places one order on Polymarket's CLOB by building and EIP-712-signing the CTF Exchange Order struct, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(await placePolymarketOrder(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/place-polymarket-order.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { placePolymarketOrder } from "../scripts/place-polymarket-order.mjs";

const INTENT = { tokenId: "32338220190071351435772801779725302244575775216413325951443816017994629993401", side: "BUY", price: 0.048, size: 10 };
// A locally generated random scalar for tests only, never a real Polymarket-armed key.
const TEST_PRIVATE_KEY_HEX = "0x" + randomBytes(32).toString("hex");

test("refuses venue-not-activated when orderExecution is refused (today's real state)", async () => {
  const result = await placePolymarketOrder({ intent: INTENT, activation: { orderExecution: "refused" } });
  assert.equal(result.type, "Reject");
  assert.equal(result.code, "venue-not-activated");
  assert.equal(result.venueWrite, false);
});

test("refuses venue-not-activated when live but no signing key is present", async () => {
  const result = await placePolymarketOrder({ intent: INTENT, activation: { orderExecution: "live" } });
  assert.equal(result.code, "venue-not-activated");
});

test("signs and posts an EIP-712 CLOB order over a fixture fetch when activated", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ success: true, orderID: "0xabc" }) };
  };
  const result = await placePolymarketOrder(
    { intent: INTENT, activation: { orderExecution: "live", credentials: { privateKey: TEST_PRIVATE_KEY_HEX } }, clob: { salt: "1" } },
    { fetchImpl },
  );
  assert.deepEqual(result, { success: true, orderID: "0xabc" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://clob.polymarket.com/order");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.order.tokenId, INTENT.tokenId);
  assert.equal(body.order.side, "BUY");
  assert.equal(body.order.makerAmount, "480000");
  assert.equal(body.order.takerAmount, "10000000");
  assert.ok(typeof body.order.signature === "string" && body.order.signature.startsWith("0x"));
  assert.ok(typeof body.order.maker === "string" && body.order.maker.startsWith("0x"));
});

test("the same order fields always produce the same digest, deterministically", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(init); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  await placePolymarketOrder({ intent: INTENT, activation: { orderExecution: "live", credentials: { privateKey: TEST_PRIVATE_KEY_HEX } }, clob: { salt: "1" } }, { fetchImpl });
  await placePolymarketOrder({ intent: INTENT, activation: { orderExecution: "live", credentials: { privateKey: TEST_PRIVATE_KEY_HEX } }, clob: { salt: "1" } }, { fetchImpl });
  const first = JSON.parse(calls[0].body).order.signature;
  const second = JSON.parse(calls[1].body).order.signature;
  assert.equal(first, second);
});

test("reports a venue-http refusal on an HTTP failure", async () => {
  const result = await placePolymarketOrder(
    { intent: INTENT, activation: { orderExecution: "live", credentials: { privateKey: TEST_PRIVATE_KEY_HEX } }, clob: { salt: "1" } },
    { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid signature" }) }) },
  );
  assert.equal(result.code, "venue-http-400");
  assert.equal(result.venueWrite, false);
});

test("refuses a non-object request", async () => {
  await assert.rejects(placePolymarketOrder(null), /request must be a JSON object/u);
});

test("refuses an invalid side", async () => {
  await assert.rejects(
    placePolymarketOrder({ intent: { ...INTENT, side: "HOLD" }, activation: { orderExecution: "refused" } }),
    /side must be "BUY" or "SELL"/u,
  );
});
```
## Examples
```json name="refuses venue-not-activated when activation is refused"
{"input":{"intent":{"tokenId":"32338220190071351435772801779725302244575775216413325951443816017994629993401","side":"BUY","price":0.048,"size":10},"activation":{"orderExecution":"refused"}},"output":{"type":"Reject","code":"venue-not-activated","detail":"Polymarket order execution requires live activation with an armed signing key; venue accounts remain the founder's hands","venueWrite":false}}
```
## Traceability
- `refuses-when-not-activated` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `order-placement-admission-refuse-while-activation-refused`
- `signs-eip712-clob-order` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `eip-712-typed-data`, `polymarket-ctf-exchange-order`
- `builds-real-clob-amounts` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `polymarket-ctf-exchange-order`
- `returns-venue-acknowledgement-or-refusal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `whatwg-fetch-standard`
- `injectable-network-call` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `whatwg-fetch-standard`, `node-esm-operation`
- `refuses-non-object-request` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `never-reads-credentials-from-environment` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `order-placement-admission-refuse-while-activation-refused`
- `no-live-placement-in-tests` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `whatwg-fetch-standard`
- `never-reimplements-keccak-or-secp256k1` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `eip-712-typed-data`
