// The city health score (shared/health.js): the anchors are sound, the arithmetic is what it claims to be, and a run
// scores the way the models say it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, SCORED, anchorsAt, bandOf, basisValue, compareRuns, scoreRun, scoreValue } from '../shared/health.js';
import { INDICATORS } from '../shared/indicators.js';
import { runCombined } from '../shared/combined.js';
import { zones, assumptions, baselines, cards } from './data.js';

const byId = id => cards.find(c => c.id === id);
const none = runCombined([], {}, zones, assumptions, baselines);
const run = (ids, params = {}) => runCombined(ids.map(byId), params, zones, assumptions, baselines, none);

test('every scored indicator is a real metric with usable anchors, in one of the two halves', () => {
  const metrics = none.timeline.at(-1).metrics;
  for (const i of SCORED) {
    assert.ok(i.key in metrics, `${i.key} is a metric the models produce`);
    assert.ok(CATEGORIES.some(c => c.id === i.score.category), `${i.key}: category`);
    assert.ok(['level', 'ratioToStart', 'perYear'].includes(i.score.basis), `${i.key}: basis`);
    assert.notEqual(i.score.target, i.score.floor, `${i.key}: anchors must differ`);
    // the anchors have to agree with the direction the indicator is read in, or the score runs backwards
    const up = i.score.target > i.score.floor;
    assert.equal(up, i.better === 'higher', `${i.key}: target is on the ${i.better} side`);
    assert.ok(i.score.why?.length > 40, `${i.key}: the anchors say why they are where they are`);
  }
  assert.ok(SCORED.length >= 12, 'the score reads most of the panel');
  for (const c of CATEGORIES) assert.ok(SCORED.some(i => i.score.category === c.id), `${c.id} has indicators`);
  // an indicator with no score block is context, and context is never scored by accident
  for (const i of INDICATORS.filter(x => !x.score)) assert.ok(!SCORED.includes(i), i.key);
});

test('a value at the floor scores 0, at the target 100, halfway 50, and past either end is clamped', () => {
  const up = { floor: 0, target: 10 }, down = { floor: 0.75, target: 0.35 };
  assert.equal(scoreValue(0, up), 0);
  assert.equal(scoreValue(10, up), 100);
  assert.equal(scoreValue(5, up), 50);
  assert.equal(scoreValue(-5, up), 0, 'below the floor is still 0');
  assert.equal(scoreValue(99, up), 100, 'past the target is still 100');
  assert.equal(scoreValue(0.75, down), 0, 'lower-is-better reads the same way round');
  assert.equal(scoreValue(0.35, down), 100);
  assert.ok(Math.abs(scoreValue(0.55, down) - 50) < 1e-9, 'halfway between the anchors, give or take floating point');
});

test('each basis reads the metric it says it does', () => {
  const timeline = [{ metrics: { a: 100, b: 10, c: 2 } }, { metrics: { a: 120, b: 15, c: 3 } }];
  const ind = (key, basis) => ({ key, score: { basis } });
  assert.equal(basisValue(ind('a', 'level'), timeline, 1), 120);
  assert.equal(basisValue(ind('a', 'ratioToStart'), timeline, 1), 1.2);
  assert.equal(basisValue(ind('b', 'perYear'), timeline, 1), 5);
  assert.equal(basisValue(ind('c', 'perYear'), timeline, 0), 0, 'year 0 has no per-year change to read');
});

test('the halves are weighted means of their own indicators, and overall is their midpoint', () => {
  const s = scoreRun(none.timeline);
  for (const c of s.categories) {
    const own = s.indicators.filter(i => i.category === c.id);
    const want = own.reduce((t, i) => t + i.score * i.weight, 0) / own.reduce((t, i) => t + i.weight, 0);
    assert.ok(Math.abs(c.score - want) < 0.05, `${c.id}: ${c.score} vs ${want}`);
  }
  assert.ok(Math.abs(s.overall - (s.economic + s.social) / 2) < 0.05, 'overall is the midpoint of the halves');
  assert.ok(s.overall > 0 && s.overall < 100);
  assert.equal(s.band, bandOf(s.overall).label);
});

test('the no-policy baseline scores in the middle, so a policy has room to move it either way', () => {
  const s = scoreRun(none.timeline);
  assert.ok(s.overall > 35 && s.overall < 75, `baseline ${s.overall}: neither already perfect nor already doomed`);
  for (const c of s.categories) assert.ok(c.score > 20 && c.score < 85, `${c.id} ${c.score}`);
  assert.equal(scoreRun(none.timeline, 3).year, 3, 'any year can be scored, not just the last');
});

test('comparing a run with itself is a flat zero; the comparison is per indicator too', () => {
  const c = compareRuns(none.timeline, none.timeline);
  assert.equal(c.overall, 0);
  assert.equal(c.economic, 0);
  assert.equal(c.social, 0);
  assert.ok(Object.values(c.indicators).every(d => d === 0));
  assert.equal(c.baseline.overall, c.policy.overall);
});

test('building homes lifts the economy; releasing the edge of town trades the woods for it', () => {
  const homes = compareRuns(run(['transit-upzoning', 'housing-construction-subsidy']).timeline, none.timeline);
  assert.ok(homes.economic > 1, `homes raise the economy half: ${homes.economic}`);
  assert.ok(homes.indicators.housingUnits > 5, 'the new homes are what does it');

  const sprawl = compareRuns(run(['edge-subdivisions'], { 'edge-subdivisions': { acres_released: 150 } }).timeline, none.timeline);
  assert.ok(sprawl.economic > 0, 'the homes still count for the economy');
  assert.ok(sprawl.indicators.treeCoverPct < -5, `the woods go: ${sprawl.indicators.treeCoverPct}`);
  assert.ok(sprawl.social < 0, `and residents are worse off for it: ${sprawl.social}`);
});

test('a tax cut costs the Town and eases the bill; a tax rise does the reverse', () => {
  const cut = compareRuns(run(['property-tax-adjustment'], { 'property-tax-adjustment': { cents_per_100: -4 } }).timeline, none.timeline);
  assert.ok(cut.indicators.netFiscal < -5, `the Town's money takes the hit: ${cut.indicators.netFiscal}`);
  // a few points at most: the Town sets 50 of the 132.84 cents on a bill, and the anchors span the whole US spread
  assert.ok(cut.indicators.taxBurden > 0.3, `households pay a smaller share of their income: ${cut.indicators.taxBurden}`);
  assert.ok(cut.economic < 0, 'so the economy half falls');

  const rise = compareRuns(run(['property-tax-adjustment'], { 'property-tax-adjustment': { cents_per_100: 4 } }).timeline, none.timeline);
  assert.ok(rise.indicators.netFiscal > 5 && rise.indicators.taxBurden < -0.3, 'and a rise is the mirror of it');
});

test('buses and bike lanes move getting around, and the money to pay for them shows up', () => {
  const c = compareRuns(run(['bus-frequency-boost', 'protected-bike-network']).timeline, none.timeline);
  assert.ok(c.indicators.transitRidership > 5, `more riders: ${c.indicators.transitRidership}`);
  assert.ok(c.social > 0, 'residents get around better');
  assert.ok(c.indicators.netFiscal < 0, 'the service costs the Town something');
});

test('year 0 is not scored: nothing has grown yet and both runs are the same town', () => {
  assert.equal(scoreRun(none.timeline, 0).scored, false);
  assert.equal(compareRuns(none.timeline, none.timeline, 0).scored, false);
  assert.equal(scoreRun(none.timeline, 1).scored, true);
});

test('a growth anchor is a decade\u2019s worth, compounded to the year being scored', () => {
  const jobs = SCORED.find(i => i.key === 'jobs'), full = jobs.score.target;
  assert.ok(Math.abs(anchorsAt(jobs, 10).target - full) < 1e-9, 'at ten years it is the anchor as written');
  assert.ok(Math.abs(anchorsAt(jobs, 5).target - full ** 0.5) < 1e-9, 'at five, half of it compounded');
  const rent = SCORED.find(i => i.key === 'rentBurden');
  assert.equal(anchorsAt(rent, 5).target, rent.score.target, 'a level anchor does not move');
  // without compounding, the baseline would climb year on year just because time passed
  const early = scoreRun(none.timeline, 2).overall, late = scoreRun(none.timeline, 10).overall;
  assert.ok(Math.abs(late - early) < 8, `the no-policy town scores about the same all through: ${early} then ${late}`);
});
