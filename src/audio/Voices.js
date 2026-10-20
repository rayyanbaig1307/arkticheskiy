import { asset } from '../core/Assets.js';

// The recorded lines (tools/elevenlabs/generate.mjs writes them to public/audio/vo/, and the English
// ones, --lang en, to public/audio/vo_en/). An index is read when its language is first wanted (a
// few KB); a recording is fetched only when it's about to be wanted (you look at someone, a story
// beat comes up), decoded once there is sound, and kept. A recording belongs to a line by its
// speaker and its Russian text (the English index keeps the Russian it was made from too), so a
// line changed in Lines.js and not recorded again simply has none (and is spoken the old way).
//
//   setLang('ru' | 'en')                which voices: English falls back to the Russian recording
//                                       of a line not yet recorded in English
//   find(who, ru)                       the line's recording (index entry), or null
//   prefetch(who, ru)                   fetch (and decode) it ahead of time
//   say(who, ru, start, fallback)       start(AudioBuffer) when it's ready, or fallback() if it
//                                       can't be had in time; false when there's no recording

const WAIT = 1500;          // ms a line waits for its recording before the fallback speaks it
const DIRS = { ru: 'vo', en: 'vo_en' };

export class Voices {
  constructor(audio) {
    this.audio = audio;
    this.lang = 'ru';
    this.sets = { ru: this._set('ru') };
    this.raw = new Map();             // path -> Promise<ArrayBuffer | null>
    this.clips = new Map();           // path -> Promise<AudioBuffer | null>
    this.later = new Map();           // prefetches asked for before an index was in
  }

  // one language's recordings: who + '\n' + ru -> entry, and ru -> entry (when the speaker doesn't
  // match: a line heard over the radio, a voice borrowed)
  _set(lang) {
    const set = { dir: DIRS[lang], byLine: new Map(), byRu: new Map(), loaded: false };
    set.ready = fetch(asset(`audio/${set.dir}/index.json`))
      .then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : {}))
      .then((idx) => {
        for (const e of Object.values(idx || {})) {
          if (!e || !e.file || !e.who || !e.ru) continue;
          const entry = { ...e, path: `${set.dir}/${e.file}` };
          set.byLine.set(e.who + '\n' + e.ru, entry);
          if (!set.byRu.has(e.ru)) set.byRu.set(e.ru, entry);
        }
      })
      .catch(() => { /* no recordings: every line is spoken the old way */ })
      .then(() => { set.loaded = true; this._flush(); });
    return set;
  }

  get ready() { return Promise.all(Object.values(this.sets).map((s) => s.ready)); }
  get count() { return this.sets.ru.byLine.size; }
  get loaded() { return Object.values(this.sets).every((s) => s.loaded); }

  setLang(lang) {
    this.lang = lang === 'en' ? 'en' : 'ru';
    if (!this.sets[this.lang]) this.sets[this.lang] = this._set(this.lang);
  }

  find(who, ru) {
    const look = (s) => (s ? s.byLine.get(who + '\n' + ru) || s.byRu.get(ru) || null : null);
    return (this.lang !== 'ru' && look(this.sets[this.lang])) || look(this.sets.ru);
  }

  prefetch(who, ru) {
    if (!this.loaded) { this.later.set(who + '\n' + ru, [who, ru]); return; }
    const e = this.find(who, ru);
    if (e) this._load(e);
  }
  _flush() {
    if (!this.loaded) return;
    for (const [who, ru] of this.later.values()) this.prefetch(who, ru);
    this.later.clear();
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
    let p = this.raw.get(e.path);
    if (!p) {
      p = fetch(asset('audio/' + e.path)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      this.raw.set(e.path, p);
    }
    return p;
  }

  // (before the first click there's no AudioContext to decode with: only the fetch happens)
  _load(e) {
    const ctx = this.audio.ctx;
    if (!ctx) return this._fetch(e).then(() => null);
    let p = this.clips.get(e.path);
    if (!p) {
      p = this._fetch(e).then((ab) => (ab ? ctx.decodeAudioData(ab) : null)).catch((err) => { console.warn('[voices]', e.path, err); return null; });
      this.clips.set(e.path, p);
      p.then((buf) => { if (buf) this.raw.delete(e.path); });
    }
    return p;
  }
}
