// The prompt-only economic and social levers: rental assistance and monthly cash paid to households, and job training. No
// catalog card uses them; a prompted card can. Each moves its own outcome the way the evidence says, and costs what it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../shared/luti/model.js';
import { buildSchedule } from '../shared/luti/levers.js';
import { runCombined, runModels } from '../shared/combined.js';
import { zones, assumptions, baselines, cards } from './data.js';

const byId = id => cards.find(c => c.id === id);

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

test('a card may list a payment lever twice: the households and the money paid stay in step', () => {
  const twice = buildSchedule([{ id: 'two', timing: { delayQuarters: 0, phaseInQuarters: 1 },
    levers: [{ lever: 'assistance.rentHouseholds', value: 1000 }, { lever: 'assistance.rentHouseholds', value: 1000 }, { lever: 'assistance.rentMonthly', value: 500 }] }], []);
  const L = twice(0);
  assert.equal(L['assistance.rentHouseholds'], 2000);
  assert.equal(L['assistance.rentPaid'], 2000 * 500, 'every household listed is paid for');
});

test('a programme that starts late in a year serves that share of the year, and costs that much', () => {
  const late = card([{ lever: 'assistance.cashHouseholds', value: 1000 }, { lever: 'assistance.cashMonthly', value: 500 }]);
  late.timing = { delayQuarters: 3, phaseInQuarters: 1 }; // the last quarter of year 1
  const run = runModels([late], {}, zones, assumptions, baselines);
  assert.ok(Math.abs(run.inputs.help[1].cashHouseholds - 250) < 1, `year 1 serves a quarter of the households: ${run.inputs.help[1].cashHouseholds}`);
  assert.equal(run.inputs.help[1].cashMonthly, 500, 'each household it does serve gets the full amount');
  assert.equal(run.inputs.help[2].cashHouseholds, 1000, 'the next full year serves all of them');
});

test('an affordable-housing requirement covers the homes the zone rules build, not just CH-LUTI’s own', () => {
  const pct = card([{ lever: 'housing.inclusionaryPct', value: 15 }]);
  const alone = last(runCombined([pct], {}, zones, assumptions, baselines, none)).affordableHomes;
  const withParcels = last(runCombined([pct, byId('corridor-midrise')], {}, zones, assumptions, baselines, none)).affordableHomes;
  assert.ok(withParcels > alone, `parcels add restricted homes: ${withParcels} vs ${alone}`);
});
