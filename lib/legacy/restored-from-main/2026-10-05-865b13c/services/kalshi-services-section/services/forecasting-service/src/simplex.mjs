/**
 * A small dense two-phase simplex: maximize c.x subject to rows (<=, >=, =) b, x >= 0.
 * No dependency (the repo ships no LP solver). Sized for the coherence engine's
 * per-family programs (up to a few hundred rows and columns). Dantzig pricing,
 * falling back to Bland's rule once degenerate pivots stall.
 *
 * @param {{c: number[], rows: {a: Array<[number, number]>|number[], op: '<='|'>='|'=', b: number}[], maxIter?: number}} lp
 * @returns {{status: 'optimal'|'infeasible'|'unbounded'|'iteration-limit', objective: number|null, x: number[]|null}}
 */
export function solveLP({ c, rows, maxIter = 40000 }) {
  const n = c.length;
  const m = rows.length;
  const EPS = 1e-9;
  const norm = rows.map((r) => {
    const dense = new Float64Array(n);
    if (r.a.length && Array.isArray(r.a[0])) for (const [j, v] of r.a) dense[j] += v;
    else r.a.forEach((v, j) => { dense[j] = v; });
    let { op, b } = r;
    if (b < 0) { for (let j = 0; j < n; j += 1) dense[j] = -dense[j]; b = -b; op = op === '<=' ? '>=' : op === '>=' ? '<=' : '='; }
    return { dense, op, b };
  });
  const nSlack = norm.filter((r) => r.op !== '=').length;
  const nArt = norm.filter((r) => r.op !== '<=').length;
  const cols = n + nSlack + nArt;
  const T = Array.from({ length: m }, () => new Float64Array(cols + 1));
  const basis = new Int32Array(m);
  let s = n;
  let a = n + nSlack;
  const artStart = a;
  norm.forEach((r, i) => {
    T[i].set(r.dense, 0);
    T[i][cols] = r.b;
    if (r.op === '<=') { T[i][s] = 1; basis[i] = s; s += 1; }
    else if (r.op === '>=') { T[i][s] = -1; s += 1; T[i][a] = 1; basis[i] = a; a += 1; }
    else { T[i][a] = 1; basis[i] = a; a += 1; }
  });

  const run = (obj, allowed) => {
    const z = new Float64Array(cols + 1);
    for (let j = 0; j <= cols; j += 1) z[j] = obj[j] ?? 0;
    for (let i = 0; i < m; i += 1) {
      const f = z[basis[i]];
      if (Math.abs(f) > 0) for (let j = 0; j <= cols; j += 1) z[j] -= f * T[i][j];
    }
    let stall = 0;
    for (let it = 0; it < maxIter; it += 1) {
      let enter = -1;
      if (stall > 50) { for (let j = 0; j < allowed; j += 1) if (z[j] > EPS) { enter = j; break; } }
      else { let best = EPS; for (let j = 0; j < allowed; j += 1) if (z[j] > best) { best = z[j]; enter = j; } }
      if (enter < 0) return { status: 'optimal', z };
      let leave = -1;
      let ratio = Infinity;
      for (let i = 0; i < m; i += 1) {
        const v = T[i][enter];
        if (v > EPS) {
          const r = T[i][cols] / v;
          if (r < ratio - 1e-12 || (Math.abs(r - ratio) <= 1e-12 && leave >= 0 && basis[i] < basis[leave])) { ratio = r; leave = i; }
        }
      }
      if (leave < 0) return { status: 'unbounded', z };
      stall = ratio < 1e-12 ? stall + 1 : 0;
      const piv = T[leave][enter];
      const row = T[leave];
      for (let j = 0; j <= cols; j += 1) row[j] /= piv;
      for (let i = 0; i < m; i += 1) {
        if (i === leave) continue;
        const f = T[i][enter];
        if (Math.abs(f) > 1e-14) { const ri = T[i]; for (let j = 0; j <= cols; j += 1) ri[j] -= f * row[j]; }
      }
      const f = z[enter];
      for (let j = 0; j <= cols; j += 1) z[j] -= f * row[j];
      basis[leave] = enter;
    }
    return { status: 'iteration-limit', z };
  };

  if (nArt > 0) {
    const obj1 = new Float64Array(cols + 1);
    for (let j = artStart; j < cols; j += 1) obj1[j] = -1;
    const r1 = run(obj1, cols);
    if (r1.status === 'iteration-limit') return { status: 'iteration-limit', objective: null, x: null };
    let artSum = 0;
    for (let i = 0; i < m; i += 1) if (basis[i] >= artStart) artSum += T[i][cols];
    if (artSum > 1e-7) return { status: 'infeasible', objective: null, x: null };
    for (let i = 0; i < m; i += 1) {
      if (basis[i] < artStart) continue;
      let j = -1;
      for (let k = 0; k < artStart; k += 1) if (Math.abs(T[i][k]) > 1e-8) { j = k; break; }
      if (j < 0) continue;
      const piv = T[i][j];
      for (let k = 0; k <= cols; k += 1) T[i][k] /= piv;
      for (let r = 0; r < m; r += 1) {
        if (r === i) continue;
        const f = T[r][j];
        if (Math.abs(f) > 1e-14) for (let k = 0; k <= cols; k += 1) T[r][k] -= f * T[i][k];
      }
      basis[i] = j;
    }
  }
  const obj2 = new Float64Array(cols + 1);
  for (let j = 0; j < n; j += 1) obj2[j] = c[j];
  const r2 = run(obj2, artStart);
  if (r2.status !== 'optimal') return { status: r2.status, objective: null, x: null };
  const x = new Array(n).fill(0);
  for (let i = 0; i < m; i += 1) if (basis[i] < n) x[basis[i]] = T[i][cols];
  let objective = 0;
  for (let j = 0; j < n; j += 1) objective += c[j] * x[j];
  return { status: 'optimal', objective, x };
}
