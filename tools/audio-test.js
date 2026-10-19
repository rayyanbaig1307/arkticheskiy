import * as THREE from 'three';
import { Audio } from '../src/audio/Audio.js';

// The sound test bench for tools/audio-test.html (on the dev server: /tools/audio-test.html). Every
// sound and bed in src/audio on a button or a slider, driven through the same API the game uses:
// a camera for the listener at the origin, a pretend boat (speed, revs, ice load), the inside/outside
// and room controls, and a list of places for the one-shots to happen.

const audio = new Audio();
window.__audio = audio;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 5000);
camera.position.set(0, 1.7, 0);
scene.add(camera);
const thing = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); scene.add(o); return o; };
const radios = { bridge: thing(-2.5, 1.4, -2), mess: thing(3, 1.2, 1.5) };
const kettleObj = thing(1.5, 1, -1.2);
const enginePos = new THREE.Vector3(0, -2.5, 6), bowPos = new THREE.Vector3(0, 0, -20), hornPos = new THREE.Vector3(0, 12, 4);

const st = { indoor: 0, zone: '', wind: 0.6, night: 1, speed: 3, rpm: 0.55, load: 0, engineOn: true, turn: false };
let rpm = 0.55;
const WHERE = {
  '2D (no position)': null,
  'In front, 3 m': [0, 1.2, -3],
  'Left, 8 m': [-8, 1, 0],
  'Right, 8 m': [8, 1, 0],
  'Behind, 15 m': [0, 0, 15],
  'Below, 4 m': [0, -2.3, 0],
  'On the ice, 60 m': [-40, 0, -45],
  'Far, 400 m': [250, 0, -310],
};
let where = null;
const at = () => (where ? new THREE.Vector3(where[0], where[1], where[2]) : null);

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
  b.onclick = () => fn(b);
  row.append(b);
  return b;
};
const toggle = (row, label, fn, on = false) => {
  const b = button(row, label, () => { on = !on; b.classList.toggle('on', on); fn(on); });
  b.classList.toggle('on', on);
  b.set = (v) => { on = v; b.classList.toggle('on', on); };
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
const select = (row, label, options, fn) => {
  const l = document.createElement('label'), s = document.createElement('select');
  for (const k of options) { const o = document.createElement('option'); o.value = k; o.textContent = k || '(none)'; s.append(o); }
  s.onchange = () => fn(s.value);
  l.append(label, s);
  row.append(l);
  return s;
};

// ------------------------------------------------------------ the bench
let row = section('Mix and the world');
slider(row, 'Volume', 0, 1, 0.01, 0.8, (v) => audio.setVolume(v));
toggle(row, 'Music', (on) => audio.setMusic(on), true);
slider(row, 'Indoor', 0, 1, 0.01, 0, (v) => { st.indoor = v; });
select(row, 'Zone', ['', 'engine', 'engine_stair', 'mess', 'hall', 'lobby', 'bridge', 'cabin'], (z) => {
  st.zone = z;
  st.indoor = z && z !== 'engine_stair' ? 1 : 0;
});
row = section('Weather and the boat');
slider(row, 'Wind', 0, 1, 0.01, st.wind, (v) => { st.wind = v; });
slider(row, 'Night', 0, 1, 0.01, st.night, (v) => { st.night = v; });
slider(row, 'Speed m/s', 0, 7, 0.1, st.speed, (v) => { st.speed = v; });
slider(row, 'Revs', 0.25, 1, 0.01, st.rpm, (v) => { st.rpm = v; });
slider(row, 'Ice load', 0, 1, 0.01, 0, (v) => { st.load = v; });
const engBtn = toggle(row, 'Engine on (no sequence)', (on) => { st.engineOn = on; }, true);
toggle(row, 'Turn the listener', (on) => { st.turn = on; });

row = section('Where one-shots play');
select(row, 'Position', Object.keys(WHERE), (k) => { where = WHERE[k]; });

row = section('Footsteps (heavy winter boots)');
let walker = 0;
for (const s of ['step_metal', 'step_grate', 'step_floor', 'step_ladder']) button(row, s.slice(5), () => audio.sfx(s, at()));
const walkBtns = [];
for (const s of ['step_metal', 'step_grate', 'step_floor', 'step_ladder']) {
  const b = toggle(row, 'walk on ' + s.slice(5), (on) => {
    clearInterval(walker);
    for (const o of walkBtns) if (o !== b) o.set(false);
    if (on) walker = setInterval(() => audio.sfx(s, at()), s === 'step_ladder' ? 620 : 480);
  });
  walkBtns.push(b);
}

row = section('Doors, switches, the telegraph');
for (const s of ['door_open', 'door_close', 'locked', 'click', 'switch', 'button', 'telegraph', 'clank', 'clunk']) button(row, s, () => audio.sfx(s, at()));

row = section('Ship');
button(row, 'Horn', () => audio.horn(where ? at() : hornPos));
button(row, 'Start the engine', () => {
  if (st.engineOn) return;                                              // (as in the game: from stopped)
  rpm = 0;
  audio.engineStart();
  setTimeout(() => { st.engineOn = true; engBtn.set(true); }, 2600);   // (the boat reports it running)
});
button(row, 'Stop the engine', () => { st.engineOn = false; engBtn.set(false); audio.engineStop(); });
toggle(row, 'Bridge radio', (on) => audio.radio('bridge', on, radios.bridge));
toggle(row, 'Mess radio', (on) => audio.radio('mess', on, radios.mess));
toggle(row, 'Kettle', (on) => audio.kettle(on, kettleObj));

row = section('Ice');
let strength = 0.7;
slider(row, 'Strength', 0, 1, 0.01, strength, (v) => { strength = v; });
button(row, 'Big hit', () => audio.iceHit(at() || bowPos, strength, true));
button(row, 'Floe scraping along', () => audio.iceHit(at() || bowPos, strength, false));
button(row, 'Distant crack or groan', () => audio.built && audio._iceFar());

row = section('The hull, the sea, the birds');
button(row, 'Hull groan or creak', () => audio.built && audio._hull(0, 1));
button(row, 'Wave slap', () => audio.built && audio._slap(st.speed / 7));
button(row, 'Gull', () => audio.built && audio._gull());

row = section('Animals');
for (const k of ['walrus_grunt', 'walrus_roar', 'penguin_call', 'penguin_alarm']) button(row, k, () => audio.animal(k, at() || new THREE.Vector3(-25, 0, -30)));

row = section('Voices');
for (const s of [1.5, 4, 12]) button(row, `crew murmur ${s} s`, () => audio.voice(at() || new THREE.Vector3(1.2, 1.6, -1.5), s));

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
  camera.updateMatrixWorld();
  scene.updateMatrixWorld();
  rpm += ((st.engineOn ? st.rpm : 0) - rpm) * Math.min(1, dt * 1.2);
  audio.update(dt, {
    camera, indoor: st.indoor, zone: st.zone || null,
    boat: { speed: st.speed, rpm, engineOn: st.engineOn, load: st.load, x: 0, z: 0, heading: 0 },
    enginePos, bowPos, night: st.night, wind: st.wind,
  });
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
setInterval(() => {
  const c = audio.ctx;
  status.textContent = c ? `${c.state} · ${c.sampleRate} Hz · ${audio.playing.length} one-shots · engine ${audio.engState}` : 'not started';
}, 250);
