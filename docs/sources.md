# Sources for model inputs

These are proposed sourced values for every `PLACEHOLDER` or `VERIFY` entry in `data/assumptions.json` and `data/baselines.json`, plus coefficients for the agent model. Nothing here has been applied to the data files yet.

Researched 2026-10-10. Most of these have since been applied. For the October 11 check of every starting value against the newest sources (ACS 2020–2024, the FY2026–27 budget, the 2025 population estimate), see [fact-check.md](fact-check.md).

**Applies** says how closely the source describes Chapel Hill:
- **direct**: measured for Chapel Hill, or for the map area.
- **regional**: Orange County, the NC Piedmont, or North Carolina.
- **proxy**: a generic or national value, or a different quantity standing in for this one.

**Confidence** is high, medium, or low.

Values marked *our calculation* are our own arithmetic on the cited data. The source does not publish that number.

## Summary

| Key | Current | Proposed | Applies | Confidence |
|---|---|---|---|---|
| `baselines.housingUnits` | 23,713 (VERIFY) | **23,713**, verified | direct | high |
| `baselines.treeCoverPct` | 13.7 | **46.9** (map area) | direct | medium |
| `assumptions.unitsPerAcre` | 0 / 4 / 20 / 30 / 0 / 0 | **0 / 4 / 15 / 70 / 0 / 0** | direct | medium (low_res high) |
| `assumptions.treesPerAcre` | 33 | **177** (live trees ≥5 in. DBH) | regional | high |
| `assumptions.commuteDistancePenalty` | 3 min | **0.6 min** | direct, weak | low |
| 15-501 road capacity | — | **2,000 veh/h per direction** | direct | medium |
| Chapel Hill household growth rate | — | **0.73% per year** | direct | high |
| Remote-work share | — | **0.28** | direct | high (as a 2020–24 average) |
| Durham commute share | — | **0.20** | direct | medium |
| Car mode share | — | **0.74** of workers who travel (0.53 of all workers) | direct | high |
| Low-density units per acre | — | **4** | direct | high |
| Trees per acre, Piedmont NC forest | — | **177** (live trees ≥5 in. DBH) | regional | high |
| Chapel Hill tree canopy % | — | **57%** town-wide | direct | medium |

unitsPerAcre is listed in this order: forest / low_res / mid_res / mixed_use / parking / transit_station.

Vintage: the existing ACS baselines are 2019–2023. The new ACS values below use 2020–2024, the latest 5-year release. Where it matters, the 2019–2023 figure is given alongside.

---

## data/baselines.json

### housingUnits: 23,713 (VERIFY → verified)

- **Value:** 23,713 housing units on April 1, 2020: 22,118 occupied and 1,595 vacant.
- **Source:** 2020 Census Redistricting Data (P.L. 94-171), Table H1 "Occupancy Status", Chapel Hill town, NC.
- **URL:** https://data.census.gov/table/DECENNIALPL2020.H1?g=160XX00US3711800
- **Applies:** direct. **Confidence:** high.
- **Note:** the count is exact and matches the current value. Only the `source` string needs to change, to the Census table.

### treeCoverPct: 46.9 (PLACEHOLDER)

`sim.js` computes tree cover over the map area (`canopyAcres / mapAreaAcres`). So the baseline should be canopy over the map bbox, not the town-wide figure.

- **Proposed:** 46.9% (year 2021).
- **Source:** USFS / MRLC NLCD Tree Canopy Cover, CONUS v2021-4, 30 m, coverage `mrlc_download__nlcd_tcc_conus_2021_v2021-4`.
- **URL:** https://www.mrlc.gov/geoserver/mrlc_download/wcs
- **Method (our calculation):** mean of the pixels inside the bbox in `meridian-city/fetch_osm.py`. 2011 gives 46.8%.
- **Applies:** direct. **Confidence:** medium.
  - 30 m modelled canopy tends to read lower than 1 m mapping in urban areas.
- **Cross-check:** 50.3% tree cover over the same bbox (2010).
  - Source: EPA EnviroAtlas, Durham NC community, 1 m land cover from 2010 NAIP imagery, block-group "Percent tree cover" (`MFor_P`).
  - URLs: https://enviroatlas.epa.gov/arcgis/rest/services/Communities/Community_BGmetrics/MapServer/41 and the fact sheet https://www.epa.gov/sites/production/files/2015-07/documents/durhamnc.pdf
  - *Our calculation:* block groups weighted by overlap with the bbox.
- **No official figure:** the Town publishes no canopy percentage.
  - Staff answers to Council (2025-10-22) refer to "our current lack of an official Urban Tree Canopy goal": https://chapelhill.legistar.com/View.ashx?GUID=534FC7A7-85EE-420B-8A87-2F58ECBE14D8&ID=14883816&M=F
  - American Forests' Tree Equity Score NC data has `treecanopy = -1` for every NC row, so it gives no usable number.
- The current 13.7% (OSM `natural=wood`) is about a quarter of real canopy. The town-wide value is under "Chapel Hill tree canopy %" below.

---

## data/assumptions.json

### unitsPerAcre (PLACEHOLDER)

Chapel Hill zoning no longer has a units-per-acre cap in residential districts.
- Ordinance 2023-06-21/O-6 ("Housing Choices for a Complete Community", enacted 2023-06-21) deleted the density column from LUMO Table 3.8-1. Section 5: "Table 3.8-1: Dimensional Matrix is hereby amended to delete column (C) Density".
  - https://chapelhill.legistar.com/View.ashx?M=F&ID=12120542&GUID=ACEC08FF-5848-4DA7-AA3F-8A9D0315D292
- Housing is now limited by lot size, units per lot, FAR and height.
- A full LUMO rewrite is in draft (July and Sept 2026). It is not adopted; adoption is expected no earlier than 2026-11-18.

So the proposals below combine the **last codified caps**, the **Future Land Use Map** ranges, and **densities of approved projects**. Which district stands for which sim state is our mapping, not the ordinance's.

| State | Proposed | Basis | Applies | Confidence |
|---|---|---|---|---|
| forest | **0** | Undeveloped land | — | high |
| low_res | **4** | FLUM "Low Residential, generally 1 to 4 units/acre"; old R-2 cap 4.0 (R-1 was 3.0) | direct | high |
| mid_res | **15** | Old R-5/R-6 cap 15.0; FLUM "High Residential, generally 8 to 15+ units/acre"; MU-V collector/local cap 15; Blue Hill conventional-option cap 15.0 | direct | medium |
| mixed_use | **70** (alt. 20) | No cap in Town Center or Blue Hill; approved podium projects run about 70–99 du/ac | direct | medium-low |
| parking | **0** | By definition | — | high |
| transit_station | **0** | The station tile itself; see the note below | — | medium |

Sources:

- **Old Table 3.8-1** (last in force before 2023-06-21; Municode Supp. 30, through Ord. 2023-05-24/O-3), column "Density (units per acre max)".
  - Values: R-LD5 0.2, R-LD1 1.0, R-1A 2.0, R-1 3.0, R-2A 3.5, R-2 4.0, R-3 7.0, R-4 10.0, R-5 15.0, R-6 15.0, OI-2 15.0, MU-V arterial 20.0.
  - https://api.municode.com/CodesContent?jobId=426902&nodeId=PTIICO_APXALAUSMA_ART3ZODIUSDIST_3.8DIST&productId=19952
  - The current table (Supp. 36, through Ord. 2026-06-17/O-6) has no density column: https://api.municode.com/CodesContent?jobId=491079&nodeId=PTIICO_APXALAUSMA_ART3ZODIUSDIST_3.8DIST&productId=19952
- **Future Land Use Map**, *Charting Our Future* (Dec 2020): "Low Residential, generally 1 to 4 units/acre"; "Medium Residential, generally 4 to 8 units/acre"; "High Residential, generally 8 to 15+ units/acre".
  - https://online.flippingbook.com/view/26191/1/
- **MU-V caps** are still in force. LUMO §3.5.1 (Supp. 36): "Permitted density shall not exceed fifteen (15) dwelling units per acre for MU-V collector and MU-V local and twenty (20) du/are for MU-v arterial."
- **Approved projects (Town staff reports):**

  | Project | Zoning | Units / acres | Density |
  |---|---|---|---|
  | 710 N Estes | R-5-CZD | 107 units, 8.06 ac | 13.3 du/ac |
  | Stanat's Place | R-5-CZD | 47 townhomes | 5.2 du/ac |
  | Tri Pointe | R-5-CZD | 119 units, 17.1 ac | 6.95 du/ac |
  | Barbee Chapel | R-6-CZD | 342 units | 31 du/ac |
  | South Creek | MU-V-CZD, about 43 ac | — | up to 17.3 du/ac |

  - 710 N Estes: https://chapelhill.legistar1.com/chapelhill/attachments/f4aa4c11-320c-46fd-b37f-0dbf79dd6cd6.docx
  - Barbee Chapel: https://chapelhill.legistar1.com/chapelhill/attachments/a076295f-2cac-4185-b5af-12865bb9accb.docx
  - South Creek: https://chapelhill.legistar1.com/chapelhill/attachments/619d65da-02bd-48fb-b34d-7b2321891c55.docx
- **Mixed-use observed densities:**
  - Fordham Blvd Apartments (Blue Hill): 273 units on 3.9 ac, about 70 du/ac. Chapelboro, 2017-05-09: https://chapelboro.com/news/development/proposal-calls-273-apartment-units-fordham-boulevard
  - Aura Blue Hill: 274 units on 2.76 ac, about 99 du/ac. News & Observer via Yahoo, 2021-10-28: https://www.yahoo.com/news/developer-request-leaves-chapel-hill-094500130.html
  - 101 E. Rosemary St (TC-3-CZD): about 150 units on 0.7 ac, about 214 du/ac on one downtown lot (approved 2023-04-26; not confirmed built): https://chapelhill.legistar1.com/chapelhill/attachments/9c06f852-7dd9-4b44-9094-b9564b4d7141.docx
  - *Our calculation* for all three du/ac figures.
  - 70 is the low end of the podium projects. Use **20** (MU-V arterial cap) if `mixed_use` means a suburban village rather than a downtown or Blue Hill mid-rise.
  - Going from 30 to 70 more than doubles the homes per converted acre, so rent and tax move a lot more.
- **Transit station:** the FTA North-South BRT profile (rating Nov 2023) says "The planned station area densities range from 7.5 dwelling units per acre (du/ac) (Medium-Low rating) to 132 du/ac (High rating)."
  - https://web.archive.org/web/2024id_/https://www.transit.dot.gov/sites/fta.dot.gov/files/2024-03/NC-Chapel-Hill-North-South-BRT-Profile-AR25.pdf
  - This is direct but describes station *areas*. Keep 0 for the station tile itself, and use the `mixed_use` value if station-adjacent tiles should carry housing.

### treesPerAcre: 177 (PLACEHOLDER)

- **Proposed:** 177 live trees per acre at ≥5 in. DBH.
- **Source:** USDA Forest Service FIA, EVALIDator (FIADB-API), NC 2024 evaluation (`wc=372024`), Piedmont survey unit 3703. Piedmont forest land is 5,329,315 ac.
- **URLs:**
  - Trees by diameter class: https://apps.fs.usda.gov/fiadb-api/fullreport?snum=4&wc=372024&rselected=Unit%20code&cselected=Diameter%20class%3A%202%20inch%20class%20to%2029&outputFormat=NJSON
  - Forest area: https://apps.fs.usda.gov/fiadb-api/fullreport?snum=2&wc=372024&rselected=Unit%20code&cselected=None&outputFormat=NJSON
- **Applies:** regional. It is an average over all Piedmont forest land, including young stands. **Confidence:** high.

The value depends heavily on the minimum trunk size (*our calculation*, trees ÷ forest acres):

| Minimum DBH | ≥1 in. | ≥5 in. | ≥9 in. | ≥11 in. | ≥13 in. |
|---|---|---|---|---|---|
| Trees per acre | 835 | 177 | 75 | 48.6 | 30.5 |

The current 33 matches only large trees (about ≥13 in.). If the renderer's 11 m spacing must stay, keep 33 but label it "large trees ≥13 in. DBH (FIA Piedmont: 30.5/ac)".

Statewide cross-check: *North Carolina's Forests, 2018*, USDA FS Resource Bulletin SRS-239 (2024), Tables A4.1 and A4.11, gives 775 trees/ac at ≥1 in. and 166 at ≥5 in. on timberland (*our calculation*). https://research.fs.usda.gov/treesearch/67891

### commuteDistancePenalty: 0.6 min (PLACEHOLDER)

`sim.js` adds the penalty to each new map-edge home's commute relative to the **town mean**.

- **Proposed:** 0.6 min.
- **Source:** ACS 2020–2024 5-year estimates, mean travel time = B08013 (aggregate minutes) ÷ B08303 (workers who did not work from home), by census tract.
  - Town: 407,355 ÷ 20,865 = 19.5 min. This matches the existing baseline of 19.6.
  - Map-edge tracts: 20.0–24.7 min.
  - Downtown and campus core tracts: 116.01 15.6, 116.02 14.1, 117 17.9 min.
- **URLs:**
  - https://data.census.gov/table/ACSDT5Y2024.B08013?g=160XX00US3711800
  - https://data.census.gov/table/ACSDT5Y2024.B08303?g=160XX00US3711800
  - Tract boundaries: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0
- **Method (our calculation):** each `map_edge` zone is assigned to a tract by its centroid, then tracts are weighted by zone acres. The map-edge mean is 20.1 min, **+0.6 vs the town mean**.
- **Applies:** direct, but weak. **Confidence:** low.
  - The difference is well inside the tract margins of error (±2–5 min), so it is statistically indistinguishable from 0.
  - Tract means describe current residents (many of them students). They do not forecast a new home's commute.
- The current 3 min is closer to the **edge vs downtown core** gap (about +4 min) than to the edge vs town-mean gap that `sim.js` uses.
- No regional travel model or Town plan with a better figure was found.

---

## Agent model coefficients

### 15-501 road capacity: 2,000 veh/h per direction

The 15-501 segment on the map is Fordham Blvd, from the S Columbia St (NC 86) interchange to the Manning Dr signal. It has 2 through lanes per direction, is divided, has no access control, and has a 45 mph limit. It runs as a signalized boulevard, not a freeway.

- **Proposed:** 2,000 veh/h per direction.
- **Source:** NCDOT "Volume Over Capacity" layer (capacity lookup table from Three Oaks Engineering).
  - For this segment, US-15 route `20000015068`, Urban / Piedmont / 2 lanes per direction / median, the lookup gives LOS E 37,000 vehicles per day, two-way.
  - Converted with NCDOT's standard K = 0.09 and D = 0.6: 37,000 × 0.054 ≈ 2,000 veh/h per direction.
  - https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_Volume_Over_Capacity/FeatureServer/2
- **Applies:** direct. **Confidence:** medium. The lookup does not document its own K and D factors; with this segment's K and D it is about 1,750.
- **Cross-check:** NCDOT "Capacity calculation assumptions and results" (Hummer, 2021), boulevard, 2 lanes each direction, LOS E, high share of green: 36,200 vehicles/day, about 1,955 veh/h per direction.
  - https://connect.ncdot.gov/resources/safety/Congestion%20Mngmt%20and%20Signing/Capacity%20Analysis%20Assumptions%20and%20Results%20by%20CTP%20Facility%20Type%20(2021).pdf
- **If the model counts through traffic only:** about 1,650 veh/h (2 lanes × 1,900 pc/h/ln × g/C 0.45, less 2.9% trucks).
  - Source: FHWA HPMS Field Manual, Appendix N: https://www.fhwa.dot.gov/ohim/hpmsmanl/appn5.cfm
  - Applies: proxy.
- **Demand for comparison:**
  - NCDOT 2025 AADT, station 0680000193 "US 15 WEST OF Morgan Creek Rd": **41,500** (49,000 in 2023). Segment K = 0.08, D = 0.591.
  - That gives peak-hour, peak-direction demand of about **1,960 veh/h**, or V/C ≈ 0.98.
  - North of Manning Dr, station 0680000152: 47,000 in 2025.
  - https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_2025_AADTandTrafficSegments_gdb/FeatureServer/1
  - This fits the UNC Development Plan traffic study (Table 2.3), which rated Manning Dr / Fordham Blvd PM LOS E (2017) and F (2024 no-build): https://move.unc.edu/about/publications/development-plan-report/transportation-changes

### Chapel Hill household growth rate: 0.73% per year

- **Proposed:** 0.0073 per year (compound, 2010–2020).
- **Source:** Decennial Census occupied housing units (households):

  | Year | Households |
  |---|---|
  | 2000 | 17,808 |
  | 2010 | 20,564 |
  | 2020 | 22,118 |

  - 2000 SF1 H003: https://data.census.gov/table/DECENNIALSF12000.H003?g=160XX00US3711800
  - 2010 SF1 H3: https://data.census.gov/table/DECENNIALSF12010.H3?g=160XX00US3711800
  - 2020 PL H1: https://data.census.gov/table/DECENNIALPL2020.H1?g=160XX00US3711800
- *Our calculation:* (22,118 / 20,564)^(1/10) − 1 = 0.73%.
  - 2000–2010 was 1.45% per year.
  - Housing units grew 0.64% per year from 2010 to 2020 (22,254 → 23,713).
- **Applies:** direct. **Confidence:** high for the historical rate.
  - Counts are within each year's town boundary and are not adjusted for annexation.
  - A historical rate is not a forecast.
  - The ACS 2020–2024 household estimate (21,189 ± 641) uses a different method and should not be compared with the 2020 count as a trend.

### Remote-work share: 0.28

- **Proposed:** 0.28 of workers aged 16 and over worked from home: 8,174 of 29,039, about ±2.3 points.
- **Source:** ACS 2020–2024 5-year, B08301 "Means of Transportation to Work", Chapel Hill town.
  - https://data.census.gov/table/ACSDT5Y2024.B08301?g=160XX00US3711800
  - 2019–2023: 0.271.
- **Applies:** direct. **Confidence:** high as a 2020–24 average; medium as a current value.
- **Alternate: 0.235** (*our calculation*). The 5-year window includes the 2021 peak, and Chapel Hill is too small for 1-year ACS. Orange County's 1-year 2024 share (22.4%) is 0.834 of its 5-year 2020–24 share (26.8%). Applying that ratio to Chapel Hill gives about 0.235.
  - https://data.census.gov/table/ACSDT1Y2024.B08301?g=050XX00US37135
  - https://data.census.gov/table/ACSDT5Y2024.B08301?g=050XX00US37135
  - Applies: regional adjustment.

### Durham commute share: 0.20

- **Proposed:** 0.20 of Chapel Hill residents' primary jobs are in Durham city (4,225 of 20,644). Durham County is **0.25** (5,073).
- **Source:** U.S. Census Bureau LEHD Origin-Destination Employment Statistics (LODES 8), NC 2023, primary jobs (JT01), joined to the block crosswalk (*our calculation*).
  - https://lehd.ces.census.gov/data/lodes/LODES8/nc/od/nc_od_main_JT01_2023.csv.gz
  - https://lehd.ces.census.gov/data/lodes/LODES8/nc/nc_xwalk.csv.gz
- **Applies:** direct. **Confidence:** medium.
  - LODES puts a job at the employer's site, so remote workers for Durham employers count as Durham.
  - It excludes self-employment and jobs outside NC.
  - Residence addresses for students are imprecise.
- **Other workplaces in the same data:** Chapel Hill 28.0%, Raleigh 10.1%, outside any place 10.3%.
- **Cross-check (regional):** ACS 2016–2020 county-to-county flows put 15,539 of 70,696 Orange County resident workers (22.0%) in Durham County.
  - https://www.census.gov/data/tables/2020/demo/metro-micro/commuting-flows-2020.html (Table 1)
- **Context:** ACS 2020–24 B08008 says 67.4% of Chapel Hill resident workers work inside the town, counting home workers as in-town.

### Car mode share: 0.74 of workers who travel

- **Proposed:** 0.74. Car, truck or van is 15,393 of the 20,865 workers who did not work from home: drove alone 0.656, carpool 0.082.
- **Use 0.53** (15,393 of all 29,039 workers) if the model does not take out remote workers first.
- **Source:** ACS 2020–2024 5-year, B08301, Chapel Hill town. https://data.census.gov/table/ACSDT5Y2024.B08301?g=160XX00US3711800
  - 2019–2023: 0.753 of workers who travel, 0.549 of all workers.
- **Applies:** direct. **Confidence:** high.
- **The rest of the non-remote split:**

  | Mode | Share |
  |---|---|
  | Bus/transit | 0.098 |
  | Walk | 0.112 |
  | Bike | 0.037 |
  | Other | 0.016 |

### Low-density units per acre in Chapel Hill zoning: 4

Same as `unitsPerAcre.low_res` above.

- **Basis:**
  - FLUM "Low Residential, generally 1 to 4 units/acre".
  - Last codified caps: R-1 3.0 and R-2 4.0 du/ac.
  - A 2022 staff report confirms "Under the R-2 zoning, the zone's density of 4 dwelling units per acre…": https://chapelhill.legistar1.com/chapelhill/attachments/7583a8b3-2980-42b4-966e-bdab5987822c.docx
- **Applies:** direct. **Confidence:** high.
- **Today's ceiling is higher.** R-1, "the most heavily used residential district", now allows 2 units on a 10,000 sf lot. That is about 8.7 du/ac before streets (*our calculation*).
  - Source: Draft LUMO Reference Guide, 2026-10-06: https://engage.chapelhillnc.gov/26095/widgets/88364/documents/86608
  - Typical built density is still in the FLUM range.

### Trees per acre in Piedmont NC forest: 177

Same as `treesPerAcre` above: 177 live trees per acre at ≥5 in. DBH, or 835 at ≥1 in. Source: FIA EVALIDator, NC Piedmont unit, 2024 evaluation. Applies: regional. Confidence: high.

### Chapel Hill tree canopy %: 57%

- **Proposed:** 57% town-wide (56.8% in 2021; 55.5% in 2011).
- **Source:** NLCD Tree Canopy Cover v2021-4 (30 m), averaged over the Census TIGERweb boundary for place 3711800 (13,946 ac) (*our calculation*).
  - https://www.mrlc.gov/geoserver/mrlc_download/wcs
  - https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4
- **Applies:** direct. **Confidence:** medium.
- **Cross-check:** EPA EnviroAtlas 1 m (2010) gives 64.1% town-wide (*our calculation*, same URLs as treeCoverPct). The gap is consistent with 30 m data reading low.
- **Neighborhood values:** Kolosna (2017), UNC master's paper, 2014 canopy: Northside 66%, Gimghoul 82%, Coker Hills 91%.
  - https://cdr.lib.unc.edu/concern/masters_papers/ws859h17t
  - No town-wide figure there.
- No Town-published canopy percentage exists (see treeCoverPct).

---

## Gaps

- **commuteDistancePenalty:** no credible source supports a non-zero penalty for this map. The 0.6 min figure is within noise.
- **Canopy %:** neither the Town nor UNC has published one. Both canopy values are our zonal averages of federal datasets.
- **Mixed-use density:** current zoning has no density cap for Town Center or Blue Hill. The value rests on a few approved projects. Carolina Square's acreage could not be confirmed from a Town source.
- **Fordham Blvd capacity:** NCDOT project U-5304B ("capacity improvements", NC 86 to NC 54) could not be confirmed; its pages and the DCHC MPO corridor study were offline. No project-level V/C was found.
- **Reproducing the Census figures:** api.census.gov now requires a key. The Census figures here came from the data.census.gov table API, which mirrors the linked tables.
