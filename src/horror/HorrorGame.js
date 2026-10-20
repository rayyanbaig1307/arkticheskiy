import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Stats } from '../survival/Stats.js';
import { Inventory } from '../survival/Inventory.js';
import { Pickups } from '../survival/Pickups.js';
import { saves } from '../survival/Saves.js';
import { quickHeal } from '../survival/Items.js';
import { HorrorHUD } from '../ui/HorrorHUD.js';
import { Journal } from '../ui/Journal.js';
import { DOCUMENTS } from '../story/Documents.js';
import { Weapons } from '../weapons/Weapons.js';
import { makeRaycastShot } from '../weapons/Ballistics.js';
import { Flashlight } from './Flashlight.js';
import { Level } from '../levels/Level.js';
import { propFor, hitProxy } from '../levels/Props.js';
import { Enemies } from '../enemies/Enemies.js';

// The horror's systems run together: your body (survival/Stats: health, warmth, stamina, the
// flashlight's battery, fear), what you carry (Inventory, Pickups), the HUD and the journal, the
// flashlight, the guns, the levels (Object 7 under the cap; the station's rooms), their doors,
// lockers to hide in, ladders, and the things to use in them; checkpoints. main.js makes one and
// calls update() each frame; the story (story/Director.js) drives it.
//
// Space: you live in boat space (player.pos); while the tug is moored she is still, so the levels'
// collision (world) goes into boat space once and stays right (enterLevels / leaveLevels).

const BUNKER_AT = new THREE.Vector3(20, 12, -222);         // Object 7's origin in the station's frame (glTF axes): inside the ice cap
const NOISE = { pm: 55, mosin: 80, akm: 70, flaregun: 40 };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _ray = new THREE.Raycaster();

export class HorrorGame {
  constructor(ctx) {
    this.ctx = ctx;             // scene, camera, input, ui, audio, player, boat, model, station, lighting, post, interactions, quality, sky, crew
    const { scene, camera, input, ui, audio, player, model, station, lighting, post, interactions, quality } = ctx;
    this.stats = new Stats();
    this.inventory = new Inventory();
    this.hud = new HorrorHUD({ stats: this.stats, inventory: this.inventory, ui, audio });
    this.journal = new Journal({ inventory: this.inventory, stats: this.stats, hud: this.hud, audio, ui, documents: DOCUMENTS });
    this.journal.setDocuments?.(DOCUMENTS);
    this.flashlight = new Flashlight({ camera, scene, stats: this.stats, audio, quality });
    this.levels = {
      bunker: new Level({ name: 'bunker', url: 'models/bunker.glb', parent: station.root, position: BUNKER_AT, lighting, scene, lights: quality.cascades >= 3 ? 7 : 5 }),
    };
    if (station.level) this.levels.station = station.level;          // (the station's rooms: read from its own model)
    // moored, the levels' doors and ladders (and Object 7's collision) join her frame; cast off, they go
    ctx.boat.on((kind) => {
      if (kind === 'moored') for (const L of Object.values(this.levels)) this.enterLevel(L);
      if (kind === 'castoff') {
        for (const L of Object.values(this.levels)) this.leaveLevel(L);
        // (the creatures live in her frame: those ashore stay ashore, not dragged out to sea with her)
        for (const c of [...this.enemies.list]) { const p = c.root.position; if (Math.abs(p.x) > 7 || Math.abs(p.z) > 21) this.enemies.remove(c); }
      }
    });
    this.shotWorld = makeRaycastShot([...model.merged, station.root]);
    // the creatures: bears, the Turned, the Shades (enemies/; their models come in with the levels)
    this.enemies = new Enemies({ scene, boat: ctx.boat, model, audio, stats: this.stats, player, camera, lighting, quality });
    this.weapons = new Weapons({ camera, scene, input, inventory: this.inventory, audio, player, raycastShot: (o, d, r) => this.raycastShot(o, d, r), post, lighting, hud: this.hud, stats: this.stats });
    this.pickups = new Pickups({ interactions, inventory: this.inventory, hud: this.hud, ui, audio, journal: this.journal, weapons: this.weapons, chapter: () => this.chapter });
    this.chapter = 1; this.flags = {}; this.checkpointName = null; this.t = 0;
    this.extras = []; this.doorEntries = [];
    this.hiding = null; this.zone = null; this.indoor = false;
    this.uses = {};                            // action -> (place, level) => void: the story fills it
    this.heat = [];                            // [{ pos (boat space), r, k }] stoves, heaters
    this.journal.onToggle = (open, why) => { if (open) input.unlock(); else if (why !== 'menu') input.lock(); };
    this.weapons.onShot = (kind, origin) => this.enemies.shot(kind, origin);
    // a creature's blow: the HUD's red, the view knocked, a stinger (health is already taken)
    this.enemies.onHit = (enemy, kind, damage) => {
      this.hud.hit(damage);
      player.shakeT = Math.max(player.shakeT || 0, kind === 'lunge' ? 0.7 : 0.35);
      this.stats.scare?.(kind === 'lunge' ? 0.6 : 0.3);
      audio.horror?.sfx?.('pain', null, { gain: 0.8 });
      this.onCreatureHit?.(enemy, kind, damage);
    };
    this.enemies.onSeen = (enemy) => this.onCreatureSeen?.(enemy);
    this.enemies.onDeath = (enemy) => this.onCreatureDeath?.(enemy);
    this.enemies.onAlert = (enemy) => this.onCreatureAlert?.(enemy);
    this.extrasN = 0;
    this.weapons.onFlare = (pos, burning, flare) => { this.flaresChanged = true; void pos; void burning; void flare; };
    this.stats.onDeath = (cause) => { this.journal.enabled = false; audio.horror?.stinger?.('death'); this.onDeath?.(cause); };
    this.stats.onBatteryEmpty = () => this.flashlight.toggle(false);
    this.hud.onRetry = () => this.onRetry?.();
    this.hud.onQuit = () => location.reload();
    this.ladders = [];                         // the levels' ladders in boat space (while moored)
    // the boat's ladderAt sees the levels' ladders too
    const orig = model.ladderAt.bind(model);
    model.ladderAt = (p) => orig(p) || this.ladders.find((l) => l.box.containsPoint(p)) || null;
    this.ladderProxies = new Map();             // ladder -> its prompt's box (E: climb)
    this.syncLadders();
  }

  // ---- space
  toBoat(v, out) { return this.ctx.boat.toLocal(v, out); }
  toWorld(v, out) { return this.ctx.boat.toWorld(v, out); }

  // the guns' ray: the world's meshes, and the creatures (whichever is nearer)
  raycastShot(origin, dir, range) {
    const w = this.shotWorld(origin, dir, range);
    const e = this.enemies.raycast(origin, dir, w ? w.distance : range);
    return e || w;
  }

  // ---- the levels: loaded (in the background), placed into boat space while she's moored
  async loadLevels(onProgress) {
    // the guns and the gloved hands (tools/blender/make_weapons.py), in place of the stand-ins
    if (!this.gunsLoaded) {
      this.gunsLoaded = true;
      try { if (await this.weapons.load()) onProgress?.('weapons'); } catch (e) { console.warn('[Arkticheskiy] weapons:', e); }
    }
    if (!this.enemies.loaded) {
      try { await this.enemies.load(); this.enemies.loaded = true; onProgress?.('creatures'); } catch (e) { console.warn('[Arkticheskiy] creatures:', e); }
    }
    for (const [name, L] of Object.entries(this.levels)) {
      if (L.wired || L.loading) continue;
      L.loading = true;
      const ok = L.ready || await L.load();
      L.loading = false;
      if (!ok) { console.warn('[Arkticheskiy] level missing:', name); continue; }
      L.wired = true;
      if (!L.adopted) this.shotWorld.meshes.push(...L.blockers);
      this.ctx.interactions.addBlockers(L.blockers);
      this.wireLevel(L);
      onProgress?.(name);
      if (this.ctx.boat.moored) this.enterLevel(L);
    }
  }

  wireLevel(L) {
    const { interactions } = this.ctx;
    // doors: E opens and shuts them (unless locked)
    for (const d of L.doors) {
      interactions.add(d.node, {
        hint: () => this.doorHint(d), use: () => this.useDoor(L, d), range: d.blast ? 3.2 : 2.2,
      });
    }
    // things to pick up and documents to read: a small prop at each place
    for (const p of L.points.ITEM) {
      const item = p.data.item || 'battery';
      const prop = propFor(item); p.node.add(prop);
      this.pickups.add(prop, { id: `${L.name}:${p.name}`, item, count: p.data.count || 1, weapon: p.data.weapon || null });
    }
    for (const p of L.points.DOC) {
      const id = p.name;
      if (!DOCUMENTS[id]) continue;
      const kind = DOCUMENTS[id].kind;
      const onWall = kind === 'poster';
      const prop = onWall ? hitProxy(0.5) : propFor('doc');
      p.node.add(prop);
      this.pickups.add(prop, { id: `${L.name}:doc:${id}`, doc: id, keep: onWall, hint: onWall ? 'Прочитать / Read' : undefined });
    }
    // places to hide (lockers): E in, E out
    for (const p of L.points.HIDE) {
      const proxy = hitProxy(0.7); p.node.add(proxy); proxy.position.set(0, -0.5, 0);
      interactions.add(proxy, { hint: () => (this.hiding ? '' : 'Спрятаться / Hide'), use: () => this.hide(L, p), range: 1.8 });
    }
    // things to use: the story says what they do
    for (const p of L.points.USE) {
      const obj = p.node.isMesh || p.node.children.some((c) => c.isMesh) ? p.node : (() => { const h = hitProxy(0.45); p.node.add(h); return h; })();
      interactions.add(obj, { hint: () => this.useHint(p), use: () => this.use(L, p), range: 2.4 });
    }
  }

  enterLevel(L) {
    if (!L.ready || L.inBoat) return;
    const { boat, model } = this.ctx;
    _m.copy(boat.root.matrixWorld).invert();
    // (the station's own collision, rooms and all, comes with the mooring: Story.onMoored)
    L.inBoat = L.adopted ? true : model.collision.addExtra(L.collisionIn(_m));
    for (const { door, box } of L.doorBoxesIn(_m)) { door.colEntry = model.collision.addBox(box); door.colEntry.on = door.t < 0.15; door.colEntry.levelDoor = { L, d: door }; }
    for (const p of L.points.LADDER) {
      const ud = p.data;
      const top = (ud.to ?? 4) - (ud.from ?? 0);
      const a = p.pos.clone(), b = p.pos.clone().add(new THREE.Vector3(0, top, 0));
      const box = new THREE.Box3().setFromPoints([a, b]).expandByVector(new THREE.Vector3(0.45, 0.3, 0.45)).applyMatrix4(_m);
      this.ladders.push({ name: p.name, box, level: L, top: ud.top });
    }
    this.ctx.crew?.nav?.reset?.();
    this.enemies?.groundChanged?.();
    this.syncLadders();
  }

  // a prompt on each ladder (the boat's own and the levels' while she's moored): E gets you on it
  syncLadders() {
    const { boat, model, interactions, player } = this.ctx;
    const all = new Set([...(model.ladders || []), ...this.ladders]);
    for (const [l, m] of this.ladderProxies) if (!all.has(l)) { interactions.remove(m); m.removeFromParent(); this.ladderProxies.delete(l); }
    for (const l of all) {
      if (this.ladderProxies.has(l)) continue;
      const size = l.box.getSize(new THREE.Vector3()), c = l.box.getCenter(new THREE.Vector3());
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.3, size.x), size.y, Math.max(0.3, size.z)), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      m.position.copy(c);
      boat.root.add(m);
      interactions.add(m, {
        hint: () => (player.climb ? '' : player.pos.y > c.y ? 'Спуститься по трапу · Climb down the ladder' : 'Подняться по трапу · Climb the ladder'),
        use: () => { if (!player.climb && !player.station) player.mount(l); },
        range: 2.2,
      });
      this.ladderProxies.set(l, m);
    }
  }

  leaveLevel(L) {
    const { model, player } = this.ctx;
    if (L.inBoat) { if (L.inBoat !== true) model.collision.removeExtra(L.inBoat); L.inBoat = null; }
    for (const d of L.doors) if (d.colEntry) { d.colEntry.on = false; d.colEntry = null; }
    this.ladders = this.ladders.filter((l) => l.level !== L);
    if (player.climb?.l.level === L) player.dismount();
    this.syncLadders();
    this.enemies?.groundChanged?.();
  }

  // ---- doors
  doorLocked(d) {
    const lk = d.lock || '';
    if (!lk) return false;
    if (lk === 'power') return !this.levelOf(d)?.power.main;
    if (lk === 'story') return !this.flags['open:' + d.name];
    if (lk.startsWith('code:')) return !this.flags['code:' + d.name];
    return !this.inventory.has(lk);
  }
  levelOf(d) { return Object.values(this.levels).find((L) => L.doors.includes(d)); }
  doorHint(d) {
    if (d.t > 0.5) return d.blast ? '' : 'Закрыть / Close';
    if (this.doorLocked(d)) return d.lock === 'power' ? 'Нет питания / No power' : 'Заперто / Locked';
    return 'Открыть / Open';
  }
  useDoor(L, d) {
    const audio = this.ctx.audio;
    const pos = d.node.getWorldPosition(_w);
    if (d.t > 0.5) { if (d.blast) return; L.openDoor(d, false); audio.horror?.sfx?.('door_creak', pos, { gain: 0.6 }); this.enemies?.noise?.(this.toBoat(pos, _v), 10, 'door'); return; }
    if (this.doorLocked(d)) {
      if (d.lock && d.lock.startsWith('code:')) { this.onCode?.(d, L); return; }
      audio.horror?.sfx?.('door_locked', pos);
      this.hud.toast(d.lock === 'power' ? 'Нет питания.' : 'Заперто.', d.lock === 'power' ? 'No power.' : 'Locked.');
      return;
    }
    L.openDoor(d, true);
    audio.horror?.sfx?.(d.blast ? 'door_heavy' : 'door_creak', pos);
    this.enemies?.noise?.(this.toBoat(pos, _v), d.blast ? 40 : 12, 'door');
    this.onDoor?.(d, L);
  }

  // ---- uses (the story's handlers)
  useHint(p) {
    const h = this.uses[p.data.action]?.hint?.(p) ?? p.data.hint ?? 'Использовать / Use';
    return h;
  }
  use(L, p) {
    const u = this.uses[p.data.action];
    if (typeof u === 'function') u(p, L);
    else if (u?.use) u.use(p, L);
    else this.hud.toast('Ничего не происходит.', 'Nothing happens.');
  }

  // ---- hiding in a locker: the view from inside it, through the louvres; E to come out
  hide(L, p) {
    const { player, input } = this.ctx;
    if (this.hiding) return;
    this.hiding = { L, p, back: player.pos.clone(), yaw: player.yaw };
    const inside = this.toBoat(p.pos, new THREE.Vector3());
    // (the eye inside, facing out of the locker's door)
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quat);
    const fb = this.ctx.boat.root.getWorldQuaternion(_q).invert();
    f.applyQuaternion(fb);
    player.frozen = true;
    player.pos.copy(inside).setY(inside.y - 1.55 + 0.02);
    player.yaw = Math.atan2(-f.x, -f.z); player.pitch = 0;
    this.hud.setHidden(true);
    this.weapons.enabled = false;
    this.flashlight.toggle(false);
    this.ctx.audio.horror?.sfx?.('locker_close', p.pos);
    this.hidingInput = input;
  }
  unhide() {
    const { player } = this.ctx;
    const h = this.hiding; if (!h) return;
    player.pos.copy(h.back); player.frozen = false;
    this.hiding = null;
    this.hud.setHidden(false);
    this.ctx.audio.horror?.sfx?.('locker_open', h.p.pos);
  }

  // ---- checkpoints
  checkpoint(name, extra = {}) {
    this.checkpointName = name;
    const s = saves.snapshot({ chapter: this.chapter, checkpoint: name, flags: { ...this.flags, ...extra }, inventory: this.inventory, stats: this.stats, pickups: this.pickups, journal: this.journal, time: this.t });
    s.weapons = this.weapons.state?.();
    saves.save(s);
    this.hud.toast('Сохранено', 'Checkpoint', 1.6);
  }
  restore(s) {
    this.hud.reset();
    saves.apply(s, { inventory: this.inventory, stats: this.stats, pickups: this.pickups, journal: this.journal });
    if (s.weapons) this.weapons.restore?.(s.weapons);
    this.flags = { ...(s.flags || {}) };
    this.chapter = s.chapter || 1;
    this.checkpointName = s.checkpoint;
    this.journal.enabled = true;
  }

  // ---- each frame
  update(dt, { playing }) {
    this.t += dt;
    const { input, player, boat, camera, audio, stations, sky } = this.ctx;
    const worldEye = camera.getWorldPosition(_w);
    // which level zone you're in (Object 7's rooms, the station's)
    let zone = null;
    for (const L of Object.values(this.levels)) {
      if (!L.ready) continue;
      const z = L.zoneAt(worldEye);
      if (z) zone = { level: L, ...z };
      // a level is drawn when you're near it (its rooms cull themselves)
      const near = z || (L.zones.length && L.zones.some((zz) => zz.box.distanceToPoint(worldEye) < 60));
      if (!!near !== L.visible) L.show(!!near);
      L.update(dt, worldEye);
    }
    this.zone = zone;
    this.indoor = !!(zone || player.zone);
    // the place's sound: a level room's own (the station's huts, Object 7, the cave), else the
    // chapter's outdoor bed
    const amb = zone?.ambience || this.baseAmbience || null;
    if (amb !== this.ambNow) { this.ambNow = amb; audio.horror?.setAmbience?.(amb); }
    // keys
    if (playing && !this.hiding) {
      if (input.hit('KeyF')) this.flashlight.toggle();
      if (input.hit('KeyH') && !stations.at) quickHeal({ inventory: this.inventory, stats: this.stats, hud: this.hud, audio });
    } else if (playing && this.hiding && input.hit('KeyE')) this.unhide();
    // the cold, the dark, your body
    const params = sky.params || {};
    const outdoors = !this.indoor;
    const nearHeat = this.heat.reduce((m, h) => Math.max(m, h.k * Math.max(0, 1 - player.pos.distanceTo(h.pos) / h.r)), 0);
    // aboard, the ship is heated while her engine runs: the rooms warm, the engine room hot (dead in
    // the water, chapter 5, her heating is off too)
    const pz = zone ? null : player.zone;
    const shipHeat = !pz ? 0 : boat.engineOn ? (pz === 'engine' ? 0.75 : pz === 'engine_stair' ? 0.5 : 0.32) : 0.03;
    const env = {
      outdoors, blizzard: outdoors ? Math.min(1, Math.max(0, (params.fogDensity - 0.02) / 0.05)) * (params.snow ?? 0) : 0,
      nearHeat: Math.max(nearHeat, shipHeat),
      running: !!player.running, crouching: !!player.crouched, flashlightOn: this.flashlight.on,
      // (in the sea: below the waterline and not in one of her rooms; the engine room is below it too)
      inWater: !pz && !zone && player.pos.y < -0.6, cold: zone?.ambience === 'cave' ? 1.4 : zone ? 0.6 : 1,
    };
    if (playing && !this.ctx.freecam) this.stats.update(dt, env);
    // the creatures (the ground they walk on changes when she moors or casts off)
    const nx = this.ctx.model.collision.extras.length;
    if (nx !== this.extrasN) { this.extrasN = nx; this.enemies.groundChanged(); }
    if (this.enemies.loaded) this.enemies.update(dt, this.creatureCtx(env, params));
    this.hud.update(dt, env);
    audio.horror?.setFear?.(this.stats.fear);
    this.flashlight.update(dt);
    this.weapons.enabled = playing && !stations.at && !player.climb && !this.hiding && !this.journal.isOpen() && !this.stats.dead;
    if (playing) this.weapons.update(dt);
    this.gunLight(dt, worldEye);
  }

  // the gun's reflections: aboard, the room's probe; elsewhere a neutral room, as bright as the
  // lamps near you, a flare, your flashlight's spill off the walls in front of you
  gunLight(dt, eye) {
    const vm = this.weapons.vm, probes = this.ctx.probes, pz = this.ctx.player.zone;
    if (!vm?.setEnv) return;
    if (!this.neutralEnv && this.ctx.renderer) {
      const pm = new THREE.PMREMGenerator(this.ctx.renderer);
      this.neutralEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    const probe = pz && probes?.maps?.[probes.current || pz];
    const lux = vm.lightAt(eye, this.flashlight.light);
    const want = 0.03 + Math.min(0.4, lux * 0.1) + (this.flashlight.on ? 0.08 : 0);
    this.gunK = this.gunK == null ? want : this.gunK + (want - this.gunK) * (1 - Math.exp(-4 * dt));
    vm.setEnv(probe || this.neutralEnv || null, this.gunK);
    // your eyes: stopped down under lamps, opening slowly again in the dark (main.js scales the
    // sky's exposure by it), so a lit room isn't a white glare and a dark one is darker at first
    const open = Math.min(1, Math.max(0.55, 1 / (1 + lux * 0.12)));
    this.adapt = this.adapt == null ? open : this.adapt + (open - this.adapt) * (1 - Math.exp(-(open < this.adapt ? 2.5 : 0.6) * dt));
  }

  // what the creatures can know (boat space): the light, the dark, the weather, you
  creatureCtx(env, params) {
    const z = this.zone;
    const dark = z ? (z.level.power.main ? 0.35 : 0.92) : Math.min(1, 0.55 + (params.fogDensity || 0) * 5);
    this._wind = this._wind || new THREE.Vector3();
    this._wind.set(-0.6, 0, 0.8).applyQuaternion(this.ctx.boat.root.getWorldQuaternion(_q).invert());     // (a north-easterly)
    this._flares = this._flares || [];
    this._flares.length = 0;
    for (const f of this.weapons.flares || []) if (f.world) this._flares.push({ pos: this.toBoat(f.world, new THREE.Vector3()), burning: true });
    return {
      flashlight: { on: this.flashlight.on && this.flashlight.light.intensity > 1, range: 25 },
      dark, indoor: this.indoor, visibility: 1 - 0.6 * (env.blizzard || 0),
      running: !!this.ctx.player.running, crouching: !!this.ctx.player.crouched, hidden: !!this.hiding,
      wind: { x: this._wind.x, z: this._wind.z },
      heatAt: (p) => this.heat.reduce((m, h) => Math.max(m, h.k * Math.max(0, 1 - p.distanceTo(h.pos) / h.r)), 0),
      flares: this._flares,
      onDoorBang: (entry) => {
        const ld = entry?.levelDoor; if (!ld) return;
        ld.d.bangs = (ld.d.bangs || 0) + 1;
        this.ctx.audio.horror?.sfx?.('door_bang', ld.d.node.getWorldPosition(new THREE.Vector3()));
        if (ld.d.bangs >= 3 && !ld.d.blast) { ld.L.openDoor(ld.d, true); this.ctx.audio.horror?.sfx?.('door_creak', ld.d.node.getWorldPosition(new THREE.Vector3())); }
      },
    };
  }

  // a creature at a level's SPAWN_ place (its extras, and anything the story adds)
  spawnAt(L, name, opts = {}) {
    const p = L.points.SPAWN.find((q) => q.name === name);
    if (!p || !this.enemies.loaded) return null;
    const d = { ...p.data, ...opts };
    const pos = this.toBoat(p.pos, new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quat).applyQuaternion(this.ctx.boat.root.getWorldQuaternion(_q).invert());
    const yaw = Math.atan2(-f.x, -f.z);
    const home = d.home ? { pos: this.toBoat(L.root.localToWorld(new THREE.Vector3(d.home[0], 0, -d.home[1])), new THREE.Vector3()), radius: d.home[2] || 20 } : undefined;
    return this.enemies.spawn(d.kind, pos, { name: `${L.name}:${name}`, yaw, state: d.state, pose: d.pose, home, blood: d.blood, crawler: d.crawler, ...opts });
  }

  // the creatures' view of the light and the dark (for Enemies.update)
  lightCtx() {
    const f = this.flashlight;
    return {
      flashlight: { on: f.on && f.light.intensity > 1, origin: this.toBoat(f.origin, new THREE.Vector3()), dir: f.direction.clone().applyQuaternion(this.ctx.boat.root.getWorldQuaternion(_q).invert()), range: 26 },
      flares: (this.weapons.flares || []).map((fl) => ({ pos: this.toBoat(fl.world || fl.position || fl.pos, new THREE.Vector3()), burning: fl.burning !== false })),
      indoor: this.indoor, running: !!this.ctx.player.running, crouching: !!this.ctx.player.crouched,
      heatAt: (p) => this.heat.reduce((m, h) => Math.max(m, h.k * Math.max(0, 1 - p.distanceTo(h.pos) / h.r)), 0),
    };
  }
}
void _ray;
