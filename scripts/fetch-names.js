// Bakes names of buildings and landmarks from OpenStreetMap into meridian-city/chapel-hill-names.js,
// so the map can label selected buildings and give landmarks custom art.
// Usage: node scripts/fetch-names.js [raw_overpass.json]   (no arg = fetch from Overpass, retrying while it is busy)
// Same bounding box and local-metre projection as meridian-city/fetch_osm.py. Data (c) OpenStreetMap contributors, ODbL.
import fs from 'node:fs';

const [S, W, N, E] = [35.8959, -79.0675, 35.9211, -79.0365];
const LAT0 = (S + N) / 2, LNG0 = (W + E) / 2;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110574;
const QUERY = `[out:json][timeout:120][bbox:${S},${W},${N},${E}];
(way[building][name];relation[building][name];node[historic][name];node[man_made][name];way[man_made][name];);
out center tags;`;

async function fetchElements() {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', body: new URLSearchParams({ data: QUERY }), headers: { 'user-agent': 'LifeLine-Prosperia/1.0' },
      });
      const text = await res.text();
      if (text.trimStart().startsWith('{')) return JSON.parse(text).elements;
      console.log(`Overpass busy (attempt ${attempt}), retrying in 20 s`);
    } catch (err) {
      console.log(`Overpass unreachable (attempt ${attempt}): ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 20000));
  }
  throw new Error('Overpass unavailable, try again later');
}

const elements = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).elements : await fetchElements();
const round = v => Math.round(v * 10) / 10;
const names = [];
for (const e of elements) {
  const at = e.center ?? (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
  if (!at || !e.tags?.name) continue;
  const t = e.tags;
  const kind = t.historic || t.tourism || t.amenity || t.man_made || t.leisure || t.building || '';
  names.push([round((at.lon - LNG0) * KX), round((LAT0 - at.lat) * KZ), t.name, kind]);
}
const dst = new URL('../meridian-city/chapel-hill-names.js', import.meta.url);
fs.writeFileSync(dst, `window.CHAPEL_HILL_NAMES = ${JSON.stringify(names)};\n`); // a plain script, like chapel-hill.js
console.log(`${dst.pathname}: ${names.length} names`);
