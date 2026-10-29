/**
 * Kalshi as an operation family, so the venue's offices act through MetroPlat: read a market, form an
 * order intent from the org's own calibrated forecast, and place an order through the shared
 * activation gate (open once the venue credentials are in the host's custody; credentials
 * come from that custody, never from the caller).
 */
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { readKalshiMarket } from "../scripts/read-kalshi-market.mjs";
import { formKalshiOrderIntent } from "../scripts/form-kalshi-order-intent.mjs";

import { join } from "node:path";
import { runObserveAndForecast, runScoreClosedMarkets } from "@red-cup-engineering/forecasting/forecast-weather-markets-cli";

const WEATHER_CONFIG = new URL("../services/forecasting-service/content/config/weather-markets.json", import.meta.url).pathname;
// The forecasting journal: its host's own root when one is configured, else beside MetroPlat's.
const forecastRoot = (binding) => process.env.FORECASTING_DAILY_CYCLE_DATA_ROOT ?? join(binding?.dataRoot ?? process.cwd(), "data", "state", "forecasting");

export function kalshiOperations(binding) {
  return Object.freeze([
    operation({
      verb: "kalshi-weather-forecast",
      summary: "Observe the configured Kalshi weather markets and record the house forecast beside each market's implied probability.",
      reads: ["kalshi/public-market-data", "nws/forecasts"],
      writes: ["forecasting/forecasts"],
      run: () => runObserveAndForecast({ configPath: WEATHER_CONFIG, dataRoot: forecastRoot(binding) }),
    }),
    operation({
      verb: "kalshi-weather-score",
      summary: "Score the house's weather forecasts against Kalshi's settled results, once per forecast, into the calibration record.",
      reads: ["kalshi/public-market-data", "forecasting/forecasts"],
      writes: ["forecasting/calibration"],
      run: () => runScoreClosedMarkets({ configPath: WEATHER_CONFIG, dataRoot: forecastRoot(binding) }),
    }),
    operation({
      verb: "kalshi-market-read",
      summary: "Read one Kalshi market's prices and order book with fetch-time witnesses.",
      description: "Domain: the KalshiMarketReadRequest (the market, observedAt, optional baseUrl). Codomain: the KalshiMarketRead record.",
      reads: ["kalshi/public-market-data"],
      run: (input) => readKalshiMarket(input),
    }),
    operation({
      verb: "kalshi-order-intent",
      summary: "Form a bounded Kalshi order intent from the org's calibrated forecast, or refuse.",
      description: "Domain: { forecast, calibrationRecord, marketRead, sleeve, feeSchedule?, formedAt }. Codomain: the KalshiOrderIntent, or a Reject (no-calibration-record, calibration-insufficient, no-edge-after-fees, sleeve-exhausted).",
      run: (input) => formKalshiOrderIntent(input),
    }),
    operation({
      verb: "kalshi-order-place",
      summary: "Place one admitted Kalshi order through the venue's activation gate.",
      description: "Domain: { intent, clientOrderId? }. Codomain: the venue's own acknowledgement, or a Reject (activation-refused, credentials-absent, venue-not-activated, venue-http-<status>). Credentials are read from the environment the venue's activation record names.",
      writes: ["kalshi/orders"],
      run: async (input) => (await import("./orders.mjs")).placeOrder(input),
    }),
  ]);
}
