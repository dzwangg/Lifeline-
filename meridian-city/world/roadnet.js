// The street network as traffic sees it, built from the OSM road polylines. Pure data (no three.js), so the
// rules can be tested in Node.
//
// Roads become edges between nodes; nodes where three or more edges meet are junctions, and junctions joined
// by very short edges (divided roads, offset T's) merge into one intersection. Each edge carries one lane per
// direction, kept to the right. A lane stops at a stop line just before the crosswalk at each intersection;
// movements are the curved paths across the intersection from an incoming lane to an outgoing one, with the
// movements whose paths cross precomputed as conflicts. Busy intersections (two or more major arms) get
// signals that split their arms into two phase groups along their dominant axes.
//
// The walking network follows sidewalks on both sides of every street, joined at street corners, crosswalks
// across each arm of every intersection, and footpaths cut wherever they would run over a road or into a
// building, so walkers can only reach the roadway at crosswalks.

export const MAJOR_CLS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const CW_HALF = 1.2;          // half the crosswalk width (m), matching the painted zebras in streets.js
const CW_AT = .8;             // crosswalk centre beyond the junction radius
const STOP_AT = CW_AT + CW_HALF + .4; // stop line beyond the junction radius, just before the crosswalk
const SIDEWALK_OFF = 1.1;     // sidewalk centre beyond the kerb (half of streets.js's 2.2 m sidewalk)

// ---------- polyline paths ----------
export class Path {
  constructor(pts) {
    this.pts = pts;
    const n = pts.length / 2;
    this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    this.len = this.cum[n - 1];
  }
  // Point and unit tangent at distance s (clamped), written into o = { x, z, ux, uz }.
  at(s, o = {}) {
    const { pts, cum } = this, n = cum.length;
    if (s <= 0) s = 0; else if (s >= this.len) s = this.len;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const l = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / l;
    const ax = pts[2 * lo], az = pts[2 * lo + 1], bx = pts[2 * hi], bz = pts[2 * hi + 1];
    o.x = ax + (bx - ax) * t; o.z = az + (bz - az) * t; o.ux = (bx - ax) / l; o.uz = (bz - az) / l;
    return o;
  }
}

// Offsets a polyline sideways with mitred joints; o > 0 moves it to the right of travel.
// Right of travel (ux, uz) is (-uz, ux) in this world's x/z.
export function offsetLine(pts, o) {
  const n = pts.length / 2, out = new Array(pts.length);
  const dir = i => { const dx = pts[2 * i + 2] - pts[2 * i], dz = pts[2 * i + 3] - pts[2 * i + 1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  for (let i = 0; i < n; i++) {
    const [ax, az] = dir(Math.max(0, i - 1)), [bx, bz] = dir(Math.min(n - 2, i));
    let tx = ax + bx, tz = az + bz; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const k = 1 / Math.max(.5, tx * bx + tz * bz);
    out[2 * i] = pts[2 * i] - tz * k * o; out[2 * i + 1] = pts[2 * i + 1] + tx * k * o;
  }
  return out;
}

const reversePts = pts => { const out = []; for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]); return out; };
function dedupe(pts) {
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) if (Math.hypot(pts[i] - out[out.length - 2], pts[i + 1] - out[out.length - 1]) > .05) out.push(pts[i], pts[i + 1]);
  return out;
}
// Part of a polyline between distances s0 and s1.
function slice(path, s0, s1) {
  const out = [], a = path.at(s0), b = path.at(s1);
  out.push(a.x, a.z);
  for (let i = 1; i < path.cum.length - 1; i++) if (path.cum[i] > s0 && path.cum[i] < s1) out.push(path.pts[2 * i], path.pts[2 * i + 1]);
  out.push(b.x, b.z);
  return out;
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// Length, start (past the crosswalk) and stop line of a lane, from its path.
function fitLane(L) {
  L.len = L.path.len;
  L.s0 = L.fromNode.ix ? L.fromNode.t + STOP_AT : 0;
  L.stopS = L.toNode.ix ? L.len - L.toNode.t - STOP_AT : L.len;
  if (L.stopS < L.s0 + 1) { const m = Math.max(.5, Math.min(L.len - .5, (L.s0 + L.stopS) / 2)); L.s0 = Math.max(0, m - .5); L.stopS = Math.min(L.len, m + .5); }
}

// ---------- the driving network ----------
/**
 * @param {{cls: string, ow: number, w: number, r: number[]}[]} roads drivable roads only
 * @param {object} [o]
 * @param {(x: number, z: number) => boolean} [o.blocked] true where a crossing would hit a building
 */
export function buildRoadNet(roads, { clusterLen = 22, clusterSpan = 46, major = MAJOR_CLS } = {}) {
  const key = (x, z) => x + ',' + z;
  const vtx = new Map();
  roads.forEach((q, wi) => {
    const n = q.r.length / 2;
    for (let i = 0; i < n; i++) {
      const k = key(q.r[2 * i], q.r[2 * i + 1]);
      let v = vtx.get(k);
      if (!v) vtx.set(k, v = { deg: 0, ways: new Set() });
      v.deg += i === 0 || i === n - 1 ? 1 : 2; v.ways.add(wi);
    }
  });
  const splitsAt = v => v.deg !== 2 || v.ways.size > 1;

  const nodes = [], nodeByKey = new Map();
  const nodeAt = (x, z) => {
    const k = key(x, z);
    let n = nodeByKey.get(k);
    if (!n) { n = { id: nodes.length, x, z, ends: [], ix: null, t: 0 }; nodes.push(n); nodeByKey.set(k, n); }
    return n;
  };
  const edges = [];
  for (const q of roads) {
    const r = q.r, n = r.length / 2;
    let start = 0;
    for (let i = 1; i < n; i++) {
      if (i < n - 1 && !splitsAt(vtx.get(key(r[2 * i], r[2 * i + 1])))) continue;
      const pts = dedupe(r.slice(2 * start, 2 * i + 2));
      start = i;
      if (pts.length < 4) continue;
      const e = { id: edges.length, cls: q.cls, ow: q.ow || 0, w: q.w, major: major.has(q.cls), path: new Path(pts), a: nodeAt(pts[0], pts[1]), b: nodeAt(pts[pts.length - 2], pts[pts.length - 1]), internal: false, lanes: [] };
      e.len = e.path.len;
      e.a.ends.push({ e, end: 0 }); e.b.ends.push({ e, end: 1 });
      edges.push(e);
    }
  }
  // Junction radius, as streets.js uses for trimming kerbs and placing zebras.
  for (const n of nodes) n.t = n.ends.length >= 3 ? Math.max(...n.ends.map(({ e }) => e.w / 2)) + 1.5 : 0;
  const isJ = n => n.ends.length >= 3;

  // ---------- intersections: junctions merged across very short edges ----------
  const parent = new Map(), box = new Map();
  const find = n => { while (parent.get(n) !== n) { parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };
  for (const n of nodes) if (isJ(n)) { parent.set(n, n); box.set(n, [n.x, n.z, n.x, n.z]); }
  for (const e of [...edges].sort((p, q) => p.len - q.len)) {
    if (e.a === e.b || !isJ(e.a) || !isJ(e.b)) continue;
    if (e.len > Math.max(clusterLen, e.a.t + e.b.t + 2 * STOP_AT + 6)) continue;
    const ra = find(e.a), rb = find(e.b);
    if (ra === rb) continue;
    const A = box.get(ra), B = box.get(rb), U = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
    if (U[2] - U[0] > clusterSpan || U[3] - U[1] > clusterSpan) continue;
    parent.set(rb, ra); box.set(ra, U);
  }
  const intersections = [], ixByRoot = new Map();
  for (const n of nodes) {
    if (!isJ(n)) continue;
    const root = find(n);
    let ix = ixByRoot.get(root);
    if (!ix) { ix = { id: intersections.length, nodes: [], x: 0, z: 0, arms: [], movements: [], crosswalks: [], signal: null, lanesIn: [], lanesOut: [] }; intersections.push(ix); ixByRoot.set(root, ix); }
    ix.nodes.push(n); n.ix = ix;
  }
  for (const ix of intersections) { ix.x = ix.nodes.reduce((s, n) => s + n.x, 0) / ix.nodes.length; ix.z = ix.nodes.reduce((s, n) => s + n.z, 0) / ix.nodes.length; }
  for (const e of edges) e.internal = !!e.a.ix && e.a.ix === e.b.ix;

  // ---------- lanes ----------
  const lanes = [];
  for (const e of edges) {
    if (e.internal) continue;
    const dirs = e.ow ? [e.ow > 0 ? 1 : -1] : [1, -1], off = e.ow ? 0 : e.w / 4;
    for (const d of dirs) {
      const center = d > 0 ? e.path.pts : reversePts(e.path.pts);
      const path = new Path(offsetLine(center, off));
      const fromNode = d > 0 ? e.a : e.b, toNode = d > 0 ? e.b : e.a;
      const L = {
        id: lanes.length, edge: e, dir: d, path, len: path.len, fromNode, toNode, from: fromNode.ix, to: toNode.ix,
        s0: fromNode.ix ? fromNode.t + STOP_AT : 0, stopS: toNode.ix ? path.len - toNode.t - STOP_AT : path.len,
        cars: [], moves: [], next: [], reverse: null, reserved: 0, arm: null, outArm: null, priority: true, stopSign: false,
        speed: e.major ? 13 : e.cls === 'living_street' ? 5 : 9.5,
      };
      fitLane(L);
      e.lanes.push(L); lanes.push(L);
    }
    if (e.lanes.length === 2) { e.lanes[0].reverse = e.lanes[1]; e.lanes[1].reverse = e.lanes[0]; }
  }
  for (const L of lanes) { if (L.to) L.to.lanesIn.push(L); if (L.from) L.from.lanesOut.push(L); }
  // Lanes through plain nodes (a bend shared by two ways) and dead ends.
  for (const L of lanes) {
    if (L.to) continue;
    const outs = L.toNode.ends.flatMap(({ e }) => e.lanes.filter(o => o.fromNode === L.toNode && o.edge !== L.edge));
    L.next = outs;
  }
  // At a bend the two lanes' offset lines cross short of the node on the inside and fall short of it on the
  // outside (where the pavement has a notch). Round every bend with a short curve that starts before either
  // problem, so a car turning it never doubles back, jumps, or runs over the kerb.
  const feeds = new Map();
  for (const L of lanes) for (const T of L.next) feeds.set(T, (feeds.get(T) ?? 0) + 1);
  for (const L of lanes) {
    if (L.next.length !== 1) continue;
    const T = L.next[0];
    if (feeds.get(T) !== 1) continue;
    const p = L.path.pts, q = T.path.pts, n = p.length;
    const ax = p[n - 4], az = p[n - 3], bx = p[n - 2], bz = p[n - 1], cx = q[0], cz = q[1], dx = q[2], dz = q[3];
    const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz), den = ux * vz - uz * vx;
    if (Math.abs(den) < .05 * lu * lv && Math.hypot(cx - bx, cz - bz) < .3) continue; // straight on: nothing to round
    let dL = 0, dT = 0;
    if (Math.abs(den) > 1e-9) {
      const t = ((cx - ax) * vz - (cz - az) * vx) / den, u = ((cx - ax) * uz - (cz - az) * ux) / den;
      if (t < 1 && u > 0) { dL = (1 - t) * lu; dT = u * lv; } // inner side: back off to where the lines cross
    }
    const cut0 = Math.min(dL + 6, L.path.len * .4), cut1 = Math.min(dT + 6, T.path.len * .4);
    const A = L.path.at(L.path.len - cut0, {}), B = T.path.at(cut1, {}), k = Math.hypot(B.x - A.x, B.z - A.z) * .4;
    const curve = [];
    for (let i = 1; i <= 8; i++) {
      const s = i / 8, w = 1 - s, b0 = w * w * w, b1 = 3 * w * w * s, b2 = 3 * w * s * s, b3 = s * s * s;
      curve.push(b0 * A.x + b1 * (A.x + A.ux * k) + b2 * (B.x - B.ux * k) + b3 * B.x, b0 * A.z + b1 * (A.z + A.uz * k) + b2 * (B.z - B.uz * k) + b3 * B.z);
    }
    L.path = new Path(dedupe([...slice(L.path, 0, L.path.len - cut0), ...curve]));
    T.path = new Path(dedupe(slice(T.path, cut1, T.path.len)));
    fitLane(L); fitLane(T);
  }

  // ---------- arms, crosswalks and movements ----------
  const tmp = {};
  for (const ix of intersections) {
    for (const n of ix.nodes) for (const { e, end } of n.ends) {
      if (e.internal) continue;
      const sCw = Math.min(n.t + CW_AT, e.len / 2), p = e.path.at(end === 0 ? sCw : e.len - sCw);
      const ux = end === 0 ? p.ux : -p.ux, uz = end === 0 ? p.uz : -p.uz; // outward
      const arm = {
        ix, edge: e, node: n, end, t: n.t, w: e.w, major: e.major, ux, uz, cx: p.x, cz: p.z,
        angle: Math.atan2(p.z - ix.z, p.x - ix.x), group: 0,
        inLane: e.lanes.find(L => L.toNode === n) ?? null, outLane: e.lanes.find(L => L.fromNode === n) ?? null, crosswalk: null,
      };
      if (arm.inLane) arm.inLane.arm = arm;
      if (arm.outLane) arm.outLane.outArm = arm;
      ix.arms.push(arm);
    }
    ix.arms.sort((a, b) => a.angle - b.angle);
    for (const arm of ix.arms) { // crosswalk across the arm, kerb to kerb at the sidewalk centrelines
      const h = arm.w / 2 + SIDEWALK_OFF, rx = -arm.uz, rz = arm.ux; // right of outward
      const cw = { id: 0, ix, arm, ax: arm.cx - rx * h, az: arm.cz - rz * h, bx: arm.cx + rx * h, bz: arm.cz + rz * h, len: 2 * h, ux: arm.ux, uz: arm.uz, peds: new Set(), cars: new Set(), feeders: [], walk: 'WALK', signalized: false };
      arm.crosswalk = cw; ix.crosswalks.push(cw);
    }

    // Movements: every incoming lane to every outgoing lane on another arm.
    for (const A of ix.arms) {
      if (!A.inLane) continue;
      const options = ix.arms.filter(B => B.outLane && B !== A);
      const outs = options.length ? options : ix.arms.filter(B => B.outLane); // U-turn only when nothing else
      for (const B of outs) {
        const from = A.inLane, to = B.outLane;
        const p0 = from.path.at(from.stopS, {}), p3 = to.path.at(to.s0, {});
        // Path between the two lanes, tangent to both. A turn runs straight along the lane, rounds a fillet near
        // where the lane lines meet (tight for a right turn, wider for a left), then runs straight again, the way a
        // driver hugs the lane instead of sweeping over the corner kerb. Anything else is a smooth cubic.
        const d = Math.hypot(p3.x - p0.x, p3.z - p0.z), den = p0.ux * p3.uz - p0.uz * p3.ux;
        const cross0 = den, ang0 = Math.atan2(cross0, p0.ux * p3.ux + p0.uz * p3.uz);
        const cubic = (ax, az, aux, auz, bx, bz, bux, buz, k0, k1, n, out) => {
          for (let i = 0; i <= n; i++) {
            const t = i / n, u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
            out.push(b0 * ax + b1 * (ax + aux * k0) + b2 * (bx - bux * k1) + b3 * bx, b0 * az + b1 * (az + auz * k0) + b2 * (bz - buz * k1) + b3 * bz);
          }
        };
        const pts = [];
        let done = false;
        if (Math.abs(den) > .3) {
          const t0 = ((p3.x - p0.x) * p3.uz - (p3.z - p0.z) * p3.ux) / den, t1 = -((p3.x - p0.x) * p0.uz - (p3.z - p0.z) * p0.ux) / den; // p0 + u0 t0 = p3 - u3 t1
          if (t0 > 0 && t1 > 0 && t0 < d * 1.5 && t1 < d * 1.5) {
            const X = p0.x + p0.ux * t0, Z = p0.z + p0.uz * t0, half = Math.abs(ang0) / 2;
            const rad = ang0 > 0 ? 4.5 : 9; // right : left
            const T = Math.min(t0, t1, rad * Math.tan(half)), k = T * 4 / 3 * Math.tan(half / 2) / Math.tan(half); // circular-arc handle length
            const ax = X - p0.ux * T, az = Z - p0.uz * T, bx = X + p3.ux * T, bz = Z + p3.uz * T;
            pts.push(p0.x, p0.z);
            cubic(ax, az, p0.ux, p0.uz, bx, bz, p3.ux, p3.uz, k, k, 10, pts);
            pts.push(p3.x, p3.z);
            done = true;
          }
        }
        if (!done) cubic(p0.x, p0.z, p0.ux, p0.uz, p3.x, p3.z, p3.ux, p3.uz, d * .42, d * .42, 14, pts);
        const cross = p0.ux * p3.uz - p0.uz * p3.ux, dot = p0.ux * p3.ux + p0.uz * p3.uz, ang = Math.atan2(cross, dot);
        const m = {
          id: 0, ix, from, to, fromArm: A, toArm: B, path: new Path(dedupe(pts)), turn: A === B ? 'U' : ang > .5 ? 'R' : ang < -.5 ? 'L' : 'S',
          conflicts: [], cars: [], committed: new Set(), cwIn: A.crosswalk, cwOut: B.crosswalk, group: 0,
        };
        m.len = m.path.len;
        m.cwOutS = Math.max(0, m.len - (CW_AT + CW_HALF + .4) - .2); // where the outgoing crosswalk begins on the path
        from.moves.push(m); ix.movements.push(m);
      }
    }
    // Conflicts: paths from different approaches that share an exit or pass within a car's width.
    const ms = ix.movements;
    const samples = ms.map(m => { const out = []; for (let s = 0; s <= m.len; s += .8) { m.path.at(s, tmp); out.push(tmp.x, tmp.z); } return out; });
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i], b = ms[j];
      if (a.from === b.from) continue;
      let hit = a.to === b.to;
      const A = samples[i], B = samples[j];
      for (let p = 0; !hit && p < A.length; p += 2) for (let q = 0; q < B.length; q += 2) if ((A[p] - B[q]) ** 2 + (A[p + 1] - B[q + 1]) ** 2 < 2.6 * 2.6) { hit = true; break; }
      if (hit) { a.conflicts.push(b); b.conflicts.push(a); }
    }
    // Every crosswalk each movement's path actually passes over (in big or skewed junctions that can include another
    // arm's crosswalk), as the stretch of path [s0, s1] where a car's body is over it.
    for (const m of ms) {
      m.crossings = [];
      for (const cw of ix.crosswalks) {
        const ux = (cw.bx - cw.ax) / (cw.len || 1), uz = (cw.bz - cw.az) / (cw.len || 1);
        let s0 = Infinity, s1 = -Infinity;
        for (let s = 0; s <= m.len; s += .4) {
          m.path.at(s, tmp);
          const rx = tmp.x - cw.ax, rz = tmp.z - cw.az, along = rx * ux + rz * uz, across = rx * -uz + rz * ux;
          if (along > -1 && along < cw.len + 1 && Math.abs(across) < CW_HALF + 1.1) { s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
        }
        if (s1 >= s0) m.crossings.push({ cw, s0: Math.max(0, s0 - .2), s1: s1 + .2 });
      }
    }
    // Who feeds each crosswalk: lanes whose movements pass over it.
    for (const cw of ix.crosswalks) cw.feeders = ix.lanesIn.filter(L => L.moves.some(m => m.crossings.some(k => k.cw === cw)));

    // Priority at unsignalized junctions: major arms go first; minor arms that meet a major one stop.
    const anyMajor = ix.arms.some(a => a.major);
    for (const a of ix.arms) if (a.inLane) { a.inLane.priority = !anyMajor || a.major; a.inLane.stopSign = anyMajor && !a.major; }

    // Signals where two or more major arms meet at a real crossroads or T.
    const majors = ix.arms.filter(a => a.major).length;
    if (ix.arms.length >= 3 && majors >= 2 && ix.arms.filter(a => a.inLane).length >= 2) {
      let best = null;
      for (const cand of ix.arms) {
        const axis = cand.angle;
        let score = 0;
        const g = ix.arms.map(a => { const d = Math.abs(angDiff(a.angle, axis)), dd = Math.min(d, Math.PI - d); score += Math.abs(Math.cos(2 * dd)); return dd < Math.PI / 4 ? 0 : 1; });
        if (!g.includes(0) || !g.includes(1)) continue;
        if (!best || score > best.score) best = { score, g };
      }
      if (best) {
        ix.arms.forEach((a, i) => { a.group = best.g[i]; });
        const majorIn = g => ix.arms.filter(a => a.group === g && a.major).length;
        ix.signal = { mainGroup: majorIn(0) >= majorIn(1) ? 0 : 1 };
        for (const m of ix.movements) m.group = m.fromArm.group;
        for (const cw of ix.crosswalks) cw.signalized = true;
        for (const a of ix.arms) if (a.inLane) { a.inLane.priority = true; a.inLane.stopSign = false; }
      }
    }
  }
  intersections.flatMap(ix => ix.movements).forEach((m, i) => { m.id = i; });
  const crosswalks = intersections.flatMap(ix => ix.crosswalks);
  crosswalks.forEach((c, i) => { c.id = i; });
  return { nodes, edges, lanes, intersections, crosswalks };
}

// ---------- the walking network ----------
/**
 * @param net the driving network
 * @param {{cls: string, w: number, r: number[]}[]} paths footways, pedestrian streets, steps, tracks and paths
 * @param {object} o
 * @param {(x: number, z: number) => boolean} o.onRoad true on a carriageway cell
 * @param {(x: number, z: number) => boolean} o.inBuilding true inside a building
 */
export function buildWalkNet(net, paths, { onRoad = () => false, inBuilding = () => false } = {}) {
  const nodes = [], edges = [];
  const CELL = 4, hash = new Map(), hk = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const addNode = (x, z, kind = 'side') => { const n = { id: nodes.length, x, z, adj: [], kind, comp: -1 }; nodes.push(n); const k = hk(x, z); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(n); return n; };
  const near = (x, z, r, f) => {
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++)
      for (const n of hash.get(`${i},${j}`) ?? []) if ((n.x - x) ** 2 + (n.z - z) ** 2 <= r * r) f(n);
  };
  const linked = (a, b) => a.adj.some(l => l.to === b);
  const link = (a, b, kind, half, extra = {}) => {
    if (a === b || linked(a, b)) return null;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const e = { id: edges.length, a, b, len, kind, half, ...extra };
    edges.push(e); a.adj.push({ to: b, e }); b.adj.push({ to: a, e });
    return e;
  };
  const clearLine = (ax, az, bx, bz, test, skip = .6) => { // samples a segment, ignoring the first and last `skip` metres
    const l = Math.hypot(bx - ax, bz - az);
    for (let s = Math.min(skip, l / 2); s <= l - Math.min(skip, l / 2); s += .5) { const t = s / (l || 1); if (test(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  };
  const blocked = (x, z) => inBuilding(x, z);

  // Sidewalks: both sides of each street, trimmed back to the crosswalk at every intersection.
  const ends = new Map(); // `${edge.id}:${end}:${side}` -> node
  for (const e of net.edges) {
    if (e.internal) continue;
    const t0 = e.a.ix ? e.a.t + CW_AT : 0, t1 = e.b.ix ? e.b.t + CW_AT : 0;
    for (const side of [-1, 1]) {
      const h = side * (e.w / 2 + SIDEWALK_OFF);
      const line = new Path(offsetLine(e.path.pts, h));
      // The offset line is a little longer or shorter than the centre line on bends; trim proportionally.
      const k = line.len / (e.len || 1), s0 = t0 * k, s1 = line.len - t1 * k;
      let pts;
      if (s1 - s0 < .5) { const m = line.at((s0 + s1) / 2); pts = [m.x, m.z]; }
      else pts = slice(line, s0, s1);
      // Resample so long blocks have nodes every few metres (for joining paths and spreading walkers).
      const seq = [];
      for (let i = 0; i < pts.length; i += 2) {
        if (i) {
          const px = pts[i - 2], pz = pts[i - 1], l = Math.hypot(pts[i] - px, pts[i + 1] - pz), steps = Math.floor(l / 7);
          for (let s = 1; s <= steps; s++) seq.push([px + (pts[i] - px) * s / (steps + 1), pz + (pts[i + 1] - pz) * s / (steps + 1)]);
        }
        seq.push([pts[i], pts[i + 1]]);
      }
      const ns = seq.map(([x, z]) => addNode(x, z, 'side'));
      for (let i = 1; i < ns.length; i++) {
        const a = ns[i - 1], b = ns[i];
        // Cut where the sidewalk runs into a building or over another carriageway (roads crossing without a shared
        // node: bridges, near misses); walkers go round by the crosswalks instead.
        if (clearLine(a.x, a.z, b.x, b.z, (x, z) => blocked(x, z) || onRoad(x, z), 0)) link(a, b, 'side', .8, { major: e.major });
      }
      ends.set(`${e.id}:0:${side}`, ns[0]); ends.set(`${e.id}:1:${side}`, ns[ns.length - 1]);
    }
  }

  // Plain bends (two streets meeting end to end): each pair of sidewalks meets where their lines cross.
  const merge = (keep, gone) => {
    for (const l of gone.adj) {
      const e = l.e, other = l.to;
      if (other === keep) { keep.adj = keep.adj.filter(m => m.e !== e); continue; }
      if (e.a === gone) e.a = keep; else e.b = keep;
      if (keep.adj.some(m => m.to === other)) { other.adj = other.adj.filter(m => m.e !== e); continue; }
      keep.adj.push({ to: other, e });
      for (const m of other.adj) if (m.e === e) m.to = keep;
    }
    gone.adj = []; gone.dead = true;
  };
  const relen = n => { for (const { e } of n.adj) e.len = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z); };
  for (const n of net.nodes) {
    if (n.ix) continue;
    const arms = n.ends.filter(({ e }) => !e.internal);
    if (arms.length !== 2) continue;
    const dirOut = ({ e, end }) => { const p = e.path.at(end === 0 ? 0 : e.len); return end === 0 ? [p.ux, p.uz] : [-p.ux, -p.uz]; };
    const kerbOf = ({ e, end }, right) => ends.get(`${e.id}:${end}:${(end === 0) === right ? 1 : -1}`);
    const [A, B] = arms, a = dirOut(A), b = dirOut(B);
    for (const [p, q] of [[kerbOf(A, true), kerbOf(B, false)], [kerbOf(B, true), kerbOf(A, false)]]) {
      if (!p || !q || p === q || p.dead || q.dead) continue;
      const da = p === kerbOf(A, true) ? a : b, db = da === a ? b : a;
      const den = da[0] * db[1] - da[1] * db[0];
      let x = (p.x + q.x) / 2, z = (p.z + q.z) / 2;
      if (Math.abs(den) > .2) {
        const t = ((q.x - p.x) * db[1] - (q.z - p.z) * db[0]) / den, X = p.x + da[0] * t, Z = p.z + da[1] * t;
        if (Math.hypot(X - n.x, Z - n.z) < 15) { x = X; z = Z; }
      }
      p.x = x; p.z = z;
      merge(p, q); relen(p);
      for (const [k, v] of ends) if (v === q) ends.set(k, p);
    }
  }

  // Corners and crosswalks at each intersection.
  for (const ix of net.intersections) {
    const arms = ix.arms;
    // A kerb node on the left or right of an arm, looking outward from the intersection.
    const kerb = (arm, right) => ends.get(`${arm.edge.id}:${arm.end}:${(arm.end === 0) === right ? 1 : -1}`);
    for (const arm of arms) {
      const L = kerb(arm, false), R = kerb(arm, true), cw = arm.crosswalk;
      if (!L || !R) continue;
      cw.ax = L.x; cw.az = L.z; cw.bx = R.x; cw.bz = R.z; cw.len = Math.hypot(R.x - L.x, R.z - L.z);
      L.kind = R.kind = 'kerb';
      const e = link(L, R, 'cross', CW_HALF - .3, { cw });
      cw.edge = e; cw.nodeA = L; cw.nodeB = R;
    }
    if (arms.length < 2) continue;
    for (let i = 0; i < arms.length; i++) {
      const A = arms[i], B = arms[(i + 1) % arms.length];
      if (A === B) continue;
      const a = kerb(A, true), b = kerb(B, false);
      if (!a || !b) continue;
      let gap = B.angle - A.angle; if (gap <= 0) gap += 2 * Math.PI;
      if (gap > Math.PI * 1.15) { // a wide corner (the back of a T): go round it rather than across
        const mid = A.angle + gap / 2, rad = Math.max(Math.hypot(a.x - ix.x, a.z - ix.z), Math.hypot(b.x - ix.x, b.z - ix.z));
        const mx = ix.x + Math.cos(mid) * rad, mz = ix.z + Math.sin(mid) * rad;
        if (onRoad(mx, mz) || blocked(mx, mz)) continue;
        const m = addNode(mx, mz, 'corner');
        if (clearLine(a.x, a.z, mx, mz, (x, z) => onRoad(x, z) || blocked(x, z)) && clearLine(mx, mz, b.x, b.z, (x, z) => onRoad(x, z) || blocked(x, z))) { link(a, m, 'corner', .7); link(m, b, 'corner', .7); }
      } else if (clearLine(a.x, a.z, b.x, b.z, (x, z) => onRoad(x, z) || blocked(x, z), .2)) link(a, b, 'corner', .7);
    }
  }

  // Footpaths: cut where they cross a carriageway or a building, then tied to nearby sidewalks.
  const pathNode = new Map(); // exact vertex -> node, so paths sharing an OSM vertex connect
  const footEnds = [];
  for (const q of paths) {
    const half = Math.max(.4, q.w / 2 - .3), r = q.r;
    let prev = null;
    const bad = (x, z) => onRoad(x, z) || blocked(x, z);
    const vertexNode = (x, z) => {
      const k = x + ',' + z;
      if (!pathNode.has(k)) pathNode.set(k, addNode(x, z, 'path'));
      return pathNode.get(k);
    };
    for (let i = 0; i < r.length; i += 2) {
      const x = r[i], z = r[i + 1];
      if (bad(x, z)) { if (prev) footEnds.push(prev); prev = null; continue; }
      const n = vertexNode(x, z);
      if (prev) {
        // Walk the segment; on a bad stretch, end this piece before it and start a new one after it.
        const l = Math.hypot(x - prev.x, z - prev.z);
        let last = prev, inBad = false;
        for (let s = .5; s < l; s += .5) {
          const px = prev.x + (x - prev.x) * s / l, pz = prev.z + (z - prev.z) * s / l, b = bad(px, pz);
          if (b && !inBad) { if (s > 1.6) { const m = addNode(prev.x + (x - prev.x) * (s - 1.5) / l, prev.z + (z - prev.z) * (s - 1.5) / l, 'path'); link(last, m, 'path', half); footEnds.push(m); } else footEnds.push(last); inBad = true; }
          else if (!b && inBad) { if (s + 1 < l) { last = addNode(prev.x + (x - prev.x) * (s + 1) / l, prev.z + (z - prev.z) * (s + 1) / l, 'path'); footEnds.push(last); s += 1; } else last = null; inBad = false; } // stop well short of the kerb
        }
        if (!inBad && last) link(last, n, 'path', half); else footEnds.push(n);
      } else footEnds.push(n);
      prev = n;
    }
    if (prev) footEnds.push(prev);
  }
  // Tie path ends (and dead-end path vertices) to the nearest sidewalk or path node they can reach in a straight line.
  const bad = (x, z) => onRoad(x, z) || blocked(x, z);
  for (const n of nodes) if (n.kind === 'path' && n.adj.length <= 1) footEnds.push(n);
  for (const n of new Set(footEnds)) {
    let best = null, bd = Infinity;
    near(n.x, n.z, 7, m => {
      if (m === n || m.kind === 'path' && n.adj.some(l => l.to === m)) return;
      if (m.kind === 'path' && m.adj.length > 1 && n.adj.length) return; // only bridge to paths at their ends
      const d = Math.hypot(m.x - n.x, m.z - n.z);
      if (d < bd && clearLine(n.x, n.z, m.x, m.z, bad, .2)) { bd = d; best = m; }
    });
    if (best) link(n, best, 'path', .6);
  }

  // Room to sidestep: narrow each walk segment where its full width would reach a carriageway or a wall (a path
  // mapped right along a kerb), so local avoidance can never push a walker into the road.
  for (const e of edges) {
    if (e.kind === 'cross' || !e.len) continue;
    const ux = (e.b.x - e.a.x) / e.len, uz = (e.b.z - e.a.z) / e.len;
    const hits = h => { for (let s = .3; s < e.len - .3; s += .7) for (const o of [-h, h]) { const x = e.a.x + ux * s - uz * o, z = e.a.z + uz * s + ux * o; if (onRoad(x, z) || blocked(x, z)) return true; } return false; };
    while (e.half > 0 && hits(e.half + .15)) e.half = Math.max(0, e.half - .2);
  }

  // Connected components: walkers only route within their own.
  let comp = 0;
  const sizes = [];
  for (const n of nodes) {
    if (n.comp >= 0) continue;
    const stack = [n]; n.comp = comp; let size = 0;
    while (stack.length) { const m = stack.pop(); size++; for (const { to } of m.adj) if (to.comp < 0) { to.comp = comp; stack.push(to); } }
    sizes.push(size); comp++;
  }
  // Walks added after the city is built (new neighbourhoods' sidewalks and front paths, growth/): each path joins the
  // network at its ends, and its edges carry `gate`, which routing honours, so nobody walks it until gate.open.
  // Earlier extensions count as network, so a front path can join a new street's sidewalk.
  function extend(paths, gate) {
    const added = [];
    for (const { r, w = 1.6 } of paths) {
      const ns = [];
      for (let i = 0; i < r.length; i += 2) {
        if (i) { // nodes every few metres, like the sidewalks
          const px = r[i - 2], pz = r[i - 1], l = Math.hypot(r[i] - px, r[i + 1] - pz), steps = Math.floor(l / 7);
          for (let s = 1; s <= steps; s++) ns.push(addNode(px + (r[i] - px) * s / (steps + 1), pz + (r[i + 1] - pz) * s / (steps + 1), 'path'));
        }
        ns.push(addNode(r[i], r[i + 1], 'path'));
      }
      for (let i = 1; i < ns.length; i++) { const e = link(ns[i - 1], ns[i], 'path', Math.max(.4, w / 2 - .3), { gate }); if (e) added.push(e); }
      for (const end of [ns[0], ns.at(-1)]) {
        let best = null, bd = Infinity;
        near(end.x, end.z, 8, m => {
          if (ns.includes(m) || m.comp < 0) return;
          const d = Math.hypot(m.x - end.x, m.z - end.z);
          if (d < bd && clearLine(end.x, end.z, m.x, m.z, blocked, .2)) { bd = d; best = m; }
        });
        if (best) { const e = link(end, best, 'path', .6, { gate }); if (e) added.push(e); for (const n of ns) n.comp = best.comp; }
      }
    }
    return added;
  }
  return { nodes, edges, compSizes: sizes, near, extend };
}

// ---------- routing ----------
// A* over the walking network. Crosswalks cost a little extra, so walkers do not zigzag across streets.
export function findRoute(walk, from, to, maxNodes = 40000) {
  if (from === to) return [from];
  if (from.comp !== to.comp) return null;
  const g = new Map([[from, 0]]), came = new Map(), open = new Heap();
  const h = n => Math.hypot(n.x - to.x, n.z - to.z);
  open.push(from, h(from));
  let seen = 0;
  while (open.size) {
    const n = open.pop();
    if (n === to) { const route = [n]; let c = n; while (came.has(c)) { c = came.get(c); route.push(c); } return route.reverse(); }
    if (++seen > maxNodes) return null;
    const gn = g.get(n);
    for (const { to: m, e } of n.adj) {
      if (e.gate && !e.gate.open) continue; // a walk not built yet (see extend)
      const cost = gn + e.len + (e.kind === 'cross' ? 6 : 0);
      if (cost < (g.get(m) ?? Infinity)) { g.set(m, cost); came.set(m, n); open.push(m, cost + h(m)); }
    }
  }
  return null;
}

class Heap {
  items = []; keys = [];
  get size() { return this.items.length; }
  push(item, k) {
    const { items, keys } = this; let i = items.length;
    items.push(item); keys.push(k);
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= k) break; items[i] = items[p]; keys[i] = keys[p]; i = p; }
    items[i] = item; keys[i] = k;
  }
  pop() {
    const { items, keys } = this, top = items[0], last = items.pop(), lk = keys.pop();
    if (items.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < items.length && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < items.length && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        items[i] = items[m]; keys[i] = keys[m]; i = m;
      }
      items[i] = last; keys[i] = lk;
    }
    return top;
  }
}
