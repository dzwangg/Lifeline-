import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Footprints, ringDist, crownOf, TRUNK_CLEAR, CROWN_CLEAR } from '../meridian-city/world/clearance.js';

// A 10 m square house, 8 m tall, with its corner at the origin; and sprites shaped like the atlas's (metres).
const house = [0, 0, 10, 0, 10, 10, 0, 10];
const oak = { w: 9.6, h: 12.8, crownBase: 2.4 }, shrub = { w: 1.6, h: 1.2 };

test('ringDist is the signed distance to a ring: negative inside', () => {
  assert.equal(ringDist(house, 5, 5), -5);
  assert.equal(ringDist(house, 13, 5), 3);
  assert.ok(Math.abs(ringDist(house, 13, 14) - 5) < 1e-9);
});

test('a tree fits only where its drawn crown stays clear of the walls', () => {
  const f = new Footprints();
  f.add(house, 8);
  const { r } = crownOf(oak);
  assert.equal(f.fits(5, 5, oak), false, 'trunk inside');
  assert.equal(f.fits(10 + TRUNK_CLEAR / 2, 5, oak), false, 'trunk against the wall');
  assert.equal(f.fits(10 + r, 5, oak), false, 'crown touching the wall');
  assert.equal(f.fits(10 + r + CROWN_CLEAR + .01, 5, oak), true, 'crown clear');
  assert.equal(f.fits(30, 30, oak), true, 'far away');
});

test('small plants only keep their own width off the wall', () => {
  const f = new Footprints();
  f.add(house, 8);
  assert.equal(f.fits(10 + TRUNK_CLEAR + .1, 5, shrub), true);
  assert.equal(f.fits(10.3, 5, shrub), false);
});

test('a crown may overhang a building well below it, never its trunk', () => {
  const f = new Footprints();
  f.add(house, 1.5); // a low shed: the oak's crown starts ~2.9 m up
  assert.equal(f.fits(10 + TRUNK_CLEAR + .1, 5, oak), true);
  assert.equal(f.fits(10.5, 5, oak), false);
});

test('fitScale shrinks a tree to fit beside a wall, or gives up', () => {
  const f = new Footprints();
  f.add(house, 8);
  const x = 10 + 3.2, s = f.fitScale(x, 5, oak, 1.2, .5);
  assert.ok(s > 0 && s < 1.2);
  assert.equal(f.fits(x, 5, oak, s), true);
  assert.equal(f.fitScale(10.5, 5, oak, 1.2, .5), 0);
  assert.equal(f.fitScale(40, 5, oak, 1.2, .5), 1.2);
});

test('footprints spanning many hash cells, and queries across cell borders, are found', () => {
  const f = new Footprints(8), big = [-50, -50, 50, -50, 50, 50, -50, 50];
  f.add(big, 20);
  for (const [x, z] of [[0, 0], [52, 0], [-52, 31], [0, 53.5]]) assert.equal(f.fits(x, z, oak), false, `${x},${z}`);
  assert.equal(f.fits(60, 60, oak), true);
});
