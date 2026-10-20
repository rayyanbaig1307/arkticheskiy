import * as THREE from 'three';
import { SCRIPT } from './Script.js';
import { STORY_CAST, CAST } from '../characters/Lines.js';
import { STATION_POS } from '../world/Station.js';
import { saves } from '../survival/Saves.js';
import { CH1 } from './ch1.js';
import { CH2 } from './ch2.js';
import { CH3 } from './ch3.js';
import { CH4 } from './ch4.js';
import { CH5 } from './ch5.js';

// The story: five chapters (DESIGN.md), each a list of steps. A step has an objective (Russian and
// English), maybe a marker (a world point for the HUD), enter() and update() (true when it's
// done); the chapters' files (ch1.js .. ch5.js) are written against this file's helpers:
//
//   d.say(id) / d.lines([ids])   a line of story/Script.js, said by its speaker (their recording,
//                                else the browser's voice), from their mouth when they are near
//   d.after(secs, fn)            later (cancelled when the step changes, unless keep)
//   d.objective(ru, en, ...)     d.marker(fn)       d.flag(k) / d.set(k, v)
//   d.st(x, y, z)                a point in the station's frame (Blender's axes) to the world
//   d.near(world, r)  d.inZone(name)  d.give(item, n)  d.has(item)  d.take(item, n)
//   d.sky(k)  d.ambience(k)  d.stinger(k)  d.sfx(k, pos)  d.scare(kind)
//   d.spawn(level, name, opts)   a creature at a level's SPAWN_ place
//   d.fade(secs, fn)             to black, fn, back
//   d.teleport(world, yaw)       d.checkpoint(name)   d.use(action, handler)
//
// The tug's mechanics (sailing to the berth, the lines, the mooring, casting off) stay in
// story/Story.js, run in its 'voyage' mode (no lines of its own): ctx.voyage.

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
export const CHAPTERS = [null, CH1, CH2, CH3, CH4, CH5];

export class Director {
  constructor(ctx) {
    this.ctx = ctx;                     // horror, boat, station, crew, stations, ui, audio, player, model, sky, voyage, interactions, scene, lights, radar, lighting, peopleData, ice
    this.h = ctx.horror;
    if (ctx.voyage) ctx.voyage.holdMoored = true;       // (moored, she stays till chapter 5 lets her go)
    this.chapter = 0; this.i = -1; this.step = null; this.stepT = 0; this.t = 0;
    this.timers = []; this.said = new Set();
    this.markerFn = null;
    this.started = false;
    this.el = {
      obj: document.getElementById('objective'), title: document.getElementById('objtitle'), text: document.getElementById('objtext'),
      dist: document.getElementById('objdist'), marker: document.getElementById('marker'), mlabel: document.getElementById('mlabel'),
      end: document.getElementById('endcard'),
    };
    this.fadeEl = document.getElementById('fade') || (() => {
      const e = document.createElement('div'); e.id = 'fade';
      e.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity 1.2s;z-index:50';
      document.body.appendChild(e); return e;
    })();
    this.h.onRetry = () => this.continueGame();
    this.h.onDeath = () => { this.objective(null); };
    this.h.onCode = (door, L) => this.codePrompt(door, L);
  }

  get flags() { return this.h.flags; }
  flag(k) { return !!this.h.flags[k]; }
  set(k, v = true) { this.h.flags[k] = v; }

  // ---- starting
  newGame() {
    saves.clear();
    this.h.stats.reset?.(); this.h.inventory.clear?.(); this.h.pickups.reset?.(); this.h.journal.restore?.(null); this.h.hud.reset?.();
    this.h.flags = {};
    this.h.journal.enabled = true;
    this.go(1, 0);
  }
  continueGame() {
    const s = saves.load();
    if (!s) return this.newGame();
    this.h.restore(s);
    const ch = s.chapter || 1;
    const steps = CHAPTERS[ch].steps;
    const at = Math.max(0, steps.findIndex((x) => x.id === s.checkpoint));
    this.h.hud.hideDeath?.();
    this.h.stats.dead = false;
    this.go(ch, at, true);
  }

  go(ch, i = 0, restore = false) {
    this.clearTimers(true);
    const C = CHAPTERS[ch];
    if (this.chapter !== ch) {
      this.chapter = ch; this.h.chapter = ch;
      C.setup?.(this, restore ? C.steps[i]?.id : null);
      this.h.hud.chapter?.(ch);
      this.h.journal.setChapter?.(ch);
      this.stinger('chapter');
    } else if (restore) C.setup?.(this, C.steps[i]?.id);
    if (restore) C.restore?.(this, C.steps[i]?.id);
    this.started = true;
    this.hold = 0.6;
    this.enter(i, restore);
  }

  enter(i, restore = false) {
    const steps = CHAPTERS[this.chapter].steps;
    if (i >= steps.length) {
      const next = this.chapter + 1;
      if (CHAPTERS[next]) this.go(next, 0);
      else this.end();
      return;
    }
    this.clearTimers();
    this.i = i; this.step = Object.create(steps[i]); this.stepT = 0;      // (a fresh copy: a step's own state starts clean each time)
    const s = this.step;
    if (s.objective) this.objective(...s.objective); else if (s.objective === null) this.objective(null);
    this.markerFn = s.marker || null;
    if (s.checkpoint !== false && (s.checkpoint || restore === false)) {
      // (every step that says so is a checkpoint; and the first of every chapter)
      if (s.checkpoint || i === 0) this.h.checkpoint(s.id);
    }
    s.enter?.(this, restore);
  }
  next() { this.enter(this.i + 1); }
  jump(id) { const k = CHAPTERS[this.chapter].steps.findIndex((s) => s.id === id); if (k >= 0) this.enter(k); }

  end() {
    this.objective(null);
    this.after(2, () => {
      const el = this.el.end;
      if (el) { el.classList.remove('hidden'); const h = el.querySelector('h2, .title'); if (h) h.textContent = 'АРКТИЧЕСКИЙ'; }
      this.ctx.player.input.unlock?.();
    }, true);
  }

  // ---- each frame
  update(dt) {
    if (!this.started) return;
    dt *= this.speed || 1;             // (the test harness can run the story's clock faster)
    this.t += dt; this.stepT += dt;
    for (const tm of [...this.timers]) {
      if ((tm.t -= dt) <= 0) { this.timers.splice(this.timers.indexOf(tm), 1); tm.fn(); }
    }
    CHAPTERS[this.chapter]?.always?.(this, dt);
    // (after a jump, a restore or a teleport the camera is a frame behind: the steps wait a moment)
    if (this.hold > 0) { this.hold -= dt / (this.speed || 1); this.drawMarker(); return; }
    if (this.step?.update && !this.h.stats.dead) {
      const done = this.step.update(this, dt);
      if (done) this.next();
    }
    this.drawMarker();
  }

  // ---- timing
  after(secs, fn, keep = false) { const tm = { t: secs, fn, keep }; this.timers.push(tm); return tm; }
  clearTimers(all = false) { this.timers = all ? [] : this.timers.filter((t) => t.keep); }

  // ---- lines
  person(who) { return this.ctx.crew?.people?.find((p) => p.name === who && p.root.visible) || null; }
  say(id, o = {}) {
    const line = SCRIPT[id];
    if (!line) { console.warn('[Arkticheskiy] no line', id); return 3; }
    const [who, ru, en] = line;
    const cast = STORY_CAST[who] || CAST[who] || { name: who, pitch: 1, rate: 1 };
    let p = o.p !== undefined ? o.p : this.person(who);
    if (p && o.radio) p = null;
    if (p) {
      const cam = this.ctx.camera.getWorldPosition(_w);
      if (p.root.getWorldPosition(_v).distanceTo(cam) > 14) p = null;
    }
    this.said.add(id);
    const voiced = o.radio || who === 'radio' || who === 'markova' || who === 'mimic' || (!p && !o.inear);
    this.ctx.crew.speak(cast, ru, en, { who, radio: voiced, p, onStart: o.onStart });
    if (voiced) this.ctx.audio?.horror?.sfx?.('radio_burst', null, { gain: 0.4 });
    return Math.min(9, Math.max(2.5, en.length * 0.065 + 1.4));
  }
  // lines one after the other, then done(): each waits for the last to be said (its recording's
  // own length once it starts; the estimate if it never does)
  lines(ids, done, o = {}) {
    const est = (id) => Math.min(9, Math.max(2.5, (SCRIPT[id]?.[2] || '').length * 0.065 + 1.4));
    const run = (k) => {
      if (k >= ids.length) { if (done) this.after(0.1, done, o.keep); return; }
      let went = false;
      const go = (secs) => { if (went) return; went = true; this.after(Math.max(0.5, secs - 0.3) + (o.gap ?? 0.5), () => run(k + 1), o.keep); };
      this.say(ids[k], { ...o, onStart: (secs) => go(secs) });
      this.after(est(ids[k]) + 5, () => go(0), o.keep);         // (it never started: go on anyway)
    };
    this.after(o.delay || 0, () => run(0), o.keep);
    return (o.delay || 0) + ids.reduce((t, id) => t + est(id) + (o.gap ?? 0.5), 0);
  }

  // ---- the HUD's objective, the journal's
  objective(ru, en, textRu, textEn) {
    const el = this.el;
    if (!ru) { el.obj?.classList.add('hidden'); return; }
    el.obj?.classList.remove('hidden');
    if (el.title) el.title.textContent = `${ru} · ${en}`;
    if (el.text) el.text.textContent = textEn || '';
    this.h.journal.setObjective?.(en, textEn || '', ru);
  }
  marker(fn) { this.markerFn = fn; }
  drawMarker() {
    const el = this.el.marker;
    if (!el) return;
    const target = this.markerFn?.(this);
    if (!target || !this.ctx.player.input.locked) { el.classList.add('hidden'); if (this.el.dist) this.el.dist.textContent = ''; return; }
    const cam = this.ctx.camera;
    const d = cam.position.distanceTo(target);
    const p = _v.copy(target).project(cam);
    const behind = p.z > 1;
    let x = p.x, y = p.y;
    if (behind) { x = -x; y = -y; }
    const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.88;
    if (edge) { const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.88, 1e-3); x /= k; y /= k; if (behind) y = Math.min(y, -0.75); }
    el.classList.remove('hidden');
    el.classList.toggle('edge', edge);
    el.style.left = `${(x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-y * 0.5 + 0.5) * 100}%`;
    el.style.setProperty('--ang', `${Math.atan2(-y, x)}rad`);
    this.el.mlabel.textContent = d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
  }

  // ---- places
  st(x, y, z = 0) { return new THREE.Vector3(x, z, -y).add(STATION_POS); }
  boat(local) { return this.ctx.boat.toWorld(local, new THREE.Vector3()); }
  spot(name) { const s = this.ctx.model.spots[name]; return s ? this.boat(s.pos) : null; }
  eye() { return this.ctx.camera.getWorldPosition(new THREE.Vector3()); }
  near(world, r) { return world && this.eye().distanceTo(world) < r; }
  nearPerson(who, r) { const p = this.person(who); return p && this.near(p.root.getWorldPosition(_w), r); }
  inZone(name) { return this.h.zone?.name === name || this.ctx.player.zone === name; }
  ashore() { const l = this.ctx.boat.toLocal(this.eye(), _w); return this.ctx.boat.moored && (Math.abs(l.x) > 6.5 || Math.abs(l.z) > 19) && !this.ctx.player.zone; }
  point(level, kind, name) { const L = this.h.levels[level]; return L?.points[kind]?.find((p) => p.name === name)?.pos || null; }

  // ---- what you carry
  give(item, n = 1) { this.h.inventory.add(item, n); this.h.hud.pickup?.(item, n); }
  has(item, n = 1) { return this.h.inventory.has(item, n); }
  take(item, n = 1) { this.h.inventory.remove(item, n); }

  // ---- the world
  sky(k) { this.ctx.sky.setTime(k); }
  ambience(k) { this.h.baseAmbience = k; this.h.ambNow = null; }        // (outdoors; HorrorGame swaps in a room's own: interior, bunker, cave)
  stinger(k) { this.ctx.audio?.horror?.stinger?.(k); }
  sfx(k, pos = null, o) { this.ctx.audio?.horror?.sfx?.(k, pos, o); }
  creature(k, pos) { this.ctx.audio?.horror?.creature?.(k, pos); }
  scare(kind = 'jump') {
    this.stinger(kind);
    this.h.stats.scare?.(kind === 'jump' ? 0.6 : 0.3);
    this.ctx.player.shakeT = Math.max(this.ctx.player.shakeT || 0, kind === 'jump' ? 0.5 : 0.2);
  }
  spawn(level, name, opts) { return this.h.spawnAt(this.h.levels[level], name, opts); }
  creatureAt(kind, world, opts = {}) { return this.h.enemies.spawn(kind, this.ctx.boat.toLocal(world, new THREE.Vector3()), opts); }
  use(action, handler) { this.h.uses[action] = handler; }

  fade(secs = 1.2, fn) {
    const el = this.fadeEl;
    el.style.transition = `opacity ${secs}s`; el.style.opacity = '1';
    this.after(secs + 0.1, () => { fn?.(); this.after(0.3, () => { el.style.opacity = '0'; }, true); }, true);
  }
  teleport(world, yaw = null) {
    const { player, boat } = this.ctx;
    const local = boat.toLocal(world, new THREE.Vector3());
    player.spawn({ pos: local, yaw: yaw ?? player.yaw });
    this.hold = Math.max(this.hold || 0, 0.3);
  }
  // a direction (world) as the player's yaw (boat space)
  yawFor(dir) { const f = dir.clone().applyQuaternion(this.ctx.boat.root.getWorldQuaternion(_q).invert()); return Math.atan2(-f.x, -f.z); }
  checkpoint(name) { this.h.checkpoint(name); }

  // moored at the berth this instant (a restore, or a test)
  mooredNow() {
    const { boat, station } = this.ctx;
    if (boat.moored) return;
    const b = station.berth;
    boat.x = b.pos.x; boat.z = b.pos.z; boat.heading = b.heading; boat.docking = null; boat.moored = true; boat.speed = 0;
    boat.update(0.016);
    boat.emit('moored');
  }

  // ---- a door's code: a small keypad on the screen
  codePrompt(door, L) {
    const code = (door.lock || '').slice(5);
    const el = document.getElementById('keypad') || (() => {
      const e = document.createElement('div'); e.id = 'keypad';
      e.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(10,14,18,.94);border:1px solid #5a6a78;padding:18px 22px;color:#cfe;font:16px monospace;z-index:60;text-align:center';
      document.body.appendChild(e); return e;
    })();
    let typed = '';
    const draw = () => { el.innerHTML = `<div style="opacity:.7;margin-bottom:8px">КОД ДОСТУПА · ACCESS CODE</div><div style="font-size:30px;letter-spacing:10px;min-height:38px">${typed.padEnd(code.length, '·')}</div><div style="opacity:.6;margin-top:8px">0–9 · Backspace · Esc</div>`; };
    const close = () => { el.remove(); removeEventListener('keydown', key, true); this.ctx.player.input.lock?.(); };
    const key = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return close();
      if (e.key === 'Backspace') typed = typed.slice(0, -1);
      else if (/^[0-9]$/.test(e.key) && typed.length < code.length) { typed += e.key; this.sfx('dry_fire', null, { gain: 0.15 }); }
      draw();
      if (typed.length === code.length) {
        if (typed === code) { this.set('code:' + door.name); this.sfx('pickup_key'); setTimeout(() => { close(); L.openDoor(door, true); this.sfx('door_creak', door.node.getWorldPosition(new THREE.Vector3())); }, 300); }
        else { this.sfx('door_locked'); typed = ''; setTimeout(draw, 250); }
      }
    };
    this.ctx.player.input.unlock?.();
    addEventListener('keydown', key, true);
    draw();
  }

  // the course the autopilot steers (main.js's boat.pilot), when a chapter wants her sailing
  pilotTarget() { return CHAPTERS[this.chapter]?.pilotTarget?.(this) || null; }
}
