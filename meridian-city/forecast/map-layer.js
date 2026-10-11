// Map layer for the forecast: markers for modelled housing on the city, synced to the shared clock.
// ILLUSTRATIVE PLACEMENT: the model predicts how many units complete townwide, not where. Markers sit on the
// sim's candidate parcels (data/zones.geojson) in a fixed order; precise siting would need project records.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { h } from '../policy/components.js';
import { simClock, zonesReady } from '../sim/scenario.js';
import { selectYear } from './cursor.js';

const UNITS_PER_MARKER = 10;
const MAX = 200;

export async function mountForecastMap({ dock, host = document.body }) {
  const zones = (await zonesReady).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const world = await new Promise(res => { const t = setInterval(() => { if (window.city?.view?.scene) { clearInterval(t); res(window.city); } }, 250); });
  const spots = zones.map(z => { let x = 0, y = 0; const n = z.ring.length / 2; for (let i = 0; i < z.ring.length; i += 2) { x += z.ring[i]; y += z.ring[i + 1]; } return [x / n, y / n]; });
  if (!spots.length) return;
  const geo = new THREE.BoxGeometry(14, 10, 14).translate(0, 5, 0);
  const done = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xeb6834 }), MAX);
  const pipe = new THREE.InstancedMesh(new THREE.BoxGeometry(14, 2, 14).translate(0, 1, 0), new THREE.MeshLambertMaterial({ color: 0xe8b33c, transparent: true, opacity: .8 }), MAX);
  for (const m of [done, pipe]) { m.count = 0; m.frustumCulled = false; world.view.scene.add(m); }
  const legend = h('div', { class: 'plate fc-map-legend', hidden: true });
  host.append(legend);
  const M4 = new THREE.Matrix4();

  function place(mesh, n, offset) {
    mesh.count = Math.min(n, MAX);
    for (let i = 0; i < mesh.count; i++) {
      const [x, z] = spots[(i + offset) % spots.length], ring = Math.floor((i + offset) / spots.length);
      M4.makeTranslation(x + ring * 18, 0, z + ring * 18);
      mesh.setMatrixAt(i, M4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  let last = '';
  simClock.subscribe(s => {
    const r = dock.getResult();
    const c = selectYear(r, s);
    const get = id => (r && c.index >= 0 ? r.metrics.find(m => m.id === id)?.series[c.index]?.delta.p50 ?? 0 : 0);
    const built = Math.round(get('housing_net_stock_change') / UNITS_PER_MARKER);
    const building = Math.round(get('housing_under_construction') / UNITS_PER_MARKER);
    const key = `${built}:${building}`;
    if (key === last) return;
    last = key;
    place(done, built, 0);
    place(pipe, building, built);
    legend.hidden = !built && !building;
    legend.innerHTML = `<b>${c.year}: modelled housing (median)</b><br>■ orange: ${built * UNITS_PER_MARKER} additional homes completed<br>` +
      `▬ gold: ${building * UNITS_PER_MARKER} funded units in the pipeline<br><small>Illustrative placement: one marker per ${UNITS_PER_MARKER} units on candidate parcels; ` +
      'the model does not predict locations.</small>';
  });
}
