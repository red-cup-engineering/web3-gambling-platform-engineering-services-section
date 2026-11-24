# @red-cup-engineering/form-kalshi-order-intent-service

Forms a bounded Kalshi order intent from a forecast, a reference-class calibration record, a current market read, a risk sleeve, and a fee schedule -- or refuses with a named datum when any gating condition fails.

## Operation

~~~js
export function formKalshiOrderIntent(request)
~~~

### Parameters

- request (@param {{questionId: string, probability: number}} request.forecast The org's own forecast for the market's question.
 * @param {null|{referenceClass: string, resolvedForecastCount: number, brierScore: number, marketImpliedBrierScore: number}} request.calibrationRecord The org's calibration on this forecast's reference class; null when none exists yet.
 * @param {{ticker: string, yesBid: number, yesAsk: number, noBid: number, noAsk: number}} request.marketRead A KalshiMarketRead (or the fields of one).
 * @param {{remainingUsd: number, maxFractionOfSleeve?: number}} request.sleeve The bounded risk sleeve; maxFractionOfSleeve defaults to 1 (full Kelly).
 * @param {{feeRate?: number, source?: string}} [request.feeSchedule] Kalshi's per-contract fee rate (default 0.07) and its published source.
 * @param {string} request.formedAt ISO 8601 timestamp this intent is formed at, supplied by the caller.
 * ): A FormKalshiOrderIntentRequest.

### Returns

object: A KalshiOrderIntent, or a Reject datum with code one of no-calibration-record, calibration-insufficient, no-edge-after-fees, sleeve-exhausted.

### Refusals

- TypeError: When the request or its required fields are malformed.

## Command

form-kalshi-order-intent reads one JSON value per input line and writes one JSON value per output line.

## Examples

### refuses no-calibration-record deterministically

Input:

~~~json
{
  "forecast": {
    "questionId": "kxhighny-26sep05-t79",
    "probability": 0.6
  },
  "calibrationRecord": null,
  "marketRead": {
    "ticker": "KXHIGHNY-26SEP05-T79",
    "yesBid": 0.26,
    "yesAsk": 0.27,
    "noBid": 0.73,
    "noAsk": 0.74
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
