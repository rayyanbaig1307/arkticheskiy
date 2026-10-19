# The Polyarnik (ПОЛЯРНИК): a Russian icebreaking harbour tug, 43 m, built in its own scene and
# exported to tools/blender/raw/tug.glb (tools/pack.mjs compresses it into public/models/).
# Run in Blender through the connector (tools/blender/run.py).
#
# Blender axes: x starboard, y forward (the bow at +y), z up; the waterline is z = 0.
#
#   hull        lofted from stations: a flat bottom with a round bilge, a spoon bow raked at 25
#               degrees under water (she rides up onto the ice and breaks it with her weight), a
#               wide cut-up stern over twin nozzles; flared topsides; bulwarks to the sheer, a red
#               cap rail, rubber fenders, plating welds and the hungry-horse dents in a normal map
#   decks       main deck z 2.5 (aft working deck, side walkways), forecastle and 01 deck z 5.0,
#               02 deck / bridge floor z 7.6, bridge roof z 10.3; engine room floor z -1.6
#   level 1     (main deck) mess room aft, the stair hall (up to the 01 lobby, down to the engine
#               room), a closed cabin forward
#   level 2     (01 deck) a closed cabin block with the stair lobby; the boat deck aft of it with
#               the funnel and the liferafts; external stairs from the aft deck
#   bridge      (02 deck) big raked windows, the console (wheel, throttle, radar, horn, the
#               searchlight's joystick, the VHF), the chart table, wings with ladders down
#
# Node names are the game's contract (src/boat/BoatModel.js): COL_, ZONE_, LAD_, LMP_, SPOT_,
# PATH_, INT_<kind>_<id>, SL_*, RADAR_scanner, NEEDLE_*, BOAT_info.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Euler
import numpy as np

import importlib
import common as C
importlib.reload(C)

DETAIL = globals().get('DETAIL', 1)

# ---------------------------------------------------------------- the layout (metres)
DECK, L01, L02, ER = 2.5, 5.0, 7.6, -1.6
FC = L01                                       # the forecastle is level with the 01 deck
BRC, ROOF = 10.15, 10.3                        # bridge ceiling, bridge roof
T = 0.12                                       # wall thickness
DH = dict(x=4.3, y0=-7.0, y1=8.5)              # level 1 (main deck)
MESS = (-7.0, -0.5); HALL = (-0.5, 5.5); CABIN = (5.5, 8.5)
OVER = 5.0                                     # the 01 deck overhangs the walkways to x 5.0
L2 = dict(x=3.5, y0=-2.5, y1=8.2)              # level 2 (01 deck)
LOBBY = dict(x0=-3.38, x1=-0.4, y0=0.6, y1=5.6)
BR = dict(x=4.2, y0=0.4, y1=8.4)               # the bridge (02 deck)
WING = dict(x0=4.2, x1=6.0, y0=4.0, y1=6.6)
ERM = dict(x=4.4, y0=-12.5, y1=8.0)            # engine room
FLIGHT1 = dict(x0=-3.0, x1=-1.9, y0=1.0, y1=4.5)       # hall -> lobby, climbing forward
FLIGHT2 = dict(x0=-1.75, x1=-0.6, y0=4.6, y1=1.1)      # lobby -> bridge, climbing aft
STAIR_DN = dict(x0=2.7, x1=3.9, y0=1.0, y1=5.0)        # hall -> engine room, descending forward
AFT_STAIR = dict(x0=0.85, x1=3.4, y0=-8.25, y1=-7.1)   # aft deck -> 01 landing (both sides, climbing outboard)
DOOR_H = 2.0

def smoothstep(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)

# ---------------------------------------------------------------- hull shape
Y_STERN, Y_BOW_WL, Y_BOW_TOP = -20.0, 19.4, 23.0

def sheer(y):
    """the top of the bulwark: a clean step up to the forecastle, then a little spring to the stem"""
    return 3.55 + 2.5 * smoothstep(6.6, 8.6, y) + max(0.0, y - 15.0) ** 1.5 * 0.035

def keel(y):
    if y < -11.0:
        u = (-11.0 - y) / 9.0
        return -4.3 + 3.35 * u ** 1.5                     # the stern cut up to -0.95 at the transom
    if y > 9.4:
        if y <= Y_BOW_WL:
            return max(-4.3, (y - Y_BOW_WL) * math.tan(math.radians(25)))
        return (y - Y_BOW_WL) * math.tan(math.radians(60))
    return -4.3

def hw(y):
    """waterline half-breadth"""
    if y < -12.0: return 5.6 - 0.85 * ((-12.0 - y) / 8.0) ** 1.6
    if y <= 4.0: return 5.6
    if y >= Y_BOW_WL: return 0.0
    t = (y - 4.0) / (Y_BOW_WL - 4.0)
    return 5.6 * (1.0 - t ** 2.3) ** 0.55

def hd(y):
    """half-breadth at the sheer: full amidships, drawn to a point at the stem"""
    if y < -12.0: return 5.82 - 0.55 * ((-12.0 - y) / 8.0) ** 1.6
    if y <= 4.0: return 5.82
    t = min(1.0, (y - 4.0) / (Y_BOW_TOP - 4.0))
    return 5.82 * max(0.0, 1.0 - t ** 2.2) ** 0.62

def fullness(y):
    if y < -12.0: return 7.0 - 3.5 * ((-12.0 - y) / 8.0)
    if y <= 4.0: return 7.0
    return 7.0 - 5.4 * smoothstep(4.0, 17.0, y)

def half_breadth(y, z):
    """the hull's half-breadth at station y, height z (0 below the keel)"""
    zk, zt = keel(y), sheer(y)
    if z < zk: return 0.0
    w0, w1 = hw(y), hd(y)
    if z <= 0.0:
        if w0 <= 0: return 0.0
        u = (z - zk) / (0.0 - zk) if zk < 0 else 1.0
        return w0 * (1.0 - (1.0 - u) ** fullness(y))
    if w0 > 0:
        t = min(1.0, z / max(zt, 1e-3))
        return w0 + (w1 - w0) * t ** 0.8
    t = min(1.0, (z - zk) / max(zt - zk, 1e-3))
    return w1 * t ** 0.7

def section_z(y):
    zk, zt = keel(y), sheer(y)
    under = [zk + (-0.4 - zk) * f for f in (0, .025, .06, .11, .17, .25, .35, .48, .65, .82, 1.0)]
    mid = [-0.2, 0.0, 0.25, 0.5]
    over = [0.5 + (zt - 0.5) * g for g in (.12, .26, .42, .58, .72, .84, .93, 1.0)]
    return [max(z, zk) for z in under + mid + over]

def hull_maps():
    """plating: horizontal strakes every 1.8 m, butts every 5.4 m, frames every 0.6 m (the dents
    between them), a doubled ice belt round the waterline; as a normal map over u = y, v = z"""
    W, H = 2048, 512
    L, Hm = 44.0, 11.0
    y = np.linspace(-20.5, 23.5, W)[None, :]
    z = np.linspace(-4.5, 6.5, H)[:, None]
    h = np.zeros((H, W), np.float32)
    def ridge(d, w):  # a weld bead centred where d crosses a whole number
        f = np.abs(d - np.round(d))
        return np.exp(-(f / w) ** 2)
    strake = ridge((z + 0.4) / 1.8, 0.012 / 1.8 * 30)
    butt = ridge((y + 1.3) / 5.4, 0.012 / 5.4 * 30) * (np.round((z + 0.4) / 1.8) % 2 * 0 + 1)
    # butts are staggered strake to strake
    stag = np.where((np.floor((z + 0.4) / 1.8) % 2) == 0, ridge((y + 1.3) / 5.4, 0.035), ridge((y + 4.0) / 5.4, 0.035))
    frames = 0.5 - 0.5 * np.cos(2 * np.pi * (y / 0.6))          # dents between the frames
    belt = ((z > -1.2) & (z < 1.6)).astype(np.float32)
    h += strake * 1.0 + stag * 1.0
    h -= frames * 0.35 * (1.0 + belt * 0.3)
    h += ridge((z - 1.6) / 1.0, 0.02) * belt.max() * 1.2         # the ice belt's upper weld
    # plate unevenness: smooth low-frequency noise (bilinear from a coarse grid: no blocks)
    rng = np.random.default_rng(7)
    g = rng.standard_normal((H // 16 + 2, W // 16 + 2)).astype(np.float32)
    yi, xi = np.mgrid[0:H, 0:W] / 16.0
    y0, x0 = yi.astype(int), xi.astype(int); fy, fx = yi - y0, xi - x0
    noise = (g[y0, x0] * (1 - fx) + g[y0, x0 + 1] * fx) * (1 - fy) + (g[y0 + 1, x0] * (1 - fx) + g[y0 + 1, x0 + 1] * fx) * fy
    h += noise * 0.08
    gy, gx = np.gradient(h)
    k = 2.2
    n = np.dstack([-gx * k, -gy * k, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return C.image_tex('Hull_Normal', (n * 0.5 + 0.5).astype(np.float32), 'Non-Color')

def deck_maps():
    """non-slip deck plate: seams every 1.5 x 6 m, a fine grit; tiles every 3 m (u, v = x/3, y/3)"""
    S = 512
    u = np.linspace(0, 3, S, endpoint=False)
    X, Y = np.meshgrid(u, u)
    def seam(d, period, w):
        f = np.abs(d / period - np.round(d / period)) * period
        return np.exp(-(f / w) ** 2)
    h = -seam(X, 1.5, 0.008) * 1.2 - seam(Y, 3.0, 0.008) * 1.2
    rng = np.random.default_rng(11)
    grit = rng.random((S, S)).astype(np.float32)
    h += grit * 0.25
    gy, gx = np.gradient(h)
    n = np.dstack([-gx * 1.5, -gy * 1.5, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return C.image_tex('Deck_Normal', (n * 0.5 + 0.5).astype(np.float32), 'Non-Color')

def build_hull(M):
    ys = list(np.linspace(Y_STERN, -12, 6)) + list(np.linspace(-11, 4, 7)) + list(np.linspace(5, 19.0, 26)) + list(np.linspace(19.4, Y_BOW_TOP, 7))
    ys = sorted(set(round(v, 4) for v in ys))
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rows = []
    for y in ys:
        zs = section_z(y)
        rows.append([bm.verts.new((half_breadth(y, z) if i else 0.0, y, z)) for i, z in enumerate(zs)])
    nz = len(rows[0])
    def tag(f):
        zc = sum(v.co.z for v in f.verts) / len(f.verts)
        f.material_index = 0 if zc > 0.5 else (1 if zc > -0.4 else 2)
    for j in range(len(rows) - 1):
        for i in range(nz - 1):
            a, b, c, d = rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], rows[j][i + 1]
            try:
                f = bm.faces.new((a, d, c, b))
            except ValueError:
                continue
            tag(f)
    st = rows[0]
    tv = [bm.verts.new((0.0, Y_STERN, v.co.z)) for v in st]
    for i in range(nz - 1):
        try:
            f = bm.faces.new((st[i], st[i + 1], tv[i + 1], tv[i])); tag(f)
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)
    bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], axis='X', merge_dist=0.004)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # uv: along the hull and up it (the plating map is 44 x 11 m)
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[uvl].uv = ((co.y + 20.5) / 44.0, (co.z + 4.5) / 11.0)
    o = C.obj_from_bm(bm, 'HULL', None)
    nmap = hull_maps()
    hull_m = C.mat_textured('Hull_Blue', normal=nmap, rgb=(0.012, 0.085, 0.36), rough=0.42, normal_strength=0.8)
    boot_m = C.mat_textured('Hull_Boottop', normal=nmap, rgb=(0.018, 0.018, 0.02), rough=0.5, normal_strength=0.8)
    bot_m = C.mat_textured('Hull_Bottom', normal=nmap, rgb=(0.28, 0.018, 0.012), rough=0.65, normal_strength=0.8)
    M['hull'], M['boottop'], M['bottom'] = hull_m, boot_m, bot_m
    for m in (hull_m, boot_m, bot_m): o.data.materials.append(m)
    s = o.modifiers.new('plate', 'SOLIDIFY'); s.thickness = 0.08; s.offset = -1; s.material_offset = 3; s.use_even_offset = True
    for _ in range(3): o.data.materials.append(M['bulwark'])
    C.apply_modifiers(o)
    for p in o.data.polygons: p.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(38))
    return o

def deck_outline(z, y0, y1, inset=0.1, n=60):
    ys = np.linspace(y0, y1, n)
    stbd = [(max(0.0, half_breadth(y, z) - inset), y) for y in ys]
    port = [(-x, y) for x, y in reversed(stbd)]
    return stbd + port

# ---------------------------------------------------------------- materials
def materials():
    M = {}
    M['bulwark'] = C.mat('Paint_Bulwark', (0.55, 0.57, 0.56), 0.55)
    M['white'] = C.mat('Paint_White', (0.72, 0.74, 0.72), 0.42)
    M['red'] = C.mat('Paint_Red', (0.42, 0.012, 0.01), 0.45)
    M['deck'] = C.mat_textured('Deck_Paint', normal=deck_maps(), rgb=(0.045, 0.075, 0.06), rough=0.82, normal_strength=0.6)
    M['steel'] = C.mat('Steel', (0.45, 0.46, 0.47), 0.4, 1.0)
    M['dark'] = C.mat('Dark_Metal', (0.04, 0.045, 0.05), 0.55, 0.6)
    M['rubber'] = C.mat('Rubber', (0.012, 0.012, 0.012), 0.92)
    M['glass'] = C.mat('Glass', (0.02, 0.03, 0.035), 0.05, 0.0, alpha=0.3)
    M['wall'] = C.mat('Interior_Wall', (0.6, 0.56, 0.44), 0.7)
    M['ceiling'] = C.mat('Interior_Ceiling', (0.7, 0.68, 0.6), 0.8)
    M['floor'] = C.mat('Interior_Floor', (0.14, 0.06, 0.03), 0.6)
    M['wood'] = C.mat('Wood', (0.28, 0.13, 0.05), 0.55)
    M['engine'] = C.mat('Engine_Green', (0.05, 0.14, 0.09), 0.5, 0.3)
    M['grate'] = C.mat('Grating', (0.1, 0.1, 0.1), 0.6, 0.85)
    M['yellow'] = C.mat('Safety_Yellow', (0.65, 0.42, 0.01), 0.5)
    M['orange'] = C.mat('Orange', (0.85, 0.16, 0.01), 0.55)
    M['rope'] = C.mat('Rope', (0.42, 0.36, 0.22), 0.85)
    M['lamp'] = C.mat('Lamp_Warm', (1, 0.8, 0.55), 0.4, emit=(1.0, 0.72, 0.42), emit_strength=6.0)
    M['lampcold'] = C.mat('Lamp_Cold', (0.9, 0.95, 1), 0.4, emit=(0.85, 0.92, 1.0), emit_strength=8.0)
    M['lampengine'] = C.mat('Lamp_Engine', (0.9, 0.95, 1), 0.4, emit=(0.85, 0.92, 1.0), emit_strength=8.0)
    M['navred'] = C.mat('Lamp_NavRed', (1, 0.1, 0.05), 0.3, emit=(1.0, 0.05, 0.02), emit_strength=14.0)
    M['navgreen'] = C.mat('Lamp_NavGreen', (0.1, 1, 0.3), 0.3, emit=(0.05, 1.0, 0.25), emit_strength=14.0)
    M['navwhite'] = C.mat('Lamp_NavWhite', (1, 1, 1), 0.3, emit=(1.0, 0.95, 0.85), emit_strength=14.0)
    M['screen'] = C.mat('Screen_Radar', (0.0, 0.05, 0.02), 0.2, emit=(0.05, 0.6, 0.2), emit_strength=1.5)
    M['screen2'] = C.mat('Screen_Chart', (0.02, 0.04, 0.08), 0.2, emit=(0.1, 0.25, 0.5), emit_strength=0.8)
    M['enamel'] = C.mat('Enamel_Red', (0.5, 0.03, 0.02), 0.25)
    M['black'] = C.mat('Black_Paint', (0.02, 0.02, 0.022), 0.6)
    M['blue'] = C.mat('Paint_Blue', (0.012, 0.085, 0.36), 0.45)
    M['grey'] = C.mat('Paint_Grey', (0.3, 0.31, 0.32), 0.5)
    M['chrome'] = C.mat('Chrome', (0.8, 0.8, 0.82), 0.15, 1.0)
    M['brass'] = C.mat('Brass', (0.7, 0.5, 0.18), 0.3, 1.0)
    M['dial'] = C.mat('Dial_Face', (0.85, 0.84, 0.78), 0.35)
    M['col'] = C.mat('Collision', (1, 0, 1), 1.0)
    return M

# ---------------------------------------------------------------- building blocks
class Part:
    """one object assembled from boxes, tubes and prisms, faces tagged with materials"""
    def __init__(self, name, mats_list, coll=None):
        self.name = name; self.bm = bmesh.new(); self.mats = list(mats_list); self.coll = coll
    def mi(self, m):
        if m is None: return 0
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)
    def box(self, x0, y0, z0, x1, y1, z1, m, bevel=0.0):
        f = C.bm_box_minmax(self.bm, x0, y0, z0, x1, y1, z1, self.mi(m))
        if bevel: self.bevel(f, bevel, self.mi(m))
        return f
    def boxc(self, cx, cy, cz, sx, sy, sz, m, rz=0.0, bevel=0.0):
        f = C.bm_box(self.bm, cx, cy, cz, sx, sy, sz, self.mi(m), rz)
        if bevel: self.bevel(f, bevel, self.mi(m))
        return f
    def bevel(self, faces, w, mi=0, segs=1):
        edges = list({e for f in faces for e in f.edges})
        res = bmesh.ops.bevel(self.bm, geom=edges, offset=w, segments=segs, affect='EDGES', profile=0.5)
        for f in res.get('faces', []): f.material_index = mi
    def cyl(self, cx, cy, cz, r, depth, m, axis='Z', segs=16, r2=None, cap=True):
        return C.bm_cyl(self.bm, cx, cy, cz, r, depth, axis, segs, self.mi(m), r2, cap)
    def tube(self, pts, r, m, segs=8):
        return C.bm_tube(self.bm, [Vector(p) for p in pts], r, segs, self.mi(m))
    def prism(self, poly, z0, z1, m):
        return C.bm_prism(self.bm, poly, z0, z1, self.mi(m))
    def done(self, smooth=False, sharp=None):
        o = C.obj_from_bm(self.bm, self.name, None, self.coll, smooth)
        for m in self.mats: o.data.materials.append(m)
        if sharp is not None:
            for p in o.data.polygons: p.use_smooth = True
            o.data.set_sharp_from_angle(angle=math.radians(sharp))
        return o

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
        seg(s, s0, z0, z1); seg(s0, s1, z0, h0); seg(s0, s1, h1, z1)
        s = s1
    seg(s, L, z0, z1)

def frames(part, a, b, holes, m, t=T, d=0.05, w=0.07):
    """frames round the holes of a wall (window and door surrounds), proud of both faces"""
    ax, ay = a; bx, by = b
    L = math.hypot(bx - ax, by - ay); ux, uy = (bx - ax) / L, (by - ay) / L
    rz = math.atan2(uy, ux)
    for (c, wd, h0, h1) in holes:
        for (s, hh, sw, sh) in ((c - wd / 2 - w / 2, (h0 + h1) / 2, w, h1 - h0 + 2 * w), (c + wd / 2 + w / 2, (h0 + h1) / 2, w, h1 - h0 + 2 * w),
                                 (c, h1 + w / 2, wd, w), (c, h0 - w / 2, wd, w)):
            part.boxc(ax + ux * s, ay + uy * s, hh, sw, t + 2 * d, sh, m, rz)

def glass_pane(part, a, b, c, w, h0, h1, m, t=0.02):
    ax, ay = a; bx, by = b
    L = math.hypot(bx - ax, by - ay); ux, uy = (bx - ax) / L, (by - ay) / L
    part.boxc(ax + ux * c, ay + uy * c, (h0 + h1) / 2, w, t, h1 - h0, m, math.atan2(uy, ux))

def railing(part, pts, z, m, h=1.05, post=1.4, r=0.024):
    part.tube([(x, y, z + h) for x, y in pts], r, m, 8)
    part.tube([(x, y, z + h * 0.52) for x, y in pts], r * 0.75, m, 6)
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / post))
        for k in range(n + (1 if i == len(pts) - 2 else 0)):
            t = k / n
            part.cyl(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z + h / 2, r * 1.15, h, m, segs=6)

def rail_col(col, pts, z, h=1.1, t=0.12):
    for i in range(len(pts) - 1):
        wall(col, pts[i], pts[i + 1], z, z + h, None, t=t)

def stairs(part, x0, x1, ya, za, yb, zb, m, rail_m=None, along='y'):
    """a ship's stair from (a, za) to (b, zb): treads and stringers. along='y': it runs fore-aft at
    x0..x1; along='x': it runs athwartships (a, b are x; x0, x1 are its y extent)"""
    n = max(3, int(abs(zb - za) / 0.21))
    L = math.hypot(yb - ya, zb - za); ang = math.atan2(zb - za, yb - ya)
    for i in range(n):
        t = (i + 0.5) / n
        p = ya + (yb - ya) * t; z = za + (zb - za) * t
        if along == 'y':
            part.box(x0 + 0.05, p - 0.13, z - 0.035, x1 - 0.05, p + 0.13, z, m)
        else:
            part.box(p - 0.13, x0 + 0.05, z - 0.035, p + 0.13, x1 - 0.05, z, m)
    for side in (x0, x1):
        if along == 'y':
            f = part.boxc(side, (ya + yb) / 2, (za + zb) / 2 - 0.08, 0.05, L, 0.24, m)
            vs = list({v for fc in f for v in fc.verts})
            bmesh.ops.rotate(part.bm, verts=vs, cent=(side, (ya + yb) / 2, (za + zb) / 2 - 0.08), matrix=Matrix.Rotation(ang, 3, 'X'))
        else:
            f = part.boxc((ya + yb) / 2, side, (za + zb) / 2 - 0.08, L, 0.05, 0.24, m)
            vs = list({v for fc in f for v in fc.verts})
            bmesh.ops.rotate(part.bm, verts=vs, cent=((ya + yb) / 2, side, (za + zb) / 2 - 0.08), matrix=Matrix.Rotation(-ang, 3, 'Y'))
    if rail_m:
        for side in (x0, x1):
            if along == 'y': part.tube([(side, ya - 0.1, za + 0.95), (side, yb, zb + 0.95)], 0.025, rail_m, 8)
            else: part.tube([(ya - 0.1, side, za + 0.95), (yb, side, zb + 0.95)], 0.025, rail_m, 8)

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
    """a vertical steel ladder: two rails, rungs every 0.3 m (facing: the axis the climber faces)"""
    for d in (-w / 2, w / 2):
        if facing == 'y': part.box(x + d - 0.025, y - 0.03, z0, x + d + 0.025, y + 0.03, z1, m)
        else: part.box(x - 0.03, y + d - 0.025, z0, x + 0.03, y + d + 0.025, z1, m)
    for k in range(int((z1 - z0) / 0.3)):
        z = z0 + 0.3 * (k + 1)
        if facing == 'y': part.cyl(x, y, z, 0.016, w, m, axis='X', segs=6)
        else: part.cyl(x, y, z, 0.016, w, m, axis='Y', segs=6)

def name_text(text, size, font_path=None):
    """a text as a flat mesh (x: reading direction, y: up, faces +z), returned as (verts, faces)"""
    cu = bpy.data.curves.new('_txt', 'FONT')
    cu.body = text; cu.size = size; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    # (Blender's own built-in font: it has Cyrillic and a free licence)
    if font_path:
        try: cu.font = bpy.data.fonts.load(font_path, check_existing=True)
        except Exception: pass
    cu.extrude = 0.012
    ob = bpy.data.objects.new('_txt', cu); bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True); bpy.data.curves.remove(cu)
    verts = [v.co.copy() for v in me.vertices]; faces = [list(p.vertices) for p in me.polygons]
    bpy.data.meshes.remove(me)
    return verts, faces

def hull_text(part, text, size, y_c, z_c, side, m, stern=False):
    """the name laid onto the flared hull: each vertex pushed out to the hull's surface"""
    verts, faces = name_text(text, size)
    bm = part.bm; idx = part.mi(m)
    nv = []
    for v in verts:
        if stern:
            x = -v.x * side if False else v.x; z = z_c + v.y
            y = Y_STERN - 0.02 - (v.z + 0.012)
            nv.append(bm.verts.new((x, y, z)))
        else:
            y = y_c + v.x * side; z = z_c + v.y
            x = side * (half_breadth(y, z) + 0.006 + (v.z + 0.012))
            nv.append(bm.verts.new((x, y, z)))
    for f in faces:
        try:
            fc = bm.faces.new([nv[i] for i in f]); fc.material_index = idx
        except ValueError:
            pass

# ---------------------------------------------------------------- the build
def build(root):
    C.set_root(root)
    sc = C.fresh_scene('ASSET_tug')
    M = materials()
    made = {}
    hull = build_hull(M); made['hull'] = hull
    col = Part('COL_boat', [M['col']])

    # ================================================================ decks
    main = Part('DECKS', [M['deck']])
    sd = STAIR_DN
    polyA = deck_outline(DECK, Y_STERN + 0.12, sd['y0'], inset=0.09)
    polyB = deck_outline(DECK, sd['y1'], 8.62, inset=0.09)
    fpoly = deck_outline(FC, 8.5, 22.6, inset=0.09)
    wmid = half_breadth(sd['y1'], DECK) - 0.09
    for part, m in ((main, M['deck']), (col, M['col'])):
        part.prism(polyA, DECK - 0.25, DECK, m)
        part.prism(polyB, DECK - 0.25, DECK, m)
        part.box(-wmid, sd['y0'], DECK - 0.25, sd['x0'], sd['y1'], DECK, m)
        part.box(sd['x1'], sd['y0'], DECK - 0.25, wmid, sd['y1'], DECK, m)
        part.prism(fpoly, FC - 0.25, FC, m)
    wb = half_breadth(8.5, DECK + 1.2) - 0.05
    main.box(-wb, 8.5, DECK, wb, 8.62, FC - 0.25, M['white'])
    col.box(-wb, 8.5, DECK, wb, 8.62, FC, M['col'])
    # the bulwarks' inside (collision), 1.15 m above each deck
    for (z, y0_, y1_) in ((DECK, Y_STERN + 0.1, 8.6), (FC, 8.5, 22.6)):
        ys = np.linspace(y0_, y1_, 44)
        for s in (1, -1):
            for i in range(len(ys) - 1):
                xa = s * (half_breadth(ys[i], z) - 0.09); xb = s * (half_breadth(ys[i + 1], z) - 0.09)
                v = [col.bm.verts.new((xa, ys[i], z)), col.bm.verts.new((xb, ys[i + 1], z)),
                     col.bm.verts.new((xb, ys[i + 1], z + 1.15)), col.bm.verts.new((xa, ys[i], z + 1.15))]
                col.bm.faces.new(v)
    col.box(-5.4, Y_STERN - 0.05, DECK, 5.4, Y_STERN + 0.12, DECK + 1.15, M['col'])

    # the cap rail along the top of the bulwarks (red), the fender belt below the deck line, the
    # bulwark stays inside, freeing ports
    trim = Part('TRIM', [M['red']])
    ys = np.linspace(Y_STERN + 0.05, 22.85, 120)
    for s in (1, -1):
        pts = [(s * (half_breadth(y, sheer(y) - 0.02) - 0.03), y, sheer(y) + 0.04) for y in ys]
        trim.tube(pts, 0.07, M['red'], 8)
        # the rubber fender belt: a D-section along the hull at the deck line (amidships and aft)
        fys = np.linspace(-19.6, 14.0, 70)
        pts = [(s * (half_breadth(y, 2.15) + 0.1), y, 2.15) for y in fys]
        trim.tube(pts, 0.17, M['rubber'], 10)
    trim.tube([(-5.0, Y_STERN - 0.02, sheer(Y_STERN) + 0.04), (5.0, Y_STERN - 0.02, sheer(Y_STERN) + 0.04)], 0.07, M['red'], 8)
    # the transom's fender: a big rubber cylinder across the stern, and the bow's: blocks down the stem
    trim.cyl(0, Y_STERN - 0.45, 2.0, 0.45, 8.6, M['rubber'], axis='X', segs=20)
    # bulwark stays (inside, every 1.5 m along the aft deck and the forecastle)
    for s in (1, -1):
        for y in list(np.arange(-19.0, -7.5, 1.5)) + list(np.arange(10.5, 19.0, 1.5)):
            z = DECK if y < 8 else FC
            x = s * (half_breadth(y, z + 0.5) - 0.1)
            trim.boxc(x - s * 0.18, y, z + 0.5, 0.36, 0.03, 0.9, M['bulwark'])
    # freeing ports: dark slots at the foot of the aft bulwarks
    for s in (1, -1):
        for y in (-17.5, -14.5, -11.5):
            x = s * (half_breadth(y, DECK + 0.15) + 0.01)
            trim.boxc(x, y, DECK + 0.18, 0.1, 1.1, 0.3, M['black'])
    # the name, both bows, and the stern with the port of registry
    for s in (1, -1):
        hull_text(trim, 'ПОЛЯРНИК', 0.85, 15.6, 4.25, s, M['white'])
    hull_text(trim, 'ПОЛЯРНИК', 0.6, 0, 1.65, 1, M['white'], stern=True)
    hull_text(trim, 'МУРМАНСК', 0.42, 0, 0.95, 1, M['white'], stern=True)
    # draught marks at the bow and stern (white numerals up the stem and sternpost)
    for s in (1, -1):
        for zz, lab in ((0.6, '2'), (1.2, '4'), (-0.6, '0')):
            pass
    # hawse pipes and anchors in their pockets (both bows)
    for s in (1, -1):
        y = 17.6; z = 3.4; x = s * (half_breadth(y, z) + 0.02)
        xp = s * (half_breadth(y, z - 0.7) + 0.005)
        trim.boxc(xp - s * 0.04, y, z - 0.75, 0.1, 1.5, 1.7, M['black'])                      # the pocket
        trim.cyl(x + s * 0.02, y, z + 0.1, 0.24, 0.08, M['dark'], axis='X', segs=16)             # the hawse lip
        trim.boxc(xp + s * 0.06, y, z - 0.35, 0.12, 0.16, 0.9, M['black'], bevel=0.02)            # shank
        crown = trim.boxc(xp + s * 0.09, y, z - 0.88, 0.2, 1.05, 0.22, M['black'], bevel=0.03)    # crown
        for d in (-1, 1):                                                                          # flukes
            trim.boxc(xp + s * 0.1, y + d * 0.42, z - 0.62, 0.16, 0.22, 0.42, M['black'], bevel=0.02)

    # ================================================================ level 1 (main deck)
    x, y0, y1 = DH['x'], DH['y0'], DH['y1']
    dh = Part('DECKHOUSE', [M['white']])
    inner = Part('INTERIOR', [M['wall'], M['floor'], M['ceiling']])
    win1 = (DECK + 1.15, DECK + 1.85)
    aft_holes = [(x, 0.9, DECK, DECK + DOOR_H), (x - 2.6, 0.8, *win1), (x + 2.6, 0.8, *win1)]
    side_holes = [(0.1 - y0, 0.9, DECK, DECK + DOOR_H), (-5.3 - y0, 0.8, *win1), (-2.7 - y0, 0.8, *win1)]
    wall(dh, (-x, y0), (x, y0), DECK, L01 - 0.25, M['white'], holes=aft_holes)
    frames(dh, (-x, y0), (x, y0), aft_holes, M['white'])
    for s in (1, -1):
        wall(dh, (s * x, y0), (s * x, y1), DECK, L01 - 0.25, M['white'], holes=side_holes)
        frames(dh, (s * x, y0), (s * x, y1), side_holes, M['white'])
    gl = Part('GLASS', [M['glass']])
    for c, w, h0, h1 in aft_holes[1:]: glass_pane(gl, (-x, y0), (x, y0), c, w, h0, h1, M['glass'])
    for s in (1, -1):
        for c, w, h0, h1 in side_holes[1:]: glass_pane(gl, (s * x, y0), (s * x, y1), c, w, h0, h1, M['glass'])
    # inside: bulkheads, the ceiling, the floors (with the hole for the stair down)
    wall(inner, (-x + T, MESS[1]), (x - T, MESS[1]), DECK, L01 - 0.25, M['wall'], holes=[(x - T, 0.9, DECK, DECK + DOOR_H)])
    wall(inner, (-x + T, CABIN[0]), (x - T, CABIN[0]), DECK, L01 - 0.25, M['wall'], holes=[(x - T - 1.2, 0.8, DECK, DECK + DOOR_H)])
    # (the interior lining of the outer walls, so the rooms aren't white paint inside)
    for s in (1, -1):
        wall(inner, (s * (x - T * 0.5 - 0.01), y0 + 0.08), (s * (x - T * 0.5 - 0.01), y1), DECK + 0.02, L01 - 0.3, M['wall'], holes=side_holes, t=0.02)
    wall(inner, (-x + 0.08, y0 + T * 0.5 + 0.01), (x - 0.08, y0 + T * 0.5 + 0.01), DECK + 0.02, L01 - 0.3, M['wall'], holes=[(c - 0.08, w, h0, h1) for c, w, h0, h1 in aft_holes], t=0.02)
    f1 = FLIGHT1
    for (a0, b0, a1, b1) in ((-x + T, y0 + T, x - T, f1['y0']), (-x + T, f1['y0'], f1['x0'], y1), (f1['x1'], f1['y0'], x - T, y1), (f1['x0'], f1['y1'], f1['x1'], y1)):
        inner.box(a0, b0, L01 - 0.3, a1, b1, L01 - 0.25, M['ceiling'])
    inner.box(-x + T, MESS[0] + T, DECK, x - T, MESS[1], DECK + 0.02, M['floor'])
    inner.box(-x + T, HALL[0], DECK, sd['x0'], HALL[1], DECK + 0.02, M['floor'])
    inner.box(sd['x0'], HALL[0], DECK, x - T, sd['y0'], DECK + 0.02, M['floor'])
    inner.box(sd['x1'], sd['y0'], DECK, x - T, HALL[1], DECK + 0.02, M['floor'])
    for (a, b, holes) in (((-x, y0), (x, y0), [(x, 0.9)]),
                          ((x, y0), (x, y1), [(0.1 - y0, 0.9)]), ((-x, y0), (-x, y1), [(0.1 - y0, 0.9)]),
                          ((-x + T, MESS[1]), (x - T, MESS[1]), [(x - T, 0.9)]),
                          ((-x + T, CABIN[0]), (x - T, CABIN[0]), [])):
        wall(col, a, b, DECK, L01, M['col'], holes=[(c, w, DECK - 1, DECK + 2.1) for c, w in holes], t=0.2)

    # ================================================================ the 01 deck, level 2
    top = Part('DECK01', [M['deck']])
    def slab(parts, x0_, y0_, x1_, y1_, z, th=0.25):
        for p_, m_ in parts: p_.box(x0_, y0_, z - th, x1_, y1_, z, m_)
    both = ((top, M['deck']), (col, M['col']))
    # (round flight 1's opening; the 01 deck runs out over the walkways to x 5.0)
    slab(both, -OVER, y0, OVER, f1['y0'], L01)
    slab(both, -OVER, f1['y0'], f1['x0'], y1, L01)
    slab(both, f1['x1'], f1['y0'], OVER, y1, L01)
    slab(both, f1['x0'], f1['y1'], f1['x1'], y1, L01)
    # the landings at the top of the aft stairs
    a = AFT_STAIR
    for s in (1, -1):
        xa, xb = sorted((s * a['x1'], s * OVER))
        slab(both, xa, a['y0'] - 0.1, xb, y0, L01)
    # under the overhang: brackets along the deckhouse sides
    for s in (1, -1):
        for yy in np.arange(y0 + 0.5, y1, 2.0):
            dh.boxc(s * (x + 0.35), yy, L01 - 0.45, 0.7, 0.05, 0.4, M['white'])
    # level 2: walls, windows, the lobby door (port), the closed cabins
    l2x, l2y0, l2y1 = L2['x'], L2['y0'], L2['y1']
    win2 = (L01 + 1.1, L01 + 1.8)
    l2 = Part('LEVEL2', [M['white']])
    s_holes = {1: [(-0.5 - l2y0, 0.8, *win2), (3.0 - l2y0, 0.8, *win2), (6.5 - l2y0, 0.8, *win2)],
               -1: [(5.1 - l2y0, 0.9, L01, L01 + DOOR_H), (-0.5 - l2y0, 0.8, *win2), (2.6 - l2y0, 0.8, *win2), (7.0 - l2y0, 0.8, *win2)]}
    for s in (1, -1):
        wall(l2, (s * l2x, l2y0), (s * l2x, l2y1), L01, L02 - 0.25, M['white'], holes=s_holes[s])
        frames(l2, (s * l2x, l2y0), (s * l2x, l2y1), s_holes[s], M['white'])
        for c, w, h0, h1 in s_holes[s]:
            if h0 > L01: glass_pane(gl, (s * l2x, l2y0), (s * l2x, l2y1), c, w, h0, h1, M['glass'])
    fa_holes = [(l2x - 2.0, 0.8, *win2), (l2x + 2.0, 0.8, *win2)]
    wall(l2, (-l2x, l2y0), (l2x, l2y0), L01, L02 - 0.25, M['white'], holes=fa_holes)
    frames(l2, (-l2x, l2y0), (l2x, l2y0), fa_holes, M['white'])
    ff_holes = [(l2x - 1.6, 0.8, *win2), (l2x + 1.6, 0.8, *win2)]
    wall(l2, (-l2x, l2y1), (l2x, l2y1), L01, L02 - 0.25, M['white'], holes=ff_holes)
    frames(l2, (-l2x, l2y1), (l2x, l2y1), ff_holes, M['white'])
    for c, w, h0, h1 in fa_holes: glass_pane(gl, (-l2x, l2y0), (l2x, l2y0), c, w, h0, h1, M['glass'])
    for c, w, h0, h1 in ff_holes: glass_pane(gl, (-l2x, l2y1), (l2x, l2y1), c, w, h0, h1, M['glass'])
    # (the closed cabins' windows show a curtain behind the glass)
    curt = Part('CURTAINS', [C.mat('Curtain', (0.45, 0.32, 0.18), 0.9)])
    for s in (1, -1):
        for c, w, h0, h1 in s_holes[s]:
            if h0 > L01:
                yy = l2y0 + c
                if s < 0 and LOBBY['y0'] < yy < LOBBY['y1']: continue
                curt.box(s * (l2x - 0.12), yy - w / 2, h0, s * (l2x - 0.1), yy + w / 2, h1, curt.mats[0])
    for c, w, h0, h1 in fa_holes + ff_holes:
        yy = l2y0 + 0.12 if (c, w, h0, h1) in fa_holes else l2y1 - 0.12
        curt.box(-l2x + c - w / 2, yy - 0.01, h0, -l2x + c + w / 2, yy + 0.01, h1, curt.mats[0])
    # the lobby: its walls, floor lining, ceiling
    lb = LOBBY
    wall(inner, (lb['x1'], lb['y0']), (lb['x1'], lb['y1']), L01, L02 - 0.25, M['wall'])
    wall(inner, (lb['x0'], lb['y0']), (lb['x1'], lb['y0']), L01, L02 - 0.25, M['wall'])
    wall(inner, (lb['x0'], lb['y1']), (lb['x1'], lb['y1']), L01, L02 - 0.25, M['wall'])
    f2 = FLIGHT2
    inner.box(lb['x0'], f2['y0'], L01, lb['x1'], lb['y1'], L01 + 0.02, M['floor'])
    inner.box(lb['x0'], lb['y0'], L01, f1['x0'], f2['y0'], L01 + 0.02, M['floor'])
    inner.box(f1['x1'], lb['y0'], L01, lb['x1'], f2['y0'], L01 + 0.02, M['floor'])
    for s in (1, -1):
        wall(col, (s * l2x, l2y0), (s * l2x, l2y1), L01, L02, None, holes=[(5.1 - l2y0, 0.9, L01 - 1, L01 + 2.1)] if s < 0 else [], t=0.2)
    wall(col, (-l2x, l2y0), (l2x, l2y0), L01, L02, None, t=0.2)
    wall(col, (-l2x, l2y1), (l2x, l2y1), L01, L02, None, t=0.2)
    wall(col, (lb['x1'], lb['y0']), (lb['x1'], lb['y1']), L01, L02, None, t=0.15)
    wall(col, (lb['x0'], lb['y0']), (lb['x1'], lb['y0']), L01, L02, None, t=0.15)
    wall(col, (lb['x0'], lb['y1']), (lb['x1'], lb['y1']), L01, L02, None, t=0.15)
    # the 02 deck (level 2's roof): round flight 2's opening
    top2 = Part('DECK02', [M['deck']])
    both2 = ((top2, M['deck']), (col, M['col']))
    bxx = BR['x']
    slab(both2, -bxx, l2y0 - 0.1, bxx, f2['y1'], L02)
    slab(both2, -bxx, f2['y1'], f2['x0'], BR['y1'] + 0.3, L02)
    slab(both2, f2['x1'], f2['y1'], bxx, BR['y1'] + 0.3, L02)
    slab(both2, f2['x0'], f2['y0'], f2['x1'], BR['y1'] + 0.3, L02)
    inner.box(lb['x0'], lb['y0'], L02 - 0.3, f2['x0'], lb['y1'], L02 - 0.25, M['ceiling'])
    inner.box(f2['x1'], lb['y0'], L02 - 0.3, lb['x1'], lb['y1'], L02 - 0.25, M['ceiling'])
    inner.box(f2['x0'], f2['y0'], L02 - 0.3, f2['x1'], lb['y1'], L02 - 0.25, M['ceiling'])

    # ================================================================ stairs
    st = Part('STAIRS', [M['steel']])
    stairs(st, f1['x0'], f1['x1'], f1['y0'], DECK, f1['y1'], L01, M['steel'], M['yellow'])
    ramp(col, f1['x0'], f1['x1'], f1['y0'] - 0.12, DECK, f1['y1'] + 0.06, L01)
    stairs(st, f2['x0'], f2['x1'], f2['y0'], L01, f2['y1'], L02, M['steel'], M['yellow'])
    ramp(col, f2['x0'], f2['x1'], f2['y0'] + 0.12, L01, f2['y1'] - 0.06, L02)
    stairs(st, sd['x0'], sd['x1'], sd['y0'], DECK, sd['y1'], ER, M['steel'], M['yellow'])
    ramp(col, sd['x0'], sd['x1'], sd['y0'] - 0.06, DECK, sd['y1'] + 0.12, ER)
    for s in (1, -1):
        xa, xb = s * a['x0'], s * a['x1']
        stairs(st, a['y0'], a['y1'], xa, DECK, xb, L01, M['steel'], M['yellow'], along='x')
        ramp(col, a['y0'], a['y1'], xa - s * 0.12, DECK, xb + s * 0.06, L01, along='x')

    # ================================================================ engine room
    er = Part('ENGINE_ROOM', [M['wall'], M['grate'], M['engine']])
    ex, ey0, ey1 = ERM['x'], ERM['y0'], ERM['y1']
    er.box(-ex, ey0, ER - 0.1, ex, ey1, ER, M['grate'])
    for s in (1, -1):
        er.box(s * ex, ey0, ER, s * (ex + 0.1), ey1, DECK - 0.25, M['wall'])
    er.box(-ex, ey0 - 0.1, ER, ex, ey0, DECK - 0.25, M['wall'])
    er.box(-ex, ey1, ER, ex, ey1 + 0.1, DECK - 0.25, M['wall'])
    er.box(-ex, ey0, DECK - 0.3, ex, ey1, DECK - 0.25, M['ceiling'])
    col.box(-ex - 0.1, ey0, ER - 0.2, ex + 0.1, ey1, ER, M['col'])
    for s in (1, -1):
        col.box(s * ex, ey0, ER, s * (ex + 0.2), ey1, DECK, M['col'])
    col.box(-ex, ey0 - 0.2, ER, ex, ey0, DECK, M['col'])
    col.box(-ex, ey1, ER, ex, ey1 + 0.2, DECK, M['col'])
    eng = Part('ENGINES', [M['engine']])
    for s in (1, -1):
        cx = s * 2.2
        eng.box(cx - 0.95, -9.5, ER, cx + 0.95, -2.5, ER + 0.35, M['dark'])          # bedplate
        eng.box(cx - 0.8, -9.3, ER + 0.35, cx + 0.8, -2.7, ER + 1.55, M['engine'], bevel=0.05)  # crankcase
        # cylinder block, then six heads with rocker covers
        eng.box(cx - 0.62, -9.0, ER + 1.55, cx + 0.62, -3.0, ER + 2.15, M['engine'], bevel=0.04)
        for k in range(6):
            yy = -8.5 + k * 1.0
            eng.box(cx - 0.5, yy - 0.42, ER + 2.15, cx + 0.5, yy + 0.42, ER + 2.4, M['engine'], bevel=0.03)
            eng.box(cx - 0.36, yy - 0.34, ER + 2.4, cx + 0.36, yy + 0.34, ER + 2.55, M['grey'], bevel=0.04)
        # turbocharger at the aft end, exhaust up to the deckhead and away to the funnel
        eng.cyl(cx, -9.6, ER + 2.1, 0.35, 0.6, M['grey'], axis='Y', segs=16)
        eng.tube([(cx, -9.9, ER + 2.1), (cx, -10.3, ER + 2.3), (cx * 0.5, -10.4, DECK - 0.6), (cx * 0.25, -10.4, DECK - 0.3)], 0.22, M['grey'], 12)
        # the exhaust manifold along the outboard side
        eng.tube([(cx + s * 0.75, -8.7, ER + 1.9), (cx + s * 0.75, -3.3, ER + 1.9)], 0.12, M['grey'], 10)
        eng.cyl(cx, -2.2, ER + 0.9, 0.55, 0.3, M['dark'], axis='Y', segs=20)        # flywheel housing
        col.box(cx - 0.95, -10.0, ER, cx + 0.95, -2.0, ER + 2.55, M['col'])
    # floor plates' edges, handrails along the engines, pipes along the walls
    for s in (1, -1):
        for zz in (0.3, 0.9, 1.6):
            er.tube([(s * (ex - 0.15), ey0 + 0.3, ER + zz), (s * (ex - 0.15), ey1 - 0.3, ER + zz)], 0.05 + 0.02 * (zz == 0.9), M['grey'] if zz != 0.9 else M['red'], 8)
        er.tube([(s * 1.1, -9.3, ER + 1.0), (s * 1.1, -2.7, ER + 1.0)], 0.022, M['yellow'], 6)
        for yy in (-9.3, -6.0, -2.7):
            er.cyl(s * 1.1, yy, ER + 0.5, 0.02, 1.0, M['yellow'], segs=6)
    er.tube([(-3.8, ey0 + 0.5, DECK - 0.55), (-3.8, ey1 - 0.5, DECK - 0.55)], 0.09, M['grey'], 10)
    er.tube([(3.8, ey0 + 0.5, DECK - 0.5), (3.8, ey1 - 0.5, DECK - 0.5)], 0.07, M['blue'], 10)
    # the control console and its panel (forward, port of the stair), the switchboard
    er.box(-3.6, 6.4, ER, 0.6, 7.2, ER + 1.0, M['engine'], bevel=0.03)
    er.box(-3.6, 7.2, ER, 0.6, 7.35, ER + 2.15, M['engine'])
    col.box(-3.6, 6.4, ER, 0.6, 7.35, ER + 2.15, M['col'])
    er.box(-ex + 0.12, -0.5, ER, -ex + 0.6, 4.5, ER + 2.1, M['grey'], bevel=0.02)   # switchboard cabinets
    col.box(-ex, -0.5, ER, -ex + 0.6, 4.5, ER + 2.1, M['col'])
    for k in range(5):
        er.box(-ex + 0.58, -0.4 + k, ER + 0.2, -ex + 0.62, 0.5 + k, ER + 1.9, M['dark'])
    # a workbench aft, oil drums
    er.box(1.5, ey0 + 0.15, ER, 4.2, ey0 + 0.85, ER + 0.9, M['wood'])
    col.box(1.5, ey0, ER, 4.2, ey0 + 0.85, ER + 0.9, M['col'])
    for k in range(3):
        er.cyl(-3.6 + k * 0.62, ey0 + 0.45, ER + 0.45, 0.29, 0.9, M['blue'] if k != 1 else M['red'], segs=16)
    col.box(-3.95, ey0, ER, -1.95, ey0 + 0.8, ER + 0.9, M['col'])

    # ================================================================ the bridge
    bx, by0, by1 = BR['x'], BR['y0'], BR['y1']
    brw = Part('BRIDGE', [M['white']])
    win = (L02 + 1.05, BRC - 0.25)
    rake = math.tan(math.radians(14))
    # the front: raked forward at the top, five windows (two with clear-view screens)
    front = Part('BRIDGE_FRONT', [M['white']])
    fglass = Part('GLASS_FRONT', [M['glass']])
    fh = [(0.62 + i * 1.74, 1.42, *win) for i in range(5)]
    wall(front, (-bx, by1), (bx, by1), L02, BRC + 0.15, M['white'], holes=fh)
    frames(front, (-bx, by1), (bx, by1), fh, M['black'], d=0.03, w=0.05)
    for c, w, h0, h1 in fh: glass_pane(fglass, (-bx, by1), (bx, by1), c, w, h0, h1, M['glass'])
    for c in (fh[1][0], fh[3][0]):
        fglass.cyl(-bx + c, by1 + 0.02, (win[0] + win[1]) / 2 + 0.05, 0.3, 0.03, M['dark'], axis='Y', segs=24)
        fglass.cyl(-bx + c, by1 + 0.04, (win[0] + win[1]) / 2 + 0.05, 0.05, 0.05, M['steel'], axis='Y', segs=10)
    for p in (front, fglass):
        for v in p.bm.verts:
            v.co.y += (v.co.z - L02) * rake
    # sides: windows and the wing doors; aft: the door and two windows
    side_h = [(5.3 - by0, 0.9, L02, L02 + DOOR_H), (1.6 - by0, 1.2, *win), (3.2 - by0, 1.2, *win), (6.9 - by0, 1.1, *win)]
    for s in (1, -1):
        wall(brw, (s * bx, by0), (s * bx, by1), L02, BRC + 0.15, M['white'], holes=side_h)
        frames(brw, (s * bx, by0), (s * bx, by1), side_h[1:], M['black'], d=0.03, w=0.05)
        for c, w, h0, h1 in side_h[1:]: glass_pane(gl, (s * bx, by0), (s * bx, by1), c, w, h0, h1, M['glass'])
    aft_h = [(bx + 1.6, 0.9, L02, L02 + DOOR_H), (bx - 2.6, 1.0, *win), (bx + 3.1, 0.8, *win)]
    wall(brw, (-bx, by0), (bx, by0), L02, BRC + 0.15, M['white'], holes=aft_h)
    frames(brw, (-bx, by0), (bx, by0), aft_h[1:], M['black'], d=0.03, w=0.05)
    for c, w, h0, h1 in aft_h[1:]: glass_pane(gl, (-bx, by0), (bx, by0), c, w, h0, h1, M['glass'])
    # roof (overhanging the raked front), the ceiling inside, the floor (round flight 2's hole)
    brw.box(-bx - 0.18, by0 - 0.05, BRC + 0.15, bx + 0.18, by1 + (BRC + 0.15 - L02) * rake + 0.35, ROOF, M['white'])
    inner.box(-bx + T, by0 + T, BRC - 0.02, bx - T, by1 + 0.2, BRC + 0.15, M['ceiling'])
    for (a0, b0, a1, b1) in ((-bx + T, by0 + T, bx - T, f2['y1']), (-bx + T, f2['y1'], f2['x0'], by1), (f2['x1'], f2['y1'], bx - T, by1), (f2['x0'], f2['y0'], f2['x1'], by1)):
        inner.box(a0, b0, L02, a1, b1, L02 + 0.02, M['floor'])
    for (a_, b_, holes) in (((bx, by0), (bx, by1), [(5.3 - by0, 0.9)]), ((-bx, by0), (-bx, by1), [(5.3 - by0, 0.9)]),
                            ((-bx, by0), (bx, by0), [(bx + 1.6, 0.9)])):
        wall(col, a_, b_, L02, BRC, None, holes=[(c, w, L02 - 1, L02 + 2.1) for c, w in holes], t=0.2)
    col.box(-bx, by1 - 0.1, L02, bx, by1 + 0.6, BRC, M['col'])
    col.box(-bx - 0.18, by0 - 0.05, BRC + 0.15, bx + 0.18, by1 + 1.0, ROOF, M['col'])
    # wings with railings (a gap aft where the ladder from the 01 deck arrives), a small searchlight each
    rail = Part('RAILINGS', [M['white']])
    for s in (1, -1):
        xa, xb = sorted((s * WING['x0'], s * WING['x1']))
        slab(both2, xa, WING['y0'], xb, WING['y1'], L02, th=0.2)
        xo = s * WING['x1']
        railing(rail, [(xo, WING['y0']), (xo, WING['y1']), (s * WING['x0'], WING['y1'])], L02, M['white'])
        railing(rail, [(s * 4.98, WING['y0']), (xo, WING['y0'])], L02, M['white'])
        rail_col(col, [(xo, WING['y0']), (xo, WING['y1']), (s * WING['x0'], WING['y1'])], L02)
        rail_col(col, [(s * 4.98, WING['y0']), (xo, WING['y0'])], L02)
        # wing brackets underneath
        for yy in (WING['y0'] + 0.3, WING['y1'] - 0.3):
            brw.boxc(s * (WING['x0'] + 0.9), yy, L02 - 0.45, 1.6, 0.06, 0.5, M['white'])
    # the 01 deck's railings: round the boat deck, along the ledges, round the landings
    for s in (1, -1):
        side = [(s * (OVER - 0.05), 8.4), (s * (OVER - 0.05), a['y0'] - 0.1), (s * a['x1'], a['y0'] - 0.1)]
        railing(rail, side, L01, M['white']); rail_col(col, side, L01)
    # the boat deck's aft edge between the landings
    railing(rail, [(-a['x1'], y0 + 0.05), (a['x1'], y0 + 0.05)], L01, M['white'])
    rail_col(col, [(-a['x1'], y0 + 0.05), (a['x1'], y0 + 0.05)], L01)
    # the 02 deck aft of the bridge, and the bridge roof (gaps where ladders arrive)
    rail02 = [(-bx + 0.05, by0), (-bx + 0.05, l2y0 - 0.05), (1.55, l2y0 - 0.05)]
    rail02b = [(2.45, l2y0 - 0.05), (bx - 0.05, l2y0 - 0.05), (bx - 0.05, by0)]
    for r_ in (rail02, rail02b):
        railing(rail, r_, L02, M['white']); rail_col(col, r_, L02)
    roof_rail = [(-2.2, by0 - 0.1), (-bx, by0 - 0.1), (-bx, by1), (bx, by1), (bx, by0 - 0.1), (-1.5, by0 - 0.1)]
    railing(rail, roof_rail, ROOF, M['white']); rail_col(col, roof_rail, ROOF)
    # round the stairs' openings
    o = FLIGHT2
    r2 = [(o['x0'], o['y1'] + 0.05), (o['x0'], o['y0']), (o['x1'], o['y0']), (o['x1'], o['y1'] + 0.05)]
    railing(rail, r2, L02, M['white'], h=0.95); rail_col(col, r2, L02, h=1.0, t=0.08)
    o = sd
    r3 = [(o['x1'], o['y0']), (o['x1'], o['y1']), (o['x0'], o['y1']), (o['x0'], o['y0'])]
    railing(rail, r3, DECK, M['yellow'], h=0.95); rail_col(col, r3, DECK, h=1.0, t=0.08)
    o = f1
    r4 = [(o['x0'], o['y1']), (o['x0'], o['y0']), (o['x1'], o['y0']), (o['x1'], o['y1'])]
    railing(rail, r4, L01, M['white'], h=0.95); rail_col(col, r4, L01, h=1.0, t=0.08)

    # ================================================================ bridge furniture
    cons = Part('CONSOLE', [M['dark']])
    cy0, cy1 = 7.45, 8.25
    cons.box(-3.5, cy0, L02, 3.5, cy1, L02 + 0.85, M['dark'], bevel=0.02)
    # the console's sloped top
    f_ = cons.box(-3.5, cy0, L02 + 0.85, 3.5, cy1, L02 + 1.08, M['dark'])
    for v in {v for fc in f_ for v in fc.verts}:
        if v.co.z > L02 + 1.0 and v.co.y < cy0 + 0.1: v.co.z = L02 + 0.9
    col.box(-3.5, cy0, L02, 3.5, cy1, L02 + 1.08, M['col'])
    cons.box(-1.85, 7.95, L02 + 1.0, -0.95, 8.2, L02 + 1.75, M['dark'], bevel=0.02)    # radar hood
    cons.box(1.6, 7.95, L02 + 1.0, 2.9, 8.2, L02 + 1.55, M['dark'], bevel=0.02)       # chart display
    cons.box(1.7, 7.92, L02 + 1.1, 2.8, 7.95, L02 + 1.47, M['screen2'])
    cons.box(-3.3, 7.6, L02 + 1.0, -2.0, 8.0, L02 + 1.05, M['grey'])                   # VHF shelf
    for k in range(12):                                                                  # switches and lamps along the top
        cons.box(-3.2 + k * 0.55, 7.8, L02 + 0.95, -3.05 + k * 0.55, 7.95, L02 + 1.0, M['navgreen'] if k % 3 == 0 else M['black'])
    # the helm: a spoked wheel on a pedestal (the wheel is INT_wheel_helm)
    ped = Part('HELM', [M['dark']])
    ped.box(-0.2, 6.85, L02, 0.2, 7.2, L02 + 1.0, M['dark'], bevel=0.03)
    ped.cyl(0, 7.05, L02 + 1.25, 0.16, 0.12, M['brass'], segs=20)                       # the compass bowl on top
    col.box(-0.22, 6.85, L02, 0.22, 7.2, L02 + 1.0, M['col'])
    # the chart table, the captain's chair
    cons.box(2.4, 1.0, L02, 4.0, 2.3, L02 + 0.95, M['wood'], bevel=0.02)
    cons.box(2.5, 1.1, L02 + 0.95, 3.9, 2.2, L02 + 0.96, C.mat('Chart_Paper', (0.75, 0.72, 0.6), 0.9))
    col.box(2.4, 1.0, L02, 4.0, 2.3, L02 + 0.95, M['col'])
    cons.cyl(-1.6, 6.3, L02 + 0.3, 0.06, 0.6, M['chrome'], segs=10)
    cons.box(-1.9, 6.0, L02 + 0.6, -1.3, 6.6, L02 + 0.72, M['black'], bevel=0.04)
    cons.box(-1.9, 5.95, L02 + 0.72, -1.3, 6.05, L02 + 1.3, M['black'], bevel=0.04)
    col.box(-1.95, 5.95, L02, -1.25, 6.65, L02 + 1.3, M['col'])

    # ================================================================ mess, hall
    mess = Part('MESS', [M['wood']])
    mess.box(-0.55, -5.8, DECK + 0.72, 0.55, -1.8, DECK + 0.78, M['wood'], bevel=0.015)
    mess.box(-0.08, -5.4, DECK, 0.08, -2.2, DECK + 0.72, M['dark'])
    mess.box(-0.4, -5.6, DECK, 0.4, -5.4, DECK + 0.05, M['dark'])
    mess.box(-0.4, -2.2, DECK, 0.4, -2.0, DECK + 0.05, M['dark'])
    mess.box(-0.56, -5.81, DECK + 0.779, 0.56, -1.79, DECK + 0.781, C.mat('Oilcloth', (0.55, 0.1, 0.08), 0.35))
    for s in (1, -1):
        mess.box(s * 0.85, -5.8, DECK + 0.42, s * 1.25, -1.8, DECK + 0.47, M['wood'], bevel=0.01)
        mess.box(s * 1.2, -5.8, DECK + 0.47, s * 1.25, -1.8, DECK + 0.95, M['wood'])
        for yy in (-5.6, -2.0): mess.box(s * 0.9, yy - 0.04, DECK, s * 1.2, yy + 0.04, DECK + 0.42, M['dark'])
    # the galley along the port side: counter, stove with its rail, sink, cupboards over
    mess.box(-4.17, -6.85, DECK, -3.5, -2.6, DECK + 0.88, M['wood'])
    mess.box(-4.18, -6.86, DECK + 0.88, -3.48, -2.59, DECK + 0.92, M['steel'])
    mess.box(-4.15, -4.9, DECK + 0.92, -3.55, -3.6, DECK + 0.94, M['black'])           # the stove top
    for yy in (-4.6, -3.9):
        for xx in (-3.98, -3.72): mess.cyl(xx, yy, DECK + 0.945, 0.1, 0.01, M['dark'], segs=14)
    mess.tube([(-3.48, -4.95, DECK + 0.98), (-3.48, -3.55, DECK + 0.98)], 0.012, M['chrome'], 6)
    mess.box(-4.1, -6.2, DECK + 0.8, -3.6, -5.5, DECK + 0.92, M['chrome'])              # sink
    mess.box(-4.17, -6.85, DECK + 1.5, -3.75, -2.6, DECK + 2.2, M['wood'])              # cupboards
    mess.box(4.17 - 0.5, -6.85, DECK, 4.17, -6.0, DECK + 1.8, M['white'])                # fridge
    # the radio shelf (starboard), a clock, a radiator under each window
    mess.box(3.85, -3.4, DECK + 1.25, 4.18, -2.6, DECK + 1.3, M['wood'])
    mess.cyl(0.0, MESS[1] - 0.08, DECK + 1.9, 0.15, 0.04, M['dial'], axis='Y', segs=20)
    for s in (1, -1):
        for yy in (-5.3, -2.7):
            mess.box(s * (x - 0.2), yy - 0.5, DECK + 0.3, s * (x - 0.12), yy + 0.5, DECK + 0.8, M['white'])
    col.box(-1.3, -5.85, DECK, 1.3, -1.75, DECK + 0.95, M['col'])
    col.box(-4.2, -6.9, DECK, -3.45, -2.55, DECK + 0.95, M['col'])
    col.box(3.6, -6.9, DECK, 4.2, -5.95, DECK + 1.8, M['col'])
    # hall: a coat rack, the fire extinguisher, a notice board
    mess.box(x - 0.15, 3.0, DECK + 1.5, x - 0.12, 4.6, DECK + 1.6, M['wood'])
    mess.cyl(-x + 0.25, -0.2, DECK + 0.4, 0.09, 0.6, M['red'], segs=12)
    mess.box(-1.0, HALL[1] - 0.14, DECK + 1.2, 0.4, HALL[1] - 0.12, DECK + 1.9, C.mat('Cork', (0.35, 0.24, 0.12), 0.9))

    # ================================================================ funnel, mast
    fn = Part('FUNNEL', [M['white']])
    rings = []
    zf = np.linspace(L01, 11.0, 8)
    for z in zf:
        t = (z - L01) / (11.0 - L01)
        w, d, off = 1.15 - 0.12 * t, 1.45 - 0.2 * t, -5.2 - (z - L01) * 0.2
        ring = []
        for k in range(24):
            ang = 2 * math.pi * k / 24
            cx_, cy_ = math.cos(ang), math.sin(ang)
            # a rounded rectangle (superellipse)
            px = w * np.sign(cx_) * abs(cx_) ** 0.4; py = off + d * np.sign(cy_) * abs(cy_) ** 0.4
            ring.append(fn.bm.verts.new((px, py, z)))
        rings.append(ring)
    for j in range(len(rings) - 1):
        zc = (zf[j] + zf[j + 1]) / 2
        m = M['black'] if zc > 10.3 else (M['red'] if 8.9 < zc < 9.7 else M['white'])
        for k in range(24):
            f = fn.bm.faces.new((rings[j][k], rings[j][(k + 1) % 24], rings[j + 1][(k + 1) % 24], rings[j + 1][k]))
            f.material_index = fn.mi(m)
    f = fn.bm.faces.new(rings[-1]); f.material_index = fn.mi(M['black'])
    for s in (1, -1):
        fn.cyl(s * 0.4, -6.4, 11.2, 0.18, 0.9, M['black'], segs=14)
    col.box(-1.15, -6.7, L01, 1.15, -3.75, 11.0, M['col'])
    mast = Part('MAST', [M['white']])
    mx, my = 0.0, 4.6
    mast.cyl(mx, my, ROOF + 2.0, 0.15, 4.0, M['white'], segs=14, r2=0.1)
    mast.box(mx - 1.4, my - 0.08, ROOF + 2.9, mx + 1.4, my + 0.08, ROOF + 3.0, M['white'])   # yard
    mast.box(mx - 0.9, my - 0.6, ROOF + 3.5, mx + 0.9, my + 0.6, ROOF + 3.6, M['grey'])      # radar platform
    mast.cyl(mx, my, ROOF + 4.35, 0.05, 0.4, M['white'], segs=8)
    mast.cyl(mx, my + 0.1, ROOF + 4.6, 0.07, 0.12, M['navwhite'], segs=10)                     # masthead light
    for s in (1, -1):
        mast.cyl(mx + s * 1.3, my, ROOF + 3.4, 0.012, 1.4, M['dark'], segs=4)                  # whip antennas
        mast.cyl(mx + s * 0.6, my, ROOF + 3.3, 0.07, 0.6, M['white'], segs=8)                  # GPS domes
    # sidelights on the wings: red port, green starboard
    for s, m in ((1, M['navgreen']), (-1, M['navred'])):
        mast.box(s * (WING['x1'] - 0.15), WING['y1'] - 0.25, L02 + 1.1, s * (WING['x1'] - 0.02), WING['y1'] - 0.05, L02 + 1.35, m)
    mast.box(-0.1, Y_STERN + 0.2, sheer(Y_STERN) + 0.5, 0.1, Y_STERN + 0.35, sheer(Y_STERN) + 0.7, M['navwhite'])

    # ================================================================ boat deck: liferafts, lifebuoys
    gear = Part('GEAR', [M['white']])
    for s in (1, -1):
        for yy in (-6.0, -4.4):
            gear.cyl(s * 4.45, yy, L01 + 0.55, 0.32, 1.25, M['white'], axis='Y', segs=18)
            gear.cyl(s * 4.45, yy, L01 + 0.55, 0.335, 0.1, M['black'], axis='Y', segs=18)
            gear.box(s * 4.2, yy - 0.45, L01, s * 4.7, yy + 0.45, L01 + 0.25, M['steel'])
    def lifebuoy(cx, cy, cz, axis):
        bm_ = gear.bm
        pts = [Vector((math.cos(t) * 0.3, 0, math.sin(t) * 0.3)) for t in np.linspace(0, 2 * math.pi, 21)]
        rot = Matrix.Rotation(math.pi / 2, 3, 'Z') if axis == 'x' else Matrix.Identity(3)
        for k in range(4):
            seg = [rot @ p + Vector((cx, cy, cz)) for p in pts[k * 5:k * 5 + 6]]
            gear.tube([tuple(p) for p in seg], 0.065, M['orange'] if k % 2 == 0 else M['white'], 8)
    for (cx_, cy_, cz_, ax) in ((OVER - 0.02, -1.5, L01 + 0.7, 'x'), (-OVER + 0.02, -1.5, L01 + 0.7, 'x'),
                                 (WING['x1'] + 0.02, 5.3, L02 + 0.7, 'x'), (-WING['x1'] - 0.02, 5.3, L02 + 0.7, 'x'),
                                 (0.0, y0 - 0.08, DECK + 1.6, 'y')):
        lifebuoy(cx_, cy_, cz_, ax)

    # ================================================================ aft deck: winch, rope, bitts
    aft = Part('AFTDECK', [M['engine']])
    wy = -9.9
    aft.cyl(0, wy, DECK + 1.15, 0.6, 2.6, M['dark'], axis='X', segs=28)                       # drum barrel
    for s in (1, -1):
        aft.cyl(s * 1.33, wy, DECK + 1.15, 1.0, 0.08, M['engine'], axis='X', segs=32)           # flanges
        aft.box(s * 1.45, wy - 0.9, DECK, s * 1.85, wy + 0.9, DECK + 1.6, M['engine'], bevel=0.04)  # frames
        aft.cyl(s * 1.65, wy, DECK + 1.15, 0.22, 0.5, M['grey'], axis='X', segs=16)
    aft.box(2.0, wy - 0.7, DECK, 3.4, wy + 0.7, DECK + 1.1, M['engine'], bevel=0.06)          # the motor and gearbox
    aft.cyl(2.7, wy, DECK + 1.1, 0.45, 1.3, M['engine'], axis='X', segs=20)
    aft.box(-1.9, wy - 1.0, DECK, 3.5, wy + 1.0, DECK + 0.12, M['dark'])                        # foundation
    col.box(-1.9, wy - 1.0, DECK, 3.5, wy + 1.0, DECK + 2.15, M['col'])
    # the hawser wound on the drum (layers of turns) and paid out aft over the stern roller
    rope = Part('HAWSER', [M['rope']])
    for layer in range(3):
        r = 0.66 + layer * 0.075
        for k in range(16):
            xx = -1.2 + k * 0.16 + (layer % 2) * 0.08
            if abs(xx) > 1.22: continue
            rope.cyl(xx, wy, DECK + 1.15, r, 0.075, M['rope'], axis='X', segs=24)
    hp = [Vector((0.2, wy - 0.7, DECK + 1.15 + 0.5))]
    hp.append(Vector((0.15, -12.0, DECK + 1.28)))
    hp.append(Vector((0.05, -14.5, DECK + 1.55)))     # over the H-bitt's crossbar
    hp.append(Vector((0.0, -17.0, DECK + 1.3)))
    hp.append(Vector((0.0, -19.55, DECK + 1.36)))     # over the roller
    for k in range(1, 9):                              # and down into the sea astern (a catenary)
        t = k / 8
        hp.append(Vector((0.0, -19.7 - t * 9.0, DECK + 1.3 - (DECK + 2.2) * t ** 1.6)))
    rope.tube([tuple(p) for p in hp], 0.075, M['rope'], 10)
    # the H-bitt (towing post), the stern roller, towing pins, capstans, bollards
    for s in (1, -1):
        aft.box(s * 1.2, -14.75, DECK, s * 1.6, -14.25, DECK + 1.7, M['dark'], bevel=0.03)
    aft.box(-1.7, -14.75, DECK + 1.35, 1.7, -14.25, DECK + 1.6, M['dark'], bevel=0.03)
    col.box(-1.7, -14.75, DECK, 1.7, -14.25, DECK + 1.7, M['col'])
    aft.cyl(0, -19.55, DECK + 1.0, 0.36, 4.0, M['steel'], axis='X', segs=24)
    for s in (1, -1):
        aft.box(s * 2.0, -19.9, DECK, s * 2.3, -19.2, DECK + 1.45, M['dark'])
        aft.cyl(s * 0.9, -18.6, DECK + 0.55, 0.11, 1.1, M['yellow'], segs=12)                 # towing pins
        aft.cyl(s * 3.3, -16.8, DECK + 0.3, 0.4, 0.6, M['dark'], segs=20)                       # capstans
        aft.cyl(s * 3.3, -16.8, DECK + 0.75, 0.3, 0.3, M['dark'], segs=20, r2=0.36)
        for yy in (-18.3, -12.5):                                                                # bollards
            for dy in (-0.35, 0.35):
                aft.cyl(s * 4.6, yy + dy, DECK + 0.32, 0.17, 0.64, M['black'], segs=14)
                aft.cyl(s * 4.6, yy + dy, DECK + 0.66, 0.22, 0.06, M['black'], segs=14)
        col.box(s * 3.75 - 0.05, -17.25, DECK, s * 2.85 + 0.05, -16.35, DECK + 0.9, M['col'])
    col.box(-2.3, -19.95, DECK, 2.3, -19.15, DECK + 1.45, M['col'])
    for s in (1, -1):
        col.box(min(s * 0.79, s * 1.01), -18.71, DECK, max(s * 0.79, s * 1.01), -18.49, DECK + 1.1, M['col'])
    # vents (mushrooms and goosenecks), the engine room skylight
    for (vx, vy) in ((3.4, -7.8), (-3.4, -7.8), (2.4, 12.0), (-2.4, 12.0)):
        z = DECK if vy < 0 else FC
        aft.cyl(vx, vy, z + 0.45, 0.14, 0.9, M['white'], segs=12)
        aft.cyl(vx, vy, z + 0.95, 0.3, 0.12, M['white'], segs=16, r2=0.2)
        col.box(vx - 0.3, vy - 0.3, z, vx + 0.3, vy + 0.3, z + 1.0, M['col'])
    aft.box(-1.2, -13.3, DECK, 1.2, -11.6, DECK + 0.6, M['white'], bevel=0.03)
    aft.box(-1.0, -13.1, DECK + 0.6, 1.0, -11.8, DECK + 0.62, M['glass'])
    col.box(-1.2, -13.3, DECK, 1.2, -11.6, DECK + 0.62, M['col'])

    # ================================================================ forecastle: windlass, chains, bitts
    fo = Part('FORECASTLE', [M['dark']])
    wy2 = 13.8
    fo.box(-1.6, wy2 - 0.6, FC, 1.6, wy2 + 0.6, FC + 0.25, M['dark'])
    for s in (1, -1):
        fo.cyl(s * 0.9, wy2, FC + 0.75, 0.42, 0.45, M['engine'], axis='X', segs=20)              # gypsies
        fo.cyl(s * 1.45, wy2, FC + 0.75, 0.28, 0.25, M['engine'], axis='X', segs=16)              # warping ends
        # the chain from the gypsy to the hawse pipe
        cx_ = s * 0.9; tx = s * (half_breadth(17.6, 3.4) - 0.6)
        n = 14
        for k in range(n):
            t = k / (n - 1)
            px = cx_ + (tx - cx_) * t; py = wy2 + 0.25 + (17.2 - wy2 - 0.25) * t; pz = FC + 0.35 - 0.1 * math.sin(t * math.pi)
            fo.boxc(px, py, pz, 0.06 if k % 2 else 0.18, 0.24, 0.18 if k % 2 else 0.06, M['dark'])
        for yy in (16.4, 17.0):
            bxp = s * (half_breadth(yy, FC + 0.3) - 0.7)
            fo.cyl(bxp, yy, FC + 0.32, 0.17, 0.64, M['black'], segs=14)
            fo.cyl(bxp, yy, FC + 0.66, 0.22, 0.06, M['black'], segs=14)
    fo.box(-0.9, wy2 - 0.4, FC + 0.25, 0.9, wy2 + 0.4, FC + 0.9, M['engine'], bevel=0.05)
    col.box(-1.7, wy2 - 0.6, FC, 1.7, wy2 + 0.6, FC + 1.2, M['col'])
    # the foremast with the forward floodlight
    fo.cyl(0, 20.2, FC + 1.6, 0.1, 3.2, M['white'], segs=12)
    fo.box(-0.25, 20.0, FC + 2.8, 0.25, 20.25, FC + 3.05, M['lampcold'])
    col.box(-0.15, 20.05, FC, 0.15, 20.35, FC + 3.2, M['col'])

    # ================================================================ the game's nodes
    gcoll = C.collection(sc, 'GAME')
    def E(name, loc, rot=(0, 0, 0), **ex):
        return C.empty(name, loc, gcoll, rot, extras=ex)
    def box_node(name, x0_, y0_, z0_, x1_, y1_, z1_, **ex):
        p = Part(name, [M['col']], gcoll); p.box(x0_, y0_, z0_, x1_, y1_, z1_, M['col'])
        o_ = p.done()
        for k, v in ex.items(): o_[k] = v
        return o_
    # rooms (inside faces of the walls)
    box_node('ZONE_mess', -x + T, MESS[0] + T, DECK, x - T, MESS[1], L01 - 0.25)
    box_node('ZONE_hall', -x + T, HALL[0], DECK, x - T, HALL[1], L01 - 0.25)
    box_node('ZONE_cabin', -x + T, CABIN[0], DECK, x - T, CABIN[1], L01 - 0.25)
    box_node('ZONE_lobby', lb['x0'], lb['y0'], L01, lb['x1'], lb['y1'], L02 - 0.25)
    box_node('ZONE_bridge', -bx + T, by0 + T, L02, bx - T, by1, BRC)
    box_node('ZONE_engine', -ex, ey0, ER, ex, ey1, DECK - 0.25)
    box_node('ZONE_engine_stair', sd['x0'], sd['y0'] + 1.0, ER, sd['x1'], sd['y1'], DECK - 0.25)
    # ladders (face: the climber looks along +y)
    lad = Part('LADDERS', [M['steel']])
    for s, nm in ((1, 'wingstbd'), (-1, 'wingport')):
        xa = s * 4.62
        box_node('LAD_' + nm, xa - 0.35, WING['y0'] - 0.55, L01, xa + 0.35, WING['y0'] + 0.02, L02 + 1.0, face=0)
        ladder_rungs(lad, xa, WING['y0'] - 0.06, L01, L02 + 1.0, M['steel'])
    box_node('LAD_deck02', 1.6, l2y0 - 0.5, L01, 2.4, l2y0 - 0.1, L02 + 1.0, face=0)
    ladder_rungs(lad, 2.0, l2y0 - 0.2, L01, L02 + 1.0, M['steel'])
    box_node('LAD_roof', -2.25, by0 - 0.55, L02, -1.45, by0 - 0.04, ROOF + 1.0, face=0)
    ladder_rungs(lad, -1.85, by0 - 0.12, L02, ROOF + 1.0, M['steel'])

    # lamps (extras: colour, power in candela, range in metres, group: what switches it)
    E('LMP_mess_1', (0, -5.0, L01 - 0.35), color=[1.0, 0.74, 0.46], power=9, range=7, group='rooms')
    E('LMP_mess_2', (0, -2.2, L01 - 0.35), color=[1.0, 0.74, 0.46], power=9, range=7, group='rooms')
    E('LMP_hall_1', (0, 2.6, L01 - 0.35), color=[1.0, 0.78, 0.52], power=7, range=6, group='rooms')
    E('LMP_lobby_1', (-1.9, 3.0, L02 - 0.35), color=[1.0, 0.78, 0.52], power=5, range=5, group='rooms')
    E('LMP_bridge_1', (3.2, 1.65, BRC - 0.15), color=[1.0, 0.6, 0.3], power=2.5, range=4, group='rooms')
    E('LMP_bridge_2', (0, 7.6, L02 + 1.1), color=[0.3, 1.0, 0.5], power=0.5, range=2.5, group='bridge')
    for i, yy in enumerate((-10, -5.5, -1, 3.5)):
        E(f'LMP_engine_{i + 1}', (0, yy, DECK - 0.4), color=[0.86, 0.93, 1.0], power=12, range=9, group='engine')
    E('LMP_deck_1', (1.6, y0 - 0.1, L01 + 1.25), color=[0.9, 0.95, 1.0], power=55, range=18, group='deck')
    E('LMP_deck_2', (-1.6, y0 - 0.1, L01 + 1.25), color=[0.9, 0.95, 1.0], power=55, range=18, group='deck')
    E('LMP_fore_1', (0, 20.3, FC + 2.9), color=[0.9, 0.95, 1.0], power=60, range=20, group='deck')
    # lamp fittings (emissive) at each room lamp
    fit = Part('FITTINGS', [M['lamp']])
    for (lx, ly, lz) in ((0, -5.0, L01 - 0.3), (0, -2.2, L01 - 0.3), (0, 2.6, L01 - 0.3), (-1.9, 3.0, L02 - 0.3)):
        fit.box(lx - 0.3, ly - 0.12, lz - 0.06, lx + 0.3, ly + 0.12, lz, M['lamp'])
    fit.cyl(3.2, 1.65, BRC - 0.08, 0.12, 0.1, M['lamp'], segs=12)
    for yy in (-10, -5.5, -1, 3.5):
        fit.box(-0.6, yy - 0.06, DECK - 0.37, 0.6, yy + 0.06, DECK - 0.3, M['lampengine'])
    for s in (1, -1):
        fit.box(s * 1.6 - 0.22, y0 - 0.12, L01 + 1.12, s * 1.6 + 0.22, y0 + 0.02, L01 + 1.38, M['lampcold'])

    # spots: the empty's +y is where you face
    def rotz(deg): return (0, 0, math.radians(deg))
    E('SPOT_spawn', (5.3, 4.5, L02), rotz(-20))
    E('SPOT_wheel', (0, 6.45, L02), rotz(0))
    E('SPOT_searchlight', (2.25, 7.0, L02), rotz(0))
    E('SPOT_radar', (-1.4, 7.0, L02), rotz(0))
    E('SPOT_captain', (-0.9, 5.4, L02), rotz(15))
    E('SPOT_lookout', (-5.3, 5.6, L02), rotz(35))
    E('SPOT_bosun', (0.6, -12.1, DECK), rotz(0))
    E('SPOT_cook', (-3.1, -4.3, DECK), rotz(90))
    E('SPOT_cook2', (-0.0, -6.3, DECK), rotz(0))
    E('SPOT_engineer', (-1.6, 5.9, ER), rotz(0))
    E('SPOT_engineer2', (0.0, -6.0, ER), rotz(90))
    E('SPOT_guard_bow', (0.0, 17.5, FC), rotz(0))
    E('SPOT_guard_aft', (-3.0, -16.0, DECK), rotz(180))
    E('SPOT_guard_boat', (3.0, -6.4, L01), rotz(150))
    E('SPOT_kettle', (-3.8, -4.25, DECK + 0.92))
    # patrol paths
    for i, (px, py) in enumerate([(4.0, -8.6), (4.95, -6.5), (4.95, 6.0), (4.95, -6.5), (4.2, -11.5), (3.0, -15.5), (0.0, -17.6), (-3.0, -15.5), (-4.2, -11.5), (-4.95, -6.5), (-4.95, 6.0), (-4.95, -6.5), (-4.0, -8.6)]):
        E(f'PATH_deck_{i}', (px, py, DECK))
    for i, (px, py, pz) in enumerate([(-4.25, 7.0, L01), (-4.25, -2.0, L01), (-3.5, -3.35, L01), (3.5, -3.35, L01), (4.25, -2.0, L01), (4.25, 7.0, L01), (2.5, 9.8, FC), (0.0, 16.5, FC), (-2.5, 9.8, FC)]):
        E(f'PATH_patrol_{i}', (px, py, pz))

    # ================================================================ interactables
    wheel = Part('INT_wheel_helm', [M['wood']], gcoll)
    pts = [Vector((math.cos(t) * 0.42, 0, math.sin(t) * 0.42)) for t in np.linspace(0, 2 * math.pi, 33)]
    wheel.tube(pts, 0.026, M['wood'], 8)
    for k in range(8):
        t = k * math.pi / 4
        wheel.tube([(math.cos(t) * 0.06, 0, math.sin(t) * 0.06), (math.cos(t) * 0.42, 0, math.sin(t) * 0.42)], 0.016, M['brass'], 6)
        wheel.tube([(math.cos(t) * 0.44, 0, math.sin(t) * 0.44), (math.cos(t) * 0.58, 0, math.sin(t) * 0.58)], 0.022, M['wood'], 8)
    wheel.cyl(0, 0, 0, 0.075, 0.12, M['brass'], axis='Y', segs=14)
    wo = wheel.done(smooth=True); wo.location = (0, 6.82, L02 + 1.18)
    th = Part('INT_throttle_main', [M['chrome']], gcoll)
    th.box(-0.025, -0.025, 0, 0.025, 0.025, 0.3, M['chrome'])
    th.cyl(0, 0, 0.32, 0.05, 0.13, M['black'], axis='X', segs=12)
    tho = th.done(); tho.location = (1.2, 7.7, L02 + 1.0)
    cons.box(1.0, 7.5, L02 + 0.98, 1.4, 7.95, L02 + 1.04, M['grey'])
    hb = Part('INT_horn_button', [M['red']], gcoll); hb.cyl(0, 0, 0, 0.045, 0.05, M['red'], segs=14); hbo = hb.done(); hbo.location = (0.55, 7.68, L02 + 1.02)
    js = Part('INT_searchlight_ctrl', [M['black']], gcoll)
    js.cyl(0, 0, 0.0, 0.07, 0.04, M['grey'], segs=12); js.cyl(0, 0, 0.08, 0.016, 0.16, M['chrome'], segs=8); js.cyl(0, 0, 0.17, 0.035, 0.07, M['black'], segs=10)
    jso = js.done(); jso.location = (2.25, 7.68, L02 + 1.03)
    rd = Part('INT_radio_bridge', [M['dark']], gcoll); rd.box(-0.24, -0.13, 0, 0.24, 0.13, 0.16, M['dark'], bevel=0.01); rd.box(-0.2, -0.135, 0.03, 0.05, -0.13, 0.12, M['screen']); rdo = rd.done(); rdo.location = (-2.65, 7.8, L02 + 1.05)
    rad = Part('INT_radar_main', [M['screen']], gcoll)
    rad.box(-0.3, -0.015, -0.27, 0.3, 0.015, 0.27, M['screen'])
    rado = rad.done(); rado.location = (-1.4, 7.93, L02 + 1.4); rado.rotation_euler = (math.radians(-15), 0, 0)
    kt = Part('INT_kettle_mess', [M['enamel']], gcoll)
    kt.cyl(0, 0, 0.1, 0.11, 0.2, M['enamel'], segs=18, r2=0.075)
    kt.cyl(0, 0, 0.215, 0.05, 0.03, M['black'], segs=10)
    kt.tube([(0, -0.09, 0.06), (0, -0.16, 0.15), (0, -0.2, 0.2)], 0.014, M['enamel'], 6)
    kt.tube([(0.0, 0.07, 0.2), (0.0, 0.0, 0.3), (0.0, -0.07, 0.2)], 0.008, M['black'], 6)
    kto = kt.done(smooth=True); kto.location = (-3.85, -4.25, DECK + 0.945)
    mr = Part('INT_radio_mess', [M['wood']], gcoll); mr.box(-0.21, -0.1, 0, 0.21, 0.1, 0.25, M['wood'], bevel=0.015); mr.cyl(-0.08, -0.105, 0.12, 0.07, 0.01, M['black'], axis='Y', segs=14); mro = mr.done(); mro.location = (4.0, -3.0, DECK + 1.3)
    mro.rotation_euler = (0, 0, math.radians(90))
    for i, nm in enumerate(('engine', 'deck', 'rooms')):
        sw = Part(f'INT_switch_{nm}', [M['black']], gcoll); sw.box(-0.05, -0.03, -0.08, 0.05, 0.03, 0.08, M['black'])
        sw.box(-0.015, -0.07, -0.01, 0.015, -0.03, 0.06, M['chrome'])
        swo = sw.done(); swo.location = (-3.0 + i * 0.45, 7.15, ER + 1.4)
        er.box(-3.1 + i * 0.45, 7.18, ER + 1.55, -2.9 + i * 0.45, 7.2, ER + 1.62, M['dial'])
    eb = Part('INT_engine_main', [M['red']], gcoll); eb.cyl(0, 0, 0, 0.065, 0.06, M['red'], axis='Y', segs=16); eb.cyl(0, 0.03, 0, 0.09, 0.02, M['yellow'], axis='Y', segs=16); ebo = eb.done(); ebo.location = (-0.6, 7.16, ER + 1.4)
    for i, nm in enumerate(('rpm', 'oil', 'temp', 'volt')):
        gx = -3.0 + i * 0.75
        er.cyl(gx, 7.19, ER + 1.85, 0.14, 0.04, M['dark'], axis='Y', segs=24)
        er.cyl(gx, 7.17, ER + 1.85, 0.12, 0.01, M['dial'], axis='Y', segs=24)
        nd = Part(f'NEEDLE_{nm}', [M['red']], gcoll); nd.box(-0.006, -0.008, -0.02, 0.006, 0.0, 0.1, M['red'])
        ndo = nd.done(); ndo.location = (gx, 7.155, ER + 1.85)
    # the bridge's own rpm gauge on the console
    cons.cyl(0.0, 8.0, L02 + 1.2, 0.12, 0.04, M['dark'], axis='Y', segs=24)
    cons.cyl(0.0, 7.98, L02 + 1.2, 0.1, 0.01, M['dial'], axis='Y', segs=24)
    nd = Part('NEEDLE_bridge', [M['red']], gcoll); nd.box(-0.005, -0.008, -0.015, 0.005, 0.0, 0.085, M['red']); ndo = nd.done(); ndo.location = (0.0, 7.965, L02 + 1.2)
    cons.box(-0.15, 7.94, L02 + 1.05, 0.15, 8.06, L02 + 1.36, M['dark'])

    def door(id_, hinge, yaw_deg, w=0.9, h=DOOR_H, m=M['white']):
        d = Part(f'INT_door_{id_}', [m], gcoll)
        d.box(0.02, -0.03, 0.0, w - 0.02, 0.03, h, m, bevel=0.015)
        d.box(0.1, -0.035, 1.25, w - 0.1, -0.03, 1.75, M['glass'])
        for sgn in (-1, 1):
            d.cyl(w - 0.12, sgn * 0.07, 1.0, 0.018, 0.12, M['steel'], axis='Y', segs=6)
            d.box(w - 0.2, sgn * 0.12 - 0.015, 0.98, w - 0.08, sgn * 0.12 + 0.015, 1.02, M['steel'])
        o_ = d.done(); o_.location = hinge; o_.rotation_euler = (0, 0, math.radians(yaw_deg))
        return o_
    door('messaft', (-0.45, y0, DECK), 0)
    door('mess', (-0.45, MESS[1], DECK), 0, m=M['wall'])
    door('hallstbd', (x, 0.1 - 0.45, DECK), 90)
    door('hallport', (-x, 0.1 + 0.45, DECK), -90)
    door('cabin', (-1.2 - 0.4, CABIN[0], DECK), 0, w=0.8, m=M['wall'])
    door('lobby', (-l2x, 5.1 + 0.45, L01), -90)
    door('bridgeaft', (1.6 - 0.45, by0, L02), 0)
    door('wingstbd', (bx, 5.3 - 0.45, L02), 90)
    door('wingport', (-bx, 5.3 + 0.45, L02), -90)

    # the searchlight on the bridge roof (front centre): yaw pedestal, pitch head, lamp
    sly = E('SL_yaw', (0, 8.0, ROOF))
    base = Part('SL_base', [M['dark']], gcoll)
    base.cyl(0, 0, 0.3, 0.1, 0.6, M['dark'], segs=12); base.cyl(0, 0, 0.05, 0.22, 0.1, M['dark'], segs=16)
    for s in (1, -1): base.box(s * 0.26 - 0.02, -0.05, 0.45, s * 0.26 + 0.02, 0.05, 0.85, M['dark'])
    pbo = base.done(); pbo.parent = sly
    slp = E('SL_pitch', (0, 0, 0.75)); slp.parent = sly
    head = Part('SL_head', [M['dark']], gcoll)
    head.cyl(0, 0.0, 0, 0.23, 0.55, M['dark'], axis='Y', segs=24)
    head.cyl(0, 0.28, 0, 0.24, 0.04, M['chrome'], axis='Y', segs=24)
    head.cyl(0, 0.29, 0, 0.21, 0.02, M['lampcold'], axis='Y', segs=24)
    head.cyl(0, -0.32, 0, 0.16, 0.12, M['dark'], axis='Y', segs=16)
    ho = head.done(smooth=True); ho.parent = slp
    sll = E('SL_lamp', (0, 0.32, 0)); sll.parent = slp
    rs = Part('RADAR_scanner', [M['white']], gcoll)
    rs.box(-1.2, -0.1, 0.06, 1.2, 0.1, 0.24, M['white'], bevel=0.03)
    rs.cyl(0, 0, 0, 0.09, 0.12, M['dark'], segs=12)
    rso = rs.done(); rso.location = (mx, my, ROOF + 3.62)
    hn = Part('HORN', [M['steel']])
    for s in (1, -1):
        hn.cyl(s * 0.2, my + 0.45, ROOF + 2.2, 0.05, 0.7, M['steel'], axis='Y', segs=14, r2=0.15)
    E('SPOT_horn', (0, my + 0.8, ROOF + 2.2))

    # ---- finish
    parts = (main, trim, dh, inner, top, top2, l2, curt, st, er, eng, brw, front, fglass, gl, rail, cons, ped, mess,
             fn, mast, gear, aft, rope, fo, lad, hn, fit)
    for p in parts:
        if len(p.bm.verts):
            made[p.name] = p.done()
        else:
            p.bm.free()
    for nm in ('ENGINES', 'AFTDECK', 'FORECASTLE', 'MAST', 'FUNNEL', 'HAWSER'):
        o = made.get(nm)
        if o:
            for poly in o.data.polygons: poly.use_smooth = True
            o.data.set_sharp_from_angle(angle=math.radians(40))
    made['col'] = col.done()
    zs = list(np.linspace(-Y_BOW_WL, -Y_STERN, 24))
    hb_ = [round(max(0.0, half_breadth(-z, 0.0)), 3) for z in zs]
    E('BOAT_info', (0, 0, 0), hull=hb_, hullZ=[round(zs[0], 3), round(zs[-1], 3)])
    return sc, made

def report(sc):
    objs = [o for o in sc.objects if o.type == 'MESH']
    tot = sum(C.tris(o) for o in objs if not o.name.startswith(('COL_', 'ZONE_', 'LAD_')))
    return {'tris_visible': tot, 'objects': len(objs), 'col_tris': C.tris(sc.objects['COL_boat'])}

def export(sc):
    path = os.path.join(C.raw_dir(), 'tug.glb')
    size = C.export_glb(sc, path)
    return path, size

if __name__ == '__main__' or True:
    ROOT_ = globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arctic Tug')
    sc, made = build(ROOT_)
    result = report(sc)
    if globals().get('EXPORT', True):
        result['export'] = export(sc)
