import * as THREE from 'three';
import { RECIPES, ENGINE_F0, rng, noise, makeIR, wobble } from './Synth.js';
import { Music } from './Music.js';
import { HorrorAudio } from './Horror.js';

// The game's sound, every bit of it made in code (audio/Synth.js has the recipes, audio/Music.js the
// score) except the spoken lines, which are recordings (audio/Voices.js loads them, playBuffer()
// plays them). Nothing exists until start() is called from the first click; then there is one
// AudioContext, one graph, and the beds that run for the whole voyage.
//
//   outdoor bus  wind, sea, the bow wave, the ice, gulls, animals, the horn, the funnel's exhaust,
//                anyone talking out on deck
//                → the muffle (a lowpass to 600 Hz and -10 dB as you step inside) → master
//   onboard bus  footsteps, doors, the engine room, the hull, the radios, the kettle, voices
//                indoors → master
//   sends        the outdoor reverb (2.5 s: the open ice), the ice field's slow echo (the horn,
//                cracks), and a short steel-room reverb that the onboard bus feeds while you're in
//   music        → master, well under the beds
//   master       → a limiter (the horn and a big floe hit hard) → the speakers
//
// Positional sounds go through HRTF panners, and the listener rides the camera. One-shots come out
// of a bank of pre-rendered variants (rendered when first wanted, or in idle time just after start),
// played with a little random pitch and level, 24 at most at once. Every parameter moves with
// setTargetAtTime, and update() allocates nothing. Every public method is safe to call before
// start() and never throws. The horror's sounds (guns, creatures, scares, the places' beds, your
// heart) are audio/Horror.js, built on this graph at start and reached as audio.horror.

const MAX_VOICES = 24;
const MUSIC_LEVEL = 0.165;                // (about 18 dB under the outdoor beds)
const VOICE_RMS = 0.11;                   // a recorded line's speech is brought to this level
const ROOM_WET = { engine: 0.6, engine_stair: 0.5, mess: 0.34, galley: 0.34, hall: 0.4, corridor: 0.4, lobby: 0.4, bridge: 0.28, cabin: 0.24 };

// level and range of each named effect (footsteps play 2D unless given a position)
const SFX = {
  step_metal: { gain: 0.42, step: true }, step_grate: { gain: 0.42, step: true },
  step_floor: { gain: 0.36, step: true }, step_ladder: { gain: 0.38, step: true },
  door_open: { gain: 0.6, ref: 1.6 }, door_close: { gain: 0.8, ref: 1.8 }, locked: { gain: 0.55, ref: 1.4 },
  click: { gain: 0.3, ref: 1 }, switch: { gain: 0.42, ref: 1 }, button: { gain: 0.45, ref: 1 },
  telegraph: { gain: 0.5, ref: 2 }, clank: { gain: 0.5, ref: 1.2 }, clunk: { gain: 0.5, ref: 1.2 },
};
const ANIMALS = {
  walrus_grunt: { gain: 0.7, ref: 12, echo: 0 }, walrus_roar: { gain: 0.95, ref: 15, echo: 0.12 },
  penguin_call: { gain: 0.5, ref: 10, echo: 0 }, penguin_alarm: { gain: 0.55, ref: 10, echo: 0 },
};
// rendered in idle time after start, first variants first
const WARM = ['step_metal', 'step_grate', 'step_floor', 'step_ladder', 'door_open', 'door_close', 'click', 'switch',
  'button', 'telegraph', 'clank', 'clunk', 'locked', 'slap', 'crack', 'groan', 'hull_groan', 'hull_creak', 'gull',
  'horn', 'ice_crunch', 'ice_boom', 'ice_scrape', 'engine_start', 'engine_shudder', 'walrus_grunt', 'walrus_roar',
  'penguin_call', 'penguin_alarm', 'chatter', 'crackle', 'boil_loop', 'murmur', 'radio_music'];

const _v = new THREE.Vector3();
const _p = { x: 0, y: 0, z: 0 };
const NO_BOAT = {};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + (b - a) * Math.random();
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const posOf = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? p : null);
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// the waves washing past: three slow swells per side, the sum peaky
function wash(t, ch) {
  const p = ch ? 1.7 : 0;
  const a = 0.5 + 0.5 * Math.sin(t * 0.86 + p), b = 0.5 + 0.5 * Math.sin(t * 0.537 + p * 1.9 + 0.6), d = 0.5 + 0.5 * Math.sin(t * 1.27 + p * 0.7 + 2.1);
  return (a * a * a * 0.55 + b * b * b * b * 0.45 + d * d * 0.25) / 1.25;
}

// rendered variants of each recipe, made when first wanted
class Bank {
  constructor(ctx) { this.ctx = ctx; this.sets = Object.create(null); }

  _set(name) { return this.sets[name] || (this.sets[name] = { list: [], last: -1 }); }

  _render(name, set) {
    const rec = RECIPES[name], sr = Math.min(rec.rate || this.ctx.sampleRate, this.ctx.sampleRate);
    const data = rec.fn(sr, rng(Math.floor(Math.random() * 1e9)));
    const chans = Array.isArray(data) ? data : [data];
    const buf = this.ctx.createBuffer(chans.length, chans[0].length, sr);
    for (let c = 0; c < chans.length; c++) buf.getChannelData(c).set(chans[c]);
    set.list.push(buf);
  }

  get(name) {
    if (!RECIPES[name]) return null;
    const s = this._set(name);
    if (!s.list.length) this._render(name, s);
    let i = Math.floor(Math.random() * s.list.length);
    if (s.list.length > 1 && i === s.last) i = (i + 1) % s.list.length;
    s.last = i;
    return s.list[i];
  }

  // render one more variant if the set isn't full; false when there was nothing to do
  warm(name) {
    const rec = RECIPES[name];
    if (!rec) return false;
    const s = this._set(name);
    if (s.list.length >= rec.n) return false;
    this._render(name, s);
    return true;
  }
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.built = false;
    this.volume = 0.8;
    this.musicOn = true;
    this.music = null;
    this.playing = [];                     // the one-shots sounding now
    this.errs = 0;
    this.t = 0; this.slowT = 0; this.resumeT = 0;
    this.stepSide = 1; this.warmI = 0;
    this.lp = { x: 0, y: 0, z: 0 };        // the listener
    this.lf = { x: 0, y: 0, z: -1 };       // and the way it faces
    this.enginePos = { x: 0, y: 0, z: 0 }; this.hasEngine = false;
    this.bowPos = { x: 0, y: 0, z: 0 }; this.hasBow = false;
    this.cur = { indoor: 0, zone: null, speed: 0, rpm: 0, load: 0, engineOn: false, wind: 0.5, night: 1 };
    this.timers = { ice: rnd(3, 8), hull: rnd(8, 15), gull: rnd(4, 12), slap: 1 };
    this.gust = 0.5; this.gustTo = 0.5; this.gustRate = 0.5; this.gustT = 2;
    this.engState = 'off'; this.engT0 = 0; this.engRate = 0.6; this.engStopRate = 0.6;
    this.engGrace = 0; this.engFadeUntil = 0; this.engStartVoice = null;
    this.radios = Object.create(null); this.radioList = [];
    this.kettleSt = { want: false, obj: null, built: false, sess: null, placed: false };
    this.analysed = new WeakMap();         // recording -> its loudness (playBuffer)
    this.radioVoiceIn = null;
  }

  // ------------------------------------------------------------ the API

  async start() {
    try {
      if (!this.ctx) {
        const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
        if (!AC) return;
        try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
      }
      const ctx = this.ctx;
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        // (resume() waits for a user gesture; don't hold the game up if it never comes)
        try { await Promise.race([ctx.resume(), new Promise((res) => setTimeout(res, 400))]); } catch (e) { /* resumes later */ }
      }
      if (!this.built) this._build();
    } catch (e) { this._err(e); }
  }

  setVolume(v) {
    try {
      this.volume = clamp(num(+v, this.volume), 0, 1);
      if (this.master) this.master.gain.setTargetAtTime(this.volume * this.volume, this.ctx.currentTime, 0.05);
    } catch (e) { this._err(e); }
  }

  setMusic(on) {
    try {
      this.musicOn = !!on;
      if (this.music) this.music.setOn(this.musicOn);
    } catch (e) { this._err(e); }
  }

  update(dt, s) {
    if (!this.built) return;
    try { this._update(dt, s || NO_BOAT); } catch (e) { this._err(e); }
  }

  sfx(name, worldPos, opts) {
    if (!this.built) return;
    try {
      const def = SFX[name];
      if (!def) return;
      const buf = this.bank.get(name), pos = posOf(worldPos), g = def.gain * num(opts && opts.gain, 1);
      if (def.step) {
        this.stepSide = -this.stepSide;
        this._play(buf, { gain: g * rnd(0.78, 1.05), rate: rnd(0.92, 1.08), pos, ref: 1, roll: 1.5, pan: this.stepSide * 0.07 });
      } else this._play(buf, { gain: g * rnd(0.9, 1.05), rate: rnd(0.96, 1.04), pos, ref: def.ref, roll: 1.2, prio: name === 'telegraph' });
    } catch (e) { this._err(e); }
  }

  horn(worldPos) {
    if (!this.built) return;
    try {
      const buf = this.bank.get('horn'), pos = posOf(worldPos);
      this._play(buf, { pos, ref: 30, roll: 0.6, gain: 0.95, dest: this.outBus, rev: 0.55, echo: 0.6, prio: true });
      // through the steel and the windows, so it's still big inside
      const ind = this.cur.indoor;
      if (ind > 0.05) this._play(buf, { gain: 0.42 * ind, lp: 520, dest: this.inBus, prio: true });
    } catch (e) { this._err(e); }
  }

  radio(id, on, object3D) {
    try {
      id = String(id);
      let st = this.radios[id];
      if (!st) {
        st = this.radios[id] = { id, want: false, obj: null, on: false, built: false, placed: false, srcs: [], nextBurst: 0, duckUntil: 0, mode: id === 'mess' ? 'music' : 'chatter', ph: Math.random() * 10 };
        this.radioList.push(st);
      }
      st.want = !!on;
      if (object3D) st.obj = object3D;
      if (this.built) this._radioApply(st, this.ctx.currentTime);
    } catch (e) { this._err(e); }
  }

  kettle(on, object3D) {
    try {
      const K = this.kettleSt;
      K.want = !!on;
      if (object3D) K.obj = object3D;
      if (this.built) this._kettleApply(this.ctx.currentTime);
    } catch (e) { this._err(e); }
  }

  // the towing winch: a hydraulic motor's hum and whine, its pump's hiss, the line creaking on the
  // drum (level 0 .. 1, every frame while it might be running)
  winch(level, worldPos) {
    if (!this.built) return;
    try {
      const now = this.ctx.currentTime;
      const lv = clamp(num(level, 0), 0, 1);
      if (!this.win) {
        if (lv < 0.01) return;
        const W = {};
        W.out = this._gain(0); W.p = this._panner(4, 1.1);
        W.out.connect(W.p); W.p.connect(this.outBus);
        W.osc = this.ctx.createOscillator(); W.osc.type = 'sawtooth'; W.osc.frequency.value = 40;
        const lp = this._filter('lowpass', 420, 0.9), og = this._gain(0.35);
        W.osc.connect(lp); lp.connect(og); og.connect(W.out); W.osc.start();
        W.whine = this.ctx.createOscillator(); W.whine.type = 'triangle'; W.whine.frequency.value = 520;
        const wg = this._gain(0.02); W.whine.connect(wg); wg.connect(W.out); W.whine.start();
        const hs = this._loop(this.pink, 1.3), hbp = this._filter('bandpass', 2400, 0.8), hg = this._gain(0.1);
        hs.connect(hbp); hbp.connect(hg); hg.connect(W.out);
        const cr = this._loop(this.brown, 0.7), cbp = this._filter('bandpass', 260, 3);
        W.creak = this._gain(0);
        cr.connect(cbp); cbp.connect(W.creak); W.creak.connect(W.out);
        this.win = W;
      }
      const W = this.win;
      const p = posOf(worldPos);
      if (p) this._move(W.p, p.x, p.y, p.z, now);
      W.out.gain.setTargetAtTime(lv * 0.9, now, 0.15);
      W.osc.frequency.setTargetAtTime(36 + lv * 28, now, 0.2);
      W.whine.frequency.setTargetAtTime(400 + lv * 400, now, 0.25);
      W.creak.gain.setTargetAtTime(lv * (0.2 + 0.25 * Math.sin(now * 7.3) ** 2), now, 0.05);
    } catch (e) { this._err(e); }
  }

  engineStart() {
    if (!this.built || !this.eng) return;
    try {
      if (this.engState === 'starting' || (this.engState === 'on' && this.cur.engineOn)) return;
      const now = this.ctx.currentTime;
      this.engState = 'starting'; this.engT0 = now;
      this.engStartVoice = this._play(this.bank.get('engine_start'), { dest: this.eng.inj, gain: 0.95, prio: true });
    } catch (e) { this._err(e); }
  }

  engineStop() {
    if (!this.built || !this.eng) return;
    try {
      if (this.engState === 'off' || this.engState === 'stopping') return;
      const now = this.ctx.currentTime;
      if (this.engState === 'starting' && this.engStartVoice) this._kill(this.engStartVoice, now, 0.15);
      this.engState = 'stopping'; this.engT0 = now; this.engStopRate = this.engRate || 0.6;
      this._play(this.bank.get('engine_shudder'), { dest: this.eng.inj, gain: 0.75, delay: 2.1, prio: true });
    } catch (e) { this._err(e); }
  }

  iceHit(worldPos, strength, big) {
    if (!this.built) return;
    try {
      const pos = posOf(worldPos), s = clamp(num(strength, 0.5), 0, 1);
      if (big) {
        this._play(this.bank.get('ice_crunch'), { pos, ref: 14, roll: 1, gain: 0.55 + 0.45 * s, dest: this.outBus, rev: 0.5, echo: 0.25, rate: rnd(0.9, 1.05), prio: true });
        this._play(this.bank.get('ice_boom'), { pos, ref: 12, roll: 0.8, gain: 0.5 + 0.5 * s, dest: this.inBus, rate: rnd(0.92, 1.06), prio: true });
        if (Math.random() < 0.6) this._hull(rnd(0.6, 1.4), 1.3);
      } else {
        const buf = this.bank.get('ice_scrape'), dur = 0.5 + 1.5 * s, rate = rnd(0.9, 1.1);
        this._play(buf, { pos, ref: 8, roll: 1, gain: 0.3 + 0.45 * s, dest: this.outBus, rev: 0.2, dur, rate, offset: rnd(0, 0.1) });
        // and through the plates, inside
        const ind = this.cur.indoor;
        if (ind > 0.05) this._play(buf, { gain: (0.12 + 0.25 * s) * ind, lp: 600, dest: this.inBus, dur, rate });
      }
    } catch (e) { this._err(e); }
  }

  animal(kind, worldPos) {
    if (!this.built) return;
    try {
      const def = ANIMALS[kind];
      if (!def) return;
      this._play(this.bank.get(kind), { pos: posOf(worldPos), ref: def.ref, roll: 1, gain: def.gain * rnd(0.85, 1.05), dest: this.outBus, air: true, rev: 0.3, echo: def.echo, rate: rnd(0.94, 1.06) });
    } catch (e) { this._err(e); }
  }

  voice(worldPos, seconds) {
    if (!this.built) return;
    try {
      const sec = clamp(num(seconds, 2), 0.3, 30), buf = this.bank.get('murmur'), loop = sec > buf.duration - 0.3;
      this._play(buf, {
        pos: posOf(worldPos), ref: 1.6, roll: 1.3, gain: 0.6, dur: sec, loop, rate: rnd(0.96, 1.04),
        offset: loop ? 0 : rnd(0, Math.max(0, buf.duration - sec - 0.2)),
      });
    } catch (e) { this._err(e); }
  }

  // A recording (a voice line, audio/Voices.js) from a point in the world, levelled to the others.
  // Said inside (o.zone a room) it goes through the onboard bus, darker if you're not in that room;
  // said outside (o.zone null) through the outdoor bus, so the muffle has it when you're in; no
  // position: in your ear. o: { gain, ref, roll, zone, radio (a small loudspeaker), prio }.
  // Returns { duration, done, level() (its loudness now, 0..1, for the lips), move(worldPos),
  // stop(fade) }, or null (no sound yet).
  playBuffer(buffer, worldPos, opts) {
    if (!this.built || !buffer) return null;
    try {
      const o = opts || {}, ctx = this.ctx, pos = posOf(worldPos), a = this._analyse(buffer);
      const outside = pos && o.zone === null, away = pos && typeof o.zone === 'string' && o.zone !== this.cur.zone;
      const v = this._play(buffer, {
        pos, ref: num(o.ref, 1.6), roll: num(o.roll, 1.2), gain: num(o.gain, 1) * a.norm,
        dest: o.radio ? this._radioVoice() : outside ? this.outBus : this.inBus,
        rev: outside ? 0.18 : 0, lp: away ? 1100 : 0, prio: o.prio !== false,
      });
      if (!v) return null;
      const t0 = ctx.currentTime, dur = buffer.duration, env = a.env, rate = a.rate;
      return {
        duration: dur,
        get done() { return v.dead || ctx.currentTime > t0 + dur + 0.05; },
        level() {
          const t = ctx.currentTime - t0;
          return v.dead || t < 0 || t >= dur ? 0 : env[Math.min(env.length - 1, (t * rate) | 0)];
        },
        move: (p) => { const q = posOf(p); if (q && v.p && !v.dead) this._move(v.p, q.x, q.y, q.z, ctx.currentTime); },
        stop: (fade = 0.08) => { if (!v.dead) this._kill(v, ctx.currentTime, fade); },
      };
    } catch (e) { this._err(e); return null; }
  }

  // ------------------------------------------------------------ the graph

  _build() {
    const ctx = this.ctx, sr = ctx.sampleRate, now = ctx.currentTime;
    this.bank = new Bank(ctx);
    this.master = this._gain(this.volume * this.volume);
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -8; lim.knee.value = 8; lim.ratio.value = 12; lim.attack.value = 0.004; lim.release.value = 0.25;
    this.master.connect(lim); lim.connect(ctx.destination);
    // outside, and the muffle when you're not
    this.outBus = this._gain(1);
    this.muffle = this._filter('lowpass', 20000, 0.5);
    this.muffleG = this._gain(1);
    this.outBus.connect(this.muffle); this.muffle.connect(this.muffleG); this.muffleG.connect(this.master);
    this.inBus = this._gain(1); this.inBus.connect(this.master);
    this.musicBus = this._gain(MUSIC_LEVEL); this.musicBus.connect(this.master);
    // the open ice: a long, sparse reverb (its early reflections are the boat's own superstructure)
    this.revIn = this._gain(1);
    const rev = ctx.createConvolver();
    rev.buffer = this._stereo(makeIR(sr, { seconds: 2.5, t60: 2.4, pre: 0.02, f0: 9000, f1: 1200, early: [[0.011, 0.5], [0.019, 0.35], [0.031, 0.3], [0.047, 0.2], [0.083, 0.15]], seed: 11 }));
    const revOut = this._gain(0.9);
    this.revIn.connect(rev); rev.connect(revOut); revOut.connect(this.outBus);
    // the rooms: short and bright (steel walls), fed by the onboard bus while you're inside
    const room = ctx.createConvolver();
    room.buffer = this._stereo(makeIR(sr, { seconds: 0.45, t60: 0.4, pre: 0.003, f0: 10000, f1: 3000, early: [[0.004, 0.6], [0.007, 0.5], [0.011, 0.45], [0.014, 0.4], [0.019, 0.3], [0.026, 0.25]], seed: 12 }));
    this.roomSend = this._gain(0);
    const roomOut = this._gain(0.8);
    this.inBus.connect(this.roomSend); this.roomSend.connect(room); room.connect(roomOut); roomOut.connect(this.master);
    // and a little of the open air for what happens out on deck
    this.deckSend = this._gain(0.12);
    this.inBus.connect(this.deckSend); this.deckSend.connect(this.revIn);
    this._buildEcho();
    // noise, made once and shared (each bed reads it from its own offset)
    this.white = this._mono(noise(sr, 4, 'white', 11), sr);
    this.pink = this._mono(noise(sr, 8, 'pink', 12), sr);
    this.brown = this._mono(noise(sr, 6, 'brown', 13), sr);
    this.wob = this._mono(wobble(8000, 8, 5), 8000);
    // the beds come up over three seconds
    this.bedOut = this._gain(0); this.bedOut.connect(this.outBus);
    this.bedIn = this._gain(0); this.bedIn.connect(this.inBus);
    for (const g of [this.bedOut, this.bedIn]) { g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 3); }
    this._buildWind();
    this._buildSea();
    this._buildEngine();
    this.horror = new HorrorAudio(this);
    this.built = true;
    for (const st of this.radioList) this._radioApply(st, now);
    if (this.kettleSt.want) this._kettleApply(now);
    // (the grinding ice and the score a moment later, so the click that starts the game doesn't stall)
    setTimeout(() => this._safe(() => this._buildIce()), 60);
    setTimeout(() => this._safe(() => { this.music = new Music(ctx, this.musicBus); this.music.setOn(this.musicOn); }), 120);
    setTimeout(() => this._warm(), 400);
  }

  // The ice field throws a sound back: two long delays (left and right) feeding back through a
  // lowpass, so each repeat is darker and softer, and a little into the reverb to blur them.
  _buildEcho() {
    const ctx = this.ctx;
    this.echoIn = this._gain(1);
    const hp = this._filter('highpass', 140, 0.7), lp = this._filter('lowpass', 2400, 0.7);
    this.echoIn.connect(hp); hp.connect(lp);
    const merger = ctx.createChannelMerger(2), out = this._gain(0.8), blur = this._gain(0.25);
    for (const [time, fb, ch] of [[0.71, 0.36, 0], [1.13, 0.33, 1]]) {
      const d = ctx.createDelay(3), f = this._filter('lowpass', 1600, 0.6), g = this._gain(fb);
      d.delayTime.value = time;
      lp.connect(d); d.connect(f); f.connect(g); g.connect(d);
      f.connect(merger, 0, ch);
    }
    merger.connect(out); out.connect(this.outBus); out.connect(blur); blur.connect(this.revIn);
  }

  // Wind: two decorrelated bands of pink noise (left, right) whose cutoff and level follow the
  // gusts, a howl (a resonant band that rises with them), buffeting on your hood (outside only),
  // and three whistles in the rigging (narrow bands of white noise, Aeolian tones that climb with the
  // wind's speed) that only sing in the stronger gusts.
  _buildWind() {
    const W = this.windB = { lp: [], g: [], wh: [] };
    W.out = this._gain(1); W.out.connect(this.bedOut);
    const mg = this.ctx.createChannelMerger(2);
    mg.connect(W.out);
    for (let c = 0; c < 2; c++) {
      const s = this._loop(this.pink, 1.3 + c * 2.1), lp = this._filter('lowpass', 600, 0.4), g = this._gain(0);
      s.connect(lp); lp.connect(g); g.connect(mg, 0, c);
      W.lp.push(lp); W.g.push(g);
    }
    const hs = this._loop(this.pink, 4.4);
    W.howl = this._filter('bandpass', 400, 2.2); W.howlG = this._gain(0);
    hs.connect(W.howl); W.howl.connect(W.howlG); W.howlG.connect(W.out);
    const bs = this._loop(this.brown, 2.2), bl = this._filter('lowpass', 110, 0.6);
    W.bufG = this._gain(0);
    bs.connect(bl); bl.connect(W.bufG); W.bufG.connect(W.out);
    const ws = this._loop(this.white, 0.7);
    for (const [f, pan] of [[610, -0.55], [905, 0.4], [1340, 0.1]]) {
      const bp = this._filter('bandpass', f, 38), g = this._gain(0), p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      ws.connect(bp); bp.connect(g); g.connect(p); p.connect(W.out);
      W.wh.push({ f, bp, g, ph: Math.random() * 6 });
    }
  }

  // Sea: the wash along both sides (bands of pink noise swelling with slow wave cycles, brighter at
  // each peak), the low rush of water along the hull with speed, and the bow wave out at the bow: a
  // hiss of spray and a lower rush, both with the boat's speed.
  _buildSea() {
    const S = this.sea = { g: [], bp: [] };
    S.out = this._gain(1); S.out.connect(this.bedOut);
    const mg = this.ctx.createChannelMerger(2);
    mg.connect(S.out);
    for (let c = 0; c < 2; c++) {
      const s = this._loop(this.pink, 0.4 + c * 2.2), bp = this._filter('bandpass', 500, 0.55), g = this._gain(0);
      s.connect(bp); bp.connect(g); g.connect(mg, 0, c);
      S.g.push(g); S.bp.push(bp);
    }
    const rs = this._loop(this.brown, 3.7), rl = this._filter('lowpass', 170, 0.6);
    S.rumG = this._gain(0);
    rs.connect(rl); rl.connect(S.rumG); S.rumG.connect(S.out);
    S.bowP = this._panner(8, 1); S.bowP.connect(this.bedOut);
    const hs = this._loop(this.pink, 5.3), hh = this._filter('highpass', 900, 0.6), pk = this._filter('peaking', 2600, 0.8, 5);
    S.hissG = this._gain(0);
    hs.connect(hh); hh.connect(pk); pk.connect(S.hissG); S.hissG.connect(S.bowP);
    const us = this._loop(this.pink, 6.9), ub = this._filter('bandpass', 420, 0.9);
    S.rushG = this._gain(0);
    us.connect(ub); ub.connect(S.rushG); S.rushG.connect(S.bowP);
  }

  // The floes grinding along the hull while she pushes ice: at the bow outside, and low through the
  // plates when you're in.
  _buildIce() {
    const I = {};
    I.src = this._loop(this.bank.get('grind_loop'), Math.random() * 5);
    I.g = this._gain(0); I.p = this._panner(7, 1);
    I.src.connect(I.g); I.g.connect(I.p); I.p.connect(this.bedOut);
    const lp = this._filter('lowpass', 380, 0.6);
    I.sg = this._gain(0);
    I.src.connect(lp); lp.connect(I.sg); I.sg.connect(this.bedIn);
    this.iceB = I;
  }

  // The main engine. The rendered loop (24 firings of a six-cylinder diesel) plays faster or slower
  // with the revs, under sines on the firing orders and a turbo's whine. A state gain carries the
  // start and the stop; the start and stop one-shots join after it, so they're placed and muffled
  // like the engine. Then three ways to hear it: through the air in the engine room (positional,
  // bright), through the structure everywhere aboard (low, 2D), and from the funnel outside.
  _buildEngine() {
    const E = {};
    E.src = this._loop(this.bank.get('engine_loop'), 0);
    E.src.playbackRate.value = 0.6;
    E.pre = this._gain(1);
    E.src.connect(E.pre);
    E.osc = [];
    for (const [h, level] of [[4, 0.06], [8, 0.03], [12, 0.015]]) {
      const o = this.ctx.createOscillator(), g = this._gain(level);
      o.frequency.value = 6 * h;
      o.connect(g); g.connect(E.pre); o.start();
      E.osc.push({ o, h });
    }
    const ts = this._loop(this.white, 2.1);
    E.tbp = this._filter('bandpass', 1500, 14); E.tg = this._gain(0);
    ts.connect(E.tbp); E.tbp.connect(E.tg); E.tg.connect(E.pre);
    E.tosc = this.ctx.createOscillator(); E.tosc.frequency.value = 1500;
    E.tog = this._gain(0);
    E.tosc.connect(E.tog); E.tog.connect(E.pre); E.tosc.start();
    E.state = this._gain(0);
    E.pre.connect(E.state);
    E.shelf = this._filter('lowshelf', 110, 0.7, 0);
    E.state.connect(E.shelf);
    E.inj = this._gain(1); E.inj.connect(E.shelf);
    E.lp = this._filter('lowpass', 1500, 0.6); E.air = this._gain(0); E.p = this._panner(6, 1.2);
    E.shelf.connect(E.lp); E.lp.connect(E.air); E.air.connect(E.p); E.p.connect(this.bedIn);
    E.slp = this._filter('lowpass', 130, 0.7); E.struct = this._gain(0);
    E.shelf.connect(E.slp); E.slp.connect(E.struct); E.struct.connect(this.bedIn);
    E.xlp = this._filter('lowpass', 360, 0.7); E.exh = this._gain(0); E.xp = this._panner(10, 1);
    E.shelf.connect(E.xlp); E.xlp.connect(E.exh); E.exh.connect(E.xp); E.xp.connect(this.bedOut);
    this.eng = E;
  }

  // ------------------------------------------------------------ every frame

  _update(dt, s) {
    const ctx = this.ctx, now = ctx.currentTime;
    dt = clamp(num(dt, 0.016), 0, 0.25);
    this.t += dt;
    if (ctx.state === 'suspended' && this.t - this.resumeT > 2) { this.resumeT = this.t; ctx.resume().catch(() => {}); }
    const c = this.cur, b = s.boat || NO_BOAT;
    c.indoor = clamp(num(s.indoor, 0), 0, 1);
    c.zone = typeof s.zone === 'string' ? s.zone : null;
    c.speed = clamp(num(b.speed, 0), 0, 10);
    c.rpm = clamp(num(b.rpm, 0), 0, 1);
    c.load = clamp(num(b.load, 0), 0, 1);
    c.engineOn = !!b.engineOn;
    c.wind = clamp(num(s.wind, 0.5), 0, 1);
    c.night = clamp(num(s.night, 1), 0, 1);
    if (s.camera) this._listen(s.camera, now);
    const ep = posOf(s.enginePos), bp = posOf(s.bowPos);
    if (ep) { this.enginePos.x = ep.x; this.enginePos.y = ep.y; this.enginePos.z = ep.z; this.hasEngine = true; }
    if (bp) { this.bowPos.x = bp.x; this.bowPos.y = bp.y; this.bowPos.z = bp.z; this.hasBow = true; }
    this._placeBeds(now);
    for (let i = 0; i < this.radioList.length; i++) this._radioFrame(this.radioList[i], now);
    this._kettlePlace(now, false);
    this.slowT += dt;
    if (this.slowT >= 0.05) { const sdt = this.slowT; this.slowT = 0; this._slow(now, sdt); }
    this._events(dt);
    if (this.music) this.music.update(now);
    if (this.horror) this.horror.update(dt, s);
  }

  // the listener rides the camera: its position, its forward (-Z) and its up (+Y)
  _listen(cam, now) {
    const m = cam.matrixWorld && cam.matrixWorld.elements;
    if (!m) return;
    const x = m[12], y = m[13], z = m[14];
    let fx = -m[8], fy = -m[9], fz = -m[10], ux = m[4], uy = m[5], uz = m[6];
    const fl = Math.hypot(fx, fy, fz), ul = Math.hypot(ux, uy, uz);
    if (!(fl > 1e-6) || !(ul > 1e-6) || !Number.isFinite(x + y + z)) return;
    fx /= fl; fy /= fl; fz /= fl; ux /= ul; uy /= ul; uz /= ul;
    this.lp.x = x; this.lp.y = y; this.lp.z = z;
    this.lf.x = fx; this.lf.y = fy; this.lf.z = fz;
    const L = this.ctx.listener;
    if (L.positionX) {
      const tc = 0.015;
      L.positionX.setTargetAtTime(x, now, tc); L.positionY.setTargetAtTime(y, now, tc); L.positionZ.setTargetAtTime(z, now, tc);
      L.forwardX.setTargetAtTime(fx, now, tc); L.forwardY.setTargetAtTime(fy, now, tc); L.forwardZ.setTargetAtTime(fz, now, tc);
      L.upX.setTargetAtTime(ux, now, tc); L.upY.setTargetAtTime(uy, now, tc); L.upZ.setTargetAtTime(uz, now, tc);
    } else {
      L.setPosition(x, y, z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // the beds that sit somewhere: the engine (and its funnel above), the bow wave and the grinding
  _placeBeds(now) {
    const L = this.lp, E = this.eng;
    if (E) {
      const e = this.enginePos, has = this.hasEngine;
      const x = has ? e.x : L.x, y = has ? e.y : L.y - 3, z = has ? e.z : L.z;
      this._move(E.p, x, y, z, now);
      this._move(E.xp, x, y + 9, z, now);
    }
    const b = this.bowPos, hb = this.hasBow;
    const bx = hb ? b.x : L.x + this.lf.x * 15, by = hb ? b.y : 0, bz = hb ? b.z : L.z + this.lf.z * 15;
    this._move(this.sea.bowP, bx, by, bz, now);
    if (this.iceB) this._move(this.iceB.p, bx, by, bz, now);
  }

  // twenty times a second: the slow controls of the beds
  _slow(now, dt) {
    const c = this.cur, ind = c.indoor, t = this.t, w = c.wind, sp = clamp(c.speed / 7, 0, 1);
    // inside and out
    this.muffle.frequency.setTargetAtTime(Math.min(this.ctx.sampleRate * 0.45, 20000 * Math.pow(600 / 20000, ind)), now, 0.15);
    this.muffleG.gain.setTargetAtTime(Math.pow(10, (-10 * ind) / 20), now, 0.15);
    this.roomSend.gain.setTargetAtTime(c.zone ? (ROOM_WET[c.zone] ?? 0.32) : 0.32 * ind, now, 0.2);
    this.deckSend.gain.setTargetAtTime(c.zone ? 0 : 0.12 * (1 - ind), now, 0.2);

    // the gusts: a new target every few seconds, approached at its own pace, with a flutter on top
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = rnd(1.5, 6); this.gustTo = Math.pow(Math.random(), 0.8); this.gustRate = rnd(0.25, 0.9); }
    this.gust += (this.gustTo - this.gust) * (1 - Math.exp(-this.gustRate * dt));
    const G = clamp(w * (0.3 + 0.8 * this.gust + 0.08 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 2.9 + 1)), 0, 1.2);
    const W = this.windB, lvl = 0.12 + 0.55 * Math.pow(G, 1.3);
    for (let k = 0; k < 2; k++) {
      W.lp[k].frequency.setTargetAtTime((260 + 1300 * G) * (1 + 0.12 * Math.sin(t * (0.37 + k * 0.21) + k)), now, 0.25);
      W.g[k].gain.setTargetAtTime(lvl * (1 + 0.15 * Math.sin(t * (0.21 + k * 0.13) + k * 2)), now, 0.25);
    }
    W.howl.frequency.setTargetAtTime(260 + 420 * G, now, 0.3);
    W.howlG.gain.setTargetAtTime(G * G, now, 0.3);
    W.bufG.gain.setTargetAtTime((1 - ind) * 0.35 * G * (0.6 + 0.4 * Math.sin(t * 7.3) * Math.sin(t * 3.1)), now, 0.05);
    for (let k = 0; k < W.wh.length; k++) {
      const h = W.wh[k], on = smoothstep(0.5 + 0.1 * k, 0.95, G) * (0.6 + 0.4 * Math.sin(t * (0.5 + 0.3 * k) + h.ph));
      h.g.gain.setTargetAtTime(on * 3.2, now, 0.2);
      h.bp.frequency.setTargetAtTime(h.f * (0.82 + 0.36 * G) * (1 + 0.01 * Math.sin(t * (1.3 + k) + h.ph)), now, 0.2);
    }

    // the sea
    const S = this.sea;
    for (let k = 0; k < 2; k++) {
      const e = wash(t, k);
      S.g[k].gain.setTargetAtTime((0.15 + 0.35 * e) * (0.7 + 0.5 * w) * (1 + 0.4 * sp), now, 0.3);
      S.bp[k].frequency.setTargetAtTime(320 + 900 * e, now, 0.3);
    }
    S.rumG.gain.setTargetAtTime(0.04 + 0.22 * sp, now, 0.4);
    const spray = 0.7 + 0.3 * Math.sin(t * 0.83) * Math.sin(t * 0.37 + 1);
    S.hissG.gain.setTargetAtTime(0.42 * Math.pow(sp, 1.4) * spray, now, 0.2);
    S.rushG.gain.setTargetAtTime(0.7 * Math.pow(sp, 1.2) * (0.8 + 0.2 * spray), now, 0.25);

    // the ice under the bow
    const I = this.iceB;
    if (I) {
      I.g.gain.setTargetAtTime(c.load * 0.9 * (0.6 + 0.4 * sp), now, 0.15);
      I.sg.gain.setTargetAtTime(c.load * 0.5 * ind, now, 0.2);
      I.src.playbackRate.setTargetAtTime(0.85 + 0.3 * sp, now, 0.3);
    }

    this._engineCtl(now);
    for (let i = 0; i < this.radioList.length; i++) this._radioSlow(this.radioList[i], now);
  }

  // The engine's state: off, starting (the start one-shot, then the loop comes in under its last
  // firings with a little overshoot), on (the revs follow rpm: 6 Hz firing at idle to 14 Hz full),
  // stopping (the fuel's cut: it runs down over three seconds). If the boat says the engine is on
  // without a start (the voyage begins under way), it simply fades up.
  _engineCtl(now) {
    const E = this.eng;
    if (!E) return;
    const c = this.cur;
    if (this.engState === 'off' && c.engineOn) { this.engState = 'on'; this.engFadeUntil = now + 3; this.engGrace = now + 1; }
    else if (this.engState === 'on' && !c.engineOn && now > this.engGrace) this.engineStop();
    else if (this.engState === 'starting' && now > this.engT0 + 2.9) { this.engState = 'on'; this.engGrace = now + 2; this.engStartVoice = null; }
    else if (this.engState === 'stopping' && now > this.engT0 + 3.4) this.engState = 'off';
    const rpmN = clamp((c.rpm - 0.25) / 0.75, 0, 1);
    let rate = this.engRate, g = 0, tc = 0.06;
    if (this.engState === 'on') {
      rate = ((6 + 8 * rpmN) / ENGINE_F0) * (1 - 0.035 * c.load);
      g = 1;
      tc = now < this.engFadeUntil ? 1 : 0.1;
    } else if (this.engState === 'starting') {
      const u = now - this.engT0;
      rate = 0.6 * (1 + 0.3 * Math.exp(-Math.max(0, u - 2.2) / 0.4));
      g = u < 2.2 ? 0 : Math.min(1, (u - 2.2) / 0.35);
    } else if (this.engState === 'stopping') {
      const u = now - this.engT0;
      rate = 0.1 + (this.engStopRate - 0.1) * Math.exp(-u / 0.9);
      g = u > 3.1 ? 0 : Math.exp(-u / 1.1);
    }
    this.engRate = rate;
    E.src.playbackRate.setTargetAtTime(rate, now, 0.08);
    for (let i = 0; i < E.osc.length; i++) E.osc[i].o.frequency.setTargetAtTime(rate * ENGINE_F0 * E.osc[i].h, now, 0.08);
    E.state.gain.setTargetAtTime(g, now, tc);
    // the turbo spins up with the revs and the load
    const rn = clamp((rate * ENGINE_F0 - 6) / 8, 0, 1), tf = 1200 + 2600 * rn;
    E.tbp.frequency.setTargetAtTime(tf, now, 0.15);
    E.tosc.frequency.setTargetAtTime(tf, now, 0.15);
    E.tg.gain.setTargetAtTime(0.5 * (0.15 + rn) * (1 + c.load), now, 0.2);
    E.tog.gain.setTargetAtTime(0.004 * (0.2 + rn) * (1 + c.load), now, 0.2);
    E.shelf.gain.setTargetAtTime(c.load * 7, now, 0.3);
    // where you are: in the engine room it's loud and bright; elsewhere below decks a low hum through
    // the steel; outside, mostly the funnel
    const z = c.zone, ind = c.indoor;
    let air, lp, st, ex;
    if (z === 'engine') { air = 1.5; lp = 1500; st = 0.45; ex = 0.03; }
    else if (z === 'engine_stair') { air = 0.8; lp = 950; st = 0.4; ex = 0.06; }
    else { air = lerp(0.05, 0.05, ind); lp = lerp(420, 300, ind); st = lerp(0.16, 0.26, ind); ex = lerp(0.42, 0.08, ind); }
    E.lp.frequency.setTargetAtTime(lp * (0.7 + 0.6 * rn + 0.4 * c.load), now, 0.2);
    E.air.gain.setTargetAtTime(air, now, 0.25);
    E.struct.gain.setTargetAtTime(st, now, 0.25);
    E.exh.gain.setTargetAtTime(ex, now, 0.25);
  }

  // now-and-then sounds around you: distant ice, the hull, gulls, waves against the side
  _events(dt) {
    const T = this.timers, c = this.cur, busy = this.playing.length > MAX_VOICES - 6;
    if ((T.ice -= dt) <= 0) { T.ice = rnd(5, 25); if (!busy) this._iceFar(); }
    if ((T.hull -= dt) <= 0) { T.hull = rnd(10, 30); if (!busy) this._hull(0, 1); }
    if ((T.gull -= dt) <= 0) { T.gull = rnd(6, 24) / Math.max(0.2, 1 - c.night * 0.8); if (!busy) this._gull(); }
    if ((T.slap -= dt) <= 0) {
      const sp = clamp(c.speed / 7, 0, 1);
      T.slap = rnd(0.7, 3.2) / (0.7 + sp * 0.9);
      if (!busy) this._slap(sp);
    }
  }

  // a crack (sharp, echoing) or a groan of the pack, 100 to 600 m off
  _iceFar() {
    const a = Math.random() * Math.PI * 2, d = rnd(100, 600);
    _p.x = this.lp.x + Math.cos(a) * d; _p.y = rnd(-1, 2); _p.z = this.lp.z + Math.sin(a) * d;
    if (Math.random() < 0.68) this._play(this.bank.get('crack'), { pos: _p, ref: 60, roll: 1, gain: rnd(0.55, 1), dest: this.outBus, air: true, rev: 0.9, echo: 0.3, rate: rnd(0.85, 1.15) });
    else this._play(this.bank.get('groan'), { pos: _p, ref: 70, roll: 1, gain: rnd(0.55, 0.9), dest: this.outBus, air: true, rev: 0.75, echo: 0.15, rate: rnd(0.8, 1.1) });
  }

  // the hull flexing somewhere near you (louder under way, pushing ice, and inside)
  _hull(delay, boost) {
    const a = Math.random() * Math.PI * 2, d = rnd(2, 8), c = this.cur;
    _p.x = this.lp.x + Math.cos(a) * d; _p.y = this.lp.y + rnd(-2.5, 0.5); _p.z = this.lp.z + Math.sin(a) * d;
    const groan = Math.random() < 0.55, sp = clamp(c.speed / 7, 0, 1);
    const lvl = (groan ? 0.55 : 0.4) * (0.55 + 0.3 * sp + 0.4 * c.load) * (0.5 + 0.5 * c.indoor) * boost;
    this._play(this.bank.get(groan ? 'hull_groan' : 'hull_creak'), { pos: _p, ref: 4, roll: 1, gain: lvl, dest: this.inBus, rate: rnd(0.85, 1.15), delay });
  }

  _gull() {
    const a = Math.random() * Math.PI * 2, d = rnd(40, 220);
    _p.x = this.lp.x + Math.cos(a) * d; _p.y = rnd(8, 40); _p.z = this.lp.z + Math.sin(a) * d;
    this._play(this.bank.get('gull'), { pos: _p, ref: 15, roll: 1, gain: rnd(0.4, 0.75), dest: this.outBus, air: true, rev: 0.45, rate: rnd(0.92, 1.08) });
  }

  // a wave against the hull a few metres off, at the waterline
  _slap(sp) {
    const a = Math.random() * Math.PI * 2, d = rnd(4.5, 9);
    _p.x = this.lp.x + Math.cos(a) * d; _p.y = 0.3; _p.z = this.lp.z + Math.sin(a) * d;
    this._play(this.bank.get('slap'), { pos: _p, ref: 5, roll: 1, gain: rnd(0.3, 0.6) * (0.6 + 0.4 * this.cur.wind) * (0.8 + 0.4 * sp), dest: this.outBus, rev: 0.15, rate: rnd(0.85, 1.15) });
  }

  // ------------------------------------------------------------ the radios

  // static (band-limited hiss and crackle) and a small, overdriven speaker for the voices and the
  // music; the whole radio sits on its object
  _radioBuild(st) {
    st.out = this._gain(0);
    st.p = this._panner(1.2, 1.3);
    st.out.connect(st.p); st.p.connect(this.inBus);
    st.sIn = this._filter('bandpass', 1100, 0.5);
    const shp = this._filter('highpass', 320, 0.7), slp = this._filter('lowpass', 2900, 0.7);
    st.sG = this._gain(0);
    st.sIn.connect(shp); shp.connect(slp); slp.connect(st.sG); st.sG.connect(st.out);
    st.cIn = this._filter('highpass', 900, 0.7);
    st.cG = this._gain(st.mode === 'music' ? 0.07 : 0.16);
    st.cIn.connect(st.cG); st.cG.connect(st.out);
    st.vIn = this._gain(1);
    const vhp = this._filter('highpass', 300, 0.7), vlp = this._filter('lowpass', 3000, 0.7), pk = this._filter('peaking', 1700, 1, 5);
    const sh = this.ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); }
    sh.curve = curve;
    st.vG = this._gain(0.5);
    st.vIn.connect(vhp); vhp.connect(vlp); vlp.connect(sh); sh.connect(pk); pk.connect(st.vG); st.vG.connect(st.out);
    st.mIn = this._gain(0.22); st.mIn.connect(st.vIn);
    st.built = true;
  }

  _radioApply(st, now) {
    if (!st.built) this._radioBuild(st);
    if (st.want && !st.on) {
      st.on = true;
      const w = this._loop(this.white, Math.random() * 3), c = this._loop(this.bank.get('crackle'), Math.random() * 3);
      w.connect(st.sIn); c.connect(st.cIn);
      st.srcs = [w, c];
      if (st.mode === 'music') { const m = this._loop(this.bank.get('radio_music'), Math.random() * 14); m.connect(st.mIn); st.srcs.push(m); }
      st.out.gain.setTargetAtTime(st.mode === 'music' ? 0.32 : 0.6, now, 0.12);   // (the old set warms up; a quiet one)
      st.nextBurst = now + rnd(1.2, 3.5);
    } else if (!st.want && st.on) {
      st.on = false;
      st.out.gain.setTargetAtTime(0, now, 0.015);
      for (const src of st.srcs) { try { src.stop(now + 0.15); } catch (e) { /* stopped */ } }
      st.srcs = [];
    }
    this._radioPlace(st, now);
  }

  _radioPlace(st, now) {
    const o = st.obj;
    if (!o || !st.p) return;
    let p = null;
    if (typeof o.getWorldPosition === 'function') p = o.getWorldPosition(_v);
    else p = posOf(o);
    if (!posOf(p)) return;
    if (!st.placed) { this._place(st.p, p.x, p.y, p.z); st.placed = true; }
    else this._move(st.p, p.x, p.y, p.z, now);
  }

  _radioFrame(st, now) {
    if (!st.on) return;
    this._radioPlace(st, now);
    if (st.mode === 'chatter' && now >= st.nextBurst) {
      const buf = this.bank.get('chatter');
      this._play(buf, { dest: st.vIn, gain: rnd(0.45, 0.65) });
      st.duckUntil = now + buf.duration;
      st.nextBurst = now + buf.duration + rnd(4, 12);
    }
  }

  // the static fades and swells like a far-off band; a transmission pushes it down
  _radioSlow(st, now) {
    if (!st.on) return;
    const t = this.t + st.ph;
    const fade = 0.6 + 0.4 * Math.sin(t * 0.31) * Math.sin(t * 0.17 + 1);
    const base = st.mode === 'music' ? 0.05 : 0.15;
    st.sG.gain.setTargetAtTime(base * fade * (now < st.duckUntil ? 0.45 : 1), now, 0.08);
  }

  // ------------------------------------------------------------ the kettle

  _kettleApply(now) {
    const K = this.kettleSt;
    if (!K.built) {
      K.out = this._gain(1); K.p = this._panner(1, 1.4);
      K.out.connect(K.p); K.p.connect(this.inBus);
      K.built = true;
    }
    this._kettlePlace(now, true);
    if (K.want && !K.sess) this._kettleOn(now);
    else if (!K.want && K.sess) this._kettleOff(now);
  }

  _kettlePlace(now, snap) {
    const K = this.kettleSt, o = K.obj;
    if (!K.built || !o || (!K.sess && !snap)) return;
    const p = typeof o.getWorldPosition === 'function' ? o.getWorldPosition(_v) : posOf(o);
    if (!posOf(p)) return;
    if (!K.placed) { this._place(K.p, p.x, p.y, p.z); K.placed = true; }
    else this._move(K.p, p.x, p.y, p.z, now);
  }

  // a rising boil, then the whistle: two close sines (they beat) with breath noise on the same
  // pitch, sputtering into voice and wavering for as long as it's on
  _kettleOn(now) {
    const ctx = this.ctx, s = { srcs: [], nodes: [] };
    this.kettleSt.sess = s;
    s.g = this._gain(1); s.g.connect(this.kettleSt.out);
    const b = this._loop(this.bank.get('boil_loop'), Math.random() * 4), blp = this._filter('lowpass', 250, 0.7), bg = this._gain(0);
    b.connect(blp); blp.connect(bg); bg.connect(s.g);
    blp.frequency.setValueAtTime(250, now);
    blp.frequency.exponentialRampToValueAtTime(2200, now + 3.5);
    bg.gain.setValueAtTime(0, now);
    bg.gain.setTargetAtTime(0.4, now, 1.1);
    const t0 = now + 2.4, f0 = rnd(1950, 2250);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.frequency.setValueAtTime(f0 * 0.7, t0); o1.frequency.exponentialRampToValueAtTime(f0, t0 + 1.3);
    o2.frequency.setValueAtTime(f0 * 0.7 * 1.012, t0); o2.frequency.exponentialRampToValueAtTime(f0 * 1.012, t0 + 1.3);
    const wob = this._loop(this.wob, Math.random() * 7), d1 = this._gain(f0 * 0.012), d2 = this._gain(f0 * 0.012 * 1.012), d3 = this._gain(f0 * 0.012);
    wob.connect(d1); d1.connect(o1.frequency);
    wob.connect(d2); d2.connect(o2.frequency);
    const n = this._loop(this.white, Math.random() * 3), nbp = this._filter('bandpass', f0, 7), ng = this._gain(0.9);
    wob.connect(d3); d3.connect(nbp.frequency);
    n.connect(nbp); nbp.connect(ng);
    const env = this._gain(0), o2g = this._gain(0.7), wg = this._gain(0.2);
    o1.connect(env); o2.connect(o2g); o2g.connect(env); ng.connect(env); env.connect(wg); wg.connect(s.g);
    // the sputter as the steam finds its voice
    const curve = new Float32Array(64);
    for (let i = 0; i < 64; i++) { const u = i / 63; curve[i] = Math.pow(u, 1.5) * (1 - 0.6 * (1 - u) * Math.abs(Math.sin(u * 23 + Math.random()))); }
    curve[63] = 1;
    env.gain.setValueCurveAtTime(curve, t0, 1.6);
    o1.start(t0); o2.start(t0);
    s.srcs.push(b, wob, n, o1, o2);
  }

  _kettleOff(now) {
    const K = this.kettleSt, s = K.sess;
    if (!s) return;
    K.sess = null;
    s.g.gain.setTargetAtTime(0, now, 0.45);
    for (const src of s.srcs) { try { src.stop(now + 3.5); } catch (e) { /* not started or stopped */ } }
    s.srcs[0].onended = () => { try { s.g.disconnect(); } catch (e) { /* gone */ } };
  }

  // ------------------------------------------------------------ one-shots

  // o: { pos, ref, roll, gain, rate, dest, rev, echo, air (distance lowpass), lp, pan, delay,
  //      dur (play this long, with a fade), loop, offset, prio (don't steal) }
  _play(buf, o) {
    if (!buf) return null;
    const ctx = this.ctx, now = ctx.currentTime, when = now + (o.delay || 0), rate = o.rate || 1;
    this._reap(now);
    if (this.playing.length >= MAX_VOICES) this._steal(now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (o.loop) src.loop = true;
    const g = ctx.createGain(), gain = num(o.gain, 1), nodes = [src, g];
    src.connect(g);
    let tail = g, d = 0;
    const pos = o.pos, dest = o.dest || this.inBus, ref = o.ref || 1;
    if (pos) d = Math.hypot(pos.x - this.lp.x, pos.y - this.lp.y, pos.z - this.lp.z);
    if (o.lp || (o.air && d > 30)) {
      const f = this._filter('lowpass', o.lp || clamp(20000 / (1 + d / 110), 1400, 20000), 0.5);
      tail.connect(f); tail = f; nodes.push(f);
    }
    let panner = null;
    if (pos) {
      const p = panner = this._panner(ref, o.roll ?? 1);
      this._place(p, pos.x, pos.y, pos.z);
      tail.connect(p); p.connect(dest); nodes.push(p);
    } else if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      tail.connect(p); p.connect(dest); nodes.push(p);
    } else tail.connect(dest);
    // far things are mostly reverb
    const wet = pos ? clamp(Math.sqrt(ref / Math.max(d, ref)), 0.12, 1) : 1;
    if (o.rev) { const sg = this._gain(o.rev * wet); tail.connect(sg); sg.connect(this.revIn); nodes.push(sg); }
    if (o.echo) { const sg = this._gain(o.echo * wet); tail.connect(sg); sg.connect(this.echoIn); nodes.push(sg); }
    let len = buf.duration / rate;
    if (o.dur) {
      len = o.dur;
      const fade = Math.min(0.25, len * 0.3);
      g.gain.setValueAtTime(gain, when);
      g.gain.setValueAtTime(gain, when + len - fade);
      g.gain.linearRampToValueAtTime(0, when + len);
      src.start(when, Math.min(o.offset || 0, Math.max(0, buf.duration - 0.05)));
      src.stop(when + len + 0.02);
    } else {
      g.gain.value = gain;
      src.start(when, Math.min(o.offset || 0, Math.max(0, buf.duration - 0.05)));
    }
    const v = { src, g, nodes, p: panner, end: when + len + 0.1, prio: !!o.prio, dead: false };
    src.onended = () => this._free(v);
    this.playing.push(v);
    return v;
  }

  _free(v) {
    if (v.dead) return;
    v.dead = true;
    for (let i = 0; i < v.nodes.length; i++) { try { v.nodes[i].disconnect(); } catch (e) { /* gone */ } }
    const i = this.playing.indexOf(v);
    if (i >= 0) this.playing.splice(i, 1);
  }

  // (onended can go missing; anything well past its end is let go)
  _reap(now) {
    for (let i = this.playing.length - 1; i >= 0; i--) if (now > this.playing[i].end + 1) this._free(this.playing[i]);
  }

  // too many at once: the oldest that isn't important fades out fast
  _steal(now) {
    let k = this.playing.findIndex((v) => !v.prio);
    if (k < 0) k = 0;
    const v = this.playing[k];
    this.playing.splice(k, 1);
    this._kill(v, now, 0.03);
  }

  _kill(v, now, time) {
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(0, now, time / 3);
      v.src.stop(now + time * 2 + 0.02);
    } catch (e) { /* already stopped */ }
  }

  // A recording's loudness, read once: 60 frames a second in dB; its level (the mean power of the
  // frames within 30 dB of its loudest, so the pauses don't count) gives the gain that brings it to
  // VOICE_RMS; each frame's place between 26 dB under the loudest and the loudest is the mouth.
  _analyse(buf) {
    let a = this.analysed.get(buf);
    if (a) return a;
    const sr = buf.sampleRate, hop = Math.max(1, Math.round(sr / 60)), n = Math.max(1, Math.ceil(buf.length / hop));
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s0 = i * hop, s1 = Math.min(buf.length, s0 + hop);
      let sum = 0;
      for (const d of chans) for (let s = s0; s < s1; s++) sum += d[s] * d[s];
      db[i] = 10 * Math.log10(sum / Math.max(1, (s1 - s0) * chans.length) + 1e-12);
    }
    const sorted = Float32Array.from(db).sort();
    const peak = sorted[Math.floor((n - 1) * 0.95)];
    let pw = 0, k = 0;
    for (let i = 0; i < n; i++) if (db[i] > peak - 30) { pw += Math.pow(10, db[i] / 10); k++; }
    const rms = Math.sqrt(pw / Math.max(1, k));
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = Math.pow(clamp((db[i] - peak + 26) / 26, 0, 1), 1.3);
    a = { env, rate: sr / hop, norm: clamp(VOICE_RMS / Math.max(rms, 1e-4), 0.25, 6) };
    this.analysed.set(buf, a);
    return a;
  }

  // the radio's loudspeaker for a recorded voice: telephone band, a little overdrive, into the
  // onboard bus (made when first wanted)
  _radioVoice() {
    if (this.radioVoiceIn) return this.radioVoiceIn;
    const hp = this._filter('highpass', 380, 0.8), lp = this._filter('lowpass', 2900, 0.9), mid = this._filter('peaking', 1700, 1.2, 5);
    const sh = this.ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.6) / Math.tanh(2.6); }
    sh.curve = curve;
    const pre = this._gain(1.6), out = this._gain(0.7);
    hp.connect(lp); lp.connect(mid); mid.connect(pre); pre.connect(sh); sh.connect(out); out.connect(this.inBus);
    this.radioVoiceIn = hp;
    return hp;
  }

  // render the rest of the bank in idle moments, one variant at a time
  _warm() {
    if (!this.ctx) return;
    let did = false;
    try {
      for (let tries = 0; tries < WARM.length && !did; tries++) {
        did = this.bank.warm(WARM[this.warmI % WARM.length]);
        this.warmI++;
      }
    } catch (e) { this._err(e); return; }
    if (!did) return;
    const next = () => this._warm();
    if (typeof requestIdleCallback === 'function') setTimeout(() => requestIdleCallback(next, { timeout: 300 }), 25);
    else setTimeout(next, 30);
  }

  // ------------------------------------------------------------ small helpers

  _gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  _filter(type, f, q = 0.707, db = 0) {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = Math.min(f, this.ctx.sampleRate * 0.49);
    n.Q.value = q;
    if (db) n.gain.value = db;
    return n;
  }

  _panner(ref, roll) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 20000;
    return p;
  }

  _place(p, x, y, z) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else p.setPosition(x, y, z);
  }

  _move(p, x, y, z, now) {
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, now, 0.03); p.positionY.setTargetAtTime(y, now, 0.03); p.positionZ.setTargetAtTime(z, now, 0.03);
    } else p.setPosition(x, y, z);
  }

  _loop(buf, offset) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(this.ctx.currentTime, (offset || 0) % buf.duration);
    s.onended = () => { try { s.disconnect(); } catch (e) { /* gone */ } };
    return s;
  }

  _mono(data, sr) {
    const b = this.ctx.createBuffer(1, data.length, sr);
    b.getChannelData(0).set(data);
    return b;
  }

  _stereo([L, R]) {
    const b = this.ctx.createBuffer(2, L.length, this.ctx.sampleRate);
    b.getChannelData(0).set(L); b.getChannelData(1).set(R);
    return b;
  }

  _safe(fn) { try { if (this.ctx) fn(); } catch (e) { this._err(e); } }

  _err(e) { if (this.errs++ < 8) console.warn('[audio]', e); }
}
