// The sim plate: for each card applied in the policy panel, its sliders, decider and tradeoffs; then the year
// slider, a before/after toggle and the metrics. Built only from card data, and it never recommends anything.
import { h } from '../policy/components.js';
import { scenario, dataReady, devMode, stubOn } from './scenario.js';

const sign = d => (d > 0 ? '+' : '−');
const fixed = (n, digits) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
// inputs: the baselines.json / assumptions.json entries each metric is computed from (see shared/sim.js).
const METRICS = [
  { key: 'housingUnits', label: 'Homes', fmt: n => fixed(n, 0), inputs: ['housingUnits', 'unitsPerAcre'] },
  { key: 'medianRent', label: 'Median rent', fmt: n => `$${fixed(n, 2)}`, inputs: ['medianGrossRent', 'rentSupplyElasticity', 'housingUnits', 'unitsPerAcre'] },
  { key: 'treeCoverPct', label: 'Tree cover', fmt: n => `${fixed(n, 2)}%`, dfmt: n => `${fixed(n, 2)} pts`, inputs: ['treeCoverPct', 'mapAreaAcres', 'canopyMinPct'] },
  { key: 'avgCommuteMin', label: 'Mean commute', fmt: n => `${fixed(n, 2)} min`, inputs: ['meanCommuteMin', 'commuteDistancePenalty', 'housingUnits', 'unitsPerAcre'] },
  { key: 'taxRevenue', label: 'Property tax revenue', fmt: n => `$${fixed(n, 0)}`, inputs: ['housingUnits', 'unitsPerAcre', 'medianHomeValue', 'propertyTaxRate'] },
];
const flagOf = source => /^(PLACEHOLDER|VERIFY)/.exec(source)?.[1];
const showValue = v => (typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${x}`).join(' · ') : String(v));

export async function mountSimPlate({ policyStore, cards, host = document.body }) {
  const [, assumptions, baselines] = await dataReady;
  const sources = { ...baselines, ...assumptions };
  const cardById = new Map(cards.map(c => [c.id, c]));

  const cardsEl = h('div', { class: 'sim__cards' });
  const yearOut = h('output', { class: 'sim__val' });
  const yearIn = h('input', { type: 'range', min: 0, max: 10, step: 1, value: scenario.get().year, oninput: () => scenario.set({ year: +yearIn.value }) });
  const beforeIn = h('input', { type: 'checkbox', onchange: () => scenario.set({ before: beforeIn.checked }) });
  const rows = METRICS.map(Metric);
  const body = h('div', { class: 'sim__body', id: 'sim-body' },
    cardsEl,
    h('div', { class: 'sim__time' },
      h('label', { class: 'sim__slider' }, h('span', {}, 'Year ', yearOut), yearIn),
      h('label', { class: 'sim__check' }, beforeIn, 'Show before (year 0)')),
    h('div', { class: 'sim__metrics', role: 'group', 'aria-label': 'Metrics compared with year 0' }, rows.map(r => r.el)),
    devMode && h('label', { class: 'sim__check sim__dev' }, h('input', { type: 'checkbox', checked: stubOn, onchange: e => toggleStub(e.target.checked) }), 'Load stub card (dev)'));
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
    if (!s.result) return;
    const t = s.result.timeline, base = t[0].metrics, now = t[s.before ? 0 : s.year].metrics;
    for (const { m, value, delta } of rows) {
      const d = now[m.key] - base[m.key];
      value.textContent = m.fmt(now[m.key]);
      delta.textContent = d ? `${sign(d)}${(m.dfmt ?? m.fmt)(Math.abs(d))} (${sign(d)}${fixed(Math.abs(d / base[m.key] * 100), 2)}%)` : 'no change';
    }
  });

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

function toggleStub(on) {
  const q = new URLSearchParams(location.search);
  if (on) q.set('stub', '');
  else { q.delete('stub'); q.set('dev', ''); } // keep this toggle on screen
  location.search = q;
}
