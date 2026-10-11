import { CATEGORIES, POLICIES, SLOTS } from './policies.js';

// Selection state for the policy panel. A selection maps slot id → policy id (or null).
// Scenarios are named selections. The panel edits a working copy of all of them; `draft` is the selection of
// the scenario being edited, `applied` is what the simulation uses. Apply commits the working copy and runs the
// edited scenario; revert throws the working copy away and goes back to the running scenario.
export function createPolicyStore({
  categories = CATEGORIES,
  policies = POLICIES,
  slots = SLOTS,
  scenarioName = 'My Chapel Hill plan',
} = {}) {
  const policyById = new Map(policies.map(p => [p.id, p]));
  const slotById = new Map(slots.map(s => [s.id, s]));
  const emptySelection = () => Object.fromEntries(slots.map(s => [s.id, null]));
  const copy = list => list.map(sc => ({ ...sc, selection: { ...sc.selection } }));
  const same = (a, b) => slots.every(s => a[s.id] === b[s.id]);

  let nextId = 1;
  let saved = [{ id: `scenario-${nextId++}`, name: scenarioName, selection: emptySelection() }];
  let appliedId = saved[0].id;
  let applied = emptySelection();
  let scenarios = copy(saved);
  let currentId = appliedId;
  const listeners = new Set();

  const current = () => scenarios.find(sc => sc.id === currentId);
  const draftOf = () => current().selection;
  const isDirty = () => currentId !== appliedId || !same(draftOf(), applied) ||
    scenarios.length !== saved.length ||
    scenarios.some((sc, i) => sc.id !== saved[i].id || sc.name !== saved[i].name || !same(sc.selection, saved[i].selection));
  const snapshot = () => ({
    scenarioName: current().name,
    scenarioId: currentId,
    appliedScenarioId: appliedId,
    scenarios: scenarios.map(sc => ({
      id: sc.id,
      name: sc.name,
      filled: slots.filter(s => sc.selection[s.id]).length,
      edited: sc.id === currentId,
      running: sc.id === appliedId,
    })),
    applied: { ...applied },
    draft: { ...draftOf() },
    dirty: isDirty(),
  });
  const emit = change => {
    const state = snapshot();
    listeners.forEach(fn => fn(state, change));
    return change;
  };

  const slotOf = (policyId, selection = draftOf()) => slots.find(s => selection[s.id] === policyId)?.id ?? null;
  const retired = new Set(); // enacted in a game (retire): known for their titles, never placed again
  const fits = (policyId, slotId) => !retired.has(policyId) && !!policyById.get(policyId) && policyById.get(policyId).category === slotById.get(slotId)?.category;
  const uniqueName = base => {
    const names = new Set(scenarios.map(sc => sc.name));
    for (let n = scenarios.length + 1; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  };

  return {
    categories,
    policies,
    slots,
    getPolicy: id => policyById.get(id) ?? null,
    getSlot: id => slotById.get(id) ?? null,
    getState: snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    slotOf,
    fits,
    compatibleSlots: policyId => slots.filter(s => fits(policyId, s.id)).map(s => s.id),
    addPolicy(policy) {
      if (policyById.has(policy.id) || !categories.some(c => c.id === policy.category)) return false;
      policyById.set(policy.id, policy);
      policies.push(policy);
      emit({ type: 'addPolicy', policyId: policy.id });
      return true;
    },
    // A drafted policy the player discarded: out of the library and out of every selection. Unlike retire this forgets
    // it entirely — nothing is left to name it — and drafting the same policy again brings it back.
    dropPolicy(id) {
      if (!policyById.delete(id)) return false;
      policies.splice(0, policies.length, ...policies.filter(p => p.id !== id));
      for (const selection of [applied, ...scenarios.map(sc => sc.selection), ...saved.map(sc => sc.selection)])
        for (const s of slots) if (selection[s.id] === id) selection[s.id] = null;
      emit({ type: 'dropPolicy', policyId: id });
      return true;
    },

    // Puts a policy in a slot. A policy already in another slot moves (each policy appears once);
    // whatever was in the target either swaps into the vacated slot or returns to the library.
    place(policyId, slotId) {
      if (!fits(policyId, slotId)) return null;
      const draft = draftOf();
      const from = slotOf(policyId);
      if (from === slotId) return null;
      const displaced = draft[slotId];
      draft[slotId] = policyId;
      if (from) draft[from] = displaced;
      return emit({ type: 'place', policyId, slotId, from, displaced, displacedTo: from && displaced ? from : null });
    },
    remove(slotId) {
      const draft = draftOf();
      const policyId = draft[slotId];
      if (!policyId) return null;
      draft[slotId] = null;
      return emit({ type: 'remove', policyId, slotId });
    },
    clear() {
      if (!slots.some(s => draftOf()[s.id])) return null;
      current().selection = emptySelection();
      return emit({ type: 'clear' });
    },
    apply() {
      saved = copy(scenarios);
      appliedId = currentId;
      applied = { ...draftOf() };
      return emit({ type: 'apply' });
    },
    revert() {
      scenarios = copy(saved);
      currentId = appliedId;
      return emit({ type: 'revert' });
    },
    // A game's turn ended and enacted these policies: they leave the library, and every scenario's slots, for good, and
    // can't be placed again. getPolicy still finds them, for their titles.
    retire(policyIds) {
      const gone = new Set(policyIds);
      if (!gone.size) return null;
      for (const id of gone) retired.add(id);
      policies.splice(0, policies.length, ...policies.filter(p => !gone.has(p.id)));
      for (const selection of [applied, ...scenarios.map(sc => sc.selection), ...saved.map(sc => sc.selection)])
        for (const s of slots) if (gone.has(selection[s.id])) selection[s.id] = null;
      return emit({ type: 'retire', policyIds: [...gone] });
    },

    // Scenarios. These change the working copy, so Apply keeps them and revert undoes them.
    setScenarioName(value) {
      current().name = value;
      return emit({ type: 'rename', scenarioId: currentId });
    },
    renameScenario(id, value) {
      const sc = scenarios.find(s => s.id === id);
      const name = value.trim();
      if (!sc || !name || sc.name === name) return null;
      sc.name = name;
      return emit({ type: 'rename', scenarioId: id });
    },
    selectScenario(id) {
      if (id === currentId || !scenarios.some(sc => sc.id === id)) return null;
      currentId = id;
      return emit({ type: 'select', scenarioId: id });
    },
    // A new, empty scenario, which becomes the one being edited.
    addScenario(name = uniqueName('Scenario')) {
      const sc = { id: `scenario-${nextId++}`, name, selection: emptySelection() };
      scenarios.push(sc);
      currentId = sc.id;
      return emit({ type: 'addScenario', scenarioId: sc.id });
    },
    // The last scenario cannot be deleted. Deleting the edited one moves editing to its neighbour.
    deleteScenario(id) {
      const i = scenarios.findIndex(sc => sc.id === id);
      if (i < 0 || scenarios.length === 1) return null;
      scenarios.splice(i, 1);
      if (currentId === id) currentId = scenarios[Math.min(i, scenarios.length - 1)].id;
      return emit({ type: 'deleteScenario', scenarioId: id, selected: currentId });
    },
  };
}
