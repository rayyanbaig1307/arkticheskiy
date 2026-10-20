import * as THREE from 'three';
import { Audio } from '../src/audio/Audio.js';

// The horror's test bench for tools/horror-audio-test.html (on the dev server:
// /tools/horror-audio-test.html). Every name in CONTRACTS.md's Sounds section on a button, toggle or
// slider, driven through audio.horror exactly as the game calls it: a camera for the listener at the
// origin, a list of places for the one-shots, objects for the positional loops, and the place, fear,
// blizzard and chase controls. A few sequences (a burst, a bolt cycle, a reload) show the foley in
// context.

const audio = new Audio();
window.__audio = audio;
const H = () => audio.horror;            // (exists once started)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 5000);
camera.position.set(0, 1.7, 0);
scene.add(camera);
const thing = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); scene.add(o); return o; };
const loopAt = {
  generator: thing(-6, 1, -5), lights_buzz: thing(0, 3, -1), radio_static: thing(2, 1.2, -1.5),
  guest_heart: thing(0, -6, -25), drip: thing(-3, 2.5, 2), fire: thing(2.5, 0.6, 1.5),
};

const st = { indoor: 0, turn: false, gunIndoor: 'auto', brass: true };
const WHERE = {
  'In front, 4 m': [0, 1.2, -4],
  '2D (no position)': null,
  'Left, 8 m': [-8, 1, 0],
  'Right, 8 m': [8, 1, 0],
  'Behind, 6 m': [0, 1, 6],
  'Above, 4 m': [0, 5.5, 0],
  'Out on the ice, 60 m': [-40, 0, -45],
  'Far, 300 m': [190, 0, -230],
};
let where = [0, 1.2, -4];
const at = () => (where ? new THREE.Vector3(where[0], where[1], where[2]) : null);
const muzzle = () => new THREE.Vector3(0.15, 1.55, -0.5);          // your own gun, in your hands

// ------------------------------------------------------------ a little UI kit
const ui = document.getElementById('ui');
const section = (title) => {
  const h = document.createElement('h2'); h.textContent = title; ui.append(h);
  const d = document.createElement('div'); d.className = 'row'; ui.append(d);
  return d;
};
const button = (row, label, fn) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { if (audio.built) fn(b); };
  row.append(b);
  return b;
};
const toggle = (row, label, fn, on = false) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.classList.toggle('on', on);
  b.onclick = () => { if (!audio.built) return; on = !on; b.classList.toggle('on', on); fn(on); };
  b.set = (v) => { on = v; b.classList.toggle('on', on); };
  row.append(b);
  return b;
};
const slider = (row, label, min, max, step, value, fn) => {
  const l = document.createElement('label'), i = document.createElement('input'), o = document.createElement('output');
  i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = value;
  o.textContent = (+value).toFixed(2);
  i.oninput = () => { o.textContent = (+i.value).toFixed(2); fn(+i.value); };
  l.append(label, i, o);
  row.append(l);
  return i;
};
const select = (row, label, options, fn, value) => {
  const l = document.createElement('label'), s = document.createElement('select');
  for (const k of options) { const o = document.createElement('option'); o.value = k; o.textContent = k || '(none)'; s.append(o); }
  if (value !== undefined) s.value = value;
  s.onchange = () => fn(s.value);
  l.append(label, s);
  row.append(l);
  return s;
};
const later = (ms, fn) => setTimeout(() => { if (audio.built) fn(); }, ms);
const names = (row, list, fn) => { for (const n of list) button(row, n, () => fn(n)); };

// ------------------------------------------------------------ the bench
let row = section('Mix, place and you');
slider(row, 'Volume', 0, 1, 0.01, 0.8, (v) => audio.setVolume(v));
toggle(row, 'Music', (on) => audio.setMusic(on), true);
select(row, 'Place', ['', 'sea', 'station', 'storm', 'interior', 'bunker', 'cave', 'boat_dead'], (k) => H().setAmbience(k || null));
slider(row, 'You inside', 0, 1, 0.01, 0, (v) => { st.indoor = v; });
slider(row, 'Blizzard', 0, 1, 0.01, 0, (v) => H().setBlizzard(v));
slider(row, 'Fear', 0, 1, 0.01, 0, (v) => H().setFear(v));
toggle(row, 'Chase', (on) => H().chase(on));
toggle(row, 'Turn the listener', (on) => { st.turn = on; });
row = section('Where one-shots play');
select(row, 'Position', Object.keys(WHERE), (k) => { where = WHERE[k]; }, 'In front, 4 m');

row = section('Guns (fired from your hands)');
select(row, 'Room', ['auto', 'outdoors', 'indoors'], (v) => { st.gunIndoor = v; });
toggle(row, 'Brass after each shot', (on) => { st.brass = on; }, true);
const fire = (kind) => {
  const o = st.gunIndoor === 'auto' ? {} : { indoor: st.gunIndoor === 'indoors' };
  H().gun(kind, muzzle(), o);
  if (st.brass && kind !== 'flaregun' && kind !== 'mosin') later(380 + Math.random() * 200, () => H().sfx(st.gunIndoor === 'outdoors' ? 'shell_brass_snow' : 'shell_brass', new THREE.Vector3(0.6, 0, -0.6)));
};
for (const k of ['pm', 'mosin', 'akm', 'flaregun']) button(row, k, () => fire(k));
button(row, 'AKM burst (10 at 600/min)', () => { for (let i = 0; i < 10; i++) later(i * 100, () => fire('akm')); });
button(row, 'Mosin: shot, bolt', () => { fire('mosin'); later(700, () => H().sfx('mosin_bolt_open')); later(1150, () => H().sfx('shell_brass', new THREE.Vector3(0.5, 0, -0.4))); later(1300, () => H().sfx('mosin_bolt_close')); });
button(row, 'A shot far off (at Position)', () => H().gun('akm', at() || new THREE.Vector3(150, 0, -200)));

row = section('Weapon foley');
names(row, ['dry_fire', 'pm_mag_out', 'pm_mag_in', 'pm_slide', 'mosin_bolt_open', 'mosin_bolt_close', 'mosin_clip', 'mosin_round',
  'akm_mag_out', 'akm_mag_in', 'akm_charge', 'flare_open', 'flare_load', 'flare_close', 'flare_ignite', 'shell_brass', 'shell_brass_snow',
  'weapon_draw', 'weapon_holster'], (n) => H().sfx(n, null));
button(row, 'PM reload', () => { H().sfx('pm_mag_out'); later(700, () => H().sfx('pm_mag_in')); later(1150, () => H().sfx('pm_slide')); });
button(row, 'AKM reload', () => { H().sfx('akm_mag_out'); later(800, () => H().sfx('akm_mag_in')); later(1300, () => H().sfx('akm_charge')); });
button(row, 'Mosin reload', () => { H().sfx('mosin_bolt_open'); later(550, () => H().sfx('mosin_clip')); later(1550, () => H().sfx('mosin_bolt_close')); });
button(row, 'Flare reload', () => { H().sfx('flare_open'); later(450, () => H().sfx('flare_load')); later(900, () => H().sfx('flare_close')); });

row = section('Bullets landing (at Position)');
names(row, ['hit_flesh', 'hit_ice', 'hit_metal', 'hit_concrete', 'hit_snow', 'hit_wood'], (n) => H().sfx(n, at()));

row = section('Things (at Position)');
names(row, ['pickup', 'pickup_ammo', 'pickup_key', 'paper', 'locker_open', 'locker_close', 'door_bang', 'door_creak', 'door_locked',
  'door_heavy', 'metal_scrape', 'metal_groan', 'ice_crack', 'ice_collapse', 'light_pop', 'lights_on', 'generator_start',
  'generator_fail', 'radio_burst', 'body_fall', 'glass_break', 'chain_rattle', 'footsteps_above', 'knock_hull', 'scream_distant', 'explosion'],
(n) => H().sfx(n, at()));

row = section('You (in your head)');
names(row, ['heartbeat_spike', 'breath_gasp', 'pain', 'pain_cold', 'death'], (n) => H().sfx(n, null));

row = section('The Turned (at Position)');
names(row, ['turned_idle', 'turned_alert', 'turned_scream', 'turned_attack', 'turned_hurt', 'turned_death', 'turned_step', 'turned_crawl'], (n) => H().creature(n, at()));
let walker = 0;
toggle(row, 'walking', (on) => { clearInterval(walker); if (on) walker = setInterval(() => audio.built && H().creature('turned_step', at()), 720); });
row = section('The Shades, the mimic (at Position; 2D: in your ear)');
names(row, ['shade_whisper', 'shade_wail', 'shade_touch', 'mimic_voice'], (n) => H().creature(n, at()));
row = section('Bears (at Position)');
names(row, ['bear_huff', 'bear_growl', 'bear_roar', 'bear_hurt', 'bear_death', 'bear_step'], (n) => H().creature(n, at()));
row = section('Gromov, the Guest (at Position)');
names(row, ['gromov_roar', 'gromov_step', 'guest_pulse'], (n) => H().creature(n, at()));

row = section('Stingers');
names(row, ['jump', 'jump_soft', 'reveal', 'dread', 'discovery', 'chase_start', 'chase_end', 'death', 'chapter'], (n) => H().stinger(n));

row = section('Loops on objects (generator left, buzz above, radio right, the Guest far below, drip behind left, fire behind right)');
for (const k of Object.keys(loopAt)) toggle(row, k, (on) => H().loop(k, loopAt[k], on));
button(row, 'Generator: start, then run', () => { H().sfx('generator_start', loopAt.generator.position); H().loop('generator', loopAt.generator, true); });

// ------------------------------------------------------------ start, and the frame loop
const status = document.getElementById('status');
document.getElementById('start').onclick = async (e) => {
  await audio.start();
  e.target.textContent = audio.built ? 'Running' : 'Start audio';
};
let last = performance.now();
const frame = (now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (st.turn) camera.rotation.y += dt * 0.35;
  scene.updateMatrixWorld();
  audio.update(dt, { camera, indoor: st.indoor, zone: null, boat: { speed: 0, rpm: 0, engineOn: false, load: 0 }, night: 1, wind: 0.4 });
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
setInterval(() => {
  const c = audio.ctx, h = audio.horror;
  if (!c || !h) { status.textContent = 'not started'; return; }
  const bufs = Object.values(h.bank.sets).reduce((a, s) => a + s.list.length, 0);
  status.textContent = `${c.state} · ${c.sampleRate} Hz · ${audio.playing.length} one-shots · ${bufs} buffers rendered · place ${h.place || 'none'} · fear ${h.fearS.toFixed(2)}`;
}, 250);
