import { itemDef, kindRank } from './Items.js';

// What you carry: items by id with their counts, loose rounds by calibre, the weapons you have,
// and the documents you have read (with the chapter you read each one in, for the journal).
//
// An ammunition item (a box of 9x18, a clip pouch) is not kept as an item: adding it pours its
// rounds into the pockets. Every other item is capped at its stack size; add() returns how many
// actually fit, so a pickup can leave the rest where it lies.
//
// Change notifications: `onChange(what)` is the single callback of the contract (what is 'ammo',
// 'weapons', 'items' or 'docs'); listen(fn) adds more listeners without clobbering it, which is
// how the HUD and the journal follow along.

export class Inventory {
  constructor() {
    this.ammo = { '9x18': 0, '7.62x54R': 0, '7.62x39': 0, flare: 0 };
    this.weapons = new Set();
    this.items = new Map();
    this.docs = new Set();
    this.docChapters = new Map();       // doc id -> the chapter it was read in
    this.onChange = null;
    this._listeners = [];
  }

  listen(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter((f) => f !== fn); }; }

  _changed(what) {
    this.onChange?.(what);
    for (const fn of this._listeners) fn(what);
  }

  // returns how many were taken (0 if the pockets are full of it)
  add(id, n = 1) {
    if (n <= 0) return 0;
    const d = itemDef(id);
    if (d.ammo) { this.addAmmo(d.ammo.type, d.ammo.rounds * n); return n; }
    const have = this.items.get(id) || 0;
    const fit = Math.max(0, Math.min(n, (d.stack ?? 99) - have));
    if (!fit) return 0;
    this.items.set(id, have + fit);
    this._changed('items');
    return fit;
  }

  remove(id, n = 1) {
    const have = this.items.get(id) || 0;
    if (have < n) return false;
    if (have === n) this.items.delete(id); else this.items.set(id, have - n);
    this._changed('items');
    return true;
  }

  has(id, n = 1) { return (this.items.get(id) || 0) >= n; }
  count(id) { return this.items.get(id) || 0; }

  // the items in the journal's order: things to use first, story props last
  list() {
    return [...this.items.entries()].sort((a, b) => kindRank(a[0]) - kindRank(b[0]));
  }

  addAmmo(type, n) {
    if (!(n > 0)) return;
    this.ammo[type] = (this.ammo[type] || 0) + Math.round(n);
    this._changed('ammo');
  }

  takeAmmo(type, n) {
    const taken = Math.max(0, Math.min(n, this.ammo[type] || 0));
    if (taken) { this.ammo[type] -= taken; this._changed('ammo'); }
    return taken;
  }

  giveWeapon(id) {
    if (this.weapons.has(id)) return false;
    this.weapons.add(id);
    this._changed('weapons');
    return true;
  }

  hasWeapon(id) { return this.weapons.has(id); }

  // true the first time a document is read
  readDoc(id, chapter = null) {
    if (this.docs.has(id)) return false;
    this.docs.add(id);
    if (chapter != null) this.docChapters.set(id, chapter);
    this._changed('docs');
    return true;
  }

  hasDoc(id) { return this.docs.has(id); }

  clear() {
    for (const k of Object.keys(this.ammo)) this.ammo[k] = 0;
    this.weapons.clear(); this.items.clear(); this.docs.clear(); this.docChapters.clear();
    for (const w of ['ammo', 'weapons', 'items', 'docs']) this._changed(w);
  }

  // for the save (the documents are saved beside it, see Saves.js)
  serialize() {
    return { items: [...this.items.entries()], ammo: { ...this.ammo }, weapons: [...this.weapons] };
  }

  serializeDocs() { return [...this.docs].map((id) => [id, this.docChapters.get(id) ?? null]); }

  restore(data, docs) {
    this.clear();
    if (data) {
      for (const [id, n] of data.items || []) if (n > 0) this.items.set(id, n);
      Object.assign(this.ammo, data.ammo || {});
      for (const w of data.weapons || []) this.weapons.add(w);
    }
    for (const d of docs || []) {
      const [id, ch] = Array.isArray(d) ? d : [d, null];
      this.docs.add(id);
      if (ch != null) this.docChapters.set(id, ch);
    }
    for (const w of ['ammo', 'weapons', 'items', 'docs']) this._changed(w);
  }
}
