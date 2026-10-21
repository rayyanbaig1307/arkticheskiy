import * as THREE from 'three';
import { propFor } from '../levels/Props.js';

// Chapter 3, Голоса (Voices): the station, the storm, the radio.
//
//   key       the radio room is locked: the spare key in the duty desk's drawer (Golubev's log)
//   radio     Markova's room, her notes; the set is dead: the antenna's feeder is cut at the mast
//   feeder    a length of feeder cable from the workshop, up the mast in the storm, mend it
//   call      call the Polyarnik: the captain answers; and then he answers again, differently
//   lab       the lab (its door code in Gromov's journal), the analysis, Gromov's tape from the
//             shaft; the cold room with the cores (his pass behind Nadya's photo)
//   search    they are searching the station now; voices at the doors. Up to Shaft 3
//   shaft     down the shaft into Object 7

const L = (d, id) => d.say(id);
const ITEM = (d, id, item, pos, count = 1) => {
  if (d.flag('placed:' + id)) return;
  d.set('placed:' + id);
  const prop = propFor(item);
  prop.position.copy(d.ctx.boat.toLocal(pos.clone(), new THREE.Vector3()));
  d.ctx.boat.root.add(prop);
  d.h.pickups.add(prop, { id: 'ch3:' + id, item, count });
};

export const CH3 = {
  setup(d) {
    d.sky('blizzard'); d.ambience('storm');
    d.mooredNow();
    d.set('power'); d.ctx.station.dark = false;
    ITEM(d, 'key_radio', 'key_radio', d.st(-6.9, 83.3, 1.5 + 0.79));
    ITEM(d, 'feeder', 'feeder_cable', d.st(3.0, 82.7, 1.5 + 0.92));
    d.use('radio', {
      hint: () => 'Рация / The radio',
      use: () => {
        d.sfx('radio_burst', d.point('station', 'USE', 'radio'));
        if (!d.flag('feeder')) { d.h.hud.toast('Тишина: фидер антенны перерезан у мачты.', 'Dead: the antenna\'s feeder is cut at the mast.'); d.set('radio_dead'); return; }
        d.set('called');
      },
    });
    d.use('feeder', {
      hint: () => (d.flag('feeder') ? 'Фидер исправен / The feeder is mended' : 'Фидер / The feeder'),
      use: () => {
        if (d.flag('feeder')) return;
        if (!d.has('feeder_cable')) { d.h.hud.toast('Нужен кабель — в мастерской.', 'It needs a length of cable: the workshop.'); return; }
        d.take('feeder_cable'); d.set('feeder');
        d.sfx('metal_scrape', d.point('station', 'USE', 'feeder'));
        d.h.hud.toast('Фидер соединён.', 'The feeder is joined.');
      },
    });
    d.use('play', {
      hint: (p) => 'Магнитофон / The tape recorder',
      use: (p) => {
        if (p.data.tape === 'tape_shaft3' && !d.flag('tape')) {
          d.set('tape');
          d.sfx('pickup', p.pos);
          d.lines(['c3_tape_1', 'c3_tape_2', 'c3_tape_3', 'c3_tape_4', 'c3_tape_5', 'c3_tape_6', 'c3_tape_7', 'c3_tape_8', 'c3_tape_9', 'c3_tape_10'], () => d.set('tape_done'), { inear: true, gap: 0.9, keep: true });
          d.after(34, () => d.h.stats.scare?.(0.35), true);
        } else if (p.data.tape === 'tape_sokolov' && !d.flag('reel')) {
          d.set('reel');
          d.lines(['c4_reel_1', 'c4_reel_2', 'c4_reel_3', 'c4_reel_4', 'c4_reel_5', 'c4_reel_6', 'c4_reel_7', 'c4_reel_8'], () => d.set('reel_done'), { inear: true, gap: 0.9, keep: true });
        }
      },
    });
    d.use('core', { hint: () => 'Керн / The core', use: () => { d.h.hud.toast('Лёд тёплый на ощупь.', 'The ice is warm to the touch.'); d.h.stats.scare?.(0.25); d.creature('guest_pulse', d.point('station', 'USE', 'core')); } });
  },
  restore(d, id) {
    d.h.weapons.give?.('pm'); d.h.weapons.give?.('akm');
    if (!d.has('thermite', 3)) d.give('thermite', 3 - d.h.inventory.count('thermite'));
    d.teleport(d.st(-9.5, 86, 1.1), Math.PI / 2);
  },
  always(d, dt) { for (const p of d.puppets || []) p.update(dt); },
  steps: [
    {
      id: 'key', checkpoint: true,
      objective: ['Радиорубка заперта', 'The radio room is locked', '', 'The spare key is in the duty desk\'s drawer, in the hall (Golubev wrote so in his log).'],
      marker: (d) => (d.has('key_radio') ? null : d.st(-6.9, 83.3, 2.6)),
      update(d) { return d.has('key_radio'); },
    },
    {
      id: 'radio',
      objective: ['Радиорубка', 'The radio room', '', 'The back of the main house. Markova\'s set.'],
      marker: (d) => d.st(5.5, 89.0, 2.6),
      update(d) { return d.flag('radio_dead'); },
    },
    {
      id: 'feeder', checkpoint: true,
      objective: ['Почините фидер на мачте', 'Mend the feeder at the top of the mast', '', 'A length of cable from the workshop bench, then up the mast\'s ladder (east leg) in the storm.'],
      marker: (d) => (d.has('feeder_cable') ? d.st(30.3, 98, 28.5) : d.st(3.0, 82.7, 2.8)),
      update(d) {
        if (!this.shade && d.flag('feeder')) {
          // something below, looking up
          this.shade = d.creatureAt('shade', d.st(30, 92, 1.5), { state: 'drift', name: 'mast_shade' });
          d.creature('shade_wail', d.st(30, 92, 2));
        }
        return d.flag('feeder');
      },
    },
    {
      id: 'call', checkpoint: true,
      objective: ['Вызовите «Полярник»', 'Call the Polyarnik', '', 'Back to the radio room.'],
      marker: (d) => d.st(5.5, 89.0, 2.6),
      update(d) {
        if (d.flag('called') && !this.go) {
          this.go = true;
          d.lines(['c3_captain_1', 'c3_captain_2', 'c3_captain_3', 'c3_captain_4'], () => {
            d.after(5, () => { d.sfx('radio_burst', null); d.stinger('reveal'); d.lines(['c3_other_1', 'c3_other_2', 'c3_other_3', 'c3_other_4'], () => { this.done = true; }, { radio: true, gap: 1.0 }); });
          }, { radio: true, gap: 0.8 });
        }
        return this.done;
      },
    },
    {
      id: 'lab', checkpoint: true,
      objective: ['Лаборатория', 'The lab', '', 'Its door wants a code: the day they went down, in Gromov\'s journal. Inside, his tape.'],
      marker: (d) => d.st(16.0, 76, 2.8),
      update(d) { return d.flag('tape_done'); },
    },
    {
      id: 'search', checkpoint: true,
      objective: ['Шахта № 3', 'Shaft 3', '', 'Up the cap to the drilling shed, and down. They are searching the station: keep to the dark, hide in a locker.'],
      marker: (d) => d.st(54.5, 220.5, 46.0),
      enter(d) {
        d.stinger('chase_start');
        this.hunters = [
          d.creatureAt('turned_a', d.st(-14, 92, 1.1), { state: 'wander', name: 's1' }),
          d.creatureAt('turned_b', d.st(14, 92, 1.1), { state: 'wander', name: 's2' }),
          d.creatureAt('turned_c', d.st(-2, 70, 1.1), { state: 'wander', name: 's3', crawler: true }),
          d.creatureAt('turned_a', d.st(26, 110, 2.2), { state: 'wander', name: 's4' }),
        ];
        const voices = ['c3_voices_1', 'c3_voices_2', 'c3_voices_3', 'c3_voices_4', 'c3_voices_5'];
        voices.forEach((id, k) => d.after(10 + k * 22, () => { if (/^mh_|^mess|^lab/.test(d.h.zone?.name || '')) L(d, id); }));
      },
      update(d, dt) {
        // the search: now and then one of them comes to look round near where you are (not at
        // you: a few metres off), so the dark between the huts is never quite safe
        this.searchT = (this.searchT ?? 14) - dt;
        if (this.searchT <= 0) {
          this.searchT = 16 + Math.random() * 12;
          const free = (this.hunters || []).filter((c) => c && !c.dead && (c.state === 'idle' || c.state === 'wander'));
          const c = free[Math.floor(Math.random() * free.length)];
          if (c) {
            const p = d.ctx.player.pos, a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 6;
            c.sense.lastKnown.set(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
            c.go('investigate');
          }
        }
        return d.near(d.st(54.5, 220.5, 45.0), 4);
      },
    },
    {
      id: 'shaft',
      objective: ['Вниз по шахте', 'Down the shaft', '', 'The ladder in the hatch. Forty metres down, to the concrete.'],
      update(d) {
        const p = d.eye();
        const top = d.st(54.5, 220.5, 44.3);
        if (!this.go && Math.hypot(p.x - top.x, p.z - top.z) < 0.9 && p.y < top.y - 1.0) {
          this.go = true;
          d.fade(1.4, () => {
            d.ctx.ui.toast('Down. Forty metres.', 4);
            const s = d.point('bunker', 'SPOT', 'bunker_arrive');
            if (s) d.teleport(s.clone().add(new THREE.Vector3(0, 0.1, 0)), d.ctx.player.yaw);
            this.done = true;
          });
        }
        return this.done;
      },
    },
  ],
};
