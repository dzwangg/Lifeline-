// The residential building types new development is made of, and which zone states use which. Sizes are metres; ranges
// are [min, max], with each building's value picked by its lot's hash. Units are homes per building: the explicit mapping
// from a building to the sim's housing count (see units.js). fam is the city's building family (world/palette.js), so a
// planned house is styled exactly like the city's own houses.
// Pure: no DOM, no THREE.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const TYPES = {
  detached: {
    fam: 'house', label: 'Detached house', w: [9, 12], d: [8, 11], floors: [1, 2], gap: [4, 6], doors: 1,
    roofs: ['hip', 'gable', 'gable'], porch: .6, chimney: .45, solar: .3, lShape: .3, units: () => 1,
  },
  duplex: {
    fam: 'house', label: 'Duplex', w: [14, 17], d: [9, 11], floors: [2, 2], gap: [4, 5], doors: 2,
    roofs: ['hip', 'gable'], porch: .5, chimney: .3, solar: .3, units: () => 2,
  },
  townhouse: { // a row of n homes, each unitW wide
    fam: 'house', label: 'Townhouses', unitW: [6, 7], n: [3, 6], d: [10, 12], floors: [2, 3], gap: [5, 6],
    roofs: ['gable', 'hip'], porch: .35, chimney: 0, solar: .35, units: b => b.n,
  },
  apartment: {
    fam: 'apartment', label: 'Apartments', w: [20, 32], d: [14, 20], floors: [3, 5], gap: [6, 8], doors: 1,
    roofs: ['hip', 'flat'], balconies: .8, min: [16, 12], units: b => clamp(Math.floor(b.w * b.d * b.floors * .75 / 85), 6, 48),
  },
  mixed: { // shops on the ground floor, homes above
    fam: 'apartment', label: 'Shops and apartments', w: [28, 46], d: [20, 30], floors: [5, 7], gap: [6, 8], doors: 1,
    roofs: ['flat'], balconies: .9, min: [18, 14], ground: 'storefront', awnings: true, units: b => Math.floor(b.w * b.d * (b.floors - 1) * .8 / 80),
  },
};

// For each zone state, the type mixes the planner tries in turn, gentlest first: it moves to a denser mix only when the
// gentler one can't fit the parcel's homes. A mix of two types alternates between them by each lot's hash.
export const MIXES = {
  low_res: [['detached'], ['detached', 'duplex'], ['duplex']],
  mid_res: [['townhouse'], ['townhouse', 'apartment'], ['apartment']],
  mixed_use: [['mixed']],
  transit_station: [['mixed']],
};

/** A building's size and floors for its lot hash h (h(k) -> [0, 1)), shrunk to the small end when tight is set. */
export function dims(type, h, tight = false) {
  const T = TYPES[type], pick = ([a, b], k) => (tight ? a : a + (b - a) * h(k));
  const floors = Math.round(pick(T.floors, 8));
  if (type === 'townhouse') {
    const n = Math.round(pick(T.n, 9)), unitW = pick(T.unitW, 10);
    return { n, unitW, w: n * unitW, d: pick(T.d, 11), floors, doors: n };
  }
  return { n: 1, w: pick(T.w, 10), d: pick(T.d, 11), floors, doors: T.doors };
}

/**
 * The sizes to try on a lot, largest first: the lot's own size, then smaller. Houses step down to the small end of their
 * range; townhouse rows lose a home at a time (to 3); apartment blocks shrink in 4 m steps to their minimum footprint,
 * so a block still fits a narrow or shallow parcel, with fewer homes.
 * @param {number} most homes still wanted (a townhouse row is never longer)
 */
export function sizes(type, h, most = Infinity) {
  const T = TYPES[type], first = dims(type, h), out = [first];
  if (type === 'townhouse') {
    first.n = first.doors = Math.max(3, Math.min(first.n, most)); first.w = first.n * first.unitW;
    for (let n = first.n - 1; n >= 3; n--) out.push({ ...first, n, doors: n, w: n * first.unitW });
  } else if (T.min) {
    for (let k = 1; ; k++) {
      const w = first.w - 4 * k, d = Math.max(T.min[1], first.d - 2 * k);
      if (w < T.min[0]) break;
      out.push({ ...first, w, d });
    }
  } else out.push(dims(type, h, true));
  return out;
}

/** How far a type sits back from the sidewalk, given the neighbours' median setback. */
export const setbackFor = (type, neighbours) => (TYPES[type].fam === 'house' ? clamp(neighbours, 4, 9) : clamp(neighbours * .7, 3, 6));
