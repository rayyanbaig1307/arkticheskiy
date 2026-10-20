import * as THREE from 'three';

// Where people can walk aboard: a grid over the boat (20 cm cells, boat space x / z), each cell's
// floor found by a ray down the collision BVH, and the cell open only if a body (a capsule 0.3 m
// across and 1.6 m tall) stands there without touching anything. Cells are found as a search
// reaches them (not all at once) and remembered; a cell's floor is looked for near the floor of the
// cell it was reached from, so the decks one above another stay apart while stair ramps (whose
// floor climbs a little from cell to cell) join them.
//
// route(from, to) is A* over those cells (8 neighbours, no corner cutting), then pulled tight: a
// point is dropped wherever a straight walk past it stays on open cells. Routes are kept, so each
// leg of a routine is worked out once.

const CELL = 0.2;
const RADIUS = 0.3, HEIGHT = 1.6;
const STEP = 0.3;             // the most a floor may rise or fall between neighbouring cells
const MAX_NODES = 26000;

const _seg = new THREE.Line3(new THREE.Vector3(), new THREE.Vector3());
const _o = new THREE.Vector3(), _d = new THREE.Vector3(0, -1, 0);

export class Nav {
  constructor(collision) {
    this.col = collision;
    this.cells = new Map();     // key -> { x, z, y, ok }
    this.routes = new Map();
    this.tests = 0;
  }

  // forget what was found (the ground changed: the station's collision came or went)
  reset() { this.cells.clear(); this.routes.clear(); }

  key(ix, iz, y) { return ix + ',' + iz + ',' + Math.round(y * 2); }

  // the floor near height y at a cell, and whether a body fits standing on it
  probe(ix, iz, yRef) {
    const x = ix * CELL, z = iz * CELL;
    _o.set(x, yRef + 0.75, z);
    const d = this.col.raycast(_o, _d, 1.5);
    if (d === Infinity) return null;
    const y = yRef + 0.75 - d;
    if (Math.abs(y - yRef) > 0.7) return null;
    const k = this.key(ix, iz, y);
    let c = this.cells.get(k);
    if (c) return c;
    _seg.start.set(x, y + RADIUS + 0.25, z); _seg.end.set(x, y + HEIGHT - RADIUS, z);    // (clear of a stair's slope under the feet)
    this.tests++;
    c = { ix, iz, x, z, y, k, ok: !this.col.touches(_seg, RADIUS) };
    this.cells.set(k, c);
    return c;
  }

  cellAt(p) {
    const ix = Math.round(p.x / CELL), iz = Math.round(p.z / CELL);
    let c = this.probe(ix, iz, p.y);
    if (c && c.ok) return c;
    // (a spot right against something: the nearest open cell round it)
    for (let r = 1; r <= 4; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      c = this.probe(ix + dx, iz + dz, p.y);
      if (c && c.ok) return c;
    }
    return null;
  }

  route(from, to) {
    const rk = `${from.x.toFixed(2)},${from.y.toFixed(1)},${from.z.toFixed(2)}>${to.x.toFixed(2)},${to.y.toFixed(1)},${to.z.toFixed(2)}`;
    if (this.routes.has(rk)) return this.routes.get(rk);
    const a = this.cellAt(from), b = this.cellAt(to);
    let path = null;
    if (a && b) path = this.astar(a, b);
    const out = path ? this.pull(path, from, to) : [to.clone()];
    this.routes.set(rk, out);
    return out;
  }

  astar(a, b) {
    const open = new Heap();
    const g = new Map(), came = new Map();
    g.set(a.k, 0); open.push(a, this.h(a, b));
    const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let n = 0;
    while (open.size) {
      const c = open.pop();
      if (c === b || (c.ix === b.ix && c.iz === b.iz && Math.abs(c.y - b.y) < 0.4)) return this.unwind(came, c);
      if (++n > MAX_NODES) break;
      const gc = g.get(c.k);
      for (const [dx, dz, w] of N8) {
        const nb = this.probe(c.ix + dx, c.iz + dz, c.y);
        if (!nb || !nb.ok || Math.abs(nb.y - c.y) > STEP) continue;
        if (dx && dz) {                      // (no cutting a corner past something)
          const s1 = this.probe(c.ix + dx, c.iz, c.y), s2 = this.probe(c.ix, c.iz + dz, c.y);
          if (!s1?.ok || !s2?.ok) continue;
        }
        const gn = gc + w * CELL + Math.abs(nb.y - c.y) * 2;
        if (gn < (g.get(nb.k) ?? Infinity)) {
          g.set(nb.k, gn); came.set(nb.k, c);
          open.push(nb, gn + this.h(nb, b));
        }
      }
    }
    return null;
  }

  h(a, b) { return Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y) * 2; }

  unwind(came, c) {
    const out = [c];
    while (came.has(c.k)) { c = came.get(c.k); out.push(c); }
    return out.reverse();
  }

  // a straight walk from cell a to cell b stays on open cells (sampled every half a cell)
  clear(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(L / (CELL * 0.5)));
    let y = a.y;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const c = this.probe(Math.round((a.x + dx * t) / CELL), Math.round((a.z + dz * t) / CELL), y);
      if (!c || !c.ok || Math.abs(c.y - y) > STEP) return false;
      y = c.y;
    }
    return Math.abs(b.y - y) <= STEP + 0.05;
  }

  pull(path, from, to) {
    const pts = [];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1 && !this.clear(path[i], path[j])) j--;
      pts.push(path[j]);
      i = j;
    }
    const out = pts.map((c) => new THREE.Vector3(c.x, c.y, c.z));
    if (out.length) out[out.length - 1].set(to.x, out[out.length - 1].y, to.z);
    else out.push(to.clone());
    return out;
  }
}

// a binary heap of cells by priority
class Heap {
  constructor() { this.a = []; this.p = []; }
  get size() { return this.a.length; }
  push(v, pr) {
    const a = this.a, p = this.p;
    a.push(v); p.push(pr);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pr) break;
      a[i] = a[j]; p[i] = p[j]; i = j;
    }
    a[i] = v; p[i] = pr;
  }
  pop() {
    const a = this.a, p = this.p;
    const top = a[0], lv = a.pop(), lp = p.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        a[i] = a[c]; p[i] = p[c]; i = c;
      }
      a[i] = lv; p[i] = lp;
    }
    return top;
  }
}
