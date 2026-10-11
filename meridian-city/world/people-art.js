// People, painted in code: a little 3D rig (head, hair, torso, arms, legs, shoes, bags) posed for an idle stance
// and a four-frame walk, turned to five view directions (the other three are mirrors) and splatted into pixels
// with a depth buffer. Lit from the top left like every other sprite, outlined in navy ink, with darker edges
// where a limb passes in front of the body so arms and legs stay readable against clothing.
//
// Three levels of detail share one rig: 'hi' (0.1 m per pixel, for close zooms), 'mid' (0.2 m, the normal view,
// one pixel per texel like the rest of the world) and 'low' (0.4 m, hand-drawn silhouettes for distant zooms).
// Also paints the traffic-signal and walk-signal heads. Pure: returns RGBA pixels, no DOM, no three.js.
import { P } from './palette.js';

export const DIRS = 5;              // drawn directions: 0 toward the viewer, 1 down-right, 2 right, 3 up-right, 4 away
export const FRAMES = 5;            // 0 idle, 1-4 walk
export const LOOKS = 24;
// People are drawn about 2.3 m tall, a touch larger than life like most pixel-art casts, so a walker reads as a
// person at the normal zoom; every level of detail keeps the same height so nobody pops when zooming.
export const LOD = { hi: { m: .1, w: 19, h: 30, scale: 1.12 }, mid: { m: .2, w: 11, h: 17, scale: .56 }, low: { m: .4, w: 5, h: 8 } };
const INK = P.ink;

const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
// [dark, base, light, glint] for a base colour.
const tones = base => [mix(base, INK, .38), base, mix(base, '#ffffff', .34), mix(base, '#ffffff', .78)];

// ---------- the cast: skin, hair, outfits in the Aero palette ----------
const SKIN = ['#f7d7bd', '#efc3a0', '#dca27a', '#c08258', '#94603e', '#6b4330'];
const HAIR = ['#2a1d18', '#4a2f22', '#7a4b2a', '#b5793a', '#e2c178', '#d9d4cc', '#8c2f2a', '#2f6fb0'];
const TOPS = ['#3fb6e8', '#7ab8f0', '#f4f8fb', '#6fe0c0', '#9be15a', '#ffd166', '#ff8a7a', '#b39ddb', '#5aaee8', '#ffffff', '#4fcf9a', '#ff9ed6'];
const BOTTOMS = ['#2b3f6b', '#4f6b8f', '#f2f6f8', '#c9b38a', '#8a99ab', '#3a4a5e', '#6fbfae'];
const SHOES = ['#ffffff', '#f4f8fb', '#3fb6e8', '#2b3f6b', '#ff8a7a', '#e8eef2'];
const BAGS = ['#3fb6e8', '#ff8a7a', '#9be15a', '#ffd166', '#b39ddb', '#2b3f6b'];
const STYLES = ['short', 'long', 'ponytail', 'bun', 'cap', 'curly', 'short', 'long'];

export function looks() {
  const out = [];
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < LOOKS; i++) {
    const style = STYLES[i % STYLES.length];
    out.push({
      id: i, skin: SKIN[(i * 5 + 1) % SKIN.length], hair: style === 'cap' ? pick(HAIR.slice(0, 4)) : HAIR[(i * 3) % (i % 7 === 6 ? 8 : 7)],
      style, top: TOPS[(i * 7) % TOPS.length], bottom: BOTTOMS[(i * 3 + 1) % BOTTOMS.length], shoes: SHOES[(i * 5) % SHOES.length],
      cap: pick(['#3fb6e8', '#ffffff', '#6fe0c0', '#ff8a7a']), sleeves: i % 3 === 0 ? 'long' : 'short',
      legs: i % 6 === 2 ? 'shorts' : i % 8 === 5 ? 'skirt' : 'pants', bag: i % 3 === 1 ? pick(BAGS) : null,
    });
  }
  return out;
}

// ---------- rig ----------
// Body space: x to the figure's right, y up, z forward; units are hi-res pixels (0.1 m), feet on y = 0.
function pose(frame) {
  if (frame === 0) return { legR: 0, legL: 0, kneeR: .05, kneeL: .05, armR: .05, armL: .05, bob: 0 };
  const phi = (frame - 1) * Math.PI / 2, sw = Math.sin(phi), cs = Math.cos(phi);
  return { legR: .42 * sw, legL: -.42 * sw, kneeR: .1 + Math.max(0, cs) * .75, kneeL: .1 + Math.max(0, -cs) * .75, armR: -.38 * sw, armL: .38 * sw, bob: Math.abs(cs) * .45 };
}

// Primitives sampled as points in body space, each with a normal and a part colour set.
function rigPoints(look, frame) {
  const pts = [], p = pose(frame), STEP = .32;
  const C = { skin: tones(look.skin), hair: tones(look.hair), top: tones(look.top), bottom: tones(look.bottom), shoe: tones(look.shoes), cap: tones(look.cap), bag: look.bag ? tones(look.bag) : null };
  const add = (x, y, z, nx, ny, nz, col, part, gloss = 0) => pts.push({ x, y, z, nx, ny, nz, col, part, gloss });
  const capsule = (a, b, r, col, part, gloss = 0) => { // surface points: rings along the axis, a sphere at each end
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-6;
    const ax = dx / len, ay = dy / len, az = dz / len;
    let ux = -ay, uy = ax, uz = 0; // any perpendicular, then the third axis by cross product
    if (Math.abs(ax) < .1 && Math.abs(ay) < .1) { ux = 1; uy = 0; uz = 0; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux, da = STEP / r;
    for (let t = 0; t <= len; t += STEP * .8) for (let g = 0; g < Math.PI * 2; g += da) {
      const nx = ux * Math.cos(g) + vx * Math.sin(g), ny = uy * Math.cos(g) + vy * Math.sin(g), nz = uz * Math.cos(g) + vz * Math.sin(g);
      add(a[0] + ax * t + nx * r, a[1] + ay * t + ny * r, a[2] + az * t + nz * r, nx, ny, nz, col, part, gloss);
    }
    for (const c of [a, b]) for (let p = 0; p <= Math.PI; p += da) for (let g = 0; g < Math.PI * 2; g += da / Math.max(.2, Math.sin(p))) {
      const nx = Math.sin(p) * Math.cos(g), ny = Math.cos(p), nz = Math.sin(p) * Math.sin(g);
      add(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r, nx, ny, nz, col, part, gloss);
    }
  };
  const hipY = 9.2 + p.bob, shY = hipY + 5.5, headY = shY + 2.75;
  // legs and shoes
  const leg = (side, ang, knee) => {
    const hip = [side * 1.25, hipY, 0];
    const kn = [side * 1.3, hipY - Math.cos(ang) * 4.3, Math.sin(ang) * 4.3];
    const sa = ang - knee, an = [side * 1.3, kn[1] - Math.cos(sa) * 4.1, kn[2] + Math.sin(sa) * 4.1];
    const thigh = look.legs === 'shorts' ? C.bottom : look.legs === 'skirt' ? C.skin : C.bottom, shin = look.legs === 'pants' ? C.bottom : C.skin;
    capsule(hip, kn, 1.25, thigh, 'leg');
    capsule(kn, an, 1.1, shin, 'leg');
    capsule([an[0], an[1] - .1, an[2] - .3], [an[0], an[1] - .35, an[2] + 1.5], .85, C.shoe, 'shoe', 1);
  };
  leg(1, p.legR, p.kneeR); leg(-1, p.legL, p.kneeL);
  // torso: an elliptic column, widening to the shoulders
  for (let y = hipY - .4; y <= shY + .2; y += STEP * .8) {
    const k = (y - hipY) / (shY - hipY), hw = 2.55 + k * .55, hd = 1.55 + k * .15;
    for (let a = 0; a < Math.PI * 2; a += STEP / 3) {
      const x = Math.cos(a) * hw, z = Math.sin(a) * hd, n = Math.hypot(x / hw / hw, z / hd / hd);
      add(x, y, z, x / hw / hw / n, y > shY - .5 ? .5 : 0, z / hd / hd / n, C.top, 'torso');
    }
  }
  if (look.legs === 'skirt') for (let y = hipY - 3.6; y <= hipY; y += STEP * .8) {
    const k = (hipY - y) / 3.6, hw = 2.7 + k * .9, hd = 1.7 + k * .7;
    for (let a = 0; a < Math.PI * 2; a += STEP / 3) add(Math.cos(a) * hw, y, Math.sin(a) * hd, Math.cos(a), 0, Math.sin(a), C.bottom, 'torso');
  }
  capsule([0, shY - .2, 0], [0, shY + .9, .1], .8, C.skin, 'skin'); // neck
  // arms
  const arm = (side, ang) => {
    const sh = [side * 3.15, shY - .5, 0], el = [side * 3.45, sh[1] - Math.cos(ang) * 2.9, Math.sin(ang) * 2.9];
    const fa = ang + .25 + Math.max(0, ang) * .6, ha = [side * 3.5, el[1] - Math.cos(fa) * 2.6, el[2] + Math.sin(fa) * 2.6];
    capsule(sh, el, .95, C.top, 'arm');
    capsule(el, ha, .82, look.sleeves === 'long' ? C.top : C.skin, 'arm');
    capsule(ha, [ha[0], ha[1] - .3, ha[2]], .85, C.skin, 'arm');
  };
  arm(1, p.armR); arm(-1, p.armL);
  if (look.bag) { // a glossy backpack
    for (let y = hipY + 1.3; y <= shY - .3; y += STEP * .8) for (let x = -2.1; x <= 2.1; x += STEP) for (let z = -3.3; z <= -1.4; z += STEP) {
      const edge = Math.abs(x) > 1.8 || z < -3.0 || y > shY - .6;
      if (edge) add(x, y, z, Math.abs(x) > 1.8 ? Math.sign(x) : 0, y > shY - .6 ? 1 : 0, z < -3.0 ? -1 : 0, C.bag, 'bag', 1);
    }
  }
  // head and hair
  const R = 2.7, hc = [0, headY, .15];
  const hairAt = (nx, ny, nz) => {
    switch (look.style) {
      case 'long': return ny > .2 || nz < -.15 || Math.abs(nx) > .62 && ny > -.75;
      case 'curly': return ny > .05 || nz < .05 || Math.abs(nx) > .7;
      case 'cap': return ny > .1 && ny <= .45 && nz < .2 || nz < -.3 && ny > -.4;
      default: return ny > .28 || nz < -.35 || Math.abs(nx) > .8 && ny > -.1;
    }
  };
  for (let a = 0; a < Math.PI; a += STEP / R) for (let b = 0; b < Math.PI * 2; b += STEP / R) {
    const nx = Math.sin(a) * Math.cos(b), ny = Math.cos(a), nz = Math.sin(a) * Math.sin(b);
    const hair = hairAt(nx, ny, nz), capTop = look.style === 'cap' && ny > .45;
    const r = R + (hair && look.style === 'curly' ? .7 : hair ? .25 : 0) + (capTop ? .35 : 0);
    add(hc[0] + nx * r, hc[1] + ny * r, hc[2] + nz * r, nx, ny, nz, capTop ? C.cap : hair ? C.hair : C.skin, hair || capTop ? 'hair' : 'face', hair || capTop ? 1 : 0);
  }
  if (look.style === 'long') for (let y = shY - 1.2; y <= headY; y += STEP) for (let x = -2.4; x <= 2.4; x += STEP) add(x, y, -2.1, 0, 0, -1, C.hair, 'hair', 0);
  if (look.style === 'ponytail') capsule([0, headY + .6, -2.6], [0, headY - 2.4, -3.3], .9, C.hair, 'hair', 1);
  if (look.style === 'bun') capsule([0, headY + 2.4, -1.3], [0, headY + 2.6, -1.5], 1.25, C.hair, 'hair', 1);
  if (look.style === 'cap') for (let x = -2.2; x <= 2.2; x += STEP) for (let z = 1.8; z <= 4.2; z += STEP) add(x, headY + 1.3 - (z - 1.8) * .08, z + .15, 0, 1, .2, C.cap, 'hair', 1);
  // eyes (marked, painted after the depth pass at hi-res only)
  const eyes = [[-1, headY + .15, 2.55], [1, headY + .15, 2.55]];
  return { pts, eyes };
}

const rigs = new Map();
const rigCache = (look, frame) => { const k = `${look.id}:${frame}`; if (!rigs.has(k)) rigs.set(k, rigPoints(look, frame)); return rigs.get(k); };

// Rasterise one figure into a w x h cell. dir 0-4, scale: pixels per body unit (1 hi, .5 mid).
function figure(look, dir, frame, lod) {
  const { w, h, scale } = LOD[lod];
  const a = dir * Math.PI / 4, Fx = Math.sin(a), Fd = Math.cos(a), Rx = -Math.cos(a), Rd = Math.sin(a);
  const Lx = -.55, Ly = .62, Ld = .56; // light from the top left, slightly in front
  const { pts, eyes } = rigCache(look, frame);
  const N = w * h, depth = new Float32Array(N).fill(-1e9), col = new Array(N).fill(null), part = new Array(N).fill(null);
  const proj = (x, y, z) => { const X = x * Rx + z * Fx, D = x * Rd + z * Fd; return [X, y - D * .45, D]; };
  // First pass: find the lowest point so the planted foot sits on the bottom row.
  let minY = 1e9;
  for (const q of pts) { const [, Y] = proj(q.x, q.y, q.z); if (Y < minY) minY = Y; }
  const cx = (w - 1) / 2 + .5;
  for (const q of pts) {
    const [X, Y, D] = proj(q.x, q.y, q.z);
    const px = Math.floor(cx + X * scale), py = h - 1 - Math.floor((Y - minY) * scale);
    if (px < 1 || px >= w - 1 || py < 1 || py >= h) continue;
    const k = py * w + px;
    if (D <= depth[k]) continue;
    const nX = q.nx * Rx + q.nz * Fx, nD = q.nx * Rd + q.nz * Fd, tone = nX * Lx + q.ny * Ly + nD * Ld;
    depth[k] = D; part[k] = q.part;
    const dither = (px + py) % 2 ? .05 : -.05, t = tone + dither;
    col[k] = q.gloss && t > .83 ? q.col[3] : t > .42 ? q.col[2] : t > -.18 ? q.col[1] : q.col[0];
  }
  // Limbs in front of the body: darken the body pixels right beside them.
  const out = col.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (!col[k]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (y + dy) * w + x + dx;
      if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h || !col[j]) continue;
      if (part[j] !== part[k] && depth[j] > depth[k] + (lod === 'hi' ? 1.2 : 1.6) && !(part[k] === 'face' && part[j] === 'hair')) { out[k] = mix(col[k], INK, .45); break; }
    }
  }
  // Eyes, when the face is turned toward the viewer.
  if (lod === 'hi' && dir <= 2) for (const [ex, ey, ez] of eyes) {
    const [X, Y, D] = proj(ex, ey + pose(frame).bob, ez), px = Math.floor(cx + X * scale), py = h - 1 - Math.floor((Y - minY) * scale);
    const k = py * w + px;
    if (px > 0 && px < w && py > 0 && py < h && part[k] === 'face' && depth[k] - D < 1.2) out[k] = '#1c2c5e';
  }
  // Ink outline around the silhouette.
  const final = out.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (out[k]) continue;
    if ((x > 0 && out[k - 1]) || (x < w - 1 && out[k + 1]) || (y > 0 && out[k - w]) || (y < h - 1 && out[k + w])) final[k] = INK;
  }
  return final;
}

// Distant silhouettes, 3 x 5 px plus outline: hair, face, shirt with arms, legs that alternate.
function silhouette(look, dir, frame) {
  const { w, h } = LOD.low, px = new Array(w * h).fill(null), set = (x, y, c) => { px[y * w + x] = c; };
  const back = dir >= 3, top = tones(look.top), bot = tones(look.bottom), arm = look.sleeves === 'long' ? top[0] : look.skin;
  set(2, 2, look.style === 'cap' ? look.cap : look.hair);
  set(2, 3, back ? look.hair : look.skin);
  set(1, 4, top[2]); set(2, 4, top[1]); set(3, 4, top[0]);
  set(1, 5, arm); set(2, 5, top[1]); set(3, 5, arm);
  set(1, 6, bot[1]); set(2, 6, bot[1]); set(3, 6, bot[0]);
  if (frame % 2 === 0) { set(1, 7, bot[1]); set(3, 7, bot[0]); } else set(2, 7, bot[1]);
  return outline(px, w, h).px;
}

// ---------- signal heads (0.2 m per pixel) ----------
const HOUSING = '#1e2a44', HOUSING_LIT = '#3a4f78', POLE = '#4a5a72';
const LAMPS = { R: ['#ff4a3d', '#ffb0a8'], Y: ['#ffc83a', '#fff0b0'], G: ['#33e07a', '#b8ffd6'] };
const UNLIT = { R: '#5a2630', Y: '#5a4a24', G: '#1e4a3a' };
function signalHead(state) {
  const w = 8, h = 30, px = new Array(w * h).fill(null), set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c; };
  for (let y = 15; y < h; y++) { set(3, y, POLE); set(4, y, mix(POLE, INK, .35)); }
  set(2, h - 1, POLE); set(5, h - 1, POLE);
  for (let y = 1; y < 16; y++) for (let x = 1; x < 7; x++) set(x, y, x === 1 ? HOUSING_LIT : HOUSING);
  ['R', 'Y', 'G'].forEach((k, i) => {
    const y0 = 2 + i * 4.6 | 0, lit = state === k;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if ((x === 0 || x === 3) && (y === 0 || y === 3)) continue; // round lamps
      set(2 + x, y0 + y, lit ? (x + y < 2 ? LAMPS[k][1] : LAMPS[k][0]) : UNLIT[k]);
    }
    if (lit) set(2, y0 + 1, '#ffffff');
  });
  return outline(px, w, h);
}
function walkHead(state) { // 'walk' | 'hand' | 'dim'
  const w = 7, h = 14, px = new Array(w * h).fill(null), set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c; };
  for (let y = 7; y < h; y++) { set(3, y, POLE); }
  set(2, h - 1, POLE); set(4, h - 1, POLE);
  for (let y = 1; y < 8; y++) for (let x = 1; x < 6; x++) set(x, y, x === 1 ? HOUSING_LIT : HOUSING);
  if (state === 'walk') { // a white walking figure
    const c = '#f2fbff';
    set(3, 2, c); set(3, 3, c); set(2, 4, c); set(3, 4, c); set(4, 4, c); set(3, 5, c); set(2, 6, c); set(4, 6, c);
  } else { // an orange hand
    const c = state === 'hand' ? '#ff9a3a' : '#5a3a24', l = state === 'hand' ? '#ffd0a0' : c;
    set(2, 3, c); set(3, 2, l); set(4, 3, c); set(2, 4, c); set(3, 4, c); set(4, 4, c); set(2, 5, c); set(3, 5, c); set(4, 5, c); set(3, 6, c);
  }
  return outline(px, w, h);
}
function outline(px, w, h) {
  const out = px.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (px[k]) continue;
    if ((x > 0 && px[k - 1]) || (x < w - 1 && px[k + 1]) || (y > 0 && px[k - w]) || (y < h - 1 && px[k + w])) out[k] = INK;
  }
  return { px: out, w, h };
}

// ---------- the atlas ----------
/**
 * Paints every person sprite and signal head into one RGBA atlas.
 * Returns { size, data, sprites: name -> { px: [x, y, w, h], uv, w, h (metres) }, table[lod][look][dir][frame] -> sprite }.
 */
export function paintPeopleAtlas(size = 1024) {
  const data = new Uint8ClampedArray(size * size * 4), sprites = {};
  let cx = 1, cy = 1, rowH = 0;
  const place = (name, cells, w, h, m) => {
    if (cx + w + 1 > size) { cx = 1; cy += rowH + 2; rowH = 0; }
    if (cy + h > size) throw new Error('people atlas is full');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = cells[y * w + x];
      if (!c) continue;
      const [r, g, b] = rgb(c), i = ((cy + y) * size + cx + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    const s = { px: [cx, cy, w, h], uv: [cx / size, cy / size, (cx + w) / size, (cy + h) / size], w: w * m, h: h * m };
    sprites[name] = s; cx += w + 2; rowH = Math.max(rowH, h);
    return s;
  };
  const cast = looks(), table = { hi: [], mid: [], low: [] };
  for (const lod of ['hi', 'mid', 'low']) {
    const { w, h, m } = LOD[lod];
    cast.forEach((look, li) => {
      table[lod][li] = [];
      for (let d = 0; d < DIRS; d++) {
        table[lod][li][d] = [];
        for (let f = 0; f < FRAMES; f++) table[lod][li][d][f] = place(`${lod}${li}_${d}_${f}`, lod === 'low' ? silhouette(look, d, f) : figure(look, d, f, lod), w, h, m);
      }
    });
  }
  for (const s of ['R', 'Y', 'G']) { const { px, w, h } = signalHead(s); place(`signal${s}`, px, w, h, .2); }
  for (const s of ['walk', 'hand', 'dim']) { const { px, w, h } = walkHead(s); place(`ped_${s}`, px, w, h, .2); }
  // A soft oval contact shadow, dithered so it reads as translucent.
  const sw = 12, sh = 6, shadow = new Array(sw * sh).fill(null);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const d = ((x - 5.5) / 6) ** 2 + ((y - 2.5) / 3) ** 2; if (d < 1) shadow[y * sw + x] = '#0b2a3a'; }
  place('shadow', shadow, sw, sh, .1);
  // Selection ring for the person card.
  const rw = 16, rh = 8, ring = new Array(rw * rh).fill(null);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const d = ((x - 7.5) / 8) ** 2 + ((y - 3.5) / 4) ** 2; if (d < 1 && d > .5) ring[y * rw + x] = d > .78 ? P.gold : P.goldLight; }
  place('ring', ring, rw, rh, .15);
  return { size, data, sprites, table, looks: cast };
}
