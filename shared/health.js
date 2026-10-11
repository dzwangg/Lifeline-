// City health: one score out of 100 for how a policy package leaves Chapel Hill, in two halves — the economy, and the
// people who live here. Pure: the same run scores the same in the browser, a Worker and Node.
//
// **50 is the town that adopted nothing.** Every indicator is scored against the same decade run with no new policy, so
// a run compared with itself is 50 on the nose and the number always answers one question: better or worse than doing
// nothing? An absolute score would mostly measure Chapel Hill's starting position, which no policy can move far in a
// decade; this measures the policies.
//
// How a score is built:
//   1. Each scored indicator (shared/indicators.js, the ones with a `score` block) is read in its own basis — its level
//      this year, its growth since year 0, or its change per year — for both runs, and the gap between them is divided
//      by that indicator's `swing`: the move against doing nothing that counts as decisive. Clamped to ±1, so one
//      runaway indicator can't carry the score, and turned into 50 ± 50.
//   2. Each half is the weighted mean of its own indicators' moves, again as 50 ± 50.
//   3. Overall is the mean of the two halves, so the side with more indicators can't drown out the other.
// The swings are calibrated against what the models actually do: see docs/health-score.md. They are data, not logic —
// tune them in shared/indicators.js without touching this file.
//
// The anchors (`target`, `floor`) in the same block are not read here and not returned. They say what a good and a bad
// town look like in absolute terms: they are where the swings were sized from, and they are documented in
// docs/health-score.md. Nothing renders them today.

import { INDICATORS, PILLARS } from './indicators.js';

/** The two halves of the score. */
export const CATEGORIES = [
  { id: 'economic', label: 'Economy', question: 'Is the town earning its living?' },
  { id: 'social', label: 'Residents', question: 'Are the people here better off?' },
];

/** What a score means, in words. 50 is the town that did nothing, so every band is relative to that. */
export const BANDS = [
  { min: 72, label: 'Far better' },
  { min: 58, label: 'Better' },
  { min: 43, label: 'About the same' },
  { min: 28, label: 'Worse' },
  { min: 0, label: 'Far worse' },
];
/** The same five steps said about the people rather than the town. */
export const MOODS = [
  { min: 72, label: 'Much better off' },
  { min: 58, label: 'Better off' },
  { min: 43, label: 'About as before' },
  { min: 28, label: 'Worse off' },
  { min: 0, label: 'Much worse off' },
];
const bandIn = (list, score) => (list.find(b => score >= b.min) ?? list.at(-1)).label;
export const bandOf = score => bandIn(BANDS, score);
export const moodOf = score => bandIn(MOODS, score);

export const SCORED = INDICATORS.filter(i => i.score);

/** An indicator's value in its scoring basis: its level, its ratio to year 0, or its change per year since year 0. */
export function basisValue(indicator, timeline, year) {
  const at = y => timeline[y].metrics[indicator.key];
  const now = at(year), start = at(0);
  switch (indicator.score.basis) {
    case 'ratioToStart': return start ? now / start : 1;
    case 'perYear': return year ? (now - start) / year : 0;
    default: return now; // 'level'
  }
}

const clamp1 = x => Math.max(-1, Math.min(1, x));
const round = v => Math.round(v * 10) / 10;

/**
 * Scores a run against the same decade with no new policy.
 * @param {{ metrics: Record<string, number> }[]} policy @param {{ metrics: Record<string, number> }[]} baseline
 * @param {number} [year] the year to score; the last by default
 */
export function scoreAgainst(policy, baseline, year = policy.length - 1) {
  // Year 0 is the town as it stands, the same in both runs: there is nothing to score yet.
  if (year < 1) return { scored: false, year };
  const pillarLabel = id => PILLARS.find(p => p.id === id)?.label ?? id;
  const indicators = SCORED.filter(i => i.key in policy[year].metrics).map(i => {
    const dir = i.better === 'higher' ? 1 : -1;
    const value = basisValue(i, policy, year), base = basisValue(i, baseline, Math.min(year, baseline.length - 1));
    // A metric the models could not produce counts as no change. Letting NaN through would poison its half, the overall
    // and the band — `NaN >= min` is false for every band, so the panel would read "NaN/100 · Far worse".
    const move = Number.isFinite(value) && Number.isFinite(base) ? clamp1(((value - base) * dir) / i.score.swing) : 0;
    return { key: i.key, label: i.score.label ?? i.short ?? i.label, category: i.score.category, pillar: i.pillar,
      pillarLabel: pillarLabel(i.pillar), value, base, move, score: round(50 + 50 * move), weight: i.score.weight ?? 1,
      basis: i.score.basis ?? 'level', fmt: i.score.fmt ?? i.fmt, why: i.score.why, today: i.today?.text };
  });
  const half = list => (list.length
    ? round(50 + 50 * (list.reduce((s, i) => s + i.move * i.weight, 0) / list.reduce((s, i) => s + i.weight, 0)))
    : 50);
  const categories = CATEGORIES.map(c => {
    const own = indicators.filter(i => i.category === c.id);
    return { ...c, score: half(own), indicators: own, summary: summarise(own) };
  });
  const byId = Object.fromEntries(categories.map(c => [c.id, c.score]));
  const overall = round((byId.economic + byId.social) / 2);
  return { scored: true, year, overall, band: bandOf(overall), economic: byId.economic, social: byId.social,
    mood: moodOf(byId.social), categories, indicators };
}

/** The indicators that carried a half, in a sentence: what moved it up, then what pulled against it. */
export function summarise(indicators, limit = 2) {
  const moved = indicators.filter(i => Math.abs(i.move) > 0.02);
  if (!moved.length) return 'Nothing moved much either way.';
  const pick = sign => moved.filter(i => Math.sign(i.move) === sign)
    .sort((a, b) => Math.abs(b.move * b.weight) - Math.abs(a.move * a.weight)).slice(0, limit)
    .map(i => i.label.toLowerCase());
  const names = list => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);
  const up = pick(1), down = pick(-1);
  if (up.length && down.length) return `Better on ${names(up)}; worse on ${names(down)}.`;
  return up.length ? `Better on ${names(up)}.` : `Worse on ${names(down)}.`;
}

