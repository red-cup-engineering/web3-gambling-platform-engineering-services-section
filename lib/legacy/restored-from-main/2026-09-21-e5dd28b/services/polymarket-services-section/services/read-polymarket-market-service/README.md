# @red-cup-engineering/read-polymarket-market-service

Reads Polymarket's public CLOB GET /book and GET /price (buy and sell side) endpoints (no credentials required for market data) for one declared token id, and returns one normalized PolymarketMarketRead record with the book, best buy/sell prices, and fetch-time/source witnesses.

## Operation

~~~js
export async function readPolymarketMarket(request, options = {})
~~~

### Parameters

- request (@param {string} request.tokenId The Polymarket CLOB token id to read (a decimal ERC-1155 position id string).
 * @param {string} request.observedAt ISO 8601 timestamp this read is requested for.
 * @param {string} [request.baseUrl] Polymarket CLOB base URL (default https://clob.polymarket.com).
 * ): A PolymarketMarketReadRequest.
- options ({fetchImpl?: typeof fetch}): `fetchImpl` overrides the network call for tests and fixtures; defaults to the global fetch.

### Returns

Promise<object>: A PolymarketMarketRead record with the book, best buy/sell prices, and fetch-time/source witnesses.

### Refusals

- TypeError: When request.tokenId or request.observedAt are malformed.
- Error: When a Polymarket request does not respond with an HTTP success status.

## Command

read-polymarket-market reads one JSON value per input line and writes one JSON value per output line.

## Examples

### reads a book and buy/sell price for a token id

Input:

~~~json
{"tokenId": "32338220190071351435772801779725302244575775216413325951443816017994629993401", "observedAt": "2026-09-05T12:00:00.000Z"}
~~~

Output shape (fetchedAt and book contents vary with the live call):

~~~json
{"type": "PolymarketMarketRead", "version": 1, "tokenId": "323382...", "market": "0xa467b14d...", "bids": [{"price": 0.047, "size": 1115.6}], "asks": [{"price": 0.048, "size": 500}], "bestBid": 0.047, "bestAsk": 0.048, "price": {"buy": 0.047, "sell": 0.048}, "bookHash": "71dda042...", "bookTimestamp": "1788590367213", "observedAt": "2026-09-05T12:00:00.000Z", "fetchedAt": "2026-09-05T06:39:45.000Z", "source": ["https://clob.polymarket.com/book?token_id=...", "https://clob.polymarket.com/price?token_id=...&side=buy", "https://clob.polymarket.com/price?token_id=...&side=sell"]}
~~~

## Provenance

Hand-authored, not fabricated through `fabricate_jsnode_operation_package`, for
the same reason as its Kalshi sibling `read-kalshi-market-service`: the
fabrication line's face-equivalence assay re-runs a declared Example against
the real operation with no injectable `options`, so any operation witnessing
a live read or the wall clock can never deep-equal a fixed declared output.
Friction filed 2026-09-05
(`task:friction-missing-capability-lib-emsenn-services-561-group-services-561-group-services-se-3a62bcbd`).
The book/price response shapes were verified live 2026-09-05 against
`https://clob.polymarket.com` for the "Xi Jinping out before 2027?" market's
Yes token.
