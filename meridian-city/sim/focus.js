// Guided views: the camera frames 15-501 or the land the policies convert, and goes back to where it was.
// scenario.focus is null, 'road' or 'changes'; scenario.focusZones narrows 'changes' to some parcels (null: every
// parcel the forecast converts). The panel's buttons set it, and so does this module: when a card with zone rules is
// applied it frames the parcels that card converts, and when Play starts it frames the changes if the view is free.
// Moving between the two views keeps the place to go back to.
import { scenario, simClock, onFrame } from './scenario.js';
import { ZOOMS, PIXEL_SCALE, CAMERA } from '../world/palette.js';

const FLY_MS = 1400;
const CLUSTER_M = 500; // parcels converted within this distance of the biggest group are framed with it
const CLOSEST = 5; // the closest zoom level a change view takes (1x), so the parcels keep their surroundings
const SIN_EL = Math.sin(CAMERA.elevationDeg * Math.PI / 180);
const right = az => [Math.cos(az), -Math.sin(az)], fwd = az => [-Math.sin(az), -Math.cos(az)]; // on the ground, as the camera sees it
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const ringPts = ring => ring.flatMap((v, i) => (i % 2 ? [] : [[v, ring[i + 1]]]));

export function mountFocus({ world, osm, zones }) {
  const { view } = world, dom = view.renderer.domElement, E = osm.ext;
  let azGoal = view.azimuth;
  view.onChange(({ azimuth }) => { azGoal = azimuth; });

  // A view of points: turned a quarter if that lays dir more across the screen, at the closest zoom level that fits
  // them (no closer than maxLevel), centred in the part of the screen the sim panel leaves free.
  function frame(pts, dir, maxLevel = ZOOMS.length - 1) {
    const turn = dir && Math.abs(dot(dir, right(azGoal + Math.PI / 2))) > Math.abs(dot(dir, right(azGoal))) + .1 ? 1 : 0, az = azGoal + turn * Math.PI / 2;
    const R = right(az), F = fwd(az), range = axis => { const v = pts.map(p => dot(p, axis)); return [Math.min(...v), Math.max(...v)]; };
    const [r0, r1] = range(R), [f0, f1] = range(F), mr = (r0 + r1) / 2, mf = (f0 + f1) / 2; // the frame's centre, in view axes
    const w = dom.clientWidth, h = dom.clientHeight, plate = document.querySelector('.plate.sim')?.getBoundingClientRect();
    const free = plate && plate.width && plate.left > w / 2 ? plate.left : w; // the map left of the panel
    let level = 0;
    ZOOMS.forEach((z, i) => { const k = z * PIXEL_SCALE; if (i <= maxLevel && (r1 - r0) * k <= free * .9 && (f1 - f0) * SIN_EL * k <= h * .8) level = i; });
    const shift = (w / 2 - free / 2) / (ZOOMS[level] * PIXEL_SCALE);
    return { x: R[0] * (mr + shift) + F[0] * mf, z: R[1] * (mr + shift) + F[1] * mf, level, turn };
  }

  // 15-501 inside the map (Fordham Blvd, and 15-501 South west of the NC 86 interchange) and the corridor parcels along
  // it, so every parcel a corridor card converts is in frame.
  const seg = [];
  for (const { cls, r } of world.streets.roads) if (cls === 'trunk' || cls === 'trunk_link') for (let i = 0; i + 3 < r.length; i += 2)
    if (Math.max(Math.abs((r[i] + r[i + 2]) / 2), Math.abs((r[i + 1] + r[i + 3]) / 2)) < E) seg.push([r[i], r[i + 1], r[i + 2], r[i + 3]]);
  const roadPts = [...seg.flatMap(([ax, az, bx, bz]) => [[ax, az], [bx, bz]]), ...zones.filter(z => z.tags.includes('corridor')).flatMap(z => ringPts(z.ring))];
  let dxx = 0, dxz = 0, dzz = 0; // the road's direction tensor, length-weighted
  for (const [ax, az, bx, bz] of seg) {
    const l = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / (l || 1), uz = (bz - az) / (l || 1);
    dxx += ux * ux * l; dxz += ux * uz * l; dzz += uz * uz * l;
  }
  const roadAng = Math.atan2(2 * dxz, dxx - dzz) / 2, roadDir = [Math.cos(roadAng), Math.sin(roadAng)];

  // Converted parcels come in groups (the woods they were cut from), and convert over the years. The view frames the
  // ones converting next (from the shown year: the next year with conversions and the one after it, or all of them once
  // none are left), then of those the biggest group by area and any group near it: one place to look, close enough to
  // watch the conversions happen.
  const centre = z => { const p = ringPts(z.ring); return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]; };
  const group = z => z.tags.find(t => t.startsWith('wood')) ?? z.id;
  function changesView(all) {
    const t = run.result.timeline, step = simClock.get().shown?.step ?? 0;
    const yearOf = z => t.findIndex(y => y.zoneStates[z.id] !== z.state);
    const upcoming = all.filter(z => yearOf(z) > step), first = Math.min(...upcoming.map(yearOf));
    const list = upcoming.length ? upcoming.filter(z => yearOf(z) <= first + 1) : all;
    const groups = new Map();
    for (const z of list) { const g = groups.get(group(z)) ?? { zones: [], acres: 0 }; g.zones.push(z); g.acres += z.areaAcres; groups.set(group(z), g); }
    const found = [...groups.values()].map(g => ({ ...g, c: g.zones.map(centre).reduce((a, p) => [a[0] + p[0] / g.zones.length, a[1] + p[1] / g.zones.length], [0, 0]) }));
    const top = found.reduce((a, b) => (b.acres > a.acres ? b : a));
    const near = found.filter(g => Math.hypot(g.c[0] - top.c[0], g.c[1] - top.c[1]) < CLUSTER_M);
    const zs = near.flatMap(g => g.zones);
    return { ...frame(zs.flatMap(z => ringPts(z.ring)), null, CLOSEST), until: upcoming.length ? Math.max(...zs.map(yearOf)) : Infinity }; // nothing left to follow
  }
  // The parcels a forecast converts by its last year.
  const converted = run => { const last = run.result.timeline.at(-1).zoneStates; return zones.filter(z => last[z.id] !== z.state); };

  let run = null, flight = null, saved = null, current = null, currentZones = null, until = Infinity; // until: the framed parcels' last conversion year
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function go(focus, ids, again = false) {
    if (focus === current && ids === currentZones && !again) return;
    let to = null;
    if (focus === 'road') to = frame(roadPts, roadDir);
    else if (focus === 'changes') {
      const list = ids ? zones.filter(z => ids.includes(z.id)) : run ? converted(run) : [];
      if (list.length && run) { to = changesView(list); until = to.until; }
    }
    current = focus; currentZones = ids;
    if (to) {
      saved ??= { x: view.target.x, z: view.target.z, level: view.level, azimuth: azGoal };
      view.rotate(to.turn);
      view.zoomTo(to.level);
      flight = { x0: view.target.x, z0: view.target.z, x1: to.x, z1: to.z, p: 0 };
    } else if (!focus && saved) {
      const back = saved;
      saved = null;
      view.rotate(Math.round((back.azimuth - azGoal) / (Math.PI / 2)));
      view.zoomTo(back.level);
      flight = { x0: view.target.x, z0: view.target.z, x1: back.x, z1: back.z, p: 0 };
    }
  }
  scenario.subscribe(s => go(s.focus, s.focusZones));
  onFrame(dt => { // real time: the camera moves while the sim is paused
    if (!flight) return;
    flight.p = still ? 1 : Math.min(1, flight.p + dt * 1000 / FLY_MS);
    const p = flight.p, e = p < .5 ? 2 * p * p : 1 - (2 - 2 * p) ** 2 / 2;
    view.lookAt(flight.x0 + (flight.x1 - flight.x0) * e, flight.z0 + (flight.z1 - flight.z0) * e);
    if (p === 1) flight = null;
  });

  // Flying on its own: to the parcels a newly applied card with zone rules converts, once its forecast is on screen,
  // and to the changes when Play starts with the view free.
  let cardIds = new Set(), pending = false, pendingFrom = null, playing = false;
  scenario.subscribe(s => {
    const ids = new Set(s.cards.map(c => c.id));
    if (s.cards.some(c => !cardIds.has(c.id) && c.zoneRules?.length)) { pending = true; pendingFrom = run; } // compared with the forecast before
    cardIds = ids;
  });
  simClock.subscribe(({ shown, playing: now }) => {
    if (shown?.data && shown.data.run !== run) {
      run = shown.data.run;
      if (pending && run !== pendingFrom) {
        pending = false;
        const before = pendingFrom?.result.timeline.at(-1).zoneStates, after = run.result.timeline.at(-1).zoneStates;
        const added = converted(run).filter(z => !before || before[z.id] !== after[z.id]).map(z => z.id);
        if (added.length) scenario.set({ focus: 'changes', focusZones: added });
      }
    }
    if (now && !playing && !scenario.get().focus && run && converted(run).length) scenario.set({ focus: 'changes', focusZones: null });
    // Following the changes: once the framed parcels have all converted, on to the next ones.
    if (now && current === 'changes' && shown && shown.step >= until && !flight) {
      until = Infinity;
      const { focus, focusZones } = scenario.get();
      go(focus, focusZones, true);
    }
    playing = now;
  });
  return { converted: () => (run ? converted(run) : []) };
}
