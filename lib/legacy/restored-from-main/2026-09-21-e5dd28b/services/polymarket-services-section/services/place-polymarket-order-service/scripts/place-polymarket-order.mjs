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
import { runJavascriptNodeOperation } from "../../../../../../../../../../../../../computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/src/operation.mjs";

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
  const result = await runJavascriptNodeOperation({ name: "place-polymarket-order", description: "Places one order on Polymarket's CLOB by building and EIP-712-signing the CTF Exchange Order struct, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.", operation: placePolymarketOrder }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
