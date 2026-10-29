/**
 * Kalshi combo (multivariate, KXMVECROSSCATEGORY*) shadow pricer: the pure part.
 *
 * A combo is a parlay priced by RFQ: makers privately quote the FULL size; the
 * requester accepts one; the trade prints on the combo market's public tape.
 * Our fair value for a combo is P(all legs win), a joint-distribution problem:
 *   - legs from distinct events are independent: the product of their (coherent)
 *     leg probabilities;
 *   - legs sharing an event form a cluster priced by a Gaussian copula whose
 *     pairwise latent correlations are fitted from settled Kalshi markets
 *     (tetrachoric estimates by role-pair class, shrunk; see `combo-shadow.mjs fit`);
 *   - legs inside one mutually-exclusive event (the two teams of a GAME event)
 *     are resolved by exact set logic, not by the copula.
 * Everything here is shadow: nothing in this module touches the venue.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const comboStateDir = (env = process.env) => env.COMBO_STATE_DIR ?? join(env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service', 'combos');

/** Combo ticker prefix: every KXMVE* market is a multivariate combo. */
export const isComboTicker = (ticker) => typeof ticker === 'string' && ticker.startsWith('KXMVE');

const num = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** An RFQ's requested size in dollars of combo cost (target_cost_dollars, else contracts at a given price). */
export function rfqSize(rfq, price = null) {
  const cost = num(rfq.target_cost_dollars);
  if (cost && cost > 0) return cost;
  const n = num(rfq.contracts_fp);
  if (n && n > 0 && price) return n * price;
  return null;
}

// ---------------------------------------------------------------- normal distribution

/** Standard normal CDF (Hart/West double-precision algorithm, |error| < 1e-15). */
export function Phi(x) {
  const z = Math.abs(x);
  let p;
  if (z > 37) p = 0;
  else {
    const e = Math.exp(-z * z / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165; n = n * z + 33.912866078383; n = n * z + 112.079291497871;
      n = n * z + 221.213596169931; n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207; d = d * z + 86.7807322029461; d = d * z + 296.564248779674;
      d = d * z + 637.333633378831; d = d * z + 793.826512519948; d = d * z + 440.413735824752;
      p = e * n / d;
    } else {
      let b = z + 0.65; b = z + 4 / b; b = z + 3 / b; b = z + 2 / b; b = z + 1 / b;
      p = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - p : p;
}

/** Inverse standard normal CDF (Acklam, refined by one Halley step). */
export function PhiInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  let x;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else { const q = p - 0.5; const r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  const e = Phi(x) - p; const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Lower Cholesky factor of a symmetric matrix, or null when not positive definite. */
export function cholesky(M) {
  const n = M.length; const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i += 1) for (let j = 0; j <= i; j += 1) {
    let s = M[i][j]; for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k];
    if (i === j) { if (s <= 1e-9) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  return L;
}

/**
 * P(X_i <= b_i for all i) for X ~ N(0, R), by Genz's separation-of-variables
 * Monte Carlo (deterministic seed, antithetic pairs). R is shrunk toward the
 * identity until positive definite; `shrunk` reports whether that happened.
 */
export function mvnLowerProb(b, R, { samples = 4000, seed = 20261004 } = {}) {
  const n = b.length;
  if (n === 0) return { p: 1, shrunk: false };
  if (b.some((x) => x === -Infinity)) return { p: 0, shrunk: false };
  if (n === 1) return { p: Phi(b[0]), shrunk: false };
  let M = R; let L = cholesky(M); let shrunk = false; let lam = 1;
  while (!L && lam > 0.02) { lam *= 0.8; shrunk = true; M = R.map((row, i) => row.map((v, j) => (i === j ? 1 : v * lam))); L = cholesky(M); }
  if (!L) return { p: b.reduce((acc, x) => acc * Phi(x), 1), shrunk: true };
  const rnd = mulberry32(seed); let sum = 0; const half = Math.floor(samples / 2);
  for (let s = 0; s < half; s += 1) {
    const w = Array.from({ length: n - 1 }, rnd);
    for (const flip of [false, true]) {
      let prod = 1; const y = new Array(n).fill(0);
      for (let i = 0; i < n; i += 1) {
        let m = 0; for (let j = 0; j < i; j += 1) m += L[i][j] * y[j];
        const e = Phi((b[i] - m) / L[i][i]); prod *= e;
        if (i < n - 1) { const u = flip ? 1 - w[i] : w[i]; y[i] = PhiInv(Math.min(1 - 1e-12, Math.max(1e-12, u * e))); }
      }
      sum += prod;
    }
  }
  return { p: sum / (2 * half), shrunk };
}

// ---------------------------------------------------------------- leg roles

const SPORT_PREFIXES = ['NFL', 'NCAAF', 'NCAAB', 'NBA', 'WNBA', 'MLB', 'NHL', 'UEFANL', 'INTLFRIENDLY', 'EPL', 'LALIGA2', 'LALIGA', 'LIGUE1', 'BUNDESLIGA', 'SERIEA', 'USL', 'MLS', 'ATP', 'WTA', 'UFC', 'CS2', 'LOL'];
const ROLE_SUFFIX = [
  ['W', /(?:GAME|MATCH|FIGHT)$/u], ['T', /^(?:1H|1Q|2H)?TOTAL$/u], ['TT', /TEAMTOTAL$/u], ['S', /SPREAD$/u], ['B', /BTTS$/u],
];

/** Parse a Kalshi leg market ticker into sport, role, game id, subject. */
export function legMeta(marketTicker, eventTicker = marketTicker.split('-').slice(0, 2).join('-')) {
  const [series, game] = eventTicker.split('-');
  const base = series.replace(/^KX/u, '');
  const sport = SPORT_PREFIXES.find((p) => base.startsWith(p)) ?? null;
  const rest = sport ? base.slice(sport.length) : base;
  const hit = ROLE_SUFFIX.find(([, re]) => re.test(rest));
  const role = hit ? (rest === 'TEAMTOTAL' ? 'TT' : hit[0]) : 'P';
  const suffix = marketTicker.slice(eventTicker.length + 1);
  const strike = Number((/-([0-9.]+)$/u.exec(suffix) ?? [])[1]);
  return { series, sport: sport ?? base, role, kind: rest, game, event: eventTicker, suffix, strike: Number.isFinite(strike) ? strike : null, ticker: marketTicker };
}

/** Which of the two teams of a game id (away=0, home=1) a suffix/leg belongs to, or null. */
export function teamSide(meta) {
  const tail = (/^\d{2}[A-Z]{3}\d{2}(?:\d{4})?([A-Z]+)$/u.exec(meta.game) ?? [])[1];
  if (!tail) return null;
  const s = meta.suffix;
  for (let k = 2; k <= 4 && k < tail.length; k += 1) {
    const away = tail.slice(0, k); const home = tail.slice(k);
    const a = s.startsWith(away); const h = s.startsWith(home);
    if (a !== h) return a ? 0 : 1;
  }
  return null;
}

/** The correlation class of two same-game legs: sport|roleA|roleB|same-team. */
export function pairClass(a, b) {
  const ra = a.role; const rb = b.role;
  const [x, y] = ra <= rb ? [a, b] : [b, a];
  const tx = teamSide(x); const ty = teamSide(y);
  const same = tx === null || ty === null ? 'u' : tx === ty ? 's' : 'o';
  return { sport: a.sport, key: `${x.role}|${y.role}|${same}`, same };
}

// ---------------------------------------------------------------- the pricer

/**
 * Collapse legs inside one mutually-exclusive event (two or three outcomes of a
 * GAME event) to one synthetic leg by exact set logic.
 * @returns {{legs: object[], fixed: number|null}} fixed = 0/1 when the logic decides the combo outright.
 */
export function collapseExclusive(legs) {
  const byEvent = new Map();
  for (const l of legs) if (l.meta.role === 'W') (byEvent.get(l.meta.event) ?? byEvent.set(l.meta.event, []).get(l.meta.event)).push(l);
  const drop = new Set(); const added = [];
  for (const [, group] of byEvent) {
    if (group.length < 2) continue;
    const yes = group.filter((l) => l.side === 'yes'); const no = group.filter((l) => l.side === 'no');
    for (const l of group) drop.add(l);
    if (yes.length > 1) return { legs: [], fixed: 0, note: 'two yes legs of one exclusive event' };
    if (yes.length === 1) {
      if (no.some((l) => l.meta.ticker === yes[0].meta.ticker)) return { legs: [], fixed: 0, note: 'leg and its negation' };
      added.push({ ...yes[0], note: 'collapsed' }); // the other no-legs are implied
    } else {
      const pAny = group.reduce((s, l) => s + l.pYes, 0);
      added.push({ ...group[0], meta: { ...group[0].meta, suffix: group.map((l) => l.meta.suffix).join('+') }, side: 'no', pYes: Math.min(1, pAny), note: 'all-no collapsed', p: Math.max(0, 1 - pAny) });
    }
  }
  return { legs: [...legs.filter((l) => !drop.has(l)), ...added], fixed: null };
}

/**
 * @param {{ticker:string, event:string, side:'yes'|'no', pYes:number}[]} legs  coherent yes-probabilities
 * @param {{rho:(a:object,b:object)=>number}} model  pairwise yes-yes latent correlation
 */
export function priceCombo(legsIn, model, { samples = 4000 } = {}) {
  let legs = legsIn.map((l) => ({ ...l, meta: l.meta ?? legMeta(l.ticker, l.event), p: l.side === 'yes' ? l.pYes : 1 - l.pYes }));
  const collapsed = collapseExclusive(legs);
  if (collapsed.fixed !== null) return { fair: collapsed.fixed, clusters: [], note: collapsed.note, independentFair: collapsed.fixed, shrunk: false };
  legs = collapsed.legs.map((l) => ({ ...l, p: l.p ?? (l.side === 'yes' ? l.pYes : 1 - l.pYes) }));
  const clusters = new Map();
  for (const l of legs) (clusters.get(l.meta.game) ?? clusters.set(l.meta.game, []).get(l.meta.game)).push(l);
  let fair = 1; let independentFair = 1; let shrunk = false; const detail = [];
  for (const [game, cl] of clusters) {
    const indep = cl.reduce((a, l) => a * l.p, 1); independentFair *= indep;
    if (cl.length === 1 || model.scale === 0) { fair *= indep; continue; }
    const s = cl.map((l) => (l.side === 'yes' ? 1 : -1));
    const R = cl.map((a, i) => cl.map((b, j) => (i === j ? 1 : s[i] * s[j] * model.rho(a, b))));
    const b = cl.map((l) => PhiInv(Math.min(1 - 1e-9, Math.max(1e-9, l.p))));
    const r = mvnLowerProb(b, R, { samples }); shrunk ||= r.shrunk; fair *= r.p;
    detail.push({ game, n: cl.length, joint: r.p, independent: indep });
  }
  return { fair, independentFair, clusters: detail, shrunk, nLegs: legsIn.length };
}

/** Build a pair-correlation model from fitted classes {key: {rho, n}} with back-off and shrinkage. */
export function correlationModel(fit, { scale = 1, shrinkN = 100, defaultRho = 0 } = {}) {
  const lookup = (sport, key) => fit?.classes?.[`${sport}|${key}`] ?? fit?.classes?.[`*|${key}`] ?? null;
  return {
    scale,
    rho(a, b) {
      const { sport, key } = pairClass(a.meta, b.meta);
      const c = lookup(sport, key);
      let r = c ? c.rho * (c.n / (c.n + shrinkN)) : defaultRho;
      r *= scale;
      return Math.max(-0.95, Math.min(0.95, r));
    },
  };
}

/** Tetrachoric correlation from a 2x2 table [n11, n10, n01, n00] by grid-search maximum likelihood. */
export function tetrachoric([n11, n10, n01, n00]) {
  const n = n11 + n10 + n01 + n00;
  if (n < 10) return null;
  const pa = (n11 + n10) / n; const pb = (n11 + n01) / n;
  if (pa <= 0 || pa >= 1 || pb <= 0 || pb >= 1) return null;
  const ba = PhiInv(pa); const bb = PhiInv(pb);
  let best = 0; let bestLL = -Infinity;
  for (let r = -0.95; r <= 0.951; r += 0.05) {
    const p11 = Math.min(Math.max(mvnLowerProb([ba, bb], [[1, r], [r, 1]], { samples: 600 }).p, 1e-9), 1 - 1e-9);
    const p10 = Math.max(pa - p11, 1e-9); const p01 = Math.max(pb - p11, 1e-9); const p00 = Math.max(1 - p11 - p10 - p01, 1e-9);
    const ll = n11 * Math.log(p11) + n10 * Math.log(p10) + n01 * Math.log(p01) + n00 * Math.log(p00);
    if (ll > bestLL) { bestLL = ll; best = r; }
  }
  return best;
}

/** Newcombe-free simple Wilson interval. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n; const d = 1 + z * z / n; const c = p + z * z / (2 * n); const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}
