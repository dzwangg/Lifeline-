# CH-LUTI — the Chapel Hill policy model

**CH-LUTI** is a *Land-Use/Transport Interaction* model built as a quarterly *system-dynamics* simulation, in the tradition of
MARS (Pfaffenbichler & Emberger). Discrete choices use **multinomial logit**, new construction uses a **residual-land-value
pro forma**, and uncertainty comes from **paired Monte Carlo** over every behavioural constant.

```
policy card ──▶ levers ──▶ schedule (delay, phase-in) ──▶ quarterly loop ──▶ city state ──▶ events ──▶ 3D city
                                                             │  1 travel                       │
                                                             │  2 location choice              └──▶ metrics ──▶ dashboard
                                                             │  3 development                       (vs. baseline, P10–P90)
                                                             │  4 storefront businesses
                                                             │  5 jobs
                                                             └  6 Town budget  ── feeds next quarter
```

A card never touches the 3D scene or an outcome. It sets **levers** (`levers.js`). The model reads lever values each quarter
and the ripple effects come from the submodels feeding each other.

## Files

| File | What it is |
|---|---|
| `data.js` | Real Chapel Hill base year: ACS 2020–24, LEHD LODES 2002–23, Census building permits 2015–25, Zillow rents/values, FY26 budget. Five zones built from 613 census blocks. |
| `params.js` | Every uncertain constant as `{ lo, mid, hi }` with its source, plus the fixed assumptions. |
| `levers.js` | The lever registry and the scheduler (`delayQuarters`, `phaseInQuarters`). |
| `model.js` | `simulate(params, policies)`: the six submodels, calibration, and `CAUSES` (what drives what). Pure: no DOM, no randomness. |
| `run.js` | `runScenario(policies)`: 200 paired Monte Carlo runs, P10/P50/P90 bands, per-card contributions; `explain()` builds the "why" tree. |
| `worker.js` | Runs scenarios off the main thread. |
| `results-panel.js/.css` | The results dock: timeline, metric tiles, charts, why-tree, by policy, by zone, assumptions, JSON export. |
| `city-effects.js` | Turns model events into the city: buildings rising on real OSM parking lots, buses, bike lanes, traffic density. |
| `test.mjs` | Calibration, determinism, policy-direction and literature checks. `node meridian-city/sim/test.mjs` |

## The six submodels (one quarter)

1. **Travel**: a logit mode choice (car / bus / bike / walk) for every zone pair plus out-of-town commutes.
   - Utility = mode constant − β × generalised minutes. Bus waits are headway ÷ 2 and count double.
   - Car speeds come from a BPR curve on last quarter's traffic.
   - Constants are fitted so each zone reproduces its ACS commute split.
   - The logsum gives each zone's **access to jobs**.
2. **Location choice**: households choose a zone, or the rest of the region, by logit.
   - V = ASC + β_rent·ln(rent / regional rent) + β_access·ln(access) + β_vibrancy·ln(storefront occupancy) + property-tax cost.
   - Households move a quarter of the way toward demand each quarter.
   - Vacancy above or below the natural 4.2% slows or speeds rent growth (Rosen–Smith).
3. **Development**: a pro forma on a typical mid-rise home in each zone.
   - Value = NOI ÷ (cap rate + tax rate). Cost = hard + soft + parking + land ÷ FAR − subsidy.
   - The share of sites that start is a logistic on (margin − 15% hurdle).
   - New-build rents and site capacity are calibrated so the base year reproduces 2015–25 permits (~334 homes/yr).
   - Homes complete 8 quarters later. Every 40–180 homes of starts becomes a building event for the renderer.
4. **Storefront businesses**: openings and closures (BLS rates) move the stock toward what local spending supports. Grants avert closures, start-up grants add openings and a vacancy tax leases empty spaces, each scaled by its "but-for" share (Bartik).
5. **Jobs**: UNC/health/professional jobs grow on trend; storefront jobs follow businesses; hiring-subsidy jobs = budget ÷ cost-per-job and decay 20%/yr.
6. **Town budget**:
   - Property tax = assessed value × rate. NC revaluations in 2029 and 2033 reset the base rate to revenue-neutral.
   - Sales tax follows local spending.
   - New residents cost a share of the average per-resident spending.
   - Programme costs come from the levers.

## Calibration and checks (`node meridian-city/sim/test.mjs`)

**The no-policy run reproduces the base year:**
- 61,607 people
- 21,189 households
- 54,322 jobs
- $1,690 market rent
- 61% of renters cost-burdened
- ~334 homes/yr
- $64M property tax
- 4.3M bus trips
- Each zone's ACS bus share

**Emergent behaviour:** nobody sets these numbers directly; they fall out of the submodels.

| Check | Model | Published |
|---|---|---|
| Rent change when homes +1% (5 yrs) | −0.18 | −0.19 (Mense 2025) |
| Resident bus share vs. +10% service | 0.24 | 0.3–1.0 ridership elasticity (TCRP 95) |
| 10-yr housing supply elasticity | 0.23 | ~0.8 long run (Saiz 2010) — Chapel Hill is tighter than its metro |

## Adding a policy

1. Add a card to `policy/policies.js`:

   ```js
   { id, title, category, icon, summary,
     levers: [{ lever: 'housing.farMultiplier', value: 1.6, zones: ['downtown'] }],
     timing: { delayQuarters: 4, phaseInQuarters: 4 },
     cost, jurisdiction, mechanism, evidence: [{ claim, source, url }] }
   ```

2. If no existing lever fits, add one to `levers.js`, read it in `model.js`, and add a direction check to `test.mjs`.
3. Never write an outcome into a card. If the model can't express it, it isn't modelled yet.

## Known limits

- Five zones, not parcels. One prototype building type per zone. There is no school, crime or health submodel yet.
- UNC enrolment and residence halls are held at trend. The baseline assumes no other new Town policy.
- The weakest evidence is for the small-business grants and the vacancy tax. Their ranges are wide on purpose, and the dashboard shows them.
- Results are a plausible range under stated assumptions, not a forecast.
