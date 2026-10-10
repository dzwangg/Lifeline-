// Draws the sim's zones on the city: trees while a zone is forest, houses or blocks once it converts.
// Every zone gets fixed instance slots for each kind up front; a year change scales each zone's slots
// between 0 and 1 over ~600 ms. One InstancedMesh per kind, no per-frame allocations.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { scenario, shownStates } from './scenario.js';
export { zonesReady } from './scenario.js';

const KIND_OF = { forest: 'tree', low_res: 'house', mid_res: 'block', mixed_use: 'block', transit_station: 'block' }; // ponytail: parking is bare ground; mixed use and transit share the block art for now
const KINDS = ['tree', 'house', 'block'];
const STEP = { tree: 11, house: 18, block: 34 }; // slot spacing in metres; 11 m matches the base map's woods
const CLEAR = { tree: 0, house: 7, block: 14 }; // half-footprint that must miss buildings, roads and the zone's edge
const MS = 600, STRIDE = 6; // a slot is x, z, rotation, width, height, depth
const HOUSE_TINTS = ['#f2ede4', '#e8dccb', '#d9e2e6', '#efe2d0', '#ffffff'].map(c => new THREE.Color(c));
const BLOCK_TINTS = ['#e6e2da', '#d6d9de', '#c9c4c0', '#efe6d6'].map(c => new THREE.Color(c));

// at/inside/bounds and the tree parts come from the base map, so zone forests look like every other wood.
export function mountZoneLayer({ scene, zones, at, inside, bounds, trunkGeo, canopyGeo, leafTex, greens }) {
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

  const std = o => new THREE.MeshStandardMaterial(o);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
  const roofGeo = new THREE.ConeGeometry(.78, .45, 4).rotateY(Math.PI / 4).translate(0, 1.225, 0);
  const meshes = {
    tree: [layer(trunkGeo, std({ vertexColors: true, roughness: .95 }), 'tree'), layer(canopyGeo, std({ map: leafTex, roughness: .9 }), 'tree', () => pick(greens).clone().multiplyScalar(rr(.8, 1.1)))],
    house: [layer(boxGeo, std({ roughness: .85 }), 'house', () => pick(HOUSE_TINTS)), layer(roofGeo, std({ color: 0x5a5550, roughness: .9 }), 'house')],
    block: [layer(boxGeo, std({ roughness: .8 }), 'block', () => pick(BLOCK_TINTS))],
  };
  function layer(geo, material, kind, color) {
    const n = slots[kind].length / STRIDE, m = new THREE.InstancedMesh(geo, material, Math.max(n, 1));
    m.count = n;
    if (color) for (let i = 0; i < n; i++) m.setColorAt(i, color());
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false; // instances start at scale 0, so a bounding sphere computed then would be wrong
    scene.add(m);
    return m;
  }

  // Per zone and kind: the scale shown now, and where the current animation runs from and to.
  const cur = {}, from = {}, to = {};
  for (const k of KINDS) { cur[k] = new Float32Array(zones.length); from[k] = new Float32Array(zones.length); to[k] = new Float32Array(zones.length); }
  zones.forEach((z, zi) => { const k = KIND_OF[z.state]; if (k) cur[k][zi] = to[k][zi] = 1; });

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

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, ease = p => 1 - (1 - p) ** 3;
  let t0 = 0, running = false;
  function tick(now) {
    const p = still ? 1 : Math.min(1, (now - t0) / MS), e = ease(p);
    for (const k of KINDS) {
      let dirty = false;
      for (let zi = 0; zi < zones.length; zi++) {
        if (cur[k][zi] === to[k][zi]) continue;
        cur[k][zi] = p < 1 ? from[k][zi] + (to[k][zi] - from[k][zi]) * e : to[k][zi];
        write(k, zi);
        dirty = true;
      }
      if (dirty) for (const m of meshes[k]) m.instanceMatrix.needsUpdate = true;
    }
    if (p < 1) requestAnimationFrame(tick); else running = false;
  }

  scenario.subscribe(s => {
    const states = shownStates(s);
    if (!states) return;
    let changed = false;
    zones.forEach((z, zi) => {
      for (const k of KINDS) {
        const v = KIND_OF[states[z.id]] === k ? 1 : 0;
        if (to[k][zi] !== v) { to[k][zi] = v; changed = true; }
      }
    });
    if (!changed) return;
    for (const k of KINDS) from[k].set(cur[k]); // restart from wherever any running animation has got to
    t0 = performance.now();
    if (!running) { running = true; requestAnimationFrame(tick); }
  });
}
