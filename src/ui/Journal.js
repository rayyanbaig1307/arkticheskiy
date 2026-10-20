import { itemDef, canUse, useItem, WEAPONS, AMMO, ICONS } from '../survival/Items.js';
import { CHAPTERS } from './HorrorHUD.js';

// The journal (Tab): a full-screen overlay with three pages.
//
// - Items: what you carry, as a grid of icons (weapons and loose rounds first), with the chosen
//   one described on the right; medkits, bandages, batteries, tea and vodka can be used from here.
// - Documents: everything read so far, by chapter. The reader shows the Russian text, with a
//   toggle (or T) to the English translation, laid out as what it is: a lined journal page,
//   a torn note, a telex strip, a typed report, a tape transcript, a poster, a photograph.
// - Objective: the chapter, what to do now, and what has been done.
//
// The documents come from src/story/Documents.js (DOCUMENTS) when it exists; until then a
// stand-in pair keeps the reader testable. The game is paused while the journal is open: the
// journal says so through onToggle(open) and the integrator stops play and handles the pointer
// lock. Tab opens it only while in play (the pointer is locked), unless canOpen is replaced.

// (an optional import: the glob is empty while the file doesn't exist, and Vite fills it in once it does)
const found = import.meta.glob('../story/Documents.js', { eager: true });
const STORY_DOCS = Object.values(found)[0]?.DOCUMENTS || null;

const STAND_IN = {
  standin_journal: {
    kind: 'journal', date: '14.01', place: 'Ст. Северный', author: 'Громов', chapter: 2,
    title: { ru: 'Журнал начальника станции', en: 'The station chief\'s journal' },
    body: {
      ru: 'Керн с глубины 212 метров. Во льду тёмная прожилка, будто вмёрзшая нефть.\n\nЛебедев говорит, что образец тёплый. Лёд не бывает тёплым.',
      en: 'A core from 212 metres. A dark vein in the ice, like frozen oil.\n\nLebedev says the sample is warm. Ice is never warm.',
    },
  },
  standin_telex: {
    kind: 'telex', date: '05.01', place: 'Москва', author: 'Министерство', chapter: 1,
    title: { ru: 'Телеграмма на «Полярник»', en: 'A telex to the Polyarnik' },
    body: {
      ru: 'ПОЛЯРНИК КАПИТАНУ ТЧК СТАНЦИЯ СЕВЕРНЫЙ НА СВЯЗЬ НЕ ВЫХОДИТ ТЧК ПРИНЯТЬ НА БОРТ ГРУППУ ОРЛОВА ТЧК НА БЕРЕГ БЕЗ НЕЁ НЕ СХОДИТЬ ТЧК',
      en: 'TO THE MASTER OF THE POLYARNIK STOP STATION SEVERNY SILENT STOP TAKE ORLOV\'S DETACHMENT ON BOARD STOP NOBODY ASHORE WITHOUT THEM STOP',
    },
  },
};

const TABS = ['items', 'docs', 'objective'];
const LANG_KEY = 'arkticheskiy.journal.lang';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// plain text to paragraphs: blank lines split them, single newlines stay as line breaks
const paras = (text) => (Array.isArray(text) ? text : String(text || '').split(/\n\s*\n/))
  .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const docIcon = (kind) => ICONS[`doc_${kind}`] || (kind === 'tape' ? ICONS.tape : kind === 'photo' ? ICONS.photo : ICONS.doc_note);

export class Journal {
  // { inventory, stats, hud, audio, ui, documents }
  constructor({ inventory, stats, hud, audio, ui, documents } = {}) {
    this.inventory = inventory; this.stats = stats; this.hud = hud; this.audio = audio; this.ui = ui;
    this.docs = documents || STORY_DOCS || STAND_IN;
    this.usingStandIn = !documents && !STORY_DOCS;
    this.onToggle = null;           // (open, why) => {}: the integrator pauses play and handles the pointer
    this.canOpen = () => !!document.pointerLockElement;
    this.enabled = true;            // false in cutscenes, at the wheel, when dead
    this.chapter = 1;
    this.objective = null;          // { title, text, ru }
    this.done = [];                 // earlier objectives, newest first
    this.tab = 'items';
    this.item = null; this.docId = null;
    this.unread = new Set();
    try { this.en = localStorage.getItem(LANG_KEY) === 'en'; } catch { this.en = false; }
    this._open = false;
    this._build();
    ui?.addOverlay?.(() => this._open);
    inventory?.listen?.(() => { if (this._open) this.render(); });
    addEventListener('keydown', (e) => this._key(e), true);
  }

  // ---------------------------------------------------------------- public
  isOpen() { return this._open; }

  open(tab = this.tab) {
    if (TABS.includes(tab)) this.tab = tab;
    if (!this._open) {
      this._open = true;
      this.el.classList.remove('hidden');
      this.audio?.horror?.sfx?.('paper', null, { gain: 0.5 });
      this._toggled(true);
    }
    this.render();
  }

  // why: 'menu' when Esc closed it. Esc doesn't count as a user gesture, so the pointer can't be
  // locked again from it: the pause menu comes up instead and its Resume takes the pointer.
  close(why = null) {
    if (!this._open) return;
    this._open = false;
    this.el.classList.add('hidden');
    document.activeElement?.blur?.();
    this._toggled(false, why);
    if (why === 'menu') this.ui?.setPlaying?.(false);
  }

  toggle(tab) { if (this._open) this.close(); else this.open(tab); }

  // a document picked up: it goes in the journal and (by default) the reader opens on it
  read(id, { open = true } = {}) {
    const first = this.inventory ? this.inventory.readDoc(id, this.doc(id)?.chapter ?? this.chapter) : true;
    if (!this.docs[id]) console.warn('[journal] no document', id);
    this.docId = id;
    if (open) this.open('docs'); else if (first) { this.unread.add(id); this._badge(); }
    return first;
  }

  doc(id) { return this.docs[id] || null; }

  setDocuments(map) { this.docs = map || {}; this.usingStandIn = false; if (this._open) this.render(); }

  setChapter(n) { this.chapter = n; if (this._open) this.render(); }

  // the story's current objective (title and text in English; ru optional)
  setObjective(title, text, ru) {
    if (this.objective && this.objective.title && this.objective.title !== title) this.done.unshift(this.objective);
    this.done.length = Math.min(this.done.length, 12);
    this.objective = title ? { title, text: text || '', ru: ru || null, chapter: this.chapter } : null;
    if (this._open && this.tab === 'objective') this.render();
  }

  // for saves
  serialize() { return { objective: this.objective, done: this.done.slice(0, 12), chapter: this.chapter }; }
  restore(s) { this.objective = s?.objective || null; this.done = s?.done || []; this.chapter = s?.chapter ?? this.chapter; this.unread.clear(); this._badge(); }

  // ---------------------------------------------------------------- building
  _build() {
    const tab = (id, ru, en) => `<button class="jr-tab" data-tab="${id}"><b>${ru}</b><span>${en}</span><i class="dot"></i></button>`;
    this.el = document.createElement('div');
    this.el.id = 'journal';
    this.el.className = 'hidden';
    this.el.innerHTML = `<div class="jr-frame">
      <header class="jr-head">
        <div class="jr-brand"><b>Журнал</b><span>Journal</span></div>
        <nav class="jr-tabs">${tab('items', 'Вещи', 'Items')}${tab('docs', 'Документы', 'Documents')}${tab('objective', 'Задача', 'Objective')}</nav>
        <button class="jr-x" title="Close (Tab)">✕</button>
      </header>
      <section class="jr-page" data-page="items"><div class="jr-left"><div class="jr-vitals"></div><div class="jr-grid"></div></div><aside class="jr-detail"></aside></section>
      <section class="jr-page" data-page="docs"><div class="jr-list"></div><div class="jr-reader"></div></section>
      <section class="jr-page" data-page="objective"><div class="jr-obj"></div></section>
      <footer class="jr-foot"><span><b>1 2 3</b> pages</span><span><b>T</b> translation</span><span><b>Tab</b> / <b>Esc</b> close</span></footer>
    </div>`;
    document.body.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.parts = { vitals: q('.jr-vitals'), grid: q('.jr-grid'), detail: q('.jr-detail'), list: q('.jr-list'), reader: q('.jr-reader'), obj: q('.jr-obj') };
    this.el.querySelectorAll('.jr-tab').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.render(); }));
    q('.jr-x').addEventListener('click', () => this.close());
    // (clicks inside the pages: delegated, since the pages are redrawn)
    this.el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-item],[data-doc],[data-use],[data-lang]');
      if (!c) return;
      if (c.dataset.item) { this.item = c.dataset.item; this.render(); }
      else if (c.dataset.doc) { this.docId = c.dataset.doc; this.unread.delete(this.docId); this._badge(); this.render(); this.parts.reader.scrollTop = 0; }
      else if (c.dataset.use) this._use(c.dataset.use);
      else if (c.dataset.lang) this._lang(c.dataset.lang === 'en');
    });
  }

  _key(e) {
    if (e.repeat) return;
    if (e.code === 'Tab') {
      if (this._open) { e.preventDefault(); this.close(); }
      else if (this.enabled && this.canOpen()) { e.preventDefault(); this.open(); }
      return;
    }
    if (!this._open) return;
    if (e.code === 'Escape') { e.preventDefault(); this.close('menu'); }
    else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') { this.tab = TABS[+e.code.slice(5) - 1]; this.render(); }
    else if (e.code === 'KeyT') this._lang(!this.en);
  }

  _toggled(open, why) {
    if (this.onToggle) { this.onToggle(open, why); return; }
    // (nobody wired it yet: give the mouse back and take it again, so the journal still works)
    try {
      if (open && document.pointerLockElement) document.exitPointerLock();
      else if (!open && why !== 'menu') document.getElementById('game')?.requestPointerLock?.();
    } catch { /* the browser refused; the pause menu takes over */ }
  }

  _lang(en) {
    this.en = en;
    try { localStorage.setItem(LANG_KEY, en ? 'en' : 'ru'); } catch { /* not remembered */ }
    if (this.tab === 'docs') this._renderReader();
  }

  _use(id) {
    if (useItem(id, { inventory: this.inventory, stats: this.stats, hud: this.hud, audio: this.audio })) this.render();
  }

  _badge() { this.el.querySelector('[data-tab="docs"]').classList.toggle('new', this.unread.size > 0); }

  // ---------------------------------------------------------------- drawing
  render() {
    this.el.querySelectorAll('.jr-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.el.querySelectorAll('.jr-page').forEach((p) => p.classList.toggle('on', p.dataset.page === this.tab));
    if (this.tab === 'items') this._renderItems();
    else if (this.tab === 'docs') this._renderDocs();
    else this._renderObjective();
  }

  _renderItems() {
    const inv = this.inventory, s = this.stats, P = this.parts;
    if (s) {
      const v = (ru, en, val, unit = '') => `<div class="v"><b>${ru}</b><span>${en}</span><i style="--v:${Math.max(0, Math.min(1, val / 100)).toFixed(3)}"></i><em>${Math.round(val)}${unit}</em></div>`;
      P.vitals.innerHTML = v('Здоровье', 'health', s.health) + v('Тепло', 'warmth', s.warmth) + v('Фонарь', 'battery', s.battery, '%');
    }
    const cells = [];
    const cell = (key, icon, label, count, wide) =>
      `<button class="jr-cell${wide ? ' wide' : ''}${this.item === key ? ' sel' : ''}" data-item="${esc(key)}">${icon}${count != null ? `<em>${count}</em>` : ''}<span>${esc(label)}</span></button>`;
    if (inv) {
      for (const w of Object.keys(WEAPONS)) if (inv.hasWeapon(w)) cells.push(cell(`w:${w}`, ICONS[w], WEAPONS[w].name.ru, null, true));
      const ammoIcon = { '9x18': 'ammo_9x18', '7.62x54R': 'ammo_762x54', '7.62x39': 'ammo_762x39', flare: 'ammo_flare' };
      for (const [type, n] of Object.entries(inv.ammo)) if (n > 0) cells.push(cell(`a:${type}`, ICONS[ammoIcon[type]] || ICONS.parcel, AMMO[type]?.ru || type, n));
      for (const [id, n] of inv.list()) { const d = itemDef(id); cells.push(cell(id, d.iconSvg, d.name.ru, n > 1 ? n : null)); }
    }
    P.grid.innerHTML = cells.length ? cells.join('') : '<div class="jr-empty"><b>Карманы пусты</b><span>Your pockets are empty</span></div>';
    // keep a choice that still exists, else the first thing in the pockets
    const keys = [...P.grid.querySelectorAll('[data-item]')].map((b) => b.dataset.item);
    if (!keys.includes(this.item)) {
      this.item = keys[0] || null;
      P.grid.querySelector(`[data-item="${CSS.escape(this.item || '')}"]`)?.classList.add('sel');
    }
    P.detail.innerHTML = this.item ? this._itemDetail(this.item) : '';
  }

  _itemDetail(key) {
    const inv = this.inventory;
    if (key.startsWith('w:')) {
      const id = key.slice(2), w = WEAPONS[id];
      return `<div class="big wide">${ICONS[id]}</div><h2>${esc(w.name.ru)}</h2><h3>${esc(w.name.en)}</h3>
        <p>${esc(w.desc.ru)}</p><p class="en">${esc(w.desc.en)}</p>
        <div class="meta">${esc(AMMO[w.ammo]?.ru)} · в карманах <b>${inv.ammo[w.ammo] || 0}</b> <span>in the pockets</span></div>`;
    }
    if (key.startsWith('a:')) {
      const type = key.slice(2);
      const item = Object.keys(WEAPONS).find((w) => WEAPONS[w].ammo === type);
      return `<div class="big">${ICONS[{ '9x18': 'ammo_9x18', '7.62x54R': 'ammo_762x54', '7.62x39': 'ammo_762x39', flare: 'ammo_flare' }[type]] || ''}</div>
        <h2>${esc(AMMO[type]?.ru || type)}</h2><h3>${esc(AMMO[type]?.en || type)}</h3>
        <p>${inv.ammo[type]} шт. россыпью.${item ? ` Для: ${esc(WEAPONS[item].name.ru)}.` : ''}</p>
        <p class="en">${inv.ammo[type]} loose rounds.${item ? ` For the ${esc(WEAPONS[item].name.en)}.` : ''}</p>`;
    }
    const d = itemDef(key);
    const n = inv?.count(key) || 0;
    let use = '';
    if (d.use || d.kind === 'flare') {
      const c = canUse(key, { stats: this.stats, inventory: inv });
      use = `<button class="jr-use" data-use="${esc(key)}"${c.ok ? '' : ' disabled'}><b>Использовать</b><span>Use</span></button>${c.why ? `<div class="why"><b>${esc(c.why.ru)}</b> · ${esc(c.why.en)}</div>` : ''}`;
    }
    return `<div class="big">${d.iconSvg}</div><h2>${esc(d.name.ru)}${n > 1 ? ` <em>×${n}</em>` : ''}</h2><h3>${esc(d.name.en)}</h3>
      <p>${esc(d.desc.ru)}</p><p class="en">${esc(d.desc.en)}</p>${use}`;
  }

  _renderDocs() {
    const inv = this.inventory, P = this.parts;
    const ids = inv ? [...inv.docs] : Object.keys(this.docs);
    const groups = new Map();
    for (const id of ids) {
      const d = this.docs[id];
      const ch = d?.chapter ?? inv?.docChapters.get(id) ?? 0;
      if (!groups.has(ch)) groups.set(ch, []);
      groups.get(ch).push(id);
    }
    if (!ids.length) {
      P.list.innerHTML = '<div class="jr-empty"><b>Ничего не прочитано</b><span>Nothing read yet</span></div>';
      P.reader.innerHTML = '';
      return;
    }
    if (!ids.includes(this.docId)) this.docId = ids[ids.length - 1];
    P.list.innerHTML = [...groups.keys()].sort((a, b) => a - b).map((ch) => {
      const c = CHAPTERS[ch];
      const head = c ? `<h4><b>${esc(c.nth[0])}</b> · ${esc(c.ru)}<span>${esc(c.en)}</span></h4>` : '<h4><b>Прочее</b><span>Other</span></h4>';
      return head + groups.get(ch).map((id) => {
        const d = this.docs[id] || { kind: 'note', title: { ru: id, en: id } };
        return `<button class="jr-doc${id === this.docId ? ' sel' : ''}${this.unread.has(id) ? ' new' : ''}" data-doc="${esc(id)}">${docIcon(d.kind)}<b>${esc(d.title?.ru)}</b><span>${esc(d.title?.en)}</span></button>`;
      }).join('');
    }).join('');
    this.unread.delete(this.docId); this._badge();
    this._renderReader();
  }

  _renderReader() {
    const R = this.parts.reader, d = this.docs[this.docId];
    if (!d) { R.innerHTML = ''; return; }
    const L = this.en ? 'en' : 'ru';
    const kind = d.kind || 'note';
    const body = d.body?.[L] ?? d.body?.ru ?? '';
    const title = d.title?.[L] || d.title?.ru || '';
    const meta = [d.place, d.date].filter(Boolean).map(esc).join(', ');
    const secret = kind === 'report' && (d.stamp || /19[56]\d/.test(d.date || ''));
    const head = {
      telex: `<div class="strip">${this.en ? 'TELEX' : 'ТЕЛЕГРАММА'}${meta ? ` · ${meta}` : ''}</div>`,
      tape: `<div class="label">${this.en ? 'Transcript of a tape recording' : 'Расшифровка магнитофонной записи'}</div>`,
    }[kind] || '';
    R.innerHTML = `<div class="jr-lang"><button data-lang="ru" class="${this.en ? '' : 'on'}">Русский</button><button data-lang="en" class="${this.en ? 'on' : ''}">English</button></div>
      <article class="paper kind-${esc(kind)}">${head}
        ${secret ? `<div class="stamp">${esc(d.stamp?.[L] || d.stamp || (this.en ? 'TOP SECRET' : 'СОВ. СЕКРЕТНО'))}</div>` : ''}
        ${kind === 'photo' ? `<div class="pic">${d.image ? `<img src="${esc(d.image)}" alt="">` : ICONS.photo}</div>` : ''}
        ${kind !== 'telex' && meta ? `<div class="meta">${meta}</div>` : ''}
        <h2>${esc(title)}</h2>
        <div class="body">${paras(body)}</div>
        ${d.author ? `<div class="author">${esc(typeof d.author === 'object' ? d.author[L] || d.author.ru : d.author)}</div>` : ''}
      </article>`;
  }

  _renderObjective() {
    // (if the story never told us, read what the objective panel on the HUD says)
    let o = this.objective;
    if (!o) {
      const panel = document.getElementById('objective');
      const t = document.getElementById('objtitle')?.textContent;
      if (t && panel && !panel.classList.contains('hidden')) o = { title: t, text: document.getElementById('objtext')?.textContent || '' };
    }
    const c = CHAPTERS[this.chapter];
    this.parts.obj.innerHTML = `${c ? `<div class="ch"><b>${esc(c.nth[0])} · ${esc(c.ru)}</b><span>${esc(c.nth[1])}: ${esc(c.en)}</span></div>` : ''}
      <div class="now"><div class="tag"><b>Задача</b><span>Objective</span></div>
      ${o ? `<h2>${esc(o.title)}</h2>${o.ru ? `<div class="ru">${esc(o.ru)}</div>` : ''}<p>${esc(o.text)}</p>` : '<p class="none">Нет задачи · Nothing to do but survive.</p>'}</div>
      ${this.done.length ? `<div class="done"><div class="tag"><b>Сделано</b><span>Done</span></div>${this.done.map((d) => `<div class="d">${esc(d.title)}</div>`).join('')}</div>` : ''}`;
  }
}
