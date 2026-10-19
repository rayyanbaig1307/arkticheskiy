import * as THREE from 'three';
import { atmos } from './Atmos.js';
import { NO_REFLECT } from './Reflection.js';

// Snow and breath.
//
// Snow: points in a box that travels with the camera; each flake falls at its own speed, drifts
// downwind and flutters, and wraps round the box, all on the GPU (a fixed vertex buffer, nothing
// updated per frame). Flakes inside the boat's rooms (its ZONE boxes, in boat space) or under the
// water are dropped, so it never snows on the bridge. Lit by the key light and the sky, a little
// brighter near the lamps' glow.
//
// Breath: soft puffs in the cold air from everyone outside (Crew.mouths(), every few seconds, more
// while talking), the walruses, and your own breath just in front of you when you're on deck.
// The puffs stay in the air as the boat moves on, so they stream away astern.

const MAX_ROOMS = 8;

const SNOW_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uBox, uSize, uDensity;
uniform vec3 uCam, uWindV;
uniform mat4 uBoatInv;
uniform vec3 uRoomMin[${MAX_ROOMS}], uRoomMax[${MAX_ROOMS}];
varying float vAlpha;
void main(){
  float fall = mix(.55, 1.3, aSeed.w);
  vec3 p = aSeed.xyz * uBox;
  p.y -= uTime * fall;
  p.xz += uWindV.xz * uTime * (0.8 + 0.4 * aSeed.w);
  p.x += sin(uTime * (0.7 + aSeed.y) + aSeed.z * 30.) * .35;
  p.z += cos(uTime * (0.6 + aSeed.x) + aSeed.y * 30.) * .35;
  p = mod(p - uCam + uBox * .5, uBox) + uCam - uBox * .5;
  vAlpha = step(aSeed.w, uDensity);
  vec3 b = (uBoatInv * vec4(p, 1.)).xyz;
  for (int i = 0; i < ${MAX_ROOMS}; i++)
    if (all(greaterThan(b, uRoomMin[i])) && all(lessThan(b, uRoomMax[i]))) vAlpha = 0.;
  if (p.y < -0.2) vAlpha = 0.;
  vec4 mv = viewMatrix * vec4(p, 1.);
  float d = -mv.z;
  vAlpha *= smoothstep(.15, 1.2, d) * (1. - smoothstep(uBox * .35, uBox * .5, d));
  gl_PointSize = min(uSize * (0.6 + 0.8 * aSeed.y) / max(d, .1), 9.);
  gl_Position = projectionMatrix * mv;
}`;

const SNOW_FRAG = /* glsl */ `
uniform vec3 uLight;
varying float vAlpha;
void main(){
  if (vAlpha <= 0.) discard;
  vec2 c = gl_PointCoord - .5;
  float r = dot(c, c) * 4.;
  float a = (1. - smoothstep(.2, 1., r)) * vAlpha * .85;
  if (a < .01) discard;
  gl_FragColor = vec4(uLight, a);
}`;

const PUFF_VERT = /* glsl */ `
attribute float aAge, aLife, aSize;
uniform float uScale;
varying float vA;
void main(){
  float t = clamp(aAge / aLife, 0., 1.);
  vA = aAge < 0. ? 0. : sin(t * 3.14159) * (1. - t * .4) * .3;
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  gl_PointSize = aSize * (0.4 + t * 1.6) * uScale / max(-mv.z, .05);
  gl_Position = projectionMatrix * mv;
}`;

const PUFF_FRAG = /* glsl */ `
uniform vec3 uLight;
varying float vA;
void main(){
  vec2 c = gl_PointCoord - .5;
  float r = dot(c, c) * 4.;
  float a = (1. - smoothstep(0., 1., r)) * vA;
  if (a < .005) discard;
  gl_FragColor = vec4(uLight, a);
}`;

export class Weather {
  constructor({ scene, quality, boat, model }) {
    this.boat = boat; this.model = model;
    const n = quality.snow;
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const rooms = model.zones.slice(0, MAX_ROOMS);
    this.snowU = {
      uTime: { value: 0 }, uBox: { value: 46 }, uSize: { value: 38 * Math.min(1.5, window.devicePixelRatio * quality.scale) }, uDensity: { value: 1 },
      uCam: { value: new THREE.Vector3() }, uWindV: { value: new THREE.Vector3(-1.4, 0, 0.8) },
      uBoatInv: { value: new THREE.Matrix4() }, uLight: { value: new THREE.Color(1, 1, 1) },
      uRoomMin: { value: Array.from({ length: MAX_ROOMS }, (_, i) => (rooms[i] ? rooms[i].box.min.clone().addScalar(-0.15) : new THREE.Vector3(1e6, 1e6, 1e6))) },
      uRoomMax: { value: Array.from({ length: MAX_ROOMS }, (_, i) => (rooms[i] ? rooms[i].box.max.clone().addScalar(0.15) : new THREE.Vector3(-1e6, -1e6, -1e6))) },
    };
    this.snow = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.snowU, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false }));
    this.snow.frustumCulled = false; this.snow.layers.set(NO_REFLECT); this.snow.renderOrder = 5;
    scene.add(this.snow);

    // breath puffs: a ring buffer of particles, written each frame
    this.N = 320;
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(this.N * 3); this.pVel = new Float32Array(this.N * 3);
    this.pAge = new Float32Array(this.N).fill(-1); this.pLife = new Float32Array(this.N).fill(1); this.pSize = new Float32Array(this.N);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aAge', new THREE.BufferAttribute(this.pAge, 1).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aLife', new THREE.BufferAttribute(this.pLife, 1));
    pg.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.puffU = { uScale: { value: 160 * Math.min(1.5, window.devicePixelRatio * quality.scale) }, uLight: { value: new THREE.Color(0.6, 0.65, 0.7) } };
    this.puffs = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: this.puffU, vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, transparent: true, depthWrite: false }));
    this.puffs.frustumCulled = false; this.puffs.layers.set(NO_REFLECT); this.puffs.renderOrder = 6;
    scene.add(this.puffs);
    this.head = 0;
    this.breathT = new Map();
    this.myBreath = 2;
    this.wind = new THREE.Vector3(-1.4, 0, 0.8);
  }

  emit(pos, vel, n, size = 0.25, life = 1.8) {
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.N;
      this.pPos[i * 3] = pos.x + (Math.random() - 0.5) * 0.03; this.pPos[i * 3 + 1] = pos.y + (Math.random() - 0.5) * 0.03; this.pPos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.03;
      this.pVel[i * 3] = vel.x + (Math.random() - 0.5) * 0.12; this.pVel[i * 3 + 1] = vel.y + 0.08 + Math.random() * 0.08; this.pVel[i * 3 + 2] = vel.z + (Math.random() - 0.5) * 0.12;
      this.pAge[i] = -k * 0.05; this.pLife[i] = life * (0.8 + Math.random() * 0.4); this.pSize[i] = size * (0.7 + Math.random() * 0.6);
    }
    this.puffs.geometry.attributes.aLife.needsUpdate = true; this.puffs.geometry.attributes.aSize.needsUpdate = true;
  }

  update(dt, { camera, params, crew, animals, player, indoor }) {
    const u = this.snowU;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    u.uBoatInv.value.copy(this.boat.root.matrixWorld).invert();
    u.uDensity.value = params ? params.snow : 1;
    // wind relative to the snow: the true wind (from the north-west) plus the boat's own way
    this.wind.set(-1.4, 0, 0.8);
    u.uWindV.value.copy(this.wind);
    // the flakes' light: the key light from above and the sky round about
    if (params) {
      const amb = params.hemiSky.clone().multiplyScalar(params.hemiIntensity * 2.2);
      const key = params.keyColor.clone().multiplyScalar(params.keyIntensity * Math.max(0.15, params.keyDir.y) * 0.9);
      u.uLight.value.copy(amb.add(key)).multiplyScalar(1.15);
      this.puffU.uLight.value.copy(u.uLight.value).multiplyScalar(0.8);
    }
    // breath from the crew outside
    if (crew) {
      for (const m of crew.mouths(this._m || (this._m = []))) {
        let t = this.breathT.get(m.p) ?? Math.random() * 3;
        t -= dt * (m.talking ? 2.2 : 1);
        if (t <= 0) {
          t = 3 + Math.random() * 1.5;
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(m.p.root.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(0.45);
          this.emit(m.pos, fwd, m.talking ? 4 : 6, 0.22, 1.6);
        }
        this.breathT.set(m.p, t);
      }
    }
    // the walruses' great snorting breaths, the penguins' little ones
    if (animals) {
      for (const m of animals.mouths(camera, this._am || (this._am = []))) {
        let t = this.breathT.get(m.a) ?? Math.random() * 4;
        t -= dt;
        if (t <= 0) {
          t = m.big ? 3.5 + Math.random() * 2 : 2.5 + Math.random() * 2;
          this.emit(m.pos, m.fwd.clone().multiplyScalar(m.big ? 0.6 : 0.25), m.big ? 9 : 3, m.big ? 0.4 : 0.1, m.big ? 2.2 : 1.2);
        }
        this.breathT.set(m.a, t);
      }
    }
    // your own breath, on deck, every few seconds just below and in front of your eyes
    if (player && !indoor && (this.myBreath -= dt) <= 0) {
      this.myBreath = 3.6 + Math.random() * 1.2;
      const f = new THREE.Vector3(0, -0.25, -1).applyQuaternion(camera.quaternion);
      const p = camera.position.clone().addScaledVector(f, 0.28);
      this.emit(p, f.multiplyScalar(0.35), 6, 0.11, 1.4);
    }
    // the puffs: drift with the air, slow, rise a little
    for (let i = 0; i < this.N; i++) {
      if (this.pAge[i] > this.pLife[i]) continue;
      this.pAge[i] += dt;
      if (this.pAge[i] < 0) continue;
      const d = Math.exp(-dt * 1.6);
      this.pVel[i * 3] = this.pVel[i * 3] * d + this.wind.x * 0.15 * dt;
      this.pVel[i * 3 + 1] = this.pVel[i * 3 + 1] * d + 0.05 * dt;
      this.pVel[i * 3 + 2] = this.pVel[i * 3 + 2] * d + this.wind.z * 0.15 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt; this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt; this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    this.puffs.geometry.attributes.position.needsUpdate = true;
    this.puffs.geometry.attributes.aAge.needsUpdate = true;
    void atmos;
  }
}
