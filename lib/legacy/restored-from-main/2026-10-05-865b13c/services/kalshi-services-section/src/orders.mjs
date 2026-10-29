import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPlaceOrder } from '@red-cup-engineering/web3-gambling-platform-services-section/orders';
import { placeKalshiOrder } from '../scripts/place-kalshi-order.mjs';

export const activation = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/activation.json', import.meta.url)), 'utf8'),
);

// The order-placement-admission gate is shared across this section's venues (see
// web3-gambling-platform-services-section/scripts/orders.mjs); this file supplies Kalshi's
// activation, its trade-api placer, and where its credentials are kept.
export const placeOrder = createPlaceOrder(activation, {
  place: placeKalshiOrder,
  credentials: (env) => ({ apiKeyId: env.KALSHI_API_KEY_ID, privateKeyPem: readFileSync(env.KALSHI_PRIVATE_KEY_PATH, 'utf8') }),
});
