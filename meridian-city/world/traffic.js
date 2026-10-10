// Street life: vehicles, signals and pedestrians from the street sim (street-sim.js over roadnet.js), drawn in the
// world's pixel art.
// Vehicles: textured, instanced 3D models (cars, pickups, vans, buses, trucks), placed between fixed sim steps.
// Signals: pole-mounted heads at each approach and walk / don't-walk heads at every signalized crosswalk, with
// zebras and stop lines painted on the road.
// People: individual walkers drawn from people-art.js: eight facing directions, idle and walking frames, ground
// shadows, three levels of detail, and only the ones on screen are written to the instance buffers.
// Click a walker to follow them and see where they are going.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { P } from './palette.js';
import { Batch, OCC } from './geometry.js';
import { Pix } from './textures.js';
import { DRIVE } from './streets.js';
import { buildRoadNet, buildWalkNet } from './roadnet.js';
import { createStreetSim } from './street-sim.js';
import { paintPeopleAtlas, LOOKS } from './people-art.js';
import { createSpriteSystem } from './sprites.js';

// ---------- vehicle atlas: alpha 255 marks paintable body, 254 keeps the pixel's own colour ----------
function vehicleAtlas() {
  const S = 128, p = new Pix(S, S, 3), regions = {};
  let cx = 0, cy = 0, rowH = 0;
  const region = (name, w, h, paint) => {
    if (cx + w > S) { cx = 0; cy += rowH + 1; rowH = 0; }
    paint(cx, cy, w, h); regions[name] = [cx, cy, w, h]; cx += w + 1; rowH = Math.max(rowH, h);
  };
  const body = (x, y, w, h, c = '#f4f4f4') => p.rect(x, y, w, h, c, 255);
  const fixed = (x, y, w, h, c) => p.rect(x, y, w, h, c, 254);
  region('bodySide', 24, 4, (x, y) => { body(x, y, 24, 4); body(x, y + 3, 24, 1, '#c8c8c8'); fixed(x + 9, y, 1, 3, '#9a9a9a'); fixed(x + 3, y + 3, 4, 1, '#1e1e1e'); fixed(x + 17, y + 3, 4, 1, '#1e1e1e'); });
  region('bodyFront', 10, 4, (x, y) => { body(x, y, 10, 4); fixed(x + 1, y + 1, 2, 1, '#fff6c8'); fixed(x + 7, y + 1, 2, 1, '#fff6c8'); fixed(x + 3, y + 2, 4, 1, '#3a3a3a'); });
  region('bodyBack', 10, 4, (x, y) => { body(x, y, 10, 4); fixed(x + 1, y + 1, 2, 1, '#d6402f'); fixed(x + 7, y + 1, 2, 1, '#d6402f'); fixed(x + 3, y + 2, 4, 1, '#f2e7c8'); });
  region('bodyTop', 16, 10, (x, y) => { body(x, y, 16, 10); body(x, y, 16, 1, '#ffffff'); });
  region('cabinSide', 14, 4, (x, y) => { body(x, y, 14, 1); fixed(x + 1, y + 1, 5, 3, '#3d5f7c'); fixed(x + 7, y + 1, 6, 3, '#3d5f7c'); fixed(x + 1, y + 1, 2, 1, '#9fd0e6'); fixed(x + 7, y + 1, 2, 1, '#9fd0e6'); body(x + 6, y + 1, 1, 3); body(x, y + 1, 1, 3); body(x + 13, y + 1, 1, 3); });
  region('cabinFront', 10, 4, (x, y) => { body(x, y, 10, 1); fixed(x + 1, y + 1, 8, 3, '#3d5f7c'); fixed(x + 1, y + 1, 3, 1, '#9fd0e6'); body(x, y + 1, 1, 3); body(x + 9, y + 1, 1, 3); });
  region('cabinTop', 14, 10, (x, y) => body(x, y, 14, 10));
  region('tire', 4, 4, (x, y) => { fixed(x, y, 4, 4, '#1e1e1e'); fixed(x + 1, y + 1, 2, 2, '#8f8f8f'); });
  region('bed', 12, 10, (x, y) => { fixed(x, y, 12, 10, '#3a3a3a'); for (let i = 1; i < 12; i += 2) fixed(x + i, y, 1, 10, '#2b2b2b'); });
  region('busSide', 40, 10, (x, y) => { body(x, y, 40, 10); for (let i = 2; i < 38; i += 5) fixed(x + i, y + 2, 4, 4, '#3d5f7c'); fixed(x + 2, y + 2, 36, 1, '#9fd0e6', 254); fixed(x, y + 7, 40, 1, '#2f5f8f'); fixed(x + 6, y + 9, 5, 1, '#1e1e1e'); fixed(x + 30, y + 9, 5, 1, '#1e1e1e'); });
  region('busFront', 12, 10, (x, y) => { body(x, y, 12, 10); fixed(x + 1, y + 1, 10, 2, '#e8b33c'); fixed(x + 1, y + 3, 10, 4, '#3d5f7c'); fixed(x + 1, y + 8, 2, 1, '#fff6c8'); fixed(x + 9, y + 8, 2, 1, '#fff6c8'); });
  region('boxSide', 30, 12, (x, y) => { body(x, y, 30, 12); fixed(x, y + 11, 30, 1, '#9a9a9a'); fixed(x + 6, y + 4, 12, 3, '#2f6b3a'); });
  region('boxBack', 12, 12, (x, y) => { body(x, y, 12, 12); fixed(x + 5, y, 1, 12, '#9a9a9a'); fixed(x + 1, y + 10, 2, 1, '#d6402f'); fixed(x + 9, y + 10, 2, 1, '#d6402f'); });
  region('beacon', 4, 2, (x, y) => { fixed(x, y, 2, 2, '#d6402f'); fixed(x + 2, y, 2, 2, '#2f5f8f'); });
  const tex = p.texture({ repeat: false, flipY: false });
  tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  const uv = name => { const [x, y, w, h] = regions[name], e = .5; return [(x + e) / S, (y + h - e) / S, (x + w - e) / S, (y + e) / S]; };
  return { tex, uv };
}

// Model builders. Local x is forward, z is right. All boxes rest on y = 0.
function model(kind, A) {
  const b = new Batch(), W = new THREE.Color(1, 1, 1), f = (side, front, back, top) => face => face === 'top' ? A.uv(top) : face === 'side' ? A.uv(side) : A.uv(front);
  const wheels = (len, wid, r = .36) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * len * .32, sz * (wid / 2 - .12), r * 2, r * 2, .3, 0, 0, W, () => A.uv('tire')); };
  const ends = (len, wid, h, y0, front, back, side, top) => { // one box, front and back faces distinct
    b.box(0, 0, len, h, wid, y0, 0, W, face => face === 'top' ? A.uv(top) : face === 'side' ? A.uv(side) : A.uv(front));
    // Re-texture the back (-x) face: overwrite the last box's 4th face uvs.
    const uvArr = b.uv, start = uvArr.length - 5 * 12 + 3 * 12, [u0, v0, u1, v1] = A.uv(back);
    const quadUv = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
    for (let i = 0; i < 12; i++) uvArr[start + i] = quadUv[i];
  };
  switch (kind) {
    case 'car':
      ends(4.4, 1.8, .7, .3, 'bodyFront', 'bodyBack', 'bodySide', 'bodyTop');
      b.box(-.3, 0, 2.3, .6, 1.62, 1, 0, W, f('cabinSide', 'cabinFront', 'cabinFront', 'cabinTop'));
      wheels(4.4, 1.8); break;
    case 'pickup':
      ends(5.2, 1.9, .75, .35, 'bodyFront', 'bodyBack', 'bodySide', 'bodyTop');
      b.box(.6, 0, 1.9, .7, 1.74, 1.1, 0, W, f('cabinSide', 'cabinFront', 'cabinFront', 'cabinTop'));
      b.box(-1.45, 0, 2.1, .05, 1.6, 1.1, 0, W, () => A.uv('bed'));
      wheels(5.2, 1.9, .4); break;
    case 'van':
      ends(5, 2, 1.7, .3, 'bodyFront', 'bodyBack', 'bodySide', 'cabinTop');
      b.box(1.2, 0, 1.6, .6, 1.9, 1.5, 0, W, f('cabinSide', 'cabinFront', 'cabinFront', 'cabinTop'));
      wheels(5, 2, .38); break;
    case 'bus':
      ends(11, 2.5, 2.7, .35, 'busFront', 'busFront', 'busSide', 'cabinTop');
      wheels(11, 2.5, .5); break;
    case 'truck':
      b.box(-1, 0, 5, 2.8, 2.4, .5, 0, W, f('boxSide', 'boxBack', 'boxBack', 'cabinTop'));
      ends(2, 2.3, 1.4, .4, 'bodyFront', 'bodyFront', 'bodySide', 'bodyTop');
      b.p.forEach((_, i) => { if (i % 3 === 0 && i >= b.p.length - 90) b.p[i] += 2.5; }); // move the cab forward
      b.box(2.5, 0, 1.6, .8, 2.2, 1.8, 0, W, f('cabinSide', 'cabinFront', 'cabinFront', 'cabinTop'));
      wheels(7, 2.4, .48); break;
  }
  return b.build();
}

// Lambert that tints only body pixels (texture alpha 255) with the instance colour.
function paintMaterial(tex) {
  const m = new THREE.MeshPhongMaterial({ map: tex, specular: '#8a9aa8', shininess: 70 }); // glossy, toy-like paint
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <map_fragment>', `
        vec4 texel = texture2D(map, vMapUv);
        float paint = step(0.999, texel.a);
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) // fragment shaders see instance colour as USE_COLOR
          diffuseColor.rgb *= texel.rgb * mix(vec3(1.0), vColor, paint);
        #else
          diffuseColor.rgb *= texel.rgb;
        #endif`);
  };
  return m;
}

const CAR_COLORS = ['#c0392b', '#e8b33c', '#2f5f8f', '#ece8df', '#ece8df', '#3a3a3a', '#7f8a9a', '#3f6b4f', '#d98b6a', '#6e4f7f', '#9fb8cf', '#b5402f', '#f2e3b8', '#4f9dc9'];
const TYPES = [ // kind, share, colours, length
  ['car', .62, CAR_COLORS, 4.4], ['pickup', .12, ['#7d1a1a', '#2f4f7a', '#ece8df', '#5e6b4f', '#b5801f', '#3a3a3a'], 5.2],
  ['van', .1, ['#ece8df', '#ece8df', '#2f5f8f', '#9a9a9a'], 5], ['truck', .06, ['#ece8df', '#d9d2c3', '#3f6b4f'], 7], ['bus', .1, ['#2f5f8f', '#e8b33c', '#c0392b'], 11],
];

const KIND_COLORS = Object.fromEntries(TYPES.map(([kind, , colors]) => [kind, colors]));
const DOOR_WEIGHT = { shop: 4, campus: 4, civic: 3, office: 3, apartment: 2, house: 1, industrial: 1, garage: 1 };
const OBSTACLE_R = { lamp: .3, hydrant: .25, bench: .8, busStop: 1.6, trafficLight: .25, stopSign: .2, streetSign: .2, trash: .3, mailbox: .3, bikeRack: .7, planter: .5, picnic: .9 };
const PEOPLE_MIN_PPM = 2.4;

// Cells whose centre lies on a drivable carriageway (not service drives, which cars in the sim never use).
function roadRaster(lanes, ext) {
  const n = Math.ceil(2 * ext), bits = new Uint8Array(n * n);
  for (const q of lanes) {
    if (!DRIVE.has(q.cls)) continue;
    const r = q.r, h = q.w / 2;
    for (let i = 0; i + 2 < r.length; i += 2) {
      const ax = r[i], az = r[i + 1], bx = r[i + 2], bz = r[i + 3], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - h + ext)), i1 = Math.min(n - 1, Math.floor(Math.max(ax, bx) + h + ext));
      const j0 = Math.max(0, Math.floor(Math.min(az, bz) - h + ext)), j1 = Math.min(n - 1, Math.floor(Math.max(az, bz) + h + ext));
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
        const x = k + .5 - ext, z = j + .5 - ext, t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
        if ((x - ax - t * (bx - ax)) ** 2 + (z - az - t * (bz - az)) ** 2 <= h * h) bits[j * n + k] = 1;
      }
    }
  }
  return (x, z) => { const k = Math.floor(x + ext), j = Math.floor(z + ext); return k >= 0 && j >= 0 && k < n && j < n && bits[j * n + k] === 1; };
}

export function buildTraffic({ lanes, walks, scene, grid, buildings, furniture = [], trees = [], view }) {
  const onRoad = roadRaster(lanes, grid.ext), inBuilding = (x, z) => (grid.at(x, z) & OCC.building) !== 0;
  const net = buildRoadNet(lanes.filter(q => DRIVE.has(q.cls)));
  const walk = buildWalkNet(net, walks.filter(q => !DRIVE.has(q.cls)), { onRoad, inBuilding });

  // Signal poles stand on the kerb by each stop line; walk heads stand behind the kerb at each end of each crosswalk.
  const heads = [], o = {};
  for (const ix of net.intersections) {
    if (!ix.signal) continue;
    for (const arm of ix.arms) {
      const L = arm.inLane;
      if (L) {
        L.path.at(L.stopS, o);
        const off = arm.w / 2 - (arm.edge.ow ? 0 : arm.w / 4) + .7;
        heads.push({ x: o.x - o.uz * off, z: o.z + o.ux * off, sig: ix.signal, group: arm.group });
      }
      const cw = arm.crosswalk;
      if (cw.nodeA) {
        const ux = (cw.bx - cw.ax) / cw.len, uz = (cw.bz - cw.az) / cw.len; // across the road, A to B
        heads.push({ x: cw.ax - ux * .75 + arm.ux * .9, z: cw.az - uz * .75 + arm.uz * .9, cw });
        heads.push({ x: cw.bx + ux * .75 + arm.ux * .9, z: cw.bz + uz * .75 + arm.uz * .9, cw });
      }
    }
  }

  const doors = buildings.meta.filter(m => m.door).map(m => ({ x: m.door[0], z: m.door[1], label: m.name ?? m.label, family: m.family, weight: DOOR_WEIGHT[m.family] ?? 1 }));
  const obstacles = [
    ...furniture.filter(f => OBSTACLE_R[f.name]).map(f => ({ x: f.x, z: f.z, r: OBSTACLE_R[f.name] })),
    ...trees.map(t => ({ x: t.x, z: t.z, r: .45 })),
    ...heads.map(h => ({ x: h.x, z: h.z, r: .25 })),
  ];
  const sim = createStreetSim({ net, walk, doors, obstacles, onRoad, vehicleDensity: .8 });

  // ---------- vehicles ----------
  const r = (seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; })(4242);
  const A = vehicleAtlas(), mat = paintMaterial(A.tex), meshes = {};
  for (const [kind] of TYPES) {
    const list = sim.vehicles.filter(c => c.kind === kind);
    const m = new THREE.InstancedMesh(model(kind, A), mat, Math.max(1, list.length));
    m.count = list.length;
    list.forEach((c, i) => { c.slot = i; const cols = KIND_COLORS[kind]; m.setColorAt(i, new THREE.Color(cols[Math.floor(r() * cols.length)])); });
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m); meshes[kind] = m;
  }

  // ---------- people, shadows, signal heads: one atlas, batched instanced layers ----------
  const art = paintPeopleAtlas();
  const tex = new THREE.DataTexture(art.data, art.size, art.size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  const sprites = createSpriteSystem({ texture: tex, sprites: art.sprites });
  const N = sim.peds.length;
  const people = sprites.dynamicLayer(scene, Math.max(1, N), { minZoom: PEOPLE_MIN_PPM });
  const shadows = sprites.dynamicLayer(scene, Math.max(1, N), { minZoom: PEOPLE_MIN_PPM, decal: true, transparent: true, opacity: .3, renderOrder: 1 });
  const signalLayer = sprites.dynamicLayer(scene, Math.max(1, heads.length), { minZoom: 1.2 });
  const ringLayer = sprites.dynamicLayer(scene, 1, { decal: true, transparent: true, opacity: .95, renderOrder: 2 });
  ringLayer.mesh.count = 0;
  const m4 = new THREE.Matrix4();
  heads.forEach((h, i) => signalLayer.mesh.setMatrixAt(i, m4.makeTranslation(h.x, .06, h.z)));
  signalLayer.mesh.count = heads.length;
  signalLayer.mesh.instanceMatrix.needsUpdate = true;

  // ---------- road markings at signalized intersections: zebras and stop lines ----------
  const marks = new Batch(), WHITE = new THREE.Color(P.lineWhite ?? '#ffffff');
  const bar = (cx, cz, ux, uz, len, width) => { // a painted bar centred at (cx, cz), long along (ux, uz)
    const nx = -uz, nz = ux, hx = ux * len / 2, hz = uz * len / 2, wx = nx * width / 2, wz = nz * width / 2;
    marks.flat([cx - hx - wx, cz - hz - wz], [cx + hx - wx, cz + hz - wz], [cx + hx + wx, cz + hz + wz], .078, WHITE, () => [0, 0]);
    marks.flat([cx - hx - wx, cz - hz - wz], [cx + hx + wx, cz + hz + wz], [cx - hx + wx, cz - hz + wz], .078, WHITE, () => [0, 0]);
  };
  for (const ix of net.intersections) {
    if (!ix.signal) continue;
    for (const arm of ix.arms) {
      const cw = arm.crosswalk;
      if (cw.nodeA) {
        const ux = (cw.bx - cw.ax) / cw.len, uz = (cw.bz - cw.az) / cw.len;
        for (let t = 1.6; t <= cw.len - 1.5; t += 1) bar(cw.ax + ux * t, cw.az + uz * t, -uz, ux, 2.4, .5);
      }
      const L = arm.inLane;
      if (L) { // across the approach half of the road, centre line to kerb
        L.path.at(L.stopS + .25, o);
        const lo = arm.edge.ow ? -arm.w / 2 : -arm.w / 4, hi = arm.w / 2 - (arm.edge.ow ? 0 : arm.w / 4);
        const mid = (lo + hi) / 2;
        bar(o.x - o.uz * mid, o.z + o.ux * mid, -o.uz, o.ux, hi - lo - .3, .45);
      }
    }
  }
  if (!marks.empty) {
    const mesh = new THREE.Mesh(marks.build(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -14 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- per-frame drawing ----------
  const lerpAng = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };
  const q4 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), vp = new THREE.Matrix4();
  const MIRROR = [false, false, false, false, false, true, true, true], DIR_OF = [0, 1, 2, 3, 4, 3, 2, 1];
  const shadowS = art.sprites.shadow, ringS = art.sprites.ring;
  let selected = null, focusAt = -1, visible = [];

  function drawVehicles(alpha, ppm) {
    for (const c of sim.vehicles) {
      pos.set(c.px + (c.x - c.px) * alpha, .06, c.pz + (c.z - c.pz) * alpha);
      m4.compose(pos, q4.setFromAxisAngle(UP, lerpAng(c.ph, c.h, alpha)), one);
      meshes[c.kind].setMatrixAt(c.slot, m4);
    }
    for (const m of Object.values(meshes)) { m.instanceMatrix.needsUpdate = true; m.visible = ppm >= .6; }
  }

  function drawPeople(alpha, ppm, cam, time) {
    visible = [];
    if (ppm < PEOPLE_MIN_PPM) { people.mesh.count = shadows.mesh.count = 0; ringLayer.mesh.count = 0; return; }
    const table = art.table[ppm >= 9 ? 'hi' : ppm >= 4.5 ? 'mid' : 'low'];
    // Camera axes on the ground, for choosing which of the eight facings to show.
    const e = cam.matrixWorld.elements, rx = e[0], rz = e[2], fl = Math.hypot(e[8], e[10]) || 1, fx = -e[8] / fl, fz = -e[10] / fl;
    vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const v = vp.elements;
    const uvP = people.uv.array, szP = people.size.array, uvS = shadows.uv.array, szS = shadows.size.array;
    let n = 0;
    for (const p of sim.peds) {
      const x = p.px + (p.x - p.px) * alpha, z = p.pz + (p.z - p.pz) * alpha;
      // Visibility culling: skip anyone off screen (with a margin for the sprite's height).
      const w = v[3] * x + v[7] + v[11] * z + v[15], cx = (v[0] * x + v[4] + v[8] * z + v[12]) / w, cy = (v[1] * x + v[5] + v[9] * z + v[13]) / w;
      if (cx < -1.08 || cx > 1.08 || cy < -1.15 || cy > 1.1) continue;
      const sx = p.dx * rx + p.dz * rz, sy = p.dx * fx + p.dz * fz;
      const idx = ((Math.round(Math.atan2(sx, -sy) / (Math.PI / 4)) % 8) + 8) % 8;
      const frame = p.v > .15 ? 1 + (Math.floor(p.anim) & 3) : 0;
      const s = table[p.look % LOOKS][DIR_OF[idx]][frame];
      people.mesh.setMatrixAt(n, m4.makeTranslation(x, .05, z));
      if (MIRROR[idx]) { uvP[n * 4] = s.uv[2]; uvP[n * 4 + 1] = s.uv[1]; uvP[n * 4 + 2] = s.uv[0]; uvP[n * 4 + 3] = s.uv[3]; }
      else uvP.set(s.uv, n * 4);
      szP[n * 3] = s.w; szP[n * 3 + 1] = s.h; szP[n * 3 + 2] = 0;
      shadows.mesh.setMatrixAt(n, m4.makeTranslation(x + .12, .085, z - .08));
      uvS.set(shadowS.uv, n * 4); szS[n * 3] = .95; szS[n * 3 + 1] = .5; szS[n * 3 + 2] = 0;
      visible.push(p, (cx + 1) / 2, (1 - cy) / 2);
      n++;
    }
    people.mesh.count = shadows.mesh.count = n;
    for (const l of [people, shadows]) { l.mesh.instanceMatrix.needsUpdate = true; l.uv.needsUpdate = true; l.size.needsUpdate = true; }
    if (selected) { // a gold ring under the followed walker
      const x = selected.px + (selected.x - selected.px) * alpha, z = selected.pz + (selected.z - selected.pz) * alpha;
      ringLayer.mesh.setMatrixAt(0, m4.makeTranslation(x, .09, z));
      ringLayer.uv.array.set(ringS.uv, 0); ringLayer.size.array.set([1.5 + Math.sin(time * 5) * .1, .8, 0], 0);
      ringLayer.mesh.count = 1;
      ringLayer.mesh.instanceMatrix.needsUpdate = true; ringLayer.uv.needsUpdate = true; ringLayer.size.needsUpdate = true;
    } else ringLayer.mesh.count = 0;
  }

  function drawSignals() {
    const flash = Math.floor(sim.time * 2) % 2 === 0, uv = signalLayer.uv.array, sz = signalLayer.size.array;
    heads.forEach((h, i) => {
      const s = h.sig ? art.sprites[`signal${sim.signalState(h.sig, h.group)}`]
        : art.sprites[h.cw.walk === 'WALK' ? 'ped_walk' : h.cw.walk === 'FDW' && !flash ? 'ped_dim' : 'ped_hand'];
      uv.set(s.uv, i * 4); sz[i * 3] = s.w; sz[i * 3 + 1] = s.h; sz[i * 3 + 2] = 0;
    });
    signalLayer.uv.needsUpdate = true; signalLayer.size.needsUpdate = true;
  }

  // Walkers in and near the view get full local avoidance; the bounds refresh a few times a second.
  function refocus(ppm) {
    if (ppm < PEOPLE_MIN_PPM) { sim.setFocus(null); return; }
    const el = view.renderer.domElement.getBoundingClientRect();
    const pts = [[el.left, el.top], [el.right, el.top], [el.left, el.bottom], [el.right, el.bottom]].map(([x, y]) => view.screenToGround(x, y)).filter(Boolean);
    if (!pts.length) return;
    const xs = pts.map(p => p.x), zs = pts.map(p => p.z), M = 30;
    sim.setFocus([Math.min(...xs) - M, Math.min(...zs) - M, Math.max(...xs) + M, Math.max(...zs) + M]);
  }

  // ---------- picking a walker, and the person card ----------
  const card = document.createElement('section');
  card.className = 'retro-card building-card person-card';
  card.hidden = true;
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = '<header><h2 class="building-card__title"></h2><button type="button" class="retro-icon-btn" aria-label="Close person info">×</button></header>'
    + '<p class="person-card__doing"></p><dl class="building-card__facts"></dl>'
    + '<p class="person-card__note">Simulated street life: an illustrative walker, not counted in the model\'s population, housing or commute figures.</p>';
  document.body.append(card);
  const style = document.createElement('style');
  style.textContent = '.person-card__doing { margin: 0 0 8px; font: 600 15px var(--ae-pixel, monospace); color: var(--ae-navy, #1c2c5e); }'
    + ' .person-card__doing::before { content: ""; display: inline-block; width: 9px; height: 9px; margin-right: 7px; border: 2px solid currentColor; border-radius: 50%; background: var(--dot, #3fb6e8); }'
    + ' .person-card__note { margin: 10px 0 0; font-size: 12px; line-height: 1.4; color: var(--ae-ink-soft, #42758a); }';
  document.head.append(style);
  card.querySelector('button').addEventListener('click', () => select(null));
  let onSelect = () => {}, cardAt = -1;
  function select(p) {
    selected = p;
    card.hidden = !p;
    cardAt = -1;
    if (p) onSelect(p);
  }
  const DOT = { walking: '#4fcf9a', approaching: '#ffd166', waiting: '#ff8a7a', crossing: '#3fb6e8', arriving: '#b39ddb' };
  function activity(p) {
    const label = p.dest?.label ?? 'somewhere nearby', stroll = !p.dest?.door;
    switch (p.state) {
      case 'approaching': return 'Approaching a crosswalk';
      case 'waiting': return !p.cw?.signalized ? 'Waiting for a gap in traffic' : p.cw.walk === 'WALK' ? 'Waiting for turning cars to pass' : 'Waiting for the walk signal';
      case 'crossing': return p.cw?.signalized ? 'Crossing with the walk signal' : 'Crossing the street';
      case 'arriving': return p.route ? `Arriving at ${label}` : stroll ? 'Pausing for a moment' : `Arrived at ${label}`;
      default: return stroll ? 'Out for a stroll' : `Walking to ${label}`;
    }
  }
  function remaining(p) {
    if (!p.route) return 0;
    let d = 0, x = p.x, z = p.z;
    for (let i = p.ri; i < p.route.length; i++) { d += Math.hypot(p.route[i].x - x, p.route[i].z - z); x = p.route[i].x; z = p.route[i].z; }
    if (p.door) d += Math.hypot(p.door.x - x, p.door.z - z);
    return d;
  }
  function updateCard(time) {
    if (!selected || (cardAt >= 0 && time - cardAt < .25)) return;
    cardAt = time;
    const p = selected;
    card.querySelector('.building-card__title').textContent = `Walker #${String(p.id).padStart(4, '0')}`;
    const doing = card.querySelector('.person-card__doing');
    doing.textContent = activity(p); doing.style.setProperty('--dot', DOT[p.state] ?? '#4fcf9a');
    const facts = [
      ['Heading to', p.dest?.label ?? '—'],
      ['Distance left', p.route ? `${Math.round(remaining(p))} m` : '—'],
      ['Walking pace', `${p.vPref.toFixed(1)} m/s`],
      ['Trips so far', String(p.trips)],
    ];
    card.querySelector('.building-card__facts').replaceChildren(...facts.flatMap(([k, val]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k; dd.textContent = val;
      return [dt, dd];
    }));
  }
  // A click within a few pixels of a walker selects them; the building picker skips clicks a walker claimed.
  let down = null;
  const canvas = view.renderer.domElement;
  canvas.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  addEventListener('pointerup', e => {
    if (!down || e.target !== canvas || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 450) return;
    const rect = canvas.getBoundingClientRect();
    let best = null, bd = 16 * 16;
    for (let i = 0; i < visible.length; i += 3) {
      const p = visible[i], sx = rect.left + visible[i + 1] * rect.width, sy = rect.top + visible[i + 2] * rect.height;
      const d = (sx - e.clientX) ** 2 + (sy - 12 - e.clientY) ** 2; // aim at the body, a little above the feet
      if (d < bd) { bd = d; best = p; }
    }
    // Claim the click without stopping it: the map's pan control must still see the release, or it keeps dragging.
    if (best) { e.preventDefault(); down = null; select(best); }
    else if (selected) select(null);
  }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape' && selected && !e.target.closest?.('[role="dialog"]')) select(null); });

  return {
    sim, net, walk, onRoad, select, get selected() { return selected; },
    signalized: net.intersections.filter(ix => ix.signal).map(ix => [ix.x, ix.z]),
    count: { vehicles: sim.vehicles.length, people: sim.peds.length, signals: sim.signals.length },
    onSelect(fn) { onSelect = fn; },
    /** Where a walker's body is on screen, in client pixels (for tests and tooling). */
    screenOf(p) {
      const cam = view.renderCam, rect = canvas.getBoundingClientRect();
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const v = vp.elements, w = v[3] * p.x + v[7] + v[11] * p.z + v[15];
      const cx = (v[0] * p.x + v[4] + v[8] * p.z + v[12]) / w, cy = (v[1] * p.x + v[5] + v[9] * p.z + v[13]) / w;
      return { x: rect.left + (cx + 1) / 2 * rect.width, y: rect.top + (1 - cy) / 2 * rect.height - 12 };
    },
    /** simDt (0 while paused or holding) is the only thing that moves the street; real time only redraws it. */
    update(simDt, time, ppm) {
      sim.advance(simDt);
      sim.plan(3); // trip planning moves nobody, so it may run while paused
      if (focusAt < 0 || time - focusAt > .4) { focusAt = time; refocus(ppm); }
      const alpha = Math.min(1, sim.alpha);
      drawVehicles(alpha, ppm);
      drawSignals();
      drawPeople(alpha, ppm, view.renderCam, time);
      sprites.update(view.renderCam, time, ppm);
      updateCard(time);
    },
  };
}
