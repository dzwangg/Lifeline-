// A game of turns: three decades, 2026 to 2056. In each, the player applies cards in the policy panel, and can preview,
// adjust and replay the decade as often as they like. Ending the turn enacts those cards: they stay in force for the rest of
// the game, each starting in its own decade (shared/sim.js, shared/luti/levers.js), and leave the library for good. The
// forecast then runs a decade further, and the next turn starts where the last one ended. Decades already played never
// change, because a card enacted later does nothing before its decade.
import { scenario, simClock, DECADE, TURNS, START_YEAR } from './scenario.js';

/** @param {{ store: ReturnType<typeof import('../policy/store.js').createPolicyStore> }} o */
export function createGame({ store }) {
  let turn = 0, over = false;
  const enacted = []; // { id, turn }, in the order they were enacted
  const listeners = new Set();
  // This decade's cards. An enacted card is never planned again, so it can't run twice or move to a later start.
  const planned = () => (over ? [] : Object.values(store.getState().applied).filter(id => id && !enacted.some(e => e.id === id)));
  // from, to: the decade being planned, in years since year 0 (startYear); each enacted card's start likewise
  const get = () => ({ turn, turns: TURNS, over, enacted: enacted.map(e => ({ ...e, start: DECADE * e.turn })), from: DECADE * turn, to: DECADE * (turn + 1), last: turn === TURNS - 1, startYear: START_YEAR });
  const emit = () => { const s = get(); listeners.forEach(fn => fn(s)); };

  return {
    get,
    subscribe(fn) { listeners.add(fn); fn(get()); return () => listeners.delete(fn); },
    /** Every card in the scenario: the enacted ones, then the ones applied for this decade. */
    cardIds: () => [...enacted.map(e => e.id), ...planned()],
    /** card id -> the year it starts, for the cards that don't start in year 0. */
    starts: () => Object.fromEntries([...enacted.map(e => [e.id, DECADE * e.turn]), ...planned().map(id => [id, DECADE * turn])].filter(([, y]) => y)),
    /** Enacts this decade's cards and moves on to the next decade, or ends the game after the last. */
    endTurn() {
      if (over) return;
      const ids = planned();
      enacted.push(...ids.map(id => ({ id, turn })));
      store.retire(ids); // the scenario keeps the same cards and starts: they are enacted now, not planned
      if (turn === TURNS - 1) { over = true; simClock.seek(DECADE * TURNS); } // the final results: the last year
      else {
        turn++;
        scenario.set({ years: DECADE * (turn + 1) });
        simClock.setRange(DECADE * turn, DECADE * (turn + 1));
      }
      emit();
    },
  };
}
