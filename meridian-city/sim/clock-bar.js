// The playback toolbar: one Play/Pause toggle, Fast (2x) and Faster (4x) speed toggles, the simulated month and
// year and the speed beside them, and a loading badge while the clock holds for a prediction. The speed is the clock's own, so
// it holds through pause and resume; picking one never plays or pauses, and pressing the lit one goes back to 1x.
// Keys: Space plays or pauses, 1, 2 and 4 pick that speed. The map toolbar's pixel-icon buttons and glass plate,
// so retro-ui.css skins it like the rest.
// The date is the forecast's own (clock.js): it moves only while the simulation plays and holds still while paused.
// Once the game is over and the last decade has played out, it reads the game's last month and "Game over".
import { h } from '../policy/components.js';
import { simClock, START_YEAR, growthReport } from './scenario.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tri = x => `M${x} 2h1v5H${x}zM${x + 1} 3h1v3H${x + 1}zM${x + 2} 4h1v1H${x + 2}z`; // a 3x5 pixel play triangle
const icon = (w, d) => `<svg viewBox="0 0 ${w} 9" style="width:${w * 2}px" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
const PLAY = icon(9, 'M3 1h1v7H3zM4 2h1v5H4zM5 3h1v3H5zM6 4h1v1H6z'), PAUSE = icon(9, 'M2 1h2v7H2zM5 1h2v7H5z');
const SPEED_BUTTONS = [
  { speed: 2, label: '2× speed', svg: icon(9, tri(1) + tri(5)) },
  { speed: 4, label: '4× speed', svg: icon(13, tri(1) + tri(5) + tri(9)) },
];

export const simDate = years => { // years since the start, as "Mar 2029"
  const m = Math.floor(years * 12);
  return `${MONTHS[m % 12]} ${START_YEAR + Math.floor(m / 12)}`;
};

export function mountClockBar({ host = document.body, clock = simClock, game = null } = {}) {
  // The toggle's name says what it does next (Play or Pause), so it has no pressed state of its own.
  const toggle = h('button', { class: 'tool-btn clock-btn clock-toggle', type: 'button', 'aria-keyshortcuts': 'Space', onclick: () => clock.toggle() });
  const speeds = SPEED_BUTTONS.map(b => h('button', {
    class: 'tool-btn clock-btn clock-rate', type: 'button', 'aria-label': b.label, title: `${b.label} (${b.speed}; press again for 1×, or 1)`,
    'aria-keyshortcuts': String(b.speed), 'aria-pressed': 'false', html: `${b.svg}<span class="clock-btn-text" aria-hidden="true">${b.speed}×</span>`,
    onclick: () => clock.setSpeed(clock.get().speed === b.speed ? 1 : b.speed),
  }));
  const date = h('time', { class: 'clock-date' }), speed = h('span', { class: 'clock-speed' });
  const status = h('span', { class: 'clock-status', role: 'status', 'aria-live': 'polite' });
  const bar = h('div', { id: 'clock', class: 'plate clock', role: 'toolbar', 'aria-label': 'Simulation playback' },
    toggle, h('div', { class: 'clock-rates', role: 'group', 'aria-label': 'Playback speed' }, speeds), h('div', { class: 'clock-readout' }, date, h('span', { class: 'clock-sub' }, speed, status)));
  host.append(bar);

  let said = '', unmet = 0, why = '', last = null;
  // Homes the forecast's conversions ask for that no valid land could hold: said, with the constraint, not forced in.
  growthReport.subscribe(r => { unmet = r && !r.before ? r.unmet : 0; why = unmet ? (r.constraints ?? []).join('\n') : ''; if (last) update(last); });
  clock.subscribe(update);
  game?.subscribe(() => { if (last) update(last); });
  function update(s) {
    last = s;
    const next = s.playing ? 'Pause' : 'Play';
    if (toggle.dataset.next !== next) {
      toggle.dataset.next = next;
      toggle.innerHTML = `${s.playing ? PAUSE : PLAY}<span class="clock-btn-text">${next}</span>`;
      toggle.title = `${next} (Space)`;
    }
    SPEED_BUTTONS.forEach((b, i) => speeds[i].setAttribute('aria-pressed', String(b.speed === s.speed)));
    // Finish seeks to the last step, which would read Jan of the last year; the game ended in its December.
    const ended = !!game?.get().over && !s.playing && !s.before && s.step >= s.steps;
    const years = s.before ? 0 : ended ? s.steps + 1 - 1e-9 : s.years, text = simDate(years); // "Show before" shows year 0, so its date
    if (date.textContent !== text) { date.textContent = text; date.dateTime = `${START_YEAR + Math.floor(years)}-${String(Math.floor(years * 12) % 12 + 1).padStart(2, '0')}`; }
    speed.textContent = ended ? 'Game over' : s.playing ? `${s.speed}×` : `Paused · ${s.speed}×`;
    const msg = s.error ? 'Forecast failed · Play retries'
      : s.loading ? 'Loading forecast…'
      : !ended && !s.playing && s.step >= s.steps ? 'End of the decade'
      : '';
    const note = unmet ? `${unmet.toLocaleString()} new home${unmet === 1 ? '' : 's'} didn't fit` : '';
    const line = [msg, note].filter(Boolean).join(' · ');
    if (line !== said) {
      said = line; status.textContent = line;
      status.title = note ? why || 'The policy asks for more homes than valid land can hold. They are counted as unmet, not drawn.' : '';
    }
    bar.classList.toggle('is-playing', s.playing);
    bar.classList.toggle('is-loading', s.loading);
    bar.classList.toggle('is-error', !!s.error);
  }

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
    if (space) clock.toggle(); else clock.setSpeed(n);
  });
  return bar;
}
