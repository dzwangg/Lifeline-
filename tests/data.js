// The committed data files plus the stub card, shared by the tests and scripts/sim-fixture.js.
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
export const stub = read('./fixtures/stub-card.json');
export const zones = read('../data/zones.geojson').features.map(f => ({ ...f.properties, geometry: f.geometry }));
export const assumptions = read('../data/assumptions.json');
export const baselines = read('../data/baselines.json');
export const cards = read('../data/cards.index.json').map(path => read(`../data/${path}`));
