import * as THREE from 'three';
import { ORDERS } from '../boat/Boat.js';
import { STATION_POS } from '../world/Station.js';
import { Person } from '../characters/People.js';
import { STORY as SAY, STORY_CAST as VOICES } from '../characters/Lines.js';
import { loadGLB } from '../core/Assets.js';
import { angleDiff, clamp } from '../core/util.js';

// The run to Station Severny: the Polyarnik carries the station's winter supplies through the ice,
// 2.4 km to the north-north-east, and lies alongside its berth on the fast ice.
//
//   1  the captain asks you to take the wheel
//   2  at the helm: steer for the station (its bearing and distance on the HUD, its echo on the
//      radar, its beacon flashing over the fog); let go of the wheel and the mate's autopilot
//      carries on toward it, round the bergs, as far as the approach
//   3  the station calls on the radio; the captain has you ease her down
//   4  alongside: bring her in slow (under 5 knots), heading west, starboard side to the ice,
//      within 45 m of the berth's marks, and she's brought in the last of the way, the lines go
//      out to the ice anchors, the gangway comes down
//   5  go ashore across the gangway and report to the station chief
//   6  then the night is yours: walk the ice, or take the wheel and cast off
//
// The free voyage has no objectives and no lines, but the berth works the same.

const ALONG_RANGE = 45, ALONG_SPEED = 2.6, ALONG_ANGLE = 0.95;
// the lines that may come up next in each state (their recordings are fetched on the way in)
const NEXT = { start: ['intro'], take: ['helm'], steer: ['auto', 'radio', 'approach', 'handover'], approach: ['fast', 'docking'], docking: ['moored'], moored: ['chief'], free: ['chief2', 'castoff'] };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Story {
  constructor(ctx) {
    Object.assign(this, ctx);       // ui, boat, stations, station, crew, audio, player, model, scene, interactions, towline, lighting, peopleData, towMat, settings
    this.mode = ctx.settings.mode || 'story';
    this.state = 'start';
    this.t = 0; this.stateT = 0;
    this.said = new Set();
    this.lines = [];                // mooring lines
    this.extra = null;              // the ice's collision while moored
    this.chief = null;
    this.done = false;
    this.endT = 0;                  // the end card, this long after the chief has spoken
    this.el = {
      obj: document.getElementById('objective'), title: document.getElementById('objtitle'), text: document.getElementById('objtext'),
      dist: document.getElementById('objdist'), marker: document.getElementById('marker'), mlabel: document.getElementById('mlabel'),
      end: document.getElementById('endcard'),
    };
    document.getElementById('endstay')?.addEventListener('click', () => { this.el.end.classList.add('hidden'); this.player.input.lock?.(); });
    this.boat.on((kind) => {
      if (kind === 'moored') this.onMoored();
    });
    this.wheelSpot = this.model.spots.wheel?.pos?.clone() || new THREE.Vector3(0, 7.6, -6.5);
    this.objective(null);
    if (this.story) this.prefetch(NEXT.start);
  }

  get story() { return this.mode === 'story'; }

  // the line, its subtitle and its voice (its recording; else the browser's Russian voice if it
  // has one): the chief's from the chief, his mouth moving with it, for as long as it lasts
  say(key) {
    if (this.said.has(key) && !/fast|chief2/.test(key)) return;
    this.said.add(key);
    const [who, ru, en] = SAY[key];
    const v = VOICES[who];
    const c = who === 'chief' ? this.chief : null;
    this.crew.speak(v, ru, en, { who, p: c?.p, onStart: c ? (secs) => { c.talkT = secs; if (key === 'chief' && this.endT > 0) this.endT = secs + 1; } : null });
  }

  // the recordings of the lines that may come next, fetched ahead
  prefetch(keys) { for (const k of keys || []) { const l = SAY[k]; if (l && !this.said.has(k)) this.crew.voices.prefetch(l[0], l[1]); } }

  objective(title, text) {
    const el = this.el;
    if (!el.obj) return;
    if (!title || !this.story) { el.obj.classList.add('hidden'); return; }
    el.obj.classList.remove('hidden');
    el.title.textContent = title; el.text.textContent = text || '';
  }

  go(state) { this.state = state; this.stateT = 0; if (this.story) this.prefetch(NEXT[state]); }

  // the berth's marks (world): where she lies, and the approach 380 m out in front of it
  get berth() { return this.station.berth; }
  approachPoint(out = new THREE.Vector3()) { const b = this.berth; return out.set(b.pos.x + 60, 0, b.pos.z + 380); }

  // the autopilot's course in story mode: for the approach point, round the bergs; in the free
  // voyage, its own wander (main.js) — both keep off the shelf's edge
  pilotTarget() {
    if (!this.story || this.done || !this.station.ready || this.state === 'moored' || this.state === 'ashore' || this.state === 'free') return null;
    return this.approachPoint(_w);
  }

  update(dt) {
    this.t += dt; this.stateT += dt;
    const st = this.station, b = this.boat;
    if (!st.ready) return;
    const berth = this.berth;
    const toStation = Math.hypot(STATION_POS.x - b.x, STATION_POS.z - b.z);
    const atWheel = this.stations.at === 'wheel';
    // ---- the beats
    if (this.story) {
      if (this.state === 'start' && this.t > 5) { this.say('intro'); this.go('take'); }
      if (this.state === 'take') {
        this.objective('Take the wheel', 'The captain wants you at the helm. The bridge is at the top of the deckhouse: up the stairs from the main deck hall, then up again.');
        if (atWheel) { this.say('helm'); this.go('steer'); }
      }
      if (this.state === 'steer') {
        this.objective('Steer for Station Severny', 'Follow the marker. A / D steer, W / S engine order. Go round the big bergs; let go of the wheel and the autopilot holds the course.');
        if (!atWheel && this.stateT > 2 && !this.said.has('auto')) this.say('auto');
        if (toStation < 1350 && !this.said.has('radio')) this.say('radio');
        if (Math.hypot(berth.pos.x - b.x, berth.pos.z - b.z) < 520) { this.say(atWheel ? 'approach' : 'handover'); this.go('approach'); }
      }
      if (this.state === 'approach') {
        this.objective('Bring her alongside', 'Slow ahead. Come to the berth between its lights, bow to the west, starboard side to the ice, under 5 knots.');
        if (!atWheel && b.autopilot) { b.setOrder(Math.min(b.order, 1)); }
      }
    }
    // ---- alongside: the berth (both modes)
    if (!b.docking && !b.moored && this.state !== 'free-sail') {
      const d = Math.hypot(berth.pos.x - b.x, berth.pos.z - b.z);
      const da = Math.abs(angleDiff(b.heading, berth.heading));
      if (d < ALONG_RANGE && da < ALONG_ANGLE) {
        if (b.speed < ALONG_SPEED) this.bringIn();
        else if (this.story && (this.fastT = (this.fastT || 0) - dt) <= 0) { this.say('fast'); this.fastT = 8; }
      }
    }
    if (b.docking) {
      const u = b.docking.t / b.docking.dur;
      if (u > 0.55 && !this.lines.length) this.throwLines();
    }
    this.growLines(dt);
    // ---- ashore
    if (this.state === 'moored' || this.state === 'ashore' || this.state === 'free') {
      if (this.chief) this.updateChief(dt);
      if (this.story && this.state === 'moored') this.objective('Go ashore', 'Cross the gangway (starboard side, on the aft deck just behind the deckhouse) and report to the station chief at the main house.');
      // fell in? back aboard
      if (this.player.pos.y < -1.2) { this.player.spawn(this.model.spots.spawn); this.ui.toast('Out of the water and back aboard. Mind the edge.'); }
      // at the wheel, an engine order ahead casts her off
      if (b.moored && atWheel && b.order > 0) this.castOff();
    }
    this.marker();
  }

  // she's slow and lined up: the last of the way is done for her
  bringIn() {
    const b = this.boat, berth = this.berth;
    const d = Math.hypot(berth.pos.x - b.x, berth.pos.z - b.z);
    b.setOrder(0);
    b.dock({ x: berth.pos.x, z: berth.pos.z, heading: berth.heading }, clamp(10 + d * 0.35, 10, 24));
    if (this.story) this.say('docking');
    this.ui.toast('Coming alongside...', 4);
    this.audio?.sfx?.('telegraph', null);
    this.go('docking');
    this.objective('Coming alongside', 'Stop engine. The bosun puts the lines ashore.');
  }

  onMoored() {
    const b = this.boat, st = this.station;
    // the ice and the gangway join her deck: their collision in boat space (she's held still now)
    _m.copy(b.root.matrixWorld).invert();
    if (st.gangway) st.gangway.visible = true;
    this.extra = this.model.collision.addExtra(st.collisionIn(_m));
    this.makeChief();
    if (this.story) this.say('moored');
    this.ui.toast('Moored at Station Severny. The gangway is down: starboard side, just aft of the deckhouse.', 5);
    this.go('moored');
  }

  castOff() {
    const b = this.boat, st = this.station;
    if (this.extra) { this.model.collision.removeExtra(this.extra); this.extra = null; }
    if (st.gangway) st.gangway.visible = false;
    for (const l of this.lines) { this.scene.remove(l.mesh); l.mesh.geometry.dispose(); }
    this.lines = [];
    if (this.chief) { this.scene.remove(this.chief.p.root); this.interactions.remove?.(this.chief.p.hit); this.chief = null; }
    b.castOff();
    b.setOrder(Math.max(1, b.order));
    if (this.story) this.say('castoff');
    this.ui.toast('Lines let go. She\'s free.', 3);
    this.go('free-sail');
    this.objective(null);
  }

  // ---- the mooring lines: from her starboard bitts fore and aft to the ice anchors
  throwLines() {
    const st = this.station;
    const ends = [['ANCHOR_bow', new THREE.Vector3(3.35, 5.72, -16.7)], ['ANCHOR_stern', new THREE.Vector3(4.6, 3.22, 18.3)]];
    for (const [node, bitt] of ends) {
      const a = st.nodes[node];
      if (!a) continue;
      const geo = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), 2, 0.05, 6, false);
      const mesh = new THREE.Mesh(geo, this.towMat);
      mesh.castShadow = true; mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.lines.push({ mesh, bitt, anchor: a.getWorldPosition(new THREE.Vector3()), k: 0 });
    }
    this.audio?.sfx?.('clank', null);
  }

  growLines(dt) {
    for (const l of this.lines) {
      const done = l.k >= 1 && this.boat.moored && l.built;
      if (done) continue;
      l.k = Math.min(1, l.k + dt * 0.6);
      const a = this.boat.toWorld(l.bitt, _v.clone());
      const b = a.clone().lerp(l.anchor, l.k);
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * (0.35 + a.distanceTo(b) * 0.04) * (l.k < 1 ? 0.5 : 1);
        pts.push(p);
      }
      l.mesh.geometry.dispose();
      l.mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.05, 6, false);
      if (l.k >= 1 && this.boat.moored) l.built = true;
    }
  }

  // ---- the station chief, at his door
  async makeChief() {
    if (this.chief || !this.peopleData) return;
    const spot = this.station.nodes.SPOT_chief;
    if (!spot) return;
    let g;
    try { g = await loadGLB('models/people/bosun.glb'); } catch { return; }
    const p = new Person('chief', g, this.peopleData, { lighting: this.lighting });
    const pos = spot.getWorldPosition(new THREE.Vector3());
    const q = spot.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    p.place(pos, Math.atan2(-f.x, -f.z));
    p.play('idle', 0);
    this.scene.add(p.root);
    this.chief = { p, home: p.yaw, talked: 0 };
    this.interactions.add(p.hit, { hint: () => { this.prefetch([this.chief?.talked ? 'chief2' : 'chief']); return 'Talk to the station chief'; }, use: () => this.talkChief(), range: 3.6 });
  }

  talkChief() {
    const c = this.chief;
    if (!c) return;
    c.p.talking = true; c.talkT = 6; c.p.play('talk', 0.35);
    if (!c.talked) {
      // (the end card a moment after he's finished)
      if (this.state !== 'free') { this.go('free'); this.done = true; this.endT = 6.5; }
      this.say('chief');
      c.talked = 1;
    } else { this.say('chief2'); }
  }

  updateChief(dt) {
    const c = this.chief;
    c.p.update(dt);
    if (c.p.talking) {
      const cam = this.player.camera.position;
      const want = Math.atan2(-(cam.x - c.p.root.position.x), -(cam.z - c.p.root.position.z));
      c.p.yaw += angleDiff(c.p.yaw, want) * Math.min(1, dt * 4); c.p.root.rotation.y = c.p.yaw;
      if ((c.talkT -= dt) <= 0) { c.p.talking = false; c.p.speech = null; c.p.play('idle', 0.6); }
    }
    if (this.endT > 0 && (this.endT -= dt) <= 0) this.endCard();
  }

  endCard() {
    const el = this.el.end;
    if (!el) return;
    el.classList.remove('hidden');
    this.player.input.unlock?.();
    this.objective(null);
  }

  // ---- the HUD marker: the objective's place on the screen (or an arrow at its edge)
  marker() {
    const el = this.el.marker;
    if (!el) return;
    let target = null, label = '';
    if (this.story) {
      if (this.state === 'take') { target = this.boat.toWorld(this.wheelSpot, _v); label = 'Wheel'; }
      else if (this.state === 'steer') { target = _v.set(STATION_POS.x + 30, 30, STATION_POS.z - 98); label = 'Severny'; }
      else if (this.state === 'approach') { const b = this.berth.pos; target = _v.set(b.x, 3, b.z); label = 'Berth'; }
      else if (this.state === 'moored' && this.chief) { target = this.chief.p.root.getWorldPosition(_v); target.y += 2.1; label = 'Chief'; }
    }
    if (!target || !this.player.input.locked) { el.classList.add('hidden'); if (this.el.dist) this.el.dist.textContent = ''; return; }
    const cam = this.player.camera;
    const d = cam.position.distanceTo(target);
    const p = target.clone().project(cam);
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
    const dtxt = d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
    this.el.mlabel.textContent = `${label} · ${dtxt}`;
    if (this.el.dist) {
      const brg = ((Math.atan2(target.x - this.boat.x, -(target.z - this.boat.z)) * 180 / Math.PI) + 360) % 360;
      this.el.dist.textContent = this.state === 'steer' || this.state === 'approach' ? `${dtxt} · bearing ${brg.toFixed(0).padStart(3, '0')}° · ${(this.boat.speed * 1.944).toFixed(1)} kn` : '';
    }
  }
}

void ORDERS; void _w;
