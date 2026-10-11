// Geometry helpers shared by every layer: merged-mesh batches, footprint rings, and the occupancy grid
// that keeps decorations off roads, buildings and entrances.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';

// A growable merged mesh. Every triangle remembers its owner (a building index, or -1), so one
// raycast hit on a merged mesh can be traced back to the building it belongs to.
// Batches drawn with a tiling atlas material also carry a tile rect per vertex (set via .tile).
export class Batch {
  p = []; n = []; uv = []; c = []; t = []; owner = []; current = -1; tile = null;
  push(x, y, z, nx, ny, nz, u, v, col) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(col.r, col.g, col.b);
    if (this.tile) this.t.push(...this.tile);
  }
  // v: 4 corners (bottom-left, bottom-right, top-right, top-left); uv: 8 numbers in the same order.
  quad(v, nrm, uv, c0, c1 = c0) {
    for (const i of [0, 1, 2, 0, 2, 3]) this.push(...v[i], ...nrm, uv[2 * i], uv[2 * i + 1], i < 2 ? c0 : c1);
    this.owner.push(this.current, this.current);
  }
  // Any planar triangle with explicit uvs; the normal is computed.
  tri3(a, b, c, ua, ub, uc, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.push(...a, nx, ny, nz, ...ua, col); this.push(...b, nx, ny, nz, ...ub, col); this.push(...c, nx, ny, nz, ...uc, col);
    this.owner.push(this.current);
  }
  // Flat, facing up. a/b/c are [x, z]; uv(x, z) maps a point to texture coordinates.
  flat(a, b, c, y, col, uv) {
    if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) [b, c] = [c, b];
    for (const q of [a, b, c]) this.push(q[0], y, q[1], 0, 1, 0, ...uv(q[0], q[1]), col);
    this.owner.push(this.current);
  }
  // A box from (x0..x1, y0..y1, z0..z1) rotated by ry about (cx, cz); uvRect(face) → [u0, v0, u1, v1].
  box(cx, cz, sx, sy, sz, y0, ry, col, uvRect, colTop = col) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (x, y, z) => [cx + x * c - z * s, y0 + y, cz + x * s + z * c];
    const hx = sx / 2, hz = sz / 2;
    const faces = [
      ['side', [-hx, 0, hz], [hx, 0, hz], [hx, sy, hz], [-hx, sy, hz], [0, 0, 1], sx],
      ['side', [hx, 0, -hz], [-hx, 0, -hz], [-hx, sy, -hz], [hx, sy, -hz], [0, 0, -1], sx],
      ['end', [hx, 0, hz], [hx, 0, -hz], [hx, sy, -hz], [hx, sy, hz], [1, 0, 0], sz],
      ['end', [-hx, 0, -hz], [-hx, 0, hz], [-hx, sy, hz], [-hx, sy, -hz], [-1, 0, 0], sz],
      ['top', [-hx, sy, hz], [hx, sy, hz], [hx, sy, -hz], [-hx, sy, -hz], [0, 1, 0], sx],
    ];
    for (const [face, a, b, cc, d, nrm, w] of faces) {
      const [u0, v0, u1, v1] = uvRect(face, w, face === 'top' ? sz : sy);
      const n = [nrm[0] * c - nrm[2] * s, nrm[1], nrm[0] * s + nrm[2] * c];
      this.quad([P(...a), P(...b), P(...cc), P(...d)], n, [u0, v0, u1, v0, u1, v1, u0, v1], face === 'top' ? colTop : col);
    }
  }
  get empty() { return !this.p.length; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.t.length) g.setAttribute('aTile', new THREE.Float32BufferAttribute(this.t, 4));
    g.userData.owner = Int32Array.from(this.owner);
    g.computeBoundingSphere();
    return g;
  }
}

// A set of batches keyed by name, one per material per culling chunk.
export class Batches {
  map = new Map();
  get(key) { if (!this.map.has(key)) this.map.set(key, new Batch()); return this.map.get(key); }
  set owner(id) { for (const b of this.map.values()) b.current = id; this._owner = id; }
  // Batches created after the owner was set must start with it too.
  at(key) { const b = this.get(key); b.current = this._owner ?? -1; return b; }
}

// ---------- rings: flat [x, z, x, z, ...] loops ----------
// fetch_osm.py winds outer rings so (-dz, dx) points out of every wall, holes the other way.
export function edges(r, f) {
  for (let i = 0; i < r.length; i += 2) {
    const ax = r[i], az = r[i + 1], bx = r[(i + 2) % r.length], bz = r[(i + 3) % r.length];
    f(ax, az, bx, bz, Math.hypot(bx - ax, bz - az), i / 2);
  }
}
export function inside(r, x, z) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2)
    if ((r[i + 1] > z) !== (r[j + 1] > z) && x < (r[j] - r[i]) * (z - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
  return c;
}
export function bounds(r) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
  return [x0, z0, x1, z1];
}
export const signedArea = r => { let s = 0; edges(r, (ax, az, bx, bz) => { s += ax * bz - bx * az; }); return s / 2; };
export const area = r => Math.abs(signedArea(r));
export function centroid(r) {
  let x = 0, z = 0;
  for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
  return [x / (r.length / 2), z / (r.length / 2)];
}

// Drops near-duplicate and collinear vertices, so roofs and facades get clean corners.
export function simplify(r, tol = .25) {
  let out = r.slice();
  for (let changed = true; changed && out.length > 6;) {
    changed = false;
    const n = out.length / 2;
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n;
      const ax = out[2 * p], az = out[2 * p + 1], bx = out[2 * i], bz = out[2 * i + 1], cx = out[2 * q], cz = out[2 * q + 1];
      const l = Math.hypot(cx - ax, cz - az) || 1, d = Math.abs((cx - ax) * (az - bz) - (ax - bx) * (cz - az)) / l;
      if (d < tol || Math.hypot(bx - ax, bz - az) < tol) { out.splice(2 * i, 2); changed = true; break; }
    }
  }
  return out;
}

// Offsets a ring inward by d (outward if d < 0) with mitred corners. Returns null when the shape
// would fold over itself, so callers can fall back to a smaller inset or a flat roof.
export function inset(r, d) {
  const n = r.length / 2, lines = [];
  for (let i = 0; i < n; i++) {
    const ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * ((i + 1) % n)], bz = r[2 * ((i + 1) % n) + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 1e-6) return null;
    const nx = (bz - az) / l, nz = -(bx - ax) / l; // inward normal for an outer ring
    lines.push([ax + nx * d, az + nz * d, (bx - ax) / l, (bz - az) / l]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const [px, pz, ux, uz] = lines[(i + n - 1) % n], [qx, qz, vx, vz] = lines[i];
    const den = ux * vz - uz * vx;
    if (Math.abs(den) < 1e-4) { out.push(qx, qz); continue; } // straight through
    const t = ((qx - px) * vz - (qz - pz) * vx) / den;
    out.push(px + ux * t, pz + uz * t);
  }
  // Every edge must keep its direction and the ring its winding; a long mitre spike also means collapse.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ex = out[2 * j] - out[2 * i], ez = out[2 * j + 1] - out[2 * i + 1];
    if (ex * lines[i][2] + ez * lines[i][3] <= .05) return null;
    if (Math.hypot(out[2 * i] - r[2 * i], out[2 * i + 1] - r[2 * i + 1]) > Math.abs(d) * 4 + .01) return null;
  }
  if (Math.sign(signedArea(out)) !== Math.sign(signedArea(r))) return null;
  return out;
}

// Minimum-area oriented rectangle: centre, half-sizes and the long-axis direction.
export function obb(r) {
  let best = null;
  edges(r, (ax, az, bx, bz, l) => {
    if (l < .5) return;
    const ux = (bx - ax) / l, uz = (bz - az) / l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      const a = r[i] * ux + r[i + 1] * uz, b = -r[i] * uz + r[i + 1] * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const A = (a1 - a0) * (b1 - b0);
    if (!best || A < best.A) best = { A, ux, uz, a0, a1, b0, b1 };
  });
  if (!best) return null;
  let { ux, uz, a0, a1, b0, b1 } = best;
  if (b1 - b0 > a1 - a0) { [ux, uz] = [-uz, ux]; [a0, a1, b0, b1] = [b0, b1, -a1, -a0]; } // long axis first
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  return { cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, hl: (a1 - a0) / 2, hw: (b1 - b0) / 2, ux, uz, area: best.A };
}

// Triangulates a polygon with holes (flat [x, z] rings) into [x, z] triples.
export function triangulate(rings) {
  const pts = rings.map(r => { const a = []; for (let i = 0; i < r.length; i += 2) a.push(new THREE.Vector2(r[i], r[i + 1])); return a; });
  const all = pts.flat();
  return THREE.ShapeUtils.triangulateShape(pts[0], pts.slice(1)).map(t => t.map(i => [all[i].x, all[i].y]));
}

// ---------- occupancy grid: 1 m cells over the map ----------
export const OCC = { building: 1, road: 2, zone: 4, keepClear: 8, decor: 16, water: 32, sidewalk: 64, lot: 128 };
export class Grid {
  constructor(ext, cell = 1) {
    this.ext = ext; this.cell = cell; this.n = Math.ceil(2 * ext / cell); this.bits = new Uint8Array(this.n * this.n);
  }
  idx(x, z) {
    const i = Math.floor((x + this.ext) / this.cell), j = Math.floor((z + this.ext) / this.cell);
    return i >= 0 && j >= 0 && i < this.n && j < this.n ? j * this.n + i : -1;
  }
  at(x, z) { const k = this.idx(x, z); return k < 0 ? 255 : this.bits[k]; }
  set(x, z, bit) { const k = this.idx(x, z); if (k >= 0) this.bits[k] |= bit; }
  // Marks cells whose centres pass test (default: all) inside the box.
  fill(x0, z0, x1, z1, bit, test) {
    const c = this.cell, i0 = Math.max(0, Math.floor((x0 + this.ext) / c)), i1 = Math.min(this.n - 1, Math.floor((x1 + this.ext) / c));
    const j0 = Math.max(0, Math.floor((z0 + this.ext) / c)), j1 = Math.min(this.n - 1, Math.floor((z1 + this.ext) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!test || test((i + .5) * c - this.ext, (j + .5) * c - this.ext)) this.bits[j * this.n + i] |= bit;
    }
  }
  fillRing(r, bit) { const [x0, z0, x1, z1] = bounds(r); this.fill(x0, z0, x1, z1, bit, (x, z) => inside(r, x, z)); }
  // Marks a band of half-width w along a polyline.
  fillLine(r, w, bit) {
    for (let i = 0; i + 2 < r.length; i += 2) {
      const ax = r[i], az = r[i + 1], l = Math.hypot(r[i + 2] - ax, r[i + 3] - az), ux = (r[i + 2] - ax) / l, uz = (r[i + 3] - az) / l;
      for (let s = 0; s <= l; s += this.cell * .7) for (let o = -w; o <= w; o += this.cell * .7) this.set(ax + ux * s - uz * o, az + uz * s + ux * o, bit);
    }
  }
  // True when every cell in a disc of radius rad avoids the mask.
  clear(x, z, rad, mask) {
    for (let dz = -rad; dz <= rad; dz += this.cell) for (let dx = -rad; dx <= rad; dx += this.cell) {
      if (dx * dx + dz * dz <= rad * rad && this.at(x + dx, z + dz) & mask) return false;
    }
    return true;
  }
}

export const chunkKey = (x, z, size) => `${Math.floor(x / size)},${Math.floor(z / size)}`;
