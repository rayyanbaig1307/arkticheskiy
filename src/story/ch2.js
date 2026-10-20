import * as THREE from 'three';

// Chapter 2, Северный (Severny): the station in a blizzard.
//
//   ashore     down the gangway onto the ice; the bosun with you as far as the house
//   house      the main house: its front door nailed shut from inside; in by the back
//   power      the generator: diesel from the depot (where a bear is feeding), a fuse from the
//              workshop's sweet tin, the hut's key from the key board
//   lights     the lights come on; the mess hut: the three still at their table
//   orlov      Orlov goes quiet on the radio, then says what he has seen; up the cap to him
//   drill      at the drilling shed: what is left of him, his AK, his kit; and his voice again

const _v = new THREE.Vector3();
const L = (d, id) => d.say(id);

export const CH2 = {
  setup(d, restoring) {
    d.sky('blizzard'); d.ambience('storm');
    d.ctx.audio?.horror?.setBlizzard?.(1);
    d.mooredNow();
    d.ctx.station.dark = !d.flag('power');
    // the generator: needs the fuel and the fuse (the hut's own door wants its key)
    d.use('generator', {
      hint: () => (d.flag('power') ? 'Дизель работает / The generator is running' : 'Дизель / The generator'),
      use: () => {
        if (d.flag('power')) return;
        const miss = [];
        if (!d.has('fuel_can')) miss.push(['канистры с соляркой', 'a can of diesel']);
        if (!d.has('fuse')) miss.push(['предохранителя', 'a fuse']);
        if (miss.length) { d.h.hud.toast(`Нет ${miss.map((m) => m[0]).join(' и ')}.`, `It needs ${miss.map((m) => m[1]).join(' and ')}.`); d.sfx('generator_fail', d.point('station', 'USE', 'generator')); return; }
        d.take('fuel_can'); d.take('fuse');
        const at = d.point('station', 'USE', 'generator');
        d.sfx('generator_start', at);
        d.after(3.2, () => {
          d.set('power'); d.ctx.station.dark = false;
          d.ctx.audio?.horror?.loop?.('generator', at, true);
          d.sfx('lights_on', null);
        });
      },
    });
    // stoves: warmth (the Turned don't like it either)
    for (const name of ['stove_hall', 'stove_mess', 'stove_banya']) {
      const p = d.point('station', 'USE', name);
      if (p && !d.h.heat.some((h) => h.name === name)) d.h.heat.push({ name, pos: d.ctx.boat.toLocal(p.clone(), new THREE.Vector3()), r: name === 'stove_banya' ? 3 : 3.5, k: 1 });
    }
    d.use('stove', { hint: () => 'Погреться у печи / Warm up', use: () => { d.h.stats.warm?.(25); d.h.hud.toast('Тепло.', 'Warm.'); } });
    if (!restoring) d.ctx.station.dark = true;
  },
  restore(d, id) {
    const order = CH2.steps.map((s) => s.id);
    const k = order.indexOf(id);
    const spawns = { ashore: d.ctx.model.spots.guard_aft, house: null };
    if (k <= 0 && spawns.ashore) d.ctx.player.spawn({ pos: spawns.ashore.pos.clone(), yaw: spawns.ashore.yaw });
    else if (k >= order.indexOf('drill')) d.teleport(d.st(54.5, 212, 44.5), 0);
    else if (k >= order.indexOf('orlov')) d.teleport(d.st(-14, 74, 1.1), 0);
    else d.teleport(d.st(-9.5, 86, 1.1), Math.PI / 2);
    d.h.weapons.give?.('pm');
    if (k >= order.indexOf('lights')) { d.set('power'); d.ctx.station.dark = false; d.ctx.audio?.horror?.loop?.('generator', d.point('station', 'USE', 'generator'), true); }
  },
  always(d, dt) { for (const p of d.puppets || []) p.update(dt); },
  steps: [
    {
      id: 'ashore',
      objective: ['Сойдите на берег', 'Go ashore', '', 'The gangway: starboard side, on the aft deck just behind the deckhouse.'],
      marker: (d) => d.st(8.75, 2.0, 2.2),
      enter(d) { d.after(2, () => d.ctx.ui.toast('Холод: держитесь у печей и в домах · The cold: keep near stoves, indoors', 7)); },
      update(d) { if (d.ashore()) { L(d, 'c2_ashore_1'); return true; } return false; },
    },
    {
      id: 'tracks',
      objective: ['Главный дом', 'The main house', '', 'Follow the lamp posts up from the berth. The house is the long red one.'],
      marker: (d) => d.st(0, 81, 3.2),
      enter(d) { d.after(8, () => L(d, 'c2_ashore_3')); },
      update(d) {
        if (!this.prints && d.near(d.st(0, 60, 1.5), 22)) { this.prints = true; L(d, 'c2_ashore_2'); }
        return d.near(d.st(0, 81.5, 2.5), 3.5);
      },
    },
    {
      id: 'door',
      objective: ['Найдите другой вход', 'Find another way in', '', 'The front door is nailed shut from inside. Round the west end: the back door.'],
      marker: (d) => d.st(-8.6, 86, 2.6),
      enter(d) { L(d, 'c2_ashore_4'); d.sfx('door_locked', d.st(0, 82.25, 2.5)); },
      update(d) { return /^mh_/.test(d.h.zone?.name || ''); },
    },
    {
      id: 'house', checkpoint: true,
      objective: ['Осмотрите дом', 'Search the house', '', 'The hall, Gromov\'s room, the workshop. Read what they left.'],
      enter(d) { this.t0 = d.t; d.stinger('dread'); },
      update(d) {
        const read = d.h.inventory.docs?.has?.('ch2_duty_log') || d.h.inventory.docs?.has?.('ch2_gromov_1');
        if (!this.go && (read || d.t - this.t0 > 50)) {
          this.go = true;
          d.lines(['c2_ashore_5', 'c2_ashore_6'], () => { this.done = true; }, { radio: true });
        }
        return this.done;
      },
    },
    {
      id: 'power', checkpoint: true,
      objective: ['Запустите дизель', 'Start the generator', '', 'Diesel from the fuel depot, a fuse from the workshop (the sweet tin). The keys hang on the workshop\'s board.'],
      marker: (d) => {
        if (!d.has('fuse')) return d.st(4.6, 82.9, 2.6);
        if (!d.has('key_generator') && !d.has('fuel_can')) return d.st(7.6, 84.6, 3.0);
        if (!d.has('fuel_can')) return d.st(-38.5, 101, 3.0);
        return d.st(-6, 101.5, 3.2);
      },
      enter(d) { d.after(18, () => L(d, 'c2_orlov_1')); },
      update(d) {
        if (!this.bear && d.near(d.st(-30, 96, 1.5), 55)) {
          this.bear = d.spawn('station', 'depot_bear', { state: 'eat', aggression: 0.7 });
          d.creature('bear_growl', d.st(-33, 94.5, 1.6));
        }
        return d.flag('power');
      },
    },
    {
      id: 'lights', checkpoint: true,
      objective: ['Проверьте столовую', 'Check the mess hut', '', 'The blue hut west of the house. Its window is lit now.'],
      marker: (d) => d.st(-17.6, 74, 2.8),
      enter(d) {
        L(d, 'c2_orlov_2');
        this.sitters = ['mess_1', 'mess_2', 'mess_3'].map((n) => d.spawn('station', n));
      },
      update(d) {
        if (!this.inside && d.inZone('mess')) { this.inside = true; this.t1 = d.t; d.stinger('reveal'); }
        if (this.inside && d.t - this.t1 > 25) return true;
        const live = (this.sitters || []).filter((c) => c && !c.dead);
        return this.inside && live.length === 0;
      },
    },
    {
      id: 'orlov', checkpoint: true,
      objective: ['Орлов не отвечает', 'Orlov has gone quiet', '', 'Up the ice cap along the flags, to the drilling shed.'],
      marker: (d) => d.st(54.5, 216, 46.5),
      enter(d) {
        d.lines(['c2_orlov_3', 'c2_orlov_4', 'c2_orlov_5', 'c2_orlov_6'], null, { radio: true, gap: 1.2, delay: 2 });
        // the Turned on the way up
        this.walkers = [
          d.creatureAt('turned_a', d.st(18, 130, 6), { state: 'wander', name: 'cap1' }),
          d.creatureAt('turned_b', d.st(36, 175, 22), { state: 'wander', name: 'cap2' }),
        ];
      },
      update(d) { return d.near(d.st(54.5, 214, 45.5), 10); },
    },
    {
      id: 'drill', checkpoint: true,
      objective: ['Буровая', 'The drilling shed', '', 'Orlov\'s AK by the door. Take it.'],
      marker: (d) => d.st(55.8, 216.2, 45.0),
      enter(d) {
        d.stinger('reveal');
        this.onPick = d.h.pickups.onPick;
        d.h.pickups.onPick = (p) => {
          if (/orlov_akm/.test(p.id)) { this.got = true; d.give('thermite', 3); d.h.hud.toast('Термитные заряды ×3', 'Thermite charges ×3'); }
          this.onPick?.(p);
        };
      },
      update(d) {
        if (this.got && !this.go) {
          this.go = true;
          d.after(4, () => L(d, 'c2_false_1'));
          d.after(9, () => { L(d, 'c2_false_2'); d.h.stats.scare?.(0.5); });
          d.after(16, () => { this.done = true; d.h.pickups.onPick = this.onPick; });
        }
        return this.done;
      },
    },
  ],
};
