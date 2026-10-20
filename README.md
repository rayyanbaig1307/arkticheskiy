# АРКТИЧЕСКИЙ (Arkticheskiy)

A first-person walk around a Russian icebreaking tug, the *Polyarnik*, as she pushes through an
endless Arctic ice field under the northern lights. Walk her decks while she rolls and turns, take
the wheel, sound the horn, sweep the searchlight over the bergs, start and stop the engine, heave
in and pay out the towline, talk to the crew and the soldiers aboard, and watch the walruses and
penguins react as you pass.

**The story:** the *Polyarnik* carries the winter's supplies to Station Severny, a polar station
on the fast ice 2.4 km to the north-north-east. Take the wheel, steer her through the ice, bring
her alongside the berth, cross the gangway onto the ice and report to the station chief. (Or pick
**Free voyage** on the start screen: no objectives, the station is still there to find.)

Built with Three.js and Vite. Every model was made and animated in Blender by the scripts in
`tools/blender/`; every sound is synthesised in code.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173) in Chrome, Edge or Firefox and
click **Click to play**. Sound starts on that click.

To build a static version (the `dist/` folder can be served by any web server):

```bash
npm run build
```

## Controls

| Key | Does |
|---|---|
| W A S D | walk |
| Mouse | look |
| Shift | run |
| E | use what you look at: take the wheel, the throttle, the horn, the searchlight, the radar, doors, switches, the engine, the radio, the kettle, the towing winch's lever; talk to someone |
| W / S on a ladder | climb up / down |
| At the wheel | A / D steer, W / S change the engine order, H horn, E let go |
| At the searchlight | the mouse aims it, E lets go |
| Esc | pause (settings, voyage, time of day, volume) |
| F3 | frame rate, GPU time and draw calls |

## What's aboard

- **The bridge** (top of the stairs from the hall, or the ladders from the wings): the wheel,
  the engine-order lever, the horn button, the searchlight joystick, the radar (E changes its
  range), the VHF radio. The captain and a lookout with binoculars are up here.
- **The mess room** (aft on the main deck): the long table with its oilcloth and tea glasses, the
  benches, the officers' corner with a chess game, the galley (a marine range with a kettle: put
  it on, wait for the whistle; the sink, the urn, the pantry), the radio (off until you switch it
  on). The cook works between the table and the stove.
- **The engine room** (the stairs down from the hall): two six-cylinder diesels with their
  turbochargers, gearboxes and shafts, a generator set, the auxiliary boiler, pumps, starting-air
  bottles, colour-coded pipework, the main switchboard, the control console with the light
  switches (engine room, deck floods, cabins) and the red start/stop button, a workbench. The
  chief engineer is at the console.
- **The decks**: the towing winch with 220 m of line. At its control stand (port side, abreast
  the drum) E heaves the line in or pays it out: the drum turns, the level-wind walks across it,
  and the line streams away astern into the sea. The bosun minds the winch, a deckhand walks his
  rounds, soldiers stand guard at the bow and the stern and one patrols the 01 deck. The ensign
  flies at the stern.

Nobody walks through anything: the crew's walks are routed round the furniture and the machinery.

The boat is always under way. Nobody at the wheel means the autopilot steers round the big bergs.
Ram one anyway and she shudders, crunches and loses her way; floes are shoved aside.

## Graphics settings

**Low**, **Medium** (default) and **High**, on the start or pause screen (the page reloads to
apply). They change the render scale, shadow cascades (1/2/3), the sea's reflection (off on Low),
ambient occlusion, depth of field (High), the snow, wave count and the aurora's detail. If the
frame rate is low, try Low; if it's high, try High. F3 shows the frame time and draw calls.

**Time of day**: polar night (aurora), sunset, overcast day; changes live.

## The project

```
index.html            the page: start screen, HUD, objective, end card, pause menu
src/main.js           boot, the loop, wiring, window.__game (debug hook)
src/core/             settings, input, asset loading, post-processing, GPU timer
src/world/            waves (Gerstner, CPU and GPU), sea, sky and aurora, time of day, fog,
                      ice field and ice shader, foam map, planar reflection, snow and breath,
                      Station Severny (Station.js), the lighting (with a fix for three's CSM chunk)
src/boat/             boat motion, the autopilot and berthing, the model's node contract,
                      collisions (BVH), lamp pools, the rooms' reflection probes, radar screen,
                      the towline and winch (Towline.js), the ensign (Flag.js)
src/player/           first-person controller in boat space
src/characters/       the crew and soldiers: loading, clips, routines, lines, routing (Nav.js)
src/animals/          walruses and penguins on the floes
src/interactions/     looking at things and E; every station aboard
src/story/            the five chapters (ch1.js..ch5.js) and their Director, the script and
                      the documents; Story.js still sails her (the berth, casting off)
src/horror/           HorrorGame (the systems together), the flashlight
src/levels/           a level from its Blender node names: rooms, doors, lamps, lockers, uses
src/enemies/          the bears, the Turned, the Shades, Gromov
src/weapons/          the guns in your hands, firing, reloading, flares
src/survival/         health, warmth, fear, the battery; the pockets; saves
src/audio/            the synthesised sound and music (Horror.js: the horror's sounds)
tools/blender/        the Blender scripts that build every model (see below)
tools/pack.mjs        compresses Blender's exports into public/models/ (gltfpack, meshopt)
public/models/        the compressed GLB models
```

PLAN.md has the design; CREDITS.md lists the libraries and assets.

## Rebuilding the models

The scripts in `tools/blender/` build each model in a scene of its own and export it to
`tools/blender/raw/`. They were run inside a live Blender 5.2 through the Blender connector, e.g.:

```python
import runpy
r = runpy.run_path(r'<project>\tools\blender\run.py', init_globals={'SCRIPT': 'make_tug', 'ARGS': {'EXPORT': True}})
```

(`make_tug`, `make_station2` (the station, its rooms and the island; it reuses parts of
`make_station`), `make_bunker` (Object 7 and the cave), `make_bear`, `make_turned` (the Turned,
on the people's rig), `make_weapons` (the guns and the gloved hands), `make_icebergs`,
`make_animals`, `make_people` (needs the MPFB add-on), `make_anims`.) `preview_level.py` renders
a level with its own lamps lit, for checking a room without the game. The tug is split over several files: `make_tug.py` (the hull, decks,
superstructure, doors, the things you use), `tug_rooms.py` (mess, galley, hall, lobby),
`tug_bridge.py`, `tug_engine.py`, `tug_outfit.py` (deck gear, the towing winch), `tug_mats.py`
and `texlib.py` (the generated PBR textures), `kit.py` (the shapes they are made of) and
`tug_layout.py` (dimensions and the hull's lines). A full tug build takes about two minutes.
Then compress them into `public/models/`:

```bash
npm run pack
```

## Notes

- The page needs WebGL 2. A discrete GPU is not required; on integrated graphics use Low or
  Medium.
- The crew speak Russian in recorded voices (ElevenLabs, `public/audio/vo/`), with English
  subtitles. The pause menu's **Voices** switch picks English instead: those recordings live in
  `public/audio/vo_en/` (`node tools/elevenlabs/generate.mjs --lang en`, `--only story_c1_*` for a
  part); a line not yet recorded in English is spoken by its Russian recording. After changing a line in `src/characters/Lines.js`, record it again with
  `node tools/elevenlabs/generate.mjs --dry` (the cost) and then without `--dry`; until then that
  line falls back to your browser's Russian speech voice if one is installed (Windows: Settings →
  Time & language → Speech → add Russian), else a murmur.
- Walruses are Arctic and penguins Antarctic; here they share the ice anyway.
