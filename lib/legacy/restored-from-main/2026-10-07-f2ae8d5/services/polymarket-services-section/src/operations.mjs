/**
 * Polymarket as an operation family, so the venue's offices act through MetroPlat: read a market, form an
 * order intent from the org's own calibrated forecast, and place an order through the shared
 * activation gate (open once the venue credentials are in the host's custody; credentials
 * come from that custody, never from the caller).
 */
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { readPolymarketMarket } from "../scripts/read-polymarket-market.mjs";
import { formPolymarketOrderIntent } from "../scripts/form-polymarket-order-intent.mjs";


export function polymarketOperations() {
  return Object.freeze([
    operation({
      verb: "polymarket-market-read",
      summary: "Read one Polymarket market's prices and order book with fetch-time witnesses.",
      description: "Domain: the PolymarketMarketReadRequest (the market, observedAt, optional baseUrl). Codomain: the PolymarketMarketRead record.",
      reads: ["polymarket/public-market-data"],
      run: (input) => readPolymarketMarket(input),
    }),
    operation({
      verb: "polymarket-order-intent",
      summary: "Form a bounded Polymarket order intent from the org's calibrated forecast, or refuse.",
      description: "Domain: { forecast, calibrationRecord, marketRead, sleeve, feeSchedule?, formedAt }. Codomain: the PolymarketOrderIntent, or a Reject (no-calibration-record, calibration-insufficient, no-edge-after-fees, sleeve-exhausted).",
      run: (input) => formPolymarketOrderIntent(input),
    }),
    operation({
      verb: "polymarket-order-place",
      summary: "Place one admitted Polymarket order through the venue's activation gate.",
      description: "Domain: { intent, clientOrderId? }. Codomain: the venue's own acknowledgement, or a Reject (activation-refused, credentials-absent, venue-not-activated, venue-http-<status>). Credentials are read from the environment the venue's activation record names.",
      writes: ["polymarket/orders"],
      run: async (input) => (await import("./orders.mjs")).placeOrder(input),
    }),
  ]);
}
