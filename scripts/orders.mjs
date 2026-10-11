// orders.mjs — the order-placement-admission gate shared by every gambling venue under this
// section (kalshi-services-section, polymarket-services-section). A venue's own
// content/config/activation.json (orderExecution status, requiredEnvironment names,
// accountSetup) and its own placer and credential reader are all that vary. A venue places orders
// once its credentials are in the environment the activation names; until then a request settles
// as credentials-absent, naming the account-setup steps. Credentials come from the host's custody
// named by the activation record, never from the caller.

/**
 * Bind a venue's activation record to its real placer. `place(request, options)` is the venue's
 * API placement taking `{ ...request, activation }`; `credentials(env)` reads the venue's
 * credentials from the environment the activation names.
 */
export function createPlaceOrder(activation, { place, credentials } = {}) {
  return async function placeOrder(request, options = {}) {
    if (activation.orderExecution !== 'live') {
      return refusal('activation-refused', `order execution is ${activation.orderExecution}`);
    }
    const missing = activation.requiredEnvironment.filter((name) => !process.env[name]);
    if (missing.length > 0) return refusal('credentials-absent', `missing environment: ${missing.join(', ')}; account setup: ${(activation.accountSetup ?? []).join('; ')}`);
    if (typeof place !== 'function' || typeof credentials !== 'function') return refusal('venue-client-unbound', 'no venue placer is bound to this activation');
    return place({ ...request, activation: { orderExecution: 'live', credentials: credentials(process.env) } }, options);
  };
}

const refusal = (code, detail) => ({ type: 'Reject', code, detail, venueWrite: false });
