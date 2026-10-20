import * as THREE from 'three';
import { propFor } from '../levels/Props.js';

// Chapter 4, Объект-7 (Object 7): under the ice cap.
//
//   arrive    the fan room under Shaft 3; the guard post; corridor A: the canteen (the garrison's
//             dead at their table), the barracks; the stairs down
//   reactor   floor 2: corridor B (the Shades), the reactor hall
//   breakers  the three breakers in Zubov's order (II, I, III): the wrong order cuts everything
//             and something comes in the dark; the right one brings the power back
//   cryo      the cryo hall (open now): Belyaeva's diary, the safe's combination
//   safe      the commandant's office: the safe, the blasting machine (КПМ-1)
//   sector    Sector G's blast door, the cut through the ice, the cave
//   cave      the Guest; Gromov; thermite on the three pillars
//   run       fire it: the cave comes down; run, the garage, the tunnel, the portal, out

// a point in Object 7's own frame (make_bunker.py's axes) to the world
const bk = (d, x, y, z) => d.st(20 + x, 222 + y, 12 + z);
const L = (d, id) => d.say(id);
const F2 = -4.5;

function keypad(d, code, onOk) {
  const fake = { lock: 'code:' + code, name: 'kp_' + code, node: d.ctx.camera };
  const L_ = { openDoor: () => onOk() };
  d.codePrompt(fake, L_);
}

export const CH4 = {
  setup(d) {
    d.sky('dread'); d.ambience('bunker');
    d.ctx.audio?.horror?.setBlizzard?.(0);
    d.mooredNow();
    const B = d.h.levels.bunker;
    B.setPower(!!d.flag('bunker_power'));
    // the breakers: II, I, III
    d.use('breaker', {
      hint: (p) => `Рубильник ${['', 'I', 'II', 'III'][p.data.breaker]} / Breaker ${['', 'I', 'II', 'III'][p.data.breaker]}`,
      use: (p) => {
        if (d.flag('bunker_power')) return;
        const n = p.data.breaker;
        const seq = (d.flags.seq || []).concat([n]);
        const want = [2, 1, 3];
        p.node.rotation.x += 1.1;                       // (the handle thrown)
        d.sfx('lights_on', p.pos, { gain: 0.5 });
        if (seq.some((v, k) => v !== want[k])) {
          d.set('seq', []);
          d.sfx('generator_fail', p.pos); d.sfx('light_pop', null);
          B.dim = 0.05; d.after(5, () => { B.dim = 1; }, true);
          for (const q of B.points.USE) if (q.data.action === 'breaker') q.node.rotation.x = -0.61;
          d.h.hud.toast('Всё погасло.', 'Everything went dark.');
          d.creatureAt('shade', bk(d, -6, 6, F2), { state: 'drift', name: 'breaker_shade_' + d.t.toFixed(0) });
          d.scare('jump_soft');
          return;
        }
        d.set('seq', seq);
        if (seq.length === 3) {
          d.set('bunker_power'); B.setPower(true);
          d.sfx('lights_on', null, { gain: 1.2 });
          d.h.hud.toast('Питание есть.', 'The power is on.');
        }
      },
    });
    d.use('safe', {
      hint: () => (d.flag('safe') ? 'Сейф открыт / The safe is open' : 'Сейф / The safe'),
      use: () => { if (!d.flag('safe')) keypad(d, '1204', () => { d.set('safe'); d.give('detonator', 1); d.sfx('door_heavy', null, { gain: 0.4 }); d.h.hud.toast('Подрывная машинка КПМ-1.', 'A КПМ-1 blasting machine.'); }); },
    });
    d.use('sectorG', {
      hint: () => (d.flag('bunker_power') ? 'Открыть гермоворота / Open the blast door' : 'Гермоворота: нет питания / The blast door: no power'),
      use: () => {
        if (!d.flag('bunker_power')) { d.sfx('door_locked', null); return; }
        const door = B.doors.find((x) => x.name === 'sectorG');
        if (door && door.t < 0.5) { B.openDoor(door, true); d.sfx('door_heavy', door.node.getWorldPosition(new THREE.Vector3())); d.set('sector_open'); }
      },
    });
    d.use('thermite', {
      hint: (p) => (d.flag('pillar_' + p.data.pillar) ? 'Заряд установлен / The charge is set' : 'Заложить термит / Set a thermite charge'),
      use: (p) => {
        const k = p.data.pillar;
        if (d.flag('pillar_' + k)) return;
        if (!d.has('thermite')) { d.h.hud.toast('Нет термита.', 'No thermite left.'); return; }
        d.take('thermite'); d.set('pillar_' + k);
        const prop = propFor('thermite'); prop.position.copy(d.ctx.boat.toLocal(p.pos.clone(), new THREE.Vector3())); d.ctx.boat.root.add(prop);
        d.sfx('metal_scrape', p.pos);
        d.h.hud.toast(`Заряд ${[1, 2, 3].filter((i) => d.flag('pillar_' + i)).length} из 3`, `Charge ${[1, 2, 3].filter((i) => d.flag('pillar_' + i)).length} of 3`);
      },
    });
    d.use('portal', {
      hint: () => (d.flag('bunker_power') ? 'Открыть ворота / Open the portal' : 'Ворота: нет питания / No power'),
      use: () => {
        if (!d.flag('bunker_power')) return;
        for (const door of B.doors.filter((x) => /portal/.test(x.name))) B.openDoor(door, true);
        d.sfx('door_heavy', null, { gain: 1.2 }); d.set('portal_open');
      },
    });
  },
  restore(d, id) {
    d.h.weapons.give?.('pm'); d.h.weapons.give?.('akm');
    const order = CH4.steps.map((s) => s.id);
    const k = order.indexOf(id);
    if (k >= order.indexOf('cryo')) { d.set('bunker_power'); d.h.levels.bunker.setPower(true); }
    // (what the steps before gave: the blasting machine, the thermite for the pillars not yet set)
    if (k > order.indexOf('safe') && !d.has('detonator')) { d.set('safe'); d.h.inventory.add('detonator', 1); }
    const need = 3 - [1, 2, 3].filter((n) => d.flag('pillar_' + n)).length, have = d.h.inventory.count('thermite');
    if (have < need) d.h.inventory.add('thermite', need - have);
    const B = d.h.levels.bunker;
    if (k > order.indexOf('sector') || d.flag('sector_open')) { const g = B.doors.find((x) => x.name === 'sectorG'); if (g) B.openDoor(g, true); d.set('sector_open'); }
    if (d.flag('blown')) for (const p of B.points.PILLAR) p.node.visible = false;
    const where = k >= order.indexOf('sector') ? bk(d, 24, 0, F2 + 0.1) : k >= order.indexOf('breakers') ? bk(d, 0, 0, F2 + 0.1) : null;
    const s = d.point('bunker', 'SPOT', 'bunker_arrive');
    d.teleport(where || s, d.ctx.player.yaw);
  },
  always(d, dt) { for (const p of d.puppets || []) p.update(dt); },
  steps: [
    {
      id: 'arrive', checkpoint: true,
      objective: ['Объект-7', 'Object 7', '', 'Find where the power comes on: the reactor hall, on the floor below. The stairs are off corridor A.'],
      enter(d) {
        d.stinger('chapter');
        if (!d.flag('c4_spawned')) {
          d.set('c4_spawned');
          for (const n of ['canteen_1', 'canteen_2', 'canteen_3', 'canteen_4']) d.spawn('bunker', n);
          d.spawn('bunker', 'barracks_1'); d.spawn('bunker', 'corA_1');
        }
      },
      update(d) { return d.inZone('corB') || d.inZone('stairs') && d.eye().y < bk(d, 0, 0, -2).y; },
    },
    {
      id: 'reactor', checkpoint: true,
      objective: ['Реакторный зал', 'The reactor hall', '', 'West along corridor B.'],
      marker: (d) => bk(d, -2.5, 0, F2 + 2.5),
      enter(d) { d.spawn('bunker', 'corB_shade_1'); d.after(6, () => L(d, 'c4_voices_1')); },
      update(d) { return d.inZone('reactor'); },
    },
    {
      id: 'breakers',
      objective: ['Рубильники', 'The breakers', '', 'Zubov left a note in the switchboard\'s frame: the order matters.'],
      marker: (d) => bk(d, -15.3, -4.4, F2 + 1.6),
      update(d) { return d.flag('bunker_power'); },
    },
    {
      id: 'cryo', checkpoint: true,
      objective: ['Криозал', 'The cryo hall', '', 'Its doors are open now. The medical officer\'s desk: Belyaeva\'s diaries.'],
      marker: (d) => bk(d, 9, 1.0, F2 + 2.4),
      enter(d) { d.spawn('bunker', 'cryo_2', { pose: 'dead' }); d.spawn('bunker', 'cryo_7', { pose: 'dead' }); d.after(10, () => L(d, 'c4_voices_2')); },
      update(d) { return d.h.inventory.docs?.has?.('ch4_belyaeva_2'); },
    },
    {
      id: 'safe', checkpoint: true,
      objective: ['Сейф начальника', 'The commandant\'s safe', '', 'Upstairs, his office off corridor A. The combination: the day and month Gagarin flew.'],
      marker: (d) => bk(d, -21.2, 2.4, 1.0),
      enter(d) { d.after(14, () => L(d, 'c4_voices_3')); },
      update(d) { return d.flag('safe'); },
    },
    {
      id: 'sector', checkpoint: true,
      objective: ['Сектор «Г»', 'Sector G', '', 'The blast door at the end of corridor B.'],
      marker: (d) => bk(d, 27.0, 0, F2 + 1.4),
      enter(d) { d.after(8, () => L(d, 'c4_voices_4')); },
      update(d) { return d.inZone('cave'); },
    },
    {
      id: 'cave', checkpoint: true,
      objective: ['Термит на три колонны', 'Thermite on the three pillars', '', 'The ice pillars hold up the cave\'s roof.'],
      marker: (d) => { for (const k of [1, 2, 3]) if (!d.flag('pillar_' + k)) return d.point('bunker', 'USE', 'pillar_' + k); return null; },
      enter(d) {
        d.stinger('reveal');
        d.ctx.audio?.horror?.setAmbience?.('cave');
        const heart = d.point('bunker', 'GUEST', 'centre');
        if (heart) d.ctx.audio?.horror?.loop?.('guest_heart', heart, true);
        d.after(6, () => { this.gromov = d.spawn('bunker', 'gromov', { state: 'hunt' }); d.lines(['c4_gromov_1', 'c4_gromov_2'], null, { inear: true }); });
        d.after(30, () => L(d, 'c4_gromov_3'));
      },
      update(d) {
        const n = [1, 2, 3].filter((k) => d.flag('pillar_' + k)).length;
        if (n === 1 && !this.s1) { this.s1 = true; L(d, 'c4_charges_1'); }
        if (n === 2 && !this.s2) { this.s2 = true; L(d, 'c4_gromov_4'); }
        return n === 3;
      },
    },
    {
      id: 'run', checkpoint: false,
      objective: ['Взорвать — и бежать!', 'Fire it, and run!', '', 'Out of the cave, then the stairs up, the garage at the west end, the tunnel, the portal.'],
      marker: (d) => (d.flag('blown') ? d.point('bunker', 'USE', 'portal') : bk(d, 27.0, 0, F2 + 1.4)),
      enter(d) { L(d, 'c4_charges_2'); d.after(4, () => L(d, 'c4_gromov_5')); },
      update(d) {
        if (!d.flag('blown') && d.inZone('corB')) {
          if (!d.has('detonator')) { if (!this.warn) { this.warn = true; d.h.hud.toast('Нужна подрывная машинка — сейф начальника.', 'You need the blasting machine: the commandant\'s safe.'); } return false; }
          d.set('blown');
          d.sfx('explosion', d.point('bunker', 'GUEST', 'centre')); d.sfx('ice_collapse', null, { gain: 1.4 });
          d.ctx.player.shakeT = 2.5; d.stinger('chase_start');
          for (const p of d.h.levels.bunker.points.PILLAR) p.node.visible = false;
          d.h.levels.bunker.dim = 0.4; d.after(6, () => { d.h.levels.bunker.dim = 1; }, true);
          d.after(3, () => L(d, 'c4_gromov_6'));
          d.creatureAt('turned_c', bk(d, 10, 0, 0.1), { state: 'hunt', name: 'run1' });
          d.creatureAt('turned_c', bk(d, -20, 0, 0.1), { state: 'hunt', name: 'run2', crawler: true });
          d.checkpoint('run');
        }
        if (d.flag('blown') && !d.flag('portal_open')) {
          const p = d.point('bunker', 'USE', 'portal');
          if (p && d.near(p, 5)) d.h.uses.portal.use();
        }
        const out = d.point('bunker', 'SPOT', 'portal_out');
        return d.flag('portal_open') && out && d.near(out, 4);
      },
    },
  ],
};
