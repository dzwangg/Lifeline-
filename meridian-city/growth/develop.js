// A forecast's development, planned so every home the sim builds has valid room reserved before anything is drawn.
// The parcels of a site converting to the same built state in the same year form a block. Blocks are planned year by
// year: first each on its own land (plan.js climbs its capacity ladder: gentle types, denser types, full stretch in
// further rows, courts), with new streets aimed at the land the forecast converts; then the homes a block still can't
// hold go on spare land of blocks in the same state built that year or before (its own site first, then the nearest
// within NEARBY metres), rising in the block's own year. Each block's plan is final once its year is planned, so a year
// never moves what an earlier year built. Whatever no valid land can hold is reported with the constraint that stopped
// it, never forced in.
// Pure: no DOM, no THREE.
import { bounds } from '../world/rings.js';
import { matchesWhere } from '../../shared/schema.js';
import { planBlock } from './plan.js';
import { planSiteStreets } from './site-streets.js';
import { requestedUnits, siteOf, summarize } from './units.js';
import { TYPES, MIXES, FILL } from './catalog.js';

/** True for zone states drawn as planned buildings. */
export const isBuilt = state => !!MIXES[state];

const centre = parcels => { const [x0, z0, x1, z1] = parcels.map(p => bounds(p.ring)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]); return [(x0 + x1) / 2, (z0 + z1) / 2]; };
const HOSTS = 12; // the nearest blocks with room a block's leftover homes may try
const NEARBY = 600; // and no further than this (metres between the blocks' middles), so homes stay in their neighbourhood
const STATE_LABEL = { low_res: 'low-density', mid_res: 'mid-rise', mixed_use: 'mixed-use', transit_station: 'transit-station' };
/** The densest the zone permits, in words: its types, the tallest first, with their most floors. */
const densest = state => FILL[state].map(t => `${TYPES[t].label.toLowerCase()} to ${TYPES[t].floors[1]} floor${TYPES[t].floors[1] === 1 ? '' : 's'}`).join(', ');

/**
 * @param {object} o
 * @param {{id: string, ring: number[], state: string, tags: string[], areaAcres: number}[]} o.zones the sim's parcels
 * @param {Record<string, number>} o.upa assumptions.unitsPerAcre.value
 * @param {(site: {id: string, parcels: object[]}) => object} o.ctxOf the site's siteContext() (cached by the caller)
 * @param {(x: number, z: number) => number} o.occ occupancy bits, without anything growth has drawn
 * @param {boolean} [o.share] place homes a block can't hold on other blocks' spare land (default true)
 */
export function createDevelopment({ zones, upa, ctxOf, occ, share = true }) {
  const sites = new Map();
  for (const z of zones) { const s = siteOf(z); if (!sites.has(s)) sites.set(s, { id: s, parcels: [] }); sites.get(s).parcels.push(z); }
  const siteOfZone = new Map(zones.map(z => [z.id, sites.get(siteOf(z))]));
  const streetCache = new Map(), ownCache = new Map(); // kept across forecasts: a block planned alike is the same plan
  let f = null; // the forecast being developed

  /** The site's streets for this forecast: aimed at the parcels it builds on, never across protected ones. */
  function streetsOf(site) {
    const targets = site.parcels.filter(z => f.blockOf.has(z.id)).map(z => z.id), key = `${site.id}|${f.blockedKey}|${targets.join(',')}`;
    if (!streetCache.has(key)) streetCache.set(key, { key, streets: planSiteStreets({ ctx: ctxOf(site), parcels: site.parcels, occ, blocked: f.blocked, targets: new Set(targets) }).streets });
    return streetCache.get(key);
  }

  /** A block on its own land, cached by everything it depends on. */
  function ownPlan(b) {
    const S = streetsOf(b.site), key = `${b.parcels.map(z => z.id).join('+')}|${b.state}|${b.units}|${S.key}|${b.access.map(z => z.id).join(',')}`;
    if (!ownCache.has(key)) {
      const plan = planBlock({ parcels: b.parcels, state: b.state, units: b.units, ctx: ctxOf(b.site), streets: S.streets, occ, access: b.access });
      ownCache.set(key, Object.assign(plan, { key, annexes: [] }));
    }
    return ownCache.get(key);
  }

  /** Homes the block's own land can't hold, on spare land of blocks built no later in the same state. */
  function shareOut(b) {
    let left = b.own.unmet;
    const annexes = [], [cx, cz] = b.centre;
    const hosts = f.order.filter(o => o !== b && o.own && !o.full && o.state === b.state && o.year <= b.year)
      .map(o => ({ o, d: o.site === b.site ? -1 : Math.hypot(o.centre[0] - cx, o.centre[1] - cz) }))
      .filter(p => p.d <= NEARBY).sort((p, q) => p.d - q.d || (p.o.key < q.o.key ? -1 : 1)).slice(0, HOSTS).map(p => p.o);
    for (const host of hosts) {
      if (left <= 0) break;
      const S = streetsOf(host.site);
      const a = planBlock({ parcels: host.parcels, state: host.state, units: left, ctx: ctxOf(host.site), streets: S.streets, occ, access: host.access, claims: host.onLand, stretch: true });
      if (!a.occupied) { host.full = true; continue; } // claims only grow, so it never will have room
      host.onLand.push(a);
      annexes.push({ host, plan: a });
      left -= a.occupied;
    }
    if (!annexes.length) return b.own;
    const own = b.own, all = [own, ...annexes.map(a => a.plan)], cat = k => all.flatMap(p => p[k] ?? []);
    const occupied = own.occupied + annexes.reduce((n, a) => n + a.plan.occupied, 0);
    return {
      ...own, key: `${own.key}|${annexes.map(a => `${a.host.key}:${a.plan.occupied}`).join(',')}`,
      buildings: cat('buildings'), homes: cat('homes'), paths: cat('paths'), pads: cat('pads'), lawns: cat('lawns'), clear: cat('clear'), plantings: cat('plantings'), courts: cat('courts'),
      occupied, capacity: own.capacity + annexes.reduce((n, a) => n + a.plan.capacity, 0), unmet: Math.max(0, own.requested - occupied),
      // Where the rest went: the host block's site and parcels, the streets there its buildings need, and how many homes.
      annexes: annexes.map(a => ({ site: a.host.site.id, block: a.host.key, parcels: a.plan.parcels, streets: a.plan.streets, homes: a.plan.occupied, buildings: a.plan.buildings.length })),
    };
  }

  /** The exact constraint a block's unplaced homes run into, in words. */
  function constraint(b, plan) {
    const own = b.own, acres = b.parcels.reduce((n, z) => n + z.areaAcres, 0).toFixed(2);
    const why = own.reason === 'no street within reach' ? 'no street or path comes within reach of its parcels'
      : !own.buildings.length ? `none of the buildings the zone permits (${densest(b.state)}) fits on its ${acres} acres with a way in from a street, path or court`
        : `only ${own.occupied} fit on its ${acres} acres at the densest the zone permits (${densest(b.state)}) with a way in from a street, path or court`;
    const fenced = b.site.parcels.filter(z => f.blocked.has(z.id)).length;
    const shared = plan.occupied - own.occupied;
    const label = STATE_LABEL[b.state] ?? b.state;
    const pool = !share ? '' : shared ? `; ${shared} more went on other ${label} land within ${NEARBY} m built by then, which has no room for the rest` : `; no other ${label} land within ${NEARBY} m built by then has room`;
    return `${plan.unmet} of the ${plan.requested} homes asked for ${plan.unmet === 1 ? 'has' : 'have'} no valid place: ${why}${fenced ? `, and ${fenced} protected parcel${fenced === 1 ? '' : 's'} nearby can't be crossed` : ''}${pool}.`;
  }

  /**
   * One step of planning, in order: each of the next year's blocks on its own land, then each one's sharing out (so a
   * year's blocks may host each other's homes). Returns false once the forecast is planned.
   */
  function step() {
    if (f.next >= f.years.length) return false;
    const y = f.years[f.next], now = f.work ??= f.order.filter(b => b.year === y);
    const b = now[f.at % now.length], sharing = f.at >= now.length;
    if (!sharing && !f.streetsDone.has(b.site)) { streetsOf(b.site); f.streetsDone.add(b.site); return true; } // a step of its own
    f.at++;
    if (!sharing) { b.own = ownPlan(b); b.onLand = [b.own]; b.plan = b.own; } else {
      if (b.own.unmet > 0 && share) b.plan = shareOut(b);
      if (b.plan.unmet > 0) b.plan = { ...b.plan, constraint: constraint(b, b.plan) };
      b.done = true;
    }
    if (f.at === 2 * now.length) { f.next++; f.at = 0; f.work = null; }
    return true;
  }
  /** Plans every block converting by `year`. */
  function planThrough(year) {
    while (f.next < f.years.length && f.years[f.next] <= year) step();
  }

  return {
    sites, siteOfZone,
    /**
     * A new forecast: timeline its years' zone states (oldest first), protects the protect rules of the applied cards.
     * Nothing is planned until asked for (planThrough, planOf), and then year by year.
     */
    setForecast(timeline, protects = []) {
      const final = timeline.at(-1);
      const blocked = new Set(zones.filter(z => protects.some(p => final[z.id] === p.protect && matchesWhere(p.where, z))).map(z => z.id));
      const yearOf = z => timeline.findIndex(t => t[z.id] !== z.state);
      const requested = requestedUnits(zones, final, upa, yearOf);
      const blocks = new Map(), blockOf = new Map();
      for (const z of zones) {
        const state = final[z.id];
        if (state === z.state || !isBuilt(state)) continue;
        const site = siteOfZone.get(z.id), year = yearOf(z), key = `${site.id}|${year}|${state}`;
        if (!blocks.has(key)) blocks.set(key, { key, site, year, state, parcels: [], units: 0 });
        const b = blocks.get(key);
        b.parcels.push(z); b.units += requested.get(z.id) ?? 0;
        blockOf.set(z.id, b);
      }
      const order = [...blocks.values()].sort((a, b) => a.year - b.year || (a.site.id < b.site.id ? -1 : a.site.id > b.site.id ? 1 : a.state < b.state ? -1 : 1));
      for (const b of order) {
        b.centre = centre(b.parcels);
        b.access = b.site.parcels.filter(z => final[z.id] === z.state && !blocked.has(z.id)); // land its courts and walks may cross
        b.own = b.plan = null; b.full = b.done = false;
      }
      f = { final, blocked, blockedKey: [...blocked].sort().join(','), requested, blockOf, order, years: [...new Set(order.map(b => b.year))], next: 0, at: 0, work: null, streetsDone: new Set() };
      return order;
    },
    planThrough, step,
    /** The block a parcel converts with in this forecast, or undefined. */
    blockOf: zone => f?.blockOf.get(zone.id),
    /** The plan for a parcel's block (planning every earlier year first), or null if the forecast doesn't build it. */
    planOf(zone) {
      const b = f?.blockOf.get(zone.id);
      if (!b) return null;
      if (!b.done) planThrough(b.year);
      return b.plan;
    },
    /** A parcel alone in some other built state (a year between conversions): its own land only. */
    planAlone(zone, state) {
      const site = siteOfZone.get(zone.id), units = Math.round(requestedUnits([zone], { [zone.id]: state }, upa).get(zone.id) ?? 0);
      return ownPlan({ site, parcels: [zone], state, units, year: -1, access: [] });
    },
    /** The site's streets in this forecast (planSiteStreets().streets). */
    streets: site => streetsOf(site).streets,
    /** The years left to plan, oldest first, and the forecast's blocks. */
    pendingYears: () => (f ? f.years.slice(f.next) : []),
    blocks: () => f?.order ?? [],
    /** The ledger for some zone states: the plans of the blocks built in them, and the totals (units.js summarize). */
    ledger(states) {
      const plans = [...new Set(zones.filter(z => states[z.id] !== z.state && isBuilt(states[z.id]))
        .map(z => (f.blockOf.get(z.id)?.state === states[z.id] ? this.planOf(z) : this.planAlone(z, states[z.id]))))];
      return { plans, totals: summarize(plans) };
    },
  };
}
