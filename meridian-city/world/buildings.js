// Buildings: every OSM footprint becomes a styled, textured structure of its family, with real roofs,
// doors facing the street, porches, awnings, chimneys and rooftop kit, and custom art for landmarks.
// Choices come from a hash of the footprint position, so the city looks the same on every load.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { FAMILIES, FAMILY_LABEL, familyOf, hash, pickBy, STOREY, CHUNK, P } from './palette.js';
import { Batches, edges, inside, bounds, area, centroid, simplify, inset, obb, triangulate, OCC, chunkKey } from './geometry.js';
import { facadePix, groundPix, roofPix, TILE_M, GROUND_FLOOR_M as GF, TileAtlas, tilingMaterial, Pix } from './textures.js';

const clamp = THREE.MathUtils.clamp;
const seedOf = key => { let h = 2166136261; for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const v3 = (x, y, z) => [x, y, z];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function storeys(fam, levels, A, r) {
  if (levels) return Math.max(1, Math.round(levels));
  switch (fam) {
    case 'house': return A > 230 || r < .55 ? 2 : 1;
    case 'apartment': return clamp(Math.round(Math.log2(A / 60) + r), 2, 5);
    case 'shop': return A < 250 ? 1 : A < 900 ? 2 : 3;
    case 'campus': return clamp(Math.round(Math.log2(A / 120) + r * .8), 2, 5);
    case 'office': return clamp(Math.round(Math.log2(A / 80) + r), 3, 8);
    case 'civic': return clamp(Math.round(Math.log2(A / 150) + r * .6), 1, 4);
    case 'garage': return clamp(Math.round(A / 1500) + 2, 2, 6);
    default: return 1;
  }
}

const LANDMARKS = [
  [/bell tower/i, 'bellTower'], [/^old well$/i, 'oldWell'], [/wilson library/i, 'dome'], [/planetarium/i, 'dome'],
  [/chapel of the cross|church|chapel|methodist|baptist|presbyterian|episcopal/i, 'church'],
];

export function buildBuildings({ osm, names, grid, details, parent }) {
  const atlas = new TileAtlas(2048);
  const facadeTile = (wall, win, lit) => atlas.rect(`f:${wall}:${win}`, () => facadePix(wall, win, seedOf(wall + win), lit));
  const groundTile = (wall, style, win, lit) => atlas.rect(`g:${wall}:${style}:${win}`, () => groundPix(wall, style, win, seedOf(wall + style + win), lit));
  const roofTile = key => atlas.rect(`r:${key}`, () => key === 'seats' ? seatsPix() : roofPix(key, seedOf(key)));
  const batches = new Batches();
  const D = name => { const [u0, v0, u1, v1] = details.uv(name); return [u0, v1, u1, v0]; }; // bottom-left first
  const meta = [];

  // Names: which footprint each named point falls in.
  const named = new Map(), boxes = osm.b.map(b => bounds(b[4]));
  for (const [x, z, name, kind] of names) {
    for (let i = 0; i < osm.b.length; i++) {
      const r = osm.b[i][4], [x0, z0, x1, z1] = boxes[i];
      if (x < x0 || x > x1 || z < z0 || z > z1 || !inside(r, x, z)) continue;
      if (!named.has(i)) named.set(i, { name, kind });
      break;
    }
  }

  // ---------- geometry writers ----------
  // Wall band from y0 to y1 around a ring; u runs continuously so bays line up around corners.
  function band(b, ring, y0, y1, tile, tileW, tileH, vBase, u0, cBot, cTop) {
    b.tile = tile;
    let u = u0;
    edges(ring, (ax, az, bx, bz, l) => {
      if (l < .05) return;
      const n = [(az - bz) / l, 0, (bx - ax) / l], va = (y0 - vBase) / tileH, vb = (y1 - vBase) / tileH;
      b.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], n, [u / tileW, va, (u + l) / tileW, va, (u + l) / tileW, vb, u / tileW, vb], cBot, cTop);
      u += l;
    });
  }
  // A planar polygon face (3 or 4 points) with uvs from its own plane, in tiles of tw x th metres.
  // `up` forces the normal upward (roofs); otherwise the given winding decides.
  function face(b, pts, tile, tw, th, col, up = true) {
    let [a, bb, c] = pts;
    let n = norm(cross(sub(bb, a), sub(pts[pts.length - 1], a)));
    if (up && n[1] < 0) { pts = pts.slice().reverse(); [a, bb] = pts; n = n.map(x => -x); }
    const eu = norm(sub(pts[1], pts[0])), ev = cross(n, eu), o = pts[0];
    const uv = p => { const d = sub(p, o); return [dot(d, eu) / tw, dot(d, ev) / th]; };
    b.tile = tile;
    b.tri3(pts[0], pts[1], pts[2], uv(pts[0]), uv(pts[1]), uv(pts[2]), col);
    if (pts.length === 4) b.tri3(pts[0], pts[2], pts[3], uv(pts[0]), uv(pts[2]), uv(pts[3]), col);
  }
  function flatCap(b, rings, y, tile, col) {
    b.tile = tile;
    const tw = TILE_M.roof.w;
    for (const [p, q, r] of triangulate(rings)) b.flat(p, q, r, y, col, (x, z) => [x / tw, -z / tw]);
  }
  // Detail quad with an atlas region: corners bottom-left, bottom-right, top-right, top-left.
  function decal(b, corners, region, col = WHITE) {
    const [u0, v0, u1, v1] = D(region);
    const n = norm(cross(sub(corners[1], corners[0]), sub(corners[3], corners[0])));
    b.quad(corners, n, [u0, v0, u1, v0, u1, v1, u0, v1], col);
  }
  const boxUv = (side, top = side) => face => D(face === 'top' ? top : side);
  function pyramid(b, cx, cz, rad, y0, y1, sides, region, rot = Math.PI / 4, col = WHITE) {
    const [u0, v0, u1, v1] = D(region), apex = [cx, y1, cz];
    for (let i = 0; i < sides; i++) {
      const a0 = rot + i * 2 * Math.PI / sides, a1 = rot + (i + 1) * 2 * Math.PI / sides;
      const p0 = [cx + Math.cos(a0) * rad, y0, cz + Math.sin(a0) * rad], p1 = [cx + Math.cos(a1) * rad, y0, cz + Math.sin(a1) * rad];
      let [A, B] = [p0, p1];
      const n = cross(sub(B, A), sub(apex, A));
      if (n[1] < 0) [A, B] = [B, A];
      b.tri3(A, B, apex, [u0, v0], [u1, v0], [(u0 + u1) / 2, v1], col);
    }
  }
  function prism(b, cx, cz, rad, y0, y1, sides, region, col = WHITE) {
    const [u0, v0, u1, v1] = D(region);
    for (let i = 0; i < sides; i++) {
      const a0 = i * 2 * Math.PI / sides, a1 = (i + 1) * 2 * Math.PI / sides;
      const A = [cx + Math.cos(a0) * rad, y0, cz + Math.sin(a0) * rad], B = [cx + Math.cos(a1) * rad, y0, cz + Math.sin(a1) * rad];
      const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
      b.quad([B, A, [A[0], y1, A[2]], [B[0], y1, B[2]]], [nx, 0, nz], [u0, v0, u1, v0, u1, v1, u0, v1], col);
    }
  }
  const WHITE = new THREE.Color(1, 1, 1);
  const tint = (k) => new THREE.Color(k, k, k);

  // ---------- roofs ----------
  function hipRoof(b, o, H, over, pitch, gable, roofT, wallT, wallTW, wallTH, wallV, col) {
    const { cx, cz, hl, hw, ux, uz } = o, L = hl + over, W = hw + over, eaveY = H - over * pitch, ridgeY = H + hw * pitch;
    const at = (a, c, y) => [cx + ux * a - uz * c, y, cz + uz * a + ux * c];
    const rl = gable ? L : Math.max(0, L - W);
    const r0 = at(-rl, 0, ridgeY), r1 = at(rl, 0, ridgeY);
    const T = TILE_M.roof.w;
    face(b, [at(-L, -W, eaveY), at(L, -W, eaveY), r1, r0], roofT, T, T, col);
    face(b, [at(L, W, eaveY), at(-L, W, eaveY), r0, r1], roofT, T, T, col);
    if (gable) { // triangular gable walls, then roof edges are open ends
      face(b, [at(hl, hw, H), at(hl, -hw, H), at(hl, 0, ridgeY)], wallT, wallTW, wallTH, WHITE, false);
      face(b, [at(-hl, -hw, H), at(-hl, hw, H), at(-hl, 0, ridgeY)], wallT, wallTW, wallTH, WHITE, false);
    } else if (rl > 0) {
      face(b, [at(L, -W, eaveY), at(L, W, eaveY), r1], roofT, T, T, col);
      face(b, [at(-L, W, eaveY), at(-L, -W, eaveY), r0], roofT, T, T, col);
    } else { // pyramid: square-ish footprint
      face(b, [at(L, -W, eaveY), at(L, W, eaveY), r1], roofT, T, T, col);
      face(b, [at(-L, W, eaveY), at(-L, -W, eaveY), r0], roofT, T, T, col);
    }
    return { ridgeY, peak: ridgeY, slope: [at(-L, -W, eaveY), at(L, -W, eaveY), r1, r0] };
  }
  // Any footprint: slopes rise from an overhanging eave to an inset ring, then a flat top.
  function mansard(b, outer, H, over, pitch, d0, roofT, col) {
    const eave = inset(outer, -over) ?? outer;
    let inner = null, d = d0;
    for (let k = 0; k < 4; k++, d *= .6) if ((inner = inset(outer, d))) break;
    if (!inner) return null;
    const eaveY = H - over * pitch, topY = H + d * pitch, T = TILE_M.roof.w;
    const n = outer.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      face(b, [[eave[2 * i], eaveY, eave[2 * i + 1]], [eave[2 * j], eaveY, eave[2 * j + 1]], [inner[2 * j], topY, inner[2 * j + 1]], [inner[2 * i], topY, inner[2 * i + 1]]], roofT, T, T, col);
    }
    flatCap(b, [inner], topY, roofT, col);
    return { ridgeY: topY, peak: topY, inner };
  }
  function flatRoof(b, db, rings, H, roofT, o, fam) {
    flatCap(b, rings, H, roofT, tint(.96));
    const ph = fam === 'stadium' ? 1.2 : .7;
    for (const r of rings) edges(r, (ax, az, bx, bz, l) => { // parapet: light cornice outside, concrete inside
      if (l < .3) return;
      const nx = (az - bz) / l, nz = (bx - ax) / l;
      decal(db, [[ax, H, az], [bx, H, bz], [bx, H + ph, bz], [ax, H + ph, az]], 'stoneTrim');
      decal(db, [[bx - nx * .3, H, bz - nz * .3], [ax - nx * .3, H, az - nz * .3], [ax - nx * .3, H + ph, az - nz * .3], [bx - nx * .3, H + ph, bz - nz * .3]], 'concrete', tint(.85));
    });
    if (fam === 'stadium' || !o) return;
    const ry = Math.atan2(o.uz, o.ux), units = Math.min(8, Math.floor(o.area / 250));
    for (let k = 0; k < units; k++) { // rooftop kit squared up with the building
      const a = (hash(o.cx, o.cz, 40 + k) - .5) * o.hl * 1.4, c = (hash(o.cx, o.cz, 60 + k) - .5) * o.hw * 1.2;
      const x = o.cx + o.ux * a - o.uz * c, z = o.cz + o.uz * a + o.ux * c;
      if (!inside(rings[0], x, z)) continue;
      if (hash(x, z, 3) < .3) decal(db, [[x - 1.2, H + .05, z + 1.2], [x + 1.2, H + .05, z + 1.2], [x + 1.2, H + .05, z - 1.2], [x - 1.2, H + .05, z - 1.2]], 'skylight');
      else db.box(x, z, 2.2, 1.3, 1.6, H, ry, WHITE, boxUv('acSide', 'acTop'));
    }
  }

  // ---------- entrances ----------
  // The wall that faces a street: probe outward from each edge for road cells.
  function frontEdge(outer) {
    let best = null;
    edges(outer, (ax, az, bx, bz, l) => {
      if (l < 2.4) return;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, nx = (az - bz) / l, nz = (bx - ax) / l;
      let score = l * .05;
      for (let k = 2; k <= 22; k += 2) if (grid.at(mx + nx * k, mz + nz * k) & OCC.road) { score += 30 / k; break; }
      if (!best || score > best.score) best = { score, ax, az, bx, bz, l, nx, nz, ux: (bx - ax) / l, uz: (bz - az) / l, mx, mz };
    });
    return best;
  }
  const wallPoint = (e, t, out = .04) => [e.ax + e.ux * t + e.nx * out, e.az + e.uz * t + e.nz * out];
  function door(db, e, t, w, h, region) {
    const [x0, z0] = wallPoint(e, t - w / 2), [x1, z1] = wallPoint(e, t + w / 2);
    decal(db, [[x0, 0, z0], [x1, 0, z1], [x1, h, z1], [x0, h, z0]], region);
    const [cx, cz] = wallPoint(e, t, 2.5); // keep the way in clear of trees and benches
    grid.fill(cx - 2, cz - 2, cx + 2, cz + 2, OCC.keepClear);
  }
  function porch(db, e, t, H) {
    const pw = Math.min(e.l * .6, 6), depth = 2, ry = Math.atan2(e.uz, e.ux);
    const [cx, cz] = wallPoint(e, t, depth / 2);
    db.box(cx, cz, pw, .35, depth, 0, ry, WHITE, boxUv('concrete', 'porchFloor'));
    for (const s of [-1, 1]) { const [px, pz] = wallPoint(e, t + s * (pw / 2 - .2), depth - .2); db.box(px, pz, .22, 2.4, .22, .35, ry, WHITE, boxUv('postWhite')); }
    const [a0, b0] = wallPoint(e, t - pw / 2 - .15, 0), [a1, b1] = wallPoint(e, t + pw / 2 + .15, 0);
    const [c0, d0] = wallPoint(e, t - pw / 2 - .15, depth + .25), [c1, d1] = wallPoint(e, t + pw / 2 + .15, depth + .25);
    decal(db, [[c0, 2.65, d0], [c1, 2.65, d1], [a1, Math.min(3.15, H), b1], [a0, Math.min(3.15, H), b0]], 'porchRoof');
    grid.fill(cx - pw / 2, cz - pw / 2, cx + pw / 2, cz + pw / 2, OCC.keepClear);
  }
  function awnings(db, e, h) {
    const n = clamp(Math.floor(e.l / 6.5), 1, 5), colorKey = ['awningRed', 'awningGreen', 'awningBlue', 'awningGold', 'awningPlum'];
    for (let k = 0; k < n; k++) {
      const t = e.l * (k + .5) / n, w = Math.min(4.6, e.l / n - .6), region = pickBy(colorKey, hash(e.mx, e.mz, 10 + k));
      const [a0, b0] = wallPoint(e, t - w / 2, 0), [a1, b1] = wallPoint(e, t + w / 2, 0), [c0, d0] = wallPoint(e, t - w / 2, 1.5), [c1, d1] = wallPoint(e, t + w / 2, 1.5);
      decal(db, [[c0, 2.75, d0], [c1, 2.75, d1], [a1, 3.25, b1], [a0, 3.25, b0]], region);
      decal(db, [[c0, 2.45, d0], [c1, 2.45, d1], [c1, 2.75, d1], [c0, 2.75, d0]], region, tint(.82)); // valance
      if (hash(e.mx, e.mz, 20 + k) < .7) {
        const [s0, z0] = wallPoint(e, t - 1.6, .05), [s1, z1] = wallPoint(e, t + 1.6, .05);
        decal(db, [[s0, 3.35, z0], [s1, 3.35, z1], [s1, 3.9, z1], [s0, 3.9, z0]], `sign${Math.floor(hash(e.mx, e.mz, 30 + k) * 7)}`);
      }
    }
  }

  // ---------- Aero building kit ----------
  // Pearl cornice trim just under the eave or parapet.
  function cornice(db, ring, H) {
    edges(ring, (ax, az, bx, bz, l) => {
      if (l < .8) return;
      const nx = (az - bz) / l * .07, nz = (bx - ax) / l * .07;
      decal(db, [[ax + nx, H - .34, az + nz], [bx + nx, H - .34, bz + nz], [bx + nx, H, bz + nz], [ax + nx, H, az + nz]], 'pearlTrim');
    });
  }
  // Glass-railed balconies on upper floors: always on the street side, sometimes on other long walls.
  function balconies(db, outer, front, upper, storeyH, cap = 48) {
    let n = 0;
    edges(outer, (ax, az, bx, bz, l) => {
      if (l < 7 || n >= cap) return;
      const isFront = front && Math.abs(ax - front.ax) < .01 && Math.abs(az - front.az) < .01;
      if (!isFront && hash(ax, az, 90) > .7) return;
      const ux = (bx - ax) / l, uz = (bz - az) / l, nx = (az - bz) / l, nz = (bx - ax) / l, ry = Math.atan2(uz, ux), w = 1.6, d = 1.3;
      for (let st = 3.5; st < l - 2.5; st += 6) for (let f = 1; f <= upper && n < cap; f++, n++) {
        const y = GF + (f - 1) * storeyH, cx = ax + ux * st + nx * d / 2, cz = az + uz * st + nz * d / 2;
        db.box(cx, cz, w * 2, .16, d, y, ry, WHITE, boxUv('balconySlab'));
        const fx = cx + nx * d / 2, fz = cz + nz * d / 2, y0 = y + .16, y1 = y + 1.05;
        decal(db, [[fx - ux * w, y0, fz - uz * w], [fx + ux * w, y0, fz + uz * w], [fx + ux * w, y1, fz + uz * w], [fx - ux * w, y1, fz - uz * w]], 'balconyRail');
        for (const sd of [-1, 1]) {
          const sx = cx + ux * w * sd, sz = cz + uz * w * sd;
          decal(db, [[sx - nx * d / 2, y0, sz - nz * d / 2], [sx + nx * d / 2, y0, sz + nz * d / 2], [sx + nx * d / 2, y1, sz + nz * d / 2], [sx - nx * d / 2, y1, sz - nz * d / 2]], 'balconyRail');
        }
      }
    });
  }
  // A pair of planter boxes flanking the entrance.
  function planters(db, e, t, doorW) {
    for (const sd of [-1, 1]) {
      const along = t + sd * (doorW / 2 + .9);
      if (along < .6 || along > e.l - .6) continue;
      const [x, z] = wallPoint(e, along, .5);
      db.box(x, z, 1.1, .7, .8, 0, Math.atan2(e.uz, e.ux), WHITE, boxUv('planterSide', 'planterTop'));
    }
  }
  // A curved glass canopy over an office entrance, on two slim white posts.
  function canopy(db, e, t) {
    const w = 2.3, depth = 2.6, segs = 4, y = d => 3.05 + .45 * Math.cos(d / depth * Math.PI / 2);
    for (let k = 0; k < segs; k++) {
      const d0 = depth * k / segs, d1 = depth * (k + 1) / segs;
      const [a0, b0] = wallPoint(e, t - w, d0), [a1, b1] = wallPoint(e, t + w, d0), [c0, e0] = wallPoint(e, t - w, d1), [c1, e1] = wallPoint(e, t + w, d1);
      decal(db, [[c0, y(d1), e0], [c1, y(d1), e1], [a1, y(d0), b1], [a0, y(d0), b0]], 'canopyGlass');
    }
    for (const sd of [-1, 1]) { const [px, pz] = wallPoint(e, t + sd * (w - .2), depth - .15); db.box(px, pz, .14, y(depth), .14, 0, 0, WHITE, boxUv('trim')); }
  }
  // Solar panels laid on a hip roof's front slope (pts: eave-left, eave-right, ridge-right, ridge-left).
  function slopeSolar(db, [A, B, C, D]) {
    const lerp = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
    let n = norm(cross(sub(B, A), sub(D, A)));
    if (n[1] < 0) n = n.map(x => -x);
    const P = (u, v) => lerp(lerp(A, B, u), lerp(D, C, u), v).map((x, i) => x + n[i] * .07);
    decal(db, [P(.28, .18), P(.72, .18), P(.72, .62), P(.28, .62)], 'solarPanel');
  }
  // Flat-roof extras: a roof garden, a glass dome skylight, rows of tilted solar panels.
  function roofExtras(wb, db, outer, H, o, F, r) {
    if (!o) return;
    const inner = inset(outer, 2.2);
    if (inner && F.greenRoof && r(70) < F.greenRoof) flatCap(wb, [inner], H + .08, roofTile('garden'), WHITE);
    if (F.dome && o.area > 900 && r(71) < F.dome && inside(outer, o.cx, o.cz)) dome(db, o.cx, o.cz, clamp(Math.min(o.hw, o.hl) * .32, 2.2, 7), H, { drum: .7, skin: 'domeGlass', base: 'pearlTrim' });
    else if (F.solar && r(72) < F.solar) {
      const ry = Math.atan2(o.uz, o.ux);
      for (let a = -o.hl + 3; a < o.hl - 3; a += 3.8) for (let c = -o.hw + 3; c < o.hw - 3; c += 2.6) {
        const x = o.cx + o.ux * a - o.uz * c, z = o.cz + o.uz * a + o.ux * c;
        if (!inside(outer, x - 2, z - 2) || !inside(outer, x + 2, z + 2) || hash(x, z, 73) < .25) continue;
        const ca = Math.cos(ry), sa = Math.sin(ry), P = (u, v, h) => [x + u * ca - v * sa, H + h, z + u * sa + v * ca];
        decal(db, [P(-1.6, .7, .25), P(1.6, .7, .25), P(1.6, -.7, .95), P(-1.6, -.7, .95)], 'solarPanel');
      }
    }
  }

  // ---------- landmarks ----------
  function steeple(db, e, H) {
    const [cx, cz] = wallPoint(e, e.l / 2, -1.8), ry = Math.atan2(e.uz, e.ux), top = H + 6;
    db.box(cx, cz, 3.4, top, 3.4, 0, ry, WHITE, boxUv('steeple', 'trim'));
    pyramid(db, cx, cz, 2.3, top, top + 7, 4, 'spire', ry + Math.PI / 4);
    return top + 7;
  }
  // A drum (skipped when low), three stepped courses and a gilded lantern. squash flattens it, as on the Old Well.
  function dome(db, cx, cz, rad, y, { drum = 2.4, squash = 1, skin = 'trim', base = 'stoneTrim' } = {}) {
    if (drum) prism(db, cx, cz, rad, y, y + drum, 12, base);
    let r0 = rad, y0 = y + drum;
    for (const [f, h] of [[.86, 1.4], [.62, 1.1], [.32, .9]]) { // three stepped courses, then the lantern
      const dy = h * squash;
      const r1 = rad * f;
      for (let i = 0; i < 12; i++) {
        const a0 = i * Math.PI / 6, a1 = (i + 1) * Math.PI / 6;
        decal(db, [[cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0], [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], [cx + Math.cos(a0) * r1, y0 + dy, cz + Math.sin(a0) * r1], [cx + Math.cos(a1) * r1, y0 + dy, cz + Math.sin(a1) * r1]], skin, tint(1.02 - f * .1));
      }
      r0 = r1; y0 += dy;
    }
    prism(db, cx, cz, r0, y0, y0 + 1.2 * squash, 8, 'trim');
    pyramid(db, cx, cz, r0 * 1.1, y0 + 1.2 * squash, y0 + 2.4 * squash, 8, 'awningGold');
    return y0 + 2.4 * squash;
  }

  // ---------- one building ----------
  OSM_LOOP: for (let i = 0; i < osm.b.length; i++) {
    const [type, levels, heightTag, shop, rawOuter, ...rawHoles] = osm.b[i];
    const outer = simplify(rawOuter), holes = rawHoles.map(h => simplify(h)).filter(h => h.length >= 6);
    const roofOutline = simplify(outer, .8); // coarser outline for roofs, so small jogs do not block a hipped roof
    if (outer.length < 6) continue;
    const A = area(outer);
    if (A < 4) continue;
    const [cx, cz] = centroid(outer), o = obb(outer);
    const nm = named.get(i), landmark = nm && LANDMARKS.find(([re]) => re.test(nm.name))?.[1];
    const isChurch = landmark === 'church' || type === 'church' || type === 'chapel';
    const fam = landmark === 'bellTower' ? 'campus' : isChurch ? 'civic' : familyOf(type, shop, A, levels);
    const F = FAMILIES[fam], r = k => hash(cx, cz, k);
    const wallKey = pickBy(F.walls, r(1)), roofKey = pickBy(F.roofs, r(2));
    const floors = landmark === 'bellTower' ? 1 : storeys(fam, levels, A, r(3));
    let H = heightTag || (fam === 'stadium' ? 11 : fam === 'shed' ? 3 : floors === 1 ? GF : GF + (floors - 1) * STOREY);
    if (landmark === 'bellTower') H = Math.max(H, 34);
    const upperFloors = Math.max(0, heightTag ? Math.max(1, Math.round((H - GF) / STOREY)) : floors - 1);
    const storeyH = upperFloors ? (H - GF) / upperFloors : STOREY;
    const ck = chunkKey(cx, cz, CHUNK), wb = batches.at(`${ck}|wall`), db = batches.at(`${ck}|detail`);
    batches.owner = meta.length;
    wb.current = db.current = meta.length;
    const rings = [outer, ...holes], shade = .93 + r(4) * .1, col = tint(shade), foot = tint(shade * .78);
    let top = H;

    if (landmark === 'oldWell') { // a domed rotunda on eight columns
      const rad = Math.max(2.5, Math.min(o.hw, o.hl) * .85);
      db.box(cx, cz, rad * 2.3, .35, rad * 2.3, 0, 0, WHITE, boxUv('concrete', 'stoneTrim'));
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; db.box(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad, .45, 4, .45, .35, a, WHITE, boxUv('trim')); }
      prism(db, cx, cz, rad + .4, 4.35, 5, 8, 'trim');
      top = dome(db, cx, cz, rad + .2, 5, { drum: 0, squash: .55 });
      grid.fillRing(outer, OCC.building);
      meta.push({ i, name: nm.name, family: 'civic', label: 'Landmark', type, floors: 0, height: top, area: A, outer, cx, cz });
      continue OSM_LOOP;
    }

    // Walls: a ground-floor band, then the upper storeys.
    const tower = landmark === 'bellTower'; // solid brick shaft below the belfry
    const wallT = facadeTile(wallKey, tower ? 'none' : F.window, F.lit), groundT = groundTile(wallKey, tower ? 'none' : F.ground, tower ? 'none' : F.window, F.lit);
    const u0 = Math.floor(r(5) * 8) * 3;
    const groundTop = Math.min(H, GF);
    for (const ring of rings) band(wb, ring, 0, groundTop, groundT, TILE_M.ground.w, TILE_M.ground.h, 0, u0, foot, col);
    if (H > GF) for (const ring of rings) band(wb, ring, GF, H, wallT, TILE_M.facade.w, storeyH * 4, GF, u0, col, col);

    // Roof.
    // A stadium footprint with a hole is an open bowl (seating on top); without one it is a covered arena
    // such as the Dean Smith Center, which gets a low hipped roof.
    const arena = fam === 'stadium' && !holes.length, pitch = arena ? .28 : F.pitch;
    const pitched = arena || (F.pitch && !holes.length && (F.flatAbove == null || A <= F.flatAbove) && fam !== 'stadium' && landmark !== 'bellTower');
    const roofT = arena ? roofTile(pickBy(['slate', 'charcoal', 'blueMetal'], r(2))) : fam === 'stadium' ? roofTile('seats') : roofTile(pitched ? roofKey : pickBy(['pearlDeck', 'pearlDeck', 'flatGravel'], r(2))), roofCol = tint(.92 + r(6) * .1);
    let roof = null;
    if (pitched && o) {
      const rect = o.area / A < 1.2 && outer.length <= 12, over = fam === 'house' || fam === 'shed' ? .45 : .3;
      if (rect) roof = hipRoof(wb, o, H, over, pitch, (fam === 'house' || fam === 'shed') && r(7) < .35, roofT, wallT, TILE_M.facade.w, storeyH * 4, GF, roofCol);
      else if (roofOutline.length >= 6) roof = mansard(wb, roofOutline, H, over, pitch, Math.min(o.hw * .9, fam === 'house' ? 5 : 8), roofT, roofCol);
    }
    if (!roof) { flatRoof(wb, db, rings, H, roofT, o, fam); if (fam !== 'stadium' && !landmark) roofExtras(wb, db, outer, H, o, F, r); }
    top = roof?.peak ?? H + .7;
    if (fam !== 'stadium' && fam !== 'shed' && !tower) cornice(db, outer, H);
    if (roof?.slope && fam === 'house' && F.solar && r(13) < F.solar) slopeSolar(db, roof.slope);

    // Details: entrance, porch, awnings, chimney.
    const e = frontEdge(outer);
    if (e && fam !== 'stadium') {
      const t = e.l / 2;
      const doorW = fam === 'campus' || fam === 'civic' ? 3.2 : fam === 'shop' ? Math.min(2.8, e.l * .4) : fam === 'house' ? 1.5 : 2.6;
      if (fam === 'shop') { door(db, e, t, doorW, 2.5, 'doorAqua'); awnings(db, e); }
      else if (fam === 'campus' || fam === 'civic') door(db, e, t, doorW, 2.8, 'portico');
      else if (fam === 'house') {
        door(db, e, t, doorW, 2.5, pickBy(F.doors, r(8)));
        if (F.porch && e.l >= 5.5 && r(9) < .6) porch(db, e, t, H);
      } else if (fam !== 'shed' && fam !== 'industrial' && fam !== 'stadium') door(db, e, t, doorW, 2.5, pickBy(F.doors ?? ['doorAqua'], r(8)));
      if (F.planters && r(14) < F.planters && e.l > doorW + 4) planters(db, e, t, doorW);
      if (F.canopy && e.l > 7) canopy(db, e, t);
      if (F.balconies && upperFloors && r(15) < F.balconies) balconies(db, outer, e, upperFloors, storeyH);
      if (isChurch) top = Math.max(top, steeple(db, e, H));
    }
    if (roof && o && F.chimney && r(11) < F.chimney) {
      const a = o.hl * .45 * (r(12) < .5 ? -1 : 1), x = o.cx + o.ux * a, z = o.cz + o.uz * a;
      db.box(x, z, .9, roof.ridgeY - H + 1.1, .9, H, Math.atan2(o.uz, o.ux), WHITE, boxUv('chimney', 'chimneyTop'));
    }
    if (landmark === 'bellTower' && o) { // belfry with clock faces, then a stone spire
      const ry = Math.atan2(o.uz, o.ux), half = Math.min(o.hw, o.hl);
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = o.ux * a - o.uz * c, nz = o.uz * a + o.ux * c, fx = o.cx + nx * (half + .06), fz = o.cz + nz * (half + .06), tx = -nz, tz = nx;
        decal(db, [[fx - tx * 1.6, H - 5, fz - tz * 1.6], [fx + tx * 1.6, H - 5, fz + tz * 1.6], [fx + tx * 1.6, H - 1.8, fz + tz * 1.6], [fx - tx * 1.6, H - 1.8, fz - tz * 1.6]], 'bellFace');
      }
      db.box(o.cx, o.cz, half * 1.6, 3, half * 1.6, H, ry, WHITE, boxUv('trim'));
      pyramid(db, o.cx, o.cz, half * 1.05, H + 3, H + 14, 4, 'trim', ry + Math.PI / 4);
      top = H + 14;
    }
    if (landmark === 'dome' && o) top = dome(db, o.cx, o.cz, Math.min(o.hw, o.hl) * .38, top - .2);

    grid.fillRing(outer, OCC.building);
    meta.push({ i, name: nm?.name ?? null, family: fam, label: landmark && landmark !== 'church' ? 'Landmark' : FAMILY_LABEL[fam], type, floors: fam === 'stadium' || landmark === 'bellTower' ? 0 : 1 + upperFloors, height: top, wall: H, area: A, outer, cx, cz, door: e && fam !== 'stadium' && fam !== 'shed' ? wallPoint(e, e.l / 2, 1.2) : null });
  }

  // ---------- meshes ----------
  facadeTile('sidingCream', 'shutter'); facadeTile('brickRed', 'sill'); roofTile('plum'); roofTile('flatGravel'); // the sim's zone art
  const wallMat = tilingMaterial(atlas.texture());
  const detailMat = new THREE.MeshPhongMaterial({ map: details.texture, vertexColors: true, alphaTest: .5, side: THREE.DoubleSide, specular: '#2a3540', shininess: 30 });
  const group = new THREE.Group(), pickables = [];
  for (const [key, b] of batches.map) {
    if (b.empty) continue;
    const mesh = new THREE.Mesh(b.build(), key.endsWith('|wall') ? wallMat : detailMat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.owner = mesh.geometry.userData.owner;
    if (key.endsWith('|detail')) mesh.userData.detail = true;
    group.add(mesh); pickables.push(mesh);
  }
  parent.add(group);
  return {
    meta, group, pickables, wallMaterial: wallMat, atlasTile: key => atlas.tiles.get(key),
    setDetailVisible: v => { for (const m of group.children) if (m.userData.detail) m.visible = v; },
  };
}

// Stadium seating: rows of blue and white seats over concrete steps.
function seatsPix() {
  const p = new Pix(64, 64, 5);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) p.set(x, y, y % 4 === 3 ? '#8f8574' : y % 4 === 0 ? '#c9c3b6' : (Math.floor(x / 2) % 2 ? '#5b8fd1' : '#4a7cbd'));
  return p;
}
