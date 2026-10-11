// Meet a resident, in the city: a glass window over the map with the fifty showcase residents (data/residents.json) and
// "You". Each resident's orb wears its map dot's colour for the shown year (sim/residents.js statusOf). Picking one shows
// their monthly budget, their savings over the decade and their Nessie bank ledger (/api/resident-bank), with no new
// policy and with the policies on the map, and lets the player talk to them (/api/resident). Opens from the Residents
// button, the R key, a showcase resident's card on the map (the 'prosperia:meet' event) or ?meet=<id> in the address.
import { h } from '../policy/components.js';
import { scenario, simClock, cardsReady } from '../sim/scenario.js';
import { residentsReady, residentState, statusOf, STATUS } from '../sim/residents.js';

const TYPES = [['all', 'Everyone'], ['student', 'Students'], ['family', 'Families'], ['owner', 'Homeowners'], ['commuter', 'Durham commuters']];
const TYPE = { student: 'Student', family: 'Renting family', owner: 'Homeowner', commuter: 'Durham commuter' };
const ZONE = { downtown: 'downtown', campus: 'near campus', edge: 'on the edge of town' };
const WORK = { remote: 'works from home', durham: 'works in Durham', campus: 'works on campus', downtown: 'works downtown' };
const MODE = { car: 'by car', bus: 'by bus', bike: 'by bike', walk: 'on foot', none: '' };
const money = v => (v == null ? '–' : `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`);
const signed = v => (!v ? '$0' : `${v > 0 ? '+' : '−'}$${Math.abs(v).toLocaleString('en-US')}`);
const saved = y => (!y ? '–' : y.borrowed ? `$0, ${money(y.borrowed)} borrowed` : y.behind ? `$0, ${money(y.behind)} behind` : money(y.savings));
const store = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const json = path => fetch(new URL(`../../data/${path}`, import.meta.url)).then(r => r.json());

export async function mountResidentPanel({ launch }) {
  const [{ residents }, demo, cards] = await Promise.all([json('residents.json'), json('demo-scenarios.json'), cardsReady]);
  await residentsReady;
  const byId = new Map(cards.map(c => [c.id, c]));
  let open = false, pick = residents[0].id, filter = 'all', compare = 'map', tab = 'budget', year = 10, data = null, latest = 0, asked = 0;
  let run = null, shownYear = 0, opener = null;

  // ---------- the window ----------
  const $ = {};
  const ref = (name, el) => ($[name] = el);
  const roster = ref('roster', h('div', { class: 'mr-roster', role: 'listbox', 'aria-label': 'Residents' }));
  const filters = h('div', { class: 'mr-filters', role: 'group', 'aria-label': 'Show' },
    TYPES.map(([id, label]) => h('button', { type: 'button', class: 'mr-chip', 'data-filter': id, 'aria-pressed': String(id === filter), onclick: () => { filter = id; drawRoster(); } }, label)));
  const compareSel = ref('compare', h('select', { class: 'mr-select', 'aria-label': 'Compare no new policy with', onchange: e => { compare = e.target.value; load(); } }));
  const yearIn = ref('year', h('input', { type: 'range', min: 0, max: 10, value: year, class: 'mr-range', 'aria-label': 'Year', oninput: e => { year = +e.target.value; data && render(); } }));
  const tabs = h('div', { class: 'mr-tabs', role: 'tablist' },
    [['budget', 'Budget'], ['savings', 'Savings'], ['bank', 'Bank ledger'], ['talk', 'Talk']].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', class: 'mr-tab', 'data-tab': id, 'aria-selected': String(id === tab), onclick: () => { tab = id; showTab(); } }, label)));
  const youForm = ref('you', h('form', { class: 'mr-you', hidden: true, onsubmit: e => { e.preventDefault(); load(); } },
    h('label', {}, 'Rent a month', h('input', { name: 'rent', type: 'number', min: 0, max: 20000, step: 10, value: 1400, required: true })),
    h('label', {}, 'Income a year, before tax', h('input', { name: 'income', type: 'number', min: 0, max: 2000000, step: 500, value: 55000, required: true })),
    h('label', {}, 'Where you live', h('select', { name: 'zone' }, Object.entries(ZONE).map(([v, t]) => h('option', { value: v }, t[0].toUpperCase() + t.slice(1))))),
    h('label', {}, 'Getting to work', h('select', { name: 'mode' }, [['car', 'Car'], ['bus', 'Bus'], ['bike', 'Bike'], ['walk', 'Walk'], ['none', 'I work from home']].map(([v, t]) => h('option', { value: v }, t)))),
    h('button', { type: 'submit', class: 'pp-btn pp-btn--primary mr-go' }, 'Show my budget'),
    h('p', { class: 'mr-fine' }, 'Illustrative only. Your numbers go to a sandbox Nessie account called "Visitor", which this browser remembers. Never enter real account details.')));
  const panes = {
    budget: ref('budget', h('div', { class: 'mr-pane', role: 'tabpanel' })),
    savings: ref('savings', h('div', { class: 'mr-pane', role: 'tabpanel' })),
    bank: ref('bank', h('div', { class: 'mr-pane', role: 'tabpanel' })),
    talk: ref('talk', h('div', { class: 'mr-pane mr-talk', role: 'tabpanel' })),
  };
  const head = ref('head', h('header', { class: 'mr-who' }));
  const status = ref('status', h('p', { class: 'mr-status', 'aria-live': 'polite' }));
  const close = h('button', { type: 'button', class: 'tool-btn mr-close', 'aria-label': 'Close residents', onclick: () => hide() },
    h('span', { 'aria-hidden': 'true' }, '×'));
  const win = h('section', { class: 'mr-window', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mr-title' },
    h('div', { class: 'mr-titlebar' }, h('h2', { id: 'mr-title' }, 'Meet the residents'),
      h('p', {}, `${residents.length} Chapel Hill households from the town's model, their money kept in Capital One's Nessie sandbox bank.`), close),
    h('div', { class: 'mr-body' },
      h('aside', { class: 'mr-side' }, filters, roster),
      h('div', { class: 'mr-main' }, head, youForm,
        h('div', { class: 'mr-controls' },
          h('label', {}, 'Compare with', compareSel),
          h('label', { class: 'mr-year' }, 'Year', yearIn, ref('yearOut', h('output', {}, year)))),
        tabs, status, Object.values(panes))));
  const scrim = h('div', { class: 'mr-scrim', hidden: true, onclick: e => { if (e.target === scrim) hide(); } }, win);
  document.body.append(scrim);

  // ---------- what to compare: the map's policies, or one card ----------
  function fillCompare() {
    const mapCards = mapPolicies();
    compareSel.replaceChildren(
      h('option', { value: 'map' }, mapCards.length ? `The policies on the map (${mapCards.length})` : 'The policies on the map (none yet)'),
      h('optgroup', { label: 'One policy' }, cards.filter(c => c.id !== 'stub-card').map(c => h('option', { value: `card:${c.id}` }, c.title))));
    compareSel.value = compare;
  }
  // What the bank and the residents (/api/resident-bank, /api/resident) accept: up to 10 of the town's own cards (drafted
  // ones live only in this browser), each once, with only that card's params, as numbers within its ranges. The map's
  // params can hold more (a slot shared twice, an "ask the city" adjustment), so they are cleaned here, not sent as they are.
  function mapPolicies() {
    const s = scenario.get(), out = [];
    for (const c of s.cards) {
      const card = byId.get(c.id);
      if (!card || out.some(p => p.id === c.id) || out.length >= 10) continue;
      const given = s.params?.[c.id] ?? {}, params = {};
      for (const p of card.params ?? []) if (given[p.key] != null && Number.isFinite(+given[p.key])) params[p.key] = Math.min(p.max, Math.max(p.min, +given[p.key]));
      out.push({ id: c.id, params });
    }
    return out;
  }
  function policies() {
    if (compare === 'map') return mapPolicies();
    return [{ id: compare.slice(5), params: {} }];
  }

  // ---------- the roster: one glossy orb per resident, in its map dot's colour ----------
  const statusFor = id => (run ? statusOf(residentState(run, id), shownYear) : null);
  function orb(r, big = false) {
    const st = r.id === 'you' ? null : statusFor(r.id);
    return h('span', { class: `mr-orb${big ? ' mr-orb--big' : ''}`, 'data-type': r.type ?? 'you', style: { '--ring': st ? STATUS[st].color : 'transparent' }, 'aria-hidden': 'true' },
      r.name[0]);
  }
  function drawRoster() {
    for (const b of filters.children) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    const list = residents.filter(r => filter === 'all' || r.type === filter);
    roster.replaceChildren(
      ...list.map(r => {
        const st = statusFor(r.id);
        return h('button', { type: 'button', role: 'option', class: 'mr-person', 'aria-selected': String(r.id === pick), 'data-id': r.id,
          title: st ? `${r.name} · ${STATUS[st].label}` : r.name, onclick: () => choose(r.id) }, orb(r), h('span', { class: 'mr-person__name' }, r.name), h('span', { class: 'mr-person__type' }, TYPE[r.type]));
      }),
      filter === 'all' && h('button', { type: 'button', role: 'option', class: 'mr-person mr-person--you', 'aria-selected': String(pick === 'you'), onclick: () => choose('you') },
        orb({ id: 'you', name: '+' }), h('span', { class: 'mr-person__name' }, 'You'), h('span', { class: 'mr-person__type' }, 'Try your own numbers')));
  }
  function choose(id) {
    pick = id;
    drawRoster();
    if (id === 'you') { youForm.hidden = false; clear(); head.replaceChildren(h('div', { class: 'mr-who__text' }, h('h3', {}, 'You'), h('p', {}, 'Put in your rent and income to see your own decade in Chapel Hill.'))); return; }
    youForm.hidden = true;
    year = 10; yearIn.value = 10; // a new resident starts at the decade's end, or their last year in town (load)
    load();
  }

  // ---------- loading a budget ----------
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let youQueue = Promise.resolve(); // "You" goes one request at a time, so overlapping ones never make two Nessie accounts
  function youRequest(body) {
    const turn = youQueue.then(async () => {
      const account = store.get('prosperia-you-account');
      if (account) body.account = account;
      let res = await post('/api/resident-bank', body);
      if (res.status === 400 && body.account) { store.set('prosperia-you-account', null); delete body.account; res = await post('/api/resident-bank', body); }
      const out = await res.json();
      if (out.account) store.set('prosperia-you-account', out.account);
      return { res, out };
    });
    youQueue = turn.catch(() => {});
    return turn;
  }
  function clear() {
    latest++; asked++; data = null;
    for (const p of Object.values(panes)) p.replaceChildren();
    status.textContent = '';
  }
  async function load() {
    clear();
    const id = latest, you = pick === 'you', body = { policies: policies(), ledger: true };
    if (you) { const f = new FormData(youForm); body.you = { rent: +f.get('rent'), income: +f.get('income'), zone: f.get('zone'), mode: f.get('mode') }; }
    else body.resident = pick;
    status.textContent = 'Loading…';
    let res, out;
    try {
      ({ res, out } = you ? await youRequest(body) : await post('/api/resident-bank', body).then(async r => ({ res: r, out: await r.json() })));
    } catch {
      if (id === latest) status.textContent = 'The budget is unavailable right now. Check your connection and pick the resident again.';
      return;
    }
    if (id !== latest) return; // the pick or the comparison changed while this was on its way
    if (!res.ok) { status.textContent = out.error ?? `The budget is unavailable (HTTP ${res.status}).`; return; }
    data = out;
    const last = Math.max(out.noPolicy.years.at(-1).t, out.policy.years.at(-1).t);
    if (year > last) { year = last; yearIn.value = last; }
    status.textContent = '';
    render();
  }

  // ---------- drawing ----------
  function render() {
    const { resident: r, policy, noPolicy, ledger, policies: used, change } = data;
    $.yearOut.value = year;
    const title = used.map(p => p.title).join(' + ');
    const at = b => b.years.find(y => y.t === year), [a, b] = [at(noPolicy), at(policy)];
    head.replaceChildren(orb({ id: r.id, name: r.name, type: r.type }, true), h('div', { class: 'mr-who__text' },
      h('h3', {}, r.name), h('p', {}, r.id === 'you' ? `You rent ${ZONE[r.zone]}${r.mode === 'none' ? ' and work from home' : ` and get to work ${MODE[r.mode]}`}.`
        : `${TYPE[r.type]}. ${r.tenure === 'owner' ? 'Owns a home' : 'Rents'} ${ZONE[r.zone]} and ${WORK[r.work]}${r.work === 'remote' || !MODE[r.mode] ? '' : `, ${MODE[r.mode]}`}.`),
      r.id !== 'you' && h('button', { type: 'button', class: 'mr-link', onclick: () => { hide(); scenario.set({ resident: r.id }); } }, 'Find on the map')));

    // budget: a month in the chosen year, side by side
    const rows = [['Take-home pay', 'pay', 1], ['Housing', 'housing', -1], ['Commute', 'commute', -1], ['Everything else', 'basket', -1], ['Left over', 'net', 1]];
    const cell = (y, k, sign) => (y ? money(sign * y[k]) : 'moved away');
    panes.budget.replaceChildren(
      h('h4', {}, `A month in ${2026 + year}`),
      h('table', { class: 'mr-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'No new policy'), title && h('th', {}, 'With ' + (compare === 'map' ? 'your policies' : 'the policy')), title && h('th', {}, 'Difference'))),
        h('tbody', {}, rows.map(([label, k, sign]) => h('tr', { class: k === 'net' ? 'is-total' : '' },
          h('th', { scope: 'row' }, label), h('td', {}, cell(a, k, sign)), title && h('td', {}, cell(b, k, sign)), title && h('td', { class: 'mr-delta' }, a && b ? signed(sign * (b[k] - a[k])) : '–'))),
          noPolicy.borrows && (a?.borrowed || b?.borrowed) && h('tr', {}, h('th', { scope: 'row' }, 'Borrowed so far'), h('td', {}, a ? money(a.borrowed) : 'moved away'), title && h('td', {}, b ? money(b.borrowed) : 'moved away'), title && h('td', {}, '–')))),
      title ? h('p', { class: 'mr-sum' }, change.net ? `Over the years to ${2026 + change.throughYear}, ${title} leaves ${r.name === 'You' ? 'you' : r.name} ${money(Math.abs(change.net))} ${change.net > 0 ? 'better' : 'worse'} off.` : `${title} doesn't change ${r.name === 'You' ? 'your' : `${r.name}'s`} money.`)
        : h('p', { class: 'mr-sum' }, 'No policies on the map yet. Apply some in Policies, or pick one policy to compare above.'),
      flags(r, title ? [['With the policy', policy], ['With no new policy', noPolicy]] : [['With no new policy', noPolicy]]));

    // savings: two lines over the decade
    panes.savings.replaceChildren(h('h4', {}, 'Savings at the end of each year'),
      h('div', { class: 'mr-legend' }, h('span', { class: 'mr-key mr-key--a' }, 'No new policy'), title && h('span', { class: 'mr-key mr-key--b' }, title)),
      chart(noPolicy, title ? policy : null, title),
      h('details', {}, h('summary', {}, 'Savings as a table'), h('table', { class: 'mr-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Year'), h('th', {}, 'No new policy'), title && h('th', {}, 'With the policy'))),
        h('tbody', {}, noPolicy.years.map((y, i) => h('tr', {}, h('th', { scope: 'row' }, 2026 + y.t), h('td', {}, saved(y)), title && h('td', {}, saved(policy.years[i]))))))));

    // bank: the Nessie ledger, read back
    const fromNessie = ledger.source === 'nessie';
    panes.bank.replaceChildren(
      h('div', { class: `mr-bank${fromNessie ? ' is-live' : ''}` },
        h('span', { class: 'mr-bank__badge' }, fromNessie ? (ledger.written ? 'Nessie · just written' : 'Nessie · on file') : 'Computed here'),
        h('p', {}, fromNessie ? `Read back from Capital One's Nessie sandbox. Its entries add up to ${money(ledger.totals.checking)} left in checking for the month and ${money(ledger.totals.savings)} in savings${ledger.totals.loan ? `, with ${money(ledger.totals.loan)} owed on the loan account` : ''}.`
          : `${ledger.note} The entries add up to ${money(ledger.totals.checking)} left for the month and ${money(ledger.totals.savings)} in savings${ledger.totals.loan ? `, with ${money(ledger.totals.loan)} owed` : ''}.`)),
      h('table', { class: 'mr-table mr-ledger' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Entry'), h('th', {}, 'Account'), h('th', {}, 'Date'), h('th', {}, 'Amount'))),
        h('tbody', {}, ledger.entries.map(e => h('tr', {}, h('th', { scope: 'row' }, e.label.replace(/^\[\w+\] /, '')),
          h('td', {}, e.account), h('td', {}, e.date ?? ''), h('td', { class: e.kind === 'deposits' || e.kind === 'loans' ? 'is-in' : 'is-out' }, money(e.amount)))))));

    drawTalk(r);
    showTab();
  }
  function flags(r, runs) {
    const who = r.name === 'You' ? 'you' : r.name, out = [];
    for (const [name, run] of runs) {
      if (run.left !== null) out.push(`${name}, ${who} ${who === 'you' ? 'move' : 'moves'} out of town in ${2026 + run.left}.`);
      const end = run.years.at(-1);
      if (run.savingsOut !== null) out.push(end.borrowed ? `${name}, savings run out in ${2026 + run.savingsOut}; after that the gap is covered by ${r.type === 'student' ? 'student loans' : 'loans'} or family: ${money(end.borrowed)} borrowed by ${2026 + end.t}.`
        : `${name}, savings run out in ${2026 + run.savingsOut} and bills fall behind: ${money(end.behind)} unpaid by ${2026 + end.t}.`);
    }
    return out.length ? h('ul', { class: 'mr-flags' }, out.map(t => h('li', {}, t))) : null;
  }
  function chart(a, b, title) {
    const W = 560, H = 200, L = 62, R = 12, T = 12, B = 24, all = [...a.years, ...(b?.years ?? [])].map(y => y.savings).concat(0);
    const lo = Math.min(...all), hi = Math.max(Math.max(...all), lo + 1000);
    const x = t => L + t / 10 * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const grid = [0, 1, 2, 3, 4].map(i => lo + (hi - lo) * i / 4);
    const line = (run, cls) => `<polyline class="${cls}" points="${run.years.map(p => `${x(p.t).toFixed(1)},${y(p.savings).toFixed(1)}`).join(' ')}"/>`
      + `<rect class="${cls}" x="${(x(run.years.at(-1).t) - 4).toFixed(1)}" y="${(y(run.years.at(-1).savings) - 4).toFixed(1)}" width="8" height="8"/>`;
    return h('div', { class: 'mr-chart', html: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings by year${title ? ', with and without the policy' : ''}">`
      + grid.map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${money(Math.round(v / 100) * 100)}</text>`).join('')
      + [0, 2, 4, 6, 8, 10].map(t => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${2026 + t}</text>`).join('')
      + line(a, 'a') + (b ? line(b, 'b') : '') + '</svg>' });
  }

  // ---------- talk: speech bubbles, starter questions, the resident's voice ----------
  const audio = new Audio();
  function drawTalk(r) {
    asked++;
    audio.pause();
    if (r.id === 'you') { panes.talk.replaceChildren(h('p', { class: 'mr-sum' }, 'Pick a resident to talk to them.')); return; }
    const log = h('div', { class: 'mr-chat', 'aria-live': 'polite' },
      h('p', { class: 'mr-bubble mr-bubble--them' }, `Hi, I'm ${r.name}. Ask me how life in Chapel Hill is going.`));
    const input = h('textarea', { rows: 2, maxlength: 300, placeholder: `Ask ${r.name} a question`, 'aria-label': `Your question for ${r.name}`,
      onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } } });
    const send = h('button', { type: 'submit', class: 'pp-btn pp-btn--primary' }, 'Ask');
    async function ask(question) {
      question = question.trim();
      if (!question) return;
      const mine = ++asked;
      input.value = '';
      send.disabled = true;
      log.append(h('p', { class: 'mr-bubble mr-bubble--me' }, question));
      const reply = h('p', { class: 'mr-bubble mr-bubble--them is-typing' }, '…');
      log.append(reply);
      log.scrollTop = log.scrollHeight;
      try {
        const res = await post('/api/resident', { resident: r.id, policies: policies(), question });
        const out = await res.json();
        if (mine !== asked) return;
        reply.classList.remove('is-typing');
        reply.textContent = res.ok ? out.text : out.error;
        if (out.fallback) reply.append(h('small', {}, 'A standard answer: the AI answer was unavailable.'));
        if (out.audio) {
          const play = h('button', { type: 'button', class: 'mr-play', 'aria-label': `Hear ${r.name} say it`, onclick: () => { audio.src = `data:audio/mpeg;base64,${out.audio}`; audio.play(); } }, '▶ Hear it');
          reply.append(play);
        }
      } catch {
        if (mine === asked) { reply.classList.remove('is-typing'); reply.textContent = `${r.name} can't answer right now. Check your connection and ask again.`; }
      } finally {
        if (mine === asked) send.disabled = false;
        log.scrollTop = log.scrollHeight;
      }
    }
    panes.talk.replaceChildren(log,
      h('div', { class: 'mr-starters', role: 'group', 'aria-label': 'Questions to start with' }, demo.questions.map(q => h('button', { type: 'button', class: 'mr-chip', onclick: () => ask(q) }, q))),
      h('form', { class: 'mr-ask', onsubmit: e => { e.preventDefault(); ask(input.value); } }, input, send),
      h('p', { class: 'mr-fine' }, `AI-written, in character, from ${r.name}'s simulated numbers only.`));
  }

  function showTab() {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const [id, p] of Object.entries(panes)) p.hidden = id !== tab;
  }

  // ---------- open and close ----------
  function show(id) {
    if (id && (id === 'you' || residents.some(r => r.id === id))) pick = id;
    if (!open) { opener = document.activeElement; open = true; scrim.hidden = false; document.body.classList.add('mr-open'); }
    fillCompare();
    drawRoster();
    choose(pick);
    roster.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    close.focus();
  }
  function hide() {
    if (!open) return;
    open = false; scrim.hidden = true; asked++; audio.pause();
    document.body.classList.remove('mr-open');
    opener?.focus?.();
  }
  launch.addEventListener('click', () => show());
  addEventListener('prosperia:meet', e => show(e.detail?.id));
  addEventListener('keydown', e => {
    if (open && e.key === 'Escape') { e.stopPropagation(); hide(); return; }
    if (open && e.key === 'Tab') { // keep focus in the window
      const f = [...win.querySelectorAll('button, select, input, textarea, summary, a[href]')].filter(n => !n.disabled && n.offsetParent);
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (e.key.toLowerCase() !== 'r' || open || document.body.classList.contains('city-loading') || e.ctrlKey || e.metaKey || e.altKey
      || e.target.closest?.('input, textarea, select, [contenteditable], [role="dialog"]')) return;
    show();
  }, true);
  // the orbs follow the map: its run and shown year set each one's colour
  simClock.subscribe(({ shown, before }) => {
    if (!shown?.data) return;
    run = shown.data.run?.households ?? null; shownYear = before ? 0 : shown.step;
    if (open) drawRoster();
  });
  scenario.subscribe(() => { if (open) fillCompare(); });
  const meet = new URLSearchParams(location.search).get('meet');
  if (meet != null) show(meet || undefined);
  return { show, hide, isOpen: () => open };
}
