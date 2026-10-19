import * as THREE from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';

// What you're looking at, and E to use it. Each frame one ray goes from the middle of the screen
// against the boat (its merged visual meshes, BVH-accelerated: walls hide what's behind them) and
// against everything that can be used. The nearest hit, if it is usable and in reach, shows its
// hint under the crosshair; E calls its use().
//
//   add(object, { hint: () => text, use: () => void, range })

THREE.Mesh.prototype.raycast = acceleratedRaycast;
const _c = new THREE.Vector2(0, 0);

export class Interactions {
  constructor({ camera, input, ui }) {
    this.camera = camera; this.input = input; this.ui = ui;
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.ray.layers.enableAll();          // (the rooms and the small parts live on NO_REFLECT)
    this.targets = [];          // { object, hint, use, range, enabled }
    this.blockers = [];         // meshes that hide things (the boat)
    this.current = null;
    this.enabled = true;
    this.lookDist = 10;         // how far the centre of the screen is (depth of field)
  }

  add(object, opts) {
    const t = { object, range: 2.4, enabled: true, ...opts };
    object.traverse((o) => { if (o.isMesh) o.userData.target = t; });
    this.targets.push(t);
    return t;
  }

  addBlockers(meshes) { this.blockers.push(...meshes); }

  update() {
    if (!this.enabled) { this.current = null; this.ui.hint(''); return; }
    this.ray.setFromCamera(_c, this.camera);
    this.ray.far = 60;
    const objs = this.blockers.concat(this.targets.filter((t) => t.enabled && t.object.visible).map((t) => t.object));
    const hits = this.ray.intersectObjects(objs, true);
    let best = null;
    for (const h of hits) {
      if (!h.object.visible) continue;
      best = h; break;
    }
    this.lookDist = best ? best.distance : 60;
    const t = best && best.object.userData.target;
    this.current = t && t.enabled && best.distance <= t.range ? t : null;
    this.ui.hint(this.current ? this.current.hint() : '');
    if (this.current && this.input.hit('KeyE')) this.current.use();
  }
}
