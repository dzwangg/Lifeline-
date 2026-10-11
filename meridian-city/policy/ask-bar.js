// "Ask the city": a prompt bar over the map. Whatever the player types goes to /api/ask, and whatever comes back is applied
// to the live scenario at once: a drafted policy card joins the deck and its category's slot, new slider values go to the
// applied cards, and what-ifs (inflation and the rest) go to the scenario's drivers. A refusal says why and what to try.
// Every change can be undone. Drafted cards are kept in this browser (player-cards.js), signed, for later visits.
import { h, cls } from './components.js';
import { validateCard } from '../../shared/schema.js';
import { LEVERS } from '../../shared/luti/levers.js';
import { describeDrivers } from '../../shared/luti/drivers.js';
import { scenario } from '../sim/scenario.js';
import { loadPlayerCards, savePlayerCards } from './player-cards.js';

const EXAMPLES = [
  'Run buses twice as often on the MLK corridor',
  'Require 15% affordable homes in new apartment buildings',
  'What if inflation is 6% a year?',
  'Speed up permit approvals by six months',
  'Unlock Durham',
];
const STATES = { forest: 'woods', parking: 'parking lots', low_res: 'houses', mid_res: 'apartments', mixed_use: 'shops with homes above', transit_station: 'a transit station' };
const panelPolicy = c => ({ id: c.id, title: c.title, category: c.category ?? 'housing', icon: c.icon ?? 'house', summary: c.summary });

export function mountAskBar({ store, cards, host = document.body }) {
  // cards drafted on an earlier visit join the deck (not applied)
  let saved = loadPlayerCards(new Set(cards.map(c => c.id)));
  for (const { card } of saved) addCard(card);

  const input = h('input', { class: 'ask__input', type: 'text', maxlength: 1000, autocomplete: 'off', spellcheck: 'true',
    placeholder: 'Ask the city: a policy, a what-if, or a question…', 'aria-label': 'Ask the city' });
  const send = h('button', { class: 'tool-btn ask__send', type: 'submit', 'aria-label': 'Send',
    html: '<svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="M1 1h1v1h1v1h1v1h1v1H4v1H3v1H2v1H1zM5 4h3v1H5z"/></svg>' });
  const out = h('div', { class: 'ask__out', role: 'status', 'aria-live': 'polite', hidden: true });
  const form = h('form', { class: 'plate ask', 'aria-label': 'Ask the city' }, out, h('div', { class: 'ask__row' }, input, send));
  host.append(form);
  let busy = false, undo = null;
  placeBar(form);

  input.addEventListener('focus', () => { if (out.hidden && !input.value) showExamples(); });
  form.addEventListener('submit', e => { e.preventDefault(); submit(input.value); });
  addEventListener('keydown', e => { // "/" jumps to the bar, as in many games' chat
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable], [role="dialog"]')) return;
    e.preventDefault(); input.focus();
  });

  function showExamples() {
    show('ask__out--hint', h('p', { class: 'ask__lede' }, 'Type anything. Gemini turns it into a policy, a what-if or an answer, and the city reruns.'),
      h('div', { class: 'ask__chips' }, EXAMPLES.map(t => h('button', { class: 'ask__chip', type: 'button', onclick: () => { input.value = t; submit(t); } }, t))));
  }
  function show(kind, ...children) {
    out.className = cls('ask__out', kind);
    out.replaceChildren(h('button', { class: 'ask__close', type: 'button', 'aria-label': 'Close', onclick: () => { out.hidden = true; } }, '×'),
      ...children.flat().filter(c => c != null && c !== false));
    out.hidden = false;
  }

  async function submit(text) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    busy = true; form.classList.add('is-busy'); send.disabled = true;
    show('ask__out--busy', h('p', { class: 'ask__lede' }, h('span', { class: 'ask__spinner', 'aria-hidden': 'true' }), 'Reading your prompt…'));
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, active: activeCards(), drivers: scenario.get().drivers }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return show('ask__out--error', h('p', { class: 'ask__lede' }, body.error ?? `The city couldn’t answer (HTTP ${res.status}).`),
        res.status === 404 && h('p', { class: 'ask__note' }, 'This server has no /api/ask. Run the game with npm run dev (or on Vercel) to ask the city.'));
      apply(body, prompt);
      input.value = '';
    } catch {
      show('ask__out--error', h('p', { class: 'ask__lede' }, 'The city couldn’t be reached. Check the connection and try again.'));
    } finally {
      busy = false; form.classList.remove('is-busy'); send.disabled = false;
    }
  }

  // ---------- applying an answer ----------
  function apply(r, prompt) {
    const before = { applied: { ...store.getState().applied }, params: scenario.get().params, drivers: scenario.get().drivers };
    const done = [];
    if (r.kind === 'refuse') {
      return show('ask__out--refuse', h('p', { class: 'ask__kicker' }, 'Can’t simulate that'), h('p', { class: 'ask__lede' }, r.refusal?.reason ?? r.reply),
        r.refusal?.alternative && h('p', { class: 'ask__note' }, r.refusal.alternative), notesOf(r));
    }
    if (r.card) {
      const errors = validateCard(r.card);
      if (errors.length) return show('ask__out--error', h('p', { class: 'ask__lede' }, 'The drafted card didn’t pass the checks, so nothing changed.'));
      addCard(r.card);
      saved = [...saved.filter(e => e.card.id !== r.card.id), { card: r.card, signature: r.signature ?? null }];
      savePlayerCards(saved);
      const placed = place(r.card);
      done.push(h('div', { class: 'ask__card' },
        h('p', { class: 'ask__kicker' }, placed ? appliedIn('Applied in', placed) : 'Added to your library; no slot could take it'),
        h('strong', {}, r.card.title), h('p', { class: 'ask__note' }, r.card.summary),
        h('ul', { class: 'ask__list' }, modeledAs(r.card).map(t => h('li', {}, t)))));
    }
    const libraryCard = r.library && cards.find(c => c.id === r.library);
    let library = null;
    if (libraryCard) { // the same as a library card: that card goes in, not a copy, at its default settings as the answer says
      const params = { ...scenario.get().params };
      delete params[libraryCard.id];
      const placed = place(libraryCard, () => scenario.set({ params }));
      if (placed) library = libraryCard;
      done.push(h('div', { class: 'ask__card' },
        h('p', { class: 'ask__kicker' }, placed ? appliedIn('From the library, applied in', placed) : 'Already enacted, so nothing changed'),
        h('strong', {}, libraryCard.title),
        h('p', { class: 'ask__note' }, placed ? libraryCard.summary : 'It was enacted in an earlier decade and stays in force; it can’t be applied again.')));
    }
    if (r.adjust?.length) {
      const params = structuredClone(scenario.get().params);
      for (const a of r.adjust) (params[a.cardId] ??= {})[a.param] = a.value;
      scenario.set({ params });
      done.push(h('ul', { class: 'ask__list' }, r.adjust.map(a => {
        const c = cards.find(x => x.id === a.cardId), p = c?.params.find(x => x.key === a.param);
        return h('li', {}, `${c?.title ?? a.cardId}: ${p?.label ?? a.param} set to ${a.value}${p?.unit ? ` ${p.unit}` : ''}`);
      })));
    }
    if (r.drivers) {
      const drivers = r.reset ? {} : { ...scenario.get().drivers, ...r.drivers };
      scenario.set({ drivers });
      const words = describeDrivers(drivers);
      done.push(h('p', { class: 'ask__note' }, words.length ? `What-ifs now: ${words.join('; ')}.` : 'No what-ifs are set.'));
    }
    const changed = r.card || library || r.adjust?.length || r.drivers;
    if (changed) undo = () => { // the last change stays undoable until another one replaces it
      store.clear();
      for (const [slot, id] of Object.entries(before.applied)) if (id) store.place(id, slot);
      store.apply();
      scenario.set({ params: before.params, drivers: before.drivers });
      show('ask__out--plain', h('p', { class: 'ask__lede' }, 'Undone. The city is back to how it was before that prompt.'));
      undo = null;
    };
    show(r.kind === 'question' ? 'ask__out--plain' : 'ask__out--done',
      h('p', { class: 'ask__you' }, `“${prompt}”`),
      h('p', { class: 'ask__lede' }, r.reply),
      ...done,
      r.unmodeled?.length > 0 && h('p', { class: 'ask__note' }, `Not modeled: ${r.unmodeled.join('; ')}.`),
      notesOf(r),
      changed && h('div', { class: 'ask__actions' }, h('button', { class: 'ask__chip', type: 'button', onclick: () => undo?.() }, 'Undo')));
  }
  const notesOf = r => (r.notes?.length ? h('ul', { class: 'ask__list ask__list--notes' }, r.notes.map(n => h('li', {}, n))) : null);

  // A drafted card joins the sim's cards and the policy panel's deck.
  function addCard(card) {
    if (!cards.some(c => c.id === card.id)) cards.push(card);
    store.addPolicy(panelPolicy(card));
  }
  // Into the first empty slot that takes it, or the first such slot (whose card goes back to the deck), then applied; a card
  // already applied stays where it is. null when no slot takes it (a card enacted in an earlier decade): nothing changes.
  // before: runs only once the card is sure to go in.
  function place(card, before = () => {}) {
    store.revert(); // act on what is applied, not on an unapplied draft in the panel
    const name = slot => { const cat = store.categories.find(c => c.id === slot.category); return `${cat?.label ?? slot.category}${cat?.slots > 1 ? ` ${slot.index + 1}` : ''}`; };
    const at = store.slotOf(card.id);
    if (at) { before(); store.apply(); return { slot: name(store.getSlot(at)), replaced: null }; }
    const slots = store.slots.filter(s => store.fits(card.id, s.id)), draft = store.getState().draft;
    if (!slots.length) return null;
    const slot = slots.find(s => !draft[s.id]) ?? slots[0], replaced = draft[slot.id];
    before();
    if (!store.place(card.id, slot.id)) return null;
    store.apply();
    return { slot: name(slot), replaced };
  }
  const appliedIn = (what, { slot, replaced }) => `${what} ${slot}${replaced ? `, replacing ${store.getPolicy(replaced)?.title ?? replaced}` : ''}`;
  function activeCards() {
    const { params } = scenario.get();
    return Object.values(store.getState().applied).filter(Boolean).map(id => cards.find(c => c.id === id)).filter(Boolean).map(c => ({
      id: c.id, title: c.title, params: c.params.map(p => ({ key: p.key, label: p.label, min: p.min, max: p.max, unit: p.unit, value: params[c.id]?.[p.key] ?? p.default })),
    }));
  }
}

// Where the bar goes: beside the info plate (#hud, bottom left) when the room between it and the results dashboard is wide
// enough, else just above the info plate, left of the dashboard where the dashboard reaches down that far. The info plate's
// width follows the building picked on the map, so both are measured, not assumed, and measured again when either changes
// size (the dashboard also hides, expands and mounts after the bar).
const GAP = 12, EDGE = 16, MIN_WIDTH = 420;
function placeBar(form) {
  const fit = () => {
    const W = innerWidth, H = innerHeight, hud = document.getElementById('hud')?.getBoundingClientRect();
    const plate = document.querySelector('.plate.sim'), sim = plate && !plate.classList.contains('is-expanded') ? plate.getBoundingClientRect() : null;
    const hasHud = hud && hud.width > 0, top = hasHud ? hud.top : H - EDGE;
    const rightOf = y => (sim?.width && sim.bottom > y ? W - sim.left + GAP : EDGE); // the dashboard beside a bar whose top is at y
    const besideLeft = hasHud ? hud.right + GAP : EDGE, besideBottom = hasHud ? H - hud.bottom : EDGE;
    const besideRight = rightOf(top);
    if (W - besideLeft - besideRight >= MIN_WIDTH) return set(besideLeft, besideRight, besideBottom);
    const bottom = hasHud ? H - hud.top + GAP : EDGE, left = hasHud ? hud.left : EDGE;
    const right = rightOf(H - bottom - form.offsetHeight);
    set(left, W - left - right >= 280 ? right : left, bottom);
  };
  const set = (left, right, bottom) => Object.assign(form.style, { left: `${Math.round(left)}px`, right: `${Math.round(right)}px`, bottom: `${Math.round(bottom)}px` });
  const sizes = new ResizeObserver(() => fit()), seen = new Set();
  const watch = () => {
    for (const el of [document.getElementById('hud'), document.querySelector('.plate.sim')]) if (el && !seen.has(el)) { seen.add(el); sizes.observe(el); }
    fit();
  };
  new MutationObserver(watch).observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', fit);
  watch();
}

// What a card changes in the simulator, in plain words.
function modeledAs(card) {
  const value = l => (l.param ? card.params.find(p => p.key === l.param)?.default : l.value);
  const zones = l => (l.zones?.length ? ` (${l.zones.join(', ')})` : '');
  const amount = (v, unit = '') => (unit.startsWith('$') ? `$${Number(v).toLocaleString()}${unit.slice(1)}` : `${Number(v).toLocaleString()} ${unit}`.trim());
  const lines = (card.levers ?? []).map(l => `${LEVERS[l.lever]?.label ?? l.lever}: ${amount(value(l), LEVERS[l.lever]?.unit)}${zones(l)}`);
  for (const r of card.zoneRules ?? []) lines.push('protect' in r
    ? `Keeps ${STATES[r.protect] ?? r.protect} (${r.where.replace(/^tag:/, '')}) as they are`
    : `Turns ${STATES[r.from] ?? r.from} (${r.where.replace(/^tag:/, '')}) into ${STATES[r.to] ?? r.to}, ${Math.round(r.ratePerYear * 100)}% a year`);
  if (card.timing) lines.push(`Starts after ${card.timing.delayQuarters} quarter${card.timing.delayQuarters === 1 ? '' : 's'}, full after ${card.timing.delayQuarters + card.timing.phaseInQuarters}`);
  return lines;
}
