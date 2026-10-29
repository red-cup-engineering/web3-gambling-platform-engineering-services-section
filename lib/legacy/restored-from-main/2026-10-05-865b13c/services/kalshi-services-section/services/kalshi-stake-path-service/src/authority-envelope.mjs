/**
 * The Kalshi stake path's authority envelope: the deterministic bounds held
 * outside the model (three-ways note, meet-then-beat's consequential-surface
 * loop) -- venue, admitted series, per-order and cumulative caps, a drawdown
 * floor over the sleeve, expiry, kill path, signer, and the founder as
 * principal by actor id, armed false by default. Pure validation and
 * predicates only; loading/saving the envelope's mutable `armed` state is
 * `scripts/halt-stake-envelope.mjs`'s concern.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse, cmp, add } from "@red-cup-engineering/energy-bank/decimal";

/** The one admitted venue for this envelope; a stake path for another venue is a different package, never a second field on this one. */
export const KALSHI_STAKE_ENVELOPE_TYPE = "KalshiStakeAuthorityEnvelope";

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`authority-envelope: ${label} must be a non-empty string`);
  return value;
}

function requireDecimalString(value, label) {
  if (typeof value !== "string") throw new TypeError(`authority-envelope: ${label} must be an exact decimal string, got ${JSON.stringify(value)}`);
  return parse(value);
}

function requireIsoTimestamp(value, label) {
  requireNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`authority-envelope: ${label} must be a parseable ISO 8601 timestamp, got ${JSON.stringify(value)}`);
  return value;
}

/**
 * Validates and normalizes a raw authority-envelope object against
 * `data/records/schema/authority-envelope.schema.json`, freezing the result.
 * @param {unknown} input
 * @returns {Readonly<object>} the normalized envelope.
 * @throws {TypeError} on any malformed or missing required field.
 */
export function validateAuthorityEnvelope(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("authority-envelope: envelope must be a JSON object");
  }
  if (input.type !== KALSHI_STAKE_ENVELOPE_TYPE) throw new TypeError(`authority-envelope: type must be "${KALSHI_STAKE_ENVELOPE_TYPE}", got ${JSON.stringify(input.type)}`);
  if (input.venue !== "kalshi") throw new TypeError(`authority-envelope: venue must be "kalshi", got ${JSON.stringify(input.venue)}`);
  if (!Array.isArray(input.admittedSeries) || input.admittedSeries.length === 0 || !input.admittedSeries.every((series) => typeof series === "string" && series.length > 0)) {
    throw new TypeError("authority-envelope: admittedSeries must be a non-empty array of non-empty series ticker strings");
  }
  const perOrderCapUsd = requireDecimalString(input.perOrderCapUsd, "perOrderCapUsd");
  const cumulativeCapUsd = requireDecimalString(input.cumulativeCapUsd, "cumulativeCapUsd");
  if (cmp(cumulativeCapUsd, perOrderCapUsd) < 0) throw new TypeError("authority-envelope: cumulativeCapUsd must be >= perOrderCapUsd");
  if (typeof input.drawdownFloorFraction !== "number" || !Number.isFinite(input.drawdownFloorFraction) || input.drawdownFloorFraction <= 0 || input.drawdownFloorFraction > 1) {
    throw new TypeError("authority-envelope: drawdownFloorFraction must be a finite number in (0,1]");
  }
  if (typeof input.sleeve !== "object" || input.sleeve === null) throw new TypeError("authority-envelope: sleeve is required");
  requireDecimalString(input.sleeve.riskCapital, "sleeve.riskCapital");
  requireDecimalString(input.sleeve.survivalCapital, "sleeve.survivalCapital");
  requireIsoTimestamp(input.expiry, "expiry");
  requireNonEmptyString(input.killPath, "killPath");
  if (typeof input.signer !== "object" || input.signer === null) throw new TypeError("authority-envelope: signer is required");
  requireNonEmptyString(input.signer.host, "signer.host");
  if (typeof input.principal !== "object" || input.principal === null) throw new TypeError("authority-envelope: principal is required");
  requireNonEmptyString(input.principal.actorId, "principal.actorId");
  if (typeof input.armed !== "boolean") throw new TypeError("authority-envelope: armed must be a boolean");
  return Object.freeze({ ...input, version: 1 });
}

/**
 * True when `seriesTicker` is one of the envelope's admitted series.
 * @param {ReturnType<typeof validateAuthorityEnvelope>} envelope
 * @param {string} seriesTicker
 * @returns {boolean}
 */
export function isSeriesAdmitted(envelope, seriesTicker) {
  return envelope.admittedSeries.includes(seriesTicker);
}

/**
 * True when `now` is at or past the envelope's expiry.
 * @param {ReturnType<typeof validateAuthorityEnvelope>} envelope
 * @param {string} now ISO 8601.
 * @returns {boolean}
 */
export function isEnvelopeExpired(envelope, now) {
  return Date.parse(now) >= Date.parse(envelope.expiry);
}

/**
 * True when a stake of `stakeUsd` (exact decimal string) would exceed the
 * envelope's per-order cap.
 * @param {ReturnType<typeof validateAuthorityEnvelope>} envelope
 * @param {string} stakeUsd
 * @returns {boolean}
 */
export function exceedsPerOrderCap(envelope, stakeUsd) {
  return cmp(parse(stakeUsd), parse(envelope.perOrderCapUsd)) > 0;
}

/**
 * True when `stakeUsd` (exact decimal string) added to `cumulativeStakedUsd`
 * (the sum of every stake this envelope has already placed since arming)
 * would exceed the envelope's cumulative cap.
 * @param {ReturnType<typeof validateAuthorityEnvelope>} envelope
 * @param {string} stakeUsd
 * @param {string} cumulativeStakedUsd
 * @returns {boolean}
 */
export function exceedsCumulativeCap(envelope, stakeUsd, cumulativeStakedUsd) {
  const projected = add(parse(stakeUsd), parse(cumulativeStakedUsd));
  return cmp(projected, parse(envelope.cumulativeCapUsd)) > 0;
}

/**
 * Loads and validates the envelope's mutable state file (the live source
 * of `armed`), matching `alpaca-account-kill-switch-service`'s
 * `loadHighWaterMark`/`saveHighWaterMark` precedent for a small, hand-read
 * JSON state file under `data/state/`.
 * @param {string} path
 * @returns {Readonly<object>}
 * @throws {Error} (ENOENT) when the file has never been written -- there is no envelope until the founder's arming act creates one.
 */
export function loadEnvelope(path) {
  return validateAuthorityEnvelope(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Persists the envelope's current state (mode 0o600: it is the arming
 * record, never world-readable).
 * @param {string} path
 * @param {object} envelope
 * @returns {Readonly<object>} the same envelope, validated and frozen.
 */
export function saveEnvelope(path, envelope) {
  const validEnvelope = validateAuthorityEnvelope(envelope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(validEnvelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return validEnvelope;
}
