// Planned development on the live map: turns the forecast's parcel conversions into plans (develop.js, plan.js) and
// meshes (art.js), caches both so every year, seek and wipe shows the same layout, and keeps the ledger of homes
// requested, completed, under construction, still to come and unmet. Plans are made year by year, so room for every
// home is reserved before anything is drawn; the years the shown one needs are planned at once and the rest in the
// background, a block at a time.
import { siteContext, findJunctions } from './context.js';
import { createDevelopment, isBuilt } from './develop.js';
import { summarize } from './units.js';
import { createGrowthArt } from './art.js';
import { groundTextures } from '../world/textures.js';

export { isBuilt };

/**
 * @param {object} o
 * @param {object} o.world buildWorld()'s result
 * @param {object[]} o.zones the sim's parcels, with ring in map metres
 * @param {Record<string, number>} o.upa assumptions.unitsPerAcre.value
 * @param {(art: object) => void} [o.onDispose] called as a plan's or street's meshes are thrown away, so holders of it
 *   (picking, walker gates) can let go
 */
export function createGrowth({ world, zones, upa, onDispose = () => {} }) {
  const occ = (x, z) => world.grid.at(x, z);
  const roads = world.streets.roads, junctions = findJunctions(roads);
  const art = createGrowthArt({ world, ground: groundTextures() });
  const contexts = new Map();
  const ctxOf = site => {
    if (!contexts.has(site.id)) contexts.set(site.id, siteContext({ id: site.id, parcels: site.parcels, roads, junctions, buildings: world.buildings.meta.filter(m => !m.growth && !m.removed) }));
    return contexts.get(site.id);
  };
  const dev = createDevelopment({ zones, upa, ctxOf, occ });
  const { sites, siteOfZone } = dev;
  const parcelArt = new Map(), streetArt = new Map(); // plan -> art; a site's streets array -> Map(index -> art)
  let stale = new Set(), hosted = new Map(); // art an earlier forecast made; site id -> blocks whose homes stand there

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
    stale.delete(parcelArt.get(plan));
    return parcelArt.get(plan);
  }
  function streetArtOf(site, i) {
    const S = dev.streets(site);
    if (!streetArt.has(S)) streetArt.set(S, new Map());
    const byIndex = streetArt.get(S);
    if (!byIndex.has(i)) byIndex.set(i, art.street(S[i]));
    stale.delete(byIndex.get(i));
    return byIndex.get(i);
  }
  function dispose(a) {
    if (a.metas) for (const m of a.metas) world.buildings.meta[m.idx] = { i: -1, removed: true }; // entries keep their index (meshes name owners by it)
    a.dispose(); onDispose(a);
  }
  /** Notes where a planned block's homes stand beyond its own site (develop.js shares them out). */
  function noteHosts(b) {
    for (const a of b.plan?.annexes ?? []) {
      if (!hosted.has(a.site)) hosted.set(a.site, new Set());
      hosted.get(a.site).add(b);
    }
  }
  const planThrough = year => { const before = dev.pendingYears().length; dev.planThrough(year); if (dev.pendingYears().length !== before) for (const b of dev.blocks()) if (b.done) noteHosts(b); };

  // Background planning: the forecast's later years, a block at a time, each block's meshes made as soon as it's
  // planned, so their year never waits on the planner. Once it's all done, art an earlier forecast made that this one
  // doesn't reuse is thrown away.
  let timer = null;
  function pump() {
    timer = null;
    const t0 = performance.now();
    let more = true;
    while (performance.now() - t0 < 8) {
      const b = dev.blocks().find(o => o.done && !parcelArt.has(o.plan));
      if (b) artOf(b.plan);
      else if (!(more = dev.step())) break;
    }
    for (const b of dev.blocks()) if (b.done) noteHosts(b);
    if (more || dev.blocks().some(b => !parcelArt.has(b.plan))) { timer = setTimeout(pump, 4); return; }
    for (const a of stale) {
      dispose(a);
      for (const [plan, x] of parcelArt) if (x === a) parcelArt.delete(plan);
      for (const [S, byIndex] of streetArt) for (const [i, x] of byIndex) if (x === a) { byIndex.delete(i); if (!byIndex.size) streetArt.delete(S); }
    }
    stale = new Set();
  }

  /** The plan a parcel stands in for some built state: its block's, or (between conversions) its own. */
  const planOf = (zone, state) => {
    const b = dev.blockOf(zone);
    if (b && b.state === state) { if (!b.done) planThrough(b.year); return b.plan; }
    return dev.planAlone(zone, state);
  };

  return {
    sites, siteOfZone,
    /** A new forecast: timeline its years' { zoneStates }, cards the applied policy cards (for protected parcels). */
    setForecast(timeline, cards) {
      dev.setForecast(timeline.map(t => t.zoneStates), cards.flatMap(c => (c.zoneRules ?? []).filter(r => 'protect' in r)));
      hosted = new Map();
      stale = new Set([...parcelArt.values(), ...[...streetArt.values()].flatMap(m => [...m.values()])]);
      clearTimeout(timer);
      timer = setTimeout(pump, 50);
    },
    plan: (zone, state) => (isBuilt(state) ? planOf(zone, state) : null),
    art: plan => artOf(plan),
    streets: site => dev.streets(site),
    streetArt: (site, i) => streetArtOf(site, i),
    /** Blocks of other sites with homes standing on this site (planned so far), each { plan, zone: one of its parcels }. */
    hosted: site => [...(hosted.get(site.id) ?? [])].map(b => ({ plan: b.plan, zone: b.parcels[0], annexes: b.plan.annexes.filter(a => a.site === site.id) })),
    /** Every street's and parcel's art made so far, to hide what the shown year doesn't use. */
    allArt: () => [...parcelArt.values(), ...[...streetArt.values()].flatMap(m => [...m.values()])],
    /**
     * The ledger for some zone states: the blocks' plans and the totals (units.js summarize), and with the states a
     * year before (from): homes standing since then (completed), placed since (under construction, as the year
     * animates), the forecast's homes for later years (planned), and the constraint each block's unmet homes run into.
     * requested is the sim's homes for these states, so completed + building + unmet always equals it.
     */
    ledger(states, from = states) {
      const plansIn = s => [...new Set(zones.filter(z => s[z.id] !== z.state && isBuilt(s[z.id])).map(z => planOf(z, s[z.id])))];
      const plans = plansIn(states), totals = summarize(plans);
      const completed = from === states ? totals.occupied : Math.min(totals.occupied, summarize(plansIn(from).filter(p => plans.includes(p))).occupied);
      const planned = dev.blocks().filter(b => states[b.parcels[0].id] !== b.state).reduce((n, b) => n + b.units, 0);
      return {
        plans,
        totals: {
          ...totals, completed, building: totals.occupied - completed, planned,
          constraints: plans.filter(p => p.unmet > 0).map(p => p.constraint ?? `${p.unmet} of ${p.requested} homes have no valid place (${p.reason}).`),
        },
      };
    },
  };
}
