import { saveSettings } from '../core/Settings.js';
import { saves } from '../survival/Saves.js';
import { CHAPTERS } from './HorrorHUD.js';
import { en } from './lang.js';

// The page around the game: the loading bar, the title screen (New game, Continue when there is
// a checkpoint, the settings, the controls), the same panel as the pause menu once play has begun
// (Resume, Back to the last checkpoint, Quit to the title), and the small HUD pieces every part
// of the game uses: the crosshair and the use hint, the wheel's readout, subtitles, toasts and
// the F3 frame-rate line. The horror HUD (bars, frost, ammo, death) is ui/HorrorHUD.js.
//
// Callbacks the integrator sets: onNewGame, onContinue (also the pause menu's checkpoint button),
// onPlay (Resume), onQuit (back to the title; a page reload when unset), onVolume, onMusic.
// While New game and Continue are not wired they fall back to onPlay, so the old boot still runs.
//
// Overlays (the journal, the death screen) register with addOverlay(() => isOpen): losing the
// pointer lock under one of them does not bring the pause menu up over it.

const $ = (id) => document.getElementById(id);

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (!(m >= 0)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : new Date(ms).toLocaleDateString();
}

export class UI {
  constructor(settings) {
    this.settings = settings;
    this.started = false;
    this.subT = 0; this.toastT = 0;
    this.onPlay = null; this.onNewGame = null; this.onContinue = null; this.onQuit = null;
    this.onVolume = null; this.onMusic = null;
    this.onTime = null;            // (kept for the old wiring: the time of day is the story's now)
    this.overlays = [];
    const s = settings;
    // the free voyage is gone, and with it the select that could have brought you back from it
    if (s.mode !== 'story') { s.mode = 'story'; saveSettings(s); }

    // the settings: rows of buttons (one lit) and two sliders that say their value
    const seg = (id, value, pick) => {
      const box = $(id);
      const light = (v) => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      light(value);
      box.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b || b.classList.contains('on')) return;
        light(b.dataset.v); pick(b.dataset.v);
      });
    };
    const slide = (id, value, show, pick) => {
      const input = $(id), out = $(id + 'Out');
      input.value = value; out.textContent = show(+value);
      input.addEventListener('input', () => { out.textContent = show(+input.value); pick(+input.value); });
    };
    seg('quality', s.quality, (v) => {
      s.quality = v; saveSettings(s);
      $('qnote').textContent = 'Reloading with the new graphics setting...';
      setTimeout(() => location.reload(), 300);
    });
    slide('volume', s.volume, (v) => `${Math.round(v * 100)}%`, (v) => { s.volume = v; saveSettings(s); this.onVolume?.(v); });
    seg('music', s.music ? 'on' : 'off', (v) => { s.music = v === 'on'; saveSettings(s); this.onMusic?.(s.music); });
    slide('sens', s.sensitivity, (v) => v.toFixed(2), (v) => { s.sensitivity = v; saveSettings(s); });
    seg('vlang', s.voiceLang === 'ru' ? 'ru' : 'en', (v) => { s.voiceLang = v; saveSettings(s); this.onVoiceLang?.(v); });
    seg('slang', s.subs || 'en', (v) => { s.subs = v; saveSettings(s); });

    // Settings and Controls open in the panel beside the list; the same item, the ×, or Esc closes it
    const menu = $('menu');
    this.panel = (name) => {
      menu.querySelectorAll('.mn-panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
      menu.querySelectorAll('.mn-item[data-panel]').forEach((b) => b.classList.toggle('open', b.dataset.panel === name));
      menu.classList.toggle('panel-open', !!name);
      this.openPanel = name || null;
    };
    menu.querySelectorAll('.mn-item[data-panel]').forEach((b) =>
      b.addEventListener('click', () => this.panel(this.openPanel === b.dataset.panel ? null : b.dataset.panel)));
    menu.querySelectorAll('.mn-close').forEach((b) => b.addEventListener('click', () => this.panel(null)));
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.openPanel && !menu.classList.contains('hidden')) { e.stopPropagation(); this.panel(null); }
    }, true);

    $('play').addEventListener('click', () => this.onPlay?.());
    $('newgame').addEventListener('click', (e) =>
      this._confirm(e.currentTarget, saves.has(), 'Your checkpoint will be lost. Click again', () => (this.onNewGame || this.onPlay)?.()));
    $('continue').addEventListener('click', () => (this.onContinue || this.onPlay)?.());
    $('checkpoint').addEventListener('click', (e) =>
      this._confirm(e.currentTarget, true, 'Since then is lost. Click again', () => this.onContinue?.()));
    $('quit').addEventListener('click', (e) =>
      this._confirm(e.currentTarget, true, 'Since the checkpoint is lost. Click again', () => this.quitToTitle()));

    this.showFps = !!s.showFps;
    $('fps').classList.toggle('hidden', !this.showFps);
    // a refused pointer lock (too soon after the last, or no gesture) would leave play frozen
    // with nothing on the screen: the pause menu, whose Resume can take the pointer properly
    document.addEventListener('pointerlockerror', () => { if (this.started) this.setPlaying(false); });
    this._mode('title');
  }

  addOverlay(isOpen) { this.overlays.push(isOpen); }
  get overlayOpen() { return this.overlays.some((f) => f()); }

  loading(msg, p) {
    $('loadtext').textContent = msg;
    $('loadfill').style.width = `${Math.round(p * 100)}%`;
  }

  ready() {
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
    this.refreshContinue();
  }

  // playing (pointer locked) or paused (the menu over the game)
  setPlaying(on) {
    if (on) {
      this.started = true;
      this._mode('paused');
      $('menu').classList.add('hidden');
      $('hud').classList.remove('hidden');
      return;
    }
    $('hud').classList.toggle('hidden', !this.started);
    if (this.overlayOpen) return;
    $('menu').classList.remove('hidden');
    this.refreshContinue();
  }

  // back to the title without reloading (the integrator's onQuit calls this once the world is reset)
  showTitle() {
    this.started = false;
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* not locked */ }
    this._mode('title');
    $('hud').classList.add('hidden');
    $('menu').classList.remove('hidden');
    this.refreshContinue();
  }

  quitToTitle() {
    if (this.onQuit) this.onQuit();
    else location.reload();
  }

  // Continue and the checkpoint button exist only when there is a save
  refreshContinue() {
    const info = saves.peek();
    $('continue').classList.toggle('hidden', !info);
    $('checkpoint').classList.toggle('hidden', !info || !this.onContinue);
    if (!info) return;
    const c = CHAPTERS[info.chapter];
    const where = c ? `${c.nth[1]}: ${c.en}` : 'The last checkpoint';
    $('continue').querySelector('small').textContent = `${where}${info.savedAt ? ` · ${ago(info.savedAt)}` : ''}`;
  }

  _mode(m) {
    const menu = $('menu');
    menu.classList.toggle('title', m === 'title');
    menu.classList.toggle('paused', m === 'paused');
    this.panel?.(null);
  }

  // a button that throws something away asks twice: the first click arms it for three seconds
  _confirm(btn, needed, msg, fn) {
    const small = btn.querySelector('small');
    if (!needed || btn.dataset.armed) {
      clearTimeout(btn._armT);
      if (btn.dataset.armed) { small.textContent = btn.dataset.label; delete btn.dataset.armed; btn.classList.remove('armed'); }
      fn();
      return;
    }
    btn.dataset.armed = '1'; btn.dataset.label = small.textContent;
    btn.classList.add('armed');
    small.textContent = msg;
    btn._armT = setTimeout(() => { small.textContent = btn.dataset.label; delete btn.dataset.armed; btn.classList.remove('armed'); }, 3000);
  }

  toggleFps() {
    this.showFps = !this.showFps; this.settings.showFps = this.showFps; saveSettings(this.settings);
    $('fps').classList.toggle('hidden', !this.showFps);
  }

  hint(text) {
    const el = $('hint');
    if (text === this._hint) return;
    this._hint = text;
    el.innerHTML = text ? `<span class="key">E</span>${en(text)}` : '';
    $('crosshair').classList.toggle('active', !!text);
  }

  station(html) {
    if (html === this._station) return;
    this._station = html;
    $('station').innerHTML = html || '';
  }

  // a line of speech: the English, the Russian, both (the Russian under it) or nothing, as set
  subtitle(who, ru, enLine, secs = 4) {
    const mode = this.settings.subs || 'en';
    const el = $('subs');
    if (mode === 'off') { el.classList.remove('on'); return; }
    const first = mode === 'ru' ? ru || enLine : enLine || ru;
    const second = mode === 'both' && ru && enLine ? ru : '';
    const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    el.querySelector('.one').innerHTML = first ? `<span><b class="who">${esc(who)}</b>${esc(first)}</span>` : '';
    el.querySelector('.two').innerHTML = second ? `<span>${esc(second)}</span>` : '';
    el.classList.add('on');
    this.subT = secs;
  }

  toast(text, secs = 2.5) {
    const el = $('toast'); el.textContent = en(text); el.classList.add('on'); this.toastT = secs;
  }

  fps(text) { if (this.showFps) $('fps').textContent = text; }

  update(dt) {
    if (this.subT > 0 && (this.subT -= dt) <= 0) $('subs').classList.remove('on');
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('toast').classList.remove('on');
  }
}
