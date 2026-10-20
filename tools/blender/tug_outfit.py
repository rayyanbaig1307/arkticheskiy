# The Polyarnik's deck fittings: the towing gear aft (the winch, whose drum, level-wind and stern
# roller the game turns: WINCH_drum, WINCH_spool, ROLLER_stern; the towline itself is simulated
# in the game, src/boat/Towline.js, between the ROPE_ points), its control stand
# (INT_winch_ctrl), the H-bitt, towing pins, capstans, bollards, fairleads, the engine room
# skylight, vents, hatches; the forecastle's windlass and chain, the bell; lamps at the doors,
# the hose boxes, the life rafts, the stern flag (FLAG_stern, waved by the game).
import math
import importlib
import bmesh
from mathutils import Matrix, Vector
import kit as K
importlib.reload(K)
from tug_layout import *

def _crom(P, n=10):
    """a smooth curve through the points (Catmull-Rom), n samples per span"""
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(Vector(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                         + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(3))))
    out.append(Vector(P[-1]))
    return out

def stud_link(part, c, t, nv, m, d, segs=16, rsegs=6):
    """one stud link of round bar d: an oval 6d long and 3.6d wide, centred at c, long along t, in
    the plane of t and nv, with its stud across the middle"""
    bm = part.bm; mi = part.mi(m)
    B = t.cross(nv).normalized()                # the link plane's normal
    L, W, rb = 6.0 * d, 3.6 * d, d / 2
    a, R = (L - W) / 2, (W - d) / 2
    h = segs // 2
    cl = []
    for k in range(h):
        ang = -math.pi / 2 + math.pi * k / h
        cl.append((a + R * math.cos(ang), R * math.sin(ang)))
    for k in range(h):
        ang = math.pi / 2 + math.pi * k / h
        cl.append((-a + R * math.cos(ang), R * math.sin(ang)))
    P = [c + t * u + nv * v for u, v in cl]
    n = len(P)
    rings = []
    for i in range(n):
        T = (P[(i + 1) % n] - P[i - 1]).normalized()
        N = B.cross(T).normalized()
        rings.append([bm.verts.new(part.P(tuple(P[i] + (N * math.cos(2 * math.pi * k / rsegs) + B * math.sin(2 * math.pi * k / rsegs)) * rb))) for k in range(rsegs)])
    for i in range(n):
        j = (i + 1) % n
        for k in range(rsegs):
            k1 = (k + 1) % rsegs
            f = bm.faces.new((rings[i][k], rings[i][k1], rings[j][k1], rings[j][k])); f.material_index = mi
    # the stud
    part.tube([tuple(c - nv * (R - rb * 0.6)), tuple(c + nv * (R - rb * 0.6))], rb * 0.75, m, 6)

def stud_chain(part, pts, m, d=0.030):
    """links along a run, a pitch apart (each through the next), turned a quarter turn in turn"""
    curve = _crom(pts, 12)
    lens = [0.0]
    for i in range(1, len(curve)): lens.append(lens[-1] + (curve[i] - curve[i - 1]).length)
    pitch = 4.0 * d
    up = Vector((0, 0, 1))
    s, i, k = pitch / 2, 1, 0
    while s < lens[-1] - pitch / 2:
        while lens[i] < s: i += 1
        f = (s - lens[i - 1]) / max(1e-9, lens[i] - lens[i - 1])
        c = curve[i - 1].lerp(curve[i], f)
        t = (curve[i] - curve[i - 1]).normalized()
        side = t.cross(up)
        side = side.normalized() if side.length > 1e-4 else Vector((1, 0, 0))
        flat = side                                    # a link lying flat (its plane level)
        stand = t.cross(side).normalized()             # and the next standing up
        stud_link(part, c, t, flat if k % 2 == 0 else stand, m, d)
        s += pitch; k += 1

def bollard(p, M, x, y, z, r=0.17):
    """a double bitt: two posts with caps on a base plate"""
    p.rbox(x - 0.3, y - 0.65, z, x + 0.3, y + 0.65, z + 0.05, M['black'], r=0.02)
    for dy in (-0.35, 0.35):
        p.cyl(x, y + dy, z + 0.36, r, 0.62, M['black'], segs=18, bevel=0.01)
        p.cyl(x, y + dy, z + 0.7, r + 0.06, 0.07, M['black'], segs=18, bevel=0.015)
        p.cyl(x, y + dy, z + 0.12, r + 0.035, 0.12, M['black'], segs=18, bevel=0.01)

def fairlead(p, M, x, y, z, face):
    """a closed (panama) chock let into the bulwark"""
    with p.at(x, y, z, K.FACE[face]):
        p.rbox(-0.32, -0.08, -0.18, 0.32, 0.08, 0.18, M['black'], r=0.06, segs=3)
        p.box(-0.2, -0.085, -0.08, 0.2, 0.085, 0.08, M['steel'])

def hatch(p, M, cx, cy, z, w, l, m, dogs=6):
    """a deck hatch: a coaming, a domed cover with its hinges and dogs"""
    p.rbox(cx - w / 2, cy - l / 2, z, cx + w / 2, cy + l / 2, z + 0.32, m, r=0.04)
    p.rbox(cx - w / 2 - 0.04, cy - l / 2 - 0.04, z + 0.32, cx + w / 2 + 0.04, cy + l / 2 + 0.04, z + 0.4, m, r=0.03, segs=3)
    for k in range(dogs):
        side = k % 2
        t = (k // 2 + 0.5) / (dogs // 2)
        yy = cy - l / 2 + l * t
        xx = cx + (w / 2 + 0.05) * (1 if side else -1)
        p.cyl(xx, yy, z + 0.26, 0.02, 0.18, M['steel'], segs=8)
        p.tube([(xx, yy, z + 0.36), (xx + (0.08 if side else -0.08), yy, z + 0.38)], 0.012, M['steel'], 5)
    for k in (-1, 1):
        p.cyl(cx + k * w * 0.3, cy + l / 2 + 0.06, z + 0.36, 0.035, 0.12, M['dark'], axis='X', segs=10)

def mushroom_vent(p, M, x, y, z, r=0.14):
    p.cyl(x, y, z + 0.45, r, 0.9, M['white'], segs=16)
    p.cyl(x, y, z + 0.05, r + 0.06, 0.1, M['white'], segs=16, bevel=0.01)
    p.cyl(x, y, z + 0.98, r + 0.2, 0.14, M['white'], segs=20, r2=r + 0.08, bevel=0.015)
    p.cyl(x, y, z + 1.07, r + 0.08, 0.05, M['white'], segs=20, r2=0.02)
    p.cyl(x, y, z + 0.9, r + 0.18, 0.04, M['dark'], segs=20)

def gooseneck(p, M, x, y, z, r=0.12, face=0.0):
    pts = [(0, 0, 0.0), (0, 0, 0.75), (0, -0.08, 0.95), (0, -0.3, 1.02), (0, -0.48, 0.9), (0, -0.5, 0.75)]
    with p.at(x, y, z, face):
        K.pipe(p, pts, r, M['white'], bend=0.18, segs=12)
        p.cyl(0, 0, 0.05, r + 0.05, 0.1, M['white'], segs=14, bevel=0.01)
        p.cyl(0, -0.5, 0.73, r + 0.02, 0.04, M['dark'], segs=14)

def door_lamp(p, M, x, y, z, face):
    K.cage_lamp(p, x, y, z, M['white'], M['lampcold'], M['dark'], axis=face, r=0.07)

def hose_box(p, M, x, y, z, face):
    with p.at(x, y, z, K.FACE[face]):
        p.rbox(-0.32, 0, 0, 0.32, 0.25, 0.75, M['red'], r=0.02)
        p.box(-0.28, 0.25, 0.04, 0.28, 0.256, 0.71, M['red'])
        K.text_flat(p, 'ПК', 0.11, M['ex_sign_white'], y=0.258)
        p.box(-0.08, 0.256, 0.12, 0.08, 0.27, 0.16, M['chrome'])

def liferaft(p, M, x, y, z):
    """a liferaft in its canister on a cradle, the hydrostatic release"""
    p.box(x - 0.3, y - 0.55, z, x + 0.3, y + 0.55, z + 0.12, M['steel'])
    for dy in (-0.42, 0.42):
        p.rbox(x - 0.32, y + dy - 0.04, z + 0.12, x + 0.32, y + dy + 0.04, z + 0.3, M['steel'], r=0.01)
    p.cyl(x, y, z + 0.55, 0.32, 1.25, M['white'], axis='Y', segs=22, bevel=0.06)
    for dy in (-0.5, 0.0, 0.5):
        p.torus(x, y + dy, z + 0.55, 0.325, 0.012, M['black'], axis='Y', segs=22, rsegs=4)
    p.torus(x, y, z + 0.55, 0.33, 0.01, M['steel'], axis='X', segs=24, rsegs=4)
    p.cyl(x, y - 0.65, z + 0.25, 0.05, 0.08, M['red'], axis='Y', segs=10)

def build(ctx):
    M, col, parts, E = ctx.M, ctx.col, ctx.parts, ctx.E
    gcoll = ctx.gcoll
    of = K.Part('OUTFIT', [M['dark']])
    os_ = K.Part('OUTFIT_SMALLS', [M['steel']])
    parts += [of, os_]
    z = DECK
    wy, wz = WINCH_Y, WINCH_Z
    # ================================================================ the towing winch
    of.rbox(-1.95, wy - 1.05, z, 3.55, wy + 1.0, z + 0.12, M['dark'], r=0.02)
    for s in (1, -1):
        with of.at(s * 1.65, wy, z, K.FACE['+x']):
            K.rplate(of, -0.9, 0.0, 0.9, 1.6, -0.2, 0.2, M['engine'], r=0.18)
        of.cyl(s * 1.65, wy, wz, 0.3, 0.5, M['engine'], axis='X', segs=22, bevel=0.03)
        of.cyl(s * 1.92, wy, wz, 0.2, 0.08, M['steel'], axis='X', segs=18)
    # the gearbox and the hydraulic motor (starboard), their hoses
    of.rbox(1.95, wy - 0.75, z + 0.12, 2.95, wy + 0.75, z + 1.55, M['engine'], r=0.06, segs=2)
    for k in range(4):
        of.box(1.93, wy - 0.6 + k * 0.4, z + 0.3, 1.96, wy - 0.56 + k * 0.4, z + 1.4, M['engine'])
    of.cyl(3.2, wy, wz - 0.1, 0.3, 0.55, M['engine'], axis='X', segs=22, bevel=0.03)
    of.cyl(3.5, wy, wz - 0.1, 0.18, 0.12, M['dark'], axis='X', segs=16)
    for d in (-0.12, 0.12):
        K.pipe(os_, [(3.35, wy + d, wz + 0.15), (3.45, wy + d, wz + 0.45), (3.6, wy + d * 2, z + 0.4), (3.75, wy + d * 3, z + 0.13)], 0.025, M['black'], bend=0.15)
    # the band brake (port): the band round the drum's brake rim, its lever and ram
    of.torus(-1.38, wy, wz, 0.98, 0.03, M['dark'], axis='X', segs=32, rsegs=6, arc=math.pi * 1.6, a0=-math.pi * 0.3)
    of.tube([(-1.38, wy + 0.6, wz - 0.75), (-1.38, wy + 1.0, z + 0.5)], 0.035, M['dark'], 8)
    of.cyl(-1.38, wy + 0.95, z + 0.3, 0.07, 0.4, M['yellow'], segs=12)
    # the drum itself turns (WINCH_drum: origin on its axis): barrel, flanges with ribs, brake rim
    dr = K.Part('WINCH_drum', [M['engine']], gcoll)
    dr.cyl(0, 0, 0, 0.5, 2.52, M['engine'], axis='X', segs=32)
    for s in (1, -1):
        dr.cyl(s * 1.3, 0, 0, 1.0, 0.07, M['engine'], axis='X', segs=40, bevel=0.012)
        for k in range(8):
            a = k * math.pi / 4
            rib = dr.box(s * 1.35 - 0.025, -0.03, 0.52, s * 1.35 + 0.025, 0.03, 0.95, M['engine'])
            vs = list({v for f in rib for v in f.verts})
            bmesh.ops.rotate(dr.bm, verts=vs, cent=(s * 1.35, 0, 0), matrix=Matrix.Rotation(a, 3, 'X'))
        dr.cyl(s * 1.36, 0, 0, 0.22, 0.06, M['steel'], axis='X', segs=18)
    dr.cyl(-1.38, 0, 0, 0.96, 0.14, M['steel'], axis='X', segs=40)
    for k in range(12):
        a = k * math.pi / 6
        dr.cyl(1.25, math.cos(a) * 0.48, math.sin(a) * 0.48, 0.03, 0.05, M['steel'], axis='X', segs=6)
    ctx.made['WINCH_drum'] = dr.done(sharp=40)
    ctx.made['WINCH_drum'].location = (0, wy, wz)
    # the level-wind: two guide bars across the drum's after side, the carriage on them (it runs
    # across with the turns: WINCH_spool)
    ly, lz = wy - 1.05, wz + 0.5
    for dz in (-0.2, 0.25):
        of.cyl(0, ly, lz + dz, 0.04, 2.9, M['steel'], axis='X', segs=12)
    for s in (1, -1):
        of.rbox(s * 1.5 - 0.06, ly - 0.08, z + 0.12, s * 1.5 + 0.06, ly + 0.08, lz + 0.35, M['engine'], r=0.02)
    sp = K.Part('WINCH_spool', [M['yellow']], gcoll)
    sp.rbox(-0.22, -0.12, -0.32, 0.22, 0.12, -0.12, M['yellow'], r=0.02)
    sp.rbox(-0.22, -0.12, 0.16, 0.22, 0.12, 0.36, M['yellow'], r=0.02)
    for s in (1, -1):
        sp.cyl(s * 0.13, 0, 0.02, 0.055, 0.32, M['steel'], segs=14)
        sp.box(s * 0.2 - 0.02, -0.11, -0.12, s * 0.2 + 0.02, 0.11, 0.16, M['yellow'])
    sp.cyl(0, 0, -0.1, 0.045, 0.24, M['steel'], axis='X', segs=12)
    sp.cyl(0, 0, 0.14, 0.045, 0.24, M['steel'], axis='X', segs=12)
    ctx.made['WINCH_spool'] = sp.done(sharp=40)
    ctx.made['WINCH_spool'].location = (0, ly, lz)
    col.box(-1.95, wy - 1.2, z, 3.55, wy + 1.0, z + 2.15, M['col'])
    # the towline's path: off the drum, through the level-wind, over the H-bitt, the stern roller
    E('ROPE_drum', (0, wy, wz), r0=0.5, r1=0.95, width=2.48)
    E('ROPE_lead', (0, ly, lz))
    E('ROPE_bitt', (0, -14.5, z + 1.66))
    E('ROPE_roller', (0, ROLLER_Y, ROLLER_Z + 0.37))
    # the winch control stand (port, abreast the drum): a pedestal, the lever (INT_winch_ctrl)
    with of.at(-3.35, wy - 0.5, z, K.FACE['-x']):
        of.rbox(-0.22, -0.18, 0, 0.22, 0.18, 0.95, M['grey'], r=0.03, segs=2)
        of.rbox(-0.26, -0.22, 0.95, 0.26, 0.24, 1.05, M['grey'], r=0.03, segs=2)
        of.rbox(-0.24, 0.1, 1.05, 0.24, 0.24, 1.25, M['dark'], r=0.02)
        of.box(-0.2, 0.24, 1.08, 0.2, 0.245, 1.22, M['ex_sign_white'])
        for k, m in enumerate((M['navgreen'], M['navred'])):
            of.cyl(-0.12 + k * 0.24, 0.0, 1.06, 0.03, 0.025, m, segs=10)
        K.text_flat(of, 'ЛЕБЕДКА', 0.04, M['black'], y=0.247)
    lv = K.Part('INT_winch_ctrl', [M['chrome']], gcoll)
    lv.cyl(0, 0, 0.02, 0.06, 0.04, M['dark'], segs=12)
    lv.cyl(0, 0, 0.16, 0.014, 0.28, M['chrome'], segs=8)
    lv.sphere(0, 0, 0.32, 0.035, M['red'], segs=12, rings=8)
    ctx.made['INT_winch_ctrl'] = lv.done(smooth=True)
    ctx.made['INT_winch_ctrl'].location = (-3.35, wy - 0.5, z + 1.06)
    col.box(-3.6, wy - 0.75, z, -3.1, wy - 0.25, z + 1.2, M['col'])
    # ================================================================ the H-bitt, the stern roller, pins, capstans
    for s in (1, -1):
        of.rbox(s * 1.4 - 0.2, -14.75, z, s * 1.4 + 0.2, -14.25, z + 1.7, M['dark'], r=0.04, segs=2)
        of.rbox(s * 1.4 - 0.3, -14.85, z, s * 1.4 + 0.3, -14.15, z + 0.06, M['dark'], r=0.02)
    of.rbox(-1.7, -14.75, z + 1.33, 1.7, -14.25, z + 1.62, M['dark'], r=0.1, segs=3)
    col.box(-1.7, -14.75, z, 1.7, -14.25, z + 1.7, M['col'])
    rl = K.Part('ROLLER_stern', [M['steel']], gcoll)
    rl.cyl(0, 0, 0, 0.36, 3.9, M['steel'], axis='X', segs=32, bevel=0.03)
    for s in (1, -1):
        rl.cyl(s * 1.98, 0, 0, 0.44, 0.08, M['dark'], axis='X', segs=32, bevel=0.01)
    ctx.made['ROLLER_stern'] = rl.done(sharp=40)
    ctx.made['ROLLER_stern'].location = (0, ROLLER_Y, ROLLER_Z)
    for s in (1, -1):
        with of.at(s * 2.15, ROLLER_Y, z, K.FACE['+x']):
            K.rplate(of, -0.36, 0.0, 0.36, ROLLER_Z - z + 0.5, -0.15, 0.15, M['dark'], r=0.15)
        of.cyl(s * 2.15, ROLLER_Y, ROLLER_Z, 0.18, 0.34, M['steel'], axis='X', segs=16)
    col.box(-2.3, -19.95, z, 2.3, -19.15, z + 1.45, M['col'])
    for s in (1, -1):
        os_.cyl(s * 0.9, -18.6, z + 0.03, 0.2, 0.06, M['dark'], segs=16)
        os_.cyl(s * 0.9, -18.6, z + 0.55, 0.11, 1.0, M['yellow'], segs=16, bevel=0.02)
        os_.cyl(s * 0.9, -18.6, z + 1.06, 0.13, 0.04, M['yellow'], segs=16)
        col.box(s * 0.9 - 0.12, -18.72, z, s * 0.9 + 0.12, -18.48, z + 1.1, M['col'])
        # capstans: a waisted barrel with whelps on a pedestal
        cx_ = s * 3.3
        of.cyl(cx_, -16.8, z + 0.12, 0.42, 0.24, M['dark'], segs=24, bevel=0.02)
        of.cyl(cx_, -16.8, z + 0.5, 0.26, 0.5, M['dark'], segs=24, r2=0.3)
        of.cyl(cx_, -16.8, z + 0.8, 0.36, 0.08, M['dark'], segs=24, bevel=0.015)
        for k in range(8):
            a = k * math.pi / 4
            of.box(cx_ + math.cos(a) * 0.27 - 0.02, -16.8 + math.sin(a) * 0.27 - 0.02, z + 0.3, cx_ + math.cos(a) * 0.3 + 0.02, -16.8 + math.sin(a) * 0.3 + 0.02, z + 0.74, M['dark'])
        col.box(cx_ - 0.45, -17.25, z, cx_ + 0.45, -16.35, z + 0.9, M['col'])
        for yy in (-18.3, -12.5):
            bollard(of, M, s * 4.6, yy, z)
            col.box(s * 4.6 - 0.3, yy - 0.65, z, s * 4.6 + 0.3, yy + 0.65, z + 0.75, M['col'])
        bollard(of, M, s * (half_breadth(16.7, FC + 0.3) - 0.75), 16.7, FC, r=0.15)
        col.box(s * (half_breadth(16.7, FC + 0.3) - 0.75) - 0.3, 16.05, FC, s * (half_breadth(16.7, FC + 0.3) - 0.75) + 0.3, 17.35, FC + 0.75, M['col'])
        fairlead(of, M, s * (half_breadth(-15.5, z + 0.75) - 0.12), -15.5, z + 0.75, '+x' if s < 0 else '-x')
        fairlead(of, M, s * (half_breadth(18.3, FC + 0.75) - 0.12), 18.3, FC + 0.75, '+x' if s < 0 else '-x')
    # ================================================================ the engine room skylight, hatches, vents
    of.rbox(-1.2, -13.3, z, 1.2, -11.6, z + 0.55, M['white'], r=0.04, segs=2)
    for s in (1, -1):
        with of.at(s * 0.6, -12.45, z + 0.55, 0.0, ry=s * math.radians(12)):
            of.rbox(-0.55, -0.82, 0, 0.55, 0.82, 0.05, M['white'], r=0.02)
            of.box(-0.45, -0.72, 0.05, 0.45, 0.72, 0.052, M['glass'])
            for k in range(3):
                of.box(-0.47, -0.72 + k * 0.72 - 0.015, 0.05, 0.47, -0.72 + k * 0.72 + 0.015, 0.07, M['white'])
    col.box(-1.2, -13.3, z, 1.2, -11.6, z + 0.75, M['col'])
    hatch(of, M, 2.6, -13.2, z, 0.8, 1.0, M['white'])
    col.box(2.15, -13.75, z, 3.05, -12.65, z + 0.42, M['col'])
    hatch(of, M, 0.0, 11.0, FC, 0.9, 0.9, M['white'])
    col.box(-0.5, 10.5, FC, 0.5, 11.5, FC + 0.42, M['col'])
    for (vx, vy) in ((3.4, -7.8), (-3.4, -7.8)):
        mushroom_vent(of, M, vx, vy, DECK)
        col.box(vx - 0.35, vy - 0.35, DECK, vx + 0.35, vy + 0.35, DECK + 1.1, M['col'])
    for (vx, vy) in ((2.4, 12.0), (-2.4, 12.0)):
        gooseneck(of, M, vx, vy, FC)
        col.box(vx - 0.25, vy - 0.75, FC, vx + 0.25, vy + 0.25, FC + 1.1, M['col'])
    # ================================================================ the forecastle: windlass, chains, stoppers, the bell
    w2 = 13.8
    of.rbox(-1.65, w2 - 0.65, FC, 1.65, w2 + 0.65, FC + 0.22, M['dark'], r=0.03)
    of.rbox(-0.85, w2 - 0.42, FC + 0.22, 0.85, w2 + 0.42, FC + 0.95, M['engine'], r=0.06, segs=2)
    for s in (1, -1):
        gx = s * 0.95
        of.cyl(gx, w2, FC + 0.75, 0.42, 0.36, M['engine'], axis='X', segs=24, bevel=0.02)
        for k in range(5):
            a = k * 2 * math.pi / 5
            of.box(gx - 0.2, w2 + math.cos(a) * 0.43 - 0.05, FC + 0.75 + math.sin(a) * 0.43 - 0.05, gx + 0.2, w2 + math.cos(a) * 0.43 + 0.05, FC + 0.75 + math.sin(a) * 0.43 + 0.05, M['engine'])
        of.torus(s * 1.2, w2, FC + 0.75, 0.47, 0.03, M['dark'], axis='X', segs=28, rsegs=6, arc=math.pi * 1.5, a0=math.pi * 0.25)
        of.cyl(s * 1.48, w2, FC + 0.75, 0.29, 0.3, M['engine'], axis='X', segs=22, r2=0.22, bevel=0.02)
        of.cyl(s * 1.25, w2 + 0.65, FC + 1.25, 0.012, 0.3, M['steel'], segs=6)
        of.torus(s * 1.25, w2 + 0.65, FC + 1.4, 0.13, 0.012, M['red'], axis='Z', segs=16, rsegs=4)
        # the chain: up from its pipe behind the gypsy, over it, down to the deck forward, over the
        # stopper and down the spurling pipe at the bow
        tx = s * (half_breadth(17.6, 3.4) - 0.75)
        sx, sy = gx + (tx - gx) * 0.6, w2 + 0.42 + (17.3 - w2 - 0.42) * 0.6
        gr = 0.44
        run = [(gx, w2 - 0.42, FC - 0.25), (gx, w2 - 0.38, FC + 0.30), (gx, w2 - 0.30, FC + 0.75 + gr * 0.72),
               (gx, w2, FC + 0.75 + gr + 0.02), (gx, w2 + 0.30, FC + 0.75 + gr * 0.72), (gx, w2 + 0.55, FC + 0.42),
               (gx + (sx - gx) * 0.45, w2 + 0.55 + (sy - w2 - 0.55) * 0.45, FC + 0.05),
               (sx, sy - 0.3, FC + 0.12), (sx, sy, FC + 0.33), (sx + (tx - sx) * 0.4, sy + (17.3 - sy) * 0.4, FC + 0.14),
               (tx, 17.3 - 0.25, FC + 0.06), (tx, 17.3, FC - 0.3)]
        stud_chain(os_, run, M['black'], d=0.030)
        of.rbox(sx - 0.18, sy - 0.25, FC, sx + 0.18, sy + 0.25, FC + 0.3, M['dark'], r=0.03)
        of.cyl(tx, 17.3, FC + 0.05, 0.22, 0.1, M['dark'], segs=18, bevel=0.02)
    col.box(-1.7, w2 - 0.65, FC, 1.7, w2 + 0.65, FC + 1.2, M['col'])
    # the foremast with the forward floodlight, the bell on its bracket
    of.cyl(0, 20.2, FC + 1.7, 0.11, 3.4, M['white'], segs=14, r2=0.08)
    of.cyl(0, 20.2, FC + 0.1, 0.2, 0.2, M['white'], segs=14, bevel=0.02)
    of.rbox(-0.28, 19.98, FC + 2.75, 0.28, 20.27, FC + 3.1, M['dark'], r=0.03)
    of.box(-0.24, 19.96, FC + 2.79, 0.24, 19.97, FC + 3.06, M['lampcold'])
    of.box(-0.04, 20.0, FC + 2.0, 0.04, 20.5, FC + 2.06, M['dark'])
    bell = [(0.0, 0.0), (0.06, -0.01), (0.09, -0.06), (0.1, -0.14), (0.11, -0.22), (0.15, -0.3), (0.16, -0.33)]
    for k in range(len(bell) - 1):
        (r0, z0_), (r1, z1_) = bell[k], bell[k + 1]
        os_.cyl(0, 20.5, FC + 2.0 + (z0_ + z1_) / 2, max(r0, 0.01), abs(z1_ - z0_), M['brass'], segs=20, r2=max(r1, 0.01), cap=False)
    os_.cyl(0, 20.5, FC + 2.0 - 0.33, 0.16, 0.01, M['brass'], segs=20)
    os_.tube([(0, 20.5, FC + 1.7), (0.02, 20.52, FC + 1.45), (0.0, 20.5, FC + 1.25)], 0.008, M['rope'], 5)
    col.box(-0.2, 20.0, FC, 0.2, 20.4, FC + 3.2, M['col'])
    # ================================================================ outside the deckhouse: lamps, hose boxes, rafts
    x, y0 = DH['x'], DH['y0']
    door_lamp(of, M, 0.75, y0 - T / 2, DECK + 2.25, '-y')
    for s in (1, -1):
        door_lamp(of, M, s * (x + T / 2), 0.95, DECK + 2.25, '+x' if s > 0 else '-x')
    door_lamp(of, M, -(L2['x'] + T / 2), 5.95, L01 + 2.25, '-x')
    hose_box(of, M, 3.85, y0 - T / 2, DECK + 0.45, '-y')
    hose_box(of, M, -(x + T / 2), -3.8, DECK + 0.45, '-x')
    for s in (1, -1):
        for yy in (-6.0, -4.4):
            liferaft(of, M, s * 4.45, yy, L01)
    # ================================================================ the stern flag (the game waves it: FLAG_stern)
    fz = sheer(Y_STERN) + 0.1
    of.cyl(0, Y_STERN + 0.35, fz + 0.05, 0.1, 0.1, M['dark'], segs=12)
    of.cyl(0, Y_STERN + 0.35, fz + 1.3, 0.035, 2.5, M['white'], segs=10, r2=0.025)
    of.sphere(0, Y_STERN + 0.35, fz + 2.57, 0.045, M['brass'], segs=10, rings=6)
    fl = K.Part('FLAG_stern', [M['flag_w']], gcoll)
    nu, nv = 12, 9
    W_, H_ = 1.2, 0.8
    uvl = fl.bm.loops.layers.uv.new('UVMap')
    grid = [[fl.bm.verts.new((0.0, -W_ * i / nu, -H_ * (1 - j / nv))) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            f = fl.bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            # (bottom red, middle blue, top white)
            f.material_index = fl.mi((M['flag_r'], M['flag_b'], M['flag_w'])[j // 3])
            for l in f.loops:
                vv = l.vert.co
                l[uvl].uv = (-vv.y / W_, 1 + vv.z / H_)
    ctx.made['FLAG_stern'] = fl.done(smooth=True)
    ctx.made['FLAG_stern'].location = (0, Y_STERN + 0.32, fz + 2.5)
    return of, os_
