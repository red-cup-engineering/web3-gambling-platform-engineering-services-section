import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPlaceOrder } from '@red-cup-engineering/web3-gambling-platform-services-section/orders';
import { placePolymarketOrder } from '../scripts/place-polymarket-order.mjs';

export const activation = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/activation.json', import.meta.url)), 'utf8'),
);

// The order-placement-admission gate is shared across this section's venues (see
// web3-gambling-platform-services-section/scripts/orders.mjs); this file supplies Polymarket's
// activation, its CLOB placer, and where its signing key is kept.
export const placeOrder = createPlaceOrder(activation, {
  place: placePolymarketOrder,
  credentials: (env) => ({ privateKey: readFileSync(env.POLYMARKET_US_PRIVATE_KEY_PATH, 'utf8').trim() }),
});
