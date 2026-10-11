// One-off: derive the sim's zones from the OSM woods and parking lots already baked into meridian-city/chapel-hill.js
// (no network). The 30 largest woods are cut into ~1-acre parcels, so policies spread through a wood year by year
// instead of flipping it whole; each parking lot is one zone. Usage: npm run zones   -> data/zones.geojson
import { readFileSync, writeFileSync } from 'node:fs';
import { toLngLat } from '../shared/geo.js';

const COUNT = 30, PARCEL_M = 64, MIN_ACRES = .1, EDGE_M = 50, CORRIDOR_M = 150, NEAR_M = 100, SIMPLIFY_M = 3, ACRE = 4046.86;
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
function clip(ring, [x0, z0, x1, z1]) { // Sutherland-Hodgman against a box
  for (const [axis, sign, bound] of [[0, 1, x1], [0, -1, x0], [1, 1, z1], [1, -1, z0]]) {
    const inside = p => sign * p[axis] <= sign * bound, out = [];
    ring.forEach((b, i) => {
      const a = ring.at(i - 1), cut = () => { const t = (bound - a[axis]) / (b[axis] - a[axis]); return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; };
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
  .map(([, r]) => clip(pairs(r), [-EXT, -EXT, EXT, EXT])).filter(r => r.length > 2)
  .map(r => simplify([...r, r[0]]).slice(0, -1)).filter(r => r.length > 2)
  .sort((a, b) => area(b) - area(a)).slice(0, COUNT);

const round6 = v => Math.round(v * 1e6) / 1e6, pad = n => String(n).padStart(2, '0');
const edgeDist = r => Math.round(Math.min(...r.map(([x, z]) => EXT - Math.max(Math.abs(x), Math.abs(z)))));
// A parcel takes its wood's tags (so "tag:map_edge" means the whole edge wood) plus "wood-NN", but keeps its own
// edge distance, so conversion creeps in from the map edge.
const features = woods.flatMap((r, i) => {
  const tags = [edgeDist(r) <= EDGE_M && 'map_edge', nearTrunk(r) <= CORRIDOR_M && 'corridor', `wood-${pad(i + 1)}`].filter(Boolean);
  const xs = r.map(p => p[0]), zs = r.map(p => p[1]), parcels = [];
  for (let x = Math.floor(Math.min(...xs) / PARCEL_M) * PARCEL_M; x < Math.max(...xs); x += PARCEL_M)
    for (let z = Math.floor(Math.min(...zs) / PARCEL_M) * PARCEL_M; z < Math.max(...zs); z += PARCEL_M) {
      const p = clip(r, [x, z, x + PARCEL_M, z + PARCEL_M]);
      if (p.length > 2 && area(p) / ACRE >= MIN_ACRES) parcels.push(p);
    }
  return parcels.map((p, j) => {
    const ring = p.map(q => toLngLat(q).map(round6));
    if (signed(ring) < 0) ring.reverse(); // RFC 7946: outer rings run counter-clockwise
    return {
      type: 'Feature',
      properties: { id: `zone-${pad(i + 1)}-${pad(j + 1)}`, state: 'forest', areaAcres: Math.round(area(p) / ACRE * 100) / 100, tags, edgeDistM: edgeDist(p) },
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
    };
  });
});

// Parking lots: each OSM amenity=parking polygon, clipped to the map, is one zone in state "parking", tagged "parking" plus
// near_campus (within NEAR_M of a university, dormitory or hospital building) and downtown (within NEAR_M of a retail or
// commercial building, which line Franklin St). They never take the woods' tags, so a forest card's pool, and so its
// results, are the same as before the lots were added.
const near = kinds => {
  const rings = osm.b.filter(([kind]) => kinds.includes(kind)).map(b => pairs(b[4]));
  return r => rings.some(b => r.some(p => b.some((q, i) => segDist(p, b.at(i - 1), q) <= NEAR_M)));
};
const nearCampus = near(['university', 'dormitory', 'hospital']), nearDowntown = near(['retail', 'commercial']);
const lots = osm.a.filter(([kind]) => kind === 'parking')
  .map(([, r]) => clip(pairs(r), [-EXT, -EXT, EXT, EXT])).filter(r => r.length > 2)
  .map(r => simplify([...r, r[0]]).slice(0, -1)).filter(r => r.length > 2 && area(r) / ACRE >= MIN_ACRES)
  .sort((a, b) => area(b) - area(a));
features.push(...lots.map((r, i) => {
  const ring = r.map(q => toLngLat(q).map(round6));
  if (signed(ring) < 0) ring.reverse();
  return {
    type: 'Feature',
    properties: { id: `parking-${String(i + 1).padStart(3, '0')}`, state: 'parking', areaAcres: Math.round(area(r) / ACRE * 100) / 100,
      tags: ['parking', nearCampus(r) && 'near_campus', nearDowntown(r) && 'downtown'].filter(Boolean), edgeDistM: edgeDist(r) },
    geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
  };
}));

const head = { type: 'FeatureCollection', source: 'The 30 largest OSM natural=wood polygons in meridian-city/chapel-hill.js, clipped to the map, simplified and cut into ~1-acre parcels, and its amenity=parking polygons, one zone each, by scripts/make-zones.js. Map data (c) OpenStreetMap contributors, ODbL.' };
writeFileSync(new URL('../data/zones.geojson', import.meta.url), `${JSON.stringify(head).slice(0, -1)},"features":[\n${features.map(f => JSON.stringify(f)).join(',\n')}\n]}\n`); // a zone per line
const count = tag => features.filter(f => f.properties.tags.includes(tag)).length;
const acres = tag => Math.round(features.filter(f => f.properties.tags.includes(tag)).reduce((s, f) => s + f.properties.areaAcres, 0));
console.log(`data/zones.geojson: ${features.length - lots.length} parcels in ${woods.length} woods, ${Math.round(features.reduce((s, f) => s + (f.properties.state === 'forest' ? f.properties.areaAcres : 0), 0))} acres; map_edge ${count('map_edge')} (${acres('map_edge')} acres), corridor ${count('corridor')} (${acres('corridor')} acres); ${lots.length} parking lots (${acres('parking')} acres), near_campus ${count('near_campus')} (${acres('near_campus')} acres), downtown ${count('downtown')} (${acres('downtown')} acres)`);
