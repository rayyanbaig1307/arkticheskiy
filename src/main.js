import * as THREE from 'three';
import { QUALITY, loadSettings, saveSettings } from './core/Settings.js';
import { Input } from './core/Input.js';
import { Post } from './core/Post.js';
import { loadGLB, tryGLB } from './core/Assets.js';
import { UI } from './ui/UI.js';
import { installAtmos, atmos } from './world/Atmos.js';
import { Waves } from './world/Waves.js';
import { Sky } from './world/Sky.js';
import { Ocean } from './world/Ocean.js';
import { Lighting } from './world/Lighting.js';
import { Reflection, NO_REFLECT } from './world/Reflection.js';
import { IceField, standInShapes } from './world/IceField.js';
import { makeIceMaterial } from './world/IceMaterial.js';
import { iceShapes } from './world/IceShapes.js';
import { Boat } from './boat/Boat.js';
import { BoatModel } from './boat/BoatModel.js';
import { Lights } from './boat/Lights.js';
import { Player } from './player/Player.js';
import { Interactions } from './interactions/Interactions.js';
import { Stations } from './interactions/Stations.js';
import { angleDiff } from './core/util.js';
import { Perf } from './core/Perf.js';
import { loadPeople } from './characters/People.js';
import { Crew } from './characters/Crew.js';
import { Animals } from './animals/Animals.js';
import { Weather } from './world/Weather.js';
import { Foam } from './world/Foam.js';
import { Radar } from './boat/Radar.js';
import { Audio } from './audio/Audio.js';

// ПОЛЯРНИК: boot, the loop, and the wiring between systems. window.__game is the debug and test
// hook (the preview harness drives the game through it).

async function boot() {
  const settings = loadSettings();
  const quality = QUALITY[settings.quality] || QUALITY.medium;
  const ui = new UI(settings);
  const canvas = document.getElementById('game');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * quality.scale);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;          // (tone mapping is a post pass: core/Post.js)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  installAtmos();

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.001);        // (switches the fog chunks on; Atmos.js does the fog)
  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.08, 9000);
  camera.layers.enable(NO_REFLECT);
  scene.add(camera);
  const input = new Input(canvas);

  ui.loading('The sea', 0.05);
  const waves = new Waves(quality.waves);
  const sky = new Sky({ renderer, quality });
  scene.add(sky.mesh);
  sky.setTime(settings.timeOfDay, true);
  const lighting = new Lighting({ scene, camera, quality });
  const ocean = new Ocean({ waves, quality, sky });
  scene.add(ocean.mesh);
  const reflection = new Reflection(renderer, scene, camera, quality.reflection);
  reflection.hide(ocean.mesh);
  reflection.interval = quality.cascades >= 3 ? 1 : 2;
  ocean.uniforms.tReflect.value = reflection.rt.texture;
  ocean.uniforms.uReflectMatrix.value = reflection.matrix;
  ocean.uniforms.uReflectOn.value = reflection.enabled ? 1 : 0;

  // the boat
  ui.loading('The Polyarnik', 0.15);
  const boat = new Boat({ waves });
  scene.add(boat.root);
  const tug = await loadGLB('models/tug.glb', (p) => ui.loading('The Polyarnik', 0.15 + p * 0.35));
  const model = new BoatModel(tug.scene, { quality, lighting });
  boat.root.add(tug.scene);
  const info = model.nodes.BOAT_info?.userData;
  if (info?.hull) ocean.setHull(info.hull, info.hullZ[0], info.hullZ[1]);
  const lights = new Lights({ boat, model, count: quality.cascades >= 3 ? 5 : quality.cascades === 2 ? 4 : 3 });

  // the ice
  ui.loading('The ice', 0.6);
  const iceMat = makeIceMaterial(lighting, waves);
  const iceGLB = await tryGLB('models/icebergs.glb');
  const shapes = iceGLB ? iceShapes(iceGLB) : standInShapes();
  const ice = new IceField({ scene, waves, material: iceMat, shapes, quality });

  // you
  const player = new Player({ camera, input, boat, model, settings });
  player.spawn(model.spots.spawn || { pos: new THREE.Vector3(0, 3, 10), yaw: 0 });
  const interactions = new Interactions({ camera, input, ui });
  interactions.addBlockers(model.merged);
  // the sound (everything synthesised: audio/); it starts on the first click
  const audio = new Audio();
  const ctx = { model, boat, player, ui, input, lights, quality, interactions, audio, night: () => sky.params.moon };
  const stations = new Stations(ctx);

  // the crew and the soldiers
  ui.loading('The crew', 0.68);
  const peopleData = await loadPeople((p) => ui.loading('The crew', 0.68 + p * 0.12));
  const crew = new Crew({ data: peopleData, boat, model, lighting, interactions, ui, audio, camera, quality });
  boat.on((kind, d) => {
    if (kind === 'engine' && !d) crew.moment('engineOff');
    if (kind === 'hit' && d.big) crew.moment('iceHit');
  });
  // the animals on the ice
  ui.loading('Walruses and penguins', 0.82);
  const animals = new Animals({ scene, ice, audio, lighting });
  await animals.load();
  // snow and breath, the foam map, the radar screen
  const weather = new Weather({ scene, quality, boat, model });
  const foam = new Foam({ renderer, ice, boat, hull: info });
  ocean.uniforms.tFoamMap.value = foam.rt.texture;
  ocean.uniforms.uFoamSize.value = foam.size;
  ocean.uniforms.uFoamOn.value = 1;
  const radar = new Radar({ model, ice, boat, stations });
  ctx.onEvent = (kind, data) => {
    if (kind === 'horn') { crew.moment('horn'); animals.horn(data); }
    if (kind === 'kettle') crew.moment('kettle');
  };
  // sounds from the world
  ice.onHit = (p, strength, point, big) => audio.iceHit(point, strength, big);
  player.onStep = (kind) => audio.sfx('step_' + kind, null, { gain: player.input.key('ShiftLeft') ? 1 : 0.75 });
  const enginePos = new THREE.Vector3(), bowPos = new THREE.Vector3();
  const ENGINE = new THREE.Vector3(0, 0.4, 3), BOW = new THREE.Vector3(0, 0.3, -19);

  // the autopilot: wander through the field, steering round anything big ahead
  let wander = 0, wanderT = 0;
  boat.pilot = (b) => {
    wanderT -= 1 / 60;
    if (wanderT <= 0) { wanderT = 25 + Math.random() * 30; wander = (Math.random() - 0.5) * 0.9; }
    let want = b.heading + wander * 0.02;
    const f = b.forward;
    let avoid = 0;
    for (const p of ice.near(b.x, b.z, 420)) {
      if (p.cls !== 'berg' && p.cls !== 'bit') continue;
      const dx = p.x - b.x, dz = p.z - b.z;
      const ahead = dx * f.x + dz * f.z;
      if (ahead < 0) continue;
      const side = dx * -f.z + dz * f.x;             // + to port
      const clear = p.shape.radius * p.scale + 35;
      if (Math.abs(side) < clear) avoid += (side > 0 ? -1 : 1) * (1 - Math.abs(side) / clear) * (1 - ahead / 420) * 2.2;
    }
    want += avoid * 0.5;
    return b.heading + Math.max(-0.5, Math.min(0.5, angleDiff(b.heading, want)));
  };

  // post
  const post = new Post(renderer, scene, camera, quality);
  const perf = new Perf(renderer);
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    post.setSize(w, h); reflection.setSize(renderer.domElement.width, renderer.domElement.height);
    lighting.resize();
  };
  addEventListener('resize', resize); resize();

  // play / pause
  let playing = false;
  const play = async () => {
    input.lock();
    try {
      await audio.start();
      audio.setVolume(settings.volume); audio.setMusic(settings.music);
      // (the mess radio plays from the start: its music drifts out of the mess door)
      const mr = stations.radios.mess; if (mr?.on) audio.radio('mess', true, mr.node);
    } catch (e) { console.warn('[Arctic Tug] no sound', e); }
  };
  ui.onPlay = play;
  ui.onVolume = (v) => audio.setVolume(v);
  ui.onMusic = (on) => audio.setMusic(on);
  ui.onTime = (k) => sky.setTime(k);
  input.onLockChange = (locked) => { playing = locked; ui.setPlaying(locked); };
  addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); ui.toggleFps(); } });

  // warm up: compile the shaders before the first frame is shown
  ui.loading('Lighting the lamps', 0.85);
  sky.update(0, camera); sky.updateEnv(scene, 1);
  boat.update(0.016); player.update(0.016); ice.update(0.016, boat);
  lighting.update(camera, sky.params);
  await renderer.compileAsync(scene, camera);

  // the loop
  const clock = new THREE.Clock();
  let t = 0, frames = 0, fpsT = 0, fpsMs = 0;
  const frame = () => {
    const raw = clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    t += dt;
    atmos.uTime.value = t;
    waves.scale = sky.params.seaState;
    waves.update(dt);
    // (the boat moves first, then you on her, then the camera: no lag between deck and view)
    if (playing) stations.update(dt);
    boat.update(dt);
    if (playing) player.update(dt);
    else { input.look(); player.place(dt); }
    interactions.enabled = playing && !stations.at;
    interactions.update();
    ice.update(dt, boat);
    crew.update(dt, player);
    animals.update(dt, boat, camera);
    weather.update(dt, { camera, params: sky.params, crew, animals, player, indoor: !!player.zone });
    radar.update(dt);
    audio.update(dt, {
      camera, zone: player.zone, indoor: atmos.uIndoor.value,
      boat: { speed: boat.speed, rpm: boat.rpm, engineOn: boat.engineOn, load: boat.load, x: boat.x, z: boat.z, heading: boat.heading },
      enginePos: boat.toWorld(ENGINE, enginePos), bowPos: boat.toWorld(BOW, bowPos),
      night: sky.params.moon, wind: 0.55 + 0.25 * sky.params.clouds,
    });
    model.update(boat.root);
    lights.scale = sky.params.lamps;
    lights.update(dt, player.pos, player.zone);
    atmos.uIndoor.value += ((player.zone && player.zone !== 'engine_stair' ? 1 : 0) - atmos.uIndoor.value) * Math.min(1, dt * 3);
    sky.update(dt, camera);
    sky.updateEnv(scene, dt);
    ocean.update(camera, boat.root, sky.params);
    lighting.update(camera, sky.params);
    post.setExposure(sky.params.exposure);
    post.setFocus(interactions.lookDist, dt);
    ui.update(dt);
    renderer.info.reset();
    perf.begin();
    foam.update();
    ocean.uniforms.uFoamCenter.value.copy(foam.center);
    reflection.update(0);
    post.render(dt, t);
    perf.end();
    input.endFrame();
    frames++; fpsT += raw; fpsMs += raw * 1000;
    if (fpsT > 0.5) {
      const i = renderer.info.render;
      const gpu = perf.median;
      ui.fps(`${Math.round(frames / fpsT)} fps  ${(fpsMs / frames).toFixed(1)} ms  gpu ${gpu ? gpu.toFixed(1) : '?'} ms\ndraws ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k  ${quality.name}`);
      window.__fps = frames / fpsT;
      frames = 0; fpsT = 0; fpsMs = 0;
    }
  };
  let raf = true;
  const loop = () => { frame(); if (raf) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  ui.ready();
  window.__game = {
    THREE, perf, audio, crew, animals, weather, foam, radar, scene, camera, renderer, boat, model, player, ice, sky, ocean, waves, stations, lights, post, ui, input, settings, quality, reflection, lighting,
    // (the hidden preview pane never fires rAF: drive the loop with a timer instead)
    kick(ms = 33) { raf = false; clearInterval(this._iv); this._iv = setInterval(frame, ms); },
    step(n = 1) { for (let i = 0; i < n; i++) frame(); },
    play() { playing = true; ui.setPlaying(true); },
    // (test harness) draw a frame and pin it over the page, so a screenshot of a hidden pane
    // shows this frame and not a stale one; unsnap() takes it away
    snap() {
      frame();
      const url = renderer.domElement.toDataURL('image/jpeg', 0.88);
      let img = document.getElementById('__snap');
      if (!img) { img = document.createElement('img'); img.id = '__snap'; img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:999;pointer-events:none'; document.body.appendChild(img); }
      img.src = url;
      return url.length;
    },
    unsnap() { document.getElementById('__snap')?.remove(); },
  };
  void tryGLB; void saveSettings;
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('loadtext').textContent = 'Failed to start: ' + (e?.message || e);
});
