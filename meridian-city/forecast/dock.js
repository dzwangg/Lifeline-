// The forecast dock: policy setup, three-way comparison, charts, money and explanations for the Chapel Hill
// policy simulator (backend/). Every number, badge and chart cursor follows the one shared sim clock
// (sim/scenario.js simClock): Play moves the display cursor through a trajectory that was computed once.
//
// Flow on Run or Play: validate -> submit one job -> show progress -> cache the whole trajectory -> animate.
// Edits mark results stale; an older response (job or demo) that lands late is dropped (latestOnly).
import { h, cls } from '../policy/components.js';
import { simClock, START_YEAR } from '../sim/scenario.js';
import { SPEEDS } from '../sim/clock.js';
import * as api from './api.js';
import { selectYear, scenarioKey, latestOnly, yearStatus } from './cursor.js';
import { level, change, EVIDENCE } from './format.js';
import { chart, legend } from './charts.js';

const TABS = [['setup', 'Policies'], ['compare', 'Compare'], ['charts', 'Charts'], ['money', 'Money'], ['explain', 'Explain']];
const LABELS = { // field labels for the generated card editors; unknown fields fall back to the schema title
  enabled: 'Enabled', start_fy: 'Start (fiscal year)', end_fy: 'End (fiscal year)', funding_source: 'Funding source',
  annual_budget: 'Annual budget ($)', grant_per_establishment: 'Grant per establishment ($)', award_per_startup: 'Award per startup ($)',
  subsidy_per_hire: 'Subsidy per qualifying hire ($)', duration_months: 'Subsidy duration (months)', award_per_unit: 'Award per unit ($)',
  affordable_share: 'Affordable share (0-1)', affordability_term_years: 'Affordability term (years)',
  preservation_share: 'Preservation share (0-1)', area: 'Area', eligibility: 'Eligibility',
  change_cents_per_100: 'Change (cents per $100 assessed)', duration_years: 'Duration (years, 0 = whole horizon)',
  applies_to: 'Applies to', include_behavioral_sensitivity: 'Include behavioural sensitivity (assumption)',
};
const FUNDING = { general_fund: 'General fund (operating)', fund_balance: 'Fund balance (one-time reserves)',
  tax_adjustment: 'Earmarked property-tax increase', unfunded: 'Unfunded (shows the gap)' };

export async function mountForecastDock({ policyStore, host = document.body, onResult = () => {} }) {
  const [mode, cat] = await Promise.all([api.connect(), api.catalog()]);
  const demos = (await api.demoIndex()).scenarios;
  const defs = cat.policy_schema.$defs;
  const cardKeys = Object.keys(cat.policy_defaults);
  const idToKey = Object.fromEntries(Object.entries(cat.card_ids).map(([k, id]) => [id, k]));

  const ui = {
    tab: 'compare', metric: 'workplace_jobs', open: true,
    scenario: { name: 'My scenario', horizon_years: 5, macro: 'central', draws: 500, seed: 20261010, policies: structuredClone(cat.policy_defaults) },
    result: null, resultFor: null, phase: 'idle', progress: 0, message: '', errors: [], warnings: [], explanation: null,
  };
  // One guard for every request that fills the dock (validation, live jobs, demo loads): only the newest may land.
  const latest = latestOnly((request, current) => request(current));

  // ---------- skeleton ----------
  const status = h('span', { class: 'fc-status', role: 'status', 'aria-live': 'polite' });
  const modeChip = h('span', { class: cls('fc-chip', mode === 'live' ? 'is-live' : 'is-demo') }, mode === 'live' ? 'Live model' : 'Precomputed demo');
  const runBtn = h('button', { class: 'fc-run', type: 'button', onclick: () => submit(false) }, 'Run forecast');
  const bar = h('div', { class: 'fc-progress', role: 'progressbar', 'aria-label': 'Forecast progress', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span'));
  const body = h('div', { class: 'fc-body' });
  const tabs = h('div', { class: 'fc-tabs', role: 'tablist' }, TABS.map(([id, label]) =>
    h('button', { role: 'tab', type: 'button', 'data-tab': id, onclick: () => { ui.tab = id; render(); } }, label)));
  const tl = timeline();
  const toggle = h('button', { class: 'fc-toggle', type: 'button', 'aria-expanded': 'true', onclick: () => {
    ui.open = !ui.open; panel.classList.toggle('is-collapsed', !ui.open); toggle.setAttribute('aria-expanded', String(ui.open)); toggle.textContent = ui.open ? 'Hide' : 'Show';
  } }, 'Hide');
  const panel = h('section', { class: 'plate fc', 'aria-label': 'Chapel Hill policy forecast' },
    h('header', { class: 'fc-head' }, h('h2', {}, 'Policy forecast'), modeChip, toggle),
    h('p', { class: 'fc-label' }, 'Sensitivity simulation: policy effects are assumption-based, not validated local predictions.'),
    tl.el,
    h('div', { class: 'fc-runrow' }, runBtn, bar, status),
    tabs, body);
  host.append(panel);

  // ---------- policy panel -> enabled cards ----------
  policyStore?.subscribe(({ applied }) => {
    const on = new Set(Object.values(applied).filter(Boolean).map(id => idToKey[id]).filter(Boolean));
    let changed = false;
    for (const k of cardKeys) if (ui.scenario.policies[k].enabled !== on.has(k)) { ui.scenario.policies[k].enabled = on.has(k); changed = true; }
    if (changed) edited();
  });

  const isStale = () => !ui.result || ui.resultFor !== scenarioKey(ui.scenario);

  function edited() {
    if (ui.phase === 'done' || ui.phase === 'stale') ui.phase = isStale() ? 'stale' : 'done';
    render();
  }

  async function submit(fromPlay) {
    if (mode !== 'live') {
      const match = demos.find(d => scenarioKey(d.scenario.policies) === scenarioKey(ui.scenario.policies)) ;
      if (match) return loadDemo(match.id);
      ui.phase = 'error';
      ui.message = 'No forecast server is reachable, so only the precomputed demo scenarios can be shown. Pick one above, or run backend/ (see README).';
      return render();
    }
    const sc = structuredClone(ui.scenario), key = scenarioKey(sc);
    ui.phase = 'validating'; ui.progress = 0; ui.message = 'Validating scenario'; render();
    // Validation and the job run under the one request guard (latest) that demo loads share, and any failure, including a
    // server that stops answering mid-validation, leaves the dock in a retryable error state rather than stuck validating.
    try {
      const v = await latest(() => api.validate(sc));
      if (v.stale) return; // a newer request owns the screen
      ui.warnings = v.value.warnings ?? [];
      if (!v.value.valid) { ui.phase = 'error'; ui.errors = v.value.errors; ui.message = 'Fix the highlighted inputs.'; return render(); }
      ui.errors = []; ui.phase = 'running'; render();
      const r = await latest(current => api.runJob(sc, (p, msg) => { if (current()) { ui.progress = p; ui.message = msg; paintStatus(); } }));
      if (r.stale) return;
      setResult(r.value, key);
      if (fromPlay && !simClock.get().playing) simClock.play();
    } catch (e) { ui.phase = 'error'; ui.message = e.message; render(); }
  }

  async function loadDemo(id) {
    try {
      const r = await latest(() => api.demo(id));
      if (r.stale) return; // a later choice (another demo, or a live run) won
      ui.scenario = { ...structuredClone(r.value.scenario), policies: structuredClone(r.value.scenario.policies) };
      setResult(r.value, scenarioKey(ui.scenario));
    } catch (e) { ui.phase = 'error'; ui.message = e.message; render(); }
  }

  async function setResult(r, key) {
    ui.result = r; ui.resultFor = key; ui.phase = 'done'; ui.progress = 1; ui.message = '';
    ui.explanation = r.explanation ?? null;
    cur = selectYear(r, simClock.get());
    onResult(r);
    render();
    if (!ui.explanation && r.result_key) { ui.explanation = await api.explanation(r.result_key); if (ui.tab === 'explain') render(); }
  }

  // ---------- timeline (shared clock controls) ----------
  function timeline() {
    const btn = (label, svg, onclick, key) => h('button', { class: 'tool-btn fc-tbtn', type: 'button', 'aria-label': label, title: key ? `${label} (${key})` : label, html: svg, onclick });
    const restart = btn('Restart from 2026', '<svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="M1 1h1v7H1zM3 4h1v1H3zM4 3h1v3H4zM5 2h1v5H5zM6 1h1v7H6z"/></svg>', () => { simClock.seek(0); }, 'Home');
    const back = btn('Step back one year', '<svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="M2 4h1v1H2zM3 3h1v3H3zM4 2h1v5H4zM5 1h1v7H5z"/></svg>', () => simClock.seek(simClock.get().step - 1), ',');
    const play = btn('Play', '', () => simClock.toggle(), 'Space');
    const fwd = btn('Step forward one year', '<svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="M3 1h1v7H3zM4 2h1v5H4zM5 3h1v3H5zM6 4h1v1H6z"/></svg>', () => simClock.seek(simClock.get().step + 1), '.');
    const speed = h('select', { class: 'fc-speed', 'aria-label': 'Playback speed', onchange: e => simClock.setSpeed(+e.target.value) },
      SPEEDS.map(v => h('option', { value: v }, `${v}×`)));
    const scrub = h('input', { type: 'range', class: 'fc-scrub', min: 0, max: simClock.get().steps, step: 1, value: 0, 'aria-label': 'Forecast year',
      oninput: e => simClock.seek(+e.target.value) });
    const label = h('span', { class: 'fc-year' });
    const el = h('div', { class: 'fc-timeline', role: 'group', 'aria-label': 'Forecast timeline' }, restart, back, play, fwd, speed, scrub, label);
    addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable], [role="dialog"], dialog')) return;
      const k = e.key.toLowerCase();
      if (k === ',') simClock.seek(simClock.get().step - 1);
      else if (k === '.') simClock.seek(simClock.get().step + 1);
      else if (k === 'home' || k === 'r') simClock.seek(0);
      else return;
      e.preventDefault();
    });
    return {
      el,
      update(s) {
        play.innerHTML = s.playing
          ? '<svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="M2 1h2v7H2zM5 1h2v7H5z"/></svg>'
          : '<svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="M3 1h1v7H3zM4 2h1v5H4zM5 3h1v3H5zM6 4h1v1H6z"/></svg>';
        play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
        speed.value = String(s.speed);
        if (document.activeElement !== scrub) scrub.value = s.step;
        const year = START_YEAR + s.step, beyond = ui.result && year > ui.result.years.at(-1);
        label.textContent = `${year} · FY${year} · ${s.step === 0 ? 'nowcast origin' : beyond ? 'beyond horizon' : 'projected'}`;
      },
    };
  }

  let cur = selectYear(null, simClock.get());

  // ---------- rendering ----------
  let cursorViews = [];
  function render() {
    tabs.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    paintStatus();
    cursorViews = [];
    const view = { setup, compare, charts, money, explain }[ui.tab]();
    body.replaceChildren(view);
    updateCursorViews(simClock.get());
  }

  function paintStatus() {
    const stale = ui.result && isStale();
    runBtn.textContent = ui.phase === 'running' ? 'Running…' : stale ? 'Re-run forecast' : 'Run forecast';
    runBtn.disabled = ui.phase === 'running' || ui.phase === 'validating';
    bar.firstChild.style.width = `${Math.round((ui.phase === 'running' ? ui.progress : ui.phase === 'done' ? 1 : 0) * 100)}%`;
    bar.setAttribute('aria-valuenow', Math.round(ui.progress * 100));
    status.textContent = ui.phase === 'running' ? `Calculating… ${ui.message}` : ui.phase === 'validating' ? ui.message
      : ui.phase === 'error' ? ui.message : stale ? 'Inputs changed: results are stale until you re-run.'
      : ui.result ? `${ui.result.draws} paired draws · seed ${ui.result.seed} · ${ui.result.lineage.model}` : 'Not run yet.';
    panel.classList.toggle('is-stale', !!stale);
    panel.classList.toggle('is-error', ui.phase === 'error');
  }

  function updateCursorViews(s) {
    const yearFloat = START_YEAR + (s?.years ?? 0);
    for (const v of cursorViews) v(yearFloat);
  }
  const onCursor = fn => { cursorViews.push(fn); };

  // ----- setup tab -----
  function setup() {
    const sc = ui.scenario;
    const field = (label, input) => h('label', { class: 'fc-field' }, h('span', {}, label), input);
    const sel = (value, opts, on) => h('select', { onchange: e => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
    const top = h('div', { class: 'fc-grid2' },
      field('Horizon', sel(sc.horizon_years, [[5, '5 years (default)'], [10, '10 years (exploratory)']], v => { sc.horizon_years = +v; edited(); })),
      field('Macro scenario', sel(sc.macro, [['central', 'Central'], ['adverse', 'Adverse (assumed)'], ['optimistic', 'Optimistic (assumed)']], v => { sc.macro = v; edited(); })),
      field('Paired draws', h('input', { type: 'number', min: 50, max: 2000, step: 50, value: sc.draws, onchange: e => { sc.draws = +e.target.value; edited(); } })),
      field('Seed', h('input', { type: 'number', min: 0, value: sc.seed, onchange: e => { sc.seed = +e.target.value; edited(); } })));
    const demoPick = h('div', { class: 'fc-demo' },
      field(mode === 'live' ? 'Load a demonstration scenario' : 'Precomputed demonstration scenarios',
        sel('', [['', '— choose —'], ...demos.map(d => [d.id, d.name])], v => v && loadDemo(v))),
      mode !== 'live' && h('p', { class: 'fc-note' }, 'No forecast server answered, so new scenarios cannot be computed here. Run the backend to simulate your own (see backend/README.md).'));
    const cards = cardKeys.map(k => Card(k));
    return h('div', { class: 'fc-setup' }, demoPick, top, ui.errors.length > 0 && h('ul', { class: 'fc-errors' }, ui.errors.map(e => h('li', {}, `${(e.loc ?? []).join('.')}: ${e.msg}`))),
      ui.warnings.length > 0 && h('ul', { class: 'fc-warn' }, ui.warnings.map(w => h('li', {}, w))), cards);
  }

  function Card(k) {
    const card = ui.scenario.policies[k], text = cat.cards[k] ?? { title: k };
    const ref = cat.policy_schema.properties[k]?.$ref?.split('/').pop() ?? cat.policy_schema.properties[k]?.allOf?.[0]?.$ref?.split('/').pop();
    const props = defs[ref]?.properties ?? {};
    const yearActive = cur.index >= 0 && card.enabled && card.start_fy <= cur.year && cur.year <= (k === 'property_tax_adjustment' && card.duration_years === 0 ? 9999 : card.end_fy ?? 9999);
    const fields = Object.entries(props).filter(([f]) => f !== 'enabled').map(([f, p]) => Field(card, f, p));
    const sched = ui.result?.policies.find(p => p.key === k);
    const row = sched?.by_year?.find(r => r.year === cur.year);
    return h('details', { class: cls('fc-card', card.enabled && 'is-on'), open: card.enabled },
      h('summary', {},
        h('input', { type: 'checkbox', checked: card.enabled, 'aria-label': `Enable ${text.title}`, onclick: e => e.stopPropagation(),
          onchange: e => { card.enabled = e.target.checked; syncPanel(k, card.enabled); edited(); } }),
        h('strong', {}, text.title),
        h('span', { class: cls('fc-badge', yearActive && 'is-active'), 'data-badge': k }, card.enabled ? (yearActive ? `Active ${cur.year}` : 'Scheduled') : 'Off')),
      h('p', { class: 'fc-note' }, text.mechanism),
      h('div', { class: 'fc-grid2' }, fields),
      row && h('p', { class: 'fc-sched' }, k === 'property_tax_adjustment'
        ? `FY${row.year}: rate ${row.rate_cents}¢ · gross levy change ${change(row.levy_change_gross, { kind: 'currency' })}`
        : `FY${row.year}: paid ${level(row.paid, { kind: 'currency' })} · recipients ${level(row.recipients, { kind: 'count' })} · unspent ${level(row.unspent, { kind: 'currency' })}` +
          (row.unmet > 0 ? ` · unmet ${level(row.unmet, { kind: 'count' })}` : '')),
      h('p', { class: 'fc-evidence' }, `Evidence: ${text.evidence_grade}. Constraints: ${text.constraints}`));
  }

  function Field(card, f, p) {
    const label = LABELS[f] ?? p.title ?? f;
    const ref = p.$ref?.split('/').pop();
    const enumVals = p.enum ?? (ref && defs[ref]?.enum) ?? p.anyOf?.find(a => a.enum)?.enum;
    const set = v => { card[f] = v; edited(); };
    let input;
    if (enumVals && enumVals.length === 1) input = h('output', {}, enumVals[0].replaceAll('_', ' '));
    else if (enumVals) input = h('select', { onchange: e => set(e.target.value) },
      enumVals.map(v => h('option', { value: v, selected: card[f] === v }, FUNDING[v] ?? v.replaceAll('_', ' '))));
    else if (p.type === 'boolean') input = h('input', { type: 'checkbox', checked: !!card[f], onchange: e => set(e.target.checked) });
    else input = h('input', { type: 'number', value: card[f], min: p.minimum, max: p.maximum,
      step: p.type === 'integer' ? 1 : (p.maximum ?? 1) <= 1 ? 0.05 : (p.maximum ?? 0) >= 100000 ? 1000 : 0.5,
      onchange: e => set(p.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)) });
    return h('label', { class: 'fc-field' }, h('span', {}, label), input);
  }

  function syncPanel(k, on) { // mirror a dock toggle into the existing policy panel's applied selection
    if (!policyStore) return;
    const id = cat.card_ids[k], st = policyStore.getState();
    const at = Object.keys(st.applied).find(s => st.applied[s] === id);
    if (on && !at) { const slot = policyStore.compatibleSlots(id).find(s => !st.draft[s]); if (slot) { policyStore.place(id, slot); policyStore.apply(); } }
    if (!on && at) { policyStore.remove(at); policyStore.apply(); }
  }

  // ----- compare tab -----
  function compare() {
    if (!ui.result) return empty();
    const r = ui.result, i = cur.index;
    const head = h('p', { class: 'fc-yearline' }, i < 0
      ? `2026 nowcast origin (last observed year ${r.time_status.last_observed}). Step forward or Play to see projections.`
      : `${cur.year} (FY${cur.year}) · projected${cur.beyond ? ` · horizon ends ${r.years.at(-1)}` : ''}. Changes are selected minus current policy, same draws.`);
    const groups = Object.entries(r.families).map(([fam, name]) => {
      const ms = r.metrics.filter(m => String(m.family) === fam && m.show !== false);
      const rows = ms.map(m => {
        if (!m.supported) return h('tr', { class: 'is-na' }, h('th', {}, m.label), h('td', { colspan: 4 }, 'unavailable'), h('td', {}, h('span', { class: 'fc-ev', title: m.note }, EVIDENCE.unavailable)));
        if (i < 0) return h('tr', {}, h('th', {}, m.label), h('td', { colspan: 4 }, '—'), h('td', {}, ''));
        const row = m.series[i];
        const lvlOk = m.level !== 'unavailable';
        const tgt = row.gap_to_target ? `${row.gap_to_target.p50 >= 0 ? 'meets' : 'short'} by ${level(Math.abs(row.gap_to_target.p50), m)}` : '—';
        const rel = row.delta_relative_pct && Math.abs(row.delta.p50) > 0 ? ` (${change(row.delta_relative_pct.p50, { kind: 'count' })}%)` : '';
        return h('tr', { tabindex: 0, title: m.note },
          h('th', {}, m.label, h('small', {}, m.unit)),
          h('td', {}, lvlOk ? level(row.baseline.p50, m) : 'unavailable'),
          h('td', {}, lvlOk ? level(row.policy.p50, m) : '—'),
          h('td', { class: 'fc-chg' }, change(row.delta.p50, m) + rel, h('small', {}, `80%: ${change(row.delta.p10, m)} to ${change(row.delta.p90, m)}`)),
          h('td', {}, tgt),
          h('td', {}, h('span', { class: cls('fc-ev', `ev-${m.effect}`) }, EVIDENCE[m.effect]),
            lvlOk && m.level !== m.effect && h('small', {}, `level: ${EVIDENCE[m.level]}`)));
      });
      return h('tbody', {}, h('tr', { class: 'fc-fam' }, h('th', { colspan: 6 }, `${fam}. ${name}`)), rows);
    });
    return h('div', {}, head, warnings(r),
      h('div', { class: 'fc-tablewrap' }, h('table', { class: 'fc-table' },
        h('thead', {}, h('tr', {}, ['Metric', 'Current policy', 'Selected', 'Change (median)', 'vs illustrative target', 'Basis'].map(t => h('th', { scope: 'col' }, t)))),
        groups)),
      h('p', { class: 'fc-note' }, 'Medians of paired draws; intervals come from the paired differences, not from subtracting separate ranges. ',
        'Target gaps are distances to illustrative goals, not policy effects. Unavailable is not zero.'));
  }

  // ----- charts tab -----
  function charts() {
    if (!ui.result) return empty();
    const r = ui.result, ms = r.metrics.filter(m => m.supported && m.show !== false);
    const m = ms.find(x => x.id === ui.metric) ?? ms[0];
    const picker = h('select', { 'aria-label': 'Metric', onchange: e => { ui.metric = e.target.value; render(); } },
      ms.map(x => h('option', { value: x.id, selected: x.id === m.id }, `${x.family}. ${x.label}`)));
    const histMap = { workplace_jobs: 'workplace_jobs', resident_jobs: 'resident_jobs' };
    const history = histMap[m.id] ? { years: [...r.history.years, ...r.nowcast.years], values: [...r.history[histMap[m.id]], ...r.nowcast[histMap[m.id]].map(q => q.p50)] } : null;
    const origin = history ? { year: 2026, value: history.values.at(-1) } : null;
    const lv = m.level !== 'unavailable' ? chart(m, { kind: 'level', history, origin }) : null;
    const dv = chart(m, { kind: 'delta' });
    for (const c of [lv, dv].filter(Boolean)) onCursor(y => c.setCursor(y));
    return h('div', { class: 'fc-charts' }, h('label', { class: 'fc-field' }, h('span', {}, 'Metric'), picker),
      h('p', { class: 'fc-note' }, m.note),
      lv ? h('figure', {}, h('figcaption', { html: `${m.label} (${m.unit}) ${legend({ target: m.series.some(s => s.target != null), history: !!history })}` }), lv.el)
        : h('p', { class: 'fc-note' }, 'The baseline level is unavailable for this metric, so only the policy-induced change is charted.'),
      history && h('p', { class: 'fc-note' }, `Observed LODES through ${r.time_status.last_observed}; ${r.time_status.nowcast.join(', ')} are nowcast medians; later years are projections.`),
      h('figure', {}, h('figcaption', { html: `Change from current policy (${m.delta_unit}) ${legend({ delta: true })}` }), dv.el),
      table(m));
  }

  function table(m) { // the table view of the chart
    return h('details', { class: 'fc-tableview' }, h('summary', {}, 'Table view'),
      h('table', { class: 'fc-table' }, h('thead', {}, h('tr', {}, ['Year', 'Current (80%)', 'Selected (80%)', 'Change (80%)'].map(t => h('th', {}, t)))),
        h('tbody', {}, m.series.map(r => h('tr', {}, h('th', {}, `${r.year}`),
          h('td', {}, `${level(r.baseline.p50, m)} (${level(r.baseline.p10, m)}–${level(r.baseline.p90, m)})`),
          h('td', {}, `${level(r.policy.p50, m)} (${level(r.policy.p10, m)}–${level(r.policy.p90, m)})`),
          h('td', {}, `${change(r.delta.p50, m)} (${change(r.delta.p10, m)} to ${change(r.delta.p90, m)})`))))));
  }

  // ----- money tab -----
  function money() {
    if (!ui.result) return empty();
    const r = ui.result, i = Math.max(0, cur.index), L = r.ledger[i];
    const $ = { kind: 'currency' };
    const lines = [['receipts_property_tax', 'Property-tax receipts'], ['receipts_sales_tax', 'Sales-tax distribution (illustrative)'],
      ['receipts_other', 'Other receipts (illustrative)'], ['receipts_total', 'Total comparable receipts'], ['expenditure_operating', 'Comparable operating expenditure'],
      ['policy_disbursements', 'Policy payments (all sources)'], ['commitments', 'New commitments'], ['encumbered', 'Encumbered (committed, unpaid)'],
      ['operating_balance', 'Operating balance'], ['fund_balance', 'Available fund balance'], ['funding_gap', 'Funding gap']];
    const ce = r.cost_effectiveness;
    const ratio = (x, unit) => x.suppressed ? `suppressed: ${x.reason}` : `${level(x.p50, $)} per ${unit} (80%: ${level(x.p10, $)} to ${level(x.p90, $)})`;
    return h('div', {},
      h('p', { class: 'fc-yearline' }, `${L.fiscal_year} (July ${+L.fiscal_year.slice(2) - 1} – June ${L.fiscal_year.slice(2)}) · nominal dollars · medians`),
      h('p', { class: 'fc-note is-flag' }, 'Sales-tax, other receipts, baseline expenditure and starting reserves are ILLUSTRATIVE placeholders (audited statements could not be retrieved). Policy changes are exact arithmetic on top of them.'),
      h('div', { class: 'fc-tablewrap' }, h('table', { class: 'fc-table' },
        h('thead', {}, h('tr', {}, ['Line', 'Current policy', 'Selected', 'Change'].map(t => h('th', {}, t)))),
        h('tbody', {}, lines.map(([k, label]) => h('tr', {}, h('th', {}, label), h('td', {}, level(L[k].baseline, $)), h('td', {}, level(L[k].policy, $)),
          h('td', { class: 'fc-chg' }, change(L[k].delta, $))))))),
      h('h3', {}, 'Policy schedules this year'),
      h('ul', { class: 'fc-list' }, r.policies.filter(p => p.enabled).map(p => {
        const y = p.by_year?.[i];
        return h('li', {}, h('strong', {}, p.title), ' ', y ? (p.key === 'property_tax_adjustment'
          ? `rate ${y.rate_cents}¢ per $100; receipts ${change(y.receipts_change, $)}`
          : `${y.active ? 'active' : 'inactive'}; paid ${level(y.paid, $)}; recipients ${level(y.recipients, { kind: 'count' })}; unspent ${level(y.unspent, $)}${y.unmet > 0 ? `; unmet ${level(y.unmet, { kind: 'count' })}` : ''}`) : '');
      })),
      h('h3', {}, 'Net fiscal cost over the horizon'),
      h('p', {}, `${change(ce.net_fiscal_cost.p50, $)} (80%: ${change(ce.net_fiscal_cost.p10, $)} to ${change(ce.net_fiscal_cost.p90, $)}); payments minus extra receipts.`),
      h('p', { class: 'fc-note' }, 'Per additional job: ', ratio(ce.per_additional_job, 'job')),
      h('p', { class: 'fc-note' }, 'Per additional home: ', ratio(ce.per_additional_home, 'home')),
      warnings(r));
  }

  // ----- explain tab -----
  function explain() {
    if (!ui.result) return empty();
    const r = ui.result;
    const ex = ui.explanation;
    const on = r.policies.filter(p => p.enabled);
    const att = r.attribution;
    const reps = r.representative_draws;
    const byId = Object.fromEntries(r.metrics.map(m => [m.id, m]));
    return h('div', { class: 'fc-explain' },
      h('p', { class: 'fc-label' }, r.label),
      ex && h('div', { class: 'fc-summary' }, h('h3', {}, ex.source.startsWith('gemini') ? 'Summary (Gemini, from validated results only)' : 'Summary'),
        ...ex.text.split('\n').map(t => h('p', {}, t))),
      on.map(p => h('section', {}, h('h3', {}, p.title), h('p', {}, p.mechanism), h('p', {}, h('b', {}, 'Delays: '), p.delays),
        h('p', {}, h('b', {}, 'Constraints: '), p.constraints), h('p', {}, h('b', {}, 'Evidence: '), p.evidence_grade, '. Missing: ', p.missing_evidence))),
      att && h('section', {}, h('h3', {}, 'Attribution by removal'), h('p', { class: 'fc-note' }, att.note),
        h('table', { class: 'fc-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Card removed'), ...['workplace_jobs', 'housing_net_stock_change', 'operating_balance'].map(k => h('th', {}, byId[k].label)))),
          h('tbody', {}, Object.entries(att.by_card).map(([id, v]) => h('tr', {}, h('th', {}, id),
            ...['workplace_jobs', 'housing_net_stock_change', 'operating_balance'].map(k => h('td', {}, change(v[k], byId[k])))))))),
      reps && h('section', {}, h('h3', {}, 'One adverse and one optimistic response draw'),
        h('p', { class: 'fc-note' }, 'Two individual paired draws (10th and 90th percentile of the final-year jobs change) show that outcomes are uncertain, not guaranteed.'),
        h('table', { class: 'fc-table' }, h('thead', {}, h('tr', {}, h('th', {}, `Change in ${r.years.at(-1)}`), h('th', {}, 'Adverse draw'), h('th', {}, 'Optimistic draw'))),
          h('tbody', {}, Object.keys(reps.adverse.delta).map(k => h('tr', {}, h('th', {}, byId[k].label),
            h('td', {}, change(reps.adverse.delta[k].at(-1), byId[k])), h('td', {}, change(reps.optimistic.delta[k].at(-1), byId[k]))))))),
      h('details', {}, h('summary', {}, `Assumptions (${r.assumptions.length})`),
        h('table', { class: 'fc-table' }, h('thead', {}, h('tr', {}, ['Parameter', 'Low', 'Central', 'High', 'Grade'].map(t => h('th', {}, t)))),
          h('tbody', {}, r.assumptions.map(a => h('tr', { title: a.note }, h('th', {}, a.key, h('small', {}, a.note)), h('td', {}, String(a.low)), h('td', {}, String(a.central)), h('td', {}, String(a.high)), h('td', {}, a.grade)))))),
      h('details', {}, h('summary', {}, 'Data and lineage'),
        h('ul', { class: 'fc-list' },
          h('li', {}, `Data ${r.lineage.data_version}; model ${r.lineage.model_version}; effects ${r.lineage.effects_version}; targets ${r.lineage.benchmark_version}.`),
          h('li', {}, `Observed: LODES primary jobs through ${r.time_status.last_observed}. Nowcast: ${r.time_status.nowcast.join(', ')}. Projected: ${r.years.join(', ')}.`),
          h('li', {}, `Anchors: taxable base $${(r.anchors.taxable_base_fy2026 / 1e9).toFixed(2)}B (unaudited parcel snapshot), ${r.anchors.restricted_units_fy2025} restricted units (FY2025 inventory), rent $${r.anchors.median_gross_rent_acs_2019_2023} (ACS 2019-2023), housing units ${r.anchors.housing_units_2020_verify.toLocaleString()} (2020, needs verification).`),
          h('li', {}, 'Healthy-city peers: ', r.benchmark.peer_selection.status, '. ', r.benchmark.note))));
  }

  const empty = () => h('p', { class: 'fc-note' }, ui.phase === 'running' ? 'Calculating the forecast…' : 'Run the forecast, or load a demonstration scenario from the Policies tab.');
  const warnings = r => (r.warnings.length ? h('ul', { class: 'fc-warn' }, r.warnings.map(w => h('li', {}, w))) : null);

  // ---------- clock ----------
  simClock.subscribe(s => {
    // Play on stale results submits the one forecast job; the clock holds the cursor, not the computation.
    if (s.playing && ui.phase !== 'running' && ui.phase !== 'validating' && isStale()) submit(true);
    const prev = cur;
    cur = selectYear(ui.result, s);
    tl.update(s);
    if (prev.year !== cur.year || prev.index !== cur.index) render(); // annual state changed: tables, badges, ledger
    else updateCursorViews(s); // within a year only the chart cursor glides (visual interpolation)
  });

  render();
  if (mode !== 'live') await loadDemo('current-policies'); // something to look at straight away, labelled as a demo
  else submit(false);
  return { getResult: () => ui.result, getCursor: () => cur };
}
