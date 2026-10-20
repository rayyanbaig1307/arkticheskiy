import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Creature, Perception, boneMap, retarget } from './Perception.js';
import { NO_REFLECT } from '../world/Reflection.js';
import { clamp, damp, angleDiff, smoothstep } from '../core/util.js';

// The Turned (Обращённые): the station's people and the 1962 garrison, frozen and moving
// (tools/blender/make_turned.py: turned_a the glaciologist, turned_b the scientist, turned_c the
// soldier, gromov the chief; the clips in turned_anims.glb on the crew's rig). One of them, in
// boat space:
//
//   dormant      waiting: sat frozen at a table (look at it from close and its head comes round
//                to you, far too far; then it gets up in jerks), kneeling over a body feeding (it
//                hears you, freezes, the head round, and rises), or lying as dead (come close and it
//                gets up, the death played backwards in fits)
//   idle         hunched, twitching; muttering
//   wander       shambling between a few points (or about its home)
//   listen       a noise: it stops dead mid-step, the head snaps round toward it, past where a
//                head should go; then the body comes round after it
//   investigate  goes to where the noise was and looks about
//   scream       first sight of you: the jaw drops away, the arms fling back; the others within
//                25 m hear it and come
//   hunt         runs at you along the Nav's routes (a new one every half second, or when you've
//                moved 2 m), the run a lurch; beats on a closed door it can't get through (4 s,
//                then ctx.onDoorBang); won't go into heat (ctx.heatAt > 0.5, a burning flare)
//   attack       within 1.5 m: arms up, the grab, the bite (18-25)
//   hurt, burn   a stagger; the flare pistol sets it alight (60 over 3 s), flailing and screaming
//   dead         face down. It gets up again once, 20 s on, unless fire or a head shot killed it
//
// A crawler (crawler: true) does all of it on all fours, low and fast. Gromov never crawls: he
// is bigger (1.12), slower, 1500 health, and only fire and a Mosin in the head hurt him fully.
// Health 120; head hits x2.5. Your flashlight held on one for 2 s: it screams and comes.

const ONCE = new Set(['t_attack', 't_scream', 't_hurt', 't_death', 't_turnhead', 't_wake', 't_reach']);
const SHAMBLE = 0.6, RUN = 4.0, CRAWL = 0.8;     // m/s the clips cover at timeScale 1
export const GROMOV_SCALE = 1.12;
const HOSTILE = new Set(['scream', 'hunt', 'attack', 'burn', 'bang']);
const BURNING = new THREE.Color(1.0, 0.32, 0.06);
const _p = new THREE.Vector3();

// MakeHuman's materials come out alpha-blended: everything opaque, cut out where its texture is
// clear (People.js's dress), and the ice: glossy, glowing faintly from inside
export function dressTurned(scene, lighting) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.frustumCulled = false;
    o.layers.set(NO_REFLECT);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const n = (m.name || '').toLowerCase();
      m.transparent = false; m.depthWrite = true; m.opacity = 1;
      if (/ice_growth/.test(n)) {
        m.roughness = Math.min(m.roughness ?? 0.2, 0.2); m.metalness = 0;
        m.emissiveIntensity = 1.4; m.envMapIntensity = 1.1;
        lighting?.prep(m);
        continue;
      }
      if (m.map) m.alphaTest = Math.max(m.alphaTest, 0.5);
      if (/hair|short0|long0|eyebrow|eyelash/.test(n)) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; m.roughness = 0.7; }
      else if (/coat|skirt|apron|fur|knit|scarf|dress|shift/.test(n)) { m.side = THREE.DoubleSide; m.roughness = Math.max(m.roughness, 0.8); }
      else if (/low-poly/.test(n)) { m.roughness = 0.15; m.emissiveIntensity = 1.5; }
      else if (/body|skin|base/.test(n)) m.roughness = Math.max(m.roughness, 0.55);
      else { m.roughness = Math.max(m.roughness, 0.7); m.metalness = Math.min(m.metalness, 0.15); }
      m.envMapIntensity = 0.7;
      lighting?.prep(m);
    }
  });
}

// a body and its clips (the shared clips retargeted to its hip height), once when it loads
export function prepPerson(gltf, anims, refPelvis, lighting, dress = true) {
  let pelvis = null, info = {};
  gltf.scene.traverse((o) => {
    if (o.name === 'pelvis' && !pelvis) pelvis = o;
    if (o.userData?.person) info = o.userData;
  });
  const clips = [];
  for (const c of anims.animations) clips.push(pelvis && refPelvis ? retarget(c, refPelvis, pelvis) : c);
  if (dress) dressTurned(gltf.scene, lighting);
  return { scene: gltf.scene, clips, info };
}

export class Turned extends Creature {
  constructor(mgr, kind, data, opts = {}) {
    super(mgr, kind, opts);
    this.gromov = kind === 'gromov';
    this.model = cloneSkinned(data.scene);
    this.model.rotation.y = Math.PI;                 // (MPFB's people face +z; ours face -z)
    this.scale = opts.scale ?? (this.gromov ? GROMOV_SCALE : 1);
    this.model.scale.setScalar(this.scale);
    this.root.add(this.model);
    this.bones = boneMap(this.model);
    const size = this.size = ((data.info?.height || 1.8) / 1.8) * this.scale;
    this.crawler = !!opts.crawler && !this.gromov;
    // the eyes and the ice: its own materials (they glow with how much it knows)
    this.eyes = []; this.ice = []; this.morphs = { scream: [], talk: [] };
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const n = (o.material?.name || '').toLowerCase();
      if (/low-poly|ice_growth/.test(n)) {
        o.material = o.material.clone();
        mgr.lighting?.prep(o.material);
        (/low-poly/.test(n) ? this.eyes : this.ice).push({ m: o.material, e: o.material.emissiveIntensity, c: o.material.emissive.clone() });
      }
      for (const k of ['scream', 'talk']) {
        const i = o.morphTargetDictionary?.[k];
        if (i !== undefined) this.morphs[k].push([o, i]);
      }
      if (/eyebrow|eyelash|teeth|low-poly|hair|short0|long0/.test(n)) o.castShadow = false;
      else this.meshes.push(o);
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of data.clips) {
      const a = this.mixer.clipAction(c);
      if (ONCE.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[c.name] = a;
    }
    this.sense = new Perception({ fov: 100, open: 35, inside: 18, warmth: true, hearing: this.gromov ? 0.8 : 1 });
    this.health = this.maxHealth = opts.health ?? (this.gromov ? 1500 : 120);
    if (this.crawler) {
      this.cap = { r: 0.3, a: 0.35, b: 0.5 };
      this.midH = 0.45; this.eyeH = 0.7; this.eyeFwd = 0.5; this.bound = 1.2;
    } else {
      this.cap = { r: (this.gromov ? 0.4 : 0.3), a: 0.6, b: 1.5 * size };
      this.midH = 0.95 * size; this.eyeH = 1.6 * size; this.bound = 1.1 * size;
    }
    this.nav = mgr.navFor('human');
    this.avoidHeat = true;
    this.reach = this.gromov ? 1.9 : this.crawler ? 1.3 : 1.5;
    this.runSpeed = this.gromov ? 3.1 : this.crawler ? 2.1 + Math.random() * 0.4 : 3.5 + Math.random() * 0.7;
    this.seed = Math.random() * 10;
    this.goal = new THREE.Vector3(); this.heardAt = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.points = opts.points || null; this.pi = 0;
    this.revived = false; this.final = false; this.screamed = false;
    this.mouth = 0; this.glow = 0; this.voiceT = 2 + Math.random() * 6; this.lookT = 1;
    this.sub = null; this.subT = 0; this.after = null; this.watchT = 0; this.jerkT = 0; this.burnT = 0;
    this.idleClip = 't_idle';
    // hit volumes: the head from its joint up, the trunk, the arms and legs
    this.vol('head', 'neck_01', 'head', 0.115 * size, 0.14 * size);
    this.vol('body', 'pelvis', 'neck_01', (this.gromov ? 0.24 : 0.19) * size);
    for (const s of ['l', 'r']) {
      this.vol('limb', `upperarm_${s}`, `hand_${s}`, 0.065 * size);
      this.vol('limb', `thigh_${s}`, `foot_${s}`, 0.09 * size);
    }
  }

  start() {
    const h = this.opts.home;
    this.home.copy(h?.isVector3 ? h : h?.pos ?? this.pos);
    this.homeR = h?.radius ?? this.opts.radius ?? 8;
    const st = this.opts.state || 'idle';
    // (put down already after you, or after something: it knows where)
    if (HOSTILE.has(st)) this.sense.alarm(this.mgr.player.pos, 1);
    if (st === 'investigate') this.sense.alarm(this.opts.target ?? this.mgr.player.pos, 0.5);
    this.go(st);
  }

  get voice() { return this.gromov ? 'gromov_roar' : 'turned_scream'; }
  get step() { return this.gromov ? 'gromov_step' : this.crawler ? 'turned_crawl' : 'turned_step'; }

  // ---- states
  go(state, arg) {
    this.enter(state);
    const r = Math.random();
    this.hold(false); this.sub = null;
    this.chasing = HOSTILE.has(state);
    if (this.chasing) this.mgr.alerted(this);
    switch (state) {
      case 'dormant': {
        this.posture = this.opts.posture || this.opts.pose || 'sit';
        this.sub = null; this.watchT = 0; this.wakeT = 0;
        if (this.posture === 'dead') {
          this.play('t_death', 0, 1, true);
          const a = this.actions.t_death; if (a) a.time = a.getClip().duration;
        } else this.play(this.posture === 'feed' ? 't_feed' : 't_sit', 0);
        break;
      }
      case 'idle':
        this.mgr.calmed(this);
        this.play(this.crawler ? 't_crawl' : 't_idle', 0.4, this.crawler ? 0.04 : 1);
        this.subT = arg ?? 3 + r * 6;
        break;
      case 'wander': {
        this.mgr.calmed(this);
        let g = null;
        if (this.points?.length) { g = this.points[this.pi % this.points.length]; this.pi++; }
        else g = this.nav.spot(this.home, 1.5, this.homeR, { tries: 6 });
        if (!g) return this.go('idle');
        this.goal.copy(g); this.route = null; this.stuck = 0;
        this.walkSpeed = (this.crawler ? 0.6 : SHAMBLE) * (0.85 + r * 0.3);
        break;
      }
      case 'listen':
        // dead still, the head round toward it, too far
        this.heardAt.copy(arg); this.hold(true); this.speed = 0; this.after = null;
        this.headRate = 14;
        this.headWant = clamp(angleDiff(this.yaw, this.yawTo(arg.x, arg.z)) * 1.35, -2.5, 2.5);
        this.subT = 0.6 + r * 1.2;
        break;
      case 'investigate':
        this.goal.copy(this.sense.lastKnown); this.route = null; this.stuck = 0; this.sub = 'go';
        this.walkSpeed = (this.crawler ? 0.9 : SHAMBLE * 1.4) * (0.9 + r * 0.2);
        break;
      case 'scream':
        this.speed = 0;
        if (this.crawler) this.play('t_crawl', 0.2, 0.03); else this.play('t_scream', 0.2, 0.95 + r * 0.1, true);
        this.screamLen = this.crawler ? 1.6 : 2.2;
        this.sound(this.voice);
        this.screamed = true; this.mgr.firstSight(this);
        this.mgr.alert(this, 25);
        break;
      case 'hunt':
        this.route = null; this.routeAge = 9; this.voiceT = 1 + r * 3; this.headWant = 0; this.headRate = 6;
        break;
      case 'attack':
        this.play('t_attack', 0.15, this.gromov ? 0.85 : 1 + r * 0.15, true);
        this.struck = false; this.wait = 0;
        this.sound(this.gromov ? 'gromov_roar' : 'turned_attack');
        break;
      case 'hurt':
        this.play('t_hurt', 0.08, 0.9 + r * 0.3, true);
        this.sound('turned_hurt');
        break;
      case 'burn':
        this.flailT = 0; this.burnYaw = this.yaw;
        this.play('t_scream', 0.12, 1.5, true);
        this.sound(this.voice);
        break;
      case 'wake':
        this.jerkT = 0;
        if (this.posture === 'feed') { this.play('t_idle', 0.7); this.subT = 0.8; } else { this.play('t_wake', 0.25); this.subT = 0; }
        this.sound('turned_alert');
        break;
      case 'rise':
        this.jerkT = 0;
        this.playBack('t_death', 0.1, -0.9);
        this.sound('turned_alert');
        break;
      case 'bang':
        this.door = arg; this.bangT = 0; this.struck = false;
        this.play('t_attack', 0.2, 1.15, true);
        break;
      case 'gorge':
        this.chasing = false; this.goal.copy(this.mgr.sense.feet); this.route = null;
        break;
    }
  }

  think(dt, s) {
    const p = this.sense;
    if (this.dead) return this.deadThink(dt, s);
    // your light held on it: it can't bear being seen
    if (p.litT > 2 && !HOSTILE.has(this.state) && !s.dead) {
      if (this.state === 'dormant') return this.go(this.posture === 'dead' ? 'rise' : 'wake');
      if (this.state !== 'wake' && this.state !== 'rise' && this.state !== 'hurt') return this.go(this.screamed ? 'hunt' : 'scream');
    }
    switch (this.state) {
      case 'dormant': return this.dormant(dt, s, p);
      case 'idle': return this.idle(dt, s, p);
      case 'wander': return this.wander(dt, s, p);
      case 'listen': return this.listen(dt, s, p);
      case 'investigate': return this.investigate(dt, s, p);
      case 'scream':
        this.face(this.toYaw, dt, 2.5); this.walk(dt, 0);
        if (this.stateT >= this.screamLen) this.go('hunt');
        return;
      case 'hunt': return this.hunt(dt, s, p);
      case 'attack': return this.attack(dt, s);
      case 'hurt':
        this.speed = damp(this.speed, 0, 5, dt); this.walk(dt, this.speed);
        if (this.clipDone) this.go(s.dead ? 'gorge' : 'hunt');
        return;
      case 'burn': return this.burn(dt, s);
      case 'wake': return this.wake(dt, s, p);
      case 'rise': return this.rise(dt, s, p);
      case 'bang': return this.bang(dt, s, p);
      case 'gorge': {
        const d = this.steer(dt, this.goal, SHAMBLE * 1.5, 3, 0.9);
        if (d < 1) { this.speed = 0; this.play('t_feed', 0.6); } else { this.gait(); this.steps(this.step, 2, 20); }
      }
    }
  }

  // the gait for its speed
  gait() {
    const v = this.speed;
    if (this.crawler) return this.play('t_crawl', 0.3, v < 0.05 ? 0.04 : clamp(v / CRAWL, 0.3, 3.2));
    if (v < 0.1) return this.play(this.idleClip, 0.35);
    if (v < (this.clip === 't_run' ? 1.4 : 1.8)) return this.play('t_shamble', 0.3, clamp(v / SHAMBLE, 0.5, 2.2));
    return this.play('t_run', 0.25, clamp(v / RUN, 0.6, 1.3));
  }

  // has it seen (or felt) enough to come for you?
  roused(s) {
    const p = this.sense;
    if (s.dead) return false;
    if (p.sees && p.awareness > 0.55) return this.go(this.screamed ? 'hunt' : 'scream'), true;
    if ((p.heat > 0.3 && p.awareness > 0.6) || (p.awareness > 0.8 && p.knownT < 1.5)) return this.go('hunt'), true;
    return false;
  }

  dormant(dt, s, p) {
    this.walk(dt, 0);
    if (s.dead) return;
    if (this.posture === 'dead') {
      // (face down it sees nothing: you have to come close, or make a noise right by it)
      if ((this.dp < 2.4 && Math.random() < dt * 1.5) || (p.heard.t < 0.5 && p.heard.loud > 0.7)) this.go('rise');
      return;
    }
    if (this.posture === 'feed') {
      if (p.sees && p.awareness > 0.5) return this.go('wake');
      return;
    }
    // sat at the table: you come close and look at it, and its head comes round to you
    if (this.sub !== 'turned') {
      if (this.dp < 4.5 && this.faced > 0.9 && this.visibleTo(s, dt)) this.watchT += dt; else this.watchT = Math.max(0, this.watchT - dt);
      if (this.watchT > 0.8 || this.dp < 1.8) {
        this.sub = 'turned'; this.play('t_turnhead', 0.3);
        this.sound('turned_idle'); this.mgr.stats?.scare?.(0.3);
        this.mgr.firstSight(this);
      }
      return;
    }
    if (this.clipDone) {
      if (this.opts.wake !== false) {
        if (!this.wakeT) this.wakeT = 0.4 + Math.random() * 1.6;
        if ((this.wakeT -= dt) <= 0) this.go('wake');
      } else if (this.dp < 1.5 || (p.awareness > 0.9 && p.heard.t < 1)) this.go('wake');
    }
  }

  wake(dt, s) {
    // up in fits
    if ((this.jerkT -= dt) <= 0) {
      this.jerkT = 0.08 + Math.random() * 0.25;
      if (this.clip === 't_wake') this.setRate(Math.random() < 0.2 ? 0.05 : 0.7 + Math.random() * 0.8);
    }
    this.walk(dt, 0);
    if (this.clip === 't_wake' ? this.clipDone : this.stateT > this.subT) this.awake(s);
  }

  rise(dt, s) {
    if ((this.jerkT -= dt) <= 0) {
      this.jerkT = 0.1 + Math.random() * 0.25;
      this.setRate(-(Math.random() < 0.2 ? 0.05 : 0.4 + Math.random() * 1.6));
    }
    this.walk(dt, 0);
    if (this.clipDone) this.awake(s);
  }

  // up: at you if it knows where you are, else after the noise, else it stands there
  awake(s) {
    const p = this.sense;
    this.hold(false);
    if (!s.dead && p.awareness > 0.4 && p.knownT < 3) return this.go(this.screamed ? 'hunt' : 'scream');
    if (p.heard.t < 6) return this.go('investigate');
    return this.go('idle');
  }

  idle(dt, s) {
    this.speed = damp(this.speed, 0, 6, dt); this.walk(dt, this.speed);
    this.mutter(dt); this.twitch(dt);
    if (this.roused(s)) return;
    if ((this.subT -= dt) <= 0 && this.opts.wander !== false) this.go('wander');
  }

  wander(dt, s) {
    if (this.roused(s)) return;
    this.mutter(dt);
    const d = this.steer(dt, this.goal, this.walkSpeed, 3, 0.5);
    this.gait(); this.steps(this.step, 2, 20);
    if (d < 0.6 || this.stuck > 2 || this.stateT > 40) this.go('idle', 2 + Math.random() * 5);
  }

  listen(dt, s, p) {
    this.walk(dt, 0);
    if (this.stateT < this.subT) return;
    // the body comes round after the head, the head unwinding as it does
    if (this.stateT - dt < this.subT) { this.hold(false); if (this.crawler) this.setRate(0.4); else this.play('t_idle', 0.3); }
    const diff = this.face(this.yawTo(this.heardAt.x, this.heardAt.z), dt, 2.5);
    this.headWant = clamp(diff * 1.2, -2.5, 2.5); this.headRate = 6;
    if (Math.abs(diff) < 0.3 || this.stateT > this.subT + 2) {
      this.headWant = 0;
      if (s.dead) return this.go('idle');
      if (this.after) { const a = this.after; this.after = null; return this.go(a); }
      if (p.sees && p.awareness > 0.4) return this.go(this.screamed ? 'hunt' : 'scream');
      if (p.awareness > 0.6) return this.go('hunt');
      return this.go('investigate');
    }
  }

  investigate(dt, s) {
    if (this.roused(s)) return;
    if (this.sub === 'go') {
      const d = this.steer(dt, this.goal, this.walkSpeed, 3.2, 0.8);
      this.gait(); this.steps(this.step, 2, 22);
      if (this.stuckT > 0.3) { const door = this.doorAhead(); if (door) return this.go('bang', door); }
      if (d < 1 || this.stuck > 2 || this.stateT > 30) { this.sub = 'look'; this.subT = 4 + Math.random() * 4; this.lookT = 0; }
      return;
    }
    // there: it looks about
    this.speed = damp(this.speed, 0, 6, dt); this.walk(dt, this.speed); this.gait();
    if ((this.lookT -= dt) <= 0) { this.lookT = 0.8 + Math.random() * 1.6; this.headWant = (Math.random() * 2 - 1) * 1.8; this.headRate = Math.random() < 0.3 ? 14 : 4; }
    if ((this.subT -= dt) <= 0) { this.headWant = 0; this.go(Math.random() < 0.6 ? 'wander' : 'idle'); }
  }

  hunt(dt, s, p) {
    if (s.dead) return this.go('gorge');
    const tgt = p.knownT < 1.5 ? s.feet : p.lastKnown;
    const lurch = 0.82 + 0.3 * Math.abs(Math.sin(this.t * 2.7 + this.seed));
    this.steer(dt, tgt, this.runSpeed * lurch, this.crawler ? 4 : 3.2, 0.3);
    this.gait(); this.steps(this.step, 2, 30);
    if ((this.voiceT -= dt) <= 0) { this.voiceT = 2 + Math.random() * 4; this.sound(this.gromov ? 'gromov_roar' : 'turned_alert'); }
    // a closed door: it beats on it
    if (this.stuckT > 0.3 || (this.speed < 0.4 && this.stateT > 1)) {
      const door = this.doorAhead();
      if (door) return this.go('bang', door);
    }
    // heat holds it off: it paces at the edge
    if (this.heatBlocked) { this.yaw += Math.sin(this.t * 1.3 + this.seed) * dt * 1.5; this.root.rotation.y = this.yaw; }
    // (hidden in a locker: it comes to where you were and casts about, sniffing)
    if (s.hidden && this.dp < this.reach + 0.8) return this.go('investigate');
    if (this.dp < this.reach && Math.abs(angleDiff(this.yaw, this.toYaw)) < 0.8 && Math.abs(this.dy) < 1.2) return this.go('attack');
    // lost you: where it saw you last, then a look round
    if (p.knownT > 2 && Math.hypot(this.pos.x - p.lastKnown.x, this.pos.z - p.lastKnown.z) < 1.2) return this.go('investigate');
    if (p.awareness < 0.3 && p.unseenT > 6) return this.go('investigate');
  }

  attack(dt, s) {
    const ahead = angleDiff(this.yaw, this.toYaw);
    if (this.wait > 0) {
      this.wait -= dt;
      this.face(this.toYaw, dt, 3);
      if (this.wait <= 0) {
        if (s.dead) return this.go('gorge');
        return this.dp < this.reach + 0.1 ? this.go('attack') : this.go('hunt');
      }
      return;
    }
    this.face(this.toYaw, dt, this.struck ? 1.5 : 4);
    this.speed = damp(this.speed, this.struck ? 0 : 0.8, 6, dt); this.walk(dt, this.speed);
    if (!this.struck && this.clipT >= 0.55) {
      this.struck = true;
      if (this.dp < this.reach + 0.45 && Math.abs(ahead) < 1.0 && Math.abs(this.dy) < 1.2 && !s.hidden && !s.dead) {
        this.mgr.hurtPlayer(this, 'grab', this.gromov ? 30 + Math.random() * 10 : 18 + Math.random() * 7);
        this.mgr.stats?.scare?.(0.4);
      }
    }
    if (this.clipDone) { this.wait = 0.15 + Math.random() * 0.35; this.play(this.crawler ? 't_crawl' : 't_idle', 0.2); }
  }

  burn(dt, s) {
    this.burnT -= dt;
    this.health -= 20 * dt;
    if (this.health <= 0) return this.die('fire');
    // flailing: lurching this way and that, screaming
    if ((this.flailT -= dt) <= 0) {
      this.flailT = 0.35 + Math.random() * 0.4;
      this.play(Math.random() < 0.5 ? 't_hurt' : 't_scream', 0.12, 1.3 + Math.random() * 0.6, true);
      this.burnYaw = this.yaw + (Math.random() * 2 - 1) * 1.6;
      if (Math.random() < 0.4) this.sound(this.voice);
    }
    this.face(this.burnYaw, dt, 4);
    this.walk(dt, 0.9);
    if (this.burnT <= 0) this.go(s.dead ? 'gorge' : 'hunt');
  }

  bang(dt, s, p) {
    const b = this.door.box;
    this.face(this.yawTo((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2), dt, 3);
    this.speed = 0; this.walk(dt, 0);
    if (!this.struck && this.clipT > 0.55) {
      this.struck = true;
      const h = this.mgr.audio?.horror;
      if (typeof h?.sfx === 'function') h.sfx('door_bang', this.mgr.boat.toWorld(b.getCenter(_p), new THREE.Vector3()));
    }
    if (this.clipDone) { this.struck = false; this.play('t_attack', 0.1, 1.05 + Math.random() * 0.2, true); }
    if (!this.door.on) return this.go('hunt');
    if ((this.bangT += dt) >= 4) { this.bangT = 0; this.mgr.doorBang(this.door, this); }
    if (p.knownT > 12 && p.awareness < 0.3) this.go('idle');
    void s;
  }

  deadThink(dt, s) {
    // the cold wakes them: once, unless fire or a head shot ended it
    if (this.final) return;
    if ((this.deadT -= dt) <= 0 && this.dp < 35 && !s.dead) {
      this.dead = false; this.revived = true; this.shootable = true;
      this.health = this.maxHealth * 0.6;
      this.sense.reset(); this.sense.alarm(s.feet, 0.7);
      this.go('rise');
    }
  }

  // a noise: it stops and listens (or, waiting, wakes)
  hear(pos, loud, kind) {
    if (this.dead || loud < 0.06) return;
    const st = this.state;
    if (HOSTILE.has(st) || st === 'hurt' || st === 'wake' || st === 'rise' || st === 'gorge') return;
    if (st === 'dormant') {
      const shot = loud > 0.35 && /pm|mosin|akm|flaregun|glass/.test(kind);
      if (this.posture === 'dead') { if (shot && loud > 0.6) this.go('rise'); return; }
      if (this.posture === 'feed') { if (loud > 0.15) { this.go('listen', pos); this.after = 'wake'; } return; }
      if (shot) this.go('wake');
      return;
    }
    if (st === 'listen') { this.heardAt.copy(pos); return; }
    this.go('listen', pos);
  }

  // another's scream: it knows, and comes
  alarmed(pos, from) {
    if (this.dead) return;
    this.sense.alarm(pos, 0.85);
    const st = this.state;
    if (HOSTILE.has(st) || st === 'hurt' || st === 'wake' || st === 'rise') return;
    if (st === 'dormant') { this.go(this.posture === 'dead' ? 'rise' : 'wake'); return; }
    this.go('listen', from.pos); this.after = 'hunt'; this.subT = 0.2 + Math.random() * 0.6;
  }

  damage(amount, point, dir, weaponId) {
    const part = this.partAt(point);
    if (this.dead) {
      // a corpse shot in the head or burnt stays down
      if (part === 'head' || weaponId === 'flaregun') this.final = true;
      return { part, damage: 0 };
    }
    const feet = this.mgr.sense.feet;
    this.sense.alarm(feet, 1);
    if (weaponId === 'flaregun') {
      // alight: 60 over 3 s (Gromov too: the ice burns)
      this.burnT = 3;
      if (this.state !== 'burn') this.go('burn');
      return { part, damage: 0, burning: true };
    }
    let dmg = amount;
    if (part === 'head') dmg *= 2.5;
    if (this.gromov && !(weaponId === 'mosin' && part === 'head')) dmg *= 0.2;
    this.health -= dmg;
    if (this.health <= 0) { this.die(part === 'head' ? 'head' : weaponId); return { part, damage: dmg, killed: true }; }
    if (this.state === 'burn') return { part, damage: dmg };
    if (this.gromov && dmg < 60) {
      this.sound('turned_hurt');
      if (!HOSTILE.has(this.state)) this.go('hunt');
    } else this.go('hurt');
    void dir;
    return { part, damage: dmg };
  }

  die(cause) {
    this.dead = true; this.chasing = false; this.health = 0;
    this.final = this.final || cause === 'fire' || cause === 'head' || this.revived || this.gromov || this.opts.revive === false;
    this.enter('dead');
    this.play('t_death', 0.15, 1, true);
    this.sound('turned_death');
    this.deadT = 20 + Math.random() * 6;
    this.mgr.died(this);
  }

  // muttering, now and then, near you
  mutter(dt) {
    if ((this.voiceT -= dt) <= 0) { this.voiceT = 5 + Math.random() * 9; if (this.dp < 22) this.sound('turned_idle'); this.chatter = 0.8; }
  }

  // the head jerks round now and then
  twitch(dt) {
    if ((this.lookT -= dt) <= 0) {
      this.lookT = 1.5 + Math.random() * 4;
      this.headWant = Math.random() < 0.4 ? 0 : (Math.random() * 2 - 1) * 1.4;
      this.headRate = Math.random() < 0.35 ? 16 : 4;
    }
  }

  // a shut door in front of it (the collision's door boxes)
  doorAhead() {
    const boxes = this.mgr.col.boxes;
    if (!boxes?.length) return null;
    _p.set(this.pos.x - Math.sin(this.yaw) * 0.5, this.pos.y + 1, this.pos.z - Math.cos(this.yaw) * 0.5);
    for (const b of boxes) if (b.on && b.box.distanceToPoint(_p) < 0.4) return b;
    return null;
  }

  // after the clips: the jaw, the eyes, the ice, the head
  pose(dt) {
    let want = 0;
    const st = this.state;
    if (st === 'scream') {
      const t = this.stateT;
      want = smoothstep(0.1, 0.45, t) * (1 - smoothstep(this.screamLen - 0.5, this.screamLen, t)) * (0.85 + 0.15 * Math.sin(t * 40));
    } else if (st === 'burn') want = 0.7 + 0.3 * Math.sin(this.t * 31);
    else if (st === 'attack') want = smoothstep(0.3, 0.55, this.clipT) * (1 - smoothstep(0.75, 1.15, this.clipT)) * 0.95;
    else if (st === 'hunt') want = 0.2 + 0.12 * Math.sin(this.t * 9 + this.seed);
    else if (this.dead) want = 0.35;
    this.mouth = damp(this.mouth, want, 16, dt);
    for (const [o, i] of this.morphs.scream) o.morphTargetInfluences[i] = this.mouth;
    // (a mutter works the jaw a little)
    this.chatter = Math.max(0, (this.chatter || 0) - dt);
    const talk = this.chatter > 0 ? Math.max(0, Math.sin(this.t * 19)) * 0.5 : 0;
    for (const [o, i] of this.morphs.talk) o.morphTargetInfluences[i] = talk;
    // the eyes brighten with what it knows; the ice breathes
    const alert = HOSTILE.has(st) ? 1 : this.sense.awareness;
    this.glow = damp(this.glow, this.dead ? 0 : alert, 3, dt);
    const fire = st === 'burn' ? 1 : 0;
    for (const e of this.eyes) e.m.emissiveIntensity = e.e * (this.dead ? 0.15 : 1 + 3.5 * this.glow);
    const pulse = 0.65 + 0.35 * Math.sin(this.t * 1.6 + this.seed);
    for (const e of this.ice) {
      e.m.emissiveIntensity = e.e * (this.dead ? 0.3 : pulse + 0.8 * this.glow + fire * 2);
      e.m.emissive.copy(e.c).lerp(BURNING, fire);
    }
    if (!this.dead) this.turnHead(this.headYaw);
  }

  dispose() {
    for (const e of [...this.eyes, ...this.ice]) e.m.dispose();
    super.dispose();
  }
}
