import * as THREE from 'three';
import { computeBoundsTree } from 'three-mesh-bvh';
import { tryGLB } from '../core/Assets.js';
import { NO_REFLECT } from '../world/Reflection.js';

// A level built in Blender to the level contract (CONTRACTS.md): Object 7 (tools/blender/
// make_bunker.py → models/bunker.glb), and the station's interiors. Placed in the station's frame
// (the station never moves), so in the world; the integrator turns its collision into boat space
// while the tug is moored.
//
//   rooms     R_<room> (cast shadows) and R_<room>_s (small things, no shadows): shown when you
//             are near them and on their floor, hidden otherwise (the draw calls of a whole facility)
//   zones     ZONE_<room>: boxes; zoneAt(world point) for the ambience, the cold, the darkness
//   lamps     LMP_<name>: a pool of real point lights goes to the lamps nearest you that have
//             power (their group: 'main' needs the power on, 'emerg' and 'cave' always burn);
//             the lamp materials glow or go dark with their group; some flicker
//   doors     DOOR_ / BLAST_: hinged leaves (their origin is the hinge), opened and shut smoothly,
//             their collision boxes on while shut; locks: '' (none), 'power', a key's item id,
//             'code:NNNN', 'story' (the story opens it)
//   points    HIDE_, ITEM_, DOC_, USE_, SPAWN_, TRIG_, LADDER_, SPOT_, PILLAR_, GUEST_: lists the
//             story and the integrator read (each { name, node, pos (world), quat, data })

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _box = new THREE.Box3();
const UP = new THREE.Vector3(0, 1, 0);
const LAMP_MATS = { main: /lamp_bunker|lamp_warm|lamp_cold/i, emerg: /lamp_emergency/i };

// (Blender's x, y, z: glTF's x, z, -y)
const bl = (a) => new THREE.Vector3(a[0], a[2], -a[1]);

export class Level {
  // adopt: an already loaded model to read instead of loading one (the station: its outside is
  // always drawn, its rooms come and go)
  constructor({ name, url, parent, position = new THREE.Vector3(), lighting, lights = 6, scene, adopt = null }) {
    this.name = name; this.url = url; this.lighting = lighting;
    this.adopted = !!adopt;
    this.root = adopt || new THREE.Group(); if (!adopt) this.root.name = 'Level:' + name;
    if (!adopt) { this.root.position.copy(position); (parent || scene).add(this.root); }
    this.ready = false;
    this.rooms = new Map();         // room -> { meshes, box (world), floor }
    this.zones = []; this.lamps = []; this.doors = []; this.cols = [];
    this.points = { HIDE: [], ITEM: [], DOC: [], USE: [], SPAWN: [], TRIG: [], LADDER: [], SPOT: [], PILLAR: [], GUEST: [] };
    this.power = { main: false, emerg: true, cave: true };
    this.lampMats = { main: [], emerg: [] };
    // the light pool (made now: the scene's light count never changes)
    this.pool = [];
    for (let i = 0; i < lights; i++) {
      const l = new THREE.PointLight(0xffd8a8, 0, 10, 2);
      l.castShadow = false;
      (scene || this.root).add(l);
      this.pool.push(l);
    }
    this.t = 0; this.visible = false;
    if (!adopt) this.root.visible = false;
  }

  async load() {
    if (this.adopted) { this.parse(this.root); return true; }
    const g = await tryGLB(this.url);
    if (!g) return false;
    const m = g.scene;
    this.root.add(m);
    this.parse(m);
    return true;
  }

  parse(m) {
    this.root.updateMatrixWorld(true);
    const roomMeshes = [];
    // (Blender's own copies of a name, ZONE_mess.001 exported as ZONE_mess001: the name without it)
    const clean = (s) => (s || '').replace(/(?<=[A-Za-z])\d{3}(?=_|$)/, '');
    m.traverse((o) => {
      const n = clean(o.name);
      const ud = o.userData || {};
      const kind = n.split('_')[0];
      if (n.startsWith('COL_')) { o.visible = false; this.cols.push(o); return; }
      if (this.adopted && n.startsWith('LMP_') && /^LMP_(path|door)/.test(n)) return;        // (the station's own outdoor lamps)
      if (n.startsWith('ZONE_')) {
        const c = o.getWorldPosition(new THREE.Vector3());
        const s = ud.size ? bl(ud.size) : new THREE.Vector3(4, 3, -4);
        const size = new THREE.Vector3(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        this.zones.push({ name: n.slice(5), box: new THREE.Box3().setFromCenterAndSize(c, size), ambience: ud.ambience || 'bunker', floor: ud.floor ?? 0, centre: c });
        return;
      }
      if (n.startsWith('LMP_')) {
        this.lamps.push({ name: n.slice(4), pos: o.getWorldPosition(new THREE.Vector3()), color: new THREE.Color(...(ud.color || [1, 0.85, 0.6])),
          power: ud.power ?? 20, range: ud.range ?? 9, flicker: ud.flicker ?? 0, group: ud.group || 'main', phase: Math.random() * 100 });
        return;
      }
      if (n.startsWith('DOOR_') || n.startsWith('BLAST_')) {
        if (!o.isMesh && !o.children.length) return;
        if (this.doors.some((d) => d.node === o || d.node === o.parent)) return;
        this.doors.push(this.makeDoor(o, n, ud));
        return;
      }
      if (this.points[kind] && !(o.isMesh && o.parent && this.points[kind].some((p) => p.node === o.parent))) {
        if (o.isMesh && o.parent && clean(o.parent.name).startsWith(kind + '_')) return;     // (a multi-material object's parts)
        this.points[kind].push({ name: n.slice(kind.length + 1), node: o, pos: o.getWorldPosition(new THREE.Vector3()), quat: o.getWorldQuaternion(new THREE.Quaternion()), data: ud });
      }
      if (o.isMesh && !this.adopted) this.prepMesh(o, n);
      else if (o.isMesh && (n.startsWith('R_') || clean(o.parent?.name).startsWith('R_'))) this.prepMesh(o, n);
      if (o.isMesh && (n.startsWith('R_') || clean(o.parent?.name).startsWith('R_'))) roomMeshes.push(o);
    });
    // the rooms: their meshes, the box of their zone
    const zoneNames = this.zones.map((z) => z.name).sort((a, b) => b.length - a.length);
    for (const o of roomMeshes) {
      const raw = clean(clean(o.name).startsWith('R_') ? o.name : o.parent.name).slice(2);
      // (R_<room>, R_<room>_s, R_<room>_dead...: the longest zone name it starts with)
      const top = zoneNames.find((zn) => raw === zn || raw.startsWith(zn + '_')) || raw.replace(/_s$/, '').replace(/_\d+$/, '');
      if (!this.rooms.has(top)) {
        const z = this.zones.find((zz) => zz.name === top);
        this.rooms.set(top, { meshes: [], box: z ? z.box.clone() : new THREE.Box3().setFromObject(o), floor: z ? z.floor : 0 });
      }
      this.rooms.get(top).meshes.push(o);
    }
    this.blockers = roomMeshes;
    for (const o of roomMeshes) o.geometry.computeBoundsTree?.();
    this.setPower(this.power.main);
    this.ready = true;
  }

  prepMesh(o, n) {
    const small = /_s$/.test(n) || /_s$/.test(o.parent?.name || '') || o.userData?.nocast;
    o.castShadow = !small; o.receiveShadow = true;
    o.layers.set(NO_REFLECT);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mm of mats) {
      if (mm.userData._levelPrep) continue;
      mm.userData._levelPrep = true;
      const mn = mm.name || '';
      if (/glass/i.test(mn)) { mm.transparent = true; mm.depthWrite = false; mm.opacity = /frost/i.test(mn) ? 0.6 : 0.25; mm.side = THREE.DoubleSide; }
      if (/^decal_/i.test(mn)) { mm.polygonOffset = true; mm.polygonOffsetFactor = -2; mm.polygonOffsetUnits = -2; }
      if (LAMP_MATS.main.test(mn)) this.lampMats.main.push(mm);
      else if (LAMP_MATS.emerg.test(mn)) this.lampMats.emerg.push(mm);
      if (mm.emissive && !/lamp/i.test(mn) && !/guest|ice_growth/i.test(mn)) mm.emissiveIntensity = Math.min(mm.emissiveIntensity, 1);
      mm.envMapIntensity = 0.12;              // (underground: the sky's light doesn't come down here)
      if (mm.userData.baseEmissive === undefined) mm.userData.baseEmissive = mm.emissiveIntensity ?? 1;
      this.lighting?.prep(mm);
    }
  }

  makeDoor(o, n, ud) {
    const blast = n.startsWith('BLAST_');
    const d = {
      name: n.replace(/^(DOOR|BLAST)_/, ''), node: o, blast, kind: ud.kind || (blast ? 'blast' : 'steel'), lock: ud.lock || '', label: ud.label || '',
      open: THREE.MathUtils.degToRad(ud.open ?? 100), rest: o.quaternion.clone(), t: 0, want: 0, speed: blast ? 0.22 : 1.6, box: null, colBox: null,
    };
    o.updateMatrixWorld(true);
    d.box = new THREE.Box3().setFromObject(o);       // (world, shut: the walls are square, so is the door)
    return d;
  }

  // the collision in another frame (boat space while she's moored), and the doors' boxes
  collisionIn(matrix) {
    const out = [];
    for (const m of this.cols) {
      m.updateMatrixWorld(true);
      if (!m.geometry) continue;
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(matrix, m.matrixWorld));
      out.push(g);
    }
    return out;
  }
  doorBoxesIn(matrix) {
    return this.doors.map((d) => ({ door: d, box: d.box.clone().applyMatrix4(matrix).expandByScalar(-0.02) }));
  }

  zoneAt(worldPos) {
    // (the smallest box that holds the point: a room inside a bigger zone wins)
    let best = null, bv = Infinity;
    for (const z of this.zones) {
      if (!z.box.containsPoint(worldPos)) continue;
      const s = z.box.getSize(_v), vol = s.x * s.y * s.z;
      if (vol < bv) { best = z; bv = vol; }
    }
    return best;
  }

  setPower(on) {
    this.power.main = on;
    for (const m of this.lampMats.main) m.emissiveIntensity = on ? m.userData.baseEmissive : 0.0;
  }

  // a door's state: 'locked' / opening: callers check the lock first
  openDoor(d, open = true) { d.want = open ? 1 : 0; }
  doorFor(object) { for (const d of this.doors) { let o = object; while (o) { if (o === d.node) return d; o = o.parent; } } return null; }

  show(on) {
    this.visible = on;
    if (!this.adopted) this.root.visible = on;
    else for (const [, r] of this.rooms) for (const mm of r.meshes) mm.visible = on && mm.visible;
    if (!on) for (const l of this.pool) l.intensity = 0;
  }

  update(dt, viewer) {
    if (!this.ready || !this.visible) return;
    this.t += dt;
    // the doors swing
    for (const d of this.doors) {
      if (d.t === d.want) continue;
      d.t = d.want > d.t ? Math.min(d.want, d.t + dt * d.speed) : Math.max(d.want, d.t - dt * d.speed);
      const k = d.t * d.t * (3 - 2 * d.t);
      d.node.quaternion.copy(d.rest).multiply(_q.setFromAxisAngle(UP, d.open * k));
      if (d.colEntry) d.colEntry.on = d.t < 0.15;
      d.onMove?.(d);
    }
    // the rooms near you and on your floor are drawn
    for (const [, r] of this.rooms) {
      const dist = r.box.distanceToPoint(viewer);
      const sameFloor = viewer.y > r.box.min.y - 1.5 && viewer.y < r.box.max.y + 1.5;
      const on = dist < 30 && (sameFloor || dist < 4);
      for (const mm of r.meshes) mm.visible = on;
    }
    // the light pool: the nearest lamps with power (four times a second)
    this.lightT = (this.lightT || 0) - dt;
    if (this.lightT <= 0) {
      this.lightT = 0.25;
      this.near = this.lamps.filter((L) => this.power[L.group] !== false && L.pos.distanceTo(viewer) < 28 && Math.abs(L.pos.y - viewer.y) < 5)
        .sort((a, b) => a.pos.distanceToSquared(viewer) - b.pos.distanceToSquared(viewer)).slice(0, this.pool.length);
    }
    const near = this.near || [];
    this.pool.forEach((l, i) => {
      const L = near[i];
      if (!L) { l.intensity = 0; return; }
      l.position.copy(L.pos); l.color.copy(L.color); l.distance = L.range * 1.4;
      let k = 1;
      if (L.flicker > 0) {
        const t = this.t + L.phase;
        const n = Math.sin(t * 13.1) * Math.sin(t * 7.7 + 1.3) * Math.sin(t * 2.3);
        k = n > 1 - L.flicker * 0.6 ? 0.08 : (0.85 + 0.15 * Math.sin(t * 41));
      }
      l.intensity = L.power * 0.85 * k * (this.dim ?? 1);
    });
  }
}
