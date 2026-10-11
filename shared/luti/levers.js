// Levers are the only things a policy card can touch in CH-LUTI. A card lists { lever, value | param, zones? }; the scheduler
// phases each one in, and the model reads lever values every quarter. Nothing in a card describes outcomes.
//
// kind: 'amount' levers add up across cards and ramp from 0; 'multiplier' levers ramp from 1; 'cap' levers ramp down
// from the zone's current value toward the card's value and never raise it.

/** @typedef {import('../types').PolicyCard} PolicyCard */

export const LEVERS = {
  'business.supportGrants':      { kind: 'amount', unit: '$/yr', label: 'Small-business support grants' },
  'business.startupGrants':      { kind: 'amount', unit: '$/yr', label: 'Start-up grants' },
  'employment.hiringSubsidy':    { kind: 'amount', unit: '$/yr', label: 'Hiring subsidy budget' },
  'housing.subsidyPerUnit':      { kind: 'amount', unit: '$/home', label: 'Construction subsidy per new home' },
  'housing.subsidyCap':          { kind: 'amount', unit: '$/yr', label: 'Construction subsidy annual cap' },
  'housing.farMultiplier':       { kind: 'multiplier', unit: '×', label: 'Allowed floor area', zoned: true },
  'housing.parkingMinimum':      { kind: 'cap', unit: 'spaces/home', label: 'Parking required per home', zoned: true },
  'housing.planningCost':        { kind: 'amount', unit: '$ once', label: 'One-time planning cost', once: true },
  'tax.rateDelta':               { kind: 'amount', unit: '¢ per $100', label: 'Property tax rate change' },
  'tax.storefrontVacancyTax':    { kind: 'amount', unit: '% of value/yr', label: 'Tax on long-vacant storefronts' },
  'transit.serviceMultiplier':   { kind: 'multiplier', unit: '×', label: 'Bus service hours' },
  'transport.protectedBikeKm':   { kind: 'amount', unit: 'km', label: 'Protected bike lanes' },
};

const ramp = (q, { delayQuarters = 0, phaseInQuarters = 0 } = {}) =>
  q < delayQuarters ? 0 : phaseInQuarters <= 0 ? 1 : Math.min(1, (q - delayQuarters + 1) / phaseInQuarters);

// Builds levers(q) → { [lever]: number | { [zoneId]: number } } for a list of policies, given zone defaults for 'cap' levers.
export function buildSchedule(policies, zoneIds, defaults = {}) {
  const entries = policies.flatMap(p => (p.levers ?? []).map(l => ({ ...l, timing: p.timing, policy: p.id })));
  for (const e of entries) if (!LEVERS[e.lever]) throw new Error(`Policy ${e.policy} uses unknown lever ${e.lever}`);
  return q => {
    const out = {};
    for (const [id, def] of Object.entries(LEVERS)) {
      if (def.zoned) out[id] = Object.fromEntries(zoneIds.map(z => [z, def.kind === 'cap' ? defaults[id]?.[z] ?? Infinity : 1]));
      else out[id] = def.kind === 'multiplier' ? 1 : 0;
    }
    for (const e of entries) {
      const def = LEVERS[e.lever], r = def.once ? (q === (e.timing?.delayQuarters ?? 0) ? 1 : 0) : ramp(q, e.timing);
      if (def.zoned) {
        for (const z of e.zones ?? zoneIds) {
          const cur = out[e.lever][z];
          if (def.kind === 'multiplier') out[e.lever][z] = cur * (1 + (e.value - 1) * r);
          else if (def.kind === 'cap' && r > 0) out[e.lever][z] = Number.isFinite(cur) ? cur + (Math.min(cur, e.value) - cur) * r : e.value;
        }
      } else if (def.kind === 'multiplier') out[e.lever] *= 1 + (e.value - 1) * r;
      else out[e.lever] += e.value * r;
    }
    return out;
  };
}

/**
 * The model's policies for the cards that have levers. A lever with `param` takes that param's value (clamped, default if unset).
 * @param {PolicyCard[]} cards @param {Record<string, Record<string, number>>} params card id -> param key -> value
 */
export const cardPolicies = (cards, params = {}) => cards.filter(c => c.levers?.length).map(c => {
  const value = key => { const p = c.params.find(x => x.key === key); return Math.min(p.max, Math.max(p.min, params[c.id]?.[key] ?? p.default)); };
  return { id: c.id, title: c.title, timing: c.timing, levers: c.levers.map(({ param, ...l }) => (param ? { ...l, value: value(param) } : l)) };
});
