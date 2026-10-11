// Households from the agent model (shared/agents.js) on the city. Each simulated household is a floating marker,
// coloured by rent burden in the shown year; newcomers wear a ring, and households that leave fade out over the start of
// the year they leave. Markers keep one size on screen at every zoom and draw over buildings and trees with the world's
// ink outline, so they read as data, apart from the street-life walkers. The trunk roads (15-501) carry a thin tint in
// the model's road load colour, with travel time on hover. Clicking a marker opens that household in the sim panel.
// "View 15-501" in the panel pans, zooms and turns the view to the corridor, and back to where it was.
// Everything follows the shared clock (clock.js): the year it shows, and the run behind that year.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { scenario, simClock, onFrame } from './scenario.js';
import { modelZone } from '../../shared/agents.js';
import { inside, bounds } from '../world/geometry.js';
import { ZOOMS, PIXEL_SCALE, CAMERA, P } from '../world/palette.js';

// Where the model's zones sit today. The baked map has no street names, so downtown = open ground beside the
// shops clustered along Franklin St, campus = beside UNC's university buildings, edge = beside existing houses near
// the map boundary. Newcomers move into the sim's parcels once their zone has some built (see place()); the corridor
// zone has no households until its parcels are built, so it needs no spot of its own.
const DOWNTOWN = [-800, -900, 0, -300], CAMPUS = [-400, -650, 600, 300]; // x0, z0, x1, z1 in local metres (x east, z south)
const EDGE_TOWN_M = 300, HOUSE = new Set(['detached', 'house', 'semidetached_house', 'residential', 'terrace', 'static_caravan', 'bungalow']);
const HOMES = new Set(['low_res', 'mid_res', 'mixed_use']); // parcel states that hold homes
const GREEN = new THREE.Color('#21c45d'), AMBER = new THREE.Color('#ffae00'), RED = new THREE.Color('#ff3b30'), OWNER = new THREE.Color('#9aa3a8');
const BURDEN = [[.3, GREEN], [.5, AMBER], [Infinity, RED]]; // rent share of income: under 30%, 30-50%, over 50%
const LOAD = [[.8, GREEN], [1, AMBER], [Infinity, RED]]; // road volume / capacity
const band = (bands, v) => bands.find(([max]) => v < max)[1];
const CAPACITY = 800; // markers; the model makes ~350-450 households
const MARKER_PX = 9, LIFT_PX = 6, BORDER_PX = 1.5; // marker width, how far it floats and its ink border, in rendered pixels at every zoom
const FADE_YEARS = .4; // leavers fade out over this much of their last year's simulated time; paused, they stay faint
const FLY_MS = 1400;
// The road tint, mixed into the asphalt colour: subtle by default, strong on hover or in the 15-501 view. Its width is
// a share of the carriageway, never under 3 rendered pixels so it survives the far zooms.
const ASPHALT = new THREE.Color(P.asphalt), TINT = { rest: .35, focus: .9 }, TINT_SHARE = .4, TINT_MIN_PX = 3;
const COS_EL = Math.cos(THREE.MathUtils.degToRad(CAMERA.elevationDeg)), SIN_EL = Math.sin(THREE.MathUtils.degToRad(CAMERA.elevationDeg));

export function mountAgentLayer({ world, osm, zones }) {
  const { view } = world, { scene } = view, dom = view.renderer.domElement, at = world.gridAt;

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

  // Unit-wide shapes, scaled per zoom. Drawn after the city with no depth test, so buildings and trees never hide them.
  // Each marker sits on a slightly larger shell in the world's ink colour: a border that keeps the rent colours apart
  // from the autumn tree canopies, which share their hues.
  const markerGeo = new THREE.OctahedronGeometry(.5).scale(1, 1.5, 1).translate(0, .75, 0);
  const ringGeo = new THREE.TorusGeometry(.85, .17, 4, 16).rotateX(Math.PI / 2).translate(0, .75, 0);
  const layer = (geo, material, order) => {
    const m = new THREE.InstancedMesh(geo, material, CAPACITY);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = order; // above the zone highlights (997, 998) and the building selection (999)
    scene.add(m);
    return m;
  };
  const overlay = o => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, ...o }); // transparent: drawn after the zone fills
  const rings = layer(ringGeo, overlay({ color: 0xffffff }), 1000);
  const shells = layer(markerGeo, overlay({ color: P.ink }), 1001);
  const markers = layer(markerGeo, overlay({}), 1002);
  const fadeMat = overlay({ depthWrite: false });
  const leaving = layer(markerGeo, fadeMat, 1002);
  markers.setColorAt(0, OWNER); leaving.setColorAt(0, OWNER); // allocate the colour buffers

  // 15-501: the trunk roads inside the map. The tint covers the middle of each carriageway, clipped to the map's edge.
  const E = osm.ext;
  const trunks = world.streets.roads.filter(q => q.cls === 'trunk' || q.cls === 'trunk_link');
  // Between the asphalt (polygon offset -4) and the lane markings (-6) in streets.js, so the markings paint over it.
  const roadMat = new THREE.MeshBasicMaterial({ color: ASPHALT, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 });
  const road = new THREE.Mesh(new THREE.BufferGeometry(), roadMat);
  road.visible = false;
  scene.add(road);
  let roadPpm = 0;
  function shapeRoad(ppm) { // the tint's width depends on the zoom, so it is rebuilt when the zoom level changes
    roadPpm = ppm;
    road.geometry.dispose();
    road.geometry = ribbons(trunks.map(q => [q.r, Math.min(q.w, Math.max(q.w * TINT_SHARE, TINT_MIN_PX / ppm))]), .06, E);
  }

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  let run = null, agents = [], pos = [], t = -1, resident = null, drawnPpm = 0;
  function draw() { // every marker for the shown year, at the current zoom
    const ppm = drawnPpm = view.ppm, size = MARKER_PX / ppm, lift = LIFT_PX / (ppm * COS_EL), border = 2 * BORDER_PX / ppm;
    const n = Math.min(agents.length, CAPACITY);
    markers.count = shells.count = rings.count = leaving.count = n;
    for (let i = 0; i < n; i++) {
      const a = agents[i], here = a.joined <= t && (a.left === null || a.left > t), gone = a.left === t, h = a.hist[t];
      const color = h?.burden == null ? OWNER : band(BURDEN, h.burden), s = size * (a.id === resident ? 1.6 : 1);
      _m.compose(_p.set(pos[i][0], lift, pos[i][1]), _q, _s.set(s, s, s));
      markers.setMatrixAt(i, here ? _m : HIDE);
      rings.setMatrixAt(i, here && a.joined > 0 ? _m : HIDE);
      _m.compose(_p.set(pos[i][0], lift - .75 * border, pos[i][1]), _q, _s.set(s + border, s + border, s + border)); // centred on the marker
      shells.setMatrixAt(i, here ? _m : HIDE);
      leaving.setMatrixAt(i, gone ? _m : HIDE);
      markers.setColorAt(i, color);
      leaving.setColorAt(i, color);
    }
    for (const m of [markers, shells, rings, leaving]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    markers.instanceColor.needsUpdate = leaving.instanceColor.needsUpdate = true;
  }

  let hovered = false, saved = null;
  const tint = () => { roadMat.color.copy(ASPHALT).lerp(road.userData.color, hovered || saved ? TINT.focus : TINT.rest); };
  simClock.subscribe(({ shown, before, frac }) => {
    if (!shown?.data) return;
    const r = shown.data.run, y = before ? 0 : shown.step;
    fadeMat.opacity = .55 * (1 - (shown.tween && !before ? Math.min(1, frac / FADE_YEARS) : 0));
    if (r === run && y === t) return; // the clock emits every frame while playing
    if (r !== run) { run = r; agents = r.households.agents; pos = agents.map(a => place(a, r.result)); }
    t = y;
    draw();
    const load = run.averages[y]; // the road shows the averaged runs, like the panel; the markers show one run
    road.userData = { ...load, color: band(LOAD, load.roadRatio) };
    tint();
    road.visible = true;
  });
  scenario.subscribe(s => {
    if (s.resident !== resident) { resident = s.resident; if (run) draw(); }
    if (!!s.roadView !== !!saved) roadView(!!s.roadView);
  });

  // View 15-501 and back. The corridor is the trunk road inside the map east of S Columbia St (x > -270 m; see
  // docs/sources.md). The view turns a quarter if that lays the road more across the screen, takes the closest zoom
  // level that fits it, and centres it in the part of the screen the sim panel leaves free.
  const seg = [];
  for (const { r } of trunks) for (let i = 0; i + 3 < r.length; i += 2) {
    const mx = (r[i] + r[i + 2]) / 2, mz = (r[i + 1] + r[i + 3]) / 2;
    if (mx > -270 && Math.max(Math.abs(mx), Math.abs(mz)) < E) seg.push([r[i], r[i + 1], r[i + 2], r[i + 3]]);
  }
  let len = 0, cx = 0, cz = 0, dxx = 0, dxz = 0, dzz = 0; // length-weighted centre and direction tensor
  for (const [ax, az, bx, bz] of seg) {
    const l = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / (l || 1), uz = (bz - az) / (l || 1);
    len += l; cx += (ax + bx) / 2 * l; cz += (az + bz) / 2 * l; dxx += ux * ux * l; dxz += ux * uz * l; dzz += uz * uz * l;
  }
  cx /= len; cz /= len;
  const ang = Math.atan2(2 * dxz, dxx - dzz) / 2, dir = [Math.cos(ang), Math.sin(ang)]; // the corridor's main direction
  const right = az => [Math.cos(az), -Math.sin(az)], fwd = az => [-Math.sin(az), -Math.cos(az)]; // on the ground, as the camera sees it
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  let azGoal = view.azimuth;
  view.onChange(({ azimuth }) => { azGoal = azimuth; });
  function corridorView() {
    const turn = Math.abs(dot(dir, right(azGoal + Math.PI / 2))) > Math.abs(dot(dir, right(azGoal))) + .1 ? 1 : 0, az = azGoal + turn * Math.PI / 2;
    const span = axis => { const v = seg.flatMap(([ax, az0, bx, bz]) => [dot([ax, az0], axis), dot([bx, bz], axis)]); return Math.max(...v) - Math.min(...v); };
    const w = dom.clientWidth, h = dom.clientHeight, plate = document.querySelector('.plate.sim')?.getBoundingClientRect();
    const free = plate && plate.width && plate.left > w / 2 ? plate.left : w; // the map left of the panel
    const across = span(right(az)), up = span(fwd(az)) * SIN_EL;
    let level = 0;
    ZOOMS.forEach((z, i) => { const k = z * PIXEL_SCALE; if (across * k <= free * .85 && up * k <= h * .75) level = i; });
    const shift = (w / 2 - free / 2) / (ZOOMS[level] * PIXEL_SCALE), [rx, rz] = right(az);
    return { x: cx + rx * shift, z: cz + rz * shift, level, turn };
  }
  let flight = null;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function roadView(on) {
    if (on) {
      saved = { x: view.target.x, z: view.target.z, level: view.level, azimuth: azGoal };
      const to = corridorView();
      view.rotate(to.turn);
      view.zoomTo(to.level);
      flight = { x0: view.target.x, z0: view.target.z, x1: to.x, z1: to.z, p: 0 };
    } else {
      const back = saved;
      saved = null;
      view.rotate(Math.round((back.azimuth - azGoal) / (Math.PI / 2)));
      view.zoomTo(back.level);
      flight = { x0: view.target.x, z0: view.target.z, x1: back.x, z1: back.z, p: 0 };
    }
    if (road.userData.color) tint();
  }

  onFrame(dt => { // real time: the camera moves while the sim is paused
    if (flight) {
      flight.p = still ? 1 : Math.min(1, flight.p + dt * 1000 / FLY_MS);
      const p = flight.p, e = p < .5 ? 2 * p * p : 1 - (2 - 2 * p) ** 2 / 2;
      view.lookAt(flight.x0 + (flight.x1 - flight.x0) * e, flight.z0 + (flight.z1 - flight.z0) * e);
      if (p === 1) flight = null;
    }
    if (run && view.ppm !== drawnPpm) draw();
    if (!roadPpm || Math.abs(Math.log(view.ppm / roadPpm)) > .2) shapeRoad(view.ppm); // as the zoom eases, not every frame
  });

  // Hover: a name on a household, travel time on the road. Click (not drag) a household to open it.
  const tip = document.createElement('div');
  tip.className = 'agent-tip';
  tip.hidden = true;
  document.body.append(tip);
  const hit = e => view.raycastScreen(e.clientX, e.clientY, [markers])[0] ?? view.raycastScreen(e.clientX, e.clientY, [road])[0];
  const hover = on => { if (hovered !== on) { hovered = on; tint(); } };
  let pending = null, down = null;
  dom.addEventListener('pointermove', e => {
    if (pending) { pending = e; return; }
    pending = e;
    requestAnimationFrame(() => {
      const ev = pending;
      pending = null;
      if (ev.buttons || !run) { tip.hidden = true; dom.style.cursor = ''; hover(false); return; }
      const h = hit(ev);
      dom.style.cursor = h?.object === markers ? 'pointer' : '';
      hover(h?.object === road);
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
  dom.addEventListener('pointerleave', () => { tip.hidden = true; hover(false); });
  dom.addEventListener('pointerdown', e => { if (e.button === 0) down = [e.clientX, e.clientY, performance.now()]; });
  // Capture phase on window, like walker picking (traffic.js), which listens first. A marker draws over walkers and
  // buildings, so it wins: claim the click so building selection skips it (select.js), and close any card a walker
  // opened. Never stop the event: the map's pan control needs the release, or it keeps dragging.
  addEventListener('pointerup', e => {
    const d = down;
    down = null;
    if (!d || e.target !== dom || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5 || performance.now() - d[2] > 450 || !run) return;
    const h = view.raycastScreen(e.clientX, e.clientY, [markers])[0];
    if (!h) return;
    e.preventDefault();
    world.traffic.select(null);
    world.selection.select(null);
    scenario.set({ resident: agents[h.instanceId].id });
  }, true);
}

// Flat quads along each polyline, y metres up, kept inside |x|, |z| <= ext less half their width: no mitring, the overlay
// is only a tint.
function ribbons(lines, y, ext) {
  const p = [];
  for (const [r, w] of lines) for (let i = 0; i + 3 < r.length; i += 2) {
    const c = clip(r[i], r[i + 1], r[i + 2], r[i + 3], ext - w / 2);
    if (!c) continue;
    const [ax, az, bx, bz] = c, l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * w / 2, nz = (bx - ax) / l * w / 2;
    p.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}

// The part of segment a-b inside the square |x|, |z| <= e (Liang-Barsky), or null.
function clip(ax, az, bx, bz, e) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax + e], [dx, e - ax], [-dz, az + e], [dz, e - az]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const k = q / p;
    if (p < 0) { if (k > t1) return null; t0 = Math.max(t0, k); } else { if (k < t0) return null; t1 = Math.min(t1, k); }
  }
  return [ax + dx * t0, az + dz * t0, ax + dx * t1, az + dz * t1];
}
