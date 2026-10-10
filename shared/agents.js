// Household agent model, ported from the Chapel Hill Household Sim prototype (agents-prototype.js): pure and
// deterministic, no DOM. 300 simulated households in four zones; new homes come online where and when the other models
// build them, newcomers fill the town up to CH-LUTI's household count, rent follows vacancy, renters may leave with a
// yearly chance that grows with how far their rent burden is above 30% once it has risen since they arrived, and
// 15-501 delay follows a BPR curve. Coefficients are the agent* and road* entries in data/assumptions.json. Year 0 is
// calibrated to the ACS median gross rent and mean commute in data/baselines.json, and to the observed 15-501 peak volume.
// shared/combined.js builds the inputs and puts the averaged numbers into the SimResult.

/** @typedef {import('./types').Assumptions} Assumptions @typedef {import('./types').Baselines} Baselines
 *  @typedef {import('./types').SimResult} SimResult @typedef {import('./types').Zone} Zone */
/** @typedef {'downtown' | 'campus' | 'edge' | 'corridor'} AgentZone */
/**
 * @typedef {object} HouseholdInputs one entry per year 0-10
 * @property {Record<AgentZone, number>[]} homes real homes added since year 0, by household zone
 * @property {number[]} households real households added since year 0 (CH-LUTI's count)
 */
/**
 * @typedef {object} Agent
 * @property {number} id
 * @property {string} name
 * @property {AgentZone} zone
 * @property {boolean} renter
 * @property {boolean} student
 * @property {number} income yearly, dollars
 * @property {'remote' | 'durham' | 'campus' | 'downtown'} work
 * @property {number} rentBase monthly rent at a rent index of 1
 * @property {number} x stable 0-1 draws for placing the household on the map
 * @property {number} y
 * @property {number} joined year the household moved in (0 = already here)
 * @property {number | null} left year it left, if it did
 * @property {number} hazard leaving pressure so far @property {number} leaveAt it leaves once hazard reaches this (an Exp(1) draw on arrival)
 * @property {number | null} burden0 rent burden on arrival
 * @property {({ rent: number | null, burden: number | null, commute: number, here: boolean } | undefined)[]} hist by year, while here
 */
/**
 * @typedef {object} AgentYear
 * @property {number} t @property {Record<AgentZone, number>} units @property {number} pop households here
 * @property {number} unmet newcomers who found no home @property {number} rentIndex
 * @property {number} medianRent renters' median monthly rent @property {number} commute mean commute, minutes
 * @property {number} displaced households that have left so far @property {number} roadRatio 15-501 volume / capacity
 * @property {number} roadTime 15-501 travel time, minutes
 */

const NAMES = 'Ava Ben Chloe Dev Elena Femi Grace Hao Isla Jamal Kai Lena Mateo Nia Omar Priya Quinn Rosa Sam Tara Uma Victor Wren Xavier Yara Zoe Aditi Bryce Carmen Diego Esther Felix Gia Hugo Ines Jonah Keisha Liam Maya Noah Olu Pablo Rhea Soren Tess Ulla Vik Will Ximena Yusuf Zara'.split(' ');

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function lognorm(r, median, sd) { // Box-Muller
  const u = Math.max(r(), 1e-9), v = r();
  return median * Math.exp(sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
}

const NO_HOMES = { downtown: 0, campus: 0, edge: 0, corridor: 0 };
export const SEEDS = 200; // reported numbers average this many runs (enough that priced out is stable); the map draws households from one of them
const round1 = v => Math.round(v * 10) / 10;

// Which household zone a sim parcel's homes belong to: corridor parcels (beside 15-501) are their own zone, with no
// extra trip on 15-501; other map_edge parcels are on the town's edge and commute over 15-501; the rest (core infill)
// are near downtown.
/** @param {Zone} zone @returns {AgentZone} */
export const modelZone = zone => (zone.tags.includes('corridor') ? 'corridor' : zone.tags.includes('map_edge') ? 'edge' : 'downtown');

/**
 * Real homes the zone rules have added by each year, by household zone.
 * @param {SimResult} result @param {Zone[]} zones @param {Assumptions} assumptions
 * @returns {Record<AgentZone, number>[]} one entry per year of the result's timeline
 */
export function homesByYear(result, zones, assumptions) {
  const upa = assumptions.unitsPerAcre.value;
  return result.timeline.map(({ zoneStates }) => {
    const added = { ...NO_HOMES };
    for (const z of zones) if (zoneStates[z.id] !== z.state) added[modelZone(z)] += (upa[zoneStates[z.id]] - upa[z.state]) * z.areaAcres;
    return added;
  });
}

/**
 * @param {HouseholdInputs | null} inputs null for no new homes or households
 * @param {Assumptions} assumptions @param {Baselines} baselines
 * @returns {{ agents: Agent[], years: AgentYear[] }}
 */
export function simulate(inputs, assumptions, baselines, seed = 7) {
  const A = Object.fromEntries(Object.entries(assumptions).map(([k, v]) => [k, v.value]));
  const r = mulberry32(seed);
  const makeAgent = (id, zone, year, rentLevel) => {
    const renter = r() < A.agentRenterShare[zone];
    const student = renter && r() < A.agentStudentShare;
    const kind = student ? 'student' : renter ? 'renter' : 'owner';
    const income = lognorm(r, A.agentIncomeMedian[kind], A.agentIncomeSpread[kind]);
    const rw = r();
    const work = rw < A.agentRemoteShare ? 'remote' : rw < A.agentRemoteShare + A.agentDurhamShare ? 'durham' : (student || r() < A.agentCampusWorkShare) ? 'campus' : 'downtown';
    return {
      id, name: NAMES[Math.floor(r() * NAMES.length)], zone, renter, student, income: Math.round(income / 100) * 100, work,
      rentBase: A.agentZoneRent[zone] * (A.agentRentSpread.min + r() * A.agentRentSpread.range) * rentLevel, x: r(), y: r(), joined: year, left: null, hazard: 0, leaveAt: -Math.log(1 - r()), burden0: null, hist: [],
    };
  };

  let agents = [], id = 0;
  const pop0 = Object.values(A.agentHouseholds).reduce((s, n) => s + n, 0);
  for (const z in A.agentHouseholds) for (let i = 0; i < A.agentHouseholds[z]; i++) agents.push(makeAgent(id++, z, 0, 1));
  // calibrate rent so the renters' median matches the ACS median gross rent
  const rs = agents.filter(a => a.renter).map(a => a.rentBase).sort((a, b) => a - b);
  const k = baselines.medianGrossRent.value / rs[Math.floor(rs.length / 2)];
  agents.forEach(a => { a.rentBase *= k; });

  let rentIndex = 1, unmet = 0, calib = null, roadK = null;
  const years = [], C = A.agentRentCurve;
  for (let t = 0; t <= 10; t++) {
    const added = inputs?.homes[t] ?? NO_HOMES, units = {};
    for (const z in A.agentUnits) units[z] = A.agentUnits[z] + Math.round(added[z] / A.agentScale);
    const live = () => agents.filter(a => a.left === null);
    if (t > 0) {
      // arrivals: newcomers bring the town up to CH-LUTI's household count, which also replaces households that left
      let pop = live().length;
      const total = Object.values(units).reduce((s, n) => s + n, 0);
      const gap = Math.max(0, pop0 + (inputs?.households[t] ?? 0) / A.agentScale - pop);
      const want = Math.floor(gap) + (r() < gap % 1 ? 1 : 0);
      unmet = 0;
      for (let i = 0; i < want; i++) {
        const occ = Object.fromEntries(Object.keys(units).map(z => [z, 0]));
        live().forEach(a => { occ[a.zone]++; });
        let best = null, bv = 0;
        for (const z in units) { const v = units[z] - occ[z]; if (v > bv) { bv = v; best = z; } }
        if (!best) { unmet++; continue; }
        const a = makeAgent(id++, best, t, rentIndex);
        a.rentBase = a.rentBase * k / rentIndex;
        agents.push(a);
      }
      // rent responds to effective vacancy (nonlinear, steep near zero)
      pop = live().length;
      const v = (total - pop - unmet) / total;
      const g = Math.max(C.min, Math.min(C.max, A.agentRentAmp * (A.agentTargetVacancy - v) / (Math.max(v, C.floor) + C.offset)));
      rentIndex *= 1 + g;
      // displacement: each year a renter leaves with chance 1 - e^(-agentLeaveRate x points of burden above agentBurdenLine),
      // counted once the burden has risen since arrival (fully after agentBurdenRiseSinceArrival). The draw that decides
      // when is made on arrival, so a scenario and the no-policy run compare the same households, not fresh dice.
      for (const a of live()) {
        if (!a.renter || a.burden0 === null) continue;
        const b = a.rentBase * rentIndex * 12 / a.income, risen = Math.min(1, Math.max(0, b - a.burden0) / A.agentBurdenRiseSinceArrival);
        a.hazard += A.agentLeaveRate * 100 * Math.max(0, b - A.agentBurdenLine) * risen;
        if (a.hazard >= a.leaveAt) a.left = t;
      }
    }
    // commute: 15-501 load via BPR, time = t0 * (1 + alpha * (V/C)^beta)
    const L = live();
    const roadUsers = L.filter(a => a.work !== 'remote' && (a.zone === 'edge' || a.work === 'durham')).length; // corridor: no 15-501 trip
    const V = roadUsers * A.agentScale * A.roadCarShare;
    if (roadK === null) roadK = A.roadPeakVolume / V; // calibrate year 0 to the observed peak-hour, peak-direction volume
    const ratio = V * roadK / A.roadCapacity;
    const roadTime = A.roadT0Min * (1 + A.roadBpr.alpha * Math.pow(ratio, A.roadBpr.beta));
    const raw = a => (a.work === 'remote' ? 0 : A.agentBaseCommuteMin[a.zone] + ((a.zone === 'edge' || a.work === 'durham') ? roadTime : 0) + (a.work === 'durham' ? A.agentDurhamExtraMin : 0));
    const commuters = L.filter(a => a.work !== 'remote');
    const meanRaw = commuters.reduce((s, a) => s + raw(a), 0) / commuters.length;
    if (calib === null) calib = baselines.meanCommuteMin.value / meanRaw; // calibrate to the ACS mean commute
    for (const a of agents) {
      if (a.left !== null && a.left < t) continue;
      const rent = a.renter ? Math.round(a.rentBase * rentIndex) : null;
      const burden = a.renter ? rent * 12 / a.income : null;
      if (a.burden0 === null && burden !== null) a.burden0 = burden;
      a.hist[t] = { rent, burden, commute: Math.round(raw(a) * calib * 10) / 10, here: a.left === null };
    }
    const renters = L.filter(a => a.renter).map(a => a.rentBase * rentIndex).sort((x, y) => x - y);
    years.push({
      t, units, pop: L.length, unmet, rentIndex,
      medianRent: Math.round(renters[Math.floor(renters.length / 2)]),
      commute: Math.round(commuters.reduce((s, a) => s + raw(a) * calib, 0) / commuters.length * 10) / 10,
      displaced: agents.filter(a => a.left !== null).length, roadRatio: ratio, roadTime: roadTime * calib,
    });
  }
  return { agents, years };
}

/**
 * Year-by-year averages over `seeds` runs (seeds 1..n), in real households. A single run is too coarse to report:
 * each simulated household stands for agentScale real ones.
 * @param {HouseholdInputs | null} inputs @param {Assumptions} assumptions @param {Baselines} baselines
 */
export function averageRuns(inputs, assumptions, baselines, seeds = SEEDS) {
  const scale = assumptions.agentScale.value;
  const runs = Array.from({ length: seeds }, (_, i) => simulate(inputs, assumptions, baselines, i + 1).years);
  const mean = (t, f) => runs.reduce((s, years) => s + f(years[t]), 0) / seeds;
  return runs[0].map((_, t) => ({
    medianRent: Math.round(mean(t, y => y.medianRent)),
    avgCommuteMin: round1(mean(t, y => y.commute)),
    households: Math.round(mean(t, y => y.pop) * scale),
    pricedOut: Math.round(mean(t, y => y.displaced) * scale),
    roadRatio: mean(t, y => y.roadRatio),
    roadTime: round1(mean(t, y => y.roadTime)),
  }));
}
