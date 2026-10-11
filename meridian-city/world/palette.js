// One place for the look of the whole world: colours, material families, placement rules and render settings.
// Everything else reads from here, so a palette change re-skins buildings, streets, sprites and UI together.

// ---------- colour palette ----------
// Frutiger Aero meets pixel art: sky cyan and aqua, lime and emerald greens, white and glass architecture,
// glossy highlights, with Chapel Hill's brick kept bright and clean. Navy ink outlines tie it together.
export const P = {
  ink: '#1c2c5e',          // outline and deepest shadow
  shadow: '#2b4a7a',
  cream: '#f4f1e6', creamDark: '#d7dfe4', paper: '#ffffff',
  brick: '#c2482f', brickDark: '#93321f', brickLight: '#e0694a', mortar: '#d8c3a5',
  tan: '#c99a64', tanDark: '#a37446',
  gold: '#e8b33c', goldLight: '#f7d774', goldDark: '#b5801f',
  wood: '#8a5a36', woodDark: '#5e3a22', woodLight: '#b07a4c',
  stone: '#bdb3a2', stoneDark: '#8f8574', stoneLight: '#ddd4c2',
  slate: '#5f88bc', slateDark: '#45699e', slateLight: '#93b8e2',
  plum: '#7a62b0', plumDark: '#58468a', plumLight: '#9d8ad6',
  roofBlue: '#3f9fd8', roofBlueDark: '#2a78b4', roofBlueLight: '#7fcaf2',
  terracotta: '#b0583a', terracottaDark: '#843d27', terracottaLight: '#d07b55',
  moss: '#5e6b4f', mossDark: '#444f39', mossLight: '#7d8b68',
  charcoal: '#465a78', charcoalDark: '#2f4060', charcoalLight: '#6a80a2',
  glass: '#3fa9d8', glassDark: '#1f6fa8', glassLight: '#a6ecfb', glassGlint: '#ffffff',
  grass: '#5fb43f', grassDark: '#3f9136', grassLight: '#86d24e', grassPale: '#b4ec74',
  leaf: '#46b03c', leafDark: '#25803a', leafLight: '#7fd94c', leafGlint: '#c4f57a',
  pine: '#1f9a6e', pineDark: '#11704f', pineLight: '#3fc08a',
  maple: '#f0507a', mapleDark: '#c02e5c', mapleLight: '#ff86a6',
  amber: '#ffb52e', amberDark: '#d98714', amberLight: '#ffd96a',
  blossom: '#ff9ed6', blossomDark: '#e46aae', blossomLight: '#ffd2ee',
  soil: '#7a5638', soilDark: '#5a3e28', soilLight: '#9a7350',
  asphalt: '#4a5670', asphaltDark: '#3a445c', asphaltLight: '#5d6a86',
  pavement: '#d3e0e8', pavementDark: '#aebfcc', pavementLight: '#eef5f8',
  curb: '#f2f7fa',
  lineWhite: '#ffffff', lineYellow: '#ffd23f',
  water: '#2fb6e8', waterDark: '#1a86c8', waterLight: '#86e4fa', waterFoam: '#ffffff',
  sand: '#f2e2b0', sandDark: '#d6c08a',
  sky: '#7fd6f5', skyWarm: '#c9f2ff',
};

// Walls: each family picks deterministically from its own list, so neighbourhoods vary but never flicker between loads.
export const WALLS = {
  sidingCream: { kind: 'siding', base: '#efe0bd', dark: '#cdb88f', light: '#fbf1d9' },
  sidingButter: { kind: 'siding', base: '#ecd27c', dark: '#c9ab55', light: '#f7e6a6' },
  sidingSage: { kind: 'siding', base: '#9fb08a', dark: '#7d8e69', light: '#bfcda9' },
  sidingSky: { kind: 'siding', base: '#9cb8cf', dark: '#7895ad', light: '#c1d6e6' },
  sidingLilac: { kind: 'siding', base: '#b7a6c9', dark: '#9583a8', light: '#d3c6e0' },
  sidingWhite: { kind: 'siding', base: '#ece8df', dark: '#c9c2b4', light: '#fbf9f3' },
  sidingRed: { kind: 'siding', base: '#b5402f', dark: '#8d2c21', light: '#cf6450' },
  sidingOlive: { kind: 'siding', base: '#7f845c', dark: '#626744', light: '#9ea279' },
  brickRed: { kind: 'brick', base: '#b0432c', dark: '#86301f', light: '#c95a3e', mortar: '#c9a98a' },
  brickOrange: { kind: 'brick', base: '#c56a35', dark: '#9a4c22', light: '#dc8a50', mortar: '#d9c09c' },
  brickTan: { kind: 'brick', base: '#c49a6c', dark: '#a0774c', light: '#d8b384', mortar: '#e2d2b4' },
  brickCream: { kind: 'brick', base: '#e2cfa2', dark: '#bfa97c', light: '#f2e3bd', mortar: '#f7eedb' },
  stucco: { kind: 'stucco', base: '#efe2c6', dark: '#cfbf9e', light: '#fbf3e0' },
  stuccoPeach: { kind: 'stucco', base: '#efc7a2', dark: '#cfa47d', light: '#f9dcc0' },
  stone: { kind: 'stone', base: '#cfc5b0', dark: '#a69b84', light: '#e6dfcf' },
  panel: { kind: 'panel', base: '#d9d2c3', dark: '#b3aa98', light: '#ece6da' },
  metal: { kind: 'metal', base: '#a9b0b3', dark: '#848c90', light: '#c9cfd1' },
  concrete: { kind: 'stucco', base: '#c9c3b6', dark: '#a6a092', light: '#ddd8cc' },
  curtainAqua: { kind: 'curtain', base: '#5fcbe6', dark: '#2a8fc0', light: '#c8f4fc' },
  curtainSky: { kind: 'curtain', base: '#7ab8f0', dark: '#3f7cc8', light: '#d6ecff' },
  curtainMint: { kind: 'curtain', base: '#6fe0c0', dark: '#2fa48a', light: '#d2fbef' },
  sidingMint: { kind: 'siding', base: '#a8e8cf', dark: '#78c8ac', light: '#d6f7ea' },
  sidingAqua: { kind: 'siding', base: '#9fdcef', dark: '#6cb8d4', light: '#d4f3fb' },
  panelWhite: { kind: 'panel', base: '#f2f6f8', dark: '#c4d2dc', light: '#ffffff' },
  pearl: { kind: 'pearl', base: '#eef5f9', dark: '#cfdfea', light: '#ffffff', accent: '#bfe4f2' },
  pearlAqua: { kind: 'pearl', base: '#eaf6fb', dark: '#c8dfeb', light: '#ffffff', accent: '#3fb6e8' },
  pearlMint: { kind: 'pearl', base: '#edf8f3', dark: '#cde6dc', light: '#ffffff', accent: '#4fcf9a' },
  wood: { kind: 'planks', base: '#9a6a40', dark: '#74492a', light: '#b98a5e' },
};

export const ROOFS = {
  slate: { kind: 'shingle', base: P.slate, dark: P.slateDark, light: P.slateLight },
  plum: { kind: 'shingle', base: P.plum, dark: P.plumDark, light: P.plumLight },
  charcoal: { kind: 'shingle', base: P.charcoal, dark: P.charcoalDark, light: P.charcoalLight },
  terracotta: { kind: 'tile', base: P.terracotta, dark: P.terracottaDark, light: P.terracottaLight },
  moss: { kind: 'shingle', base: P.moss, dark: P.mossDark, light: P.mossLight },
  blueMetal: { kind: 'seam', base: P.roofBlue, dark: P.roofBlueDark, light: P.roofBlueLight },
  purpleMetal: { kind: 'seam', base: '#7b6aa8', dark: '#5a4b84', light: '#9d8dc6' },
  greenMetal: { kind: 'seam', base: '#5f8a6e', dark: '#446a52', light: '#7fa98c' },
  aquaGlass: { kind: 'glass', base: '#45c2e4', dark: '#2186b8', light: '#c4f4fd' },
  limeMetal: { kind: 'seam', base: '#7fcf4a', dark: '#4f9f32', light: '#b8ef7a' },
  skyMetal: { kind: 'seam', base: '#5aaee8', dark: '#3a82c4', light: '#9fd6fa' },
  pearlDeck: { kind: 'deck', base: '#e4edf2', dark: '#c9d8e2', light: '#f6fafc' }, // white flat roofs
  garden: { kind: 'garden', base: '#6fcf4a', dark: '#4fa83a', light: '#9fe86a' }, // roof gardens
  flatGravel: { kind: 'gravel', base: '#a9b6c4', dark: '#8a98a8', light: '#c8d4df' },
  flatTar: { kind: 'gravel', base: '#8593a6', dark: '#6c7a8e', light: '#a2afc0' },
};

// Building families: what each OSM building type looks like. Lists are picked from by a per-building hash.
// Building families: what each OSM building type looks like. Lists are picked from by a per-building hash.
// Every family keeps its identity (houses read residential, shops have storefronts, campus keeps its brick)
// and adds Aero touches through the decor flags:
//   lit       share of windows warmly lit       balconies  glass-railed balconies on upper floors
//   planters  planter boxes beside the entrance greenRoof  chance of a roof garden on a flat roof
//   solar     chance of solar panels            dome       chance of a glass dome skylight (flat roofs)
//   canopy    curved glass canopy over the entrance
export const FAMILIES = {
  house: {
    walls: ['sidingWhite', 'sidingSky', 'sidingMint', 'sidingAqua', 'sidingButter', 'sidingLilac', 'pearl', 'sidingRed', 'brickRed'],
    roofs: ['slate', 'skyMetal', 'plum', 'terracotta', 'limeMetal', 'blueMetal', 'charcoal'],
    window: 'shutter', ground: 'house', pitch: .75, porch: true, chimney: .55,
    lit: .1, planters: .5, solar: .3, doors: ['doorMint', 'doorSky', 'doorCoral', 'doorLilac', 'doorWhite', 'doorRed'],
  },
  apartment: {
    walls: ['pearl', 'brickRed', 'pearlAqua', 'sidingAqua', 'pearlMint', 'brickOrange', 'sidingSky'],
    roofs: ['slate', 'skyMetal', 'plum', 'terracotta', 'aquaGlass'],
    window: 'sill', ground: 'entry', pitch: .5, flatAbove: 5000,
    lit: .12, balconies: .75, planters: .7, greenRoof: .5, solar: .3, doors: ['doorAqua'],
  },
  shop: {
    walls: ['pearl', 'brickRed', 'pearlAqua', 'stuccoPeach', 'brickCream', 'pearlMint'],
    roofs: ['flatGravel', 'flatTar', 'terracotta', 'skyMetal'],
    window: 'sill', ground: 'storefront', pitch: .35, flatAbove: 450, awning: true,
    lit: .15, planters: .8, greenRoof: .35, solar: .3, doors: ['doorAqua'],
  },
  campus: {
    walls: ['brickRed', 'brickRed', 'brickRed', 'brickOrange', 'brickRed', 'pearl'],
    roofs: ['slate', 'charcoal', 'slate', 'greenMetal', 'slate'],
    window: 'colonial', ground: 'portico', pitch: .45, flatAbove: 9000,
    lit: .1, planters: .9, greenRoof: .45, dome: .3, solar: .2, doors: ['portico'],
  },
  office: {
    walls: ['curtainAqua', 'curtainSky', 'curtainMint', 'pearlAqua', 'curtainAqua'],
    roofs: ['flatGravel', 'flatTar'],
    window: 'band', ground: 'lobby', flatAbove: 0,
    lit: .12, planters: .9, greenRoof: .6, dome: .3, solar: .4, canopy: true, doors: ['doorAqua'],
  },
  civic: {
    walls: ['pearl', 'brickRed', 'pearlAqua', 'stone'],
    roofs: ['aquaGlass', 'greenMetal', 'slate', 'skyMetal'],
    window: 'tall', ground: 'portico', pitch: .6, flatAbove: 2600,
    lit: .1, planters: .9, greenRoof: .4, dome: .4, doors: ['portico'],
  },
  shed: {
    walls: ['sidingWhite', 'sidingMint', 'sidingSky', 'pearl', 'sidingRed'],
    roofs: ['skyMetal', 'limeMetal', 'blueMetal', 'terracotta', 'greenMetal'],
    window: 'none', ground: 'barn', pitch: .55,
  },
  industrial: {
    walls: ['pearlAqua', 'panelWhite', 'metal'],
    roofs: ['skyMetal', 'blueMetal', 'flatGravel'],
    window: 'strip', ground: 'bay', pitch: .25, flatAbove: 1800, solar: .5,
  },
  garage: { walls: ['pearl'], roofs: ['flatTar'], window: 'parking', ground: 'parking', flatAbove: 0, greenRoof: .5 },
  stadium: { walls: ['pearl'], roofs: ['flatGravel'], window: 'none', ground: 'none', flatAbove: 0 },
};

// Aero building kit: the stepped glass ramp, warm lit windows, trims and accents every facade shares.
export const AERO_BUILD = {
  glass: ['#eafcff', '#9fe6f8', '#4fc0e6', '#2a88c4'],      // top to bottom: glint, light, mid, deep
  lit: ['#fff4cc', '#ffd77a', '#f2b24a'],                      // warm interior light, top to bottom
  frame: '#ffffff', frameShade: '#c6dceb',                     // pearl window frames, stepped shade
  trim: '#ffffff', trimShade: '#bfe4f2',
  accents: ['#3fb6e8', '#4fcf9a', '#9d8ad6', '#ff8a7a', '#5aaee8', '#ffc84a'], // shutters, sign bands
  awnings: [['#3fb6e8', '#ffffff'], ['#6fd04a', '#ffffff'], ['#ff8fcf', '#ffffff'], ['#5aaee8', '#eafcff'], ['#9d8ad6', '#ffffff']],
  planter: ['#ffffff', '#cfe8f2', '#3fb6e8'],                  // body, shade, aqua band
};

const TYPE_FAMILY = {
  detached: 'house', house: 'house', semidetached_house: 'house', terrace: 'house', bungalow: 'house', static_caravan: 'house', cabin: 'house',
  apartments: 'apartment', residential: 'apartment', dormitory: 'apartment', hotel: 'apartment',
  retail: 'shop', commercial: 'shop', kiosk: 'shop', supermarket: 'shop',
  university: 'campus', college: 'campus', school: 'campus', library: 'campus',
  office: 'office',
  church: 'civic', chapel: 'civic', government: 'civic', civic: 'civic', public: 'civic', hospital: 'civic', fire_station: 'civic', train_station: 'civic',
  shed: 'shed', garage: 'shed', garages: 'shed', roof: 'shed', carport: 'shed', hut: 'shed', greenhouse: 'shed', service: 'shed',
  industrial: 'industrial', warehouse: 'industrial', construction: 'industrial',
  parking: 'garage', stadium: 'stadium', grandstand: 'stadium',
};

// OSM building type + shop flag + footprint → family. Untyped buildings ("yes") are judged by size and use.
export function familyOf(type, shop, area, levels) {
  if (shop && type !== 'university') return 'shop';
  if (TYPE_FAMILY[type]) return TYPE_FAMILY[type];
  if (area < 45) return 'shed';
  if (area < 260 && (levels || 2) <= 3) return 'house';
  if (area > 4000) return levels > 5 ? 'office' : 'campus';
  return area > 900 ? 'campus' : 'apartment';
}

export const FAMILY_LABEL = {
  house: 'House', apartment: 'Apartments', shop: 'Shops', campus: 'University building', office: 'Offices',
  civic: 'Public building', shed: 'Outbuilding', industrial: 'Industrial', garage: 'Parking garage', stadium: 'Stadium',
};

// ---------- scale and rendering ----------
export const TEXEL = 0.2;          // metres per texture pixel on buildings, streets and sprites
export const BAY = 3;              // facade bay width (m): one window column
export const STOREY = 3.4;         // default floor height (m)
export const PIXEL_SCALE = 2;      // CSS pixels per rendered pixel: the chunky, crisp pixel-art grain
// Zoom levels in rendered pixels per metre. 1/TEXEL = 5 means one texture pixel is exactly one screen pixel;
// every level is a power-of-two or integer ratio of that, so pixel art never resamples unevenly at rest.
export const ZOOMS = [0.15625, 0.3125, 0.625, 1.25, 2.5, 5, 10, 15];
export const DEFAULT_ZOOM = 5;      // index into ZOOMS
export const CAMERA = { elevationDeg: 35, azimuthDeg: 45, distance: 4000 };
// The sun keeps a fixed angle to the camera (left of and slightly behind the viewer), so walls facing
// screen-left are always sunlit and walls facing screen-right sit in soft shade, from every view.
export const SUN = { elevationDeg: 52, offsetDeg: -25, color: '#fffaf0', intensity: 2.2 };
export const AMBIENT = { sky: '#d8f6ff', ground: '#4f8a5a', intensity: 1.25 };
export const OUTLINE = { color: P.ink, strength: .55, depthMetres: .9 };
// Aero atmosphere: glossy specular on lit materials, a cyan haze toward the horizon, a sun glow, drifting bubbles.
// farAtmosphere: the share of the screen haze and sun glow kept at the farthest zoom (full strength from DEFAULT_ZOOM in).
export const AERO = { gloss: '#3a4a55', shininess: 38, haze: '#bff0ff', hazeStrength: .22, glow: '#fffbe6', glowStrength: .28, farAtmosphere: .3, bubbles: 26 };
// Render resolution caps: canvas pixels per CSS pixel, and canvas pixels in total (about a 2x laptop screen).
// Anisotropy: the most texture anisotropy asked of the GPU, for roofs and ground seen at the camera's 35° slant.
// Shadows: redrawn every frame from shadowLivePpm in (where vehicles cast them), otherwise only when the view moves or
// every shadowRefreshFrames frames.
export const RENDER = { maxPixelRatio: 2, maxPixels: 5.3e6, anisotropy: 8, shadowLivePpm: 1.2, shadowRefreshFrames: 6 };
// Level of detail: below these zooms (px/m) the matching layer is hidden.
// macro: at or below 1/16 (ppm under .5) changed sim zones draw as fills. trees: tree sprites draw at every zoom (the
// fine far-zoom grain and mipmapped atlas keep a few-pixel tree a readable crown); canopy discs stand in only below it.
export const LOD = { people: 2.5, furniture: 1.25, details: 1.25, flowers: 2.5, cars: .625, macro: .5, trees: 0 };
export const CHUNK = 350;           // metres per side of a culling chunk

// ---------- deterministic variety ----------
// hash(x, z, salt) → [0, 1). Keyed by world position, so a feature looks the same on every load
// regardless of the order it was built in.
export function hash(x, z, salt = 0) {
  let h = Math.imul((Math.round(x * 10) | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((Math.round(z * 10) | 0) + salt * 7919, 0xc2b2ae35);
  h = Math.imul(h ^ h >>> 16, 0x7feb352d); h = Math.imul(h ^ h >>> 15, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const pickBy = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

// A seeded generator for sequences (texture painting, scatter patterns).
export function seeded(seed) {
  let s = seed | 0;
  const next = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  next.range = (a, b) => a + next() * (b - a);
  next.pick = a => a[Math.floor(next() * a.length)];
  return next;
}
