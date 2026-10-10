import { h, cls } from '../policy/components.js';
import { METRICS, VARIABLES, explain, YEARS, MODEL } from './run.js';
import { PARAMS, FIXED } from './params.js';
import { SOURCES, ZONES, TOWN } from './data.js';
import { mountCityEffects } from './city-effects.js';

// Results dock: runs the applied policy package through CH-LUTI (in a Worker), then shows how it differs from the no-policy
// baseline over time, why, for whom and where — and drives the city's physical changes from the same timeline.

const RUNS = 200, SEED = 2026, PLAY_SECONDS = 16;
const SVGNS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const quarterLabel = q => `${YEARS[0] + Math.floor(q / 4)} Q${(q % 4) + 1}`;

// ---------- number formats ----------
const FMT = {
  usd: v => `$${Math.round(v).toLocaleString()}`,
  usdk: v => `$${Math.round(v / 1000).toLocaleString()}k`,
  usdm: v => `$${(v / 1e6).toFixed(Math.abs(v) < 1e7 ? 2 : 1)}M`,
  usdb: v => `$${(v / 1e9).toFixed(2)}B`,
  int: v => Math.round(v).toLocaleString(),
  pct: v => `${(v * 100).toFixed(1)}%`,
  millions: v => `${(v / 1e6).toFixed(2)}M`,
  min: v => `${v.toFixed(1)} min`,
  index: v => v.toFixed(3),
  dec: v => v.toFixed(1),
  cents: v => `${v.toFixed(1)}¢`,
};
const fmtVal = (id, v) => (FMT[VARIABLES[id]?.fmt] ?? FMT.dec)(v);
const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '±');
function fmtDiff(id, d, base) {
  const f = VARIABLES[id]?.fmt ?? 'dec';
  if (f === 'pct') { const pts = Math.abs(d * 100).toFixed(1); return `${+pts ? sign(d) : ''}${pts} pts`; }
  if (f === 'index') return `${sign(d)}${Math.abs(d / (base || 1) * 100).toFixed(1)}%`;
  const small = f === 'int' && Math.abs(d) < 10 && Math.abs(d) >= 0.05; // a few businesses: keep a decimal rather than print "−0"
  const body = small ? Math.abs(d).toFixed(1) : (FMT[f] ?? FMT.dec)(Math.abs(d));
  const abs = /[1-9]/.test(body) ? `${sign(d)}${body}` : body; // never "−$0"
  return base && f !== 'usdm' && f !== 'cents' ? `${abs} (${sign(d)}${Math.abs(d / base * 100).toFixed(1)}%)` : abs;
}
const fmtDiffShort = (id, d, base) => fmtDiff(id, d, base).replace(/ \(.*\)$/, '');
function tone(metric, d, lo, hi, base) {
  const rel = Math.abs(base) > 1e-9 ? Math.abs(d / base) : Math.abs(d);
  if (rel < 5e-4 || (metric.fmt === 'usdm' && Math.abs(d) < 5e4)) return 'flat';
  if (lo < 0 && hi > 0) return 'mixed';
  if (metric.better == null) return 'neutral';
  return Math.sign(d) === metric.better ? 'good' : 'bad';
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

// series: [{ label, values, kind: 'policy'|'base', band?: { lo, hi } }]; tick(v) and tip(v) format numbers
function lineChart({ series, q, tick, tip, zero = false, height = 168, title }) {
  const W = 400, H = height, P = { l: 58, r: 14, t: 12, b: 24 }, n = series[0].values.length;
  const vals = series.flatMap(s => [...s.values, ...(s.band ? [...s.band.lo, ...s.band.hi] : [])]);
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
  for (let yr = YEARS[0]; yr <= YEARS[0] + 9; yr += 3) {
    const tx = svg('text', { x: X((yr - YEARS[0]) * 4), y: H - 6, class: 'rp-tick', 'text-anchor': 'middle' }); tx.textContent = yr; el.append(tx);
  }
  for (const s of series) {
    if (s.band) el.append(svg('path', { d: path([...s.band.hi.map((v, i) => [X(i), Y(v)]), ...s.band.lo.map((v, i) => [X(i), Y(v)]).reverse()]) + 'Z', class: `rp-band is-${s.kind}` }));
  }
  for (const s of series) el.append(svg('path', { d: path(s.values.map((v, i) => [X(i), Y(v)])), class: `rp-line is-${s.kind}` }));
  const now = svg('line', { x1: X(q), x2: X(q), y1: P.t, y2: H - P.b, class: 'rp-now' });
  el.append(now);
  const dots = series.map(s => { const c = svg('circle', { r: 4, cx: X(q), cy: Y(s.values[q]), class: `rp-dot is-${s.kind}` }); el.append(c); return c; });
  // crosshair + tooltip
  const hair = svg('line', { y1: P.t, y2: H - P.b, class: 'rp-hair', visibility: 'hidden' });
  el.append(hair);
  const wrap = h('div', { class: 'rp-chartwrap' }, el);
  const tipEl = h('div', { class: 'rp-tip', role: 'status', hidden: true });
  wrap.append(tipEl);
  let hoverQ = null;
  function show(i) {
    hoverQ = i;
    hair.setAttribute('x1', X(i)); hair.setAttribute('x2', X(i)); hair.setAttribute('visibility', 'visible');
    tipEl.replaceChildren(h('div', { class: 'rp-tip__when' }, quarterLabel(i)), ...series.map(s => h('div', { class: 'rp-tip__row' },
      h('span', { class: `rp-key is-${s.kind}`, 'aria-hidden': 'true' }),
      h('strong', {}, tip(s.values[i])),
      h('span', {}, s.band ? ` ${s.label} · range ${tip(s.band.lo[i])} to ${tip(s.band.hi[i])}` : ` ${s.label}`))));
    tipEl.hidden = false;
    const r = el.getBoundingClientRect(), px = X(i) / W * r.width;
    tipEl.style.left = `${Math.min(Math.max(px, 90), r.width - 90)}px`;
  }
  function hide() { hoverQ = null; hair.setAttribute('visibility', 'hidden'); tipEl.hidden = true; }
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W;
    show(Math.max(0, Math.min(n - 1, Math.round((x - P.l) / (W - P.l - P.r) * (n - 1)))));
  });
  el.addEventListener('pointerleave', hide);
  el.addEventListener('focus', () => show(q));
  el.addEventListener('blur', hide);
  el.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); show(Math.max(0, Math.min(n - 1, (hoverQ ?? q) + (e.key === 'ArrowRight' ? 1 : -1))));
  });
  wrap.setQuarter = nq => {
    now.setAttribute('x1', X(nq)); now.setAttribute('x2', X(nq));
    series.forEach((s, k) => { dots[k].setAttribute('cx', X(nq)); dots[k].setAttribute('cy', Y(s.values[nq])); });
  };
  return wrap;
}

function sparkline(band, q) {
  const W = 120, H = 30, n = band.p50.length, vals = [...band.p10, ...band.p90, 0];
  const y0 = Math.min(...vals), y1 = Math.max(...vals), span = y1 - y0 || 1;
  const X = i => 2 + i / (n - 1) * (W - 4), Y = v => 3 + (1 - (v - y0) / span) * (H - 6);
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rp-spark', 'aria-hidden': 'true' });
  el.append(svg('line', { x1: 2, x2: W - 2, y1: Y(0), y2: Y(0), class: 'rp-zero' }));
  el.append(svg('path', { d: path([...band.p90.map((v, i) => [X(i), Y(v)]), ...band.p10.map((v, i) => [X(i), Y(v)]).reverse()]) + 'Z', class: 'rp-band is-policy' }));
  el.append(svg('path', { d: path(band.p50.map((v, i) => [X(i), Y(v)])), class: 'rp-line is-policy' }));
  const dot = svg('circle', { r: 3, cx: X(q), cy: Y(band.p50[q]), class: 'rp-dot is-policy' });
  el.append(dot);
  el.setQuarter = nq => { dot.setAttribute('cx', X(nq)); dot.setAttribute('cy', Y(band.p50[nq])); };
  return el;
}

// horizontal bars around a zero line: rows [{ label, value, text, onClick?, note? }]
function barList(rows, { caption }) {
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1e-12);
  return h('div', { class: 'rp-bars', role: 'list', 'aria-label': caption }, rows.map(r => {
    const w = Math.abs(r.value) / max * 50;
    const bar = h('span', { class: cls('rp-bar', r.value < 0 && 'is-neg'), style: { '--w': `${w}%` } });
    const row = h(r.onClick ? 'button' : 'div', { class: cls('rp-barrow', r.onClick && 'is-action'), role: 'listitem', type: r.onClick ? 'button' : null, onclick: r.onClick },
      h('span', { class: 'rp-barrow__label' }, r.label, r.note && h('small', {}, r.note)),
      h('span', { class: 'rp-barrow__track' }, bar),
      h('span', { class: 'rp-barrow__value' }, r.text));
    return row;
  }));
}

// ---------- the panel ----------
export function mountResults({ store, host = document.body }) {
  const ui = { result: null, q: 39, t: 39, metric: null, playing: false, raf: 0, pending: 0, open: true };
  let city = null;
  const attachCity = () => { if (!city && window.meridian) { city = mountCityEffects(window.meridian); if (ui.result) { city.setScenario(ui.result); city.setTime(ui.t); } } };
  addEventListener('meridian:ready', attachCity);
  attachCity();

  let worker = null;
  try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }
  catch { worker = null; }

  // skeleton
  const title = h('h2', { class: 'rp-title' });
  const chips = h('div', { class: 'rp-chips' });
  const playBtn = h('button', { class: 'rp-play', type: 'button', 'aria-label': 'Play the decade' });
  const slider = h('input', { class: 'rp-slider', type: 'range', min: 0, max: 39, step: 0.05, value: 39, 'aria-label': 'Year shown in the city and the results' });
  const when = h('output', { class: 'rp-when' });
  const meta = h('p', { class: 'rp-meta' });
  const tiles = h('div', { class: 'rp-tiles', role: 'list', 'aria-label': 'Metrics' });
  const detail = h('section', { class: 'rp-detail', 'aria-live': 'polite' });
  const assume = h('details', { class: 'rp-assume' });
  const status = h('div', { class: 'rp-status' });
  const minBtn = h('button', { class: 'rp-min', type: 'button', 'aria-label': 'Minimise results' }, h('span', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 12 12"><path d="M3 6h6"/></svg>' }));
  const dlBtn = h('button', { class: 'rp-dl', type: 'button' }, 'Download scenario and results (JSON)');
  const body = h('div', { class: 'rp-scroll' }, tiles, detail, assume, dlBtn);
  const panel = h('aside', { class: 'rp', 'aria-label': 'Scenario results', hidden: true },
    h('header', { class: 'rp-head' },
      h('div', { class: 'rp-head__text' }, h('p', { class: 'rp-kicker' }, 'Scenario results'), title, chips),
      minBtn),
    h('div', { class: 'rp-time' }, playBtn, slider, when),
    meta, status, body);
  const pill = h('button', { class: 'rp-pill', type: 'button', hidden: true }, 'Results');
  host.append(panel, pill);

  minBtn.addEventListener('click', () => { ui.open = false; panel.hidden = true; pill.hidden = false; pill.focus(); });
  pill.addEventListener('click', () => { ui.open = true; panel.hidden = false; pill.hidden = true; minBtn.focus(); });

  // ---------- running ----------
  store.subscribe((state, change) => { if (change?.type === 'apply') run(state); });

  function run(state) {
    const policies = store.slots.map(s => state.applied[s.id]).filter(Boolean).map(id => store.getPolicy(id));
    stop();
    if (!policies.length) {
      ui.result = null; panel.hidden = pill.hidden = true;
      city?.setScenario(null);
      return;
    }
    title.textContent = state.scenarioName;
    chips.replaceChildren(...policies.map(p => {
      const c = store.categories.find(x => x.id === p.category);
      return h('span', { class: 'rp-chip', style: { '--cat': c.color, '--cat-deep': c.deep } }, p.title);
    }));
    panel.hidden = !ui.open; pill.hidden = ui.open;
    panel.classList.add('is-busy');
    status.replaceChildren(h('span', { class: 'rp-spinner', 'aria-hidden': 'true' }), `Running ${RUNS} possible futures, with and without these policies…`);
    status.hidden = false;
    const id = ++ui.pending;
    const done = ({ result, ms }) => {
      if (id !== ui.pending) return;
      panel.classList.remove('is-busy'); status.hidden = true;
      ui.result = result;
      ui.metric = pickMetric(result);
      meta.replaceChildren(
        h('strong', {}, 'Under these assumptions, this is a plausible range of outcomes, not a forecast. '),
        `${MODEL.id} v${MODEL.version} · ${result.runs} paired runs · seed ${result.seed} · ${Math.round(ms)} ms`);
      city?.setScenario(result);
      renderAssumptions(policies, result);
      setTime(reducedMotion() ? 39 : 0);
      if (!reducedMotion()) play();
    };
    const plain = JSON.parse(JSON.stringify(policies));
    if (worker) {
      worker.onmessage = e => done(e.data);
      worker.onerror = () => { worker = null; runInline(plain).then(done); };
      worker.postMessage({ id, policies: plain, runs: RUNS, seed: SEED });
    } else runInline(plain).then(done);
  }
  async function runInline(policies) {
    const { runScenario } = await import('./run.js');
    const t0 = performance.now(), result = runScenario(policies, { runs: RUNS, seed: SEED });
    return { result, ms: performance.now() - t0 };
  }
  function pickMetric(result) { // open on whatever moved most
    let best = METRICS[0].id, bestRel = -1;
    for (const m of METRICS) {
      if (m.diffOnly) continue;
      const d = result.diff[m.id].p50[39], b = result.baseline[m.id].p50[39];
      const rel = Math.abs(d / (m.fmt === 'pct' ? 1 : b || 1)) * (m.fmt === 'pct' ? 10 : 1);
      if (rel > bestRel) { bestRel = rel; best = m.id; }
    }
    return best;
  }

  // ---------- timeline ----------
  function setTime(t) {
    ui.t = t; slider.value = t;
    const q = Math.min(39, Math.floor(t + 1e-6));
    when.textContent = quarterLabel(q);
    city?.setTime(t);
    if (q !== ui.q || !tiles.childElementCount) { ui.q = q; renderTiles(); renderDetail(); }
  }
  function play() {
    if (ui.playing) return stop();
    if (ui.t >= 39) setTime(0);
    ui.playing = true; playBtn.classList.add('is-playing'); playBtn.setAttribute('aria-label', 'Pause');
    let last = performance.now();
    const step = now => {
      const dt = (now - last) / 1000; last = now;
      const t = Math.min(39, ui.t + dt * 39 / PLAY_SECONDS);
      setTime(t);
      if (t >= 39) return stop();
      ui.raf = requestAnimationFrame(step);
    };
    ui.raf = requestAnimationFrame(step);
  }
  function stop() { ui.playing = false; cancelAnimationFrame(ui.raf); playBtn.classList.remove('is-playing'); playBtn.setAttribute('aria-label', 'Play the decade'); }
  playBtn.addEventListener('click', play);
  slider.addEventListener('input', () => { stop(); setTime(+slider.value); });

  // ---------- tiles ----------
  function renderTiles() {
    const r = ui.result, q = ui.q;
    if (!r) return;
    tiles.replaceChildren(...METRICS.map(m => {
      const base = r.baseline[m.id].p50[q], pol = r.policy[m.id].p50[q], d = r.diff[m.id];
      const t = tone(m, d.p50[q], d.p10[q], d.p90[q], base);
      const word = { good: 'better', bad: 'worse', mixed: 'uncertain', neutral: 'changed', flat: 'no clear change' }[t];
      return h('button', {
        class: cls('rp-tile', `is-${t}`, m.id === ui.metric && 'is-selected'), type: 'button', role: 'listitem',
        'aria-pressed': m.id === ui.metric ? 'true' : 'false',
        onclick: () => { ui.metric = m.id; renderTiles(); renderDetail(); detail.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); },
      },
        h('span', { class: 'rp-tile__label' }, m.label),
        h('span', { class: 'rp-tile__value' }, m.diffOnly ? fmtDiffShort(m.id, d.p50[q]) + '/yr' : fmtVal(m.id, pol)),
        h('span', { class: 'rp-tile__delta' },
          h('span', { class: 'rp-tile__arrow', 'aria-hidden': 'true' }, t === 'flat' ? '•' : d.p50[q] > 0 ? '▲' : '▼'),
          t === 'flat' ? 'no clear change' : `${m.diffOnly ? 'vs. baseline' : fmtDiffShort(m.id, d.p50[q], base)}`,
          h('span', { class: 'rp-sr' }, `, ${word}`)),
        h('span', { class: 'rp-tile__range' }, t === 'flat' ? ' ' : `range ${fmtDiffShort(m.id, d.p10[q], base)} to ${fmtDiffShort(m.id, d.p90[q], base)}`),
        sparkline(d, q));
    }));
  }

  // ---------- detail ----------
  function renderDetail() {
    const r = ui.result, q = ui.q, id = ui.metric;
    if (!r || !id) return;
    const m = VARIABLES[id], d = r.diff[id], base = r.baseline[id].p50[q];
    const zoneField = { rent: 'rent', housingUnits: 'units', population: 'households', businesses: 'businesses', storefrontVacancy: 'storefrontVacancy' }[id];
    const kids = [
      h('h3', { class: 'rp-h3' }, m.label, h('span', {}, ` · ${quarterLabel(q)}`)),
      h('p', { class: 'rp-lede' }, summarySentence(id, r, q)),
      h('h4', { class: 'rp-h4' }, 'Change vs. the no-policy baseline'),
      h('div', { class: 'rp-legend' }, h('span', { class: 'rp-key is-policy' }), 'Median of runs', h('span', { class: 'rp-swatch' }), '80% of runs fall in the band'),
      lineChart({ title: `${m.label}: change vs. baseline`, q, zero: true, series: [{ label: 'median change', kind: 'policy', values: d.p50, band: { lo: d.p10, hi: d.p90 } }],
        tick: v => (Math.abs(v) < 1e-12 ? '0' : fmtDiffShort(id, v, null).replace(/^\+/, '')), tip: v => fmtDiffShort(id, v, null) }),
    ];
    if (!METRICS.find(x => x.id === id)?.diffOnly) kids.push(
      h('h4', { class: 'rp-h4' }, 'Level, with and without the policies'),
      h('div', { class: 'rp-legend' }, h('span', { class: 'rp-key is-base' }), 'No-policy baseline', h('span', { class: 'rp-key is-policy' }), 'With these policies'),
      lineChart({ title: `${m.label}: level`, q, height: 150, series: [
        { label: 'baseline', kind: 'base', values: r.baseline[id].p50 },
        { label: 'with policies', kind: 'policy', values: r.policy[id].p50 },
      ], tick: v => fmtVal(id, v), tip: v => fmtVal(id, v) }));
    kids.push(h('h4', { class: 'rp-h4' }, 'Why it changed'), whyTree(explain(r, id, q)),
      h('p', { class: 'rp-note' }, 'Traced through the model at central assumptions. Each line is a model variable; branches that barely moved are left out.'));
    if (r.perPolicy.length > 1) {
      kids.push(h('h4', { class: 'rp-h4' }, 'Which policy did it'), barList(r.perPolicy.map(pp => ({
        label: pp.title, value: pp.diff[q][id], text: fmtDiffShort(id, pp.diff[q][id], base),
      })), { caption: 'Effect of each policy on its own' }),
      h('p', { class: 'rp-note' }, 'Each card run on its own at central assumptions; together they can add up to more or less than the sum.'));
    }
    if (zoneField) {
      const bz = r.mid.baseline.zones[q], pz = r.mid.policy.zones[q];
      kids.push(h('h4', { class: 'rp-h4' }, 'Where'), barList(ZONES.map((z, i) => {
        const dv = pz[i][zoneField] - bz[i][zoneField], f = VARIABLES[id].fmt;
        const value = f === 'pct' ? dv : dv / (bz[i][zoneField] || 1);
        const visible = city?.zoneVisible(z.id);
        return {
          label: z.label, note: visible ? 'Show on map' : 'Off this map', value,
          text: f === 'pct' ? fmtDiffShort(id, dv) : `${sign(value)}${Math.abs(value * 100).toFixed(1)}%`,
          onClick: visible ? () => city.focus(...city.zoneRep(z.id)) : null,
        };
      }), { caption: 'Change by zone' }));
    }
    if (r.mid.policy.events.length) {
      const ev = r.mid.policy.events.filter(e => e.q <= q), evBase = r.mid.baseline.events.filter(e => e.q <= q);
      const onMap = ev.filter(e => city?.zoneVisible(e.zone)).length;
      kids.push(h('h4', { class: 'rp-h4' }, 'On the map'), h('p', { class: 'rp-note' },
        `By ${quarterLabel(q)}: ${ev.length} apartment buildings started with these policies vs. ${evBase.length} without. `,
        `${onMap} sit inside this map (downtown and campus parking lots); policy-driven ones are tinted aqua. `,
        `Buses: ${Math.round(10 * r.mid.policy.series[q].serviceLevel)} on screen. `,
        r.mid.policy.series[q].bikeKm > 0 ? `Protected bike lanes built: ${r.mid.policy.series[q].bikeKm.toFixed(1)} km.` : ''));
    }
    detail.replaceChildren(...kids);
  }

  function summarySentence(id, r, q) {
    const m = VARIABLES[id], d = r.diff[id], base = r.baseline[id].p50[q];
    const metric = METRICS.find(x => x.id === id) ?? { better: null };
    const t = tone({ ...metric, fmt: m.fmt }, d.p50[q], d.p10[q], d.p90[q], base);
    if (t === 'flat') return `By ${quarterLabel(q)}, these policies barely move ${m.label.toLowerCase()}.`;
    const range = `In 80% of the ${r.runs} runs the change falls between ${fmtDiffShort(id, d.p10[q], base)} and ${fmtDiffShort(id, d.p90[q], base)}`;
    const dir = t === 'mixed' ? ', so even the direction is uncertain.' : '.';
    return `By ${quarterLabel(q)}, ${m.label.toLowerCase()} is ${fmtDiff(id, d.p50[q], base)} compared with doing nothing. ${range}${dir}`;
  }

  function whyTree(node) {
    const item = (n, depth) => {
      const v = VARIABLES[n.id] ?? { label: n.id };
      const up = n.delta > 0;
      return h('li', { class: 'rp-why__item' },
        h('span', { class: 'rp-why__row' },
          h('span', { class: cls('rp-why__arrow', up ? 'is-up' : 'is-down'), 'aria-hidden': 'true' }, up ? '▲' : '▼'),
          h('span', { class: 'rp-why__label' }, v.label),
          h('span', { class: 'rp-why__delta' }, fmtDiffShort(n.id, n.delta, n.base), depth && v.fmt !== 'pct' && v.fmt !== 'index' && Math.abs(n.base) > 1e-9 ? ` (${sign(n.rel)}${Math.abs(n.rel * 100).toFixed(1)}%)` : '')),
        n.children.length ? h('ul', { class: 'rp-why__kids' }, n.children.sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel)).slice(0, 3).map(c => item(c, depth + 1))) : null);
    };
    return h('ul', { class: 'rp-why' }, item(node, 0));
  }

  // ---------- assumptions ----------
  function renderAssumptions(policies, r) {
    const groups = {};
    for (const [k, p] of Object.entries(PARAMS)) (groups[p.group] ??= []).push([k, p]);
    const range = p => { const f = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : +v.toPrecision(3); return `${f(p.lo)} · ${f(p.mid)} · ${f(p.hi)}${p.unit && !p.unit.startsWith('/') ? ` ${p.unit}` : p.unit}`; };
    const link = (label, url) => url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, label) : label;
    assume.replaceChildren(
      h('summary', {}, 'Assumptions, sources and checks'),
      h('p', { class: 'rp-note' }, `${MODEL.name}. ${MODEL.method}. Base year: ACS 2020–24, LODES 2023, Zillow and the Town budget for 2025–26; simulated from ${YEARS[0]} for 10 years in quarters.`),
      h('h4', { class: 'rp-h4' }, 'How this package works in the model'),
      h('ul', { class: 'rp-list' }, policies.map(p => h('li', {},
        h('strong', {}, p.title), ` — ${p.mechanism} `,
        p.jurisdiction !== 'town' && h('em', { class: 'rp-flag' }, 'Needs a change in state law. '),
        h('span', { class: 'rp-muted' }, `Cost: ${p.cost}. Starts after ${p.timing.delayQuarters} quarters, full after ${p.timing.delayQuarters + p.timing.phaseInQuarters}.`),
        h('ul', {}, (p.evidence ?? []).map(e => h('li', { class: 'rp-muted' }, `${e.claim} — `, link(e.source, e.url))))))),
      h('h4', { class: 'rp-h4' }, 'Checks against published evidence'),
      h('ul', { class: 'rp-list' },
        h('li', {}, `Rents move ${r.checks ? r.checks.rentToSupply.toFixed(2) : '—'}% when the housing stock grows 1% (Mense 2025: −0.19%; Asquith, Mast & Reed 2023: new buildings cut nearby rents ~6%).`),
        h('li', {}, 'The no-policy run reproduces the base year: 61,607 people, 54,322 jobs, $1,690 market rent, 61% of renters cost-burdened, ~334 homes permitted a year.'),
        h('li', {}, `New-build rents the pro forma needs to break even: ${r.mid.baseline.calibration.newBuildRent.map((v, i) => `${ZONES[i].short} $${Math.round(v).toLocaleString()}`).join(', ')}/mo.`)),
      h('h4', { class: 'rp-h4' }, 'Uncertain parameters (low · central · high)'),
      ...Object.entries(groups).map(([g, list]) => h('div', { class: 'rp-params' },
        h('h5', {}, g),
        h('table', {}, h('tbody', {}, list.map(([k, p]) => h('tr', {},
          h('th', { scope: 'row' }, p.label, h('small', {}, p.source)),
          h('td', {}, range(p)))))))),
      h('h4', { class: 'rp-h4' }, 'Fixed assumptions worth knowing'),
      h('ul', { class: 'rp-list rp-muted' },
        h('li', {}, `Each NC revaluation (${FIXED.revaluationYears.join(', ')}) resets the base rate to revenue-neutral; a policy's rate change rides on top.`),
        h('li', {}, `~45% of resident commuters work outside Town; the Town pays ${FIXED.transitTownShare * 100}% of extra Chapel Hill Transit service.`),
        h('li', {}, `Developers need a ${FIXED.hurdle * 100}% profit on cost; new homes take ${FIXED.buildQuarters} quarters to build.`),
        h('li', {}, `UNC residence halls (${TOWN.groupQuarters.toLocaleString()} residents) are held constant.`)),
      h('h4', { class: 'rp-h4' }, 'Data'),
      h('ul', { class: 'rp-list rp-muted' }, Object.values(SOURCES).map(s => h('li', {}, link(s.label, s.url)))));
    dlBtn.onclick = () => {
      const out = {
        model: MODEL, runs: r.runs, seed: r.seed, years: r.years, policies, parameters: PARAMS, fixed: FIXED,
        results: Object.fromEntries(Object.keys(r.diff).map(k => [k, { baseline: r.baseline[k].p50, policy: r.policy[k].p50, change: r.diff[k] }])),
      };
      const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })), download: `${(store.getState().scenarioName || 'scenario').replace(/[^\w-]+/g, '-')}.json` });
      document.body.append(a); a.click(); a.remove();
    };
  }

  return { run: () => run(store.getState()) };
}
