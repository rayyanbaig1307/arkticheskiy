import * as THREE from 'three';

// The boat's lamps. The model has many (LMP_ points: the mess, the hall, the lobby, the bridge,
// the engine room, the deck floodlights), but a forward renderer pays for every light on every
// pixel, so only two small pools of real point lights exist, made once (adding or removing lights
// recompiles every shader): one for the rooms, one for the deck floods. Each frame each pool goes
// to its lit lamps nearest you (the room you're in first), fading as they swap. Switches
// (Stations.js) turn groups of lamps on and off; the emissive fittings follow.

const _v = new THREE.Vector3();

class Pool {
  constructor(root, n, filter) {
    this.filter = filter;
    this.slots = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      root.add(l);
      this.slots.push({ light: l, lamp: null, k: 0 });
    }
  }

  update(dt, lamps, isOn, pos, zone, scaleOf) {
    const scored = [];
    for (const L of lamps) {
      if (!this.filter(L) || !isOn(L)) continue;
      let d = _v.copy(L.pos).distanceTo(pos);
      if (d > L.range + 12) continue;
      if (zone && L.room === zone) d -= 8;                              // your room first
      if (this.slots.some((s) => s.lamp === L)) d -= 1.5;               // (no flapping between two)
      scored.push([d, L]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    const want = scored.slice(0, this.slots.length).map((s) => s[1]);
    for (const s of this.slots) {
      const keep = s.lamp && want.includes(s.lamp) && isOn(s.lamp);
      if (keep) { want.splice(want.indexOf(s.lamp), 1); s.k = Math.min(1, s.k + dt * 5); }
      else if (s.k > 0.02) s.k = Math.max(0, s.k - dt * 6);
      else s.lamp = null;
    }
    for (const s of this.slots) if (!s.lamp && want.length) { s.lamp = want.shift(); s.k = 0; }
    for (const s of this.slots) {
      const L = s.lamp, l = s.light;
      if (!L) { l.intensity = 0; continue; }
      l.position.copy(L.pos); l.color.copy(L.color); l.distance = L.range;
      l.intensity = L.power * s.k * scaleOf(L);
    }
  }
}

export class Lights {
  constructor({ boat, model, count = 4 }) {
    this.boat = boat; this.model = model;
    this.rooms = new Pool(boat.root, count, (L) => L.group !== 'deck');
    this.floods = new Pool(boat.root, 2, (L) => L.group === 'deck');
    this.groups = { rooms: true, engine: true, deck: true, bridge: true };
    this.scale = 1;            // the time of day: the floods are dimmer by day
    this.flicker = 0;
  }

  setGroup(g, on) {
    this.groups[g] = on;
    // the fittings' glow goes with the switch (emissive materials named for the group)
    this.model.scene.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material?.name || '';
      const hit = (g === 'engine' && /Lamp_Engine/.test(n)) || (g === 'deck' && /Lamp_Cold/.test(n)) || (g === 'rooms' && /Lamp_Warm/.test(n));
      if (hit) o.material.emissiveIntensity = on ? (o.material.userData.e0 ??= o.material.emissiveIntensity) : 0;
    });
  }

  isOn(L) { return this.groups[L.group] !== false; }

  update(dt, playerPos, playerZone) {
    const lamps = this.model.lamps, on = (L) => this.isOn(L);
    this.rooms.update(dt, lamps, on, playerPos, playerZone, (L) => (L.group === 'engine' ? 0.6 * (1 - this.flicker) : 0.62));
    this.floods.update(dt, lamps, on, playerPos, null, () => this.scale * 1.1);
  }
}
