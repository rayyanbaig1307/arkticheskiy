import * as THREE from 'three';
import { clamp, damp, angleDiff } from '../core/util.js';

// The Polyarnik under way. Owns the boat's frame (root): everything aboard (the model, the
// player, the crew, the lamps) is a child of it and lives in boat space, where forward is -Z,
// starboard +X and up +Y.
//
// Motion: the engine order (throttle) sets a target speed, reached slowly (a 42 m tug carries her
// way); the rudder turns her at a rate that grows with speed. The autopilot steers when nobody is
// at the wheel. She rides the swell: heave, pitch and roll follow the water under her bow, stern
// and sides through springs (roll the least damped), plus a heel into turns. Ice: IceField.js
// tests her hull circles against the bergs and floes and calls hit(), which costs speed and shakes
// the camera.

export const ORDERS = [
  { name: 'STOP', ru: 'СТОП', speed: 0 },
  { name: 'SLOW AHEAD', ru: 'МАЛЫЙ', speed: 2.2 },
  { name: 'HALF AHEAD', ru: 'СРЕДНИЙ', speed: 4.2 },
  { name: 'FULL AHEAD', ru: 'ПОЛНЫЙ', speed: 6.3 },
];
const MAX_RUDDER = 0.6;   // rad (35 degrees)

// her waterline as circles along the keel (boat space z, radius), for the ice
export const HULL_CIRCLES = [[-18.5, 1.6], [-14, 3.4], [-8.5, 4.9], [-2, 5.5], [5, 5.6], [11.5, 5.3], [16.8, 4.4]];

const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Boat {
  constructor({ waves }) {
    this.waves = waves;
    this.root = new THREE.Group();
    this.root.name = 'BoatFrame';
    this.x = 0; this.z = 0; this.heading = 0;
    this.speed = ORDERS[2].speed; this.order = 2;
    this.engineOn = true;
    this.rudder = 0; this.yawRate = 0;
    this.autopilot = true; this.pilot = null;      // pilot(boat) -> wanted heading (rad)
    this.helm = 0;                                  // the wheel, when someone has it (-1 port .. 1 starboard)
    this.heave = 0; this.pitch = 0; this.roll = 0;
    this.vHeave = 0; this.vPitch = 0; this.vRoll = 0;
    this.shake = 0;                                 // camera shake (decays)
    this.listeners = new Set();
    this.trail = [];                                // the stern's track (the wake)
    this.trailT = 0;
    this.rpm = 0.5;                                 // 0 off .. 1 full (engine sound, gauges)
    this.load = 0;                                  // extra effort from ice (sound)
  }

  get forward() { return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)); }
  get targetSpeed() { return this.engineOn ? ORDERS[this.order].speed : 0; }

  setOrder(i) { this.order = clamp(i, 0, ORDERS.length - 1); this.emit('order', this.order); }
  setEngine(on) { this.engineOn = on; this.emit('engine', on); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind, data) { for (const fn of this.listeners) fn(kind, data); }

  // boat space -> world, and back
  toWorld(v, out = new THREE.Vector3()) { return out.copy(v).applyMatrix4(this.root.matrixWorld); }
  toLocal(v, out = new THREE.Vector3()) { return out.copy(v).applyMatrix4(_inv.copy(this.root.matrixWorld).invert()); }

  // the ice hit her: strength 0..1 (a floe brushing past .. a berg head on)
  hit(strength, worldPoint, big) {
    this.speed *= big ? Math.max(0.15, 1 - strength * 1.6) : Math.max(0.6, 1 - strength * 0.4);
    this.shake = Math.max(this.shake, big ? 0.35 + strength * 0.9 : strength * 0.25);
    this.vRoll += (Math.random() - 0.5) * strength * (big ? 0.12 : 0.03);
    this.vPitch += (big ? -0.05 : -0.01) * strength;
    this.emit('hit', { strength, point: worldPoint, big });
  }

  update(dt) {
    // speed: toward the order, slowly (and slower still to stop: she carries her way)
    const want = this.targetSpeed;
    const accel = want > this.speed ? 0.22 : 0.12;
    this.speed += clamp(want - this.speed, -accel * dt, accel * dt);
    this.rpm = damp(this.rpm, this.engineOn ? 0.28 + 0.72 * (ORDERS[this.order].speed / ORDERS[3].speed) : 0, 1.2, dt);
    this.load = damp(this.load, 0, 1.5, dt);

    // rudder: the autopilot, or the wheel
    let rudderWant;
    if (this.autopilot && this.pilot) {
      const err = angleDiff(this.heading, this.pilot(this));
      rudderWant = clamp(-err * 1.6 + this.yawRate * 3.2, -MAX_RUDDER, MAX_RUDDER);
    } else {
      rudderWant = this.helm * MAX_RUDDER;
    }
    this.rudder = damp(this.rudder, rudderWant, this.autopilot ? 1.5 : 3, dt);
    // turning: the rudder bites in proportion to the water past it (plus a little prop wash)
    const bite = this.speed * 0.028 + (this.engineOn ? 0.012 : 0);
    const yawWant = -this.rudder * bite;
    this.yawRate = damp(this.yawRate, yawWant, 0.9, dt);
    this.heading += this.yawRate * dt;

    // way: along her heading
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    this.x += fx * this.speed * dt; this.z += fz * this.speed * dt;

    this.ride(dt, fx, fz);
    this.shake = Math.max(0, this.shake - dt * 1.4);

    _e.set(this.pitch, this.heading, this.roll, 'YXZ');
    this.root.quaternion.setFromEuler(_e);
    this.root.position.set(this.x, this.heave, this.z);
    this.root.updateMatrix();
    this.root.matrixWorld.copy(this.root.matrix);     // (its parent is the scene: identity)

    // the wake: the stern's track every few metres
    this.trailT += this.speed * dt;
    if (this.trailT > 3 || !this.trail.length) {
      this.trailT = 0;
      const sx = this.x - fx * 18, sz = this.z - fz * 18;
      this.trail.push({ x: sx, z: sz, t: 0, speed: this.speed, hx: fx, hz: fz });
      if (this.trail.length > 90) this.trail.shift();
    }
    for (const p of this.trail) p.t += dt;
  }

  // follow the swell: target heave, pitch and roll from the water at her ends and sides
  ride(dt, fx, fz) {
    const w = this.waves;
    const rx = -fz, rz = fx;                  // starboard
    const hb = w.heightAt(this.x + fx * 16, this.z + fz * 16);
    const hs = w.heightAt(this.x - fx * 15, this.z - fz * 15);
    const hp = w.heightAt(this.x - rx * 5, this.z - rz * 5);
    const hS = w.heightAt(this.x + rx * 5, this.z + rz * 5);
    const hc = w.heightAt(this.x, this.z);
    const heaveT = (hb + hs + hp + hS + hc * 2) / 6 - this.speed * 0.012;
    const pitchT = Math.atan2(hb - hs, 31) * 0.85 + this.speed * 0.002;
    // (a positive roll about her aft-pointing z puts the port side down)
    const rollT = Math.atan2(hS - hp, 10) * 0.7 + this.yawRate * this.speed * 0.45;
    const spring = (x, v, t, k, c) => v + ((t - x) * k - v * c) * dt;
    this.vHeave = spring(this.heave, this.vHeave, heaveT, 3.2, 2.6);
    this.vPitch = spring(this.pitch, this.vPitch, pitchT, 2.6, 2.2);
    this.vRoll = spring(this.roll, this.vRoll, rollT, 1.25, 0.55);
    this.heave += this.vHeave * dt; this.pitch += this.vPitch * dt; this.roll += this.vRoll * dt;
  }

  // the hull's circles in world space, for the ice (x, z, r)
  hullCircles(out = []) {
    out.length = 0;
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    for (const [lz, r] of HULL_CIRCLES) out.push([this.x - fx * lz, this.z - fz * lz, r, lz]);
    return out;
  }
}

const _inv = new THREE.Matrix4();
void _q;
