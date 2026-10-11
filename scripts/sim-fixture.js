// Writes tests/fixtures/sim-result.json: the stub card at its default params, a sample SimResult for the narration pipeline.
// It is the full SimResult (shared/combined.js), as the sim panel shows it.
// Usage: npm run fixture
import { writeFileSync } from 'node:fs';
import { runCombined } from '../shared/combined.js';
import { stub, zones, assumptions, baselines } from '../tests/data.js';

writeFileSync(new URL('../tests/fixtures/sim-result.json', import.meta.url), JSON.stringify(runCombined([stub], {}, zones, assumptions, baselines), null, 2) + '\n');
console.log('Wrote tests/fixtures/sim-result.json');
