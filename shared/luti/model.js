// CH-LUTI: Chapel Hill Land-Use/Transport Interaction model, from Kevin's policy_mechanism branch.
//
// A quarterly system-dynamics model in the MARS tradition (Pfaffenbichler & Emberger): stocks of households, homes, storefront
// businesses and jobs in five zones, moved each quarter by six linked submodels:
//   1 travel       multinomial-logit mode choice per zone pair → mode shares, commute time, job accessibility, traffic
//   2 location     multinomial-logit choice of zone (vs. the rest of the region) → desired households → rents, vacancy
//   3 development  residual-land-value pro forma per zone → construction starts → completions eight quarters later
//   4 businesses   openings and closures of storefront businesses, driven by local spending
//   5 jobs         UNC/health/professional growth + storefront jobs + subsidised hires
//   6 town budget  property tax (with NC revaluations), sales tax, service costs, policy programme costs
// Each submodel reads the others' outputs from this or the previous quarter, which is where the ripple effects come from.
// The model is pure: no DOM, no randomness. Monte Carlo and comparisons live in run.js.

import { TOWN, ZONES as ZONE_DATA, ZONE_IDS as ZID, BASE_YEAR } from './data.js';
import { paramRanges, fixedValues } from './params.js';
import { buildSchedule } from './levers.js';
import { noDrivers, inflationAt } from './drivers.js';

/** @typedef {import('../types').Assumptions} Assumptions @typedef {import('../types').Baselines} Baselines */

export const MODEL = {
  id: 'CH-LUTI',
  version: '0.1.0',
  name: 'Chapel Hill Land-Use/Transport Interaction model',
  method: 'System-dynamics LUTI (MARS-style) · multinomial-logit location & mode choice · residual-land-value pro forma · paired Monte Carlo',
};
export const QUARTERS = 40; // one decade, the default run; a game of turns runs a decade more per turn
export const yearsOf = (quarters = QUARTERS) => Array.from({ length: quarters }, (_, q) => BASE_YEAR + q / 4);
export const YEARS = yearsOf();

const MODES = ['car', 'bus', 'bike', 'walk'];
const KM_PER_MILE = 1.609344;
const N = ZONE_DATA.length;
const sum = a => a.reduce((s, x) => s + x, 0);
const logistic = x => 1 / (1 + Math.exp(-x));
const qrate = a => 1 - Math.pow(1 - a, 0.25); // annual probability → quarterly
const grow = (g, q) => Math.pow(1 + g, q / 4);
function Phi(x) { // standard normal CDF (Abramowitz & Stegun 26.2.17)
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
const PARKING_SCARCE = new Set(['downtown', 'campus']); // UNC permits and downtown decks: longer park-and-walk
const MIXED_USE = new Set(['downtown', 'east']);        // new apartments here come with ground-floor storefronts

/**
 * The model for one data/assumptions.json and data/baselines.json. Homes, population, median gross rent, median home value,
 * mean commute and the tax rate come from those files; each zone keeps its share of homes and people from data.js.
 * Property tax revenue is our formula (homes × median home value × rate), so it matches the land-use sim's.
 * @param {Assumptions} assumptions @param {Baselines} baselines
 */
export function createModel(assumptions, baselines) {
  const A = Object.fromEntries(Object.entries(assumptions).map(([k, v]) => [k, v.value]));
  const B = Object.fromEntries(Object.entries(baselines).map(([k, v]) => [k, v.value]));
  const F = fixedValues(assumptions), ranges = paramRanges(assumptions), REGION = F.region, S = F.speedKmh;
  const scaled = (key, total) => { const s = sum(ZONE_DATA.map(z => z[key])); return ZONE_DATA.map(z => z[key] * total / s); };
  const units = scaled('units', B.housingUnits), people = scaled('population', B.population);
  const ZONES = ZONE_DATA.map((z, i) => ({ ...z, units: units[i], population: people[i], headway: F.headwayMin[z.id] }));
  const TAX_CENTS = A.propertyTaxRate * 1e4; // per $100 of value

  // ---------- fixed geography ----------
  const DIST = ZONES.map((a, i) => ZONES.map((b, j) => i === j ? F.intraZoneKm[a.id]
    : F.circuity * Math.hypot(a.resident[0] - b.work[0], a.resident[1] - b.work[1]) / 1000));

  const HH0 = TOWN.households, POP0 = B.population;
  const RENT_SCALE = B.medianGrossRent / (sum(ZONES.map(z => z.rent * z.households)) / HH0); // weighted as the rent metric is
  const OTHER_LOCAL_JOBS = TOWN.jobs - TOWN.tradableJobs - TOWN.storefrontJobs; // public admin, construction, admin support…
  const AV_PER_UNIT0 = TOWN.taxBase * F.residentialShareOfBase / B.housingUnits;
  const AV_COMMERCIAL0 = TOWN.taxBase * (1 - F.residentialShareOfBase);
  const NONMARKET = ZONES.map(z => z.units - z.households / (1 - F.naturalVacancy)); // seasonal, held off-market, etc.
  const BASE_STARTS_Q = sum(Object.values(TOWN.permitsPerYear)) / Object.keys(TOWN.permitsPerYear).length / 4;
  const bpr = vc => 1 + A.roadBpr.alpha * vc ** A.roadBpr.beta;

  // ---------- 1. travel ----------
  function modeCosts(i, j, svc, carKmh, stress, busSpeed = 1, parkingPrice = 0) {
    const a = ZONES[i], walkToBus = F.busAccessMin, w = F.activeModeWeight;
    if (j < 0) { // commute out to Durham / RTP / Raleigh
      const d = REGION.distanceKm, car = d / S.regionCar * 60, bus = d / S.regionBus * 60, wait = REGION.headway / 2, term = F.terminalMin.other;
      return {
        gen: { car: car + F.ovtWeight * term, bus: bus + F.ovtWeight * (walkToBus + wait) + walkToBus, bike: w * d / S.bike * 60 + stress, walk: Infinity },
        time: { car: car + term, bus: bus + walkToBus + wait + walkToBus, bike: d / S.bike * 60, walk: Infinity }, wait,
      };
    }
    const b = ZONES[j], d = DIST[i][j];
    const scarce = PARKING_SCARCE.has(b.id), term = F.terminalMin[scarce ? 'parkingScarce' : 'other'];
    const car = d / carKmh * 60, bus = d / (S.bus * busSpeed) * 60, bike = d / S.bike * 60, walk = d / S.walk * 60;
    const wait = Math.max(a.headway, b.headway) / svc / 2;
    // a daily charge at Town-run parking downtown, as minutes of travel time, for the share of drivers there who park in it
    const fee = b.id === 'downtown' ? parkingPrice * F.townParkingShare / (F.valueOfTimePerHour / 60) : 0;
    return {
      gen: { car: car + F.ovtWeight * term + fee, bus: bus + F.ovtWeight * (walkToBus + wait), bike: w * bike + stress, walk: w * walk },
      time: { car: car + term, bus: bus + walkToBus + wait, bike, walk }, wait,
    };
  }

  function travel(s, L, p, cal) {
    const svc = L['transit.serviceMultiplier'], busSpeed = L['transit.busSpeedMultiplier'] ?? 1, parkingPrice = L['transport.parkingPriceDelta'] ?? 0;
    const carKmh = S.car * bpr(F.peakVC) / bpr(F.peakVC * s.traffic);
    const stress = F.bikeStressMin * (1 - p.bikeInfraEffect * Math.min(F.bikeNetwork.maxEffect, L['transport.protectedBikeKm'] / F.bikeNetwork.referenceKm));
    const zones = [];
    for (let i = 0; i < N; i++) {
      const w = s.jobs.map((J, j) => J * Math.exp(-F.gravityDecay * DIST[i][j])), ws = sum(w);
      const dests = w.map((x, j) => [j, (1 - REGION.outShare) * x / ws]).concat([[-1, REGION.outShare]]);
      const share = { car: 0, bus: 0, bike: 0, walk: 0 };
      let time = 0, wait = 0, access = 0, carDowntown = 0, carKm = 0;
      for (const [j, pj] of dests) {
        const c = modeCosts(i, j, svc, carKmh, stress, busSpeed, parkingPrice), e = {};
        let se = 0;
        for (const m of MODES) { e[m] = Number.isFinite(c.gen[m]) ? Math.exp(cal.asc[i][m] - p.timeCoef * c.gen[m]) : 0; se += e[m]; }
        for (const m of MODES) { const pr = e[m] / se; share[m] += pj * pr; if (pr) time += pj * pr * c.time[m]; }
        carKm += pj * e.car / se * (j >= 0 ? DIST[i][j] : REGION.distanceKm);
        if (j >= 0 && ZONES[j].id === 'downtown') carDowntown += pj * e.car / se;
        wait += pj * c.wait;
        if (j >= 0) access += s.jobs[j] * Math.exp(F.accessDecay * Math.log(se) / p.timeCoef); // logsum → composite minutes
      }
      zones.push({ share, time, wait, access, carDowntown, carKm });
    }
    const commuters = s.households.map((h, i) => TOWN.residentWorkers * h / HH0 * (1 - ZONES[i].wfh));
    const C = sum(commuters), avg = k => sum(zones.map((z, i) => z[k] * commuters[i])) / C;
    const share = Object.fromEntries(MODES.map(m => [m, sum(zones.map((z, i) => z.share[m] * commuters[i])) / C]));
    const inCommuters = Math.max(0, sum(s.jobs) - C * (1 - REGION.outShare));
    const inTransit = Math.min(F.inCommuterTransitMax, F.inCommuterTransitShare * svc ** p.serviceElasticity);
    const carTrips = C * share.car + inCommuters * (1 - inTransit);
    // cars parking in Town-run spaces downtown each workday: residents and in-commuters who drive there (in-commuters by the
    // zone's share of jobs), times the share of them that park in the Town's decks, lots and meters
    const downtownJobs = s.jobs[ZONES.findIndex(z => z.id === 'downtown')] / sum(s.jobs);
    const parkedTown = (sum(zones.map((z, i) => z.carDowntown * commuters[i])) + inCommuters * (1 - inTransit) * downtownJobs) * F.townParkingShare;
    // km driven one way each workday on commutes: residents' (in town and out) and in-commuters' who drive in
    const carKm = sum(zones.map((z, i) => z.carKm * commuters[i])) + inCommuters * (1 - inTransit) * REGION.distanceKm;
    return { zones, share, time: avg('time'), wait: avg('wait'), carKmh, stress, carTrips, svc, parkedTown, carKm };
  }

  // ---------- calibration: the no-policy model reproduces the observed base year ----------
  function calibrate(p) {
    const s0 = { households: ZONES.map(z => z.households), traffic: 1, jobs: ZONES.map(z => z.jobs) };
    const L0 = { 'transit.serviceMultiplier': 1, 'transport.protectedBikeKm': 0 };
    // mode-choice constants per zone, fitted to the ACS commute shares of each zone (car is the reference mode)
    const asc = ZONES.map(() => ({ car: 0, bus: 0, bike: 0, walk: 0 }));
    const cal = { asc };
    const target = ZONES.map(z => { const t = sum(MODES.map(m => z.modeShare[m])); return Object.fromEntries(MODES.map(m => [m, z.modeShare[m] / t])); });
    for (let it = 0; it < 80; it++) {
      const t = travel(s0, L0, p, cal);
      for (let i = 0; i < N; i++) for (const m of ['bus', 'bike', 'walk'])
        asc[i][m] += Math.log(target[i][m] / Math.max(1e-6, t.zones[i].share[m])) - Math.log(target[i].car / t.zones[i].share.car);
    }
    const t0 = travel(s0, L0, p, cal);
    cal.timeScale = B.meanCommuteMin / t0.time; // the base year's commute is the ACS mean
    cal.access0 = t0.zones.map(z => z.access);
    cal.carTrips0 = t0.carTrips;
    cal.travel0 = t0;
    // location choice: the base year is an equilibrium, so each zone's constant reproduces its households
    cal.pool0 = HH0 / F.regionShare;
    cal.ascLoc = ZONES.map(z => Math.log(z.households / cal.pool0 / (1 - F.regionShare)));
    // development: new-build rents put the marginal site just short of the hurdle; capacity reproduces 2015–25 permits
    cal.premium = []; cal.cap0 = [];
    for (let i = 0; i < N; i++) {
      const z = ZONES[i], cost = devCost(i, p, 0, 1, F.parkingMinimum[z.id], 0, 1);
      const value = cost * (1 + F.hurdle - F.calibrationGap);
      const noi = value * (p.capRate + TAX_CENTS / 1e4);
      cal.premium[i] = noi / (12 * (1 - F.opex) * (1 - F.stabilizedVacancy)) / (z.rent * RENT_SCALE);
      const p0 = logistic(-F.calibrationGap / p.siteDispersion);
      cal.cap0[i] = BASE_STARTS_Q * F.startShare[z.id] / p0;
    }
    return cal;
  }

  // g: the run's growth curves (see growthCurves); extra: { costShock, impactFee, approvalMonths } from drivers and levers
  function devCost(i, p, q, far, parkingMin, subsidy, landAdj, g = null, extra = null) {
    const z = ZONES[i], ci = (g ? g.cost(q) : grow(F.costDrift, q)) * (1 + (extra?.costShock ?? 0));
    const hard = F.unitSizeSf * p.hardCostPerSf * (1 + F.softCost) * ci;
    const spaces = Math.max(parkingMin, p.marketParkingRatio); // builders build what the market asks, or the requirement if more
    const parking = spaces * (F.structuredParking[z.id] ? p.structuredParkingCost : F.surfaceParkingCost) * ci;
    const land = F.landPerUnit[z.id] * (g ? g.value(q) : grow(p.valueDrift, q)) * (1 + p.landCapture * (landAdj - 1)) / far;
    const base = hard + parking + land;
    if (!extra) return base - subsidy;
    // a longer (or shorter) approval holds land and soft costs for longer (or shorter)
    const carry = Math.max(-0.1, F.approvalCarryPerYear * (extra.approvalMonths ?? 0) / 12);
    return base * (1 + carry) + (extra.impactFee ?? 0) - subsidy;
  }

  // Growth curves for one run. Without drivers they are the model's own rates; with them, every nominal rate moves with
  // the scenario's inflation, by its difference from the default (lutiCpi), one for one.
  function growthCurves(p, drivers, quarters = QUARTERS) {
    if (noDrivers(drivers)) {
      return { rent: q => grow(p.rentDrift, q), rentStep: () => grow(p.rentDrift, 1), value: q => grow(p.valueDrift, q),
        cost: q => grow(F.costDrift, q), cpi: q => grow(F.cpi, q), income: q => grow(F.incomeGrowth, q), price: q => grow(F.cpi, q) };
    }
    const shift = Array.from({ length: quarters + 1 }, (_, q) => inflationAt(drivers, F.cpi, Math.floor(q / 4)) - F.cpi);
    const curve = rate => { const c = [1]; for (let q = 0; q < quarters; q++) c.push(c[q] * Math.pow(1 + rate + shift[q], 0.25)); return q => c[Math.min(q, quarters)]; };
    const rent = curve(p.rentDrift);
    return { rent, rentStep: q => Math.pow(1 + p.rentDrift + shift[q], 0.25), value: curve(p.valueDrift), cost: curve(F.costDrift),
      cpi: curve(F.cpi), income: curve(F.incomeGrowth), price: curve(F.cpi) };
  }

  // ---------- the simulation ----------
  // shock (tests only): { units: 0.01 } adds 1% to every zone's housing stock in the first quarter.
  // landUse: homes the land-use sim's zone rules build, { unitsAdded: [quarter] → { zoneId: homes added so far }, treeCoverPct:
  // [quarter] } (see shared/combined.js). They join the stock at the start of each quarter, like completions.
  // drivers: scenario what-ifs (shared/luti/drivers.js), applied the same with and without policies.
  // quarters: how long to run, from 2027 Q1.
  function simulate(params, policies = [], { seedEvents = true, shock = null, landUse = null, quarters = QUARTERS, drivers = null } = {}) {
    const cal = calibrate(params); // calibrated to today, before any what-if, so a driver moves the town rather than its base year
    const p = { ...params };
    if (drivers?.uncJobsGrowth != null) p.tradableGrowth = drivers.uncJobsGrowth / 100;
    if (drivers?.regionalGrowth != null) p.regionalGrowth = drivers.regionalGrowth / 100;
    const g = growthCurves(p, drivers, quarters), costShock = (drivers?.constructionCost ?? 0) / 100;
    const schedule = buildSchedule(policies, ZID, { 'housing.parkingMinimum': F.parkingMinimum });
    const jps = p.jobsPerStorefront;
    const N0 = ZONES.map(z => TOWN.storefrontJobs * z.storefrontShare / jps);
    const s = {
      households: ZONES.map(z => z.households),
      units: ZONES.map(z => z.units),
      rent: ZONES.map(z => z.rent * RENT_SCALE),
      jobs: ZONES.map(z => z.jobs),
      biz: N0.slice(),
      spaces: ZONES.map((z, i) => N0[i] / (1 - (z.id === 'downtown' ? TOWN.downtownStorefrontVacancy : F.storefrontVacancyElsewhere))),
      landAdj: ZONES.map(() => 1),
      projAcc: ZONES.map(() => 0),
      avRes: ZONES.map(z => z.units * AV_PER_UNIT0),
      avCom: AV_COMMERCIAL0,
      rateBase: TAX_CENTS,
      hired: 0, traffic: 1, affordable: 0,
    };
    // the pipeline starts full of the projects already under way, split by where starts land
    s.pipe = ZONES.map(z => new Array(F.buildQuarters).fill(BASE_STARTS_Q * F.startShare[z.id]));
    if (shock?.units) s.units = s.units.map((u, i) => u + (u - NONMARKET[i]) * shock.units);
    const rent0 = s.rent.slice(), access0 = cal.access0, spaces0 = s.spaces.slice();
    const occ0 = N0.map((n, i) => n / spaces0[i]);
    const value0 = ZONES.map(z => AV_PER_UNIT0 * (z.rent * RENT_SCALE) / (sum(rent0.map((r, k) => r * ZONES[k].households)) / HH0));
    const yield0 = ZONES.map((z, i) => 12 * rent0[i] / value0[i]);
    const ownerShare = ZONES.map(z => 1 - z.renters / z.households);
    const hhSize = ZONES.map(z => (z.population - z.groupQuarters) / z.households);
    const tradeShare = ZONES.map(z => z.tradableJobs / TOWN.tradableJobs);
    const propertyTaxAt = (units, rateDelta) => units * B.medianHomeValue * (TAX_CENTS + rateDelta) / 1e4;
    const series = [], zoneSeries = [], events = [];
    let projectId = 0;
    // the base year, before the first quarter: equal to the data by construction
    const start = {
      housingUnits: sum(s.units), households: HH0, population: POP0, rent: sum(rent0.map((r, i) => r * ZONES[i].households)) / HH0,
      jobs: sum(s.jobs), businesses: sum(N0), storefrontVacancy: 1 - N0[0] / spaces0[0], transitRidership: TOWN.transitRidership,
      commuteTime: B.meanCommuteMin, trafficIndex: 1, homeValue: B.medianHomeValue, treeCoverPct: B.treeCoverPct, landUseHomes: 0,
      taxRate: TAX_CENTS, propertyTax: propertyTaxAt(sum(s.units), 0), salesTax: TOWN.salesTax,
      rentBurden: 1 - Phi((Math.log(0.30) - Math.log(TOWN.rentToIncomeMedian)) / F.rentBurdenSigma), carShare: cal.travel0.share.car,
      accessIndex: 1, commuteCO2: cal.travel0.carKm * 2 * F.workdaysPerYear * F.carCo2GramsPerMile / KM_PER_MILE / 1e6,
      affordableHomes: 0, incomeIndex: 1,
    };
    start.netFiscal = start.propertyTax + start.salesTax;
    start.zones = ZONES.map((z, i) => ({ units: z.units, households: z.households, rent: rent0[i], commute: cal.travel0.zones[i].time * cal.timeScale }));

    for (let q = 0; q < quarters; q++) {
      const L = schedule(q), year = BASE_YEAR + q / 4;
      const rateDelta = L['tax.rateDelta'];
      if (landUse) ZONES.forEach((z, i) => { // homes the zone rules finished this quarter
        const added = landUse.unitsAdded[q][z.id] - (q ? landUse.unitsAdded[q - 1][z.id] : 0);
        s.units[i] += added;
        s.avRes[i] += added * value0[i] * g.value(q);
      });
      // NC revalues property every four years; the base rate is reset to revenue-neutral, the policy's change rides on top
      if (q > 0 && q % 4 === 0 && F.revaluationYears.includes(year)) {
        const before = sum(s.avRes) + s.avCom;
        s.avRes = s.units.map((u, i) => u * value0[i] * g.value(q) * (s.rent[i] / (rent0[i] * g.rent(q))));
        s.avCom = AV_COMMERCIAL0 * g.value(q);
        s.rateBase *= before / (sum(s.avRes) + s.avCom);
      }
      const rate = s.rateBase * (1 + rateDelta / TAX_CENTS);
      const taxFrac = rateDelta / 1e4; // change in tax per $ of value

      // 1 travel (uses last quarter's jobs and traffic)
      const tr = travel(s, L, p, cal);

      // 5 jobs
      const tradable = TOWN.tradableJobs * grow(p.tradableGrowth, q);
      s.hired += L['employment.hiringSubsidy'] / p.costPerHiringJob / 4 - s.hired * qrate(F.hiringJobAttrition);
      const pop = sum(s.households.map((h, i) => h * hhSize[i] + ZONES[i].groupQuarters));
      const otherLocal = OTHER_LOCAL_JOBS * pop / POP0;
      const storefrontJobs = sum(s.biz) * jps;
      const jobsTotal = tradable + storefrontJobs + otherLocal + s.hired;
      const hhShare = s.households.map(h => h / sum(s.households));
      s.jobs = ZONES.map((z, i) => tradeShare[i] * tradable + s.biz[i] * jps + (otherLocal + s.hired) * hhShare[i]);

      // 2 location choice → desired households, then households, vacancy, rent
      const pool = cal.pool0 * grow(p.regionalGrowth, q) * (jobsTotal / TOWN.jobs) ** p.jobsHousingElasticity;
      const occupancy = s.biz.map((n, i) => Math.min(1, n / s.spaces[i]));
      const V = ZONES.map((z, i) => {
        const rentRef = rent0[i] * g.rent(q);
        const taxCost = taxFrac * value0[i] * g.value(q) * (ownerShare[i] + F.renterTaxShare * (1 - ownerShare[i])) / (12 * s.rent[i]);
        return cal.ascLoc[i] + p.rentElasticity * (Math.log(s.rent[i] / rentRef) + Math.log(1 + taxCost))
          + p.accessElasticity * Math.log(tr.zones[i].access / access0[i])
          + p.vibrancyElasticity * Math.log(Math.max(0.05, occupancy[i]) / occ0[i]);
      });
      const eV = V.map(Math.exp), denom = 1 + sum(eV);
      const desired = eV.map(e => pool * e / denom);
      const vacancy = [];
      for (let i = 0; i < N; i++) {
        const market = s.units[i] - NONMARKET[i];
        s.households[i] = Math.min(market * (1 - F.minVacancy), s.households[i] + F.householdAdjust * (desired[i] - s.households[i]));
        vacancy[i] = 1 - s.households[i] / market;
        s.rent[i] *= g.rentStep(q) * (1 + p.rentVacancyResponse * 100 * (F.naturalVacancy - vacancy[i]) / 4);
      }

      // 3 development: pro forma per zone → starts → pipeline → completions
      ZONES.forEach((z, i) => { s.landAdj[i] += (L['housing.farMultiplier'][z.id] - s.landAdj[i]) / F.landCatchUpQuarters; }); // land prices catch up with an upzoning
      const proForma = subsidy => ZONES.map((z, i) => {
        const far = L['housing.farMultiplier'][z.id];
        const cost = devCost(i, p, q, far, L['housing.parkingMinimum'][z.id], subsidy, s.landAdj[i], g,
          { costShock, impactFee: L['housing.impactFee'], approvalMonths: L['housing.approvalMonths'] });
        const noi = 12 * s.rent[i] * cal.premium[i] * (1 - F.opex) * (1 - F.stabilizedVacancy);
        // an affordable-housing requirement rents that share of the new homes below market, which lowers what a building is worth
        const value = noi / (p.capRate + rate / 1e4) * (1 - Math.min(0.9, L['housing.inclusionaryPct'] / 100) * F.affordableGap);
        const margin = value / cost - 1;
        const prob = logistic((margin - F.hurdle) / p.siteDispersion);
        const capacity = cal.cap0[i] * (1 + p.upzoneCapacity * (far - 1));
        return { margin, prob, capacity, starts: capacity * prob, cost, value, far };
      });
      // The subsidy per home is the card's, unless that would spend more than the quarter's share of the yearly limit on
      // this quarter's starts; then it is cut to fit. A smaller subsidy only means fewer starts, so spending stays within it.
      const budget = L['housing.subsidyCap'] / 4, startsOf = d => sum(d.map(x => x.starts));
      let subsidyPer = Math.max(0, L['housing.subsidyPerUnit']), dev = proForma(subsidyPer);
      if (subsidyPer * startsOf(dev) > budget) { subsidyPer = budget / startsOf(dev); dev = proForma(subsidyPer); }
      const startsTotal = startsOf(dev);
      const affordableStarts = startsTotal * Math.min(0.9, L['housing.inclusionaryPct'] / 100);
      s.affordable += affordableStarts;
      for (let i = 0; i < N; i++) {
        const z = ZONES[i], { starts, value, far } = dev[i];
        const done = s.pipe[i].shift();
        s.pipe[i].push(starts);
        s.units[i] += done;
        s.avRes[i] += done * value;
        if (MIXED_USE.has(z.id)) s.spaces[i] += done * F.retailSpacesPerUnit;
        dev[i].done = done;
        // discrete projects for a renderer: every `projectSize` homes of starts becomes one building
        if (seedEvents) {
          s.projAcc[i] += starts;
          while (s.projAcc[i] >= F.projectSize[z.id]) {
            s.projAcc[i] -= F.projectSize[z.id];
            const floors = Math.round(F.projectFloors[z.id] * Math.sqrt(far));
            events.push({ type: 'project', id: `${z.id}-${++projectId}`, zone: z.id, q, doneQ: q + F.buildQuarters, units: F.projectSize[z.id], floors, year });
          }
        }
      }
      const subsidySpend = subsidyPer * startsTotal;

      // 4 storefront businesses: openings and closures move the stock toward what local spending supports
      const spendTown = (1 - F.spendingFromJobs) * pop / POP0 + F.spendingFromJobs * jobsTotal / TOWN.jobs;
      const d = qrate(p.closureRate);
      const grants = L['business.supportGrants'] / F.grantSize, startups = L['business.startupGrants'] / F.startupGrantSize;
      const vacTax = L['tax.storefrontVacancyTax'];
      const bizN = sum(s.biz);
      let opened = 0, closed = 0, saved = 0, grantOpen = 0, vacTaxOpen = 0, vacTaxRevenue = 0;
      const vacantNow = s.biz.map((n, i) => Math.max(0, s.spaces[i] - n)), vacantAll = sum(vacantNow) || 1;
      for (let i = 0; i < N; i++) {
        const local = s.households[i] / ZONES[i].households;
        const target = N0[i] * ((1 - F.localSpendShare) * spendTown + F.localSpendShare * local);
        const ratio = target / s.biz[i];
        const sv = grants * s.biz[i] / bizN * F.atRiskMultiple * p.closureRate * p.grantButFor / 4;
        const go = startups * p.startupButFor * F.startupFirstYearSurvival / 4 * vacantNow[i] / vacantAll;
        const vo = vacantNow[i] * p.vacancyTaxLeaseUp * vacTax / 4;
        const births = s.biz[i] * d * ratio ** p.bizDemandResponse * (1 + p.bizTaxElasticity * rateDelta / TAX_CENTS) + go + vo;
        const deaths = Math.max(0, s.biz[i] * d * ratio ** -p.bizDemandResponse - sv);
        s.biz[i] = Math.min(s.spaces[i], s.biz[i] + births - deaths);
        opened += births; closed += deaths; saved += Math.min(sv, s.biz[i] * d * ratio ** -p.bizDemandResponse); grantOpen += go; vacTaxOpen += vo;
        vacTaxRevenue += vacTax / 100 * F.longVacantShare * Math.max(0, s.spaces[i] - s.biz[i]) * F.storefrontValue * g.cpi(q);
      }

      // 6 town budget, annualised
      const cpi = g.cpi(q);
      const assessed = sum(s.avRes) + s.avCom;
      const propertyTax = propertyTaxAt(sum(s.units), rateDelta);
      const salesTax = TOWN.salesTax * cpi * spendTown;
      const serviceCost = (pop - POP0) * (TOWN.generalFund / POP0) * p.marginalServiceCost * cpi;
      const transitCost = (tr.svc - 1) * TOWN.transitFund * F.transitTownShare * cpi;
      const bikeCost = L['transport.protectedBikeKm'] * (F.bikeLaneCost.capitalPerKm * F.bikeLaneCost.debtServicePerYear + F.bikeLaneCost.upkeepPerKm);
      const programCost = L['business.supportGrants'] + L['business.startupGrants'] + L['employment.hiringSubsidy']
        + subsidySpend * 4 + L['housing.planningCost'] * 4 + transitCost + bikeCost + L['budget.annualCost'] + L['budget.oneTimeCost'] * 4
        + 12 * (L['assistance.rentHouseholds'] * L['assistance.rentMonthly'] + L['assistance.cashHouseholds'] * L['assistance.cashMonthly'])
        + L['workforce.trainees'] * F.trainingCost * cpi;
      const impactFeeRevenue = L['housing.impactFee'] * startsTotal * 4;
      const parkingRevenue = L['transport.parkingPriceDelta'] * F.workdaysPerYear * tr.parkedTown;
      const revenue = propertyTax + salesTax + vacTaxRevenue + impactFeeRevenue + parkingRevenue;

      // traffic feeds next quarter's car speeds
      s.traffic = tr.carTrips / cal.carTrips0;

      const hh = sum(s.households), rentAvg = sum(s.rent.map((r, i) => r * s.households[i])) / hh;
      const rentIdx = rentAvg / B.medianGrossRent, incomeIdx = g.income(q);
      const ratio = TOWN.rentToIncomeMedian * rentIdx / incomeIdx;
      const valueIdx = sum(ZONES.map((z, i) => s.households[i] * (s.rent[i] / (rent0[i] * g.rent(q))) * (1 - taxFrac / yield0[i]))) / hh;
      const svc = tr.svc;
      const storefrontVacancyDowntown = 1 - Math.min(1, s.biz[0] / s.spaces[0]);
      const marketUnits = sum(s.units) - sum(NONMARKET);
      const fromResidents = F.ridershipFromResidents;
      series.push({
        q, year,
        population: pop, households: hh, housingUnits: sum(s.units),
        landUseHomes: landUse ? sum(Object.values(landUse.unitsAdded[q])) : 0, treeCoverPct: landUse ? landUse.treeCoverPct[q] : B.treeCoverPct,
        rent: rentAvg, rentBurden: 1 - Phi((Math.log(0.30) - Math.log(ratio)) / F.rentBurdenSigma),
        homeValue: B.medianHomeValue * g.value(q) * valueIdx,
        jobs: jobsTotal, storefrontJobs, hiredJobs: s.hired, businesses: sum(s.biz), storefrontVacancy: storefrontVacancyDowntown,
        openings: opened * 4, closures: closed * 4, grantSaves: saved * 4, startupOpenings: grantOpen * 4, vacancyTaxOpenings: vacTaxOpen * 4,
        storefrontSpaces: sum(s.spaces), spendingIndex: spendTown,
        transitRidership: TOWN.transitRidership * svc ** p.serviceElasticity * (fromResidents * pop / POP0 + (1 - fromResidents) * jobsTotal / TOWN.jobs),
        busShare: tr.share.bus, carShare: tr.share.car, bikeShare: tr.share.bike, walkShare: tr.share.walk,
        commuteCO2: tr.carKm * 2 * F.workdaysPerYear * F.carCo2GramsPerMile / KM_PER_MILE / 1e6, // tonnes a year, there and back
        commuteTime: tr.time * cal.timeScale, busWait: tr.wait, carSpeed: tr.carKmh, bikeStress: tr.stress, serviceLevel: svc, bikeKm: L['transport.protectedBikeKm'],
        trafficIndex: s.traffic, accessIndex: sum(tr.zones.map((z, i) => z.access * s.households[i])) / sum(access0.map((a, i) => a * s.households[i])),
        starts: startsTotal * 4, completions: sum(dev.map(x => x.done)) * 4,
        devMargin: sum(dev.map(x => x.margin * x.capacity)) / sum(dev.map(x => x.capacity)),
        buildCapacity: sum(dev.map(x => x.capacity)) * 4,
        costPerHome: sum(dev.map(x => x.cost * x.starts)) / Math.max(1e-9, startsTotal),
        subsidyPerHome: subsidyPer,
        desiredHouseholds: sum(desired), vacancy: 1 - (hh / marketUnits),
        taxRate: TAX_CENTS + rateDelta, assessedValue: assessed, propertyTax, salesTax, vacancyTaxRevenue: vacTaxRevenue, impactFeeRevenue, parkingRevenue,
        affordableStarts: affordableStarts * 4, affordableHomes: s.affordable, priceIndex: g.price(q + 1), incomeIndex: incomeIdx, busSpeed: L['transit.busSpeedMultiplier'],
        townRevenue: revenue, programCost, serviceCost, netFiscal: revenue - programCost - serviceCost,
        // for the household model: help paid to households and job training, as they stand this quarter
        rentHelpHouseholds: L['assistance.rentHouseholds'], rentHelpMonthly: L['assistance.rentMonthly'],
        cashHouseholds: L['assistance.cashHouseholds'], cashMonthly: L['assistance.cashMonthly'], trainees: L['workforce.trainees'],
      });
      zoneSeries.push(ZONES.map((z, i) => ({
        households: s.households[i], units: s.units[i], rent: s.rent[i], commute: tr.zones[i].time * cal.timeScale, starts: dev[i].starts * 4, margin: dev[i].margin,
        businesses: s.biz[i], storefrontVacancy: 1 - Math.min(1, s.biz[i] / s.spaces[i]), access: tr.zones[i].access / access0[i],
        busShare: tr.zones[i].share.bus,
      })));
    }
    return { start, series, zones: zoneSeries, events, calibration: { premium: cal.premium, newBuildRent: cal.premium.map((x, i) => x * ZONES[i].rent * RENT_SCALE) } };
  }

  return { simulate, ranges, zones: ZONES, midParams: () => Object.fromEntries(Object.entries(ranges).map(([k, r]) => [k, r.mid])) };
}

// What drives what, for the "why did this change?" trace. Every name is a field of a series row.
export const CAUSES = {
  rent: ['vacancy', 'desiredHouseholds'],
  rentBurden: ['rent'],
  homeValue: ['rent', 'taxRate'],
  vacancy: ['housingUnits', 'households'],
  households: ['desiredHouseholds', 'housingUnits'],
  population: ['households'],
  desiredHouseholds: ['jobs', 'accessIndex', 'storefrontVacancy', 'taxRate'],
  housingUnits: ['completions', 'landUseHomes'],
  completions: ['starts'],
  starts: ['devMargin', 'buildCapacity'],
  devMargin: ['costPerHome', 'subsidyPerHome', 'rent', 'taxRate'],
  jobs: ['storefrontJobs', 'hiredJobs'],
  storefrontJobs: ['businesses'],
  businesses: ['openings', 'closures'],
  openings: ['startupOpenings', 'vacancyTaxOpenings', 'spendingIndex'],
  closures: ['grantSaves', 'spendingIndex'],
  storefrontVacancy: ['businesses', 'storefrontSpaces'],
  spendingIndex: ['population', 'jobs'],
  busShare: ['busWait', 'busSpeed', 'carSpeed', 'bikeStress'],
  carShare: ['busWait', 'busSpeed', 'carSpeed', 'bikeStress'],
  transitRidership: ['serviceLevel', 'population', 'jobs'],
  commuteTime: ['busWait', 'carSpeed', 'busShare'],
  carSpeed: ['trafficIndex'],
  trafficIndex: ['carShare', 'jobs', 'population'],
  accessIndex: ['busWait', 'carSpeed', 'bikeStress', 'jobs'],
  townRevenue: ['propertyTax', 'salesTax', 'vacancyTaxRevenue', 'impactFeeRevenue', 'parkingRevenue'],
  affordableHomes: ['affordableStarts'],
  affordableStarts: ['starts'],
  propertyTax: ['taxRate', 'housingUnits'],
  assessedValue: ['housingUnits', 'rent'],
  salesTax: ['spendingIndex'],
  netFiscal: ['townRevenue', 'programCost', 'serviceCost'],
  serviceCost: ['population'],
  commuteCO2: ['carShare', 'jobs', 'households'],
};
