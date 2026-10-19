import * as THREE from 'three';
import { clamp, damp } from '../core/util.js';

// You, aboard. Simulated entirely in boat space (forward -Z, up +Y): WASD walks relative to where
// you look, Shift runs, gravity pulls toward the deck. The capsule is pushed out of the boat's
// collision BVH (boat/Collision.js), so decks, stair ramps and walls just work, and because none
// of it knows the boat is moving, walking on a moving, rolling, turning deck feels like walking.
//
// The camera then goes to world space through the boat's frame. It takes her heading fully and
// most (not all) of her pitch and roll: your eyes stay roughly level the way a sailor's head does,
// while the deck and the horizon still tilt against each other.
//
// Stations (the wheel, the searchlight) hold you in place: station = { pos, yaw, yawRange,
// pitchRange, onLook(dyaw, dpitch) }.

const RADIUS = 0.3, HEIGHT = 1.78, EYE = 1.66;
const WALK = 1.75, RUN = 3.4, CLIMB = 1.6;
const GRAVITY = 16;
const _seg = new THREE.Line3(new THREE.Vector3(), new THREE.Vector3());
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qs = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);

export class Player {
  constructor({ camera, input, boat, model, settings }) {
    this.camera = camera; this.input = input; this.boat = boat; this.model = model; this.settings = settings;
    this.pos = new THREE.Vector3();        // feet, boat space
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;          // boat space
    this.onGround = false;
    this.station = null;
    this.zone = null;                      // the room you're in
    this.ladder = null;
    this.bob = 0; this.bobAmp = 0; this.stepPhase = 0;
    this.onStep = null;                    // (kind) footstep callback: 'metal', 'grate', 'stairs'
    this.frozen = false;
    this.eyeLocal = new THREE.Vector3();
    this.shakeT = 0;
    this.lean = 0;
  }

  spawn(spot) {
    this.pos.copy(spot.pos); this.yaw = spot.yaw ?? 0; this.pitch = 0; this.vel.set(0, 0, 0);
  }

  get eyeWorld() { return this.camera.position; }

  update(dt) {
    const input = this.input;
    const [mx, my] = input.look();
    const sens = 0.0022 * (this.settings.sensitivity ?? 1);
    if (this.station) {
      const s = this.station;
      const dyaw = -mx * sens * (s.lookScale ?? 1), dpitch = -my * sens * (s.lookScale ?? 1);
      if (s.onLook) s.onLook(dyaw, dpitch, dt);
      this.yaw = clamp(this.yaw + dyaw, s.yaw - s.yawRange, s.yaw + s.yawRange);
      this.pitch = clamp(this.pitch + dpitch, -(s.pitchDown ?? 1.2), s.pitchUp ?? 1.2);
      if (s.follow) s.follow(this);        // the searchlight: your view follows the beam
      this.pos.lerp(s.pos, 1 - Math.exp(-dt * 8));
      this.vel.set(0, 0, 0);
      this.bobAmp = damp(this.bobAmp, 0, 6, dt);
    } else if (!this.frozen) {
      this.yaw -= mx * sens;
      this.pitch = clamp(this.pitch - my * sens, -1.45, 1.45);
      this.walk(dt);
    }
    this.place(dt);
  }

  walk(dt) {
    const input = this.input;
    let fx = 0, fz = 0;
    if (input.key('KeyW')) fz -= 1;
    if (input.key('KeyS')) fz += 1;
    if (input.key('KeyA')) fx -= 1;
    if (input.key('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    const run = input.key('ShiftLeft') || input.key('ShiftRight');
    const speed = run ? RUN : WALK;
    // wish direction in boat space
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let wx = 0, wz = 0;
    if (len > 0) { fx /= len; fz /= len; wx = fx * c + fz * s; wz = -fx * s + fz * c; }

    this.ladder = this.model.ladderAt(_v.copy(this.pos).setY(this.pos.y + 0.4));
    const climbing = !!this.ladder && (input.key('KeyW') || input.key('KeyS'));
    const accel = this.onGround || climbing ? 14 : 2.5;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);
    if (climbing) {
      // on a ladder: W climbs, S goes down, and you keep a little way forward to step off at the top
      this.vel.y = input.key('KeyW') ? CLIMB : -CLIMB;
      this.vel.x *= 0.35; this.vel.z *= 0.35;
      this.stepPhase += dt * 2.2;
      if (this.stepPhase > 1) { this.stepPhase = 0; this.onStep?.('ladder'); }
    } else if (!this.onGround) {
      this.vel.y -= GRAVITY * dt;
    }

    // substeps: the capsule never moves more than a few cm per resolve
    const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 0.08));
    const h = dt / steps;
    let grounded = false;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, h);
      _seg.start.set(this.pos.x, this.pos.y + RADIUS, this.pos.z);
      _seg.end.set(this.pos.x, this.pos.y + HEIGHT - RADIUS, this.pos.z);
      const before = _w.copy(_seg.start);
      this.model.collision.resolve(_seg, RADIUS);
      const dx = _seg.start.x - before.x, dy = _seg.start.y - before.y, dz = _seg.start.z - before.z;
      // pushed up more than gravity would explain: standing on something
      if (dy > Math.abs(h * this.vel.y) * 0.25 && dy > 1e-5) grounded = true;
      this.pos.x += dx; this.pos.y += dy; this.pos.z += dz;
      if (grounded) { if (this.vel.y < 0) this.vel.y = 0; }
      else if (Math.hypot(dx, dy, dz) > 1e-5) {
        const n = _v.set(dx, dy, dz).normalize();
        const into = this.vel.dot(n);
        if (into < 0) this.vel.addScaledVector(n, -into);
      }
    }
    if (climbing) grounded = false;
    // stuck to the deck going down stairs and over sills: a short probe below the feet
    if (!grounded && !climbing && this.onGround && this.vel.y <= 0) {
      const floor = this.model.collision.floorAt(this.pos.x, this.pos.y, this.pos.z, 0.35);
      if (floor !== null && this.pos.y - floor < 0.32) { this.pos.y = floor + 0.01; grounded = true; this.vel.y = 0; }
    }
    this.onGround = grounded;
    // fell off the boat (shouldn't happen; if it does, back aboard)
    if (this.pos.y < -12) { this.pos.copy(this.model.spots.spawn?.pos ?? new THREE.Vector3(0, 3, 10)); this.vel.set(0, 0, 0); }

    // head bob and footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.bobAmp = damp(this.bobAmp, this.onGround ? clamp(hs / RUN, 0, 1) : 0, 8, dt);
    if (this.onGround && hs > 0.4) {
      const prev = this.stepPhase;
      this.stepPhase = (this.stepPhase + dt * hs * (run ? 0.62 : 0.78)) % 1;
      if ((prev < 0.5 && this.stepPhase >= 0.5) || this.stepPhase < prev) this.onStep?.(this.surface());
    }
    this.bob += dt * hs * 4.6;
  }

  surface() {
    const z = this.zone;
    if (z === 'engine') return 'grate';
    if (z === 'mess' || z === 'galley' || z === 'bridge') return 'floor';
    return 'metal';
  }

  // boat space → the camera in the world
  place(dt) {
    const boat = this.boat;
    this.zone = this.model.zoneAt(_v.copy(this.pos).setY(this.pos.y + 1));
    const bobY = Math.sin(this.bob * 2) * 0.035 * this.bobAmp;
    const bobX = Math.cos(this.bob) * 0.025 * this.bobAmp;
    this.eyeLocal.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    // the bob's sideways part is across your view
    this.eyeLocal.x += Math.cos(this.yaw) * bobX; this.eyeLocal.z -= Math.sin(this.yaw) * bobX;
    this.camera.position.copy(this.eyeLocal).applyMatrix4(boat.root.matrixWorld);

    // orientation: the boat's heading fully, 75% of her pitch and roll
    _e.set(boat.pitch * 0.75, boat.heading, boat.roll * 0.75, 'YXZ');
    _q.setFromEuler(_e);
    _qy.setFromAxisAngle(Y, this.yaw);
    _qp.setFromAxisAngle(X, this.pitch);
    this.camera.quaternion.copy(_q).multiply(_qy).multiply(_qp);
    // ice impacts: a short shake
    if (boat.shake > 0) {
      this.shakeT += dt * 38;
      const a = boat.shake * boat.shake * 0.03;
      _qs.setFromEuler(_e.set(Math.sin(this.shakeT * 1.3) * a, Math.sin(this.shakeT * 0.9 + 1) * a, Math.sin(this.shakeT * 1.7 + 2) * a * 1.5, 'YXZ'));
      this.camera.quaternion.multiply(_qs);
    }
    this.camera.updateMatrixWorld();
  }

  // the direction you're looking, boat space
  lookDir(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyAxisAngle(X, this.pitch).applyAxisAngle(Y, this.yaw);
  }
  get eyeBoat() { return this.eyeLocal; }
}
