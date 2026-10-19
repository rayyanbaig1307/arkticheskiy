import { saveSettings } from '../core/Settings.js';

// The page around the game: the loading bar, the start screen (which is also the pause menu),
// and the HUD: crosshair, the use hint, the station readout (at the wheel), subtitles, toasts and
// the F3 frame-rate line.

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(settings) {
    this.settings = settings;
    this.started = false;
    this.subT = 0; this.toastT = 0;
    this.onPlay = null; this.onTime = null; this.onVolume = null; this.onMusic = null;
    const s = settings;
    $('quality').value = s.quality; $('time').value = s.timeOfDay; $('volume').value = s.volume;
    $('music').checked = s.music; $('sens').value = s.sensitivity;
    $('play').addEventListener('click', () => this.onPlay?.());
    $('quality').addEventListener('change', (e) => {
      s.quality = e.target.value; saveSettings(s);
      $('qnote').textContent = 'Reloading with the new graphics setting...';
      setTimeout(() => location.reload(), 300);
    });
    $('time').addEventListener('change', (e) => { s.timeOfDay = e.target.value; saveSettings(s); this.onTime?.(s.timeOfDay); });
    $('volume').addEventListener('input', (e) => { s.volume = +e.target.value; saveSettings(s); this.onVolume?.(s.volume); });
    $('music').addEventListener('change', (e) => { s.music = e.target.checked; saveSettings(s); this.onMusic?.(s.music); });
    $('sens').addEventListener('input', (e) => { s.sensitivity = +e.target.value; saveSettings(s); });
    this.showFps = !!s.showFps;
    $('fps').classList.toggle('hidden', !this.showFps);
  }

  loading(msg, p) {
    $('loadtext').textContent = msg;
    $('loadfill').style.width = `${Math.round(p * 100)}%`;
  }

  ready() {
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
  }

  // playing (pointer locked) or paused (the menu over the game)
  setPlaying(on) {
    $('menu').classList.toggle('hidden', on);
    $('hud').classList.toggle('hidden', !on && !this.started);
    if (on) { this.started = true; $('play').textContent = 'Resume'; }
  }

  toggleFps() {
    this.showFps = !this.showFps; this.settings.showFps = this.showFps; saveSettings(this.settings);
    $('fps').classList.toggle('hidden', !this.showFps);
  }

  hint(text) {
    const el = $('hint');
    if (text === this._hint) return;
    this._hint = text;
    el.innerHTML = text ? `<span class="key">E</span>${text}` : '';
    $('crosshair').classList.toggle('active', !!text);
  }

  station(html) {
    if (html === this._station) return;
    this._station = html;
    $('station').innerHTML = html || '';
  }

  subtitle(who, ru, en, secs = 4) {
    const el = $('subs');
    el.querySelector('.ru').innerHTML = `<span class="who">${who}:</span>${ru}`;
    el.querySelector('.en').textContent = en;
    el.classList.add('on');
    this.subT = secs;
  }

  toast(text, secs = 2.5) {
    const el = $('toast'); el.textContent = text; el.classList.add('on'); this.toastT = secs;
  }

  fps(text) { if (this.showFps) $('fps').textContent = text; }

  update(dt) {
    if (this.subT > 0 && (this.subT -= dt) <= 0) $('subs').classList.remove('on');
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('toast').classList.remove('on');
  }
}
