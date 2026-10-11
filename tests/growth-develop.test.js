// A forecast's development (meridian-city/growth/develop.js): every home the sim builds gets valid room, year by year,
// or is reported with the constraint that stops it. The regression is the corridor mid-rise card at its defaults on the
// real map (a dump of the live map's occupancy, parcels, roads and buildings round the sites it converts): it used to
// leave 59 homes unplaced ("59 new homes didn't fit"); now all of them stand on valid land. Synthetic sites check the
// ladder (rows, courts), sharing homes out to earlier land of the same kind (never later, never another kind), the
// ledger's reconciliation with the sim, and the constraints reported when nothing valid is left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createDevelopment } from '../meridian-city/growth/develop.js';
import { siteContext, findJunctions } from '../meridian-city/growth/context.js';
import { requestedUnits, simUnits, summarize } from '../meridian-city/growth/units.js';
import { OCC, Line, segDist } from '../meridian-city/growth/geom.js';
import { inside } from '../meridian-city/world/rings.js';
import { runScenario } from '../shared/sim.js';
import { zones as allZones, assumptions, baselines, cards } from './data.js';

const UPA = assumptions.unitsPerAcre.value;

// ---------- the corridor mid-rise regression, on the real map ----------
const dump = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/growth-corridor-midrise.json.gz', import.meta.url))));
for (const s of dump.sites) {
  const bin = Buffer.from(s.occ, 'base64'), [x0, z0, x1, z1] = s.box;
  s.at = (x, z) => { const i = Math.floor(x) - x0, j = Math.floor(z) - z0; return i < 0 || j < 0 || i >= x1 - x0 || j >= z1 - z0 ? 255 : bin[j * (x1 - x0) + i]; };
}
const occ = (x, z) => { for (const s of dump.sites) { const [a, b, c, d] = s.box; if (x >= a && x < c && z >= b && z < d) return s.at(x, z); } return 255; };
const dumpZones = dump.sites.flatMap(s => s.parcels);
function developDump(share = true) {
  const byId = new Map(dump.sites.map(s => [s.id, s])), ctxs = new Map();
  const ctxOf = site => {
    if (!ctxs.has(site.id)) { const s = byId.get(site.id); ctxs.set(site.id, siteContext({ id: s.id, parcels: s.parcels, roads: s.roads, junctions: findJunctions(s.roads), buildings: s.buildings })); }
    return ctxs.get(site.id);
  };
  const D = createDevelopment({ zones: dumpZones, upa: UPA, ctxOf, occ, share });
  D.setForecast(dump.timeline, []);
  D.planThrough(Infinity);
  return D;
}

test('the fixture is the sim\'s own corridor mid-rise forecast', () => {
  const card = cards.find(c => c.id === 'corridor-midrise');
  const sim = runScenario([card], {}, allZones, assumptions, baselines);
  for (let y = 0; y < dump.timeline.length; y++) for (const [id, state] of Object.entries(dump.timeline[y])) assert.equal(sim.timeline[y].zoneStates[id], state, `${id} in year ${y}`);
});

test('corridor mid-rise at its defaults: every home the sim builds has a valid place (it used to leave 59 unplaced)', () => {
  const D = developDump(), plans = D.blocks().map(b => b.plan), t = summarize(plans);
  const raw = dumpZones.reduce((n, z) => n + simUnits(z, z.state, dump.timeline.at(-1)[z.id], UPA), 0);
  assert.equal(t.requested, Math.round(raw), 'the map asks for the sim\'s homes (299.55, which the sim counts as 300)');
  assert.equal(t.occupied, t.requested, `${t.requested - t.occupied} homes unplaced`);
  assert.equal(t.unmet, 0);
  for (const p of plans) assert.equal(p.constraint, undefined);
  // Without sharing, a block's own land runs short: the sharing is what places the last homes, not a forced fit.
  assert.ok(summarize(developDump(false).blocks().map(b => b.plan)).unmet > 0);
});

test('corridor mid-rise: every building stands on land its policy built, clear of roads, walls, water and each other, with a way in', () => {
  const D = developDump(), blocks = D.blocks(), all = [];
  const ringOf = new Map(dumpZones.map(z => [z.id, z.ring]));
  for (const b of blocks) {
    const p = b.plan, lands = [b.parcels.map(z => z.ring), ...p.annexes.map(a => a.parcels.map(id => ringOf.get(id)))].flat();
    const ownLand = (x, z) => lands.some(r => inside(r, x, z));
    const courts = p.courts, streets = [b.site, ...p.annexes.map(a => D.sites.get(a.site))].flatMap(site => D.streets(site));
    for (const bd of p.buildings) {
      assert.equal(bd.ring.length, bd.type === 'detached' ? bd.ring.length : 8);
      const [ax, az, bx, bz, , , dx, dz] = bd.ring;
      if (bd.ring.length === 8) for (let u = 0; u <= 1; u += .1) for (let v = 0; v <= 1; v += .1) {
        const x = ax + (bx - ax) * u + (dx - ax) * v, z = az + (bz - az) * u + (dz - az) * v;
        assert.equal(occ(x, z) & (OCC.road | OCC.sidewalk | OCC.building | OCC.water | OCC.keepClear), 0, `${bd.type} in ${p.id} sits on something`);
        assert.ok(ownLand(x, z), `${bd.type} in ${p.id} leaves the land its policy built`);
        for (const o of all) if (o.ring.length === 8 && inside(o.ring, x, z)) assert.fail(`${bd.type} in ${p.id} overlaps another building`);
      }
      all.push(bd);
    }
    // Each front walk ends at a sidewalk, a new street or a court.
    for (const w of p.paths) {
      const [x, z] = w.r.slice(2);
      const kerb = [-1, 0, 1].some(dx => [-1, 0, 1].some(dz => occ(x + dx, z + dz) & (OCC.sidewalk | OCC.road)));
      const street = streets.some(S => segDist(x, z, ...S.r) < S.half + S.sw + 1.5 || Math.hypot(x - S.r[2], z - S.r[3]) < S.bulb + S.sw + 1.5);
      const court = courts.some(C => segDist(x, z, ...C.r) < C.w / 2 + 1.5);
      assert.ok(kerb || street || court, `a walk in ${p.id} ends nowhere (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
  assert.equal(all.length, summarize(blocks.map(b => b.plan)).buildings);
});

test('corridor mid-rise: homes are planned year by year, never in a year before their land converts', () => {
  const D = developDump();
  for (const b of D.blocks()) {
    for (const a of b.plan.annexes) {
      const host = D.blocks().find(o => o.key === a.block);
      assert.ok(host.year <= b.year, `${b.key} put homes on ${a.block}, built later`);
      assert.equal(host.state, b.state, 'shared homes go on land of the same kind');
    }
  }
  const json = D => JSON.stringify(D.blocks().map(b => b.plan.buildings.map(x => [x.type, x.units, x.c])));
  assert.equal(json(D), json(developDump()), 'deterministic');
});

// ---------- the sim's homes, year by year ----------
test('requested homes match the sim\'s rounded total at every year, so none disappear or count twice', () => {
  const ps = [0.3, 0.45, 0.2, 0.55, 0.15].map((a, i) => ({ id: `r-${i}`, tags: [`wood-${i % 2}`], state: 'forest', areaAcres: a }));
  const years = { 'r-0': 1, 'r-1': 1, 'r-2': 2, 'r-3': 3, 'r-4': 3 }, final = Object.fromEntries(ps.map(p => [p.id, 'mid_res']));
  const req = requestedUnits(ps, final, UPA, z => years[z.id]);
  for (const y of [1, 2, 3]) {
    const by = ps.filter(p => years[p.id] <= y);
    const sim = Math.round(by.reduce((n, p) => n + simUnits(p, 'forest', 'mid_res', UPA), 0)), map = by.reduce((n, p) => n + req.get(p.id), 0);
    assert.equal(map, sim, `year ${y}`);
  }
});

test('the sim\'s housing count and the map\'s requested homes agree for the real corridor forecast', () => {
  const card = cards.find(c => c.id === 'corridor-midrise');
  const sim = runScenario([card], {}, allZones, assumptions, baselines);
  const yearOf = z => sim.timeline.findIndex(t => t.zoneStates[z.id] !== z.state);
  const zs = allZones.map(z => ({ ...z, ring: [] }));
  const req = requestedUnits(zs, sim.timeline.at(-1).zoneStates, UPA, yearOf);
  for (const t of sim.timeline) {
    const map = zs.filter(z => t.zoneStates[z.id] !== z.state).reduce((n, z) => n + (req.get(z.id) ?? 0), 0);
    assert.equal(map, t.metrics.housingUnits - sim.timeline[0].metrics.housingUnits, `year ${t.year}`);
  }
});

// ---------- synthetic sites: sharing, constraints, the ladder ----------
const rect = (x0, z0, x1, z1) => [x0, z0, x1, z0, x1, z1, x0, z1];
const acres = ring => { let s = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; s += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; } return Math.abs(s) / 2 / 4046.86; };
const parcel = (id, ring, tags = ['wood-90']) => ({ id, ring, state: 'forest', tags, areaAcres: acres(ring) });
function world({ roads, parcels, buildings = [] }) {
  const lines = roads.map(q => ({ ...q, L: new Line(q.r) }));
  const occ = (x, z) => {
    let b = 0;
    for (const q of lines) { const d = q.L.project(x, z).d; if (d <= q.w / 2) b |= OCC.road; else if (d <= q.w / 2 + 2.2) b |= OCC.sidewalk; }
    for (const m of buildings) if (inside(m.outer, x, z)) b |= OCC.building;
    for (const p of parcels) if (inside(p.ring, x, z)) b |= OCC.zone;
    return b;
  };
  const ctxs = new Map();
  const ctxOf = site => (ctxs.has(site.id) ? ctxs.get(site.id) : ctxs.set(site.id, siteContext({ id: site.id, parcels: site.parcels, roads, junctions: findJunctions(roads), buildings })).get(site.id));
  return { occ, ctxOf };
}
const road = { cls: 'residential', w: 7, r: [-400, 0, 400, 0] };
// A forecast: each parcel's state by year (the state from its year on).
const timeline = (parcels, plan, years = 4) => Array.from({ length: years + 1 }, (_, y) => Object.fromEntries(parcels.map(p => [p.id, plan[p.id] && y >= plan[p.id][0] ? plan[p.id][1] : p.state])));

test('a block its own land can\'t hold shares its homes with land of the same kind built earlier, counted once', () => {
  const roomy = parcel('a-1', rect(-200, 8, 0, 90)), tiny = parcel('a-2', rect(40, 8, 52, 20));
  const parcels = [roomy, tiny], w = world({ roads: [road], parcels });
  const D = createDevelopment({ zones: parcels, upa: { ...UPA, mid_res: 40 }, ctxOf: w.ctxOf, occ: w.occ });
  D.setForecast(timeline(parcels, { 'a-1': [1, 'mid_res'], 'a-2': [2, 'mid_res'] }), []);
  const host = D.planOf(roomy), guest = D.planOf(tiny);
  assert.ok(guest.requested > 0 && guest.occupied === guest.requested, `the tiny parcel's ${guest.requested} homes all stand (${guest.occupied})`);
  assert.ok(guest.annexes.length === 1 && guest.annexes[0].parcels.includes('a-1'), 'on the earlier block\'s land');
  assert.equal(host.occupied, host.requested, 'the host keeps its own homes');
  const t = summarize([host, guest]);
  assert.equal(t.occupied, t.requested, 'every home counted once');
  for (const b of guest.buildings) for (const o of host.buildings) assert.ok(Math.hypot(b.c[0] - o.c[0], b.c[1] - o.c[1]) > Math.min(b.w, o.w) / 2, 'no shared building stands on the host\'s');
});

test('homes never go on land built later or of another kind; then the exact constraint is reported', () => {
  const roomy = parcel('b-1', rect(-200, 8, 0, 90)), tiny = parcel('b-2', rect(40, 8, 52, 20)), other = parcel('b-3', rect(100, 8, 300, 90));
  const parcels = [roomy, tiny, other], w = world({ roads: [road], parcels });
  const D = createDevelopment({ zones: parcels, upa: { ...UPA, mid_res: 40 }, ctxOf: w.ctxOf, occ: w.occ });
  // The tiny parcel converts first; the roomy one later; the other to another kind.
  D.setForecast(timeline(parcels, { 'b-2': [1, 'mid_res'], 'b-1': [3, 'mid_res'], 'b-3': [1, 'low_res'] }), []);
  const guest = D.planOf(tiny);
  assert.equal(guest.occupied, 0);
  assert.equal(guest.annexes.length, 0);
  assert.match(guest.constraint, /^\d+ of the \d+ homes asked for have no valid place: none of the buildings the zone permits .* fits on its 0\.04 acres with a way in from a street, path or court; no other mid-rise land within 600 m built by then, nor unprotected forest within 3000 m, has room for them.$/);
  const { totals } = D.ledger(timeline(parcels, { 'b-2': [1, 'mid_res'], 'b-3': [1, 'low_res'] })[1]);
  assert.equal(totals.unmet, guest.requested + D.planOf(other).unmet, 'unplaced homes are unmet, never counted as built');
  assert.equal(totals.occupied + totals.unmet, totals.requested);
});

test('protected land a block would need to cross is named in its constraint', () => {
  // A deep parcel behind a protected strip: no street, court or walk may cross the strip.
  const strip = parcel('c-1', rect(-60, 8, 60, 40)), deep = parcel('c-2', rect(-60, 40, 60, 160));
  const parcels = [strip, deep], w = world({ roads: [road], parcels });
  const D = createDevelopment({ zones: parcels, upa: UPA, ctxOf: w.ctxOf, occ: w.occ });
  D.setForecast(timeline(parcels, { 'c-2': [1, 'low_res'] }), [{ where: 'id:c-1', protect: 'forest' }]);
  const p = D.planOf(deep);
  assert.equal(p.occupied, 0, 'nothing is forced across the protected strip');
  assert.match(p.constraint, /1 protected parcel nearby can't be crossed/);
});

test('a deep block climbs the ladder: further rows reached by walks, then courts, before anything is left unmet', () => {
  const deep = parcel('d-1', rect(-60, 8, 60, 140));
  const w = world({ roads: [road], parcels: [deep] });
  const D = createDevelopment({ zones: [deep], upa: { ...UPA, mid_res: 30 }, ctxOf: w.ctxOf, occ: w.occ });
  D.setForecast(timeline([deep], { 'd-1': [1, 'mid_res'] }), []);
  const p = D.planOf(deep);
  assert.equal(p.occupied, p.requested, `${p.occupied} of ${p.requested}`);
  const depths = p.buildings.map(b => b.c[1]);
  assert.ok(Math.max(...depths) - Math.min(...depths) > 25 || p.courts.length || p.streets.length, 'homes reach past the first row');
});

test('the ledger: completed + under construction + unmet is the sim\'s homes, and later years are planned', () => {
  const a = parcel('e-1', rect(-200, 8, -60, 90)), b = parcel('e-2', rect(0, 8, 140, 90));
  const parcels = [a, b], w = world({ roads: [road], parcels });
  const D = createDevelopment({ zones: parcels, upa: UPA, ctxOf: w.ctxOf, occ: w.occ });
  const tl = timeline(parcels, { 'e-1': [1, 'mid_res'], 'e-2': [3, 'mid_res'] });
  D.setForecast(tl, []);
  const y1 = D.ledger(tl[1]).totals, y3 = D.ledger(tl[3]).totals;
  assert.equal(y1.requested, D.blockOf(a).units);
  assert.equal(y3.requested, D.blockOf(a).units + D.blockOf(b).units);
  assert.equal(y3.occupied + y3.unmet, y3.requested);
});

test('homes no converted land can hold go on the untouched forest of their wood, never on protected land', () => {
  const tiny = parcel('f-1', rect(40, 8, 52, 20)), forest = parcel('f-2', rect(-200, 8, 0, 90)), kept = parcel('f-3', rect(100, 8, 300, 90));
  const parcels = [tiny, forest, kept], w = world({ roads: [road], parcels });
  const D = createDevelopment({ zones: parcels, upa: { ...UPA, mid_res: 40 }, ctxOf: w.ctxOf, occ: w.occ });
  D.setForecast(timeline(parcels, { 'f-1': [1, 'mid_res'] }), [{ where: 'id:f-3', protect: 'forest' }]);
  const p = D.planOf(tiny);
  assert.ok(p.requested > 0 && p.occupied === p.requested, `all ${p.requested} homes stand (${p.occupied})`);
  assert.ok(p.annexes.length && p.annexes.every(a => a.untouched && a.parcels.includes('f-2')), 'on the wood\'s untouched forest');
  for (const b of p.buildings) assert.ok(!inside(kept.ring, b.c[0], b.c[1]), 'never on the protected parcel');
});
