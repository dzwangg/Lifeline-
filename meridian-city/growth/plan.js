// Plans a block's development (the parcels of a site that convert together) for a target zone state: which buildings,
// where, in what style, reached how, and which trees go. Lots are marched along each street that can serve the block
// (existing roads, footpaths for denser types, then the site's new streets), each footprint squared to the street at its
// own lot so a curved road gives a fan of lots, set back as far as the neighbours are, with a front path from every door
// to the sidewalk. Building types start with the zone's gentlest mix and only densify when the block's homes don't fit;
// what still doesn't fit is reported as unmet. Every choice is a hash of the site, the street, the side and the lot, so
// a plan is the same on every load and in every year.
// Pure: no DOM, no THREE.
import { bounds } from '../world/rings.js';
import { FAMILIES, pickBy } from '../world/palette.js';
import { TYPES, MIXES, sizes, setbackFor } from './catalog.js';
import { OCC, TRUNK, Raster, leftOf, hasher, inRect, sampleRect } from './geom.js';
import { STREET, streetChain } from './site-streets.js';

const SIDE_MARGIN = 1.5, CLEAR_PAD = 2; // metres kept clear beside a footprint; trees felled around one
const BACK_YARD = { house: 5, apartment: 3 }; // metres kept behind a footprint, by family
// Trees are drawn far wider than their trunks: a planted tree's crown is kept within PLANT_CROWN metres (art.js scales it
// to fit) and stands at least that far from every home; a city tree (park, street) within CITY_CROWN of a footprint, on
// land the block can't fell, rules the lot out, so no crown is ever drawn through a wall.
export const PLANT_CROWN = 3;
const CITY_CROWN = 5.5;
const REACH = 50; // streets within this of a block are tried
const FROM_JUNCTION = 16; // a lot's frontage stays this far from a junction, so nothing blocks one
const MAX_EXTRA_SETBACK = 14; // how much deeper than the neighbours a building may sit
const ON_PATHS = new Set(['townhouse', 'apartment', 'mixed']); // types that may front a footpath rather than a street

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
 * @param {Record<string, number>} [o.why] if given, counts why lots were turned down (for tuning)
 */
export function planBlock({ parcels, state, units, ctx, streets, occ, why = null }) {
  const no = reason => { if (why) why[reason] = (why[reason] ?? 0) + 1; return null; };
  const plan = { id: parcels.map(p => p.id).join('+'), parcels: parcels.map(p => p.id), state, requested: units, occupied: 0, capacity: 0, unmet: units, reason: null, level: -1, buildings: [], homes: [], paths: [], pads: [], lawns: [], clear: [], plantings: [], streets: [] };
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

  // Plan at each mix in turn; keep the first that fits every home, else the one that fits most.
  const start = state === 'low_res' && ctx.dense > .35 ? 1 : 0;
  let best = null;
  for (let level = Math.min(start, mixes.length - 1); level < mixes.length; level++) {
    const attempt = layout(mixes[level], level);
    if (!best || attempt.occupied > best.occupied) best = attempt;
    if (attempt.occupied >= units) break;
  }
  Object.assign(plan, best, { unmet: Math.max(0, units - best.occupied) });
  if (!plan.buildings.length) plan.reason = 'no room for a building with a way in';
  else if (plan.unmet) plan.reason = 'not enough room';
  return plan;

  function layout(mix, level) {
    const R = new Raster(box, parcels.map(p => p.ring), occ);
    for (const S of streets) { // the site's streets are off limits to lots, built or not
      const ux = (S.r[2] - S.r[0]) / S.len, uz = (S.r[3] - S.r[1]) / S.len, c = STREET.half + STREET.sw, b = STREET.bulb + STREET.sw;
      R.claim({ cx: (S.r[0] + S.r[2]) / 2, cz: (S.r[1] + S.r[3]) / 2, ux, uz, hw: S.len / 2 + 1, hd: c }, 2);
      R.claim({ cx: S.r[2], cz: S.r[3], ux, uz, hw: b, hd: b }, 2);
    }
    const parking = parcels.every(p => p.state === 'parking');
    const BLOCK = OCC.building | OCC.road | OCC.water | OCC.sidewalk | OCC.keepClear | (parking ? 0 : OCC.lot);
    const buildable = (x, z) => R.in(x, z) > 0 && !(R.bits(x, z) & BLOCK) && !R.marked(x, z);
    // Front yards and paths may also cross the verge between the block and the street, but no other parcel.
    const passable = (x, z) => {
      const b = R.bits(x, z);
      if (b === 255 || b & (OCC.building | OCC.road | OCC.water | OCC.keepClear) || R.marked(x, z) & 3) return false;
      return R.in(x, z) > 0 || !(b & OCC.zone);
    };
    const out = { level, occupied: 0, capacity: 0, buildings: [], homes: [], paths: [], pads: [], lawns: [], clear: [], plantings: [], streets: new Set() };
    const placed = new Map(); // `${line.key}|${side}` -> lots on that side, in order

    for (const L of lines) for (const side of [1, -1]) {
      const list = [];
      placed.set(`${L.key}|${side}`, list);
      let s = L.start + 2;
      while (s < L.end - 4 && out.occupied < units) {
        const key = `${ctx.id}|${L.key}|${side}|${Math.round(s / 4)}`, h = hasher(key);
        let type = mix.length > 1 && h(20) < .5 ? mix[1] : mix[0];
        if (TYPES[type].fam === 'house' && L.kind === 'road' && TRUNK.has(L.cls)) { // no houses facing a trunk road: apartments, if the mix has them
          type = mix.find(t => TYPES[t].fam !== 'house');
          if (!type) break;
        }
        if (L.kind === 'path' && !ON_PATHS.has(type)) { type = mix.find(t => ON_PATHS.has(t)); if (!type) break; } // houses need a street
        let lot = null;
        for (const d of sizes(type, h, units - out.occupied)) if ((lot = tryLot(L, side, s + d.w / 2, type, d, h))) break;
        if (!lot) { s += 2; continue; }
        styleLot(lot, h, list, side, L);
        commit(lot, R, out);
        list.push(lot);
        if (L.kind === 'street') for (const k of streetChain(streets, L.street)) out.streets.add(k);
        s = lot.s + lot.d.w / 2 + lot.gap;
      }
    }
    out.streets = [...out.streets].sort((a, b) => a - b);
    // Planted trees whose crowns would reach a home (this lot's or a later neighbour's) are left out.
    out.plantings = out.plantings.filter(t => (t.kind !== 'yard' && t.kind !== 'street') || out.homes.every(o => rectDist(o, t.x, t.z) >= PLANT_CROWN));
    return out;

    // A lot at arc length sc on one side of a street, or null.
    function tryLot(L, side, sc, type, d, h) {
      if (sc + d.w / 2 > L.end || sc - d.w / 2 < L.start) return no('range');
      const p = L.line.at(sc), a = L.line.at(sc - d.w / 2), b = L.line.at(sc + d.w / 2);
      if (a.ux * b.ux + a.uz * b.uz < .94) return no('bend'); // too sharp a bend for a straight facade
      if (L.kind === 'road') {
        if (ctx.junctions.some(([jx, jz]) => Math.hypot(jx - p.x, jz - p.z) < FROM_JUNCTION)) return no('junction');
        if (mouths.some(([mx, mz]) => Math.hypot(mx - p.x, mz - p.z) < 14)) return no('mouth');
      }
      const [lx, lz] = leftOf(p.ux, p.uz), nx = lx * side, nz = lz * side; // from the street toward the lot
      const kerb = L.half + L.sw;
      if (L.kind !== 'street' && !(R.bits(p.x + nx * L.half * .5, p.z + nz * L.half * .5) & (OCC.road | OCC.sidewalk))) return no('no street'); // the street or path is really here
      const T = TYPES[type], fx = -nx, fz = -nz; // the front faces the street
      const ex = fz, ez = -fx; // along the front, so the front edge's outward normal is (fx, fz)
      // The footprint with its side and back margins must be buildable. It sits at the neighbours' setback, or deeper where
      // the block starts further back from the street (the front yard then crosses the verge).
      let setback = setbackFor(type, ctx.setback), o1 = 0;
      const back = BACK_YARD[T.fam];
      for (let extra = 0; ; extra += 2) {
        if (extra > MAX_EXTRA_SETBACK) return no('no room');
        o1 = kerb + setback + extra;
        const site = { cx: p.x + nx * (o1 + (d.d + back) / 2), cz: p.z + nz * (o1 + (d.d + back) / 2), ux: ex, uz: ez, hw: d.w / 2 + SIDE_MARGIN, hd: (d.d + back) / 2 };
        if (sampleRect(site, .9, buildable)) { setback += extra; break; }
      }
      const cx = p.x + nx * (o1 + d.d / 2), cz = p.z + nz * (o1 + d.d / 2);
      const cityTree = (x, z) => R.in(x, z) === 0 && (R.bits(x, z) & OCC.decor) !== 0; // trees outside the block mark decor round their trunks
      if (!sampleRect({ cx, cz, ux: ex, uz: ez, hw: d.w / 2 + CITY_CROWN, hd: d.d / 2 + CITY_CROWN }, 1.5, (x, z) => !cityTree(x, z))) return no('city tree');
      const yard = { cx: p.x + nx * (kerb + .6 + setback / 2), cz: p.z + nz * (kerb + .6 + setback / 2), ux: ex, uz: ez, hw: d.w / 2 + SIDE_MARGIN, hd: setback / 2 - .6 }; // from a metre behind the sidewalk (1 m cells)
      if (!sampleRect(yard, .9, passable)) return no('front yard');
      // The ring, front edge first (edge 0, from P0 to P1), wound like the OSM footprints (outward normal (-dz, dx)).
      const P = (u, v) => [cx + ex * u + fx * v, cz + ez * u + fz * v], hw = d.w / 2, hd = d.d / 2;
      let ring;
      if (type === 'detached' && h(21) < T.lShape) { // an L: the back of one side cut away
        const d1 = d.d * .62, wing = d.w * .45;
        ring = [...P(-hw, hd), ...P(hw, hd), ...P(hw, hd - d1), ...P(hw - wing, hd - d1), ...P(hw - wing, -hd), ...P(-hw, -hd)];
      } else ring = [...P(-hw, hd), ...P(hw, hd), ...P(hw, -hd), ...P(-hw, -hd)];
      const doors = [], paths = [];
      for (let k = 0; k < d.doors; k++) {
        const u = -hw + d.w * (k + .5) / d.doors, [dx, dz] = P(u, hd), w = T.fam === 'house' ? 1.4 : 2.6;
        doors.push([dx + fx * 1.2, dz + fz * 1.2]);
        paths.push({ r: [dx, dz, dx + fx * (setback + .3), dz + fz * (setback + .3)], w });
      }
      return {
        type, d, h, s: sc, side, line: L.key, back, c: [cx, cz], f: [fx, fz], e: [ex, ez], ring, doors, paths, setback, kerb,
        gap: T.gap[0] + (T.gap[1] - T.gap[0]) * h(22),
        foot: { cx, cz, ux: ex, uz: ez, hw, hd },
        front: { cx: p.x + nx * (kerb + setback / 2), cz: p.z + nz * (kerb + setback / 2), ux: ex, uz: ez, hw: hw + 1, hd: setback / 2 }, // the front yard: path and drive
        lawn: { cx: p.x + nx * (kerb + (setback + d.d + back) / 2 + .1), cz: p.z + nz * (kerb + (setback + d.d + back) / 2 + .1), ux: ex, uz: ez, hw: hw + SIDE_MARGIN, hd: (setback + d.d + back) / 2 - .1 },
      };
    }

    // Materials and details: the type's family, from the site's palette, never the same complete design as the lot beside
    // it or across the street.
    function styleLot(lot, h, list, side, L) {
      const T = TYPES[lot.type], pal = ctx.palette[T.fam], F = FAMILIES[T.fam];
      const across = (placed.get(`${L.key}|${-side}`) ?? []).filter(o => Math.abs(o.s - lot.s) < (o.d.w + lot.d.w) / 2 + 6);
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
      for (const p of lot.paths) {
        const [ax, az, bx, bz] = p.r, l = Math.hypot(bx - ax, bz - az);
        const rect = { cx: (ax + bx) / 2, cz: (az + bz) / 2, ux: lot.e[0], uz: lot.e[1], hw: p.w / 2 + .3, hd: l / 2 };
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
      out.clear.push({ ...lot.foot, hw: lot.foot.hw + CLEAR_PAD, hd: lot.foot.hd + CLEAR_PAD }, lot.front);
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
      const [x, z] = at(hw + lot.gap / 2, hd + lot.setback - .9); // between this lot's path and the next one's
      if (passable(x, z)) list.push({ kind: 'street', x, z, r: h(53) });
    }
  }
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
