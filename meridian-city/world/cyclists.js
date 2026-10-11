// People riding bikes, in the same toy-voxel style as the cars: a bike (two spoked wheels, a coloured frame, saddle and
// bars) and a rider leaning into the bars, dressed like the street's walkers (people-art.js palettes: skin, hair, top,
// bottoms, shoes), each rider their own mix. The legs pedal: two poses, swapped as the wheels turn. Local x is forward,
// y up, z right, as the vehicles' models (traffic.js); one metre is one metre. createCyclists(scene, count) returns
// set(i, matrix, phase) and show(n); the caller (sim/effects-layer.js) moves them.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { SKIN, HAIR, TOPS, BOTTOMS, SHOES } from './people-art.js';

// Boxes merged into one geometry: [length (x), height (y), width (z), x, y, z, tilt about z].
function boxes(list) {
  const pos = [], nor = [];
  for (const [w, h, d, x, y, z, rz = 0] of list) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
// A limb or tube from a to b ([x, y]), t thick, at z.
const limb = (a, b, t, z, td = t) => { const dx = b[0] - a[0], dy = b[1] - a[1]; return [Math.hypot(dx, dy) + t * .6, t, td, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z, Math.atan2(dy, dx)]; };
const wheel = (cx, r = .33) => Array.from({ length: 10 }, (_, k) => { // a rim of ten short boxes, and a hub
  const a0 = k / 10 * Math.PI * 2, a1 = (k + 1) / 10 * Math.PI * 2;
  return limb([cx + Math.cos(a0) * r, .34 + Math.sin(a0) * r], [cx + Math.cos(a1) * r, .34 + Math.sin(a1) * r], .055, 0, .05);
}).concat([[.08, .08, .08, cx, .34, 0]]);

const HIP = [-.24, .96], SHOULDER = [.04, 1.43], BAR = [.42, 1.06], PEDAL = [-.02, .36];
// The two pedalling poses: one foot down at the front, the other up at the back, then the other way round.
const legs = up => {
  const out = [];
  for (const [z, high] of [[-.1, up], [.1, !up]]) {
    const foot = high ? [PEDAL[0] - .1, PEDAL[1] + .16] : [PEDAL[0] + .12, PEDAL[1] - .12];
    const knee = high ? [.08, 1.0] : [.06, .72];
    out.push(limb(HIP, knee, .13, z), limb(knee, foot, .11, z));
  }
  return out;
};
const feet = up => [[-.1, up], [.1, !up]].map(([z, high]) => { const f = high ? [PEDAL[0] - .1, PEDAL[1] + .16] : [PEDAL[0] + .12, PEDAL[1] - .12]; return [.18, .07, .09, f[0] + .04, f[1] - .05, z]; });

const PARTS = {
  // the bike: frame tubes in the frame colour, the rest dark
  frame: boxes([limb([-.26, .9], [.36, .9], .05, 0), limb([.36, .9], PEDAL, .055, 0), limb([-.24, .93], PEDAL, .05, 0),
    limb(PEDAL, [-.56, .34], .04, 0), limb([-.24, .9], [-.56, .34], .04, 0), limb([.36, .9], [.56, .34], .045, 0), limb([.36, .9], [.4, 1.05], .045, 0)]),
  dark: boxes([...wheel(-.56), ...wheel(.56), [.24, .05, .13, -.25, .98, 0], [.06, .05, .52, BAR[0], BAR[1], 0], [.1, .1, .06, PEDAL[0], PEDAL[1], 0]]),
  skin: boxes([[.21, .24, .2, .13, 1.62, 0], [.08, .08, .08, BAR[0] - .01, BAR[1] + .03, -.21], [.08, .08, .08, BAR[0] - .01, BAR[1] + .03, .21]]),
  hair: boxes([[.24, .08, .23, .11, 1.77, 0], [.09, .17, .23, .02, 1.66, 0]]),
  top: boxes([limb(HIP, SHOULDER, .3, 0, .36), limb(SHOULDER, BAR, .1, -.19), limb(SHOULDER, BAR, .1, .19)]),
  bottoms: [boxes(legs(true)), boxes(legs(false))],
  shoes: [boxes(feet(true)), boxes(feet(false))],
};
const FRAMES = ['#d84a3a', '#2f6fb8', '#1fae9a', '#ffd166', '#ff8a7a', '#6fd04a', '#3a3a3a', '#f4f8fb'];

export function createCyclists(scene, count) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const make = (geo, palette, seed) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) m.setColorAt(i, new THREE.Color(palette ? palette[(i * seed + (i >> 2)) % palette.length] : '#2b2b30'));
    scene.add(m);
    return m;
  };
  // Each rider's own mix: the palettes are walked with different strides, so colours don't repeat in step.
  const fixed = [make(PARTS.frame, FRAMES, 3), make(PARTS.dark, null, 1), make(PARTS.skin, SKIN, 5), make(PARTS.hair, HAIR, 3), make(PARTS.top, TOPS, 7)];
  const poses = [0, 1].map(k => [make(PARTS.bottoms[k], BOTTOMS, 4), make(PARTS.shoes[k], SHOES, 5)]);
  const all = [...fixed, ...poses.flat()];
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    meshes: all,
    /** Rider i at `matrix` (position, heading, scale), in pedal pose `phase` (0 or 1). */
    set(i, matrix, phase) {
      for (const m of fixed) m.setMatrixAt(i, matrix);
      for (const [k, pair] of poses.entries()) for (const m of pair) m.setMatrixAt(i, k === phase ? matrix : hidden);
    },
    /** Shows the first n riders. */
    show(n) { for (const m of all) { m.count = n; m.instanceMatrix.needsUpdate = true; } },
  };
}
