// Households from the agent model (shared/agents.js) on the city. Each simulated household is a floating marker,
// coloured by rent burden in the shown year; newcomers wear a ring, and households that leave fade out in the year
// they leave. The trunk roads (15-501) are tinted by the model's road load, with travel time on hover.
// Clicking a marker opens that household in the sim panel. "View 15-501" in the panel flies the camera to the corridor
// and back, since the default camera faces away from it.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { scenario, shownYear } from './scenario.js';
import { modelZone } from '../../shared/agents.js';

// Where the model's three zones sit today. The baked map has no street names, so downtown = open ground beside the
// shops clustered along Franklin St, campus = beside UNC's university buildings, edge = beside existing houses near
// the map boundary. Newcomers move into the sim's parcels once their zone has some built (see place()).
const DOWNTOWN = [-800, -900, 0, -300], CAMPUS = [-400, -650, 600, 300]; // x0, z0, x1, z1 in local metres (x east, z south)
const EDGE_TOWN_M = 300, HOUSE = new Set(['detached', 'house', 'semidetached_house', 'residential', 'terrace', 'static_caravan', 'bungalow']); // as in index.html
const HOMES = new Set(['low_res', 'mid_res', 'mixed_use']); // parcel states that hold homes
const GREEN = new THREE.Color('#21c45d'), AMBER = new THREE.Color('#ffae00'), RED = new THREE.Color('#ff3b30'), OWNER = new THREE.Color('#9aa3a8');
const BURDEN = [[.3, GREEN], [.5, AMBER], [Infinity, RED]]; // rent share of income: under 30%, 30-50%, over 50%
const LOAD = [[.8, GREEN], [1, AMBER], [Infinity, RED]]; // road volume / capacity
const band = (bands, v) => bands.find(([max]) => v < max)[1];
const FADE_MS = 900, FLY_MS = 1400, CAPACITY = 800; // markers; the model makes ~350-450 households

export function mountAgentLayer({ scene, camera, controls, dom, osm, zones, at, inside, bounds }) {
  // Spots fixed for the session; a household picks one from its own stable x/y draws.
  const inBox = (box, x, z) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3];
  const beside = keep => { // open ground around the matching buildings
    const pts = [];
    for (const b of osm.b) {
      const [x0, z0, x1, z1] = bounds(b[4]), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (!keep(b, cx, cz)) continue;
      for (const [x, z] of [[x0 - 6, z0 - 6], [x1 + 6, z0 - 6], [x1 + 6, z1 + 6], [x0 - 6, z1 + 6], [cx, z0 - 6], [cx, z1 + 6], [x0 - 6, cz], [x1 + 6, cz]])
        if (!(at(x, z) & 3)) pts.push([x, z]);
    }
    return pts;
  };
  const existing = {
    downtown: beside((b, x, z) => b[3] === 1 && inBox(DOWNTOWN, x, z)),
    campus: beside((b, x, z) => (b[0] === 'university' || b[0] === 'college') && inBox(CAMPUS, x, z)),
    edge: beside((b, x, z) => HOUSE.has(b[0]) && osm.ext - Math.max(Math.abs(x), Math.abs(z)) < EDGE_TOWN_M),
  };
  const parcels = zones.map(zone => { // open ground inside each sim parcel
    const pts = [], [x0, z0, x1, z1] = bounds(zone.ring);
    for (let x = x0 + 4; x < x1; x += 9) for (let z = z0 + 4; z < z1; z += 9) if (!(at(x, z) & 3) && inside(zone.ring, x, z)) pts.push([x, z]);
    return { id: zone.id, zone: modelZone(zone), pts };
  }).filter(p => p.pts.length);
  // A newcomer moves into a parcel its zone had built by the year it arrived; everyone else lives in the existing areas.
  const place = (a, result) => {
    const states = a.joined && result.timeline[a.joined].zoneStates;
    const built = states ? parcels.filter(p => p.zone === a.zone && HOMES.has(states[p.id])) : [];
    if (built.length) { const { pts } = built[Math.floor(a.x * built.length)]; return pts[Math.floor(a.y * pts.length)]; }
    const list = existing[a.zone], [x, z] = list[Math.floor(a.x * list.length)];
    return [x + (a.y - .5) * 5, z + ((a.y * 7919) % 1 - .5) * 5];
  };

  const markerGeo = new THREE.OctahedronGeometry(4.8).scale(1, 1.5, 1).translate(0, 16, 0); // floats above the tree canopy
  const ringGeo = new THREE.TorusGeometry(7.6, .9, 6, 28).rotateX(Math.PI / 2).translate(0, 16, 0);
  const layer = (geo, material) => {
    const m = new THREE.InstancedMesh(geo, material, CAPACITY);
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  const markers = layer(markerGeo, new THREE.MeshBasicMaterial({ toneMapped: false })); // exact colours, not tone mapped
  const rings = layer(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const fadeMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  const leaving = layer(markerGeo, fadeMat);
  markers.setColorAt(0, OWNER); leaving.setColorAt(0, OWNER); // allocate the colour buffers

  // Trunk roads drawn again just above the asphalt in the load colour: wider than the road (15 m, 6 m for links), and
  // clear of fog and tone mapping so the band reads from far away.
  const road = new THREE.Mesh(ribbons(osm.r.filter(([cls]) => cls === 'trunk' || cls === 'trunk_link').map(([cls, , r]) => [r, cls === 'trunk' ? 26 : 12]), .15),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: .92, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
  road.visible = false;
  scene.add(road);

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  let agents = [], result = null, pos = [], shown = '', fadeStart = 0;
  scenario.subscribe(s => {
    if (!s.households) return;
    const t = shownYear(s), key = `${t}`;
    if (s.households.agents !== agents || s.result !== result) { agents = s.households.agents; result = s.result; pos = agents.map(a => place(a, result)); shown = ''; }
    const n = Math.min(agents.length, CAPACITY);
    markers.count = rings.count = leaving.count = n;
    for (let i = 0; i < n; i++) {
      const a = agents[i], here = a.joined <= t && (a.left === null || a.left > t), gone = a.left === t, h = a.hist[t];
      const color = h?.burden == null ? OWNER : band(BURDEN, h.burden), big = a.id === s.resident ? 1.6 : 1;
      _m.compose(_p.set(pos[i][0], 0, pos[i][1]), _q, _s.set(big, big, big));
      markers.setMatrixAt(i, here ? _m : HIDE);
      rings.setMatrixAt(i, here && a.joined > 0 ? _m : HIDE);
      leaving.setMatrixAt(i, gone ? _m : HIDE);
      markers.setColorAt(i, color);
      leaving.setColorAt(i, color);
    }
    for (const m of [markers, rings, leaving]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    markers.instanceColor.needsUpdate = leaving.instanceColor.needsUpdate = true;
    const y = s.averages[t]; // the road shows the averaged runs, like the panel; the markers show one run
    road.material.color.copy(band(LOAD, y.roadRatio));
    road.visible = true;
    road.userData = y;
    if (key !== shown) { shown = key; fadeStart = performance.now(); requestAnimationFrame(fade); } // fade leavers once per year shown
  });
  // Fly to 15-501, looking south from above the town, then back to wherever the camera was. The view centres on
  // Fordham Blvd: the trunk road inside the map east of S Columbia St (x > -270 m; see docs/sources.md), shifted west
  // so the road sits left of the sim panel (looking south, east is on the left).
  let len = 0, cx = 0, cz = 0;
  for (const [cls, , r] of osm.r) if (cls === 'trunk' || cls === 'trunk_link') for (let i = 0; i + 3 < r.length; i += 2) {
    const mx = (r[i] + r[i + 2]) / 2, mz = (r[i + 1] + r[i + 3]) / 2, l = Math.hypot(r[i + 2] - r[i], r[i + 3] - r[i + 1]);
    if (mx > -270 && Math.max(Math.abs(mx), Math.abs(mz)) < osm.ext) { len += l; cx += mx * l; cz += mz * l; }
  }
  const corridorTarget = new THREE.Vector3(cx / len - 150, 0, cz / len);
  const corridor = { target: corridorTarget, position: corridorTarget.clone().add(new THREE.Vector3(0, 650, -900)) };
  let saved = null, flight = null;
  scenario.subscribe(s => {
    if (!!s.roadView === !!saved) return;
    const to = saved ?? corridor;
    saved = saved ? null : { target: controls.target.clone(), position: camera.position.clone() };
    flight = { from: { target: controls.target.clone(), position: camera.position.clone() }, to, t0: performance.now() };
    requestAnimationFrame(fly);
  });
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fly(now) {
    const p = still ? 1 : Math.min(1, (now - flight.t0) / FLY_MS), e = p < .5 ? 2 * p * p : 1 - (2 - 2 * p) ** 2 / 2;
    camera.position.lerpVectors(flight.from.position, flight.to.position, e);
    controls.target.lerpVectors(flight.from.target, flight.to.target, e);
    if (p < 1) requestAnimationFrame(fly);
  }

  function fade(now) {
    const p = Math.min(1, (now - fadeStart) / FADE_MS);
    fadeMat.opacity = 1 - p;
    if (p < 1) requestAnimationFrame(fade);
  }

  // Hover: travel time on the road, a name on a household. Click (not drag) a household to open it.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tip = document.createElement('div');
  tip.className = 'agent-tip';
  tip.hidden = true;
  document.body.append(tip);
  const hit = (e, objects) => {
    const r = dom.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(objects, false)[0];
  };
  let pending = null, down = null;
  dom.addEventListener('pointermove', e => {
    if (pending) { pending = e; return; }
    pending = e;
    requestAnimationFrame(() => {
      const ev = pending;
      pending = null;
      if (ev.buttons || !agents.length) { tip.hidden = true; dom.style.cursor = ''; return; }
      const h = hit(ev, [markers, road]);
      dom.style.cursor = h?.object === markers ? 'pointer' : '';
      if (!h) { tip.hidden = true; return; }
      const y = road.userData;
      tip.textContent = h.object === road
        ? `15-501: ${y.roadTime.toFixed(1)} min travel time · ${Math.round(y.roadRatio * 100)}% of capacity`
        : agents[h.instanceId].name;
      tip.style.left = `${ev.clientX + 14}px`;
      tip.style.top = `${ev.clientY + 14}px`;
      tip.hidden = false;
    });
  });
  dom.addEventListener('pointerleave', () => { tip.hidden = true; });
  dom.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  dom.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const h = hit(e, [markers]);
    if (h) scenario.set({ resident: agents[h.instanceId].id });
  });
}

// Flat quads along each polyline, y metres up: no mitring, the overlay is only a tint.
function ribbons(lines, y) {
  const p = [];
  for (const [r, w] of lines) for (let i = 0; i + 3 < r.length; i += 2) {
    const ax = r[i], az = r[i + 1], bx = r[i + 2], bz = r[i + 3], l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * w / 2, nz = (bx - ax) / l * w / 2;
    p.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}
