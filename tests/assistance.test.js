// The prompt-only economic and social levers: rental assistance and monthly cash paid to households, and job training. No
// catalog card uses them; a prompted card can. Each moves its own outcome the way the evidence says, and costs what it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../shared/luti/model.js';
import { runCombined } from '../shared/combined.js';
import { zones, assumptions, baselines, cards } from './data.js';

const model = createModel(assumptions, baselines), mid = model.midParams();
const card = levers => ({ id: 't', title: 't', summary: 's', category: 'housing', icon: 'house', decider: { body: 'Town Council', how: [] },
  params: [], levers, timing: { delayQuarters: 0, phaseInQuarters: 1 }, tradeoffs: { pros: ['p'], cons: ['c'] } });
const none = runCombined([], {}, zones, assumptions, baselines), last = r => r.timeline.at(-1).metrics, m0 = last(none);
const combined = levers => last(runCombined([card(levers)], {}, zones, assumptions, baselines, none));

test('rental assistance and cash: the most burdened non-student renters, fewer priced out, cost = households x monthly x 12', () => {
  const rent = combined([{ lever: 'assistance.rentHouseholds', value: 1000 }, { lever: 'assistance.rentMonthly', value: 1200 }]);
  assert.ok(rent.rentBurden < m0.rentBurden - 0.02, `burden ${rent.rentBurden} vs ${m0.rentBurden}`);
  assert.ok(rent.pricedOut < m0.pricedOut, 'fewer priced out');
  assert.equal(m0.netFiscal - rent.netFiscal, 1000 * 1200 * 12);
  const cash = combined([{ lever: 'assistance.cashHouseholds', value: 500 }, { lever: 'assistance.cashMonthly', value: 500 }]);
  assert.ok(cash.pricedOut < m0.pricedOut, 'cash keeps some households in town');
  assert.equal(m0.netFiscal - cash.netFiscal, 500 * 500 * 12);
  assert.equal(rent.medianRent, m0.medianRent, 'a programme this size leaves market rent alone');
});

test('job training: trainees earn more from the year after, so fewer are priced out; each costs about the Year Up figure', () => {
  const trained = combined([{ lever: 'workforce.trainees', value: 300 }]);
  assert.ok(trained.pricedOut < m0.pricedOut, `priced out ${trained.pricedOut} vs ${m0.pricedOut}`);
  assert.ok(trained.rentBurden < m0.rentBurden, 'trainees pay a smaller share of income in rent');
  const r = model.simulate(mid, [{ id: 't', timing: { delayQuarters: 0, phaseInQuarters: 1 }, levers: [{ lever: 'workforce.trainees', value: 300 }] }], { seedEvents: false }).series.at(-1);
  assert.ok(Math.abs(r.programCost / r.priceIndex / (300 * 23135) - 1) < 0.05, `cost ${r.programCost}`);
});

test('no catalog card uses the prompt-only levers, and the no-policy run has none of them', () => {
  for (const c of cards) assert.ok(!(c.levers ?? []).some(l => /^assistance\.|^workforce\./.test(l.lever)), c.id);
  assert.equal(model.simulate(mid, [], { seedEvents: false }).series.at(-1).programCost, 0);
});
