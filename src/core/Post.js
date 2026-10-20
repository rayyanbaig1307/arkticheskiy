import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  SMAAEffect, DepthOfFieldEffect, Effect, BlendFunction, Pass,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// The frame, from the scene to the screen:
//
//   scene -> ambient occlusion (N8AO; Medium and High) -> exposure (and depth of field on High)
//   -> the weapon in your hands (its own camera and pass) -> bloom (the aurora, the lamps, the moon,
//   the searchlight) -> ACES filmic -> the grade (a cold blue grade, a soft S-curve, vignette, a
//   sub-visible dither) -> SMAA (Medium)

class SanitizeExposure extends Effect {
  constructor() {
    super('SanitizeExposure', /* glsl */ `
      uniform float uExposure, uFlash;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = inputColor.rgb;
        if (any(isnan(c)) || any(isinf(c))) c = vec3(0.);
        c = min(c, vec3(80.)) * uExposure + uFlash;
        outputColor = vec4(c, inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['uExposure', new THREE.Uniform(1)], ['uFlash', new THREE.Uniform(0)]]) });
  }
}

// After tone mapping: a cool, filmic Arctic grade. Shadows lean blue-teal, highlights stay
// near-white with a hint of warmth, saturation is pulled down a touch except in the aurora's green.
// Then a soft vignette. No film grain: on this sky it read as TV static. Only a one-step dither
// (interleaved gradient noise, below what the eye sees) keeps the dark gradients from banding.
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform float uTime, uGrain, uVignette, uCool, uContrast, uSat;
      float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = clamp(inputColor.rgb, 0., 1.);
        float l = dot(c, vec3(.2126, .7152, .0722));
        // saturation (green kept: the aurora)
        float g = smoothstep(.05, .3, c.g - max(c.r, c.b));
        c = mix(vec3(l), c, mix(uSat, 1.1, g));
        // split toning: cold shadows, neutral-warm highlights
        vec3 shadowTint = vec3(.86, .97, 1.12), highTint = vec3(1.03, 1.0, .97);
        c *= mix(mix(vec3(1.), shadowTint, uCool), highTint, smoothstep(.25, .85, l));
        c += vec3(-.004, .004, .012) * uCool;                     // lifted, blue blacks
        c = clamp(c, 0., 1.);
        c = mix(c, c * c * (3. - 2. * c), uContrast);
        // vignette
        vec2 q = uv - .5; q.x *= 1.15;
        c *= 1. - uVignette * smoothstep(.25, .85, dot(q, q) * 2.2);
        // dither (one 8-bit step)
        c += (ign(gl_FragCoord.xy) - .5) * uGrain;
        outputColor = vec4(c, inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL, uniforms: new Map([
      ['uTime', new THREE.Uniform(0)], ['uGrain', new THREE.Uniform(1 / 255)], ['uVignette', new THREE.Uniform(0.38)],
      ['uCool', new THREE.Uniform(1)], ['uContrast', new THREE.Uniform(0.22)], ['uSat', new THREE.Uniform(0.92)],
    ]) });
  }
}

// The first-person weapon (weapons/Viewmodel.js): its own camera and layer, drawn over the frame
// after ambient occlusion and depth of field (neither sees it: the gun is in no depth they read,
// and the depth is cleared for it so it never sinks into a wall) and before bloom, tone mapping and
// the grade, like everything else. The scene's lights and this frame's shadow maps and matrices
// are reused as they are (no second shadow render, no second matrix update, no background).
class ViewmodelPass extends Pass {
  constructor(scene, camera) {
    super('ViewmodelPass', scene, camera);
    this.needsSwap = false;
  }
  render(renderer, inputBuffer) {
    const scene = this.scene, bg = scene.background, auto = scene.matrixWorldAutoUpdate, shadows = renderer.shadowMap.autoUpdate;
    scene.background = null; scene.matrixWorldAutoUpdate = false; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.clearDepth();
    renderer.render(scene, this.camera);
    scene.background = bg; scene.matrixWorldAutoUpdate = auto; renderer.shadowMap.autoUpdate = shadows;
  }
}

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: quality.msaa || 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality.ao) {
      const ao = new N8AOPostPass(scene, camera, 1, 1);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 0.8;
      ao.configuration.intensity = 2.2;
      // (half resolution's depth-aware upsampling wiped the boat out of the frame here: full res,
      // fewer samples on Medium instead)
      ao.configuration.halfRes = false;
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode(quality.aoHalf ? 'Performance' : 'Low');
      this.ao = ao;
      this.composer.addPass(ao);
    }
    this.exposure = new SanitizeExposure();
    const first = [this.exposure];
    if (quality.dof) {
      this.dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 8, worldFocusRange: 30, bokehScale: 1.4, resolutionScale: 0.5 });
      first.push(this.dof);
    }
    this.composer.addPass(new EffectPass(camera, ...first));
    this.bloom = new BloomEffect({ intensity: 0.85, luminanceThreshold: 0.85, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72, levels: 7, resolutionScale: quality.bloomRes });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.grade = new GradeEffect();
    this.composer.addPass(new EffectPass(camera, this.bloom, this.tone, this.grade));
    if (quality.smaa) this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
    this.focus = 8;
  }

  // the weapon's pass, right after the exposure (and depth of field) pass; its materials apply the
  // exposure themselves (this.exposure's uniforms), since it is drawn after it
  addViewmodel(scene, camera) {
    if (this.viewmodel) return this.viewmodel;
    const i = this.composer.passes.findIndex((p) => p.effects?.includes?.(this.exposure));
    this.viewmodel = new ViewmodelPass(scene, camera);
    this.composer.addPass(this.viewmodel, i + 1);
    return this.viewmodel;
  }

  setSize(w, h) { this.composer.setSize(w, h); }
  setExposure(e) { this.exposure.uniforms.get('uExposure').value = e; }
  setFlash(f) { this.exposure.uniforms.get('uFlash').value = f; }

  // depth of field: focus eases toward what you look at (subtle: only the near and far blur a little)
  setFocus(dist, dt) {
    if (!this.dof) return;
    this.focus += (dist - this.focus) * Math.min(1, dt * 4);
    this.dof.cocMaterial.worldFocusDistance = this.focus;
    this.dof.cocMaterial.worldFocusRange = Math.max(6, this.focus * 3.5);
  }

  render(dt, t) {
    this.grade.uniforms.get('uTime').value = t;
    this.composer.render(dt);
  }
}
