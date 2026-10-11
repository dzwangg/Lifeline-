// Draws the sim's zones on the city: trees while a zone is forest, houses or blocks once it converts.
// Every zone gets fixed instance slots for each kind up front. A year the clock plays into builds each converted zone
// over most of that simulated year, so it pauses and speeds up with the clock: the trees are felled one by one and
// leave stumps, the ground is cleared to soil, scaffolds go up, and the buildings rise inside them. A seek shows its
// year at once. One InstancedMesh per kind, no per-frame allocations.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { scenario, simClock, highlight } from './scenario.js';
import { triangulate } from '../world/geometry.js';
import { LOD } from '../world/palette.js';
export { zonesReady } from './scenario.js';

const KIND_OF = { forest: 'tree', low_res: 'house', mid_res: 'block', mixed_use: 'block', transit_station: 'block' }; // ponytail: parking is bare ground; mixed use and transit share the block art for now
const KINDS = ['tree', 'house', 'block'];
const STEP = { tree: 11, house: 18, block: 34 }; // slot spacing in metres; 11 m matches the base map's woods
const CLEAR = { tree: 0, house: 7, block: 14 }; // half-footprint that must miss buildings, roads and the zone's edge
const STRIDE = 6; // a slot is x, z, rotation, width, height, depth
// A conversion takes CONSTRUCT simulated years (about 2.7 s at 1x). Its steps, as shares of that time: each tree
// falls at its own moment in FELL (taking FELL_FOR), stumps are cleared at CLEARED, the soil shows during DIRT, scaffolds
// stand during SCAFFOLD (going up and down over POP), buildings rise during RISE, and new trees grow during GROW.
const CONSTRUCT = .9, FELL = [0, .3], FELL_FOR = .06, CLEARED = .5, DIRT = [.15, .95], SCAFFOLD = [.3, .95], POP = .04, RISE = [.42, .9], GROW = [.5, .95];
const SCAFFOLD_W = 8; // metres: the scaffold sprite's drawn width, scaled to each building
const HOUSE_TINTS = ['#ffffff', '#f3e6d0', '#e3ecd8', '#f0dfe6', '#dfe8f0'].map(c => new THREE.Color(c));
const BLOCK_TINTS = ['#ffffff', '#f0e2cf', '#e6dcd2', '#f5ead8'].map(c => new THREE.Color(c));
// Far out, a changed zone is filled with the colour of what it became, so a policy's footprint reads at a glance.
const FILL = { forest: '#2f9a4c', low_res: '#ffb84d', mid_res: '#ff7a3d', mixed_use: '#e8559a', transit_station: '#3d8bff', parking: '#8f939c' };

// at/inside/bounds come from the base map. parts[kind] lists what to draw for each kind, in the city's art:
// { geo, material } meshes, or { make(count, pick) } for prebuilt instanced meshes such as sprite trees.
// lod(object, { minZoom, maxZoom }) puts an object under the map's zoom rules.
export function mountZoneLayer({ scene, zones, at, inside, bounds, parts, lod = o => o }) {
  let seed = 4242;
  const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = (a, b) => a + rnd() * (b - a);
  const open = (ring, x, z, r) => [[0, 0], [-r, -r], [r, -r], [r, r], [-r, r]].every(([dx, dz]) => !(at(x + dx, z + dz) & 3) && inside(ring, x + dx, z + dz));
  const size = { tree: () => { const s = rr(1.1, 1.7); return [s, s, s]; }, house: () => [rr(9, 12), rr(6, 8), rr(10, 13)], block: () => [rr(22, 26), rr(13, 26), rr(22, 26)] };

  const slots = {}, range = {}; // range[kind][zone] = [first slot, end slot]
  for (const kind of KINDS) {
    const list = [];
    range[kind] = zones.map(({ ring }) => {
      const start = list.length / STRIDE, [x0, z0, x1, z1] = bounds(ring), step = STEP[kind];
      for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
        const px = kind === 'tree' ? x + rr(0, step) : x + step / 2, pz = kind === 'tree' ? z + rr(0, step) : z + step / 2;
        if (open(ring, px, pz, CLEAR[kind])) list.push(px, pz, kind === 'tree' ? rr(0, 6.3) : 0, ...size[kind]());
      }
      return [start, list.length / STRIDE];
    });
    slots[kind] = new Float32Array(list);
  }

  const TINTS = { house: HOUSE_TINTS, block: BLOCK_TINTS };
  // Each slot's random draws are kept, so a second copy of a kind (the wipe's year-0 side) looks the same, and a
  // tree's far-zoom canopy takes the colour of its own species.
  const draws = {}, draw = (key, i) => ((draws[key] ??= [])[i] ??= rnd());
  const meshes = Object.fromEntries(KINDS.map(kind => [kind, parts[kind].map(part => layer(part, kind, TINTS[kind]))]));
  // side: the layer the mesh draws on, 2 for the shown year and 1 for the wipe's year 0 (see world/view.js render()).
  function layer(part, kind, tints, side = 2) {
    const n = slots[kind].length / STRIDE;
    const m = part.make ? part.make(n, i => draw(kind, i)) : new THREE.InstancedMesh(part.geo, part.material, Math.max(n, 1));
    m.count = n;
    m.layers.set(side);
    if (tints && !part.make) for (let i = 0; i < n; i++) m.setColorAt(i, tints[Math.floor(draw(`${kind} tint`, i) * tints.length)]);
    m.castShadow = m.receiveShadow = !part.make; // sprite trees carry their own contact art
    m.frustumCulled = false; // instances start at scale 0, so a bounding sphere computed then would be wrong
    scene.add(m);
    return m;
  }

  // Construction pieces: a stump for every tree slot, a scaffold for every building slot, and a soil fill per zone.
  const stumps = parts.stump.map(part => layer(part, 'tree'));
  const scaffolds = { house: parts.scaffold.map(part => layer(part, 'house')), block: parts.scaffold.map(part => layer(part, 'block')) };
  const dirt = new Map(); // zone index -> mesh, made the first time the zone is built on
  const dirtOf = zi => {
    if (!dirt.has(zi)) {
      // Each triangle wound to face up, so it is lit from above.
      const pos = triangulate([zones[zi].ring]).flatMap(([a, b, c]) => ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0 ? [a, b, c] : [a, c, b]));
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos.flatMap(([x, z]) => [x, .05, z]), 3))
        .setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap(([x, z]) => [x, -z]), 2))
        .setAttribute('normal', new THREE.Float32BufferAttribute(pos.flatMap(() => [0, 1, 0]), 3));
      const mesh = new THREE.Mesh(g, parts.dirt);
      mesh.receiveShadow = true;
      mesh.layers.set(2);
      scene.add(mesh);
      dirt.set(zi, mesh);
    }
    return dirt.get(zi);
  };

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const clamp01 = v => Math.min(1, Math.max(0, v)), at01 = (p, [a, b]) => clamp01((p - a) / (b - a));
  const fellAt = i => FELL[0] + ((i * 2654435761) % 1000) / 1000 * (FELL[1] - FELL[0] - FELL_FOR); // each tree's own moment
  const put = (meshList, i, o, a, sx, sy, sz) => {
    _m.compose(_p.set(a[o], 0, a[o + 1]), _q.setFromAxisAngle(UP, a[o + 2]), _s.set(a[o + 3] * sx, a[o + 4] * sy, a[o + 5] * sz));
    for (const m of meshList) m.setMatrixAt(i, _m);
  };
  const dirty = new Set();
  // Zone zi going from kind `from` to kind `to` (either may be undefined: bare ground), p of the way through (1: done).
  function writeZone(zi, from, to, p) {
    for (const kind of KINDS) {
      const a = slots[kind], [i0, i1] = range[kind][zi], built = kind !== 'tree';
      for (let i = i0; i < i1; i++) {
        const o = i * STRIDE;
        let sx = 0, sy = 0;
        if (kind === from && kind === to) sx = sy = 1;
        else if (kind === from) sx = sy = built ? 1 - clamp01(p / FELL[1]) : 1 - clamp01((p - fellAt(i)) / FELL_FOR); // demolished, or felled
        else if (kind === to) { if (built) { sy = at01(p, RISE); sx = sy > 0 ? 1 : 0; } else sx = sy = at01(p, GROW) ** .5; } // rises, or grows
        put(meshes[kind], i, o, a, sx, sy, sx);
        if (kind === 'tree') { // a stump from the moment the tree falls until the ground is cleared
          const k = from === 'tree' && to !== 'tree' && p < 1 && p >= fellAt(i) + FELL_FOR / 2 && p < CLEARED ? 1 : 0;
          put(stumps, i, o, a, k, k, k);
        } else { // a scaffold round each building going up, as wide as the building
          const up = kind === to && from !== to && p < 1 ? at01(p, [SCAFFOLD[0], SCAFFOLD[0] + POP]) * (1 - at01(p, [SCAFFOLD[1] - POP, SCAFFOLD[1]])) : 0;
          const k = up * a[o + 3] / SCAFFOLD_W;
          _m.compose(_p.set(a[o], 0, a[o + 1]), _q, _s.set(k, k, k));
          for (const m of scaffolds[kind]) m.setMatrixAt(i, _m);
          dirty.add(scaffolds[kind]);
        }
      }
      dirty.add(meshes[kind]);
    }
    dirty.add(stumps);
    const soil = from !== to && p >= DIRT[0] && p < DIRT[1];
    if (soil || dirt.has(zi)) dirtOf(zi).visible = soil;
  }
  const flush = () => { for (const list of dirty) for (const m of list) m.instanceMatrix.needsUpdate = true; dirty.clear(); };
  zones.forEach((z, zi) => writeZone(zi, KIND_OF[z.state], KIND_OF[z.state], 1));
  flush();

  // The wipe's year-0 side: the same slots as they were in year 0, on layer 1, made the first time the wipe is on.
  let yearZero = null;
  scenario.subscribe(({ wipe }) => {
    if (!wipe || yearZero) return;
    yearZero = Object.fromEntries(KINDS.map(kind => [kind, parts[kind].map(part => layer(part, kind, TINTS[kind], 1))]));
    for (const kind of KINDS) zones.forEach((z, zi) => {
      const [i0, i1] = range[kind][zi], k = KIND_OF[z.state] === kind ? 1 : 0;
      for (let i = i0; i < i1; i++) put(yearZero[kind], i, i * STRIDE, slots[kind], k, k, k);
    });
    for (const list of Object.values(yearZero)) for (const m of list) m.instanceMatrix.needsUpdate = true;
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

  // Each zone's look depends on the clock alone: the year shown, the year before it, and how far into the year.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let drawn = null, drawnBefore = null;
  const building = new Set(), done = new Map(); // zones converting this year; zone -> the [from, to, p] last written
  simClock.subscribe(({ shown, frac, before }) => {
    if (!shown?.data) return;
    const base = shown.base.zoneStates, to = before ? base : shown.data.zoneStates;
    const from = before || !shown.tween || still ? to : shown.prev.zoneStates, p = from === to ? 1 : clamp01(frac / CONSTRUCT);
    const final = shown.data.run?.result.timeline.at(-1).zoneStates ?? to; // the forecast's final year
    if (shown !== drawn || before !== drawnBefore) {
      zones.forEach((z, zi) => {
        const changed = to[z.id] !== base[z.id];
        const planned = !changed && !before && final[z.id] !== base[z.id], mats = changed ? fillMats : plannedFills;
        outlines[zi].visible = fills[zi].visible = changed || planned;
        outlines[zi].material = planned ? plannedMat : outlineMat;
        if (changed || planned) fills[zi].material = mats[(changed ? to : final)[z.id]] ?? mats.parking;
      });
      drawn = shown; drawnBefore = before;
      building.clear();
      zones.forEach((z, zi) => {
        const a = KIND_OF[from[z.id]], b = KIND_OF[to[z.id]], last = done.get(zi);
        if (a !== b) building.add(zi);
        else if (!last || last[0] !== b || last[1] !== b || last[2] !== 1) { writeZone(zi, b, b, 1); done.set(zi, [b, b, 1]); }
      });
    }
    for (const zi of building) {
      const z = zones[zi], a = KIND_OF[from[z.id]], b = KIND_OF[to[z.id]], last = done.get(zi);
      if (last && last[0] === a && last[1] === b && last[2] === p) continue;
      writeZone(zi, a, b, p);
      done.set(zi, [a, b, p]);
      if (p === 1) building.delete(zi);
    }
    flush();
  });
}
