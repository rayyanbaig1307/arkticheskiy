import * as THREE from 'three';
import { rng, makeIR, babble } from './Synth.js';

// The horror's sound: the guns and their foley, the things in the dark, the scares, the beds of the
// places you go, your own heart and breath. Like the rest of the game's sound it is all made from
// numbers, the same way audio/Synth.js makes the boat's: modal banks for anything struck (a bolt,
// a casing, a blast door), stick-slip friction for anything dragged or creaking, formant voices for
// the creatures (a glottal pulse through four resonators, period-doubled and chopped into rattles
// for the Turned, huge and slow for the bears, whispered noise for the Shades, a real babble read
// back at the wrong speed for the mimic), and shaped noise for the rest.
//
//   recipes      (sampleRate, random) -> Float32Array or [left, right], pure, testable anywhere;
//                the first variant of each rendered in idle time after start (or when first
//                wanted), the other few only for what actually gets played
//   one-shots    played through Audio.js's pool (its voice cap and stealing), positional ones
//                through HRTF panners, each sent to the reverb of where you are: the open ice
//                (Audio's), a hard little room, Object 7's concrete, the ice cave
//   guns         a dry shot (the crack, the blast, the gun's own action, the ground's reflection);
//                outdoors a long rolling echo off the ice and the cap (a rendered impulse
//                response of discrete slaps and a thunder-like roll), indoors a short hard room
//   near bus     heartbeat, breathing, the dread drone, the chase: in your head, never muffled
//   stingers     their own dark hall, straight to the master; the music ducks under them
//   beds         one per place, crossfaded by setAmbience; each a rendered loop and its own
//                now-and-then events around you; the blizzard is a live layer of resonant wind
//                that setBlizzard drives
//   loops        loop(name, object, on): a sound that sits on an object (placed every frame)
//
// Where the boat isn't (ashore, underground) it holds off Audio's own hull and wave sounds, and
// underground it quiets the deck's beds too. update() allocates nothing and no public method ever
// throws. Audio.js builds this once its graph exists (so audio.horror is there from audio.start()
// on) and calls update() from its own.

const TAU = Math.PI * 2;
const U = (r, a, b) => a + (b - a) * r();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const N = (sr, s) => Math.max(1, Math.ceil(s * sr));
const Z = (sr, s) => new Float32Array(N(sr, s));
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const expo = (r, rate) => -Math.log(1 - r() * 0.999) / rate;      // Poisson gaps
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const loopF = (f, L) => Math.max(1, Math.round(f * L)) / L;        // a whole number of cycles in L s
const K = (modes, k) => modes.map(([f, t, a]) => [f * k, t, a]);

// ------------------------------------------------------------ filters and oscillators

// RBJ cookbook biquad: 'lp', 'hp', 'bp' (0 dB at the centre), 'peak'
class BQ {
  constructor(sr) { this.sr = sr; this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(type, f, q = 0.707, db = 0) {
    const w = TAU * clamp(f, 5, this.sr * 0.45) / this.sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'peak') {
      const A = Math.pow(10, db / 40);
      b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
    } else {
      if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
      else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
      else { b0 = al; b1 = 0; b2 = -al; }
      a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  proc(buf) { for (let i = 0; i < buf.length; i++) buf[i] = this.run(buf[i]); return buf; }
}
const bq = (sr, type, f, q = 0.707, db = 0) => new BQ(sr).set(type, f, q, db);
function filt(buf, ...fs) { for (const f of fs) f.proc(buf); return buf; }

// Klatt's formant resonator (unity gain at DC); four in cascade are a vocal tract
class Res {
  constructor(sr) { this.sr = sr; this.a = 1; this.b = 0; this.c = 0; this.y1 = 0; this.y2 = 0; }
  set(f, bw) {
    const r = Math.exp(-Math.PI * bw / this.sr);
    this.c = -r * r; this.b = 2 * r * Math.cos(TAU * Math.min(f, this.sr * 0.45) / this.sr); this.a = 1 - this.b - this.c;
    return this;
  }
  run(x) { const y = this.a * x + this.b * this.y1 + this.c * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
function tract(sr, bws) {
  const R = [new Res(sr), new Res(sr), new Res(sr), new Res(sr)];
  return {
    set(F) { R[0].set(F[0], bws[0]); R[1].set(F[1], bws[1]); R[2].set(F[2], bws[2]); R[3].set(F[3] || 3500, bws[3] || 300); },
    run(x) { return R[3].run(R[2].run(R[1].run(R[0].run(x)))); },
  };
}

// a single-cycle wavetable from harmonic amplitudes (one guard sample at the end)
function table(amps, size = 2048) {
  const t = new Float32Array(size + 1);
  for (let h = 0; h < amps.length; h++) { const a = amps[h]; if (a) for (let i = 0; i <= size; i++) t[i] += a * Math.sin(TAU * (h + 1) * i / size); }
  return norm(t, 1);
}
const TABLES = {};
const tbl = (name, make) => TABLES[name] || (TABLES[name] = make());
const SAW = () => tbl('saw', () => table(Array.from({ length: 36 }, (_, h) => 1 / (h + 1))));
const SAW8 = () => tbl('saw8', () => table(Array.from({ length: 8 }, (_, h) => 1 / (h + 1))));
class Osc {
  constructor(t, phase = 0) { this.t = t; this.n = t.length - 1; this.p = phase; }
  step(f, sr) {
    this.p += f / sr; this.p -= Math.floor(this.p);
    const x = this.p * this.n, i = x | 0;
    return this.t[i] + (this.t[i + 1] - this.t[i]) * (x - i);
  }
}

// Rosenberg's glottal pulse, differentiated: open and closing fractions, jitter and shimmer from
// cycle to cycle, and `sub` for alternate weak cycles (period doubling: what makes a roar rough
// and a scream rattle)
class Glottis {
  constructor(r, o = {}) {
    this.r = r; this.p = 0; this.prev = 0; this.k = 0; this.amp = 1; this.cur = 1;
    this.open = o.open ?? 0.55; this.close = o.close ?? 0.14;
    this.jit = o.jitter ?? 0.01; this.shim = o.shimmer ?? 0.05; this.sub = o.sub ?? 0;
  }
  step(f, sr) {
    this.p += (f * this.cur) / sr;
    if (this.p >= 1) {
      this.p -= Math.floor(this.p); this.k++;
      this.cur = 1 + this.jit * (this.r() * 2 - 1);
      this.amp = (1 + this.shim * (this.r() * 2 - 1)) * (this.sub && (this.k & 1) ? 1 - this.sub : 1);
    }
    const p = this.p, op = this.open, cl = this.close;
    let g = 0;
    if (p < op) g = 0.5 * (1 - Math.cos(Math.PI * p / op));
    else if (p < op + cl) g = Math.cos(0.5 * Math.PI * (p - op) / cl);
    g *= this.amp;
    const d = (g - this.prev) * (sr / Math.max(f, 20)) * 0.25;
    this.prev = g;
    return d;
  }
}

// ------------------------------------------------------------ building blocks

// a Hann-shaped blow whose area is `amp` (a soft wide blow and a sharp edge are comparable)
function pulse(buf, sr, t, width, amp) {
  const w = Math.max(2, Math.round(width * sr)), a = Math.round(t * sr), k = (2 * amp) / w;
  for (let i = 0; i < w; i++) {
    const j = a + i;
    if (j < 0) continue;
    if (j >= buf.length) break;
    buf[j] += k * 0.5 * (1 - Math.cos(TAU * (i + 0.5) / w));
  }
}

// a burst of noise: linear attack, exponential decay (time constant dec), through filters fs
function burst(out, sr, r, t, att, dec, amp, fs) {
  const a = Math.round(t * sr), na = Math.max(1, Math.round(att * sr)), nd = Math.max(1, dec * sr);
  const n = Math.min(out.length - a, na + Math.ceil(nd * 7));
  for (let i = 0; i < n; i++) {
    const e = i < na ? i / na : Math.exp(-(i - na) / nd);
    let x = (r() * 2 - 1) * e * amp;
    if (fs) for (let k = 0; k < fs.length; k++) x = fs[k].run(x);
    if (a + i >= 0) out[a + i] += x;
  }
}

// a sine sliding from f0 toward f1 (time constant tc) under an attack/decay envelope
function chirp(out, sr, t, dur, f0, f1, tc, amp, att, dec) {
  const a = Math.round(t * sr), n = Math.min(out.length - a, N(sr, dur));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr, f = f1 + (f0 - f1) * Math.exp(-tt / tc);
    ph += TAU * f / sr;
    if (a + i >= 0) out[a + i] += Math.sin(ph) * Math.min(1, tt / att) * Math.exp(-tt / dec) * amp;
  }
}

// a bubble or a drop: a sine rising as it collapses (Minnaert's resonance, the cavity shrinking)
function bubble(out, sr, t, f, d, amp, rise = 2.5) {
  const a = Math.round(t * sr), m = N(sr, d * 5);
  let ph = 0;
  for (let i = 0; i < m && a + i < out.length; i++) {
    const tt = i / sr;
    ph += TAU * f * (1 + rise * tt / (d * 5)) / sr;
    if (a + i >= 0) out[a + i] += Math.sin(ph) * Math.exp(-tt / d) * amp * Math.min(1, tt / 0.0005);
  }
}

// ice crackling: tiny fractures at `rate` a second over [t0, t0 + span], fading as env(u) says
function crackles(out, sr, r, t0, span, rate, hp = 2200, env = () => 1) {
  const f = [bq(sr, 'hp', hp)];
  for (let t = t0 + expo(r, rate); t < t0 + span; t += expo(r, rate)) burst(out, sr, r, t, 0.00005, U(r, 0.0001, 0.0006), Math.pow(r(), 1.6) * env((t - t0) / span), f);
  return out;
}

// modes: [[freq, t60 (s), level], ...] rung by the excitation exc, added into out
function modal(out, exc, sr, modes) {
  let first = 0, last = exc.length - 1;
  while (first < exc.length && exc[first] === 0) first++;
  while (last > first && exc[last] === 0) last--;
  if (first >= exc.length) return out;
  for (let m = 0; m < modes.length; m++) {
    const f = modes[m][0], t60 = modes[m][1], amp = modes[m][2];
    if (!(f > 0) || f >= sr * 0.45 || !amp) continue;
    const r = Math.exp(-6.9078 / (t60 * sr)), w = TAU * f / sr;
    const a1 = 2 * r * Math.cos(w), a2 = -r * r, g = amp * Math.sin(w);
    let y1 = 0, y2 = 0;
    for (let i = first; i < out.length; i++) {
      const y = a1 * y1 + a2 * y2 + g * exc[i];
      y2 = y1; y1 = y;
      out[i] += y;
      if (i > last && (y < 0 ? -y : y) < 1e-7 && (y2 < 0 ? -y2 : y2) < 1e-7) break;
    }
  }
  return out;
}

// an impulse ringing modes from t: modal() for a single tap, without an excitation buffer
function ring(out, sr, t, amp, modes) {
  const a = Math.round(t * sr);
  for (const [f, t60, l] of modes) {
    if (!(f > 0) || f >= sr * 0.45 || !l) continue;
    const q = Math.exp(-6.9078 / (t60 * sr)), w = TAU * f / sr, a1 = 2 * q * Math.cos(w), a2 = -q * q, m = Math.min(out.length - a, Math.ceil(t60 * sr));
    let y1 = amp * l * Math.sin(w), y2 = 0;
    for (let i = 0; i < m; i++) { if (a + i >= 0) out[a + i] += y1; const y = a1 * y1 + a2 * y2; y2 = y1; y1 = y; }
  }
  return out;
}

// Stick-slip friction: a pulse each time the surfaces let go. curve: [[u, rate Hz], ...] over
// u = 0..1 from t0 to t1; env(u) is the pressure. Slow slips are ragged (a creak), fast ones even.
function friction(buf, sr, r, t0, t1, curve, width, env) {
  let t = t0;
  while (t < t1) {
    const u = (t - t0) / (t1 - t0), rate = curveAt(curve, u), rough = rate < 120;
    pulse(buf, sr, t, width, env(u) * (rough ? U(r, 0.35, 1) : U(r, 0.85, 1)));
    t += (1 / rate) * (1 + (rough ? 0.25 : 0.015) * (r() * 2 - 1));
  }
}
function curveAt(c, u) {
  if (u <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (u <= c[i][0]) {
      const k = (u - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * (0.5 - 0.5 * Math.cos(Math.PI * k));
    }
  }
  return c[c.length - 1][1];
}

// a slowly wandering control signal in -1..1 (lowpassed noise)
function wander(r, n, sr, hz) {
  const out = new Float32Array(n), a = Math.exp(-TAU * hz / sr);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) { y1 = a * y1 + (1 - a) * (r() * 2 - 1); y2 = a * y2 + (1 - a) * y1; out[i] = y2; }
  return norm(out, 1);
}

function peakOf(buf) { let m = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i] < 0 ? -buf[i] : buf[i]; if (v > m) m = v; } return m; }
function norm(buf, p = 0.9) {
  const m = peakOf(buf);
  if (m > 1e-12) { const k = p / m; for (let i = 0; i < buf.length; i++) buf[i] *= k; }
  return buf;
}
// normalise a part to peak p and add it in (so each part sits at its own level)
function mix(out, part, p) {
  norm(part, p);
  const n = Math.min(out.length, part.length);
  for (let i = 0; i < n; i++) out[i] += part[i];
  return out;
}
// add a part at time t (s), as it is
function put(out, part, sr, t, g = 1) {
  const a = Math.round(t * sr);
  for (let i = Math.max(0, -a); i < part.length && a + i < out.length; i++) out[a + i] += part[i] * g;
  return out;
}
// soft saturation (thicker, louder for the same peak); the part should be near 1 first
function sat(buf, drive) {
  const k = 1 / Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) * k;
  return buf;
}
// a mono part into a stereo pair, constant power, p in -1..1
function pan2(L, R, part, p, g = 1) {
  const a = (clamp(p, -1, 1) + 1) * Math.PI / 4, gl = Math.cos(a) * g, gr = Math.sin(a) * g, n = Math.min(L.length, part.length);
  for (let i = 0; i < n; i++) { L[i] += part[i] * gl; R[i] += part[i] * gr; }
}
// the finish for one-shots: block DC, soften the very ends, normalise
function fin(buf, sr, p = 0.9, fout = 0.02) {
  let x1 = 0, y1 = 0;
  const R = 1 - 70 / sr;
  for (let i = 0; i < buf.length; i++) { const x = buf[i], y = x - x1 + R * y1; x1 = x; y1 = y; buf[i] = y; }
  const a = Math.min(buf.length, Math.round(0.0005 * sr));
  for (let i = 0; i < a; i++) buf[i] *= i / a;
  const b = Math.min(buf.length, Math.round(fout * sr));
  for (let i = 0; i < b; i++) buf[buf.length - 1 - i] *= i / b;
  return norm(buf, p);
}
// the same for a stereo pair, the two sides normalised together
function fin2(L, R, sr, p = 0.9, fout = 0.05) {
  fin(L, sr, 1, fout); fin(R, sr, 1, fout);
  const k = p / Math.max(peakOf(L), peakOf(R), 1e-9);
  for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k; }
  return [L, R];
}
// loops: tails past n wrap round to the start (for events)...
function fold(buf, n) {
  const out = buf.slice(0, n);
  for (let i = n; i < buf.length; i++) out[(i - n) % n] += buf[i];
  return out;
}
// ...and continuous sound rendered a little long is crossfaded into its own start (equal power)
function xfade(buf, n) {
  const X = buf.length - n, out = buf.slice(0, n);
  for (let i = 0; i < X; i++) { const u = (i / X) * Math.PI * 0.5; out[i] = out[i] * Math.sin(u) + buf[n + i] * Math.cos(u); }
  return out;
}
function dc(buf) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m += buf[i];
  m /= buf.length;
  for (let i = 0; i < buf.length; i++) buf[i] -= m;
  return buf;
}
// a loop's finish: no DC, normalised
const loopFin = (buf, p = 0.9) => norm(dc(buf), p);

// One utterance through the tract. o: { t0, d, f0(u), F(u) -> [F1, F2, F3, F4], bw, amp(u),
// asp(u) (breath noise in place of voice, 0..1), glot (Glottis options), rough: [hz, depth] (the
// source chopped into a rattle near hz, the rate jittering) }, u = 0..1 over the utterance
function voice(out, sr, r, o) {
  const g = new Glottis(r, o.glot), T = tract(sr, o.bw || [100, 130, 200, 300]), nh = bq(sr, 'hp', 250);
  const a = Math.round(o.t0 * sr), m = N(sr, o.d), rh = o.rough ? o.rough[0] : 0, rd = o.rough ? o.rough[1] : 0;
  let rp = r(), rr = rh, f = 100, am = 0, asp = 0;
  for (let i = 0; i < m && a + i < out.length; i++) {
    const u = i / m;
    if ((i & 7) === 0) { f = o.f0(u); am = o.amp(u); asp = o.asp ? o.asp(u) : 0; }     // (the contours are slow)
    if ((i & 63) === 0) { T.set(o.F(u)); if (rd) rr = rh * U(r, 0.75, 1.3); }
    let x = g.step(f, sr) * (1 - asp) + nh.run(r() * 2 - 1) * asp * 1.2;
    if (rd) { rp += rr / sr; rp -= Math.floor(rp); const c = 0.5 + 0.5 * Math.cos(TAU * rp); x *= 1 - rd + rd * 1.8 * c * c * c; }
    if (a + i >= 0) out[a + i] += T.run(x) * am;
  }
  return out;
}

// Whispered Russian-like syllables: breath through the tract with no voice, sibilants and 'kh's
// between (s, sh, shch, kh, ts, f and a stop's release: centre, Q, length); stressed vowels long,
// the rest clipped. o: { tract, rate, amp(u), gain }
const WV = [[700, 1220, 2500], [540, 900, 2450], [340, 760, 2300], [480, 1750, 2500], [290, 2200, 2950], [340, 1500, 2350], [500, 1350, 2450]];
const WC = [[6200, 2.2, 0.09], [3000, 1.8, 0.1], [3700, 1.8, 0.14], [1500, 1.1, 0.07], [5800, 2.2, 0.06], [2600, 0.6, 0.06], [4200, 1.4, 0.02], [1900, 1.6, 0.02]];
function whisper(out, sr, r, t0, seconds, o = {}) {
  const tr = o.tract ?? U(r, 0.95, 1.15), rate = o.rate ?? 1, segs = [];
  let t = 0;
  while (t < seconds) {
    const syl = 1 + Math.floor(r() * 3), stress = Math.floor(r() * syl);
    for (let s = 0; s < syl && t < seconds; s++) {
      if (r() < 0.8) { const c = pick(r, WC), d = c[2] * rate * U(r, 0.8, 1.3); segs.push({ t, d, c }); t += d; }
      const st = s === stress, d = (st ? U(r, 0.14, 0.24) : U(r, 0.06, 0.1)) * rate;
      segs.push({ t, d, v: pick(r, WV), a: st ? 1 : 0.55 }); t += d;
    }
    t += U(r, 0.06, 0.3) * rate;
  }
  const n = N(sr, t + 0.05), vow = new Float32Array(n), con = new Float32Array(n);
  const T = tract(sr, [120, 140, 220, 320]), cb = new BQ(sr), hp = bq(sr, 'hp', 300);
  let F1 = 500, F2 = 1400, F3 = 2450;
  for (const s of segs) {
    const a = Math.round(s.t * sr), m = N(sr, s.d);
    if (s.c) cb.set('bp', s.c[0], s.c[1]);
    for (let i = 0; i < m && a + i < n; i++) {
      const u = i / m, e = Math.pow(Math.sin(Math.PI * u), 0.6) * (o.amp ? o.amp(clamp((s.t + i / sr) / seconds, 0, 1)) : 1), w = hp.run(r() * 2 - 1);
      if (s.c) { con[a + i] += cb.run(w) * e; continue; }
      if ((i & 31) === 0) { const k = Math.min(1, u / 0.3); T.set([F1 + (s.v[0] * tr - F1) * k, F2 + (s.v[1] * tr - F2) * k, F3 + (s.v[2] * tr - F3) * k, 3600 * tr]); }
      vow[a + i] += T.run(w) * e * s.a;
    }
    if (s.v) { F1 = s.v[0] * tr; F2 = s.v[1] * tr; F3 = s.v[2] * tr; }
  }
  norm(vow, 1);
  mix(vow, con, 0.5);
  return put(out, norm(vow, 1), sr, t0, o.gain ?? 1);
}

// Something struck, once or many times: hits [[t, amp], ...]. o.body: the modes a broad blow rings
// (pulse width o.w), o.edge: the modes its sharp edge rings (o.ew), o.thud: [lowpass Hz, decay] of
// the blow's own noise; o.mix: [body, edge, thud] levels
function struck(n, sr, r, hits, o) {
  const out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n);
  for (const [t, a] of hits) { pulse(exc, sr, t, o.w ?? 0.004, a); if (o.edge) pulse(edge, sr, t + 0.0003, o.ew ?? 0.0003, a * U(r, 0.7, 1)); }
  const [lb, le, lt] = o.mix || [1, 0.35, 0.3];
  let p;
  if (o.body) { p = new Float32Array(n); modal(p, exc, sr, o.body); mix(out, p, lb); }
  if (o.edge) { p = new Float32Array(n); modal(p, edge, sr, o.edge); mix(out, p, le); }
  if (o.thud) { p = new Float32Array(n); for (const [t, a] of hits) burst(p, sr, r, t, 0.001, o.thud[1], a, [bq(sr, 'lp', o.thud[0])]); mix(out, p, lt); }
  return out;
}

// metal sliding on metal: stick-slip at rate0 -> rate1 through the part's modes, and the scrape's grit
function slide(out, sr, r, t0, t1, rate0, rate1, modes, lvl, grit = 0.3) {
  const n = out.length, fr = new Float32Array(n), p = new Float32Array(n);
  friction(fr, sr, r, t0, t1, [[0, rate0], [1, rate1]], 0.00025, (u) => 0.4 + 0.6 * Math.sin(Math.PI * u));
  modal(p, fr, sr, modes);
  const s = new Float32Array(n), f1 = bq(sr, 'bp', U(r, 2500, 4000), 0.8);
  for (let i = Math.round(t0 * sr); i < Math.min(n, Math.round(t1 * sr)); i++) { const u = (i / sr - t0) / (t1 - t0); s[i] = f1.run(r() * 2 - 1) * Math.sin(Math.PI * u); }
  norm(p, 1);
  mix(p, s, grit);
  return mix(out, p, lvl);
}

// cloth and webbing moving: noise in a shifting band, chopped by the hand's movement
function rustle(out, sr, r, t0, d, amp) {
  const n = N(sr, d), w = wander(r, n, sr, 18), f = new BQ(sr), a = Math.round(t0 * sr);
  for (let i = 0; i < n && a + i < out.length; i++) {
    if ((i & 255) === 0) f.set('bp', U(r, 1400, 4200), 0.9);
    const e = Math.max(0, w[i]) * Math.sin(Math.PI * i / n);
    out[a + i] += f.run(r() * 2 - 1) * e * e * amp;
  }
  return out;
}

// ------------------------------------------------------------ the guns

// A shot, dry: the bullet's crack (an N-wave, supersonic rounds only), the muzzle blast (a broad
// pressure pulse ringing the low modes: the thump in the chest), the gas roaring out and darkening,
// the gun's own action and receiver, the ground's reflection a few milliseconds behind, and a short
// tail of the near surroundings. The world's echo is added by the graph. Saturated: a gunshot is
// as loud as the speakers will go.
function shot(sr, r, o) {
  const n = N(sr, o.dur), out = new Float32Array(n), t0 = 0.002;
  let p;
  if (o.crack) {
    p = new Float32Array(n);
    const w = Math.round(U(r, 0.00035, 0.0005) * sr), a = Math.round(t0 * sr);
    for (let i = 0; i <= w; i++) p[a + i] = 1 - 2 * i / w;
    mix(out, p, o.crack);
  }
  const tb = t0 + (o.crack ? U(r, 0.0006, 0.0012) : 0), exc = new Float32Array(n);
  pulse(exc, sr, tb, o.blastW, 1);
  p = new Float32Array(n);
  modal(p, exc, sr, K(o.body, U(r, 0.94, 1.06)));
  mix(out, p, o.bodyLvl);
  p = new Float32Array(n);
  burst(p, sr, r, tb, 0.0002, o.blastDec, 1, [bq(sr, 'lp', o.blastLP), bq(sr, 'hp', 150)]);
  pulse(p, sr, tb, o.blastW * 0.35, o.blastW * 0.6);
  mix(out, p, o.blastLvl);
  p = new Float32Array(n);
  const [g0, g1, gd] = o.gas, lp = new BQ(sr);
  for (let i = Math.round(tb * sr); i < n; i++) {
    const t = i / sr - tb;
    if ((i & 31) === 0) lp.set('lp', g1 + (g0 - g1) * Math.exp(-t / (gd * 0.6)), 0.6);
    p[i] = lp.run(r() * 2 - 1) * Math.min(1, t / 0.0015) * Math.exp(-t / gd);
  }
  mix(out, p, o.gasLvl);
  if (o.action) {
    const [ta, modes, lvl] = o.action, e = new Float32Array(n);
    pulse(e, sr, tb + ta, 0.0003, 1);
    pulse(e, sr, tb + ta + U(r, 0.012, 0.025), 0.0003, U(r, 0.4, 0.7));
    p = new Float32Array(n);
    modal(p, e, sr, K(modes, U(r, 0.95, 1.05)));
    mix(out, p, lvl);
  }
  if (o.ring) {
    const e = new Float32Array(n);
    pulse(e, sr, tb, 0.0002, 1);
    p = new Float32Array(n);
    modal(p, e, sr, o.ring);
    mix(out, p, o.ringLvl);
  }
  const [gdl, glp, gl] = o.ground;
  put(out, filt(out.slice(), bq(sr, 'lp', glp)), sr, U(r, gdl[0], gdl[1]), gl);
  const [t60, tlp, tl] = o.tail, f = bq(sr, 'lp', tlp), fall = Math.exp(-6.9078 / (t60 * sr)), ts = tb + 0.006;
  p = new Float32Array(n);
  let e = 1;
  for (let i = Math.round(ts * sr); i < n; i++) { p[i] = f.run(r() * 2 - 1) * e * Math.min(1, (i / sr - ts) / 0.012); e *= fall; }
  mix(out, p, tl);
  norm(out, 1);
  sat(out, o.drive);
  return fin(out, sr, 0.97, 0.05);
}

const SLIDE = [[1850, 0.05, 0.5], [2900, 0.04, 0.45], [4300, 0.03, 0.35], [6100, 0.022, 0.25], [8200, 0.015, 0.15]];
const FRAME = [[420, 0.04, 0.6], [760, 0.035, 0.4], [1200, 0.03, 0.3]];
const CARRIER = [[1250, 0.05, 0.5], [2050, 0.04, 0.45], [3300, 0.03, 0.35], [4800, 0.025, 0.2]];
const RECEIVER = [[880, 0.09, 0.4], [1620, 0.07, 0.35], [2730, 0.05, 0.25], [3900, 0.04, 0.15]];
const MAGSHEET = [[640, 0.06, 0.6], [1080, 0.05, 0.5], [1730, 0.04, 0.4], [2600, 0.03, 0.25]];
const STOCK = [[260, 0.04, 0.6], [470, 0.03, 0.4], [820, 0.025, 0.3]];
const BRASS = [[3350, 0.25, 0.5], [5920, 0.2, 0.45], [8150, 0.15, 0.35], [10900, 0.1, 0.25], [2100, 0.1, 0.15]];

// the Makarov: no supersonic crack, but a short barrel's sharp, bright report and the slide's clack
const pmShot = (sr, r) => shot(sr, r, {
  dur: 0.55, crack: 0, blastW: 0.0006, blastLP: 9500, blastDec: 0.012, blastLvl: 1,
  body: [[112, 0.05, 1], [176, 0.04, 0.6], [262, 0.03, 0.3]], bodyLvl: 0.7,
  gas: [7500, 900, 0.035], gasLvl: 0.55, action: [0.011, SLIDE, 0.22],
  ground: [[0.004, 0.007], 2500, 0.45], tail: [0.18, 3500, 0.22], drive: 2.2,
});
// the Mosin: the crack, then a huge, low blast and a long roar of gas; the barrel rings
const mosinShot = (sr, r) => shot(sr, r, {
  dur: 1.1, crack: 0.9, blastW: 0.0013, blastLP: 6500, blastDec: 0.03, blastLvl: 1,
  body: [[48, 0.2, 1], [72, 0.15, 0.8], [105, 0.1, 0.5], [150, 0.07, 0.3]], bodyLvl: 1,
  gas: [5200, 480, 0.1], gasLvl: 0.8, ring: [[620, 0.12, 0.3], [1340, 0.1, 0.25], [2210, 0.07, 0.2]], ringLvl: 0.07,
  ground: [[0.006, 0.009], 1800, 0.5], tail: [0.45, 2200, 0.32], drive: 2.8,
});
// the AKM: punchy and short so a burst stays a burst; the carrier slams, the stamped receiver rings
const akmShot = (sr, r) => shot(sr, r, {
  dur: 0.6, crack: 0.6, blastW: 0.0009, blastLP: 7500, blastDec: 0.017, blastLvl: 1,
  body: [[78, 0.08, 1], [118, 0.06, 0.7], [172, 0.045, 0.4]], bodyLvl: 0.95,
  gas: [6000, 700, 0.042], gasLvl: 0.55, action: [0.018, CARRIER, 0.28], ring: RECEIVER, ringLvl: 0.1,
  ground: [[0.005, 0.008], 2200, 0.45], tail: [0.25, 3000, 0.22], drive: 2.5,
});

// the SPSh: a dull thump in a fat tube, then the flare's hiss going away up the sky, fizzing and
// spitting, falling in pitch as it goes
function flareShot(sr, r) {
  const n = N(sr, 2.6), out = new Float32Array(n);
  let p = struck(n, sr, r, [[0.003, 1]], { w: 0.004, body: [[92, 0.09, 1], [143, 0.06, 0.5]], edge: [[430, 0.05, 1], [1160, 0.035, 0.5], [2050, 0.02, 0.2]], ew: 0.0012, thud: [1400, 0.025], mix: [1, 0.45, 0.6] });
  mix(out, p, 1);
  p = new Float32Array(n);
  const bp = new BQ(sr), fz = wander(r, n, sr, 40), t0 = 0.03, f0 = U(r, 3800, 4600);
  for (let i = Math.round(t0 * sr); i < n; i++) {
    const t = i / sr - t0;
    if ((i & 31) === 0) bp.set('bp', 1500 + (f0 - 1500) * Math.exp(-t / 0.8), 1.3);
    p[i] = bp.run(r() * 2 - 1) * smooth(t / 0.06) * Math.exp(-t / 0.85) * (0.65 + 0.35 * fz[i]);
  }
  crackles(p, sr, r, t0, 1.6, 35, 1500, (u) => (1 - u) * 0.5);
  mix(out, p, 0.3);
  norm(out, 1);
  sat(out, 1.6);
  return fin(out, sr, 0.95, 0.2);
}

// ------------------------------------------------------------ weapon foley

// the hammer falls on nothing: the trigger's small click, the hammer's snap, the spring
function dryFire(sr, r) {
  const n = N(sr, 0.25), k = U(r, 0.95, 1.05), out = struck(n, sr, r, [[0.006, 0.25], [0.045, 1]], { w: 0.0012, body: K(FRAME, k), edge: K(SLIDE, k * 1.2), mix: [0.5, 1, 0] });
  const p = new Float32Array(n), e = new Float32Array(n);
  pulse(e, sr, 0.046, 0.0002, 1);
  modal(p, e, sr, [[3100 * k, 0.12, 0.3], [5400 * k, 0.08, 0.2]]);
  mix(out, p, 0.08);
  return fin(out, sr, 0.9, 0.02);
}

// clacks: a list of [t, amp] at the edge of a steel part over the gun's frame
const clacks = (n, sr, r, hits, edge, body, lv = [0.55, 1]) => struck(n, sr, r, hits, { w: 0.0015, body, edge, mix: [lv[0], lv[1], 0] });

function pmMagOut(sr, r) {
  const n = N(sr, 0.38), out = clacks(n, sr, r, [[0.008, 0.6], [0.2, 0.3]], SLIDE, FRAME);
  slide(out, sr, r, 0.03, 0.19, 380, 650, K(SLIDE, 0.8), 0.35);
  return fin(out, sr, 0.85);
}
function pmMagIn(sr, r) {
  const n = N(sr, 0.35), out = new Float32Array(n);
  slide(out, sr, r, 0.01, 0.12, 500, 320, K(SLIDE, 0.8), 0.3);
  mix(out, clacks(n, sr, r, [[0.13, 1]], SLIDE, FRAME, [0.8, 1]), 1);
  mix(out, struck(n, sr, r, [[0.135, 1]], { w: 0.006, thud: [500, 0.02], mix: [0, 0, 1] }), 0.4);   // the palm on the base
  return fin(out, sr, 0.9);
}
function pmSlide(sr, r) {
  const n = N(sr, 0.5), out = new Float32Array(n), tr = U(r, 0.24, 0.3);
  slide(out, sr, r, 0.02, 0.14, 220, 900, SLIDE, 0.45, 0.5);
  mix(out, clacks(n, sr, r, [[0.15, 0.55], [tr, 1], [tr + 0.004, 0.4]], SLIDE, FRAME, [0.7, 1]), 1);
  return fin(out, sr, 0.9, 0.05);
}

// the Mosin's bolt cocks as it opens (the striker is drawn back by the handle's cam), slides back
// along its long way, and hits its stop; closing, it strips a round, rams it and turns down
function mosinBoltOpen(sr, r) {
  const n = N(sr, 0.58), out = new Float32Array(n), te = U(r, 0.36, 0.42);
  slide(out, sr, r, 0.01, 0.11, 60, 240, K(CARRIER, 0.9), 0.35, 0.2);
  slide(out, sr, r, 0.16, te - 0.01, 420, 780, K(SLIDE, 0.75), 0.4, 0.6);
  mix(out, clacks(n, sr, r, [[0.115, 0.8], [te, 1], [te + 0.01, 0.35]], K(CARRIER, 0.85), [...FRAME, ...STOCK], [0.9, 1]), 1);
  return fin(out, sr, 0.9, 0.05);
}
function mosinBoltClose(sr, r) {
  const n = N(sr, 0.48), out = new Float32Array(n), tc = U(r, 0.18, 0.22);
  slide(out, sr, r, 0.02, tc - 0.01, 700, 450, K(SLIDE, 0.75), 0.4, 0.6);
  mix(out, clacks(n, sr, r, [[tc, 0.8], [tc + U(r, 0.09, 0.12), 1]], K(CARRIER, 0.85), [...FRAME, ...STOCK], [1, 1]), 1);
  return fin(out, sr, 0.9, 0.05);
}
// a stripper clip: into the guides, five rounds thumbed down past the lip, the clip flicked away
function mosinClip(sr, r) {
  const n = N(sr, 0.85), out = new Float32Array(n), hits = [[0.02, 0.8]];
  let t = 0.12;
  for (let i = 0; i < 5; i++) { hits.push([t, U(r, 0.45, 0.7)]); t += U(r, 0.06, 0.085); }
  slide(out, sr, r, 0.1, t - 0.04, 200, 340, K(SLIDE, 0.7), 0.3, 0.7);
  mix(out, clacks(n, sr, r, hits, K(SLIDE, 0.85), [...FRAME, ...STOCK], [0.8, 1]), 1);
  const e = new Float32Array(n), p = new Float32Array(n);
  pulse(e, sr, t + 0.12, 0.0002, 1); pulse(e, sr, t + 0.2, 0.0002, 0.4);
  modal(p, e, sr, [[2650, 0.08, 0.5], [4100, 0.06, 0.4], [6300, 0.05, 0.3]]);   // the clip's thin spring steel
  mix(out, p, 0.35);
  return fin(out, sr, 0.9, 0.05);
}
function mosinRound(sr, r) {
  const n = N(sr, 0.26), out = new Float32Array(n);
  slide(out, sr, r, 0.01, 0.08, 260, 380, K(SLIDE, 0.7), 0.3, 0.6);
  mix(out, clacks(n, sr, r, [[0.09, 1]], K(SLIDE, 0.85), STOCK, [0.6, 1]), 1);
  mix(out, struck(n, sr, r, [[0.092, 0.6]], { ew: 0.0002, edge: K(BRASS, 0.8), mix: [0, 1, 0] }), 0.25);
  return fin(out, sr, 0.85);
}

// the AK's magazine: the catch, then rocked out (or hooked in front and rocked home), its hollow
// stamped sheet ringing all the while
function akmMagOut(sr, r) {
  const n = N(sr, 0.42), out = clacks(n, sr, r, [[0.01, 1], [0.03, 0.4]], CARRIER, MAGSHEET, [1, 0.8]);
  const fr = new Float32Array(n), p = new Float32Array(n);
  friction(fr, sr, r, 0.05, 0.2, [[0, 90], [1, 260]], 0.0005, (u) => Math.sin(Math.PI * u));
  modal(p, fr, sr, MAGSHEET);
  mix(out, p, 0.5);
  return fin(out, sr, 0.9);
}
function akmMagIn(sr, r) {
  const n = N(sr, 0.42), out = new Float32Array(n), tl = U(r, 0.15, 0.19);
  const fr = new Float32Array(n), p = new Float32Array(n);
  friction(fr, sr, r, 0.04, tl - 0.01, [[0, 220], [1, 110]], 0.0005, (u) => Math.sin(Math.PI * u));
  modal(p, fr, sr, MAGSHEET);
  mix(out, p, 0.45);
  mix(out, clacks(n, sr, r, [[0.02, 0.55], [tl, 1]], CARRIER, [...MAGSHEET, ...FRAME], [1, 1]), 1);
  return fin(out, sr, 0.9);
}
function akmCharge(sr, r) {
  const n = N(sr, 0.5), out = new Float32Array(n), tr = U(r, 0.2, 0.25);
  slide(out, sr, r, 0.02, 0.13, 300, 1100, CARRIER, 0.45, 0.4);
  mix(out, clacks(n, sr, r, [[0.14, 0.6], [tr, 1], [tr + 0.006, 0.5]], CARRIER, [...RECEIVER, ...FRAME], [1, 1]), 1);
  return fin(out, sr, 0.9, 0.05);
}

// the flare pistol breaks open like a shotgun: the latch, the barrel dropping on its hinge, the fat
// cartridge sliding home, the barrel snapped shut
const FLARE = [[310, 0.06, 0.6], [560, 0.05, 0.45], [980, 0.04, 0.3], [1700, 0.03, 0.2]];
function flareOpen(sr, r) {
  const n = N(sr, 0.32);
  return fin(clacks(n, sr, r, [[0.01, 0.6], [U(r, 0.07, 0.1), 1]], K(SLIDE, 0.8), FLARE, [1, 0.8]), sr, 0.85);
}
function flareLoad(sr, r) {
  const n = N(sr, 0.36), out = new Float32Array(n), fr = new Float32Array(n), p = new Float32Array(n);
  friction(fr, sr, r, 0.02, 0.17, [[0, 150], [1, 260]], 0.0006, (u) => Math.sin(Math.PI * u));
  modal(p, fr, sr, [[520, 0.03, 0.5], [880, 0.03, 0.4], [1500, 0.02, 0.2]]);
  mix(out, p, 0.4);
  mix(out, struck(n, sr, r, [[0.19, 1]], { w: 0.003, body: [[520, 0.05, 1], [880, 0.04, 0.5]], edge: FLARE, mix: [1, 0.6, 0] }), 1);
  return fin(out, sr, 0.85);
}
function flareClose(sr, r) {
  const n = N(sr, 0.28);
  return fin(clacks(n, sr, r, [[0.01, 1], [0.016, 0.5]], K(SLIDE, 0.8), FLARE, [1, 1]), sr, 0.9);
}
// a hand flare struck: the cap's scratch, a cough of flame, and the fizzing roar of it burning
function flareIgnite(sr, r) {
  const n = N(sr, 2.3), out = new Float32Array(n), fr = new Float32Array(n);
  friction(fr, sr, r, 0.01, 0.14, [[0, 40], [1, 90]], 0.0004, () => 1);
  filt(fr, bq(sr, 'hp', 1200));
  mix(out, fr, 0.35);
  let p = new Float32Array(n);
  burst(p, sr, r, 0.15, 0.03, 0.12, 1, [bq(sr, 'lp', 1600)]);
  mix(out, p, 0.7);
  p = new Float32Array(n);
  const bp = bq(sr, 'bp', 2400, 0.6), fz = wander(r, n, sr, 30);
  for (let i = Math.round(0.16 * sr); i < n; i++) { const t = i / sr - 0.16; p[i] = bp.run(r() * 2 - 1) * smooth(t / 0.15) * (0.6 + 0.4 * fz[i]); }
  crackles(p, sr, r, 0.2, 2, 28, 1200);
  mix(out, p, 0.55);
  return fin(out, sr, 0.9, 0.3);
}

// a spent case on steel or concrete: bounces closer and closer, each ringing the thin brass
// cylinder a little differently, and a last short roll
function shellBrass(sr, r) {
  const n = N(sr, 0.7), out = new Float32Array(n), k = U(r, 0.88, 1.15);
  let t = 0.004, gap = U(r, 0.09, 0.14), a = 1;
  const count = 3 + Math.floor(r() * 4);
  for (let i = 0; i < count; i++) {
    const e = new Float32Array(n), p = new Float32Array(n);
    pulse(e, sr, t, 0.00012, a);
    modal(p, e, sr, BRASS.map(([f, t60, l]) => [f * k, t60 * (i ? 0.6 : 1), l * U(r, 0.3, 1)]));
    put(out, p, sr, 0, 1);
    t += gap; gap *= U(r, 0.55, 0.75); a *= U(r, 0.45, 0.7);
  }
  const fr = new Float32Array(n), p = new Float32Array(n);
  friction(fr, sr, r, t, Math.min(0.65, t + 0.15), [[0, 900], [1, 500]], 0.0001, (u) => (1 - u) * 0.15);
  modal(p, fr, sr, K(BRASS, k));
  norm(out, 1);
  mix(out, p, 0.07);
  return fin(out, sr, 0.85, 0.03);
}
// into the snow: a soft thup, a little crunch, the hot brass hissing
function shellBrassSnow(sr, r) {
  const n = N(sr, 0.35), out = new Float32Array(n);
  let p = new Float32Array(n);
  burst(p, sr, r, 0.004, 0.002, 0.008, 1, [bq(sr, 'lp', 900)]);
  mix(out, p, 1);
  mix(out, crackles(new Float32Array(n), sr, r, 0.005, 0.05, 200, 1500), 0.35);
  p = new Float32Array(n);
  burst(p, sr, r, 0.01, 0.02, 0.09, 1, [bq(sr, 'hp', 3500)]);
  mix(out, p, 0.18);
  return fin(out, sr, 0.8);
}
function weaponDraw(sr, r) {
  const n = N(sr, 0.45), out = rustle(new Float32Array(n), sr, r, 0, 0.3, 1);
  norm(out, 0.5);
  mix(out, clacks(n, sr, r, [[0.08, 0.3], [0.13, 0.25], [0.27, 1]], K(SLIDE, 0.9), FRAME, [0.6, 1]), 0.7);
  return fin(out, sr, 0.75);
}
function weaponHolster(sr, r) {
  const n = N(sr, 0.45), out = rustle(new Float32Array(n), sr, r, 0.05, 0.32, 1), fr = new Float32Array(n), p = new Float32Array(n);
  norm(out, 0.5);
  friction(fr, sr, r, 0.08, 0.3, [[0, 25], [1, 45]], 0.0008, (u) => Math.sin(Math.PI * u));
  modal(p, fr, sr, [[340, 0.06, 0.6], [610, 0.05, 0.4], [990, 0.04, 0.2]]);   // the leather
  mix(out, p, 0.25);
  mix(out, struck(n, sr, r, [[0.34, 1]], { w: 0.004, body: FRAME, thud: [600, 0.015], mix: [0.6, 0, 0.6] }), 0.55);
  return fin(out, sr, 0.75);
}

// ------------------------------------------------------------ bullets landing

// shards of ice or glass: count chips over span, each two or three high modes of its own
function shards(out, sr, r, t0, span, count, f0, f1, t60, shape = 2) {
  for (let c = 0; c < count; c++) {
    const t = t0 + span * Math.pow(r(), shape), f = U(r, f0, f1);
    ring(out, sr, t, U(r, 0.2, 1) * (1 - 0.7 * (t - t0) / Math.max(span, 1e-3)), [[f, t60 * U(r, 0.6, 1.2), 1], [f * U(r, 1.4, 1.9), t60 * 0.7, 0.6], [f * U(r, 2.3, 3.1), t60 * 0.5, 0.35]]);
  }
  return out;
}

function hitFlesh(sr, r) {
  const n = N(sr, 0.4), out = struck(n, sr, r, [[0.003, 1]], { w: 0.006, body: K([[95, 0.06, 1], [150, 0.04, 0.5], [240, 0.03, 0.2]], U(r, 0.85, 1.15)), thud: [500, 0.02], mix: [1, 0, 0.7] });
  const p = new Float32Array(n), bp = new BQ(sr);
  for (let i = Math.round(0.004 * sr); i < N(sr, 0.2); i++) {
    const t = i / sr - 0.004;
    if ((i & 31) === 0) bp.set('bp', 300 + 700 * Math.exp(-t / 0.03), 2.5);
    p[i] = bp.run(r() * 2 - 1) * Math.exp(-t / 0.045);
  }
  for (let k = 0, c = 2 + Math.floor(r() * 3); k < c; k++) bubble(p, sr, U(r, 0.01, 0.12), U(r, 280, 750), U(r, 0.006, 0.015), U(r, 0.3, 0.8));
  mix(out, p, 0.6);
  if (r() < 0.4) mix(out, crackles(new Float32Array(n), sr, r, 0.004, 0.03, 300, 900), 0.25);    // bone
  return fin(out, sr, 0.9);
}
function hitIce(sr, r) {
  const n = N(sr, 0.7), out = new Float32Array(n);
  let p = new Float32Array(n);
  burst(p, sr, r, 0.002, 0.0001, 0.0004, 1, [bq(sr, 'hp', 800)]);
  mix(out, p, 1);
  mix(out, shards(new Float32Array(n), sr, r, 0.003, 0.25, 8 + Math.floor(r() * 12), 2500, 7500, 0.05), 0.55);
  p = new Float32Array(n);
  chirp(p, sr, 0.003, 0.2, U(r, 3500, 5000), U(r, 300, 600), 0.02, 1, 0.0008, 0.05);
  mix(out, p, 0.45);
  p = new Float32Array(n);
  burst(p, sr, r, 0.002, 0.001, 0.02, 1, [bq(sr, 'lp', 2500), bq(sr, 'hp', 200)]);
  mix(out, p, 0.4);
  return fin(out, sr, 0.9, 0.05);
}
const PLATE = [[540, 0.3, 0.5], [910, 0.25, 0.45], [1430, 0.2, 0.4], [2210, 0.15, 0.3], [3300, 0.1, 0.2], [4700, 0.07, 0.12]];
function hitMetal(sr, r) {
  const n = N(sr, 0.9), k = U(r, 0.75, 1.3), out = struck(n, sr, r, [[0.002, 1]], { w: 0.0008, ew: 0.00015, body: K([[190, 0.08, 1], [310, 0.06, 0.5]], k), edge: K(PLATE, k), thud: [3000, 0.002], mix: [0.4, 1, 0.5] });
  if (r() < 0.45) {       // the ricochet, whining away
    const p = new Float32Array(n), t = U(r, 0.01, 0.03), f0 = U(r, 2600, 3800), bp = bq(sr, 'bp', f0, 6), d = U(r, 0.3, 0.5);
    chirp(p, sr, t, d + 0.1, f0, f0 * U(r, 0.45, 0.6), d * 0.6, 1, 0.003, d * 0.4);
    for (let i = Math.round(t * sr); i < n; i++) p[i] += bp.run(r() * 2 - 1) * 0.3 * Math.exp(-(i / sr - t) / (d * 0.3));
    mix(out, p, 0.4);
  }
  return fin(out, sr, 0.9, 0.08);
}
function hitConcrete(sr, r) {
  const n = N(sr, 0.6), out = struck(n, sr, r, [[0.002, 1]], { w: 0.0012, body: [[180, 0.03, 1], [300, 0.02, 0.5], [520, 0.015, 0.3]], thud: [6000, 0.0015], mix: [0.6, 0, 1] });
  mix(out, crackles(new Float32Array(n), sr, r, 0.004, 0.25, 90, 500, (u) => 1 - u), 0.45);
  const p = new Float32Array(n);
  burst(p, sr, r, 0.005, 0.01, 0.08, 1, [bq(sr, 'hp', 2000)]);
  mix(out, p, 0.15);
  return fin(out, sr, 0.9, 0.05);
}
function hitSnow(sr, r) {
  const n = N(sr, 0.4), out = new Float32Array(n);
  let p = new Float32Array(n);
  burst(p, sr, r, 0.002, 0.002, 0.014, 1, [bq(sr, 'lp', 700)]);
  mix(out, p, 1);
  p = new Float32Array(n);
  burst(p, sr, r, 0.006, 0.02, 0.1, 1, [bq(sr, 'bp', 3000, 0.7)]);
  mix(out, p, 0.3);
  mix(out, crackles(new Float32Array(n), sr, r, 0.003, 0.06, 250, 1200), 0.25);
  return fin(out, sr, 0.8);
}
function hitWood(sr, r) {
  const n = N(sr, 0.5), k = U(r, 0.85, 1.15), out = struck(n, sr, r, [[0.002, 1]], { w: 0.001, body: K([[420, 0.05, 1], [690, 0.04, 0.6], [1150, 0.03, 0.4]], k), edge: K([[2200, 0.02, 0.5], [3600, 0.015, 0.3]], k), mix: [1, 0.5, 0] });
  mix(out, crackles(new Float32Array(n), sr, r, 0.003, 0.08, 280, 1500, (u) => 1 - u), 0.4);
  return fin(out, sr, 0.9);
}

// ------------------------------------------------------------ picking things up, paper, lockers

function pickup(sr, r) {
  const n = N(sr, 0.35), out = rustle(new Float32Array(n), sr, r, 0, 0.22, 1);
  norm(out, 0.6);
  mix(out, struck(n, sr, r, [[0.05, 1]], { w: 0.003, body: K([[300, 0.04, 1], [520, 0.03, 0.4]], U(r, 0.8, 1.2)), mix: [1, 0, 0] }), 0.5);
  return fin(out, sr, 0.7);
}
// a box of rounds: two shakes, the brass rattling inside the cardboard
function pickupAmmo(sr, r) {
  const n = N(sr, 0.5), out = new Float32Array(n);
  for (const t0 of [0.01, U(r, 0.17, 0.22)]) {
    for (let c = 0, m = 6 + Math.floor(r() * 6); c < m; c++) {
      const e = new Float32Array(n), t = t0 + Math.pow(r(), 1.5) * 0.09;
      pulse(e, sr, t, 0.00015, U(r, 0.3, 1));
      modal(out, e, sr, K([[3400, 0.06, 0.5], [5900, 0.05, 0.4], [8100, 0.04, 0.25]], U(r, 0.85, 1.2)));
    }
  }
  norm(out, 1);
  mix(out, struck(n, sr, r, [[0.012, 1], [0.19, 0.7]], { w: 0.005, body: [[240, 0.03, 1], [410, 0.025, 0.4]], thud: [900, 0.01], mix: [0.8, 0, 0.6] }), 0.5);
  return fin(out, sr, 0.8);
}
// keys on a ring: three of them, each its own ring, knocking together
function pickupKey(sr, r) {
  const n = N(sr, 0.6), out = new Float32Array(n), ks = [U(r, 0.85, 1), U(r, 1.05, 1.2), U(r, 1.25, 1.45)];
  for (let c = 0, m = 8 + Math.floor(r() * 7); c < m; c++) {
    const e = new Float32Array(n), t = 0.01 + Math.pow(r(), 1.3) * 0.38;
    pulse(e, sr, t, 0.0001, U(r, 0.3, 1));
    modal(out, e, sr, K([[2800, 0.25, 0.5], [4700, 0.2, 0.4], [7100, 0.15, 0.3]], pick(r, ks)));
  }
  return fin(out, sr, 0.75, 0.05);
}
// paper unfolded: a crinkle (many tiny folds giving way) over a soft rustle
function paper(sr, r) {
  const n = N(sr, 0.8), out = rustle(new Float32Array(n), sr, r, 0, 0.7, 1), p = new Float32Array(n);
  filt(out, bq(sr, 'lp', 2200));
  norm(out, 1);
  for (let t = 0.02; t < 0.7; t += expo(r, 70 * (0.4 + Math.sin(Math.PI * t / 0.7)))) burst(p, sr, r, t, 0.0002, U(r, 0.0008, 0.005), Math.pow(r(), 1.5), [bq(sr, 'bp', U(r, 2000, 6000), 1.2)]);
  mix(out, p, 1.3);
  return fin(out, sr, 0.75, 0.05);
}
// a thin steel locker: the latch, a short squeak of its hinge, the sheet door wobbling
const LOCKER = [[140, 0.25, 1], [205, 0.2, 0.7], [330, 0.15, 0.5], [515, 0.12, 0.4], [790, 0.09, 0.25]];
function lockerOpen(sr, r) {
  const n = N(sr, 0.9), k = U(r, 0.9, 1.1), out = clacks(n, sr, r, [[0.01, 1]], K(SLIDE, 0.7 * k), K(LOCKER, k), [0.6, 1]);
  const fr = new Float32Array(n), p = new Float32Array(n);
  friction(fr, sr, r, 0.08, 0.5, [[0, 60], [0.5, 220], [1, 160]], 0.0003, (u) => Math.sin(Math.PI * u));
  modal(p, fr, sr, K([[880, 0.15, 0.5], [1420, 0.12, 0.4], [2150, 0.09, 0.3]], k));
  mix(out, p, 0.3);
  mix(out, struck(n, sr, r, [[0.06, 1]], { w: 0.02, body: K(LOCKER, k), mix: [1, 0, 0] }), 0.35);
  return fin(out, sr, 0.85, 0.1);
}
function lockerClose(sr, r) {
  const n = N(sr, 0.75), k = U(r, 0.9, 1.1), out = struck(n, sr, r, [[0.01, 1]], { w: 0.004, ew: 0.0004, body: K([[118, 0.3, 1], [176, 0.25, 0.8], [262, 0.2, 0.6], [410, 0.15, 0.4], [640, 0.1, 0.3]], k), edge: K([[1500, 0.1, 0.4], [2400, 0.08, 0.3], [3600, 0.06, 0.2]], k), thud: [500, 0.02], mix: [1, 0.4, 0.4] });
  mix(out, clacks(n, sr, r, [[0.03, 0.6], [0.07, 0.25], [0.1, 0.12]], K(SLIDE, 0.7 * k), K(LOCKER, k), [0.4, 1]), 0.45);
  return fin(out, sr, 0.9, 0.1);
}

// ------------------------------------------------------------ doors

const WOODDOOR = [[85, 0.18, 1], [132, 0.14, 0.7], [205, 0.1, 0.5], [330, 0.07, 0.35], [520, 0.05, 0.2]];
const LATCH = [[1700, 0.05, 0.4], [2900, 0.04, 0.3], [4300, 0.03, 0.2]];
// fists (or worse) on a door from the other side: fast, uneven, desperate; the latch rattles
function doorBang(sr, r) {
  const n = N(sr, 1.9), hits = [], rat = [];
  let t = 0.01;
  for (let i = 0, c = 3 + Math.floor(r() * 3); i < c; i++) { const a = U(r, 0.7, 1); hits.push([t, a]); rat.push([t + U(r, 0.015, 0.025), a * 0.6], [t + U(r, 0.04, 0.06), a * 0.3]); t += U(r, 0.17, 0.42); }
  const k = U(r, 0.9, 1.1), out = struck(n, sr, r, hits, { w: 0.009, body: K(WOODDOOR, k), thud: [380, 0.03], mix: [1, 0, 0.6] });
  mix(out, struck(n, sr, r, rat, { ew: 0.0003, edge: LATCH, mix: [0, 1, 0] }), 0.3);
  filt(out, bq(sr, 'lp', 2600));
  return fin(out, sr, 0.92, 0.15);
}
// a door swinging slowly by itself: a long creak of the hinge, ragged, rising to a groan
function doorCreak(sr, r) {
  const d = U(r, 1.8, 2.6), n = N(sr, d + 0.4), out = new Float32Array(n), fr = new Float32Array(n), k = U(r, 0.85, 1.15);
  friction(fr, sr, r, 0.05, d, [[0, 14], [0.25, 32], [0.5, 70 * k], [0.7, 140 * k], [0.85, 210 * k], [1, 120 * k]], 0.0005, (u) => smooth(u / 0.15) * (0.6 + 0.4 * Math.sin(TAU * u * 2.2)) * (u > 0.9 ? (1 - u) * 10 : 1));
  modal(out, fr, sr, K([[380, 0.25, 0.5], [610, 0.2, 0.45], [930, 0.16, 0.4], [1420, 0.12, 0.3], [2100, 0.09, 0.2]], k));
  norm(out, 1);
  const p = new Float32Array(n);
  modal(p, fr, sr, K([[150, 0.2, 0.6], [230, 0.15, 0.4]], k));
  mix(out, p, 0.35);
  return fin(out, sr, 0.85, 0.2);
}
function doorLocked(sr, r) {
  const n = N(sr, 0.85), hits = [], thuds = [];
  for (const g0 of [0.02, U(r, 0.33, 0.4)]) { let t = g0; thuds.push([g0 + 0.01, U(r, 0.5, 0.8)]); for (let i = 0; i < 3; i++) { hits.push([t, U(r, 0.6, 1)]); t += U(r, 0.05, 0.09); } }
  const out = struck(n, sr, r, hits, { w: 0.003, ew: 0.00025, body: [[160, 0.05, 0.6], [260, 0.04, 0.3]], edge: [[980, 0.07, 0.5], [1730, 0.06, 0.4], [2650, 0.05, 0.35], [3900, 0.04, 0.25]], mix: [0.5, 1, 0] });
  mix(out, struck(n, sr, r, thuds, { w: 0.008, body: WOODDOOR, mix: [1, 0, 0] }), 0.6);
  return fin(out, sr, 0.9);
}
// Object 7's blast door: the motor straining up, the gears, tons of steel grinding along the
// track, and the boom as it lands, the bolts clanking home
function doorHeavy(sr, r) {
  const n = N(sr, 7), out = new Float32Array(n), tl = U(r, 5.2, 5.6);
  let p = new Float32Array(n);
  const saw = new Osc(SAW()), lp = bq(sr, 'lp', 320), wh = new Osc(tbl('sine', () => table([1, 0.3, 0.15])));
  for (let i = 0; i < N(sr, tl + 0.4); i++) {
    const t = i / sr, e = smooth(t / 0.8) * (t > tl ? Math.max(0, 1 - (t - tl) / 0.3) : 1), f = 38 + 14 * smooth(t / 1.5);
    p[i] = lp.run(saw.step(f, sr)) * e + wh.step(f * 9.3, sr) * e * 0.12;
  }
  mix(out, p, 0.3);
  const fr = new Float32Array(n);
  friction(fr, sr, r, 0.6, tl - 0.05, [[0, 16], [0.4, 28], [0.8, 22], [1, 30]], 0.002, (u) => smooth(u / 0.2) * (0.7 + 0.3 * Math.sin(TAU * u * 5)));
  p = new Float32Array(n);
  modal(p, fr, sr, [[34, 1.2, 1], [51, 1, 0.8], [77, 0.8, 0.6], [115, 0.6, 0.4], [172, 0.45, 0.3], [260, 0.3, 0.2], [390, 0.2, 0.12]]);
  mix(out, p, 0.45);
  p = new Float32Array(n);
  const sw = wander(r, n, sr, 6), sl = bq(sr, 'lp', 1300);
  for (let i = N(sr, 0.6); i < N(sr, tl); i++) p[i] = sl.run(r() * 2 - 1) * (0.5 + 0.5 * sw[i]) * smooth((i / sr - 0.6) / 0.5);
  mix(out, p, 0.2);
  mix(out, struck(n, sr, r, [[tl, 1]], { w: 0.02, ew: 0.002, body: [[28, 2.2, 1], [41, 1.8, 0.8], [57, 1.5, 0.6], [80, 1.2, 0.4], [118, 0.9, 0.3]], edge: [[420, 0.8, 0.3], [690, 0.6, 0.25], [1050, 0.45, 0.2], [1600, 0.3, 0.12]], thud: [220, 0.08], mix: [1, 0.35, 0.6] }), 1.6);
  mix(out, struck(n, sr, r, [[tl + U(r, 0.25, 0.35), 0.8], [tl + U(r, 0.5, 0.6), 0.6]], { w: 0.004, body: [[104, 0.2, 1], [166, 0.15, 0.6]], edge: [[900, 0.2, 0.4], [1500, 0.15, 0.3], [2300, 0.1, 0.2]], mix: [0.8, 0.6, 0] }), 0.45);
  sat(norm(out, 1), 1.4);
  return fin(out, sr, 0.92, 0.5);
}

// ------------------------------------------------------------ metal, ice, glass, lights

function metalScrape(sr, r) {
  const d = U(r, 1.2, 1.8), n = N(sr, d + 0.4), out = new Float32Array(n), fr = new Float32Array(n), k = U(r, 0.85, 1.15);
  friction(fr, sr, r, 0.03, d, [[0, 180], [0.3, 420], [0.6, 350], [1, 520]], 0.0003, (u) => Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(TAU * u * 3.3)));
  modal(out, fr, sr, K([[690, 0.3, 0.5], [1130, 0.25, 0.4], [1580, 0.2, 0.3], [2210, 0.15, 0.2], [3100, 0.1, 0.15]], k));
  norm(out, 1);
  const p = new Float32Array(n), w = wander(r, n, sr, 12), bp = bq(sr, 'bp', 2800, 0.7);
  for (let i = N(sr, 0.03); i < N(sr, d); i++) { const u = (i / sr - 0.03) / (d - 0.03); p[i] = bp.run(r() * 2 - 1) * Math.sin(Math.PI * u) * Math.max(0, 0.4 + 0.6 * w[i]); }
  mix(out, p, 0.4);
  return fin(out, sr, 0.85, 0.2);
}
// a big structure under stress: slow stick-slip through its lowest modes, a low tone sliding
function metalGroan(sr, r) {
  const d = U(r, 2.6, 3.6), n = N(sr, d + 1.2), out = new Float32Array(n), fr = new Float32Array(n), k = U(r, 0.85, 1.15);
  friction(fr, sr, r, 0.05, d, [[0, 9], [0.4, 22], [0.7, 16], [1, 7]], 0.0018, (u) => smooth(u / 0.25) * smooth((1 - u) / 0.3));
  modal(out, fr, sr, K([[44, 1.6, 1], [67, 1.3, 0.8], [99, 1.1, 0.7], [141, 0.9, 0.6], [203, 0.7, 0.5], [288, 0.55, 0.4], [410, 0.4, 0.3]], k));
  norm(out, 1);
  const p = new Float32Array(n), o = new Osc(SAW()), lp = bq(sr, 'lp', 260), pts = [[0, 38 * k], [0.5, 55 * k], [1, 42 * k]];
  for (let i = 0; i < N(sr, d); i++) { const u = i / sr / d; p[i] = lp.run(o.step(curveAt(pts, u), sr)) * Math.sin(Math.PI * u); }
  mix(out, p, 0.3);
  filt(out, bq(sr, 'lp', 1400));
  return fin(out, sr, 0.9, 0.4);
}
// ice giving way close by: the snap, a spray of fractures, the flexural 'pew's (highs first), the
// boom underneath, and a sizzle of small cracks spreading
function iceCrack(sr, r) {
  const n = N(sr, 2.2), out = new Float32Array(n), t0 = 0.004;
  let p = new Float32Array(n);
  burst(p, sr, r, t0, 0.0001, 0.0004, 1, [bq(sr, 'hp', 500)]);
  crackles(p, sr, r, t0, 0.5, 40, 1500, (u) => 1 - u);
  mix(out, p, 1);
  p = new Float32Array(n);
  for (let i = 0, c = 2 + Math.floor(r() * 3); i < c; i++) chirp(p, sr, t0 + (i ? U(r, 0.02, 0.25) : 0), 0.5, U(r, 3500, 5500), U(r, 200, 450), U(r, 0.03, 0.07), i ? U(r, 0.3, 0.7) : 1, 0.001, U(r, 0.08, 0.16));
  mix(out, p, 0.6);
  p = new Float32Array(n);
  chirp(p, sr, t0, 1.4, U(r, 50, 70), U(r, 36, 45), 0.3, 1, 0.006, U(r, 0.25, 0.4));
  burst(p, sr, r, t0, 0.01, 0.35, 0.5, [bq(sr, 'lp', 150)]);
  mix(out, p, 0.6);
  mix(out, crackles(new Float32Array(n), sr, r, 0.3, 1.6, 25, 2500, (u) => (1 - u) * (1 - u)), 0.2);
  return fin(out, sr, 0.92, 0.3);
}
// a wall or a roof of ice coming down: the crack, the crush, chunks landing, the shatter, the roll
function iceCollapse(sr, r) {
  const n = N(sr, 4.8), out = new Float32Array(n);
  mix(out, iceCrack(sr, r).slice(0, n), 0.7);
  let p = new Float32Array(n);
  const cf = [bq(sr, 'lp', 3000), bq(sr, 'hp', 80)];
  for (let c = 0; c < 400; c++) { const t = 0.15 + 2.2 * Math.pow(r(), 1.8); burst(p, sr, r, t, 0.0001, U(r, 0.0005, 0.004), U(r, 0.2, 1) * (1 - t / 2.6), cf); }
  mix(out, p, 0.8);
  const hits = [];
  for (let c = 0, m = 7 + Math.floor(r() * 6); c < m; c++) hits.push([U(r, 0.3, 3.2), U(r, 0.3, 1)]);
  mix(out, struck(n, sr, r, hits, { w: 0.012, body: [[42, 0.4, 1], [63, 0.3, 0.7], [95, 0.2, 0.4]], thud: [400, 0.05], mix: [1, 0, 0.6] }), 0.85);
  mix(out, shards(new Float32Array(n), sr, r, 0.2, 2.5, 60, 2000, 6500, 0.06, 1.4), 0.3);
  p = new Float32Array(n);
  const l1 = bq(sr, 'lp', 110), l2 = bq(sr, 'lp', 110);
  for (let i = 0; i < n; i++) { const t = i / sr; p[i] = l2.run(l1.run(r() * 2 - 1)) * smooth(t / 0.4) * Math.exp(-Math.max(0, t - 0.6) / 1.3); }
  mix(out, p, 0.75);
  sat(norm(out, 1), 1.6);
  return fin(out, sr, 0.92, 0.6);
}
function lightPop(sr, r) {
  const n = N(sr, 0.6), out = new Float32Array(n);
  let p = new Float32Array(n);
  pulse(p, sr, 0.003, 0.0003, 0.001);
  burst(p, sr, r, 0.003, 0.0001, 0.002, 1, [bq(sr, 'hp', 300)]);
  mix(out, p, 1);
  mix(out, shards(new Float32Array(n), sr, r, 0.006, 0.3, 6 + Math.floor(r() * 7), 3000, 9000, 0.04), 0.45);
  p = new Float32Array(n);
  burst(p, sr, r, 0.004, 0.001, 0.04, 1, [bq(sr, 'hp', 3000)]);
  crackles(p, sr, r, 0.004, 0.12, 200, 2500, (u) => 1 - u);
  mix(out, p, 0.3);
  return fin(out, sr, 0.9, 0.05);
}
// the big switch thrown (a lever, an arc's snap), the contactor, and the mains coming up: the
// transformers' hum sliding up to 50 Hz, the tubes' starters pinging, flickering on
function lightsOn(sr, r) {
  const n = N(sr, 3.6), out = new Float32Array(n);
  mix(out, struck(n, sr, r, [[0.02, 1], [0.36, 0.6]], { w: 0.005, ew: 0.0004, body: [[104, 0.11, 1], [166, 0.08, 0.6], [262, 0.06, 0.3]], edge: [[1420, 0.09, 0.5], [2510, 0.07, 0.4], [3800, 0.05, 0.3]], thud: [500, 0.01], mix: [1, 0.6, 0.3] }), 1);
  let p = new Float32Array(n);
  burst(p, sr, r, 0.025, 0.0002, 0.005, 1, [bq(sr, 'hp', 2000)]);
  crackles(p, sr, r, 0.025, 0.07, 300, 1500);
  mix(out, p, 0.45);
  p = new Float32Array(n);
  const ph = new Float64Array(12);
  for (let i = N(sr, 0.4); i < n; i++) {
    const t = i / sr - 0.4, f = 50 - 22 * Math.exp(-t / 0.35), e = smooth(t / 1.2) * (0.85 + 0.15 * Math.sin(TAU * 0.7 * t));
    let y = 0;
    for (let h = 0; h < 12; h++) { ph[h] += TAU * f * (h + 1) / sr; y += Math.sin(ph[h]) / Math.pow(h + 1, h & 1 ? 0.9 : 1.3); }
    p[i] = y * e;
  }
  for (let c = 0, m = 3 + Math.floor(r() * 3); c < m; c++) {         // a tube catching
    const t = U(r, 0.7, 2.3), a = Math.round(t * sr), d = N(sr, U(r, 0.03, 0.09));
    for (let i = 0; i < d && a + i < n; i++) p[a + i] *= 1.6;
    burst(p, sr, r, t, 0.0001, 0.0006, 2, [bq(sr, 'hp', 2500)]);
  }
  mix(out, p, 0.45);
  return fin(out, sr, 0.9, 0.3);
}

// ------------------------------------------------------------ the Turned

// a frozen joint giving way: a knuckle's pop, the bone's knock, a little ice 'pew'
function jointPop(out, sr, r, t, amp) {
  ring(out, sr, t, amp, K([[1400, 0.03, 1], [2300, 0.025, 0.7], [3600, 0.02, 0.5], [5100, 0.015, 0.3]], U(r, 0.8, 1.25)));
  ring(out, sr, t, amp * 0.8, [[U(r, 160, 220), 0.03, 1]]);
  chirp(out, sr, t + 0.001, 0.06, U(r, 4000, 6000), U(r, 700, 1100), 0.008, amp * 0.25, 0.0005, 0.02);
}
// wet: bubbles and clicks of a throat full of meltwater
function wet(out, sr, r, t0, span, rate, f0 = 200, f1 = 800) {
  for (let t = t0 + expo(r, rate); t < t0 + span; t += expo(r, rate)) bubble(out, sr, t, U(r, f0, f1), U(r, 0.005, 0.018), Math.pow(r(), 1.3), U(r, 1.5, 3.5));
  return out;
}
// the finish for a creature's voice: the throat and the ice mixed at their levels, a top and a floor
function beast(parts, sr, lp = 5200, hp = 60, fout = 0.1) {
  const out = new Float32Array(parts[0][0].length);
  for (const [p, l] of parts) if (l) mix(out, p, l);
  filt(out, bq(sr, 'hp', hp), bq(sr, 'lp', lp));
  return fin(out, sr, 0.9, fout);
}

// breathing that isn't: a creaking, rattling intake through a throat of ice (the cords in fry, a
// few beats a second), then a long, wet, open-jawed groan out; ice crackling in the skin
function turnedIdle(sr, r) {
  const ti = U(r, 0.7, 1.1), te = U(r, 1.3, 2.2), n = N(sr, ti + te + 0.5), k = U(r, 0.85, 1.15);
  const v = new Float32Array(n), w = new Float32Array(n), c = new Float32Array(n);
  voice(v, sr, r, { t0: 0.02, d: ti, f0: (u) => (30 + 16 * u) * k, F: (u) => [450 + 150 * u, 1150, 2400, 3300], amp: (u) => Math.pow(Math.sin(Math.PI * u), 0.7) * 0.7, asp: () => 0.7, glot: { open: 0.4, close: 0.1, jitter: 0.25, shimmer: 0.5, sub: 0.5 }, rough: [U(r, 18, 30), 0.7] });
  voice(v, sr, r, { t0: ti + 0.15, d: te, f0: (u) => (72 - 26 * u) * k, F: (u) => [620 - 120 * u, 1050 - 150 * u, 2300, 3200], amp: (u) => smooth(u / 0.15) * Math.pow(1 - u, 0.8), asp: (u) => 0.45 + 0.4 * u, glot: { jitter: 0.12, shimmer: 0.4, sub: 0.45 }, rough: [U(r, 35, 55), 0.5] });
  wet(w, sr, r, 0, ti + te, 9);
  crackles(c, sr, r, 0, ti + te + 0.3, 22, 2500);
  for (let i = 0, m = Math.floor(r() * 3); i < m; i++) jointPop(c, sr, r, U(r, 0.1, ti + te), U(r, 1, 3));
  return beast([[v, 1], [w, 0.22], [c, 0.25]], sr);
}
// it has heard you: a whistling intake, then the croak, a slowing train of clicks (the cords
// slapping shut, too slow to be a voice)
function turnedAlert(sr, r) {
  const n = N(sr, 1.7), k = U(r, 0.9, 1.1), v = new Float32Array(n), cr = new Float32Array(n), c = new Float32Array(n);
  voice(v, sr, r, { t0: 0.01, d: 0.28, f0: (u) => (420 + 300 * u) * k, F: (u) => [600, 1500 + 600 * u, 2900, 3900], amp: (u) => smooth(u / 0.2) * (1 - u * 0.5), asp: () => 0.85, glot: { jitter: 0.1, shimmer: 0.4 } });
  voice(cr, sr, r, { t0: 0.3, d: U(r, 0.9, 1.2), f0: (u) => (24 - 11 * u) * k, F: () => [480, 1250, 2500, 3400], bw: [80, 100, 160, 250], amp: (u) => smooth(u / 0.05) * Math.pow(1 - u, 0.6), asp: () => 0.1, glot: { open: 0.15, close: 0.05, jitter: 0.25, shimmer: 0.4 } });
  crackles(c, sr, r, 0.2, 1.2, 30, 2500);
  jointPop(c, sr, r, U(r, 0.25, 0.5), 3);
  return beast([[v, 0.6], [cr, 1], [c, 0.25]], sr);
}
// The scream: two throats (the second a tritone up, rougher), the pitch leaping and wavering, the
// cords period-doubling and the whole thing chopped into a rattle, an ice crack as the jaw splits
// open. k scales the pitch; Gromov's is the same thing, lower, three throats.
function turnedScream(sr, r) {
  const d = U(r, 1.6, 2.3), n = N(sr, d + 0.3), k = U(r, 0.88, 1.12), a = new Float32Array(n), b = new Float32Array(n), c = new Float32Array(n);
  const pts = [[0, 220], [0.12, 560], [0.5, 620], [0.8, 480], [1, 300]], wob = wander(r, N(sr, d) + 1, sr, 9);
  const amp = (u) => smooth(u / 0.05) * (u > 0.75 ? smooth((1 - u) / 0.25) : 1);
  voice(a, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * k * (1 + 0.04 * Math.sin(TAU * 7 * u * d) + 0.04 * wob[Math.floor(u * (wob.length - 1))]), F: (u) => [850 + 100 * Math.sin(Math.PI * u), 1350, 2900, 3800], amp, asp: () => 0.35, glot: { open: 0.45, close: 0.08, jitter: 0.08, shimmer: 0.35, sub: 0.5 }, rough: [U(r, 70, 95), 0.55] });
  voice(b, sr, r, { t0: 0.05, d: d * 0.9, f0: (u) => curveAt(pts, u) * k * 1.414, F: () => [950, 1700, 3100, 4100], amp, asp: () => 0.45, glot: { open: 0.4, close: 0.07, jitter: 0.12, shimmer: 0.5, sub: 0.6 }, rough: [U(r, 40, 60), 0.6] });
  jointPop(c, sr, r, 0.01, 4); jointPop(c, sr, r, 0.03, 2);
  crackles(c, sr, r, 0, d, 35, 2500);
  const out = beast([[a, 1], [b, 0.55], [c, 0.3]], sr, 7000, 120);
  return fin(sat(out, 2.2), sr, 0.92, 0.1);
}
// the lunge: a short shriek, the air of it, the teeth snapping shut twice
function turnedAttack(sr, r) {
  const d = U(r, 0.45, 0.65), n = N(sr, d + 0.35), k = U(r, 0.9, 1.1), v = new Float32Array(n), j = new Float32Array(n), air = new Float32Array(n);
  const pts = [[0, 200], [0.25, 480], [0.7, 420], [1, 250]];
  voice(v, sr, r, { t0: 0.01, d, f0: (u) => curveAt(pts, u) * k, F: (u) => [900 - 200 * u, 1400, 2900, 3900], amp: (u) => smooth(u / 0.05) * (u > 0.7 ? smooth((1 - u) / 0.3) : 1), asp: () => 0.4, glot: { open: 0.45, close: 0.08, jitter: 0.1, shimmer: 0.4, sub: 0.55 }, rough: [U(r, 60, 90), 0.6] });
  sat(norm(v, 1), 2.5);
  ring(j, sr, d + 0.02, 1, [[2200, 0.02, 1], [3500, 0.015, 0.7], [5100, 0.012, 0.4], [260, 0.04, 1.5]]);
  ring(j, sr, d + 0.09, 0.6, [[2300, 0.02, 1], [3600, 0.015, 0.7], [270, 0.04, 1.5]]);
  burst(air, sr, r, 0.01, 0.1, 0.15, 1, [bq(sr, 'bp', 700, 0.6)]);
  return beast([[v, 1], [j, 0.45], [air, 0.25]], sr, 7000, 100);
}
function turnedHurt(sr, r) {
  const d = U(r, 0.35, 0.5), n = N(sr, d + 0.3), k = U(r, 0.9, 1.15), v = new Float32Array(n), c = new Float32Array(n);
  const pts = [[0, 300], [0.3, 520], [1, 260]];
  voice(v, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * k, F: () => [800, 1300, 2800, 3700], amp: (u) => smooth(u / 0.06) * Math.pow(1 - u, 0.7), asp: () => 0.4, glot: { jitter: 0.12, shimmer: 0.45, sub: 0.5 }, rough: [U(r, 50, 80), 0.5] });
  sat(norm(v, 1), 2);
  jointPop(c, sr, r, 0.005, 3);
  crackles(c, sr, r, 0, 0.25, 80, 2000, (u) => 1 - u);
  return beast([[v, 1], [c, 0.4]], sr, 6500, 100);
}
// it goes down: the scream collapsing into a long falling groan, the rattle slowing, meltwater in
// the throat, ice breaking off it, and the body folding to the floor
function turnedDeath(sr, r) {
  const d = U(r, 2.1, 2.7), n = N(sr, d + 0.6), k = U(r, 0.9, 1.1), v = new Float32Array(n), w = new Float32Array(n), c = new Float32Array(n);
  const pts = [[0, 380], [0.2, 300], [0.6, 120], [1, 45]];
  voice(v, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * k, F: (u) => [800 - 300 * u, 1300 - 300 * u, 2700, 3500], amp: (u) => smooth(u / 0.04) * Math.pow(1 - u, 0.7), asp: (u) => 0.3 + 0.5 * u, glot: { jitter: 0.1, shimmer: 0.45, sub: 0.5 }, rough: [U(r, 30, 45), 0.6] });
  wet(w, sr, r, d * 0.4, d * 0.6, 25, 150, 600);
  crackles(c, sr, r, 0.3, 1.2, 60, 1800, (u) => 1 - u);
  const out = beast([[v, 1], [w, 0.3], [c, 0.3]], sr);
  mix(out, struck(n, sr, r, [[d * 0.85, 1], [d * 0.85 + 0.12, 0.5]], { w: 0.015, body: [[62, 0.12, 1], [95, 0.09, 0.7], [140, 0.07, 0.4]], thud: [300, 0.04], mix: [1, 0, 0.6] }), 0.6);
  return fin(out, sr, 0.9, 0.2);
}
// a bare, frozen foot: the heel's thud, the toes, and the joints cracking with the weight on them
function turnedStep(sr, r) {
  const n = N(sr, 0.5), out = struck(n, sr, r, [[0.005, 1], [0.005 + U(r, 0.04, 0.08), U(r, 0.3, 0.6)]], { w: 0.007, body: K([[70, 0.09, 1], [118, 0.06, 0.5], [190, 0.045, 0.25]], U(r, 0.9, 1.1)), thud: [600, 0.02], mix: [1, 0, 0.6] });
  const j = new Float32Array(n), c = new Float32Array(n);
  jointPop(j, sr, r, U(r, 0, 0.15), 1);
  if (r() < 0.5) jointPop(j, sr, r, U(r, 0.12, 0.3), U(r, 0.4, 0.8));
  crackles(c, sr, r, 0, 0.3, 30, 2500);
  mix(out, j, 0.5);
  mix(out, c, 0.15);
  return fin(out, sr, 0.9, 0.05);
}
// dragging itself along the floor: the body's scrape jerking with each pull, the hands slapping
// down, nails dragging, the joints
function turnedCrawl(sr, r) {
  const d = U(r, 1.3, 1.8), n = N(sr, d + 0.3), out = new Float32Array(n), pull = U(r, 1.6, 2.4);
  let p = new Float32Array(n);
  const bp = bq(sr, 'bp', 900, 0.7);
  for (let i = 0; i < N(sr, d); i++) { const t = i / sr, ph = (t * pull) % 1, e = Math.pow(Math.sin(Math.PI * ph), 2) * smooth(t / 0.1) * smooth((d - t) / 0.2); p[i] = bp.run(r() * 2 - 1) * e; }
  mix(out, p, 0.55);
  const hits = [];
  for (let t = 0.02; t < d - 0.1; t += 1 / pull) hits.push([t + U(r, -0.02, 0.02), U(r, 0.6, 1)]);
  mix(out, struck(n, sr, r, hits, { w: 0.006, body: [[90, 0.06, 1], [150, 0.04, 0.5]], thud: [700, 0.015], mix: [1, 0, 0.7] }), 0.8);
  const fr = new Float32Array(n);
  for (const [t] of hits) if (r() < 0.6) friction(fr, sr, r, t + 0.03, t + U(r, 0.15, 0.3), [[0, 300], [1, 700]], 0.0002, (u) => Math.sin(Math.PI * u));
  p = new Float32Array(n);
  modal(p, fr, sr, [[2600, 0.05, 0.5], [3900, 0.04, 0.4], [5400, 0.03, 0.3]]);
  mix(out, p, 0.25);
  p = new Float32Array(n);
  for (let i = 0, m = 2 + Math.floor(r() * 3); i < m; i++) jointPop(p, sr, r, U(r, 0, d), 1);
  crackles(p, sr, r, 0, d, 25, 2500);
  mix(out, p, 0.35);
  return fin(out, sr, 0.9, 0.1);
}

// ------------------------------------------------------------ polar bears

// the jaw popping: the teeth clacking shut, the jaw's hollow knock (a threat display)
function jawPop(out, sr, r, t, amp) {
  ring(out, sr, t, amp, K([[2200, 0.02, 1], [3500, 0.015, 0.7], [5100, 0.012, 0.4]], U(r, 0.85, 1.15)));
  ring(out, sr, t, amp * 1.5, [[U(r, 230, 300), 0.05, 1], [U(r, 420, 520), 0.03, 0.5]]);
}
const BEAR = (k) => [380 * k, 880 * k, 2100, 2900];
// huffs: hard blasts of breath through the nose, and the jaw popping between
function bearHuff(sr, r) {
  const n = N(sr, 1.6), k = U(r, 0.9, 1.1), v = new Float32Array(n), j = new Float32Array(n);
  let t = 0.01;
  for (let i = 0, c = 2 + Math.floor(r() * 3); i < c && t < 1.3; i++) {
    const d = U(r, 0.12, 0.22);
    voice(v, sr, r, { t0: t, d, f0: () => 55 * k, F: () => BEAR(k), bw: [180, 220, 300, 400], amp: (u) => Math.min(1, u / 0.06) * Math.pow(1 - u, 1.5), asp: () => 0.9, glot: { jitter: 0.1, shimmer: 0.4, sub: 0.3 } });
    t += d + U(r, 0.12, 0.25);
  }
  if (r() < 0.75) for (let i = 0, c = 2 + Math.floor(r() * 3); i < c; i++) jawPop(j, sr, r, U(r, 0.08, Math.min(1.4, t)), U(r, 0.5, 1));
  return beast([[v, 1], [j, 0.45]], sr, 3000, 50);
}
// a deep growl: the cords slow and period-doubled, fluttering, a big low tract; now and then the jaw
function bearGrowl(sr, r) {
  const d = U(r, 1.8, 2.6), n = N(sr, d + 0.3), k = U(r, 0.88, 1.1), v = new Float32Array(n), j = new Float32Array(n);
  const pts = [[0, 46], [0.3, 60], [0.7, 54], [1, 42]];
  voice(v, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * k, F: (u) => [350 * k + 60 * Math.sin(Math.PI * u), 760 * k, 2000, 2900], bw: [150, 200, 280, 350], amp: (u) => smooth(u / 0.12) * (u > 0.8 ? smooth((1 - u) / 0.2) : 1) * (0.8 + 0.2 * Math.sin(TAU * u * 2.3)), asp: () => 0.25, glot: { open: 0.5, close: 0.18, jitter: 0.06, shimmer: 0.3, sub: 0.45 }, rough: [U(r, 22, 32), 0.6] });
  if (r() < 0.5) jawPop(j, sr, r, U(r, 0.2, d), 1);
  const out = beast([[v, 1], [j, 0.35]], sr, 2500, 35);
  filt(out, bq(sr, 'peak', 120, 1, 6));
  return fin(sat(norm(out, 1), 1.4), sr, 0.92, 0.1);
}
// the roar: up and over and down, the mouth opening wide, rough with the cords' doubling
function bearRoar(sr, r) {
  const d = U(r, 2, 2.6), n = N(sr, d + 0.3), k = U(r, 0.9, 1.1), v = new Float32Array(n);
  const pts = [[0, 70], [0.2, 150], [0.55, 130], [1, 65]];
  voice(v, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * k * (1 + 0.02 * Math.sin(TAU * 6 * u * d)), F: (u) => { const o = Math.sin(Math.PI * Math.min(1, u * 1.3)); return [400 + 300 * o, 900 + 300 * o, 2400, 3300]; }, bw: [150, 200, 300, 400], amp: (u) => smooth(u / 0.1) * (u > 0.75 ? smooth((1 - u) / 0.25) : 1), asp: () => 0.3, glot: { open: 0.5, close: 0.15, jitter: 0.05, shimmer: 0.3, sub: 0.35 }, rough: [U(r, 26, 34), 0.35] });
  const out = beast([[v, 1]], sr, 3500, 40);
  filt(out, bq(sr, 'peak', 140, 1, 6));
  return fin(sat(norm(out, 1), 1.7), sr, 0.95, 0.12);
}
function bearHurt(sr, r) {
  const d = U(r, 0.7, 1), n = N(sr, d + 0.3), k = U(r, 0.9, 1.1), v = new Float32Array(n);
  const pts = [[0, 120], [0.3, 230], [1, 110]];
  voice(v, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * k, F: (u) => [650, 1100, 2400, 3200], bw: [150, 200, 300, 400], amp: (u) => smooth(u / 0.05) * Math.pow(1 - u, 0.6), asp: () => 0.35, glot: { jitter: 0.08, shimmer: 0.35, sub: 0.4 }, rough: [U(r, 28, 36), 0.35] });
  return fin(sat(beast([[v, 1]], sr, 3500, 50), 1.6), sr, 0.92, 0.1);
}
function bearDeath(sr, r) {
  const d = U(r, 2.4, 3), n = N(sr, d + 0.9), k = U(r, 0.9, 1.1), v = new Float32Array(n);
  const pts = [[0, 95], [0.3, 75], [1, 35]];
  voice(v, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * k, F: (u) => [600 - 200 * u, 1000 - 150 * u, 2300, 3100], bw: [150, 200, 300, 400], amp: (u) => smooth(u / 0.08) * Math.pow(1 - u, 0.9), asp: (u) => 0.3 + 0.6 * u, glot: { jitter: 0.1, shimmer: 0.4, sub: 0.45 }, rough: [U(r, 20, 30), 0.5] });
  const out = beast([[v, 1]], sr, 3000, 35);
  mix(out, struck(n, sr, r, [[d * 0.8, 1], [d * 0.8 + 0.15, 0.4]], { w: 0.025, body: [[40, 0.3, 1], [62, 0.22, 0.7], [90, 0.15, 0.4]], thud: [450, 0.06], mix: [1, 0, 0.8] }), 0.8);
  return fin(out, sr, 0.92, 0.2);
}
// a heavy padded paw: the snow compressing (a dense crunch), the weight landing
function bearStep(sr, r) {
  const n = N(sr, 0.45), out = struck(n, sr, r, [[0.005, 1]], { w: 0.012, body: [[55, 0.08, 1], [90, 0.06, 0.5]], thud: [500, 0.03], mix: [1, 0, 0.7] });
  const p = new Float32Array(n), cf = [bq(sr, 'lp', 3500), bq(sr, 'hp', 300)];
  for (let c = 0, m = 60 + Math.floor(r() * 60); c < m; c++) { const t = 0.005 + 0.15 * Math.pow(r(), 1.5); burst(p, sr, r, t, 0.0001, U(r, 0.0003, 0.002), U(r, 0.2, 1) * (1 - t / 0.2), cf); }
  mix(out, p, 0.7);
  return fin(out, sr, 0.9);
}

// ------------------------------------------------------------ Gromov, the Guest

// Gromov: the Turned's scream an octave down and doubled, three throats beating against each other,
// the ice armour on him rattling, saturated to the edge
function gromovRoar(sr, r) {
  const d = U(r, 2.6, 3.2), n = N(sr, d + 0.4), k = U(r, 0.9, 1.05), out = new Float32Array(n);
  const pts = [[0, 110], [0.15, 260], [0.5, 290], [0.8, 220], [1, 130]];
  const amp = (u) => smooth(u / 0.08) * (u > 0.8 ? smooth((1 - u) / 0.2) : 1);
  for (const [mul, lvl, sub, rr] of [[1, 1, 0.5, 70], [1.07, 0.7, 0.4, 85], [0.5, 0.8, 0.6, 30]]) {
    const p = new Float32Array(n);
    voice(p, sr, r, { t0: 0.03, d, f0: (u) => curveAt(pts, u) * k * mul * (1 + 0.03 * Math.sin(TAU * 5 * u * d)), F: (u) => [600 + 130 * Math.sin(Math.PI * u), 980, 2150, 2900], bw: [130, 160, 240, 320], amp, asp: () => 0.3, glot: { open: 0.45, close: 0.1, jitter: 0.08, shimmer: 0.4, sub }, rough: [rr * U(r, 0.9, 1.1), 0.5] });
    mix(out, p, lvl);
  }
  const c = crackles(new Float32Array(n), sr, r, 0, d, 60, 1800);
  jointPop(c, sr, r, 0.01, 5);
  mix(out, c, 0.35);
  filt(out, bq(sr, 'peak', 110, 1, 5), bq(sr, 'hp', 40), bq(sr, 'lp', 6000));
  return fin(sat(norm(out, 1), 3), sr, 0.95, 0.15);
}
// a stomp under his weight, and the ice plates on him clinking like glass
function gromovStep(sr, r) {
  const n = N(sr, 0.8), out = struck(n, sr, r, [[0.005, 1]], { w: 0.012, body: K([[38, 0.25, 1], [57, 0.2, 0.7], [83, 0.15, 0.5], [125, 0.1, 0.3]], U(r, 0.9, 1.1)), thud: [400, 0.04], mix: [1, 0, 0.7] });
  const p = new Float32Array(n);
  for (let i = 0, m = 3 + Math.floor(r() * 4); i < m; i++) ring(p, sr, 0.01 + U(r, 0, 0.12), U(r, 0.3, 1), K([[2100, 0.15, 1], [3300, 0.12, 0.6], [4700, 0.09, 0.4], [6900, 0.06, 0.25]], U(r, 0.85, 1.2)));
  crackles(p, sr, r, 0, 0.3, 60, 2000);
  jointPop(p, sr, r, U(r, 0.05, 0.2), 2);
  mix(out, p, 0.35);
  return fin(sat(norm(out, 1), 1.5), sr, 0.92, 0.1);
}
// The Guest's pulse: an enormous, slow heartbeat deep in the ice (lub ... dub), so low it's felt more
// than heard; the ice around it rings after each blow, glassy and inharmonic, and creaks as it settles
function guestPulse(sr, r) {
  const n = N(sr, 3.2), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n), td = U(r, 0.45, 0.55), k = U(r, 0.94, 1.06);
  pulse(exc, sr, 0.02, 0.06, 1); pulse(exc, sr, 0.02 + td, 0.05, 0.65);
  pulse(edge, sr, 0.03, 0.002, 1); pulse(edge, sr, 0.03 + td, 0.002, 0.5);
  let p = new Float32Array(n);
  modal(p, exc, sr, K([[22, 0.9, 1], [31, 0.7, 0.7], [44, 0.5, 0.4], [63, 0.35, 0.2]], k));
  sat(norm(p, 1), 1.8);          // (its harmonics carry it on small speakers)
  mix(out, p, 1);
  p = new Float32Array(n);
  modal(p, edge, sr, K([[312, 1.6, 0.4], [497, 1.3, 0.35], [781, 1.1, 0.3], [1163, 0.9, 0.2], [1720, 0.7, 0.12], [2550, 0.5, 0.08]], k * U(r, 0.97, 1.03)));
  mix(out, p, 0.16);
  p = new Float32Array(n);
  burst(p, sr, r, 0.02, 0.03, 0.25, 1, [bq(sr, 'lp', 90)]);
  burst(p, sr, r, 0.02 + td, 0.03, 0.2, 0.6, [bq(sr, 'lp', 90)]);
  mix(out, p, 0.45);
  const fr = new Float32Array(n);
  friction(fr, sr, r, td + 0.2, td + U(r, 1.3, 2), [[0, 9], [0.5, 15], [1, 8]], 0.0015, (u) => Math.sin(Math.PI * u));
  p = new Float32Array(n);
  modal(p, fr, sr, [[180, 0.4, 1], [260, 0.3, 0.7], [410, 0.25, 0.5]]);
  mix(out, p, 0.12);
  return fin(out, sr, 0.95, 0.3);
}

// ------------------------------------------------------------ the Shades, the mimic

// whispers: two or three of them, close together and apart, in syllables that are nearly Russian;
// smeared by a few short echoes so they seem to come from nowhere in particular
function shadeWhisper(sr, r) {
  const d = U(r, 2.4, 3.6), n = N(sr, d + 0.9), L = new Float32Array(n), R = new Float32Array(n);
  for (let v = 0, c = 2 + Math.floor(r() * 2); v < c; v++) {
    const p = whisper(new Float32Array(n), sr, r, U(r, 0, 0.5), d * U(r, 0.6, 0.9), { tract: U(r, 0.95, 1.25), rate: U(r, 0.85, 1.2), amp: (u) => smooth(u / 0.3) * (1 - 0.5 * u) });
    pan2(L, R, p, U(r, -0.8, 0.8), U(r, 0.5, 1));
  }
  for (const ch of [L, R]) {
    const c = filt(ch.slice(), bq(sr, 'lp', 3000));
    put(ch, c, sr, U(r, 0.03, 0.07), 0.35);
    put(ch, c, sr, U(r, 0.11, 0.17), 0.18);
    filt(ch, bq(sr, 'hp', 400));
  }
  return fin2(L, R, sr, 0.85, 0.2);
}
// a breathy wail: an 'oo' opening to 'ah' and closing, mostly breath, a thin high voice inside it
function shadeWail(sr, r) {
  const d = U(r, 2.8, 3.8), n = N(sr, d + 1), out = new Float32Array(n), p = new Float32Array(n);
  const f0 = U(r, 480, 700), pts = [[0, f0 * 0.8], [0.3, f0 * 1.15], [0.65, f0], [1, f0 * 0.6]];
  voice(p, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * (1 + 0.025 * Math.sin(TAU * 5.5 * u * d)), F: (u) => { const o = Math.sin(Math.PI * u); return [350 + 450 * o, 800 + 400 * o, 2600, 3600]; }, amp: (u) => Math.pow(Math.sin(Math.PI * u), 1.5), asp: (u) => 0.75 - 0.25 * Math.sin(Math.PI * u), glot: { jitter: 0.015, shimmer: 0.1 } });
  mix(out, p, 1);
  for (const [t, g] of [[0.11, 0.4], [0.23, 0.25], [0.37, 0.15]]) put(out, filt(p.slice(), bq(sr, 'lp', 2500 - t * 3000)), sr, t, g);
  const q = new Float32Array(n), bp = new BQ(sr);
  for (let i = 0; i < N(sr, d); i++) { const u = i / sr / d; if ((i & 63) === 0) bp.set('bp', curveAt(pts, u) * 2, 12); q[i] = bp.run(r() * 2 - 1) * Math.sin(Math.PI * u); }
  mix(out, q, 0.3);
  filt(out, bq(sr, 'hp', 300));
  return fin(out, sr, 0.85, 0.4);
}
// a cold touch: a sudden breath at your ear, frost racing over the skin, a glassy shimmer, a low
// cold knock under it
function shadeTouch(sr, r) {
  const n = N(sr, 1.8), out = new Float32Array(n);
  let p = new Float32Array(n);
  voice(p, sr, r, { t0: 0.005, d: 0.5, f0: () => 200, F: (u) => [400, 1100 + 900 * u, 2600, 3500], amp: (u) => Math.min(1, u / 0.03) * Math.pow(1 - u, 1.2), asp: () => 1 });
  mix(out, p, 0.8);
  mix(out, crackles(new Float32Array(n), sr, r, 0.02, 1.3, 400, 3000, (u) => Math.sin(Math.PI * Math.min(1, u * 1.6))), 0.45);
  p = new Float32Array(n);
  for (const f of [1960, 2771, 3520, 4890, 6230]) ring(p, sr, 0.01 + U(r, 0, 0.05), U(r, 0.3, 1), [[f * U(r, 0.97, 1.03), U(r, 0.8, 1.4), 1]]);
  mix(out, p, 0.22);
  mix(out, struck(n, sr, r, [[0.004, 1]], { w: 0.02, body: [[48, 0.3, 1], [71, 0.2, 0.5]], mix: [1, 0, 0] }), 0.55);
  return fin(out, sr, 0.9, 0.3);
}
// The mimic: a man's or a woman's voice, nearly words, read back at a wandering speed (pitch and
// formants sliding together, like a stretched tape), stuttering on a syllable, sagging at the end,
// with another voice inside it a little behind, ring-modulated into something that isn't a throat
function mimicVoice(sr, r) {
  const d = U(r, 2.6, 4.2), raw = babble(sr, r, d * 1.3 + 0.4, { pitch: r() < 0.5 ? U(r, 95, 130) : U(r, 180, 230), rate: U(r, 0.85, 1.05), tract: U(r, 0.92, 1.12) });
  const n = N(sr, d), out = new Float32Array(n), dbl = new Float32Array(n), w = wander(r, n, sr, 1.1), w2 = wander(r, n, sr, 7);
  const stutters = [];
  for (let i = 0, c = 1 + Math.floor(r() * 3); i < c; i++) stutters.push(Math.floor(U(r, 0.1, 0.8) * n));
  stutters.sort((a, b) => a - b);
  const at = (x) => { const i = x | 0; return i < 0 || i + 1 >= raw.length ? 0 : raw[i] + (raw[i + 1] - raw[i]) * (x - i); };
  const lag = 0.023 * sr, rm = U(r, 30, 55);
  let pos = 0, si = 0, ls = 0, ll = 0, rep = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, rate = (1 + 0.3 * w[i] + 0.06 * w2[i]) * (u > 0.65 ? 1 - 0.55 * (u - 0.65) : 1);
    if (si < stutters.length && i >= stutters[si]) { ls = pos; ll = U(r, 0.06, 0.14) * sr; rep = 2 + Math.floor(r() * 3); si++; }
    if (rep > 0 && pos >= ls + ll) { pos = ls; rep--; }
    out[i] = at(pos);
    dbl[i] = at(pos * 0.996 - lag) * Math.sin(TAU * rm * i / sr);
    pos += rate;
  }
  norm(out, 1);
  mix(out, dbl, 0.35);
  filt(out, bq(sr, 'hp', 120), bq(sr, 'lp', 4500));
  const e = Math.round(0.15 * sr);
  for (let i = 0; i < e; i++) out[n - 1 - i] *= i / e;
  return fin(sat(norm(out, 1), 1.3), sr, 0.85, 0.1);
}

// ------------------------------------------------------------ the station's machines, the world

// one cylinder's firings [t, amp]: the thump on the block's low modes, the exhaust's bark, the
// injector's knock ringing the head
function diesel(n, sr, r, fires) {
  const thump = new Float32Array(n), bark = new Float32Array(n), knock = new Float32Array(n), bf = [bq(sr, 'bp', 240, 1.3), bq(sr, 'lp', 900)];
  for (const [t, a] of fires) { pulse(thump, sr, t, 0.004, a); burst(bark, sr, r, t + 0.002, 0.0015, 0.014, a, bf); pulse(knock, sr, t + 0.0015, 0.00025, a * U(r, 0.6, 1.2)); }
  const out = new Float32Array(n);
  let p = new Float32Array(n);
  modal(p, thump, sr, [[52, 0.08, 1], [104, 0.06, 0.5], [160, 0.04, 0.25]]);
  mix(out, p, 1);
  mix(out, bark, 0.55);
  p = new Float32Array(n);
  modal(p, knock, sr, [[900, 0.04, 0.5], [1450, 0.035, 0.4], [2300, 0.03, 0.3], [3400, 0.02, 0.15]]);
  mix(out, p, 0.3);
  return filt(out, bq(sr, 'hp', 30, 0.6));
}
// the starter motor's whine (f0 -> f1) and the compression strokes it drags round (rate0 -> rate1)
function starter(n, sr, r, t0, t1, f0, f1, rate0, rate1) {
  const w = new Float32Array(n), saw = new Osc(SAW8()), lp = bq(sr, 'lp', 2500), exc = new Float32Array(n), p = new Float32Array(n);
  for (let i = N(sr, t0); i < Math.min(n, N(sr, t1)); i++) {
    const t = i / sr, u = (t - t0) / (t1 - t0), f = f0 + (f1 - f0) * smooth(u * 1.4);
    w[i] = lp.run(saw.step(f, sr)) * smooth((t - t0) / 0.1) * smooth((t1 - t) / 0.12);
  }
  for (let t = t0 + 0.05; t < t1;) { const u = (t - t0) / (t1 - t0); pulse(exc, sr, t, 0.008, U(r, 0.7, 1)); t += 1 / (rate0 + (rate1 - rate0) * u); }
  modal(p, exc, sr, [[46, 0.12, 1], [92, 0.08, 0.5]]);
  norm(p, 1);
  return mix(p, w, 0.35);
}
// the station's generator: cranked, catching, the firings running up past speed and settling
function generatorStart(sr, r) {
  const n = N(sr, 4.6), out = starter(n, sr, r, 0, 1.55, 160, 420, 3, 5.5), fires = [[1.2, 0.8], [1.42, 0.6], [1.55, 1]];
  let t = 1.7, rate = 8;
  while (t < 4.6) { fires.push([t + U(r, -0.001, 0.001), (t < 2.6 ? 1 : 0.75) * U(r, 0.9, 1.1)]); const goal = t < 2.7 ? 24 : 21; rate += (goal - rate) * Math.min(1, (1 / rate) / 0.35); t += 1 / rate; }
  mix(out, diesel(n, sr, r, fires), 1.1);
  return fin(out, sr, 0.92, 0.25);
}
// it won't: cranking slower as the battery dies, coughs that don't catch, the solenoid chattering
function generatorFail(sr, r) {
  const n = N(sr, 3.5), out = starter(n, sr, r, 0, 2.6, 380, 150, 5, 2);
  mix(out, diesel(n, sr, r, [[0.9, 0.5], [1.35, 0.7], [1.8, 0.4], [2.1, 0.25]]), 0.8);
  mix(out, struck(n, sr, r, [[2.85, 1], [2.95, 0.8], [3.05, 0.8], [3.15, 0.6]], { w: 0.001, body: [[320, 0.03, 1]], edge: [[2400, 0.03, 0.5], [3700, 0.02, 0.4]], mix: [0.5, 1, 0] }), 0.4);
  return fin(out, sr, 0.9, 0.1);
}
// a few seconds of it running (21 firings a second), the alternator's whine, the clatter
function generatorLoop(sr, r) {
  const L = 3, rate = 21, n = N(sr, L), X = N(sr, 0.2), fires = [];
  for (let i = 0; i < L * rate; i++) fires.push([i / rate + 0.003 + U(r, -0.0007, 0.0007), U(r, 0.88, 1.1)]);
  const out = norm(fold(diesel(n + N(sr, 0.3), sr, r, fires), n), 1);
  const cl = new Float32Array(n + X), h = bq(sr, 'hp', 700), l = bq(sr, 'lp', 3200);
  for (let i = 0; i < n + X; i++) { const ph = ((i / sr) * rate) % 1; cl[i] = l.run(h.run(r() * 2 - 1)) * (0.4 + 0.6 * Math.exp(-ph / 0.2)); }
  mix(out, xfade(cl, n), 0.12);
  const wh = new Float32Array(n), fa = loopF(rate * 12, L), fb = loopF(rate * 31, L);
  for (let i = 0; i < n; i++) wh[i] = Math.sin(TAU * fa * i / sr) + 0.4 * Math.sin(TAU * fb * i / sr);
  mix(out, wh, 0.025);
  return loopFin(out);
}
// a burst on the set: the squelch, static, a voice half there, clipped, cut up, gone
function radioBurst(sr, r) {
  const n = N(sr, 1.5), out = new Float32Array(n);
  let p = new Float32Array(n);
  burst(p, sr, r, 0, 0.002, 0.012, 1, [bq(sr, 'bp', 1800, 0.8)]);
  mix(out, p, 0.5);
  p = new Float32Array(n);
  const sf = [bq(sr, 'bp', 1200, 0.5)];
  let gate = 1, next = 0;
  for (let i = 0; i < N(sr, 1.3); i++) { if (i >= next) { gate = r() < 0.3 ? 0.25 : 1; next = i + N(sr, U(r, 0.03, 0.08)); } p[i] = sf[0].run(r() * 2 - 1) * gate; }
  mix(out, p, 0.45);
  const v = babble(sr, r, 0.9, { pitch: U(r, 95, 160) });
  filt(v, bq(sr, 'hp', 400), bq(sr, 'lp', 2800));
  sat(norm(v, 1), 4);
  for (let i = 0, g = 1, nx = 0; i < v.length; i++) { if (i >= nx) { g = r() < 0.35 ? 0 : 1; nx = i + N(sr, U(r, 0.02, 0.07)); } v[i] *= g; }
  p = put(new Float32Array(n), v, sr, 0.15);
  mix(out, p, 0.7);
  p = new Float32Array(n);
  burst(p, sr, r, 1.12, 0.005, 0.06, 1, null);
  mix(out, p, 0.5);
  return fin(out, sr, 0.85, 0.05);
}
// a body going down: the weight of it, the limbs after, the clothes; frozen, it cracks
function bodyFall(sr, r) {
  const n = N(sr, 1.1), hits = [[0.01, 1]];
  for (let i = 0, c = 2 + Math.floor(r() * 2); i < c; i++) hits.push([U(r, 0.08, 0.35), U(r, 0.25, 0.55)]);
  const out = struck(n, sr, r, hits, { w: 0.015, body: K([[62, 0.12, 1], [95, 0.09, 0.7], [140, 0.07, 0.4]], U(r, 0.9, 1.1)), thud: [300, 0.04], mix: [1, 0, 0.6] });
  mix(out, rustle(new Float32Array(n), sr, r, 0, 0.45, 1), 0.25);
  mix(out, crackles(new Float32Array(n), sr, r, 0.01, 0.4, 50, 2000, (u) => 1 - u), 0.15);
  return fin(out, sr, 0.92, 0.1);
}
// a window: the pane's thump and crack, the shatter, the shards landing and tinkling on
function glassBreak(sr, r) {
  const n = N(sr, 2.2), out = struck(n, sr, r, [[0.005, 1]], { w: 0.002, body: [[200, 0.05, 1], [340, 0.04, 0.5]], mix: [1, 0, 0] });
  norm(out, 0.6);
  let p = new Float32Array(n);
  burst(p, sr, r, 0.005, 0.0001, 0.001, 1, [bq(sr, 'hp', 1000)]);
  mix(out, p, 0.8);
  mix(out, shards(new Float32Array(n), sr, r, 0.006, 0.15, 50, 2500, 8500, 0.12, 1.5), 0.9);
  mix(out, shards(new Float32Array(n), sr, r, 0.2, 1.4, 35, 3000, 9000, 0.08, 1.8), 0.4);
  return fin(out, sr, 0.92, 0.2);
}
// a chain shaken: links knocking in clusters with the shakes, heavier on the beat
function chainRattle(sr, r) {
  const n = N(sr, 1.6), out = new Float32Array(n), shake = U(r, 6, 8), sets = [U(r, 0.9, 1), U(r, 1.1, 1.25), U(r, 1.3, 1.5)];
  for (let t = 0.01; t < 1.3; t += 1 / shake) {
    for (let c = 0, m = 3 + Math.floor(r() * 5); c < m; c++) ring(out, sr, t + Math.pow(r(), 1.6) * 0.07, U(r, 0.3, 1) * (c ? 0.6 : 1), K([[1900, 0.08, 0.5], [3200, 0.06, 0.4], [4700, 0.05, 0.3]], pick(r, sets)));
  }
  norm(out, 1);
  mix(out, struck(n, sr, r, [[0.01, 1], [1 / shake + 0.01, 0.6]], { w: 0.003, body: [[420, 0.06, 1], [700, 0.05, 0.5]], mix: [1, 0, 0] }), 0.4);
  return fin(out, sr, 0.85, 0.1);
}
// someone walking on the floor above: slow, dragging, the boards giving; heard through the ceiling
function footstepsAbove(sr, r) {
  const n = N(sr, 3.2), out = new Float32Array(n), hits = [], fr = new Float32Array(n);
  let t = 0.05;
  while (t < 2.8) { hits.push([t, U(r, 0.6, 1)]); if (r() < 0.5) friction(fr, sr, r, t + 0.02, t + U(r, 0.12, 0.25), [[0, 25], [1, 60]], 0.0006, (u) => Math.sin(Math.PI * u)); t += U(r, 0.45, 0.8); }
  mix(out, struck(n, sr, r, hits, { w: 0.012, body: [[70, 0.12, 1], [110, 0.09, 0.6], [170, 0.06, 0.3]], thud: [250, 0.03], mix: [1, 0, 0.6] }), 1);
  const p = new Float32Array(n);
  modal(p, fr, sr, [[240, 0.15, 0.6], [370, 0.12, 0.5], [560, 0.09, 0.3]]);
  mix(out, p, 0.35);
  filt(out, bq(sr, 'lp', 700));
  return fin(out, sr, 0.9, 0.2);
}
// something knocking along the hull from outside, below the waterline: three slow, heavy blows on
// the steel, the plating booming
const HULL = [[48, 0.9, 1], [71, 0.7, 0.8], [104, 0.6, 0.6], [152, 0.5, 0.4], [223, 0.35, 0.3], [330, 0.25, 0.2]];
function knockHull(sr, r, far = 0) {
  const t1 = U(r, 0.75, 0.95), n = N(sr, 3.2), k = U(r, 0.9, 1.1);
  const out = struck(n, sr, r, [[0.02, 1], [0.02 + t1, U(r, 0.8, 1)], [0.02 + t1 + U(r, 0.6, 0.85), U(r, 0.9, 1.15)]], { w: 0.01, ew: 0.002, body: K(HULL, k), edge: K([[540, 0.3, 0.3], [820, 0.25, 0.25], [1240, 0.2, 0.15]], k), thud: [250, 0.03], mix: [1, 0.3, 0.4] });
  filt(out, bq(sr, 'lp', far ? 2200 : 1200));
  return fin(out, sr, 0.92, 0.3);
}
// a scream far off across the snow (a man's or a woman's), and sometimes a second, broken
function screamDistant(sr, r) {
  const fem = r() < 0.5, f0 = fem ? U(r, 380, 460) : U(r, 230, 290), d = U(r, 1.4, 2), n = N(sr, d + 1.2), v = new Float32Array(n);
  const pts = [[0, f0 * 0.8], [0.15, f0 * 1.9], [0.6, f0 * 1.7], [1, f0 * 1.1]];
  voice(v, sr, r, { t0: 0.02, d, f0: (u) => curveAt(pts, u) * (1 + 0.02 * Math.sin(TAU * 6 * u * d)), F: (u) => [850 - 200 * u, 1300 - 200 * u, 2800, 3800], amp: (u) => smooth(u / 0.08) * Math.pow(1 - u, 0.5), asp: () => 0.15, glot: { jitter: 0.02, shimmer: 0.12, sub: 0.1 } });
  if (r() < 0.5) voice(v, sr, r, { t0: d + 0.25, d: d * 0.4, f0: (u) => f0 * (1.6 - 0.6 * u), F: () => [800, 1250, 2800, 3800], amp: (u) => 0.6 * smooth(u / 0.1) * (1 - u), asp: () => 0.25, glot: { jitter: 0.04, shimmer: 0.2 } });
  filt(v, bq(sr, 'hp', 300), bq(sr, 'lp', 2600));
  return fin(sat(norm(v, 1), 1.5), sr, 0.85, 0.2);
}
// thermite going up in the dark: the crack, the blast through the lowest modes, a roar of fire
// darkening, the debris raining, the long rumble
function explosion(sr, r) {
  const n = N(sr, 5.5), out = struck(n, sr, r, [[0.01, 1]], { w: 0.012, body: [[24, 1.5, 1], [36, 1.2, 0.8], [52, 0.9, 0.6], [75, 0.7, 0.4], [110, 0.5, 0.3]], thud: [9000, 0.002], mix: [1, 0, 0.6] });
  let p = new Float32Array(n);
  const lp = new BQ(sr);
  for (let i = N(sr, 0.01); i < n; i++) { const t = i / sr - 0.01; if ((i & 31) === 0) lp.set('lp', 200 + 2800 * Math.exp(-t / 0.6), 0.6); p[i] = lp.run(r() * 2 - 1) * Math.min(1, t / 0.004) * Math.exp(-t / 1.2); }
  mix(out, p, 0.9);
  p = crackles(new Float32Array(n), sr, r, 0.4, 3.6, 40, 800, (u) => 1 - u);
  const hits = [];
  for (let i = 0; i < 10; i++) hits.push([U(r, 0.6, 3.8), U(r, 0.2, 0.8)]);
  mix(p, struck(n, sr, r, hits, { w: 0.008, body: [[70, 0.15, 1], [120, 0.1, 0.5]], mix: [1, 0, 0] }), 0.8);
  mix(out, p, 0.4);
  p = new Float32Array(n);
  const l1 = bq(sr, 'lp', 80), l2 = bq(sr, 'lp', 80);
  for (let i = 0; i < n; i++) { const t = i / sr; p[i] = l2.run(l1.run(r() * 2 - 1)) * smooth(t / 0.3) * Math.exp(-t / 2.2); }
  mix(out, p, 0.8);
  return fin(sat(norm(out, 1), 2.5), sr, 0.97, 0.6);
}

// ------------------------------------------------------------ you: heart, breath, pain

// a heartbeat heard from inside: the 'lub' (a low, round thump through the chest) and the softer,
// higher 'dub'; the startle is louder, with the blood rushing in the ears
function heartbeat(sr, r, big = false) {
  const n = N(sr, big ? 1.3 : 0.75), td = U(r, 0.27, 0.32), out = new Float32Array(n);
  mix(out, struck(n, sr, r, [[0.01, 1]], { w: 0.03, body: [[40, 0.14, 1], [55, 0.1, 0.6], [80, 0.07, 0.3]], thud: [140, 0.04], mix: [1, 0, 0.5] }), 1);
  mix(out, struck(n, sr, r, [[0.01 + td, 1]], { w: 0.022, body: [[52, 0.1, 1], [72, 0.08, 0.5], [105, 0.05, 0.25]], thud: [180, 0.03], mix: [1, 0, 0.5] }), 0.6);
  if (big) {
    const p = new Float32Array(n), l = bq(sr, 'lp', 420);
    for (let i = 0; i < n; i++) { const t = i / sr; p[i] = l.run(r() * 2 - 1) * smooth(t / 0.15) * Math.exp(-Math.max(0, t - 0.2) / 0.4); }
    mix(out, p, 0.3);
    sat(norm(out, 1), 1.6);
  }
  filt(out, bq(sr, 'lp', 700));
  return fin(out, sr, 0.95, 0.1);
}
// one breath, in or out: noise through the tract, the inhale narrower and brighter. o: { nose,
// shake (a tremor's depth), voiced(u) (a catch or a whimper in it), f0, att, rel }
function breath(out, sr, r, t0, d, inhale, amp, o = {}) {
  const sh = o.shake || 0, hz = U(r, 8, 11);
  return voice(out, sr, r, {
    t0, d, f0: () => o.f0 || 150,
    F: (u) => (o.nose ? [300, 1000, 2300, 3300] : inhale ? [450, 1300 + 400 * u, 2600, 3600] : [560, 1100, 2400, 3300]),
    bw: o.nose ? [220, 250, 300, 400] : [150, 200, 300, 400],
    amp: (u) => amp * smooth(u / (o.att || 0.3)) * smooth((1 - u) / (o.rel || 0.35)) * (1 - sh * (0.5 + 0.5 * Math.sin(TAU * hz * u * d))),
    asp: (u) => 1 - (o.voiced ? o.voiced(u) : 0), glot: { jitter: 0.03, shimmer: 0.2 },
  });
}
// calm: in through the nose, out slowly; fast: through the mouth; panic: gulped, shaking, a catch
// in the throat on the way in and a whimper on the way out. Each buffer is one whole cycle.
function breathCalm(sr, r) {
  const ti = U(r, 0.95, 1.2), te = U(r, 1.3, 1.7), out = Z(sr, ti + te + 0.75);
  breath(out, sr, r, 0.02, ti, true, 0.6, { nose: true });
  breath(out, sr, r, ti + 0.17, te, false, 1, { nose: r() < 0.5, att: 0.15, rel: 0.6 });
  filt(out, bq(sr, 'hp', 200));
  return fin(out, sr, 0.85, 0.05);
}
function breathFast(sr, r) {
  const ti = U(r, 0.28, 0.36), te = U(r, 0.36, 0.46), out = Z(sr, ti + te + 0.08);
  breath(out, sr, r, 0.01, ti, true, 0.85, { att: 0.25, rel: 0.2 });
  breath(out, sr, r, ti + 0.02, te, false, 1, { att: 0.1, rel: 0.5 });
  filt(out, bq(sr, 'hp', 200));
  return fin(out, sr, 0.9, 0.02);
}
function breathPanic(sr, r) {
  const ti = U(r, 0.2, 0.27), te = U(r, 0.28, 0.36), out = Z(sr, ti + te + 0.06), wh = U(r, 0.2, 0.5);
  breath(out, sr, r, 0.005, ti, true, 0.9, { shake: 0.5, att: 0.15, rel: 0.1, f0: U(r, 380, 460), voiced: (u) => (u > 0.7 ? 0.5 : 0) });
  breath(out, sr, r, ti + 0.01, te, false, 1, { shake: 0.4, att: 0.08, rel: 0.4, f0: U(r, 240, 290), voiced: (u) => wh * Math.sin(Math.PI * u) });
  filt(out, bq(sr, 'hp', 200));
  return fin(out, sr, 0.9, 0.02);
}
// a gasp: a sharp breath in that catches in the throat, held, then let out shaking
function breathGasp(sr, r) {
  const out = Z(sr, 1.1);
  breath(out, sr, r, 0.005, U(r, 0.3, 0.38), true, 1, { att: 0.12, rel: 0.05, f0: U(r, 300, 360), voiced: (u) => (u > 0.75 ? 0.6 : 0) });
  breath(out, sr, r, 0.65, 0.35, false, 0.35, { shake: 0.6, att: 0.2, rel: 0.5 });
  filt(out, bq(sr, 'hp', 180));
  return fin(out, sr, 0.9, 0.05);
}
// a grunt of pain: an 'h' and then a short, pressed 'ugh', bitten off
function pain(sr, r) {
  const d = U(r, 0.3, 0.5), k = U(r, 0.85, 1.15), out = Z(sr, d + 0.15), pts = [[0, 150], [0.2, 178], [1, 105]];
  voice(out, sr, r, { t0: 0.01, d, f0: (u) => curveAt(pts, u) * k, F: (u) => [480 + 80 * Math.sin(Math.PI * u), 1150, 2400, 3300], amp: (u) => smooth(u / 0.08) * (u > 0.88 ? (1 - u) / 0.12 : 1), asp: (u) => (u < 0.12 ? 1 : 0.2 + 0.3 * u), glot: { jitter: 0.03, shimmer: 0.15, sub: 0.15 } });
  filt(out, bq(sr, 'hp', 90));
  return fin(out, sr, 0.9, 0.02);
}
// too cold: the teeth chattering, a shivering breath out with a hum in it
function painCold(sr, r) {
  const out = Z(sr, 2), t = new Float32Array(out.length), rate = U(r, 11, 14);
  for (let x = 0.02; x < 1.3; x += 1 / rate * U(r, 0.85, 1.15)) ring(t, sr, x, U(r, 0.5, 1), K([[2400, 0.012, 1], [3900, 0.01, 0.7], [5600, 0.008, 0.4]], U(r, 0.95, 1.05)));
  breath(out, sr, r, 0.25, 1.5, false, 1, { shake: 0.65, att: 0.1, rel: 0.4, f0: U(r, 110, 130), voiced: () => 0.3 });
  norm(out, 1);
  mix(out, t, 0.35);
  filt(out, bq(sr, 'hp', 150));
  return fin(out, sr, 0.85, 0.1);
}
// your last breath: a gasp that catches, a long, wet, rattling breath out, a sigh, nothing
function deathBreath(sr, r) {
  const out = Z(sr, 2.8), w = new Float32Array(out.length);
  voice(out, sr, r, { t0: 0.01, d: 0.22, f0: () => 180, F: () => [600, 1400, 2600, 3500], amp: (u) => smooth(u / 0.2) * (u > 0.85 ? (1 - u) / 0.15 : 1), asp: () => 0.5, glot: { jitter: 0.05, shimmer: 0.2 } });
  voice(out, sr, r, { t0: 0.45, d: 1.7, f0: (u) => 70 - 25 * u, F: (u) => [600 - 150 * u, 1100, 2400, 3300], amp: (u) => 0.8 * smooth(u / 0.1) * Math.pow(1 - u, 1.3), asp: () => 0.8, glot: { jitter: 0.2, shimmer: 0.5, sub: 0.4 }, rough: [18, 0.6] });
  wet(w, sr, r, 0.5, 1.2, 18, 150, 500);
  norm(out, 1);
  mix(out, w, 0.2);
  filt(out, bq(sr, 'hp', 80));
  return fin(out, sr, 0.9, 0.3);
}

// ------------------------------------------------------------ the score's scares

// a brass note: a saw through a lowpass that opens with the blow (the brass 'blat': brighter as it's
// louder). o: { att, rel, decay, swell, bright, bend(t) (a pitch offset, as a ratio - 1) }
function brass(out, sr, r, t0, d, f, amp, o = {}) {
  const osc = new Osc(f > 300 ? SAW8() : SAW(), r()), lp = new BQ(sr), a = Math.round(t0 * sr), m = N(sr, d), att = o.att ?? 0.02, rel = o.rel ?? 0.4, vib = U(r, 4.5, 5.5);
  let e = 0, fm = f;
  for (let i = 0; i < m && a + i < out.length; i++) {
    if ((i & 7) === 0) {
      const t = i / sr;
      e = Math.min(1, t / att) * (t > d - rel ? Math.max(0, (d - t) / rel) : 1) * (o.swell ? smooth(t / o.swell) : 1) * (o.decay ? Math.exp(-t / o.decay) : 1);
      fm = f * (1 + 0.004 * Math.sin(TAU * vib * t) + (o.bend ? o.bend(t) : 0));
      if ((i & 31) === 0) lp.set('lp', f * (1.5 + 10 * e * (o.bright ?? 1)), 0.9);
    }
    out[a + i] += lp.run(osc.step(fm, sr)) * e * amp;
  }
  return out;
}
// bowed strings: a saw with the bow's noise and an uneven vibrato; pont (sul ponticello) pushes the
// highs and thins the fundamental, glassy; trem chops it into a tremolo
function strings(out, sr, r, t0, d, f, amp, o = {}) {
  const osc = new Osc(f > 300 ? SAW8() : SAW(), r()), hp = bq(sr, 'hp', o.pont ? f * 2.5 : f * 0.5), bow = bq(sr, 'bp', Math.min(f * 4, 6000), 1.5);
  const a = Math.round(t0 * sr), m = N(sr, d), att = o.att ?? 0.1, rel = o.rel ?? 0.5, vib = U(r, 5, 6.5), vd = o.vib ?? 0.006, ph = r() * 6;
  let e = 0, fm = 1;
  for (let i = 0; i < m && a + i < out.length; i++) {
    if ((i & 7) === 0) {
      const t = i / sr;
      e = Math.min(1, t / att) * (t > d - rel ? Math.max(0, (d - t) / rel) : 1) * (o.swell ? Math.pow(smooth(t / o.swell), 2) : 1) * (o.decay ? Math.exp(-t / o.decay) : 1) * (o.trem ? 0.55 + 0.45 * Math.cos(TAU * o.trem * t) : 1);
      fm = 1 + vd * Math.sin(TAU * vib * t + ph) + 0.3 * vd * Math.sin(TAU * 1.3 * t) + (o.bend ? o.bend(t) : 0);
    }
    out[a + i] += (hp.run(osc.step(f * fm, sr)) + bow.run(r() * 2 - 1) * 0.12) * e * amp;
  }
  return out;
}
// a falling sine, saturated: the floor dropping away
function subDrop(out, sr, t0, d, f0, f1, amp) {
  const a = Math.round(t0 * sr), m = N(sr, d);
  let ph = 0;
  for (let i = 0; i < m && a + i < out.length; i++) {
    const t = i / sr;
    ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / (d * 0.3))) / sr;
    out[a + i] += Math.tanh(2 * Math.sin(ph)) * Math.min(1, t / 0.005) * Math.exp(-t / (d * 0.45)) * amp;
  }
  return out;
}
// a list of notes spread across the stereo field, each its own part normalised to lvl
function chord(L, R, sr, r, notes, lvl, fn, width = 0.8) {
  notes.forEach((m, i) => { const p = new Float32Array(L.length); fn(p, mtof(m), i); pan2(L, R, norm(p, 1), notes.length > 1 ? (i / (notes.length - 1) * 2 - 1) * width : 0, lvl); });
}
const BOOM = [[45, 0.6, 1], [68, 0.45, 0.7], [98, 0.3, 0.5], [140, 0.2, 0.3]];
const center = (L, R, part, g) => pan2(L, R, norm(part, 1), 0, g);

// the big one: a blow, a brass cluster of tritones and seconds blaring, strings screeching above,
// and the floor falling out under it
function stingJump(sr, r) {
  const n = N(sr, 3.6), L = new Float32Array(n), R = new Float32Array(n);
  center(L, R, struck(n, sr, r, [[0.002, 1]], { w: 0.006, body: BOOM, thud: [4000, 0.012], mix: [1, 0, 0.7] }), 1);
  chord(L, R, sr, r, [36, 42, 43, 48, 54, 55, 61], 0.38, (p, f) => brass(p, sr, r, 0.003, 2.4, f * U(r, 0.997, 1.003), 1, { att: 0.012, decay: 1.1, bright: 1.6, rel: 0.8 }));
  chord(L, R, sr, r, [84, 85, 90, 91], 0.2, (p, f) => strings(p, sr, r, 0.004, 2.6, f, 1, { att: 0.006, decay: 1.3, pont: true, vib: 0.02 }), 1);
  center(L, R, subDrop(new Float32Array(n), sr, 0.003, 2.6, 95, 28, 1), 0.75);
  const w = new Float32Array(n);
  burst(w, sr, r, 0.002, 0.005, 0.35, 1, [bq(sr, 'bp', 2200, 0.7)]);
  center(L, R, w, 0.25);
  for (const ch of [L, R]) sat(norm(ch, 1), 1.6);
  return fin2(L, R, sr, 0.97, 0.3);
}
function stingJumpSoft(sr, r) {
  const n = N(sr, 2), L = new Float32Array(n), R = new Float32Array(n);
  center(L, R, struck(n, sr, r, [[0.002, 1]], { w: 0.008, body: [[70, 0.3, 1], [105, 0.2, 0.6]], thud: [1500, 0.01], mix: [1, 0, 0.5] }), 0.8);
  chord(L, R, sr, r, [38, 44], 0.35, (p, f) => brass(p, sr, r, 0.003, 1.2, f, 1, { att: 0.02, decay: 0.5, bright: 0.5 }));
  chord(L, R, sr, r, [77, 78], 0.3, (p, f) => strings(p, sr, r, 0.003, 1.4, f, 1, { att: 0.008, decay: 0.6, pont: true }), 0.6);
  center(L, R, subDrop(new Float32Array(n), sr, 0.003, 1.2, 70, 35, 1), 0.45);
  return fin2(L, R, sr, 0.8, 0.3);
}
// something seen: a soft blow, low brass swelling into a cluster, high strings holding a
// semitone apart, two glassy tones beating above
function stingReveal(sr, r) {
  const n = N(sr, 4.8), L = new Float32Array(n), R = new Float32Array(n);
  center(L, R, struck(n, sr, r, [[0.002, 1]], { w: 0.01, body: [[58, 0.8, 1], [87, 0.6, 0.5]], mix: [1, 0, 0] }), 0.6);
  chord(L, R, sr, r, [31, 37, 38], 0.4, (p, f) => brass(p, sr, r, 0.01, 4, f, 1, { att: 0.3, swell: 0.4, decay: 2.5, bright: 0.8, rel: 1.5 }));
  chord(L, R, sr, r, [72, 73, 78, 79], 0.22, (p, f) => strings(p, sr, r, 0.02, 4.2, f, 1, { att: 0.15, rel: 1.6, vib: 0.008 }), 0.9);
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; g[i] = (Math.sin(TAU * 2093 * t) + Math.sin(TAU * 2217.5 * t)) * smooth(t / 0.4) * Math.exp(-t / 1.6); }
  center(L, R, g, 0.08);
  return fin2(L, R, sr, 0.9, 0.5);
}
// a slow swell: a string cluster creeping up a semitone as it grows, wind rising with it, a low
// drone under; cut off dead at the top (the hall carries what's left)
function stingDread(sr, r) {
  const n = N(sr, 8), L = new Float32Array(n), R = new Float32Array(n), top = U(r, 6.6, 7.2);
  chord(L, R, sr, r, [50, 51, 56, 57, 62], 0.3, (p, f) => strings(p, sr, r, 0.01, top, f, 1, { att: 0.5, rel: 0.06, swell: top, vib: 0.01, bend: (t) => Math.pow(2, (t / top) / 12) - 1 }), 0.9);
  const w = new Float32Array(n), bp = new BQ(sr);
  for (let i = 0; i < N(sr, top); i++) { const t = i / sr, u = t / top; if ((i & 63) === 0) bp.set('bp', 800 + 1600 * u, 2); w[i] = bp.run(r() * 2 - 1) * u * u * (u > 0.99 ? 0 : 1); }
  center(L, R, w, 0.25);
  const s = new Float32Array(n);
  for (let i = 0; i < N(sr, top); i++) { const t = i / sr; s[i] = Math.tanh(1.5 * Math.sin(TAU * 36.7 * t)) * smooth(t / top); }
  center(L, R, s, 0.4);
  return fin2(L, R, sr, 0.9, 0.05);
}
// a clue: three glass-bell notes (A, C, E below), each ringing its inharmonic partials, over a low,
// soft chord
function stingDiscovery(sr, r) {
  const n = N(sr, 4), L = new Float32Array(n), R = new Float32Array(n);
  [81, 84, 76].forEach((m, i) => {
    const p = new Float32Array(n), f = mtof(m);
    ring(p, sr, 0.02 + i * U(r, 0.32, 0.4), 1, [[f, 2.5, 1], [f * 2.756, 1.4, 0.4], [f * 5.404, 0.7, 0.2], [f * 1.003, 2.4, 0.6]]);
    pan2(L, R, norm(p, 1), [-0.4, 0.4, 0][i], 0.4);
  });
  chord(L, R, sr, r, [50, 57, 65], 0.22, (p, f) => strings(p, sr, r, 0.05, 3.6, f, 1, { att: 0.6, rel: 1.6, vib: 0.004 }), 0.6);
  return fin2(L, R, sr, 0.75, 0.4);
}
// they've seen you: a blow, brass ripping up a whole tone, a tremolo screech, three drum hits
function stingChaseStart(sr, r) {
  const n = N(sr, 2.4), L = new Float32Array(n), R = new Float32Array(n);
  center(L, R, struck(n, sr, r, [[0.002, 1], [0.2, 0.6], [0.4, 0.8]], { w: 0.007, body: BOOM, thud: [3000, 0.01], mix: [1, 0, 0.6] }), 1);
  chord(L, R, sr, r, [36, 37, 43, 49], 0.35, (p, f) => brass(p, sr, r, 0.003, 1.8, f, 1, { att: 0.05, decay: 0.9, bright: 1.4, bend: (t) => Math.pow(2, 2 * smooth(t / 0.4) / 12) - 1 }));
  chord(L, R, sr, r, [79, 80, 85], 0.2, (p, f) => strings(p, sr, r, 0.003, 2, f, 1, { att: 0.01, decay: 1.2, pont: true, trem: 12 }), 1);
  for (const ch of [L, R]) sat(norm(ch, 1), 1.4);
  return fin2(L, R, sr, 0.95, 0.3);
}
// you lost them: strings sliding down and away, a low brass sigh
function stingChaseEnd(sr, r) {
  const n = N(sr, 4.2), L = new Float32Array(n), R = new Float32Array(n);
  center(L, R, struck(n, sr, r, [[0.002, 1]], { w: 0.012, body: [[52, 0.6, 1], [78, 0.4, 0.5]], mix: [1, 0, 0] }), 0.5);
  chord(L, R, sr, r, [74, 75, 80], 0.24, (p, f) => strings(p, sr, r, 0.01, 3.8, f, 1, { att: 0.05, decay: 1.4, bend: (t) => Math.pow(2, -7 * smooth(t / 3) / 12) - 1 }), 0.9);
  chord(L, R, sr, r, [38, 45], 0.3, (p, f) => brass(p, sr, r, 0.1, 3, f, 1, { att: 0.4, decay: 1.5, bright: 0.4 }));
  return fin2(L, R, sr, 0.75, 0.5);
}
// death: the blow and the floor gone, a choir of throats on a cluster, one last heartbeat, and the
// ringing in the ears that's left
function stingDeath(sr, r) {
  const n = N(sr, 6.5), L = new Float32Array(n), R = new Float32Array(n);
  center(L, R, struck(n, sr, r, [[0.002, 1]], { w: 0.01, body: [[32, 1.2, 1], ...BOOM], thud: [2500, 0.02], mix: [1, 0, 0.6] }), 1);
  center(L, R, subDrop(new Float32Array(n), sr, 0.003, 3.5, 60, 20, 1), 0.7);
  chord(L, R, sr, r, [45, 46, 51, 52, 57], 0.3, (p, f) => voice(p, sr, r, { t0: 0.05, d: 5, f0: (u) => f * (1 + 0.006 * Math.sin(TAU * 5 * u * 5)) * (1 - 0.03 * u), F: (u) => [750 - 250 * u, 1150 - 200 * u, 2700, 3600], amp: (u) => smooth(u / 0.12) * Math.pow(1 - u, 1.2), asp: () => 0.2, glot: { jitter: 0.008, shimmer: 0.06 } }));
  const hb = heartbeat(sr, r), hp = new Float32Array(n);
  put(hp, hb, sr, 0.9);
  center(L, R, hp, 0.5);
  const tn = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; tn[i] = Math.sin(TAU * 7400 * t) * smooth((t - 0.5) / 1.5) * smooth((6.3 - t) / 1.5); }
  center(L, R, tn, 0.05);
  return fin2(L, R, sr, 0.95, 0.4);
}
// a chapter: a tam-tam struck low, blooming after the blow, and a dark chord under it
function stingChapter(sr, r) {
  const n = N(sr, 6.5), L = new Float32Array(n), R = new Float32Array(n);
  const gong = struck(n, sr, r, [[0.01, 1]], { w: 0.012, body: [[63, 4, 1], [97, 3.5, 0.8], [131, 3, 0.7], [178, 2.8, 0.6], [229, 2.5, 0.5], [291, 2.2, 0.45], [367, 2, 0.4], [452, 1.8, 0.3], [561, 1.5, 0.25], [693, 1.3, 0.2], [851, 1.1, 0.15]], mix: [1, 0, 0] });
  const bl = new Float32Array(n), bp = bq(sr, 'bp', 700, 0.8);
  for (let i = 0; i < n; i++) { const t = i / sr; bl[i] = bp.run(r() * 2 - 1) * smooth((t - 0.2) / 1.2) * Math.exp(-Math.max(0, t - 1.4) / 1.4); }
  norm(gong, 1);
  mix(gong, bl, 0.25);
  pan2(L, R, gong, -0.15, 0.85); pan2(L, R, gong, 0.15, 0.85);
  chord(L, R, sr, r, [38, 45, 50, 51], 0.22, (p, f) => strings(p, sr, r, 0.3, 5.6, f, 1, { att: 1, rel: 2, vib: 0.004 }), 0.7);
  return fin2(L, R, sr, 0.9, 0.5);
}

// ------------------------------------------------------------ fear and the chase (loops)

// the dread drone: a low cluster (D, E flat, an A and above) beating slowly between the ears,
// breathing, over a dark rumble. Every partial fits the loop exactly, so it never seams.
function dreadLow(sr, r) {
  const Lt = 8, n = N(sr, Lt), X = N(sr, 0.5), L = new Float32Array(n), R = new Float32Array(n);
  const parts = [[36.7, 1], [38.9, 0.7], [55, 0.5], [73.4, 0.3], [77.8, 0.25], [110, 0.12]];
  tones(L, sr, parts.map(([f, a], k) => [loopF(f, Lt), a, loopF(0.13 * (k + 1), Lt), 0.3, 1]), r);
  tones(R, sr, parts.map(([f, a], k) => [loopF(f + 0.13 * (k + 1), Lt), a, loopF(0.13 * (k + 1), Lt), 0.3, 1]), r);
  for (const ch of [L, R]) {
    const b = new Float32Array(n + X), l1 = bq(sr, 'lp', 160), l2 = bq(sr, 'lp', 160);
    for (let i = 0; i < n + X; i++) b[i] = l2.run(l1.run(r() * 2 - 1));
    norm(ch, 1);
    mix(ch, xfade(b, n), 0.45);
  }
  return [loopFin(L), loopFin(R)];
}
// above it, as fear climbs: glassy high tones a semitone apart, and a thin bowed scrape drifting
function dreadHigh(sr, r) {
  const Lt = 8, n = N(sr, Lt), X = N(sr, 0.5), L = new Float32Array(n), R = new Float32Array(n);
  [[1046.5, 1, -0.6], [1108.7, 0.8, 0.5], [1568, 0.5, 0.2], [1661, 0.45, -0.3]].forEach(([f, a, p], k) => {
    pan2(L, R, tones(new Float32Array(n), sr, [[loopF(f, Lt), a, loopF(0.25 + 0.125 * k, Lt), 1, 2]], r), p);
  });
  const s = new Float32Array(n + X), w = wander(r, n + X, sr, 0.4), bp = new BQ(sr);
  for (let i = 0; i < n + X; i++) { if ((i & 63) === 0) bp.set('bp', 3000 + 600 * w[i], 9); s[i] = bp.run(r() * 2 - 1); }
  const sc = xfade(s, n);
  pan2(L, R, norm(sc, 1), 0.1, 0.5);
  return [loopFin(L), loopFin(R)];
}
// The chase: two bars at 150 to the minute. A low drone pumping on the eighths, drums driving
// (syncopated, accents on one and five), a stuttering tick on the sixteenths to the right, a
// semitone ostinato in the strings to the left. Everything that rings past the end wraps round.
function chaseLoop(sr, r) {
  const beat = 0.4, Lt = beat * 8, n = N(sr, Lt), T = n + N(sr, 1), L = new Float32Array(T), R = new Float32Array(T);
  const dr = new Float32Array(T), s1 = new Osc(SAW()), s2 = new Osc(SAW()), lp = bq(sr, 'lp', 380), f1 = loopF(36.71, Lt), f2 = loopF(73.6, Lt);
  for (let i = 0; i < 2 * n; i++) {        // (twice round: the filter settles on the first, the second is kept)
    const ph = ((i % n) / sr / (beat / 2)) % 1, y = lp.run(s1.step(f1, sr) + 0.6 * s2.step(f2, sr)) * (0.3 + 0.7 * Math.min(1, ph * beat / 2 / 0.004) * Math.exp(-ph / 0.09));
    if (i >= n) dr[i - n] = y;
  }
  center(L, R, dr, 0.55);
  const hits = [0, 0.75, 1.5, 2, 3, 3.5, 4, 4.75, 5.5, 6, 7, 7.5].map((b) => [b * beat + 0.002, b === 0 || b === 4 ? 1 : U(r, 0.55, 0.75)]);
  center(L, R, struck(T, sr, r, hits, { w: 0.006, body: [[62, 0.25, 1], [93, 0.18, 0.6], [140, 0.1, 0.3]], thud: [900, 0.02], mix: [1, 0, 0.5] }), 0.9);
  const tk = new Float32Array(T), hf = [bq(sr, 'hp', 5000)];
  for (let s = 0; s < 32; s++) burst(tk, sr, r, s * beat / 4 + 0.001, 0.0002, 0.006, s & 1 ? 1 : 0.45, hf);
  pan2(L, R, norm(tk, 1), 0.55, 0.22);
  const os = new Float32Array(T);
  for (let e = 0; e < 16; e++) strings(os, sr, r, e * beat / 2, 0.16, mtof(e & 1 ? 51 : 50), 1, { att: 0.005, rel: 0.08 });
  pan2(L, R, norm(os, 1), -0.5, 0.3);
  return [loopFin(fold(L, n)), loopFin(fold(R, n))];
}

// ------------------------------------------------------------ the places (bed loops)

// steady sines summed into out, each [freq, level, swell Hz, swell depth, swell power]: recursive
// oscillators (no sin() a sample), the slow swells worked out every 64 samples, random phases
function tones(out, sr, list, r) {
  for (const [f, a, amf = 0, depth = 0, pw = 1] of list) {
    const w = TAU * f / sr, c = 2 * Math.cos(w), ph = r() * TAU, aph = r() * TAU;
    let y1 = Math.sin(ph - w), y2 = Math.sin(ph - 2 * w), e = a;
    for (let i = 0; i < out.length; i++) {
      if (depth && (i & 63) === 0) e = a * Math.pow(1 - depth + depth * (0.5 + 0.5 * Math.sin(TAU * amf * i / sr + aph)), pw);
      const y = c * y1 - y2; y2 = y1; y1 = y;
      out[i] += y * e;
    }
  }
  return out;
}

// continuous noise for a loop, shaped by env(t) (periodic in the loop's length, so the crossfade
// joins like with like), through filters fs
function bedNoise(sr, r, Lt, env, fs, kind = 'white') {
  const n = N(sr, Lt), X = N(sr, 0.4), b = new Float32Array(n + X);
  const brown = kind === 'brown', nf = fs.length;
  let br = 0, e = 1;
  for (let i = 0; i < n + X; i++) {
    if ((i & 31) === 0) e = env((i / sr) % Lt);
    let x = r() * 2 - 1;
    if (brown) { br = (br + 0.03 * x) / 1.03; x = br * 6; }
    for (let k = 0; k < nf; k++) x = fs[k].run(x);
    b[i] = x * e;
  }
  return norm(xfade(b, n), 1);
}
const stereoBed = (sr, r, make) => { const L = make(rng(Math.floor(r() * 1e9))), R = make(rng(Math.floor(r() * 1e9))); return [loopFin(L), loopFin(R)]; };

// the sea at night under the ice: the swell's slow rumble (one breath a loop), surf on a floe edge
// far off, surging twice, and the pack faintly singing, low tones wavering
function seaLoop(sr, r) {
  const Lt = 12;
  return stereoBed(sr, r, (q) => {
    const ph = q() * TAU, out = bedNoise(sr, q, Lt, (t) => 0.55 + 0.45 * Math.sin(TAU * t / Lt + ph), [bq(sr, 'lp', 140), bq(sr, 'lp', 220)], 'brown');
    mix(out, bedNoise(sr, q, Lt, (t) => Math.pow(0.5 + 0.5 * Math.sin(TAU * 2 * t / Lt + ph * 1.7), 3), [bq(sr, 'bp', 520, 0.6)]), 0.5);
    const s = tones(new Float32Array(out.length), sr, [82, 123, 164, 197].map((f) => [loopF(f * U(q, 0.99, 1.01), Lt), 1, loopF(U(q, 0.08, 0.3), Lt), 1, 3]), q);
    return mix(out, s, 0.07);
  });
}
// the station: wind working round the huts, a low rumble in the lee, two corners whistling
function stationLoop(sr, r) {
  const Lt = 10;
  return stereoBed(sr, r, (q) => {
    const a = loopF(U(q, 0.1, 0.3), Lt), ph = q() * TAU;
    const out = bedNoise(sr, q, Lt, (t) => 0.6 + 0.4 * Math.sin(TAU * a * t + ph), [bq(sr, 'lp', 260), bq(sr, 'hp', 30)], 'brown');
    for (const [f, k] of [[U(q, 650, 760), 1], [U(q, 1080, 1250), 2]]) mix(out, bedNoise(sr, q, Lt, (t) => Math.pow(Math.max(0, Math.sin(TAU * k * t / Lt + ph * k)), 3), [bq(sr, 'bp', f, 22)]), 0.12);
    return out;
  });
}
// a room in the station: the heater's steel ticking as it expands, now and then in a run; water
// gurgling in its pipe; the room's own low hum
function heaterLoop(sr, r) {
  const Lt = 7, n = N(sr, Lt), ev = new Float32Array(n + N(sr, 0.3));
  for (let t = 0.05; t < Lt; t += expo(r, 1.6)) {
    const run = r() < 0.25 ? 2 + Math.floor(r() * 3) : 1;
    for (let k = 0; k < run; k++) {
      const x = t + k * U(r, 0.05, 0.12), a = U(r, 0.3, 1);
      ring(ev, sr, x, a, K([[2200, 0.04, 0.5], [3400, 0.03, 0.4], [4900, 0.02, 0.3]], U(r, 0.9, 1.1)));
      ring(ev, sr, x, a * 2, [[420, 0.06, 0.6], [650, 0.05, 0.3]]);
    }
  }
  const out = norm(fold(ev, n), 1), w = new Float32Array(n + N(sr, 0.2));
  wet(w, sr, r, 0, Lt, 2.5, 150, 400);
  mix(out, fold(w, n), 0.25);
  mix(out, bedNoise(sr, r, Lt, () => 1, [bq(sr, 'lp', 90)], 'brown'), 0.35);
  return loopFin(out, 0.8);
}
// Object 7: the mains hum in the concrete (50 Hz and its harmonics, a second supply beating
// against it), the ventilation's rush, the rooms' lowest modes breathing
function bunkerLoop(sr, r) {
  const Lt = 12;
  return stereoBed(sr, r, (q) => {
    const n = N(sr, Lt), hum = tones(new Float32Array(n), sr, [[50, 1], [100, 0.6], [150, 0.35], [200, 0.25], [250, 0.12], [49.75, 0.4], [99.5, 0.25]], q);
    const out = norm(hum, 1), am = loopF(U(q, 0.15, 0.3), Lt);
    mix(out, bedNoise(sr, q, Lt, (t) => 0.7 + 0.3 * Math.sin(TAU * am * t), [bq(sr, 'lp', 420), bq(sr, 'peak', 120, 2, 8)]), 1.1);
    mix(out, bedNoise(sr, q, Lt, () => 1, [bq(sr, 'bp', 38, 6), bq(sr, 'bp', 47, 6)], 'brown'), 0.5);
    return out;
  });
}
// the ice cave: a sub-bass weight under everything, cold air thin and whistling, ice crystals
// letting go and tinkling, a deep tone that is the mass itself
function caveLoop(sr, r) {
  const Lt = 12;
  return stereoBed(sr, r, (q) => {
    const n = N(sr, Lt), out = bedNoise(sr, q, Lt, () => 1, [bq(sr, 'lp', 50), bq(sr, 'lp', 70)], 'brown');
    const wf = U(q, 2200, 2700), am = loopF(U(q, 0.08, 0.2), Lt);
    mix(out, bedNoise(sr, q, Lt, (t) => Math.pow(0.5 + 0.5 * Math.sin(TAU * am * t), 2), [bq(sr, 'bp', wf, 15)]), 0.18);
    const ev = new Float32Array(n + N(sr, 1.5));
    for (let t = expo(q, 0.8); t < Lt; t += expo(q, 0.8)) { const f = U(q, 3000, 7000); ring(ev, sr, t, U(q, 0.3, 1), [[f, U(q, 0.5, 1), 1], [f * 1.58, 0.4, 0.4]]); }
    mix(out, fold(ev, n), 0.12);
    const d = tones(new Float32Array(n), sr, [[loopF(29.3, Lt), 1], [loopF(43.9, Lt), 0.5, loopF(0.17, Lt), 1, 1]], q);
    return mix(out, d, 0.6);
  });
}
// the dead boat at her lines: no engine; water lapping under the counter, the hull grinding
// against the ice with each swell (two to a loop), the mooring lines creaking taut, a fender
function moorLoop(sr, r) {
  const Lt = 14, sw = Lt / 2;
  return stereoBed(sr, r, (q) => {
    const n = N(sr, Lt), ph = q() * TAU, swell = (t) => 0.5 + 0.5 * Math.sin(TAU * t / sw + ph);
    const out = bedNoise(sr, q, Lt, (t) => Math.pow(swell(t), 2) * (0.6 + 0.4 * Math.sin(TAU * 7 * t / Lt)), [bq(sr, 'bp', 420, 0.7)]);
    mix(out, bedNoise(sr, q, Lt, (t) => Math.pow(swell(t + sw * 0.3), 4) * (0.5 + 0.5 * Math.sin(TAU * 11 * t / Lt)), [bq(sr, 'lp', 1500), bq(sr, 'hp', 120)]), 0.6);
    const fr = new Float32Array(n + N(sr, 2)), p = new Float32Array(fr.length);
    for (let c = 0; c < 2; c++) {
      const t0 = ((c * sw + (ph / TAU) * sw + sw * 0.05) % Lt), d = U(q, 1, 1.5);
      friction(fr, sr, q, t0, t0 + d, [[0, 10], [0.5, 22], [1, 14]], 0.0012, (u) => Math.sin(Math.PI * u));
    }
    modal(p, fr, sr, [[180, 0.15, 0.6], [290, 0.12, 0.5], [430, 0.1, 0.4], [640, 0.08, 0.3]]);
    mix(out, fold(p, n), 0.35);
    return mix(out, bedNoise(sr, q, Lt, () => 1, [bq(sr, 'lp', 90)], 'brown'), 0.4);
  });
}

// ------------------------------------------------------------ the places (now and then)

// the ice singing far out: dispersive 'pew's falling one after another, a low moan under them
function iceSing(sr, r) {
  const n = N(sr, 3.4), out = new Float32Array(n);
  for (let i = 0, c = 2 + Math.floor(r() * 3); i < c; i++) chirp(out, sr, 0.02 + i * U(r, 0.25, 0.5), 1.5, U(r, 1200, 2200), U(r, 160, 260), U(r, 0.15, 0.35), U(r, 0.5, 1), 0.002, U(r, 0.3, 0.6));
  const p = new Float32Array(n), f0 = U(r, 70, 95);
  for (let i = 0; i < n; i++) { const t = i / sr; p[i] = Math.sin(TAU * f0 * (1 - 0.15 * t / 3.4) * t + 0.3 * Math.sin(TAU * 0.7 * t)) * Math.sin(Math.PI * t / 3.4); }
  mix(out, p, 0.4);
  return fin(out, sr, 0.85, 0.3);
}
// a tarp thrashing in a gust
function tarpFlap(sr, r) {
  const d = U(r, 0.6, 1.2), n = N(sr, d + 0.2), rate = U(r, 10, 17), hits = [];
  for (let t = 0.01; t < d; t += 1 / rate * U(r, 0.7, 1.3)) hits.push([t, U(r, 0.3, 1) * Math.sin(Math.PI * t / d)]);
  const out = struck(n, sr, r, hits, { w: 0.003, body: [[160, 0.02, 1], [300, 0.015, 0.5]], thud: [2200, 0.012], mix: [0.5, 0, 1] });
  return fin(out, sr, 0.85, 0.05);
}
// a loose sheet of corrugated iron banging, rattling after
function sheetBang(sr, r) {
  const n = N(sr, 1), k = U(r, 0.85, 1.15), hits = [[0.01, 1], [U(r, 0.08, 0.14), U(r, 0.3, 0.6)]];
  if (r() < 0.5) hits.push([U(r, 0.2, 0.3), U(r, 0.2, 0.4)]);
  const out = struck(n, sr, r, hits, { w: 0.004, ew: 0.0004, body: K([[95, 0.3, 1], [150, 0.25, 0.8], [228, 0.2, 0.6], [341, 0.15, 0.4]], k), edge: K([[880, 0.15, 0.4], [1370, 0.12, 0.3], [2100, 0.09, 0.2]], k), mix: [1, 0.4, 0] });
  return fin(out, sr, 0.9, 0.15);
}
// the mast's guy wire plucked by the wind: a long, low, twanging string
function cablePing(sr, r) {
  const n = N(sr, 2.8), f = U(r, 55, 90), e = new Float32Array(n), out = new Float32Array(n);
  pulse(e, sr, 0.01, 0.002, 1);
  modal(out, e, sr, [1, 2, 3, 4, 5, 6].map((h) => [f * h * (1 + 0.002 * h * h), 2.6 / Math.sqrt(h), 1 / h]));
  return fin(out, sr, 0.8, 0.4);
}
// the building's frame creaking under the wind's weight
function woodCreak(sr, r) {
  const d = U(r, 0.8, 1.8), n = N(sr, d + 0.4), fr = new Float32Array(n), out = new Float32Array(n), k = U(r, 0.8, 1.2);
  friction(fr, sr, r, 0.02, d, [[0, U(r, 8, 12)], [0.5, U(r, 18, 30)], [1, U(r, 10, 14)]], 0.0009, (u) => Math.sin(Math.PI * u));
  modal(out, fr, sr, K([[110, 0.3, 1], [175, 0.25, 0.8], [260, 0.2, 0.6], [390, 0.15, 0.4], [580, 0.1, 0.25]], k));
  return fin(out, sr, 0.85, 0.15);
}
// a pane rattling in its frame in the gust
function windowRattle(sr, r) {
  const n = N(sr, 0.9), hits = [], rate = U(r, 14, 22);
  for (let t = 0.01; t < 0.7; t += 1 / rate * U(r, 0.6, 1.4)) hits.push([t, U(r, 0.2, 1) * Math.sin(Math.PI * t / 0.7)]);
  const out = struck(n, sr, r, hits, { w: 0.002, ew: 0.0002, body: [[210, 0.04, 1], [340, 0.03, 0.5]], edge: [[1400, 0.05, 0.5], [2300, 0.04, 0.4], [3700, 0.03, 0.3]], mix: [0.7, 1, 0] });
  return fin(out, sr, 0.8, 0.05);
}
// a drop into a puddle: the tick of it, the cavity ringing up as it closes ('plink'), a splash
function drip(sr, r) {
  const n = N(sr, 0.25), out = new Float32Array(n);
  burst(out, sr, r, 0.002, 0.0001, 0.0003, 0.3, [bq(sr, 'hp', 2000)]);
  bubble(out, sr, 0.003, U(r, 900, 1600), U(r, 0.008, 0.02), 1, U(r, 1.5, 3));
  if (r() < 0.5) bubble(out, sr, U(r, 0.02, 0.05), U(r, 1800, 2600), 0.006, 0.3, 2);
  return fin(out, sr, 0.8, 0.02);
}
// a pipe settling as it cools: a tick and a ping
function metalTick(sr, r) {
  const n = N(sr, 0.7), out = new Float32Array(n), k = U(r, 0.8, 1.25);
  ring(out, sr, 0.005, 1, K([[1300, 0.25, 0.5], [2900, 0.2, 0.4], [4400, 0.15, 0.3]], k));
  ring(out, sr, 0.005, 2, [[180 * k, 0.2, 0.5]]);
  return fin(out, sr, 0.8, 0.1);
}
// the ice of the cave moving: a deep slow creak, glassy partials singing at its slips
function iceGroan(sr, r) {
  const d = U(r, 2, 3), n = N(sr, d + 1.4), fr = new Float32Array(n), out = new Float32Array(n), k = U(r, 0.8, 1.2);
  friction(fr, sr, r, 0.05, d, [[0, 6], [0.5, 14], [1, 8]], 0.002, (u) => smooth(u / 0.3) * smooth((1 - u) / 0.3));
  modal(out, fr, sr, K([[70, 1.5, 1], [105, 1.2, 0.8], [160, 1, 0.6], [240, 0.8, 0.5], [355, 0.6, 0.3]], k));
  norm(out, 1);
  const p = new Float32Array(n);
  modal(p, fr, sr, K([[1250, 1.5, 0.3], [1890, 1.2, 0.25], [2740, 0.9, 0.2]], k));
  mix(out, p, 0.15);
  return fin(out, sr, 0.85, 0.4);
}
const iceTinkle = (sr, r) => fin(shards(Z(sr, 1.4), sr, r, 0.01, 0.8, 4 + Math.floor(r() * 6), 3000, 7500, 0.25, 1.2), sr, 0.7, 0.2);
// the lines groaning taut on the bollards
function lineCreak(sr, r) {
  const d = U(r, 1, 1.6), n = N(sr, d + 0.3), fr = new Float32Array(n), out = new Float32Array(n);
  friction(fr, sr, r, 0.02, d, [[0, 9], [0.5, 24], [1, 12]], 0.0012, (u) => Math.sin(Math.PI * u));
  modal(out, fr, sr, K([[180, 0.15, 0.6], [290, 0.12, 0.5], [430, 0.1, 0.4], [640, 0.08, 0.3]], U(r, 0.85, 1.15)));
  return fin(out, sr, 0.85, 0.1);
}

// ------------------------------------------------------------ things that sit on objects (loops)

// tubes and ballasts: a 100 Hz buzz rich in harmonics, a little of the 50, breathing; a crackle
// now and then
function buzzLoop(sr, r) {
  const Lt = 4, n = N(sr, Lt), out = new Float32Array(n), o = new Osc(tbl('buzz', () => table(Array.from({ length: 40 }, (_, h) => 1 / Math.pow(h + 1, (h & 1) ? 0.8 : 1.1))))), am = loopF(0.5, Lt), lp = bq(sr, 'lp', 4000);
  for (let i = 0; i < 2 * n; i++) {        // (twice round, the second kept: no filter transient at the seam)
    const t = (i % n) / sr, y = lp.run(o.step(100, sr) * (0.85 + 0.15 * Math.sin(TAU * am * t)) + 0.3 * Math.sin(TAU * 50 * t));
    if (i >= n) out[i - n] = y;
  }
  norm(out, 1);
  const c = crackles(new Float32Array(n + N(sr, 0.05)), sr, r, 0, Lt, 1.5, 2000);
  mix(out, fold(c, n), 0.3);
  return loopFin(out, 0.8);
}
// a set left on: hiss fading in and out like a far band, crackle, heterodyne whistles sliding,
// and somewhere in it, very faint, a voice
function staticLoop(sr, r) {
  const Lt = 8, n = N(sr, Lt), w = wander(r, n + N(sr, 0.4), sr, 0.3);
  const out = bedNoise(sr, r, Lt, () => 1, [bq(sr, 'bp', 1500, 0.4)]);
  for (let i = 0; i < n; i++) out[i] *= 0.55 + 0.45 * w[i];
  const ev = new Float32Array(n + N(sr, 3));
  for (let t = 0; t < Lt; t += expo(r, 8)) burst(ev, sr, r, t, 0.00005, U(r, 0.0002, 0.001), Math.pow(r(), 2.5), [bq(sr, 'hp', 700)]);
  for (let k = 0; k < 2; k++) { const t0 = U(r, 0, Lt - 1), d = U(r, 1.5, 2.8), f0 = U(r, 600, 1000); chirp(ev, sr, t0, d, f0, f0 * U(r, 1.5, 2.2), d * 0.5, 0.12, 0.3, d * 0.6); }
  const v = babble(sr, r, 1.2, { pitch: U(r, 100, 200) });
  filt(v, bq(sr, 'hp', 500), bq(sr, 'lp', 2400));
  put(ev, v, sr, U(r, 1, Lt - 2), 0.15);
  mix(out, fold(ev, n), 0.9);
  return loopFin(out, 0.8);
}
// a fire in a stove or a barrel: the low roar, a hiss, crackles, the pops of wet wood
function fireLoop(sr, r) {
  const Lt = 6, n = N(sr, Lt), am = loopF(0.33, Lt);
  const out = bedNoise(sr, r, Lt, (t) => 0.7 + 0.3 * Math.sin(TAU * am * t), [bq(sr, 'lp', 180)], 'brown');
  mix(out, bedNoise(sr, r, Lt, () => 1, [bq(sr, 'bp', 500, 0.5)]), 0.35);
  mix(out, bedNoise(sr, r, Lt, () => 1, [bq(sr, 'hp', 2500)]), 0.06);
  const ev = new Float32Array(n + N(sr, 0.2));
  for (let t = 0; t < Lt; t += expo(r, 18)) burst(ev, sr, r, t, 0.0001, U(r, 0.0004, 0.002), Math.pow(r(), 2), [bq(sr, 'bp', U(r, 1000, 4000), 1)]);
  for (let t = expo(r, 1); t < Lt; t += expo(r, 1)) { burst(ev, sr, r, t, 0.0001, 0.003, U(r, 1.5, 3), [bq(sr, 'hp', 600)]); burst(ev, sr, r, t, 0.001, 0.015, U(r, 0.8, 1.5), [bq(sr, 'lp', 300)]); }
  mix(out, fold(ev, n), 0.9);
  return loopFin(out);
}

// the ears ringing after a shot in a small room: two close high tones, beating, dying slowly
function tinnitus(sr, r) {
  const n = N(sr, 3.5), out = new Float32Array(n), f = U(r, 6600, 7600);
  for (let i = 0; i < n; i++) { const t = i / sr; out[i] = (Math.sin(TAU * f * t) + 0.6 * Math.sin(TAU * f * 1.004 * t)) * Math.min(1, t / 0.08) * Math.exp(-t / 1.1); }
  return fin(out, sr, 0.8, 0.3);
}

// ------------------------------------------------------------ the rooms (impulse responses)

// The open ice throws a shot back: discrete slaps (the huts, the pressure ridges, the ice cap's face
// three hundred metres off at about 1.6 s), each smeared and darker the further it went, from its
// own side; then a roll like thunder, the echoes of the echoes, fading over four seconds.
export function fieldIR(sr, seed = 31) {
  const r = rng(seed), n = N(sr, 4.6), L = new Float32Array(n), R = new Float32Array(n);
  const slaps = [[0.09, 0.5], [0.17, 0.45], [0.31, 0.35], [0.52, 0.4], [0.78, 0.3], [1.15, 0.45], [1.62, 0.6], [1.71, 0.3], [2.05, 0.3], [2.6, 0.22], [3.2, 0.12]];
  for (const [t0, g] of slaps) {
    const t = t0 * U(r, 0.92, 1.08), w = 0.002 + t * 0.012, lp = bq(sr, 'lp', 7000 / (1 + t * 2.5)), a = Math.round(t * sr), m = N(sr, w * 5);
    const p = U(r, -0.9, 0.9), gl = Math.cos((p + 1) * Math.PI / 4) * g, gr = Math.sin((p + 1) * Math.PI / 4) * g;
    for (let i = 0; i < m && a + i < n; i++) { const x = lp.run((r() * 2 - 1) * Math.exp(-i / (w * sr))); L[a + i] += x * gl; R[a + i] += x * gr; }
  }
  for (const ch of [L, R]) {
    const lp = new BQ(sr), wv = wander(r, n, sr, 3);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) lp.set('lp', 2500 * Math.exp(-t / 1.2) + 250, 0.6);
      ch[i] += lp.run(r() * 2 - 1) * 0.16 * smooth(t / 0.45) * Math.exp(-t / 1.3) * (0.6 + 0.4 * wv[i]);
    }
    const f = Math.round(n * 0.05);
    for (let i = 0; i < f; i++) ch[n - 1 - i] *= i / f;
  }
  const m = Math.max(peakOf(L), peakOf(R)) || 1;
  for (let i = 0; i < n; i++) { L[i] /= m; R[i] /= m; }
  return [L, R];
}
const IRS = {
  field: (sr) => fieldIR(sr),
  // a small hard room: walls a couple of metres off, bright, dense, short
  room: (sr) => makeIR(sr, { seconds: 0.8, t60: 0.6, pre: 0.002, f0: 11000, f1: 3500, early: [[0.003, 0.9], [0.005, 0.7], [0.008, 0.6], [0.011, 0.55], [0.015, 0.45], [0.021, 0.35], [0.029, 0.25]], seed: 33 }),
  // Object 7's corridors: concrete, long and narrow (the even early reflections are its flutter)
  bunker: (sr) => makeIR(sr, { seconds: 2.6, t60: 2.2, pre: 0.008, f0: 6000, f1: 1200, early: [[0.012, 0.6], [0.023, 0.5], [0.035, 0.45], [0.047, 0.4], [0.058, 0.35], [0.07, 0.3], [0.093, 0.25]], seed: 34 }),
  // the ice cave: huge and glassy, slow to die
  cave: (sr) => makeIR(sr, { seconds: 4.5, t60: 4, pre: 0.03, f0: 9000, f1: 2000, early: [[0.041, 0.4], [0.067, 0.35], [0.113, 0.3], [0.171, 0.25]], seed: 35 }),
  // the stingers' own dark hall
  hall: (sr) => makeIR(sr, { seconds: 4, t60: 3.6, pre: 0.025, f0: 7000, f1: 900, seed: 41 }),
};

// ------------------------------------------------------------ the catalogue

// n: variants to keep; rate: the rate to render at (lower where there are no highs to keep)
const R44 = 44100, R32 = 32000, R24 = 24000, R22 = 22050, R16 = 16000;
const rec = (fn, n, rate) => ({ fn, n, rate });
export const HORROR_RECIPES = {
  gun_pm: rec(pmShot, 4, R44), gun_mosin: rec(mosinShot, 3, R44), gun_akm: rec(akmShot, 6, R44), gun_flaregun: rec(flareShot, 2, R32),
  dry_fire: rec(dryFire, 2, R32), pm_mag_out: rec(pmMagOut, 2, R32), pm_mag_in: rec(pmMagIn, 2, R32), pm_slide: rec(pmSlide, 2, R32),
  mosin_bolt_open: rec(mosinBoltOpen, 2, R32), mosin_bolt_close: rec(mosinBoltClose, 2, R32), mosin_clip: rec(mosinClip, 2, R32), mosin_round: rec(mosinRound, 3, R32),
  akm_mag_out: rec(akmMagOut, 2, R32), akm_mag_in: rec(akmMagIn, 2, R32), akm_charge: rec(akmCharge, 2, R32),
  flare_open: rec(flareOpen, 2, R32), flare_load: rec(flareLoad, 2, R32), flare_close: rec(flareClose, 2, R32), flare_ignite: rec(flareIgnite, 2, R32),
  shell_brass: rec(shellBrass, 6, R32), shell_brass_snow: rec(shellBrassSnow, 3, R32), weapon_draw: rec(weaponDraw, 2, R32), weapon_holster: rec(weaponHolster, 2, R32),
  hit_flesh: rec(hitFlesh, 4, R32), hit_ice: rec(hitIce, 4, R32), hit_metal: rec(hitMetal, 4, R32), hit_concrete: rec(hitConcrete, 4, R32), hit_snow: rec(hitSnow, 3, R32), hit_wood: rec(hitWood, 3, R32),
  pickup: rec(pickup, 2, R32), pickup_ammo: rec(pickupAmmo, 2, R32), pickup_key: rec(pickupKey, 2, R32), paper: rec(paper, 3, R32),
  locker_open: rec(lockerOpen, 2, R32), locker_close: rec(lockerClose, 2, R32), door_bang: rec(doorBang, 3, R24), door_creak: rec(doorCreak, 3, R24),
  door_locked: rec(doorLocked, 2, R32), door_heavy: rec(doorHeavy, 1, R24), metal_scrape: rec(metalScrape, 2, R32), metal_groan: rec(metalGroan, 3, R16),
  ice_crack: rec(iceCrack, 3, R32), ice_collapse: rec(iceCollapse, 2, R32), light_pop: rec(lightPop, 3, R32), lights_on: rec(lightsOn, 1, R24),
  generator_start: rec(generatorStart, 1, R24), generator_fail: rec(generatorFail, 1, R24), radio_burst: rec(radioBurst, 3, R16), body_fall: rec(bodyFall, 3, R24),
  glass_break: rec(glassBreak, 2, R32), chain_rattle: rec(chainRattle, 2, R32), footsteps_above: rec(footstepsAbove, 2, R16), knock_hull: rec(knockHull, 3, R16),
  scream_distant: rec(screamDistant, 3, R22), explosion: rec(explosion, 2, R24), heartbeat_spike: rec((sr, r) => heartbeat(sr, r, true), 2, R16),
  breath_gasp: rec(breathGasp, 2, R22), pain: rec(pain, 4, R22), pain_cold: rec(painCold, 2, R22), death: rec(deathBreath, 1, R22),
  turned_idle: rec(turnedIdle, 4, R22), turned_alert: rec(turnedAlert, 3, R22), turned_scream: rec(turnedScream, 3, R32), turned_attack: rec(turnedAttack, 3, R32),
  turned_hurt: rec(turnedHurt, 3, R22), turned_death: rec(turnedDeath, 2, R22), turned_step: rec(turnedStep, 6, R32), turned_crawl: rec(turnedCrawl, 3, R22),
  shade_whisper: rec(shadeWhisper, 3, R16), shade_wail: rec(shadeWail, 3, R22), shade_touch: rec(shadeTouch, 2, R32),
  bear_huff: rec(bearHuff, 3, R16), bear_growl: rec(bearGrowl, 3, R16), bear_roar: rec(bearRoar, 2, R22), bear_hurt: rec(bearHurt, 2, R16),
  bear_death: rec(bearDeath, 1, R16), bear_step: rec(bearStep, 5, R24), gromov_roar: rec(gromovRoar, 2, R22), gromov_step: rec(gromovStep, 4, R24),
  guest_pulse: rec(guestPulse, 3, R16), mimic_voice: rec(mimicVoice, 4, R16),
  sting_jump: rec(stingJump, 2, R24), sting_jump_soft: rec(stingJumpSoft, 2, R24), sting_reveal: rec(stingReveal, 1, R24), sting_dread: rec(stingDread, 1, R22),
  sting_discovery: rec(stingDiscovery, 1, R24), sting_chase_start: rec(stingChaseStart, 1, R24), sting_chase_end: rec(stingChaseEnd, 1, R24),
  sting_death: rec(stingDeath, 1, R24), sting_chapter: rec(stingChapter, 1, R24),
  heartbeat: rec(heartbeat, 3, R16), breath_calm: rec(breathCalm, 3, R16), breath_fast: rec(breathFast, 4, R22), breath_panic: rec(breathPanic, 4, R22), tinnitus: rec(tinnitus, 1, R22),
  dread_low: rec(dreadLow, 1, 11025), dread_high: rec(dreadHigh, 1, R22), chase_loop: rec(chaseLoop, 1, R24),
  bed_sea: rec(seaLoop, 1, 11025), bed_station: rec(stationLoop, 1, 11025), bed_heater: rec(heaterLoop, 1, R22), bed_bunker: rec(bunkerLoop, 1, 11025), bed_cave: rec(caveLoop, 1, R16), bed_moor: rec(moorLoop, 1, 11025),
  ev_ice_sing: rec(iceSing, 3, R16), ev_tarp: rec(tarpFlap, 3, R22), ev_sheet: rec(sheetBang, 3, R22), ev_cable: rec(cablePing, 2, R16), ev_creak: rec(woodCreak, 4, R16),
  ev_window: rec(windowRattle, 2, R32), ev_drip: rec(drip, 6, R32), ev_tick: rec(metalTick, 3, R32), ev_knocks: rec((sr, r) => knockHull(sr, r, 1), 2, R16),
  ev_ice_groan: rec(iceGroan, 3, R16), ev_tinkle: rec(iceTinkle, 3, R32), ev_line: rec(lineCreak, 3, R16),
  loop_generator: rec(generatorLoop, 1, R24), loop_buzz: rec(buzzLoop, 1, R22), loop_static: rec(staticLoop, 1, R16), loop_fire: rec(fireLoop, 1, R22),
};

// one-shots: level, the distance at full level, how fast it falls away (roll), how much the ice
// echoes it (echo), and where it sits: near (in your head), far: [m, m] (no position given: out there)
const SFX = {
  dry_fire: { gain: 0.5, ref: 1 }, pm_mag_out: { gain: 0.45, ref: 1 }, pm_mag_in: { gain: 0.5, ref: 1 }, pm_slide: { gain: 0.55, ref: 1 },
  mosin_bolt_open: { gain: 0.55, ref: 1 }, mosin_bolt_close: { gain: 0.6, ref: 1 }, mosin_clip: { gain: 0.5, ref: 1 }, mosin_round: { gain: 0.45, ref: 1 },
  akm_mag_out: { gain: 0.55, ref: 1 }, akm_mag_in: { gain: 0.6, ref: 1 }, akm_charge: { gain: 0.65, ref: 1 },
  flare_open: { gain: 0.5, ref: 1 }, flare_load: { gain: 0.45, ref: 1 }, flare_close: { gain: 0.55, ref: 1 }, flare_ignite: { gain: 0.7, ref: 2 },
  shell_brass: { gain: 0.35, ref: 1, pitch: 0.08 }, shell_brass_snow: { gain: 0.25, ref: 1 }, weapon_draw: { gain: 0.4, ref: 1 }, weapon_holster: { gain: 0.4, ref: 1 },
  hit_flesh: { gain: 0.7, ref: 2 }, hit_ice: { gain: 0.75, ref: 3 }, hit_metal: { gain: 0.8, ref: 3 }, hit_concrete: { gain: 0.75, ref: 3 }, hit_snow: { gain: 0.5, ref: 2 }, hit_wood: { gain: 0.7, ref: 3 },
  pickup: { gain: 0.45, ref: 1 }, pickup_ammo: { gain: 0.5, ref: 1 }, pickup_key: { gain: 0.5, ref: 1 }, paper: { gain: 0.45, ref: 1 },
  locker_open: { gain: 0.6, ref: 2 }, locker_close: { gain: 0.7, ref: 2 }, door_bang: { gain: 0.95, ref: 4 }, door_creak: { gain: 0.6, ref: 3 }, door_locked: { gain: 0.6, ref: 2 },
  door_heavy: { gain: 1, ref: 10, roll: 0.8, echo: 0.3, prio: true }, metal_scrape: { gain: 0.7, ref: 4 }, metal_groan: { gain: 0.8, ref: 8, roll: 0.8 },
  ice_crack: { gain: 0.9, ref: 12, echo: 0.3 }, ice_collapse: { gain: 1, ref: 15, roll: 0.8, echo: 0.4, prio: true }, light_pop: { gain: 0.6, ref: 3 },
  lights_on: { gain: 0.7, ref: 6 }, generator_start: { gain: 0.85, ref: 5 }, generator_fail: { gain: 0.8, ref: 5 }, radio_burst: { gain: 0.6, ref: 2 },
  body_fall: { gain: 0.8, ref: 3 }, glass_break: { gain: 0.85, ref: 5 }, chain_rattle: { gain: 0.6, ref: 3 }, footsteps_above: { gain: 0.7, ref: 4 },
  knock_hull: { gain: 0.95, ref: 6, prio: true }, scream_distant: { gain: 0.7, ref: 30, far: [60, 160], echo: 0.3 },
  explosion: { gain: 1, ref: 25, roll: 0.7, field: 1, prio: true },
  heartbeat_spike: { gain: 0.9, near: true, pitch: 0 }, breath_gasp: { gain: 0.6, near: true }, pain: { gain: 0.6, near: true, pitch: 0.06 },
  pain_cold: { gain: 0.55, near: true }, death: { gain: 0.7, near: true, pitch: 0 },
};
const CREATURES = {
  turned_idle: { gain: 0.6, ref: 2.5 }, turned_alert: { gain: 0.85, ref: 4 }, turned_scream: { gain: 1, ref: 8, echo: 0.2, prio: true },
  turned_attack: { gain: 0.95, ref: 3, prio: true }, turned_hurt: { gain: 0.8, ref: 3 }, turned_death: { gain: 0.85, ref: 4 },
  turned_step: { gain: 0.45, ref: 1.5, pitch: 0.08 }, turned_crawl: { gain: 0.55, ref: 2 },
  shade_whisper: { gain: 0.55, ref: 2, nearIfNone: true }, shade_wail: { gain: 0.7, ref: 6 }, shade_touch: { gain: 0.8, ref: 1, nearIfNone: true, prio: true },
  bear_huff: { gain: 0.75, ref: 5 }, bear_growl: { gain: 0.9, ref: 6 }, bear_roar: { gain: 1, ref: 14, echo: 0.25, prio: true },
  bear_hurt: { gain: 0.9, ref: 8 }, bear_death: { gain: 0.9, ref: 8 }, bear_step: { gain: 0.5, ref: 3, pitch: 0.08 },
  gromov_roar: { gain: 1, ref: 14, echo: 0.2, prio: true }, gromov_step: { gain: 0.8, ref: 5 },
  guest_pulse: { gain: 1, ref: 20, roll: 0.6, pitch: 0 }, mimic_voice: { gain: 0.65, ref: 2, pitch: 0.06 },
};
const STINGERS = {
  jump: { gain: 1, duck: 0.9 }, jump_soft: { gain: 0.8, duck: 0.6 }, reveal: { gain: 0.85, duck: 0.7 }, dread: { gain: 0.8, duck: 0.6 },
  discovery: { gain: 0.7, duck: 0.4 }, chase_start: { gain: 0.95, duck: 0.8 }, chase_end: { gain: 0.75, duck: 0.5 },
  death: { gain: 1, duck: 1 }, chapter: { gain: 0.85, duck: 0.7 },
};
// each gun: its level, how much of it the ice throws back, how hard it rings your ears indoors
const GUNS = { pm: { gain: 0.85, field: 0.55, ring: 0.6 }, mosin: { gain: 1, field: 1, ring: 1 }, akm: { gain: 0.9, field: 0.6, ring: 0.8 }, flaregun: { gain: 0.8, field: 0.3, ring: 0 } };
// The places. loop: its bed (level), out: an outdoor place (the bed and its events go out through
// the muffle), land: away from the boat (no hull creaking round you, no waves on her plates),
// under: underground (the deck's own beds go quiet too, and the ice and the gulls), storm: the
// blizzard at least this strong, events: [sound ('@' one of Audio's), every s from, to, level,
// [m from, to] away]
const BEDS = {
  sea: { loop: 'bed_sea', gain: 0.5, out: true, events: [['ev_ice_sing', 25, 60, 0.55, [200, 600]], ['@crack', 12, 30, 0.6, [150, 500]], ['@groan', 20, 45, 0.55, [150, 500]]] },
  station: { loop: 'bed_station', gain: 0.45, out: true, land: true, events: [['ev_tarp', 8, 20, 0.45, [8, 30]], ['ev_sheet', 10, 30, 0.55, [10, 40]], ['ev_cable', 15, 35, 0.35, [10, 25]], ['ev_creak', 12, 30, 0.3, [5, 15]]] },
  storm: { loop: 'bed_station', gain: 0.3, out: true, land: true, storm: 0.75, events: [['ev_tarp', 4, 10, 0.55, [6, 25]], ['ev_sheet', 6, 15, 0.65, [8, 30]], ['ev_creak', 8, 20, 0.35, [5, 12]]] },
  interior: { loop: 'bed_heater', gain: 0.3, land: true, events: [['ev_creak', 7, 18, 0.45, [3, 8]], ['ev_window', 10, 25, 0.35, [2, 6]]] },
  bunker: { loop: 'bed_bunker', gain: 0.5, under: true, events: [['ev_drip', 2, 7, 0.35, [6, 25]], ['ev_tick', 6, 16, 0.35, [5, 20]], ['ev_knocks', 30, 75, 0.4, [25, 60]], ['metal_groan', 25, 60, 0.45, [15, 40]]] },
  cave: { loop: 'bed_cave', gain: 0.55, under: true, pulse: true, events: [['ev_ice_groan', 8, 20, 0.55, [10, 40]], ['ev_drip', 3, 8, 0.35, [5, 20]], ['ev_tinkle', 6, 14, 0.3, [4, 15]]] },
  boat_dead: { loop: 'bed_moor', gain: 0.5, out: true, events: [['@hull_groan', 8, 20, 0.55, [3, 9]], ['@hull_creak', 6, 16, 0.45, [2, 7]], ['ev_line', 7, 15, 0.45, [8, 20]], ['@slap', 3, 8, 0.35, [5, 10]]] },
};
// what answers a sound in each place: Audio's open-ice reverb and its ice echo outdoors, ours inside
const ANSWER = { out: [['rev', 0.3], ['echo', 0.12]], storm: [['rev', 0.2], ['echo', 0.03]], room: [['room', 0.25]], bunker: [['bunker', 0.6]], cave: [['cave', 0.7]] };
// positional loops: a rendered loop (buf) or a one-shot repeated every [from, to] s (beat)
const LOOPS = {
  generator: { buf: 'loop_generator', gain: 0.8, ref: 4 }, lights_buzz: { buf: 'loop_buzz', gain: 0.16, ref: 1.5 },
  radio_static: { buf: 'loop_static', gain: 0.35, ref: 1.5 }, fire: { buf: 'loop_fire', gain: 0.55, ref: 2 },
  guest_heart: { beat: 'guest_pulse', every: [2.6, 3.3], gain: 1, ref: 20 }, drip: { beat: 'ev_drip', every: [1.2, 4.5], gain: 0.45, ref: 3 },
};
// first variants rendered in idle time after start, what's wanted soonest first
const WARM = ['dread_low', 'dread_high', 'gun_pm', 'sting_jump', 'heartbeat', 'breath_fast', 'dry_fire', 'pm_slide', 'pm_mag_out', 'pm_mag_in', 'shell_brass', 'hit_flesh',
  'turned_idle', 'turned_scream', 'turned_step', 'turned_alert', 'turned_attack', 'gun_akm', 'gun_mosin', 'gun_flaregun', 'bear_huff', 'bear_growl', 'bear_roar',
  'bear_step', 'sting_jump_soft', 'sting_reveal', 'breath_calm', 'breath_panic', 'hit_ice', 'hit_metal', 'hit_concrete', 'hit_snow', 'hit_wood',
  'shell_brass_snow', 'mosin_bolt_open', 'mosin_bolt_close', 'mosin_clip', 'mosin_round', 'akm_mag_out', 'akm_mag_in', 'akm_charge', 'flare_open', 'flare_load',
  'flare_close', 'weapon_draw', 'weapon_holster', 'pickup', 'pickup_ammo', 'pickup_key', 'paper', 'door_creak', 'door_bang', 'door_locked', 'locker_open',
  'locker_close', 'shade_whisper', 'shade_wail', 'shade_touch', 'mimic_voice', 'turned_hurt', 'turned_death', 'turned_crawl', 'bear_hurt', 'bear_death',
  'pain', 'pain_cold', 'breath_gasp', 'heartbeat_spike', 'sting_dread', 'sting_discovery', 'sting_chase_start', 'sting_chase_end', 'chase_loop',
  'ice_crack', 'light_pop', 'body_fall', 'glass_break', 'knock_hull', 'radio_burst', 'metal_scrape', 'chain_rattle', 'footsteps_above', 'scream_distant',
  'ev_creak', 'ev_drip', 'ev_tick', 'ev_tarp', 'ev_sheet', 'ev_window', 'tinnitus', 'flare_ignite', 'gromov_roar', 'gromov_step', 'guest_pulse', 'sting_death',
  'sting_chapter', 'death', 'lights_on', 'generator_start', 'generator_fail', 'metal_groan', 'ice_collapse', 'explosion', 'door_heavy'];
for (const k in HORROR_RECIPES) if (!WARM.includes(k)) WARM.push(k);     // (and then the rest)

// ------------------------------------------------------------ playing it

const POOL = 24;                         // Audio.js's voice cap: its one-shots and these share it
const IR_ORDER = ['hall', 'field', 'room', 'bunker', 'cave'];
const _v = new THREE.Vector3();
const _p = { x: 0, y: 0, z: 0 };
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rnd = (a, b) => a + (b - a) * Math.random();
const posOf = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? p : null);
const ss = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Rendered variants of each recipe. The first is made in idle time after start (or when first
// wanted); the others only for what has actually been played, so a sound never heard costs one
// buffer and a sound heard often gets its few variants. onWant: something new wants variants.
class HBank {
  constructor(ctx, onWant) { this.ctx = ctx; this.sets = Object.create(null); this.want = new Set(); this.onWant = onWant; }
  _set(name) { return this.sets[name] || (this.sets[name] = { list: [], last: -1 }); }
  _render(name, set) {
    const rc = HORROR_RECIPES[name], sr = Math.min(rc.rate || this.ctx.sampleRate, this.ctx.sampleRate);
    const data = rc.fn(sr, rng(Math.floor(Math.random() * 1e9))), chans = Array.isArray(data) ? data : [data];
    const buf = this.ctx.createBuffer(chans.length, chans[0].length, sr);
    for (let c = 0; c < chans.length; c++) buf.getChannelData(c).set(chans[c]);
    set.list.push(buf);
  }
  get(name) {
    const rc = HORROR_RECIPES[name];
    if (!rc) return null;
    const s = this._set(name);
    if (!s.list.length) this._render(name, s);
    if (s.list.length < rc.n && !this.want.has(name)) { this.want.add(name); this.onWant(); }
    let i = Math.floor(Math.random() * s.list.length);
    if (s.list.length > 1 && i === s.last) i = (i + 1) % s.list.length;
    s.last = i;
    return s.list[i];
  }
  // the first variant, if there's none yet; false when there was nothing to do
  first(name) {
    if (!HORROR_RECIPES[name]) return false;
    const s = this._set(name);
    if (s.list.length) return false;
    this._render(name, s);
    return true;
  }
  // one more variant of something that's been played; false when nothing wants one
  more() {
    for (const name of this.want) {
      const s = this._set(name), n = HORROR_RECIPES[name].n;
      if (s.list.length < n) this._render(name, s);
      if (s.list.length >= n) this.want.delete(name);
      return true;
    }
    return false;
  }
}

export class HorrorAudio {
  constructor(audio) {
    const A = this.a = audio;
    this.ctx = audio.ctx;
    this.bank = new HBank(this.ctx, () => { if (!this.warming) { this.warming = true; setTimeout(() => this._warm(), 200); } });
    this.t = 0; this.slowT = 0; this.warmI = 0; this.irI = 0; this.warming = true;
    this.fear = 0; this.fearS = 0; this.blizzard = 0; this.place = null;
    this.beds = Object.create(null); this.bedList = [];
    this.loops = [];
    this.sendIn = Object.create(null); this.answers = Object.create(null); this.hallOn = false;
    this.hbNext = 0; this.brNext = 0; this.pulseNext = 0;
    this.chaseOn = false; this.chaseB = null; this.chaseOffAt = 0;
    this.drone = null; this.storm = null; this.stormOffAt = 0;
    this.gust = 0.5; this.gustTo = 0.5; this.gustRate = 0.5; this.gustT = 2;
    this.duck = 0; this.duckUntil = 0; this.lastDuck = -1;
    this.musicLevel = A.musicBus ? A.musicBus.gain.value : 0;
    this.lastSting = Object.create(null); this.ringAt = 0; this.genStart = -10;
    // in your head: the heart, the breath, the drone, the chase; never placed, never muffled
    this.near = A._gain(1); this.near.connect(A.master);
    // the stingers (their hall joins when it's rendered)
    this.stingIn = A._gain(0.85); this.stingIn.connect(A.master);
    // the beds of the places inside: they carry their own room, so they skip the boat's
    this.bedIn = A._gain(1); this.bedIn.connect(A.master);
    setTimeout(() => this._warm(), 900);
  }

  // ------------------------------------------------------------ the API

  // a shot from kind ('pm' | 'mosin' | 'akm' | 'flaregun') at worldPos (the muzzle; null: your own,
  // in your hands). o: { indoor (default: from the place and from you), gain }
  gun(kind, worldPos, opts) {
    try {
      const def = GUNS[kind];
      if (!def) return;
      const A = this.a, o = opts || {}, pos = posOf(worldPos), w = this._answer(o.indoor), inside = w.dest === A.inBus, pl = this.place;
      const sends = inside
        ? [[this._send('room'), 0.7], ...(pl === 'bunker' ? [[this._send('bunker'), 0.8]] : pl === 'cave' ? [[this._send('cave'), 0.9]] : [])]
        : [[this._send('field'), def.field], [A.revIn, 0.25]];
      this._fire(this.bank.get('gun_' + kind), { pos, ref: 8, roll: 0.9, gain: def.gain * (inside ? 1.1 : 1) * num(o.gain, 1), rate: rnd(0.97, 1.03), dest: w.dest, sends, air: true, prio: true });
      // a close shot in a small space leaves the ears ringing
      const now = this.ctx.currentTime;
      if (inside && def.ring && (!pos || this._dist(pos) < 4) && now > this.ringAt) {
        this.ringAt = now + 2.5;
        this._fire(this.bank.get('tinnitus'), { dest: this.near, gain: 0.07 * def.ring, delay: 0.05 });
      }
    } catch (e) { this.a._err(e); }
  }

  // a one-shot by name (CONTRACTS.md), at worldPos or (null) in your ear / out there; o: { gain, indoor }
  sfx(name, worldPos, opts) {
    try { this._one(SFX, name, worldPos, opts); } catch (e) { this.a._err(e); }
  }

  // a creature's voice or step at worldPos; o: { gain, indoor }
  creature(name, worldPos, opts) {
    try { this._one(CREATURES, name, worldPos, opts); } catch (e) { this.a._err(e); }
  }

  stinger(name) {
    try {
      const def = STINGERS[name];
      if (!def) return;
      const now = this.ctx.currentTime;
      if (now - (this.lastSting[name] ?? -9) < 0.3) return;      // (one scare fired twice in a frame is one scare)
      this.lastSting[name] = now;
      this._hall();
      const buf = this.bank.get('sting_' + name);
      this._fire(buf, { dest: this.stingIn, gain: def.gain, prio: true });
      this.duck = Math.max(this.duck, def.duck);
      this.duckUntil = now + buf.duration * 0.6;
    } catch (e) { this.a._err(e); }
  }

  setFear(v) {
    try {
      this.fear = clamp(num(+v, 0), 0, 1);
    } catch (e) { this.a._err(e); }
  }

  // 'sea' | 'station' | 'storm' | 'interior' | 'bunker' | 'cave' | 'boat_dead' (anything else: none)
  setAmbience(kind) {
    try {
      const k = BEDS[kind] ? kind : null, now = this.ctx.currentTime, A = this.a;
      this.place = k;
      if (k && !this.beds[k]) this._bedMake(k, now);
      for (let i = 0; i < this.bedList.length; i++) {
        const b = this.bedList[i];
        b.want = b.kind === k;
        if (b.want) b.offAt = 0;
        b.g.gain.setTargetAtTime(b.want ? b.def.gain : 0, now, b.want ? 1.2 : 1.6);
      }
      // underground the deck's own beds (the sea, the wind, the engine) aren't there
      const deck = k && BEDS[k].under ? 0 : 1;
      if (A.bedOut) { A.bedOut.gain.setTargetAtTime(deck, now, 1.5); A.bedIn.gain.setTargetAtTime(deck, now, 1.5); }
    } catch (e) { this.a._err(e); }
  }

  setBlizzard(v) {
    try { this.blizzard = clamp(num(+v, 0), 0, 1); } catch (e) { this.a._err(e); }
  }

  // the chase: a driving drone in your head while it lasts
  chase(on) {
    try {
      on = !!on;
      const A = this.a, now = this.ctx.currentTime;
      if (on && !this.chaseB) {
        const g = A._gain(0), src = A._loop(this.bank.get('chase_loop'), 0);
        src.connect(g); g.connect(this.near);
        this.chaseB = { g, src };
      }
      this.chaseOn = on;
      this.chaseOffAt = on ? 0 : now + 5;
      if (this.chaseB) this.chaseB.g.gain.setTargetAtTime(on ? 0.7 : 0, now, on ? 0.12 : 0.9);
    } catch (e) { this.a._err(e); }
  }

  // a sound that sits on object3D while on (placed every frame): 'generator' | 'lights_buzz' |
  // 'radio_static' | 'guest_heart' | 'drip' | 'fire'. Off with a null object turns every one of
  // that name off. o: { gain, ref, outdoor (through the muffle, like the wind) }
  loop(name, object3D, on, opts) {
    try {
      const def = LOOPS[name];
      if (!def) return;
      const want = !!on;
      let e = null;
      for (let i = 0; i < this.loops.length; i++) {
        const x = this.loops[i];
        if (x.name !== name) continue;
        if (!object3D) { if (!want) this._loopSet(x, false); continue; }
        if (x.obj === object3D) { e = x; break; }
      }
      if (!object3D) return;
      if (!e) { if (!want) return; e = this._loopMake(name, def, object3D, opts || {}); }
      this._loopSet(e, want);
    } catch (e) { this.a._err(e); }
  }

  // every frame, from Audio.update (after the listener has moved); allocates nothing
  update(dt, s) {
    try {
      const now = this.ctx.currentTime;
      dt = clamp(num(dt, 0.016), 0, 0.25);
      this.t += dt;
      for (let i = 0; i < this.loops.length; i++) {
        const e = this.loops[i];
        if (e.on || e.offAt) this._loopPlace(e, now);
        if (e.on && e.def.beat && now >= e.next) this._loopBeat(e, now);
      }
      this._body(now);
      this._bedEvents(now);
      this.slowT += dt;
      if (this.slowT >= 0.05) { const sdt = this.slowT; this.slowT = 0; this._slow(now, sdt); }
    } catch (e) { this.a._err(e); }
  }

  // ------------------------------------------------------------ one-shots

  _one(table, name, worldPos, opts) {
    const def = table[name];
    if (!def) return null;
    const A = this.a, o = opts || {}, pos = posOf(worldPos), buf = this.bank.get(name), g = def.gain * num(o.gain, 1);
    const rate = 1 + (def.pitch ?? 0.04) * (Math.random() * 2 - 1);
    if (name === 'generator_start') this.genStart = this.ctx.currentTime;
    if (def.near || (def.nearIfNone && !pos)) return this._fire(buf, { dest: this.near, gain: g, rate, prio: true });
    const at = pos || (def.far ? this._around(rnd(def.far[0], def.far[1]), rnd(-2, 8)) : null), w = this._answer(o.indoor);
    let sends = w.sends;
    if (w.dest === A.outBus && def.field) sends = [[this._send('field'), def.field], [A.revIn, 0.3]];
    else if (w.dest === A.outBus && def.echo) sends = sends.concat([[A.echoIn, def.echo]]);
    return this._fire(buf, { pos: at, ref: def.ref, roll: def.roll ?? 1, gain: g * rnd(0.9, 1.05), rate, dest: w.dest, sends, air: true, prio: !!def.prio });
  }

  // A one-shot through Audio's pool (its cap and its stealing count these too). o: { pos, ref, roll,
  // gain, rate, dest, sends: [[node, level], ...] (taken before the panner, and falling away more
  // slowly than the dry with distance: far things are mostly echo), air (far things lose their
  // highs), lp, delay, prio (not stolen) }
  _fire(buf, o) {
    if (!buf) return null;
    const A = this.a, ctx = this.ctx, now = ctx.currentTime, when = now + Math.max(0, o.delay || 0), rate = o.rate || 1;
    A._reap(now);
    if (A.playing.length >= POOL) A._steal(now);
    const src = ctx.createBufferSource(), g = ctx.createGain(), nodes = [src, g];
    src.buffer = buf;
    src.playbackRate.value = rate;
    g.gain.value = num(o.gain, 1);
    src.connect(g);
    let tail = g, d = 0, p = null;
    const pos = o.pos, ref = o.ref || 1, dest = o.dest || A.inBus;
    if (pos) d = Math.hypot(pos.x - A.lp.x, pos.y - A.lp.y, pos.z - A.lp.z);
    if (o.lp || (o.air && d > 30)) {
      const f = A._filter('lowpass', o.lp || clamp(20000 / (1 + d / 110), 900, 20000), 0.5);
      tail.connect(f); tail = f; nodes.push(f);
    }
    if (pos) {
      p = A._panner(ref, o.roll ?? 1);
      A._place(p, pos.x, pos.y, pos.z);
      tail.connect(p); p.connect(dest); nodes.push(p);
    } else tail.connect(dest);
    if (o.sends) {
      const wet = pos ? clamp(Math.sqrt(ref / Math.max(d, ref)), 0.2, 1) : 1;
      for (let i = 0; i < o.sends.length; i++) {
        const [node, lv] = o.sends[i];
        if (!node || !(lv > 0)) continue;
        const sg = A._gain(lv * wet);
        tail.connect(sg); sg.connect(node); nodes.push(sg);
      }
    }
    src.start(when);
    const v = { src, g, nodes, p, end: when + buf.duration / rate + 0.1, prio: !!o.prio, dead: false };
    src.onended = () => A._free(v);
    A.playing.push(v);
    return v;
  }

  // Where a sound happens: inside or out (as asked, or from the place and from you), the bus it
  // goes to and what answers it. Made once per kind of answer and reused.
  _answer(indoor) {
    const A = this.a, pl = this.place;
    const inside = typeof indoor === 'boolean' ? indoor : A.cur.indoor > 0.5 || pl === 'interior' || pl === 'bunker' || pl === 'cave';
    const key = inside ? (pl === 'bunker' || pl === 'cave' ? pl : 'room') : pl === 'storm' ? 'storm' : 'out';
    let w = this.answers[key];
    if (!w) {
      w = this.answers[key] = { dest: inside ? A.inBus : A.outBus, sends: ANSWER[key].map(([k, lv]) => [k === 'rev' ? A.revIn : k === 'echo' ? A.echoIn : this._send(k), lv]) };
    }
    return w;
  }

  // a reverb's input, made the first time it's wanted (its impulse response rendered then, or in idle
  // time before); the field's echo goes out through the muffle, the rooms straight to the master
  _send(kind) {
    let g = this.sendIn[kind];
    if (g) return g;
    const A = this.a, conv = this.ctx.createConvolver();
    conv.buffer = A._stereo(IRS[kind](this.ctx.sampleRate));
    g = this.sendIn[kind] = A._gain(kind === 'hall' ? 0.55 : 1);
    const out = A._gain(kind === 'field' ? 0.9 : 0.8);
    g.connect(conv); conv.connect(out); out.connect(kind === 'field' ? A.outBus : A.master);
    return g;
  }

  _hall() {
    if (this.hallOn) return;
    this.hallOn = true;
    this.stingIn.connect(this._send('hall'));
  }

  // a point d metres off in a random direction around you, dy above (shared: use it at once)
  _around(d, dy) {
    const a = Math.random() * TAU, L = this.a.lp;
    _p.x = L.x + Math.cos(a) * d; _p.y = L.y + dy; _p.z = L.z + Math.sin(a) * d;
    return _p;
  }

  _dist(p) { const L = this.a.lp; return Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z); }

  // ------------------------------------------------------------ you

  // The heart (62 to the minute at rest, 180 at the worst, louder and tighter as it climbs) and the
  // breath (one whole breath after another, calm, fast or panicked), each scheduled a moment ahead
  // so the beats land exactly.
  _body(now) {
    const f = this.fear;
    if (f > 0.04) {
      if (this.hbNext < now) this.hbNext = now + 0.05;
      if (this.hbNext - now < 0.12) {
        this._fire(this.bank.get('heartbeat'), { dest: this.near, gain: 0.12 + 0.8 * Math.pow(f, 1.2), rate: 1 + 0.18 * f, delay: this.hbNext - now, prio: true });
        this.hbNext += 60 / (62 + 118 * f);
      }
    } else this.hbNext = 0;
    const bl = ss(0.12, 0.45, f) * (0.35 + 0.5 * f);
    if (bl > 0.01) {
      if (this.brNext < now) this.brNext = now + 0.05;
      if (this.brNext - now < 0.1) {
        const buf = this.bank.get(f < 0.35 ? 'breath_calm' : f < 0.7 ? 'breath_fast' : 'breath_panic'), rate = rnd(0.95, 1.05);
        this._fire(buf, { dest: this.near, gain: bl * rnd(0.85, 1), rate, delay: this.brNext - now, prio: true });
        this.brNext += buf.duration / rate;
      }
    } else this.brNext = 0;
  }

  // the dread drone and, with real fear, the high layer over it (made when first wanted)
  _droneBuild() {
    if (this.drone) return;
    const A = this.a, D = {};
    D.lp = A._filter('lowpass', 200, 0.6); D.g = A._gain(0); D.hg = A._gain(0);
    D.lo = A._loop(this.bank.get('dread_low'), Math.random() * 8);
    D.hi = A._loop(this.bank.get('dread_high'), Math.random() * 8);
    D.lo.connect(D.lp); D.lp.connect(D.g); D.g.connect(this.near);
    D.hi.connect(D.hg); D.hg.connect(this.near);
    this.drone = D;
  }

  // ------------------------------------------------------------ the places

  _bedMake(k, now) {
    const A = this.a, def = BEDS[k], b = { kind: k, def, want: true, offAt: 0, timers: [] };
    b.g = A._gain(0);
    b.g.connect(def.out ? A.outBus : this.bedIn);
    b.src = A._loop(this.bank.get(def.loop), Math.random() * 10);
    b.src.connect(b.g);
    for (const e of def.events) b.timers.push(now + rnd(e[1] * 0.3, e[2]));
    this.beds[k] = b;
    this.bedList.push(b);
  }

  // the place's now-and-then sounds around you, and in the cave the Guest's pulse (unless its heart
  // is already sounding from where it is)
  _bedEvents(now) {
    const k = this.place, b = k && this.beds[k];
    if (!b) return;
    const ev = b.def.events, busy = this.a.playing.length > POOL - 6;
    for (let i = 0; i < ev.length; i++) {
      if (now < b.timers[i]) continue;
      const e = ev[i];
      b.timers[i] = now + rnd(e[1], e[2]);
      if (!busy) this._ambient(e[0], e[3], e[4], !!b.def.out);
    }
    if (b.def.pulse && now >= this.pulseNext) {
      this.pulseNext = now + rnd(2.8, 3.4);
      if (!this._loopActive('guest_heart')) this._fire(this.bank.get('guest_pulse'), { dest: this.bedIn, gain: 0.35, sends: this._answer(true).sends, prio: true });
    }
  }

  // one of them: from Audio's bank ('@name') or ours, somewhere dist metres off
  _ambient(name, level, dist, out) {
    const A = this.a, buf = name[0] === '@' ? A.bank.get(name.slice(1)) : this.bank.get(name), w = this._answer(!out);
    this._fire(buf, { pos: this._around(rnd(dist[0], dist[1]), out ? rnd(-1, 4) : rnd(-1, 3)), ref: dist[0], roll: 1, gain: level * rnd(0.7, 1.05), rate: rnd(0.9, 1.1), dest: w.dest, sends: w.sends, air: true });
  }

  // The blizzard, live: four resonant bands of noise howling and gliding with the gusts (each from
  // its own side), the low roar of the whole sky moving, snow hissing against everything, and the
  // gusts buffeting (a flutter on the low end). Out through the muffle, like Audio's own wind.
  _stormBuild() {
    const A = this.a, ctx = this.ctx, S = { howl: [], srcs: [], nodes: [] };
    S.out = A._gain(0); S.out.connect(A.outBus);
    for (const [f, q, pan] of [[310, 9, -0.6], [470, 11, 0.5], [690, 13, 0.05], [1050, 18, -0.25]]) {
      const s = A._loop(A.pink, Math.random() * 7), bp = A._filter('bandpass', f, q), g = A._gain(0), p = ctx.createStereoPanner();
      p.pan.value = pan;
      s.connect(bp); bp.connect(g); g.connect(p); p.connect(S.out);
      S.howl.push({ f, bp, g, ph: Math.random() * 6 }); S.srcs.push(s); S.nodes.push(bp, g, p);
    }
    const rs = A._loop(A.brown, Math.random() * 5), rl = A._filter('lowpass', 220, 0.6);
    S.roar = A._gain(0); rs.connect(rl); rl.connect(S.roar); S.roar.connect(S.out);
    const hs = A._loop(A.white, Math.random() * 3), hh = A._filter('highpass', 3500, 0.6), hp = A._filter('peaking', 6500, 0.8, 5);
    S.hiss = A._gain(0); hs.connect(hh); hh.connect(hp); hp.connect(S.hiss); S.hiss.connect(S.out);
    const bs = A._loop(A.brown, Math.random() * 5), bl = A._filter('lowpass', 90, 0.6);
    S.buf = A._gain(0); bs.connect(bl); bl.connect(S.buf); S.buf.connect(S.out);
    S.lfo = ctx.createOscillator(); S.lfo.frequency.value = 11; S.depth = A._gain(0);
    S.lfo.connect(S.depth); S.depth.connect(S.buf.gain); S.lfo.start();
    S.srcs.push(rs, hs, bs, S.lfo); S.nodes.push(rl, S.roar, hh, hp, S.hiss, bl, S.buf, S.depth, S.out);
    this.storm = S;
  }

  _stormDrop(now) {
    const S = this.storm;
    this.storm = null; this.stormOffAt = 0;
    for (const s of S.srcs) { try { s.stop(now + 0.1); } catch (e) { /* stopped */ } }
    setTimeout(() => { for (const n of S.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } }, 400);
  }

  // twenty times a second: the gusts, the howl's bands following them
  _stormCtl(now, dt) {
    const pl = this.place, def = pl ? BEDS[pl] : null;
    let B = Math.max(this.blizzard, def && def.storm ? def.storm : 0);
    if (def && def.under) B *= pl === 'bunker' ? 0.05 : 0;
    if (B > 0.001 && !this.storm) this._stormBuild();
    const S = this.storm;
    if (!S) return;
    if (B <= 0.001) {
      if (!this.stormOffAt) this.stormOffAt = now + 6;
      else if (now > this.stormOffAt) { this._stormDrop(now); return; }
    } else this.stormOffAt = 0;
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = rnd(1, 4.5); this.gustTo = Math.pow(Math.random(), 0.7); this.gustRate = rnd(0.4, 1.4); }
    this.gust += (this.gustTo - this.gust) * (1 - Math.exp(-this.gustRate * dt));
    const t = this.t, G = clamp(B * (0.35 + 0.75 * this.gust + 0.08 * Math.sin(t * 2.3) + 0.05 * Math.sin(t * 3.7 + 1)), 0, 1.3);
    S.out.gain.setTargetAtTime(B > 0.001 ? 1 : 0, now, 1.5);
    for (let k = 0; k < S.howl.length; k++) {
      const h = S.howl[k];
      h.g.gain.setTargetAtTime(Math.pow(G, 1.5) * 0.55 * (0.55 + 0.45 * Math.sin(t * (0.3 + 0.17 * k) + h.ph)), now, 0.2);
      h.bp.frequency.setTargetAtTime(h.f * (0.75 + 0.6 * G) * (1 + 0.04 * Math.sin(t * (1.1 + 0.3 * k) + h.ph)), now, 0.25);
    }
    S.roar.gain.setTargetAtTime(0.35 * G, now, 0.3);
    S.hiss.gain.setTargetAtTime(0.22 * Math.pow(G, 1.3), now, 0.2);
    S.buf.gain.setTargetAtTime(0.28 * G, now, 0.1);
    S.depth.gain.setTargetAtTime(0.14 * G * (1 - this.a.cur.indoor), now, 0.1);
  }

  // ------------------------------------------------------------ loops on objects

  _loopMake(name, def, obj, o) {
    const A = this.a, e = { name, def, obj, on: false, src: null, placed: false, next: 0, offAt: 0, gain: def.gain * num(o.gain, 1) };
    e.g = A._gain(0);
    e.p = A._panner(num(o.ref, def.ref), 1.1);
    e.g.connect(e.p); e.p.connect(o.outdoor ? A.outBus : A.inBus);
    this.loops.push(e);
    this._loopPlace(e, this.ctx.currentTime);
    return e;
  }

  _loopSet(e, on) {
    if (on === e.on) return;
    const A = this.a, now = this.ctx.currentTime;
    e.on = on;
    e.g.gain.cancelScheduledValues(now);
    e.g.gain.setValueAtTime(e.g.gain.value, now);
    if (on) {
      e.offAt = 0;
      if (e.def.buf) {
        if (!e.src) { e.src = A._loop(this.bank.get(e.def.buf), Math.random() * 3); e.src.connect(e.g); }
        // (a generator just cranked: its running loop comes in under the start's last firings)
        const t0 = e.name === 'generator' && now - this.genStart < 4 ? this.genStart + 3.3 : now;
        e.g.gain.setTargetAtTime(e.gain, Math.max(now, t0), 0.35);
      } else {
        e.g.gain.setTargetAtTime(e.gain, now, 0.05);
        e.next = now + rnd(0, e.def.every[0]);
      }
    } else {
      e.g.gain.setTargetAtTime(0, now, 0.15);
      if (e.src) { try { e.src.stop(now + 1); } catch (x) { /* stopped */ } e.src = null; }
      e.offAt = now + 4;
    }
  }

  _loopPlace(e, now) {
    const o = e.obj, p = o && typeof o.getWorldPosition === 'function' ? o.getWorldPosition(_v) : posOf(o);
    if (!posOf(p)) return;
    if (!e.placed) { this.a._place(e.p, p.x, p.y, p.z); e.placed = true; }
    else this.a._move(e.p, p.x, p.y, p.z, now);
  }

  _loopBeat(e, now) {
    const [a, b] = e.def.every;
    e.next = now + rnd(a, b);
    if (this.a.playing.length > POOL - 4 && e.name !== 'guest_heart') return;
    this._fire(this.bank.get(e.def.beat), { dest: e.g, gain: rnd(0.8, 1.05), rate: e.name === 'drip' ? rnd(0.85, 1.2) : 1, prio: e.name === 'guest_heart' });
  }

  _ready(name) { const s = this.bank.sets[name]; return !!(s && s.list.length); }

  _loopActive(name) {
    for (let i = 0; i < this.loops.length; i++) if (this.loops[i].on && this.loops[i].name === name) return true;
    return false;
  }

  // ------------------------------------------------------------ twenty times a second

  _slow(now, dt) {
    const A = this.a;
    this.fearS += (this.fear - this.fearS) * (1 - Math.exp(-dt * 1.5));
    const f = this.fearS;
    this._stormCtl(now, dt);
    // the drone comes in once its loops are rendered (idle time), or at once if fear is real
    if (!this.drone && (this.place || this.fear > 0.01) && ((this._ready('dread_low') && this._ready('dread_high')) || this.fear > 0.3)) this._droneBuild();
    // the boat's own now-and-then sounds where the boat isn't: no hull or waves on land, and
    // underground no ice or gulls either (Audio's timers are held off)
    const pd = this.place ? BEDS[this.place] : null, T = A.timers;
    if (pd && T && (pd.land || pd.under)) {
      if (T.hull < 1) T.hull = 1;
      if (T.slap < 1) T.slap = 1;
      if (pd.under) { if (T.ice < 1) T.ice = 1; if (T.gull < 1) T.gull = 1; }
    }
    const D = this.drone;
    if (D) {
      D.g.gain.setTargetAtTime((this.place ? 0.06 : 0) + 0.55 * Math.pow(f, 1.3) + (this.chaseOn ? 0.12 : 0), now, 0.4);
      D.lp.frequency.setTargetAtTime(120 + 900 * f, now, 0.4);
      D.hg.gain.setTargetAtTime(0.3 * ss(0.45, 0.9, f), now, 0.6);
    }
    // the music steps back under a scare, a chase, real fear
    if (now > this.duckUntil) this.duck = Math.max(0, this.duck - dt * 0.3);
    const d = Math.max(this.duck, this.chaseOn ? 0.75 : 0, f * 0.5);
    if (A.musicBus && Math.abs(d - this.lastDuck) > 0.005) { A.musicBus.gain.setTargetAtTime(this.musicLevel * (1 - d), now, 0.4); this.lastDuck = d; }
    if (this.chaseB && !this.chaseOn && now > this.chaseOffAt) {
      const C = this.chaseB;
      this.chaseB = null;
      try { C.src.stop(now + 0.05); } catch (e) { /* stopped */ }
      setTimeout(() => { try { C.g.disconnect(); } catch (e) { /* gone */ } }, 300);
    }
    // beds faded out a while ago, and loops switched off, are let go
    for (let i = this.bedList.length - 1; i >= 0; i--) {
      const b = this.bedList[i];
      if (b.want) continue;
      if (!b.offAt) b.offAt = now + 6;
      else if (now > b.offAt) {
        try { b.src.stop(now + 0.05); } catch (e) { /* stopped */ }
        const g = b.g;
        setTimeout(() => { try { g.disconnect(); } catch (e) { /* gone */ } }, 300);
        delete this.beds[b.kind];
        this.bedList.splice(i, 1);
      }
    }
    for (let i = this.loops.length - 1; i >= 0; i--) {
      const e = this.loops[i];
      if (e.on || !e.offAt || now < e.offAt) continue;
      try { e.g.disconnect(); e.p.disconnect(); } catch (x) { /* gone */ }
      this.loops.splice(i, 1);
    }
  }

  // Render in idle moments, one piece at a time: the rooms first, then the first variant of
  // everything (the most wanted first), then more variants of whatever has been played. It stops
  // when there's nothing to do and the bank wakes it when something new is played.
  _warm() {
    if (!this.ctx || this.ctx.state === 'closed') { this.warming = false; return; }
    let did = false;
    try {
      if (this.irI < IR_ORDER.length) {
        const k = IR_ORDER[this.irI++];
        if (k === 'hall') this._hall(); else this._send(k);
        did = true;
      } else {
        while (!did && this.warmI < WARM.length) did = this.bank.first(WARM[this.warmI++]);
        if (!did) did = this.bank.more();
      }
    } catch (e) { this.a._err(e); this.warming = false; return; }
    if (!did) { this.warming = false; return; }
    const next = () => this._warm();
    if (typeof requestIdleCallback === 'function') setTimeout(() => requestIdleCallback(next, { timeout: 500 }), 40);
    else setTimeout(next, 50);
  }
}
