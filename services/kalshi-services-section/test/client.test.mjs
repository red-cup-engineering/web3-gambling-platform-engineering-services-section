import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify, constants } from 'node:crypto';
import { signRequest, authHeaders, createOrder, getBalance } from '../src/client.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

test('signature verifies as RSA-PSS over timestamp+METHOD+path', () => {
  const ts = 1752900000000;
  const sig = signRequest({ privateKeyPem: pem, timestampMs: ts, method: 'post', path: '/trade-api/v2/portfolio/orders' });
  const verifier = createVerify('sha256');
  verifier.update(`${ts}POST/trade-api/v2/portfolio/orders`);
  assert.ok(verifier.verify({ key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, Buffer.from(sig, 'base64')));
});

test('auth headers carry key id, signature, and timestamp', () => {
  const h = authHeaders({ apiKeyId: 'kid', privateKeyPem: pem, method: 'GET', path: '/trade-api/v2/portfolio/balance', timestampMs: 5 });
  assert.equal(h['KALSHI-ACCESS-KEY'], 'kid');
  assert.equal(h['KALSHI-ACCESS-TIMESTAMP'], '5');
  assert.ok(h['KALSHI-ACCESS-SIGNATURE'].length > 40);
});

test('orders refuse while activation is not live, before any network use', () => {
  const r = createOrder({ ticker: 'KXTEST', action: 'buy', side: 'no', count: 1, priceCents: 50 });
  assert.equal(r.type, 'Reject');
  assert.equal(r.code, 'activation-refused');
  assert.equal(r.venueWrite, false);
});

test('reads refuse without credentials, before any network use', async () => {
  delete process.env.KALSHI_API_KEY_ID;
  const r = await getBalance();
  assert.equal(r.code, 'credentials-absent');
});
