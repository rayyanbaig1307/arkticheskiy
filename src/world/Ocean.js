import * as THREE from 'three';
import { atmos, ATMOS_GLSL } from './Atmos.js';
import { WAVES_GLSL } from './Waves.js';

// The sea. One radial grid centred under the camera (dense close by, kilometres wide at the rim),
// moved in whole grid steps so the waves don't swim. Vertices take the Gerstner swell; every pixel
// recomputes the waves' normal exactly and adds two scrolling detail normals.
//
// Shading: Fresnel between the deep water's colour (with light scattered through the wave crests)
// and the reflection: the planar render (world/Reflection.js) where there is one, the sky cube
// beyond it. The moon's or the sun's glitter on top. Foam comes from the foam map (world/Foam.js:
// the boat's bow wave and wake, and the ice's waterline, rendered top-down around the boat) and
// from crests that fold over. Inside the hull the water is cut away, so the engine room is dry.

const VERT = /* glsl */ `
${WAVES_GLSL}
uniform vec3 uCenter;
varying vec3 vWorld;
varying vec2 vGrid;
varying float vFold;
varying float vDist;
void main(){
  vec3 p = position + vec3(uCenter.x, 0., uCenter.z);
  float dist = length(p.xz - cameraPosition.xz);
  vec3 N; float fold;
  vec3 d = gerstner(p.xz, dist, N, fold);
  vGrid = p.xz; vFold = fold; vDist = dist;
  p += d;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;

const FRAG = /* glsl */ `
${WAVES_GLSL}
${ATMOS_GLSL}
varying vec3 vWorld;
varying vec2 vGrid;
varying float vFold;
varying float vDist;
uniform sampler2D tNormal, tFoamTex, tReflect, tFoamMap;
uniform samplerCube tSky;
uniform mat4 uReflectMatrix;
uniform float uReflectOn;
uniform vec3 uDeep, uScatter;
uniform float uKeyIntensity, uEnvIntensity, uExposureHint;
uniform vec3 uHemi;
// the hull: its waterline half-breadth, sampled along its length in boat space
uniform mat4 uBoatInv;
uniform float uHull[24];
uniform vec2 uHullRange;   // z of the bow, z of the stern (boat space)
// the foam map: a square of side uFoamSize centred at uFoamCenter (world xz)
uniform vec2 uFoamCenter;
uniform float uFoamSize, uFoamOn;

float hullHalf(float z){
  float t = clamp((z - uHullRange.x) / (uHullRange.y - uHullRange.x), 0., 1.) * 23.;
  int i = int(floor(t)); float f = fract(t);
  return mix(uHull[i], uHull[min(i + 1, 23)], f);
}

void main(){
  // inside the hull: no water
  vec3 bl = (uBoatInv * vec4(vWorld, 1.)).xyz;
  if (bl.z > uHullRange.x && bl.z < uHullRange.y && abs(bl.x) < hullHalf(bl.z) - .04 && bl.y < 3.) discard;

  vec3 Nw; float fold;
  gerstner(vGrid, vDist, Nw, fold);
  // detail: two scrolling normal maps, flattened with distance
  vec2 uv = vWorld.xz;
  vec3 n1 = texture2D(tNormal, uv * .045 + vec2(uTime * .011, uTime * .007)).xyz * 2. - 1.;
  vec3 n2 = texture2D(tNormal, uv * .13 + vec2(-uTime * .017, uTime * .021)).xyz * 2. - 1.;
  vec3 n3 = texture2D(tNormal, uv * .37 + vec2(uTime * .031, -uTime * .026)).xyz * 2. - 1.;
  float far = smoothstep(30., 900., vDist);
  vec2 dn = (n1.xy * .55 + n2.xy * .35 + n3.xy * .22 * (1. - far)) * mix(.55, .12, far);
  vec3 N = normalize(vec3(Nw.x + dn.x, Nw.y, Nw.z + dn.y));

  vec3 V = normalize(cameraPosition - vWorld);
  float NdV = max(dot(N, V), 0.);
  float F = .02 + .98 * pow(1. - NdV, 5.);
  F = mix(F, .35, far * .5);   // the far sea flattens to a sheen

  // reflection: the planar render where it exists (distorted by the normal), else the sky cube
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = textureCube(tSky, R).rgb * uEnvIntensity;
  if (uReflectOn > .5){
    vec4 rc = uReflectMatrix * vec4(vWorld.x, 0., vWorld.z, 1.);
    vec2 ruv = rc.xy / rc.w + N.xz * .05 * (1. - far);
    if (ruv.x > 0. && ruv.x < 1. && ruv.y > 0. && ruv.y < 1.){
      vec4 pr = texture2D(tReflect, ruv);
      refl = mix(refl, pr.rgb, pr.a);
    }
  }

  // the body of the water: dark, with light scattered through the crests and the waves' backs
  float crest = clamp((vWorld.y + .1) * .9, 0., 1.);
  float back = pow(max(dot(-V, uKeyDir) * .5 + .5, 0.), 3.);
  vec3 body = uDeep + uScatter * (crest * (.25 + back) * .6 + pow(max(dot(N, uKeyDir), 0.), 2.) * .08) * uKeyIntensity;
  body += uDeep * 2. * (1. - smoothstep(.0, .6, NdV)) * .2;

  vec3 col = mix(body, refl, F);

  // glitter: the key light's highlight (GGX-ish on the detail normals)
  vec3 H = normalize(V + uKeyDir);
  float nh = max(dot(N, H), 0.);
  float rough = mix(.06, .14, far);
  float a2 = rough * rough;
  float dd = nh * nh * (a2 - 1.) + 1.;
  float spec = a2 / (3.14159 * dd * dd);
  col += uKeyColor * uKeyIntensity * spec * F * 1.6 * smoothstep(-.02, .1, uKeyDir.y);

  // foam: the map around the boat (wake, bow wave, ice) and folding crests
  float foam = 0.;
  if (uFoamOn > .5){
    // (the map's camera looks down with -z up the texture)
    vec2 fuv = vec2((vWorld.x - uFoamCenter.x) / uFoamSize + .5, .5 - (vWorld.z - uFoamCenter.y) / uFoamSize);
    if (fuv.x > 0. && fuv.x < 1. && fuv.y > 0. && fuv.y < 1.){
      vec4 fm = texture2D(tFoamMap, fuv);
      vec4 fb = textureLod(tFoamMap, fuv, 3.);
      vec4 fw = textureLod(tFoamMap, fuv, 5.);
      float edge = smoothstep(0., 1., fm.r * 1.4 + fb.r * 1.6);        // the ice's waterline
      float wake = fm.g + fb.g * .5;                                      // the wake, the bow wave
      foam = max(edge, wake);
      // ice just under the surface round a berg: the water goes pale turquoise over it
      col += uScatter * fw.r * 2.2 * (1. - F) * (.4 + uKeyIntensity * .4);
    }
  }
  foam += smoothstep(.55, .2, vFold) * .7;
  float ft = texture2D(tFoamTex, uv * .09 + N.xz * .03).r * .6 + texture2D(tFoamTex, uv * .27 - uTime * .01).r * .4;
  float f = smoothstep(.15, .8, foam * (.35 + ft * 1.2));
  vec3 foamCol = (uHemi + uKeyColor * uKeyIntensity * max(uKeyDir.y, 0.) * .9) * .9;
  col = mix(col, foamCol, f * .85);

  gl_FragColor = vec4(applyFog(col, vWorld), 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// a tileable detail normal map: sums of waves on a torus, so it repeats seamlessly
function makeNormalTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  const waves = [];
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const kx = Math.round((r() * 2 - 1) * 12), ky = Math.round((r() * 2 - 1) * 12);
    if (!kx && !ky) continue;
    const k = Math.hypot(kx, ky);
    waves.push([kx, ky, r() * Math.PI * 2, 1 / Math.pow(k, 1.3)]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const [kx, ky, ph, a] of waves) v += a * Math.sin(((kx * x + ky * y) / size) * Math.PI * 2 + ph);
    h[y * size + x] = v;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    const n = new THREE.Vector3(-hx * 2.2, -hy * 2.2, 1).normalize();
    const i = (y * size + x) * 4;
    data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// foam texture: cellular bubbles (tileable worley), single channel
function makeFoamTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const N = 90, pts = [];
  for (let i = 0; i < N; i++) pts.push([r() * size, r() * size]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let d1 = 1e9, d2 = 1e9;
    for (const [px, py] of pts) {
      let dx = Math.abs(x - px), dy = Math.abs(y - py);
      dx = Math.min(dx, size - dx); dy = Math.min(dy, size - dy);
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const e = Math.sqrt(d2) - Math.sqrt(d1);          // bright on the cells' walls
    const v = Math.max(0, 1 - e / 6) * 0.85 + 0.15 * r();
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// the radial grid: rings close together near the centre, kilometres apart at the rim
function makeGrid(rings, segs, R) {
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  const radius = (j) => 0.55 * j + R * Math.pow(j / rings, 3.2);
  for (let j = 1; j <= rings; j++) {
    const r = radius(j);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + ((i + 1) % segs), 1 + i);
  for (let j = 1; j < rings; j++) {
    const a0 = 1 + (j - 1) * segs, b0 = 1 + j * segs;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      idx.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2);
  return g;
}

export class Ocean {
  constructor({ waves, quality, sky }) {
    this.waves = waves;
    this.sky = sky;
    this.uniforms = {
      ...atmos,
      ...waves.uniforms,
      uCenter: { value: new THREE.Vector3() },
      tNormal: { value: makeNormalTexture() },
      tFoamTex: { value: makeFoamTexture() },
      tReflect: { value: null }, uReflectMatrix: { value: new THREE.Matrix4() }, uReflectOn: { value: 0 },
      tFoamMap: { value: null }, uFoamCenter: { value: new THREE.Vector2() }, uFoamSize: { value: 300 }, uFoamOn: { value: 0 },
      tSky: { value: sky.reflectionCube },
      uDeep: { value: new THREE.Color(0.002, 0.012, 0.02) },
      uScatter: { value: new THREE.Color(0.02, 0.16, 0.16) },
      uKeyIntensity: { value: 1 }, uEnvIntensity: { value: 1 }, uExposureHint: { value: 1 },
      uBoatInv: { value: new THREE.Matrix4() },
      uHull: { value: new Float32Array(24) }, uHullRange: { value: new THREE.Vector2(-1, -1) },
      uHemi: { value: new THREE.Color(0.05, 0.07, 0.1) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: false,
    });
    this.mesh = new THREE.Mesh(makeGrid(quality.oceanRings, quality.oceanSegs, 7000), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'Ocean';
    this.mesh.renderOrder = -1;
  }

  // the hull's waterline: half-breadths at 24 stations from bow (zBow) to stern (zStern), boat space
  setHull(halfBreadths, zBow, zStern) {
    this.uniforms.uHull.value.set(halfBreadths);
    this.uniforms.uHullRange.value.set(zBow, zStern);
  }

  update(camera, boatRoot, params) {
    const step = 2.2;
    this.uniforms.uCenter.value.set(Math.round(camera.position.x / step) * step, 0, Math.round(camera.position.z / step) * step);
    if (boatRoot) this.uniforms.uBoatInv.value.copy(boatRoot.matrixWorld).invert();
    if (params) {
      this.uniforms.uKeyIntensity.value = params.keyIntensity * 0.6;
      this.uniforms.uEnvIntensity.value = params.env;
      this.uniforms.uHemi.value.copy(params.hemiSky).multiplyScalar(params.hemiIntensity);
      // the water's own colour follows the light: near black under the moon, grey-green by day
      const day = Math.min(1, params.hemiIntensity * params.hemiSky.g * 2.5);
      this.uniforms.uDeep.value.setRGB(0.001 + 0.02 * day, 0.005 + 0.045 * day, 0.01 + 0.05 * day);
      this.uniforms.uScatter.value.setRGB(0.008 + 0.04 * day, 0.04 + 0.2 * day, 0.05 + 0.18 * day);
    }
  }
}
