// Frutiger Aero atmosphere over the pixel city (the hills, woods and wind turbines past the map are in outskirts.js):
// - mountBubbles(): pixel bubbles drifting up the screen, drawn on a low-resolution overlay canvas
//   (slower and without wobble when the system asks for reduced motion). Pass onFrame to run them on the
//   sim clock's frames, so they freeze and speed up with the city; paused, they stay on screen, holding still.
import { PIXEL_SCALE, seeded, AERO } from './palette.js';

// Pixel bubbles over the city. A canvas at 1/PIXEL_SCALE resolution, scaled up crisp, never takes clicks.
export function mountBubbles(host = document.body, { onFrame } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'aero-bubbles';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', imageRendering: 'pixelated', zIndex: '5' });
  host.append(canvas);
  const g = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, r = seeded(51);
  let W = 0, H = 0, dirty = true; // dirty: the canvas needs painting even though no time passed (first frame, resize)
  const resize = () => { W = canvas.width = Math.ceil(innerWidth / PIXEL_SCALE); H = canvas.height = Math.ceil(innerHeight / PIXEL_SCALE); dirty = true; };
  resize(); addEventListener('resize', resize);
  const spawn = (b, anywhere) => Object.assign(b, { x: r() * W, y: anywhere ? r() * H : H + 20, rad: 3 + Math.floor(r() * 9), v: 6 + r() * 10, phase: r() * 6.3, wob: 4 + r() * 8 });
  const bubbles = Array.from({ length: AERO.bubbles }, () => spawn({}, true));

  function circle(cx, cy, rad, color, fill = false) {
    g.fillStyle = color;
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      const d = Math.hypot(x + .5, y + .5);
      if (fill ? d <= rad - .5 : d <= rad && d > rad - 1.2) g.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    }
  }
  function draw(time, dt) {
    g.clearRect(0, 0, W, H);
    for (const b of bubbles) {
      // Reduced motion slows the drift to a quarter and drops the wobble, rather than freezing the bubbles.
      b.y -= b.v * (still ? .25 : 1) * dt;
      if (b.y < -20) spawn(b, false);
      const x = b.x + (still ? 0 : Math.sin(time * .9 + b.phase) * b.wob), y = b.y;
      circle(x, y, b.rad, 'rgba(210, 248, 255, .16)', true);  // a faint body
      circle(x, y, b.rad, 'rgba(255, 255, 255, .75)');        // the rim
      g.fillStyle = 'rgba(255, 255, 255, .95)';                 // two-pixel glint, top left
      g.fillRect(Math.round(x - b.rad * .45), Math.round(y - b.rad * .5), 2, 1);
      g.fillRect(Math.round(x - b.rad * .55), Math.round(y - b.rad * .3), 1, 1);
      g.fillStyle = 'rgba(120, 220, 255, .55)';                 // a cyan catch-light, bottom right
      g.fillRect(Math.round(x + b.rad * .4), Math.round(y + b.rad * .45), 1, 1);
    }
  }
  let time = 0;
  const step = dt => { dt = Math.min(.2, Math.max(0, dt)); if (!dt && !dirty) return; dirty = false; time += dt; draw(time, dt); };
  if (onFrame) onFrame((_, simDt) => step(simDt));
  else { let last = performance.now(); requestAnimationFrame(function loop(now) { step(Math.min(.05, (now - last) / 1000)); last = now; requestAnimationFrame(loop); }); }
  return canvas;
}
