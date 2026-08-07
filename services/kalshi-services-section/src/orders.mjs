import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const activation = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/activation.json', import.meta.url)), 'utf8'),
);

// The whole order-placement-admission gate, evaluated venue-locally. Until
// the Leader completes KYC, records credentials, and raises activation, every
// request settles as a refusal — and that refusal is the settlement working.
export function placeOrder(request) {
  if (activation.orderExecution !== 'live') {
    return refusal('activation-refused', `order execution is ${activation.orderExecution}; Leader inputs still required: ${activation.leaderInputsStillRequired.join('; ')}`);
  }
  const missing = activation.requiredEnvironment.filter((name) => !process.env[name]);
  if (missing.length > 0) return refusal('credentials-absent', `missing environment: ${missing.join(', ')}`);
  if (!request?.pair?.qualified) return refusal('pair-not-qualified', 'order requests must cite a Leader-confirmed qualified pair');
  return refusal('venue-client-unimplemented', 'live order placement is not yet implemented; no venue write occurred');
}

const refusal = (code, detail) => ({ type: 'Reject', code, detail, venueWrite: false });
