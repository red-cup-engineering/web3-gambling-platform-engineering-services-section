/**
 * National Blend of Models station guidance (the NBS text bulletin): NOAA's
 * calibrated blend, issued hourly for every US station, read from NOAA's
 * open-data mirror on AWS (no key, no rate limit) and cached per run.
 *
 * A bulletin is one block per station:
 *
 *    KNYC    NBM V5.0 NBS GUIDANCE    10/03/2026  1200 UTC
 *    DT /OCT   3/OCT   4  ...
 *    UTC  18 21 00 03 06 ...
 *    FHR  06 09 12 15 18 ...
 *    TXN        70          56  ...
 *    XND         1           2  ...
 *
 * Rows are fixed-width: a five-character label, then one three-character
 * column per forecast hour, blank where the element has no value. TXN is
 * the daytime maximum in the 00Z column and the overnight minimum in the 12Z
 * column; XND is NBM's own spread for it, in whole degrees F.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const NBM_OPEN_DATA = 'https://noaa-nbm-grib2-pds.s3.amazonaws.com';
const HEADER = /^\s*(\S+)\s+NBM V[\d.]+ NBS GUIDANCE\s+(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d)(\d\d) UTC/u;
const ROWS = new Set(['FHR', 'TXN', 'XND', 'TMP', 'TSD']);

const pad2 = (n) => String(n).padStart(2, '0');
export const bulletinUrl = (runtime, base = NBM_OPEN_DATA) => {
  const d = new Date(runtime);
  const hh = pad2(d.getUTCHours());
  return `${base}/blend.${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}/${hh}/text/blend_nbstx.t${hh}z`;
};

function columns(line) {
  const out = [];
  for (let at = 5; at < line.length; at += 3) {
    const cell = line.slice(at, at + 3).trim();
    out.push(cell === '' ? null : Number(cell));
  }
  return out;
}

/**
 * Parse an NBS bulletin, keeping only `stations` (all when omitted).
 * @param {string} text
 * @param {Iterable<string>} [stations]
 * @returns {Map<string, {station: string, runtime: string, rows: {ftime: string, txn: number|null, xnd: number|null, tmp: number|null, tsd: number|null}[]}>}
 */
export function parseNbsBulletin(text, stations) {
  const wanted = stations ? new Set(stations) : null;
  const out = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const header = HEADER.exec(lines[i]);
    if (!header || (wanted && !wanted.has(header[1]))) continue;
    const [, station, mm, dd, yyyy, hh, mi] = header;
    const runtime = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
    const block = {};
    for (let j = i + 1; j < lines.length && !HEADER.test(lines[j]) && lines[j].trim() !== ''; j += 1) {
      const label = lines[j].slice(0, 5).trim();
      if (ROWS.has(label)) block[label] = columns(lines[j]);
    }
    if (!block.FHR) continue;
    const rows = block.FHR.map((fhr, c) => ({
      ftime: new Date(runtime + fhr * 3600_000).toISOString(),
      txn: block.TXN?.[c] ?? null, xnd: block.XND?.[c] ?? null, tmp: block.TMP?.[c] ?? null, tsd: block.TSD?.[c] ?? null,
    })).filter((row) => Number.isFinite(Date.parse(row.ftime)));
    out.set(station, { station, runtime: new Date(runtime).toISOString(), rows });
  }
  return out;
}

/**
 * The newest NBS run published at or before `now`, for `stations`: from the
 * cache when that run is already parsed there, else fetched and cached. Runs
 * appear about 45 minutes after their hour; up to `lookbackHours` earlier
 * runs are tried.
 * @param {{stations: string[], now?: Date|string|number, cacheDir: string, lookbackHours?: number, keepRuns?: number}} request
 * @param {{fetchImpl?: typeof fetch, baseUrl?: string}} [options]
 * @returns {Promise<{runtime: string, source: string, stations: Record<string, object>}>}
 */
export async function latestStationGuidance({ stations, now = Date.now(), cacheDir, lookbackHours = 8, keepRuns = 6 }, { fetchImpl = fetch, baseUrl = NBM_OPEN_DATA } = {}) {
  const hour = Math.floor(new Date(now).getTime() / 3600_000) * 3600_000;
  await mkdir(cacheDir, { recursive: true });
  for (let back = 0; back <= lookbackHours; back += 1) {
    const runtime = new Date(hour - back * 3600_000).toISOString();
    const cached = join(cacheDir, `nbs-${runtime.slice(0, 13)}.json`);
    try {
      const doc = JSON.parse(await readFile(cached, 'utf8'));
      if (stations.every((station) => doc.stations[station])) return doc;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    const source = bulletinUrl(runtime, baseUrl);
    const res = await fetchImpl(source, { signal: AbortSignal.timeout(180_000) });
    if (res.status === 404 || res.status === 403) continue;
    if (!res.ok) throw new Error(`nbm-station-guidance: GET ${source} answered ${res.status}`);
    const parsed = parseNbsBulletin(await res.text(), stations);
    const doc = { runtime, source, stations: Object.fromEntries(parsed) };
    const temporary = `${cached}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(doc));
    await rename(temporary, cached);
    const runs = (await readdir(cacheDir)).filter((name) => /^nbs-.*\.json$/u.test(name)).sort();
    for (const stale of runs.slice(0, Math.max(0, runs.length - keepRuns))) await unlink(join(cacheDir, stale)).catch(() => {});
    return doc;
  }
  throw new Error(`nbm-station-guidance: no NBS run found in the ${lookbackHours} hours before ${new Date(now).toISOString()}`);
}

/**
 * The guidance for one station's daily extreme on a local calendar date:
 * the maximum is the TXN valid 00Z the next day, the minimum the TXN valid
 * 12Z the same day.
 * @param {{rows: object[], runtime: string}} stationGuidance
 * @param {{targetDate: string, kind: "high"|"low"}} target
 * @returns {{txn: number, xnd: number, ftime: string, leadHours: number, runtime: string}|null}
 */
export function guidanceForExtreme(stationGuidance, { targetDate, kind }) {
  const date = new Date(`${targetDate}T00:00:00Z`);
  const ftime = kind === 'high' ? new Date(date.getTime() + 24 * 3600_000).toISOString() : new Date(date.getTime() + 12 * 3600_000).toISOString();
  const row = stationGuidance?.rows.find((candidate) => candidate.ftime === ftime && Number.isFinite(candidate.txn));
  if (!row) return null;
  return {
    txn: row.txn, xnd: Number.isFinite(row.xnd) ? row.xnd : 2, ftime, runtime: stationGuidance.runtime,
    leadHours: (Date.parse(ftime) - Date.parse(stationGuidance.runtime)) / 3600_000,
  };
}
