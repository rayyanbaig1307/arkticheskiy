import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Stand-in models for the first-person weapons and arms, built in code until weapons.glb and
// arms.glb exist (tools/blender/make_weapons.py). They follow the same contract (CONTRACTS.md) so
// the code that drives them drives the real models unchanged:
//
//   roots WPN_pm, WPN_mosin, WPN_akm, WPN_flaregun, WPN_handflare; ARM_R, ARM_L
//   moving parts MAG, SLIDE, BOLT, CHARGE, BARREL_BREAK, TRIGGER, HAMMER (and SELECTOR on the AKM,
//   CAP on the hand flare, SHELL in the flare pistol's chamber, ROUNDS: the top round of a magazine)
//   empties MUZZLE, EJECT, SIGHT (on the sight line at the rear sight), GRIP_R, GRIP_L; HAND (arms)
//
// Conventions (three's axes; Blender's are the same with -Y forward exported as -Z): the barrel
// points along -Z, +Y is up, +X is the shooter's right, metres. A part's origin is its pivot: the
// SLIDE, CHARGE and BOLT slide along +Z (back), the BOLT turns about Z (handle up), the
// BARREL_BREAK, HAMMER, TRIGGER and SELECTOR turn about X, the MAG slides out along its own -Y.
// A hand frame (HAND, GRIP_R, GRIP_L) has +Y out of the back of the hand; the forearm runs back
// along +Z of the arm.
//
// Each part is a handful of boxes and cylinders merged into one mesh per material, so a gun costs
// about a dozen draw calls. Real proportions: the PM's slide is 161 mm, the AKM 880 mm overall.

const Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _inv = new THREE.Matrix4();

function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return g.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s));
}
const box = (w, h, d, x, y, z, rx, ry, rz) => place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
// a cylinder along Z: radius rf at the front (-Z) end, rb at the back
function cylZ(rf, rb, len, x, y, z, seg = 14) {
  const g = new THREE.CylinderGeometry(rb, rf, len, seg);
  g.rotateX(Math.PI / 2);
  return place(g, x, y, z);
}
// a cylinder along X
function cylX(r, len, x, y, z, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(-Math.PI / 2);
  return place(g, x, y, z);
}
const ball = (r, x, y, z) => place(new THREE.SphereGeometry(r, 10, 8), x, y, z);

// the model-space matrix of a part: its pivot and rest rotation
const frameM = (pivot = [0, 0, 0], rot = [0, 0, 0]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pivot), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), _s);

// geometry gathered per material, merged into one mesh each; given in model space and moved into
// the part's own frame (or already local, for parts easier to draw in their own frame)
class Kit {
  constructor() { this.lists = new Map(); }
  add(mat, ...geoms) {
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(...geoms);
    return this;
  }
  build(name = '', M = new THREE.Matrix4(), local = false) {
    const g = new THREE.Group();
    g.name = name;
    g.userData.M = M;
    if (!local) _inv.copy(M).invert();
    for (const [mat, list] of this.lists) {
      const geo = mergeGeometries(list);
      for (const x of list) x.dispose();
      if (!local) geo.applyMatrix4(_inv);
      geo.computeBoundingSphere();
      g.add(new THREE.Mesh(geo, mat));
    }
    return g;
  }
}

// an empty in model space: a point, and for hand frames the direction the back of the hand faces
function empty(name, x, y, z, dorsal = null) {
  const o = new THREE.Object3D();
  o.name = name;
  const q = dorsal ? new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(...dorsal).normalize()) : new THREE.Quaternion();
  o.userData.M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, _s);
  return o;
}

// hang a child (part or empty) under a parent: its local transform from the two model-space frames
function mount(parent, child) {
  _m.copy(parent.userData.M).invert().multiply(child.userData.M);
  _m.decompose(child.position, child.quaternion, child.scale);
  parent.add(child);
  return child;
}

function rootNode(name) {
  const g = new THREE.Group();
  g.name = name;
  g.userData.M = new THREE.Matrix4();
  return g;
}

export function standinMaterials() {
  const std = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  return {
    steel: std(0x3e434a, 0.85, 0.5),         // blued steel (a metal's colour is its reflectance)
    worn: std(0x666b72, 0.85, 0.32),         // worn edges, the moving steel
    black: std(0x060606, 0.2, 0.85),         // bores, ports
    wood: std(0x5c2c16, 0, 0.52),            // the Mosin's and the AKM's birch, stained red-brown
    bakelite: std(0x1f130d, 0.05, 0.38),     // the PM's grips, the flare pistol's
    plum: std(0x5b1d12, 0.05, 0.42),         // the AKM's moulded magazine and grip
    brass: std(0xb38b3f, 1, 0.3),
    steelCase: std(0x4c4733, 0.55, 0.5),     // lacquered steel cases (7.62x39)
    copper: std(0x9c6744, 1, 0.33),
    flareRed: std(0x8c1510, 0, 0.68),
    paper: std(0xb9ae94, 0, 0.85),
    cap: std(0x2a2a2a, 0.1, 0.6),
    glove: std(0x2b1d14, 0.05, 0.72),        // leather
    sleeve: std(0x171c25, 0, 0.95),          // navy quilted wool
    cuff: std(0x26282c, 0, 1),               // knitted cuff
  };
}

// ---- the Makarov PM (bore on y = 0, the slide's back at z = 0)
function makePM(M) {
  const root = rootNode('WPN_pm');
  root.add(new Kit()
    .add(M.steel,
      box(0.024, 0.013, 0.128, 0, -0.0185, -0.083),            // the frame's dust cover
      box(0.024, 0.022, 0.026, 0, -0.022, -0.004),              // the frame behind, under the hammer
      box(0.007, 0.024, 0.006, 0, -0.037, -0.104, 0.3),         // trigger guard, front
      box(0.007, 0.006, 0.07, 0, -0.049, -0.071),               // trigger guard, bottom
      box(0.025, 0.088, 0.036, 0, -0.068, -0.014, -0.27),       // the grip frame
    )
    .add(M.worn, cylZ(0.0058, 0.0058, 0.105, 0, 0, -0.105))      // the fixed barrel (seen with the slide back)
    .add(M.bakelite, box(0.0295, 0.074, 0.032, 0, -0.07, -0.012, -0.27))   // grip panels
    .build());
  const slide = new Kit()
    .add(M.steel,
      box(0.026, 0.022, 0.161, 0, 0.003, -0.0765),
      box(0.019, 0.006, 0.161, 0, 0.016, -0.0765),
      box(0.0035, 0.006, 0.006, 0, 0.022, -0.150),              // front sight
      box(0.0055, 0.006, 0.006, -0.0062, 0.021, -0.008),        // rear sight, the notch between
      box(0.0055, 0.006, 0.006, 0.0062, 0.021, -0.008),
      box(0.005, 0.007, 0.016, -0.0148, 0.003, -0.014),         // safety lever
    )
    .add(M.black,
      box(0.002, 0.009, 0.024, 0.0131, 0.006, -0.047),          // ejection port
      cylZ(0.0047, 0.0047, 0.002, 0, 0, -0.1575),
      ...[0, 1, 2, 3, 4, 5].map((i) => box(0.0263, 0.012, 0.0011, 0, 0.004, -0.004 - i * 0.0028)),
    );
  mount(root, slide.build('SLIDE'));
  mount(root, new Kit().add(M.steel,
    box(0.0075, 0.018, 0.008, 0, -0.001, 0.010),
    box(0.0075, 0.005, 0.01, 0, 0.007, 0.015)).build('HAMMER', frameM([0, -0.010, 0.006])));
  mount(root, new Kit().add(M.worn, box(0.0055, 0.016, 0.0045, 0, -0.038, -0.073, 0.25)).build('TRIGGER', frameM([0, -0.03, -0.07])));
  // the magazine, drawn in its own frame: base plate at the origin, up the grip along +Y
  const mag = mount(root, new Kit()
    .add(M.steel, box(0.019, 0.08, 0.029, 0, 0.042, 0))
    .add(M.bakelite, box(0.027, 0.007, 0.040, 0, 0, 0.001))
    .build('MAG', frameM([0, -0.110, -0.002], [-0.27, 0, 0]), true));
  const rounds = new Kit()
    .add(M.brass, cylZ(0.0046, 0.0046, 0.018, 0, 0.0855, 0.002))
    .add(M.copper, cylZ(0.0026, 0.0045, 0.008, 0, 0.0855, -0.011))
    .build('ROUNDS', new THREE.Matrix4(), true);
  mag.add(rounds);
  mount(root, empty('MUZZLE', 0, 0, -0.160));
  mount(root, empty('EJECT', 0.014, 0.008, -0.047));
  mount(root, empty('SIGHT', 0, 0.0235, -0.008));
  mount(root, empty('GRIP_R', 0.002, -0.064, -0.012, [1, 0.2, 0]));
  mount(root, empty('GRIP_L', -0.020, -0.076, -0.004, [-0.9, -0.45, 0]));
  return root;
}

// ---- the AKM (bore on y = 0, the receiver's back at z = 0)
function makeAKM(M) {
  const root = rootNode('WPN_akm');
  root.add(new Kit()
    .add(M.steel,
      box(0.031, 0.050, 0.290, 0, -0.020, -0.150),              // receiver
      box(0.029, 0.017, 0.250, 0, 0.0125, -0.155),              // the dust cover
      box(0.020, 0.006, 0.245, 0, 0.022, -0.155),
      box(0.030, 0.026, 0.024, 0, 0.003, -0.014),               // rear trunnion
      box(0.032, 0.040, 0.03, 0, -0.008, -0.295),               // front trunnion
      box(0.026, 0.018, 0.06, 0, 0.012, -0.322),                // rear sight block and leaf
      box(0.017, 0.005, 0.075, 0, 0.0245, -0.305),
      box(0.005, 0.014, 0.004, -0.0055, 0.034, -0.270),         // the notch
      box(0.005, 0.014, 0.004, 0.0055, 0.034, -0.270),
      box(0.022, 0.034, 0.03, 0, 0.012, -0.588),                // gas block
      cylZ(0.0095, 0.0095, 0.10, 0, 0.022, -0.53),              // gas tube
      box(0.020, 0.030, 0.03, 0, 0.006, -0.70),                 // front sight base, ears, post
      box(0.003, 0.024, 0.012, -0.0085, 0.030, -0.70),
      box(0.003, 0.024, 0.012, 0.0085, 0.030, -0.70),
      box(0.0028, 0.020, 0.003, 0, 0.030, -0.70),
      cylZ(0.0115, 0.0115, 0.032, 0, 0, -0.836),                // slant compensator
      box(0.008, 0.006, 0.065, 0, -0.064, -0.075),              // trigger guard
      box(0.008, 0.022, 0.006, 0, -0.054, -0.106),
      box(0.016, 0.014, 0.008, 0, -0.052, -0.112),              // magazine catch
      box(0.036, 0.124, 0.012, 0, -0.08, 0.252, 0.10),          // butt plate
    )
    .add(M.worn, cylZ(0.0085, 0.0095, 0.53, 0, 0, -0.555))
    .add(M.black, box(0.002, 0.018, 0.085, 0.0156, 0.004, -0.195))   // ejection port
    .add(M.wood,
      box(0.040, 0.040, 0.175, 0, -0.016, -0.392),              // lower handguard
      box(0.028, 0.016, 0.165, 0, 0.018, -0.395),               // upper handguard
      box(0.028, 0.046, 0.09, 0, -0.030, 0.035, 0.20),          // stock wrist and butt
      box(0.034, 0.120, 0.17, 0, -0.075, 0.165, 0.10),
    )
    .add(M.plum, box(0.028, 0.092, 0.040, 0, -0.088, -0.030, -0.33))   // pistol grip
    .build());
  // the bolt carrier seen in the port, and its charging handle
  mount(root, new Kit()
    .add(M.worn, box(0.003, 0.016, 0.085, 0.0158, 0.004, -0.195), box(0.020, 0.010, 0.012, 0.025, 0.006, -0.232))
    .add(M.steel, cylX(0.0075, 0.014, 0.039, 0.006, -0.232))
    .build('CHARGE'));
  mount(root, new Kit()
    .add(M.worn, box(0.003, 0.010, 0.13, 0.0168, -0.002, -0.105), box(0.006, 0.014, 0.012, 0.0185, 0.004, -0.165))
    .build('SELECTOR', frameM([0.0168, 0, -0.040])));
  mount(root, new Kit().add(M.worn, box(0.006, 0.022, 0.005, 0, -0.056, -0.072, 0.3)).build('TRIGGER', frameM([0, -0.045, -0.068])));
  // the curved magazine, its origin the front lug it rocks on
  const mag = mount(root, new Kit()
    .add(M.plum,
      box(0.026, 0.07, 0.062, 0, -0.072, -0.146, 0.10),
      box(0.026, 0.065, 0.058, 0, -0.135, -0.158, 0.30),
      box(0.026, 0.060, 0.055, 0, -0.190, -0.180, 0.50),
      box(0.030, 0.010, 0.058, 0, -0.222, -0.198, 0.55))
    .build('MAG', frameM([0, -0.044, -0.176])));
  mount(mag, new Kit()
    .add(M.steelCase, cylZ(0.0052, 0.0057, 0.039, 0, -0.041, -0.140))
    .add(M.copper, cylZ(0.0022, 0.0040, 0.016, 0, -0.041, -0.167))
    .build('ROUNDS', frameM([0, -0.044, -0.176])));
  mount(root, empty('MUZZLE', 0, 0, -0.853));
  mount(root, empty('EJECT', 0.017, 0.010, -0.19));
  mount(root, empty('SIGHT', 0, 0.040, -0.270));
  mount(root, empty('GRIP_R', 0.001, -0.085, -0.030, [1, 0.25, 0]));
  mount(root, empty('GRIP_L', 0, -0.040, -0.40, [-0.55, -0.83, 0]));
  return root;
}

// ---- the Mosin-Nagant M44 carbine (bore on y = 0, the receiver's back at z = 0)
function makeMosin(M) {
  const root = rootNode('WPN_mosin');
  root.add(new Kit()
    .add(M.wood,
      box(0.042, 0.040, 0.44, 0, -0.022, -0.320),               // forend
      box(0.044, 0.046, 0.13, 0, -0.025, -0.035),               // round the action
      box(0.034, 0.042, 0.10, 0, -0.040, 0.075, 0.28),          // wrist
      box(0.040, 0.125, 0.20, 0, -0.082, 0.205, 0.12),          // butt
      box(0.030, 0.014, 0.17, 0, 0.014, -0.315),                // upper handguard
    )
    .add(M.steel,
      cylZ(0.0155, 0.0155, 0.17, 0, 0, -0.08),                  // round receiver and its ring
      cylZ(0.017, 0.017, 0.03, 0, 0, -0.152),
      box(0.024, 0.012, 0.075, 0, 0.014, -0.215),               // rear sight base, leaf, notch
      box(0.016, 0.006, 0.08, 0, 0.022, -0.215),
      box(0.004, 0.012, 0.004, -0.0048, 0.029, -0.180),
      box(0.004, 0.012, 0.004, 0.0048, 0.029, -0.180),
      box(0.022, 0.012, 0.03, 0, 0.008, -0.705),                // hooded front sight
      box(0.003, 0.03, 0.022, -0.010, 0.018, -0.705),
      box(0.003, 0.03, 0.022, 0.010, 0.018, -0.705),
      box(0.023, 0.003, 0.022, 0, 0.034, -0.705),
      box(0.0025, 0.022, 0.003, 0, 0.022, -0.705),
      box(0.046, 0.046, 0.012, 0, -0.016, -0.20),               // barrel bands
      box(0.046, 0.046, 0.012, 0, -0.016, -0.50),
      box(0.028, 0.026, 0.09, 0, -0.050, -0.085),               // magazine box
      box(0.007, 0.006, 0.06, 0, -0.068, -0.005),               // trigger guard
      box(0.042, 0.13, 0.010, 0, -0.088, 0.305, 0.12),          // butt plate
      cylZ(0.003, 0.005, 0.38, 0.026, -0.010, -0.52),           // the folded spike bayonet
      box(0.012, 0.024, 0.03, 0.022, -0.006, -0.712),
    )
    .add(M.worn, cylZ(0.0085, 0.0115, 0.56, 0, 0, -0.445))
    .build());
  mount(root, new Kit()
    .add(M.worn, cylZ(0.0095, 0.0095, 0.13, 0, 0, -0.03), cylX(0.0045, 0.06, 0.035, -0.002, 0.012))
    .add(M.steel, cylZ(0.011, 0.011, 0.016, 0, 0, 0.042), ball(0.0105, 0.072, -0.004, 0.012))
    .build('BOLT'));
  mount(root, new Kit().add(M.worn, box(0.006, 0.020, 0.005, 0, -0.056, -0.015, 0.3)).build('TRIGGER', frameM([0, -0.045, -0.012])));
  mount(root, empty('MUZZLE', 0, 0, -0.728));
  mount(root, empty('EJECT', 0.008, 0.018, -0.06));
  mount(root, empty('SIGHT', 0, 0.033, -0.180));
  mount(root, empty('GRIP_R', 0.002, -0.046, 0.070, [1, 0.3, 0]));
  mount(root, empty('GRIP_L', 0, -0.040, -0.31, [-0.5, -0.86, 0]));
  return root;
}

// ---- the SPSh-44 flare pistol (26 mm; bore on y = 0, the breech face at z = -0.03)
function makeFlaregun(M) {
  const root = rootNode('WPN_flaregun');
  root.add(new Kit()
    .add(M.steel,
      box(0.036, 0.040, 0.052, 0, -0.004, -0.004),              // frame
      box(0.026, 0.012, 0.03, 0, -0.026, -0.045),               // hinge lug
      box(0.007, 0.006, 0.055, 0, -0.044, -0.024),              // trigger guard
      box(0.007, 0.022, 0.006, 0, -0.034, -0.051),
      box(0.004, 0.010, 0.026, -0.0195, 0.006, -0.018),         // barrel latch
      box(0.031, 0.008, 0.046, 0, -0.108, 0.034, -0.32),        // grip cap
    )
    .add(M.bakelite, box(0.029, 0.090, 0.044, 0, -0.062, 0.018, -0.32))
    .build());
  const brk = mount(root, new Kit()
    .add(M.worn,
      cylZ(0.0185, 0.0185, 0.165, 0, 0, -0.1125),
      cylZ(0.0198, 0.0198, 0.008, 0, 0, -0.192),
      box(0.006, 0.004, 0.155, 0, 0.0195, -0.112),
      box(0.02, 0.012, 0.03, 0, -0.019, -0.05))
    .add(M.black, cylZ(0.0135, 0.0135, 0.002, 0, 0, -0.1965))
    .build('BARREL_BREAK', frameM([0, -0.026, -0.045])));
  // the cartridge in the chamber: only its brass head shows, at the breech
  const shell = new Kit()
    .add(M.brass, cylZ(0.0155, 0.0155, 0.003, 0, 0, -0.0315))
    .add(M.flareRed, cylZ(0.0132, 0.0132, 0.07, 0, 0, -0.068))
    .add(M.black, cylZ(0.003, 0.003, 0.001, 0, 0, -0.0298))
    .build('SHELL', frameM([0, 0, 0]));
  mount(brk, shell);
  mount(brk, empty('MUZZLE', 0, 0, -0.198));
  mount(brk, empty('EJECT', 0, 0, -0.03));
  mount(root, new Kit().add(M.worn,
    box(0.008, 0.022, 0.009, 0, 0.022, 0.016),
    box(0.008, 0.006, 0.014, 0, 0.032, 0.023)).build('HAMMER', frameM([0, 0.012, 0.012])));
  mount(root, new Kit().add(M.worn, box(0.006, 0.018, 0.005, 0, -0.032, -0.029, 0.2)).build('TRIGGER', frameM([0, -0.024, -0.026])));
  mount(root, empty('SIGHT', 0, 0.0225, -0.04));
  mount(root, empty('GRIP_R', 0.001, -0.058, 0.016, [1, 0.25, 0]));
  mount(root, empty('GRIP_L', -0.021, -0.072, 0.022, [-0.9, -0.45, 0]));
  return root;
}

// ---- a hand flare: a red paper tube, the striker cap on its burning end (along -Z)
function makeHandflare(M) {
  const root = rootNode('WPN_handflare');
  root.add(new Kit()
    .add(M.flareRed, cylZ(0.0165, 0.0165, 0.21, 0, 0, -0.035))
    .add(M.cap, cylZ(0.0155, 0.0155, 0.04, 0, 0, 0.09))
    .add(M.paper, cylZ(0.0168, 0.0168, 0.05, 0, 0, -0.02))
    .build());
  mount(root, new Kit().add(M.cap, cylZ(0.0185, 0.0185, 0.035, 0, 0, -0.152)).build('CAP'));
  mount(root, empty('MUZZLE', 0, 0, -0.142));
  mount(root, empty('GRIP_L', 0, 0, 0.04, [0, 1, 0]));
  return root;
}

// ---- an arm: a gloved fist at HAND (the origin), the sleeve running back along +Z
function makeArm(side, M) {
  const root = rootNode(side > 0 ? 'ARM_R' : 'ARM_L');
  root.add(new Kit()
    .add(M.glove,
      box(0.080, 0.046, 0.085, 0, 0.006, -0.012),               // the fist
      box(0.084, 0.034, 0.03, 0, 0.004, -0.058),                // knuckles
      box(0.024, 0.024, 0.06, -side * 0.04, -0.008, -0.022, 0, side * 0.35, 0),   // thumb
      cylZ(0.033, 0.036, 0.05, 0, 0.002, 0.045))                // wrist
    .add(M.cuff, cylZ(0.042, 0.044, 0.05, 0, 0.002, 0.085))
    .add(M.sleeve, cylZ(0.047, 0.058, 0.45, 0, 0.002, 0.33))
    .build());
  mount(root, empty('HAND', 0, 0, 0));
  return root;
}

// ---- small props the hands carry: a Mosin stripper clip of five, one round, a flare cartridge.
// Each has a GRAB empty where the fingers hold it (on the top round: the thumb strips them down).
function cartridge762r(M, y) {
  return [
    [M.brass, cylZ(0.0045, 0.0062, 0.054, 0, y, 0.006)],
    [M.brass, cylZ(0.0072, 0.0072, 0.002, 0, y, 0.034)],
    [M.copper, cylZ(0.0015, 0.0039, 0.026, 0, y, -0.034)],
  ];
}
function makeClip(M) {
  const root = rootNode('PROP_clip');
  root.add(new Kit().add(M.steel, box(0.014, 0.066, 0.006, 0, 0, 0.034)).build());
  const k = new Kit();
  for (const y of [-0.024, -0.012, 0, 0.012, 0.024]) for (const [m, g] of cartridge762r(M, y)) k.add(m, g);
  const rounds = mount(root, k.build('ROUNDS'));
  mount(rounds, empty('GRAB', 0, 0.031, 0.0, [0.6, 0.8, 0]));
  return root;
}
function makeRound(M) {
  const root = rootNode('PROP_round');
  const k = new Kit();
  for (const [m, g] of cartridge762r(M, 0)) k.add(m, g);
  root.add(k.build());
  mount(root, empty('GRAB', 0, 0.007, 0.004, [0.6, 0.8, 0]));
  return root;
}
function makeCart(M) {
  const root = rootNode('PROP_cart');
  root.add(new Kit()
    .add(M.flareRed, cylZ(0.0132, 0.0132, 0.07, 0, 0, 0))
    .add(M.brass, cylZ(0.0155, 0.0155, 0.004, 0, 0, 0.036))
    .add(M.black, cylZ(0.003, 0.003, 0.001, 0, 0, 0.0385))
    .build());
  mount(root, empty('GRAB', 0, 0, 0.045, [0, 1, 0]));
  return root;
}

// every stand-in, sharing one set of materials
export function buildStandins(M = standinMaterials()) {
  return {
    materials: M,
    weapons: { pm: makePM(M), akm: makeAKM(M), mosin: makeMosin(M), flaregun: makeFlaregun(M), handflare: makeHandflare(M) },
    arms: { R: makeArm(1, M), L: makeArm(-1, M) },
    props: { clip: makeClip(M), round: makeRound(M), cart: makeCart(M) },
  };
}
