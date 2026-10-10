import { h, cls, catVars, slotLabel, PolicyCard, PolicySlot, CategoryRow, GlassButton, FilterChip } from './components.js';
import { createDrag, flyFrom } from './drag.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

// Mounts the policy overlay. Returns { open(trigger?), close(), isOpen() }.
export function mountPolicyPanel({ store, host = document.body } = {}) {
  const cats = new Map(store.categories.map(c => [c.id, c]));
  const catOf = policy => cats.get(policy.category);
  // armed: a card picked up by click or keyboard, waiting for a destination. from: its slot, if any.
  const ui = { query: '', filter: 'all', armed: null, dragging: null, open: false, returnFocus: null };

  // ---------- skeleton ----------
  const live = h('div', { class: 'pp-sr', 'aria-live': 'polite' });
  const nameInput = h('textarea', { class: 'pp-scenario__input', id: 'pp-scenario', rows: 1, maxlength: 60, autocomplete: 'off', spellcheck: 'false' });
  const summary = h('div', { class: 'pp-summary' });
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
        h('p', { class: 'pp-sub' }, 'Choose the policies this scenario runs with. Nothing changes in the city until you apply them.')),
      btnClose),
    h('div', { class: 'pp-columns' },
      h('aside', { class: 'pp-col pp-left', 'aria-label': 'Scenario' },
        h('label', { class: 'pp-scenario__label', for: 'pp-scenario' }, 'Scenario'),
        nameInput,
        summary),
      h('section', { class: 'pp-col pp-center', 'aria-labelledby': 'pp-active-title' },
        h('div', { class: 'pp-col__head' },
          h('h3', { class: 'pp-col__title', id: 'pp-active-title' }, 'Active policies')),
        rows),
      library),
    h('footer', { class: 'pp-foot' },
      h('p', { class: 'pp-help', id: 'pp-help' },
        'Drag a card into a matching slot, or select a card and then a slot. Arrow keys move between cards, Delete returns a card, Esc cancels.'),
      h('div', { class: 'pp-actions' }, btnClear, btnCancel, btnApply)),
    live);

  const backdrop = h('div', { class: 'pp-root pp-backdrop', hidden: true }, panel);
  host.append(backdrop);

  // ---------- rendering ----------
  function render() {
    const focusKey = panel.contains(document.activeElement) ? document.activeElement.closest('[data-key]')?.dataset.key : null;
    const s = store.getState();
    renderSummary(s);
    renderRows(s);
    renderLibrary(s);
    if (document.activeElement !== nameInput) nameInput.value = s.scenarioName;
    btnApply.disabled = !s.dirty;
    btnClear.disabled = !store.slots.some(sl => s.draft[sl.id]);
    markTargets();
    if (focusKey) focusByKey(focusKey);
  }

  function renderSummary(s) {
    const filled = store.slots.filter(sl => s.draft[sl.id]).length;
    const anyApplied = store.slots.some(sl => s.applied[sl.id]);
    summary.replaceChildren(
      h('h3', { class: 'pp-col__title' }, 'Selected policies'),
      h('p', { class: 'pp-summary__count' }, h('strong', {}, `${filled} of ${store.slots.length}`), ' slots filled'),
      h('p', { class: cls('pp-status', s.dirty && 'is-dirty') },
        s.dirty ? 'Changes not applied yet' : anyApplied ? 'Matches the applied policies' : 'No policies applied yet'),
      h('ul', { class: 'pp-summary__list' }, store.slots.map(sl => {
        const cat = cats.get(sl.category);
        const now = s.draft[sl.id], was = s.applied[sl.id];
        const change = now === was ? null : !was ? 'Added' : !now ? 'Removed' : 'Changed';
        const shown = store.getPolicy(now ?? (change === 'Removed' ? was : null));
        return h('li', { class: cls('pp-sum', !now && 'is-empty', change === 'Removed' && 'is-removed'), style: catVars(cat) },
          h('span', { class: 'pp-sum__slot' }, slotLabel(sl, cat)),
          h('span', { class: 'pp-sum__title' }, shown ? shown.title : 'Empty'),
          change && h('span', { class: `pp-sum__tag is-${change.toLowerCase()}` }, change));
      })));
  }

  function renderRows(s) {
    rows.replaceChildren(...store.categories.map(cat => CategoryRow(cat,
      store.slots.filter(sl => sl.category === cat.id).map(sl =>
        PolicySlot(sl, cat, store.getPolicy(s.draft[sl.id]), { armed: ui.armed?.from === sl.id })))));
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
        q ? `No policies${where} match “${ui.query.trim()}”. Try another search or show all categories.` : `No policies${where} yet.`));
      return;
    }
    grid.replaceChildren(...list.map(p => {
      const at = Object.keys(s.draft).find(id => s.draft[id] === p.id);
      return PolicyCard(p, catOf(p), {
        place: 'library',
        key: `lib:${p.id}`,
        inUse: at ? `In ${slotLabel(store.getSlot(at), catOf(p))}` : null,
        armed: ui.armed?.policyId === p.id && !ui.armed.from,
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

  // Runs a store change and flies every slotted card that moved (or arrived) into its new place.
  function withFlight(mutate, arrivals = {}) {
    const before = new Map([...rows.querySelectorAll('.pp-card')].map(el => [el.dataset.policy, el.getBoundingClientRect()]));
    const change = mutate();
    if (!change) return null;
    for (const el of rows.querySelectorAll('.pp-card')) flyFrom(el, arrivals[el.dataset.policy] ?? before.get(el.dataset.policy));
    return change;
  }

  // ---------- actions ----------
  function arm(policyId, from, viaKeyboard) {
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
    flyFrom(libCard, source);
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
    const cat = cats.get(store.getSlot(slotId).category);
    announce(`Empty ${nameOfSlot(slotId)} slot. Select a ${cat.label.toLowerCase()} card in the library first.`);
  }

  function activateLibraryCard(policyId, viaKeyboard) {
    if (ui.armed?.policyId === policyId) {
      const key = disarm('Selection cancelled.');
      if (viaKeyboard) focusByKey(key);
      return;
    }
    arm(policyId, store.slotOf(policyId), viaKeyboard);
  }

  function open(trigger) {
    if (ui.open) return;
    ui.open = true;
    ui.returnFocus = trigger ?? document.activeElement;
    Object.assign(ui, { armed: null, query: '', filter: 'all' });
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
    if (reducedMotion()) backdrop.hidden = true;
    else {
      backdrop.classList.add('is-closing');
      const done = e => {
        if (e.target !== backdrop) return;
        backdrop.removeEventListener('animationend', done);
        backdrop.classList.remove('is-closing');
        if (!ui.open) backdrop.hidden = true;
      };
      backdrop.addEventListener('animationend', done);
    }
    ui.returnFocus?.focus?.();
  }

  function cancel() {
    store.revert();
    close();
  }

  // ---------- events ----------
  store.subscribe(() => { if (ui.open) render(); });

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
    const remove = e.target.closest('[data-remove]');
    if (remove) return returnToLibrary(remove.dataset.remove, null, viaKeyboard);
    const chip = e.target.closest('[data-filter]');
    if (chip) { ui.filter = chip.dataset.filter; return render(); }
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
    if (e.key === 'Escape') {
      if (e.target === search && search.value) return; // let the field clear itself first
      e.preventDefault();
      if (ui.armed) return focusByKey(disarm('Selection cancelled.'));
      return cancel();
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
  nameInput.addEventListener('input', () => store.setScenarioName(nameInput.value.replace(/\s*\n\s*/g, ' ')));
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
  nameInput.addEventListener('blur', () => { if (!nameInput.value.trim()) store.setScenarioName('Untitled scenario'); });
  btnClear.addEventListener('click', () => {
    ui.armed = null;
    if (store.clear()) announce('Cleared the selection. Apply to make it take effect, or Cancel to keep the applied policies.');
    btnCancel.focus();
  });
  btnCancel.addEventListener('click', cancel);
  btnClose.addEventListener('click', cancel);
  btnApply.addEventListener('click', () => { store.apply(); close(); });

  return { open, close, isOpen: () => ui.open };
}
