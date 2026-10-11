import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { zones } from './data.js';
import { toLocal } from '../shared/geo.js';

// world/geometry.js imports three.js from the CDN; Grid doesn't use it, so the import resolves to an empty module here.
register(`data:text/javascript,${encodeURIComponent("export async function resolve(s, c, next) { return s.startsWith('https://') ? { url: 'data:text/javascript,export {}', shortCircuit: true } : next(s, c); }")}`);
const { Grid, inside, bounds } = await import('../meridian-city/world/geometry.js');

// The cells fillRing used to mark: every cell in the ring's bounding box whose centre inside() accepts.
function bruteFill(grid, r, bit) {
  const [x0, z0, x1, z1] = bounds(r), { cell: c, ext, n } = grid;
  const i0 = Math.max(0, Math.floor((x0 + ext) / c)), i1 = Math.min(n - 1, Math.floor((x1 + ext) / c));
  const j0 = Math.max(0, Math.floor((z0 + ext) / c)), j1 = Math.min(n - 1, Math.floor((z1 + ext) / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inside(r, (i + .5) * c - ext, (j + .5) * c - ext)) grid.bits[j * n + i] |= bit;
}

test('fillRing marks exactly the cells whose centres are inside the ring', () => {
  const rings = [
    ...zones.map(z => z.geometry.coordinates[0].slice(0, -1).flatMap(toLocal)),
    [0, 0, 10, 0, 10, 10, 5, 3, 0, 10], // concave
    [.5, .5, 8.5, .5, 8.5, 6.5, .5, 6.5], // edges and vertices on cell centres
    [-3, -3, 3, -3, 3, 3, 1, 3, 1, -1, -1, -1, -1, 3, -3, 3], // a U
    [-1418, -1418, -1300, -1418, -1300, -1300], // off the grid's edge
  ];
  for (const cell of [1, 2]) {
    const a = new Grid(1400, cell), b = new Grid(1400, cell);
    for (const r of rings) { a.fillRing(r, 4); bruteFill(b, r, 4); }
    assert.ok(a.bits.some(Boolean), 'nothing marked');
    assert.ok(Buffer.from(a.bits).equals(Buffer.from(b.bits)), `${cell} m cells differ`);
  }
});
