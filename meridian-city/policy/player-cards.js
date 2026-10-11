// Player cards from /api/policies/generate, kept in this browser as { card, signature } so /api/narration can trust them on a
// later visit. Not wired in yet: on load, push loadPlayerCards()' cards into the page's cards and the store (store.addPolicy);
// after a draft, savePlayerCards([...entries, reply]); send the entries in use as narration's body.cards.
// The server makes each id unique, so never rename a card here: that would break its signature.
// From William Chen's restore code in meridian-city/index.html (origin/William, 0f80831).
import { validateCard } from '../../shared/schema.js';

const KEY = 'prosperia.playerPolicies.v2'; // v1 (William's branch) held bare cards, without signatures

/** Saved entries whose card still validates, minus ids in `taken` (the catalog's). */
export function loadPlayerCards(taken = new Set()) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(e => e?.card && !validateCard(e.card).length && !taken.has(e.card.id)) : [];
  } catch (error) {
    console.warn('Could not restore player policies.', error);
    return [];
  }
}

export function savePlayerCards(entries) {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); }
  catch (error) { console.warn('Could not save player policies for the next visit.', error); }
}
