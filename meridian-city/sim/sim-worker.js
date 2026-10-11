// Runs the three models (shared/combined.js) off the main thread, so the city builds and plays without stalls.
// The no-policy run every change is compared with is the same for every scenario of a length, so it runs once per length
// (a game of turns adds a decade a turn).
import { runModels, withDeltas } from '../../shared/combined.js';
import { simulate } from '../../shared/agents.js';

const noPolicy = new Map(); // years -> SimResult
self.onmessage = ({ data: { version, cards, params, years, starts, zones, assumptions, baselines } }) => {
  try {
    if (!noPolicy.has(years)) noPolicy.set(years, runModels([], {}, zones, assumptions, baselines, { years }).result);
    const none = noPolicy.get(years), m = runModels(cards, params, zones, assumptions, baselines, { years, starts });
    self.postMessage({
      version,
      run: { result: withDeltas(m.result, none), noPolicy: none, averages: m.averages, households: simulate(m.inputs, assumptions, baselines) },
      luti: { policies: m.policies, landUse: m.landUse, quarters: 4 * years },
    });
  } catch (e) {
    self.postMessage({ version, error: e.message });
  }
};
