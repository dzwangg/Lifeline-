// The before/after wipe: a divider over the map with year 0 on its left and the shown year on its right. world/view.js
// draws the two sides; the zone and household layers keep a year-0 copy for the left. scenario.wipe turns it on (the
// panel's "Before / after" button), which turns "Show before" off; turning that on turns the wipe off. Drag the handle,
// or focus it and use the arrow keys.
import { scenario, simClock } from './scenario.js';
import { simDate } from './clock-bar.js';

export function mountWipe({ world, host = document.body }) {
  const { view } = world;
  const el = document.createElement('div');
  el.className = 'wipe';
  el.hidden = true;
  el.innerHTML = '<span class="wipe__label wipe__label--before">Year 0</span><span class="wipe__label wipe__label--after"></span>'
    + '<button class="wipe__handle" type="button" role="slider" aria-label="Before and after divider" aria-valuemin="5" aria-valuemax="95"><svg viewBox="0 0 11 7" aria-hidden="true"><path fill="currentColor" d="M0 3h1v1H0zM1 2h1v3H1zM2 1h1v5H2zM8 1h1v5H8zM9 2h1v3H9zM10 3h1v1h-1z"/></svg></button>';
  host.append(el);
  const handle = el.querySelector('.wipe__handle'), after = el.querySelector('.wipe__label--after');

  let x = .5;
  const place = () => {
    el.style.left = `${x * 100}%`;
    view.split = scenario.get().wipe ? x : null;
    handle.setAttribute('aria-valuenow', String(Math.round(x * 100)));
  };
  const moveTo = clientX => { const r = view.renderer.domElement.getBoundingClientRect(); x = Math.min(.95, Math.max(.05, (clientX - r.left) / r.width)); place(); };
  handle.addEventListener('pointerdown', e => { handle.setPointerCapture(e.pointerId); e.preventDefault(); });
  handle.addEventListener('pointermove', e => { if (handle.hasPointerCapture(e.pointerId)) moveTo(e.clientX); });
  handle.addEventListener('keydown', e => {
    const d = { ArrowLeft: -.05, ArrowRight: .05 }[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation(); // not a camera move
    x = Math.min(.95, Math.max(.05, x + d)); place();
  });

  scenario.subscribe(({ wipe }) => {
    if (el.hidden === !wipe) return;
    el.hidden = !wipe;
    if (wipe) simClock.setBefore(false); // the right side is the shown year
    place();
  });
  simClock.subscribe(({ shown, years, before }) => {
    if (shown) after.textContent = `Year ${shown.step} · ${simDate(years)}`;
    if (before && scenario.get().wipe) scenario.set({ wipe: false }); // "Show before" would draw year 0 on both sides
  });
}
