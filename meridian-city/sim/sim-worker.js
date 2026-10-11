// Runs the three models (shared/combined.js) off the main thread, so the city builds and plays without stalls.
// The no-policy run every change is compared with is the same for every scenario of a length, so it runs once per length
// (a game of turns adds a decade a turn).
import { runModels, withDeltas } from '../../shared/combined.js';
import { simulate } from '../../shared/agents.js';

// Scenario drivers (inflation and the other what-ifs) change that run too, so it is kept per length and set of drivers.
const noPolicy = new Map(); // years and drivers -> SimResult
self.onmessage = ({ data: { version, cards, params, years, starts, drivers = null, zones, assumptions, baselines } }) => {
  try {
    const key = JSON.stringify([years, drivers ?? {}]);
    if (!noPolicy.has(key)) noPolicy.set(key, runModels([], {}, zones, assumptions, baselines, { years, drivers }).result);
    const none = noPolicy.get(key), m = runModels(cards, params, zones, assumptions, baselines, { years, starts, drivers });
    self.postMessage({
      version,
      run: { result: withDeltas(m.result, none), noPolicy: none, averages: m.averages, households: simulate(m.inputs, assumptions, baselines) },
      luti: { policies: m.policies, landUse: m.landUse, quarters: 4 * years, drivers },
    });
  } catch (e) {
    self.postMessage({ version, error: e.message });
  }
};
