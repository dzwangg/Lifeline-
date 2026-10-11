// Neighbourhood growth (meridian-city/growth/) on synthetic sites: beside a straight road, a curved road, inside an
// established neighbourhood, and deep in a wood that needs its own street. Plans must be deterministic, never overlap or
// touch roads and buildings, give every building a front path to a sidewalk, square buildings to curved streets, fell
// only the trees in the way, match the sim's homes through the explicit mapping, and report what doesn't fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteContext, findJunctions } from '../meridian-city/growth/context.js';
import { planSiteStreets, STREET } from '../meridian-city/growth/site-streets.js';
import { planParcel, planBlock, clears, rectDist, PLANT_CROWN } from '../meridian-city/growth/plan.js';
import { requestedUnits, summarize } from '../meridian-city/growth/units.js';
import { OCC, Line } from '../meridian-city/growth/geom.js';
import { inside } from '../meridian-city/world/rings.js';

const UPA = { forest: 0, low_res: 4, mid_res: 15, mixed_use: 70, parking: 0 };
const rect = (x0, z0, x1, z1) => [x0, z0, x1, z0, x1, z1, x0, z1];
const acres = ring => { let s = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; s += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; } return Math.abs(s) / 2 / 4046.86; };
const parcel = (id, ring, tags = ['wood-90']) => ({ id, ring, state: 'forest', tags, areaAcres: acres(ring) });

// A world: roads (with sidewalks), buildings and parcels, answered as occupancy bits like world.grid.at.
function world({ roads, buildings = [], parcels, water = [] }) {
  const lines = roads.map(q => ({ ...q, L: new Line(q.r) }));
  const occ = (x, z) => {
    let b = 0;
    for (const q of lines) { const d = q.L.project(x, z).d; if (d <= q.w / 2) b |= OCC.road; else if (d <= q.w / 2 + 2.2) b |= OCC.sidewalk; }
    for (const m of buildings) if (inside(m.outer, x, z)) b |= OCC.building;
    for (const w of water) if (inside(w, x, z)) b |= OCC.water;
    for (const p of parcels) if (inside(p.ring, x, z)) b |= OCC.zone;
    return b;
  };
  return { occ, roads };
}
function plan(site, state, opts = {}) {
  const { roads, buildings = [], parcels } = site, w = world(site);
  const ctx = siteContext({ id: parcels[0].tags.find(t => t.startsWith('wood')) ?? parcels[0].id, parcels, roads, junctions: findJunctions(roads), buildings });
  const streets = planSiteStreets({ ctx, parcels, occ: w.occ }).streets;
  const req = requestedUnits(parcels, Object.fromEntries(parcels.map(p => [p.id, state])), UPA);
  const plans = parcels.map(p => planParcel({ parcel: p, state, units: opts.units ?? req.get(p.id), ctx, streets, occ: w.occ }));
  return { ctx, streets, plans, occ: w.occ, req };
}

// Every footprint point: inside its parcel, off roads, sidewalks, buildings and water, and in no other footprint.
function assertClean(result) {
  const { plans, occ } = result, all = plans.flatMap(p => p.buildings.map(b => ({ b, p })));
  for (const { b, p } of all) {
    const parcelRing = result.parcelsById?.get(p.id);
    for (let t = 0; t <= 1; t += .1) for (let u = 0; u <= 1; u += .1) {
      const [x0, z0, x1, z1, , , x3, z3] = b.ring; // P0, P1, (P2), P3: sample the bounding parallelogram of rectangles
      if (b.ring.length !== 8) continue;
      const x = x0 + (x1 - x0) * t + (x3 - x0) * u, z = z0 + (z1 - z0) * t + (z3 - z0) * u;
      const bits = occ(x, z);
      assert.equal(bits & (OCC.road | OCC.sidewalk | OCC.building | OCC.water), 0, `${b.type} in ${p.id} sits on something at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      if (parcelRing) assert.ok(inside(parcelRing, x, z), `${b.type} leaves ${p.id}`);
      for (const { b: o } of all) if (o !== b && o.ring.length === 8 && inside(o.ring, x, z)) assert.fail(`${b.type} overlaps another building`);
    }
  }
}
// Front edge (edge 0) outward normal: ring wound like OSM (outward is (-dz, dx)).
const frontNormal = b => { const [ax, az, bx, bz] = b.ring, l = Math.hypot(bx - ax, bz - az); return [(az - bz) / l, (bx - ax) / l]; };

// ---------- straight road ----------
const straight = (() => {
  const parcels = [parcel('s-1', rect(-70, 8, 70, 80))];
  return { roads: [{ cls: 'residential', w: 7, r: [-300, 0, 300, 0] }], parcels };
})();

test('beside a straight road: houses face it, set back, each with a front path to the sidewalk', () => {
  const r = plan(straight, 'low_res', { units: 6 }); // as many homes as the frontage holds
  r.parcelsById = new Map(straight.parcels.map(p => [p.id, p.ring]));
  const [p] = r.plans;
  assert.ok(p.buildings.length >= 3, `only ${p.buildings.length} buildings`);
  assert.equal(p.occupied, p.requested, 'every home fits on a deep frontage parcel');
  assertClean(r);
  for (const b of p.buildings) {
    const [nx, nz] = frontNormal(b);
    assert.ok(nz < -.99, `front faces the road (normal ${nx.toFixed(2)}, ${nz.toFixed(2)})`);
  }
  assert.equal(p.paths.length, p.buildings.reduce((n, b) => n + b.doors.length, 0), 'one front path per door');
  for (const q of p.paths) {
    const end = q.r[3]; // z of the street end
    assert.ok(Math.abs(end - (3.5 + 2.2)) < 1, `path reaches the sidewalk (ends at z ${end.toFixed(2)})`);
  }
  assert.equal(p.streets.length, 0, 'a frontage parcel builds on its road, not a new street');
});

test('plans are deterministic: the same inputs give the same plan', () => {
  const a = JSON.stringify(plan(straight, 'low_res').plans), b = JSON.stringify(plan(straight, 'low_res').plans);
  assert.equal(a, b);
});

test('neighbouring buildings never share a complete design', () => {
  const { plans } = plan({ ...straight, parcels: [parcel('s-2', rect(-150, 8, 150, 80))] }, 'low_res', { units: 14 });
  const bs = plans[0].buildings;
  assert.ok(bs.length >= 6);
  for (let i = 1; i < bs.length; i++) if (bs[i].side === bs[i - 1].side && bs[i].line === bs[i - 1].line) assert.notEqual(bs[i].signature, bs[i - 1].signature);
  assert.ok(new Set(bs.map(b => b.style.wall)).size >= 2, 'walls vary');
  assert.ok(new Set(bs.map(b => b.signature)).size >= bs.length * .7, 'designs vary');
});

// ---------- curved road ----------
test('beside a curved road: each building is squared to the road at its own lot', () => {
  const R = 160, arc = [];
  for (let a = -.9; a <= .9001; a += .05) arc.push(Math.sin(a) * R, R - Math.cos(a) * R); // bends toward +z, centre (0, R)
  const ringPts = [];
  for (let a = -.7; a <= .7001; a += .05) ringPts.push(Math.sin(a) * (R - 8), R - Math.cos(a) * (R - 8)); // inner edge, 8 m in
  for (let a = .7; a >= -.7001; a -= .05) ringPts.push(Math.sin(a) * (R - 75), R - Math.cos(a) * (R - 75));
  const site = { roads: [{ cls: 'residential', w: 7, r: arc }], parcels: [parcel('c-1', ringPts)] };
  const r = plan(site, 'low_res', { units: 8 });
  r.parcelsById = new Map([['c-1', ringPts]]);
  const bs = r.plans[0].buildings, L = new Line(arc);
  assert.ok(bs.length >= 5, `only ${bs.length} buildings`);
  assertClean(r);
  const angles = new Set();
  for (const b of bs) {
    const [nx, nz] = frontNormal(b), p = L.project(b.c[0], b.c[1]), toRoad = [p.x - b.c[0], p.z - b.c[1]].map((v, _, a) => v / Math.hypot(...a));
    assert.ok(nx * toRoad[0] + nz * toRoad[1] > .97, 'front faces the nearest point of the road');
    angles.add(Math.round(Math.atan2(nz, nx) * 20));
  }
  assert.ok(angles.size >= 3, 'the lots fan out round the bend');
});

// ---------- established neighbourhood ----------
test('in an established neighbourhood: neighbours set the setback and palette, existing buildings stay clear', () => {
  const buildings = [];
  for (let x = -140; x <= 140; x += 20) { // houses across the street, 7 m behind the sidewalk, in sage and sky siding
    const outer = rect(x - 5, -5.7 - 7 - 9, x + 5, -5.7 - 7);
    buildings.push({ family: 'house', cx: x, cz: -17, area: 90, outer, door: [x, -5.7 - 7 + 1.2], materials: { wall: x % 40 ? 'sidingSage' : 'sidingSky', roof: 'slate' } });
  }
  const inParcel = rect(10, 20, 24, 34); // a house already standing on the parcel
  buildings.push({ family: 'house', cx: 17, cz: 27, area: 196, outer: inParcel, door: null, materials: { wall: 'sidingWhite', roof: 'plum' } });
  const site = { roads: straight.roads, parcels: [parcel('e-1', rect(-90, 8, 90, 70))], buildings };
  const r = plan(site, 'low_res', { units: 6 });
  r.parcelsById = new Map([['e-1', site.parcels[0].ring]]);
  assert.ok(Math.abs(r.ctx.setback - 7) < 1, `setback read from the neighbours: ${r.ctx.setback}`);
  assert.ok(r.ctx.palette.house.walls.includes('sidingSage'), 'the palette leans to the neighbours\' walls');
  assertClean(r);
  for (const b of r.plans[0].buildings) {
    const front = Math.max(...[1, 3].map(k => b.ring[k])) > 0 ? Math.min(b.ring[1], b.ring[3]) : 0;
    assert.ok(front - 5.7 >= 6.9, `new houses line up with the neighbours' setback (${(front - 5.7).toFixed(1)} m)`);
  }
});

// ---------- wooded interior ----------
const wood = (() => {
  const parcels = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) parcels.push(parcel(`w-${i}${j}`, rect(-128 + i * 64, 8 + j * 64, -64 + i * 64, 72 + j * 64)));
  // A through road along the north edge with a side street (a junction at x = 0), and a trunk road on the east side.
  const roads = [{ cls: 'residential', w: 7, r: [-300, 0, 0, 0, 300, 0] }, { cls: 'residential', w: 7, r: [0, 0, 0, -200] }, { cls: 'trunk', w: 15, r: [200, -100, 200, 400] }];
  return { roads, parcels };
})();

test('deep in a wood: local streets reach the interior, meet roads square and away from junctions, and end in a turning circle', () => {
  const r = plan(wood, 'low_res');
  r.parcelsById = new Map(wood.parcels.map(p => [p.id, p.ring]));
  assert.ok(r.streets.length >= 1, 'the interior needs a street');
  for (const S of r.streets) {
    const [ax, az] = S.r;
    if (S.parent.kind === 'road') {
      assert.notEqual(wood.roads[S.parent.index]?.cls, 'trunk', 'no junction on a trunk road');
      assert.ok(Math.hypot(ax, az) >= STREET.fromJunction - .01, 'away from the junction at the origin');
    }
    assert.ok(S.len > 20 && S.bulb > 0, 'a real street with a turning circle');
    // The turning circle is clear land, not a wall or another road.
    const [cx, cz] = S.r.slice(2);
    for (let a = 0; a < 6.28; a += .5) assert.equal(r.occ(cx + Math.cos(a) * S.bulb, cz + Math.sin(a) * S.bulb) & (OCC.building | OCC.road), 0);
  }
  const deep = r.plans.find(p => p.id === 'w-03'); // the far corner: 200 m from the road
  assert.ok(deep.buildings.length > 0 && deep.streets.length > 0, 'the far corner is reached by a new street');
  assertClean(r);
  const all = summarize(r.plans);
  assert.ok(all.occupied >= all.requested * .6, `most homes fit: ${all.occupied} of ${all.requested}`);
});

test('only trees in footprints, front yards, paths and new streets are felled; the rest stay', () => {
  const r = plan(wood, 'low_res');
  const p = r.plans.find(q => q.buildings.length >= 2), ring = wood.parcels.find(q => q.id === p.id).ring;
  let felled = 0, kept = 0;
  for (let x = -128; x < 128; x += 1.7) for (let z = 8; z < 264; z += 1.9) {
    if (!inside(ring, x, z)) continue;
    if (!clears(p, x, z)) { kept++; continue; }
    felled++;
    // Felled ground is a footprint and its margin, or the front yard and path between a building and its street.
    const near = p.buildings.some(b => { const [fx, fz] = frontNormal(b), dx = x - b.c[0], dz = z - b.c[1], along = Math.abs(-dx * fz + dz * fx), out = dx * fx + dz * fz;
      return along <= b.w / 2 + 2.5 && out >= -b.d / 2 - 2.5 && out <= b.d / 2 + 24; });
    assert.ok(near, `a tree away from every building is felled at ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
  assert.ok(felled > 0 && kept > felled, `most of the parcel's trees stay (${kept} kept, ${felled} felled)`);
});

test('no tree crown reaches a wall: planted trees keep clear of homes, and lots keep clear of trees they can\'t fell', () => {
  const r = plan(wood, 'low_res');
  for (const p of r.plans) for (const t of p.plantings.filter(q => q.kind === 'yard' || q.kind === 'street'))
    for (const o of p.homes) assert.ok(rectDist(o, t.x, t.z) >= PLANT_CROWN - 1e-9, `a planted tree ${rectDist(o, t.x, t.z).toFixed(1)} m from a home`);
  // A park tree just outside the parcel (marked decor round its trunk, as land.js does) keeps homes a crown away.
  const p0 = parcel('k-1', rect(-60, 8, 60, 70)), w0 = world({ roads: straight.roads, parcels: [p0] });
  const occ = (x, z) => w0.occ(x, z) | (Math.hypot(x - 0, z - 73) < 1.4 ? OCC.decor : 0);
  const ctx = siteContext({ id: 'wood-90', parcels: [p0], roads: straight.roads, junctions: [], buildings: [] });
  const q = planParcel({ parcel: p0, state: 'low_res', units: 6, ctx, streets: [], occ });
  assert.ok(q.buildings.length > 0);
  for (const o of q.homes) assert.ok(rectDist(o, 0, 73) >= 5.5, 'no home within a crown of the park tree');
});

// ---------- demand mapping and unmet demand ----------
test('the sim\'s homes map to whole homes by largest remainder', () => {
  const ps = [0.1, 0.1, 0.1, 0.35].map((a, i) => ({ id: `u-${i}`, tags: ['wood-77'], state: 'forest', areaAcres: a }));
  const req = requestedUnits(ps, Object.fromEntries(ps.map(p => [p.id, 'low_res'])), UPA);
  const total = [...req.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, Math.round(4 * .65), 'the total is the sim total rounded');
  assert.equal(req.get('u-3'), 1, 'the biggest share keeps its whole home');
  assert.equal(requestedUnits(ps, { 'u-0': 'mid_res' }, UPA).get('u-0'), 2, 'mid_res 15 per acre');
  assert.equal(requestedUnits(ps, {}, UPA).size, 0, 'no conversion, no demand');
});

test('when land or access runs out, homes are reported unmet instead of forced in', () => {
  const tiny = { roads: straight.roads, parcels: [parcel('t-1', rect(0, 8, 14, 20))] };
  const p = plan(tiny, 'low_res', { units: 3 }).plans[0];
  assert.equal(p.buildings.length, 0);
  assert.equal(p.unmet, 3);
  assert.ok(p.reason);
  const island = { roads: straight.roads, parcels: [parcel('t-2', rect(-30, 400, 30, 460))] }; // no street within reach
  const q = plan(island, 'low_res', { units: 2 }).plans[0];
  assert.equal(q.occupied, 0); assert.equal(q.unmet, 2); assert.match(q.reason, /street|room/);
});

test('parcels converting together are planned as one block, so a building may span the line between them', () => {
  const a = parcel('b-1', rect(-20, 8, 0, 60)), b = parcel('b-2', rect(0, 8, 20, 60)); // each too narrow for a mid-rise
  const site = { roads: straight.roads, parcels: [a, b] }, w = world(site);
  const ctx = siteContext({ id: 'wood-90', parcels: [a, b], roads: site.roads, junctions: [], buildings: [] });
  const alone = [a, b].map(p => planParcel({ parcel: p, state: 'mixed_use', units: 20, ctx, streets: [], occ: w.occ }));
  const together = planBlock({ parcels: [a, b], state: 'mixed_use', units: 40, ctx, streets: [], occ: w.occ });
  const mixed = p => p.buildings.filter(b => b.type === 'mixed').length;
  assert.equal(alone.reduce((n, p) => n + mixed(p), 0), 0, 'neither parcel fits one alone');
  assert.ok(mixed(together) >= 1 && together.occupied > 0, 'together they do');
  assert.deepEqual(together.parcels, ['b-1', 'b-2']);
  assert.equal(summarize([together]).parcels, 2, 'the ledger still counts both parcels');
});

test('denser zones densify only as far as they need: townhouses first, apartments for more homes', () => {
  const site = { roads: straight.roads, parcels: [parcel('d-1', rect(-90, 8, 90, 70))] };
  const few = plan(site, 'mid_res', { units: 8 }).plans[0], many = plan(site, 'mid_res', { units: 60 }).plans[0];
  assert.ok(few.buildings.every(b => b.type === 'townhouse'), 'a few homes: townhouse rows');
  assert.ok(many.buildings.some(b => b.type === 'apartment'), 'many homes: apartments');
  assert.ok(many.occupied > few.occupied);
  for (const p of [few, many]) assert.ok(p.occupied <= p.requested && p.capacity >= p.occupied);
});
