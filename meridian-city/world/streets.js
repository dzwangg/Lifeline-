// Streets that follow the real road geometry: asphalt, sidewalks and curbs, lane markings that stop
// short of junctions, zebra crossings, parking lots with oriented stalls, brick walks and dirt paths.
// Also returns the lane and walkway graphs for traffic and pedestrians, and street-furniture placements.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { P, hash, pickBy, CHUNK } from './palette.js';
import { Batches, OCC, triangulate, edges, chunkKey } from './geometry.js';
import { TREE_KINDS } from './sprite-art.js';

export const ROAD_W = { trunk: 15, primary: 13, secondary: 11, tertiary: 9, unclassified: 7, residential: 7, living_street: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 6, service: 4.5, pedestrian: 5, track: 3, footway: 2.2, cycleway: 2.2, steps: 2.2, path: 1.6 };
export const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
export const DRIVE = new Set([...MAJOR, 'unclassified', 'residential', 'living_street', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const WALK = new Set(['footway', 'pedestrian', 'steps', 'path', 'cycleway', 'track']);
const SIDEWALK_W = 2.2;
const Y = { lot: .03, sidewalk: .045, path: .05, asphalt: .06, curb: .065, mark: .07, zebra: .075 };
const WHITE = new THREE.Color(1, 1, 1);
const col = h => new THREE.Color(h);

// Per-vertex left normals with mitred joints, for offsetting a polyline sideways.
function normals(r) {
  const n = r.length / 2, out = [];
  const dir = i => { const dx = r[2 * i + 2] - r[2 * i], dz = r[2 * i + 3] - r[2 * i + 1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  for (let i = 0; i < n; i++) {
    const [ax, az] = dir(Math.max(0, i - 1)), [bx, bz] = dir(Math.min(n - 2, i));
    let tx = ax + bx, tz = az + bz; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const k = 1 / Math.max(.5, tx * bx + tz * bz);
    out.push([tz * k, -tx * k]); // left of travel
  }
  return out;
}

// A strip from offset o0 to o1 (metres left of centre) along a polyline. uvMode: 'world' tiles in world
// x/z; 'along' runs u along the road (for slabs and bricks that should follow it).
function strip(b, r, o0, o1, y, c, uvMode, tile = 1) {
  const N = normals(r), n = r.length / 2;
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * i + 2], bz = r[2 * i + 3], l = Math.hypot(bx - ax, bz - az);
    const p = (x, z, ni, o) => [x + N[ni][0] * o, z + N[ni][1] * o];
    const A0 = p(ax, az, i, o0), A1 = p(ax, az, i, o1), B0 = p(bx, bz, i + 1, o0), B1 = p(bx, bz, i + 1, o1);
    const uv = uvMode === 'world' ? (x, z) => [x / tile, -z / tile] : null;
    if (uv) { b.flat(A0, B0, B1, y, c, uv); b.flat(A0, B1, A1, y, c, uv); }
    else {
      const U = (pt, along, o) => [along / tile, o / tile];
      const map = new Map([[A0, U(A0, s, o0)], [A1, U(A1, s, o1)], [B0, U(B0, s + l, o0)], [B1, U(B1, s + l, o1)]]);
      b.flat(A0, B0, B1, y, c, (x, z) => map.get([A0, B0, B1, A1].find(q => q[0] === x && q[1] === z)));
      b.flat(A0, B1, A1, y, c, (x, z) => map.get([A0, B0, B1, A1].find(q => q[0] === x && q[1] === z)));
    }
    s += l;
  }
}

// Walks a polyline in steps, calling f(x, z, ux, uz, s) except within `trim` metres of either end
// when that end is a junction.
export function along(r, step, trimStart, trimEnd, f, start = 0) {
  let total = 0;
  for (let i = 0; i + 2 < r.length; i += 2) total += Math.hypot(r[i + 2] - r[i], r[i + 3] - r[i + 1]);
  let s0 = 0;
  for (let i = 0; i + 2 < r.length; i += 2) {
    const ax = r[i], az = r[i + 1], l = Math.hypot(r[i + 2] - ax, r[i + 3] - az), ux = (r[i + 2] - ax) / l, uz = (r[i + 3] - az) / l;
    for (let s = Math.ceil((s0 - start) / step) * step + start; s < s0 + l; s += step) {
      if (s < trimStart || s > total - trimEnd) continue;
      f(ax + ux * (s - s0), az + uz * (s - s0), ux, uz, s);
    }
    s0 += l;
  }
  return total;
}

// fit(item): the scale at which a street tree { x, z, name, scale } clears every building with its crown, or 0 (land.js).
export function buildStreets({ osm, grid, ground, parent, fit = it => it.scale }) {
  const batches = new Batches();
  const roads = osm.r.filter(([cls]) => ROAD_W[cls]).map(([cls, ow, r]) => ({ cls, ow, r, w: ROAD_W[cls], len: 0 }));
  const key = (x, z) => `${x},${z}`;

  // Junctions: vertices where three or more drivable segments meet.
  const deg = new Map(), touch = new Map();
  for (const q of roads) if (DRIVE.has(q.cls) || q.cls === 'service') {
    const n = q.r.length / 2;
    for (let i = 0; i < n; i++) {
      const k = key(q.r[2 * i], q.r[2 * i + 1]);
      deg.set(k, (deg.get(k) ?? 0) + (i === 0 || i === n - 1 ? 1 : 2));
      if (!touch.has(k)) touch.set(k, []);
      touch.get(k).push(q);
    }
  }
  const isJunction = (x, z) => (deg.get(key(x, z)) ?? 0) >= 3;
  const junctionRadius = (x, z) => Math.max(...(touch.get(key(x, z)) ?? []).map(q => q.w / 2)) + 1.5;
  const trims = q => {
    const n = q.r.length / 2, [sx, sz, ex, ez] = [q.r[0], q.r[1], q.r[2 * n - 2], q.r[2 * n - 1]];
    return [isJunction(sx, sz) ? junctionRadius(sx, sz) : 0, isJunction(ex, ez) ? junctionRadius(ex, ez) : 0];
  };
  const chunkOf = q => chunkKey(q.r[0], q.r[1], CHUNK);

  // ---------- surfaces ----------
  const curbC = col('#ffffff'), markW = col(P.lineWhite), markY = col(P.lineYellow);
  const lampItems = [], signItems = [], hydrants = [], busStops = [], benches = [], trees = [];
  for (const q of roads) {
    const { cls, r, w } = q, ck = chunkOf(q), drive = DRIVE.has(cls), half = w / 2;
    if (drive || cls === 'service') {
      strip(batches.at(`${ck}|asphalt`), r, -half, half, Y.asphalt, WHITE, 'world', 64 * .2);
      grid.fillLine(r, half, OCC.road);
      if (drive) { // sidewalks both sides, laid in slabs along the street
        for (const s of [-1, 1]) strip(batches.at(`${ck}|sidewalk`), r, s * half, s * (half + SIDEWALK_W), Y.sidewalk, WHITE, 'along', 20 * .2);
        grid.fillLine(r, half + SIDEWALK_W, OCC.sidewalk);
      }
    } else {
      // Brick for pedestrian streets and some of Chapel Hill's brick walks; concrete pavers elsewhere.
      const surface = cls === 'path' || cls === 'track' ? 'dirtPath' : cls === 'pedestrian' || hash(r[0], r[1], 41) < .3 ? 'brickPath' : 'sidewalk';
      strip(batches.at(`${ck}|${surface}`), r, -half, half, Y.path, WHITE, surface === 'brickPath' ? 'along' : 'world', surface === 'brickPath' ? 16 * .2 : 32 * .2);
      grid.fillLine(r, half, OCC.sidewalk);
    }
    for (let i = 0; i + 2 < r.length; i += 2) q.len += Math.hypot(r[i + 2] - r[i], r[i + 3] - r[i + 1]);
  }

  // ---------- curbs, markings, crossings ----------
  for (const q of roads) {
    if (!DRIVE.has(q.cls)) continue;
    const { r, w, cls, ow } = q, ck = chunkOf(q), mb = batches.at(`${ck}|marks`), half = w / 2, [t0, t1] = trims(q);
    const seg = (x, z, ux, uz, o, len, width, c, y = Y.mark) => { // a short painted dash centred at offset o
      const nx = uz, nz = -ux, cx = x + nx * o, cz = z + nz * o, hx = ux * len / 2, hz = uz * len / 2, wx = nx * width / 2, wz = nz * width / 2;
      mb.flat([cx - hx - wx, cz - hz - wz], [cx + hx - wx, cz + hz - wz], [cx + hx + wx, cz + hz + wz], y, c, () => [0, 0]);
      mb.flat([cx - hx - wx, cz - hz - wz], [cx + hx + wx, cz + hz + wz], [cx - hx + wx, cz - hz + wz], y, c, () => [0, 0]);
    };
    along(r, 1, t0, t1, (x, z, ux, uz) => { // curbs: light kerb stones at both edges
      for (const s of [-1, 1]) seg(x, z, ux, uz, s * (half - .1), 1.02, .22, curbC, Y.curb);
    });
    if (MAJOR.has(cls) && !ow) along(r, 1, t0 + 2, t1 + 2, (x, z, ux, uz) => { seg(x, z, ux, uz, .15, 1.02, .14, markY); seg(x, z, ux, uz, -.15, 1.02, .14, markY); });
    else if (MAJOR.has(cls)) along(r, 6, t0 + 2, t1 + 2, (x, z, ux, uz) => seg(x, z, ux, uz, 0, 3, .14, markW));
    else if (!ow && w >= 7) along(r, 5, t0 + 2, t1 + 2, (x, z, ux, uz) => seg(x, z, ux, uz, 0, 2.2, .14, markY));
    if (MAJOR.has(cls)) along(r, 1, t0 + 2, t1 + 2, (x, z, ux, uz) => { for (const s of [-1, 1]) seg(x, z, ux, uz, s * (half - .7), 1.02, .14, markW); });

    // Zebra crossings across each end that meets a junction.
    const n = r.length / 2;
    for (const [end, t] of [[0, t0], [n - 1, t1]]) {
      if (!t || q.len < t * 2 + 4) continue;
      const i = end === 0 ? 0 : n - 2, ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * i + 2], bz = r[2 * i + 3], l = Math.hypot(bx - ax, bz - az);
      let ux = (bx - ax) / l, uz = (bz - az) / l;
      const ox = end === 0 ? ax : bx, oz = end === 0 ? az : bz, inward = end === 0 ? 1 : -1;
      const cx = ox + ux * inward * (t + .8), cz = oz + uz * inward * (t + .8);
      if (MAJOR.has(cls) || (touch.get(key(ox, oz)) ?? []).some(o => MAJOR.has(o.cls)) || hash(ox, oz, 5) < .5) {
        for (let o = -half + .5; o <= half - .5; o += 1) seg(cx, cz, ux, uz, o, 2.4, .5, markW, Y.zebra);
      }
      // Corner furniture: a traffic light where majors meet, a stop sign on minor approaches.
      const sx = cx + uz * (half + 1), sz = cz - ux * (half + 1);
      if (!(grid.at(sx, sz) & OCC.building)) {
        if (MAJOR.has(cls) && (touch.get(key(ox, oz)) ?? []).filter(o => DRIVE.has(o.cls)).length >= 2) signItems.push({ x: sx, z: sz, name: 'trafficLight' });
        else if (!MAJOR.has(cls)) signItems.push({ x: sx, z: sz, name: hash(sx, sz, 2) < .7 ? 'stopSign' : 'streetSign' });
      }
    }

    // Along the kerb: lamps on major streets, hydrants, street trees on quieter ones, bus stops.
    const kerb = half + SIDEWALK_W - .5;
    along(r, MAJOR.has(cls) ? 28 : 40, t0 + 4, t1 + 4, (x, z, ux, uz, s) => {
      for (const side of [-1, 1]) {
        const px = x + uz * side * kerb, pz = z - ux * side * kerb;
        if (grid.at(px, pz) & (OCC.building | OCC.keepClear | OCC.road)) continue;
        if (MAJOR.has(cls) || hash(px, pz, 8) < .35) lampItems.push({ x: px, z: pz, name: 'lamp' });
        else if (hash(px, pz, 9) < .15) hydrants.push({ x: px, z: pz, name: 'hydrant' });
      }
    }, 7);
    if (!MAJOR.has(cls)) along(r, 13, t0 + 6, t1 + 6, (x, z, ux, uz) => {
      for (const side of [-1, 1]) {
        const off = half + SIDEWALK_W + 1.6, px = x + uz * side * off, pz = z - ux * side * off;
        const tree = { x: px, z: pz, kind: 'street', name: pickBy(TREE_KINDS.street, hash(px, pz, 1)), scale: .85 + hash(px, pz, 2) * .3 };
        if (hash(px, pz, 11) < .7 && grid.clear(px, pz, 2, OCC.building | OCC.road | OCC.sidewalk | OCC.keepClear | OCC.decor | OCC.zone) && fit(tree)) { // sim zones plant their own
          trees.push(tree);
          grid.fill(px - 1, pz - 1, px + 1, pz + 1, OCC.decor);
        }
      }
    });
    if (MAJOR.has(cls) && q.len > 200) along(r, 260, t0 + 30, t1 + 30, (x, z, ux, uz) => {
      const px = x + uz * (half + SIDEWALK_W + 1.4), pz = z - ux * (half + SIDEWALK_W + 1.4);
      if (grid.clear(px, pz, 3, OCC.building | OCC.road | OCC.keepClear)) { busStops.push({ x: px, z: pz, name: 'busStop' }); grid.fill(px - 3, pz - 3, px + 3, pz + 3, OCC.decor); }
    }, 90);
  }

  // ---------- parking lots: stalls turned to the lot's longest side ----------
  for (const [kind, ring] of osm.a) {
    if (kind !== 'parking') continue;
    let best = 0, ang = 0;
    edges(ring, (ax, az, bx, bz, l) => { if (l > best) { best = l; ang = Math.atan2(bz - az, bx - ax); } });
    const c = Math.cos(-ang), s = Math.sin(-ang), T = 64 * .2;
    const b = batches.at(`${chunkKey(ring[0], ring[1], CHUNK)}|lot`);
    for (const [p, q, r] of triangulate([ring])) b.flat(p, q, r, Y.lot, WHITE, (x, z) => [(x * c - z * s) / T, -(x * s + z * c) / T]);
    grid.fillRing(ring, OCC.lot);
  }

  // ---------- meshes ----------
  const mats = {
    asphalt: ground.asphalt, sidewalk: ground.sidewalk, brickPath: ground.brickPath, dirtPath: ground.dirtPath, lot: ground.lot,
  };
  const material = {};
  const offsets = { lot: 1, sidewalk: 2, dirtPath: 3, brickPath: 3, asphalt: 4, marks: 6 };
  for (const [name, tex] of Object.entries(mats)) {
    const t = tex.clone(); t.repeat.set(1, 1); t.needsUpdate = true; // uvs are already in tile units
    material[name] = new THREE.MeshLambertMaterial({ map: t, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -offsets[name], polygonOffsetUnits: -offsets[name] * 2 });
  }
  material.marks = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
  const group = new THREE.Group();
  for (const [k, b] of batches.map) {
    if (b.empty) continue;
    const mesh = new THREE.Mesh(b.build(), material[k.split('|')[1]]);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  parent.add(group);

  // Benches beside bus stops.
  for (const s of busStops) benches.push({ x: s.x + 3, z: s.z + .5, name: 'bench' });
  const lanes = roads.filter(q => DRIVE.has(q.cls) || q.cls === 'service');
  const walks = roads.filter(q => WALK.has(q.cls) || DRIVE.has(q.cls));
  return { group, roads, lanes, walks, furniture: [...lampItems, ...signItems, ...hydrants, ...busStops, ...benches], trees, isJunction, SIDEWALK_W };
}
