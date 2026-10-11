// Chapel Hill, NC base year for the CH-LUTI model (from Kevin's policy_mechanism branch). Every number here is observed data
// (or derived from it, marked "derived"). Town totals that data/baselines.json also has (homes, population, median gross rent,
// median home value, mean commute) and the tax rate (data/assumptions.json propertyTaxRate) are taken from those files instead,
// and the zones below are scaled to them. Unsourced constants are luti* entries in data/assumptions.json.
// Durham is out of scope; the slivers of the Town that sit in Durham County are folded into the East zone.
//
// Zones are a Voronoi split of the Town's 613 census blocks around five representative points. Tract-level ACS values were
// spread to blocks by LEHD resident-worker counts, summed per zone, then scaled to the Town totals. Jobs are LEHD workplace
// counts summed per zone. x/z are metres in the renderer's frame (shared/geo.js: x = east, z = south of 35.9085°N, 79.0520°W).

export const SOURCES = {
  acs: { label: 'U.S. Census Bureau, ACS 2020–2024 5-year (via Census Reporter API)', url: 'https://censusreporter.org/profiles/16000US3711800-chapel-hill-nc/' },
  lodes: { label: 'U.S. Census Bureau, LEHD LODES 8 (2002–2023), workplace & residence area characteristics', url: 'https://lehd.ces.census.gov/data/' },
  bps: { label: 'U.S. Census Bureau, Building Permits Survey, annual place files 2015–2025', url: 'https://www2.census.gov/econ/bps/Place/South%20Region/' },
  zillow: { label: 'Zillow Research, ZORI (rent) and ZHVI (home value), Chapel Hill city series: growth rates only (rentDrift, valueDrift)', url: 'https://www.zillow.com/research/data/' },
  budget26: { label: 'Town of Chapel Hill FY2025–26 adopted budget (The Local Reporter / Daily Tar Heel coverage)', url: 'https://thelocalreporter.press/chapel-hill-town-council-votes-on-2025-26-budget/' },
  budget25: { label: 'Town of Chapel Hill FY2024–25 budget ordinance (general fund revenue estimates)', url: 'https://townofchapelhill.org/home/showpublisheddocument/56362/638617386443170000' },
  transit: { label: 'Chapel Hill Transit, 2025 annual ridership (Wikipedia, citing NTD)', url: 'https://en.wikipedia.org/wiki/Chapel_Hill_Transit' },
  downtown: { label: 'Chapel Hill Downtown Partnership informal survey of 321 downtown commercial spaces (~24% vacant)', url: 'https://downtownchapelhill.com/news' },
};

export const BASE_YEAR = 2027; // the simulation's first quarter is 2027 Q1; data vintages run 2023–2026

// ACS B08301, commuters who travel (work-from-home excluded), by the model's four modes. Taxi, motorcycle and other (331
// workers) are left out, so the shares sum to 1.
const COMMUTERS = { car: 15393, bus: 2042, bike: 769, walk: 2330 };
const commuters = Object.values(COMMUTERS).reduce((s, n) => s + n, 0);

export const TOWN = {
  householdPopulation: 50403,     // ACS B25008
  groupQuarters: 11204,           // ACS B26001 (mostly UNC residence halls)
  households: 21189,              // ACS B25002 occupied units
  renterHouseholds: 11141,        // ACS B25003
  marketVacant: 919,              // ACS B25004: for rent (840) + for sale (79); seasonal/other vacant units are outside the market
  medianHouseholdIncome: 85989,   // ACS B19013
  rentToIncomeMedian: 0.36,       // ACS B25071
  rentBurdened: 0.608,            // ACS B25070: renters paying ≥30% of income (6,393 of 10,508 computed)
  residentWorkers: 29978,         // ACS B23025 employed
  modeShare: Object.fromEntries(Object.entries(COMMUTERS).map(([m, n]) => [m, n / commuters])), // car 0.75
  wfhShare: 0.281,                // ACS B08301: 8,174 of 29,039
  jobs: 54322,                    // LODES 2023 WAC, jobs located in the Town
  tradableJobs: 41832,            // LODES: education, health, professional, information, finance, manufacturing…
  jobsHistory: { 2002: 41744, 2008: 47903, 2014: 48817, 2019: 53412, 2021: 48991, 2023: 54322 }, // LODES
  storefrontJobs: 9229,           // LODES: retail 3,196 + food & lodging 3,978 + other services 1,258 + arts 797
  permitsPerYear: { 2015: 361, 2016: 126, 2017: 548, 2018: 718, 2019: 65, 2020: 151, 2021: 450, 2022: 200, 2023: 739, 2024: 159, 2025: 155 }, // BPS units
  transitRidership: 4.3053e6,     // Chapel Hill Transit, 2025
  // Budget, FY2025–26 adopted: $164M all funds, general fund $94.88M, transit fund $36.48M, 50.0¢ per $100 (revenue-neutral was 44.2¢).
  generalFund: 94.883e6,
  transitFund: 36.482e6,
  // derived: the budget priced 1.2¢ at $1,485,658 and 2.2¢ at $2,946,237, so one cent ≈ $1.29M and the taxable base ≈ $12.9B.
  taxBase: 12.9e9,
  salesTax: 24.1e6,               // derived: FY2024–25 ordinance estimate $22.99M, FY26 collections ran ~5% above projections
  downtownStorefronts: 321,
  downtownStorefrontVacancy: 0.24,
};

// Five zones. pop/units/households/renters are shares of the Town totals (pop and units are rescaled to data/baselines.json);
// rent and income are renter-/household-weighted tract medians. Bus headways are lutiHeadwayMin in data/assumptions.json.
export const ZONES = [
  { id: 'downtown', label: 'Downtown & North Campus', short: 'Downtown', rep: [-451, -719], resident: [-582, -844], work: [-155, -515],
    population: 13055, units: 4967, households: 4167, renters: 2863, rent: 1565, income: 53263, groupQuarters: 3100,
    jobs: 23678, tradableJobs: 19335, storefrontShare: 0.36, modeShare: { car: 0.611, bus: 0.122, bike: 0.069, walk: 0.180 }, wfh: 0.275 },
  { id: 'campus', label: 'South Campus & Hospitals', short: 'Campus', rep: [361, 276], resident: [1381, 541], work: [2858, 965],
    population: 11610, units: 1579, households: 1406, renters: 568, rent: 1461, income: 108619, groupQuarters: 8104,
    jobs: 15271, tradableJobs: 13296, storefrontShare: 0.15, modeShare: { car: 0.466, bus: 0.095, bike: 0.081, walk: 0.341 }, wfh: 0.219 },
  { id: 'north', label: 'MLK Corridor & North', short: 'North', rep: [-361, -3483], resident: [-188, -4728], work: [-280, -5257],
    population: 13366, units: 6363, households: 5674, renters: 2967, rent: 1856, income: 101732, groupQuarters: 0,
    jobs: 4230, tradableJobs: 3178, storefrontShare: 0.07, modeShare: { car: 0.846, bus: 0.098, bike: 0.015, walk: 0.031 }, wfh: 0.281 },
  { id: 'east', label: 'Blue Hill, Eastgate & Meadowmont', short: 'East', rep: [3066, -2377], resident: [3154, -2757], work: [2960, -2497],
    population: 18517, units: 8689, households: 8003, renters: 3958, rent: 1522, income: 97653, groupQuarters: 0,
    jobs: 9619, tradableJobs: 4911, storefrontShare: 0.39, modeShare: { car: 0.871, bus: 0.065, bike: 0.012, walk: 0.033 }, wfh: 0.322 },
  { id: 'south', label: 'Southern Village & South', short: 'South', rep: [-1470, 2300], resident: [-1347, 2211], work: [-1323, 2697],
    population: 5058, units: 1983, households: 1939, renters: 784, rent: 1482, income: 117969, groupQuarters: 0,
    jobs: 1524, tradableJobs: 1112, storefrontShare: 0.03, modeShare: { car: 0.778, bus: 0.120, bike: 0.039, walk: 0.058 }, wfh: 0.295 },
];
// storefrontShare: each zone's share of storefront jobs (LODES retail + food: 2,584 · 1,082 · 476 · 2,793 · 239), used to place local businesses.
export const ZONE_IDS = ZONES.map(z => z.id);
