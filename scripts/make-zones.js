// One-off: derive the sim's zones from the OSM woods already baked into meridian-city/chapel-hill.js (no network).
// Usage: npm run zones   -> data/zones.geojson
import { readFileSync, writeFileSync } from 'node:fs';
import { toLngLat } from '../shared/geo.js';

const COUNT = 30, EDGE_M = 50, CORRIDOR_M = 150, SIMPLIFY_M = 3, ACRE = 4046.86;
const src = readFileSync(new URL('../meridian-city/chapel-hill.js', import.meta.url), 'utf8');
const osm = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const EXT = osm.ext; // the base map only draws inside +-EXT, so zones are clipped to it

const pairs = flat => flat.reduce((a, v, i) => (i % 2 ? a[a.length - 1].push(v) : a.push([v]), a), []);
const signed = r => r.reduce((s, [ax, az], i) => { const [bx, bz] = r[(i + 1) % r.length]; return s + ax * bz - bx * az; }, 0) / 2;
const area = r => Math.abs(signed(r));
function segDist([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
function clip(ring) { // Sutherland-Hodgman against the square +-EXT
  for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    const inside = p => sign * p[axis] <= EXT, out = [];
    ring.forEach((b, i) => {
      const a = ring.at(i - 1), cut = () => { const t = (sign * EXT - a[axis]) / (b[axis] - a[axis]); return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; };
      if (inside(b)) { if (!inside(a)) out.push(cut()); out.push(b); } else if (inside(a)) out.push(cut());
    });
    ring = out;
  }
  return ring;
}
function simplify(pts) { // Douglas-Peucker on an open polyline
  let best = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts.at(-1)); if (d > best) { best = d; at = i; } }
  return best > SIMPLIFY_M ? [...simplify(pts.slice(0, at + 1)).slice(0, -1), ...simplify(pts.slice(at))] : [pts[0], pts.at(-1)];
}

const trunks = osm.r.filter(([cls]) => cls === 'trunk' || cls === 'trunk_link').map(([, , r]) => pairs(r));
const nearTrunk = ring => Math.min(...ring.flatMap(p => trunks.flatMap(t => t.slice(1).map((b, i) => segDist(p, t[i], b)))));

const woods = osm.a.filter(([kind]) => kind === 'wood' || kind === 'forest')
  .map(([, r]) => clip(pairs(r))).filter(r => r.length > 2)
  .map(r => simplify([...r, r[0]]).slice(0, -1)).filter(r => r.length > 2)
  .sort((a, b) => area(b) - area(a)).slice(0, COUNT);

const round6 = v => Math.round(v * 1e6) / 1e6;
const features = woods.map((r, i) => {
  const edgeDistM = Math.round(Math.min(...r.map(([x, z]) => EXT - Math.max(Math.abs(x), Math.abs(z)))));
  const tags = [edgeDistM <= EDGE_M && 'map_edge', nearTrunk(r) <= CORRIDOR_M && 'corridor'].filter(Boolean);
  let ring = r.map(p => toLngLat(p).map(round6));
  if (signed(ring) < 0) ring.reverse(); // RFC 7946: outer rings run counter-clockwise
  return {
    type: 'Feature',
    properties: { id: `zone-${String(i + 1).padStart(2, '0')}`, state: 'forest', areaAcres: Math.round(area(r) / ACRE * 100) / 100, tags, edgeDistM },
    geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
  };
});

const head = { type: 'FeatureCollection', source: 'Largest OSM natural=wood polygons in meridian-city/chapel-hill.js, clipped to the map and simplified by scripts/make-zones.js. Map data (c) OpenStreetMap contributors, ODbL.' };
writeFileSync(new URL('../data/zones.geojson', import.meta.url), `${JSON.stringify(head).slice(0, -1)},"features":[\n${features.map(f => JSON.stringify(f)).join(',\n')}\n]}\n`); // a zone per line
const count = tag => features.filter(f => f.properties.tags.includes(tag)).length;
console.log(`data/zones.geojson: ${features.length} zones, ${Math.round(features.reduce((s, f) => s + f.properties.areaAcres, 0))} acres, ${count('map_edge')} map_edge, ${count('corridor')} corridor`);
