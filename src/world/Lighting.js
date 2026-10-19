import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { atmos, chainCompile, withAtmos } from './Atmos.js';

// The key light (the moon at night, the low sun, the overcast sky's soft sun) with cascaded shadow
// maps: tight, sharp cascades round the boat, wider ones out over the ice. The fill is the sky
// itself: Sky.js's prefiltered environment map (image-based lighting), so there is no flat ambient.
//
// Every lit material goes through prep(): CSM's shader setup first (it replaces onBeforeCompile),
// then the shared atmosphere uniforms chained after it, then any of the game's own patches.

// CSM installs its own copy of three's lights_fragment_begin chunk, and its copy is older than
// three's: it lacks the lines that read the DFG table (material.dfg) and the multi-scattering
// compensation. Without them every physical material's reflections come out zero (the
// environment's, the lamps' and the moon's highlights alike): metal goes black, paint, varnish
// and glass lose their sheen. The lines (from three r186's own chunk) go back in.
const STANDARD_DFG = /* glsl */ `
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
`;
function restoreSpecular() {
  const C = THREE.ShaderChunk;
  if (C.lights_fragment_begin.includes('material.dfg')) return;
  C.lights_fragment_begin = C.lights_fragment_begin.replace('IncidentLight directLight;', STANDARD_DFG + '\nIncidentLight directLight;');
}

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
    restoreSpecular();
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
