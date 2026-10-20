import * as THREE from 'three';

// The weapon effects' textures, drawn once at start-up into plain byte arrays (no canvas, so they
// work anywhere, tests included): a particle atlas (a soft puff, a hard dot, a hot spark, a
// billowing smoke puff), the muzzle flash seen from behind (a star) and from the side (a flame
// tongue), a flare's glow, and the bullet-hole atlas the decals multiply into what they hit
// (metal, concrete, wood, ice). White in a hole texture means "leave the surface as it is".

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// value noise in [0, 1], tileable enough for small sprites
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const fbm = (x, y) => noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15;
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// fill a size x size RGBA texture (or one tile of an atlas): fn(u, v, out) with u, v in -1..1
function paint(data, stride, ox, oy, size, fn) {
  const o = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1, o);
      const i = ((oy + y) * stride + ox + x) * 4;
      data[i] = sat(o[0]) * 255; data[i + 1] = sat(o[1]) * 255; data[i + 2] = sat(o[2]) * 255; data[i + 3] = sat(o[3]) * 255;
    }
  }
}

function texture(data, size, srgb = false) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// tiles: 0 soft puff (snow, dust, mist), 1 hard dot (chips, droplets), 2 spark, 3 smoke
function makeAtlas() {
  const T = 64, S = T * 2, data = new Uint8Array(S * S * 4);
  paint(data, S, 0, 0, T, (u, v, o) => {
    const r = Math.hypot(u, v), n = fbm(u * 2.5 + 3, v * 2.5 + 7);
    o[0] = o[1] = o[2] = 1; o[3] = Math.pow(sat(1 - r), 1.6) * (0.65 + 0.35 * n);
  });
  paint(data, S, T, 0, T, (u, v, o) => {
    const r = Math.hypot(u * (1 + 0.25 * noise(u * 3, v * 3)), v);
    o[0] = o[1] = o[2] = 1; o[3] = 1 - sstep(0.45, 0.7, r);
  });
  paint(data, S, 0, T, T, (u, v, o) => {
    const r = Math.hypot(u, v);
    o[0] = o[1] = o[2] = 1; o[3] = Math.exp(-r * r * 14) + 0.25 * Math.exp(-r * r * 3);
  });
  paint(data, S, T, T, T, (u, v, o) => {
    const r = Math.hypot(u, v), n = fbm(u * 1.8 + 11, v * 1.8 + 5);
    const edge = sat(1 - r * (0.85 + 0.45 * n));
    o[0] = o[1] = o[2] = 0.75 + 0.25 * n; o[3] = Math.pow(edge, 1.2) * (0.5 + 0.5 * n);
  });
  return texture(data, S);
}

// the flash from behind: a hot core with five to eight uneven prongs
function makeFlashStar() {
  const S = 64, data = new Uint8Array(S * S * 4);
  const prong = [1, 0.6, 0.9, 0.5, 0.95, 0.7, 0.8];
  paint(data, S, 0, 0, S, (u, v, o) => {
    const r = Math.hypot(u, v), a = Math.atan2(v, u);
    const k = ((a / (Math.PI * 2) + 1) * prong.length) % prong.length, i = Math.floor(k), f = k - i;
    const len = prong[i] * (1 - f) + prong[(i + 1) % prong.length] * f;
    const ray = Math.pow(Math.abs(Math.cos(a * prong.length * 0.5)), 6) * sat(1 - r / len);
    const core = Math.exp(-r * r * 9);
    const lum = sat(core * 1.2 + ray);
    o[0] = 1; o[1] = 0.55 + 0.45 * core; o[2] = 0.2 + 0.6 * core; o[3] = lum;
  });
  return texture(data, S);
}

// the flash from the side: a tongue of flame along +u, ragged at the tip
function makeFlashSide() {
  const S = 64, data = new Uint8Array(S * S * 4);
  paint(data, S, 0, 0, S, (u, v, o) => {
    const t = (u + 1) * 0.5;                                 // 0 at the muzzle, 1 at the tip
    const w = 0.55 * (1 - t) * (0.6 + 0.4 * noise(t * 9, 3)) + 0.06;
    const body = sat(1 - Math.abs(v) / w) * sat(1 - t * (0.9 + 0.3 * noise(v * 6, t * 4)));
    const core = Math.exp(-v * v * 40) * (1 - t);
    o[0] = 1; o[1] = 0.5 + 0.4 * core; o[2] = 0.15 + 0.5 * core; o[3] = sat(body * 0.9 + core);
  });
  return texture(data, S);
}

// a flare's glow: a white-hot point in a wide red halo (colour comes from the material)
function makeGlow() {
  const S = 64, data = new Uint8Array(S * S * 4);
  paint(data, S, 0, 0, S, (u, v, o) => {
    const r = Math.hypot(u, v);
    o[0] = o[1] = o[2] = 1; o[3] = sat(Math.exp(-r * r * 30) * 1.2 + Math.exp(-r * r * 4) * 0.45 + Math.pow(sat(1 - r), 3) * 0.2);
  });
  return texture(data, S);
}

// bullet holes, multiplied into the surface: 0 metal, 1 concrete, 2 wood, 3 ice
function makeHoles() {
  const T = 64, S = T * 2, data = new Uint8Array(S * S * 4);
  const tiles = [
    (u, v, o) => {                 // metal: a clean dark hole, a bright-scuffed ring, a soot ring
      const r = Math.hypot(u, v);
      const c = r < 0.16 ? 0.04 : r < 0.24 ? 0.75 : 1 - 0.45 * Math.exp(-((r - 0.32) ** 2) * 60) * (0.6 + 0.4 * noise(u * 8, v * 8));
      o[0] = o[1] = o[2] = c; o[3] = 1 - sstep(0.75, 0.98, r);
    },
    (u, v, o) => {                 // concrete: a ragged crater of chipped grey
      const n = noise(u * 5 + 2, v * 5 + 9), r = Math.hypot(u, v) * (0.8 + 0.4 * n);
      const c = r < 0.18 ? 0.1 : r < 0.6 ? 0.55 + 0.35 * sstep(0.18, 0.6, r) + 0.1 * n : 1;
      o[0] = o[1] = o[2] = c; o[3] = 1 - sstep(0.6, 0.9, r);
    },
    (u, v, o) => {                 // wood: a dark hole and splintered grain along v
      const n = noise(u * 3, v * 14), r = Math.hypot(u * 1.4, v * 0.8);
      const c = r < 0.14 ? 0.05 : 0.45 + 0.55 * sstep(0.14, 0.75, r * (0.75 + 0.5 * n));
      o[0] = c; o[1] = c * 0.92; o[2] = c * 0.85; o[3] = 1 - sstep(0.7, 0.95, r);
    },
    (u, v, o) => {                 // ice: a white-starred bruise; cracks darken a little
      const r = Math.hypot(u, v), a = Math.atan2(v, u);
      const crack = Math.pow(Math.abs(Math.sin(a * 3.5 + noise(r * 6, a) * 2)), 30) * sat(1 - r);
      const c = r < 0.1 ? 0.35 : 1 - 0.35 * crack - 0.25 * Math.exp(-r * r * 12);
      o[0] = c; o[1] = c; o[2] = Math.min(1, c * 1.05); o[3] = 1 - sstep(0.8, 1, r);
    },
  ];
  tiles.forEach((fn, i) => paint(data, S, (i % 2) * T, Math.floor(i / 2) * T, T, fn));
  return texture(data, S);
}

let cache = null;
export function weaponTextures() {
  if (!cache) cache = { atlas: makeAtlas(), flashStar: makeFlashStar(), flashSide: makeFlashSide(), glow: makeGlow(), holes: makeHoles() };
  return cache;
}
