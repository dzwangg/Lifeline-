// Levers are the only things a policy card can touch in CH-LUTI. A card lists { lever, value | param, zones? }; the scheduler
// phases each one in, and the model reads lever values every quarter. Nothing in a card describes outcomes.
//
// kind: 'amount' levers add up across cards and ramp from 0; 'multiplier' levers ramp from 1; 'cap' levers ramp down
// from the zone's current value toward the card's value and never raise it; 'floor' levers ramp up toward it and never
// lower it.

/** @typedef {import('../types').PolicyCard} PolicyCard */

export const LEVERS = {
  'business.supportGrants':      { kind: 'amount', unit: '$/yr', label: 'Small-business support grants' },
  'business.startupGrants':      { kind: 'amount', unit: '$/yr', label: 'Start-up grants' },
  'employment.hiringSubsidy':    { kind: 'amount', unit: '$/yr', label: 'Hiring subsidy budget' },
  'housing.subsidyPerUnit':      { kind: 'amount', unit: '$/home', label: 'Construction subsidy per new home' },
  'housing.subsidyCap':          { kind: 'amount', unit: '$/yr', label: 'Construction subsidy annual cap' },
  'housing.farMultiplier':       { kind: 'multiplier', unit: '×', label: 'Allowed floor area', zoned: true },
  'housing.parkingMinimum':      { kind: 'floor', unit: 'spaces/home', label: 'Parking required per new home', zoned: true },
  'housing.planningCost':        { kind: 'amount', unit: '$ once', label: 'One-time planning cost', once: true },
  'tax.rateDelta':               { kind: 'amount', unit: '¢ per $100', label: 'Property tax rate change' },
  'tax.storefrontVacancyTax':    { kind: 'amount', unit: '% of value/yr', label: 'Tax on long-vacant storefronts' },
  'transit.serviceMultiplier':   { kind: 'multiplier', unit: '×', label: 'Bus service hours' },
  'transport.protectedBikeKm':   { kind: 'amount', unit: 'km', label: 'Protected bike lanes' },
  'housing.inclusionaryPct':     { kind: 'amount', unit: '% of new homes', label: 'Share of new homes that must rent below market' },
  'housing.impactFee':           { kind: 'amount', unit: '$/home', label: 'Impact fee on each new home' },
  'housing.approvalMonths':      { kind: 'amount', unit: 'months', label: 'Change in permit approval time (negative is faster)' },
  'transit.busSpeedMultiplier':  { kind: 'multiplier', unit: '×', label: 'Bus speed in town (bus lanes, signal priority)' },
  'transport.parkingPriceDelta': { kind: 'amount', unit: '$/day', label: 'Daily charge at Town-run parking downtown' },
  'budget.annualCost':           { kind: 'amount', unit: '$/yr', label: 'Other yearly programme cost' },
  'budget.oneTimeCost':          { kind: 'amount', unit: '$ once', label: 'Other one-time cost', once: true },
  // Prompt-only levers (no catalog card uses them): social help paid to households, and job training. The household model
  // gives them to the renters they would reach; see shared/agents.js.
  'assistance.rentHouseholds':   { kind: 'amount', unit: 'households', label: 'Households getting rental assistance' },
  'assistance.rentMonthly':      { kind: 'amount', unit: '$/month', label: 'Rental assistance per household' },
  'assistance.cashHouseholds':   { kind: 'amount', unit: 'households', label: 'Households getting monthly cash' },
  'assistance.cashMonthly':      { kind: 'amount', unit: '$/month', label: 'Cash per household' },
  'workforce.trainees':          { kind: 'amount', unit: 'people/yr', label: 'Residents put through job training each year' },
};

// What a town could plausibly do with each lever, as [lowest, highest] value per card. Drafted cards are clamped into these
// (api/ask.js, api/policies.js), so "cut the tax rate by 90 cents" or "a trillion-dollar grant" never reaches the model.
export const LEVER_LIMITS = {
  'business.supportGrants': [0, 20e6], 'business.startupGrants': [0, 20e6], 'employment.hiringSubsidy': [0, 20e6],
  'housing.subsidyPerUnit': [0, 150000], 'housing.subsidyCap': [0, 40e6],
  'housing.farMultiplier': [0.5, 4], 'housing.parkingMinimum': [0, 3], 'housing.planningCost': [0, 5e6],
  'tax.rateDelta': [-25, 25], 'tax.storefrontVacancyTax': [0, 5],
  'transit.serviceMultiplier': [0.25, 3], 'transport.protectedBikeKm': [0, 80],
  'housing.inclusionaryPct': [0, 40], 'housing.impactFee': [0, 60000], 'housing.approvalMonths': [-12, 24],
  'transit.busSpeedMultiplier': [0.8, 1.6], 'transport.parkingPriceDelta': [-10, 30],
  'budget.annualCost': [0, 50e6], 'budget.oneTimeCost': [0, 250e6],
  'assistance.rentHouseholds': [0, 5000], 'assistance.rentMonthly': [0, 2000], 'assistance.cashHouseholds': [0, 5000], 'assistance.cashMonthly': [0, 2000],
  'workforce.trainees': [0, 1000],
};

// Payment programmes: a card's households and its monthly payment belong together, so programmes add up as money paid
// (households x payment, card by card) under these keys, never as all the households times all the payments.
export const PAYMENTS = [
  ['assistance.rentHouseholds', 'assistance.rentMonthly', 'assistance.rentPaid'],
  ['assistance.cashHouseholds', 'assistance.cashMonthly', 'assistance.cashPaid'],
];

const ramp = (q, { delayQuarters = 0, phaseInQuarters = 0 } = {}) =>
  q < delayQuarters ? 0 : phaseInQuarters <= 0 ? 1 : Math.min(1, (q - delayQuarters + 1) / phaseInQuarters);

// Builds levers(q) → { [lever]: number | { [zoneId]: number } } for a list of policies, given zone defaults for 'cap' and
// 'floor' levers, plus each payment programme's dollars a month (PAYMENTS).
export function buildSchedule(policies, zoneIds, defaults = {}) {
  const entries = policies.flatMap(p => (p.levers ?? []).map(l => ({ ...l, timing: p.timing, policy: p.id })));
  for (const e of entries) if (!LEVERS[e.lever]) throw new Error(`Policy ${e.policy} uses unknown lever ${e.lever}`);
  return q => {
    const out = {};
    for (const [id, def] of Object.entries(LEVERS)) {
      if (def.zoned) out[id] = Object.fromEntries(zoneIds.map(z => [z, def.kind === 'cap' ? defaults[id]?.[z] ?? Infinity : def.kind === 'floor' ? defaults[id]?.[z] ?? 0 : 1]));
      else out[id] = def.kind === 'multiplier' ? 1 : 0;
    }
    for (const e of entries) {
      const def = LEVERS[e.lever], r = def.once ? (q === (e.timing?.delayQuarters ?? 0) ? 1 : 0) : ramp(q, e.timing);
      if (def.zoned) {
        for (const z of e.zones ?? zoneIds) {
          const cur = out[e.lever][z];
          if (def.kind === 'multiplier') out[e.lever][z] = cur * (1 + (e.value - 1) * r);
          else if (def.kind === 'cap' && r > 0) out[e.lever][z] = Number.isFinite(cur) ? cur + (Math.min(cur, e.value) - cur) * r : e.value;
          else if (def.kind === 'floor' && r > 0) out[e.lever][z] = cur + (Math.max(cur, e.value) - cur) * r;
        }
      } else if (def.kind === 'multiplier') out[e.lever] *= 1 + (e.value - 1) * r;
      else out[e.lever] += e.value * r;
    }
    for (const [count, amount, paid] of PAYMENTS) {
      out[paid] = 0;
      for (const p of policies) {
        const n = p.levers?.find(l => l.lever === count), each = p.levers?.find(l => l.lever === amount);
        if (n && each) out[paid] += n.value * each.value * ramp(q, p.timing);
      }
    }
    return out;
  };
}

/**
 * The model's policies for the cards that have levers. A lever with `param` takes that param's value (clamped, default if unset).
 * A card enacted in a later year (starts) has its timing pushed back by that many years: year y ends with quarter 4y - 1.
 * @param {PolicyCard[]} cards @param {Record<string, Record<string, number>>} params card id -> param key -> value
 * @param {Record<string, number>} [starts] card id -> the year it is enacted (default 0)
 */
export const cardPolicies = (cards, params = {}, starts = {}) => cards.filter(c => c.levers?.length).map(c => {
  const value = key => { const p = c.params.find(x => x.key === key); return Math.min(p.max, Math.max(p.min, params[c.id]?.[key] ?? p.default)); };
  const start = starts[c.id] ?? 0, timing = start ? { ...c.timing, delayQuarters: (c.timing?.delayQuarters ?? 0) + 4 * start } : c.timing;
  return { id: c.id, title: c.title, timing, levers: c.levers.map(({ param, ...l }) => (param ? { ...l, value: value(param) } : l)) };
});
