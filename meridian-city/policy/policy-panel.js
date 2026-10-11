import { h, cls, catVars, slotLabel, glyph, PolicyCard, PolicySlot, ScenarioItem, GlassButton, FilterChip } from './components.js';
import { createDrag, flyFrom } from './drag.js';
import { forgetPlayerCard } from './player-cards.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

// Mounts the policy overlay. Returns { open(trigger?), close(), isOpen() }. With a game of turns (sim/turns.js), the panel
// plans the current decade: it lists the policies already in force, and applies nothing once the game is over.
export function mountPolicyPanel({ store, game = null, host = document.body } = {}) {
  const cats = new Map(store.categories.map(c => [c.id, c]));
  const catOf = policy => cats.get(policy.category);
  // armed: a card picked up by click or keyboard, waiting for a destination. from: its slot, if any.
  // target: a slot whose Add policy or Change was chosen; the next fitting library card goes straight into it.
  // scen: a scenario being renamed or confirming its deletion. expanded: slots showing their description.
  // discard: a drafted card asking whether to be thrown away.
  const ui = { query: '', filter: 'all', armed: null, target: null, filterBefore: null, scen: null, discard: null, expanded: new Set(), dragging: null, open: false, returnFocus: null };

  // ---------- skeleton ----------
  const live = h('div', { class: 'pp-sr', 'aria-live': 'polite' });
  const scenList = h('ul', { class: 'pp-scenarios', 'aria-labelledby': 'pp-scen-title' });
  const btnNew = h('button', { class: 'pp-scen-new', type: 'button' }, glyph('plus'), 'New scenario');
  const activeCount = h('span', { class: 'pp-active__count' });
  const activeStatus = h('span', { class: 'pp-active__status' });
  const sub = h('p', { class: 'pp-sub' }, 'Choose the policies this scenario runs with. Nothing changes in the city until you apply them.');
  const inForce = h('section', { class: 'pp-inforce', 'aria-labelledby': 'pp-inforce-title', hidden: true });
  const rows = h('div', { class: 'pp-rows' });
  const search = h('input', { class: 'pp-search__input', type: 'search', placeholder: 'Search policies', 'aria-label': 'Search policies' });
  const chips = h('div', { class: 'pp-chips', role: 'group', 'aria-label': 'Filter by category' });
  const libCount = h('span', { class: 'pp-lib__count' });
  const grid = h('div', { class: 'pp-grid' });
  const btnClear = GlassButton('Clear selection', { variant: 'quiet' });
  const btnCancel = GlassButton('Cancel');
  const btnApply = GlassButton('Apply policies', { variant: 'primary' });
  const btnClose = h('button', { class: 'pp-close', type: 'button', 'aria-label': 'Close without applying' },
    h('span', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>' }));

  const library = h('section', { class: 'pp-col pp-library', 'data-drop': 'library', 'aria-labelledby': 'pp-lib-title' },
    h('div', { class: 'pp-col__head' },
      h('h3', { class: 'pp-col__title', id: 'pp-lib-title' }, 'Policy library'),
      libCount),
    h('label', { class: 'pp-search' },
      h('span', { class: 'pp-search__icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>' }),
      search),
    chips,
    h('p', { class: 'pp-library__return', 'aria-hidden': 'true' }, 'Drop here to return the card'),
    grid);

  const panel = h('section', { class: 'pp-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pp-title', 'aria-describedby': 'pp-help' },
    h('header', { class: 'pp-head' },
      h('div', {},
        h('h2', { class: 'pp-title', id: 'pp-title' }, 'Policies'),
        sub),
      btnClose),
    h('div', { class: 'pp-columns' },
      h('aside', { class: 'pp-col pp-left', 'aria-labelledby': 'pp-scen-title' },
        h('div', { class: 'pp-col__head' },
          h('h3', { class: 'pp-col__title', id: 'pp-scen-title' }, 'Scenarios')),
        scenList,
        btnNew,
        inForce),
      h('section', { class: 'pp-col pp-center', 'aria-labelledby': 'pp-active-title' },
        h('div', { class: 'pp-col__head pp-active__head' },
          h('h3', { class: 'pp-col__title', id: 'pp-active-title' }, 'Active policies'),
          activeCount,
          activeStatus),
        rows),
      library),
    h('footer', { class: 'pp-foot' },
      h('p', { class: 'pp-help', id: 'pp-help' },
        'Drag a card into a matching slot, or choose Add policy and pick from the library. Arrow keys move between cards, Delete removes a policy, Esc cancels.'),
      h('div', { class: 'pp-actions' }, btnClear, btnCancel, btnApply)),
    live);

  const backdrop = h('div', { class: 'pp-root pp-backdrop', hidden: true }, panel);
  host.append(backdrop);

  // ---------- rendering ----------
  function render() {
    const focusKey = panel.contains(document.activeElement) ? document.activeElement.closest('[data-key]')?.dataset.key : null;
    const s = store.getState();
    renderScenarios(s);
    renderGame();
    renderRows(s);
    renderLibrary(s);
    btnApply.disabled = !s.dirty || !!game?.get().over;
    btnClear.disabled = !store.slots.some(sl => s.draft[sl.id]);
    markTargets();
    if (ui.scen?.mode === 'rename') {
      const input = scenList.querySelector('[data-rename-input]');
      if (input && document.activeElement !== input) { input.focus(); input.select(); }
    } else if (focusKey) focusByKey(focusKey);
  }

  function renderScenarios(s) {
    const canDelete = s.scenarios.length > 1;
    scenList.replaceChildren(...s.scenarios.map(sc =>
      ScenarioItem(sc, store.slots.length, { mode: ui.scen?.id === sc.id ? ui.scen.mode : null, canDelete })));
  }

  // The decade being planned, and the policies earlier decades enacted, which stay in force and are gone from the library.
  function renderGame() {
    if (!game) return;
    const g = game.get(), year = y => g.startYear + y;
    sub.textContent = g.over
      ? `The game is over: all ${g.turns} decades are played, and the results panel shows where they left the town.`
      : `Decade ${g.turn + 1} of ${g.turns}: ${year(g.from)}–${year(g.to)}. Choose the policies to try this decade, then apply them. Ending the decade in the results panel enacts them for good.`;
    inForce.hidden = !g.enacted.length;
    inForce.replaceChildren(
      h('h3', { class: 'pp-col__title', id: 'pp-inforce-title' }, 'In force'),
      h('ul', { class: 'pp-inforce__list' }, g.enacted.map(({ id, start }) => {
        const p = store.getPolicy(id), cat = p && catOf(p);
        return h('li', { class: 'pp-inforce__item', style: cat ? catVars(cat) : null },
          h('span', { class: 'pp-inforce__title' }, p?.title ?? id),
          h('span', { class: 'pp-inforce__since' }, `Since ${year(start)}`));
      })));
  }

  function renderRows(s) {
    const filled = store.slots.filter(sl => s.draft[sl.id]).length;
    const anyApplied = store.slots.some(sl => s.applied[sl.id]);
    activeCount.textContent = `${filled} of ${store.slots.length} filled`;
    activeStatus.className = cls('pp-tag', 'pp-active__status', s.dirty ? 'is-pending' : 'is-applied');
    activeStatus.replaceChildren(glyph(s.dirty ? 'pending' : 'check'),
      s.dirty ? 'Changes not applied yet' : anyApplied ? 'Running in the city' : 'Nothing applied yet');
    // Only the running scenario compares against the city; every policy in another scenario is pending.
    const running = s.scenarioId === s.appliedScenarioId;
    rows.replaceChildren(...store.slots.map(sl => {
      const now = s.draft[sl.id], was = running ? s.applied[sl.id] : null;
      return PolicySlot(sl, cats.get(sl.category), store.getPolicy(now), {
        armed: ui.armed?.from === sl.id,
        choosing: ui.target === sl.id,
        status: now ? (now === was ? 'applied' : 'pending') : null,
        removing: !now && was ? store.getPolicy(was) : null,
        expanded: ui.expanded.has(sl.id),
      });
    }));
  }

  function renderLibrary(s) {
    const q = ui.query.trim().toLowerCase();
    const list = store.policies.filter(p =>
      (ui.filter === 'all' || p.category === ui.filter) &&
      (!q || `${p.title} ${p.summary} ${catOf(p).label}`.toLowerCase().includes(q)));
    chips.replaceChildren(
      FilterChip('All', { value: 'all', pressed: ui.filter === 'all' }),
      ...store.categories.map(c => FilterChip(c.label, { value: c.id, category: c, pressed: ui.filter === c.id })));
    libCount.textContent = list.length === store.policies.length ? `${list.length} policies` : `${list.length} of ${store.policies.length} shown`;
    if (!list.length) {
      const where = ui.filter === 'all' ? '' : ` in ${cats.get(ui.filter).label}`;
      grid.replaceChildren(h('p', { class: 'pp-empty' },
        q ? `No policies${where} match “${ui.query.trim()}”. Try another search or show all categories.` : `No policies${where} ${game?.get().enacted.length ? 'left: the rest are in force' : 'yet'}.`));
      return;
    }
    grid.replaceChildren(...list.map(p => {
      const at = Object.keys(s.draft).find(id => s.draft[id] === p.id);
      return PolicyCard(p, catOf(p), {
        place: 'library',
        key: `lib:${p.id}`,
        inUse: at ? `In ${slotLabel(store.getSlot(at), catOf(p))}` : null,
        armed: ui.armed?.policyId === p.id && !ui.armed.from,
        confirming: ui.discard === p.id,
      });
    }));
  }

  // Highlights where the armed or dragged card can go.
  function markTargets() {
    const t = ui.dragging ?? ui.armed;
    backdrop.classList.toggle('is-placing', !!t);
    for (const slot of rows.querySelectorAll('.pp-slot')) {
      slot.classList.toggle('is-valid', !!t && slot.dataset.slot !== t.from && store.fits(t.policyId, slot.dataset.slot));
      slot.classList.toggle('is-source', !!t && slot.dataset.slot === t.from);
    }
    library.classList.toggle('is-valid', !!t?.from);
  }

  // ---------- helpers ----------
  const focusByKey = key => {
    const el = panel.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const announce = msg => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = msg; }); };
  const slotEl = id => rows.querySelector(`.pp-slot[data-slot="${id}"]`);
  const nameOfSlot = id => { const sl = store.getSlot(id); return slotLabel(sl, cats.get(sl.category)); };
  const pulse = (el, className) => {
    if (!el || reducedMotion()) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    el.addEventListener('animationend', () => el.classList.remove(className), { once: true });
  };
  const cardRect = (policyId, from) =>
    (from ? slotEl(from)?.querySelector('.pp-card') : grid.querySelector(`[data-policy="${policyId}"]`))?.getBoundingClientRect() ?? null;

  // A rect the size of `el`, centred on `from`: slot faces are wide and library cards tall, so a flight between
  // them travels without stretching.
  const centred = (from, el) => {
    if (!from || !el) return from;
    const to = el.getBoundingClientRect();
    return new DOMRect(from.left + (from.width - to.width) / 2, from.top + (from.height - to.height) / 2, to.width, to.height);
  };

  // Runs a store change and flies every slotted card that moved (or arrived) into its new place.
  function withFlight(mutate, arrivals = {}) {
    const before = new Map([...rows.querySelectorAll('.pp-card')].map(el => [el.dataset.policy, el.getBoundingClientRect()]));
    const change = mutate();
    if (!change) return null;
    for (const el of rows.querySelectorAll('.pp-card')) flyFrom(el, centred(arrivals[el.dataset.policy] ?? before.get(el.dataset.policy), el));
    return change;
  }

  // Ends Add policy / Change mode without rendering, putting back the library filter it chose.
  function dropTarget() {
    ui.target = null;
    if (ui.filterBefore != null) ui.filter = ui.filterBefore;
    ui.filterBefore = null;
  }

  // ---------- actions ----------
  function arm(policyId, from, viaKeyboard) {
    dropTarget();
    ui.armed = { policyId, from };
    render();
    const p = store.getPolicy(policyId), cat = catOf(p);
    const others = store.compatibleSlots(policyId).filter(id => id !== from);
    if (from) {
      announce(others.length
        ? `Picked up ${p.title}. Choose another ${cat.label} slot, or press Delete to return it to the library.`
        : `Picked up ${p.title}. Press Delete to return it to the library, or Escape to put it back.`);
    } else {
      announce(`${p.title} selected. Choose a ${cat.label} slot to place it.`);
    }
    if (others.length) {
      const target = others.find(id => !store.getState().draft[id]) ?? others[0];
      if (viaKeyboard) focusByKey(`slot:${target}`);
      else slotEl(target)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  function disarm(message) {
    if (!ui.armed) return;
    const { policyId, from } = ui.armed;
    ui.armed = null;
    render();
    if (message) announce(message);
    return from ? `slot:${from}` : `lib:${policyId}`;
  }

  function place(policyId, slotId, fromRect, viaKeyboard) {
    const source = fromRect ?? cardRect(policyId, ui.armed?.policyId === policyId ? ui.armed.from : store.slotOf(policyId));
    ui.armed = null;
    dropTarget();
    const change = withFlight(() => store.place(policyId, slotId), { [policyId]: source });
    if (!change) return render();
    pulse(slotEl(slotId), 'is-landed');
    const p = store.getPolicy(policyId), d = store.getPolicy(change.displaced);
    let msg = change.from ? `Moved ${p.title} to ${nameOfSlot(slotId)}.` : `Placed ${p.title} in ${nameOfSlot(slotId)}.`;
    if (d) msg += change.displacedTo ? ` ${d.title} moved to ${nameOfSlot(change.displacedTo)}.` : ` ${d.title} returned to the library.`;
    announce(msg);
    if (viaKeyboard) focusByKey(`slot:${slotId}`);
  }

  function returnToLibrary(slotId, fromRect, viaKeyboard) {
    const policyId = store.getState().draft[slotId];
    if (!policyId) return;
    const source = fromRect ?? cardRect(policyId, slotId);
    ui.armed = null;
    store.remove(slotId);
    const libCard = grid.querySelector(`[data-policy="${policyId}"]`);
    flyFrom(libCard, centred(source, libCard));
    pulse(libCard, 'is-returned');
    announce(`Returned ${store.getPolicy(policyId).title} to the library.`);
    if (viaKeyboard) focusByKey(`slot:${slotId}`);
  }

  function activateSlot(slotId, viaKeyboard) {
    const occupant = store.getState().draft[slotId];
    const armed = ui.armed;
    if (armed) {
      if (armed.from === slotId) return disarm(`Put ${store.getPolicy(armed.policyId).title} back.`);
      if (store.fits(armed.policyId, slotId)) return place(armed.policyId, slotId, null, viaKeyboard);
      if (!occupant) {
        const p = store.getPolicy(armed.policyId);
        pulse(slotEl(slotId), 'is-refused');
        return announce(`${p.title} only fits ${catOf(p).label} slots.`);
      }
    }
    if (occupant) return arm(occupant, slotId, viaKeyboard);
    choose(slotId, viaKeyboard);
  }

  // Add policy (empty slot) or Change (filled slot): show that slot's category in the library and send the next
  // card chosen there straight into the slot. Choosing the same slot again stops.
  function choose(slotId, viaKeyboard) {
    if (ui.target === slotId) return stopChoosing(viaKeyboard);
    const cat = cats.get(store.getSlot(slotId).category);
    ui.armed = null;
    if (ui.filterBefore == null) ui.filterBefore = ui.filter;
    ui.target = slotId;
    ui.filter = cat.id;
    render();
    announce(`Choose a ${cat.label.toLowerCase()} policy in the library for ${nameOfSlot(slotId)}. Escape stops.`);
    const first = grid.querySelector('.pp-card:not(.is-in-use)') ?? grid.querySelector('.pp-card');
    if (viaKeyboard && first) focusByKey(first.dataset.key);
    else first?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function stopChoosing(viaKeyboard) {
    const slotId = ui.target;
    if (!slotId) return;
    dropTarget();
    render();
    announce('Stopped choosing.');
    if (viaKeyboard) focusByKey(store.getState().draft[slotId] ? `change:${slotId}` : `slot:${slotId}`);
  }

  function activateLibraryCard(policyId, viaKeyboard) {
    if (ui.target && store.fits(policyId, ui.target)) return place(policyId, ui.target, null, viaKeyboard);
    if (ui.armed?.policyId === policyId) {
      const key = disarm('Selection cancelled.');
      if (viaKeyboard) focusByKey(key);
      return;
    }
    arm(policyId, store.slotOf(policyId), viaKeyboard);
  }

  // ---------- scenarios ----------
  const scenarioById = id => store.getState().scenarios.find(sc => sc.id === id);
  const resetEditing = () => { ui.armed = null; ui.scen = null; ui.expanded.clear(); dropTarget(); };

  function selectScenario(id) {
    if (id === store.getState().scenarioId) return;
    resetEditing();
    store.selectScenario(id);
    const sc = scenarioById(id);
    announce(`Editing ${sc.name}: ${sc.filled} of ${store.slots.length} policies.`);
  }

  function newScenario() {
    resetEditing();
    const { scenarioId } = store.addScenario();
    ui.scen = { id: scenarioId, mode: 'rename' };
    render();
    announce(`Added ${scenarioById(scenarioId).name}, with no policies yet. Type a name, then press Enter.`);
  }

  function startRename(id) {
    ui.scen = { id, mode: 'rename' };
    render();
  }

  function finishRename(save, viaKeyboard) {
    const input = scenList.querySelector('[data-rename-input]');
    if (ui.scen?.mode !== 'rename' || !input) return;
    const { id } = ui.scen;
    ui.scen = null;
    const renamed = save && store.renameScenario(id, input.value);
    if (!renamed) render();
    else announce(`Renamed to ${scenarioById(id).name}.`);
    if (viaKeyboard) focusByKey(`scen:${id}`);
  }

  function askDelete(id) {
    ui.scen = { id, mode: 'confirm-delete' };
    render();
    focusByKey(`delete-no:${id}`);
  }

  function confirmDelete(id) {
    const name = scenarioById(id).name;
    resetEditing();
    store.deleteScenario(id);
    const now = store.getState();
    announce(`Deleted ${name}. Editing ${now.scenarioName}. Cancel brings it back.`);
    focusByKey(`scen:${now.scenarioId}`);
  }

  function keepScenario(id) {
    ui.scen = null;
    render();
    focusByKey(`delete:${id}`);
  }

  function open(trigger) {
    if (ui.open) return;
    ui.open = true;
    ui.returnFocus = trigger ?? document.activeElement;
    Object.assign(ui, { armed: null, target: null, filterBefore: null, scen: null, query: '', filter: 'all' });
    ui.expanded.clear();
    search.value = '';
    store.revert(); // reopen on the applied selection
    backdrop.hidden = false;
    backdrop.classList.remove('is-closing');
    render();
    requestAnimationFrame(() => (grid.querySelector('.pp-card') ?? btnClose).focus({ preventScroll: true }));
  }

  function close() {
    if (!ui.open) return;
    ui.open = false;
    drag.abort();
    ui.armed = null;
    ui.discard = null;
    if (reducedMotion()) backdrop.hidden = true;
    else {
      backdrop.classList.add('is-closing');
      const done = e => {
        if (e.target !== backdrop) return;
        backdrop.removeEventListener('animationend', done);
        clearTimeout(timer);
        backdrop.classList.remove('is-closing');
        if (!ui.open) backdrop.hidden = true;
      };
      backdrop.addEventListener('animationend', done);
      // The fade-out normally ends it; if the animation never runs (a busy or throttled page), close anyway.
      const timer = setTimeout(() => done({ target: backdrop }), 400);
    }
    ui.returnFocus?.focus?.();
  }

  // A card the player drafted with the ask bar: out of the library and out of this browser, for good. The simulator's
  // own list of cards follows the store (ask-bar.js), and asking the city for the policy again drafts it anew.
  function discardCard(id) {
    const title = store.getPolicy(id)?.title ?? 'That card';
    ui.discard = null;
    if (ui.armed?.policyId === id) ui.armed = null;
    const saved = forgetPlayerCard(id);
    if (!store.dropPolicy(id)) render();
    announce(saved
      ? `Discarded ${title}. It has left your library.`
      : `Discarded ${title} for now. This browser wouldn’t save the change, so it may come back next visit.`);
    search.focus();
  }
  // The Discard button and its confirmation sit outside the card's own keyboard grid, so they are found by their own
  // attribute rather than by data-key.
  const focusDiscard = (id, attr) => panel.querySelector(`[data-${attr}="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });

  function cancel() {
    store.revert();
    close();
  }

  // ---------- events ----------
  store.subscribe(() => { if (ui.open) render(); });
  game?.subscribe(() => { if (ui.open) render(); });

  const drag = createDrag({
    root: panel,
    handle: '.pp-card',
    scrollers: '.pp-rows, .pp-grid, .pp-columns',
    payloadOf: el => ({ policyId: el.dataset.policy, from: store.slotOf(el.dataset.policy) }),
    canDrop: (d, target) => target.dataset.drop === 'library'
      ? !!d.from
      : target.dataset.slot !== d.from && store.fits(d.policyId, target.dataset.slot),
    onStart: d => { // no re-render here: it would replace the card being dragged
      ui.armed = null;
      ui.dragging = d;
      panel.querySelectorAll('.pp-card.is-armed').forEach(el => el.classList.remove('is-armed'));
      markTargets();
    },
    onEnd: () => { ui.dragging = null; markTargets(); },
    onDrop: (d, target, rect) => target.dataset.drop === 'library'
      ? returnToLibrary(d.from, rect)
      : place(d.policyId, target.dataset.slot, rect),
  });

  panel.addEventListener('click', e => {
    const viaKeyboard = e.detail === 0;
    const disc = e.target.closest('[data-discard], [data-discard-yes], [data-discard-no]');
    if (disc) {
      const d = disc.dataset;
      if (d.discardYes) return discardCard(d.discardYes);
      ui.discard = d.discard ?? null;
      render();
      return focusDiscard(d.discard ?? d.discardNo, d.discard ? 'discard-no' : 'discard');
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) return returnToLibrary(remove.dataset.remove, null, viaKeyboard);
    const change = e.target.closest('[data-change]');
    if (change) return choose(change.dataset.change, viaKeyboard);
    const details = e.target.closest('[data-details]');
    if (details) {
      const id = details.dataset.details;
      if (!ui.expanded.delete(id)) ui.expanded.add(id);
      return render();
    }
    const scen = e.target.closest('[data-scenario], [data-rename], [data-delete], [data-delete-yes], [data-delete-no]');
    if (scen) {
      const d = scen.dataset;
      if (d.scenario) return selectScenario(d.scenario);
      if (d.rename) return startRename(d.rename);
      if (d.delete) return askDelete(d.delete);
      if (d.deleteYes) return confirmDelete(d.deleteYes);
      return keepScenario(d.deleteNo);
    }
    const chip = e.target.closest('[data-filter]');
    if (chip) { ui.filter = chip.dataset.filter; ui.filterBefore = null; return render(); }
    const slot = e.target.closest('.pp-slot');
    if (slot) return activateSlot(slot.dataset.slot, viaKeyboard);
    const card = e.target.closest('.pp-card');
    if (card && library.contains(card)) return activateLibraryCard(card.dataset.policy, viaKeyboard);
    if (ui.armed?.from && library.contains(e.target) && !e.target.closest('input, button, label')) {
      return returnToLibrary(ui.armed.from, null, viaKeyboard);
    }
  });

  panel.addEventListener('keydown', e => {
    if (e.key === 'Tab') return trapTab(e);
    if (e.target.matches?.('[data-rename-input]')) {
      if (e.key === 'Enter') { e.preventDefault(); finishRename(true, true); }
      if (e.key === 'Escape') { e.preventDefault(); finishRename(false, true); }
      return;
    }
    if (e.key === 'Escape') {
      if (e.target === search && search.value) return; // let the field clear itself first
      e.preventDefault();
      if (ui.discard) { const id = ui.discard; ui.discard = null; render(); return focusDiscard(id, 'discard'); }
      if (ui.scen) return keepScenario(ui.scen.id);
      if (ui.target) return stopChoosing(true);
      if (ui.armed) return focusByKey(disarm('Selection cancelled.'));
      return cancel();
    }
    const pick = e.target.closest?.('.pp-scen__pick');
    if (pick && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const picks = [...scenList.querySelectorAll('.pp-scen__pick')];
      picks[picks.indexOf(pick) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
      return;
    }
    const el = e.target.closest?.('.pp-card, .pp-slot__empty');
    if (!el) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const from = el.closest('.pp-slot')?.dataset.slot ?? store.slotOf(el.dataset.policy);
      if (from && store.getState().draft[from]) {
        e.preventDefault();
        returnToLibrary(from, null, !el.closest('.pp-library'));
        if (el.closest('.pp-library')) focusByKey(`lib:${el.dataset.policy}`);
      }
    } else if (ARROWS.includes(e.key)) {
      e.preventDefault();
      moveFocus(el, e.key, el.closest('.pp-grid, .pp-rows'));
    }
  });

  // Spatial arrow-key navigation: the nearest focusable card in the pressed direction.
  function moveFocus(from, dir, zone) {
    const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    const horizontal = dir === 'ArrowLeft' || dir === 'ArrowRight';
    const sign = dir === 'ArrowRight' || dir === 'ArrowDown' ? 1 : -1;
    let best = null, bestScore = Infinity;
    for (const el of zone.querySelectorAll('[data-key]')) {
      if (el === from) continue;
      const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = (horizontal ? dx : dy) * sign, across = Math.abs(horizontal ? dy : dx);
      if (along < 4) continue;
      const score = along + across * 2;
      if (score < bestScore) { best = el; bestScore = score; }
    }
    if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }

  function trapTab(e) {
    const items = [...panel.querySelectorAll('button:not(:disabled), input, textarea, [tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // If focus ever escapes the dialog (e.g. its element was re-rendered), Escape still cancels.
  document.addEventListener('keydown', e => {
    if (ui.open && e.key === 'Escape' && !e.defaultPrevented && !panel.contains(e.target) && !drag.isActive()) cancel();
  });

  search.addEventListener('input', () => { ui.query = search.value; render(); });
  scenList.addEventListener('focusout', e => { if (e.target.matches('[data-rename-input]')) finishRename(true, false); });
  btnNew.addEventListener('click', newScenario);
  btnClear.addEventListener('click', () => {
    ui.armed = null;
    dropTarget();
    if (store.clear()) announce('Cleared the selection. Apply to make it take effect, or Cancel to keep the applied policies.');
    btnCancel.focus();
  });
  btnCancel.addEventListener('click', cancel);
  btnClose.addEventListener('click', cancel);
  btnApply.addEventListener('click', () => { store.apply(); close(); });

  return { open, close, isOpen: () => ui.open };
}
