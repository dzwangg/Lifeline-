// Planned development on the live map: turns the forecast's parcel conversions into plans (plan.js) and meshes (art.js),
// caches both so every year, seek and wipe shows the same layout, and keeps the ledger of homes requested, placed and
// unmet. Planning a whole forecast can take a second or two, so parcels the shown year needs are planned at once and the
// rest in the background, a few milliseconds at a time.
import { siteContext, findJunctions } from './context.js';
import { planSiteStreets } from './site-streets.js';
import { planBlock } from './plan.js';
import { requestedUnits, siteOf, summarize } from './units.js';
import { MIXES } from './catalog.js';
import { createGrowthArt } from './art.js';
import { groundTextures } from '../world/textures.js';
import { matchesWhere } from '../../shared/schema.js';

/** True for zone states drawn as planned buildings. */
export const isBuilt = state => !!MIXES[state];

/**
 * @param {object} o
 * @param {object} o.world buildWorld()'s result
 * @param {object[]} o.zones the sim's parcels, with ring in map metres
 * @param {Record<string, number>} o.upa assumptions.unitsPerAcre.value
 */
export function createGrowth({ world, zones, upa }) {
  const occ = (x, z) => world.grid.at(x, z);
  const roads = world.streets.roads, junctions = findJunctions(roads);
  const art = createGrowthArt({ world, ground: groundTextures() });
  const sites = new Map();
  for (const z of zones) { const s = siteOf(z); if (!sites.has(s)) sites.set(s, { id: s, parcels: [], ctx: null }); sites.get(s).parcels.push(z); }
  const siteOfZone = new Map(zones.map(z => [z.id, sites.get(siteOf(z))]));

  let blocked = new Set(), blockedKey = '', requested = new Map(), blockOf = new Map();
  const streetCache = new Map(), planCache = new Map(), parcelArt = new Map(), streetArt = new Map();

  const ctxOf = site => (site.ctx ??= siteContext({ id: site.id, parcels: site.parcels, roads, junctions, buildings: world.buildings.meta.filter(m => !m.growth) }));
  /** The site's local streets, for the current set of protected parcels. */
  function streetsOf(site) {
    const key = `${site.id}|${blockedKey}`;
    if (!streetCache.has(key)) streetCache.set(key, planSiteStreets({ ctx: ctxOf(site), parcels: site.parcels, occ, blocked }).streets);
    return streetCache.get(key);
  }
  // A plan's cache key: its block, state, homes and the protected parcels its streets avoid.
  function keyOf(zone, state) {
    const block = blockOf.get(zone.id)?.state === state ? blockOf.get(zone.id) : { parcels: [zone], state };
    const units = block.parcels.reduce((n, z) => n + (requested.get(z.id) ?? 0), 0);
    return { block, units, key: `${block.parcels.map(z => z.id).join('+')}|${state}|${units}|${blockedKey}` };
  }
  /** The plan for a parcel in a built state: its block's (the parcels of its site converting with it), made on first use. */
  function planOf(zone, state) {
    const { block, units, key } = keyOf(zone, state);
    if (!planCache.has(key)) {
      const site = siteOfZone.get(zone.id);
      planCache.set(key, planBlock({ parcels: block.parcels, state, units, ctx: ctxOf(site), streets: streetsOf(site), occ }));
    }
    return planCache.get(key);
  }
  /** A plan's meshes, made on first use; its buildings join the city's info cards. */
  function artOf(plan) {
    if (!parcelArt.has(plan)) {
      const meta = world.buildings.meta;
      const a = art.parcel(plan, b => {
        meta.push({ i: -1, name: null, family: b.fam, label: b.label, type: b.type, floors: b.floors, height: 0, wall: 0, area: b.w * b.d, outer: b.ring, cx: b.c[0], cz: b.c[1], door: b.doors[0],
          growth: { homes: b.units, occupied: b.occupied, plan } });
        return meta.length - 1;
      });
      for (const m of a.metas) Object.assign(meta[m.idx], { height: m.top, wall: m.H, area: m.area });
      parcelArt.set(plan, a);
    }
    return parcelArt.get(plan);
  }
  function streetArtOf(site, i) {
    const S = streetsOf(site)[i], key = `${site.id}|${blockedKey}|${i}`;
    if (!streetArt.has(key)) streetArt.set(key, art.street(S));
    return streetArt.get(key);
  }

  // Background planning: parcels the forecast converts later, so their year never waits on the planner.
  let queue = [], timer = null;
  function pump() {
    timer = null;
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 6) { const [z, s] = queue.shift(); artOf(planOf(z, s)); }
    if (queue.length) timer = setTimeout(pump, 16);
  }

  return {
    sites, siteOfZone,
    /**
     * A new forecast: timeline its years' { zoneStates }, cards the applied policy cards (for protected parcels).
     * The parcels of a site converting to the same state in the same year form a block, planned as one. Plans are queued.
     */
    setForecast(timeline, cards) {
      const final = timeline.at(-1).zoneStates;
      const protects = cards.flatMap(c => (c.zoneRules ?? []).filter(r => 'protect' in r));
      blocked = new Set(zones.filter(z => protects.some(p => final[z.id] === p.protect && matchesWhere(p.where, z))).map(z => z.id));
      blockedKey = [...blocked].sort().join(',');
      requested = requestedUnits(zones, final, upa);
      blockOf = new Map();
      const blocks = new Map();
      for (const z of zones) {
        const state = final[z.id];
        if (state === z.state || !isBuilt(state)) continue;
        const year = timeline.findIndex(t => t.zoneStates[z.id] !== z.state), key = `${siteOfZone.get(z.id).id}|${year}|${state}`;
        if (!blocks.has(key)) blocks.set(key, { parcels: [], state });
        blocks.get(key).parcels.push(z);
        blockOf.set(z.id, blocks.get(key));
      }
      queue = zones.filter(z => blockOf.has(z.id)).map(z => [z, final[z.id]]);
      // Plans this forecast can't show (another scenario's) give their meshes back; streets likewise.
      const keep = new Set(queue.map(([z, s]) => keyOf(z, s).key));
      for (const [key, plan] of planCache) {
        if (keep.has(key)) continue;
        parcelArt.get(plan)?.dispose();
        parcelArt.delete(plan); planCache.delete(key);
      }
      for (const [key, a] of streetArt) if (key.split('|')[1] !== blockedKey) { a.dispose(); streetArt.delete(key); }
      if (!timer && queue.length) timer = setTimeout(pump, 50);
    },
    plan: (zone, state) => (isBuilt(state) ? planOf(zone, state) : null),
    art: plan => artOf(plan),
    streets: site => streetsOf(site),
    streetArt: (site, i) => streetArtOf(site, i),
    /** Every street's and parcel's art made so far, to hide what the shown year doesn't use. */
    allArt: () => [...parcelArt.values(), ...streetArt.values()],
    /** The ledger for some zone states: the blocks' plans and the totals (units.js summarize). */
    ledger(states) {
      const plans = [...new Set(zones.filter(z => states[z.id] !== z.state && isBuilt(states[z.id])).map(z => planOf(z, states[z.id])))];
      return { plans, totals: summarize(plans) };
    },
  };
}
