/**
 * A station's temperature extremes so far in its climate day, from the NWS
 * observation API (api.weather.gov; public, asks only for a descriptive
 * User-Agent).
 *
 * The Daily Climate Report's day runs midnight to midnight local STANDARD
 * time, so under daylight time it starts at 01:00 on the clock. Hourly and
 * special observations carry temperature in tenths of a degree C; the
 * report's extreme comes from the station's continuous record in whole
 * degrees F, so it can only be at or beyond what the observations show. The
 * bounds returned are one degree looser than the observations, to cover
 * conversion and rounding: the day's maximum is at least `floor`, its
 * minimum at most `ceiling`.
 */
export const NWS_API = 'https://api.weather.gov';
export const NWS_USER_AGENT = '(561 Group weather desk, ops@561.group)';

/** The UTC instant of local standard-time midnight starting `date` in `timeZone`. */
export function climateDayStart(date, timeZone) {
  const noon = new Date(`${date}T12:00:00Z`);
  // The zone's standard offset is the larger of its January and July offsets west of UTC.
  const offsetMinutes = (instant) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(instant).map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    return (asUtc - instant.getTime()) / 60_000;
  };
  const year = noon.getUTCFullYear();
  const standard = Math.min(offsetMinutes(new Date(Date.UTC(year, 0, 15))), offsetMinutes(new Date(Date.UTC(year, 6, 15))));
  return new Date(Date.parse(`${date}T00:00:00Z`) - standard * 60_000);
}

/**
 * The extremes observed at `station` from the start of its climate day on
 * `date` until now.
 * @param {{station: string, date: string, timeZone: string, now?: Date|string|number}} request
 * @param {{fetchImpl?: typeof fetch, baseUrl?: string, userAgent?: string}} [options]
 * @returns {Promise<{station: string, date: string, from: string, count: number, maxF: number|null, minF: number|null, floor: number|null, ceiling: number|null, latest: string|null}>}
 */
export async function observedExtremes({ station, date, timeZone, now = Date.now() }, { fetchImpl = fetch, baseUrl = NWS_API, userAgent = NWS_USER_AGENT } = {}) {
  const from = climateDayStart(date, timeZone);
  const until = new Date(Math.min(new Date(now).getTime(), from.getTime() + 24 * 3600_000));
  const empty = { station, date, from: from.toISOString(), count: 0, maxF: null, minF: null, floor: null, ceiling: null, latest: null };
  if (until <= from) return empty;
  const url = new URL(`${baseUrl}/stations/${station}/observations`);
  url.searchParams.set('start', from.toISOString());
  url.searchParams.set('end', until.toISOString());
  const res = await fetchImpl(url, { headers: { 'user-agent': userAgent, accept: 'application/geo+json' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`station-observations: GET ${url} answered ${res.status}`);
  const temps = [];
  let latest = null;
  for (const feature of (await res.json())?.features ?? []) {
    const c = feature?.properties?.temperature?.value;
    if (typeof c !== 'number' || !Number.isFinite(c)) continue;
    temps.push(c * 9 / 5 + 32);
    const at = feature.properties.timestamp;
    if (!latest || at > latest) latest = at;
  }
  if (temps.length === 0) return empty;
  const maxF = Math.max(...temps), minF = Math.min(...temps);
  return { station, date, from: from.toISOString(), count: temps.length, maxF, minF, floor: Math.floor(maxF) - 1, ceiling: Math.ceil(minF) + 1, latest };
}

/**
 * NWS products that announce a temperature regime the station's guidance error model was not fitted on.
 * Under one, the far tail on its side is the regime's risk, not a mispriced premium (2026-10-04: KSAN and
 * KLAX reached 100F under an Extreme Heat Warning while the model put 101F+ near 0.2%).
 */
export const WARM_HAZARDS = Object.freeze(['Extreme Heat Warning', 'Extreme Heat Watch', 'Excessive Heat Warning', 'Excessive Heat Watch', 'Heat Advisory']);
export const COLD_HAZARDS = Object.freeze(['Extreme Cold Warning', 'Extreme Cold Watch', 'Cold Weather Advisory', 'Wind Chill Warning', 'Wind Chill Advisory', 'Hard Freeze Warning', 'Hard Freeze Watch', 'Freeze Warning', 'Freeze Watch', 'Frost Advisory']);

const stationPoints = new Map();

/**
 * The warm and cold temperature hazards NWS has active at `station`'s location now.
 * @returns {Promise<{station: string, warm: string[], cold: string[]}>}
 */
export async function activeTemperatureHazards({ station }, { fetchImpl = fetch, baseUrl = NWS_API, userAgent = NWS_USER_AGENT } = {}) {
  const get = async (url) => {
    const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/geo+json' } });
    if (!response.ok) throw new Error(`NWS ${url}: ${response.status}`);
    return response.json();
  };
  if (!stationPoints.has(station)) {
    const [lon, lat] = (await get(`${baseUrl}/stations/${station}`)).geometry.coordinates;
    stationPoints.set(station, `${lat.toFixed(4)},${lon.toFixed(4)}`);
  }
  const events = (await get(`${baseUrl}/alerts/active?point=${stationPoints.get(station)}`)).features.map((feature) => feature.properties.event);
  return { station, warm: events.filter((event) => WARM_HAZARDS.includes(event)), cold: events.filter((event) => COLD_HAZARDS.includes(event)) };
}
