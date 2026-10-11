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

// ---------- walkers the caller controls, and the households on them (households.js) ----------
import { SHOW_M } from '../meridian-city/world/street-sim.js';
import { createHouseholds, placeAt, hourAt, clockLabel, pickWalker, DAY_S, START_HOUR } from '../meridian-city/world/households.js';

const city = (o = {}) => { const net = buildRoadNet(roads), walk = buildWalkNet(net, footpaths, { onRoad }); return createStreetSim({ net, walk, onRoad, pedDensity: .3, seed: 3, ...o }); };
const runFor = (sim, seconds, each = () => {}) => { for (let t = 0; t < seconds; t += STEP) { sim.step(STEP); sim.plan(50); each(); } };

test('addPed, sendPed and removePed: a sent walker gets there on the walks, then waits to be sent again', () => {
  const sim = city(), before = sim.peds.length;
  const p = sim.addPed({ x: 2, z: 2, look: 7, owner: 'h1' });
  assert.equal(sim.peds.length, before + 1);
  assert.ok(sim.idle(p) && p.owner === 'h1');
  sim.sendPed(p, 125, 5, 'the corner shop'); // one block east
  assert.equal(sim.idle(p), false);
  let onRoadSteps = 0;
  runFor(sim, 240, () => { if (p.state !== 'crossing' && onRoad(p.x, p.z)) onRoadSteps++; });
  assert.ok(sim.idle(p), `still ${p.state}, ${p.route ? 'routed' : 'unrouted'}`);
  assert.ok(Math.hypot(p.x - 125, p.z - 5) < 12, `at ${p.x}, ${p.z}`);
  assert.equal(p.dest.label, 'the corner shop');
  assert.equal(onRoadSteps, 0, 'never stands in the road');
  const x = p.x, z = p.z;
  runFor(sim, 30);
  assert.deepEqual([p.x, p.z], [x, z], 'sent walkers stand still in between');
  sim.removePed(p);
  assert.equal(sim.peds.length, before);
  assert.ok(!sim.peds.includes(p) && p.removed);
});

test('a long sent trip shows its two ends only: it steps out of sight past SHOW_M and back in SHOW_M short of the goal', () => {
  const sim = city();
  const p = sim.addPed({ x: 0, z: 0, owner: 'h2' });
  sim.sendPed(p, 360, 360, 'across town'); // three blocks each way, about 720 m on the walks
  sim.plan(50);
  assert.ok(p.skip, 'a skip was planned');
  let hidden = 0, walked = 0, last = [p.x, p.z];
  runFor(sim, 400, () => { if (p.hidden > 0) hidden++; else { walked += Math.hypot(p.x - last[0], p.z - last[1]); } last = [p.x, p.z]; });
  assert.ok(sim.idle(p), 'arrived');
  assert.ok(Math.hypot(p.x - 360, p.z - 360) < 12);
  assert.ok(hidden > 0, 'out of sight for a moment');
  assert.ok(walked < 2 * SHOW_M + 80, `walked ${Math.round(walked)} m of the route, not all of it`);
});

test('the day: a clock that loops every DAY_S seconds, and where each kind of household is', () => {
  assert.equal(hourAt(0), START_HOUR);
  assert.ok(Math.abs(hourAt(DAY_S) - START_HOUR) < 1e-9, 'loops');
  assert.equal(clockLabel(8 + 40 / 60), '8:40 am');
  assert.equal(clockLabel(0), '12:00 am');
  assert.equal(clockLabel(17.5), '5:30 pm');
  const h = (work, student = false) => ({ a: { work, student }, u: [.5, .5, .5, .5] });
  assert.equal(placeAt(h('campus'), 6), 'home');
  assert.equal(placeAt(h('campus'), 12), 'work');
  assert.equal(placeAt(h('downtown'), 21), 'home');
  assert.equal(placeAt(h('durham'), 12), 'away');
  assert.equal(placeAt(h('remote'), 13.5), 'home');
  assert.equal(placeAt(h('remote'), 11.2), 'stroll');
  assert.equal(placeAt(h('campus', true), 8), 'home', 'students leave later');
});

const agent = (id, o = {}) => ({ id, name: `H${id}`, joined: 0, left: null, work: 'campus', student: false, ...o });
function households(sim) {
  return createHouseholds({ sim, doors: { campus: [{ x: 240, z: 5, label: 'Campus hall' }], downtown: [{ x: 125, z: 245, label: 'Offices' }] }, exits: [[360, 300]], ext: 380 });
}

test('households: one walker each, a stable look by id, and they go to work and back through the day', () => {
  const sim = city(), H = households(sim);
  const agents = [agent(1), agent(2, { work: 'remote' }), agent(3, { work: 'durham' })], homes = [[5, 120], [120, 120], [240, 125]];
  H.sync(agents, homes, 0, false, 6);
  assert.equal(H.size, 3);
  const looks = []; H.each((a, p) => looks.push(p.look));
  const again = households(city()); again.sync(agents, homes, 0, false, 6);
  const looks2 = []; again.each((a, p) => looks2.push(p.look));
  assert.deepEqual(looks, looks2, 'the same household always looks the same');
  const ped = id => { let out; H.each((a, p) => { if (a.id === id) out = p; }); return out; };
  // morning: the campus worker heads for the campus door, the Durham commuter for 15-501
  H.update(12);
  assert.equal(ped(1).dest.label, 'Campus hall');
  assert.equal(ped(3).dest.label, 'Durham, by 15-501');
  runFor(sim, 400, () => H.update(12));
  assert.ok(Math.hypot(ped(1).x - 240, ped(1).z - 5) < 20, 'at work');
  assert.equal(ped(3), null, 'out of sight in Durham');
  // evening: home again, the Durham commuter coming back from the edge
  H.update(20);
  assert.ok(ped(3), 'back from Durham');
  runFor(sim, 400, () => H.update(20));
  assert.ok(Math.hypot(ped(1).x - 5, ped(1).z - 120) < 20 && Math.hypot(ped(3).x - 240, ped(3).z - 125) < 20, 'home (the sidewalk nearest it)');
});

test('households: a year reached by playback walks newcomers in from the map edge and leavers off it; a seek just places them', () => {
  const sim = city(), H = households(sim), homes = [[120, 120], [240, 240]];
  const agents = [agent(1, { left: 2 }), agent(2, { joined: 2, work: 'remote' })];
  H.sync(agents, homes, 1, false, 6);
  assert.equal(H.size, 1);
  H.sync(agents, homes, 2, true, 6);
  let newcomer, leaver;
  H.each((a, p, h) => { if (a.id === 2) newcomer = { p, h }; if (a.id === 1) leaver = { p, h }; });
  assert.ok(newcomer.h.entering && newcomer.p.dest.label === 'their new home');
  assert.ok(Math.max(Math.abs(newcomer.p.x), Math.abs(newcomer.p.z)) > 300, 'starts at the map edge');
  assert.ok(leaver.h.leaving && leaver.p.dest.label === 'leaving town');
  runFor(sim, 600, () => H.update(6));
  assert.equal(H.size, 1, 'the leaver walked off and is gone');
  assert.ok(Math.hypot(newcomer.p.x - 240, newcomer.p.z - 240) < 20, 'the newcomer is home');
  const seek = households(city());
  seek.sync(agents, homes, 2, false, 6);
  seek.each((a, p, h) => { assert.equal(a.id, 2); assert.ok(!h.entering && Math.hypot(p.x - 240, p.z - 240) < 20, 'placed at home at once'); });
});

test('household id 0 is an owner like any other: it goes only where it is sent, then waits', () => {
  const sim = city(), p = sim.addPed({ x: 2, z: 2, owner: 0 });
  sim.sendPed(p, 125, 5, 'the corner shop');
  runFor(sim, 240);
  assert.ok(sim.idle(p) && p.trips === 1, `trips ${p.trips}, ${p.state}`);
  assert.equal(p.dest.label, 'the corner shop');
  const x = p.x;
  runFor(sim, 60);
  assert.equal(p.x, x, 'no wandering off on a random trip');
});

test('households: playing into a departure year, then seeking back, keeps the household, placed afresh', () => {
  const sim = city(), H = households(sim), homes = [[120, 120]], agents = [agent(0, { left: 2 })];
  H.sync(agents, homes, 1, false, 6);
  H.sync(agents, homes, 2, true, 6);
  let h0; H.each((a, p, h) => { h0 = h; });
  assert.ok(h0.leaving, 'walking off the map');
  H.sync(agents, homes, 1, false, 6); // seek back before the walk ends
  assert.equal(H.size, 1);
  H.each((a, p, h) => { assert.ok(!h.leaving && !h.entering && p && !p.removed); assert.ok(Math.hypot(p.x - 120, p.z - 120) < 20, 'at home'); });
  runFor(sim, 300, () => H.update(6));
  assert.equal(H.size, 1, 'still here');
  H.each((a, p) => assert.ok(p && sim.peds.includes(p)));
});

test('households: with the hour running, every walk ends inside its window: at work by day, home by night', () => {
  const sim = city(), H = households(sim);
  const agents = [agent(0), agent(1, { student: true }), agent(2, { work: 'downtown' }), agent(3, { work: 'remote' }), agent(4, { work: 'durham' })];
  const homes = [[5, 360], [360, 360], [240, 360], [120, 245], [5, 245]];
  H.sync(agents, homes, 0, false, hourAt(0));
  const was = new Map(), arrivals = [];
  runFor(sim, 2 * DAY_S, () => {
    const hour = hourAt(sim.time);
    H.update(hour);
    H.each((a, p, h) => {
      const idle = !p || sim.idle(p);
      if (idle && was.get(a.id) === false) arrivals.push({ id: a.id, at: h.at, where: placeAt(h, hour), hour });
      was.set(a.id, idle);
    });
  });
  assert.ok(arrivals.filter(x => x.at === 'work').length >= 4, `${arrivals.filter(x => x.at === 'work').length} arrivals at work`);
  for (const x of arrivals) assert.equal(x.at, x.where, `household ${x.id} reached ${x.at} at ${clockLabel(x.hour)}, when it should be at ${x.where}`);
});

test('picking: a household in range wins over a nearer ambient walker; an ambient walker only when no household is', () => {
  const rect = { left: 0, top: 0, width: 1000, height: 1000 }, walker = { id: 1 }, household = { id: 2, owner: 0 };
  const at = (p, x, y) => [p, x / 1000, (y + 12) / 1000]; // feet 12 px below the aim point
  assert.equal(pickWalker([...at(walker, 500, 500), ...at(household, 510, 508)], rect, 500, 500), household);
  assert.equal(pickWalker([...at(walker, 500, 500), ...at(household, 530, 500)], rect, 500, 500), walker, 'the household is out of range');
  assert.equal(pickWalker([...at(walker, 540, 500)], rect, 500, 500), null);
});

// ---------- crossings: a new destination waits for the kerb, and a skip never bypasses the crossing check ----------
import { WALK_TIME, CLEAR_SPEED } from '../meridian-city/world/street-sim.js';
import { seeded } from '../meridian-city/world/palette.js';
const edgeKind = (a, b) => a.adj.find(l => l.to === b)?.e.kind;
const signalled = sim => sim.net.crosswalks.filter(c => c.signalized && c.nodeA && c.nodeB);

test('a walker sent somewhere else mid-crossing finishes the crossing first, counted on it, then goes and arrives', () => {
  const sim = city(), cw = signalled(sim)[0], A = cw.nodeA, B = cw.nodeB;
  const p = sim.addPed({ x: A.x, z: A.z, owner: 'x' });
  sim.sendPed(p, B.x, B.z, 'across');
  for (let t = 0; t < 120 && p.state !== 'crossing'; t += STEP) { sim.step(STEP); sim.plan(50); }
  assert.equal(p.state, 'crossing', 'got a walk signal and stepped out');
  sim.sendPed(p, A.x, A.z, 'back where it came from'); // would mean turning round in the road
  assert.ok(p.pendingSend && p.state === 'crossing' && cw.peds.has(p), 'deferred, still crossing');
  let dB = Math.hypot(p.x - B.x, p.z - B.z), sawKerb = false;
  for (let t = 0; t < 400 && !(sawKerb && sim.idle(p)); t += STEP) {
    sim.step(STEP); sim.plan(50);
    if (!sawKerb) {
      const d = Math.hypot(p.x - B.x, p.z - B.z);
      if (onRoad(p.x, p.z)) assert.ok(p.state === 'crossing' && [...sim.net.crosswalks].some(c => c.peds.has(p)), 'in the road only on a crosswalk, counted');
      assert.ok(d <= dB + .05, `turned round in the road: ${d.toFixed(2)} m from the far kerb, was ${dB.toFixed(2)}`);
      dB = d;
      if (p.state !== 'crossing') { sawKerb = true; assert.ok(!onRoad(p.x, p.z) && d < 2.5, 'reached the far kerb'); }
    }
  }
  assert.ok(sawKerb && sim.idle(p), 'then went on to the new goal');
  assert.ok(Math.hypot(p.x - A.x, p.z - A.z) < 3 && p.dest.label === 'back where it came from');
});

test('a skip that lands on the near kerb of a crossing waits for the signal there, crosses and arrives', () => {
  const sim = city();
  let found = null;
  // A trip of 90-220 m whose skip lands on a kerb just before a signalled crossing, with the goal 10-25 m past it.
  for (const cw of signalled(sim)) for (const [near, far] of [[cw.nodeA, cw.nodeB], [cw.nodeB, cw.nodeA]]) {
    if (found) break;
    const goals = sim.walk.nodes.filter(n => n.kind !== 'kerb' && Math.hypot(n.x - far.x, n.z - far.z) >= 10 && Math.hypot(n.x - far.x, n.z - far.z) <= 25);
    const starts = sim.walk.nodes.filter(n => n.kind !== 'kerb' && Math.hypot(n.x - near.x, n.z - near.z) > 60 && Math.hypot(n.x - near.x, n.z - near.z) < 180);
    for (const g of goals) for (const s of starts.slice(0, 40)) {
      if (found) break;
      const p = sim.addPed({ x: s.x, z: s.z, owner: 'probe' });
      sim.sendPed(p, g.x, g.z, 'past the crossing');
      sim.plan(50);
      const r = p.route, len = r ? r.slice(1).reduce((t, n, i) => t + Math.hypot(n.x - r[i].x, n.z - r[i].z), 0) : 0;
      if (p.skip && len >= 90 && len <= 220 && r[p.skip[1]] === near && r[p.skip[1] + 1] === far && edgeKind(near, far) === 'cross') found = { p, cw, near, far, g };
      else sim.removePed(p);
    }
  }
  assert.ok(found, 'found such a trip on the synthetic city');
  const { p, cw, far, g } = found;
  let crossed = false, waitedOrWalk = false, t = 0;
  for (; t < 300 && !sim.idle(p); t += STEP) {
    sim.step(STEP); sim.plan(50);
    if (p.state === 'waiting') waitedOrWalk = true;
    if (p.state === 'crossing') { crossed = true; if (cw.walk === 'WALK') waitedOrWalk = true; assert.ok(cw.peds.has(p)); }
    if (p.state !== 'crossing' && !(p.hidden > 0)) assert.ok(!onRoad(p.x, p.z), 'off the road unless crossing');
  }
  assert.ok(crossed && waitedOrWalk, 'checked the signal, then crossed');
  assert.ok(sim.idle(p) && Math.hypot(p.x - g.x, p.z - g.z) < 3, `arrived (after ${t.toFixed(0)} s)`);
});

test('sweep: two days of household trips with the hour running: nobody lingers in the road, nobody gets stuck', () => {
  const sim = city(), r = seeded(99);
  const nodes = sim.walk.nodes.filter(n => n.kind !== 'kerb'), at = () => { const n = r.pick(nodes); return { x: n.x, z: n.z, label: 'a door' }; };
  const H = createHouseholds({ sim, doors: { campus: [at(), at(), at()], downtown: [at(), at()] }, exits: [[360, 300], [0, 360]], ext: 380 });
  const kinds = ['campus', 'downtown', 'durham', 'remote'];
  const agents = Array.from({ length: 48 }, (_, i) => agent(i, { work: kinds[i % 4], student: i % 7 === 0 }));
  H.sync(agents, agents.map(() => { const n = r.pick(nodes); return [n.x, n.z]; }), 0, false, hourAt(0));
  const longest = Math.max(...sim.net.crosswalks.map(c => c.len)), roadMax = WALK_TIME + longest / CLEAR_SPEED + 2;
  const track = new Map(); let worstRoad = 0, worstStill = 0, trips = 0;
  runFor(sim, 2 * DAY_S, () => {
    H.update(hourAt(sim.time));
    H.each((a, p) => {
      if (!p) return;
      const k = track.get(p) ?? { road: 0, still: 0, x: p.x, z: p.z };
      k.road = onRoad(p.x, p.z) && !(p.hidden > 0) ? k.road + STEP : 0;
      const moved = Math.hypot(p.x - k.x, p.z - k.z) > .3;
      if (moved || sim.idle(p) || p.hidden > 0 || p.state === 'waiting') { k.still = 0; k.x = p.x; k.z = p.z; } else k.still += STEP;
      worstRoad = Math.max(worstRoad, k.road); worstStill = Math.max(worstStill, k.still);
      track.set(p, k);
    });
  });
  H.each((a, p) => { trips += p?.trips ?? 0; });
  assert.ok(trips > 60, `${trips} trips`);
  assert.ok(worstRoad <= roadMax, `a walker was in the road ${worstRoad.toFixed(1)} s (most allowed ${roadMax.toFixed(1)})`);
  assert.ok(worstStill <= 20, `a walker with somewhere to go made no progress for ${worstStill.toFixed(1)} s`);
});
