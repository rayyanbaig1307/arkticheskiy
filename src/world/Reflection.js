import * as THREE from 'three';

// The sea's planar reflection: the scene seen from a camera mirrored under the mean water level,
// rendered into a reduced-resolution HDR target with an oblique near plane (nothing below the
// water is reflected). The ocean samples it in screen space, distorted by its waves. Objects on
// layer NO_REFLECT (people, animals, snow, interiors' small props) are left out of it.

export const NO_REFLECT = 2;

export class Reflection {
  constructor(renderer, scene, camera, scale = 0.5) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.scale = scale; this.enabled = scale > 0;
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: true });
    this.cam = new THREE.PerspectiveCamera();
    this.cam.layers.enableAll(); this.cam.layers.disable(NO_REFLECT);
    this.matrix = new THREE.Matrix4();
    this.hidden = [];
    this.v = { plane: new THREE.Plane(), n: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(), c: new THREE.Vector3(), r: new THREE.Matrix4(),
      look: new THREE.Vector3(), view: new THREE.Vector3(), t: new THREE.Vector3(), clip: new THREE.Vector4(), q: new THREE.Vector4() };
  }

  setSize(w, h) { this.rt.setSize(Math.max(1, Math.floor(w * this.scale)), Math.max(1, Math.floor(h * this.scale))); }

  hide(o) { this.hidden.push(o); }

  update(level = 0) {
    if (!this.enabled) return;
    // (on Medium every other frame: the sea's ripples hide the step)
    if (this.interval > 1 && (this.frame = (this.frame || 0) + 1) % this.interval) return;
    const v = this.v, cam = this.camera;
    v.p.set(0, level, 0);
    v.c.setFromMatrixPosition(cam.matrixWorld);
    v.view.subVectors(v.p, v.c);
    v.view.x = 0; v.view.z = 0;
    if (v.c.y < level) return;
    v.view.copy(v.c); v.view.y = 2 * level - v.c.y;
    v.r.extractRotation(cam.matrixWorld);
    v.look.set(0, 0, -1).applyMatrix4(v.r).add(v.c);
    v.t.copy(v.look); v.t.y = 2 * level - v.look.y;
    const rc = this.cam;
    rc.position.copy(v.view);
    rc.up.set(0, 1, 0).applyMatrix4(v.r); rc.up.y *= -1;
    rc.lookAt(v.t);
    rc.near = cam.near; rc.far = cam.far;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(cam.projectionMatrix);
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique near plane at the water
    v.plane.setFromNormalAndCoplanarPoint(v.n, v.p).applyMatrix4(rc.matrixWorldInverse);
    v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
    const p = rc.projectionMatrix.elements;
    v.q.x = (Math.sign(v.clip.x) + p[8]) / p[0];
    v.q.y = (Math.sign(v.clip.y) + p[9]) / p[5];
    v.q.z = -1; v.q.w = (1 + p[10]) / p[14];
    v.clip.multiplyScalar(2 / v.clip.dot(v.q));
    p[2] = v.clip.x; p[6] = v.clip.y; p[10] = v.clip.z + 1; p[14] = v.clip.w;

    const r = this.renderer;
    for (const o of this.hidden) o.visible = false;
    const prev = r.getRenderTarget();
    const sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, rc);
    r.setRenderTarget(prev);
    r.shadowMap.autoUpdate = sh;
    for (const o of this.hidden) o.visible = true;
  }
}
