// Draws the sim's zones on the city: trees while a zone is forest, and once it converts, a planned neighbourhood
// (growth/): buildings that face their street, local streets where the land needs them, front paths, lawns and planting.
// A year the clock plays into builds each converted parcel over most of that simulated year, so it pauses and speeds up
// with the clock: only the trees in the way are felled (footprints, paths and new streets), new streets are graded and
// paved, soil pads, scaffolds and buildings go up one after another, and the lawns and planting come last. A seek shows
// its year at once. Plans never change within a forecast, so every year, seek and the wipe show the same layout.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { scenario, simClock, highlight, dataReady, growthReport } from './scenario.js';
import { triangulate, inside, bounds } from '../world/geometry.js';
import { LOD, pickBy } from '../world/palette.js';
import { TREE_KINDS } from '../world/sprite-art.js';
import { createGrowth, isBuilt } from '../growth/world-growth.js';
import { clears, rectDist } from '../growth/plan.js';
import { inRect } from '../growth/geom.js';
export { zonesReady } from './scenario.js';

const TREE_STEP = 11; // tree slot spacing in metres; 11 m matches the base map's woods
const STRIDE = 3; // a tree slot is x, z, scale
// A conversion takes CONSTRUCT simulated years (about 2.7 s at 1x). Its steps, as shares of that time: each tree in the
// way falls at its own moment in FELL (taking FELL_FOR) and its stump is cleared at CLEARED; new streets are graded during
// SOIL and paved during PAVE; front paths are laid at PATHS; soil pads show and scaffolds stand during PADS; buildings
// rise one after another during RISE; lawns go down at LAWN and the planting grows during GROW. Demolition takes DOWN.
export const CONSTRUCT = .9; // shared with focus.js, which moves on once a conversion is done
const FELL = [0, .3], FELL_FOR = .06, CLEARED = .5;
const SOIL = [.12, .25], PAVE = [.2, .35], PATHS = .25, PADS = [.3, .9], RISE = [.34, .86], LAWN = .86, GROW = [.85, 1], DOWN = [0, .3], REGROW = [.5, .95];
// Far out, a changed zone is filled with the colour of what it became, so a policy's footprint reads at a glance.
const FILL = { forest: '#2f9a4c', low_res: '#ffb84d', mid_res: '#ff7a3d', mixed_use: '#e8559a', transit_station: '#3d8bff', parking: '#8f939c' };

// world: buildWorld()'s result. Trees use world.zoneParts (sprite trees and stumps); buildings use the city's styler.
export function mountZoneLayer({ world, zones }) {
  const { scene } = world.view, parts = world.zoneParts, lod = world.lod, at = world.gridAt;
  let seed = 4242;
  const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = (a, b) => a + rnd() * (b - a);
  const zoneIndex = new Map(zones.map((z, zi) => [z.id, zi]));

  // Tree slots: an 11 m jittered lattice over each zone, clear of buildings and roads.
  const list = [];
  const range = zones.map(({ ring }) => {
    const start = list.length / STRIDE, [x0, z0, x1, z1] = bounds(ring);
    for (let x = x0; x < x1; x += TREE_STEP) for (let z = z0; z < z1; z += TREE_STEP) {
      const px = x + rr(0, TREE_STEP), pz = z + rr(0, TREE_STEP);
      if (!(at(px, pz) & 3) && inside(ring, px, pz)) list.push(px, pz, rr(1.1, 1.7));
    }
    return [start, list.length / STRIDE];
  });
  const slots = new Float32Array(list), n = slots.length / STRIDE;
  // Each slot's random draws are kept, so the wipe's year-0 copy looks the same, and a tree's far-zoom canopy takes the
  // colour of its own species.
  const draws = [], draw = i => (draws[i] ??= rnd());
  // side: the layer the mesh draws on, 2 for the shown year and 1 for the wipe's year 0 (see world/view.js render()).
  function layer(part, side = 2) {
    const m = part.make(n, draw);
    m.count = n;
    m.layers.set(side);
    m.frustumCulled = false; // instances start at scale 0, so a bounding sphere computed then would be wrong
    scene.add(m);
    return m;
  }
  const trees = parts.tree.map(part => layer(part)), stumps = parts.stump.map(part => layer(part));
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const put = (meshes, i, k) => {
    const o = i * STRIDE, s = slots[o + 2] * k;
    _m.compose(_p.set(slots[o], 0, slots[o + 1]), _q, _s.set(s, s, s));
    for (const m of meshes) m.setMatrixAt(i, _m);
  };
  const clamp01 = v => Math.min(1, Math.max(0, v)), at01 = (p, [a, b]) => clamp01((p - a) / (b - a));
  const fellAt = i => FELL[0] + ((i * 2654435761) % 1000) / 1000 * (FELL[1] - FELL[0] - FELL_FOR); // each tree's own moment
  for (let i = 0; i < n; i++) { put(trees, i, 1); put(stumps, i, 0); } // every zone starts as forest or bare (no trees on lots)
  zones.forEach((z, zi) => { if (z.state !== 'forest') for (let i = range[zi][0]; i < range[zi][1]; i++) put(trees, i, 0); });
  const flushTrees = () => { for (const m of [...trees, ...stumps]) m.instanceMatrix.needsUpdate = true; };
  flushTrees();

  // The wipe's year-0 side: the trees as they were in year 0, on layer 1, made the first time the wipe is on.
  let yearZero = null;
  scenario.subscribe(({ wipe }) => {
    if (!wipe || yearZero) return;
    yearZero = parts.tree.map(part => layer(part, 1));
    zones.forEach((z, zi) => { for (let i = range[zi][0]; i < range[zi][1]; i++) put(yearZero, i, z.state === 'forest' ? 1 : 0); });
    for (const m of yearZero) m.instanceMatrix.needsUpdate = true;
  });

  // Zones whose state differs from year 0 get a dashed gold outline, so policy effects read clearly. Far out the
  // dashes would alias into noise, so a solid fill in the new state's colour takes over.
  const ringPoints = (ring, y) => { const pts = []; for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector3(ring[i], y, ring[i + 1])); return pts; };
  const outlineMat = new THREE.LineDashedMaterial({ color: 0xf7d774, dashSize: 3, gapSize: 2, depthTest: false, transparent: true });
  // Parcels the forecast converts in a later year: a white outline (and a faint fill far out) until their year comes.
  const plannedMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 3, depthTest: false, transparent: true, opacity: .8 });
  // The zoom rules toggle dashes and fills; the user's highlight setting hides both through their parent.
  const dashes = lod(new THREE.Group(), { minZoom: LOD.macro }), macro = lod(new THREE.Group(), { maxZoom: LOD.macro });
  const highlights = new THREE.Group();
  highlights.add(dashes, macro);
  scene.add(highlights);
  highlight.subscribe(on => { highlights.visible = on; });
  const outlines = zones.map(({ ring }) => {
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(ring, .4)), outlineMat);
    line.computeLineDistances(); line.visible = false; line.renderOrder = 997; line.layers.set(2);
    dashes.add(line);
    return line;
  });
  const fillMat = opacity => Object.fromEntries(Object.entries(FILL).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide })]));
  const fillMats = fillMat(.85), plannedFills = fillMat(.35);
  const fills = zones.map(({ ring }) => {
    const pos = triangulate([ring]).flat().flatMap(([x, z]) => [x, .6, z]);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), fillMats.forest);
    mesh.renderOrder = 998; mesh.visible = false; mesh.layers.set(2);
    macro.add(mesh);
    return mesh;
  });

  dataReady.then(([, assumptions]) => mountGrowth(assumptions));

  function mountGrowth(assumptions) {
    const growth = createGrowth({ world, zones, upa: assumptions.unitsPerAcre.value, onDispose: art => forget(art) });
    // Which trees each plan fells, and which new street's corridor each tree stands in, worked out once.
    // A tree falls if it stands in a plan's footprints, paths or front yards, or if its drawn crown (sprites are far wider
    // than trunks) would reach one of the plan's homes, whichever parcel of the site it stands in.
    const crownOf = i => (world.art.sprites[pickBy(TREE_KINDS.wood, draw(i))]?.w ?? 8) * slots[i * STRIDE + 2] / 2;
    const felled = new WeakMap(); // plan -> Map zone index -> Uint8Array over that zone's tree slots
    const cut = (plan, zi) => {
      let byZone = felled.get(plan);
      if (!byZone) felled.set(plan, byZone = new Map());
      if (!byZone.has(zi)) {
        const [i0, i1] = range[zi], a = new Uint8Array(i1 - i0);
        for (let i = i0; i < i1; i++) {
          const x = slots[i * STRIDE], z = slots[i * STRIDE + 1], r = crownOf(i);
          a[i - i0] = clears(plan, x, z) || plan.homes.some(o => rectDist(o, x, z) < r) ? 1 : 0;
        }
        byZone.set(zi, a);
      }
      return byZone.get(zi);
    };
    const corridors = new WeakMap(); // streets array -> Map zone index -> Int16Array (street index, or -1)
    const corridorOf = (streets, zi) => {
      if (!corridors.has(streets)) corridors.set(streets, new Map());
      const byZone = corridors.get(streets);
      if (!byZone.has(zi)) {
        const [i0, i1] = range[zi], a = new Int16Array(i1 - i0).fill(-1);
        const rects = streets.map(S => { const ux = (S.r[2] - S.r[0]) / S.len, uz = (S.r[3] - S.r[1]) / S.len; return [{ cx: (S.r[0] + S.r[2]) / 2, cz: (S.r[1] + S.r[3]) / 2, ux, uz, hw: S.len / 2, hd: S.half + S.sw + 1.5 }, S]; });
        for (let i = i0; i < i1; i++) {
          const x = slots[i * STRIDE], z = slots[i * STRIDE + 1];
          const k = rects.findIndex(([o, S]) => inRect(o, x, z) || Math.hypot(x - S.r[2], z - S.r[3]) < S.bulb + S.sw + 1.5);
          a[i - i0] = k;
        }
        byZone.set(zi, a);
      }
      return byZone.get(zi);
    };
    const builtPlan = (z, state) => (isBuilt(state) && state !== z.state ? growth.plan(z, state) : null);
    // The plans standing on a site in some year's states: its parcels' own, and those of blocks elsewhere whose homes it
    // also holds (develop.js shares out homes a block's own land can't), so their trees fall and their streets are built.
    const guestsIn = (site, states) => growth.hosted(site).filter(g => builtPlan(g.zone, states[g.zone.id]) === g.plan);
    const plansIn = (site, states) => [...new Set([...site.parcels.map(z => builtPlan(z, states[z.id])).filter(Boolean), ...guestsIn(site, states).map(g => g.plan)])];
    // The streets a site's parcels need in some year's states: those their plans use, with the streets those connect through.
    const streetsIn = (site, states) => {
      const used = new Set();
      for (const z of site.parcels) { const plan = builtPlan(z, states[z.id]); if (plan) for (const k of plan.streets) used.add(k); }
      for (const g of guestsIn(site, states)) for (const a of g.annexes) for (const k of a.streets) used.add(k);
      return used;
    };

    const touched = new Set(); // art written this pass; everything else is hidden
    // A site going from states `from` to `to`, p of the way through the year's construction (1: done).
    function writeSite(site, from, to, p) {
      const streets = growth.streets(site), sFrom = streetsIn(site, from), sTo = streetsIn(site, to), pFrom = plansIn(site, from), pTo = plansIn(site, to);
      for (let k = 0; k < streets.length; k++) {
        const a = sFrom.has(k), b = sTo.has(k);
        if (!a && !b) continue;
        const art = growth.streetArt(site, k);
        touched.add(art);
        if (a && b) art.set(1, 1);
        else if (b) art.set(at01(p, SOIL), at01(p, PAVE));
        else { const k2 = 1 - at01(p, DOWN); art.set(k2, k2); }
      }
      for (const z of site.parcels) {
        const zi = zoneIndex.get(z.id), A = builtPlan(z, from[z.id]), B = builtPlan(z, to[z.id]), still = from[z.id] === to[z.id];
        if (A && A !== B) { // demolished
          const art = growth.art(A), d = at01(p, DOWN);
          touched.add(art);
          art.set({ rise: 1, down: d, pads: false, lawn: d < 1, paths: d < 1, scaffolds: false, grow: 1 - d });
        }
        if (B) {
          const art = growth.art(B);
          touched.add(art);
          if (still || p >= 1) art.set({ rise: 1, pads: false, lawn: true, paths: true, scaffolds: false, grow: 1 });
          else art.set({ rise: at01(p, RISE), pads: p >= PADS[0] && p < PADS[1], lawn: p >= LAWN, paths: p >= PATHS, scaffolds: p >= PADS[0] && p < PADS[1], grow: at01(p, GROW) });
        }
        // Trees: only those in a footprint, path or new street fall; the rest stay as yard and buffer trees.
        const [i0, i1] = range[zi];
        if (i0 === i1) continue;
        const wood = z.state === 'forest', forestFrom = wood && (from[z.id] === 'forest' || !!A), forestTo = wood && (to[z.id] === 'forest' || !!B); // built parcels keep their other trees
        const cutA = pFrom.map(P => cut(P, zi)), cutB = pTo.map(P => cut(P, zi)), corr = corridorOf(streets, zi);
        for (let i = i0; i < i1; i++) {
          const c = corr[i - i0], gone = (cuts, set, forest) => !forest || cuts.some(a => a[i - i0]) || (c >= 0 && set.has(c));
          const was = gone(cutA, sFrom, forestFrom), will = gone(cutB, sTo, forestTo);
          let k = 1, stump = 0;
          if (still || p >= 1) k = will ? 0 : 1;
          else if (will && !was) { // felled, leaving a stump until the ground is cleared
            k = 1 - clamp01((p - fellAt(i)) / FELL_FOR);
            stump = p >= fellAt(i) + FELL_FOR / 2 && p < CLEARED ? 1 : 0;
          } else if (!will && was) k = at01(p, REGROW) ** .5; // grows back
          else if (will) k = 0;
          put(trees, i, k); put(stumps, i, stump);
        }
      }
    }

    // Built parcels join building selection (info cards) once they are up, and leave it while they're not.
    const picks = new Set();
    function syncPicks() {
      const pickables = world.buildings.pickables;
      for (const art of growth.allArt()) {
        if (!art.meshes) continue;
        const on = art.group.visible && touched.has(art);
        for (const m of art.meshes) {
          if (on && !picks.has(m)) { pickables.push(m); picks.add(m); }
          else if (!on && picks.has(m)) { pickables.splice(pickables.indexOf(m), 1); picks.delete(m); }
        }
      }
    }
    // Finished streets and homes join the walkers' network: added once (sidewalks before front paths, so paths can tie
    // to them), then opened and closed with their gate as the years show them built or not.
    const gates = new Map(); // art -> gate (art.gate too, so disposing the art closes its walks)
    function syncWalks() {
      const traffic = world.traffic;
      if (!traffic) return;
      const all = growth.allArt(), order = [...all.filter(a => !a.meshes), ...all.filter(a => a.meshes)];
      let closed = false;
      for (const art of order) {
        const open = touched.has(art) && art.done;
        if (open && !gates.has(art)) {
          const gate = { open: true };
          traffic.walk.extend(art.walks(), gate);
          if (art.doors) traffic.sim.addDoors(art.doors().map(d => ({ ...d, gate })));
          gates.set(art, gate); art.gate = gate;
        } else if (gates.has(art)) {
          const gate = gates.get(art);
          if (gate.open && !open) closed = true;
          gate.open = open;
        }
      }
      if (closed) traffic.sim.gatesChanged(); // walkers already on their way give up the walks that just closed
    }
    // A plan or street no forecast shows any more: it leaves picking, and its walks and doors leave the street sim.
    function forget(art) {
      for (const m of art.meshes ?? []) picks.delete(m);
      const gate = gates.get(art), traffic = world.traffic;
      gates.delete(art); touched.delete(art);
      if (gate && traffic) { traffic.walk.retract(gate); traffic.sim.dropDoors(gate); traffic.sim.gatesChanged(); }
    }
    world.trafficReady?.then(() => syncWalks());
    const hideUntouched = () => {
      for (const art of growth.allArt()) if (!touched.has(art)) art.meshes ? art.set({ rise: 0, pads: false, lawn: false, paths: false, scaffolds: false, grow: 0 }) : art.set(0, 0);
    };

    // Each zone's look depends on the clock alone: the year shown, the year before it, and how far into the year.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let drawn = null, drawnBefore = null, forecast = null, building = [], lastP = -1;
    simClock.subscribe(({ shown, frac, before }) => {
      if (!shown?.data) return;
      const base = shown.base.zoneStates, to = before ? base : shown.data.zoneStates;
      const from = before || !shown.tween || still ? to : shown.prev.zoneStates, p = from === to ? 1 : clamp01(frac / CONSTRUCT);
      const final = shown.data.run?.result.timeline.at(-1).zoneStates ?? to; // the forecast's final year
      if (final !== forecast) { forecast = final; growth.setForecast(shown.data.run?.result.timeline ?? [{ zoneStates: to }], scenario.get().cards); }
      if (shown !== drawn || before !== drawnBefore) {
        zones.forEach((z, zi) => {
          const changed = to[z.id] !== base[z.id];
          const planned = !changed && !before && final[z.id] !== base[z.id], mats = changed ? fillMats : plannedFills;
          outlines[zi].visible = fills[zi].visible = changed || planned;
          outlines[zi].material = planned ? plannedMat : outlineMat;
          if (changed || planned) fills[zi].material = mats[(changed ? to : final)[z.id]] ?? mats.parking;
        });
        drawn = shown; drawnBefore = before;
        // The ledger first: it plans every block standing by now (develop.js, year by year), so each site knows the homes
        // other blocks placed on it before it is drawn.
        const { totals } = growth.ledger(to, from);
        // Every site anything stands on now, drawn in full; the sites converting this year are then animated.
        touched.clear();
        building = [];
        for (const site of growth.sites.values()) {
          const guests = growth.hosted(site).map(g => g.zone);
          const changing = [...site.parcels, ...guests].some(z => from[z.id] !== to[z.id]);
          const anything = [...site.parcels, ...guests].some(z => to[z.id] !== z.state || from[z.id] !== z.state);
          if (changing) building.push(site);
          if (anything || changing) writeSite(site, from, to, changing ? p : 1);
          else for (const z of site.parcels) { const zi = zoneIndex.get(z.id); for (let i = range[zi][0]; i < range[zi][1]; i++) { put(trees, i, z.state === 'forest' ? 1 : 0); put(stumps, i, 0); } }
        }
        hideUntouched();
        flushTrees();
        syncPicks(); syncWalks();
        lastP = p;
        growthReport.set({ ...totals, year: shown.step, before });
        return;
      }
      if (p === lastP || !building.length) return;
      lastP = p;
      for (const site of building) writeSite(site, from, to, p);
      flushTrees();
      if (p >= 1) { syncPicks(); syncWalks(); building = []; }
    });
    world.growth = growth; // the ledger and plans, for the console (window.city.growth)
  }
}
