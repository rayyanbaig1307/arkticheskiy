import * as THREE from 'three';

// Three looks for the voyage. Each preset sets the sky, the key light (the moon or the sun), the
// fill, the fog, the aurora and the exposure; the game blends toward the chosen one over a few
// seconds (Sky.setTime).
//
// Light values are in the game's own units, balanced for ACES at the given exposure; they are not
// physical lux (a real moonlit night is 10^6 times darker than day and nobody could play it).

const C = (r, g, b) => new THREE.Color(r, g, b);
const dir = (azDeg, elDeg) => {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
};

export const TIMES = {
  night: {
    label: 'Polar night',
    keyDir: dir(318, 21), keyColor: C(0.62, 0.72, 0.95), keyIntensity: 1.4,
    hemiSky: C(0.05, 0.08, 0.14), hemiGround: C(0.015, 0.025, 0.04), hemiIntensity: 1.0,
    zenith: C(0.0015, 0.004, 0.012), horizon: C(0.012, 0.03, 0.055), below: C(0.004, 0.01, 0.02),
    sun: 0, moon: 1, stars: 1, aurora: 1, clouds: 0.18, cloudColor: C(0.02, 0.03, 0.05),
    fogColor: C(0.012, 0.026, 0.045), fogGlow: C(0.035, 0.05, 0.08),
    fogDensity: 0.016, fogHaze: 0.00055, exposure: 2.0, env: 1.0, lamps: 1, snow: 1, seaState: 0.9,
  },
  sunset: {
    label: 'Sunset',
    keyDir: dir(250, 3.5), keyColor: C(1.0, 0.55, 0.28), keyIntensity: 3.2,
    hemiSky: C(0.35, 0.42, 0.6), hemiGround: C(0.12, 0.1, 0.1), hemiIntensity: 0.9,
    zenith: C(0.06, 0.12, 0.3), horizon: C(0.95, 0.5, 0.3), below: C(0.08, 0.08, 0.12),
    sun: 1, moon: 0, stars: 0.06, aurora: 0, clouds: 0.35, cloudColor: C(0.75, 0.42, 0.35),
    fogColor: C(0.36, 0.33, 0.38), fogGlow: C(0.9, 0.48, 0.24),
    fogDensity: 0.01, fogHaze: 0.00045, exposure: 0.85, env: 1.0, lamps: 0.6, snow: 0.35, seaState: 1.0,
  },
  overcast: {
    label: 'Overcast day',
    keyDir: dir(160, 28), keyColor: C(0.9, 0.93, 1.0), keyIntensity: 1.1,
    hemiSky: C(0.75, 0.8, 0.88), hemiGround: C(0.32, 0.34, 0.37), hemiIntensity: 1.25,
    zenith: C(0.48, 0.52, 0.58), horizon: C(0.72, 0.76, 0.8), below: C(0.3, 0.33, 0.36),
    sun: 0, moon: 0, stars: 0, aurora: 0, clouds: 1, cloudColor: C(0.62, 0.66, 0.72),
    fogColor: C(0.6, 0.64, 0.69), fogGlow: C(0.12, 0.12, 0.1),
    fogDensity: 0.022, fogHaze: 0.0009, exposure: 0.65, env: 1.0, lamps: 0.25, snow: 0.6, seaState: 1.15,
  },
};

export const TIME_KEYS = Object.keys(TIMES);
