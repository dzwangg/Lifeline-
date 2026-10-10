// The Meridian policy simulator's shared contract. shared/*.js implements it in plain JS (JSDoc points here);
// a future TypeScript backend can import these types directly.

export type ZoneState = 'forest' | 'low_res' | 'mid_res' | 'mixed_use' | 'parking' | 'transit_station';

export interface Zone {
  id: string;
  state: ZoneState;
  areaAcres: number;
  tags: string[]; // "map_edge" (near the map boundary, not the town limit), "corridor" (near a trunk road such as 15-501)
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

export interface PolicyCard {
  id: string;
  title: string;
  summary: string;
  category?: string; // a policy-panel category id (meridian-city/policy/policies.js); defaults to "housing"
  icon?: string; // a policy-panel icon key; defaults to "house"
  decider: { body: string; how: string[] };
  params: PolicyParam[];
  zoneRules: ZoneRule[];
  tradeoffs: { pros: string[]; cons: string[] }; // both must be non-empty
}

export interface Metrics { housingUnits: number; medianRent: number; treeCoverPct: number; avgCommuteMin: number; taxRevenue: number }

export interface SimResult {
  scenarioId: string;
  policies: { id: string; title: string; params: Record<string, number> }[];
  years: number;
  timeline: { year: number; zoneStates: Record<string, ZoneState>; metrics: Metrics }[];
  deltas: { metric: string; baseline: number; final: number; changePct: number }[];
  tradeoffs: { pros: string[]; cons: string[] };
  assumptions: { key: string; value: number; source: string }[];
}

// data/baselines.json and data/assumptions.json. A source starting "PLACEHOLDER" or "VERIFY" is not yet citable.
export interface Sourced<T = number> { value: T; source: string; note?: string }
export type Baselines = Record<string, Sourced & { year: number | null }>;
export type Assumptions = Record<string, Sourced<number | Partial<Record<ZoneState, number>>> & { unit?: string; alternate?: Sourced }>;
