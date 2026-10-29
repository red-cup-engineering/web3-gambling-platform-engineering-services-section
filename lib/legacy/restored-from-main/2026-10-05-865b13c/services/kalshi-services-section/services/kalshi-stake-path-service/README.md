# Kalshi Stake Path Service

The Kalshi section's own stake path (three-ways note, instrument 2; the climate
event-contract desk's ordering step): the desk's forecasting loop
(`@red-cup-engineering/forecasting`'s `forecast-weather-markets-cli.mjs`)
already records house-vs-market forecasts and scores calibration -- this
package is what turns an earned calibration record into a stake, behind a
deterministic authority envelope held outside the model, and never a second
Kalshi execution path.

## The loop

`derive-stake-intent` -> `check-stake-mandate` -> `place-stake-order` ->
`reconcile-stake-fill`, with `halt-stake-envelope` as the automatic circuit
breaker (meet-then-beat's consequential-surface loop: mandate -> data as-of ->
strategy version -> risk-sized intent -> authorization -> venue instruction ->
acknowledgement -> reconciliation -> pause/revoke).

1. **`derive-stake-intent`** reads the forecasting journal's house forecast,
   market-implied-probability row, and calibration readout for one market's
   reference class, and admits a stake only when the three-ways note's three
   records agree: (1) a house forecast recorded before the stake, (2) a
   calibration on the reference class over at least thirty resolved forecasts
   whose house Brier score beats the market's, and (3) a positive Kelly
   fraction from `@red-cup-engineering/position-sizing-service`'s
   `sizePosition`, capped at a fixed fraction of the sleeve
   (`DEFAULT_MAX_SLEEVE_FRACTION`, 0.05). Missing any of the three refuses
   with a datum naming which one; the Kelly-zero refusal is the normal case.
2. **`check-stake-mandate`** checks an admitted intent against the authority
   envelope: series admission, per-order cap, cumulative cap (summed over
   every stake admitted since the envelope's `armedAt`), expiry, and `armed`.
3. **`place-stake-order`** builds the Kalshi order (ticker/action/side/
   count/type/priceCents/clientOrderId -- exactly the body
   `@red-cup-engineering/kalshi-services-section`'s own `src/client.mjs`
   `createOrder` already sends). With `paper: true` (the default), an
   unarmed envelope, or absent `KALSHI_API_KEY_ID`/`KALSHI_PRIVATE_KEY_PATH`,
   it records the instruction and never calls the venue. Only armed,
   credentialed, and not paper does it call that existing client and record
   the acknowledgement.
4. **`reconcile-stake-fill`** books a venue instruction against its
   settlement result (the caller supplies Kalshi's own reported result) as a
   matched pair, and rolls the realized P&L into the reference class's
   cumulative total.
5. **`halt-stake-envelope`** is the automatic circuit breaker (growth-policy
   note, 2026-09-01: "never a request for human permission"): unarms and
   persists the envelope when its expiry has passed or cumulative realized
   losses (since arming, across every admitted series) exceed the sleeve's
   `drawdownFloorFraction` of its `riskCapital`. Runnable by a timer.

`apps/kalshi-stake-cli.mjs` composes all five as `intent`, `check`, `place`,
`reconcile`, `halt`, and a read-only `status`.

## The authority envelope

`data/records/schema/authority-envelope.schema.json`; a worked template at
`content/config/authority-envelope.example.json`. It is the deterministic
bound held OUTSIDE the model: venue (`"kalshi"`), admitted series,
`perOrderCapUsd`, `cumulativeCapUsd`, a `drawdownFloorFraction` over the
sleeve, `expiry`, `killPath` (names `halt-stake-envelope.mjs`), `signer.host`
(the machine holding the Kalshi credential), `principal.actorId` (the founder
named by actor id -- `"emsenn"` -- never by credential), and `armed`, false by
default and after every halt. The live envelope is mutable state
(`data/state/authority-envelope.json`, mode 0600), loaded/saved by
`src/authority-envelope.mjs`'s `loadEnvelope`/`saveEnvelope` -- the same
shape `alpaca-account-kill-switch-service`'s high-water-mark file uses.

## Never a second Kalshi execution path

`@red-cup-engineering/kalshi-services-section`'s `src/client.mjs` `createOrder`
is the section's one existing order-placement call (RSA-PSS-signed, gated by
its own `content/config/activation.json`). This package's
`place-stake-order.mjs` calls that function directly; it does not
reimplement signing, does not add a second HTTP client, and does not touch
`src/orders.mjs`'s separate qualified-pair gate (a different arbitrage shape,
not this desk's binary-market stakes). The Alpaca section's
`pluggable-venue-adapter-service` / `brokerage-execution-transport-service`
algebra (`PrincipalBrokerageServiceContract` / `RevocableBrokerageAuthorityGrant`
/ `AggressiveBrokerageOrderIntent`, notional/symbol equities orders) was
read and found to be intrinsically Alpaca-shaped -- hardcoded
`"alpaca-trading-paper"`/`"alpaca-trading-live"` venue strings and an order
body built for equities notional, not a binary-market ticker/side/count/price
contract -- and adapting it to Kalshi would mean a breaking rewrite of
another section's sovereign package outside this lot's custody. This
package instead builds its own authority-envelope/intent/instruction records
in the same conceptual loop and calls the venue through Kalshi's own
existing client, which the brief itself names as the lawful shape ("a Kalshi
venue adapter over the existing venue algebra ... or ... where a venue
adapter lives, there, saying why").

## What is a declared parameter, not a verified external fact

- **`feeRate`** (`content/config/stake-path-config.json`, default `0.01`) is
  a configured approximation of Kalshi's trading fee, not its published fee
  schedule -- no external fetch of Kalshi's fee documentation was performed
  in this lot. Revise it when the desk cites the venue's actual schedule.
- **`marketPrice`** in a derived intent is the forecasting journal's own
  recorded market-implied-probability row (never a fresh fetch at
  intent-derivation time, so an intent never uses information later than the
  forecast it is gated on), used as a dollars-per-contract proxy for the
  yes-side price.

## Hands

A Kalshi account is the founder's own KYC (`kalshi-services-section`'s
`content/config/activation.json` / `content/policies/venue-authority-policy.json`
already state this). The founder's one arming act is: set
`armed: true` in `data/state/authority-envelope.json` and place
`KALSHI_API_KEY_ID`/`KALSHI_PRIVATE_KEY_PATH` on the signer host named in
the envelope. After that the loop runs `place-stake-order` without `--live`
still forced to paper by the caller; the caller must pass `paper: false` (or
`--live` on the CLI) for a live order to be attempted at all -- two
independent switches (armed envelope AND an explicit non-paper call) must
both be true before any venue write occurs. Until then the desk's product is
the record.

## The weather desk (live since 2026-10-03)

`apps/kalshi-weather-desk.mjs` is the stake path running for real on the founder's Kalshi
account, under `content/config/weather-desk-policy.json`. It trades one strategy,
`src/tail-premium-policy.mjs`: sell YES (hold NO) on daily-temperature brackets the market
asks at 6c or less AND the house's fat-tailed NBM model (forecasting-service
`src/temperature-market-model.mjs`) puts at 1% or less (0.5% for lows), resting post-only
orders at or just inside the best competing ask. The evidence and its limits are in
forecasting-service `data/records/2026-10-03-kalshi-temperature-tail-backtest/`: the NBM
model loses to the market near the money and adds nothing pooled with it, so it is used only
to certify far tails, which the market overprices.

Sizing follows the growth policy (economics note 2026-09-01): the Kalshi balance is
walled-off, re-seedable risk capital, and a contract cannot owe beyond its cost, so each
certified tail gets its full-Kelly stake (`position-sizing-service` `kellyFraction`) on a
conservative loss rate (1% high, 1.2% low: the backtest's 95% upper bounds), with one
settlement date's bets scaled together into 75% of the lane's capital and 50% per event.
Lanes are fractions of the account's equity; the weather lane holds all of it until another
Kalshi lane measures an edge the same way.

- `cycle [--live]` every ten minutes (`content/systemd/kalshi-weather-desk.timer`, symlinked
  into `~/.config/systemd/user`): reads Kalshi's own balance, positions and resting orders
  first; halts if equity is under $5 or three certified tails settled yes in 30 days (the
  edge's falsifier); then prices every open bracket for today and tomorrow at its station.
  Orders expire after 40 minutes and are re-rested before they lapse, so a stopped timer
  leaves nothing resting.
- `status`, `arm <by>`, `halt [reason]`. Arming is the founder's act. State and the
  append-only ledger are machine state (`~/.local/state/561-group/settlements/
  kalshi-services-section/weather-desk`), never the repository.
- The key: kalshi-services-section `provision-kalshi-api-key` (an Ed25519 pair made on the
  node; the founder registers only the public half).

Kalshi's `balance` does not set aside a resting order's collateral, so equity is cash plus
positions, and only cash beyond resting collateral is spent.

## Tests

`node --test test/*.test.mjs`: the three-record rule refusing on 0/30 and
admitting on a fixture with 31 resolved rows and a positive edge; the
mandate refusing an unarmed envelope, an inadmissible series, an expired
envelope, an over-per-order-cap and over-cumulative-cap intent; `place` in
paper/unarmed/no-credential modes all recording the instruction without a
venue call; the breaker halting on an expiry fixture and a drawdown fixture
and persisting `armed: false`; reconciliation booking a winning fill, a
losing fill, and an unresolved-then-resolved supersession.
