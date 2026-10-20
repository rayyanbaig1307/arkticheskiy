import * as THREE from 'three';
import { chainCompile } from '../world/Atmos.js';

// Shell fur for a skinned coat (the polar bear: tools/blender/make_bear.py). The coat is drawn
// again N times, each copy pushed out along the skinned normals a little further and cut away
// where a strand map says there is no hair at that height: near the skin almost everything is
// hair, at the tips only a few strands. The model's vertex colours say how long the fur is
// (r: long on the legs' backs and the belly, short on the face, none on the pads) and where the
// bear has been feeding (g: blood, scaled by `blood`).
//
// The patches chain after whatever the material already has (Lighting.prep's shadows and fog),
// and each shell is prepped the same way, so the fur takes the cascades' shadows and the fog.
//
//   const fur = new Fur(coatMesh, { shells: 8, length: 0.06, lighting }); fur.blood = 0.8; fur.update(cameraDistance, dt)

let STRANDS = null;
function strandMap() {
  if (STRANDS) return STRANDS;
  const N = 64, d = new Uint8Array(N * N * 4);
  // one value per hair: how far up the shells that hair reaches (most short, some long guard hairs)
  for (let i = 0; i < N * N; i++) {
    const r = Math.random();
    const v = Math.pow(r, 0.65) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  STRANDS = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  STRANDS.wrapS = STRANDS.wrapT = THREE.RepeatWrapping;
  STRANDS.magFilter = THREE.LinearFilter; STRANDS.minFilter = THREE.LinearMipmapLinearFilter;
  STRANDS.generateMipmaps = true; STRANDS.needsUpdate = true;
  return STRANDS;
}

// the coat itself: the blood from the vertex colours, nothing else changed
export function coatBlood(material, uniforms) {
  material.vertexColors = false;
  chainCompile(material, (sh) => {
    sh.uniforms.uFurBlood = uniforms.uFurBlood;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 furc;\nvarying vec2 vFur;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFur = furc.rg;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFurBlood;\nvarying vec2 vFur;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.05, 0.04), clamp(vFur.y * uFurBlood, 0.0, 1.0));');
  }, 'coatBlood');
}

export class Fur {
  constructor(coat, { shells = 8, length = 0.065, density = 14, lighting = null } = {}) {
    this.coat = coat;
    this.shells = [];
    this.uniforms = { uFurBlood: { value: 0 }, uFurLen: { value: length }, uFurT: { value: 0 } };
    const geo = coat.geometry;
    if (geo.attributes.color && !geo.attributes.furc) geo.setAttribute('furc', geo.attributes.color);
    const base = coat.material;
    for (let i = 1; i <= shells; i++) {
      const h = i / shells;
      // (a clone has none of the base's shader hooks: prepped afresh, then the fur on top)
      const m = base.clone();
      m.vertexColors = false;
      m.normalMap = null;                     // (strands catch the light by themselves)
      m.roughness = 1; m.metalness = 0;
      m.side = THREE.FrontSide;
      m.envMapIntensity = (base.envMapIntensity ?? 1) * 0.6;
      lighting?.prep(m);
      chainCompile(m, (sh) => this.patch(sh, h, density), 'fur' + i);
      const s = new THREE.SkinnedMesh(geo, m);
      s.bind(coat.skeleton, coat.bindMatrix);
      s.bindMode = coat.bindMode;
      s.castShadow = false; s.receiveShadow = true;
      s.frustumCulled = false;
      s.renderOrder = 1;
      s.name = coat.name + '_fur' + i;
      s.layers.mask = coat.layers.mask;
      coat.parent.add(s);
      s.position.copy(coat.position); s.quaternion.copy(coat.quaternion); s.scale.copy(coat.scale);
      this.shells.push(s);
    }
    coatBlood(base, this.uniforms);
    this.count = shells;
    this.shown = -1;
  }

  get blood() { return this.uniforms.uFurBlood.value; }
  set blood(v) { this.uniforms.uFurBlood.value = v; }

  patch(sh, h, density) {
    sh.uniforms.uFurBlood = this.uniforms.uFurBlood;
    sh.uniforms.uFurLen = this.uniforms.uFurLen;
    sh.uniforms.uFurT = this.uniforms.uFurT;
    sh.uniforms.uFurStrands = { value: strandMap() };
    sh.uniforms.uFurH = { value: h };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 furc;\nuniform float uFurLen, uFurH, uFurT;\nvarying vec2 vFur;\nvarying vec2 vFurUv;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        vFur = furc.rg;
        float fl = uFurLen * furc.r;
        transformed += normalize(objectNormal) * fl * uFurH;
        transformed.y -= fl * uFurH * uFurH * 0.35;                  // (the tips droop)
        transformed.x += sin(uFurT * 1.7 + position.y * 9.0) * fl * uFurH * uFurH * 0.08;   // (a breath of wind)
        vFurUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uFurStrands; uniform float uFurH, uFurBlood;
        varying vec2 vFur; varying vec2 vFurUv;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float strand = texture2D(uFurStrands, vFurUv * ${density.toFixed(1)}).r;
        if (vFur.x < 0.04 || strand < uFurH * 0.92 + 0.04) discard;
        diffuseColor.rgb *= mix(0.62, 1.08, uFurH);              // (darker down among the roots, the tips catching light)
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.05, 0.04), clamp(vFur.y * uFurBlood * (1.0 - uFurH * 0.5), 0.0, 1.0));`);
  }

  // fewer shells further off, none past 30 m
  update(dist, dt = 0) {
    this.uniforms.uFurT.value += dt;
    const want = dist < 9 ? this.count : dist < 18 ? Math.ceil(this.count * 0.5) : dist < 30 ? 2 : 0;
    if (want === this.shown) return;
    this.shown = want;
    for (let i = 0; i < this.shells.length; i++) {
      // (keep the outermost of the shells that are shown, spread over the length)
      const s = this.shells[i];
      s.visible = want > 0 && (want >= this.count || (i + 1) % Math.max(1, Math.round(this.count / want)) === 0);
    }
  }

  dispose() { for (const s of this.shells) { s.parent?.remove(s); s.material.dispose(); } this.shells = []; }
}
