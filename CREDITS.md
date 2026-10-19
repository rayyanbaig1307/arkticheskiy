# Credits

Everything in this game was made for it, except the libraries and the MakeHuman assets listed
here. No third-party images, recordings or models are used.

## Code libraries

| Library | Licence | Used for |
|---|---|---|
| [three.js](https://threejs.org) 0.186 | MIT | rendering, loaders, cascaded shadow maps (`CSM`), skinned clones |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | the player's collisions and fast raycasts on the boat |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Zlib | bloom, depth of field, ACES tone mapping, SMAA, custom grade |
| [N8AO](https://github.com/N8python/n8ao) | ISC | ambient occlusion |
| [meshoptimizer / gltfpack](https://github.com/zeux/meshoptimizer) | MIT | compressing the models (EXT_meshopt_compression) |
| [Vite](https://vitejs.dev) | MIT | the dev server and the build |

## 3D models

All models were built with Python scripts run inside Blender 5.2 (`tools/blender/`), procedurally,
for this game:

- **The tug *Polyarnik*** (`make_tug.py`): lofted hull, superstructure, interiors, machinery, the
  plating and deck normal maps (generated with numpy). The lettering ПОЛЯРНИК / МУРМАНСК uses
  Blender's built-in font (free licence), converted to geometry.
- **Icebergs, growlers and floes** (`make_icebergs.py`): voxel-remeshed primitives, calving cuts
  and noise displacement.
- **Walrus and penguin** (`make_animals.py`): lofted bodies, hand-built skeletons, keyed clips,
  generated skin texture.
- **People** (`make_people.py`, `make_anims.py`): bodies made with
  [MPFB](https://static.makehumancommunity.org/mpfb.html) (MakeHuman for Blender) on its
  game-engine rig. The coats, hats, gloves, belts and aprons are modelled by the script; the
  animation clips are keyed by `make_anims.py` (with IK for the hand poses).

### MakeHuman assets used (all CC0)

| Asset | Author | Licence |
|---|---|---|
| MakeHuman base mesh, eyes, eyebrows, eyelashes, teeth, hair `short01`–`short04`, `male_worksuit01`, `shoes02`, skins `young_caucasian_male`, `young_caucasian_male2`, `middleage_caucasian_male` | MakeHuman team (Data Collection AB) | CC0 |
| `jartur69_old_slavic_male_with_genitals_and_beard`, `jartur69_middleage_slavic_male_with_genitals_and_beard` (skins) | jartur69 | CC0 |
| `toigo_light_skin_male_freckles` (skin), `toigo_wool_pants`, `toigo_fisherman_sweater` | MargaretToigo | CC0 |
| `cortu_cargo_pants` | Cortu | CC0 |
| `culturalibre_male_boots`, `culturalibre_hero_boots_1`, `culturalibre_hero_boots_2` | culturalibre | CC0 |

Licences as recorded in the MPFB asset packs' metadata (`packs/*.json`) and the asset files.

## Textures

None are downloaded. Everything is generated: the hull plating and deck normal maps, the quilted
and camouflage cloth, fur and knit (numpy, in Blender); the sea's detail normals and foam cells,
the sky, stars, moon and aurora (in code and shaders, at runtime).

## Voices

The crew's lines are spoken by the browser's own speech synthesis when a Russian voice is
installed on the computer (Windows, macOS and Chrome provide them); otherwise a synthesised
murmur plays under the subtitles. The script (Russian and English) is in
`src/characters/Lines.js`.

## Sound

Every sound and all of the music is synthesised in code at runtime by `src/audio` with the Web
Audio API. There are no audio files and no third-party recordings or samples. `Synth.js` renders
the one-shots and loops sample by sample (cached, a few variants of each), `Audio.js` builds the
live graph (beds, HRTF panners, the indoor muffle, reverbs), and `Music.js` plays the score.
`tools/audio-test.html` auditions all of it.

- **Wind**: decorrelated pink noise (left and right) through lowpass filters that follow a random
  gust model, a resonant howl band, low buffeting, and three rigging whistles: narrow
  (Q 38) bandpasses on white noise, Aeolian tones that rise with the gusts.
- **Sea**: pink-noise wash on each side, swelling with slow wave cycles; brown-noise rush along
  the hull; the bow wave's spray hiss and rush at the bow; wave slaps (filtered noise thwack, a
  modal hull thump, a splash tail with Minnaert-style droplet chirps).
- **Ice**: distant cracks (noise snaps, a scatter of micro-fractures, a dispersive falling chirp,
  a low thump) and groans (a harmonic wavetable sliding in pitch, roughened by stick-slip noise,
  through resonant bands); big hits (a dense granular crunch, splinters, and the hull's modal
  boom); scrapes and the continuous grind (stick-slip-modulated noise, grains, rumble, and
  friction squeals through hull-plate modes).
- **Engine**: a seamless loop of 24 firings of a six-cylinder diesel (per firing: a modal thump,
  a resonant exhaust bark, a knock ringing the block's modes, tappet ticks; each cylinder a little
  different) played faster or slower with the revs, under sines on the firing orders and a turbo
  whine. The start (air-start hiss, cranking strokes, starter whine, cough, missed beat) and the
  stop (run-down, last compression thumps, rattles) are their own renders.
- **Hull**: groans and creaks made by stick-slip friction pulses ringing banks of steel modes.
- **Footsteps, doors, switches, kettle, telegraph**: modal synthesis (sums of decaying sine modes
  for deck plates, grating bars, ladder rungs, door leaves, latches, a kettle, a brass gong)
  excited by Hann-shaped impulses; hinge creaks and squeals by stick-slip friction.
- **Horn**: two slightly detuned narrow-pulse reed wavetables with a pressure envelope (pitch
  rising in, sagging out), a lowpass that opens with the pressure, trumpet resonances, air noise;
  a long outdoor reverb and a feedback-delay echo off the ice field.
- **Animals**: glottal pulses (Rosenberg) with jitter, shimmer and period doubling through moving
  formant resonators: walrus grunts and roars, Adélie penguin squawks; herring gulls from a
  harmonic wavetable with FM roughness and a pitch contour per note.
- **Voices and radio**: formant synthesis of Russian-sounding speech (stress-timed syllables,
  vowel reduction, palatalised consonants, rolled r, sibilants, falling or questioning phrase
  intonation); on the radio it's bandpassed, overdriven and wrapped in squelch, static and
  crackle. The mess radio's waltz is an original tune on Karplus-Strong strings (allpass-tuned)
  through a small-speaker filter. The kettle is a noise boil with bubble chirps and a two-sine
  whistle with breath noise and random vibrato.
- **Music**: OscillatorNodes only: a drone on D, slow modal pad chords from a soft periodic wave,
  and sparse FM glass bells, in a generated long reverb.
- **Space**: the reverbs are generated impulse responses (decaying, darkening noise with early
  reflections): 2.5 s for the open ice, 0.4 s for the steel rooms, a longer one for the score.
