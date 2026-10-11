// Residents: every person on the map, under one id that stays the same across reloads and scenarios. The map's dots, the
// resident card all find a person by this id, then read the same state: a
// household agent (shared/agents.js simulate) or a street resident (streetAgent), with its income, rent, burden and commute
// by year. Pure: no DOM, no fetch.
//   uma, keisha, ...            showcase households (data/residents.json), year-0 households by agent id
//   hh-<agent id>               any other year-0 household: their ids are the same in every scenario (residents.json note)
//   hh-<id>-y<year>-<first>     a newcomer, which exists only in the runs that bring it
//   st-<n>                      street resident n: walker n of street life (meridian-city/world/street-sim.js)
import { streetAgent, STREET_RESIDENTS } from './agents.js';

const HOUSEHOLD = /^hh-(\d{1,4})(?:-y(\d{1,2})-([a-z]{1,20}))?$/, STREET = /^st-(\d{1,4})$/;

/** The resident id of a household agent or street resident. showcase: Map of agent id -> showcase id (year-0 only). */
export function residentId(a, showcase) {
  if (a.street) return `st-${a.id}`;
  if (a.joined === 0) return showcase?.get(a.id) ?? `hh-${a.id}`;
  return `hh-${a.id}-y${a.joined}-${a.first.toLowerCase()}`;
}

/** Whether id is well formed: a showcase id (in showcaseIds), a household id or a street resident's. */
export function validResidentId(id, showcaseIds) {
  if (typeof id !== 'string') return false;
  if (showcaseIds.has(id)) return true;
  const st = STREET.exec(id);
  return st ? +st[1] < STREET_RESIDENTS : HOUSEHOLD.test(id);
}

/**
 * The resident `id` in one run of the household model, or null if that run has no such person (a newcomer it never
 * brought, say). The returned agent is the run's own: its hist holds its years.
 * @param {{ agents: object[], street: object }} run shared/agents.js simulate()'s result
 * @param {Map<string, number>} showcaseAgents showcase id -> agent id
 */
export function residentIn(run, id, showcaseAgents, assumptions) {
  if (showcaseAgents.has(id)) return run.agents[showcaseAgents.get(id)] ?? null;
  const st = STREET.exec(id);
  if (st) return +st[1] < STREET_RESIDENTS ? streetAgent(+st[1], run.street, assumptions) : null;
  const hh = HOUSEHOLD.exec(id);
  if (!hh) return null;
  const a = run.agents[+hh[1]]; // agent ids are their places in the list
  if (!a) return null;
  if (hh[2] === undefined) return a.joined === 0 ? a : null;
  return a.joined === +hh[2] && a.first.toLowerCase() === hh[3] ? a : null;
}
