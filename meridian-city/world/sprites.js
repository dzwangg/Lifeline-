// Instanced pixel sprites. Billboards are upright cards turned to face the camera, stretched by
// 1/cos(camera elevation) so they show their full drawn height on screen. Because they are real upright
// planes, depth testing sorts them correctly against roofs, walls and each other. Instances are split
// into map chunks so the renderer skips chunks outside the view. Cut-out alpha keeps edges crisp.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { CHUNK, CAMERA, AERO } from './palette.js';
import { chunkKey } from './geometry.js';

const BILLBOARD_VS = /* glsl */`
  attribute vec4 aUv;      // atlas rect u0 v0 u1 v1
  attribute vec3 aSize;    // width, height, sway amount
  attribute float aPhase;
  uniform float uTime;
  uniform vec3 uRight;     // camera right, in world space (always horizontal: the camera never rolls)
  uniform float uStretch;  // 1 / cos(camera elevation)
  varying vec2 vUv;
  void main() {
    vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float k = length(instanceMatrix[1].xyz); // instance scale: 0 hides a sprite
    float sway = aSize.z * position.y * position.y * sin(uTime * 1.6 + aPhase) * 0.035 * aSize.y;
    vec3 world = base + (uRight * (position.x * aSize.x + sway) + vec3(0.0, position.y * aSize.y * uStretch, 0.0)) * k;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vUv = vec2(mix(aUv.x, aUv.z, position.x + 0.5), mix(aUv.w, aUv.y, position.y));
  }`;
const DECAL_VS = /* glsl */`
  attribute vec4 aUv;
  attribute vec3 aSize;
  attribute float aPhase;  // rotation about the vertical axis
  varying vec2 vUv;
  void main() {
    vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float c = cos(aPhase), s = sin(aPhase);
    vec2 o = vec2(position.x * aSize.x, (position.y - 0.5) * aSize.y);
    vec3 world = base + vec3(o.x * c - o.y * s, 0.0, o.x * s + o.y * c);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vUv = vec2(mix(aUv.x, aUv.z, position.x + 0.5), mix(aUv.w, aUv.y, position.y));
  }`;
const FS = /* glsl */`
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uTint;
  uniform vec3 uHaze;      // distant layers fade toward the horizon haze by uHazeAmount
  uniform float uHazeAmount;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    // Minified, the atlas's mip levels average a sprite's edge with clear (black) pixels: undo that darkening, and
    // lift alpha with the mip level so small sprites keep their silhouette through the cut-out instead of eroding.
    vec2 t = vUv * vec2(textureSize(uMap, 0));
    float lod = max(0.0, 0.5 * log2(max(dot(dFdx(t), dFdx(t)), dot(dFdy(t), dFdy(t)))));
    c.rgb /= max(c.a, 1.0 / 255.0);
    c.a *= 1.0 + lod * 0.3;
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(mix(c.rgb * uTint, uHaze, uHazeAmount), uOpacity);
  }`;

export function createSpriteSystem(atlas) {
  const uniforms = { uTime: { value: 0 }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uStretch: { value: 1 / Math.cos(THREE.MathUtils.degToRad(CAMERA.elevationDeg)) } };
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, .5, 0);
  const layers = [];

  const material = (vs, extra = {}) => new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: FS,
    uniforms: { ...uniforms, uMap: { value: atlas.texture }, uOpacity: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) }, uHaze: { value: new THREE.Color(AERO.haze) }, uHazeAmount: { value: 0 } },
    ...extra,
  });

  // items: [{ x, y, z, name, scale?, phase? }]. Returns the layer, whose meshes are added to `parent`.
  // haze (0 to 1) fades the whole layer toward the horizon haze, for scenery far out.
  function layer(parent, items, { decal = false, transparent = false, opacity = 1, haze = 0, minZoom = 0, maxZoom = Infinity, renderOrder = 0, name = 'sprites' } = {}) {
    const mat = material(decal ? DECAL_VS : BILLBOARD_VS, transparent ? { transparent: true, depthWrite: false } : {});
    mat.uniforms.uOpacity.value = opacity;
    mat.uniforms.uHazeAmount.value = haze;
    const chunks = new Map();
    for (const it of items) {
      const k = chunkKey(it.x, it.z, CHUNK);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(it);
    }
    const group = new THREE.Group();
    group.name = name;
    const m4 = new THREE.Matrix4();
    for (const list of chunks.values()) {
      const n = list.length, mesh = new THREE.InstancedMesh(quad, mat, n);
      const uv = new Float32Array(n * 4), size = new Float32Array(n * 3), phase = new Float32Array(n);
      let maxH = 0;
      list.forEach((it, i) => {
        const s = atlas.sprites[it.name];
        if (!s) throw new Error(`No sprite "${it.name}"`);
        const k = it.scale ?? 1;
        mesh.setMatrixAt(i, m4.makeTranslation(it.x, it.y ?? 0, it.z));
        uv.set(s.uv, i * 4);
        size.set([s.w * k, s.h * k, decal ? 0 : (s.sway ?? 0)], i * 3);
        phase[i] = it.phase ?? (it.x * .37 + it.z * .21);
        maxH = Math.max(maxH, s.h * k * 1.25, s.w * k);
      });
      mesh.geometry = quad.clone();
      mesh.geometry.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 4));
      mesh.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3));
      mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += maxH; // the shader moves vertices up to one sprite size from the base
      mesh.renderOrder = renderOrder;
      group.add(mesh);
    }
    parent.add(group);
    const l = { group, minZoom, maxZoom, material: mat };
    layers.push(l);
    return l;
  }

  // A layer whose instances move every frame (people, their shadows). Not chunked: the caller culls by writing
  // only visible instances and setting mesh.count. A decal layer lies flat; aPhase turns each instance.
  function dynamicLayer(parent, count, { minZoom = 0, decal = false, transparent = false, opacity = 1, renderOrder = 0 } = {}) {
    const mat = material(decal ? DECAL_VS : BILLBOARD_VS, transparent ? { transparent: true, depthWrite: false } : {});
    mat.uniforms.uOpacity.value = opacity;
    const mesh = new THREE.InstancedMesh(quad, mat, count);
    mesh.geometry = quad.clone();
    const uv = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4), size = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    uv.setUsage(THREE.DynamicDrawUsage); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aUv', uv); mesh.geometry.setAttribute('aSize', size);
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    phase.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aPhase', phase);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    parent.add(mesh);
    const l = { group: mesh, minZoom, maxZoom: Infinity, material: mat, mesh, uv, size, phase };
    layers.push(l);
    return l;
  }

  // An instanced sprite mesh whose matrices the caller owns (for the sim's zone layer). names(i) picks each slot's sprite.
  function slots(count, names) {
    const mat = material(BILLBOARD_VS), mesh = new THREE.InstancedMesh(quad, mat, Math.max(1, count));
    mesh.geometry = quad.clone();
    const uv = new Float32Array(Math.max(1, count) * 4), size = new Float32Array(Math.max(1, count) * 3), phase = new Float32Array(Math.max(1, count));
    for (let i = 0; i < count; i++) { const s = atlas.sprites[names(i)]; uv.set(s.uv, i * 4); size.set([s.w, s.h, s.sway ?? 0], i * 3); phase[i] = i * .7; }
    mesh.geometry.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 4));
    mesh.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3));
    mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    return mesh;
  }

  // Far-zoom canopies: flat discs on the ground, one per tree, so woods read as solid green where single
  // sprites would be sub-pixel speckle. color(i) gives each disc's colour; the caller sets matrices, whose x/z scale
  // multiplies radius (metres). Discs sit just above the ground cover.
  const disc = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2).translate(0, .3, 0);
  const discMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  function canopySlots(count, color, radius = 1) {
    const mesh = new THREE.InstancedMesh(radius === 1 ? disc : disc.clone().scale(radius, 1, radius), discMat, Math.max(1, count));
    for (let i = 0; i < count; i++) mesh.setColorAt(i, color(i));
    mesh.receiveShadow = true;
    return mesh;
  }
  // Chunked canopy discs for fixed trees: items [{ x, y?, z, r, color }], y lifting a disc onto raised ground.
  function canopyLayer(parent, items, { minZoom = 0, maxZoom = Infinity, name = 'canopy' } = {}) {
    const chunks = new Map(), group = new THREE.Group(), m4 = new THREE.Matrix4();
    group.name = name;
    for (const it of items) {
      const k = chunkKey(it.x, it.z, CHUNK);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(it);
    }
    for (const list of chunks.values()) {
      const mesh = canopySlots(list.length, i => list[i].color);
      list.forEach((it, i) => mesh.setMatrixAt(i, m4.makeScale(it.r, 1, it.r).setPosition(it.x, it.y ?? 0, it.z)));
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    parent.add(group);
    return lod(group, { minZoom, maxZoom });
  }
  // Puts any object under the same zoom rule as the sprite layers: shown while minZoom <= ppm < maxZoom.
  function lod(object, { minZoom = 0, maxZoom = Infinity } = {}) { layers.push({ group: object, minZoom, maxZoom }); return object; }

  return {
    layer, dynamicLayer, slots, canopySlots, canopyLayer, lod,
    get managed() { return layers.map(l => l.group); }, // every object whose visibility follows the zoom
    // Per frame: camera axes for billboards, wind time, and level-of-detail visibility.
    update(camera, time, ppm) {
      uniforms.uTime.value = time;
      uniforms.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
      for (const l of layers) l.group.visible = ppm >= l.minZoom && ppm < l.maxZoom;
    },
  };
}
