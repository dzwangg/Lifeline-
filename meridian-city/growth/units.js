// The explicit mapping from the sim's development demand to homes on the map. The sim (shared/sim.js) converts whole
// parcels and counts their homes as (unitsPerAcre[to] - unitsPerAcre[from]) x acres, a fraction for small parcels. The map
// draws whole homes, so within each site (a wood, or a single parking lot) the converted parcels' homes are rounded by
// largest remainder: the site's total on the map is the sim's total rounded, and each parcel gets its share. The planner
// (plan.js) then places buildings until it reaches that number; what it can't place is reported as unmet, never forced
// in and never fed back into the sim. Decoration (materials, roofs, porches) never changes these numbers.
// Pure: no DOM, no THREE.

/** The site a parcel belongs to: the wood it was cut from, or the parcel itself (parking lots). */
export const siteOf = zone => zone.tags.find(t => /^wood-\d+$/.test(t)) ?? zone.id;

/** The sim's homes for one parcel going from state `from` to `to`, unrounded. Demolition requests nothing. */
export const simUnits = (zone, from, to, upa) => Math.max(0, ((upa[to] ?? 0) - (upa[from] ?? 0)) * zone.areaAcres);

/**
 * Whole homes requested of each converted parcel.
 * @param {{id: string, tags: string[], areaAcres: number, state: string}[]} zones
 * @param {Record<string, string>} states each parcel's state in the year shown (or the forecast's last year)
 * @param {Record<string, number>} upa assumptions.unitsPerAcre.value
 * @returns {Map<string, number>} parcel id -> homes, for parcels whose state differs from their base state
 */
export function requestedUnits(zones, states, upa) {
  const sites = new Map();
  for (const z of zones) {
    const to = states[z.id] ?? z.state;
    if (to === z.state) continue;
    const site = siteOf(z);
    if (!sites.has(site)) sites.set(site, []);
    sites.get(site).push({ id: z.id, raw: simUnits(z, z.state, to, upa) });
  }
  const out = new Map();
  for (const list of sites.values()) {
    const total = Math.round(list.reduce((s, p) => s + p.raw, 0));
    for (const p of list) p.n = Math.floor(p.raw);
    let left = total - list.reduce((s, p) => s + p.n, 0);
    const order = [...list].sort((a, b) => (b.raw - b.n) - (a.raw - a.n) || (a.id < b.id ? -1 : 1));
    for (const p of order) { if (left <= 0) break; p.n++; left--; }
    for (const p of list) out.set(p.id, p.n);
  }
  return out;
}

/**
 * Totals over parcel plans (plan.js): homes requested, homes placed (occupied), capacity of what was built, and unmet.
 * @param {Iterable<{requested: number, occupied: number, capacity: number}>} plans
 */
export function summarize(plans) {
  const t = { parcels: 0, requested: 0, occupied: 0, capacity: 0, unmet: 0, buildings: 0 };
  for (const p of plans) {
    t.parcels += p.parcels?.length ?? 1; t.requested += p.requested; t.occupied += p.occupied; t.capacity += p.capacity; t.buildings += p.buildings.length;
    t.unmet += Math.max(0, p.requested - p.occupied);
  }
  return t;
}
