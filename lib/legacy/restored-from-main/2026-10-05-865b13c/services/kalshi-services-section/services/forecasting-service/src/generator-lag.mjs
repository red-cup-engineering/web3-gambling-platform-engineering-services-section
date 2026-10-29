/**
 * Generator-admission lag, pure: for each admitted generator (a score change seen on a public feed at
 * time T_feed) find when the Kalshi book had already moved, from the trade tape of the game's winner market.
 *
 *   pre   = median trade price in [T_feed - preFrom, T_feed - preTo]
 *   post  = median trade price in [T_feed + postFrom, T_feed + postTo]
 *   T_k   = first trade in [T_feed - preTo, T_feed + postTo] that has moved at least half of (post - pre) from pre
 *   lead  = T_feed - T_k      (> 0: the market repriced before our feed admitted the generator)
 *
 * Generators whose |post - pre| is below `minMove` are reported as unmoved, not graded.
 */

export const LAG_WINDOWS = { preFrom: 120e3, preTo: 45e3, postFrom: 45e3, postTo: 120e3, minMove: 0.03 };

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * @param {number} tFeed ms the feed showed the generator
 * @param {{t: number, p: number}[]} trades yes prices of one market, any order
 */
export function repriceLead(tFeed, trades, w = LAG_WINDOWS) {
  const inWin = (a, b) => trades.filter((x) => x.t >= tFeed + a && x.t <= tFeed + b);
  const pre = median(inWin(-w.preFrom, -w.preTo).map((x) => x.p));
  const post = median(inWin(w.postFrom, w.postTo).map((x) => x.p));
  if (pre === null || post === null) return { graded: false, reason: 'no-tape', pre, post };
  const move = post - pre;
  if (Math.abs(move) < w.minMove) return { graded: false, reason: 'unmoved', pre, post, move };
  const path = inWin(-w.preTo, w.postTo).sort((a, b) => a.t - b.t);
  const hit = path.find((x) => (x.p - pre) / move >= 0.5);
  if (!hit) return { graded: false, reason: 'no-crossing', pre, post, move };
  return { graded: true, pre, post, move, tMarket: hit.t, leadMs: tFeed - hit.t };
}

/** Kalshi game-event nickname map from event titles like "IND Colts vs WAS Commanders". */
export function kalshiTeams(title) {
  const [a, b] = title.split(/\s+vs\.?\s+/u);
  const nick = (s) => s.trim().split(/\s+/u).slice(1).join(' ');
  const code = (s) => s.trim().split(/\s+/u)[0];
  return [{ code: code(a), nick: nick(a) }, { code: code(b), nick: nick(b) }];
}
