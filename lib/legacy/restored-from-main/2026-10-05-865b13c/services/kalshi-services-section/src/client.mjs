// The one Kalshi trade-API client. Every venue read and write in this section
// goes through `createKalshiClient`: public market data unsigned, portfolio
// and order calls signed (src/signing.mjs, Ed25519 or RSA-PSS by key type)
// over the path without its query. Orders use the V2 shape
// (POST /portfolio/events/orders): one YES book, `bid` buys YES and `ask`
// sells YES (long NO at 1 - price), fixed-point dollar prices and fractional
// counts. Credentials come from the signer host's environment, or the
// house's private env file, never from a caller or a record.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signRequest, authHeaders } from './signing.mjs';
export { signRequest, authHeaders };

const activation = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/activation.json', import.meta.url)), 'utf8'),
);
const feed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/feed.json', import.meta.url)), 'utf8'),
);

/** The house's private Kalshi env file (0600), written by provisioning; KALSHI_ENV_FILE moves it. */
export const kalshiEnvFile = (env = process.env) => env.KALSHI_ENV_FILE ?? join(env.HOME ?? homedir(), '.config', '561-group', 'kalshi.env');

function readEnvFile(path) {
  try {
    return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
      .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u.exec(line)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"(.*)"$/u, '$1')]));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

/** The signer's credentials, or null: the process environment first, then the house env file. */
export function kalshiCredentials(env = process.env) {
  const file = env.KALSHI_API_KEY_ID ? {} : readEnvFile(kalshiEnvFile(env));
  const apiKeyId = env.KALSHI_API_KEY_ID ?? file.KALSHI_API_KEY_ID;
  const keyPath = env.KALSHI_PRIVATE_KEY_PATH ?? file.KALSHI_PRIVATE_KEY_PATH;
  if (!apiKeyId || !keyPath) return null;
  return { apiKeyId, privateKeyPem: readFileSync(keyPath, 'utf8') };
}

export class KalshiVenueError extends Error {
  constructor(code, detail, { status = null, venueWrite = false } = {}) {
    super(`${code}: ${detail}`);
    Object.assign(this, { code, detail, status, venueWrite });
  }
}

/** A dollar or count value as Kalshi's fixed-point string. */
export const dollars = (value) => Number(value).toFixed(4);
export const contracts = (value) => (Math.floor(Number(value) * 100 + 1e-9) / 100).toFixed(2);

/**
 * A client bound to one host and (optionally) one credential.
 * @param {{credentials?: {apiKeyId: string, privateKeyPem: string}|null, baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 */
export function createKalshiClient({ credentials = kalshiCredentials(), baseUrl = process.env.KALSHI_USE_DEMO === '1' ? feed.demo : feed.base, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const basePath = new URL(baseUrl).pathname;

  async function call(method, apiPath, { query, body, signed = true } = {}) {
    if (apiPath.includes('?')) throw new KalshiVenueError('query-in-signed-path', 'pass query parameters as `query`');
    const write = method !== 'GET';
    if (signed && !credentials) throw new KalshiVenueError('credentials-absent', 'KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH are required');
    const url = new URL(`${baseUrl}${apiPath}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const headers = signed ? authHeaders({ ...credentials, method, path: basePath + apiPath }) : { accept: 'application/json' };
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // A write whose response never came may still have reached the venue.
      throw new KalshiVenueError('network', error.message, { venueWrite: write });
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new KalshiVenueError(`http-${res.status}`, payload?.error?.message ?? payload?.message ?? res.statusText, { status: res.status, venueWrite: write && res.status >= 500 });
    return payload;
  }

  async function paged(apiPath, key, query, { signed = true, maxPages = 50 } = {}) {
    const rows = [];
    let cursor;
    for (let page = 0; page < maxPages; page += 1) {
      const payload = await call('GET', apiPath, { query: { limit: 200, ...query, cursor }, signed });
      rows.push(...(payload[key] ?? []));
      cursor = payload.cursor;
      if (!cursor) break;
    }
    return rows;
  }

  return Object.freeze({
    signed: Boolean(credentials),
    call,
    // Public market data.
    getSeries: (seriesTicker) => call('GET', `/series/${seriesTicker}`, { signed: false }).then((p) => p.series),
    getEvents: (query) => paged('/events', 'events', query, { signed: false }),
    getMarkets: (query) => paged('/markets', 'markets', query, { signed: false }),
    getMarket: (ticker) => call('GET', `/markets/${ticker}`, { signed: false }).then((p) => p.market),
    getOrderbook: (ticker, depth) => call('GET', `/markets/${ticker}/orderbook`, { query: { depth }, signed: false }).then((p) => p.orderbook_fp),
    getCandlesticks: (seriesTicker, ticker, query) => call('GET', `/series/${seriesTicker}/markets/${ticker}/candlesticks`, { query, signed: false }).then((p) => p.candlesticks ?? []),
    // Portfolio.
    getBalance: () => call('GET', '/portfolio/balance'),
    getPositions: (query) => call('GET', '/portfolio/positions', { query: { limit: 200, ...query } }),
    getOrders: (query) => paged('/portfolio/orders', 'orders', query),
    getFills: (query) => paged('/portfolio/fills', 'fills', query),
    getSettlements: (query) => paged('/portfolio/settlements', 'settlements', query),
    // Orders (V2).
    createOrder({ ticker, side, count, price, timeInForce = 'good_till_canceled', postOnly = false, expirationTime, clientOrderId, reduceOnly }) {
      if (side !== 'bid' && side !== 'ask') throw new TypeError('createOrder: side is bid (buy YES) or ask (sell YES / buy NO)');
      const body = {
        ticker, side, count: contracts(count), price: dollars(price), time_in_force: timeInForce,
        self_trade_prevention_type: 'taker_at_cross', post_only: postOnly, cancel_order_on_pause: true,
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
        ...(expirationTime ? { expiration_time: Math.floor(expirationTime) } : {}),
        ...(reduceOnly ? { reduce_only: true } : {}),
      };
      return call('POST', '/portfolio/events/orders', { body });
    },
    cancelOrder: (orderId, ticker) => call('DELETE', `/portfolio/events/orders/${orderId}`, { query: { market_ticker: ticker } }),
  });
}

let shared;
const client = () => (shared ??= createKalshiClient());
const datum = (promise, write) => promise.then((object) => ({ type: 'Accept', object }), (error) => ({ type: 'Reject', code: error.code ?? 'error', detail: error.detail ?? error.message, venueWrite: error.venueWrite ?? write }));

// Reads need credentials but not live activation: the custodian may verify
// balances during onboarding while orders remain refused.
export const getBalance = () => datum(client().getBalance(), false);
export const getPositions = () => datum(client().getPositions(), false);
export const getFills = () => datum(client().getFills(), false);

/**
 * A buy of `side` (yes|no) at `priceCents`, the shape the stake path forms,
 * placed as its V2 equivalent: buying YES at p is a bid at p; buying NO at p
 * is an ask on the YES book at 1 - p. A venue write additionally requires the
 * activation policy raised to live.
 */
export function createOrder({ ticker, action = 'buy', side, count, priceCents, clientOrderId }) {
  if (activation.orderExecution !== 'live') {
    return Promise.resolve({ type: 'Reject', code: 'activation-refused', detail: `order execution is ${activation.orderExecution}`, venueWrite: false });
  }
  const longYes = (action === 'buy') === (side === 'yes');
  const yesPrice = side === 'yes' ? priceCents / 100 : 1 - priceCents / 100;
  return datum(client().createOrder({ ticker, side: longYes ? 'bid' : 'ask', count, price: yesPrice, clientOrderId }), true);
}
