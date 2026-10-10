// The Meridian policy simulator's shared contract. shared/*.js implements it in plain JS (JSDoc points here);
// a future TypeScript backend can import these types directly.

export type ZoneState = 'forest' | 'low_res' | 'mid_res' | 'mixed_use' | 'parking' | 'transit_station';

export interface Zone {
  id: string;
  state: ZoneState;
  areaAcres: number;
  tags: string[]; // "map_edge" (wood near the map boundary, not the town limit), "corridor" (wood near a trunk road such as 15-501), "wood-NN"
  edgeDistM: number; // metres to the map boundary: rules convert zones closest-to-edge first
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }; // GeoJSON, WGS84 lng/lat
}

export interface PolicyParam { key: string; label: string; min: number; max: number; default: number; unit: string }

export interface ZoneRule {
  where: string; // "tag:<tag>" or "id:<zoneId>"
  from: ZoneState;
  to: ZoneState;
  ratePerYear: number; // fraction of the zones matching `where` converted each year, (0, 1]
  capParam?: string; // key of one of the card's params: its value caps the total acres this card converts
}

// A CH-LUTI lever (shared/luti/levers.js) the card sets, to a fixed value or to the value of one of the card's params.
export interface Lever {
  lever: string; // a key of LEVERS, e.g. "tax.rateDelta"
  value?: number; // exactly one of value and param
  param?: string; // key of one of the card's params
  zones?: string[]; // CH-LUTI zone ids (shared/luti/data.js), zoned levers only; all zones if omitted
}

export interface PolicyCard {
  id: string;
  title: string;
  summary: string;
  category?: string; // a policy-panel category id (meridian-city/policy/policies.js); defaults to "housing"
  icon?: string; // a policy-panel icon key; defaults to "house"
  decider: { body: string; how: string[] };
  params: PolicyParam[];
  zoneRules?: ZoneRule[]; // a card needs at least one zone rule or lever
  levers?: Lever[];
  timing?: { delayQuarters: number; phaseInQuarters: number }; // when the levers start, then how long they take to phase in
  evidence?: { claim: string; source: string; url?: string }[];
  tradeoffs: { pros: string[]; cons: string[] }; // both must be non-empty
}

export interface Metrics {
  housingUnits: number; medianRent: number; treeCoverPct: number; avgCommuteMin: number; taxRevenue: number;
  // In the full SimResult (shared/combined.js) every metric comes from one model: homes and property tax from CH-LUTI (with
  // the zone rules' homes and our tax formula), tree cover from the land-use sim, the rest as noted.
  households?: number; pricedOut?: number; // household model; pricedOut counts year-0 households that have left
  // CH-LUTI: jobs in town, storefront businesses, downtown storefront vacancy (share), median home value ($),
  // town budget net of policy and service costs ($/yr), bus trips a year, car traffic (1 = year 0)
  jobs?: number; businesses?: number; storefrontVacancy?: number; homeValue?: number; netFiscal?: number; transitRidership?: number; trafficIndex?: number;
}

export interface SimResult {
  scenarioId: string;
  policies: { id: string; title: string; params: Record<string, number> }[];
  years: number;
  timeline: { year: number; zoneStates: Record<string, ZoneState>; metrics: Metrics }[];
  // changePts: the change in percentage points, for treeCoverPct, storefrontVacancy and trafficIndex (shared/combined.js)
  deltas: { metric: string; baseline: number; final: number; changePct: number; changePts?: number; comparedWith?: 'year 0' | 'no new policy' }[];
  tradeoffs: { pros: string[]; cons: string[] };
  assumptions: { key: string; value: number; source: string }[];
}

// data/baselines.json and data/assumptions.json. A source starting "PLACEHOLDER" or "VERIFY" is not yet citable.
export interface Sourced<T = number> { value: T; source: string; note?: string }
export type Baselines = Record<string, Sourced & { year: number | null }>;
// Values are a number, numbers by key (a zone state, a household-model or CH-LUTI zone, or { lo, mid, hi } for a CH-LUTI range), or a list.
export type Assumptions = Record<string, Sourced<number | number[] | Record<string, number>> & { unit?: string; alternate?: Sourced }>;
