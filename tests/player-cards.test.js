// Cards the player drafted with the ask bar: kept in this browser, deduplicated when the same policy is drafted twice,
// and thrown away for good when the player discards one (meridian-city/policy/player-cards.js, store.dropPolicy).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map(); // the browser's localStorage, enough of it for this module
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};
const KEY = 'prosperia.playerPolicies.v3';
const { loadPlayerCards, rememberPlayerCard, forgetPlayerCard } = await import('../meridian-city/policy/player-cards.js');
const { createPolicyStore } = await import('../meridian-city/policy/store.js');

// A card as /api/policies drafts it: the same ask twice comes back with the same text and a fresh id.
const draft = (id, over = {}) => ({
  id, title: 'Homes near Morrison Hall', summary: 'Builds apartments on the parking around Morrison Hall.',
  category: 'housing', icon: 'house',
  decider: { body: 'Chapel Hill Town Council', how: ['Planning staff draft the change.', 'Town Council votes.'] },
  params: [{ key: 'floor_area', label: 'Allowed floor area', min: 1, max: 4, default: 2.5, step: 0.1, unit: '×' }],
  levers: [{ lever: 'housing.farMultiplier', param: 'floor_area', zones: ['downtown'] }],
  timing: { delayQuarters: 2, phaseInQuarters: 4 },
  tradeoffs: { pros: ['More homes beside the campus.'], cons: ['Less parking there.'] },
  ...over,
});
const entry = (id, over) => ({ card: draft(id, over), signature: `sig-${id}` });
const saved = () => JSON.parse(store.get(KEY) ?? '[]').map(e => e.card.id);

beforeEach(() => store.clear());

test('the same policy drafted twice leaves one card, the newest, in the deck and in storage', () => {
  store.set(KEY, JSON.stringify([entry('morrison-homes-a1'), entry('morrison-homes-b2')]));
  assert.deepEqual(loadPlayerCards().map(e => e.card.id), ['morrison-homes-b2']);
  assert.deepEqual(saved(), ['morrison-homes-b2'], 'the duplicate is gone from this browser too');
});

test('cards that differ in what they ask the city for are both kept', () => {
  store.set(KEY, JSON.stringify([entry('a1'), entry('b2', { title: 'Homes near Granville' }), entry('c3', { levers: [{ lever: 'housing.impactFee', value: 1000 }] })]));
  assert.deepEqual(loadPlayerCards().map(e => e.card.id), ['a1', 'b2', 'c3']);
});

test('a card whose id the catalog now uses is left out of the deck', () => {
  store.set(KEY, JSON.stringify([entry('core-infill')]));
  assert.deepEqual(loadPlayerCards(new Set(['core-infill'])), []);
});

test('remembering a redraft supersedes the draft before it, and says which card to drop', () => {
  store.set(KEY, JSON.stringify([entry('morrison-homes-a1')]));
  assert.deepEqual(rememberPlayerCard(entry('morrison-homes-b2')).map(e => e.card.id), ['morrison-homes-a1']);
  assert.deepEqual(saved(), ['morrison-homes-b2']);
  assert.deepEqual(rememberPlayerCard(entry('granville-c3', { title: 'Homes near Granville' })), [], 'a different policy supersedes nothing');
  assert.deepEqual(saved(), ['morrison-homes-b2', 'granville-c3']);
});

test('discarding a card takes it out of this browser for good', () => {
  store.set(KEY, JSON.stringify([entry('a1'), entry('b2', { title: 'Homes near Granville' })]));
  assert.equal(forgetPlayerCard('a1'), true);
  assert.deepEqual(saved(), ['b2']);
  assert.equal(forgetPlayerCard('a1'), false, 'and discarding it again changes nothing');
});

test('storage this module cannot read leaves the deck empty rather than breaking the page', () => {
  const warn = console.warn, warnings = [];
  console.warn = (...args) => warnings.push(args[0]); // the module says so in the console; the page must still load
  store.set(KEY, 'not json');
  assert.deepEqual(loadPlayerCards(), []);
  console.warn = warn;
  assert.deepEqual(warnings, ['Could not restore player policies.']);
  store.set(KEY, JSON.stringify([{ card: { id: 'broken' } }, entry('a1')]));
  assert.deepEqual(loadPlayerCards().map(e => e.card.id), ['a1'], 'a card that no longer passes the schema is dropped');
});

test('dropPolicy takes a discarded card out of the library and every selection, and lets it come back', () => {
  const panel = { id: 'morrison-homes-a1', title: 'Homes near Morrison Hall', category: 'housing', icon: 'house', summary: 'Apartments by the campus.', drafted: true };
  const s = createPolicyStore({ policies: [] });
  assert.equal(s.addPolicy(panel), true);
  s.place(panel.id, 'housing-1');
  s.apply();
  assert.equal(s.getState().applied['housing-1'], panel.id);

  assert.equal(s.dropPolicy(panel.id), true);
  assert.equal(s.getState().applied['housing-1'], null, 'it stops running');
  assert.equal(s.getState().draft['housing-1'], null, 'and leaves the slot being planned');
  assert.deepEqual(s.policies.map(p => p.id), [], 'and the library');
  assert.equal(s.getPolicy(panel.id), null);
  assert.equal(s.dropPolicy(panel.id), false, 'dropping it twice changes nothing');

  assert.equal(s.addPolicy(panel), true, 'drafting the same policy again brings it back');
  assert.equal(s.fits(panel.id, 'housing-1'), true, 'and it is not retired, so it can be placed');
});

test('a policy a decade enacted is never dropped: it stays in force, and keeps its name', () => {
  const panel = { id: 'morrison-a1', title: 'Homes near Morrison Hall', category: 'housing', icon: 'house', summary: 'x', drafted: true };
  const s = createPolicyStore({ policies: [] });
  s.addPolicy(panel);
  s.place(panel.id, 'housing-1');
  s.apply();
  s.retire([panel.id]); // the decade ends

  assert.equal(s.dropPolicy(panel.id), false, 'the ask bar cannot drop it by drafting the policy again');
  assert.equal(s.getPolicy(panel.id).title, panel.title, 'so the In force list can still name it');
});

test('a redraft never supersedes a draft a decade enacted; the two stand side by side', () => {
  store.set(KEY, JSON.stringify([entry('morrison-a1')]));
  assert.deepEqual(rememberPlayerCard(entry('morrison-b2'), new Set(['morrison-a1'])), [], 'nothing to drop');
  assert.deepEqual(saved(), ['morrison-a1', 'morrison-b2'], 'the enacted draft stays saved beside the new one');
  // and with nothing enacted it supersedes as before
  store.set(KEY, JSON.stringify([entry('morrison-a1')]));
  assert.deepEqual(rememberPlayerCard(entry('morrison-b2')).map(e => e.card.id), ['morrison-a1']);
});

test('the same ask twice is one card however the zones came back ordered', () => {
  const zoned = (id, zones) => entry(id, { levers: [{ lever: 'housing.farMultiplier', param: 'floor_area', zones }] });
  store.set(KEY, JSON.stringify([zoned('a1', ['downtown', 'north']), zoned('b2', ['north', 'downtown'])]));
  assert.deepEqual(loadPlayerCards().map(e => e.card.id), ['b2']);
});

// A drafted card is what it does, not what it is called: the same policy at two settings is two policies.
test('two drafts of one policy at different settings are both kept', () => {
  const bus = (id, dflt) => entry(id, {
    title: 'More frequent buses', category: 'transport', icon: 'bus',
    params: [{ key: 'service', label: 'Bus service', min: 1, max: 3, default: dflt, step: 0.1, unit: '\u00d7' }],
    levers: [{ lever: 'transit.serviceMultiplier', param: 'service' }],
  });
  store.set(KEY, JSON.stringify([bus('buses-2x', 2), bus('buses-3x', 3)]));
  assert.deepEqual(loadPlayerCards().map(e => e.card.id), ['buses-2x', 'buses-3x'], 'running buses twice as often is not running them three times as often');
  // and the same setting twice really is one card
  store.set(KEY, JSON.stringify([bus('buses-a', 2), bus('buses-b', 2)]));
  assert.deepEqual(loadPlayerCards().map(e => e.card.id), ['buses-b']);
});

test('a draft that only differs in when it starts is kept too', () => {
  const slow = (id, delay) => entry(id, { timing: { delayQuarters: delay, phaseInQuarters: 4 } });
  store.set(KEY, JSON.stringify([slow('now', 0), slow('later', 8)]));
  assert.deepEqual(loadPlayerCards().map(e => e.card.id), ['now', 'later']);
});

test('what a redraft replaced comes back whole, so Undo can restore it', () => {
  store.set(KEY, JSON.stringify([entry('morrison-a1')]));
  const [gone] = rememberPlayerCard(entry('morrison-b2'));
  assert.equal(gone.card.id, 'morrison-a1');
  assert.equal(gone.signature, 'sig-morrison-a1', 'the signature too, or narration stops trusting it');
  assert.deepEqual(saved(), ['morrison-b2']);

  // what the ask bar's Undo does: take the redraft back out, then put the old entry back
  forgetPlayerCard('morrison-b2');
  rememberPlayerCard(gone);
  assert.deepEqual(saved(), ['morrison-a1'], 'the library is as it was before the prompt');
});

test('a discard this browser refuses to save says so instead of promising it is gone', () => {
  store.set(KEY, JSON.stringify([entry('a1')]));
  const warn = console.warn;
  console.warn = () => {};
  const setItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(forgetPlayerCard('a1'), false, 'the panel needs to know the change did not stick');
  globalThis.localStorage.setItem = setItem;
  console.warn = warn;
  assert.deepEqual(saved(), ['a1'], 'and it is indeed still there');
});

test('a redraft this browser refuses to save supersedes nothing, so the old card stays in the library', () => {
  store.set(KEY, JSON.stringify([entry('morrison-a1')]));
  const warn = console.warn, setItem = globalThis.localStorage.setItem;
  console.warn = () => {};
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const superseded = rememberPlayerCard(entry('morrison-b2'));
  globalThis.localStorage.setItem = setItem;
  console.warn = warn;
  assert.deepEqual(superseded, [], 'nothing was written, so nothing was replaced');
  assert.deepEqual(saved(), ['morrison-a1'], 'and the old card is still saved, so dropping it would lose it for nothing');
});

test('reverting after a drop does not bring the card back into a slot', () => {
  const panel = { id: 'draft-1', title: 'A drafted card', category: 'housing', icon: 'house', summary: 'Something.', drafted: true };
  const s = createPolicyStore({ policies: [] });
  s.addPolicy(panel);
  s.place(panel.id, 'housing-1');
  s.apply();
  s.dropPolicy(panel.id);
  s.revert();
  assert.equal(s.getState().draft['housing-1'], null);
  assert.equal(s.getState().applied['housing-1'], null);
});
