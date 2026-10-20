import { Vector3 } from 'three';
import { itemDef, WEAPONS, AMMO, ICONS } from './Items.js';

// Things in the world you can take with E. The integrator places an object and calls
//
//   pickups.add(object3D, { id, item, count, ammo, weapon, doc, hint, onPick, keep, range })
//
// item + count: an item id from Items.js; ammo: loose rounds, { '9x18': 8 } or ['9x18', 8];
// weapon: 'pm' | 'mosin' | 'akm' | 'flaregun'; doc: a document id (taking it opens the journal's
// reader on it); keep: leave the object where it is (a poster on a wall, read again and again).
// Any mix works: a dead soldier's AKM with a magazine is { weapon: 'akm', ammo: { '7.62x39': 30 } }.
//
// Taking it fills the pockets, plays the sound, shows a toast, hides the object and remembers its
// id, so a checkpoint knows what is gone (serialize / restore). Give each pickup a stable `id`;
// without one it is named from the object's name and where it stands. When the pockets cannot
// hold all of it, what doesn't fit stays behind (and that is remembered too).

const _p = new Vector3();
const AMMO_ITEM = { '9x18': 'ammo_9x18', '7.62x54R': 'ammo_762x54', '7.62x39': 'ammo_762x39', flare: 'ammo_flare' };

export class Pickups {
  // ctx: { interactions, inventory, hud, ui, audio, journal, weapons, chapter: () => n }
  constructor(ctx) {
    this.ctx = ctx;
    this.list = new Map();       // id -> pickup
    this.taken = new Set();
    this.left = {};              // id -> what is still lying there, when not all of it fitted
    this.onPick = null;          // (pickup) => {}: every pickup taken (the integrator saves, the story moves on)
  }

  add(object, opts = {}) {
    const p = {
      object, item: null, count: 1, ammo: null, weapon: null, doc: null, keep: false, ...opts,
      id: opts.id || this._autoId(object, opts),
    };
    p.count0 = p.count;
    p.target = this.ctx.interactions?.add(object, { hint: () => this._hint(p), use: () => this.take(p), range: opts.range ?? 2.2 });
    this.list.set(p.id, p);
    if (this.taken.has(p.id) && !p.keep) this._hide(p);
    else if (this.left[p.id]) p.count = this.left[p.id];
    return p;
  }

  remove(object) {
    for (const [id, p] of this.list) if (p.object === object) this.list.delete(id);
    this.ctx.interactions?.remove?.(object);
  }

  get(id) { return this.list.get(id); }

  take(p) {
    if (typeof p === 'string') p = this.list.get(p);
    if (!p || (p.taken && !p.keep)) return false;
    const { inventory, journal } = this.ctx;
    const got = [];
    let left = 0, sound = 'pickup';

    if (p.weapon) {
      inventory.giveWeapon(p.weapon);
      this.ctx.weapons?.give?.(p.weapon);
      const w = WEAPONS[p.weapon];
      got.push({ icon: ICONS[p.weapon], wide: true, ru: w?.name.ru || p.weapon, en: w?.name.en || p.weapon });
    }
    for (const [type, n] of this._ammo(p.ammo)) {
      inventory.addAmmo(type, n);
      got.push({ icon: ICONS[AMMO_ITEM[type]], ru: AMMO[type]?.ru || type, en: AMMO[type]?.en || type, count: n });
      if (!p.weapon) sound = 'pickup_ammo';
    }
    if (p.item) {
      const d = itemDef(p.item);
      const fit = inventory.add(p.item, p.count);
      left = p.count - fit;
      if (fit) {
        const n = d.ammo ? d.ammo.rounds * fit : fit;
        got.push({ icon: d.iconSvg, ru: d.name.ru, en: d.name.en, count: n });
        sound = d.ammo ? 'pickup_ammo' : d.kind === 'key' ? 'pickup_key' : sound;
      }
    }
    if (p.doc) {
      if (journal?.read) journal.read(p.doc);
      else inventory.readDoc(p.doc, this.ctx.chapter?.() ?? null);
      sound = 'paper';
    }

    if (!got.length && !p.doc) {
      this._toast({ ru: 'Карманы полны', en: 'Your pockets are full' });
      return false;
    }
    this.ctx.audio?.horror?.sfx?.(sound, p.object.getWorldPosition(_p), { gain: 0.8 });
    for (const g of got) this._toast(g);

    if (left > 0) {
      p.count = this.left[p.id] = left;
      this._toast({ ru: 'Остальное не влезло', en: 'The rest won\'t fit in your pockets' });
    } else {
      p.taken = true; this.taken.add(p.id); delete this.left[p.id];
      if (!p.keep) this._hide(p);
    }
    p.onPick?.(p);
    this.onPick?.(p);
    return true;
  }

  // ---- saves
  serialize() { return { taken: [...this.taken], left: { ...this.left } }; }

  // back to the state of a save (null: everything back where it was, for a new game)
  restore(data) {
    const taken = Array.isArray(data) ? data : data?.taken || [];
    this.taken = new Set(taken);
    this.left = { ...(data?.left || {}) };
    for (const p of this.list.values()) {
      p.taken = this.taken.has(p.id);
      p.count = this.left[p.id] || p.count0;
      if (p.taken && !p.keep) this._hide(p); else this._show(p);
    }
  }

  reset() { this.restore(null); }

  // ---- inside
  _hide(p) { p.taken = true; p.object.visible = false; if (p.target) p.target.enabled = false; }
  _show(p) { p.object.visible = true; if (p.target) p.target.enabled = true; }

  _ammo(a) {
    if (!a) return [];
    if (Array.isArray(a)) return typeof a[0] === 'string' ? [[a[0], a[1] || 0]] : a;
    return Object.entries(a);
  }

  _hint(p) {
    if (typeof p.hint === 'function') return p.hint(p);
    if (p.hint) return p.hint;
    const tag = (en, ru) => `${en}<span class="ru">${ru}</span>`;
    if (p.doc) {
      const d = this.ctx.journal?.doc?.(p.doc);
      return tag(d ? `Read: ${d.title.en}` : 'Read', d ? d.title.ru : 'Прочитать');
    }
    if (p.weapon) { const w = WEAPONS[p.weapon]; return tag(`Take the ${w?.name.en || p.weapon}`, w?.name.ru || ''); }
    if (p.item) {
      const d = itemDef(p.item);
      return tag(`Take: ${d.name.en}${p.count > 1 && !d.ammo ? ` ×${p.count}` : ''}`, d.name.ru);
    }
    return tag('Take the rounds', 'Патроны');
  }

  _toast(g) {
    const { hud, ui } = this.ctx;
    if (hud?.notify) hud.notify(g);
    else ui?.toast?.(`${g.en}${g.count > 1 ? ` ×${g.count}` : ''}`);
  }

  _autoId(object, opts) {
    object.updateWorldMatrix?.(true, false);
    object.getWorldPosition(_p);
    const r = (v) => Math.round(v * 2) / 2;
    const base = `${object.name || opts.item || opts.weapon || opts.doc || 'pickup'}@${r(_p.x)},${r(_p.y)},${r(_p.z)}`;
    let id = base, i = 2;
    while (this.list.has(id)) id = `${base}#${i++}`;
    return id;
  }
}
