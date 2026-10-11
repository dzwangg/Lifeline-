# The pixel world

`meridian-city/world/` draws Chapel Hill as an isometric pixel-art game. It replaces the inline Three.js renderer that
used to live in `meridian-city/index.html`, and it builds from the same OSM bake (`chapel-hill.js`). This note is for
anyone integrating with it: what it exposes, how to place things on it, how the sim clock drives it, and what the old
renderer did that this one doesn't.

## How it works

`buildWorld()` in `world/world.js` builds everything once, in an order that matters. Buildings and streets claim
ground first, and land cover, planting and furniture fill what is left. So decorations never block a road, an entrance
or each other.

| Module | Job |
| --- | --- |
| `palette.js` | Every colour, wall and roof material, building family, zoom level, light and level-of-detail threshold. Re-skinning starts here. |
| `view.js` | The camera, controls and pixel pipeline (below). |
| `buildings.js` | Turns each footprint into a styled building: family, walls, roof, doors, awnings, balconies, landmarks. Variation is chosen by a hash of the footprint position, so it is stable across loads. |
| `streets.js`, `roadnet.js` | Road surfaces, sidewalks, markings, crossings, parking, and the lane and walkway graphs. |
| `land.js` | Parks, woods, water, and rule-based planting that checks the occupancy grid. |
| `traffic.js`, `street-sim.js`, `people-art.js` | Cars and walkers on the street graph, with signals. The people atlas is baked into `world/baked/` (`npm run bake` after changing `people-art.js` or the palette; a test fails while it is stale). |
| `sprites.js`, `sprite-art.js` | Instanced billboard sprites and the hand-painted sprite atlas. |
| `textures.js` | Pixel textures, tile atlases and the building detail atlas. |
| `select.js` | Click a building to outline it and open its info card. |
| `aero.js` | Hills, wind turbines and the drifting bubble overlay. |
| `geometry.js` | Batched meshes, ring helpers (`inside`, `bounds`, `inset`, …) and the occupancy `Grid`. |

**Pixel pipeline.** The scene renders into an offscreen target at `1 / PIXEL_SCALE` of the screen resolution
(`PIXEL_SCALE = 2`). A full-screen pass then draws a dark outline wherever depth jumps, applies a colour grade, haze and
sun glow, and scales up with nearest-neighbour sampling. The render camera snaps to whole render pixels, and the
leftover fraction is added back in the upscale, so panning is smooth and textures don't shimmer.

**Camera.** An orthographic camera at a fixed 35° elevation, looking at `view.target` from one of four 90° azimuths
(Q/E or the toolbar). Zoom moves between the fixed levels in `ZOOMS` (rendered pixels per metre), so texture pixels stay
square. The camera position is recomputed from `target`, azimuth and zoom every frame. Move the view through
`view.target`, `view.lookAt()` and `view.zoomTo()`, not by setting `camera.position`.

**Frame loop.** `world.update(dt, simDt)` runs once per frame. `dt` is real seconds, used for the camera and the
selection pulse, so the map stays usable while the sim is paused. `simDt` is simulated seconds, used for everything
that moves: traffic, walkers, signals, wind, water and turbines. It defaults to `dt`, so the world runs on real time
when no clock is attached. In `index.html` the sim clock supplies it (see [The clock](#the-clock)).

## What `buildWorld()` gives you

```js
import { buildWorld } from './world/world.js';
const world = await buildWorld({ container, osm: window.CHAPEL_HILL, names: window.CHAPEL_HILL_NAMES, zones, progress });
// progress(message, fraction) reports each stage, with fraction reaching 1 when the city can be drawn.
// index.html also sets window.city = world, which is handy in the console.
```

| Field | What it is |
| --- | --- |
| `view` | Camera, controls, renderer and conversions (table below). |
| `grid` | The occupancy `Grid`: 1 m cells with bit flags (see [Tiles](#tiles-the-occupancy-grid)). `gridAt(x, z)` is a shortcut to `grid.at`. |
| `buildings.meta[]` | One entry per building: `{ i, name, family, label, type, floors, height, wall, area, outer, cx, cz }`. `i` indexes `osm.b`, `outer` is the footprint ring, `wall` the eave height and `height` the top including roof. |
| `buildings.pickables` | Meshes to raycast for buildings. Each mesh's `userData.owner[faceIndex]` is the index into `meta`. |
| `selection` | `select(meta \| null)`, `selected`. |
| `streets` | `roads`, `lanes` (drivable) and `walks`: each `{ cls, ow, r, w, len }`, with `r` a flat `[x, z, …]` polyline. |
| `traffic` | The street simulation; `traffic.select(null)` clears a picked walker. Street life (cars, walkers, signals and street furniture) is built after the first frame, so this is `null` until `trafficReady` resolves with it. |
| `timings` | Milliseconds per build stage. `index.html` adds its own stages and logs them when the city is ready. |
| `sprites`, `art` | The sprite system and its atlas (see [Adding sprites](#adding-sprites)). |
| `lod(object, { minZoom, maxZoom })` | Shows `object` only between two zoom levels, in pixels per metre. |
| `zoneParts` | The art the sim's zone layer draws with. |
| `stats` | `{ buildings, tallest, trees }`, plus `vehicles`, `people` and `signals` once street life is built. |
| `update(dt, simDt)` | Advance and draw one frame. |

### Scene and camera, compared with the old renderer

| Old inline renderer | Pixel world |
| --- | --- |
| `scene` | `world.view.scene`, a plain `THREE.Scene`; add your own meshes to it. |
| `camera` (Perspective, free orbit) | `world.view.camera` (Orthographic, fixed angle). Use this one to project. `view.renderCam` is the pixel-snapped copy that actually renders. |
| `controls` (OrbitControls) | `world.view.controls`: OrbitControls with rotation off. Left drag pans, the wheel steps through zoom levels. Its `target` is `view.target`. |
| `renderer.domElement` | `world.view.renderer.domElement`. |
| `at(x, z)`, 2 m cells, bits 1/2/4 | `world.gridAt(x, z)`, 1 m cells. Bits 1 = building, 2 = road and 4 = sim zone keep their old meaning, plus more (below). |
| `inside`, `bounds` | `import { inside, bounds } from './world/geometry.js'`, same ring format. |
| `trunkGeo`, `canopyGeo`, `leafTex`, `GREENS` | Gone. Trees are sprites; the zone layer gets `world.zoneParts`. |
| Fly the camera: animate `camera.position` and `controls.target` | Animate `view.target` (x, z) and call `view.zoomTo(level)`. Setting `camera.position` is overwritten next frame. |

`view` also has `ppm` (current rendered pixels per metre), `level` (index into `ZOOMS`), `azimuth`, `rotate(±1)`,
`zoomTo(i, sx?, sy?)` (keeps the ground under screen point `sx, sy` fixed), `zoomBy(±1)`, `lookAt(x, z)`,
`onChange(fn)` (called with `{ level, ppm, azimuth }`), `screenToGround(sx, sy)` and `raycastScreen(sx, sy, objects)`.

## Coordinates

Map coordinates are **metres in the local frame of the OSM bake**: `x` east, `z` south, `y` up, with the origin at the
centre of the bounding box in `meridian-city/fetch_osm.py`. This frame is unchanged from the old renderer, and
`shared/geo.js` `toLocal()` converts longitude/latitude into it. The mapped area is the square `|x|, |z| ≤ osm.ext`
(1,398 m).

**Map metres → screen (CSS pixels).** Project with `view.camera`, the unsnapped camera. The result is within one render
pixel of what's drawn, which is fine for DOM labels and hit-testing.

```js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
function worldToScreen(view, x, z, y = 0) {
  const v = new THREE.Vector3(x, y, z).project(view.camera);
  const r = view.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}
```

**Screen → map metres.** `view.screenToGround(clientX, clientY)` returns the `THREE.Vector3` where that point meets the
ground (`y = 0`), or `null`. For objects rather than the ground, use
`view.raycastScreen(clientX, clientY, meshes)`.

**Scale.** At zoom level `view.level`, one metre spans `view.ppm` rendered pixels, which is `view.ppm * PIXEL_SCALE`
CSS pixels across the screen. Ground distances appear shortened vertically by the 35° view. Textures and sprites are
painted at `TEXEL = 0.2` m per texture pixel, so at `ppm = 5` (the default zoom level, index 5) one texture pixel is one
rendered pixel.

### Tiles: the occupancy grid

The world has no tile map for gameplay. "Tiles" are the cells of `world.grid`, a 1 m grid covering
`|x|, |z| ≤ osm.ext + 250`.

```js
const { grid } = world;                               // grid.ext, grid.cell (1), grid.n (cells per side)
const i = Math.floor((x + grid.ext) / grid.cell);     // column
const j = Math.floor((z + grid.ext) / grid.cell);     // row
const centre = [(i + .5) * grid.cell - grid.ext, (j + .5) * grid.cell - grid.ext];
grid.at(x, z);                                        // bit flags, or 255 outside the grid
grid.clear(x, z, radius, OCC.building | OCC.road);    // true if no cell in the disc has those bits
```

The flags are in `OCC` (`world/geometry.js`): `building 1, road 2, zone 4, keepClear 8, decor 16, water 32,
sidewalk 64, lot 128`. `keepClear` marks entrances, and `decor` marks cells something has been placed on. To keep your
objects off roads, buildings and doorways and away from each other, check `grid.clear(...)` before placing, then mark
the cells with `grid.fill(x0, z0, x1, z1, OCC.decor)`.

## Adding sprites

Sprites are upright cards that turn to face the camera. They're instanced and depth-tested against buildings, and each
sprite's art comes from the atlas in `sprite-art.js`. `Object.keys(world.art.sprites)` lists the names: trees (`oak`,
`maple`, `pine`, …), shrubs, flowers, street furniture (`lamp`, `bench`, `busStop`, `trafficLight`, …) and walkers.

**A static layer** (markers, props), split into map chunks so off-screen chunks are skipped:

```js
const layer = world.sprites.layer(world.view.scene, [
  { x: 120, z: -300, name: 'lamp' },
  { x: 126, z: -300, name: 'daisyPink', scale: 2 },   // scale multiplies the drawn size
], { minZoom: 1.25, name: 'my markers' });            // hidden below 1.25 px/m; maxZoom works too
layer.group.visible = false;                          // the whole layer, on or off
```

Options: `decal: true` lays the sprite flat on the ground (shadows, footprints). `transparent` and `opacity` give
see-through decals. `renderOrder` sets draw order.

**Moving sprites:** `world.sprites.dynamicLayer(scene, count)` returns `{ mesh, uv, size }`. Each frame, write instance
matrices with `mesh.setMatrixAt(i, matrix)`, the atlas rect into `uv.array` (4 per instance, from `art.sprites[name].uv`)
and `[w, h, sway]` into `size.array`. Then set `needsUpdate` on each. `traffic.js` does this for walkers.

**New art.** Paint it in `spriteAtlas()` in `sprite-art.js` with `add(name, widthPx, heightPx, paint, { sway })`, at
`TEXEL` metres per pixel, lit from the top left, using palette colours, with `outline()` for the ink edge. Keep it at
least two pixels wide at your minimum zoom: anything thinner vanishes in the half-resolution render.

**Plain meshes** work too: add a `THREE.Mesh` to `world.view.scene` and the outline pass draws its silhouette. Lines
and markers that must show through buildings (like the selection outline) use `depthTest: false` and a high
`renderOrder`. Text reads better as a DOM element positioned with `worldToScreen` than as anything drawn in 3D.

**Clicks.** Building selection listens for `pointerup` on the canvas and skips events that are already handled. Walker
picking (`traffic.js`) gets in first with a capture-phase `pointerup` on `window`, and claims a hit with
`preventDefault()`. Do the same for your layer: `addEventListener('pointerup', handler, true)`, and call
`e.preventDefault()` on a hit. Don't stop propagation: the pan control needs the release, or it keeps dragging.

## The clock

`meridian-city/sim/clock.js` is the single source of simulated time. `sim/scenario.js` creates the shared instance and
the one animation loop:

```js
import { simClock, onFrame, START_YEAR, YEAR_MS } from './sim/scenario.js'; // START_YEAR 2026; 1x = 3 s per simulated year
import { simDate } from './sim/clock-bar.js';                               // simDate(3.25) -> "Apr 2029"
```

Time is `step + frac`: `step` is the last complete year whose prediction is on screen (0 to `steps`, which is 10), and
`frac` is how far the clock has run into the next year. Speed only changes how fast `frac` fills. Every speed shows the
same state on the same simulated date.

**Reading.** `simClock.get()`, or `simClock.subscribe(fn)`, which calls `fn` immediately and then on every change. The
state fields are:

| Field | Meaning |
| --- | --- |
| `years` | Simulated years since `START_YEAR` (`step + frac`). Format with `simDate(years)`. |
| `step`, `frac`, `steps` | As above. |
| `playing`, `speed` | Playing at 1, 2 or 4×. |
| `before` | Showing the year-0 baseline for comparison. |
| `shown` | What's on screen: `{ version, step, data, prev, base, tween }`. `data` is that year's `{ zoneStates, metrics, run }`, `base` is year 0. `run` is the whole forecast behind it: `{ result, noPolicy, averages, households }` (see `scenario.js`). |
| `loading` | Waiting for a prediction. Playback holds rather than skipping a year. |
| `stale` | Policies changed since `shown` and the new forecast is still on its way. Paused, it replaces the shown year as soon as it lands; playing, playback holds for it. |
| `error` | The last prediction failed. Play retries. |

**Setting.** `play(speed = current)` (1, 2 or 4) and `pause()`. `toggle()`. `seek(step)` jumps to a whole year and
pauses. `setBefore(bool)` shows or hides the year-0 baseline. You don't call `invalidate()` yourself: `scenario.set(...)`
(policy cards and parameters) bumps the scenario version, and the clock drops older predictions. View state in the same
store (the picked resident, the 15-501 view) doesn't bump it.

**Animating on sim time.** `onFrame((dt, simDt) => …)` registers a per-frame callback on the shared loop. `simDt` is 0
while paused or holding for a prediction. `index.html` runs the world with `onFrame((dt, simDt) => world.update(dt,
simDt))`. Anything else that should freeze with the sim should use `simDt` the same way.

**The clock bar** (`sim/clock-bar.js`, `mountClockBar()`) is a thin view over this. It subscribes and shows `simDate`,
the speed and a status line (loading, failed, end of forecast). Its buttons call `pause()` and
`play(1|2|4)`. Space calls `toggle()`, and 1, 2 and 4 call `play(n)`, except while typing or with a dialog open.
`sim-plate.js` uses the same clock for its year slider (`seek`), "show before" checkbox (`setBefore`) and metrics
(the shown year's, compared with the same year with no new policy, `shown.data.run.noPolicy`). The household layer
(`sim/agent-layer.js`) draws `shown.data.run.households` for the shown year. The zone layer reads `shown`, `frac` and `before` to build
each conversion over 0.9 of the year it happens in (about 2.7 s at 1x): trees are felled one by one and leave stumps,
the ground is cleared to soil, scaffolds go up, and the buildings rise inside them. The steps' timing is in the
constants at the top of `sim/zone-layer.js`. Parcels a forecast converts in a later year get a white outline until their
year comes; converted ones get the gold one.

**Guided views** (`sim/focus.js`): `scenario.focus` is `null`, `'road'` (15-501 and its corridor parcels) or
`'changes'` (the parcels converting next). The camera flies there and back with `view.lookAt`, `zoomTo` and `rotate`.
A changes view never zooms out past `LOD.furniture` (1.25 px/m), where every sprite layer draws, so it shows the felling
and building rather than the far-out fills. It frames the window that holds the most of next year's conversions, and
moves on, cluster by cluster, once they are built. Applying a card with zone rules frames the parcels it converts, and
Play frames the changes when no view is on. `?demo` adds a "Demo scenario" button to the sim panel.

**The before/after wipe** (`sim/wipe.js`): `view.split` (0 to 1 from the left, or `null`) draws the frame in two
passes. Objects on layer 1 draw left of the split, objects on layer 2 right of it, and layer 0 on both; with no split,
layer 1 is left out. The zone and household layers draw the shown year on layer 2, and keep a year-0 copy on layer 1
that they make the first time the wipe is on. `view.raycastScreen` hits layers 0 and 2.

Predictions come from `predict(version, step)` in `scenario.js`, which currently runs `shared/combined.js` (the land-use sim, CH-LUTI and the household model) in the browser. A
forecast backend could answer the same call. Add `?latency=ms` to the page URL to simulate a slow backend and watch the
clock hold.

## What the old renderer had that this doesn't

- **Free 3D camera.** Perspective projection with orbit, tilt down to near street level, and smooth continuous zoom
  to the cursor. Now there is one fixed 35° isometric angle, four 90° rotations, and eight discrete zoom levels.
  Camera fly-throughs need rewriting as pans of `view.target` plus `zoomTo` (see the table above).
- **The `ALT n m` altitude readout.** Orthographic views have no altitude, so a zoom readout (`1×`, `1/2`, `2×`, …)
  replaces it.
- **Physically based lighting.** The Sky shader, image-based environment lighting, ACES tone mapping, metal and glass
  reflections, and normal-mapped water reflecting the sky. Now there is one sun and a sky fill with flat pixel shading,
  a little gloss, stepped water ripples and a final colour grade.
- **Soft shadows and fog.** Soft-edged shadow filtering and distance fog. Shadows are hard-edged now (intentionally,
  for pixel art), and distance is suggested by a screen-space haze.
- **Full-resolution detail.** The old canvas rendered at device resolution with anisotropic filtering. The world draws
  at half resolution, so anything under about 2 screen pixels, such as hairline overlays, thin roads at far zoom or
  small 3D text, disappears or turns blocky.
- **Globals in `index.html`.** The old inline module defined `scene`, `camera`, `controls`, `renderer`, `at`, `inside`,
  `bounds` and the tree geometries in page scope, and `mountZoneLayer` and the upstream `mountAgentLayer` take them as
  arguments. Those now come from `world` and `world/geometry.js`, as mapped above. `sim/agent-layer.js` takes `world` and
  flies to 15-501 with `view.lookAt`, `zoomTo` and `rotate`.
- **2 m occupancy cells.** The old `at()` grid had 2 m cells with three flags. The new grid has 1 m cells with eight
  flags, and the first three keep their meaning.

The geography is the same: footprints, heights, road geometry and the local coordinate frame all come from the same
bake. Building names (`chapel-hill-names.js`, from `scripts/fetch-names.js`) are new.
