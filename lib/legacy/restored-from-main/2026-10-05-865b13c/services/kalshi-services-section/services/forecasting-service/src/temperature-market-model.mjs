/**
 * The house's price for one Kalshi daily-temperature bracket: the series'
 * climate-report station and kind (content/config/temperature-markets.json),
 * NBM's guidance for that station's extreme on the event date, the fitted
 * error model, and any extreme already observed that day. Pure: guidance and
 * observations are passed in.
 */
import { readFileSync } from 'node:fs';
import { bracketProbability, forecastScale } from './temperature-distribution.mjs';
import { guidanceForExtreme } from './nbm-station-guidance.mjs';

export const TEMPERATURE_MARKETS = JSON.parse(readFileSync(new URL('../content/config/temperature-markets.json', import.meta.url), 'utf8'));
const BY_SERIES = new Map(TEMPERATURE_MARKETS.series.map((row) => [row.seriesTicker, row]));

/** The declared row for a series, or undefined when the house does not price it. */
export const temperatureSeries = (seriesTicker) => BY_SERIES.get(seriesTicker);

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
/** The local calendar date an event ticker names (KXHIGHNY-26OCT04 -> 2026-10-04), or null. */
export function eventDate(eventTicker) {
  const match = /-(\d{2})([A-Z]{3})(\d{2})$/u.exec(eventTicker ?? '');
  return match && MONTHS[match[2]] ? `20${match[1]}-${MONTHS[match[2]]}-${match[3]}` : null;
}

/**
 * The probability one bracket settles yes, with everything it rests on.
 * @param {{seriesTicker: string, eventTicker: string, strikeType: string, floorStrike?: number, capStrike?: number}} market
 * @param {{guidance: {stations: Record<string, object>, runtime: string}, observed?: {floor: number|null, ceiling: number|null}|null, maxGuidanceAgeHours?: number, now?: number}} evidence
 * @returns {{priced: true, probability: number, mean: number, scale: number, nu: number, station: string, kind: string, targetDate: string, txn: number, xnd: number, leadHours: number, runtime: string, observedFloor: number|null, observedCeiling: number|null} | {priced: false, reason: string}}
 */
export function priceTemperatureBracket(market, { guidance, observed = null, maxGuidanceAgeHours = 8, now = Date.now() }) {
  const series = temperatureSeries(market.seriesTicker);
  if (!series) return { priced: false, reason: `series ${market.seriesTicker} is not declared` };
  const targetDate = eventDate(market.eventTicker);
  if (!targetDate) return { priced: false, reason: `event ${market.eventTicker} names no date` };
  const ageHours = (now - Date.parse(guidance.runtime)) / 3600_000;
  if (!(ageHours <= maxGuidanceAgeHours)) return { priced: false, reason: `guidance run ${guidance.runtime} is ${ageHours.toFixed(1)}h old` };
  const g = guidanceForExtreme(guidance.stations[series.station], { targetDate, kind: series.kind });
  if (!g) return { priced: false, reason: `no NBM ${series.kind} for ${series.station} on ${targetDate} in run ${guidance.runtime}` };
  const model = TEMPERATURE_MARKETS.models[series.kind];
  const mean = g.txn + (model.stationBias[series.station] ?? 0);
  const scale = forecastScale({ xnd: g.xnd, leadHours: g.leadHours }, model);
  const observedFloor = series.kind === 'high' && Number.isFinite(observed?.floor) ? observed.floor : null;
  const observedCeiling = series.kind === 'low' && Number.isFinite(observed?.ceiling) ? observed.ceiling : null;
  const probability = bracketProbability(market, { mean, scale, nu: model.nu, observedFloor: observedFloor ?? -Infinity, observedCeiling: observedCeiling ?? Infinity });
  return { priced: true, probability, mean, scale, nu: model.nu, station: series.station, kind: series.kind, targetDate, txn: g.txn, xnd: g.xnd, leadHours: g.leadHours, runtime: g.runtime, observedFloor, observedCeiling };
}
