import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signRequest, verifySignature, placeOrder } from '../src/client.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });

test('ed25519 signature round-trips over the canonical string', () => {
  const req = { timestampMs: 1752900000000, method: 'post', path: '/v1/orders', body: '{"x":1}' };
  const sig = signRequest({ privateKeyPem: priv, ...req });
  assert.ok(verifySignature({ publicKeyPem: pub, signature: sig, ...req }));
  assert.ok(!verifySignature({ publicKeyPem: pub, signature: sig, ...req, body: '{"x":2}' }));
});

test('orders refuse while activation is not live', () => {
  const r = placeOrder();
  assert.equal(r.type, 'Reject');
  assert.equal(r.code, 'activation-refused');
  assert.equal(r.venueWrite, false);
});
