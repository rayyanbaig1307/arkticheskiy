// Checkpoints in localStorage, under 'arkticheskiy.save.v1'. One slot: the last checkpoint.
//
//   { version, chapter, checkpoint, flags, inventory, stats, pickups, docs, journal, time, savedAt }
//
// snapshot() builds that from the live systems and apply() puts it back into them; save(),
// load(), has() and clear() only move it in and out of storage. Storage can be full, blocked
// (private windows, a locked-down browser) or hold something broken: every access is guarded,
// and a copy is kept in memory so Retry still works for the rest of the visit even when nothing
// could be written.

export const SAVE_KEY = 'arkticheskiy.save.v1';
export const SAVE_VERSION = 1;

export class Saves {
  constructor(key = SAVE_KEY) {
    this.key = key;
    this.memory = null;          // the last save, as JSON text
    this.lastError = null;
  }

  save(state) {
    const data = { ...state, version: SAVE_VERSION, savedAt: Date.now() };
    let text;
    try { text = JSON.stringify(data); } catch (e) { this.lastError = e; return false; }
    this.memory = text;
    try { localStorage.setItem(this.key, text); this.lastError = null; return true; } catch (e) { this.lastError = e; return false; }
  }

  load() {
    let text = null;
    try { text = localStorage.getItem(this.key); } catch { /* blocked: the memory copy */ }
    text = text || this.memory;
    if (!text) return null;
    try {
      const s = JSON.parse(text);
      if (!s || typeof s !== 'object' || s.version !== SAVE_VERSION) return null;
      return s;
    } catch { return null; }
  }

  has() { return !!this.load(); }

  // what the title screen shows about the save, without the rest of it
  peek() {
    const s = this.load();
    return s ? { chapter: s.chapter, checkpoint: s.checkpoint, time: s.time, savedAt: s.savedAt } : null;
  }

  clear() {
    this.memory = null;
    try { localStorage.removeItem(this.key); } catch { /* nothing to do */ }
  }

  // the state of the game, from its parts (any of them may be missing)
  snapshot({ chapter = 1, checkpoint = null, flags = {}, inventory, stats, pickups, journal, time = 0 } = {}) {
    return {
      chapter, checkpoint,
      flags: flags instanceof Map ? Object.fromEntries(flags) : { ...flags },
      inventory: inventory?.serialize?.() ?? null,
      docs: inventory?.serializeDocs?.() ?? [],
      stats: stats?.serialize?.() ?? null,
      pickups: pickups?.serialize?.() ?? { taken: [] },
      journal: journal?.serialize?.() ?? null,       // the objective and the ones done
      time,
    };
  }

  // put a loaded state back into the live systems; the caller moves the player and the story
  apply(state, { inventory, stats, pickups, journal } = {}) {
    if (!state) return false;
    inventory?.restore?.(state.inventory, state.docs);
    stats?.restore?.(state.stats);
    pickups?.restore?.(state.pickups);
    journal?.restore?.(state.journal);
    return true;
  }
}

export const saves = new Saves();
