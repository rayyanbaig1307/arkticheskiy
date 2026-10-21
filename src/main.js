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
import { Towline } from './boat/Towline.js';
import { Flag } from './boat/Flag.js';
import { Probes } from './boat/Probes.js';
import { Station, STATION_POS } from './world/Station.js';
import { Story } from './story/Story.js';
import { HorrorGame } from './horror/HorrorGame.js';
import { Director } from './story/Director.js';

// ПОЛЯРНИК: boot, the loop, and the wiring between systems. window.__game is the debug and test
// hook (the preview harness drives the game through it).

async function boot() {
  const settings = loadSettings();
  const quality = QUALITY[settings.quality] || QUALITY.medium;
  const ui = new UI(settings);
  const canvas = document.getElementById('game');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
  const BASE_PR = Math.min(window.devicePixelRatio, 1.5) * quality.scale;
  renderer.setPixelRatio(BASE_PR);
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
  sky.setTime('dread', true);                        // (the horror's own skies: the chapters change them)
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
  // Station Severny on its fast ice, the voyage's end (the ice field leaves its water open)
  ui.loading('Station Severny', 0.64);
  const station = new Station({ scene, lighting, iceMaterial: iceMat, quality });
  await station.load();
  ice.exclude = (x, z, r) => station.ready && station.blocks(x, z, r);

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
  ui.loading('The wildlife', 0.82);
  const animals = new Animals({ scene, ice, audio, lighting });
  await animals.load();
  // snow and breath, the foam map, the radar screen
  const weather = new Weather({ scene, quality, boat, model });
  const foam = new Foam({ renderer, ice, boat, hull: info });
  ocean.uniforms.tFoamMap.value = foam.rt.texture;
  ocean.uniforms.uFoamSize.value = foam.size;
  ocean.uniforms.uFoamOn.value = 1;
  const radar = new Radar({ model, ice, boat, stations });
  radar.land = () => station.outline();
  // the towline off the winch, the ensign
  const towline = new Towline({ scene, boat, model, waves });
  ctx.towline = towline;
  towline.onLimit = (end) => ui.toast(end === 'in' ? 'Towline home: the eye is at the roller.' : 'All the line is out.');
  const flag = new Flag(model.nodes.FLAG_stern);
  const winchPos = new THREE.Vector3(), WINCH = new THREE.Vector3(0, 3.65, 9.9);
  let switchRecapture = 0;
  ctx.onEvent = (kind, data) => {
    if (kind === 'switch') switchRecapture = 0.4;
    if (kind === 'horn') { crew.moment('horn'); animals.horn(data); }
    if (kind === 'kettle') crew.moment('kettle');
  };
  // sounds from the world
  ice.onHit = (p, strength, point, big) => audio.iceHit(point, strength, big);
  const boatWorld = new THREE.Vector3();
  player.onStep = (kind) => audio.sfx('step_' + kind, null, { gain: player.input.key('ShiftLeft') ? 1 : 0.75 });
  const enginePos = new THREE.Vector3(), bowPos = new THREE.Vector3();
  const ENGINE = new THREE.Vector3(0, 0.4, 3), BOW = new THREE.Vector3(0, 0.3, -19);

  // the mate has the helm, always (you don't steer her): every half second he looks along a fan of
  // headings either side of the course and takes the clearest one near it (no berg in her way for
  // 380 m, a berg's breadth and hers to spare; as little pack ice as he can; off the shelf's edge),
  // holding to his choice unless another is clearly better, so she doesn't weave. He goes full ahead
  // in open water and slows when something big is close ahead; the story's stops are its own.
  const pilot = { pick: null, t: 0, wander: 0, wanderT: 0 };
  const BIG = (p) => p.cls === 'berg' || (p.cls === 'bit' && p.scale > 1.1);
  boat.pilot = (b) => {
    const dt = 1 / 60;
    const tgt = director?.pilotTarget() || story?.pilotTarget();
    if ((pilot.wanderT -= dt) <= 0) { pilot.wanderT = 25 + Math.random() * 30; pilot.wander = (Math.random() - 0.5) * 0.6; }
    const course = tgt ? Math.atan2(-(tgt.x - b.x), -(tgt.z - b.z)) : (pilot.pick ?? b.heading) + pilot.wander * 0.01;
    if ((pilot.t -= dt) <= 0 || pilot.pick === null) {
      pilot.t = 0.5;
      const near = ice.near(b.x, b.z, 400);
      let best = course, bestCost = Infinity, blocked = Infinity;
      for (let k = -9; k <= 9; k++) {
        const h = course + k * 0.09;
        const fx = -Math.sin(h), fz = -Math.cos(h);
        let cost = Math.abs(k) * 0.6 + (pilot.pick === null ? 0 : Math.abs(angleDiff(pilot.pick, h)) * 3);
        let block = Infinity;
        for (const p of near) {
          const dx = p.x - b.x, dz = p.z - b.z, along = dx * fx + dz * fz;
          if (along < -8) continue;
          const side = Math.abs(dx * -fz + dz * fx), r = p.shape.radius * p.scale;
          if (BIG(p)) {
            const clear = r + 26;
            if (side < clear && along < 380) { block = Math.min(block, along); cost += 30 + 70 * (1 - Math.max(0, along) / 380) * (1 - side / clear); }
          } else if (side < r + 5 && along < 170) cost += (p.cls === 'floe' ? 0.9 * p.scale : 0.35) * (1 - along / 170);
        }
        if (station.ready) { const cl = station.clearance(b.x + fx * 200, b.z + fz * 200); if (cl < 140) cost += (140 - cl) * 0.6; }
        if (cost < bestCost) { bestCost = cost; best = h; blocked = block; }
      }
      pilot.pick = best;
      // her speed: full ahead in the clear, slow ahead with a berg close on the way she's going
      // (and no faster than the story allows: chapter 1 holds her back till its scenes have been)
      const cap = director?.pilotCap?.() ?? 3;
      if (b.engineOn && !b.docking && !b.moored && (b.order > 0 || pilot.capped)) {
        const near700 = tgt && Math.hypot(tgt.x - b.x, tgt.z - b.z) < 260;
        const want = Math.min(cap, blocked < 140 ? 1 : near700 ? 2 : 3);
        pilot.capped = want === 0;
        if (want !== b.order) b.setOrder(want);
      }
    }
    return b.heading + Math.max(-0.5, Math.min(0.5, angleDiff(b.heading, pilot.pick)));
  };

  let story = null, director = null;
  // post
  const post = new Post(renderer, scene, camera, quality);
  // the horror: your body, what you carry, the HUD and the journal, the flashlight, the guns, the
  // levels (made now, before the shaders compile: they add their lights once)
  const horror = new HorrorGame({ scene, camera, input, ui, audio, player, boat, model, station, lighting, post, interactions, quality, sky, crew, stations, renderer });
  ui.addOverlay(() => !!document.getElementById('keypad'));      // (a door's or the safe's keypad: no pause menu over it)
  ctx.horror = horror;
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
    } catch (e) { console.warn('[Arkticheskiy] no sound', e); }
  };
  ui.onPlay = play;
  // the story: a new game from chapter 1, or the last checkpoint
  ui.onNewGame = async () => { await play(); director.newGame(); };
  ui.onContinue = async () => { await play(); director.continueGame(); };
  ui.onVolume = (v) => audio.setVolume(v);
  ui.onMusic = (on) => audio.setMusic(on);
  ui.onVoiceLang = (lang) => crew.setLang(lang);
  crew.setLang(settings.voiceLang);
  ui.onTime = (k) => sky.setTime(k);
  input.onLockChange = (locked) => { playing = locked; ui.setPlaying(locked); };
  addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); ui.toggleFps(); } });

  // warm up: compile the shaders before the first frame is shown
  ui.loading('Lighting the lamps', 0.85);
  sky.update(0, camera); sky.updateEnv(scene, 1);
  boat.update(0.016); player.update(0.016); ice.update(0.016, boat);
  lighting.update(camera, sky.params);
  await renderer.compileAsync(scene, camera);
  // the rooms photographed for their own reflections (again when a switch changes their lights)
  ui.loading('Lighting the rooms', 0.92);
  const probes = new Probes({ renderer, scene, boat, model, lights, size: quality.envSize });
  boat.update(0.016); model.update(boat.root);
  probes.capture(player.pos, player.zone);
  horror.ctx.probes = probes;
  const recapture = () => { probes.capture(player.pos, player.zone); };

  // the loop
  const clock = new THREE.Clock();
  let freecam = null; const _fc = new THREE.Vector3(), _fl = new THREE.Vector3();
  // the title screen: a slow turn around her from off the quarter, high, with the ship to the
  // right of the words
  const _tr = new THREE.Vector3();
  const titleShot = () => {
    const a = 2.3 + t * 0.022;
    boat.toWorld(_fc.set(Math.cos(a) * 32, 9 + Math.sin(t * 0.13) * 0.5, -2 + Math.sin(a) * 32), _fc);
    boat.toWorld(_fl.set(0, 3.2, -2), _fl);
    _tr.subVectors(_fl, _fc).normalize().cross(camera.up).normalize();
    _fl.addScaledVector(_tr, -10);
    camera.position.copy(_fc); camera.lookAt(_fl); camera.updateMatrixWorld();
  };
  let erShown = true;
  let t = 0, frames = 0, fpsT = 0, fpsMs = 0;
  const gov = { scale: 1, slowT: 0, fastT: 0, ema: 1 / 60 };
  const applyScale = () => { renderer.setPixelRatio(BASE_PR * gov.scale); resize(); };
  const govern = (raw) => {
    if (!playing || raw > 0.25) return;                        // (paused, or the tab was away)
    gov.ema += (raw - gov.ema) * 0.06;
    const gpu = perf.median;
    if (gov.ema > 1 / 48) { gov.slowT += raw; gov.fastT = 0; }
    else if (gpu && gpu < 9 && gov.ema < 1 / 55) { gov.fastT += raw; gov.slowT = 0; }
    else { gov.slowT = Math.max(0, gov.slowT - raw); gov.fastT = 0; }
    if (gov.slowT > 1.5) {
      gov.slowT = 0;
      if (gov.scale > 0.62) { gov.scale = Math.max(0.6, +(gov.scale - 0.1).toFixed(2)); applyScale(); }
      else if (post.ao && post.ao.enabled) post.ao.enabled = false;
    } else if (gov.fastT > 5) {
      gov.fastT = 0;
      if (post.ao && !post.ao.enabled) post.ao.enabled = true;
      else if (gov.scale < 1) { gov.scale = Math.min(1, +(gov.scale + 0.1).toFixed(2)); applyScale(); }
    }
  };
  const frame = () => {
    const raw = clock.getDelta();
    govern(raw);
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
    if (!playing && !ui.started && !freecam) titleShot();
    if (freecam) {        // (test harness: a camera anywhere in boat space)
      camera.position.copy(boat.toWorld(freecam.pos, _fc)); camera.lookAt(boat.toWorld(freecam.look, _fl)); camera.updateMatrixWorld();
    }
    horror.ctx.freecam = !!freecam;
    horror.update(dt, { playing });
    interactions.enabled = playing && !stations.at;
    interactions.update();
    ice.update(dt, boat);
    station.collide(boat, (point, strength, big) => { audio.iceHit(point, strength, big); if (big) crew.moment('iceHit'); });
    station.update(dt, boatWorld.set(boat.x, 0, boat.z), sky.params.moon, t);
    if (playing) { story.update(dt); director?.update(dt); }
    if (!crew.disabled) crew.update(dt, player);
    animals.update(dt, boat, camera);
    weather.update(dt, { camera, params: sky.params, crew, animals, player, indoor: horror.indoor });
    radar.update(dt);
    towline.update(dt);
    flag.update(dt, 0.55 + 0.25 * sky.params.clouds, boat.speed);
    audio.update(dt, {
      camera, zone: player.zone, indoor: atmos.uIndoor.value,
      boat: { speed: boat.speed, rpm: boat.rpm, engineOn: boat.engineOn, load: boat.load, x: boat.x, z: boat.z, heading: boat.heading },
      enginePos: boat.toWorld(ENGINE, enginePos), bowPos: boat.toWorld(BOW, bowPos),
      night: sky.params.moon, wind: 0.55 + 0.25 * sky.params.clouds,
    });
    audio.winch?.(Math.min(1, Math.abs(towline.speed || 0) / 0.9), boat.toWorld(WINCH, winchPos));
    model.update(boat.root);
    lights.scale = sky.params.lamps;
    lights.update(dt, player.pos, player.zone);
    if (switchRecapture > 0 && (switchRecapture -= dt) <= 0) recapture();
    // the engine room is drawn only from inside it (or from the hall, down its stair)
    const erOn = player.zone === 'engine' || player.zone === 'engine_stair' || player.zone === 'hall' || !!freecam;
    if (erOn !== erShown) { erShown = erOn; for (const m of model.roomMeshes.engine) m.visible = erOn; }
    station.root.visible = Math.hypot(STATION_POS.x - boat.x, STATION_POS.z - boat.z) < 1900;
    probes.update(player.zone);
    atmos.uIndoor.value += (((player.zone && player.zone !== 'engine_stair') || horror.zone ? 1 : 0) - atmos.uIndoor.value) * Math.min(1, dt * 3);
    sky.update(dt, camera);
    // underground (Object 7) and in the station's rooms: no sky light, no snow, hardly any fog
    const under = horror.zone ? 1 : 0;
    lighting.under = under; weather.under = under;
    if (under) { atmos.uFogDensity.value *= 0.06; atmos.uFogHaze.value *= 0.1; }
    sky.updateEnv(scene, dt);
    ocean.update(camera, boat.root, sky.params);
    lighting.update(camera, sky.params);
    post.setExposure(sky.params.exposure * (horror.adapt ?? 1));
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
      ui.fps(`${Math.round(frames / fpsT)} fps  ${(fpsMs / frames).toFixed(1)} ms  gpu ${gpu ? gpu.toFixed(1) : '?'} ms\ndraws ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k  ${quality.name}  scale ${Math.round(gov.scale * 100)}%${post.ao && !post.ao.enabled ? ' no AO' : ''}`);
      window.__fps = frames / fpsT;
      frames = 0; fpsT = 0; fpsMs = 0;
    }
  };
  let raf = true;
  const loop = () => { frame(); if (raf) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  // the story (or the free voyage): its objectives, the berth, going ashore
  const towMat = towline.material;
  // (the old run to the station is the tug's mechanics now: the berth, the lines, the mooring)
  story = new Story({ ui, boat, stations, station, crew, audio, player, model, scene, interactions, towline, lighting, peopleData, towMat, settings: { ...settings, mode: 'voyage' } });
  director = new Director({ horror, boat, station, crew, stations, ui, audio, player, model, sky, voyage: story, interactions, scene, lights, radar, lighting, peopleData, ice, camera });
  // the levels come in behind the title screen
  const warmAll = async () => {
    const wait = () => new Promise((r) => setTimeout(r, 30));
    const warm = (root) => { try { renderer.compile(root, camera, scene); } catch (e) { console.warn('[Arkticheskiy] warm-up:', e); } };
    // what is hidden only to save drawing it (rooms, the engine room, the levels, the guns not in
    // hand) shown for the compile; never the collision, zone and trigger boxes
    horror.gunLight?.(0.016, camera.getWorldPosition(new THREE.Vector3()));     // (the guns with their reflections)
    const SKIP = /^(COL|ZONE|LAD|TRIG|SPAWN|SPOT|HIDE|USE|ITEM|DOC|LMP|PILLAR|GUEST)_/;
    const hidden = [];
    scene.traverse((o) => { if (!o.visible && !SKIP.test(o.name || '') && !(o.material && o.material.visible === false)) { hidden.push(o); o.visible = true; } });
    warm(scene);
    for (const o of hidden) o.visible = false;
    await wait();
    // the rooms' own reflections: their materials with a probe's map (another shader each)
    const maps = Object.values(probes.maps || {});
    if (maps.length && probes.mats?.length) {
      const saved = probes.mats.map((m) => m.envMap);
      for (const m of probes.mats) m.envMap = maps[0];
      warm(scene);
      probes.mats.forEach((m, i) => { m.envMap = saved[i]; });
      await wait();
    }
    // one of each creature, out of sight, compiled and put away
    for (const kind of Object.keys(horror.enemies.data || {})) {
      const c = horror.enemies.spawn(kind, new THREE.Vector3(0, -50, 0), { state: 'dormant', name: '__warm_' + kind });
      if (!c) continue;
      c.root.updateMatrixWorld(true);
      warm(c.root);
      horror.enemies.remove(c);
      await wait();
    }
    console.log('[Arkticheskiy] shaders warm:', renderer.info.programs.length, 'programs');
  };
  horror.loadLevels((name) => console.log('[Arkticheskiy] level ready:', name)).then(warmAll);

  ui.ready();
  window.__game = {
    station, get story() { return story; }, get director() { return director; }, STATION_POS, horror,
    THREE, perf, audio, towline, flag, crew, get probes() { return probes; }, animals, weather, foam, radar, scene, camera, renderer, boat, model, player, ice, sky, ocean, waves, stations, lights, post, ui, input, settings, quality, reflection, lighting,
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
    // a camera at a boat-space point looking at another (null: back to your eyes)
    freecam(pos, look) { freecam = pos ? { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look) } : null; },
  };
  void tryGLB; void saveSettings;
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('loadtext').textContent = 'Failed to start: ' + (e?.message || e);
});
