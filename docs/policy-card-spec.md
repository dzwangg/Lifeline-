# Meridian policy card spec

A policy card is one JSON file in `data/policies/`. Each card describes a local policy: who decides it, the knobs a resident can turn, which zones on the map it changes or which levers of the town's economy it sets, and the tradeoffs on both sides. The simulator and the UI are built entirely from cards. No policy names are hardcoded.

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
| `category` | string, optional | Which policy-panel row the card sits in: `business`, `employment`, `housing`, `taxation` or `transport`. Defaults to `housing`. |
| `icon` | string, optional | Card icon: `storefront`, `sprout`, `hire`, `house`, `percent`, `tower`, `parking`, `vacancy`, `bus` or `bike`. Defaults to `house`. |
| `decider.body` | string | Who decides, e.g. a council or board. |
| `decider.how` | string[] | How the decision gets made or how residents can weigh in. One step per entry. |
| `params` | object[] | Sliders the resident can move. See [Params](#params). |
| `zoneRules` | object[], optional | How the policy changes zones over time. See [Zone rules](#zone-rules). |
| `levers` | object[], optional | Which CH-LUTI levers the policy sets. See [Levers](#levers). |
| `timing` | object, optional | When the levers start and how long they take to phase in. See [Timing](#timing). |
| `evidence` | object[], optional | What the model's assumptions for this card rest on. See [Evidence](#evidence). |
| `tradeoffs.pros` | string[] | **At least one.** |
| `tradeoffs.cons` | string[] | **At least one.** |

A card needs at least one zone rule or one lever (or both). Unknown fields are rejected, so a typo like `zonerules` fails validation instead of being silently ignored.

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

### Levers

A lever is an input of the CH-LUTI model (`shared/luti/`): the town economy, travel and budget model. A card sets levers, never outcomes; the model works out what follows.

| Field | Type | Rules |
|---|---|---|
| `lever` | string | One of the levers below. |
| `value` | number | A fixed value for the lever. |
| `param` | string | The `key` of one of this card's params: the slider sets the lever's value. Give `value` or `param`, not both. |
| `zones` | string[], optional | Zoned levers only: `downtown`, `campus`, `north`, `east`, `south`. All five if omitted. |

| Lever | Unit | Adds up across cards how |
|---|---|---|
| `business.supportGrants` | dollars a year | sum |
| `business.startupGrants` | dollars a year | sum |
| `employment.hiringSubsidy` | dollars a year | sum |
| `housing.subsidyPerUnit` | dollars per new home | sum |
| `housing.subsidyCap` | dollars a year | sum |
| `housing.farMultiplier` | times today's floor area, zoned | product |
| `housing.parkingMinimum` | spaces per new home, zoned | the lowest; never raises today's minimum |
| `housing.planningCost` | dollars, once | sum, paid in the start quarter |
| `tax.rateDelta` | cents per $100 of value | sum |
| `tax.storefrontVacancyTax` | % of value a year | sum |
| `transit.serviceMultiplier` | times today's bus service | product |
| `transport.protectedBikeKm` | km | sum |

```json
"params": [{ "key": "cents_per_100", "label": "Change to the rate", "min": -10, "max": 10, "default": -4, "unit": "¢ per $100" }],
"levers": [{ "lever": "tax.rateDelta", "param": "cents_per_100" }]
```

### Timing

| Field | Type | Rules |
|---|---|---|
| `delayQuarters` | whole number, 0 or more | Quarters before the levers start. |
| `phaseInQuarters` | whole number, 0 or more | Quarters from the start until they are fully in effect. 0 means at once. |

Without `timing`, levers take full effect in the first quarter.

### Evidence

| Field | Type | Rules |
|---|---|---|
| `claim` | string | What the source says, in a sentence. |
| `source` | string | Author, year and publication, or the dataset. |
| `url` | string, optional | An `http(s)` link to the source. |

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
  - `corridor`: in a wood within 150 m of an OSM trunk road. In this map those run along the south edge (the 15-501 corridor). Corridor parcels are also `map_edge`, but their homes count as their own zone, with no commute penalty (see below).
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
- **Commute**: baseline + `commuteDistancePenalty × (new homes in map_edge zones that are not corridor ÷ all homes)`
- **Tree cover**: baseline minus lost canopy acres as a share of the map area
- **Tax revenue**: `units × median home value × propertyTaxRate`

When several cards are active, their percentage effects add up and are then clamped to ±50% of baseline. If two cards target the same zone, the card that comes first by `id` converts it.

Only the `SimResult` returned directly by `runScenario` carries the aggregate rent, commute, homes and tax above. The page and the narration fixture use the full `SimResult` from `shared/combined.js`, which runs three models in order and takes each metric from one of them:

| Model | Metrics |
|---|---|
| Land-use sim (`shared/sim.js`) | tree cover, and the homes your zone rules build |
| CH-LUTI (`shared/luti/`) | homes, median rent, commute, property tax revenue, jobs, storefront businesses, downtown storefront vacancy, median home value, town budget (net), bus trips, car traffic |
| Household model (`shared/agents.js`) | households, priced out, and the households on the map |

- **One growth path.** With no policy, CH-LUTI grows the town: homes from construction calibrated to the 2015-2025 Census Building Permits Survey (about 334 a year), households from the 2010-2020 Census household growth (`lutiRegionalGrowth`) and job growth. The household model gets the same homes and fills the town to CH-LUTI's household count, so both models grow alike.
- **Rent and commute** are CH-LUTI's (rents include regional rent inflation). Each simulated household's rent and commute follow CH-LUTI's path for its zone, and incomes grow as CH-LUTI's do (`lutiIncomeGrowth`).
- **Priced out** counts households living in town in year 0 that have left by the shown year. Each year a renter may leave, with a chance that grows with how far their rent burden has risen above 30% since they arrived (`agentLeaveRate`), so it follows rent rising faster than income. Newcomers can leave too (they fade out on the map) but aren't counted.
- **Homes** are today's 23,713, plus that growth, plus the homes your zone rules build (each parcel feeds the CH-LUTI zone it lies in, a quarter of each year's homes per quarter), plus homes lever cards add. New homes can crowd out a little other building, so the total can rise less than a card's own homes.
- **Property tax revenue** is homes × `medianHomeValue` × (`propertyTaxRate` + the tax card's change), in today's dollars. The town budget line uses the same number.
- **The household model** places your rules' homes by parcel: corridor parcels in a corridor zone (no extra trip on 15-501), other `map_edge` parcels at the edge (they commute over 15-501), the rest downtown. CH-LUTI's other new homes go by its zone: east and south to the edge, the rest in town. For CH-LUTI, `map_edge` and corridor parcels feed its east or south zone (the 15-501 side), the others the zone they lie in.
- **Changes in points.** Tree cover, storefront vacancy and car traffic deltas also carry `changePts`, the change in percentage points, as the panel shows them.
- **Every change** is against the same three models run with no new policy, in the same year.

## How CH-LUTI runs levers

CH-LUTI simulates 40 quarters from 2027 in five zones. The `SimResult` uses its run at central parameters. It also runs 200 times with its uncertain parameters drawn from their ranges, with and without the active cards' levers and zone-rule homes, which gives the range the middle 80% of changes fall in (P10 to P90) and a "why" trace; the page keeps these but doesn't show them (`DETAILS` in `meridian-city/sim/sim-plate.js`). Its year 0 is `data/baselines.json`: homes, population, median gross rent, mean commute and median home value. Its unsourced constants are the `luti*` entries in `data/assumptions.json`. See `shared/luti/model.js`.

## capParam

`capParam` links a rule to a slider. With `"capParam": "acres_released"` and the slider at 40, the card converts at most 40 acres in total. Rules that name the same param share those 40 acres. A slider at 0 means the card changes nothing. Without `capParam`, only `ratePerYear` limits the rule.

## Both sides, always

Every card must list at least one pro **and** at least one con, and validation fails otherwise. Meridian shows tradeoffs, never recommendations. Write both sides in neutral, concrete language ("adds homes near the corridor", "removes tree canopy from the edge woods"), not advocacy ("a smart investment", "a reckless giveaway"). Leave out numbers that depend on a slider or on what the model works out, such as home counts, acres or a cost at the default: the panel shows those, and card text would drift from them. Fixed facts and figures from a cited study are fine ("about 0.5% more riders per 1% more service in the studies cited"), as long as the panel doesn't show a different number for the same thing.

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
