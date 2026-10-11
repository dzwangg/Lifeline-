// Builds the whole Chapel Hill game world from the OSM bake and runs it each frame.
// Order matters: buildings and streets claim the ground first, then land cover, planting and furniture
// fill what is left, so decorations never block roads, entrances or each other.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { LOD, hash, pickBy } from './palette.js';
import { Grid, Batch, OCC } from './geometry.js';
import { createView } from './view.js';
import { detailAtlas, groundTextures, waterFrames as makeWaterFrames } from './textures.js';
import { spriteAtlas, TREE_KINDS, canopyTone } from './sprite-art.js';
import { createSpriteSystem } from './sprites.js';
import { buildBuildings } from './buildings.js';
import { buildStreets } from './streets.js';
import { buildLand } from './land.js';
import { buildTraffic } from './traffic.js';
import { mountSelection } from './select.js';
import { backdrop } from './aero.js';

// Lets the loading bar repaint between stages: wait for a frame, then a task. A hidden tab gets no frames, so a
// timer stands in rather than stalling the build.
const tick = () => new Promise(r => { const t = setTimeout(r, 50); requestAnimationFrame(() => { clearTimeout(t); setTimeout(r, 0); }); });

// progress(message, fraction) reports each stage; fraction runs to 1 when the city can be drawn (the page's own steps
// fill the rest of its bar). Street life (cars, walkers, signals, street furniture) is built after the first frame:
// world.traffic is null until then, and world.trafficReady resolves with it. world.timings has each stage's milliseconds.
export async function buildWorld({ container, osm, names = [], zones = [], progress = () => {} }) {
  const timings = {}, stage = (() => { let name = 'setup', t = performance.now(); return next => { const now = performance.now(); timings[name] = (timings[name] ?? 0) + Math.round(now - t); name = next; t = now; }; })();
  const view = createView(container, { ext: osm.ext });
  const { scene } = view;
  const grid = new Grid(osm.ext + 250, 1);
  // Sim zones keep base-map trees out (street trees and planting); the zone layer plants its own there.
  for (const { ring } of zones) grid.fillRing(ring, OCC.zone);
  const details = detailAtlas(), art = spriteAtlas(), sprites = createSpriteSystem(art), ground = groundTextures();

  // Base ground: one big lawn, so the map edge fades into countryside rather than a void.
  const base = new Batch(), S = osm.ext + 2000, w = new THREE.Color(1, 1, 1);
  base.flat([-S, -S], [S, -S], [S, S], 0, w, (x, z) => [x, -z]);
  base.flat([-S, -S], [S, S], [-S, S], 0, w, (x, z) => [x, -z]);
  const baseMesh = new THREE.Mesh(base.build(), new THREE.MeshLambertMaterial({ map: ground.grass, vertexColors: true }));
  baseMesh.receiveShadow = true;
  scene.add(baseMesh);
  const aero = backdrop(scene, osm.ext, ground.grass); // hills and wind turbines beyond the mapped area

  stage('yields'); progress('Raising buildings…', .05); await tick();
  stage('buildings'); const buildings = buildBuildings({ osm, names, grid, details, parent: scene });
  stage('yields'); progress('Paving streets…', .35); await tick();
  stage('streets'); const streets = buildStreets({ osm, grid, ground, parent: scene });
  stage('yields'); progress('Planting trees…', .55); await tick();
  stage('land'); const land = buildLand({ osm, grid, ground, waterFrames: makeWaterFrames(), parent: scene });
  land.plantYards(buildings.meta);
  land.fillOpen(buildings.meta, osm.ext);
  const landMeshes = land.build(details);

  // Sprite layers, each with its own level of detail.
  const treeItems = [...land.trees, ...streets.trees.map(t => ({ ...t, name: pickBy(TREE_KINDS[t.kind], hash(t.x, t.z, 1)), scale: .85 + hash(t.x, t.z, 2) * .3 }))];
  const shadows = treeItems.map(t => ({ x: t.x + 1.4, y: .09, z: t.z - 1, name: 'shadow', scale: 2.8 * (t.scale ?? 1), phase: .5 }));
  sprites.layer(scene, shadows, { decal: true, transparent: true, opacity: .28, renderOrder: 1, name: 'tree shadows', minZoom: LOD.macro });
  sprites.layer(scene, treeItems, { name: 'trees', minZoom: LOD.macro });
  // Far out, each tree is a flat disc a little wider than its crown, so neighbouring crowns merge into canopy.
  sprites.canopyLayer(scene, treeItems.map(t => ({ x: t.x, z: t.z, r: art.sprites[t.name].w * (t.scale ?? 1) * .62, color: canopyTone(t.name) })), { maxZoom: LOD.macro, name: 'canopy' });
  sprites.layer(scene, land.shrubs, { name: 'shrubs', minZoom: LOD.furniture });
  sprites.layer(scene, land.flowers, { name: 'flowers', minZoom: LOD.flowers });
  let traffic = null;
  const selection = mountSelection({ view, buildings, onSelect: m => { if (m) traffic?.select(null); } });
  const stats = { buildings: buildings.meta.length, tallest: Math.max(...buildings.meta.map(m => m.height)), trees: treeItems.length };
  // Street life, once the city is on screen: a few chunks, each in its own task.
  let startTraffic, frames = 0;
  const trafficReady = new Promise(r => { startTraffic = r; }).then(async () => {
    const t0 = performance.now();
    traffic = await buildTraffic({ lanes: streets.lanes, walks: streets.walks, scene, grid, buildings, view, furniture: [...land.props, ...streets.furniture], trees: treeItems, pause: tick });
    // The street sim places working signals; drop the decorative ones, and stop signs where a signal now rules.
    const nearSignal = (x, z) => traffic.signalized.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < 32 * 32);
    const furniture = streets.furniture.filter(f => f.name !== 'trafficLight' && !(f.name === 'stopSign' && nearSignal(f.x, f.z)));
    sprites.layer(scene, [...land.props, ...furniture], { name: 'furniture', minZoom: LOD.furniture });
    traffic.onSelect(() => selection.select(null)); // one info card at a time
    Object.assign(stats, traffic.count);
    timings.trafficAfterFirstFrame = Math.round(performance.now() - t0);
    return traffic;
  });
  const start = buildings.meta.find(m => m.name === 'Old Well') ?? buildings.meta.find(m => /bell tower/i.test(m.name ?? ''));
  if (start) view.lookAt(start.cx, start.cz); // open on the heart of campus

  // Parts for the sim's zone layer, drawn in the same art as everything else.
  const zoneParts = zoneArt({ sprites, buildings, ground });
  stage('done'); progress('Drawing the city…', 1);

  let time = 0, simTime = 0;
  return {
    view, grid, buildings, streets, selection, zoneParts, lod: sprites.lod, timings, trafficReady, stats,
    get traffic() { return traffic; },
    sprites, art, // the sprite system and its atlas, for layers added from outside (see WORLD.md)
    gridAt: (x, z) => grid.at(x, z),
    // dt: real seconds, for the camera, inspection (the selection pulse) and street life (traffic, walkers, signals and
    // the households' day, which run paused or playing). simDt: simulated seconds from the shared clock (0 while paused
    // or holding), for the rest that moves: wind, water, turbines.
    update(dt, simDt = dt) {
      dt = Math.min(Math.max(dt, 0), .05); // animation timestamps can run slightly behind; never step backwards
      simDt = Math.max(simDt, 0);
      time += dt; simTime += simDt;
      view.update(dt);
      const ppm = view.ppm;
      sprites.update(view.renderCam, simTime, ppm);
      traffic?.update(dt, time, ppm); // street life runs in real time; the clock moves the years
      landMeshes.update(Math.min(simDt, .2));
      aero.update(Math.min(simDt, .2));
      selection.update(time);
      buildings.setDetailVisible(ppm >= LOD.details);
      view.render();
      if (++frames === 2) setTimeout(startTraffic, 0); // once the first frame is on screen
    },
  };
}

// The sim converts zones between forest, houses and blocks. Its trees are sprite billboards and its
// buildings use the same tiling atlas material as the city, in house and block colourways.
function zoneArt({ sprites, buildings, ground }) {
  const box = (wallTile, roofTile, roof) => {
    const b = new Batch(), W = new THREE.Color(1, 1, 1), at = buildings.atlasTile;
    b.tile = at(wallTile);
    // Unit box walls with uvs scaled for a typical 10 m house or 24 m block (the zone layer scales instances).
    const [tw, th] = roof ? [10 / 24, 7 / 13.6] : [24 / 24, 18 / 13.6];
    for (const [ax, az, bx, bz, nx, nz] of [[-.5, .5, .5, .5, 0, 1], [.5, .5, .5, -.5, 1, 0], [.5, -.5, -.5, -.5, 0, -1], [-.5, -.5, -.5, .5, -1, 0]]) {
      b.quad([[ax, 0, az], [bx, 0, bz], [bx, 1, bz], [ax, 1, az]], [nx, 0, nz], [0, 0, tw, 0, tw, th, 0, th], W);
    }
    b.tile = at(roofTile);
    if (roof) for (const [a, c, d] of [[[-.55, 1, .55], [.55, 1, .55], [0, 1.45, 0]], [[.55, 1, .55], [.55, 1, -.55], [0, 1.45, 0]], [[.55, 1, -.55], [-.55, 1, -.55], [0, 1.45, 0]], [[-.55, 1, -.55], [-.55, 1, .55], [0, 1.45, 0]]]) b.tri3(a, c, d, [0, 0], [1, 0], [.5, .6], W);
    else { b.quad([[-.5, 1, .5], [.5, 1, .5], [.5, 1, -.5], [-.5, 1, -.5]], [0, 1, 0], [0, 0, 2, 0, 2, 2, 0, 2], W); }
    return b.build();
  };
  return {
    tree: [
      { make: (n, pick) => sprites.lod(sprites.slots(n, i => pickBy(TREE_KINDS.wood, pick(i))), { minZoom: LOD.macro }) },
      { make: (n, pick) => sprites.lod(sprites.canopySlots(n, i => canopyTone(pickBy(TREE_KINDS.wood, pick(i))), 4.2), { maxZoom: LOD.macro }) },
    ],
    house: [{ geo: box('f:sidingCream:shutter', 'r:plum', true), material: buildings.wallMaterial }],
    block: [{ geo: box('f:brickRed:sill', 'r:flatGravel', false), material: buildings.wallMaterial }],
    // Construction: stumps where trees were felled, scaffolds round rising buildings, and cleared soil (uvs in metres).
    stump: [{ make: n => sprites.lod(sprites.slots(n, () => 'stump'), { minZoom: LOD.macro }) }],
    scaffold: [{ make: n => sprites.lod(sprites.slots(n, () => 'scaffold'), { minZoom: LOD.macro }) }],
    dirt: new THREE.MeshLambertMaterial({ map: ground.soil, polygonOffset: true, polygonOffsetFactor: -1.8, polygonOffsetUnits: -3.6 }), // over land cover (up to 1.5), under paths and roads (2 and up)
  };
}
