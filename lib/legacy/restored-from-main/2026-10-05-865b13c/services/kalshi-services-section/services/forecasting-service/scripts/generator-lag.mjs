#!/usr/bin/env node
/**
 * Generator-admission lag recorder and grader (issue #246 E2: who sees the generator first).  READ-ONLY.
 *
 *   node scripts/generator-lag.mjs record [--sport nfl] [--poll 1000] [--hours 12]
 *   node scripts/generator-lag.mjs grade  [--day 2026-10-04]
 *
 * record: one clock, two tapes. The Kalshi WebSocket (signed handshake, `trade` and `ticker` channels) for
 * every open game-winner market and anytime-TD market of today's games, and ESPN's public scoreboard polled
 * every --poll ms, logging each score or last-play change with its first-seen time. Both under
 * ~/.local/state/561-group/settlements/forecasting-service/generator-lag/<day>/ as kalshi.jsonl, feed.jsonl.
 * It never sends an order or an RFQ.
 *
 * grade: for each score change, src/generator-lag.mjs repriceLead on the scoring game's winner market.
 * lead > 0 means Kalshi had repriced before the free feed showed the score: a maker quoting off that feed
 * is picked off for `lead` ms on every scoring play.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createKalshiClient, kalshiCredentials, authHeaders } from '../../../src/client.mjs';
import { repriceLead, kalshiTeams } from '../src/generator-lag.mjs';

const args = process.argv.slice(2); const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const log = (...a) => console.error(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = opt('day', new Date().toISOString().slice(0, 10));
const dir = join(process.env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service', 'generator-lag', day);
const recordDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'records', '2026-10-04-generator-lag');
const SPORTS = { nfl: { espn: 'football/nfl', game: 'KXNFLGAME', props: ['KXNFLTD'] } };
const WS = { host: 'wss://api.elections.kalshi.com', path: '/trade-api/ws/v2' };

async function games(client, sport) {
  const s = SPORTS[sport];
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${s.espn}/scoreboard`)).json();
  const ev = await client.call('GET', '/events', { query: { series_ticker: s.game, status: 'open', limit: 100 }, signed: false });
  const out = [];
  for (const e of sb.events ?? []) {
    const c = e.competitions[0]; const nicks = c.competitors.map((t) => t.team.name);
    const k = (ev.events ?? []).find((x) => { const t = kalshiTeams(x.title); return t.every((y) => nicks.includes(y.nick)); });
    if (!k) { log('unmatched', e.shortName); continue; }
    if (Date.parse(e.date) - Date.now() > 20 * 3600e3 || c.status.type.completed) continue;
    out.push({ espnId: e.id, name: e.shortName, start: e.date, event: k.event_ticker, gameCode: k.event_ticker.split('-')[1] });
  }
  return out;
}

async function marketsFor(client, sport, gs) {
  const tickers = [];
  for (const g of gs) {
    for (const series of [SPORTS[sport].game, ...SPORTS[sport].props]) {
      try {
        const p = await client.call('GET', `/events/${series}-${g.gameCode}`, { query: { with_nested_markets: true }, signed: false });
        for (const m of p?.event?.markets ?? p?.markets ?? []) if (m.status === 'active') tickers.push(m.ticker);
      } catch (e) { log('event', series, g.gameCode, e.message); }
      await sleep(150);
    }
  }
  return tickers;
}

async function record() {
  const sport = opt('sport', 'nfl'); const poll = Number(opt('poll', 1000)); const until = Date.now() + Number(opt('hours', 12)) * 3600e3;
  mkdirSync(dir, { recursive: true });
  const client = createKalshiClient(); const creds = kalshiCredentials();
  const gs = await games(client, sport); const tickers = await marketsFor(client, sport, gs);
  writeFileSync(join(dir, 'games.json'), JSON.stringify({ sport, games: gs, tickers }, null, 1));
  log('games', gs.length, 'markets', tickers.length);
  const kfile = join(dir, 'kalshi.jsonl'); const ffile = join(dir, 'feed.jsonl');

  let ws; let wsMsgs = 0;
  const connect = () => {
    const h = authHeaders({ ...creds, method: 'GET', path: WS.path }); delete h.accept; delete h['content-type'];
    ws = new WebSocket(WS.host + WS.path, { headers: h });
    ws.onopen = () => { log('ws open'); ws.send(JSON.stringify({ id: 1, cmd: 'subscribe', params: { channels: ['trade', 'ticker'], market_tickers: tickers } })); };
    ws.onmessage = (m) => { wsMsgs += 1; appendFileSync(kfile, `{"r":${Date.now()},"m":${m.data}}\n`); };
    ws.onerror = (e) => log('ws error', e.message ?? '');
    ws.onclose = (e) => { log('ws close', e.code, e.reason); if (Date.now() < until) setTimeout(connect, 2000); };
  };
  connect();

  const last = new Map(); let polls = 0;
  while (Date.now() < until) {
    const t0 = Date.now();
    try {
      const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${SPORTS[sport].espn}/scoreboard`, { cache: 'no-store' })).json();
      const r = Date.now();
      for (const e of sb.events ?? []) {
        const g = gs.find((x) => x.espnId === e.id); if (!g) continue;
        const c = e.competitions[0]; const lp = c.situation?.lastPlay;
        const state = { scores: Object.fromEntries(c.competitors.map((t) => [t.team.name, Number(t.score)])), play: lp?.id ?? null, status: c.status.type.name };
        const key = JSON.stringify(state);
        if (last.get(e.id) !== key) {
          const prev = last.get(e.id) ? JSON.parse(last.get(e.id)) : null; last.set(e.id, key);
          const scored = prev && JSON.stringify(prev.scores) !== JSON.stringify(state.scores);
          appendFileSync(ffile, JSON.stringify({ r, rtt: r - t0, espnId: e.id, event: g.event, ...state, scored, prevScores: prev?.scores ?? null, text: lp?.text ?? null, playType: lp?.type?.text ?? null, clock: c.status.displayClock, period: c.status.period }) + '\n');
        }
      }
      polls += 1; if (polls % 300 === 0) log('polls', polls, 'ws msgs', wsMsgs);
    } catch (e) { log('feed', e.message); }
    await sleep(Math.max(100, poll - (Date.now() - t0)));
  }
  ws?.close(); log('done');
}

function grade() {
  const trades = new Map();
  for (const line of readFileSync(join(dir, 'kalshi.jsonl'), 'utf8').split('\n')) {
    if (!line) continue; let x; try { x = JSON.parse(line); } catch { continue; }
    if (x.m?.type !== 'trade') continue; const m = x.m.msg;
    (trades.get(m.market_ticker) ?? trades.set(m.market_ticker, []).get(m.market_ticker)).push({ r: x.r, p: Number(m.yes_price_dollars) });
  }
  const rows = [];
  for (const line of existsSync(join(dir, 'feed.jsonl')) ? readFileSync(join(dir, 'feed.jsonl'), 'utf8').split('\n') : []) {
    if (!line) continue; const f = JSON.parse(line); if (!f.scored) continue;
    const scorer = Object.keys(f.scores).find((k) => f.scores[k] !== f.prevScores[k]);
    // every recorded market of the game (both winners, every anytime-TD) on our receive clock; the largest graded move wins
    const code = f.event.split('-')[1];
    const mk = [...trades.keys()].filter((t) => t.split('-')[1] === code);
    const best = mk.map((t) => ({ t, res: repriceLead(f.r, trades.get(t).map((x) => ({ t: x.r, p: x.p }))) })).filter((x) => x.res.graded).sort((a, b) => Math.abs(b.res.move) - Math.abs(a.res.move))[0];
    rows.push({ event: f.event, at: new Date(f.r).toISOString(), scorer, points: f.scores[scorer] - f.prevScores[scorer], playType: f.playType, text: f.text, market: best?.t ?? null, ...(best?.res ?? { graded: false }) });
  }
  const graded = rows.filter((r) => r.graded); const leads = graded.map((r) => r.leadMs).sort((a, b) => a - b);
  const q = (p) => (leads.length ? leads[Math.min(leads.length - 1, Math.floor(p * leads.length))] : null);
  const report = { day, scoringChanges: rows.length, graded: graded.length, leadMs: { p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.9) }, marketFirstFrac: graded.length ? graded.filter((r) => r.leadMs > 0).length / graded.length : null };
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, `grade-${day}.json`), JSON.stringify({ report, rows }, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

if (cmd === 'record') await record();
else if (cmd === 'grade') grade();
else { console.error('usage: generator-lag.mjs record|grade'); process.exit(2); }
