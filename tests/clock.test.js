import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../meridian-city/sim/clock.js';
import { runScenario } from '../shared/sim.js';
import { stub, zones, assumptions, baselines } from './data.js';

const YEARS = 10, YEAR_MS = 1000;
const flush = () => new Promise(r => setImmediate(r));
// The real model behind a predictor that answers on demand, so tests decide when each prediction lands.
function rig({ auto = true } = {}) {
  const runs = { 0: runScenario([stub], { [stub.id]: { acres_released: 120 } }, zones, assumptions, baselines, YEARS) };
  const calls = [], pending = [];
  const predict = (version, step) => {
    calls.push(`${version}:${step}`);
    return new Promise(resolve => pending.push({ version, step, resolve: () => resolve(runs[version].timeline[step]) }));
  };
  const clock = createClock({ steps: YEARS, predict, yearMs: YEAR_MS });
  const answer = async (filter = () => true) => {
    for (let i = 0; i < pending.length;) if (filter(pending[i])) pending.splice(i, 1)[0].resolve(); else i++;
    await flush();
  };
  const settle = async () => { for (let i = 0; i < 20 && pending.length; i++) await answer(); };
  return { clock, calls, pending, answer, settle, runs, auto };
}
// Plays in frames of `dt` real seconds, answering predictions as they are asked for; records each frame's state.
async function playTo(r, speed, dt, years) {
  r.clock.play(speed);
  const seen = [r.clock.get()];
  while (r.clock.get().years < years && r.clock.get().playing) {
    await r.settle();
    r.clock.tick(dt);
    seen.push(r.clock.get());
  }
  return seen;
}

test('starts paused at year 0 and shows it once predicted', async () => {
  const r = rig();
  assert.equal(r.clock.get().playing, false);
  assert.equal(r.clock.get().loading, true);
  await r.settle();
  const s = r.clock.get();
  assert.equal(s.step, 0);
  assert.equal(s.loading, false);
  assert.deepEqual(s.shown.data, r.runs[0].timeline[0]);
});

test('pausing freezes time and the shown state; resuming continues from there', async () => {
  const r = rig();
  await playTo(r, 1, 1 / 60, 2.5);
  r.clock.pause();
  const frozen = r.clock.get();
  for (let i = 0; i < 300; i++) assert.equal(r.clock.tick(1 / 60), 0);
  await r.settle();
  const after = r.clock.get();
  assert.equal(after.years, frozen.years);
  assert.equal(after.shown, frozen.shown);
  r.clock.play();
  r.clock.tick(1 / 60);
  assert.ok(r.clock.get().years > frozen.years && r.clock.get().years - frozen.years < .02);
  assert.equal(r.clock.get().step, 2);
});

test('every speed shows the same state at the same simulated date, and no year is skipped', async () => {
  const at = {};
  for (const [speed, dt] of [[1, 1 / 60], [2, 1 / 30], [4, 1 / 60], [4, .1], [4, 3]]) { // dt 3 s: a background tab
    const r = rig();
    await r.settle();
    const seen = await playTo(r, speed, dt, YEARS);
    const steps = [...new Set(seen.map(s => s.step))];
    assert.deepEqual(steps, Array.from({ length: YEARS + 1 }, (_, i) => i), `speed ${speed}, dt ${dt}`);
    for (const s of seen) { // the state on screen is a function of the date alone
      assert.equal(s.shown.step, Math.floor(s.years));
      assert.deepEqual(s.shown.data, r.runs[0].timeline[s.shown.step]);
    }
    at[`${speed}/${dt}`] = seen.at(-1).shown.data;
    assert.equal(r.clock.get().playing, false, 'stops at the end');
  }
  const [first, ...rest] = Object.values(at);
  for (const v of rest) assert.deepEqual(v, first);
});

test('speed changes timing only: 4x reaches a date in a quarter of the real time', async () => {
  const time = async speed => {
    const r = rig(); await r.settle();
    let t = 0;
    r.clock.play(speed);
    while (r.clock.get().years < 3) { await r.settle(); r.clock.tick(1 / 100); t += 1 / 100; }
    return t;
  };
  const [t1, t4] = [await time(1), await time(4)];
  assert.ok(Math.abs(t1 / t4 - 4) < .1, `${t1} vs ${t4}`);
});

test('holds at the last complete step while a prediction loads, without duplicate requests', async () => {
  const r = rig();
  await r.settle();
  r.clock.play(4);
  await r.answer(p => p.step <= 1);
  for (let i = 0; i < 200; i++) r.clock.tick(1 / 60); // far past year 2, but year 2 is not predicted yet
  let s = r.clock.get();
  assert.equal(s.step, 1);
  assert.equal(s.loading, true);
  assert.ok(s.years < 2);
  assert.equal(new Set(r.calls).size, r.calls.length, 'no step asked for twice');
  await r.settle();
  r.clock.tick(1 / 60);
  s = r.clock.get();
  assert.equal(s.step, 2);
  assert.equal(s.loading, false);
});

test('a prediction landing while paused waits for Play', async () => {
  const r = rig();
  await r.settle();
  r.clock.play(1);
  for (let i = 0; i < 200; i++) { await r.answer(p => p.step <= 1); r.clock.tick(1 / 60); } // holding before year 2
  r.clock.pause();
  await r.settle(); // year 2 arrives while paused
  for (let i = 0; i < 10; i++) r.clock.tick(1 / 60);
  assert.equal(r.clock.get().step, 1);
  r.clock.play();
  r.clock.tick(1 / 60);
  assert.equal(r.clock.get().step, 2);
});

test('answers for an older scenario are dropped, and the new one shows on Play', async () => {
  const r = rig();
  await r.settle();
  await playTo(r, 2, 1 / 60, 3.2);
  r.clock.pause();
  r.runs[1] = runScenario([], {}, zones, assumptions, baselines, YEARS);
  r.clock.invalidate(1);
  await r.answer(p => p.version === 0); // late answers for version 0
  await r.settle();
  assert.equal(r.clock.get().shown.version, 0, 'paused: the changed forecast waits');
  assert.equal(r.clock.get().stale, true);
  r.clock.play();
  assert.equal(r.clock.get().shown.version, 1);
  assert.deepEqual(r.clock.get().shown.data, r.runs[1].timeline[3]);
});

test('seek shows a year at once while paused; Play at the end starts over', async () => {
  const r = rig();
  await r.settle();
  r.clock.seek(7);
  await r.settle();
  assert.equal(r.clock.get().shown.step, 7);
  assert.equal(r.clock.get().playing, false);
  r.clock.seek(10);
  await r.settle();
  r.clock.play(2);
  await r.settle();
  assert.equal(r.clock.get().step, 0);
  assert.equal(r.clock.get().playing, true);
});
