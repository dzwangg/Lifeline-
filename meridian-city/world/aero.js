// Frutiger Aero atmosphere around the pixel city:
// - backdrop(): rolling green hills and glossy wind turbines on the countryside ring outside the mapped
//   area, so the real city's geography is untouched;
// - mountBubbles(): pixel bubbles drifting up the screen, drawn on a low-resolution overlay canvas
//   (slower and without wobble when the system asks for reduced motion). Pass onFrame to run them on the
//   sim clock's frames, so they freeze and speed up with the city; paused, they stay on screen, holding still.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { PIXEL_SCALE, seeded, AERO } from './palette.js';

export function backdrop(scene, ext, grassTexture) {
  const r = seeded(808), group = new THREE.Group();
  // Distance from the centre to the edge of the square mapped area (plus its road margin) in direction a.
  const edge = a => (ext + 150) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
  const grass = grassTexture.clone(); grass.repeat.set(1 / 60, 1 / 60); grass.needsUpdate = true;
  const hillMat = new THREE.MeshLambertMaterial({ map: grass, color: '#d8ffd0' });
  const hillGeo = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  // UVs scaled so the grass texture keeps roughly its world size on the dome.
  const uv = hillGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 6);
  for (let k = 0; k < 16; k++) {
    // Each hill's inner edge stays well clear of the mapped city, so no real street or building is covered.
    const a = k / 16 * Math.PI * 2 + r() * .3, d = edge(a) + 380 + r() * 420, w = Math.min(320 + r() * 380, d - edge(a) - 60);
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(Math.cos(a) * d, -2, Math.sin(a) * d);
    hill.scale.set(w, 45 + r() * 70, w * (.7 + r() * .3));
    hill.receiveShadow = true;
    group.add(hill);
  }

  // Wind turbines: glossy white tower, nacelle and three blades turning about the hub.
  const white = new THREE.MeshPhongMaterial({ color: '#ffffff', specular: '#9fb4c4', shininess: 60 });
  const towerGeo = new THREE.CylinderGeometry(1.4, 2.6, 70, 8).translate(0, 35, 0);
  const nacelleGeo = new THREE.BoxGeometry(8, 4, 4);
  const bladeGeo = new THREE.BoxGeometry(1.4, 34, .6).translate(0, 17, 0);
  const rotors = [];
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * Math.PI * 2 + .35 + r() * .25, d = edge(a) + 140 + r() * 320;
    const t = new THREE.Group();
    t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    t.rotation.y = r() * Math.PI * 2;
    const tower = new THREE.Mesh(towerGeo, white), nacelle = new THREE.Mesh(nacelleGeo, white);
    nacelle.position.set(0, 71, 0);
    const rotor = new THREE.Group();
    rotor.position.set(4.4, 71, 0);
    for (let b = 0; b < 3; b++) { const blade = new THREE.Mesh(bladeGeo, white); blade.rotation.x = b * Math.PI * 2 / 3; rotor.add(blade); }
    rotor.rotation.x = r() * Math.PI;
    for (const m of [tower, nacelle, ...rotor.children]) m.castShadow = m.receiveShadow = true;
    t.add(tower, nacelle, rotor);
    group.add(t);
    rotors.push([rotor, .35 + r() * .25]);
  }
  scene.add(group);
  return { update(dt) { for (const [rotor, speed] of rotors) rotor.rotation.x += dt * speed; } };
}

// Pixel bubbles over the city. A canvas at 1/PIXEL_SCALE resolution, scaled up crisp, never takes clicks.
export function mountBubbles(host = document.body, { onFrame } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'aero-bubbles';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', imageRendering: 'pixelated', zIndex: '5' });
  host.append(canvas);
  const g = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, r = seeded(51);
  let W = 0, H = 0, dirty = true; // dirty: the canvas needs painting even though no time passed (first frame, resize)
  const resize = () => { W = canvas.width = Math.ceil(innerWidth / PIXEL_SCALE); H = canvas.height = Math.ceil(innerHeight / PIXEL_SCALE); dirty = true; };
  resize(); addEventListener('resize', resize);
  const spawn = (b, anywhere) => Object.assign(b, { x: r() * W, y: anywhere ? r() * H : H + 20, rad: 3 + Math.floor(r() * 9), v: 6 + r() * 10, phase: r() * 6.3, wob: 4 + r() * 8 });
  const bubbles = Array.from({ length: AERO.bubbles }, () => spawn({}, true));

  function circle(cx, cy, rad, color, fill = false) {
    g.fillStyle = color;
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      const d = Math.hypot(x + .5, y + .5);
      if (fill ? d <= rad - .5 : d <= rad && d > rad - 1.2) g.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    }
  }
  function draw(time, dt) {
    g.clearRect(0, 0, W, H);
    for (const b of bubbles) {
      // Reduced motion slows the drift to a quarter and drops the wobble, rather than freezing the bubbles.
      b.y -= b.v * (still ? .25 : 1) * dt;
      if (b.y < -20) spawn(b, false);
      const x = b.x + (still ? 0 : Math.sin(time * .9 + b.phase) * b.wob), y = b.y;
      circle(x, y, b.rad, 'rgba(210, 248, 255, .16)', true);  // a faint body
      circle(x, y, b.rad, 'rgba(255, 255, 255, .75)');        // the rim
      g.fillStyle = 'rgba(255, 255, 255, .95)';                 // two-pixel glint, top left
      g.fillRect(Math.round(x - b.rad * .45), Math.round(y - b.rad * .5), 2, 1);
      g.fillRect(Math.round(x - b.rad * .55), Math.round(y - b.rad * .3), 1, 1);
      g.fillStyle = 'rgba(120, 220, 255, .55)';                 // a cyan catch-light, bottom right
      g.fillRect(Math.round(x + b.rad * .4), Math.round(y + b.rad * .45), 1, 1);
    }
  }
  let time = 0;
  const step = dt => { dt = Math.min(.2, Math.max(0, dt)); if (!dt && !dirty) return; dirty = false; time += dt; draw(time, dt); };
  if (onFrame) onFrame((_, simDt) => step(simDt));
  else { let last = performance.now(); requestAnimationFrame(function loop(now) { step(Math.min(.05, (now - last) / 1000)); last = now; requestAnimationFrame(loop); }); }
  return canvas;
}
