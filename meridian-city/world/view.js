// The game camera and pixel pipeline.
// - An orthographic isometric camera: drag pans, wheel or pinch zooms through fixed levels, Q/E rotate 90°.
// - The scene renders at 1/PIXEL_SCALE resolution into an offscreen target, then a full-screen pass
//   draws depth-based ink outlines and upscales with nearest sampling. The camera snaps to whole render
//   pixels and the leftover fraction shifts the upscale instead, so panning is smooth and nothing shimmers.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/controls/OrbitControls.js/+esm';
import { PIXEL_SCALE, ZOOMS, DEFAULT_ZOOM, CAMERA, SUN, AMBIENT, OUTLINE, AERO, P } from './palette.js';
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
  uniform vec3 uInk, uHaze, uGlow;
  uniform float uHazeStrength;
  varying vec2 vUv;
  float depthAt(vec2 px) { return uNear + texture2D(uDepth, (px + 0.5) / uSize).x * (uFar - uNear); }
  void main() {
    // Output covers the target minus a one-pixel margin on every side.
    vec2 px = floor(vUv * (uSize - 2.0) + 1.0 - uShift);
    vec3 c = texture2D(uColor, (px + 0.5) / uSize).rgb;
    float d = depthAt(px);
    float far = max(max(depthAt(px + vec2(1.0, 0.0)), depthAt(px - vec2(1.0, 0.0))), max(depthAt(px + vec2(0.0, 1.0)), depthAt(px - vec2(0.0, 1.0))));
    if (far - d > uThreshold) c = mix(c, uInk, uStrength); // this pixel is the near side of a silhouette
    // Aero grade: bright, cool and saturated, so every material sits in one sky-lit palette.
    c = pow(c, vec3(0.93));
    c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.07) * vec3(0.98, 1.0, 1.04);
    // Cyan haze toward the top of the screen (farther away in this view) and a sun glow in the top right,
    // both evaluated per rendered pixel so they step like pixel art instead of blurring.
    vec2 q = px / uSize;
    c = mix(c, uHaze, smoothstep(0.45, 1.05, q.y) * uHazeStrength);
    float g = 1.0 - clamp(distance(q * vec2(uSize.x / uSize.y, 1.0), vec2(uSize.x / uSize.y + 0.05, 1.08)) / 0.9, 0.0, 1.0);
    c += uGlow * floor(g * g * 6.0) / 6.0 * 0.28;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export function createView(container, { ext }) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
  let level = DEFAULT_ZOOM, ppm = ZOOMS[level], ppmGoal = ppm; // rendered pixels per metre
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
  let rt, rw = 0, rh = 0;
  const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: BLIT_VS, fragmentShader: BLIT_FS, depthTest: false, depthWrite: false,
    uniforms: {
      uColor: { value: null }, uDepth: { value: null }, uSize: { value: new THREE.Vector2() }, uShift: { value: new THREE.Vector2() },
      uNear: { value: camera.near }, uFar: { value: camera.far }, uThreshold: { value: 1 }, uStrength: { value: OUTLINE.strength },
      uInk: { value: new THREE.Color(OUTLINE.color) }, uHaze: { value: new THREE.Color(AERO.haze) }, uGlow: { value: new THREE.Color(AERO.glow) },
      uHazeStrength: { value: AERO.hazeStrength },
    },
  }));
  const blitScene = new THREE.Scene(), blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blit.frustumCulled = false;
  blitScene.add(blit);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    const nw = Math.ceil(w / PIXEL_SCALE) + 2, nh = Math.ceil(h / PIXEL_SCALE) + 2;
    if (nw === rw && nh === rh) return;
    rw = nw; rh = nh;
    rt?.dispose();
    rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
    rt.depthTexture = new THREE.DepthTexture(rw, rh, THREE.UnsignedIntType);
    rt.depthTexture.magFilter = rt.depthTexture.minFilter = THREE.NearestFilter;
    blit.material.uniforms.uColor.value = rt.texture;
    blit.material.uniforms.uDepth.value = rt.depthTexture;
    blit.material.uniforms.uSize.value.set(rw, rh);
  }
  resize();
  addEventListener('resize', resize);

  function setFrustum(cam) {
    const hw = rw / ppm / 2, hh = rh / ppm / 2;
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
  function raycastScreen(sx, sy, objects) {
    setFrustum(camera); camera.updateMatrixWorld();
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
  controls.addEventListener('end', () => { // after a pinch, settle on the nearest zoom level
    if (camera.zoom === 1) return;
    const want = ppm * camera.zoom;
    camera.zoom = 1; ppm = want;
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
    if (camera.zoom !== 1 && !anchor) { ppm *= camera.zoom; camera.zoom = 1; ppmGoal = ppm; }
    const k = 1 - Math.exp(-dt * 12);
    if (Math.abs(ppmGoal - ppm) > 1e-4) ppm = Math.abs(ppmGoal - ppm) < ppmGoal * .002 ? ppmGoal : Math.exp(Math.log(ppm) + (Math.log(ppmGoal) - Math.log(ppm)) * k);
    if (Math.abs(azimuthGoal - azimuth) > 1e-4) { azimuth += (azimuthGoal - azimuth) * k; if (Math.abs(azimuthGoal - azimuth) < 1e-3) azimuth = azimuthGoal; placeCamera(); }
    controls.update();
    if (anchor?.world) { // keep the zoom's anchor point under the cursor
      const now = screenToGround(anchor.sx, anchor.sy);
      if (now) { const d = anchor.world.clone().sub(now); d.y = 0; target.add(d); camera.position.add(d); }
      if (ppm === ppmGoal) anchor = null;
    }
    target.x = THREE.MathUtils.clamp(target.x, -ext, ext); target.z = THREE.MathUtils.clamp(target.z, -ext, ext); target.y = 0;
    placeCamera();
    setFrustum(camera);
    camera.updateMatrixWorld();

    // Snap the render camera to whole pixels; the remainder becomes a sub-pixel shift in the upscale.
    renderCam.copy(camera);
    setFrustum(renderCam);
    right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
    const s = 1 / ppm, a = camera.position.dot(right), b = camera.position.dot(up);
    const da = Math.round(a / s) * s - a, db = Math.round(b / s) * s - b;
    renderCam.position.addScaledVector(right, da).addScaledVector(up, db);
    renderCam.updateMatrixWorld();
    // The snapped camera moved by (da, db), which shifts the rendered image by -(da, db)/s pixels;
    // the upscale samples at px - shift, putting every world point back where the unsnapped camera shows it.
    blit.material.uniforms.uShift.value.set(da / s, db / s);
    blit.material.uniforms.uThreshold.value = Math.max(OUTLINE.depthMetres, 2.4 * s);

    // The sun keeps its angle to the camera; fit its shadow box to what is on screen.
    sunDir.setFromSphericalCoords(1, DEG(90 - SUN.elevationDeg), azimuth + DEG(SUN.offsetDeg));
    const radius = Math.max(rw, rh / Math.sin(THREE.MathUtils.degToRad(CAMERA.elevationDeg))) / ppm * .62 + 40;
    const sc = sun.shadow.camera, texel = radius * 2 / sun.shadow.mapSize.x;
    sc.left = sc.bottom = -radius; sc.right = sc.top = radius; sc.near = 1; sc.far = radius * 2 + 1000; sc.updateProjectionMatrix();
    const cx = Math.round(target.x / texel) * texel, cz = Math.round(target.z / texel) * texel; // stable shadow texels while panning
    sun.target.position.set(cx, 0, cz); sun.position.set(cx, 0, cz).addScaledVector(sunDir, radius + 500);
  }

  function render() {
    renderer.setRenderTarget(rt);
    renderer.render(scene, renderCam);
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCam);
  }

  return {
    renderer, scene, camera, renderCam, controls, target, sun,
    get ppm() { return ppm; }, get level() { return level; }, get azimuth() { return azimuth; },
    update, render, rotate, zoomTo, zoomBy: d => zoomTo(level + d), screenToGround, raycastScreen,
    onChange(f) { listeners.add(f); f({ level, ppm: ppmGoal, azimuth: azimuthGoal }); return () => listeners.delete(f); },
    lookAt(x, z) { const d = new THREE.Vector3(x - target.x, 0, z - target.z); target.add(d); camera.position.add(d); },
  };
}
