import * as THREE from 'three';
import { damp } from '../core/util.js';

// Your flashlight (фонарь), F: a spot held a little right of and below the eye, its beam lagging
// the view the way a hand does, a cookie that draws the reflector's hot centre, its ring and the
// dimmer spill round it, real shadows. It runs on stats.battery: it dims and stutters as the
// battery goes, dies when it is empty; a fresh battery brings it back.
//
// The light exists from the start (the scene's light count never changes); off is intensity 0.

function cookie(size = 256) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const r = Math.hypot(u, v);
    // the hot spot, the reflector's ring, the spill, a smudge on the lens
    let k = Math.exp(-((r / 0.22) ** 2)) * 1.0 + Math.exp(-(((r - 0.42) / 0.07) ** 2)) * 0.35 + Math.max(0, 1 - r) ** 1.5 * 0.32;
    k *= 1 - 0.12 * Math.exp(-(((u - 0.25) ** 2 + (v + 0.2) ** 2) / 0.02));
    k *= r < 0.98 ? 1 : 0;
    const c = Math.min(255, Math.round(k * 235));
    d[(y * size + x) * 4] = c; d[(y * size + x) * 4 + 1] = Math.round(c * 0.97); d[(y * size + x) * 4 + 2] = Math.round(c * 0.9); d[(y * size + x) * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

const _d = new THREE.Vector3(), _f = new THREE.Vector3(), _o = new THREE.Vector3();

export class Flashlight {
  constructor({ camera, scene, stats, audio, quality }) {
    this.camera = camera; this.stats = stats; this.audio = audio;
    this.on = false;
    this.power = 1;                     // what the battery gives (0..1)
    this.brightness = 1;
    this.light = new THREE.SpotLight(0xfff1dc, 0, 30, 0.5, 0.55, 1.6);
    this.light.map = cookie();
    this.light.userData.noViewmodel = true;           // (Viewmodel: the gun isn't lit by it point-blank)
    this.light.castShadow = (quality?.cascades ?? 2) >= 2;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.15; this.light.shadow.camera.far = 32;
    this.light.shadow.bias = -0.0004; this.light.shadow.normalBias = 0.02;
    this.light.name = 'Flashlight';
    scene.add(this.light); scene.add(this.light.target);
    this.dir = new THREE.Vector3(0, 0, -1);
    this.stutter = 0; this.t = 0;
    this.held = new THREE.Vector3(0.16, -0.14, -0.1);    // the hand, in the camera's frame
  }

  toggle(force) {
    const want = force ?? !this.on;
    if (want && this.stats && this.stats.battery <= 0) { this.audio?.horror?.sfx?.('dry_fire', null, { gain: 0.3 }); return false; }
    if (want === this.on) return this.on;
    this.on = want;
    this.audio?.horror?.sfx?.('light_click', null, { gain: 0.5 }) ?? this.audio?.sfx?.('switch', null, { gain: 0.4 });
    return this.on;
  }

  // the ray it lights along (world): for the creatures (a Shade backs away, a Turned hates it)
  get origin() { return this.light.position; }
  get direction() { return this.dir; }

  update(dt) {
    this.t += dt;
    const s = this.stats;
    if (s && this.on) {
      if (s.battery <= 0) { this.on = false; this.audio?.horror?.sfx?.('light_pop', null, { gain: 0.4 }); }
    }
    // the battery: full brightness down to 25 %, then dimmer and warmer; under 12 % it stutters
    const b = s ? s.battery / 100 : 1;
    this.power = b > 0.25 ? 1 : 0.35 + 0.65 * (b / 0.25);
    if (this.on && b < 0.12) {
      this.stutter -= dt;
      if (this.stutter <= -0.3) this.stutter = Math.random() * 2.5;
    } else this.stutter = 1;
    const cut = this.on && b < 0.12 && this.stutter < 0 ? (Math.random() < 0.5 ? 0.05 : 0.4) : 1;
    // the hand: the light at the hand, its aim lagging the view a little
    this.camera.updateMatrixWorld();
    _o.copy(this.held).applyMatrix4(this.camera.matrixWorld);
    this.light.position.copy(_o);
    this.camera.getWorldDirection(_f);
    const k = 1 - Math.exp(-dt * 14);
    this.dir.lerp(_f, k).normalize();
    // (a slight drift: no hand is still)
    _d.set(Math.sin(this.t * 0.9) * 0.006, Math.sin(this.t * 1.3 + 1) * 0.005, 0);
    this.light.target.position.copy(_o).addScaledVector(this.dir, 10).add(_d);
    this.light.target.updateMatrixWorld();
    const want = this.on ? 46 * this.power * cut * this.brightness : 0;
    this.light.intensity = damp(this.light.intensity, want, want > this.light.intensity ? 40 : 18, dt);
    this.light.color.setRGB(1, 0.94 - (1 - this.power) * 0.1, 0.86 - (1 - this.power) * 0.25);
  }
}
