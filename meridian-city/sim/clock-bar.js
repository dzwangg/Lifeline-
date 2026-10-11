// The playback toolbar: Pause, Play (1x), Fast (2x) and Faster (4x), the simulated date and speed beside them,
// and a loading badge while the clock holds for a prediction. Keys: Space pauses or plays, 1, 2 and 4 play at
// that speed. The map toolbar's pixel-icon buttons and glass plate, so retro-ui.css skins it like the rest.
import { h } from '../policy/components.js';
import { simClock, START_YEAR } from './scenario.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tri = x => `M${x} 2h1v5H${x}zM${x + 1} 3h1v3H${x + 1}zM${x + 2} 4h1v1H${x + 2}z`; // a 3x5 pixel play triangle
const icon = (w, d) => `<svg viewBox="0 0 ${w} 9" style="width:${w * 2}px" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
const BUTTONS = [
  { speed: 0, key: 'Space', label: 'Pause', svg: icon(9, 'M2 1h2v7H2zM5 1h2v7H5z') },
  { speed: 1, key: '1', label: 'Play at 1× speed', svg: icon(9, 'M3 1h1v7H3zM4 2h1v5H4zM5 3h1v3H5zM6 4h1v1H6z') },
  { speed: 2, key: '2', label: 'Fast play at 2× speed', svg: icon(9, tri(1) + tri(5)) },
  { speed: 4, key: '4', label: 'Faster play at 4× speed', svg: icon(13, tri(1) + tri(5) + tri(9)) },
];

export const simDate = years => { // years since the start, as "Mar 2029"
  const m = Math.floor(years * 12);
  return `${MONTHS[m % 12]} ${START_YEAR + Math.floor(m / 12)}`;
};

export function mountClockBar({ host = document.body, clock = simClock } = {}) {
  const buttons = BUTTONS.map(b => h('button', {
    class: 'tool-btn clock-btn', type: 'button', 'aria-label': b.label, title: `${b.label} (${b.key})`, 'aria-keyshortcuts': b.key === 'Space' ? 'Space' : b.key,
    'aria-pressed': 'false', html: b.svg, onclick: () => (b.speed ? clock.play(b.speed) : clock.pause()),
  }));
  const date = h('time', { class: 'clock-date' }), speed = h('span', { class: 'clock-speed' });
  const status = h('span', { class: 'clock-status', role: 'status', 'aria-live': 'polite' });
  const bar = h('div', { id: 'clock', class: 'plate clock', role: 'toolbar', 'aria-label': 'Simulation playback' },
    buttons, h('div', { class: 'clock-readout' }, date, h('span', { class: 'clock-sub' }, speed, status)));
  host.append(bar);

  let said = '';
  clock.subscribe(s => {
    const active = s.playing ? s.speed : 0;
    BUTTONS.forEach((b, i) => buttons[i].setAttribute('aria-pressed', String(b.speed === active)));
    const text = simDate(s.years);
    if (date.textContent !== text) { date.textContent = text; date.dateTime = `${START_YEAR + Math.floor(s.years)}-${String(Math.floor(s.years * 12) % 12 + 1).padStart(2, '0')}`; }
    speed.textContent = s.playing ? `${s.speed}×` : 'Paused';
    const msg = s.error ? 'Forecast failed · Play retries'
      : s.loading ? 'Loading forecast…'
      : s.stale && !s.playing ? 'Policy changed · Play to apply'
      : !s.playing && s.step >= s.steps ? 'End of forecast'
      : '';
    if (msg !== said) { said = msg; status.textContent = msg; }
    bar.classList.toggle('is-playing', s.playing);
    bar.classList.toggle('is-loading', s.loading);
    bar.classList.toggle('is-error', !!s.error);
  });

  // Shortcuts, except while typing, using another control that takes the key, with the policy panel open,
  // or before the city has loaded (the page hides the toolbar until then).
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || document.body.classList.contains('city-loading')) return;
    const space = e.key === ' ' || e.code === 'Space', n = { 1: 1, 2: 2, 4: 4 }[e.key];
    if (!space && !n) return;
    const t = e.target;
    if (t.closest?.('[role="dialog"], dialog, textarea, select, [contenteditable]')) return;
    if (t.closest?.('input') && !(t.type === 'range' && space)) return;
    if (space && t.closest?.('button, a[href], summary') && !bar.contains(t)) return; // Space presses the focused control
    e.preventDefault();
    if (e.repeat) return;
    if (space) clock.toggle(); else clock.play(n);
  });
  return bar;
}
