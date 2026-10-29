#!/usr/bin/env node
/**
 * The composed face over the Kalshi stake path's five scripts: `intent`
 * (derive-stake-intent), `check` (check-stake-mandate), `place`
 * (place-stake-order), `reconcile` (reconcile-stake-fill), `halt`
 * (halt-stake-envelope), and `status` (a read-only summary of the
 * envelope, its cumulative stake, and its realized P&L). Paper by default
 * everywhere; a live order requires `place --live` on an armed,
 * credentialed envelope.
 */

import { readFileSync } from "node:fs";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { resolve } from "node:path";
import { deriveStakeIntent } from "../scripts/derive-stake-intent.mjs";
import { checkStakeMandate, cumulativeStakedUsdSinceArming } from "../scripts/check-stake-mandate.mjs";
import { placeStakeOrder } from "../scripts/place-stake-order.mjs";
import { reconcileStakeFill, cumulativeRealizedPnlUsd } from "../scripts/reconcile-stake-fill.mjs";
import { haltStakeEnvelope, totalRealizedPnlUsd, DEFAULT_ENVELOPE_PATH } from "../scripts/halt-stake-envelope.mjs";
import { loadEnvelope } from "../src/authority-envelope.mjs";
import { referenceClassFromSeries } from "@red-cup-engineering/forecasting/forecast-weather-markets-cli";

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function flag(args, name, fallback = undefined) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

async function main(argv) {
  const [command, ...rest] = argv;
  const envelopePath = resolve(flag(rest, "envelope", DEFAULT_ENVELOPE_PATH));

  if (command === "intent") {
    const [marketTicker, seriesTicker] = rest;
    const forecastingDataRoot = flag(rest, "forecasting-root");
    if (!marketTicker || !seriesTicker || !forecastingDataRoot) {
      throw new Error("usage: kalshi-stake-cli.mjs intent <marketTicker> <seriesTicker> --forecasting-root <path> [--config <path>] [--sleeve <path>]");
    }
    const config = flag(rest, "config") ? readJson(flag(rest, "config")) : {};
    const sleeve = flag(rest, "sleeve") ? readJson(flag(rest, "sleeve")) : loadEnvelope(envelopePath).sleeve;
    return deriveStakeIntent({ marketTicker, seriesTicker, sleeve, forecastingDataRoot, config });
  }

  if (command === "check") {
    const [intentPath, seriesTicker] = rest;
    if (!intentPath || !seriesTicker) throw new Error("usage: kalshi-stake-cli.mjs check <intent.json> <seriesTicker> [--envelope <path>]");
    const envelope = loadEnvelope(envelopePath);
    return checkStakeMandate({ intent: readJson(intentPath), seriesTicker, envelope });
  }

  if (command === "place") {
    const [intentPath, mandateCheckPath] = rest;
    if (!intentPath || !mandateCheckPath) throw new Error("usage: kalshi-stake-cli.mjs place <intent.json> <mandateCheck.json> [--envelope <path>] [--live]");
    const envelope = loadEnvelope(envelopePath);
    const paper = !rest.includes("--live");
    return placeStakeOrder({ intent: readJson(intentPath), mandateCheck: readJson(mandateCheckPath), envelope, paper });
  }

  if (command === "reconcile") {
    const [venueInstructionPath, referenceClass, settlementResult] = rest;
    if (!venueInstructionPath || !referenceClass || !settlementResult) {
      throw new Error('usage: kalshi-stake-cli.mjs reconcile <venueInstruction.json> <referenceClass> <yes|no|unresolved>');
    }
    return reconcileStakeFill({ venueInstruction: readJson(venueInstructionPath), referenceClass, settlementResult });
  }

  if (command === "halt") {
    return haltStakeEnvelope({ envelopePath });
  }

  if (command === "status") {
    const envelope = loadEnvelope(envelopePath);
    const cumulativeStakedUsd = cumulativeStakedUsdSinceArming(envelope);
    const realizedPnlByReferenceClass = Object.fromEntries(
      envelope.admittedSeries.map((series) => [referenceClassFromSeries(series), cumulativeRealizedPnlUsd(referenceClassFromSeries(series))]),
    );
    return { envelope, cumulativeStakedUsd, totalRealizedPnlUsd: totalRealizedPnlUsd(envelope), realizedPnlByReferenceClass };
  }

  throw new Error("usage: kalshi-stake-cli.mjs intent|check|place|reconcile|halt|status ...");
}

runMain(({ argv }) => main(argv), {
  moduleUrl: import.meta.url,
  formatResult: (result) => `${JSON.stringify(result, null, 2)}\n`,
  formatError: (error) => `${error.message}\n`,
  exitCode: 1,
});
