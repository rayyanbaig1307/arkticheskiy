import * as THREE from 'three';

// The radar on the bridge console: a canvas drawn ten times a second into the screen's texture.
// North-up is for warships; this one is head-up, like a tug's: the boat at the centre, her heading
// straight up, range rings, the sweeping line with its fading afterglow, and the echoes of the ice
// within range (bergs bright and big, floes small and faint) that light up as the sweep passes
// and fade until it comes round again.

const SIZE = 256;

export class Radar {
  constructor({ model, ice, boat, stations }) {
    this.ice = ice; this.boat = boat; this.stations = stations;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.angle = 0; this.t = 0;
    this.echo = new Map();       // piece -> brightness
    const node = model.interact.find((i) => i.kind === 'radar')?.node;
    if (node) {
      node.traverse((o) => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) });
      });
      // (a flat screen: give the box's front face the whole canvas)
      node.traverse((o) => { if (o.isMesh) planarUV(o.geometry); });
    }
  }

  update(dt) {
    this.t += dt;
    const range = (this.stations?.radarRange ?? 1) * 1852;     // nautical miles to metres
    const prevA = this.angle;
    this.angle = (this.angle + dt * 2.6) % (Math.PI * 2);     // the scanner's own speed
    // echoes: a piece lights up when the sweep passes its bearing
    const b = this.boat;
    for (const p of this.ice.pieces) {
      const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      // bearing relative to the bow, clockwise
      const brg = (Math.atan2(dx, -dz) + b.heading + Math.PI * 4) % (Math.PI * 2);
      const crossed = prevA <= this.angle ? brg > prevA && brg <= this.angle : brg > prevA || brg <= this.angle;
      if (crossed) this.echo.set(p, 1);
    }
    for (const [p, v] of this.echo) { const nv = v - dt * 0.28; if (nv <= 0 || !this.ice.pieces.includes(p)) this.echo.delete(p); else this.echo.set(p, nv); }
    if ((this.drawT = (this.drawT || 0) - dt) > 0) return;
    this.drawT = 0.125;
    const c = this.ctx, S = SIZE, R = S * 0.46, cx = S / 2, cy = S / 2;
    c.fillStyle = '#010a05'; c.fillRect(0, 0, S, S);
    // (dead: its fuse gone, the screen black, now and then a twitch of the trace)
    if (this.dead) {
      if (Math.random() < 0.06) { c.fillStyle = 'rgba(40,255,120,0.15)'; c.fillRect(0, cy + (Math.random() - 0.5) * S * 0.6, S, 2); }
      if (this.tex) this.tex.needsUpdate = true;
      return;
    }
    // the sweep's afterglow
    for (let k = 0; k < 12; k++) {
      const a0 = this.angle - (k + 1) * 0.09, a1 = this.angle - k * 0.09;
      c.fillStyle = `rgba(40, 255, 120, ${0.2 * (1 - k / 12) ** 2})`;
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, a0 - Math.PI / 2, a1 - Math.PI / 2); c.closePath(); c.fill();
    }
    // range rings and the heading line
    c.strokeStyle = 'rgba(60, 220, 120, 0.35)'; c.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { c.beginPath(); c.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = 'rgba(150, 255, 190, 0.7)'; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy - R); c.stroke();
    // the land: the shelf's ice (Station.js) painted in, its edge bright
    const land = this.land?.();
    if (land) {
      c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
      c.fillStyle = 'rgba(70, 230, 120, 0.28)'; c.strokeStyle = 'rgba(170, 255, 190, 0.9)'; c.lineWidth = 1.5;
      c.beginPath();
      land.forEach(([wx, wz], i) => {
        const dx = wx - b.x, dz = wz - b.z;
        const brg = Math.atan2(dx, -dz) + b.heading;
        const d = Math.hypot(dx, dz) / range * R;
        const x = cx + Math.sin(brg) * d, y = cy - Math.cos(brg) * d;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      });
      c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
    // echoes
    for (const [p, v] of this.echo) {
      const dx = p.x - b.x, dz = p.z - b.z;
      const brg = Math.atan2(dx, -dz) + b.heading;
      const d = Math.hypot(dx, dz) / range * R;
      const x = cx + Math.sin(brg) * d, y = cy - Math.cos(brg) * d;
      const big = p.cls === 'berg' ? 1 : p.cls === 'bit' ? 0.55 : 0.3;
      const rad = Math.max(1.2, (p.shape.radius * p.scale) / range * R) * (0.8 + big * 0.4);
      c.fillStyle = `rgba(120, 255, 150, ${Math.min(1, v * (0.35 + big))})`;
      c.beginPath(); c.ellipse(x, y, rad, rad * 0.8, brg, 0, Math.PI * 2); c.fill();
    }
    // the sweep line, the boat, the readout
    c.strokeStyle = 'rgba(180, 255, 200, 0.95)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(this.angle) * R, cy - Math.cos(this.angle) * R); c.stroke();
    c.fillStyle = '#c8ffd8'; c.fillRect(cx - 2, cy - 4, 4, 8);
    c.font = '12px monospace'; c.fillStyle = 'rgba(150, 255, 180, 0.9)';
    c.fillText(`${(range / 1852).toFixed(1)} NM`, 8, 16);
    c.fillText(`${(b.speed * 1.944).toFixed(1)} KN`, S - 60, 16);
    const hdg = ((-b.heading * 180 / Math.PI) % 360 + 360) % 360;
    c.fillText(`HDG ${hdg.toFixed(0).padStart(3, '0')}`, 8, S - 8);
    this.tex.needsUpdate = true;
  }
}

// map a box's largest faces onto the whole texture (its UVs from Blender are a cube unwrap)
function planarUV(g) {
  g.computeBoundingBox();
  const bb = g.boundingBox, s = new THREE.Vector3(); bb.getSize(s);
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
  // the two widest axes span the screen
  const axes = [['x', s.x], ['y', s.y], ['z', s.z]].sort((a, b) => b[1] - a[1]);
  const [u, v] = [axes[0][0], axes[1][0]];
  for (let i = 0; i < pos.count; i++) {
    const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
    uv[i * 2] = (p[u] - bb.min[u]) / (s[u] || 1);
    uv[i * 2 + 1] = (p[v] - bb.min[v]) / (s[v] || 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
