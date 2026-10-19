import * as THREE from 'three';

// The foam map: a top-down view of the sea round the boat (360 m square, following her), drawn
// each frame into a small texture the ocean reads (world/Ocean.js):
//   red    where ice meets the water: each piece of ice drawn with a material that keeps only a
//          thin slice at the waterline, so the foam rings follow each berg's real outline
//   green  the boat: churned white water at her stern, the wake spreading and fading behind her
//          (a ribbon along her track), the bow wave and the wash along her sides
// The texture is mipmapped; the ocean reads a blurred level as well, for soft halos.

const SIZE = 360, RES = 512;

const SLICE_VERT = /* glsl */ `
varying float vY;
void main(){
  vec4 w = vec4(position, 1.);
  #ifdef USE_INSTANCING
  w = instanceMatrix * w;
  #endif
  w = modelMatrix * w;
  vY = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SLICE_FRAG = /* glsl */ `
varying float vY;
void main(){
  if (abs(vY) > .55) discard;
  gl_FragColor = vec4(1., 0., 0., 1.);
}`;

export class Foam {
  constructor({ renderer, ice, boat, hull }) {
    this.renderer = renderer; this.ice = ice; this.boat = boat;
    this.rt = new THREE.WebGLRenderTarget(RES, RES, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-SIZE / 2, SIZE / 2, SIZE / 2, -SIZE / 2, -100, 100);
    this.cam.up.set(0, 0, -1);        // (looking down: +x right, -z up the texture... matched in Ocean.js)
    this.cam.lookAt(0, -1, 0);
    // the ice, sharing each instanced mesh's geometry and matrices
    const slice = new THREE.ShaderMaterial({ vertexShader: SLICE_VERT, fragmentShader: SLICE_FRAG, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    this.pairs = [];
    for (const map of [ice.meshes, ice.far]) {
      for (const im of map.values()) {
        const m = new THREE.InstancedMesh(im.geometry, slice, im.instanceMatrix.count);
        m.instanceMatrix = im.instanceMatrix; m.frustumCulled = false;
        this.scene.add(m); this.pairs.push([im, m]);
      }
    }
    // the wake: a ribbon along the trail, rebuilt each frame
    this.wakeMax = 96;
    const wg = new THREE.BufferGeometry();
    this.wPos = new Float32Array(this.wakeMax * 2 * 3); this.wCol = new Float32Array(this.wakeMax * 2 * 3);
    const idx = [];
    for (let i = 0; i < this.wakeMax - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    wg.setIndex(idx);
    wg.setAttribute('position', new THREE.BufferAttribute(this.wPos, 3).setUsage(THREE.DynamicDrawUsage));
    wg.setAttribute('color', new THREE.BufferAttribute(this.wCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.wake = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.wake.frustumCulled = false;
    this.scene.add(this.wake);
    // the hull's wash: a band round her waterline, brightest at the bow (in boat space)
    this.hull = this.hullBand(hull);
    this.scene.add(this.hull);
    this.center = new THREE.Vector2();
  }

  hullBand(h) {
    const pts = [];
    const n = h.hull.length;
    for (let i = 0; i < n; i++) { const z = h.hullZ[0] + (h.hullZ[1] - h.hullZ[0]) * (i / (n - 1)); pts.push([h.hull[i], z]); }
    const pos = [], col = [], idx = [];
    const ring = (s) => pts.map(([x, z], i) => [s * x, z, i]);
    for (const s of [1, -1]) {
      const base = pos.length / 3;
      for (const [x, z, i] of ring(s)) {
        const bow = 1 - i / (n - 1);
        const w = 1.2 + bow * 2.5;
        pos.push(x * 0.98, 0, z, x + s * w, 0, z - bow * 1.5);
        const k = 0.35 + bow * 0.65;
        col.push(0, k, 0, 0, 0, 0);
      }
      for (let i = 0; i < n - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    this.speedK = { value: 0 };
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, transparent: true, blending: THREE.AdditiveBlending }));
    m.frustumCulled = false;
    return m;
  }

  update() {
    const b = this.boat;
    // centred on the boat, snapped to whole texels (no crawling)
    const t = SIZE / RES;
    this.center.set(Math.round(b.x / t) * t, Math.round(b.z / t) * t);
    this.cam.position.set(this.center.x, 50, this.center.y);
    this.cam.updateMatrixWorld();
    for (const [im, m] of this.pairs) m.count = im.count;
    // the hull band rides with the boat (flat: just her heading)
    this.hull.position.set(b.x, 0, b.z); this.hull.rotation.set(0, b.heading, 0);
    this.hull.material.opacity = Math.min(1, 0.25 + b.speed / 5);
    // the wake: from the stern back along the trail; wider and fainter with age
    const tr = b.trail;
    const n = Math.min(tr.length, this.wakeMax);
    let k = 0;
    const sx = b.x - (-Math.sin(b.heading)) * 17, sz = b.z - (-Math.cos(b.heading)) * 17;
    const pts = [{ x: sx, z: sz, t: 0, speed: b.speed, hx: -Math.sin(b.heading), hz: -Math.cos(b.heading) }];
    for (let i = tr.length - 1; i >= 0 && pts.length < this.wakeMax; i--) pts.push(tr[i]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const nx = -p.hz, nz = p.hx;
      const w = 2.2 + p.t * 0.55;
      const s = Math.min(1, p.speed / 4) * Math.exp(-p.t / 45) * (i === 0 ? 1.2 : 1);
      this.wPos[k * 6] = p.x + nx * w; this.wPos[k * 6 + 1] = 0; this.wPos[k * 6 + 2] = p.z + nz * w;
      this.wPos[k * 6 + 3] = p.x - nx * w; this.wPos[k * 6 + 4] = 0; this.wPos[k * 6 + 5] = p.z - nz * w;
      this.wCol[k * 6 + 1] = s; this.wCol[k * 6 + 4] = s;
      k++;
    }
    for (let i = k; i < this.wakeMax; i++) { this.wPos.fill(0, i * 6, i * 6 + 6); this.wCol.fill(0, i * 6, i * 6 + 6); }
    this.wake.geometry.setDrawRange(0, Math.max(0, (k - 1) * 6));
    this.wake.geometry.attributes.position.needsUpdate = true;
    this.wake.geometry.attributes.color.needsUpdate = true;
    void n;
    const r = this.renderer, prev = r.getRenderTarget();
    const sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1); r.clear();
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.shadowMap.autoUpdate = sh;
  }

  get size() { return SIZE; }
}
