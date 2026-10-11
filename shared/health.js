// City health: one score out of 100 for how Chapel Hill is doing at the end of a run, in two halves — the economy, and
// how residents are faring. Pure: the same run scores the same in the browser, a Worker and Node.
//
// How a score is built, in three steps:
//   1. Each scored indicator (shared/indicators.js, the ones with a `score` block) is read in its own basis — its level
//      this year, its ratio to year 0, or its change per year — and mapped onto 0-100 between two anchors: `floor`
//      scores 0, `target` scores 100, straight line between, clamped at both ends. The direction falls out of the
//      anchors: for rent burden target (35%) is below floor (75%), for jobs target is above floor.
//      A growth anchor (`ratioToStart`) is written per decade and compounded to the year being scored, so +15% of jobs
//      in ten years asks for +1.4% after one. Without that, every growth indicator would sit at its floor early in a
//      run and the score would climb on the calendar rather than on the policies.
//   2. Each half is the mean of its indicators' scores, each indicator weighted (default 1).
//   3. Overall is the mean of the two halves, so neither can be drowned out by having more indicators.
// Every anchor is a value judgement about what "doing well" means, so each one carries its reasoning and, where one
// exists, a published source (docs/health-score.md). They are data, not logic: tune them there without touching this.
//
// The same scoring runs on the no-policy timeline, which is what makes the number mean something: a town can score 58
// doing nothing and 63 with a policy package, and the second number is only worth reading next to the first.

import { INDICATORS, PILLARS } from './indicators.js';

/** The two halves of the score. */
export const CATEGORIES = [
  { id: 'economic', label: 'Economy', question: 'Is the town earning its living?' },
  { id: 'social', label: 'Residents', question: 'Are the people here better off?' },
];

/** What a score means, in words: a band for the headline number. */
export const BANDS = [
  { min: 80, label: 'Thriving' },
  { min: 65, label: 'Healthy' },
  { min: 50, label: 'Holding steady' },
  { min: 35, label: 'Strained' },
  { min: 0, label: 'Struggling' },
];
export const bandOf = score => BANDS.find(b => score >= b.min) ?? BANDS.at(-1);

export const SCORED = INDICATORS.filter(i => i.score);

/** The anchors are written per decade; a growth anchor compounds to the year being scored. */
export const HORIZON = 10;
export function anchorsAt(indicator, year) {
  const { target, floor, basis, horizon = HORIZON } = indicator.score;
  if (basis !== 'ratioToStart') return { target, floor };
  const k = year / horizon;
  return { target: target ** k, floor: floor ** k };
}

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

/** 0-100 between the anchors, clamped. target scores 100 and floor 0, whichever way round they are. */
export const scoreValue = (value, { target, floor }) =>
  Math.max(0, Math.min(100, ((value - floor) / (target - floor)) * 100));

/**
 * Scores one run's timeline at `year`.
 * @param {{ metrics: Record<string, number> }[]} timeline a SimResult timeline (year 0 first)
 * @param {number} [year] the year to score; the last by default
 * @returns {{ overall: number, band: string, economic: number, social: number,
 *   categories: { id: string, label: string, question: string, score: number, indicators: object[] }[],
 *   indicators: { key: string, label: string, category: string, pillar: string, pillarLabel: string, value: number,
 *     score: number, weight: number, target: number, floor: number, basis: string, fmt: string, why: string }[] }}
 */
export function scoreRun(timeline, year = timeline.length - 1) {
  // Year 0 is the town as it stands, the same in every run: nothing has grown yet and no homes have been built, so there
  // is nothing to score. The caller shows that rather than a number.
  if (year < 1) return { scored: false, year };
  const pillarLabel = id => PILLARS.find(p => p.id === id)?.label ?? id;
  const indicators = SCORED.filter(i => i.key in timeline[year].metrics).map(i => {
    const value = basisValue(i, timeline, year), anchors = anchorsAt(i, year);
    return { key: i.key, label: i.score.label ?? i.short ?? i.label, category: i.score.category, pillar: i.pillar,
      pillarLabel: pillarLabel(i.pillar), value, score: scoreValue(value, anchors), weight: i.score.weight ?? 1,
      target: anchors.target, floor: anchors.floor, basis: i.score.basis ?? 'level', fmt: i.score.fmt ?? i.fmt, why: i.score.why };
  });
  const mean = list => (list.length ? list.reduce((s, x) => s + x.score * x.weight, 0) / list.reduce((s, x) => s + x.weight, 0) : 0);
  const categories = CATEGORIES.map(c => {
    const own = indicators.filter(i => i.category === c.id);
    return { ...c, score: round(mean(own)), indicators: own };
  });
  const byId = Object.fromEntries(categories.map(c => [c.id, c.score]));
  const overall = round((byId.economic + byId.social) / 2);
  return { scored: true, overall, band: bandOf(overall).label, economic: byId.economic, social: byId.social, categories, indicators, year };
}

/**
 * The run's score beside the same town with no new policy: the comparison is the point, since a score on its own can't
 * say whether a policy helped or the town was heading there anyway.
 * @param {{ metrics: Record<string, number> }[]} policy @param {{ metrics: Record<string, number> }[]} baseline
 */
export function compareRuns(policy, baseline, year = policy.length - 1) {
  const a = scoreRun(policy, year), b = scoreRun(baseline, Math.min(year, baseline.length - 1));
  if (!a.scored || !b.scored) return { scored: false, year, policy: a, baseline: b };
  const deltas = Object.fromEntries(a.indicators.map((i, n) => [i.key, round(i.score - (b.indicators[n]?.score ?? i.score))]));
  return { scored: true, policy: a, baseline: b, overall: round(a.overall - b.overall), economic: round(a.economic - b.economic),
    social: round(a.social - b.social), indicators: deltas };
}

const round = v => Math.round(v * 10) / 10;
