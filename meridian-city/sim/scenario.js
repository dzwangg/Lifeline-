// The sim's data and state, shared by the zone layer (renderer) and the sim plate (UI).
import { runScenario } from '../../shared/sim.js';
import { simulate } from '../../shared/agents.js';
import { validateCard } from '../../shared/schema.js';
import { toLocal } from '../../shared/geo.js';
import { POLICIES } from '../policy/policies.js';

const json = path => fetch(new URL(path, import.meta.url)).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${path}: HTTP ${r.status}`))));
const query = new URLSearchParams(location.search);
export const stubOn = query.has('stub'); // ?stub adds tests/fixtures/stub-card.json next to the real cards
export let stubAuto = false; // set once the index loads: with no real cards yet, the stub stands in so the loop is always demoable
export const devMode = stubOn || query.has('dev') || ['localhost', '127.0.0.1'].includes(location.hostname);

export const zonesReady = json('../../data/zones.geojson')
  .then(fc => fc.features.map(f => ({ ...f.properties, geometry: f.geometry, ring: f.geometry.coordinates[0].slice(0, -1).flatMap(toLocal) })))
  .catch(e => { console.warn('Zones did not load, so policies cannot change the map.', e); return []; });
export const dataReady = Promise.all([zonesReady, json('../../data/assumptions.json'), json('../../data/baselines.json')]);

// Every card listed in data/cards.index.json, plus the stub card while there are none (or with ?stub). Invalid ones are logged and skipped.
export const cardsReady = json('../../data/cards.index.json')
  .catch(e => { console.warn('No card index, so no policy cards.', e); return []; })
  .then(paths => {
    stubAuto = !paths.length;
    const urls = paths.map(p => `../../data/${p}`);
    if (stubOn || stubAuto) urls.push('../../tests/fixtures/stub-card.json');
    return Promise.all(urls.map(path => json(path).then(
      card => {
        const errors = validateCard(card);
        if (!errors.length) return card;
        console.warn(`Skipping invalid policy card ${path}:\n  ${errors.join('\n  ')}`);
      },
      e => console.warn(`Skipping policy card ${path}:`, e))));
  })
  .then(cards => cards.filter((c, i) => c && cards.findIndex(o => o?.id === c.id) === i));

// Cards in the policy panel's shape. A card replaces the hardcoded policy with the same id; the rest stay.
export const panelPolicies = cards => [
  ...POLICIES.filter(p => !cards.some(c => c.id === p.id)),
  ...cards.map(c => ({ id: c.id, title: c.title, category: c.category ?? 'housing', icon: c.icon ?? 'house', summary: c.summary })),
];

// cards: the applied cards. params: card id -> param key -> value. before: show year 0 whatever the year slider says.
// households: the agent model's run for the homes those cards add. resident: the household picked on the map.
let state = { cards: [], params: {}, year: 10, before: false, result: null, households: null, resident: null };
const listeners = new Set();
export const scenario = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
  set(patch) {
    state = { ...state, ...patch };
    listeners.forEach(fn => fn(state));
    if ('cards' in patch || 'params' in patch) rerun();
  },
};
export const shownYear = s => (s.before ? 0 : s.year);
export const shownStates = s => s.result?.timeline[shownYear(s)].zoneStates;

let timer;
function rerun() { // debounced: a dragged slider fires many inputs
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const [zones, assumptions, baselines] = await dataReady;
    const result = runScenario(state.cards, state.params, zones, assumptions, baselines), t = result.timeline;
    const newHomes = t.at(-1).metrics.housingUnits - t[0].metrics.housingUnits; // what the active cards add by the last year
    scenario.set({ result, households: simulate(newHomes, assumptions, baselines) });
  }, 120);
}
rerun(); // the baseline, before any card is applied
