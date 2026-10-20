import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Creature, Perception, boneMap } from './Perception.js';
import { NO_REFLECT } from '../world/Reflection.js';
import { damp, clamp } from '../core/util.js';

// A Shade (Тень): the echo of a 1962 subject, a thin figure in a shift (people/shade.glb), drawn as
// a ghost: no lighting, a pale blue-white rim, its body coming and going in noisy bands that drift
// up it, the outline smeared sideways in jerks, flickering; no shadow, nothing written to depth.
//
// It is never quite where you look. It floats a few centimetres off the floor (t_float) and drifts
// toward you in the dark; look straight at it from further than 6 m for a second and it fades,
// to come back somewhere dark behind you or beside you (an open cell of the Nav, never in a wall).
// Within 3 m it reaches for you (t_reach); its touch takes your warmth (-25), frightens you, and
// it's gone. Bullets go through it (it is never a target). A strong light drives it off: your
// flashlight on it within 8 m for 0.6 s, or a burning flare within 10 m, and it shrieks, backs
// away and goes. It whispers when it's within 12 m.
//
// opts: area { pos, radius } (where it haunts: it only comes while you're in it), delay (s before
// it first comes), state 'drift' to stand it where it was spawned, already there.

const ONCE = new Set(['t_reach', 't_scream', 't_hurt', 't_death', 't_turnhead', 't_wake', 't_attack']);
const _v = new THREE.Vector3();

// the ghost: MeshBasicMaterial (skinning and the morphs for free) with its colour and alpha
// replaced; Lighting.prep chains the atmosphere's fog after it
function ghostMaterial(u, lighting) {
  const m = new THREE.MeshBasicMaterial({ color: 0xc4d8ff, transparent: true, depthWrite: false, side: THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uGhostT, uGhostSeed, uGhostSmear;
        varying vec3 vGN; varying vec3 vGV; varying float vGY;
        float ghash(float n) { return fract(sin(n) * 43758.5453); }`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        // the outline smears: bands of the body pulled sideways in jerks, drifting up it
        float gb = floor(transformed.y * 11.0 + uGhostT * 2.1 + uGhostSeed);
        float gj = ghash(gb + floor(uGhostT * 9.0) * 7.13) - 0.5;
        transformed.x += gj * uGhostSmear * 0.07 * step(0.7, ghash(gb * 1.7 + floor(uGhostT * 5.0)));
        #if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
        transformed += objectNormal * (0.006 + 0.01 * sin(uGhostT * 3.1 + transformed.y * 13.0 + uGhostSeed)) * (0.5 + uGhostSmear);
        #endif
        vGY = transformed.y;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        #if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
        vGN = normalize( normalMatrix * objectNormal );
        #else
        vGN = normalize( normalMatrix * normal );
        #endif
        vGV = - mvPosition.xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uGhostT, uGhostSeed, uGhostA, uGhostGlow;
        varying vec3 vGN; varying vec3 vGV; varying float vGY;
        float ghash2(float n) { return fract(sin(n) * 43758.5453); }`)
      .replace('#include <opaque_fragment>', `
        vec3 gn = normalize(vGN), gv = normalize(vGV);
        float rim = pow(1.0 - abs(dot(gn, gv)), 2.0);
        // there in bands that drift up it, one now and then gone altogether
        float b1 = 0.5 + 0.5 * sin(vGY * 21.0 + uGhostT * 3.7 + uGhostSeed);
        float b2 = 0.5 + 0.5 * sin(vGY * 6.3 - uGhostT * 1.2 + uGhostSeed * 2.3);
        float cut = step(0.18, ghash2(floor(vGY * 26.0 + uGhostT * 5.0) + uGhostSeed));
        float ga = (0.07 + 0.93 * rim) * mix(0.3, 1.0, b1 * b2) * cut * uGhostA;
        vec3 gc = mix(vec3(0.4, 0.52, 0.72), vec3(0.88, 0.95, 1.0), rim) * (0.5 + 1.15 * rim) * uGhostGlow;
        gl_FragColor = vec4(gc * diffuseColor.rgb, clamp(ga, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => 'ghost';
  lighting?.prep(m);
  return m;
}

export class Shade extends Creature {
  constructor(mgr, data, opts = {}) {
    super(mgr, 'shade', opts);
    this.model = cloneSkinned(data.scene);
    this.model.rotation.y = Math.PI;
    this.root.add(this.model);
    this.bones = boneMap(this.model);
    this.size = (data.info?.height || 1.35) / 1.8;
    this.u = { uGhostT: { value: Math.random() * 50 }, uGhostSeed: { value: Math.random() * 10 }, uGhostSmear: { value: 0.5 }, uGhostA: { value: 0 }, uGhostGlow: { value: 1 } };
    this.mat = ghostMaterial(this.u, mgr.lighting);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const n = ((o.material?.name || '') + ' ' + o.name).toLowerCase();
      o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
      o.layers.set(NO_REFLECT);
      o.renderOrder = 6;
      if (/eyebrow|eyelash|teeth/.test(n)) { o.visible = false; return; }
      o.material = this.mat;
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of data.clips) {
      const a = this.mixer.clipAction(c);
      if (ONCE.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[c.name] = a;
    }
    // (its senses: only your light on it, and whether you're looking at it)
    this.sense = new Perception({ fov: 360, open: 60, inside: 60 });
    this.shootable = false;
    this.cap = { r: 0.22, a: 0.5, b: 1.2 };
    this.midH = 0.8; this.eyeH = 1.25; this.bound = 1;
    this.nav = mgr.navFor('human');
    const a = opts.area, ap = a?.isVector3 ? a : a?.pos;
    this.area = { pos: ap ? ap.clone() : null, radius: a?.radius ?? 40 };
    this.alpha = 0; this.fade = 1; this.flick = 1; this.flickT = 0; this.lookT = 0;
    this.whisperT = 2 + Math.random() * 3; this.waitT = 0; this.waitNext = 5; this.away = new THREE.Vector3();
  }

  start() {
    if (!this.area.pos) this.area.pos = this.pos.clone();
    this.shown = false;
    this.play('t_float', 0);
    if (this.opts.state === 'drift') { this.go('drift'); return; }
    this.go('hidden');
    this.waitT = this.opts.delay ?? 3 + Math.random() * 5;
  }

  go(state) {
    this.enter(state);
    if (state === 'drift') this.play('t_float', 0.6);
    if (state === 'reach') this.play('t_reach', 0.6, 0.85 + Math.random() * 0.2);
    if (state === 'recoil') {
      this.sound('shade_wail');
      this.away.set(this.pos.x - this.mgr.sense.feet.x, 0, this.pos.z - this.mgr.sense.feet.z).normalize();
      this.mgr.stats?.scare?.(0.2);
    }
    if (state === 'hidden') { this.alpha = 0; this.shown = false; this.speed = 0; }
  }

  // a light it can't stand: your flashlight on it, close, or a burning flare
  scared(s) {
    if (this.sense.litT > 0.6 && this.sense.dist < 8) return true;
    for (const f of s.flares) if (f.burning && f.pos.distanceTo(this.pos) < 10) return true;
    return false;
  }

  inArea(p) { return !this.area.pos || Math.hypot(p.x - this.area.pos.x, p.z - this.area.pos.z) < this.area.radius; }

  // somewhere dark behind you or beside you, open floor, your height
  appear(s) {
    const look = Math.atan2(-s.look.x, -s.look.z);
    const r = Math.random();
    const off = r < 0.6 ? Math.PI : (r < 0.8 ? 1 : -1) * Math.PI * 0.55;
    const v = this.nav.spot(s.feet, 5, 11, {
      yaw: look + off, spread: 0.6, tries: 8,
      test: (p) => {
        if (Math.abs(p.y - s.feet.y) > 1.6 || !this.inArea(p)) return false;
        if (s.flashOn) {
          _v.subVectors(p, s.flashOrigin);
          const d = _v.length();
          if (d < s.flashRange && _v.dot(s.flashDir) / d > 0.85) return false;
        }
        return true;
      },
    });
    if (!v) { this.waitT = 1 + Math.random() * 2; return; }
    this.pos.copy(v); this.floorY = v.y; this.pos.y = v.y + this.hover;
    this.yaw = this.yawTo(s.feet.x, s.feet.z); this.root.rotation.y = this.yaw;
    this.route = null; this.lookT = 0;
    this.go('drift');
  }

  think(dt, s) {
    this.hover = 0.06 + 0.035 * Math.sin(this.t * 1.3);
    const p = this.sense;
    switch (this.state) {
      case 'hidden':
        if (s.dead) return;
        if ((this.waitT -= dt) <= 0) {
          if (s.dark > 0.35 && this.inArea(s.feet)) this.appear(s);
          else this.waitT = 1 + Math.random() * 2;
        }
        return;
      case 'drift': {
        this.alpha = damp(this.alpha, 1, 1.1, dt);
        if (s.dead) return this.vanish(1.5, 20);
        if (this.scared(s)) return this.go('recoil');
        // looked at straight on from further than 6 m for a second: gone, to come back elsewhere
        const looked = this.faced > 0.97 && this.dp > 6 && this.visibleTo(s, dt);
        this.lookT = looked ? this.lookT + dt : Math.max(0, this.lookT - dt);
        if (looked && this.alpha > 0.4) this.mgr.firstSight(this, false);
        if (this.lookT > 1) return this.vanish(0.7, 3 + Math.random() * 5);
        const speed = (0.3 + 0.4 * s.dark) * (this.faced > 0.9 ? 0.4 : 1);
        this.steer(dt, s.feet, speed, 1.2, 0.4);
        this.whisper(dt);
        if (this.dp < 3 && Math.abs(this.dy) < 1.6) return this.go('reach');
        if (this.dp > 30 || !this.inArea(this.pos)) return this.vanish(1, 4 + Math.random() * 4);
        return;
      }
      case 'reach':
        this.alpha = damp(this.alpha, 1, 2, dt);
        if (s.dead) return this.vanish(1.5, 20);
        if (this.scared(s)) return this.go('recoil');
        this.steer(dt, s.feet, 0.45, 1.5, 0.2);
        this.whisper(dt);
        if (this.dp < 0.95 && Math.abs(this.dy) < 1.4) return this.touch();
        if (this.dp > 4.5) this.go('drift');
        return;
      case 'recoil': {
        // backing off, still facing you, going
        this.alpha -= dt * 0.9;
        this.face(this.toYaw, dt, 2);
        const step = 1.4 * dt, pos = this.pos;
        pos.x += this.away.x * step; pos.z += this.away.z * step;
        this.push(); this.ground(dt, false);
        if (this.alpha <= 0) { this.go('hidden'); this.waitT = 8 + Math.random() * 7; }
        return;
      }
      case 'fade':
        this.alpha -= dt * this.fadeRate;
        if (this.alpha <= 0) { this.go('hidden'); this.waitT = this.waitNext; }
    }
    void p;
  }

  // gone: faded out over `secs`, back after `wait`
  vanish(secs, wait) { this.fadeRate = 1 / secs; this.waitNext = wait; this.go('fade'); }

  // its touch: your warmth taken, a fright, and it's gone
  touch() {
    const st = this.mgr.stats;
    st?.warm?.(-Math.min(25, st.warmth ?? 25));
    st?.scare?.(0.5);
    this.sound('shade_touch');
    this.mgr.hurtPlayer(this, 'touch', 0);
    this.vanish(0.25, 15 + Math.random() * 15);
  }

  whisper(dt) {
    if ((this.whisperT -= dt) <= 0) { this.whisperT = 3 + Math.random() * 4; if (this.dp < 12) this.sound('shade_whisper'); }
  }

  // after the clips: how much of it there is to see
  pose(dt, s) {
    this.u.uGhostT.value += dt;
    if ((this.flickT -= dt) <= 0) { this.flickT = 0.03 + Math.random() * 0.25; this.flick = Math.random() < 0.12 ? 0.15 : 0.75 + Math.random() * 0.25; }
    const looked = this.lookT > 0.2 ? 0.7 + 0.3 * Math.sin(this.t * 41) : 1;
    const dark = s ? 0.45 + 0.55 * s.dark : 1;
    this.u.uGhostA.value = clamp(this.alpha, 0, 1) * this.flick * dark * looked;
    this.u.uGhostSmear.value = this.state === 'recoil' || this.state === 'fade' ? 1.4 : 0.35 + 0.5 * clamp(this.speed, 0, 1);
    this.u.uGhostGlow.value = this.state === 'recoil' ? 1.6 : 1;
    this.turnHead(this.headYaw);
  }

  update(dt, s) {
    super.update(dt, s);
    this.shown = this.state !== 'hidden' && this.alpha > 0.004;
  }

  dispose() { this.mat.dispose(); super.dispose(); }
}
