import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A game of turns (sim/turns.js) runs in the browser, like sim/scenario.js. Here: no frames, the data files read from disk,
// and workers that only record their jobs.
globalThis.location = new URL('http://localhost/');
globalThis.requestAnimationFrame = () => 0;
globalThis.fetch = async url => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(url), 'utf8')) });
class FakeWorker {
  static all = [];
  constructor(url) { this.url = String(url); this.jobs = []; FakeWorker.all.push(this); }
  postMessage(job) { this.jobs.push(job); }
}
globalThis.Worker = FakeWorker;
const { scenario, simClock } = await import('../meridian-city/sim/scenario.js');
const { createGame } = await import('../meridian-city/sim/turns.js');
const { createPolicyStore } = await import('../meridian-city/policy/store.js');
const { POLICIES } = await import('../meridian-city/policy/policies.js');

test('three decades: each turn enacts its policies for good, and the forecast runs a decade further', () => {
  const store = createPolicyStore({ policies: POLICIES.slice() }), game = createGame({ store });
  const library = () => store.policies.map(p => p.id);
  const play = (...ids) => { for (const id of ids) store.place(id, store.compatibleSlots(id).find(s => !store.getState().draft[s])); store.apply(); };

  play('hiring-subsidy', 'property-tax-adjustment');
  assert.deepEqual(game.cardIds(), ['hiring-subsidy', 'property-tax-adjustment']);
  assert.deepEqual(game.starts(), {}, 'the first decade starts in year 0');
  game.endTurn();
  assert.deepEqual(game.get().enacted.map(e => [e.id, e.start]), [['hiring-subsidy', 0], ['property-tax-adjustment', 0]]);
  assert.ok(!library().includes('hiring-subsidy') && !library().includes('property-tax-adjustment'), 'gone from the library');
  assert.ok(Object.values(store.getState().applied).every(v => v === null), 'the next decade starts with empty slots');
  assert.equal(store.getPolicy('hiring-subsidy').title, POLICIES.find(p => p.id === 'hiring-subsidy').title, 'still known, for its title');
  assert.deepEqual(game.cardIds(), ['hiring-subsidy', 'property-tax-adjustment'], 'still in force');
  assert.deepEqual([game.get().turn, game.get().from, game.get().to], [1, 10, 20]);
  assert.equal(scenario.get().years, 20);
  assert.deepEqual([simClock.get().steps, simClock.get().step], [20, 10], 'the clock waits at the start of the new decade');

  play('housing-construction-subsidy');
  assert.deepEqual(game.starts(), { 'housing-construction-subsidy': 10 });
  game.endTurn();
  game.endTurn(); // a decade with no new policy
  assert.equal(game.get().over, true);
  assert.equal(scenario.get().years, 30);
  assert.deepEqual(game.starts(), { 'housing-construction-subsidy': 10 });
  assert.deepEqual(game.cardIds(), ['hiring-subsidy', 'property-tax-adjustment', 'housing-construction-subsidy']);
  play('small-business-support-grant');
  assert.ok(!game.cardIds().includes('small-business-support-grant'), 'nothing more is enacted once the game is over');
  game.endTurn();
  assert.equal(game.get().enacted.length, 3);
});

test('an enacted policy leaves every scenario, not just the one that ran', () => {
  const store = createPolicyStore({ policies: POLICIES.slice() }), game = createGame({ store });
  const first = store.getState().scenarioId;
  store.place('hiring-subsidy', 'employment-1');
  store.addScenario('Plan B');
  store.place('hiring-subsidy', 'employment-1');
  store.place('property-tax-adjustment', 'taxation-1');
  store.selectScenario(first);
  store.apply(); // saves both scenarios and runs the first
  game.endTurn();
  store.selectScenario(store.getState().scenarios.find(sc => sc.name === 'Plan B').id);
  assert.deepEqual(Object.values(store.getState().draft).filter(Boolean), ['property-tax-adjustment']);
  store.revert();
  assert.deepEqual(store.getState().scenarios.map(sc => sc.filled), [0, 1], 'and stays gone after a revert');
});

test('an enacted policy can\'t be applied again, so it never runs twice or moves to a later decade', () => {
  const store = createPolicyStore({ policies: POLICIES.slice() }), game = createGame({ store });
  store.place('housing-construction-subsidy', 'housing-1');
  store.apply();
  game.endTurn();
  assert.equal(store.place('housing-construction-subsidy', 'housing-1'), null, 'the store refuses it, as the demo button would try');
  assert.deepEqual(store.compatibleSlots('housing-construction-subsidy'), []);

  // and the game ignores it even if a store did let it through
  let applied = { 'housing-1': 'hiring-subsidy' };
  const leaky = { getState: () => ({ applied }), retire: () => {} }, g = createGame({ store: leaky });
  g.endTurn();
  applied = { 'housing-1': 'hiring-subsidy', 'housing-2': 'property-tax-adjustment' };
  assert.deepEqual(g.cardIds(), ['hiring-subsidy', 'property-tax-adjustment']);
  assert.deepEqual(g.starts(), { 'property-tax-adjustment': 10 }, 'the enacted card keeps its start in year 0');
});
