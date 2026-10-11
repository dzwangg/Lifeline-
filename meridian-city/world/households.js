// The sim's households as people on the street: one walker per household of the map's run (shared/agents.js, seed 7),
// added to the street sim (street-sim.js addPed) with a look of its own, seeded from its id. Pure: no three.js, no DOM.
//
// A day lasts DAY_S seconds of street life and loops, so a short demo sees it all; the hour only drives the walkers and is
// never shown (the clock bar shows the forecast's month and year). Workers leave home in the morning and walk to
// a building door of their kind (campus, or a downtown shop, office or civic building), stay near it through the day
// and walk home in the evening; Durham commuters walk to where 15-501 leaves the map and are out of sight there until
// they come back; people who work from home stay near it, with a short walk or two. A long trip shows its two ends
// only (street-sim.js SHOW_M), about 40 s of walking at most, so it ends well inside the window it belongs to (at least
// seven hours, 45 s of the day); should the schedule move on first anyway, the walker turns for where it now should
// be. A year that playback steps into walks its newcomers in from the map's edge and its leavers off it; any other
// change of year or run (a seek, a policy change) puts every household afresh at its home or wherever the hour says.
import { hash, seeded } from './palette.js';

export const DAY_S = 150;          // real seconds per simulated day
export const START_HOUR = 7.25;    // the street opens just before the morning commute
/** The hour of the day (0-24, fractional) at this many seconds of street time. */
export const hourAt = t => (START_HOUR + t / DAY_S * 24) % 24;
/** "8:40 am" */
export const clockLabel = hour => {
  const m = Math.floor(hour * 60) % 1440, h = Math.floor(m / 60);
  return `${(h + 11) % 12 + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/**
 * The walker under the pointer: the nearest household within 16 pixels of its body if there is one, else the nearest
 * ambient walker in range. visible: [walker, x, y, ...] with x, y in 0-1 across rect (traffic.js drawPeople).
 */
export function pickWalker(visible, rect, clientX, clientY) {
  let household = null, hd = 16 * 16, other = null, od = hd;
  for (let i = 0; i < visible.length; i += 3) {
    const p = visible[i], sx = rect.left + visible[i + 1] * rect.width, sy = rect.top + visible[i + 2] * rect.height;
    const d = (sx - clientX) ** 2 + (sy - 12 - clientY) ** 2; // aim at the body, a little above the feet
    if (p.owner != null) { if (d < hd) { hd = d; household = p; } } else if (d < od) { od = d; other = p; }
  }
  return household ?? other;
}

const STROLL_M = 20;               // how far from home a walk near home goes: ~15 s each way
const within = (hour, from, to) => (from <= to ? hour >= from && hour < to : hour >= from || hour < to);

/** Where a household is at this hour: 'home', 'work' (campus or downtown), 'away' (Durham) or 'stroll' (near home). */
export function placeAt(h, hour) {
  const { a, u } = h;
  if (a.work === 'remote') return within(hour, 9.5 + u[0] * 1.5, 12.5 + u[0] * 1.5) || within(hour, 14.5 + u[1] * 1.5, 17.5 + u[1] * 1.5) ? 'stroll' : 'home';
  // out for 10-12.5 hours (students 7.25-9.75): 62-78 s of the day (45-61 s), against ~40 s of walking each way
  const leave = a.student ? 7.75 + u[0] : 6.5 + u[0], back = a.student ? 16 + u[1] * 1.5 : 17.5 + u[1] * 1.5;
  return within(hour, leave, back) ? (a.work === 'durham' ? 'away' : 'work') : 'home';
}

/**
 * @param {object} o
 * @param {ReturnType<typeof import('./street-sim.js').createStreetSim>} o.sim
 * @param {{ campus: object[], downtown: object[] }} o.doors workplace doors by kind: { x, z, label }
 * @param {[number, number][]} o.exits where 15-501 leaves the map, for Durham commuters
 * @param {number} o.ext the map's half-width, in metres
 */
export function createHouseholds({ sim, doors, exits, ext }) {
  const live = new Map(); // key -> household: { a, key, home, work, exit, u, ped, at, leaving, entering }
  const keyOf = a => `${a.id}|${a.name}|${a.joined}`; // agent ids are per run: newcomers differ between runs
  const nearest = (list, [x, z]) => list.reduce((b, p) => ((p.x ?? p[0]) - x) ** 2 + ((p.z ?? p[1]) - z) ** 2 < ((b.x ?? b[0]) - x) ** 2 + ((b.z ?? b[1]) - z) ** 2 ? p : b);
  const edgeOf = ([x, z]) => (Math.abs(x) > Math.abs(z) ? [Math.sign(x) * ext, z] : [x, Math.sign(z) * ext]); // the map edge nearest home

  function make(a, home) {
    const r = seeded(Math.floor(hash(a.id, a.joined, 11) * 2 ** 31)), u = [r(), r(), r(), r()];
    const list = a.work === 'campus' ? doors.campus : a.work === 'downtown' ? doors.downtown : null;
    const work = list?.length ? list[Math.floor(u[2] * list.length)] : null;
    return { a, key: keyOf(a), home, work, exit: a.work === 'durham' && exits.length ? nearest(exits, home) : null, u, ped: null, at: 'home', leaving: false, entering: false };
  }
  function spawn(h, [x, z]) {
    h.ped = sim.addPed({ x, z, look: Math.floor(hash(h.a.id, 0, 3) * 1e6), vPref: 1.15 + h.u[3] * .4, owner: h.a.id, resident: h.a.resident ?? null });
    return h.ped;
  }
  const strollPoint = h => [h.home[0] + (h.u[2] - .5) * 2 * STROLL_M, h.home[1] + (h.u[3] - .5) * 2 * STROLL_M];
  const workOf = h => (h.work ? [h.work.x, h.work.z] : h.home); // no door of its kind on the map: works at home
  // Put a household where the hour says, with no walking: after a seek, a policy change or the first load.
  function place(h, hour) {
    const where = placeAt(h, hour);
    h.at = where;
    if (where === 'away' && h.exit) return;
    spawn(h, where === 'work' ? workOf(h) : h.home);
  }

  /**
   * The households here in `year` of this run. played: the year was reached by playback, so its newcomers walk in from
   * the map's edge and its leavers walk off it; otherwise everyone just appears where they are at this hour.
   * @param {object[]} agents shared/agents.js agents @param {[number, number][]} homes each agent's home, in local metres
   */
  function sync(agents, homes, year, played, hour) {
    const want = new Map();
    agents.forEach((a, i) => { if (a.joined <= year && (a.left === null || a.left > year)) want.set(keyOf(a), [a, homes[i]]); });
    const drop = (key, h) => { if (h.ped) sim.removePed(h.ped); live.delete(key); };
    for (const [key, h] of live) {
      if (want.has(key) && (played || !h.leaving)) continue;
      if (played && h.a.left === year && h.ped && !h.leaving) { // priced out this year: walk off the map
        h.leaving = true; h.entering = false;
        const [x, z] = edgeOf(h.home);
        sim.sendPed(h.ped, x, z, 'leaving town');
      } else if (!played || !h.leaving) drop(key, h); // a leaver already on its way off finishes the walk
    }
    for (const [key, [a, home]] of want) {
      const h = live.get(key);
      if (h && played) { h.a = a; continue; } // carries on with its day; its year's rent and income are on a
      if (h) drop(key, h); // a seek or a new run: placed afresh below, at its home in this run, with no walk under way
      const n = make(a, home);
      live.set(key, n);
      if (played && a.joined === year && year > 0) { // moving in: from the map's edge to the new home
        n.entering = true;
        sim.sendPed(spawn(n, edgeOf(home)), home[0], home[1], 'their new home');
      } else place(n, hour);
    }
  }

  /** Per frame: send each household on to where the hour says it should be, mid-walk or not. */
  function update(hour) {
    for (const [key, h] of live) {
      const p = h.ped;
      if (h.leaving) { if (!p || sim.idle(p)) { if (p) sim.removePed(p); live.delete(key); } continue; }
      if (h.entering) { if (sim.idle(p)) h.entering = false; continue; }
      const where = placeAt(h, hour);
      if (where === h.at) {
        if (h.at === 'away' && p && h.exit && sim.idle(p)) { sim.removePed(p); h.ped = null; } // reached 15-501: on to Durham
        continue;
      }
      h.at = where; // the schedule moved on: turn for the new place, even mid-walk
      if (where === 'away' && h.exit) sim.sendPed(p, h.exit[0], h.exit[1], 'Durham, by 15-501');
      else if (where === 'home' && !p) sim.sendPed(spawn(h, h.exit), h.home[0], h.home[1], 'home'); // back from Durham
      else if (where === 'work') { const [x, z] = workOf(h); sim.sendPed(p, x, z, h.work?.label ?? 'work'); }
      else if (where === 'stroll') { const [x, z] = strollPoint(h); sim.sendPed(p, x, z, 'a walk near home'); }
      else sim.sendPed(p, h.home[0], h.home[1], 'home');
    }
  }

  return {
    sync, update,
    /** Each household with its walker (null while it is in Durham). */
    each(fn) { for (const h of live.values()) fn(h.a, h.ped, h); },
    get size() { return live.size; },
  };
}
