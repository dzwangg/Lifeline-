// City-health indicators: every number the results panel shows, grouped into the questions a town asks of itself, so that
// each one says something about how Chapel Hill is doing economically and socially. A later health rating scores these;
// nothing here rates anything yet. See docs/indicators.md for why each is here.
//
// Each indicator is a SimResult metric (shared/combined.js) with:
//   pillar     the question it answers (PILLARS)
//   better     'higher', 'lower', or null for context (a number worth seeing that is neither good nor bad by itself)
//   today      the observed value now and its source (not the model's: the models are calibrated to reproduce these)
//   benchmarks published comparisons, where an accepted one exists
//   why        one sentence on what it tells you
// Pillars follow the Town Council's strategic focus areas (environmental stewardship; economic and financial stewardship;
// housing) and the AARP Livability Index's categories (housing, transportation, environment, opportunity).

const ACS = 'U.S. Census Bureau, ACS 2020–2024 5-year estimates';

export const PILLARS = [
  { id: 'housing', label: 'Housing affordability', question: 'Can people afford a home here?' },
  { id: 'stability', label: 'Staying put', question: 'Can the people who live here stay?' },
  { id: 'economy', label: 'Local economy', question: 'Are there jobs and a lively downtown?' },
  { id: 'mobility', label: 'Getting around', question: 'Can people reach work and services easily?' },
  { id: 'environment', label: 'Environment', question: 'Is the town getting greener or dirtier?' },
  { id: 'finances', label: 'Town finances', question: 'Can the Town pay for its services?' },
];

/** @type {{ key: string, pillar: string, label: string, short?: string, fmt: string, better: 'higher' | 'lower' | null,
 *  today?: { value: number, text: string, source: string }, benchmarks?: { label: string, text: string, source: string }[],
 *  why: string, model: string, diffOnly?: boolean }[]} */
export const INDICATORS = [
  // ---------- housing affordability ----------
  { key: 'rentBurden', pillar: 'housing', label: 'Renters paying 30%+ of income on rent', short: 'Rent-burdened renters', fmt: 'pct', better: 'lower',
    today: { value: 0.608, text: '60.8%', source: `${ACS}, B25070 (6,393 of 10,508 renter households)` },
    benchmarks: [{ label: 'North Carolina', text: '48.9%', source: `${ACS}, B25070` }, { label: 'United States', text: '51.1%', source: `${ACS}, B25070` }],
    why: 'HUD counts a household paying 30% or more of income on housing as cost-burdened: the standard US measure of affordability.',
    model: 'the household model: each renter\'s rent (after any rental assistance) against its income (with any cash or training gain)' },
  { key: 'priceToIncome', pillar: 'housing', label: 'Home price to income', short: 'Price to income', fmt: 'ratio', better: 'lower',
    today: { value: 7.14, text: '7.1 years of income', source: `${ACS}: median home value $613,700 (B25077) ÷ median household income $85,989 (B19013)` },
    benchmarks: [{ label: 'North Carolina', text: '4.0', source: `${ACS}, B25077 ÷ B19013` }, { label: 'United States', text: '4.1', source: `${ACS}, B25077 ÷ B19013` }],
    why: 'How many years of a typical income a typical home costs: whether buying a home is within reach.',
    model: 'CH-LUTI: median home value ÷ median household income, both growing with the model' },
  { key: 'medianRent', pillar: 'housing', label: 'Median rent', fmt: 'usd', better: 'lower',
    today: { value: 1613, text: '$1,613 a month', source: `${ACS}, B25064 (median gross rent)` },
    why: 'What a typical home rents for; read it next to incomes (rent burden), since both rise with inflation.',
    model: 'CH-LUTI' },
  { key: 'housingUnits', pillar: 'housing', label: 'Homes', fmt: 'int', better: 'higher',
    today: { value: 23581, text: '23,581 homes', source: `${ACS}, B25001` },
    benchmarks: [
      { label: 'Town target pace', text: 'about 485 new homes a year', source: 'Town of Chapel Hill, Complete Community Strategy (2022), from the 2021 housing needs study: housing production must reach about 485 homes a year to keep the jobs-housing balance from worsening' },
      { label: 'Recent pace', text: '334 permitted a year, 2015–2025', source: 'U.S. Census Bureau, Building Permits Survey, Chapel Hill town' }],
    why: 'Whether the town builds enough homes for the people who want to live and work here.',
    model: 'CH-LUTI, with the homes the zone rules build' },
  { key: 'affordableHomes', pillar: 'housing', label: 'Income-restricted homes added', short: 'Affordable homes added', fmt: 'int', better: 'higher',
    why: 'Homes that rent below market by rule, added by a policy such as an affordable-housing requirement.',
    model: 'CH-LUTI: the housing.inclusionaryPct lever' },

  // ---------- staying put ----------
  { key: 'pricedOut', pillar: 'stability', label: 'Households priced out', short: 'Priced out', fmt: 'int', better: 'lower',
    why: 'Households living here today that move away because their rent rose faster than their income: displacement.',
    model: 'the household model: 300 households, each standing for about 71 real ones' },
  { key: 'households', pillar: 'stability', label: 'Households', fmt: 'int', better: null,
    today: { value: 21189, text: '21,189 households', source: `${ACS}, B25002 (occupied homes)` },
    why: 'How many households live in town: growth is neither good nor bad by itself.',
    model: 'the household model' },

  // ---------- local economy ----------
  { key: 'jobs', pillar: 'economy', label: 'Jobs in town', fmt: 'int', better: 'higher',
    today: { value: 54322, text: '54,322 jobs', source: 'U.S. Census Bureau, LEHD LODES 2023 (jobs located in the town; the newest year)' },
    benchmarks: [{ label: 'Trend', text: '+1.3% a year, 2002–2023', source: 'LEHD LODES' }],
    why: 'Work in town: UNC, the hospitals and the businesses around them.',
    model: 'CH-LUTI' },
  { key: 'businesses', pillar: 'economy', label: 'Storefront businesses', fmt: 'int', better: 'higher',
    why: 'Shops, restaurants and services: the local economy residents see every day.',
    model: 'CH-LUTI: openings and closures follow local spending' },
  { key: 'storefrontVacancy', pillar: 'economy', label: 'Downtown storefront vacancy', short: 'Storefront vacancy', fmt: 'pct', better: 'lower',
    today: { value: 0.24, text: 'about 24%', source: 'Chapel Hill Downtown Partnership survey of 321 downtown commercial spaces (The News & Observer, August 2024)' },
    benchmarks: [{ label: 'Triangle retail space, all types', text: '2.9%', source: 'Lee & Associates, Raleigh-Durham retail market report, Q2 2026' }],
    why: 'Empty storefronts are the most visible sign of a struggling downtown.',
    model: 'CH-LUTI' },
  { key: 'homeValue', pillar: 'economy', label: 'Median home value', fmt: 'usdk', better: null,
    today: { value: 613700, text: '$613,700', source: `${ACS}, B25077` },
    why: "Owners' wealth and the Town's tax base rise with it, and so does the price of a first home: context, not a goal.",
    model: 'CH-LUTI' },

  // ---------- getting around ----------
  { key: 'avgCommuteMin', pillar: 'mobility', label: 'Average commute', fmt: 'min', better: 'lower',
    today: { value: 19.5, text: '19.5 minutes', source: `${ACS}, B08013 ÷ B08303` },
    benchmarks: [{ label: 'North Carolina', text: '25.1 minutes', source: `${ACS}, B08013 ÷ B08303` }, { label: 'United States', text: '26.4 minutes', source: `${ACS}, B08013 ÷ B08303` }],
    why: 'Time lost getting to work, by any mode.',
    model: 'CH-LUTI: mode choice and road congestion' },
  { key: 'jobAccess', pillar: 'mobility', label: 'Access to jobs', fmt: 'index', better: 'higher',
    why: 'How many jobs residents can reach in a reasonable commute, by the modes they have: the standard planning measure of opportunity.',
    model: 'CH-LUTI: jobs weighted by travel time from where people live (1 = today)' },
  { key: 'transitRidership', pillar: 'mobility', label: 'Bus ridership', fmt: 'millions', better: 'higher',
    today: { value: 4371693, text: '4.37 million trips a year', source: 'FTA National Transit Database, Chapel Hill Transit, September 2025–August 2026' },
    why: 'How much the fare-free bus system is used.',
    model: 'CH-LUTI' },
  { key: 'trafficIndex', pillar: 'mobility', label: 'Car traffic', fmt: 'index', better: 'lower',
    why: 'Peak-hour traffic on the main roads, compared with today.',
    model: 'CH-LUTI' },

  // ---------- environment ----------
  { key: 'treeCoverPct', pillar: 'environment', label: 'Tree cover', fmt: 'pctRaw', better: 'higher',
    today: { value: 46.9, text: '46.9% of the map area', source: 'USFS / MRLC NLCD Tree Canopy Cover 2021 (the newest), our calculation' },
    benchmarks: [{ label: 'Town rule for new development', text: '20–40% canopy on each site', source: 'Chapel Hill Land Use Management Ordinance, Section 5.7' }],
    why: 'Shade, stormwater and habitat; lost when woods are built on.',
    model: 'the land-use rules' },
  { key: 'commuteCO2', pillar: 'environment', label: 'Commute CO₂', fmt: 'tonnes', better: 'lower',
    why: 'Carbon from driving to work, the part of transport emissions that land use and transit change; the Town\'s Climate Action and Response Plan (2021) counts transportation as its second-largest source to cut.',
    model: 'CH-LUTI: car-kilometres on commutes × EPA 400 g CO₂ per mile' },
  { key: 'carShare', pillar: 'environment', label: 'Commuters driving', fmt: 'pct', better: 'lower',
    today: { value: 0.738, text: '73.8%', source: `${ACS}, B08301 (car, truck or van, of commuters not working from home)` },
    benchmarks: [{ label: 'North Carolina', text: '95.6%', source: `${ACS}, B08301` }, { label: 'United States', text: '91.1%', source: `${ACS}, B08301` }],
    why: 'Fewer car commutes means less traffic and carbon; Chapel Hill already drives far less than the state.',
    model: 'CH-LUTI: mode choice (its year 0 is 78.5%, weighting tract shares by where commuters live)' },

  // ---------- town finances ----------
  { key: 'netFiscal', pillar: 'finances', label: 'Town budget impact', fmt: 'usdm', better: 'higher', diffOnly: true,
    benchmarks: [{ label: 'General fund, FY2026–27', text: '$99.8 million', source: 'Town of Chapel Hill FY2026–27 adopted budget' }],
    why: "What a policy adds to or takes from the Town's yearly budget: tax revenue less programme costs and the cost of serving new residents.",
    model: 'CH-LUTI' },
  { key: 'taxRevenue', pillar: 'finances', label: 'Property tax revenue', fmt: 'usdm', better: null,
    today: { value: 70.87e6, text: 'about $70.9 million a year', source: 'Town of Chapel Hill FY2026–27 adopted budget: 50.0¢ per $100 on a $14.17 billion tax base (before collection losses)' },
    why: 'The largest source of Town revenue; it rises with homes and values, and with the rate.',
    model: 'CH-LUTI: homes × median home value × rate (our formula)' },
];

export const INDICATOR = Object.fromEntries(INDICATORS.map(i => [i.key, i]));
export const byPillar = () => PILLARS.map(p => ({ ...p, indicators: INDICATORS.filter(i => i.pillar === p.id) }));
