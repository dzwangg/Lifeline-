// Geometry helpers shared by every layer: merged-mesh batches, footprint rings, and the occupancy grid
// that keeps decorations off roads, buildings and entrances.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { bounds } from './rings.js';

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

// Ring helpers live in rings.js (no THREE, so node tests can use them); re-exported here for the world's modules.
export { edges, inside, bounds, signedArea, area, centroid, simplify, inset, obb } from './rings.js';

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
  // Marks the cells whose centres lie inside ring r: the cells inside() picks, found a row at a time from where the ring
  // crosses each row's centre line (even-odd), rather than testing every cell of the bounding box.
  fillRing(r, bit) {
    const [, z0, , z1] = bounds(r), { cell: c, ext, n } = this, xs = [];
    const j0 = Math.max(0, Math.floor((z0 + ext) / c)), j1 = Math.min(n - 1, Math.floor((z1 + ext) / c));
    for (let j = j0; j <= j1; j++) {
      const z = (j + .5) * c - ext;
      xs.length = 0;
      for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2)
        if ((r[i + 1] > z) !== (r[k + 1] > z)) xs.push((r[k] - r[i]) * (z - r[i + 1]) / (r[k + 1] - r[i + 1]) + r[i]);
      xs.sort((a, b) => a - b);
      for (let m = 0; m + 1 < xs.length; m += 2) { // centres with xs[m] <= x < xs[m + 1]
        const a = Math.max(0, Math.ceil((xs[m] + ext) / c - .5)), b = Math.min(n - 1, Math.ceil((xs[m + 1] + ext) / c - .5) - 1);
        for (let i = a; i <= b; i++) this.bits[j * n + i] |= bit;
      }
    }
  }
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

// Folds small static meshes into one mesh per material, render state and area, so scenery built from many little
// parts (bridge struts, hub fixtures, parking pads) costs a few draw calls instead of hundreds when zoomed out.
// Leaves alone: instanced meshes, multi-material meshes, anything under a `keep` object (animated or switched by level
// of detail), meshes with userData (picking owners, detail flags), and meshes wider than maxRadius metres (already
// chunked, so culling stays useful). area: the side, in metres, of the squares that bound each merged mesh.
export function mergeStatic(root, { keep = new Set(), maxRadius = 120, area = 700 } = {}) {
  root.updateMatrixWorld(true);
  const buckets = new Map(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || !o.visible) return;
    if (Object.keys(o.userData).length || o.geometry.morphAttributes.position) return; // (geometry groups only matter with a material array)
    for (let p = o; p; p = p.parent) if (keep.has(p) || (p !== o && !p.visible)) return;
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    o.matrixWorld.decompose(pos, new THREE.Quaternion(), scale);
    if (g.boundingSphere.radius * Math.max(scale.x, scale.y, scale.z) > maxRadius) return;
    pos.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const attrs = Object.entries(g.attributes).map(([k, a]) => `${k}${a.itemSize}${a.normalized ? 'n' : ''}`).sort().join(',');
    const key = [o.material.uuid, attrs, !!g.index, o.castShadow, o.receiveShadow, o.renderOrder, o.layers.mask, o.frustumCulled, chunkKey(pos.x, pos.z, area)].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  let merged = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const a = list[0], names = Object.keys(a.geometry.attributes), out = {}, idx = [];
    for (const n of names) out[n] = [];
    let base = 0;
    for (const o of list) {
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld); // normals follow through the normal matrix
      for (const n of names) out[n].push(g.attributes[n].array);
      if (g.index) for (const i of g.index.array) idx.push(i + base);
      base += g.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    for (const n of names) {
      const src = a.geometry.attributes[n], arr = new src.array.constructor(out[n].reduce((s, x) => s + x.length, 0));
      let at = 0; for (const x of out[n]) { arr.set(x, at); at += x.length; }
      geo.setAttribute(n, new THREE.BufferAttribute(arr, src.itemSize, src.normalized));
    }
    if (idx.length) geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, a.material);
    Object.assign(m, { castShadow: a.castShadow, receiveShadow: a.receiveShadow, renderOrder: a.renderOrder, frustumCulled: a.frustumCulled, name: `merged ${a.name || a.parent?.name || ''}`.trim() });
    m.layers.mask = a.layers.mask;
    for (const o of list) o.removeFromParent();
    root.add(m);
    merged += list.length - 1;
  }
  return merged; // draw calls saved
}
