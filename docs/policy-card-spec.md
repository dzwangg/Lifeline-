# Meridian policy card spec

A policy card is one JSON file in `data/policies/`. Each card describes a local policy: who decides it, the knobs a resident can turn, which zones on the map it changes, and the tradeoffs on both sides. The simulator and the UI are built entirely from cards. No policy names are hardcoded.

## Workflow

1. Write `data/policies/<card-id>.json` (the file name should match the card's `id`).
2. Run `npm run validate:cards`. It checks every card and prints each problem with the field path, e.g. `tradeoffs.cons: needs at least one entry`.
3. Commit the card **and** `data/cards.index.json`. The validate script rewrites that file, and the site loads cards from it because a static host can't list a folder.

At startup the page loads every card in the index. If a card is invalid, the page logs a warning in the browser console and skips that card. While the index is empty, the stub test card (`tests/fixtures/stub-card.json`) appears instead, so the demo works before any real card exists. It disappears once your first card is in the index, and adding `?stub` to the URL brings it back.

## Fields

| Field | Type | Rules |
|---|---|---|
| `id` | string | Lowercase words joined by dashes: `edge-forest-release`. Unique across cards. |
| `title` | string | Short name shown on the card. |
| `summary` | string | One or two plain sentences on what the policy does. |
| `category` | string, optional | Which policy-panel row the card sits in: `business`, `employment`, `housing` or `taxation`. Defaults to `housing`. |
| `icon` | string, optional | Card icon: `storefront`, `sprout`, `hire`, `house` or `percent`. Defaults to `house`. |
| `decider.body` | string | Who decides, e.g. a council or board. |
| `decider.how` | string[] | How the decision gets made or how residents can weigh in. One step per entry. |
| `params` | object[] | Sliders the resident can move. See [Params](#params). |
| `zoneRules` | object[] | How the policy changes zones over time. See [Zone rules](#zone-rules). May be empty, but then the card changes nothing on the map. |
| `tradeoffs.pros` | string[] | **At least one.** |
| `tradeoffs.cons` | string[] | **At least one.** |

Unknown fields are rejected, so a typo like `zonerules` fails validation instead of being silently ignored.

### Params

| Field | Type | Rules |
|---|---|---|
| `key` | string | snake_case, unique within the card: `acres_released`. |
| `label` | string | Slider label. |
| `min`, `max` | number | `min < max`. |
| `default` | number | Between `min` and `max`. Used until the resident moves the slider. |
| `unit` | string | Shown after the value, e.g. `acres`. May be `""`. |

### Zone rules

| Field | Type | Rules |
|---|---|---|
| `where` | string | Which zones the rule applies to. See [`where` syntax](#where-syntax). |
| `from` | ZoneState | Only zones currently in this state convert. |
| `to` | ZoneState | The state they become. Must differ from `from`. |
| `ratePerYear` | number | Above 0, at most 1. The fraction of the zones matching `where` that convert each year. |
| `capParam` | string, optional | The `key` of one of this card's params. That param's value caps the total acres the card converts. See [capParam](#capparam). |

## Zone states

| State | On the map |
|---|---|
| `forest` | Trees |
| `low_res` | Small houses on a grid |
| `mid_res` | Taller blocks |
| `mixed_use` | Taller blocks |
| `parking` | Cleared ground |
| `transit_station` | Taller blocks |

Every zone in `data/zones.geojson` starts as `forest`. A zone is a parcel of about an acre or less. The 30 largest woods on the map are each cut into parcels, so a policy spreads through a wood over the years instead of flipping all of it at once.

## `where` syntax

- `tag:<tag>` matches every zone carrying that tag. The current tags are:
  - `map_edge`: in a wood within 50 m of the map boundary. This is the edge of the area the map covers (downtown and UNC), **not** the town limit.
  - `corridor`: in a wood within 150 m of an OSM trunk road. In this map those run along the south edge (the 15-501 corridor).
  - `wood-01` to `wood-30`: every parcel of one wood. `wood-01` is the largest.
- `id:<zoneId>` matches one parcel, e.g. `id:zone-07-03` (wood 07, parcel 03). Open `data/zones.geojson` to see each parcel's acres and tags.

The validate script warns when a `where` matches no zone.

## How the sim runs a rule

Each year, for every active card (cards run in `id` order) and every rule on the card, in order:

1. The rule's quota so far is `round(ratePerYear × year × number of zones matching where)`, minus the zones it has already converted.
2. It walks the matching zones **closest to the map edge first**, with ties broken by zone id, and converts each zone that is still in `from` until the quota is met.
3. If the zone would push the card past its cap, it is skipped and the next zone is tried.

Converting a zone changes the stocks: housing units come from `unitsPerAcre`, and the zone's canopy share comes from `canopyMinPct` (both in `data/assumptions.json`). The metrics follow from the stocks:

- **Median rent**: `rentSupplyElasticity × % change in housing supply`
- **Commute**: baseline + `commuteDistancePenalty × (new homes in map_edge zones ÷ all homes)`
- **Tree cover**: baseline minus lost canopy acres as a share of the map area
- **Tax revenue**: `units × median home value × propertyTaxRate`

When several cards are active, their percentage effects add up and are then clamped to ±50% of baseline. If two cards target the same zone, the card that comes first by `id` converts it.

## capParam

`capParam` links a rule to a slider. With `"capParam": "acres_released"` and the slider at 40, the card converts at most 40 acres in total. Rules that name the same param share those 40 acres. A slider at 0 means the card changes nothing. Without `capParam`, only `ratePerYear` limits the rule.

## Both sides, always

Every card must list at least one pro **and** at least one con, and validation fails otherwise. Meridian shows tradeoffs, never recommendations. Write both sides in neutral, concrete language ("adds about 200 homes", "removes 30 acres of forest"), not advocacy ("a smart investment", "a reckless giveaway").

## Example

This example is illustrative only. It lives in this doc, not in `data/policies/`.

```json
{
  "id": "corridor-midrise",
  "title": "Mid-rise housing along 15-501",
  "summary": "Allows mid-rise apartments on wooded parcels near the 15-501 corridor.",
  "category": "housing",
  "icon": "house",
  "decider": {
    "body": "Town Council",
    "how": [
      "Planning staff draft a rezoning.",
      "Residents comment at a public hearing.",
      "Council votes on the rezoning."
    ]
  },
  "params": [
    { "key": "acres_released", "label": "Acres opened to mid-rise", "min": 0, "max": 60, "default": 20, "unit": "acres" }
  ],
  "zoneRules": [
    { "where": "tag:corridor", "from": "forest", "to": "mid_res", "ratePerYear": 0.25, "capParam": "acres_released" }
  ],
  "tradeoffs": {
    "pros": ["More homes near an existing transit corridor.", "Adds property tax base."],
    "cons": ["Clears wooded land.", "More traffic near the corridor."]
  }
}
```
