import * as THREE from 'three';
import { NO_REFLECT } from '../world/Reflection.js';

// Light probes for the rooms. Indoors the sky's environment map is the wrong thing to reflect (the
// boat dims it there: BoatModel's indoor patch), and without it steel, chrome, enamel and varnish
// go flat black. So each room is photographed once, from its middle at eye height with its lamps
// lit, into a cube map, prefiltered (PMREM) like the sky's, and the rooms' own materials (the "In_"
// ones) reflect and are lit by the room they are in: the room you are in, or were in last.
//
// The cubes are taken in boat space and turn with her: each frame the materials' environment is
// rotated by her heading, pitch and roll since the photographs were taken. They are taken again
// when a light switch changes the rooms' lighting.

const ROOMS = ['mess', 'hall', 'lobby', 'bridge', 'engine'];
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

export class Probes {
  constructor({ renderer, scene, boat, model, lights, size = 128 }) {
    Object.assign(this, { renderer, scene, boat, model, lights });
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cam = new THREE.CubeCamera(0.05, 400, this.rt);
    for (const c of this.cam.children) c.layers.enable(NO_REFLECT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.maps = {};
    this.q0 = new THREE.Quaternion();
    this.current = null;
    this.mats = [];
    model.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (/^in_/i.test(m.name || '') && m.isMeshStandardMaterial && !this.mats.includes(m)) this.mats.push(m);
      }
    });
  }

  // photograph every room (its lamps lit as if you stood in it)
  capture(playerPos, playerZone) {
    const { boat, model, lights } = this;
    boat.root.updateMatrixWorld();
    this.q0.copy(boat.root.quaternion);
    const hidden = [];
    for (const m of this.mats) { hidden.push(m.envMap); m.envMap = null; }
    const er = model.roomMeshes?.engine || [], erVis = er.map((m) => m.visible);
    for (const m of er) m.visible = true;
    for (const name of ROOMS) {
      const z = model.zones.find((zz) => zz.name === name);
      if (!z) continue;
      const c = z.box.getCenter(new THREE.Vector3());
      c.y = z.box.min.y + 1.6;
      if (name === 'engine') c.z = Math.min(c.z, 2);       // (forward of the engines, by the stair)
      for (let i = 0; i < 3; i++) lights.update(10, c, name);
      this.cam.position.copy(boat.toWorld(c, _v));
      this.cam.update(this.renderer, this.scene);
      const old = this.maps[name];
      this.maps[name] = this.pmrem.fromCubemap(this.rt.texture, old || undefined);
    }
    for (let i = 0; i < 3; i++) lights.update(10, playerPos, playerZone);
    er.forEach((m, i) => { m.visible = erVis[i]; });
    this.mats.forEach((m, i) => { m.envMap = hidden[i]; });
    this.current = null;
    this.use(playerZone || 'mess');
  }

  use(zone) {
    const name = zone === 'engine_stair' ? 'engine' : zone === 'cabin' ? 'hall' : zone;
    const rt = this.maps[name];
    if (!rt || this.current === name) return;
    this.current = name;
    for (const m of this.mats) {
      const first = !m.envMap;
      m.envMap = rt.texture;
      m.envMapIntensity = name === 'engine' ? 0.5 : name === 'bridge' ? 0.6 : 0.38;
      if (first) m.needsUpdate = true;
    }
  }

  update(zone) {
    if (zone) this.use(zone);
    // (the cubes turn with her: three negates the rotation it is given, so it gets her turn since
    // the photographs, and samples the cube along that turn undone)
    _q.copy(this.q0).invert().premultiply(this.boat.root.quaternion);
    for (const m of this.mats) if (m.envMapRotation) m.envMapRotation.setFromQuaternion(_q);
  }
}
