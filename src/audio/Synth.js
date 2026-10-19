// The sound recipes: everything the game can be heard to do, made from numbers. No recordings.
//
// A recipe is a function (sampleRate, random) that returns a Float32Array (mono) or [left, right].
// Audio.js renders it into an AudioBuffer the first time it's wanted (or in idle time just after
// start) and keeps a few variants of each. Nothing in this file touches the Web Audio API, so all of
// it runs, and can be tested, anywhere.
//
// The parts:
//   noise        white, pink (Kellet's filter), brown (a leaky integrator)
//   impulses     Hann-shaped blows with a set area: a boot heel, a hammer, a door slamming
//   modal banks  a struck or rubbed piece of steel rings as a few decaying sine modes, so a deck
//                plate, a ladder rung, a door leaf, a kettle and a bell are each just a list of
//                (frequency, decay time, level)
//   friction     stick-slip: one pulse each time two surfaces let go of each other. Through modes
//                it is a hinge's squeal, the hull's groan, ice squeaking along the plates
//   filters      RBJ biquads, and Klatt's formant resonators for the voices
//   voices       a glottal pulse (Rosenberg's) through four formant resonators, with filtered noise
//                for the consonants: the crew's murmur, the radio chatter, walruses and penguins
//   strings      Karplus-Strong with an allpass to tune it (the mess radio's waltz)
//   reverbs      impulse responses of decaying noise that darkens as it dies away
//
// Each part of a sound is normalised on its own and mixed in at a set level, so a hinge's squeal
// can't drown the latch that follows it. Loops are seamless: whatever rings past the end wraps round
// to the start, and continuous noise is made a little long and crossfaded into itself.

const TAU = Math.PI * 2;

// a small seeded random (mulberry32)
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const U = (r, a, b) => a + (b - a) * r();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const N = (sr, s) => Math.max(1, Math.ceil(s * sr));
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const expo = (r, rate) => -Math.log(1 - r() * 0.999) / rate;      // Poisson gaps

// ------------------------------------------------------------ filters

// RBJ cookbook biquad: 'lp', 'hp', 'bp' (0 dB at the centre), 'peak'
class BQ {
  constructor(sr) {
    this.sr = sr; this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }

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

// Klatt's formant resonator: unity gain at DC, a peak at f of bandwidth bw. Four in cascade make
// a vowel.
class Res {
  constructor(sr) { this.sr = sr; this.a = 1; this.b = 0; this.c = 0; this.y1 = 0; this.y2 = 0; }
  set(f, bw) {
    const r = Math.exp(-Math.PI * bw / this.sr);
    this.c = -r * r;
    this.b = 2 * r * Math.cos(TAU * Math.min(f, this.sr * 0.45) / this.sr);
    this.a = 1 - this.b - this.c;
    return this;
  }
  run(x) { const y = this.a * x + this.b * this.y1 + this.c * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

// ------------------------------------------------------------ oscillators

// a single-cycle wavetable from harmonic amplitudes (one guard sample at the end)
function table(amps, size = 2048) {
  const t = new Float32Array(size + 1);
  for (let h = 0; h < amps.length; h++) {
    const a = amps[h];
    if (!a) continue;
    for (let i = 0; i <= size; i++) t[i] += a * Math.sin(TAU * (h + 1) * i / size);
  }
  return norm(t, 1);
}
const TABLES = {};
const tbl = (name, make) => TABLES[name] || (TABLES[name] = make());

class Osc {
  constructor(t, phase = 0) { this.t = t; this.n = t.length - 1; this.p = phase; }
  step(f, sr) {
    this.p += f / sr;
    this.p -= Math.floor(this.p);
    const x = this.p * this.n, i = x | 0;
    return this.t[i] + (this.t[i + 1] - this.t[i]) * (x - i);
  }
}

// Rosenberg's glottal pulse, differentiated (the flow's slope is what excites the tract): open
// fraction, closing fraction, cycle-to-cycle jitter of pitch and shimmer of level, and `sub` for
// alternate weak cycles (the period-doubling that makes a roar rough).
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

// a Hann-shaped blow whose area is `amp` (so a soft wide heel and a sharp edge are comparable)
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
    out[a + i] += Math.sin(ph) * Math.min(1, tt / att) * Math.exp(-tt / dec) * amp;
  }
}

// tiny crackles: grit and ice crushed under a boot
function grit(out, sr, r, t0, span, count) {
  const h = [bq(sr, 'hp', 2500)];
  for (let c = 0; c < count; c++) burst(out, sr, r, t0 + r() * span, 0.00005, U(r, 0.0001, 0.0004), U(r, 0.3, 1), h);
}

// modes: [[freq, t60 (s), level], ...] rung by the excitation signal exc, added into out
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

// Stick-slip friction: a pulse every time the surfaces let go. curve: [[u, rate Hz], ...] over
// u = 0..1 from t0 to t1; env(u) is the pressure. Slow slips are ragged (a creak), fast ones even
// (a squeal).
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
// normalise a part to peak p and add it in
function mix(out, part, p) {
  norm(part, p);
  const n = Math.min(out.length, part.length);
  for (let i = 0; i < n; i++) out[i] += part[i];
  return out;
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
// loops: tails past n wrap round to the start (for events)...
function fold(buf, n) {
  const out = buf.slice(0, n);
  for (let i = n; i < buf.length; i++) out[(i - n) % n] += buf[i];
  return out;
}
// ...and continuous sound rendered a little long is crossfaded into its own start (equal power)
function xfade(buf, n) {
  const X = buf.length - n, out = buf.slice(0, n);
  for (let i = 0; i < X; i++) {
    const u = (i / X) * Math.PI * 0.5;
    out[i] = out[i] * Math.sin(u) + buf[n + i] * Math.cos(u);
  }
  return out;
}

// a loop's DC is just its mean
function dc(buf) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m += buf[i];
  m /= buf.length;
  for (let i = 0; i < buf.length; i++) buf[i] -= m;
  return buf;
}

// ------------------------------------------------------------ noise, reverbs, control signals

// a seamless loop of noise, RMS 0.25. kind: 'white' | 'pink' | 'brown'
export function noise(sr, seconds, kind = 'white', seed = 7) {
  const r = rng(seed), n = N(sr, seconds), X = N(sr, 0.05), out = new Float32Array(n + X);
  let b0 = 0, b1 = 0, b2 = 0, br = 0;
  for (let i = 0; i < out.length; i++) {
    const w = r() * 2 - 1;
    if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = b0 + b1 + b2 + w * 0.1848;
    } else if (kind === 'brown') {
      br = (br + 0.02 * w) / 1.02;
      out[i] = br;
    } else out[i] = w;
  }
  const o = xfade(out, n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += o[i];
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) { o[i] -= mean; ss += o[i] * o[i]; }
  const k = 0.25 / Math.sqrt(ss / n || 1);
  for (let i = 0; i < n; i++) o[i] *= k;
  return o;
}

// An impulse response: a little predelay, a few early reflections, then decaying noise whose
// brightness falls from f0 to f1 over its length (air and snow eat the highs first). Stereo, the
// two sides independent so a mono send comes back wide.
export function makeIR(sr, o = {}) {
  const seconds = o.seconds ?? 2.5, t60 = o.t60 ?? seconds, pre = o.pre ?? 0.01;
  const f0 = o.f0 ?? 12000, f1 = o.f1 ?? 2000, early = o.early || [];
  const r = rng(o.seed ?? 3), n = N(sr, seconds), p0 = Math.round(pre * sr), chans = [];
  for (let c = 0; c < 2; c++) {
    const out = new Float32Array(n);
    let y = 0, a = 0, k = 1, env = 1;
    const fall = Math.exp(-6.9078 / (t60 * sr));
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / sr;
      if (((i - p0) & 31) === 0) {
        // (the lowpass's coefficient, and the gain that keeps its loss out of the decay, per block)
        a = Math.exp(-TAU * Math.min(f0 * Math.pow(f1 / f0, t / seconds), sr * 0.45) / sr);
        k = 1 / Math.sqrt((1 - a) / (1 + a));
      }
      y = (1 - a) * (r() * 2 - 1) + a * y;
      out[i] = y * env * k * Math.min(1, t / 0.004);
      env *= fall;
    }
    for (const [et, eg] of early) {
      const k = Math.round((pre + et * (c ? 1.06 : 0.95)) * sr), m = Math.round(0.0012 * sr);
      for (let j = 0; j < m && k + j < n; j++) out[k + j] += (r() * 2 - 1) * eg * 2 * (1 - j / m);
    }
    const f = Math.round(n * 0.05);
    for (let i = 0; i < f; i++) out[n - 1 - i] *= i / f;
    chans.push(out);
  }
  const m = Math.max(peakOf(chans[0]), peakOf(chans[1])) || 1;
  for (const ch of chans) for (let i = 0; i < n; i++) ch[i] /= m;
  return chans;
}

// a slow random wobble in -1..1, seamless, for wavering pitch (the kettle's whistle)
export function wobble(sr = 8000, seconds = 8, seed = 5) {
  const r = rng(seed), n = N(sr, seconds), X = N(sr, 0.5), a = wander(r, n + X, sr, 2.2), b = wander(r, n + X, sr, 7);
  for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.8 + b[i] * 0.2;
  return norm(dc(xfade(a, n)), 1);
}

// ------------------------------------------------------------ footsteps (heavy winter boots)

// heel, then toe: a broad soft blow (the rubber sole) and a small sharp one (the heel's edge)
function heelToe(sr, r, exc, edge, toe, soft) {
  pulse(exc, sr, 0.004, (3 + 4 * soft) * 1e-3, 1);
  pulse(exc, sr, 0.004 + toe, (2 + 2 * soft) * 1e-3, U(r, 0.35, 0.6));
  pulse(edge, sr, 0.0045, 0.00035, 1);
  pulse(edge, sr, 0.0045 + toe, 0.0003, U(r, 0.25, 0.5));
}

// the steel deck: a dull, heavy thud with a short ring
function stepMetal(sr, r) {
  const n = N(sr, 0.42), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n);
  const k = U(r, 0.92, 1.08), toe = U(r, 0.032, 0.06);
  heelToe(sr, r, exc, edge, toe, U(r, 0.7, 1.3));
  let p = new Float32Array(n);
  modal(p, exc, sr, [[88 * k, 0.1, 1], [141 * k, 0.07, 0.55], [226 * k, 0.05, 0.3], [331 * k, 0.04, 0.15]]);
  mix(out, p, 1);
  p = new Float32Array(n);
  modal(p, edge, sr, [[412 * k, 0.18, 0.55], [663 * k, 0.15, 0.5], [1087 * k, 0.12, 0.4], [1614 * k, 0.09, 0.3], [2377 * k, 0.07, 0.22], [3302 * k, 0.05, 0.14]]);
  mix(out, p, 0.24);
  p = new Float32Array(n);
  burst(p, sr, r, 0.004, 0.0012, 0.01, 1, [bq(sr, 'lp', 700)]);
  burst(p, sr, r, 0.004 + toe, 0.001, 0.007, 0.5, [bq(sr, 'lp', 850)]);
  mix(out, p, 0.3);
  p = new Float32Array(n);
  grit(p, sr, r, 0.006, 0.05, 2 + Math.floor(r() * 6));
  mix(out, p, 0.07);
  return fin(out, sr);
}

// the engine room's steel grating: the bars rattle in their frame, quicker and quieter each time
function stepGrate(sr, r) {
  const n = N(sr, 0.45), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n), rat = new Float32Array(n);
  const k = U(r, 0.92, 1.08), toe = U(r, 0.03, 0.05);
  heelToe(sr, r, exc, edge, toe, U(r, 0.6, 1.1));
  for (const [t0, a0, cnt] of [[0.004, 1, 3 + Math.floor(r() * 4)], [0.004 + toe, 0.45, 2]]) {
    let t = t0 + U(r, 0.008, 0.016), gap = U(r, 0.016, 0.03), a = a0 * U(r, 0.7, 1);
    for (let i = 0; i < cnt; i++) { pulse(rat, sr, t, 0.00025, a); t += gap * U(r, 0.7, 1.2); gap *= 0.78; a *= U(r, 0.5, 0.8); }
  }
  let p = new Float32Array(n);
  modal(p, exc, sr, [[128 * k, 0.08, 1], [205 * k, 0.06, 0.5], [318 * k, 0.05, 0.3]]);
  mix(out, p, 0.85);
  p = new Float32Array(n);
  modal(p, edge, sr, [[930 * k, 0.07, 0.4], [1460 * k, 0.06, 0.4], [2210 * k, 0.05, 0.35], [3380 * k, 0.04, 0.25], [4720 * k, 0.03, 0.15]]);
  mix(out, p, 0.3);
  p = new Float32Array(n);
  const kr = k * U(r, 0.95, 1.05);
  modal(p, rat, sr, [[1040 * kr, 0.05, 0.5], [1730 * kr, 0.045, 0.45], [2650 * kr, 0.04, 0.4], [3900 * kr, 0.03, 0.3], [5600 * kr, 0.025, 0.2]]);
  mix(out, p, 0.45);
  p = new Float32Array(n);
  burst(p, sr, r, 0.004, 0.001, 0.008, 1, [bq(sr, 'lp', 900)]);
  mix(out, p, 0.25);
  return fin(out, sr);
}

// linoleum on the deck below the rooms: a soft thud, a tick, now and then a rubber squeak
function stepFloor(sr, r) {
  const n = N(sr, 0.32), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n);
  const k = U(r, 0.92, 1.08), toe = U(r, 0.035, 0.06);
  pulse(exc, sr, 0.004, U(r, 0.006, 0.009), 1);
  pulse(exc, sr, 0.004 + toe, U(r, 0.004, 0.006), U(r, 0.35, 0.55));
  pulse(edge, sr, 0.0045, 0.0004, 1);
  pulse(edge, sr, 0.0045 + toe, 0.0004, 0.4);
  let p = new Float32Array(n);
  modal(p, exc, sr, [[72 * k, 0.08, 1], [118 * k, 0.06, 0.5], [190 * k, 0.045, 0.25]]);
  mix(out, p, 1);
  p = new Float32Array(n);
  burst(p, sr, r, 0.004, 0.0015, 0.014, 1, [bq(sr, 'lp', 380)]);
  burst(p, sr, r, 0.004 + toe, 0.001, 0.01, 0.5, [bq(sr, 'lp', 450)]);
  mix(out, p, 0.45);
  p = new Float32Array(n);
  modal(p, edge, sr, [[1850 * k, 0.025, 0.3], [2950 * k, 0.02, 0.2]]);
  mix(out, p, 0.1);
  if (r() < 0.3) {
    p = new Float32Array(n);
    const t0 = 0.004 + toe + 0.004, f0 = U(r, 1600, 1900);
    chirp(p, sr, t0, 0.035, f0, f0 * 1.4, 0.03, 1, 0.006, 0.012);
    mix(out, p, 0.035);
  }
  return fin(out, sr);
}

// a steel ladder rung: a boot on a round bar rings like a bar (free-free modes 1 : 2.76 : 5.40 ...)
function stepLadder(sr, r) {
  const n = N(sr, 0.8), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n);
  const k = U(r, 0.94, 1.06), f1 = U(r, 500, 640), ts = 0.004 + U(r, 0.04, 0.07);
  pulse(exc, sr, 0.004, 0.0025, 1);
  pulse(edge, sr, 0.0045, 0.0003, 1);
  pulse(exc, sr, ts, 0.004, 0.3);
  pulse(edge, sr, ts, 0.0003, 0.12);
  let p = new Float32Array(n);
  modal(p, edge, sr, [[f1, 0.45, 0.5], [f1 * 2.756, 0.3, 0.4], [f1 * 5.404, 0.18, 0.3], [f1 * 8.933, 0.1, 0.2], [f1 * 13.34, 0.06, 0.1]]);
  mix(out, p, 0.55);
  p = new Float32Array(n);
  modal(p, exc, sr, [[105 * k, 0.09, 0.9], [170 * k, 0.06, 0.4], [f1 * 0.98, 0.2, 0.15]]);
  mix(out, p, 1);
  p = new Float32Array(n);
  burst(p, sr, r, 0.004, 0.0006, 0.005, 1, [bq(sr, 'lp', 1200)]);
  mix(out, p, 0.25);
  return fin(out, sr, 0.9, 0.05);
}

// ------------------------------------------------------------ doors, switches, the telegraph

const HINGE = (k) => [[540 * k, 0.3, 0.5], [865 * k, 0.25, 0.45], [1310 * k, 0.2, 0.4], [1770 * k, 0.16, 0.3], [2390 * k, 0.12, 0.2], [3150 * k, 0.09, 0.12]];

// a heavy steel ship's door: the handle lifts the latch, the hinges creak into a squeal as it
// swings, and the leaf lands on its hook with a clunk
function doorOpen(sr, r) {
  const n = N(sr, 1.75), out = new Float32Array(n), k = U(r, 0.94, 1.06);
  let exc = new Float32Array(n), edge = new Float32Array(n), p = new Float32Array(n);
  const t2 = U(r, 0.06, 0.09);
  pulse(edge, sr, 0.01, 0.0003, 0.6); pulse(exc, sr, 0.01, 0.003, 0.6);
  pulse(edge, sr, t2, 0.0003, 0.35); pulse(exc, sr, t2, 0.004, 0.3);
  modal(p, edge, sr, [[1350 * k, 0.09, 0.45], [2280 * k, 0.07, 0.35], [3460 * k, 0.05, 0.25], [4900 * k, 0.04, 0.15]]);
  modal(p, exc, sr, [[128 * k, 0.1, 0.6], [205 * k, 0.07, 0.3]]);
  mix(out, p, 0.5);
  // the hinges: stick-slip, ragged at first, then an even squeal that slides about
  const fr = new Float32Array(n), sq = U(r, 0.85, 1.15), wob = U(r, 0, 1);
  friction(fr, sr, r, 0.16, 1.12, [[0, 38], [0.25, 70], [0.36, 190 * sq], [0.55, 255 * sq], [0.8, 290 * sq], [1, 225 * sq]], 0.0003,
    (u) => Math.sin(Math.PI * Math.min(1, u * 1.1)) * (0.75 + 0.25 * Math.sin(TAU * (u * 3 + wob))));
  p = new Float32Array(n);
  modal(p, fr, sr, HINGE(k));
  mix(out, p, 0.42);
  // the air the leaf pushes
  p = new Float32Array(n);
  const wl = bq(sr, 'lp', 220);
  for (let i = N(sr, 0.2); i < N(sr, 1.15); i++) p[i] = wl.run(r() * 2 - 1) * Math.sin(Math.PI * (i / sr - 0.2) / 0.95);
  mix(out, p, 0.07);
  // on its hook
  const th = U(r, 1.15, 1.25);
  exc = new Float32Array(n); edge = new Float32Array(n);
  pulse(exc, sr, th, 0.003, 1);
  pulse(edge, sr, th + 0.0005, 0.0003, 0.4);
  pulse(edge, sr, th + U(r, 0.03, 0.04), 0.0003, 0.15);
  pulse(edge, sr, th + U(r, 0.06, 0.075), 0.0003, 0.08);
  p = new Float32Array(n);
  modal(p, exc, sr, [[96 * k, 0.16, 1], [158 * k, 0.11, 0.6], [243 * k, 0.08, 0.4]]);
  mix(out, p, 0.9);
  p = new Float32Array(n);
  modal(p, edge, sr, [[1150 * k, 0.13, 0.5], [1980 * k, 0.1, 0.4], [2870 * k, 0.08, 0.3], [4100 * k, 0.06, 0.2]]);
  mix(out, p, 0.4);
  return fin(out, sr, 0.9, 0.1);
}

// the swing (a short creak, the air), the slam of a heavy steel leaf in its frame, the latch snapping
// home, the dogs rattling
function doorClose(sr, r) {
  const n = N(sr, 1.9), out = new Float32Array(n), k = U(r, 0.94, 1.06), ts = U(r, 0.42, 0.48);
  let p = new Float32Array(n);
  const fr = new Float32Array(n);
  friction(fr, sr, r, 0.02, ts - 0.04, [[0, 30], [0.5, 60], [1, 85]], 0.0004, (u) => Math.sin(Math.PI * u));
  modal(p, fr, sr, HINGE(k * 0.9));
  mix(out, p, 0.28);
  p = new Float32Array(n);
  const wl = bq(sr, 'lp', 260);
  for (let i = N(sr, 0.05); i < N(sr, ts); i++) { const u = (i / sr - 0.05) / (ts - 0.05); p[i] = wl.run(r() * 2 - 1) * u * u; }
  mix(out, p, 0.12);
  // the slam
  let exc = new Float32Array(n), edge = new Float32Array(n);
  pulse(exc, sr, ts, 0.006, 1);
  pulse(edge, sr, ts + 0.0005, 0.0003, 1);
  p = new Float32Array(n);
  modal(p, exc, sr, [[57 * k, 0.38, 1], [86 * k, 0.3, 0.8], [131 * k, 0.22, 0.55], [197 * k, 0.16, 0.35]]);
  burst(p, sr, r, ts, 0.001, 0.025, 0.2, [bq(sr, 'lp', 330)]);
  mix(out, p, 1);
  p = new Float32Array(n);
  modal(p, edge, sr, [[312 * k, 0.6, 0.35], [521 * k, 0.5, 0.3], [817 * k, 0.4, 0.26], [1243 * k, 0.3, 0.2], [1890 * k, 0.22, 0.15], [2770 * k, 0.15, 0.1], [3910 * k, 0.1, 0.06]]);
  mix(out, p, 0.42);
  // the latch, then the dogs settling
  const tl = ts + U(r, 0.06, 0.085);
  exc = new Float32Array(n); edge = new Float32Array(n);
  pulse(edge, sr, tl, 0.0003, 1); pulse(exc, sr, tl, 0.003, 1);
  pulse(edge, sr, tl + U(r, 0.08, 0.1), 0.0003, 0.3);
  pulse(edge, sr, tl + U(r, 0.16, 0.19), 0.0003, 0.15);
  p = new Float32Array(n);
  modal(p, edge, sr, [[1420 * k, 0.09, 0.5], [2510 * k, 0.07, 0.4], [3800 * k, 0.05, 0.3], [5300 * k, 0.04, 0.2]]);
  mix(out, p, 0.4);
  p = new Float32Array(n);
  modal(p, exc, sr, [[160 * k, 0.08, 0.6], [262 * k, 0.06, 0.3]]);
  mix(out, p, 0.35);
  return fin(out, sr, 0.9, 0.2);
}

// a locked door: the handle rattled down and up against its stop, twice
function locked(sr, r) {
  const n = N(sr, 0.85), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n), k = U(r, 0.94, 1.06);
  for (const g0 of [0.02, U(r, 0.32, 0.38)]) {
    let t = g0;
    for (let i = 0; i < 3; i++) {
      pulse(edge, sr, t, 0.00025, U(r, 0.6, 1));
      pulse(exc, sr, t, 0.003, U(r, 0.4, 0.7));
      t += U(r, 0.06, 0.1);
    }
  }
  let p = new Float32Array(n);
  modal(p, edge, sr, [[980 * k, 0.07, 0.5], [1730 * k, 0.06, 0.4], [2650 * k, 0.05, 0.35], [3900 * k, 0.04, 0.25], [5400 * k, 0.03, 0.15]]);
  mix(out, p, 0.75);
  p = new Float32Array(n);
  modal(p, exc, sr, [[118 * k, 0.07, 0.7], [187 * k, 0.05, 0.4]]);
  mix(out, p, 0.6);
  return fin(out, sr);
}

// a radio knob: two tiny clicks
function click(sr, r) {
  const n = N(sr, 0.08), out = new Float32Array(n), edge = new Float32Array(n), k = U(r, 0.94, 1.06);
  pulse(edge, sr, 0.002, 0.00012, 1);
  pulse(edge, sr, 0.002 + U(r, 0.007, 0.015), 0.00012, 0.55);
  modal(out, edge, sr, [[2300 * k, 0.014, 0.4], [3900 * k, 0.011, 0.4], [6100 * k, 0.009, 0.3], [8200 * k, 0.007, 0.2], [900 * k, 0.025, 0.2]]);
  filt(out, bq(sr, 'hp', 300));
  return fin(out, sr, 0.9, 0.005);
}

// a heavy marine toggle switch: the lever starts, snaps over, and its spring pings
function toggleSwitch(sr, r) {
  const n = N(sr, 0.2), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n), k = U(r, 0.94, 1.06);
  const tm = 0.003 + U(r, 0.008, 0.014);
  pulse(edge, sr, 0.003, 0.00015, 0.25);
  pulse(edge, sr, tm, 0.00015, 1);
  pulse(exc, sr, tm, 0.0015, 0.8);
  let p = new Float32Array(n);
  modal(p, edge, sr, [[1250 * k, 0.035, 0.5], [2400 * k, 0.03, 0.4], [3700 * k, 0.022, 0.3], [5100 * k, 0.016, 0.2], [6100 * k, 0.07, 0.05]]);
  mix(out, p, 0.8);
  p = new Float32Array(n);
  modal(p, exc, sr, [[260 * k, 0.045, 0.6], [410 * k, 0.035, 0.3]]);
  mix(out, p, 0.6);
  return fin(out, sr, 0.9, 0.01);
}

// a big push-button on the engine panel: press, then the release
function button(sr, r) {
  const n = N(sr, 0.4), out = new Float32Array(n), k = U(r, 0.94, 1.06), rt = U(r, 0.15, 0.21);
  const exc = new Float32Array(n), edge = new Float32Array(n), exc2 = new Float32Array(n), edge2 = new Float32Array(n);
  pulse(exc, sr, 0.005, 0.002, 1); pulse(edge, sr, 0.006, 0.00015, 0.4);
  pulse(edge2, sr, rt, 0.00015, 0.5); pulse(exc2, sr, rt, 0.0015, 0.35);
  let p = new Float32Array(n);
  modal(p, exc, sr, [[185 * k, 0.05, 1], [320 * k, 0.04, 0.4]]);
  mix(out, p, 0.8);
  p = new Float32Array(n);
  modal(p, edge, sr, [[2600 * k, 0.018, 0.4], [4100 * k, 0.014, 0.3]]);
  mix(out, p, 0.5);
  p = new Float32Array(n);
  modal(p, edge2, sr, [[2900 * k, 0.014, 0.4], [4500 * k, 0.011, 0.3]]);
  modal(p, exc2, sr, [[215 * k, 0.04, 0.5]]);
  mix(out, p, 0.4);
  return fin(out, sr, 0.9, 0.02);
}

// the engine-order telegraph: the lever clicks through its detents and lands, the gong rings out
// in a quick trill, and the engine room's reply rings twice
function telegraph(sr, r) {
  const n = N(sr, 2.9), out = new Float32Array(n), k = U(r, 0.96, 1.04);
  let edge = new Float32Array(n), exc = new Float32Array(n), p = new Float32Array(n);
  for (const t of [0, 0.055, 0.11]) pulse(edge, sr, t + 0.005, 0.0002, U(r, 0.5, 0.7));
  modal(p, edge, sr, [[1800 * k, 0.03, 0.5], [3100 * k, 0.025, 0.4], [4700 * k, 0.02, 0.3]]);
  mix(out, p, 0.4);
  edge = new Float32Array(n);
  pulse(exc, sr, 0.17, 0.003, 1); pulse(edge, sr, 0.1705, 0.0003, 0.5);
  p = new Float32Array(n);
  modal(p, exc, sr, [[140 * k, 0.1, 0.8], [232 * k, 0.07, 0.4]]);
  modal(p, edge, sr, [[905 * k, 0.1, 0.4], [1510 * k, 0.08, 0.3]]);
  mix(out, p, 0.5);
  // the bell: a small brass gong, its partials inharmonic, the first pair beating
  const bell = new Float32Array(n), ham = new Float32Array(n), hf = [bq(sr, 'hp', 3000)];
  const f0 = U(r, 1180, 1260);
  let t = 0.28;
  const strikes = 8 + Math.floor(r() * 4);
  for (let i = 0; i < strikes; i++) { pulse(bell, sr, t, 0.00015, U(r, 0.75, 1)); burst(ham, sr, r, t, 0.00005, 0.0012, 1, hf); t += 1 / U(r, 13.5, 15.5); }
  const tr = t + U(r, 0.3, 0.4);
  pulse(bell, sr, tr, 0.00015, 0.8); burst(ham, sr, r, tr, 0.00005, 0.0012, 0.8, hf);
  pulse(bell, sr, tr + U(r, 0.07, 0.085), 0.00015, 0.7); burst(ham, sr, r, tr + 0.075, 0.00005, 0.0012, 0.7, hf);
  p = new Float32Array(n);
  modal(p, bell, sr, [[f0, 1.6, 0.5], [f0 * 1.006, 1.5, 0.4], [f0 * 1.58, 1.1, 0.35], [f0 * 2.33, 0.8, 0.3], [f0 * 2.86, 0.6, 0.2], [f0 * 3.75, 0.45, 0.15], [f0 * 4.92, 0.3, 0.1]]);
  mix(out, p, 1);
  mix(out, ham, 0.12);
  return fin(out, sr, 0.9, 0.3);
}

// the kettle set down on the stove: body ring, the stove's iron, a bounce, the lid chattering
function clank(sr, r) {
  const n = N(sr, 0.9), out = new Float32Array(n), k = U(r, 0.94, 1.06), tb = 0.005 + U(r, 0.045, 0.075);
  const exc = new Float32Array(n), edge = new Float32Array(n), lid = new Float32Array(n);
  pulse(exc, sr, 0.005, 0.0012, 1); pulse(edge, sr, 0.0055, 0.0002, 0.6);
  pulse(exc, sr, tb, 0.001, 0.35); pulse(edge, sr, tb, 0.0002, 0.25);
  for (const d of [0.05, 0.085, 0.11]) pulse(lid, sr, tb + d * U(r, 0.9, 1.1), 0.00015, U(r, 0.1, 0.2));
  let p = new Float32Array(n);
  modal(p, edge, sr, [[620 * k, 0.38, 0.5], [1040 * k, 0.3, 0.4], [1490 * k, 0.24, 0.35], [2210 * k, 0.17, 0.25], [3050 * k, 0.12, 0.15], [4170 * k, 0.09, 0.1]]);
  mix(out, p, 0.8);
  p = new Float32Array(n);
  modal(p, exc, sr, [[182 * k, 0.09, 0.8], [292 * k, 0.07, 0.4]]);
  mix(out, p, 0.6);
  p = new Float32Array(n);
  modal(p, lid, sr, [[2620 * k, 0.05, 0.4], [3900 * k, 0.04, 0.3], [5200 * k, 0.03, 0.2]]);
  mix(out, p, 0.25);
  return fin(out, sr, 0.9, 0.1);
}

// a dull mechanical clunk: a lever against its stop
function clunk(sr, r) {
  const n = N(sr, 0.35), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n), k = U(r, 0.92, 1.08);
  pulse(exc, sr, 0.004, 0.004, 1); pulse(edge, sr, 0.0045, 0.0006, 0.5);
  let p = new Float32Array(n);
  modal(p, exc, sr, [[104 * k, 0.11, 1], [166 * k, 0.08, 0.6], [262 * k, 0.06, 0.3]]);
  mix(out, p, 1);
  p = new Float32Array(n);
  modal(p, edge, sr, [[480 * k, 0.06, 0.4], [770 * k, 0.05, 0.3], [1150 * k, 0.04, 0.2]]);
  mix(out, p, 0.4);
  p = new Float32Array(n);
  burst(p, sr, r, 0.004, 0.0008, 0.01, 1, [bq(sr, 'lp', 500)]);
  mix(out, p, 0.3);
  return fin(out, sr, 0.9, 0.04);
}

// ------------------------------------------------------------ the sea

// a wave slapping the hull: the water's thwack, the plates' hollow thump, the splash and its drops
function slap(sr, r) {
  const n = N(sr, 1.1), out = new Float32Array(n), t0 = 0.01;
  let p = new Float32Array(n);
  burst(p, sr, r, t0, U(r, 0.006, 0.014), U(r, 0.05, 0.09), 1, [bq(sr, 'lp', U(r, 500, 750)), bq(sr, 'hp', 70)]);
  mix(out, p, 1);
  const exc = new Float32Array(n);
  pulse(exc, sr, t0 + 0.004, 0.01, 1);
  p = new Float32Array(n);
  modal(p, exc, sr, [[U(r, 60, 82), 0.14, 1], [U(r, 115, 140), 0.09, 0.5]]);
  mix(out, p, 0.65);
  p = new Float32Array(n);
  const sf = [bq(sr, 'hp', 1300), bq(sr, 'lp', 7000)], dec = U(r, 0.15, 0.28);
  for (let i = Math.round(t0 * sr); i < n; i++) {
    const t = i / sr - t0;
    let x = (r() * 2 - 1) * Math.min(1, t / 0.02) * Math.exp(-t / dec);
    for (let k = 0; k < 2; k++) x = sf[k].run(x);
    p[i] = x;
  }
  const drops = 15 + Math.floor(r() * 20);
  for (let d = 0; d < drops; d++) {
    const t = t0 + 0.04 + Math.pow(r(), 1.5) * 0.7, f = U(r, 900, 3500);
    chirp(p, sr, t, 0.03, f, f * 2.5, 0.02, U(r, 0.02, 0.08) * (1 - (t - t0)), 0.0004, U(r, 0.004, 0.009));
  }
  mix(out, p, 0.35);
  return fin(out, sr, 0.9, 0.1);
}

// ------------------------------------------------------------ the ice

// a distant crack: the snap, a scatter of smaller fractures, the dispersive 'pew' of a flexural wave
// through the sheet (the highs arrive first), and a low thump
function crack(sr, r) {
  const n = N(sr, 2), out = new Float32Array(n), t0 = 0.005;
  let p = new Float32Array(n);
  burst(p, sr, r, t0, 0.0002, 0.0005, 1, [bq(sr, 'hp', 600)]);
  const cnt = 4 + Math.floor(r() * 9), hf = [bq(sr, 'hp', 1500)];
  let t = t0;
  for (let i = 0; i < cnt; i++) { t += expo(r, 30); if (t > t0 + 0.35) break; burst(p, sr, r, t, 0.0001, U(r, 0.0002, 0.0006), U(r, 0.15, 0.7) * (1 - (t - t0) / 0.4), hf); }
  mix(out, p, 1);
  p = new Float32Array(n);
  chirp(p, sr, t0, 0.45, U(r, 2500, 4500), U(r, 160, 380), U(r, 0.035, 0.08), 1, 0.001, U(r, 0.08, 0.16));
  if (r() < 0.6) chirp(p, sr, t0 + U(r, 0.03, 0.08), 0.4, U(r, 2200, 4000), U(r, 180, 400), U(r, 0.03, 0.07), 0.5, 0.001, U(r, 0.06, 0.12));
  mix(out, p, 0.55);
  p = new Float32Array(n);
  chirp(p, sr, t0, 1.2, U(r, 42, 68), U(r, 38, 50), 0.3, 1, 0.008, U(r, 0.18, 0.32));
  burst(p, sr, r, t0, 0.01, 0.4, 0.4, [bq(sr, 'lp', 140)]);
  mix(out, p, 0.45);
  return fin(out, sr, 0.9, 0.3);
}

// a deep groan of the pack: a low, rough tone sliding in pitch, the ice's stick-slip in its grain
function iceGroan(sr, r) {
  const d = U(r, 2, 3.6), n = N(sr, d + 0.1), out = new Float32Array(n);
  const pts = [[0, U(r, 42, 65)], [U(r, 0.35, 0.5), U(r, 75, 140)], [U(r, 0.65, 0.8), U(r, 60, 110)], [1, U(r, 40, 85)]];
  const osc = new Osc(tbl('groan', () => table(Array.from({ length: 14 }, (_, h) => 1 / Math.pow(h + 1, 1.1)))));
  const rough = wander(r, n, sr, 22), wf = U(r, 2, 4);
  const b1 = bq(sr, 'bp', 140, 1.2), b2 = bq(sr, 'bp', 380, 2), b3 = bq(sr, 'bp', 900, 3);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = Math.min(1, t / d);
    const e = smooth(t / 0.5) * (t > d - 0.7 ? smooth((d - t) / 0.7) : 1);
    const f = curveAt(pts, u) * (1 + 0.03 * Math.sin(TAU * wf * t));
    const x = osc.step(f, sr) * e * (0.55 + 0.45 * rough[i]);
    out[i] = b1.run(x) + 0.6 * b2.run(x) + 0.25 * b3.run(x) + 0.3 * x;
  }
  norm(out, 1);
  let p = new Float32Array(n);
  const l1 = bq(sr, 'lp', 90), l2 = bq(sr, 'lp', 90);
  for (let i = 0; i < n; i++) { const t = i / sr; p[i] = l2.run(l1.run(r() * 2 - 1)) * smooth(t / 0.4) * (t > d - 0.5 ? smooth((d - t) / 0.5) : 1); }
  mix(out, p, 0.3);
  p = new Float32Array(n);
  const cnt = 6 + Math.floor(r() * 14), hf = [bq(sr, 'hp', 2000)];
  for (let c = 0; c < cnt; c++) burst(p, sr, r, U(r, 0.1, d), 0.0001, 0.0003, U(r, 0.3, 1), hf);
  mix(out, p, 0.12);
  return fin(out, sr, 0.9, 0.1);
}

// a big floe against the stem: a dense crush of fractures thinning out, the deep crunch of it, and
// the slabs splintering on afterwards (a few with the ice's laser-like 'pew')
function iceCrunch(sr, r) {
  const n = N(sr, 2.4), out = new Float32Array(n);
  let p = new Float32Array(n);
  const cf = [bq(sr, 'lp', U(r, 2500, 4500)), bq(sr, 'hp', 90)], cnt = 160 + Math.floor(r() * 140);
  for (let c = 0; c < cnt; c++) { const t = 0.005 + 0.55 * Math.pow(r(), 2.2); burst(p, sr, r, t, 0.0001, U(r, 0.0004, 0.003), U(r, 0.2, 1) * (1 - t / 0.6), cf); }
  mix(out, p, 1);
  p = new Float32Array(n);
  burst(p, sr, r, 0.005, 0.012, 0.16, 1, [bq(sr, 'lp', 380), bq(sr, 'lp', 600)]);
  mix(out, p, 0.85);
  p = new Float32Array(n);
  const sf = [bq(sr, 'hp', 2200)], sc = 20 + Math.floor(r() * 30);
  for (let c = 0; c < sc; c++) {
    const t = 0.05 + 1.4 * Math.pow(r(), 1.6);
    burst(p, sr, r, t, 0.00005, U(r, 0.0002, 0.0007), U(r, 0.1, 0.6) * (1 - t / 1.6), sf);
    if (r() < 0.15) chirp(p, sr, t, 0.12, U(r, 3000, 5000), U(r, 500, 900), 0.025, 0.25, 0.001, 0.04);
  }
  mix(out, p, 0.45);
  return fin(out, sr, 0.9, 0.2);
}

// the hull's answer to a big hit: the plates and frames boom, a second blow as the floe rolls
function iceBoom(sr, r) {
  const n = N(sr, 2.6), out = new Float32Array(n), exc = new Float32Array(n), edge = new Float32Array(n), k = U(r, 0.9, 1.1);
  pulse(exc, sr, 0.01, 0.012, 1);
  pulse(exc, sr, U(r, 0.05, 0.12), 0.015, U(r, 0.3, 0.6));
  pulse(edge, sr, 0.011, 0.001, 1);
  let p = new Float32Array(n);
  modal(p, exc, sr, [[U(r, 38, 46) * k, 1.5, 1], [U(r, 57, 66) * k, 1.2, 0.75], [U(r, 84, 96) * k, 0.95, 0.55], [131 * k, 0.75, 0.38], [187 * k, 0.6, 0.26], [263 * k, 0.45, 0.18], [371 * k, 0.33, 0.12], [522 * k, 0.24, 0.08]]);
  mix(out, p, 1);
  p = new Float32Array(n);
  burst(p, sr, r, 0.01, 0.004, 0.05, 1, [bq(sr, 'lp', 220)]);
  mix(out, p, 0.6);
  p = new Float32Array(n);
  modal(p, edge, sr, [[640 * k, 0.55, 0.3], [915 * k, 0.45, 0.26], [1290 * k, 0.35, 0.2], [1850 * k, 0.25, 0.12], [2600 * k, 0.18, 0.08]]);
  mix(out, p, 0.18);
  return fin(out, sr, 0.9, 0.3);
}

// ice squeaking on steel: stick-slip at a few hundred hertz through the hull plates' modes
function squeal(buf, sr, r, t0, d, f) {
  const fr = new Float32Array(buf.length);
  friction(fr, sr, r, t0, t0 + d, [[0, f], [0.5, f * U(r, 1.1, 1.35)], [1, f * U(r, 0.85, 1.05)]], 0.0003, (u) => Math.sin(Math.PI * u));
  modal(buf, fr, sr, [[690, 0.3, 0.5], [1130, 0.25, 0.4], [1580, 0.2, 0.3], [2210, 0.15, 0.2]]);
}

// a floe grinding along the hull: noise pressed and let go in stick-slip jerks, crunching grains,
// a low rumble along the plates, sometimes a squeal (played for 0.5-2 s with a fade)
function iceScrape(sr, r) {
  const d = 2.2, n = N(sr, d), out = new Float32Array(n);
  const env = (t) => Math.min(1, t / 0.06) * (t < 1.7 ? 1 : Math.max(0, 1 - (t - 1.7) / 0.5));
  let p = new Float32Array(n);
  const m = wander(r, n, sr, 16), f1 = bq(sr, 'bp', U(r, 500, 900), 0.9), f2 = bq(sr, 'lp', 3000);
  for (let i = 0; i < n; i++) { const a = Math.max(0, m[i] * 0.8 + 0.4); p[i] = f2.run(f1.run(r() * 2 - 1)) * a * a * env(i / sr); }
  mix(out, p, 0.7);
  p = new Float32Array(n);
  const gf = [bq(sr, 'hp', 350), bq(sr, 'lp', 3200)];
  for (let t = 0.01; t < 1.9; t += expo(r, 30)) burst(p, sr, r, t, 0.0003, U(r, 0.0008, 0.004), Math.pow(r(), 2) * env(t), gf);
  mix(out, p, 0.5);
  p = new Float32Array(n);
  const l1 = bq(sr, 'lp', 120), l2 = bq(sr, 'lp', 120);
  for (let i = 0; i < n; i++) p[i] = l2.run(l1.run(r() * 2 - 1)) * env(i / sr);
  mix(out, p, 0.55);
  if (r() < 0.6) {
    p = new Float32Array(n);
    squeal(p, sr, r, U(r, 0.2, 0.6), U(r, 0.4, 0.9), U(r, 300, 560));
    mix(out, p, 0.3);
  }
  return fin(out, sr, 0.9, 0.05);
}

// the continuous grind while she pushes ice (a 6 s loop)
function grindLoop(sr, r) {
  const L = 6, n = N(sr, L), X = N(sr, 0.3), out = new Float32Array(n);
  const cont = new Float32Array(n + X), m = wander(r, n + X, sr, 14), sw = wander(r, n + X, sr, 1.5);
  const f1 = bq(sr, 'bp', 700, 0.8), f2 = bq(sr, 'lp', 2500), l1 = bq(sr, 'lp', 130), l2 = bq(sr, 'lp', 130);
  const sc = new Float32Array(n + X), ru = new Float32Array(n + X);
  for (let i = 0; i < n + X; i++) {
    const a = Math.max(0, m[i] * 0.8 + 0.35);
    sc[i] = f2.run(f1.run(r() * 2 - 1)) * a * a;
    ru[i] = l2.run(l1.run(r() * 2 - 1)) * (0.6 + 0.4 * sw[i]);
  }
  mix(cont, sc, 0.6);
  mix(cont, ru, 0.6);
  mix(out, xfade(cont, n), 0.75);
  const ev = new Float32Array(n + X), gr = new Float32Array(n + X), gf = [bq(sr, 'hp', 350), bq(sr, 'lp', 3200)];
  for (let t = 0; t < L; t += expo(r, 35)) burst(gr, sr, r, t, 0.0003, U(r, 0.0008, 0.004), Math.pow(r(), 2.2), gf);
  mix(ev, gr, 0.55);
  const sq = new Float32Array(n + X), cnt = 2 + Math.floor(r() * 2);
  for (let c = 0; c < cnt; c++) squeal(sq, sr, r, U(r, 0.2, L - 1.2), U(r, 0.3, 0.8), U(r, 300, 600));
  mix(ev, sq, 0.3);
  mix(out, fold(ev, n), 0.6);
  return norm(dc(out), 0.9);
}

// ------------------------------------------------------------ the hull

// the hull flexing: slow stick-slip through the low modes of the frames and plates
function hullGroan(sr, r) {
  const d = U(r, 2.5, 4.5), n = N(sr, d + 1.2), out = new Float32Array(n), fr = new Float32Array(n), k = U(r, 0.85, 1.15);
  const accent = U(r, 0, 1);
  friction(fr, sr, r, 0.05, d, [[0, U(r, 14, 22)], [U(r, 0.35, 0.6), U(r, 25, 45)], [1, U(r, 12, 20)]], 0.0015,
    (u) => smooth(u / 0.3) * smooth((1 - u) / 0.35) * (0.7 + 0.3 * Math.sin(TAU * (u * 2.3 + accent))));
  modal(out, fr, sr, [[62 * k, 1.4, 1], [97 * k, 1.2, 0.8], [141 * k, 1, 0.7], [188 * k, 0.9, 0.6], [263 * k, 0.7, 0.5], [344 * k, 0.6, 0.4], [471 * k, 0.45, 0.3], [612 * k, 0.35, 0.2]]);
  norm(out, 1);
  const p = new Float32Array(n), l = bq(sr, 'lp', 200);
  for (let i = 0; i < n; i++) { const u = i / sr / d; p[i] = l.run(r() * 2 - 1) * (u < 1 ? Math.sin(Math.PI * u) : 0); }
  mix(out, p, 0.15);
  filt(out, bq(sr, 'lp', 1500));
  return fin(out, sr, 0.9, 0.3);
}

// a sharper creak somewhere in the steelwork
function hullCreak(sr, r) {
  const d = U(r, 1, 1.8), n = N(sr, d + 0.5), out = new Float32Array(n), fr = new Float32Array(n), k = U(r, 0.85, 1.15);
  friction(fr, sr, r, 0.03, d, [[0, U(r, 8, 11)], [U(r, 0.4, 0.6), U(r, 22, 30)], [1, U(r, 13, 18)]], 0.0006, (u) => Math.sin(Math.PI * u));
  modal(out, fr, sr, [[310 * k, 0.25, 0.7], [470 * k, 0.2, 0.8], [690 * k, 0.17, 0.6], [980 * k, 0.14, 0.5], [1350 * k, 0.11, 0.35], [1870 * k, 0.08, 0.2]]);
  return fin(out, sr, 0.9, 0.15);
}

// ------------------------------------------------------------ birds and beasts

// a herring gull's call: a drawn-out first note, then quick nasal 'kyow's, falling and fading
function gull(sr, r) {
  const notes = 3 + Math.floor(r() * 6), plan = [];
  let t = 0.01;
  for (let i = 0; i < notes; i++) {
    const first = i === 0 && r() < 0.7, d = first ? U(r, 0.32, 0.48) : U(r, 0.11, 0.2);
    const k = Math.pow(0.975, i) * U(r, 0.97, 1.03);
    plan.push({
      t, d,
      fA: first ? U(r, 600, 700) : U(r, 1000, 1150) * k,
      fB: first ? U(r, 850, 950) : U(r, 1300, 1500) * k,
      fC: first ? U(r, 650, 760) : U(r, 800, 950) * k,
      a: first ? 0.8 : U(r, 0.75, 1) * Math.pow(0.93, i),
    });
    t += d + (first ? U(r, 0.12, 0.2) : U(r, 0.06, 0.1));
  }
  const n = N(sr, t + 0.05), out = new Float32Array(n), br = new Float32Array(n);
  const osc = new Osc(tbl('gull', () => table([1, 0.8, 0.7, 0.55, 0.45, 0.32, 0.25, 0.18, 0.12, 0.08]))), nb = bq(sr, 'bp', 2600, 1.2);
  const fm = U(r, 75, 105);
  for (const p of plan) {
    const a = Math.round(p.t * sr), m = N(sr, p.d);
    for (let i = 0; i < m && a + i < n; i++) {
      const u = i / m, tt = i / sr;
      const f = u < 0.25 ? p.fA + (p.fB - p.fA) * smooth(u / 0.25) : p.fB + (p.fC - p.fB) * smooth((u - 0.25) / 0.75);
      const e = Math.min(1, tt / 0.012) * Math.min(1, (p.d - tt) / 0.03) * (0.8 + 0.2 * Math.sin(Math.PI * u)) * p.a;
      out[a + i] += osc.step(f * (1 + 0.03 * Math.sin(TAU * fm * (a + i) / sr)), sr) * e;
      br[a + i] += nb.run(r() * 2 - 1) * e;
    }
  }
  norm(out, 1);
  mix(out, br, 0.12);
  filt(out, bq(sr, 'hp', 450), bq(sr, 'peak', 2700, 1.3, 7), bq(sr, 'lp', 6500));
  return fin(out, sr, 0.9, 0.01);
}

// a vocal tract: four cascaded formants (set every 64 samples by fn(u) → [F1, F2, F3])
function tract(sr, bws) {
  const R = [new Res(sr), new Res(sr), new Res(sr), new Res(sr)];
  return {
    set(F) { R[0].set(F[0], bws[0]); R[1].set(F[1], bws[1]); R[2].set(F[2], bws[2]); R[3].set(F[3] || 3500, bws[3] || 300); },
    run(x) { return R[3].run(R[2].run(R[1].run(R[0].run(x)))); },
  };
}

// a walrus's grunt: a low, irregular pulse (vocal fry) through big, low formants, gurgling
function walrusGrunt(sr, r) {
  const d = U(r, 0.35, 0.7), n = N(sr, d + 0.1), out = new Float32Array(n);
  const g = new Glottis(r, { open: 0.5, close: 0.2, jitter: 0.08, shimmer: 0.3, sub: 0.25 });
  const f0 = U(r, 36, 58), gur = wander(r, n, sr, 24), T = tract(sr, [120, 160, 250, 350]);
  T.set([U(r, 250, 300), U(r, 600, 700), 1300, 2600]);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / d;
    const e = u > 1 ? 0 : Math.min(1, t / 0.03) * Math.pow(1 - u, 0.6);
    const x = g.step(f0 * (1 + 0.25 * Math.sin(Math.PI * Math.min(u, 1))), sr) * e * (0.5 + 0.5 * gur[i]) + (r() * 2 - 1) * 0.08 * e;
    out[i] = T.run(x);
  }
  norm(out, 1);
  const wet = new Float32Array(n), wb = [bq(sr, 'bp', 480, 1.5)], cnt = 5 + Math.floor(r() * 8);
  for (let c = 0; c < cnt; c++) burst(wet, sr, r, r() * d * 0.9, 0.003, U(r, 0.008, 0.02), U(r, 0.4, 1), wb);
  mix(out, wet, 0.3);
  filt(out, bq(sr, 'lp', 2200));
  return fin(out, sr, 0.9, 0.05);
}

// a bull walrus's roar: a long, rough bellow rising and falling, the mouth opening and closing
function walrusRoar(sr, r) {
  const d = U(r, 1.4, 1.8), n = N(sr, d + 0.15), out = new Float32Array(n);
  const g = new Glottis(r, { open: 0.5, close: 0.16, jitter: 0.07, shimmer: 0.35, sub: 0.4 });
  const k = U(r, 0.9, 1.1), pts = [[0, 70 * k], [0.35, 115 * k], [0.7, 95 * k], [1, 72 * k]];
  const T = tract(sr, [150, 200, 300, 400]);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = Math.min(1, t / d);
    if ((i & 63) === 0) T.set([400 + 250 * Math.sin(Math.PI * Math.min(1, u * 1.4)), 900 + 280 * Math.sin(Math.PI * u), 2350, 3300]);
    const e = t > d ? 0 : smooth(t / 0.18) * (t > d - 0.3 ? smooth((d - t) / 0.3) : 1) * (0.85 + 0.15 * Math.sin(Math.PI * u));
    const f = curveAt(pts, u) * (1 + 0.02 * Math.sin(TAU * 5 * t));
    out[i] = T.run(g.step(f, sr) * e + (r() * 2 - 1) * 0.25 * e);
  }
  filt(out, bq(sr, 'peak', 150, 1, 6), bq(sr, 'lp', 3200));
  return fin(out, sr, 0.9, 0.08);
}

// one Adélie 'ark': a harsh, noisy, rattling squawk whose mouth closes (F1 falls) on a hard 'k'
function ark(out, sr, r, t0, d, f0, noiseAmt) {
  const g = new Glottis(r, { open: 0.45, close: 0.1, jitter: 0.06, shimmer: 0.25, sub: 0.3 });
  const T = tract(sr, [160, 190, 260, 350]), a = Math.round(t0 * sr), m = N(sr, d), am = U(r, 55, 85);
  for (let i = 0; i < m && a + i < out.length; i++) {
    const t = i / sr, u = t / d;
    if ((i & 63) === 0) T.set([950 - 300 * u * u, 1650 - 300 * u, 2850 - 400 * u, 3800]);
    const e = Math.min(1, t / 0.008) * Math.min(1, (d - t) / 0.012);
    const f = f0 * (u < 0.3 ? 1 + 0.12 * (u / 0.3) : 1.12 - 0.3 * (u - 0.3));
    const rough = 1 - 0.45 * (0.5 + 0.5 * Math.sin(TAU * am * t));
    out[a + i] += T.run((g.step(f, sr) * (1 - noiseAmt) + (r() * 2 - 1) * noiseAmt * 2.5) * e * rough);
  }
  burst(out, sr, r, t0 + d, 0.0001, 0.0008, 0.15, [bq(sr, 'hp', 2500)]);
}

function penguinCall(sr, r) {
  const count = 2 + Math.floor(r() * 3), f0 = U(r, 300, 420), plan = [];
  let t = 0.01;
  for (let i = 0; i < count; i++) { const d = U(r, 0.16, 0.26); plan.push([t, d, f0 * (1 - 0.06 * i)]); t += d + U(r, 0.14, 0.28); }
  const out = new Float32Array(N(sr, t + 0.05));
  for (const [t0, d, f] of plan) ark(out, sr, r, t0, d, f, 0.4);
  filt(out, bq(sr, 'hp', 250));
  return fin(out, sr, 0.9, 0.01);
}

function penguinAlarm(sr, r) {
  const count = 6 + Math.floor(r() * 5), f0 = U(r, 450, 560);
  const out = new Float32Array(N(sr, count * 0.13 + 0.15));
  let t = 0.01;
  for (let i = 0; i < count; i++) { ark(out, sr, r, t, U(r, 0.055, 0.085), f0 * U(r, 0.95, 1.05), 0.55); t += U(r, 0.1, 0.13); }
  filt(out, bq(sr, 'hp', 300));
  return fin(out, sr, 0.9, 0.01);
}

// ------------------------------------------------------------ the ship's horn

// Two big reeds a little apart (they beat, the throb of a ship's horn), a narrow-pulse waveform, the
// pitch coming up as the air pressure builds and sagging as it's cut. The tone brightens with the
// pressure (a lowpass that opens with the envelope) and the trumpet adds its resonances.
function horn(sr, r) {
  const on = 2.5, n = N(sr, 3.2), out = new Float32Array(n);
  const f1 = U(r, 118, 128), f2 = f1 * U(r, 1.012, 1.02);
  const reed = tbl('reed', () => table(Array.from({ length: 40 }, (_, h) => Math.abs(Math.sin(Math.PI * (h + 1) * 0.3)) / (h + 1))));
  const o1 = new Osc(reed), o2 = new Osc(reed, 0.37);
  const lp = new BQ(sr), res = [bq(sr, 'peak', 260, 2, 4), bq(sr, 'peak', 520, 2, 3), bq(sr, 'peak', 1100, 1.5, 2)];
  const air = bq(sr, 'bp', 1500, 0.7), wob = wander(r, n, sr, 3);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = smooth(t / 0.25) * (t < on ? 1 : Math.exp(-(t - on) / 0.11));
    const pitch = (0.9 + 0.1 * smooth(t / 0.3)) * (t > on - 0.05 ? 1 - 0.06 * smooth((t - on + 0.05) / 0.3) : 1) * (1 + 0.003 * wob[i]);
    if ((i & 63) === 0) lp.set('lp', 300 + 3200 * Math.pow(env, 1.5), 0.7);
    let y = lp.run((o1.step(f1 * pitch, sr) + 0.85 * o2.step(f2 * pitch, sr)) * env);
    for (let k = 0; k < 3; k++) y = res[k].run(y);
    out[i] = y + air.run(r() * 2 - 1) * 0.04 * env;
  }
  return fin(out, sr, 0.92, 0.1);
}

// ------------------------------------------------------------ the main engine

// The diesel's loop is rendered at ENGINE_F0 firings a second; Audio.js plays it faster or slower
// (6 Hz idle to 14 Hz full) with the playback rate.
export const ENGINE_F0 = 10;

// Per firing: the combustion's thump (the block's low modes), the exhaust's bark, the injection
// knock ringing the block (the diesel clatter); tappets tick between firings.
function dieselParts(sr, r, n, fires, ticks) {
  const thump = new Float32Array(n), bark = new Float32Array(n), knock = new Float32Array(n), edge = new Float32Array(n), tick = new Float32Array(n);
  const bf = [bq(sr, 'bp', 190, 1.4), bq(sr, 'lp', 700)];
  for (const [t, a, kn] of fires) {
    pulse(thump, sr, t, 0.0045, a);
    burst(bark, sr, r, t + 0.002, 0.0015, 0.018, a, bf);
    burst(knock, sr, r, t + 0.0015, 0.0002, 0.0025, a * kn, null);
    pulse(edge, sr, t + 0.0015, 0.00025, a * kn);
  }
  for (const [t, a] of ticks) pulse(tick, sr, t, 0.0002, a);
  const out = new Float32Array(n);
  let p = new Float32Array(n);
  modal(p, thump, sr, [[46, 0.1, 1], [92, 0.07, 0.55], [139, 0.05, 0.3], [205, 0.04, 0.15]]);
  mix(out, p, 1);
  mix(out, bark, 0.5);
  filt(knock, bq(sr, 'hp', 1300));
  modal(knock, edge, sr, [[830, 0.05, 0.5], [1370, 0.04, 0.4], [2110, 0.03, 0.3], [2950, 0.025, 0.2]]);
  mix(out, knock, 0.32);
  if (ticks.length) {
    p = new Float32Array(n);
    modal(p, tick, sr, [[3100, 0.015, 0.4], [4600, 0.012, 0.3]]);
    mix(out, p, 0.08);
  }
  // (the low modes start on a half-cycle each: keep the sub-audio pulse out of the mix)
  return filt(out, bq(sr, 'hp', 28, 0.6));
}

// 24 firings of a six-cylinder diesel, each cylinder a little different (that's the lumpy beat of a
// real engine), and the clatter of the running gear pulsing with them
function engineLoop(sr, r) {
  const F = 24, n = N(sr, F / ENGINE_F0), tail = N(sr, 0.4), X = N(sr, 0.2);
  const cylA = [1, 0.86, 0.95, 1.08, 0.9, 0.97], cylT = [0, 0.0015, -0.001, 0.0008, -0.0016, 0.0005], cylK = [0.8, 1, 0.7, 0.9, 1.1, 0.75];
  const fires = [], ticks = [];
  for (let i = 0; i < F; i++) {
    const c = i % 6, t = i / ENGINE_F0 + cylT[c] + 0.002;
    fires.push([t, cylA[c] * U(r, 0.94, 1.06), cylK[c] * U(r, 0.6, 1.2)]);
    ticks.push([t + 0.35 / ENGINE_F0, U(r, 0.4, 1)], [t + 0.68 / ENGINE_F0, U(r, 0.3, 0.8)]);
  }
  const ev = fold(dieselParts(sr, r, n + tail, fires, ticks), n);
  const cl = new Float32Array(n + X), h = bq(sr, 'hp', 700), l = bq(sr, 'lp', 3200);
  for (let i = 0; i < n + X; i++) {
    const ph = ((i / sr) * ENGINE_F0) % 1;
    cl[i] = l.run(h.run(r() * 2 - 1)) * (0.35 + 0.65 * Math.exp(-ph / 0.25));
  }
  const out = norm(ev, 1);
  mix(out, xfade(cl, n), 0.1);
  return norm(dc(out), 0.9);
}

// the start: the air-start valve's hiss, compression strokes as the air turns her over, the
// starter's whine climbing, then a cough, a stumble (a missed beat), and she settles to idle
// (Audio.js brings the running loop in under the last firings)
function engineStart(sr, r) {
  const n = N(sr, 2.95), out = new Float32Array(n);
  let p = new Float32Array(n);
  burst(p, sr, r, 0, 0.004, 0.05, 1, [bq(sr, 'hp', 2200), bq(sr, 'lp', 9000)]);
  const hs = bq(sr, 'bp', 3600, 0.6), ro = bq(sr, 'bp', 650, 0.8);
  for (let i = N(sr, 0.04); i < N(sr, 1.6); i++) {
    const t = i / sr, e = smooth((t - 0.04) / 0.08) * (t < 1.15 ? 1 : Math.exp(-(t - 1.15) / 0.12)), w = r() * 2 - 1;
    p[i] += (hs.run(w) * 0.6 + ro.run(w) * 0.5) * e;
  }
  mix(out, p, 0.4);
  const cr = new Float32Array(n), pf = new Float32Array(n), pff = [bq(sr, 'lp', 900)];
  let t = 0.2, rate = 2.4;
  while (t < 1.25) { pulse(cr, sr, t, 0.007, U(r, 0.7, 1)); burst(pf, sr, r, t + 0.01, 0.004, 0.03, 1, pff); t += 1 / rate; rate = Math.min(5.2, rate * 1.18); }
  p = new Float32Array(n);
  modal(p, cr, sr, [[44, 0.12, 1], [88, 0.08, 0.5]]);
  mix(out, p, 0.55);
  mix(out, pf, 0.2);
  p = new Float32Array(n);
  const saw = new Osc(tbl('saw', () => table(Array.from({ length: 24 }, (_, h) => 1 / (h + 1))))), gear = new Osc(tbl('sine', () => table([1])));
  for (let i = N(sr, 0.1); i < N(sr, 1.55); i++) {
    const tt = i / sr, u = clamp((tt - 0.1) / 1.15, 0, 1);
    let f = 140 * Math.pow(520 / 140, smooth(u));
    if (tt > 1.3) f *= 1 - 0.35 * smooth((tt - 1.3) / 0.25);
    const e = smooth((tt - 0.1) / 0.15) * (tt > 1.3 ? 1 - smooth((tt - 1.3) / 0.25) : 1);
    p[i] = (saw.step(f, sr) + 0.3 * gear.step(f * 3.7, sr)) * e;
  }
  filt(p, bq(sr, 'lp', 3000));
  mix(out, p, 0.22);
  const fires = [[1.3, 1.8, 0.9], [1.52, 1.1, 0.8], [1.68, 1.25, 1], [2, 1.2, 0.9], [2.13, 1, 0.8], [2.26, 0.95, 0.8], [2.39, 0.9, 0.75], [2.52, 0.8, 0.7], [2.66, 0.6, 0.7], [2.8, 0.4, 0.7]]
    .map(([ft, a, k]) => [ft + U(r, -0.008, 0.008), a, k]);
  mix(out, dieselParts(sr, r, n, fires, []), 0.95);
  p = new Float32Array(n);
  burst(p, sr, r, 1.3, 0.005, 0.07, 1, [bq(sr, 'lp', 300)]);
  mix(out, p, 0.5);
  return fin(out, sr, 0.9, 0.12);
}

// the fuel cut's last moment: compression thumps slowing as she rolls to a stop, a settling clunk,
// loose parts rattling, a sigh from the exhaust
function engineShudder(sr, r) {
  const n = N(sr, 1.7), out = new Float32Array(n);
  mix(out, dieselParts(sr, r, n, [[0.01, 1, 0.3], [0.27, 0.9, 0.25], [0.59, 0.7, 0.2], [1.01, 0.45, 0.1]], []), 1);
  const exc = new Float32Array(n), edge = new Float32Array(n);
  pulse(exc, sr, 1.05, 0.006, 1);
  for (let i = 0, t = 1.06; i < 5; i++, t += U(r, 0.02, 0.04)) pulse(edge, sr, t, 0.0002, U(r, 0.3, 1));
  let p = new Float32Array(n);
  modal(p, exc, sr, [[60, 0.3, 1], [95, 0.2, 0.5]]);
  mix(out, p, 0.6);
  p = new Float32Array(n);
  modal(p, edge, sr, [[1900, 0.05, 0.4], [2800, 0.04, 0.3], [4100, 0.03, 0.2]]);
  mix(out, p, 0.25);
  p = new Float32Array(n);
  const l = bq(sr, 'lp', 500);
  for (let i = N(sr, 0.9); i < n; i++) { const t = i / sr - 0.9; p[i] = l.run(r() * 2 - 1) * Math.min(1, t / 0.1) * Math.exp(-t / 0.35); }
  mix(out, p, 0.3);
  return fin(out, sr, 0.9, 0.2);
}

// ------------------------------------------------------------ the kettle and the radio

// a pot on the boil: a low rumble and hundreds of little bubbles (each a rising sine as it collapses)
function bubble(out, sr, t, f, d, amp) {
  const a = Math.round(t * sr), m = N(sr, d * 5);
  let ph = 0;
  for (let i = 0; i < m && a + i < out.length; i++) {
    const tt = i / sr;
    ph += TAU * f * (1 + 2.5 * tt / (d * 5)) / sr;
    out[a + i] += Math.sin(ph) * Math.exp(-tt / d) * amp * Math.min(1, tt / 0.0005);
  }
}
function boilLoop(sr, r) {
  const L = 5, n = N(sr, L), X = N(sr, 0.25), out = new Float32Array(n);
  const c = new Float32Array(n + X), hs = new Float32Array(n + X), sw = wander(r, n + X, sr, 3);
  const l1 = bq(sr, 'lp', 190), l2 = bq(sr, 'lp', 190), h = bq(sr, 'hp', 3000);
  for (let i = 0; i < n + X; i++) { c[i] = l2.run(l1.run(r() * 2 - 1)) * (0.65 + 0.35 * sw[i]); hs[i] = h.run(r() * 2 - 1); }
  norm(c, 1);
  mix(c, hs, 0.06);
  mix(out, xfade(c, n), 0.45);
  const b = new Float32Array(n + N(sr, 0.08));
  for (let t = 0; t < L; t += expo(r, 70)) bubble(b, sr, t, U(r, 250, 1400), U(r, 0.004, 0.014), Math.pow(r(), 1.5));
  mix(out, fold(b, n), 0.6);
  return norm(dc(out), 0.9);
}

// the radio's crackle: sparse clicks, and now and then a stretch of frying
function crackle(sr, r) {
  const L = 4, n = N(sr, L), b = new Float32Array(n + N(sr, 0.02)), f = [bq(sr, 'hp', 700)];
  for (let t = 0; t < L; t += expo(r, 9)) burst(b, sr, r, t, 0.00005, U(r, 0.0002, 0.0012), Math.pow(r(), 2.5), f);
  const fr = 1 + Math.floor(r() * 2);
  for (let k = 0; k < fr; k++) {
    const t0 = U(r, 0, L - 0.4), d = U(r, 0.1, 0.3);
    for (let t = t0; t < t0 + d; t += expo(r, 220)) burst(b, sr, r, t, 0.00003, U(r, 0.0001, 0.0004), U(r, 0.05, 0.3), f);
  }
  return norm(dc(fold(b, n)), 0.9);
}

// ------------------------------------------------------------ voices

// Russian-sounding speech, by formant synthesis. Words of one to four syllables with one stress
// each: stressed vowels long and full, the others short and reduced (o and a fall to a schwa), soft
// (palatalised) consonants gliding through an 'i' into the vowel, rolled r's, plenty of s, sh, shch,
// kh, ts and ch. Over each phrase the pitch drifts down and the last stress falls, or (a question)
// rises and falls.
const VOWELS = { a: [700, 1220, 2500], o: [540, 900, 2450], u: [340, 760, 2300], e: [480, 1750, 2500], i: [290, 2200, 2950], y: [340, 1500, 2350], x: [500, 1350, 2450] };
const STRESSED = 'aaaoooeeiiuy', UNSTRESSED = 'xxxxiiiaauy';
const CONS = {
  p: { k: 'stop', b: [900, 0.8] }, t: { k: 'stop', b: [4200, 1.4] }, k: { k: 'stop', b: [1900, 1.6] },
  b: { k: 'vstop', b: [800, 0.8] }, d: { k: 'vstop', b: [3800, 1.4] }, g: { k: 'vstop', b: [1800, 1.6] },
  s: { k: 'fric', b: [6200, 2.2], d: 0.095, a: 0.6 }, sh: { k: 'fric', b: [3000, 1.8], d: 0.1, a: 0.65 },
  sc: { k: 'fric', b: [3700, 1.8], d: 0.14, a: 0.6 }, kh: { k: 'fric', b: [1500, 1.1], d: 0.08, a: 0.4 },
  f: { k: 'fric', b: [2600, 0.6], d: 0.08, a: 0.3 },
  ts: { k: 'affr', b: [5800, 2.2], d: 0.07, a: 0.6 }, ch: { k: 'affr', b: [3400, 1.8], d: 0.08, a: 0.6 },
  v: { k: 'vfric', b: [2400, 0.6], F: [300, 1100, 2300], d: 0.06, a: 0.15 },
  z: { k: 'vfric', b: [5800, 2.2], F: [300, 1500, 2500], d: 0.07, a: 0.35 },
  zh: { k: 'vfric', b: [2900, 1.8], F: [300, 1650, 2400], d: 0.07, a: 0.35 },
  m: { k: 'nasal', F: [250, 1100, 2200], d: 0.065 }, n: { k: 'nasal', F: [250, 1550, 2500], d: 0.06 },
  l: { k: 'liquid', F: [380, 1000, 2400], d: 0.055 }, r: { k: 'trill', F: [450, 1300, 1700], d: 0.065 },
  j: { k: 'glide', F: [280, 2200, 2900], d: 0.045 },
};
const CONS_LIST = [];
for (const w of 't6 n6 s5 r5 v5 l4 k4 m3 d3 p3 z2 b2 g2 ch2 sh2 zh1 kh1 ts1 sc1 f1 j2'.split(' ')) {
  const name = w.replace(/\d+$/, ''), count = +w.slice(name.length);
  for (let i = 0; i < count; i++) CONS_LIST.push(name);
}
const SOFT = { t: 1, d: 1, n: 1, l: 1, s: 1, z: 1, r: 1, v: 1, m: 1 };

function speech(r, seconds, rate) {
  const segs = [];
  let t = 0;
  const add = (s) => { s.t = t; segs.push(s); t += s.d; };
  const cons = (name) => {
    const c = CONS[name];
    switch (c.k) {
      case 'stop':
        add({ d: U(r, 0.035, 0.055) * rate, av: 0, an: 0 });
        add({ d: 0.011, av: 0, an: 0.9, nb: c.b });
        add({ d: U(r, 0.012, 0.025), av: 0, an: 0.22, nb: [1600, 0.7] });
        break;
      case 'vstop':
        add({ d: U(r, 0.03, 0.045) * rate, F: [200, 900, 2300], av: 0.16, an: 0 });
        add({ d: 0.008, av: 0.35, an: 0.5, nb: c.b });
        break;
      case 'fric': add({ d: c.d * U(r, 0.8, 1.2) * rate, av: 0, an: c.a, nb: c.b }); break;
      case 'affr':
        add({ d: U(r, 0.025, 0.04) * rate, av: 0, an: 0 });
        add({ d: 0.008, av: 0, an: 0.8, nb: c.b });
        add({ d: c.d * U(r, 0.8, 1.1) * rate, av: 0, an: c.a, nb: c.b });
        break;
      case 'vfric': add({ d: c.d * U(r, 0.8, 1.2) * rate, F: c.F, av: 0.45, an: c.a, nb: c.b }); break;
      case 'nasal': add({ d: c.d * U(r, 0.8, 1.2) * rate, F: c.F, av: 0.42, an: 0, nasal: 1 }); break;
      case 'trill': add({ d: c.d * U(r, 0.8, 1.3) * rate, F: c.F, av: 0.6, an: 0, tr: 1 }); break;
      default: add({ d: c.d * U(r, 0.8, 1.2) * rate, F: c.F, av: 0.62, an: 0 });
    }
    if (SOFT[name] && r() < 0.28) add({ d: 0.028 * rate, F: VOWELS.i, av: 0.55, an: 0 });
  };
  while (t < seconds) {
    const p0 = segs.length, t0 = t, words = 2 + Math.floor(r() * 5), question = r() < 0.18;
    for (let w = 0; w < words; w++) {
      const x = r(), syl = x < 0.25 ? 1 : x < 0.6 ? 2 : x < 0.85 ? 3 : 4, stress = Math.floor(r() * syl);
      for (let s = 0; s < syl; s++) {
        const st = s === stress, on = r();
        if (on < 0.72) cons(pick(r, CONS_LIST));
        else if (on < 0.9) { cons(pick(r, ['s', 'sh', 'v', 'k', 'p', 't', 'z'])); cons(pick(r, ['t', 'r', 'l', 'v', 'n', 'k'])); }
        const v = pick(r, st ? STRESSED : UNSTRESSED);
        add({ d: (st ? U(r, 0.13, 0.2) : U(r, 0.05, 0.085)) * rate, F: VOWELS[v], av: st ? 1 : 0.68, an: 0.025, nb: [1800, 0.6], pm: st ? U(r, 1.15, 1.3) : 1, st });
        if ((s === syl - 1 && r() < 0.45) || r() < 0.12) cons(pick(r, CONS_LIST));
      }
      if (r() < 0.15) add({ d: U(r, 0.05, 0.12), av: 0, an: 0 });
    }
    // the tune of the phrase
    const dur = t - t0;
    let lastStress = -1;
    for (let i = p0; i < segs.length; i++) if (segs[i].st) lastStress = i;
    for (let i = p0; i < segs.length; i++) {
      const s = segs[i];
      if (s.pm === undefined) continue;
      s.pm *= 1.1 - 0.24 * (s.t - t0) / dur;
      if (i === lastStress) s.pm = question ? 1.45 : 0.8;
      else if (lastStress >= 0 && i > lastStress) s.pm = question ? 1 : 0.76;
    }
    add({ d: U(r, 0.18, 0.5), av: 0, an: r() < 0.3 ? 0.06 : 0.008, nb: [1200, 0.7] });
  }
  return segs;
}

// o: { pitch, rate, tract, muffled }
export function babble(sr, r, seconds, o = {}) {
  const rate = o.rate ?? U(r, 0.92, 1.1), f0 = o.pitch ?? U(r, 95, 135), tr = o.tract ?? U(r, 0.95, 1.07);
  const segs = speech(r, seconds, rate);
  const n = N(sr, seconds), out = new Float32Array(n);
  const gl = new Glottis(r, { open: 0.58, close: 0.14, jitter: 0.012, shimmer: 0.06 });
  const R1 = new Res(sr), R2 = new Res(sr), R3 = new Res(sr), R4 = new Res(sr).set(3500 * tr, 250), nbq = bq(sr, 'bp', 1800, 0.6);
  const kF = 1 - Math.exp(-1 / (0.014 * sr)), kA = 1 - Math.exp(-1 / (0.006 * sr)), kN = 1 - Math.exp(-1 / (0.0025 * sr)), kP = 1 - Math.exp(-1 / (0.05 * sr));
  let F1 = 500, F2 = 1400, F3 = 2450, tF1 = 500, tF2 = 1400, tF3 = 2450;
  let av = 0, an = 0, pm = 1, tav = 0, tan = 0, tpm = 1, trill = 0, nasal = 0, si = -1, end = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    while (t >= end && si < segs.length - 1) {
      const s = segs[++si];
      end = s.t + s.d;
      if (s.F) { tF1 = s.F[0] * tr; tF2 = s.F[1] * tr; tF3 = s.F[2] * tr; }
      tav = s.av; tan = s.an;
      if (s.nb) nbq.set('bp', s.nb[0], s.nb[1]);
      if (s.pm !== undefined) tpm = s.pm;
      trill = s.tr || 0; nasal = s.nasal || 0;
    }
    if (t >= end) { tav = 0; tan = 0; }
    F1 += (tF1 - F1) * kF; F2 += (tF2 - F2) * kF; F3 += (tF3 - F3) * kF;
    av += (tav - av) * kA; an += (tan - an) * kN; pm += (tpm - pm) * kP;
    if ((i & 31) === 0) { R1.set(F1, 90 + nasal * 80); R2.set(F2, 110); R3.set(F3, 170); }
    const f = f0 * pm * (1 + 0.006 * Math.sin(TAU * 5.1 * t));
    let x = gl.step(f, sr) * av * (trill ? 0.55 + 0.45 * Math.cos(TAU * 27 * t) : 1);
    x += (r() * 2 - 1) * 0.05 * av;
    let y = R4.run(R3.run(R2.run(R1.run(x))));
    if (nasal) y *= 0.6;
    out[i] = y + nbq.run(r() * 2 - 1) * an * 6.5;
  }
  filt(out, bq(sr, 'hp', 70), bq(sr, 'lp', o.muffled ? 1300 : 5200));
  if (o.muffled) filt(out, bq(sr, 'lp', 1700));
  return fin(out, sr, 0.9, 0.05);
}

// a transmission on the VHF: the squelch opens ('chk'), a voice over the carrier's hiss, and the
// squelch tail (the burst of noise as the carrier drops). Audio.js puts it through a small speaker.
function chatter(sr, r) {
  const talk = U(r, 1.6, 4.2), head = 0.07, tail = U(r, 0.18, 0.28), n = N(sr, head + talk + tail + 0.02);
  const out = new Float32Array(n);
  let p = new Float32Array(n);
  burst(p, sr, r, 0, 0.002, 0.012, 1, [bq(sr, 'bp', 1800, 0.8)]);
  mix(out, p, 0.4);
  p = new Float32Array(n);
  p.set(babble(sr, r, talk, { pitch: U(r, 92, 138) }), Math.round(head * sr));
  mix(out, p, 0.85);
  p = new Float32Array(n);
  for (let i = Math.round(0.01 * sr); i < Math.round((head + talk) * sr); i++) p[i] = r() * 2 - 1;
  mix(out, p, 0.05);
  p = new Float32Array(n);
  const a = Math.round((head + talk) * sr), m = Math.round(tail * sr);
  for (let i = 0; i < m && a + i < n; i++) p[a + i] = (r() * 2 - 1) * Math.min(1, i / 30, (m - i) / 40);
  mix(out, p, 0.55);
  return fin(out, sr, 0.9, 0.003);
}

// a crewman talking, heard muffled (behind a scarf, across a room): 8 s, played in part or looped
function murmur(sr, r) {
  return babble(sr, r, 8, { muffled: true, pitch: U(r, 95, 125) });
}

// ------------------------------------------------------------ the mess radio's waltz

// Karplus-Strong: a burst of noise in a delay line, averaged as it circulates; an allpass sets the
// fractional delay so the notes are in tune
function pluck(out, sr, r, t, f, amp, t60, bright = 0.5) {
  const P = sr / f, L = Math.max(2, Math.floor(P - 0.6)), d = P - 0.5 - L, C = (1 - d) / (1 + d);
  const line = new Float32Array(L);
  let lp = 0;
  for (let i = 0; i < L; i++) { lp += (r() * 2 - 1 - lp) * bright; line[i] = lp; }
  const rho = Math.exp(-6.9078 / (t60 * f));
  const a = Math.round(t * sr), n = Math.min(out.length - a, N(sr, t60));
  let idx = 0, yp = 0, x1 = 0, y1 = 0;
  for (let i = 0; i < n; i++) {
    const y = line[idx];
    const avg = rho * 0.5 * (y + yp); yp = y;
    const ap = C * avg + x1 - C * y1; x1 = avg; y1 = ap;
    line[idx] = ap;
    idx = idx + 1 === L ? 0 : idx + 1;
    out[a + i] += y * amp * Math.min(1, i / 8);
  }
}

// A little waltz in A minor on plucked strings (melody with balalaika tremolo on the long notes,
// bass on the one, chords on two and three), 8 bars, looped. An original tune, kept simple.
function radioMusic(sr, r) {
  const beat = 0.6, n = N(sr, beat * 24), out = new Float32Array(n + N(sr, 1.5));
  const MEL = [[76, 2], [72, 1], [69, 3, 1], [71, 1], [72, 1], [74, 1], [76, 3, 1], [77, 2], [76, 1], [74, 1], [72, 1], [71, 1], [72, 1], [71, 1], [68, 1], [69, 3, 1]];
  const CH = [[45, [60, 64, 69]], [45, [60, 64, 69]], [43, [59, 62, 67]], [48, [60, 64, 67]], [50, [62, 65, 69]], [43, [59, 62, 67]], [40, [59, 62, 68]], [45, [60, 64, 69]]];
  for (let b = 0; b < 8; b++) {
    const t = b * 3 * beat;
    pluck(out, sr, r, t + 0.01, mtof(CH[b][0]), 0.9, 1.2, 0.4);
    for (let k = 1; k < 3; k++) for (const m of CH[b][1]) pluck(out, sr, r, t + k * beat + U(r, 0, 0.012), mtof(m), 0.3, 0.5, 0.5);
  }
  let t = 0;
  for (const [m, beats, trem] of MEL) {
    const f = mtof(m), len = beats * beat;
    if (trem) for (let s = 0, k = 0; s < len * 0.94; s += 1 / 9, k++) pluck(out, sr, r, t + s, f, k & 1 ? 0.38 : 0.48, 0.3, 0.6);
    else pluck(out, sr, r, t, f, 0.6, Math.min(1.2, len + 0.3), 0.6);
    t += len;
  }
  filt(out, bq(sr, 'hp', 350), bq(sr, 'peak', 1400, 1, 4), bq(sr, 'lp', 3200));
  const o = fold(out, n);
  norm(o, 1);
  for (let i = 0; i < n; i++) o[i] = Math.tanh(o[i] * 1.6);
  return norm(dc(o), 0.9);
}

// ------------------------------------------------------------ the catalogue

// n: how many variants to keep; rate: the sample rate to render at (lower where there are no highs
// to keep: it halves the memory and the time)
export const RECIPES = {
  step_metal: { n: 4, fn: stepMetal, rate: 32000 },
  step_grate: { n: 4, fn: stepGrate, rate: 32000 },
  step_floor: { n: 4, fn: stepFloor, rate: 32000 },
  step_ladder: { n: 4, fn: stepLadder, rate: 32000 },
  door_open: { n: 3, fn: doorOpen, rate: 32000 },
  door_close: { n: 3, fn: doorClose, rate: 32000 },
  locked: { n: 3, fn: locked, rate: 32000 },
  click: { n: 2, fn: click },
  switch: { n: 2, fn: toggleSwitch },
  button: { n: 2, fn: button },
  telegraph: { n: 2, fn: telegraph, rate: 32000 },
  clank: { n: 3, fn: clank, rate: 32000 },
  clunk: { n: 3, fn: clunk },
  slap: { n: 6, fn: slap, rate: 32000 },
  crack: { n: 5, fn: crack, rate: 32000 },
  groan: { n: 4, fn: iceGroan, rate: 16000 },
  ice_crunch: { n: 3, fn: iceCrunch, rate: 32000 },
  ice_boom: { n: 3, fn: iceBoom, rate: 16000 },
  ice_scrape: { n: 3, fn: iceScrape, rate: 32000 },
  grind_loop: { n: 1, fn: grindLoop, rate: 24000 },
  hull_groan: { n: 3, fn: hullGroan, rate: 16000 },
  hull_creak: { n: 3, fn: hullCreak, rate: 24000 },
  gull: { n: 5, fn: gull, rate: 32000 },
  walrus_grunt: { n: 3, fn: walrusGrunt, rate: 16000 },
  walrus_roar: { n: 2, fn: walrusRoar, rate: 22050 },
  penguin_call: { n: 4, fn: penguinCall, rate: 32000 },
  penguin_alarm: { n: 2, fn: penguinAlarm, rate: 32000 },
  horn: { n: 2, fn: horn, rate: 24000 },
  engine_loop: { n: 1, fn: engineLoop, rate: 24000 },
  engine_start: { n: 1, fn: engineStart, rate: 24000 },
  engine_shudder: { n: 1, fn: engineShudder, rate: 24000 },
  boil_loop: { n: 1, fn: boilLoop, rate: 24000 },
  crackle: { n: 1, fn: crackle, rate: 24000 },
  chatter: { n: 6, fn: chatter, rate: 16000 },
  murmur: { n: 3, fn: murmur, rate: 16000 },
  radio_music: { n: 1, fn: radioMusic, rate: 22050 },
};
