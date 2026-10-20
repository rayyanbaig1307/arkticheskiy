import { ICONS, WEAPONS, itemDef } from '../survival/Items.js';
import { saves } from '../survival/Saves.js';

// The horror HUD, built in code inside #hud: as little on the screen as the game can get away with.
//
// - Bottom left, three hairline bars (health, warmth, stamina) and the flashlight's battery.
//   Each one fades in when it changes or runs low and fades out again once it settles.
// - Bottom right, the weapon in your hands and its rounds (in the gun / in the pockets), with
//   pips for the small magazines and the hand flares you carry; it dims once nothing changes.
//   The weapons system drives it: hud.setWeapon(id), hud.setAmmo(weapon, inGun, reserve).
// - The view itself: frost creeping in from the edges as warmth falls (a canvas of crystals,
//   drawn once, revealed by a shrinking radial mask), a red pulse on every hit, a dark
//   heartbeat vignette at low health, locker slats when hidden.
// - Pickup toasts (an icon and the name), the chapter title card, and the death screen with
//   Retry from the last checkpoint and Quit to the title (hud.onRetry, hud.onQuit).
//
// hud.update(dt, env) once a frame reads the stats; env is the same object Stats.update gets
// (it only needs flashlightOn). Nothing is written to the DOM unless it changed.

export const CHAPTERS = {
  1: { ru: 'Молчание', en: 'Silence', nth: ['Глава первая', 'Chapter one'] },
  2: { ru: 'Северный', en: 'Severny', nth: ['Глава вторая', 'Chapter two'] },
  3: { ru: 'Голоса', en: 'Voices', nth: ['Глава третья', 'Chapter three'] },
  4: { ru: 'Объект-7', en: 'Object 7', nth: ['Глава четвёртая', 'Chapter four'] },
  5: { ru: 'Домой', en: 'Home', nth: ['Глава пятая', 'Chapter five'] },
};

const DEATHS = {
  cold: ['ТЫ ЗАМЁРЗ', 'You froze to death', 'Холод забрал тебя.', 'The cold took you.'],
  bear: ['ТЫ ПОГИБ', 'You died', 'Белый медведь.', 'A polar bear.'],
  turned: ['ТЫ ПОГИБ', 'You died', 'Обращённые добрались до тебя.', 'The Turned got to you.'],
  shade: ['ТЫ ПОГИБ', 'You died', 'Тень забрала последнее тепло.', 'A Shade took the last of your warmth.'],
  fall: ['ТЫ ПОГИБ', 'You died', 'Ты сорвался.', 'You fell.'],
  gromov: ['ТЫ ПОГИБ', 'You died', 'Громов.', 'Gromov.'],
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function el(tag, cls, html, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

// a small seeded random, so the frost grows the same way every time it is redrawn
function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class HorrorHUD {
  // { stats, inventory, ui, audio, root }
  constructor({ stats, inventory, ui, audio, root } = {}) {
    this.stats = stats; this.inventory = inventory; this.ui = ui; this.audio = audio;
    this.root = root || document.getElementById('hud') || document.body;
    this.onRetry = null;          // () => {}: load the last checkpoint
    this.onQuit = null;           // () => {}: back to the title
    this.autoDeath = true;        // show the death screen by itself when stats.dead
    this.deathDelay = 1.4;        // seconds of the world going on before the screen comes down
    this.deathOpen = false;
    this.weapon = null;
    this._ammoCache = {};         // weapon -> [inGun, reserve], for when it is drawn again
    this._t = 0; this._hits = stats?.hits ?? 0; this._hurt = 0; this._beat = 0;
    this._build();
    ui?.addOverlay?.(() => this.deathOpen);
    if (inventory) { inventory.listen?.((what) => { if (what === 'items') this._itemsChanged(); }); this._itemsChanged(); }
    let resizeT = 0;
    addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => this._drawFrost(), 250); });
  }

  // ---------------------------------------------------------------- building
  _build() {
    const r = this.root;
    // the view layers go first, under the crosshair, the hint and the subtitles
    const layers = el('div', 'hh-layers');
    this.frostCanvas = el('canvas', 'hh-frost', null, layers);
    this.lowEl = el('div', 'hh-low', null, layers);
    this.hurtEl = el('div', 'hh-hurt', null, layers);
    this.lockerEl = el('div', 'hh-locker', '<div class="hh-hidden-tag"><svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8c6 7 13 10 20 10s14-3 20-10M12 15l-3 5M24 18v5M36 15l3 5"/></svg><b>Скрыт</b><span>hidden</span></div>', layers);
    r.insertBefore(layers, r.firstChild);
    this._drawFrost();

    // the bars and the battery
    const st = el('div', 'hh-stats', null, r);
    const bar = (key, ru, en) => {
      const b = el('div', `hh-bar ${key}`, `<div class="lbl"><b>${ru}</b><span>${en}</span><i class="trend"></i></div><div class="track"><div class="trail"></div><div class="fill"></div></div>`, st);
      return { key, el: b, fill: b.querySelector('.fill'), trail: b.querySelector('.trail'), v: -1, trailV: 100, trailT: 0, ref: -1, t: 0, shown: false, warn: false };
    };
    this.bars = [
      Object.assign(bar('health', 'Здоровье', 'health'), { low: 40, crit: 25, step: 0.5, hold: 3 }),
      Object.assign(bar('warmth', 'Тепло', 'warmth'), { low: 45, crit: 25, step: 0.9, hold: 4 }),
      Object.assign(bar('stamina', 'Силы', 'stamina'), { low: 99.5, crit: -1, step: 0.4, hold: 1.2 }),
    ];
    this.batt = el('div', 'hh-batt', `<div class="lbl"><b>Фонарь</b><span>flashlight</span></div><div class="cells">${'<i></i>'.repeat(5)}</div><span class="spare"></span>`, st);
    this.battCells = [...this.batt.querySelectorAll('.cells i')];
    this.battSpare = this.batt.querySelector('.spare');
    this._batt = { lit: -1, on: null, t: 0, shown: false, low: null, spare: -1 };

    // the weapon and its rounds
    this.ammoEl = el('div', 'hh-ammo', `<div class="w"><div class="wicon"></div><div class="wname"><b></b><span></span></div></div>
      <div class="rounds"><span class="in"></span><span class="res"></span></div><div class="pips"></div>
      <div class="flares">${ICONS.flare}<span></span><em>G</em></div>`, r);
    this.ammoParts = {
      icon: this.ammoEl.querySelector('.wicon'), ru: this.ammoEl.querySelector('.wname b'), en: this.ammoEl.querySelector('.wname span'),
      inGun: this.ammoEl.querySelector('.in'), res: this.ammoEl.querySelector('.res'), pips: this.ammoEl.querySelector('.pips'),
      flares: this.ammoEl.querySelector('.flares'), flareN: this.ammoEl.querySelector('.flares span'),
    };
    this._ammoT = 0; this._flares = -1;

    this.toastsEl = el('div', 'hh-toasts', null, r);
    this.toasts = [];

    this.chapterEl = el('div', 'hh-chapter', '<div class="nth"><b></b><span></span></div><div class="name"></div><div class="rule"></div><div class="name-en"></div>', r);
    this._chapterT = 0;

    // the death screen lives on the page itself: it must take clicks and sit over everything
    this.deathEl = el('div', 'hh-death hidden', `<div class="inner"><div class="title"></div><div class="sub"></div>
      <div class="cause"><b></b><span></span></div>
      <div class="buttons"><button class="primary retry"><span>Повторить</span><small></small></button>
      <button class="quit"><span>В главное меню</span><small>Quit to the title</small></button></div></div>`, document.body);
    this.deathEl.querySelector('.retry').addEventListener('click', () => this._retry());
    this.deathEl.querySelector('.quit').addEventListener('click', () => this._quit());
  }

  // the frost: a pale haze at the edges and fern-like crystals grown inward from them, densest in
  // the corners. Drawn at a modest resolution and stretched: frost is soft anyway.
  _drawFrost() {
    const c = this.frostCanvas;
    const w = Math.round(Math.min(1280, innerWidth * 0.75)), h = Math.max(1, Math.round(w * innerHeight / Math.max(1, innerWidth)));
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const R = Math.hypot(w, h) / 2;
    const haze = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, R);
    haze.addColorStop(0, 'rgba(205,232,248,0)');
    haze.addColorStop(0.55, 'rgba(205,232,248,0.08)');
    haze.addColorStop(1, 'rgba(228,244,255,0.6)');
    g.fillStyle = haze; g.fillRect(0, 0, w, h);

    const rnd = rng(1962);
    const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const grow = (x, y, ang, len, depth) => {
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      paths[depth].moveTo(x, y); paths[depth].lineTo(x2, y2);
      if (depth === 3 || len < 3) return;
      const k = 2 + ((rnd() * 3) | 0);
      for (let i = 1; i <= k; i++) {
        const f = i / (k + 1);
        const px = x + (x2 - x) * f, py = y + (y2 - y) * f;
        const l = len * (0.5 - depth * 0.08) * (1 - f * 0.5) * (0.6 + rnd() * 0.6);
        grow(px, py, ang + 1.05 + (rnd() - 0.5) * 0.35, l, depth + 1);
        grow(px, py, ang - 1.05 + (rnd() - 0.5) * 0.35, l, depth + 1);
      }
    };
    const m = Math.min(w, h);
    const seeds = Math.round((w + h) / 12);
    for (let i = 0; i < seeds; i++) {
      // along an edge, pushed toward the corners
      const side = (rnd() * 4) | 0;
      let u = rnd(); u = u < 0.5 ? 0.5 * Math.pow(2 * u, 1.8) : 1 - 0.5 * Math.pow(2 - 2 * u, 1.8);
      const corner = Math.abs(u - 0.5) * 2;               // 0 in the middle of an edge, 1 at a corner
      let x, y, a;
      if (side === 0) { x = u * w; y = 0; a = Math.PI / 2; } else if (side === 1) { x = w; y = u * h; a = Math.PI; } else if (side === 2) { x = u * w; y = h; a = -Math.PI / 2; } else { x = 0; y = u * h; a = 0; }
      a += (rnd() - 0.5) * 1.3;
      grow(x, y, a, m * (0.05 + rnd() * 0.09) * (1 + corner * 0.9), 0);
    }
    g.lineCap = 'round';
    const styles = [[2.2, 0.55], [1.5, 0.42], [1.0, 0.32], [0.7, 0.24]];
    paths.forEach((p, i) => { g.lineWidth = styles[i][0]; g.strokeStyle = `rgba(236,248,255,${styles[i][1]})`; g.stroke(p); });
    // rime: specks, thickest at the edges
    g.fillStyle = 'rgba(240,250,255,0.35)';
    for (let i = 0; i < seeds * 14; i++) {
      const px = rnd() * w, py = rnd() * h;
      const d = Math.hypot((px - w / 2) / (w / 2), (py - h / 2) / (h / 2));
      if (rnd() < d * d * 0.6) g.fillRect(px, py, 1.2, 1.2);
    }
    this._frost = -1;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, env = {}) {
    const s = this.stats;
    this._t += dt;
    if (s) {
      for (const b of this.bars) this._bar(b, s[b.key], dt);
      const trend = s.warmthRate > 0.05 ? 'rising' : s.warmthRate < -0.05 ? 'falling' : '';
      if (trend !== this._trend) { this._trend = trend; this.bars[1].el.dataset.trend = trend; }
      this._battery(dt, s.battery, !!env.flashlightOn);
      this._view(dt, s);
      if (this.autoDeath && s.dead && !this.deathOpen) {
        this._deathT = (this._deathT ?? this.deathDelay) - dt;
        if (this._deathT <= 0) this.death(s.cause);
      } else if (!s.dead) this._deathT = undefined;
    }
    // the ammo block: bright for a few seconds after a change, then dim
    if (this._ammoT > 0 && (this._ammoT -= dt) <= 0) this.ammoEl.classList.remove('bright');
    // toasts
    for (const t of this.toasts) {
      t.t -= dt;
      if (t.t <= 0 && !t.out) { t.out = true; t.el.classList.remove('on'); setTimeout(() => t.el.remove(), 600); }
    }
    this.toasts = this.toasts.filter((t) => !t.out || t.el.isConnected);
    if (this._chapterT > 0 && (this._chapterT -= dt) <= 0) this.chapterEl.classList.replace('on', 'out');
  }

  _bar(b, v, dt) {
    if (v == null) return;
    if (b.ref < 0) b.ref = v;
    if (Math.abs(v - b.ref) >= b.step) { b.ref = v; b.t = b.hold; }
    else if (b.t > 0) b.t -= dt;
    const show = v < b.low || b.t > 0;
    if (show !== b.shown) { b.shown = show; b.el.classList.toggle('on', show); }
    const warn = v < b.crit || (b.key === 'stamina' && this.stats.winded);
    if (warn !== b.warn) { b.warn = warn; b.el.classList.toggle('warn', warn); }
    if (Math.abs(v - b.v) > 0.05) {
      b.v = v;
      b.fill.style.transform = `scaleX(${clamp(v / 100, 0, 1).toFixed(4)})`;
      if (b.key === 'warmth') b.el.style.setProperty('--w', (v / 100).toFixed(3));
    }
    // health keeps a pale trail of what was just lost, which catches up after a moment
    if (b.key === 'health') {
      if (v > b.trailV) b.trailV = v;
      else if (v < b.trailV - 0.05) {
        b.trailT += dt;
        if (b.trailT > 0.6) b.trailV = Math.max(v, b.trailV - 40 * dt);
      } else b.trailT = 0;
      const tv = b.trailV.toFixed(1);
      if (tv !== b._tv) { b._tv = tv; b.trail.style.transform = `scaleX(${(b.trailV / 100).toFixed(4)})`; }
    }
  }

  _battery(dt, v, on) {
    const B = this._batt;
    const lit = Math.ceil(clamp(v, 0, 100) / 20 - 1e-6);
    if (B.lit < 0) B.on = on;                              // (the first frame: nothing to announce)
    else if (on !== B.on || lit !== B.lit) B.t = on || lit > B.lit ? 3 : 1.5;
    if (lit !== B.lit) { B.lit = lit; this.battCells.forEach((c, i) => c.classList.toggle('lit', i < lit)); }
    B.on = on;
    const low = on && v < 20;
    if (low !== B.low) { B.low = low; this.batt.classList.toggle('low', low); }
    if (B.t > 0) B.t -= dt;
    const show = B.t > 0 || low;
    if (show !== B.shown) { B.shown = show; this.batt.classList.toggle('on', show); }
  }

  _itemsChanged() {
    const inv = this.inventory;
    const spare = inv.count('battery');
    if (spare !== this._batt.spare) { this._batt.spare = spare; this.battSpare.textContent = spare ? `+${spare}` : ''; this._batt.t = 3; }
    const fl = inv.count('flare');
    if (fl !== this._flares) {
      const first = this._flares < 0;
      this._flares = fl;
      this.ammoParts.flareN.textContent = `×${fl}`;
      this.ammoParts.flares.classList.toggle('none', !fl);
      if (!first) this._wake();
    }
  }

  // the frost, the hurt flash and the heartbeat at low health
  _view(dt, s) {
    const f = s.frost;
    if (Math.abs(f - this._frost) > 0.004) {
      this._frost = f;
      const inner = 118 - f * 86, outer = inner + 32;
      const mask = `radial-gradient(ellipse at 50% 50%, transparent ${inner.toFixed(1)}%, #000 ${outer.toFixed(1)}%)`;
      const st = this.frostCanvas.style;
      st.webkitMaskImage = mask; st.maskImage = mask;
      st.opacity = Math.min(1, f * 3).toFixed(3);
    }
    if (s.hits !== this._hits) {
      // (fewer hits than before is a reset for a new game, not a hit)
      if (s.hits > this._hits) this._hurt = Math.min(1, Math.max(this._hurt, 0.45 + s.lastDamage / 40));
      this._hits = s.hits;
    }
    if (this._hurt > 0) {
      this._hurt = Math.max(0, this._hurt - dt * 1.5);
      this.hurtEl.style.opacity = this._hurt.toFixed(3);
    }
    // a double beat, faster as health goes
    const base = clamp((40 - s.health) / 40, 0, 1) * 0.85 + s.fear * 0.12;
    let o = 0;
    if (base > 0.01 && !s.dead) {
      this._beat = (this._beat + dt * (1.1 + 1.1 * clamp((40 - s.health) / 40, 0, 1))) % 1;
      const p = this._beat;
      const beat = Math.exp(-(((p - 0.02) / 0.06) ** 2)) + 0.6 * Math.exp(-(((p - 0.2) / 0.06) ** 2));
      o = base * (0.7 + 0.3 * beat);
    } else if (s.dead) o = 0.9;
    const os = o.toFixed(2);
    if (os !== this._lowO) { this._lowO = os; this.lowEl.style.opacity = os; }
  }

  // ---------------------------------------------------------------- the weapons' hooks
  setWeapon(id) {
    this.weapon = id || null;
    const a = this.ammoEl, P = this.ammoParts;
    a.classList.toggle('armed', !!id);
    if (!id) { this._wake(false); return; }
    const w = WEAPONS[id];
    P.icon.innerHTML = ICONS[id] || '';
    P.ru.textContent = w ? w.name.ru : id;
    P.en.textContent = w ? w.name.en : '';
    const cached = this._ammoCache[id];
    const reserve = w && this.inventory ? this.inventory.ammo[w.ammo] : cached?.[1];
    this._rounds(id, cached ? cached[0] : null, reserve);
    this._wake();
  }

  setAmmo(weapon, inGun, reserve) {
    const id = WEAPONS[weapon] ? weapon : this.weapon;
    if (WEAPONS[weapon] && weapon !== this.weapon) this.setWeapon(weapon);
    else if (!WEAPONS[weapon] && weapon) { this.ammoParts.ru.textContent = weapon; this.ammoParts.en.textContent = ''; }
    if (id) this._ammoCache[id] = [inGun, reserve];
    this._rounds(id, inGun, reserve);
    this._wake();
  }

  _rounds(id, inGun, reserve) {
    const P = this.ammoParts, mag = WEAPONS[id]?.mag || 0;
    P.inGun.textContent = inGun == null ? '–' : inGun;
    P.res.textContent = reserve == null ? '' : `/ ${reserve}`;
    this.ammoEl.classList.toggle('empty', inGun === 0);
    this.ammoEl.classList.toggle('dry', reserve === 0);
    // the small magazines as pips: you count your shots
    const pips = mag && mag <= 10 && inGun != null ? Array.from({ length: mag }, (_, i) => `<i class="${i < inGun ? 'full' : ''}"></i>`).join('') : '';
    if (pips !== this._pips) { this._pips = pips; P.pips.innerHTML = pips; }
  }

  _wake(on = true) {
    const show = on && (!!this.weapon || this._flares > 0);
    this.ammoEl.classList.toggle('on', show);
    this.ammoEl.classList.toggle('bright', show);
    this._ammoT = show ? 3.5 : 0;
  }

  // ---------------------------------------------------------------- messages
  // a toast: { icon (svg), wide (a weapon's strip), ru, en, count, secs }
  notify({ icon, wide, ru, en, count, secs = 3.4 } = {}) {
    const n = count != null && count !== 1 ? `<em>${count > 0 ? '×' : ''}${count}</em>` : '';
    const t = el('div', `hh-toast${wide ? ' wide' : ''}${icon ? '' : ' plain'}`, `${icon ? `<div class="ic">${icon}</div>` : ''}<div class="tx"><b>${esc(ru)}</b>${n}<span>${esc(en)}</span></div>`);
    this.toastsEl.prepend(t);
    requestAnimationFrame(() => t.classList.add('on'));
    this.toasts.push({ el: t, t: secs, out: false });
    while (this.toasts.filter((x) => !x.out).length > 5) {
      const old = this.toasts.find((x) => !x.out);
      old.t = 0; old.out = true; old.el.remove();
    }
  }

  toast(ru, en, secs) { this.notify({ ru, en, secs }); }

  pickup(id, count = 1) { const d = itemDef(id); this.notify({ icon: d.iconSvg, ru: d.name.ru, en: d.name.en, count: d.ammo ? d.ammo.rounds * count : count }); }

  used(id) { const d = itemDef(id); this.notify({ icon: d.iconSvg, ru: d.name.ru, en: `${d.name.en}: used`, secs: 2.2 }); }

  // the chapter card: number, the title big in Cyrillic, the English under it
  chapter(n, ru, en, secs = 6) {
    const c = CHAPTERS[n] || {};
    const E = this.chapterEl;
    E.querySelector('.nth b').textContent = c.nth?.[0] || (n ? `Глава ${n}` : '');
    E.querySelector('.nth span').textContent = c.nth?.[1] || (n ? `Chapter ${n}` : '');
    const name = E.querySelector('.name');
    name.textContent = (ru || c.ru || '').toUpperCase();
    E.querySelector('.name-en').textContent = en || c.en || '';
    // (snap back to tight letters without animating, then let them spread again as it fades in)
    name.style.transition = 'none';
    E.classList.remove('on', 'out'); void E.offsetWidth;
    name.style.transition = '';
    E.classList.add('on');
    this._chapterT = secs;
    this.audio?.horror?.stinger?.('chapter');
  }

  setHidden(on) {
    this.hidden = !!on;
    this.lockerEl.classList.toggle('on', this.hidden);
    this.root.classList.toggle('hh-hiding', this.hidden);
  }

  // a hit from outside the stats (a scare that should flash red without hurting)
  hit(amount = 15) { this._hurt = Math.min(1, Math.max(this._hurt, 0.45 + amount / 40)); }

  // ---------------------------------------------------------------- death
  death(cause = this.stats?.cause) {
    if (this.deathOpen) return;
    this.deathOpen = true;
    const [title, sub, ru, en] = DEATHS[cause] || ['ТЫ ПОГИБ', 'You died', '', ''];
    const D = this.deathEl;
    D.querySelector('.title').textContent = title;
    D.querySelector('.sub').textContent = sub;
    D.querySelector('.cause b').textContent = ru;
    D.querySelector('.cause span').textContent = en;
    D.querySelector('.retry small').textContent = saves.has() ? 'Retry from the last checkpoint' : 'Start again';
    D.classList.toggle('cold', cause === 'cold' || cause === 'shade');
    D.classList.remove('hidden', 'on', 'ready'); void D.offsetWidth;
    D.classList.add('on');
    clearTimeout(this._readyT);
    // the buttons come a moment after the screen, so a held mouse button can't skip it;
    // that's also when the mouse is given back
    this._readyT = setTimeout(() => {
      D.classList.add('ready');
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* not locked */ }
    }, 2200);
  }

  hideDeath() {
    clearTimeout(this._readyT);
    this.deathOpen = false; this._deathT = undefined;
    this.deathEl.classList.add('hidden');
    this.deathEl.classList.remove('on', 'ready');
  }

  _retry() {
    this.hideDeath();
    if (this.onRetry) this.onRetry();
    else if (this.ui?.onContinue && saves.has()) this.ui.onContinue();
    else location.reload();
  }

  _quit() {
    this.hideDeath();
    if (this.onQuit) this.onQuit();
    else if (this.ui?.quitToTitle) this.ui.quitToTitle();
    else location.reload();
  }

  // a new game or a retry: nothing left over on the screen
  reset() {
    this.hideDeath();
    this.setHidden(false);
    this._hurt = 0; this.hurtEl.style.opacity = '0';
    this._hits = this.stats?.hits ?? 0;
    for (const t of this.toasts) t.el.remove();
    this.toasts = [];
    this._chapterT = 0; this.chapterEl.classList.remove('on', 'out');
    for (const b of this.bars) { b.ref = -1; b.t = 0; b.trailV = 100; }
    this._ammoCache = {};
    this.setWeapon(null);
  }
}
