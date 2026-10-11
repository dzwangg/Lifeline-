// The sim's data and state, shared by the zone layer (renderer) and the sim plate (UI).
import { runModels, withDeltas } from '../../shared/combined.js';
import { simulate } from '../../shared/agents.js';
import { validateCard } from '../../shared/schema.js';
import { toLocal } from '../../shared/geo.js';
import { POLICIES } from '../policy/policies.js';
import { createClock } from './clock.js';

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

// The scenario's inputs. cards: the applied cards. params: card id -> param key -> value. Changing either bumps the
// version; the clock (clock.js) drops predictions made for older versions. The rest is view state, which never touches
// the forecast: result, the latest full SimResult (shared/combined.js), for the narration pipeline (the panel and map read
// the clock's shown year instead); resident, the household picked on the map; roadView, the camera is on 15-501;
// luti, CH-LUTI's 200-run ranges and "why" traces (shared/luti/run.js runScenario).
let state = { cards: [], params: {}, version: 0, result: null, resident: null, roadView: false, luti: null };
const listeners = new Set();
export const scenario = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
  set(patch) {
    const input = 'cards' in patch || 'params' in patch; // view state (a picked resident, the camera) keeps the forecast
    state = { ...state, ...patch, version: state.version + (input ? 1 : 0) };
    listeners.forEach(fn => fn(state));
    if (input) rerun();
  },
};

// A view setting, not a sim input: whether zones a policy changed are coloured on the map. Remembered across visits.
const HIGHLIGHT_KEY = 'meridian.highlightChanges';
let highlightOn = true;
try { highlightOn = localStorage.getItem(HIGHLIGHT_KEY) !== 'off'; } catch {} // storage blocked: default on
const highlightListeners = new Set();
export const highlight = {
  get: () => highlightOn,
  subscribe(fn) { highlightListeners.add(fn); fn(highlightOn); return () => highlightListeners.delete(fn); },
  set(on) {
    highlightOn = !!on;
    try { localStorage.setItem(HIGHLIGHT_KEY, highlightOn ? 'on' : 'off'); } catch {} // private mode: just not remembered
    highlightListeners.forEach(fn => fn(highlightOn));
  },
};

// Predictions: one step's { zoneStates, metrics } for a scenario version. The whole timeline is computed in the
// browser here (debounced, as a dragged slider fires many inputs); a forecast backend would answer the same call.
// ?latency=ms delays each answer, to see the clock hold and the loading indicator.
export const YEARS = 10;
const latency = +query.get('latency') || 0;
const runs = new Map(); // version -> { promise, resolve, reject }
const runFor = version => {
  if (!runs.has(version)) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); promise.catch(() => {}); runs.set(version, { promise, resolve, reject }); }
  return runs.get(version);
};
let timer, noPolicy = null; // noPolicy: the same models with no card, run once
function rerun() {
  clearTimeout(timer);
  const version = state.version;
  timer = setTimeout(async () => {
    const [zones, assumptions, baselines] = await dataReady;
    if (version !== state.version) return;
    for (const [v, run] of runs) if (v < version) { run.reject(new Error('stale scenario')); runs.delete(v); }
    let run;
    try {
      noPolicy ??= runModels([], {}, zones, assumptions, baselines).result;
      const m = runModels(state.cards, state.params, zones, assumptions, baselines);
      run = { result: withDeltas(m.result, noPolicy), noPolicy, averages: m.averages, households: simulate(m.inputs, assumptions, baselines) };
      runLuti({ policies: m.policies, landUse: m.landUse, assumptions, baselines });
    } catch (e) { return runFor(version).reject(e); }
    runFor(version).resolve(run);
    scenario.set({ result: run.result });
  }, 120);
}
// One step of a version's run: that year's { zoneStates, metrics }, plus the whole run for the layers that need more
// (the no-policy comparison, the household model's averages and households). Every step of a version shares one run.
export const predict = async (version, step) => {
  const run = await runFor(version).promise;
  if (latency) await new Promise(r => setTimeout(r, latency * (.5 + Math.random())));
  return { ...run.result.timeline[step], run };
};

// CH-LUTI runs 2 × 200 simulations (about a second), in a worker. While one run is busy only the newest request waits,
// and a result that a newer request has made stale is dropped.
const lutiWorker = new Worker(new URL('./luti-worker.js', import.meta.url), { type: 'module' });
let lutiBusy = false, lutiNext = null;
function runLuti(job) {
  if (lutiBusy) { lutiNext = job; return; }
  lutiBusy = true;
  lutiWorker.postMessage(job);
}
lutiWorker.onmessage = ({ data }) => {
  lutiBusy = false;
  if (lutiNext) { const job = lutiNext; lutiNext = null; return runLuti(job); }
  scenario.set({ luti: data });
};
lutiWorker.onerror = e => { lutiBusy = false; console.warn('CH-LUTI did not run, so its metrics stay empty.', e); };
rerun(); // the baseline, before any card is applied

// The shared clock, and the one animation loop that drives it. onFrame callbacks get the real seconds since the
// last frame (for the camera and other inspection) and the simulated seconds (for everything the clock freezes).
export const START_YEAR = 2026, YEAR_MS = 3000; // 1x: three seconds per simulated year (2x and 4x: 1.5 s and 0.75 s)
export const simClock = createClock({ steps: YEARS, predict, yearMs: YEAR_MS });
let clockVersion = 0;
scenario.subscribe(s => { if (s.version !== clockVersion) simClock.invalidate(clockVersion = s.version); }); // inputs only, not view state
const frames = new Set();
export const onFrame = fn => { frames.add(fn); return () => frames.delete(fn); };
let last = performance.now();
requestAnimationFrame(function loop(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), .25); last = now;
  const simDt = simClock.tick(dt);
  for (const fn of frames) fn(dt, simDt);
  requestAnimationFrame(loop);
});
