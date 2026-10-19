# ПОЛЯРНИК — Arctic Tug: plan

A first-person walk around a Russian icebreaker tug, the *Polyarnik* (ПОЛЯРНИК), as it pushes
through an Arctic ice field at night. Three.js in the browser, with every model built and animated
in Blender through the Blender connector (`bl_*` tools). The target is 60 fps on a normal laptop on
Medium, with Low and High around it.

## Build order

1. **Plan and scaffold.** This file, Vite + Three.js, the module layout, a `__game` debug hook.
2. **Rough version.** The boat as boxes on a Gerstner sea, always under way on autopilot. Walking
   in boat space (capsule against a BVH of the boat's collision mesh), E to interact. Check the
   console and the frame time.
3. **Blender assets, one by one,** each replacing its stand-in:
   tug → icebergs → crew and soldiers (+ clips) → walrus → penguin.
4. **Look.** Sky (moon, stars, aurora), ocean (reflections, foam, wake), ice shader, weather,
   post FX, time of day, graphics presets.
5. **Systems.** Interactions, crew and soldier routines with lines, animal behaviour, sound, UI.
6. **Check and write up.** Frame time on each preset, console clean, README and CREDITS.

After each step: run it, read the console, check the frame time, fix, then move on.

## Assets (Blender → `public/models/*.glb`, meshopt-compressed with gltfpack)

Scripts live in `tools/blender/`. Each one builds its asset in its own Blender scene (the user's
open file is left alone), renders a preview to `tools/blender/previews/`, and exports a GLB.

| File | What | Notes |
|---|---|---|
| `tug.glb` | The *Polyarnik*, 42 m | Lofted icebreaker hull (raked spoon bow), blue hull, red bottom, black boot-top, white superstructure, red cap rail and funnel band, ПОЛЯРНИК on both bows. Walkable main deck, forecastle, side decks, the 01 (boat) deck, bridge wings, and the bridge roof (ladder). Bridge with wheel, throttle, radar screen, horn button, searchlight joystick, VHF radio. Deckhouse with mess room (table, benches, galley stove, kettle, radio). Stairs down to the engine room (two diesels, switch panel, gauge panel, start/stop). Railings, bulwarks, lifebuoys, liferafts, fenders, bollards, anchor windlass, funnel, mast with radar scanner, nav lights, horn, searchlight. Stern: towing winch with the hawser over the stern roller. `COL_*` collision meshes, `INT_*` interactable nodes, `LMP_*` lamp points, `ZONE_*` room boxes. |
| `icebergs.glb` | 8 shapes | Tabular giant, pinnacle (twin peaks), dome, wedge, drydock (U), bergy bit, growler, and 3 floe plates. Voxel-remeshed, faceted cliffs, cracks; vertex colours carry snow, crack depth and the blue of dense ice. |
| `walrus.glb` | Walrus, rigged | Clips: `idle`, `breathe`, `look` (head turns), `flop` (moving on the ice), `roar`. |
| `penguin.glb` | Adélie penguin, rigged | Clips: `idle`, `waddle`, `flap`, `slide` (on its belly). |
| `people/*.glb` | 5 crew, 4 soldiers | MPFB (MakeHuman) bodies on the game-engine rig; heavy quilted coats (inflated from the body so they bend with it), ushanka hats, gloves, boots. Soldiers in winter camouflage with fur hats and belts. |
| `people/anims.glb` | Shared clips | `idle`, `walk`, `patrol`, `talk`, `rope` (pulling), `wipe`, `gauges`, `guard`, `binoculars`. |

## Systems and files

```
index.html               start screen, HUD, pause menu (ui/ styles)
src/main.js              boot, the loop, wiring, window.__game (debug and test hook)
src/core/
  Settings.js            presets (low/medium/high), volume, time of day; localStorage
  Input.js               keyboard, mouse, pointer lock
  Assets.js              GLTFLoader + MeshoptDecoder, loading bar
  Post.js                postprocessing: N8AO, bloom, DOF, grain, vignette, cool grade, ACES
  Perf.js                frame and GPU timings for the debug readout
  util.js                small math helpers
src/world/
  Waves.js               the Gerstner wave set, shared by the GPU (GLSL) and CPU (heights)
  Ocean.js               camera-following grid, reflections, foam (hull, wake, ice), wake trail
  Reflection.js          planar reflection render (half res; off on Low)
  Sky.js                 sky dome: gradient, stars, moon, aurora, sun; env map for PBR
  TimeOfDay.js           night / sunset / overcast day presets
  IceField.js            the endless ice field: bergs and floes pooled around the boat
  IceMaterial.js         blue glow in cracks, wet edges at the waterline, snow on top
  Weather.js             snow, fog banks, breath steam
src/boat/
  Boat.js                motion: heading, speed, throttle, rudder, autopilot, wave ride,
                         collisions with ice (shake, crunch, speed loss), pushing floes
  BoatModel.js           loads tug.glb: materials, interactables, lamps, zones, colliders
  Lights.js              the boat's lamp pool (nearest lamps get the real lights)
src/player/
  Player.js              first-person controller in boat space, capsule vs BVH, stairs,
                         ladders, footsteps, head bob, stays on the deck as the boat moves
src/characters/
  People.js              loads bodies and clips, retargets, mixers, crossfades, lip flap
  Crew.js                routines: patrol paths, job stations, talk to the player
  Lines.js               Russian lines with English subtitles
src/animals/
  Animals.js             walruses and penguins on the ice, react to the boat and the horn
src/interactions/
  Interactions.js        look-at raycast, the hint, E to use, controls taken over
  Stations.js            wheel, throttle, horn, searchlight, radar, engine room, doors,
                         radio, kettle
src/audio/
  Audio.js               Web Audio graph: buses, 3D panners, inside/outside muffling
  Synth.js               every sound made in code (wind, sea, engine, ice, animals, steps...)
  Music.js               the soft ambient score (can be turned off)
src/ui/
  UI.js                  start screen, settings, crosshair, hint, subtitles, pause
tools/blender/           asset scripts (run in the live Blender through bl_execute)
public/models/           exported GLBs
```

## Key decisions

- **Boat space.** The boat is a group moved by `Boat.js` (heading, speed, wave heave, pitch, roll).
  The player, crew, lamps and colliders are its children; the player is simulated in boat-local
  space, so walking feels normal while the deck moves. The camera takes the boat's yaw fully and
  most of its pitch and roll.
- **Collisions.** `three-mesh-bvh` capsule tests against the boat's `COL_*` meshes. Stairs have ramp
  colliders; ladders are climb volumes; open doors drop their collider.
- **Ocean.** A Gerstner sum (8 waves on High) on a grid that follows the camera, with a flat skirt
  to the horizon. Reflections come from a half-resolution planar render (sky, aurora, ice, boat);
  Low uses the sky env map only. Foam: the hull's bow wave, the wake behind (a trail of past boat
  positions), halos round the ice, whitecaps where waves crest. The water is cut away inside the
  hull so the engine room stays dry.
- **Ice field.** Bergs and floes are pooled around the boat and moved ahead out of sight, so the
  voyage never ends. Animals ride on their floes.
- **Lights.** Moon or sun: cascaded shadows (CSM: 3 cascades High, 2 Medium, 1 Low). Indoors: a pool
  of a few point lights given to the lamps nearest the player, so there can be many lamps. The
  searchlight is a spot with a volumetric beam.
- **Sound.** All synthesised in code with the Web Audio API (no downloaded files); positional
  panners on the boat, the ice and the animals. Inside rooms the wind and sea go through a lowpass.
- **Voices.** Lines in Russian with English subtitles; spoken with the browser's Russian voice when
  one is installed, otherwise a muffled murmur under the subtitle.
- **Performance.** Boat meshes are joined by material in Blender; animals and people beyond range
  freeze their mixers and hide; post FX, reflections, shadows, snow count and wave count scale with
  the preset.


## Second pass (October 2026)

What changed after the first playable version, from the first player's notes:

- **No more static**: the film grain read as TV static; it is gone (a one-step dither keeps the
  dark gradients clean).
- **Reflections**: three's CSM add-on installs an old copy of the lights chunk without the DFG
  table, which zeroed every material's reflections; the lines are put back (world/Lighting.js).
  The rooms are photographed into their own reflection probes (boat/Probes.js).
- **Interiors rebuilt** (tools/blender/tug_rooms.py, tug_bridge.py, tug_engine.py): linings with
  wainscot and chair rails, ceiling panels, linoleum and rubber floors; the mess with its benches,
  oilcloth table and galley; the hall with coats, lockers and signs; the wheelhouse console,
  overhead repeaters, the ship's wheel, chairs and chart table; the engine room's two diesels,
  generator, boiler, pumps, air bottles, pipework, switchboard and workbench.
- **Textures** (tools/blender/texlib.py): generated, tileable PBR sets for every surface, the hull
  with its own weathered map. Tinted variants fold into one material each (vertex colours).
- **The towline** (boat/Towline.js): 220 m on the drum, simulated past the roller (weight,
  buoyancy, drag, the swell), reeled in and paid out from the winch's stand.
- **The crew** route round everything (characters/Nav.js: a grid over the collision mesh).
- **The radio** starts switched off and plays quietly.
- **The story** (story/Story.js): the run to Station Severny (world/Station.js,
  tools/blender/make_station.py), berthing alongside, the gangway, the walk ashore.
