# АРКТИЧЕСКИЙ — design

A first-person survival horror game in the Russian Arctic, at the bottom of the polar night. You
are the *Polyarnik*'s second mate. The tug is sent with four border-guard soldiers to Polar Station
Severny, which has been silent for nine days. Under the island's ice cap lies Object 7, a sealed
Soviet facility from 1962, and something in its ice is awake. About two hours to play.

## The story

**1962. Object 7 (Объект-7).** A secret military-scientific bunker cut into the permafrost under
the ice cap of Severny Island. Project **Anabiosis** (Проект «Анабиоз»): freezing living people in
the ice and bringing them back, for long flights and for war. Prisoners and volunteers went into
the ice. In the deep ice the engineers found something older: a dark, slow mass they called
**the Guest** (Гость). The frozen subjects began to move. In March 1963 the commandant, Colonel
Sokolov, sealed the facility with its garrison inside, and Moscow buried the files.

**1987.** Polar Station Severny is built on the coast below the ice cap: weather, glaciology.

**This winter.** The station's glaciologists, under chief **Gromov**, drill an ice core on the cap
and break into Object 7's ventilation shaft (Shaft 3). They go down. They bring something back up
in the core samples. The station's last transmission is nine days old. The ministry, which knows
what Object 7 is, sends the *Polyarnik* with supplies and Sergeant Orlov's detachment.

**The Guest** turns the living into **the Turned** (Обращённые): bodies that go on moving after
they freeze, ice growing out through the skin, jaws split, limbs too long. They hunt by warmth and
sound. It speaks with the voices of those it has taken: on the radio, behind doors, in the dark.
**The Shades** (Тени) are the 1962 subjects' echoes: pale, half-there figures that come in the
dark and the cold, steal your warmth, cannot be shot, and back away from a strong light.

## How it plays

- **Survive the cold.** A warmth gauge falls outdoors (faster in the blizzard, faster wet), rises
  by stoves, heaters, the banya and the tug's mess. Too cold: the view frosts over, the hands
  shake, health drains.
- **Health** (medkits, аптечка), **stamina** (running), **light** (the flashlight's battery,
  spare batteries; flares).
- **Fight sparingly.** Makarov PM pistol (8 rounds), SPSh-44 flare pistol (scares bears, burns
  the Turned, lights the dark), Mosin-Nagant M44 carbine (5 rounds, stripper clips, bolt), AKM
  (30-round magazines, Orlov's). Ammunition is scarce. Reloading takes time; the bolt is slow.
- **Hide.** Lockers and wardrobes. Crouch (C), walk quietly, put the light out.
- **Read.** Notes, journals, telexes, the 1962 archive: Russian with an English translation.
- **Progress** by restoring power, fixing the radio, finding keycards and door codes, routing
  power in the bunker, carrying thermite down to the Guest.
- Checkpoints save at every chapter and objective (Continue on the title screen).

## Chapters

1. **Молчание — Silence** (aboard, at sea, ~20 min). The briefing on the bridge; Sergeant Orlov
   hands you a Makarov "for the bears". The radar dies: a fuse in the engine room, and the lights
   go on the way down. Something knocks along the hull from outside. The mess radio picks up
   Severny: a woman counting, then your name. On the way through the ice: a polar bear torn open
   on a floe, a figure standing on the ice in the searchlight that is not there twice. Bring her
   alongside a dark, dead station.
2. **Северный — Severny** (the station in a blizzard, ~25 min). Ashore with Orlov and the bosun.
   The main house barricaded from inside, blood frozen on the floors, Gromov's journal. Power: the
   generator hut needs fuel (the depot, where a bear is feeding) and a fuse (the workshop). The
   lights come on: the mess hut's scientists sit frozen at their table, and one of them turns its
   head. Orlov goes quiet on the radio; you find his AK and what is left of him.
3. **Голоса — Voices** (the station, ~25 min). The radio room: the antenna's feeder is cut at the
   mast; climb it in the storm. Call the *Polyarnik*: the captain answers, and then he answers
   again, differently. The lab (Gromov's keycard, a code in his notes): the core samples, a tape of
   the descent into Shaft 3. The kennel. The banya. The Turned search the station; hide.
4. **Объект-7 — Object 7** (under the ice cap, ~35 min). Down the drilling shed's shaft into the
   facility: concrete and frost, red stars and slogans, the canteen, the barracks, the cryo hall
   with its frozen subjects, the archive and Sokolov's office, the reactor hall (route power to the
   blast doors), the ice cave and the Guest. The Shades in the dark corridors; the 1962 garrison,
   Turned. Gromov, what he has become. Set the thermite on the cave's three ice pillars and run.
5. **Домой — Home** (the tug, ~20 min). Dawn twilight, the aurora gone red. The *Polyarnik* dark
   at her lines, her crew taken. Start the engine (air bottles, fuel, the button) with them coming
   down the stairs, cast off the lines with bears on the ice, take the wheel from what is standing
   at it, and break out through the ice. The radio, in open water: «Полярник, я Северный… Мы ждём
   вас».

## Places

- **The *Polyarnik*** (exists), darker: flickering lights, frost creeping in later, blood.
- **Station Severny**, rebuilt and extended: the main house (hall, Gromov's room, the radio room,
  the workshop), the mess hut, the lab, the generator hut, the fuel depot, the kennel, the banya,
  the drilling shed over Shaft 3, the radio mast (climbable), a crashed An-2 on the ice; the
  island's ice cap rising behind it with the blast doors of Object 7's old portal.
- **Object 7**, a separate level under the cap: two floors of Soviet concrete under ice.

## Creatures

- **Polar bears** (Белый медведь): on the floes, on the shore, round the depot. They roam, sniff,
  stalk and charge; a flare or a shot turns most of them. Detailed, furred, rigged.
- **The Turned**: the station's people and the 1962 garrison. Shamble, then sprint; hear running,
  shots, doors; sense warmth; climb out of places. Rigged on the people's rig.
- **The Shades**: translucent, flickering, never quite where you look.
- **Gromov**, the Turned chief, larger, armoured in ice.
- **The Guest**: a wall of the frozen dead in the cave, its tendrils moving in the ice.

## Systems (code)

`src/survival/` (stats, inventory, items, documents, saves), `src/weapons/` (viewmodels, firing,
reloading, ammunition), `src/enemies/` (the Turned, bears, Shades, perception, pathing on the
Nav grid), `src/horror/` (scares, events, lights failing, camera effects), `src/levels/`
(the station's interiors, Object 7), `src/story/` (chapters, objectives, lines). Blender:
`make_bear.py`, `make_turned.py`, `make_weapons.py`, `make_station.py` (extended),
`make_bunker.py`.
