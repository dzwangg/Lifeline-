// The sim's households as people on the street: one walker per household of the map's run (shared/agents.js, seed 7),
// added to the street sim (street-sim.js addPed) with a look of its own, seeded from its id. Pure: no three.js, no DOM.
//
// Each household stands at its home. The street has no time of day: households change only when the forecast does.
// A year that playback steps into walks its newcomers in from the map's edge and its leavers off it; any other change
// of year or run (a seek, a policy change) puts every household afresh at its home.
import { hash, seeded } from './palette.js';

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

/**
 * @param {object} o
 * @param {ReturnType<typeof import('./street-sim.js').createStreetSim>} o.sim
 * @param {number} o.ext the map's half-width, in metres
 */
export function createHouseholds({ sim, ext }) {
  const live = new Map(); // key -> household: { a, key, home, vPref, ped, leaving, entering }
  const keyOf = a => `${a.id}|${a.name}|${a.joined}`; // agent ids are per run: newcomers differ between runs
  const edgeOf = ([x, z]) => (Math.abs(x) > Math.abs(z) ? [Math.sign(x) * ext, z] : [x, Math.sign(z) * ext]); // the map edge nearest home

  function make(a, home) {
    const vPref = 1.15 + seeded(Math.floor(hash(a.id, a.joined, 11) * 2 ** 31))() * .4;
    return { a, key: keyOf(a), home, vPref, ped: null, leaving: false, entering: false };
  }
  function spawn(h, [x, z]) {
    h.ped = sim.addPed({ x, z, look: Math.floor(hash(h.a.id, 0, 3) * 1e6), vPref: h.vPref, owner: h.a.id, resident: h.a.resident ?? null });
    return h.ped;
  }

  /**
   * The households here in `year` of this run. played: the year was reached by playback, so its newcomers walk in from
   * the map's edge and its leavers walk off it; otherwise everyone just appears at home.
   * @param {object[]} agents shared/agents.js agents @param {[number, number][]} homes each agent's home, in local metres
   */
  function sync(agents, homes, year, played) {
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
      if (h && played) { h.a = a; continue; } // stays where it is; its year's rent and income are on a
      if (h) drop(key, h); // a seek or a new run: placed afresh below, at its home in this run, with no walk under way
      const n = make(a, home);
      live.set(key, n);
      if (played && a.joined === year && year > 0) { // moving in: from the map's edge to the new home
        n.entering = true;
        sim.sendPed(spawn(n, edgeOf(home)), home[0], home[1], 'their new home');
      } else spawn(n, home);
    }
  }

  /** Per frame: a leaver who reached the map's edge is gone; a newcomer who reached home is home. */
  function update() {
    for (const [key, h] of live) {
      const p = h.ped;
      if (h.leaving) { if (!p || sim.idle(p)) { if (p) sim.removePed(p); live.delete(key); } }
      else if (h.entering && sim.idle(p)) h.entering = false;
    }
  }

  return {
    sync, update,
    /** Each household with its walker. */
    each(fn) { for (const h of live.values()) fn(h.a, h.ped, h); },
    get size() { return live.size; },
  };
}
