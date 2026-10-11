// Cards the player drafted with the ask bar, kept in this browser as { card, signature } so /api/narration can trust them
// on a later visit. This module owns that list: the ask bar remembers a new draft, the policy panel forgets one the
// player discards, and both read the same key — so a discard sticks and a card drafted twice leaves one card, not two.
// The server makes each id unique, so never rename a card here: that would break its signature.
// From William Chen's restore code in meridian-city/index.html (origin/William, 0f80831).
import { validateCard } from '../../shared/schema.js';

// v1 (William's branch) held bare cards, without signatures. v2 could hold the same policy twice, because every reply
// carries a fresh id and nothing in the page compared two drafts or could throw one away; bumping to v3 clears those
// duplicates out of everyone's browser once, and dedupe() plus the library's Discard button keep them from coming back.
const KEY = 'prosperia.playerPolicies.v3';

// Storage is the only copy: no in-memory cache, so a discard in one tab is gone in the next read, here and anywhere else.
function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(e => e?.card && !validateCard(e.card).length) : [];
  } catch (error) {
    console.warn('Could not restore player policies.', error);
    return [];
  }
}

/** False when this browser refused the write, so a caller can say so rather than promise a change that won't last. */
function write(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); return true; }
  catch (error) {
    console.warn('Could not save player policies for the next visit.', error);
    return false;
  }
}

// Two drafts are the same policy when they ask the city for the same thing: same name, and the same levers and zone rules.
// Each reply carries a fresh id, so without this, asking twice for homes near Morrison left two identical cards.
const shapeOf = ({ title, category, levers = [], zoneRules = [] }) => JSON.stringify([
  title.trim().toLowerCase().replace(/\s+/g, ' '), category ?? null,
  levers.map(l => `${l.lever}=${'value' in l ? l.value : `:${l.param}`}@${[...(l.zones ?? [])].sort().join('+')}`).sort(),
  zoneRules.map(r => JSON.stringify(Object.entries(r).sort())).sort(),
]);

// Newest wins: a redraft of the same policy supersedes the one before it.
const dedupe = list => {
  const seen = new Set(), out = [];
  for (const e of [...list].reverse()) {
    const shape = shapeOf(e.card);
    if (seen.has(shape)) continue;
    seen.add(shape);
    out.unshift(e);
  }
  return out;
};

/** Saved cards for the deck, minus ids in `taken` (the catalog's) and minus superseded drafts. */
export function loadPlayerCards(taken = new Set()) {
  const all = read(), keep = dedupe(all.filter(e => !taken.has(e.card.id)));
  if (keep.length !== all.length) write(keep);
  return keep;
}

/**
 * Keeps a fresh draft for later visits. Returns the ids of earlier drafts of the same policy it replaces.
 * @param {Set<string>} [keep] ids never superseded — a card a decade has enacted is in force for good, so a later
 *   draft of the same policy is a new card beside it, not a replacement for it.
 */
export function rememberPlayerCard(entry, keep = new Set()) {
  const before = read().filter(e => e.card.id !== entry.card.id);
  const safe = before.filter(e => keep.has(e.card.id));
  const after = [...safe, ...dedupe([...before.filter(e => !keep.has(e.card.id)), entry])];
  write(after);
  const left = new Set(after.map(e => e.card.id));
  return before.filter(e => !left.has(e.card.id)).map(e => e.card.id);
}

/** Drops a drafted card from this browser for good. False if it wasn't there, or if this browser refused the write. */
export function forgetPlayerCard(id) {
  const before = read(), after = before.filter(e => e.card.id !== id);
  if (after.length === before.length) return false;
  return write(after);
}
