// Draws a scenario's physical changes into the Meridian City scene: new apartment buildings rising on real downtown and
// campus parking lots (from the model's project events), Chapel Hill Transit buses in proportion to bus service, protected
// bike lanes as the network is built, and car density following the traffic index. It only reads simulation output;
// nothing here feeds back into the model.

const VISIBLE_ZONES = { downtown: [-451, -719], campus: [361, 276] }; // the zones inside the rendered map (see sim/data.js reps)
const ZONE_REPS = { ...VISIBLE_ZONES, north: [-361, -3483], east: [3066, -2377], south: [-1470, 2300] };
const FLOOR = 3.6, BASE_BUSES = 10, BASE_CAR_SHARE = 0.85;

export function mountCityEffects(m) {
  const { THREE, scene, OSM, lanes, nodes, MAJOR, M, area, carMesh, cars } = m;
  const root = new THREE.Group();
  root.name = 'simulation-effects';
  scene.add(root);

  // ---------- materials ----------
  const facadeTex = (() => { // one 3 m bay × one 3.6 m floor of curtain wall, tiled in metres by ExtrudeGeometry's world UVs
    const c = document.createElement('canvas'); c.width = 64; c.height = 76;
    const g = c.getContext('2d');
    g.fillStyle = '#e9f3f5'; g.fillRect(0, 0, 64, 76);
    const sky = g.createLinearGradient(0, 0, 0, 60); sky.addColorStop(0, '#7fc9de'); sky.addColorStop(1, '#3d8fae');
    g.fillStyle = sky; g.fillRect(5, 8, 54, 56);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(5, 8, 54, 6);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 3, 1 / FLOOR); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  })();
  const glass = new THREE.MeshStandardMaterial({ map: facadeTex, roughness: .18, metalness: .35, envMap: m.env, envMapIntensity: 1 });
  const glassNew = glass.clone(); glassNew.color = new THREE.Color('#c8fbff'); glassNew.emissive = new THREE.Color('#0f6f7a'); glassNew.emissiveIntensity = .18;
  const roof = new THREE.MeshStandardMaterial({ color: '#eef2f3', roughness: .7 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#cfccc6', roughness: .9 });
  const shell = new THREE.MeshStandardMaterial({ map: facadeTex, color: '#9a9690', roughness: .85 });
  const craneMat = new THREE.MeshStandardMaterial({ color: '#f2b632', roughness: .5, metalness: .3 });
  const fenceMat = new THREE.MeshStandardMaterial({ color: '#2f8f5b', roughness: .8 });

  // ---------- candidate sites: OSM parking lots in the visible zones, biggest first ----------
  const sites = {};
  for (const [kind, r] of OSM.a) {
    if (kind !== 'parking') continue;
    const a = area(r);
    if (a < 900) continue;
    let cx = 0, cz = 0;
    for (let i = 0; i < r.length; i += 2) { cx += r[i]; cz += r[i + 1]; }
    cx /= r.length / 2; cz /= r.length / 2;
    const zone = Object.entries(ZONE_REPS).sort((p, q) => Math.hypot(p[1][0] - cx, p[1][1] - cz) - Math.hypot(q[1][0] - cx, q[1][1] - cz))[0][0];
    if (!VISIBLE_ZONES[zone]) continue;
    (sites[zone] ??= []).push({ r, a, cx, cz });
  }
  for (const list of Object.values(sites)) list.sort((p, q) => q.a - p.a);

  function footprint(site, targetArea) {
    const k = Math.sqrt(Math.min(0.8, targetArea / site.a));
    const shape = new THREE.Shape();
    for (let i = 0; i < site.r.length; i += 2) {
      const x = site.cx + (site.r[i] - site.cx) * k, z = site.cz + (site.r[i + 1] - site.cz) * k;
      i ? shape.lineTo(x, -z) : shape.moveTo(x, -z);
    }
    return shape;
  }

  function makeBuilding(p, site, extra) {
    const height = p.floors * FLOOR + 1.5;
    const target = p.units * 95 * 1.15 / p.floors; // m² per floor: ~950 sf homes plus corridors
    const shape = footprint(site, target);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }).rotateX(-Math.PI / 2);
    const body = new THREE.Mesh(geo, [roof, glass]);
    body.castShadow = body.receiveShadow = true;
    const box = new THREE.Box3().setFromObject(body), size = box.getSize(new THREE.Vector3());
    // tower crane at the footprint's corner
    const crane = new THREE.Group(), mastH = height + 14;
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, mastH, 1.6), craneMat); mast.position.y = mastH / 2;
    const jib = new THREE.Mesh(new THREE.BoxGeometry(34, 1.2, 1.2), craneMat); jib.position.set(10, mastH, 0);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 2.4), concrete); counter.position.set(-6, mastH - .6, 0);
    crane.add(mast, jib, counter);
    crane.position.set(box.min.x + 2, 0, box.min.z + 2);
    crane.rotation.y = Math.atan2(size.z, size.x);
    for (const c of crane.children) c.castShadow = true;
    // construction fence: four thin hoardings around the footprint
    const fence = new THREE.Group(), fx = size.x + 6, fz = size.z + 6, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    for (const [w, d, x, z] of [[fx, .25, cx, cz - fz / 2], [fx, .25, cx, cz + fz / 2], [.25, fz, cx - fx / 2, cz], [.25, fz, cx + fx / 2, cz]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), fenceMat);
      wall.position.set(x, 1.1, z);
      fence.add(wall);
    }
    const g = new THREE.Group(); g.add(body, crane, fence); g.visible = false;
    root.add(g);
    return { p, g, body, crane, fence, extra, height };
  }

  // ---------- buses: Chapel Hill Transit, on major roads only ----------
  const busGeo = (() => {
    const parts = [[new THREE.BoxGeometry(12, 2.4, 2.55), 0, 1.75, 0, '#ffffff'], [new THREE.BoxGeometry(11.6, .9, 2.6), 0, 2.15, 0, '#1d3a52'], [new THREE.BoxGeometry(12.02, .5, 2.57), 0, .75, 0, '#4b9cd3']];
    const geos = parts.map(([geo, x, y, z, c]) => {
      const gg = geo.toNonIndexed().translate(x, y, z), col = new THREE.Color(c), n = gg.attributes.position.count;
      gg.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [col.r, col.g, col.b][i % 3]), 3));
      return gg;
    });
    const merged = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'color']) {
      const arrays = geos.map(gg => gg.attributes[key].array), len = arrays.reduce((s, a) => s + a.length, 0), out = new Float32Array(len);
      let o = 0; for (const a of arrays) { out.set(a, o); o += a.length; }
      merged.setAttribute(key, new THREE.BufferAttribute(out, 3));
    }
    return merged;
  })();
  const busRoads = lanes.filter(q => MAJOR.has(q.cls) && q.len > 120);
  const MAX_BUSES = 24;
  const busMesh = new THREE.InstancedMesh(busGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .2 }), MAX_BUSES);
  busMesh.castShadow = true; busMesh.frustumCulled = false; busMesh.count = 0;
  root.add(busMesh);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const buses = Array.from({ length: MAX_BUSES }, (_, i) => {
    const q = busRoads[Math.floor(rnd() * busRoads.length)], d = q.ow || (rnd() < .5 ? 1 : -1), f = Math.floor(rnd() * (q.r.length / 2 - 1));
    return { q, f: d > 0 ? f : f + 1, d, s: 0, v: 9 + rnd() * 2, i };
  });
  function busTurn(c) { // like the cars, but stay on major roads where one meets this corner
    const k = c.f + c.d, opts = [], major = [];
    for (const [q, j] of nodes.get(c.q.r[2 * k] + ',' + c.q.r[2 * k + 1]) ?? [])
      for (const d of [1, -1]) if (j + d >= 0 && j + d < q.r.length / 2 && (!q.ow || d === q.ow) && !(q === c.q && j === k && d === -c.d)) (MAJOR.has(q.cls) ? major : opts).push([q, j, d]);
    const pickFrom = major.length ? major : opts;
    [c.q, c.f, c.d] = pickFrom.length ? pickFrom[Math.floor(rnd() * pickFrom.length)] : [c.q, k, -c.d];
  }
  function moveBuses(dt) {
    for (let i = 0; i < busMesh.count; i++) {
      const c = buses[i];
      let ax, az, bx, bz, l;
      for (c.s += c.v * dt; ; c.s -= l, busTurn(c)) {
        const r = c.q.r; ax = r[2 * c.f]; az = r[2 * c.f + 1]; bx = r[2 * (c.f + c.d)]; bz = r[2 * (c.f + c.d) + 1]; l = Math.hypot(bx - ax, bz - az);
        if (c.s <= l) break;
      }
      const ux = (bx - ax) / l, uz = (bz - az) / l, o = c.q.ow ? 0 : c.q.w / 4;
      busMesh.setMatrixAt(i, M(ax + ux * c.s - uz * o, .1, az + uz * c.s + ux * o, Math.atan2(-uz, ux)));
    }
    busMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- protected bike lanes: green paint and a kerb along major roads, nearest downtown first ----------
  const bikeSegs = [];
  for (const q of lanes.filter(q => MAJOR.has(q.cls))) for (let i = 0; i + 2 < q.r.length; i += 2) {
    const ax = q.r[i], az = q.r[i + 1], bx = q.r[i + 2], bz = q.r[i + 3], l = Math.hypot(bx - ax, bz - az);
    if (l < 2) continue;
    const ux = (bx - ax) / l, uz = (bz - az) / l;
    for (const side of [-1, 1]) {
      const o = side * (q.w / 2 - 1.1);
      bikeSegs.push({ x: (ax + bx) / 2 - uz * o, z: (az + bz) / 2 + ux * o, ry: Math.atan2(-uz, ux), l, dist: Math.hypot((ax + bx) / 2 + 451, (az + bz) / 2 + 719) });
    }
  }
  bikeSegs.sort((p, q) => p.dist - q.dist);
  const laneGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const laneMesh = new THREE.InstancedMesh(laneGeo, new THREE.MeshStandardMaterial({ color: '#3fae5a', roughness: .7, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }) /* above asphalt (4) and paint (5) */, bikeSegs.length);
  const kerbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .25, .3), new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: .6 }), bikeSegs.length);
  bikeSegs.forEach((s, i) => {
    laneMesh.setMatrixAt(i, M(s.x, .11, s.z, s.ry, s.l, 1, 1.7));
    kerbMesh.setMatrixAt(i, M(s.x, .12, s.z, s.ry, s.l * .9, 1, 1));
  });
  laneMesh.count = kerbMesh.count = 0; laneMesh.receiveShadow = true; kerbMesh.castShadow = true;
  laneMesh.frustumCulled = kerbMesh.frustumCulled = false; // instances span the map; the unit geometry's bounds don't
  root.add(laneMesh, kerbMesh);
  const bikeLengthM = bikeSegs.reduce((s, x) => s + x.l, 0) / 2; // two sides per street

  // ---------- state ----------
  let scenario = null, built = [];
  const carTotal = cars.length;
  carMesh.count = Math.round(carTotal * BASE_CAR_SHARE);

  function setScenario(result) {
    for (const b of built) { root.remove(b.g); b.body.geometry.dispose(); }
    built = [];
    scenario = result;
    if (!result) { busMesh.count = 0; laneMesh.count = kerbMesh.count = 0; carMesh.count = Math.round(carTotal * BASE_CAR_SHARE); return; }
    const used = {}, baseCount = {};
    for (const e of result.mid.baseline.events) baseCount[e.zone] = (baseCount[e.zone] ?? 0) + 1;
    const rank = {};
    for (const p of result.mid.policy.events) {
      if (!sites[p.zone]) continue;
      rank[p.zone] = (rank[p.zone] ?? 0) + 1;
      const site = sites[p.zone][used[p.zone] = (used[p.zone] ?? -1) + 1];
      if (!site) continue;
      built.push(makeBuilding(p, site, rank[p.zone] > (baseCount[p.zone] ?? 0)));
    }
  }

  // t: fractional quarter index into the scenario (0 = 2027 Q1)
  function setTime(t) {
    if (!scenario) return;
    const s = scenario.mid.policy.series, q = Math.max(0, Math.min(s.length - 1, Math.floor(t)));
    for (const b of built) {
      const { p } = b;
      if (t < p.q) { b.g.visible = false; continue; }
      b.g.visible = true;
      const f = Math.min(1, (t - p.q) / (p.doneQ - p.q));
      const done = f >= 1;
      b.body.scale.y = done ? 1 : Math.max(.04, Math.ceil(f * p.floors) / p.floors * .98);
      b.body.material = done ? [roof, b.extra ? glassNew : glass] : [concrete, shell];
      b.crane.visible = !done;
      b.fence.visible = !done;
    }
    busMesh.count = Math.min(MAX_BUSES, Math.round(BASE_BUSES * s[q].serviceLevel));
    const want = Math.min(bikeLengthM, s[q].bikeKm / 12 * 6000); // about half of a 12 km network falls inside this map
    let len = 0, n = 0;
    while (n < bikeSegs.length && len < want * 2) len += bikeSegs[n++].l;
    laneMesh.count = kerbMesh.count = n;
    laneMesh.instanceMatrix.needsUpdate = kerbMesh.instanceMatrix.needsUpdate = true;
    carMesh.count = Math.min(carTotal, Math.round(carTotal * BASE_CAR_SHARE * s[q].trafficIndex));
  }

  // glide the camera to look at a point on the map
  let flight = null;
  function focus(x, z, dist = 520) {
    const { camera, controls } = m;
    const from = controls.target.clone(), to = new THREE.Vector3(x, 20, z);
    const off = camera.position.clone().sub(controls.target).setLength(dist);
    const camFrom = camera.position.clone(), camTo = to.clone().add(off);
    flight = { t: 0, from, to, camFrom, camTo };
  }
  m.frameHooks.push(dt => {
    if (!m.still) moveBuses(dt);
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / 1.2);
    const e = 1 - (1 - flight.t) ** 3;
    m.controls.target.lerpVectors(flight.from, flight.to, e);
    m.camera.position.lerpVectors(flight.camFrom, flight.camTo, e);
    if (flight.t >= 1) flight = null;
  });

  const visibleProjects = () => built.map(b => ({ ...b.p, extra: b.extra }));
  return { setScenario, setTime, focus, visibleProjects, zoneVisible: id => !!VISIBLE_ZONES[id], zoneRep: id => ZONE_REPS[id] };
}
