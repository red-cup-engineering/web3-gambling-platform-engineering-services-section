import test from 'node:test';
import assert from 'node:assert/strict';
import { placeOrder } from '../src/orders.mjs';
import { feed } from '../src/feed.mjs';

test('every order is refused while activation is awaiting the Leader', async () => {
  const r = await placeOrder({ pair: { qualified: true }, side: 'yes', contracts: 1 });
  assert.equal(r.type, 'Reject');
  assert.equal(r.code, 'activation-refused');
  assert.equal(r.venueWrite, false);
});

test('the declared feed names a base endpoint', () => {
  assert.ok(typeof feed.base === 'string' && feed.base.startsWith('https://'));
});
