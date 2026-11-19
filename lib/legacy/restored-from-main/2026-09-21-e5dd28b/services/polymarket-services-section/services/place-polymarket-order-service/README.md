# @red-cup-engineering/place-polymarket-order-service

Places one order on Polymarket's CLOB by building and EIP-712-signing the CTF Exchange Order struct, behind the venue's activation gate -- or refuses with venue-not-activated when no live, credentialed activation exists.

## Operation

~~~js
export async function placePolymarketOrder(request, options = {})
~~~

### Parameters

- request (@param {{tokenId: string, side: ("BUY"|"SELL"), price: number, size: number}} request.intent A PolymarketOrderIntent (or the fields of one) naming the order to place.
 * @param {{orderExecution: string, credentials?: {privateKey: string, makerAddress?: string}}} request.activation The venue's activation record; orderExecution must be "live" and credentials.privateKey must be present for a real placement.
 * @param {{chainId?: number, verifyingContract?: string, feeRateBps?: number, expiration?: number, nonce?: number, taker?: string, signatureType?: number, salt?: (string|number)}} [request.clob] CTF Exchange domain and order parameters; all default to documented values, salt defaults to a random value when not supplied.
 * ): A PlacePolymarketOrderRequest.
- options ({fetchImpl?: typeof fetch, baseUrl?: string}): `fetchImpl` overrides the network call for tests; `baseUrl` overrides the production host.

### Returns

Promise<object>: The venue's own JSON acknowledgement, or a Reject datum with code venue-not-activated or a venue-http-<status> code.

### Refusals

- TypeError: When the request or its required fields are malformed.

## Command

place-polymarket-order reads one JSON value per input line and writes one JSON value per output line.

## Examples

### refuses venue-not-activated when activation is refused

Input:

~~~json
{
  "intent": {
    "tokenId": "32338220190071351435772801779725302244575775216413325951443816017994629993401",
    "side": "BUY",
    "price": 0.048,
    "size": 10
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
  "detail": "Polymarket order execution requires live activation with an armed signing key; venue accounts remain the founder's hands",
  "venueWrite": false
}
~~~
