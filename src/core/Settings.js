// Graphics presets and the player's settings (kept in localStorage).
//
// Every system reads its budget from the preset: render scale, shadow cascades, the water's
// reflection, ambient occlusion, depth of field, snow, wave count, aurora steps, animal range.

export const QUALITY = {
  low: {
    name: 'Low', scale: 0.7, msaa: 0, smaa: false,
    cascades: 1, shadowSize: 1024, shadowFar: 90,
    reflection: 0, ao: false, dof: false, bloomRes: 0.5,
    snow: 2500, waves: 6, oceanRings: 110, oceanSegs: 160, auroraSteps: 10,
    animalRange: 140, peopleRange: 60, envSize: 64,
  },
  medium: {
    name: 'Medium', scale: 0.85, msaa: 0, smaa: true,
    cascades: 2, shadowSize: 2048, shadowFar: 160,
    reflection: 0.4, ao: true, aoHalf: true, dof: false, bloomRes: 0.5,
    snow: 6000, waves: 8, oceanRings: 150, oceanSegs: 224, auroraSteps: 16,
    animalRange: 220, peopleRange: 90, envSize: 128,
  },
  high: {
    name: 'High', scale: 1.0, msaa: 4, smaa: false,
    cascades: 3, shadowSize: 2048, shadowFar: 300,
    reflection: 0.5, ao: true, aoHalf: false, dof: true, bloomRes: 1,
    snow: 12000, waves: 8, oceanRings: 180, oceanSegs: 288, auroraSteps: 24,
    animalRange: 320, peopleRange: 120, envSize: 128,
  },
};

const KEY = 'arkticheskiy.settings.v1';
const DEFAULTS = {
  quality: 'medium',
  mode: 'story',
  timeOfDay: 'night',
  volume: 0.8,
  music: true,
  voiceLang: 'ru',          // the voices: 'ru' (Russian, English subtitles) or 'en'
  sensitivity: 1,
  fov: 70,
  showFps: false,
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: settings last this visit only */ }
}
