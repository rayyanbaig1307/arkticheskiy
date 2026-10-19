import * as THREE from 'three';
import { tryGLB, loadGLB } from '../core/Assets.js';
import { NO_REFLECT } from '../world/Reflection.js';
import { damp, angleDiff } from '../core/util.js';

// The people aboard, modelled and animated in Blender (tools/blender/make_people.py on MPFB's
// game-engine rig, tools/blender/make_anims.py for the clips). Every body shares the rig, so every
// clip plays on every body: rotations go over as they are, and the pelvis's movement is scaled to
// each body's hip height (retarget()). Adapted from The Ashwood Tapes' People.js.
//
//   Person   one person in boat space: model, mixer, crossfades, lip flap (the 'talk' shape key),
//            feet kept on the deck (the boat's collision floor), the binoculars when they're used,
//            a breath point for the steam (Weather.js)

export const NAMES = ['captain', 'bosun', 'deckhand', 'engineer', 'cook', 'soldier1', 'soldier2', 'soldier3', 'soldier4'];
export const WALK_SPEED = 1.14;   // m/s the walk clip covers at timeScale 1
export const PATROL_SPEED = 0.66; // and the patrol clip
const _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

export async function loadPeople(onProgress) {
  const anims = await loadGLB('models/people/anims.glb');
  let refPelvis = null;
  anims.scene.traverse((o) => { if (o.name === 'pelvis' && !refPelvis) refPelvis = o.position.clone(); });
  const clips = Object.fromEntries(anims.animations.map((c) => [c.name, c]));
  const models = {};
  let n = 0;
  await Promise.all(NAMES.map(async (name) => {
    models[name] = await tryGLB(`models/people/${name}.glb`);
    onProgress?.(++n / NAMES.length);
  }));
  return { clips, refPelvis, models };
}

function retarget(clip, refPelvis, pelvis) {
  const k = pelvis.position.z / refPelvis.z;         // (the rig's root is z-up: z is the hip height)
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

// MakeHuman's materials come out alpha-blended: everything opaque, cut out where its texture is clear
function dress(model, lighting) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.frustumCulled = false;                       // (skinned: the bind-pose bounds lie once posed)
    o.layers.set(NO_REFLECT);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const n = (m.name || '').toLowerCase();
      m.transparent = false; m.depthWrite = true; m.opacity = 1;
      if (m.map) m.alphaTest = Math.max(m.alphaTest, 0.5);
      if (/hair|short0|eyebrow|eyelash/.test(n)) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; m.roughness = 0.7; }
      else if (/coat|skirt|apron|fur|knit|scarf/.test(n)) { m.side = THREE.DoubleSide; m.roughness = Math.max(m.roughness, 0.8); }
      else if (/low-poly/.test(n)) m.roughness = 0.15;
      else if (/body|skin|base/.test(n)) { m.roughness = Math.max(m.roughness, 0.55); }
      else { m.roughness = Math.max(m.roughness, 0.7); m.metalness = Math.min(m.metalness, 0.15); }
      m.envMapIntensity = 0.7;
      lighting?.prep(m);
    }
  });
}

// a pair of binoculars, made here (black body, two barrels), carried in the right hand
function binocularsMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5, metalness: 0.2 });
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.15, 12), mat);
    b.rotation.x = Math.PI / 2; b.position.set(s * 0.034, 0, 0);
    g.add(b);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.05), mat);
  g.add(bridge);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.layers.set(NO_REFLECT); } });
  return g;
}

export class Person {
  constructor(name, gltf, data, ctx) {
    this.name = name; this.ctx = ctx;
    this.root = new THREE.Group(); this.root.name = `person:${name}`;
    this.model = gltf.scene;
    this.model.rotation.y = Math.PI;               // (MPFB's people face +z in glTF; ours face -z, the bow)
    this.root.add(this.model);
    dress(this.model, ctx.lighting);
    let pelvis = null, rig = null;
    this.model.traverse((o) => {
      if (o.name === 'pelvis' && !pelvis) pelvis = o;
      if (o.userData && o.userData.person) rig = o;
    });
    this.info = rig?.userData || {};
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [k, c] of Object.entries(data.clips)) this.actions[k] = this.mixer.clipAction(retarget(c, data.refPelvis, pelvis));
    this.morphs = [];
    this.model.traverse((o) => { if (o.isMesh && o.morphTargetDictionary && o.morphTargetDictionary.talk !== undefined) this.morphs.push([o, o.morphTargetDictionary.talk]); });
    // the binoculars, in the right hand while that clip plays
    this.binos = binocularsMesh();
    this.binos.visible = false;
    const hand = this.bones.hand_r;
    if (hand) { hand.add(this.binos); this.binos.position.set(-0.02, 0.09, -0.06); this.binos.rotation.set(0.2, 0, 1.4); }
    // a capsule for the use ray (invisible)
    this.hit = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 0.9;
    this.root.add(this.hit);
    this.clip = null; this.talking = false; this.mouth = 0; this.t = Math.random() * 10;
    this.yaw = 0; this.speed = 0; this.vis = true;
    this.mouthLocal = new THREE.Vector3(...(this.info.mouth || [0, 1.62, -0.1]));
    this.small = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const n = ((o.material && o.material.name) || '') + ' ' + o.name;
      if (/low-poly|eyebrow|eyelash|teeth|badge|buckle|mouth/i.test(n)) { this.small.push(o); o.castShadow = false; }
      else if (/hat|cap|glove|belt|hair|short0|scarf/i.test(n)) o.castShadow = false;
    });
    this.detail = true;
  }

  // at boat-space (x, y, z), facing yaw (0 faces -z, the bow)
  place(p, yaw = 0) { this.root.position.copy(p); this.yaw = yaw; this.root.rotation.y = yaw; return this; }

  play(name, fade = 0.45, timeScale = 1) {
    const a = this.actions[name]; if (!a) return this;
    a.timeScale = timeScale;
    if (this.clip === name) return this;
    const prev = this.actions[this.clip];
    a.reset().setEffectiveWeight(1).play();
    if (prev) prev.crossFadeTo(a, fade, false);
    this.clip = name;
    this.binos.visible = name === 'binoculars';
    return this;
  }

  // turn toward a boat-space point (smoothly)
  turnTo(x, z, dt, rate = 4) {
    const want = Math.atan2(-(x - this.root.position.x), -(z - this.root.position.z));
    this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * rate);
    this.root.rotation.y = this.yaw;
  }

  // where its breath comes out (world space): just in front of the face
  mouthWorld(out = new THREE.Vector3()) {
    const head = this.bones.head;
    if (!head) return this.root.localToWorld(out.copy(this.mouthLocal));
    head.getWorldPosition(out);
    this.root.getWorldQuaternion(_q);
    return out.add(_w.set(0, 0.02, -0.13).applyQuaternion(_q));
  }

  // the small parts go past a few metres (they're a draw call each)
  setDetail(on) { if (on === this.detail) return; this.detail = on; for (const o of this.small) o.visible = on; }

  update(dt) {
    this.t += dt;
    this.mixer.update(dt);
    const want = this.talking ? Math.max(0, Math.sin(this.t * 13) * 0.6 + Math.sin(this.t * 7.3 + 1) * 0.4) * (Math.sin(this.t * 1.1) > -0.6 ? 1 : 0) : 0;
    this.mouth = damp(this.mouth, want, 18, dt);
    for (const [o, i] of this.morphs) o.morphTargetInfluences[i] = this.mouth * 0.8;
  }
}
void _m;
