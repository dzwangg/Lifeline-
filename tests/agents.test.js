import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageRuns, homesByYear, modelZone, simulate } from '../shared/agents.js';
import { runModels } from '../shared/combined.js';
import { runScenario } from '../shared/sim.js';
import { cards, stub, zones, assumptions, baselines } from './data.js';

const ramp = n => ({ homes: Array.from({ length: 11 }, (_, t) => ({ downtown: 0, campus: 0, edge: n * Math.min(t / 5, 1), corridor: 0 })), households: Array(11).fill(0) });
const growth = runModels([], {}, zones, assumptions, baselines).inputs; // CH-LUTI's no-policy homes and households

test('household model is deterministic', () => {
  assert.deepEqual(simulate(ramp(509), assumptions, baselines), simulate(ramp(509), assumptions, baselines));
  assert.notDeepEqual(simulate(ramp(509), assumptions, baselines, 1).agents, simulate(ramp(509), assumptions, baselines, 2).agents);
});

test('year 0 is calibrated to the ACS median rent and mean commute, and the observed 15-501 peak', () => {
  for (const inputs of [null, ramp(2000), growth]) {
    const [y0] = simulate(inputs, assumptions, baselines).years;
    assert.equal(y0.medianRent, baselines.medianGrossRent.value);
    assert.equal(y0.commute, baselines.meanCommuteMin.value);
    assert.ok(Math.abs(y0.roadRatio - assumptions.roadPeakVolume.value / assumptions.roadCapacity.value) < 1e-9);
  }
});

test('the zone rules\' homes go to the household zone of their parcel; corridor parcels are their own zone', () => {
  const result = runScenario([stub], {}, zones, assumptions, baselines), homes = homesByYear(result, zones, assumptions);
  result.timeline.forEach((t, i) => {
    const added = Object.values(homes[i]).reduce((a, b) => a + b);
    assert.ok(Math.abs(added - (t.metrics.housingUnits - result.timeline[0].metrics.housingUnits)) <= 1, `year ${i}`);
  });
  assert.equal(homes[10].downtown, 0); // the stub only builds in map_edge parcels
  assert.ok(homes[10].corridor > 0 && homes[10].edge > 0, 'map_edge parcels by the corridor count as corridor, the rest as edge');
  assert.equal(modelZone({ tags: ['map_edge', 'corridor'] }), 'corridor');
});

test('corridor homes add no 15-501 trip, so they raise the commute less than the same edge homes', () => {
  const at = zone => ({ homes: Array.from({ length: 11 }, (_, t) => ({ downtown: 0, campus: 0, edge: 0, corridor: 0, [zone]: 2000 * Math.min(t / 5, 1) })), households: Array.from({ length: 11 }, (_, t) => 2000 * Math.min(t / 5, 1)) });
  const commute = zone => simulate(at(zone), assumptions, baselines).years[10].commute;
  assert.ok(commute('corridor') < commute('edge'), `${commute('corridor')} vs ${commute('edge')}`);
});

test('newcomers bring the town up to CH-LUTI\'s household count, either side of a half', () => {
  // Plenty of spare homes, so year-1 arrivals are the target alone: households added / agentScale simulated households.
  const units = { ...assumptions.agentUnits, value: { downtown: 200, campus: 200, edge: 200, corridor: 0 } };
  for (const expected of [1.3, 1.7]) {
    const inputs = { homes: Array(11).fill({ downtown: 0, campus: 0, edge: 0, corridor: 0 }), households: Array(11).fill(expected * assumptions.agentScale.value) };
    let arrivals = 0;
    for (let seed = 1; seed <= 400; seed++) arrivals += simulate(inputs, { ...assumptions, agentUnits: units }, baselines, seed).agents.filter(a => a.joined === 1).length;
    assert.ok(Math.abs(arrivals / 400 - expected) < .1, `expected ~${expected}, got ${arrivals / 400}`);
  }
});

test('priced out moves in proportion to rent: 1% more rent prices out about 1 in 100 year-0 renters, 2% about twice that', () => {
  // The same town, with every zone's rent 1% or 2% above CH-LUTI's no-policy path by year 10 (phased in), and nothing else changed.
  const above = pct => ({ ...growth, rent: growth.rent.map((zones, t) => Object.fromEntries(Object.entries(zones).map(([z, v]) => [z, v * (1 + pct * t / 10)]))) });
  const [base, one, two] = [0, .01, .02].map(pct => averageRuns(above(pct), assumptions, baselines)[10].pricedOut);
  const renters = simulate(growth, assumptions, baselines).agents.filter(a => a.joined === 0 && a.renter).length * assumptions.agentScale.value;
  assert.ok(one - base > .003 * renters && one - base < .02 * renters, `+1% rent: ${one - base} of ${renters} renters`);
  assert.ok(Math.abs((two - base) / (one - base) - 2) < .5, `+2% rent: ${two - base}, vs ${one - base} for +1%`);
});

test('only burden that builds up since arrival counts: rent rising exactly as fast as income prices out nobody', () => {
  const pace = { ...growth, rent: growth.rent.map((zones, t) => Object.fromEntries(Object.keys(zones).map(z => [z, (1 + assumptions.lutiIncomeGrowth.value) ** t]))) };
  for (let seed = 1; seed <= 20; seed++) assert.equal(simulate(pace, assumptions, baselines, seed).years[10].displaced, 0, `seed ${seed}`);
});

test('a household\'s rent and commute follow CH-LUTI\'s path for its zone', () => {
  const { agents } = simulate(growth, assumptions, baselines);
  const a = agents.find(x => x.joined === 0 && x.renter && x.work !== 'remote' && x.left === null);
  for (const t of [5, 10]) {
    assert.ok(Math.abs(a.hist[t].rent / a.hist[0].rent - growth.rent[t][a.zone]) < .002, `rent, year ${t}`);
    assert.ok(Math.abs(a.hist[t].commute / a.hist[0].commute - growth.commute[t][a.zone]) < .01, `commute, year ${t}`);
  }
});

test('every household in a run has its own name: a first name and a last initial, stable for its id', () => {
  for (const seed of [1, 7, 42, 99]) {
    const { agents } = simulate(growth, assumptions, baselines, seed); // with newcomers, who join the same run's pool
    assert.ok(agents.length > 300 && agents.some(a => a.joined > 0));
    assert.equal(new Set(agents.map(a => a.name)).size, agents.length, `seed ${seed}: a name used twice`);
    for (const a of agents) assert.match(a.name, new RegExp(`^${a.first} [A-Z]\\.$`), a.name);
  }
  const a = simulate(growth, assumptions, baselines, 7).agents, b = simulate(ramp(509), assumptions, baselines, 7).agents;
  assert.deepEqual(a.filter(x => !x.joined).map(x => x.name), b.filter(x => !x.joined).map(x => x.name), 'year-0 names do not depend on the scenario');
});

test('the showcase residents keep their first names (data/residents.json on feat/resident, seed 7)', () => {
  const SHOWCASE = { 0: 'Uma', 114: 'Keisha', 130: 'Ben', 10: 'Hao', 107: 'Quinn', 249: 'Diego', 6: 'Femi', 207: 'Victor', 110: 'Jamal', 17: 'Bryce', 203: 'Lena', 135: 'Maya' };
  const { agents } = simulate(growth, assumptions, baselines, 7);
  for (const [id, first] of Object.entries(SHOWCASE)) assert.equal(agents[id].first, first, `agent ${id}`);
});
