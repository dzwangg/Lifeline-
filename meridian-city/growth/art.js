// Meshes for planned development, in the city's own art: buildings styled by the same code as the OSM footprints
// (world/buildings.js style()), lawns, soil pads and front paths in the ground textures, local streets in the street
// textures, and scaffolds and planting as sprites. Each parcel is two merged building meshes whose buildings rise one
// after another through a per-vertex start time and a per-parcel progress uniform, so a whole neighbourhood costs a few
// draw calls and nothing is allocated per frame.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { Batch, Batches } from '../world/geometry.js';
import { tilingMaterial } from '../world/textures.js';
import { LOD, pickBy } from '../world/palette.js';
import { TREE_KINDS, SHRUBS, FLOWERS } from '../world/sprite-art.js';
import { rectRing } from './geom.js';
import { PLANT_CROWN } from './plan.js';

const WHITE = new THREE.Color(1, 1, 1);
const SCAFFOLD_W = 8; // metres: the scaffold sprite's drawn width
// Ground layers, in the city's polygon-offset order: land cover is 1 to 1.5, the old zone soil 1.8, sidewalks 2, paths 3,
// asphalt 4, markings 6.
const OFFSET = { lawn: 1.6, soil: 1.8, path: 2.5, streetSoil: 1.9, sidewalk: 2.2, asphalt: 4.2, mouth: 6.5 };

// Patches a material so each vertex's building (attribute aRise: start, duration, in shares of the rise) grows from the
// ground as uniform uP passes its start, and the whole parcel sinks as uDown goes to 1 (demolition).
function rising(material, uniforms, key) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, renderer) => {
    prev?.call(material, sh, renderer);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRise;\nuniform float uP;\nuniform float uDown;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y *= clamp((uP - aRise.x) / aRise.y, 0.0, 1.0) * (1.0 - uDown);');
  };
  material.customProgramCacheKey = () => `growth-rise-${key}`;
  return material;
}
// Ground and street layers revealed along a street by arc length: fragments beyond uReveal metres are dropped.
function revealing(material, uniforms) {
  material.onBeforeCompile = sh => {
    sh.uniforms.uReveal = uniforms.uReveal;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aS;\nvarying float vS;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = aS;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uReveal;\nvarying float vS;').replace('void main() {', 'void main() {\n  if (vS > uReveal) discard;');
  };
  material.customProgramCacheKey = () => 'growth-reveal';
  return material;
}
const groundMaterial = (map, offset) => new THREE.MeshLambertMaterial({ map, polygonOffset: true, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset * 2 });

/**
 * @param {object} o
 * @param {object} o.world buildWorld()'s result
 * @param {object} o.ground groundTextures()
 */
export function createGrowthArt({ world, ground }) {
  const { buildings, sprites, view } = world, scene = view.scene;
  const lawnMat = groundMaterial(ground.lawn, OFFSET.lawn), soilMat = groundMaterial(ground.soil, OFFSET.soil), pathMat = groundMaterial(ground.sidewalk, OFFSET.path);

  // Flat rectangles (lawns, pads) and strips (paths) into one geometry. uv in metres: the textures repeat per metre.
  function flats(rects) {
    const b = new Batch();
    for (const o of rects) {
      const r = rectRing(o), p = i => [r[2 * i], r[2 * i + 1]];
      b.flat(p(0), p(1), p(2), .05, WHITE, (x, z) => [x, -z]);
      b.flat(p(0), p(2), p(3), .05, WHITE, (x, z) => [x, -z]);
    }
    return b.build();
  }
  const pathRect = (p, e) => {
    const [ax, az, bx, bz] = p.r, l = Math.hypot(bx - ax, bz - az);
    return { cx: (ax + bx) / 2, cz: (az + bz) / 2, ux: e[0], uz: e[1], hw: p.w / 2, hd: l / 2 };
  };
  const ground2 = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.layers.set(2); m.visible = false; scene.add(m); return m; };
  const sprite = (count, names) => {
    const m = sprites.lod(sprites.slots(count, names), { minZoom: LOD.trees ?? LOD.macro });
    m.layers.set(2); m.frustumCulled = false; m.count = count;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) m.setMatrixAt(i, zero);
    scene.add(m);
    return m;
  };

  /**
   * One parcel's planned development. owner(b) registers a building's info-card entry and returns its meta index.
   * Returns { buildings, set(rise, down), ... }: the zone layer drives the stages.
   */
  function parcel(plan, owner) {
    const uniforms = { uP: { value: 0 }, uDown: { value: 0 } };
    const batches = new Batches(), wb = batches.get('wall'), db = batches.get('detail');
    const n = plan.buildings.length, RISE_LEN = Math.max(.25, Math.min(.55, 1.6 / Math.max(1, n)));
    const rise = { w: [], d: [] }, metas = [];
    plan.buildings.forEach((b, k) => {
      const start = n > 1 ? (1 - RISE_LEN) * k / (n - 1) : 0; // in shares of the rise window
      const idx = owner(b, k);
      wb.current = db.current = idx;
      const w0 = wb.p.length / 3, d0 = db.p.length / 3;
      const s = buildings.style({
        outer: b.ring, type: b.fam === 'house' ? 'house' : 'apartments',
        force: { fam: b.fam, wall: b.style.wall, roof: b.style.roof, floors: b.floors, roofShape: b.style.roofShape, front: b.front, doors: b.doors.length,
          porch: b.style.porch, chimney: b.style.chimney, solar: b.style.solar, balconies: b.style.balconies, door: b.style.door, ground: b.style.ground, awnings: b.style.awnings },
      }, wb, db);
      for (let v = w0; v < wb.p.length / 3; v++) rise.w.push(start, RISE_LEN);
      for (let v = d0; v < db.p.length / 3; v++) rise.d.push(start, RISE_LEN);
      metas.push({ idx, start, len: RISE_LEN, top: s?.top ?? 6, H: s?.H ?? 4, area: s?.A ?? b.w * b.d });
    });
    const group = new THREE.Group();
    group.layers.set(2);
    const meshes = [];
    for (const [b, mat, aRise, key] of [[wb, tilingMaterial(buildings.wallMaterial.map), rise.w, 'wall'], [db, buildings.detailMaterial.clone(), rise.d, 'detail']]) {
      if (b.empty) continue;
      const geo = b.build();
      geo.setAttribute('aRise', new THREE.Float32BufferAttribute(aRise, 2));
      const mesh = new THREE.Mesh(geo, rising(mat, uniforms, key));
      mesh.customDepthMaterial = rising(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), uniforms, `depth-${key}`);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.owner = geo.userData.owner;
      mesh.layers.set(2);
      if (key === 'detail') mesh.userData.detail = true;
      group.add(mesh); meshes.push(mesh);
    }
    group.visible = false;
    scene.add(group);

    const e = b => [b.ring[2] - b.ring[0], b.ring[3] - b.ring[1]].map((v, _, a) => v / Math.hypot(...a));
    const pads = ground2(flats(plan.pads), soilMat), lawn = ground2(flats(plan.lawns), lawnMat);
    // Paths come one per door, building by building, so each runs square to its building's front edge.
    const pathAxes = plan.buildings.flatMap(b => b.doors.map(() => e(b)));
    const paths = ground2(flats(plan.paths.map((p, i) => pathRect(p, pathAxes[i]))), pathMat);

    const scaffold = sprite(n, () => 'scaffold');
    const plants = plan.plantings, names = plants.map(t => t.kind === 'shrub' ? pickBy(SHRUBS, t.r) : t.kind === 'flower' ? pickBy(FLOWERS, t.r) : pickBy(TREE_KINDS[t.kind === 'street' ? 'street' : 'yard'], t.r));
    const planted = plants.length ? sprite(plants.length, i => names[i]) : null;
    // Trees are drawn no wider than the planner kept clear round them (plan.js PLANT_CROWN), so no crown reaches a wall.
    const plantScale = plants.map((t, i) => (t.kind === 'street' || t.kind === 'yard' ? Math.min(.7 + t.r * .25, 2 * PLANT_CROWN / world.art.sprites[names[i]].w) : 1));

    const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    let last = '';
    return {
      plan, metas, meshes, group, done: false, gate: null,
      /** Frees the GPU side once no forecast shows this plan: meshes, ground, sprites, picking and its walks. */
      dispose() {
        const pickables = buildings.pickables;
        for (const m of meshes) { const k = pickables.indexOf(m); if (k >= 0) pickables.splice(k, 1); m.geometry.dispose(); m.material.dispose(); m.customDepthMaterial?.dispose(); }
        for (const o of [group, pads, lawn, paths, scaffold, planted].filter(Boolean)) { scene.remove(o); if (o !== group) o.geometry.dispose(); }
        if (this.gate) this.gate.open = false;
      },
      /** Front paths for the walker network, and the doors walkers may visit (growth gates them until built). */
      walks: () => plan.paths.map(p => ({ r: p.r.slice(2).concat(p.r.slice(0, 2)), w: p.w })),
      doors: () => plan.buildings.flatMap(b => b.doors.map(([x, z]) => ({ x, z, label: b.label, family: b.fam }))),
      /**
       * rise: the buildings' progress (0: none started, 1: all up); down: demolition (1: gone); stage flags for the
       * ground; scaffold(k) the scaffold scale for building k; grow (0 to 1) the planting.
       */
      set({ rise, down = 0, pads: showPads, lawn: showLawn, paths: showPaths, scaffolds, grow }) {
        const key = `${rise}|${down}|${showPads}|${showLawn}|${showPaths}|${grow}|${scaffolds}`;
        if (key === last) return;
        last = key;
        this.done = rise >= 1 && down === 0;
        uniforms.uP.value = rise; uniforms.uDown.value = down;
        group.visible = rise > 0 && down < 1;
        pads.visible = showPads; lawn.visible = showLawn; paths.visible = showPaths;
        plan.buildings.forEach((b, k) => {
          const m = metas[k], up = scaffolds ? Math.min(1, Math.max(0, (rise - m.start + .08) / .06)) * Math.min(1, Math.max(0, (m.start + m.len + .04 - rise) / .06)) : 0;
          const sc = up * Math.max(b.w, b.d) / SCAFFOLD_W;
          _m.compose(_p.set(b.c[0], 0, b.c[1]), _q, _s.set(sc, sc * Math.max(1, m.H / 6), sc));
          scaffold.setMatrixAt(k, _m);
        });
        scaffold.instanceMatrix.needsUpdate = true;
        if (planted) {
          plants.forEach((t, i) => { const k = grow ** .5 * plantScale[i]; _m.compose(_p.set(t.x, 0, t.z), _q, _s.set(k, k, k)); planted.setMatrixAt(i, _m); });
          planted.instanceMatrix.needsUpdate = true;
        }
      },
    };
  }

  /** A local street: asphalt, sidewalks both sides, a turning circle, over a strip of graded soil. Revealed along its length. */
  function street(S) {
    const soilU = { uReveal: { value: 0 } }, paveU = { uReveal: { value: 0 } };
    const asphalt = new Batch(), walk = new Batch(), soil = new Batch(), mouth = new Batch(), sAttr = { asphalt: [], walk: [], soil: [], mouth: [] };
    const [ax, az, cx, cz] = S.r, len = S.len, ux = (cx - ax) / len, uz = (cz - az) / len, nx = uz, nz = -ux;
    const P = (s, o) => [ax + ux * s + nx * o, az + uz * s + nz * o];
    const quad = (b, attr, s0, s1, o0, o1) => { // a strip piece, uv in metres
      const a = P(s0, o0), bb = P(s1, o0), c = P(s1, o1), d = P(s0, o1);
      b.flat(a, bb, c, .06, WHITE, (x, z) => [x, -z]); b.flat(a, c, d, .06, WHITE, (x, z) => [x, -z]);
      for (const s of [s0, s1, s1, s0, s1, s0]) attr.push(s);
    };
    const STEP = 4, H = S.half, W = S.half + S.sw;
    for (let s = 0; s < len; s += STEP) {
      const s1 = Math.min(len, s + STEP);
      quad(asphalt, sAttr.asphalt, s, s1, -H, H);
      quad(soil, sAttr.soil, s, s1, -W - .6, W + .6);
      if (s1 > S.mouth) for (const sd of [-1, 1]) quad(walk, sAttr.walk, Math.max(s, S.mouth), s1, sd * H, sd * W);
    }
    quad(mouth, sAttr.mouth, S.mouth - 2.6, S.mouth + .2, -H, H); // over the parent's kerb line, so the street meets it flush
    // The turning circle: an asphalt disc and a sidewalk ring.
    const ring = (b, attr, r0, r1) => {
      const seg = 20;
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
        const p = (a, r) => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
        if (r0 === 0) b.flat([cx, cz], p(a0, r1), p(a1, r1), .06, WHITE, (x, z) => [x, -z]);
        else { b.flat(p(a0, r0), p(a0, r1), p(a1, r1), .06, WHITE, (x, z) => [x, -z]); b.flat(p(a0, r0), p(a1, r1), p(a1, r0), .06, WHITE, (x, z) => [x, -z]); }
        for (let v = 0; v < (r0 === 0 ? 3 : 6); v++) attr.push(len);
      }
    };
    ring(asphalt, sAttr.asphalt, 0, S.bulb);
    ring(walk, sAttr.walk, S.bulb, S.bulb + S.sw);
    ring(soil, sAttr.soil, 0, S.bulb + S.sw + .6);
    const mk = (b, attr, map, offset, u) => {
      const geo = b.build();
      geo.setAttribute('aS', new THREE.Float32BufferAttribute(attr, 1));
      const m = new THREE.Mesh(geo, revealing(groundMaterial(map, offset), u));
      m.receiveShadow = true; m.layers.set(2); m.visible = false;
      scene.add(m);
      return m;
    };
    const meshes = { soil: mk(soil, sAttr.soil, ground.soil, OFFSET.streetSoil, soilU), asphalt: mk(asphalt, sAttr.asphalt, ground.asphalt, OFFSET.asphalt, paveU),
      walk: mk(walk, sAttr.walk, ground.sidewalk, OFFSET.sidewalk, paveU), mouth: mk(mouth, sAttr.mouth, ground.asphalt, OFFSET.mouth, paveU) };
    const total = len + 1; // reveal values past the end show the turning circle too
    let last = '';
    return {
      S, done: false, gate: null,
      dispose() {
        for (const m of Object.values(meshes)) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
        if (this.gate) this.gate.open = false;
      },
      /** Its two sidewalks as one walk, from the parent's kerb round the turning circle and back. */
      walks() {
        const o = H + S.sw / 2, R = S.bulb + S.sw / 2, end = len - Math.sqrt(Math.max(0, R * R - o * o)), pts = [];
        for (let s = S.mouth; s < end; s += 6) pts.push(...P(s, o));
        pts.push(...P(end, o));
        const ang = (x, z) => Math.atan2(z - cz, x - cx), [lx, lz] = P(end, o), [rx, rz] = P(end, -o);
        let from = ang(lx, lz), to = ang(rx, rz);
        // Round the far side of the circle: the way that doesn't cross the street.
        const mid = Math.atan2(uz, ux);
        let span = to - from; while (span <= 0) span += Math.PI * 2;
        const via = from + span / 2; if (Math.cos(via - mid) < 0) span -= Math.PI * 2;
        for (let k = 1; k < 12; k++) { const a = from + span * k / 12; pts.push(cx + Math.cos(a) * R, cz + Math.sin(a) * R); }
        pts.push(rx, rz);
        for (let s = end - 6; s > S.mouth; s -= 6) pts.push(...P(s, -o));
        pts.push(...P(S.mouth, -o));
        return [{ r: pts, w: S.sw }];
      },
      /** soil and pave: how far along (0 to 1) the graded soil and the finished street reach. */
      set(soilK, paveK) {
        const key = `${soilK}|${paveK}`;
        if (key === last) return;
        last = key;
        this.done = paveK >= 1;
        soilU.uReveal.value = soilK * total; paveU.uReveal.value = paveK * total;
        meshes.soil.visible = soilK > 0 && paveK < 1;
        meshes.asphalt.visible = meshes.walk.visible = meshes.mouth.visible = paveK > 0;
      },
    };
  }

  return { parcel, street };
}
