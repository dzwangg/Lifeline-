// Runs the three models (shared/combined.js) off the main thread, so the city builds and plays without stalls.
// The no-policy run every change is compared with is the same for every scenario, so it runs once.
import { runModels, withDeltas } from '../../shared/combined.js';
import { simulate } from '../../shared/agents.js';

// Scenario drivers (inflation and the other what-ifs) change that run too, so it is kept per set of drivers.
const noPolicy = new Map();
self.onmessage = ({ data: { version, cards, params, zones, assumptions, baselines, drivers = null } }) => {
  try {
    const key = JSON.stringify(drivers ?? {});
    if (!noPolicy.has(key)) noPolicy.set(key, runModels([], {}, zones, assumptions, baselines, drivers).result);
    const none = noPolicy.get(key);
    const m = runModels(cards, params, zones, assumptions, baselines, drivers);
    self.postMessage({
      version,
      run: { result: withDeltas(m.result, none), noPolicy: none, averages: m.averages, households: simulate(m.inputs, assumptions, baselines) },
      luti: { policies: m.policies, landUse: m.landUse, drivers },
    });
  } catch (e) {
    self.postMessage({ version, error: e.message });
  }
};
