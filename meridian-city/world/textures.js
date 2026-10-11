// Pixel-art textures painted pixel by pixel from the shared palette: facades, ground floors, roofs,
// ground surfaces, streets, water, and an atlas of building details. Magnified, every texel stays a crisp square
// (nearest filtering). Minified, each mip level is still sampled nearest, but neighbouring levels are blended and the
// GPU's anisotropic filtering covers the camera's slant, so distant ground and roofs settle into their average colour
// instead of shimmering or popping between levels. Atlases pad every region (see TileAtlas, detailAtlas), so mipmaps
// never bleed one region's colour into the next.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { P, WALLS, ROOFS, TEXEL, BAY, STOREY, AERO, AERO_BUILD as K, RENDER, seeded } from './palette.js';

// The GPU's anisotropy, capped by RENDER.anisotropy; world.js sets it from the renderer before any texture is made.
let anisotropy = 1;
export function setAnisotropy(n) { anisotropy = Math.max(1, Math.min(n, RENDER.anisotropy)); }
// Mip filtering for a pixel texture: nearest within a level, blended between levels, anisotropic at a slant.
export function pixelFiltering(t, { aniso = true } = {}) {
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.generateMipmaps = true;
  if (aniso) t.anisotropy = anisotropy;
  return t;
}

const rgbCache = new Map();
const rgb = hex => {
  if (!rgbCache.has(hex)) { const n = parseInt(hex.slice(1), 16); rgbCache.set(hex, [n >> 16 & 255, n >> 8 & 255, n & 255]); }
  return rgbCache.get(hex);
};
export const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

// A tiny pixel canvas over raw ImageData.
export class Pix {
  constructor(w, h, seed = 1) {
    this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4); this.rnd = seeded(seed);
  }
  set(x, y, hex, a = 255) {
    if (hex === null) { if (this.under) this.set(x, y, this.under); return; }
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = rgb(hex), i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }
  get(x, y) { const i = ((y | 0) * this.w + (x | 0)) * 4; return this.data[i + 3]; }
  rect(x, y, w, h, hex, a) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, hex, a); }
  // Copies each edge of a region outward by pad pixels, so filtering and mipmaps at the region's edge find its own colour.
  extrude(x0, y0, w, h, pad) {
    const d = this.data, W = this.w, copy = (sx, sy, tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= W || ty >= this.h) return;
      const a = (sy * W + sx) * 4, b = (ty * W + tx) * 4;
      if (d[b + 3]) return; // never over another region's paint
      d[b] = d[a]; d[b + 1] = d[a + 1]; d[b + 2] = d[a + 2]; d[b + 3] = d[a + 3];
    };
    for (let y = y0 - pad; y < y0 + h + pad; y++) for (let x = x0 - pad; x < x0 + w + pad; x++) {
      if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) continue;
      copy(Math.min(Math.max(x, x0), x0 + w - 1), Math.min(Math.max(y, y0), y0 + h - 1), x, y);
    }
  }
  // Wrapping set for seamless tiles.
  wset(x, y, hex) { this.set(((x % this.w) + this.w) % this.w, ((y % this.h) + this.h) % this.h, hex); }
  canvas() {
    const c = document.createElement('canvas'); c.width = this.w; c.height = this.h;
    c.getContext('2d').putImageData(new ImageData(this.data, this.w, this.h), 0, 0);
    return c;
  }
  // Repeating texture where one texture pixel covers `texel` metres.
  texture({ texel = TEXEL, repeat = true, flipY = true } = {}) {
    const t = pixelFiltering(new THREE.CanvasTexture(this.canvas()));
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = flipY;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / (this.w * texel), 1 / (this.h * texel)); }
    return t;
  }
}

// ---------- walls ----------
function paintWall(p, w, x0, y0, W, H) {
  const r = p.rnd;
  for (let y = y0; y < y0 + H; y++) for (let x = x0; x < x0 + W; x++) {
    let c = w.base;
    switch (w.kind) {
      case 'siding': { const k = y % 3; c = k === 2 ? w.dark : k === 0 && r() < .5 ? w.light : w.base; break; }
      case 'brick': {
        const row = Math.floor(y / 3), off = row % 2 ? 3 : 0, brick = Math.floor((x + off) / 6);
        if (y % 3 === 2 ? (x + row) % 2 === 0 : (x + off) % 6 === 5 && y % 3 === 0) c = w.mortar;
        else { const s = (brick * 13 + row * 7) % 5; c = s === 0 ? w.dark : s === 3 ? w.light : w.base; }
        break;
      }
      case 'stucco': c = r() < .07 ? w.dark : r() < .07 ? w.light : w.base; break;
      case 'stone': { const row = Math.floor(y / 4), off = row % 2 ? 3 : 0; c = y % 4 === 3 || (x + off) % 7 === 6 ? w.dark : r() < .1 ? w.light : w.base; break; }
      case 'panel': c = x % BAY_PX === 0 || y % 17 === 16 ? w.dark : r() < .04 ? w.light : w.base; break;
      case 'metal': c = x % 3 === 0 ? w.dark : x % 3 === 1 ? w.light : w.base; break;
      case 'planks': c = x % 4 === 3 ? w.dark : r() < .08 ? w.light : w.base; break;
      case 'pearl': { // glossy white, stepped per storey: bright under the slab, shade at the foot, panel seams
        const fy = y % FLOOR_PX;
        c = fy === FLOOR_PX - 1 ? w.accent : fy < 2 ? w.light : fy >= FLOOR_PX - 3 ? w.dark : w.base;
        if (x % (BAY_PX * 2) === 0 && fy < FLOOR_PX - 1) c = w.dark;
        break;
      }
      case 'curtain': { // glass curtain wall: white mullions and slabs, sky gradient, diagonal glints
        const fy = y % FLOOR_PX;
        if (x % BAY_PX === 0 || fy === FLOOR_PX - 1) c = '#f4fbff';
        else if ((x + y) % 29 < 2 || (x + y) % 29 === 5) c = w.light;
        else c = fy < 5 ? w.light : fy < 11 ? w.base : w.dark;
        if (fy === FLOOR_PX - 2) c = '#cfe4ee';
        break;
      }
    }
    p.set(x, y, c);
  }
}
const BAY_PX = Math.round(BAY / TEXEL);       // 15 px per bay
const FLOOR_PX = Math.round(STOREY / TEXEL);  // 17 px per storey
const GROUND_PX = 20;                         // 4 m ground floor
const [G0, G1, G2, G3] = K.glass, [L0, L1, L2] = K.lit;

// An Aero window pane: a pixel-rounded pearl frame with a stepped shade, a four-step glass ramp, a diagonal
// glint and a glossy corner highlight; lit is the chance the room behind it is warmly lit.
function pane(p, wx, wy, ww, wh, lit, { mullion = true, round = true } = {}) {
  const warm = p.rnd() < lit;
  p.rect(wx - 1, wy - 1, ww + 2, wh + 2, K.frame);
  p.rect(wx + ww, wy, 1, wh + 1, K.frameShade); p.rect(wx, wy + wh, ww + 1, 1, K.frameShade);
  if (round) for (const [cx, cy] of [[wx - 1, wy - 1], [wx + ww, wy - 1], [wx - 1, wy + wh], [wx + ww, wy + wh]]) p.set(cx, cy, null);
  for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) {
    const t = j / wh;
    let c = warm ? (t < .34 ? L0 : t < .7 ? L1 : L2) : (t < .2 ? G0 : t < .45 ? G1 : t < .75 ? G2 : G3);
    if (!warm && (i + j) % 7 === 0 && j < wh - 1) c = G0;
    if (warm && j > wh * .55 && (i === 0 || i === ww - 1)) c = '#e8a89a'; // curtain edges
    p.set(wx + i, wy + j, c);
  }
  if (mullion && ww >= 5) p.rect(wx + Math.floor(ww / 2), wy, 1, wh, K.frame);
  if (mullion && wh >= 7) p.rect(wx, wy + Math.floor(wh * .45), ww, 1, K.frame);
  p.set(wx, wy, '#ffffff'); p.set(wx + 1, wy, '#ffffff');
}

// One window inside a bay cell. (x, y) is the cell's top-left; the cell is BAY_PX x fh.
function paintWindow(p, style, x, y, fh, accent, wall, lit) {
  const r = p.rnd, cx = x + Math.floor(BAY_PX / 2);
  switch (style) {
    case 'shutter': { // houses: pastel shutters and, often, a flower box
      const ww = 5, wh = 7, wx = cx - 2, wy = y + 4;
      pane(p, wx, wy, ww, wh, lit);
      p.rect(wx - 3, wy - 1, 2, wh + 2, accent); p.rect(wx - 3, wy - 1, 1, wh + 2, '#ffffff'); p.rect(wx + ww + 1, wy - 1, 2, wh + 2, accent);
      if (r() < .45) {
        p.rect(wx - 1, wy + wh + 1, ww + 2, 2, K.planter[0]); p.rect(wx - 1, wy + wh + 2, ww + 2, 1, K.planter[2]);
        p.rect(wx, wy + wh, ww, 1, P.leaf); p.set(wx + 1, wy + wh, P.blossom); p.set(wx + 3, wy + wh, '#6fc8ff');
      } else p.rect(wx - 1, wy + wh + 1, ww + 2, 1, K.trimShade);
      break;
    }
    case 'sill': { // apartments and upper shop floors
      const ww = 6, wh = 8, wx = cx - 3, wy = y + 4;
      pane(p, wx, wy, ww, wh, lit);
      p.rect(wx - 2, wy + wh + 1, ww + 4, 1, K.trim); p.rect(wx - 2, wy + wh + 2, ww + 4, 1, K.trimShade);
      break;
    }
    case 'colonial': { // campus brick: white Georgian heads, keystone and sill around Aero glass
      const ww = 6, wh = 9, wx = cx - 3, wy = y + 4;
      pane(p, wx, wy, ww, wh, lit, { round: false });
      for (let j = 3; j < wh; j += 3) p.rect(wx, wy + j, ww, 1, K.frame);
      p.rect(wx - 1, wy - 3, ww + 2, 2, K.trim); p.rect(wx - 1, wy - 2, ww + 2, 1, K.trimShade); p.set(cx, wy - 3, '#eafcff');
      p.rect(wx - 1, wy + wh + 1, ww + 2, 1, K.trim);
      break;
    }
    case 'band': { // offices: a continuous glass band with white mullions
      const wy = y + 4, wh = 9;
      for (let j = 0; j < wh; j++) for (let i = 0; i < BAY_PX; i++) {
        const t = j / wh;
        p.set(x + i, wy + j, i % 5 === 0 ? K.frame : (i + j) % 9 === 0 ? G0 : t < .25 ? G1 : t < .7 ? G2 : G3);
      }
      if (r() < lit) p.rect(x + 1 + Math.floor(r() * 9), wy + 3, 4, wh - 4, L1);
      p.rect(x, wy + wh, BAY_PX, 1, K.trim);
      break;
    }
    case 'tall': { // civic: tall windows with a rounded head
      const ww = 5, wh = Math.min(fh - 5, 12), wx = cx - 2, wy = y + 3;
      pane(p, wx, wy, ww, wh, lit);
      p.rect(wx - 1, wy - 2, ww + 2, 1, K.trim); p.set(wx - 1, wy - 2, null); p.set(wx + ww, wy - 2, null);
      break;
    }
    case 'strip': {
      const wy = y + 3;
      p.rect(x + 1, wy, BAY_PX - 2, 3, G2); p.rect(x + 1, wy, BAY_PX - 2, 1, G0); p.rect(x + 1, wy + 3, BAY_PX - 2, 1, K.trim);
      break;
    }
    case 'parking': {
      p.rect(x, y + 6, BAY_PX, fh - 9, '#3a4a66');
      for (let i = 1; i < BAY_PX; i += 4) p.set(x + i, y + fh - 4, '#6c7f9e');
      p.rect(x, y + fh - 3, BAY_PX, 1, wall.light); p.rect(x, y + 5, BAY_PX, 1, '#3fb6e8');
      if (r() < .4) p.rect(x + 3, y + fh - 6, 6, 2, r.pick(['#ff8a7a', '#3fb6e8', '#ffffff', '#6fd04a']));
      break;
    }
  }
}

// An upper-floor facade tile: 8 bays x 4 storeys of the given wall and window style.
export function facadePix(wallKey, windowStyle, seed, lit = .1) {
  const w = WALLS[wallKey], p = new Pix(BAY_PX * 8, FLOOR_PX * 4, seed), accent = p.rnd.pick(K.accents);
  paintWall(p, w, 0, 0, p.w, p.h);
  p.under = w.base; // rounded frame corners fall back to the wall colour
  for (let f = 0; f < 4; f++) {
    if (w.kind === 'brick') { p.rect(0, f * FLOOR_PX + FLOOR_PX - 1, p.w, 1, K.trim); p.rect(0, f * FLOOR_PX + FLOOR_PX - 2, p.w, 1, K.trimShade); } // white string course
    for (let b = 0; b < 8; b++) if (windowStyle !== 'none' && w.kind !== 'curtain') paintWindow(p, windowStyle, b * BAY_PX, f * FLOOR_PX, FLOOR_PX, accent, w, lit);
  }
  return p;
}

const SIGN_COLORS = ['#3fb6e8', '#6fd04a', '#ff8fcf', '#5aaee8', '#9d8ad6', '#ffc84a', '#ffffff'];
// A ground floor tile: 8 bays x one 4 m storey. Doors and awnings are separate geometry.
export function groundPix(wallKey, style, windowStyle, seed, lit = .1) {
  const w = WALLS[wallKey], p = new Pix(BAY_PX * 8, GROUND_PX, seed), r = p.rnd, accent = r.pick(K.accents);
  paintWall(p, w, 0, 0, p.w, p.h);
  p.under = w.base;
  const H = GROUND_PX;
  switch (style) {
    case 'storefront': // aqua glass in pearl frames, a bright sign band, a planter along the sill
      for (let b = 0; b < 8; b += 2) {
        const x = b * BAY_PX, W = BAY_PX * 2, sign = r.pick(SIGN_COLORS), warm = r() < lit * 2;
        p.rect(x + 1, 0, W - 2, 4, sign); p.rect(x + 1, 0, W - 2, 1, '#ffffff');
        for (let i = 4; i < W - 6; i += 3) p.rect(x + i, 1, 2, 2, sign === '#ffffff' ? '#1c2c5e' : '#ffffff');
        p.rect(x + 1, 4, W - 2, H - 6, K.frame);
        for (let j = 5; j < H - 4; j++) for (let i = 2; i < W - 2; i++) {
          const t = (j - 5) / (H - 9);
          p.set(x + i, j, (i + j) % 8 === 0 ? G0 : warm ? (t < .4 ? L0 : L1) : t < .25 ? G1 : t < .65 ? G2 : G3);
        }
        for (let k = 0; k < 4; k++) p.rect(x + 3 + Math.floor(r() * (W - 8)), H - 8 - Math.floor(r() * 4), 2, 2, r.pick(['#ffc84a', '#ff8fcf', '#6fd04a', '#ffffff', '#9d8ad6']));
        p.rect(x + 2 + Math.floor(BAY_PX * .4), 5, 1, H - 9, K.frame);
        p.rect(x + 1, H - 4, W - 2, 2, K.planter[0]); p.rect(x + 1, H - 3, W - 2, 1, K.planter[2]);
        for (let i = 2; i < W - 2; i += 2) { p.set(x + i, H - 5, P.leaf); if (i % 6 === 0) p.set(x + i, H - 6, r.pick(['#ff8fcf', '#6fc8ff', '#ffffff'])); }
      }
      break;
    case 'lobby': // full-height glass with white mullions
      for (let x = 0; x < p.w; x++) for (let j = 2; j < H - 2; j++) {
        const t = (j - 2) / (H - 4);
        p.set(x, j, x % 5 === 0 ? K.frame : (x + j) % 9 === 0 ? G0 : t < .2 ? G1 : t < .6 ? G2 : G3);
      }
      p.rect(0, H - 2, p.w, 2, K.trimShade); p.rect(0, 1, p.w, 1, K.trim);
      break;
    case 'barn':
      for (let b = 0; b < 8; b += 3) {
        const x = b * BAY_PX + 2, dw = BAY_PX * 2 - 4;
        p.rect(x, 4, dw, H - 4, '#5aaee8');
        for (let i = 0; i < dw; i++) { p.set(x + i, 4 + Math.round(i * (H - 5) / dw), '#ffffff'); p.set(x + i, H - 1 - Math.round(i * (H - 5) / dw), '#ffffff'); }
        p.rect(x, 4, dw, 1, '#ffffff'); p.rect(x, H - 1, dw, 1, '#ffffff'); p.rect(x, 4, 1, H - 4, '#ffffff'); p.rect(x + dw - 1, 4, 1, H - 4, '#ffffff');
      }
      break;
    case 'bay': // pearl roll-up doors with an aqua stripe
      for (let b = 0; b < 8; b += 2) {
        const x = b * BAY_PX + 3;
        p.rect(x, 4, BAY_PX + 6, H - 4, '#e2edf3');
        for (let j = 5; j < H; j += 2) p.rect(x, j, BAY_PX + 6, 1, '#c6d8e4');
        p.rect(x, 9, BAY_PX + 6, 2, '#3fb6e8'); p.rect(x - 1, 3, BAY_PX + 8, 1, K.trim);
      }
      break;
    case 'parking':
      p.rect(0, 5, p.w, H - 8, '#3a4a66'); p.rect(0, 4, p.w, 1, '#3fb6e8');
      for (let x = 0; x < p.w; x += BAY_PX) p.rect(x, 5, 2, H - 8, w.base);
      break;
    case 'none':
      break;
    default: // house, entry, portico: windows over a pearl plinth with a coloured line
      for (let b = 0; b < 8; b++) if (windowStyle !== 'none' && (b + 1) % 4) paintWindow(p, windowStyle === 'band' ? 'sill' : windowStyle, b * BAY_PX, 2, FLOOR_PX, accent, w, lit);
      p.rect(0, H - 3, p.w, 3, K.trim); p.rect(0, H - 2, p.w, 1, K.trimShade); p.rect(0, H - 3, p.w, 1, style === 'house' ? P.leaf : '#3fb6e8');
      if (style === 'house') for (let x = 1; x < p.w; x += 5) p.set(x, H - 4, ['#ff8fcf', '#6fc8ff', '#ffffff', '#ffd23f'][x % 4]); // flowers at the foot
  }
  return p;
}

// ---------- roofs ----------
export function roofPix(key, seed) {
  const R = ROOFS[key], p = new Pix(64, 64, seed), r = p.rnd;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let c = R.base;
    switch (R.kind) {
      case 'shingle': {
        const row = Math.floor(y / 3), off = row % 2 ? 2 : 0;
        if (y % 3 === 2) c = R.dark;
        else if ((x + off) % 4 === 0) c = R.dark;
        else if (y % 3 === 0) c = R.light;
        if (r() < .05) c = mix(c, '#ffffff', .12);
        break;
      }
      case 'tile': {
        const row = Math.floor(y / 4), off = row % 2 ? 2 : 0, k = (x + off) % 4;
        c = y % 4 === 3 ? R.dark : k === 0 ? R.light : k === 3 ? R.dark : R.base;
        break;
      }
      case 'seam': c = x % 5 === 0 ? R.light : x % 5 === 1 ? R.dark : r() < .03 ? R.light : R.base; break;
      case 'gravel': c = r() < .18 ? R.dark : r() < .12 ? R.light : R.base; break;
      case 'deck': c = x % 16 === 0 || y % 16 === 0 ? R.dark : (x * 7 + y * 3) % 97 === 0 ? '#9fb6c6' : r() < .06 ? R.light : R.base; break;
      case 'garden': c = (x % 64 < 2 || y % 64 < 2) ? ((x + y) % 4 ? '#e7f1f6' : '#c8dbe6') : r() < .05 ? '#ff8fcf' : r() < .05 ? '#ffffff' : r() < .25 ? R.dark : r() < .2 ? R.light : R.base; break;
      case 'glass': c = x % 8 === 0 || y % 8 === 0 ? '#f4fbff' : (x + y) % 21 < 3 ? R.light : y % 8 < 3 ? R.light : y % 8 < 6 ? R.base : R.dark; break;
    }
    p.set(x, y, c);
  }
  return p;
}

// Tile sizes in metres, for mapping geometry onto atlas tiles.
export const TILE_M = { facade: { w: BAY * 8, h: STOREY * 4 }, ground: { w: BAY * 8, h: 4 }, roof: { w: 64 * TEXEL, h: 64 * TEXEL } };
export const GROUND_FLOOR_M = 4;

// Packs repeating tiles into one atlas. A mesh stores each vertex's tile rect and tiling coordinates;
// the tiling material wraps within the tile, so many wall and roof variants share one draw call.
// Every tile sits in a gutter of TILE_GUTTER pixels filled with its own wrapped continuation, in a cell aligned to the
// gutter, so mip levels up to log2(TILE_GUTTER) see only that tile (the tiling material never reads coarser ones there).
export const TILE_GUTTER = 8;
export class TileAtlas {
  constructor(size = 2048) { this.size = size; this.tiles = new Map(); this.cx = 0; this.cy = 0; this.rowH = 0; this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = size; this.g = this.canvas.getContext('2d'); }
  // Returns [u0, v0, du, dv] for the tile, painting it on first use.
  rect(key, paint) {
    if (this.tiles.has(key)) return this.tiles.get(key);
    const pix = paint(), G = TILE_GUTTER, up = n => Math.ceil(n / G) * G;
    const cw = up(pix.w + 2 * G), ch = up(pix.h + 2 * G);
    if (this.cx + cw > this.size) { this.cx = 0; this.cy += this.rowH; this.rowH = 0; }
    if (this.cy + ch > this.size) throw new Error('Tile atlas is full');
    const src = pix.canvas(), x = this.cx + G, y = this.cy + G, g = this.g;
    g.save(); g.beginPath(); g.rect(this.cx, this.cy, cw, ch); g.clip();
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) g.drawImage(src, x + dx * pix.w, y + dy * pix.h); // the tile, wrapped through its gutter
    g.restore();
    const S = this.size, r = [x / S, 1 - (y + pix.h) / S, pix.w / S, pix.h / S];
    this.tiles.set(key, r);
    this.cx += cw; this.rowH = Math.max(this.rowH, ch);
    return r;
  }
  texture() {
    const t = pixelFiltering(new THREE.CanvasTexture(this.canvas));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}

// A glossy lit material that tiles each vertex's atlas rect (attribute aTile) by its uv. textureGrad keeps
// mip selection smooth across the fract() seam, so tile edges do not sparkle. Phong gives the Aero sheen.
// The gradients are capped at the tile gutter, so filtering never reaches a neighbouring tile; past that a facade
// is a sub-pixel pattern anyway, and the sample eases into the tile's average colour (a coarse mip read at its
// centre), so distant walls and roofs hold one steady tone rather than sparkling windows.
export function tilingMaterial(texture) {
  const m = new THREE.MeshPhongMaterial({ map: texture, vertexColors: true, specular: AERO.gloss, shininess: AERO.shininess });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aTile;\nvarying vec4 vTile;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = aTile;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vTile;')
      .replace('#include <map_fragment>', `
        vec2 tuv = vMapUv;
        vec2 auv = vTile.xy + fract(tuv) * vTile.zw;
        vec2 gx = dFdx(tuv) * vTile.zw, gy = dFdy(tuv) * vTile.zw, tsz = vec2(textureSize(map, 0));
        float fp = max(length(gx * tsz), length(gy * tsz)); // the pixel's footprint, in atlas texels
        float cap = max(fp / ${TILE_GUTTER.toFixed(1)}, 1.0);
        vec4 sampledDiffuseColor = textureGrad(map, auv, gx / cap, gy / cap);
        vec4 tileMean = textureLod(map, vTile.xy + 0.5 * vTile.zw, 4.0);
        sampledDiffuseColor = mix(sampledDiffuseColor, tileMean, smoothstep(${TILE_GUTTER.toFixed(1)}, ${(TILE_GUTTER * 3).toFixed(1)}, fp));
        diffuseColor *= sampledDiffuseColor;`);
  };
  return m;
}

// ---------- ground and streets ----------
function tufts(p, base, dark, light, density, extras = []) {
  const r = p.rnd;
  p.rect(0, 0, p.w, p.h, base);
  for (let i = 0; i < p.w * p.h * density; i++) {
    const x = Math.floor(r() * p.w), y = Math.floor(r() * p.h);
    p.wset(x, y, dark); p.wset(x + 1, y - 1, light); p.wset(x - 1, y - 1, light);
  }
  for (let i = 0; i < p.w * p.h * .025; i++) p.wset(Math.floor(r() * p.w), Math.floor(r() * p.h), r() < .5 ? light : dark);
  for (const [color, count] of extras) for (let i = 0; i < count; i++) { const x = Math.floor(r() * p.w), y = Math.floor(r() * p.h); p.wset(x, y, color); if (r() < .4) p.wset(x + 1, y, color); }
}

export function groundTextures() {
  const T = {};
  const make = (name, size, paint, texel = .25, seed = name.length * 97) => { const p = new Pix(size, size, seed); paint(p); T[name] = p.texture({ texel }); };
  make('grass', 64, p => tufts(p, P.grass, P.grassDark, P.grassLight, .012, [[P.grassPale, 14], ['#e9cf62', 3], ['#f4ead2', 2]]));
  make('lawn', 64, p => tufts(p, P.grassLight, P.grass, P.grassPale, .015, [['#f7d774', 4], ['#ffffff', 4]]));
  make('forest', 64, p => tufts(p, '#3f9a3e', '#2a7a38', '#5fbf48', .03, [[P.leafDark, 60], ['#a6e86a', 18], ['#7a5a3a', 18]]));
  make('meadow', 64, p => tufts(p, '#8fd458', '#64b043', '#b8ee7a', .035, [['#fff27a', 20], ['#ffffff', 10], ['#8fd8ff', 8], ['#ff9ed6', 6]]));
  make('soil', 64, p => tufts(p, P.soil, P.soilDark, P.soilLight, .015, [[P.stone, 20]]));
  make('pitch', 64, p => { for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) p.set(x, y, (Math.floor(x / 16) % 2 ? P.grassLight : '#7eae47')); for (let i = 0; i < 120; i++) p.wset(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), P.grass); });
  make('sand', 32, p => { p.rect(0, 0, 32, 32, P.sand); for (let i = 0; i < 90; i++) p.wset(Math.floor(p.rnd() * 32), Math.floor(p.rnd() * 32), p.rnd() < .5 ? P.sandDark : '#e8d3a6'); });
  make('asphalt', 64, p => {
    p.rect(0, 0, 64, 64, P.asphalt);
    for (let i = 0; i < 520; i++) p.wset(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), p.rnd() < .55 ? P.asphaltDark : P.asphaltLight);
    for (let k = 0; k < 2; k++) { let x = p.rnd() * 64, y = p.rnd() * 64; for (let s = 0; s < 14; s++) { p.wset(Math.round(x), Math.round(y), '#332e2c'); x += p.rnd() * 2 - .6; y += p.rnd() * 2 - 1; } }
  }, TEXEL);
  make('sidewalk', 20, p => {
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) p.set(x, y, x % 5 === 0 || y % 5 === 0 ? P.pavementDark : p.rnd() < .08 ? P.pavementLight : P.pavement);
  }, TEXEL);
  make('brickPath', 16, p => { // Chapel Hill's brick walks: herringbone in warm red
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const k = ((x >> 1) + (y >> 1)) % 4, joint = (x + y) % 4 === 0;
      p.set(x, y, joint ? '#8e5a44' : k < 2 ? '#b8664a' : '#a95a40');
    }
  }, TEXEL);
  make('dirtPath', 32, p => { p.rect(0, 0, 32, 32, '#b48f63'); for (let i = 0; i < 120; i++) p.wset(Math.floor(p.rnd() * 32), Math.floor(p.rnd() * 32), p.rnd() < .5 ? '#9a7550' : '#c9a77a'); }, TEXEL);
  make('lot', 64, p => { // asphalt with stall lines: 2.6 m stalls, 5.4 m deep rows facing a 6.4 m aisle
    p.rect(0, 0, 64, 64, P.asphalt);
    for (let i = 0; i < 380; i++) p.wset(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), p.rnd() < .55 ? P.asphaltDark : P.asphaltLight);
    for (let x = 0; x < 64; x += 13) { p.rect(x, 0, 1, 27, P.lineWhite); p.rect(x, 37, 1, 27, P.lineWhite); }
  }, TEXEL);
  make('cemetery', 64, p => tufts(p, P.grass, P.grassDark, P.grassLight, .02, [[P.grassPale, 30]]));
  return T;
}

// Water: three frames of rippling pixels, cycled by the caller. Banks and depth come from geometry.
export function waterFrames() {
  return [0, 1, 2].map(f => {
    const p = new Pix(48, 48, 777);
    p.rect(0, 0, 48, 48, P.water);
    const r = seeded(31);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * 48), y = Math.floor(r() * 48), len = 2 + Math.floor(r() * 3), dx = (f + i) % 3;
      for (let k = 0; k < len; k++) p.wset(x + k + dx, y, r() < .3 ? P.waterFoam : P.waterLight);
      p.wset(x + dx, y + 1, P.waterDark);
    }
    return p.texture({ texel: .25 });
  });
}

// ---------- building details atlas ----------
// Named regions (in pixels) of one 256 x 256 atlas: doors, awnings, signs, porch parts, chimneys,
// rooftop kit, steeple and fence. uv(name) returns normalized [u0, v0, u1, v1].
export function detailAtlas() {
  // Regions are padded by PAD pixels of their own edge colour, so the finest mip levels stay clean (details are
  // hidden before they shrink much further: LOD.details).
  const S = 512, PAD = 3, p = new Pix(S, S, 4242), regions = {}, painted = [];
  let cx = PAD, cy = PAD, rowH = 0;
  const region = (name, w, h, paint) => {
    if (cx + w + PAD > S) { cx = PAD; cy += rowH + 2 * PAD; rowH = 0; }
    if (cy + h + PAD > S) throw new Error(`Details atlas is full at "${name}"`);
    paint(cx, cy, w, h);
    regions[name] = [cx, cy, w, h]; painted.push(regions[name]);
    cx += w + 2 * PAD; rowH = Math.max(rowH, h);
  };
  const door = (name, color, frame, glass) => region(name, 7, 12, (x, y) => {
    p.rect(x, y, 7, 12, frame);
    p.rect(x + 1, y + 1, 5, 11, color);
    if (glass) p.rect(x + 2, y + 2, 3, 3, P.glassLight);
    else { p.rect(x + 2, y + 2, 3, 3, mix(color, '#000000', .25)); p.rect(x + 2, y + 6, 3, 4, mix(color, '#000000', .25)); }
    p.set(x + 5, y + 7, P.goldLight);
  });
  door('doorRed', '#9c3328', P.paper, false); door('doorBlue', '#2f4f7a', P.paper, false); door('doorGreen', '#3f6b4f', P.paper, false);
  door('doorWood', P.wood, P.woodDark, true); door('doorBlack', '#2b2b2b', P.cream, true);
  region('doorGlass', 14, 12, (x, y) => { p.rect(x, y, 14, 12, P.slateDark); p.rect(x + 1, y + 1, 5, 11, P.glass); p.rect(x + 8, y + 1, 5, 11, P.glass); p.rect(x + 1, y + 1, 5, 4, P.glassLight); p.rect(x + 8, y + 1, 5, 4, P.glassLight); });
  region('portico', 16, 14, (x, y) => { // white pediment entrance for campus and civic buildings
    p.rect(x, y + 4, 16, 10, P.paper);
    for (let i = 0; i < 8; i++) p.rect(x + 8 - i, y + 4 - Math.floor(i / 2), i * 2, 1, P.paper);
    p.rect(x + 5, y + 7, 6, 7, '#2b2b2b'); p.rect(x + 6, y + 8, 4, 3, P.glassLight);
    p.rect(x + 1, y + 6, 2, 8, P.stoneLight); p.rect(x + 13, y + 6, 2, 8, P.stoneLight);
  });
  for (const [name, [a, b]] of ['awningRed', 'awningGreen', 'awningBlue', 'awningGold', 'awningPlum'].map((n, i) => [n, K.awnings[i]])) {
    region(name, 16, 8, (x, y) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) p.set(x + i, y + j, Math.floor(i / 2) % 2 ? a : b); for (let i = 0; i < 16; i++) p.set(x + i, y + 7, i % 2 ? mix(a, '#000000', .3) : a); });
  }
  for (const [i, bg] of SIGN_COLORS.entries()) region(`sign${i}`, 24, 6, (x, y) => {
    p.rect(x, y, 24, 6, mix(bg, '#000000', .35)); p.rect(x + 1, y + 1, 22, 4, bg);
    const fg = bg === '#f3e3c3' ? '#2b2b2b' : P.paper;
    for (let k = 3; k < 21; k += 2 + (k % 3 === 0)) p.rect(x + k, y + 2, 1 + (k % 2), 2, fg);
  });
  region('porchFloor', 16, 16, (x, y) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) p.set(x + i, y + j, j % 3 === 2 ? P.woodDark : P.woodLight); });
  region('porchRoof', 16, 16, (x, y) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) p.set(x + i, y + j, j % 3 === 2 ? P.charcoalDark : (i + (j % 2) * 2) % 4 === 0 ? P.charcoalDark : P.charcoal); });
  region('postWhite', 4, 16, (x, y) => { p.rect(x, y, 4, 16, P.paper); p.rect(x + 3, y, 1, 16, P.creamDark); });
  region('chimney', 8, 16, (x, y) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) p.set(x + i, y + j, j % 3 === 2 || (i + (Math.floor(j / 3) % 2) * 2) % 4 === 3 ? P.mortar : (i + j) % 5 ? P.brick : P.brickDark); p.rect(x, y, 8, 2, P.stoneDark); });
  region('chimneyTop', 8, 8, (x, y) => { p.rect(x, y, 8, 8, P.stoneDark); p.rect(x + 2, y + 2, 4, 4, P.ink); });
  region('acSide', 16, 10, (x, y) => { p.rect(x, y, 16, 10, '#b9bfc2'); for (let i = 1; i < 15; i += 2) p.rect(x + i, y + 2, 1, 6, '#8d9497'); p.rect(x, y, 16, 1, '#d8dcde'); });
  region('acTop', 16, 16, (x, y) => { p.rect(x, y, 16, 16, '#c9cfd1'); for (let a = 0; a < 6.3; a += .5) p.set(x + 8 + Math.cos(a) * 5, y + 8 + Math.sin(a) * 5, '#6e7579'); p.rect(x + 7, y + 7, 2, 2, '#4d5357'); });
  region('skylight', 16, 16, (x, y) => { p.rect(x, y, 16, 16, P.stoneLight); p.rect(x + 1, y + 1, 14, 14, P.glass); p.rect(x + 1, y + 1, 14, 5, P.glassLight); p.rect(x + 7, y + 1, 1, 14, P.stoneLight); });
  region('steeple', 12, 16, (x, y) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 12; i++) p.set(x + i, y + j, i % 4 === 3 ? P.creamDark : P.paper); p.rect(x + 4, y + 4, 4, 6, '#2b2b2b'); p.rect(x + 5, y + 5, 2, 2, P.goldLight); });
  region('spire', 12, 16, (x, y) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 12; i++) p.set(x + i, y + j, (i + j) % 4 === 0 ? P.slateDark : P.slate); });
  region('seats', 16, 16, (x, y) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) p.set(x + i, y + j, j % 4 === 3 ? '#8f8574' : (j % 4 === 0 ? '#5b8fd1' : '#c9c3b6')); });
  region('fencePicket', 16, 8, (x, y) => { for (let i = 0; i < 16; i++) { if (i % 4 < 2) { p.rect(x + i, y + 1, 1, 7, i % 4 ? P.creamDark : P.paper); p.set(x + i, y, P.paper); } } p.rect(x, y + 3, 16, 1, P.creamDark); p.rect(x, y + 6, 16, 1, P.creamDark); });
  region('fenceWood', 16, 8, (x, y) => { p.rect(x, y + 1, 16, 1, P.woodLight); p.rect(x, y + 4, 16, 1, P.wood); for (let i = 0; i < 16; i += 8) p.rect(x + i, y, 2, 8, P.woodDark); });
  region('hedge', 16, 8, (x, y) => { for (let j = 0; j < 8; j++) for (let i = 0; i < 16; i++) p.set(x + i, y + j, (i * 7 + j * 3) % 5 === 0 ? P.leafLight : (i + j) % 4 === 0 ? P.leafDark : P.leaf); for (let i = 0; i < 16; i++) p.set(x + i, y, (i % 3) ? P.leafLight : P.leaf); });
  region('trim', 4, 4, (x, y) => p.rect(x, y, 4, 4, P.paper));
  // ---------- Aero building kit ----------
  const roundDoor = (name, color) => region(name, 8, 13, (x, y) => { // pastel door, round fanlight, glossy edge
    p.rect(x, y, 8, 13, K.frame); p.set(x, y, null); p.set(x + 7, y, null);
    p.rect(x + 1, y + 4, 6, 9, color); p.rect(x + 1, y + 4, 1, 9, mix(color, '#ffffff', .45));
    p.rect(x + 2, y + 1, 4, 2, K.glass[1]); p.set(x + 2, y + 1, K.glass[0]);
    p.rect(x + 2, y + 6, 4, 3, mix(color, '#000000', .18)); p.set(x + 5, y + 9, '#ffd23f');
  });
  roundDoor('doorMint', '#4fcf9a'); roundDoor('doorSky', '#5aaee8'); roundDoor('doorCoral', '#ff8a7a'); roundDoor('doorLilac', '#9d8ad6'); roundDoor('doorWhite', '#eef5f9');
  region('doorAqua', 14, 13, (x, y) => { // pearl-framed double glass doors
    p.rect(x, y, 14, 13, K.frame); p.rect(x + 13, y, 1, 13, K.frameShade);
    for (const dx of [1, 7]) for (let j = 1; j < 13; j++) for (let i = 0; i < 6; i++) p.set(x + dx + i, y + j, (i + j) % 6 === 0 ? K.glass[0] : j < 4 ? K.glass[1] : j < 9 ? K.glass[2] : K.glass[3]);
    p.rect(x + 6, y + 6, 1, 2, '#ffffff'); p.rect(x + 7, y + 6, 1, 2, '#ffffff');
  });
  region('pearlTrim', 8, 4, (x, y) => { p.rect(x, y, 8, 4, K.trim); p.rect(x, y + 3, 8, 1, K.trimShade); p.rect(x, y, 8, 1, '#ffffff'); });
  region('balconySlab', 8, 8, (x, y) => { p.rect(x, y, 8, 8, K.trim); p.rect(x, y + 6, 8, 2, K.trimShade); });
  region('balconyRail', 16, 6, (x, y) => { // a white top rail over tinted glass; transparent strip at the foot reads as a gap
    p.rect(x, y, 16, 1, '#ffffff'); p.rect(x, y + 1, 16, 1, K.trimShade);
    for (let j = 2; j < 5; j++) for (let i = 0; i < 16; i++) p.set(x + i, y + j, i % 8 === 0 ? '#ffffff' : (i + j) % 5 === 0 ? K.glass[0] : j === 2 ? K.glass[1] : K.glass[2]);
    p.rect(x, y + 5, 16, 1, K.trimShade);
  });
  region('planterSide', 8, 6, (x, y) => { p.rect(x, y, 8, 6, K.planter[0]); p.rect(x, y + 4, 8, 1, K.planter[2]); p.rect(x, y + 5, 8, 1, K.planter[1]); p.rect(x, y, 8, 1, '#ffffff'); });
  region('planterTop', 8, 8, (x, y) => { for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) p.set(x + i, y + j, (i * 3 + j * 5) % 7 === 0 ? '#ff8fcf' : (i + j) % 5 === 0 ? '#6fc8ff' : (i + j) % 2 ? P.leaf : P.leafLight); });
  region('solarPanel', 12, 8, (x, y) => { // deep blue cells, white grid, a glossy streak
    p.rect(x, y, 12, 8, '#c6dceb');
    for (let j = 1; j < 7; j++) for (let i = 1; i < 11; i++) p.set(x + i, y + j, (i % 3 === 0 || j % 3 === 0) ? '#8fb8d8' : (i + j) % 6 === 0 ? '#9fe6f8' : '#2a4f9a');
  });
  region('domeGlass', 12, 12, (x, y) => { for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) p.set(x + i, y + j, i % 4 === 0 || j % 4 === 0 ? '#ffffff' : (i + j) % 7 === 0 ? K.glass[0] : j < 4 ? K.glass[1] : K.glass[2], 225); });
  region('canopyGlass', 12, 8, (x, y) => { for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) p.set(x + i, y + j, i % 6 === 0 || j === 0 ? '#ffffff' : (i + j) % 5 === 0 ? K.glass[0] : K.glass[1], 215); });
  region('stoneTrim', 4, 4, (x, y) => p.rect(x, y, 4, 4, P.stoneLight));
  region('dark', 4, 4, (x, y) => p.rect(x, y, 4, 4, '#2d2a28'));
  region('concrete', 16, 16, (x, y) => { p.rect(x, y, 16, 16, '#c9c3b6'); for (let i = 0; i < 30; i++) p.set(x + Math.floor(p.rnd() * 16), y + Math.floor(p.rnd() * 16), '#b3ad9f'); });
  region('bellFace', 12, 12, (x, y) => { p.rect(x, y, 12, 12, P.brick); p.rect(x + 1, y + 1, 10, 10, P.paper); p.rect(x + 2, y + 2, 8, 8, '#f6efdc'); p.rect(x + 6, y + 3, 1, 3, P.ink); p.rect(x + 6, y + 6, 3, 1, P.ink); p.set(x + 6, y + 2, P.goldDark); });
  for (const [x, y, w, h] of painted) p.extrude(x, y, w, h, PAD);
  const tex = p.texture({ repeat: false, flipY: false });
  const uv = name => { const [x, y, w, h] = regions[name]; return [x / S, y / S, (x + w) / S, (y + h) / S]; };
  // Inset by half a texel so nearest sampling never reaches a neighbouring region.
  const uvIn = name => { const [x, y, w, h] = regions[name]; const e = .5; return [(x + e) / S, (y + e) / S, (x + w - e) / S, (y + h - e) / S]; };
  return { texture: tex, uv: uvIn, raw: uv, has: name => name in regions };
}
