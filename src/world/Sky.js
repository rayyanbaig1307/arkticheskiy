import * as THREE from 'three';
import { atmos, ATMOS_GLSL } from './Atmos.js';
import { TIMES } from './TimeOfDay.js';

// The sky dome: the gradient, the stars, the moon (or the sun), cloud, and the aurora: green
// curtains with violet tops, folding slowly across the north. It is drawn behind everything,
// follows the camera, and is also rendered into a small cube map for the PBR lighting (a
// prefiltered environment, so the ice and the paint pick up the aurora's green) and for the
// sea's reflections beyond the planar render.

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uBelow, uCloudColor;
uniform float uSun, uMoon, uStars, uClouds, uEnvPass;
${ATMOS_GLSL}

float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.03 + 17.1; a *= .5; } return s; }

// stars: one per lit cell of a grid on the sphere, sized to stay a soft point at any resolution
vec3 starLayer(vec3 d, float scale, float density, float bright){
  vec3 p = d * scale; vec3 id = floor(p); vec3 f = fract(p) - .5;
  float h = aHash(id);
  if (h < 1. - density) return vec3(0.);
  vec3 off = vec3(aHash(id + 1.3), aHash(id + 2.7), aHash(id + 5.1)) - .5;
  float r = length(f - off * .7);
  float px = fwidth(p.x) + fwidth(p.y);
  float core = smoothstep(px * 1.2, 0., r);
  float tw = .65 + .35 * sin(uTime * (2. + h * 9.) + h * 40.);
  float temp = aHash(id + 9.1);
  vec3 tint = mix(vec3(.75, .85, 1.1), vec3(1.1, .95, .8), temp);
  return tint * core * bright * pow(aHash(id + 3.3), 3.) * tw;
}

float fbmN(vec2 p, int oct){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ if (i >= oct) break; s += a * n2(p); p = p * 2.03 + 17.1; a *= .5; } return s; }

// the aurora: thin ribbons along one contour of a slowly folding 2D field, lit only along some
// stretches, projected up through stacked layers (the same pattern at each height makes hanging
// curtains in perspective): bright at the lower edge, fading upward from green to violet, with
// vertical rays running through them
float curtain(vec2 p, float t){
  vec2 w = vec2(fbmN(p * .3 + vec2(t * .015, 0.), 2), fbmN(p * .3 + vec2(5.2, t * .012), 2));
  float f = fbmN(p * .24 + w * 1.9 + vec2(t * .006, -t * .004), 3);
  float band = exp(-abs(f - .44) * 26.) + .7 * exp(-abs(f - .31) * 34.) + .4 * exp(-abs(f - .55) * 40.);
  float lit = smoothstep(.14, .46, fbmN(p * .08 + vec2(t * .004, 1.7), 2));
  float r = n2(vec2((p.x - p.y) * 6. + t * .45, t * .12));
  float rays = .2 + .8 * r * r + .3 * n2(vec2((p.x - p.y) * 17., t * .3));
  return band * lit * rays;
}
vec3 aurora(vec3 d){
  if (d.y < .02 || uAurora < .01) return vec3(0.);
  vec3 acc = vec3(0.);
  float t = uTime;
  for (int i = 0; i < AURORA_STEPS; i++){
    float fi = float(i) / float(AURORA_STEPS);
    float h = 1. + fi * 1.6;
    vec2 p = d.xz / (d.y + .05) * h * 1.15 + vec2(-4., 9.);
    float c = curtain(p, t);
    vec3 col = mix(uAuroraColor, vec3(.5, .18, .95), smoothstep(.3, 1., fi));
    acc += col * c * exp(-fi * 2.2);
  }
  acc *= 3.4 / float(AURORA_STEPS);
  // to the north (-z) mostly, rising from low over the horizon, gone overhead
  float north = .2 + .8 * smoothstep(-.35, .55, -d.z);
  return acc * uAurora * north * smoothstep(.03, .2, d.y) * (1. - smoothstep(.55, .95, d.y));
}

void main(){
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.);
  vec3 c = mix(uHorizon, uZenith, pow(up, .42));
  c = mix(c, uBelow, smoothstep(0., -.12, d.y));
  float toKey = max(dot(d, uKeyDir), 0.);
  // the sun: a hot disc, a wide warm glow along the horizon
  if (uSun > 0.){
    float a = acos(min(toKey, 1.));
    c += uKeyColor * uSun * (smoothstep(.0125, .011, a) * 60. + exp(-a * 9.) * .9 + exp(-a * 2.2) * .35) * smoothstep(-.03, .01, d.y);
  }
  // the moon: a disc with dark seas and a darker limb, and a cold halo
  if (uMoon > 0.){
    vec3 m = uKeyDir;
    float a = acos(min(toKey, 1.));
    vec3 ax = normalize(cross(m, vec3(0., 1., 0.))), ay = cross(ax, m);
    vec2 q = vec2(dot(d, ax), dot(d, ay)) / .0115;
    float disc = smoothstep(1.04, .96, length(q));
    float maria = fbm2(q * 1.4 + 3.) * .55 + fbm2(q * 4. + 9.) * .2;
    float limb = sqrt(max(0., 1. - dot(q, q)));
    float face = (1.15 - smoothstep(.45, .75, maria) * .45) * (.55 + .45 * limb);
    c += vec3(1., .97, .9) * disc * face * 9. * uMoon;
    c += uKeyColor * uMoon * (exp(-a * 38.) * .45 + exp(-a * 6.) * .07);
  }
  // cloud: thin wisps at night, a full grey deck when overcast
  float cl = 0.;
  if (uClouds > 0. && d.y > 0.){
    vec2 cp = d.xz / (d.y + .12) * 1.1 + uWind.xz * uTime * .004;
    float n = fbm2(cp * 1.3) * .7 + fbm2(cp * 3.7 + 7.) * .3;
    cl = smoothstep(.62 - uClouds * .45, .95 - uClouds * .3, n) * smoothstep(0., .08, d.y);
    cl = mix(cl, max(cl, .85 + n * .15), smoothstep(.8, 1., uClouds));
  }
  if (uStars > 0.){
    vec3 s = starLayer(d, 240., .05, 3.) + starLayer(d, 560., .12, 1.2) + starLayer(d, 90., .012, 6.);
    // the Milky Way: a faint dusty band of dense stars
    float band = exp(-pow(dot(d, normalize(vec3(.35, .75, .55))) * 4.5, 2.));
    s += starLayer(d, 900., .2 * band, 1.) + vec3(.02, .025, .035) * band * fbm2(d.xz * 9. + d.y * 3.);
    c += s * uStars * smoothstep(-.02, .2, d.y) * (1. - cl);
  }
  vec3 au = aurora(d);
  c += au * (1. - cl * .8);
  // cloud lit by the key from behind, and by the aurora from below
  vec3 cloudCol = uCloudColor * (.8 + pow(toKey, 6.) * 1.5) + au * .35;
  c = mix(c, cloudCol, cl);
  // the horizon: where the far fog meets the sky
  float hz = exp(-max(d.y, 0.) * 9.) * (1. - uEnvPass * .2);
  c = mix(c, fogTint(d), hz * .85);
  gl_FragColor = vec4(c, 1.);
}`;

export class Sky {
  constructor({ renderer, quality }) {
    this.renderer = renderer;
    this.uniforms = {
      ...atmos,
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBelow: { value: new THREE.Color() },
      uCloudColor: { value: new THREE.Color() },
      uSun: { value: 0 }, uMoon: { value: 1 }, uStars: { value: 1 }, uClouds: { value: 0 }, uEnvPass: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: { AURORA_STEPS: quality.auroraSteps },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'Sky';

    // the environment: the sky alone, into a cube, prefiltered for PBR
    this.envScene = new THREE.Scene();
    const envMat = this.material.clone();
    envMat.uniforms = { ...this.uniforms, uEnvPass: { value: 1 }, uAurora: { value: 0 } };
    this.envAurora = envMat.uniforms.uAurora;
    envMat.defines = { AURORA_STEPS: Math.max(6, quality.auroraSteps >> 1) };
    this.envMesh = new THREE.Mesh(this.mesh.geometry, envMat);
    this.envScene.add(this.envMesh);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(quality.envSize, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 2000, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envTimer = 0;

    this.preset = null; this.target = null;
    this.cur = null;
  }

  // blend toward a preset (instant: jump)
  setTime(key, instant = false) {
    const p = TIMES[key] || TIMES.night;
    this.key = key;
    if (!this.cur || instant) this.cur = cloneP(p);
    this.target = p;
    this.envTimer = 0;
  }

  get params() { return this.cur; }

  update(dt, camera) {
    this.mesh.position.copy(camera.position);
    if (!this.cur) return;
    const k = 1 - Math.exp(-dt * 0.8);
    blendP(this.cur, this.target, k);
    const c = this.cur, u = this.uniforms;
    u.uZenith.value.copy(c.zenith); u.uHorizon.value.copy(c.horizon); u.uBelow.value.copy(c.below);
    u.uCloudColor.value.copy(c.cloudColor);
    u.uSun.value = c.sun; u.uMoon.value = c.moon; u.uStars.value = c.stars; u.uClouds.value = c.clouds;
    atmos.uKeyDir.value.copy(c.keyDir).normalize();
    atmos.uKeyColor.value.copy(c.keyColor);
    atmos.uFogColor.value.copy(c.fogColor);
    atmos.uFogGlow.value.copy(c.fogGlow);
    atmos.uFogDensity.value = c.fogDensity;
    atmos.uFogHaze.value = c.fogHaze;
    atmos.uAurora.value = c.aurora;
    if (this.envAurora) this.envAurora.value = c.aurora * 0.3;
  }

  // the environment map, every couple of seconds (and at once after a change of time)
  updateEnv(scene, dt) {
    this.envTimer -= dt;
    if (this.envTimer > 0) return;
    this.envTimer = 2.5;
    this.cubeCam.update(this.renderer, this.envScene);
    const old = this.envRT;
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, old || undefined);
    scene.environment = this.envRT.texture;
  }

  get reflectionCube() { return this.cubeRT.texture; }
}

const KEYS_C = ['keyColor', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'below', 'cloudColor', 'fogColor', 'fogGlow'];
const KEYS_N = ['keyIntensity', 'hemiIntensity', 'sun', 'moon', 'stars', 'aurora', 'clouds', 'fogDensity', 'fogHaze', 'exposure', 'env', 'lamps', 'snow', 'seaState'];
function cloneP(p) {
  const o = { keyDir: p.keyDir.clone() };
  for (const k of KEYS_C) o[k] = p[k].clone();
  for (const k of KEYS_N) o[k] = p[k];
  return o;
}
function blendP(o, p, k) {
  o.keyDir.lerp(p.keyDir, k).normalize();
  for (const kk of KEYS_C) o[kk].lerp(p[kk], k);
  for (const kk of KEYS_N) o[kk] += (p[kk] - o[kk]) * k;
}
