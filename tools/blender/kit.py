# The building kit for the Polyarnik's parts: Part (one mesh object assembled from boxes, tubes,
# cylinders and prisms, faces tagged with materials) and the shapes the rooms are made of: walls
# with openings, frames, railings, stairs, ladders; rounded boxes, cushions, cabinets with doors,
# pipes with bends and flanges, valves, gauges, lamps, grilles, radiators, signs.
#
# A Part can build in a local frame (`with p.at(x, y, z, rz):`): everything made inside it is
# moved through that frame, so a cabinet or a gauge is written once, facing +y, and mounted on
# any wall. On a wall item, local +y is out of the wall (into the room), x runs along it, z is up.
import bpy, bmesh, math
from contextlib import contextmanager
from mathutils import Vector, Matrix
import numpy as np

import importlib
import common as C
importlib.reload(C)

T = 0.12                                         # wall thickness
FACE = {'+y': 0.0, '-y': math.pi, '+x': -math.pi / 2, '-x': math.pi / 2}

@contextmanager
def at_all(parts, *a, **k):
    """the same local frame on several parts at once (a fitting split between them)"""
    from contextlib import ExitStack
    with ExitStack() as st:
        for p in parts: st.enter_context(p.at(*a, **k))
        yield

def smoothstep(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)

class Part:
    """one object assembled from simple shapes, faces tagged with materials"""
    def __init__(self, name, mats_list, coll=None):
        self.name = name; self.bm = bmesh.new(); self.mats = [m for m in mats_list if m is not None]; self.coll = coll
        self.M = None

    # ---- the local frame
    @contextmanager
    def at(self, x, y, z, rz=0.0, rx=0.0, ry=0.0):
        old = self.M
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
        self.M = M if old is None else old @ M
        try:
            yield self
        finally:
            self.M = old

    def _xf(self, faces):
        if self.M is not None and faces:
            vs = list({v for f in faces for v in f.verts})
            bmesh.ops.transform(self.bm, matrix=self.M, verts=vs)
        return faces

    def P(self, p):
        """a local point to the part's space"""
        v = Vector(p)
        return (self.M @ v) if self.M is not None else v

    def mi(self, m):
        if m is None: return 0
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)

    # ---- shapes
    def box(self, x0, y0, z0, x1, y1, z1, m, bevel=0.0, segs=1):
        f = self._xf(C.bm_box_minmax(self.bm, x0, y0, z0, x1, y1, z1, self.mi(m)))
        if bevel: f = self.bevel(f, bevel, self.mi(m), segs)
        return f

    def boxc(self, cx, cy, cz, sx, sy, sz, m, rz=0.0, bevel=0.0, segs=1):
        f = self._xf(C.bm_box(self.bm, cx, cy, cz, sx, sy, sz, self.mi(m), rz))
        if bevel: f = self.bevel(f, bevel, self.mi(m), segs)
        return f

    def rbox(self, x0, y0, z0, x1, y1, z1, m, r=0.012, segs=2):
        """a box with rounded edges (catches the light like a made thing does)"""
        r = min(r, abs(x1 - x0) * 0.45, abs(y1 - y0) * 0.45, abs(z1 - z0) * 0.45)
        return self.box(x0, y0, z0, x1, y1, z1, m, bevel=r, segs=segs)

    def bevel(self, faces, w, mi=0, segs=1):
        edges = list({e for f in faces for e in f.edges if e.is_valid})
        if not edges: return faces
        res = bmesh.ops.bevel(self.bm, geom=edges, offset=w, segments=segs, affect='EDGES', profile=0.5, clamp_overlap=True)
        for f in res.get('faces', []): f.material_index = mi
        return list({f for f in faces if f.is_valid} | set(res.get('faces', [])))

    def cyl(self, cx, cy, cz, r, depth, m, axis='Z', segs=16, r2=None, cap=True, bevel=0.0):
        f = self._xf(C.bm_cyl(self.bm, cx, cy, cz, r, depth, axis, segs, self.mi(m), r2, cap))
        if bevel and cap:
            rims = [e for fc in f for e in fc.edges if len(e.link_faces) == 2 and abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.3]
            if rims:
                res = bmesh.ops.bevel(self.bm, geom=list(set(rims)), offset=bevel, segments=2, affect='EDGES', profile=0.5, clamp_overlap=True)
                for fc in res.get('faces', []): fc.material_index = self.mi(m)
        return f

    def tube(self, pts, r, m, segs=8, closed=False):
        pts = [self.P(p) for p in pts]
        return C.bm_tube(self.bm, pts, r, segs, self.mi(m), closed)

    def prism(self, poly, z0, z1, m):
        return self._xf(C.bm_prism(self.bm, poly, z0, z1, self.mi(m)))

    def sphere(self, cx, cy, cz, r, m, segs=12, rings=8, sz=1.0):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r)
        vs = res['verts']
        if sz != 1.0: bmesh.ops.scale(self.bm, vec=(1, 1, sz), verts=vs)
        bmesh.ops.translate(self.bm, vec=(cx, cy, cz), verts=vs)
        faces = list({f for v in vs for f in v.link_faces})
        for f in faces: f.material_index = self.mi(m)
        return self._xf(faces)

    def torus(self, cx, cy, cz, R, r, m, axis='Z', segs=24, rsegs=8, arc=2 * math.pi, a0=0.0):
        """a ring (a handwheel's rim, a lifebuoy, a hose coil): a tube round a circle"""
        n = max(3, int(segs * arc / (2 * math.pi)))
        pts = []
        for k in range(n + 1):
            a = a0 + arc * k / n
            c, s = math.cos(a) * R, math.sin(a) * R
            if axis == 'Z': pts.append((cx + c, cy + s, cz))
            elif axis == 'Y': pts.append((cx + c, cy, cz + s))
            else: pts.append((cx, cy + c, cz + s))
        closed = arc >= 2 * math.pi - 1e-6
        if closed: pts = pts[:-1]
        return self.tube_closed(pts, r, m, rsegs) if closed else self.tube(pts, r, m, rsegs)

    def tube_closed(self, pts, r, m, segs=8):
        P = [self.P(p) for p in pts]
        bm = self.bm; n = len(P); rings = []
        for i in range(n):
            t = (P[(i + 1) % n] - P[i - 1]).normalized()
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            a = t.cross(up).normalized(); b = t.cross(a).normalized()
            rings.append([bm.verts.new(P[i] + (a * math.cos(2 * math.pi * k / segs) + b * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
        out = []
        for i in range(n):
            j = (i + 1) % n
            for k in range(segs):
                k1 = (k + 1) % segs
                f = bm.faces.new((rings[i][k], rings[i][k1], rings[j][k1], rings[j][k])); f.material_index = self.mi(m); out.append(f)
        return out

    def quad(self, pts, m):
        vs = [self.bm.verts.new(self.P(p)) for p in pts]
        f = self.bm.faces.new(vs); f.material_index = self.mi(m)
        return [f]

    def done(self, smooth=False, sharp=None):
        me = bpy.data.meshes.new(self.name)
        had_uv = len(self.bm.loops.layers.uv) > 0
        if self.bm.faces:
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        self.bm.to_mesh(me); self.bm.free()
        for m in self.mats: me.materials.append(m)
        if not had_uv: C.box_uv(me)
        o = bpy.data.objects.new(self.name, me)
        (self.coll or bpy.context.scene.collection).objects.link(o)
        for p in me.polygons: p.use_smooth = smooth or sharp is not None
        if sharp is not None:
            me.set_sharp_from_angle(angle=math.radians(sharp))
        return o

# ---------------------------------------------------------------- architecture
def wall(part, a, b, z0, z1, m, holes=(), t=T):
    """a straight wall from a to b (x, y) with rectangular holes (position along the wall, width,
    bottom, top)"""
    ax, ay = a; bx, by = b
    L = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / L, (by - ay) / L
    rz = math.atan2(uy, ux)
    def seg(s0, s1, h0, h1):
        if s1 - s0 < 1e-3 or h1 - h0 < 1e-3: return
        cx = ax + ux * (s0 + s1) / 2; cy = ay + uy * (s0 + s1) / 2
        part.boxc(cx, cy, (h0 + h1) / 2, s1 - s0, t, h1 - h0, m, rz)
    s = 0.0
    for (c, w, h0, h1) in sorted(holes):
        s0, s1 = c - w / 2, c + w / 2
        seg(s, s0, z0, z1); seg(s0, s1, z0, min(z1, max(z0, h0))); seg(s0, s1, max(z0, min(z1, h1)), z1)
        s = s1
    seg(s, L, z0, z1)

def wall_dir(a, b):
    ax, ay = a; bx, by = b
    L = math.hypot(bx - ax, by - ay)
    return L, (bx - ax) / L, (by - ay) / L, math.atan2(by - ay, bx - ax)

def frames(part, a, b, holes, m, t=T, d=0.05, w=0.07, r=0.0):
    """frames round the holes of a wall (window and door surrounds), proud of both faces"""
    ax, ay = a
    L, ux, uy, rz = wall_dir(a, b)
    for (c, wd, h0, h1) in holes:
        for (s, hh, sw, sh) in ((c - wd / 2 - w / 2, (h0 + h1) / 2, w, h1 - h0 + 2 * w), (c + wd / 2 + w / 2, (h0 + h1) / 2, w, h1 - h0 + 2 * w),
                                 (c, h1 + w / 2, wd, w), (c, h0 - w / 2, wd, w)):
            part.boxc(ax + ux * s, ay + uy * s, hh, sw, t + 2 * d, sh, m, rz, bevel=r, segs=2 if r else 1)

def window_frame(part, a, b, c, wd, h0, h1, m, t=T, depth=0.06, w=0.075, rr=0.09, segs=5, side=0):
    """a ship's window: a heavy frame with rounded corners standing proud of the wall on both
    faces (side 0), or one (side +1 / -1, the normal's side), with the bolts round it"""
    ax, ay = a
    L, ux, uy, rz = wall_dir(a, b)
    cx, cy = ax + ux * c, ay + uy * c
    hw, hh = wd / 2, (h1 - h0) / 2
    zc = (h0 + h1) / 2
    def rrect(hw_, hh_, r_):
        pts = []
        for (sx, sz, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
            for k in range(segs + 1):
                ang = math.radians(a0 + 90 * k / segs)
                pts.append(((hw_ - r_) * sx + math.cos(ang) * r_, (hh_ - r_) * sz + math.sin(ang) * r_))
        return pts
    inner = rrect(hw, hh, rr); outer = rrect(hw + w, hh + w, rr + w)
    bm = part.bm; mi = part.mi(m)
    sides = (-1, 1) if side == 0 else (side,)
    for sd in sides:
        y0_ = sd * (t / 2); y1_ = sd * (t / 2 + depth)
        rings = []
        for (pts, yy) in ((outer, y0_), (outer, y1_), (inner, y1_), (inner, y0_)):
            ring = []
            for (lx, lz) in pts:
                p = Vector((cx + ux * lx - uy * yy, cy + uy * lx + ux * yy, zc + lz))
                ring.append(bm.verts.new(part.P(p) if part.M is not None else p))
            rings.append(ring)
        n = len(outer)
        for r_ in range(3):
            for k in range(n):
                k1 = (k + 1) % n
                q = (rings[r_][k], rings[r_][k1], rings[r_ + 1][k1], rings[r_ + 1][k])
                f = bm.faces.new(q if sd > 0 else tuple(reversed(q))); f.material_index = mi
    # the glazing's inner lining (the reveal through the wall)
    ring_a, ring_b = [], []
    for (lx, lz) in inner:
        for (lst, yy) in ((ring_a, -t / 2), (ring_b, t / 2)):
            p = Vector((cx + ux * lx - uy * yy, cy + uy * lx + ux * yy, zc + lz))
            lst.append(bm.verts.new(part.P(p) if part.M is not None else p))
    n = len(inner)
    for k in range(n):
        k1 = (k + 1) % n
        f = bm.faces.new((ring_a[k], ring_b[k], ring_b[k1], ring_a[k1])); f.material_index = mi
    return inner

def glass_rrect(part, a, b, c, wd, h0, h1, m, rr=0.09, segs=5, off=0.0, t=0.012):
    """the pane of a window_frame (a rounded rectangle, slightly in from the wall's centre)"""
    ax, ay = a
    L, ux, uy, rz = wall_dir(a, b)
    cx, cy = ax + ux * c, ay + uy * c
    hw, hh = wd / 2, (h1 - h0) / 2; zc = (h0 + h1) / 2
    pts = []
    for (sx, sz, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(segs + 1):
            ang = math.radians(a0 + 90 * k / segs)
            pts.append(((hw - rr) * sx + math.cos(ang) * rr, (hh - rr) * sz + math.sin(ang) * rr))
    bm = part.bm; mi = part.mi(m)
    for yy, rev in ((off - t / 2, True), (off + t / 2, False)):
        vs = [bm.verts.new(Vector((cx + ux * lx - uy * yy, cy + uy * lx + ux * yy, zc + lz))) for lx, lz in pts]
        f = bm.faces.new(list(reversed(vs)) if rev else vs); f.material_index = mi

def glass_pane(part, a, b, c, w, h0, h1, m, t=0.02):
    ax, ay = a
    L, ux, uy, rz = wall_dir(a, b)
    part.boxc(ax + ux * c, ay + uy * c, (h0 + h1) / 2, w, t, h1 - h0, m, rz)

def railing(part, pts, z, m, h=1.05, post=1.4, r=0.024):
    part.tube([(x, y, z + h) for x, y in pts], r, m, 10)
    part.tube([(x, y, z + h * 0.52) for x, y in pts], r * 0.75, m, 8)
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / post))
        for k in range(n + (1 if i == len(pts) - 2 else 0)):
            t = k / n
            part.cyl(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z + h / 2, r * 1.15, h, m, segs=8)
            part.cyl(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z + 0.012, r * 2.4, 0.024, m, segs=10)

def rail_col(col, pts, z, h=1.1, t=0.12):
    for i in range(len(pts) - 1):
        wall(col, pts[i], pts[i + 1], z, z + h, None, t=t)

def stairs(part, x0, x1, ya, za, yb, zb, m, rail_m=None, along='y', nosing=None):
    """a ship's stair from (a, za) to (b, zb): treads (with a nosing strip), stringers, rails"""
    n = max(3, int(abs(zb - za) / 0.21))
    L = math.hypot(yb - ya, zb - za); ang = math.atan2(zb - za, yb - ya)
    for i in range(n):
        t = (i + 0.5) / n
        p = ya + (yb - ya) * t; z = za + (zb - za) * t
        dirn = 1 if yb > ya else -1
        if along == 'y':
            part.box(x0 + 0.05, p - 0.13, z - 0.035, x1 - 0.05, p + 0.13, z, m, bevel=0.006)
            if nosing: part.box(x0 + 0.06, p + dirn * 0.1 - 0.025, z, x1 - 0.06, p + dirn * 0.1 + 0.025, z + 0.004, nosing)
        else:
            part.box(p - 0.13, x0 + 0.05, z - 0.035, p + 0.13, x1 - 0.05, z, m, bevel=0.006)
            if nosing: part.box(p + dirn * 0.1 - 0.025, x0 + 0.06, z, p + dirn * 0.1 + 0.025, x1 - 0.06, z + 0.004, nosing)
    for side in (x0, x1):
        if along == 'y':
            f = part.boxc(side, (ya + yb) / 2, (za + zb) / 2 - 0.08, 0.05, L, 0.24, m)
            vs = list({v for fc in f for v in fc.verts})
            bmesh.ops.rotate(part.bm, verts=vs, cent=part.P((side, (ya + yb) / 2, (za + zb) / 2 - 0.08)), matrix=Matrix.Rotation(ang, 3, 'X'))
        else:
            f = part.boxc((ya + yb) / 2, side, (za + zb) / 2 - 0.08, L, 0.05, 0.24, m)
            vs = list({v for fc in f for v in fc.verts})
            bmesh.ops.rotate(part.bm, verts=vs, cent=part.P(((ya + yb) / 2, side, (za + zb) / 2 - 0.08)), matrix=Matrix.Rotation(-ang, 3, 'Y'))
    if rail_m:
        for side in (x0, x1):
            if along == 'y':
                part.tube([(side, ya - 0.1, za + 0.95), (side, yb, zb + 0.95)], 0.025, rail_m, 10)
                for t in (0.15, 0.5, 0.85):
                    p = ya + (yb - ya) * t; z = za + (zb - za) * t
                    part.cyl(side, p, z + 0.47, 0.016, 0.95, rail_m, segs=8)
            else:
                part.tube([(ya - 0.1, side, za + 0.95), (yb, side, zb + 0.95)], 0.025, rail_m, 10)
                for t in (0.15, 0.5, 0.85):
                    p = ya + (yb - ya) * t; z = za + (zb - za) * t
                    part.cyl(p, side, z + 0.47, 0.016, 0.95, rail_m, segs=8)

def ramp(col, x0, x1, ya, za, yb, zb, along='y'):
    """a collision slab along a stair"""
    bm = col.bm
    if along == 'y': pts = [(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)]
    else: pts = [(ya, x0, za), (ya, x1, za), (yb, x1, zb), (yb, x0, zb)]
    v = [bm.verts.new(p) for p in pts]
    w = [bm.verts.new((p[0], p[1], p[2] - 0.15)) for p in pts]
    for f in ([v[0], v[1], v[2], v[3]], [w[3], w[2], w[1], w[0]], [v[0], w[0], w[1], v[1]], [v[1], w[1], w[2], v[2]], [v[2], w[2], w[3], v[3]], [v[3], w[3], w[0], v[0]]):
        try: bm.faces.new(f)
        except ValueError: pass

def ladder_rungs(part, x, y, z0, z1, m, facing='y', w=0.44):
    """a vertical steel ladder: two rails, rungs every 0.3 m"""
    for d in (-w / 2, w / 2):
        if facing == 'y': part.box(x + d - 0.03, y - 0.008, z0, x + d + 0.03, y + 0.008, z1, m)
        else: part.box(x - 0.008, y + d - 0.03, z0, x + 0.008, y + d + 0.03, z1, m)
    for k in range(int((z1 - z0) / 0.3)):
        z = z0 + 0.3 * (k + 1)
        if facing == 'y': part.cyl(x, y, z, 0.014, w, m, axis='X', segs=8)
        else: part.cyl(x, y, z, 0.014, w, m, axis='Y', segs=8)

# ---------------------------------------------------------------- text
_TEXT_CACHE = {}
def name_text(text, size):
    """a text as a flat mesh (x: reading direction, y: up, faces +z), returned as (verts, faces)
    (Blender's own built-in font: it has Cyrillic and a free licence)"""
    key = (text, size)
    if key in _TEXT_CACHE: return _TEXT_CACHE[key]
    cu = bpy.data.curves.new('_txt', 'FONT')
    cu.body = text; cu.size = size; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    cu.extrude = 0.0; cu.resolution_u = 3
    ob = bpy.data.objects.new('_txt', cu); bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True); bpy.data.curves.remove(cu)
    verts = [v.co.copy() for v in me.vertices]; faces = [list(p.vertices) for p in me.polygons]
    bpy.data.meshes.remove(me)
    _TEXT_CACHE[key] = (verts, faces)
    return verts, faces

def text_flat(part, text, size, m, y=0.002):
    """text in the local frame, on the plane y, read from +y (you face the wall, so it runs along
    -x: your right), up +z"""
    verts, faces = name_text(text, size)
    bm = part.bm; idx = part.mi(m)
    nv = [bm.verts.new(part.P((-v.x, y, v.y))) for v in verts]
    for f in faces:
        try:
            fc = bm.faces.new([nv[i] for i in f]); fc.material_index = idx
        except ValueError:
            pass

def sign(part, x, y, z, face, text, size, m_plate, m_text, w=None, h=None, sub=None):
    """a sign plate on a wall with its text (and a smaller second line)"""
    w = w or max(0.12, len(text) * size * 0.62 + size)
    h = h or size * (2.4 if sub else 1.6)
    with part.at(x, y, z, FACE[face]):
        part.box(-w / 2, 0, -h / 2, w / 2, 0.006, h / 2, m_plate, bevel=0.002)
        text_flat(part, text, size, m_text, y=0.0065)
        if sub:
            with part.at(0, 0, -size * 0.85):
                text_flat(part, sub, size * 0.55, m_text, y=0.0065)

# ---------------------------------------------------------------- furniture and fittings
def rrect_pts(hw, hh, r, segs=4):
    r = max(1e-4, min(r, hw * 0.95, hh * 0.95))
    pts = []
    for (sx, sz, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(segs + 1):
            ang = math.radians(a0 + 90 * k / segs)
            pts.append(((hw - r) * sx + math.cos(ang) * r, (hh - r) * sz + math.sin(ang) * r))
    return pts

def rplate(part, x0, z0, x1, z1, y0, y1, m, r=0.03, segs=4):
    """a plate with rounded corners in the local x-z plane, from y0 to y1 thick (a door leaf, a
    hatch, an inspection cover)"""
    hw, hh = (x1 - x0) / 2, (z1 - z0) / 2; cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    pts = rrect_pts(hw, hh, r, segs)
    bm = part.bm; mi = part.mi(m)
    fr = [bm.verts.new(part.P((cx + px, y1, cz + pz))) for px, pz in pts]
    bk = [bm.verts.new(part.P((cx + px, y0, cz + pz))) for px, pz in pts]
    out = [bm.faces.new(fr), bm.faces.new(list(reversed(bk)))]
    n = len(pts)
    for k in range(n):
        k1 = (k + 1) % n
        out.append(bm.faces.new((fr[k], bk[k], bk[k1], fr[k1])))
    for f in out: f.material_index = mi
    return out

def bolts_round(part, cx, cz, y, hw, hh, n, r, m):
    """bolt heads round a rounded-rectangle cover (local frame, on the plane y)"""
    for k in range(n):
        a = 2 * math.pi * k / n
        part.cyl(cx + math.cos(a) * hw, y + 0.006, cz + math.sin(a) * hh, r, 0.012, m, axis='Y', segs=6)

def cushion(part, x0, y0, z0, x1, y1, z1, m, r=0.035):
    return part.rbox(x0, y0, z0, x1, y1, z1, m, r=r, segs=3)

def handle_bar(part, x, y, z, length, m, axis='X', stand=0.03, r=0.007):
    """a bar handle on two standoffs (local +y out)"""
    if axis == 'X':
        part.tube([(x - length / 2, y, z), (x - length / 2, y + stand, z), (x + length / 2, y + stand, z), (x + length / 2, y, z)], r, m, 6)
    else:
        part.tube([(x, y, z - length / 2), (x, y + stand, z - length / 2), (x, y + stand, z + length / 2), (x, y, z + length / 2)], r, m, 6)

def cabinet(part, x0, x1, z0, z1, depth, m_body, m_door, m_handle, doors=1, drawers=0, drawer_h=0.16, top=None, top_t=0.03, plinth=0.08, gap=0.004):
    """a cabinet against a wall, in the local frame (wall at y = 0, front at y = depth): a body, a
    recessed plinth, doors and drawers with handles, an optional worktop"""
    part.box(x0, 0, z0 + plinth, x1, depth - 0.02, z1, m_body)
    part.box(x0 + 0.02, 0, z0, x1 - 0.02, depth - 0.07, z0 + plinth, m_body)
    zt = z1
    fronts = []
    z = z1 - 0.02
    for k in range(drawers):
        fronts.append((z - drawer_h, z, 'drawer')); z -= drawer_h + gap
    fronts_door = (z0 + plinth + 0.01, z)
    w = (x1 - x0 - 0.02) / max(doors, 1)
    for i in range(doors):
        a, b = x0 + 0.01 + i * w + gap, x0 + 0.01 + (i + 1) * w - gap
        if fronts_door[1] - fronts_door[0] > 0.1:
            part.rbox(a, depth - 0.02, fronts_door[0], b, depth, fronts_door[1], m_door, r=0.004, segs=1)
            hx = b - 0.05 if i % 2 == 0 else a + 0.05
            handle_bar(part, hx, depth, fronts_door[1] - 0.12, 0.1, m_handle, axis='Z', stand=0.025)
    for (a, b, _) in fronts:
        part.rbox(x0 + 0.01 + gap, depth - 0.02, a, x1 - 0.01 - gap, depth, b, m_door, r=0.004, segs=1)
        handle_bar(part, (x0 + x1) / 2, depth, (a + b) / 2, min(0.16, (x1 - x0) * 0.4), m_handle, axis='X', stand=0.025)
    if top is not None:
        part.rbox(x0 - 0.01, -0.0, zt, x1 + 0.01, depth + 0.025, zt + top_t, top, r=0.008, segs=2)

def wall_cupboard(part, x0, x1, z0, z1, depth, m_body, m_door, m_handle, doors=2, glass=None):
    part.box(x0, 0, z0, x1, depth - 0.02, z1, m_body)
    w = (x1 - x0) / doors
    for i in range(doors):
        a, b = x0 + i * w + 0.004, x0 + (i + 1) * w - 0.004
        part.rbox(a, depth - 0.02, z0 + 0.004, b, depth, z1 - 0.004, m_door, r=0.004, segs=1)
        if glass is not None:
            part.box(a + 0.04, depth, z0 + 0.06, b - 0.04, depth + 0.002, z1 - 0.06, glass)
        hx = b - 0.04 if i % 2 == 0 else a + 0.04
        handle_bar(part, hx, depth, z0 + 0.1, 0.08, m_handle, axis='Z', stand=0.022)

def pipe(part, pts, r, m, bend=None, segs=10, flange_m=None, flanges=(), bracket_m=None, brackets=()):
    """a pipe along a polyline with its corners bent round (radius `bend`), flanges at the listed
    point indices, and brackets (to the nearest wall) at the listed (index, t) places"""
    bend = bend if bend is not None else r * 3
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d0 = (b - a); d1 = (c - b)
        l0, l1 = d0.length, d1.length
        if l0 < 1e-6 or l1 < 1e-6: continue
        d0.normalize(); d1.normalize()
        ang = d0.angle(d1)
        if ang < 1e-3:
            out.append(b); continue
        k = min(bend * math.tan(ang / 2), l0 * 0.45, l1 * 0.45)
        p0 = b - d0 * k; p1 = b + d1 * k
        for s in range(6):
            t = s / 5
            q = (p0 * (1 - t) ** 2) + (b * 2 * (1 - t) * t) + (p1 * t * t)
            out.append(q)
    out.append(P[-1])
    part.tube([tuple(p) for p in out], r, m, segs)
    fm = flange_m or m
    for i in flanges:
        i = i if i >= 0 else len(P) + i
        a = P[max(0, i - 1)] if i > 0 else P[0]; b = P[min(len(P) - 1, i + 1)] if i < len(P) - 1 else P[-1]
        d = (b - a).normalized() if (b - a).length > 1e-6 else Vector((0, 0, 1))
        c = P[i] - d * 0.0 if 0 < i < len(P) - 1 else P[i]
        flange(part, c, d, r * 1.9, 0.025, fm)
    return out

def flange(part, c, d, R, th, m, bolts=6):
    """a pipe flange (a disc on the pipe with its bolt heads), centre c, axis d"""
    d = Vector(d).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    a = d.cross(up).normalized(); b = d.cross(a).normalized()
    bm = part.bm; mi = part.mi(m); n = 14
    for (o0, o1) in ((-th, 0.0), (0.0, th)):
        pass
    ring0 = [bm.verts.new(part.P(c - d * th + (a * math.cos(2 * math.pi * k / n) + b * math.sin(2 * math.pi * k / n)) * R) if part.M is not None else c - d * th + (a * math.cos(2 * math.pi * k / n) + b * math.sin(2 * math.pi * k / n)) * R) for k in range(n)]
    ring1 = [bm.verts.new(part.P(c + d * th + (a * math.cos(2 * math.pi * k / n) + b * math.sin(2 * math.pi * k / n)) * R) if part.M is not None else c + d * th + (a * math.cos(2 * math.pi * k / n) + b * math.sin(2 * math.pi * k / n)) * R) for k in range(n)]
    for k in range(n):
        k1 = (k + 1) % n
        f = bm.faces.new((ring0[k], ring0[k1], ring1[k1], ring1[k])); f.material_index = mi
    f = bm.faces.new(list(reversed(ring0))); f.material_index = mi
    f = bm.faces.new(ring1); f.material_index = mi

def valve(part, x, y, z, axis, r, m_body, m_wheel, stem=0.18, up='Z'):
    """a globe valve on a pipe running along `axis` ('X', 'Y' or 'Z'), its handwheel on a stem
    toward `up`"""
    part.sphere(x, y, z, r * 1.7, m_body, segs=12, rings=8)
    part.cyl(x, y, z, r * 1.25, r * 6.5, m_body, axis=axis, segs=12)
    off = {'X': (stem, 0, 0), 'Y': (0, stem, 0), 'Z': (0, 0, stem), '-X': (-stem, 0, 0), '-Y': (0, -stem, 0), '-Z': (0, 0, -stem)}[up]
    ax = up.strip('-')
    part.cyl(x + off[0] * 0.5, y + off[1] * 0.5, z + off[2] * 0.5, r * 0.55, stem, m_body, axis=ax, segs=8)
    R = max(0.06, r * 2.6)
    cx, cy, cz = x + off[0], y + off[1], z + off[2]
    part.torus(cx, cy, cz, R, max(0.008, R * 0.11), m_wheel, axis=ax, segs=20, rsegs=6)
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        if ax == 'Z': p1 = (cx + math.cos(a) * R, cy + math.sin(a) * R, cz)
        elif ax == 'Y': p1 = (cx + math.cos(a) * R, cy, cz + math.sin(a) * R)
        else: p1 = (cx, cy + math.cos(a) * R, cz + math.sin(a) * R)
        part.tube([(cx, cy, cz), p1], R * 0.07, m_wheel, 5)
    part.cyl(cx, cy, cz, R * 0.18, R * 0.25, m_wheel, axis=ax, segs=8)

def gauge(part, x, y, z, face, r, m_case, m_dial, m_glass=None, m_needle=None, a=None):
    """a round gauge on a panel (face: '+y' ...): a case, a dial, its glass; a needle unless the
    game animates one"""
    with part.at(x, y, z, FACE[face]):
        part.cyl(0, 0.02, 0, r, 0.04, m_case, axis='Y', segs=24, bevel=0.005)
        part.cyl(0, 0.0405, 0, r * 0.86, 0.002, m_dial, axis='Y', segs=24)
        # the scale: ticks over 270 degrees, the last few red
        tm = m_needle or m_case
        for k in range(11):
            aa = math.radians(-135 + 27 * k)
            ln = r * (0.16 if k % 5 == 0 else 0.1)
            c0, c1 = r * 0.78 - ln, r * 0.78
            part.tube([(math.sin(aa) * c0, 0.0428, math.cos(aa) * c0), (math.sin(aa) * c1, 0.0428, math.cos(aa) * c1)], r * (0.022 if k % 5 == 0 else 0.014), m_case if k < 9 else tm, 3)
        if m_needle is not None:
            aa = a if a is not None else 0.6
            part.tube([(0, 0.043, 0), (math.sin(aa) * r * 0.75, 0.043, math.cos(aa) * r * 0.75)], r * 0.035, m_needle, 4)
        if m_glass is not None:
            part.cyl(0, 0.046, 0, r * 0.88, 0.003, m_glass, axis='Y', segs=24)

def grille(part, x0, x1, z0, z1, m, slats=None, depth=0.03):
    """a ventilation grille in the local frame (wall at y 0): a frame and louvres"""
    part.rbox(x0, 0, z0, x1, depth, z1, m, r=0.006, segs=1)
    n = slats or max(3, int((z1 - z0) / 0.035))
    for k in range(n):
        zz = z0 + 0.02 + (z1 - z0 - 0.04) * (k + 0.5) / n
        part.box(x0 + 0.02, depth, zz - 0.006, x1 - 0.02, depth + 0.01, zz + 0.006, m)

def ceiling_grille(part, cx, cy, z, sx, sy, m, m_dark):
    part.box(cx - sx / 2, cy - sy / 2, z - 0.015, cx + sx / 2, cy + sy / 2, z, m, bevel=0.004)
    part.box(cx - sx / 2 + 0.03, cy - sy / 2 + 0.03, z - 0.0155, cx + sx / 2 - 0.03, cy + sy / 2 - 0.03, z - 0.015, m_dark)
    n = int(sx / 0.03)
    for k in range(1, n):
        xx = cx - sx / 2 + 0.03 + (sx - 0.06) * k / n
        part.box(xx - 0.004, cy - sy / 2 + 0.03, z - 0.03, xx + 0.004, cy + sy / 2 - 0.03, z - 0.015, m)

def fluoro(part, cx, cy, z, length, width, m_body, m_diff, along='y'):
    """a ceiling light fitting: a shallow steel box with an opal diffuser"""
    lx, ly = (width, length) if along == 'y' else (length, width)
    part.rbox(cx - lx / 2, cy - ly / 2, z - 0.07, cx + lx / 2, cy + ly / 2, z, m_body, r=0.01, segs=2)
    part.rbox(cx - lx / 2 + 0.025, cy - ly / 2 + 0.025, z - 0.085, cx + lx / 2 - 0.025, cy + ly / 2 - 0.025, z - 0.066, m_diff, r=0.012, segs=2)

def cage_lamp(part, x, y, z, m_body, m_glass, m_cage, axis='Z', r=0.09):
    """a bulkhead lamp: a cast base, a glass globe, a guard (on a ceiling: axis Z hangs it down)"""
    if axis == 'Z':
        part.cyl(x, y, z - 0.03, r * 1.15, 0.06, m_body, segs=16, bevel=0.008)
        part.sphere(x, y, z - 0.06 - r * 0.6, r * 0.85, m_glass, segs=14, rings=8, sz=0.9)
        for k in range(4):
            a = k * math.pi / 2
            part.tube([(x + math.cos(a) * r, y + math.sin(a) * r, z - 0.06), (x + math.cos(a) * r * 1.02, y + math.sin(a) * r * 1.02, z - 0.06 - r * 1.1),
                       (x, y, z - 0.06 - r * 1.75)], 0.005, m_cage, 4)
        part.torus(x, y, z - 0.06 - r * 0.7, r * 1.0, 0.005, m_cage, segs=16, rsegs=4)
    else:
        with part.at(x, y, z, FACE[axis]):
            part.box(-r, 0, -r * 1.3, r, 0.05, r * 1.3, m_body, bevel=0.012, segs=2)
            part.sphere(0, 0.05 + r * 0.45, 0, r * 0.8, m_glass, segs=14, rings=8)
            for k in (-1, 0, 1):
                part.tube([(k * r * 0.6, 0.05, -r), (k * r * 0.6, 0.05 + r * 1.2, 0), (k * r * 0.6, 0.05, r)], 0.005, m_cage, 4)

def extinguisher(part, x, y, z, face, m_red, m_black, m_chrome, h=0.55, r=0.085):
    """a portable fire extinguisher on its wall bracket (z: the floor under it)"""
    with part.at(x, y, z, FACE[face]):
        cy = 0.04 + r
        part.box(-0.05, 0, 0.35, 0.05, 0.02, 0.35 + h * 0.7, m_black)
        part.torus(0, cy, 0.4 + h * 0.5, r + 0.006, 0.006, m_black, segs=16, rsegs=4)
        part.cyl(0, cy, 0.3 + h / 2, r, h, m_red, segs=16, bevel=0.02)
        part.sphere(0, cy, 0.3 + h, r * 0.95, m_red, segs=14, rings=6, sz=0.5)
        part.cyl(0, cy, 0.3 + h + 0.06, 0.022, 0.07, m_chrome, segs=8)
        part.box(-0.02, cy - 0.06, 0.3 + h + 0.08, 0.02, cy + 0.07, 0.3 + h + 0.095, m_black)
        part.tube([(0.02, cy, 0.3 + h + 0.06), (0.07, cy + 0.02, 0.3 + h), (r + 0.02, cy + 0.03, 0.3 + h * 0.5), (r + 0.01, cy + 0.04, 0.42)], 0.01, m_black, 6)

def radiator(part, x0, x1, z0, z1, m, depth=0.08, fin=0.05):
    """a finned steam radiator against a wall (local frame)"""
    n = max(4, int((x1 - x0) / fin))
    for k in range(n):
        xx = x0 + (x1 - x0) * (k + 0.5) / n
        part.rbox(xx - fin * 0.38, 0.03, z0, xx + fin * 0.38, 0.03 + depth, z1, m, r=0.012, segs=1)
    part.cyl((x0 + x1) / 2, 0.03 + depth / 2, z0 + 0.04, 0.018, x1 - x0, m, axis='X', segs=8)
    part.cyl((x0 + x1) / 2, 0.03 + depth / 2, z1 - 0.04, 0.018, x1 - x0, m, axis='X', segs=8)
    for xx in (x0 + 0.05, x1 - 0.05):
        part.box(xx - 0.01, 0, z0 - 0.08, xx + 0.01, 0.04, z0 + 0.05, m)

def picture(part, x, y, z, face, w, h, m_frame, m_pic, frame=0.03):
    with part.at(x, y, z, FACE[face]):
        part.rbox(-w / 2, 0, -h / 2, w / 2, 0.025, h / 2, m_frame, r=0.006, segs=1)
        part.box(-w / 2 + frame, 0.025, -h / 2 + frame, w / 2 - frame, 0.0265, h / 2 - frame, m_pic)

def clock(part, x, y, z, face, r, m_case, m_dial, m_hand):
    with part.at(x, y, z, FACE[face]):
        part.cyl(0, 0.025, 0, r, 0.05, m_case, axis='Y', segs=28, bevel=0.008)
        part.cyl(0, 0.051, 0, r * 0.86, 0.002, m_dial, axis='Y', segs=28)
        for k in range(12):
            a = k * math.pi / 6
            part.box(math.sin(a) * r * 0.74 - 0.004, 0.052, math.cos(a) * r * 0.74 - (0.012 if k % 3 else 0.02), math.sin(a) * r * 0.74 + 0.004, 0.054, math.cos(a) * r * 0.74 + (0.012 if k % 3 else 0.02), m_hand)
        part.tube([(0, 0.056, 0), (math.sin(2.1) * r * 0.45, 0.056, math.cos(2.1) * r * 0.45)], 0.006, m_hand, 4)
        part.tube([(0, 0.058, 0), (math.sin(-0.4) * r * 0.7, 0.058, math.cos(-0.4) * r * 0.7)], 0.004, m_hand, 4)

def coat(part, x, y, z, face, m_cloth, m_hood=None, length=0.95, w=0.5):
    """a heavy coat hanging from a hook (a hanging tube of cloth, shoulders, sleeves)"""
    with part.at(x, y, z, FACE[face]):
        bm = part.bm; mi = part.mi(m_cloth)
        rings = []
        for k in range(7):
            t = k / 6
            zz = -t * length
            ww = w * (0.38 + 0.12 * math.sin(min(1, t * 3) * math.pi / 2) + 0.06 * t)
            dd = 0.06 + 0.1 * min(1, t * 4) + 0.02 * t
            ring = []
            for j in range(12):
                a = 2 * math.pi * j / 12
                ring.append(bm.verts.new(part.P((math.cos(a) * ww, 0.04 + dd + math.sin(a) * dd, zz - (0.03 * math.cos(a * 3) if k == 6 else 0)))))
            rings.append(ring)
        for k in range(6):
            for j in range(12):
                j1 = (j + 1) % 12
                f = bm.faces.new((rings[k][j], rings[k][j1], rings[k + 1][j1], rings[k + 1][j])); f.material_index = mi
        f = bm.faces.new(list(reversed(rings[0]))); f.material_index = mi
        for s in (-1, 1):
            part.tube([(s * w * 0.42, 0.12, -0.12), (s * w * 0.5, 0.13, -0.4), (s * w * 0.46, 0.15, -0.68)], 0.065, m_cloth, 8)
        if m_hood is not None:
            part.sphere(0, 0.1, 0.02, 0.13, m_hood, segs=10, rings=6, sz=0.7)

def box_panel(part, x0, x1, z0, z1, depth, m, m_door=None, m_handle=None):
    """an electrical box / small cabinet on a wall, its door with a recess and a handle"""
    part.rbox(x0, 0, z0, x1, depth, z1, m, r=0.01, segs=2)
    if m_door is not None:
        part.box(x0 + 0.02, depth, z0 + 0.02, x1 - 0.02, depth + 0.005, z1 - 0.02, m_door)
    if m_handle is not None:
        part.cyl(x1 - 0.05, depth + 0.012, (z0 + z1) / 2, 0.012, 0.02, m_handle, axis='Y', segs=8)

def cable_tray(part, x0, y0, x1, y1, z, m_tray, m_cable, w=0.3, n=7, cable_cols=None):
    """a cable tray under the deckhead from (x0, y0) to (x1, y1), its cables bundled in it"""
    L = math.hypot(x1 - x0, y1 - y0); ux, uy = (x1 - x0) / L, (y1 - y0) / L
    rz = math.atan2(uy, ux)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    part.boxc(cx, cy, z - 0.06, L, w, 0.006, m_tray, rz)
    for s in (-1, 1):
        part.boxc(cx - uy * s * w / 2, cy + ux * s * w / 2, z - 0.035, L, 0.006, 0.05, m_tray, rz)
    k = 0
    for i in range(n):
        off = (i - (n - 1) / 2) * (w * 0.8 / n)
        rr = 0.012 + 0.01 * ((i * 7) % 3) / 2
        mc = cable_cols[i % len(cable_cols)] if cable_cols else m_cable
        part.tube([(x0 - uy * off, y0 + ux * off, z - 0.06 + rr + 0.003), (x1 - uy * off, y1 + ux * off, z - 0.06 + rr + 0.003)], rr, mc, 6)
    for t in np.arange(0.4, L, 1.2):
        px, py = x0 + ux * t, y0 + uy * t
        part.boxc(px, py, z - 0.03, 0.03, w + 0.04, 0.06, m_tray, rz)
