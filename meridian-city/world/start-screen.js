// The start screen: Prosperia's title, the game in three steps and a Start button, over a pixel-art Frutiger Aero
// landscape. It is up from the first paint and covers the city while it builds: the Start button fills as the build's
// progress bar (progress), lights once the city is on screen (ready, which resolves when the player presses Start), or
// says why the city couldn't be built (fail). Pressing Start fades it out over the city and points at the Policies button.
// The landscape is drawn at the city's pixel grain from its palette: a dithered sky, a sunburst behind the logo, drifting
// clouds, turning wind turbines on the far hills, houses and pastel trees on the near ones, and the city's own bubbles
// (aero.js). ?nostart opens straight on the city, keeping the screen only as the loading bar.
import { P, AERO_BUILD, PIXEL_SCALE, seeded } from './palette.js';
import { mountBubbles } from './aero.js';

const S = PIXEL_SCALE; // CSS pixels per scene pixel, as in the city
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16); // 4x4 ordered dither
const SKY = ['#2f9fe2', '#56bdf0', P.sky, '#a8e7f9', P.skyWarm]; // zenith to horizon
// Far to near: body and rim-light colours, the ridge's height and swell (shares of the screen) and its wavelength.
const HILLS = {
  far: { body: '#a6e4c4', rim: '#cdf5e0', y: .64, amp: .035, wave: 1.6 },
  mid: { body: P.grassLight, rim: P.grassPale, y: .75, amp: .045, wave: 1 },
  near: { body: P.grass, rim: P.grassLight, y: .87, amp: .03, wave: .8 },
};
const TREES = [ // body, shade, light; leafy trees twice as likely
  [P.leaf, P.leafDark, P.leafLight], [P.leaf, P.leafDark, P.leafLight], [P.blossom, P.blossomDark, P.blossomLight],
  [P.maple, P.mapleDark, P.mapleLight], [P.amber, P.amberDark, P.amberLight],
];
const ROOFS = [[P.roofBlue, P.roofBlueLight], [P.roofBlue, P.roofBlueLight], [P.slate, P.slateLight], [P.terracotta, P.terracottaLight]];

export const start = mount(document.getElementById('start'));

function mount(el) {
  const skip = new URLSearchParams(location.search).has('nostart');
  const $ = s => el.querySelector(s);
  const btn = $('.start__btn'), fill = $('.start__fill'), label = $('.start__label'), status = $('.start__status');
  const stopScene = landscape($('.start__scene'), $('.start__logo'), el);
  let lit = false, begin;
  const started = new Promise(r => { begin = r; });
  el.focus({ preventScroll: true }); // so Enter starts, and the map's keys (which skip dialogs) leave the hidden city alone

  function leave() {
    if (!lit || el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    el.inert = true;
    begin(); // the city script reveals the panels now
    setTimeout(() => { // once they are visible: point at where a game begins
      const launch = document.getElementById('policy-launch');
      if (!launch || skip) return;
      launch.focus({ preventScroll: true });
      launch.classList.add('is-hinted');
      const unhint = e => {
        if (e?.type === 'animationend' && e.animationName !== 'start-hint') return; // the panels' own fade-in ends first
        launch.classList.remove('is-hinted');
        launch.removeEventListener('animationend', unhint);
        launch.removeEventListener('click', unhint);
      };
      launch.addEventListener('animationend', unhint);
      launch.addEventListener('click', unhint);
      setTimeout(unhint, 6000); // reduced motion holds the ring still, with no animation to end it
    });
    setTimeout(() => { stopScene(); el.remove(); }, reducedMotion() ? 0 : 700);
  }
  btn.addEventListener('click', leave);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) leave(); });

  return {
    /** The build's progress: a message and a fraction, 0 to 1. */
    progress(message, fraction) {
      const pct = Math.round(fraction * 100);
      status.textContent = message;
      fill.style.width = `${pct}%`;
      label.textContent = `Loading ${pct}%`;
    },
    /** The city couldn't be built: why, in place of the progress. */
    fail(message) {
      el.classList.add('is-failed');
      status.textContent = message;
      label.textContent = 'Can’t start';
    },
    /** The city is on screen: lights Start, and resolves when the player presses it (at once with ?nostart). */
    ready() {
      lit = true;
      el.classList.add('is-ready');
      btn.disabled = false;
      label.textContent = 'Start';
      status.textContent = 'Chapel Hill is ready.';
      if (skip) leave();
      return started;
    },
  };
}

// ---------- the landscape ----------
// A canvas at 1/S resolution, scaled up crisp. Static layers (sky, sun, far hills, the near hills with their houses and
// trees) are painted once per size; each frame turns the sun's rays and the turbines and moves the clouds. The sun sits
// behind the logo. Reduced motion: one still frame, and the bubbles drift slowly (aero.js).
function landscape(canvas, logo, host) {
  const g = canvas.getContext('2d'), still = reducedMotion();
  let W = 0, H = 0, sun, layers, clouds, turbines, stale = true, t = 0;
  const mark = () => { stale = true; };
  addEventListener('resize', mark);
  document.fonts?.ready.then(mark); // the logo's size, and so the sun's place, settle once Pixelify Sans has loaded

  function build() {
    W = canvas.width = Math.ceil(innerWidth / S);
    H = canvas.height = Math.ceil(innerHeight / S);
    Object.assign(canvas.style, { width: `${W * S}px`, height: `${H * S}px` });
    const rnd = seeded(2026), r = logo.getBoundingClientRect();
    sun = { x: Math.round((r.left + r.width / 2) / S), y: Math.round((r.top + r.height / 2) / S), r: Math.max(8, Math.min(36, Math.round(Math.min(W, H) * .075))) };
    const ridge = {};
    for (const [k, h] of Object.entries(HILLS)) {
      const seed = rnd() * 100, f = 61 * h.wave;
      ridge[k] = x => Math.round(H * h.y - H * h.amp * (.55 * Math.sin(x / f + seed) + .3 * Math.sin(x / (f * .38) + seed * 2.3) + .15 * Math.sin(x / (f * .16) + seed * 3.1)));
    }

    const sky = layer(W, H);
    paintSky(sky, Math.round(H * HILLS.far.y));
    const sunLayer = layer(W, H), sg = sunLayer.getContext('2d');
    for (const [k, a] of [[3.2, .1], [2.3, .14], [1.6, .22], [1.25, .4]]) disc(sg, sun.x, sun.y, Math.round(sun.r * k), `rgba(255, 251, 230, ${a})`);
    disc(sg, sun.x, sun.y, sun.r, '#fffbe6');
    disc(sg, sun.x, sun.y, sun.r - 2, '#ffffff');

    // Far hills, with the turbines' towers; their blades turn each frame.
    const far = layer(W, H), fg = far.getContext('2d');
    hills(fg, ridge.far, HILLS.far);
    const th = Math.max(10, Math.round(H * .07));
    turbines = [.05, .12, .19, .81, .88, .95].map(f => Math.round(f * W)).map(x => ({ x, y: ridge.far(x) - th, len: Math.round(th * .45), v: .7 + rnd() * .6, phase: rnd() * 6.3 }));
    for (const tb of turbines) {
      fg.fillStyle = '#ffffff'; fg.fillRect(tb.x, tb.y, 1, th + 2);
      fg.fillStyle = '#cfe9f5'; fg.fillRect(tb.x + 1, tb.y + 1, 1, th + 1);
      fg.fillStyle = '#ffffff'; fg.fillRect(tb.x - 1, tb.y - 1, 3, 2); // the nacelle
    }

    // The near hills: houses on the flanks of the middle ridge, then trees on both ridges, nearer ones drawn later.
    const front = layer(W, H), ng = front.getContext('2d');
    hills(ng, ridge.mid, HILLS.mid);
    speckle(ng, ridge.mid, rnd, W * .3, [P.grassPale]);
    for (const [a, b] of [[.03, .3], [.7, .97]]) for (let i = 0; i < 4; i++) { // each in its own quarter of the flank
      const x = Math.round((a + (b - a) * (i + .15 + rnd() * .5) / 4) * W);
      (i === 1 ? tower : house)(ng, x, ridge.mid(x + 4) + 2, rnd);
    }
    const midTrees = Array.from({ length: Math.round(W / 14) }, () => { const x = Math.round(rnd() * W); return { x, base: ridge.mid(x) + 1 + Math.floor(rnd() * 3), r: 3 + Math.floor(rnd() * 2), pine: rnd() < .2, kind: TREES[Math.floor(rnd() * TREES.length)] }; });
    for (const tr of midTrees.sort((p, q) => p.base - q.base)) tr.pine ? pine(ng, tr.x, tr.base, 9 + tr.r) : tree(ng, tr.x, tr.base, tr.r, tr.kind);
    hills(ng, ridge.near, HILLS.near);
    speckle(ng, ridge.near, rnd, W * .9, [P.grassLight, P.grassLight, P.grassDark]);
    speckle(ng, ridge.near, rnd, W * .25, [P.blossomLight, '#ffffff', P.amberLight, P.mapleLight]); // meadow flowers
    const nearTrees = Array.from({ length: Math.round(W / 22) }, () => { const x = Math.round(rnd() * W); return { x, base: ridge.near(x) + 2 + Math.floor(rnd() * 4), r: 5 + Math.floor(rnd() * 4), pine: rnd() < .2, kind: TREES[Math.floor(rnd() * TREES.length)] }; });
    for (const tr of nearTrees.sort((p, q) => p.base - q.base)) tr.pine ? pine(ng, tr.x, tr.base, 10 + 2 * tr.r) : tree(ng, tr.x, tr.base, tr.r, tr.kind);

    clouds = Array.from({ length: Math.max(3, Math.round(W / 140)) }, () => {
      const sprite = cloud(rnd);
      return { sprite, x: rnd() * (W + sprite.width), y: Math.round(H * (.04 + rnd() * .32)), v: 1.5 + rnd() * 3 };
    });
    layers = { sky, sun: sunLayer, far, front };
  }

  function draw() {
    if (stale) { stale = false; build(); }
    g.drawImage(layers.sky, 0, 0);
    // Sunbeams: soft wedges from the sun, turning slowly, under its glow.
    const reach = Math.hypot(W, H), turn = t * .03, n = 16;
    g.fillStyle = 'rgba(255, 255, 255, .11)';
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = turn + i / n * 2 * Math.PI, b = a + Math.PI / n;
      g.moveTo(sun.x, sun.y); g.lineTo(sun.x + Math.cos(a) * reach, sun.y + Math.sin(a) * reach); g.lineTo(sun.x + Math.cos(b) * reach, sun.y + Math.sin(b) * reach); g.closePath();
    }
    g.fill();
    g.drawImage(layers.sun, 0, 0);
    for (const c of clouds) g.drawImage(c.sprite, Math.round((c.x + t * c.v) % (W + c.sprite.width) - c.sprite.width), c.y);
    g.drawImage(layers.far, 0, 0);
    g.fillStyle = '#ffffff';
    for (const tb of turbines) for (let k = 0; k < 3; k++) {
      const a = t * tb.v + tb.phase + k * 2 * Math.PI / 3;
      line(g, tb.x, tb.y, tb.x + Math.cos(a) * tb.len, tb.y + Math.sin(a) * tb.len);
    }
    g.drawImage(layers.front, 0, 0);
  }

  // One loop for the scene and the bubbles, stopped when the screen goes.
  let tick = null, raf = 0, last = performance.now();
  mountBubbles(host, { onFrame: fn => { tick = fn; } });
  draw();
  raf = requestAnimationFrame(function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    if (!still) t += dt;
    if (!still || stale) draw();
    tick?.(dt, dt);
    raf = requestAnimationFrame(frame);
  });
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', mark); };
}

// ---------- pixel painting ----------
// Declarations, not consts: the screen mounts as this module loads, before the lines below have run.
function layer(w, h) { return Object.assign(document.createElement('canvas'), { width: w, height: h }); }
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }

// A filled disc, one span per row, with no anti-aliasing.
function disc(g, cx, cy, r, color) {
  g.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt((r + .5) ** 2 - dy * dy));
    g.fillRect(Math.round(cx) - hw, Math.round(cy) + dy, 2 * hw + 1, 1);
  }
}

// A one-pixel line (Bresenham), in the current fill.
function line(g, x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  for (let err = dx + dy; ;) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// The sky down to the horizon: SKY's stops in 24 shades, ordered-dithered between neighbours.
function paintSky(c, horizon) {
  const g = c.getContext('2d'), { width: w, height: h } = c, img = g.createImageData(w, h), px = new Uint32Array(img.data.buffer);
  const stops = SKY.map(rgb), n = 24;
  const shades = Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(f));
    const [r, gr, b] = stops[k].map((v, j) => Math.round(v + (stops[k + 1][j] - v) * (f - k)));
    return (255 << 24 | b << 16 | gr << 8 | r) >>> 0;
  });
  for (let y = 0; y < h; y++) {
    const f = Math.min(1, y / horizon) * (n - 1), lo = Math.min(n - 2, Math.floor(f)), frac = f - lo;
    for (let x = 0; x < w; x++) px[y * w + x] = shades[frac > BAYER[(y & 3) * 4 + (x & 3)] ? lo + 1 : lo];
  }
  g.putImageData(img, 0, 0);
}

// A hill: a two-pixel rim of light along the ridge, then its body down to the bottom.
function hills(g, ridge, h) {
  const { width: w, height: ht } = g.canvas;
  g.fillStyle = h.rim;
  for (let x = 0; x < w; x++) g.fillRect(x, ridge(x), 1, 2);
  g.fillStyle = h.body;
  for (let x = 0; x < w; x++) g.fillRect(x, ridge(x) + 2, 1, ht);
}

// Scattered pixels below a ridge: grass tufts, or flowers.
function speckle(g, ridge, rnd, count, colors) {
  const ht = g.canvas.height;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * g.canvas.width), top = ridge(x) + 4;
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.fillRect(x, top + Math.floor(rnd() * Math.max(1, ht - top)), rnd() < .4 ? 2 : 1, 1);
  }
}

// A round tree on a trunk, outlined in ink like the city's sprites: shaded low right, lit high left.
function tree(g, x, base, r, [body, shade, light]) {
  const trunk = Math.max(2, Math.round(r * .7)), tw = r > 5 ? 2 : 1, cy = base - trunk - r + 1;
  g.fillStyle = P.ink; g.fillRect(x - 1, base - trunk - 1, tw + 2, trunk + 2);
  g.fillStyle = P.wood; g.fillRect(x, base - trunk, tw, trunk);
  const cx = x + (tw - 1) / 2;
  disc(g, cx, cy, r + 1, P.ink);
  disc(g, cx, cy, r, shade);
  disc(g, cx - (r > 3), cy - (r > 3), r - 1, body);
  const k = Math.round(r * .38);
  disc(g, cx - k, cy - k, Math.max(1, Math.round(r * .3)), light);
}

// A pine: a stepped cone in three tiers, outlined in ink, its right side in shade.
function pine(g, x, base, h) {
  const w = Math.round(h * .32);
  g.fillStyle = P.ink; g.fillRect(x - 1, base - 3, 3, 4);
  g.fillStyle = P.woodDark; g.fillRect(x, base - 2, 1, 2);
  const row = (i, hw, color) => { g.fillStyle = color; g.fillRect(x - hw, base - 2 - h + i, 2 * hw + 1, 1); };
  const width = i => Math.round(i / h * w) - (i % Math.ceil(h / 3) < 2 && i > 3 ? 1 : 0); // a notch at each tier
  for (let i = 0; i < h; i++) row(i, width(i) + 1, P.ink);
  row(-1, 0, P.ink);
  for (let i = 1; i < h - 1; i++) {
    const hw = width(i);
    row(i, hw, P.pineDark);
    if (hw > 0) { g.fillStyle = P.pine; g.fillRect(x - hw, base - 2 - h + i, hw + 1, 1); }
    g.fillStyle = P.pineLight; g.fillRect(x - hw, base - 2 - h + i, 1, 1);
  }
}

// A house: cream walls under a stepped gable roof, a window and a door, outlined in ink. x: its left edge.
function house(g, x, base, rnd) {
  const w = 8 + 2 * Math.floor(rnd() * 3), h = 5 + Math.floor(rnd() * 3), [roof, roofLight] = ROOFS[Math.floor(rnd() * ROOFS.length)];
  g.fillStyle = P.ink; g.fillRect(x - 1, base - h - 1, w + 2, h + 2);
  g.fillStyle = P.cream; g.fillRect(x, base - h, w, h);
  g.fillStyle = P.creamDark; g.fillRect(x + w - 2, base - h, 2, h);
  g.fillStyle = AERO_BUILD.glass[1]; g.fillRect(x + 2, base - h + 2, 2, 2);
  g.fillStyle = P.roofBlueDark; g.fillRect(x + w - 5, base - 3, 2, 3);
  for (let i = 0; ; i++) { // rows of the roof, from the eaves (one pixel past the walls) up to the ridge
    const x0 = x - 2 + i, x1 = x + w + 1 - i, y = base - h - 1 - i;
    if (x1 < x0) break;
    g.fillStyle = P.ink; g.fillRect(x0, y, x1 - x0 + 1, 1);
    if (x1 - x0 < 2 || i === 0) continue;
    const mid = Math.floor((x0 + x1) / 2);
    g.fillStyle = roofLight; g.fillRect(x0 + 1, y, mid - x0, 1);
    g.fillStyle = roof; g.fillRect(mid + 1, y, x1 - mid - 1, 1);
  }
}

// A small glass block with a green roof, in the city's glass ramp. x: its left edge.
function tower(g, x, base, rnd) {
  const w = 10, h = 16 + 2 * Math.floor(rnd() * 3), [glint, light, mid] = AERO_BUILD.glass;
  g.fillStyle = P.ink; g.fillRect(x - 1, base - h - 3, w + 2, h + 4);
  g.fillStyle = P.grassLight; g.fillRect(x, base - h - 2, w, 2);
  for (let y = 0; y < h; y++) { g.fillStyle = (y >> 1) % 2 ? mid : light; g.fillRect(x, base - h + y, w, 1); }
  g.fillStyle = AERO_BUILD.frame;
  for (let c = 0; c < w; c += 3) g.fillRect(x + c, base - h, 1, h);
  g.fillStyle = glint;
  for (let i = 0; i < 5; i++) g.fillRect(x + 4 + i, base - h + 2 + i, 1, 1);
}

// A cloud: a row of puffs on a flat base, lit white with a pale blue underside.
function cloud(rnd) {
  const n = 3 + Math.floor(rnd() * 3), puffs = [];
  let x = 2;
  for (let i = 0; i < n; i++) { const r = 4 + Math.floor(rnd() * 5) + (i && i < n - 1 ? 3 : 0); puffs.push({ x: x + r, r }); x += r * 1.3; }
  const hi = Math.max(...puffs.map(p => p.r)), c = layer(Math.ceil(x + puffs.at(-1).r) + 2, 2 * hi + 6), g = c.getContext('2d'), base = c.height - 2;
  for (const p of puffs) disc(g, p.x, base - p.r, p.r, '#d6f1ff');
  g.fillRect(puffs[0].x, base - 4, puffs.at(-1).x - puffs[0].x, 5);
  for (const p of puffs) disc(g, p.x, base - p.r - 2, p.r, '#ffffff');
  return c;
}
