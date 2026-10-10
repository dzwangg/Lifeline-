// Hand-pixelled sprite atlas, painted in code: trees, shrubs, flowers, street furniture, people and
// contact shadows. Light comes from the top left everywhere, every sprite gets a dark outline, and
// each pixel is TEXEL metres, so sprites share one scale with the buildings.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { P, TEXEL, seeded } from './palette.js';
import { Pix, mix } from './textures.js';

const SIZE = 1024;

// Canopy palettes: [outline, dark, mid, light, glint].
const CANOPY = {
  oak: [P.leafDark, '#3d6e2c', P.leaf, P.leafLight, P.leafGlint],
  darkOak: ['#0f5a3a', '#16774a', '#22985a', '#4fc06a', '#9fec8a'],
  maple: ['#6e1d18', P.mapleDark, P.maple, P.mapleLight, '#f39a5a'],
  amber: ['#7a4512', P.amberDark, P.amber, P.amberLight, '#f8d27a'],
  golden: ['#4f7a12', '#8ab822', '#b6dc3a', '#d8f05e', '#f6ffb0'],
  blossom: ['#8e4f6a', P.blossomDark, P.blossom, P.blossomLight, '#ffffff'],
  birch: ['#1f7a5a', '#3fae74', '#6fd48a', '#a6f0a8', '#e2ffd8'],
  shrub: ['#11704f', '#1f9a5a', '#3fbf5a', '#7fe06a', '#c6ff9a'],
  pine: ['#163a28', P.pineDark, P.pine, P.pineLight, '#6fae7a'],
};

// Paints a blob canopy: overlapping discs, shaded by each pixel's offset from its disc centre.
function canopy(p, x0, y0, w, h, colors, discs, r, dots) {
  const [outline, dark, mid, light, glint] = colors, mask = new Uint8Array(w * h), tone = new Float32Array(w * h).fill(-9);
  for (const [cx, cy, rad] of discs) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x + .5 - cx, dy = y + .5 - cy, d = Math.hypot(dx, dy) / rad;
      if (d > 1) continue;
      const shade = (-dx - dy) / rad * .55 + (1 - d) * .45 + (r() - .5) * .25; // lit from the top left
      const k = y * w + x;
      mask[k] = 1; tone[k] = Math.max(tone[k], shade);
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (!mask[k]) continue;
    const edge = !mask[k - 1] || !mask[k + 1] || !mask[k - w] || !mask[k + w] || x === 0 || y === 0 || x === w - 1 || y === h - 1;
    const t = tone[k] + ((x + y) % 2 ? .06 : -.06); // ordered dither between bands
    p.set(x0 + x, y0 + y, edge ? outline : t > .62 ? glint : t > .3 ? light : t > -.05 ? mid : dark);
  }
  for (const [color, n] of dots ?? []) for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * w), y = Math.floor(r() * h);
    if (mask[y * w + x] && mask[y * w + x + 1] && mask[(y + 1) * w + x]) p.set(x0 + x, y0 + y, color);
  }
  return mask;
}

function trunk(p, x, y, w, h, light = P.woodLight, base = P.wood, dark = P.woodDark) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p.set(x + i, y + j, i === 0 ? light : i === w - 1 ? dark : base);
  p.set(x - 1, y + h - 1, dark); p.set(x + w, y + h - 1, dark); // root flare
}

// Outlines everything drawn inside a cell that still has no outline (trunks, furniture, people).
function outline(p, x0, y0, w, h, color = P.ink) {
  const solid = (x, y) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h && p.get(x, y) > 0;
  const add = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) add.push([x, y]);
  }
  for (const [x, y] of add) p.set(x, y, color);
}

export function spriteAtlas() {
  const p = new Pix(SIZE, SIZE, 909), sprites = {};
  let cx = 1, cy = 1, rowH = 0;
  // Registers a sprite of w x h pixels; meta: { sway, glow }. Painters draw with (x, y) at the cell's top left.
  const add = (name, w, h, paint, meta = {}) => {
    if (cx + w + 2 > SIZE) { cx = 1; cy += rowH + 3; rowH = 0; }
    paint(cx + 1, cy + 1, w, h);
    sprites[name] = { px: [cx + 1, cy + 1, w, h], w: w * TEXEL, h: h * TEXEL, ...meta };
    cx += w + 3; rowH = Math.max(rowH, h);
  };
  const r = seeded(77);

  // ---------- trees ----------
  const roundTree = (name, colors, W, H, trunkH, dots, trunkColors) => add(name, W, H, (x, y) => {
    const ch = H - trunkH + 2, discs = [];
    for (let k = 0; k < 11; k++) discs.push([W / 2 + (r() - .5) * W * .45, ch * .5 + (r() - .5) * ch * .35, Math.min(W, ch) * (.26 + r() * .12)]);
    discs.push([W / 2, ch / 2, Math.min(W, ch) * .42]);
    trunk(p, x + Math.floor(W / 2) - 2, y + H - trunkH - 2, 4, trunkH + 2, ...(trunkColors ?? []));
    canopy(p, x, y, W, ch, colors, discs, r, dots);
    outline(p, x - 1, y - 1, W + 2, H + 2, mix(colors[0], P.ink, .5));
  }, { sway: 1 });
  // Sized like real Piedmont trees: an oak is ~10 m across and ~13 m tall.
  roundTree('oak', CANOPY.oak, 48, 64, 14);
  roundTree('oakSmall', CANOPY.oak, 32, 42, 10);
  roundTree('oakDark', CANOPY.darkOak, 54, 70, 15);
  roundTree('maple', CANOPY.maple, 42, 56, 12);
  roundTree('amber', CANOPY.amber, 40, 54, 12);
  roundTree('golden', CANOPY.golden, 36, 50, 12);
  roundTree('dogwood', CANOPY.blossom, 30, 34, 8, [['#ffffff', 30]]);
  roundTree('magnolia', CANOPY.darkOak, 36, 46, 9, [['#fbf1dc', 40], ['#f2c9d6', 10]]);
  roundTree('birch', CANOPY.birch, 28, 52, 18, null, ['#f4efe4', '#ddd6c6', '#3a3a3a']);
  const pine = (name, W, H, tiers) => add(name, W, H, (x, y) => {
    trunk(p, x + Math.floor(W / 2) - 1, y + H - 5, 3, 5);
    const colors = CANOPY.pine, mask = new Uint8Array(W * H);
    for (let t = 0; t < tiers; t++) {
      const top = Math.floor(t * (H - 5) / (tiers + .6)), bot = Math.floor((t + 1.6) * (H - 5) / (tiers + .6)), half = (W / 2) * (.45 + .55 * (t + 1) / tiers);
      for (let j = top; j < bot; j++) {
        const hw = half * (j - top + 1) / (bot - top);
        for (let i = Math.floor(W / 2 - hw); i < Math.ceil(W / 2 + hw); i++) mask[j * W + i] = 1;
      }
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (!mask[j * W + i]) continue;
      const edge = !mask[j * W + i - 1] || !mask[j * W + i + 1] || !mask[(j - 1) * W + i] || !mask[(j + 1) * W + i];
      const lit = (W / 2 - i) / W + ((i + j) % 2 ? .05 : -.05);
      p.set(x + i, y + j, edge ? colors[0] : lit > .18 ? colors[3] : lit > -.05 ? colors[2] : colors[1]);
    }
    for (let k = 0; k < 6; k++) { const i = Math.floor(W / 2 - 3 + r() * 4), j = Math.floor(r() * (H - 8)); if (mask[j * W + i]) p.set(x + i, y + j, colors[4]); }
    outline(p, x - 1, y - 1, W + 2, H + 2, mix(colors[0], P.ink, .5));
  }, { sway: .5 });
  pine('pine', 28, 72, 5);
  pine('spruce', 22, 58, 6);
  pine('pineSmall', 16, 32, 3);

  // ---------- shrubs and flowers ----------
  const bush = (name, colors, W, H, dots) => add(name, W, H, (x, y) => {
    const discs = [[W * .3, H * .6, H * .45], [W * .7, H * .6, H * .45], [W * .5, H * .45, H * .5]];
    canopy(p, x, y, W, H, colors, discs, r, dots);
  }, { sway: .3 });
  bush('shrub', CANOPY.shrub, 8, 6);
  bush('shrubWide', CANOPY.shrub, 12, 6);
  bush('shrubPink', CANOPY.shrub, 9, 6, [[P.blossom, 6], ['#ffffff', 2]]);
  bush('shrubYellow', CANOPY.shrub, 9, 6, [[P.goldLight, 6]]);
  bush('shrubPurple', CANOPY.shrub, 9, 6, [['#9d7cc6', 6], ['#cdb6e6', 2]]);
  bush('boxwood', CANOPY.darkOak, 7, 6);
  const flowers = (name, petals) => add(name, 8, 4, (x, y) => {
    for (let i = 0; i < 8; i++) { p.set(x + i, y + 3, i % 2 ? P.leafDark : P.leaf); if (i % 2 === 0) p.set(x + i, y + 2, P.leaf); }
    for (let i = 0; i < 6; i++) { const fx = x + Math.floor(r() * 8), fy = y + Math.floor(r() * 2); p.set(fx, fy, r.pick(petals)); }
  }, { sway: .2 });
  flowers('tulipsRed', ['#d6402f', '#f05a45', '#f7d774']);
  flowers('tulipsYellow', ['#f2c93a', '#f7e27a', '#e08a2a']);
  flowers('tulipsPurple', ['#8e5fc0', '#b48ee0', '#f2a7c3']);
  flowers('daisies', ['#ffffff', '#fbf1dc', '#f7d774']);
  const daisy = (name, petal, petalDark, center) => add(name, 12, 16, (x, y) => {
    p.rect(x + 5, y + 8, 2, 8, P.leafDark); p.rect(x + 5, y + 8, 1, 8, P.leaf);
    p.rect(x + 1, y + 11, 4, 2, P.leaf); p.set(x + 1, y + 11, P.leafLight); p.rect(x + 7, y + 12, 4, 2, P.leaf);
    for (let a = 0; a < 8; a++) { const px = x + 6 + Math.round(Math.cos(a * Math.PI / 4) * 3.4), py = y + 5 + Math.round(Math.sin(a * Math.PI / 4) * 3.4); p.rect(px - 1, py - 1, 2, 2, a < 4 ? petal : petalDark); }
    p.rect(x + 5, y + 4, 2, 2, center); p.set(x + 5, y + 4, '#ffffff');
    p.set(x + 4, y + 2, '#ffffff'); // glossy glint
    outline(p, x - 1, y - 1, 14, 18, P.ink);
  }, { sway: .4 });
  daisy('daisyPink', '#ff8fcf', '#e45aa8', '#ffe14a');
  daisy('daisyBlue', '#6fc8ff', '#3a8fe0', '#fff27a');
  daisy('daisyWhite', '#ffffff', '#cfe8f5', '#ffc93a');
  add('topiary', 9, 10, (x, y) => {
    canopy(p, x, y, 9, 8, CANOPY.shrub, [[4.5, 4, 4.2]], r);
    p.set(x + 2, y + 2, '#ffffff'); p.set(x + 3, y + 2, '#ffffff'); p.set(x + 2, y + 3, '#ffffff'); // glossy highlight
    p.rect(x + 3, y + 8, 3, 2, '#5fc8f0'); p.rect(x + 3, y + 8, 3, 1, '#c8f4ff'); // glass planter
  }, { sway: .1 });
  add('fern', 6, 5, (x, y) => { for (let i = 0; i < 6; i++) for (let j = Math.abs(i - 2.5) | 0; j < 5; j++) p.set(x + i, y + j, (i + j) % 2 ? P.leafLight : P.leaf); }, { sway: .3 });
  add('rock', 5, 3, (x, y) => { p.rect(x, y + 1, 5, 2, P.stoneDark); p.rect(x + 1, y, 3, 2, P.stone); p.set(x + 1, y, P.stoneLight); outline(p, x - 1, y - 1, 7, 5); });

  // ---------- street furniture ----------
  add('lamp', 7, 30, (x, y) => {
    p.rect(x + 3, y + 5, 1, 24, '#2f4a3a'); p.rect(x + 2, y + 28, 3, 2, '#2f4a3a');
    p.rect(x + 1, y + 1, 5, 4, '#2f4a3a'); p.rect(x + 2, y + 2, 3, 3, '#ffe9a8'); p.set(x + 2, y + 2, '#fff8dc'); p.rect(x + 2, y, 3, 1, '#2f4a3a');
    outline(p, x - 1, y - 1, 9, 32);
  }, { glow: 1 });
  add('trafficLight', 9, 30, (x, y) => {
    p.rect(x + 2, y + 8, 1, 22, '#3a3a3a'); p.rect(x + 2, y + 8, 6, 1, '#3a3a3a');
    p.rect(x + 5, y + 2, 4, 9, '#2b2b2b'); p.set(x + 6, y + 3, '#e0412f'); p.set(x + 7, y + 3, '#e0412f'); p.set(x + 6, y + 6, '#6b5a1e'); p.set(x + 6, y + 9, '#2f6b3a');
    p.rect(x + 1, y + 29, 3, 1, '#3a3a3a');
    outline(p, x - 1, y - 1, 11, 32);
  });
  add('stopSign', 5, 12, (x, y) => { p.rect(x + 2, y + 4, 1, 8, '#8f8f8f'); p.rect(x, y, 5, 4, '#c8322a'); p.rect(x + 1, y + 1, 3, 1, P.paper); outline(p, x - 1, y - 1, 7, 14); });
  add('streetSign', 7, 13, (x, y) => { p.rect(x + 3, y + 3, 1, 10, '#8f8f8f'); p.rect(x, y, 7, 3, '#2f6b3a'); p.rect(x + 1, y + 1, 4, 1, P.paper); outline(p, x - 1, y - 1, 9, 15); });
  add('bench', 10, 5, (x, y) => {
    p.rect(x, y, 10, 1, P.woodLight); p.rect(x, y + 1, 10, 1, P.wood); p.rect(x, y + 2, 10, 1, P.woodLight);
    p.rect(x + 1, y + 3, 1, 2, '#3a3a3a'); p.rect(x + 8, y + 3, 1, 2, '#3a3a3a');
    outline(p, x - 1, y - 1, 12, 7);
  });
  add('bikeRack', 9, 4, (x, y) => { for (let k = 0; k < 3; k++) { p.rect(x + k * 3, y, 3, 1, '#7a8288'); p.set(x + k * 3, y + 1, '#7a8288'); p.set(x + k * 3 + 2, y + 1, '#7a8288'); p.set(x + k * 3, y + 2, '#7a8288'); p.set(x + k * 3 + 2, y + 2, '#7a8288'); } p.rect(x, y + 3, 9, 1, '#5e666b'); p.rect(x + 1, y + 1, 1, 2, '#c0392b'); });
  add('hydrant', 3, 4, (x, y) => { p.rect(x, y + 1, 3, 3, '#c8322a'); p.rect(x + 1, y, 1, 1, '#c8322a'); p.set(x, y + 1, '#e2643f'); outline(p, x - 1, y - 1, 5, 6); });
  add('mailbox', 4, 6, (x, y) => { p.rect(x + 1, y + 3, 1, 3, P.woodDark); p.rect(x, y, 4, 3, '#2f5f8f'); p.set(x + 3, y, '#c8322a'); outline(p, x - 1, y - 1, 6, 8); });
  add('trash', 4, 5, (x, y) => { p.rect(x, y + 1, 4, 4, '#3f6b4f'); p.rect(x, y, 4, 1, '#2b4a36'); p.set(x, y + 2, '#5a8a6a'); outline(p, x - 1, y - 1, 6, 7); });
  add('busStop', 20, 13, (x, y) => {
    p.rect(x, y, 20, 2, '#2f5f8f'); p.rect(x + 1, y + 2, 1, 11, '#3a3a3a'); p.rect(x + 18, y + 2, 1, 11, '#3a3a3a');
    p.rect(x + 2, y + 2, 16, 8, '#bfe3ef'); p.rect(x + 2, y + 2, 16, 2, '#e8f6fb');
    p.rect(x + 4, y + 9, 10, 1, P.woodLight); p.rect(x + 4, y + 10, 1, 2, '#3a3a3a'); p.rect(x + 13, y + 10, 1, 2, '#3a3a3a');
    p.rect(x + 3, y + 3, 4, 5, P.goldLight); // timetable
    outline(p, x - 1, y - 1, 22, 15);
  });
  add('picnic', 10, 5, (x, y) => { p.rect(x, y, 10, 2, P.woodLight); p.rect(x, y + 1, 10, 1, P.wood); p.rect(x + 1, y + 2, 1, 3, P.woodDark); p.rect(x + 8, y + 2, 1, 3, P.woodDark); p.rect(x - 0, y + 3, 10, 1, P.wood); outline(p, x - 1, y - 1, 12, 7); });
  add('headstone', 3, 4, (x, y) => { p.rect(x, y + 1, 3, 3, P.stone); p.set(x + 1, y, P.stone); p.set(x, y + 1, P.stoneLight); outline(p, x - 1, y - 1, 5, 6); });
  add('planter', 8, 5, (x, y) => { p.rect(x, y + 2, 8, 3, P.terracotta); p.rect(x, y + 2, 8, 1, P.terracottaLight); for (let i = 0; i < 8; i++) { p.set(x + i, y + 1, i % 2 ? P.leafLight : P.leaf); if (i % 3 === 0) p.set(x + i, y, P.blossom); } outline(p, x - 1, y - 1, 10, 7); }, { sway: .2 });
  add('shadow', 16, 8, (x, y) => { for (let j = 0; j < 8; j++) for (let i = 0; i < 16; i++) { const d = ((i - 7.5) / 8) ** 2 + ((j - 3.5) / 4) ** 2; if (d < 1 && (d < .55 || (i + j) % 2)) p.set(x + i, y + j, '#000000'); } });

  // ---------- people: two-frame walk cycle ----------
  const SKIN = ['#f1c9a5', '#d9a07a', '#a9714e', '#7a4f33', '#5a3a26'], HAIR = ['#2b1d16', '#5e3a22', '#b5801f', '#8e2f2a', '#d8d2c6'];
  const SHIRT = ['#c0392b', '#2f5f8f', '#3f6b4f', '#e8b33c', '#6e4f7f', '#ece8df', '#d98b6a', '#4f9dc9', '#7b2d2d', '#5e6b4f'];
  const PANTS = ['#2f3a55', '#3a3a3a', '#6b4a2b', '#4f6b8f', '#7a6a4a'];
  let k = 0;
  for (const shirt of SHIRT) for (let frame = 0; frame < 2; frame++, k++) {
    const skin = SKIN[k % SKIN.length], hair = HAIR[(k * 3) % HAIR.length], pants = PANTS[(k * 7) % PANTS.length];
    add(`person${Math.floor(k / 2)}_${frame}`, 4, 9, (x, y) => {
      p.rect(x + 1, y, 2, 1, hair); p.rect(x + 1, y + 1, 2, 2, skin); p.set(x + 1, y + 1, hair);
      p.rect(x, y + 3, 4, 3, shirt); p.set(x, y + 5, skin); p.set(x + 3, y + 5, skin);
      p.rect(x + 1, y + 6, 2, 1, pants);
      if (frame) { p.set(x + 1, y + 7, pants); p.set(x + 2, y + 8, pants); p.set(x + 1, y + 8, '#2b2b2b'); }
      else { p.set(x + 1, y + 7, pants); p.set(x + 2, y + 7, pants); p.set(x + 1, y + 8, '#2b2b2b'); p.set(x + 2, y + 8, '#2b2b2b'); }
      outline(p, x - 1, y - 1, 6, 11);
    });
  }

  const texture = p.texture({ repeat: false, flipY: false });
  texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  for (const s of Object.values(sprites)) {
    const [x, y, w, h] = s.px;
    s.uv = [x / SIZE, y / SIZE, (x + w) / SIZE, (y + h) / SIZE];
  }
  return { texture, sprites, people: k / 2 };
}

export const TREE_KINDS = {
  street: ['oak', 'oakSmall', 'maple', 'dogwood', 'magnolia', 'oak', 'amber'],
  park: ['oak', 'oakDark', 'maple', 'golden', 'dogwood', 'birch', 'pine', 'amber', 'oak'],
  wood: ['oakDark', 'oak', 'pine', 'spruce', 'oakDark', 'pine', 'amber', 'golden', 'maple'],
  yard: ['oakSmall', 'dogwood', 'maple', 'magnolia', 'birch', 'pineSmall', 'golden'],
};
export const SHRUBS = ['shrub', 'shrubWide', 'shrubPink', 'shrubYellow', 'shrubPurple', 'boxwood', 'topiary'];
export const FLOWERS = ['tulipsRed', 'tulipsYellow', 'tulipsPurple', 'daisies', 'daisyPink', 'daisyBlue', 'daisyWhite'];

// Each tree's canopy as one colour, for far zooms where a tree is a disc: its palette's dark tone, so woods
// stand out from the lawn, and autumn trees keep a hint of their colour.
const CANOPY_OF = { oak: 'oak', oakSmall: 'oak', oakDark: 'darkOak', magnolia: 'darkOak', maple: 'maple', amber: 'amber', golden: 'golden', dogwood: 'blossom', birch: 'birch', pine: 'pine', spruce: 'pine', pineSmall: 'pine' };
const TONES = Object.fromEntries(Object.entries(CANOPY_OF).map(([name, c]) => [name, new THREE.Color(mix(CANOPY[c][1], P.leafDark, .45))]));
export const canopyTone = name => TONES[name] ?? TONES.oak;
