import { asset } from '../core/Assets.js';

// The recorded lines (tools/elevenlabs/generate.mjs writes them to public/audio/vo/). The index is
// read at start (a few KB); a recording is fetched only when it's about to be wanted (you look at
// someone, a story beat comes up), decoded once there is sound, and kept. A recording belongs to a
// line by its speaker and its Russian text, so a line changed in Lines.js and not recorded again
// simply has none (and is spoken the old way).
//
//   find(who, ru)                       the line's recording (index entry), or null
//   prefetch(who, ru)                   fetch (and decode) it ahead of time
//   say(who, ru, start, fallback)       start(AudioBuffer) when it's ready, or fallback() if it
//                                       can't be had in time; false when there's no recording

const WAIT = 1500;          // ms a line waits for its recording before the fallback speaks it

export class Voices {
  constructor(audio) {
    this.audio = audio;
    this.byLine = new Map();          // who + '\n' + ru -> { file, ... }
    this.byRu = new Map();            // ru -> a recording of those words (when the speaker doesn't match)
    this.raw = new Map();             // file -> Promise<ArrayBuffer | null>
    this.clips = new Map();           // file -> Promise<AudioBuffer | null>
    this.loaded = false;              // (the index is in)
    this.ready = fetch(asset('audio/vo/index.json'))
      .then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : {}))
      .then((idx) => {
        for (const e of Object.values(idx || {})) {
          if (!e || !e.file || !e.who || !e.ru) continue;
          this.byLine.set(e.who + '\n' + e.ru, e);
          if (!this.byRu.has(e.ru)) this.byRu.set(e.ru, e);
        }
      })
      .catch(() => { /* no recordings: every line is spoken the old way */ })
      .then(() => { this.loaded = true; for (const [who, ru] of this.later.values()) this.prefetch(who, ru); this.later.clear(); });
    this.later = new Map();           // prefetches asked for before the index was in
  }

  get count() { return this.byLine.size; }

  find(who, ru) { return this.byLine.get(who + '\n' + ru) || this.byRu.get(ru) || null; }

  prefetch(who, ru) {
    if (!this.loaded) { this.later.set(who + '\n' + ru, [who, ru]); return; }
    const e = this.find(who, ru);
    if (e) this._load(e);
  }

  say(who, ru, start, fallback) {
    const e = this.find(who, ru);
    if (!e || !this.audio.ctx) return false;
    let late = false;
    const timer = setTimeout(() => { late = true; fallback(); }, WAIT);
    this._load(e).then((buf) => {
      clearTimeout(timer);
      if (late) return;
      if (buf) start(buf); else fallback();
    });
    return true;
  }

  _fetch(e) {
    let p = this.raw.get(e.file);
    if (!p) {
      p = fetch(asset('audio/vo/' + e.file)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      this.raw.set(e.file, p);
    }
    return p;
  }

  // (before the first click there's no AudioContext to decode with: only the fetch happens)
  _load(e) {
    const ctx = this.audio.ctx;
    if (!ctx) return this._fetch(e).then(() => null);
    let p = this.clips.get(e.file);
    if (!p) {
      p = this._fetch(e).then((ab) => (ab ? ctx.decodeAudioData(ab) : null)).catch((err) => { console.warn('[voices]', e.file, err); return null; });
      this.clips.set(e.file, p);
      p.then((buf) => { if (buf) this.raw.delete(e.file); });
    }
    return p;
  }
}
