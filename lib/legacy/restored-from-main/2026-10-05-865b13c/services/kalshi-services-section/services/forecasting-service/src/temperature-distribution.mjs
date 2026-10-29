/**
 * The house's probability that a station's reported daily extreme temperature
 * lands in a Kalshi bracket. Pure functions only.
 *
 * The settled value is the NWS Daily Climate Report's whole-degree
 * Fahrenheit maximum (or minimum), K. The house reads K as a location-scale
 * Student-t, centred on the National Blend of Models' TXN guidance plus a
 * fitted station bias, with a scale built from NBM's own spread (XND), a
 * floor, and growth with lead time, and integer outcomes taken by
 * continuity: P(K = k) = F(k + 1/2) - F(k - 1/2). The t's tails carry the
 * fronts and busts a normal error model prices too thin, which matters most
 * for the longshot brackets. Parameters are fitted by maximum likelihood on
 * archived NBM guidance against archived climate reports
 * (content/config/temperature-markets.json records the fit and its window).
 *
 * Kalshi's brackets on whole degrees: `less X` settles yes when K <= X - 1,
 * `between a b` when a <= K <= b, `greater X` when K >= X + 1 (checked
 * against 12,684 settled markets, 2026-08-05..10-02).
 */

// Lanczos log-gamma (g = 7, n = 9), relative error < 1e-13 on the reals used here.
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function logGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued fraction for the incomplete beta (modified Lentz).
function betaContinuedFraction(a, b, x) {
  const tiny = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return h;
}

/** The regularized incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Student-t CDF with `nu` degrees of freedom (nu = Infinity is the standard normal). */
export function studentTCdf(t, nu) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (!Number.isFinite(nu)) return 0.5 * (1 + erf(t / Math.SQRT2));
  const tail = 0.5 * regularizedIncompleteBeta(nu / (nu + t * t), nu / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7; only the nu = Infinity limit uses it.
  const sign = x < 0 ? -1 : 1, ax = Math.abs(x), t = 1 / (1 + 0.3275911 * ax);
  return sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax));
}

/**
 * The fitted scale for one forecast: NBM spread scaled, combined with a
 * floor that grows past twelve hours of lead, and the station bias's own
 * uncertainty (biases drift with the season), all in quadrature.
 * @param {{xnd: number, leadHours: number}} guidance
 * @param {{spreadScale: number, scaleFloor: number, scaleGrowthPerDay: number, biasUncertainty?: number}} model
 */
export function forecastScale({ xnd, leadHours }, { spreadScale, scaleFloor, scaleGrowthPerDay, biasUncertainty = 0 }) {
  const floor = scaleFloor + scaleGrowthPerDay * Math.max(leadHours - 12, 0) / 24;
  return Math.sqrt((spreadScale * xnd) ** 2 + floor ** 2 + biasUncertainty ** 2);
}

/** The continuous bounds a whole-degree bracket covers. */
export function bracketBounds({ strikeType, floorStrike, capStrike }) {
  if (strikeType === 'less') return [-Infinity, capStrike - 0.5];
  if (strikeType === 'greater') return [floorStrike + 0.5, Infinity];
  if (strikeType === 'between') return [floorStrike - 0.5, capStrike + 0.5];
  throw new TypeError(`temperature-distribution: unknown strikeType ${JSON.stringify(strikeType)}`);
}

/** Whether a whole-degree reading settles the bracket yes. */
export function bracketSettlesYes(bracket, k) {
  const [lo, hi] = bracketBounds(bracket);
  return k > lo && k < hi;
}

/**
 * P(bracket settles yes) under the location-scale t, optionally conditioned
 * on an extreme already observed: the day's maximum cannot end below a
 * reading already taken (nor its minimum above one), so mass on the far side
 * of `observedFloor` (a max) or `observedCeiling` (a min) is removed and the
 * rest renormalized.
 * @param {{strikeType: string, floorStrike?: number, capStrike?: number}} bracket
 * @param {{mean: number, scale: number, nu: number, observedFloor?: number, observedCeiling?: number}} distribution
 */
export function bracketProbability(bracket, { mean, scale, nu, observedFloor = -Infinity, observedCeiling = Infinity }) {
  const F = (x) => studentTCdf((x - mean) / scale, nu);
  let [lo, hi] = bracketBounds(bracket);
  const support = [Math.max(-Infinity, observedFloor - 0.5), Math.min(Infinity, observedCeiling + 0.5)];
  lo = Math.max(lo, support[0]); hi = Math.min(hi, support[1]);
  if (hi <= lo) return 0;
  const mass = F(support[1]) - F(support[0]);
  if (mass <= 1e-12) return lo <= mean && mean <= hi ? 1 : 0;
  return Math.min(1, Math.max(0, (F(hi) - F(lo)) / mass));
}
