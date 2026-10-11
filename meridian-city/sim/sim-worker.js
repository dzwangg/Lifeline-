// Runs the three models (shared/combined.js) off the main thread, so the city builds and plays without stalls.
// The no-policy run every change is compared with is the same for every scenario, so it runs once.
import { runModels, withDeltas } from '../../shared/combined.js';
import { simulate } from '../../shared/agents.js';

let noPolicy = null;
self.onmessage = ({ data: { version, cards, params, zones, assumptions, baselines } }) => {
  try {
    noPolicy ??= runModels([], {}, zones, assumptions, baselines).result;
    const m = runModels(cards, params, zones, assumptions, baselines);
    self.postMessage({
      version,
      run: { result: withDeltas(m.result, noPolicy), noPolicy, averages: m.averages, households: simulate(m.inputs, assumptions, baselines) },
      luti: { policies: m.policies, landUse: m.landUse },
    });
  } catch (e) {
    self.postMessage({ version, error: e.message });
  }
};
