# @red-cup-engineering/read-kalshi-market-service

Reads Kalshi's public trade-api v2 GET /markets/{ticker} and GET /markets/{ticker}/orderbook endpoints (no credentials required for market data) for one declared market ticker, and returns one normalized KalshiMarketRead record with the market's current price fields, its orderbook, and fetch-time/source witnesses.

## Operation

~~~js
export async function readKalshiMarket(request, options = {})
~~~

### Parameters

- request (@param {string} request.ticker The Kalshi market ticker to read (e.g. "KXHIGHNY-26SEP05-T79").
 * @param {string} request.observedAt ISO 8601 timestamp this read is requested for.
 * @param {string} [request.baseUrl] Kalshi trade-api v2 base URL (default the documented production host).
 * ): A KalshiMarketReadRequest.
- options ({fetchImpl?: typeof fetch}): `fetchImpl` overrides the network call for tests and fixtures; defaults to the global fetch.

### Returns

Promise<object>: A KalshiMarketRead record with the market's price fields, its orderbook, and fetch-time/source witnesses.

### Refusals

- TypeError: When request.ticker or request.observedAt are malformed.
- Error: When a Kalshi request does not respond with an HTTP success status.

## Command

read-kalshi-market reads one JSON value per input line and writes one JSON value per output line.

## Examples

### reads a market and its orderbook

Input:

~~~json
{"ticker": "KXHIGHNY-26SEP05-T79", "observedAt": "2026-09-05T12:00:00.000Z"}
~~~

Output shape (fetchedAt varies with wall-clock time of the real call):

~~~json
{"type": "KalshiMarketRead", "version": 1, "ticker": "KXHIGHNY-26SEP05-T79", "status": "active", "yesBid": 0.26, "yesAsk": 0.27, "noBid": 0.73, "noAsk": 0.74, "lastPrice": 0.26, "volume": 4569.81, "openInterest": 3346.31, "closeTime": "2026-09-06T05:00:00Z", "orderbook": {"yes": [{"priceDollars": 0.01, "quantity": 1358}], "no": [{"priceDollars": 0.01, "quantity": 831}]}, "observedAt": "2026-09-05T12:00:00.000Z", "fetchedAt": "2026-09-05T06:36:30.455Z", "source": ["https://api.elections.kalshi.com/trade-api/v2/markets/KXHIGHNY-26SEP05-T79", "https://api.elections.kalshi.com/trade-api/v2/markets/KXHIGHNY-26SEP05-T79/orderbook"]}
~~~

## Provenance

Hand-authored, not fabricated through `fabricate_jsnode_operation_package`: the
fabrication line's face-equivalence assay re-runs an Example's declared input
against the real operation with no way to inject a fixture `options` argument,
so it always hits the live network and the live wall clock. An operation whose
correct output witnesses a live read (this one) or the current instant can
never deep-equal a fixed declared Example output under that assay. Friction
filed 2026-09-05 (`task:friction-missing-capability-lib-emsenn-services-561-group-services-561-group-services-se-3a62bcbd`).
The orderbook endpoint's real shape (`orderbook_fp.yes_dollars`/`no_dollars`,
dollar-string pairs) was also verified live 2026-09-05 and differs from the
cents-integer shape assumed in older trade-api documentation examples.
