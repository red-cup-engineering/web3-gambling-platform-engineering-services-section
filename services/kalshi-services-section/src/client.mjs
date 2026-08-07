// Kalshi trade-API client. Auth per Kalshi docs: RSA-PSS SHA-256 signature
// over `${timestampMs}${METHOD}${path}` with headers KALSHI-ACCESS-KEY /
// KALSHI-ACCESS-SIGNATURE / KALSHI-ACCESS-TIMESTAMP. Signing is pure and
// tested offline; the network layer activates only when the Leader records
// credentials, so onboarding is configuration rather than code.
import { createSign, constants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const activation = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/activation.json', import.meta.url)), 'utf8'),
);
const feed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/feed.json', import.meta.url)), 'utf8'),
);

export function signRequest({ privateKeyPem, timestampMs, method, path }) {
  const signer = createSign('sha256');
  signer.update(`${timestampMs}${method.toUpperCase()}${path}`);
  return signer.sign({ key: privateKeyPem, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, 'base64');
}

export function authHeaders({ apiKeyId, privateKeyPem, method, path, timestampMs = Date.now() }) {
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-SIGNATURE': signRequest({ privateKeyPem, timestampMs, method, path }),
    'KALSHI-ACCESS-TIMESTAMP': String(timestampMs),
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

function credentials() {
  const keyId = process.env.KALSHI_API_KEY_ID;
  const keyPath = process.env.KALSHI_PRIVATE_KEY_PATH;
  if (!keyId || !keyPath) return null;
  return { apiKeyId: keyId, privateKeyPem: readFileSync(keyPath, 'utf8') };
}

async function request(method, apiPath, body) {
  // Kalshi signs the path WITHOUT query parameters; passing one here would
  // produce signatures the venue rejects (or worse, silently mismatched
  // auth semantics). Refuse rather than sign wrongly.
  if (apiPath.includes('?')) {
    return { type: 'Reject', code: 'query-in-signed-path', detail: 'sign path without query parameters; pass filters another way', venueWrite: false };
  }
  const creds = credentials();
  if (!creds) return { type: 'Reject', code: 'credentials-absent', detail: 'KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH are required', venueWrite: false };
  const base = process.env.KALSHI_USE_DEMO === '1' ? feed.demo : feed.base;
  const path = new URL(base).pathname + apiPath;
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: authHeaders({ ...creds, method, path }),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) return { type: 'Reject', code: `http-${res.status}`, detail: payload?.error?.message ?? res.statusText, venueWrite: method !== 'GET' };
  return { type: 'Accept', object: payload };
}

// Reads need credentials but not live activation: the custodian may verify
// balances during onboarding while orders remain refused.
export const getBalance = () => request('GET', '/portfolio/balance');
export const getPositions = () => request('GET', '/portfolio/positions');
export const getFills = () => request('GET', '/portfolio/fills');

// A venue write additionally requires the activation policy raised to live.
export function createOrder({ ticker, action, side, count, priceCents, clientOrderId }) {
  if (activation.orderExecution !== 'live') {
    return { type: 'Reject', code: 'activation-refused', detail: `order execution is ${activation.orderExecution}`, venueWrite: false };
  }
  const body = {
    ticker,
    action, // buy | sell
    side, // yes | no
    count,
    type: 'limit',
    [side === 'yes' ? 'yes_price' : 'no_price']: priceCents,
    client_order_id: clientOrderId,
  };
  return request('POST', '/portfolio/orders', body);
}
