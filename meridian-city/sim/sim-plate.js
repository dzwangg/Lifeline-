// The sim plate: the results dashboard docked on the right. For the shown year (the shared clock, clock.js) it shows each
// metric as a tile (its value, its change against no new policy, CH-LUTI's 80% range and a sparkline), then the picked
// metric in detail: the change and the level over the years, why it changed (CH-LUTI's trace), which card did it and where.
// Also here: the game's turn (turns.js) and its End decade button, the applied cards' sliders, decider and tradeoffs, the
// resident picked on the map, the guided views, and the assumptions and sources. Values are the combined SimResult's
// central run (shared/combined.js); ranges, traces and per-card and per-zone splits come from CH-LUTI's 200 paired runs
// (shared/luti/run.js), once they arrive.
import { h, cls, GlassButton } from '../policy/components.js';
import { scenario, simClock, dataReady, devMode, demoMode, stubOn, stubAuto, START_YEAR, DECADE } from './scenario.js';
import { VARIABLES, explain, MODEL } from '../../shared/luti/run.js';
import { LEVERS } from '../../shared/luti/levers.js';
import { createModel } from '../../shared/luti/model.js';
import { paramRanges } from '../../shared/luti/params.js';
import { ZONES as LUTI_ZONES, SOURCES } from '../../shared/luti/data.js';
import { paramStep } from '../../shared/schema.js';
import { residentState, statusOf, STATUS } from './residents.js';

// Colour each change by whether it helps most people (green) or hurts (red). false shows every change in one neutral ink.
const VERDICT_COLORS = true;

const SVGNS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const yearLabel = y => `${START_YEAR + y}`;

// ---------- number formats ----------
const fixed = (n, d) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const FMT = {
  usd: v => `$${fixed(v, 0)}`,
  usdk: v => `$${fixed(v / 1e3, 0)}k`,
  usdm: v => `$${fixed(v / 1e6, Math.abs(v) < 1e7 ? 2 : 1)}M`,
  usdb: v => `$${fixed(v / 1e9, 2)}B`,
  int: v => fixed(v, 0),
  pct: v => `${fixed(v * 100, 1)}%`,       // shares stored 0–1; changes in points
  pctRaw: v => `${fixed(v, 1)}%`,          // shares stored 0–100 (tree cover); changes in points
  millions: v => `${fixed(v / 1e6, 2)}M`,
  min: v => `${fixed(v, 1)} min`,
  index: v => fixed(v, 3),
  dec: v => fixed(v, 1),
  cents: v => `${fixed(v, 1)}¢`,
};
const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '');
// A change: points for shares, percent for indexes, else the unit; "(+x%)" when withPct. Never "−0".
function fmtChange(fmt, d, base, withPct = false) {
  if (fmt === 'pct' || fmt === 'pctRaw') { const pts = fixed(Math.abs(fmt === 'pct' ? d * 100 : d), fmt === 'pct' ? 1 : 2); return `${+pts ? sign(d) : ''}${pts} pts`; }
  if (fmt === 'index') { const p = fixed(Math.abs(d / (base || 1)) * 100, 1); return `${+p ? sign(d) : ''}${p}%`; }
  const a = Math.abs(d), body = fmt === 'int' && a < 10 && a >= .05 ? fixed(a, 1) : (FMT[fmt] ?? FMT.dec)(a);
  if (!/[1-9]/.test(body)) return body;
  return `${sign(d)}${body}${withPct && base && fmt !== 'usdm' && fmt !== 'cents' ? ` (${sign(d)}${fixed(Math.abs(d / base) * 100, 1)}%)` : ''}`;
}

// The page's metrics, in tile order. key: the SimResult metric; luti: the CH-LUTI variable behind it (its ranges, trace and
// splits); model: which model computes it; better: the direction that helps most people (null: neither); zone: CH-LUTI's
// per-zone field for "Where".
const METRICS = [
  { key: 'medianRent', label: 'Median rent', fmt: 'usd', luti: 'rent', better: -1, zone: 'rent', model: 'CH-LUTI' },
  { key: 'housingUnits', label: 'Homes', fmt: 'int', luti: 'housingUnits', better: 1, zone: 'units', model: 'CH-LUTI, with the homes the zone rules build' },
  { key: 'pricedOut', label: 'Priced out (est.)', fmt: 'int', better: -1, model: 'the household model',
    title: 'Households living here in year 0 that have moved away because their rent rose faster than their income. An estimate.' },
  { key: 'households', label: 'Households (est.)', fmt: 'int', better: null, model: 'the household model' },
  { key: 'jobs', label: 'Jobs in town', fmt: 'int', luti: 'jobs', better: 1, model: 'CH-LUTI' },
  { key: 'businesses', label: 'Storefront businesses', fmt: 'int', luti: 'businesses', better: 1, zone: 'businesses', model: 'CH-LUTI' },
  { key: 'storefrontVacancy', label: 'Downtown storefront vacancy', fmt: 'pct', luti: 'storefrontVacancy', better: -1, zone: 'storefrontVacancy', model: 'CH-LUTI' },
  { key: 'transitRidership', label: 'Bus ridership', fmt: 'millions', luti: 'transitRidership', better: 1, model: 'CH-LUTI' },
  { key: 'avgCommuteMin', label: 'Average commute', fmt: 'min', luti: 'commuteTime', better: -1, model: 'CH-LUTI' },
  { key: 'trafficIndex', label: 'Car traffic', fmt: 'index', luti: 'trafficIndex', better: -1, model: 'CH-LUTI' },
  { key: 'treeCoverPct', label: 'Tree cover', fmt: 'pctRaw', better: 1, model: 'the land-use rules' },
  { key: 'homeValue', label: 'Median home value', fmt: 'usdk', luti: 'homeValue', better: null, model: 'CH-LUTI' },
  { key: 'taxRevenue', label: 'Property tax revenue', fmt: 'usdm', luti: 'propertyTax', better: 1, model: 'CH-LUTI' },
  { key: 'netFiscal', label: 'Town budget impact', fmt: 'usdm', luti: 'netFiscal', better: 1, diffOnly: true, model: 'CH-LUTI' },
];
const OTHER_MODEL = new Set(['households', 'population', 'rentBurden']); // CH-LUTI's own; the page shows the household model's
function tone(m, d, lo, hi, base) {
  const rel = Math.abs(base) > 1e-9 ? Math.abs(d / base) : Math.abs(d);
  if (rel < 5e-4 || (m.fmt === 'usdm' && Math.abs(d) < 5e4)) return 'flat';
  if (lo != null && lo < 0 && hi > 0) return 'mixed';
  if (!VERDICT_COLORS || m.better == null) return 'neutral';
  return Math.sign(d) === m.better ? 'good' : 'bad';
}

// ---------- charts (plain SVG) ----------
const svg = (tag, attrs = {}) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || Math.abs(hi) || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= step0);
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  if (out.at(-1) < hi) out.push(out.at(-1) + step);
  return out;
}
const path = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
const finite = a => a.filter(Number.isFinite);

// series: [{ label, values (one per year), kind: 'policy'|'base', band?: { lo, hi } }]; y is the shown year. fit: the px
// width the expanded plate shows it at, so it spans that width with its text a little over life size, and grows taller.
function lineChart({ series, y, tick, tip, zero = false, height = 168, title, fit = 0 }) {
  const W = Math.max(400, Math.round(fit / 1.2)), H = Math.round(height * Math.sqrt(W / 400)), P = { l: 58, r: 14, t: 12, b: 24 }, n = series[0].values.length;
  const vals = finite(series.flatMap(s => [...s.values, ...(s.band ? [...s.band.lo, ...s.band.hi] : [])]));
  if (zero) vals.push(0);
  let y0 = Math.min(...vals), y1 = Math.max(...vals);
  if (y1 - y0 < 1e-9) { y0 -= Math.abs(y0) * .01 || 1; y1 += Math.abs(y1) * .01 || 1; }
  const ticks = niceTicks(y0, y1, 4);
  y0 = Math.min(y0, ticks[0]); y1 = Math.max(y1, ticks.at(-1));
  const X = i => P.l + i / (n - 1) * (W - P.l - P.r), Y = v => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rp-chart', role: 'img', 'aria-label': title, tabindex: 0 });
  for (const t of ticks) {
    el.append(svg('line', { x1: P.l, x2: W - P.r, y1: Y(t), y2: Y(t), class: zero && t === 0 ? 'rp-zero' : 'rp-grid' }));
    const tx = svg('text', { x: P.l - 8, y: Y(t) + 4, class: 'rp-tick', 'text-anchor': 'end' }); tx.textContent = tick(t); el.append(tx);
  }
  for (let i = 0; i < n; i += n > 11 ? 5 : 2) {
    const tx = svg('text', { x: X(i), y: H - 6, class: 'rp-tick', 'text-anchor': 'middle' }); tx.textContent = yearLabel(i); el.append(tx);
  }
  for (let i = DECADE; i < n - 1; i += DECADE) el.append(svg('line', { x1: X(i), x2: X(i), y1: P.t, y2: H - P.b, class: 'rp-decade' })); // a game's turns
  for (const s of series) if (s.band) el.append(svg('path', { d: path([...s.band.hi.map((v, i) => [X(i), Y(v)]), ...s.band.lo.map((v, i) => [X(i), Y(v)]).reverse()]) + 'Z', class: `rp-band is-${s.kind}` }));
  for (const s of series) el.append(svg('path', { d: path(s.values.map((v, i) => [X(i), Y(v)])), class: `rp-line is-${s.kind}` }));
  el.append(svg('line', { x1: X(y), x2: X(y), y1: P.t, y2: H - P.b, class: 'rp-now' }));
  for (const s of series) el.append(svg('circle', { r: 4, cx: X(y), cy: Y(s.values[y]), class: `rp-dot is-${s.kind}` }));
  // crosshair + tooltip
  const hair = svg('line', { y1: P.t, y2: H - P.b, class: 'rp-hair', visibility: 'hidden' });
  el.append(hair);
  const tipEl = h('div', { class: 'rp-tip', role: 'status', hidden: true });
  const wrap = h('div', { class: 'rp-chartwrap' }, el, tipEl);
  let hover = null;
  function show(i) {
    hover = i;
    hair.setAttribute('x1', X(i)); hair.setAttribute('x2', X(i)); hair.setAttribute('visibility', 'visible');
    tipEl.replaceChildren(h('div', { class: 'rp-tip__when' }, `${yearLabel(i)} · year ${i}`), ...series.map(s => h('div', { class: 'rp-tip__row' },
      h('span', { class: `rp-key is-${s.kind}`, 'aria-hidden': 'true' }),
      h('strong', {}, tip(s.values[i])),
      h('span', {}, s.band && Number.isFinite(s.band.lo[i]) && i ? ` ${s.label} · range ${tip(s.band.lo[i])} to ${tip(s.band.hi[i])}` : ` ${s.label}`))));
    tipEl.hidden = false;
    const r = el.getBoundingClientRect(), px = X(i) / W * r.width;
    tipEl.style.left = `${Math.min(Math.max(px, 90), r.width - 90)}px`;
  }
  const hide = () => { hover = null; hair.setAttribute('visibility', 'hidden'); tipEl.hidden = true; };
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W;
    show(Math.max(0, Math.min(n - 1, Math.round((x - P.l) / (W - P.l - P.r) * (n - 1)))));
  });
  el.addEventListener('pointerleave', hide);
  el.addEventListener('focus', () => show(y));
  el.addEventListener('blur', hide);
  el.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); show(Math.max(0, Math.min(n - 1, (hover ?? y) + (e.key === 'ArrowRight' ? 1 : -1))));
  });
  return wrap;
}

function sparkline(values, band, y) {
  const W = 120, H = 30, n = values.length, vals = finite([...values, ...(band ? [...band.lo, ...band.hi] : []), 0]);
  const y0 = Math.min(...vals), y1 = Math.max(...vals), span = y1 - y0 || 1;
  const X = i => 2 + i / (n - 1) * (W - 4), Y = v => 3 + (1 - (v - y0) / span) * (H - 6);
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rp-spark', 'aria-hidden': 'true' });
  el.append(svg('line', { x1: 2, x2: W - 2, y1: Y(0), y2: Y(0), class: 'rp-zero' }));
  if (band) el.append(svg('path', { d: path([...band.hi.map((v, i) => [X(i), Y(v)]), ...band.lo.map((v, i) => [X(i), Y(v)]).reverse()]) + 'Z', class: 'rp-band is-policy' }));
  el.append(svg('path', { d: path(values.map((v, i) => [X(i), Y(v)])), class: 'rp-line is-policy' }));
  el.append(svg('circle', { r: 3, cx: X(y), cy: Y(values[y]), class: 'rp-dot is-policy' }));
  return el;
}

// horizontal bars around a zero line: rows [{ label, value, text, note? }]
function barList(rows, caption) {
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1e-12);
  return h('div', { class: 'rp-bars', role: 'list', 'aria-label': caption }, rows.map(r =>
    h('div', { class: 'rp-barrow', role: 'listitem' },
      h('span', { class: 'rp-barrow__label' }, r.label, r.note && h('small', {}, r.note)),
      h('span', { class: 'rp-barrow__track' }, h('span', { class: cls('rp-bar', r.value < 0 && 'is-neg'), style: { '--w': `${Math.abs(r.value) / max * 50}%` } })),
      h('span', { class: 'rp-barrow__value' }, r.text))));
}

// ---------- resident card helpers ----------
const WORK = { remote: 'Works from home', durham: 'Works in Durham', campus: 'Works at UNC', downtown: 'Works downtown' };
const WHERE = { downtown: 'near Franklin St', campus: 'near campus', edge: 'at the edge of town', corridor: 'along 15-501' };
const money = n => `$${fixed(n, 0)}`, share = b => `${Math.round(b * 100)}%`;
const flagOf = source => /^(PLACEHOLDER|VERIFY)/.exec(source ?? '')?.[1];
const quarters = n => `${n} quarter${n === 1 ? '' : 's'}`;
const timing = ({ delayQuarters: d, phaseInQuarters: p }) => `Starts after ${quarters(d)}, ${p > 1 ? `phasing in over ${quarters(p)}` : 'in full at once'}.`;

export async function mountSimPlate({ policyStore, cards, game, host = document.body }) {
  const [, assumptions, baselines] = await dataReady;
  const cardById = new Map(cards.map(c => [c.id, c]));
  const ui = { metric: null, picked: false, active: [], confirming: false, expanded: false };

  // ---------- skeleton ----------
  const kicker = h('p', { class: 'rp-kicker' });
  const title = h('h2', { class: 'rp-title' }, 'Policy simulation');
  const chips = h('div', { class: 'rp-chips' });
  const expandBtn = h('button', { class: 'sim__toggle', type: 'button', title: 'Fill the window with the results', onclick: () => setExpanded(!ui.expanded) }, 'Expand');
  const toggle = h('button', { class: 'sim__toggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'sim-body', onclick: () => setHidden(!body.hidden) }, 'Hide');
  const playBtn = h('button', { class: 'rp-play', type: 'button', 'aria-label': 'Play the forecast', onclick: () => simClock.toggle() });
  const yearIn = h('input', { class: 'rp-slider', type: 'range', min: 0, max: simClock.get().steps, step: 1, value: 0, 'aria-label': 'Year shown in the city and the results', oninput: () => simClock.seek(+yearIn.value) });
  const when = h('output', { class: 'rp-when' });
  const beforeIn = h('input', { type: 'checkbox', onchange: () => simClock.setBefore(beforeIn.checked) });
  // Guided views (focus.js): each button reads "Back" while its view is on. The wipe compares year 0 with the shown year.
  const viewBtn = (focus, label) => h('button', { class: 'sim__road', type: 'button', 'aria-pressed': 'false',
    onclick: () => scenario.set({ focus: scenario.get().focus === focus ? null : focus, focusZones: null }) }, label);
  const changesBtn = viewBtn('changes', 'Show changes'), roadBtn = viewBtn('road', 'View 15-501');
  const wipeBtn = h('button', { class: 'sim__road', type: 'button', 'aria-pressed': 'false', onclick: () => scenario.set({ wipe: !scenario.get().wipe }) }, 'Before / after');
  const turnRow = h('div', { class: 'rp-turn', 'aria-live': 'polite' });
  const demoBtn = demoMode && h('button', { class: 'sim__road sim__demo', type: 'button', onclick: runDemo }, 'Demo scenario');
  const meta = h('p', { class: 'rp-meta' });
  const settings = h('details', { class: 'rp-settings' });
  const residentEl = h('div', { class: 'sim__resident', 'aria-live': 'polite' });
  const tiles = h('div', { class: 'rp-tiles', role: 'list', 'aria-label': 'Metrics, with their change against no new policy' });
  const detail = h('section', { class: 'rp-detail', 'aria-live': 'polite' });
  const assume = h('details', { class: 'rp-assume' }, h('summary', {}, 'Assumptions, sources and checks'));
  const dlBtn = h('button', { class: 'rp-dl', type: 'button', onclick: download }, 'Download scenario and results (JSON)');
  const scroll = h('div', { class: 'rp-scroll' }, h('div', { class: 'rp-side' }, residentEl, tiles), detail, assume, dlBtn,
    h('div', { class: 'rp-foot' },
      h('a', { class: 'sim__sources', href: 'sources.html', target: '_blank', rel: 'noopener' }, 'Sources'),
      devMode && !stubAuto && h('label', { class: 'sim__check sim__dev' }, h('input', { type: 'checkbox', checked: stubOn, onchange: e => toggleStub(e.target.checked) }), 'Load stub card (dev)')));
  const body = h('div', { class: 'rp-body', id: 'sim-body' },
    turnRow,
    h('div', { class: 'rp-time' }, playBtn, yearIn, when),
    h('div', { class: 'rp-views' },
      h('label', { class: 'sim__check' }, beforeIn, 'Show before (year 0)'),
      changesBtn, roadBtn, wipeBtn,
      demoBtn),
    meta, settings, scroll);
  const plate = h('section', { class: 'plate sim rp', 'aria-label': 'Policy simulation results' },
    h('header', { class: 'rp-head' },
      h('div', { class: 'rp-head__text' }, kicker, title, chips),
      h('div', { class: 'rp-head__actions' }, expandBtn, toggle)),
    body);
  host.append(plate);
  // Hiding the results also shrinks the plate back to its dock; expanding shows them.
  function setHidden(hide) {
    body.hidden = hide;
    toggle.setAttribute('aria-expanded', String(!hide));
    toggle.textContent = hide ? 'Show' : 'Hide';
    if (hide) setExpanded(false);
  }
  // Expanded, the plate fills the window over the city (sim-plate.css) and redraws its charts larger. Escape shrinks it.
  function setExpanded(on) {
    if (on === ui.expanded) return;
    ui.expanded = on;
    if (on) setHidden(false);
    plate.classList.toggle('is-expanded', on);
    expandBtn.textContent = on ? 'Shrink' : 'Expand';
    expandBtn.title = on ? 'Shrink the results back to the side (Esc)' : 'Fill the window with the results';
    drawn = []; render();
  }
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && ui.expanded && !e.defaultPrevented && !e.target.closest?.('[role="dialog"]')) setExpanded(false);
  });
  addEventListener('resize', () => { if (ui.expanded) { drawn = []; render(); } }); // the charts fit the new width

  // ---------- the game's cards drive the sim: the ones enacted in past decades, then those applied for this one ----------
  const decade = (from, to) => `${yearLabel(from)}–${yearLabel(to)}`;
  const enactedIn = id => game.get().enacted.find(e => e.id === id)?.turn ?? null;
  let shownKey = null;
  const sync = () => {
    const ids = game.cardIds(), starts = game.starts(), key = JSON.stringify([ids, starts, game.get().enacted]);
    if (key === shownKey) return; // the panel also emits while its draft changes; enacting changes only how cards show
    shownKey = key;
    const active = ui.active = ids.map(id => cardById.get(id)).filter(Boolean);
    const other = ids.filter(id => !cardById.has(id)).map(id => policyStore.getPolicy(id)?.title ?? id);
    title.textContent = active.length ? policyStore.getState().scenarioName : 'Policy simulation';
    chips.replaceChildren(...(active.length
      ? active.map(c => {
        const cat = policyStore.categories.find(x => x.id === c.category), turn = enactedIn(c.id);
        return h('span', { class: cls('rp-chip', turn !== null && 'is-enacted'), style: cat ? { '--cat': cat.color, '--cat-deep': cat.deep } : null,
          title: turn !== null ? `Enacted in ${yearLabel(DECADE * turn)}; in force for the rest of the game` : 'Applied for this decade' },
          c.title, turn !== null && h('small', {}, ` · since ${yearLabel(DECADE * turn)}`));
      })
      : [h('span', { class: 'rp-empty' }, !cards.length ? 'No policies yet.' : 'Apply a policy card in the Policies panel to simulate it.')]),
      ...(other.length ? [h('span', { class: 'rp-empty' }, `Not simulated yet: ${other.join(', ')}.`)] : []));
    const planned = active.filter(c => enactedIn(c.id) === null);
    settings.hidden = !active.length;
    settings.replaceChildren(h('summary', {}, planned.length === active.length ? `Adjust your policies (${active.length})` : `Your policies (${planned.length} this decade, ${active.length - planned.length} in force)`),
      h('div', { class: 'sim__list' }, active.map(Card)));
    ui.picked = false; // open on whatever this package moves most, once it has run
    scenario.set({ cards: active, starts });
  };

  // The turn: which decade this is, and ending it (after a confirm, as it can't be undone).
  function renderTurn() {
    const g = game.get(), n = game.cardIds().length - g.enacted.length, end = yearLabel(DECADE * g.turns);
    kicker.textContent = g.over ? `Game complete · ${decade(0, g.to)}` : `Decade ${g.turn + 1} of ${g.turns} · ${decade(g.from, g.to)}`;
    if (g.over) {
      turnRow.replaceChildren(h('p', { class: 'rp-turn__text' }, `All ${g.turns} decades are played. Here is your Chapel Hill in ${yearLabel(g.to)}, compared with a town that adopted no new policy.`),
        h('div', { class: 'rp-turn__actions' }, GlassButton('New game', { variant: 'quiet', onclick: () => location.reload() })));
      return;
    }
    const these = `${n} polic${n === 1 ? 'y' : 'ies'}`, finish = g.last ? 'Finish the game' : `End decade ${g.turn + 1}`;
    // Each choice re-renders the row, then focuses its first button, so keyboard focus isn't lost with the old one.
    const choose = confirming => () => { ui.confirming = confirming; renderTurn(); turnRow.querySelector('button')?.focus(); };
    if (ui.confirming) {
      turnRow.replaceChildren(
        h('p', { class: 'rp-turn__text' }, n
          ? `Enact ${these} for ${decade(g.from, g.to)}? They stay in force until ${end} and leave your library. You can't undo this.`
          : `End ${decade(g.from, g.to)} with no new policy? You can't undo this.`),
        h('div', { class: 'rp-turn__actions' },
          GlassButton(g.last ? 'Finish the game' : 'Enact and continue', { variant: 'primary', onclick: () => { ui.confirming = false; game.endTurn(); turnRow.querySelector('button')?.focus(); } }),
          GlassButton('Keep planning', { variant: 'quiet', onclick: choose(false) })));
      return;
    }
    turnRow.replaceChildren(
      h('p', { class: 'rp-turn__text' }, n
        ? `${these} applied for this decade. Play and adjust as often as you like, then end the decade to enact ${n === 1 ? 'it' : 'them'}.`
        : 'Apply policies for this decade in the Policies panel and play it, then end the decade.'),
      h('div', { class: 'rp-turn__actions' }, GlassButton(finish, { variant: 'primary', onclick: choose(true) })));
  }
  policyStore.subscribe(() => { sync(); renderTurn(); });
  game.subscribe(() => { sync(); renderTurn(); });

  // ?demo: edge subdivisions at their most plus core infill, played from year 0 at 2x. Only in a game's first decade, before
  // anything is enacted: later it would re-apply enacted cards and change their locked settings.
  const demoOpen = () => { const g = game.get(); return !g.turn && !g.over && !g.enacted.length; };
  game.subscribe(() => {
    if (!demoBtn) return;
    demoBtn.disabled = !demoOpen();
    demoBtn.title = demoOpen() ? '' : 'The demo plays from the start of a game. Start a new game to see it.';
  });
  function runDemo() {
    const edge = cardById.get('edge-subdivisions'), core = cardById.get('core-infill');
    if (!demoOpen()) return;
    if (!edge || !core) return console.warn('The demo needs the edge-subdivisions and core-infill cards.');
    scenario.set({ params: { ...scenario.get().params, [edge.id]: Object.fromEntries(edge.params.map(p => [p.key, p.max])) }, focus: null, focusZones: null });
    policyStore.clear();
    policyStore.place(edge.id, 'housing-1');
    policyStore.place(core.id, 'housing-2');
    policyStore.apply();
    simClock.seek(0);
    simClock.play(2);
  }

  // ---------- render: only when the shown year, its data, the resident, CH-LUTI's runs or the picked metric change ----------
  let drawn = [], run = null, y = 0, luti = null;
  function render() {
    const c = simClock.get(), { resident } = scenario.get();
    luti = scenario.get().luti;
    beforeIn.checked = c.before;
    playBtn.classList.toggle('is-playing', c.playing);
    playBtn.setAttribute('aria-label', c.playing ? 'Pause' : 'Play the forecast');
    if (!c.shown?.data) return;
    const now = [c.shown, c.before, resident, luti, ui.metric];
    if (now.every((v, i) => v === drawn[i])) return; // the clock emits every frame while playing
    drawn = now;
    run = c.shown.data.run;
    y = c.before ? 0 : c.shown.step;
    yearIn.max = c.steps; // a game's next turn runs a decade further
    yearIn.value = c.shown.step;
    when.replaceChildren(h('strong', {}, yearLabel(y)), h('span', {}, c.before ? 'year 0 (before)' : `year ${y}`));
    const first = run.result.timeline[0].zoneStates, last = run.result.timeline.at(-1).zoneStates;
    changesBtn.disabled = !scenario.get().focus && Object.keys(last).every(id => last[id] === first[id]); // nothing to show
    meta.replaceChildren(
      h('strong', {}, 'Under these assumptions, this is a plausible range of outcomes, not a forecast. '),
      luti ? `${MODEL.id} v${MODEL.version} · ${luti.runs} paired runs · seed ${luti.seed}` : `${MODEL.id} v${MODEL.version} · ranges loading…`);
    if (!ui.picked) ui.metric = pickMetric();
    renderTiles();
    renderDetail();
    renderResident(run.households, resident, y);
  }
  simClock.subscribe(render);
  scenario.subscribe(s => {
    for (const [btn, focus, label] of [[changesBtn, 'changes', 'Show changes'], [roadBtn, 'road', 'View 15-501']]) {
      btn.textContent = s.focus === focus ? 'Back' : label;
      btn.setAttribute('aria-pressed', String(s.focus === focus));
    }
    wipeBtn.setAttribute('aria-pressed', String(!!s.wipe));
    drawn = []; // the changes button and the ranges depend on the scenario too
    render();
  });

  // A metric's yearly values from the central run, its no-policy values, and CH-LUTI's yearly P10–P90 change (null before
  // CH-LUTI has run, or for metrics from the other models). Year y ends with CH-LUTI's quarter 4y − 1; year 0 is today.
  // CH-LUTI's runs for an older set of cards, or a shorter game, are not shown while the new ones run.
  // A declaration, not a const: render() can run as soon as the clock subscription above fires.
  function lutiCurrent() {
    return luti && luti.policies.join() === ui.active.filter(c => c.levers?.length).map(c => c.id).join()
      && luti.years.length === 4 * (run.result.timeline.length - 1);
  }
  function series(m) {
    const pol = run.result.timeline.map(t => t.metrics[m.key]), base = run.noPolicy.timeline.map(t => t.metrics[m.key]);
    const diff = pol.map((v, i) => v - base[i]);
    const d = lutiCurrent() && m.luti && luti.diff[m.luti];
    const band = d ? { lo: diff.map((_, i) => (i ? d.p10[4 * i - 1] : 0)), hi: diff.map((_, i) => (i ? d.p90[4 * i - 1] : 0)) } : null;
    return { pol, base, diff, band };
  }
  function pickMetric() { // open on whatever moved most by the last year
    let best = METRICS[0].key, score = -1;
    for (const m of METRICS) {
      if (m.diffOnly) continue;
      const last = run.result.timeline.at(-1).metrics[m.key], b = run.noPolicy.timeline.at(-1).metrics[m.key];
      const s = m.fmt === 'pct' ? Math.abs(last - b) * 10 : m.fmt === 'pctRaw' ? Math.abs(last - b) / 10 : Math.abs((last - b) / (b || 1));
      if (s > score) { score = s; best = m.key; }
    }
    return best;
  }

  // ---------- tiles ----------
  function renderTiles() {
    tiles.replaceChildren(...METRICS.map(m => {
      const { pol, base, diff, band } = series(m), d = diff[y], lo = band && y ? band.lo[y] : null, hi = band && y ? band.hi[y] : null;
      const t = tone(m, d, lo, hi, base[y]);
      const spread = lo != null && fmtChange(m.fmt, lo, base[y]) !== fmtChange(m.fmt, hi, base[y]); // when every run agrees there is no range to show
      const word = { good: 'better', bad: 'worse', mixed: 'uncertain', neutral: 'changed', flat: 'no clear change' }[t];
      return h('button', {
        class: cls('rp-tile', `is-${t}`, m.key === ui.metric && 'is-selected'), type: 'button', role: 'listitem', title: m.title,
        'aria-pressed': m.key === ui.metric ? 'true' : 'false',
        onclick: () => { ui.metric = m.key; ui.picked = true; drawn = []; render(); detail.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); },
      },
        h('span', { class: 'rp-tile__label' }, m.label),
        h('span', { class: 'rp-tile__value' }, m.diffOnly ? `${fmtChange(m.fmt, d, base[y])}/yr` : (FMT[m.fmt])(pol[y])),
        h('span', { class: 'rp-tile__delta' },
          h('span', { class: 'rp-tile__arrow', 'aria-hidden': 'true' }, t === 'flat' ? '•' : d > 0 ? '▲' : '▼'),
          t === 'flat' ? 'no clear change' : m.diffOnly ? 'vs. no new policy' : fmtChange(m.fmt, d, base[y]),
          h('span', { class: 'rp-sr' }, `, ${word}`)),
        h('span', { class: 'rp-tile__range' }, t !== 'flat' && spread ? `range ${fmtChange(m.fmt, lo, base[y])} to ${fmtChange(m.fmt, hi, base[y])}` : ' '),
        sparkline(diff, band, y));
    }));
  }

  // ---------- detail ----------
  function renderDetail() {
    const m = METRICS.find(x => x.key === ui.metric) ?? METRICS[0];
    const { pol, base, diff, band } = series(m), q = 4 * y - 1, fit = ui.expanded ? detail.clientWidth : 0;
    const short = v => fmtChange(m.fmt, v, null);
    const kids = [
      h('h3', { class: 'rp-h3' }, m.label, h('span', {}, ` · ${yearLabel(y)}`)),
      h('p', { class: 'rp-lede' }, summary(m, diff, base, band)),
      h('h4', { class: 'rp-h4' }, 'Change vs. no new policy'),
      h('div', { class: 'rp-legend' }, h('span', { class: 'rp-key is-policy' }), 'Central estimate', band && [h('span', { class: 'rp-swatch' }), '80% of runs fall in the band']),
      lineChart({ title: `${m.label}: change vs. no new policy`, y, zero: true, fit, series: [{ label: 'change', kind: 'policy', values: diff, band }],
        tick: v => (Math.abs(v) < 1e-12 ? '0' : short(v).replace(/^\+/, '')), tip: short }),
    ];
    if (!m.diffOnly) kids.push(
      h('h4', { class: 'rp-h4' }, 'Level, with and without the policies'),
      h('div', { class: 'rp-legend' }, h('span', { class: 'rp-key is-base' }), 'No new policy', h('span', { class: 'rp-key is-policy' }), 'With these policies'),
      lineChart({ title: `${m.label}: level`, y, height: 150, fit, series: [
        { label: 'no new policy', kind: 'base', values: base },
        { label: 'with policies', kind: 'policy', values: pol },
      ], tick: v => FMT[m.fmt](v), tip: v => FMT[m.fmt](v) }));
    kids.push(h('h4', { class: 'rp-h4' }, 'Why it changed'));
    if (!m.luti) kids.push(h('p', { class: 'rp-note' }, `${m.label} comes from ${m.model}, which CH-LUTI's trace doesn't cover.`));
    else if (!lutiCurrent()) kids.push(h('p', { class: 'rp-note' }, 'Running CH-LUTI’s 200 paired futures…'));
    else if (!y || !ui.active.length) kids.push(h('p', { class: 'rp-note' }, 'No change to trace yet. Move the year forward or apply a policy.'));
    else kids.push(whyTree(explain(luti, m.luti, q)),
      h('p', { class: 'rp-note' }, 'Traced through CH-LUTI at central assumptions. Each line is a model variable; branches that barely moved are left out.'));
    if (lutiCurrent() && m.luti && y && luti.perPolicy.length > 1) {
      const lb = luti.baseline[m.luti].p50[q];
      kids.push(h('h4', { class: 'rp-h4' }, 'Which policy did it'), barList(luti.perPolicy.map(pp => ({
        label: cardById.get(pp.id)?.title ?? pp.title, value: pp.diff[q][m.luti], text: fmtChange(VARIABLES[m.luti]?.fmt ?? 'dec', pp.diff[q][m.luti], lb),
      })), 'Effect of each policy on its own'),
      h('p', { class: 'rp-note' }, 'Each card run on its own in CH-LUTI at central assumptions; together they can add up to more or less than the sum.'));
    }
    if (lutiCurrent() && m.zone && y && ui.active.length) {
      const bz = luti.mid.baseline.zones[q], pz = luti.mid.policy.zones[q], f = VARIABLES[m.luti]?.fmt;
      kids.push(h('h4', { class: 'rp-h4' }, 'Where'), barList(LUTI_ZONES.map((z, i) => {
        const dv = pz[i][m.zone] - bz[i][m.zone], value = f === 'pct' ? dv : dv / (bz[i][m.zone] || 1);
        return { label: z.label, value, text: f === 'pct' ? fmtChange('pct', dv) : `${sign(value)}${fixed(Math.abs(value * 100), 1)}%` };
      }), 'Change by zone'));
    }
    kids.push(h('h4', { class: 'rp-h4' }, 'On the map'), h('p', { class: 'rp-note' }, mapNote()));
    detail.replaceChildren(...kids);
  }

  function summary(m, diff, base, band) {
    const d = diff[y], lo = band && y ? band.lo[y] : null, hi = band && y ? band.hi[y] : null, t = tone(m, d, lo, hi, base[y]);
    if (!y) return `Year 0 is today: ${m.label.toLowerCase()} is the same with or without the policies. Move the year forward or press play.`;
    if (t === 'flat') return `By ${yearLabel(y)}, these policies barely move ${m.label.toLowerCase()}.`;
    const range = lo != null && fmtChange(m.fmt, lo, base[y]) === fmtChange(m.fmt, hi, base[y]) ? ` All of CH-LUTI's ${luti.runs} runs agree on it.`
      : lo != null ? ` In 80% of CH-LUTI's ${luti.runs} runs the change falls between ${fmtChange(m.fmt, lo, base[y])} and ${fmtChange(m.fmt, hi, base[y])}${t === 'mixed' ? ', so even the direction is uncertain.' : '.'}`
      : m.luti ? '' : ` This is ${m.model}'s central estimate; it has no range.`;
    return `By ${yearLabel(y)}, ${m.label.toLowerCase()} is ${fmtChange(m.fmt, d, base[y], true)} compared with no new policy.${range}`;
  }

  // Parcels whose use the zone rules changed by the shown year, with and without the cards.
  function mapNote() {
    const changed = r => { const t0 = r.timeline[0].zoneStates, t = r.timeline[y].zoneStates; return Object.keys(t).filter(id => t[id] !== t0[id]).length; };
    const withP = changed(run.result), without = changed(run.noPolicy);
    const parcels = n => `${n} parcel${n === 1 ? '' : 's'}`;
    return `By ${yearLabel(y)}: ${parcels(withP)} changed use with these policies, vs. ${parcels(without)} with no new policy. Use Show changes to fly to them, or Before / after to compare with today.`;
  }

  function whyTree(node) {
    const item = (n, depth) => {
      const v = VARIABLES[n.id] ?? { label: n.id }, f = v.fmt ?? 'dec';
      const kids = n.children.filter(c => !OTHER_MODEL.has(c.id)).sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel)).slice(0, 3);
      return h('li', { class: 'rp-why__item' },
        h('span', { class: 'rp-why__row' },
          h('span', { class: 'rp-why__arrow', 'aria-hidden': 'true' }, n.delta > 0 ? '▲' : '▼'),
          h('span', { class: 'rp-why__label' }, v.label),
          h('span', { class: 'rp-why__delta' }, fmtChange(f, n.delta, n.base), depth && f !== 'pct' && f !== 'index' && Math.abs(n.base) > 1e-9 ? ` (${sign(n.rel)}${fixed(Math.abs(n.rel * 100), 1)}%)` : '')),
        kids.length > 0 && h('ul', { class: 'rp-why__kids' }, kids.map(c => item(c, depth + 1))));
    };
    return h('ul', { class: 'rp-why' }, item(node, 0));
  }

  // ---------- applied cards: sliders, decider, tradeoffs ----------
  function Card(card) {
    const values = scenario.get().params[card.id] ?? {}, turn = enactedIn(card.id), locked = turn !== null;
    const hint = h('p', { class: 'sim-card__hint', hidden: locked || !changesNothing(card, values) }, 'At this setting the card changes nothing. Move the slider to try it.');
    return h('section', { class: cls('sim-card', locked && 'is-enacted') },
      h('h3', {}, card.title),
      locked && h('p', { class: 'sim-card__enacted' }, `Enacted for ${decade(DECADE * turn, DECADE * (turn + 1))}: in force for the rest of the game, at these settings.`),
      h('p', { class: 'sim-card__summary', title: card.summary }, card.summary),
      card.params.map(p => Slider(card, p, values[p.key] ?? p.default, now => { hint.hidden = !changesNothing(card, now); }, locked)),
      hint,
      h('details', { class: 'sim-card__decider' },
        h('summary', {}, 'Who decides: ', card.decider.body),
        card.decider.how.length > 0 && h('ol', {}, card.decider.how.map(s => h('li', {}, s)))),
      h('div', { class: 'sim-card__tradeoffs' },
        h('div', {}, h('h4', {}, 'Pros'), h('ul', {}, card.tradeoffs.pros.map(s => h('li', {}, s)))),
        h('div', {}, h('h4', {}, 'Cons'), h('ul', {}, card.tradeoffs.cons.map(s => h('li', {}, s))))));
  }
  function Slider(card, p, value, onChange, locked) {
    const show = v => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}${p.unit ? ` ${p.unit}` : ''}`;
    const out = h('output', { class: 'sim__val' }, show(value));
    return h('label', { class: 'sim__slider' },
      h('span', {}, p.label, ' ', out),
      h('input', { type: 'range', min: p.min, max: p.max, step: paramStep(p), value, disabled: locked, oninput: e => {
        const v = +e.target.value, params = scenario.get().params;
        out.textContent = show(v);
        scenario.set({ params: { ...params, [card.id]: { ...params[card.id], [p.key]: v } } });
        onChange(scenario.get().params[card.id]);
      } }));
  }

  // ---------- the resident picked on the map, as of the shown year ----------
  // Its state is the one its dot reads (residents.js).
  function renderResident(households, resident, yr) {
    const a = residentState(households, resident);
    const close = h('button', { class: 'resident__close', type: 'button', 'aria-label': 'Close resident card', onclick: () => scenario.set({ resident: null }) }, '×');
    if (resident == null) return residentEl.replaceChildren();
    if (!a) return residentEl.replaceChildren(h('section', { class: 'resident' }, h('header', { class: 'resident__head' }, h('h3', {}, 'Not in this scenario'), close),
      h('p', { class: 'resident__story' }, `Resident ${resident} doesn't live in town under these policies.`)));
    const at = a.hist[Math.min(Math.max(yr, a.joined), a.left ?? a.hist.length - 1)], dot = statusOf(a, yr);
    const status = a.street ? 'Street resident · not in the model\'s counts' : yr < a.joined ? `Moves here in year ${a.joined}` : a.left !== null && a.left <= yr ? `Left in year ${a.left}` : a.joined ? `Moved in year ${a.joined}` : 'Lives here';
    residentEl.replaceChildren(h('section', { class: 'resident' },
      h('header', { class: 'resident__head' },
        h('h3', {}, dot && h('span', { class: 'resident__dot', style: { '--dot': STATUS[dot].color }, title: STATUS[dot].label, 'aria-label': STATUS[dot].label }), a.name),
        close),
      h('p', { class: 'resident__status' }, status, h('span', { class: 'resident__id' }, resident)),
      h('dl', { class: 'resident__facts' },
        h('dt', {}, 'Job'), h('dd', {}, a.student ? (a.work === 'campus' ? 'Student at UNC' : `Student; ${WORK[a.work].toLowerCase()}`) : WORK[a.work]),
        h('dt', {}, 'Home'), h('dd', {}, a.renter ? 'Renter' : 'Owner'),
        h('dt', {}, 'Income'), h('dd', {}, `${money(at.income)} a year`),
        h('dt', {}, 'Rent'), h('dd', {}, a.renter ? `${money(at.rent)}/mo · ${share(at.burden)} of income` : 'None, owns home'),
        h('dt', {}, 'Commute'), h('dd', {}, a.work === 'remote' ? 'None, works from home' : `${at.commute} min`)),
      h('p', { class: 'resident__story' }, story(a, yr, at)),
      a.renter && ResidentSpark(a, yr)));
  }

  // ---------- assumptions, sources and checks (built when opened) ----------
  let checks = null;
  assume.addEventListener('toggle', () => { if (assume.open) renderAssumptions(); });
  function renderAssumptions() {
    if (!checks) { // how far CH-LUTI's rents move when the stock grows 1% (Mense 2025: about −0.19)
      const model = createModel(assumptions, baselines), p = model.midParams();
      const b = model.simulate(p, [], { seedEvents: false }).series, s = model.simulate(p, [], { seedEvents: false, shock: { units: 0.01 } }).series;
      checks = { rentToSupply: (s[20].rent / b[20].rent - 1) / 0.01 };
    }
    const groups = {};
    for (const [k, p] of Object.entries(paramRanges(assumptions))) (groups[p.group ?? 'Other model settings (data/assumptions.json)'] ??= []).push([k, p]);
    const num = v => (Math.abs(v) >= 1000 ? fixed(v, 0) : String(+v.toPrecision(3)));
    const range = p => `${num(p.lo)} · ${num(p.mid)} · ${num(p.hi)}${p.unit ? (p.unit.startsWith('/') ? p.unit : ` ${p.unit}`) : ''}`;
    const link = (label, url) => (url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, label) : label);
    const t0 = run?.noPolicy.timeline[0].metrics;
    assume.replaceChildren(
      h('summary', {}, 'Assumptions, sources and checks'),
      h('p', { class: 'rp-note' }, `${MODEL.name} (${MODEL.method}), combined with the land-use rules and the household model. Year 0 is ${START_YEAR}; each of the game's ${game.get().turns} turns runs the forecast ten years further, and a policy enacted in a turn starts in that decade. Beyond ten years the models extend today's trends, so later decades are less certain than the first.`),
      ui.active.length > 0 && [h('h4', { class: 'rp-h4' }, 'How this package works'),
        h('ul', { class: 'rp-list' }, ui.active.map(c => h('li', {},
          h('strong', {}, c.title), ` — ${c.summary} `,
          h('span', { class: 'rp-muted' }, `Decided by ${c.decider.body}.${c.timing ? ` ${timing(c.timing)}` : ''}`),
          c.evidence?.length > 0 && h('ul', {}, c.evidence.map(e => h('li', { class: 'rp-muted' }, `${e.claim} — `, link(e.source, e.url)))))))],
      h('h4', { class: 'rp-h4' }, 'Checks against published evidence'),
      h('ul', { class: 'rp-list' },
        h('li', {}, `CH-LUTI's rents move ${fixed(checks.rentToSupply, 2)}% when the housing stock grows 1% (Mense 2025: −0.19%; Asquith, Mast & Reed 2023: new buildings cut nearby rents ~6%).`),
        t0 && h('li', {}, `Year 0 with no new policy: ${FMT.int(t0.housingUnits)} homes, ${FMT.usd(t0.medianRent)} median rent, ${FMT.int(t0.jobs)} jobs, ${FMT.min(t0.avgCommuteMin)} average commute.`)),
      h('h4', { class: 'rp-h4' }, 'Uncertain parameters (low · central · high)'),
      ...Object.entries(groups).map(([g, list]) => h('div', { class: 'rp-params' },
        h('h5', {}, g),
        h('table', {}, h('tbody', {}, list.map(([k, p]) => h('tr', { class: flagOf(p.source) && 'is-flagged' },
          h('th', { scope: 'row' }, p.label ?? k, flagOf(p.source) && h('span', { class: 'rp-flag' }, flagOf(p.source)), h('small', {}, p.source)),
          h('td', {}, range(p)))))))),
      h('h4', { class: 'rp-h4' }, 'Data'),
      h('ul', { class: 'rp-list rp-muted' }, Object.values(SOURCES).map(s => h('li', {}, link(s.label, s.url))),
        h('li', {}, link('Every source the page uses', 'sources.html'))));
  }

  function download() {
    if (!run) return;
    const out = {
      model: MODEL, startYear: START_YEAR, cards: ui.active, params: scenario.get().params, starts: scenario.get().starts, game: game.get(),
      metrics: Object.fromEntries(METRICS.map(m => [m.key, {
        withPolicies: run.result.timeline.map(t => t.metrics[m.key]), noNewPolicy: run.noPolicy.timeline.map(t => t.metrics[m.key]),
      }])),
      chLuti: luti && { runs: luti.runs, seed: luti.seed, change: luti.diff, baseline: Object.fromEntries(Object.entries(luti.baseline).map(([k, b]) => [k, b.p50])) },
      zonesChanged: run.result.timeline.map(t => t.zoneStates),
    };
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })), download: `${(policyStore.getState().scenarioName || 'scenario').replace(/[^\w-]+/g, '-')}.json` });
    document.body.append(a); a.click(); a.remove();
  }
}

// Whether a card at these slider values changes nothing: every lever at its no-change value (0, or x1) and every capped
// zone rule capped at 0, as a neutral default like a 0¢ tax change. Cap levers (e.g. parking) count as a change.
function changesNothing(card, values) {
  const value = key => values?.[key] ?? card.params.find(p => p.key === key).default;
  const lever = l => { const v = l.param ? value(l.param) : l.value, kind = LEVERS[l.lever].kind; return (kind === 'amount' && v === 0) || (kind === 'multiplier' && v === 1); };
  return (card.levers ?? []).every(lever) && (card.zoneRules ?? []).every(r => r.capParam && value(r.capParam) === 0);
}

function story(a, y, at) {
  const where = WHERE[a.zone];
  if (y < a.joined) return `${a.name} moves in ${where} in year ${a.joined}.`;
  if (a.left !== null && a.left <= y) return `${a.name} left a rental ${where} in year ${a.left}, when rent had reached ${share(at.burden)} of income.`;
  if (!a.renter) return `${a.name} owns a home ${where} and ${a.work === 'remote' ? 'works from home' : `spends ${at.commute} minutes getting to work`}.`;
  const change = at.rent / a.hist[a.joined].rent - 1;
  const trend = Math.abs(change) < .005 ? 'has held steady' : `is ${change > 0 ? 'up' : 'down'} ${share(Math.abs(change))}`;
  return `${a.name} ${a.joined ? `moved in ${where} in year ${a.joined}` : `rents ${where}`}, and rent ${trend} since ${a.joined ? 'then' : 'year 0'}, now ${share(at.burden)} of income.`;
}

// Monthly rent over the years the household lived here, with a dot on the shown year.
function ResidentSpark(a, y) {
  const end = a.left ?? a.hist.length - 1, pts = [];
  for (let t = a.joined; t <= end; t++) pts.push([t, a.hist[t].rent]);
  if (pts.length < 2) return null;
  const W = 220, H = 40, rents = pts.map(p => p[1]), lo = Math.min(...rents), hi = Math.max(...rents);
  const X = t => 4 + (t - a.joined) / (end - a.joined) * (W - 8), Y = v => H - 4 - (hi > lo ? (v - lo) / (hi - lo) : .5) * (H - 8);
  const [ct, cv] = pts.find(p => p[0] === Math.min(Math.max(y, a.joined), end));
  return h('figure', { class: 'resident__spark' },
    h('div', { html: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly rent by year"><polyline points="${pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/><circle cx="${X(ct).toFixed(1)}" cy="${Y(cv).toFixed(1)}" r="3"/></svg>` }),
    h('figcaption', {}, `Rent, years ${a.joined}–${end}: ${money(rents[0])} → ${money(rents.at(-1))}`));
}

function toggleStub(on) {
  const q = new URLSearchParams(location.search);
  if (on) q.set('stub', '');
  else { q.delete('stub'); q.set('dev', ''); } // keep this toggle on screen
  location.search = q;
}
