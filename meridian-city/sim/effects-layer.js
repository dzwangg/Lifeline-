// What policies put on the street, drawn on the city year by year (shared/effects.js works out how much of each kind
// stands in each year; the sim worker sends it with the forecast as run.effects). Housing zone rules have their own
// layer (zone-layer.js); this one shows every lever:
//   painted protected bike lanes with bollards, cyclists riding them and racks at shops; red bus lanes; new bus stops
//   with buses pulling in (or crossed-out stops after a cut); parking meters (or free-parking signs); parking lots by new
//   homes; cranes and scaffolds (or permit-pending barriers); fast-track and taller-building notices; affordable-home
//   flags; a crane, then a banner, at Town Hall; now-hiring signs; shops reopening (or for lease) and grand openings;
//   sold (or for-sale) signs at homes; a community aid office with its queue; a job training centre; protected-forest
//   fences and signs.
// Every kind has a fixed list of spots on the map, ranked once (effects.js order()), so the first n are the same in every
// year and forecast and items stay put as their number grows. A year the clock plays into brings its new items in one by
// one over the year, as housing builds; a seek shows its year at once. Items draw on the shown-year side of the
// before/after wipe only, since year 0 has none. Hovering an item names the card behind it.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { simClock, onFrame } from './scenario.js';
import { KINDS, order } from '../../shared/effects.js';
import { LOD } from '../world/palette.js';
import { OCC } from '../world/geometry.js';
import { MAJOR, along } from '../world/streets.js';
import { CONSTRUCT } from './zone-layer.js';
import { createCyclists } from '../world/cyclists.js';

const DOWNTOWN = [-800, -900, 0, -300], CAMPUS = [-400, -650, 600, 300]; // as agent-layer.js: x0, z0, x1, z1
const inBox = (b, x, z) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
const clamp01 = v => Math.min(1, Math.max(0, v));
const BIKE_ROUTE_M = 5200, BUS_LANE_M = 3200; // how much of the map's streets the full lever paints
const PAINT = { bike: new THREE.Color('#3fae5a'), bus: new THREE.Color('#c8463a') };
const SHOW_FOR = .15; // each item takes this share of the year to appear, staggered over the rest

export function mountEffectsLayer({ world, zones = [] }) {
  const { scene } = world.view, { grid, art } = world, roads = world.streets.roads, half = q => q.w / 2, SW = world.streets.SIDEWALK_W ?? 2.2;
  const metas = world.buildings.meta.filter(m => m.door && !m.removed && !m.growth);
  const BLOCK = OCC.building | OCC.road | OCC.keepClear | OCC.decor | OCC.water;

  // ---------- sprite instances: billboards near (signs), far (cranes, banners), and decals (lots) ----------
  const parts = { near: [], far: [], decal: [] }; // { name, x, y, z, scale }
  const part = (layer, name, x, z, y = 0, scale = 1) => { const p = { layer, name, x, y, z, scale, slot: parts[layer].length }; parts[layer].push(p); return p; };
  // Spots in front of doors: a little out from the wall, away from the building's centre.
  const doorSpot = (m, out = 2.4, side = 0) => {
    const dx = m.door[0] - m.cx, dz = m.door[1] - m.cz, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    return [m.door[0] + ux * out - uz * side, m.door[1] + uz * out + ux * side];
  };
  const clearAt = (x, z, r, bits = BLOCK) => grid.clear(x, z, r, bits);
  const claim = (x, z, r) => grid.fill(x - r, z - r, x + r, z + r, OCC.decor);
  const doorsOf = (fams, seed, filter = () => true) => order(metas.filter(m => fams.includes(m.family) && filter(m)).map(m => ({ x: m.door[0], z: m.door[1], m })), seed);
  // Open ground beside a building, for a lot, a crane or a barrier: tried on four sides at a distance past its footprint.
  const besideSpots = (fams, seed, r) => {
    const out = [];
    for (const { m } of doorsOf(fams, seed)) {
      const d = Math.sqrt(m.area ?? 200) / 2 + r + 2;
      for (const [ax, az] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const x = m.cx + ax * d, z = m.cz + az * d;
        if (clearAt(x, z, r, BLOCK | OCC.sidewalk | OCC.lot | OCC.zone)) { out.push({ x, z, m }); claim(x, z, r); break; }
      }
    }
    return out;
  };

  // kind -> { pos: [item], neg: [item] }; an item is { parts: [part], x, z }
  const items = {};
  const kind = (k, pos = [], neg = []) => { items[k] = { pos, neg }; };
  const take = (list, max) => list.slice(0, max);

  // Bike routes: quieter through streets, painted on both sides (green, with bollards every 6 m) in rank order.
  const bikeRoads = order(roads.filter(q => ['secondary', 'tertiary', 'unclassified', 'residential'].includes(q.cls) && q.len > 80).map(q => ({ x: q.r[0], z: q.r[1], q })), 11);
  const busRoads = order(roads.filter(q => MAJOR.has(q.cls) && q.len > 120).map(q => ({ x: q.r[0], z: q.r[1], q })), 12);
  function paintRoutes(list, budget, offset, width, color, bollards) {
    const pos = [], col = [], marks = []; // marks: [t, x, z] along the painted total (0 to 1 of budget)
    const routes = []; let total = 0;
    for (const { q } of list) {
      if (total >= budget) break;
      const o = offset(q), segs = [];
      along(q.r, 2, 8, 8, (x, z, ux, uz, s) => { segs.push([x, z, ux, uz, s]); });
      if (segs.length < 4) continue;
      const start = total;
      for (const [x, z, ux, uz] of segs) {
        const nx = uz, nz = -ux; // left of travel
        for (const side of [-1, 1]) {
          const cx = x + nx * o * side, cz = z + nz * o * side, hx = ux, hz = uz, wx = nx * width / 2, wz = nz * width / 2, y = .068;
          pos.push(cx - hx - wx, y, cz - hz - wz, cx + hx - wx, y, cz + hz - wz, cx + hx + wx, y, cz + hz + wz, cx - hx - wx, y, cz - hz - wz, cx + hx + wx, y, cz + hz + wz, cx - hx + wx, y, cz - hz + wz);
          for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
        }
        total += 2;
      }
      if (bollards) along(q.r, 6, 9, 9, (x, z, ux, uz, s) => { for (const side of [-1, 1]) marks.push([start + s, x + uz * (o - width / 2 - .3) * side, z - ux * (o - width / 2 - .3) * side]); });
      routes.push({ q, start, end: total, o });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -5.5, polygonOffsetUnits: -11 }));
    mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.layers.set(2); mesh.renderOrder = 1;
    g.setDrawRange(0, 0);
    scene.add(mesh);
    return { mesh, total, quadsPerMetre: 2 * 6 / 2, routes, marks: marks.map(([s, x, z]) => [s / total, x, z]) };
  }
  const bike = paintRoutes(bikeRoads, BIKE_ROUTE_M, q => half(q) - .9, 1.3, PAINT.bike, true);
  const busLane = paintRoutes(busRoads.filter(({ q }) => !q.ow), BUS_LANE_M, q => half(q) - 1.7, 2.6, PAINT.bus, false);
  const bollards = bike.marks.map(([t, x, z]) => ({ t, part: part('near', 'bollard', x, z) }));
  kind('bikeLanes');

  // Shops' doors (open, for lease, grand openings, racks), offices', houses', apartments', civic and campus doors.
  const shopDoors = doorsOf(['shop'], 21);
  const spot = (m, out, side) => { const [x, z] = doorSpot(m, out, side), dx = m.door[0] - m.cx, dz = m.door[1] - m.cz, l = Math.hypot(dx, dz) || 1; return { x, z, face: [dx / l, dz / l] }; }; // face: the way the door looks out
  kind('shops',
    take(shopDoors, KINDS.shops.max).map(({ m }) => { const s = spot(m, 1.6, 1.2); return { ...s, parts: [part('near', 'openSign', s.x, s.z)] }; }),
    take(shopDoors, KINDS.shops.max).map(({ m }) => { const s = spot(m, 1.6, 1.2); return { ...s, parts: [part('near', 'forLease', s.x, s.z)] }; }));
  kind('grandOpening', take(doorsOf(['shop'], 22), KINDS.grandOpening.max).map(({ m }) => { const s = spot(m, .6, 0); return { ...s, parts: [part('far', 'grandOpening', s.x, s.z, 3.4)] }; }));
  kind('bikeRacks', take(doorsOf(['shop', 'campus', 'office'], 23), KINDS.bikeRacks.max).map(({ m }) => { const s = spot(m, 2.6, -2); return { ...s, parts: [part('near', 'bikeRack', s.x, s.z)] }; }));
  kind('hiring', take(doorsOf(['shop', 'office', 'industrial'], 24), KINDS.hiring.max).map(({ m }) => { const s = spot(m, 1.8, -1.2); return { ...s, parts: [part('near', 'nowHiring', s.x, s.z)] }; }));
  const houseDoors = doorsOf(['house'], 25);
  kind('homeSales',
    take(houseDoors, KINDS.homeSales.max).map(({ m }) => { const s = spot(m, 3, 1.5); return { ...s, parts: [part('near', 'sold', s.x, s.z)] }; }),
    take(houseDoors, KINDS.homeSales.max).map(({ m }) => { const s = spot(m, 3, 1.5); return { ...s, parts: [part('near', 'forSale', s.x, s.z)] }; }));
  kind('affordable', take(doorsOf(['apartment'], 26), KINDS.affordable.max).map(({ m }) => { const s = spot(m, 2.2, 1.6); return { ...s, parts: [part('near', 'affordableFlag', s.x, s.z)] }; }));
  kind('upzone', take(doorsOf(['apartment', 'shop', 'office'], 27, m => inBox(DOWNTOWN, m.cx, m.cz) || inBox(CAMPUS, m.cx, m.cz)), KINDS.upzone.max)
    .map(({ m }) => { const s = spot(m, 2.6, -1.8); return { ...s, parts: [part('near', 'zoningNotice', s.x, s.z)] }; }));
  kind('fastTrack', take(doorsOf(['civic', 'office'], 28), KINDS.fastTrack.max).map(({ m }) => { const s = spot(m, 2, 0); return { ...s, parts: [part('near', 'fastTrack', s.x, s.z)] }; }));

  // Building sites beside apartments, shops and houses: a crane over a scaffold, or a permit-pending barrier.
  const sites = besideSpots(['apartment', 'shop', 'house', 'office'], 31, 6);
  kind('construction',
    take(sites, KINDS.construction.max).map(s => ({ ...s, parts: [part('far', 'crane', s.x, s.z), part('far', 'scaffold', s.x + 3, s.z + 2)] })),
    take(sites, KINDS.construction.max).map(s => ({ ...s, parts: [part('near', 'permitPending', s.x, s.z)] })));
  kind('parkingLots', take(besideSpots(['apartment', 'house'], 32, 5), KINDS.parkingLots.max).map(s => ({ ...s, parts: [part('decal', 'parkingLot', s.x, s.z, .07)] })));

  // Town Hall (or the largest civic building): a crane and scaffold while a project is under way, then a banner.
  const hall = metas.find(m => /town hall/i.test(m.name ?? '')) ?? metas.filter(m => m.family === 'civic').sort((a, b) => (b.area ?? 0) - (a.area ?? 0))[0];
  if (hall) {
    const [hx, hz] = doorSpot(hall, 6, 6), [bx, bz] = doorSpot(hall, 1.2, 0);
    kind('civicWorks', [{ x: hx, z: hz, parts: [part('far', 'crane', hx, hz), part('far', 'scaffold', hx - 2, hz + 3)] }]);
    kind('civicDone', [{ x: bx, z: bz, parts: [part('far', 'civicBanner', bx, bz, 3.6)] }]);
  } else { kind('civicWorks'); kind('civicDone'); }
  // A queue at a door: a sign (banner or board) and people lined up away from the door.
  const queue = (m, sign, n, y) => {
    if (!m) return [];
    const dx = m.door[0] - m.cx, dz = m.door[1] - m.cz, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    const list = [{ x: m.door[0], z: m.door[1], parts: [part('far', sign, m.door[0] + ux * .8, m.door[1] + uz * .8, y)] }];
    for (let i = 1; i < n; i++) {
      const x = m.door[0] + ux * (1.6 + i * .9) - uz * ((i % 2) * .3), z = m.door[1] + uz * (1.6 + i * .9) + ux * ((i % 2) * .3);
      list.push({ x, z, parts: [part('near', `person${(i * 7) % 10}_0`, x, z)] });
    }
    return list;
  };
  const civic = metas.filter(m => m.family === 'civic' && m !== hall);
  kind('aid', queue(civic.find(m => inBox(DOWNTOWN, m.cx, m.cz)) ?? civic[0] ?? hall, 'aidBanner', KINDS.aid.max, 3.2));
  kind('training', queue(metas.find(m => m.family === 'campus' && inBox(CAMPUS, m.cx, m.cz)) ?? metas.find(m => m.family === 'campus'), 'trainingSign', KINDS.training.max, 0));

  // Parking downtown: meters along the kerbs of its major streets (a P sign every fourth), or free-parking signs.
  const kerbs = [];
  for (const q of roads) if (MAJOR.has(q.cls) && inBox(DOWNTOWN, q.r[0], q.r[1])) along(q.r, 9, 12, 12, (x, z, ux, uz) => {
    for (const side of [-1, 1]) { const o = (half(q) + .5) * side, px = x + uz * o, pz = z - ux * o; if (clearAt(px, pz, .5, OCC.building | OCC.keepClear | OCC.decor)) kerbs.push({ x: px, z: pz }); }
  });
  const meterSpots = take(order(kerbs, 33), KINDS.parking.max);
  kind('parking',
    meterSpots.map((s, i) => ({ ...s, parts: [part('near', i % 4 ? 'parkingMeter' : 'parkSign', s.x, s.z)] })),
    meterSpots.map((s, i) => ({ ...s, parts: i % 2 ? [] : [part('near', 'freePark', s.x, s.z)] })));

  // Protected forest: post-and-rail fence along the woods' edges, with a sign every fifth post.
  const forest = [];
  for (const z of zones) if (z.state === 'forest') {
    const ring = z.ring;
    for (let i = 0; i + 3 < ring.length; i += 2) {
      const ax = ring[i], az = ring[i + 1], bx = ring[i + 2], bz = ring[i + 3], l = Math.hypot(bx - ax, bz - az);
      for (let s = 6; s < l - 6; s += 18) { const x = ax + (bx - ax) * s / l, zz = az + (bz - az) * s / l; if (clearAt(x, zz, 1.2, OCC.building | OCC.road)) forest.push({ x, z: zz }); }
    }
  }
  kind('protect', take(order(forest, 34), KINDS.protect.max).map((s, i) => ({ ...s, parts: [part('near', i % 5 ? 'fence' : 'forestSign', s.x, s.z)] })));

  // Bus stops: new ones half way between the street's own (every 260 m from 90 m), or the old ones crossed out after a cut.
  const stopsNew = [];
  for (const { q } of busRoads) if (q.len > 200) along(q.r, 260, 40, 40, (x, z, ux, uz) => {
    const o = half(q) + SW + 1.4, px = x + uz * o, pz = z - ux * o;
    if (clearAt(px, pz, 3)) { stopsNew.push({ x: px, z: pz, rx: x, rz: z, ux, uz, q, side: 1 }); claim(px, pz, 3); }
  }, 220);
  const stopsOld = [];
  for (const f of world.streets.furniture ?? []) if (f.name === 'busStop') {
    let best = null; // the major road beside it, for where a bus pulls in
    for (const q of roads) if (MAJOR.has(q.cls)) along(q.r, 4, 0, 0, (x, z, ux, uz) => { const d = (x - f.x) ** 2 + (z - f.z) ** 2; if (!best || d < best.d) best = { d, x, z, ux, uz }; });
    if (best && best.d < 15 * 15) stopsOld.push({ x: f.x, z: f.z, rx: best.x, rz: best.z, ux: best.ux, uz: best.uz, side: Math.sign((f.x - best.x) * best.uz - (f.z - best.z) * best.ux) || 1 });
  }
  const newStops = take(order(stopsNew, 35), KINDS.busStops.max), oldStops = take(order(stopsOld, 36), KINDS.busStops.max);
  kind('busStops',
    newStops.map(s => ({ ...s, parts: [part('near', 'busStop', s.x, s.z), part('near', 'bench', s.x + 3, s.z + .5)] })),
    oldStops.map(s => ({ ...s, parts: [part('near', 'serviceCut', s.x - 2.5, s.z)] })));
  kind('buses'); kind('cyclists'); kind('busLanes');

  // ---------- the instanced meshes ----------
  const near = world.sprites.dynamicLayer(scene, Math.max(1, parts.near.length), { minZoom: LOD.furniture });
  const far = world.sprites.dynamicLayer(scene, Math.max(1, parts.far.length), { minZoom: LOD.macro });
  const decal = world.sprites.dynamicLayer(scene, Math.max(1, parts.decal.length), { decal: true, minZoom: LOD.macro, renderOrder: 1 });
  const layers = { near, far, decal };
  for (const [name, L] of Object.entries(layers)) {
    const list = parts[name], uv = L.uv.array, ph = L.phase.array;
    list.forEach((p, i) => { const s = art.sprites[p.name]; if (!s) throw new Error(`effects: no sprite ${p.name}`); uv.set(s.uv, i * 4); p.size = [s.w * p.scale, s.h * p.scale, 0]; ph[i] = name === 'decal' ? (p.x * .013) % Math.PI : i * .7; });
    L.mesh.count = list.length; L.mesh.layers.set(2);
    L.uv.needsUpdate = true; L.phase.needsUpdate = true;
  }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const dirty = new Set();
  function show(p, k) { // k: 0 hidden to 1 shown
    const L = layers[p.layer];
    if (p.layer === 'decal') L.size.array.set(k > .5 ? p.size : [0, 0, 0], p.slot * 3);
    else { L.size.array.set(p.size, p.slot * 3); _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(k, k, k)); L.mesh.setMatrixAt(p.slot, _m); }
    if (p.layer === 'decal') _m.makeTranslation(p.x, p.y, p.z), L.mesh.setMatrixAt(p.slot, _m);
    p.k = k; dirty.add(L);
  }
  const flush = () => { for (const L of dirty) { L.mesh.instanceMatrix.needsUpdate = true; L.size.needsUpdate = true; } dirty.clear(); };
  for (const list of Object.values(parts)) for (const p of list) show(p, 0);
  flush();

  // ---------- movers: cyclists on painted lanes, buses pulling in at stops ----------
  // Cyclists are people on bikes (world/cyclists.js), dressed like the walkers; buses are the street's own.
  const bikes = createCyclists(scene, KINDS.cyclists.max);
  for (const m of bikes.meshes) { m.layers.set(2); world.lod(m, { minZoom: LOD.cars }); }
  let buses = null, t = 0;
  world.trafficReady?.then(traffic => {
    if (!traffic.vehicleMesh) return;
    buses = traffic.vehicleMesh('bus', newStops.length + oldStops.length);
    for (let i = 0; i < newStops.length + oldStops.length; i++) buses.setColorAt(i, new THREE.Color('#2f6fb8'));
    buses.layers.set(2); scene.add(buses); lodVehicles(buses);
  });
  const lodVehicles = m => world.lod(m, { minZoom: LOD.cars });
  // A point s metres along a polyline, with its direction.
  const pointAt = (r, s, out) => {
    for (let i = 0; i + 2 < r.length; i += 2) {
      const l = Math.hypot(r[i + 2] - r[i], r[i + 3] - r[i + 1]);
      if (s <= l || i + 4 >= r.length) { const k = Math.min(1, s / (l || 1)); out.ux = (r[i + 2] - r[i]) / (l || 1); out.uz = (r[i + 3] - r[i + 1]) / (l || 1); out.x = r[i] + (r[i + 2] - r[i]) * k; out.z = r[i + 1] + (r[i + 3] - r[i + 1]) * k; return out; }
      s -= l;
    }
    return out;
  };
  const tmp = {}, UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1), RIDER = new THREE.Vector3(1.6, 1.6, 1.6); // as big on screen as the walkers
  let state = { bikeFrac: 0, busFrac: 0, cyclists: 0, buses: 0 };
  function moveVehicles(dt) {
    t += dt;
    {
      const painted = bike.routes.filter(r => r.end / bike.total <= state.bikeFrac + 1e-6);
      const n = painted.length ? state.cyclists : 0;
      for (let i = 0; i < n; i++) {
        const R = painted[i % painted.length], L = R.q.len - 16, ride = i * 97.3 + t * (3.8 + (i % 5) * .4), s = (ride % (2 * L) + 2 * L) % (2 * L), back = s > L;
        pointAt(R.q.r, 8 + (back ? 2 * L - s : s), tmp);
        const side = back ? 1 : -1, o = R.o * side; // ride on the right of their way
        const ux = back ? -tmp.ux : tmp.ux, uz = back ? -tmp.uz : tmp.uz;
        _m.compose(_p.set(tmp.x + tmp.uz * o, .06, tmp.z - tmp.ux * o), _q.setFromAxisAngle(UP, Math.atan2(-uz, ux)), RIDER);
        bikes.set(i, _m, Math.floor(ride / .9) % 2); // a pedal stroke every 0.9 m
      }
      bikes.show(n);
    }
    if (buses) {
      let k = 0;
      const stops = state.buses > 0 ? [...newStops.slice(0, state.busStopsShown), ...oldStops] : [];
      const duty = .15 + .6 * state.buses;
      stops.forEach((s, i) => {
        if (((t / 45 + i * .618) % 1) >= duty) return; // between buses
        // at the kerb on the stop's side, facing the way traffic drives on that side (on the right)
        const o = s.side * (half(s.q ?? { w: 13 }) - 1.6), ux = -s.side * s.ux, uz = -s.side * s.uz;
        _m.compose(_p.set(s.rx + s.uz * o, .06, s.rz - s.ux * o), _q.setFromAxisAngle(UP, Math.atan2(-uz, ux)), ONE);
        buses.setMatrixAt(k++, _m);
      });
      buses.count = k; buses.instanceMatrix.needsUpdate = true;
    }
  }
  onFrame(dt => moveVehicles(Math.min(dt, .1)));

  // ---------- the clock: how many of each kind stand, and the year's new ones coming in ----------
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let drawn = null, drawnBefore = null, lastP = -1, from = null, to = null, attribution = {};
  const counts = row => Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, { pos: v.i > 0 ? v.n : 0, neg: v.i < 0 ? v.n : 0, i: v.i }]));
  function draw(p) {
    for (const [k, { pos, neg }] of Object.entries(items)) for (const [look, list] of [['pos', pos], ['neg', neg]]) {
      const a = from[k]?.[look] ?? 0, b = to[k]?.[look] ?? 0, lo = Math.min(a, b), hi = Math.max(a, b);
      list.forEach((it, j) => {
        let s = j < lo ? 1 : j >= hi ? 0 : clamp01((p - (j - lo) / Math.max(1, hi - lo) * (1 - SHOW_FOR)) / SHOW_FOR);
        if (j >= lo && j < hi && a > b) s = 1 - s; // going away
        for (const pt of it.parts) if (pt.k !== s) show(pt, s);
        it.k = s;
      });
    }
    // paint: the share of the routes painted grows through the year
    const lerp = (k, f) => (from[k]?.i ?? 0) + ((to[k]?.i ?? 0) - (from[k]?.i ?? 0)) * f;
    const bf = Math.max(0, lerp('bikeLanes', p)), lf = Math.max(0, lerp('busLanes', p));
    bike.mesh.geometry.setDrawRange(0, 12 * Math.floor(bf * bike.total / 2));
    busLane.mesh.geometry.setDrawRange(0, 12 * Math.floor(lf * busLane.total / 2));
    for (const b of bollards) { const s = b.t <= bf ? 1 : 0; if (b.part.k !== s) show(b.part, s); }
    const stopsShown = Math.round(lerp('busStops', p) * KINDS.busStops.max);
    state = { bikeFrac: bf, busFrac: lf, cyclists: Math.round(Math.max(0, lerp('cyclists', p)) * KINDS.cyclists.max), buses: Math.max(0, lerp('buses', p)), busStopsShown: Math.max(0, stopsShown) };
    flush();
  }
  simClock.subscribe(({ shown, frac, before }) => {
    if (!shown?.data) return;
    const fx = shown.data.run?.effects;
    if (shown !== drawn || before !== drawnBefore) {
      drawn = shown; drawnBefore = before;
      attribution = shown.data.run?.attribution ?? {};
      to = counts(before || !fx ? null : fx[shown.step]);
      from = !before && fx && shown.tween && !still && shown.step > 0 ? counts(fx[shown.step - 1]) : to;
      lastP = -1;
    }
    const p = from === to ? 1 : clamp01(frac / CONSTRUCT);
    if (p === lastP) return;
    lastP = p;
    draw(p);
  });

  // ---------- hover: what is this, and which card put it here ----------
  const tip = document.createElement('div');
  tip.className = 'fx-tip'; tip.hidden = true; tip.setAttribute('role', 'status');
  Object.assign(tip.style, { position: 'fixed', zIndex: 30, pointerEvents: 'none', padding: '4px 8px', font: '600 12px var(--ae-pixel, monospace)', color: '#1c2c5e',
    background: '#ffffff', border: '2px solid #1c2c5e', borderRadius: '6px', boxShadow: '0 2px 0 rgba(28,44,94,.4)', maxWidth: '280px' });
  document.body.append(tip);
  const v3 = new THREE.Vector3(), dom = world.view.renderer.domElement;
  const toScreen = (x, z, y = 1.5) => { v3.set(x, y, z).project(world.view.camera); const r = dom.getBoundingClientRect(); return [r.left + (v3.x + 1) / 2 * r.width, r.top + (1 - v3.y) / 2 * r.height]; };
  const describe = (k, look) => {
    const e = KINDS[k], by = attribution[k] ?? [], label = look === 'neg' ? e.neg ?? e.label : e.label;
    return by.length ? `${label}: ${by.map(c => `${c.title}${c.start ? ` (from ${2026 + c.start})` : ''}`).join(', ')}` : label;
  };
  let pending = false;
  dom.addEventListener('pointermove', e => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (world.view.ppm < LOD.furniture) { tip.hidden = true; return; }
      let best = null, bd = 18 * 18;
      for (const [k, { pos, neg }] of Object.entries(items)) for (const [look, list] of [['pos', pos], ['neg', neg]]) for (const it of list) {
        if (!(it.k > .5)) continue;
        const [sx, sy] = toScreen(it.x, it.z), d = (sx - e.clientX) ** 2 + (sy - e.clientY) ** 2;
        if (d < bd) { bd = d; best = describe(k, look); }
      }
      if (!best && state.bikeFrac > 0) { // a painted lane
        const g = world.view.screenToGround?.(e.clientX, e.clientY);
        if (g) for (const [t, x, z] of bike.marks) if (t <= state.bikeFrac && (x - g.x) ** 2 + (z - g.z) ** 2 < 9) { best = describe('bikeLanes', 'pos'); break; }
      }
      tip.hidden = !best;
      if (best) { tip.textContent = best; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 14}px`; }
    });
  });
  for (const ev of ['pointerleave', 'pointerdown', 'wheel']) dom.addEventListener(ev, () => { tip.hidden = true; }, { passive: true });

  // Where a year's items of these kinds stand: row is one year of run.effects (shown or not). For the changes tour
  // (focus.js), which frames them. Painted lanes give points along what is painted, a few per route.
  function points(kinds, row) {
    const out = [];
    for (const k of kinds) {
      const r = row?.[k];
      if (!r?.i) continue;
      if (k === 'bikeLanes' || k === 'busLanes') {
        const P = k === 'bikeLanes' ? bike : busLane, f = Math.max(0, r.i);
        for (const R of P.routes) if (R.start / P.total < f) { const { q } = R; for (let i = 0; i < q.r.length; i += Math.max(2, 2 * Math.floor(q.r.length / 8))) out.push([q.r[i], q.r[i + 1]]); }
      } else if (items[k]) for (const it of (r.i < 0 ? items[k].neg : items[k].pos).slice(0, r.n)) out.push([it.x, it.z, ...(it.face ?? [])]);
    }
    return out;
  }

  // The changes tour's pins: a gold arrow bobbing over each standing item of the stop's kinds, drawn over buildings so
  // a sign behind a roof is still found (focus.js calls highlight(kinds), and highlight(null) when the tour ends).
  const PINS = 64, pins = world.sprites.dynamicLayer(scene, PINS, { minZoom: LOD.macro, renderOrder: 1002 });
  pins.material.depthTest = false; pins.mesh.layers.set(2);
  { const s = art.sprites.pin; for (let i = 0; i < PINS; i++) { pins.uv.array.set(s.uv, i * 4); pins.size.array.set([s.w * 2, s.h * 2, 0], i * 3); } pins.uv.needsUpdate = pins.size.needsUpdate = true; }
  pins.mesh.count = 0;
  // What a stop has planned but not yet built in the shown year (it is still to come in the forecast) shows faded, as the
  // zone layer outlines parcels converted later: ghosts of its items in their spots, see-through and over the roofs.
  const GHOSTS = 200, ghosts = world.sprites.dynamicLayer(scene, GHOSTS, { minZoom: LOD.macro, transparent: true, opacity: .68, renderOrder: 1001 });
  ghosts.material.depthTest = false; ghosts.mesh.layers.set(2); ghosts.mesh.count = 0;
  let pinKinds = null, pinRow = null, pinAt = [];
  const top = it => Math.max(4, ...it.parts.map(p => (p.size?.[1] ?? 2) + p.y)) + 1.5;
  function placePins() {
    pinAt = [];
    const ghostParts = [];
    if (pinKinds) for (const k of pinKinds) {
      const end = pinRow?.[k];
      if (k === 'bikeLanes') {
        const f = Math.max(0, end?.i ?? 0), lit = bollards.filter(b => b.part.k > .5), planned = bollards.filter(b => b.part.k <= .5 && b.t <= f);
        for (let i = 0; i < lit.length; i += 12) pinAt.push([lit[i].part.x, lit[i].part.z, 2.5]);
        for (let i = 0; i < planned.length; i += 2) ghostParts.push(planned[i].part);
        for (let i = 0; i < planned.length; i += 12) pinAt.push([planned[i].part.x, planned[i].part.z, 2.5]);
        continue;
      }
      if (k === 'busLanes') { for (const R of busLane.routes) if (R.start / busLane.total < Math.max(state.busFrac, end?.i ?? 0)) pinAt.push([R.q.r[0], R.q.r[1], 2.5]); continue; }
      const list = items[k] ? (end?.i < 0 ? items[k].neg : items[k].pos) : [];
      for (const it of [...(items[k]?.pos ?? []), ...(items[k]?.neg ?? [])]) if (it.k > .5) pinAt.push([it.x, it.z, top(it)]);
      for (const it of list.slice(0, end?.n ?? 0)) if (!(it.k > .5)) { ghostParts.push(...it.parts.filter(p => p.layer !== 'decal')); pinAt.push([it.x, it.z, top(it)]); }
    }
    pinAt = pinAt.slice(0, PINS);
    pins.mesh.count = pinAt.length;
    const g = ghostParts.slice(0, GHOSTS);
    g.forEach((p, i) => {
      ghosts.uv.array.set(art.sprites[p.name].uv, i * 4); ghosts.size.array.set(p.size, i * 3);
      _m.makeTranslation(p.x, p.y, p.z); ghosts.mesh.setMatrixAt(i, _m);
    });
    ghosts.mesh.count = g.length;
    ghosts.uv.needsUpdate = ghosts.size.needsUpdate = ghosts.mesh.instanceMatrix.needsUpdate = true;
  }
  // While a stop is pinned, the effect signs draw over buildings too, so the change itself shows, not just where it is.
  // end: the forecast's last year of run.effects, for what is still to come.
  const highlight = (kinds, end = null) => {
    pinKinds = kinds?.length ? kinds : null; pinRow = end;
    for (const L of [near, far]) { L.material.depthTest = !pinKinds; L.mesh.renderOrder = pinKinds ? 1001 : 0; }
    placePins();
  };
  let bob = 0;
  onFrame(dt => {
    if (!pinAt.length) return;
    bob += dt;
    pinAt.forEach(([x, z, y], i) => { _m.makeTranslation(x, y + .5 * Math.sin(bob * 3 + i), z); pins.mesh.setMatrixAt(i, _m); });
    pins.mesh.instanceMatrix.needsUpdate = true;
  });
  simClock.subscribe(() => { if (pinKinds) placePins(); }); // items come and go with the year

  // For the changes tour, the console and the browser checks (?debug): what stands now.
  world.effects = { items, bike, busLane, points, highlight, get attribution() { return attribution; }, get state() { return state; }, counts: () => Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { pos: v.pos.filter(i => i.k > .5).length, neg: v.neg.filter(i => i.k > .5).length }])) };
}
