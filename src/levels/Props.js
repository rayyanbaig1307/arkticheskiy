import * as THREE from 'three';

// Small things to pick up, made here (each a few boxes and cylinders): what lies at a level's
// ITEM_ and DOC_ places. They are shared geometries and materials, so a hundred cost little.

const M = {};
const mat = (k, c, r = 0.7, m = 0, e = null) => M[k] || (M[k] = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: e || 0x000000, emissiveIntensity: e ? 1.2 : 0 }));
const G = {};
const box = (k, x, y, z) => G[k] || (G[k] = new THREE.BoxGeometry(x, y, z));
const cyl = (k, r, h, s = 12) => G[k] || (G[k] = new THREE.CylinderGeometry(r, r, h, s));

function mesh(g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
  o.castShadow = true; o.receiveShadow = true;
  return o;
}

export function propFor(item) {
  const g = new THREE.Group();
  const id = item || '';
  if (id === 'medkit') {
    g.add(mesh(box('mk', 0.26, 0.1, 0.18), mat('mk', 0xd8d4c8, 0.5)));
    g.add(mesh(box('mkc1', 0.12, 0.102, 0.035), mat('red', 0xa01010, 0.5), 0, 0.001, 0));
    g.add(mesh(box('mkc2', 0.035, 0.102, 0.12), mat('red', 0xa01010, 0.5), 0, 0.001, 0));
  } else if (id === 'bandage') {
    g.add(mesh(cyl('bd', 0.035, 0.09), mat('bd', 0xe8e2d4, 0.9), 0, 0.045, 0, 0, 0, Math.PI / 2));
  } else if (id === 'battery') {
    g.add(mesh(cyl('bt', 0.017, 0.062), mat('bt', 0x2a4a2a, 0.4, 0.3), 0, 0.017, 0, 0, 0, Math.PI / 2));
    g.add(mesh(cyl('bt2', 0.017, 0.062), mat('bt', 0x2a4a2a, 0.4, 0.3), 0, 0.017, 0.04, 0, 0, Math.PI / 2));
  } else if (id === 'flare' || id === 'ammo_flare') {
    g.add(mesh(cyl('fl', 0.02, 0.24), mat('fl', 0xb81c10, 0.6), 0, 0.02, 0, 0, 0, Math.PI / 2));
    g.add(mesh(cyl('flc', 0.022, 0.03), mat('dark', 0x101010, 0.6), 0.13, 0.02, 0, 0, 0, Math.PI / 2));
  } else if (id.startsWith('ammo_')) {
    const c = id === 'ammo_9x18' ? 0x6a5a3a : id === 'ammo_762x54' ? 0x4a5030 : 0x3a4a30;
    g.add(mesh(box('am' + id, id === 'ammo_9x18' ? 0.11 : 0.2, 0.07, 0.09), mat('am' + id, c, 0.8), 0, 0.035, 0));
  } else if (id.startsWith('key')) {
    g.add(mesh(cyl('kr', 0.014, 0.006), mat('brass', 0xa08040, 0.35, 1), 0, 0.003, 0));
    g.add(mesh(box('ks', 0.055, 0.004, 0.008), mat('brass', 0xa08040, 0.35, 1), 0.035, 0.003, 0));
    g.add(mesh(box('tag', 0.04, 0.003, 0.025), mat('tag', 0xc8c0a0, 0.8), -0.03, 0.002, 0.01));
  } else if (id === 'fuse') {
    g.add(mesh(cyl('fu', 0.012, 0.07), mat('glassw', 0xd0d4d8, 0.2), 0, 0.012, 0, 0, 0, Math.PI / 2));
    g.add(mesh(cyl('fuc', 0.013, 0.012), mat('brass', 0xa08040, 0.35, 1), 0.036, 0.012, 0, 0, 0, Math.PI / 2));
    g.add(mesh(cyl('fuc', 0.013, 0.012), mat('brass', 0xa08040, 0.35, 1), -0.036, 0.012, 0, 0, 0, Math.PI / 2));
  } else if (id === 'fuel_can') {
    g.add(mesh(box('fc', 0.17, 0.45, 0.34), mat('fc', 0x3c4a2a, 0.6, 0.2), 0, 0.225, 0));
    g.add(mesh(box('fch', 0.04, 0.04, 0.24), mat('dark', 0x101010, 0.6), 0, 0.47, 0));
  } else if (id === 'thermite') {
    g.add(mesh(cyl('th', 0.06, 0.24), mat('th', 0x60605a, 0.5, 0.4), 0, 0.12, 0));
    g.add(mesh(cyl('thb', 0.062, 0.03), mat('red', 0xa01010, 0.5), 0, 0.2, 0));
  } else if (id === 'vodka') {
    g.add(mesh(cyl('vd', 0.035, 0.22), mat('vd', 0xbfd6dc, 0.1), 0, 0.11, 0));
  } else if (id === 'tea') {
    g.add(mesh(cyl('tea', 0.04, 0.2), mat('tea', 0x4a5a3a, 0.4, 0.6), 0, 0.1, 0));
  } else if (id === 'doc' || id.startsWith('doc')) {
    g.add(mesh(box('paper', 0.21, 0.003, 0.297), mat('paper', 0xd8ccae, 0.9), 0, 0.002, 0, 0, Math.random() * 0.6 - 0.3, 0));
  } else if (id.startsWith('tape')) {
    g.add(mesh(box('tp', 0.1, 0.012, 0.064), mat('dark', 0x101010, 0.6), 0, 0.006, 0));
  } else {
    g.add(mesh(box('any', 0.12, 0.08, 0.12), mat('any', 0x6a6050, 0.8), 0, 0.04, 0));
  }
  return g;
}

// an invisible thing to aim at (for a USE_ place whose model is already part of the room)
export function hitProxy(size = 0.4) {
  const m = new THREE.Mesh(box('hp' + size, size, size, size), new THREE.MeshBasicMaterial({ visible: false }));
  return m;
}
