import * as THREE from 'three';
import { rng } from '../core/util.js';
import { NO_REFLECT } from './Reflection.js';

// The ice field, without end. The sea is divided into 400 m tiles; each tile's ice is decided by
// a hash of its coordinates (so a berg you passed is still there if you turn back), and only the
// tiles round the boat are live. Every ice shape (icebergs.glb: bergs, growlers, floes) is one
// InstancedMesh, so the whole field costs a draw call per shape.
//
// Each piece: its shape, where it is, its turn and scale, and for floes a drift velocity (the
// boat shoves them aside). Floes and growlers ride the swell (heave and tilt from the same waves
// as the boat); the big bergs are too massive to notice it. Collisions: the boat's hull circles
// against each piece's waterline circles (measured from its mesh at load): a berg stops her with
// a crunch, a floe is pushed away with a scrape.

const TILE = 400;
const RADIUS = 1300;        // live tiles out to this distance
const LOD_FAR = 420;        // past this the bergs swap to their far meshes (and stop casting shadows)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

// kinds: what a tile asks for, by size class
const CLASS = {
  berg: { count: [0, 1], minGap: 140 },
  bit: { count: [1, 4], minGap: 40 },
  growler: { count: [2, 7], minGap: 14 },
  floe: { count: [3, 8], minGap: 22 },
};

export class IceField {
  constructor({ scene, waves, material, shapes, quality }) {
    this.scene = scene; this.waves = waves; this.quality = quality;
    this.shapes = shapes;                     // [{ name, cls, geometry, circles: [[x,z,r]], radius, height, top }]
    this.byClass = {};
    for (const s of shapes) (this.byClass[s.cls] ||= []).push(s);
    this.meshes = new Map(); this.far = new Map();
    const cap = { berg: 40, bit: 140, growler: 260, floe: 260 };
    const make = (geo, n, name, shadow) => {
      const im = new THREE.InstancedMesh(geo, material, n);
      im.count = 0; im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.name = name;
      scene.add(im);
      return im;
    };
    for (const s of shapes) {
      const n = Math.ceil(cap[s.cls] / this.byClass[s.cls].length) + 4;
      this.meshes.set(s, make(s.geometry, n, 'Ice_' + s.name, true));
      if (s.lod) this.far.set(s, make(s.lod, n, 'IceFar_' + s.name, false));
    }
    this.tiles = new Map();          // key -> pieces
    this.pieces = [];                // live pieces
    this.hits = [];
    this.onHit = null;               // (piece, strength, point, big)
    this.t = 0;
  }

  key(i, j) { return i + ',' + j; }

  makeTile(i, j) {
    const r = rng((i * 73856093) ^ (j * 19349663) ^ 0x5bd1e995);
    const pieces = [];
    const cx = (i + 0.5) * TILE, cz = (j + 0.5) * TILE;
    const near0 = Math.hypot(cx, cz) < 300;      // (keep the start clear)
    for (const [cls, c] of Object.entries(CLASS)) {
      const list = this.byClass[cls]; if (!list) continue;
      let n = c.count[0] + Math.floor(r() * (c.count[1] - c.count[0] + 1));
      if (cls === 'berg' && r() < 0.25) n = 1;
      for (let k = 0; k < n; k++) {
        const shape = list[Math.floor(r() * list.length)];
        const scale = cls === 'berg' ? 0.8 + r() * 0.5 : 0.75 + r() * 0.6;
        let x, z, ok = false;
        for (let tries = 0; tries < 8 && !ok; tries++) {
          x = cx + (r() - 0.5) * TILE; z = cz + (r() - 0.5) * TILE;
          ok = true;
          if (near0 && Math.hypot(x, z) < 150 + shape.radius * scale) ok = false;
          for (const p of pieces) if (Math.hypot(p.x - x, p.z - z) < (p.shape.radius * p.scale + shape.radius * scale) * 1.2 + c.minGap * 0.3) { ok = false; break; }
        }
        if (!ok) continue;
        pieces.push({ shape, cls, x, z, rot: r() * Math.PI * 2, scale, vx: 0, vz: 0, spin: 0, phase: r() * 10, y: 0, tilt: [0, 0], animals: cls === 'floe' && r() < 0.42 ? (r() < 0.5 ? 'walrus' : 'penguin') : cls === 'bit' && r() < 0.25 ? 'penguin' : null, id: `${i},${j},${pieces.length}` });
      }
    }
    return pieces;
  }

  update(dt, boat) {
    this.t += dt;
    // live tiles round the boat
    const bi = Math.floor(boat.x / TILE), bj = Math.floor(boat.z / TILE), R = Math.ceil(RADIUS / TILE);
    const want = new Set();
    for (let i = bi - R; i <= bi + R; i++) for (let j = bj - R; j <= bj + R; j++) {
      const cx = (i + 0.5) * TILE - boat.x, cz = (j + 0.5) * TILE - boat.z;
      if (Math.hypot(cx, cz) > RADIUS + TILE * 0.7) continue;
      const k = this.key(i, j); want.add(k);
      if (!this.tiles.has(k)) this.tiles.set(k, this.makeTile(i, j));
    }
    for (const k of [...this.tiles.keys()]) if (!want.has(k)) this.tiles.delete(k);
    this.pieces = [].concat(...this.tiles.values());

    // drift, the swell, collisions with the hull
    const circles = boat.hullCircles(this._hc || (this._hc = []));
    this.frameN = (this.frameN || 0) + 1;
    let i = 0;
    for (const p of this.pieces) {
      i++;
      if (p.cls === 'floe' || p.cls === 'growler' || p.cls === 'bit') {
        p.x += p.vx * dt; p.z += p.vz * dt; p.rot += p.spin * dt;
        const drag = Math.exp(-dt * (p.cls === 'bit' ? 0.25 : 0.4));
        p.vx *= drag; p.vz *= drag; p.spin *= drag;
        const d = Math.hypot(p.x - boat.x, p.z - boat.z);
        // riding the swell (the far ones every other frame: they're small out there)
        if (d < 320 && (d < 120 || (i + this.frameN) % 2 === 0)) {
          const k = d < 120 ? dt : dt * 2;
          const h = this.waves.heightAt(p.x, p.z);
          const s = p.shape.radius * p.scale * 0.6 + 1;
          const hx = this.waves.heightAt(p.x + s, p.z) - h, hz = this.waves.heightAt(p.x, p.z + s) - h;
          const mass = p.cls === 'bit' ? 0.4 : 1;
          // (floes ride the water exactly: a lag would let the crests wash over them)
          p.y += (h * (p.cls === 'bit' ? 0.6 : 1.0) - p.y) * Math.min(1, k * (p.cls === 'bit' ? 1.5 : 8));
          p.tilt[0] += (Math.atan2(hz, s) * 0.8 * mass - p.tilt[0]) * Math.min(1, k * 3);
          p.tilt[1] += (-Math.atan2(hx, s) * 0.8 * mass - p.tilt[1]) * Math.min(1, k * 3);
        }
      } else {
        p.y = Math.sin(this.t * 0.31 + p.phase) * 0.05;
      }
    }
    this.collide(dt, boat, circles);
    this.writeInstances(boat);
  }

  // a piece's waterline circles in the world
  worldCircles(p, out) {
    out.length = 0;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (const [x, z, r] of p.shape.circles) out.push([p.x + (x * c + z * s) * p.scale, p.z + (-x * s + z * c) * p.scale, r * p.scale]);
    return out;
  }

  collide(dt, boat, hull) {
    const pc = this._pc || (this._pc = []);
    for (const p of this.pieces) {
      const dx = p.x - boat.x, dz = p.z - boat.z;
      if (Math.hypot(dx, dz) > p.shape.radius * p.scale + 30) continue;
      this.worldCircles(p, pc);
      let worst = 0, nx = 0, nz = 0, hx = 0, hz = 0;
      for (const [cx, cz, cr] of pc) {
        for (const [bx, bz, br] of hull) {
          const ex = cx - bx, ez = cz - bz, d = Math.hypot(ex, ez), pen = cr + br - d;
          if (pen > worst) { worst = pen; nx = ex / (d || 1); nz = ez / (d || 1); hx = bx + nx * br; hz = bz + nz * br; }
        }
      }
      if (worst <= 0) { p.touch = Math.max(0, (p.touch || 0) - dt); continue; }
      const fx = -Math.sin(boat.heading), fz = -Math.cos(boat.heading);
      const closing = Math.max(0, (fx * nx + fz * nz)) * boat.speed;
      if (p.cls === 'berg' || (p.cls === 'bit' && p.scale > 1.1)) {
        // she can't move a berg: back her out of it and take the blow
        boat.x -= nx * worst; boat.z -= nz * worst;
        if (!p.touch || p.touch <= 0) {
          const strength = Math.min(1, closing / 5 + 0.15);
          boat.hit(strength, new THREE.Vector3(hx, 1, hz), true);
          this.onHit?.(p, strength, new THREE.Vector3(hx, 0.5, hz), true);
        }
        p.touch = 1.2;
        boat.speed *= Math.exp(-dt * 3);
      } else {
        // a floe: shoved aside, spinning, and it costs her a little way
        const mass = p.cls === 'bit' ? 6 : p.cls === 'floe' ? 2.5 * p.scale * p.scale : 1;
        const push = (worst * 2.5 + closing * 0.8) / mass;
        p.vx += nx * push * dt * 8; p.vz += nz * push * dt * 8;
        p.x += nx * worst * 0.5; p.z += nz * worst * 0.5;
        p.spin += (Math.random() - 0.5) * push * dt * 0.6;
        boat.speed = Math.max(0, boat.speed - closing * mass * 0.004 * dt * 30);
        boat.load = Math.min(1, boat.load + dt * 2);
        if (!p.touch || p.touch <= 0) {
          const strength = Math.min(1, closing / 6 * (p.cls === 'bit' ? 1.5 : 0.8));
          if (strength > 0.05) { boat.hit(strength * 0.5, new THREE.Vector3(hx, 1, hz), false); this.onHit?.(p, strength, new THREE.Vector3(hx, 0.5, hz), false); }
        }
        p.touch = 0.8;
      }
    }
  }

  writeInstances(boat) {
    const counts = new Map();
    for (const im of this.meshes.values()) im.count = 0;
    for (const im of this.far.values()) im.count = 0;
    // small ice is only drawn near the boat (out there the fog has it anyway)
    const far = { berg: Infinity, bit: 1100, growler: 520, floe: 750 };
    for (const p of this.pieces) {
      const d = Math.hypot(p.x - boat.x, p.z - boat.z);
      p.drawn = d < far[p.cls] + p.shape.radius * p.scale;
      if (!p.drawn) continue;
      const im = d > LOD_FAR + p.shape.radius * p.scale && this.far.has(p.shape) ? this.far.get(p.shape) : this.meshes.get(p.shape);
      const i = im.count;
      if (i >= im.instanceMatrix.count) continue;
      _e.set(p.tilt[0], p.rot, p.tilt[1], 'YXZ');
      _q.setFromEuler(_e);
      _s.setScalar(p.scale);
      _p.set(p.x, p.y, p.z);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      im.count = i + 1;
      p.matrix = p.matrix || new THREE.Matrix4();
      p.matrix.copy(_m);
    }
    for (const im of this.meshes.values()) im.instanceMatrix.needsUpdate = true;
    for (const im of this.far.values()) im.instanceMatrix.needsUpdate = true;
    void counts;
  }

  // pieces near a point (for the radar, the animals, the autopilot)
  near(x, z, r, out = []) {
    out.length = 0;
    for (const p of this.pieces) if (Math.hypot(p.x - x, p.z - z) < r + p.shape.radius * p.scale) out.push(p);
    return out;
  }

  // the top of a piece at a local point (for the animals): its world matrix applied to the shape's
  // top height map
  topAt(p, lx, lz) { return p.shape.topAt ? p.shape.topAt(lx, lz) : p.shape.top; }
}

// shapes for the stand-in field (before the Blender ice is in): squashed noisy icosahedra
export function standInShapes() {
  const make = (name, cls, sx, sy, sz, seed, under = 0.4) => {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const r = rng(seed);
    const pos = g.attributes.position;
    const col = [];
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const n = 1 + (r() - 0.5) * 0.25;
      v.multiplyScalar(n);
      v.set(v.x * sx, v.y > 0 ? v.y * sy : v.y * sy * under, v.z * sz);
      pos.setXYZ(i, v.x, v.y, v.z);
      col.push(v.y > sy * 0.6 ? 0.9 : 0.1, r() * 0.3, 0);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return { name, cls, geometry: g, circles: [[0, 0, Math.min(sx, sz)]], radius: Math.max(sx, sz), height: sy, top: sy };
  };
  return [
    make('berg_a', 'berg', 40, 30, 28, 1), make('berg_b', 'berg', 30, 45, 22, 2),
    make('bit_a', 'bit', 8, 5, 6, 3), make('growler_a', 'growler', 2.5, 1.2, 2, 4),
    make('floe_a', 'floe', 7, 0.5, 5, 5, 1), make('floe_b', 'floe', 11, 0.6, 8, 6, 1),
  ];
}
void NO_REFLECT;
