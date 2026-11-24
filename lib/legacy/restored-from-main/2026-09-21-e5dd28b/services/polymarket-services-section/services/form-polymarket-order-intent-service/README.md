# @red-cup-engineering/form-polymarket-order-intent-service

Forms a bounded Polymarket CLOB order intent from a forecast, a reference-class calibration record, a current market read, a risk sleeve, and a fee schedule -- or refuses with a named datum when any gating condition fails.

## Operation

~~~js
export function formPolymarketOrderIntent(request)
~~~

### Parameters

- request (@param {{questionId: string, probability: number}} request.forecast The org's own forecast for the market's question.
 * @param {null|{referenceClass: string, resolvedForecastCount: number, brierScore: number, marketImpliedBrierScore: number}} request.calibrationRecord The org's calibration on this forecast's reference class; null when none exists yet.
 * @param {{tokenId: string, bestBid: number, bestAsk: number}} request.marketRead A PolymarketMarketRead (or the fields of one).
 * @param {{remainingUsd: number, maxFractionOfSleeve?: number}} request.sleeve The bounded risk sleeve; maxFractionOfSleeve defaults to 1 (full Kelly).
 * @param {{feeRateBps?: number, source?: string, minOrderSize?: number}} [request.feeSchedule] Polymarket's fee rate in basis points (default 0), its published source, and the venue's minimum order size (default 5 shares).
 * @param {string} request.formedAt ISO 8601 timestamp this intent is formed at, supplied by the caller.
 * ): A FormPolymarketOrderIntentRequest.

### Returns

object: A PolymarketOrderIntent, or a Reject datum with code one of no-calibration-record, calibration-insufficient, no-edge-after-fees, sleeve-exhausted.

### Refusals

- TypeError: When the request or its required fields are malformed.

## Command

form-polymarket-order-intent reads one JSON value per input line and writes one JSON value per output line.

## Examples

### refuses no-calibration-record deterministically

Input:

~~~json
{
  "forecast": {
    "questionId": "xi-jinping-out-before-2027",
    "probability": 0.15
  },
  "calibrationRecord": null,
  "marketRead": {
    "tokenId": "32338220190071351435772801779725302244575775216413325951443816017994629993401",
    "bestBid": 0.047,
    "bestAsk": 0.048
  },
  "sleeve": {
    "remainingUsd": 100
  },
  "formedAt": "2026-09-05T12:00:00.000Z"
}
~~~

Output:

~~~json
{
  "type": "Reject",
  "code": "no-calibration-record",
  "detail": "no calibration record supplied for this reference class",
  "venueWrite": false
}
~~~
