// Plans a block's development (the parcels of a site that convert together) for a target zone state: which buildings,
// where, in what style, reached how, and which trees go. Lots are marched along each street that can serve the block
// (existing roads, footpaths for denser types, then the site's new streets), each footprint squared to the street at its
// own lot so a curved road gives a fan of lots, set back as far as the neighbours are, with a front path from every door
// to the sidewalk. Capacity comes from a ladder, climbed only as far as the block's homes need: the zone's gentlest mix
// of building types, then denser mixes, then full stretch (every type the zone permits, as large and tall as it allows,
// in further rows behind the first reached by walks between the buildings in front), then courts (shared lanes into
// land no street reaches). What still doesn't fit is reported as unmet, never forced in (develop.js may place it on other
// land the forecast builds). Every choice is a hash of the site, the street, the side and the lot, so a plan is the same
// on every load and in every year.
// Pure: no DOM, no THREE.
import { bounds } from '../world/rings.js';
import { FAMILIES, pickBy } from '../world/palette.js';
import { TYPES, MIXES, FILL, sizes, setbackFor } from './catalog.js';
import { OCC, TRUNK, Line, Raster, leftOf, hasher, inRect, sampleRect, segDist } from './geom.js';
import { STREET, streetChain } from './site-streets.js';

const SIDE_MARGIN = 1.5, CLEAR_PAD = 2; // metres kept clear beside a footprint; trees felled around one
const BACK_YARD = { house: 5, apartment: 3 }; // metres kept behind a footprint, by family
const COMPACT_BACK_YARD = { house: 3, apartment: 1.5 }; // and at full stretch
// Trees are drawn far wider than their trunks: a planted tree's crown is kept within PLANT_CROWN metres (art.js scales it
// to fit) and stands at least that far from every home; a city tree (park, street) within CITY_CROWN of a footprint, on
// land the block can't fell, rules the lot out, so no crown is ever drawn through a wall.
export const PLANT_CROWN = 3;
const CITY_CROWN = 5.5;
const REACH = 50; // streets within this of a block are tried
const FROM_JUNCTION = 16; // a lot's frontage stays this far from a junction, so nothing blocks one
const MAX_EXTRA_SETBACK = 14; // how much deeper than the neighbours a building may sit
const DEEP_SETBACK = 40; // how much deeper than the neighbours a building in a later row may sit, behind a longer walk
const ROWS = 3; // rows of lots along a street at full stretch
const SHALLOW = { setback: 3, depth: 8 }; // no lot sits closer to the kerb or is shallower with its yard (catalog.js)
const ON_PATHS = new Set(['townhouse', 'apartment', 'mixed']); // types that may front a footpath rather than a street
// Courts: shared lanes (2 half wide) the planner opens into land no street reaches. A court leaves a kerb at least
// spacing from another court or new street, runs at least minLen into the block and at most maxLen in all, and is only
// opened if it reaches minGain unused 4 m cells within serve metres (room for a building).
const COURT = { half: 2.5, spacing: 24, minLen: 24, maxLen: 140, serve: 30, minGain: 10, max: 8 };

/**
 * Plans a block: one or more parcels of a site that convert to the same state in the same year, planned together so
 * buildings may span the lines the parcels were cut along. One parcel is a block of one (planParcel).
 * @param {object} o
 * @param {{id: string, ring: number[], state: string}[]} o.parcels
 * @param {string} o.state the zone state to plan for (low_res, mid_res, mixed_use, ...)
 * @param {number} o.units homes requested of the whole block (units.js requestedUnits, summed)
 * @param {object} o.ctx siteContext()
 * @param {object[]} o.streets planSiteStreets().streets
 * @param {(x: number, z: number) => number} o.occ occupancy bits
 * @param {{ring: number[]}[]} [o.access] the site's parcels that stay as they are and aren't protected: courts and walks
 *   may cross them to reach the block, but nothing is built on them
 * @param {object[]} [o.claims] plans already on this land (develop.js places homes on land a plan has built): their
 *   footprints, walks and courts are kept clear and their yards unbuilt
 * @param {boolean} [o.stretch] start at full stretch (develop.js, for homes a block's own land couldn't hold)
 * @param {Record<string, number>} [o.why] if given, counts why lots were turned down (for tuning)
 */
export function planBlock({ parcels, state, units, ctx, streets, occ, access = [], claims = [], stretch = false, why = null }) {
  const no = reason => { if (why) why[reason] = (why[reason] ?? 0) + 1; return null; };
  const plan = { id: parcels.map(p => p.id).join('+'), parcels: parcels.map(p => p.id), state, requested: units, occupied: 0, capacity: 0, unmet: units, reason: null, level: -1, buildings: [], homes: [], paths: [], pads: [], lawns: [], clear: [], plantings: [], streets: [], courts: [] };
  const mixes = MIXES[state];
  if (!mixes || units <= 0) return plan;
  const [x0, z0, x1, z1] = parcels.map(p => bounds(p.ring)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const box = [x0 - REACH, z0 - REACH, x1 + REACH, z1 + REACH];

  // Streets that could serve the block.
  const lines = [];
  const mid = [(x0 + x1) / 2, (z0 + z1) / 2], within = REACH + Math.hypot(x1 - x0, z1 - z0) / 2;
  ctx.lines.forEach((L, i) => { if (L.line.project(...mid).d < within) lines.push({ key: `road:${i}`, kind: 'road', cls: L.cls, line: L.line, half: L.half, sw: L.sw, start: 0, end: L.line.len }); });
  (ctx.paths ?? []).forEach((L, i) => { if (L.line.project(...mid).d < within) lines.push({ key: `path:${i}`, kind: 'path', cls: L.cls, line: L.line, half: L.half, sw: 0, start: 0, end: L.line.len }); });
  for (const S of streets) {
    if (S.line.project(...mid).d < within) lines.push({ key: `street:${S.index}`, kind: 'street', street: S.index, line: S.line, half: S.half, sw: S.sw, start: S.mouth + 6, end: S.line.len });
  }
  if (!lines.length) { plan.reason = 'no street within reach'; return plan; }
  const mouths = streets.map(S => S.r.slice(0, 2));
  // Per line, the junctions and new streets' mouths near enough to rule out a lot, and how far from the line the block's
  // land can be for a lot there to reach it (a lot's frontage, setback, depth and yard), to skip stretches with none.
  const FAR = 140;
  for (const L of lines) {
    const near = ([x, z], r) => { const q = L.line.project(x, z); return q.d < r + 60; };
    L.junctions = L.kind === 'road' ? ctx.junctions.filter(j => near(j, FROM_JUNCTION)) : [];
    L.mouths = L.kind === 'road' ? mouths.filter(m => near(m, 14)) : [];
  }
  const farFromBlock = (x, z) => Math.max(x0 - x, x - x1, 0) ** 2 + Math.max(z0 - z, z - z1, 0) ** 2 > FAR * FAR;

  // The capacity ladder, gentlest first: the zone's mixes in turn, then the densest at full stretch (every type the zone
  // permits, built as large and tall as it allows). Keep the first that fits every home, else the one that fits most.
  // Still short, the block opens courts into the land its streets can't reach, and climbs the ladder again with them.
  const start = state === 'low_res' && ctx.dense > .35 ? 1 : 0;
  const stages = [...mixes.map(mix => ({ mix, full: false })), { mix: mixes.at(-1), full: true }];
  const parking = parcels.every(p => p.state === 'parking');
  const BLOCK = OCC.building | OCC.road | OCC.water | OCC.sidewalk | OCC.keepClear | (parking ? 0 : OCC.lot);
  const own = (R, x, z) => { const k = R.in(x, z); return k > 0 && k <= parcels.length; };
  const land = new Raster(box, [...parcels, ...access].map(p => p.ring), occ); // each layout claims on a fresh copy
  const climb = courts => {
    let best = null;
    for (let level = stretch ? stages.length - 1 : Math.min(start, mixes.length - 1); level < stages.length; level++) {
      const attempt = layout(stages[level], level, courts);
      if (!best || attempt.occupied > best.occupied) best = attempt;
      if (attempt.occupied >= units) break;
    }
    return best;
  };
  let best = climb([]);
  if (best.occupied < units) {
    const courts = planCourts(best.R);
    if (courts.length) {
      const withCourts = climb(courts); // only the courts something fronts are built (layout's out.courts)
      if (withCourts.occupied > best.occupied) best = withCourts;
    }
  }
  delete best.R;
  Object.assign(plan, best, { unmet: Math.max(0, units - best.occupied) });
  if (!plan.buildings.length) plan.reason = 'no room for a building with a way in';
  else if (plan.unmet) plan.reason = 'not enough room';
  return plan;

  /**
   * Courts: shared lanes into the block's land no street reaches, each leaving a street's or path's kerb square to it
   * and running straight through land that is the block's or the verge before it, never over a road, a wall, water or
   * another parcel. Greedy: each court is the one that reaches the most land still unused (after a layout, R),
   * until none reaches enough to hold a building.
   */
  function planCourts(R) {
    const free = (x, z) => own(R, x, z) && !(R.bits(x, z) & BLOCK) && !R.marked(x, z);
    const samples = [];
    for (let x = Math.floor(x0) + 2; x < x1; x += 4) for (let z = Math.floor(z0) + 2; z < z1; z += 4) if (free(x, z)) samples.push([x, z]);
    const claimed = []; // accepted courts' corridors, as rectangles
    const open = (x, z) => {
      const b = R.bits(x, z);
      if (b === 255 || b & (OCC.building | OCC.road | OCC.water | OCC.keepClear) || R.marked(x, z) & 2) return false;
      if (claimed.some(o => inRect(o, x, z, 1))) return false;
      if (own(R, x, z)) return parking || !(b & OCC.lot);
      return R.in(x, z) > 0 ? !(b & OCC.lot) : !(b & OCC.zone); // land it may cross, or the verge (no other parcel)
    };
    const courts = [], mouthsUsed = [...mouths];
    let left = samples;
    for (let k = 0; k < COURT.max && left.length >= COURT.minGain; k++) {
      let pick = null;
      for (const L of lines) {
        if (L.kind === 'road' && TRUNK.has(L.cls)) continue;
        for (let s = L.start + 8; s < L.end - 8; s += 6) {
          const A = L.line.at(s);
          if (L.junctions.some(([jx, jz]) => Math.hypot(jx - A.x, jz - A.z) < FROM_JUNCTION)) continue;
          if (mouthsUsed.some(([mx, mz]) => Math.hypot(mx - A.x, mz - A.z) < COURT.spacing)) continue;
          for (const side of [1, -1]) {
            const [lx, lz] = leftOf(A.ux, A.uz), dx = lx * side, dz = lz * side, kerb = L.half + L.sw;
            if ((L.kind === 'road' || L.kind === 'path') && !(R.bits(A.x + dx * L.half * .5, A.z + dz * L.half * .5) & (OCC.road | OCC.sidewalk))) continue;
            let entered = -1, lastIn = -1;
            for (let t = kerb + 1; t <= kerb + COURT.maxLen; t += 1) {
              const x = A.x + dx * t, z = A.z + dz * t;
              let ok = true;
              for (let o = -COURT.half - .5; o <= COURT.half + .5 && ok; o += .75) ok = open(x - dz * o, z + dx * o);
              if (!ok) break;
              if (own(R, x, z)) { if (entered < 0) entered = t; lastIn = t; } else if (entered >= 0) break;
              if (entered < 0 && t > kerb + COURT.maxLen / 2) break;
            }
            if (entered < 0 || lastIn - entered < COURT.minLen) { no(entered < 0 ? 'court: no way in' : 'court: short'); continue; }
            const r = [A.x + dx * kerb, A.z + dz * kerb, A.x + dx * lastIn, A.z + dz * lastIn];
            const gain = left.filter(([x, z]) => { const d = segDist(x, z, ...r); return d > COURT.half + 2 && d < COURT.serve; }).length;
            if (gain < COURT.minGain) no('court: no gain');
            if (gain >= COURT.minGain && (!pick || gain > pick.gain || (gain === pick.gain && lastIn < pick.len))) pick = { r, gain, len: lastIn - kerb, from: L, A: [A.x, A.z] };
          }
        }
      }
      if (!pick) break;
      const [ax, az, bx, bz] = pick.r, len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      const n = courts.length;
      courts.push({ index: n, from: pick.from.key, street: pick.from.kind === 'street' ? pick.from.street : null, r: pick.r, len, w: COURT.half * 2, line: new Line(pick.r) });
      claimed.push({ cx: (ax + bx) / 2, cz: (az + bz) / 2, ux, uz, hw: len / 2, hd: COURT.half });
      mouthsUsed.push(pick.A);
      left = left.filter(([x, z]) => segDist(x, z, ...pick.r) >= COURT.serve);
    }
    return courts;
  }

  function layout({ mix, full }, level, courts) {
    const R = land.fresh();
    for (const S of streets) { // the site's streets are off limits to lots, built or not
      const ux = (S.r[2] - S.r[0]) / S.len, uz = (S.r[3] - S.r[1]) / S.len, c = STREET.half + STREET.sw, b = STREET.bulb + STREET.sw;
      R.claim({ cx: (S.r[0] + S.r[2]) / 2, cz: (S.r[1] + S.r[3]) / 2, ux, uz, hw: S.len / 2 + 1, hd: c }, 2);
      R.claim({ cx: S.r[2], cz: S.r[3], ux, uz, hw: b, hd: b }, 2);
    }
    const courtRect = C => { const [ax, az, bx, bz] = C.r, ux = (bx - ax) / C.len, uz = (bz - az) / C.len; return { cx: (ax + bx) / 2, cz: (az + bz) / 2, ux, uz, hw: C.len / 2, hd: C.w / 2 }; };
    for (const C of courts) R.claim(courtRect(C), 2); // and so are its courts
    for (const c of claims) { // and what other plans hold here: buildings and walks, courts, and yards and trees (walkable, unbuilt)
      for (const o of c.pads) R.claim(o, 1);
      for (const p of c.paths) R.claim(walkRect(p), 1);
      for (const C of c.courts ?? []) R.claim(courtRect(C), 2);
      for (const o of c.lawns) R.claim(o, 4);
      for (const t of c.plantings) if (t.kind === 'yard' || t.kind === 'street') R.claim({ cx: t.x, cz: t.z, ux: 1, uz: 0, hw: PLANT_CROWN, hd: PLANT_CROWN }, 4);
    }
    const buildable = (x, z) => own(R, x, z) && !(R.bits(x, z) & BLOCK) && !R.marked(x, z);
    // Front yards may also cross the verge between the block and the street, but no other parcel; walks to a later row
    // may cross the land the block may cross too.
    const passable = (x, z, cross = false) => {
      const b = R.bits(x, z);
      if (b === 255 || b & (OCC.building | OCC.road | OCC.water | OCC.keepClear) || R.marked(x, z) & 3) return false;
      return own(R, x, z) || (cross && R.in(x, z) > 0 && !(b & OCC.lot)) || !(b & OCC.zone);
    };
    const out = { level, occupied: 0, capacity: 0, buildings: [], homes: [], paths: [], pads: [], lawns: [], clear: [], plantings: [], streets: new Set(), courts: [], R };
    const placed = new Map(); // `${line.key}|${side}|${row}` -> lots on that side, in order
    const fronted = new Set(); // courts a lot fronts
    const all = [...lines, ...courts.map(C => ({ key: `court:${C.index}`, kind: 'court', court: C, line: C.line, half: C.w / 2, sw: 0, start: 0, end: C.len }))];

    // A row of lots along each side of each street. At full stretch, further rows behind it while homes are still
    // wanted: each faces the same street, reached by a walk between the buildings in front.
    for (let row = 0; row < (full ? ROWS : 1) && out.occupied < units; row++) {
      const before = out.buildings.length;
      for (const L of all) for (const side of [1, -1]) march(L, side, row);
      if (out.buildings.length === before) break;
    }
    out.streets = [...out.streets].sort((a, b) => a - b);
    out.courts = courts.filter(C => fronted.has(C));
    for (const C of out.courts) out.clear.push({ ...courtRect(C), hd: C.w / 2 + 1 });
    // Planted trees whose crowns would reach a home (this lot's, a later neighbour's, or another plan's here) are left out.
    const homes = [...out.homes, ...claims.flatMap(c => c.homes)];
    out.plantings = out.plantings.filter(t => (t.kind !== 'yard' && t.kind !== 'street') || homes.every(o => rectDist(o, t.x, t.z) >= PLANT_CROWN));
    return out;

    function march(L, side, row) {
      const list = [];
      placed.set(`${L.key}|${side}|${row}`, list);
      let s = L.start + 2;
      while (s < L.end - 4 && out.occupied < units) {
        const at = L.line.at(s);
        if (farFromBlock(at.x, at.z)) { s += 8; continue; } // no lot here could reach the block
        if (!roomBehind(L, side, row, s)) { s += 2; continue; }
        const key = `${ctx.id}|${L.key}|${side}|${Math.round(s / 4)}${row ? `|${row}` : ''}`, h = hasher(key);
        const first = mix.length > 1 && h(20) < .5 ? mix[1] : mix[0];
        // At full stretch a lot that can't take the mix's type takes another the zone permits.
        const types = (full ? [first, ...FILL[state].filter(t => t !== first)] : [first, ...mix.filter(t => t !== first)])
          .filter(t => !(TYPES[t].fam === 'house' && L.kind === 'road' && TRUNK.has(L.cls))) // no houses facing a trunk road
          .filter(t => L.kind !== 'path' || ON_PATHS.has(t)); // houses need a street
        if (!full) types.length = Math.min(types.length, 1);
        if (!types.length) return;
        // The lot's own type and size, smaller if they don't fit. At full stretch, any the zone permits: the smallest that
        // holds every home still wanted, else the most homes, so the last lot isn't a half-empty block.
        const need = units - out.occupied;
        let tries = types.flatMap(type => sizes(type, h, need, full).map(d => ({ type, d })));
        if (full) {
          for (const t of tries) t.n = TYPES[t.type].units(t.d);
          tries = [...tries.filter(t => t.n >= need).sort((a, b) => a.n - b.n), ...tries.filter(t => t.n < need).sort((a, b) => b.n - a.n)];
        }
        let lot = null;
        for (const { type, d } of tries) if ((lot = tryLot(L, side, s + d.w / 2, type, d, h, row))) break;
        if (!lot) { s += 2; continue; }
        styleLot(lot, h, list, side, L, row);
        commit(lot, R, out);
        list.push(lot);
        if (L.kind === 'street') for (const k of streetChain(streets, L.street)) out.streets.add(k);
        if (L.kind === 'court') { // a court off a new street needs that street (and the streets it connects through) built
          fronted.add(L.court);
          if (L.court.street != null) for (const k of streetChain(streets, L.court.street)) out.streets.add(k);
        }
        s = lot.s + lot.d.w / 2 + lot.gap;
      }
    }

    // Whether a lot starting at arc length s could have room: every lot covers the point 4 m along from its start (the
    // narrowest is 9 m), so the land straight in from there must stay buildable as deep as the shallowest lot and yard,
    // somewhere between the shallowest setback and the deepest. A quick test that spares most stretches the full search.
    function roomBehind(L, side, row, s) {
      const q = L.line.at(s + 4), [lx, lz] = leftOf(q.ux, q.uz), nx = lx * side, nz = lz * side;
      const from = L.half + L.sw + SHALLOW.setback, to = from + (row ? DEEP_SETBACK : MAX_EXTRA_SETBACK) + 12 + SHALLOW.depth;
      for (let t = from, run = 0; t <= to; t++) {
        run = buildable(q.x + nx * t, q.z + nz * t) ? run + 1 : 0;
        if (run >= SHALLOW.depth) return true;
      }
      return false;
    }

    // A lot at arc length sc on one side of a street, or null. Row 0 sits at the neighbours' setback (a little deeper if
    // it must); a later row anywhere up to DEEP_SETBACK behind the kerb, with only its walks needing a way through.
    function tryLot(L, side, sc, type, d, h, row) {
      if (sc + d.w / 2 > L.end || sc - d.w / 2 < L.start) return no('range');
      const p = L.line.at(sc), a = L.line.at(sc - d.w / 2), b = L.line.at(sc + d.w / 2);
      if (a.ux * b.ux + a.uz * b.uz < .94) return no('bend'); // too sharp a bend for a straight facade
      if (L.kind === 'road') {
        if (L.junctions.some(([jx, jz]) => Math.hypot(jx - p.x, jz - p.z) < FROM_JUNCTION)) return no('junction');
        if (L.mouths.some(([mx, mz]) => Math.hypot(mx - p.x, mz - p.z) < 14)) return no('mouth');
      }
      const [lx, lz] = leftOf(p.ux, p.uz), nx = lx * side, nz = lz * side; // from the street toward the lot
      const kerb = L.half + L.sw;
      if ((L.kind === 'road' || L.kind === 'path') && !(R.bits(p.x + nx * L.half * .5, p.z + nz * L.half * .5) & (OCC.road | OCC.sidewalk))) return no('no street'); // the street or path is really here
      const T = TYPES[type], fx = -nx, fz = -nz; // the front faces the street
      const ex = fz, ez = -fx; // along the front, so the front edge's outward normal is (fx, fz)
      // The footprint with its side and back margins must be buildable. It sits at the neighbours' setback, or deeper where
      // the block starts further back from the street (the front yard then crosses the verge).
      let setback = setbackFor(type, ctx.setback), o1 = 0;
      const back = (full ? COMPACT_BACK_YARD : BACK_YARD)[T.fam], depth = d.d + back, most = row ? DEEP_SETBACK : MAX_EXTRA_SETBACK;
      // A quick test first: along the lot's middle and its two sides (margins included), how far in each stays buildable;
      // the whole footprint is only sampled at setbacks that leave all three a clear run as deep as the building and yard.
      const t0 = kerb + setback, n = Math.ceil(most + depth) + 1, clear = new Uint8Array(n + 1);
      const side1 = d.w / 2 + SIDE_MARGIN;
      for (let k = n - 1; k >= 0; k--) {
        const t = t0 + k, x = p.x + nx * t, z = p.z + nz * t;
        clear[k] = buildable(x, z) && buildable(x - ex * side1, z - ez * side1) && buildable(x + ex * side1, z + ez * side1) ? clear[k + 1] + 1 : 0;
      }
      for (let extra = 0; ; extra += 2) {
        if (extra > most) return no('no room');
        if (clear[extra] < depth) continue;
        o1 = kerb + setback + extra;
        const site = { cx: p.x + nx * (o1 + depth / 2), cz: p.z + nz * (o1 + depth / 2), ux: ex, uz: ez, hw: side1, hd: depth / 2 };
        if (sampleRect(site, .9, buildable)) { setback += extra; break; }
      }
      const cx = p.x + nx * (o1 + d.d / 2), cz = p.z + nz * (o1 + d.d / 2);
      const cityTree = (x, z) => !own(R, x, z) && (R.bits(x, z) & OCC.decor) !== 0; // trees outside the block mark decor round their trunks
      if (!sampleRect({ cx, cz, ux: ex, uz: ez, hw: d.w / 2 + CITY_CROWN, hd: d.d / 2 + CITY_CROWN }, 1.5, (x, z) => !cityTree(x, z))) return no('city tree');
      const hw = d.w / 2, hd = d.d / 2, walkW = T.fam === 'house' ? 1.4 : 2.6, doorU = k => -hw + d.w * (k + .5) / d.doors;
      if (row) { // a walk from each door to the sidewalk, between the buildings in front
        for (let k = 0; k < d.doors; k++) {
          const u = doorU(k), m = kerb + .6 + setback / 2;
          const walk = { cx: p.x + nx * m + ex * u, cz: p.z + nz * m + ez * u, ux: ex, uz: ez, hw: walkW / 2 + .3, hd: setback / 2 - .6 };
          if (!sampleRect(walk, .9, (x, z) => passable(x, z, true))) return no('walk');
        }
      } else {
        const yard = { cx: p.x + nx * (kerb + .6 + setback / 2), cz: p.z + nz * (kerb + .6 + setback / 2), ux: ex, uz: ez, hw: hw + SIDE_MARGIN, hd: setback / 2 - .6 }; // from a metre behind the sidewalk (1 m cells)
        if (!sampleRect(yard, .9, passable)) return no('front yard');
      }
      // The ring, front edge first (edge 0, from P0 to P1), wound like the OSM footprints (outward normal (-dz, dx)).
      const P = (u, v) => [cx + ex * u + fx * v, cz + ez * u + fz * v];
      let ring;
      if (type === 'detached' && h(21) < T.lShape) { // an L: the back of one side cut away
        const d1 = d.d * .62, wing = d.w * .45;
        ring = [...P(-hw, hd), ...P(hw, hd), ...P(hw, hd - d1), ...P(hw - wing, hd - d1), ...P(hw - wing, -hd), ...P(-hw, -hd)];
      } else ring = [...P(-hw, hd), ...P(hw, hd), ...P(hw, -hd), ...P(-hw, -hd)];
      const doors = [], paths = [];
      for (let k = 0; k < d.doors; k++) {
        const [dx, dz] = P(doorU(k), hd), w = walkW;
        doors.push([dx + fx * 1.2, dz + fz * 1.2]);
        paths.push({ r: [dx, dz, dx + fx * (setback + .3), dz + fz * (setback + .3)], w });
      }
      return {
        type, d, h, s: sc, side, line: L.key, back, row, c: [cx, cz], f: [fx, fz], e: [ex, ez], ring, doors, paths, setback, kerb,
        gap: full ? T.gap[0] : T.gap[0] + (T.gap[1] - T.gap[0]) * h(22),
        foot: { cx, cz, ux: ex, uz: ez, hw, hd },
        // the front yard (path and drive) and the lawn from the sidewalk to the back fence; a later row's front yard is its walks
        front: row ? null : { cx: p.x + nx * (kerb + setback / 2), cz: p.z + nz * (kerb + setback / 2), ux: ex, uz: ez, hw: hw + 1, hd: setback / 2 },
        lawn: row ? { cx: p.x + nx * (o1 + (d.d + back) / 2 - .5), cz: p.z + nz * (o1 + (d.d + back) / 2 - .5), ux: ex, uz: ez, hw: hw + SIDE_MARGIN, hd: (d.d + back) / 2 + 1.5 }
          : { cx: p.x + nx * (kerb + (setback + d.d + back) / 2 + .1), cz: p.z + nz * (kerb + (setback + d.d + back) / 2 + .1), ux: ex, uz: ez, hw: hw + SIDE_MARGIN, hd: (setback + d.d + back) / 2 - .1 },
        yard: { cx: p.x + nx * (o1 + d.d + back / 2), cz: p.z + nz * (o1 + d.d + back / 2), ux: ex, uz: ez, hw: hw + SIDE_MARGIN, hd: back / 2 },
      };
    }

    // Materials and details: the type's family, from the site's palette, never the same complete design as the lot beside
    // it or across the street.
    function styleLot(lot, h, list, side, L, row) {
      const T = TYPES[lot.type], pal = ctx.palette[T.fam], F = FAMILIES[T.fam];
      const across = (placed.get(`${L.key}|${-side}|${row}`) ?? []).filter(o => Math.abs(o.s - lot.s) < (o.d.w + lot.d.w) / 2 + 6);
      const avoid = new Set([list.at(-1), ...across].filter(Boolean).map(o => o.signature));
      for (let salt = 0; salt < 8; salt++) {
        const g = k => h(100 + salt * 16 + k);
        const style = {
          wall: pickBy(pal.walls, g(1)), roof: pickBy(pal.roofs, g(2)), roofShape: pickBy(T.roofs, g(3)),
          porch: g(4) < (T.porch ?? 0), door: pickBy(F.doors ?? ['doorAqua'], g(5)), chimney: g(6) < (T.chimney ?? 0), solar: g(7) < (T.solar ?? 0),
          balconies: g(8) < (T.balconies ?? 0), ground: T.ground, awnings: !!T.awnings,
        };
        const signature = [lot.type, style.wall, style.roof, style.roofShape, style.porch, style.door, lot.d.floors].join('|');
        lot.style = style; lot.signature = signature;
        if (!avoid.has(signature)) break;
      }
    }

    function commit(lot, R, out) {
      const T = TYPES[lot.type], capacity = T.units(lot.d), occupied = Math.min(capacity, units - out.occupied);
      R.claim(lot.foot, 1, SIDE_MARGIN);
      R.claim(lot.yard, 4); // the back yard: no later row builds in it, though walks may cross it
      for (const p of lot.paths) {
        const rect = walkRect(p);
        R.claim(rect, 1);
        out.paths.push(p);
        out.clear.push({ ...rect, hw: p.w / 2 + 1 });
      }
      out.buildings.push({
        type: lot.type, label: T.label, fam: T.fam, ring: lot.ring, front: 0, doors: lot.doors, c: lot.c, w: lot.d.w, d: lot.d.d,
        floors: lot.d.floors, units: capacity, occupied, style: lot.style, signature: lot.signature, line: lot.line, side: lot.side, s: lot.s,
      });
      out.capacity += capacity; out.occupied += occupied;
      out.pads.push({ ...lot.foot, hw: lot.foot.hw + CLEAR_PAD, hd: lot.foot.hd + CLEAR_PAD });
      out.clear.push({ ...lot.foot, hw: lot.foot.hw + CLEAR_PAD, hd: lot.foot.hd + CLEAR_PAD });
      if (lot.front) out.clear.push(lot.front);
      out.lawns.push(lot.lawn);
      out.homes.push(lot.foot);
      plant(lot, out.plantings);
    }

    // Landscaping: shrubs at the front corners, flowers along the front, a yard tree out back, a street tree in the verge.
    function plant(lot, list) {
      const [cx, cz] = lot.c, [fx, fz] = lot.f, [ex, ez] = lot.e, hw = lot.d.w / 2, hd = lot.d.d / 2, h = lot.h;
      const at = (u, v) => [cx + ex * u + fx * v, cz + ez * u + fz * v];
      const doorU = lot.doors.map((_, k) => -hw + lot.d.w * (k + .5) / lot.doors.length);
      for (const u of [-hw + .7, hw - .7]) { const [x, z] = at(u, hd + 1); list.push({ kind: 'shrub', x, z, r: h(30 + list.length) }); }
      for (let u = -hw + 1.8; u < hw - 1.6; u += 1.3) {
        if (doorU.some(du => Math.abs(du - u) < 1.4)) continue;
        const [x, z] = at(u, hd + .6);
        list.push({ kind: 'flower', x, z, r: h(40 + list.length) });
      }
      if (h(50) < .65) { const [x, z] = at((h(51) - .5) * hw, -hd - lot.back + 1); list.push({ kind: 'yard', x, z, r: h(52) }); } // at the back of the yard
      if (lot.row) return; // a later row's verge is the row in front's
      const [x, z] = at(hw + lot.gap / 2, hd + lot.setback - .9); // between this lot's path and the next one's
      if (passable(x, z)) list.push({ kind: 'street', x, z, r: h(53) });
    }
  }
}

/** A walk's strip (a path { r: [x0, z0, x1, z1], w }) as an oriented rectangle, with a little room either side. */
export function walkRect(p, pad = .3) {
  const [ax, az, bx, bz] = p.r, l = Math.hypot(bx - ax, bz - az) || 1;
  return { cx: (ax + bx) / 2, cz: (az + bz) / 2, ux: (bz - az) / l, uz: -(bx - ax) / l, hw: p.w / 2 + pad, hd: l / 2 };
}

/** A block of one parcel. */
export const planParcel = ({ parcel, ...o }) => planBlock({ ...o, parcels: [parcel] });

/** Distance from a point to an oriented rectangle (0 inside). */
export function rectDist(o, x, z) {
  const dx = x - o.cx, dz = z - o.cz, a = Math.abs(dx * o.ux + dz * o.uz) - o.hw, b = Math.abs(-dx * o.uz + dz * o.ux) - o.hd;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0));
}

/** True where a plan fells trees: footprints with a margin, and path corridors. */
export const clears = (plan, x, z) => plan.clear.some(o => inRect(o, x, z));
