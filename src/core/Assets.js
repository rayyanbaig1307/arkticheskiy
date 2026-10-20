import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Model loading: GLTFLoader with the meshopt decoder (tools/pack.mjs compresses every GLB with
// gltfpack). Paths are relative to the page, so the build works from any folder.

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export const asset = (p) => new URL(p, document.baseURI).href;

export function loadGLB(path, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(asset(path), resolve, (e) => onProgress?.(e.total ? e.loaded / e.total : 0), reject);
  });
}

export async function tryGLB(path) {
  try { return await loadGLB(path); } catch (e) { console.warn('[Arkticheskiy] missing model', path, e?.message || e); return null; }
}
