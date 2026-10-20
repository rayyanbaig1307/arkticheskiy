import * as THREE from 'three';
import { atmos } from '../world/Atmos.js';
import { WEAPONS, ORDER, THROW_ACTION, ANCHORS, PROPS } from './defs.js';
import { compile, sample, Pose, CH, NCH } from './Actions.js';
import { Viewmodel } from './Viewmodel.js';
import { Effects } from './Effects.js';
import { Flares } from './Flares.js';
import { spreadDir, spreadFor, damageAt, makeRaycastShot } from './Ballistics.js';

// The weapons: the Makarov PM, the Mosin-Nagant M44, the AKM, the SPSh-44 flare pistol, and hand
// flares. This is the manager: which gun is in your hands (only those the inventory holds), drawing
// and holstering, the trigger, the sights, reloading, the ammunition in each gun and in your
// pockets, and what each shot does to the world and to your view.
//
//   weapons = new Weapons({ camera, scene, input, inventory, audio, player, raycastShot, post,
//                           hud, stats, lighting })
//   weapons.update(dt)            every frame, after the player (the camera is placed), before post
//   weapons.enabled = false       a menu, the journal, a station or a hiding place has control
//   weapons.give(id, { mag, chamber, select })
//   weapons.current               'pm' | 'mosin' | 'akm' | 'flaregun' | null
//   weapons.onShot = (kind, origin, dir) => {}          the enemies hear it
//   weapons.onFlare = (position, burning, flare) => {}  a flare lit, landed, out
//   weapons.flares                the flares burning now ({ world, burning, kind })
//
// Keys (CONTRACTS.md): left mouse fire, right mouse aim, R reload, 1-4 and the wheel to choose, Q
// holster (again: draw the last), G a hand flare; B the AKM's selector (semi / auto).
//
// Each gun's state is real: what is in its magazine, whether one is chambered, whether a slide is
// locked back or a bolt left open, whether a spent case still sits in the chamber. Reloads are
// keyed sequences (defs.js) whose events move the rounds (a magazine out gives its rounds back to
// the pockets; the new one takes what the pockets have), so switching weapons halfway through a
// reload leaves the gun exactly as far along as it got.

const _o = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0);
const AN = { gripR: ANCHORS.id('gripR'), gripL: ANCHORS.id('gripL'), restR: ANCHORS.id('restR'), restL: ANCHORS.id('restL'), idleR: ANCHORS.id('idleR'), idleL: ANCHORS.id('idleL') };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, v) => smooth(clamp((v - a) / (b - a), 0, 1));
const FADE = 0.2;
const KEYS = Object.fromEntries(ORDER.map((id) => [id, ['Digit' + WEAPONS[id].slot, 'Numpad' + WEAPONS[id].slot]]));

export class Weapons {
  constructor({ camera, scene, input, inventory = null, audio = null, player = null, raycastShot = null, post = null,
    hud = null, stats = null, lighting = null, frame, flareLights = 2 }) {
    Object.assign(this, { camera, scene, input, audio, player, post, hud, stats, lighting });
    this.inventory = inventory || { ammo: { '9x18': 0, '7.62x54R': 0, '7.62x39': 0, flare: 0 }, weapons: new Set(), items: new Map() };
    this.raycastShot = raycastShot || makeRaycastShot([]);
    this.enabled = true;
    this.onShot = null;
    this.onFlare = null;

    this.fx = new Effects({ scene, lighting, frame: frame !== undefined ? frame : player?.boat?.root || null, flareLights });
    this.flareSys = new Flares({ fx: this.fx, lighting });
    this.flareSys.raycast = (o, d, r) => this.raycastShot(o, d, r);
    this.flareSys.useFloor = !raycastShot;
    this.flareSys.onFlare = (p, burning, f) => this.onFlare?.(p, burning, f);
    this.flareSys.onHit = (hit) => this.sfx('hit_flesh', hit.point, 0.8);
    this.flareSys.onLoop = (obj, on) => { const h = this.audio?.horror; if (typeof h?.loop === 'function') h.loop('fire', obj, on); };
    this.fx.onLand = (kind, p, bounce) => this.caseLanded(kind, p, bounce);
    this.vm = new Viewmodel({ camera, scene, post, lighting });

    // every action compiled once
    this.acts = {};
    for (const id of ORDER) {
      this.acts[id] = {};
      for (const [name, table] of Object.entries(WEAPONS[id].actions)) this.acts[id][name] = compile(name, table, ANCHORS, PROPS);
    }
    this.throwAct = compile('throw', THROW_ACTION, ANCHORS, PROPS);

    this.st = {};                     // each gun's state
    this.cur = null; this.want = null; this.last = null;
    this.phase = 'none';              // 'none' | 'draw' | 'ready' | 'holster'
    this.up = 0;                      // drawn: 0 down .. 1 up
    this.act = null; this.actT = 0;
    this.from = new Float32Array(NCH); this.fromHand = new Int16Array(NCH);
    this.pose = new Pose();
    this.heldV = new Float32Array(NCH); this.heldW = 0;
    this.ctx = { st: null, def: null, stop: false, reserve: () => this.reserve(this.ctx.def.ammo) };
    this.aim = 0; this.sprintT = 0; this.lowerT = 0;
    this.cool = 0; this.fireBuf = 0; this.trigger = false;
    this.burst = 0; this.burstT = 1; this.bloom = 0; this.heat = 0; this.wispT = 0;
    this.pendingCycle = -1; this.cycleT = 1;
    this.proc = { cycle: 0, hammer: 1, trig: 0, sel: 0 };
    this.flareHeld = null;
    this.surface = 'metal'; this.surfaceT = 0;
    this.spreadCtx = { aim: 0, moving: false, running: false, airborne: false, crouched: false, cold: 0, bloom: 0 };
    this.vs = { gun: null, st: null, pose: this.pose, aim: 0, up: 0, sprint: 0, bob: 0, bobAmp: 0, running: false, dyaw: 0, dpitch: 0,
      breath: 0, cold: 0, armR: false, armL: false, restR: AN.gripR, restL: AN.gripL, proc: this.proc };
    this.hudLast = { id: undefined, inGun: -1, reserve: -1 };
    this.baseFov = camera.fov; this.fovSet = camera.fov;
    this.lastYaw = player?.yaw ?? 0; this.lastPitch = player?.pitch ?? 0;
    this.noState = { mag: 0, magIn: true, chamber: 0, locked: false, boltOpen: false, open: false, auto: false };

    // the right mouse button (Input tracks only the left)
    this.rmb = false;
    if (typeof window !== 'undefined') {
      this.listeners = [
        ['mousedown', (e) => { if (e.button === 2) this.rmb = true; }],
        ['mouseup', (e) => { if (e.button === 2) this.rmb = false; }],
        ['contextmenu', (e) => { if (this.input?.locked) e.preventDefault(); }],
        ['blur', () => { this.rmb = false; }],
      ];
      for (const [k, fn] of this.listeners) window.addEventListener(k, fn);
      this.lockFn = () => { if (!document.pointerLockElement) this.rmb = false; };
      document.addEventListener('pointerlockchange', this.lockFn);
    }
  }

  dispose() {
    if (this.listeners) for (const [k, fn] of this.listeners) window.removeEventListener(k, fn);
    if (this.lockFn) document.removeEventListener('pointerlockchange', this.lockFn);
  }

  // weapons.glb / arms.glb in place of the stand-ins, when they exist
  async load(weaponsPath = 'models/weapons.glb', armsPath = 'models/arms.glb') {
    const { tryGLB } = await import('../core/Assets.js');
    const [w, a] = await Promise.all([tryGLB(weaponsPath), tryGLB(armsPath)]);
    const pick = (gltf, name) => gltf?.scene.getObjectByName(name) || null;
    const weapons = {};
    for (const id of [...ORDER, 'handflare']) { const o = pick(w, 'WPN_' + id); if (o) weapons[id] = o; }
    const arms = { R: pick(a, 'ARM_R'), L: pick(a, 'ARM_L'), Lopen: pick(a, 'ARM_L_open') };
    if (!Object.keys(weapons).length && !arms.R && !arms.L) return false;
    this.stopAction(false);
    this.vm.useModels({ weapons, arms: { R: arms.R || undefined, L: arms.L || undefined, Lopen: arms.Lopen || undefined }, props: {} });
    return true;
  }

  get current() { return this.cur; }
  get aiming() { return this.aim > 0.5; }
  get busy() { return !!this.act; }
  get flares() { return this.flareSys.active; }

  // ---- the inventory (CONTRACTS.md), guarded: it may be partly written yet
  reserve(type) { return this.inventory.ammo?.[type] | 0; }
  take(type, n) {
    if (n <= 0) return 0;
    const inv = this.inventory, have = this.reserve(type);
    const r = typeof inv.takeAmmo === 'function' ? inv.takeAmmo(type, n) : undefined;
    if (typeof r === 'number') return r;
    const t = Math.min(n, have);
    if (inv.ammo) inv.ammo[type] = have - t;
    return t;
  }
  put(type, n) {
    if (n <= 0) return;
    const inv = this.inventory;
    if (typeof inv.addAmmo === 'function') inv.addAmmo(type, n);
    else if (inv.ammo) inv.ammo[type] = this.reserve(type) + n;
  }
  owned(id) {
    const inv = this.inventory;
    return typeof inv.hasWeapon === 'function' ? !!inv.hasWeapon(id) : !!inv.weapons?.has?.(id);
  }
  handFlares() {
    const inv = this.inventory;
    return typeof inv.count === 'function' ? inv.count('flare') | 0 : inv.items?.get?.('flare') | 0;
  }
  useHandFlare() {
    const inv = this.inventory;
    if (this.handFlares() <= 0) return false;
    if (typeof inv.remove === 'function') inv.remove('flare', 1);
    else inv.items?.set?.('flare', (inv.items.get('flare') | 0) - 1);
    return true;
  }

  // a gun as it comes to you: a full magazine with one chambered from it (a Mosin: 4 and 1)
  fresh(id, mag, chamber) {
    const d = WEAPONS[id];
    const st = { mag: 0, magIn: true, chamber: 0, locked: false, boltOpen: false, open: false, auto: false };
    if (id === 'flaregun') st.chamber = chamber ?? 1;
    else {
      st.chamber = chamber ?? 1;
      st.mag = clamp(mag ?? d.cap - st.chamber, 0, d.cap);
    }
    return st;
  }

  give(id, { mag, chamber, select } = {}) {
    if (!WEAPONS[id]) return;
    const inv = this.inventory;
    if (typeof inv.giveWeapon === 'function') inv.giveWeapon(id); else inv.weapons?.add?.(id);
    if (!this.st[id] || mag !== undefined || chamber !== undefined) this.st[id] = this.fresh(id, mag, chamber);
    if (select ?? !this.want) this.select(id);
  }

  select(id) { this.request(id); }
  holster() { this.request(null); }

  // for checkpoints: what each gun holds and which is in hand
  state() {
    return { current: this.want, guns: JSON.parse(JSON.stringify(this.st)) };
  }
  restore(s) {
    this.stopAction(false);
    this.st = {};
    for (const [id, g] of Object.entries(s?.guns || {})) if (WEAPONS[id]) this.st[id] = { ...this.fresh(id), ...g };
    this.cur = null; this.up = 0; this.phase = 'none'; this.aim = 0;
    this.want = s?.current && this.st[s.current] ? s.current : null;
  }

  request(id) {
    if (id && (!WEAPONS[id] || !this.owned(id))) return;
    if (id && !this.st[id]) this.st[id] = this.fresh(id);
    this.want = id;
  }

  syncOwned() {
    for (const id of ORDER) if (!this.st[id] && this.owned(id)) this.st[id] = this.fresh(id);
    if (this.want && !this.owned(this.want)) this.want = null;
  }

  // ---- input
  readInput() {
    const I = this.input;
    if (!I) return;
    for (const id of ORDER) if (I.hit(KEYS[id][0]) || I.hit(KEYS[id][1])) this.request(id);
    if (I.wheel) this.cycle(I.wheel > 0 ? 1 : -1);
    if (I.hit('KeyQ')) this.request(this.want ? null : this.last && this.owned(this.last) ? this.last : this.nextOwned(null, 1));
    if (I.hit('KeyR')) this.reload();
    if (I.hit('KeyG')) this.throwFlare();
    if (I.hit('KeyB')) this.toggleSelector();
    if (I.mouseClicked) this.fireBuf = 0.18;
    this.trigger = !!I.mouseDown;
  }

  nextOwned(from, dir) {
    const n = ORDER.length;
    let i = from ? ORDER.indexOf(from) : dir > 0 ? -1 : n;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (this.owned(ORDER[i])) return ORDER[i];
    }
    return null;
  }
  cycle(dir) { const id = this.nextOwned(this.want, dir); if (id) this.request(id); }

  // ---- drawing and holstering
  switching(dt) {
    const def = this.cur ? WEAPONS[this.cur] : null;
    if (this.want !== this.cur) {
      if (this.act?.lock) return;                    // (a flare is being thrown: finish first)
      if (this.act) this.stopAction(true);
      if (def && this.up > 0) {
        if (this.phase !== 'holster') { this.phase = 'holster'; this.sfx('weapon_holster'); }
        this.up = Math.max(0, this.up - dt / def.holster);
      }
      if (!def || this.up <= 0) {
        if (this.cur) this.last = this.cur;
        this.cur = this.want;
        this.up = 0;
        this.phase = this.cur ? 'draw' : 'none';
        this.aim = 0;
        if (this.cur) this.sfx('weapon_draw');
      }
    } else if (def) {
      if (this.phase === 'holster') this.phase = 'draw';
      if (this.phase === 'draw') {
        this.up = Math.min(1, this.up + dt / def.draw);
        if (this.up >= 1) this.phase = 'ready';
      }
    }
  }

  // ---- actions (reloads, the bolt, the flare throw)
  startAction(name, act = this.cur ? this.acts[this.cur][name] : null) {
    if (!act) return false;
    if (this.act) this.carry(); else this.restPose(this.from, this.fromHand);
    if (this.heldW > 0) this.from.set(this.pose.v);
    this.act = act; this.actT = 0;
    return true;
  }

  // the next action starts where this one is now
  carry() {
    const P = this.pose;
    this.from.set(P.v);
    for (let c = 0; c < NCH; c++) this.fromHand[c] = P.w[c] >= 0.5 ? P.b[c] : P.a[c];
  }

  stopAction(fade = true) {
    if (!this.act) return;
    if (this.act === this.throwAct && this.flareHeld) this.letGo(0.4);
    this.act = null;
    if (fade) { this.heldV.set(this.pose.v); this.heldW = 1; this.vm.freeze(); }
  }

  advance(dt) {
    const a = this.act;
    if (!a) return;
    const t0 = this.actT, t1 = (this.actT += dt);
    for (const e of a.ev) {
      if (e.t > t0 && e.t <= t1) this.event(e.name);
      if (this.act !== a) return;
    }
    if (t1 < a.dur) return;
    sample(a, a.dur, this.from, this.fromHand, this.pose);
    const def = this.cur ? WEAPONS[this.cur] : null;
    const c = this.ctx;
    c.st = this.cur ? this.st[this.cur] : this.noState; c.def = def || WEAPONS.pm;
    const next = a.next && def ? a.next(c) : null;
    const na = next ? this.acts[this.cur][next] : null;
    if (na) { this.carry(); this.act = na; this.actT = 0; }
    else { this.act = null; this.heldV.set(this.pose.v); this.heldW = 1; this.vm.freeze(); }
  }

  // the pose with no action: the parts where the gun's state leaves them, the hands on the gun
  restPose(v, hands) {
    v.fill(0);
    const id = this.cur, st = id ? this.st[id] : null;
    if (st) {
      if (id === 'pm' && st.locked) v[CH.slide] = 1;
      if (id === 'mosin' && st.boltOpen) { v[CH.lift] = 1; v[CH.pull] = 1; }
      if (id === 'flaregun' && st.open) v[CH.brk] = 1;
      if ((id === 'pm' || id === 'akm') && !st.magIn) v[CH.mag] = 2;
    }
    hands.fill(0);
    hands[CH.rh] = AN.restR; hands[CH.lh] = AN.restL;
  }

  event(name) {
    const id = this.cur, def = id ? WEAPONS[id] : null, st = id ? this.st[id] : null;
    switch (name) {
      case 'magOut': this.sfx(id + '_mag_out'); this.put(def.ammo, st.mag); st.mag = 0; st.magIn = false; break;
      case 'magIn': this.sfx(id + '_mag_in'); st.mag = this.take(def.ammo, def.cap); st.magIn = true; break;
      case 'slideRel': this.sfx('pm_slide'); if (st.mag > 0) { st.mag--; st.chamber = 1; } st.locked = false; break;
      case 'rack':
        this.sfx('pm_slide'); this.chamberFromMag(st);
        st.locked = st.magIn && st.mag === 0 && st.chamber === 0;
        break;
      case 'charge': this.sfx('akm_charge'); this.chamberFromMag(st); break;
      case 'selector': st.auto = !st.auto; this.sfx('dry_fire', null, 0.3); break;
      case 'boltUp': this.sfx('mosin_bolt_open'); break;
      case 'boltBack':
        if (st.chamber === -1) this.ejectCase(def); else if (st.chamber === 1) this.put(def.ammo, 1);
        st.chamber = 0; st.boltOpen = true;
        break;
      case 'boltClose': this.sfx('mosin_bolt_close'); break;
      case 'boltFwd': if (st.mag > 0) { st.mag--; st.chamber = 1; } st.boltOpen = false; break;
      case 'clipShow': this.vm.clipFull = true; break;
      case 'clipPush': this.sfx('mosin_clip'); break;
      case 'clip': st.mag += this.take(def.ammo, def.cap - st.mag); this.vm.clipFull = false; break;
      case 'round': { const n = this.take(def.ammo, 1); st.mag += n; this.sfx('mosin_round'); if (!n) this.ctx.stop = true; break; }
      case 'openSnd': this.sfx('flare_open'); break;
      case 'opened': st.open = true; break;
      case 'eject':
        if (st.chamber === -1) this.ejectCase(def); else if (st.chamber === 1) this.put(def.ammo, 1);
        st.chamber = 0;
        break;
      case 'load': if (this.take(def.ammo, 1)) st.chamber = 1; this.sfx('flare_load'); break;
      case 'close': this.sfx('flare_close'); st.open = false; break;
      case 'flareShow': this.vm.lit = false; break;
      case 'flareIgnite':
        if (!this.useHandFlare()) { this.stopAction(true); break; }
        this.vm.lit = true;
        this.sfx('flare_ignite', null, 1);
        this.flareHeld = this.flareSys.hold();
        break;
      case 'flareRelease': this.letGo(1); break;
    }
  }

  // racking: a round in the chamber is thrown out (into your hand: back to the pockets), the next
  // comes up from the magazine
  chamberFromMag(st) {
    if (st.chamber === 1) this.put(WEAPONS[this.cur].ammo, 1);
    st.chamber = 0;
    if (st.magIn && st.mag > 0) { st.mag--; st.chamber = 1; }
  }

  // the hand flare leaves the hand: thrown (k 1) or dropped (k small)
  letGo(k) {
    const f = this.flareHeld;
    if (!f) return;
    this.flareHeld = null;
    this.vm.lit = false;
    const tip = this.vm.flareTipWorld(_p);
    _f.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _v.copy(_f).multiplyScalar(11 * k).addScaledVector(UP, 3.2 * k);
    if (this.player?.vel) _v.add(_w.copy(this.player.vel).applyQuaternion(this.fx.frameQ));
    const fp = this.vm.props[PROPS.id('flare')];
    if (fp) _q.setFromRotationMatrix(fp.root.matrixWorld); else _q.copy(this.camera.quaternion);
    this.flareSys.release(f, tip, _v, _q);
  }

  reload() {
    if (!this.cur || this.phase !== 'ready' || this.act) return;
    const def = WEAPONS[this.cur], st = this.st[this.cur];
    if (!this.canReload(def, st)) return;
    this.ctx.stop = false;
    let start = def.start;
    if ((def.id === 'mosin' && st.boltOpen) || (def.id === 'flaregun' && st.open)) start = 'reach';
    this.startAction(start);
  }

  canReload(def, st) {
    const r = this.reserve(def.ammo);
    switch (def.id) {
      case 'pm': case 'akm': return !st.magIn || (r > 0 && st.mag < def.cap) || (st.chamber === 0 && st.mag > 0);
      case 'mosin': return st.boltOpen || st.chamber === -1 || (r > 0 && st.mag + (st.chamber === 1 ? 1 : 0) < def.cap);
      case 'flaregun': return st.open || st.chamber === -1 || (st.chamber === 0 && r > 0);
    }
    return false;
  }

  throwFlare() {
    if (this.act || this.handFlares() <= 0) return;
    if (this.cur ? this.phase !== 'ready' : this.want) return;
    this.startAction('throw', this.throwAct);
  }

  toggleSelector() {
    if (this.cur === 'akm' && this.phase === 'ready' && !this.act) this.startAction('selector');
  }

  // ---- the trigger
  fireStep(dt) {
    this.cool -= dt; this.fireBuf -= dt; this.burstT += dt;
    if (this.burstT > 0.3) this.burst = 0;
    this.bloom = Math.max(0, this.bloom - dt * 0.08);
    this.heat = Math.max(0, this.heat - dt * 0.6);
    this.cycleT += dt;
    if (this.pendingCycle >= 0 && (this.pendingCycle -= dt) < 0) {
      this.pendingCycle = -1;
      if (this.cur === 'mosin' && !this.act && this.phase === 'ready') this.startAction('cycle');
    }
    if (!this.enabled || !this.cur) return;
    const def = WEAPONS[this.cur], st = this.st[this.cur];
    const auto = def.auto && st.auto && this.trigger;
    if (this.fireBuf > 0 || auto) {
      if (this.tryFire(def, st, auto && this.fireBuf <= 0)) this.fireBuf = 0;
    }
  }

  tryFire(def, st, held) {
    if (this.phase !== 'ready' || this.lowerT > 0.05) return false;
    if (this.act) {
      if (this.act.name === 'round') { this.ctx.stop = true; return true; }     // (stop loading, close up)
      return false;
    }
    if (this.sprintT > 0.3 || this.cool > 0) return false;
    switch (def.id) {
      case 'pm': case 'akm':
        if (st.chamber === 1) return this.shoot(def, st);
        if (held) return false;
        if (st.magIn && st.mag > 0 && !st.locked) return this.startAction(def.id === 'pm' ? 'rack' : 'charge');
        return this.dry(st);
      case 'mosin':
        if (st.boltOpen) return this.startAction('close');
        if (st.chamber === 1) return this.shoot(def, st);
        if (st.chamber === -1 || st.mag > 0) return this.startAction('cycle');
        return this.dry(st);
      case 'flaregun':
        if (st.open) return this.startAction('close');
        if (st.chamber === 1) return this.shoot(def, st);
        return this.dry(st);
    }
    return false;
  }

  dry(st) {
    this.sfx('dry_fire', null, st.locked ? 0.25 : 0.8);
    this.proc.trig = 1;
    this.cool = 0.3;
    return true;
  }

  shoot(def, st) {
    const id = def.id, cam = this.camera;
    // the round
    if (id === 'pm' || id === 'akm') {
      st.chamber = 0;
      if (st.magIn && st.mag > 0) { st.mag--; st.chamber = 1; } else if (id === 'pm' && st.magIn) st.locked = true;
      this.cycleT = 0;
      this.ejectCase(def);
    } else st.chamber = -1;
    if (id === 'mosin') this.pendingCycle = 0.16;
    // where it goes: the line of sight (aimed: the gun's own sight line), spread
    const origin = _o.setFromMatrixPosition(cam.matrixWorld);
    const fwd = _f.set(0, 0, -1).transformDirection(cam.matrixWorld);
    const aimE = smooth(this.aim);
    if (aimE > 0) fwd.lerp(_g.set(0, 0, -1).transformDirection(this.vm.holder.matrixWorld), aimE).normalize();
    const sc = this.spreadCtx;
    sc.aim = aimE; sc.bloom = id === 'akm' ? this.bloom : 0;
    const dir = spreadDir(fwd, spreadFor(def, sc), _d);
    const muzzle = this.vm.muzzleWorld(_p);
    if (id === 'flaregun') this.launchFlare(def, origin, dir, muzzle);
    else {
      const hit = this.raycastShot(origin, dir, def.range);
      if (hit) {
        this.fx.impact(hit, dir);
        if (hit.surface) this.sfx('hit_' + hit.surface, hit.point, 0.8);
        if (hit.target && typeof hit.target.damage === 'function') hit.target.damage(damageAt(def, hit.distance), hit.point.clone(), dir.clone(), id);
      }
    }
    // the flash, the smoke, the noise
    this.vm.showFlash(def);
    this.fx.pool.muzzle(muzzle, def.flash.color, def.flash.light);
    this.fx.muzzle(muzzle, dir, def);
    const h = this.audio?.horror;
    if (typeof h?.gun === 'function') h.gun(id, muzzle.clone(), { indoor: !!this.player?.zone || atmos.uIndoor.value > 0.5 });
    // the kick: the view (a part of it stays: you pull it down) and the gun in your hands
    const r = def.recoil;
    let pitch = r.pitch, keep = r.keep, yaw = (Math.random() * 2 - 1) * r.yaw;
    if (id === 'akm') {
      pitch += Math.min(this.burst, 10) * r.climb;
      yaw += Math.sin(this.burst * 0.9) * r.yaw * 0.5;
      if (st.auto && this.burst > 0) keep = r.keepAuto;
    }
    const steady = (1 - 0.3 * aimE) * (this.spreadCtx.crouched ? 0.85 : 1);
    this.player?.recoil?.(pitch * steady, yaw * steady, keep);
    this.vm.kick(r, aimE > 0.5 ? 0.6 : 1);
    this.proc.hammer = 0; this.proc.trig = 1;
    this.onShot?.(id, origin.clone(), dir.clone());
    this.cool = def.rate;
    this.burst++; this.burstT = 0;
    if (def.bloom) this.bloom = Math.min(def.bloomMax, this.bloom + def.bloom);
    this.heat += id === 'mosin' ? 2 : 1;
    return true;
  }

  launchFlare(def, origin, dir, muzzle) {
    // (from the muzzle, unless a wall stands between your eye and it)
    const start = _g.copy(muzzle);
    const to = _w.copy(muzzle).sub(origin), len = to.length();
    if (len > 1e-4) {
      const block = this.raycastShot(origin, to.multiplyScalar(1 / len), len);
      if (block) start.copy(block.point).addScaledVector(to, -0.05);
    }
    _v.copy(dir).multiplyScalar(def.speed);
    if (this.player?.vel) _v.add(_w.copy(this.player.vel).applyQuaternion(this.fx.frameQ));
    this.flareSys.launch(start, _v, def.damage);
  }

  // a spent case out of the port: thrown off to the side (each gun its own way), spinning
  ejectCase(def) {
    const pos = this.vm.ejectWorld(_g);
    const q = this.vm.gunQuatWorld(_q);
    const e = def.eject;
    _v.set(e[0] * (0.85 + Math.random() * 0.3), e[1] * (0.85 + Math.random() * 0.3), e[2] + (Math.random() - 0.5) * 0.4).applyQuaternion(q);
    if (this.player?.vel) _v.add(_w.copy(this.player.vel).applyQuaternion(this.fx.frameQ));
    this.fx.eject(def.brass, pos, _v, q);
  }

  // a case hits the floor: what the floor is (once a second is plenty), and the ring of it
  caseLanded(kind, p, bounce) {
    if (bounce === 0 && this.surfaceT <= 0) {
      this.surfaceT = 1;
      const hit = this.raycastShot(_w.copy(p).addScaledVector(UP, 0.3), DOWN, 0.6);
      this.surface = hit?.surface || 'metal';
    }
    const soft = this.surface === 'snow';
    this.sfx(soft ? 'shell_brass_snow' : 'shell_brass', p, (bounce === 0 ? 0.7 : 0.35 / bounce) * (kind === 'flare' ? 1.2 : 1));
    return soft;
  }

  // (positions are copied: ours are scratch vectors, reused at once)
  sfx(name, pos = null, gain) {
    const h = this.audio?.horror;
    if (typeof h?.sfx === 'function') h.sfx(name, pos ? pos.clone() : null, gain === undefined ? undefined : { gain });
  }

  // ---- the frame
  update(dt) {
    dt = Math.min(dt, 0.1);
    const fx = this.fx, P = this.player, S = this.stats;
    fx.begin();
    this.surfaceT -= dt;
    this.syncOwned();
    if (this.enabled) this.readInput(); else { this.fireBuf = 0; this.trigger = false; }
    this.switching(dt);
    this.advance(dt);
    this.fireStep(dt);

    // aim, sprint, lowered when something else has control
    const def = this.cur ? WEAPONS[this.cur] : null, st = this.cur ? this.st[this.cur] : this.noState;
    const running = P ? !!P.running : false;
    this.sprintT = clamp(this.sprintT + (running && !this.act && this.aim < 0.2 ? dt : -dt) * 5, 0, 1);
    this.lowerT = clamp(this.lowerT + (this.enabled ? -dt : dt) * 4, 0, 1);
    const canAim = this.enabled && def && this.phase === 'ready' && this.rmb && this.sprintT < 0.5 && this.lowerT < 0.5 && (!this.act || this.act.aimMax > 0);
    const target = canAim ? (this.act ? this.act.aimMax : 1) : 0;
    const rate = (def ? def.aimRate : 6) * (target < this.aim ? 1.3 : 1);
    this.aim = clamp(this.aim + clamp(target - this.aim, -dt * rate, dt * rate), 0, 1);
    const aimE = smooth(this.aim);

    // the field of view narrows on the sights (someone else may set the base: the settings)
    const cam = this.camera;
    if (Math.abs(cam.fov - this.fovSet) > 1e-3) this.baseFov = cam.fov;
    const fov = this.baseFov * (1 - (1 - (def ? def.zoom : 1)) * aimE);
    if (Math.abs(fov - cam.fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.fovSet = cam.fov;

    // how you stand: the spread and the hands' unsteadiness
    const warmth = S?.warmth ?? 100;
    const cold = smoothstep(35, 5, warmth);
    const sc = this.spreadCtx;
    sc.moving = !!P?.moving; sc.running = running; sc.airborne = P ? P.onGround === false : false;
    sc.crouched = !!(P?.crouched ?? P?.crouching); sc.cold = cold;

    // the procedural parts: the slide or carrier running back after a shot, hammer, trigger, selector
    const pr = this.proc, ct = this.cycleT;
    pr.cycle = ct < 0.025 ? ct / 0.025 : Math.max(0, 1 - (ct - 0.025) / 0.045);
    pr.hammer = damp(pr.hammer, this.cur === 'flaregun' ? (st.chamber === 1 ? 1 : 0) : 1, 40, dt);
    pr.trig = damp(pr.trig, this.trigger && this.phase === 'ready' ? 0.5 : 0, 30, dt);
    if (def?.selector) pr.sel = damp(pr.sel, st.auto ? def.selector.auto : def.selector.semi, 25, dt);

    // the pose of the hands and parts this frame
    if (this.act) sample(this.act, Math.min(this.actT, this.act.dur), this.from, this.fromHand, this.pose);
    else {
      this.restPose(this.pose.v, this.pose.a);
      this.pose.b.set(this.pose.a); this.pose.w.fill(1);
    }
    if (this.heldW > 0) {
      this.heldW = Math.max(0, this.heldW - dt / FADE);
      const k = smooth(this.heldW), v = this.pose.v;
      for (let c = 0; c < NCH; c++) if (c !== CH.prop) v[c] += (this.heldV[c] - v[c]) * k;
    }

    const vs = this.vs;
    vs.gun = this.cur; vs.st = st; vs.aim = aimE; vs.up = this.up * (1 - smooth(this.lowerT)); vs.sprint = this.sprintT;
    vs.bob = P?.bob ?? 0; vs.bobAmp = P?.bobAmp ?? 0; vs.running = running;
    const yaw = P?.yaw ?? 0, pitch = P?.pitch ?? 0;
    vs.dyaw = yaw - this.lastYaw; vs.dpitch = pitch - this.lastPitch;
    this.lastYaw = yaw; this.lastPitch = pitch;
    vs.breath = clamp(Math.max(S?.fear ?? 0, 1 - (S?.stamina ?? 100) / 100), 0, 1);
    vs.cold = cold;
    vs.armR = !!this.cur && this.up > 0;
    vs.armL = vs.armR || this.act === this.throwAct;
    vs.restR = this.cur ? AN.gripR : AN.idleR; vs.restL = this.cur && !WEAPONS[this.cur]?.oneHand ? AN.gripL : AN.idleL;
    vs.climb = P?.climb ? P.climb.ph : null;
    this.vm.update(dt, vs);
    if (this.flareHeld) this.flareSys.setHeld(this.flareHeld, this.vm.flareTipWorld(_p));

    // a hot barrel smokes
    if (this.cur && this.heat > 3 && (this.wispT -= dt) <= 0) {
      this.wispT = 0.25 / Math.min(4, this.heat - 2);
      this.fx.wisp(this.vm.muzzleWorld(_p));
    }

    // the floor the cases (and, with no world to hit, the flares) land on, in the frame's space
    const frame = fx.frame;
    fx.floorF = P && frame && frame === P.boat?.root ? P.pos.y : _p.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(fx.frameInv).y - 1.62;
    this.flareSys.floorY = fx.floorF;
    fx.update(dt);
    this.flareSys.update(dt, _o.setFromMatrixPosition(cam.matrixWorld));
    this.hudUpdate();
  }

  hudUpdate() {
    const L = this.hudLast, id = this.cur;
    if (id !== L.id) { L.id = id; L.inGun = -1; this.hud?.setWeapon?.(id); }
    if (!id) return;
    const st = this.st[id], def = WEAPONS[id];
    const inGun = id === 'flaregun' ? (st.chamber === 1 ? 1 : 0) : st.mag + (st.chamber === 1 ? 1 : 0);
    const reserve = this.reserve(def.ammo);
    if (inGun !== L.inGun || reserve !== L.reserve) { L.inGun = inGun; L.reserve = reserve; this.hud?.setAmmo?.(id, inGun, reserve); }
  }
}
