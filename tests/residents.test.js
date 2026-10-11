// Every person on the map is a resident: one id, one state, read alike by the dots and the resident card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadNet, buildWalkNet } from '../meridian-city/world/roadnet.js';
import { createStreetSim } from '../meridian-city/world/street-sim.js';
import { createHouseholds } from '../meridian-city/world/households.js';
import { runModels } from '../shared/combined.js';
import { simulate, streetAgent, STREET_RESIDENTS } from '../shared/agents.js';
import { readFileSync } from 'node:fs';
import { residentId, residentIn, validResidentId } from '../shared/residents.js';
import { loadCards } from '../api/narration.js';
import { zones, assumptions, baselines } from './data.js';

// The showcase residents (data/residents.json): id -> agent id, and back.
const { residents: showcase } = JSON.parse(readFileSync(new URL('../data/residents.json', import.meta.url), 'utf8'));
const d = { showcaseAgents: new Map(showcase.map(r => [r.id, r.agent])), residents: new Map(showcase.map(r => [r.id, r])) };
const showcaseIds = new Map([...d.showcaseAgents].map(([id, agent]) => [agent, id]));
const TAX = [{ id: 'property-tax-adjustment', params: { cents_per_100: 10 } }];
const cards = await loadCards(false);
const runOf = policies => simulate(runModels(policies.map(p => cards.get(p.id)), Object.fromEntries(policies.map(p => [p.id, p.params])), zones, assumptions, baselines).inputs, assumptions, baselines);
const base = runOf([]), taxed = runOf(TAX);

// A small street: two blocks of a residential grid.
const roads = [0, 120, 240].flatMap(i => [{ cls: 'residential', ow: 0, w: 7, r: [0, i, 240, i] }, { cls: 'residential', ow: 0, w: 7, r: [i, 0, i, 240] }]);
const onRoad = (x, z) => roads.some(q => { const [ax, az, bx, bz] = q.r; return ax === bx ? Math.abs(x - ax) < 3.5 && z >= az && z <= bz : Math.abs(z - az) < 3.5 && x >= ax && x <= bx; });
const city = () => { const net = buildRoadNet(roads); return createStreetSim({ net, walk: buildWalkNet(net, [], { onRoad }), onRoad, pedDensity: 1, seed: 5 }); };

test('every walker street life makes is a street resident, with an id that is the same on every load', () => {
  const a = city(), b = city();
  assert.ok(a.peds.length > 10, `walkers: ${a.peds.length}`);
  for (const p of a.peds) assert.equal(p.resident, `st-${p.id}`);
  assert.equal(new Set(a.peds.map(p => p.resident)).size, a.peds.length, 'one resident per walker');
  assert.deepEqual(a.peds.map(p => [p.resident, p.look]), b.peds.map(p => [p.resident, p.look]), 'the same people on a reload');
});

test('every household walker carries its household\'s resident id, newcomers and showcase residents included', () => {
  const sim = city(), before = sim.peds.length;
  const agents = taxed.agents, homes = agents.map(() => [60, 60]);
  for (const a of agents) a.resident = residentId(a, showcaseIds);
  const hh = createHouseholds({ sim, doors: { campus: [], downtown: [] }, exits: [], ext: 236 });
  hh.sync(agents, homes, 10, false, 8);
  const added = sim.peds.slice(before);
  assert.ok(added.length > 100, `household walkers: ${added.length}`);
  assert.ok(added.every(p => typeof p.resident === 'string' && p.resident === agents.find(a => a.id === p.owner).resident));
  assert.ok(added.some(p => p.resident === 'uma') && added.some(p => /^hh-\d+-y\d+-[a-z]+$/.test(p.resident)), 'showcase and newcomer ids');
  assert.ok(sim.peds.every(p => p.resident != null), 'no walker without a resident');
});

test('resident ids round-trip to the same state in a run, and junk ids are refused', () => {
  for (const run of [base, taxed]) for (const a of run.agents) assert.equal(residentIn(run, residentId(a, showcaseIds), d.showcaseAgents, assumptions), a);
  assert.equal(residentIn(base, 'uma', d.showcaseAgents, assumptions), base.agents[0]);
  const newcomer = taxed.agents.find(a => a.joined > 0), id = residentId(newcomer, showcaseIds);
  if (!base.agents.some(a => residentId(a, showcaseIds) === id)) assert.equal(residentIn(base, id, d.showcaseAgents, assumptions), null);
  for (const ok of ['uma', 'hh-0', 'hh-12-y3-felix', 'st-0', `st-${STREET_RESIDENTS - 1}`]) assert.ok(validResidentId(ok, d.residents), ok);
  for (const bad of ['nobody', 'hh-', 'hh-1-y2', 'st--1', `st-${STREET_RESIDENTS}`, 'st-1 ', 7, null]) assert.ok(!validResidentId(bad, d.residents), String(bad));
});

test('a street resident is drawn from its number alone and follows its run\'s rents, like a household', () => {
  const a = streetAgent(42, base.street, assumptions);
  assert.deepEqual(streetAgent(42, base.street, assumptions), a, 'the same person every time');
  assert.notDeepEqual(streetAgent(43, base.street, assumptions).hist, a.hist);
  assert.ok(a.street && a.joined === 0 && a.left === null && a.hist.length === 11 && a.hist.every(h => h.here));
  const renters = Array.from({ length: 400 }, (_, n) => streetAgent(n, taxed.street, assumptions)).filter(x => x.renter);
  assert.ok(renters.length > 100);
  for (const x of renters) for (const h of x.hist) assert.equal(h.burden, h.rent * 12 / h.income);
  // rents follow the run's rent index for the zone, as households' do
  const x = renters[0], idx = t => taxed.street.rent?.[t]?.[x.zone] ?? 1;
  assert.ok(Math.abs(x.hist[10].rent / x.hist[0].rent - idx(10) / idx(0)) < .01);
  // and street residents are a similar population to households: rents near the same median
  const median = v => v.sort((p, q) => p - q)[v.length >> 1];
  const hhRent = median(base.agents.filter(h => h.renter && h.joined === 0).map(h => h.hist[0].rent));
  const stRent = median(Array.from({ length: 1000 }, (_, n) => streetAgent(n, base.street, assumptions)).filter(h => h.renter).map(h => h.hist[0].rent));
  assert.ok(Math.abs(stRent / hhRent - 1) < .15, `street ${stRent} vs households ${hhRent}`);
});
