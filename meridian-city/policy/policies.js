// Policy definitions for the Chapel Hill simulator.
//
// Category: { id, label, slots, color, deep, light, tint }
//   slots  how many active slots the category gets in the policy panel
//   color  card border and icon orb; deep is the text-safe shade; light/tint are highlights and fills
//
// Policy: { id, title, category, icon, summary, ...simulation fields }
//   icon         a key of ICONS
//   levers       what the card changes in the CH-LUTI model (sim/levers.js): { lever, value, zones? }. Never outcomes.
//   timing       quarters before it starts, then quarters to phase in fully
//   cost         plain-language cost for the card; the model computes the actual spending each quarter
//   jurisdiction who can enact it: 'town', or 'state' when North Carolina law would have to change first
//   mechanism    one sentence on how the model expects it to work
//   evidence     what the model's assumptions for this card rest on

export const CATEGORIES = [
  { id: 'business',   label: 'Business',   slots: 2, color: '#2b8ad8', deep: '#145a96', light: '#9bd6ff', tint: '#e3f2fd' },
  { id: 'housing',    label: 'Housing',    slots: 2, color: '#45b04f', deep: '#256f2d', light: '#b3f0a5', tint: '#e6f7e3' },
  { id: 'employment', label: 'Employment', slots: 1, color: '#13b3c2', deep: '#08707b', light: '#9bf2f8', tint: '#e0f8fa' },
  { id: 'taxation',   label: 'Taxation',   slots: 1, color: '#e8a032', deep: '#8a560b', light: '#ffe196', tint: '#fdf2df' },
  { id: 'transport',  label: 'Transport',  slots: 1, color: '#8a63d2', deep: '#563596', light: '#d9c8ff', tint: '#f1ebfd' },
];

export const SLOTS = CATEGORIES.flatMap(c =>
  Array.from({ length: c.slots }, (_, index) => ({ id: `${c.id}-${index + 1}`, category: c.id, index })));

export const POLICIES = [
  {
    id: 'small-business-support-grant',
    title: 'Small-Business Support Grant',
    category: 'business',
    icon: 'storefront',
    summary: 'Grants that help established local shops cover rent, payroll and upgrades.',
    levers: [{ lever: 'business.supportGrants', value: 1.2e6 }],
    timing: { delayQuarters: 2, phaseInQuarters: 2 },
    cost: '$1.2M a year: 120 grants of $10,000',
    jurisdiction: 'town',
    mechanism: 'Grants go to struggling storefronts; some that would have closed stay open, keeping jobs and foot traffic.',
    evidence: [
      { claim: 'Most incentives change only 2–25% of recipients’ decisions', source: 'Bartik (2018), “But For” Percentages for Economic Development Incentives, Upjohn Institute', url: 'https://research.upjohn.org/up_workingpapers/289/' },
      { claim: 'Storefront businesses close at roughly 8–13% a year', source: 'BLS Business Employment Dynamics', url: 'https://www.bls.gov/bdm/' },
    ],
  },
  {
    id: 'new-business-startup-grant',
    title: 'New-Business Startup Grant',
    category: 'business',
    icon: 'sprout',
    summary: 'Seed funding for businesses in their first year of operation.',
    levers: [{ lever: 'business.startupGrants', value: 1.0e6 }],
    timing: { delayQuarters: 2, phaseInQuarters: 2 },
    cost: '$1.0M a year: 40 grants of $25,000',
    jurisdiction: 'town',
    mechanism: 'Some funded start-ups would not have opened otherwise; they fill empty storefronts, then face normal closure risk.',
    evidence: [
      { claim: 'Incentives tip a minority of location and opening decisions', source: 'Bartik (2018), Upjohn Institute', url: 'https://research.upjohn.org/up_workingpapers/289/' },
    ],
  },
  {
    id: 'hiring-subsidy',
    title: 'Hiring Subsidy',
    category: 'employment',
    icon: 'hire',
    summary: 'Pays part of the wage for each new local hire during their first year.',
    levers: [{ lever: 'employment.hiringSubsidy', value: 1.5e6 }],
    timing: { delayQuarters: 2, phaseInQuarters: 2 },
    cost: '$1.5M a year',
    jurisdiction: 'town',
    mechanism: 'Pays for hires that would partly have happened anyway; the extra jobs raise local spending and housing demand.',
    evidence: [
      { claim: 'Hiring credits cost roughly $9,100–$75,000 per job actually created', source: 'Neumark (2013), Journal of Policy Analysis and Management, via PPIC', url: 'https://www.ppic.org/publication/a-hiring-incentive-that-works-the-california-competes-tax-credit/' },
    ],
  },
  {
    id: 'housing-construction-subsidy',
    title: 'Housing Construction Subsidy',
    category: 'housing',
    icon: 'house',
    summary: 'Offsets building costs so more new homes get built.',
    levers: [{ lever: 'housing.subsidyPerUnit', value: 25000 }, { lever: 'housing.subsidyCap', value: 3e6 }],
    timing: { delayQuarters: 2, phaseInQuarters: 1 },
    cost: '$25,000 per new home, capped at $3M a year',
    jurisdiction: 'town',
    mechanism: 'Lowers the cost of each new home, so more sites clear developers’ profit hurdle; much of it pays for homes that would have been built anyway.',
    evidence: [
      { claim: 'New buildings lower nearby rents ~6%', source: 'Asquith, Mast & Reed (2023), Review of Economics and Statistics', url: 'https://doi.org/10.1162/rest_a_01055' },
      { claim: '1% more new supply lowers average rents ~0.19%', source: 'Mense (2025), Journal of Political Economy Macroeconomics', url: 'https://eprints.lse.ac.uk/127192/' },
    ],
  },
  {
    id: 'transit-upzoning',
    title: 'Upzoning Near Transit',
    category: 'housing',
    icon: 'tower',
    summary: 'Allows 60% more floor area along downtown, the MLK Blvd corridor and Blue Hill.',
    levers: [{ lever: 'housing.farMultiplier', value: 1.6, zones: ['downtown', 'north', 'east'] }, { lever: 'housing.planningCost', value: 300000 }],
    timing: { delayQuarters: 4, phaseInQuarters: 4 },
    cost: '$0.3M once, for the rezoning',
    jurisdiction: 'town',
    mechanism: 'More homes fit on each site, so land cost per home falls and more projects pencil out, until land prices catch up.',
    evidence: [
      { claim: 'Auckland’s 2016 upzoning of ¾ of residential land significantly increased construction', source: 'Greenaway-McGrevy & Phillips (2023), Journal of Urban Economics', url: 'https://doi.org/10.1016/j.jue.2023.103555' },
    ],
  },
  {
    id: 'parking-minimum-reduction',
    title: 'Parking Minimum Reduction',
    category: 'housing',
    icon: 'parking',
    summary: 'Cuts required parking to half a space per home; builders choose how much to add.',
    levers: [{ lever: 'housing.parkingMinimum', value: 0.5 }],
    timing: { delayQuarters: 2, phaseInQuarters: 1 },
    cost: 'No direct cost',
    jurisdiction: 'town',
    mechanism: 'Builders skip parking they would not otherwise build, saving up to $30,000 a space in garages.',
    evidence: [
      { claim: 'After Buffalo dropped minimums, 47% of major projects built less parking than the old rules required', source: 'Hess & Rehler (2021), Journal of the American Planning Association', url: 'https://doi.org/10.1080/01944363.2020.1864225' },
      { claim: 'A structured space costs ~$29,900 to build (2024 national median)', source: 'WGI Parking Structure Cost Outlook for 2024', url: 'https://publications.wginc.com/parking-structure-cost-outlook-for-2024' },
    ],
  },
  {
    id: 'property-tax-adjustment',
    title: 'Property Tax Adjustment',
    category: 'taxation',
    icon: 'percent',
    summary: 'Cuts the Town rate from 50¢ to 46¢ per $100 of value on homes and commercial parcels.',
    levers: [{ lever: 'tax.rateDelta', value: -4 }],
    timing: { delayQuarters: 2, phaseInQuarters: 1 },
    cost: 'About $5M a year in lost revenue (1¢ ≈ $1.29M)',
    jurisdiction: 'town',
    mechanism: 'Lower bills make Chapel Hill a little cheaper to live and do business in; much of the saving shows up in higher rents and values.',
    evidence: [
      { claim: 'FY2025–26 rate is 50¢; 1.2¢ was priced at $1.49M', source: 'Town of Chapel Hill FY2025–26 budget (The Local Reporter)', url: 'https://thelocalreporter.press/chapel-hill-town-council-votes-on-2025-26-budget/' },
      { claim: 'Business activity responds modestly to local taxes', source: 'Bartik (1991), Who Benefits from State and Local Economic Development Policies?', url: 'https://research.upjohn.org/up_press/77/' },
    ],
  },
  {
    id: 'storefront-vacancy-tax',
    title: 'Storefront Vacancy Tax',
    category: 'taxation',
    icon: 'vacancy',
    summary: 'A 1% yearly tax on ground-floor storefronts left empty for over a year.',
    levers: [{ lever: 'tax.storefrontVacancyTax', value: 1 }],
    timing: { delayQuarters: 4, phaseInQuarters: 1 },
    cost: 'Raises money; North Carolina would first have to authorise it',
    jurisdiction: 'state',
    mechanism: 'Holding a storefront empty costs more, so landlords lower asking rents and more spaces get leased.',
    evidence: [
      { claim: 'San Francisco (2022) and Washington DC tax vacant storefronts; neither has a causal evaluation yet', source: 'Model assumption, wide range', url: null },
      { claim: 'NC towns can levy only taxes the General Assembly authorises', source: 'UNC School of Government, local government finance', url: 'https://www.sog.unc.edu/' },
    ],
  },
  {
    id: 'bus-frequency-boost',
    title: 'Bus Frequency Boost',
    category: 'transport',
    icon: 'bus',
    summary: 'Adds 25% more Chapel Hill Transit service, so buses come more often.',
    levers: [{ lever: 'transit.serviceMultiplier', value: 1.25 }],
    timing: { delayQuarters: 2, phaseInQuarters: 2 },
    cost: 'About $4M a year as the Town’s share',
    jurisdiction: 'town',
    mechanism: 'Shorter waits pull some commuters out of cars, which also speeds up the roads and widens job access.',
    evidence: [
      { claim: 'Bus ridership rises roughly 0.5% per 1% more service', source: 'TCRP Report 95, Chapter 9: Transit Scheduling and Frequency', url: 'https://doi.org/10.17226/23433' },
      { claim: 'Chapel Hill Transit carried 4.3M trips in 2025; transit fund $36.5M', source: 'Wikipedia (NTD); Town FY2025–26 budget', url: 'https://en.wikipedia.org/wiki/Chapel_Hill_Transit' },
    ],
  },
  {
    id: 'protected-bike-network',
    title: 'Protected Bike Network',
    category: 'transport',
    icon: 'bike',
    summary: 'Builds 12 km of physically separated bike lanes linking downtown, campus and the corridors.',
    levers: [{ lever: 'transport.protectedBikeKm', value: 12 }],
    timing: { delayQuarters: 4, phaseInQuarters: 8 },
    cost: '$9.6M bond-financed, about $0.8M a year',
    jurisdiction: 'town',
    mechanism: 'Safer routes make cycling feel less stressful, so short car and bus trips shift to bikes.',
    evidence: [
      { claim: 'Protected lanes consistently raise cycling', source: 'Buehler & Dill (2016), Transport Reviews', url: 'https://doi.org/10.1080/01441647.2015.1069908' },
    ],
  },
];

// 24×24 stroke icons, drawn white inside the card's orb.
export const ICONS = {
  storefront: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M3.5 9a2.8 2.8 0 0 0 5.67 0 2.8 2.8 0 0 0 5.66 0 2.8 2.8 0 0 0 5.67 0"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6Z"/><path d="M12 10c0-3.5 2.5-6 7-6 0 4-2.5 6-7 6Z"/><path d="M7.5 21h9"/>',
  hire: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/>',
  house: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  percent: '<circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M19 5 5 19"/>',
  tower: '<path d="M4 21h16"/><path d="M6 21V11h5v10"/><path d="M13 21V5h5v16"/><path d="M15.5 2.5v-.01M8.5 7l1-3 1 3"/>',
  parking: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
  vacancy: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M5 9v11h14V9"/><path d="m9.5 12.5 5 5M14.5 12.5l-5 5"/>',
  bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14"/><path d="M8 21v-3M16 21v-3"/><circle cx="8.5" cy="14.5" r=".6"/><circle cx="15.5" cy="14.5" r=".6"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16 9.5 9h6l2.5 7"/><path d="M12 16 9.5 9M8.5 6.5h3"/>',
};
