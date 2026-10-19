import * as THREE from 'three';
import { chainCompile } from './Atmos.js';
import { WAVES_GLSL } from './Waves.js';

// Ice that reads as ice. On top of a standard PBR material (the shadows and the sky's light still
// apply):
//   - vertex colours from Blender: r = snow lying on it, g = cracks and dense old ice, b = cavity
//   - light scattered inside: the ice glows blue from within where it's thin (edges, cracks,
//     facing away from the key light), stronger in the cracks, so a berg in shadow still reads
//     as luminous blue rather than grey
//   - wet at the waterline: darker, glossy, with a ragged line of foam where the swell washes it;
//     the waterline is the real wave height at that point (the same Gerstner sum as the sea)

export function makeIceMaterial(lighting, waves) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0, vertexColors: true, envMapIntensity: 1.0 });
  m.name = 'Ice';
  lighting.prep(m);
  const u = { ...waves.uniforms, uIceGlow: { value: new THREE.Color(0.08, 0.42, 0.78) }, uIceAmb: { value: 1 } };
  m.userData.iceUniforms = u;
  chainCompile(m, (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIceWorld;\nvarying vec3 vIceN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 iw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          iw = instanceMatrix * iw;
          #endif
          vIceWorld = (modelMatrix * iw).xyz;
          vec3 inrm = objectNormal;
          #ifdef USE_INSTANCING
          inrm = mat3(instanceMatrix) * inrm;
          #endif
          vIceN = normalize(mat3(modelMatrix) * inrm);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vIceWorld;
        varying vec3 vIceN;
        uniform vec3 uIceGlow;
        uniform float uIceAmb;
        ${WAVES_GLSL}
        float iceH(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float iceN(vec3 p){ vec3 i = floor(p), f = fract(p), w = f * f * (3. - 2. * f);
          return mix(mix(mix(iceH(i), iceH(i + vec3(1,0,0)), w.x), mix(iceH(i + vec3(0,1,0)), iceH(i + vec3(1,1,0)), w.x), w.y),
                     mix(mix(iceH(i + vec3(0,0,1)), iceH(i + vec3(1,0,1)), w.x), mix(iceH(i + vec3(0,1,1)), iceH(i + vec3(1,1,1)), w.x), w.y), w.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float snow = vColor.r, crack = vColor.g, cav = vColor.b;
        float grain = iceN(vIceWorld * 2.3) * .6 + iceN(vIceWorld * 7.1) * .4;
        // the waterline: height above the wave at this point
        vec3 wN; float wF;
        float dist = length(vIceWorld.xz - cameraPosition.xz);
        float wave = gerstner(vIceWorld.xz, dist, wN, wF).y;
        float above = vIceWorld.y - wave;
        float wet = 1. - smoothstep(.0, .9 + grain * .4, above);
        vec3 iceCol = mix(vec3(.74, .85, .91), vec3(.88, .93, .96), grain);
        iceCol = mix(iceCol, uIceGlow * .9 + .18, crack * .5);
        vec3 snowCol = vec3(.9, .93, .96) * (.93 + grain * .07);
        diffuseColor.rgb = mix(iceCol, snowCol, snow * (1. - wet));
        diffuseColor.rgb *= mix(1., .55, wet) * mix(1., .72, cav);
        float foamLine = smoothstep(.35, .0, abs(above - .12 - grain * .25)) * step(-.3, above);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.93, .96, 1.), foamLine * .8 * smoothstep(.45, .7, iceN(vIceWorld * vec3(3., 9., 3.) + vec3(0., uWaveTime * .6, 0.))));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(.28 + grain * .2, .85, snow), .08, wet);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // the snow's surface: wind ripples (sastrugi) and grain, a little relief in the light
          vec3 sp = vIceWorld;
          float se = .06;
          float h0 = iceN(vec3(sp.x * .55, 0., sp.z * 1.9)) * .7 + iceN(sp * 4.3) * .3;
          float hx = iceN(vec3((sp.x + se) * .55, 0., sp.z * 1.9)) * .7 + iceN((sp + vec3(se, 0., 0.)) * 4.3) * .3;
          float hz = iceN(vec3(sp.x * .55, 0., (sp.z + se) * 1.9)) * .7 + iceN((sp + vec3(0., 0., se)) * 4.3) * .3;
          vec3 bw = vec3(h0 - hx, 0., h0 - hz) / se * .05 * snow * (1. - wet);
          normal = normalize(normal + (viewMatrix * vec4(bw, 0.)).xyz);
        }`)
      .replace('#include <opaque_fragment>', `
        {
          // light scattered inside the ice: from the sky (all round) and the key light (wrapped
          // round to the far side: thin edges glow when back-lit)
          vec3 Vw = normalize(cameraPosition - vIceWorld);
          float thin = pow(1. - abs(dot(normalize(vIceN), Vw)), 2.) * .5 + crack * .5 + .1;
          float back = pow(max(dot(-Vw, uKeyDir), 0.), 4.) * .8 + max(dot(-normalize(vIceN), uKeyDir) * .5 + .5, 0.) * .4;
          vec3 inner = uIceGlow * (uKeyColor * back * .3 + vec3(.06, .09, .13) * uIceAmb * 1.6) * thin * (1. - snow * .8) * (1. - wet * .6);
          outgoingLight += inner;
        }
        #include <opaque_fragment>`);
  }, 'ice');
  return m;
}
