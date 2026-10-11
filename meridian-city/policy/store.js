import { CATEGORIES, POLICIES, SLOTS } from './policies.js';

// Selection state for the policy panel. A selection maps slot id → policy id (or null).
// `draft` is what the panel is editing; `applied` is what the simulation should use.
export function createPolicyStore({
  categories = CATEGORIES,
  policies = POLICIES,
  slots = SLOTS,
  scenarioName = 'My Chapel Hill plan',
} = {}) {
  const policyById = new Map(policies.map(p => [p.id, p]));
  const slotById = new Map(slots.map(s => [s.id, s]));
  const emptySelection = () => Object.fromEntries(slots.map(s => [s.id, null]));

  let applied = emptySelection();
  let draft = emptySelection();
  let name = scenarioName;
  const listeners = new Set();

  const isDirty = () => slots.some(s => draft[s.id] !== applied[s.id]);
  const snapshot = () => ({ scenarioName: name, applied: { ...applied }, draft: { ...draft }, dirty: isDirty() });
  const emit = change => {
    const state = snapshot();
    listeners.forEach(fn => fn(state, change));
    return change;
  };

  const slotOf = (policyId, selection = draft) => slots.find(s => selection[s.id] === policyId)?.id ?? null;
  const fits = (policyId, slotId) => !!policyById.get(policyId) && policyById.get(policyId).category === slotById.get(slotId)?.category;

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

    // Puts a policy in a slot. A policy already in another slot moves (each policy appears once);
    // whatever was in the target either swaps into the vacated slot or returns to the library.
    place(policyId, slotId) {
      if (!fits(policyId, slotId)) return null;
      const from = slotOf(policyId);
      if (from === slotId) return null;
      const displaced = draft[slotId];
      draft[slotId] = policyId;
      if (from) draft[from] = displaced;
      return emit({ type: 'place', policyId, slotId, from, displaced, displacedTo: from && displaced ? from : null });
    },
    remove(slotId) {
      const policyId = draft[slotId];
      if (!policyId) return null;
      draft[slotId] = null;
      return emit({ type: 'remove', policyId, slotId });
    },
    clear() {
      if (!slots.some(s => draft[s.id])) return null;
      draft = emptySelection();
      return emit({ type: 'clear' });
    },
    apply() {
      applied = { ...draft };
      return emit({ type: 'apply' });
    },
    revert() {
      draft = { ...applied };
      return emit({ type: 'revert' });
    },
    setScenarioName(value) {
      name = value;
      return emit({ type: 'rename' });
    },
  };
}
