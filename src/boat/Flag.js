import * as THREE from 'three';

// The ensign at the stern (FLAG_stern: a cloth of 12 x 9 quads hanging from its staff). The
// apparent wind, her own way through the water plus the wind, streams it aft; ripples run out
// along it from the hoist, growing toward the fly, and the fly end flicks.

export class Flag {
  constructor(node) {
    this.meshes = [];
    if (!node) return;
    node.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      const a = g.attributes.position;
      if (!(a.array instanceof Float32Array) || a.normalized) {
        const f = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
        g.setAttribute('position', new THREE.BufferAttribute(f, 3));
      }
      g.attributes.position.setUsage(THREE.DynamicDrawUsage);
      o.material = o.material.clone();
      o.material.side = THREE.DoubleSide;
      o.frustumCulled = false;
      o.castShadow = true;
      this.meshes.push({ mesh: o, base: Float32Array.from(g.attributes.position.array) });
    });
    // the cloth's own axes: it lies in the plane x = 0, the fly along +z, down along -y
    this.len = 0;
    for (const m of this.meshes) for (let i = 2; i < m.base.length; i += 3) this.len = Math.max(this.len, m.base[i]);
    this.t = Math.random() * 10;
  }

  update(dt, wind = 0.6, speed = 3) {
    if (!this.meshes.length) return;
    this.t += dt;
    const t = this.t;
    const strength = Math.min(1, 0.35 + wind * 0.5 + speed * 0.07);
    const freq = 5 + strength * 5;
    for (const { mesh, base } of this.meshes) {
      const a = mesh.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        const z = base[i + 2], y = base[i + 1];
        const u = this.len ? z / this.len : 0;            // 0 at the hoist .. 1 at the fly
        const k = u * u * 0.6 + u * 0.4;
        const wave = Math.sin(u * 7.5 - t * freq + y * 1.6) * 0.16 + Math.sin(u * 13 - t * freq * 1.6 + y * 3) * 0.05;
        a[i] = base[i] + wave * k * (0.55 + strength * 0.5);
        // a light breeze lets it hang: the fly droops and swings in toward the staff
        const sag = (1 - strength) * u * 0.55;
        a[i + 1] = base[i + 1] - sag * u * 0.6;
        a[i + 2] = base[i + 2] * (1 - sag * 0.35) - Math.abs(wave) * k * 0.05;
      }
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  }
}
