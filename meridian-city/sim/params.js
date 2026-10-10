// Behavioural constants of the CH-LUTI model. Each uncertain one is a range { lo, mid, hi }: the Monte Carlo draws it from a
// triangular distribution, and the "mid" run is the one the city renders. Sources are the evidence for the range; where the
// evidence is thin we say so, and the range is wide on purpose.

export const PARAMS = {
  // ---------- regional drivers (calibrated to observed trends) ----------
  regionalGrowth: { lo: 0.008, mid: 0.015, hi: 0.022, unit: '/yr', group: 'Drivers',
    label: 'Growth of households looking to live in the area',
    source: 'Chapel Hill grew 0.8%/yr 2010–2020 (Decennial Census); the Durham–Chapel Hill metro grows faster' },
  rentDrift: { lo: 0.015, mid: 0.03, hi: 0.045, unit: '/yr', group: 'Drivers',
    label: 'Regional rent inflation (what rents do elsewhere)',
    source: 'Zillow ZORI Chapel Hill: +5.1%/yr 2015–2025, +2.2%/yr 2023–2026' },
  valueDrift: { lo: 0.01, mid: 0.03, hi: 0.05, unit: '/yr', group: 'Drivers',
    label: 'Regional home-value inflation',
    source: 'Zillow ZHVI Chapel Hill: +6.3%/yr 2015–2025, flat 2025–2026' },
  tradableGrowth: { lo: 0.003, mid: 0.008, hi: 0.013, unit: '/yr', group: 'Drivers',
    label: 'Growth of UNC, health and professional jobs',
    source: 'LEHD LODES: +1.3%/yr 2002–2023 for education + health jobs in Town, +0.7%/yr 2014–2023' },

  // ---------- where households choose to live (multinomial logit) ----------
  rentElasticity: { lo: -8, mid: -4, hi: -2, unit: '', group: 'Location choice',
    label: 'How strongly households avoid a zone when its rent rises',
    source: 'Implies a rent elasticity to housing supply of −0.125 to −0.5; Mense (2025, JPE Macro) finds −0.19; Asquith, Mast & Reed (2023, REStat) find new buildings cut nearby rents ~6%' },
  accessElasticity: { lo: 0.3, mid: 0.6, hi: 1.0, unit: '', group: 'Location choice',
    label: 'Pull of better access to jobs',
    source: 'Hedonic studies put housing-price elasticities to job access around 0.1–0.3; scaled by the rent elasticity above' },
  vibrancyElasticity: { lo: 0.1, mid: 0.3, hi: 0.6, unit: '', group: 'Location choice',
    label: 'Pull of busy storefronts nearby',
    source: 'Assumption; amenity evidence (e.g. Glaeser, Kolko & Saiz 2001, “Consumer City”) is qualitative' },
  jobsHousingElasticity: { lo: 0.2, mid: 0.35, hi: 0.5, unit: '', group: 'Location choice',
    label: 'Housing demand per extra job in Town',
    source: 'Over half of Town jobs are held by in-commuters (LODES 54k jobs vs 30k resident workers), so demand responds well below 1:1' },
  rentVacancyResponse: { lo: 0.004, mid: 0.008, hi: 0.015, unit: '/pp/yr', group: 'Housing market',
    label: 'Rent growth lost per point of vacancy above normal',
    source: 'Natural-vacancy rent adjustment (Rosen & Smith 1983, AER; Hendershott 1996)' },

  // ---------- development (residual-land-value pro forma) ----------
  hardCostPerSf: { lo: 190, mid: 225, hi: 260, unit: '$/sf', group: 'Development',
    label: 'Construction hard cost, mid-rise apartments',
    source: 'Triangle 2024–25 industry cost guides (RLB, Cumming): roughly $190–260/sf; not Chapel Hill-specific' },
  capRate: { lo: 0.0475, mid: 0.0525, hi: 0.06, unit: '', group: 'Development',
    label: 'Apartment cap rate (investor yield)',
    source: 'CBRE cap-rate surveys, Raleigh–Durham multifamily ~5–5.5% (2024–25)' },
  structuredParkingCost: { lo: 25000, mid: 30000, hi: 40000, unit: '$/space', group: 'Development',
    label: 'Cost of a structured parking space',
    source: 'WGI Parking Structure Cost Outlook: national median $29,900 per space (2024), $33,300 (2026)' },
  siteDispersion: { lo: 0.08, mid: 0.12, hi: 0.2, unit: '', group: 'Development',
    label: 'Spread of profitability across sites',
    source: 'Calibrated so long-run housing supply elasticity lands near 0.5–1 (Saiz 2010 range for Southern metros)' },
  upzoneCapacity: { lo: 0.3, mid: 0.6, hi: 1.0, unit: '', group: 'Development',
    label: 'Share of extra allowed floor area that becomes buildable capacity',
    source: 'Auckland’s 2016 upzoning significantly raised construction on upzoned land (Greenaway-McGrevy & Phillips 2023, JUE); size of response uncertain' },
  landCapture: { lo: 0.3, mid: 0.5, hi: 0.8, unit: '', group: 'Development',
    label: 'Share of an upzoning’s value landowners capture in land prices',
    source: 'Land-value capitalisation of zoning (Freemark 2020, UAR); evidence varies widely' },
  marketParkingRatio: { lo: 0.6, mid: 0.85, hi: 1.0, unit: 'spaces/unit', group: 'Development',
    label: 'Parking developers would build without a minimum',
    source: 'After Buffalo dropped minimums, 47% of major projects built less than required; large projects about half (Hess & Rehler 2021, JAPA)' },

  // ---------- storefront businesses ----------
  closureRate: { lo: 0.08, mid: 0.10, hi: 0.13, unit: '/yr', group: 'Businesses',
    label: 'Share of storefront businesses closing each year',
    source: 'BLS Business Employment Dynamics: establishment exits ≈ 8–10%/yr; retail and food run higher' },
  bizDemandResponse: { lo: 0.5, mid: 1.0, hi: 1.5, unit: '', group: 'Businesses',
    label: 'How fast openings and closures react to local spending',
    source: 'Assumption (stock-and-flow adjustment speed)' },
  jobsPerStorefront: { lo: 8, mid: 11, hi: 14, unit: 'jobs', group: 'Businesses',
    label: 'Jobs per storefront business',
    source: 'Census SUSB: retail ~15, food service ~18, personal services ~6 employees per establishment' },
  grantButFor: { lo: 0.05, mid: 0.15, hi: 0.30, unit: '', group: 'Businesses',
    label: 'Share of at-risk grant recipients a grant actually saves',
    source: 'No causal study of small-business grants found; borrowed from Bartik (2018) “but for” review of incentives: 2–25%, median ~12%' },
  startupButFor: { lo: 0.10, mid: 0.2, hi: 0.4, unit: '', group: 'Businesses',
    label: 'Share of funded start-ups that would not have opened otherwise',
    source: 'Bartik (2018) “but for” range, widened for very small firms; weak evidence' },
  costPerHiringJob: { lo: 75000, mid: 35000, hi: 12000, unit: '$/job', group: 'Businesses',
    label: 'Cost per job a hiring subsidy actually creates',
    source: 'Neumark (2013, JPAM) via PPIC: $9.1k–$75k per job for hiring credits' },
  bizTaxElasticity: { lo: -0.2, mid: -0.08, hi: -0.02, unit: '', group: 'Businesses',
    label: 'Business openings response to the property-tax rate',
    source: 'Bartik (1991): elasticity of business activity to state-local taxes −0.1 to −0.6; property tax is one slice' },
  vacancyTaxLeaseUp: { lo: 0.02, mid: 0.06, hi: 0.12, unit: '/yr per 1%', group: 'Businesses',
    label: 'Extra share of vacant storefronts leased per year, per 1% vacancy tax',
    source: 'Assumption; San Francisco (2022) and Washington DC vacancy taxes have no causal evaluation yet' },

  // ---------- travel (multinomial logit mode choice) ----------
  timeCoef: { lo: 0.02, mid: 0.03, hi: 0.045, unit: '/min', group: 'Travel',
    label: 'Sensitivity of mode choice to travel time',
    source: 'Typical commute mode-choice models: −0.02 to −0.045 per in-vehicle minute (FHWA/TRB model guides)' },
  serviceElasticity: { lo: 0.3, mid: 0.5, hi: 0.8, unit: '', group: 'Travel',
    label: 'Bus ridership response to more service',
    source: 'TCRP Report 95, ch. 9: service elasticities average ~0.5 (range 0.3–1.0)' },
  bikeInfraEffect: { lo: 0.15, mid: 0.3, hi: 0.5, unit: '', group: 'Travel',
    label: 'Share of cycling “stress” removed by a 12 km protected network',
    source: 'Buehler & Dill (2016, Transport Reviews): protected lanes consistently raise cycling; magnitudes vary' },

  // ---------- town budget ----------
  marginalServiceCost: { lo: 0.4, mid: 0.6, hi: 0.9, unit: '× avg', group: 'Town budget',
    label: 'Cost of serving a new resident, relative to the average',
    source: 'FY26 general fund ÷ population ≈ $1,540 per resident; marginal cost assumed below average' },
};

// Fixed assumptions: visible in the assumptions table, not sampled.
export const FIXED = {
  naturalVacancy: 0.0416,       // ACS B25004: market-vacant 919 / (21,189 + 919)
  householdAdjust: 0.25,        // share of the gap between desired and actual households closed per quarter (leases turn over yearly)
  minVacancy: 0.015,
  incomeGrowth: 0.03,           // nominal median household income growth
  cpi: 0.025,
  regionShare: 0.05,            // Chapel Hill's share of the regional pool of movers (sets substitution in the logit)
  unitSizeSf: 950,
  softCost: 0.25,
  opex: 0.35,
  stabilizedVacancy: 0.05,
  hurdle: 0.15,                 // developer profit on cost needed to build
  calibrationGap: 0.03,         // the marginal site starts 3 points short of the hurdle (a market near equilibrium)
  buildQuarters: 8,
  costDrift: 0.03,
  surfaceParkingCost: 6000,
  landPerUnit: { downtown: 55000, campus: 50000, north: 40000, east: 45000, south: 35000 }, // derived: Orange County land values ÷ typical density
  structuredParking: { downtown: true, campus: true, north: false, east: true, south: false },
  parkingMinimum: { downtown: 1.0, campus: 1.25, north: 1.5, east: 1.25, south: 1.5 }, // approximate LUMO requirements, spaces per unit
  startShare: { downtown: 0.25, campus: 0.05, north: 0.25, east: 0.35, south: 0.10 }, // where the ~334 units/yr of 2015–25 permits land
  projectSize: { downtown: 120, campus: 80, north: 150, east: 180, south: 40 },
  baseStorefrontVacancy: { downtown: 0.24, campus: 0.10, north: 0.10, east: 0.10, south: 0.10 },
  retailSpacesPerUnit: 1 / 40,  // ground-floor storefronts that come with new mixed-use apartments (downtown & east)
  spendingFromJobs: 0.45,       // share of storefront spending that comes from people who work in Town
  grantSize: 10000,
  startupGrantSize: 25000,
  startupFirstYearSurvival: 0.8, // ~20% of new businesses close within a year (BLS Business Employment Dynamics)
  hiringJobAttrition: 0.2,      // per year, for jobs a hiring subsidy created
  atRiskMultiple: 2,            // grant recipients are businesses closing at twice the usual rate
  inCommuterTransitShare: 0.15,
  peakVC: 0.9,                  // peak volume/capacity on main corridors (assumption)
  carSpeedKmh: 30, busSpeedKmh: 18, bikeSpeedKmh: 14, walkSpeedKmh: 4.8, regionCarKmh: 55, regionBusKmh: 35,
  bikeStressMin: 10,
  ovtWeight: 2,                 // waiting and walking to the bus feel twice as long
  gravityDecay: 0.3,            // per km, for choosing a work zone
  accessDecay: 0.12,            // per minute, for the accessibility index
  transitTownShare: 0.45,       // Town's share of Chapel Hill Transit's partner funding (with Carrboro and UNC); assumption
  revaluationYears: [2029, 2033],
  residentialShareOfBase: 0.8,  // assumption: Chapel Hill's tax base is ~80% residential
  collectionRate: 0.99,
  rentBurdenSigma: 0.665,       // derived: lognormal rent-to-income spread that reproduces ACS 36% median & 60.8% burdened
};
