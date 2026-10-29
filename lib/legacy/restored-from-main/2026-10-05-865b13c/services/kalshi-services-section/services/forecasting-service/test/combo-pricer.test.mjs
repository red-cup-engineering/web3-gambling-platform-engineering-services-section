import test from 'node:test';
import assert from 'node:assert/strict';
import { Phi, PhiInv, mvnLowerProb, legMeta, teamSide, priceCombo, correlationModel, tetrachoric, collapseExclusive, wilson, isComboTicker, rfqSize } from '../src/combo-pricer.mjs';

const near = (a, b, e = 0.01) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('normal cdf and inverse', () => { near(Phi(1.96), 0.975, 1e-4); near(PhiInv(0.975), 1.96, 1e-4); near(PhiInv(Phi(-2.3)), -2.3, 1e-6); });

test('bivariate orthant: rho .5 gives 1/3, rho 0 gives 1/4', () => {
  near(mvnLowerProb([0, 0], [[1, 0.5], [0.5, 1]]).p, 1 / 3, 0.005);
  near(mvnLowerProb([0, 0], [[1, 0], [0, 1]]).p, 0.25, 0.005);
});

test('leg roles and team side', () => {
  const m = legMeta('KXMLBHIT-26OCT032030SDMIL-MILCYELICH22-1');
  assert.equal(m.sport, 'MLB'); assert.equal(m.role, 'P'); assert.equal(teamSide(m), 1);
  assert.equal(legMeta('KXNFLGAME-26OCT04DALHOU-DAL').role, 'W');
  assert.equal(legMeta('KXNFLTOTAL-26OCT04DALHOU-45').role, 'T');
  assert.equal(legMeta('KXNFLSPREAD-26OCT04DALHOU-HOU3').role, 'S');
  assert.ok(isComboTicker('KXMVECROSSCATEGORY-S1-ABC'));
  assert.equal(rfqSize({ target_cost_dollars: '5.0000' }), 5);
});

const leg = (ticker, side, pYes) => ({ ticker, event: ticker.split('-').slice(0, 2).join('-'), side, pYes });

test('legs from distinct games multiply; no side flips to 1-p', () => {
  const r = priceCombo([leg('KXNFLGAME-26OCT04DALHOU-DAL', 'yes', 0.6), leg('KXNFLGAME-26OCT04DENSF-SF', 'no', 0.3)], correlationModel({ classes: {} }));
  near(r.fair, 0.6 * 0.7, 1e-9);
});

test('same-team spread and winner are strongly positively correlated; opposite sign flips', () => {
  const model = correlationModel({ classes: { '*|S|W|s': { rho: 0.9, n: 5000 } } }, { shrinkN: 0 });
  const ind = 0.6 * 0.55;
  const both = priceCombo([leg('KXNFLGAME-26OCT04DALHOU-DAL', 'yes', 0.6), leg('KXNFLSPREAD-26OCT04DALHOU-DAL3', 'yes', 0.55)], model);
  assert.ok(both.fair > ind + 0.1, `${both.fair}`);
  const flipped = priceCombo([leg('KXNFLGAME-26OCT04DALHOU-DAL', 'yes', 0.6), leg('KXNFLSPREAD-26OCT04DALHOU-DAL3', 'no', 0.55)], model);
  assert.ok(flipped.fair < 0.6 * 0.45 - 0.1, `${flipped.fair}`);
  near(priceCombo([leg('KXNFLGAME-26OCT04DALHOU-DAL', 'yes', 0.6), leg('KXNFLSPREAD-26OCT04DALHOU-DAL3', 'yes', 0.55)], correlationModel({ classes: {} })).fair, ind, 0.01);
});

test('exclusive event: two yes legs are impossible; all-no is 1 - sum', () => {
  const model = correlationModel({ classes: {} });
  assert.equal(priceCombo([leg('KXNFLGAME-26OCT04DALHOU-DAL', 'yes', 0.6), leg('KXNFLGAME-26OCT04DALHOU-HOU', 'yes', 0.4)], model).fair, 0);
  near(priceCombo([leg('KXUEFANLGAME-26OCT04KOSAUT-KOS', 'no', 0.2), leg('KXUEFANLGAME-26OCT04KOSAUT-AUT', 'no', 0.5)], model).fair, 0.3, 1e-9);
  assert.equal(collapseExclusive([]).fixed, null);
});

test('tetrachoric recovers a planted correlation', () => {
  // exact cell probabilities for rho = .5, margins .5/.5 -> p11 = 1/3
  const n = 100000; const p11 = 1 / 3;
  const rho = tetrachoric([p11 * n, (0.5 - p11) * n, (0.5 - p11) * n, (1 - 2 * 0.5 + p11) * n]);
  near(rho, 0.5, 0.06);
});

test('wilson interval brackets the estimate', () => { const [lo, hi] = wilson(30, 100); assert.ok(lo < 0.3 && hi > 0.3); });
