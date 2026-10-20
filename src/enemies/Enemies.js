import * as THREE from 'three';
import { tryGLB } from '../core/Assets.js';
import { CreatureNav, NOISE, clearLine } from './Perception.js';
import { Bear, prepBear } from './Bear.js';
import { Turned, prepPerson } from './Turned.js';
import { Shade } from './Shade.js';

// The creatures: the bears, the Turned, the Shades (DESIGN.md), every one in the tug's boat space
// under boat.root (at Station Severny the station's collision is part of the boat's, so its ground
// and its buildings are boat-space geometry too). This is the manager:
//
//   const enemies = new Enemies({ scene, boat, model, audio, stats, player, camera, lighting, quality });
//   await enemies.load();                                    the models and clips, once
//   const b = enemies.spawn('bear', pos, { home: { pos, radius: 30 }, carcass, blood: 0.6 });
//   enemies.spawn('turned_a', pos, { state: 'dormant', pose: 'sit', yaw, name: 'mess1' });
//   enemies.update(dt, ctx);                                 once a frame
//   enemies.noise(pos, radius, kind);                        a sound the creatures may hear (boat space)
//   enemies.shot(weaponId, worldPos);                        the same for a shot (world space, the radius by the gun)
//   enemies.raycast(origin, dir, range);                     for the weapons (world space): { target, point, distance, part, normal, surface } | null
//   enemies.groundChanged();                                 the collision changed (moored, cast off): the routes start again
//   enemies.debug(true);                                     the hit volumes and each one's state, drawn
//
// ctx = { flashlight: { on, origin, dir, range } (boat space), dark 0..1, indoor, visibility 0..1
//         (the blizzard), running, crouching, hidden (in a locker), wind (boat-space {x, z} the wind
//         blows toward), heatAt(pos) -> 0..1, flares: [{ pos (boat space), burning }],
//         footsteps (false: you call noise() for the steps yourself), onDoorBang(door, enemy),
//         onHit (as enemies.onHit) }
// Callbacks: onHit(enemy, kind, damage) (stats.damage is done here first), onDeath(enemy),
// onSeen(enemy) (its first sight of you), onAlert(enemy) (it turns on you).
//
// Cost: creatures beyond 60 m think four times a second; out of view or past 80 m they aren't
// drawn and their clips wait; shadows within 25 m; the bear's fur thins with distance; one route is
// worked out a frame at most (the others wait a frame or two).

const PEOPLE = ['turned_a', 'turned_b', 'turned_c', 'gromov', 'shade'];
const KINDS = ['bear', ...PEOPLE];
const NONE = [];
const _pm = new THREE.Matrix4(), _fr = new THREE.Frustum(), _sph = new THREE.Sphere();
const _w = new THREE.Vector3(), _v = new THREE.Vector3(), _e = new THREE.Vector3(), _shot = new THREE.Vector3(), _ray = new THREE.Ray();
const _q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);

export class Enemies {
  constructor({ scene, boat, model, audio = null, stats = null, player, camera, lighting = null, quality = null }) {
    Object.assign(this, { scene, boat, model, audio, stats, player, camera, lighting, quality });
    this.col = model.collision;
    this.list = [];
    this.inv = new THREE.Matrix4();             // world -> boat space, this frame
    this.navs = {};
    this.data = null;
    this.onHit = null; this.onDeath = null; this.onSeen = null; this.onAlert = null;
    this.t = 0; this.frame = 0; this.ctx = {};
    this.routesPerFrame = 1; this.routeBudget = 0;
    this.furShells = quality?.furShells ?? (quality?.name === 'low' ? 4 : 8);
    // the frame's picture of you, shared by every creature's senses
    this.sense = {
      feet: new THREE.Vector3(), eye: new THREE.Vector3(), look: new THREE.Vector3(0, 0, -1), vel: new THREE.Vector3(),
      flashOn: false, flashOrigin: new THREE.Vector3(), flashDir: new THREE.Vector3(0, 0, -1), flashRange: 25,
      dark: 0.8, indoor: false, visibility: 1, wind: null, warmth: 60, flares: NONE,
      moving: false, running: false, crouching: false, hidden: false, dead: false, collision: this.col,
    };
    this.lastFeet = null; this.stepDist = 0;
    this.chaseOn = false; this.chaseT = 0;
    this.debugOn = false; this.debugGroup = null;
  }

  async load(onProgress) {
    if (this.data) return this.data;
    let n = 0;
    const tick = (g) => { onProgress?.(++n / (KINDS.length + 1)); return g; };
    const path = (k) => (k === 'bear' ? 'models/bear.glb' : `models/people/${k}.glb`);
    const [anims, ...glbs] = await Promise.all([
      tryGLB('models/people/turned_anims.glb').then(tick),
      ...KINDS.map((k) => tryGLB(path(k)).then(tick)),
    ]);
    let refPelvis = null;
    anims?.scene.traverse((o) => { if (o.name === 'pelvis' && !refPelvis) refPelvis = o.position.clone(); });
    const data = {};
    KINDS.forEach((k, i) => {
      const g = glbs[i];
      if (!g) return;
      if (k === 'bear') data.bear = prepBear(g, this.lighting);
      else if (anims) data[k] = prepPerson(g, anims, refPelvis, this.lighting, k !== 'shade');
    });
    this.data = data;
    return data;
  }

  // the creatures' grids: one for the people's size, one for a bear's
  navFor(kind) {
    if (!this.navs[kind]) {
      this.navs[kind] = kind === 'bear'
        ? new CreatureNav(this.col, { cell: 0.4, radius: 0.42, height: 1.3, step: 0.36, nodes: 3000 })
        : new CreatureNav(this.col, { cell: 0.3, radius: 0.24, height: 1.6, step: 0.32, nodes: 3500 });
    }
    return this.navs[kind];
  }

  groundChanged() {
    for (const nav of Object.values(this.navs)) nav.reset();
    for (const c of this.list) { c.route = null; c.floorT = 0; }
  }

  // kind: 'bear' | 'turned_a' | 'turned_b' | 'turned_c' | 'gromov' | 'shade'; pos in boat space.
  // opts: name, yaw, state, home ({ pos, radius } or a point, with radius), and by kind:
  //   bear     carcass (a point to feed at), blood 0..1, aggression 0..1, health
  //   Turned   state 'dormant' with pose 'sit' | 'feed' | 'dead' (wake: false keeps a sitter
  //            staring once its head has turned), 'idle' | 'wander' | 'hunt' | 'investigate';
  //            points (a patrol), crawler, scale, revive: false, health
  //   shade    area ({ pos, radius }), delay, state 'drift'
  spawn(kind, pos, opts = {}) {
    const d = this.data?.[kind];
    if (!d) { console.warn('[Arkticheskiy] no model for', kind); return null; }
    const c = kind === 'bear' ? new Bear(this, d, opts) : kind === 'shade' ? new Shade(this, d, opts) : new Turned(this, kind, d, opts);
    this.boat.root.add(c.root);
    this.inv.copy(this.boat.root.matrixWorld).invert();
    c.place(pos);
    c.start();
    this.list.push(c);
    return c;
  }

  remove(c) {
    const i = this.list.indexOf(c);
    if (i < 0) return;
    this.list.splice(i, 1);
    if (c.dbg) { this.debugGroup?.remove(c.dbg.group); c.dbg = null; }
    c.dispose();
  }

  clear() {
    for (const c of [...this.list]) this.remove(c);
    if (this.chaseOn) { this.chaseOn = false; this.audio?.horror?.chase?.(false); }
  }

  byName(name) { return this.list.find((c) => c.name === name) || null; }

  // a sound in boat space; radius (m) by kind if not given ('pm' 'mosin' 'akm' 'flaregun' 'run'
  // 'walk' 'crouch' 'door' 'glass' 'shout'). Through walls it carries less.
  noise(pos, radius, kind = 'noise') {
    const R = radius ?? NOISE[kind] ?? 15;
    for (const c of this.list) {
      if (c.dead || c.kind === 'shade') continue;
      const d = c.pos.distanceTo(pos);
      if (d > R) continue;
      let loud = 1 - d / R;
      if (loud > 0.05 && d > 2 && !clearLine(this.col, c.eye(_e), _v.set(pos.x, pos.y + 0.4, pos.z))) loud *= 0.55;
      c.sense.hear(pos, loud, kind);
      c.hear(pos, loud, kind);
    }
  }

  // a shot from a world position (weapons.onShot gives the muzzle's)
  shot(weaponId, worldPos) { this.noise(this.boat.toLocal(worldPos, _shot), NOISE[weaponId] ?? 60, weaponId); }

  // the weapons' ray (world space) against the creatures' hit volumes; the Shades are never hit
  raycast(origin, dir, range = 200) {
    _ray.set(origin, dir);
    let best = null;
    for (const c of this.list) {
      if (!c.shootable || !c.volumes.length) continue;
      c.worldCenter(_w);
      if (_ray.distanceSqToPoint(_w) > (c.bound + 0.8) ** 2) continue;
      c.updateVolumes(this.frame);
      const h = c.rayHit(_ray, best ? best.distance : range);
      if (h) best = { target: c, point: _ray.at(h.t, new THREE.Vector3()), distance: h.t, part: h.part, normal: dir.clone().negate(), surface: 'flesh', object: null };
    }
    return best;
  }

  // ---- the frame
  update(dt, ctx = {}) {
    this.ctx = ctx;
    this.t += dt; this.frame++;
    this.routeBudget = this.routesPerFrame;
    this.inv.copy(this.boat.root.matrixWorld).invert();
    const s = this.picture(dt, ctx);
    if (this.list.length) {
      const cam = this.camera;
      _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
      const lh = Math.hypot(s.look.x, s.look.z) || 1;
      for (const c of this.list) {
        const dx = s.feet.x - c.pos.x, dz = s.feet.z - c.pos.z;
        c.dp = Math.hypot(dx, dz); c.dy = s.feet.y - (c.pos.y - c.hover);
        c.toYaw = Math.atan2(-dx, -dz);
        // how straight you're looking at it (1: dead on)
        c.faced = c.dp > 0.01 ? (-dx * s.look.x - dz * s.look.z) / (c.dp * lh) : 1;
        // far off: it thinks four times a second
        c.lodT += dt; c.mixDt += dt;
        const think = c.dp <= 60 || c.lodT >= 0.25;
        if (think) {
          c.update(c.lodT, s);
          c.lodT = 0;
          this.keepOff(c, s);
          if (!c.seen && c.kind === 'bear' && c.sense.sees && c.sense.awareness > 0.5) this.firstSight(c, false);
        }
        // drawn? (out of range, behind you, or not there: hidden, its clips left till it is)
        c.worldCenter(_w); _sph.set(_w, c.bound);
        const vis = c.shown && c.dp < 80 && (c.dp < 6 || _fr.intersectsSphere(_sph));
        c.setVisible(vis);
        if (vis && think && c.mixer) { c.mixer.update(c.mixDt); c.mixDt = 0; c.pose(dt, s); }
        c.setShadows(c.dp < 25);
        c.fur?.update(c.dp, dt);
      }
      this.separate();
    }
    this.music(dt);
    if (this.debugOn) this.drawDebug();
  }

  // what the creatures can know about you this frame
  picture(dt, ctx) {
    const s = this.sense, P = this.player;
    s.feet.copy(P.pos);
    if (P.eyeBoat && P.eyeBoat.lengthSq() > 0) s.eye.copy(P.eyeBoat); else s.eye.set(P.pos.x, P.pos.y + 1.66, P.pos.z);
    if (P.lookDir) P.lookDir(s.look); else s.look.set(0, 0, -1).applyAxisAngle(Y, P.yaw || 0);
    if (!this.lastFeet) this.lastFeet = s.feet.clone();
    if (dt > 0) s.vel.subVectors(s.feet, this.lastFeet).multiplyScalar(1 / dt); else s.vel.set(0, 0, 0);
    this.lastFeet.copy(s.feet);
    const hs = Math.hypot(s.vel.x, s.vel.z);
    if (hs > 30) s.vel.set(0, 0, 0);               // (a teleport, not a run)
    s.moving = hs > 0.3 && hs <= 30;
    s.running = ctx.running ?? (hs > 2.6 && hs <= 30);
    s.crouching = !!ctx.crouching; s.hidden = !!ctx.hidden;
    s.dead = !!this.stats?.dead;
    const fl = ctx.flashlight;
    s.flashOn = !!fl?.on && !s.hidden;
    s.flashRange = fl?.range ?? 25;
    s.flashOrigin.copy(fl?.origin ?? s.eye);
    s.flashDir.copy(fl?.dir ?? s.look).normalize();
    s.dark = ctx.dark ?? 0.8;
    s.indoor = ctx.indoor ?? !!P.zone;
    s.visibility = ctx.visibility ?? 1;
    s.wind = ctx.wind ?? null;
    s.warmth = this.stats?.warmth ?? 60;
    s.flares = ctx.flares ?? NONE;
    // your footsteps, unless you're telling them yourself
    if (ctx.footsteps !== false && !s.hidden && s.moving && P.onGround !== false) {
      this.stepDist += hs * dt;
      if (this.stepDist >= (s.running ? 1.1 : 0.8)) {
        this.stepDist = 0;
        const k = s.running ? 'run' : s.crouching ? 'crouch' : 'walk';
        this.noise(s.feet, NOISE[k], k);
      }
    }
    return s;
  }

  // ---- what the creatures ask of it
  routeFor(c, from, to) {
    // (far off: straight at it, routed once it's nearer; a long first search costs tens of ms)
    if (Math.hypot(to.x - from.x, to.z - from.z) > 40) return [to.clone()];
    if (this.routeBudget <= 0) return undefined;   // (none left this frame: ask again next frame)
    this.routeBudget--;
    if (c.nav.straight(from, to)) return [to.clone()];
    return c.nav.route(from, to);
  }

  heat(p) {
    let h = this.ctx.heatAt?.(p) ?? 0;
    for (const f of this.sense.flares) if (f.burning) { const d = f.pos.distanceTo(p); if (d < 2.5) h = Math.max(h, 1 - d / 2.5); }
    return h;
  }

  // too hot to step to (and hotter than where it stands: it may always walk out of the warm)
  hot(p, from) { const h = this.heat(p); return h > 0.5 && h > this.heat(from) + 0.02; }

  hurtPlayer(c, kind, dmg) {
    const source = c.kind === 'bear' ? 'bear' : c.kind === 'gromov' ? 'gromov' : c.kind === 'shade' ? 'shade' : 'turned';
    if (dmg > 0) this.stats?.damage?.(dmg, source);
    this.onHit?.(c, kind, dmg);
    if (this.ctx.onHit && this.ctx.onHit !== this.onHit) this.ctx.onHit(c, kind, dmg);
  }

  // a scream: the Turned within radius know where you are and come
  alert(from, radius = 25) {
    for (const c of this.list) {
      if (c === from || c.dead || !c.alarmed) continue;
      if (c.pos.distanceTo(from.pos) > radius) continue;
      c.alarmed(this.sense.feet, from);
    }
  }

  firstSight(c, sting = true) {
    if (c.seen) return;
    c.seen = true;
    if (sting) this.stinger('reveal');
    this.onSeen?.(c);
  }
  alerted(c) { if (!c.hostile) { c.hostile = true; this.onAlert?.(c); } }
  calmed(c) { c.hostile = false; }
  died(c) { this.onDeath?.(c); }
  doorBang(door, c) { this.ctx.onDoorBang?.(door, c); }
  stinger(name) { const h = this.audio?.horror; if (typeof h?.stinger === 'function') h.stinger(name); }

  // nobody stands in you (your capsule doesn't know about them)
  keepOff(c, s) {
    if (c.dead || c.kind === 'shade' || c.state === 'dormant') return;
    const dx = s.feet.x - c.pos.x, dz = s.feet.z - c.pos.z, d = Math.hypot(dx, dz);
    const min = c.kind === 'bear' ? 1.4 : c.cap.r + 0.3;
    if (d < min && d > 1e-3 && Math.abs(c.dy) < 1.5) { const k = (min - d) / d; c.pos.x -= dx * k; c.pos.z -= dz * k; }
  }

  // nor in each other
  separate() {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.dead || a.kind === 'shade' || a.state === 'dormant' || a.dp > 40) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.dead || b.kind === 'shade' || b.state === 'dormant' || b.dp > 40) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        const min = a.cap.r + b.cap.r + (a.kind === 'bear' || b.kind === 'bear' ? 0.8 : 0.05);
        if (d < min && d > 1e-4 && Math.abs(a.pos.y - b.pos.y) < 1.2) {
          const k = ((min - d) / d) * 0.5;
          a.pos.x -= dx * k; a.pos.z -= dz * k; b.pos.x += dx * k; b.pos.z += dz * k;
        }
      }
    }
  }

  // the chase drone while anything is after you (a little after the last one stops)
  music(dt) {
    const h = this.audio?.horror;
    const on = this.list.some((c) => c.chasing && !c.dead);
    if (on) {
      this.chaseT = 2.5;
      if (!this.chaseOn) { this.chaseOn = true; if (typeof h?.chase === 'function') h.chase(true); }
    } else if (this.chaseOn && (this.chaseT -= dt) <= 0) {
      this.chaseOn = false;
      if (typeof h?.chase === 'function') h.chase(false);
    }
  }

  // ---- debug: the hit volumes as wire capsules, and a label over each with its state
  debug(on = true) {
    this.debugOn = on;
    if (!this.debugGroup) { this.debugGroup = new THREE.Group(); this.debugGroup.name = 'enemies-debug'; this.scene.add(this.debugGroup); }
    this.debugGroup.visible = on;
  }

  drawDebug() {
    for (const c of this.list) {
      if (!c.dbg) c.dbg = this.makeDebug(c);
      const g = c.dbg;
      c.updateVolumes(this.frame);
      g.caps.forEach((m, i) => {
        const v = c.volumes[i];
        m.visible = c.shootable && !(c.dead && c.final);
        m.position.addVectors(v.p0, v.p1).multiplyScalar(0.5);
        _v.subVectors(v.p1, v.p0);
        const L = _v.length();
        m.quaternion.copy(L > 1e-4 ? _q.setFromUnitVectors(Y, _v.multiplyScalar(1 / L)) : _q.identity());
        m.scale.set(1, Math.max(0.01, L) / m.userData.len, 1);
      });
      const text = `${c.name}  ${c.state}${c.sub ? ':' + c.sub : ''}\na ${(c.sense?.awareness ?? 0).toFixed(2)}  hp ${Math.max(0, c.health) | 0}${c.sense?.sees ? '  SEES' : ''}${c.sense?.lit ? '  LIT' : ''}`;
      if (text !== g.text) { g.text = text; this.paint(g, text); }
      c.worldCenter(g.label.position); g.label.position.y += c.bound + 0.6;
    }
  }

  makeDebug(c) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3355, wireframe: true, depthTest: false, transparent: true, opacity: 0.6 });
    const head = mat.clone(); head.color.set(0xffdd33);
    const caps = c.volumes.map((v) => {
      c.updateVolumes(this.frame);
      const len = Math.max(0.01, v.p0.distanceTo(v.p1));
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(v.r, len, 3, 8), v.part === 'head' ? head : mat);
      m.userData.len = len; m.renderOrder = 999;
      group.add(m);
      return m;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 96;
    const tex = new THREE.CanvasTexture(canvas);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    label.scale.set(2.4, 0.45, 1); label.renderOrder = 1000;
    group.add(label);
    this.debugGroup.add(group);
    return { group, caps, label, canvas, tex, text: '' };
  }

  paint(g, text) {
    const x = g.canvas.getContext('2d');
    x.clearRect(0, 0, 512, 96);
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, 0, 512, 96);
    x.fillStyle = '#ffe9a8'; x.font = '26px monospace';
    text.split('\n').forEach((l, i) => x.fillText(l, 10, 36 + i * 34));
    g.tex.needsUpdate = true;
  }
}
