// Household agent model, ported from the Chapel Hill Household Sim prototype (agents-prototype.js): pure and
// deterministic, no DOM. 300 simulated households in four zones, for the map, the resident cards and priced out. CH-LUTI
// sets the town: new homes come online where and when the models build them, newcomers fill the town up to CH-LUTI's
// household count, and each household's rent and commute follow CH-LUTI's trajectory for its zone, with incomes growing
// as CH-LUTI's do. Renters may leave with a yearly chance that grows with how far their rent burden has risen above 30%
// since they arrived. Coefficients are the agent* and road* entries in data/assumptions.json. Year 0 is
// calibrated to the ACS median gross rent and mean commute in data/baselines.json, and to the observed 15-501 peak volume.
// shared/combined.js builds the inputs and puts the averaged numbers into the SimResult.

/** @typedef {import('./types').Assumptions} Assumptions @typedef {import('./types').Baselines} Baselines
 *  @typedef {import('./types').SimResult} SimResult @typedef {import('./types').Zone} Zone */
/** @typedef {'downtown' | 'campus' | 'edge' | 'corridor'} AgentZone */
/**
 * @typedef {object} HouseholdInputs one entry per year from 0 to the run's last (10, or more in a game of turns), from CH-LUTI's central run
 * @property {Record<AgentZone, number>[]} homes real homes added since year 0, by household zone
 * @property {number[]} households real households added since year 0
 * @property {Record<AgentZone, number>[]} [rent] rent by household zone, as a multiple of year 0's (1 if missing)
 * @property {Record<AgentZone, number>[]} [commute] commute by household zone, as a multiple of year 0's
 * @property {number[]} [traffic] car traffic, as a multiple of year 0's (for 15-501's load on the map)
 */
/**
 * @typedef {object} Agent
 * @property {number} id
 * @property {string} name first name and last initial, unique in its run ("Felix M.")
 * @property {string} first the first name alone
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
 * @property {({ rent: number | null, income: number, burden: number | null, commute: number, here: boolean } | undefined)[]} hist by year, while here
 */
/**
 * @typedef {object} AgentYear
 * @property {number} t @property {Record<AgentZone, number>} units simulated homes (fractional) @property {number} pop households here
 * @property {number} medianRent renters' median monthly rent @property {number} commute mean commute, minutes
 * @property {number} displaced year-0 households that have left so far (newcomers who leave don't count)
 * @property {number} roadRatio 15-501 volume / capacity
 * @property {number} roadTime 15-501 travel time, minutes
 */

const NAMES = 'Ava Ben Chloe Dev Elena Femi Grace Hao Isla Jamal Kai Lena Mateo Nia Omar Priya Quinn Rosa Sam Tara Uma Victor Wren Xavier Yara Zoe Aditi Bryce Carmen Diego Esther Felix Gia Hugo Ines Jonah Keisha Liam Maya Noah Olu Pablo Rhea Soren Tess Ulla Vik Will Ximena Yusuf Zara'.split(' ');
// Last initials: no I, O, Q, U, X or Z, which read oddly. With them, ~50 first names name 1,000 households apart.
const INITIALS = 'ABCDEFGHJKLMNPRSTVWY';

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
 * @param {HouseholdInputs | null} inputs null for no new homes or households (then the run is ten years)
 * @param {Assumptions} assumptions @param {Baselines} baselines
 * @returns {{ agents: Agent[], years: AgentYear[] }}
 */
export function simulate(inputs, assumptions, baselines, seed = 7) {
  const A = Object.fromEntries(Object.entries(assumptions).map(([k, v]) => [k, v.value]));
  const r = mulberry32(seed);
  // A household's name: its first name (the run's draw) and a last initial chosen from its id, the first one not yet
  // taken, so no two households in a run share a name. The initial uses no draws, so nothing else in the run changes.
  const taken = new Set();
  const nameFor = (id, first) => {
    for (let k = 0; ; k++) {
      const i = ((Math.imul(id + 1, 2654435761) >>> 0) + k) % INITIALS.length, n = Math.floor(k / INITIALS.length);
      const name = `${first} ${INITIALS[i]}${n ? n + 1 : ''}.`; // ponytail: a number only past 20 of one first name
      if (!taken.has(name)) { taken.add(name); return name; }
    }
  };
  const makeAgent = (id, zone, year) => {
    const renter = r() < A.agentRenterShare[zone];
    const student = renter && r() < A.agentStudentShare;
    const kind = student ? 'student' : renter ? 'renter' : 'owner';
    const income = lognorm(r, A.agentIncomeMedian[kind], A.agentIncomeSpread[kind]);
    const rw = r();
    const work = rw < A.agentRemoteShare ? 'remote' : rw < A.agentRemoteShare + A.agentDurhamShare ? 'durham' : (student || r() < A.agentCampusWorkShare) ? 'campus' : 'downtown';
    const a = {
      id, first: NAMES[Math.floor(r() * NAMES.length)], zone, renter, student, income: Math.round(income / 100) * 100, work,
      rentBase: A.agentZoneRent[zone] * (A.agentRentSpread.min + r() * A.agentRentSpread.range), x: r(), y: r(), joined: year, left: null, hazard: 0, leaveAt: -Math.log(1 - r()), burden0: null, hist: [],
    };
    a.name = nameFor(id, a.first);
    return a;
  };

  let agents = [], id = 0;
  const pop0 = Object.values(A.agentHouseholds).reduce((s, n) => s + n, 0);
  for (const z in A.agentHouseholds) for (let i = 0; i < A.agentHouseholds[z]; i++) agents.push(makeAgent(id++, z, 0));
  // calibrate rent so the renters' median matches the ACS median gross rent
  const rs = agents.filter(a => a.renter).map(a => a.rentBase).sort((a, b) => a - b);
  const k = baselines.medianGrossRent.value / rs[Math.floor(rs.length / 2)];
  agents.forEach(a => { a.rentBase *= k; });

  // CH-LUTI's index for a household zone in year t; incomes grow as CH-LUTI's do, so burdens follow real rent changes
  const index = (key, t, zone) => inputs?.[key]?.[t]?.[zone] ?? 1, growth = 1 + A.lutiIncomeGrowth;
  // year-0 commute: the zone's local trip, plus 15-501 at its observed peak for edge homes and Durham workers (corridor
  // homes don't take it), calibrated to the ACS mean; later years follow CH-LUTI's commute for the zone
  const road = ratio => A.roadT0Min * (1 + A.roadBpr.alpha * Math.pow(ratio, A.roadBpr.beta)), ratio0 = A.roadPeakVolume / A.roadCapacity;
  const raw = a => (a.work === 'remote' ? 0 : A.agentBaseCommuteMin[a.zone] + ((a.zone === 'edge' || a.work === 'durham') ? road(ratio0) : 0) + (a.work === 'durham' ? A.agentDurhamExtraMin : 0));
  const commuters0 = agents.filter(a => a.work !== 'remote'), calib = baselines.meanCommuteMin.value / (commuters0.reduce((s, a) => s + raw(a), 0) / commuters0.length);
  const years = [];
  const last = inputs ? inputs.homes.length - 1 : 10;
  for (let t = 0; t <= last; t++) {
    const added = inputs?.homes[t] ?? NO_HOMES, units = {};
    for (const z in A.agentUnits) units[z] = A.agentUnits[z] + added[z] / A.agentScale; // fractional, so a few homes still count
    const live = () => agents.filter(a => a.left === null);
    const rentOf = a => a.rentBase * index('rent', t, a.zone), incomeOf = a => a.income * growth ** t;
    if (t > 0) {
      // arrivals: newcomers bring the town up to CH-LUTI's household count, which also replaces households that left.
      // Each moves where the most homes stand empty; everyone CH-LUTI counts lives somewhere, so a zone can run over.
      const gap = Math.max(0, pop0 + (inputs?.households[t] ?? 0) / A.agentScale - live().length);
      const want = Math.floor(gap) + (r() < gap % 1 ? 1 : 0);
      for (let i = 0; i < want; i++) {
        const occ = Object.fromEntries(Object.keys(units).map(z => [z, 0]));
        live().forEach(a => { occ[a.zone]++; });
        const zone = Object.keys(units).reduce((best, z) => (units[z] - occ[z] > units[best] - occ[best] ? z : best));
        const a = makeAgent(id++, zone, t);
        a.rentBase *= k; // at this year's market rent, through rentOf
        agents.push(a);
      }
      // displacement: each year a renter leaves with chance 1 - e^(-agentLeaveRate x points of burden), counting only the
      // burden above 30% (agentBurdenLine) that has built up since arrival. The draw that decides when is made on arrival,
      // so a scenario and the no-policy run compare the same households, not fresh dice.
      for (const a of live()) {
        if (!a.renter || a.burden0 === null) continue;
        const b = rentOf(a) * 12 / incomeOf(a);
        a.hazard += A.agentLeaveRate * 100 * Math.max(0, b - Math.max(A.agentBurdenLine, a.burden0));
        if (a.hazard >= a.leaveAt) a.left = t;
      }
    }
    const L = live(), commuters = L.filter(a => a.work !== 'remote');
    const commute = a => raw(a) * calib * index('commute', t, a.zone);
    for (const a of agents) {
      if (a.left !== null && a.left < t) continue;
      const rent = a.renter ? Math.round(rentOf(a)) : null, income = Math.round(incomeOf(a));
      const burden = a.renter ? rent * 12 / income : null;
      if (a.burden0 === null && a.renter) a.burden0 = rentOf(a) * 12 / incomeOf(a); // unrounded, as the leaving rule compares it
      a.hist[t] = { rent, income, burden, commute: Math.round(commute(a) * 10) / 10, here: a.left === null };
    }
    const renters = L.filter(a => a.renter).map(rentOf).sort((x, y) => x - y), ratio = ratio0 * (inputs?.traffic?.[t] ?? 1);
    years.push({
      t, units, pop: L.length,
      medianRent: Math.round(renters[Math.floor(renters.length / 2)]),
      commute: Math.round(commuters.reduce((s, a) => s + commute(a), 0) / commuters.length * 10) / 10,
      displaced: agents.filter(a => a.joined === 0 && a.left !== null).length, roadRatio: ratio, roadTime: road(ratio) * calib,
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
