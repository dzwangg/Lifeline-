// Residents on the map, for the dots (agent-layer.js) and the resident card (sim-plate.js): every walker is one, a
// household of the map's run or a street resident, under one resident id (shared/residents.js). Both read a resident's
// state from here, so a dot's colour and the card's figures come from the same object.
import { residentId, residentIn } from '../../shared/residents.js';
import { dataReady } from './scenario.js';

const NONE = { byId: new Map(), byAgent: new Map() };
let showcase = NONE, assumptions = null;
/** The showcase residents (data/residents.json): id -> agent id and agent id -> id. Without the file, none. */
export const residentsReady = Promise.all([
  fetch(new URL('../../data/residents.json', import.meta.url)).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(({ residents }) => ({ byId: new Map(residents.map(r => [r.id, r.agent])), byAgent: new Map(residents.map(r => [r.agent, r.id])) }))
    .catch(e => { console.warn('No showcase residents: every household goes by its hh- id.', e); return NONE; }),
  dataReady,
]).then(([s, [, a]]) => { showcase = s; assumptions = a; });

/** A household agent's resident id. Call once residentsReady has settled. */
export const idOf = a => residentId(a, showcase.byAgent);

const states = new WeakMap(); // a run's households -> resident id -> its state (street residents are drawn once per run)
/** The resident `id` in this run's households (shared/agents.js simulate()), or null if the run has no such person. */
export function residentState(households, id) {
  if (id == null || !assumptions) return null;
  let m = states.get(households);
  if (!m) states.set(households, m = new Map());
  if (!m.has(id)) m.set(id, residentIn(households, id, showcase.byId, assumptions));
  return m.get(id);
}

// A resident's status in year t, which its dot shows: rent burden for renters (under 30%, 30-50%, over 50% of income),
// grey for owners, none while it isn't in town.
export const STATUS = {
  ok: { color: '#21c45d', label: 'Rent under 30% of income' },
  strained: { color: '#ffae00', label: 'Rent 30–50% of income' },
  severe: { color: '#ff3b30', label: 'Rent over 50% of income' },
  owner: { color: '#9aa3a8', label: 'Owns their home' },
};
/** The status key for resident a in year t (STATUS), or null while it isn't in town. */
export function statusOf(a, t) {
  if (!a || a.joined > t || (a.left !== null && a.left <= t)) return null;
  const b = a.hist[t]?.burden;
  return b == null ? 'owner' : b < .3 ? 'ok' : b < .5 ? 'strained' : 'severe';
}
