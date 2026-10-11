// The sim plate: for each card applied in the policy panel, its sliders, decider and tradeoffs; then the year slider, a
// before/after toggle and the metrics, each as the shown year's value and its change against no new policy. Built only
// from card data and the SimResult (shared/combined.js), and it never recommends anything.
// Years, metrics and the resident card follow the shared clock (clock.js); the playback toolbar (clock-bar.js) runs it.
import { h } from '../policy/components.js';
import { scenario, simClock, dataReady, devMode, stubOn, stubAuto } from './scenario.js';
import { VARIABLES, explain } from '../../shared/luti/run.js';
import { LEVERS } from '../../shared/luti/levers.js';
import { paramStep } from '../../shared/schema.js';

// The sources popups, CH-LUTI's P10-P90 ranges, its "why" traces and the cards' timing and evidence, left off so the
// panel stays simple. true brings them back.
const DETAILS = false;


const fixed = (n, digits) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const int = n => fixed(n, 0), dollarsM = n => `$${fixed(n / 1e6, 1)}M`, points = n => `${fixed(n * 100, 1)} pts`;
// Each metric comes from one model (see shared/combined.js). dfmt formats a change (default: fmt); pct adds the change in
// percent. For DETAILS: inputs are the baselines.json / assumptions.json entries behind a metric, luti its CH-LUTI variable.
const ESTIMATES = 'The household behaviour settings behind this (who rents, incomes, how rent follows vacancy, when renters leave) are estimates, not sourced values.';
const RENT_INPUTS = ['medianGrossRent', 'lutiRegionalGrowth', 'lutiStartShare', 'unitsPerAcre'];
const HEADLINE = [
  { key: 'medianRent', label: 'Median rent', fmt: n => `$${int(n)}`, pct: true, caveat: ESTIMATES, inputs: RENT_INPUTS },
  { key: 'pricedOut', label: 'Priced out (est.)', title: 'Households living here in year 0 that have moved away because their rent rose faster than their income. An estimate.', fmt: int, caveat: ESTIMATES, inputs: ['agentScale', 'agentBurdenLine', 'agentLeaveRate', 'lutiIncomeGrowth'] },
  { key: 'housingUnits', label: 'Homes', fmt: int, pct: true, luti: 'housingUnits', inputs: ['housingUnits', 'unitsPerAcre', 'lutiStartShare', 'lutiRegionalGrowth'] },
  { key: 'treeCoverPct', label: 'Tree cover', fmt: n => `${fixed(n, 1)}%`, dfmt: n => `${fixed(n, 2)} pts`, inputs: ['treeCoverPct', 'mapAreaAcres', 'canopyMinPct'] },
  { key: 'avgCommuteMin', label: 'Commute', fmt: n => `${fixed(n, 1)} min`, inputs: ['meanCommuteMin', 'lutiSpeedKmh', 'lutiHeadwayMin', 'lutiPeakVC', 'roadBpr'] },
  { key: 'netFiscal', label: 'Town budget, net', fmt: dollarsM, luti: 'netFiscal' }, // dollars a year
];
const MORE = [
  { key: 'jobs', label: 'Jobs in town', fmt: int, pct: true, luti: 'jobs' },
  { key: 'businesses', label: 'Storefront businesses', fmt: int, pct: true, luti: 'businesses' },
  { key: 'storefrontVacancy', label: 'Downtown storefront vacancy', fmt: n => `${fixed(n * 100, 1)}%`, dfmt: points, luti: 'storefrontVacancy' },
  { key: 'transitRidership', label: 'Bus trips a year', fmt: n => `${fixed(n / 1e6, 2)}M`, dfmt: n => `${fixed(n / 1e3, 0)}k`, pct: true, luti: 'transitRidership' },
  { key: 'trafficIndex', label: 'Car traffic, % vs. year 0', fmt: n => `${n > 1 ? '+' : n < 1 ? '−' : ''}${fixed(Math.abs(n - 1) * 100, 1)}%`, dfmt: points, luti: 'trafficIndex' },
  { key: 'homeValue', label: 'Median home value', fmt: n => `$${int(n / 1e3)}k`, dfmt: n => `$${fixed(n / 1e3, 1)}k`, luti: 'homeValue' },
  { key: 'households', label: 'Households (est.)', fmt: int, pct: true, inputs: ['agentScale', 'agentHouseholds', 'agentUnits', 'lutiRegionalGrowth'] },
  { key: 'taxRevenue', label: 'Property tax revenue', fmt: dollarsM, dfmt: n => `$${fixed(n / 1e6, 2)}M`, inputs: ['housingUnits', 'medianHomeValue', 'propertyTaxRate'] },
];
// "up $12 (0.7%)", or "no change" when the change rounds away.
function change(m, d, base) {
  const body = (m.dfmt ?? m.fmt)(Math.abs(d));
  if (!/[1-9]/.test(body)) return 'no change';
  return `${d > 0 ? 'up' : 'down'} ${body}${m.pct && base ? ` (${fixed(Math.abs(d / base) * 100, 1)}%)` : ''}`;
}

// For DETAILS: CH-LUTI's own formats, for its ranges and traces. Shares change in points and indexes in percent.
const LUTI_FMT = {
  usd: n => `$${fixed(n, 0)}`, usdk: n => `$${fixed(n / 1e3, 0)}k`, usdm: n => `$${fixed(n / 1e6, 2)}M`, usdb: n => `$${fixed(n / 1e9, 2)}B`,
  int: n => fixed(n, 0), pct: n => `${fixed(n * 100, 1)}%`, millions: n => `${fixed(n / 1e6, 2)}M`, min: n => `${fixed(n, 1)} min`,
  index: n => fixed(n, 3), dec: n => fixed(n, 1), cents: n => `${fixed(n, 1)}¢`,
};
function lutiChange(id, d, base, withPct = true) { // unsigned
  const f = VARIABLES[id]?.fmt ?? 'dec', a = Math.abs(d), rel = base ? a / Math.abs(base) * 100 : 0;
  if (f === 'pct') return `${fixed(a * 100, 1)} pts`;
  if (f === 'index') return `${fixed(rel, 1)}%`;
  const body = f === 'int' && a < 10 ? fixed(a, 1) : LUTI_FMT[f](a);
  return withPct && base && f !== 'usdm' && f !== 'cents' ? `${body} (${fixed(rel, 1)}%)` : body;
}
const signed = (id, d, base) => { const body = lutiChange(id, d, base, false); return /[1-9]/.test(body) ? `${d > 0 ? '+' : '−'}${body}` : body; }; // never "−0.0"
const upDown = d => (d > 0 ? 'up' : 'down');
const OTHER_MODEL = new Set(['rent', 'rentBurden', 'households', 'population', 'commuteTime']); // CH-LUTI's own; the page shows the household model's

const WORK = { remote: 'Works from home', durham: 'Works in Durham', campus: 'Works at UNC', downtown: 'Works downtown' };
const WHERE = { downtown: 'near Franklin St', campus: 'near campus', edge: 'at the edge of town', corridor: 'along 15-501' };
const money = n => `$${fixed(n, 0)}`, share = b => `${Math.round(b * 100)}%`;
const flagOf = source => /^(PLACEHOLDER|VERIFY)/.exec(source)?.[1];
const showValue = v => (typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${x}`).join(' · ') : String(v));

export async function mountSimPlate({ policyStore, cards, host = document.body }) {
  const [, assumptions, baselines] = await dataReady;
  const sources = { ...baselines, ...assumptions };
  const cardById = new Map(cards.map(c => [c.id, c]));

  const cardsEl = h('div', { class: 'sim__list' }), residentEl = h('div', { class: 'sim__resident', 'aria-live': 'polite' });
  const yearOut = h('output', { class: 'sim__val' });
  const yearIn = h('input', { type: 'range', min: 0, max: simClock.get().steps, step: 1, value: 0, oninput: () => simClock.seek(+yearIn.value) });
  const beforeIn = h('input', { type: 'checkbox', onchange: () => simClock.setBefore(beforeIn.checked) });
  const roadBtn = h('button', { class: 'sim__road', type: 'button', 'aria-pressed': 'false', onclick: () => scenario.set({ roadView: !scenario.get().roadView }) }, 'View 15-501');
  const rows = [...HEADLINE, ...MORE].map(Metric), yearHead = h('span', {});
  const body = h('div', { class: 'sim__body', id: 'sim-body' },
    h('div', { class: 'sim__cards' }, residentEl, cardsEl),
    h('div', { class: 'sim__time' },
      h('div', { class: 'sim__year' }, h('label', { class: 'sim__slider' }, h('span', {}, 'Year ', yearOut), yearIn)),
      h('div', { class: 'sim__row' },
        h('label', { class: 'sim__check' }, beforeIn, 'Show before (year 0)'),
        roadBtn)),
    h('div', { class: 'sim__metrics', role: 'group', 'aria-label': 'Metrics, with their change against no new policy' },
      h('div', { class: 'sim-metric sim-metric--head', 'aria-hidden': 'true' }, h('span', {}), yearHead, h('span', {}, 'vs. no new policy')),
      rows.slice(0, HEADLINE.length).map(r => r.el),
      h('details', { class: 'sim__more' }, h('summary', {}, 'More details'), rows.slice(HEADLINE.length).map(r => r.el))),
    devMode && !stubAuto && h('label', { class: 'sim__check sim__dev' }, h('input', { type: 'checkbox', checked: stubOn, onchange: e => toggleStub(e.target.checked) }), 'Load stub card (dev)'),
    h('a', { class: 'sim__sources', href: 'sources.html', target: '_blank', rel: 'noopener' }, 'Sources'));
  const toggle = h('button', { class: 'sim__toggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'sim-body', onclick: () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.textContent = body.hidden ? 'Show' : 'Hide';
  } }, 'Hide');
  host.append(h('section', { class: 'plate sim', 'aria-label': 'Policy simulation' }, h('header', { class: 'sim__head' }, h('h2', {}, 'Policy simulation'), toggle), body));
  if (DETAILS) { // a popup opened by a click stays focused until a click elsewhere (the map keeps focus where it is) or Escape
    addEventListener('pointerdown', e => { const m = document.activeElement?.closest?.('.sim-metric'); if (m && !m.contains(e.target)) m.blur(); }, true);
    addEventListener('keydown', e => { if (e.key === 'Escape') document.activeElement?.closest?.('.sim-metric')?.blur(); });
  }

  // Cards applied in the policy panel drive the sim. The panel's hardcoded policies have no zone rules or levers to run.
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

  // The shown year changes only when the clock commits one, so every speed shows the same numbers on the same date.
  let drawn = [];
  function render() {
    const { shown, before } = simClock.get(), { resident, luti } = scenario.get();
    beforeIn.checked = before;
    if (!shown?.data) return;
    const now = [shown, before, resident, luti];
    if (now.every((v, i) => v === drawn[i])) return; // the clock emits every frame while playing
    drawn = now;
    const y = before ? 0 : shown.step, { run } = shown.data;
    yearOut.textContent = before ? '0 (before)' : y;
    yearIn.value = shown.step;
    yearHead.textContent = `Year ${y}`;
    for (const { m, value, delta, range, why } of rows) {
      const v = run.result.timeline[y].metrics[m.key], base = run.noPolicy.timeline[y].metrics[m.key];
      value.textContent = m.fmt(v);
      delta.textContent = change(m, v - base, base);
      if (DETAILS && m.luti) renderRange(luti, m, y, range, why);
    }
    renderResident(run.households, resident, y);
  }
  simClock.subscribe(render);
  scenario.subscribe(s => {
    roadBtn.textContent = s.roadView ? 'Back' : 'View 15-501';
    roadBtn.setAttribute('aria-pressed', String(!!s.roadView));
    render();
  });

  // DETAILS: CH-LUTI's P10-P90 range for a metric's change, and the "why" trace, from its 200 runs.
  function renderRange(r, m, y, range, why) {
    const q = 4 * y - 1, d = r?.diff[m.luti];
    range.textContent = d && y ? `P10–P90: ${signed(m.luti, d.p10[q], r.baseline[m.luti].p50[q])} to ${signed(m.luti, d.p90[q], r.baseline[m.luti].p50[q])}` : '';
    why.replaceChildren(h('strong', {}, `Why it changed, end of year ${y}`),
      d && y ? h('ul', { class: 'sim-why__tree' }, WhyNode(explain(r, m.luti, q))) : h('p', { class: 'sim-why__note' }, 'No change to trace.'),
      h('p', { class: 'sim-why__note' }, 'Traced through CH-LUTI at central assumptions. Each line is a model variable; branches that barely moved are left out.'));
  }

  // The household picked on the map, as of the shown year (or its first or last year here, outside that range).
  function renderResident(households, resident, y) {
    const a = resident == null ? null : households.agents.find(x => x.id === resident);
    if (!a) return residentEl.replaceChildren();
    const at = a.hist[Math.min(Math.max(y, a.joined), a.left ?? 10)];
    const status = y < a.joined ? `Moves here in year ${a.joined}` : a.left !== null && a.left <= y ? `Left in year ${a.left}` : a.joined ? `Moved in year ${a.joined}` : 'Lives here';
    residentEl.replaceChildren(h('section', { class: 'resident' },
      h('header', { class: 'resident__head' },
        h('h3', {}, a.name),
        h('button', { class: 'resident__close', type: 'button', 'aria-label': 'Close resident card', onclick: () => scenario.set({ resident: null }) }, '×')),
      h('p', { class: 'resident__status' }, status),
      h('dl', { class: 'resident__facts' },
        h('dt', {}, 'Job'), h('dd', {}, a.student ? (a.work === 'campus' ? 'Student at UNC' : `Student; ${WORK[a.work].toLowerCase()}`) : WORK[a.work]),
        h('dt', {}, 'Home'), h('dd', {}, a.renter ? 'Renter' : 'Owner'),
        h('dt', {}, 'Income'), h('dd', {}, `${money(at.income)} a year`),
        h('dt', {}, 'Rent'), h('dd', {}, a.renter ? `${money(at.rent)}/mo · ${share(at.burden)} of income` : 'None, owns home'),
        h('dt', {}, 'Commute'), h('dd', {}, a.work === 'remote' ? 'None, works from home' : `${at.commute} min`)),
      h('p', { class: 'resident__story' }, story(a, y, at)),
      a.renter && Sparkline(a, y)));
  }

  function Card(card) {
    const values = scenario.get().params[card.id] ?? {};
    const hint = h('p', { class: 'sim-card__hint', hidden: !changesNothing(card, values) }, 'At this setting the card changes nothing. Move the slider to try it.');
    return h('section', { class: 'sim-card' },
      h('h3', {}, card.title),
      h('p', { class: 'sim-card__summary', title: card.summary }, card.summary),
      card.params.map(p => Slider(card, p, values[p.key] ?? p.default, now => { hint.hidden = !changesNothing(card, now); })),
      hint,
      h('details', { class: 'sim-card__decider' },
        h('summary', {}, 'Who decides: ', card.decider.body),
        card.decider.how.length > 0 && h('ol', {}, card.decider.how.map(s => h('li', {}, s)))),
      DETAILS && card.timing && h('p', { class: 'sim-card__summary' }, timing(card.timing)),
      DETAILS && card.evidence?.length > 0 && h('details', { class: 'sim-card__decider' },
        h('summary', {}, 'Evidence'),
        h('ul', {}, card.evidence.map(e => h('li', {}, `${e.claim}: `, e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.source) : e.source)))),
      h('div', { class: 'sim-card__tradeoffs' },
        h('div', {}, h('h4', {}, 'Pros'), h('ul', {}, card.tradeoffs.pros.map(s => h('li', {}, s)))),
        h('div', {}, h('h4', {}, 'Cons'), h('ul', {}, card.tradeoffs.cons.map(s => h('li', {}, s))))));
  }

  function Slider(card, p, value, onChange) {
    const show = v => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}${p.unit ? ` ${p.unit}` : ''}`;
    const out = h('output', { class: 'sim__val' }, show(value));
    return h('label', { class: 'sim__slider' },
      h('span', {}, p.label, ' ', out),
      h('input', { type: 'range', min: p.min, max: p.max, step: paramStep(p), value, oninput: e => {
        const v = +e.target.value, params = scenario.get().params;
        out.textContent = show(v);
        scenario.set({ params: { ...params, [card.id]: { ...params[card.id], [p.key]: v } } });
        onChange(scenario.get().params[card.id]);
      } }));
  }

  // One line: label, the shown year's value, its change against no new policy. With DETAILS, hover or focus it for what it
  // is computed from (PLACEHOLDER and VERIFY sources flagged) or, for CH-LUTI's metrics, the range and the "why" trace.
  function Metric(m) {
    const value = h('span', { class: 'sim-metric__value' }, '…'), delta = h('span', { class: 'sim-metric__delta' });
    const range = h('span', { class: 'sim-metric__range' }), why = h('div', { class: 'sim-why', id: `sim-why-${m.key}`, role: 'tooltip' });
    const popup = DETAILS && (m.luti ? why : m.inputs && h('div', { class: 'sim-why', id: why.id, role: 'tooltip' },
      h('strong', {}, 'Assumptions and sources'),
      m.caveat && h('p', { class: 'sim-why__caveat' }, m.caveat),
      h('ul', {}, m.inputs.filter(k => sources[k]).map(k => Source(k, sources[k])))));
    const el = h('div', { class: 'sim-metric', ...(popup ? { tabindex: 0, 'aria-describedby': why.id } : {}) },
      h('span', { class: 'sim-metric__label', title: m.title }, m.label), value, delta, DETAILS && m.luti && range, popup);
    return { m, value, delta, range, why, el };
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

// Whether a card at these slider values changes nothing: every lever at its no-change value (0, or x1) and every capped
// zone rule capped at 0, as a neutral default like a 0¢ tax change. Cap levers (e.g. parking) count as a change.
function changesNothing(card, values) {
  const value = key => values?.[key] ?? card.params.find(p => p.key === key).default;
  const lever = l => { const v = l.param ? value(l.param) : l.value, kind = LEVERS[l.lever].kind; return (kind === 'amount' && v === 0) || (kind === 'multiplier' && v === 1); };
  return (card.levers ?? []).every(lever) && (card.zoneRules ?? []).every(r => r.capParam && value(r.capParam) === 0);
}

// A step of the CH-LUTI "why" trace, with its three biggest causes. Variables the page shows from another model are left out.
function WhyNode(n) {
  const kids = n.children.filter(c => !OTHER_MODEL.has(c.id)).sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel)).slice(0, 3);
  return h('li', {},
    h('span', { class: 'sim-why__key' }, `${VARIABLES[n.id]?.label ?? n.id}: ${upDown(n.delta)} ${lutiChange(n.id, n.delta, n.base)}`),
    kids.length > 0 && h('ul', {}, kids.map(WhyNode)));
}

const quarters = n => `${n} quarter${n === 1 ? '' : 's'}`;
const timing = ({ delayQuarters: d, phaseInQuarters: p }) => `Starts after ${quarters(d)}, ${p > 1 ? `phasing in over ${quarters(p)}` : 'in full at once'}.`;

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
