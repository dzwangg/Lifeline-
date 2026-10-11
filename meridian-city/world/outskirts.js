// The outskirts: everything past the mapped city, so Chapel Hill fades into a finished world instead of stopping.
// Nothing here touches the mapped city or the simulation: it is scenery, laid out in two passes.
//
// planOutskirts() runs once the city's streets exist. It finds the roads the map bake clipped and gives each an end:
//   - a perimeter parkway loops round the city just past the mapped square, and clipped streets curve out to meet it;
//   - highways (trunk, primary and secondary roads) carry on across it and out through valleys in the hills;
//   - clipped footpaths reach the parkway's sidewalk, a few of them over it on arched footbridges, onto a greenway;
//   - what cannot connect ends at a turning circle or a small paved landing, never in the grass.
//   It also lays out districts off the parkway, each reached by its own service road: an energy district (hub and
//   solar field, turbines on the ridge behind), research campuses beside ponds, and village farms (hamlets with plazas
//   and greenhouses). Ponds are fed by streams meandering down from the hills, with park trails that loop the ponds,
//   follow the streams over small footbridges, and link back to a greenway that runs round outside the parkway.
//   Its roads, parking lots and houses are built by the same street and building code as the city.
// buildOutskirts() then raises the terrain (flat under the city and the parkway belt, rolling beyond, then layered
// ridges fading into haze), builds the water, the sites' structures, transit stops, plazas, footbridges and wind
// turbines, and plants meadows, groves and tree belts, thinning to single trees near the city edge.
//
// Every choice is a function of position (palette.hash) or a fixed seed, so the outskirts are the same on every load.
// Turbines, water ripples and swaying foliage all run on the simulation clock's time, so they pause and speed up with
// everything else.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { AERO, AERO_BUILD, TEXEL, LOD, hash, pickBy } from './palette.js';
import { Batches, Grid, OCC, chunkKey, signedArea, triangulate } from './geometry.js';
import { Pix, waterFrames } from './textures.js';
import { TREE_KINDS, SHRUBS, FLOWERS, canopyTone } from './sprite-art.js';
import { ROAD_W, DRIVE } from './streets.js';

const TAU = Math.PI * 2;
const clamp01 = v => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const WHITE = new THREE.Color(1, 1, 1);

// ---------- the shape of the world ----------
// A rounded square (a superellipse) matching the mapped area: squareDist is the distance from the centre under that
// norm, so contours of it run parallel to the map's edges and round its corners. outward() is its gradient.
const SHAPE_P = 10;
export function squareDist(x, z) {
  const ax = Math.abs(x), az = Math.abs(z), m = Math.max(ax, az);
  return m ? m * ((ax / m) ** SHAPE_P + (az / m) ** SHAPE_P) ** (1 / SHAPE_P) : 0;
}
function outward(x, z) {
  const ax = Math.abs(x), az = Math.abs(z), m = Math.max(ax, az) || 1;
  const gx = Math.sign(x) * (ax / m) ** (SHAPE_P - 1), gz = Math.sign(z) * (az / m) ** (SHAPE_P - 1), l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

// Value noise on the position hash, and a few octaves of it.
function vnoise(x, z, salt) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, salt), b = hash(i + 1, j, salt), c = hash(i, j + 1, salt), d = hash(i + 1, j + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, salt, octaves = 4) {
  let s = 0, amp = .5, f = 1, n = 0;
  for (let k = 0; k < octaves; k++) { s += amp * vnoise(x * f + k * 17.3, z * f - k * 9.1, salt + k); n += amp; amp *= .5; f *= 2.03; }
  return s / n;
}

// Where the woods are. forest() is a smooth field; ground is wooded where it passes the threshold for its distance
// out: a few groves near the city, more woods past the parkway, a dense tree belt in the first hills, open ridges beyond.
const forest = (x, z) => fbm(x / 430, z / 430, 21) * .78 + vnoise(x / 95, z / 95, 29) * .22;
function woodsThreshold(d, ext) {
  const belt = smoothstep(ext + 1150, ext + 1450, d) * (1 - smoothstep(ext + 2000, ext + 2400, d));
  return .66 - .14 * smoothstep(ext + 200, ext + 900, d) - .16 * belt + .05 * smoothstep(ext + 2600, ext + 3400, d);
}

const HIGHWAY = new Set(['trunk', 'primary', 'secondary']);
const WALK = new Set(['footway', 'path', 'cycleway', 'track', 'pedestrian']);
const RANK = { trunk: 0, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 5, living_street: 6, service: 9 };
const SIDEWALK = 2.2;
// Sites off the parkway, in the order they are placed, grouped into districts: an energy district (hub and solar
// field), a research park (campus, with a pond beside it), village farms (a hamlet next to greenhouses), and so on.
// a: the preferred direction from the centre (radians from east toward south); each slides along the parkway until
// it finds clear ground. w runs along the parkway, d away from it.
const SITE_PLAN = [
  { kind: 'energy', a: .3, w: 150, d: 110 },
  { kind: 'solar', a: .85, w: 170, d: 96 },
  { kind: 'campus', a: 1.75, w: 180, d: 130 },
  { kind: 'hamlet', a: 2.5, w: 96, d: 175 },
  { kind: 'greenhouse', a: 2.95, w: 150, d: 104 },
  { kind: 'solar', a: 3.75, w: 140, d: 90 },
  { kind: 'hamlet', a: 4.35, w: 96, d: 175 },
  { kind: 'greenhouse', a: 4.8, w: 130, d: 96 },
  { kind: 'campus', a: 5.45, w: 150, d: 124 },
  { kind: 'hamlet', a: 6.05, w: 96, d: 175 },
];
const PATH_ON_WATER = 9; // a trail keeps this far from a stream's centre, and its footbridges span twice this

// =====================================================================================================================
// Plan: roads, sites and hamlets, as data for the street and building builders.
// =====================================================================================================================
export function planOutskirts({ osm, grid, roads }) {
  const ext = osm.ext, N = 800, RING_W = ROAD_W.secondary, EDGE = RING_W / 2 + SIDEWALK; // parkway centre to sidewalk edge
  const BLOCKED = OCC.building | OCC.road | OCC.sidewalk | OCC.lot | OCC.water | OCC.zone; // sim parcels too: the zone layer builds on them
  const og = new Grid(ext + 700, 2); // what the plan has claimed so far, before any of it is built
  const plan = { ext, roads: [], areas: [], houses: [], sites: [], stops: [], bridges: [], discs: [], rects: [], ponds: [], streams: [], plazas: [], ends: { connected: 0, highways: 0, paths: 0, closed: 0 } };
  const addRoad = (cls, pts, ow = 0) => { plan.roads.push([cls, ow, pts]); og.fillLine(pts, (ROAD_W[cls] ?? 3) / 2 + (DRIVE.has(cls) ? SIDEWALK + 1 : 1), OCC.road); };
  const wrap = k => (k % N + N) % N;
  const addDisc = d => { plan.discs.push(d); grid.fill(d.x - d.r, d.z - d.r, d.x + d.r, d.z + d.r, OCC.road, (x, z) => Math.hypot(x - d.x, z - d.z) < d.r); };

  // ---------- the parkway ring ----------
  // A rounded square 230 m past the map edge, pushed out wherever a mapped street or building is in the way, then
  // smoothed so it bends gently around them.
  const base = new Float32Array(N), push = new Float32Array(N), dir = [];
  for (let k = 0; k < N; k++) {
    const a = k / N * TAU, c = Math.cos(a), s = Math.sin(a);
    dir.push([c, s]); base[k] = (ext + 230 + (vnoise(k / N * 9, 3.7, 301) - .5) * 80) / squareDist(c, s); // a slow wander, so it isn't a drawn square
    let p = 0;
    while (p < 140 && !grid.clear(c * (base[k] + p), s * (base[k] + p), EDGE + 4, BLOCKED)) p += 4;
    push[k] = p;
  }
  const widened = Float32Array.from(push, (_, k) => { let m = 0; for (let j = -14; j <= 14; j++) m = Math.max(m, push[wrap(k + j)]); return m; });
  const ring = [], ringD = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let s = 0; for (let j = -12; j <= 12; j++) s += widened[wrap(k + j)];
    const R = base[k] + s / 25;
    ring.push([dir[k][0] * R, dir[k][1] * R]); ringD[k] = squareDist(dir[k][0] * R, dir[k][1] * R);
  }
  const ringAt = (x, z) => wrap(Math.round(Math.atan2(z, x) / TAU * N));
  const beyond = (x, z) => squareDist(x, z) > ringD[ringAt(x, z)];
  const normalAt = k => outward(...ring[k]);
  const splits = new Set(), inserts = []; // ring vertices where a road joins, and junctions part-way along a ring segment
  const nearJunction = (k, m) => [...splits].some(s => Math.abs(wrap(s - k + N / 2) - N / 2) <= m) || inserts.some(s => Math.abs(wrap(s.k - k + N / 2) - N / 2) <= m);

  // ---------- helpers ----------
  const length = pts => { let l = 0; for (let i = 0; i + 3 < pts.length; i += 2) l += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]); return l; };
  // Samples a polyline every 2 m between skip0 metres from its start and skip1 from its end.
  function samples(pts, skip0, skip1, f) {
    const total = length(pts);
    let s0 = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], l = Math.hypot(pts[i + 2] - ax, pts[i + 3] - az);
      for (let s = 0; s < l; s += 2) {
        if (s0 + s < skip0 || s0 + s > total - skip1) continue;
        if (f(ax + (pts[i + 2] - ax) * s / l, az + (pts[i + 3] - az) * s / l) === false) return false;
      }
      s0 += l;
    }
    return true;
  }
  // A new road may not run into buildings, water, parking, or (unless crossRoads) other streets, mapped or planned.
  const clearPath = (pts, half, skip0, skip1, crossRoads = false) => samples(pts, skip0, skip1, (x, z) =>
    grid.clear(x, z, half + 1.5, OCC.building | OCC.water | OCC.lot | OCC.zone) && (crossRoads || grid.clear(x, z, half, OCC.road | OCC.sidewalk)) && og.clear(x, z, half, crossRoads ? OCC.lot : OCC.road | OCC.lot));
  // A cubic from an end, leaving along its heading, to T on the ring, arriving square to the ring.
  function curve(e, T, nT, stop = 0) {
    const L = Math.hypot(T[0] - e.x, T[1] - e.z), P3 = [T[0] - nT[0] * stop, T[1] - nT[1] * stop];
    const P1 = [e.x + e.ux * L * .45, e.z + e.uz * L * .45], P2 = [P3[0] - nT[0] * L * .4, P3[1] - nT[1] * L * .4];
    const n = Math.max(3, Math.ceil(L / 6)), pts = [e.x, e.z];
    for (let i = 1; i <= n; i++) {
      const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
      pts.push(a * e.x + b * P1[0] + c * P2[0] + d * P3[0], a * e.z + b * P1[1] + c * P2[1] + d * P3[1]);
    }
    pts[pts.length - 2] = P3[0]; pts[pts.length - 1] = P3[1];
    return pts;
  }
  // Where an end's heading first meets the ring.
  function aim(e) {
    for (let t = 4; t < 520; t += 4) if (beyond(e.x + e.ux * t, e.z + e.uz * t)) return ringAt(e.x + e.ux * t, e.z + e.uz * t);
    return -1;
  }
  function segX(ax, az, bx, bz, cx, cz, dx, dz) {
    const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
  }
  // The first crossing of a polyline with the ring: which segment of each, and the point.
  function crossRing(pts) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      if (!beyond(pts[i + 2], pts[i + 3])) continue;
      const k0 = ringAt(pts[i + 2], pts[i + 3]);
      for (let dk = -8; dk <= 8; dk++) {
        const k = wrap(k0 + dk), hit = segX(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], ...ring[k], ...ring[wrap(k + 1)]);
        if (hit) return { i, k, u: hit[1], x: pts[i] + (pts[i + 2] - pts[i]) * hit[0], z: pts[i + 1] + (pts[i + 3] - pts[i + 1]) * hit[0] };
      }
      return null;
    }
    return null;
  }
  // A one-way extension keeps the travel direction of the street it continues.
  const directed = (e, pts) => {
    if (!e.ow || e.end) return pts;
    const out = []; for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
    return out;
  };
  const closeEnd = e => { // an end that cannot connect: a turning circle for a street, a paved landing with a bench for a path
    const w = ROAD_W[e.cls] ?? 3;
    addDisc(DRIVE.has(e.cls) || e.cls === 'service' ? { x: e.x, z: e.z, r: w / 2 + (e.cls === 'service' ? 2.5 : 4.5), kind: 'asphalt', curb: e.cls !== 'service' } : { x: e.x, z: e.z, r: 3.2, kind: 'plaza', bench: true });
    plan.ends.closed++;
  };

  // ---------- clipped ends ----------
  const key = (x, z) => `${x},${z}`, degree = new Map();
  for (const q of roads) {
    const n = q.r.length / 2;
    for (let i = 0; i < n; i++) { const k = key(q.r[2 * i], q.r[2 * i + 1]); degree.set(k, (degree.get(k) ?? 0) + (i === 0 || i === n - 1 ? 1 : 2)); }
  }
  const ends = [];
  for (const q of roads) {
    const n = q.r.length / 2;
    if (n < 2 || q.cls === 'steps') continue;
    for (const end of [0, 1]) {
      const i = end ? n - 1 : 0, j = end ? n - 2 : 1, x = q.r[2 * i], z = q.r[2 * i + 1];
      if (degree.get(key(x, z)) !== 1) continue;
      const d = squareDist(x, z), drive = DRIVE.has(q.cls) || q.cls === 'service';
      // Streets past the map edge were cut by the bake. A little inside it, only ones heading firmly outward count.
      let ux = x - q.r[2 * j], uz = z - q.r[2 * j + 1]; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
      const [nx, nz] = outward(x, z), out = ux * nx + uz * nz;
      const clipped = q.cls === 'service' ? d > ext + 40 && out > .2 : drive ? (d > ext && out > .2) || (d > ext - 70 && out > .6) : d > ext - 40 && out > .3;
      if (clipped) ends.push({ cls: q.cls, ow: q.ow, x, z, ux, uz, end, d });
    }
  }
  ends.sort((a, b) => (RANK[a.cls] ?? 20) - (RANK[b.cls] ?? 20) || b.d - a.d);

  // ---------- highways: on across the ring and out into the hills ----------
  // Ends of the same class close together with similar headings are one road (a dual carriageway, say); they continue
  // side by side along one route that eases toward straight out from the city, with a slow wander.
  const highwayEnds = ends.filter(e => HIGHWAY.has(e.cls)), used = new Set();
  for (const e of highwayEnds) {
    if (used.has(e)) continue;
    const group = highwayEnds.filter(o => !used.has(o) && o.cls === e.cls && Math.hypot(o.x - e.x, o.z - e.z) < 80 && o.ux * e.ux + o.uz * e.uz > .7);
    group.forEach(o => used.add(o));
    const cx = group.reduce((s, o) => s + o.x, 0) / group.length, cz = group.reduce((s, o) => s + o.z, 0) / group.length;
    let dx = group.reduce((s, o) => s + o.ux, 0), dz = group.reduce((s, o) => s + o.uz, 0), dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
    const U = [dx, dz], route = [[cx, cz, dx, dz]], wob = hash(cx, cz, 61) * 40;
    for (let s = 0, px = cx, pz = cz; s < 9000 && squareDist(px, pz) < ext + 5400; s += 24) {
      const [nx, nz] = outward(px, pz), bend = (vnoise(s / 700, wob, 62) - .5) * .06;
      dx += (nx - dx) * .05; dz += (nz - dz) * .05;
      const c = Math.cos(bend), sn = Math.sin(bend); [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c];
      dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
      px += dx * 24; pz += dz * 24;
      route.push([px, pz, dx, dz]);
    }
    const lines = group.map(o => {
      const off = (o.x - cx) * U[1] - (o.z - cz) * U[0], pts = [o.x, o.z]; // offset to the left of travel
      for (let k = 1; k < route.length; k++) { const [px, pz, rx, rz] = route[k]; pts.push(px + rz * off, pz - rx * off); }
      return pts;
    });
    const crossings = lines.map(crossRing);
    const ok = crossings.every(Boolean) && lines.every((pts, m) => clearPath(pts.slice(0, crossings[m].i * 1 + 4), ROAD_W[e.cls] / 2, 6, 0, true));
    if (!ok) { group.forEach(o => { o.connector = true; }); continue; }
    group.forEach((o, m) => {
      const pts = lines[m], X = crossings[m];
      const inner = [...pts.slice(0, X.i + 2), X.x, X.z], outer = [X.x, X.z, ...pts.slice(X.i + 2)];
      addRoad(o.cls, directed(o, inner), o.ow); addRoad(o.cls, directed(o, outer), o.ow);
      inserts.push({ k: X.k, u: X.u, x: X.x, z: X.z });
      plan.ends.highways++;
    });
  }

  // ---------- streets: curve out to meet the ring ----------
  for (const e of ends) {
    if (WALK.has(e.cls) || (HIGHWAY.has(e.cls) && !e.connector)) continue;
    let k = aim(e);
    if (k < 0) { closeEnd(e); continue; }
    // Two streets reaching the ring close together share one junction; none lands right beside a highway's.
    const near = [...splits].find(s => Math.abs(wrap(s - k + N / 2) - N / 2) <= 4);
    if (near != null) k = near;
    else if (inserts.some(s => Math.abs(wrap(s.k - k + N / 2) - N / 2) <= 5)) { closeEnd(e); continue; }
    const w = ROAD_W[e.cls], pts = curve(e, ring[k], normalAt(k));
    if (!clearPath(pts, w / 2, w / 2 + 3, EDGE + 2)) { closeEnd(e); continue; }
    addRoad(e.cls, directed(e, pts), e.ow);
    splits.add(k);
    plan.ends.connected++;
  }

  // ---------- footpaths: on to the ring's sidewalk ----------
  const pathEnds = [];
  for (const e of ends) {
    if (!WALK.has(e.cls)) continue;
    const k = aim(e);
    if (k < 0 || nearJunction(k, 2)) { closeEnd(e); continue; }
    const pts = curve(e, ring[k], normalAt(k), EDGE - 1);
    if (!clearPath(pts, (ROAD_W[e.cls] ?? 2) / 2, 3, 3)) { closeEnd(e); continue; }
    addRoad(e.cls === 'track' ? 'path' : e.cls, pts);
    pathEnds.push(k);
    plan.ends.paths++;
  }

  // ---------- sites and hamlets ----------
  const toWorld = (s, u, v) => [s.cx + s.tx * u + s.nx * v, s.cz + s.tz * u + s.nz * v];
  const local = (s, x, z) => { const dx = x - s.cx, dz = z - s.cz; return [dx * s.tx + dz * s.tz, dx * s.nx + dz * s.nz]; };
  const inRect = (s, x, z, m = 0) => { const [u, v] = local(s, x, z); return Math.abs(u) <= s.w / 2 + m && Math.abs(v) <= s.d / 2 + m; };
  function rectFill(target, s, m, bit) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [x, z] = toWorld(s, u * (s.w / 2 + m), v * (s.d / 2 + m)); x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    target.fill(x0, z0, x1, z1, bit, (x, z) => inRect(s, x, z, m));
  }
  function rectClear(s, m) {
    for (let u = -s.w / 2 - m; u <= s.w / 2 + m; u += 5) for (let v = -s.d / 2 - m; v <= s.d / 2 + m; v += 5) {
      const [x, z] = toWorld(s, u, v);
      if (grid.at(x, z) & BLOCKED || og.at(x, z) & (OCC.road | OCC.lot)) return false;
    }
    return true;
  }
  const rectRing = (s, u0, v0, u1, v1) => { const r = []; for (const [u, v] of [[u0, v0], [u0, v1], [u1, v1], [u1, v0]]) r.push(...toWorld(s, u, v)); return r; };
  for (const def of SITE_PLAN) {
    for (let tries = 0; tries < 30; tries++) {
      const a = def.a + (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * .03, k = ringAt(Math.cos(a), Math.sin(a));
      if (nearJunction(k, 12) || pathEnds.some(p => Math.abs(wrap(p - k + N / 2) - N / 2) < 8)) continue;
      const [nx, nz] = normalAt(k), gap = EDGE + 52, R = ring[k];
      const s = { ...def, k, nx, nz, tx: -nz, tz: nx, cx: R[0] + nx * (gap + def.d / 2), cz: R[1] + nz * (gap + def.d / 2) };
      if (!rectClear(s, 14)) continue;
      // Reached by a road from the parkway: a cul-de-sac into a hamlet, a service road into a site.
      if (def.kind === 'hamlet') {
        const L = def.d - 18, bend = (hash(R[0], R[1], 70) - .5) * 40, pts = [];
        for (let t = 0; t <= L + .1; t += 10) { const b = Math.sin(t / L * Math.PI / 2) * bend; pts.push(R[0] + nx * t + s.tx * b, R[1] + nz * t + s.tz * b); }
        const [ex, ez] = [pts.at(-2), pts.at(-1)];
        addRoad('residential', pts);
        // A small plaza with a fountain beside the street at the hamlet's entrance, with a walk out to the sidewalk.
        const side = hash(R[0], R[1], 74) < .5 ? -1 : 1, [qx, qz] = [pts[4], pts[5]]; // 20 m in, ahead of the first houses
        const plaza = { x: qx + s.tx * side * 16, z: qz + s.tz * side * 16, r: 7, fountain: true, link: true };
        plan.plazas.push(plaza);
        grid.fill(plaza.x - 8, plaza.z - 8, plaza.x + 8, plaza.z + 8, OCC.keepClear, (x, z) => Math.hypot(x - plaza.x, z - plaza.z) < 8);
        og.fill(plaza.x - 8, plaza.z - 8, plaza.x + 8, plaza.z + 8, OCC.lot, (x, z) => Math.hypot(x - plaza.x, z - plaza.z) < 8);
        addRoad('footway', [qx + s.tx * side * 9, qz + s.tz * side * 9, qx + s.tx * side * 5.4, qz + s.tz * side * 5.4]);
        addDisc({ x: ex, z: ez, r: 11, kind: 'asphalt', curb: true });
        // Houses along both sides and round the turning circle, facing the street.
        const lots = [];
        for (let t = 34; t < L - 14; t += 23) for (const side of [-1, 1]) lots.push([t + (side > 0 ? 9 : 0), side * 17]);
        for (const ang of [-.9, 0, .9]) lots.push([L + Math.cos(ang) * 24, Math.sin(ang) * 24, ang]);
        for (const [t, off, ang] of lots) {
          const i = Math.min(pts.length / 2 - 2, Math.floor(t / 10)), px = pts[2 * i], pz = pts[2 * i + 1];
          const ux0 = pts[2 * i + 2] - px, uz0 = pts[2 * i + 3] - pz, ul = Math.hypot(ux0, uz0), ux = ux0 / ul, uz = uz0 / ul;
          const lx = uz, lz = -ux, along = t - i * 10;
          let cx = px + ux * along + lx * off, cz = pz + uz * along + lz * off, fx = ux, fz = uz;
          if (ang != null) { cx = ex + (Math.cos(ang) * nx - Math.sin(ang) * s.tx) * 24; cz = ez + (Math.cos(ang) * nz - Math.sin(ang) * s.tz) * 24; const rx = ex - cx, rz = ez - cz, rl = Math.hypot(rx, rz); fx = -rz / rl; fz = rx / rl; }
          const hw = 4.5 + hash(cx, cz, 71) * 1.8, hd = 4 + hash(cx, cz, 72) * 1.5;
          let corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([a, b]) => [cx + fx * a * hw + fz * b * hd, cz + fz * a * hw - fx * b * hd]);
          // Outer rings wind so (-dz, dx) points out of every wall, which is a negative signed area (see geometry.js).
          if (signedArea(corners.flat()) > 0) corners = corners.reverse();
          plan.houses.push(['house', hash(cx, cz, 73) < .45 ? 2 : 1, 0, 0, corners.flat()]);
        }
      } else {
        const entry = toWorld(s, 0, -s.d / 2 + 18);
        addRoad('service', [R[0], R[1], R[0] + nx * gap * .5, R[1] + nz * gap * .5, ...entry]);
        const lot = s.kind === 'energy' ? [4, -s.d / 2 + 5, 30, -s.d / 2 + 21] : s.kind === 'greenhouse' ? [-14, -s.d / 2 + 4, 14, -s.d / 2 + 16] : s.kind === 'campus' ? [-44, -s.d / 2 + 4, -12, -s.d / 2 + 22] : null;
        if (lot) { const [u0, v0, u1, v1] = lot; plan.areas.push(['parking', rectRing(s, u0, v0, u1, v1)]); }
        if (s.kind === 'solar') addRoad('track', [...entry, ...toWorld(s, 0, s.d / 2 - 6)]); // the maintenance aisle
        if (s.kind === 'greenhouse') {
          addRoad('footway', [...toWorld(s, -s.w / 2 + 8, -s.d / 2 + 23), ...toWorld(s, s.w / 2 - 8, -s.d / 2 + 23), ...toWorld(s, s.w / 2 - 8, -s.d / 2 + 1)]);
          s.door = toWorld(s, s.w / 2 - 8, -s.d / 2 + 1); // where the farm's path leaves for the greenway
        }
        if (s.kind === 'campus') { // the entrance walk to the courtyard, and a side walk out to the greenway
          addRoad('footway', [...entry, ...toWorld(s, 0, -s.d / 2 + 38)]);
          addRoad('footway', [...toWorld(s, 18, -s.d / 2 + 46), ...toWorld(s, s.w / 2 - 12, -s.d / 2 + 30), ...toWorld(s, s.w / 2 - 12, -s.d / 2 + 1)]);
          s.door = toWorld(s, s.w / 2 - 12, -s.d / 2 + 1);
        }
        rectFill(grid, s, 0, OCC.lot); // keeps planting and street furniture off the site
      }
      rectFill(og, s, 10, OCC.lot);
      splits.add(k);
      plan.sites.push(s);
      plan.rects.push(s);
      break;
    }
  }

  // ---------- footbridges and the greenway ----------
  // A greenway runs round outside the parkway. Up to four of the footpaths that reach the parkway cross it on arched
  // footbridges and join the greenway; the path runs on under the bridge, where the road surface covers it.
  const picked = [];
  for (const k of pathEnds.sort((a, b) => hash(...ring[a], 80) - hash(...ring[b], 80))) {
    if (picked.length >= 4 || picked.some(p => Math.abs(wrap(p - k + N / 2) - N / 2) < N / 7) || nearJunction(k, 10)) continue;
    picked.push(k);
    const [nx, nz] = normalAt(k), [x, z] = ring[k];
    plan.bridges.push({ x, z, nx, nz, tx: -nz, tz: nx, half: 34 });
    addRoad('footway', [x - nx * (EDGE - 1), z - nz * (EDGE - 1), x + nx * 40, z + nz * 40]);
    const s = { cx: x, cz: z, tx: -nz, tz: nx, nx, nz, w: 6, d: 70 };
    rectFill(grid, s, 0, OCC.keepClear);
  }

  // ---------- ponds, streams and park trails ----------
  // A pond sits in the meadow past the greenway, fed by a stream that meanders down out of the hills. A dirt trail loops
  // the pond and runs up the stream to a viewpoint near its spring, crossing the water on small arched footbridges;
  // another links the loop to the greenway. Ponds go beside the research campuses first, then wherever there is room.
  const roadSegs = [];
  for (const [cls, , r] of plan.roads) if (HIGHWAY.has(cls)) for (let i = 0; i + 3 < r.length; i += 2) roadSegs.push([r[i], r[i + 1], r[i + 2], r[i + 3]]);
  const segDist = (x, z, [ax, az, bx, bz]) => { const dx = bx - ax, dz = bz - az, t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
  // Off the plan's grid counts as empty here (Grid.clear would count it as occupied); highways are checked directly.
  const ogHit = (x, z) => { const v = og.at(x, z); return v !== 255 && v & (OCC.road | OCC.lot | OCC.water); };
  const nearRoad = (x, z, r) => {
    for (let a = 0; a < TAU; a += Math.PI / 4) for (const rr of [r / 2, r]) if (ogHit(x + Math.cos(a) * rr, z + Math.sin(a) * rr)) return true;
    return ogHit(x, z) || roadSegs.some(sg => segDist(x, z, sg) < r);
  };
  const nearSite = (x, z, m) => plan.sites.some(st => inRect(st, x, z, m));
  const nearStream = (x, z, r) => plan.streams.some(st => { for (let i = 0; i < st.pts.length; i += 2) if (Math.hypot(st.pts[i] - x, st.pts[i + 1] - z) < r) return true; return false; });
  const chaikin = pts => { const out = [pts[0], pts[1]]; for (let i = 0; i + 3 < pts.length; i += 2) out.push(.75 * pts[i] + .25 * pts[i + 2], .75 * pts[i + 1] + .25 * pts[i + 3], .25 * pts[i] + .75 * pts[i + 2], .25 * pts[i + 1] + .75 * pts[i + 3]); out.push(pts.at(-2), pts.at(-1)); return out; };
  // A stream from a pond's far shore up into the hills: it leans outward from the city and meanders about that line,
  // and stops short of any road, site or other stream (its spring).
  function streamFrom(px, pz, a0, own) {
    const pts = [px, pz], seed = hash(px, pz, 140) * 50;
    let dx = Math.cos(a0), dz = Math.sin(a0);
    for (let st = 20; st <= 1500; st += 20) {
      const [nx, nz] = outward(px, pz), turn = (vnoise(st / 240, seed, 141) - .5) * 1.5;
      let ax = nx * .6 + dx * .4, az = nz * .6 + dz * .4; const l = Math.hypot(ax, az); ax /= l; az /= l;
      dx = ax * Math.cos(turn) - az * Math.sin(turn); dz = ax * Math.sin(turn) + az * Math.cos(turn);
      const qx = px + dx * 20, qz = pz + dz * 20;
      if (squareDist(qx, qz) > ext + 1800 || (Math.hypot(qx - own.x, qz - own.z) > own.R + 30 && (nearRoad(qx, qz, 36) || nearSite(qx, qz, 40) || nearStream(qx, qz, 160)))) break;
      px = qx; pz = qz; pts.push(px, pz);
    }
    return pts.length >= 34 ? chaikin(chaikin(pts)) : null; // at least about 330 m, smoothed into curves
  }
  const arc = TAU * (ext + 300) / N, gap = (a, b) => Math.abs(wrap(a - b + N / 2) - N / 2);
  const pondAt = [...plan.sites.filter(st => st.kind === 'campus').flatMap(st => [1, -1].map(sg => wrap(st.k + sg * Math.round((st.w / 2 + 110) / arc))))];
  for (let k = 0; k < N; k += 7) pondAt.push(k);
  for (const k of pondAt) {
    if (plan.ponds.length >= 5) break;
    if (plan.ponds.some(pd => gap(pd.k, k) < N / 8) || nearJunction(k, 10) || picked.some(pk => gap(pk, k) < 12)) continue;
    const [nx, nz] = normalAt(k), [rx, rz] = ring[k], R = 28 + hash(rx, rz, 150) * 20, off = 40 + 36 + R, x = rx + nx * off, z = rz + nz * off;
    let ok = true;
    for (let a = 0; a < TAU && ok; a += .35) for (const rr of [0, R * .6, R + 24]) {
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      if (grid.at(px, pz) & BLOCKED || og.at(px, pz) & (OCC.road | OCC.lot | OCC.water)) ok = false;
    }
    if (!ok) continue;
    const ph = hash(x, z, 151) * TAU, ph2 = hash(x, z, 152) * TAU, rad = a => R * (1 + .16 * Math.sin(2 * a + ph) + .09 * Math.sin(3 * a + ph2));
    const a0 = Math.atan2(nz, nx), pond = { k, x, z, R, shape: [], bank: [] };
    for (let i = 0; i < 40; i++) { const a = i / 40 * TAU, r = rad(a); pond.shape.push(x + Math.cos(a) * r, z + Math.sin(a) * r); pond.bank.push(x + Math.cos(a) * (r + 2.6), z + Math.sin(a) * (r + 2.6)); }
    const pts = streamFrom(x + Math.cos(a0) * rad(a0) * .85, z + Math.sin(a0) * rad(a0) * .85, a0, pond);
    if (!pts) continue;
    const n = pts.length / 2, stream = { pts, w: Array.from({ length: n }, (_, i) => lerp(6, 1.6, i / (n - 1))) };
    plan.ponds.push(pond); plan.streams.push(stream);
    og.fill(x - R - 14, z - R - 14, x + R + 14, z + R + 14, OCC.water, (px, pz) => Math.hypot(px - x, pz - z) < R + 14);
    og.fillLine(pts, 14, OCC.water);
    grid.fillRing(pond.bank, OCC.water); grid.fillLine(pts, 4, OCC.water);

    // The loop trail, leaving a gap where the stream flows out, which a footbridge spans.
    const loop = [], M = 36, t0 = a0 + Math.PI;
    for (let i = 0; i <= M; i++) { const a = t0 + i / M * TAU, r = rad(a) + PATH_ON_WATER + 1; loop.push(x + Math.cos(a) * r, z + Math.sin(a) * r); }
    const iOut = M / 2, [bx0, bz0, bx1, bz1] = [loop[2 * iOut - 2], loop[2 * iOut - 1], loop[2 * iOut + 2], loop[2 * iOut + 3]];
    addRoad('path', [...loop.slice(2 * iOut + 2), ...loop.slice(2, 2 * iOut)]);
    const bridgeBetween = (ax, az, bx, bz) => { const l = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / l, uz = (bz - az) / l; plan.bridges.push({ x: (ax + bx) / 2, z: (az + bz) / 2, nx: ux, nz: uz, tx: -uz, tz: ux, half: l / 2, H: 1.4, arch: 2.4, W: 2.4, small: true }); };
    bridgeBetween(bx0, bz0, bx1, bz1);
    pond.trailhead = [loop[2 * M], loop[2 * M + 1]]; // the loop's last point, where the trail from the greenway joins it

    // The stream trail: along one bank, switching banks over a footbridge every so often, to a viewpoint by the spring.
    const normal = i => { const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1), tx = pts[2 * c] - pts[2 * a], tz = pts[2 * c + 1] - pts[2 * a + 1], l = Math.hypot(tx, tz) || 1; return [tz / l, -tx / l]; };
    let i0 = 0; while (i0 < n - 1 && Math.hypot(pts[2 * i0] - x, pts[2 * i0 + 1] - z) < rad(a0) + 26) i0++;
    const [n0x, n0z] = normal(i0);
    let side = Math.sign((bx1 - pts[2 * i0]) * n0x + (bz1 - pts[2 * i0 + 1]) * n0z) || 1, trail = [bx1, bz1];
    const off2 = PATH_ON_WATER + 2, stepEvery = 46 + Math.floor(hash(x, z, 153) * 24), iEnd = n - 8;
    for (let i = i0; i < iEnd; i++) {
      const [mx, mz] = normal(i), px = pts[2 * i], pz = pts[2 * i + 1];
      trail.push(px + mx * side * off2, pz + mz * side * off2);
      if ((i - i0) % stepEvery === stepEvery - 1 && i < iEnd - 20) { // cross: end this run at the bank, bridge, start again
        const ax = px + mx * side * PATH_ON_WATER, az = pz + mz * side * PATH_ON_WATER, bx = px - mx * side * PATH_ON_WATER, bz = pz - mz * side * PATH_ON_WATER;
        trail.push(ax, az); addRoad('path', trail);
        bridgeBetween(ax, az, bx, bz);
        side = -side; trail = [bx, bz];
      }
    }
    const [ex, ez] = [trail.at(-2), trail.at(-1)];
    if (trail.length >= 4) addRoad('path', trail);
    plan.plazas.push({ x: ex, z: ez, r: 4, bench: true, view: true });
    stream.spring = [pts.at(-2), pts.at(-1)];
  }

  // ---------- the greenway ----------
  // A multi-use path round outside the parkway, 40 m out where it can be, easing in or out round anything in the way
  // so it stays one continuous loop.
  const offs = [];
  for (let k = 0; k < N; k += 2) {
    const [nx, nz] = normalAt(k), [rx, rz] = ring[k];
    offs.push([40, 33, 47, 27, 54].find(o => og.clear(rx + nx * o, rz + nz * o, 4, OCC.lot | OCC.water) && grid.clear(rx + nx * o, rz + nz * o, 3, OCC.building | OCC.water)) ?? null);
  }
  const smooth = offs.map((o, i) => { if (o == null) return null; let sum = 0, c = 0; for (let j = -5; j <= 5; j++) { const v = offs[(i + j + offs.length) % offs.length]; if (v != null) { sum += v; c++; } } return sum / c; });
  const greenway = [];
  let run = [];
  const flush = () => { if (run.length >= 6) { addRoad('cycleway', run); for (let i = 0; i < run.length; i += 2) greenway.push([run[i], run[i + 1]]); } run = []; };
  for (let i = 0; i <= smooth.length; i++) {
    const o = smooth[i % smooth.length], k = (i % smooth.length) * 2;
    if (o == null) { flush(); continue; }
    const [nx, nz] = normalAt(k), [rx, rz] = ring[k];
    run.push(rx + nx * o, rz + nz * o);
  }
  flush();
  // Everything public links to it: campuses, farms, hamlet plazas and the pond trails, each meeting a greenway vertex.
  const nearestGreen = (x, z) => { let best = null, bd = 140; for (const g of greenway) { const d = Math.hypot(g[0] - x, g[1] - z); if (d < bd) { bd = d; best = g; } } return best; };
  const linkGreen = (x, z, cls) => { const g = nearestGreen(x, z); if (g) addRoad(cls, [x, z, g[0], g[1]]); return g; };
  for (const st of plan.sites) if (st.door) linkGreen(...st.door, 'footway');
  for (const pl of plan.plazas) if (pl.link) linkGreen(pl.x, pl.z, 'footway');
  for (const pd of plan.ponds) {
    const g = linkGreen(...pd.trailhead, 'path');
    if (g) plan.plazas.push({ x: g[0], z: g[1], r: 4.2, bench: true, bollards: true }); // a trailhead on the greenway
  }

  // ---------- transit stops ----------
  // Landscaped stops on the parkway's outer side, near where highways and hamlet roads join it.
  const stopAt = [...inserts.map(s => s.k), ...plan.sites.filter(s => s.kind === 'hamlet').map(s => s.k)];
  for (const k0 of stopAt) {
    if (plan.stops.length >= 7) break;
    for (const k of [wrap(k0 + 9), wrap(k0 - 9)]) {
      if (nearJunction(k, 4) || plan.stops.some(s => Math.abs(wrap(s.k - k + N / 2) - N / 2) < 20) || picked.some(p => Math.abs(wrap(p - k + N / 2) - N / 2) < 8)) continue;
      const [nx, nz] = normalAt(k), [x, z] = ring[k], d = EDGE + 4.6;
      const stop = { k, x: x + nx * d, z: z + nz * d, nx, nz, tx: -nz, tz: nx };
      if (!og.clear(stop.x, stop.z, 7, OCC.lot)) continue;
      plan.stops.push(stop);
      grid.fill(stop.x - 8, stop.z - 8, stop.x + 8, stop.z + 8, OCC.keepClear, (px, pz) => Math.hypot(px - stop.x, pz - stop.z) < 8);
      break;
    }
  }

  // ---------- the ring itself, split at every junction ----------
  const verts = [];
  for (let k = 0; k < N; k++) {
    verts.push({ x: ring[k][0], z: ring[k][1], split: splits.has(k) });
    for (const s of inserts.filter(s => s.k === k).sort((a, b) => a.u - b.u)) verts.push({ x: s.x, z: s.z, split: true });
  }
  const first = verts.findIndex(v => v.split);
  if (first < 0) addRoad('secondary', [...verts.flatMap(v => [v.x, v.z]), verts[0].x, verts[0].z]);
  else {
    let cur = [verts[first].x, verts[first].z];
    for (let i = 1; i <= verts.length; i++) {
      const v = verts[(first + i) % verts.length];
      cur.push(v.x, v.z);
      if (v.split) { addRoad('secondary', cur); cur = [v.x, v.z]; }
    }
  }
  plan.ring = ring;
  return plan;
}

// =====================================================================================================================
// Terrain: one height function for the ground mesh and everything placed on it.
// =====================================================================================================================
function makeTerrain(plan) {
  const { ext } = plan, M = 6800, C = 16, n = Math.ceil(2 * M / C) + 1;
  // flat: 0 where the ground must stay level (under roads and sites), 1 where hills may rise.
  // clear: metres from the nearest planned road's edge, so planting keeps off roads beyond the city grid.
  const flat = new Float32Array(n * n).fill(1), clear = new Float32Array(n * n).fill(999);
  const cell = v => (v + M) / C;
  function stamp(x0, z0, x1, z1, dist, inner, blend, half) {
    const R = inner + blend;
    const i0 = Math.max(0, Math.floor(cell(x0 - R))), i1 = Math.min(n - 1, Math.ceil(cell(x1 + R))), j0 = Math.max(0, Math.floor(cell(z0 - R))), j1 = Math.min(n - 1, Math.ceil(cell(z1 + R)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = dist(i * C - M, j * C - M), k = j * n + i, f = smoothstep(inner, inner + blend, d);
      if (f < flat[k]) flat[k] = f;
      if (half != null && d - half < clear[k]) clear[k] = d - half;
    }
  }
  for (const [cls, , r] of plan.roads) {
    const half = (ROAD_W[cls] ?? 3) / 2 + (DRIVE.has(cls) ? SIDEWALK : 0), big = HIGHWAY.has(cls);
    for (let i = 0; i + 3 < r.length; i += 2) {
      const ax = r[i], az = r[i + 1], bx = r[i + 2], bz = r[i + 3], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      // Far out the terrain mesh coarsens, so the level corridor widens to keep whole cells flat under the road.
      const grow = Math.max(0, squareDist(ax, az) - 2300) * .09;
      stamp(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (x, z) => {
        const t = clamp01(((x - ax) * dx + (z - az) * dz) / l2);
        return Math.hypot(x - ax - dx * t, z - az - dz * t);
      }, half + 5 + grow, big ? 150 : 70, half);
    }
  }
  for (const s of plan.rects) {
    const R = Math.hypot(s.w, s.d) / 2;
    stamp(s.cx - R, s.cz - R, s.cx + R, s.cz + R, (x, z) => {
      const dx = x - s.cx, dz = z - s.cz, u = Math.abs(dx * s.tx + dz * s.tz) - s.w / 2, v = Math.abs(dx * s.nx + dz * s.nz) - s.d / 2;
      return Math.hypot(Math.max(u, 0), Math.max(v, 0));
    }, 12, 80);
  }
  for (const pd of plan.ponds) stamp(pd.x - pd.R, pd.z - pd.R, pd.x + pd.R, pd.z + pd.R, (x, z) => Math.max(0, Math.hypot(x - pd.x, z - pd.z) - pd.R), 18, 100, 0);
  // Streams run in shallow valleys, wide enough on the floor for their trail.
  for (const st of plan.streams) {
    const r = st.pts;
    for (let i = 0; i + 3 < r.length; i += 2) {
      const ax = r[i], az = r[i + 1], bx = r[i + 2], bz = r[i + 3], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const grow = Math.max(0, squareDist(ax, az) - 2300) * .09, half = st.w[i / 2] / 2 + 1;
      stamp(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (x, z) => {
        const t = clamp01(((x - ax) * dx + (z - az) * dz) / l2);
        return Math.hypot(x - ax - dx * t, z - az - dz * t);
      }, PATH_ON_WATER + 14 + grow, 170, half);
    }
  }
  function sample(arr, x, z, outside) {
    const fx = cell(x), fz = cell(z), i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return outside;
    const u = fx - i, v = fz - j, k = j * n + i;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + n] * (1 - u) + arr[k + n + 1] * u) * v;
  }
  const flatAt = (x, z) => sample(flat, x, z, 1), clearAt = (x, z) => sample(clear, x, z, 999);

  // Level under the city and the parkway belt; low rolling ground beyond; then ridges, rising and layering outward.
  function heightAt(x, z) {
    const d = squareDist(x, z) + (fbm(x / 900, z / 900, 3) - .5) * 140;
    const rise = smoothstep(ext + 420, ext + 1250, d);
    if (rise <= 0) return 0;
    const n1 = fbm(x / 520, z / 520, 5), n2 = fbm(x / 1400, z / 1400, 9, 3), ridge = 1 - Math.abs(2 * n2 - 1);
    const far = smoothstep(ext + 1100, ext + 3200, d), farther = smoothstep(ext + 3000, ext + 6200, d);
    return (rise * (8 + 80 * n1 * n1) + far * (280 * ridge ** 3 + 70 * n1) + farther * 380 * ridge * ridge) * flatAt(x, z);
  }
  return { heightAt, flatAt, clearAt };
}

// Fades a Lambert material toward the horizon haze by a per-vertex aHaze amount.
function withHaze(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uHaze = { value: new THREE.Color(AERO.haze) };
    sh.vertexShader = 'attribute float aHaze;\nvarying float vHaze;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHaze = aHaze;');
    sh.fragmentShader = 'uniform vec3 uHaze;\nvarying float vHaze;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, vHaze);');
  };
  return mat;
}
// Terrain grid lines: every 20 m out to 2.4 km, then widening 7% a step out to 9.8 km.
const terrainLines = () => {
  const lines = [];
  for (let c = 0; c <= 2400; c += 20) lines.push(c);
  for (let c = 2400, s = 20; c < 9800;) { s *= 1.07; c += s; lines.push(Math.round(c)); }
  return [...lines.slice(1).reverse().map(v => -v), ...lines];
};
const hazeAt = (d, ext) => smoothstep(ext + 1400, ext + 7600, d) * .62;
// Normals are steepened this much over the true slope, so hills read from far above under the flat pixel lighting.
const RELIEF = 2.6;

// The ground as drawn: heights at the terrain grid's vertices, and groundAt(x, z), the height of the mesh's own
// triangles between them. Everything placed on the ground stands at groundAt, so nothing floats or sinks where the
// mesh's cells are coarse and the smooth height function would disagree with them.
function terrainSurface(terrain) {
  const L = terrainLines(), n = L.length, H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = terrain.heightAt(L[i], L[j]);
  const find = v => { let lo = 0, hi = n - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m] <= v) lo = m; else hi = m - 1; } return lo; };
  function groundAt(x, z) {
    const i = find(x), j = find(z), u = clamp01((x - L[i]) / (L[i + 1] - L[i])), v = clamp01((z - L[j]) / (L[j + 1] - L[j]));
    const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v); // the cell's two triangles
  }
  return { L, n, H, groundAt };
}

// The ground mesh: one grass-textured sheet out to ±9.8 km, fine near the city and coarser outward, split into tiles
// so off-screen ones are culled. Vertex colours shade it from the city's lawn to shaded forest floor and sunlit meadow;
// a per-vertex haze amount fades the far hills toward the sky.
function terrainMesh(surface, ext, grass) {
  const { L, n, H } = surface, col = new Float32Array(n * n * 3), haze = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = L[i], z = L[j], k = j * n + i, h = H[k];
    const d = squareDist(x, z), t = smoothstep(ext - 60, ext + 240, d), f = forest(x, z), thr = woodsThreshold(d, ext);
    const w = smoothstep(thr - .06, thr + .04, f) * t, m = smoothstep(.42, .22, f) * t * (1 - w), lift = Math.min(h / 160, 1) * .1;
    col[k * 3] = lerp(lerp(1, .7, w), 1.12, m) + lift * .6;
    col[k * 3 + 1] = lerp(lerp(1, .84, w), 1.06, m) + lift;
    col[k * 3 + 2] = lerp(lerp(1, .78, w), .8, m) + lift * .8;
    haze[k] = hazeAt(d, ext);
  }
  const mat = withHaze(new THREE.MeshLambertMaterial({ map: grass, vertexColors: true }));
  const group = new THREE.Group();
  group.name = 'terrain';
  // The city's own square is flat lawn: one quad, and the fine cells inside it are skipped.
  const A = Math.floor((ext - 60) / 20) * 20, inside = (i, j) => Math.abs(L[i]) <= A && Math.abs(L[i + 1]) <= A && Math.abs(L[j]) <= A && Math.abs(L[j + 1]) <= A;
  const B = 32;
  for (let bj = 0; bj < n - 1; bj += B) for (let bi = 0; bi < n - 1; bi += B) {
    const i1 = Math.min(n - 1, bi + B), j1 = Math.min(n - 1, bj + B), w = i1 - bi + 1, idx = [];
    for (let j = bj; j < j1; j++) for (let i = bi; i < i1; i++) {
      if (inside(i, j)) continue;
      const a = (j - bj) * w + (i - bi), b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    if (!idx.length) continue;
    const pos = [], nrm = [], uv = [], cc = [], hz = [];
    for (let j = bj; j <= j1; j++) for (let i = bi; i <= i1; i++) {
      const k = j * n + i, x = L[i], z = L[j];
      pos.push(x, H[k], z); uv.push(x, -z); cc.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]); hz.push(haze[k]);
      const il = Math.max(0, i - 1), ir = Math.min(n - 1, i + 1), jl = Math.max(0, j - 1), jr = Math.min(n - 1, j + 1);
      const gx = RELIEF * (H[j * n + ir] - H[j * n + il]) / (L[ir] - L[il]), gz = RELIEF * (H[jr * n + i] - H[jl * n + i]) / (L[jr] - L[jl]), l = Math.hypot(gx, 1, gz);
      nrm.push(-gx / l, 1 / l, -gz / l);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    g.setAttribute('aHaze', new THREE.Float32BufferAttribute(hz, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-A, 0, -A, -A, 0, A, A, 0, -A, A, 0, A], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([-A, A, -A, -A, A, A, A, -A], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(12).fill(1), 3));
  g.setAttribute('aHaze', new THREE.Float32BufferAttribute([0, 0, 0, 0], 1));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  const lawn = new THREE.Mesh(g, mat);
  lawn.receiveShadow = true;
  group.add(lawn);
  return group;
}

// The far woods' canopy: one surface draped 5 m over the terrain wherever the woods are, its edge cut where the woods
// field crosses its threshold (alpha test on a vertex alpha), so woods read as solid, outlined masses rather than
// thousands of overlapping discs. The texture's gaps between crowns are slightly transparent, so edges come out
// crown-shaped. At middle zooms the groves' treetops stand out of it; near the city, single trees take over.
function canopySheet(terrain, plan) {
  const { ext } = plan, L = terrainLines(), n = L.length;
  const p = new Pix(64, 64, 515), rr = (a, b) => a + p.rnd() * (b - a);
  const tones = ['#1f6e3e', '#2b8a46', '#3fa650', '#6cc95a', '#b4ec74'];
  p.rect(0, 0, 64, 64, tones[0], 190);
  for (let k = 0; k < 70; k++) {
    const cx = rr(0, 64), cy = rr(0, 64), R = rr(3, 5.6), autumn = p.rnd() < .05;
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      const d = Math.hypot(x, y) / R;
      if (d > 1) continue;
      const t = (-x - y) / R * .5 + (1 - d) * .5, edge = d > .82;
      p.wset(Math.floor(cx + x), Math.floor(cy + y), edge ? tones[0] : autumn ? (t > .45 ? '#f7c95a' : '#d98a2a') : t > .62 ? tones[4] : t > .32 ? tones[3] : t > 0 ? tones[2] : tones[1]);
    }
  }
  const tex = p.texture({ texel: 1.6 });
  const inSite = (x, z) => plan.rects.some(s => { const dx = x - s.cx, dz = z - s.cz; return Math.abs(dx * s.tx + dz * s.tz) < s.w / 2 + 10 && Math.abs(dx * s.nx + dz * s.nz) < s.d / 2 + 10; });
  const A = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = L[i], z = L[j], d = squareDist(x, z);
    if (d < ext + 600 || d > ext + 5200) continue;
    const w = forest(x, z) - woodsThreshold(d, ext);
    A[j * n + i] = clamp01(.5 + w * 9) * smoothstep(ext + 600, ext + 760, d) * smoothstep(5, 14, terrain.clearAt(x, z)) * (inSite(x, z) ? 0 : 1);
  }
  const pos = [], cc = [], uv = [], hz = [], nrm = [], idx = [], at = new Map();
  const vert = (i, j) => {
    const k = j * n + i;
    if (at.has(k)) return at.get(k);
    const x = L[i], z = L[j], h = terrain.heightAt(x, z), e = 6, gx = RELIEF * (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e), gz = RELIEF * (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e), l = Math.hypot(gx, 1, gz);
    const lift = Math.min(h / 200, 1) * .08;
    pos.push(x, h + 5, z); nrm.push(-gx / l, 1 / l, -gz / l); uv.push(x, -z); cc.push(1 + lift, 1 + lift, 1 + lift, A[k]); hz.push(hazeAt(squareDist(x, z), ext));
    at.set(k, pos.length / 3 - 1);
    return pos.length / 3 - 1;
  };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const k = j * n + i;
    if (Math.max(A[k], A[k + 1], A[k + n], A[k + n + 1]) < .5) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 4));
  g.setAttribute('aHaze', new THREE.Float32BufferAttribute(hz, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, withHaze(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: .5 })));
  mesh.receiveShadow = true;
  mesh.name = 'outskirts canopy sheet';
  return mesh;
}

// =====================================================================================================================
// Structures: pearl-white and aqua-glass architecture in the city's pixel textures.
// =====================================================================================================================
function pixTexture(seed, paint) { const p = new Pix(16, 16, seed); paint(p); return p.texture({ texel: TEXEL }); } // 3.2 m tiles, uvs in metres
function structureKit(ground) {
  const [G0, G1, G2, G3] = AERO_BUILD.glass;
  const tex = {
    pearl: pixTexture(11, p => { p.rect(0, 0, 16, 16, '#eef5f9'); for (let i = 0; i < 16; i++) { p.set(i, 15, '#cfdfea'); p.set(15, i, '#dde9f1'); } p.set(2, 2, '#ffffff'); p.set(3, 2, '#ffffff'); }),
    glass: pixTexture(12, p => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 8 === 0 || y === 15 ? '#ffffff' : (x - y + 16) % 16 < 2 && y < 9 ? G0 : y < 4 ? G1 : y < 10 ? G2 : G3);
    }),
    solar: pixTexture(13, p => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 8 === 7 || y % 8 === 7 ? '#cfe8f5' : x % 8 === 1 && y % 8 === 1 ? '#a6ecfb' : y % 8 > 3 ? '#22569e' : '#2a68b4');
    }),
    battery: pixTexture(14, p => {
      p.rect(0, 0, 16, 16, '#f2f7fa');
      p.rect(0, 3, 16, 2, '#3fb6e8'); p.rect(0, 5, 16, 1, '#bfe4f2');
      for (let y = 8; y < 14; y++) for (let x = 1; x < 15; x += 3) p.set(x, y, '#c9d8e2');
      for (let y = 0; y < 16; y++) p.set(15, y, '#cfdfea');
    }),
  };
  const phong = o => new THREE.MeshPhongMaterial({ specular: AERO.gloss, shininess: AERO.shininess, ...o });
  const flatTex = (t, k) => { const c = t.clone(); c.repeat.set(1, 1); c.needsUpdate = true; return new THREE.MeshLambertMaterial({ map: c, polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k * 2 }); };
  return {
    pearl: phong({ map: tex.pearl, vertexColors: true }),
    pearlTwoSided: phong({ map: tex.pearl, side: THREE.DoubleSide }),
    glass: phong({ map: tex.glass, specular: '#bfeaff', shininess: 70 }),
    solar: phong({ map: tex.solar, specular: '#d8f4ff', shininess: 80 }),
    battery: phong({ map: tex.battery }),
    white: phong({ color: '#f4f9fc', vertexColors: true }), // for batches, which carry colours
    whiteSolid: phong({ color: '#f4f9fc' }),               // for plain geometry, which doesn't
    pearlSolid: phong({ map: tex.pearl }),
    aqua: phong({ color: '#3fb6e8' }),
    green: new THREE.MeshLambertMaterial({ map: ground.lawn }),
    railGlass: new THREE.MeshPhongMaterial({ color: '#a6ecfb', specular: '#ffffff', shininess: 90, transparent: true, opacity: .42, depthWrite: false, side: THREE.DoubleSide }),
    asphalt: flatTex(ground.asphalt, 4), plaza: flatTex(ground.sidewalk, 2), lawnFlat: flatTex(ground.lawn, 1),
    curb: new THREE.MeshLambertMaterial({ color: '#ffffff', polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }),
    glow: new THREE.MeshBasicMaterial({ color: '#8eeaff' }), // discreet blue lighting: unlit, so it reads as light
    canopy: new THREE.MeshPhongMaterial({ color: '#c8f6ff', specular: '#ffffff', shininess: 90, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide }),
    sand: flatTex(ground.sand, 1),
  };
}
// A rounded-rectangle footprint (a stadium when r is half the depth), centred on the origin.
function rounded(w, d, r) {
  const sh = new THREE.Shape(), hw = w / 2, hd = d / 2; r = Math.min(r, hw, hd);
  sh.moveTo(-hw + r, -hd); sh.lineTo(hw - r, -hd); sh.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0);
  sh.lineTo(hw, hd - r); sh.absarc(hw - r, hd - r, r, 0, Math.PI / 2);
  sh.lineTo(-hw + r, hd); sh.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI);
  sh.lineTo(-hw, -hd + r); sh.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5);
  return sh;
}
// A footprint raised from y0 to y0 + h (uvs in metres, from the extrusion).
const prism = (shape, h, y0) => new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 7 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
// A flat disc of triangles in a batch, uvs tiling in world metres.
function fan(b, x, z, r, y, tile, seg = 28) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
    b.flat([x, z], [x + Math.cos(a0) * r, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, z + Math.sin(a1) * r], y, WHITE, (px, pz) => [px / tile, -pz / tile]);
  }
}
// A flat strip along a polyline whose width varies along it (streams and their gravel banks).
function ribbon(b, r, width, y, tile) {
  const n = r.length / 2, N = [], uv = (x, z) => [x / tile, -z / tile];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1), tx = r[2 * c] - r[2 * a], tz = r[2 * c + 1] - r[2 * a + 1], l = Math.hypot(tx, tz) || 1; N.push([tz / l, -tx / l]); }
  for (let i = 0; i < n - 1; i++) {
    const w0 = width(i) / 2, w1 = width(i + 1) / 2, ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * i + 2], bz = r[2 * i + 3];
    const A0 = [ax + N[i][0] * w0, az + N[i][1] * w0], A1 = [ax - N[i][0] * w0, az - N[i][1] * w0], B0 = [bx + N[i + 1][0] * w1, bz + N[i + 1][1] * w1], B1 = [bx - N[i + 1][0] * w1, bz - N[i + 1][1] * w1];
    b.flat(A0, B0, B1, y, WHITE, uv); b.flat(A0, B1, A1, y, WHITE, uv);
  }
}
const metres = (face, w, h) => [0, 0, w, h];
const AQUA = new THREE.Color('#3fb6e8'), SKY = new THREE.Color('#bfe4f2');

// Shared parts, built once.
function parts() {
  const blade = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-1.3, 0), new THREE.Vector2(1.5, .8), new THREE.Vector2(.55, 27), new THREE.Vector2(-.15, 30), new THREE.Vector2(-.6, 27)]), { depth: .35, bevelEnabled: false }).rotateY(Math.PI / 2);
  const tip = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(.62, 25.6), new THREE.Vector2(.55, 27), new THREE.Vector2(-.15, 30), new THREE.Vector2(-.6, 27), new THREE.Vector2(-.66, 25.6)]), { depth: .37, bevelEnabled: false }).translate(0, 0, -.01).rotateY(Math.PI / 2);
  const vault = (R, L) => {
    const g = new THREE.CylinderGeometry(R, R, L, 14, 1, true, -Math.PI / 2, Math.PI).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * R, uv.getY(i) * L);
    return g;
  };
  const cap = (R, side) => {
    const g = new THREE.CircleGeometry(R, 14, 0, Math.PI).rotateY(side * Math.PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getZ(i), p.getY(i));
    return g;
  };
  const metreUv = (g, sx, sy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); return g; };
  return {
    tower: new THREE.CylinderGeometry(1.05, 2.1, 62, 10).translate(0, 31, 0),
    band: new THREE.CylinderGeometry(2.25, 2.3, 2.4, 10).translate(0, 1.6, 0),
    nacelle: new THREE.BoxGeometry(8.5, 3.4, 3.4).translate(-1.6, 62.2, 0),
    nose: new THREE.SphereGeometry(1.5, 10, 6).scale(1.5, 1, 1),
    blade, tip, vault, cap, metreUv,
    rib: new THREE.TorusGeometry(1, .03, 4, 14, Math.PI).rotateY(Math.PI / 2),
    drum: (R, h = 6.5) => metreUv(new THREE.CylinderGeometry(R, R, h, 28, 1).translate(0, h / 2, 0), TAU * R, h),
    dome: R => metreUv(new THREE.SphereGeometry(R, 18, 8, 0, TAU, 0, Math.PI / 2), TAU * R, Math.PI * R / 2), // glass panes at their real size
    tank: new THREE.CylinderGeometry(3.2, 3.2, 11, 16).translate(0, 5.5, 0),
    tankTop: new THREE.SphereGeometry(3.2, 16, 6, 0, TAU, 0, Math.PI / 2).scale(1, .5, 1).translate(0, 11, 0),
    tankBand: new THREE.CylinderGeometry(3.28, 3.28, 1.1, 16).translate(0, 8.4, 0),
    roof: metreUv(new THREE.CylinderGeometry(7, 7, 9.4, 12, 1, true, -.42, .84).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(0, -3.4, 0), 6, 9.4), // a shallow arc, its axis along x
  };
}

function boxAt(b, s, u, v, sx, sy, sz, y0, col = WHITE, colTop = col) {
  const [x, z] = [s.cx + s.tx * u + s.nx * v, s.cz + s.tz * u + s.nz * v];
  b.box(x, z, sx, sy, sz, y0, Math.atan2(s.tz, s.tx), col, metres, colTop);
}
const place = (mesh, s, u, v, y = 0) => { mesh.position.set(s.cx + s.tx * u + s.nx * v, y, s.cz + s.tz * u + s.nz * v); mesh.rotation.y = -Math.atan2(s.tz, s.tx); return mesh; };
const shadowed = m => { m.castShadow = m.receiveShadow = true; return m; };

// A low pearl rail round a site, open at the entrance.
function fence(b, s, inset = 3) {
  const hw = s.w / 2 - inset, hd = s.d / 2 - inset;
  boxAt(b, s, 0, hd, 2 * hw, 1.3, .25, 0);
  boxAt(b, s, -hw, 0, .25, 1.3, 2 * hd, 0); boxAt(b, s, hw, 0, .25, 1.3, 2 * hd, 0);
  for (const sgn of [-1, 1]) boxAt(b, s, sgn * (hw + 9) / 2, -hd, hw - 9, 1.3, .25, 0);
  for (const u of [-hw, hw, -9, 9]) boxAt(b, s, u, -hd, .5, 1.6, .5, 0, AQUA); // gate and corner posts
}

function buildSite(s, kit, P, batches, group, beds) {
  const b = name => batches.at(`${chunkKey(s.cx, s.cz, 400)}|${name}`);
  if (s.kind === 'energy') {
    // Battery modules on a paved yard, three hydrogen tanks, and a round control hall under a glass dome.
    const pad = b('plaza'), [u0, v0, u1, v1] = [-s.w / 2 + 10, 4, s.w / 2 - 10, s.d / 2 - 8];
    const c = (u, v) => [s.cx + s.tx * u + s.nx * v, s.cz + s.tz * u + s.nz * v];
    pad.flat(c(u0, v0), c(u1, v0), c(u1, v1), .03, WHITE, (x, z) => [x / 4, -z / 4]); pad.flat(c(u0, v0), c(u1, v1), c(u0, v1), .03, WHITE, (x, z) => [x / 4, -z / 4]);
    for (const v of [16, 28]) for (let i = 0; i < 8; i++) boxAt(b('battery'), s, -s.w / 2 + 22 + i * 13, v, 10, 3, 3.2, 0);
    for (let i = 0; i < 3; i++) {
      for (const [geo, mat] of [[P.tank, kit.whiteSolid], [P.tankTop, kit.whiteSolid], [P.tankBand, kit.aqua]]) group.add(shadowed(place(new THREE.Mesh(geo, mat), s, s.w / 2 - 22, -26 + i * 11)));
    }
    group.add(shadowed(place(new THREE.Mesh(P.drum(10), kit.pearlSolid), s, -s.w / 2 + 30, -18)));
    group.add(place(new THREE.Mesh(new THREE.CylinderGeometry(10.15, 10.15, .5, 24).translate(0, 5.6, 0), kit.glow), s, -s.w / 2 + 30, -18));
    group.add(shadowed(place(new THREE.Mesh(P.dome(8.2), kit.glass), s, -s.w / 2 + 30, -18, 6.5)));
    boxAt(b('pearl'), s, -s.w / 2 + 30, -5, 6, 3, 4, 0); // entrance porch
    fence(b('pearl'), s);
    for (let u = -s.w / 2 + 12; u < s.w / 2 - 10; u += 9) beds.push({ u, v: -s.d / 2 + 1.5, s, kind: 'hedge' });
  } else if (s.kind === 'solar') {
    // Panel tables in east-west rows facing south, whatever the site's angle, with a central maintenance aisle.
    const tables = [], R = Math.hypot(s.w, s.d) / 2;
    for (let z = s.cz - R; z < s.cz + R; z += 6.4) for (let x = s.cx - R; x < s.cx + R; x += 11.5) {
      const ok = [[-5, -1.4], [5, -1.4], [5, 1.4], [-5, 1.4]].every(([dx, dz]) => {
        const lx = x + dx - s.cx, lz = z + dz - s.cz, u = lx * s.tx + lz * s.tz, v = lx * s.nx + lz * s.nz;
        return Math.abs(u) < s.w / 2 - 8 && Math.abs(v) < s.d / 2 - 8 && Math.abs(u) > 4 && v > -s.d / 2 + 16;
      });
      if (ok) tables.push([x, z]);
    }
    const panel = P.metreUv(new THREE.BoxGeometry(10, .16, 2.6), 10, 2.6).rotateX(.44).translate(0, 1.5, 0);
    const leg = new THREE.BoxGeometry(.3, 1.3, .3).translate(0, .65, .4);
    const panels = new THREE.InstancedMesh(panel, kit.solar, tables.length), legs = new THREE.InstancedMesh(leg, kit.whiteSolid, tables.length * 2);
    const m4 = new THREE.Matrix4();
    tables.forEach(([x, z], i) => { panels.setMatrixAt(i, m4.makeTranslation(x, 0, z)); legs.setMatrixAt(2 * i, m4.makeTranslation(x - 3.5, 0, z)); legs.setMatrixAt(2 * i + 1, m4.makeTranslation(x + 3.5, 0, z)); });
    for (const m of [panels, legs]) { m.computeBoundingSphere(); group.add(shadowed(m)); }
    boxAt(b('pearl'), s, 9, -s.d / 2 + 11, 5, 3, 3.4, 0, WHITE, SKY); // inverter kiosk
    boxAt(b('pearl'), s, 9, -s.d / 2 + 11, 5.1, .5, 3.5, 2.3, AQUA);
    fence(b('pearl'), s);
  } else if (s.kind === 'greenhouse') {
    // Glass barrel vaults on pearl plinths, a visitor pavilion with a garden roof, flower beds along the front path.
    const count = Math.min(5, Math.floor((s.w - 24) / 22)), R = 6.5, L = s.d - 38, vc = (-s.d / 2 + 30 + s.d / 2 - 8) / 2;
    const vault = P.vault(R, L), caps = [P.cap(R, 1), P.cap(R, -1)];
    const ribs = new THREE.InstancedMesh(P.rib, kit.whiteSolid, count * (Math.floor(L / 4) + 1));
    let ri = 0;
    for (let i = 0; i < count; i++) {
      const u = (i - (count - 1) / 2) * 22;
      boxAt(b('pearl'), s, u, vc, 2 * R + .6, .9, L + .6, 0, WHITE, SKY);
      boxAt(b('white'), s, u, vc, 1.2, .5, L, .9 + R - .1); // ridge vent
      const gh = new THREE.Group();
      // The vault's axis runs away from the parkway: turn it a quarter so its length lies along the site's depth.
      const inner = new THREE.Group(); inner.rotation.y = -Math.PI / 2;
      inner.add(shadowed(new THREE.Mesh(vault, kit.glass)));
      for (const [k, cap] of caps.entries()) { const m = shadowed(new THREE.Mesh(cap, kit.glass)); m.position.x = (k ? -1 : 1) * L / 2; inner.add(m); }
      gh.add(inner);
      group.add(place(gh, s, u, vc, .9));
      gh.updateMatrixWorld(true);
      for (let t = -L / 2; t <= L / 2 + .01; t += 4) { // pearl ribs every 4 m
        const rib = new THREE.Matrix4().compose(new THREE.Vector3(t, 0, 0), new THREE.Quaternion(), new THREE.Vector3(R + .08, R + .08, R + .08));
        ribs.setMatrixAt(ri++, rib.premultiply(inner.matrixWorld));
      }
      beds.push({ u: u - R - 1.5, v: -s.d / 2 + 26, s, kind: 'flowers' }, { u: u + R + 1.5, v: -s.d / 2 + 26, s, kind: 'flowers' });
    }
    ribs.count = ri; ribs.computeBoundingSphere(); group.add(ribs);
    const pu = s.w / 2 - 16, pv = -s.d / 2 + 11;
    boxAt(b('pearl'), s, pu, pv, 18, 5, 12, 0, WHITE, SKY);
    boxAt(b('glass'), s, pu, pv, 18.2, 1.8, 12.2, 1.6);
    boxAt(b('green'), s, pu, pv, 18.6, .5, 12.6, 5);
    for (let u = -s.w / 2 + 12; u < s.w / 2 - 30; u += 7) beds.push({ u, v: -s.d / 2 + 20.5, s, kind: 'topiary' });
  } else if (s.kind === 'campus') {
    // A research campus: rounded pearl wings with glass bands, planted roofs and a blue glow at their feet, round a
    // paved courtyard whose glass-domed atrium looks over a reflecting pool. The entrance walk runs under a glass canopy.
    const cv = -s.d / 2 + 62, wingU = s.w / 2 - 28, wingL = Math.min(44, s.w / 2 - 32), labL = Math.min(72, s.w - 64);
    const wing = (u, v, w, d, h) => {
      for (const [shape, height, y0, mat, cast] of [
        [rounded(w, d, d / 2), h, 0, kit.pearlSolid, true],
        [rounded(w + .3, d + .3, d / 2 + .15), 2.4, h * .4, kit.glass, true],
        [rounded(w - 1.6, d - 1.6, d / 2 - .8), .5, h, kit.green, false],
        [rounded(w + .5, d + .5, d / 2 + .25), .22, .06, kit.glow, false],
      ]) { const m = place(new THREE.Mesh(prism(shape, height, y0), mat), s, u, v); m.receiveShadow = true; m.castShadow = cast; group.add(m); }
      beds.push({ u: u + (u < 0 ? w / 2 + 3 : -w / 2 - 3), v: v - d / 2 - 2, s, kind: 'topiary' });
    };
    wing(-wingU, cv + 4, wingL, 16, 9); wing(wingU, cv + 4, wingL, 16, 11); wing(0, s.d / 2 - 18, labL, 18, 7);
    fan(b('plaza'), ...toWorldS(s, 0, cv), 25, .04, 4);
    group.add(shadowed(place(new THREE.Mesh(P.drum(11, 4.5), kit.pearlSolid), s, 0, cv)));
    group.add(shadowed(place(new THREE.Mesh(P.dome(10.4), kit.glass), s, 0, cv, 4.5)));
    group.add(place(new THREE.Mesh(new THREE.CylinderGeometry(11.12, 11.12, .24, 28).translate(0, .16, 0), kit.glow), s, 0, cv));
    // The reflecting pool in front of the atrium, in a pearl rim.
    boxAt(b('pearl'), s, 0, cv - 18, 22, .32, 8, 0, WHITE, SKY);
    const pw = b('water'), c = (u, v) => toWorldS(s, u, v);
    pw.flat(c(-10.2, cv - 21.2), c(10.2, cv - 21.2), c(10.2, cv - 14.8), .34, WHITE, (x, z) => [x / 12, -z / 12]);
    pw.flat(c(-10.2, cv - 21.2), c(10.2, cv - 14.8), c(-10.2, cv - 14.8), .34, WHITE, (x, z) => [x / 12, -z / 12]);
    // A translucent canopy over the entrance walk, on slim pearl posts.
    const canopy = place(new THREE.Mesh(P.roof, kit.canopy), s, 0, -s.d / 2 + 27); canopy.rotation.y += Math.PI / 2; group.add(canopy);
    for (const u of [-2.9, 2.9]) {
      boxAt(b('white'), s, u, -s.d / 2 + 27, .2, .2, 9.6, 2.92);
      for (const dv of [-4.4, 4.4]) boxAt(b('white'), s, u, -s.d / 2 + 27 + dv, .22, 2.95, .22, 0);
    }
    for (let v = -s.d / 2 + 19; v < -s.d / 2 + 37; v += 4.5) for (const u of [-2.4, 2.4]) beds.push({ u, v, s, kind: 'bollard' });
    for (let i = 0; i < 12; i++) { // trees round the courtyard, except where the wings stand
      const a = i / 12 * TAU;
      if (Math.abs(Math.cos(a)) <= .75) beds.push({ u: Math.cos(a) * 28, v: cv + Math.sin(a) * 28, s, kind: 'tree' });
    }
  }
}
const toWorldS = (s, u, v) => [s.cx + s.tx * u + s.nx * v, s.cz + s.tz * u + s.nz * v];

// A wind turbine: tapered pearl tower with an aqua foot, nacelle and three blades with aqua tips.
function turbine(P, kit, x, y, z, yaw) {
  const t = new THREE.Group(), rotor = new THREE.Group();
  t.position.set(x, y - 1, z); t.rotation.y = yaw;
  t.add(shadowed(new THREE.Mesh(P.tower, kit.whiteSolid)), shadowed(new THREE.Mesh(P.band, kit.aqua)), shadowed(new THREE.Mesh(P.nacelle, kit.whiteSolid)));
  rotor.position.set(3.4, 62.2, 0);
  const nose = shadowed(new THREE.Mesh(P.nose, kit.whiteSolid)); nose.position.x = .8; rotor.add(nose);
  for (let k = 0; k < 3; k++) {
    const arm = new THREE.Group(); arm.rotation.x = k * TAU / 3;
    arm.add(shadowed(new THREE.Mesh(P.blade, kit.whiteSolid)), shadowed(new THREE.Mesh(P.tip, kit.aqua)));
    rotor.add(arm);
  }
  rotor.rotation.x = hash(x, z, 90) * TAU;
  t.add(rotor);
  return { group: t, rotor, speed: .5 + hash(x, z, 91) * .16 };
}

// A landscaped transit stop: a paved apron, a curved translucent canopy on pearl ribs over a glass screen, and a route
// pylon with a glowing cap.
function transitStop(st, kit, P, batches, group, props) {
  const s = { cx: st.x, cz: st.z, tx: st.tx, tz: st.tz, nx: st.nx, nz: st.nz };
  const b = name => batches.at(`${chunkKey(st.x, st.z, 400)}|${name}`);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(7.5, 20).rotateX(-Math.PI / 2), kit.plaza);
  { const uv = disc.geometry.attributes.uv, p = disc.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + st.x) / 4, -(p.getZ(i) + st.z) / 4); }
  disc.position.set(st.x, .045, st.z); disc.receiveShadow = true; group.add(disc);
  group.add(place(new THREE.Mesh(P.roof, kit.canopy), s, 0, 1.2, 0));
  for (const v of [1.2 - 2.85, 1.2 + 2.85]) boxAt(b('white'), s, 0, v, 9.6, .18, .18, 2.92);
  boxAt(b('white'), s, 0, 1.2, 9.6, .14, .3, 3.55);
  for (const u of [-4.6, 0, 4.6]) boxAt(b('white'), s, u, 1.2, .14, .12, 5.8, 3.3); // ribs across the canopy
  for (const u of [-4, 4]) boxAt(b('white'), s, u, 2.4, .25, 3.5, .25, 0);
  boxAt(b('glass'), s, 0, 2.6, 8.4, 2.3, .14, .3);
  boxAt(b('pearl'), s, 6, 2, .6, 4.6, .6, 0); boxAt(b('glow'), s, 6, 2, .7, .6, .7, 4.6); // route pylon
  const at = (u, v) => [st.x + st.tx * u + st.nx * v, st.z + st.tz * u + st.nz * v];
  for (const [u, v, name] of [[0, 1.8, 'bench'], [-6.2, .5, 'topiary'], [6.4, -1, 'planter'], [-6.4, 3.2, 'shrubPink'], [-3, 5.4, 'daisyBlue'], [2.5, 5.6, 'daisyWhite'], [-5, -2.6, 'bollard'], [5, -2.6, 'bollard']]) {
    const [x, z] = at(u, v); props.push({ x, z, name });
  }
}

// An arched footbridge: a curved pearl deck with glass railings and twin bowstring arches. Over the parkway it climbs
// 6 m; over a stream (br.small) it is a low, short hop with a lighter arch.
function footbridge(br, kit, group) {
  const b = new Batches(), H = br.H ?? 6.2, half = br.half, W = br.W ?? 3.2;
  const y = s => H * .5 * (1 + Math.cos(Math.PI * s / half)), steps = br.small ? 12 : 28;
  const P = (s, o, h) => [br.x + br.nx * s + br.tx * o, h, br.z + br.nz * s + br.tz * o];
  const deck = b.get('pearl'), white = b.get('white'), glass = b.get('glass');
  for (let i = 0; i < steps; i++) {
    const s0 = -half + 2 * half * i / steps, s1 = -half + 2 * half * (i + 1) / steps, y0 = y(s0), y1 = y(s1), l = s1 - s0;
    deck.quad([P(s0, -W / 2, y0 + .45), P(s0, W / 2, y0 + .45), P(s1, W / 2, y1 + .45), P(s1, -W / 2, y1 + .45)], [0, 1, 0], [0, s0, W, s0, W, s1, 0, s1], WHITE);
    for (const o of [-W / 2, W / 2]) {
      const sgn = Math.sign(o);
      white.quad([P(s0, o, y0 - .25), P(s1, o, y1 - .25), P(s1, o, y1 + .45), P(s0, o, y0 + .45)], [br.tx * sgn, 0, br.tz * sgn], [0, 0, l, 0, l, .7, 0, .7], AQUA, WHITE);
      glass.quad([P(s0, o, y0 + .45), P(s1, o, y1 + .45), P(s1, o, y1 + 1.5), P(s0, o, y0 + 1.5)], [br.tx * sgn, 0, br.tz * sgn], [0, 0, l, 0, l, 1, 0, 1], WHITE);
      white.quad([P(s0, o, y0 + 1.5), P(s1, o, y1 + 1.5), P(s1, o, y1 + 1.62), P(s0, o, y0 + 1.62)], [br.tx * sgn, 0, br.tz * sgn], [0, 0, l, 0, l, .1, 0, .1], WHITE);
    }
    deck.quad([P(s1, -W / 2, y1 - .25), P(s1, W / 2, y1 - .25), P(s0, W / 2, y0 - .25), P(s0, -W / 2, y0 - .25)], [0, -1, 0], [0, 0, W, 0, W, l, 0, l], SKY);
  }
  // Bowstring arches springing from the deck either side of the road, with slim hangers.
  const span = half * (br.small ? .78 : .5), top = H + (br.arch ?? 8), archY = s => y(s) + .45 + (top - H) * Math.max(0, 1 - (s / span) ** 2), segs = br.small ? 8 : 16;
  for (const o of [-W / 2 - .15, W / 2 + .15]) {
    for (let i = 0; i < segs; i++) {
      const s0 = -span + 2 * span * i / segs, s1 = -span + 2 * span * (i + 1) / segs;
      const a0 = archY(s0), a1 = archY(s1), mid = P((s0 + s1) / 2, o, (a0 + a1) / 2), l = Math.hypot(s1 - s0, a1 - a0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(br.small ? .3 : .45, br.small ? .35 : .55, l + .05), kit.whiteSolid);
      m.position.set(...mid);
      m.lookAt(...P(s1, o, a1));
      group.add(shadowed(m));
    }
    for (let s = -span + (br.small ? 2 : 3); s < span - 1.5; s += br.small ? 2 : 3) white.box(...P(s, o, 0).filter((_, i) => i !== 1), .14, archY(s) - y(s) - .45, .14, y(s) + .45, 0, WHITE, metres);
  }
  const group2 = new THREE.Group();
  for (const [name, bt] of b.map) if (!bt.empty) group2.add(shadowed(new THREE.Mesh(bt.build(), name === 'glass' ? kit.railGlass : kit[name])));
  group.add(group2);
}

// =====================================================================================================================
// Build: terrain, structures, turbines and planting.
// =====================================================================================================================
export function buildOutskirts({ plan, scene, sprites, art, ground, grid, streetTrees = [], furniture = [] }) {
  const { ext } = plan, group = new THREE.Group();
  group.name = 'outskirts';
  const terrain = makeTerrain(plan), { clearAt } = terrain, surface = terrainSurface(terrain), { groundAt } = surface;
  group.add(terrainMesh(surface, ext, ground.grass));
  group.add(sprites.lod(canopySheet(terrain, plan), { maxZoom: LOD.furniture }));

  // ---------- structures ----------
  const kit = structureKit(ground), P = parts(), batches = new Batches(), beds = [], props = [];
  // ---------- water: ponds, streams, fountains and pools, rippling on the sim clock ----------
  const frames = waterFrames().map(f => { const t = f.clone(); t.repeat.set(1, 1); t.needsUpdate = true; return t; });
  kit.water = new THREE.MeshPhongMaterial({ map: frames[0], specular: '#ffffff', shininess: 90, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -3 });
  for (const pd of plan.ponds) {
    const bk = batches.at(`${chunkKey(pd.x, pd.z, 400)}|sand`), wt = batches.at(`${chunkKey(pd.x, pd.z, 400)}|water`);
    for (const [a, b2, c] of triangulate([pd.bank])) bk.flat(a, b2, c, .02, WHITE, (x, z) => [x / 6.4, -z / 6.4]);
    for (const [a, b2, c] of triangulate([pd.shape])) wt.flat(a, b2, c, .03, WHITE, (x, z) => [x / 12, -z / 12]);
  }
  for (const st of plan.streams) {
    const key = chunkKey(st.pts[0], st.pts[1], 400);
    ribbon(batches.at(`${key}|sand`), st.pts, i => st.w[i] + 2.6, .02, 6.4);
    ribbon(batches.at(`${key}|water`), st.pts, i => st.w[i], .03, 12);
  }
  // Plazas: paved discs; hamlet plazas get a fountain, trailheads and viewpoints a bench and blue bollards.
  for (const pl of plan.plazas) {
    const key = chunkKey(pl.x, pl.z, 400);
    fan(batches.at(`${key}|plaza`), pl.x, pl.z, pl.r, .045, 4);
    if (pl.fountain) {
      const at = (m, y = 0) => { m.position.set(pl.x, y, pl.z); return m; };
      group.add(shadowed(at(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, .7, 28), kit.pearlSolid), .35)));
      group.add(at(new THREE.Mesh(new THREE.RingGeometry(2.7, 3.2, 28).rotateX(-Math.PI / 2), kit.pearlSolid), .712));
      fan(batches.at(`${key}|water`), pl.x, pl.z, 2.72, .705, 12, 20);
      group.add(shadowed(at(new THREE.Mesh(new THREE.CylinderGeometry(.5, .62, 1.1, 14), kit.pearlSolid), 1.25)));
      group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(.16, .34, 2, 10), kit.canopy), 2.8));
      group.add(at(new THREE.Mesh(new THREE.SphereGeometry(.36, 10, 6), kit.glow), 3.85));
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + .4; props.push({ x: pl.x + Math.cos(a) * 5.4, z: pl.z + Math.sin(a) * 5.4, name: i % 2 ? 'bench' : 'topiary' }); }
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; props.push({ x: pl.x + Math.cos(a) * (pl.r - .4), z: pl.z + Math.sin(a) * (pl.r - .4), name: 'bollard' }); }
    } else {
      props.push({ x: pl.x + 1.2, z: pl.z + .4, name: 'bench' }, { x: pl.x - 2.2, z: pl.z - 1, name: pl.view ? 'rock' : 'topiary' });
      if (pl.bollards || pl.view) for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + .8; props.push({ x: pl.x + Math.cos(a) * (pl.r - .3), z: pl.z + Math.sin(a) * (pl.r - .3), name: 'bollard' }); }
    }
  }
  for (const s of plan.sites) buildSite(s, kit, P, batches, group, beds);
  for (const st of plan.stops) transitStop(st, kit, P, batches, group, props);
  for (const br of plan.bridges) footbridge(br, kit, group);
  for (const d of plan.discs) {
    const g = new THREE.CircleGeometry(d.r, 24).rotateX(-Math.PI / 2), uv = g.attributes.uv, p = g.attributes.position, T = d.kind === 'asphalt' ? 12.8 : 4;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + d.x) / T, -(p.getZ(i) + d.z) / T);
    const m = new THREE.Mesh(g, d.kind === 'asphalt' ? kit.asphalt : kit.plaza);
    m.position.set(d.x, d.kind === 'asphalt' ? .06 : .05, d.z); m.receiveShadow = true; group.add(m);
    if (d.curb) { const c = new THREE.Mesh(new THREE.RingGeometry(d.r - .25, d.r, 32).rotateX(-Math.PI / 2), kit.curb); c.position.set(d.x, .066, d.z); group.add(c); }
    if (d.bench) props.push({ x: d.x + 1.2, z: d.z + .6, name: 'bench' }, { x: d.x - 1.6, z: d.z - 1, name: 'shrub' });
  }
  for (const [key, b] of batches.map) {
    if (b.empty) continue;
    const name = key.split('|')[1], m = new THREE.Mesh(b.build(), kit[name]);
    if (!['plaza', 'water', 'sand', 'glow'].includes(name)) m.castShadow = true; // flat and lit things cast none
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------- wind turbines ----------
  // Small clusters on high ground: on the rise behind the energy hub and the solar fields, and on a few far ridges.
  // Each cluster takes the highest of a scatter of candidate spots, at least 170 m apart, so the groups follow the
  // land rather than standing in rows. All face one wind (from the south-east: rotors face the opening view).
  const yaw = -.62, turbines = [], farm = new THREE.Group(), clusters = [];
  for (const st of plan.sites) if (st.kind === 'energy' || st.kind === 'solar') {
    const out = st.d / 2 + (st.kind === 'energy' ? 240 : 640);
    clusters.push([st.cx + st.nx * out, st.cz + st.nz * out, st.kind === 'energy' ? 3 : 4, st.kind === 'energy' ? 210 : 380]);
  }
  for (const a of [1.35, 2.7, 4.6, 5.9]) { const c = Math.cos(a), sn = Math.sin(a), R = (ext + 2350) / squareDist(c, sn); clusters.push([c * R, sn * R, 5, 560]); }
  const inRect = (x, z, m) => plan.rects.some(st => { const dx = x - st.cx, dz = z - st.cz; return Math.abs(dx * st.tx + dz * st.tz) < st.w / 2 + m && Math.abs(dx * st.nx + dz * st.nz) < st.d / 2 + m; });
  for (const [cx, cz, count, rad] of clusters) {
    const cand = [];
    for (let i = 0; i < 80; i++) {
      const a = hash(cx, i, 94) * TAU, rr = Math.sqrt(hash(cz, i, 95)) * rad, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      if (terrain.flatAt(x, z) < .97 || clearAt(x, z) < 40 || inRect(x, z, 60)) continue;
      cand.push([groundAt(x, z) + hash(x, z, 96) * 10, x, z]);
    }
    cand.sort((p, q) => q[0] - p[0]);
    let placed = 0;
    for (const [, x, z] of cand) {
      if (placed >= count) break;
      if (turbines.some(t => Math.hypot(t.group.position.x - x, t.group.position.z - z) < 170)) continue;
      const t = turbine(P, kit, x, groundAt(x, z), z, yaw + (hash(x, z, 93) - .5) * .08);
      t.group.scale.setScalar(.88 + hash(x, z, 97) * .24);
      farm.add(t.group); turbines.push(t); placed++;
    }
  }
  group.add(sprites.lod(farm, { minZoom: .6 })); // further out a turbine is thinner than a pixel and draws as an ink line
  scene.add(group);

  // ---------- planting ----------
  // Inside the city grid, the same occupancy rules as the city's own planting; beyond it, the road clearance field.
  const BLOCK = OCC.building | OCC.road | OCC.sidewalk | OCC.keepClear | OCC.decor | OCC.water | OCC.lot | OCC.zone;
  const inGrid = (x, z) => grid.idx(x, z) >= 0;
  const open = (x, z, r) => (inGrid(x, z) ? grid.clear(x, z, r, BLOCK) : clearAt(x, z) > r + 4) && !turbines.some(t => Math.hypot(t.group.position.x - x, t.group.position.z - z) < 22);
  const claim = (x, z, r) => { if (inGrid(x, z)) grid.fill(x - r * .7, z - r * .7, x + r * .7, z + r * .7, OCC.decor); };
  const trees = [], groves = [[], [], []], shrubs = [], flowers = [];
  const woodsAt = (x, z, d) => forest(x, z) - woodsThreshold(d, ext);
  // Single trees from just inside the map edge to 720 m out: woods, wood-edge shrubs, lone meadow trees and flowers.
  const span = ext + 760;
  for (let x = -span; x < span; x += 7.5) for (let z = -span; z < span; z += 7.5) {
    const px = x + hash(x, z, 100) * 7.5, pz = z + hash(x, z, 101) * 7.5, d = squareDist(px, pz);
    if (d < ext - 40 || d > ext + 720) continue;
    const w = woodsAt(px, pz, d), roll = hash(px, pz, 102), y = groundAt(px, pz) - .15;
    if (w > 0) {
      if (roll < .88 && open(px, pz, 2)) { trees.push({ x: px, y, z: pz, name: pickBy(TREE_KINDS.wood, hash(px, pz, 103)), scale: .85 + hash(px, pz, 104) * .4 }); claim(px, pz, 2); }
    } else if (w > -.05) {
      if (roll < .4 && open(px, pz, 1)) { shrubs.push({ x: px, y, z: pz, name: pickBy(['shrub', 'shrubWide', 'fern', 'boxwood'], hash(px, pz, 105)) }); claim(px, pz, 1); }
    } else if (roll < (vnoise(px / 90, pz / 90, 130) > .8 ? .2 : .002) && open(px, pz, 2.5)) { // lone trees, mostly in a few clumps
      trees.push({ x: px, y, z: pz, name: pickBy(TREE_KINDS.park, hash(px, pz, 106)), scale: .9 + hash(px, pz, 107) * .35 }); claim(px, pz, 2.5);
    } else if (roll > .975 && d < ext + 450 && vnoise(px / 40, pz / 40, 131) > .6 && open(px, pz, 1)) { // wildflower drifts
      (roll > .992 ? shrubs : flowers).push({ x: px, y, z: pz, name: roll > .992 ? pickBy(['rock', 'shrubYellow', 'shrubPink'], hash(px, pz, 108)) : pickBy(FLOWERS, hash(px, pz, 109)) }); claim(px, pz, 1);
    }
  }
  for (const t of streetTrees) trees.push({ x: t.x, z: t.z, name: pickBy(TREE_KINDS[t.kind], hash(t.x, t.z, 1)), scale: .85 + hash(t.x, t.z, 2) * .3 });
  // The parkway is tree-lined: a row along each verge, broken wherever a junction, stop, bridge or lamp needs the room.
  for (const [rx, rz] of plan.ring) {
    const [nx, nz] = outward(rx, rz);
    for (const side of [-1, 1]) {
      const off = ROAD_W.secondary / 2 + SIDEWALK + 3.4, x = rx + nx * side * off, z = rz + nz * side * off;
      if (hash(x, z, 160) < .22 || !open(x, z, 2.6)) continue;
      trees.push({ x, y: groundAt(x, z) - .1, z, name: pickBy(TREE_KINDS.street, hash(x, z, 161)), scale: .9 + hash(x, z, 162) * .25 }); claim(x, z, 2.6);
    }
  }
  // Water's edge: reeds round the ponds and along the streams, lily pads on the ponds, ferns and rocks at each spring.
  const lilies = [];
  for (const pd of plan.ponds) {
    for (let i = 0; i < pd.bank.length; i += 2) {
      const x = pd.bank[i], z = pd.bank[i + 1];
      if (hash(x, z, 170) < .55) shrubs.push({ x, z, name: 'reeds', scale: .9 + hash(x, z, 171) * .4 });
    }
    for (let i = 0; i < 9; i++) { const a = hash(pd.x, i, 172) * TAU, r = pd.R * (.35 + hash(pd.z, i, 173) * .4); lilies.push({ x: pd.x + Math.cos(a) * r, y: .05, z: pd.z + Math.sin(a) * r, name: 'lily', phase: a }); }
  }
  for (const st of plan.streams) {
    for (let i = 4; i < st.pts.length / 2 - 2; i += 3) {
      const x = st.pts[2 * i], z = st.pts[2 * i + 1], tx = st.pts[2 * i + 2] - x, tz = st.pts[2 * i + 3] - z, l = Math.hypot(tx, tz) || 1, sd = hash(x, z, 174) < .5 ? 1 : -1, o = st.w[i] / 2 + 1.1;
      if (hash(x, z, 175) < .45) shrubs.push({ x: x + tz / l * sd * o, z: z - tx / l * sd * o, name: hash(x, z, 176) < .7 ? 'reeds' : 'rock' });
    }
    const [sx, sz] = st.spring;
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, r = 2 + hash(sx, i, 177) * 2.5; shrubs.push({ x: sx + Math.cos(a) * r, z: sz + Math.sin(a) * r, name: i % 2 ? 'rock' : 'fern' }); }
  }
  // Groves for the woods further out, past 620 m (at far zoom the canopy sheet stands in for them).
  const far = ext + 3400;
  for (let x = -far; x < far; x += 25) for (let z = -far; z < far; z += 25) {
    const px = x + hash(x, z, 110) * 25, pz = z + hash(x, z, 111) * 25, d = squareDist(px, pz);
    if (d < ext + 620 || d > far) continue;
    const w = woodsAt(px, pz, d);
    if (w < .02 || !open(px, pz, 6)) continue;
    // Mostly groves, with a big single tree now and then so the stands don't repeat like stamps.
    const y = groundAt(px, pz) - .4, k = hash(px, pz, 112);
    const name = k < .22 ? pickBy(['oakDark', 'pine', 'spruce', 'oak', 'amber'], hash(px, pz, 114)) : w > .12 ? 'groveDark' : k < .42 ? 'groveAutumn' : 'grove';
    groves[d < ext + 1400 ? 0 : d < ext + 2200 ? 1 : 2].push({ x: px, y, z: pz, name, scale: (k < .22 ? 1.3 : 1.15) + hash(px, pz, 113) * .3 });
  }
  for (const bed of beds) {
    const [x, z] = [bed.s.cx + bed.s.tx * bed.u + bed.s.nx * bed.v, bed.s.cz + bed.s.tz * bed.u + bed.s.nz * bed.v];
    if (bed.kind === 'hedge') shrubs.push({ x, z, name: 'boxwood', scale: 1.3 }, { x: x + bed.s.tx * 3, z: z + bed.s.tz * 3, name: 'shrubWide' });
    else if (bed.kind === 'topiary') shrubs.push({ x, z, name: 'topiary' });
    else if (bed.kind === 'bollard') props.push({ x, z, name: 'bollard' });
    else if (bed.kind === 'tree') trees.push({ x, z, name: pickBy(['birch', 'magnolia', 'dogwood', 'golden'], hash(x, z, 121)), scale: .95 + hash(x, z, 122) * .2 });
    else for (let k = 0; k < 5; k++) flowers.push({ x: x + bed.s.nx * k * 3, z: z + bed.s.nz * k * 3, name: pickBy(FLOWERS, hash(x, z, 120 + k)) });
  }

  const flatGround = trees.filter(t => (t.y ?? 0) < 1.5);
  sprites.layer(scene, flatGround.map(t => ({ x: t.x + 1.4, y: (t.y ?? 0) + .09, z: t.z - 1, name: 'shadow', scale: 2.8 * (t.scale ?? 1), phase: .5 })), { decal: true, transparent: true, opacity: .28, renderOrder: 1, name: 'outskirts tree shadows', minZoom: LOD.macro });
  sprites.layer(scene, trees, { name: 'outskirts trees', minZoom: LOD.trees });
  groves.forEach((list, i) => list.length && sprites.layer(scene, list, { name: `outskirts groves ${i}`, minZoom: LOD.trees, haze: [0, .1, .2][i] }));
  sprites.canopyLayer(scene, [...trees.map(t => ({ x: t.x, y: (t.y ?? 0) + .1, z: t.z, r: art.sprites[t.name].w * (t.scale ?? 1) * .62, color: canopyTone(t.name) }))], { maxZoom: LOD.trees, name: 'outskirts canopy' });
  sprites.layer(scene, shrubs, { name: 'outskirts shrubs', minZoom: LOD.furniture });
  if (lilies.length) sprites.layer(scene, lilies, { decal: true, name: 'outskirts lily pads', minZoom: LOD.furniture, renderOrder: 1 });
  sprites.layer(scene, flowers, { name: 'outskirts flowers', minZoom: LOD.flowers });
  sprites.layer(scene, [...props, ...furniture], { name: 'outskirts furniture', minZoom: LOD.furniture });

  let waterTime = 0;
  return {
    group, terrain, heightAt: groundAt, plan, turbines: turbines.map(t => t.group.position),
    stats: { trees: trees.length, groves: groves.reduce((s, l) => s + l.length, 0), turbines: turbines.length, sites: plan.sites.length, stops: plan.stops.length, bridges: plan.bridges.length, ponds: plan.ponds.length, plazas: plan.plazas.length, ends: plan.ends },
    // dt: simulated seconds, so turbines and water hold still while the clock is paused and speed up with it.
    update(dt) {
      for (const t of turbines) t.rotor.rotation.x += dt * t.speed;
      waterTime += dt;
      const f = Math.floor(waterTime / .45) % frames.length;
      if (kit.water.map !== frames[f]) kit.water.map = frames[f];
    },
  };
}
