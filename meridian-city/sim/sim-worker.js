// Runs the three models (shared/combined.js) off the main thread, so the city builds and plays without stalls.
// The no-policy run every change is compared with is the same for every scenario of a length, so it runs once per length
// (a game of turns adds a decade a turn).
import { runModels, withDeltas } from '../../shared/combined.js';
import { simulate } from '../../shared/agents.js';

// Scenario drivers (inflation and the other what-ifs) change that run too, so it is kept per length and set of drivers:
// the most recently used KEEP of them, as each holds every year's parcel states and a player can try many what-ifs.
const KEEP = 8;
const noPolicy = new Map(); // years and drivers -> SimResult, oldest use first
function baselineFor(years, drivers, zones, assumptions, baselines) {
  const key = JSON.stringify([years, drivers ?? {}]);
  const none = noPolicy.get(key) ?? runModels([], {}, zones, assumptions, baselines, { years, drivers }).result;
  noPolicy.delete(key);
  noPolicy.set(key, none);
  if (noPolicy.size > KEEP) noPolicy.delete(noPolicy.keys().next().value);
  return none;
}
self.onmessage = ({ data: { version, cards, params, years, starts, drivers = null, zones, assumptions, baselines } }) => {
  try {
    const none = baselineFor(years, drivers, zones, assumptions, baselines), m = runModels(cards, params, zones, assumptions, baselines, { years, starts, drivers });
    self.postMessage({
      version,
      run: { result: withDeltas(m.result, none), noPolicy: none, averages: m.averages, households: simulate(m.inputs, assumptions, baselines) },
      luti: { policies: m.policies, landUse: m.landUse, quarters: 4 * years, drivers },
    });
  } catch (e) {
    self.postMessage({ version, error: e.message });
  }
};
