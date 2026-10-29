#!/usr/bin/env node
/**
 * Derives one Kalshi stake intent from the forecasting journal's own three
 * records (three-ways note, instrument 2): the house forecast (record #1),
 * the reference class's calibration readout (record #2, >=30 resolved,
 * house Brier beating market Brier), and a sleeve-sized Kelly fraction
 * (record #3, `@red-cup-engineering/position-sizing-service`'s
 * `sizePosition`, capped at the doctrine's fixed sleeve fraction). Refuses
 * with a datum naming which record failed; the Kelly-zero refusal is the
 * normal case. Never places an order and never mutates the authority
 * envelope -- see `check-stake-mandate.mjs` and `place-stake-order.mjs`.
 */

import { resolve } from "node:path";
import { sizePosition } from "@red-cup-engineering/position-sizing-service/size-position";
import {
  countResolvedCalibrationRows,
  runCalibrationReport,
  questionIdFromTicker,
  referenceClassFromSeries,
  HOUSE_EVIDENCE_SOURCE,
  MARKET_EVIDENCE_SOURCE,
} from "@red-cup-engineering/forecasting/forecast-weather-markets-cli";
import { FORECAST_CATEGORY, FORECAST_OBJECT_KIND } from "@red-cup-engineering/forecasting/record-forecast";
import {
  STAKE_INTENT_TYPE,
  DEFAULT_MIN_RESOLVED_FORECASTS,
  DEFAULT_MAX_SLEEVE_FRACTION,
  refuseStakeIntent,
  expectedEdgeAfterFee,
  applyMaxSleeveFraction,
} from "../src/stake-intent.mjs";
import { journalFor } from "../src/journal.mjs";

/** This package's own root: the default semantic-record-journal custody root for its own intent records (writes land at data/logs/, per house data-custody law). */
export const NODE_ROOT = resolve(new URL("..", import.meta.url).pathname);

/** The journal category this package's stake-intent records are written and queried under. */
export const STAKE_INTENT_CATEGORY = "kalshi-stake-path.intent";

/** The objectKind this package's semantic record journal uses for stake-intent records. */
export const STAKE_INTENT_OBJECT_KIND = "kalshi-stake-path.stake-intent-record";

/**
 * The most recently recorded forecast row (by evidenceCitations[0].source)
 * among `forecastRows` for one source tag -- shared by the house-row and
 * market-row lookups so they are one implementation, not two.
 * @param {object[]} forecastRows
 * @param {string} source
 * @returns {object|undefined}
 */
function latestForecastRowBySource(forecastRows, source) {
  return forecastRows.filter((row) => row.record.evidenceCitations?.[0]?.source === source).at(-1);
}

/**
 * Derives (and records) one Kalshi stake intent for one market.
 * @param {object} input
 * @param {string} input.marketTicker Kalshi bracket ticker, e.g. "KXHIGHNY-26SEP05-B85.5".
 * @param {string} input.seriesTicker Kalshi series ticker, e.g. "KXHIGHNY".
 * @param {{riskCapital: string, survivalCapital: string, stage?: (1|2|3|4|5|null), barrierJoules?: object|null}} input.sleeve The bounded risk sleeve to size against (position-sizing-service shape).
 * @param {string} input.forecastingDataRoot Path to the forecasting-services-section root whose data/logs/ holds the live forecast and calibration journal.
 * @param {{feeRate?: number, kellyMultiple?: number, maxSleeveFraction?: number, minResolvedForecasts?: number}} [input.config]
 * @param {string} [input.dataRoot] This package's own data root (defaults to its own NODE_ROOT).
 * @param {string} [input.now] ISO 8601; defaults to the current instant.
 * @returns {{id: string, objectKind: string} & object} the recorded (admitted or refused) stake-intent record.
 */
export function deriveStakeIntent({ marketTicker, seriesTicker, sleeve, forecastingDataRoot, config = {}, dataRoot, now }) {
  if (typeof marketTicker !== "string" || marketTicker.length === 0) throw new TypeError("derive-stake-intent: marketTicker is required");
  if (typeof seriesTicker !== "string" || seriesTicker.length === 0) throw new TypeError("derive-stake-intent: seriesTicker is required");
  if (typeof sleeve !== "object" || sleeve === null) throw new TypeError("derive-stake-intent: sleeve is required");
  if (typeof forecastingDataRoot !== "string" || forecastingDataRoot.length === 0) throw new TypeError("derive-stake-intent: forecastingDataRoot is required");

  const derivedAt = now ?? new Date().toISOString();
  const referenceClass = referenceClassFromSeries(seriesTicker);
  const questionId = questionIdFromTicker(marketTicker);
  const feeRate = config.feeRate ?? 0;
  const kellyMultiple = config.kellyMultiple ?? 1;
  const maxSleeveFraction = config.maxSleeveFraction ?? DEFAULT_MAX_SLEEVE_FRACTION;
  const minResolvedForecasts = config.minResolvedForecasts ?? DEFAULT_MIN_RESOLVED_FORECASTS;

  const record = (fields) => {
    const receipt = journalFor({ dataRoot, objectKind: STAKE_INTENT_OBJECT_KIND, nodeRoot: NODE_ROOT }).record({
      category: STAKE_INTENT_CATEGORY,
      recordedAt: derivedAt,
      record: fields,
      charge: { support: fields.admitted === true, refutation: fields.admitted === false },
    });
    return { id: receipt.id, ...fields };
  };

  const forecastJournal = journalFor({ dataRoot: forecastingDataRoot, objectKind: FORECAST_OBJECT_KIND, nodeRoot: forecastingDataRoot });
  const forecastRows = forecastJournal.query({ category: FORECAST_CATEGORY }).filter((row) => row.record.questionId === questionId);
  const houseRow = latestForecastRowBySource(forecastRows, HOUSE_EVIDENCE_SOURCE);
  const marketRow = latestForecastRowBySource(forecastRows, MARKET_EVIDENCE_SOURCE);

  if (!houseRow) {
    const refusal = refuseStakeIntent({ marketTicker, referenceClass, questionId, reason: `record #1 missing: no house forecast (with its falsifier/rationale) recorded for questionId ${questionId}`, derivedAt });
    return record(refusal);
  }
  if (!marketRow) {
    const refusal = refuseStakeIntent({ marketTicker, referenceClass, questionId, forecastRecordId: houseRow.id, reason: `no market-implied-probability row recorded beside the house forecast for questionId ${questionId}`, derivedAt });
    return record(refusal);
  }

  const resolvedCalibrationCount = countResolvedCalibrationRows(referenceClass, { dataRoot: forecastingDataRoot });
  const calibrationReadout = runCalibrationReport({ dataRoot: forecastingDataRoot, minResolvedForecasts }).find((row) => row.referenceClass === referenceClass)
    ?? { referenceClass, resolvedCount: resolvedCalibrationCount, houseBrier: null, marketBrier: null, calibrationGateMet: false };
  const calibrationRecordId = `${referenceClass}@${resolvedCalibrationCount}`;

  const baseRefusalFields = {
    marketTicker, referenceClass, questionId,
    forecastRecordId: houseRow.id, marketForecastRecordId: marketRow.id,
    houseProbability: houseRow.record.probability, marketProbability: marketRow.record.probability,
    resolvedCalibrationCount, minResolvedForecasts, houseBrier: calibrationReadout.houseBrier, marketBrier: calibrationReadout.marketBrier,
    derivedAt,
  };

  if (resolvedCalibrationCount < minResolvedForecasts) {
    return record(refuseStakeIntent({ ...baseRefusalFields, reason: `record #2 not met: calibration gate ${resolvedCalibrationCount}/${minResolvedForecasts} resolved forecasts for reference class ${referenceClass}` }));
  }
  if (calibrationReadout.houseBrier === null || calibrationReadout.marketBrier === null || !(calibrationReadout.houseBrier < calibrationReadout.marketBrier)) {
    return record(refuseStakeIntent({ ...baseRefusalFields, calibrationRecordId, reason: `record #2 shows no edge: house Brier ${calibrationReadout.houseBrier} does not beat market Brier ${calibrationReadout.marketBrier} on reference class ${referenceClass}` }));
  }

  // The market-implied probability row is this loop's recorded, as-of evidence (never a fresh fetch at
  // intent-derivation time), and doubles as the price proxy: both are denominated in dollars-per-contract
  // on the yes side, in [0,1].
  const houseProbability = houseRow.record.probability;
  const marketProbability = marketRow.record.probability;
  const marketPrice = marketProbability;
  const buyYes = houseProbability > marketProbability;
  const side = buyYes ? "yes" : "no";
  const price = buyYes ? marketPrice : 1 - marketPrice;
  const winProbability = buyYes ? houseProbability : 1 - houseProbability;

  let edge;
  try {
    edge = expectedEdgeAfterFee({ winProbability, price, feeRate });
  } catch (error) {
    return record(refuseStakeIntent({ ...baseRefusalFields, calibrationRecordId, side, marketPrice, feeRate, reason: `edge computation refused: ${error.message}` }));
  }
  if (edge.netEdge <= 0) {
    return record(refuseStakeIntent({ ...baseRefusalFields, calibrationRecordId, side, marketPrice, feeRate, reason: `record #3 non-positive: expected edge after fee ${edge.netEdge.toFixed(6)} at price ${price} feeRate ${feeRate} -- Kelly-zero is the normal case` }));
  }

  const sleeveRequest = { edge: { winProbability, payoffRatio: edge.payoffRatio }, sleeve, liabilityBeyondStake: false, kellyMultiple };
  const sleeveResult = sizePosition(sleeveRequest);
  if (!sleeveResult.admitted) {
    return record(refuseStakeIntent({ ...baseRefusalFields, calibrationRecordId, side, marketPrice, feeRate, expectedEdgeAfterFee: edge.netEdge, sleeveRequest, sleeveResult, reason: `record #3 refused by the sleeve: ${sleeveResult.reason}` }));
  }

  const capped = applyMaxSleeveFraction(sleeveResult, maxSleeveFraction, sleeve.riskCapital);
  const contracts = Math.floor(Number(capped.stakeUsd) / price);
  if (contracts < 1) {
    return record(refuseStakeIntent({ ...baseRefusalFields, calibrationRecordId, side, marketPrice, feeRate, expectedEdgeAfterFee: edge.netEdge, kellyFractionRaw: sleeveResult.fraction, maxSleeveFraction, kellyFractionCapped: capped.kellyFractionCapped, sleeveRequest, sleeveResult, stakeUsd: capped.stakeUsd, reason: `sized stake ${capped.stakeUsd} buys fewer than one contract at price ${price}` }));
  }

  return record({
    type: STAKE_INTENT_TYPE, version: 1, admitted: true,
    marketTicker, referenceClass, questionId,
    forecastRecordId: houseRow.id, marketForecastRecordId: marketRow.id,
    calibrationRecordId, houseProbability, marketProbability, marketPrice, side, feeRate,
    resolvedCalibrationCount, minResolvedForecasts, houseBrier: calibrationReadout.houseBrier, marketBrier: calibrationReadout.marketBrier,
    expectedEdgeAfterFee: edge.netEdge, kellyFractionRaw: sleeveResult.fraction, maxSleeveFraction, kellyFractionCapped: capped.kellyFractionCapped,
    sleeveRequest, sleeveResult, contracts, stakeUsd: capped.stakeUsd, derivedAt,
  });
}

if (import.meta.main) {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    process.stderr.write("usage: derive-stake-intent.mjs <request.json>\n");
    process.exitCode = 2;
  } else {
    const { readFileSync } = await import("node:fs");
    const request = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    process.stdout.write(`${JSON.stringify(deriveStakeIntent(request), null, 2)}\n`);
  }
}
