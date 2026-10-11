// Land cover and planting: parks, lawns, woods, meadows, pitches, cemeteries and water with banks,
// then rule-based placement of trees, shrubs, flower beds, hedges and park furniture. Every placement
// checks the occupancy grid, so nothing lands on a road, sidewalk, building, entrance or another object.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { hash, pickBy, seeded, CHUNK } from './palette.js';
import { Batches, OCC, triangulate, bounds, inside, edges, inset, chunkKey } from './geometry.js';
import { TREE_KINDS, SHRUBS, FLOWERS } from './sprite-art.js';

const WHITE = new THREE.Color(1, 1, 1);
const COVER = { // OSM area kind → ground texture, height layer
  park: ['lawn', .012], garden: ['lawn', .014], grass: ['lawn', .012], village_green: ['lawn', .012], recreation_ground: ['lawn', .012],
  golf_course: ['lawn', .012], pitch: ['pitch', .016], wood: ['forest', .01], forest: ['forest', .01], scrub: ['meadow', .01],
  meadow: ['meadow', .01], cemetery: ['cemetery', .012],
};
const BLOCK = OCC.building | OCC.road | OCC.sidewalk | OCC.keepClear | OCC.decor | OCC.water | OCC.lot;

export function buildLand({ osm, grid, ground, zones, waterFrames, parent }) {
  const batches = new Batches(), r = seeded(2024);
  const trees = [], shrubs = [], flowers = [], props = [], fences = [];

  // Sim zones keep base-map trees out; the zone layer plants its own there.
  for (const { ring } of zones) grid.fillRing(ring, OCC.zone);

  // ---------- cover ----------
  const covered = [];
  for (const [kind, ring] of osm.a) {
    if (kind === 'parking') continue;
    const ck = chunkKey(ring[0], ring[1], CHUNK);
    if (kind === 'water') {
      const bank = inset(ring, -1.4);
      if (bank) { const b = batches.at(`${ck}|sand`); for (const [p, q, s] of triangulate([bank])) b.flat(p, q, s, .02, WHITE, (x, z) => [x / 6.4, -z / 6.4]); }
      const b = batches.at(`${ck}|water`);
      for (const [p, q, s] of triangulate([ring])) b.flat(p, q, s, .03, WHITE, (x, z) => [x / 12, -z / 12]);
      grid.fillRing(ring, OCC.water);
      continue;
    }
    const c = COVER[kind];
    if (!c) continue;
    const [tex, y] = c;
    let uv = (x, z) => [x / 16, -z / 16];
    if (kind === 'pitch') { // stripes run along the pitch's long side
      let best = 0, ang = 0;
      edges(ring, (ax, az, bx, bz, l) => { if (l > best) { best = l; ang = Math.atan2(bz - az, bx - ax); } });
      const cs = Math.cos(-ang), sn = Math.sin(-ang);
      uv = (x, z) => [(x * cs - z * sn) / 16, -(x * sn + z * cs) / 16];
    }
    const b = batches.at(`${ck}|${tex}`);
    for (const [p, q, s] of triangulate([ring])) b.flat(p, q, s, y, WHITE, uv);
    covered.push([kind, ring]);
  }

  // ---------- planting rules ----------
  const place = (x, z, rad, list, item) => {
    if (!grid.clear(x, z, rad, BLOCK | OCC.zone)) return false;
    list.push(item);
    grid.fill(x - rad * .7, z - rad * .7, x + rad * .7, z + rad * .7, OCC.decor);
    return true;
  };
  function scatter(ring, step, fn) {
    const [x0, z0, x1, z1] = bounds(ring);
    for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
      const px = x + r() * step, pz = z + r() * step;
      if (inside(ring, px, pz)) fn(px, pz);
    }
  }
  for (const [kind, ring] of covered) {
    if (kind === 'wood' || kind === 'forest') scatter(ring, 6.5, (x, z) => {
      const name = pickBy(TREE_KINDS.wood, hash(x, z, 1));
      if (place(x, z, 2, trees, { x, z, name, scale: .85 + hash(x, z, 2) * .4 })) return;
      if (hash(x, z, 3) < .3) place(x, z, .8, shrubs, { x, z, name: hash(x, z, 4) < .5 ? 'fern' : 'shrub' });
    });
    else if (kind === 'scrub' || kind === 'meadow') scatter(ring, 9, (x, z) => {
      if (hash(x, z, 5) < .35) place(x, z, 2, trees, { x, z, name: pickBy(TREE_KINDS.park, hash(x, z, 6)) });
      else place(x, z, 1, shrubs, { x, z, name: pickBy(['shrub', 'shrubWide', 'fern', 'rock'], hash(x, z, 7)) });
    });
    else if (kind === 'cemetery') scatter(ring, 3.2, (x, z) => {
      if (hash(x, z, 8) < .12) place(x, z, 2, trees, { x, z, name: hash(x, z, 9) < .5 ? 'spruce' : 'oakDark' });
      else place(x, z, .6, props, { x, z, name: 'headstone' });
    });
    else if (kind !== 'pitch' && kind !== 'golf_course') scatter(ring, 17, (x, z) => { // parks, lawns, gardens
      const k = hash(x, z, 10);
      if (k < .55) place(x, z, 2.2, trees, { x, z, name: pickBy(TREE_KINDS.park, hash(x, z, 11)), scale: .9 + hash(x, z, 12) * .3 });
      else if (k < .72) place(x, z, 1, flowers, { x, z, name: pickBy(FLOWERS, hash(x, z, 13)) });
      else if (k < .8) place(x, z, 1.2, props, { x, z, name: hash(x, z, 14) < .6 ? 'bench' : 'picnic' });
      else place(x, z, 1, shrubs, { x, z, name: pickBy(SHRUBS, hash(x, z, 15)) });
    });
  }
  for (let i = 0; i < osm.t.length; i += 2) { // individually mapped trees
    const x = osm.t[i], z = osm.t[i + 1];
    if (!(grid.at(x, z) & (OCC.zone | OCC.building | OCC.road))) { trees.push({ x, z, name: pickBy(TREE_KINDS.park, hash(x, z, 16)), scale: .95 + hash(x, z, 17) * .3 }); grid.fill(x - 1, z - 1, x + 1, z + 1, OCC.decor); }
  }

  return {
    trees, shrubs, flowers, props, fences,
    // Yards: around each building, foundation shrubs, flower beds by the door side, a yard tree or two,
    // and a hedge or fence along the back for houses. Called after buildings and streets exist.
    plantYards(meta) {
      for (const m of meta) {
        if (m.family === 'stadium' || m.family === 'garage') continue;
        const small = m.family === 'house' || m.family === 'shed';
        edges(m.outer, (ax, az, bx, bz, l, idx) => {
          if (l < 2) return;
          const nx = (az - bz) / l, nz = (bx - ax) / l, ux = (bx - ax) / l, uz = (bz - az) / l;
          for (let s = 1.2; s < l - 1; s += small ? 2.6 : 3.4) { // foundation planting hugging the wall
            const x = ax + ux * s + nx * 1.1, z = az + uz * s + nz * 1.1, k = hash(x, z, 20);
            if (k < (small ? .5 : .3)) place(x, z, .6, k < .18 ? flowers : shrubs, { x, z, name: k < .18 ? pickBy(FLOWERS, hash(x, z, 21)) : pickBy(SHRUBS, hash(x, z, 22)) });
          }
          if (small && l > 4 && hash(ax, az, 23) < .45) { // yard tree a few metres out
            const s = l * hash(ax, az, 24), x = ax + ux * s + nx * 5, z = az + uz * s + nz * 5;
            place(x, z, 2.2, trees, { x, z, name: pickBy(TREE_KINDS.yard, hash(x, z, 25)), scale: .8 + hash(x, z, 26) * .3 });
          }
          if (m.family === 'house' && l > 5 && hash(bx, bz, 27) < .3) { // picket fence or hedge on quiet sides
            const off = 4, x0 = ax + nx * off, z0 = az + nz * off, x1 = bx + nx * off, z1 = bz + nz * off;
            let ok = true;
            for (let t = 0; t <= 1 && ok; t += .1) ok = grid.clear(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, .6, BLOCK);
            if (ok) { fences.push({ x0, z0, x1, z1, kind: hash(ax, bz, 28) < .5 ? 'fencePicket' : 'hedge' }); grid.fillLine([x0, z0, x1, z1], .6, OCC.decor); }
          }
        });
        if (m.family === 'campus' || m.family === 'shop') { // bike racks and planters near busy buildings
          const x = m.cx + (hash(m.cx, m.cz, 29) - .5) * 4, [bx0, bz0, bx1, bz1] = bounds(m.outer), z = bz1 + 2.5;
          if (hash(m.cx, m.cz, 30) < .5) place(x, z, 1.4, props, { x, z, name: m.family === 'campus' ? 'bikeRack' : 'planter' });
          if (m.family === 'shop' && hash(m.cx, m.cz, 31) < .4) place(bx0 - 1.5, z, .8, props, { x: bx0 - 1.5, z, name: 'trash' });
        }
        if (m.family === 'house' && hash(m.cx, m.cz, 32) < .5) { const [, , x1, z1] = bounds(m.outer); place(x1 + 2, z1 + 2, .7, props, { x: x1 + 2, z: z1 + 2, name: 'mailbox' }); }
      }
    },
    // Open ground near buildings (campus quads, front lawns) gets sparse trees, shrubs and flower beds.
    // A coarse 20 m map of cells near buildings keeps this from carpeting open countryside.
    fillOpen(meta, ext) {
      const C = 20, n = Math.ceil(2 * ext / C), urban = new Uint8Array(n * n);
      for (const m of meta) {
        const [x0, z0, x1, z1] = bounds(m.outer);
        for (let j = Math.floor((z0 + ext) / C) - 2; j <= Math.floor((z1 + ext) / C) + 2; j++)
          for (let i = Math.floor((x0 + ext) / C) - 2; i <= Math.floor((x1 + ext) / C) + 2; i++)
            if (i >= 0 && j >= 0 && i < n && j < n) urban[j * n + i] = 1;
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        if (!urban[j * n + i]) continue;
        for (let k = 0; k < 3; k++) {
          const x = i * C - ext + r() * C, z = j * C - ext + r() * C, roll = hash(x, z, 50);
          if (roll < .32) place(x, z, 3.2, trees, { x, z, name: pickBy(TREE_KINDS.park, hash(x, z, 51)), scale: .8 + hash(x, z, 52) * .35 });
          else if (roll < .5) place(x, z, 1, shrubs, { x, z, name: pickBy(SHRUBS, hash(x, z, 53)) });
          else if (roll < .58) place(x, z, 1, flowers, { x, z, name: pickBy(FLOWERS, hash(x, z, 54)) });
        }
      }
    },
    build(details) {
      const mats = {};
      const mat = (name, k) => {
        const t = name === 'water' ? waterFrames[0] : ground[name];
        const tex = t.clone(); tex.repeat.set(1, 1); tex.needsUpdate = true;
        const opts = { map: tex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k * 2 };
        return name === 'water' ? new THREE.MeshPhongMaterial({ ...opts, specular: '#ffffff', shininess: 90 }) : new THREE.MeshLambertMaterial(opts);
      };
      const group = new THREE.Group();
      for (const [key, b] of batches.map) {
        if (b.empty) continue;
        const name = key.split('|')[1];
        mats[name] ??= mat(name, name === 'water' ? 1.5 : name === 'sand' ? 1 : name === 'pitch' ? .9 : .7);
        const mesh = new THREE.Mesh(b.build(), mats[name]);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      // Fences and hedges: upright strips from the details atlas.
      const fb = new Batches(), [u0, v0, u1, v1] = [0, 0, 0, 0];
      for (const f of fences) {
        const b = fb.at(chunkKey(f.x0, f.z0, CHUNK)), [a0, b0, a1, b1] = details.uv(f.kind), h = f.kind === 'hedge' ? 1.1 : .9;
        const l = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), reps = Math.max(1, Math.round(l / 3.2));
        for (let k = 0; k < reps; k++) {
          const t0 = k / reps, t1 = (k + 1) / reps, x0 = f.x0 + (f.x1 - f.x0) * t0, z0 = f.z0 + (f.z1 - f.z0) * t0, x1 = f.x0 + (f.x1 - f.x0) * t1, z1 = f.z0 + (f.z1 - f.z0) * t1;
          b.quad([[x0, 0, z0], [x1, 0, z1], [x1, h, z1], [x0, h, z0]], [0, 0, 1], [a0, b1, a1, b1, a1, b0, a0, b0], WHITE);
        }
      }
      const fenceMat = new THREE.MeshLambertMaterial({ map: details.texture, vertexColors: true, alphaTest: .5, side: THREE.DoubleSide });
      for (const b of fb.map.values()) if (!b.empty) { const m = new THREE.Mesh(b.build(), fenceMat); m.castShadow = m.receiveShadow = true; group.add(m); }
      parent.add(group);
      const water = mats.water;
      let frame = 0, acc = 0;
      return {
        group,
        update(dt) { // step the ripple frames like a sprite animation, with a slow drift
          if (!water) return;
          acc += dt;
          if (acc > .45) { acc = 0; frame = (frame + 1) % waterFrames.length; const t = waterFrames[frame].clone(); t.repeat.set(1, 1); t.needsUpdate = true; water.map.dispose(); water.map = t; }
        },
      };
    },
  };
}
