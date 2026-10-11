// Draws the sim's zones on the city: trees while a zone is forest, houses or blocks once it converts.
// Every zone gets fixed instance slots for each kind up front; a year the clock plays into scales each zone's
// slots between 0 and 1 over its first months of simulated time, so the change pauses and speeds up with the
// clock. A seek shows its year at once. One InstancedMesh per kind, no per-frame allocations.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { simClock, highlight } from './scenario.js';
import { triangulate } from '../world/geometry.js';
import { LOD } from '../world/palette.js';
export { zonesReady } from './scenario.js';

const KIND_OF = { forest: 'tree', low_res: 'house', mid_res: 'block', mixed_use: 'block', transit_station: 'block' }; // ponytail: parking is bare ground; mixed use and transit share the block art for now
const KINDS = ['tree', 'house', 'block'];
const STEP = { tree: 11, house: 18, block: 34 }; // slot spacing in metres; 11 m matches the base map's woods
const CLEAR = { tree: 0, house: 7, block: 14 }; // half-footprint that must miss buildings, roads and the zone's edge
const TWEEN = .6, STRIDE = 6; // TWEEN: the simulated years a change takes to grow in. A slot is x, z, rotation, width, height, depth
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
  const rr = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
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
  const meshes = Object.fromEntries(KINDS.map(kind => [kind, parts[kind].map(part => layer(part, kind, TINTS[kind] && (() => pick(TINTS[kind]))))]));
  function layer(part, kind, color) {
    const n = slots[kind].length / STRIDE;
    const m = part.make ? part.make(n, () => rnd()) : new THREE.InstancedMesh(part.geo, part.material, Math.max(n, 1));
    m.count = n;
    if (color && !part.make) for (let i = 0; i < n; i++) m.setColorAt(i, color());
    m.castShadow = m.receiveShadow = !part.make; // sprite trees carry their own contact art
    m.frustumCulled = false; // instances start at scale 0, so a bounding sphere computed then would be wrong
    scene.add(m);
    return m;
  }

  // Per zone and kind: the scale shown now.
  const cur = {};
  for (const k of KINDS) cur[k] = new Float32Array(zones.length);
  zones.forEach((z, zi) => { const k = KIND_OF[z.state]; if (k) cur[k][zi] = 1; });

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function write(kind, zi) {
    const s = cur[kind][zi], a = slots[kind], r = range[kind][zi];
    for (let i = r[0]; i < r[1]; i++) {
      const o = i * STRIDE;
      _m.compose(_p.set(a[o], 0, a[o + 1]), _q.setFromAxisAngle(UP, a[o + 2]), _s.set(a[o + 3] * s, a[o + 4] * s, a[o + 5] * s));
      for (const m of meshes[kind]) m.setMatrixAt(i, _m);
    }
  }
  for (const k of KINDS) { zones.forEach((_, zi) => write(k, zi)); for (const m of meshes[k]) m.instanceMatrix.needsUpdate = true; }

  // Zones whose state differs from year 0 get a dashed gold outline, so policy effects read clearly. Far out the
  // dashes would alias into noise, so a solid fill in the new state's colour takes over.
  const ringPoints = (ring, y) => { const pts = []; for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector3(ring[i], y, ring[i + 1])); return pts; };
  const outlineMat = new THREE.LineDashedMaterial({ color: 0xf7d774, dashSize: 3, gapSize: 2, depthTest: false, transparent: true });
  // The zoom rules toggle dashes and fills; the user's highlight setting hides both through their parent.
  const dashes = lod(new THREE.Group(), { minZoom: LOD.macro }), macro = lod(new THREE.Group(), { maxZoom: LOD.macro });
  const highlights = new THREE.Group();
  highlights.add(dashes, macro);
  scene.add(highlights);
  highlight.subscribe(on => { highlights.visible = on; });
  const outlines = zones.map(({ ring }) => {
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(ring, .4)), outlineMat);
    line.computeLineDistances(); line.visible = false; line.renderOrder = 997;
    dashes.add(line);
    return line;
  });
  const fillMats = Object.fromEntries(Object.entries(FILL).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .85, depthTest: false, side: THREE.DoubleSide })]));
  const fills = zones.map(({ ring }) => {
    const pos = triangulate([ring]).flat().flatMap(([x, z]) => [x, .6, z]);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), fillMats.forest);
    mesh.renderOrder = 998; mesh.visible = false;
    macro.add(mesh);
    return mesh;
  });

  // Each zone's scale depends on the clock alone: the year shown, the year before it, and how far into the year.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, ease = p => 1 - (1 - p) ** 3;
  let drawn = null, drawnP = -1, drawnBefore = null;
  simClock.subscribe(({ shown, frac, before }) => {
    if (!shown?.data) return;
    const p = before || !shown.tween || still ? 1 : ease(Math.min(1, frac / TWEEN));
    if (shown === drawn && before === drawnBefore && p === drawnP) return;
    const base = shown.base.zoneStates, to = before ? base : shown.data.zoneStates, from = before || !shown.tween ? to : shown.prev.zoneStates;
    if (shown !== drawn || before !== drawnBefore) zones.forEach((z, zi) => {
      const changed = to[z.id] !== base[z.id];
      outlines[zi].visible = fills[zi].visible = changed;
      if (changed) fills[zi].material = fillMats[to[z.id]] ?? fillMats.parking;
    });
    drawn = shown; drawnP = p; drawnBefore = before;
    for (const k of KINDS) {
      let dirty = false;
      zones.forEach((z, zi) => {
        const a = KIND_OF[from[z.id]] === k ? 1 : 0, b = KIND_OF[to[z.id]] === k ? 1 : 0, v = a + (b - a) * p;
        if (cur[k][zi] === v) return;
        cur[k][zi] = v;
        write(k, zi);
        dirty = true;
      });
      if (dirty) for (const m of meshes[k]) m.instanceMatrix.needsUpdate = true;
    }
  });
}
