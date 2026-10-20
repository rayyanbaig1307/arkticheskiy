import * as THREE from 'three';
import { Person, NAMES, WALK_SPEED, PATROL_SPEED } from './People.js';
import { CAST, LINES, MOMENTS } from './Lines.js';
import { angleDiff, clamp } from '../core/util.js';
import { Nav } from './Nav.js';
import { Voices } from '../audio/Voices.js';

// What everyone aboard does. Each person has a routine built from the boat's SPOT_ and PATH_
// nodes (tools/blender/make_tug.py):
//
//   captain   on the bridge beside the wheel, looking out, now and then talking it over
//   bosun     at the towing winch on the aft deck, hauling and checking the line
//   deckhand  walking his round of the main deck, stopping now and then
//   engineer  at the engine control console; now and then down between the engines and back
//   cook      wiping the mess table, then over to the stove
//   soldier1  on watch at the bow: standing guard, binoculars
//   soldier2  patrolling the 01 deck and the forecastle
//   soldier3  the lookout on the port bridge wing with binoculars
//   soldier4  standing guard on the aft deck
//
// Nobody walks through anything: every walk is routed round the furniture, the machinery and the
// deck gear (Nav.js: a grid over the collision mesh), worked out once per leg when the crew comes
// aboard.
//
// Look at someone and press E: they stop, turn to you and say something (Lines.js): in Russian,
// with English subtitles. The line is their own recorded voice (audio/Voices.js), coming from
// their head, their mouth moving with its loudness; a line with no recording is spoken by the
// browser's Russian voice when there is one, else a murmur from audio.voice. Their next line is
// fetched while you're looking at them. Moments (the engine stopped, ice hit, the horn, the
// aurora, the kettle) change what they say next.

const ROUTINES = {
  captain: { spots: ['captain'], clips: [['idle', 14], ['talk', 6], ['idle', 10]] },
  bosun: { spots: ['bosun', 'bosun2'], clips: [['gauges', 14], ['idle', 7]] },
  deckhand: { path: 'deck', clip: 'walk', speed: WALK_SPEED * 0.9, pause: ['idle', 0.35] },
  engineer: { spots: ['engineer', 'engineer2'], clips: [['gauges', 12], ['idle', 6]] },
  cook: { spots: ['cook2', 'cook'], clips: [['wipe', 12], ['idle', 7]] },
  soldier1: { spots: ['guard_bow'], clips: [['guard', 14], ['binoculars', 10]] },
  soldier2: { path: 'patrol', clip: 'patrol', speed: PATROL_SPEED, pause: ['guard', 0.25] },
  soldier3: { spots: ['lookout'], clips: [['binoculars', 16], ['guard', 8]] },
  soldier4: { spots: ['guard_aft'], clips: [['guard', 18], ['idle', 8]] },
};

const _v = new THREE.Vector3(), _f = new THREE.Frustum(), _pm = new THREE.Matrix4(), _s = new THREE.Sphere(), _mw = new THREE.Vector3();
// (waiting for a recording: the mouth stays shut until it starts)
const HUSH = { level: () => 0, done: false, move() {}, stop() {} };

export class Crew {
  constructor({ data, boat, model, lighting, interactions, ui, audio, camera, quality }) {
    Object.assign(this, { boat, model, ui, audio, camera, quality });
    this.people = [];
    this.moments = new Set();
    this.russian = null;
    this.findVoice();
    this.voices = new Voices(audio);
    this.line = null;               // the line being said now: { p, h (its sound) }
    this.nav = new Nav(model.collision);
    for (const name of NAMES) {
      const g = data.models[name];
      if (!g) continue;
      const p = new Person(name, g, data, { lighting });
      const r = ROUTINES[name];
      p.routine = r; p.state = 'job'; p.timer = 2 + Math.random() * 4; p.step = 0; p.spotI = 0; p.pathI = 0; p.lineI = 0;
      p.cast = CAST[name];
      if (r.spots) {
        const s = model.spots[r.spots[0]];
        if (!s) continue;
        p.place(s.pos, s.yaw); p.play(r.clips[0][0], 0);
      } else {
        const path = model.paths[r.path];
        if (!path?.length) continue;
        p.place(path[0], 0); p.state = 'walk'; p.pathI = 1; this.go(p, path[1 % path.length]); p.play(r.clip, 0);
      }
      boat.root.add(p.root);
      interactions.add(p.hit, { hint: () => { this.voices.prefetch(p.name, this.peekLine(p)[0]); return `Talk to ${p.cast.name}`; }, use: () => this.talk(p), range: 3.4 });
      this.people.push(p);
    }
    // every leg of every routine, routed now (so nobody stops to think on the way)
    const t0 = performance.now();
    for (const p of this.people) {
      const r = p.routine;
      const pts = r.spots ? r.spots.map((s) => model.spots[s]?.pos).filter(Boolean) : (model.paths[r.path] || []);
      for (let i = 0; i < pts.length && pts.length > 1; i++) this.nav.route(pts[i], pts[(i + 1) % pts.length]);
    }
    this.navMs = performance.now() - t0;
  }

  // walk to a point, by the route round everything in the way
  go(p, target) {
    p.target = target;
    p.route = this.nav.route(p.root.position, target);
    p.ri = 0;
  }

  findVoice() {
    const pick = () => {
      const vs = window.speechSynthesis?.getVoices?.() || [];
      this.russian = vs.find((v) => /^ru/i.test(v.lang)) || null;
      this.english = vs.find((v) => /^en-(GB|US)/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
    };
    pick();
    window.speechSynthesis?.addEventListener?.('voiceschanged', pick);
  }

  moment(kind) { if (MOMENTS[kind]) this.moments.add(kind); }

  // the line this person says next (a fresh moment first, if it's one of theirs); peekLine is the
  // same without using it up
  peekLine(p) {
    for (const k of this.moments) if (MOMENTS[k].who.includes(p.name)) return MOMENTS[k].line;
    const list = LINES[p.name];
    return list[p.lineI % list.length];
  }

  nextLine(p) {
    for (const k of this.moments) {
      const m = MOMENTS[k];
      if (m.who.includes(p.name)) { this.moments.delete(k); return m.line; }
    }
    const list = LINES[p.name];
    const l = list[p.lineI % list.length]; p.lineI++;
    return l;
  }

  talk(p) {
    if (p.talking) return;
    const [ru, en] = this.nextLine(p);
    this.hold(p, clamp(en.length * 0.065 + 1.2, 2.5, 8));
    this.utter(p.name, ru, en, p.cast, { p });
  }

  // a line from the story (Story.js): the captain (from where he stands if you're near him, else
  // over your shoulder), the radio (a radio burst) or the station chief (o.p, Story's person; o.onStart
  // hears how long it lasts)
  speak(voice, ru, en, o = {}) {
    const who = o.who;
    let p = o.p || null;
    if (!p && who === 'captain') {
      const c = this.people.find((x) => x.name === 'captain');
      if (c && c.root.getWorldPosition(_v).distanceTo(this.camera.position) < 14) p = c;
    }
    if (p && this.people.includes(p)) this.hold(p, clamp(en.length * 0.065 + 1.2, 2.5, 9));
    // (o.radio: heard over the radio; who stays the speaker, whose recording it is)
    const radio = o.radio ?? who === 'radio';
    if (radio) this.audio?.sfx?.('crackle', null);
    this.utter(who, ru, en, voice, { p, radio, onStart: o.onStart });
  }

  // stop what they're doing and turn to you for a while (the line sets how long once it starts)
  hold(p, secs) {
    if (!p.talking) { p.saved = p.state; p.state = 'talk'; p.play('talk', 0.35); }
    p.talking = true; p.talkT = secs;
  }

  // Say a line out loud: its recording if there is one, from the speaker's head (o.p) or in your
  // ear, the mouth moving with it; else the browser's Russian voice; else a murmur. One line at a
  // time: a new one cuts the last one off. The subtitle comes up with the voice.
  utter(who, ru, en, cast, o = {}) {
    const p = o.p || null;
    const est = clamp(en.length * 0.065 + 1.2, 2.5, 9);
    const begin = (secs) => {
      // (English voices: the English alone; Russian ones: the Russian with the English under it)
      if (this.lang === 'en') this.ui.subtitle(cast.name, en, '', secs + 0.5); else this.ui.subtitle(cast.name, ru, en, secs + 0.5);
      if (p && this.people.includes(p)) p.talkT = secs + 0.3;
      o.onStart?.(secs + 0.3);
    };
    this.hush(p);
    const line = { p, h: null };
    this.line = line;
    const fallback = () => {
      if (this.line !== line) return;
      if (p && p.speech === HUSH) p.speech = null;
      begin(est);
      const spoke = this.synth(ru, cast, o.radio ? 0.75 : 0.9, en);
      if (!spoke && !o.radio) this.audio?.voice?.(p ? p.mouthWorld(_mw) : null, est);
    };
    const start = (buf) => {
      if (this.line !== line) return;
      const pos = p ? p.mouthWorld(_mw) : null;
      const h = this.audio?.playBuffer?.(buf, pos, { zone: p ? this.zoneOf(p) : undefined, radio: o.radio, gain: o.radio ? 0.9 : 1 });
      if (!h) { fallback(); return; }
      line.h = h;
      if (p) p.speech = h;
      begin(h.duration);
    };
    if (p) p.speech = HUSH;
    if (!this.voices.say(who, ru, start, fallback)) fallback();
  }

  // cut the line being said short (its sound, the browser's voice); its speaker stops talking
  // soon after, unless they're the one with the next line (keep)
  hush(keep = null) {
    const l = this.line;
    if (l) {
      l.h?.stop(0.12);
      if (l.p && (l.p.speech === l.h || l.p.speech === HUSH)) {
        l.p.speech = null;
        if (l.p !== keep && this.people.includes(l.p) && l.p.talkT > 0.4) l.p.talkT = 0.4;
      }
      this.line = null;
    }
    try { window.speechSynthesis?.cancel(); } catch { /* none */ }
  }

  // the browser's Russian voice, if it has one
  // which voices speak: 'ru' (the recordings, English subtitles) or 'en'
  setLang(lang) { this.lang = lang === 'en' ? 'en' : 'ru'; this.voices.setLang(this.lang); }

  synth(ru, cast, volume, en = null) {
    const voice = this.lang === 'en' && en && this.english ? this.english : this.russian;
    if (!voice || !window.speechSynthesis) return false;
    try {
      const u = new SpeechSynthesisUtterance(voice === this.english ? en : ru);
      u.voice = voice; u.lang = voice.lang; u.pitch = cast.pitch; u.rate = cast.rate; u.volume = volume;
      window.speechSynthesis.speak(u);
      return true;
    } catch { return false; }
  }

  // which room someone is in (null: out on deck, or ashore)
  zoneOf(p) {
    if (!this.people.includes(p)) return null;
    return this.model.zoneAt(_v.copy(p.root.position).setY(p.root.position.y + 1)) || null;
  }

  update(dt, player) {
    const cam = this.camera;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _f.setFromProjectionMatrix(_pm);
    const range = this.quality.peopleRange;
    for (const p of this.people) {
      this.think(p, dt, player);
      // a line being said comes from their head (the boat carries them along)
      if (p.speech && p.speech !== HUSH) p.speech.move(p.mouthWorld(_mw));
      // seen? (out of range or behind you: hidden and frozen)
      p.root.getWorldPosition(_v); _v.y += 0.9;
      const d = _v.distanceTo(cam.position);
      _s.set(_v, 1.3);
      const vis = d < range && (d < 4 || _f.intersectsSphere(_s));
      if (vis !== p.vis) { p.vis = vis; p.root.visible = vis; }
      if (vis) {
        p.setDetail(d < 14);
        // (a person's shadow is a few draws of the whole body: only the near ones cast one)
        const sh = d < 16;
        if (sh !== p.shadowOn) { p.shadowOn = sh; p.root.traverse((o) => { if (o.isMesh && !p.small.includes(o) && o !== p.hit) o.castShadow = sh && !/hat|cap|glove|belt|hair|short0|scarf/i.test(((o.material && o.material.name) || '') + ' ' + o.name); }); }
        p.update(dt);
      }
      else p.t += dt;
    }
  }

  think(p, dt, player) {
    const r = p.routine;
    const pos = p.root.position;
    if (p.state === 'talk') {
      p.turnTo(player.pos.x, player.pos.z, dt, 5);
      if ((p.talkT -= dt) <= 0) {
        p.talking = false; p.speech = null; p.state = p.saved === 'walk' ? 'walk' : 'job';
        p.timer = Math.max(p.timer, 2);
        if (p.state === 'walk') p.play(r.clip || 'walk', 0.5, 1);
        else p.play(this.jobClip(p), 0.6);
      }
      return;
    }
    if (p.state === 'job') {
      // at a post: the clips in turn; posts in turn
      if ((p.timer -= dt) <= 0) {
        if (r.spots) {
          p.step = (p.step + 1) % r.clips.length;
          if (p.step === 0 && r.spots.length > 1) {
            p.spotI = (p.spotI + 1) % r.spots.length;
            this.go(p, this.model.spots[r.spots[p.spotI]].pos); p.state = 'walk';
            p.play('walk', 0.4, 1);
            return;
          }
          p.play(r.clips[p.step][0], 0.6);
          p.timer = r.clips[p.step][1] * (0.8 + Math.random() * 0.4);
        } else {
          p.state = 'walk'; p.play(r.clip, 0.5, 1);
        }
      }
      // face the post's direction
      if (r.spots) {
        const s = this.model.spots[r.spots[p.spotI]];
        p.yaw += angleDiff(p.yaw, s.yaw) * Math.min(1, dt * 2); p.root.rotation.y = p.yaw;
      }
      return;
    }
    if (p.state === 'walk') {
      const fin = p.target;
      // the next corner of the route (the last one is the target itself)
      while (p.route && p.ri < p.route.length - 1 && Math.hypot(p.route[p.ri].x - pos.x, p.route[p.ri].z - pos.z) < 0.18) p.ri++;
      const t = p.route ? p.route[Math.min(p.ri, p.route.length - 1)] : fin;
      const last = !p.route || p.ri >= p.route.length - 1;
      const dx = t.x - pos.x, dz = t.z - pos.z, d = Math.hypot(dx, dz);
      // someone in the way (you): wait
      const ahead = (player.pos.x - pos.x) * dx + (player.pos.z - pos.z) * dz;
      const near = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z) < 1.0 && Math.abs(player.pos.y - pos.y) < 1.5 && ahead > 0;
      if (near) { p.play(r.pause?.[0] || 'idle', 0.4); p.blocked = true; return; }
      if (p.blocked) { p.blocked = false; p.play(r.clip || 'walk', 0.4, 1); }
      const speed = r.speed || WALK_SPEED;
      if (d < 0.15 && last) {
        if (r.path) {
          const path = this.model.paths[r.path];
          p.pathI = (p.pathI + 1) % path.length;
          this.go(p, path[p.pathI]);
          if (Math.random() < r.pause[1]) { p.state = 'job'; p.timer = 2 + Math.random() * 4; p.play(r.pause[0], 0.5); }
        } else {
          p.state = 'job'; p.step = 0;
          p.play(r.clips[0][0], 0.6); p.timer = r.clips[0][1];
        }
        return;
      }
      const step = Math.min(d, speed * dt);
      pos.x += (dx / d) * step; pos.z += (dz / d) * step;
      p.turnTo(t.x, t.z, dt, 6);
      // the deck under them
      const floor = this.model.collision.floorAt(pos.x, pos.y + 0.6, pos.z, 1.6);
      if (floor !== null) pos.y += (floor - pos.y) * Math.min(1, dt * 10);
      p.actions[p.clip] && (p.actions[p.clip].timeScale = (r.clip === 'patrol' ? 1 : speed / WALK_SPEED));
    }
  }

  jobClip(p) { const r = p.routine; return r.spots ? r.clips[p.step][0] : (r.pause?.[0] || 'idle'); }

  // breath points (world) of everyone outside and seen, for the steam
  mouths(out = []) {
    out.length = 0;
    for (const p of this.people) {
      if (!p.vis) continue;
      const zone = this.model.zoneAt(p.root.position.clone().setY(p.root.position.y + 1));
      if (zone) continue;
      out.push({ p, pos: p.mouthWorld(new THREE.Vector3()), talking: p.talking });
    }
    return out;
  }
}
