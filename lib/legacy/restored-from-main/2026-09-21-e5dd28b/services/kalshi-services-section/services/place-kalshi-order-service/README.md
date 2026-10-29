# @red-cup-engineering/place-kalshi-order-service

Places one order on Kalshi's trade-api v2, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.

## Operation

~~~js
export async function placeKalshiOrder(request, options = {})
~~~

### Parameters

- request (@param {{ticker: string, side: ("yes"|"no"), action?: ("buy"|"sell"), contracts: number, priceDollars: number}} request.intent A KalshiOrderIntent (or the fields of one) naming the order to place.
 * @param {{orderExecution: string, credentials?: {apiKeyId: string, privateKeyPem: string}}} request.activation The venue's activation record; orderExecution must be "live" and credentials must be present for a real placement.
 * @param {string} [request.clientOrderId] An idempotency key for the order; a caller-supplied value is used verbatim.
 * ): A PlaceKalshiOrderRequest.
- options ({fetchImpl?: typeof fetch, baseUrl?: string, timestampMs?: number}): `fetchImpl` overrides the network call for tests; `baseUrl` overrides the production host; `timestampMs` overrides the signed timestamp for tests.

### Returns

Promise<object>: The venue's own JSON acknowledgement, or a Reject datum with code venue-not-activated or a venue-http-<status> code.

### Refusals

- TypeError: When the request or its required fields are malformed.

## Command

place-kalshi-order reads one JSON value per input line and writes one JSON value per output line.

## Examples

### refuses venue-not-activated when activation is refused

Input:

~~~json
{
  "intent": {
    "ticker": "KXHIGHNY-26SEP05-T79",
    "side": "yes",
    "action": "buy",
    "contracts": 3,
    "priceDollars": 0.27
  },
  "activation": {
    "orderExecution": "refused"
  }
}
~~~

Output:

~~~json
{
  "type": "Reject",
  "code": "venue-not-activated",
  "detail": "Kalshi order execution requires live activation with armed credentials; venue accounts remain the founder's hands",
  "venueWrite": false
}
~~~
