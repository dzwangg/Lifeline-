// Walks added for new neighbourhoods (roadnet extend/retract, street-sim gatesChanged): a new walk never ties on to a
// closed one, a discarded walk leaves the network, and walkers give up walks that close under them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadNet, buildWalkNet, findRoute } from '../meridian-city/world/roadnet.js';
import { createStreetSim } from '../meridian-city/world/street-sim.js';

// Two residential streets crossing at the origin; their sidewalks are the open network.
const roads = [{ cls: 'residential', ow: 0, w: 7, r: [-400, 0, 400, 0] }, { cls: 'residential', ow: 0, w: 7, r: [0, -400, 0, 400] }];
const onRoad = (x, z) => (Math.abs(z) < 3.5 && Math.abs(x) <= 400) || (Math.abs(x) < 3.5 && Math.abs(z) <= 400);
const setup = () => { const net = buildRoadNet(roads); return { net, walk: buildWalkNet(net, [], { onRoad }) }; };
const KERB = 3.5 + 1.1; // where the sidewalks run (half the road plus about half the sidewalk)
const gatedEdges = (walk, gate) => walk.edges.filter(e => e.gate === gate);

test('a new walk ties on to the open network, never to a closed walk', () => {
  const { walk } = setup();
  const a = { open: true }, b = { open: true };
  walk.extend([{ r: [60, KERB + .5, 60, 60] }], a); // a lane off the sidewalk, out to (60, 60)
  assert.ok(gatedEdges(walk, a).length >= 2, 'the lane joins the sidewalk');
  a.open = false; // its year is not shown
  walk.extend([{ r: [60, 64, 60, 90] }], b); // starts 4 m from the closed lane's end, far from any sidewalk
  const tiesToA = gatedEdges(walk, b).some(e => [e.a, e.b].some(n => n.adj.some(l => l.e.gate === a)));
  assert.equal(tiesToA, false, 'it does not hang off the closed lane');
});

test('retract takes a discarded walk out of the network and the lookup', () => {
  const { walk } = setup();
  const g = { open: true };
  walk.extend([{ r: [-60, KERB + .5, -60, 50] }], g);
  const nodes = new Set(gatedEdges(walk, g).flatMap(e => [e.a, e.b]).filter(n => n.kind === 'path'));
  walk.retract(g);
  assert.equal(gatedEdges(walk, g).length, 0);
  for (const n of nodes) assert.ok(n.dead && !n.adj.length);
  let found = 0; walk.near(-60, 25, 30, n => { if (nodes.has(n)) found++; });
  assert.equal(found, 0, 'later walks cannot find its nodes');
});

test('walkers give up walks that close under them', () => {
  const { net, walk } = setup();
  const g = { open: true };
  walk.extend([{ r: [80, KERB + .5, 80, 70] }], g);
  const sim = createStreetSim({ net, walk, onRoad, vehicleDensity: 0, pedDensity: 2, seed: 3 });
  const lane = gatedEdges(walk, g).find(e => e.kind === 'path' && e.a.kind === 'path' && e.b.kind === 'path');
  const far = [lane.a, lane.b].sort((p, q) => q.z - p.z)[0]; // the lane's far end
  const start = walk.nodes.find(n => n.kind === 'side' && n.comp === far.comp && Math.hypot(n.x - 80, n.z) > 30); // along the same sidewalk
  const route = findRoute(walk, start, far);
  assert.ok(route, 'the lane is reachable while open');
  const [p, q] = sim.peds;
  // p is partway along: still on the sidewalk, with the lane ahead. q stands on the lane itself.
  Object.assign(p, { route, ri: 1, node: route[0], x: route[0].x, z: route[0].z, door: null, state: 'walking' });
  Object.assign(q, { route: [far], ri: 0, node: far, x: far.x, z: far.z, door: { x: 80, z: 75, gate: g }, state: 'walking' });
  g.open = false;
  sim.gatesChanged();
  const shut = (a, b) => a.adj.find(l => l.to === b)?.e.gate === g;
  for (let i = Math.max(1, p.ri); i < (p.route?.length ?? 0); i++) assert.ok(!shut(p.route[i - 1], p.route[i]), 'p no longer plans to walk the lane');
  assert.ok(q.node.adj.some(l => !l.e.gate || l.e.gate.open), 'q stepped back onto the open network');
  assert.equal(q.door, null, 'and no longer calls at the closed home');
});
