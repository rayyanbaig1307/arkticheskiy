# Scene Passport: Arkticheskiy assets

refs_read: blender-scene, blender-scene-spec, blender-modeling, blender-lookdev, blender-animation,
blender-audit-finalize, blender-volatile

```text
SCENE
- intent: game assets for a real-time Three.js scene (not a render); each asset is judged in the game
- deliverable: GLB files in public/models/ (meshopt-compressed by tools/pack.mjs); preview PNGs
- units: metres; axes: right-handed Z-up (glTF export converts to Y-up)
- render: previews only, EEVEE 960x540; animation 30 fps
- dynamic: yes - characters and animals carry baked clips; the tug's moving parts (wheel, doors,
  lever, searchlight, radar) are separate nodes the game animates

HIERARCHY
- one scene per asset: ASSET_tug, ASSET_icebergs, ASSET_walrus, ASSET_penguin, ASSET_people_<name>,
  ASSET_anims. The user's own scene ("Scene": Cube, Light, Camera) is protected and never edited.
- tug nodes: COL_, ZONE_, LAD_ (hidden helpers), LMP_, SPOT_, PATH_ (empties), INT_<kind>_<id>
  (pivots for moving parts), SL_yaw > SL_pitch > SL_head/SL_lamp, RADAR_scanner, NEEDLE_*
- protected existing objects: Cube, Light, Camera (scene "Scene")

ASSETS
- A01 tug | BLOCK (procedural, local) | hero: detailed | 11.6 x 43.2 x 13 m | origin at midships on the
  waterline | bow +Y | role: the player's world
- A02 icebergs x8 + floes x3 | BLOCK (procedural voxel remesh) | midground: detailed silhouettes |
  3 m growlers to 90 m tabular | origin at the waterline centre
- A03 walrus | BLOCK + rig | midground: stylized-detailed | 3.2 x 1.3 x 1.1 m | origin between the
  fore flippers on the ground | faces +Y
- A04 penguin (Adélie) | BLOCK + rig | midground: stylized-detailed | 0.7 m tall | origin at the feet
- A05 people x9 | EXISTING library (MPFB/MakeHuman CC0 bodies) + modelled winter gear | midground:
  detailed | 1.65-1.9 m | origin at the feet, facing -Y (MPFB convention)
- generation: none. No credit spend ([GEN] routes not used).

SHOT
- no fixed camera: the game's first-person camera. Previews: three-quarter, side, interior views.

LOOK
- tug: hull blue (painted steel, rough 0.42), red antifouling bottom, black boot-top, white
  superstructure, red cap rails/funnel band, dark green non-slip decks, cream interiors, brown
  linoleum, green machinery. Flat colours plus generated normal maps (plating seams); the game adds
  weathering in its shaders. Emissive lamps keep their strength (KHR_materials_emissive_strength).
- ice: vertex colours (snow white / dense ice blue / crack depth); the game's ice shader does the
  glow and the wet edge.
- animals: generated textures (walrus skin wrinkles, penguin plumage) on UVs or vertex colours.

LIGHTING
- the game lights everything (moon/sun with cascaded shadows, sky IBL, lamp pool). Blender previews
  use a neutral world and one sun only to read form.

MOTION
- 30 fps clips. walrus: idle, breathe, look, flop, roar. penguin: idle, waddle, flap, slide.
  people (shared rig): idle, walk, patrol, talk, rope, wipe, gauges, guard, binoculars.
- loops start and end on the same key; one-shots (roar, flap) rest at their last frame.

ACCEPTANCE
- structural: every contract node present once; colliders closed where walked; tris: tug < 120k,
  each berg < 12k, walrus < 8k, penguin < 3k, people < 25k each
- motion: every clip has keys on the bones it needs, loops seamless, no flips
- visual: previews read as the subject (no unresolved primitives on hero/midground assets);
  in-game screenshot check after each import
```
