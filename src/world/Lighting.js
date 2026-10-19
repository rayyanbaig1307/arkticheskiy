import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { atmos, chainCompile, withAtmos } from './Atmos.js';

// The key light (the moon at night, the low sun, the overcast sky's soft sun) with cascaded shadow
// maps: tight, sharp cascades round the boat, wider ones out over the ice. The fill is the sky
// itself: Sky.js's prefiltered environment map (image-based lighting), so there is no flat ambient.
//
// Every lit material goes through prep(): CSM's shader setup first (it replaces onBeforeCompile),
// then the shared atmosphere uniforms chained after it, then any of the game's own patches.

export class Lighting {
  constructor({ scene, camera, quality }) {
    this.scene = scene;
    this.csm = new CSM({
      maxFar: quality.shadowFar,
      cascades: quality.cascades,
      mode: 'practical',
      parent: scene,
      shadowMapSize: quality.shadowSize,
      lightDirection: new THREE.Vector3(-0.4, -0.5, 0.6).normalize(),
      camera,
      lightIntensity: 1,
      lightNear: 1,
      lightFar: 1200,
      lightMargin: 120,
      shadowBias: -0.00025,
      fade: true,
    });
    for (const l of this.csm.lights) {
      l.shadow.normalBias = 0.04;
      l.castShadow = true;
    }
    this.prepared = new WeakSet();
  }

  // every lit material: shadows (CSM), the atmosphere's fog uniforms, then the given patches
  prep(material) {
    if (!material || this.prepared.has(material)) return material;
    this.prepared.add(material);
    if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial) {
      this.csm.setupMaterial(material);
      material.customProgramCacheKey = () => 'csm';
    }
    chainCompile(material, withAtmos, 'atmos');
    return material;
  }

  prepObject(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) this.prep(m);
    });
  }

  update(camera, params) {
    if (params) {
      this.csm.lightDirection.copy(params.keyDir).negate().normalize();
      const k = params.keyIntensity * Math.min(1, Math.max(0, params.keyDir.y * 6 + 0.15));
      for (const l of this.csm.lights) { l.intensity = k; l.color.copy(params.keyColor); }
    }
    this.csm.update();
    void camera; void atmos;
  }

  resize() { this.csm.updateFrustums(); }
}
