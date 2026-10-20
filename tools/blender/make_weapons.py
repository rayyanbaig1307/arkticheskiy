# The first-person weapons and arms (CONTRACTS.md, "Weapon models"): public/models/weapons.glb
# (roots WPN_pm, WPN_akm, WPN_mosin, WPN_flaregun, WPN_handflare) and public/models/arms.glb
# (ARM_R, ARM_L). They follow src/weapons/standins.js exactly: the same root, part and empty names,
# the same pivots and frames, so the code that drives the stand-ins drives these unchanged.
#
# Run in the live Blender through run.py, or headless (no bridge timeout):
#   blender -b --factory-startup --python-expr "import runpy; runpy.run_path(r'<root>\tools\blender\run.py',
#       init_globals={'SCRIPT': 'make_weapons', 'ARGS': {'WHAT': ['pm'], 'BAKE': True}})"
# ARGS: WHAT (assets: pm akm mosin flaregun handflare arms), BAKE, EXPORT, PREVIEW (True or tags),
# TEX ({asset: size}).
#
# Everything is authored in three.js's frame (x right, y up, the barrel along -z, metres), the
# numbers straight from standins.js, and turned into Blender's (x, -z, y) as each piece is made, so
# glTF's y-up export gives them back. A part's mesh is made in its own frame (its origin the pivot).
#
# Surfaces: each face carries a kind (blued steel, wood, bakelite...) while it is modelled; at the
# end every gun is UV-unwrapped into one atlas and baked here in numpy (each texel's position,
# normal and kind rasterised from the mesh, then shaded procedurally in 3D: bluing worn to bright
# steel along the convex edges (found from the mesh's edges drawn into UV space), grime in the
# concave ones, dust on what faces up, scratches, wood grain and laminate plies, checkering, the
# stamped markings), giving base colour, roughness/metalness and a normal map: one material and
# one texture set per gun, so each part is a single draw call.
import bpy, bmesh, math, os, sys, time, json, traceback
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler
import common as C
import texlib as TL

ROOT = globals().get('ROOT') or C.ROOT or r'C:\Users\black\OneDrive\Desktop\Arkticheskiy'
C.set_root(ROOT)
WHAT = list(globals().get('WHAT') if globals().get('WHAT') is not None else ['pm', 'akm', 'mosin', 'flaregun', 'handflare', 'arms'])
BAKE = bool(globals().get('BAKE', True))
EXPORT_ARG = globals().get('EXPORT', True)
EXPORT = bool(EXPORT_ARG)
PREVIEW = globals().get('PREVIEW', True)
TEX = dict(globals().get('TEX') or {})
FONTS = r'C:\Windows\Fonts'
DEBUG_OPS = bool(globals().get('DEBUG_OPS', False))
T0 = time.time()
LOG = []

def log(*a):
    s = '[%6.1f] ' % (time.time() - T0) + ' '.join(str(x) for x in a)
    LOG.append(s); print(s, flush=True)

PI = math.pi
def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)
def mix(a, b, t): return a + (b - a) * t
def V(*a): return Vector(a[0] if len(a) == 1 else a)

# ---------------------------------------------------------------- frames (three.js <-> Blender)
CINV = Matrix.Rotation(PI / 2, 4, 'X')        # three -> Blender: (x, y, z) -> (x, -z, y)
CMAT = Matrix.Rotation(-PI / 2, 4, 'X')       # Blender -> three
def to_b(M3): return CINV @ M3 @ CMAT
def frame3(pos=(0, 0, 0), rot=(0, 0, 0)):
    """standins.js frameM: a pivot and an XYZ Euler (three's: R = Rx Ry Rz)"""
    R = Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[2], 4, 'Z')
    return Matrix.Translation(Vector(pos)) @ R
def dorsal3(pos, d=None):
    """standins.js empty(): a point, and the rotation taking +Y to the back of the hand"""
    q = Quaternion() if d is None else Vector((0, 1, 0)).rotation_difference(Vector(d).normalized())
    return Matrix.Translation(Vector(pos)) @ q.to_matrix().to_4x4()

# ---------------------------------------------------------------- the scene
SC = None
def use_scene(name, fresh=True):
    global SC
    SC = C.fresh_scene(name) if fresh else bpy.data.scenes[name]
    return SC
def ctx(**kw):
    return bpy.context.temp_override(scene=SC, view_layer=SC.view_layers[0], **kw)
def apply_mods(o):
    with ctx():
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = o.data
    o.modifiers.clear()
    o.data = me
    if old.users == 0: bpy.data.meshes.remove(old)
def kill(o):
    me = o.data if o.type == 'MESH' else None
    bpy.data.objects.remove(o, do_unlink=True)
    if me is not None and me.users == 0: bpy.data.meshes.remove(me)
def tris_of(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == 'MESH' else 0

# ---------------------------------------------------------------- kinds (the surface each face is)
# linear base colour, roughness, metalness: the preview look before the bake, and the bake's start
KINDS = {
    'blued':     ((0.050, 0.054, 0.062), 0.50, 1.0),  # blued steel: dark, a soft sheen
    'worn':      ((0.13, 0.13, 0.128), 0.36, 1.0),    # bare steel: barrels, bolts, carriers
    'parker':    ((0.045, 0.045, 0.043), 0.60, 0.9),  # phosphated / dull steel
    'black':     ((0.012, 0.012, 0.012), 0.6, 0.0),   # bores, holes
    'cavity':    ((0.024, 0.024, 0.025), 0.62, 0.35),  # the insides of cuts: ports, slots, wells (dark: no AO in the viewmodel pass)
    'wood':      ((0.20, 0.075, 0.03), 0.45, 0.0),    # the Mosin's birch
    'laminate':  ((0.12, 0.04, 0.018), 0.42, 0.0),    # the AKM's laminated birch
    'bakelite':  ((0.035, 0.02, 0.012), 0.35, 0.0),   # the PM's and the flare pistol's grips
    'plum':      ((0.16, 0.035, 0.014), 0.38, 0.0),   # the AKM's moulded magazine and grip
    'brass':     ((0.75, 0.55, 0.28), 0.30, 1.0),
    'steelcase': ((0.32, 0.29, 0.17), 0.42, 0.75),    # lacquered steel cases (7.62x39)
    'copper':    ((0.62, 0.34, 0.20), 0.32, 1.0),
    'flarered':  ((0.34, 0.02, 0.015), 0.72, 0.0),
    'paper':     ((0.52, 0.47, 0.36), 0.85, 0.0),
    'plastic':   ((0.025, 0.025, 0.025), 0.55, 0.0),
    'striker':   ((0.05, 0.045, 0.04), 0.95, 0.0),
    'igniter':   ((0.06, 0.05, 0.045), 0.9, 0.0),
    'glove':     ((0.075, 0.037, 0.018), 0.62, 0.0),
    'sleeve':    ((0.018, 0.024, 0.045), 0.95, 0.0),
    'cuff':      ((0.028, 0.03, 0.036), 1.0, 0.0),
    'red':       ((0.45, 0.02, 0.015), 0.5, 0.0),      # a painted dot
}
KLIST = list(KINDS)
KID = {k: i for i, k in enumerate(KLIST)}
def kmat(k):
    m = bpy.data.materials.get('K_' + k)
    if m is None:
        rgb, r, mt = KINDS[k]
        m = C.mat('K_' + k, rgb, r, mt)
    return m

# ---------------------------------------------------------------- 2D shapes
def area2(p):
    return 0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))
def ccw(p): return list(p) if area2(p) > 0 else list(reversed(p))

def fillet(pts, r, seg=4):
    """a closed polygon with each corner rounded (r: one radius or one per corner, 0 = sharp)"""
    n = len(pts)
    rr = list(r) if isinstance(r, (list, tuple)) else [r] * n
    out = []
    for i in range(n):
        P = Vector(pts[i]); A = Vector(pts[i - 1]); B = Vector(pts[(i + 1) % n])
        ri = rr[i]
        u = A - P; lu = u.length; v = B - P; lv = v.length
        if ri <= 0 or lu < 1e-9 or lv < 1e-9:
            out.append((P.x, P.y)); continue
        u /= lu; v /= lv
        ang = math.acos(max(-1.0, min(1.0, u.dot(v))))
        if ang < 1e-3 or ang > PI - 1e-3:
            out.append((P.x, P.y)); continue
        d = ri / math.tan(ang / 2)
        dm = 0.5 * min(lu, lv) * 0.999
        if d > dm: d = dm; ri = d * math.tan(ang / 2)
        T1 = P + u * d; T2 = P + v * d
        bis = (u + v).normalized(); Cc = P + bis * (ri / math.sin(ang / 2))
        a1 = math.atan2(T1.y - Cc.y, T1.x - Cc.x); a2 = math.atan2(T2.y - Cc.y, T2.x - Cc.x)
        da = (a2 - a1 + PI) % (2 * PI) - PI
        for k in range(seg + 1):
            a = a1 + da * k / seg
            out.append((Cc.x + ri * math.cos(a), Cc.y + ri * math.sin(a)))
    return out

def rrect(x0, y0, x1, y1, r, seg=4):
    """a rounded rectangle (r: one radius or (x1y1, x0y1, x0y0, x1y0)), counter-clockwise"""
    if not isinstance(r, (list, tuple)): r = [r] * 4
    return fillet([(x1, y1), (x0, y1), (x0, y0), (x1, y0)], list(r), seg)

def circle(cx, cy, r, n=24, a0=0.0):
    return [(cx + r * math.cos(a0 + 2 * PI * k / n), cy + r * math.sin(a0 + 2 * PI * k / n)) for k in range(n)]

def sellipse(a, b, p=2.5, n=32, cx=0.0, cy=0.0):
    """a superellipse |x/a|^p + |y/b|^p = 1 (rounded-square sections for stocks and handguards)"""
    out = []
    for k in range(n):
        t = 2 * PI * k / n
        c, s = math.cos(t), math.sin(t)
        out.append((cx + a * math.copysign(abs(c) ** (2 / p), c), cy + b * math.copysign(abs(s) ** (2 / p), s)))
    return out

def catmull(pts, n=6, closed=False):
    """a smooth curve through points (each span split in n)"""
    P = [Vector(p) for p in pts]
    m = len(P)
    out = []
    spans = m if closed else m - 1
    for i in range(spans):
        p0 = P[(i - 1) % m] if closed else P[max(i - 1, 0)]
        p1 = P[i % m]; p2 = P[(i + 1) % m]
        p3 = P[(i + 2) % m] if closed else P[min(i + 2, m - 1)]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append(tuple(q))
    if not closed: out.append(tuple(P[-1]))
    return out

def resample(pts, n, closed=True):
    """n points evenly spaced along a polyline (so lofted sections have equal counts)"""
    P = [Vector(p) for p in pts]
    if closed: P = P + [P[0]]
    L = [0.0]
    for i in range(1, len(P)): L.append(L[-1] + (P[i] - P[i - 1]).length)
    tot = L[-1]; out = []; j = 0
    cnt = n if closed else n - 1
    for k in range(n):
        s = tot * k / cnt
        while j < len(L) - 2 and L[j + 1] < s: j += 1
        t = (s - L[j]) / max(L[j + 1] - L[j], 1e-12)
        out.append(tuple(P[j].lerp(P[j + 1], min(max(t, 0), 1))))
    return out

def hull2d(pts):
    P = sorted(set((round(p[0], 7), round(p[1], 7)) for p in pts))
    if len(P) < 3: return P
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def star5(r, ri):
    return [((r if k % 2 == 0 else ri) * math.sin(k * PI / 5), (r if k % 2 == 0 else ri) * math.cos(k * PI / 5)) for k in range(10)][::-1]

# ---------------------------------------------------------------- 3D geometry into a bmesh (three coords)
AX = {'x': ((1, 2, 0)), 'y': ((0, 2, 1)), 'z': ((0, 1, 2))}
def _put(a, b, t, axis):
    """a profile point (a, b) at t along an axis: 'x' profiles are (z, y), 'y' (x, z), 'z' (x, y)"""
    if axis == 'x': return Vector((t, b, a))
    if axis == 'y': return Vector((a, t, b))
    return Vector((a, b, t))

def prism(bm, poly, axis, t0, t1, k='blued'):
    poly = ccw(poly)
    bot = [bm.verts.new(_put(a, b, t0, axis)) for a, b in poly]
    top = [bm.verts.new(_put(a, b, t1, axis)) for a, b in poly]
    fs = [bm.faces.new(list(reversed(bot))), bm.faces.new(top)]
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((bot[i], bot[j], top[j], top[i])))
    for f in fs: f.material_index = KID[k]
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs

def loft(bm, rings, k='blued', cap0=True, cap1=True, closed=True, kinds=None):
    vs = [[bm.verts.new(Vector(p)) for p in ring] for ring in rings]
    n = len(rings[0]); fs = []
    for i in range(len(rings) - 1):
        for j in range(n if closed else n - 1):
            j1 = (j + 1) % n
            f = bm.faces.new((vs[i][j], vs[i][j1], vs[i + 1][j1], vs[i + 1][j]))
            f.material_index = KID[kinds[i] if kinds else k]
            fs.append(f)
    if cap0:
        f = bm.faces.new(list(reversed(vs[0]))); f.material_index = KID[kinds[0] if kinds else k]; fs.append(f)
    if cap1:
        f = bm.faces.new(vs[-1]); f.material_index = KID[kinds[-1] if kinds else k]; fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs

def ring3(sec, origin, u, v):
    o = Vector(origin); u = Vector(u); v = Vector(v)
    return [tuple(o + u * a + v * b) for a, b in sec]

def lathe(bm, prof, segs=24, axis='z', c=(0, 0), k='blued', a0=0.0, a1=2 * PI, kinds=None, closed=True):
    """revolve a profile of (r, t) about an axis through c (in the other two axes); prof is a
    closed loop by default (r = 0 points become poles); kinds: one per profile segment"""
    full = abs(a1 - a0 - 2 * PI) < 1e-6
    na = segs if full else segs + 1
    rings = []
    for r, t in prof:
        if r < 1e-7:
            pole = Vector((c[0], c[1], t)) if axis == 'z' else (Vector((t, c[0], c[1])) if axis == 'x' else Vector((c[0], t, c[1])))
            rings.append([bm.verts.new(pole)])
            continue
        ring = []
        for j in range(na):
            a = a0 + (a1 - a0) * j / segs
            ca, sa = math.cos(a), math.sin(a)
            if axis == 'z': p = Vector((c[0] + r * ca, c[1] + r * sa, t))
            elif axis == 'x': p = Vector((t, c[0] + r * ca, c[1] + r * sa))
            else: p = Vector((c[0] + r * ca, t, c[1] + r * sa))
            ring.append(bm.verts.new(p))
        rings.append(ring)
    fs = []
    m = len(rings)
    spans = m if closed else m - 1
    for i in range(spans):
        A, B = rings[i], rings[(i + 1) % m]
        kk = KID[kinds[i] if kinds else k]
        if len(A) == 1 and len(B) == 1: continue
        for j in range(segs if full else segs):
            j1 = (j + 1) % na if full else j + 1
            if len(A) == 1: q = (A[0], B[j], B[j1])
            elif len(B) == 1: q = (A[j], B[0], A[j1])
            else: q = (A[j], B[j], B[j1], A[j1])
            try:
                f = bm.faces.new(q); f.material_index = kk; fs.append(f)
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs

def frames_along(path, side=None, closed=False):
    P = [Vector(p) for p in path]
    n = len(P); out = []
    for i in range(n):
        if closed: t = P[(i + 1) % n] - P[i - 1]
        else: t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        t.normalize()
        s = Vector(side) if side is not None else (Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0)))
        a = (s - t * s.dot(t)).normalized(); b = t.cross(a)
        out.append((P[i], t, a, b))
    return out

def sweep(bm, path, sec, k='blued', side=None, closed=False, caps=True, scale=None):
    """a section (a along `side`, b along tangent x side) swept along a path"""
    rings = []
    for i, (p, t, a, b) in enumerate(frames_along(path, side, closed)):
        s = scale[i] if scale is not None else 1.0
        rings.append([tuple(p + a * (x * s) + b * (y * s)) for x, y in sec])
    if closed: rings.append(rings[0])
    fs = loft(bm, rings, k, cap0=caps and not closed, cap1=caps and not closed)
    if closed: bmesh.ops.remove_doubles(bm, verts=list({v for f in fs for v in f.verts}), dist=1e-7)
    return fs

def torus(bm, c, R, r, axis='x', seg=24, rseg=8, k='blued'):
    c = Vector(c)
    if axis == 'x': e1, e2 = Vector((0, 1, 0)), Vector((0, 0, 1))
    elif axis == 'y': e1, e2 = Vector((1, 0, 0)), Vector((0, 0, 1))
    else: e1, e2 = Vector((1, 0, 0)), Vector((0, 1, 0))
    path = [tuple(c + e1 * (R * math.cos(2 * PI * i / seg)) + e2 * (R * math.sin(2 * PI * i / seg))) for i in range(seg)]
    return sweep(bm, path, circle(0, 0, r, rseg), k, side=e1.cross(e2), closed=True)

def cyl(bm, c, r, length, axis='z', segs=16, k='blued', r2=None):
    """a capped cylinder (a cone with r2: r at the low end) centred at c along an axis"""
    return _cyl(bm, Vector(c), r, r if r2 is None else r2, length, axis, segs, k)

def _cyl(bm, c, r, rb, length, axis, segs, k):
    h = length / 2
    if axis == 'z': cc, t0 = (c.x, c.y), c.z
    elif axis == 'x': cc, t0 = (c.y, c.z), c.x
    else: cc, t0 = (c.x, c.z), c.y
    return lathe(bm, [(0, t0 - h), (r, t0 - h), (rb, t0 + h), (0, t0 + h)], segs, axis, cc, k)

def box(bm, c, size, k='blued', rot=None):
    r = bmesh.ops.create_cube(bm, size=1.0)
    vs = r['verts']
    bmesh.ops.scale(bm, vec=size, verts=vs)
    if rot is not None:
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=frame3((0, 0, 0), rot).to_3x3())
    bmesh.ops.translate(bm, vec=c, verts=vs)
    fs = list({f for v in vs for f in v.link_faces})
    for f in fs: f.material_index = KID[k]
    return fs

def xform(bm, M, verts=None):
    """move geometry (a three-space 4x4)"""
    for v in (verts if verts is not None else bm.verts): v.co = M @ v.co

# ---------------------------------------------------------------- pieces and parts
class Part:
    """a moving part (or the static body): its frame in model space (three), its pieces; pieces
    are given in model space (or in the part's own frame with local=True) and stored in the
    part's frame, in Blender's axes"""
    def __init__(self, name, frame=None, parent=None, empty=False):
        self.name = name
        self.M = frame if frame is not None else Matrix.Identity(4)
        self.parent = parent
        self.pieces = []
        self.obj = None
        self.empty = empty
        self.children = []
        if parent is not None: parent.children.append(self)

    def piece(self, build, name='p', local=False, ops=(), smooth=40, wn=True, uvd=1.0, wset=None, uva=58):
        """build(bm) adds geometry; ops in order: ('bevel', width, segments, angle deg),
        ('cut', fn) / ('cut', fn, 'INTERSECT' | 'UNION'): booleans with what fn(bm) builds"""
        bm = bmesh.new()
        build(bm)
        if not local: xform(bm, self.M.inverted())
        xform(bm, CINV)
        me = bpy.data.meshes.new(self.name + '_' + name)
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(self.name + '_' + name, me)
        SC.collection.objects.link(o)
        for k in KLIST: me.materials.append(kmat(k))
        for op in ops:
            if op[0] == 'bevel':
                w, seg, ang = (list(op[1:]) + [30])[:3]
                m = o.modifiers.new('bv', 'BEVEL')
                m.width = w; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(ang)
                m.use_clamp_overlap = True; m.miter_outer = 'MITER_ARC'; m.profile = 0.5
                apply_mods(o)
            elif op[0] == 'smooth':
                m = o.modifiers.new('sm', 'SMOOTH'); m.factor = op[1]; m.iterations = op[2]
                apply_mods(o)
            elif op[0] == 'decimate':
                m = o.modifiers.new('dc', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = min(1.0, op[1] / max(1, tris_of(o)))
                apply_mods(o)
            elif op[0] == 'cut':
                fn = op[1]; how = op[2] if len(op) > 2 else 'DIFFERENCE'
                cb = bmesh.new(); fn(cb)
                if not local: xform(cb, self.M.inverted())
                xform(cb, CINV)
                cme = bpy.data.meshes.new('_cut'); cb.to_mesh(cme); cb.free()
                co = bpy.data.objects.new('_cut', cme); SC.collection.objects.link(co)
                for k in KLIST: cme.materials.append(kmat(k))
                m = o.modifiers.new('bo', 'BOOLEAN'); m.object = co; m.operation = how; m.solver = 'EXACT'
                m.use_self = True; m.use_hole_tolerant = True
                nv = len(o.data.vertices)
                apply_mods(o)
                tidy(o)
                if DEBUG_OPS: log(f'    {self.name}_{name} {how.lower()}: {nv} -> {len(o.data.vertices)} verts')
                kill(co)
        if o.data.validate(verbose=False, clean_customdata=False):
            log(f'    {o.name}: invalid geometry cleaned')
        finish(o, smooth, wn)
        uv_piece(o, uvd, uva)
        me = o.data
        if wset is None:
            mi = np.empty(len(me.polygons), np.int64); me.polygons.foreach_get('material_index', mi)
            fur = np.isin(mi, [KID[k] for k in FURNITURE]).mean() if len(mi) else 0
            wset = 1 if fur > 0.5 else 0
        at = me.attributes.new('wset', 'INT', 'FACE')
        at.data.foreach_set('value', [int(wset)] * len(me.polygons))
        self.pieces.append(o)
        return o

def tidy(o, ang=0.25):
    """merge the coplanar fragments a boolean leaves (big flat faces shade flat again)"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(ang), use_dissolve_boundaries=False,
                             verts=list(bm.verts), edges=list(bm.edges), delimit={'MATERIAL'})
    bm.to_mesh(o.data); bm.free()

def finish(o, sharp=40, wn=True):
    if globals().get('NO_WN'): wn = False
    me = o.data
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    if sharp: me.set_sharp_from_angle(angle=math.radians(sharp))
    if wn:
        m = o.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.keep_sharp = True; m.weight = 50; m.mode = 'FACE_AREA'
        apply_mods(o)

def join_ops(objs, name):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name; objs[0].data.name = name; return objs[0]
    t = objs[0]
    for o in SC.objects: o.select_set(False, view_layer=SC.view_layers[0])
    for o in objs: o.select_set(True, view_layer=SC.view_layers[0])
    SC.view_layers[0].objects.active = t
    with ctx(active_object=t, object=t, selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    t.name = name; t.data.name = name
    return t

def assemble(root_name, parts, empties):
    """the root empty, the parts parented under it (or under each other) at their frames, the
    empties (name, matrix in model space, parent part or None)"""
    root = bpy.data.objects.new(root_name, None)
    root.empty_display_size = 0.05
    SC.collection.objects.link(root)
    made = {}
    for p in parts:
        if p.pieces:
            o = join_ops(p.pieces, p.name)
        else:
            o = bpy.data.objects.new(p.name, None); o.empty_display_size = 0.01; SC.collection.objects.link(o)
        par = made[p.parent.name] if p.parent is not None else root
        pM = p.parent.M if p.parent is not None else Matrix.Identity(4)
        o.parent = par
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_basis = to_b(pM).inverted() @ to_b(p.M)
        p.obj = o
        made[p.name] = o
    for name, M, parent in empties:
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'ARROWS'; e.empty_display_size = 0.015
        SC.collection.objects.link(e)
        par = parent.obj if parent is not None else root
        pM = parent.M if parent is not None else Matrix.Identity(4)
        e.parent = par
        e.matrix_parent_inverse = Matrix.Identity(4)
        e.matrix_basis = to_b(pM).inverted() @ to_b(M)
    return root

def meshes_under(root):
    out = []
    def walk(o):
        if o.type == 'MESH': out.append(o)
        for c in o.children: walk(c)
    walk(root)
    return out

# ---------------------------------------------------------------- noise (numpy, aperiodic)
_TAB = np.random.default_rng(1234).random(1 << 20).astype(np.float32)
_MASK = (1 << 20) - 1
def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761 + 97)
    return _TAB[h & _MASK]
def vnoise(P, scale, seed=0):
    """smooth value noise 0..1 at points P (n, 3)"""
    q = P.astype(np.float64) / scale
    i = np.floor(q); f = (q - i).astype(np.float32); i = i.astype(np.int64)
    u = f * f * (3 - 2 * f)
    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    def g(dx, dy, dz): return _hash(x + dx, y + dy, z + dz, seed)
    a = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * u[:, 0]
    b = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * u[:, 0]
    c = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * u[:, 0]
    d = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * u[:, 0]
    e = a + (b - a) * u[:, 1]; h = c + (d - c) * u[:, 1]
    return e + (h - e) * u[:, 2]
def fbm(P, scale, seed=0, octaves=4, gain=0.5, lac=2.03):
    s = np.zeros(len(P), np.float32); amp = 1.0; tot = 0.0; sc = scale
    for k in range(octaves):
        s += (vnoise(P, sc, seed * 31 + k) - 0.5) * amp; tot += amp; amp *= gain; sc /= lac
    return 0.5 + s / tot * 1.6
def aniso(P, scale, stretch, seed=0, octaves=3):
    """noise stretched along the axes by `stretch` (x, y, z): streaks, grain"""
    return fbm(P / np.array(stretch, np.float32)[None, :], scale, seed, octaves)

# a tile of scratches (0.1 m, 0.1 mm a pixel) for triplanar lookups
_SCR = {}
def scratch_tile(seed=3, n=260, length=0.010, width=0.00005):
    if seed in _SCR: return _SCR[seed]
    S = 1024; px = 0.1 / S
    a = TL.scratches(S, S, n, length / px, width / px, seed)
    a = np.maximum(a * 0.8, TL.scratches(S, S, n // 5, length * 2.5 / px, width * 0.8 / px, seed + 1) * 0.5)
    _SCR[seed] = a.astype(np.float32)
    return _SCR[seed]
def sample2(img, u, v, period):
    """bilinear lookup of a periodic tile at coordinates in metres"""
    H, W = img.shape
    x = (u / period * W) % W; y = (v / period * H) % H
    x0 = np.floor(x).astype(np.int64); y0 = np.floor(y).astype(np.int64)
    fx = (x - x0).astype(np.float32); fy = (y - y0).astype(np.float32)
    x0 %= W; y0 %= H
    x1 = (x0 + 1) % W; y1 = (y0 + 1) % H
    a = img[y0, x0] + (img[y0, x1] - img[y0, x0]) * fx
    b = img[y1, x0] + (img[y1, x1] - img[y1, x0]) * fx
    return a + (b - a) * fy
def triplanar(img, P, N, period, sharp=6):
    w = np.abs(N) ** sharp; w /= w.sum(1, keepdims=True) + 1e-9
    return (sample2(img, P[:, 2], P[:, 1], period) * w[:, 0] + sample2(img, P[:, 0], P[:, 2] + 0.37, period) * w[:, 1]
            + sample2(img, P[:, 0] + 0.61, P[:, 1], period) * w[:, 2])

# ---------------------------------------------------------------- stamps (markings as masks)
def text_mask(text, height, px, font='ARIALN.TTF', spacing=1.0, aa=3):
    """a text's coverage mask (rows = up), its capitals `height` metres tall, px metres a pixel"""
    cu = bpy.data.curves.new('_txt', 'FONT')
    cu.body = text
    try: cu.font = bpy.data.fonts.load(os.path.join(FONTS, font), check_existing=True)
    except Exception: pass
    cu.size = 1.0; cu.space_character = spacing; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('_txt', cu); SC.collection.objects.link(ob)
    with ctx():
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True); bpy.data.curves.remove(cu)
    me.calc_loop_triangles()
    co = np.array([v.co[:2] for v in me.vertices], np.float32)
    tv = np.array([t.vertices[:] for t in me.loop_triangles], np.int64)
    bpy.data.meshes.remove(me)
    lo, hi = co.min(0), co.max(0)
    # the capital height: the tallest glyph's extent
    s = height / max(hi[1] - lo[1], 1e-6)
    co = (co - (lo + hi) / 2) * s
    w, h = (hi[0] - lo[0]) * s, (hi[1] - lo[1]) * s
    W = int(math.ceil(w / px)) + 4; H = int(math.ceil(h / px)) + 4
    T = (co[tv] / (px / aa) + np.array([W * aa / 2, H * aa / 2], np.float32))
    F, _ = rasterize(T, W * aa, H * aa)
    m = (F >= 0).astype(np.float32).reshape(H, aa, W, aa).mean((1, 3))
    return m, W * px, H * px

def poly_mask(poly, px, aa=3):
    """a filled 2D polygon's mask (centred), with its size in metres"""
    P = np.array(poly, np.float32)
    lo, hi = P.min(0), P.max(0)
    W = int(math.ceil((hi[0] - lo[0]) / px)) + 4; H = int(math.ceil((hi[1] - lo[1]) / px)) + 4
    c = (lo + hi) / 2
    tri = [(0, i, i + 1) for i in range(1, len(P) - 1)]      # a fan (the polygons used are star-shaped from their first point)
    T = ((P[np.array(tri)] - c) / (px / aa) + np.array([W * aa / 2, H * aa / 2], np.float32))
    F, _ = rasterize(T, W * aa, H * aa)
    return (F >= 0).astype(np.float32).reshape(H, aa, W, aa).mean((1, 3)), W * px, H * px

class Stamp:
    """a mask laid on a surface: centre, the mask's right and up directions (three space), the
    faces it may land on (their normals within ~45 degrees of `n`)"""
    def __init__(self, mask, w, h, c, right, up, n=None, depth=0.00004, kind='engrave'):
        self.mask, self.w, self.h = mask, w, h
        self.c = np.array(c, np.float32); self.r = np.array(Vector(right).normalized(), np.float32)
        self.u = np.array(Vector(up).normalized(), np.float32)
        self.n = np.array(Vector(n).normalized(), np.float32) if n is not None else np.cross(self.r, self.u)
        self.depth = depth; self.kind = kind
    def at(self, P, N):
        d = P - self.c[None]
        a = d @ self.r; b = d @ self.u; c = d @ self.n
        H, W = self.mask.shape
        x = (a / self.w + 0.5) * W - 0.5; y = (b / self.h + 0.5) * H - 0.5
        ok = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1) & (np.abs(c) < 0.004) & ((N @ self.n) > 0.6)
        out = np.zeros(len(P), np.float32)
        if not ok.any(): return out
        xi = x[ok]; yi = y[ok]
        x0 = np.floor(xi).astype(np.int64); y0 = np.floor(yi).astype(np.int64)
        fx = xi - x0; fy = yi - y0
        m = self.mask
        va = m[y0, x0] + (m[y0, x0 + 1] - m[y0, x0]) * fx
        vb = m[y0 + 1, x0] + (m[y0 + 1, x0 + 1] - m[y0 + 1, x0]) * fx
        out[ok] = va + (vb - va) * fy
        return out

# ---------------------------------------------------------------- the rasteriser
def rasterize(T, W, H, eps=1e-4):
    """triangles in pixel space (n, 3, 2) -> per pixel the triangle (-1: none) and barycentrics"""
    F = np.full((H, W), -1, np.int32)
    Bc = np.zeros((H, W, 3), np.float32)
    mn = np.floor(T.min(1)).astype(np.int64); mx = np.ceil(T.max(1)).astype(np.int64)
    for i in range(len(T)):
        x0 = max(int(mn[i, 0]), 0); y0 = max(int(mn[i, 1]), 0)
        x1 = min(int(mx[i, 0]) + 1, W); y1 = min(int(mx[i, 1]) + 1, H)
        if x1 <= x0 or y1 <= y0: continue
        (ax, ay), (bx, by), (cx, cy) = T[i]
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12: continue
        xs = np.arange(x0, x1, dtype=np.float32) + 0.5; ys = np.arange(y0, y1, dtype=np.float32) + 0.5
        X, Y = np.meshgrid(xs, ys)
        w0 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den
        w1 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den
        w2 = 1 - w0 - w1
        m = (w0 >= -eps) & (w1 >= -eps) & (w2 >= -eps)
        if not m.any(): continue
        rr, cc = np.nonzero(m)
        rr = rr + y0; cc = cc + x0
        F[rr, cc] = i
        Bc[rr, cc, 0] = w0[m]; Bc[rr, cc, 1] = w1[m]; Bc[rr, cc, 2] = w2[m]
    return F, Bc

# ---------------------------------------------------------------- the bake
def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)

def blur_img(a, s):
    return TL.blur(a.astype(np.float32), s) if s > 0 else a

FURNITURE = ('wood', 'laminate', 'plum', 'bakelite')

def uv_piece(o, d=1.0, angle=58):
    """a piece's own UVs (smart projection), scaled so one UV unit is d metres of its surface
    (pieces seen close get more of the atlas: d is their texel-density weight)"""
    vl = SC.view_layers[0]
    for x in SC.objects: x.select_set(False, view_layer=vl)
    o.select_set(True, view_layer=vl); vl.objects.active = o
    with ctx(active_object=o, object=o, selected_objects=[o], selected_editable_objects=[o], edit_object=o):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    me = o.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    if nt == 0: return
    tl = np.empty(nt * 3, np.int64); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    lv = np.empty(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lv)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    P = co[lv[tl]]; U = uv[tl]
    a3 = np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1).sum()
    d1 = U[:, 1] - U[:, 0]; d2 = U[:, 2] - U[:, 0]
    a2 = np.abs(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]).sum()
    k = d * math.sqrt(a3 / max(a2, 1e-14))
    me.uv_layers.active.data.foreach_set('uv', (uv * k).ravel())

def uv_pack(objs, sid=None, margin=0.0025):
    """pack one texture set's islands (the faces whose wset is sid; all with None) into 0..1"""
    vl = SC.view_layers[0]
    for o in SC.objects: o.select_set(False, view_layer=vl)
    for o in objs: o.select_set(True, view_layer=vl)
    vl.objects.active = objs[0]
    SC.tool_settings.use_uv_select_sync = True
    with ctx(active_object=objs[0], object=objs[0], selected_objects=objs, selected_editable_objects=objs, edit_object=objs[0]):
        bpy.ops.object.mode_set(mode='EDIT')
        for o in objs:
            bm = bmesh.from_edit_mesh(o.data)
            lay = bm.faces.layers.int.get('wset')
            for v in bm.verts: v.select = False
            for e in bm.edges: e.select = False
            for f in bm.faces:
                f.select = sid is None or (lay is not None and f[lay] == sid)
            bm.select_flush_mode()
            bmesh.update_edit_mesh(o.data)
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', scale=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')

class Surf:
    """every texel of an atlas a mesh covers: where it is (three model space), its normal, its
    kind, its tangent frame, and masks from the mesh's edges (convex: wear, concave: grime)"""
    def __init__(self, objs, S, sid=None):
        self.S = S
        P0, N0, UV0, K0 = [], [], [], []
        lines = []
        for oi, o in enumerate(objs):
            me = o.data
            me.calc_loop_triangles()
            nt = len(me.loop_triangles)
            tl = np.empty(nt * 3, np.int64); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
            tp = np.empty(nt, np.int64); me.loop_triangles.foreach_get('polygon_index', tp)
            lv = np.empty(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lv)
            co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
            cn = np.empty(len(me.loops) * 3, np.float32); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
            uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
            mi = np.empty(len(me.polygons), np.int64); me.polygons.foreach_get('material_index', mi)
            ws = np.zeros(len(me.polygons), np.int64)
            if 'wset' in me.attributes: me.attributes['wset'].data.foreach_get('value', ws)
            keep = np.ones(nt, bool) if sid is None else (ws[tp] == sid)
            tl = tl[keep]; tp = tp[keep]
            M = np.array(CMAT @ o.matrix_world, np.float32)
            cw = co @ M[:3, :3].T + M[:3, 3]
            nw = cn @ M[:3, :3].T
            P0.append(cw[lv[tl]]); N0.append(nw[tl]); UV0.append(uv[tl]); K0.append(mi[tp])
            # the mesh's creases, drawn into UV space
            bm = bmesh.new(); bm.from_mesh(me)
            ul = bm.loops.layers.uv.active
            wl = bm.faces.layers.int.get('wset')
            for e in bm.edges:
                lf = e.link_faces
                if sid is not None and wl is not None and not any(f[wl] == sid for f in lf): continue
                if len(lf) == 2:
                    ang = e.calc_face_angle_signed(0.0)
                    if abs(ang) < 0.12: continue
                    d = (lf[0].calc_center_median() - lf[1].calc_center_median()).length
                    k = abs(ang) / max(min(d, 0.0015), 0.00008)
                    w = float(np.clip((k - 300.0) / 700.0, 0, 1)) * float(np.clip(abs(ang) / 0.35, 0, 1))
                    if w <= 0.02: continue
                    sgn = 1.0 if ang > 0 else -1.0
                elif len(lf) == 1:
                    w, sgn = 0.6, 1.0
                else:
                    continue
                for l in e.link_loops:
                    a = l[ul].uv; b = l.link_loop_next[ul].uv
                    lines.append((a.x, a.y, b.x, b.y, w * sgn))
            bm.free()
        P0 = np.concatenate(P0); N0 = np.concatenate(N0); UV0 = np.concatenate(UV0); K0 = np.concatenate(K0)
        self.tris = len(P0)
        # metres a texel (for the normal map's finite differences)
        a3 = np.linalg.norm(np.cross(P0[:, 1] - P0[:, 0], P0[:, 2] - P0[:, 0]), axis=1) * 0.5
        d1 = UV0[:, 1] - UV0[:, 0]; d2 = UV0[:, 2] - UV0[:, 0]
        a2 = np.abs(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]) * 0.5 * S * S
        self.px = float(np.sqrt(a3.sum() / max(a2.sum(), 1e-12)))
        # per triangle dP/du, dP/dv
        E1 = P0[:, 1] - P0[:, 0]; E2 = P0[:, 2] - P0[:, 0]
        det = d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]
        det = np.where(np.abs(det) < 1e-14, 1e-14, det)
        Tu = (E1 * d2[:, 1:2] - E2 * d1[:, 1:2]) / det[:, None]
        Tv = (E2 * d1[:, 0:1] - E1 * d2[:, 0:1]) / det[:, None]
        F, Bc = rasterize(UV0 * S, S, S)
        self.valid = F >= 0
        self.flat = np.nonzero(self.valid.ravel())[0]
        f = F.ravel()[self.flat]; b = Bc.reshape(-1, 3)[self.flat]
        self.n = len(f)
        self.P = np.einsum('ij,ijk->ik', b, P0[f]).astype(np.float32)
        N = np.einsum('ij,ijk->ik', b, N0[f]); N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
        self.N = N.astype(np.float32)
        self.K = K0[f]
        T = Tu[f]; T = T - self.N * np.sum(T * self.N, 1, keepdims=True)
        T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
        Bt = np.cross(self.N, T)
        sgn = np.sign(np.sum(Bt * Tv[f], 1)); sgn[sgn == 0] = 1
        self.T = T.astype(np.float32); self.B = (Bt * sgn[:, None]).astype(np.float32)
        # the crease masks
        cv = np.zeros((S, S), np.float32); cc = np.zeros((S, S), np.float32)
        if lines:
            L = np.array(lines, np.float32)
            a = L[:, 0:2] * S; bb = L[:, 2:4] * S; w = L[:, 4]
            ln = np.linalg.norm(bb - a, axis=1)
            cnt = np.maximum(2, np.ceil(ln * 1.5).astype(np.int64) + 1)
            rep = np.repeat(np.arange(len(L)), cnt)
            t = (np.arange(cnt.sum()) - np.repeat(np.cumsum(cnt) - cnt, cnt)) / np.repeat(cnt - 1, cnt)
            pts = a[rep] + (bb[rep] - a[rep]) * t[:, None].astype(np.float32)
            xi = np.clip(pts[:, 0].astype(np.int64), 0, S - 1); yi = np.clip(pts[:, 1].astype(np.int64), 0, S - 1)
            ww = w[rep]
            pos = ww > 0
            np.maximum.at(cv, (yi[pos], xi[pos]), ww[pos])
            np.maximum.at(cc, (yi[~pos], xi[~pos]), -ww[~pos])
        # (the widths in metres: a fraction of a millimetre for wear, wider for grime)
        sp = max(self.px, 1e-5)
        wn = np.clip(blur_img(cv, max(0.7, 0.00028 / sp)) * 3.2, 0, 1)
        wb = np.clip(blur_img(cv, max(1.5, 0.0011 / sp)) * 5.0, 0, 1)
        gn = np.clip(blur_img(cc, max(0.8, 0.0005 / sp)) * 3.0, 0, 1)
        gb = np.clip(blur_img(cc, max(2.0, 0.0022 / sp)) * 5.0, 0, 1)
        self.wear = wn.ravel()[self.flat]; self.wearB = wb.ravel()[self.flat]
        self.cav = gn.ravel()[self.flat]; self.cavB = gb.ravel()[self.flat]
        self.eps = max(self.px * 0.75, 0.00004)

    def kind(self, *names):
        ids = [KID[n] for n in names]
        return np.nonzero(np.isin(self.K, ids))[0]

def pad(img, valid, iters=10):
    """bleed the islands' edge texels outward (mipmaps and filtering never see the empty atlas)"""
    img = img.copy(); v = valid.copy()
    for _ in range(iters):
        acc = np.zeros_like(img); cnt = np.zeros(v.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            sv = np.roll(v, (dy, dx), (0, 1))
            acc += np.roll(img, (dy, dx), (0, 1)) * sv[..., None]
            cnt += sv
        take = (~v) & (cnt > 0)
        img[take] = acc[take] / cnt[take][:, None]
        v = v | take
    if (~v).any():
        img[~v] = img[v].mean(0)
    return img

def bake_asset(name, objs, sets, shade, height):
    """per texture set: pack its islands, rasterise its texels, shade them -> a material (base,
    ORM, normal). sets: [(set id or None, suffix, size)]"""
    out = []
    mats = []
    for sid, suf, S in sets:
        t = time.time()
        uv_pack(objs, sid)
        sf = Surf(objs, S, sid)
        log(f'  {name}{suf}: {sf.tris} tris, {sf.n} texels of {S}x{S} ({sf.n / S / S * 100:.0f}%), {sf.px * 1000:.3f} mm a texel, {time.time() - t:.1f}s')
        t = time.time()
        base = np.zeros((sf.n, 3), np.float32); rough = np.full(sf.n, 0.5, np.float32); metal = np.zeros(sf.n, np.float32)
        shade(sf, base, rough, metal)
        means = {KLIST[k]: [round(float(v), 3) for v in base[sf.K == k].mean(0)] + [round(float(rough[sf.K == k].mean()), 2), round(float(metal[sf.K == k].mean()), 2)]
                 for k in np.unique(sf.K)}
        log(f'  {name}{suf} mean linear albedo, roughness, metalness by kind: {means}')
        h0 = height(sf, sf.P)
        h1 = height(sf, sf.P + sf.T * sf.eps)
        h2 = height(sf, sf.P + sf.B * sf.eps)
        nt = np.stack([-(h1 - h0) / sf.eps, -(h2 - h0) / sf.eps, np.ones(sf.n, np.float32)], 1)
        nt /= np.linalg.norm(nt, axis=1, keepdims=True)
        log(f'  {name}{suf}: shaded {time.time() - t:.1f}s')
        def img(vals, ch):
            a = np.zeros((S * S, ch), np.float32); a[sf.flat] = vals.reshape(sf.n, ch)
            return pad(a.reshape(S, S, ch), sf.valid)
        tag = name + suf
        ib = TL._img(f'TX_{tag}_base', img(srgb(base), 3), 'sRGB')
        orm = np.stack([np.ones(sf.n, np.float32), np.clip(rough, 0.04, 1), np.clip(metal, 0, 1)], 1)
        io = TL._img(f'TX_{tag}_orm', img(orm, 3), 'Non-Color')
        inn = TL._img(f'TX_{tag}_nrm', img(nt * 0.5 + 0.5, 3), 'Non-Color')
        mats.append((sid, TL.pbr('M_' + tag, ((ib, inn, io), 1.0))))
        out.append({'set': tag, 'texels': sf.n, 'px_mm': round(sf.px * 1000, 3), 'size': S, 'tris': sf.tris})
    for o in objs:
        me = o.data
        ws = np.zeros(len(me.polygons), np.int64)
        if 'wset' in me.attributes: me.attributes['wset'].data.foreach_get('value', ws)
        used = [i for i, (sid, m) in enumerate(mats) if sid is None or (ws == sid).any()]
        me.materials.clear()
        for i in used: me.materials.append(mats[i][1])
        if mats[0][0] is None:
            idx = np.zeros(len(me.polygons), np.int64)
        else:
            lut = {mats[i][0]: j for j, i in enumerate(used)}
            idx = np.array([lut.get(int(w), 0) for w in ws], np.int64)
        me.polygons.foreach_set('material_index', idx)
    return out

# ---------------------------------------------------------------- shading the kinds
def lin(c): return np.array(c, np.float32)[None, :]

def sh_steel(sf, ix, base, rough, metal, tone=(0.050, 0.054, 0.062), r0=0.50, holster=0.6, edge=1.0, pits=1.0, seed=0,
             worn_col=(0.165, 0.163, 0.158)):
    P = sf.P[ix]; N = sf.N[ix]
    m1 = fbm(P, 0.035, 1 + seed, 3); m2 = vnoise(P, 0.005, 2 + seed)
    col = lin(tone) * (0.88 + 0.24 * m1)[:, None]
    hw = ss(0.62, 0.85, fbm(P, 0.025, 3 + seed, 4)) * holster * 0.7 * (1 - sf.cavB[ix]) * (1 - np.abs(N[:, 1]) * 0.5)
    brk = vnoise(P, 0.0012, 4 + seed)
    e = np.clip(sf.wear[ix] * (0.45 + 1.0 * brk) + sf.wearB[ix] * ss(0.5, 0.8, fbm(P, 0.003, 5 + seed, 3)) * 0.75, 0, 1) * edge
    scr = triplanar(scratch_tile(3 + seed), P, N, 0.1)
    worn = lin(worn_col)
    col = mix(col, lin(tone) * 1.7, (hw * 0.65)[:, None])
    col = mix(col, worn * (0.9 + 0.2 * m2)[:, None], e[:, None])
    col = mix(col, worn * 0.75, (scr * 0.35)[:, None])
    r = r0 + 0.10 * (m1 - 0.5) + 0.05 * (m2 - 0.5) - hw * 0.06
    r = mix(r, 0.30, e); r = mix(r, 0.34, scr * 0.5)
    pit = ss(0.86, 0.93, vnoise(P, 0.0006, 6 + seed)) * (0.1 + 0.9 * sf.cavB[ix]) * pits
    col = mix(col, lin((0.035, 0.022, 0.014)), pit[:, None]); r = mix(r, 0.62, pit)
    base[ix] = col; rough[ix] = r; metal[ix] = 1 - pit * 0.95

def h_steel(sf, ix, P, seed=0):
    N = sf.N[ix]
    scr = triplanar(scratch_tile(3 + seed), P, N, 0.1)
    pit = ss(0.86, 0.93, vnoise(P, 0.0006, 6 + seed)) * (0.1 + 0.9 * sf.cavB[ix])
    mach = aniso(P, 0.0009, (1, 1, 10), 10 + seed, 2) - 0.5          # faint machining / stamping texture
    return -scr * 0.000007 - pit * 0.000015 + (vnoise(P, 0.0006, 9 + seed) - 0.5) * 0.000003 + mach * 0.000004

def sh_plain(sf, ix, base, rough, metal, kind, var=0.3):
    rgb, r, m = KINDS[kind]
    P = sf.P[ix]
    n = fbm(P, 0.01, 21, 3)
    base[ix] = lin(rgb) * (1 - var / 2 + var * n)[:, None]; rough[ix] = r + 0.08 * (n - 0.5); metal[ix] = m

def sh_bakelite(sf, ix, base, rough, metal, tone=(0.026, 0.013, 0.0075), seed=0):
    P = sf.P[ix]; N = sf.N[ix]
    m1 = fbm(P, 0.006, 31 + seed, 4); m2 = aniso(P, 0.002, (1, 3, 1), 32 + seed)
    col = lin(tone) * (0.75 + 0.5 * m1)[:, None] * (0.92 + 0.16 * m2)[:, None]
    e = np.clip(sf.wear[ix] * (0.5 + vnoise(P, 0.001, 33 + seed)) + sf.wearB[ix] * 0.3, 0, 1)
    scr = triplanar(scratch_tile(7 + seed), P, N, 0.1)
    col = mix(col, col * 1.9 + lin((0.012, 0.006, 0.002)), e[:, None] * 0.7)
    col = mix(col, col * 1.5, (scr * 0.35)[:, None])
    base[ix] = col
    rough[ix] = 0.30 + 0.1 * (m1 - 0.5) + e * 0.22 + scr * 0.15
    metal[ix] = 0

def sh_plum(sf, ix, base, rough, metal, seed=0):
    P = sf.P[ix]; N = sf.N[ix]
    warp = np.stack([fbm(P, 0.02, 41 + seed, 3), fbm(P, 0.02, 42 + seed, 3), fbm(P, 0.02, 43 + seed, 3)], 1) - 0.5
    m = fbm(P + warp * 0.03, 0.008, 44 + seed, 4)
    a = lin((0.135, 0.024, 0.011)); b = lin((0.090, 0.015, 0.007)); c = lin((0.175, 0.042, 0.016))
    col = mix(a, b, (ss(0.35, 0.7, m) * 0.7)[:, None])
    col = mix(col, c, (ss(0.74, 0.82, fbm(P + warp * 0.02, 0.004, 45 + seed, 3)) * 0.35)[:, None])
    e = np.clip(sf.wear[ix] * (0.5 + vnoise(P, 0.001, 46 + seed)) + sf.wearB[ix] * 0.35, 0, 1)
    scr = triplanar(scratch_tile(11 + seed), P, N, 0.1)
    col = mix(col, lin((0.24, 0.07, 0.03)), (e * 0.5 + scr * 0.2)[:, None])
    base[ix] = col
    rough[ix] = 0.36 + 0.08 * (m - 0.5) + e * 0.2 + scr * 0.2
    metal[ix] = 0

def sh_wood(sf, ix, base, rough, metal, light=(0.135, 0.045, 0.016), dark=(0.062, 0.018, 0.007), ring=0.0021,
            centre=(0.04, -0.22), seed=0, varnish=0.36):
    P = sf.P[ix]; N = sf.N[ix]
    Q = P * np.array([1, 1, 0.07], np.float32)
    warp = (fbm(Q, 0.006, 51 + seed, 3) - 0.5) * 0.009 + (fbm(P, 0.002, 52 + seed, 2) - 0.5) * 0.0007
    r = np.hypot(P[:, 0] - centre[0], P[:, 1] - centre[1]) + warp
    late = (0.5 + 0.5 * np.cos(2 * PI * r / ring)) ** 4
    fibre = aniso(P, 0.0005, (1, 1, 14), 53 + seed, 2)
    pores = ss(0.68, 0.8, aniso(P, 0.0003, (1, 1, 9), 54 + seed, 1))
    drift = fbm(P, 0.05, 55 + seed, 3)
    t = np.clip(late * 0.7 + (fibre - 0.5) * 0.35 + (drift - 0.5) * 0.4, 0, 1)
    col = mix(lin(light), lin(dark), t[:, None]) * (1 - 0.25 * pores)[:, None]
    e = np.clip(sf.wear[ix] * (0.4 + vnoise(P, 0.002, 56 + seed)) + sf.wearB[ix] * ss(0.4, 0.75, fbm(P, 0.006, 57 + seed, 3)), 0, 1)
    scr = triplanar(scratch_tile(13 + seed), P, N, 0.1)
    dent = ss(0.8, 0.86, vnoise(P, 0.0015, 58 + seed))
    raw = lin((0.24, 0.11, 0.05))
    col = mix(col, raw * (0.8 + 0.4 * drift)[:, None], (e * 0.55)[:, None])
    col = mix(col, col * 1.45, (scr * 0.45)[:, None])
    col = col * (1 - 0.35 * dent)[:, None]
    base[ix] = col
    rough[ix] = varnish + 0.08 * (drift - 0.5) + pores * 0.15 + e * 0.25 + scr * 0.25 + dent * 0.1
    metal[ix] = 0

def h_wood(sf, ix, P, seed=0):
    N = sf.N[ix]
    pores = ss(0.68, 0.8, aniso(P, 0.0003, (1, 1, 9), 54 + seed, 1))
    fibre = aniso(P, 0.0005, (1, 1, 14), 53 + seed, 2)
    dent = ss(0.8, 0.86, vnoise(P, 0.0015, 58 + seed))
    scr = triplanar(scratch_tile(13 + seed), P, N, 0.1)
    return -pores * 0.000012 + (fibre - 0.5) * 0.000006 - dent * 0.00006 - scr * 0.000008

def sh_laminate(sf, ix, base, rough, metal, ply=0.0016, seed=0):
    """laminated birch: plies stacked across the gun (x), dark glue lines where a curve cuts them"""
    P = sf.P[ix]; N = sf.N[ix]
    warp = (fbm(P * np.array([1, 1, 0.1], np.float32), 0.01, 61 + seed, 3) - 0.5) * 0.0018
    q = (P[:, 0] + warp) / ply
    k = np.floor(q).astype(np.int64)
    d = np.abs(q - np.round(q))
    glue = np.exp(-(d / 0.06) ** 2)
    tint = _hash(k, k * 3 + 1, k * 7 + 2, 62 + seed)
    tones = np.stack([lin((0.100, 0.026, 0.009))[0], lin((0.072, 0.017, 0.007))[0], lin((0.130, 0.038, 0.014))[0]])
    col = tones[(tint * 2.999).astype(np.int64)]
    grain = aniso(P + (k * 0.013)[:, None].astype(np.float32), 0.0007, (1, 1, 16), 63 + seed, 3)
    col = col * (0.78 + 0.44 * grain)[:, None]
    col = mix(col, lin((0.022, 0.007, 0.004)), (glue * 0.8)[:, None])
    e = np.clip(sf.wear[ix] * (0.4 + vnoise(P, 0.002, 64 + seed)) + sf.wearB[ix] * ss(0.45, 0.75, fbm(P, 0.006, 65 + seed, 3)), 0, 1)
    scr = triplanar(scratch_tile(17 + seed), P, N, 0.1)
    col = mix(col, lin((0.20, 0.09, 0.04)), (e * 0.45)[:, None])
    col = mix(col, col * 1.35, (scr * 0.3)[:, None])
    base[ix] = col
    rough[ix] = 0.34 + 0.06 * (grain - 0.5) + e * 0.25 + scr * 0.22 + glue * 0.08
    metal[ix] = 0

def h_laminate(sf, ix, P, seed=0):
    N = sf.N[ix]
    grain = aniso(P, 0.0007, (1, 1, 16), 63 + seed, 2)
    scr = triplanar(scratch_tile(17 + seed), P, N, 0.1)
    return (grain - 0.5) * 0.000014 - scr * 0.000012

def sh_brass(sf, ix, base, rough, metal, tone=(0.75, 0.55, 0.28), seed=0):
    P = sf.P[ix]
    n = fbm(P, 0.004, 71 + seed, 3)
    tarn = ss(0.55, 0.8, fbm(P, 0.006, 72 + seed, 3)) * 0.6 + sf.cavB[ix] * 0.6
    col = lin(tone) * (0.9 + 0.2 * n)[:, None]
    col = mix(col, lin(tone) * lin((0.5, 0.4, 0.3)), np.clip(tarn, 0, 1)[:, None])
    base[ix] = col; rough[ix] = 0.26 + 0.15 * tarn + 0.05 * (n - 0.5); metal[ix] = 1

def overlay_dust(sf, base, rough, metal, amount=1.0, ix=None):
    """grime in the creases, dust settled on what faces up"""
    ix = np.arange(sf.n) if ix is None else ix
    P = sf.P[ix]; N = sf.N[ix]
    up = ss(0.55, 0.98, N[:, 1])
    d = np.clip(sf.cavB[ix] * 0.55 + up * 0.10 * ss(0.55, 0.8, fbm(P, 0.006, 81, 3)) + sf.cav[ix] * 0.25, 0, 1) * amount
    g = np.clip(sf.cav[ix] * 0.8 + sf.cavB[ix] * 0.3, 0, 1)
    b = base[ix] * (1 - 0.45 * g)[:, None]
    b = mix(b, lin((0.15, 0.14, 0.125)), (d * 0.5)[:, None])
    base[ix] = b
    rough[ix] = mix(rough[ix], 0.85, d * 0.7)
    metal[ix] = metal[ix] * (1 - d * 0.8)

def apply_stamps(sf, stamps, base, rough, metal, P=None):
    """engraved (darker, a groove) or painted markings"""
    P = sf.P if P is None else P
    for st in stamps:
        m = st.at(P, sf.N)
        hit = m > 0.02
        if not hit.any(): continue
        mm = m[hit]
        if st.kind == 'engrave':
            base[hit] = mix(base[hit], base[hit] * 0.45, mm[:, None])
            rough[hit] = mix(rough[hit], 0.6, mm)
        elif st.kind == 'bright':
            base[hit] = mix(base[hit], lin((0.42, 0.41, 0.4)), (mm * 0.6)[:, None])
            rough[hit] = mix(rough[hit], 0.32, mm)
        elif st.kind == 'red':
            base[hit] = mix(base[hit], lin((0.5, 0.025, 0.02)), mm[:, None]); rough[hit] = mix(rough[hit], 0.5, mm); metal[hit] = metal[hit] * (1 - mm)
        elif st.kind == 'ink':
            base[hit] = mix(base[hit], lin((0.02, 0.018, 0.016)), (mm * 0.92)[:, None]); rough[hit] = mix(rough[hit], 0.7, mm)
        elif st.kind == 'white':
            base[hit] = mix(base[hit], lin((0.75, 0.72, 0.65)), (mm * 0.9)[:, None]); rough[hit] = mix(rough[hit], 0.6, mm); metal[hit] = metal[hit] * (1 - mm)

def stamp_height(sf, stamps, P):
    h = np.zeros(len(P), np.float32)
    for st in stamps:
        if st.kind in ('engrave', 'bright'):
            h -= st.at(P, sf.N) * st.depth
    return h

# ---------------------------------------------------------------- export, previews
def export(sc, fname):
    path = os.path.join(C.raw_dir(), fname)
    for o in list(sc.objects):
        if o.name.startswith('_'): kill(o)
    size = C.export_glb(sc, path)
    return path, size

def world_studio(sc):
    w = bpy.data.worlds.get('_studio') or bpy.data.worlds.new('_studio')
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].position = 0.30; ramp.color_ramp.elements[0].color = (0.03, 0.03, 0.035, 1)
    ramp.color_ramp.elements[1].position = 0.95; ramp.color_ramp.elements[1].color = (0.55, 0.58, 0.64, 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.5
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    sc.world = w

LIGHTS = (('_key', (-0.5, 0.6, 0.5), 22, 0.4), ('_rim', (0.6, 0.3, -0.6), 16, 0.3), ('_fill', (0.4, -0.3, 0.6), 5, 0.6))
def previews(sc, name, views, res=(1100, 760), samples=48):
    """views: (tag, camera position, target, lens mm) in three space"""
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    try: sc.eevee.taa_render_samples = samples
    except Exception: pass
    try: sc.view_settings.view_transform = 'AgX'
    except Exception: pass
    world_studio(sc)
    cam = bpy.data.objects.new('_pcam', bpy.data.cameras.new('_pcam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.clip_start = 0.005; cam.data.clip_end = 50
    lights = []
    for nm, d, energy, size in LIGHTS:
        ld = bpy.data.lights.new(nm, 'AREA'); ld.energy = energy; ld.size = size
        lo = bpy.data.objects.new(nm, ld); sc.collection.objects.link(lo); lights.append(lo)
    out = []
    for view in views:
        tag, loc, tgt, lens = view[:4]
        pose = view[4] if len(view) > 4 else {}
        saved = {}
        for pn, (dz, rx, rz) in pose.items():
            o = sc.objects.get(pn)
            if o is None: continue
            saved[pn] = o.matrix_basis.copy()
            D = Matrix.Translation((0, 0, dz)) @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(rz, 4, 'Z')
            T = to_b(Matrix.Translation((0, 0, dz))); R = to_b(Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(rz, 4, 'Z'))
            o.matrix_basis = T @ o.matrix_basis @ R
        L = (CINV @ Vector(loc).to_4d()).to_3d(); Tg = (CINV @ Vector(tgt).to_4d()).to_3d()
        cam.data.lens = lens
        cam.location = L
        cam.rotation_euler = (Tg - L).to_track_quat('-Z', 'Y').to_euler()
        for lo, (nm, d, e, s) in zip(lights, LIGHTS):
            lo.location = Tg + (CINV.to_3x3() @ Vector(d)) * 1.2
            lo.rotation_euler = (Tg - lo.location).to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(C.preview_dir(), f'{name}_{tag}.png')
        sc.render.filepath = path
        with ctx():
            bpy.ops.render.render(write_still=True, scene=sc.name)
        out.append(path)
        for pn, M in saved.items(): sc.objects[pn].matrix_basis = M
    kill(cam)
    for lo in lights: kill(lo)
    return out

# ---------------------------------------------------------------- shared shading helpers
def to_local(M, P, N=None):
    Mi = np.array(M.inverted(), np.float32)
    q = P @ Mi[:3, :3].T + Mi[:3, 3]
    return (q, N @ Mi[:3, :3].T) if N is not None else q

def tri_wave(s):
    return np.abs(s - np.round(s))          # 0 on the lines, 0.5 midway

def checker(a, b, pitch, ang=math.radians(60)):
    """diamond checkering in a plane: 0 in the cut grooves, 1 on the points"""
    ca, sa = math.cos(ang / 2), math.sin(ang / 2)
    u = (a * ca + b * sa) / pitch; v = (a * ca - b * sa) / pitch
    return np.minimum(np.minimum(tri_wave(u), tri_wave(v)) * 2.0, 0.82) / 0.82

def sd_rrect(a, b, a0, b0, a1, b1, r):
    ca, cb = (a0 + a1) / 2, (b0 + b1) / 2; ha, hb = (a1 - a0) / 2 - r, (b1 - b0) / 2 - r
    qa = np.abs(a - ca) - ha; qb = np.abs(b - cb) - hb
    return np.hypot(np.maximum(qa, 0), np.maximum(qb, 0)) + np.minimum(np.maximum(qa, qb), 0) - r

def sd_star5(px, py, r, rf):
    k1x, k1y = 0.809016994375, -0.587785252292
    k2x, k2y = -k1x, k1y
    px = np.abs(px)
    d = np.maximum(k1x * px + k1y * py, 0) * 2; px = px - d * k1x; py = py - d * k1y
    d = np.maximum(k2x * px + k2y * py, 0) * 2; px = px - d * k2x; py = py - d * k2y
    px = np.abs(px); py = py - r
    bax, bay = rf * (-k1y), rf * k1x - 1
    h = np.clip((px * bax + py * bay) / (bax * bax + bay * bay), 0, r)
    return np.hypot(px - bax * h, py - bay * h) * np.sign(py * bax - px * bay)

def logo_izhevsk(size, px):
    """the Izhevsk arsenal's mark: an arrow in a triangle"""
    n = int(size / px) + 4
    y, x = (np.mgrid[0:n, 0:n] + 0.5 - n / 2) * px
    s = size / 2
    # an equilateral triangle, point up: distance to its outline
    k = math.sqrt(3)
    qx = np.abs(x) - s; qy = y + s / k
    qx2 = np.where(qx + k * qy > 0, (qx - k * qy) / 2, qx); qy2 = np.where(qx + k * qy > 0, (-k * qx - qy) / 2, qy)
    qx2 = qx2 - np.clip(qx2, -2 * s, 0)
    dtri = -np.hypot(qx2, qy2) * np.sign(qy2)
    ring = (np.abs(dtri + s * 0.08) < s * 0.07).astype(np.float32)
    shaft = (np.abs(x) < s * 0.06) & (y > -s * 0.42) & (y < s * 0.32)
    head = (y > s * 0.12) & (y < s * 0.58) & (np.abs(x) < (s * 0.58 - y) * 0.6)
    m = np.clip(ring + shaft + head, 0, 1).astype(np.float32)
    return TL.blur(m, 0.6), n * px, n * px

def disc_mask(r, px):
    n = int(2 * r / px) + 4
    y, x = (np.mgrid[0:n, 0:n] + 0.5 - n / 2) * px
    return np.clip((r - np.hypot(x, y)) / px + 0.5, 0, 1).astype(np.float32), n * px, n * px

STAMPS = {}

# ---------------------------------------------------------------- the Makarov PM
# (bore on y = 0, the slide's back at z = 0; the grip and the magazine share one frame)
PM_G = frame3((0, -0.110, -0.002), (-0.27, 0, 0))

def build_pm():
    body = Part('pm_body')
    slide = Part('SLIDE_pm')
    hammer = Part('HAMMER_pm', frame3((0, -0.010, 0.006)))
    trig = Part('TRIGGER_pm', frame3((0, -0.03, -0.07)))
    mag = Part('MAG_pm', PM_G)
    rounds = Part('ROUNDS_pm', PM_G, parent=mag)

    # -- the slide: its section (round-topped) cut by its side profile, then the ejection port,
    # the barrel's channel and the rear serrations
    sec = fillet([(-0.01275, -0.0085), (0.01275, -0.0085), (0.01275, 0.0185), (-0.01275, 0.0185)], [0.0004, 0.0004, 0.0095, 0.0095], 8)
    side = fillet([(0.0, -0.0085), (0.0, 0.0185), (-0.161, 0.0185), (-0.161, -0.0085)], [0.0006, 0.0016, 0.0075, 0.0012], 6)
    def serr(b):
        for i in range(10):
            z = -0.0148 - i * 0.0021
            for sx in (1, -1):
                box(b, (sx * 0.0162, 0.0035, z), (0.0084, 0.0185, 0.00085))
    slide.piece(lambda b: prism(b, sec, 'z', 0.003, -0.164), 'main', ops=[
        ('cut', lambda b: prism(b, side, 'x', -0.02, 0.02), 'INTERSECT'),
        ('bevel', 0.0005, 2, 35),
        ('cut', lambda b: box(b, (0.0125, 0.0035, -0.0465), (0.017, 0.014, 0.0235), 'cavity')),
        ('cut', lambda b: cyl(b, (0, 0, -0.1), 0.0062, 0.13, 'z', 20, 'black')),
        ('cut', lambda b: cyl(b, (0, 0, -0.06), 0.0068, 0.05, 'z', 20, 'black')),
        ('cut', serr),
        ('bevel', 0.00016, 1, 60)])
    # the sights: a ramped front blade, the rear sight with its square notch
    slide.piece(lambda b: prism(b, fillet([(-0.1428, 0.0178), (-0.1450, 0.0237), (-0.1512, 0.0237), (-0.1552, 0.0178)], [0, 0.0006, 0.0004, 0], 3), 'x', -0.0016, 0.0016),
                'front', ops=[('bevel', 0.00025, 1, 40)])
    rs = [(-0.0075, 0.0168), (0.0075, 0.0168), (0.0069, 0.0237), (0.0013, 0.0237), (0.0013, 0.0206), (-0.0013, 0.0206), (-0.0013, 0.0237), (-0.0069, 0.0237)]
    slide.piece(lambda b: prism(b, rs, 'z', -0.0032, -0.0108), 'rear', ops=[('bevel', 0.00025, 1, 40)])
    # the safety lever on the left: its hub and the thumb piece, down (fire)
    lever = fillet(hull2d(circle(-0.0080, 0.0035, 0.0043, 20) + circle(-0.0017, -0.0038, 0.0020, 16)), 0.0, 1)
    slide.piece(lambda b: prism(b, lever, 'x', -0.0122, -0.0150), 'safety', ops=[('bevel', 0.0005, 2, 30)])
    slide.piece(lambda b: cyl(b, (-0.0152, 0.0035, -0.0080), 0.0018, 0.0012, 'x', 12), 'safetypin', ops=[('bevel', 0.0002, 1, 40)])
    # (the extractor, behind the port on the right)
    slide.piece(lambda b: prism(b, fillet([(-0.0300, 0.0005), (-0.0300, 0.0062), (-0.0405, 0.0055), (-0.0410, 0.0012)], 0.0006, 2), 'x', 0.0118, 0.01305),
                'extractor', ops=[('bevel', 0.0002, 1, 40)])

    # -- the frame: under the slide, round the trigger, into the grip, the tang behind
    fr = fillet([(-0.1470, -0.0089), (-0.1470, -0.0245), (-0.0472, -0.0245), (-0.0441, -0.0300), (-0.0080, -0.0281),
                 (-0.0030, -0.0228), (0.0045, -0.0186), (0.0105, -0.0132), (0.0128, -0.0089)],
                [0.0005, 0.0050, 0.003, 0.0, 0.0, 0.003, 0.005, 0.004, 0.0012], 5)
    body.piece(lambda b: prism(b, fr, 'x', -0.0123, 0.0123), 'frame', ops=[
        ('bevel', 0.0006, 2, 35),
        ('cut', lambda b: box(b, (0, -0.0105, 0.010), (0.0088, 0.020, 0.024), 'cavity')),
        ('cut', lambda b: box(b, (0, -0.0222, -0.0710), (0.0064, 0.0085, 0.0165), 'cavity')),
        ('bevel', 0.00016, 1, 60)])
    # the grip: the steel core with its front strap, the brown Bakelite wrapped round the sides
    # and the back (both lofted up the grip's axis, in its frame)
    def core(b):
        s = rrect(-0.0117, -0.0192, 0.0117, 0.0170, (0.006, 0.006, 0.003, 0.003), 4)
        fs = loft(b, [ring3(s, (0, y, 0), (1, 0, 0), (0, 0, 1)) for y in (0.0035, 0.092)], 'blued')
        xform(b, PM_G)
    def well(b):
        box(b, (0, 0.010, 0), (0.0196, 0.026, 0.0296), 'cavity'); xform(b, PM_G)
    body.piece(core, 'core', ops=[('bevel', 0.0005, 2, 35), ('cut', well)])
    def grip(b):
        rings = []
        for y, w, zb in ((0.0042, 0.0141, 0.0212), (0.0080, 0.0146, 0.0212), (0.030, 0.0150, 0.0212), (0.058, 0.0150, 0.0212),
                         (0.080, 0.0147, 0.0216), (0.092, 0.0145, 0.0252), (0.102, 0.0140, 0.0310)):
            s = rrect(-w, -0.0150, w, zb, (0.0122, 0.0122, 0.0022, 0.0022), 6)
            rings.append(ring3(s, (0, y, 0), (1, 0, 0), (0, 0, 1)))
        loft(b, rings, 'bakelite')
        xform(b, PM_G)
    body.piece(grip, 'grip', ops=[('cut', lambda b: prism(b, fr, 'x', -0.03, 0.03)), ('cut', lambda b: box(b, (0, 0.02, -0.05), (0.06, 0.0578, 0.3))),
                                  ('bevel', 0.0009, 2, 35), ('cut', well), ('bevel', 0.0003, 1, 60)])
    # the trigger guard, swept round from the frame to the front strap
    gp = [(0, y, z) for z, y in catmull([(-0.0935, -0.0205), (-0.1005, -0.0255), (-0.1040, -0.0330), (-0.1035, -0.0410), (-0.0985, -0.0475),
                                          (-0.0890, -0.0510), (-0.0750, -0.0518), (-0.0600, -0.0508), (-0.0470, -0.0490), (-0.0385, -0.0471)], 4)]
    body.piece(lambda b: sweep(b, gp, rrect(-0.0036, -0.0022, 0.0036, 0.0022, 0.0017, 3), 'blued', side=(1, 0, 0)), 'guard', wn=False)
    # the fixed barrel (seen when the slide runs back): crown, chamber, a through bore
    prof = [(0.0046, -0.1568), (0.0051, -0.1575), (0.0056, -0.1575), (0.0058, -0.1569), (0.0058, -0.060), (0.0062, -0.0565),
            (0.0062, -0.0380), (0.0058, -0.0372), (0.0050, -0.0372), (0.00495, -0.0378), (0.00495, -0.0545), (0.0046, -0.0560)]
    kinds = ['worn', 'worn', 'worn', 'worn', 'worn', 'worn', 'worn', 'worn', 'black', 'black', 'black', 'black']
    body.piece(lambda b: lathe(b, prof, 24, 'z', (0, 0), kinds=kinds), 'barrel', smooth=50, wn=False)
    # the slide stop on the left, above the trigger
    ssl = fillet(hull2d(circle(-0.0335, -0.0132, 0.0030, 16) + circle(-0.0185, -0.0150, 0.0024, 16)), 0, 1)
    body.piece(lambda b: prism(b, ssl, 'x', -0.0121, -0.0137), 'slidestop', ops=[('bevel', 0.0004, 2, 30)])
    # the heel: the magazine catch, the lanyard loop's stud and its ring
    def catch(b):
        prism(b, fillet([(0.0172, 0.0115), (0.0172, -0.0032), (0.0222, -0.0046), (0.0247, -0.0022), (0.0234, 0.0100)], 0.0012, 3), 'x', -0.0046, 0.0046)
        xform(b, PM_G)
    body.piece(catch, 'catch', ops=[('bevel', 0.0004, 2, 35)])
    def stud(b):
        cyl(b, (-0.0128, 0.0076, 0.0162), 0.0019, 0.0050, 'x', 12); xform(b, PM_G)
    body.piece(stud, 'stud', ops=[('bevel', 0.0003, 1, 40)])
    def ring(b):
        torus(b, (-0.0154, 0.0024, 0.0162), 0.0052, 0.0011, 'x', 20, 8); xform(b, PM_G)
    body.piece(ring, 'lanyard', wn=False)

    # -- the hammer (down: cocking turns it back about x), its spur grooved
    hp = [(0.0028, -0.0055), (0.0028, 0.0050), (0.0042, 0.0088), (0.0110, 0.0098), (0.0172, 0.0086), (0.0192, 0.0068),
          (0.0180, 0.0045), (0.0118, 0.0030), (0.0098, -0.0040), (0.0094, -0.0108), (0.0060, -0.0142), (0.0028, -0.0110)]
    def grooves(b):
        a = Vector((0.0118, 0.0097)); c = Vector((0.0186, 0.0079)); d = (c - a).normalized(); nrm = Vector((-d.y, d.x))
        ang = math.atan2(d.y, d.x)
        for i in range(5):
            p = a.lerp(c, (i + 0.5) / 5) + nrm * 0.0001
            box(b, (0, p.y, p.x), (0.009, 0.0009, 0.0006), 'blued', rot=(-ang, 0, 0))
    hammer.piece(lambda b: prism(b, fillet(hp, [0.0008, 0.0012, 0.002, 0.003, 0.0015, 0.0012, 0.0015, 0.002, 0.003, 0.0035, 0.0035, 0.0008], 4), 'x', -0.00375, 0.00375),
                 'h', ops=[('bevel', 0.0005, 2, 35), ('cut', grooves)])
    hammer.piece(lambda b: cyl(b, (0, -0.010, 0.006), 0.0021, 0.0090, 'x', 14, 'worn'), 'pin', ops=[('bevel', 0.0002, 1, 40)])

    # -- the trigger: a curved blade, its face rounded
    tf = catmull([(-0.0705, -0.0215), (-0.0728, -0.0270), (-0.0752, -0.0330), (-0.0778, -0.0395), (-0.0800, -0.0452)], 3)
    tb = catmull([(-0.0778, -0.0474), (-0.0752, -0.0430), (-0.0730, -0.0375), (-0.0706, -0.0318), (-0.0684, -0.0262), (-0.0672, -0.0215)], 3)
    tpoly = tf + [(-0.0806, -0.0468)] + tb
    trig.piece(lambda b: prism(b, tpoly, 'x', -0.0029, 0.0029), 't', ops=[('bevel', 0.0011, 3, 25)])

    # -- the magazine (its own frame: the base plate at the origin, up the grip along +y)
    def magbody(b):
        prism(b, rrect(-0.0095, -0.0145, 0.0095, 0.0145, 0.0022, 3), 'y', 0.0030, 0.0842, 'blued')
    def magtop(b):
        box(b, (0, 0.0905, -0.0085), (0.03, 0.016, 0.014), 'blued')          # the front cut low
        box(b, (0, 0.0850, 0.0), (0.0176, 0.012, 0.0276), 'cavity')           # hollow at the top
    mag.piece(magbody, 'body', local=True, ops=[('bevel', 0.0004, 1, 40), ('cut', magtop), ('bevel', 0.00015, 1, 60)])
    def lips(b):
        for sx in (1, -1):
            box(b, (sx * 0.0074, 0.0836, 0.0058), (0.0030, 0.0016, 0.0170), 'blued')
        box(b, (0, 0.0793, 0.0), (0.0170, 0.0009, 0.0268), 'parker')          # the follower
    mag.piece(lips, 'lips', local=True, ops=[('bevel', 0.0003, 1, 40)])
    bp = fillet([(-0.0200, 0.0035), (0.0205, 0.0035), (0.0215, 0.0005), (0.0205, -0.0030), (-0.0190, -0.0035), (-0.0215, -0.0012), (-0.0219, 0.0020)], 0.0011, 3)
    mag.piece(lambda b: prism(b, bp, 'x', -0.0134, 0.0134), 'base', local=True, ops=[('bevel', 0.0007, 2, 30)])
    # the top round: 9x18, brass case, copper-washed bullet (along its own z, as the stand-in's)
    cart = [(0, 0.0110), (0.0049, 0.0110), (0.0050, 0.0105), (0.0050, 0.0096), (0.0042, 0.0091), (0.0042, 0.0083), (0.0049, 0.0078),
            (0.00485, -0.0070), (0.00455, -0.0071), (0.00455, -0.0090), (0.0042, -0.0115), (0.0033, -0.0138), (0.0018, -0.0152), (0, -0.0157)]
    ck = ['brass'] * 7 + ['copper'] * 7
    rounds.piece(lambda b: lathe(b, cart, 20, 'z', (0, 0.0855), kinds=ck, closed=False), 'r', local=True, smooth=50, wn=False)

    parts = [body, slide, hammer, trig, mag, rounds]
    empties = [('MUZZLE_pm', dorsal3((0, 0, -0.160)), None), ('EJECT_pm', dorsal3((0.014, 0.008, -0.047)), None),
               ('SIGHT_pm', dorsal3((0, 0.0235, -0.008)), None),
               ('GRIP_R_pm', dorsal3((0.002, -0.064, -0.012), (1, 0.2, 0)), None),
               ('GRIP_L_pm', dorsal3((-0.020, -0.076, -0.004), (-0.9, -0.45, 0)), None)]
    root = assemble('WPN_pm', parts, empties)
    # the markings: the serial and the Izhevsk mark on the slide's left, the frame's serial, the red
    # dot the safety uncovers
    px = 0.00003
    st = []
    m, w, h = text_mask('АБ 3915', 0.0023, px); st.append(Stamp(m, w, h, (-0.01276, 0.0003, -0.096), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00004))
    m, w, h = logo_izhevsk(0.0042, px); st.append(Stamp(m, w, h, (-0.01276, 0.0006, -0.122), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00004))
    m, w, h = text_mask('1961', 0.0021, px); st.append(Stamp(m, w, h, (-0.01276, 0.0003, -0.137), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00004))
    m, w, h = text_mask('АБ 3915', 0.0019, px); st.append(Stamp(m, w, h, (-0.01231, -0.0175, -0.118), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00003))
    m, w, h = disc_mask(0.0011, px); st.append(Stamp(m, w, h, (-0.01276, 0.0068, -0.0128), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0, 'red'))
    m, w, h = text_mask('15', 0.0018, px); st.append(Stamp(m, w, h, (0.01276, 0.0020, -0.0720), (0, 0, -1), (0, 1, 0), (1, 0, 0), 0.00003))
    STAMPS['pm'] = st
    return root, {'parts': [p.name for p in parts]}

def pm_grip_detail(sf, ix, P):
    """the Bakelite's checkering (sides and back) and the star in a circle at the top of each side"""
    q, nl = to_local(PM_G, P, sf.N[ix])
    x, y, z = q[:, 0], q[:, 1], q[:, 2]
    side = ss(0.5, 0.7, np.abs(nl[:, 0])); back = ss(0.55, 0.75, nl[:, 2])
    fld = ss(0.0006, -0.0002, sd_rrect(z, y, -0.0118, 0.0105, 0.0160, 0.0575, 0.003))
    chk = checker(z, y, 0.00105) * fld * side
    bk = checker(x, y, 0.00105) * ss(0.0006, -0.0002, sd_rrect(x, y, -0.008, 0.012, 0.008, 0.074, 0.002)) * back
    rr = np.hypot(z - 0.0021, y - 0.0672)
    ringm = ss(0.0006, 0.0004, np.abs(rr - 0.0060)) * side
    star = ss(0.0002, -0.0001, sd_star5((z - 0.0021) * np.sign(nl[:, 0] + 1e-9) * -1, y - 0.0672, 0.0044, 0.45)) * side
    med = np.maximum(ringm, star)
    fieldcut = (fld * side + bk) > 0.01
    h = np.where(fieldcut, (chk + bk) * 0.00028 - 0.00028, 0.0) + med * 0.00028
    return h.astype(np.float32), np.clip(fld * side + bk * 0.9, 0, 1), med

def pm_shade(sf, base, rough, metal):
    sh_steel(sf, sf.kind('blued'), base, rough, metal, holster=0.35)
    sh_steel(sf, sf.kind('parker'), base, rough, metal, tone=(0.045, 0.045, 0.043), r0=0.60, holster=0, seed=3)
    sh_steel(sf, sf.kind('worn'), base, rough, metal, tone=(0.12, 0.12, 0.118), r0=0.38, holster=0, seed=5, worn_col=(0.19, 0.188, 0.183))
    sh_plain(sf, sf.kind('black'), base, rough, metal, 'black')
    sh_plain(sf, sf.kind('cavity'), base, rough, metal, 'cavity')
    ix = sf.kind('bakelite')
    sh_bakelite(sf, ix, base, rough, metal)
    h, fld, med = pm_grip_detail(sf, ix, sf.P[ix])
    rough[ix] = mix(rough[ix], 0.5, fld * 0.8)
    base[ix] = base[ix] * (1 + 0.25 * med)[:, None]
    rough[ix] = mix(rough[ix], 0.24, med)
    sh_brass(sf, sf.kind('brass'), base, rough, metal)
    sh_brass(sf, sf.kind('copper'), base, rough, metal, tone=(0.62, 0.34, 0.20), seed=3)
    overlay_dust(sf, base, rough, metal, 0.8)
    apply_stamps(sf, STAMPS['pm'], base, rough, metal)

def pm_height(sf, P):
    h = np.zeros(sf.n, np.float32)
    for k, sd in (('blued', 0), ('parker', 3), ('worn', 5)):
        ix = sf.kind(k); h[ix] = h_steel(sf, ix, P[ix], sd)
    ix = sf.kind('bakelite'); h[ix] = pm_grip_detail(sf, ix, P[ix])[0] + (vnoise(P[ix], 0.0008, 35) - 0.5) * 0.000002
    return h + stamp_height(sf, STAMPS['pm'], P)

PM_VIEWS = [('q', (-0.20, 0.10, 0.19), (0.0, -0.035, -0.07), 50), ('r', (0.30, 0.03, -0.07), (0.0, -0.035, -0.07), 55),
            ('l', (-0.30, 0.0, -0.07), (0.0, -0.035, -0.07), 55), ('fp', (-0.103, 0.076, 0.308), (-0.103, 0.066, -0.7), 26.7),
            ('slideback', (0.22, 0.06, -0.02), (0.0, -0.02, -0.07), 50, {'SLIDE_pm': (0.032, 0, 0), 'HAMMER_pm': (0, 0.75, 0)})]

# ---------------------------------------------------------------- more builders
def zloft(bm, stations, n=32, k='wood', cap0=True, cap1=True):
    """sections across z: (z, cx, cy, half-width, half-height, superellipse power)"""
    rings = []
    for z, cx, cy, a, b, p in stations:
        rings.append([(x, y, z) for x, y in sellipse(a, b, p, n, cx, cy)])
    return loft(bm, rings, k, cap0, cap1)

def box_m(bm, M, size, k='blued'):
    """a box of `size` placed by a three-space matrix"""
    r = bmesh.ops.create_cube(bm, size=1.0)
    vs = r['verts']
    bmesh.ops.scale(bm, vec=size, verts=vs)
    for v in vs: v.co = M @ v.co
    fs = list({f for v in vs for f in v.link_faces})
    for f in fs: f.material_index = KID[k]
    return fs

def plane_cutter(bm, p0, n, size=0.12, k='blued'):
    """a big box whose face lies on the plane through p0, filling the side the normal points to"""
    n = Vector(n).normalized()
    q = Vector((0, 0, 1)).rotation_difference(n)
    M = Matrix.Translation(Vector(p0) + n * size / 2) @ q.to_matrix().to_4x4()
    return box_m(bm, M, (size, size, size), k)

def rivet(bm, c, r, h, axis='x', sgn=1, k='blued', seg=12):
    """a round rivet head on a surface (axis and the side it faces)"""
    prof = [(0, h), (r * 0.62, h * 0.9), (r * 0.92, h * 0.55), (r, h * 0.15), (r, -0.0006), (0, -0.0006)]
    prof = [(rr, t * sgn) for rr, t in prof]
    c = Vector(c)
    if axis == 'x': lathe(bm, [(rr, c.x + t) for rr, t in prof], seg, 'x', (c.y, c.z), k, closed=False)
    elif axis == 'y': lathe(bm, [(rr, c.y + t) for rr, t in prof], seg, 'y', (c.x, c.z), k, closed=False)
    else: lathe(bm, [(rr, c.z + t) for rr, t in prof], seg, 'z', (c.x, c.y), k, closed=False)

def frame_loft(bm, M, stations, n=28, k='plum'):
    """sections along a local y axis: (y, cz, half-width (x), half-depth (z), power), placed by M"""
    rings = []
    for y, cz, a, b, p in stations:
        rings.append([tuple(M @ Vector((x, y, cz + z))) for x, z in sellipse(a, b, p, n)])
    return loft(bm, rings, k)

# ---------------------------------------------------------------- the AKM
# (bore on y = 0, the receiver's back at z = 0)
AKM_GRIP = frame3((0, -0.088, -0.030), (-0.33, 0, 0))

def akm_mag_spine(n=9):
    """the magazine's curve: (point (y, z), the angle its sections lean) from the top down"""
    y0, z0 = -0.030, -0.1450
    th0, th1, L = 0.10, 0.55, 0.205
    out = []
    y, z = y0, z0
    for i in range(n):
        th = th0 + (th1 - th0) * i / (n - 1)
        out.append(((y, z), th))
        ds = L / (n - 1)
        thm = th0 + (th1 - th0) * (i + 0.5) / (n - 1)
        y -= math.cos(thm) * ds; z -= math.sin(thm) * ds
    return out

def build_akm():
    body = Part('akm_body')
    charge = Part('CHARGE_akm')
    sel = Part('SELECTOR_akm', frame3((0.0168, 0, -0.040)))
    trig = Part('TRIGGER_akm', frame3((0, -0.045, -0.068)))
    mag = Part('MAG_akm', frame3((0, -0.044, -0.176)))
    rounds = Part('ROUNDS_akm', frame3((0, -0.044, -0.176)), parent=mag)

    # -- the receiver: a stamped U, hollow between its trunnions, the magazine well, the trigger slot,
    # the ejection port and the charging handle's slot on the right, the dimples over the well
    rsec = rrect(-0.0155, -0.045, 0.0155, 0.004, (0.0006, 0.0006, 0.0045, 0.0045), 4)
    def hollow(b):
        box(b, (0, -0.017, -0.154), (0.0286, 0.0546, 0.256), 'cavity')
    def well(b):
        box(b, (0, -0.050, -0.145), (0.0272, 0.016, 0.0630), 'cavity')
        box(b, (0, -0.050, -0.0700), (0.0080, 0.016, 0.0170), 'cavity')
    def port(b):
        box(b, (0.0150, -0.0005, -0.1965), (0.010, 0.0130, 0.0870), 'cavity')
        box(b, (0.0150, 0.0026, -0.1320), (0.010, 0.0060, 0.0480), 'cavity')
    def dimples(b):
        for sx in (1, -1):
            box_m(b, Matrix.Translation((sx * 0.0163, -0.0285, -0.1505)), (0.0030, 0.0110, 0.0190), 'blued')
    body.piece(lambda b: prism(b, rsec, 'z', -0.300, -0.003), 'receiver', ops=[
        ('bevel', 0.0006, 2, 35), ('cut', hollow), ('cut', well), ('cut', port), ('cut', dimples), ('bevel', 0.0003, 1, 60)], uvd=1.5)
    # the rivets: the front trunnion's, the rear trunnion's, the centre support's; the trigger group's pins
    def rivets(b):
        for sx in (1, -1):
            for z, y in ((-0.2865, -0.006), (-0.2935, -0.0165), (-0.2935, 0.0005), (-0.2865, -0.026),
                         (-0.0090, -0.0050), (-0.0175, -0.0050), (-0.0135, -0.0200), (-0.1080, -0.0385), (-0.1180, -0.0385)):
                rivet(b, (sx * 0.0155, y, z), 0.0024, 0.0011, 'x', sx)
            for z, y in ((-0.0395, -0.026), (-0.0615, -0.034), (-0.0745, -0.020)):
                rivet(b, (sx * 0.0155, y, z), 0.0021, 0.0007, 'x', sx, 'parker')
        rivet(b, (-0.0155, 0.0, -0.040), 0.0035, 0.0009, 'x', -1, 'parker')      # the selector's axle, left
    body.piece(rivets, 'rivets', smooth=60, wn=False)
    # the dust cover: an arched stamping with its transverse ribs, the spring guide's button behind
    csec = fillet([(-0.0146, 0.0040), (0.0146, 0.0040), (0.0146, 0.0080), (0.0105, 0.0228), (-0.0105, 0.0228), (-0.0146, 0.0080)],
                  [0.0004, 0.0004, 0.004, 0.0045, 0.0045, 0.004], 5)
    body.piece(lambda b: prism(b, csec, 'z', -0.2885, -0.0255), 'cover', ops=[('bevel', 0.0006, 2, 35)], uvd=1.6)
    rsecr = fillet([(-0.0154, 0.0060), (0.0154, 0.0060), (0.0154, 0.0083), (0.0112, 0.0236), (-0.0112, 0.0236), (-0.0154, 0.0083)],
                   [0.0, 0.0, 0.0045, 0.005, 0.005, 0.0045], 5)
    for i in range(6):
        z = -0.232 + i * 0.037
        body.piece(lambda b, z=z: prism(b, rsecr, 'z', z - 0.0013, z + 0.0013), f'rib{i}', ops=[('bevel', 0.0005, 2, 30)])
    body.piece(lambda b: cyl(b, (0, 0.0125, -0.0236), 0.0042, 0.0042, 'z', 16), 'button', ops=[('bevel', 0.0006, 2, 30)])
    # the rear trunnion's tang behind, under the stock's front
    # the rear sight: its block on the front trunnion, the curved leaf, the slider, the notch plate
    blk = fillet([(-0.3520, 0.0030), (-0.2915, 0.0030), (-0.2915, 0.0170), (-0.3000, 0.0215), (-0.3460, 0.0215), (-0.3520, 0.0140)],
                 [0.001, 0.0005, 0.002, 0.003, 0.003, 0.003], 4)
    body.piece(lambda b: prism(b, blk, 'x', -0.0130, 0.0130), 'sightblock', ops=[('bevel', 0.0006, 2, 35)], uvd=1.4)
    leaf = fillet([(-0.3425, 0.0205), (-0.2690, 0.0238), (-0.2690, 0.0268), (-0.3400, 0.0240)], [0.001, 0.0005, 0.0005, 0.002], 3)
    body.piece(lambda b: prism(b, leaf, 'x', -0.0085, 0.0085), 'leaf', ops=[('bevel', 0.0004, 1, 35)], uvd=2.0)
    npl = [(-0.0085, 0.0230), (0.0085, 0.0230), (0.0085, 0.0400), (0.0016, 0.0400), (0.0016, 0.0372), (-0.0016, 0.0372), (-0.0016, 0.0400), (-0.0085, 0.0400)]
    body.piece(lambda b: prism(b, fillet(npl, [0.001, 0.001, 0.0008, 0, 0.0005, 0.0005, 0, 0.0008], 2), 'z', -0.2720, -0.2690), 'notch', ops=[('bevel', 0.0003, 1, 35)])
    def slider(b):
        prism(b, rrect(-0.0100, 0.0195, 0.0100, 0.0290, 0.0012, 2), 'z', -0.3135, -0.3015, 'blued')
        for sx in (1, -1): cyl(b, (sx * 0.0106, 0.0242, -0.3075), 0.0028, 0.0024, 'x', 12, 'blued')
    body.piece(slider, 'slider', ops=[('bevel', 0.0004, 1, 35)])
    # the barrel, the gas block and tube, the front sight base with its ears and post, the slant brake
    body.piece(lambda b: lathe(b, [(0, -0.2950), (0.0096, -0.2950), (0.0094, -0.4800), (0.0088, -0.5900), (0.0086, -0.7150), (0.0080, -0.8200), (0, -0.8200)],
                                 24, 'z', (0, 0), 'blued', closed=False), 'barrel', smooth=50, wn=False, uvd=0.6)
    gbs = fillet([(-0.0110, -0.0035), (0.0110, -0.0035), (0.0110, 0.0255), (0.0080, 0.0310), (-0.0080, 0.0310), (-0.0110, 0.0255)], [0.004, 0.004, 0.003, 0.002, 0.002, 0.003], 4)
    body.piece(lambda b: (prism(b, gbs, 'z', -0.6030, -0.5730), cyl(b, (0, 0, -0.588), 0.0122, 0.0300, 'z', 24, 'blued')), 'gasblock', ops=[('bevel', 0.0007, 2, 35)])
    body.piece(lambda b: (box(b, (0, -0.0135, -0.590), (0.0080, 0.0110, 0.0200), 'blued'),), 'rodguide', ops=[('bevel', 0.0006, 2, 35)])
    body.piece(lambda b: (cyl(b, (0, 0.022, -0.4675), 0.0086, 0.2250, 'z', 20, 'blued'), cyl(b, (0, 0.022, -0.5725), 0.0095, 0.0050, 'z', 20, 'blued')),
               'gastube', ops=[('bevel', 0.0004, 1, 50)], smooth=50, uvd=0.7)
    def fsb(b):
        prism(b, fillet([(-0.7160, -0.0225), (-0.6850, -0.0225), (-0.6850, 0.0150), (-0.6890, 0.0205), (-0.7120, 0.0205), (-0.7160, 0.0150)],
                        [0.002, 0.002, 0.002, 0.002, 0.002, 0.002], 3), 'x', -0.0100, 0.0100, 'blued')
        cyl(b, (0, 0, -0.7005), 0.0118, 0.0310, 'z', 24, 'blued')
    body.piece(fsb, 'fsb', ops=[('bevel', 0.0007, 2, 35)])
    ear = fillet([(-0.7110, 0.0170), (-0.6910, 0.0170), (-0.6930, 0.0360), (-0.6985, 0.0425), (-0.7045, 0.0425), (-0.7095, 0.0360)], [0, 0, 0.003, 0.002, 0.002, 0.003], 4)
    for sx in (1, -1):
        body.piece(lambda b, sx=sx: prism(b, ear, 'x', sx * 0.0078, sx * 0.0104), f'ear{sx}', ops=[('bevel', 0.0004, 2, 30)])
    body.piece(lambda b: (cyl(b, (0, 0.0190, -0.7005), 0.0042, 0.0060, 'y', 16, 'blued'),
                           box(b, (0, 0.0310, -0.7005), (0.0022, 0.0180, 0.0024), 'blued')), 'post', ops=[('bevel', 0.0003, 1, 40)])
    body.piece(lambda b: box(b, (0, -0.0280, -0.7090), (0.0080, 0.0110, 0.0130), 'blued'), 'lug', ops=[('bevel', 0.0006, 2, 35)])
    def brake(b):
        lathe(b, [(0.0048, -0.8565), (0.0112, -0.8565), (0.0116, -0.8540), (0.0116, -0.8200), (0.0108, -0.8170), (0.0048, -0.8170)], 28, 'z', (0, 0), 'blued')
    body.piece(brake, 'brake', ops=[('cut', lambda b: plane_cutter(b, (0, 0, -0.8420), (0.42, 0.46, -0.78), 0.1, 'black')), ('bevel', 0.0005, 2, 35)])
    # the cleaning rod under the barrel, its T head in the front sight base
    body.piece(lambda b: (cyl(b, (0, -0.0170, -0.6000), 0.0029, 0.2380, 'z', 12, 'worn'), cyl(b, (0, -0.0170, -0.7175), 0.0042, 0.0035, 'z', 12, 'worn')),
               'rod', smooth=60, wn=False, uvd=0.4)
    # the furniture: the laminated lower handguard with its finger grooves and swell, the upper
    # over the gas tube, the steel ferrule and the retainer
    lst = [(-0.3050, 0, -0.0150, 0.0170, 0.0195, 2.6), (-0.3300, 0, -0.0160, 0.0186, 0.0205, 2.6), (-0.4150, 0, -0.0160, 0.0190, 0.0205, 2.6),
           (-0.4450, 0, -0.0175, 0.0212, 0.0225, 2.8), (-0.4700, 0, -0.0180, 0.0216, 0.0230, 2.8), (-0.4790, 0, -0.0150, 0.0180, 0.0185, 2.6)]
    def grooves(b):
        for sx in (1, -1):
            lathe(b, [(0, -0.4330), (0.0026, -0.4315), (0.0038, -0.4270), (0.0038, -0.3420), (0.0026, -0.3375), (0, -0.3360)], 14, 'z', (sx * 0.0212, -0.0175), 'laminate', closed=False)
    body.piece(lambda b: zloft(b, lst, 40, 'laminate'), 'lowerguard', ops=[
        ('cut', lambda b: box(b, (0, 0.0250, -0.392), (0.06, 0.0420, 0.2))),
        ('cut', lambda b: cyl(b, (0, 0, -0.392), 0.0108, 0.2, 'z', 24, 'laminate')),
        ('cut', grooves), ('bevel', 0.0012, 2, 35)])
    ust = [(-0.3150, 0, 0.0220, 0.0130, 0.0108, 2.3), (-0.3250, 0, 0.0222, 0.0138, 0.0116, 2.3), (-0.4650, 0, 0.0222, 0.0140, 0.0118, 2.3), (-0.4775, 0, 0.0220, 0.0130, 0.0106, 2.3)]
    body.piece(lambda b: zloft(b, ust, 36, 'laminate'), 'upperguard', ops=[('cut', lambda b: box(b, (0, 0.0040, -0.39), (0.05, 0.0124, 0.2))), ('bevel', 0.0010, 2, 35)])
    def ferrule(b):
        prism(b, rrect(-0.0185, -0.0335, 0.0185, 0.0040, (0.002, 0.002, 0.012, 0.012), 4), 'z', -0.4860, -0.4775, 'blued')
    body.piece(ferrule, 'ferrule', ops=[('cut', lambda b: cyl(b, (0, 0, -0.48), 0.0100, 0.03, 'z', 20, 'cavity')), ('bevel', 0.0005, 2, 35)])
    def retainer(b):
        prism(b, rrect(-0.0178, -0.0300, 0.0178, 0.0040, (0.002, 0.002, 0.010, 0.010), 4), 'z', -0.3070, -0.2995, 'blued')
        prism(b, fillet([(-0.3065, -0.0040), (-0.2985, -0.0040), (-0.2990, 0.0030), (-0.3060, 0.0030)], 0.001, 2), 'x', 0.0170, 0.0196, 'blued')
    body.piece(retainer, 'retainer', ops=[('bevel', 0.0005, 2, 35)])
    # the trigger guard, the magazine catch's paddle at its front
    gp = [(0, y, z) for z, y in catmull([(-0.1100, -0.0430), (-0.1112, -0.0520), (-0.1075, -0.0612), (-0.0985, -0.0655), (-0.0760, -0.0668),
                                          (-0.0590, -0.0648), (-0.0505, -0.0585), (-0.0480, -0.0440)], 4)]
    body.piece(lambda b: sweep(b, gp, rrect(-0.0050, -0.0012, 0.0050, 0.0012, 0.0010, 3), 'blued', side=(1, 0, 0)), 'guard', wn=False)
    body.piece(lambda b: (rivet(b, (0, -0.0450, -0.1050), 0.0022, 0.0010, 'y', -1), rivet(b, (0, -0.0450, -0.0505), 0.0022, 0.0010, 'y', -1)), 'guardrivets', smooth=60, wn=False)
    body.piece(lambda b: prism(b, fillet([(-0.1120, -0.0445), (-0.1185, -0.0445), (-0.1195, -0.0575), (-0.1158, -0.0625), (-0.1125, -0.0590)], 0.0012, 3),
                                 'x', -0.0080, 0.0080), 'catch', ops=[('bevel', 0.0005, 2, 35)])
    # the pistol grip: plum Bakelite, an oval swelling toward the bottom, its cap
    gst = [(-0.0500, 0.0005, 0.0140, 0.0203, 2.4), (-0.0400, 0.0005, 0.0145, 0.0208, 2.4), (-0.0100, 0.0000, 0.0140, 0.0200, 2.4),
           (0.0200, -0.0005, 0.0135, 0.0195, 2.3), (0.0400, -0.0005, 0.0130, 0.0190, 2.3), (0.0500, 0.0000, 0.0128, 0.0186, 2.3)]
    body.piece(lambda b: frame_loft(b, AKM_GRIP, gst, 32, 'plum'), 'grip', ops=[('cut', lambda b: box(b, (0, -0.0225, -0.03), (0.05, 0.045, 0.12))), ('bevel', 0.0010, 2, 35)])
    def gcap(b):
        frame_loft(b, AKM_GRIP, [(-0.0540, 0.0005, 0.0124, 0.0184, 2.3), (-0.0496, 0.0005, 0.0136, 0.0198, 2.3)], 24, 'blued')
    body.piece(gcap, 'gripcap', ops=[('bevel', 0.0005, 1, 40)])
    # the stock: laminated, a straight comb falling to the butt, the wrist, the deep belly line; the
    # steel butt plate with its trap door; the sling loop on the left
    sst = [(-0.0025, 0, -0.0205, 0.0154, 0.0245, 3.2), (0.0200, 0, -0.0260, 0.0146, 0.0255, 2.8), (0.0450, 0, -0.0340, 0.0146, 0.0285, 2.6),
           (0.0800, 0, -0.0510, 0.0154, 0.0390, 2.6), (0.1200, 0, -0.0670, 0.0164, 0.0505, 2.7), (0.1800, 0, -0.0790, 0.0170, 0.0570, 2.8),
           (0.2420, 0, -0.0850, 0.0172, 0.0580, 2.9)]
    body.piece(lambda b: zloft(b, sst, 44, 'laminate'), 'stock', ops=[('bevel', 0.0016, 2, 35)], uvd=0.6, uva=40)
    body.piece(lambda b: zloft(b, [(0.2415, 0, -0.0850, 0.0176, 0.0584, 2.9), (0.2480, 0, -0.0850, 0.0176, 0.0584, 2.9)], 44, 'blued'), 'buttplate',
               ops=[('bevel', 0.0008, 2, 35)])
    body.piece(lambda b: (zloft(b, [(0.2475, 0, -0.0700, 0.0100, 0.0180, 2.6), (0.2500, 0, -0.0700, 0.0098, 0.0176, 2.6)], 24, 'blued'),
                           rivet(b, (0, -0.0400, 0.2480), 0.0026, 0.0010, 'z', 1), rivet(b, (0, -0.1280, 0.2480), 0.0026, 0.0010, 'z', 1)), 'trapdoor',
               ops=[('bevel', 0.0004, 1, 40)])
    def sling(b):
        torus(b, (-0.0185, -0.0700, 0.1500), 0.0085, 0.0016, 'x', 20, 8, 'blued')
        prism(b, rrect(0.1420, -0.0760, 0.1580, -0.0640, 0.002, 2), 'x', -0.0185, -0.0165, 'blued')
    body.piece(sling, 'sling', wn=False)

    # -- the carrier and its charging handle (CHARGE slides back), the bolt seen in the port
    def carrier(b):
        box(b, (0.0, 0.0055, -0.1700), (0.0250, 0.0160, 0.1000), 'worn')
        cyl(b, (0, 0.0005, -0.2420), 0.0086, 0.0840, 'z', 20, 'worn')
        box(b, (0.0092, 0.0030, -0.2360), (0.0040, 0.0040, 0.0160), 'parker')            # the extractor
    charge.piece(carrier, 'carrier', ops=[('bevel', 0.0006, 2, 35)])
    hp = fillet([(-0.2400, 0.0010), (-0.2250, 0.0010), (-0.2265, 0.0068), (-0.2385, 0.0068)], 0.0015, 3)
    charge.piece(lambda b: prism(b, hp, 'x', 0.0110, 0.0345), 'handle', ops=[('bevel', 0.0008, 2, 30)])
    def knob(b):
        lathe(b, [(0, 0.0460), (0.0040, 0.0458), (0.0062, 0.0445), (0.0072, 0.0420), (0.0072, 0.0365), (0.0060, 0.0330), (0.0040, 0.0318), (0, 0.0316)],
              20, 'x', (0.0039, -0.2320), 'worn', closed=False)
    charge.piece(knob, 'knob', smooth=50, wn=False)
    # -- the selector lever (up: safe; it turns its front down about x)
    sl = fillet(hull2d(circle(-0.0400, 0.0, 0.0062, 20) + [(-0.0700, 0.0045), (-0.1550, 0.0045), (-0.1585, 0.0010), (-0.1550, -0.0080), (-0.0700, -0.0075)]),
                [0.0] * 40, 1)
    sel.piece(lambda b: prism(b, sl, 'x', 0.0157, 0.0177), 'lever', ops=[('bevel', 0.0005, 2, 30)])
    sel.piece(lambda b: prism(b, fillet([(-0.1590, -0.0040), (-0.1480, -0.0040), (-0.1480, 0.0105), (-0.1590, 0.0105)], 0.0018, 3), 'x', 0.0170, 0.0218), 'tab',
              ops=[('bevel', 0.0006, 2, 30)])
    sel.piece(lambda b: rivet(b, (0.0177, 0.0, -0.040), 0.0032, 0.0012, 'x', 1, 'parker'), 'axle', smooth=60, wn=False)
    # -- the trigger
    tf = catmull([(-0.0695, -0.0420), (-0.0718, -0.0490), (-0.0742, -0.0560), (-0.0768, -0.0628), (-0.0790, -0.0668)], 3)
    tb = catmull([(-0.0762, -0.0676), (-0.0738, -0.0625), (-0.0715, -0.0560), (-0.0690, -0.0490), (-0.0662, -0.0420)], 3)
    trig.piece(lambda b: prism(b, tf + [(-0.0796, -0.0680)] + tb, 'x', -0.0031, 0.0031), 't', ops=[('bevel', 0.0011, 3, 25)])
    # -- the magazine: curved Bakelite with raised ribs, steel lugs and lips, the floor plate
    sp = akm_mag_spine(9)
    def sect(i, dz0=-0.0305, dz1=0.0305, w=0.0130):
        (y, z), th = sp[i]
        d = Vector((0, -math.cos(th), -math.sin(th)))           # down the magazine
        f = Vector((0, -math.sin(th), math.cos(th)))            # across it, toward the back (+z)
        return Vector((0, y, z)), d, f
    def magbody(b):
        rings = []
        for i in range(len(sp)):
            c, d, f = sect(i)
            dep = 0.0295 - 0.0025 * i / (len(sp) - 1)
            ring = [tuple(c + Vector((1, 0, 0)) * x + f * (zz)) for x, zz in rrect(-0.0130, -dep, 0.0130, dep, (0.0030, 0.0030, 0.0045, 0.0045), 4)]
            rings.append(ring)
        loft(b, rings, 'plum')
    def magtop(b):
        box(b, (0, -0.0325, -0.1460), (0.0216, 0.0330, 0.0560), 'cavity')
    mag.piece(magbody, 'body', ops=[('cut', magtop), ('bevel', 0.0008, 2, 35)])
    def ribs(b):
        for frac in (-0.42, 0.0, 0.42):
            for sx in (1, -1):
                path = []
                for i in range(1, len(sp) - 1):
                    c, d, f = sect(i)
                    dep = 0.0295 - 0.0025 * i / (len(sp) - 1)
                    path.append(tuple(c + f * (frac * dep)))
                sweep(b, path, rrect(sx * 0.0124, -0.0013, sx * 0.0138, 0.0013, 0.0005, 2) if sx > 0 else rrect(-0.0138, -0.0013, -0.0124, 0.0013, 0.0005, 2),
                      'plum', side=(1, 0, 0))
    mag.piece(ribs, 'ribs', wn=False, smooth=50)
    def bands(b):
        for i, w in ((1, 0.0040), (len(sp) - 2, 0.0050)):
            c, d, f = sect(i)
            dep = 0.0295 - 0.0025 * i / (len(sp) - 1) + 0.0007
            M = Matrix((( 1, 0, 0, c.x), (0, d.y, f.y, c.y), (0, d.z, f.z, c.z), (0, 0, 0, 1)))
            ring = [tuple(M @ Vector((x, 0, zz))) for x, zz in rrect(-0.0137, -dep, 0.0137, dep, (0.0034, 0.0034, 0.0049, 0.0049), 4)]
            ring2 = [tuple(M @ Vector((x, w, zz))) for x, zz in rrect(-0.0137, -dep, 0.0137, dep, (0.0034, 0.0034, 0.0049, 0.0049), 4)]
            loft(b, [ring, ring2], 'plum')
    mag.piece(bands, 'bands', ops=[('bevel', 0.0005, 1, 35)])
    def lugs(b):
        box(b, (0, -0.0370, -0.1790), (0.0120, 0.0070, 0.0060), 'blued')          # the front lug it hooks on
        box(b, (0, -0.0470, -0.1135), (0.0140, 0.0060, 0.0050), 'blued')          # the rear lug the catch holds
        for sx in (1, -1):
            box(b, (sx * 0.0098, -0.0315, -0.1440), (0.0030, 0.0030, 0.0420), 'blued')   # the feed lips
        box(b, (0, -0.0475, -0.1460), (0.0180, 0.0012, 0.0520), 'parker')         # the follower
    mag.piece(lugs, 'lugs', ops=[('bevel', 0.0004, 1, 35)])
    def floor(b):
        c, d, f = sect(len(sp) - 1)
        dep = 0.0285
        M = Matrix(((1, 0, 0, c.x), (0, d.y, f.y, c.y), (0, d.z, f.z, c.z), (0, 0, 0, 1)))
        ring = [tuple(M @ Vector((x, -0.0010, zz))) for x, zz in rrect(-0.0145, -dep - 0.0012, 0.0145, dep + 0.0004, (0.003, 0.003, 0.004, 0.004), 4)]
        ring2 = [tuple(M @ Vector((x, 0.0045, zz))) for x, zz in rrect(-0.0140, -dep - 0.0018, 0.0140, dep - 0.0002, (0.003, 0.003, 0.004, 0.004), 4)]
        loft(b, [ring, ring2], 'blued')
    mag.piece(floor, 'floor', ops=[('bevel', 0.0007, 2, 35)])
    # the top round: 7.62x39, lacquered steel case, copper-washed bullet
    cart = [(0, -0.1205), (0.0056, -0.1205), (0.0057, -0.1215), (0.0057, -0.1225), (0.0049, -0.1232), (0.0049, -0.1240), (0.0056, -0.1250),
            (0.0053, -0.1490), (0.0051, -0.1512), (0.0044, -0.1535), (0.0044, -0.1595), (0.0040, -0.1597), (0.0040, -0.1630), (0.0036, -0.1680),
            (0.0026, -0.1720), (0.0012, -0.1745), (0, -0.1750)]
    ck = ['steelcase'] * 10 + ['copper'] * 7
    rounds.piece(lambda b: lathe(b, cart, 20, 'z', (0, -0.041), kinds=ck, closed=False), 'r', smooth=50, wn=False)

    parts = [body, charge, sel, trig, mag, rounds]
    empties = [('MUZZLE_akm', dorsal3((0, 0, -0.853)), None), ('EJECT_akm', dorsal3((0.017, 0.010, -0.19)), None),
               ('SIGHT_akm', dorsal3((0, 0.040, -0.270)), None),
               ('GRIP_R_akm', dorsal3((0.001, -0.085, -0.030), (1, 0.25, 0)), None),
               ('GRIP_L_akm', dorsal3((0, -0.040, -0.40), (-0.55, -0.83, 0)), None)]
    root = assemble('WPN_akm', parts, empties)
    # the markings: АВ / ОД by the selector, the serial, year and Izhevsk's mark on the left and on
    # the cover, the leaf's range figures
    px = 0.00004
    st = []
    m, w, h = text_mask('АВ', 0.0030, px); st.append(Stamp(m, w, h, (0.01551, -0.0185, -0.1640), (0, 0, -1), (0, 1, 0), (1, 0, 0), 0.00005))
    m, w, h = text_mask('ОД', 0.0030, px); st.append(Stamp(m, w, h, (0.01551, -0.0370, -0.1580), (0, 0, -1), (0, 1, 0), (1, 0, 0), 0.00005))
    m, w, h = text_mask('ВЛ 1734', 0.0030, px); st.append(Stamp(m, w, h, (-0.01551, 0.0010, -0.0270), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00005))
    m, w, h = logo_izhevsk(0.0045, px); st.append(Stamp(m, w, h, (-0.01551, -0.0280, -0.0110), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00005))
    m, w, h = text_mask('1974', 0.0028, px); st.append(Stamp(m, w, h, (-0.01551, -0.0280, -0.0215), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00005))
    m, w, h = text_mask('ВЛ 1734', 0.0028, px); st.append(Stamp(m, w, h, (0, 0.02281, -0.0340), (1, 0, 0), (0, 0, -1), (0, 1, 0), 0.00004))
    m, w, h = text_mask('ВЛ 1734', 0.0024, px); st.append(Stamp(m, w, h, (0.01251, 0.0055, -0.1750), (0, 0, -1), (0, 1, 0), (1, 0, 0), 0.00003, 'bright'))
    for i, t in enumerate(('П', '2', '3', '4', '5', '6', '7', '8', '9', '10')):
        m, w, h = text_mask(t, 0.0018, px)
        z = -0.3380 + i * 0.0068
        st.append(Stamp(m, w, h, (0, 0.0242 + (z + 0.3425) * 0.045, z), (1, 0, 0), (0, 0, -1), (0, 1, 0), 0.00003, 'white'))
    for z in (-0.535, -0.5425, -0.550):
        m, w, h = disc_mask(0.0011, px)
        for sx in (1, -1):
            st.append(Stamp(m, w, h, (sx * 0.0085, 0.022, z), (0, 0, -sx), (0, 1, 0), (sx, 0, 0), 0, 'ink'))
    STAMPS['akm'] = st
    return root, {'parts': [p.name for p in parts]}

def akm_shade(sf, base, rough, metal):
    sh_steel(sf, sf.kind('blued'), base, rough, metal, tone=(0.042, 0.044, 0.048), r0=0.52, holster=0.4)
    sh_steel(sf, sf.kind('parker'), base, rough, metal, tone=(0.045, 0.045, 0.043), r0=0.60, holster=0, seed=3)
    sh_steel(sf, sf.kind('worn'), base, rough, metal, tone=(0.12, 0.12, 0.118), r0=0.36, holster=0, seed=5, worn_col=(0.19, 0.188, 0.183))
    sh_plain(sf, sf.kind('black'), base, rough, metal, 'black')
    sh_plain(sf, sf.kind('cavity'), base, rough, metal, 'cavity')
    sh_laminate(sf, sf.kind('laminate'), base, rough, metal)
    sh_plum(sf, sf.kind('plum'), base, rough, metal)
    ix = sf.kind('plum')
    # the grip's moulded ribs, the magazine's fine moulding texture
    sh_brass(sf, sf.kind('copper'), base, rough, metal, tone=(0.62, 0.34, 0.20), seed=3)
    ix = sf.kind('steelcase')
    sh_plain(sf, ix, base, rough, metal, 'steelcase', 0.15)
    overlay_dust(sf, base, rough, metal, 0.9)
    apply_stamps(sf, STAMPS['akm'], base, rough, metal)

def akm_grip_ribs(sf, ix, P):
    q, nl = to_local(AKM_GRIP, P, sf.N[ix])
    side = ss(0.55, 0.75, np.abs(nl[:, 0]))
    zone = ss(-0.044, -0.036, q[:, 1]) * ss(0.040, 0.030, q[:, 1])
    rib = 0.5 + 0.5 * np.cos(2 * PI * q[:, 2] / 0.0024)
    return rib * side * zone * 0.00030

def akm_height(sf, P):
    h = np.zeros(sf.n, np.float32)
    for k, sd in (('blued', 0), ('parker', 3), ('worn', 5)):
        ix = sf.kind(k); h[ix] = h_steel(sf, ix, P[ix], sd)
    ix = sf.kind('laminate'); h[ix] = h_laminate(sf, ix, P[ix])
    ix = sf.kind('plum')
    h[ix] = (vnoise(P[ix], 0.0005, 47) - 0.5) * 0.000008 + akm_grip_ribs(sf, ix, P[ix]) * (P[ix, 1] < -0.040) * (P[ix, 2] > -0.11)
    return h + stamp_height(sf, STAMPS['akm'], P)

AKM_VIEWS = [('q', (-0.36, 0.17, 0.30), (0.0, -0.04, -0.25), 32), ('r', (0.75, 0.02, -0.28), (0.0, -0.04, -0.28), 30),
             ('rec', (0.22, 0.05, -0.08), (0.0, -0.02, -0.17), 45), ('top', (-0.12, 0.16, 0.10), (0.0, 0.0, -0.12), 40),
             ('fp', (-0.119, 0.115, 0.170), (-0.119, 0.105, -0.8), 26.7),
             ('charge', (0.22, 0.05, -0.08), (0.0, -0.02, -0.17), 45, {'CHARGE_akm': (0.115, 0, 0), 'SELECTOR_akm': (0, -0.4, 0)})]

# ---------------------------------------------------------------- the Mosin-Nagant M44
# (bore on y = 0, the receiver's back at z = 0)
def ngon(n, R, rot=0.0):
    return [(R * math.cos(rot + 2 * PI * k / n), R * math.sin(rot + 2 * PI * k / n)) for k in range(n)]

def cross_blade(R, n=4, valley=0.36):
    """a cruciform bayonet's section: four ridges, four fluted valleys"""
    out = []
    for k in range(n * 4):
        a = 2 * PI * k / (n * 4)
        ph = (k % 4)
        r = R if ph == 0 else (R * valley if ph == 2 else R * 0.55)
        out.append((r * math.cos(a + PI / 4), r * math.sin(a + PI / 4)))
    return out

def build_mosin():
    body = Part('mosin_body')
    bolt = Part('BOLT_mosin')
    trig = Part('TRIGGER_mosin', frame3((0, -0.045, -0.012)))

    # -- the stock: birch, the forend to its nose, round the action, the slim wrist, the butt
    st = [(-0.5400, 0, -0.0200, 0.0168, 0.0165, 2.4), (-0.5250, 0, -0.0215, 0.0196, 0.0195, 2.4), (-0.4000, 0, -0.0220, 0.0203, 0.0203, 2.5),
          (-0.2500, 0, -0.0225, 0.0208, 0.0208, 2.5), (-0.1700, 0, -0.0245, 0.0214, 0.0225, 2.6), (-0.0800, 0, -0.0252, 0.0220, 0.0232, 2.6),
          (-0.0150, 0, -0.0260, 0.0215, 0.0242, 2.6), (0.0300, 0, -0.0310, 0.0186, 0.0270, 2.5), (0.0700, 0, -0.0400, 0.0170, 0.0240, 2.4),
          (0.1100, 0, -0.0525, 0.0176, 0.0335, 2.5), (0.1600, 0, -0.0685, 0.0190, 0.0485, 2.6), (0.2200, 0, -0.0805, 0.0200, 0.0595, 2.7),
          (0.3000, 0, -0.0880, 0.0205, 0.0650, 2.8)]
    def groove(b):
        lathe(b, [(0, -0.7000), (0.0052, -0.6990), (0.0052, -0.3300), (0, -0.3240)], 14, 'z', (0.0245, -0.0100), 'wood', closed=False)
    body.piece(lambda b: zloft(b, st, 44, 'wood'), 'stock', ops=[
        ('cut', lambda b: cyl(b, (0, 0, -0.08), 0.0158, 0.19, 'z', 24, 'wood')), ('cut', groove), ('bevel', 0.0016, 2, 35)], uvd=0.55, uva=32)
    hg = [(-0.4000, 0, 0.0030, 0.0140, 0.0175, 2.2), (-0.3900, 0, 0.0030, 0.0148, 0.0185, 2.2), (-0.2700, 0, 0.0030, 0.0152, 0.0190, 2.2), (-0.2580, 0, 0.0030, 0.0145, 0.0180, 2.2)]
    body.piece(lambda b: zloft(b, hg, 32, 'wood'), 'handguard', ops=[('cut', lambda b: box(b, (0, -0.025, -0.33), (0.05, 0.047, 0.2), 'wood')),
                                                                    ('cut', lambda b: cyl(b, (0, 0, -0.33), 0.0112, 0.2, 'z', 24, 'wood')), ('bevel', 0.0010, 2, 35)], uvd=0.8)
    # the barrel, crowned; the bands; the butt plate
    body.piece(lambda b: lathe(b, [(0.0040, -0.7280), (0.0080, -0.7280), (0.0085, -0.7265), (0.0088, -0.4000), (0.0102, -0.2600), (0.0108, -0.2000),
                                   (0.0115, -0.1700), (0.0040, -0.1700)], 24, 'z', (0, 0), kinds=['blued'] * 6 + ['black', 'black']), 'barrel', smooth=50, wn=False, uvd=0.6)
    for z0, cy, hh in ((-0.4000, -0.0100, 0.0337), (-0.5150, -0.0165, 0.0276)):
        body.piece(lambda b, z0=z0, cy=cy, hh=hh: zloft(b, [(z0 - 0.0050, 0, cy, 0.0220, hh, 2.4), (z0 + 0.0050, 0, cy, 0.0220, hh, 2.4)], 36, 'blued'),
                   f'band{z0}', ops=[('bevel', 0.0007, 2, 35)])
        body.piece(lambda b, z0=z0, cy=cy, hh=hh: rivet(b, (0.0218, cy, z0), 0.0022, 0.0010, 'x', 1), f'bandscrew{z0}', smooth=60, wn=False)
    body.piece(lambda b: zloft(b, [(0.2985, 0, -0.0880, 0.0208, 0.0654, 2.8), (0.3045, 0, -0.0880, 0.0208, 0.0654, 2.8)], 44, 'blued'), 'buttplate',
               ops=[('bevel', 0.0008, 2, 35)])
    body.piece(lambda b: (rivet(b, (0, -0.0380, 0.3040), 0.0028, 0.0010, 'z', 1), rivet(b, (0, -0.1350, 0.3040), 0.0028, 0.0010, 'z', 1)), 'buttscrews', smooth=60, wn=False)
    # -- the receiver: the hexagonal front ring, the round body with the loading port on top and the
    # right side cut low for the bolt handle, the rear bridge with the stripper clip guide, the tang
    body.piece(lambda b: prism(b, fillet(ngon(6, 0.0182, 0.0), 0.0020, 3), 'z', -0.1670, -0.1370), 'ring', ops=[('bevel', 0.0006, 2, 35)], uvd=1.6)
    def rbody(b):
        cyl(b, (0, 0, -0.0660), 0.0155, 0.1420, 'z', 32, 'blued')
    def rcuts(b):
        box(b, (0, 0.0150, -0.0610), (0.0172, 0.0200, 0.1040), 'cavity')            # the loading port
        box(b, (0, -0.0140, -0.0750), (0.0150, 0.0180, 0.0700), 'cavity')           # down into the magazine
        cyl(b, (0, 0, -0.06), 0.0098, 0.20, 'z', 24, 'cavity')                       # the bolt's way
    def clipguide(b):
        box(b, (0, 0.0145, -0.0105), (0.0150, 0.0060, 0.0036), 'cavity')
    body.piece(rbody, 'receiver', ops=[('bevel', 0.0005, 2, 35), ('cut', rcuts), ('cut', clipguide), ('bevel', 0.0003, 1, 60)], uvd=1.5)
    body.piece(lambda b: prism(b, fillet([(0.0040, -0.0010), (0.0040, -0.0060), (0.0780, -0.0200), (0.0800, -0.0170)], 0.002, 3), 'x', -0.0085, 0.0085),
               'tang', ops=[('bevel', 0.0006, 2, 35)])
    body.piece(lambda b: rivet(b, (0, -0.0145, 0.0650), 0.0032, 0.0010, 'y', 1), 'tangscrew', smooth=60, wn=False)
    body.piece(lambda b: box(b, (0, -0.0185, -0.0750), (0.0140, 0.0016, 0.0660), 'parker'), 'follower')
    # the rear sight on the barrel: its base and ramps, the leaf, the slider with its notch
    sb = fillet([(-0.2525, 0.0060), (-0.1775, 0.0060), (-0.1775, 0.0135), (-0.1850, 0.0175), (-0.2450, 0.0160), (-0.2525, 0.0120)], [0.001, 0.001, 0.002, 0.003, 0.002, 0.002], 3)
    body.piece(lambda b: (prism(b, sb, 'x', -0.0120, 0.0120), cyl(b, (0, 0, -0.215), 0.0118, 0.0750, 'z', 24, 'blued')), 'sightbase',
               ops=[('cut', lambda b: box(b, (0, 0.0200, -0.212), (0.0160, 0.0130, 0.072), 'cavity')), ('bevel', 0.0005, 2, 35)], uvd=1.4)
    body.piece(lambda b: prism(b, fillet([(-0.2500, 0.0150), (-0.1780, 0.0185), (-0.1780, 0.0215), (-0.2490, 0.0180)], 0.0006, 2), 'x', -0.0075, 0.0075),
               'leaf', ops=[('bevel', 0.0003, 1, 35)], uvd=2.0)
    sp_ = [(-0.0095, 0.0170), (0.0095, 0.0170), (0.0095, 0.0330), (0.0013, 0.0330), (0.0013, 0.0305), (-0.0013, 0.0305), (-0.0013, 0.0330), (-0.0095, 0.0330)]
    body.piece(lambda b: (prism(b, fillet(sp_, [0.001, 0.001, 0.0008, 0, 0.0004, 0.0004, 0, 0.0008], 2), 'z', -0.1905, -0.1795),
                           cyl(b, (0.0102, 0.0225, -0.1850), 0.0024, 0.0020, 'x', 12), cyl(b, (-0.0102, 0.0225, -0.1850), 0.0024, 0.0020, 'x', 12)),
               'slider', ops=[('bevel', 0.0003, 1, 35)], uvd=2.0)
    # the hooded front sight at the muzzle, its post; the bayonet's hinge on the right
    body.piece(lambda b: (cyl(b, (0, 0, -0.7060), 0.0118, 0.0360, 'z', 24, 'blued'), box(b, (0, 0.0080, -0.7050), (0.0180, 0.0100, 0.0260), 'blued')),
               'fsbase', ops=[('bevel', 0.0006, 2, 35)])
    def hood(b):
        lathe(b, [(0.0114, -0.7170), (0.0130, -0.7170), (0.0130, -0.6940), (0.0114, -0.6940)], 20, 'z', (0, 0.0200), 'blued', a0=-0.55, a1=PI + 0.55)
    body.piece(hood, 'hood', ops=[('bevel', 0.0004, 1, 35)])
    body.piece(lambda b: box(b, (0, 0.0215, -0.7050), (0.0024, 0.0230, 0.0024), 'blued'), 'post', ops=[('bevel', 0.0003, 1, 35)])
    body.piece(lambda b: (box(b, (0.0175, -0.0060, -0.7100), (0.0130, 0.0200, 0.0260), 'blued'), cyl(b, (0.0255, -0.0100, -0.7000), 0.0030, 0.0150, 'x', 12, 'worn')),
               'bayonetmount', ops=[('bevel', 0.0007, 2, 35)])
    # the folded spike bayonet: cruciform, its tip back along the stock
    def blade(b):
        rings = []
        for i in range(9):
            t = i / 8
            z = -0.6950 + t * 0.3650
            R = 0.0044 * (1 - t) ** 0.6 + 0.0002
            rings.append([(0.0255 + x, -0.0100 + y, z) for x, y in cross_blade(R)])
        loft(b, rings, 'blued')
        cyl(b, (0.0255, -0.0100, -0.6990), 0.0050, 0.0120, 'z', 16, 'blued')
    body.piece(blade, 'bayonet', smooth=50, wn=False, uvd=0.6)
    # the magazine box, the trigger guard, the guard's tang along the stock
    mp = fillet([(-0.1280, -0.0440), (-0.1245, -0.0585), (-0.1140, -0.0660), (-0.0520, -0.0660), (-0.0440, -0.0600), (-0.0440, -0.0440)],
                [0.002, 0.006, 0.004, 0.004, 0.003, 0.001], 4)
    body.piece(lambda b: prism(b, mp, 'x', -0.0136, 0.0136), 'magazine', ops=[('bevel', 0.0007, 2, 35)])
    body.piece(lambda b: prism(b, [(-0.0070, -0.0440), (0.0070, -0.0440), (0.0070, 0.0360), (-0.0070, 0.0360)], 'y', -0.0500, -0.0465), 'guardtang',
               ops=[('bevel', 0.0006, 2, 35)])
    gp = [(0, y, z) for z, y in catmull([(-0.0430, -0.0600), (-0.0370, -0.0660), (-0.0240, -0.0725), (-0.0040, -0.0745), (0.0120, -0.0700),
                                          (0.0220, -0.0590), (0.0250, -0.0480)], 4)]
    body.piece(lambda b: sweep(b, gp, rrect(-0.0036, -0.0016, 0.0036, 0.0016, 0.0013, 3), 'blued', side=(1, 0, 0)), 'guard', wn=False)
    body.piece(lambda b: (rivet(b, (0, -0.0500, -0.0350), 0.0024, 0.0009, 'y', -1), rivet(b, (0, -0.0500, 0.0300), 0.0024, 0.0009, 'y', -1)), 'guardscrews', smooth=60, wn=False)

    # -- the bolt (turns about the bore, handle up; slides back): body, head, extractor, the bent
    # handle and its ball, the cocking piece behind
    def bbody(b):
        cyl(b, (0, 0, -0.0320), 0.0090, 0.1240, 'z', 24, 'worn')
        box(b, (0.0072, 0.0040, -0.0820), (0.0030, 0.0030, 0.0250), 'parker')       # the extractor
        box(b, (0, 0.0088, -0.0350), (0.0040, 0.0024, 0.0800), 'worn')            # the guide rib
    bolt.piece(bbody, 'body', ops=[('bevel', 0.0005, 2, 35)], uvd=1.3)
    hpath = [(0.0060, -0.0005, 0.0120), (0.0250, -0.0010, 0.0120), (0.0420, -0.0035, 0.0120), (0.0540, -0.0085, 0.0120), (0.0610, -0.0120, 0.0120)]
    hpath = [tuple(p) for p in catmull(hpath, 4)]
    bolt.piece(lambda b: sweep(b, hpath, circle(0, 0, 0.0047, 14), 'worn', side=(0, 0, 1), scale=[1.0 - 0.15 * i / (len(hpath) - 1) for i in range(len(hpath))]),
               'handle', wn=False, smooth=50, uvd=1.3)
    def ball(b):
        bm2 = bmesh.ops.create_uvsphere(b, u_segments=20, v_segments=12, radius=0.0100)
        for v in bm2['verts']: v.co += Vector((0.0680, -0.0145, 0.0120))
        for f in {f for v in bm2['verts'] for f in v.link_faces}: f.material_index = KID['worn']
    bolt.piece(ball, 'ball', smooth=50, wn=False, uvd=1.3)
    ck = [(0, 0.0300), (0.0098, 0.0300), (0.0106, 0.0315), (0.0106, 0.0335), (0.0098, 0.0340), (0.0106, 0.0345), (0.0106, 0.0365), (0.0098, 0.0370),
          (0.0106, 0.0375), (0.0106, 0.0450), (0.0098, 0.0490), (0.0060, 0.0505), (0, 0.0508)]
    bolt.piece(lambda b: lathe(b, ck, 24, 'z', (0, 0), 'blued', closed=False), 'cocking', smooth=50, wn=False, uvd=1.3)
    # -- the trigger
    tf = catmull([(-0.0135, -0.0400), (-0.0148, -0.0470), (-0.0165, -0.0540), (-0.0185, -0.0610), (-0.0200, -0.0655)], 3)
    tb = catmull([(-0.0172, -0.0662), (-0.0160, -0.0610), (-0.0143, -0.0540), (-0.0125, -0.0470), (-0.0105, -0.0400)], 3)
    trig.piece(lambda b: prism(b, tf + [(-0.0205, -0.0670)] + tb, 'x', -0.0028, 0.0028), 't', ops=[('bevel', 0.0010, 3, 25)])

    parts = [body, bolt, trig]
    empties = [('MUZZLE_mosin', dorsal3((0, 0, -0.728)), None), ('EJECT_mosin', dorsal3((0.008, 0.018, -0.06)), None),
               ('SIGHT_mosin', dorsal3((0, 0.033, -0.180)), None),
               ('GRIP_R_mosin', dorsal3((0.002, -0.046, 0.070), (1, 0.3, 0)), None),
               ('GRIP_L_mosin', dorsal3((0, -0.040, -0.31), (-0.5, -0.86, 0)), None)]
    root = assemble('WPN_mosin', parts, empties)
    px = 0.00004
    st_ = []
    yt = 0.0182 * math.cos(PI / 6)
    m, w, h = logo_izhevsk(0.0050, px); st_.append(Stamp(m, w, h, (0, yt + 0.00001, -0.1600), (1, 0, 0), (0, 0, -1), (0, 1, 0), 0.00005))
    m, w, h = text_mask('1944', 0.0030, px); st_.append(Stamp(m, w, h, (0, yt + 0.00001, -0.1445), (1, 0, 0), (0, 0, -1), (0, 1, 0), 0.00005))
    m, w, h = text_mask('ГН 4381', 0.0028, px); st_.append(Stamp(m, w, h, (-0.0155, 0.0030, -0.0700), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00005))
    m, w, h = text_mask('ГН 4381', 0.0022, px); st_.append(Stamp(m, w, h, (0, 0.0091, -0.0300), (1, 0, 0), (0, 0, -1), (0, 1, 0), 0.00003, 'bright'))
    for i, t in enumerate(('1', '2', '3', '4', '5', '6', '7', '8', '10')):
        m, w, h = text_mask(t, 0.0016, px)
        z = -0.2440 + i * 0.0068
        st_.append(Stamp(m, w, h, (0, 0.0181 + (z + 0.2500) * 0.049, z), (1, 0, 0), (0, 0, -1), (0, 1, 0), 0.00003, 'white'))
    STAMPS['mosin'] = st_
    return root, {'parts': [p.name for p in parts]}

def mosin_shade(sf, base, rough, metal):
    sh_steel(sf, sf.kind('blued'), base, rough, metal, tone=(0.048, 0.052, 0.060), r0=0.50, holster=0.5)
    sh_steel(sf, sf.kind('parker'), base, rough, metal, tone=(0.045, 0.045, 0.043), r0=0.60, holster=0, seed=3)
    sh_steel(sf, sf.kind('worn'), base, rough, metal, tone=(0.12, 0.12, 0.118), r0=0.36, holster=0, seed=5, worn_col=(0.19, 0.188, 0.183))
    sh_plain(sf, sf.kind('black'), base, rough, metal, 'black')
    sh_plain(sf, sf.kind('cavity'), base, rough, metal, 'cavity')
    ix = sf.kind('wood')
    sh_wood(sf, ix, base, rough, metal, centre=(0.035, -0.20))
    # the hands' grime: the wrist and under the forend darker and shinier
    P = sf.P[ix]
    hand = np.exp(-((P[:, 2] - 0.07) / 0.05) ** 2) + np.exp(-((P[:, 2] + 0.31) / 0.09) ** 2) * ss(-0.01, -0.035, P[:, 1])
    base[ix] = base[ix] * (1 - 0.22 * np.clip(hand, 0, 1))[:, None]
    rough[ix] = rough[ix] - 0.08 * np.clip(hand, 0, 1)
    overlay_dust(sf, base, rough, metal, 0.9)
    apply_stamps(sf, STAMPS['mosin'], base, rough, metal)

def mosin_height(sf, P):
    h = np.zeros(sf.n, np.float32)
    for k, sd in (('blued', 0), ('parker', 3), ('worn', 5)):
        ix = sf.kind(k); h[ix] = h_steel(sf, ix, P[ix], sd)
    ix = sf.kind('wood'); h[ix] = h_wood(sf, ix, P[ix])
    return h + stamp_height(sf, STAMPS['mosin'], P)

MOSIN_VIEWS = [('q', (-0.36, 0.16, 0.36), (0.0, -0.03, -0.18), 32), ('r', (0.75, 0.02, -0.21), (0.0, -0.03, -0.21), 28),
               ('rec', (0.14, 0.12, 0.10), (0.0, 0.0, -0.08), 40), ('muzzle', (0.16, 0.06, -0.62), (0.0, 0.0, -0.69), 40),
               ('fp', (-0.098, 0.124, 0.230), (-0.098, 0.114, -0.8), 26.7),
               ('open', (0.16, 0.13, 0.12), (0.0, 0.0, -0.05), 40, {'BOLT_mosin': (0.095, 0, 1.45)})]

# ---------------------------------------------------------------- the SPSh-44 flare pistol
# (26 mm; bore on y = 0, the breech face at z = -0.03; the barrel breaks open about x at its hinge)
FG_G = frame3((0, -0.062, 0.018), (-0.32, 0, 0))

def build_flaregun():
    body = Part('flaregun_body')
    brk = Part('BARREL_BREAK_flaregun', frame3((0, -0.026, -0.045)))
    shell = Part('SHELL_flaregun', frame3(), parent=brk)
    hammer = Part('HAMMER_flaregun', frame3((0, 0.012, 0.012)))
    trig = Part('TRIGGER_flaregun', frame3((0, -0.024, -0.026)))

    # -- the frame: the round standing breech, the body behind it, the hinge fork below the barrel
    fp = fillet([(-0.0200, 0.0150), (0.0130, 0.0150), (0.0218, 0.0070), (0.0238, -0.0150), (-0.0040, -0.0272), (-0.0200, -0.0272)],
                [0.002, 0.003, 0.006, 0.004, 0.004, 0.002], 4)
    def fcuts(b):
        box(b, (0, 0.0160, 0.0170), (0.0092, 0.0240, 0.0300), 'cavity')            # the hammer's slot
        box(b, (0, -0.0240, -0.0255), (0.0070, 0.0120, 0.0160), 'cavity')          # the trigger's
    body.piece(lambda b: (prism(b, fp, 'x', -0.0158, 0.0158), cyl(b, (0, 0, -0.0230), 0.0196, 0.0144, 'z', 32, 'blued')), 'frame',
               ops=[('bevel', 0.0008, 2, 35), ('cut', fcuts), ('bevel', 0.0003, 1, 60)], uvd=1.3)
    body.piece(lambda b: cyl(b, (0, 0, -0.0306), 0.0042, 0.0012, 'z', 16, 'parker'), 'pin', ops=[('bevel', 0.0002, 1, 40)])
    fork = fillet([(-0.0330, -0.0185), (-0.0330, -0.0330), (-0.0520, -0.0330), (-0.0560, -0.0260), (-0.0520, -0.0190)], [0, 0.002, 0.004, 0.005, 0.003], 4)
    for sx in (1, -1):
        body.piece(lambda b, sx=sx: prism(b, fork, 'x', sx * 0.0060, sx * 0.0130), f'fork{sx}', ops=[('bevel', 0.0006, 2, 35)])
    body.piece(lambda b: cyl(b, (0, -0.0260, -0.0450), 0.0030, 0.0280, 'x', 14, 'worn'), 'hingepin', ops=[('bevel', 0.0003, 1, 40)])
    # the barrel catch on the left
    lat = fillet([(-0.0300, 0.0020), (-0.0060, 0.0040), (-0.0040, 0.0100), (-0.0300, 0.0110)], 0.0015, 3)
    body.piece(lambda b: prism(b, lat, 'x', -0.0172, -0.0158), 'latch', ops=[('bevel', 0.0004, 2, 30)])
    body.piece(lambda b: rivet(b, (-0.0172, 0.0065, -0.0270), 0.0022, 0.0008, 'x', -1, 'parker'), 'latchpin', smooth=60, wn=False)
    # the grip: Bakelite, its top cut to the frame; the steel cap and lanyard ring
    gst = [(-0.0440, 0.0010, 0.0140, 0.0208, 2.5), (-0.0360, 0.0010, 0.0146, 0.0215, 2.5), (0.0000, 0.0005, 0.0146, 0.0218, 2.5),
           (0.0300, 0.0000, 0.0142, 0.0215, 2.5), (0.0520, 0.0000, 0.0136, 0.0210, 2.5)]
    body.piece(lambda b: frame_loft(b, FG_G, gst, 32, 'bakelite'), 'grip',
               ops=[('cut', lambda b: prism(b, fp, 'x', -0.03, 0.03)), ('bevel', 0.0010, 2, 35)], uvd=1.2)
    body.piece(lambda b: frame_loft(b, FG_G, [(-0.0480, 0.0010, 0.0134, 0.0200, 2.5), (-0.0435, 0.0010, 0.0144, 0.0212, 2.5)], 28, 'blued'), 'gripcap',
               ops=[('bevel', 0.0005, 1, 40)])
    def lring(b):
        torus(b, (0, -0.0560, 0.0150), 0.0070, 0.0013, 'x', 20, 8, 'blued'); xform(b, FG_G)
    body.piece(lring, 'lanyard', wn=False)
    # the trigger guard: a broad oval from the hinge fork round to the grip
    body.piece(lambda b: box(b, (0, -0.0342, -0.0490), (0.0260, 0.0026, 0.0080), 'blued'), 'forkbridge', ops=[('bevel', 0.0005, 2, 35)])
    gp = [(0, y, z) for z, y in catmull([(-0.0490, -0.0335), (-0.0530, -0.0390), (-0.0525, -0.0440), (-0.0475, -0.0478), (-0.0320, -0.0495),
                                          (-0.0120, -0.0485), (-0.0010, -0.0445), (0.0040, -0.0385)], 4)]
    body.piece(lambda b: sweep(b, gp, rrect(-0.0036, -0.0018, 0.0036, 0.0018, 0.0014, 3), 'blued', side=(1, 0, 0)), 'guard', wn=False)

    # -- the barrel: a smooth 26 mm tube, the breech band, the muzzle ring, the sighting rib with
    # its groove, the hinge lug under the breech
    bp = [(0.0135, -0.1955), (0.0160, -0.1962), (0.0196, -0.1962), (0.0199, -0.1945), (0.0199, -0.1880), (0.0186, -0.1868), (0.0185, -0.0420),
          (0.0193, -0.0405), (0.0193, -0.0302), (0.0160, -0.0300), (0.0159, -0.0335), (0.0136, -0.0340)]
    bk = ['blued'] * 9 + ['black'] * 3
    brk.piece(lambda b: lathe(b, bp, 40, 'z', (0, 0), kinds=bk), 'tube', smooth=50, wn=False, uvd=1.0)
    rib = fillet([(-0.0040, 0.0170), (0.0040, 0.0170), (0.0040, 0.0212), (0.0009, 0.0212), (0.0, 0.0200), (-0.0009, 0.0212), (-0.0040, 0.0212)],
                 [0, 0, 0.0008, 0, 0, 0, 0.0008], 2)
    brk.piece(lambda b: prism(b, rib, 'z', -0.1870, -0.0420), 'rib', ops=[('bevel', 0.0003, 1, 35)], uvd=1.4)
    lug = fillet(hull2d(circle(-0.0450, -0.0260, 0.0068, 20) + [(-0.0330, -0.0150), (-0.0600, -0.0150)]), 0, 1)
    brk.piece(lambda b: prism(b, lug, 'x', -0.0056, 0.0056), 'lug', ops=[('bevel', 0.0006, 2, 35)])
    # the cartridge in the chamber: its brass head at the breech, the case running forward
    shell.piece(lambda b: lathe(b, [(0, -0.0300), (0.0030, -0.0300), (0.0032, -0.0303), (0.0150, -0.0300), (0.0154, -0.0305), (0.0154, -0.0326),
                                    (0.0133, -0.0330), (0.0132, -0.1030), (0, -0.1030)], 32, 'z', (0, 0),
                                kinds=['copper', 'brass', 'brass', 'brass', 'brass', 'brass', 'flarered', 'flarered'], closed=False), 'cart', smooth=50, wn=False)

    # -- the hammer (down; cocking turns its top back about x): a broad spur, grooved
    hp = [(0.0105, 0.0035), (0.0110, 0.0270), (0.0150, 0.0320), (0.0250, 0.0370), (0.0315, 0.0375), (0.0330, 0.0350), (0.0270, 0.0315),
          (0.0205, 0.0275), (0.0190, 0.0120), (0.0160, 0.0075)]
    def hgrooves(b):
        for i in range(6):
            z = 0.0215 + i * 0.0018
            y = 0.0352 + (z - 0.0215) * 0.20
            box(b, (0, y + 0.0004, z), (0.012, 0.0012, 0.0007), 'blued', rot=(-0.2, 0, 0))
    hammer.piece(lambda b: prism(b, fillet(hp, [0.002, 0.002, 0.004, 0.003, 0.0015, 0.0012, 0.003, 0.003, 0.004, 0.003], 4), 'x', -0.0042, 0.0042), 'h',
                 ops=[('bevel', 0.0005, 2, 35), ('cut', hgrooves)], uvd=1.3)
    hammer.piece(lambda b: cyl(b, (0, 0.012, 0.012), 0.0035, 0.0100, 'x', 16, 'worn'), 'hub', ops=[('bevel', 0.0003, 1, 40)])
    # -- the trigger
    tf = catmull([(-0.0285, -0.0225), (-0.0300, -0.0285), (-0.0318, -0.0340), (-0.0335, -0.0390)], 3)
    tb = catmull([(-0.0310, -0.0400), (-0.0294, -0.0345), (-0.0276, -0.0290), (-0.0255, -0.0225)], 3)
    trig.piece(lambda b: prism(b, tf + [(-0.0338, -0.0405)] + tb, 'x', -0.0029, 0.0029), 't', ops=[('bevel', 0.0010, 3, 25)])

    parts = [body, brk, shell, hammer, trig]
    empties = [('MUZZLE_flaregun', dorsal3((0, 0, -0.198)), brk), ('EJECT_flaregun', dorsal3((0, 0, -0.03)), brk),
               ('SIGHT_flaregun', dorsal3((0, 0.0225, -0.04)), None),
               ('GRIP_R_flaregun', dorsal3((0.001, -0.058, 0.016), (1, 0.25, 0)), None),
               ('GRIP_L_flaregun', dorsal3((-0.021, -0.072, 0.022), (-0.9, -0.45, 0)), None)]
    root = assemble('WPN_flaregun', parts, empties)
    px = 0.00004
    st = []
    m, w, h = text_mask('СПШ-44', 0.0032, px); st.append(Stamp(m, w, h, (-0.0159, 0.0030, 0.0040), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00005))
    m, w, h = text_mask('№ 2716', 0.0026, px); st.append(Stamp(m, w, h, (-0.0159, -0.0040, 0.0040), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00005))
    m, w, h = text_mask('1944', 0.0026, px); st.append(Stamp(m, w, h, (-0.0159, -0.0110, 0.0060), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00005))
    m, w, h = text_mask('26', 0.0040, px); st.append(Stamp(m, w, h, (-0.0186, 0.0, -0.0700), (0, 0, 1), (0, 1, 0), (-1, 0, 0), 0.00005))
    STAMPS['flaregun'] = st
    return root, {'parts': [p.name for p in parts]}

def fg_grip_detail(sf, ix, P):
    q, nl = to_local(FG_G, P, sf.N[ix])
    side = ss(0.5, 0.7, np.abs(nl[:, 0]))
    fld = ss(0.0006, -0.0002, sd_rrect(q[:, 2], q[:, 1], -0.0150, -0.0360, 0.0150, 0.0300, 0.004)) * side
    return checker(q[:, 2], q[:, 1], 0.0013) * fld * 0.00032 - fld * 0.00032, fld

def fg_shade(sf, base, rough, metal):
    sh_steel(sf, sf.kind('blued'), base, rough, metal, tone=(0.046, 0.049, 0.054), r0=0.52, holster=0.5)
    sh_steel(sf, sf.kind('parker'), base, rough, metal, tone=(0.045, 0.045, 0.043), r0=0.60, holster=0, seed=3)
    sh_steel(sf, sf.kind('worn'), base, rough, metal, tone=(0.12, 0.12, 0.118), r0=0.36, holster=0, seed=5, worn_col=(0.19, 0.188, 0.183))
    sh_plain(sf, sf.kind('black'), base, rough, metal, 'black')
    sh_plain(sf, sf.kind('cavity'), base, rough, metal, 'cavity')
    ix = sf.kind('bakelite')
    sh_bakelite(sf, ix, base, rough, metal, tone=(0.020, 0.012, 0.008), seed=2)
    h, fld = fg_grip_detail(sf, ix, sf.P[ix])
    rough[ix] = mix(rough[ix], 0.5, fld * 0.8)
    sh_brass(sf, sf.kind('brass'), base, rough, metal)
    sh_brass(sf, sf.kind('copper'), base, rough, metal, tone=(0.62, 0.34, 0.20), seed=3)
    sh_plain(sf, sf.kind('flarered'), base, rough, metal, 'flarered', 0.2)
    overlay_dust(sf, base, rough, metal, 0.9)
    apply_stamps(sf, STAMPS['flaregun'], base, rough, metal)

def fg_height(sf, P):
    h = np.zeros(sf.n, np.float32)
    for k, sd in (('blued', 0), ('parker', 3), ('worn', 5)):
        ix = sf.kind(k); h[ix] = h_steel(sf, ix, P[ix], sd)
    ix = sf.kind('bakelite'); h[ix] = fg_grip_detail(sf, ix, P[ix])[0]
    return h + stamp_height(sf, STAMPS['flaregun'], P)

FG_VIEWS = [('q', (-0.22, 0.12, 0.20), (0.0, -0.03, -0.07), 45), ('r', (0.34, 0.02, -0.07), (0.0, -0.035, -0.07), 50),
            ('l', (-0.34, 0.02, -0.07), (0.0, -0.035, -0.07), 50), ('fp', (-0.099, 0.077, 0.316), (-0.099, 0.067, -0.7), 26.7),
            ('open', (-0.22, 0.16, 0.16), (0.0, -0.02, -0.05), 45, {'BARREL_BREAK_flaregun': (0, -0.9, 0)})]

# ---------------------------------------------------------------- the hand flare
def build_handflare():
    body = Part('handflare_body')
    cap = Part('CAP_handflare')
    # the tube: wound red paper, rolled at the ends; the label; the igniter at the burning end; the plug
    body.piece(lambda b: lathe(b, [(0, -0.1385), (0.0118, -0.1385), (0.0128, -0.1378), (0.0160, -0.1378), (0.0165, -0.1365), (0.0165, 0.0675),
                                   (0.0160, 0.0688), (0, 0.0688)], 36, 'z', (0, 0), kinds=['igniter', 'flarered', 'flarered', 'flarered', 'flarered', 'flarered', 'flarered'],
                               closed=False), 'tube', smooth=50, wn=False)
    body.piece(lambda b: lathe(b, [(0, -0.1392), (0.0060, -0.1392), (0.0105, -0.1386), (0.0118, -0.1380), (0, -0.1380)], 28, 'z', (0, 0), 'igniter', closed=False),
               'igniter', smooth=50, wn=False)
    body.piece(lambda b: lathe(b, [(0.0164, -0.0500), (0.0168, -0.0497), (0.0168, 0.0097), (0.0164, 0.0100)], 36, 'z', (0, 0), 'paper'), 'label', smooth=50, wn=False, uvd=2.2)
    plug = [(0.0150, 0.0660), (0.0158, 0.0665), (0.0158, 0.0720), (0.0152, 0.0726), (0.0158, 0.0732), (0.0158, 0.0790), (0.0152, 0.0796), (0.0158, 0.0802),
            (0.0158, 0.0860), (0.0152, 0.0866), (0.0158, 0.0872), (0.0158, 0.1030), (0.0145, 0.1080), (0.0100, 0.1100), (0, 0.1102)]
    body.piece(lambda b: lathe(b, [(0, 0.0660)] + plug, 36, 'z', (0, 0), 'plastic', closed=False), 'plug', smooth=50, wn=False)
    # the striker cap over the burning end: a cup, the striking surface on its top
    cp = [(0.0168, -0.1345), (0.0185, -0.1345), (0.0187, -0.1360), (0.0187, -0.1660), (0.0180, -0.1695), (0.0, -0.1700), (0.0, -0.1665), (0.0168, -0.1660)]
    cap.piece(lambda b: lathe(b, cp, 36, 'z', (0, 0), kinds=['plastic', 'plastic', 'plastic', 'plastic', 'striker', 'striker', 'plastic', 'plastic']), 'cup', smooth=50, wn=False)
    parts = [body, cap]
    empties = [('MUZZLE_handflare', dorsal3((0, 0, -0.142)), None), ('GRIP_L_handflare', dorsal3((0, 0, 0.04), (0, 1, 0)), None)]
    root = assemble('WPN_handflare', parts, empties)
    # the label's print (wrapped round the tube): the name, the colour of its fire, its burning time
    px = 0.00005
    lines = [('ФАЛЬШФЕЙЕР', 0.0050, 0.0065), ('КРАСНОГО ОГНЯ', 0.0032, -0.0003), ('ГОРЕНИЕ 60 СЕК.', 0.0025, -0.0055), ('ЗАЖИГАТЬ ОТ СЕБЯ', 0.0023, -0.0095),
             ('ГОСТ 7248-54  ПАРТИЯ 12', 0.0019, -0.0130)]
    LABEL.clear()
    for t, hgt, v in lines:
        m, w, h = text_mask(t, hgt, px, 'ARIALNB.TTF')
        LABEL.append((m, w, h, v))
    return root, {'parts': [p.name for p in parts]}

LABEL = []
def label_print(P):
    """the label's ink: its text laid round the tube (u = arc length from the front, v = z)"""
    ang = np.arctan2(P[:, 0], P[:, 1])
    u = -P[:, 2] - 0.0200; v = -ang * 0.0168
    out = np.zeros(len(P), np.float32)
    for m, w, h, vc in LABEL:
        H, W = m.shape
        x = (u / w + 0.5) * W - 0.5; y = ((v - vc) / h + 0.5) * H - 0.5
        ok = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1)
        if not ok.any(): continue
        xi = np.floor(x[ok]).astype(np.int64); yi = np.floor(y[ok]).astype(np.int64)
        out[ok] = np.maximum(out[ok], m[yi, xi])
    # rules above and below the text, and a red band
    rule = ((np.abs(v - 0.0112) < 0.00035) | (np.abs(v + 0.0160) < 0.00035)) & (np.abs(u) < 0.027)
    return np.maximum(out, rule.astype(np.float32))

def hf_shade(sf, base, rough, metal):
    ix = sf.kind('flarered')
    P = sf.P[ix]
    ang = np.arctan2(P[:, 0], P[:, 1]) / (2 * PI)
    seam = np.exp(-((((ang + P[:, 2] / 0.028) % 1.0) - 0.5) / 0.004) ** 2)
    fib = aniso(P, 0.0008, (1, 1, 6), 91, 2)
    grime = ss(0.5, 0.8, fbm(P, 0.01, 92, 3))
    base[ix] = lin((0.26, 0.015, 0.010)) * (0.85 + 0.3 * fib)[:, None] * (1 - 0.3 * seam - 0.25 * grime)[:, None]
    rough[ix] = 0.72 + 0.1 * fib; metal[ix] = 0
    ix = sf.kind('paper')
    P = sf.P[ix]
    ink = label_print(P)
    col = lin((0.46, 0.40, 0.29)) * (0.9 + 0.2 * aniso(P, 0.001, (1, 1, 3), 93, 2))[:, None]
    col = mix(col, lin((0.025, 0.02, 0.018)), (ink * 0.92)[:, None])
    col = col * (1 - 0.25 * ss(0.55, 0.85, fbm(P, 0.008, 94, 3)))[:, None]
    base[ix] = col; rough[ix] = 0.8; metal[ix] = 0
    ix = sf.kind('plastic'); sh_plain(sf, ix, base, rough, metal, 'plastic', 0.25)
    ix = sf.kind('striker')
    P = sf.P[ix]
    g = vnoise(P, 0.00025, 95)
    base[ix] = lin((0.045, 0.040, 0.036)) * (0.7 + 0.6 * g)[:, None]; rough[ix] = 0.95; metal[ix] = 0
    ix = sf.kind('igniter')
    P = sf.P[ix]
    g = fbm(P, 0.0012, 96, 3)
    base[ix] = lin((0.07, 0.055, 0.045)) * (0.7 + 0.6 * g)[:, None]; rough[ix] = 0.9; metal[ix] = 0
    overlay_dust(sf, base, rough, metal, 0.6)

def hf_height(sf, P):
    h = np.zeros(sf.n, np.float32)
    ix = sf.kind('striker'); h[ix] = (vnoise(P[ix], 0.00025, 95) - 0.5) * 0.00006
    ix = sf.kind('igniter'); h[ix] = (fbm(P[ix], 0.0012, 96, 3) - 0.5) * 0.00015
    ix = sf.kind('flarered')
    ang = np.arctan2(P[ix, 0], P[ix, 1]) / (2 * PI)
    h[ix] = -np.exp(-((((ang + P[ix, 2] / 0.028) % 1.0) - 0.5) / 0.004) ** 2) * 0.00004 + (aniso(P[ix], 0.0008, (1, 1, 6), 91, 2) - 0.5) * 0.000008
    return h

HF_VIEWS = [('q', (-0.16, 0.10, 0.12), (0.0, 0.0, -0.03), 50), ('r', (0.30, 0.0, -0.03), (0.0, 0.0, -0.03), 50)]

# ---------------------------------------------------------------- the arms
# A fist at HAND (the origin): the hole the grip goes through runs along x, the back of the hand
# faces +y, the forearm runs back along +z. On the right hand the thumb is at -x (the index side),
# the index finger hooked forward for the trigger; the left hand wraps all four fingers. Both are
# signed distance fields (sdf.py), meshed, smoothed and decimated; the sleeve (a quilted vatnik's,
# channels running down the arm) and the knitted cuff are lofted.
import sdf as SDF

def finger_chain(x, joints, radii, side):
    """round cones between a finger's joints (y, z), knuckle balls at the joints"""
    P = [(side * x, y, z) for y, z in joints]
    prims = []
    for i in range(len(P) - 1):
        prims.append(SDF.RC(P[i], P[i + 1], radii[i], radii[i + 1]))
    for i in range(1, len(P)):
        prims.append(SDF.B(P[i], radii[i] * (1.03 if i < len(P) - 1 else 1.0)))
    return prims

def wrap_joints(r, phis, ay=0.0153, az=0.0190):
    A_y, A_z = ay + r, az + r
    return [(A_y * math.cos(math.radians(p)), -A_z * math.sin(math.radians(p))) for p in phis]

def hand_field(side, trigger):
    lo = (-0.066, -0.056, -0.112); hi = (0.066, 0.074, 0.112)
    F = SDF.Field(lo, hi, 0.0011)
    sx = side
    E = lambda c, r: SDF.E((sx * c[0], c[1], c[2]), r)
    # the palm, its heel wrapped behind the grip, the thumb's and the little finger's pads
    F.add(SDF.BOX((sx * -0.002, 0.0305, 0.010), (0.040, 0.0135, 0.033), 0.011), 0.0)
    F.add(E((0.006, 0.0140, 0.050), (0.036, 0.020, 0.025)), 0.010)
    F.add(E((-0.026, 0.0120, 0.034), (0.019, 0.019, 0.026)), 0.010)
    F.add(E((0.030, 0.0160, 0.036), (0.013, 0.018, 0.026)), 0.010)
    # the knuckles' ridge, the wrist, the glove's flared gauntlet
    F.add(SDF.RC((sx * -0.030, 0.0315, -0.018), (sx * 0.028, 0.0300, -0.016), 0.0120, 0.0110), 0.008)
    F.add(SDF.RC((0, 0.0160, 0.048), (0, 0.0110, 0.094), 0.0300, 0.0330), 0.014)
    F.add(SDF.RC((0, 0.0110, 0.062), (0, 0.0100, 0.090), 0.0338, 0.0350), 0.006)
    # the fingers: (x, radii, sweep angles round the grip)
    fingers = [(-0.0300, (0.0103, 0.0098, 0.0091, 0.0082), (38, 122, 182, 228)),
               (-0.0095, (0.0106, 0.0101, 0.0094, 0.0085), (38, 125, 186, 236)),
               (0.0105, (0.0102, 0.0097, 0.0090, 0.0081), (38, 124, 184, 232)),
               (0.0285, (0.0090, 0.0085, 0.0079, 0.0072), (40, 118, 174, 218))]
    for i, (x, radii, phis) in enumerate(fingers):
        if i == 0 and trigger:
            joints = [(0.0255, -0.0215), (0.0130, -0.0630), (-0.0010, -0.0815), (-0.0105, -0.0905)]
        else:
            joints = wrap_joints(radii[0], phis)
            joints[0] = (0.0255, -0.0215 + 0.001 * i)
        for k, pr in enumerate(finger_chain(x, joints, radii, sx)):
            F.add(pr, 0.007 if k == 0 else 0.0025)
    # the thumb: from its pad round the back of the grip, along the far side, pointing forward
    th = [(-0.0300, 0.0160, 0.0440), (-0.0370, -0.0040, 0.0300), (-0.0390, -0.0245, 0.0040), (-0.0360, -0.0285, -0.0180)]
    thr = (0.0150, 0.0122, 0.0110, 0.0097)
    for i in range(3):
        a = (sx * th[i][0], th[i][1], th[i][2]); b = (sx * th[i + 1][0], th[i + 1][1], th[i + 1][2])
        F.add(SDF.RC(a, b, thr[i], thr[i + 1]), 0.009 if i == 0 else 0.003)
    F.add(SDF.B((sx * th[3][0], th[3][1], th[3][2]), thr[3]), 0.002)
    # the hole the grip passes through
    F.cut(SDF.E((0, 0, 0), (0.10, 0.0150, 0.0186)), 0.002)
    return F

def mesh_from_field(bm, F):
    verts, quads = SDF.surface_nets(F.F, F.lo, F.cell)
    vs = [bm.verts.new(Vector(v)) for v in verts.tolist()]
    for q in quads.tolist():
        try:
            f = bm.faces.new([vs[i] for i in q]); f.material_index = KID['glove']
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

def orient_tube(bm, faces, yc):
    """an open tube's faces turned to look out from its axis (x = 0, y = yc)"""
    flip = []
    for f in faces:
        cc = f.calc_center_median()
        radial = Vector((cc.x, cc.y - yc, 0))
        if radial.length > 1e-6 and f.normal.dot(radial) < 0 and abs(f.normal.z) < 0.9: flip.append(f)
    if flip: bmesh.ops.reverse_faces(bm, faces=flip)

def smooth_decimate(o, target, factor=0.6, iters=6):
    m = o.modifiers.new('sm', 'SMOOTH'); m.factor = factor; m.iterations = iters
    apply_mods(o)
    m = o.modifiers.new('dc', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = min(1.0, target / max(1, tris_of(o)))
    apply_mods(o)

SLEEVE_CH = 9
def sleeve_ring(z, r, n, ycen):
    out = []
    for k in range(n):
        th = 2 * PI * k / n
        g = abs(math.sin(SLEEVE_CH * th / 2)) ** 0.55
        rr = r * (0.962 + 0.05 * g)
        out.append((rr * math.sin(th), ycen + rr * math.cos(th), z))
    return out

def build_arm(side):
    nm = 'R' if side > 0 else 'L'
    body = Part(f'arm{nm}_body')
    def glove(b):
        mesh_from_field(b, hand_field(side, trigger=side > 0))
    body.piece(glove, 'glove', ops=[('smooth', 0.6, 6), ('decimate', 7600)], wn=False, smooth=0, uvd=1.0, wset=0)
    # the knitted cuff: ribs round the wrist, its edge rolled
    def cuff(b):
        n = 80
        rings = []
        for z, r in ((0.0700, 0.0362), (0.0712, 0.0384), (0.0735, 0.0396), (0.0790, 0.0398), (0.0950, 0.0402), (0.1100, 0.0410), (0.1240, 0.0416), (0.1260, 0.0398)):
            ring = []
            for k in range(n):
                th = 2 * PI * k / n
                rib = 0.0012 * (0.5 + 0.5 * math.cos(40 * th)) if r > 0.0390 else 0.0
                ring.append(((r + rib) * math.sin(th), 0.010 + (r + rib) * math.cos(th), z))
            rings.append(ring)
        orient_tube(b, loft(b, rings, 'cuff', cap0=False, cap1=False), 0.010)
    body.piece(cuff, 'cuff', wn=False, smooth=60, uvd=0.9, wset=1)
    # the sleeve: quilted channels down the forearm, a little fuller toward the elbow
    def sleeve(b):
        n = 6 * SLEEVE_CH
        rings = []
        zs = [0.1050, 0.1080, 0.1150] + [0.13 + i * 0.0205 for i in range(21)] + [0.5600]
        for z in zs:
            t = (z - 0.105) / 0.455
            r = 0.0452 + 0.0135 * t
            if z < 0.112: r -= (0.112 - z) * 0.45
            wr = 1 + 0.018 * math.sin(z * 140.0) * math.exp(-(z - 0.11) / 0.07)
            rings.append(sleeve_ring(z, r * wr, n, 0.010 + 0.004 * t))
        orient_tube(b, loft(b, rings, 'sleeve', cap0=False, cap1=True), 0.012)
    body.piece(sleeve, 'sleeve', wn=False, smooth=60, uvd=0.55, wset=1)
    root = assemble('ARM_' + nm, [body], [('HAND_' + nm, dorsal3((0, 0, 0)), None)])
    return root, {'parts': [body.name]}

def leather(sf, ix, P):
    """the glove's grain (pebbled cells), its seams and stitching; returns height, seam, crease"""
    N = sf.N[ix]
    F1, F2 = cells3(P, 0.00055)
    peb = ss(0.0, 0.5, (F2 - F1))
    # the creases where the fingers bend (across them, on the palm side and over the knuckles)
    rid = 1 - np.abs(2 * aniso(P, 0.0016, (6, 1, 1), 101, 3) - 1)
    fing = 1 - ss(-0.014, -0.002, P[:, 2]) * ss(0.004, 0.016, P[:, 1])
    cr = ss(0.88, 0.97, rid) * (0.35 + 0.65 * fing)
    # seams along the sides of the fingers, the three points on the back, round the wrist
    sideways = np.abs(N[:, 0])
    seam_f = np.exp(-((sideways - 0.92) / 0.035) ** 2) * (1 - ss(-0.012, 0.0, P[:, 2]) * ss(0.004, 0.014, P[:, 1]))
    pts = sum(np.exp(-((P[:, 0] - c) / 0.0005) ** 2) for c in (-0.0195, 0.0005, 0.0200)) * ss(0.4, 0.7, N[:, 1]) * ss(-0.006, 0.004, P[:, 2]) * ss(0.050, 0.040, P[:, 2])
    wrist = np.exp(-((P[:, 2] - 0.0905) / 0.0006) ** 2) + np.exp(-((P[:, 2] - 0.0950) / 0.0005) ** 2)
    seam = np.clip(seam_f + pts + wrist, 0, 1)
    along = P[:, 2] * 1.0 + P[:, 0] * 0.6 + P[:, 1] * 0.3
    stitch = (0.5 + 0.5 * np.cos(2 * PI * along / 0.0024)) ** 3 * seam
    h = peb * 0.00003 - cr * 0.00006 - seam * 0.00012 + stitch * 0.00009
    return h, seam, cr, stitch

def cells3(P, size):
    """3D cellular noise: distances to the nearest and second nearest jittered points"""
    q = P.astype(np.float64) / size
    i = np.floor(q).astype(np.int64)
    F1 = np.full(len(P), 9.0, np.float32); F2 = np.full(len(P), 9.0, np.float32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i + np.array([dx, dy, dz])
                jx = _hash(c[:, 0], c[:, 1], c[:, 2], 11); jy = _hash(c[:, 0], c[:, 1], c[:, 2], 12); jz = _hash(c[:, 0], c[:, 1], c[:, 2], 13)
                d = np.sqrt((c[:, 0] + jx - q[:, 0]) ** 2 + (c[:, 1] + jy - q[:, 1]) ** 2 + (c[:, 2] + jz - q[:, 2]) ** 2).astype(np.float32)
                closer = d < F1
                F2 = np.where(closer, F1, np.minimum(F2, d)); F1 = np.where(closer, d, F1)
    return F1, F2

def arms_shade(sf, base, rough, metal):
    ix = sf.kind('glove')
    if len(ix):
        P = sf.P[ix]; N = sf.N[ix]
        h, seam, cr, stitch = leather(sf, ix, P)
        mott = fbm(P, 0.012, 102, 4)
        col = lin((0.060, 0.030, 0.015)) * (0.82 + 0.36 * mott)[:, None]
        # worn lighter and smoother where it rubs: the knuckles, the backs of the fingers, the palm's grip
        knuck = ss(0.3, 0.9, N[:, 1]) * np.exp(-((P[:, 2] + 0.018) / 0.014) ** 2)
        tip = ss(0.4, 0.8, -N[:, 2]) * ss(-0.03, -0.06, P[:, 2])
        palm = ss(0.3, 0.8, -N[:, 1]) * 0.6
        rub = np.clip(knuck + tip * 0.6 + palm * 0.5, 0, 1) * ss(0.35, 0.65, fbm(P, 0.006, 103, 3))
        col = mix(col, lin((0.125, 0.072, 0.040)), (rub * 0.55)[:, None])
        col = col * (1 - 0.35 * cr)[:, None] * (1 - 0.45 * seam)[:, None]
        col = mix(col, lin((0.11, 0.08, 0.05)), (stitch * 0.6)[:, None])
        base[ix] = col
        rough[ix] = 0.66 - 0.18 * rub + 0.1 * cr
        metal[ix] = 0
    for k, tone in (('sleeve', (0.016, 0.021, 0.040)), ('cuff', (0.024, 0.026, 0.033))):
        ix = sf.kind(k)
        if not len(ix): continue
        P = sf.P[ix]
        fz = fbm(P, 0.0009, 104, 3); mott = fbm(P, 0.03, 105, 3)
        pill = ss(0.84, 0.9, vnoise(P, 0.0007, 106))
        col = lin(tone) * (0.75 + 0.35 * fz + 0.3 * (mott - 0.5))[:, None]
        col = mix(col, lin((0.035, 0.037, 0.045)), (pill * 0.25)[:, None])
        if k == 'sleeve':
            ang = np.arctan2(P[:, 0], P[:, 1] - 0.012)
            st = np.exp(-(np.abs(np.sin(SLEEVE_CH * ang / 2)) / 0.06) ** 2)
            col = col * (1 - 0.35 * st)[:, None]
            # snow-damp and worn at the cuff end, dust in the folds
            col = mix(col, col * 1.35, (ss(0.18, 0.11, P[:, 2]) * 0.3)[:, None])
        base[ix] = col; rough[ix] = 0.95; metal[ix] = 0

def arms_height(sf, P):
    h = np.zeros(sf.n, np.float32)
    ix = sf.kind('glove')
    if len(ix): h[ix] = leather(sf, ix, P[ix])[0]
    ix = sf.kind('sleeve')
    if len(ix):
        Q = P[ix]
        ang = np.arctan2(Q[:, 0], Q[:, 1] - 0.012)
        st = np.exp(-(np.abs(np.sin(SLEEVE_CH * ang / 2)) / 0.05) ** 2)
        stitch = (0.5 + 0.5 * np.cos(2 * PI * Q[:, 2] / 0.0035)) * st
        h[ix] = (fbm(Q, 0.0009, 104, 3) - 0.5) * 0.00008 - st * 0.0003 - stitch * 0.0001
    ix = sf.kind('cuff')
    if len(ix):
        Q = P[ix]
        ang = np.arctan2(Q[:, 0], Q[:, 1] - 0.010)
        a = ang * 40 / (2 * PI)
        v = Q[:, 2] / 0.0018
        knit = np.abs(((a + np.abs(((v % 1.0) - 0.5)) * 0.8) % 1.0) - 0.5)
        h[ix] = (0.5 - knit) * 0.00025 + (fbm(Q, 0.0006, 107, 2) - 0.5) * 0.00005
    return h

ARM_VIEWS = [('q', (-0.16, 0.16, -0.20), (0.0, 0.01, 0.0), 45), ('side', (0.30, 0.04, 0.06), (0.0, 0.0, 0.05), 40),
             ('palm', (0.06, -0.20, -0.12), (0.0, 0.0, 0.0), 45), ('back', (-0.04, 0.26, 0.10), (0.0, 0.0, 0.10), 35)]

# ---------------------------------------------------------------- the run
GUNS = ['pm', 'akm', 'mosin', 'flaregun', 'handflare']
BUILD = {'pm': build_pm, 'akm': build_akm, 'mosin': build_mosin, 'flaregun': build_flaregun, 'handflare': build_handflare}
SHADE = {'pm': (pm_shade, pm_height), 'akm': (akm_shade, akm_height), 'mosin': (mosin_shade, mosin_height), 'flaregun': (fg_shade, fg_height),
         'handflare': (hf_shade, hf_height)}
VIEWS = {'pm': PM_VIEWS, 'akm': AKM_VIEWS, 'mosin': MOSIN_VIEWS, 'flaregun': FG_VIEWS, 'handflare': HF_VIEWS}
TEXDEF = {'pm': 2048, 'akm': 2048, 'mosin': 2048, 'flaregun': 1024, 'handflare': 512, 'arms': 2048}
SETS = {'pm': [(None, '', 2048)], 'akm': [(0, '_steel', 2048), (1, '_wood', 1024)], 'mosin': [(0, '_steel', 2048), (1, '_wood', 2048)],
        'flaregun': [(None, '', 1024)], 'handflare': [(None, '', 1024)], 'arms': [(0, '_glove', 2048), (1, '_cloth', 1024)]}

def set_hidden(o, hide):
    o.hide_render = hide
    for c in o.children: set_hidden(c, hide)

def solo(sc, keep):
    for o in sc.objects:
        if o.parent is None and o.name.startswith(('WPN_', 'ARM_')):
            set_hidden(o, keep is not None and o.name not in keep)

def export_scene(sc, fname):
    path = os.path.join(C.raw_dir(), fname)
    for o in list(sc.objects):
        if o.name.startswith('_'): kill(o)
    solo(sc, None)
    vl = sc.view_layers[0]
    for o in sc.objects: o.select_set(True, view_layer=vl)
    with ctx():
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True,
                                  export_extras=True, export_yup=True, export_cameras=False, export_lights=False,
                                  export_animations=False, export_skins=False, export_morph=False,
                                  export_image_format='WEBP', export_image_quality=88, export_materials='EXPORT')
    return [path, os.path.getsize(path)]

def run():
    result = {}
    guns = [a for a in WHAT if a in BUILD]
    if guns:
        sc = use_scene('ASSET_weapons')
        for a in guns:
            t = time.time()
            root, info = BUILD[a]()
            info['build_s'] = round(time.time() - t, 1)
            ms = meshes_under(root)
            info['tris'] = {o.name: tris_of(o) for o in ms}
            info['tris_total'] = sum(info['tris'].values())
            log(a, 'built:', info['tris_total'], 'tris in', info['build_s'], 's')
            if BAKE:
                sh, hf = SHADE[a]
                sets = [(sid, suf, int(TEX.get(a + suf, TEX.get(a, S)))) for sid, suf, S in SETS[a]]
                info['bake'] = bake_asset(a, ms, sets, sh, hf)
                log(a, 'baked', info['bake'])
            result[a] = info
        if PREVIEW:
            for a in guns:
                solo(sc, ['WPN_' + a])
                vv = (globals().get('XVIEWS') or {}).get(a) or VIEWS[a]
                result[a]['previews'] = previews(sc, 'wpn_' + a, [tuple(v) for v in vv])
                log(a, 'previews', result[a]['previews'])
        if EXPORT and (set(GUNS) <= set(guns) or EXPORT_ARG == 'force'):
            result['weapons_glb'] = export_scene(sc, 'weapons.glb')
            log('exported', result['weapons_glb'])
    if 'arms' in WHAT:
        sc = use_scene('ASSET_arms')
        roots = []
        info = {}
        for side in (1, -1):
            t = time.time()
            root, inf = build_arm(side)
            ms = meshes_under(root)
            inf['tris'] = {o.name: tris_of(o) for o in ms}
            inf['tris_total'] = sum(inf['tris'].values())
            log(root.name, 'built:', inf['tris_total'], 'tris in', round(time.time() - t, 1), 's')
            info[root.name] = inf
            roots.append(root)
        if BAKE:
            ms = [o for r in roots for o in meshes_under(r)]
            sets = [(sid, suf, int(TEX.get('arms' + suf, S))) for sid, suf, S in SETS['arms']]
            info['bake'] = bake_asset('arms', ms, sets, arms_shade, arms_height)
            log('arms baked', info['bake'])
        if PREVIEW:
            for r in roots:
                solo(sc, [r.name])
                info[r.name]['previews'] = previews(sc, 'arm_' + r.name[-1], ARM_VIEWS)
        if EXPORT:
            info['arms_glb'] = export_scene(sc, 'arms.glb')
            log('exported', info['arms_glb'])
        result['arms'] = info
    result['log'] = LOG
    print('RESULT ' + json.dumps({k: v for k, v in result.items() if k != 'log'}, default=str), flush=True)
    return result

try:
    result = run()
except Exception:
    tb = traceback.format_exc()
    print('FAILED\n' + tb, flush=True)
    result = {'error': tb, 'log': LOG}
