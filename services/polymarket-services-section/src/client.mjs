// Polymarket US API client. Auth is Ed25519 request signing with keys from
// the developer portal (issued only after Leader KYC). The signing core is
// pure and tested offline. Exact header names and canonical string are
// recorded in content/config/feed.json as to-verify: the public docs gate the
// precise schema behind onboarding, so first key issuance must confirm them
// before activation is raised — a config edit, not a code change.
import { sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const activation = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/activation.json', import.meta.url)), 'utf8'),
);

export const canonicalString = ({ timestampMs, method, path, body }) =>
  `${timestampMs}${method.toUpperCase()}${path}${body ?? ''}`;

export function signRequest({ privateKeyPem, timestampMs, method, path, body }) {
  const key = createPrivateKey(privateKeyPem);
  return edSign(null, Buffer.from(canonicalString({ timestampMs, method, path, body })), key).toString('base64');
}

export function verifySignature({ publicKeyPem, signature, ...canonical }) {
  const key = createPublicKey(publicKeyPem);
  return edVerify(null, Buffer.from(canonicalString(canonical)), key, Buffer.from(signature, 'base64'));
}

export function placeOrder() {
  if (activation.orderExecution !== 'live') {
    return { type: 'Reject', code: 'activation-refused', detail: `order execution is ${activation.orderExecution}`, venueWrite: false };
  }
  return { type: 'Reject', code: 'auth-schema-unconfirmed', detail: 'confirm Polymarket US auth header schema from the developer portal before first live order', venueWrite: false };
}
