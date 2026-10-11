// Street life on the road and walking networks (roadnet.js): signals, vehicles and pedestrians, advanced in
// fixed steps so every playback speed applies the same rules. Pure: no three.js, no DOM.
//
// Signals run two phase groups, green → yellow → all-red, never both green. Walk signals light for the
// crosswalks parallel to the green traffic, then flash don't-walk with time to finish, and the all-red holds
// until walkers who are still crossing have reached the kerb.
//
// Vehicles follow the car ahead (IDM), stop at stop lines, decide on yellow by stopping distance, and commit to
// a movement only when it is clear: no conflicting movement occupied or committed, room on the exit lane for
// the whole car, nobody on or waiting at the crosswalks it passes, and (turning left or on a minor approach)
// no oncoming car with priority about to arrive. Once committed a car never stops inside the intersection
// except for a walker on the crosswalk ahead.
//
// Pedestrians are individuals with a persistent id, a destination, an A* route over sidewalks, crosswalks and
// paths, a walking speed and a state: walking, approaching (a crossing), waiting, crossing or arriving. They
// keep right, sidestep each other and street furniture (spatial hash), wait at the kerb, and step out only on
// a walk signal (or into a clear gap at an unsignalized crossing).
//
// Most walkers wander between random doors. Walkers the caller adds (addPed: the sim's households, see households.js)
// go only where they are sent (sendPed), and stand still in between. A long trip shows its two ends only: past
// SHOW_M from the start the walker steps out of sight and comes back SHOW_M short of the goal, so a day's commute
// fits a short real-time day.
import { findRoute } from './roadnet.js';
import { seeded } from './palette.js';

export const STEP = 1 / 20;            // seconds of simulated time per fixed step
const MAX_STEPS = 16;                  // per frame; beyond this the sim runs slow rather than skip checks
const A_MAX = 2.2, B_COMF = 3, B_MAX = 8, T_HEAD = 1.1, S_MIN = 2;
const YELLOW = 3.5, ALL_RED = 2, HOLD_MAX = 30;
export const WALK_TIME = 7, CLEAR_SPEED = 1.0; // walk signal, and the slowest pace the flashing don't-walk allows for
const PED_R = .28;                     // personal radius (m)
export const SHOW_M = 25;              // a sent trip longer than twice this shows only this much at each end: ~20 s of walking
const HIDE_S = 2;                      // seconds out of sight between a trip's two ends
const W_TURN = { S: 4, R: 1.4, L: 1.1, U: .15 }; // how often cars go straight, turn right, left or U-turn

export const VEHICLE_TYPES = [ // kind, share, length, width, speed factor
  ['car', .62, 4.4, 1.8, 1], ['pickup', .12, 5.2, 1.9, 1], ['van', .1, 5, 2, .95], ['truck', .06, 7, 2.4, .85], ['bus', .1, 11, 2.5, .8],
];

export function createStreetSim({ net, walk, seed = 11, doors = [], obstacles = [], onRoad = () => false, vehicleDensity = 1, pedDensity = 1, maxPeds = 4200 }) {
  const r = seeded(seed);
  const tmp = {}, tmp2 = {};
  let stepNo = 0, time = 0, acc = 0;
  const violations = { conflictingGreen: 0, redEntry: 0, walkOnRed: 0, pedOnRoad: 0, overlap: 0, pedHit: 0 };

  // ---------- signals ----------
  const signals = [];
  for (const ix of net.intersections) {
    const s = ix.signal;
    if (!s) continue;
    const walkLen = g => Math.max(0, ...ix.crosswalks.filter(c => c.arm.group !== g).map(c => c.len)); // crosswalks that walk with group g
    s.ix = ix;
    s.green = [0, 1].map(g => Math.max(g === s.mainGroup ? 24 : 16, WALK_TIME + walkLen(g) / CLEAR_SPEED + 2));
    s.phases = [['G', 0], ['Y', 0], ['R', 1], ['G', 1], ['Y', 1], ['R', 0]]; // all-red names the group that goes next
    s.phase = Math.floor(r() * 6); s.t = r() * phaseDur(s, s.phase); s.hold = 0;
    signals.push(s);
    updateWalk(s);
  }
  function phaseDur(s, i) { const [k, g] = s.phases[i]; return k === 'G' ? s.green[g] : k === 'Y' ? YELLOW : ALL_RED; }
  function signalState(s, g) { const [k, pg] = s.phases[s.phase]; return k === 'R' || pg !== g ? 'R' : k; }
  function updateWalk(s) {
    const [k, pg] = s.phases[s.phase];
    for (const cw of s.ix.crosswalks) cw.walk = k === 'G' && pg !== cw.arm.group ? (s.t < WALK_TIME ? 'WALK' : 'FDW') : 'DW';
  }
  function stepSignal(s, dt) {
    s.t += dt;
    for (let guard = 0; guard < 3; guard++) {
      const dur = phaseDur(s, s.phase), [k, next] = s.phases[s.phase];
      if (s.t < dur) break;
      // Clearance: anyone still on a crosswalk that the next green drives over gets to finish first.
      if (k === 'R' && s.hold < HOLD_MAX && s.ix.crosswalks.some(c => c.arm.group === next && c.peds.size)) { s.hold += dt; s.t = dur; break; }
      s.t -= dur; s.phase = (s.phase + 1) % 6; s.hold = 0;
    }
    updateWalk(s);
    if (signalState(s, 0) !== 'R' && signalState(s, 1) !== 'R') violations.conflictingGreen++;
  }

  // ---------- vehicles ----------
  for (const L of net.lanes) { L.boxCars = []; L.uturnIn = []; L.linkIn = []; L.trap = L.to ? !L.moves.length : !L.next.length && !L.reverse; }
  for (const L of net.lanes) for (const T of L.next) T.linkIn.push(L);
  for (const L of net.lanes) if (!L.to && !L.next.length && L.reverse) { // dead end: a U-turn loop onto the other lane
    // Turn inside the street: leave a few metres before its end and rejoin a few metres along the other lane.
    const R = L.reverse, back = Math.min(5, L.len * .4), backR = Math.min(5, R.len * .4);
    const a = L.path.at(L.len - back, {}), b = R.path.at(backR, {});
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, bulge = Math.max(.5, Math.min(back, backR) - .6);
    L.uturn = { uturn: true, ix: null, from: L, to: R, fromS: L.len - back, toS: backR, path: null, len: 0, cars: [], committed: new Set(), conflicts: [], crossings: [], turn: 'U' };
    const pathPts = [a.x, a.z];
    for (let i = 1; i < 10; i++) { const t = i / 10, ang = Math.PI * t; pathPts.push(cx + (a.x - cx) * Math.cos(ang) + a.ux * bulge * Math.sin(ang), cz + (a.z - cz) * Math.cos(ang) + a.uz * bulge * Math.sin(ang)); }
    pathPts.push(b.x, b.z);
    L.uturn.path = new (L.path.constructor)(pathPts); L.uturn.len = L.uturn.path.len;
    R.uturnIn.push(L.uturn);
  }
  const drivable = net.lanes.filter(L => !L.trap && L.stopS - L.s0 > 20);
  const vehicles = [];
  for (const L of drivable) {
    const per = (L.edge.major ? 34 : 140) / vehicleDensity;
    let n = Math.round((L.stopS - L.s0) / per + r() - .5);
    const spots = [];
    for (let k = 0; k < n * 3 && spots.length < n; k++) {
      let pick = r(), t = VEHICLE_TYPES[0];
      for (const ty of VEHICLE_TYPES) if ((pick -= ty[1]) <= 0) { t = ty; break; }
      if (t[0] === 'bus' && !L.edge.major) t = VEHICLE_TYPES[0];
      const s = L.s0 + t[2] + 2 + r() * (L.stopS - L.s0 - t[2] - 12); // clear of the lane ends
      if (spots.every(o => Math.abs(o.s - s) > (o.t[2] + t[2]) / 2 + 6)) spots.push({ s, t });
    }
    spots.sort((a, b) => b.s - a.s);
    for (const { s, t } of spots) {
      const c = { id: vehicles.length, kind: t[0], L: t[2], W: t[3], vk: t[4] * r.range(.9, 1.1), v: 0, s, seg: L, onMove: false, next: null, prev: null, committed: false, yellowGo: false, stopped: false, pend: null, pendMove: null, x: 0, z: 0, h: 0, px: 0, pz: 0, ph: 0, stamp: -1, wait: 0 };
      L.cars.push(c); vehicles.push(c); chooseNext(c, L);
    }
  }
  const lastOf = a => a[a.length - 1];
  function chooseNext(c, L) {
    c.committed = false; c.yellowGo = false; c.stopped = false; c.wait = 0;
    if (L.to) {
      let opts = L.moves.filter(m => !m.to.trap);
      if (!opts.length) opts = L.moves;
      let tot = opts.reduce((s, m) => s + W_TURN[m.turn], 0), pick = r() * tot;
      c.next = opts.find(m => (pick -= W_TURN[m.turn]) <= 0) ?? opts[0] ?? null;
    } else if (L.next.length) c.next = r.pick(L.next);
    else c.next = L.uturn ?? null;
  }
  const idm = (v, v0, gap, dv, sMin = S_MIN) => {
    const sStar = sMin + Math.max(0, v * T_HEAD + v * dv / (2 * Math.sqrt(A_MAX * B_COMF)));
    return A_MAX * (1 - (v / Math.max(v0, .1)) ** 4 - (sStar / Math.max(gap, .05)) ** 2);
  };
  const free = (v, v0) => A_MAX * (1 - (v / Math.max(v0, .1)) ** 4);
  const isMove = n => n && n.path && n.cars && n.from; // a movement or a U-turn loop (lanes have no .from)

  function signalOf(m) { return m.ix?.signal ?? null; }
  function outranks(k, m, L) { // does movement k go before movement m?
    if (signalOf(m)) return (m.turn === 'L' || m.turn === 'U') && (k.turn === 'S' || k.turn === 'R');
    if (k.from.priority && !L.priority) return true;
    if (k.from.priority === L.priority) return (m.turn === 'L' || m.turn === 'U') && k.turn !== 'L' && k.turn !== 'U';
    return false;
  }
  const cwBusy = cw => cw && (cw.peds.size > 0 || cw.waiting.size > 0);
  // Room on exit lane T for the whole car, counting cars already committed to it. An empty lane always admits one.
  function hasRoom(T, c) {
    const last = lastOf(T.cars);
    const room = last ? last.s - last.L - T.s0 : T.to || !T.next.length ? T.stopS - T.s0 + 1 : 1e9;
    return room - T.reserved >= c.L + 1.5 || (T.reserved === 0 && !last);
  }
  function mayProceed(c, L, m, d) {
    const sig = signalOf(m);
    if (sig) {
      const st = signalState(sig, m.group);
      if (st === 'R') { c.why = 'red'; c.blocker = null; return false; }
      if (st === 'Y' && !c.yellowGo) { if (c.v * c.v / (2 * B_COMF) < d - .5) { c.why = 'red'; return false; } c.yellowGo = true; }
    } else if (L.stopSign && !c.stopped) { c.why = 'stop'; c.blocker = null; return false; }
    if (!hasRoom(m.to, c)) { c.why = 'exit'; c.blocker = lastOf(m.to.cars); return false; }
    if (m.crossings.some(k => cwBusy(k.cw))) { c.why = 'crosswalk'; c.blocker = null; return false; }
    for (const k of m.conflicts) {
      if (k.cars.length || k.committed.size) { c.why = 'conflict'; c.blocker = k.cars[0] ?? [...k.committed][0]; return false; }
      if (!outranks(k, m, L)) continue;
      if (sig && signalState(sig, k.group) === 'R') continue;
      const f = k.from.cars[0];
      if (!f || f.next !== k) continue;
      if (f.committed) { c.why = 'yield'; c.blocker = f; return false; }
      const df = k.from.stopS - f.s;
      if (f.v > 1 && df < f.v * 4.5 + 4) { c.why = 'yield'; c.blocker = f; return false; } // arriving within ~4.5 s (a car stopped at its line is not coming yet)
    }
    c.why = null; c.blocker = null;
    return true;
  }
  // Crosswalks a committed car still covers, released once its rear is past each one.
  function releasePend(c) {
    if (!c.pend) return;
    const m = c.pendMove;
    const prog = c.onMove && c.seg === m ? c.s : !c.onMove && c.seg === m.to ? m.len + c.s - c.seg.s0 : !c.onMove && c.next === m ? c.s - c.seg.stopS : Infinity;
    c.pend = c.pend.filter(k => { if (prog - c.L > k.s1) { k.cw.cars.delete(c); return false; } return true; });
    if (!c.pend.length) c.pend = null;
  }
  function clearPend(c) { if (c.pend) for (const k of c.pend) k.cw.cars.delete(c); c.pend = null; }
  function commit(c, m) {
    c.committed = true; m.committed.add(c); m.to.reserved += c.L + 1.5;
    clearPend(c);
    c.pend = m.crossings.map(k => { k.cw.cars.add(c); return k; }); c.pendMove = m; // walkers hold back until this car has passed
    const sig = signalOf(m);
    if (sig && signalState(sig, m.group) === 'R') violations.redEntry++;
  }
  function respawn(c) { // a car that reached a lane with no way on: move it to an empty stretch elsewhere
    const L0 = c.seg;
    clearPend(c);
    L0.cars.splice(L0.cars.indexOf(c), 1);
    for (let k = 0; k < 50; k++) {
      const L = r.pick(drivable), last = lastOf(L.cars);
      if (!last || last.s - last.L > L.s0 + c.L + 8) { c.seg = L; c.s = L.s0 + c.L; c.v = 0; c.prev = null; c.startS = L.s0; L.cars.push(c); chooseNext(c, L); c.snap = true; return; }
    }
    L0.cars.push(c);
  }

  // Rear of the last car in lane T, or about to join it from a U-turn loop, measured from T's start (s = 0).
  function tailOf(T, except) {
    let best = null, at = Infinity;
    const last = lastOf(T.cars);
    if (last && last !== except) { best = last; at = last.s - last.L; }
    for (const u of T.uturnIn) for (const o of u.cars) if (o !== except && u.toS + o.s - u.len - o.L < at) { best = o; at = u.toS + o.s - u.len - o.L; }
    return best ? { car: best, at } : null;
  }
  function stepLaneCar(c, L, i, dt) {
    const v0 = L.speed * c.vk, n = c.next, move = isMove(n);
    const end = move ? (n.ix ? L.stopS : n.fromS) : L.len, d = end - c.s;
    let a = free(c.v, v0), limit = Infinity, limitV = 0; // limit: the furthest the front may reach this step
    const follow = (gap, o, sMin) => { a = Math.min(a, idm(c.v, v0, gap, c.v - o.v, sMin)); if (c.s + gap - .3 < limit) { limit = c.s + gap - .3; limitV = o.v; } };
    const lead = i > 0 ? L.cars[i - 1] : null;
    if (lead) follow(lead.s - lead.L - c.s, lead);
    else if (n) { // the car ahead may already be past the end of this lane
      if (move) {
        const ahead = n.ix ? L.boxCars : n.cars;
        let o = null;
        for (let k = ahead.length - 1; k >= 0; k--) { const b = ahead[k]; if (b.seg === n || b.s - b.L < 7) { o = b; break; } }
        if (o) follow(d + o.s - o.L, o);
        else { const t = tailOf(n.to); if (t) follow(d + n.len + t.at - (n.toS ?? n.to.s0), t.car); }
      } else { // through plain bends: look along the chain of lanes ahead, so a stopped car past a very short lane is seen in time
        let T = n, dist = d;
        for (let hop = 0; T && hop < 4; hop++) {
          const t = tailOf(T);
          if (t) { follow(dist + t.at, t.car); break; }
          dist += T.len;
          if (dist > 80 || T.next.length !== 1 || T.to) break;
          T = T.next[0];
        }
      }
    }
    if (move && n.ix) {
      if (!c.committed) {
        if (d < 3 && c.v < .3) c.stopped = true;
        let go = d < 40 && mayProceed(c, L, n, d);
        if (!go && c.why === 'exit' && c.wait > 25) { // the way ahead is jammed: try another exit with room
          const alt = L.moves.filter(m => m !== n && !m.to.trap && hasRoom(m.to, c));
          if (alt.length) { c.next = r.pick(alt); c.wait = 0; go = mayProceed(c, L, c.next, d); }
        }
        if (c.next !== n) return stepLaneCar(c, L, i, 0);
        if (go && d < c.v * c.v / (2 * B_COMF) + 3 + c.v * STEP * 2) commit(c, n);
        if (!c.committed) { a = Math.min(a, idm(c.v, v0, d - .3, c.v, .2)); limit = Math.min(limit, L.stopS); }
      }
      if (n.turn !== 'S' && d > 0) { const vt = n.turn === 'R' ? 5 : 6.5; if (c.v > vt) a = Math.min(a, (vt * vt - c.v * c.v) / (2 * Math.max(d, 1))); }
    } else if (move) { // U-turn at a dead end: crawl, and only go when the other lane has room and nobody is about to turn into it
      const R = n.to, t = tailOf(R, c);
      let clear = (!t || t.at > n.toS + 2) && !n.cars.some(o => o.s < c.L + 1);
      for (const F of R.linkIn) { const f = F.cars[0]; if (f && f.next === R && f.v > 1 && F.len - f.s < f.v * 5 + 6) clear = false; }
      if (!c.committed) {
        if (clear && d < 2) c.committed = true;
        else { a = Math.min(a, idm(c.v, v0, d - .3, c.v, .2)); limit = Math.min(limit, end); }
      }
      if (c.v > 3.5) a = Math.min(a, (12.25 - c.v * c.v) / (2 * Math.max(d, 1)));
    } else if (!n) { a = Math.min(a, idm(c.v, v0, d - .5, c.v, .2)); limit = Math.min(limit, end); }
    c.v = Math.max(0, c.v + Math.max(a, -B_MAX) * dt);
    c.s += c.v * dt;
    if (c.s > limit) { c.s = Math.max(limit, c.s - c.v * dt); c.v = Math.min(c.v, limitV); }
    releasePend(c);
    c.wait = c.v < .2 ? c.wait + dt : 0;

    if (c.s >= end) {
      if (move && c.committed) { // into the intersection (or the U-turn loop)
        L.cars.shift();
        if (n.ix) { n.committed.delete(c); L.boxCars.push(c); }
        n.cars.push(c);
        c.prev = { path: L.path, end }; c.seg = n; c.onMove = true; c.s -= end;
      } else if (n && !move) { // a plain bend onto the next lane
        L.cars.shift(); n.cars.push(c);
        clearPend(c); c.startS = 0;
        c.prev = { path: L.path, end: L.len }; c.seg = n; c.s -= L.len;
        chooseNext(c, n);
      } else if (!n && c.v < .5) respawn(c);
      else { c.s = end; c.v = 0; }
    } else if (!n && c.s >= end - 1 && c.v < .5) respawn(c); // a lane with no way on: reappear elsewhere
  }

  function stepMoveCar(c, m, dt) {
    const F = m.from, v0 = m.turn === 'S' ? F.speed * c.vk : m.turn === 'R' ? 5 : m.turn === 'U' ? 3.5 : 6.5;
    let a = free(c.v, v0), lead = null, gap = Infinity;
    const queue = m.ix ? F.boxCars : m.cars, i = queue.indexOf(c);
    for (let k = i - 1; k >= 0; k--) { const b = queue[k]; if (b.seg === m || b.s - b.L < 7) { lead = b; gap = b.s - b.L - c.s; break; } }
    if (!lead) { const t = tailOf(m.to, c); if (t) { lead = t.car; gap = m.len - c.s + t.at - (m.toS ?? m.to.s0); } }
    if (lead) a = Math.min(a, idm(c.v, v0, gap, c.v - lead.v));
    let limit = lead ? c.s + gap - .3 : Infinity;
    for (const k of m.crossings) if (k.s0 > c.s - .05 && k.cw.peds.size) { // yield to a walker on a crosswalk ahead
      a = Math.min(a, idm(c.v, v0, k.s0 - c.s - .3, c.v, .2)); limit = Math.min(limit, k.s0);
    }
    c.v = Math.max(0, c.v + Math.max(a, -B_MAX) * dt);
    c.s += c.v * dt;
    if (c.s > limit) { c.s = Math.max(limit, c.s - c.v * dt); c.v = Math.min(c.v, lead && limit === c.s ? lead.v : 0); }
    releasePend(c);
    c.wait = c.v < .2 ? c.wait + dt : 0;
    if (c.s >= m.len) {
      m.cars.splice(m.cars.indexOf(c), 1);
      if (m.ix) { F.boxCars.splice(F.boxCars.indexOf(c), 1); m.to.reserved = Math.max(0, m.to.reserved - c.L - 1.5); }
      const T = m.to;
      T.cars.push(c);
      c.startS = m.toS ?? T.s0;
      c.prev = { path: m.path, end: m.len }; c.seg = T; c.onMove = false; c.s = c.startS + (c.s - m.len);
      chooseNext(c, T);
    }
  }

  // Front, rear, centre and heading of a car, from its position along its path(s).
  function placeCar(c) {
    // The car's centre rides the path half a length behind its front, turned to the path's tangent there, so on
    // a curve the body stays on the carriageway instead of cutting the corner like a chord would.
    const seg = c.seg, start = c.onMove ? 0 : c.startS ?? seg.s0 ?? 0, mid = c.s - c.L / 2;
    let p;
    if (mid >= start || !c.prev) p = seg.path.at(mid, tmp);
    else p = c.prev.path.at(c.prev.end - (start - mid), tmp);
    if (mid < 0 && !c.prev) { const f = seg.path.at(0, tmp2); p = { x: f.x + f.ux * mid, z: f.z + f.uz * mid, ux: f.ux, uz: f.uz }; }
    c.x = p.x; c.z = p.z;
    c.h = Math.atan2(-p.uz, p.ux);
    const hl = c.L / 2;
    c.fx = p.x + p.ux * hl; c.fz = p.z + p.uz * hl; c.bx = p.x - p.ux * hl; c.bz = p.z - p.uz * hl;
  }

  // ---------- pedestrians ----------
  const wn = walk.nodes, bigComps = new Set(walk.compSizes.map((s, i) => [s, i]).filter(([s]) => s >= 30).map(([, i]) => i));
  const compNodes = new Map();
  for (const n of wn) if (bigComps.has(n.comp)) { if (!compNodes.has(n.comp)) compNodes.set(n.comp, []); compNodes.get(n.comp).push(n); }
  for (const cw of net.crosswalks) cw.waiting = new Set();
  // Destinations: building doors, each tied to the nearest walk node within reach.
  const doorsByComp = new Map();
  for (const d of doors) {
    let best = null, bd = 30 * 30;
    walk.near(d.x, d.z, 30, n => { if (!bigComps.has(n.comp) || n.kind === 'kerb') return; const dd = (n.x - d.x) ** 2 + (n.z - d.z) ** 2; if (dd < bd) { bd = dd; best = n; } });
    if (!best) continue;
    d.node = best;
    if (!doorsByComp.has(best.comp)) doorsByComp.set(best.comp, []);
    const list = doorsByComp.get(best.comp);
    for (let k = 0; k < (d.weight ?? 1); k++) list.push(d);
  }
  // Static obstacles: street furniture and tree trunks near the walks.
  const OB = 4, obHash = new Map();
  for (const o of obstacles) { const k = `${Math.floor(o.x / OB)},${Math.floor(o.z / OB)}`; if (!obHash.has(k)) obHash.set(k, []); obHash.get(k).push(o); }

  const peds = [];
  let nextId = 0;
  const walkEdges = walk.edges.filter(e => e.kind !== 'cross' && bigComps.has(e.a.comp));
  const weightOf = e => e.kind === 'side' ? (e.major ? 1 / 22 : 1 / 90) : e.kind === 'path' ? 1 / 28 : 1 / 60;
  for (const e of walkEdges) {
    let n = e.len * weightOf(e) * pedDensity;
    n = Math.floor(n) + (r() < n % 1 ? 1 : 0);
    for (let k = 0; k < n && peds.length < maxPeds; k++) {
      const t = r(), x = e.a.x + (e.b.x - e.a.x) * t, z = e.a.z + (e.b.z - e.a.z) * t, fwd = r() < .5;
      if (onRoad(x, z)) continue; // never appear in the roadway
      const p = {
        id: peds.length, look: Math.floor(r() * 1e6), x, z, px: x, pz: z, dx: 1, dz: 0, v: 0, vPref: r() < .08 ? r.range(.8, 1.05) : r.range(1.15, 1.6),
        state: 'walking', route: null, ri: 0, lat: 0, latGoal: 0, keep: r.range(.15, .45), spread: r.range(-1, 1), back: r.range(.15, .75),
        dest: null, linger: 0, cw: null, wait: 0, anim: r() * 4, comp: e.a.comp, node: fwd ? e.a : e.b, active: false, door: null, doorLeg: false,
        trips: 0, waitSpot: null, slow: 1,
      };
      p.route = wander(fwd ? e.b : e.a, fwd ? e.a : e.b, 6 + Math.floor(r() * 10));
      p.dest = { label: 'a stroll around the block', node: lastOf(p.route) };
      peds.push(p);
    }
  }
  nextId = peds.length;
  const pedEdge = (a, b) => a.adj.find(l => l.to === b)?.e;
  // A short random walk that does not double back (for walkers who have just appeared).
  function wander(start, from, steps) {
    const route = [start];
    let prev = from, cur = start;
    for (let k = 0; k < steps; k++) {
      const opts = cur.adj.filter(l => l.to !== prev && !(l.e.gate && !l.e.gate.open) && (l.e.kind !== 'cross' || r() < .5));
      if (!opts.length) break;
      const l = r.pick(opts);
      prev = cur; cur = l.to; route.push(cur);
    }
    return route;
  }

  // Trips: routed off the frame budget, a few at a time, so starting thousands of walkers never stalls a frame.
  const tripQueue = [];
  function planTrip(p) {
    if (p.owner != null) return planGoal(p); // owners are ids, and 0 is one
    const here = p.node, list = doorsByComp.get(here.comp), nodes = compNodes.get(here.comp);
    let goal = null, door = null;
    for (let k = 0; k < 10 && !goal; k++) {
      let cand, dd;
      if (list && r() < .7) { dd = r.pick(list); if (dd.gate && !dd.gate.open) { dd = null; continue; } cand = dd.node; } else cand = r.pick(nodes); // a door not built yet waits
      const dist = Math.hypot(cand.x - here.x, cand.z - here.z);
      if (cand !== here && dist > 50 && dist < 520) { goal = cand; door = dd ?? null; }
    }
    if (!goal) { p.route = wander(here, null, 10); p.ri = 0; p.dest = { label: 'a stroll around the block', node: lastOf(p.route) }; return; }
    const route = findRoute(walk, here, goal, 25000);
    if (!route) { p.route = wander(here, null, 10); p.ri = 0; p.dest = { label: 'a stroll around the block', node: lastOf(p.route) }; return; }
    p.route = route; p.ri = 0; p.trips++;
    p.door = door && Math.hypot(door.x - goal.x, door.z - goal.z) < 25 && clearPath(goal.x, goal.z, door.x, door.z) ? door : null;
    p.doorLeg = false;
    p.dest = { label: door ? door.label : 'a walk across town', node: goal, door };
  }
  // A sent walker's trip: routed to the walk node nearest its goal, then the last stretch to the goal itself (a door)
  // when it is close and off the road. No route (another network component): it steps out of sight and appears there.
  function planGoal(p) {
    const g = p.goal, goal = g && nearestNode(g.x, g.z, p.node.comp);
    p.goal = null;
    if (!g) return;
    const route = !goal ? null : goal === p.node ? [goal] : findRoute(walk, p.node, goal, 40000);
    p.dest = { label: g.label, node: goal ?? p.node, door: g };
    p.door = goal && Math.hypot(g.x - goal.x, g.z - goal.z) < 25 && clearPath(goal.x, goal.z, g.x, g.z) ? { x: g.x, z: g.z, label: g.label } : null;
    p.doorLeg = false; p.trips++;
    if (!route) { const n = goal ?? nearestNode(g.x, g.z); jump(p, n.x, n.z); p.node = n; p.comp = n.comp; arrive(p); return; }
    p.route = route; p.ri = 0;
    // only the ends of a long trip: walk SHOW_M, then skip to SHOW_M short of the end
    let len = 0;
    const at = [0];
    for (let i = 1; i < route.length; i++) at.push(len += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z));
    if (len > 2 * SHOW_M + 40) {
      const i1 = at.findIndex(d => d >= SHOW_M), i2 = at.findLastIndex(d => len - d >= SHOW_M);
      if (i1 > 0 && i2 > i1 + 1) p.skip = [i1, i2];
    }
  }
  // On a crosswalk, or anywhere in the road: a new destination waits until the walker is back on the sidewalk.
  const midCrossing = p => p.state === 'crossing' || p.cw?.peds.has(p) || onRoad(p.x, p.z);
  function send(p, x, z, label) {
    if (p.cw) { p.cw.waiting.delete(p); p.cw = null; }
    setState(p, 'walking');
    p.goal = { x, z, label }; p.dest = { label, node: p.node }; p.route = null; p.skip = null; p.doorLeg = false; p.linger = 0;
    if (!p.queued) { p.queued = true; tripQueue.push(p); }
  }
  function jump(p, x, z) { p.x = p.px = x; p.z = p.pz = z; p.hidden = HIDE_S; p.lat = p.latGoal = 0; }
  // The walk node nearest (x, z) on a big component (the given one if it has a node within reach).
  function nearestNode(x, z, comp) {
    for (const rad of [40, 160, 600, 3000]) {
      let best = null, bd = rad * rad;
      walk.near(x, z, rad, n => {
        if (!bigComps.has(n.comp) || n.kind === 'kerb' || (comp !== undefined && n.comp !== comp && rad < 600)) return;
        const d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d < bd) { bd = d; best = n; }
      });
      if (best) return best;
    }
    return null;
  }
  function clearPath(ax, az, bx, bz) { const l = Math.hypot(bx - ax, bz - az); for (let s = .5; s < l; s += .7) if (onRoad(ax + (bx - ax) * s / l, az + (bz - az) * s / l)) return false; return true; }
  function routeBudget(ms) {
    const t0 = performance.now();
    while (tripQueue.length && performance.now() - t0 < ms) { const p = tripQueue.shift(); p.queued = false; planTrip(p); if (p.route) p.state = 'walking'; }
  }

  // Can this walker step onto the crosswalk now?
  function mayCross(cw) {
    if (cw.signalized && cw.walk !== 'WALK') return false;
    if (cw.cars.size) return false; // a committed car has yet to pass
    for (const L of cw.feeders) {
      const f = L.cars[0];
      if (!f || !isMove(f.next) || !f.next.crossings.some(k => k.cw === cw)) continue;
      const d = L.stopS - f.s;
      if (f.v > .5 && d < f.v * f.v / (2 * B_COMF) + 3) return false; // could not stop in time
    }
    return true;
  }

  const PH = 2.5, phash = new Map();
  const hk = (x, z) => (Math.floor(x / PH) + 4096) * 8192 + Math.floor(z / PH) + 4096;
  let focus = null;
  function stepPeds(dt) {
    phash.clear();
    for (const p of peds) {
      p.active = !!focus && p.x > focus[0] && p.x < focus[2] && p.z > focus[1] && p.z < focus[3];
      if (!p.active) continue;
      const k = hk(p.x, p.z);
      let a = phash.get(k); if (!a) phash.set(k, a = []); a.push(p);
    }
    for (const p of peds) {
      stepPed(p, dt);
      // Last word: whatever avoidance did, a walker who is not on a crosswalk never ends a step in the roadway.
      if (p.state !== 'crossing' && (p.x !== p.px || p.z !== p.pz) && onRoad(p.x, p.z) && !onRoad(p.px, p.pz)) { p.x = p.px; p.z = p.pz; }
    }
  }
  function setState(p, s) {
    if (p.state === s) return;
    if (p.state === 'waiting' && p.cw) p.cw.waiting.delete(p);
    p.state = s;
  }
  function stepPed(p, dt) {
    p.px = p.x; p.pz = p.z;
    if (p.hidden > 0) { p.hidden -= dt; p.v = 0; return; } // between a long trip's two ends
    if (p.pendingSend && !midCrossing(p)) { const { x, z, label } = p.pendingSend; p.pendingSend = null; send(p, x, z, label); } // back on the kerb
    if (!p.route) {
      p.v = 0;
      if (p.linger > 0) p.linger -= dt;
      else if (!p.queued && (p.owner == null || p.goal)) { p.queued = true; tripQueue.push(p); } // sent walkers wait to be sent
      return;
    }
    const route = p.route;
    let tx, tz, half = .8, speed = p.vPref, ex = 0, ez = 0;
    if (p.doorLeg) { tx = p.door.x; tz = p.door.z; half = 1; }
    else {
      const T = route[p.ri], P = route[p.ri - 1];
      if (p.memoRi !== p.ri || p.memoRoute !== route) { // the edges either side of the next node, until it is reached
        p.memoRi = p.ri; p.memoRoute = route;
        p.memoE = P ? pedEdge(P, T) : null;
        p.memoCe = route[p.ri + 1] ? pedEdge(T, route[p.ri + 1]) : null;
      }
      const e = p.memoE;
      half = e ? e.half : .8;
      if (P) { const l = Math.hypot(T.x - P.x, T.z - P.z) || 1; ex = (T.x - P.x) / l; ez = (T.z - P.z) / l; }
      // About to cross?
      const N = route[p.ri + 1], ce = p.memoCe;
      const dT = Math.hypot(T.x - p.x, T.z - p.z);
      if (ce?.kind === 'cross' && p.state !== 'crossing') {
        const cw = ce.cw;
        if (dT < 1.4 || p.state === 'waiting') {
          if (mayCross(cw)) {
            cw.waiting.delete(p); setState(p, 'crossing'); p.cw = cw; cw.peds.add(p); p.ri++; p.waitSpot = null;
            if (cw.signalized && cw.walk !== 'WALK') violations.walkOnRed++;
            return stepPed2(p, dt, route[p.ri], route[p.ri - 1], ce.half, p.vPref * 1.12);
          }
          if (p.state !== 'waiting') { setState(p, 'waiting'); p.cw = cw; }
          if (!cw.signalized || cw.walk === 'WALK') cw.waiting.add(p); else cw.waiting.delete(p);
          if (!p.waitSpot) { // spread along the kerb instead of piling onto one point
            const ux = (N.x - T.x) / (ce.len || 1), uz = (N.z - T.z) / (ce.len || 1);
            p.waitSpot = [T.x - ux * p.back * .8 - uz * p.spread * .7, T.z - uz * p.back * .8 + ux * p.spread * .7]; // a step back from the kerb
            for (let k = .6; onRoad(p.waitSpot[0], p.waitSpot[1]) && k <= 3; k += .6) p.waitSpot = [T.x - ux * k, T.z - uz * k]; // skewed corners: step back off the road
          }
          const [wx, wz] = p.waitSpot, dw = Math.hypot(wx - p.x, wz - p.z);
          p.wait += dt;
          if (dw > .08) { const sp = Math.min(p.vPref * .6, dw / dt); p.x += (wx - p.x) / dw * sp * dt; p.z += (wz - p.z) / dw * sp * dt; p.v = sp; turnTo(p, (wx - p.x) / dw, (wz - p.z) / dw, dt); }
          else { p.v = 0; turnTo(p, (N.x - T.x) / (ce.len || 1), (N.z - T.z) / (ce.len || 1), dt); }
          separate(p, dt);
          return;
        }
        if (dT < 8) setState(p, 'approaching'), speed *= .9;
      }
      if (p.state === 'crossing') speed = p.vPref * 1.12;
      return stepPed2(p, dt, T, P, half, speed, ex, ez);
    }
    // Last few metres from the path to the door.
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d < .5) { arrive(p); return; }
    setState(p, 'arriving');
    const sp = Math.min(p.vPref * .85, d / dt);
    p.x += (tx - p.x) / d * sp * dt; p.z += (tz - p.z) / d * sp * dt; p.v = sp;
    turnTo(p, (tx - p.x) / d, (tz - p.z) / d, dt);
    p.anim += sp * dt / .55;
  }
  function arrive(p) {
    setState(p, 'arriving');
    p.route = null; p.doorLeg = false; p.v = 0; p.linger = p.owner != null ? 0 : r.range(3, 12); p.wait = 0; p.skip = null;
    p.node = p.dest?.node ?? p.node;
  }
  function stepPed2(p, dt, T, P, half, speed, ex, ez) {
    if (ex === undefined) { const l = P ? Math.hypot(T.x - P.x, T.z - P.z) || 1 : 1; ex = P ? (T.x - P.x) / l : 0; ez = P ? (T.z - P.z) / l : 0; }
    // Local awareness: keep right, sidestep people and furniture ahead, slow behind a slower walker.
    p.latGoal = p.keep * half;
    let dx = T.x - p.x, dz = T.z - p.z;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    if (p.active) {
      const rx = -dz, rz = dx;
      forNear(p, 1.8, o => {
        const ox = o.x - p.x, oz = o.z - p.z, ahead = ox * dx + oz * dz, side = ox * rx + oz * rz;
        if (ahead < -.1 || ahead > 1.7 || Math.abs(side) > .7) return;
        const same = o.dx * dx + o.dz * dz > .4;
        if (same && o.v < p.v && ahead < 1.0) { speed = Math.min(speed, Math.max(o.v, .3)); p.latGoal -= .5; }
        else p.latGoal += side > 0 ? -.6 : .6;
      });
      forObstacles(p.x, p.z, 1.8, o => {
        const ox = o.x - p.x, oz = o.z - p.z, ahead = ox * dx + oz * dz, side = ox * rx + oz * rz;
        if (ahead < -.2 || ahead > 1.8 || Math.abs(side) > o.r + .55) return;
        p.latGoal += side > 0 ? -(o.r + .55 - side) : (o.r + .55 + side);
      });
    }
    p.latGoal = Math.max(-half, Math.min(half, p.latGoal));
    const dLat = p.latGoal - p.lat, rate = 1.4 * dt;
    p.lat += Math.max(-rate, Math.min(rate, dLat));
    // Target: the next node, offset sideways in the current edge's frame.
    const nx = P ? -ez : -dz, nz = P ? ex : dx;
    const gx = T.x + nx * p.lat, gz = T.z + nz * p.lat;
    let mx = gx - p.x, mz = gz - p.z;
    const md = Math.hypot(mx, mz);
    if (md < .45 + Math.abs(p.lat) * .3 || Math.hypot(T.x - p.x, T.z - p.z) < .35) { advance(p); return; }
    mx /= md; mz /= md;
    const sp = Math.min(speed, md / dt);
    p.x += mx * sp * dt; p.z += mz * sp * dt; p.v = sp;
    // Corridor: never drift off the walk (onto a road, into a wall).
    if (P) {
      const ax = p.x - P.x, az = p.z - P.z, along = ax * ex + az * ez, lat = ax * -ez + az * ex;
      if (along > -1 && Math.abs(lat) > half + .15) { const c = Math.sign(lat) * (half + .15); p.x = P.x + ex * along - ez * c; p.z = P.z + ez * along + ex * c; }
    }
    if (p.active) separate(p, dt);
    turnTo(p, mx, mz, dt);
    p.anim += sp * dt / .55;
  }
  function advance(p) {
    const T = p.route[p.ri];
    p.node = T;
    if (p.state === 'crossing') { p.cw?.peds.delete(p); p.cw = null; setState(p, 'walking'); }
    else if (p.state !== 'walking' && p.state !== 'approaching') setState(p, 'walking');
    if (p.state === 'approaching') setState(p, 'walking');
    p.ri++;
    // Out of sight here, back near the end. The walker lands on node skip[1] and resumes heading for it, so stepPed's
    // crossing check (mayCross) sees the edge it is about to take, even when that edge crosses the road. >=: a
    // crossing that ends past skip[0] has moved ri on by itself; the skip then starts at its far kerb.
    if (p.skip && p.ri > p.skip[1]) p.skip = null; // already past where it would land
    if (p.skip && p.ri >= p.skip[0] && p.state === 'walking') {
      const n = p.route[p.skip[1]];
      jump(p, n.x, n.z); p.node = n; p.ri = p.skip[1]; p.skip = null;
      return;
    }
    if (p.ri >= p.route.length) {
      if (p.door) { p.doorLeg = true; p.route = [T]; p.ri = 0; }
      else arrive(p);
    }
  }
  function turnTo(p, dx, dz, dt) {
    const k = Math.min(1, dt * 10);
    p.dx += (dx - p.dx) * k; p.dz += (dz - p.dz) * k;
    const l = Math.hypot(p.dx, p.dz) || 1; p.dx /= l; p.dz /= l;
  }
  function forNear(p, rad, f) {
    const i0 = Math.floor((p.x - rad) / PH), i1 = Math.floor((p.x + rad) / PH), j0 = Math.floor((p.z - rad) / PH), j1 = Math.floor((p.z + rad) / PH);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = phash.get((i + 4096) * 8192 + j + 4096);
      if (a) for (const o of a) if (o !== p) f(o);
    }
  }
  function forObstacles(x, z, rad, f) {
    for (let i = Math.floor((x - rad) / OB); i <= Math.floor((x + rad) / OB); i++) for (let j = Math.floor((z - rad) / OB); j <= Math.floor((z + rad) / OB); j++)
      for (const o of obHash.get(`${i},${j}`) ?? []) f(o);
  }
  function separate(p, dt) { // soft push apart when two walkers overlap
    forNear(p, 1, o => {
      const ox = p.x - o.x, oz = p.z - o.z, d = Math.hypot(ox, oz), min = PED_R * 2;
      if (d > 1e-4 && d < min) { const push = Math.min((min - d) * .5, .6 * dt * 4); p.x += ox / d * push; p.z += oz / d * push; }
    });
  }

  // ---------- the fixed-step loop ----------
  const allMoves = net.intersections.flatMap(ix => ix.movements);
  function step(dt) {
    stepNo++; time += dt;
    for (const s of signals) stepSignal(s, dt);
    stepPeds(dt);
    for (const c of vehicles) { c.px = c.x; c.pz = c.z; c.ph = c.h; }
    for (const m of allMoves) if (m.cars.length) for (const c of m.cars.slice()) if (c.stamp !== stepNo) { c.stamp = stepNo; stepMoveCar(c, m, dt); }
    for (const L of net.lanes) {
      if (L.uturn) for (const c of L.uturn.cars.slice()) if (c.stamp !== stepNo) { c.stamp = stepNo; stepMoveCar(c, L.uturn, dt); }
      if (!L.cars.length) continue;
      const cars = L.cars.slice();
      for (const c of cars) if (c.stamp !== stepNo && c.seg === L) { c.stamp = stepNo; stepLaneCar(c, L, L.cars.indexOf(c), dt); }
    }
    for (const c of vehicles) { placeCar(c); if (c.snap) { c.px = c.x; c.pz = c.z; c.ph = c.h; c.snap = false; } }
  }
  for (const c of vehicles) { placeCar(c); c.px = c.x; c.pz = c.z; c.ph = c.h; }

  return {
    net, walk, signals, vehicles, peds, violations, STEP,
    get time() { return time; }, get alpha() { return acc / STEP; },
    signalState, phaseOf: s => s.phases[s.phase],
    /** Advance by simDt seconds of simulated time, in whole fixed steps. Returns the steps taken. */
    advance(simDt) {
      acc += Math.max(0, simDt);
      let n = 0;
      while (acc >= STEP && n < MAX_STEPS) { step(STEP); acc -= STEP; n++; }
      if (n === MAX_STEPS) acc = 0; // running behind: slow down rather than skip steps
      return n;
    },
    step,
    /** Plan queued trips for up to `ms` milliseconds. Planning moves nobody, so it runs even while paused. */
    plan(ms = 4) { routeBudget(ms); },
    /** Doors added after the start (new homes, growth/), each { x, z, label, gate }: a destination while gate.open. */
    /**
     * Some gates closed (walks and homes the shown year no longer has, growth/). Walkers already on their way stop at
     * the last open node of their route instead of crossing a street that isn't there; one standing on a closed walk
     * steps back to the nearest open node; and calls at homes that aren't built are dropped. Each then plans afresh.
     */
    gatesChanged() {
      const shut = e => !e || (e.gate && !e.gate.open);
      const usable = n => !!n && !n.dead && n.adj.some(l => !shut(l.e));
      for (const p of peds) {
        const doorShut = !!(p.door?.gate && !p.door.gate.open);
        let cut = -1;
        if (p.route) for (let i = Math.max(1, p.ri); i < p.route.length; i++) if (shut(pedEdge(p.route[i - 1], p.route[i]))) { cut = i; break; }
        if (cut < 0 && !doorShut && usable(p.node)) continue;
        if (doorShut) { p.door = null; p.doorLeg = false; if (p.dest) p.dest.door = null; }
        if (cut > p.ri) { p.route = p.route.slice(0, cut); continue; } // walk on to the edge of the open network, then replan
        if (cut < 0 && usable(p.node)) continue; // only the home closed: carry on, without calling there
        // On the closed walk itself: back to the nearest node with an open way out.
        let best = null, bd = Infinity;
        walk.near(p.x, p.z, 60, n => { const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2; if (d < bd && usable(n)) { bd = d; best = n; } });
        if (best) { jump(p, best.x, best.z); p.node = best; }
        if (p.cw) { p.cw.peds.delete(p); p.cw = null; }
        if (p.state === 'waiting' || p.state === 'crossing') setState(p, 'walking');
        arrive(p);
      }
    },
    /** Forgets the doors added under `gate` (homes no forecast shows any more). */
    dropDoors(gate) {
      for (const [comp, list] of doorsByComp) doorsByComp.set(comp, list.filter(d => d.gate !== gate));
    },
    addDoors(list) {
      for (const d of list) {
        let best = null, bd = 30 * 30;
        walk.near(d.x, d.z, 30, n => { if (!bigComps.has(n.comp) || n.kind === 'kerb') return; const dd = (n.x - d.x) ** 2 + (n.z - d.z) ** 2; if (dd < bd) { bd = dd; best = n; } });
        if (!best) continue;
        d.node = best;
        if (!doorsByComp.has(best.comp)) doorsByComp.set(best.comp, []);
        doorsByComp.get(best.comp).push(d);
      }
    },
    /** Walkers inside [x0, z0, x1, z1] get full local avoidance; the rest just follow their routes. */
    setFocus(b) { focus = b; },
    nearestNode,
    /** A walker the caller controls, standing at the walk node nearest (x, z). owner is the caller's, say a household id. */
    addPed({ x, z, look = 0, vPref = 1.35, owner }) {
      const n = nearestNode(x, z);
      if (!n) return null;
      const p = {
        id: nextId++, look, x: n.x, z: n.z, px: n.x, pz: n.z, dx: 1, dz: 0, v: 0, vPref, state: 'walking', route: null, ri: 0, lat: 0, latGoal: 0,
        keep: .3, spread: 0, back: .4, dest: { label: 'nearby', node: n }, linger: 0, cw: null, wait: 0, anim: 0, comp: n.comp, node: n, active: false,
        door: null, doorLeg: false, trips: 0, waitSpot: null, slow: 1, owner, goal: null, skip: null, hidden: 0,
      };
      peds.push(p);
      return p;
    },
    removePed(p) {
      const i = peds.indexOf(p);
      if (i < 0) return;
      peds.splice(i, 1);
      if (p.cw) { p.cw.peds.delete(p); p.cw.waiting.delete(p); }
      if (p.queued) tripQueue.splice(tripQueue.indexOf(p), 1);
      p.removed = true;
    },
    /** Sends an added walker to (x, z), a door or any point: routed off the frame budget like every trip. A walker on
     *  a crossing (or in the road) finishes it first: the new destination waits in pendingSend for the far kerb. */
    sendPed(p, x, z, label) {
      if (midCrossing(p)) p.pendingSend = { x, z, label };
      else { p.pendingSend = null; send(p, x, z, label); }
    },
    /** An added walker with nowhere to go: arrived, and not routing, out of sight or waiting to be sent on. */
    idle: p => !p.route && !p.queued && !p.goal && !(p.hidden > 0) && !p.pendingSend,
    counts() {
      const states = {};
      for (const p of peds) states[p.state] = (states[p.state] ?? 0) + 1;
      return { vehicles: vehicles.length, peds: peds.length, signals: signals.length, states, queued: tripQueue.length };
    },
    // Safety audit of the current state, for tests and the debug console.
    audit() {
      const out = { overlap: 0, pedOnRoad: 0, pedHit: 0 };
      const H = 6, cells = new Map();
      for (const c of vehicles) { const k = `${Math.floor(c.x / H)},${Math.floor(c.z / H)}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(c); }
      const pts = c => { const o = []; for (const t of [.12, .5, .88]) o.push([c.bx + (c.fx - c.bx) * t, c.bz + (c.fz - c.bz) * t]); return o; };
      for (const c of vehicles) {
        const i = Math.floor(c.x / H), j = Math.floor(c.z / H), A = pts(c);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const o of cells.get(`${i + di},${j + dj}`) ?? []) {
          if (o.id <= c.id) continue;
          const B = pts(o), min = (c.W + o.W) / 2 * .8;
          if (A.some(([ax, az]) => B.some(([bx, bz]) => (ax - bx) ** 2 + (az - bz) ** 2 < min * min))) out.overlap++;
        }
      }
      for (const p of peds) {
        if (p.state !== 'crossing' && p.route && onRoad(p.x, p.z)) out.pedOnRoad++;
        const i = Math.floor(p.x / H), j = Math.floor(p.z / H);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const c of cells.get(`${i + di},${j + dj}`) ?? []) {
          for (const [ax, az] of pts(c)) if ((ax - p.x) ** 2 + (az - p.z) ** 2 < (c.W / 2 + PED_R) ** 2 * .9) { out.pedHit++; break; }
        }
      }
      return out;
    },
  };
}
