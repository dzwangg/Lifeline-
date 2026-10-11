import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { paintPeopleAtlas } from '../meridian-city/world/people-art.js';
import { atlasIndex } from '../scripts/bake-people-atlas.js';

const baked = name => readFileSync(new URL(`../meridian-city/world/baked/${name}`, import.meta.url));

// Reads the PNGs bake-people-atlas.js writes: 8-bit RGBA, every row unfiltered.
function decodePng(png) {
  let width = 0, height = 0;
  const idat = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o), type = png.toString('ascii', o + 4, o + 8), body = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(body);
    o += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat)), data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 4 + 1)], 0, 'unfiltered rows');
    data.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, data };
}

test('the baked people atlas matches what people-art.js paints (run npm run bake if not)', () => {
  const art = paintPeopleAtlas(), png = decodePng(baked('people-atlas.png'));
  assert.equal(png.width, art.size);
  assert.equal(png.height, art.size);
  assert.ok(Buffer.from(png.data).equals(Buffer.from(art.data.buffer)), 'pixels differ');
  assert.deepEqual(JSON.parse(baked('people-atlas.json')), JSON.parse(JSON.stringify(atlasIndex(art))));
});
