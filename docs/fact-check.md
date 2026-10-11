# Fact check of the game's starting values (October 2026)

Every observed number the game starts from was checked against the newest published source on October 11, 2026. The model
parameters that aren't facts about Chapel Hill (elasticities, the costs in the building pro forma and the like) are listed
at the end: they come from research or calibration, and those still marked PLACEHOLDER in `data/assumptions.json` have no
citation yet.

Chapel Hill (about 64,000 people) is too small for the Census Bureau's 1-year survey. The newest town-level survey is
therefore ACS 2020–2024, and the 2021–2025 release comes in December 2026.

## Changed

| Value | Was | Now | Source |
|---|---|---|---|
| Median gross rent | $1,483 (ACS 2019–23) | **$1,613** | ACS 2020–24, B25064 |
| Median home value | $576,500 (ACS 2019–23) | **$613,700** | ACS 2020–24, B25077 |
| Mean commute | 19.6 min (ACS 2019–23) | **19.5 min** | ACS 2020–24, B08013 ÷ B08303 |
| Population | 61,960 (2020 Census) | **63,565** (July 1, 2025) | Census Vintage 2025 town estimates, SUB-EST2025 |
| Homes | 23,713 (2020 Census) | **23,581** | ACS 2020–24, B25001, the same survey as the households and renters, so vacancy is measured consistently. The Bureau publishes no newer count for towns; 1,963 homes were permitted from 2020 to August 2026 |
| General fund | $94.9M (FY2025–26) | **$99.76M** | FY2026–27 adopted budget, adopted June 10, 2026 |
| Transit fund | $36.5M | **$35.9M** | FY2026–27 adopted budget |
| Tax base | $12.9B (derived) | **$14.17B** (one cent = $1.41M) | FY2026–27 adopted budget, projected tax base |
| Sales tax revenue | $24.1M (derived) | **$23.26M** | FY2026–27 adopted budget |
| Bus ridership | 4.31M (2025, Wikipedia) | **4.37M** (Sep 2025–Aug 2026) | FTA National Transit Database, monthly ridership |
| Parking required per new home | 1–1.5 spaces by zone (approximate) | **0** | Town Council eliminated parking minimums on January 21, 2026 (LUMO amendments). The "Lower parking minimums" card described a policy already in force, so it is now **"Bring back parking minimums"** |
| Peak minutes between buses | 10 / 10 / 15 / 15 / 20 | **15 / 10 / 18 / 23 / 13** (downtown / campus / north / east / south) | Our calculation from Chapel Hill Transit's GTFS, Fall 2026 (local routes, weekday 7–9 am) |
| Town's share of extra transit cost | 45% | **34%** | FY2026–27 transit fund: Town $7.94M of the partners' $23.24M (UNC $12.62M, Carrboro $2.67M) |
| Default inflation | 2.5% | **2.3%** | Philadelphia Fed Survey of Professional Forecasters, Q3 2026, 10-year CPI |
| Household-model scale | 79 homes per simulated household | **70.6 households** | 21,189 households ÷ 300. Households and priced out were counted in homes, about 12% too many |
| Owners' median income (household model) | $115,000 | **$180,900** | ACS 2020–24, B25119 |
| Renters' incomes (household model) | students $40,000, others $64,000 | **$43,200, $69,100** | Calibrated so 60.8% of renters pay 30%+ of income at today's rent (B25070) |

The Town's tax rate (50.0¢: general 38.1, debt 6.6, transit 5.3) did not change. Neither did the household-model renter
shares, which stay at the prototype's values (58.6% renters against 52.6% in the ACS) because the showcase residents are
seed-7 households picked by tenure. Scaling the shares to the ACS redraws who those residents are, so that waits for the
resident feature's owner.

## Confirmed (no change)

| Value | Number | Source |
|---|---|---|
| Households, renters, household and group-quarters population | 21,189; 11,141; 50,403; 11,204 | ACS 2020–24 (B25002, B25003, B25008, B26001) |
| Median household income | $85,989 | ACS 2020–24, B19013 |
| Renters paying 30%+ of income in rent | 60.8% (6,393 of 10,508) | ACS 2020–24, B25070 |
| Median rent as share of income | 36.0% | ACS 2020–24, B25071 |
| Workers, working from home | 29,978 employed; 8,174 of 29,039 | ACS 2020–24, B23025, B08301 |
| Commuters working outside town | 45% (9,453 of 20,865) | ACS 2020–24, B08008. LODES puts 72% outside, but it files many UNC System jobs at a Raleigh headquarters (19% in Wake County), so the ACS is used |
| Jobs in town | 54,322 (2023) | LEHD LODES 8; 2023 is still the newest year |
| Building permits | 155 homes in 2025; 109 in January–August 2026 | Census Building Permits Survey |
| Downtown storefront vacancy | about 24% of 321 spaces | Downtown Partnership survey (The News & Observer, August 2024); no newer count published |
| Tree cover | 46.9% of the map area | NLCD Tree Canopy Cover 2021, still the newest on MRLC |
| Property tax rate | 50.0¢ per $100 | FY2026–27 adopted budget |
| Next revaluations | 2029, then every four years to 2053 (assumed) | Orange County: four-year cycle, last January 1, 2025 |
| Fed inflation path | 3.7, 2.3, 2.1, 2.0, 2.0 | FOMC Summary of Economic Projections, September 16, 2026 |
| Recent inflation | CPI-U +3.4% (12 months to August 2026) | BLS, September 11, 2026 |

## Still placeholders

These are model parameters, not facts about Chapel Hill. Each needs a citation or a calibration, and none is presented to
the player as a fact:

- Behaviour: location, business and household elasticities (`lutiAccessElasticity`, `lutiVibrancyElasticity`, `lutiJobsHousingElasticity` and others).
- The building pro forma: costs, land, hurdle rate, project sizes and floors.
- The travel model: speeds, intra-zone distances, circuity, waiting weights, out-of-town distance and bus frequency.
- The storefront model: grant sizes, spending shares.
- The household model's zone layout, rent spread and leaving rate.
- The residential share of the tax base (0.8). The Town's 2019 figures, which we could not open to confirm, put homes and
  apartments near 76%.

## What changing these moved

- With rent up 8.8% and incomes calibrated, year-0 rent burden still matches the ACS.
- Year-0 households now read 21,189 (they read 23,700).
- New homes build parking at the market's ratio (0.85 a home) rather than a requirement.
- `tests/fixtures/sim-result.json` and `meridian-city/sources.html` were regenerated.
- Pre-generated demo narration (`npm run pregen:demo`) and the Nessie ledgers (`npm run seed:nessie`) are made at demo
  freeze, so they will pick these numbers up then.
