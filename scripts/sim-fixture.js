// Writes tests/fixtures/sim-result.json: the stub card at its default params, a sample SimResult for the narration pipeline.
// Usage: npm run fixture
import { writeFileSync } from 'node:fs';
import { runScenario } from '../shared/sim.js';
import { stub, zones, assumptions, baselines } from '../tests/data.js';

writeFileSync(new URL('../tests/fixtures/sim-result.json', import.meta.url), JSON.stringify(runScenario([stub], {}, zones, assumptions, baselines), null, 2) + '\n');
console.log('Wrote tests/fixtures/sim-result.json');
