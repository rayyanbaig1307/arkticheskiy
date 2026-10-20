# Contracts between the horror systems

The names and calls the parts of АРКТИЧЕСКИЙ use to talk to each other. DESIGN.md has the game
itself. Keep this file current when a name changes.

## Keys

| Key | Does | Owner |
|---|---|---|
| W A S D, Shift, Mouse | walk, run, look | player (src/player/Player.js) |
| C | crouch (quieter, lower) | player |
| E | use / pick up / talk / hide in a locker | interactions |
| F | flashlight on / off | horror look (src/horror/Flashlight.js) |
| Left mouse | fire | weapons |
| Right mouse | aim down the sights | weapons |
| R | reload | weapons |
| 1 2 3 4 | Makarov, Mosin, AKM, flare pistol | weapons |
| Mouse wheel | next / previous weapon | weapons |
| Q | holster (empty hands) | weapons |
| G | light and throw a hand flare | weapons |
| H | use a medkit | survival |
| Tab | inventory and journal | survival UI |
| Esc | pause | ui |

## Inventory (src/survival/Inventory.js)

```js
inventory.ammo = { '9x18': 0, '7.62x54R': 0, '7.62x39': 0, flare: 0 }   // loose rounds in the pockets
inventory.weapons = new Set()        // 'pm', 'mosin', 'akm', 'flaregun'
inventory.items = new Map()          // id -> count (see Items.js)
inventory.add(id, n = 1); inventory.remove(id, n = 1); inventory.has(id, n = 1); inventory.count(id)
inventory.addAmmo(type, n); inventory.takeAmmo(type, n) -> taken
inventory.giveWeapon(id); inventory.hasWeapon(id)
inventory.onChange = (what) => {}    // 'ammo' | 'weapons' | 'items' | 'docs'
inventory.docs = new Set()           // documents read (ids from src/story/Documents.js)
```

Item ids: `medkit`, `bandage`, `battery`, `flare` (hand flare), `fuel_can`, `fuse`, `feeder_cable`,
`keycard_gromov`, `keycard_lab`, `key_generator`, `key_depot`, `key_kennel`, `key_radio`,
`thermite` (count, three needed), `detonator`, `ammo_9x18` (a box: 16), `ammo_762x54` (a clip
pouch: 10), `ammo_762x39` (a magazine's worth: 30), `ammo_flare` (3 cartridges), `vodka` (warmth),
`tea` (warmth), `photo_*` and `tape_*` (story props).

## Stats (src/survival/Stats.js)

`stats.health` 0..100, `stats.warmth` 0..100, `stats.stamina` 0..100, `stats.battery` 0..100
(flashlight), `stats.fear` 0..1 (drives heartbeat and breathing), `stats.damage(amount, source)`,
`stats.heal(n)`, `stats.warm(n)`, `stats.dead` (bool), `stats.onDeath = (cause) => {}` where cause is
'cold' | 'bear' | 'turned' | 'shade' | 'fall' | 'gromov'.

## Sounds (src/audio/Horror.js, reached as `audio.horror`)

```js
audio.horror.gun(kind, worldPos, { indoor })        // 'pm' | 'mosin' | 'akm' | 'flaregun'
audio.horror.sfx(name, worldPos | null, { gain })   // one-shots, names below
audio.horror.creature(name, worldPos)               // creature voices, names below
audio.horror.stinger(name)                          // non-positional scare music
audio.horror.setFear(0..1)                          // heartbeat and breathing
audio.horror.setAmbience(kind)                      // 'sea' | 'station' | 'storm' | 'interior' | 'bunker' | 'cave' | 'boat_dead'
audio.horror.setBlizzard(0..1)
audio.horror.chase(on)                              // the chase drone
audio.horror.loop(name, object3D, on)               // positional loops: 'generator', 'lights_buzz', 'radio_static', 'guest_heart', 'drip', 'fire'
```

sfx names: `dry_fire`, `pm_mag_out`, `pm_mag_in`, `pm_slide`, `mosin_bolt_open`, `mosin_bolt_close`,
`mosin_clip`, `mosin_round`, `akm_mag_out`, `akm_mag_in`, `akm_charge`, `flare_open`, `flare_load`,
`flare_close`, `flare_ignite`, `shell_brass`, `shell_brass_snow`, `weapon_draw`, `weapon_holster`,
`hit_flesh`, `hit_ice`, `hit_metal`, `hit_concrete`, `hit_snow`, `hit_wood`, `pickup`, `pickup_ammo`,
`pickup_key`, `paper`, `locker_open`, `locker_close`, `door_bang`, `door_creak`, `door_locked`,
`door_heavy` (blast door), `metal_scrape`, `metal_groan`, `ice_crack`, `ice_collapse`, `light_pop`,
`lights_on` (a big switch and the hum coming up), `generator_start`, `generator_fail`, `radio_burst`,
`body_fall`, `glass_break`, `chain_rattle`, `footsteps_above`, `knock_hull`, `scream_distant`,
`explosion`, `heartbeat_spike`, `breath_gasp`, `pain`, `pain_cold`, `death`.

creature names: `turned_idle`, `turned_alert`, `turned_scream`, `turned_attack`, `turned_hurt`,
`turned_death`, `turned_step`, `turned_crawl`, `shade_whisper`, `shade_wail`, `shade_touch`,
`bear_huff`, `bear_growl`, `bear_roar`, `bear_hurt`, `bear_death`, `bear_step`, `gromov_roar`,
`gromov_step`, `guest_pulse`, `mimic_voice` (a garbled human voice).

stinger names: `jump` (the big one), `jump_soft`, `reveal` (something seen), `dread` (a slow swell),
`discovery` (a clue), `chase_start`, `chase_end`, `death`, `chapter`.

## Weapons (src/weapons/)

```js
weapons = new Weapons({ camera, scene, input, inventory, audio, player, raycastShot, post })
weapons.update(dt); weapons.give(id); weapons.current   // 'pm' | 'mosin' | 'akm' | 'flaregun' | null
weapons.onShot = (kind, origin, dir) => {}             // the enemies hear it
// raycastShot(origin, dir, range) -> { point, normal, distance, surface, target } | null
//   surface: 'flesh' | 'ice' | 'metal' | 'concrete' | 'snow' | 'wood'; target: an enemy or null
// an enemy target has target.damage(amount, point, dir, weaponId)
```

Weapon models: `public/models/weapons.glb` (tools/blender/make_weapons.py), roots `WPN_pm`,
`WPN_mosin`, `WPN_akm`, `WPN_flaregun`, `WPN_handflare`; parts by name inside each: `MAG`, `SLIDE`,
`BOLT`, `CHARGE`, `BARREL_BREAK`, `TRIGGER`, `HAMMER`; empties `MUZZLE`, `EJECT`, `SIGHT` (the eye
point for aiming), `GRIP_R`, `GRIP_L`. Arms: `public/models/arms.glb`, roots `ARM_R`, `ARM_L`
(gloved hands and sleeves), a bone or empty `HAND` at each palm. Until they exist, Weapons.js builds
stand-ins in code.

How a hand holds each gun is in defs.js (`hands: { R, L }`: `at` a point on the grip, `axis` the grip's
line through the fist, `back` the side the back of the hand is on, `mat` which material counts as the
grip, `front`/`top` to leave the trigger guard or the upper handguard out, `open` for the open
support hand, arms.glb's `ARM_L_open`). Viewmodel.js fits the fist to that cross-section of the gun's
own mesh (it opens the fist's hole to fit), keeps the hand in the grip's frame and bends the wrist
toward the elbow. `oneHand` guns (the PM, the flare pistol) keep the left hand down except to reload.

## Documents (src/story/Documents.js)

```js
export const DOCUMENTS = { id: { kind, date, place, title: { ru, en }, body: { ru, en }, author } }
// kind: 'journal' | 'note' | 'telex' | 'report' | 'tape' (a transcript) | 'poster' | 'photo'
```

## Story lines (src/story/Script.js)

```js
export const SCRIPT = { id: [speaker, ru, en] }      // speakers: captain, bosun, deckhand, engineer,
                                                     // cook, soldier1 (Orlov), soldier2..4, radio,
                                                     // gromov, sokolov, mimic, chief_tape, player
export const SPEAKERS = { gromov: { name, ru, pitch, rate }, ... }   // the new voices
```

## Levels (src/levels/Level.js; tools/blender/make_bunker.py, make_station2.py)

A level is read from its glb's node names; custom properties come through as `userData`. Blender's
own copies of a name (`ZONE_mess.001`, exported `ZONE_mess001`) are read without the suffix.

| Node | Is | Properties |
|---|---|---|
| `R_<room>`, `R_<room>_s` | a room's meshes (drawn when you're near; `_s` its small things) | |
| `COL_*` | collision only (hidden) | |
| `ZONE_<room>` | the room's box: where you are | `size` [x, y, z], `ambience` (bunker, cave, interior), `floor` |
| `LMP_<name>` | a lamp (the nearest powered ones get real lights) | `color`, `power`, `range`, `flicker`, `group` (main, emerg, cave) |
| `DOOR_<name>`, `BLAST_<name>` | a door that swings (its origin the hinge) or a blast door | `open` (degrees), `kind`, `lock`: '' or `power`, an item id (a key), `code:NNNN`, `story` |
| `HIDE_<name>` | a locker to hide in | |
| `ITEM_<name>` | a pickup | `item`, `count`, `weapon` |
| `DOC_<docid>` | a document lying there (Documents.js) | |
| `USE_<name>` | a thing to use; the story handles its `action` | `hint`, `action`, and the action's own (`breaker`, `pillar`, `tape`) |
| `SPAWN_<name>` | where a creature starts | `kind`, `state`, `pose` |
| `SPOT_<name>`, `TRIG_<name>` (`size`) | places and trigger boxes the story names | |
| `LADDER_<name>` | a ladder | `from`, `to` |
| `PILLAR_*`, `GUEST_*` | the cave's ice pillars and the Guest | |

Space: while the tug is moored everything is in her frame (boat space). The station's root is
at `STATION_POS` (650, 0, -2300); Blender (x, y, z) on the station is glTF (x, z, -y); Object 7's
origin is the station's Blender (20, 222, 12).

## The story (src/story/Director.js and ch1.js..ch5.js)

```js
// a chapter: { setup(d, restoringId), restore(d, id), always(d, dt), pilotTarget(d), steps }
// a step:    { id, checkpoint, objective: [ru, en, ruSub, enSub], marker(d), enter(d), update(d) -> done }
d.say(id); d.lines(ids, done, { radio, inear, gap, delay, keep })   // Script.js lines
d.after(secs, fn, keep); d.flag(k); d.set(k, v); d.give(item, n); d.has(item); d.take(item)
d.st(x, y, z)        // a point on the station (its Blender axes) in the world
d.near(world, r); d.inZone(name); d.ashore(); d.point(level, kind, name)
d.spawn(level, spawnName, opts); d.creatureAt(kind, world, opts); d.use(action, { hint, use })
d.sky(k); d.ambience(k); d.stinger(k); d.sfx(k, world); d.scare(kind); d.fade(secs, fn)
d.teleport(world, yaw); d.checkpoint(name); d.codePrompt(door, level)
d.speed = 8          // (tests only: the story's clock runs faster)
```

The ambience a chapter sets is its outdoor bed; HorrorGame swaps in a room's own (`ZONE_`
`ambience`) while you're in one. Moored, the tug stays moored (`voyage.holdMoored`) until
chapter 5 casts her off; creatures ashore are left behind when she does.

## World hooks (main.js, owned by the integrator)

`window.__game` (debug): `horror` (HorrorGame: `levels`, `enemies`, `weapons`, `pickups`,
`uses`, `inventory`, `stats`), `director`, `snap()` (draw a frame into an image, for a hidden
page). `horror.adapt` scales the sky's exposure (your eyes under lamps), and `horror.gunLight`
gives the viewmodel its reflections.
