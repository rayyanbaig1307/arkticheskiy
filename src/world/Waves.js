// The sea's waves: a sum of Gerstner (trochoidal) waves, evaluated the same way on the GPU (the
// ocean's vertices and per-pixel normals) and on the CPU (the boat's heave, pitch and roll, the
// floes bobbing, the foam on the ice), so everything rides the same water.
//
// Inside the ice field the sea is calm: a long low swell from the open water to the west, and a
// little wind chop on top. Each wave: direction (degrees), wavelength (m), amplitude (m), and its
// share of the steepness budget. Phase speed follows deep-water dispersion (w = sqrt(g k)).

const G = 9.81;
const SET = [
  //  dir   L     A      Q
  [  18,  96,  0.42,  0.5 ],
  [ -14,  61,  0.28,  0.6 ],
  [  47,  38,  0.15,  0.7 ],
  [ -38,  23,  0.085, 0.8 ],
  [  71,  13.5, 0.05, 0.9 ],
  [  -2,   8.4, 0.03, 0.9 ],
  [  33,   5.1, 0.016, 1.0 ],
  [ -61,   3.3, 0.009, 1.0 ],
];

export const MAX_WAVES = 8;

export class Waves {
  constructor(count = 8) {
    this.count = Math.min(count, MAX_WAVES);
    this.scale = 1;          // overall sea state (amplitude)
    this.time = 0;
    this.list = SET.slice(0, this.count).map(([deg, L, A, q], i) => {
      const a = (deg * Math.PI) / 180;
      const k = (2 * Math.PI) / L;
      return { dx: Math.cos(a), dz: Math.sin(a), k, A, q, w: Math.sqrt(G * k), phase: i * 1.7, L };
    });
    // steepness: the sum of Q k A stays under 0.75 (no loops, sharp but believable crests)
    const s = this.list.reduce((acc, w) => acc + w.q * w.k * w.A, 0);
    const norm = Math.min(1, 0.75 / s);
    for (const w of this.list) w.Q = w.q * norm;
    this.uA = this.list.map((w) => [w.dx, w.dz, w.k, w.A]).flat();
    this.uB = this.list.map((w) => [w.Q, w.w, w.phase, w.L]).flat();
    while (this.uA.length < MAX_WAVES * 4) { this.uA.push(0, 0, 0, 0); this.uB.push(0, 0, 0, 1); }
    // (a flat Float32Array goes straight to uniform4fv for a vec4[] uniform)
    this.uniforms = {
      uWaveA: { value: new Float32Array(this.uA) },
      uWaveB: { value: new Float32Array(this.uB) },
      uWaveTime: { value: 0 },
      uWaveScale: { value: 1 },
    };
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uWaveTime.value = this.time;
    this.uniforms.uWaveScale.value = this.scale;
  }

  // the displaced point of the undisturbed surface point (x, z): out = [dx, y, dz]
  displace(x, z, out, t = this.time) {
    let dx = 0, dy = 0, dz = 0;
    const s = this.scale;
    for (const w of this.list) {
      const f = w.k * (w.dx * x + w.dz * z) - w.w * t + w.phase;
      const c = Math.cos(f), sn = Math.sin(f), QA = w.Q * w.A * s;
      dx += QA * w.dx * c; dz += QA * w.dz * c; dy += w.A * s * sn;
    }
    out[0] = dx; out[1] = dy; out[2] = dz;
    return out;
  }

  // the water's height at world (x, z): the surface point that lands there, found by iteration
  heightAt(x, z, t = this.time) {
    const o = this._o || (this._o = [0, 0, 0]);
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) {
      this.displace(px, pz, o, t);
      px = x - o[0]; pz = z - o[2];
    }
    this.displace(px, pz, o, t);
    return o[1];
  }
}

// GLSL: the same sum. gerstner() returns the displacement of surface point p and its normal;
// waves shorter than the fade distance allows are dropped (they would only alias out there).
export const WAVES_GLSL = /* glsl */ `
uniform vec4 uWaveA[${MAX_WAVES}];   // dir.x, dir.z, k, A
uniform vec4 uWaveB[${MAX_WAVES}];   // Q, omega, phase, L
uniform float uWaveTime, uWaveScale;

// dist: from the camera (each wave fades out by the time it is ~60 wavelengths away)
vec3 gerstner(vec2 p, float dist, out vec3 N, out float fold){
  vec3 d = vec3(0.);
  vec3 tx = vec3(1., 0., 0.), tz = vec3(0., 0., 1.);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 a = uWaveA[i]; vec4 b = uWaveB[i];
    float fade = 1. - smoothstep(b.w * 25., b.w * 70., dist);
    float A = a.w * uWaveScale * fade;
    if (A <= 0.) continue;
    float f = a.z * dot(a.xy, p) - b.y * uWaveTime + b.z;
    float s = sin(f), c = cos(f);
    float QA = b.x * A;
    d += vec3(QA * a.x * c, A * s, QA * a.y * c);
    float WA = a.z * A;
    tx += vec3(-b.x * WA * a.x * a.x * s, WA * a.x * c, -b.x * WA * a.x * a.y * s);
    tz += vec3(-b.x * WA * a.x * a.y * s, WA * a.y * c, -b.x * WA * a.y * a.y * s);
  }
  N = normalize(cross(tz, tx));
  fold = tx.x * tz.z - tx.z * tz.x;      // the Jacobian: under ~0.5 the crest is folding over (foam)
  return d;
}
`;
