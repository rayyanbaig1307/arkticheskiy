import * as THREE from 'three';
import { hitProxy, propFor } from '../levels/Props.js';

// Chapter 5, Домой (Home): the first twilight; the Polyarnik dark at her lines.
//
//   down      down the road from the portal to the berth; the aurora gone the colour of blood
//   aboard    her crew is taken: their voices still call from the mess, the engine room
//   engine    start the engine: the air bottles, the fuel cock, the start button
//   lines     cast off the lines, fore and aft, with bears on the ice
//   wheel     take the wheel from what is standing at it
//   out       out through the ice to the south, to open water; the radio

const L = (d, id) => d.say(id);
const _v = new THREE.Vector3();

// a thing to use aboard (boat space), with its hint and what it does
function useAboard(d, local, hint, fn, item) {
  const m = item ? propFor(item) : hitProxy(0.5);
  m.position.copy(local);
  d.ctx.boat.root.add(m);
  const t = d.ctx.interactions.add(m, { hint, use: () => fn(m, t), range: 2.4 });
  return { m, t, remove: () => { d.ctx.interactions.remove(m); d.ctx.boat.root.remove(m); } };
}

export const CH5 = {
  setup(d) {
    d.sky('dawn_red'); d.ambience('boat_dead');
    d.mooredNow();
    d.ctx.boat.setEngine(false); d.ctx.boat.setOrder(0);
    for (const g of ['rooms', 'engine', 'deck']) d.ctx.lights?.setGroup?.(g, false);
    d.ctx.radar && (d.ctx.radar.dead = true);
    // the crew: gone (what wears their faces is the Turned now)
    for (const p of d.ctx.crew.people) { p.root.visible = false; d.ctx.interactions.remove(p.hit); }
    d.ctx.crew.disabled = true;
  },
  restore(d, id) {
    d.h.weapons.give?.('pm'); d.h.weapons.give?.('akm');
    const order = CH5.steps.map((s) => s.id);
    const k = order.indexOf(id);
    if (k <= order.indexOf('down')) d.teleport(d.st(-17, 140, 17.2), Math.PI);
    else { const s = d.ctx.model.spots.guard_aft; d.ctx.player.spawn({ pos: s.pos.clone(), yaw: s.yaw }); }
  },
  pilotTarget(d) {
    if (!d.flag('free')) return null;
    const b = d.ctx.station.berth;
    return new THREE.Vector3(b.pos.x - 200, 0, b.pos.z + 1800);
  },
  always(d, dt) { for (const p of d.puppets || []) p.update(dt); },
  steps: [
    {
      id: 'down', checkpoint: true,
      objective: ['На «Полярник»', 'To the Polyarnik', '', 'Down the road from the portal, past the station, to the berth.'],
      marker: (d) => d.ctx.boat.toWorld(d.ctx.model.spots.guard_aft.pos.clone().add(new THREE.Vector3(0, 2, 0)), new THREE.Vector3()),
      enter(d) {
        d.stinger('chapter');
        d.creatureAt('bear', d.st(-30, 40, 1.1), { state: 'roam', name: 'b1', home: { pos: d.ctx.boat.toLocal(d.st(-30, 40, 1.1), new THREE.Vector3()), radius: 30 } });
      },
      update(d) { return !!d.ctx.player.zone || d.ctx.boat.toLocal(d.eye(), _v).length() < 12; },
    },
    {
      id: 'aboard', checkpoint: true,
      objective: ['Машинное отделение', 'The engine room', '', 'She\'s dead. The engine first.'],
      marker: (d) => d.spot('engineer')?.add(new THREE.Vector3(0, 1.6, 0)),
      enter(d) {
        const sp = d.ctx.model.spots;
        this.turned = [
          sp.cook && d.h.enemies.spawn('turned_a', sp.cook.pos.clone(), { state: 'dormant', pose: 'feed', name: 'cook_t' }),
          sp.bosun && d.h.enemies.spawn('turned_b', sp.bosun.pos.clone(), { state: 'wander', name: 'bosun_t' }),
          sp.engineer2 && d.h.enemies.spawn('turned_c', sp.engineer2.pos.clone(), { state: 'dormant', pose: 'dead', name: 'eng_t' }),
        ];
        d.after(5, () => L(d, 'c5_aboard_1'));
        d.after(16, () => L(d, 'c5_aboard_2'));
      },
      update(d) { return d.inZone('engine'); },
    },
    {
      id: 'engine', checkpoint: true,
      objective: ['Запустите двигатель', 'Start the engine', '', 'The air bottles (both valves), the fuel cock by the filter, then hold the start button.'],
      enter(d) {
        const sp = d.ctx.model.spots;
        const base = (sp.engineer || sp.engineer2).pos;
        const steps = [['air', 'Открыть вентили баллонов / Open the air bottles', new THREE.Vector3(1.6, 1.0, 1.2)], ['fuel', 'Открыть топливный кран / Open the fuel cock', new THREE.Vector3(-1.4, 0.9, 0.6)], ['start', 'Пуск / The start button', new THREE.Vector3(0.4, 1.2, -0.6)]];
        this.uses = steps.map(([k, hint, off]) => useAboard(d, base.clone().add(off), () => (d.flag('eng_' + k) ? '' : hint), () => {
          const order = ['air', 'fuel', 'start'];
          const i = order.indexOf(k);
          if (i > 0 && !d.flag('eng_' + order[i - 1])) { d.h.hud.toast('Не по порядку.', 'Not in that order.'); return; }
          d.set('eng_' + k);
          d.sfx(k === 'start' ? 'generator_start' : 'metal_groan', null, { gain: 0.6 });
          if (k === 'start') d.after(2.5, () => { d.ctx.boat.setEngine(true); d.ctx.audio?.engineStart?.(); for (const g of ['rooms', 'engine', 'deck']) d.ctx.lights?.setGroup?.(g, true); L(d, 'c5_aboard_3'); });
        }));
        d.marker(() => { for (const [k] of [['air'], ['fuel'], ['start']]) if (!d.flag('eng_' + k)) return this.uses[['air', 'fuel', 'start'].indexOf(k)].m.getWorldPosition(new THREE.Vector3()); return null; });
      },
      update(d) { if (d.flag('eng_start') && d.ctx.boat.engineOn) { for (const u of this.uses) u.remove(); return true; } return false; },
    },
    {
      id: 'lines', checkpoint: true,
      objective: ['Отдайте концы', 'Cast off the lines', '', 'The bitts on the starboard side, at the bow and at the stern.'],
      enter(d) {
        const bitts = [new THREE.Vector3(3.35, 5.72, -16.7), new THREE.Vector3(4.6, 3.22, 18.3)];
        this.bitts = bitts.map((p, k) => useAboard(d, p.clone().add(new THREE.Vector3(-0.3, 0.4, 0)), () => (d.flag('line_' + k) ? '' : 'Отдать конец / Let go the line'), () => { d.set('line_' + k); d.sfx('chain_rattle', d.ctx.boat.toWorld(p, new THREE.Vector3())); }));
        d.marker(() => { for (const k of [0, 1]) if (!d.flag('line_' + k)) return this.bitts[k].m.getWorldPosition(new THREE.Vector3()); return null; });
        d.after(4, () => L(d, 'c5_aboard_4'));
        d.creatureAt('bear', d.st(-10, 12, 1.1), { state: 'stalk', name: 'b2' });
        d.creatureAt('bear', d.st(18, 8, 1.1), { state: 'roam', name: 'b3' });
      },
      update(d) { if (d.flag('line_0') && d.flag('line_1')) { for (const b of this.bitts) b.remove(); return true; } return false; },
    },
    {
      id: 'wheel', checkpoint: true,
      objective: ['Мостик: штурвал', 'The bridge: the wheel', '', 'Something is standing at it. Then set her on the autopilot, south.'],
      marker: (d) => d.spot('wheel')?.add(new THREE.Vector3(0, 1.8, 0)),
      enter(d) {
        const w = d.ctx.model.spots.wheel;
        this.helmsman = w && d.h.enemies.spawn('turned_c', w.pos.clone().add(new THREE.Vector3(0, 0, 0.4)), { state: 'idle', name: 'helm_t', yaw: w.yaw });
        d.after(3, () => L(d, 'c5_aboard_5'));
        // with it dead, the wheel sets her on the autopilot, south, and lets her go
        const S = d.ctx.stations;
        S.helmUse = {
          hint: () => (!this.helmsman || this.helmsman.dead ? 'Автопилот: курс на юг · Set the autopilot, south' : 'У штурвала кто-то стоит · Something is standing at the wheel'),
          use: () => { if (!this.helmsman || this.helmsman.dead) this.go = true; },
        };
      },
      update(d) {
        if (!this.said6 && d.inZone('bridge')) { this.said6 = true; L(d, 'c5_aboard_6'); }
        if (this.go) {
          d.ctx.stations.helmUse = null;
          d.set('free');
          d.ctx.voyage.castOff();
          d.ctx.boat.setOrder(3);
          return true;
        }
        return false;
      },
    },
    {
      id: 'out',
      objective: ['Во льды, на юг', 'Out through the ice, south', '', 'The autopilot takes her south through the ice. Keep them off her.'],
      enter(d) { d.stinger('chase_end'); this.said = 0; },
      update(d) {
        const b = d.ctx.boat, berth = d.ctx.station.berth;
        const dist = berth.pos.distanceTo(_v.set(b.x, 0, b.z));
        // the hull: knocked on from below, as on the way in
        if (dist > 200 && this.said === 0) {
          this.said = 1;
          const hull = d.ctx.boat.toWorld(new THREE.Vector3(1.2, -1.2, 4), new THREE.Vector3());
          for (let k = 0; k < 4; k++) d.after(k * 0.5, () => d.sfx('knock_hull', hull, { gain: 1.5 }));
          d.after(2.2, () => d.h.stats.scare?.(0.4));
        }
        // and something comes over the stern rail
        if (dist > 380 && this.said === 1) {
          this.said = 2;
          const sp = d.ctx.model.spots.guard_aft;
          if (sp) {
            d.sfx('metal_scrape', d.ctx.boat.toWorld(sp.pos.clone().add(new THREE.Vector3(0, 0.5, 4)), new THREE.Vector3()), { gain: 1.3 });
            d.after(1.2, () => { this.boarder = d.h.enemies.spawn('turned_c', sp.pos.clone().add(new THREE.Vector3(0, 0, 3.5)), { state: 'hunt', name: 'boarder', crawler: true }); d.stinger('chase_start'); });
          }
        }
        if (dist > 600 && this.said === 2) { this.said = 3; L(d, 'c5_open_1'); }
        if (dist > 850 && this.said === 3) { this.said = 4; d.after(2, () => { L(d, 'c5_open_2'); d.stinger('dread'); }); d.after(10, () => { this.done = true; }); }
        return this.done;
      },
    },
  ],
};
