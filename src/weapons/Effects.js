import * as THREE from 'three';
import { atmos, ATMOS_GLSL } from '../world/Atmos.js';
import { NO_REFLECT } from '../world/Reflection.js';
import { weaponTextures } from './textures.js';
import { VIEW_LAYER } from './Viewmodel.js';

// What a shot leaves in the world: smoke from the muzzle, brass on the deck, a hit's spray (snow
// puffs, ice chips, sparks off steel, concrete dust, splinters, a dark mist of blood) and small
// bullet holes that fade. Plus the few real lights the weapons ever use.
//
// Two places things live: the frame you stand in (the boat's frame: your brass and your smoke
// ride along with her as she rolls and steams on) and the world (a hit on the ice stays on the
// ice as she moves away). Each has its own particle buffers and decals; a hit chooses by what it
// struck (rootFor).
//
// Lights: a forward renderer pays for every light on every pixel, and changing their number
// recompiles every shader, so the pool is made once at the start (slot 0 the muzzle flash, the
// rest for burning flares) and its lights only ever change intensity. The particles are lit by the
// same pool (smoke glows in the flash, red round a flare) plus an ambient term.
//
// Everything is fixed-size ring buffers written in place: nothing is allocated per frame.

const MAXL = 3;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _s = new THREE.Vector3(), _c = new THREE.Color(), _m2 = new THREE.Matrix4(), Zf = new THREE.Vector3(0, 0, 1), Yu = new THREE.Vector3(0, 1, 0);
const rnd = (a, b) => a + Math.random() * (b - a);

// one spawn's settings, filled in before each burst (no allocation per particle; the recipes
// that run every frame are constants)
const BASE = { life: 1, size0: 0.1, size1: 0.3, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 1, tile: 0, fade: 1.5, cool: 0, floor: -1e9, bounce: 0.3, spin: 1 };
export const S = { ...BASE, set(o) { Object.assign(this, BASE, o); return this; } };
const FLARE_SPARK = { life: 0.55, size0: 0.03, size1: 0.01, r: 4, g: 0.9, b: 0.4, a: 1, grav: 5, drag: 1.2, tile: 2, fade: 1, cool: 1, bounce: 0.3 };
const FLARE_SMOKE = { life: 3.5, size0: 0.08, size1: 0.9, r: 0.75, g: 0.7, b: 0.7, a: 0.3, grav: -0.35, drag: 1.2, tile: 3, fade: 1.5, spin: 0.5 };
const WISP = { life: 1.6, size0: 0.02, size1: 0.12, r: 0.7, g: 0.7, b: 0.72, a: 0.12, grav: -0.25, drag: 1.5, tile: 3, fade: 1.4, spin: 0.4 };
const HOLE = { metal: 0, concrete: 1, wood: 2, ice: 3 }, HOLE_SIZE = [0.035, 0.06, 0.045, 0.07];

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec2 aTR;
attribute float aSize;
uniform float uScale;
uniform vec3 uAmbient;
uniform vec3 uLP[${MAXL}], uLC[${MAXL}];
uniform float uLD[${MAXL}];
varying vec4 vColor;
varying vec2 vTR;
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aColor.a > 0.003 ? min(aSize * uScale / max(-mv.z, .05), 400.) : 0.;
  vec3 c = aColor.rgb;
#ifdef LIT
  vec3 L = uAmbient;
  for (int i = 0; i < ${MAXL}; i++) {
    float k = clamp(1. - distance(wp.xyz, uLP[i]) / max(uLD[i], .001), 0., 1.);
    L += uLC[i] * k * k * .08;
  }
  c *= L;
#endif
  vColor = vec4(c, aColor.a);
  vTR = aTR;
  vWorld = wp.xyz;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec4 vColor;
varying vec2 vTR;
varying vec3 vWorld;
${ATMOS_GLSL}
void main(){
  vec2 p = gl_PointCoord - .5;
  float s = sin(vTR.y), c = cos(vTR.y);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * .96 + .5;
  vec2 uv = (p + vec2(mod(vTR.x, 2.), floor(vTR.x * .5))) * .5;
  vec4 t = texture2D(uAtlas, uv);
  float a = t.a * vColor.a;
  if (a < .003) discard;
  float f = 1. - exp(-fogDepth(vWorld));
#ifdef ADDITIVE
  gl_FragColor = vec4(vColor.rgb * t.rgb * a * (1. - f), 1.);
#else
  gl_FragColor = vec4(mix(vColor.rgb * t.rgb, fogTint(normalize(vWorld - cameraPosition)), f), a);
#endif
}`;

// ---- a ring buffer of point sprites (one draw call)
class Particles {
  constructor(parent, cap, additive, shared) {
    this.cap = cap; this.head = 0; this.live = 0; this.dirty = false;
    const f = (n) => new Float32Array(cap * n);
    this.p = f(3); this.vel = f(3); this.col = f(3);
    this.age = f(1).fill(1); this.life = f(1).fill(1);
    this.s0 = f(1); this.s1 = f(1); this.a0 = f(1); this.grav = f(1); this.drag = f(1); this.fade = f(1); this.cool = f(1); this.floor = f(1); this.bounce = f(1); this.spin = f(1);
    this.tile = f(1); this.rot = f(1);
    this.aColor = f(4); this.aTR = f(2); this.aSize = f(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTR', new THREE.BufferAttribute(this.aTR, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...atmos, ...shared },
      vertexShader: VERT, fragmentShader: FRAG,
      defines: additive ? { ADDITIVE: 1 } : { LIT: 1 },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.layers.set(NO_REFLECT);
    this.points.renderOrder = additive ? 8 : 7;
    parent.add(this.points);
  }

  emit(x, y, z, vx, vy, vz) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = S.r; this.col[i3 + 1] = S.g; this.col[i3 + 2] = S.b;
    this.age[i] = 0; this.life[i] = S.life * rnd(0.75, 1.25);
    const k = rnd(0.8, 1.2);
    this.s0[i] = S.size0 * k; this.s1[i] = S.size1 * k; this.a0[i] = S.a;
    this.grav[i] = S.grav; this.drag[i] = S.drag; this.fade[i] = S.fade; this.cool[i] = S.cool;
    this.floor[i] = S.floor; this.bounce[i] = S.bounce; this.spin[i] = S.spin * rnd(-1, 1);
    this.tile[i] = S.tile; this.rot[i] = Math.random() * 6.283;
    this.dirty = true;
  }

  update(dt) {
    if (!this.dirty) return;
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      const i4 = i * 4;
      if (this.age[i] >= this.life[i]) { this.aColor[i4 + 3] = 0; continue; }
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1) { this.aColor[i4 + 3] = 0; continue; }
      live++;
      const i3 = i * 3, dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.vel[i3] *= dr; this.vel[i3 + 1] *= dr; this.vel[i3 + 2] *= dr;
      this.p[i3] += this.vel[i3] * dt; this.p[i3 + 1] += this.vel[i3 + 1] * dt; this.p[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.p[i3 + 1] < this.floor[i]) {
        this.p[i3 + 1] = this.floor[i];
        this.vel[i3 + 1] = -this.vel[i3 + 1] * this.bounce[i];
        this.vel[i3] *= 0.55; this.vel[i3 + 2] *= 0.55;
      }
      const cool = this.cool[i] * u;
      this.aColor[i4] = this.col[i3];
      this.aColor[i4 + 1] = this.col[i3 + 1] * (1 - 0.6 * cool);
      this.aColor[i4 + 2] = this.col[i3 + 2] * (1 - cool);
      this.aColor[i4 + 3] = this.a0[i] * Math.min(1, u * 12) * Math.pow(1 - u, this.fade[i]);
      this.aSize[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(u);
      this.rot[i] += this.spin[i] * dt;
      this.aTR[i * 2] = this.tile[i]; this.aTR[i * 2 + 1] = this.rot[i];
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = g.aColor.needsUpdate = g.aTR.needsUpdate = g.aSize.needsUpdate = true;
    this.dirty = live > 0;
    this.live = live;
  }
}

// ---- bullet holes: one instanced quad, multiplied into whatever it lies on, fading out
const DECAL_VERT = /* glsl */ `
attribute float aFade;
attribute float aTile;
varying vec2 vUv;
varying float vFade, vTile;
varying vec3 vWorld;
void main(){
  vUv = uv; vFade = aFade; vTile = aTile;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const DECAL_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vFade, vTile;
varying vec3 vWorld;
${ATMOS_GLSL}
void main(){
  vec2 uv = (vUv + vec2(mod(vTile, 2.), floor(vTile * .5))) * .5;
  vec4 t = texture2D(uMap, uv);
  float k = t.a * vFade * exp(-fogDepth(vWorld));
  gl_FragColor = vec4(mix(vec3(1.), t.rgb, k), 1.);
}`;
const HOLD = 30, FADE = 6;

class Decals {
  constructor(parent, cap, map) {
    this.cap = cap; this.head = 0; this.t = new Float32Array(cap).fill(-1);
    this.fade = new Float32Array(cap); this.tileA = new Float32Array(cap);
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('aFade', new THREE.InstancedBufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTile', new THREE.InstancedBufferAttribute(this.tileA, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...atmos, uMap: { value: map } }, vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(NO_REFLECT);
    this.mesh.renderOrder = 4;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
  }

  add(pos, normal, size, tile) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    _q.setFromUnitVectors(Zf, normal);
    _m.makeRotationAxis(Zf, Math.random() * 6.283);
    _m.premultiply(_m2.makeRotationFromQuaternion(_q));
    _m.scale(_s.set(size, size, size)).setPosition(_v.copy(pos).addScaledVector(normal, 0.003));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.t[i] = 0; this.fade[i] = 1; this.tileA[i] = tile;
    this.mesh.geometry.attributes.aFade.needsUpdate = this.mesh.geometry.attributes.aTile.needsUpdate = true;
  }

  update(dt) {
    let changed = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.t[i] < 0) continue;
      this.t[i] += dt;
      if (this.t[i] > HOLD) {
        const f = 1 - (this.t[i] - HOLD) / FADE;
        if (f <= 0) { this.t[i] = -1; this.fade[i] = 0; _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); this.mesh.instanceMatrix.needsUpdate = true; } else this.fade[i] = f;
        changed = true;
      }
    }
    if (changed) this.mesh.geometry.attributes.aFade.needsUpdate = true;
  }
}
// ---- spent cases: a few instanced cylinders with a little physics, landing on the floor you
// stand on, ringing once, lying where they fall a while
const CASES = {
  b9: { r: 0.0049, len: 0.018, mat: 'brass', cap: 24 },
  b762: { r: 0.0057, len: 0.039, mat: 'steel', cap: 36 },
  b762r: { r: 0.0063, len: 0.054, mat: 'brass', cap: 12 },
  flare: { r: 0.0135, len: 0.07, mat: 'flare', cap: 4 },
};
const LIE = 25;

class Brass {
  constructor(parent, lighting) {
    const std = (color, metalness, roughness) => lighting ? lighting.prep(new THREE.MeshStandardMaterial({ color, metalness, roughness })) : new THREE.MeshStandardMaterial({ color, metalness, roughness });
    const mats = { brass: std(0xb38b3f, 1, 0.32), steel: std(0x4c4733, 0.6, 0.5), flare: std(0x8c8378, 0.8, 0.4) };
    this.types = {};
    for (const [k, d] of Object.entries(CASES)) {
      const g = new THREE.CylinderGeometry(d.r, d.r, d.len, 8);
      g.rotateX(Math.PI / 2);
      const mesh = new THREE.InstancedMesh(g, mats[d.mat], d.cap);
      mesh.frustumCulled = false;
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.layers.set(NO_REFLECT);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      _m.makeScale(0, 0, 0);
      for (let i = 0; i < d.cap; i++) mesh.setMatrixAt(i, _m);
      parent.add(mesh);
      const n = d.cap;
      this.types[k] = { d, mesh, head: 0, state: new Uint8Array(n), t: new Float32Array(n), bounces: new Uint8Array(n),
        p: Array.from({ length: n }, () => new THREE.Vector3()), v: Array.from({ length: n }, () => new THREE.Vector3()),
        q: Array.from({ length: n }, () => new THREE.Quaternion()), w: Array.from({ length: n }, () => new THREE.Vector3()) };
    }
  }

  // pos, vel, quat in the frame's space
  eject(kind, pos, vel, quat) {
    const T = this.types[kind];
    if (!T) return;
    const i = T.head; T.head = (T.head + 1) % T.d.cap;
    T.p[i].copy(pos); T.v[i].copy(vel); T.q[i].copy(quat);
    T.w[i].set(rnd(-25, 25), rnd(-6, 6), rnd(-30, 30));
    T.state[i] = 1; T.t[i] = 0; T.bounces[i] = 0;
  }

  update(dt, floorY, onLand) {
    for (const k in this.types) {
      const T = this.types[k];
      let changed = false;
      for (let i = 0; i < T.d.cap; i++) {
        const st = T.state[i];
        if (!st) continue;
        changed = true;
        T.t[i] += dt;
        if (st === 1) {
          const p = T.p[i], v = T.v[i];
          v.y -= 9.8 * dt;
          p.addScaledVector(v, dt);
          const w = T.w[i], a = w.length();
          if (a > 1e-4) T.q[i].premultiply(_q.setFromAxisAngle(_n.copy(w).multiplyScalar(1 / a), a * dt));
          const fl = floorY + T.d.r;
          if (p.y < fl) {
            p.y = fl;
            const soft = onLand(k, p, T.bounces[i]);
            T.bounces[i]++;
            if (soft || T.bounces[i] >= 3 || Math.abs(v.y) < 0.6) {
              // lie on its side, wherever it pointed
              T.state[i] = 2; T.t[i] = 0;
              _n.set(0, 0, 1).applyQuaternion(T.q[i]); _n.y = 0;
              const yaw = Math.atan2(_n.x, _n.z);
              T.q[i].setFromAxisAngle(Yu, yaw);
              if (soft) p.y -= T.d.r * 0.8;          // (half sunk in the snow)
            } else {
              v.y = -v.y * 0.35; v.x *= 0.5; v.z *= 0.5; w.multiplyScalar(0.5);
            }
          }
          if (T.t[i] > 6) T.state[i] = 2;
        } else if (T.t[i] > LIE) {
          T.state[i] = 0;
          T.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
          continue;
        }
        _m.compose(T.p[i], T.q[i], _s.set(1, 1, 1));
        T.mesh.setMatrixAt(i, _m);
      }
      if (changed) T.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// ---- the pool of lights (made once, never added to or taken away)
export class LightPool {
  constructor(scene, n) {
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      l.layers.enable(VIEW_LAYER);
      scene.add(l);
      this.lights.push(l);
    }
    this.flashT = 0; this.flashDur = 1; this.flashPeak = 0;
  }
  muzzle(pos, color, peak, dist = 9, dur = 0.06) {
    const l = this.lights[0];
    l.position.copy(pos); l.color.setRGB(color[0], color[1], color[2]); l.distance = dist;
    this.flashPeak = peak; this.flashT = dur; this.flashDur = dur;
    l.intensity = peak;
  }
  update(dt) {
    const l = this.lights[0];
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / this.flashDur);
      l.intensity = this.flashPeak * k * k;
    } else l.intensity = 0;
  }
}

// ---- the whole set
export class Effects {
  constructor({ scene, lighting = null, frame = null, flareLights = 2 }) {
    this.scene = scene;
    const tex = weaponTextures();
    this.pool = new LightPool(scene, 1 + flareLights);
    this.ambient = new THREE.Color(0.22, 0.25, 0.3);
    this.autoAmbient = true;
    this.lighting = lighting;
    const n = Math.min(MAXL, this.pool.lights.length);
    this.shared = {
      uAtlas: { value: tex.atlas }, uScale: { value: 600 }, uAmbient: { value: this.ambient },
      uLP: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
      uLC: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
      uLD: { value: new Array(MAXL).fill(1) },
    };
    this.nLit = n;
    const root = (name, parent) => { const g = new THREE.Group(); g.name = name; parent.add(g); return g; };
    this.worldGroup = root('WeaponFX.world', scene);
    this.frameGroup = root('WeaponFX.frame', frame || scene);
    this.frame = frame;
    const set = (g, nA, nB) => ({ group: g, alpha: new Particles(g, nA, false, this.shared), add: new Particles(g, nB, true, this.shared), decals: new Decals(g, 48, tex.holes) });
    this.W = set(this.worldGroup, 480, 420);
    this.F = set(this.frameGroup, 320, 260);
    this.brass = new Brass(this.frameGroup, lighting);
    this.frameInv = new THREE.Matrix4();
    this.frameQ = new THREE.Quaternion(); this.frameQinv = new THREE.Quaternion();
    // (the points' size in pixels at one metre: set from the renderer as they draw)
    const scaleU = this.shared.uScale, size = new THREE.Vector2();
    const onBefore = (renderer, scene2, camera) => { renderer.getDrawingBufferSize(size); scaleU.value = size.y * 0.5 * camera.projectionMatrix.elements[5]; };
    for (const R of [this.W, this.F]) { R.alpha.points.onBeforeRender = onBefore; R.add.points.onBeforeRender = onBefore; }
    this.floorF = 0;
    this.onLand = null;          // (kind, worldPos, bounce) -> true if it fell soft (snow)
    this.landed = (kind, p, bounce) => (this.onLand ? this.onLand(kind, this.fromRoot(this.F, p, _v), bounce) : false);
  }

  // the frame things ride in (the boat's root; null: the world)
  setFrame(frame) {
    this.frame = frame;
    (frame || this.scene).add(this.frameGroup);
  }

  // once a frame before anything spawns: the frame's transform
  begin() {
    const f = this.frame;
    if (f) {
      this.frameInv.copy(f.matrixWorld).invert();
      f.matrixWorld.decompose(_v, this.frameQ, _s);
      this.frameQinv.copy(this.frameQ).invert();
    } else { this.frameInv.identity(); this.frameQ.identity(); this.frameQinv.identity(); }
  }

  // world -> a root's space ('F' the frame, 'W' the world)
  toRoot(R, world, out) { return R === this.F ? out.copy(world).applyMatrix4(this.frameInv) : out.copy(world); }
  dirToRoot(R, world, out) { return R === this.F ? out.copy(world).applyQuaternion(this.frameQinv) : out.copy(world); }
  fromRoot(R, local, out) { return R === this.F && this.frame ? out.copy(local).applyMatrix4(this.frame.matrixWorld) : out.copy(local); }

  // a hit belongs to the frame if it struck something in it (hit.object), the world otherwise
  rootFor(hit) {
    if (!this.frame) return this.W;
    const o = hit && hit.object;
    if (!o) return this.F;
    for (let p = o; p; p = p.parent) if (p === this.frame) return this.F;
    return this.W;
  }

  // ---- recipes
  muzzle(world, dir, def) {
    const R = this.F, p = this.toRoot(R, world, _v), d = this.dirToRoot(R, dir, _w);
    const big = def.flash.smoke;
    S.set({ life: 1.8, size0: 0.04, size1: 0.28 + big * 0.03, r: 0.62, g: 0.62, b: 0.64, a: 0.28 + big * 0.02, grav: -0.12, drag: 2.8, tile: 3, fade: 1.6, spin: 0.6 });
    for (let i = 0; i < big; i++) {
      const s = rnd(0.4, 2.2);
      R.alpha.emit(p.x + d.x * 0.02 * i, p.y + d.y * 0.02 * i, p.z + d.z * 0.02 * i, d.x * s + rnd(-0.2, 0.2), d.y * s + rnd(0, 0.25), d.z * s + rnd(-0.2, 0.2));
    }
    const c = def.flash.color;
    S.set({ life: 0.12, size0: 0.012, size1: 0.006, r: c[0] * 0.6, g: c[1] * 0.6, b: c[2] * 0.6, a: 1, grav: 3, drag: 1.5, tile: 2, fade: 1, cool: 1 });
    const sparks = def.id === 'flaregun' ? 10 : def.id === 'mosin' ? 5 : 2;
    for (let i = 0; i < sparks; i++) {
      const s = rnd(3, 9);
      R.add.emit(p.x, p.y, p.z, d.x * s + rnd(-1, 1), d.y * s + rnd(-1, 1), d.z * s + rnd(-1, 1));
    }
  }

  // a wisp of smoke off a hot barrel
  wisp(world) {
    const R = this.F, p = this.toRoot(R, world, _v);
    S.set(WISP);
    R.alpha.emit(p.x, p.y, p.z, rnd(-0.03, 0.03), 0.06, rnd(-0.03, 0.03));
  }

  impact(hit, dir) {
    const R = this.rootFor(hit);
    const p = this.toRoot(R, hit.point, _v), n = this.dirToRoot(R, hit.normal, _n).normalize(), d = this.dirToRoot(R, dir, _w);
    const floor = n.y > 0.6 ? p.y : -1e9;
    const spray = (sys, count, sMin, sMax, spread, along = 0) => {
      for (let i = 0; i < count; i++) {
        const s = rnd(sMin, sMax);
        sys.emit(p.x + n.x * 0.01, p.y + n.y * 0.01, p.z + n.z * 0.01,
          (n.x + rnd(-spread, spread)) * s - d.x * along, (n.y + rnd(-spread, spread)) * s - d.y * along + rnd(0, 0.5), (n.z + rnd(-spread, spread)) * s - d.z * along);
      }
    };
    switch (hit.surface) {
      case 'snow':
        S.set({ life: 1.6, size0: 0.08, size1: 0.5, r: 0.92, g: 0.94, b: 0.98, a: 0.75, grav: 0.4, drag: 2.6, tile: 0, fade: 1.3 });
        spray(R.alpha, 9, 0.6, 2.4, 0.7);
        S.set({ life: 0.9, size0: 0.025, size1: 0.02, r: 0.95, g: 0.96, b: 1, a: 1, grav: 9.8, drag: 0.6, tile: 1, fade: 0.6, floor, bounce: 0.1 });
        spray(R.alpha, 7, 1.5, 3.5, 0.6);
        break;
      case 'ice':
        S.set({ life: 0.9, size0: 0.022, size1: 0.018, r: 0.78, g: 0.88, b: 0.98, a: 1, grav: 9.8, drag: 0.4, tile: 1, fade: 0.5, floor, bounce: 0.3, spin: 8 });
        spray(R.alpha, 11, 2, 5, 0.8);
        S.set({ life: 0.9, size0: 0.05, size1: 0.28, r: 0.85, g: 0.92, b: 1, a: 0.45, grav: 0.2, drag: 3, tile: 0, fade: 1.5 });
        spray(R.alpha, 4, 0.4, 1.2, 0.5);
        break;
      case 'metal':
        S.set({ life: 0.45, size0: 0.02, size1: 0.008, r: 3.5, g: 2.0, b: 0.8, a: 1, grav: 9.8, drag: 0.7, tile: 2, fade: 1, cool: 1, floor, bounce: 0.35 });
        spray(R.add, 14, 2, 7, 0.9, -1.5);
        S.set({ life: 0.7, size0: 0.04, size1: 0.18, r: 0.3, g: 0.29, b: 0.28, a: 0.4, grav: 0.1, drag: 3, tile: 3, fade: 1.4 });
        spray(R.alpha, 3, 0.3, 1, 0.5);
        break;
      case 'concrete':
        S.set({ life: 0.8, size0: 0.02, size1: 0.016, r: 0.5, g: 0.48, b: 0.45, a: 1, grav: 9.8, drag: 0.5, tile: 1, fade: 0.5, floor, bounce: 0.25, spin: 6 });
        spray(R.alpha, 8, 1.5, 4, 0.8);
        S.set({ life: 2.2, size0: 0.06, size1: 0.55, r: 0.55, g: 0.52, b: 0.48, a: 0.5, grav: -0.04, drag: 2.2, tile: 3, fade: 1.6 });
        spray(R.alpha, 7, 0.3, 1.4, 0.7);
        break;
      case 'wood':
        S.set({ life: 0.8, size0: 0.02, size1: 0.015, r: 0.48, g: 0.32, b: 0.2, a: 1, grav: 9.8, drag: 0.6, tile: 1, fade: 0.5, floor, bounce: 0.2, spin: 10 });
        spray(R.alpha, 8, 1.5, 4, 0.8);
        S.set({ life: 1.4, size0: 0.05, size1: 0.3, r: 0.42, g: 0.35, b: 0.27, a: 0.4, grav: 0, drag: 2.5, tile: 3, fade: 1.5 });
        spray(R.alpha, 4, 0.3, 1, 0.6);
        break;
      case 'flesh':
        S.set({ life: 0.8, size0: 0.05, size1: 0.42, r: 0.2, g: 0.012, b: 0.01, a: 0.7, grav: 0.3, drag: 3.2, tile: 3, fade: 1.3 });
        spray(R.alpha, 6, 0.4, 1.6, 0.6, -1.5);
        S.set({ life: 0.7, size0: 0.016, size1: 0.012, r: 0.14, g: 0.006, b: 0.005, a: 1, grav: 9.8, drag: 0.8, tile: 1, fade: 0.5, floor: p.y - 1.8 });
        spray(R.alpha, 10, 1, 3, 0.7, -2.5);
        break;
      default:
        S.set({ life: 1.2, size0: 0.04, size1: 0.3, r: 0.5, g: 0.5, b: 0.5, a: 0.4, grav: 0, drag: 2.5, tile: 3, fade: 1.5 });
        spray(R.alpha, 5, 0.3, 1.2, 0.7);
    }
    const tile = HOLE[hit.surface];
    if (tile !== undefined) R.decals.add(p, n, HOLE_SIZE[tile], tile);
  }

  // a burning flare: sparks spitting up, thick smoke rolling off (lit red by its own light)
  flareBurn(R, p, dt, strength = 1) {
    this.fAcc = (this.fAcc || 0) + dt * 40 * strength;
    S.set(FLARE_SPARK); S.floor = p.y - 0.05;
    while (this.fAcc >= 1) {
      this.fAcc -= 1;
      R.add.emit(p.x, p.y, p.z, rnd(-0.8, 0.8), rnd(1, 3), rnd(-0.8, 0.8));
    }
    this.sAcc = (this.sAcc || 0) + dt * 7 * strength;
    S.set(FLARE_SMOKE);
    while (this.sAcc >= 1) {
      this.sAcc -= 1;
      R.alpha.emit(p.x, p.y + 0.05, p.z, rnd(-0.15, 0.15), rnd(0.2, 0.5), rnd(-0.15, 0.15));
    }
  }

  // the cases: kind 'b9' | 'b762' | 'b762r' | 'flare', from a world point with a world velocity
  eject(kind, world, vel, quat) {
    const R = this.F;
    this.brass.eject(kind, this.toRoot(R, world, _v), this.dirToRoot(R, vel, _w), _q.copy(this.frameQinv).multiply(quat));
  }

  update(dt) {
    this.pool.update(dt);
    // the particles' light: the pool's lights (world positions) and the key light as ambient
    const L = this.pool.lights, sh = this.shared;
    for (let i = 0; i < MAXL; i++) {
      const l = L[i];
      if (l) { sh.uLP.value[i].copy(l.position); sh.uLC.value[i].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity); sh.uLD.value[i] = l.distance; } else sh.uLC.value[i].set(0, 0, 0);
    }
    if (this.autoAmbient && this.lighting?.csm?.lights?.length) {
      const k = this.lighting.csm.lights[0];
      _c.copy(k.color).multiplyScalar(k.intensity * 0.22);
      const indoor = atmos.uIndoor.value;
      this.ambient.setRGB(0.03 + _c.r, 0.035 + _c.g, 0.045 + _c.b).multiplyScalar(1 - 0.75 * indoor);
    }
    for (let i = 0; i < 2; i++) { const R = i ? this.F : this.W; R.alpha.update(dt); R.add.update(dt); R.decals.update(dt); }
    this.brass.update(dt, this.floorF, this.landed);
  }
}
