// The one simulation clock. City animations, policy steps, predictions, metrics and the year-0 comparison
// all read from it, so pausing or changing speed moves every part of the sim together.
//
// Simulated time is `step + frac`: step is the last complete year whose prediction is on screen, frac how far
// the clock has run into the next one. Speed only changes how fast frac fills, never which steps are shown or
// what they contain, so every speed shows the same state at the same simulated date. Pure: no DOM, no timers.

export const SPEEDS = [1, 2, 4];
const MAX_DT = .25; // real seconds per tick at most: a hitch or a background tab never skips a year

/**
 * @param {object} o
 * @param {number} o.steps the last step (years after the start)
 * @param {(version: number, step: number) => Promise<any>} o.predict resolves one step's snapshot for a scenario version
 * @param {number} [o.yearMs] real milliseconds per simulated year at 1x
 */
export function createClock({ steps, predict, yearMs = 1000 }) {
  let version = 0, step = 0, frac = 0, playing = false, speed = 1, before = false, error = null;
  let shown = null; // what is on screen: { version, step, data, prev, base, tween }
  // Show `step` as soon as its prediction is in: 'show' for the first load or a seek (even while paused),
  // 'resume' to pick up a changed scenario once playing. false while the screen is current.
  let needCommit = 'show';
  const cache = new Map(), inflight = new Set(), listeners = new Set();
  const key = (v, s) => `${v}:${s}`;
  const has = s => cache.has(key(version, s));
  const ready = s => has(s) && has(0) && (s === 0 || has(s - 1));

  function request(s) {
    if (s < 0 || s > steps) return;
    const v = version, k = key(v, s);
    if (cache.has(k) || inflight.has(k)) return; // one request per step and version
    inflight.add(k);
    predict(v, s).then(data => {
      inflight.delete(k);
      if (v !== version) return; // stale: the scenario changed while this was out
      cache.set(k, data);
      arrived();
    }, e => {
      inflight.delete(k);
      if (v !== version) return;
      error = e; playing = false; // hold here; Play retries
      emit();
    });
  }
  const want = s => { request(0); request(s - 1); request(s); request(s + 1); };

  // tween: the step was reached by playing into it, so the city animates the change over the year's first months.
  function commit(s, tween) {
    shown = { version, step: s, data: cache.get(key(version, s)), prev: cache.get(key(version, Math.max(0, s - 1))), base: cache.get(key(version, 0)), tween };
    needCommit = false;
    want(s);
  }
  // A prediction landed. It only changes the screen when the screen is waiting for it: while playing, or while
  // paused for a first load, a seek or a changed scenario.
  function arrived() {
    if (needCommit && ready(step) && (playing || needCommit === 'show')) commit(step, false);
    emit();
  }

  function emit() { const s = get(); listeners.forEach(fn => fn(s)); }
  const holding = () => playing && !needCommit && frac >= 1 && step < steps && !ready(step + 1);
  function get() {
    return {
      steps, step, frac, years: step + Math.min(frac, 1 - 1e-9), playing, speed, before, error, shown,
      loading: !error && (needCommit ? !ready(step) && (playing || needCommit === 'show') : holding()),
      stale: !!shown && shown.version !== version, // a newer forecast is on its way
    };
  }

  // Playback stops. A changed scenario that was waiting to be picked up on the next tick is shown as soon as it lands
  // instead, as it would be had the change come while paused.
  function stop() {
    playing = false;
    if (needCommit === 'resume') { needCommit = 'show'; if (ready(step)) commit(step, false); }
  }

  const clock = {
    get,
    subscribe(fn) { listeners.add(fn); fn(get()); return () => listeners.delete(fn); },

    /** Advances by dt real seconds. Returns how many seconds of animation time passed (0 while paused or holding). */
    tick(dt) {
      if (!playing) return 0;
      if (needCommit) {
        if (!ready(step)) return 0;
        commit(step, false);
      }
      const t0 = step + frac;
      frac += Math.min(Math.max(dt, 0), MAX_DT) * speed * 1000 / yearMs;
      if (frac >= 1) {
        if (step < steps && ready(step + 1)) {
          step++; frac = Math.min(frac - 1, .999); // one year per tick at most, so none is skipped
          commit(step, true);
        } else if (step === steps) { frac = 1; playing = false; } // the end of the forecast, once its last year has played out
        else frac = 1; // hold at the last complete step until the next prediction is in
      }
      emit();
      return (step + frac - t0) * yearMs / 1000;
    },

    play(s = speed) {
      if (!SPEEDS.includes(s)) throw new RangeError(`speed ${s}`);
      speed = s; error = null; before = false;
      // replay from the start once the last year has played out, or after a seek to it; paused during its construction, carry on
      if (!playing && step >= steps && (frac >= 1 || !shown?.tween)) { step = 0; frac = 0; needCommit = 'show'; }
      else if (shown && shown.version !== version) needCommit = 'resume'; // pick up the changed scenario where we are
      playing = true;
      want(step);
      if (needCommit && ready(step)) commit(step, false);
      emit();
    },
    pause() { if (!playing) return; stop(); emit(); },
    toggle() { if (playing) clock.pause(); else clock.play(); },

    /** Jumps to a step and shows it as soon as it is predicted. Pauses: scrubbing is inspection, not playback. */
    seek(s) {
      s = Math.max(0, Math.min(steps, Math.round(s)));
      playing = false; step = s; frac = 0; needCommit = 'show'; before = false;
      want(s);
      if (ready(s)) commit(s, false);
      emit();
    },
    setBefore(b) { before = !!b; if (before && playing) stop(); emit(); },

    /** The scenario's inputs changed, so earlier predictions are stale. Playback holds until the new ones arrive;
     *  paused, the new forecast for the shown year replaces the old one as soon as it lands. */
    invalidate(v = version + 1) {
      version = v; cache.clear(); error = null;
      needCommit = playing ? 'resume' : 'show';
      want(step);
      emit();
    },
  };
  want(0);
  return clock;
}
