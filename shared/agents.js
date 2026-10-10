// Household agent model, ported from the Chapel Hill Household Sim prototype (agents-prototype.js): pure and
// deterministic, no DOM. 300 simulated households in three zones; new homes come online at the edge, rent follows
// vacancy, renters whose rent burden stays high may leave, and 15-501 delay follows a BPR curve.
// Coefficients are the agent* and road* entries in data/assumptions.json (all PLACEHOLDER). Year 0 is calibrated to
// the ACS median gross rent and mean commute in data/baselines.json.

/** @typedef {import('./types').Assumptions} Assumptions @typedef {import('./types').Baselines} Baselines */
/** @typedef {'downtown' | 'campus' | 'edge'} AgentZone */
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
 * @property {number} strikes @property {number | null} burden0
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

/**
 * @param {number} newHomes real homes added by policies by the end of the run; they come online at the edge over agentBuildYears
 * @param {Assumptions} assumptions @param {Baselines} baselines
 * @returns {{ agents: Agent[], years: AgentYear[] }}
 */
export function simulate(newHomes, assumptions, baselines, seed = 7) {
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
      rentBase: A.agentZoneRent[zone] * (A.agentRentSpread.min + r() * A.agentRentSpread.range) * rentLevel, x: r(), y: r(), joined: year, left: null, strikes: 0, burden0: null, hist: [],
    };
  };

  let agents = [], id = 0;
  for (const z in A.agentHouseholds) for (let i = 0; i < A.agentHouseholds[z]; i++) agents.push(makeAgent(id++, z, 0, 1));
  // calibrate rent so the renters' median matches the ACS median gross rent
  const rs = agents.filter(a => a.renter).map(a => a.rentBase).sort((a, b) => a - b);
  const k = baselines.medianGrossRent.value / rs[Math.floor(rs.length / 2)];
  agents.forEach(a => { a.rentBase *= k; });

  let rentIndex = 1, unmet = 0, calib = null;
  const years = [], extra = newHomes / A.agentScale, C = A.agentRentCurve;
  for (let t = 0; t <= 10; t++) {
    const frac = Math.min(t / A.agentBuildYears, 1);
    const units = { ...A.agentUnits, edge: A.agentUnits.edge + Math.round(extra * frac) };
    const live = () => agents.filter(a => a.left === null);
    if (t > 0) {
      // arrivals: baseline growth plus demand induced by surplus vacancy
      let pop = live().length;
      const total = units.downtown + units.campus + units.edge, vacPrev = (total - pop) / total;
      const want = Math.round(pop * A.agentGrowth + (r() < (pop * A.agentGrowth % 1) ? 1 : 0)) + Math.max(0, Math.round((vacPrev - A.agentInducedVacancy) * total * A.agentInducedShare));
      unmet = 0;
      for (let i = 0; i < want; i++) {
        const occ = { downtown: 0, campus: 0, edge: 0 };
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
      // displacement: burden over the line and rising for 2 straight years
      for (const a of live()) {
        if (!a.renter || a.burden0 === null) continue;
        const b = a.rentBase * rentIndex * 12 / a.income;
        if (b > A.agentBurdenLine && b - a.burden0 >= A.agentBurdenRise) a.strikes++; else a.strikes = 0;
        if (a.strikes >= 2 && r() < A.agentLeaveProb) a.left = t;
      }
    }
    // commute: 15-501 load via BPR, time = t0 * (1 + alpha * (V/C)^beta)
    const L = live();
    const roadUsers = L.filter(a => a.work !== 'remote' && (a.zone === 'edge' || a.work === 'durham')).length;
    const V = roadUsers * A.agentScale * A.roadCarShare, ratio = V / A.roadCapacity;
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
