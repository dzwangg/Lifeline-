// Keeps planting out of buildings. A tree is a camera-facing card as wide as its crown, so whichever way the camera
// turns, the card reaches the crown's radius round the trunk: it fits where its trunk stands TRUNK_CLEAR from every
// footprint and its crown CROWN_CLEAR, unless the building is low enough to pass under the crown. Footprints are kept
// in a spatial hash, so a check only looks at the buildings near it. Pure: no DOM, no THREE.
import { CAMERA } from './palette.js';

export const TRUNK_CLEAR = 1; // metres from a trunk (or a shrub's stem) to any wall
export const CROWN_CLEAR = .5; // metres from a tree's drawn crown to a wall or roof
export const CROWN_SHARE = .45; // a sprite's drawn crown radius, as a share of its width (round crowns fill ~90% of it)
const STRETCH = 1 / Math.cos(CAMERA.elevationDeg * Math.PI / 180); // billboards are drawn this much taller (sprites.js)
const BIG = 4; // sprites taller than this (metres) are trees, kept CROWN_CLEAR off walls; smaller plants just off them

/**
 * A sprite's crown at a scale: r, its radius in metres; base, the height its crown starts at (sprite-art.js trees carry
 * crownBase; other sprites are crown to the ground).
 */
export function crownOf(sprite, scale = 1) {
  return { r: sprite.w * scale * CROWN_SHARE, base: (sprite.crownBase ?? 0) * scale * STRETCH, big: sprite.h * scale > BIG };
}

/** Signed distance from (x, z) to a ring [x0, z0, x1, z1, ...]: negative inside. */
export function ringDist(r, x, z) {
  let d = Infinity, ins = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], dx = r[i] - ax, dz = r[i + 1] - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
    if ((az > z) !== (r[i + 1] > z) && x < dx * (z - az) / dz + ax) ins = !ins;
  }
  return ins ? -d : d;
}

/** Building footprints in a spatial hash. add() them, then ask whether a sprite fits(). */
export class Footprints {
  constructor(cell = 32) {
    this.cell = cell; this.cells = new Map(); this.list = []; this.stamp = 0; this.seen = new Uint32Array(64);
  }
  /** ring: [x0, z0, ...]; height: its top in metres (Infinity when not yet known). */
  add(ring, height = Infinity) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
    const k = this.list.length, c = this.cell;
    this.list.push({ ring, height, box: [x0, z0, x1, z1] });
    if (k >= this.seen.length) { const s = new Uint32Array(this.seen.length * 2); s.set(this.seen); this.seen = s; }
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const key = `${i},${j}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(k);
    }
  }
  /** True when a crown of radius r starting base metres up (crownOf()) at (x, z) clears every footprint. */
  clear(x, z, { r, base = 0, big = true }) {
    const reach = Math.max(TRUNK_CLEAR, r + (big ? CROWN_CLEAR : 0)), c = this.cell, st = ++this.stamp;
    for (let i = Math.floor((x - reach) / c); i <= Math.floor((x + reach) / c); i++) for (let j = Math.floor((z - reach) / c); j <= Math.floor((z + reach) / c); j++) {
      for (const k of this.cells.get(`${i},${j}`) ?? []) {
        if (this.seen[k] === st) continue;
        this.seen[k] = st;
        const f = this.list[k], [x0, z0, x1, z1] = f.box;
        if (x < x0 - reach || x > x1 + reach || z < z0 - reach || z > z1 + reach) continue;
        const d = ringDist(f.ring, x, z);
        if (d < TRUNK_CLEAR) return false;
        if (d < reach && f.height > base - CROWN_CLEAR) return false; // under the crown only if well below it
      }
    }
    return true;
  }
  /** Whether sprite (an atlas entry) at scale fits at (x, z). */
  fits(x, z, sprite, scale = 1) { return this.clear(x, z, crownOf(sprite, scale)); }
  /**
   * The largest scale from scale down to min (in steps of 10%) at which sprite fits at (x, z), or 0 if none does: a tree
   * near a wall is drawn smaller rather than through it.
   */
  fitScale(x, z, sprite, scale, min = scale) {
    for (let s = scale; s >= min - 1e-9; s *= .9) if (this.fits(x, z, sprite, s)) return s;
    return 0;
  }
}
