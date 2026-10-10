// Hand-written validators for PolicyCard and SimResult (see types.d.ts). Each returns a list of
// "path: problem" strings; an empty list means valid.
import { CATEGORIES, ICONS } from '../meridian-city/policy/policies.js'; // cards slot into the policy panel's categories
import { LEVERS } from './luti/levers.js';
import { ZONE_IDS as LUTI_ZONES } from './luti/data.js';

/** @typedef {import('./types').PolicyCard} PolicyCard @typedef {import('./types').SimResult} SimResult @typedef {import('./types').Zone} Zone */

export const ZONE_STATES = ['forest', 'low_res', 'mid_res', 'mixed_use', 'parking', 'transit_station'];
export const METRICS = ['housingUnits', 'medianRent', 'treeCoverPct', 'avgCommuteMin', 'taxRevenue'];
export const HOUSEHOLD_METRICS = ['households', 'pricedOut']; // added by shared/combined.js
export const LUTI_METRICS = ['jobs', 'businesses', 'storefrontVacancy', 'homeValue', 'netFiscal', 'transitRidership', 'trafficIndex']; // added by shared/combined.js
const OPTIONAL_METRICS = [...HOUSEHOLD_METRICS, ...LUTI_METRICS];

/** Does a rule's `where` ("tag:<tag>" or "id:<zoneId>") select this zone? @param {string} where @param {Pick<Zone, 'id' | 'tags'>} zone */
export const matchesWhere = (where, zone) => where === `id:${zone.id}` || (where.startsWith('tag:') && zone.tags.includes(where.slice(4)));

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string' && v.trim() !== '';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const join = (path, key) => (path ? `${path}.${key}` : key);

function checker() {
  const errors = [];
  const ok = (pass, path, problem) => { if (!pass) errors.push(`${path}: ${problem}`); return !!pass; };
  const obj = (v, path, required, optional = []) => {
    if (!ok(isObj(v), path || '(card)', 'must be an object')) return false;
    for (const k of required) ok(k in v, join(path, k), 'is required');
    for (const k of Object.keys(v)) ok(required.includes(k) || optional.includes(k), join(path, k), 'is not a known field (typo?)');
    return true;
  };
  const list = (v, path) => ok(Array.isArray(v), path, 'must be a list');
  const strings = (v, path, emptyProblem) =>
    ok(Array.isArray(v) && v.every(isStr), path, 'must be a list of non-empty strings') && (!emptyProblem || ok(v.length, path, emptyProblem));
  return { errors, ok, obj, list, strings };
}

/** @param {PolicyCard} card */
export function validateCard(card) {
  const { errors, ok, obj, list, strings } = checker();
  if (!obj(card, '', ['id', 'title', 'summary', 'decider', 'params', 'tradeoffs'], ['category', 'icon', 'zoneRules', 'levers', 'timing', 'evidence'])) return errors;
  ok(typeof card.id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(card.id), 'id', 'must be lowercase words joined by dashes, e.g. "edge-forest-release"');
  ok(isStr(card.title), 'title', 'must be a non-empty string');
  ok(isStr(card.summary), 'summary', 'must be a non-empty string');
  if ('category' in card) ok(CATEGORIES.some(c => c.id === card.category), 'category', `must be one of ${CATEGORIES.map(c => c.id).join(', ')}`);
  if ('icon' in card) ok(Object.hasOwn(ICONS, card.icon), 'icon', `must be one of ${Object.keys(ICONS).join(', ')}`);
  if (obj(card.decider, 'decider', ['body', 'how'])) {
    ok(isStr(card.decider.body), 'decider.body', 'must be a non-empty string');
    strings(card.decider.how, 'decider.how');
  }

  const keys = [];
  if (list(card.params, 'params')) card.params.forEach((p, i) => {
    const path = `params[${i}]`;
    if (!obj(p, path, ['key', 'label', 'min', 'max', 'default', 'unit'])) return;
    if (ok(typeof p.key === 'string' && /^[a-z][a-z0-9_]*$/.test(p.key), `${path}.key`, 'must be snake_case, e.g. "acres_released"'))
      ok(!keys.includes(p.key), `${path}.key`, `"${p.key}" is used by another param`);
    keys.push(p.key);
    ok(isStr(p.label), `${path}.label`, 'must be a non-empty string');
    ok(typeof p.unit === 'string', `${path}.unit`, 'must be a string (may be empty)');
    if (['min', 'max', 'default'].map(k => ok(isNum(p[k]), `${path}.${k}`, 'must be a number')).every(Boolean) && ok(p.min < p.max, `${path}.max`, 'must be greater than min'))
      ok(p.min <= p.default && p.default <= p.max, `${path}.default`, 'must be between min and max');
  });

  ok(card.zoneRules?.length || card.levers?.length, '(card)', 'needs at least one entry in zoneRules or levers');
  if ('zoneRules' in card && list(card.zoneRules, 'zoneRules')) card.zoneRules.forEach((r, i) => {
    const path = `zoneRules[${i}]`;
    if (!obj(r, path, ['where', 'from', 'to', 'ratePerYear'], ['capParam'])) return;
    ok(typeof r.where === 'string' && /^(tag|id):\S+$/.test(r.where), `${path}.where`, 'must be "tag:<tag>" or "id:<zoneId>"');
    for (const k of ['from', 'to']) ok(ZONE_STATES.includes(r[k]), `${path}.${k}`, `must be one of ${ZONE_STATES.join(', ')}`);
    ok(r.from !== r.to, `${path}.to`, 'must differ from "from"');
    ok(isNum(r.ratePerYear) && r.ratePerYear > 0 && r.ratePerYear <= 1, `${path}.ratePerYear`, 'must be a number above 0 and at most 1');
    if ('capParam' in r) ok(keys.includes(r.capParam), `${path}.capParam`, `must be the key of one of this card's params (${keys.join(', ') || 'none defined'})`);
  });

  if ('levers' in card && list(card.levers, 'levers')) card.levers.forEach((l, i) => {
    const path = `levers[${i}]`;
    if (!obj(l, path, ['lever'], ['value', 'param', 'zones'])) return;
    const def = LEVERS[l.lever];
    if (!ok(def, `${path}.lever`, `must be one of ${Object.keys(LEVERS).join(', ')}`)) return;
    if (ok(('value' in l) !== ('param' in l), path, 'needs "value" or "param", not both')) {
      if ('value' in l) ok(isNum(l.value), `${path}.value`, 'must be a number');
      else ok(keys.includes(l.param), `${path}.param`, `must be the key of one of this card's params (${keys.join(', ') || 'none defined'})`);
    }
    if ('zones' in l) ok(def.zoned && Array.isArray(l.zones) && l.zones.length && l.zones.every(z => LUTI_ZONES.includes(z)), `${path}.zones`,
      def.zoned ? `must be a list of ${LUTI_ZONES.join(', ')}` : 'not allowed: this lever applies town-wide');
  });
  if ('timing' in card && obj(card.timing, 'timing', ['delayQuarters', 'phaseInQuarters']))
    for (const k of ['delayQuarters', 'phaseInQuarters']) ok(Number.isInteger(card.timing[k]) && card.timing[k] >= 0, `timing.${k}`, 'must be a whole number of quarters, 0 or more');
  if ('evidence' in card && list(card.evidence, 'evidence')) card.evidence.forEach((e, i) => {
    const path = `evidence[${i}]`;
    if (!obj(e, path, ['claim', 'source'], ['url'])) return;
    ok(isStr(e.claim), `${path}.claim`, 'must be a non-empty string');
    ok(isStr(e.source), `${path}.source`, 'must be a non-empty string');
    if ('url' in e) ok(typeof e.url === 'string' && /^https?:\/\/\S+$/.test(e.url), `${path}.url`, 'must be an http(s) link');
  });

  if (obj(card.tradeoffs, 'tradeoffs', ['pros', 'cons']))
    for (const side of ['pros', 'cons']) strings(card.tradeoffs[side], `tradeoffs.${side}`, 'needs at least one entry: every card shows both sides');
  return errors;
}

/** @param {SimResult} r */
export function validateSimResult(r) {
  const { errors, ok, obj, list, strings } = checker();
  if (!obj(r, '', ['scenarioId', 'policies', 'years', 'timeline', 'deltas', 'tradeoffs', 'assumptions'])) return errors;
  ok(isStr(r.scenarioId), 'scenarioId', 'must be a non-empty string');
  ok(Number.isInteger(r.years) && r.years >= 0, 'years', 'must be a whole number');
  if (list(r.policies, 'policies')) r.policies.forEach((p, i) => {
    const path = `policies[${i}]`;
    if (!obj(p, path, ['id', 'title', 'params'])) return;
    ok(isStr(p.id), `${path}.id`, 'must be a non-empty string');
    ok(isStr(p.title), `${path}.title`, 'must be a non-empty string');
    ok(isObj(p.params) && Object.values(p.params).every(isNum), `${path}.params`, 'must map param keys to numbers');
  });
  if (list(r.timeline, 'timeline') && ok(r.timeline.length === r.years + 1, 'timeline', 'needs one entry for each year from 0 to years')) r.timeline.forEach((t, i) => {
    const path = `timeline[${i}]`;
    if (!obj(t, path, ['year', 'zoneStates', 'metrics'])) return;
    ok(t.year === i, `${path}.year`, `must be ${i}`);
    ok(isObj(t.zoneStates) && Object.values(t.zoneStates).every(s => ZONE_STATES.includes(s)), `${path}.zoneStates`, 'must map zone ids to zone states');
    if (obj(t.metrics, `${path}.metrics`, METRICS, OPTIONAL_METRICS)) for (const m of Object.keys(t.metrics)) ok(isNum(t.metrics[m]), `${path}.metrics.${m}`, 'must be a number');
  });
  if (list(r.deltas, 'deltas')) r.deltas.forEach((d, i) => {
    const path = `deltas[${i}]`;
    if (!obj(d, path, ['metric', 'baseline', 'final', 'changePct'], ['comparedWith'])) return;
    ok([...METRICS, ...OPTIONAL_METRICS].includes(d.metric), `${path}.metric`, `must be one of ${[...METRICS, ...OPTIONAL_METRICS].join(', ')}`);
    if ('comparedWith' in d) ok(['year 0', 'no new policy'].includes(d.comparedWith), `${path}.comparedWith`, 'must be "year 0" or "no new policy"');
    for (const k of ['baseline', 'final', 'changePct']) ok(isNum(d[k]), `${path}.${k}`, 'must be a number');
  });
  if (obj(r.tradeoffs, 'tradeoffs', ['pros', 'cons'])) for (const side of ['pros', 'cons'])
    strings(r.tradeoffs[side], `tradeoffs.${side}`, r.policies?.length ? 'needs at least one entry while policies are active' : null);
  if (list(r.assumptions, 'assumptions')) r.assumptions.forEach((a, i) => {
    const path = `assumptions[${i}]`;
    if (!obj(a, path, ['key', 'value', 'source'])) return;
    ok(isStr(a.key), `${path}.key`, 'must be a non-empty string');
    ok(isNum(a.value), `${path}.value`, 'must be a number');
    ok(isStr(a.source), `${path}.source`, 'must be a non-empty string');
  });
  return errors;
}
