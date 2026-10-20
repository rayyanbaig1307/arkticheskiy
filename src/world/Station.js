import * as THREE from 'three';
import { tryGLB } from '../core/Assets.js';
import { Flag } from '../boat/Flag.js';
import { Level } from '../levels/Level.js';

// Station Severny (СТАНЦИЯ «СЕВЕРНЫЙ»): the polar station on the fast ice, the Polyarnik's
// destination (tools/blender/make_station.py → public/models/station.glb). It stands 2.4 km
// north-north-east of where she starts.
//
//   the shelf     fast ice 640 x 360 m, its edge 0.6 m above the sea, the station 80 m in; drawn
//                 with the bergs' ice shader (the swell's waterline and foam on its edge)
//   the edge      SHELF_info's line: the boat can't sail into it (she stops with a crunch), the
//                 radar paints it, the autopilot keeps clear of it, the ice field leaves its water
//                 open (no floes along the edge or in front of the berth)
//   lights        the lamp posts along the path, the door's lamp: two real point lights go to
//                 the nearest when she's close; the windows glow; the beacon on the mast flashes
//   the berth     BERTH: where she lies alongside (Story.js brings her in); the gangway and its
//                 collision come out when she's moored; the mooring lines go to ANCHOR_bow/_stern
//
// Station space is the model's own: x along the edge, -z inland (glTF's z is Blender's -y), the
// open water at +z.

export const STATION_POS = new THREE.Vector3(650, 0, -2300);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Station {
  constructor({ scene, lighting, iceMaterial, quality }) {
    this.scene = scene; this.lighting = lighting; this.iceMaterial = iceMaterial; this.quality = quality;
    this.root = new THREE.Group(); this.root.name = 'Station';
    this.root.position.copy(STATION_POS);
    scene.add(this.root);
    this.ready = false;
    this.lamps = []; this.nodes = {}; this.lampMats = [];
    this.dark = false;              // (no power: every lamp out, the beacon dead; the story's)
    // two lights for the lamps nearest the boat (made now: the light count never changes)
    this.lights = [0, 1].map(() => { const l = new THREE.PointLight(0xdde8ff, 0, 22, 2); scene.add(l); return l; });
    this.beaconT = 0;
  }

  async load() {
    const g = await tryGLB('models/station.glb');
    if (!g) return false;
    const m = g.scene;
    this.root.add(m);
    m.updateMatrixWorld(true);
    m.traverse((o) => {
      const n = o.name || '';
      this.nodes[n] = o;
      if (n.startsWith('COL_')) o.visible = false;
      if (n.startsWith('LMP_') && /^LMP_(path|door)/.test(n)) {
        const ud = o.userData || {};
        this.lamps.push({ pos: o.getWorldPosition(new THREE.Vector3()), color: new THREE.Color(...(ud.color || [0.9, 0.95, 1])), power: ud.power ?? 20, range: ud.range ?? 18 });
      }
      if (!o.isMesh || n.startsWith('COL_')) return;
      if (n.startsWith('R_') || (o.parent?.name || '').startsWith('R_') || /^(DOOR|BLAST)_/.test(n) || /^(DOOR|BLAST)_/.test(o.parent?.name || '')) return;   // (the rooms: the level's)
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mm of mats) {
        const mn = (mm.name || '').toLowerCase();
        if (/ice_shelf/.test(mn)) { o.material = this.iceMaterial; o.castShadow = false; continue; }
        if (/glass/.test(mn)) { mm.transparent = true; mm.opacity = 0.25; mm.depthWrite = false; }
        if (/lamp/.test(mn)) { mm.emissiveIntensity *= /beacon/.test(mn) ? 0.5 : 0.5; if (!/beacon/.test(mn) && !this.lampMats.includes(mm)) { mm.userData.lit = mm.emissiveIntensity; this.lampMats.push(mm); } }
        this.lighting.prep(mm);
      }
    });
    this.beacon = null;
    m.traverse((o) => { if (o.isMesh && /beacon/i.test(o.material?.name || '')) this.beacon = o.material; });
    const info = this.nodes.SHELF_info?.userData || {};
    this.edge = info.edge || []; this.edgeX0 = info.x0 ?? -320; this.edgeStep = info.step ?? 4; this.depth = info.depth ?? 360;
    this.halfW = -this.edgeX0;
    this.gangway = this.nodes.GANGWAY || null;
    if (this.gangway) this.gangway.visible = false;
    this.flag = new Flag(this.nodes.FLAG_station);
    // the collision (station space, here as world: the station never moves): the ice, the island,
    // the buildings and their rooms
    this.colMeshes = Object.keys(this.nodes).filter((k) => k.startsWith('COL_') && this.nodes[k].isMesh).map((k) => this.nodes[k]);
    // the rooms, their doors, the things in them (levels/Level.js reads the same model)
    this.level = new Level({ name: 'station', adopt: m, lighting: this.lighting, scene: this.scene, lights: 4 });
    await this.level.load();
    this.ready = true;
    return true;
  }

  // where the boat lies at the berth (world): position and heading
  get berth() {
    const b = this.nodes.BERTH;
    if (!b) return null;
    const p = b.getWorldPosition(new THREE.Vector3());
    const q = b.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);      // (its +y in Blender: the bow)
    return { pos: p, heading: Math.atan2(-f.x, -f.z) };
  }

  // the ice edge's z (station space) at x: the open water lies at greater z
  edgeZ(x) {
    if (!this.edge.length) return 0;
    const f = (x - this.edgeX0) / this.edgeStep;
    const i = Math.max(0, Math.min(this.edge.length - 2, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - i));
    return -(this.edge[i] * (1 - t) + this.edge[i + 1] * t);
  }

  local(x, z, out = _v) { return out.set(x - STATION_POS.x, 0, z - STATION_POS.z); }

  // how far a world point is out from the ice (negative: on it) — the shelf's own sides count as far
  clearance(x, z) {
    const p = this.local(x, z);
    if (Math.abs(p.x) > this.halfW + 40 || p.z < -this.depth - 40) return 1e6;
    const side = this.halfW - Math.abs(p.x);
    const front = p.z - this.edgeZ(Math.max(-this.halfW, Math.min(this.halfW, p.x)));
    if (side < 0) return front > 0 ? Math.hypot(-side, front) : -side;
    if (p.z < -this.depth) return -this.depth - p.z;
    return front;
  }

  // the ice field leaves the shelf, the water along its edge and the berth's approach open
  blocks(x, z, r) {
    const p = this.local(x, z, _w);
    if (Math.abs(p.x) > this.halfW + 60 + r || p.z < -this.depth - 60 - r) return false;
    const front = p.z - this.edgeZ(Math.max(-this.halfW, Math.min(this.halfW, p.x)));
    if (front < 70 + r) return true;                                   // on it, or close along it
    if (Math.abs(p.x) < 160 && front < 320 + r) return true;          // the berth's approach
    return false;
  }

  // the boat's hull against the edge: push her back out and take the knock
  collide(boat, onHit) {
    if (!this.ready || boat.moored || boat.docking) return;
    const circles = boat.hullCircles(this._hc || (this._hc = []));
    let worst = 0, wx = 0, wz = 0;
    for (const [x, z, r] of circles) {
      const c = this.clearance(x, z);
      const pen = r - c;
      if (pen > worst) { worst = pen; wx = x; wz = z; }
    }
    if (worst <= 0) { this.touch = Math.max(0, (this.touch || 0) - 1 / 60); return; }
    // (the edge's normal: out from the ice, +z in station space, give or take its line)
    const p = this.local(wx, wz);
    const dz = this.edgeZ(p.x + 2) - this.edgeZ(p.x - 2);
    const n = new THREE.Vector3(-dz / 4, 0, 1).normalize();
    boat.x += n.x * worst; boat.z += n.z * worst;
    const fx = -Math.sin(boat.heading), fz = -Math.cos(boat.heading);
    const closing = Math.max(0, -(fx * n.x + fz * n.z)) * boat.speed;
    if (!this.touch) {
      const strength = Math.min(1, closing / 4 + 0.1);
      boat.hit(strength, new THREE.Vector3(wx, 1, wz), closing > 1.2);
      onHit?.(new THREE.Vector3(wx, 0.5, wz), strength, closing > 1.2);
    }
    this.touch = 1;
    boat.speed *= 0.6;
  }

  // the radar's picture of the ice: the edge line and the land behind it (world points)
  outline() {
    if (!this.edge.length) return null;
    const pts = [];
    for (let i = 0; i < this.edge.length; i++) {
      const x = this.edgeX0 + i * this.edgeStep;
      pts.push([STATION_POS.x + x, STATION_POS.z - this.edge[i]]);
    }
    pts.push([STATION_POS.x + this.halfW, STATION_POS.z - this.depth], [STATION_POS.x - this.halfW, STATION_POS.z - this.depth]);
    return pts;
  }

  // the collision meshes' geometry in another frame (boat space, when she's moored)
  collisionIn(matrix) {
    const out = [];
    for (const m of this.colMeshes) {
      m.updateMatrixWorld(true);
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(matrix, m.matrixWorld));
      out.push(g);
    }
    return out;
  }

  update(dt, boatPos, night = 1, t = 0) {
    if (!this.ready) return;
    // the beacon: a slow double flash
    this.beaconT += dt;
    const ph = this.beaconT % 2.4;
    const on = ph < 0.15 || (ph > 0.4 && ph < 0.55);
    if (this.beacon) this.beacon.emissiveIntensity = this.dark ? 0.05 : on ? 12 : 0.4;
    if (this._darkWas !== this.dark) {
      this._darkWas = this.dark;
      for (const m of this.lampMats) m.emissiveIntensity = this.dark ? 0 : m.userData.lit;
      this.level?.setPower(!this.dark);
    }
    // lights to the lamps nearest the boat (only when she's near)
    const d0 = boatPos.distanceTo(STATION_POS);
    const sorted = d0 < 700 ? [...this.lamps].sort((a, b) => a.pos.distanceToSquared(boatPos) - b.pos.distanceToSquared(boatPos)) : [];
    this.lights.forEach((l, i) => {
      const L = sorted[i];
      if (!L || this.dark) { l.intensity = 0; return; }
      l.position.copy(L.pos); l.color.copy(L.color); l.distance = L.range;
      l.intensity = L.power * (0.25 + 0.75 * night);
    });
    if (d0 < 900) this.flag?.update(dt, 0.7, 0);
    void t;
  }
}
