import * as THREE from 'three';
import { Person, NAMES, WALK_SPEED, PATROL_SPEED } from './People.js';
import { CAST, LINES, MOMENTS } from './Lines.js';
import { angleDiff, clamp } from '../core/util.js';
import { Nav } from './Nav.js';

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
// spoken by the browser's Russian voice when there is one (else a murmur from audio.voice), with
// English subtitles. Moments (the engine stopped, ice hit, the horn, the aurora, the kettle)
// change what they say next.

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

const _v = new THREE.Vector3(), _f = new THREE.Frustum(), _pm = new THREE.Matrix4(), _s = new THREE.Sphere();

export class Crew {
  constructor({ data, boat, model, lighting, interactions, ui, audio, camera, quality }) {
    Object.assign(this, { boat, model, ui, audio, camera, quality });
    this.people = [];
    this.moments = new Set();
    this.russian = null;
    this.findVoice();
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
      interactions.add(p.hit, { hint: () => `Talk to ${p.cast.name}`, use: () => this.talk(p), range: 3.4 });
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
    };
    pick();
    window.speechSynthesis?.addEventListener?.('voiceschanged', pick);
  }

  moment(kind) { if (MOMENTS[kind]) this.moments.add(kind); }

  // the line this person says next (a fresh moment first, if it's one of theirs)
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
    const secs = clamp(en.length * 0.065 + 1.2, 2.5, 8);
    p.talking = true; p.talkT = secs; p.saved = p.state; p.state = 'talk';
    p.play('talk', 0.35);
    this.ui.subtitle(p.cast.name, ru, en, secs + 0.5);
    const pos = p.root.getWorldPosition(_v).clone().setY(p.root.getWorldPosition(_v).y + 1.6);
    if (this.russian && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(ru);
        u.voice = this.russian; u.lang = this.russian.lang; u.pitch = p.cast.pitch; u.rate = p.cast.rate; u.volume = 0.9;
        window.speechSynthesis.speak(u);
      } catch { this.audio?.voice?.(pos, secs); }
    } else this.audio?.voice?.(pos, secs);
  }

  // a line from someone who isn't standing here (the story's captain over your shoulder, the
  // radio, the station chief): the subtitle and the voice (a radio voice is a radio burst)
  speak(voice, ru, en, radio = false) {
    const secs = clamp(en.length * 0.065 + 1.2, 2.5, 9);
    this.ui.subtitle(voice.name, ru, en, secs + 0.5);
    if (radio) { this.audio?.sfx?.('crackle', null); }
    if (this.russian && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(ru);
        u.voice = this.russian; u.lang = this.russian.lang; u.pitch = voice.pitch; u.rate = voice.rate; u.volume = radio ? 0.75 : 0.9;
        window.speechSynthesis.speak(u);
      } catch { /* (no voice: the subtitle alone) */ }
    }
  }

  update(dt, player) {
    const cam = this.camera;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _f.setFromProjectionMatrix(_pm);
    const range = this.quality.peopleRange;
    for (const p of this.people) {
      this.think(p, dt, player);
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
        p.talking = false; p.state = p.saved === 'walk' ? 'walk' : 'job';
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
