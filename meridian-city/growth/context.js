// A site's surroundings, read once before anything is planned there: the drivable roads and junctions near it, the
// families, materials and setbacks of the buildings around it, and the palette new buildings draw from, so a new
// street reads as part of the neighbourhood it extends. Pure: no DOM, no THREE.
import { FAMILIES, WALLS } from '../world/palette.js';
import { bounds } from '../world/rings.js';
import { DRIVE, SIDEWALK_W, Line, hashStr, hasher } from './geom.js';

const WALKS = new Set(['footway', 'pedestrian', 'path', 'cycleway']);

const NEAR = 160; // metres around a site that count as its surroundings
const AERO_WALLS = new Set(['pearl', 'pearlAqua', 'pearlMint', 'sidingAqua', 'sidingMint']); // the Aero accents the palette always leans to
const HOME_WALLS = new Set(['siding', 'brick', 'stucco', 'pearl', 'stone']); // wall kinds a neighbour's home may lend new homes
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/**
 * Junctions: vertices where three or more drivable street ends or bends meet (as world/streets.js finds them).
 * @param {{cls: string, r: number[]}[]} roads
 */
export function findJunctions(roads) {
  const deg = new Map();
  for (const q of roads) {
    if (!DRIVE.has(q.cls) && q.cls !== 'service') continue;
    const n = q.r.length / 2;
    for (let i = 0; i < n; i++) { const k = `${q.r[2 * i]},${q.r[2 * i + 1]}`; deg.set(k, (deg.get(k) ?? 0) + (i === 0 || i === n - 1 ? 1 : 2)); }
  }
  return [...deg].filter(([, d]) => d >= 3).map(([k]) => k.split(',').map(Number));
}

/**
 * @param {object} o
 * @param {string} o.id the site id (units.js siteOf)
 * @param {{ring: number[]}[]} o.parcels the site's parcels, rings in map metres
 * @param {{cls: string, w: number, r: number[]}[]} o.roads every street (world.streets.roads)
 * @param {number[][]} o.junctions findJunctions(roads)
 * @param {{family: string, cx: number, cz: number, area: number, door?: number[] | null, materials?: {wall: string, roof: string}}[]} o.buildings
 */
export function siteContext({ id, parcels, roads, junctions, buildings }) {
  const box = parcels.map(p => bounds(p.ring)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const near = (x, z, m = NEAR) => x > box[0] - m && x < box[2] + m && z > box[1] - m && z < box[3] + m;
  const lines = [], mid = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], reach = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2 + NEAR;
  const paths = []; // footpaths: apartment blocks and townhouse rows may front one (a door on a pedestrian path)
  for (const q of roads) { // by segment, so a long straight road with no vertex nearby still counts
    const walk = WALKS.has(q.cls);
    if (!DRIVE.has(q.cls) && !walk) continue;
    const line = new Line(q.r);
    if (line.project(...mid).d < reach) (walk ? paths : lines).push({ cls: q.cls, half: q.w / 2, sw: walk ? 0 : SIDEWALK_W, line });
  }
  const around = buildings.filter(b => near(b.cx, b.cz, 120));

  // Setback: how far the neighbours' front doors sit behind the sidewalk.
  const setbacks = [];
  for (const b of around) {
    if (!b.door || b.family !== 'house') continue; // house setbacks: what new houses line up with
    let best = null;
    for (const L of lines) { const p = L.line.project(b.door[0], b.door[1]); if (p && (!best || p.d - L.half < best)) best = p.d - L.half; }
    if (best != null) { const s = best - SIDEWALK_W + 1.2; if (s > 1 && s < 25) setbacks.push(s); } // door points sit 1.2 m in front of the wall
  }
  const families = {}, walls = {}, roofs = {};
  for (const b of around) {
    families[b.family] = (families[b.family] ?? 0) + 1;
    if (b.materials) { walls[b.materials.wall] = (walls[b.materials.wall] ?? 0) + 1; roofs[b.materials.roof] = (roofs[b.materials.roof] ?? 0) + 1; }
  }
  const total = around.length || 1, dense = ((families.apartment ?? 0) + (families.shop ?? 0) + (families.office ?? 0) + (families.campus ?? 0)) / total;

  // The palette: for each family new buildings use, three walls and three roofs, weighted toward what the neighbours
  // already use and toward the Aero accents, picked by the site's own hash so it never changes between loads.
  const h = hasher(`site:${id}`);
  const top = (list, counts, k, salt, bonus = () => 0) => {
    const scored = [...new Set(list)].map((key, i) => ({ key, w: (1 + 40 * (counts[key] ?? 0) / total + bonus(key)) * (.35 + h(salt + i)) }));
    return scored.sort((a, b) => b.w - a.w || (a.key < b.key ? -1 : 1)).slice(0, k).map(s => s.key);
  };
  const palette = {}, local = Object.keys(walls).filter(k => walls[k] >= 2 && HOME_WALLS.has(WALLS[k]?.kind)).sort(); // the street's own materials
  for (const fam of ['house', 'apartment']) {
    const F = FAMILIES[fam];
    palette[fam] = {
      walls: top([...F.walls, ...local], walls, 3, fam === 'house' ? 10 : 40, k => (AERO_WALLS.has(k) ? 1.5 : 0)),
      roofs: top(F.roofs, roofs, 3, fam === 'house' ? 70 : 90),
    };
  }
  return {
    id, box, lines, paths, junctions: junctions.filter(([x, z]) => near(x, z)),
    setback: median(setbacks) ?? 6, dense, families, palette, seed: hashStr(`site:${id}`),
  };
}
