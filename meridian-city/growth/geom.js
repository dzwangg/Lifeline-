// Geometry for the growth planner: polylines walked by arc length, oriented rectangles, and a local raster that answers
// "may something be built here?" in O(1). Pure: no DOM, no THREE.
import { inside, bounds } from '../world/rings.js';

// The occupancy grid's bits (world/geometry.js OCC; repeated here because that module loads THREE).
export const OCC = { building: 1, road: 2, zone: 4, keepClear: 8, decor: 16, water: 32, sidewalk: 64, lot: 128 };
// Drivable classes with sidewalks (world/streets.js DRIVE). Trunk roads take frontage only for apartments and never a
// new junction.
export const DRIVE = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
export const TRUNK = new Set(['trunk', 'trunk_link']);
export const SIDEWALK_W = 2.2; // world/streets.js SIDEWALK_W

// FNV-1a of a string: the seed for every choice the planner makes, so plans never depend on build order.
export function hashStr(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ h >>> 15, 0x2c1b3c6d); h = Math.imul(h ^ h >>> 12, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** h(k) -> [0, 1): the k-th independent draw for a key. */
export const hasher = key => k => hashStr(`${key}#${k}`);

/** A polyline [x, z, ...] walked by arc length. */
export class Line {
  constructor(r) {
    this.r = r; this.cum = [0];
    for (let i = 0; i + 2 < r.length; i += 2) this.cum.push(this.cum.at(-1) + Math.hypot(r[i + 2] - r[i], r[i + 3] - r[i + 1]));
    this.len = this.cum.at(-1);
  }
  /** Point and unit tangent at arc length s (clamped). */
  at(s) {
    const { r, cum } = this;
    s = Math.min(this.len, Math.max(0, s));
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const l = cum[i + 1] - cum[i] || 1, t = (s - cum[i]) / l, ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * i + 2], bz = r[2 * i + 3];
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, ux: (bx - ax) / l, uz: (bz - az) / l };
  }
  /** Nearest point: { s, d (distance), x, z, ux, uz }. */
  project(x, z) {
    const { r, cum } = this;
    let best = null;
    for (let i = 0; i + 2 < r.length; i += 2) {
      const ax = r[i], az = r[i + 1], dx = r[i + 2] - ax, dz = r[i + 3] - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) { const l = Math.sqrt(l2); best = { s: cum[i / 2] + t * l, d, x: px, z: pz, ux: dx / l, uz: dz / l }; }
    }
    return best;
  }
}
// Left of travel along (ux, uz), in the map's x-east, z-south frame (world/streets.js normals()).
export const leftOf = (ux, uz) => [uz, -ux];

/** An oriented rectangle: centre, unit axis u (width along it), half-width hw and half-depth hd along v = leftOf-rotated u. */
export const orect = (cx, cz, ux, uz, hw, hd) => ({ cx, cz, ux, uz, hw, hd });
export function inRect(o, x, z, pad = 0) {
  const dx = x - o.cx, dz = z - o.cz, a = dx * o.ux + dz * o.uz, b = -dx * o.uz + dz * o.ux;
  return Math.abs(a) <= o.hw + pad && Math.abs(b) <= o.hd + pad;
}
/** Calls f(x, z) at points spaced about `step` over the rectangle (edges included). Stops early when f returns false. */
export function sampleRect(o, step, f) {
  const na = Math.max(1, Math.ceil(2 * o.hw / step)), nb = Math.max(1, Math.ceil(2 * o.hd / step));
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
    const a = -o.hw + 2 * o.hw * i / na, b = -o.hd + 2 * o.hd * j / nb;
    if (f(o.cx + o.ux * a - o.uz * b, o.cz + o.uz * a + o.ux * b) === false) return false;
  }
  return true;
}
/** The rectangle's corners as a ring. */
export function rectRing(o) {
  const c = (a, b) => [o.cx + o.ux * a - o.uz * b, o.cz + o.uz * a + o.ux * b];
  return [...c(-o.hw, -o.hd), ...c(o.hw, -o.hd), ...c(o.hw, o.hd), ...c(-o.hw, o.hd)];
}

// A 1 m raster over a box: per cell, whether it is inside the region's rings, and the occupancy bits there. Lookups
// outside the box read as outside and fully occupied.
export class Raster {
  constructor(box, rings, occ) {
    const [x0, z0, x1, z1] = box;
    this.x0 = Math.floor(x0); this.z0 = Math.floor(z0);
    this.w = Math.ceil(x1) - this.x0 + 1; this.h = Math.ceil(z1) - this.z0 + 1;
    this.inside = new Uint8Array(this.w * this.h); // index into rings + 1, or 0
    this.occ = new Uint8Array(this.w * this.h);
    this.mark = new Uint8Array(this.w * this.h); // the planner's own claims (footprints, paths, streets)
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = this.x0 + i + .5, z = this.z0 + j + .5;
      this.occ[j * this.w + i] = occ(x, z);
    }
    rings.forEach((ring, k) => {
      const [rx0, rz0, rx1, rz1] = bounds(ring);
      for (let z = Math.floor(rz0); z <= rz1; z++) for (let x = Math.floor(rx0); x <= rx1; x++) {
        const c = this.idx(x + .5, z + .5);
        if (c >= 0 && inside(ring, x + .5, z + .5)) this.inside[c] = k + 1;
      }
    });
  }
  idx(x, z) {
    const i = Math.floor(x) - this.x0, j = Math.floor(z) - this.z0;
    return i >= 0 && j >= 0 && i < this.w && j < this.h ? j * this.w + i : -1;
  }
  /** The same land with none of the planner's claims (the land is shared, not copied). */
  fresh() { return Object.assign(Object.create(Raster.prototype), this, { mark: new Uint8Array(this.w * this.h) }); }
  in(x, z) { const c = this.idx(x, z); return c < 0 ? 0 : this.inside[c]; }
  bits(x, z) { const c = this.idx(x, z); return c < 0 ? 255 : this.occ[c]; }
  marked(x, z) { const c = this.idx(x, z); return c < 0 ? 255 : this.mark[c]; }
  claim(o, bit = 1, pad = 0) { sampleRect({ ...o, hw: o.hw + pad, hd: o.hd + pad }, .5, (x, z) => { const c = this.idx(x, z); if (c >= 0) this.mark[c] |= bit; }); }
}

/** Distance from a point to a segment. */
export function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
