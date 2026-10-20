import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { NO_REFLECT } from '../world/Reflection.js';

// Story props made of the creatures' models, in the world (not the boat's frame, where the
// creatures live): the bear torn open on a floe, the figure standing on the ice. Each plays one
// clip (or holds a moment of it); the chapter removes it when it is done.
//
//   const p = puppet(d, 'bear', worldPos, yaw, 'death', { at: 2.4 })      // the last pose of its death
//   const f = puppet(d, 'turned_c', worldPos, yaw, 't_idle', { loop: true })

export function puppet(d, kind, pos, yaw, clipName, o = {}) {
  const data = d.h.enemies?.data?.[kind];
  if (!data) return null;
  const model = cloneSkinned(data.scene);
  const root = new THREE.Group();
  root.add(model);
  if (kind !== 'bear') model.rotation.y = Math.PI;           // (MPFB's people face +z)
  root.position.copy(pos); root.rotation.y = yaw;
  model.traverse((m) => {
    if (!m.isMesh) return;
    m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.layers.set(NO_REFLECT);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mm of mats) if (/Ice_growth|low-poly/i.test(mm.name)) { mm.emissiveIntensity = Math.max(mm.emissiveIntensity, 1.4); }
  });
  d.ctx.scene.add(root);
  const mixer = new THREE.AnimationMixer(model);
  const clip = data.clips.find((c) => c.name === clipName) || data.clips[0];
  const a = mixer.clipAction(clip);
  if (!o.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  a.play();
  if (o.at != null) { mixer.setTime(Math.min(o.at, clip.duration - 0.01)); a.paused = true; }
  else mixer.update(0);
  const p = {
    root, mixer, kind,
    update(dt) { if (!a.paused) mixer.update(dt); },
    remove() { d.ctx.scene.remove(root); const i = d.puppets.indexOf(p); if (i >= 0) d.puppets.splice(i, 1); },
  };
  (d.puppets || (d.puppets = [])).push(p);
  return p;
}
