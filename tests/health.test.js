// The city health score (shared/health.js): 50 is the town that did nothing, the arithmetic is what it claims to be,
// and a run moves the way the models say it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, SCORED, bandOf, basisValue, moodOf, scoreAgainst, summarise } from '../shared/health.js';
import { INDICATORS } from '../shared/indicators.js';
import { runCombined } from '../shared/combined.js';
import { zones, assumptions, baselines, cards } from './data.js';

const byId = id => cards.find(c => c.id === id);
const none = runCombined([], {}, zones, assumptions, baselines);
const run = (ids, params = {}) => runCombined(ids.map(byId), params, zones, assumptions, baselines, none);
const score = (ids, params) => scoreAgainst(run(ids, params).timeline, none.timeline);
const at = (s, key) => s.indicators.find(i => i.key === key);

test('every scored indicator is a real metric with a swing, anchors and a half to belong to', () => {
  const metrics = none.timeline.at(-1).metrics;
  for (const i of SCORED) {
    assert.ok(i.key in metrics, `${i.key} is a metric the models produce`);
    assert.ok(CATEGORIES.some(c => c.id === i.score.category), `${i.key}: category`);
    assert.ok(['level', 'ratioToStart', 'perYear'].includes(i.score.basis), `${i.key}: basis`);
    assert.ok(i.score.swing > 0, `${i.key}: a swing the score is built on`);
    assert.notEqual(i.score.target, i.score.floor, `${i.key}: the context anchors differ`);
    // the anchors have to agree with the direction the indicator is read in, or the context reads backwards
    assert.equal(i.score.target > i.score.floor, i.better === 'higher', `${i.key}: target is on the ${i.better} side`);
    assert.ok(i.score.why?.length > 40, `${i.key}: says where its anchors come from`);
  }
  assert.ok(SCORED.length >= 12, 'the score reads most of the panel');
  for (const c of CATEGORIES) assert.ok(SCORED.some(i => i.score.category === c.id), `${c.id} has indicators`);
  for (const i of INDICATORS.filter(x => !x.score)) assert.ok(!SCORED.includes(i), `${i.key} is context and stays unscored`);
});

test('doing nothing scores exactly 50, on every indicator and both halves', () => {
  const s = scoreAgainst(none.timeline, none.timeline);
  assert.equal(s.overall, 50);
  assert.equal(s.economic, 50);
  assert.equal(s.social, 50);
  for (const i of s.indicators) assert.equal(i.score, 50, i.key);
  assert.equal(s.band, 'About the same');
  assert.equal(s.mood, 'About as before');
  for (const c of s.categories) assert.equal(c.summary, 'Nothing moved much either way.');
});

test('an indicator moves 50 points for a full swing, and is clamped past it', () => {
  const line = v => [{ metrics: { treeCoverPct: 46.9 } }, { metrics: { treeCoverPct: v } }];
  const treeAt = v => scoreAgainst(line(v), line(46.9)).indicators.find(i => i.key === 'treeCoverPct').score;
  const swing = SCORED.find(i => i.key === 'treeCoverPct').score.swing;
  assert.equal(treeAt(46.9), 50, 'no change is 50');
  assert.equal(treeAt(46.9 + swing), 100, 'a full swing better is 100');
  assert.equal(treeAt(46.9 - swing), 0, 'a full swing worse is 0');
  assert.equal(treeAt(46.9 + swing / 2), 75, 'half a swing is half the distance');
  assert.equal(treeAt(46.9 + swing * 9), 100, 'past a full swing is still 100, so one indicator cannot carry the score');
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
  const s = score(['transit-upzoning', 'housing-construction-subsidy']);
  for (const c of s.categories) {
    const own = s.indicators.filter(i => i.category === c.id);
    const want = 50 + 50 * (own.reduce((t, i) => t + i.move * i.weight, 0) / own.reduce((t, i) => t + i.weight, 0));
    assert.ok(Math.abs(c.score - want) < 0.05, `${c.id}: ${c.score} vs ${want}`);
  }
  assert.ok(Math.abs(s.overall - (s.economic + s.social) / 2) < 0.05, 'overall is the midpoint of the halves');
  assert.equal(s.band, bandOf(s.overall));
  assert.equal(s.mood, moodOf(s.social));
});

test('year 0 is not scored: nothing has grown and both runs are the same town', () => {
  assert.equal(scoreAgainst(none.timeline, none.timeline, 0).scored, false);
  assert.equal(scoreAgainst(none.timeline, none.timeline, 1).scored, true);
});

test('a policy package moves the score well clear of 50, in the half it acts on', () => {
  const homes = score(['transit-upzoning', 'housing-construction-subsidy']);
  assert.ok(homes.economic > 60, `homes lift the economy half: ${homes.economic}`);
  assert.ok(homes.overall > 55, `and the score with it: ${homes.overall}`);

  const everything = score(['transit-upzoning', 'housing-construction-subsidy', 'bus-frequency-boost', 'protected-bike-network', 'small-business-support-grant']);
  assert.ok(everything.overall > 65, `a full package is clearly better: ${everything.overall}`);
  assert.equal(everything.band, 'Better');
});

test('releasing the edge of town trades the economy against the people who live here', () => {
  const sprawl = score(['edge-subdivisions'], { 'edge-subdivisions': { acres_released: 150 } });
  assert.ok(sprawl.economic > 55, `the homes count for the economy: ${sprawl.economic}`);
  assert.ok(sprawl.social < 48, `the woods going counts against residents: ${sprawl.social}`);
  assert.equal(at(sprawl, 'treeCoverPct').score, 0, 'tree cover takes the full hit');
});

test('a tax cut eases the bill and costs the Town; a rise does the reverse', () => {
  const cut = score(['property-tax-adjustment'], { 'property-tax-adjustment': { cents_per_100: -8 } });
  assert.ok(at(cut, 'taxBurden').score > 60, 'households pay a smaller share');
  assert.ok(at(cut, 'netFiscal').score < 20, "the Town's money takes the hit");
  assert.ok(cut.economic > 50 && cut.social < 45, 'cheaper to live in, paid for out of the Town');

  const rise = score(['property-tax-adjustment'], { 'property-tax-adjustment': { cents_per_100: 8 } });
  assert.ok(at(rise, 'taxBurden').score < 40, 'and a rise is the mirror of it');
  assert.match(rise.categories.find(c => c.id === 'social').summary, /tax burden/, 'the summary names the bill');
});

// The library carries policies that make the town worse on purpose, so a player can lose. Each is tempting for a real
// reason — revenue, scrutiny, affordability, free parking — and each costs more than it brings in.
test('the harmful cards score below the town that did nothing, at their own defaults', () => {
  for (const id of ['development-review-extension', 'new-home-impact-fee', 'downtown-parking-free', 'inclusionary-set-aside']) {
    const s = score([id]);
    assert.ok(s.overall < 50, `${id} leaves the town worse off: ${s.overall}`);
  }
  // and harder settings hurt more, so the slider is a real choice and not decoration
  const mild = score(['inclusionary-set-aside'], { 'inclusionary-set-aside': { percent_below_market: 5 } });
  const steep = score(['inclusionary-set-aside'], { 'inclusionary-set-aside': { percent_below_market: 40 } });
  assert.ok(steep.overall < mild.overall - 5, `a steep set-aside costs more than a mild one: ${steep.overall} vs ${mild.overall}`);
  assert.ok(at(steep, 'housingUnits').score < 20, 'because it is building that stops');

  // free parking is the two-sided one: the driving gets easier and the Town pays for it
  const free = score(['downtown-parking-free'], { 'downtown-parking-free': { dollars_per_day: -10 } });
  assert.ok(at(free, 'netFiscal').score < 10, "the Town's money goes");
  assert.ok(at(free, 'avgCommuteMin').score > 50, 'driving in is easier');
  assert.ok(free.social < 45 && free.economic >= 50, `and residents carry it: ${free.social} against ${free.economic}`);
});

// Only two settings in the rest of the library leave the town clearly worse off. Both are popular.
test('maximum parking minimums and a deep tax cut are the catalog\u2019s own ways to lose', () => {
  const parking = score(['parking-minimum-restore'], { 'parking-minimum-restore': { spaces_per_home: 2 } });
  assert.ok(parking.overall < 45, `parking minimums at their highest: ${parking.overall}`);
  assert.ok(at(parking, 'housingUnits').score < 25, 'the homes stop being built');

  const cut = score(['property-tax-adjustment'], { 'property-tax-adjustment': { cents_per_100: -10 } });
  assert.ok(cut.economic > 55 && cut.social < 42, `a deep tax cut splits the halves: ${cut.economic} against ${cut.social}`);
});

test('a metric the models could not produce counts as no change, rather than taking the whole score to NaN', () => {
  const line = v => [{ metrics: { treeCoverPct: 46.9, rentBurden: 0.6 } }, { metrics: { treeCoverPct: v, rentBurden: 0.6 } }];
  const s = scoreAgainst(line(NaN), line(46.9));
  assert.equal(s.indicators.find(i => i.key === 'treeCoverPct').score, 50, 'the broken line sits still');
  assert.ok(Number.isFinite(s.overall) && Number.isFinite(s.social), `overall ${s.overall}, social ${s.social}`);
  // NaN >= min is false for every band, so an unguarded score would read as the worst one
  assert.notEqual(s.band, 'Far worse');
  assert.equal(s.band, 'About the same');
});

test('the scorer returns no absolute anchors, because nothing renders them', () => {
  const s = score(['transit-upzoning']);
  for (const i of s.indicators) {
    assert.ok(!('target' in i) && !('floor' in i), `${i.key}: the anchors live in shared/indicators.js and docs/health-score.md`);
  }
});

test('the summary names what carried a half, and says so plainly when nothing did', () => {
  const ind = (key, label, move, weight = 1) => ({ key, label, move, weight });
  assert.equal(summarise([ind('a', 'Jobs', 0)]), 'Nothing moved much either way.');
  assert.equal(summarise([ind('a', 'Jobs', 0.5), ind('b', 'Tree cover', -0.4)]), 'Better on jobs; worse on tree cover.');
  assert.equal(summarise([ind('a', 'Jobs', 0.5), ind('b', 'Rent', 0.3)]), 'Better on jobs and rent.');
  assert.equal(summarise([ind('a', 'Jobs', -0.5)]), 'Worse on jobs.');
  // the biggest mover by weight leads, so a double-weighted indicator outranks a bigger move on a light one
  assert.match(summarise([ind('a', 'Rent', 0.4, 2), ind('b', 'Buses', 0.6, 0.5)]), /^Better on rent and buses\./);
  // a bigger limit really names more, rather than silently dropping the extras
  assert.equal(summarise([ind('a', 'Jobs', 0.5), ind('b', 'Rent', 0.4), ind('c', 'Buses', 0.3)], 3), 'Better on jobs, rent and buses.');
});
