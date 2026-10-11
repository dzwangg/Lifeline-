# Neighbourhood growth: design

Converted sim parcels become small planned neighbourhoods instead of identical boxes on an 18 m grid.

## Decisions

- **What is drawn:** only the zone rules' parcel conversions (`shared/sim.js`). CH-LUTI's homes that aren't tied to a parcel stay off the map.
- **New streets:** drawn in the city's road art, and walkable: their sidewalks join the walker graph, gated until built. Cars don't drive them.
- **Terrain:** the OSM bake has no elevation, so the ground is flat. The planner checks water, buildings, roads, footpaths, parking lots and protected parcels. It doesn't check slope.

## Modules

| Module | Job |
| --- | --- |
| `world/rings.js` | Pure ring helpers, moved out of `geometry.js` (which re-exports them) so the planner runs under `node --test`. |
| `world/buildings.js` | The per-footprint code is now `style(spec, wallBatch, detailBatch)`, used for OSM footprints and planned buildings alike. A spec can force family, materials, floors, roof shape, the front edge, the number of doors, porch, chimney, solar and ground-floor style. |
| `growth/units.js` | The explicit demand mapping (below). |
| `growth/catalog.js` | Residential types: detached, duplex, townhouse row, small apartments, mixed-use apartments. Footprint ranges, floors, units, styling rules. |
| `growth/context.js` | A site's surroundings: drivable roads and junctions, nearby building families, wall and roof mix, median setback, and the site's palette. |
| `growth/site-streets.js` | Plans each site's local streets: branches grown toward land more than ~35 m from any street, meeting their parent street at right angles, at least 25 m from junctions, never on a trunk road, and ending in a turning circle. A street is built whole the first time a parcel needs it. |
| `growth/plan.js` | `planParcel`: lots marched along each access line (existing roads, then site streets), footprints squared to the street at each lot, the neighbours' setback, a front path to the sidewalk, type mix escalated until demand is met, and deterministic styles with no identical neighbours. Also `clears(plan, x, z)` for tree felling. |
| `growth/art.js` | THREE side: parcel meshes from the shared styler, rise shader, pads, lawns, paths, street meshes, landscaping sprites. |
| `sim/zone-layer.js` | Plans and builds parcels when a forecast arrives, and drives the stages from the clock. Publishes the ledger. |

A site is a wood (`wood-NN` tag) or a single parking parcel.

## Demand mapping

- Requested homes per parcel are `(unitsPerAcre[to] − unitsPerAcre[from]) × acres`, the sim's own formula.
- Within each site, the converted parcels' requests are rounded to whole homes by largest remainder. So the map's total for a site is within one home of the sim's.
- Units per building: detached 1, duplex 2, townhouse row 3–6, small apartments `floor(area × floors × 0.75 / 85)`, mixed-use `floor(area × (floors − 1) × 0.8 / 80)`.
- A building's occupied units are capped at what the parcel still needs. Capacity and occupancy are tracked separately.
- Unmet homes are requested minus occupied. They're reported (clock bar, building card, `city.growth`) and never fed back into the sim.
- Styling never changes unit counts.

## Stages (shares of the conversion's `CONSTRUCT` time)

| Stage | Share | What shows |
| --- | --- | --- |
| Prepare | 0–.3 | Trees in footprints (+2 m) and street/path corridors fall and leave stumps. All others stay. |
| Access | .12–.35 | New streets show as graded soil, then asphalt and sidewalks sweep out from the junction. Front paths appear. |
| Build | .3–.88 | Soil pads under footprints; scaffolds; buildings rise one after another. |
| Finish | .8–.9 | Scaffolds come down. |
| Landscape | .85–1 | Lawns in the lots; shrubs, flowers, yard trees and street trees grow. |

## Determinism

Plans depend only on static data: parcel geometry, the base-map occupancy grid, roads and buildings. They also depend on the target state and the set of protected parcels. Every random choice is a hash of the parcel id, the lot slot and a salt. Plans are cached, so seeking, the wipe and reloads show the same layout.

## Changes made during implementation

- **Blocks.** The sim's parcels are cut on a 64 m grid, so beside a diagonal road they are slivers that rarely hold a mid-rise footprint. The parcels of a site that convert to the same state in the same year are planned as one block (`planBlock`), and lots may cross the lines between them. Requested homes are summed per block, and the ledger still counts parcels. Blocks depend on the forecast, so they are stable within a forecast and change only when the policies do.
- **Footpath frontage.** Apartments, mixed-use blocks and townhouse rows may front a footpath (the spec allows "a road or pedestrian path"). Detached houses and duplexes need a street.
- **Local palette.** Besides the family's own walls, the palette may use walls that at least two nearby homes use (siding, brick, stucco, pearl or stone), so new houses pick up the street's materials.
- **Setbacks slide.** A building sits at the neighbours' setback, or up to 14 m deeper where the parcel starts further back from the street. Its front yard then crosses the verge.
- **Front yards are felled** along with footprints, paths and streets, so facades aren't hidden. Back-yard and buffer trees stay.
- **Disposal.** When a new forecast arrives, the meshes of plans it can't show are freed, and their walks are closed.
- **Results at year 10** (default card settings): edge subdivisions place 152 of 240 homes, corridor mid-rise 244 of 299, and core infill 91 of 697. Core infill's woods are narrow wedges between back gardens, so most of its 70-homes-an-acre demand is reported unmet.

## Verification

- `tests/growth.test.js` uses synthetic straight-road, curved-road, established-neighbourhood and wooded-interior fixtures. It checks:
  - determinism;
  - no overlaps, and no footprints on roads or buildings;
  - every building has a door path to a sidewalk;
  - the units mapping, and unmet reported when space runs out;
  - lots line up with curved roads;
  - only corridor trees are cleared;
  - streets end in a turning circle and keep clear of junctions.
- Visual: screenshot sequences in `docs/neighbourhood-growth/`.
