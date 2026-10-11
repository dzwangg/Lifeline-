// Local streets for a site whose land is too far from any street to build on. Streets grow toward the unserved land one
// at a time: each leaves an existing road (or an earlier new street) at a right angle, at least 25 m from any junction,
// runs straight through the woods while its corridor is clear, and ends in a turning circle, never against a wall or in
// another road. A street that wouldn't serve new land isn't built. Planned once per site, so every parcel in a wood
// shares the same streets, and built whole the first time a parcel needs one (no stub ends).
// Pure: no DOM, no THREE.
import { bounds } from '../world/rings.js';
import { OCC, TRUNK, SIDEWALK_W, Line, Raster, leftOf, segDist } from './geom.js';

export const STREET = {
  half: 3, sw: 2,        // a 6 m living street with 2 m sidewalks
  bulb: 8.5,             // turning circle radius (asphalt); its sidewalk ring adds sw
  serve: 34,             // land within this of a street's edge can be built on
  fromJunction: 25,      // a new street meets its parent at least this far from any junction
  spacing: 34,           // and this far from another new street's mouth
  parallel: 56,          // parallel new streets are at least this far apart: room for a lot each side of each
  maxLen: 220, maxStreets: 10,
};
const CORRIDOR = STREET.half + STREET.sw; // half-width a street claims
const STEP = 1.5, LATTICE = 6;

/**
 * @param {object} o
 * @param {object} o.ctx siteContext()
 * @param {{id: string, ring: number[], state: string}[]} o.parcels the site's parcels
 * @param {(x: number, z: number) => number} o.occ occupancy bits (world.grid.at), without anything growth has drawn
 * @param {Set<string>} [o.blocked] ids of protected parcels: no street may cross them
 * @param {Set<string> | null} [o.targets] ids of the parcels that need serving (those a forecast builds on); null for
 *   all. Streets may still cross the site's other open parcels to reach them.
 * @returns {{streets: object[], samples: number, unserved: number}}
 */
export function planSiteStreets({ ctx, parcels, occ, blocked = new Set(), targets = null }) {
  const open = parcels.filter(p => !blocked.has(p.id));
  if (!open.length) return { streets: [], samples: 0, unserved: 0 };
  const [x0, z0, x1, z1] = ctx.box, M = 90;
  const R = new Raster([x0 - M, z0 - M, x1 + M, z1 + M], open.map(p => p.ring), occ);
  const parking = parcels.every(p => p.state === 'parking');
  const hard = OCC.building | OCC.water | OCC.keepClear | (parking ? 0 : OCC.lot);
  // May a street's corridor cover this point? crossing: the stretch where it crosses its parent's carriageway and sidewalk.
  const allowed = (x, z, crossing) => {
    const b = R.bits(x, z);
    if (b === 255 || b & hard) return false;
    if (b & OCC.zone && !R.in(x, z)) return false; // another site's parcel, or a protected one
    if (crossing) return true; // over the parent street, which may be a new street's claimed corridor
    return !(b & OCC.road) && !(R.marked(x, z) & 2);
  };

  // The network streets can leave from: drivable roads (not trunk roads) and the new streets as they are accepted.
  const net = ctx.lines.filter(L => !TRUNK.has(L.cls)).map((L, i) => ({ kind: 'road', index: ctx.lines.indexOf(L), line: L.line, half: L.half, sw: L.sw, k: i }));
  const streets = [], mouths = [];

  // The land to serve: a lattice over the open parcels; need marks the parcels the forecast builds on.
  const samples = [];
  for (const p of open) {
    const [a, b, c, d] = bounds(p.ring), need = !targets || targets.has(p.id);
    for (let x = Math.floor(a / LATTICE) * LATTICE + LATTICE / 2; x < c; x += LATTICE) for (let z = Math.floor(b / LATTICE) * LATTICE + LATTICE / 2; z < d; z += LATTICE) {
      if (!R.in(x, z) || R.bits(x, z) & (hard | OCC.road)) continue;
      samples.push({ x, z, dist: Infinity, dead: false, need });
    }
  }
  let wanted = () => true; // the samples the current phase serves
  const reach = (s, N) => N.line.project(s.x, s.z).d - N.half;
  for (const s of samples) for (const N of net) s.dist = Math.min(s.dist, reach(s, N));
  const served = s => s.dist <= STREET.serve;

  // The site's grain: new streets run into the site square to the roads along it (length-weighted over the roads within
  // 40 m), so its cul-de-sacs come out parallel, whatever the bends of the road they leave.
  let sxx = 0, sxz = 0, szz = 0;
  for (const N of net) for (let i = 0; i + 3 < N.line.r.length; i += 2) {
    const [ax, az, bx, bz] = N.line.r.slice(i, i + 4), l = Math.hypot(bx - ax, bz - az);
    if (!l || !samples.some(sm => segDist(sm.x, sm.z, ax, az, bx, bz) < 40)) continue;
    sxx += (bx - ax) ** 2 / l; sxz += (bx - ax) * (bz - az) / l; szz += (bz - az) ** 2 / l;
  }
  const grain = Math.atan2(2 * sxz, sxx - szz) / 2, D = leftOf(Math.cos(grain), Math.sin(grain)); // across the roads

  // The site's streets, then (with targets) more for the land the forecast builds on that those leave unserved, so
  // giving a forecast's parcels their access never moves a street another parcel already fronts.
  for (const phase of targets ? [0, 1] : [0]) {
    if (phase) { wanted = s => s.need; for (const s of samples) s.dead = false; }
    for (let guard = 0, made = 0; made < STREET.maxStreets && guard < 60; guard++) {
      const todo = samples.filter(s => !served(s) && !s.dead && wanted(s));
      if (todo.length < 3) break;
      if (grow(todo)) made++;
    }
  }

  // One street toward the nearest unserved sample of todo, if any can reach it; false if none.
  function grow(todo) {
    const target = todo.reduce((a, b) => (b.dist < a.dist || (b.dist === a.dist && (b.x < a.x || (b.x === a.x && b.z < a.z))) ? b : a));
    let best = null;
    for (const N of net) {
      // Off a road: where the line through the target along the site's grain meets it. Off a new street: square to it.
      // (or square to the grain, where the roads around a site run both ways).
      for (const dir of N.kind === 'road' ? [D, [-D[1], D[0]]] : [null]) {
        let p = null;
        if (dir) {
          for (const sg of [-1, 1]) for (let t = 0; t < 170 && !p; t += 1) {
            const x = target.x + sg * dir[0] * t, z = target.z + sg * dir[1] * t;
            if (R.bits(x, z) & OCC.road) { const q = N.line.project(x, z); if (q.d < N.half + 1) p = q; }
          }
        } else p = N.line.project(target.x, target.z);
        if (!p) continue;
        for (const ds of [0, -10, 10, -20, 20]) {
          const c = tryStreet(N, p.s + ds, target, dir);
          if (c && (!best || c.gain > best.gain || (c.gain === best.gain && c.len < best.len))) best = c;
        }
      }
    }
    if (!best) { target.dead = true; return false; }
    accept(best);
    return true;
  }

  function tryStreet(N, s, target, dir) {
    if (s < 0 || s > N.line.len) return null;
    const A = N.line.at(s);
    if (N.kind === 'road') {
      if (s < 15 || s > N.line.len - 15) return null;
      if (ctx.junctions.some(([jx, jz]) => Math.hypot(jx - A.x, jz - A.z) < STREET.fromJunction)) return null;
    } else if (s < 14 || s > N.line.len - STREET.bulb - 6) return null; // clear of its mouth and turning circle
    if (mouths.some(([mx, mz]) => Math.hypot(mx - A.x, mz - A.z) < STREET.spacing)) return null;
    let [dx, dz] = dir ?? leftOf(A.ux, A.uz);
    if (dx * (target.x - A.x) + dz * (target.z - A.z) < 0) { dx = -dx; dz = -dz; }
    const [lx, lz] = leftOf(A.ux, A.uz);
    if (Math.abs(lx * dx + lz * dz) < .8) return null; // meets its parent within about 37 degrees of square
    // Parallel streets keep two lot depths apart, so both get lots on both sides.
    for (const o of streets) {
      const ox = (o.r[2] - o.r[0]) / o.len, oz = (o.r[3] - o.r[1]) / o.len;
      if (Math.abs(ox * dx + oz * dz) < .9) continue;
      const sep = Math.abs((A.x - o.r[0]) * -oz + (A.z - o.r[1]) * ox);
      if (sep < STREET.parallel) return null;
    }
    // A road must really be there (not a bridge over the woods): its asphalt at the mouth.
    if (N.kind === 'road' && !(R.bits(A.x, A.z) & OCC.road)) return null;
    const cross = N.half + N.sw + .5;
    let end = 0, entered = -1, lastIn = -1;
    for (let t = STEP; t <= STREET.maxLen; t += STEP) {
      const x = A.x + dx * t, z = A.z + dz * t, crossing = t < cross;
      let ok = true;
      for (let o = -CORRIDOR; o <= CORRIDOR && ok; o += 1.25) ok = allowed(x - dz * o, z + dx * o, crossing);
      if (!ok) break;
      end = t;
      if (R.in(x, z)) { if (entered < 0) entered = t; lastIn = t; }
      else if (entered >= 0 && t - lastIn > 8) break; // out the far side of the site
    }
    if (entered < 0) return null;
    end = Math.min(end, lastIn + 4);
    // The turning circle at the far end, pulled back until it fits.
    const R2 = STREET.bulb + STREET.sw;
    let e = end - R2 * .4;
    const discClear = (cx, cz) => {
      for (let a = 0; a < 16; a++) for (const r of [R2 * .5, R2]) if (!allowed(cx + Math.cos(a * Math.PI / 8) * r, cz + Math.sin(a * Math.PI / 8) * r, false)) return false;
      return allowed(cx, cz, false);
    };
    while (e - entered >= 16 && !discClear(A.x + dx * e, A.z + dz * e)) e -= 2;
    if (e - entered < 16 || e < cross + 12) return null;
    const C = [A.x + dx * e, A.z + dz * e];
    let gain = 0;
    for (const sm of samples) if (!served(sm) && wanted(sm) && segDist(sm.x, sm.z, A.x, A.z, C[0], C[1]) - STREET.half <= STREET.serve) gain++;
    if (gain < 3) return null;
    return { N, s, A: [A.x, A.z], C, len: e, gain };
  }

  function accept({ N, s, A, C, len }) {
    const line = new Line([A[0], A[1], C[0], C[1]]);
    const street = {
      index: streets.length, parent: { kind: N.kind, index: N.kind === 'road' ? N.index : N.street, s },
      r: [A[0], A[1], C[0], C[1]], len, half: STREET.half, sw: STREET.sw, bulb: STREET.bulb, line,
      mouth: N.half + N.sw, // where its sidewalks start: the parent's kerb line
    };
    streets.push(street);
    mouths.push(A);
    // Claim its corridor and turning circle, so later streets and lots keep off them.
    const ux = (C[0] - A[0]) / len, uz = (C[1] - A[1]) / len;
    R.claim({ cx: (A[0] + C[0]) / 2, cz: (A[1] + C[1]) / 2, ux, uz, hw: len / 2, hd: CORRIDOR }, 2);
    R.claim({ cx: C[0], cz: C[1], ux, uz, hw: STREET.bulb + STREET.sw, hd: STREET.bulb + STREET.sw }, 2);
    const N2 = { kind: 'street', street: street.index, line, half: STREET.half, sw: STREET.sw };
    net.push(N2);
    for (const sm of samples) sm.dist = Math.min(sm.dist, reach(sm, N2), Math.hypot(sm.x - C[0], sm.z - C[1]) - STREET.bulb);
  }

  return { streets, samples: samples.length, unserved: samples.filter(s => !served(s)).length };
}

/** The streets a street depends on to reach the city: itself, its parent street, and so on. */
export function streetChain(streets, i) {
  const out = [];
  for (let k = i; k != null && k >= 0; k = streets[k].parent.kind === 'street' ? streets[k].parent.index : null) out.push(k);
  return out;
}
