// Street life rules on a synthetic downtown grid: signals never give conflicting greens, cars never enter on red
// or overlap, walkers only cross on walk and never stand in the road.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadNet, buildWalkNet } from '../meridian-city/world/roadnet.js';
import { createStreetSim, STEP } from '../meridian-city/world/street-sim.js';

// A 4 x 4 grid, 120 m blocks: primaries one way, residential the other, plus a one-way street and a dead end.
function grid() {
  const roads = [], N = 4, B = 120;
  for (let i = 0; i < N; i++) {
    const row = [], col = [];
    for (let j = 0; j < N; j++) { row.push(j * B, i * B); col.push(i * B, j * B); if (i === 1 && j === 1) row.push(B * 1.5, B); }
    roads.push({ cls: i % 2 ? 'primary' : 'secondary', ow: 0, w: 13, r: row });
    roads.push({ cls: i === 1 ? 'tertiary' : 'residential', ow: i === 3 ? 1 : 0, w: i === 1 ? 9 : 7, r: col });
  }
  roads.push({ cls: 'residential', ow: 0, w: 7, r: [B * 1.5, B, B * 1.5, B * 1.5] }); // dead end off a primary
  return roads;
}
const roads = grid();
function onRoad(x, z) {
  for (const q of roads) for (let i = 0; i + 2 < q.r.length; i += 2) {
    const ax = q.r[i], az = q.r[i + 1], bx = q.r[i + 2], bz = q.r[i + 3], l2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2; // streets.js draws flat road ends
    if (t < 0 || t > 1) continue;
    if ((x - ax - t * (bx - ax)) ** 2 + (z - az - t * (bz - az)) ** 2 < (q.w / 2) ** 2) return true;
  }
  return false;
}
const footpaths = [{ cls: 'footway', w: 2.2, r: [60, 60, 60, 180, 180, 180] }]; // crosses a road: must be cut there

test('the road network finds intersections, signals and conflicts', () => {
  const net = buildRoadNet(roads);
  assert.ok(net.intersections.length >= 12, `intersections: ${net.intersections.length}`); // corners of the grid only have two arms
  const sig = net.intersections.filter(ix => ix.signal);
  assert.ok(sig.length >= 6, `signals: ${sig.length}`);
  for (const ix of sig) for (const m of ix.movements) for (const k of m.conflicts) {
    // straight movements of the two groups always cross
    if (m.turn === 'S' && k.turn === 'S' && m.group !== k.group) assert.ok(m.conflicts.includes(k));
  }
  const ix = sig[0], R = ix.movements.find(m => m.turn === 'R'), L = ix.movements.find(m => m.turn === 'L');
  assert.ok(R && L && R.len < L.len, 'right turns are the short ones (driving on the right)');
});

test('the walk network never reaches the road except on crosswalks', () => {
  const net = buildRoadNet(roads), walk = buildWalkNet(net, footpaths, { onRoad });
  for (const e of walk.edges) {
    if (e.kind === 'cross') continue;
    for (let t = .1; t < .9; t += .1) assert.ok(!onRoad(e.a.x + (e.b.x - e.a.x) * t, e.a.z + (e.b.z - e.a.z) * t), `${e.kind} edge ${e.id} runs over a road`);
  }
  assert.ok(walk.edges.some(e => e.kind === 'cross'));
  assert.ok(Math.max(...walk.compSizes) > walk.nodes.length * .8, 'one big connected network');
});

test('ten simulated minutes at every speed keep the rules', () => {
  for (const speed of [1, 2, 4]) {
    const net = buildRoadNet(roads), walk = buildWalkNet(net, footpaths, { onRoad });
    const sim = createStreetSim({ net, walk, onRoad, vehicleDensity: 3, pedDensity: 3, seed: 5 });
    assert.ok(sim.vehicles.length > 20 && sim.peds.length > 50, JSON.stringify(sim.counts()));
    let audit = { overlap: 0, pedOnRoad: 0, pedHit: 0 }, crossed = 0, moved = 0;
    const startS = sim.vehicles.map(c => c.x + c.z);
    for (let f = 0; f < 600 * 60 / speed; f++) { // 60 fps frames
      sim.advance(speed / 60);
      sim.plan(50);
      if (f % 20 === 0) { const a = sim.audit(); for (const k in a) audit[k] += a[k]; }
      crossed += sim.peds.filter(p => p.state === 'crossing').length;
    }
    moved = sim.vehicles.filter((c, i) => Math.abs(c.x + c.z - startS[i]) > 50).length;
    assert.deepEqual(sim.violations, { conflictingGreen: 0, redEntry: 0, walkOnRed: 0, pedOnRoad: 0, overlap: 0, pedHit: 0 });
    assert.deepEqual(audit, { overlap: 0, pedOnRoad: 0, pedHit: 0 }, `speed ${speed}x`);
    assert.ok(crossed > 0, 'walkers crossed streets');
    assert.ok(moved > sim.vehicles.length * .6, `traffic flows: ${moved}/${sim.vehicles.length} moved at ${speed}x`);
  }
});

test('pausing freezes everything', () => {
  const net = buildRoadNet(roads), walk = buildWalkNet(net, footpaths, { onRoad });
  const sim = createStreetSim({ net, walk, onRoad, seed: 2 });
  for (let i = 0; i < 300; i++) sim.advance(1 / 60);
  const snap = JSON.stringify([sim.vehicles.map(c => [c.x, c.z]), sim.peds.map(p => [p.x, p.z]), sim.signals.map(s => [s.phase, s.t])]);
  for (let i = 0; i < 100; i++) { sim.advance(0); sim.plan(5); }
  assert.equal(JSON.stringify([sim.vehicles.map(c => [c.x, c.z]), sim.peds.map(p => [p.x, p.z]), sim.signals.map(s => [s.phase, s.t])]), snap);
  assert.equal(STEP, 1 / 20);
});
