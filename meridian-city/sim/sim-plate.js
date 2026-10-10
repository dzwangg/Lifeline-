// The sim plate: for each card applied in the policy panel, its sliders, decider and tradeoffs; then the year
// slider, a before/after toggle and the metrics. Built only from card data, and it never recommends anything.
import { h } from '../policy/components.js';
import { scenario, dataReady, devMode, stubOn, stubAuto, shownYear } from './scenario.js';

const YEAR_MS = 1000; // play speed: one simulated year per second, so 0 to 10 takes 10 s
const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2v8l6.5-4z"/></svg>', PAUSE_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2h2.2v8H3zM6.8 2H9v8H6.8z"/></svg>';

const sign = d => (d > 0 ? '+' : '−');
const fixed = (n, digits) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
// inputs: the baselines.json / assumptions.json entries each metric is computed from (see shared/sim.js and shared/agents.js).
// Homes, tree cover and tax come from the SimResult; the rest from the household model (agents), the one source for rent
// and commute. scaled: simulated households x agentScale. vsNoPolicy: compared with the household model run without new
// homes in the same year, so growth-driven changes aren't put down to the policy; the others compare with year 0.
const METRICS = [
  { key: 'housingUnits', label: 'Homes', fmt: n => fixed(n, 0), inputs: ['housingUnits', 'unitsPerAcre'] },
  { key: 'medianRent', label: 'Median rent', agents: y => y.medianRent, vsNoPolicy: true, fmt: n => `$${fixed(n, 0)}`, inputs: ['medianGrossRent', 'agentRentAmp', 'agentTargetVacancy', 'agentRentCurve', 'agentGrowth', 'agentInducedShare', 'agentUnits', 'unitsPerAcre', 'agentScale'] },
  { key: 'treeCoverPct', label: 'Tree cover', fmt: n => `${fixed(n, 2)}%`, dfmt: n => `${fixed(n, 2)} pts`, inputs: ['treeCoverPct', 'mapAreaAcres', 'canopyMinPct'] },
  { key: 'avgCommuteMin', label: 'Mean commute', agents: y => y.commute, vsNoPolicy: true, fmt: n => `${fixed(n, 1)} min`, inputs: ['meanCommuteMin', 'roadT0Min', 'roadCapacity', 'roadPeakVolume', 'roadBpr', 'roadCarShare', 'agentRemoteShare', 'agentDurhamShare', 'agentBaseCommuteMin', 'agentDurhamExtraMin'] },
  { key: 'taxRevenue', label: 'Property tax revenue', fmt: n => `$${fixed(n, 0)}`, inputs: ['housingUnits', 'unitsPerAcre', 'medianHomeValue', 'propertyTaxRate'] },
  { key: 'households', label: 'Households (est.)', agents: y => y.pop, scaled: true, fmt: n => fixed(n, 0), inputs: ['agentScale', 'agentHouseholds', 'agentUnits', 'agentGrowth', 'agentInducedShare'] },
  { key: 'pricedOut', label: 'Priced out (est.)', agents: y => y.displaced, scaled: true, fmt: n => fixed(n, 0), inputs: ['agentScale', 'agentBurdenLine', 'agentBurdenRise', 'agentLeaveProb', 'agentRentAmp', 'agentTargetVacancy'] },
];
const WORK = { remote: 'Works from home', durham: 'Works in Durham', campus: 'Works at UNC', downtown: 'Works downtown' };
const WHERE = { downtown: 'near Franklin St', campus: 'near campus', edge: 'at the edge of town' };
const money = n => `$${fixed(n, 0)}`, share = b => `${Math.round(b * 100)}%`;
const flagOf = source => /^(PLACEHOLDER|VERIFY)/.exec(source)?.[1];
const showValue = v => (typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${x}`).join(' · ') : String(v));

export async function mountSimPlate({ policyStore, cards, host = document.body }) {
  const [, assumptions, baselines] = await dataReady;
  const sources = { ...baselines, ...assumptions };
  const cardById = new Map(cards.map(c => [c.id, c]));

  const cardsEl = h('div', { class: 'sim__list' }), residentEl = h('div', { class: 'sim__resident', 'aria-live': 'polite' });
  const yearOut = h('output', { class: 'sim__val' });
  const yearIn = h('input', { type: 'range', min: 0, max: 10, step: 1, value: scenario.get().year, oninput: () => { pause(); scenario.set({ year: +yearIn.value }); } });
  const beforeIn = h('input', { type: 'checkbox', onchange: () => { pause(); scenario.set({ before: beforeIn.checked }); } });
  const playBtn = h('button', { class: 'sim__play', type: 'button', 'aria-label': 'Play years', html: PLAY_ICON, onclick: () => (timer ? pause() : play()) });
  let timer = null;
  function play() { // from the current year, or from 0 if already at the end
    const max = +yearIn.max, from = scenario.get().year >= max ? 0 : scenario.get().year;
    beforeIn.checked = false;
    scenario.set({ before: false, year: from });
    timer = setInterval(() => { const year = scenario.get().year + 1; scenario.set({ year }); if (year >= max) pause(); }, YEAR_MS);
    playBtn.innerHTML = PAUSE_ICON;
    playBtn.setAttribute('aria-label', 'Pause');
  }
  function pause() {
    clearInterval(timer);
    timer = null;
    playBtn.innerHTML = PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play years');
  }
  const rows = METRICS.map(Metric);
  const body = h('div', { class: 'sim__body', id: 'sim-body' },
    h('div', { class: 'sim__cards' }, residentEl, cardsEl),
    h('div', { class: 'sim__time' },
      h('div', { class: 'sim__year' }, playBtn, h('label', { class: 'sim__slider' }, h('span', {}, 'Year ', yearOut), yearIn)),
      h('label', { class: 'sim__check' }, beforeIn, 'Show before (year 0)')),
    h('div', { class: 'sim__metrics', role: 'group', 'aria-label': 'Metrics compared with year 0, or with no new policy' }, rows.map(r => r.el)),
    devMode && !stubAuto && h('label', { class: 'sim__check sim__dev' }, h('input', { type: 'checkbox', checked: stubOn, onchange: e => toggleStub(e.target.checked) }), 'Load stub card (dev)'));
  const toggle = h('button', { class: 'sim__toggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'sim-body', onclick: () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.textContent = body.hidden ? 'Show' : 'Hide';
  } }, 'Hide');
  host.append(h('section', { class: 'plate sim', 'aria-label': 'Policy simulation' }, h('header', { class: 'sim__head' }, h('h2', {}, 'Policy simulation'), toggle), body));

  // Cards applied in the policy panel drive the sim. The panel's hardcoded policies have no zone rules to run.
  let shown = null;
  const sync = ({ applied }) => {
    const ids = Object.values(applied).filter(Boolean);
    if (ids.join() === shown) return; // the panel also emits while its draft changes
    shown = ids.join();
    const active = ids.map(id => cardById.get(id)).filter(Boolean);
    const other = ids.filter(id => !cardById.has(id)).map(id => policyStore.getPolicy(id)?.title ?? id);
    cardsEl.replaceChildren(...[
      !cards.length ? h('p', { class: 'sim__empty' }, 'No policies yet.')
        : !active.length && h('p', { class: 'sim__empty' }, 'Apply a policy card in the Policies panel to simulate it.'),
      ...active.map(Card),
      other.length > 0 && h('p', { class: 'sim__note' }, `Not simulated yet: ${other.join(', ')}.`),
    ].filter(Boolean));
    scenario.set({ cards: active });
  };
  policyStore.subscribe(sync);
  sync(policyStore.getState());

  scenario.subscribe(s => {
    yearOut.textContent = s.before ? '0 (before)' : s.year;
    yearIn.value = s.year;
    if (!s.result) return;
    const y = shownYear(s), scale = sources.agentScale.value;
    const get = (m, run, yr) => (m.agents ? run && m.agents(run.years[yr]) * (m.scaled ? scale : 1) : s.result.timeline[yr].metrics[m.key]);
    for (const { m, value, delta } of rows) {
      const now = get(m, s.households, y), base = m.vsNoPolicy ? get(m, s.noPolicy, y) : get(m, s.households, 0), d = now - base;
      const change = `${sign(d)}${(m.dfmt ?? m.fmt)(Math.abs(d))}${base ? ` (${sign(d)}${fixed(Math.abs(d / base * 100), 2)}%)` : ''}`;
      value.textContent = now == null ? '…' : m.fmt(now);
      delta.textContent = now == null || base == null ? '' : m.vsNoPolicy ? (d ? `${change} vs. no new policy` : 'same as no new policy') : (d ? change : 'no change');
    }
    renderResident(s);
  });

  // The household picked on the map, as of the shown year (or its first or last year here, outside that range).
  function renderResident(s) {
    const a = s.resident == null ? null : s.households?.agents.find(x => x.id === s.resident);
    if (!a) return residentEl.replaceChildren();
    const y = shownYear(s), at = a.hist[Math.min(Math.max(y, a.joined), a.left ?? 10)];
    const status = y < a.joined ? `Moves here in year ${a.joined}` : a.left !== null && a.left <= y ? `Left in year ${a.left}` : a.joined ? `Moved in year ${a.joined}` : 'Lives here';
    residentEl.replaceChildren(h('section', { class: 'resident' },
      h('header', { class: 'resident__head' },
        h('h3', {}, a.name),
        h('button', { class: 'resident__close', type: 'button', 'aria-label': 'Close resident card', onclick: () => scenario.set({ resident: null }) }, '×')),
      h('p', { class: 'resident__status' }, status),
      h('dl', { class: 'resident__facts' },
        h('dt', {}, 'Job'), h('dd', {}, a.student ? (a.work === 'campus' ? 'Student at UNC' : `Student; ${WORK[a.work].toLowerCase()}`) : WORK[a.work]),
        h('dt', {}, 'Home'), h('dd', {}, a.renter ? 'Renter' : 'Owner'),
        h('dt', {}, 'Income'), h('dd', {}, `${money(a.income)} a year`),
        h('dt', {}, 'Rent'), h('dd', {}, a.renter ? `${money(at.rent)}/mo · ${share(at.burden)} of income` : 'None, owns home'),
        h('dt', {}, 'Commute'), h('dd', {}, a.work === 'remote' ? 'None, works from home' : `${at.commute} min`)),
      h('p', { class: 'resident__story' }, story(a, y, at)),
      a.renter && Sparkline(a, y)));
  }

  function Card(card) {
    const values = scenario.get().params[card.id] ?? {};
    return h('section', { class: 'sim-card' },
      h('h3', {}, card.title),
      h('p', { class: 'sim-card__summary' }, card.summary),
      card.params.map(p => Slider(card, p, values[p.key] ?? p.default)),
      h('details', { class: 'sim-card__decider' },
        h('summary', {}, 'Who decides: ', card.decider.body),
        card.decider.how.length > 0 && h('ol', {}, card.decider.how.map(s => h('li', {}, s)))),
      h('div', { class: 'sim-card__tradeoffs' },
        h('div', {}, h('h4', {}, 'Pros'), h('ul', {}, card.tradeoffs.pros.map(s => h('li', {}, s)))),
        h('div', {}, h('h4', {}, 'Cons'), h('ul', {}, card.tradeoffs.cons.map(s => h('li', {}, s))))));
  }

  function Slider(card, p, value) {
    const show = v => `${fixed(v, Number.isInteger(v) ? 0 : 1)}${p.unit ? ` ${p.unit}` : ''}`;
    const out = h('output', { class: 'sim__val' }, show(value));
    const allInts = [p.min, p.max, p.default].every(Number.isInteger);
    return h('label', { class: 'sim__slider' },
      h('span', {}, p.label, ' ', out),
      h('input', { type: 'range', min: p.min, max: p.max, step: allInts ? 1 : (p.max - p.min) / 100, value, oninput: e => {
        const v = +e.target.value, params = scenario.get().params;
        out.textContent = show(v);
        scenario.set({ params: { ...params, [card.id]: { ...params[card.id], [p.key]: v } } });
      } }));
  }

  // Hover or focus a metric to see what it is computed from. PLACEHOLDER and VERIFY sources are flagged.
  function Metric(m) {
    const value = h('span', { class: 'sim-metric__value' }), delta = h('span', { class: 'sim-metric__delta' }), tip = `sim-why-${m.key}`;
    const el = h('div', { class: 'sim-metric', tabindex: 0, 'aria-describedby': tip },
      h('span', { class: 'sim-metric__label' }, m.label), value, delta,
      h('div', { class: 'sim-why', id: tip, role: 'tooltip' },
        h('strong', {}, 'Assumptions and sources'),
        h('ul', {}, m.inputs.filter(k => sources[k]).map(k => Source(k, sources[k])))));
    return { m, value, delta, el };
  }

  function Source(key, e) {
    const flag = flagOf(e.source);
    return h('li', { class: flag && 'is-flagged' },
      h('span', { class: 'sim-why__key' }, `${key} = ${showValue(e.value)}${e.unit ? ` ${e.unit}` : ''}`),
      flag && h('span', { class: 'sim-why__flag' }, flag),
      h('span', { class: 'sim-why__src' }, e.source),
      e.note && h('span', { class: 'sim-why__note' }, e.note),
      e.alternate && h('span', { class: 'sim-why__note' }, `Alternate: ${showValue(e.alternate.value)}. ${e.alternate.source}`));
  }
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
function Sparkline(a, y) {
  const end = a.left ?? 10, pts = [];
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
