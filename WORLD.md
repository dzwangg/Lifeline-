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
| `buildings.js` | Turns each footprint into a styled building: family, walls, roof, doors, awnings, balconies, landmarks. Variation is chosen by a hash of the footprint position, so it is stable across loads. `buildings.style(spec, wallBatch, detailBatch)` styles planned buildings with the same code (see [Planned development](#planned-development)). |
| `streets.js`, `roadnet.js` | Road surfaces, sidewalks, markings, crossings, parking, and the lane and walkway graphs. |
| `land.js` | Parks, woods, water, and rule-based planting that checks the occupancy grid. |
| `traffic.js`, `street-sim.js`, `people-art.js` | Cars and walkers on the street graph, with signals. The people atlas is baked into `world/baked/` (`npm run bake` after changing `people-art.js` or the palette; a test fails while it is stale). |
| `sprites.js`, `sprite-art.js` | Instanced billboard sprites and the hand-painted sprite atlas. |
| `textures.js` | Pixel textures, tile atlases and the building detail atlas. |
| `select.js` | Click a building to outline it and open its info card. |
| `outskirts.js` | Everything past the map: the parkway and the ends of clipped streets, terrain and haze, woods, clean-energy sites, hamlets, transit stops, footbridges and wind turbines (see [The outskirts](#the-outskirts)). |
| `aero.js` | The drifting bubble overlay. |
| `geometry.js` | Batched meshes, ring helpers (`inside`, `bounds`, `inset`, …) and the occupancy `Grid`. |

**Pixel pipeline.** The scene renders into an offscreen target, then a full-screen pass draws a dark outline wherever
depth jumps, applies a colour grade, haze and sun glow, and scales up with nearest-neighbour sampling. The render camera
snaps to whole render pixels, and the leftover fraction is added back in the upscale, so panning is smooth and textures
don't shimmer. The target's grain follows the zoom (`view.grain`, canvas pixels per render pixel). From `ppm = 5` in,
one render pixel is `PIXEL_SCALE = 2` CSS pixels, the chunky pixel-art look. Further out, texture pixels are smaller
than that grain, so the target steps up by whole canvas pixels until it matches the canvas. Distant buildings, roads and
canopies then keep their shape on standard and high-density screens. The canvas follows the device pixel ratio, capped by
`RENDER` in `palette.js` (ratio 2 and about 5.3 million pixels), and resizes with its container. Ink outlines reach about
one CSS pixel at any grain. Screen haze and sun glow ease down to `AERO.farAtmosphere` of their strength when zoomed out.
The shadow map is redrawn every frame only close in (`RENDER.shadowLivePpm`); further out it is redrawn when the view moves,
and otherwise a few times a second.

**Textures.** Magnified, texture pixels stay crisp (nearest filtering). Minified, they use mipmaps blended between
levels, plus anisotropic filtering for the slanted ground and roofs, so distant surfaces settle into their average colour
instead of shimmering. Every atlas pads its regions, so mipmaps can't bleed: wall and roof tiles sit in an 8-pixel
gutter of their own wrapped pattern, detail regions in a 3-pixel rim of their edge colour, and sprites 5 clear pixels
apart. The tiling material caps its filter footprint at the gutter and blends toward each tile's average beyond it.
Sprites lift their cut-out alpha with the mip level, so small trees keep their silhouettes.

**Batching.** After the build, `mergeStatic` (in `geometry.js`) merges small static meshes that share a material,
render state and 700 m square, which saves about 590 draw calls of outskirts scenery. It skips anything instanced,
pickable, moved by the frame loop, or switched by level of detail. Landmark art (Old Well, Bell Tower, domes) has its own
batch, so it stays visible after the far-zoom detail cut. Walkers draw as their smallest directional sprite down to
1.2 px/m and cars as their models down to 0.3 px/m.

**Camera.** An orthographic camera at a fixed 35° elevation, looking at `view.target` from one of four 90° azimuths
(Q/E or the toolbar). Zoom moves between the fixed levels in `ZOOMS` (rendered pixels per metre), so texture pixels stay
square. The camera position is recomputed from `target`, azimuth and zoom every frame. Move the view through
`view.target`, `view.lookAt()` and `view.zoomTo()`, not by setting `camera.position`.

**Frame loop.** `world.update(dt, simDt)` runs once per frame. `dt` is real seconds, used for the camera, the
selection pulse and street life (cars, walkers, signals and the households' day), so the map stays usable and the
street keeps moving while the sim is paused. `simDt` is simulated seconds, used for the rest that moves: wind, water
and turbines. It defaults to `dt`, so the world runs on real time when no clock is attached. In `index.html` the sim
clock supplies it (see [The clock](#the-clock)).

**Households on the street.** `world/households.js` turns the household model's run into walkers: the street sim adds
one per household (`sim.addPed`), each with a look seeded from its id, and sends it where its day says
(`sim.sendPed`): home, a campus or downtown door, 15-501's edge for Durham commuters (who are out of sight until
evening), or a short walk near home for people who work from home. A day lasts `DAY_S` (150) real seconds and loops;
`traffic.hour()` gives the hour and the clock bar shows it. A long trip shows only its two ends (`SHOW_M` at each).
`sim/agent-layer.js` feeds it the shown year (newcomers walk in from the map's edge and leavers walk off it when
playback steps into their year) and floats a rent-burden dot over each household's head, or at its home when zoomed
out past the walkers.

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
| `stats` | `{ buildings, tallest, trees, outskirts }`, plus `vehicles`, `people` and `signals` once street life is built. `outskirts` counts the scenery past the map. |
| `outskirts` | The scenery past the map: `plan` (its roads, sites, stops, bridges), `heightAt(x, z)` (ground height in metres) and `turbines`. |
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
rendered pixel. `ppm` keeps that meaning at every grain. The target itself has `view.renderPpm` pixels per metre, which
is larger when the grain is finer than `PIXEL_SCALE`.

### Tiles: the occupancy grid

The world has no tile map for gameplay. "Tiles" are the cells of `world.grid`, a 1 m grid covering
`|x|, |z| ≤ osm.ext + 700`: the map plus the outskirts' parkway belt.

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
`preventDefault()`: a household's walker opens its resident card (`traffic.onHousehold`), any other walker the
walker card. The household dots (`sim/agent-layer.js`) listen before that and win over both. Do the same for your layer: `addEventListener('pointerup', handler, true)`, and call
`e.preventDefault()` on a hit. Don't stop propagation: the pan control needs the release, or it keeps dragging.

## The outskirts

`outskirts.js` turns the map's square edge into a finished landscape. None of it touches the mapped city or the
simulation: it is scenery, and the wind turbines and solar fields are not counted in any metric. It is built in two
passes inside `buildWorld()`.

**`planOutskirts()`**, after the city's streets, lays out roads and places as data:
- a **parkway** (a secondary road) loops round the city about 230 m past the map edge. It follows a rounded square
  (`squareDist`, a superellipse matching the map), with a slow wander, and bends out round any mapped street or building;
- **clipped streets**, the ones the OSM bake cut off at its bounding box, curve out and join the parkway at proper
  junctions. Trunk, primary and secondary roads instead carry on across it as **highways**, easing outward through the hills;
- **clipped footpaths** reach the parkway's sidewalk; up to four cross it on arched **footbridges** to the
  **greenway**, a cycleway that loops round outside the parkway, easing in and out round anything in its way;
- an end that can't connect without hitting something gets a **turning circle** (streets) or a paved landing with a
  bench (paths), so no road ever stops in the grass;
- **districts** off the parkway (`SITE_PLAN`), each site reached by its own service road:
  - an energy district: an energy hub (batteries, hydrogen tanks, a domed control hall) and a solar field;
  - research parks: a **campus** of rounded pearl wings with glass bands and planted roofs, round a courtyard with a
    glass-domed atrium and a reflecting pool;
  - village farms: **hamlets** of houses round a cul-de-sac, each with a fountain plaza, next to greenhouse farms.

  Campuses, farms and hamlet plazas each have a walk out to the greenway.
- **ponds and streams**: up to five ponds in the meadows past the greenway, beside the campuses first. Each is fed by a
  stream that meanders down from the hills and stops short of any road or site. Park trails loop each pond and follow
  its stream up to a viewpoint near the spring, crossing the water on small arched **footbridges**, and a trail links
  each loop to a trailhead on the greenway;
- **landscaped transit stops** on the parkway near highway and hamlet junctions, with curved translucent canopies.

Its roads, parking lots and houses go through `buildStreets` and `buildBuildings`, a second time, as a separate set.
They are not in `world.streets`, `world.buildings` or the street sim, so cars and walkers stay in the city, and the
houses can't be selected.

**`buildOutskirts()`**, after the land cover, builds the rest:
- **terrain**: one ground mesh out to ±9.8 km, fine near the city and coarser further out. It is flat under the city,
  the parkway belt, every planned road, every site and pond, and along the stream valleys. Beyond that it rolls, then
  rises into layered ridges. `world.outskirts.heightAt(x, z)` is the height of the drawn mesh itself, interpolated over
  its own triangles, and everything stands on it, so nothing floats or sinks where the far cells are coarse. Vertex colours shade the ground from the city's
  lawn to shaded forest floor and sunlit meadow, and a per-vertex haze fades the far hills toward the sky.
- **woods**: `forest()` is a smooth noise field, and `woodsThreshold()` decides how wooded each distance out is:
  a few groves near the city, more past the parkway, a dense tree belt in the first hills, open ridges beyond.
  There are single tree sprites out to 720 m, `grove` sprites (a stand of trees in one sprite) out to about 3.4 km,
  and at far and middle zooms a canopy sheet draped over the woods. The sheet's edge is cut by an alpha test, so
  woods read as solid, outlined masses.
- **structures** in pearl white and aqua glass, using the city's pixel textures, outline pass and shadows. Discreet
  blue lighting (unlit `glow` strips, glowing pylon caps and path `bollard` sprites) marks campuses, stops and plazas;
- **water**: ponds, streams, fountains and pools share one material, whose ripple frames step on `simDt`;
- **wind turbines** in small clusters on high ground, behind the energy hub and the solar fields and on a few far
  ridges. Each cluster takes the highest of a scatter of candidate spots at least 170 m apart, so they follow the land
  rather than standing in rows. They turn on `simDt`, so they stop when the clock is paused and speed up with it, as the
  water and the swaying foliage do. Below 0.6 px/m they are hidden, since they would draw as ink lines;
- **tree-lined verges**: a row of trees along each side of the parkway, plus reeds, lily pads, ferns and rocks at the
  water's edge.

Placement is a function of position (`palette.hash`) and fixed seeds, so the outskirts are the same on every load.
Inside the grid, planting follows the same occupancy rules as the city's. Beyond it, a road-clearance field keeps it
off the roads. Sprite layers take a `haze` option (0 to 1) that fades distant layers toward the horizon.

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
simDt))`. Anything else that should freeze with the sim should use `simDt` the same way. Street life deliberately
doesn't: it runs on `dt`, so the street's day goes on while a year is paused for inspection.

**The clock bar** (`sim/clock-bar.js`, `mountClockBar()`) is a thin view over this. It subscribes and shows `simDate`,
the speed and a status line (loading, failed, end of forecast, and how many new homes didn't fit), and faintly beside them
the street's time of day once street life has loaded (`bar.setHour(traffic.hour)`). Its buttons call `pause()` and
`play(1|2|4)`. Space calls `toggle()`, and 1, 2 and 4 call `play(n)`, except while typing or with a dialog open.
`sim-plate.js` uses the same clock for its year slider (`seek`), "show before" checkbox (`setBefore`) and metrics
(the shown year's, compared with the same year with no new policy, `shown.data.run.noPolicy`). The household layer
(`sim/agent-layer.js`) draws `shown.data.run.households` for the shown year. The zone layer reads `shown`, `frac` and `before` to build
each conversion over 0.9 of the year it happens in (about 2.7 s at 1x), as a planned neighbourhood (see
[Planned development](#planned-development)): only the trees in footprints, front yards, paths and new streets are felled,
new streets are graded and then paved out from their junction, front paths and soil pads go down, scaffolds go up, the
buildings rise one after another, and lawns and planting come last. The steps' timing is in the constants at the top
of `sim/zone-layer.js`. Parcels a forecast converts in a later year get a white outline until their year comes;
converted ones get the gold one.

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

## Planned development

`meridian-city/growth/` turns the sim's parcel conversions into neighbourhoods that extend the streets around them,
drawn by the city's own building code. Screenshots are in `docs/neighbourhood-growth/`, and the design is in
`docs/superpowers/specs/2026-10-10-neighbourhood-growth-design.md`.

| Module | Job |
| --- | --- |
| `units.js` | The demand mapping. A parcel asks for `(unitsPerAcre[to] − unitsPerAcre[from]) × acres` homes, as in `shared/sim.js`, rounded to whole homes by largest remainder year by year, so the map's homes by any year are the sim's rounded total (nothing lost or counted twice). `summarize()` totals homes requested, placed (occupied), built capacity and unmet. |
| `catalog.js` | The building types: detached houses and duplexes (`low_res`), townhouse rows and small apartments (`mid_res`), and apartments over shops (`mixed_use`). Each has sizes, floors, homes per building and the gentlest-first mixes the planner tries, and each zone state the types it permits at full stretch (`FILL`). |
| `context.js` | A site's surroundings: the roads, footpaths and junctions near it, the neighbours' house setback, families and materials, and the palette new buildings draw from (three walls and three roofs, weighted toward the street's own materials and the Aero accents). |
| `site-streets.js` | Local streets for land more than about 35 m from any street. Each leaves a road (never a trunk road) square to the site's grain, at least 25 m from any junction, or branches square off an earlier new street. Parallel streets are at least 56 m apart, and every street ends in a turning circle; none crosses a protected parcel. After the site's own streets come more for the parcels the forecast builds on that those leave unserved. A street is built whole the first time a plan uses it. |
| `plan.js` | `planBlock()` plans the parcels of a site that convert to the same state in the same year. Lots are marched along each street that can serve them, and each footprint is squared to the street at its own lot (so curved roads fan). Buildings sit at the neighbours' setback, or deeper where the parcel starts further back, with a front path from every door. Capacity comes from a ladder climbed only as far as the homes need: the zone's mixes gentlest first, then full stretch (every type the zone permits, as large and tall as it allows, compact yards, and up to three rows along a street, the later ones reached by walks between the buildings in front), then courts (shared lanes from a kerb into land no street reaches, which may cross the site's unchanged, unprotected parcels but never build on them). No two neighbours share a complete design. What doesn't fit is `unmet`, with a `reason`. `clears(plan, x, z)` says which trees fall. |
| `develop.js` | `createDevelopment()` plans a whole forecast year by year, so room for every home is reserved before anything is drawn and a year never moves what an earlier one built. Each block plans on its own land first; homes it still can't hold go on spare land of blocks of the same state built that year or before, its own site first, then the nearest within 600 m (`plan.annexes`), rising in its own year. Homes nothing valid can hold stay `unmet`, with the exact `constraint` in words (the land, the zone's densest types, access, protected parcels, and the land nearby). |
| `art.js`, `world-growth.js` | Meshes and orchestration. Buildings come from `buildings.style()`, two merged meshes per block, rising one after another through a per-vertex start time. Lawns, pads, paths, courts and streets use the ground textures; scaffolds and planting are sprites. Plans and meshes are cached per forecast; the years up to the shown one are planned at once, the rest in the background a block at a time. |

Everything in `growth/` except `art.js` and `world-growth.js` is pure (no THREE, no DOM) and is tested in
`tests/growth.test.js` and `tests/growth-develop.test.js` (the second on a dump of the real map round the corridor
mid-rise card's parcels, `tests/fixtures/growth-corridor-midrise.json.gz`, where every home now has a valid place). Plans
read the base map's occupancy grid and never write to it; their choices are hashes of the site, street, side and lot, so
a forecast always shows the same layout. The ledger is `city.growth.ledger(states, from)`: homes requested (the sim's),
completed, under construction, still planned for later years, unmet, and each short block's constraint. `growthReport`
in `sim/scenario.js` carries the shown year's, and the clock bar's note of homes that didn't fit names the constraints
in its tooltip. Clicking a new building shows its homes, its block's homes requested and placed, any built nearby, and
why any didn't fit.

Finished streets and front paths join the walkers' network through `walk.extend(paths, gate)` (`roadnet.js`). Routing
and wandering skip an edge whose gate is closed, and `sim.addDoors()` makes new homes destinations, so walkers only use a
street in the years it is built. Cars don't drive new streets. The map has no elevation data, so the planner can't fit
buildings to slopes; it does keep clear of water, buildings, roads, footpaths, parking lots and protected parcels.

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
  for pixel art), and distance is suggested by a screen-space haze, plus the outskirts' per-vertex haze on far hills.
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
