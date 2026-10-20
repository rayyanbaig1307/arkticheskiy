import * as THREE from 'three';
import { weaponTextures } from './textures.js';

// Flares: the SPSh-44's shot and the hand flares (G). Each is a burning red star: it flies (an
// arc, a little drag), bounces once off what it hits (a direct hit hurts: the Turned burn), comes
// to rest and burns there, spitting sparks and rolling out smoke, lighting everything round it
// red, then sputters out. A hand flare burns 40 s from the moment it is struck, in your hand and
// then wherever it lands; the pistol's flare burns 30 s on the ground.
//
// The light is one of the pool's (Effects.js: made at the start, never added or removed): the
// nearest burning flares get them, the rest glow without one. onFlare(position, burning, flare) is
// called when a flare is lit, when it lands and when it goes out, so bears and the Shades can
// react; `active` lists the ones burning now (for the creatures to ask each frame). Thrown or
// fired, a flare hisses (onLoop: the audio's positional 'fire' loop on its glow).
//
// In flight a flare is simulated in the frame you stand in (as the brass is); where it lands
// decides where it stays: on the boat it rides with her, on the ice it stays on the ice.

const MAX = 6;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion();
const Yax = new THREE.Vector3(0, 1, 0);
const RED = new THREE.Color(1.0, 0.16, 0.07);
const KIND = {
  pistol: { burn: 30, grav: 5.5, drag: 0.12, rest: 0.3, bounces: 2, light: 95, dist: 30, glow: 0.75 },
  hand: { burn: 40, grav: 9.8, drag: 0.05, rest: 0.28, bounces: 3, light: 70, dist: 22, glow: 0.55 },
};
const STATE = { none: 0, held: 1, flying: 2, rest: 3, spent: 4 };

export class Flares {
  constructor({ fx, lighting = null }) {
    this.fx = fx;
    this.raycast = null;              // (origin, dir, range) -> hit | null (the world's raycastShot)
    this.useFloor = false;            // no world to hit: land on the floor you stand on (testing)
    this.floorY = 0;                  // that floor, in the frame's space
    this.onFlare = null;
    this.onHit = null;                // (hit, flare) a direct hit
    this.onLoop = null;               // (object3D, on) the burning sound
    const tex = weaponTextures();
    this.glowMat = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(7, 0.9, 0.45), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    // the hand flare's tube once it has left your hand (a world object: its own, unpatched materials)
    const std = (color, roughness, emissive = 0x000000) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, emissive });
      return lighting ? lighting.prep(m) : m;
    };
    const tube = new THREE.CylinderGeometry(0.0165, 0.0165, 0.21, 10); tube.rotateX(Math.PI / 2); tube.translate(0, 0, 0.035);
    const end = new THREE.CylinderGeometry(0.015, 0.016, 0.03, 10); end.rotateX(Math.PI / 2); end.translate(0, 0, -0.085);
    const tubeMat = std(0x8c1510, 0.68), endMat = std(0x1a1310, 0.9, 0x5a0800);
    this.list = Array.from({ length: MAX }, (_, i) => {
      const sprite = new THREE.Sprite(this.glowMat);
      sprite.visible = false;
      sprite.renderOrder = 9;
      const stick = new THREE.Group();
      stick.add(new THREE.Mesh(tube, tubeMat), new THREE.Mesh(end, endMat));
      stick.visible = false;
      stick.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
      return {
        i, state: 0, kind: 'hand', K: KIND.hand, R: fx.F, p: new THREE.Vector3(), v: new THREE.Vector3(),
        q: new THREE.Quaternion(), w: new THREE.Vector3(), world: new THREE.Vector3(), burn: 0, age: 0, bounces: 0,
        damage: 0, slot: -1, k: 0, glowK: 1, want: false, told: false, looping: false, ph: Math.random() * 100, sprite, stick, spentT: 0,
        get burning() { return (this.state === 1 || this.state === 2 || this.state === 3) && this.burn > 0; },
      };
    });
    this.activeList = [];
  }

  take() {
    let best = this.list[0];
    for (const f of this.list) {
      if (f.state === 0) { best = f; break; }
      if (f.state === 4 || (best.state !== 4 && f.age > best.age)) best = f;
    }
    if (best.state !== 0) this.free(best);
    return best;
  }

  free(f) {
    if (f.burning) this.onFlare?.(f.world, false, f);
    this.loop(f, false);
    f.state = 0; f.sprite.visible = false; f.stick.visible = false;
    f.sprite.removeFromParent(); f.stick.removeFromParent();
    this.releaseLight(f);
  }

  // the burning hiss: the audio's positional 'fire' loop, on the flare's glow
  loop(f, on) {
    if (f.looping === on) return;
    f.looping = on;
    this.onLoop?.(f.sprite, on);
  }

  attach(f, R) {
    f.R = R;
    R.group.add(f.sprite);
    if (f.kind === 'hand') R.group.add(f.stick);
  }

  // the pistol's flare, from the muzzle (world position and velocity)
  launch(world, vel, damage = 60) {
    const f = this.take();
    f.kind = 'pistol'; f.K = KIND.pistol;
    this.attach(f, this.fx.F);
    this.fx.toRoot(f.R, world, f.p); this.fx.dirToRoot(f.R, vel, f.v);
    f.state = STATE.flying; f.burn = f.K.burn + 12; f.age = 0; f.bounces = 0; f.damage = damage; f.k = 0;
    f.sprite.visible = true; f.stick.visible = false;
    f.world.copy(world);
    this.onFlare?.(f.world, true, f);
    this.loop(f, true);
    return f;
  }

  // a hand flare struck in your hand: it follows the hand (setHeld) until thrown
  hold() {
    const f = this.take();
    f.kind = 'hand'; f.K = KIND.hand;
    this.attach(f, this.fx.F);
    f.state = STATE.held; f.burn = f.K.burn; f.age = 0; f.bounces = 0; f.damage = 8; f.k = 0; f.told = false;
    f.sprite.visible = false; f.stick.visible = false;            // (the viewmodel draws it in hand)
    return f;
  }

  setHeld(f, world) {
    if (f.state !== STATE.held) return;
    this.fx.toRoot(f.R, world, f.p);
    f.world.copy(world);
    if (!f.told) { f.told = true; this.onFlare?.(f.world, true, f); }
  }

  // let go: thrown with a world velocity, tumbling end over end
  release(f, world, vel, quat) {
    if (f.state !== STATE.held) return;
    this.fx.toRoot(f.R, world, f.p); this.fx.dirToRoot(f.R, vel, f.v);
    f.q.copy(this.fx.frameQinv).multiply(quat);
    f.w.set(-8 - Math.random() * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2).applyQuaternion(f.q);
    f.state = STATE.flying;
    f.sprite.visible = true; f.stick.visible = true;
    this.loop(f, true);
  }

  get active() {
    const out = this.activeList;
    out.length = 0;
    for (const f of this.list) if (f.burning) out.push(f);
    return out;
  }

  update(dt, camPos) {
    const fx = this.fx;
    for (const f of this.list) {
      if (!f.state) continue;
      f.age += dt;
      if (f.state === STATE.spent) {
        if ((f.spentT += dt) > 30) this.free(f);
        else fx.fromRoot(f.R, f.p, f.world);
        continue;
      }
      if (f.state === STATE.flying) this.fly(f, dt);
      if (!f.state) continue;
      if (f.state === STATE.rest || f.state === STATE.held || f.kind === 'hand') f.burn -= dt;
      else if (f.burn > f.K.burn) f.burn -= dt;           // (the pistol's flare: its 30 s start on the ground)
      fx.fromRoot(f.R, f.p, f.world);
      if (f.burn <= 0) { this.out(f); continue; }
      const glow = this.flicker(f);
      fx.flareBurn(f.R, f.p, dt, f.state === STATE.flying ? 1.4 : 1);
      if (f.state !== STATE.held) {
        f.sprite.position.copy(f.p);
        f.sprite.scale.setScalar(f.K.glow * (0.75 + 0.35 * glow));
        if (f.kind === 'hand') { f.stick.position.copy(f.p); f.stick.quaternion.copy(f.q); }
      }
      f.glowK = glow;
    }
    this.lights(dt, camPos);
  }

  fly(f, dt) {
    const fx = this.fx, K = f.K;
    f.v.y -= K.grav * dt;
    f.v.multiplyScalar(Math.exp(-K.drag * dt));
    const a = fx.fromRoot(f.R, f.p, _a);
    const next = _b.copy(f.p).addScaledVector(f.v, dt);
    const bw = fx.fromRoot(f.R, next, _d);
    const len = bw.distanceTo(a);
    // the hand flare tumbles
    const wl = f.w.length();
    if (wl > 1e-3) f.q.premultiply(_q.setFromAxisAngle(_n.copy(f.w).multiplyScalar(1 / wl), wl * dt));
    let hit = null;
    if (len > 1e-5 && this.raycast) hit = this.raycast(a, _n.copy(bw).sub(a).multiplyScalar(1 / len), len + 0.03);
    if (!hit && this.useFloor && next.y < this.floorY) {
      hit = this.floorHit || (this.floorHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), surface: 'metal', target: null, object: null, distance: 0 });
      hit.point.copy(next).setY(this.floorY);
      fx.fromRoot(f.R, hit.point, hit.point);
      hit.normal.set(0, 1, 0).applyQuaternion(fx.frameQ);
    }
    if (!hit) {
      f.p.copy(next);
      // into the sea, or lost in the dark
      if (bw.y < -0.6 || f.age > 12) this.out(f, true);
      return;
    }
    if (f.bounces === 0 && hit.target && typeof hit.target.damage === 'function') {
      hit.target.damage(f.damage, hit.point.clone(), _d.copy(f.v).applyQuaternion(fx.frameQ).normalize().clone(), 'flaregun');
      this.onHit?.(hit, f);
    }
    f.bounces++;
    const n = fx.dirToRoot(f.R, hit.normal, _n).normalize();
    fx.toRoot(f.R, hit.point, f.p).addScaledVector(n, 0.03);
    // bounce: the normal part reflected (a little of it), the sliding part dragged
    const vn = f.v.dot(n);
    f.v.addScaledVector(n, -vn * (1 + K.rest));
    const vn2 = f.v.dot(n);
    f.v.multiplyScalar(0.6).addScaledVector(n, vn2 * 0.4);
    f.w.multiplyScalar(0.5);
    if (f.bounces >= K.bounces || f.v.length() < 1.3 || n.y > 0.7 && Math.abs(vn) < 2) this.land(f, hit);
  }

  land(f, hit) {
    const fx = this.fx;
    const R = fx.rootFor(hit);
    const world = fx.fromRoot(f.R, f.p, _a);
    if (R !== f.R) { this.attach(f, R); fx.toRoot(R, world, f.p); f.q.premultiply(R === fx.W ? fx.frameQ : fx.frameQinv); }
    f.state = STATE.rest;
    f.v.set(0, 0, 0); f.w.set(0, 0, 0);
    // a hand flare lies on its side (its tube on the ground); the pistol's star burns 30 s from here
    if (f.kind === 'hand') {
      _n.set(0, 0, 1).applyQuaternion(f.q); _n.y = 0;
      f.q.setFromAxisAngle(Yax, Math.atan2(_n.x, _n.z));
      f.p.y -= 0.012;
    } else f.burn = f.K.burn;
    f.world.copy(world);
    this.onFlare?.(f.world, true, f);
  }

  out(f, lost = false) {
    const was = f.burning || f.state === STATE.held || f.state === STATE.flying || f.state === STATE.rest;
    f.burn = 0;
    if (was) this.onFlare?.(f.world, false, f);
    this.loop(f, false);
    this.releaseLight(f);
    f.sprite.visible = false;
    if (f.kind === 'hand' && !lost && f.state === STATE.rest) { f.state = STATE.spent; f.spentT = 0; }
    else { f.state = 0; f.stick.visible = false; f.sprite.removeFromParent(); f.stick.removeFromParent(); }
  }

  // the light's flicker: a burning, fizzing, never steady red; it sputters in its last seconds
  flicker(f) {
    const t = f.age + f.ph;
    let k = 0.82 + 0.1 * Math.sin(t * 23) * Math.sin(t * 7.1) + 0.07 * Math.sin(t * 41 + 1.3) + (Math.random() - 0.5) * 0.08;
    if (f.burn < 3) k *= (f.burn / 3) * (Math.random() < 0.15 ? 0.4 : 1);
    if (f.age < 0.25) k *= f.age / 0.25;
    return k;
  }

  slotTaken(s) {
    for (const g of this.list) if (g.slot === s) return true;
    return false;
  }

  releaseLight(f) {
    if (f.slot < 0) return;
    const l = this.fx.pool.lights[f.slot];
    if (l) l.intensity = 0;
    f.slot = -1;
  }

  // the nearest burning flares get the pool's flare lights (slots 1..)
  lights(dt, camPos) {
    const pool = this.fx.pool.lights, n = pool.length - 1;
    if (n <= 0) return;
    // pick the n nearest (n and the list are tiny: repeated minimum)
    for (const f of this.list) f.want = false;
    for (let k = 0; k < n; k++) {
      let best = null, bd = Infinity;
      for (const f of this.list) {
        if (f.want || !f.burning) continue;
        const d = f.world.distanceToSquared(camPos) - (f.slot >= 0 ? 4 : 0) - (f.state === STATE.held ? 1e4 : 0);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) best.want = true;
    }
    for (const f of this.list) if (f.slot >= 0 && !f.want) this.releaseLight(f);
    for (const f of this.list) {
      if (!f.want) continue;
      if (f.slot < 0) {
        for (let s = 1; s <= n && f.slot < 0; s++) if (!this.slotTaken(s)) { f.slot = s; f.k = 0; }
        if (f.slot < 0) continue;
      }
      f.k = Math.min(1, f.k + dt * 4);
      const l = pool[f.slot];
      l.position.copy(f.world); l.position.y += 0.12;
      l.color.copy(RED);
      l.distance = f.K.dist;
      l.intensity = f.K.light * (f.glowK ?? 1) * f.k;
    }
  }
}
