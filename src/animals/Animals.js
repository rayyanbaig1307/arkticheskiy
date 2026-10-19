import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { tryGLB } from '../core/Assets.js';
import { NO_REFLECT } from '../world/Reflection.js';
import { angleDiff, rng } from '../core/util.js';

// The walruses and penguins out on the ice (tools/blender/make_animals.py). Some floes and bergy
// bits carry a herd (IceField decides which); when one comes within range of the boat its animals
// are taken from a pool, placed on the level spots measured on that shape (IceShapes.js), and ride
// it as it drifts and bobs. They rest (idle, breathing, looking round) and now and then shuffle to
// another spot.
//
// They react: when the boat comes close, or the horn sounds, walruses rear up and roar, then turn
// to watch (and the nearest few flop away from the hull); penguins call in alarm and scatter to the
// far side of the floe, waddling fast or tobogganing on their bellies. Sounds come from where they
// are (audio.animal).

const RANGE = 280;              // herds are placed within this distance of the boat
const ALARM = 75;               // the boat closer than this: alarm
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _qy = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);

class Animal {
  constructor(kind, gltf, scene) {
    this.kind = kind;
    this.root = cloneSkinned(gltf.scene);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.layers.set(NO_REFLECT); } });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = Object.fromEntries(gltf.animations.map((c) => [c.name, this.mixer.clipAction(c)]));
    for (const k of ['roar', 'flap']) if (this.actions[k] && kind === 'walrus' && k === 'roar') { this.actions[k].setLoop(THREE.LoopOnce); this.actions[k].clampWhenFinished = true; }
    this.clip = null; this.piece = null;
    this.lx = 0; this.lz = 0; this.ly = 0; this.yaw = 0; this.target = null; this.speed = 0;
    this.timer = Math.random() * 5; this.state = 'rest'; this.alarmT = 0;
    this.root.visible = false;
    scene.add(this.root);
  }

  play(name, fade = 0.4, ts = 1) {
    const a = this.actions[name]; if (!a) return;
    a.timeScale = ts;
    if (this.clip === name) return;
    const prev = this.actions[this.clip];
    a.reset().setEffectiveWeight(1).play();
    if (prev) prev.crossFadeTo(a, fade, false);
    this.clip = name;
  }
}

export class Animals {
  constructor({ scene, ice, audio, lighting }) {
    this.scene = scene; this.ice = ice; this.audio = audio; this.lighting = lighting;
    this.pool = { walrus: [], penguin: [] };
    this.herds = new Map();        // piece id -> [animals]
    this.r = rng(77);
    this.callT = 2;
  }

  async load() {
    const [w, p] = await Promise.all([tryGLB('models/walrus.glb'), tryGLB('models/penguin.glb')]);
    this.gltf = { walrus: w, penguin: p };
    for (const g of [w, p]) g?.scene.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.envMapIntensity = 0.8; this.lighting?.prep(m); }); } });
    // the pools: enough for the herds in range at once
    for (let i = 0; i < 16 && w; i++) this.pool.walrus.push(new Animal('walrus', w, this.scene));
    for (let i = 0; i < 40 && p; i++) this.pool.penguin.push(new Animal('penguin', p, this.scene));
  }

  free(kind) { return this.pool[kind].find((a) => !a.piece); }

  // herds onto the pieces in range, back to the pool from those out of it
  assign(boat) {
    const want = new Set();
    for (const pc of this.ice.pieces) {
      if (!pc.animals || !pc.drawn || !pc.shape.spots?.length) continue;
      const d = Math.hypot(pc.x - boat.x, pc.z - boat.z);
      if (d > RANGE) continue;
      want.add(pc.id);
      if (this.herds.has(pc.id)) continue;
      const kind = pc.animals;
      const r = rng(pc.id.split(',').reduce((a, v) => a * 31 + (+v || 7), 17));
      const n = kind === 'walrus' ? 2 + Math.floor(r() * 3) : 4 + Math.floor(r() * 6);
      const spots = pc.shape.spots.slice().sort(() => r() - 0.5);
      const herd = [];
      for (let i = 0; i < n && i < spots.length; i++) {
        const a = this.free(kind); if (!a) break;
        const s = spots[i];
        // (keep them apart: skip a spot too near one already taken)
        if (herd.some((h) => Math.hypot(h.lx - s[0], h.lz - s[2]) < (kind === 'walrus' ? 2.6 : 0.7))) continue;
        a.piece = pc; a.lx = s[0]; a.ly = s[1]; a.lz = s[2]; a.yaw = r() * Math.PI * 2;
        a.state = 'rest'; a.timer = 2 + r() * 8; a.target = null; a.alarmT = 0;
        a.play(kind === 'walrus' ? (r() < 0.5 ? 'idle' : 'breathe') : 'idle', 0);
        a.mixer.setTime(r() * 5);
        a.root.visible = true;
        herd.push(a);
      }
      this.herds.set(pc.id, herd);
    }
    for (const [id, herd] of this.herds) {
      if (want.has(id)) continue;
      for (const a of herd) { a.piece = null; a.root.visible = false; }
      this.herds.delete(id);
    }
  }

  // the horn: everything within earshot reacts
  horn(pos) {
    for (const herd of this.herds.values()) for (const a of herd) {
      const d = Math.hypot(a.piece.x - pos.x, a.piece.z - pos.z);
      if (d < 600) this.alarm(a, Math.min(1.2, 0.3 + d / 400) * Math.random());
    }
  }

  alarm(a, delay = 0) {
    if (a.state === 'alarm' && a.alarmT > 0) return;
    a.state = 'alarm'; a.alarmT = 6 + Math.random() * 4; a.delay = delay; a.alarmed = false;
  }

  spotAway(a, boat) {
    // the level spot on this floe farthest from the boat
    const pc = a.piece; let best = null, bd = -1;
    const c = Math.cos(pc.rot), s = Math.sin(pc.rot);
    for (const sp of pc.shape.spots) {
      const wx = pc.x + (sp[0] * c + sp[2] * s) * pc.scale, wz = pc.z + (-sp[0] * s + sp[2] * c) * pc.scale;
      const d = Math.hypot(wx - boat.x, wz - boat.z) + Math.random() * 2;
      if (d > bd) { bd = d; best = sp; }
    }
    return best;
  }

  update(dt, boat, camera) {
    if (!this.gltf) return;
    this.assign(boat);
    this.callT -= dt;
    for (const herd of this.herds.values()) {
      if (!herd.length) continue;
      const pc = herd[0].piece;
      if (!pc.matrix) continue;
      const dBoat = Math.hypot(pc.x - boat.x, pc.z - boat.z);
      const camD = Math.hypot(pc.x - camera.position.x, pc.z - camera.position.z);
      if (dBoat < ALARM) for (const a of herd) if (a.state !== 'alarm') this.alarm(a, Math.random() * 0.8);
      // ambient calls now and then from the nearest herds
      if (this.callT <= 0 && camD < 220) {
        const a = herd[Math.floor(Math.random() * herd.length)];
        this.audio?.animal?.(a.kind === 'walrus' ? 'walrus_grunt' : 'penguin_call', this.worldPos(a, _p).clone());
        this.callT = 3 + Math.random() * 6;
      }
      for (const a of herd) this.think(a, dt, boat);
      // place them on the floe (its turn and tilt, not its scale)
      pc.matrix.decompose(_p, _q, _s);
      for (const a of herd) {
        _p.set(a.lx, a.ly, a.lz).applyMatrix4(pc.matrix);
        a.root.position.copy(_p);
        _qy.setFromAxisAngle(Y, a.yaw);
        a.root.quaternion.copy(_q).multiply(_qy);
        // the mixers stop out of sight range
        const near = camD < 70;
        if (near !== a.shadow) { a.shadow = near; a.root.traverse((o) => { if (o.isMesh) o.castShadow = near; }); }
        if (camD < 160) a.mixer.update(dt);
        else if (camD < 300 && (this._tick = (this._tick + 1 || 0)) % 4 === 0) a.mixer.update(dt * 4);
      }
    }
  }

  worldPos(a, out) { return out.set(a.lx, a.ly + 0.6, a.lz).applyMatrix4(a.piece.matrix); }

  // breath points of the animals near the camera (world): just in front of each muzzle or beak
  mouths(camera, out = []) {
    out.length = 0;
    for (const herd of this.herds.values()) for (const a of herd) {
      if (!a.piece?.matrix) continue;
      const head = a.head || (a.head = a.root.getObjectByName('head') || null);
      if (!head) continue;
      head.getWorldPosition(_p);
      if (_p.distanceTo(camera.position) > 70) continue;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(a.root.quaternion);
      const big = a.kind === 'walrus';
      out.push({ a, pos: _p.clone().addScaledVector(fwd, big ? 0.55 : 0.12).add(new THREE.Vector3(0, big ? -0.05 : 0.05, 0)), fwd, big });
    }
    return out;
  }

  think(a, dt, boat) {
    const walrus = a.kind === 'walrus';
    if (a.state === 'alarm') {
      if (a.delay > 0) { a.delay -= dt; return; }
      if (!a.alarmed) {
        a.alarmed = true;
        if (walrus) {
          // face the boat, rear up and roar; then perhaps shuffle off
          this.faceBoat(a, boat, 1);
          a.play('roar', 0.3);
          this.audio?.animal?.('walrus_roar', this.worldPos(a, _p).clone());
          a.fleeAfter = Math.random() < 0.5 ? 2.6 : -1;
        } else {
          this.audio?.animal?.(Math.random() < 0.6 ? 'penguin_alarm' : 'penguin_call', this.worldPos(a, _p).clone());
          a.target = this.spotAway(a, boat);
          a.slide = Math.random() < 0.35;
          a.play(a.slide ? 'slide' : Math.random() < 0.3 ? 'flap' : 'waddle', 0.25, a.slide ? 1.3 : 1.6);
          a.speed = a.slide ? 1.5 : 0.65;
        }
      }
      if (walrus && a.fleeAfter > 0 && (a.fleeAfter -= dt) <= 0) {
        a.target = this.spotAway(a, boat); a.speed = 0.45; a.play('flop', 0.4);
      }
      this.move(a, dt);
      if ((a.alarmT -= dt) <= 0 && !a.target) { a.state = 'rest'; a.timer = 3 + Math.random() * 5; a.play(walrus ? 'look' : 'idle', 0.6); }
      return;
    }
    // resting: idle, breathing, looking; now and then off to another spot on the floe
    if (a.target) { this.move(a, dt); return; }
    if ((a.timer -= dt) <= 0) {
      const r = Math.random();
      if (r < 0.25 && a.piece.shape.spots.length > 3) {
        const sp = a.piece.shape.spots[Math.floor(Math.random() * a.piece.shape.spots.length)];
        if (Math.hypot(sp[0] - a.lx, sp[2] - a.lz) < 6) { a.target = sp; a.speed = walrus ? 0.4 : 0.32; a.play(walrus ? 'flop' : 'waddle', 0.5); return; }
      }
      a.play(walrus ? (r < 0.6 ? 'idle' : r < 0.8 ? 'breathe' : 'look') : (r < 0.85 ? 'idle' : 'flap'), 0.6);
      a.timer = 4 + Math.random() * 8;
    }
  }

  move(a, dt) {
    if (!a.target) return;
    const [tx, ty, tz] = a.target;
    const dx = tx - a.lx, dz = tz - a.lz, d = Math.hypot(dx, dz);
    if (d < 0.2) {
      a.target = null;
      a.play(a.kind === 'walrus' ? 'look' : 'idle', 0.5);
      a.timer = 3 + Math.random() * 5;
      return;
    }
    const step = Math.min(d, a.speed * dt);
    a.lx += (dx / d) * step; a.lz += (dz / d) * step; a.ly += (ty - a.ly) * Math.min(1, dt * 3);
    // the model faces +z in glTF (Blender +y forward → glTF -z? no: +y → -z): turn toward travel
    const want = Math.atan2(dx, dz) + Math.PI;
    a.yaw += angleDiff(a.yaw, want) * Math.min(1, dt * 4);
  }

  faceBoat(a, boat, k) {
    const pc = a.piece;
    const inv = _m.copy(pc.matrix).invert();
    const lb = _p.set(boat.x, 0, boat.z).applyMatrix4(inv);
    a.yaw = Math.atan2(lb.x - a.lx, lb.z - a.lz) + Math.PI;
    void k;
  }
}
void _e;
