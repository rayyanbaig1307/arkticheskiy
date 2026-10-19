import { makeIR } from './Synth.js';

// The score: very quiet and very slow, so it reads as part of the night rather than as music. A
// drone on D; pads that drift to a new chord every twelve seconds or so (D dorian with its flat-six
// neighbours, wandering, never cadencing); and now and then a single glassy FM bell high up with a
// long tail. Voices swell in over several seconds and die away over more; nothing is a tune. It has
// its own long, dark reverb and sits well under the beds (Audio.js sets the level). setOn() fades
// in or out over about two seconds; while it's off nothing new is scheduled.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + (b - a) * Math.random();
const pick = (a) => a[Math.floor(Math.random() * a.length) % a.length];

// voicings (MIDI), low to high
const CHORDS = {
  i: [50, 57, 64, 65, 69],      // Dm(add9)
  VI: [46, 53, 57, 62, 65],     // Bbmaj7
  IV: [43, 50, 59, 62, 64],     // G6: the dorian colour
  VII: [48, 55, 62, 64, 67],    // Cadd9
  v: [45, 52, 60, 64, 67],      // Am7
  III: [41, 53, 57, 60, 64],    // Fmaj7
};
const NEXT = {
  i: ['VI', 'IV', 'VII', 'III', 'v'], VI: ['i', 'VII', 'III'], IV: ['i', 'VII', 'v'],
  VII: ['i', 'v', 'III'], v: ['i', 'VI', 'IV'], III: ['VI', 'VII', 'i'],
};
const BELLS = [74, 76, 77, 79, 81, 83, 84, 86, 88, 89, 91];

export class Music {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.on = false;
    this.chord = 'i';
    this.nextChord = 0; this.nextBell = 0; this.lfoT = 0;
    this.drone = null;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.g = g;
    this.out = g(0); this.out.connect(out);
    // a long, dark hall
    const [L, R] = makeIR(ctx.sampleRate, { seconds: 3.6, t60: 3.4, pre: 0.03, f0: 6000, f1: 700, seed: 21 });
    const ir = ctx.createBuffer(2, L.length, ctx.sampleRate);
    ir.getChannelData(0).set(L); ir.getChannelData(1).set(R);
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    this.wet = g(0.8); this.verb.connect(this.wet); this.wet.connect(this.out);
    this.dry = g(0.5); this.dry.connect(this.out);
    this.send = g(1); this.send.connect(this.verb);
    // the pads share one slowly breathing lowpass
    this.padLP = ctx.createBiquadFilter();
    this.padLP.type = 'lowpass'; this.padLP.frequency.value = 850; this.padLP.Q.value = 0.3;
    this.pads = g(1); this.pads.connect(this.padLP);
    this.padLP.connect(this.dry); this.padLP.connect(this.send);
    // a soft pad timbre: a few harmonics falling away fast
    const imag = new Float32Array([0, 1, 0.42, 0.2, 0.09, 0.05, 0.025]);
    this.wave = ctx.createPeriodicWave(new Float32Array(imag.length), imag);
  }

  setOn(on) {
    on = !!on;
    const now = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(on ? 1 : 0, now, on ? 0.6 : 0.5);
    if (on && !this.on) {
      this._startDrone(now);
      this.nextChord = now + 0.2;
      this.nextBell = now + rnd(6, 12);
    } else if (!on && this.on) this._stopDrone(now + 2.6);
    this.on = on;
  }

  update(now) {
    if (!this.on) return;
    if (now >= this.nextChord) { this._chord(now + 0.05); this.nextChord = now + rnd(10.5, 13.5); }
    if (now >= this.nextBell) { if (Math.random() < 0.75) this._bell(now + 0.05); this.nextBell = now + rnd(7, 19); }
    if (now - this.lfoT > 0.5) {
      this.lfoT = now;
      this.padLP.frequency.setTargetAtTime(760 + 300 * Math.sin(now * 0.05) + 140 * Math.sin(now * 0.13 + 1), now, 1.2);
    }
  }

  _osc(type, f, t) {
    const o = this.ctx.createOscillator();
    if (type === 'pad') o.setPeriodicWave(this.wave); else o.type = type;
    o.frequency.value = f;
    o.start(t);
    return o;
  }

  // D2 and its fifth, breathing very slowly
  _startDrone(t) {
    this._stopDrone(t);
    const d = { g: this.g(0), oscs: [], parts: [] };
    d.g.connect(this.padLP);
    d.g.gain.setValueAtTime(0, t);
    d.g.gain.setTargetAtTime(1, t, 2.5);
    for (const [m, level, type] of [[38, 0.075, 'sine'], [38.06, 0.04, 'triangle'], [45, 0.03, 'sine'], [50, 0.016, 'pad']]) {
      const o = this._osc(type, mtof(m), t), vg = this.g(level);
      // its own slow swell, a different speed for each
      const lfo = this._osc('sine', rnd(0.03, 0.08), t), depth = this.g(level * 0.35);
      lfo.connect(depth); depth.connect(vg.gain);
      o.connect(vg); vg.connect(d.g);
      d.oscs.push(o, lfo); d.parts.push(vg, depth);
    }
    this.drone = d;
  }

  _stopDrone(t) {
    const d = this.drone;
    if (!d) return;
    this.drone = null;
    const now = this.ctx.currentTime;
    d.g.gain.setTargetAtTime(0, Math.max(now, t - 2.5), 0.6);
    for (const o of d.oscs) { try { o.stop(t); } catch (e) { /* already stopped */ } }
    d.oscs[0].onended = () => { for (const n of [...d.oscs, ...d.parts, d.g]) { try { n.disconnect(); } catch (e) { /* gone */ } } };
  }

  // the next chord: each note two slightly detuned pad oscillators, a five-second swell, held,
  // then a long release under the next chord
  _chord(t) {
    const name = pick(NEXT[this.chord]);
    this.chord = name;
    const notes = CHORDS[name], skip = Math.random() < 0.5 ? Math.floor(Math.random() * notes.length) : -1;
    for (let i = 0; i < notes.length; i++) {
      if (i === skip) continue;
      const m = notes[i], f = mtof(m), level = (m < 50 ? 0.042 : 0.034) * rnd(0.8, 1.1);
      const vg = this.g(0);
      vg.connect(this.pads);
      vg.gain.setValueAtTime(0, t);
      vg.gain.setTargetAtTime(level, t + rnd(0, 1.5), 2);
      vg.gain.setTargetAtTime(0, t + 11.5, 2.4);
      const c = rnd(3, 7), a = this._osc('pad', f * Math.pow(2, c / 1200), t), b = this._osc('pad', f * Math.pow(2, -c / 1200), t);
      a.connect(vg); b.connect(vg);
      a.stop(t + 24); b.stop(t + 24);
      a.onended = () => { try { a.disconnect(); b.disconnect(); vg.disconnect(); } catch (e) { /* gone */ } };
    }
  }

  // a glass bell: FM with an inharmonic ratio, the brightness dying faster than the tone
  _bell(t) {
    const tones = CHORDS[this.chord].map((m) => m % 12);
    const choice = BELLS.filter((m) => tones.includes(m % 12));
    const f = mtof(pick(choice.length ? choice : BELLS)), ratio = pick([3.5, 2.76, 4.2]);
    const car = this._osc('sine', f, t), mod = this._osc('sine', f * ratio, t);
    const mg = this.g(0), ag = this.g(0), pan = this.ctx.createStereoPanner(), dry = this.g(0.35), wet = this.g(0.9);
    pan.pan.value = rnd(-0.6, 0.6);
    mod.connect(mg); mg.connect(car.frequency);
    mg.gain.setValueAtTime(f * rnd(1.5, 2.6), t);
    mg.gain.setTargetAtTime(0, t, 0.5);
    car.connect(ag); ag.connect(pan); pan.connect(dry); pan.connect(wet);
    dry.connect(this.dry); wet.connect(this.send);
    const level = rnd(0.018, 0.03);
    ag.gain.setValueAtTime(0, t);
    ag.gain.linearRampToValueAtTime(level, t + 0.004);
    ag.gain.setTargetAtTime(0, t + 0.004, 1.4);
    car.stop(t + 9); mod.stop(t + 9);
    car.onended = () => { for (const n of [car, mod, mg, ag, pan, dry, wet]) { try { n.disconnect(); } catch (e) { /* gone */ } } };
    // sometimes an answer, softer, a fifth or an octave above
    if (Math.random() < 0.3 && this.on) {
      const later = t + rnd(0.5, 1.2), up = pick([7, 12]);
      setTimeout(() => { if (this.on) this._echoBell(later, f * Math.pow(2, up / 12), level * 0.5); }, Math.max(0, (later - this.ctx.currentTime - 0.1) * 1000));
    }
  }

  _echoBell(t, f, level) {
    t = Math.max(t, this.ctx.currentTime + 0.02);
    const car = this._osc('sine', f, t), mod = this._osc('sine', f * 3.5, t);
    const mg = this.g(0), ag = this.g(0), wet = this.g(1);
    mod.connect(mg); mg.connect(car.frequency);
    mg.gain.setValueAtTime(f * 1.2, t);
    mg.gain.setTargetAtTime(0, t, 0.4);
    car.connect(ag); ag.connect(wet); wet.connect(this.send);
    ag.gain.setValueAtTime(0, t);
    ag.gain.linearRampToValueAtTime(level, t + 0.004);
    ag.gain.setTargetAtTime(0, t + 0.004, 1.2);
    car.stop(t + 8); mod.stop(t + 8);
    car.onended = () => { for (const n of [car, mod, mg, ag, wet]) { try { n.disconnect(); } catch (e) { /* gone */ } } };
  }
}
