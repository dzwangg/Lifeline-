// Paints the street-life people atlas (meridian-city/world/people-art.js) once and writes it next to the world as a
// PNG and a JSON index, so the page loads it instead of painting it, which takes most of a second. Run after changing
// people-art.js or the palette: npm run bake. tests/people-atlas.test.js fails while the baked copy is out of date.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { paintPeopleAtlas } from '../meridian-city/world/people-art.js';

const OUT = new URL('../meridian-city/world/baked/', import.meta.url);

// RGBA rows, each with filter type 0 (none), in one zlib stream.
export function encodePng(data, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), head = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    len.writeUInt32BE(body.length);
    crc.writeUInt32BE(crc32(head));
    return Buffer.concat([len, head, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// The index: every sprite, and the lookup table by name (the page rebuilds the references).
export function atlasIndex(art) {
  const name = new Map(Object.entries(art.sprites).map(([k, s]) => [s, k]));
  return { size: art.size, sprites: art.sprites, table: Object.fromEntries(Object.entries(art.table).map(([lod, looks]) => [lod, looks.map(dirs => dirs.map(frames => frames.map(s => name.get(s))))])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const art = paintPeopleAtlas();
  mkdirSync(OUT, { recursive: true });
  const png = encodePng(art.data, art.size, art.size);
  writeFileSync(new URL('people-atlas.png', OUT), png);
  writeFileSync(new URL('people-atlas.json', OUT), JSON.stringify(atlasIndex(art)));
  console.log(`Wrote meridian-city/world/baked/people-atlas.png (${(png.length / 1024).toFixed(0)} KB) and people-atlas.json.`);
}
