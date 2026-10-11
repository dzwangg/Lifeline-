import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// sim/scenario.js runs in the browser. Here: no frames, the data files read from disk, and workers that answer when
// the test says.
globalThis.location = new URL('http://localhost/');
globalThis.requestAnimationFrame = () => 0;
globalThis.fetch = async url => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(url), 'utf8')) });
class FakeWorker {
  static all = [];
  constructor(url) { this.url = String(url); this.jobs = []; FakeWorker.all.push(this); }
  postMessage(job) { this.jobs.push(job); }
}
globalThis.Worker = FakeWorker;
const { simClock } = await import('../meridian-city/sim/scenario.js');
const sim = FakeWorker.all.find(w => w.url.endsWith('/sim-worker.js'));

const until = async (ok, what) => {
  for (let i = 0; i < 300; i++) { if (ok()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail(`timed out waiting for ${what}`);
};
const year = () => ({ zoneStates: {}, metrics: {} });
const run = () => ({ result: { timeline: Array.from({ length: 11 }, year) }, noPolicy: { timeline: Array.from({ length: 11 }, year) }, averages: [], households: { agents: [] } });

test('after a failed run, Play sends the worker a new job and shows its answer', async () => {
  await until(() => sim.jobs.length === 1, 'the baseline job');
  assert.equal(sim.jobs[0].version, 0);
  await sim.onmessage({ data: { version: 0, error: 'the worker ran out of memory' } });
  await until(() => simClock.get().error, 'the clock to report the failure');
  assert.equal(simClock.get().shown, null);

  simClock.play(1); // the retry the clock bar offers
  await until(() => sim.jobs.length === 2, 'a second job');
  assert.equal(sim.jobs[1].version, 0, 'the same scenario, run again');
  await sim.onmessage({ data: { version: 0, run: run(), luti: {} } });
  await until(() => simClock.get().shown, 'the forecast on screen');
  assert.equal(simClock.get().error, null);
  assert.equal(simClock.get().shown.version, 0);
  simClock.pause();
});
