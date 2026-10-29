import test from 'node:test';
import assert from 'node:assert/strict';
import { score, payouts, denominatorBounds, comboPool, comboPrintFees, isSportsProp, isUncorrelatedNfl } from '../src/combo-incentive.mjs';

test('score is prod(1+F)-1 and rewards breadth', () => {
  assert.equal(score([0.5]), 0.5);
  assert.ok(Math.abs(score([0.1, 0.1, 0.1]) - 0.331) < 1e-12);
});

test('payouts drop sub-threshold scorers and split the pool by score', () => {
  const p = payouts(100, [[0.5, 0.5], [0.5, 0.495], [0, 0.005]]);
  assert.equal(p[2], 0);
  assert.ok(Math.abs(p[0] + p[1] - 100) < 1e-9 && p[0] > p[1]);
});

test('the denominator interval contains every symmetric-K structure', () => {
  for (const n of [1, 2, 4, 6]) {
    const d = denominatorBounds(n, 3);
    assert.ok(d.lo - 1e-9 <= d.point && d.point <= d.hi + 1e-9);
    assert.equal(denominatorBounds(n, 1).point, d.hi);
  }
});

test('legs, fees and pool follow the program rules', () => {
  assert.ok(isSportsProp('KXNFLTD-26OCT04INDWAS-INDJTAYLOR28-1'));
  assert.ok(!isSportsProp('KXNFLGAME-26OCT04INDWAS-IND'));
  assert.ok(!isSportsProp('KXNFLSPREAD-26OCT04INDWAS-IND3'));
  assert.ok(isUncorrelatedNfl(['KXNFLGAME-26OCT04ARINYG-NYG', 'KXNFLGAME-26OCT04KCLV-LV']));
  assert.equal(comboPrintFees(0.5, 100, ['KXNFLGAME-26OCT04ARINYG-NYG', 'KXNFLGAME-26OCT04KCLV-LV']).maker, 0);
  const legs = ['KXNFLTD-26OCT04INDWAS-INDJTAYLOR28-1', 'KXNFLGAME-26OCT04INDWAS-IND'];
  assert.ok(Math.abs(comboPrintFees(0.5, 100, legs).total - 2.625) < 1e-9);
  assert.equal(comboPool(10, legs).pool, 1.25);
});
