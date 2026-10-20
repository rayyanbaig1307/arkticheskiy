import * as THREE from 'three';

// Where a shot goes. Bullets are hitscan: one ray from the eye, through the world's
// raycastShot(origin, dir, range) callback (CONTRACTS.md), which answers
//   { point, normal, distance, surface, target, object? } or null
// surface: 'flesh' | 'ice' | 'metal' | 'concrete' | 'snow' | 'wood'; target: an enemy with
// target.damage(amount, point, dir, weaponId); object (optional): the Object3D struck, so a hole
// in the boat's deck rides along with her.
//
// The ray leaves along the line of sight, spread in a cone: wide from the hip, tight on the
// sights, wider again when you walk, run, jump or shiver, narrower crouched; the AKM's grows with
// every round of a burst. Aimed, the line of sight is the gun's own sight line, so whatever the
// breath and the cold do to the sights, the bullet goes where they point.
//
// makeRaycastShot(meshes) is a stand-in world for testing: a raycaster over a list of meshes,
// surfaces from userData.surface (or a guess from the names), targets from userData.enemy or any
// object with a damage() method.

const UP = new THREE.Vector3(0, 1, 0), _r = new THREE.Vector3(), _u = new THREE.Vector3();

// dir: a direction within `spread` radians of `fwd` (uniform over the disc of the cone)
export function spreadDir(fwd, spread, out) {
  _r.crossVectors(fwd, UP);
  if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
  _r.normalize();
  _u.crossVectors(_r, fwd).normalize();
  const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt(Math.random());
  return out.copy(fwd).addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();
}

// the cone for a shot from a weapon, given how you stand
export function spreadFor(def, { aim = 0, moving = false, running = false, airborne = false, crouched = false, cold = 0, bloom = 0 }) {
  let s = def.spread + (def.aimSpread - def.spread) * aim;
  if (running) s *= 2.6; else if (moving) s *= 1.7;
  if (airborne) s *= 2.5;
  if (crouched) s *= 0.75;
  return s * (1 + cold * 1.5) + bloom;
}

// full damage to half the range, falling off to `falloff` of it at the range
export function damageAt(def, distance) {
  const half = def.range * 0.5;
  if (distance <= half) return def.damage;
  const k = Math.min(1, (distance - half) / half);
  return def.damage * (1 + ((def.falloff ?? 0.6) - 1) * k);
}

const SURF = [
  [/snow|drift/i, 'snow'], [/ice|berg|floe|frost/i, 'ice'], [/wood|plank|crate|door|timber|log/i, 'wood'],
  [/concrete|stone|brick|bunker|cement|rock/i, 'concrete'], [/flesh|body|bear|turned|people|crew|corpse|skin/i, 'flesh'],
];
export function surfaceOf(object) {
  for (let o = object; o; o = o.parent) {
    if (o.userData?.surface) return o.userData.surface;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m?.userData?.surface) return m.userData.surface;
  }
  const names = `${object.name} ${(Array.isArray(object.material) ? object.material[0] : object.material)?.name || ''} ${object.parent?.name || ''}`;
  for (const [re, s] of SURF) if (re.test(names)) return s;
  return 'metal';
}

export function targetOf(object) {
  for (let o = object; o; o = o.parent) {
    const e = o.userData?.enemy;
    if (e && typeof e.damage === 'function') return e;
    const t = o.userData?.target;
    if (t && typeof t.damage === 'function') return t;
    if (typeof o.damage === 'function') return o;
  }
  return null;
}

// a raycastShot over a list of meshes (for testing; the game's comes from the world). The result
// object is reused: copy what you keep.
export function makeRaycastShot(meshes = []) {
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  ray.layers.enableAll();
  const hits = [], nm = new THREE.Matrix3();
  const res = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'metal', target: null, object: null };
  const fn = (origin, dir, range) => {
    if (!fn.meshes.length) return null;
    ray.set(origin, dir);
    ray.far = range;
    hits.length = 0;
    ray.intersectObjects(fn.meshes, true, hits);
    let h = null;
    for (const x of hits) if (x.object.visible) { h = x; break; }
    if (!h) return null;
    res.point.copy(h.point);
    res.distance = h.distance;
    if (h.face) res.normal.copy(h.face.normal).applyMatrix3(nm.getNormalMatrix(h.object.matrixWorld)).normalize();
    else res.normal.copy(dir).negate();
    if (res.normal.dot(dir) > 0) res.normal.negate();
    res.object = h.object;
    res.surface = surfaceOf(h.object);
    res.target = targetOf(h.object);
    return res;
  };
  fn.meshes = meshes;
  return fn;
}
