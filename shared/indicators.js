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
//   score      if the health score reads it (shared/health.js): which half it belongs to (economic or social), the basis
//              it is read in (level, ratioToStart, perYear), the anchors that score 0 (floor) and 100 (target), its
//              weight within its half, and why those anchors. An indicator with no score block is context: a number
//              worth seeing that is neither good nor bad by itself, or one another indicator already measures better.
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
    model: 'the household model: each renter\'s rent (after any rental assistance) against its income (with any cash or training gain)',
    score: { category: 'social', basis: 'level', target: 0.35, floor: 0.75, weight: 2,
      why: 'A third of renters burdened is about the best a US college town manages; three quarters is a town in a rent crisis. Weighted double: it is the clearest measure of whether living here is affordable.' } },
  { key: 'priceToIncome', pillar: 'housing', label: 'Home price to income', short: 'Price to income', fmt: 'ratio', better: 'lower',
    today: { value: 7.14, text: '7.1 years of income', source: `${ACS}: median home value $613,700 (B25077) ÷ median household income $85,989 (B19013)` },
    benchmarks: [{ label: 'North Carolina', text: '4.0', source: `${ACS}, B25077 ÷ B19013` }, { label: 'United States', text: '4.1', source: `${ACS}, B25077 ÷ B19013` }],
    why: 'How many years of a typical income a typical home costs: whether buying a home is within reach.',
    model: 'CH-LUTI: median home value ÷ median household income, both growing with the model',
    score: { category: 'social', basis: 'level', target: 4, floor: 10,
      why: 'Four years of income is the state and national ratio; ten is the most expensive US metros, where buying is out of reach on a normal income.' } },
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
    model: 'CH-LUTI, with the homes the zone rules build',
    score: { category: 'economic', basis: 'perYear', target: 485, floor: 0, label: 'New homes a year', fmt: 'int',
      why: "The Town's own target pace, from its 2021 housing needs study; building nothing scores zero. Counted per year, so a longer game is not automatically a better score." } },
  { key: 'affordableHomes', pillar: 'housing', label: 'Income-restricted homes added', short: 'Affordable homes added', fmt: 'int', better: 'higher',
    why: 'Homes that rent below market by rule, added by a policy such as an affordable-housing requirement.',
    model: 'CH-LUTI: the housing.inclusionaryPct lever' },

  // ---------- staying put ----------
  { key: 'pricedOut', pillar: 'stability', label: 'Households priced out', short: 'Priced out', fmt: 'int', better: 'lower',
    why: 'Households living here today that move away because their rent rose faster than their income: displacement.',
    model: 'the household model: 300 households, each standing for about 71 real ones',
    score: { category: 'social', basis: 'level', target: 0, floor: 1000, weight: 1.5,
      why: 'Nobody forced out scores full marks; 1,000 households is about 5% of the town displaced, the scale at which displacement is the story of the decade. Weighted 1.5: it is the sharpest harm the model can show.' } },
  { key: 'households', pillar: 'stability', label: 'Households', fmt: 'int', better: null,
    today: { value: 21189, text: '21,189 households', source: `${ACS}, B25002 (occupied homes)` },
    why: 'How many households live in town: growth is neither good nor bad by itself.',
    model: 'the household model' },

  // ---------- local economy ----------
  { key: 'jobs', pillar: 'economy', label: 'Jobs in town', fmt: 'int', better: 'higher',
    today: { value: 54322, text: '54,322 jobs', source: 'U.S. Census Bureau, LEHD LODES 2023 (jobs located in the town; the newest year)' },
    benchmarks: [{ label: 'Trend', text: '+1.3% a year, 2002–2023', source: 'LEHD LODES' }],
    why: 'Work in town: UNC, the hospitals and the businesses around them.',
    model: 'CH-LUTI',
    score: { category: 'economic', basis: 'ratioToStart', target: 1.15, floor: 0.95, fmt: 'index',
      why: "LEHD's +1.3% a year since 2002 compounds to about +14% a decade, so +15% is keeping up a strong run; losing 5% of the town's jobs is going backwards." } },
  { key: 'businesses', pillar: 'economy', label: 'Storefront businesses', fmt: 'int', better: 'higher',
    why: 'Shops, restaurants and services: the local economy residents see every day.',
    model: 'CH-LUTI: openings and closures follow local spending',
    score: { category: 'economic', basis: 'ratioToStart', target: 1.15, floor: 0.85, fmt: 'index',
      why: 'Storefronts follow local spending, so the anchors mirror jobs: a seventh more shops is a thriving high street, a seventh fewer is a hollowing one.' } },
  { key: 'storefrontVacancy', pillar: 'economy', label: 'Downtown storefront vacancy', short: 'Storefront vacancy', fmt: 'pct', better: 'lower',
    today: { value: 0.24, text: 'about 24%', source: 'Chapel Hill Downtown Partnership survey of 321 downtown commercial spaces (The News & Observer, August 2024)' },
    benchmarks: [{ label: 'Triangle retail space, all types', text: '2.9%', source: 'Lee & Associates, Raleigh-Durham retail market report, Q2 2026' }],
    why: 'Empty storefronts are the most visible sign of a struggling downtown.',
    model: 'CH-LUTI',
    score: { category: 'economic', basis: 'level', target: 0.05, floor: 0.35,
      why: 'Healthy retail streets run near 5% empty (the Triangle average is 2.9%); a third empty is a downtown in trouble. Chapel Hill starts at about 24%.' } },
  { key: 'homeValue', pillar: 'economy', label: 'Median home value', fmt: 'usdk', better: null,
    today: { value: 613700, text: '$613,700', source: `${ACS}, B25077` },
    why: "Owners' wealth and the Town's tax base rise with it, and so does the price of a first home: context, not a goal.",
    model: 'CH-LUTI' },

  // ---------- getting around ----------
  { key: 'avgCommuteMin', pillar: 'mobility', label: 'Average commute', fmt: 'min', better: 'lower',
    today: { value: 19.5, text: '19.5 minutes', source: `${ACS}, B08013 ÷ B08303` },
    benchmarks: [{ label: 'North Carolina', text: '25.1 minutes', source: `${ACS}, B08013 ÷ B08303` }, { label: 'United States', text: '26.4 minutes', source: `${ACS}, B08013 ÷ B08303` }],
    why: 'Time lost getting to work, by any mode.',
    model: 'CH-LUTI: mode choice and road congestion',
    score: { category: 'social', basis: 'level', target: 15, floor: 30,
      why: 'Fifteen minutes is a town where work is close to home; thirty is the US metro average, half an hour each way.' } },
  { key: 'jobAccess', pillar: 'mobility', label: 'Access to jobs', fmt: 'index', better: 'higher',
    why: 'How many jobs residents can reach in a reasonable commute, by the modes they have: the standard planning measure of opportunity.',
    model: 'CH-LUTI: jobs weighted by travel time from where people live (1 = today)',
    score: { category: 'social', basis: 'level', target: 1.2, floor: 0.9,
      why: 'A fifth more jobs within a normal commute is a real gain in opportunity; a tenth fewer means the town has cut itself off from work.' } },
  { key: 'transitRidership', pillar: 'mobility', label: 'Bus ridership', fmt: 'millions', better: 'higher',
    today: { value: 4371693, text: '4.37 million trips a year', source: 'FTA National Transit Database, Chapel Hill Transit, September 2025–August 2026' },
    why: 'How much the fare-free bus system is used.',
    model: 'CH-LUTI',
    score: { category: 'social', basis: 'ratioToStart', target: 1.3, floor: 0.8, weight: 0.5, fmt: 'index',
      why: 'A third more trips on a fare-free system is a service people have taken up; a fifth fewer is one they have given up on. Weighted half: the commute and access scores already measure getting around.' } },
  { key: 'trafficIndex', pillar: 'mobility', label: 'Car traffic', fmt: 'index', better: 'lower',
    why: 'Peak-hour traffic on the main roads, compared with today.',
    model: 'CH-LUTI',
    score: { category: 'social', basis: 'level', target: 0.95, floor: 1.25, weight: 0.5,
      why: 'Peak traffic a twentieth below today is noticeably calmer streets; a quarter above is the congestion residents complain about. Weighted half: it overlaps with the commute and driving scores.' } },

  // ---------- environment ----------
  { key: 'treeCoverPct', pillar: 'environment', label: 'Tree cover', fmt: 'pctRaw', better: 'higher',
    today: { value: 46.9, text: '46.9% of the map area', source: 'USFS / MRLC NLCD Tree Canopy Cover 2021 (the newest), our calculation' },
    benchmarks: [{ label: 'Town rule for new development', text: '20–40% canopy on each site', source: 'Chapel Hill Land Use Management Ordinance, Section 5.7' }],
    why: 'Shade, stormwater and habitat; lost when woods are built on.',
    model: 'the land-use rules',
    score: { category: 'social', basis: 'level', target: 50, floor: 30,
      why: 'Chapel Hill starts at 46.9%, so 50% means it grew its canopy while it grew; 30% is the cover of a built-out suburb. Losing the woods is the change residents see first.' } },
  { key: 'commuteCO2', pillar: 'environment', label: 'Commute CO₂', fmt: 'tonnes', better: 'lower',
    why: 'Carbon from driving to work, the part of transport emissions that land use and transit change; the Town\'s Climate Action and Response Plan (2021) counts transportation as its second-largest source to cut.',
    model: 'CH-LUTI: car-kilometres on commutes × EPA 400 g CO₂ per mile',
    score: { category: 'social', basis: 'ratioToStart', target: 0.8, floor: 1.2, weight: 0.75, fmt: 'index',
      why: "The Town's Climate Action and Response Plan wants transport emissions cut, not held: a fifth less carbon from commuting is real progress, a fifth more the opposite. Weighted 0.75: it moves with the driving score." } },
  { key: 'carShare', pillar: 'environment', label: 'Commuters driving', fmt: 'pct', better: 'lower',
    today: { value: 0.738, text: '73.8%', source: `${ACS}, B08301 (car, truck or van, of commuters not working from home)` },
    benchmarks: [{ label: 'North Carolina', text: '95.6%', source: `${ACS}, B08301` }, { label: 'United States', text: '91.1%', source: `${ACS}, B08301` }],
    why: 'Fewer car commutes means less traffic and carbon; Chapel Hill already drives far less than the state.',
    model: 'CH-LUTI: mode choice (its year 0 is 78.5%, weighting tract shares by where commuters live)',
    score: { category: 'social', basis: 'level', target: 0.65, floor: 0.92, weight: 0.75,
      why: 'Chapel Hill starts at 73.8% driving against 91.1% nationally, so the floor is the US norm and the target is the strongest US transit towns. Weighted 0.75: it moves with commute carbon.' } },

  // ---------- local economy: what households earn ----------
  { key: 'realIncome', pillar: 'economy', label: 'Median household income (today’s dollars)', short: 'Real income', fmt: 'usd', better: 'higher',
    today: { value: 85989, text: '$85,989', source: `${ACS}, B19013; the model’s own median starts a little above it, from its household mix` },
    why: 'What a typical household actually lives on once inflation is taken out: the plainest measure of whether people here are getting better off.',
    model: 'the household model: the median household’s income, with any job-training gain or cash help, over CH-LUTI’s price level',
    score: { category: 'economic', basis: 'ratioToStart', target: 1.2, floor: 0.95, fmt: 'index',
      why: 'A fifth more real income over a decade is strong growth for a US town; falling real income is the clearest sign of a place getting poorer.' } },

  // ---------- town finances ----------
  { key: 'netFiscal', pillar: 'finances', label: 'Town budget impact', fmt: 'usdm', better: 'higher', diffOnly: true,
    benchmarks: [{ label: 'General fund, FY2026–27', text: '$99.8 million', source: 'Town of Chapel Hill FY2026–27 adopted budget' }],
    why: "What a policy adds to or takes from the Town's yearly budget: tax revenue less programme costs and the cost of serving new residents.",
    model: 'CH-LUTI',
    score: { category: 'economic', basis: 'ratioToStart', target: 1.26, floor: 1, fmt: 'index',
      why: "The Town's money has to keep pace with prices: 1.26 is ten years of 2.3% inflation, and flat in cash is a fifth less to spend in real terms. A tax cut shows up here as its cost." } },
  { key: 'taxRevenue', pillar: 'finances', label: 'Property tax revenue', fmt: 'usdm', better: null,
    today: { value: 70.87e6, text: 'about $70.9 million a year', source: 'Town of Chapel Hill FY2026–27 adopted budget: 50.0¢ per $100 on a $14.17 billion tax base (before collection losses)' },
    why: 'The largest source of Town revenue; it rises with homes and values, and with the rate.',
    model: 'CH-LUTI: homes × median home value × rate (our formula)' },
  { key: 'taxBurden', pillar: 'finances', label: 'Property tax on the median home, as a share of income', short: 'Tax burden', fmt: 'pct', better: 'lower',
    today: { value: 0.0338, text: 'about 3.4% of a median income', source: 'Our calculation: the median home ($613,700) at the FY2026–27 rate of 50.0¢ per $100, over the model’s median household income' },
    why: 'What the Town takes from a typical household each year: the cost side of every policy that raises the rate or the value it is charged on.',
    model: 'CH-LUTI: median home value × the tax rate, over the household model’s median income',
    score: { category: 'social', basis: 'level', target: 0.025, floor: 0.05,
      why: 'A property tax bill near 2.5% of income is an ordinary one in the US; 5% is the level at which households feel it as a burden.' } },
];

export const INDICATOR = Object.fromEntries(INDICATORS.map(i => [i.key, i]));
export const byPillar = () => PILLARS.map(p => ({ ...p, indicators: INDICATORS.filter(i => i.pillar === p.id) }));
