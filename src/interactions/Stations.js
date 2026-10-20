import * as THREE from 'three';
import { ORDERS } from '../boat/Boat.js';
import { clamp, damp } from '../core/util.js';
import { NO_REFLECT } from '../world/Reflection.js';

// Everything aboard that E works on, built from the model's INT_ nodes (boat/BoatModel.js):
//
//   wheel        take the helm: A/D steer, W/S engine orders, H the horn, E lets go (the
//                autopilot takes her back)
//   throttle     the engine order, one notch up (FULL wraps round to STOP)
//   horn         the ship's horn (the animals hear it)
//   searchlight  man the searchlight: the mouse aims it, your view follows the beam
//   radar        the radar's range: 0.5, 1, 2 nautical miles (the screen itself is radar/Radar.js)
//   radio        on and off (static, then voices in Russian)
//   kettle       on the stove, it boils in a while: whistle and steam; take it off again
//   door         open and shut (its collision box goes with it)
//   switch       the engine room's light switches: engine room, deck floods, rooms
//   engine       start and stop the main engine
//   winch        the towing winch's lever: heave in the towline, stop, pay it out (boat/Towline.js)
//
// The moving parts (the wheel turning with the rudder, the throttle lever, needles, the radar
// scanner) are animated here every frame.

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const EYE_H = 1.66;          // (the player's eye above their feet: Player.js EYE)
const RADAR_RANGES = [0.5, 1, 2];

export class Stations {
  constructor(ctx) {
    this.ctx = ctx;
    const { model, interactions, boat } = ctx;
    this.model = model; this.boat = boat;
    this.doors = []; this.needles = {}; this.switches = {};
    this.wheel = null; this.throttle = null; this.kettle = null; this.radios = {};
    this.radarRange = 1;
    this.slYaw = 0; this.slPitch = -0.05; this.slOn = true;
    this.at = null;              // the station you're at ('wheel', 'searchlight') or null
    this.events = [];

    for (const it of model.interact) {
      const fn = this['make_' + it.kind];
      if (fn) fn.call(this, it, interactions);
    }
    for (const [n, o] of Object.entries(model.nodes)) {
      if (n.startsWith('NEEDLE_')) this.needles[n.slice(7)] = { node: o, base: o.rotation.z, v: 0 };
    }
    this.scanner = model.nodes.RADAR_scanner || null;
    this.buildSearchlight();
  }

  emit(kind, data) { this.ctx.onEvent?.(kind, data); }
  sfx(name, node, opts) { this.ctx.audio?.sfx?.(name, node ? node.getWorldPosition(new THREE.Vector3()) : null, opts); }

  // ------------------------------------------------------------ the helm
  // the wheel is the mate's: you don't steer her (the story can put something of its own on it:
  // helmUse = { hint, use })
  make_wheel(it, I) {
    this.wheel = { node: it.node, base: it.node.rotation.z };
    this.helmLocked = true; this.helmUse = null;
    I.add(it.node, {
      hint: () => (this.helmUse ? this.helmUse.hint() : this.helmLocked ? 'Штурвал у старпома · The mate has the helm' : 'Take the wheel'),
      use: () => { if (this.helmUse) this.helmUse.use(); else if (!this.helmLocked) this.takeWheel(); },
      range: 2.2,
    });
  }

  takeWheel() {
    const { player, boat } = this.ctx;
    const spot = this.model.spots.wheel;
    this.at = 'wheel';
    boat.autopilot = false; boat.helm = 0;
    player.station = { pos: spot.pos, yaw: spot.yaw, yawRange: 1.9, pitchUp: 0.6, pitchDown: 0.6 };
    player.yaw = spot.yaw; player.pitch = -0.05;
    this.ctx.ui.toast('At the helm. A/D steer, W/S engine order, H horn, E to let go', 4.5);
    this.emit('helm', true);
  }

  leave() {
    const { player, boat } = this.ctx;
    if (this.at === 'wheel') { boat.autopilot = true; boat.helm = 0; this.emit('helm', false); }
    if (this.at === 'searchlight' && this.slReturn) { player.pos.copy(this.slReturn.pos); player.vel.set(0, 0, 0); player.yaw = this.slReturn.yaw; }
    this.at = null; player.station = null;
    this.ctx.ui.station('');
  }

  make_throttle(it, I) {
    this.throttle = { node: it.node, base: it.node.rotation.x, a: 0 };
    I.add(it.node, {
      hint: () => { const b = this.boat; if (this.helmLocked) return `Телеграф: ${ORDERS[b.order].ru} · Engine order: ${ORDERS[b.order].name} (the mate's)`; const n = (b.order + 1) % ORDERS.length; return `Engine order: ${ORDERS[b.order].name} → ${ORDERS[n].name}`; },
      use: () => { if (!this.helmLocked) this.setOrder((this.boat.order + 1) % ORDERS.length); },
      range: 2.2,
    });
  }

  setOrder(i) {
    const b = this.boat;
    if (!b.engineOn && i > 0) { this.ctx.ui.toast('The engine is stopped. Start it in the engine room.'); this.sfx('clunk', this.throttle?.node); return; }
    b.setOrder(i);
    this.sfx('telegraph', this.throttle?.node);
    this.ctx.ui.toast(`${ORDERS[i].ru} · ${ORDERS[i].name}`);
  }

  make_horn(it, I) {
    I.add(it.node, { hint: () => 'Sound the horn', use: () => this.horn(), range: 2.2 });
  }

  horn() {
    if (this.hornT > 0) return;
    this.hornT = 2.6;
    this.ctx.audio?.horn?.(this.model.spots.horn ? this.boat.toWorld(this.model.spots.horn.pos) : null);
    this.emit('horn', this.boat.toWorld(this.model.spots.horn?.pos ?? new THREE.Vector3(0, 12, 0)));
  }

  // ------------------------------------------------------------ searchlight
  buildSearchlight() {
    const n = this.model.nodes;
    this.sl = { yaw: n.SL_yaw, pitch: n.SL_pitch, lamp: n.SL_lamp };
    if (!this.sl.lamp) return;
    const q = this.ctx.quality;
    const spot = new THREE.SpotLight(0xdde8ff, 0, 900, THREE.MathUtils.degToRad(5.2), 0.45, 1.6);
    spot.castShadow = !!q.searchShadow;
    spot.shadow.mapSize.set(1024, 1024); spot.shadow.camera.near = 2; spot.shadow.camera.far = 600; spot.shadow.bias = -0.0004;
    const target = new THREE.Object3D(); target.position.set(0, 0, -50);
    this.sl.lamp.add(spot, target); spot.target = target;
    this.sl.light = spot;
    // the beam you can see in the air: a long cone, brightest along its core and near the lamp
    const len = 260;
    const geo = new THREE.CylinderGeometry(0.2, Math.tan(THREE.MathUtils.degToRad(4.2)) * len, len, 32, 1, true);
    geo.translate(0, -len / 2, 0); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0 }, uColor: { value: new THREE.Color(0.8, 0.88, 1.0) }, uLen: { value: len } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying float vT;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vT = -position.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uIntensity, uLen; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vT;
        void main(){
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float along = exp(-vT / (uLen * .22)) * smoothstep(0., 2.5, vT);
          gl_FragColor = vec4(uColor * edge * along * uIntensity, 1.);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.layers.set(NO_REFLECT);
    beam.frustumCulled = false;
    this.sl.lamp.add(beam);
    this.sl.beam = beam;
  }

  make_searchlight(it, I) {
    I.add(it.node, { hint: () => 'Man the searchlight', use: () => this.takeSearchlight(), range: 2.2 });
  }

  takeSearchlight() {
    const { player } = this.ctx;
    const spot = this.model.spots.searchlight;
    this.at = 'searchlight';
    const st = this;
    // your eye goes up beside the lamp on the roof, a little behind and above it, and turns with it,
    // so you see what the beam sees (from the control inside, the consoles and the window frames
    // were all there was); you're put back at the control when you let go
    this.slReturn = { pos: spot.pos.clone(), yaw: spot.yaw };
    const pivot = this.sl.yaw ? this.boat.toLocal(this.sl.yaw.getWorldPosition(new THREE.Vector3()), new THREE.Vector3()) : spot.pos.clone();
    const eyeAt = (yaw, out) => out.set(Math.sin(yaw) * 0.7, 0.5 - EYE_H, Math.cos(yaw) * 0.7).add(pivot);
    player.station = {
      pos: eyeAt(this.slYaw, new THREE.Vector3()), yaw: 0, yawRange: Math.PI * 2, pitchUp: 0.5, pitchDown: 0.6, lookScale: 0.8,
      onLook(dy, dp) { st.slYaw = clamp(st.slYaw + dy, -2.9, 2.9); st.slPitch = clamp(st.slPitch + dp, -0.45, 0.35); },
      follow(p) { p.yaw = st.slYaw; p.pitch = st.slPitch; eyeAt(st.slYaw, this.pos); },
    };
    this.ctx.ui.toast('Searchlight: aim with the mouse, E to let go', 3.5);
  }

  // ------------------------------------------------------------ radar, radio, kettle
  make_radar(it, I) {
    this.radarNode = it.node;
    I.add(it.node, {
      hint: () => `Radar range: ${this.radarRange} nm → ${RADAR_RANGES[(RADAR_RANGES.indexOf(this.radarRange) + 1) % 3]} nm`,
      use: () => { this.radarRange = RADAR_RANGES[(RADAR_RANGES.indexOf(this.radarRange) + 1) % 3]; this.sfx('click', it.node); },
      range: 2.4,
    });
  }

  make_radio(it, I) {
    const r = { node: it.node, on: false, id: it.id };     // (off until you switch one on)
    this.radios[it.id] = r;
    I.add(it.node, {
      hint: () => (r.on ? 'Switch the radio off' : 'Switch the radio on'),
      use: () => { r.on = !r.on; this.sfx('click', it.node); this.ctx.audio?.radio?.(r.id, r.on, it.node); },
      range: 2.2,
    });
  }

  make_kettle(it, I) {
    const k = { node: it.node, on: false, heat: 0, boiling: false };
    this.kettle = k;
    I.add(it.node, {
      hint: () => (k.on ? (k.boiling ? 'Take the kettle off the stove' : 'Take the kettle off') : 'Put the kettle on'),
      use: () => {
        k.on = !k.on; this.sfx('clank', it.node);
        if (!k.on) { k.boiling = false; this.ctx.audio?.kettle?.(false, it.node); }
        else this.ctx.ui.toast('The kettle is on.');
      },
      range: 2.0,
    });
  }

  // ------------------------------------------------------------ doors, switches, the engine
  make_door(it, I) {
    const node = it.node;
    const d = { node, id: it.id, base: node.rotation.y, a: 0, want: 0, sign: 1, locked: it.id === 'cabin' };
    // its collision box (boat space) while shut
    const box = new THREE.Box3().setFromObject(node);
    const inv = new THREE.Matrix4().copy(this.model.scene.matrixWorld).invert();
    box.applyMatrix4(inv);
    box.expandByScalar(0.02);
    d.col = this.model.collision.addBox(box);
    // a door to the open deck swings out and folds back flat against the outside of the house, as
    // a ship's doors are hooked back (at 100 degrees it stood across the narrow wings and side
    // decks, in your way and in your face); a door between two rooms swings away from you
    const hinge = node.position, leaf = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), d.base);
    const normal = new THREE.Vector3(-leaf.z, 0, leaf.x);
    const mid = hinge.clone().addScaledVector(leaf, 0.45).setY(hinge.y + 1.0);
    const room = (k) => this.model.zoneAt(mid.clone().addScaledVector(normal, k * 0.8));
    const inA = room(1), inB = room(-1);
    if (!inA !== !inB) { d.out = inA ? -1 : 1; d.max = 2.8; }     // (the side with no room is outside)
    this.doors.push(d);
    I.add(node, {
      hint: () => (d.locked ? 'Locked (crew cabin)' : d.want ? 'Close the door' : 'Open the door'),
      use: () => this.toggleDoor(d),
      range: 2.3,
    });
  }

  toggleDoor(d) {
    if (d.locked) { this.sfx('locked', d.node); return; }
    if (!d.want) {
      // swing away from you
      const p = this.ctx.player.pos;
      const hinge = _v.copy(d.node.position);
      const leaf = _w.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), d.base);
      const normal = new THREE.Vector3(-leaf.z, 0, leaf.x);       // the door's face normal (boat space)
      const side = Math.sign((p.x - hinge.x) * normal.x + (p.z - hinge.z) * normal.z) || 1;
      // (out onto the deck, whichever side you open it from; else away from you)
      d.sign = d.out ? -d.out : side;
      d.want = 1;
      this.sfx('door_open', d.node);
    } else {
      // (not on someone standing in the doorway)
      const p = this.ctx.player.pos;
      if (d.col.box.distanceToPoint(_v.set(p.x, p.y + 0.9, p.z)) < 0.35) return;
      d.want = 0;
      this.sfx('door_close', d.node);
    }
  }

  make_switch(it, I) {
    const s = { node: it.node, id: it.id, on: true, base: it.node.rotation.x };
    this.switches[it.id] = s;
    const names = { engine: 'engine room lights', deck: 'deck floodlights', rooms: 'cabin lights' };
    I.add(it.node, {
      hint: () => `${s.on ? 'Switch off' : 'Switch on'} the ${names[it.id] || it.id}`,
      use: () => { s.on = !s.on; this.ctx.lights.setGroup(it.id, s.on); this.sfx('switch', it.node); this.emit('switch', s); },
      range: 2.0,
    });
  }

  make_engine(it, I) {
    I.add(it.node, {
      hint: () => (this.boat.engineOn ? 'Stop the main engine' : 'Start the main engine'),
      use: () => this.toggleEngine(it.node),
      range: 2.2,
    });
  }

  toggleEngine(node) {
    const b = this.boat;
    if (this.starting) return;
    if (b.engineOn) {
      b.setEngine(false); this.sfx('button', node);
      this.ctx.audio?.engineStop?.();
      this.ctx.ui.toast('Main engine stopped. She will drift to a stop.');
    } else {
      this.starting = 2.6; this.sfx('button', node);
      this.ctx.audio?.engineStart?.();
      this.ctx.ui.toast('Starting...');
    }
  }

  make_winch(it, I) {
    this.winch = { node: it.node, base: it.node.rotation.x, a: 0 };
    const say = { stop: 'Stop the winch', in: 'Heave in the towline', out: 'Pay out the towline' };
    I.add(it.node, {
      hint: () => { const t = this.ctx.towline; return t?.ok ? `${say[t.nextCommand()]} (${Math.round(t.out)} m out)` : 'Winch'; },
      use: () => {
        const t = this.ctx.towline;
        if (!t?.ok) return;
        const c = t.nextCommand();
        t.command(c);
        this.sfx('clunk', it.node);
        this.ctx.ui.toast(c === 'stop' ? `Winch stopped. ${Math.round(t.out)} m of line out.` : c === 'in' ? 'Heaving in the towline...' : 'Paying out the towline...');
        this.emit('winch', c);
      },
      range: 2.3,
    });
  }

  // ------------------------------------------------------------ every frame
  update(dt) {
    const { input, boat, ui } = this.ctx;
    this.hornT = Math.max(0, (this.hornT || 0) - dt);
    if (this.starting > 0 && (this.starting -= dt) <= 0) {
      this.starting = 0; boat.setEngine(true); if (boat.order === 0) boat.setOrder(1);
      ui.toast('Main engine running.');
    }
    // at a station
    if (this.at === 'wheel') {
      let h = 0;
      if (input.key('KeyA')) h -= 1;
      if (input.key('KeyD')) h += 1;
      boat.helm = damp(boat.helm, h, 3, dt);
      if (input.hit('KeyW')) this.setOrder(Math.min(ORDERS.length - 1, boat.order + 1));
      if (input.hit('KeyS')) this.setOrder(Math.max(0, boat.order - 1));
      if (input.hit('KeyH')) this.horn();
      const kn = boat.speed * 1.944;
      const hdg = ((-boat.heading * 180 / Math.PI) % 360 + 360) % 360;
      ui.station(`<div class="big">${kn.toFixed(1)} kn</div>${ORDERS[boat.order].ru} · ${ORDERS[boat.order].name}<br>Heading ${hdg.toFixed(0).padStart(3, '0')}° · Rudder ${(boat.rudder * 57.3).toFixed(0)}°${boat.engineOn ? '' : '<br><b>ENGINE STOPPED</b>'}`);
      if (input.hit('KeyE')) { this.leave(); input.pressed.delete('KeyE'); }
    } else if (this.at === 'searchlight') {
      ui.station('<div class="big">Searchlight</div>Mouse aims · E lets go');
      if (input.hit('KeyE')) { this.leave(); input.pressed.delete('KeyE'); }
    }
    // the wheel follows the rudder (two and a half turns lock to lock)
    if (this.wheel) this.wheel.node.rotation.z = this.wheel.base + boat.rudder * 7.5;
    if (this.throttle) {
      const t = this.throttle;
      t.a = damp(t.a, -0.55 + (boat.order / (ORDERS.length - 1)) * 1.1, 8, dt);
      t.node.rotation.x = t.base - t.a;
    }
    // needles: rpm, oil pressure, temperature, volts
    const rpm = boat.rpm;
    const want = { rpm, bridge: rpm, oil: boat.engineOn ? 0.55 + rpm * 0.3 : 0, temp: 0.35 + rpm * 0.35, volt: this.ctx.lights.groups.engine ? 0.72 : 0.7 };
    for (const [k, n] of Object.entries(this.needles)) {
      const w = want[k] ?? 0.5;
      n.v = damp(n.v, w + Math.sin(performance.now() * 0.013 + k.length) * 0.006 * (boat.engineOn ? 1 : 0), 3, dt);
      n.node.rotation.z = n.base + 2.2 - n.v * 4.4;
    }
    if (this.scanner) this.scanner.rotation.y -= dt * 2.6;
    // the winch lever leans the way the drum turns
    if (this.winch) {
      const m = this.ctx.towline?.state;
      this.winch.a = damp(this.winch.a, m === 'in' ? -0.45 : m === 'out' ? 0.45 : 0, 8, dt);
      this.winch.node.rotation.x = this.winch.base + this.winch.a;
    }
    // doors swing
    for (const d of this.doors) {
      d.a = damp(d.a, d.want * (d.max || 1.75), 5, dt);
      d.node.rotation.y = d.base + d.a * d.sign;
      d.col.on = d.a < 0.35;
    }
    // the kettle: heats, then boils (whistle and steam)
    const k = this.kettle;
    if (k) {
      k.heat = clamp(k.heat + (k.on ? dt / 22 : -dt / 60), 0, 1);
      if (k.on && k.heat >= 1 && !k.boiling) { k.boiling = true; this.ctx.audio?.kettle?.(true, k.node); this.emit('kettle', true); }
    }
    // the searchlight: aimed by you, or sweeping slowly on its own
    if (this.sl.yaw) {
      if (this.at !== 'searchlight' && this.slAim) {
        // (the story points it: the lamp swings onto a world point, the way a man at it would)
        const par = this.sl.yaw.parent;
        par.updateMatrixWorld();
        const l = par.worldToLocal(_v.copy(this.slAim));
        const y0 = this.sl.yaw.position;
        const ty = Math.atan2(-(l.x - y0.x), -(l.z - y0.z));
        const tp = Math.atan2(l.y - y0.y, Math.hypot(l.x - y0.x, l.z - y0.z));
        let dy = ty - this.slYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.slYaw = damp(this.slYaw, this.slYaw + dy, this.slAimRate || 2.2, dt);
        this.slPitch = damp(this.slPitch, clamp(tp, -0.45, 0.35), this.slAimRate || 2.2, dt);
        this.sweepT = 0;
      } else if (this.at !== 'searchlight') {
        this.sweepT = (this.sweepT || 0) + dt;
        this.slYaw = damp(this.slYaw, Math.sin(this.sweepT * 0.11) * 1.1, 0.5, dt);
        this.slPitch = damp(this.slPitch, -0.06 + Math.sin(this.sweepT * 0.07) * 0.03, 0.5, dt);
      }
      this.sl.yaw.rotation.y = this.slYaw;
      this.sl.pitch.rotation.x = this.slPitch;
      const night = this.ctx.night?.() ?? 1;
      const on = this.slOn ? 1 : 0;
      // (on something near, the story's aim: dimmed by its distance, so a figure in the beam is a
      // figure and not a white blot)
      const near = this.slAim ? clamp((this.sl.lamp.getWorldPosition(_w).distanceTo(this.slAim) / 120) ** 2, 0.03, 1) : 1;
      if (this.sl.light) this.sl.light.intensity = 1.6e5 * on * near * (0.35 + 0.65 * night);
      if (this.sl.beam) this.sl.beam.material.uniforms.uIntensity.value = 0.16 * on * (0.15 + 0.85 * night);
    }
    void _q;
  }

  get searchlightWorld() {
    if (!this.sl.lamp) return null;
    return { pos: this.sl.lamp.getWorldPosition(new THREE.Vector3()), dir: new THREE.Vector3(0, 0, -1).applyQuaternion(this.sl.lamp.getWorldQuaternion(new THREE.Quaternion())) };
  }
}
