import * as THREE from 'three';
import { Input } from '../src/core/Input.js';
import { Collision } from '../src/boat/Collision.js';
import { Stats } from '../src/survival/Stats.js';
import { Enemies } from '../src/enemies/Enemies.js';

// The creature sandbox for tools/enemies-test.html (on the dev server: /tools/enemies-test.html).
// A snowfield at night with a hut (a doorway with a shut door the Turned can beat down: it gives on
// the second time), a wall to hide behind, you on foot with a flashlight and the four guns as plain
// rays, and buttons that put each creature 12 m in front of you. The world here stands in for the
// boat: a still frame at the origin, its collision the ground and the hut. The sounds aren't
// played: the panel lists what the creatures would have said, and when.

// (the models load from the site's root, as in the game: models/... against the page's base)
const base = document.createElement('base');
base.href = new URL('../', location.href).href;
document.head.prepend(base);
let clock = 0;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a10);
scene.fog = new THREE.FogExp2(0x070a10, 0.025);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 500);
scene.add(camera);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// the night: a little sky, a low moon, your flashlight
const sky = new THREE.HemisphereLight(0x8aa4c8, 0x101418, 0.35);
const moon = new THREE.DirectionalLight(0xb8c8ff, 0.5);
moon.position.set(30, 40, 25); moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
scene.add(sky, moon);
const torch = new THREE.SpotLight(0xfff1dd, 40, 30, 0.32, 0.45, 1.6);
torch.castShadow = true; torch.shadow.mapSize.set(1024, 1024);
camera.add(torch); torch.position.set(0.15, -0.15, 0); camera.add(torch.target); torch.target.position.set(0, 0, -1);
const flareLight = new THREE.PointLight(0xff3010, 0, 18, 2);
scene.add(flareLight);

// the ground, the hut, a wall
const snow = new THREE.MeshStandardMaterial({ color: 0xc8d2dc, roughness: 0.92 });
const wood = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.8 });
const solids = [];
const box = (w, h, d, x, y, z, mat = wood) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = mat !== snow; m.receiveShadow = true;
  scene.add(m); solids.push(m);
  return m;
};
box(200, 1, 200, 0, -0.5, 0, snow);
box(8, 3, 0.3, 0, 1.5, -30); box(0.3, 3, 8, -4, 1.5, -26); box(0.3, 3, 8, 4, 1.5, -26);
box(3, 3, 0.3, -2.5, 1.5, -22); box(3, 3, 0.3, 2.5, 1.5, -22); box(8.6, 0.3, 8.6, 0, 3.15, -26);
box(10, 3, 0.4, 20, 1.5, 0);
scene.updateMatrixWorld(true);
const col = new Collision(solids, scene);
const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.7 }));
doorMesh.position.set(0, 1.1, -22); doorMesh.castShadow = true; scene.add(doorMesh);
const door = col.addBox(new THREE.Box3().setFromObject(doorMesh));
let bangs = 0;

// the pretend boat: a still frame at the origin
const boatRoot = new THREE.Group(); scene.add(boatRoot); boatRoot.updateMatrixWorld(true);
const _inv = new THREE.Matrix4();
const boat = {
  root: boatRoot,
  toWorld: (v, out = new THREE.Vector3()) => out.copy(v).applyMatrix4(boatRoot.matrixWorld),
  toLocal: (v, out = new THREE.Vector3()) => out.copy(v).applyMatrix4(_inv.copy(boatRoot.matrixWorld).invert()),
};

// you
const input = new Input(canvas);
canvas.addEventListener('click', () => { if (!input.locked) input.lock(); });
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const player = {
  pos: new THREE.Vector3(0, 0, 8), vel: new THREE.Vector3(), yaw: 0, pitch: 0, zone: null, onGround: true, crouch: false,
  eye: new THREE.Vector3(),
  get eyeBoat() { return this.eye.set(this.pos.x, this.pos.y + (this.crouch ? 1.1 : 1.66), this.pos.z); },
  lookDir(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyAxisAngle(X, this.pitch).applyAxisAngle(Y, this.yaw); },
};
const _seg = new THREE.Line3(new THREE.Vector3(), new THREE.Vector3());
function move(dt) {
  const [mx, my] = input.look();
  player.yaw -= mx * 0.0022; player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - my * 0.0022));
  if (input.hit('KeyC')) player.crouch = !player.crouch;
  let fx = 0, fz = 0;
  if (input.key('KeyW')) fz -= 1;
  if (input.key('KeyS')) fz += 1;
  if (input.key('KeyA')) fx -= 1;
  if (input.key('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz);
  const run = input.key('ShiftLeft') && !player.crouch && stats.canRun;
  const speed = player.crouch ? 0.9 : run ? 3.4 : 1.75;
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
  let wx = 0, wz = 0;
  if (len) { fx /= len; fz /= len; wx = fx * c + fz * s; wz = -fx * s + fz * c; }
  const k = 1 - Math.exp(-14 * dt);
  player.vel.x += (wx * speed - player.vel.x) * k; player.vel.z += (wz * speed - player.vel.z) * k;
  const p = player.pos;
  p.x += player.vel.x * dt; p.z += player.vel.z * dt;
  _seg.start.set(p.x, p.y + 0.6, p.z); _seg.end.set(p.x, p.y + 1.5, p.z);
  const bx = _seg.start.x, bz = _seg.start.z;
  col.resolve(_seg, 0.3);
  p.x += _seg.start.x - bx; p.z += _seg.start.z - bz;
  const f = col.floorAt(p.x, p.y + 0.4, p.z, 2);
  if (f !== null) p.y = f;
  return run && len > 0;
}

// what they'd have said
const heardEl = document.getElementById('heard');
const heard = [];
const say = (line) => { heard.unshift(`${clock.toFixed(1).padStart(6)}  ${line}`); heard.length = Math.min(heard.length, 12); heardEl.textContent = heard.join('\n'); };
const audio = {
  horror: {
    creature: (n, p) => say(`${n}  ${p ? p.distanceTo(camera.position).toFixed(0) + ' m' : ''}`),
    stinger: (n) => say(`STINGER ${n}`),
    chase: (on) => say(`chase ${on ? 'on' : 'off'}`),
    sfx: (n) => say(`sfx ${n}`),
  },
};

const stats = new Stats();
stats.god = true;
const enemies = new Enemies({ scene, boat, model: { collision: col }, audio, stats, player, camera, lighting: null });
window.__enemies = enemies;
enemies.onHit = (e, kind, dmg) => { say(`HIT by ${e.name}: ${kind} ${dmg.toFixed(0)}`); document.body.style.boxShadow = 'inset 0 0 120px rgba(200,0,0,0.8)'; setTimeout(() => (document.body.style.boxShadow = ''), 180); };
enemies.onDeath = (e) => say(`DEATH ${e.name}`);
enemies.onSeen = (e) => say(`SEEN by ${e.name}`);
enemies.onAlert = (e) => say(`ALERT ${e.name}`);
const hud = document.getElementById('hud'), list = document.getElementById('list');
hud.textContent = 'loading the creatures...';
await enemies.load();

// the buttons
const ahead = (d) => { const l = player.lookDir(); l.y = 0; l.normalize(); return player.pos.clone().addScaledVector(l, d); };
const SPAWN = {
  Bear: ['bear', {}],
  'Bear, carcass': ['bear', { carcass: true, blood: 0.8 }],
  'Bear, stalking': ['bear', { state: 'stalk' }],
  Glaciologist: ['turned_a', { state: 'wander' }],
  Scientist: ['turned_b', { state: 'idle' }],
  Soldier: ['turned_c', { state: 'wander' }],
  Crawler: ['turned_b', { state: 'wander', crawler: true }],
  Gromov: ['gromov', { state: 'idle' }],
  Sitter: ['turned_a', { state: 'dormant', pose: 'sit' }],
  Feeder: ['turned_c', { state: 'dormant', pose: 'feed' }],
  Corpse: ['turned_b', { state: 'dormant', pose: 'dead' }],
  Shade: ['shade', { delay: 1 }],
};
const spawnRow = document.getElementById('spawn');
for (const [label, [kind, o]] of Object.entries(SPAWN)) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    const at = ahead(12);
    const opts = { ...o, yaw: player.yaw + (o.pose === 'sit' ? Math.PI / 2 : 0), home: { pos: at.clone(), radius: 10 } };
    if (o.carcass) opts.carcass = at.clone().add(new THREE.Vector3(1.5, 0, 0));
    if (kind === 'shade') opts.area = { pos: player.pos.clone(), radius: 80 };
    enemies.spawn(kind, at, opts);
  };
  spawnRow.append(b);
}
const toggle = (id, fn) => { const b = document.getElementById(id); b.onclick = () => { b.classList.toggle('on'); fn(b.classList.contains('on')); }; };
toggle('debug', (on) => enemies.debug(on));
toggle('god', (on) => { stats.god = on; if (on) stats.reset(); });
let night = true;
toggle('dark', (on) => { night = on; sky.intensity = on ? 0.35 : 1.4; moon.intensity = on ? 0.5 : 2; });
document.getElementById('clear').onclick = () => { enemies.clear(); door.on = true; doorMesh.visible = true; bangs = 0; };

// the guns, as rays: what they do to a creature, how far they carry
const GUNS = { pm: 34, mosin: 120, akm: 42, flaregun: 60 };
let gun = 'pm', cool = 0, torchOn = false;
const flares = [];
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
function fire() {
  camera.getWorldPosition(_o); camera.getWorldDirection(_d);
  const wall = col.raycast(_o, _d, 300);
  const hit = enemies.raycast(_o, _d, Math.min(300, wall));
  enemies.shot(gun, _o.clone());
  if (hit) {
    const r = hit.target.damage(GUNS[gun], hit.point, _d.clone(), gun);
    say(`shot ${hit.target.name} in the ${hit.part}: ${r ? r.damage.toFixed(0) : 0}${r?.killed ? ' (killed)' : ''}${r?.burning ? ' (alight)' : ''}`);
  }
  if (gun === 'flaregun') {
    const d = hit ? hit.distance : Math.min(wall, 40);
    flares.push({ pos: _o.clone().addScaledVector(_d, d - 0.1).setY(0.05), burning: true, t: 30 });
  }
}

// the loop
const clock0 = performance.now();
let last = performance.now(), hudT = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now; clock = (now - clock0) / 1000;
  const running = input.locked ? move(dt) : (input.look(), false);
  camera.position.copy(player.eyeBoat);
  camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  camera.updateMatrixWorld();
  if (input.hit('KeyF')) torchOn = !torchOn;
  torch.intensity = torchOn ? 40 : 0;
  for (const [k, g] of [['Digit1', 'pm'], ['Digit2', 'mosin'], ['Digit3', 'akm'], ['Digit4', 'flaregun']]) if (input.hit(k)) gun = g;
  cool -= dt;
  if (input.locked && cool <= 0 && (input.mouseClicked || (gun === 'akm' && input.mouseDown))) { fire(); cool = gun === 'akm' ? 0.1 : gun === 'mosin' ? 1.1 : 0.3; }
  for (const f of flares) { f.t -= dt; f.burning = f.t > 0; }
  while (flares.length && !flares[0].burning) flares.shift();
  const lit = flares[flares.length - 1];
  flareLight.intensity = lit ? 30 * (0.8 + 0.2 * Math.random()) : 0;
  if (lit) flareLight.position.copy(lit.pos).setY(0.4);
  stats.update(dt, { outdoors: true, running, crouching: player.crouch, flashlightOn: torchOn });
  enemies.update(dt, {
    flashlight: { on: torchOn, range: 30 }, dark: night ? 0.9 : 0.15, indoor: false,
    running, crouching: player.crouch, flares,
    onDoorBang: (d) => { if (d === door && ++bangs >= 2) { door.on = false; doorMesh.visible = false; say('the door gives'); } },
  });
  if ((hudT -= dt) <= 0) {
    hudT = 0.2;
    hud.textContent = `health ${stats.health.toFixed(0)}  warmth ${stats.warmth.toFixed(0)}  fear ${stats.fear.toFixed(2)}  stamina ${stats.stamina.toFixed(0)}\n${gun}${torchOn ? '  light' : ''}${player.crouch ? '  crouched' : ''}${stats.dead ? '  DEAD (god resets)' : ''}`;
    list.textContent = enemies.list.map((c) => `${c.name.padEnd(10)} ${String(c.state).padEnd(11)} a ${(c.sense?.awareness ?? 0).toFixed(2)} hp ${Math.max(0, c.health).toFixed(0).padStart(4)} ${c.dp.toFixed(1)} m`).join('\n');
  }
  renderer.render(scene, camera);
  input.endFrame();
  requestAnimationFrame(frame);
}
hud.textContent = '';
requestAnimationFrame(frame);
