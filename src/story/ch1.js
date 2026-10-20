import * as THREE from 'three';
import { propFor } from '../levels/Props.js';
import { puppet } from './Puppets.js';

// Chapter 1, Молчание (Silence): aboard the Polyarnik, at sea, bound for Severny through the ice.
//
//   brief    up to the bridge: the captain's briefing (the telex, the roster on the chart table)
//   orlov    Sergeant Orlov at the bow hands you a Makarov "for the bears"
//   sail     the watch: she runs for the station on the mate's autopilot (take the wheel if you
//            like); the radar dies
//   fuse     down to the engine room: the lights go out on the stair (the flashlight, F); the
//            engineer, the fuse box; the knocking on the hull from outside, under the water
//   radio    the mess radio picks up Severny: a woman counting, then your name
//   ice      a polar bear torn open on a floe; a figure on the ice in the searchlight, twice
//   approach the dark station: bring her alongside (or the captain takes her in)
//   moored   alongside: Orlov's orders; ashore next

const _v = new THREE.Vector3();
const L = (d, id) => d.say(id);

// a document lying aboard (boat space), on whatever surface is under it
function docAboard(d, id, local) {
  const { model, boat } = d.ctx;
  const p = local.clone();
  const top = model.collision.floorAt(p.x, p.y + 1.25, p.z, 1.3);
  p.y = top != null ? top + 0.004 : p.y + 0.01;
  const prop = propFor('doc'); prop.position.copy(p);
  boat.root.add(prop);
  d.h.pickups.add(prop, { id: 'boat:doc:' + id, doc: id });
  return prop;
}

export const CH1 = {
  setup(d) {
    const { station, boat, sky } = d.ctx;
    d.sky('dread'); sky.setTime('dread', true);
    d.ambience('sea');
    station.dark = true;
    boat.setEngine(true); if (!boat.moored && !boat.docking) boat.setOrder(2);
    d.ctx.radar && (d.ctx.radar.dead = false);
    d.ctx.lights?.setGroup?.('rooms', true); d.ctx.lights?.setGroup?.('engine', true); d.ctx.lights?.setGroup?.('deck', true);
    if (!d.flag('c1_docs')) {
      d.set('c1_docs');
      const sp = d.ctx.model.spots;
      const at = (name, dx, dz) => sp[name] ? sp[name].pos.clone().add(new THREE.Vector3(dx, 0, dz)) : null;
      const docs = [['ch1_telex', at('radar', 0.6, 0.4)], ['ch1_roster', at('radar', 0.9, 0.2)], ['ch1_captain_log', at('captain', -1.2, 1.2)],
        ['ch1_orlov_orders', at('guard_aft', 0.0, -2.0)], ['ch1_engine_note', at('engineer', 0.5, 0.3)], ['ch1_lyosha_letter', at('cook2', 1.0, 1.0)]];
      for (const [id, p] of docs) if (p) docAboard(d, id, p);
    }
  },
  restore(d, id) {
    const order = CH1.steps.map((s) => s.id);
    const k = order.indexOf(id);
    if (k > order.indexOf('orlov')) { d.h.weapons.give?.('pm'); }
    const sp = d.ctx.model.spots;
    const s = k <= order.indexOf('brief') ? sp.spawn : k <= order.indexOf('orlov') ? sp.captain : sp.wheel;
    if (s) d.ctx.player.spawn({ pos: s.pos.clone().add(new THREE.Vector3(0.6, 0, 0.6)), yaw: s.yaw });
  },
  pilotTarget(d) {
    const st = d.ctx.station;
    if (!st.ready || d.ctx.boat.moored || d.ctx.boat.docking) return null;
    const b = st.berth;
    return new THREE.Vector3(b.pos.x + 60, 0, b.pos.z + 380);
  },
  always(d, dt) {
    for (const p of d.puppets || []) p.update(dt);
  },
  steps: [
    {
      id: 'brief',
      objective: ['Поднимитесь на мостик', 'Go up to the bridge', '', 'The captain wants you on the bridge: up the stairs from the main deck hall, then up again.'],
      marker: (d) => { const p = d.person('captain'); return p ? p.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2.0, 0)) : null; },
      enter(d) { d.after(4, () => L(d, 'c1_dikson_1')); d.after(14, () => d.ctx.ui.toast('W A S D — идти · Shift — бег · E — действие · Tab — журнал', 6)); },
      update(d) {
        if (!this.go && d.nearPerson('captain', 4.5) && d.inZone('bridge')) {
          this.go = true;
          d.marker(null);
          d.lines(['c1_brief_1', 'c1_brief_2', 'c1_brief_3', 'c1_brief_4', 'c1_brief_5', 'c1_brief_6'], () => { this.done = true; });
        }
        return this.done;
      },
    },
    {
      id: 'orlov', checkpoint: true,
      objective: ['Найдите сержанта Орлова', 'Find Sergeant Orlov', '', 'Orlov keeps watch at the bow.'],
      marker: (d) => { const p = d.person('soldier1'); return p ? p.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2.0, 0)) : null; },
      update(d) {
        if (!this.go && d.nearPerson('soldier1', 3.5)) {
          this.go = true; d.marker(null);
          d.lines(['c1_pm_1', 'c1_pm_2'], () => {
            d.h.weapons.give?.('pm', { select: true });
            d.h.inventory.addAmmo?.('9x18', 16);
            d.h.hud.pickup?.('ammo_9x18', 1);
            d.ctx.ui.toast('1 — пистолет · ЛКМ — огонь · ПКМ — прицел · R — перезарядка', 6);
            d.lines(['c1_pm_3', 'c1_pm_4'], () => { this.done = true; }, { delay: 1.0 });
          });
        }
        return this.done;
      },
    },
    {
      id: 'sail', checkpoint: true,
      objective: ['Вахта: курс на «Северный»', 'Your watch: the course for Severny', '', 'Hold the course (the wheel on the bridge), or let the mate\'s autopilot steer. Watch the ice.'],
      enter(d) { this.t0 = d.t; },
      update(d) {
        const toSt = d.ctx.station.ready ? d.ctx.station.berth.pos.distanceTo(_v.set(d.ctx.boat.x, 0, d.ctx.boat.z)) : 9999;
        // the radar dies after a while, or as she gets closer
        return d.t - this.t0 > 70 || toSt < 1900;
      },
    },
    {
      id: 'radar',
      objective: ['Радар погас: спуститесь в машинное', 'The radar is dead: go down to the engine room', '', 'The engineer is at the engine control console. The stair is aft of the main deck hall.'],
      marker: (d) => d.spot('engineer')?.add(new THREE.Vector3(0, 1.6, 0)),
      enter(d) {
        d.ctx.radar && (d.ctx.radar.dead = true);
        d.sfx('light_pop', d.spot('radar'));
        d.after(0.8, () => L(d, 'c1_radar_1'));
      },
      update(d) {
        // the lights go on the way down
        if (!this.out && (d.inZone('engine_stair') || d.inZone('engine'))) {
          this.out = true;
          for (const g of ['rooms', 'engine', 'deck']) d.ctx.lights?.setGroup?.(g, false);
          d.sfx('light_pop', null); d.stinger('jump_soft');
          d.after(0.6, () => L(d, 'c1_radar_4'));
          d.after(2.5, () => { if (!d.h.flashlight.on) d.ctx.ui.toast('F — фонарь · the flashlight', 5); });
        }
        if (this.out && d.nearPerson('engineer', 4)) return true;
        return false;
      },
    },
    {
      id: 'fuse',
      objective: ['Замените предохранитель', 'Replace the fuse', '', 'The spare fuses are in the box on the switchboard, top row.'],
      enter(d) {
        d.lines(['c1_radar_2', 'c1_radar_3']);
        const sw = d.ctx.model.nodes.INT_switch_engine;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
        if (sw) { sw.getWorldPosition(_v); d.ctx.boat.root.add(box); box.position.copy(d.ctx.boat.toLocal(_v, new THREE.Vector3())).add(new THREE.Vector3(0, 0.25, 0)); }
        else { d.ctx.boat.root.add(box); box.position.copy(d.ctx.model.spots.engineer.pos).add(new THREE.Vector3(0.8, 1.3, 0)); }
        this.box = box;
        this.target = d.ctx.interactions.add(box, { hint: () => 'Заменить предохранитель / Replace the fuse', use: () => { this.fixed = true; }, range: 2.4 });
        d.marker(() => box.getWorldPosition(new THREE.Vector3()));
      },
      update(d) {
        if (this.fixed && !this.done) {
          this.done = true;
          d.ctx.interactions.remove(this.box);
          d.sfx('lights_on', null);
          for (const g of ['rooms', 'engine', 'deck']) d.ctx.lights?.setGroup?.(g, true);
          d.ctx.radar && (d.ctx.radar.dead = false);
          d.marker(null);
          // and then the knocking
          const hull = d.ctx.boat.toWorld(new THREE.Vector3(1.2, -1.2, 4), new THREE.Vector3());
          d.after(4, () => { for (let k = 0; k < 3; k++) d.after(k * 0.55, () => d.sfx('knock_hull', hull, { gain: 1.2 })); });
          d.after(5.6, () => L(d, 'c1_knock_1'));
          d.after(9.5, () => { for (let k = 0; k < 3; k++) d.after(k * 0.55, () => d.sfx('knock_hull', hull, { gain: 1.4 })); d.h.stats.scare?.(0.3); });
          d.after(11, () => L(d, 'c1_knock_2'));
          d.after(16, () => L(d, 'c1_knock_3'));
          d.after(20, () => { this.over = true; });
        }
        return this.over;
      },
    },
    {
      id: 'radio', checkpoint: true,
      objective: ['Кают-компания: кок зовёт', 'The mess: the cook is calling', '', 'Up from the engine room to the mess, on the main deck.'],
      marker: (d) => d.spot('cook')?.add(new THREE.Vector3(0, 1.6, 0)),
      enter(d) { d.after(1.5, () => L(d, 'c1_radio_1')); },
      update(d) {
        if (!this.go && d.inZone('mess')) {
          this.go = true; d.marker(null);
          const node = d.ctx.model.nodes.INT_radio_mess;
          d.ctx.audio?.radio?.('mess', true, node);
          if (node) d.ctx.audio?.horror?.loop?.('radio_static', node, true);
          d.stinger('dread');
          d.lines(['c1_radio_2', 'c1_radio_3', 'c1_radio_4', 'c1_radio_5', 'c1_radio_6', 'c1_radio_7', 'c1_radio_8'], () => {
            d.ctx.audio?.radio?.('mess', false, node);
            if (node) d.ctx.audio?.horror?.loop?.('radio_static', node, false);
            this.done = true;
          }, { gap: 0.8 });
          d.after(14, () => d.h.stats.scare?.(0.45));
        }
        return this.done;
      },
    },
    {
      id: 'ice',
      objective: ['Вахта: смотрите на лёд', 'Your watch: keep an eye on the ice', '', 'On deck or on the bridge. She is nearly there.'],
      enter(d) {
        this.t0 = d.t;
        // the torn bear on a floe ahead, to starboard
        const b = d.ctx.boat;
        const ahead = new THREE.Vector3(b.x, 0, b.z).add(b.forward.multiplyScalar(120)).add(new THREE.Vector3(Math.cos(b.heading) * 28, 0, -Math.sin(b.heading) * 28));
        this.bear = puppet(d, 'bear', ahead.setY(0.42), b.heading + 1.2, 'death', { at: 2.4 });
        if (this.bear) {
          const blood = new THREE.Mesh(new THREE.CircleGeometry(2.4, 18), new THREE.MeshStandardMaterial({ color: 0x2a0303, roughness: 0.35 }));
          blood.rotation.x = -Math.PI / 2; blood.position.copy(ahead).setY(0.43);
          d.ctx.scene.add(blood); this.blood = blood;
        }
        this.phase = 0;
      },
      update(d) {
        const b = d.ctx.boat, eye = d.eye();
        if (this.phase === 0 && this.bear && eye.distanceTo(this.bear.root.position) < 100) {
          this.phase = 1; d.lines(['c1_bear_1', 'c1_bear_2', 'c1_bear_3']); this.t1 = d.t;
          // the mate puts the searchlight on it
          const S = d.ctx.stations; S.slOn = true; S.slAim = this.bear.root.position.clone(); S.slAimRate = 1.2;
        }
        if (this.phase === 1 && d.t - this.t1 > 16) {
          // the figure on the ice, in the searchlight, ahead
          this.phase = 2;
          const p = new THREE.Vector3(b.x, 0, b.z).add(b.forward.multiplyScalar(80)).add(new THREE.Vector3(Math.cos(b.heading) * 12, 0, -Math.sin(b.heading) * 12));
          this.fig = puppet(d, 'turned_c', p.setY(0.4), b.heading + Math.PI, 't_idle', { loop: true, still: true });
          d.ctx.stations.slAim = p.clone().setY(1.2); d.ctx.stations.slAimRate = 3.5;
          L(d, 'c1_figure_1'); d.stinger('reveal'); this.t2 = d.t;
        }
        if (this.phase === 2 && d.t - this.t2 > 3.5) { this.phase = 3; this.fig?.remove(); L(d, 'c1_figure_2'); this.t3 = d.t; }
        if (this.phase === 3 && d.t - this.t3 > 7) {
          this.phase = 4;
          const p = new THREE.Vector3(b.x, 0, b.z).add(b.forward.multiplyScalar(40)).add(new THREE.Vector3(-Math.cos(b.heading) * 9, 0, Math.sin(b.heading) * 9));
          this.fig = puppet(d, 'turned_c', p.setY(0.4), b.heading + Math.PI, 't_idle', { loop: true, still: true });
          d.ctx.stations.slAim = p.clone().setY(1.2); d.ctx.stations.slAimRate = 5;
          L(d, 'c1_figure_3'); d.after(3.2, () => { L(d, 'c1_figure_4'); d.stinger('jump_soft'); }); this.t4 = d.t;
        }
        if (this.phase === 4 && d.t - this.t4 > 4.2) { this.phase = 5; this.fig?.remove(); this.t5 = d.t; d.ctx.stations.slAim = null; }
        const toSt = d.ctx.station.berth.pos.distanceTo(_v.set(b.x, 0, b.z));
        return (this.phase === 5 && d.t - this.t5 > 6) || toSt < 700;
      },
    },
    {
      id: 'approach', checkpoint: true,
      objective: ['Подведите буксир к причалу', 'Bring her alongside', '', 'Slow ahead to the berth, bow to the west, starboard side to the ice. Or leave it to the captain.'],
      marker: (d) => d.ctx.station.ready ? d.ctx.station.berth.pos.clone().setY(3) : null,
      enter(d) { d.ctx.stations.slAim = null; d.lines(['c1_approach_1', 'c1_approach_2', 'c1_approach_3'], null, { delay: 2 }); this.t0 = d.t; },
      update(d) {
        const b = d.ctx.boat, berth = d.ctx.station.berth;
        const dist = berth.pos.distanceTo(_v.set(b.x, 0, b.z));
        // (not at the wheel, or too long about it: the captain brings her in)
        if (!b.docking && !b.moored && dist < 460 && d.ctx.stations.at !== 'wheel' && d.t - this.t0 > 22) d.ctx.voyage.bringIn();
        if (!b.docking && !b.moored && dist < 460 && d.t - this.t0 > 90) d.ctx.voyage.bringIn();
        return b.moored;
      },
    },
    {
      id: 'moored', checkpoint: true,
      objective: ['Пришвартовались', 'Alongside', '', 'Orlov is getting his men ready.'],
      enter(d) { d.lines(['c1_moored_1', 'c1_moored_2', 'c1_moored_3'], () => { this.done = true; }, { delay: 1.5 }); },
      update() { return this.done; },
    },
  ],
};
