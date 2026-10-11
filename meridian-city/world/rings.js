// Pure helpers for footprint rings (flat [x, z, x, z, ...] loops), with no THREE dependency, so the growth planner
// (growth/) can use them under node --test. geometry.js re-exports them.
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

