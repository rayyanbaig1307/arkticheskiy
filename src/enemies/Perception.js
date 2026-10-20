import * as THREE from 'three';
import { clamp, damp, angleDiff } from '../core/util.js';

// What a creature knows about you, and what every creature shares to act on it. Enemies.js runs
// them; Bear.js, Turned.js and Shade.js are the creatures themselves.
//
//   Perception    the senses, once a think: sight (a cone and a range, then a ray through the
//                 collision from its eyes to yours), hearing (the noises Enemies.noise tells it),
//                 smell (a bear downwind of you), warmth (the Turned feel you through a wall up
//                 close), and your flashlight on it. They build `awareness` (0..1), which ebbs away
//                 again once nothing tells it you're there; `lastKnown` is where it thinks you are.
//   CreatureNav   Nav.js's grid with the body's size as a parameter (a bear is wider than a man):
//                 routes over the boat's collision, and the station's while she's moored
//   Creature      a body on the ground: clips with crossfades, smooth turning, walking along its
//                 facing with the collision pushing it out of walls and the floor under its feet,
//                 routes, a head that turns toward what it hears (past where a head should go),
//                 and the hit volumes the weapons' rays test (capsules on bones, not triangles)
//
// Boat space throughout (forward -Z, starboard +X, up +Y), except the hit volumes: those are in
// the world, as the weapons' rays are.

// how far each noise carries (m)
export const NOISE = { pm: 55, mosin: 80, akm: 70, flaregun: 40, run: 14, walk: 6, crouch: 2, door: 15, glass: 20, shout: 25 };
// and how much a noise at its loudest tells the one who hears it
const HEARD = { pm: 0.9, mosin: 0.95, akm: 0.9, flaregun: 0.7, run: 0.45, walk: 0.3, crouch: 0.2, door: 0.5, glass: 0.6, shout: 0.75 };
export const SHOTS = new Set(['pm', 'mosin', 'akm', 'flaregun']);

const _e = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Vector3(), _dir = new THREE.Vector3();

// nothing solid between two boat-space points (closed doors count)
export function clearLine(col, a, b) {
  _dir.subVectors(b, a);
  const L = _dir.length();
  if (L < 0.05) return true;
  _dir.multiplyScalar(1 / L);
  return col.raycast(a, _dir, L) >= L - 0.2;
}

export class Perception {
  constructor({ fov = 100, open = 35, inside = 18, smell = false, warmth = false, hearing = 1 } = {}) {
    this.fov = (fov * Math.PI) / 180; this.open = open; this.inside = inside;
    this.smell = smell; this.warmth = warmth; this.hearing = hearing;
    this.lastKnown = new THREE.Vector3();
    this.scentPos = new THREE.Vector3();
    this.heard = { pos: new THREE.Vector3(), loud: 0, kind: null, t: 99 };
    this.reset();
  }

  reset() {
    this.awareness = 0;
    this.sees = false; this.seenT = 0; this.unseenT = 99;
    this.knownT = 99;              // seconds since something said where you are
    this.quietT = 99;              // seconds since anything at all
    this.lit = false; this.litT = 0;
    this.scent = 0; this.scentT = 0; this.heat = 0;
    this.heard.t = 99; this.heard.kind = null;
    this.los = false; this.losT = Math.random() * 0.2;
    this.range = 0; this.dist = Infinity; this.angle = Math.PI;
  }

  // s: the frame's picture of you (Enemies.update builds it once for everyone)
  update(dt, c, s) {
    const eye = c.eye(_e);
    const d = eye.distanceTo(s.eye);
    this.dist = d;
    let stim = false;
    // your flashlight on it (the beam's cone, then the same ray as its sight)
    let lit = false;
    if (s.flashOn && !s.dead) {
      c.center(_c);
      _v.subVectors(_c, s.flashOrigin);
      const fd = _v.length();
      if (fd < s.flashRange && fd > 0.05 && _v.dot(s.flashDir) / fd > (fd < 3 ? 0.88 : 0.95)) lit = true;
    }
    // how far it sees: less in the dark with your light off, much more when your light is on it
    let range = (s.indoor || c.indoor ? this.inside : this.open) * s.visibility;
    if (!s.flashOn) range *= 1 - 0.5 * s.dark;
    else if (lit) range *= 2;
    if (s.crouching) range *= 0.6;
    this.range = range;
    const ang = Math.abs(angleDiff(c.yaw + c.headYaw, Math.atan2(-(s.eye.x - eye.x), -(s.eye.z - eye.z))));
    this.angle = ang;
    const inCone = ang < this.fov / 2 || d < 1.4;
    const look = !s.hidden && !s.dead && ((inCone && d < range) || lit);
    if (look) {
      if ((this.losT -= dt) <= 0) { this.losT = 0.14 + Math.random() * 0.1; this.los = clearLine(s.collision, eye, s.eye); }
    } else { this.los = false; this.losT = 0; }
    this.sees = look && inCone && d < range && this.los;
    this.lit = lit && this.los;
    if (this.sees) {
      const near = 1 - d / range;
      const side = ang < this.fov * 0.25 ? 1 : 0.5;            // (out of the corner of its eye: slower)
      const move = s.running ? 1.6 : s.moving ? 1 : 0.55;
      this.awareness += (0.22 + 1.9 * near * near) * side * move * (d < 4 ? 3 : 1) * dt;
      this.lastKnown.copy(s.feet); this.knownT = 0; stim = true;
      this.seenT += dt; this.unseenT = 0;
    } else { this.seenT = 0; this.unseenT += dt; }
    if (this.lit) { this.litT += dt; this.awareness += 0.35 * dt; this.lastKnown.copy(s.feet); this.knownT = 0; stim = true; }
    else this.litT = Math.max(0, this.litT - dt * 2);
    // smell: a bear downwind of you (or close)
    this.scent = 0;
    if (this.smell && !s.dead) {
      const dx = c.pos.x - s.feet.x, dz = c.pos.z - s.feet.z, dh = Math.hypot(dx, dz);
      let k = 0;
      if (dh < 60) {
        if (s.wind) {
          const w = Math.hypot(s.wind.x, s.wind.z) || 1;
          const dw = (dx * s.wind.x + dz * s.wind.z) / (dh * w + 1e-6);
          if (dw > 0.55) k = (1 - dh / 60) * Math.min(1, (dw - 0.55) / 0.35);
        } else if (dh < 25) k = (1 - dh / 25) * 0.7;
        if (dh < 7) k = Math.max(k, 1 - dh / 7);
      }
      if (s.hidden) k *= 0.5;
      this.scent = k;
      if (k > 0.02) {
        this.awareness += k * 0.16 * dt; stim = true;
        // a scent says roughly where you are: the further, the vaguer
        if ((this.scentT -= dt) <= 0) {
          this.scentT = 2 + Math.random() * 2;
          const err = dh * 0.15;
          this.scentPos.set(s.feet.x + (Math.random() - 0.5) * err, s.feet.y, s.feet.z + (Math.random() - 0.5) * err);
        }
        if (this.knownT > 3) { this.lastKnown.copy(this.scentPos); this.knownT = 2; }
      }
    }
    // warmth: the Turned feel a living body through a wall, more the warmer you are
    this.heat = 0;
    if (this.warmth && !s.dead) {
      const dd = c.pos.distanceTo(s.feet);
      if (dd < 5) {
        const w = (1 - dd / 5) * (0.35 + 0.65 * clamp(s.warmth / 100, 0, 1)) * (s.hidden ? 0.35 : 1);
        this.heat = w; this.awareness += w * 0.55 * dt; stim = true;
        if (w > 0.15) { this.lastKnown.copy(s.feet); this.knownT = 0; }
      }
    }
    // and it ebbs away when nothing comes
    if (stim) this.quietT = 0; else this.quietT += dt;
    this.knownT += dt; this.heard.t += dt;
    if (this.quietT > 4) this.awareness -= (this.quietT > 20 ? 0.06 : 0.035) * dt;
    this.awareness = clamp(this.awareness, 0, 1);
  }

  // a noise reached it (loud: 0..1 by the distance, less through walls)
  hear(pos, loud, kind) {
    const h = this.heard;
    h.pos.copy(pos); h.loud = loud; h.kind = kind; h.t = 0;
    this.awareness = clamp(this.awareness + loud * (HEARD[kind] ?? 0.5) * this.hearing, 0, 1);
    this.quietT = 0;
    // (the louder, the surer of where it came from)
    if (loud > 0.3 || this.knownT > 2) { this.lastKnown.copy(pos); this.knownT = Math.min(this.knownT, (1 - loud) * 2); }
  }

  // told by another (a scream): it knows
  alarm(pos, level = 0.85) {
    this.awareness = Math.max(this.awareness, level);
    this.lastKnown.copy(pos); this.knownT = Math.min(this.knownT, 0.5); this.quietT = 0;
  }
}

// ---------------------------------------------------------------- the creatures' own Nav
// Nav.js with the size as a parameter. Cells are found as a search reaches them and remembered;
// a cell is open when the body's capsule stands there without touching anything. route() is A*
// (a little greedy: the heuristic weighted, so open ground costs few cells) pulled tight, or null
// when there is none inside the budget; straight() says whether a direct walk stays on open cells.

const _seg = new THREE.Line3(new THREE.Vector3(), new THREE.Vector3());
const _o = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0), _sp = new THREE.Vector3();
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

export class CreatureNav {
  constructor(collision, { cell = 0.3, radius = 0.24, height = 1.6, step = 0.32, nodes = 5000, greed = 1.5 } = {}) {
    this.col = collision;
    Object.assign(this, { cell, radius, height, step, nodes, greed });
    this.cells = new Map();
    this.routes = new Map();
    this.tests = 0;
  }

  reset() { this.cells.clear(); this.routes.clear(); }

  key(ix, iz, y) { return ix + ',' + iz + ',' + Math.round(y * 2); }

  probe(ix, iz, yRef) {
    const C = this.cell, x = ix * C, z = iz * C;
    _o.set(x, yRef + 0.75, z);
    const d = this.col.raycast(_o, _down, 1.5);
    if (d === Infinity) return null;
    const y = yRef + 0.75 - d;
    if (Math.abs(y - yRef) > 0.7) return null;
    const k = this.key(ix, iz, y);
    let c = this.cells.get(k);
    if (c) return c;
    const r = this.radius;
    _seg.start.set(x, y + r + 0.25, z); _seg.end.set(x, y + Math.max(r + 0.3, this.height - r), z);
    this.tests++;
    c = { ix, iz, x, z, y, k, ok: !this.col.touches(_seg, r) };
    this.cells.set(k, c);
    return c;
  }

  cellAt(p) {
    const ix = Math.round(p.x / this.cell), iz = Math.round(p.z / this.cell);
    let c = this.probe(ix, iz, p.y);
    if (c && c.ok) return c;
    for (let r = 1; r <= 3; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      c = this.probe(ix + dx, iz + dz, p.y);
      if (c && c.ok) return c;
    }
    return null;
  }

  open(p) { return !!this.cellAt(p); }

  // a route from one boat-space point to another (corners, the last one the goal), or null.
  // keep: remember it (a patrol's legs; a chase's routes are new every time)
  route(from, to, { nodes = this.nodes, keep = false } = {}) {
    let rk = null;
    if (keep) {
      rk = `${from.x.toFixed(1)},${from.y.toFixed(1)},${from.z.toFixed(1)}>${to.x.toFixed(1)},${to.y.toFixed(1)},${to.z.toFixed(1)}`;
      if (this.routes.has(rk)) return this.routes.get(rk);
    }
    const a = this.cellAt(from), b = this.cellAt(to);
    let out = null;
    if (a && b) {
      const path = this.astar(a, b, nodes);
      if (path) out = this.pull(path, to);
    }
    if (keep) this.routes.set(rk, out);
    return out;
  }

  straight(from, to) {
    const a = this.cellAt(from), b = this.cellAt(to);
    return !!(a && b && this.clear(a, b));
  }

  astar(a, b, maxNodes) {
    const open = new Heap();
    const g = new Map(), came = new Map();
    g.set(a.k, 0); open.push(a, this.h(a, b));
    const C = this.cell;
    let n = 0;
    while (open.size) {
      const c = open.pop();
      if (c === b || (c.ix === b.ix && c.iz === b.iz && Math.abs(c.y - b.y) < 0.4)) return this.unwind(came, c);
      if (++n > maxNodes) break;
      const gc = g.get(c.k);
      for (const [dx, dz, w] of N8) {
        const nb = this.probe(c.ix + dx, c.iz + dz, c.y);
        if (!nb || !nb.ok || Math.abs(nb.y - c.y) > this.step) continue;
        if (dx && dz) {
          const s1 = this.probe(c.ix + dx, c.iz, c.y), s2 = this.probe(c.ix, c.iz + dz, c.y);
          if (!s1?.ok || !s2?.ok) continue;
        }
        const gn = gc + w * C + Math.abs(nb.y - c.y) * 2;
        if (gn < (g.get(nb.k) ?? Infinity)) {
          g.set(nb.k, gn); came.set(nb.k, c);
          open.push(nb, gn + this.h(nb, b) * this.greed);
        }
      }
    }
    return null;
  }

  h(a, b) { return Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y) * 2; }

  unwind(came, c) {
    const out = [c];
    while (came.has(c.k)) { c = came.get(c.k); out.push(c); }
    return out.reverse();
  }

  clear(a, b) {
    const C = this.cell;
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(L / (C * 0.5)));
    let y = a.y;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const c = this.probe(Math.round((a.x + dx * t) / C), Math.round((a.z + dz * t) / C), y);
      if (!c || !c.ok || Math.abs(c.y - y) > this.step) return false;
      y = c.y;
    }
    return Math.abs(b.y - y) <= this.step + 0.05;
  }

  pull(path, to) {
    const pts = [];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1 && !this.clear(path[i], path[j])) j--;
      pts.push(path[j]);
      i = j;
    }
    const out = pts.map((c) => new THREE.Vector3(c.x, c.y, c.z));
    if (out.length) out[out.length - 1].set(to.x, out[out.length - 1].y, to.z);
    else out.push(to.clone());
    return out;
  }

  // an open spot r (rMin..rMax) from p, in a direction round yaw (± spread; null: any), or null.
  // test(v) can turn a spot down (in the light, too high, in view...)
  spot(p, rMin, rMax, { yaw = null, spread = Math.PI, tries = 14, test = null } = {}) {
    for (let i = 0; i < tries; i++) {
      const a = yaw === null ? Math.random() * Math.PI * 2 : yaw + (Math.random() * 2 - 1) * spread;
      const r = rMin + Math.random() * (rMax - rMin);
      const x = p.x - Math.sin(a) * r, z = p.z - Math.cos(a) * r;
      const f = this.col.floorAt(x, p.y + 2, z, 5);
      if (f === null || Math.abs(f - p.y) > 2.5) continue;
      const c = this.cellAt(_sp.set(x, f, z));
      if (!c) continue;
      const v = new THREE.Vector3(c.x, c.y, c.z);
      if (test && !test(v)) continue;
      return v;
    }
    return null;
  }
}

class Heap {
  constructor() { this.a = []; this.p = []; }
  get size() { return this.a.length; }
  push(v, pr) {
    const a = this.a, p = this.p;
    a.push(v); p.push(pr);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pr) break;
      a[i] = a[j]; p[i] = p[j]; i = j;
    }
    a[i] = v; p[i] = pr;
  }
  pop() {
    const a = this.a, p = this.p;
    const top = a[0], lv = a.pop(), lp = p.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        a[i] = a[c]; p[i] = p[c]; i = c;
      }
      a[i] = lv; p[i] = lp;
    }
    return top;
  }
}

// ---------------------------------------------------------------- shared helpers

// the MPFB clips onto another body of the same rig: rotations as they are, the pelvis's movement
// scaled to this body's hip height (People.js's retarget)
export function retarget(clip, refPelvis, pelvis) {
  const k = pelvis.position.z / refPelvis.z;
  const tracks = [];
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.');
    if (prop === 'quaternion') tracks.push(t);
    else if (prop === 'position' && bone === 'pelvis') {
      const v = t.values.slice();
      for (let i = 0; i < v.length; i += 3) {
        v[i] = pelvis.position.x + (v[i] - refPelvis.x) * k;
        v[i + 1] = pelvis.position.y + (v[i + 1] - refPelvis.y) * k;
        v[i + 2] = pelvis.position.z + (v[i + 2] - refPelvis.z) * k;
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times, v));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// where a ray (unit dir) first enters a capsule (p0..p1, radius r): the distance, or -1
export function rayCapsule(ro, rd, p0, p1, r) {
  const bax = p1.x - p0.x, bay = p1.y - p0.y, baz = p1.z - p0.z;
  const oax = ro.x - p0.x, oay = ro.y - p0.y, oaz = ro.z - p0.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  if (a > 1e-9) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
  }
  // the end caps
  let best = -1;
  for (const e of [p0, p1]) {
    const ox = ro.x - e.x, oy = ro.y - e.y, oz = ro.z - e.z;
    const b = rd.x * ox + rd.y * oy + rd.z * oz, c = ox * ox + oy * oy + oz * oz - r * r;
    const h = b * b - c;
    if (h < 0) continue;
    const t = -b - Math.sqrt(h);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

export function segDist(p, a, b) {
  _v.subVectors(b, a);
  const L2 = _v.lengthSq();
  const t = L2 > 1e-9 ? clamp(_c.subVectors(p, a).dot(_v) / L2, 0, 1) : 0;
  return _c.copy(a).addScaledVector(_v, t).distanceTo(p);
}

// a bone by its Blender name (GLTFLoader drops the dots: 'hand.R' comes in as 'handR')
export function boneMap(model) {
  const m = {};
  model.traverse((o) => { if (o.isBone) m[o.name] = o; });
  return new Proxy(m, { get: (t, k) => t[k] ?? (typeof k === 'string' ? t[THREE.PropertyBinding.sanitizeNodeName(k)] : undefined) });
}

// ---------------------------------------------------------------- the body every creature shares

let SERIAL = 0;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _s = new THREE.Vector3(), _ax = new THREE.Vector3(), _up = new THREE.Vector3();
export const SEG = new THREE.Line3(new THREE.Vector3(), new THREE.Vector3());

export class Creature {
  constructor(mgr, kind, opts = {}) {
    this.mgr = mgr; this.kind = kind; this.opts = opts;
    this.name = opts.name || `${kind}${++SERIAL}`;
    this.root = new THREE.Group(); this.root.name = `enemy:${this.name}`;
    this.pos = this.root.position;
    this.yaw = opts.yaw ?? 0; this.yawVel = 0;
    this.root.rotation.y = this.yaw;
    this.headYaw = 0; this.headWant = 0; this.headRate = 5;
    this.speed = 0; this.hover = 0;
    this.state = null; this.stateT = 0; this.t = Math.random() * 100;
    this.health = this.maxHealth = 100; this.dead = false;
    this.actions = {}; this.clip = null; this.clipT = 0; this.clipLen = 1; this.clipTs = 1; this.stepN = 0; this.heldTs = null;
    this.bones = {}; this.volumes = []; this.volFrame = -1;
    this.meshes = [];              // what casts a shadow (when near)
    this.mixer = null;
    this.mixDt = 0; this.lodT = 0; this.vis = true; this.shown = true; this.shadow = null; this.posed = false;
    this.dp = Infinity; this.dy = 0; this.faced = -1; this.toYaw = 0;
    this.route = null; this.ri = 0; this.routeGoal = new THREE.Vector3(1e9, 0, 0); this.routeAge = 0; this.stuckT = 0; this.stuck = 0;
    this.floorY = null; this.floorT = 0;
    this.chasing = false; this.shootable = true; this.seen = false;
    this.indoor = !!opts.indoor;   // (somewhere it sees as far as indoors: Object 7)
    this.cap = { r: 0.3, a: 0.6, b: 1.5 };             // the capsule pushed out of walls (heights above the feet)
    this.midH = 0.9; this.eyeH = 1.6; this.eyeFwd = 0.1; this.bound = 1.2; this.size = 1;
    this.corner = 0.4; this.reroute = 2; this.routeEvery = 0.5;
    this.avoidHeat = false; this.heatBlocked = false;
    this.neckName = 'neck_01'; this.headName = 'head';
    this.nav = null;
  }

  // stand at a boat-space point, on the floor there
  place(p) {
    this.pos.copy(p);
    const f = this.mgr.col.floorAt(p.x, p.y + 1, p.z, 3);
    if (f !== null) { this.pos.y = f + this.hover; this.floorY = f; }
    this.root.rotation.y = this.yaw;
    this.root.updateMatrixWorld(true);
    this.posed = true;
    return this;
  }

  // ---- clips
  play(name, fade = 0.3, ts = 1, restart = false) {
    const a = this.actions[name];
    if (!a) return false;
    a.timeScale = ts; this.clipTs = ts; this.heldTs = null;
    if (this.clip === name && !restart) return true;
    const prev = this.actions[this.clip];
    a.reset().setEffectiveWeight(1).play();
    if (prev && prev !== a) prev.crossFadeTo(a, fade, false);
    this.clip = name; this.clipT = 0; this.clipLen = a.getClip().duration; this.stepN = 0;
    return true;
  }

  // a one-shot played backwards from its end (the dead getting up)
  playBack(name, fade = 0.2, ts = -1) {
    const a = this.actions[name];
    if (!a) return false;
    const prev = this.actions[this.clip];
    a.reset(); a.timeScale = ts; a.time = a.getClip().duration; a.setEffectiveWeight(1).play();
    this.heldTs = null;
    if (prev && prev !== a) prev.crossFadeTo(a, fade, false);
    this.clip = name; this.clipT = 0; this.clipLen = a.getClip().duration; this.clipTs = ts;
    return true;
  }

  // the clip held where it is (a freeze), or let go again
  hold(on) {
    const a = this.actions[this.clip];
    if (!a) return;
    if (on) { if (this.heldTs === null) { this.heldTs = a.timeScale; a.timeScale = 0; this.clipTs = 0; } }
    else if (this.heldTs !== null) { a.timeScale = this.heldTs; this.clipTs = this.heldTs; this.heldTs = null; }
  }

  setRate(ts) { const a = this.actions[this.clip]; if (a) a.timeScale = ts; this.clipTs = ts; this.heldTs = null; }
  get clipDone() { return this.clipT >= this.clipLen - 0.02; }

  // ---- turning and walking
  yawTo(x, z) { return Math.atan2(-(x - this.pos.x), -(z - this.pos.z)); }

  // turn toward a yaw, never faster than max (rad/s), easing in and out; returns what was left
  face(want, dt, max = 3) {
    const diff = angleDiff(this.yaw, want);
    this.yawVel = damp(this.yawVel, clamp(diff * 5, -max, max), 10, dt);
    let step = this.yawVel * dt;
    if (Math.sign(step) === Math.sign(diff) && Math.abs(step) > Math.abs(diff)) { step = diff; this.yawVel *= 0.5; }
    this.yaw += step;
    this.root.rotation.y = this.yaw;
    return diff;
  }

  // forward along its facing at `speed` (m/s): out of walls, on the floor, not off an edge, not into
  // heat it won't go near; returns the distance made
  walk(dt, speed) {
    const pos = this.pos, col = this.mgr.col;
    if (!(speed > 0.005)) { this.ground(dt, false); return 0; }
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (this.avoidHeat && this.mgr.hot(_p.set(pos.x + fx * 0.6, pos.y + 0.5, pos.z + fz * 0.6), pos)) {
      this.heatBlocked = true; this.ground(dt, false); return 0;
    }
    this.heatBlocked = false;
    const dist = speed * dt, n = Math.max(1, Math.ceil(dist / 0.15)), h = dist / n;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const ox = pos.x, oz = pos.z;
      pos.x += fx * h; pos.z += fz * h;
      this.push();
      const f = col.floorAt(pos.x, pos.y + 0.35, pos.z, 1.5);
      if (f === null || f - pos.y + this.hover > 0.42) { pos.x = ox; pos.z = oz; break; }
      this.floorY = f;
      moved += Math.hypot(pos.x - ox, pos.z - oz);
    }
    // (up against something: the legs slow with it)
    if (moved < dist * 0.4) this.speed *= 0.9;
    this.ground(dt, true);
    return moved;
  }

  // the feet on the floor (looked for again now and then when standing still)
  ground(dt, fresh) {
    const pos = this.pos;
    if (!fresh && (this.floorT -= dt) <= 0) {
      this.floorT = 0.5;
      const f = this.mgr.col.floorAt(pos.x, pos.y - this.hover + 0.35, pos.z, 1.5);
      if (f !== null) this.floorY = f;
    }
    if (this.floorY === null) return;
    pos.y += (this.floorY + this.hover - pos.y) * Math.min(1, dt * 12);
  }

  // out of the walls: a capsule standing at the feet (Bear.js lays its own along its body)
  push() {
    const c = this.cap, pos = this.pos, y = pos.y - this.hover;
    SEG.start.set(pos.x, y + c.a, pos.z); SEG.end.set(pos.x, y + c.b, pos.z);
    return this.resolve(SEG, c.r);
  }

  resolve(seg, r) {
    const bx = seg.start.x, bz = seg.start.z;
    this.mgr.col.resolve(seg, r);
    let dx = seg.start.x - bx, dz = seg.start.z - bz;
    const m = Math.hypot(dx, dz);
    if (m > 0.25) { dx *= 0.25 / m; dz *= 0.25 / m; }
    this.pos.x += dx; this.pos.z += dz;
    return m;
  }

  // toward a boat-space point by its Nav (routes are asked of Enemies, one a frame); returns the
  // distance left. The goal may move: a new route when it has, or every routeEvery seconds
  steer(dt, target, speed, turn = 3, arrive = 0.5) {
    const pos = this.pos;
    const d = Math.hypot(target.x - pos.x, target.z - pos.z);
    if (d < arrive) { this.speed = damp(this.speed, 0, 6, dt); this.walk(dt, this.speed); return d; }
    this.routeAge += dt;
    if (this.nav && (!this.route || this.routeGoal.distanceToSquared(target) > this.reroute * this.reroute || this.routeAge > this.routeEvery)) {
      const r = this.mgr.routeFor(this, pos, target);
      if (r !== undefined) { this.route = r || [target.clone()]; this.ri = 0; this.routeGoal.copy(target); this.routeAge = 0; }
    }
    const route = this.route;
    if (route) while (this.ri < route.length - 1 && Math.hypot(route[this.ri].x - pos.x, route[this.ri].z - pos.z) < this.corner) this.ri++;
    const t = !route || this.ri >= route.length - 1 ? target : route[this.ri];
    const diff = this.face(this.yawTo(t.x, t.z), dt, turn);
    const k = clamp(1.25 - Math.abs(diff) / 1.4, 0.12, 1);      // (slows to turn)
    this.speed = damp(this.speed, speed * k, 4, dt);
    const moved = this.walk(dt, this.speed);
    if (this.speed > 0.2 && moved < this.speed * dt * 0.25) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 1.2) { this.route = null; this.stuckT = 0; this.stuck++; }
    return d;
  }

  // ---- where it is
  eye(out) {
    const h = this.bones[this.headName];
    if (h && this.posed) return out.setFromMatrixPosition(h.matrixWorld).applyMatrix4(this.mgr.inv);
    return out.set(this.pos.x - Math.sin(this.yaw) * this.eyeFwd, this.pos.y + this.eyeH, this.pos.z - Math.cos(this.yaw) * this.eyeFwd);
  }
  center(out) { return out.set(this.pos.x, this.pos.y + this.midH, this.pos.z); }

  // can you see it from where you are? (a ray from your eyes to it, a few times a second)
  visibleTo(s, dt) {
    if ((this.viewT = (this.viewT ?? 0) - dt) <= 0) {
      this.viewT = 0.2 + Math.random() * 0.1;
      this.inSight = clearLine(this.mgr.col, s.eye, this.center(_w));
    }
    return this.inSight;
  }
  worldCenter(out) { return out.set(this.pos.x, this.pos.y + this.midH, this.pos.z).applyMatrix4(this.mgr.boat.root.matrixWorld); }

  // a voice or a step from where it is (audio wants world positions)
  sound(name) {
    const h = this.mgr.audio?.horror;
    if (typeof h?.creature !== 'function') return;
    h.creature(name, this.mgr.boat.toWorld(_w.set(this.pos.x, this.pos.y + this.midH * 1.3, this.pos.z), new THREE.Vector3()));
  }

  // footfalls from the gait clip (perCycle of them a cycle), when you're near enough to hear
  steps(name, perCycle = 2, near = 25) {
    const n = Math.floor((this.clipT / this.clipLen) * perCycle);
    if (n !== this.stepN) { this.stepN = n; if (this.dp < near && this.speed > 0.15) this.sound(name); }
  }

  // ---- the head: turned about the up axis on top of the clip (after the mixer), shared between
  // the neck and the head, so it can go round further than a living neck would
  turnHead(angle) {
    if (Math.abs(angle) < 0.004) return;
    _up.set(0, 1, 0).transformDirection(this.root.matrixWorld);
    for (const [name, k] of [[this.neckName, 0.4], [this.headName, 0.6]]) {
      const b = this.bones[name];
      if (!b?.parent) continue;
      b.parent.updateWorldMatrix(true, false);
      b.parent.matrixWorld.decompose(_p, _q, _s);
      _ax.copy(_up).applyQuaternion(_q.invert()).normalize();
      b.quaternion.premultiply(_qa.setFromAxisAngle(_ax, angle * k));
    }
  }

  // ---- hit volumes (world space, worked out when a ray asks, once a frame)
  vol(part, a, b, r, ext = 0) {
    const A = this.bones[a], B = this.bones[b];
    if (!A || !B) return;
    this.volumes.push({ part, A, B, r, ext, p0: new THREE.Vector3(), p1: new THREE.Vector3() });
  }

  updateVolumes(frame) {
    if (this.volFrame === frame) return;
    this.volFrame = frame;
    this.root.updateMatrixWorld(true);
    for (const v of this.volumes) {
      _a.setFromMatrixPosition(v.A.matrixWorld); _b.setFromMatrixPosition(v.B.matrixWorld);
      if (v.ext) { v.p0.copy(_b); v.p1.copy(_b).addScaledVector(_d.subVectors(_b, _a).normalize(), v.ext); }
      else { v.p0.copy(_a); v.p1.copy(_b); }
    }
  }

  rayHit(ray, far) {
    let best = null;
    for (const v of this.volumes) {
      const t = rayCapsule(ray.origin, ray.direction, v.p0, v.p1, v.r);
      if (t >= 0 && t <= far && (!best || t < best.t)) best = { t, part: v.part };
    }
    return best;
  }

  // which part a world point is on (the nearest volume)
  partAt(point) {
    if (!point || !this.volumes.length) return 'body';
    this.updateVolumes(this.mgr.frame);
    let best = 'body', bd = Infinity;
    for (const v of this.volumes) {
      const d = segDist(point, v.p0, v.p1) - v.r;
      if (d < bd) { bd = d; best = v.part; }
    }
    return best;
  }

  // ---- drawing
  setVisible(on) { if (on !== this.vis) { this.vis = on; this.root.visible = on; } }
  setShadows(on) {
    if (on === this.shadow) return;
    this.shadow = on;
    for (const m of this.meshes) m.castShadow = on;
  }

  // the state machine's bookkeeping
  enter(state) { this.prev = this.state; this.state = state; this.stateT = 0; }

  // every think: the clock, the senses, the state; then the head eases toward where it wants
  update(dt, s) {
    this.t += dt; this.stateT += dt; this.clipT += dt * Math.abs(this.clipTs);
    if (!this.dead) this.sense?.update(dt, this, s);
    this.think(dt, s);
    this.headYaw = damp(this.headYaw, this.headWant, this.headRate, dt);
  }
  think() {}
  pose() {}
  hear() {}
  damage() {}

  dispose() {
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.root.parent?.remove(this.root);
  }
}
