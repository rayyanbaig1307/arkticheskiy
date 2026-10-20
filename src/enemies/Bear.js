import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Creature, Perception, SEG, SHOTS, boneMap } from './Perception.js';
import { Fur } from './Fur.js';
import { NO_REFLECT } from '../world/Reflection.js';
import { WEAPONS } from '../weapons/defs.js';
import { clamp, damp, angleDiff } from '../core/util.js';

// A polar bear (белый медведь: tools/blender/make_bear.py), one of them, in boat space. It lives
// in a home area and does what bears do there until it smells you (downwind of you, out to 60 m),
// hears you, or sees you:
//
//   roam     wanders its home ground, nose down (sniff_ground), nose up (sniff_air), standing; at
//            a carcass, if it has one, it feeds, lifting its head now and then
//   notice   stops, the head coming round to it first, then the body; sniffs the air
//   stalk    follows 15-25 m off, head low, round behind you at the edge of your light. Your light
//            on it and it stops dead mid-step, then slinks off out of the beam. It comes in the
//            end: when you run, when you come too close, or when it has followed long enough and
//            you turn your back on it
//   threat   you close (10 m) and facing it: up on its hind legs, roaring; then it comes or it
//            backs off
//   charge   a gallop straight at you, turning slowly: step aside late and it overshoots, skids,
//            and comes round again
//   attack   within 2.4 m: the first time the lunge (the jump scare: it rises and slams down with
//            both paws, the jaws open), then swipes and bites, 35-45 each
//   flee     a flare (a hit, or one burning on the ground near it), or 60% of its health gone:
//            away at a gallop, then a trot, 80 m, and it doesn't come back for a while
//   dead     rolls onto its side and stays
//
// Health 450; a hit does what the gun does to a bear (PM 25, Mosin 110, AKM 35, flare 40 and it
// always runs), twice that in the head. The coat is shell fur (Fur.js), its blood per bear (blood).

const ONCE = new Set(['rear', 'swipe', 'bite', 'roar', 'lunge', 'hurt', 'death']);
const GAIT = { walk: 0.85, stalk: 0.5, trot: 1.9, charge: 5.5 };     // m/s each clip covers at timeScale 1
const TURN = { walk: 2.5, stalk: 1.6, trot: 2.0, charge: 0.85 };     // rad/s at most
const HITS = { pm: 25, mosin: 110, akm: 35, flaregun: 40 };
const REACH = 2.4;
const _v = new THREE.Vector3();

// the bear's materials once, when it loads: no vertex colours anywhere (GLTFLoader turns them on
// for COLOR_0; the coat's colour is its texture and Fur.js reads COLOR_0 itself), the coat and the
// mouth's cavity (its faces turned inward on purpose) front faces only
export function prepBear(gltf, lighting) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.vertexColors = false;
      if (/Bear_(Mouth|Coat)/.test(m.name)) m.side = THREE.FrontSide;
      m.envMapIntensity = 0.8;
      m.needsUpdate = true;
      lighting?.prep(m);
    }
  });
  return { scene: gltf.scene, clips: gltf.animations };
}

export class Bear extends Creature {
  constructor(mgr, data, opts = {}) {
    super(mgr, 'bear', opts);
    this.model = cloneSkinned(data.scene);
    this.root.add(this.model);
    this.bones = boneMap(this.model);
    this.neckName = 'neck2'; this.headName = 'head';
    let coat = null;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false; o.receiveShadow = true;
      o.layers.set(NO_REFLECT);
      const n = o.material?.name || '';
      if (n === 'Bear_Coat' && o.isSkinnedMesh) coat = o;
      // (the eyes, claws, teeth and the mouth are too small to shadow)
      if (/Bear_(Coat|Skin)/.test(n)) this.meshes.push(o); else o.castShadow = false;
    });
    if (coat) {
      coat.material = this.coatMat = coat.material.clone();          // (each bear its own blood)
      mgr.lighting?.prep(coat.material);
      this.fur = new Fur(coat, { shells: mgr.furShells, length: 0.065, lighting: mgr.lighting });
      this.fur.blood = opts.blood ?? 0;
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of data.clips) {
      const a = this.mixer.clipAction(c);
      if (ONCE.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[c.name] = a;
    }
    this.sense = new Perception({ fov: 120, open: 35, inside: 18, smell: true });
    this.health = this.maxHealth = opts.health ?? 450;
    this.cap = { r: 0.45 };
    this.midH = 0.8; this.eyeH = 1.0; this.eyeFwd = 1.1; this.bound = 1.9;
    this.corner = 0.7; this.reroute = 3; this.routeEvery = 0.8;
    this.nav = mgr.navFor('bear');
    const h = opts.home;
    this.home = { pos: new THREE.Vector3(), radius: h?.radius ?? opts.radius ?? 30 };
    this.carcass = opts.carcass ? opts.carcass.clone() : null;
    this.aggression = opts.aggression ?? 0.55;
    this.lunged = false; this.calmT = 0; this.threatCD = 0; this.pitch = 0; this.pitchWant = 0; this.pitchT = 0;
    this.goal = new THREE.Vector3(); this.fleeFrom = new THREE.Vector3();
    this.sub = null; this.subT = 0; this.idleClip = 'idle'; this.stalking = false; this.after = null;
    this.headT = 0; this.blockT = 0; this.dodge = 0; this.dodgeT = 0; this.routed = 0;
    // hit volumes (the bones' Blender names; the head from the head joint out along the snout)
    this.vol('head', 'neck2', 'head', 0.17, 0.42);
    this.vol('body', 'neck1', 'head', 0.24);
    this.vol('body', 'hips', 'neck1', 0.42);
    for (const s of ['L', 'R']) {
      this.vol('limb', `upperarm.${s}`, `hand.${s}`, 0.13);
      this.vol('limb', `thigh.${s}`, `foot.${s}`, 0.16);
    }
  }

  start() {
    const h = this.opts.home;
    this.home.pos.copy(h?.isVector3 ? h : h?.pos ?? this.pos);
    const st = this.opts.state || (this.carcass ? 'eat' : 'roam');
    // (put down already after you: it knows where you are)
    if (st === 'stalk' || st === 'charge' || st === 'threat') this.sense.alarm(this.mgr.player.pos, 0.8);
    if (st === 'dead') this.die(true);
    else this.go(st === 'eat' ? 'roam' : st);
  }

  // ---- states
  go(state) {
    this.enter(state);
    const r = Math.random();
    this.stalking = false; this.sub = null;
    switch (state) {
      case 'roam':
        this.chasing = false; this.mgr.calmed(this); this.sub = null; this.next();
        break;
      case 'notice':
        this.play('sniff_air', 0.35);
        this.sound('bear_huff');
        this.subT = 3 + r * 3; this.turnAfter = 0.4 + Math.random() * 0.5;
        this.headRate = 9;
        break;
      case 'stalk':
        this.stalking = true; this.chasing = false;
        this.play('stalk', 0.4, 0.8);
        this.stalkT = (12 + Math.random() * 24) * (1.45 - this.aggression);
        this.growlT = 2 + r * 5; this.freezeT = 0; this.side = r < 0.5 ? -1 : 1; this.runT = 0;
        this.mgr.alerted(this);
        break;
      case 'threat':
        this.rearing = r < 0.65;
        this.play(this.rearing ? 'rear' : 'roar', 0.3, 1, true);
        this.roarAt = this.rearing ? 0.9 : 0.25; this.roared = false;
        this.threatCD = 18 + r * 10; this.startDp = this.dp;
        this.mgr.alerted(this);
        break;
      case 'charge':
        this.chasing = true; this.skidT = 0; this.blockT = 0; this.routed = 0;
        this.chargeK = 0.92 + r * 0.14;
        this.play('charge', 0.25, 0.8);
        this.sound(r < 0.5 ? 'bear_roar' : 'bear_growl');
        this.mgr.stinger('chase_start');
        this.mgr.alerted(this);
        break;
      case 'attack': this.strike(); break;
      case 'flee': {
        this.chasing = false; this.panicT = 2.2 + r; this.fleeT = 0; this.blockT = 0; this.dodge = 0;
        let dx = this.pos.x - this.fleeFrom.x, dz = this.pos.z - this.fleeFrom.z;
        const L = Math.hypot(dx, dz);
        if (L < 0.1) { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); } else { dx /= L; dz /= L; }
        const a = Math.atan2(-dx, -dz) + (r - 0.5) * 0.8;
        this.goal.set(this.pos.x - Math.sin(a) * 85, this.pos.y, this.pos.z - Math.cos(a) * 85);
        this.sound(r < 0.5 ? 'bear_hurt' : 'bear_huff');
        this.mgr.calmed(this);
        break;
      }
      case 'hurt': this.play('hurt', 0.1, 1, true); break;
      case 'feed': this.chasing = false; this.goal.copy(this.mgr.sense.feet); break;
    }
  }

  // roaming: the next thing to do
  next() {
    const r = Math.random(), pos = this.pos;
    this.stuck = 0; this.route = null;
    if (this.carcass) {
      const dx = pos.x - this.carcass.x, dz = pos.z - this.carcass.z, dc = Math.hypot(dx, dz);
      if (dc > 2.4) {
        // (stand with the head over it, not on it)
        const k = 1.2 / Math.max(dc, 0.01);
        return this.walkTo(_v.set(this.carcass.x + dx * k, this.carcass.y, this.carcass.z + dz * k));
      }
      if (r < 0.75) { this.sub = 'eat'; this.subT = 8 + Math.random() * 14; this.play('eat', 0.45); return; }
    }
    if (r < 0.45) {
      const g = this.nav.spot(this.home.pos, 4, this.home.radius, { tries: 6 });
      if (g) return this.walkTo(g);
    }
    if (r < 0.7) return this.pause('sniff_ground', 4 + Math.random() * 5);
    if (r < 0.85) { this.sound('bear_huff'); return this.pause('sniff_air', 4); }
    this.pause('idle', 5 + Math.random() * 5);
  }

  walkTo(goal) {
    this.goal.copy(goal); this.sub = 'walk'; this.subT = 45; this.idleClip = 'idle';
    this.walkSpeed = GAIT.walk * (0.85 + Math.random() * 0.25);
  }

  pause(clip, secs) { this.sub = 'pause'; this.subT = secs; this.idleClip = clip; this.play(clip, 0.45); }

  // the gait for its speed (stalking: the stalk, slowed to a standstill if need be)
  gait() {
    const v = this.speed, c = this.clip;
    if (this.stalking) return this.play('stalk', 0.35, clamp(v / GAIT.stalk, 0.04, 1.6));
    if (v < 0.12) return this.play(this.idleClip || 'idle', 0.4);
    if (v < (c === 'walk' ? 1.5 : 1.25)) return this.play('walk', 0.3, clamp(v / GAIT.walk, 0.5, 1.5));
    if (v < (c === 'trot' ? 3.7 : 3.3)) return this.play('trot', 0.3, clamp(v / GAIT.trot, 0.6, 1.5));
    return this.play('charge', 0.25, clamp(v / GAIT.charge, 0.6, 1.25));
  }

  think(dt, s) {
    if (this.dead) return;
    const p = this.sense;
    this.calmT -= dt; this.threatCD -= dt;
    if ((this.headT -= dt) <= 0 && this.state !== 'notice') { this.headWant = 0; this.headRate = 3; }
    // a burning flare near it: it goes
    if (this.state !== 'flee' && this.state !== 'hurt') {
      for (const f of s.flares) if (f.burning && f.pos.distanceTo(this.pos) < 7) { this.fleeFrom.copy(f.pos); return this.go('flee'); }
    }
    // the slope under it (the body tips with it)
    if (this.dp < 40 && (this.pitchT -= dt) <= 0) {
      this.pitchT = 0.2;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), col = this.mgr.col, y = this.pos.y + 0.6;
      const a = col.floorAt(this.pos.x + fx, y, this.pos.z + fz, 1.6), b = col.floorAt(this.pos.x - fx, y, this.pos.z - fz, 1.6);
      this.pitchWant = a !== null && b !== null ? clamp(Math.atan2(a - b, 2), -0.35, 0.35) : 0;
    }
    this.pitch = damp(this.pitch, this.pitchWant, 4, dt);
    switch (this.state) {
      case 'roam': return this.roam(dt, s, p);
      case 'notice': return this.notice(dt, s, p);
      case 'stalk': return this.stalk(dt, s, p);
      case 'threat': return this.threat(dt, s, p);
      case 'charge': return this.charge(dt, s, p);
      case 'attack': return this.attack(dt, s, p);
      case 'flee': return this.flee(dt, s, p);
      case 'hurt':
        this.speed = damp(this.speed, 0, 4, dt); this.walk(dt, this.speed);
        if (this.clipDone) this.go(this.after || 'charge');
        return;
      case 'feed': {
        const d = this.steer(dt, this.goal, GAIT.walk, TURN.walk, 1.7);
        if (d < 1.8) { this.speed = 0; this.play('eat', 0.5); } else this.gait();
      }
    }
  }

  roam(dt, s, p) {
    if (this.calmT <= 0 && p.awareness > 0.3 && !s.dead) return this.go('notice');
    this.subT -= dt;
    if (this.sub === 'walk') {
      const d = this.steer(dt, this.goal, this.walkSpeed, TURN.walk, 0.8);
      this.gait(); this.steps('bear_step', 2, 30);
      if (d < 0.9 || this.subT <= 0 || this.stuck > 2) this.next();
    } else if (this.sub === 'eat') {
      this.speed = 0; this.walk(dt, 0);
      if (this.carcass) this.face(this.yawTo(this.carcass.x, this.carcass.z), dt, 0.8);
      if (this.subT <= 0) {
        if (Math.random() < 0.45) { this.sound('bear_huff'); this.pause('sniff_air', 4); } else this.next();
      }
    } else {
      this.speed = damp(this.speed, 0, 5, dt); this.walk(dt, this.speed);
      if (this.subT <= 0) this.next();
    }
  }

  notice(dt, s, p) {
    this.speed = damp(this.speed, 0, 5, dt); this.walk(dt, this.speed);
    const want = this.yawTo(p.lastKnown.x, p.lastKnown.z);
    // the head first, then the body comes round after it
    this.headWant = clamp(angleDiff(this.yaw, want), -1.2, 1.2); this.headT = 1;
    if (this.stateT > this.turnAfter) this.face(want, dt, 1.1);
    if (p.awareness > 0.62) return this.decide();
    if (this.stateT > this.subT) {
      if (p.awareness < 0.25) return this.go('roam');
      return this.decide();
    }
  }

  decide() {
    if (this.dp < 10 && this.faced > 0.8 && this.threatCD <= 0) return this.go('threat');
    if (this.dp < 14 && Math.random() < this.aggression) return this.go('charge');
    return this.go('stalk');
  }

  stalk(dt, s, p) {
    if (s.dead) return this.go('feed');
    if (p.knownT > 14 && p.awareness < 0.3) return this.go('roam');
    if ((this.growlT -= dt) <= 0) { this.growlT = 6 + Math.random() * 8; this.sound(Math.random() < 0.5 ? 'bear_growl' : 'bear_huff'); }
    // where to be: `keep` off, round behind you, at the edge of your light
    const keep = clamp(s.flashOn ? s.flashRange + 2 : 17, 15, 25);
    const tgt = p.knownT < 3 ? s.feet : p.lastKnown;
    let bx = this.pos.x - tgt.x, bz = this.pos.z - tgt.z;
    const bd = Math.hypot(bx, bz) || 1;
    bx /= bd; bz /= bd;
    const lh = Math.hypot(s.look.x, s.look.z) || 1;
    let wx = bx * 0.65 - (s.look.x / lh) * 0.35, wz = bz * 0.65 - (s.look.z / lh) * 0.35;
    // your light on it: dead still, then off to one side out of the beam
    if (p.lit) this.freezeT += dt; else this.freezeT = Math.max(0, this.freezeT - dt * 0.5);
    const slink = p.lit && this.freezeT > 1.6;
    const turn = (slink ? 0.9 : 0.2) * this.side;
    const c = Math.cos(turn), sn = Math.sin(turn);
    [wx, wz] = [wx * c - wz * sn, wx * sn + wz * c];
    const wl = Math.hypot(wx, wz) || 1;
    this.goal.set(tgt.x + (wx / wl) * keep, tgt.y, tgt.z + (wz / wl) * keep);
    const far = this.dp > 30;
    this.stalking = !far;
    if (p.lit && !slink) {
      this.speed = damp(this.speed, 0, 8, dt); this.walk(dt, this.speed);
      this.face(this.toYaw, dt, 0.6);
      this.play('stalk', 0.35, 0.02);
    } else {
      const toGoal = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
      const speed = far ? GAIT.trot * 0.9 : toGoal > 2 ? GAIT.stalk * (0.85 + 0.35 * Math.sin(this.t * 0.7)) * (slink ? 1.6 : 1) : 0;
      this.steer(dt, this.goal, speed, far ? TURN.trot : TURN.stalk, 1.5);
      if (toGoal < 2) this.face(this.toYaw, dt, 1.2);
      this.gait(); this.steps('bear_step', 2, 25);
    }
    // and when it comes
    if (this.dp < 10 && this.faced > 0.75 && this.threatCD <= 0) return this.go('threat');
    if (this.dp < 6) return this.go('charge');
    if (s.running && this.dp < 30 && p.sees && s.vel.x * (s.feet.x - this.pos.x) + s.vel.z * (s.feet.z - this.pos.z) > 0) {
      this.runT += dt;
      if (this.runT > 0.8 && Math.random() < dt * 1.2) return this.go('charge');
    } else this.runT = Math.max(0, this.runT - dt);
    // (followed long enough: it comes when you've turned your back on it)
    if ((this.stalkT -= dt) <= 0 && p.sees && this.dp < 26 && (this.faced < 0.6 || this.dp < 12)) return this.go('charge');
  }

  threat(dt, s) {
    this.speed = damp(this.speed, 0, 6, dt); this.walk(dt, this.speed);
    this.face(this.toYaw, dt, this.rearing && this.clipT > 0.5 && this.clipT < 2.8 ? 0.4 : 1.6);
    if (!this.roared && this.clipT > this.roarAt) { this.roared = true; this.sound('bear_roar'); this.mgr.stats?.scare?.(0.3); }
    if (this.clipDone) {
      if (s.dead) return this.go('feed');
      if (this.dp < 7 || this.dp < this.startDp - 1.2 || Math.random() < this.aggression * 0.7) return this.go('charge');
      return this.go('stalk');
    }
  }

  charge(dt, s, p) {
    if (s.dead) return this.go('feed');
    const ahead = angleDiff(this.yaw, this.toYaw);
    if (this.skidT > 0) {
      // it missed: carried on past, braking, then round again
      this.skidT -= dt;
      this.speed = damp(this.speed, 1.2, 1.7, dt);
      this.face(this.yaw + Math.sign(ahead) * 0.25, dt, 0.5);
      this.walk(dt, this.speed); this.gait(); this.steps('bear_step', 2, 35);
      return;
    }
    if (this.routed > 0) {
      // something in the way: round it by the route, at a run
      this.routed -= dt;
      this.steer(dt, s.feet, GAIT.charge * 0.75, 2.2, 0.5);
    } else {
      this.face(this.toYaw, dt, this.speed > 3.5 ? TURN.charge : 2.2);
      // (you off to one side: it brakes to come round, else it would circle you at a gallop)
      const brake = Math.abs(ahead) < 0.7 ? 1 : clamp(1.5 - Math.abs(ahead), 0.3, 1);
      this.speed = damp(this.speed, GAIT.charge * this.chargeK * brake, brake < 1 ? 2.5 : 1.8, dt);
      const moved = this.walk(dt, this.speed);
      if (this.speed > 1 && moved < this.speed * dt * 0.3) this.blockT += dt; else this.blockT = 0;
      if (this.blockT > 0.5) { this.routed = 3; this.route = null; this.blockT = 0; }
    }
    this.gait(); this.steps('bear_step', 2, 35);
    if (this.dp < REACH && Math.abs(ahead) < 0.7 && Math.abs(this.dy) < 1.2) return this.go('attack');
    if (this.dp < 5 && Math.abs(ahead) > 1.5 && this.speed > 3) { this.skidT = 0.6 + Math.random() * 0.5; this.sound('bear_huff'); }
    if (this.dp > 45 || p.knownT > 6) return this.go('stalk');
  }

  // a blow: the lunge the first time, then a swipe or a bite
  strike() {
    this.chasing = true; this.struck = false; this.wait = 0;
    if (!this.lunged) {
      this.lunged = true; this.move = 'lunge';
      this.play('lunge', 0.15, 1, true); this.hitAt = 0.45;
      this.mgr.stinger('jump'); this.sound('bear_roar');
    } else {
      this.move = Math.random() < 0.55 ? 'swipe' : 'bite';
      this.play(this.move, 0.18, 0.95 + Math.random() * 0.15, true);
      this.hitAt = this.move === 'swipe' ? 0.4 : 0.24;
      this.sound('bear_growl');
    }
  }

  attack(dt, s) {
    const ahead = angleDiff(this.yaw, this.toYaw);
    if (this.wait > 0) {
      // between blows: a beat, facing you, growling
      this.wait -= dt;
      this.face(this.toYaw, dt, 2.5);
      this.speed = damp(this.speed, this.dp > 1.9 ? 0.9 : 0, 6, dt); this.walk(dt, this.speed);
      if (this.wait <= 0) {
        if (s.dead) return this.go('feed');
        if (this.dp < REACH + 0.3) return this.strike();
        return this.go(this.dp < 14 ? 'charge' : 'stalk');
      }
      return;
    }
    this.face(this.toYaw, dt, this.struck ? 1 : 3);
    this.speed = damp(this.speed, !this.struck && this.dp > 1.9 ? 1 : 0, 6, dt); this.walk(dt, this.speed);
    if (!this.struck && this.clipT >= this.hitAt) {
      this.struck = true;
      const reach = this.move === 'lunge' ? 3.4 : 2.9;
      if (this.dp < reach && Math.abs(ahead) < 0.9 && Math.abs(this.dy) < 1.3 && !s.dead && !s.hidden) {
        this.mgr.hurtPlayer(this, this.move, 35 + Math.random() * 10);
        if (this.fur) this.fur.blood = Math.min(1, this.fur.blood + 0.05);
      }
    }
    if (this.clipDone) {
      this.wait = 0.2 + Math.random() * 0.5;
      this.play('idle', 0.25);
    }
  }

  flee(dt, s) {
    this.fleeT += dt; this.panicT -= dt;
    const speed = this.panicT > 0 ? GAIT.charge * 0.85 : GAIT.trot;
    // straight away (no route: it runs blind), round whatever it runs into
    this.face(this.yawTo(this.goal.x, this.goal.z) + this.dodge, dt, TURN.trot);
    this.speed = damp(this.speed, speed, 2, dt);
    const moved = this.walk(dt, this.speed);
    if (moved < this.speed * dt * 0.3) {
      if ((this.blockT += dt) > 0.5) { this.dodge = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.7); this.blockT = 0; this.dodgeT = 1.6; }
    } else this.blockT = 0;
    if ((this.dodgeT -= dt) <= 0) this.dodge = 0;
    this.gait(); this.steps('bear_step', 2, 35);
    const far = Math.hypot(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z);
    if (far > 75 || this.fleeT > 45) {
      this.home.pos.copy(this.pos); this.calmT = 60; this.sense.awareness = 0.1;
      this.go('roam');
    }
    void s;
  }

  // a noise: the head comes round to it; a shot close by may turn it
  hear(pos, loud, kind) {
    if (this.dead) return;
    this.headWant = clamp(angleDiff(this.yaw, this.yawTo(pos.x, pos.z)), -1.3, 1.3);
    this.headRate = 10; this.headT = 2.5;
    const calm = this.state === 'roam' || this.state === 'notice' || this.state === 'stalk';
    if (SHOTS.has(kind) && loud > 0.45 && calm) {
      if (kind === 'flaregun' || Math.random() < 0.45) { this.fleeFrom.copy(this.mgr.sense.feet); return this.go('flee'); }
      if (this.state === 'roam') this.go('notice');
    } else if (this.state === 'roam' && this.calmT <= 0 && this.sense.awareness > 0.3) this.go('notice');
  }

  damage(amount, point, dir, weaponId) {
    if (this.dead) return null;
    const part = this.partAt(point);
    const base = HITS[weaponId], def = WEAPONS[weaponId];
    let dmg = base != null ? base * clamp(def?.damage && amount ? amount / def.damage : 1, 0.5, 1.2) : amount;
    if (part === 'head') dmg *= 2;
    this.health -= dmg;
    const feet = this.mgr.sense.feet;
    this.sense.alarm(feet, 1);
    if (this.fur) this.fur.blood = Math.min(1, this.fur.blood + dmg / 400);
    if (this.health <= 0) { this.die(); return { part, damage: dmg, killed: true }; }
    this.sound('bear_hurt');
    this.headWant = clamp(angleDiff(this.yaw, this.toYaw), -1.3, 1.3); this.headRate = 12; this.headT = 1.5;
    if (weaponId === 'flaregun' || this.health < this.maxHealth * 0.4) {
      this.fleeFrom.copy(feet);
      if (this.state !== 'flee') { this.go('hurt'); this.after = 'flee'; }
    } else if (this.state !== 'attack' && this.state !== 'charge' && this.state !== 'flee') {
      this.go('hurt');
      this.after = Math.random() < (dmg > 60 ? 0.45 : 0.25) ? 'flee' : 'charge';
      if (this.after === 'flee') this.fleeFrom.copy(feet);
    }
    void dir;
    return { part, damage: dmg };
  }

  die(silent = false) {
    this.dead = true; this.chasing = false; this.stalking = false; this.health = 0;
    this.enter('dead');
    this.play('death', silent ? 0 : 0.25, 1, true);
    if (silent) { const a = this.actions.death; if (a) a.time = a.getClip().duration; }
    else { this.sound('bear_death'); this.mgr.died(this); }
  }

  // out of walls: a capsule laid along the body (tipped with the slope), not stood up
  push() {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), pos = this.pos;
    const y = pos.y + 0.8, rise = Math.tan(this.pitch);
    SEG.start.set(pos.x - fx * 0.75, y - rise * 0.75, pos.z - fz * 0.75);
    SEG.end.set(pos.x + fx * 0.85, y + rise * 0.85, pos.z + fz * 0.85);
    return this.resolve(SEG, this.cap.r);
  }

  // after the clips: the body on the slope, the head toward what it heard
  pose() {
    this.model.rotation.x = this.pitch;
    if (!this.dead) this.turnHead(this.headYaw);
  }

  dispose() {
    this.fur?.dispose();
    this.coatMat?.dispose();
    super.dispose();
  }
}
