// The four guns as data: their numbers (calibre, capacity, damage, spread, recoil, timing), where
// they sit in view (the hip pose, the eye relief when aiming, the elbows the forearms run back to),
// and every reload as a sequence of keyed poses (Actions.js reads the tables).
//
// Positions are metres in the view's frame (x right, y up, -z ahead of the eye); a gun's hip pose
// places its GRIP_R there, its aim pose puts SIGHT on the line of sight `eye` metres ahead. Angles
// are radians: rx lifts the muzzle, ry turns it left, rz rolls it anticlockwise as you see it.
// Action times are seconds. Event names are handled in Weapons.js (sounds, ammunition, brass).

import { Names } from './Actions.js';

export const ANCHORS = new Names([
  'gripR', 'gripL', 'restR', 'restL', 'mag', 'slide', 'bolt', 'charge', 'barrel', 'breech', 'prop',
  'pouchL', 'pouchR', 'idleL', 'idleR', 'flareHold', 'flareStrike', 'flareBack', 'flareThrow',
]);
export const PROPS = new Names(['none', 'clip', 'round', 'cart', 'flare']);

// points in the view the hands go to when they leave the gun: [x, y, z, the back of the hand]
export const POINTS = {
  pouchL: [-0.22, -0.46, -0.12, [-1, 0, 0]],
  pouchR: [0.24, -0.46, -0.08, [1, 0, 0]],
  idleL: [-0.24, -0.55, -0.02, [-1, 0, 0]],
  idleR: [0.26, -0.55, -0.02, [1, 0, 0]],
  flareHold: [-0.11, -0.10, -0.33, [-0.8, 0, 0.6]],
  flareStrike: [-0.08, -0.135, -0.37, [-0.8, 0, 0.6]],
  flareBack: [-0.20, 0.03, -0.12, [-0.6, 0.6, 0.5]],
  flareThrow: [-0.05, 0.06, -0.56, [-0.3, 0.8, -0.5]],
};
// the left forearm when nothing is in the hands
export const ELBOW_EMPTY = [-0.24, -0.48, 0.06];

const tilt = (t, [px, py, pz, rx, ry, rz]) => ({ px: [[t, px]], py: [[t, py]], pz: [[t, pz]], rx: [[t, rx]], ry: [[t, ry]], rz: [[t, rz]] });
const level = (t) => tilt(t, [0, 0, 0, 0, 0, 0]);

// ---- the Makarov: 8 in the magazine and one up; the slide locks back on the last round
const pmNext = (g) => (g.st.locked && g.st.mag > 0 ? 'slideRel' : g.st.chamber === 0 && g.st.mag > 0 && g.st.magIn ? 'rack' : 'tiltOut');
const PM_TILT = [-0.025, 0.03, 0.035, 0.30, 0.30, -0.50];
const PM_ACTIONS = {
  tiltIn: { dur: 0.26, keys: { ...tilt(0.26, PM_TILT), lh: [[0.22, 'mag']] },
    next: (g) => (!g.st.magIn ? 'magIn' : g.reserve() > 0 && g.st.mag < g.def.cap ? 'magOut' : pmNext(g)) },
  magOut: { dur: 0.6, keys: { mag: [[0.06, 0], [0.22, 1, 'out'], [0.56, 2, 'in']] }, ev: [[0.07, 'magOut']], next: () => 'magIn' },
  magIn: { dur: 0.62, keys: { mag: [[0, 2], [0.36, 1, 'out'], [0.5, 0, 'snap']], py: [[0.5, 0.03], [0.54, 0.042, 'out'], [0.62, 0.03]] },
    ev: [[0.5, 'magIn']], next: pmNext },
  slideRel: { dur: 0.46, keys: { lh: [[0.2, 'slide'], [0.44, 'slide']], slide: [[0.24, 1], [0.3, 1.08], [0.345, 0, 'snap']],
    rx: [[0.33, 0.30], [0.37, 0.26, 'out'], [0.46, 0.30]] }, ev: [[0.335, 'slideRel']], next: () => 'tiltOut' },
  // a round into an empty chamber (the gun as it was handed over; after a magazine went in loose)
  rack: { dur: 0.56, keys: { lh: [[0.18, 'slide'], [0.54, 'slide']], slide: [[0.2, 0], [0.34, 1], [0.4, 1], [0.46, 0, 'snap']], rz: [[0.2, -0.2]], rx: [[0.2, 0.12]] },
    ev: [[0.46, 'rack']], next: () => 'tiltOut' },
  tiltOut: { dur: 0.3, keys: { ...level(0.3), lh: [[0.26, 'restL']] } },
};

// ---- the AKM: 30 and one up; no hold-open, so a dry rifle is charged after the new magazine
const akmNext = (g) => (g.st.chamber === 0 && g.st.mag > 0 && g.st.magIn ? 'charge' : 'tiltOut');
const AKM_TILT = [-0.05, 0.07, 0.06, 0.28, 0.22, -0.55];
const AKM_ACTIONS = {
  tiltIn: { dur: 0.32, keys: { ...tilt(0.32, AKM_TILT), lh: [[0.28, 'mag']] },
    next: (g) => (!g.st.magIn ? 'magIn' : g.reserve() > 0 && g.st.mag < g.def.cap ? 'magOut' : akmNext(g)) },
  // rock it forward off the catch, pull it down and away
  magOut: { dur: 0.62, keys: { mag: [[0.06, 0], [0.18, 0.35], [0.3, 1, 'out'], [0.58, 2, 'in']] }, ev: [[0.12, 'magOut']], next: () => 'magIn' },
  // hook the front lug, rock it back till it clicks
  magIn: { dur: 0.7, keys: { mag: [[0, 2], [0.34, 1, 'out'], [0.48, 0.35], [0.6, 0, 'snap']], rz: [[0.58, -0.55], [0.63, -0.6, 'out'], [0.7, -0.55]] },
    ev: [[0.6, 'magIn']], next: akmNext },
  // the right hand leaves the grip, racks the handle back and lets it fly
  charge: { dur: 0.74, keys: { rh: [[0.2, 'charge'], [0.56, 'charge'], [0.72, 'restR']], lh: [[0.26, 'restL']],
    charge: [[0.24, 0], [0.36, 1], [0.41, 0, 'snap']], rz: [[0.26, -0.3]], rx: [[0.26, 0.08]] },
    ev: [[0.40, 'charge']], next: () => 'tiltOut' },
  tiltOut: { dur: 0.32, keys: { ...level(0.32), lh: [[0.28, 'restL']], rh: [[0.2, 'restR']] } },
  selector: { dur: 0.36, keys: { rz: [[0.12, -0.28], [0.32, 0]], px: [[0.12, -0.012], [0.32, 0]] }, ev: [[0.14, 'selector']] },
};

// ---- the Mosin: five; the bolt after every shot; a stripper clip when the magazine is empty and
// there are five to hand, else round by round (a shot fired stops the loading)
const mosinLoad = (g) => (g.st.mag === 0 && g.reserve() >= 5 ? 'clip' : g.st.mag < g.def.cap && g.reserve() > 0 && !g.stop ? 'round' : 'close');
const MOSIN_TILT = [-0.03, 0.04, -0.02, 0.10, 0.14, 0.32];
const MOSIN_ACTIONS = {
  // up, back (the case flies), forward (a round from the magazine), down
  cycle: { dur: 1.0, aimMax: 0.35, keys: {
    rh: [[0.16, 'bolt'], [0.8, 'bolt'], [0.98, 'restR']],
    lift: [[0.16, 0], [0.27, 1, 'out'], [0.68, 1], [0.78, 0, 'snap']],
    pull: [[0.29, 0], [0.45, 1, 'out'], [0.5, 1], [0.66, 0]],
    px: [[0.2, -0.02], [0.85, -0.02], [1, 0]], py: [[0.2, 0.03], [0.85, 0.03], [1, 0]], pz: [[0.2, -0.05], [0.85, -0.05], [1, 0]],
    ry: [[0.2, 0.08], [0.85, 0.08], [1, 0]], rz: [[0.2, 0.15], [0.85, 0.15], [1, 0]] },
  ev: [[0.18, 'boltUp'], [0.45, 'boltBack'], [0.6, 'boltClose'], [0.66, 'boltFwd']] },
  open: { dur: 0.72, keys: { ...tilt(0.3, MOSIN_TILT), rh: [[0.22, 'bolt']], lift: [[0.26, 0], [0.38, 1, 'out']], pull: [[0.4, 0], [0.58, 1, 'out']] },
    ev: [[0.28, 'boltUp'], [0.58, 'boltBack']], next: mosinLoad },
  reach: { dur: 0.36, keys: { ...tilt(0.3, MOSIN_TILT), rh: [[0.3, 'bolt']] }, next: mosinLoad },
  clip: { dur: 1.55, keys: {
    rh: [[0.3, 'pouchR'], [0.7, 'prop'], [1.12, 'prop'], [1.4, 'pouchR']],
    prop: [[0.3, 'clip'], [1.4, 'none']], pa: [[0.02, 0, 'lin'], [0.62, 0], [0.7, 1], [1.14, 1], [1.22, 0]],
    push: [[0.02, 0, 'lin'], [0.76, 0], [1.05, 1]], py: [[0.76, 0.04], [1.05, 0.028], [1.2, 0.04]] },
  ev: [[0.3, 'clipShow'], [0.78, 'clipPush'], [1.05, 'clip']], next: () => 'close' },
  round: { dur: 0.62, keys: {
    rh: [[0.2, 'pouchR'], [0.4, 'prop'], [0.54, 'prop']],
    prop: [[0.2, 'round'], [0.52, 'none']], pa: [[0.02, 0, 'lin'], [0.34, 0], [0.4, 1]], push: [[0.02, 0, 'lin'], [0.4, 0], [0.5, 1]] },
  ev: [[0.5, 'round']], next: mosinLoad },
  close: { dur: 0.72, keys: { rh: [[0.16, 'bolt'], [0.5, 'bolt'], [0.7, 'restR']], pull: [[0.18, 1], [0.34, 0]], lift: [[0.36, 1], [0.46, 0, 'snap']], ...level(0.72) },
    ev: [[0.2, 'boltClose'], [0.34, 'boltFwd']] },
};

// ---- the SPSh-44: break it open, the spent case out, a cartridge in, shut
const flareNext = (g) => (g.st.chamber === -1 ? 'eject' : g.st.chamber === 0 && g.reserve() > 0 ? 'load' : 'close');
const FLARE_TILT = [-0.03, 0.03, 0.05, 0.22, 0.28, -0.15];
const FLARE_ACTIONS = {
  open: { dur: 0.55, keys: { ...tilt(0.3, FLARE_TILT), lh: [[0.22, 'barrel'], [0.48, 'barrel']], brk: [[0.25, 0], [0.42, 1, 'out']] },
    ev: [[0.26, 'openSnd'], [0.42, 'opened']], next: flareNext },
  reach: { dur: 0.32, keys: { ...tilt(0.28, FLARE_TILT), lh: [[0.28, 'barrel']] }, next: flareNext },
  eject: { dur: 0.48, keys: { lh: [[0.16, 'breech'], [0.38, 'pouchL']], rx: [[0.14, 0.22], [0.2, 0.34, 'out'], [0.34, 0.22]] },
    ev: [[0.19, 'eject']], next: (g) => (g.reserve() > 0 ? 'load' : 'close') },
  load: { dur: 0.86, keys: {
    lh: [[0.25, 'pouchL'], [0.52, 'prop'], [0.74, 'prop']],
    prop: [[0.22, 'cart'], [0.7, 'none']], pa: [[0.02, 0, 'lin'], [0.46, 0], [0.52, 1]], push: [[0.02, 0, 'lin'], [0.52, 0], [0.68, 1]] },
  ev: [[0.68, 'load']], next: () => 'close' },
  close: { dur: 0.56, keys: { lh: [[0.14, 'barrel'], [0.42, 'restL']], brk: [[0.16, 1], [0.27, 0, 'snap']], ...level(0.54) }, ev: [[0.26, 'close']] },
};

// ---- the hand flare, with any gun or none: from the pocket, strike, hold it up, throw
export const THROW_ACTION = {
  dur: 1.3, lock: true, keys: {
    lh: [[0.24, 'pouchL'], [0.5, 'flareHold'], [0.58, 'flareStrike'], [0.68, 'flareHold'], [0.88, 'flareBack'], [1.02, 'flareThrow'], [1.28, 'restL']],
    prop: [[0.24, 'flare'], [1.02, 'none']],
    px: [[0.3, 0.03], [1.1, 0.03], [1.28, 0]], py: [[0.3, -0.07], [1.1, -0.07], [1.28, 0]], rz: [[0.3, 0.18], [1.1, 0.18], [1.28, 0]] },
  ev: [[0.24, 'flareShow'], [0.58, 'flareIgnite'], [1.02, 'flareRelease']],
};

const LOWERED = { pos: [0.02, -0.27, 0.05], rot: [-0.9, 0.22, 0.32] };
const RIFLE_LOWERED = { pos: [0.03, -0.30, 0.08], rot: [-0.8, 0.35, 0.4] };

export const WEAPONS = {
  pm: {
    id: 'pm', slot: 1, ammo: '9x18', cap: 8, auto: false,
    // held in one hand, as an officer's pistol was (the left comes up only to reload)
    oneHand: true,
    hands: { R: { at: [0, -0.066, -0.013], axis: [0, -0.964, 0.267], back: [1, 0, 0], front: 0.022 } },
    damage: 34, range: 50, falloff: 0.6, rate: 0.12,
    spread: 0.030, aimSpread: 0.006,
    recoil: { pitch: 0.026, yaw: 0.009, keep: 0.2, back: 0.045, rise: 0.16, roll: 0.06, up: 0.006 },
    zoom: 0.86, aimRate: 7, eye: 0.30, vmFov: [50, 45],
    draw: 0.4, holster: 0.3,
    hip: { pos: [0.105, -0.140, -0.32], rot: [0.03, 0.05, 0.02] },
    elbowR: [[0.22, -0.42, 0.04], [0.10, -0.34, 0.16]], elbowL: [[-0.10, -0.44, 0.04], [-0.08, -0.34, 0.16]],
    sprint: { pos: [0.0, -0.04, 0.02], rot: [-0.42, 0.24, 0.18] }, lowered: LOWERED,
    slideTravel: 0.032, hammerCock: 0.75, triggerPull: 0.3,
    mag: { out: 0.088, rock: 0, rockAt: 0, away: [-0.10, -0.32, 0.12, 0.6, 0.4, 0.3], grab: [0.5, 0, 0.5], dorsal: [-0.4, -0.9, 0] },
    brass: 'b9', eject: [2.2, 1.8, 0.5],
    flash: { size: 0.075, light: 26, smoke: 3, color: [4, 2.6, 1.3] },
    start: 'tiltIn', actions: PM_ACTIONS,
  },
  mosin: {
    id: 'mosin', slot: 2, ammo: '7.62x54R', cap: 5, auto: false,
    hands: {
      R: { at: [0, -0.042, 0.072], axis: [0, -0.276, 0.961], back: [0, -0.961, -0.276], mat: /wood/ },
      L: { at: [0, -0.024, -0.31], axis: [0, 0, -1], back: [-0.35, -0.94, 0], mat: /wood/, open: true, top: 0.021 },
    },
    damage: 120, range: 500, falloff: 0.75, rate: 0.3,
    spread: 0.028, aimSpread: 0.0009,
    recoil: { pitch: 0.062, yaw: 0.016, keep: 0.3, back: 0.09, rise: 0.22, roll: 0.08, up: 0.01 },
    zoom: 0.72, aimRate: 4.5, eye: 0.20, vmFov: [50, 42],
    draw: 0.7, holster: 0.45,
    hip: { pos: [0.10, -0.17, -0.16], rot: [0.03, 0.045, 0.03] },
    elbowR: [[0.26, -0.34, 0.14], [0.20, -0.25, 0.16]], elbowL: [[-0.12, -0.42, -0.04], [-0.10, -0.36, -0.02]],
    sprint: { pos: [-0.02, -0.03, 0.04], rot: [-0.26, 0.42, 0.28] }, lowered: RIFLE_LOWERED,
    boltAngle: 1.45, boltTravel: 0.095, triggerPull: 0.3,
    clipAt: [0, 0.058, -0.045], portAt: [[0, 0.045, -0.05], [0, 0.0, -0.05]], clipPush: 0.06,
    brass: 'b762r', eject: [1.0, 2.2, 0.6],
    flash: { size: 0.2, light: 60, smoke: 6, color: [4, 2.4, 1.1] },
    start: 'open', actions: MOSIN_ACTIONS,
  },
  akm: {
    id: 'akm', slot: 3, ammo: '7.62x39', cap: 30, auto: true,
    hands: {
      R: { at: [0, -0.082, -0.028], axis: [0, -0.946, 0.324], back: [1, 0, 0], mat: /wood/ },
      L: { at: [0, -0.016, -0.40], axis: [0, 0, -1], back: [-0.35, -0.94, 0], mat: /wood/, open: true, top: 0.021 },
    },
    damage: 42, range: 250, falloff: 0.65, rate: 0.1,
    spread: 0.035, aimSpread: 0.0045, bloom: 0.0035, bloomMax: 0.03,
    recoil: { pitch: 0.016, yaw: 0.010, keep: 0.35, keepAuto: 0.6, climb: 0.0016, back: 0.03, rise: 0.06, roll: 0.03, up: 0.004 },
    zoom: 0.8, aimRate: 5.5, eye: 0.17, vmFov: [50, 44],
    draw: 0.65, holster: 0.45,
    hip: { pos: [0.12, -0.20, -0.20], rot: [0.03, 0.045, 0.03] },
    elbowR: [[0.26, -0.34, 0.14], [0.20, -0.25, 0.16]], elbowL: [[-0.12, -0.42, -0.12], [-0.10, -0.36, -0.06]],
    sprint: { pos: [-0.02, -0.03, 0.04], rot: [-0.26, 0.42, 0.28] }, lowered: RIFLE_LOWERED,
    chargeTravel: 0.115, selector: { auto: -0.2, semi: -0.4 }, triggerPull: 0.3,
    mag: { out: 0.06, rock: 0.42, rockAt: 0.35, away: [-0.12, -0.30, 0.10, 0.5, 0.3, 0.4], grab: [0, 0.6, 0.45], dorsal: [-1, 0.1, 0] },
    brass: 'b762', eject: [3.2, 1.2, -1.2],
    flash: { size: 0.11, light: 34, smoke: 3, color: [4, 2.5, 1.2] },
    start: 'tiltIn', actions: AKM_ACTIONS,
  },
  flaregun: {
    id: 'flaregun', slot: 4, ammo: 'flare', cap: 1, auto: false,
    oneHand: true,
    hands: { R: { at: [0, -0.060, 0.016], axis: [0, -0.949, 0.315], back: [1, 0, 0], front: 0.024 } },
    damage: 60, rate: 0.5, speed: 40,
    spread: 0.03, aimSpread: 0.01,
    recoil: { pitch: 0.04, yaw: 0.01, keep: 0.15, back: 0.06, rise: 0.25, roll: 0.05, up: 0.008 },
    zoom: 0.9, aimRate: 6.5, eye: 0.30, vmFov: [50, 45],
    draw: 0.45, holster: 0.35,
    hip: { pos: [0.10, -0.135, -0.30], rot: [0.05, 0.06, 0.02] },
    elbowR: [[0.22, -0.42, 0.04], [0.10, -0.34, 0.16]], elbowL: [[-0.10, -0.44, 0.04], [-0.08, -0.34, 0.16]],
    sprint: { pos: [0.0, -0.04, 0.02], rot: [-0.42, 0.24, 0.18] }, lowered: LOWERED,
    breakAngle: 0.9, hammerCock: 0.55, triggerPull: 0.3,
    brass: 'flare', eject: [-0.6, 1.6, 2.2],
    flash: { size: 0.10, light: 20, smoke: 5, color: [5, 1.0, 0.5] },
    start: 'open', actions: FLARE_ACTIONS,
  },
};

export const ORDER = ['pm', 'mosin', 'akm', 'flaregun'];
