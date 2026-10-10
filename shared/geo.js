// The renderer's local frame, as set up in meridian-city/fetch_osm.py (keep the two in sync):
// metres from the centre of the baked bbox, x = east, z = south.
const S = 35.8959, W = -79.0675, N = 35.9211, E = -79.0365;
const LAT0 = (S + N) / 2, LNG0 = (W + E) / 2;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110574; // metres per degree

export const toLocal = ([lng, lat]) => [(lng - LNG0) * KX, (LAT0 - lat) * KZ];
export const toLngLat = ([x, z]) => [LNG0 + x / KX, LAT0 - z / KZ];
