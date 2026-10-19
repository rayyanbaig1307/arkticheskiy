import * as THREE from 'three';

// The air: one set of uniforms shared by every shader (the objects themselves are shared, so one
// write reaches them all), and the fog.
//
// three's fog chunks are replaced (installAtmos, before any material compiles) with exponential
// HEIGHT fog over the sea: the thin sea smoke lying on the water, thinning upward, plus a haze at
// every height, drifting in slow banks with the wind. Its colour depends on where you look: the
// sky's horizon colour, brighter toward the moon or the sun, so the far ice dissolves into the sky.
// The sky (world/Sky.js), the sea (world/Ocean.js) and the snow use the same functions.

export const atmos = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3(-0.8, 0, 0.45) },      // xz: direction * strength (m/s / 10)
  uKeyDir: { value: new THREE.Vector3(0.4, 0.35, -0.8).normalize() },  // toward the moon or the sun
  uKeyColor: { value: new THREE.Color(0.6, 0.7, 0.9) },
  uFogColor: { value: new THREE.Color(0.02, 0.035, 0.06) },  // the horizon, looking away from the key
  uFogGlow: { value: new THREE.Color(0.05, 0.07, 0.1) },     // added looking toward the key
  uFogDensity: { value: 0.012 },     // at the water, per metre
  uFogHaze: { value: 0.0006 },       // everywhere, per metre
  uFogFalloff: { value: 0.09 },      // per metre upward
  uFogNoise: { value: 0.55 },        // how much the banks vary the density
  uAurora: { value: 1 },             // the aurora's strength (night only)
  uAuroraColor: { value: new THREE.Color(0.1, 1.0, 0.55) },
  uIndoor: { value: 0 },             // the camera is inside: the fog thins (rooms aren't foggy)
};

export const ATMOS_GLSL = /* glsl */ `
uniform float uTime, uFogDensity, uFogHaze, uFogFalloff, uFogNoise, uAurora, uIndoor;
uniform vec3 uWind, uKeyDir, uKeyColor, uFogColor, uFogGlow, uAuroraColor;
float aHash(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float aNoise(vec3 p){
  vec3 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(mix(aHash(i), aHash(i + vec3(1,0,0)), u.x), mix(aHash(i + vec3(0,1,0)), aHash(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(aHash(i + vec3(0,0,1)), aHash(i + vec3(1,0,1)), u.x), mix(aHash(i + vec3(0,1,1)), aHash(i + vec3(1,1,1)), u.x), u.y), u.z);
}
// optical depth from the camera to world point w
float fogDepth(vec3 w){
  vec3 rd = w - cameraPosition; float dist = length(rd);
  float k = uFogFalloff, h0 = max(cameraPosition.y, 0.);
  float dy = rd.y;
  float hk = abs(dy * k) > 1e-3 ? (1. - exp(-dy * k)) / (dy * k) : 1.;
  float od = uFogDensity * exp(-h0 * k) * hk * dist + uFogHaze * dist;
  // banks: sampled partway out along the ray (stable as you turn), drifting downwind
  vec3 q = cameraPosition + rd * min(1., 60. / max(dist, 1e-3)) * .7;
  float n = aNoise(q * .021 - uWind * uTime * .06) * .65 + aNoise(q * .057 + vec3(0., uTime * .015, 0.)) * .35;
  od *= mix(1., .3 + 1.4 * n, uFogNoise);
  return od * mix(1., .25, uIndoor);
}
vec3 fogTint(vec3 rd){
  float toKey = max(dot(rd, uKeyDir), 0.);
  return uFogColor + uFogGlow * (pow(toKey, 4.) * .7 + pow(toKey, 32.) * .8);
}
vec3 applyFog(vec3 col, vec3 w){
  float od = fogDepth(w);
  return mix(col, fogTint(normalize(w - cameraPosition)), 1. - exp(-od));
}
`;

// hand the shared uniforms to a compiling shader
export function withAtmos(shader) { Object.assign(shader.uniforms, atmos); }

let installed = false;
export function installAtmos() {
  if (installed) return; installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogWorld;\n#endif\n';
  // the vertex's world position from its view-space position (every shader with mvPosition)
  C.fog_vertex = '#ifdef USE_FOG\n vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n#endif\n';
  C.fog_pars_fragment = '#ifdef USE_FOG\n varying vec3 vFogWorld;\n' + ATMOS_GLSL + '#endif\n';
  C.fog_fragment = '#ifdef USE_FOG\n gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogWorld);\n#endif\n';
  // three clones a built-in material's uniforms per program, so the shared ones are handed over as
  // each program is built (patched materials chain onto this through chainCompile)
  THREE.Material.prototype.onBeforeCompile = function (shader) { Object.assign(shader.uniforms, atmos); };
}

// add a shader patch to a material without losing one already there (CSM's, the atmosphere's)
export function chainCompile(material, fn, key = '') {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    fn(shader, renderer);
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => prevKey() + '|' + key;
  material.needsUpdate = true;
}
