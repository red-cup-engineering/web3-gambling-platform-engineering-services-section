#!/usr/bin/env node
/**
 * The automatic circuit breaker (growth-policy note, 2026-09-01: "the
 * kill-switch is an AUTOMATIC circuit breaker, never a request for human
 * permission"). Trips `armed` to `false` and persists the envelope when
 * either the envelope's expiry has passed or the sleeve's drawdown floor
 * has been breached (cumulative realized P&L, summed since arming across
 * every admitted series' reference class, measured against the sleeve's
 * starting riskCapital -- not a rolling high-water mark, since this path
 * has only discrete realized-P&L events, never a continuous equity feed).
 * Runnable by a timer; never asks.
 */

import { parse, cmp, negate, format } from "@red-cup-engineering/energy-bank/decimal";
import { resolve } from "node:path";
import { referenceClassFromSeries } from "@red-cup-engineering/forecasting/forecast-weather-markets-cli";
import { validateAuthorityEnvelope, isEnvelopeExpired, loadEnvelope, saveEnvelope } from "../src/authority-envelope.mjs";
import { journalFor } from "../src/journal.mjs";
import { cumulativeRealizedPnlUsd } from "./reconcile-stake-fill.mjs";

export const NODE_ROOT = resolve(new URL("..", import.meta.url).pathname);
export const HALT_EVENT_CATEGORY = "kalshi-stake-path.halt-event";
export const HALT_EVENT_OBJECT_KIND = "kalshi-stake-path.halt-event-record";
export const DEFAULT_ENVELOPE_PATH = resolve(NODE_ROOT, "data", "state", "authority-envelope.json");

/**
 * The envelope's total realized P&L since arming, summed across every
 * admitted series' calibration reference class.
 * @param {ReturnType<typeof validateAuthorityEnvelope>} envelope
 * @param {{dataRoot?: string}} [options]
 * @returns {string} exact decimal string; negative when net-down.
 */
export function totalRealizedPnlUsd(envelope, options = {}) {
  return envelope.admittedSeries
    .map((series) => cumulativeRealizedPnlUsd(referenceClassFromSeries(series), options))
    .reduce((total, pnl) => (Number(pnl) + Number(total)).toFixed(2), "0.00");
}

/**
 * Evaluates the circuit breaker against the current envelope and, when
 * tripped, unarms and persists it plus a halt-event receipt. A no-op
 * (returns `{tripped: false, reason: "already-unarmed"}`) when the
 * envelope is already unarmed.
 * @param {{envelope?: object, envelopePath?: string, dataRoot?: string, now?: string}} [input]
 * @returns {{tripped: boolean, reason: string|null, envelope: object, drawdownFraction?: number, totalRealizedPnlUsd?: string}}
 */
export function haltStakeEnvelope({ envelope, envelopePath = DEFAULT_ENVELOPE_PATH, dataRoot, now } = {}) {
  const checkedAt = now ?? new Date().toISOString();
  const validEnvelope = validateAuthorityEnvelope(envelope ?? loadEnvelope(envelopePath));

  if (validEnvelope.armed !== true) {
    return { tripped: false, reason: "already-unarmed", envelope: validEnvelope };
  }

  const expired = isEnvelopeExpired(validEnvelope, checkedAt);
  const pnl = totalRealizedPnlUsd(validEnvelope, { dataRoot });
  const riskCapitalNumber = Number(validEnvelope.sleeve.riskCapital);
  const lossNumber = cmp(parse(pnl), parse("0")) < 0 ? Number(format(negate(parse(pnl)))) : 0;
  const drawdownFraction = riskCapitalNumber > 0 ? lossNumber / riskCapitalNumber : 0;
  const drawdownBreached = drawdownFraction > validEnvelope.drawdownFloorFraction;

  if (!expired && !drawdownBreached) {
    return { tripped: false, reason: null, envelope: validEnvelope, drawdownFraction, totalRealizedPnlUsd: pnl };
  }

  const reason = expired
    ? `expiry ${validEnvelope.expiry} is at or before now ${checkedAt}`
    : `drawdown ${(drawdownFraction * 100).toFixed(3)}% (realized P&L ${pnl} against riskCapital ${validEnvelope.sleeve.riskCapital}) exceeds drawdownFloorFraction ${(validEnvelope.drawdownFloorFraction * 100).toFixed(3)}%`;

  const haltedEnvelope = saveEnvelope(envelopePath, { ...validEnvelope, armed: false, haltedAt: checkedAt, haltReason: reason });
  journalFor({ dataRoot, objectKind: HALT_EVENT_OBJECT_KIND, nodeRoot: NODE_ROOT }).record({
    category: HALT_EVENT_CATEGORY,
    recordedAt: checkedAt,
    record: { type: "KalshiStakeHaltEvent", version: 1, reason, expired, drawdownFraction, totalRealizedPnlUsd: pnl, haltedAt: checkedAt },
    charge: { support: true, refutation: false },
  });
  return { tripped: true, reason, envelope: haltedEnvelope, drawdownFraction, totalRealizedPnlUsd: pnl };
}

if (import.meta.main) {
  const envelopePathArg = process.argv[2];
  const result = haltStakeEnvelope(envelopePathArg ? { envelopePath: resolve(envelopePathArg) } : {});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
