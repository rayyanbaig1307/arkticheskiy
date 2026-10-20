// Keyed poses for the hands and the guns' moving parts: reloads, bolt work, charging, the hand
// flare's throw. An action is a short table of keys per channel plus timed events, written in
// defs.js as plain data and compiled here once into typed arrays, so playing one allocates nothing.
//
//   { dur, keys: { channel: [[t, value, ease?], ...] }, ev: [[t, 'event'], ...], next, aimMax }
//
// Numeric channels (gun offsets, slide, bolt, magazine...) ease between keys; before a channel's
// first key it eases from wherever it was when the action began, and a channel an action leaves
// out simply holds. Hand channels (lh, rh) hold anchor names: a hand moves from one anchor to the
// next, following it if the anchor itself moves (a magazine coming out, a bolt going back). The
// prop channel steps (which prop is in the hand). Events drive sounds and the ammunition; `next`
// picks the following action from the gun's state, which is how a Mosin loads round after round.

export const CH = {
  px: 0, py: 1, pz: 2, rx: 3, ry: 4, rz: 5,       // the gun's offset from its pose (m, rad)
  slide: 6, lift: 7, pull: 8, charge: 9, brk: 10, // 0 rest .. 1 full travel
  mag: 11,                                        // 0 seated, 1 just out, 2 away in the pouch
  pa: 12, push: 13,                               // a prop: hand -> gun (0..1), pushed home (0..1)
  prop: 14,                                       // which prop the hand holds (step)
  lh: 15, rh: 16,                                 // the hands' anchors
};
export const NCH = 17;
const STEP = CH.prop;
const isHand = (c) => c === CH.lh || c === CH.rh;

export const EASE = { io: 0, lin: 1, out: 2, in: 3, snap: 4 };
export function ease(k, x) {
  switch (k) {
    case 1: return x;
    case 2: return 1 - (1 - x) * (1 - x);
    case 3: return x * x;
    case 4: { const y = 1 - x; return 1 - y * y * y; }
    default: return x * x * (3 - 2 * x);
  }
}

// names -> small integers (anchors and props are referred to by name in the tables)
export class Names {
  constructor(list) { this.list = list.slice(); this.ids = new Map(list.map((n, i) => [n, i])); }
  id(name) {
    if (!this.ids.has(name)) { this.ids.set(name, this.list.length); this.list.push(name); }
    return this.ids.get(name);
  }
}

export function compile(name, table, anchors, props) {
  const ch = new Array(NCH).fill(null);
  for (const [k, keys] of Object.entries(table.keys || {})) {
    const c = CH[k];
    if (c === undefined) throw new Error(`[weapons] action ${name}: no channel ${k}`);
    const sorted = keys.slice().sort((a, b) => a[0] - b[0]);
    const t = new Float32Array(sorted.length), v = new Float32Array(sorted.length), e = new Uint8Array(sorted.length);
    sorted.forEach(([tt, vv, ee], i) => {
      t[i] = tt;
      v[i] = isHand(c) ? anchors.id(vv) : c === STEP ? props.id(vv) : vv;
      e[i] = EASE[ee || 'io'] ?? 0;
    });
    ch[c] = { t, v, e };
  }
  const ev = (table.ev || []).slice().sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ t, name: n }));
  return { name, dur: table.dur, ch, ev, next: table.next || null, aimMax: table.aimMax ?? 0, lock: !!table.lock };
}

// The pose of every channel at time t. `from` holds each channel's value when the action began
// (hand channels: the anchor id). Numeric results go to out.v; hands to out.a (from), out.b (to)
// and out.w (how far between them). Channels the action leaves out keep `from`.
export class Pose {
  constructor() {
    this.v = new Float32Array(NCH);
    this.a = new Int16Array(NCH); this.b = new Int16Array(NCH); this.w = new Float32Array(NCH);
  }
}

export function sample(act, t, from, fromHand, out) {
  for (let c = 0; c < NCH; c++) {
    const k = act ? act.ch[c] : null;
    const hand = isHand(c);
    if (!k) {
      if (hand) { out.a[c] = out.b[c] = fromHand[c]; out.w[c] = 1; } else out.v[c] = from[c];
      continue;
    }
    const n = k.t.length;
    let i = 0;
    while (i < n && k.t[i] <= t) i++;
    // i: the first key after t
    if (c === STEP) { out.v[c] = i === 0 ? from[c] : k.v[i - 1]; continue; }
    let a, b, w;
    if (i === 0) {
      a = hand ? fromHand[c] : from[c]; b = k.v[0];
      w = k.t[0] > 0 ? ease(k.e[0], t / k.t[0]) : 1;
    } else if (i === n) {
      a = b = k.v[n - 1]; w = 1;
    } else {
      a = k.v[i - 1]; b = k.v[i];
      w = ease(k.e[i], (t - k.t[i - 1]) / Math.max(1e-5, k.t[i] - k.t[i - 1]));
    }
    if (hand) { out.a[c] = a; out.b[c] = b; out.w[c] = w; } else out.v[c] = a + (b - a) * w;
  }
  return out;
}
