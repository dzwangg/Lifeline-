// Runs scenarios off the main thread so the city keeps animating while 400 simulations run.
import { runScenario } from './run.js';
import { simulate, midParams } from './model.js';

self.onmessage = ({ data: { id, policies, runs, seed } }) => {
  const t0 = performance.now();
  const result = runScenario(policies, { runs, seed });
  // a live check the dashboard shows: how far rents move when the stock grows 1% (literature: about −0.19)
  const p = midParams(), base = simulate(p, [], { seedEvents: false }).series, shock = simulate(p, [], { seedEvents: false, shock: { units: 0.01 } }).series;
  result.checks = { rentToSupply: (shock[20].rent / base[20].rent - 1) / 0.01 };
  self.postMessage({ id, result, ms: performance.now() - t0 });
};
