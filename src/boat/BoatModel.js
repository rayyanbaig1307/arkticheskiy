import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree } from 'three-mesh-bvh';
import { Collision } from './Collision.js';
import { chainCompile } from '../world/Atmos.js';
import { NO_REFLECT } from '../world/Reflection.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

// The tug as built in Blender (tools/blender/make_tug.py → public/models/tug.glb), read by its
// node names:
//
//   COL_*            collision meshes (hidden): decks, walls, stair ramps, machinery blocks
//   ZONE_<room>      room volumes (hidden): bridge, mess, galley, corridor, engine
//   LAD_*            ladder volumes (hidden): inside one, W climbs
//   LMP_<room>_<n>   lamp points (extras: color, power)
//   SPOT_<name>      places: the spawn, the stations, the crew's jobs
//   PATH_<name>_<i>  patrol paths, in order
//   INT_<kind>_<id>  things to use: wheel, throttle, horn, searchlight, radar, radio, kettle,
//                    door, switch, engine
//   SL_yaw, SL_pitch, SL_lamp      the searchlight's pivots
//   RADAR_scanner    the radar's rotating antenna
//   NEEDLE_<id>      gauge needles (turn about their local z)
//   WINCH_drum, WINCH_spool, ROLLER_stern   the towing gear's moving parts (boat/Towline.js)
//   ROPE_drum, ROPE_lead, ROPE_bitt, ROPE_roller   the towline's path over them
//   FLAG_stern       the ensign (waved by the wind)
//
// Materials named "In_" are the rooms' insides. Most parts carry vertex colours (the small parts'
// colours and the tinted paints: one material per texture set, tools/blender/tug_mats.py).
// Materials get shadows and the boat's indoor patch: inside a room (a ZONE box) the sky's light
// (the IBL) fades, so the rooms are lit by their lamps and not by the open sky.

const MAX_ZONES = 8;

export class BoatModel {
  constructor(scene, { quality, lighting }) {
    this.scene = scene;            // the glTF scene (or the stand-in): its root is boat space
    this.lighting = lighting;
    this.colliders = []; this.zones = []; this.ladders = []; this.lamps = [];
    this.spots = {}; this.paths = {}; this.interact = []; this.nodes = {};
    this.uniforms = {
      uBoatInv: { value: new THREE.Matrix4() },
      uZoneMin: { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector3(1e6, 1e6, 1e6)) },
      uZoneMax: { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector3(-1e6, -1e6, -1e6)) },
      uIndoorSky: { value: 0.07 },
    };
    scene.updateMatrixWorld(true);
    const hide = [];
    scene.traverse((o) => {
      const n = o.name || '';
      this.nodes[n] = o;
      if (n.startsWith('COL_')) { o.traverse((m) => m.isMesh && this.colliders.push(m)); hide.push(o); }
      else if (n.startsWith('ZONE_')) { this.zones.push({ name: n.slice(5).replace(/_\d+$/, ''), box: new THREE.Box3().setFromObject(o) }); hide.push(o); }
      else if (n.startsWith('LAD_')) { this.ladders.push({ name: n.slice(4), box: new THREE.Box3().setFromObject(o) }); hide.push(o); }
      else if (n.startsWith('LMP_')) {
        const [, room] = n.split('_');
        const ud = o.userData || {};
        this.lamps.push({ node: o, room, pos: o.getWorldPosition(new THREE.Vector3()), color: new THREE.Color(...(ud.color || [1, 0.72, 0.42])), power: ud.power ?? 6, range: ud.range ?? 7, on: true, group: ud.group || room });
      } else if (n.startsWith('SPOT_')) {
        this.spots[n.slice(5)] = { pos: o.getWorldPosition(new THREE.Vector3()), yaw: yawOf(o), node: o };
      } else if (n.startsWith('PATH_')) {
        const m = n.match(/^PATH_(.+)_(\d+)$/);
        if (m) (this.paths[m[1]] ||= [])[+m[2]] = o.getWorldPosition(new THREE.Vector3());
      } else if (n.startsWith('INT_')) {
        const [, kind, ...rest] = n.split('_');
        this.interact.push({ kind, id: rest.join('_') || kind, node: o });
      }
    });
    for (const o of hide) o.visible = false;
    for (const k of Object.keys(this.paths)) this.paths[k] = this.paths[k].filter(Boolean);
    this.zones.slice(0, MAX_ZONES).forEach((z, i) => {
      // (a little bigger than the room, so its walls, floor and ceiling count as inside)
      const grow = new THREE.Vector3(0.06, 0.35, 0.06);
      this.uniforms.uZoneMin.value[i].copy(z.box.min).sub(grow);
      this.uniforms.uZoneMax.value[i].copy(z.box.max).add(grow);
    });
    this.collision = new Collision(this.colliders, scene);

    // the static parts merged by material (one draw call per material, not per part)
    this.merged = this.mergeStatic(hide);
    // materials: shadows, the indoor patch, glass
    const seen = new Set();
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (hiddenUnder(o, hide)) return;
      const n = (o.material?.name || '').toLowerCase();
      o.castShadow = !/glass|lamp/.test(n) && !o.userData.noCast; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (seen.has(m)) continue; seen.add(m);
        this.dress(m, quality);
      }
    });
    // the rooms' insides and the small moving parts stay out of the sea's reflection and the
    // moon's shadow passes (nobody sees them there): far fewer draw calls per frame
    const INSIDE = /^in_|interior|glass_inside|lamp_warm|lamp_night|lamp_led|lamp_engine|screen/i;
    const tuck = (o) => { if (o.isMesh) { o.layers.set(NO_REFLECT); o.castShadow = false; } };
    for (const m of this.merged) if (INSIDE.test(m.material.name)) tuck(m);
    for (const it of this.interact) it.node.traverse(tuck);
    for (const [n, o] of Object.entries(this.nodes)) if (n.startsWith('NEEDLE_')) o.traverse(tuck);
  }

  // join every static mesh (not a moving part, not a helper) into one mesh per material, in boat space;
  // the engine room's parts apart from the rest (nothing of it shows from anywhere else, so it is
  // drawn only while you are down there or looking down the hall's stair: roomMeshes.engine)
  mergeStatic(hide) {
    const groups = new Map();
    const ENGINE = /^(ENGINE_ROOM|MACHINERY|MACHINERY_SMALLS|PIPEWORK)$/;
    // (the fine detail outside casts no shadow: the lettering, the chain, the masthead's bits...)
    const NOCAST = /^(TRIM|OUTFIT_SMALLS|GEAR|MAST|FITTINGS|LADDERS|HORN|CURTAINS|GLASS|GLASS_FRONT)$/;
    const top = (o) => { let p = o; while (p.parent && p.parent !== this.scene) p = p.parent; return p.name || ''; };
    this.roomMeshes = { engine: [] };
    const moving = (o) => { for (let p = o; p && p !== this.scene; p = p.parent) if (/^(INT_|NEEDLE_|SL_|RADAR_|WINCH_|ROLLER_|FLAG_)/.test(p.name)) return true; return false; };
    const remove = [];
    this.scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.scene.matrixWorld).invert();
    this.scene.traverse((o) => {
      if (!o.isMesh || hiddenUnder(o, hide) || moving(o)) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      for (const k of ['position', 'normal', 'uv', 'color']) {
        const a = g.attributes[k];
        if (a && (a.normalized || !(a.array instanceof Float32Array))) {
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
          g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
        }
      }
      const name = top(o);
      const room = ENGINE.test(name) ? 'engine' : '';
      const small = NOCAST.test(name);
      const key = o.material.uuid + '|' + room + (small ? '|small' : '');
      if (!groups.has(key)) groups.set(key, { material: o.material, geos: [], room, small });
      groups.get(key).geos.push(g.index ? g.toNonIndexed() : g);
      remove.push(o);
    });
    for (const o of remove) o.parent.remove(o);
    const out = [];
    for (const { material, geos, room, small } of groups.values()) {
      // (every part needs the same attributes to merge: fill in what's missing)
      const want = ['position', 'normal', 'uv', 'color'].filter((k) => geos.some((g) => g.attributes[k]));
      const size = (k) => (k === 'uv' ? 2 : k === 'color' ? (geos.find((g) => g.attributes.color)?.attributes.color.itemSize || 4) : 3);
      for (const g of geos) for (const k of want) {
        if (g.attributes[k]) continue;
        const arr = new Float32Array(g.attributes.position.count * size(k));
        if (k === 'color') arr.fill(1);              // (no colours: white, the material's own)
        g.setAttribute(k, new THREE.BufferAttribute(arr, size(k)));
      }
      for (const g of geos) for (const k of Object.keys(g.attributes)) if (!want.includes(k)) g.deleteAttribute(k);
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      // a textured material on parts Blender gave no UVs (the decks): box-map them, 1 unit = 3 m
      // (a normal map with no UVs fails to compile, and the whole material vanishes)
      if (!merged.attributes.uv && (material.map || material.normalMap || material.roughnessMap)) boxUV(merged, 1 / 3);
      merged.computeBoundingSphere();
      merged.computeBoundsTree?.();
      const m = new THREE.Mesh(merged, material);
      m.name = 'BOAT_' + (material.name || 'mat') + (room ? '_' + room : '');
      this.scene.add(m);
      out.push(m);
      if (room) this.roomMeshes[room].push(m);
      m.userData.noCast = !!small;
    }
    return out;
  }

  dress(m, quality) {
    const n = (m.name || '').toLowerCase();
    // (a texture on a mesh Blender exported without UVs comes out pointing at channel 2^32-1:
    // the shader then fails to compile. Every texture reads the first UV set.)
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k] && !(m[k].channel <= 3)) m[k].channel = 0;
    if (/glass/.test(n)) {
      m.transparent = true; m.opacity = Math.min(m.opacity, 0.22); m.depthWrite = false;
      m.roughness = 0.08; m.metalness = 0; m.envMapIntensity = 0.7;
      this.lighting?.prep(m);
      return;
    }
    this.lighting?.prep(m);
    // (emissive strengths from Blender are for its renders: the game's exposure and bloom want less)
    if (/lamp|emit|screen/.test(n)) { m.emissiveIntensity *= /nav/.test(n) ? 0.1 : /chart/.test(n) ? 0.12 : /screen/.test(n) ? 0.8 : 0.55; if (/chart/.test(n)) m.color.multiplyScalar(0.3); return; }
    m.envMapIntensity = /floor|deck/.test(n) ? 0.8 : 1.0;
    if (/deck/.test(n) && m.normalScale) m.normalScale.setScalar(0.6);
    if (/deck_paint/.test(n)) m.color.multiplyScalar(1.7);           // (worn deck paint: lighter than the tin says)
    if (/hull/.test(n) && m.normalScale) m.normalScale.setScalar(0.7);
    // (the rooms' own materials reflect the rooms: boat/Probes.js; the sky is dimmed indoors for the rest)
    if (/^in_/.test(n)) return;
    const u = this.uniforms;
    chainCompile(m, (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uBoatInv;\nvarying vec3 vBoatPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBoatPos = (uBoatInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vBoatPos;
          uniform vec3 uZoneMin[${MAX_ZONES}], uZoneMax[${MAX_ZONES}];
          uniform float uIndoorSky;
          float indoorAmount(){
            float k = 0.;
            for (int i = 0; i < ${MAX_ZONES}; i++){
              vec3 a = vBoatPos - uZoneMin[i], b = uZoneMax[i] - vBoatPos;
              float inside = min(min(min(a.x, b.x), min(a.y, b.y)), min(a.z, b.z));
              k = max(k, smoothstep(-0.12, 0.05, inside));
            }
            return k;
          }`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
          #if defined( USE_ENVMAP ) || defined( ENVMAP_TYPE_CUBE_UV )
          {
            float ind = indoorAmount();
            float skyK = mix(1.0, uIndoorSky, ind);
            iblIrradiance *= skyK;
            #ifdef USE_ENVMAP
            radiance *= skyK;
            #endif
          }
          #endif`);
    }, 'boat-indoor');
    void quality;
  }

  // the room a boat-space point is in (or null)
  zoneAt(p) {
    for (const z of this.zones) if (z.box.containsPoint(p)) return z.name;
    return null;
  }

  ladderAt(p) {
    for (const l of this.ladders) if (l.box.containsPoint(p)) return l;
    return null;
  }

  update(boatRoot) { this.uniforms.uBoatInv.value.copy(boatRoot.matrixWorld).invert(); }
}

function boxUV(g, k) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n ? n.getX(i) : 0), ay = Math.abs(n ? n.getY(i) : 1), az = Math.abs(n ? n.getZ(i) : 0);
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * k; uv[i * 2 + 1] = v * k;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function yawOf(o) {
  const q = o.getWorldQuaternion(new THREE.Quaternion());
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
}
function hiddenUnder(o, hide) {
  for (let p = o; p; p = p.parent) if (hide.includes(p)) return true;
  return false;
}
