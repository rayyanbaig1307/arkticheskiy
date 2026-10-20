import * as THREE from 'three';
import { chainCompile } from '../world/Atmos.js';
import { buildStandins } from './standins.js';
import { CH } from './Actions.js';
import { ANCHORS, PROPS, POINTS, ELBOW_EMPTY, WEAPONS } from './defs.js';
import { weaponTextures } from './textures.js';

// The gun in your hands. Everything here lives under the camera on its own layer (VIEW_LAYER) and
// is drawn by its own camera (narrower field of view, near plane 1 cm) in a pass of its own
// (core/Post.js addViewmodel): after ambient occlusion and depth of field, so neither touches it,
// with the scene's depth cleared so it never sinks into a wall you stand against, but with the
// scene's own lights and shadow maps, so a lamp, the moon through a door, a flare or the muzzle
// flash light it like anything else. That pass comes after the exposure, so its materials apply
// the exposure themselves (the same uniform), and before bloom and tone mapping like the rest.
//
// Each frame the rig is posed in layers:
//   the rig       sway (the gun lags your turns), bob (with your steps), breathing, the cold's
//                 shake, recoil (a springy kick back and up), sprinting, drawing and holstering
//   the gun       the hip pose (GRIP_R at a point low and right) blended to the aim pose (SIGHT on
//                 the line of sight) by how far you are aiming, plus the action's keyed offset
//   the parts     slide, bolt, charging handle, barrel, magazine, hammer, trigger, from the keyed
//                 channels and the gun's state (a slide locked back, a bolt left open)
//   the hands     each at a blend of two anchors (a grip, a magazine, a bolt knob, a point in the
//                 pouch), the forearm aimed back at an elbow below the view
//   the props     a stripper clip, a cartridge, a hand flare: in a hand, or set into the gun
//
// The lights the pass sees: three only gathers lights on a camera's layers, so every light in the
// scene is put on VIEW_LAYER too (checked every second, for lights added later). The light count
// is then the same in both passes, and the gun's shaders are the scene's.

export const VIEW_LAYER = 6;

const AN = Object.fromEntries(ANCHORS.list.map((n) => [n, ANCHORS.id(n)]));
const PR = Object.fromEntries(PROPS.list.map((n) => [n, PROPS.id(n)]));
const Z = new THREE.Vector3(0, 0, 1), YUP = new THREE.Vector3(0, 1, 0), XAX = new THREE.Vector3(1, 0, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _one = new THREE.Vector3(1, 1, 1), _sc = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
const smooth = (t) => t * t * (3 - 2 * t);

// a part by name inside a model: exact, or the name Blender makes unique (MAG.001 -> MAG001, MAG_pm)
function findPart(root, name, id = '') {
  const re = new RegExp(`^${name}(?:[._-].*|\\d+|${id})?$`, 'i');
  let hit = null;
  root.traverse((o) => { if (!hit && o !== root && re.test(o.name)) hit = o; });
  return hit;
}
const under = (o, p) => { for (let x = o; x; x = x.parent) if (x === p) return true; return false; };

// the average of a part's vertices at its far end along an axis, in the part's own frame
function extreme(part, axis, sign, band = 0.006) {
  part.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(part.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  let best = -Infinity;
  const pts = [];
  part.traverse((o) => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      const d = v.getComponent(axis) * sign;
      if (d > best + band) { best = d; pts.length = 0; }
      if (d >= best - band) pts.push(v.clone());
    }
  });
  const out = new THREE.Vector3();
  let n = 0;
  for (const p of pts) if (p.getComponent(axis) * sign >= best - band) { out.add(p); n++; }
  return n ? out.multiplyScalar(1 / n) : out;
}

// a part's bounds in its own frame
function localBox(part) {
  part.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(part.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3(), box = new THREE.Box3();
  part.traverse((o) => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m));
  });
  return box;
}

function anchorAt(parent, pos, dorsal) {
  const o = new THREE.Object3D();
  o.position.copy(pos);
  o.quaternion.setFromUnitVectors(YUP, _v1.set(...dorsal).normalize());
  parent.add(o);
  return o;
}

// the centre of a part's bounding box, in another object's frame
function centreIn(part, frame) {
  frame.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(part);
  return box.getCenter(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(frame.matrixWorld).invert());
}

// ---- one gun: its parts, their rest poses, the anchors the hands use, where its props go
class Gun {
  constructor(def, root, flashMats) {
    this.def = def;
    this.root = root;
    root.removeFromParent();
    root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    const id = def.id;
    const P = (n) => findPart(root, n, id);
    this.parts = {};
    this.rest = {};
    for (const n of ['MAG', 'SLIDE', 'BOLT', 'CHARGE', 'BARREL_BREAK', 'TRIGGER', 'HAMMER', 'SELECTOR', 'SHELL']) {
      const o = P(n);
      if (!o) continue;
      this.parts[n] = o;
      this.rest[n] = { p: o.position.clone(), q: o.quaternion.clone() };
    }
    this.rounds = this.parts.MAG ? findPart(this.parts.MAG, 'ROUNDS') : null;
    const box = new THREE.Box3().setFromObject(root);
    const fallback = (n, x, y, z) => { const o = P(n) || new THREE.Object3D(); if (!o.parent) { o.name = n; o.position.set(x, y, z); root.add(o); } return o; };
    this.muzzle = fallback('MUZZLE', 0, 0, box.min.z);
    this.eject = P('EJECT') || this.muzzle;
    const sight = fallback('SIGHT', 0, box.max.y, box.max.z - 0.05);
    this.gripR = fallback('GRIP_R', 0, box.min.y * 0.5, box.max.z * 0.5);
    this.gripL = P('GRIP_L') || this.gripR;
    root.updateMatrixWorld(true);
    this.sightP = new THREE.Vector3().setFromMatrixPosition(sight.matrixWorld);
    this.gripP = new THREE.Vector3().setFromMatrixPosition(this.gripR.matrixWorld);

    // the hands' anchors on this gun
    const A = (this.anchors = new Array(ANCHORS.list.length).fill(null));
    A[AN.gripR] = this.gripR; A[AN.gripL] = this.gripL;
    const { MAG, SLIDE, BOLT, CHARGE, BARREL_BREAK: BRK } = this.parts;
    // (the magazine is held where the gun says: the PM's by its base, the AKM's by its side)
    if (MAG) {
      const b = localBox(MAG), f = def.mag.grab || [0.5, 0, 0.5];
      A[AN.mag] = anchorAt(MAG, new THREE.Vector3(b.min.x + (b.max.x - b.min.x) * f[0], b.min.y + (b.max.y - b.min.y) * f[1], b.min.z + (b.max.z - b.min.z) * f[2]), def.mag.dorsal || [-0.4, -0.9, 0]);
    }
    if (SLIDE) A[AN.slide] = anchorAt(SLIDE, extreme(SLIDE, 2, 1).add(_v2.set(0, 0.010, -0.012)), [0, 1, 0.3]);
    if (BOLT) A[AN.bolt] = anchorAt(BOLT, extreme(BOLT, 0, 1).add(_v2.set(-0.009, 0, 0)), [0.5, 0.85, 0]);
    if (CHARGE) A[AN.charge] = anchorAt(CHARGE, extreme(CHARGE, 0, 1).add(_v2.set(-0.006, 0, 0)), [1, 0.3, 0]);
    if (BRK) {
      A[AN.barrel] = anchorAt(BRK, extreme(BRK, 1, 1), [0, 1, 0]);
      A[AN.breech] = under(this.eject, BRK) ? this.eject : anchorAt(BRK, extreme(BRK, 2, 1), [0, 1, 0]);
    }

    // where props go into this gun: the clip in its guide, a round down through the port, the
    // flare cartridge into the broken-open barrel (each from p0 to p1 as it is pushed home)
    this.place = {};
    const q0 = new THREE.Quaternion();
    if (id === 'mosin') {
      const guide = P('CLIP_GUIDE'), port = P('LOAD_PORT');
      const at = (o, v) => (o ? new THREE.Vector3().setFromMatrixPosition(o.matrixWorld) : new THREE.Vector3(...v));
      const c = at(guide, def.clipAt), p0 = at(port, def.portAt[0]), p1 = port ? p0.clone().add(_v2.set(0, -0.045, 0)) : new THREE.Vector3(...def.portAt[1]);
      this.place[PR.clip] = { parent: root, p0: c, p1: c.clone(), q: q0 };
      this.place[PR.round] = { parent: root, p0, p1, q: q0 };
    }
    if (BRK) {
      const p1 = this.parts.SHELL ? centreIn(this.parts.SHELL, BRK) : new THREE.Vector3().setFromMatrixPosition(this.eject.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(BRK.matrixWorld).invert()).add(_v2.set(0, 0, -0.035));
      this.place[PR.cart] = { parent: BRK, p0: p1.clone().add(_v2.set(0, 0, 0.08)), p1, q: q0 };
    }

    // the muzzle flash: a star seen from behind, two tongues of flame seen from the side
    this.flash = new THREE.Group();
    const s = def.flash.size;
    const star = new THREE.Mesh(new THREE.PlaneGeometry(s * 1.6, s * 1.6), flashMats.star);
    const side = new THREE.PlaneGeometry(s * 2.4, s);
    side.rotateY(Math.PI / 2); side.translate(0, 0, -s * 1.2);
    const s1 = new THREE.Mesh(side, flashMats.side), s2 = new THREE.Mesh(side, flashMats.side);
    s2.rotation.z = Math.PI / 2;
    this.flash.add(star, s1, s2);
    this.flash.visible = false;
    this.muzzle.add(this.flash);

    this.materials = new Set();
    root.traverse((o) => {
      o.layers.set(VIEW_LAYER);
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = true;
      if (o.parent !== this.flash) for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.materials.add(m);
    });
    this.magOut = this.rest.MAG ? new THREE.Vector3(0, -1, 0).applyQuaternion(this.rest.MAG.q) : null;
  }

  // the parts from the channels and the gun's state
  apply(v, st, proc) {
    const d = this.def, P = this.parts, R = this.rest;
    if (P.SLIDE) P.SLIDE.position.copy(R.SLIDE.p).addScaledVector(Z, Math.max(v[CH.slide], proc.cycle) * d.slideTravel);
    if (P.BOLT) {
      P.BOLT.position.copy(R.BOLT.p).addScaledVector(Z, v[CH.pull] * d.boltTravel);
      P.BOLT.quaternion.copy(R.BOLT.q).multiply(_q1.setFromAxisAngle(Z, v[CH.lift] * d.boltAngle));
    }
    if (P.CHARGE) P.CHARGE.position.copy(R.CHARGE.p).addScaledVector(Z, Math.max(v[CH.charge], proc.cycle) * d.chargeTravel);
    if (P.BARREL_BREAK) P.BARREL_BREAK.quaternion.copy(R.BARREL_BREAK.q).multiply(_q1.setFromAxisAngle(XAX, -v[CH.brk] * d.breakAngle));
    if (P.HAMMER) P.HAMMER.quaternion.copy(R.HAMMER.q).multiply(_q1.setFromAxisAngle(XAX, proc.hammer * (d.hammerCock || 0.6)));
    if (P.TRIGGER) P.TRIGGER.quaternion.copy(R.TRIGGER.q).multiply(_q1.setFromAxisAngle(XAX, -proc.trig * (d.triggerPull || 0.3)));
    if (P.SELECTOR) P.SELECTOR.quaternion.copy(R.SELECTOR.q).multiply(_q1.setFromAxisAngle(XAX, proc.sel));
    if (P.SHELL) P.SHELL.visible = st.chamber !== 0;
    if (this.rounds) this.rounds.visible = st.mag > 0;
    if (P.MAG) this.magPath(v[CH.mag], st);
  }

  // the magazine: rocked off its catch (the AKM), slid out along its own axis, then away to the
  // pouch with the hand (0 seated, 1 out, 2 away); hidden when it isn't in the gun or the hand
  magPath(m, st) {
    const d = this.def.mag, R = this.rest.MAG, P = this.parts.MAG;
    const rockAt = d.rockAt || 0;
    let rock = 1, out = 0;
    if (m < rockAt) rock = m / rockAt;
    else out = Math.min(1, (m - rockAt) / Math.max(1e-3, 1 - rockAt));
    const away = clamp(m - 1, 0, 1), aw = d.away;
    P.quaternion.copy(R.q).multiply(_q1.setFromAxisAngle(XAX, d.rock * rock));
    if (away > 0) P.quaternion.multiply(_q2.setFromEuler(_e.set(aw[3] * away, aw[4] * away, aw[5] * away, 'XYZ')));
    P.position.copy(R.p).addScaledVector(this.magOut, d.out * out).add(_v1.set(aw[0] * away, aw[1] * away, aw[2] * away));
    P.visible = m < 1.98 || st.magIn;
  }
}

// ---- an arm: its HAND frame, so the arm can be placed by where the hand must be
class Arm {
  constructor(root) {
    this.root = root;
    root.removeFromParent();
    root.position.set(0, 0, 0); root.quaternion.identity();
    root.updateMatrixWorld(true);
    const hand = findPart(root, 'HAND');
    this.handInv = hand ? new THREE.Matrix4().copy(hand.matrixWorld).invert() : new THREE.Matrix4();
    root.traverse((o) => { o.layers.set(VIEW_LAYER); if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.p = new THREE.Vector3(); this.q = new THREE.Quaternion();     // the hand, this frame (rig space)
  }
}

export class Viewmodel {
  constructor({ camera, scene, post = null, lighting = null }) {
    this.camera = camera; this.scene = scene; this.lighting = lighting;
    this.cam = new THREE.PerspectiveCamera(50, camera.aspect, 0.01, 12);
    this.cam.layers.set(VIEW_LAYER);
    camera.add(this.cam);
    this.root = new THREE.Group();
    this.root.name = 'Viewmodel';
    camera.add(this.root);
    this.rig = new THREE.Group();
    this.holder = new THREE.Group();
    this.rig.add(this.holder);
    this.root.add(this.rig);
    this.rig.visible = false;
    this.rigInv = new THREE.Matrix4();
    this.points = new Array(ANCHORS.list.length).fill(null);
    for (const [n, [x, y, z, dorsal]] of Object.entries(POINTS)) {
      this.points[AN[n]] = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromUnitVectors(YUP, new THREE.Vector3(...dorsal).normalize()), _one);
    }
    this.propGrab = new THREE.Matrix4();
    this.propPlace = new THREE.Matrix4();
    this.restR = AN.gripR; this.restL = AN.gripL;
    this.elbowR = new THREE.Vector3(); this.elbowL = new THREE.Vector3();
    // the frame's exposure and flash (Post's uniforms; the pass draws after them)
    const u = post?.exposure?.uniforms;
    this.uExp = u?.get?.('uExposure') || { value: 1 };
    this.uFlash = u?.get?.('uFlash') || { value: 0 };
    this.prepared = new WeakSet();
    this.envMats = []; this.lamps = [];
    // procedural state
    this.sway = new THREE.Vector3(); this.swayR = new THREE.Vector3();
    this.kickX = new Float32Array(5); this.kickV = new Float32Array(5);      // back, rise, roll, yaw, up
    this.breathPh = 0; this.shakeT = 0; this.flashT = 0;
    this.held = { w: 0, rp: new THREE.Vector3(), rq: new THREE.Quaternion(), lp: new THREE.Vector3(), lq: new THREE.Quaternion() };
    this.clipFull = true;
    this.lit = false;
    this.gun = null;
    // the flash's and the burning flare's materials (additive, unlit)
    const tex = weaponTextures();
    const add = (map, color) => new THREE.MeshBasicMaterial({ map, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.flashMats = { star: add(tex.flashStar, new THREE.Color(4, 2.6, 1.3)), side: add(tex.flashSide, new THREE.Color(4, 2.6, 1.3)) };
    this.glowMat = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(9, 1.2, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    for (const m of [this.flashMats.star, this.flashMats.side, this.glowMat]) this.prep(m, false);
    this.useModels(buildStandins());
    post?.addViewmodel?.(scene, this.cam);
    this.lightScan = 0;
    this.scanLights();
  }

  // a viewmodel material: the scene's shadows and fog (Lighting.prep), then the exposure, which the
  // viewmodel pass comes after
  prep(m, lit = true) {
    if (this.prepared.has(m)) return;
    this.prepared.add(m);
    if (lit) this.lighting?.prep(m);
    if (lit && m.isMeshStandardMaterial) this.envMats.push(m);
    const exp = this.uExp, flash = this.uFlash;
    chainCompile(m, (shader) => {
      shader.uniforms.uVmExposure = exp;
      shader.uniforms.uVmFlash = flash;
      // (the last chunk of a lit or basic material; sprites end with the fog)
      const at = shader.fragmentShader.includes('#include <dithering_fragment>') ? '#include <dithering_fragment>' : '#include <fog_fragment>';
      shader.fragmentShader = 'uniform float uVmExposure, uVmFlash;\n' + shader.fragmentShader.replace(
        at, `${at}\n  gl_FragColor.rgb = gl_FragColor.rgb * uVmExposure + uVmFlash;`);
    }, 'vmexp');
  }

  // models: { weapons: { pm, akm, mosin, flaregun, handflare }, arms: { R, L }, props: { clip, round, cart } }
  // (the stand-ins now; weapons.glb and arms.glb through Weapons.load)
  useModels({ weapons, arms, props }) {
    const old = this.guns;
    this.guns = {};
    for (const id of Object.keys(WEAPONS)) {
      const root = weapons[id] || old?.[id]?.root;
      if (!root) continue;
      if (old?.[id] && old[id].root !== root) old[id].root.removeFromParent();
      const g = new Gun(WEAPONS[id], root, this.flashMats);
      for (const m of g.materials) this.prep(m);
      g.root.visible = false;
      this.holder.add(g.root);
      this.guns[id] = g;
    }
    const prepAll = (root) => root.traverse((o) => { o.layers.set(VIEW_LAYER); if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; for (const m of [o.material].flat()) this.prep(m); } });
    // (the arms' materials too: the pass's exposure and reflections, like the guns')
    if (arms?.R) { this.armR?.root.removeFromParent(); this.armR = new Arm(arms.R); prepAll(this.armR.root); this.rig.add(this.armR.root); }
    if (arms?.L) { this.armL?.root.removeFromParent(); this.armL = new Arm(arms.L); prepAll(this.armL.root); this.rig.add(this.armL.root); }
    this.props = this.props || new Array(PROPS.list.length).fill(null);
    const setProp = (id, root, hand, inHand) => {
      if (!root) return;
      this.props[id]?.root.removeFromParent();
      root.removeFromParent();
      root.position.set(0, 0, 0); root.quaternion.identity();
      root.updateMatrixWorld(true);
      prepAll(root);
      root.visible = false;
      this.rig.add(root);
      const grab = findPart(root, 'GRAB') || findPart(root, 'GRIP_L');
      const rounds = findPart(root, 'ROUNDS');
      // the objects from the prop's root down to its grab point (their local matrices, chained)
      const chain = [];
      for (let o = grab; o && o !== root; o = o.parent) chain.unshift(o);
      this.props[id] = { root, hand, inHand, grab, chain, rounds, roundsRest: rounds ? rounds.position.clone() : null };
    };
    const m = (x, y, z, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(YUP, ry), _one);
    setProp(PR.clip, props?.clip, 'R', m(-0.012, 0.03, -0.06));
    setProp(PR.round, props?.round, 'R', m(-0.005, 0.02, -0.065));
    setProp(PR.cart, props?.cart, 'L', m(0.005, 0.02, -0.07));
    // the hand flare sits in the left fist, its burning end out past the thumb
    const hf = weapons.handflare;
    if (hf) {
      const grip = findPart(hf, 'GRIP_L');
      hf.updateMatrixWorld(true);
      const gp = grip ? new THREE.Vector3().setFromMatrixPosition(grip.matrixWorld) : new THREE.Vector3();
      const q = new THREE.Quaternion().setFromAxisAngle(YUP, -Math.PI / 2);
      const inHand = new THREE.Matrix4().compose(gp.clone().applyQuaternion(q).negate(), q, _one);
      setProp(PR.flare, hf, 'L', inHand);
      const f = this.props[PR.flare];
      f.cap = findPart(hf, 'CAP');
      f.tip = findPart(hf, 'MUZZLE') || hf;
      if (!this.glow) { this.glow = new THREE.Sprite(this.glowMat); this.glow.layers.set(VIEW_LAYER); this.glow.scale.setScalar(0.22); }
      f.tip.add(this.glow);
      this.glow.visible = false;
    }
  }

  // every light on the viewmodel's layer, so its pass is lit by them (and counts as many)
  scanLights() {
    this.lamps.length = 0;
    // (not the flashlight: it sits at your eye, and lit from a hand's breadth the gun goes white)
    this.scene.traverse((o) => {
      if (!o.isLight) return;
      if (o.userData.noViewmodel) { o.layers.disable(VIEW_LAYER); return; }
      o.layers.enable(VIEW_LAYER);
      if (o.isPointLight || o.isSpotLight) this.lamps.push(o);
    });
  }

  // what the gun reflects (a room's probe aboard, else a neutral room) and how strongly: set each
  // frame from how much lamplight is around you, so steel reads in a lit room and goes nearly
  // black in the dark, as it should, but never a flat cut-out
  setEnv(tex, k) {
    for (const m of this.envMats) {
      if (m.envMap !== tex) { if (!!m.envMap !== !!tex) m.needsUpdate = true; m.envMap = tex; }
      m.envMapIntensity = k;
    }
  }
  // the lamplight at a point (point and spot lights; roughly candela over distance squared)
  lightAt(p, skip = null) {
    let s = 0;
    for (const l of this.lamps) {
      if (l === skip || !l.visible || !(l.intensity > 0) || !l.parent) continue;
      l.getWorldPosition(_v5);
      if (l.isSpotLight) {
        // (only inside its cone)
        l.target.getWorldPosition(_v4).sub(_v5).normalize();
        if (_v3.subVectors(p, _v5).normalize().dot(_v4) < Math.cos(l.angle)) continue;
      }
      s += l.intensity / Math.max(1, _v5.distanceToSquared(p));
    }
    return s;
  }

  // a shot: the springs kick (back, muzzle up, a roll and a turn either way)
  kick(r, scale = 1) {
    const w = 26, sgn = Math.random() < 0.5 ? -1 : 1;
    this.kickV[0] += r.back * w * scale;
    this.kickV[1] += r.rise * w * scale * (0.85 + Math.random() * 0.3);
    this.kickV[2] += r.roll * w * scale * sgn;
    this.kickV[3] += r.roll * 0.6 * w * scale * (Math.random() * 2 - 1);
    this.kickV[4] += (r.up || 0) * w * scale;
  }

  showFlash(def) {
    const g = this.gun;
    if (!g) return;
    const k = 0.75 + Math.random() * 0.5, c = def.flash.color;
    this.flashMats.star.color.setRGB(c[0] * k, c[1] * k, c[2] * k);
    this.flashMats.side.color.copy(this.flashMats.star.color);
    g.flash.visible = true;
    g.flash.rotation.z = Math.random() * Math.PI * 2;
    g.flash.scale.setScalar(0.8 + Math.random() * 0.45);
    this.flashT = 0.045;
  }

  // world-space points the effects come from (this frame's pose)
  muzzleWorld(out) { return out.setFromMatrixPosition((this.gun?.muzzle || this.root).matrixWorld); }
  ejectWorld(out) { return out.setFromMatrixPosition((this.gun?.eject || this.root).matrixWorld); }
  gunQuatWorld(out) { return out.setFromRotationMatrix(this.holder.matrixWorld); }
  flareTipWorld(out) { const f = this.props[PR.flare]; return out.setFromMatrixPosition((f?.tip || this.root).matrixWorld); }

  // remember the hands where they are: an interrupted action fades from here to the new pose
  freeze() {
    const h = this.held;
    h.w = 1;
    if (this.armR) { h.rp.copy(this.armR.p); h.rq.copy(this.armR.q); }
    if (this.armL) { h.lp.copy(this.armL.p); h.lq.copy(this.armL.q); }
  }

  // s: { gun, st, pose, aim, up, sprint, bob, bobAmp, running, dyaw, dpitch, breath, cold,
  //      armR, armL, restR, restL, proc: { cycle, hammer, trig, sel } }
  update(dt, s) {
    const gun = s.gun ? this.guns[s.gun] : null;
    if (gun !== this.gun) {
      if (this.gun) { this.gun.root.visible = false; this.gun.flash.visible = false; }
      if (gun) gun.root.visible = true;
      this.gun = gun;
    }
    if ((this.lightScan -= dt) <= 0) { this.lightScan = 1; this.scanLights(); }
    const show = (!!gun && s.up > 0.001) || s.armL;
    this.rig.visible = show;
    if (this.flashT > 0 && (this.flashT -= dt) <= 0 && this.gun) this.gun.flash.visible = false;
    if (!show) return;

    const def = gun ? gun.def : null, v = s.pose.v, aim = s.aim;
    // the view: the weapon's own field of view (narrower when aiming), the scene's aspect
    const fov = def ? def.vmFov[0] + (def.vmFov[1] - def.vmFov[0]) * aim : 50;
    if (Math.abs(this.cam.fov - fov) > 1e-3 || this.cam.aspect !== this.camera.aspect) {
      this.cam.fov = fov; this.cam.aspect = this.camera.aspect; this.cam.updateProjectionMatrix();
    }

    // ---- the rig's procedural motion
    const calm = 1 - 0.75 * aim;
    const idt = 1 / Math.max(dt, 1e-3);
    const wy = clamp(s.dyaw * idt, -8, 8), wp = clamp(s.dpitch * idt, -8, 8);
    this.sway.x = damp(this.sway.x, wy * 0.006 * calm, 9, dt);
    this.sway.y = damp(this.sway.y, -wp * 0.005 * calm, 9, dt);
    this.swayR.x = damp(this.swayR.x, -wp * 0.012 * calm, 9, dt);
    this.swayR.y = damp(this.swayR.y, -wy * 0.016 * calm, 9, dt);
    this.swayR.z = damp(this.swayR.z, wy * 0.02 * calm, 9, dt);
    // the recoil springs (a little bounce: damping 0.55), two steps a frame
    const w = 26, z2 = 2 * 0.55 * w, h = dt * 0.5;
    for (let k = 0; k < 2; k++) for (let i = 0; i < 5; i++) {
      this.kickV[i] += (-w * w * this.kickX[i] - z2 * this.kickV[i]) * h;
      this.kickX[i] += this.kickV[i] * h;
    }
    const K = this.kickX;
    const b = s.bob, ba = s.bobAmp * calm * (s.running ? 1.4 : 1);
    this.breathPh += dt * (1.35 + s.breath * 2.4);
    const br = (0.0035 + s.breath * 0.006) * (1 - 0.4 * aim);
    const c = s.cold;
    const t = (this.shakeT += dt);
    const up = smooth(clamp(s.up, 0, 1)), down = 1 - up, sp = smooth(clamp(s.sprint, 0, 1));
    const low = def ? def.lowered : null, run = def ? def.sprint : null;
    const px = this.sway.x + Math.cos(b) * 0.011 * ba + (Math.sin(t * 41) * 0.6 + Math.sin(t * 67) * 0.4) * 0.003 * c
      + (run ? run.pos[0] * sp : 0) + (low ? low.pos[0] * down : 0);
    const py = this.sway.y - Math.abs(Math.sin(b)) * 0.009 * ba + Math.sin(this.breathPh) * br + (Math.sin(t * 53 + 1) * 0.6 + Math.sin(t * 31) * 0.4) * 0.003 * c
      + K[4] + (run ? run.pos[1] * sp : 0) + (low ? low.pos[1] * down : 0);
    const pz = K[0] + (run ? run.pos[2] * sp : 0) + (low ? low.pos[2] * down : 0);
    const rx = this.swayR.x + Math.sin(b * 2) * 0.012 * ba + Math.sin(this.breathPh - 0.6) * br * 1.6 + (Math.sin(t * 47) + Math.sin(t * 29 + 2) * 0.5) * 0.008 * c
      + K[1] + (run ? run.rot[0] * sp : 0) + (low ? low.rot[0] * down : 0);
    const ry = this.swayR.y + Math.sin(this.breathPh * 0.5) * br * 0.6 + Math.sin(t * 43 + 3) * 0.008 * c + K[3] + (run ? run.rot[1] * sp : 0) + (low ? low.rot[1] * down : 0);
    const rz = this.swayR.z + Math.cos(b) * 0.025 * ba + Math.sin(t * 37 + 2) * 0.014 * c + K[2] + (run ? run.rot[2] * sp : 0) + (low ? low.rot[2] * down : 0);
    // about the hand (the hip grip, or the sight when aiming)
    const pivot = _v1;
    if (def) pivot.set(def.hip.pos[0] * (1 - aim), def.hip.pos[1] * (1 - aim), def.hip.pos[2] * (1 - aim) - def.eye * aim);
    else pivot.set(0, -0.2, -0.3);
    this.rig.quaternion.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    this.rig.position.copy(pivot).applyQuaternion(this.rig.quaternion).negate().add(pivot).add(_v2.set(px, py, pz));

    // ---- the gun: hip pose to aim pose, plus the action's offset
    if (gun) {
      const qa = _q1.setFromEuler(_e.set(v[CH.rx], v[CH.ry], v[CH.rz], 'YXZ'));
      const qh = _q2.setFromEuler(_e.set(def.hip.rot[0], def.hip.rot[1], def.hip.rot[2], 'YXZ')).multiply(qa);
      const ph = _v2.set(def.hip.pos[0] + v[CH.px], def.hip.pos[1] + v[CH.py], def.hip.pos[2] + v[CH.pz]).sub(_v3.copy(gun.gripP).applyQuaternion(qh));
      const pa = _v4.set(v[CH.px], v[CH.py], v[CH.pz] - def.eye).sub(_v3.copy(gun.sightP).applyQuaternion(qa));
      this.holder.position.copy(ph).lerp(pa, aim);
      this.holder.quaternion.copy(qh).slerp(qa, aim);
      gun.apply(v, s.st, s.proc);
    }
    this.root.updateMatrixWorld(true);
    this.rigInv.copy(this.rig.matrixWorld).invert();

    // ---- props set into the gun (their grab point is an anchor the hand follows)
    const pid = v[CH.prop] | 0, prop = this.props[pid];
    const place = gun && prop ? gun.place[pid] : null;
    if (place) {
      _v3.copy(place.p0).lerp(place.p1, v[CH.push]);
      this.propPlace.multiplyMatrices(this.rigInv, place.parent.matrixWorld).multiply(_m1.compose(_v3, place.q, _one));
      if (prop.rounds) {
        prop.rounds.position.copy(prop.roundsRest).addScaledVector(YUP, -v[CH.push] * (def.clipPush || 0.06));
        prop.rounds.updateMatrix();
      }
      this.propGrab.copy(this.propPlace);
      if (prop.grab) this.propGrab.multiply(this.grabChain(prop));
    }

    // ---- the hands
    const hR = gun ? def.elbowR : null, hL = gun ? def.elbowL : null;
    if (hR) this.elbowR.fromArray(hR[0]).lerp(_v3.fromArray(hR[1]), aim);
    if (hL) this.elbowL.fromArray(hL[0]).lerp(_v3.fromArray(hL[1]), aim); else this.elbowL.fromArray(ELBOW_EMPTY);
    this.restR = s.restR; this.restL = s.restL;
    const held = this.held;
    if (held.w > 0) held.w = Math.max(0, held.w - dt / 0.2);
    const hw = smooth(held.w);
    if (this.armR) {
      this.armR.root.visible = s.armR;
      if (s.armR) {
        this.hand(s.pose.a[CH.rh], s.pose.b[CH.rh], s.pose.w[CH.rh], this.elbowR, this.armR);
        if (hw > 0) { this.armR.p.lerp(held.rp, hw); this.armR.q.slerp(held.rq, hw); }
        this.placeArm(this.armR);
      }
    }
    if (this.armL) {
      this.armL.root.visible = s.armL;
      if (s.armL) {
        this.hand(s.pose.a[CH.lh], s.pose.b[CH.lh], s.pose.w[CH.lh], this.elbowL, this.armL);
        if (hw > 0) { this.armL.p.lerp(held.lp, hw); this.armL.q.slerp(held.lq, hw); }
        this.placeArm(this.armL);
      }
    }

    // ---- the props in hand (or set into the gun, by pa)
    for (let i = 1; i < this.props.length; i++) {
      const p = this.props[i];
      if (!p) continue;
      const arm = p.hand === 'R' ? this.armR : this.armL;
      const on = i === pid && !!arm && arm.root.visible;
      p.root.visible = on;
      if (!on) continue;
      _m2.compose(arm.p, arm.q, _one).multiply(p.inHand);
      const pa = place ? v[CH.pa] : 0;
      if (pa > 0.001) {
        _m2.decompose(_v3, _q1, _sc);
        this.propPlace.decompose(_v4, _q2, _sc);
        _v3.lerp(_v4, pa); _q1.slerp(_q2, pa);
        p.root.position.copy(_v3); p.root.quaternion.copy(_q1);
      } else _m2.decompose(p.root.position, p.root.quaternion, _sc);
      if (p.rounds) p.rounds.visible = i !== PR.clip || this.clipFull;
      if (p.cap) p.cap.visible = !this.lit;
      p.root.updateMatrixWorld(true);
    }
    if (this.glow) {
      this.glow.visible = this.lit && this.props[PR.flare]?.root.visible;
      if (this.glow.visible) this.glow.scale.setScalar(0.18 + 0.06 * Math.sin(t * 31) * Math.sin(t * 17 + 1) + Math.random() * 0.03);
    }
  }

  // the GRAB point of a prop relative to the prop's root
  grabChain(prop) {
    _m3.identity();
    for (const o of prop.chain) { o.updateMatrix(); _m3.multiply(o.matrix); }
    return _m3;
  }

  // a hand between anchors a and b (w of the way), the forearm aimed at the elbow
  hand(a, b, w, elbow, out) {
    this.anchor(a, _m1).decompose(_v3, _q1, _sc);
    this.anchor(b, _m2).decompose(_v4, _q2, _sc);
    out.p.copy(_v3).lerp(_v4, w);
    _q1.slerp(_q2, w);
    const zf = _v3.copy(elbow).sub(out.p).normalize();
    const yb = _v4.copy(YUP).applyQuaternion(_q1);
    yb.addScaledVector(zf, -yb.dot(zf));
    if (yb.lengthSq() < 1e-6) yb.copy(XAX).addScaledVector(zf, -zf.x);
    yb.normalize();
    const xr = _v5.crossVectors(yb, zf);
    out.q.setFromRotationMatrix(_m3.makeBasis(xr, yb, zf));
  }

  placeArm(arm) {
    _m1.compose(arm.p, arm.q, _one).multiply(arm.handInv);
    _m1.decompose(arm.root.position, arm.root.quaternion, _sc);
    arm.root.updateMatrixWorld(true);
  }

  // an anchor's frame in the rig
  anchor(id, out) {
    if (id === AN.restL) id = this.restL;
    else if (id === AN.restR) id = this.restR;
    if (id === AN.prop) return out.copy(this.propGrab);
    const pt = this.points[id];
    if (pt) return out.copy(pt);
    const o = this.gun ? this.gun.anchors[id] : null;
    if (o) return out.multiplyMatrices(this.rigInv, o.matrixWorld);
    return out.copy(this.points[id === AN.gripR || id === AN.bolt || id === AN.charge ? AN.idleR : AN.idleL]);
  }
}
