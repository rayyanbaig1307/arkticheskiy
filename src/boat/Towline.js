import * as THREE from 'three';
import { clamp, damp } from '../core/util.js';

// The towline: 220 m of 12-strand polyester on the winch drum, led through the level-wind, over
// the H-bitt and the stern roller and away astern into the sea (the ROPE_ points of the model,
// tools/blender/tug_outfit.py).
//
// On the drum it lies in layers of turns, so the drum grows fatter as it fills; on deck it runs
// taut from point to point; past the roller it is a chain of nodes simulated in world space
// (Verlet): its weight in the air, very little in the water, the water's drag and the swell's
// surface, so it sags off the roller, dips under and streams away behind her the way a real line
// does, the heavy eye at its end hanging deepest. The winch reels it in or pays it out (the control
// stand, interactions/Stations.js): the drum and the roller turn with it, the level-wind carriage
// walks across the drum turn by turn, and the braid slides along the line.

const LINE = 220;                 // metres of line
const DIA = 0.1;                  // its diameter
const SEG = 1.0;                  // the free span's node spacing
export const MIN_OUT = 3.5;       // fully in: the eye hangs just past the roller
export const MAX_OUT = 130;
const SPEED_IN = 0.85, SPEED_OUT = 1.1;    // m/s at the drum
const RADIAL = 10;
const MAXP = Math.ceil(MAX_OUT / SEG) + 16;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _n = new THREE.Vector3(), _t = new THREE.Vector3(), _bn = new THREE.Vector3(), _prevN = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

// the turns of one layer on the drum: a ridged sleeve (a crest per turn), its rows running from
// one flange to the other (from the other one on the next layer: the lays alternate)
const COIL_RADIAL = 48;
function coilGeometry(r, width, turns, back) {
  const per = 6, rows = turns * per + 1;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1);
    const x = (back ? 1 - t : t) * width - width / 2;
    const ph = t * turns;
    const u = (ph - Math.floor(ph)) * 2 - 1;
    const rr = r + (DIA / 2) * (Math.sqrt(Math.max(0, 1 - u * u)) - 1) * 0.9;
    for (let k = 0; k <= COIL_RADIAL; k++) {
      const a = (k / COIL_RADIAL) * Math.PI * 2;
      pos.push(x, Math.cos(a) * rr, Math.sin(a) * rr);
      uv.push((k / COIL_RADIAL) * (2 * Math.PI * r) / 0.24, ph * 1.3);
    }
  }
  for (let j = 0; j < rows - 1; j++) for (let k = 0; k < COIL_RADIAL; k++) {
    const a = j * (COIL_RADIAL + 1) + k, b = a + COIL_RADIAL + 1;
    if (back) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.rows = rows;
  return g;
}

export class Towline {
  constructor({ scene, boat, model, waves }) {
    this.boat = boat; this.waves = waves; this.model = model;
    const n = model.nodes;
    this.drum = n.WINCH_drum || null; this.spool = n.WINCH_spool || null; this.roller = n.ROLLER_stern || null;
    const pt = (name) => (n[name] ? boat.root.worldToLocal(n[name].getWorldPosition(new THREE.Vector3())) : null);   // (in boat space)
    this.pDrum = pt('ROPE_drum'); this.pLead = pt('ROPE_lead'); this.pBitt = pt('ROPE_bitt'); this.pRoller = pt('ROPE_roller');
    this.ok = !!(this.pDrum && this.pLead && this.pBitt && this.pRoller);
    if (!this.ok) return;
    const ud = n.ROPE_drum.userData || {};
    this.r0 = ud.r0 ?? 0.5; this.width = ud.width ?? 2.48;
    this.turns = Math.max(4, Math.floor(this.width / DIA));
    this.spoolBase = this.spool ? this.spool.position.clone() : null;
    this.out = 48;                  // metres of line past the roller
    this.mode = 'stop'; this.last = 'out';
    this.speed = 0;                 // m/s, + paying out
    this.slide = 0;                 // the braid's offset along the line
    this.drumA = 0; this.rollerA = 0;
    this.deckLen = this.pDrum.distanceTo(this.pLead) + this.pLead.distanceTo(this.pBitt) + this.pBitt.distanceTo(this.pRoller);
    this.material = this.findMaterial(model);
    // the free span (world space)
    this.nodes = [];
    this.resetSpan();
    // the line's tube, rebuilt each frame
    this.geo = new THREE.BufferGeometry();
    const verts = MAXP * (RADIAL + 1);
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < MAXP - 1; i++) for (let k = 0; k < RADIAL; k++) {
      const a = i * (RADIAL + 1) + k, b = a + RADIAL + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.name = 'Towline';
    scene.add(this.mesh);
    // the eye at the end: a thimble and its shackle
    const eye = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.55, metalness: 0.8 });
    const thimble = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 18), iron); thimble.scale.set(1, 1.5, 1);
    thimble.position.z = 0.22; thimble.rotation.y = Math.PI / 2;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 8, 14, Math.PI * 1.3), iron);
    bow.position.z = 0.48; bow.rotation.set(Math.PI / 2, 0, -Math.PI * 0.15);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), iron); pin.rotation.z = Math.PI / 2; pin.position.z = 0.42;
    eye.add(thimble, bow, pin);
    eye.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.eye = eye; scene.add(eye);
    // the turns on the drum: a sleeve per layer (inside the drum node, so they turn with it)
    this.layers = [];
    if (this.drum) {
      for (let k = 0; k < 5; k++) {
        const g = coilGeometry(this.r0 + DIA * (k + 0.5), this.width, this.turns, k % 2 === 1);
        const m = new THREE.Mesh(g, this.material);
        m.castShadow = true; m.receiveShadow = true; m.visible = false;
        this.drum.add(m); this.layers.push(m);
      }
    }
    this.updateDrum(0);
  }

  findMaterial(model) {
    let found = null;
    model.scene.traverse((o) => { if (!found && o.isMesh && /rope/i.test(o.material?.name || '')) found = o.material; });
    const m = found ? found.clone() : new THREE.MeshStandardMaterial({ color: 0xb87a36, roughness: 0.85 });
    m.vertexColors = false;
    m.side = THREE.FrontSide;
    return m;
  }

  // the free span laid out straight astern and down to the water (at the start, or after a jump)
  resetSpan() {
    const b = this.boat;
    this.nodes.length = 0;
    const r = b.toWorld(this.pRoller, new THREE.Vector3());
    const aft = b.forward.clone().multiplyScalar(-1);
    const n = Math.max(2, Math.round(this.out / SEG) + 1);
    for (let i = 0; i < n; i++) {
      const s = (i / (n - 1)) * this.out;
      const p = r.clone().addScaledVector(aft, Math.min(s, 2) + Math.max(0, s - 2) * 0.95);
      p.y = Math.max(-1.5, r.y - Math.min(s, 5) * 0.9);
      this.nodes.push({ p, q: p.clone() });
    }
  }

  get state() { return this.mode; }
  command(mode) {
    if (mode !== 'stop') this.last = mode;
    this.mode = mode;
  }
  // the next thing the lever does
  nextCommand() {
    if (this.mode !== 'stop') return 'stop';
    if (this.out >= MAX_OUT - 0.5) return 'in';
    if (this.out <= MIN_OUT + 0.3) return 'out';
    return this.last === 'in' ? 'out' : 'in';
  }

  update(dt) {
    if (!this.ok) return;
    // the winch
    const want = this.mode === 'in' ? -SPEED_IN : this.mode === 'out' ? SPEED_OUT : 0;
    this.speed = damp(this.speed, want, this.mode === 'stop' ? 6 : 2.2, dt);
    const before = this.out;
    this.out = clamp(this.out + this.speed * dt, MIN_OUT, MAX_OUT);
    if ((this.out <= MIN_OUT && this.mode === 'in') || (this.out >= MAX_OUT && this.mode === 'out')) { this.mode = 'stop'; this.onLimit?.(this.out <= MIN_OUT ? 'in' : 'out'); }
    const moved = this.out - before;
    this.slide -= moved;
    this.updateDrum(moved);
    // the span: as many nodes as the line past the roller needs, added and taken at the roller
    const want_n = Math.max(2, Math.round(this.out / SEG) + 1);
    while (this.nodes.length < want_n) {
      const a = this.nodes[0].p, b = this.nodes[1] ? this.nodes[1].p : a;
      const p = a.clone().lerp(b, 0.5);
      this.nodes.splice(1, 0, { p, q: p.clone() });
    }
    while (this.nodes.length > want_n) this.nodes.splice(1, 1);
    // (the water's surface under each node, once a frame: the swell hardly moves within one)
    const surf = this.surf || (this.surf = []);
    for (let i = 0; i < this.nodes.length; i++) surf[i] = this.waves.heightAt(this.nodes[i].p.x, this.nodes[i].p.z);
    const steps = Math.min(3, Math.max(1, Math.ceil(dt / (1 / 75))));
    for (let s = 0; s < steps; s++) this.simulate(dt / steps);
    this.build();
  }

  simulate(dt) {
    const nodes = this.nodes, n = nodes.length;
    const L = this.out / (n - 1);
    const w = this.waves;
    const head = this.boat.toWorld(this.pRoller, _a);
    nodes[0].p.copy(head); nodes[0].q.copy(head);
    const dt2 = dt * dt;
    for (let i = 1; i < n; i++) {
      const nd = nodes[i];
      const depth = this.surf[i] - nd.p.y;
      const wet = clamp((depth + DIA) / (DIA * 4), 0, 1);
      const end = i === n - 1;
      // weight: the line is a little heavier than water; the iron eye much heavier
      const g = end ? 9.8 * (1 - wet * 0.15) : 9.8 * (1 - wet * 0.93);
      // drag (to the still water) and a little lift off the water at speed: the line planes
      const keep = 1 - dt * (0.15 + wet * (end ? 1.5 : 3.0));
      _v.subVectors(nd.p, nd.q).multiplyScalar(Math.max(0, keep));
      nd.q.copy(nd.p);
      nd.p.add(_v);
      nd.p.y -= g * dt2;
      if (!end && depth > 2.5) nd.p.y += Math.min(0.02, (depth - 2.5) * 0.004);   // (the deep end of the bight lifts as she drags it)
    }
    // the line's length: segment constraints, the roller end fixed, the eye heavier
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = nodes[i].p, b = nodes[i + 1].p;
        _w.subVectors(b, a);
        const d = _w.length() || 1e-6;
        const diff = (d - L) / d;
        if (i === 0) b.addScaledVector(_w, -diff);
        else {
          const wa = 0.5, wb = i + 1 === n - 1 ? 0.25 : 0.5;
          a.addScaledVector(_w, diff * wa / (wa + wb) * 1.0);
          b.addScaledVector(_w, -diff * wb / (wa + wb) * 1.0);
        }
      }
    }
    // not through her stern: nodes forward of the transom and low are pushed back aft of it
    const inv = _m.copy(this.boat.root.matrixWorld).invert();
    for (let i = 1; i < n; i++) {
      const p = nodes[i].p;
      _b.copy(p).applyMatrix4(inv);
      if (_b.z < 20.25 && _b.y < 3.7 && Math.abs(_b.x) < 5.5) {
        _b.z = 20.25 + (_b.y < 2.4 ? 0.2 : 0);
        p.copy(_b.applyMatrix4(this.boat.root.matrixWorld));
      }
    }
  }

  // the drum: the line's turns as layers (their radius grows as it fills), the drum turning, the
  // level-wind walking across it, the roller turning
  updateDrum(moved) {
    const wound = Math.max(0, LINE - this.out - this.deckLen);
    let left = wound, k = 0;
    this.topR = this.r0 + DIA / 2; this.lay = 0;
    for (const m of this.layers) m.visible = false;
    while (left > 0 && k < this.layers.length) {
      const r = this.r0 + DIA * (k + 0.5);
      const per = this.turns * 2 * Math.PI * r;
      const f = Math.min(1, left / per);
      const m = this.layers[k];
      if (m) {
        // (a layer fills turn by turn from one flange: its rows drawn up to how far it has got)
        m.visible = true;
        const rows = m.geometry.userData.rows;
        m.geometry.setDrawRange(0, Math.max(1, Math.ceil(f * (rows - 1))) * COIL_RADIAL * 6);
      }
      this.topR = r + DIA * 0.5;
      this.lay = (k % 2 ? 1 - f : f);                 // where along the drum the line comes off (0..1)
      left -= per; k++;
    }
    // turning: the top of the drum moves aft as it pays out
    this.drumA += moved / Math.max(0.3, this.topR);
    this.rollerA += moved / 0.36;
    if (this.drum) this.drum.rotation.x = this.drumA;
    if (this.roller) this.roller.rotation.x = this.rollerA;
    if (this.spool && this.spoolBase) this.spool.position.x = this.spoolBase.x + (this.lay - 0.5) * (this.width - DIA);
  }

  // the tube along the whole line: off the drum, through the level-wind, over the bitt and the roller, the span
  build() {
    const b = this.boat;
    const pts = [];
    const lx = (this.lay - 0.5) * (this.width - DIA);
    // where it leaves the drum: the tangent from the lead point to the coil (in the drum's y-z plane)
    const c = this.pDrum, l = this.pLead;
    const dz = l.z - c.z, dy = l.y - c.y, d = Math.hypot(dz, dy), r = this.topR;
    const phi = Math.atan2(dy, dz), th = phi + Math.acos(clamp(r / d, -1, 1));
    const tan = new THREE.Vector3(c.x + lx, c.y + Math.sin(th) * r, c.z + Math.cos(th) * r);
    // (a little of the coil it comes off, for a clean departure)
    for (let k = 3; k >= 1; k--) {
      const a = th + k * 0.18;
      pts.push(b.toWorld(new THREE.Vector3(c.x + lx, c.y + Math.sin(a) * r, c.z + Math.cos(a) * r)));
    }
    pts.push(b.toWorld(tan));
    pts.push(b.toWorld(new THREE.Vector3(l.x + lx, l.y, l.z)));
    pts.push(b.toWorld(this.pBitt.clone()));
    // over the roller's crown: a few points round it
    const rp = this.pRoller;
    pts.push(b.toWorld(new THREE.Vector3(rp.x, rp.y - 0.01, rp.z - 0.12)));
    for (let i = 1; i < this.nodes.length; i++) pts.push(this.nodes[i].p);
    const n = Math.min(pts.length, MAXP);
    const pos = this.geo.attributes.position.array, nor = this.geo.attributes.normal.array, uv = this.geo.attributes.uv.array;
    let len = this.slide;
    _prevN.set(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(n - 1, i + 1)];
      _t.subVectors(pb, pa).normalize();
      // a frame carried along the line (no twisting)
      _n.copy(_prevN).addScaledVector(_t, -_prevN.dot(_t));
      if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0).addScaledVector(_t, -_t.x);
      _n.normalize(); _prevN.copy(_n);
      _bn.crossVectors(_t, _n);
      if (i > 0) len += p.distanceTo(pts[i - 1]);
      for (let k = 0; k <= RADIAL; k++) {
        const a = (k / RADIAL) * Math.PI * 2;
        const cx = Math.cos(a), sx = Math.sin(a);
        const j = (i * (RADIAL + 1) + k);
        const nx = _n.x * cx + _bn.x * sx, ny = _n.y * cx + _bn.y * sx, nz = _n.z * cx + _bn.z * sx;
        pos[j * 3] = p.x + nx * DIA * 0.5; pos[j * 3 + 1] = p.y + ny * DIA * 0.5; pos[j * 3 + 2] = p.z + nz * DIA * 0.5;
        nor[j * 3] = nx; nor[j * 3 + 1] = ny; nor[j * 3 + 2] = nz;
        uv[j * 2] = len / 0.24; uv[j * 2 + 1] = (k / RADIAL) * 1.3;
      }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * RADIAL * 6);
    // the eye on the last node, along the last segment
    const e0 = pts[n - 2], e1 = pts[n - 1];
    this.eye.position.copy(e1);
    _t.subVectors(e1, e0).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _t);
    this.eye.quaternion.copy(_q);
    this.eye.translateZ(-0.05);
  }

  get speedNow() { return this.speed; }
}
