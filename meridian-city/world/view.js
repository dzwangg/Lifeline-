// The game camera and pixel pipeline.
// - An orthographic isometric camera: drag pans, wheel or pinch zooms through fixed levels, Q/E rotate 90°.
// - The scene renders into an offscreen target, then a full-screen pass draws depth-based ink outlines and
//   upscales with nearest sampling. The camera snaps to whole render pixels and the leftover fraction shifts the
//   upscale instead, so panning is smooth and nothing shimmers.
// - The render grain follows the zoom. Close in, where a texture pixel spans PIXEL_SCALE CSS pixels or more, one
//   render pixel is PIXEL_SCALE CSS pixels: the chunky pixel-art look. Further out the art is already smaller than
//   that grain, so the target steps up (always by a whole number of canvas pixels) until one render pixel is one
//   canvas pixel, and distant buildings keep their silhouettes instead of melting into a few blocky pixels.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/controls/OrbitControls.js/+esm';
import { PIXEL_SCALE, ZOOMS, DEFAULT_ZOOM, CAMERA, SUN, AMBIENT, OUTLINE, AERO, P, TEXEL, RENDER } from './palette.js';
const DEG = THREE.MathUtils.degToRad;

const BLIT_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLIT_FS = /* glsl */`
  uniform sampler2D uColor;
  uniform sampler2D uDepth;
  uniform vec2 uSize;        // render target size in pixels
  uniform vec2 uShift;       // sub-pixel camera offset, in render pixels
  uniform float uNear, uFar, uThreshold, uStrength;
  uniform float uInkStep;    // outline reach in render pixels: about one CSS pixel, however fine the grain
  uniform vec3 uInk, uHaze, uGlow;
  uniform float uHazeStrength, uGlowStrength;
  varying vec2 vUv;
  float depthAt(vec2 px) { return uNear + texture2D(uDepth, (px + 0.5) / uSize).x * (uFar - uNear); }
  void main() {
    // Output covers the target minus a one-pixel margin on every side.
    vec2 px = floor(vUv * (uSize - 2.0) + 1.0 - uShift);
    vec3 c = texture2D(uColor, (px + 0.5) / uSize).rgb;
    float d = depthAt(px), k = uInkStep;
    float far = max(max(depthAt(px + vec2(k, 0.0)), depthAt(px - vec2(k, 0.0))), max(depthAt(px + vec2(0.0, k)), depthAt(px - vec2(0.0, k))));
    if (far - d > uThreshold) c = mix(c, uInk, uStrength); // this pixel is the near side of a silhouette
    // Aero grade: bright, cool and saturated, so every material sits in one sky-lit palette.
    c = pow(c, vec3(0.93));
    c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.07) * vec3(0.98, 1.0, 1.04);
    // Cyan haze toward the top of the screen (farther away in this view) and a sun glow in the top right,
    // both evaluated per rendered pixel so they step like pixel art instead of blurring.
    vec2 q = px / uSize;
    c = mix(c, uHaze, smoothstep(0.45, 1.05, q.y) * uHazeStrength);
    float g = 1.0 - clamp(distance(q * vec2(uSize.x / uSize.y, 1.0), vec2(uSize.x / uSize.y + 0.05, 1.08)) / 0.9, 0.0, 1.0);
    c += uGlow * floor(g * g * 6.0) / 6.0 * uGlowStrength;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export function createView(container, { ext }) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // hard-edged shadows suit pixel art
  renderer.toneMapping = THREE.NoToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.imageRendering = 'pixelated';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(P.sky);

  // ---------- light: warm sun, soft sky fill ----------
  const sunDir = new THREE.Vector3();
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -.0006;
  sun.shadow.normalBias = .3;
  scene.add(sun, sun.target, new THREE.HemisphereLight(AMBIENT.sky, AMBIENT.ground, AMBIENT.intensity));

  // ---------- camera ----------
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA.distance * 3);
  const renderCam = camera.clone();
  const target = new THREE.Vector3(0, 0, 0);
  let azimuth = THREE.MathUtils.degToRad(CAMERA.azimuthDeg), azimuthGoal = azimuth;
  const polar = THREE.MathUtils.degToRad(90 - CAMERA.elevationDeg);
  let level = DEFAULT_ZOOM, ppm = ZOOMS[level], ppmGoal = ppm; // chunky (PIXEL_SCALE CSS px) pixels per metre; see rppm
  let anchor = null; // { sx, sy, world }: the ground point kept under the cursor while zooming

  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableRotate: false, enableDamping: true, dampingFactor: .15, screenSpacePanning: false, zoomToCursor: true });
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target = target;

  function placeCamera() {
    camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(CAMERA.distance, polar, azimuth));
    camera.lookAt(target);
  }
  placeCamera();

  // ---------- render targets ----------
  // pr: canvas pixels per CSS pixel (the device ratio, capped at RENDER.maxPixelRatio and at RENDER.maxPixels for the
  // whole canvas). grain: canvas pixels per render pixel, a whole number, chosen per frame from the zoom (gridFor).
  // rppm: render pixels per metre. ppm itself stays in PIXEL_SCALE-CSS-pixel units at every grain, so ZOOMS and the
  // level-of-detail thresholds mean the same on every display.
  let rt, rw = 0, rh = 0, cw = 0, ch = 0, pr = 1, grain = 1, rppm = 1;
  const targets = new Map(); // by size; a zoom across the grain boundary flips between two targets without reallocating
  const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: BLIT_VS, fragmentShader: BLIT_FS, depthTest: false, depthWrite: false,
    uniforms: {
      uColor: { value: null }, uDepth: { value: null }, uSize: { value: new THREE.Vector2() }, uShift: { value: new THREE.Vector2() },
      uNear: { value: camera.near }, uFar: { value: camera.far }, uThreshold: { value: 1 }, uStrength: { value: OUTLINE.strength },
      uInk: { value: new THREE.Color(OUTLINE.color) }, uHaze: { value: new THREE.Color(AERO.haze) }, uGlow: { value: new THREE.Color(AERO.glow) },
      uHazeStrength: { value: AERO.hazeStrength }, uGlowStrength: { value: AERO.glowStrength }, uInkStep: { value: 1 },
    },
  }));
  const blitScene = new THREE.Scene(), blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blit.frustumCulled = false;
  blitScene.add(blit);

  function targetFor(w, h) {
    const key = `${w}x${h}`;
    let t = targets.get(key);
    if (t) { targets.delete(key); targets.set(key, t); return t; } // most recently used last
    t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
    t.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    t.depthTexture.magFilter = t.depthTexture.minFilter = THREE.NearestFilter;
    targets.set(key, t);
    while (targets.size > 2) { const [k, old] = targets.entries().next().value; old.depthTexture.dispose(); old.dispose(); targets.delete(k); }
    return t;
  }
  // Grain for a zoom: the canvas pixels one texture pixel covers, rounded down, so texture pixels never shrink below one
  // render pixel at rest, and capped at the chunky PIXEL_SCALE grain.
  const chunky = () => Math.max(1, Math.round(PIXEL_SCALE * pr));
  const grainFor = z => THREE.MathUtils.clamp(Math.floor(TEXEL * z * PIXEL_SCALE * pr + 1e-3), 1, chunky());
  function useGrain(g) {
    const nw = Math.ceil(cw / g) + 2, nh = Math.ceil(ch / g) + 2;
    if (g === grain && nw === rw && nh === rh && rt) return;
    grain = g; rw = nw; rh = nh;
    rppm = ppm * PIXEL_SCALE * pr / grain;
    rt = targetFor(rw, rh);
    blit.material.uniforms.uColor.value = rt.texture;
    blit.material.uniforms.uDepth.value = rt.depthTexture;
    blit.material.uniforms.uSize.value.set(rw, rh);
  }

  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    // Device resolution, capped twice: the ratio, and the canvas's total pixels, so a large high-density screen
    // doesn't push a fine-grain frame past what an integrated GPU can fill.
    pr = Math.min(devicePixelRatio || 1, RENDER.maxPixelRatio, Math.sqrt(RENDER.maxPixels / (w * h)));
    pr = Math.max(pr, Math.min(1, devicePixelRatio || 1) * .5);
    if (rt && pr === renderer.getPixelRatio() && w === renderer.domElement.clientWidth && h === renderer.domElement.clientHeight) return;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    cw = renderer.domElement.width; ch = renderer.domElement.height;
    for (const t of targets.values()) { t.depthTexture.dispose(); t.dispose(); }
    targets.clear(); rt = null;
    useGrain(grainFor(ppm));
  }
  resize();
  addEventListener('resize', resize);
  new ResizeObserver(resize).observe(container); // panels and layout can resize the map without a window resize
  // Moving the window to a screen with another pixel ratio fires no resize, so watch the ratio itself.
  (function watchRatio() { matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { resize(); watchRatio(); }, { once: true }); })();

  function setFrustum(cam) {
    const hw = rw / rppm / 2, hh = rh / rppm / 2;
    Object.assign(cam, { left: -hw, right: hw, top: hh, bottom: -hh });
    cam.updateProjectionMatrix();
  }

  // ---------- screen ↔ ground ----------
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndcOf = (sx, sy) => { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2((sx - r.left) / r.width * 2 - 1, -((sy - r.top) / r.height) * 2 + 1); };
  function screenToGround(sx, sy) {
    setFrustum(camera); camera.updateMatrixWorld();
    ray.setFromCamera(ndcOf(sx, sy), camera);
    return ray.ray.intersectPlane(ground, new THREE.Vector3());
  }
  // The before/after wipe's side under screen x (render(), below): 1, year 0, left of the split; 2, the shown year,
  // right of it or with no split. Raycasts hit the city (layer 0) and that side's layer.
  function sideAt(sx) {
    if (split == null) return 2;
    const r = renderer.domElement.getBoundingClientRect();
    return (sx - r.left) / r.width < split ? 1 : 2;
  }
  function raycastScreen(sx, sy, objects) {
    setFrustum(camera); camera.updateMatrixWorld();
    ray.layers.set(0); ray.layers.enable(sideAt(sx));
    ray.setFromCamera(ndcOf(sx, sy), camera);
    return ray.intersectObjects(objects, false);
  }

  // ---------- zoom ----------
  function zoomTo(i, sx, sy) {
    level = THREE.MathUtils.clamp(i, 0, ZOOMS.length - 1);
    ppmGoal = ZOOMS[level];
    if (sx != null) anchor = { sx, sy, world: screenToGround(sx, sy) };
    emit();
  }
  let wheelAcc = 0, wheelTimer;
  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    wheelAcc += e.deltaY * (e.deltaMode ? 30 : 1);
    if (Math.abs(wheelAcc) < 60) { clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { wheelAcc = 0; }, 200); return; }
    zoomTo(level + (wheelAcc < 0 ? 1 : -1), e.clientX, e.clientY);
    wheelAcc = 0;
  }, { capture: true, passive: false });
  // A pinch changes camera.zoom, which update() folds into ppm every frame, so whether the gesture zoomed is tracked
  // (pinched) rather than read from camera.zoom at the end.
  let pinched = false;
  controls.addEventListener('start', () => { pinched = false; });
  controls.addEventListener('end', () => { // after a pinch, settle on the nearest zoom level
    if (camera.zoom !== 1) { ppm *= camera.zoom; camera.zoom = 1; pinched = true; }
    if (!pinched) return;
    pinched = false;
    const want = ppm;
    let best = 0;
    ZOOMS.forEach((z, i) => { if (Math.abs(Math.log(z / want)) < Math.abs(Math.log(ZOOMS[best] / want))) best = i; });
    zoomTo(best);
  });

  // ---------- rotation ----------
  function rotate(dir) { azimuthGoal += dir * Math.PI / 2; emit(); }
  addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea, select, [contenteditable], dialog, [role="dialog"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'q') rotate(-1);
    else if (k === 'e') rotate(1);
    else if (k === '+' || k === '=') zoomTo(level + 1);
    else if (k === '-' || k === '_') zoomTo(level - 1);
    else if (k.startsWith('arrow')) {
      const step = 60 / ppm, f = new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth)), rgt = new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
      const d = k === 'arrowup' ? f : k === 'arrowdown' ? f.negate() : k === 'arrowleft' ? rgt.negate() : rgt;
      target.addScaledVector(d, step); camera.position.addScaledVector(d, step);
    } else return;
    e.preventDefault();
  });

  const listeners = new Set();
  const emit = () => listeners.forEach(f => f({ level, ppm: ppmGoal, azimuth: azimuthGoal }));

  // ---------- per frame ----------
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  function update(dt) {
    // Zoom and rotation ease toward their goals.
    if (camera.zoom !== 1 && !anchor) { ppm *= camera.zoom; camera.zoom = 1; ppmGoal = ppm; pinched = true; }
    const k = 1 - Math.exp(-dt * 12);
    if (Math.abs(ppmGoal - ppm) > 1e-4) ppm = Math.abs(ppmGoal - ppm) < ppmGoal * .002 ? ppmGoal : Math.exp(Math.log(ppm) + (Math.log(ppmGoal) - Math.log(ppm)) * k);
    if (Math.abs(azimuthGoal - azimuth) > 1e-4) { azimuth += (azimuthGoal - azimuth) * k; if (Math.abs(azimuthGoal - azimuth) < 1e-3) azimuth = azimuthGoal; placeCamera(); }
    useGrain(grainFor(ppm));
    rppm = ppm * PIXEL_SCALE * pr / grain;
    controls.update();
    if (anchor?.world) { // keep the zoom's anchor point under the cursor
      const now = screenToGround(anchor.sx, anchor.sy);
      if (now) { const d = anchor.world.clone().sub(now); d.y = 0; target.add(d); camera.position.add(d); }
      if (ppm === ppmGoal) anchor = null;
    }
    // A margin past the map, so a view can centre parcels at the edge in the part of the screen a panel leaves free.
    const lim = ext + 600;
    target.x = THREE.MathUtils.clamp(target.x, -lim, lim); target.z = THREE.MathUtils.clamp(target.z, -lim, lim); target.y = 0;
    placeCamera();
    setFrustum(camera);
    camera.updateMatrixWorld();

    // Snap the render camera to whole pixels; the remainder becomes a sub-pixel shift in the upscale.
    renderCam.copy(camera);
    setFrustum(renderCam);
    right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
    const s = 1 / rppm, a = camera.position.dot(right), b = camera.position.dot(up);
    const da = Math.round(a / s) * s - a, db = Math.round(b / s) * s - b;
    renderCam.position.addScaledVector(right, da).addScaledVector(up, db);
    renderCam.updateMatrixWorld();
    // The snapped camera moved by (da, db), which shifts the rendered image by -(da, db)/s pixels;
    // the upscale samples at px - shift, putting every world point back where the unsnapped camera shows it.
    blit.material.uniforms.uShift.value.set(da / s, db / s);
    // Ink reaches about one CSS pixel out from a silhouette at any grain, so far buildings keep a readable outline.
    const inkStep = Math.max(1, Math.round(pr / grain));
    const u = blit.material.uniforms;
    u.uInkStep.value = inkStep;
    u.uThreshold.value = Math.max(OUTLINE.depthMetres, 2.4 * s * inkStep);
    // Screen-space haze and glow thin out as the view pulls back: zoomed out, the top of the screen is still the city,
    // not the horizon, and a full-strength wash would fade half of it. The outskirts keep their own distance haze.
    const near = THREE.MathUtils.clamp(Math.log2(ppm / ZOOMS[0]) / Math.log2(ZOOMS[DEFAULT_ZOOM] / ZOOMS[0]), 0, 1);
    u.uHazeStrength.value = AERO.hazeStrength * (AERO.farAtmosphere + (1 - AERO.farAtmosphere) * near);
    u.uGlowStrength.value = AERO.glowStrength * (AERO.farAtmosphere + (1 - AERO.farAtmosphere) * near);

    // The sun keeps its angle to the camera; fit its shadow box to what is on screen.
    sunDir.setFromSphericalCoords(1, DEG(90 - SUN.elevationDeg), azimuth + DEG(SUN.offsetDeg));
    const radius = Math.max(rw, rh / Math.sin(THREE.MathUtils.degToRad(CAMERA.elevationDeg))) / rppm * .62 + 40;
    const sc = sun.shadow.camera, texel = radius * 2 / sun.shadow.mapSize.x;
    sc.left = sc.bottom = -radius; sc.right = sc.top = radius; sc.near = 1; sc.far = radius * 2 + 1000; sc.updateProjectionMatrix();
    const cx = Math.round(target.x / texel) * texel, cz = Math.round(target.z / texel) * texel; // stable shadow texels while panning
    sun.target.position.set(cx, 0, cz); sun.position.set(cx, 0, cz).addScaledVector(sunDir, radius + 500);
    // The shadow pass repeats every draw call, so it reruns only when it can change: whenever the box moves, every
    // frame close in (cars and walkers cast), and otherwise a few times a second (turbines, the sim's rising blocks).
    const key = `${cx},${cz},${radius.toFixed(2)},${azimuth.toFixed(5)}`;
    if (key !== shadowKey || ppm >= RENDER.shadowLivePpm || ++shadowAge >= RENDER.shadowRefreshFrames * (ppm < .6 ? 5 : 1)) { // turbines hide below .6
      renderer.shadowMap.needsUpdate = true; shadowKey = key; shadowAge = 0;
    }
  }
  let shadowKey = '', shadowAge = 0;
  renderer.shadowMap.autoUpdate = false;

  // The before/after wipe: objects on layer 1 (the year-0 side) draw left of the split, objects on layer 2 (the shown
  // year) right of it, and layer 0 (the city) on both. With no split, layer 1 is left out.
  let split = null;
  function render() {
    renderCam.layers.set(0); renderCam.layers.enable(2);
    if (split == null) {
      renderer.setRenderTarget(rt);
      renderer.render(scene, renderCam);
    } else {
      const cut = Math.round(rw * split);
      rt.scissorTest = true;
      rt.scissor.set(cut, 0, rw - cut, rh); renderer.setRenderTarget(rt); renderer.render(scene, renderCam);
      renderCam.layers.set(0); renderCam.layers.enable(1);
      rt.scissor.set(0, 0, cut, rh); renderer.setRenderTarget(rt); renderer.render(scene, renderCam);
      rt.scissorTest = false;
    }
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCam);
  }

  return {
    renderer, scene, camera, renderCam, controls, target, sun,
    get ppm() { return ppm; }, get level() { return level; }, get azimuth() { return azimuth; },
    get grain() { return grain; }, get pixelRatio() { return pr; }, get renderPpm() { return rppm; }, get renderSize() { return [rw, rh]; },
    update, render, rotate, zoomTo, zoomBy: d => zoomTo(level + d), screenToGround, raycastScreen, sideAt,
    get split() { return split; }, set split(v) { split = v == null ? null : THREE.MathUtils.clamp(v, 0, 1); }, // the wipe, 0..1 from the left
    onChange(f) { listeners.add(f); f({ level, ppm: ppmGoal, azimuth: azimuthGoal }); return () => listeners.delete(f); },
    lookAt(x, z) { const d = new THREE.Vector3(x - target.x, 0, z - target.z); target.add(d); camera.position.add(d); },
  };
}
