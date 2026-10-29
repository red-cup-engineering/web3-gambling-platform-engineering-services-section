import test from 'node:test';
import assert from 'node:assert/strict';
import { repriceLead, kalshiTeams } from '../src/generator-lag.mjs';

const tape = (pts) => pts.map(([s, p]) => ({ t: 1e6 + s * 1000, p }));

test('a market that moved before the feed shows a positive lead', () => {
  const r = repriceLead(1e6, tape([[-100, 0.4], [-80, 0.4], [-60, 0.4], [-10, 0.6], [60, 0.62], [100, 0.62]]));
  assert.equal(r.graded, true); assert.equal(r.leadMs, 10000);
});

test('a market that moved after the feed shows a negative lead', () => {
  const r = repriceLead(1e6, tape([[-100, 0.4], [-60, 0.4], [5, 0.41], [20, 0.6], [60, 0.6], [90, 0.6]]));
  assert.equal(r.leadMs, -20000);
});

test('small moves and missing tape are not graded', () => {
  assert.equal(repriceLead(1e6, tape([[-100, 0.4], [-60, 0.4], [60, 0.41], [90, 0.41]])).reason, 'unmoved');
  assert.equal(repriceLead(1e6, tape([[60, 0.5]])).reason, 'no-tape');
});

test('Kalshi event titles split into code and nickname', () => {
  assert.deepEqual(kalshiTeams('LA Rams vs PHI Eagles'), [{ code: 'LA', nick: 'Rams' }, { code: 'PHI', nick: 'Eagles' }]);
});
