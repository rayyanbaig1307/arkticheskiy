import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// The ice shapes from icebergs.glb (tools/blender/make_icebergs.py): one mesh per shape, named
// ICE_<class>_<name>, centred on its waterline. For each shape this measures what the game needs:
//   circles   its waterline footprint as a few circles along its long axis (collisions, foam)
//   radius    the farthest waterline point (the autopilot keeps clear of it)
//   spots     level places on top where an animal can stand (floes and bergy bits)

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

export function iceShapes(gltf) {
  const shapes = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.name.startsWith('ICE_')) return;
    const [, cls, ...rest] = o.name.split('_');
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    // (plain floats for every attribute the shaders read)
    for (const k of ['position', 'normal', 'color']) {
      const a = g.attributes[k];
      if (a && (a.normalized || !(a.array instanceof Float32Array))) {
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
    }
    if (g.attributes.color && g.attributes.color.itemSize === 4) {
      const a = g.attributes.color, f = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(f, 3));
    }
    g.computeBoundingSphere(); g.computeBoundingBox();
    g.computeBoundsTree();
    const s = { name: rest.join('_'), cls, geometry: g };
    if (!s.name.endsWith('_LOD1')) measure(s);
    shapes.push(s);
  });
  // the far versions go with their shapes
  for (const s of shapes.filter((x) => x.name.endsWith('_LOD1'))) {
    const base = shapes.find((x) => x.cls === s.cls && x.name === s.name.slice(0, -5));
    if (base) base.lod = s.geometry;
  }
  return shapes.filter((x) => !x.name.endsWith('_LOD1'));
}

function measure(s) {
  const pos = s.geometry.attributes.position;
  const pts = [];
  let top = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    top = Math.max(top, y);
    if (Math.abs(y) < 0.7) pts.push([pos.getX(i), pos.getZ(i)]);
  }
  if (pts.length < 3) for (let i = 0; i < pos.count; i += 3) pts.push([pos.getX(i), pos.getZ(i)]);
  // principal axis of the footprint
  let mx = 0, mz = 0;
  for (const [x, z] of pts) { mx += x; mz += z; }
  mx /= pts.length; mz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ax = Math.cos(ang), az = Math.sin(ang);
  let lo = Infinity, hi = -Infinity, wide = 0;
  for (const [x, z] of pts) {
    const t = (x - mx) * ax + (z - mz) * az, w = Math.abs(-(x - mx) * az + (z - mz) * ax);
    lo = Math.min(lo, t); hi = Math.max(hi, t); wide = Math.max(wide, w);
  }
  const len = hi - lo;
  const K = Math.max(1, Math.min(5, Math.round(len / Math.max(1, wide * 1.4))));
  s.circles = [];
  for (let k = 0; k < K; k++) {
    const t0 = lo + (len * k) / K, t1 = lo + (len * (k + 1)) / K;
    let cx = 0, cz = 0, n = 0;
    const seg = [];
    for (const p of pts) {
      const t = (p[0] - mx) * ax + (p[1] - mz) * az;
      if (t >= t0 - 0.01 && t <= t1 + 0.01) { cx += p[0]; cz += p[1]; n++; seg.push(p); }
    }
    if (!n) continue;
    cx /= n; cz /= n;
    const d = seg.map(([x, z]) => Math.hypot(x - cx, z - cz)).sort((a, b) => a - b);
    s.circles.push([cx, cz, d[Math.floor(d.length * 0.9)] * 0.95]);
  }
  s.radius = Math.max(...pts.map(([x, z]) => Math.hypot(x, z)));
  s.top = top;
  s.height = top;
  // where an animal can stand: level ground on top (floes, bits)
  s.spots = [];
  if (s.cls === 'floe' || s.cls === 'bit') {
    const mesh = new THREE.Mesh(s.geometry);
    mesh.raycast = acceleratedRaycast;
    const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
    const R = s.radius * 0.85;
    for (let x = -R; x <= R; x += 1.1) for (let z = -R; z <= R; z += 1.1) {
      ray.set(new THREE.Vector3(x, top + 5, z), new THREE.Vector3(0, -1, 0));
      const h = ray.intersectObject(mesh)[0];
      if (!h || !h.face) continue;
      const n = h.face.normal;
      if (n.y > 0.88 && h.point.y > 0.05 && (s.cls === 'floe' ? h.point.y < 1.2 : true)) s.spots.push([x, h.point.y, z]);
    }
  }
}
