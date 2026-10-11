// Guided views: the camera frames 15-501 or the land the policies convert, and goes back to where it was.
// scenario.focus is null, 'road' or 'changes'; scenario.focusZones narrows 'changes' to some parcels (null: every
// parcel the forecast converts). The panel's buttons set it, and so does this module: when a card with zone rules is
// applied it frames the parcels that card converts, and when Play starts it frames the changes if the view is free.
// Moving between the two views keeps the place to go back to.
import { scenario, simClock, onFrame } from './scenario.js';
import { ZOOMS, PIXEL_SCALE, CAMERA, LOD } from '../world/palette.js';
import { CONSTRUCT } from './zone-layer.js';
import { KINDS } from '../../shared/effects.js';

// "Show changes" tours every change: the new neighbourhoods first (followed as they convert), then each group of what
// policies put on the street (effects-layer.js), framed where most of its items stand. A caption names the stop, the
// cards behind it and how much there is now and by the forecast's end; its arrows step through, and it moves on by
// itself every TOUR_S seconds until they are used.
const GROUPS = [
  ['Protected bike lanes and cyclists', ['bikeLanes', 'bikeRacks']],
  ['More buses and bus stops', ['busStops', 'busLanes']],
  ['Shops opening', ['shops', 'grandOpening']],
  ['Jobs', ['hiring', 'training']],
  ['Homes changing hands', ['homeSales']],
  ['Building', ['construction', 'upzone', 'fastTrack', 'affordable']],
  ['Parking', ['parking', 'parkingLots']],
  ['Town projects', ['civicWorks', 'civicDone']],
  ['Help for households', ['aid']],
  ['Protected forest', ['protect']],
];
const TOUR_S = 7;

const FLY_MS = 1400, FOLLOW_MS = 600; // a guided view's flight; moving on to the next conversions, quicker so it arrives in time
const CLOSEST = 5; // the closest zoom level a change view takes (1x), so the parcels keep their surroundings
// The farthest a change view goes: every sprite layer draws here (trees, stumps and scaffolds, shrubs, street furniture)
// and building detail, well clear of the far-out fills (below LOD.macro).
const SPRITE_LEVEL = ZOOMS.findIndex(z => z >= LOD.furniture);
const SIGN_LEVEL = ZOOMS.findIndex(z => z >= 5); // a tour stop on the street: close enough to read its signs
const SIN_EL = Math.sin(CAMERA.elevationDeg * Math.PI / 180);
const right = az => [Math.cos(az), -Math.sin(az)], fwd = az => [-Math.sin(az), -Math.cos(az)]; // on the ground, as the camera sees it
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const ringPts = ring => ring.flatMap((v, i) => (i % 2 ? [] : [[v, ring[i + 1]]]));

export function mountFocus({ world, osm, zones }) {
  const { view } = world, dom = view.renderer.domElement, E = osm.ext;
  let azGoal = view.azimuth;
  view.onChange(({ azimuth }) => { azGoal = azimuth; });

  // A view of points: turned a quarter if that lays dir more across the screen, at the closest zoom level that fits
  // them (no closer than maxLevel, no farther than minLevel), centred in the part of the screen the sim panel leaves free.
  function frame(pts, dir, maxLevel = ZOOMS.length - 1, minLevel = 0, forceTurn = null) {
    const turn = forceTurn ?? (dir && Math.abs(dot(dir, right(azGoal + Math.PI / 2))) > Math.abs(dot(dir, right(azGoal))) + .1 ? 1 : 0), az = azGoal + turn * Math.PI / 2;
    const R = right(az), F = fwd(az), range = axis => { const v = pts.map(p => dot(p, axis)); return [Math.min(...v), Math.max(...v)]; };
    const [r0, r1] = range(R), [f0, f1] = range(F), mr = (r0 + r1) / 2, mf = (f0 + f1) / 2; // the frame's centre, in view axes
    const w = dom.clientWidth, h = dom.clientHeight, plate = document.querySelector('.plate.sim')?.getBoundingClientRect();
    const free = plate && plate.width && plate.left > w / 2 ? plate.left : w; // the map left of the panel
    let level = 0;
    ZOOMS.forEach((z, i) => { const k = z * PIXEL_SCALE; if (i <= maxLevel && (r1 - r0) * k <= free * .9 && (f1 - f0) * SIN_EL * k <= h * .8) level = i; });
    const fits = level >= minLevel;
    level = Math.max(level, minLevel);
    const shift = (w / 2 - free / 2) / (ZOOMS[level] * PIXEL_SCALE);
    return { x: R[0] * (mr + shift) + F[0] * mf, z: R[1] * (mr + shift) + F[1] * mf, level, turn, fits };
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

  // Converted parcels come in groups (the woods they were cut from) and convert over the years. A change view takes the
  // parcels converting next (from the shown year: the next year with conversions, or all of them once none are left)
  // and finds the window at SPRITE_LEVEL or closer that holds the most of them by area: from each in turn, it adds the
  // rest nearest first while they still fit, and keeps the best. Then it adds the following year's parcels that fit.
  // So the zone layer's trees, stumps, scaffolds and houses are big enough to watch, never its far-out fills, and the
  // other parcels get their turn as the years play (the follow, below).
  const centre = z => { const p = ringPts(z.ring); return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function changesView(all, following) {
    const t = run.result.timeline, step = simClock.get().shown?.step ?? 0;
    const yearOf = z => t.findIndex(y => y.zoneStates[z.id] !== z.state);
    const upcoming = all.filter(z => yearOf(z) > step), first = Math.min(...upcoming.map(yearOf));
    if (following && !upcoming.length) return null; // all done: stay on the last ones
    const list = upcoming.length ? upcoming.filter(z => yearOf(z) === first) : all;
    const extend = (zs, pts, pool, at) => { // adds what of pool still fits, nearest to `at` first
      for (const z of pool.sort((a, b) => dist(centre(a), at) - dist(centre(b), at))) {
        const more = pts.concat(ringPts(z.ring));
        if (frame(more, null, CLOSEST, SPRITE_LEVEL).fits) { zs.push(z); pts = more; }
      }
      return { zs, pts, acres: zs.reduce((a, z) => a + z.areaAcres, 0) };
    };
    const seeds = [...list].sort((a, b) => b.areaAcres - a.areaAcres).slice(0, 40); // ponytail: the 40 biggest are plenty of starts
    const best = seeds.map(seed => extend([seed], ringPts(seed.ring), list.filter(z => z !== seed), centre(seed))).reduce((a, b) => (b.acres > a.acres ? b : a));
    const { zs, pts } = extend(best.zs, best.pts, upcoming.filter(z => yearOf(z) === first + 1), centre(best.zs[0]));
    return { ...frame(pts, null, CLOSEST, SPRITE_LEVEL), until: upcoming.length ? Math.max(...zs.map(yearOf)) : Infinity }; // nothing left to follow
  }
  // The parcels a forecast converts by its last year.
  const converted = run => { const last = run.result.timeline.at(-1).zoneStates; return zones.filter(z => last[z.id] !== z.state); };

  // The tightest view at SIGN_LEVEL or closer that holds the most of these points: from each of up to 30 seeds, the
  // rest are added nearest first while they still fit, and the fullest view wins.
  function clusterView(pts) {
    const k = Math.ceil(pts.length / 30), seeds = pts.filter((_, i) => i % k === 0);
    let best = [pts[0]];
    for (const s of seeds) {
      let set = [s];
      for (const p of [...pts].sort((a, b) => dist(a, s) - dist(b, s))) {
        if (p === s) continue;
        const more = set.concat([p]);
        if (frame(more, null, CLOSEST, SIGN_LEVEL).fits) set = more;
      }
      if (set.length > best.length) best = set;
    }
    if (best.length === 1) best.push([best[0][0] + 12, best[0][1] + 12]);
    // Turn to the quarter that sees the most door fronts (signs stand by doors): a door faces the camera when it looks
    // out against the camera's forward direction.
    const faces = best.filter(p => p.length > 3), face = [faces.reduce((a, p) => a + p[2], 0), faces.reduce((a, p) => a + p[3], 0)];
    let turn = 0;
    if (faces.length) for (let k = 1; k < 4; k++) if (dot(face, fwd(azGoal + k * Math.PI / 2)) < dot(face, fwd(azGoal + turn * Math.PI / 2)) - .5) turn = k;
    return frame(best, null, CLOSEST, SIGN_LEVEL, turn);
  }
  const fx = () => run?.effects ?? null;
  const fraction = k => k === 'bikeLanes' || k === 'busLanes';
  // The tour's stops for this forecast: what stands in the shown year, or for groups with nothing up yet, where their
  // items will stand by the forecast's end.
  function tourStops() {
    const out = [];
    if (run && converted(run).length) out.push({ parcels: true, title: 'New neighbourhoods', kinds: [] });
    const rows = fx();
    if (!rows || !world.effects) return out;
    const step = simClock.get().shown?.step ?? 0, end = rows.length - 1;
    for (const [title, kinds] of GROUPS) {
      const live = kinds.filter(k => rows[end]?.[k]?.i || rows[step]?.[k]?.i);
      if (!live.length) continue;
      const row = live.some(k => rows[step]?.[k]?.i) ? rows[step] : rows[end];
      const pts = world.effects.points(live, row);
      if (pts.length) out.push({ title, kinds: live, pts });
    }
    return out;
  }
  const yearLabel = y => 2026 + y;
  // The caption: which stop, the cards behind it, and how much stands now and by the end.
  const caption = document.createElement('div');
  caption.className = 'fx-tour'; caption.hidden = true; caption.setAttribute('role', 'status'); caption.setAttribute('aria-live', 'polite');
  Object.assign(caption.style, { position: 'fixed', zIndex: 30, left: '50%', top: 'calc(78px + env(safe-area-inset-top, 0px))', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px', maxWidth: 'min(620px, calc(100vw - 32px))', font: '13px var(--ae-body, sans-serif)', color: '#1c2c5e',
    background: '#ffffff', border: '3px solid #1c2c5e', borderRadius: '10px', boxShadow: '0 3px 0 rgba(28,44,94,.45)' });
  const arrow = (label, d) => Object.assign(document.createElement('button'), { type: 'button', className: 'tool-btn', textContent: d < 0 ? '◀' : '▶', ariaLabel: label,
    onclick: () => { auto = false; step(d); } });
  const prev = arrow('Previous change', -1), next = arrow('Next change', 1), text = document.createElement('div');
  text.style.flex = '1';
  caption.append(prev, text, next);
  caption.style.display = 'none';
  document.body.append(caption);
  function describe(stop) {
    const rows = fx(), sh = simClock.get().shown?.step ?? 0, end = rows ? rows.length - 1 : 0;
    const head = document.createElement('strong');
    head.style.font = '600 14px var(--ae-pixel, monospace)';
    head.textContent = `${tourAt + 1}/${tour.length} · ${stop.title}`;
    let sub = '';
    if (stop.parcels) sub = 'Land the policies convert, built year by year.';
    else {
      const by = [...new Map(stop.kinds.flatMap(k => run.attribution?.[k] ?? []).map(c => [c.id, c])).values()].map(c => c.title).join(', ');
      const amount = row => stop.kinds.reduce((s, k) => s + (fraction(k) ? 0 : row?.[k]?.n ?? 0), 0);
      const paint = stop.kinds.find(fraction), share = row => Math.round(Math.max(0, row?.[paint]?.i ?? 0) * 100);
      const amountNow = row => amount(row) + (paint ? share(row) : 0); // anything standing in that year
      const now = paint ? `${share(rows[sh])}% painted` : `${amount(rows[sh])}`, then = paint ? `${share(rows[end])}%` : `${amount(rows[end])}`;
      sub = `${by ? `${by}. ` : ''}Now ${now}; by ${yearLabel(end)}, ${then}.${amountNow(rows[sh]) ? '' : ' Shown faded until they are built: press Play to watch them appear.'}`;
    }
    const line = document.createElement('div');
    line.textContent = sub;
    text.replaceChildren(head, line);
    prev.disabled = next.disabled = tour.length < 2;
  }
  let tour = null, tourAt = 0, auto = true, dwell = 0, describedAt = -1;
  function stopView(following) {
    const stop = tour[tourAt];
    world.effects?.highlight(stop.parcels ? null : stop.kinds, fx()?.at(-1)); // pins over its items (and faded ones still to come), through the roofs
    describe(stop);
    if (stop.parcels) { const to = changesView(converted(run), following); until = to?.until ?? Infinity; return to; }
    until = Infinity;
    return clusterView(stop.pts);
  }
  function step(d) {
    if (!tour?.length) return;
    tour = tourStops(); // the forecast or the year may have moved on
    if (!tour.length) return;
    tourAt = ((tourAt + d) % tour.length + tour.length) % tour.length;
    dwell = 0;
    fly(stopView(false), FLY_MS);
  }
  function fly(to, ms) {
    if (!to) return;
    saved ??= { x: view.target.x, z: view.target.z, level: view.level, azimuth: azGoal };
    view.rotate(to.turn);
    view.zoomTo(to.level);
    flight = { x0: view.target.x, z0: view.target.z, x1: to.x, z1: to.z, p: 0, ms };
  }

  let run = null, flight = null, saved = null, current = null, currentZones = null, until = Infinity; // until: the framed parcels' last conversion year
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function go(focus, ids, again = false) { // again: moving on to the next conversions
    if (focus === current && ids === currentZones && !again) return;
    let to = null;
    if (focus === 'road') to = frame(roadPts, roadDir);
    else if (focus === 'changes' && !ids) { // the tour
      if (!again) { tour = tourStops(); tourAt = 0; dwell = 0; auto = true; }
      if (tour?.length) to = stopView(again);
    } else if (focus === 'changes') {
      const list = zones.filter(z => ids.includes(z.id));
      if (list.length && run) { to = changesView(list, again); until = to?.until ?? Infinity; }
    }
    if (focus !== 'changes' || ids) { tour = null; world.effects?.highlight(null); }
    caption.hidden = !tour?.length; caption.style.display = tour?.length ? 'flex' : 'none'; // its inline flex would beat [hidden]
    current = focus; currentZones = ids;
    if (to) fly(to, again ? FOLLOW_MS : FLY_MS);
    else if (!focus && saved) {
      const back = saved;
      saved = null;
      view.rotate(Math.round((back.azimuth - azGoal) / (Math.PI / 2)));
      view.zoomTo(back.level);
      flight = { x0: view.target.x, z0: view.target.z, x1: back.x, z1: back.z, p: 0, ms: FLY_MS };
    }
  }
  scenario.subscribe(s => go(s.focus, s.focusZones));
  onFrame(dt => { // real time: the camera moves while the sim is paused
    if (tour?.length > 1 && auto && !flight && (dwell += dt) > TOUR_S) step(1); // the tour moves on by itself
    if (!flight) return;
    flight.p = still ? 1 : Math.min(1, flight.p + dt * 1000 / flight.ms);
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
  simClock.subscribe(({ shown, frac, playing: now }) => {
    if (shown?.data && shown.data.run !== run) {
      run = shown.data.run;
      if (pending && run !== pendingFrom) {
        pending = false;
        const before = pendingFrom?.result.timeline.at(-1).zoneStates, after = run.result.timeline.at(-1).zoneStates;
        const added = converted(run).filter(z => !before || before[z.id] !== after[z.id]).map(z => z.id);
        if (added.length) scenario.set({ focus: 'changes', focusZones: added });
      }
    }

    // Play follows the new neighbourhoods by itself; the tour of every change (and its caption) is the button's alone
    if (now && !playing && !scenario.get().focus && run && converted(run).length) scenario.set({ focus: 'changes', focusZones: converted(run).map(z => z.id) });
    if (tour && shown && !caption.hidden && shown.step !== describedAt) { describedAt = shown.step; describe(tour[tourAt]); } // the counts move with the year
    // Following the changes: once the framed parcels have all converted (their year's construction is done), on to
    // the next ones.
    if (now && current === 'changes' && (!tour || tour[tourAt]?.parcels) && shown && (shown.step > until || (shown.step === until && frac >= CONSTRUCT)) && !flight) {
      until = Infinity;
      const { focus, focusZones } = scenario.get();
      go(focus, focusZones, true);
    }
    playing = now;
  });
  return { converted: () => (run ? converted(run) : []) };
}
