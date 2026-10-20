import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// What you walk on and bump into aboard, in boat space: the model's COL_ meshes (decks, walls,
// stair ramps, bulwarks, machinery blocks) merged into one BVH, plus the doors as boxes while
// they are shut. The capsule resolve is the one from three-mesh-bvh's character example: find
// each triangle near the capsule, push the capsule's segment out along the closest-point normal.

const _tri = new THREE.Vector3(), _cap = new THREE.Vector3(), _box = new THREE.Box3(), _seg = new THREE.Line3();
const _p = new THREE.Vector3(), _d = new THREE.Vector3();

export class Collision {
  constructor(meshes, root) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const geos = [];
    for (const m of meshes) {
      const g = m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
      g.morphAttributes = {};
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      geos.push(g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]));
    }
    // (quantized GLB positions come in as normalized ints: make every one plain floats)
    for (const g of geos) {
      const a = g.attributes.position;
      if (!(a.array instanceof Float32Array) || a.normalized) {
        const f = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
        g.setAttribute('position', new THREE.BufferAttribute(f, 3));
      }
    }
    this.geometry = mergeGeometries(geos, false);
    this.bvh = new MeshBVH(this.geometry, { maxLeafSize: 8 });
    this.geometry.boundsTree = this.bvh;
    this.mesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ wireframe: true, color: 0xff00ff }));
    this.mesh.visible = false;
    this.boxes = [];       // { box: Box3, on: bool } (the doors)
    this.extras = [];      // more BVHs in boat space (the ice and the gangway while she's moored)
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.tris = this.geometry.index.count / 3;
  }

  addBox(box) { const b = { box, on: true }; this.boxes.push(b); return b; }

  // more geometry to walk on and bump into (boat space), and away again
  addExtra(geometries) {
    const geos = geometries.map((g) => {
      const c = g.clone();
      for (const k of Object.keys(c.attributes)) if (k !== 'position') c.deleteAttribute(k);
      const a = c.attributes.position;
      if (!(a.array instanceof Float32Array) || a.normalized) {
        const f = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
        c.setAttribute('position', new THREE.BufferAttribute(f, 3));
      }
      return c.index ? c : c.setIndex([...Array(c.attributes.position.count).keys()]);
    });
    const g = mergeGeometries(geos, false);
    const e = { bvh: new MeshBVH(g, { maxLeafSize: 8 }), geometry: g };
    this.extras.push(e);
    return e;
  }
  removeExtra(e) { const i = this.extras.indexOf(e); if (i >= 0) this.extras.splice(i, 1); }

  // push a capsule (segment start..end, radius) out of everything; returns it moved
  resolve(seg, radius) {
    for (const bvh of [this.bvh, ...this.extras.map((e) => e.bvh)]) this.resolveIn(bvh, seg, radius);
    this.resolveBoxes(seg, radius);
    return seg;
  }

  resolveIn(bvh, seg, radius) {
    _box.makeEmpty(); _box.expandByPoint(seg.start); _box.expandByPoint(seg.end);
    _box.min.addScalar(-radius); _box.max.addScalar(radius);
    bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        const dist = tri.closestPointToSegment(seg, _tri, _cap);
        if (dist < radius) {
          const depth = radius - dist;
          _d.subVectors(_cap, _tri).normalize();
          seg.start.addScaledVector(_d, depth);
          seg.end.addScaledVector(_d, depth);
        }
      },
    });
  }

  resolveBoxes(seg, radius) {
    for (const b of this.boxes) {
      if (!b.on) continue;
      // the closest point of the box to the segment (sampled along it), pushed out if inside radius
      for (let i = 0; i <= 4; i++) {
        _seg.start.copy(seg.start); _p.copy(seg.start).lerp(seg.end, i / 4);
        const c = b.box.clampPoint(_p, _cap);
        const d = c.distanceTo(_p);
        if (d < radius) {
          if (d < 1e-5) { _d.set(0, 0, 0); continue; }
          _d.subVectors(_p, c).multiplyScalar((radius - d) / d);
          seg.start.add(_d); seg.end.add(_d);
        }
      }
    }
    return seg;
  }

  // does a capsule touch anything solid (the BVH and the extras ashore; not the doors)?
  touches(seg, radius) {
    _box.makeEmpty(); _box.expandByPoint(seg.start); _box.expandByPoint(seg.end);
    _box.min.addScalar(-radius); _box.max.addScalar(radius);
    let hit = false;
    for (const bvh of [this.bvh, ...this.extras.map((e) => e.bvh)]) {
      bvh.shapecast({
        intersectsBounds: (b) => b.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          if (tri.closestPointToSegment(seg, _tri, _cap) < radius) { hit = true; return true; }
          return false;
        },
      });
      if (hit) break;
    }
    return hit;
  }

  // the first hit along a ray in boat space (distance, or Infinity)
  raycast(origin, dir, far = 50) {
    this.raycaster.set(origin, dir); this.raycaster.far = far;
    const hit = this.bvh.raycastFirst(this.raycaster.ray, THREE.DoubleSide, 0, far);
    let best = hit ? hit.distance : Infinity;
    for (const e of this.extras) {
      const h = e.bvh.raycastFirst(this.raycaster.ray, THREE.DoubleSide, 0, far);
      if (h && h.distance < best) best = h.distance;
    }
    for (const b of this.boxes) {
      if (!b.on) continue;
      const p = this.raycaster.ray.intersectBox(b.box, _p);
      if (p) best = Math.min(best, p.distanceTo(origin));
    }
    return best;
  }

  // the floor under a boat-space point (its height, or null)
  floorAt(x, y, z, reach = 3) {
    _p.set(x, y + 0.5, z); _d.set(0, -1, 0);
    const d = this.raycast(_p, _d, reach + 0.5);
    return d === Infinity ? null : y + 0.5 - d;
  }
}
