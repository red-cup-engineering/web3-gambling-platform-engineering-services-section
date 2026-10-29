# @red-cup-engineering/observe-set-of-kalshi-weather-markets-service

Reads Kalshi's public trade-api v2 GET /markets endpoint (no credentials required for market data) for a declared list of weather/climate series tickers, and returns one normalized KalshiWeatherMarketObservation record per open market found.

## Operation

~~~js
export async function observeSetOfKalshiWeatherMarkets(request, options = {})
~~~

### Parameters

- request (@param {string[]} request.seriesTickers Declared Kalshi series tickers to observe (e.g. "KXHIGHNY"); an empty array observes nothing.
 * @param {string} request.observedAt ISO 8601 timestamp this observation is stamped with.
 * @param {string} [request.baseUrl] Kalshi trade-api v2 base URL (default the documented production host).
 * @param {string} [request.status] The Kalshi market status filter (default "open").
 * @param {number} [request.maxPagesPerSeries] Pagination cap per series (default 5).
 * ): A KalshiWeatherMarketObservationRequest.
- options ({fetchImpl?: typeof fetch}): `fetchImpl` overrides the network call for tests and fixtures; defaults to the global fetch.

### Returns

Promise<object[]>: An array of KalshiWeatherMarketObservation records, one per open market.

### Refusals

- TypeError: When request.seriesTickers or request.observedAt are malformed.
- Error: When a Kalshi request does not respond with an HTTP success status.

## Command

observe-set-of-kalshi-weather-markets reads one JSON value per input line and writes one JSON value per output line.

## Examples

### empty series list returns no observations

Input:

~~~json
{
  "seriesTickers": [],
  "observedAt": "2026-09-04T12:00:00.000Z"
}
~~~

Output:

~~~json
[]
~~~

### empty series list with overrides still returns no observations

Input:

~~~json
{
  "seriesTickers": [],
  "observedAt": "2026-09-04T12:00:00.000Z",
  "baseUrl": "https://api.elections.kalshi.com/trade-api/v2",
  "status": "open",
  "maxPagesPerSeries": 2
}
~~~

Output:

~~~json
[]
~~~
