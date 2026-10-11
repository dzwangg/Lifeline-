// Behavioural constants of the CH-LUTI model. Each uncertain one is a range { lo, mid, hi }: the Monte Carlo draws it from a
// triangular distribution, and the "mid" run is the central one. This file keeps the constants that cite a published source.
// The unsourced ones are luti* entries in data/assumptions.json marked PLACEHOLDER (ranges there are { lo, mid, hi } values);
// paramRanges() and fixedValues() merge them in, so the model reads `lutiHurdle` as F.hurdle.

export const PARAMS = {
  // ---------- regional drivers (calibrated to observed trends) ----------
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
};

// Fixed constants with a source; the unsourced rest are in data/assumptions.json.
export const FIXED = {
  naturalVacancy: 0.0416,         // ACS B25004: market-vacant 919 / (21,189 + 919)
  startupFirstYearSurvival: 0.8,  // ~20% of new businesses close within a year (BLS Business Employment Dynamics)
  rentBurdenSigma: 0.665,         // derived: lognormal rent-to-income spread that reproduces ACS 36% median & 60.8% burdened
};

const isRange = v => typeof v === 'object' && v !== null && 'mid' in v;
const luti = assumptions => Object.entries(assumptions).filter(([k]) => k.startsWith('luti'))
  .map(([k, e]) => [k[4].toLowerCase() + k.slice(5), e]); // lutiHurdle -> hurdle

/** Every uncertain constant: PARAMS plus the luti* ranges in data/assumptions.json. @param {import('../types').Assumptions} assumptions */
export const paramRanges = assumptions => ({
  ...PARAMS,
  ...Object.fromEntries(luti(assumptions).filter(([, e]) => isRange(e.value)).map(([k, e]) => [k, { ...e.value, unit: e.unit ?? '', label: e.note, source: e.source }])),
});

/** Every fixed constant: FIXED plus the other luti* entries in data/assumptions.json. @param {import('../types').Assumptions} assumptions */
export const fixedValues = assumptions => ({ ...FIXED, ...Object.fromEntries(luti(assumptions).filter(([, e]) => !isRange(e.value)).map(([k, e]) => [k, e.value])) });
