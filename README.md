# ПОЛЯРНИК: Arctic Tug

A first-person walk around a Russian icebreaking tug, the *Polyarnik*, as she pushes through an
endless Arctic ice field under the northern lights. Walk her decks while she rolls and turns, take
the wheel, sound the horn, sweep the searchlight over the bergs, start and stop the engine, talk
to the crew and the soldiers aboard, and watch the walruses and penguins react as you pass.

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
| E | use what you look at: take the wheel, the throttle, the horn, the searchlight, the radar, doors, switches, the engine, the radio, the kettle; talk to someone |
| W / S on a ladder | climb up / down |
| At the wheel | A / D steer, W / S change the engine order, H horn, E let go |
| At the searchlight | the mouse aims it, E lets go |
| Esc | pause (settings, time of day, volume) |
| F3 | frame rate, GPU time and draw calls |

## What's aboard

- **The bridge** (top of the stairs from the hall, or the ladders from the wings): the wheel,
  the engine-order lever, the horn button, the searchlight joystick, the radar (E changes its
  range), the VHF radio. The captain and a lookout with binoculars are up here.
- **The mess room** (aft on the main deck): the table, the galley stove with a kettle (put it on,
  wait for the whistle), a radio. The cook is wiping the table.
- **The engine room** (the stairs down from the hall): two diesels, the gauges, the light switches
  (engine room, deck floods, cabins) and the red start/stop button. The chief engineer is at the
  console.
- **The decks**: the towing winch and its hawser over the stern roller, the bosun hauling on it, a
  deckhand on his rounds, soldiers on guard at the bow and the stern, one patrolling the 01 deck.

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
index.html            the page: start screen, HUD, pause menu
src/main.js           boot, the loop, wiring, window.__game (debug hook)
src/core/             settings, input, asset loading, post-processing, GPU timer
src/world/            waves (Gerstner, CPU and GPU), sea, sky and aurora, time of day, fog,
                      ice field and ice shader, foam map, planar reflection, snow and breath
src/boat/             boat motion and autopilot, the model's node contract, collisions (BVH),
                      lamp pools, radar screen
src/player/           first-person controller in boat space
src/characters/       the crew and soldiers: loading, clips, routines, lines
src/animals/          walruses and penguins on the floes
src/interactions/     looking at things and E; every station aboard
src/audio/            the synthesised sound and music
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

(`make_tug`, `make_icebergs`, `make_animals`, `make_people` (needs the MPFB add-on), `make_anims`.)
Then compress them into `public/models/`:

```bash
npm run pack
```

## Notes

- The page needs WebGL 2. A discrete GPU is not required; on integrated graphics use Low or
  Medium.
- The crew speak Russian through your browser's speech voices if a Russian one is installed
  (Windows: Settings → Time & language → Speech → add Russian). Otherwise you hear a murmur and
  read the subtitles.
- Walruses are Arctic and penguins Antarctic; here they share the ice anyway.
