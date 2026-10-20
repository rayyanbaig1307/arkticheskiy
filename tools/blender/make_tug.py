# The Polyarnik (ПОЛЯРНИК): a Russian icebreaking harbour tug, 43 m, built in its own scene and
# exported to tools/blender/raw/tug.glb (tools/pack.mjs compresses it into public/models/).
# Run in Blender through the connector (tools/blender/run.py).
#
# Blender axes: x starboard, y forward (the bow at +y), z up; the waterline is z = 0.
#
#   hull        lofted from stations: a flat bottom with a round bilge, a spoon bow raked at 25
#               degrees under water (she rides up onto the ice and breaks it with her weight), a
#               wide cut-up stern over twin nozzles; flared topsides; bulwarks to the sheer, a red
#               cap rail, rubber fenders; painted and weathered (texlib.hull: the ice belt scraped
#               to primer and rust, rust running from the hawse pipes), the plating in its normals
#   decks       main deck z 2.5 (aft working deck, side walkways), forecastle and 01 deck z 5.0,
#               02 deck / bridge floor z 7.6, bridge roof z 10.3; engine room floor z -1.6
#   level 1     (main deck) mess room and galley aft, the stair hall, a closed cabin forward
#   level 2     (01 deck) closed cabins and the stair lobby; the boat deck aft of it with the
#               funnel and the liferafts; external stairs from the aft deck
#   bridge      (02 deck) big raked windows, the console, the chart table, wings with ladders
#
# The rooms' insides are tug_rooms.py (mess, galley, hall, lobby), tug_bridge.py and
# tug_engine.py; the deck fittings and the towing gear tug_outfit.py; materials tug_mats.py
# (textures: texlib.py); shapes kit.py; the layout and the hull's lines tug_layout.py.
#
# Node names are the game's contract (src/boat/BoatModel.js): COL_, ZONE_, LAD_, LMP_, SPOT_,
# PATH_, INT_<kind>_<id>, SL_*, RADAR_scanner, NEEDLE_*, WINCH_*, ROLLER_*, ROPE_*, FLAG_*,
# BOAT_info.
import bpy, bmesh, math, os, sys
from types import SimpleNamespace
from mathutils import Vector, Matrix
import numpy as np

import importlib
import common as C
importlib.reload(C)
import texlib as X
importlib.reload(X)
import kit as K
importlib.reload(K)
import tug_layout
importlib.reload(tug_layout)
from tug_layout import *
for _m in ('tug_mats', 'tug_rooms', 'tug_bridge', 'tug_engine', 'tug_outfit'):
    if _m in sys.modules: importlib.reload(sys.modules[_m])
import tug_mats, tug_rooms, tug_bridge, tug_engine, tug_outfit

Part, wall = K.Part, K.wall

# ---------------------------------------------------------------- the hull
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
    for j in range(len(rows) - 1):
        for i in range(nz - 1):
            a, b, c, d = rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], rows[j][i + 1]
            try:
                bm.faces.new((a, d, c, b)).material_index = 0
            except ValueError:
                continue
    st = rows[0]
    tv = [bm.verts.new((0.0, Y_STERN, v.co.z)) for v in st]
    for i in range(nz - 1):
        try:
            bm.faces.new((st[i], st[i + 1], tv[i + 1], tv[i])).material_index = 0
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)
    bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], axis='X', merge_dist=0.004)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # uv: along the hull and up it (texlib.hull's layout: 44 x 11 m)
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[uvl].uv = ((co.y - X.HULL_U[0]) / (X.HULL_U[1] - X.HULL_U[0]), (co.z - X.HULL_V[0]) / (X.HULL_V[1] - X.HULL_V[0]))
    o = C.obj_from_bm(bm, 'HULL', None)
    base, nrm, rough, metal = X.hull(half_breadth, sheer)
    imgs = X.to_images('TX_hull', base, nrm, rough, metal)
    hull_m = X.pbr('Hull', (imgs, 44.0), normal_strength=0.8)
    M['hull'] = hull_m
    o.data.materials.append(hull_m)
    o.data.materials.append(M['bulwark'])
    s = o.modifiers.new('plate', 'SOLIDIFY'); s.thickness = 0.08; s.offset = -1; s.material_offset = 1; s.use_even_offset = True
    C.apply_modifiers(o)
    for p in o.data.polygons: p.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(38))
    return o

def section_z(y):
    zk, zt = keel(y), sheer(y)
    under = [zk + (-0.4 - zk) * f for f in (0, .025, .06, .11, .17, .25, .35, .48, .65, .82, 1.0)]
    mid = [-0.2, 0.0, 0.25, 0.5]
    over = [0.5 + (zt - 0.5) * g for g in (.12, .26, .42, .58, .72, .84, .93, 1.0)]
    return [max(z, zk) for z in under + mid + over]

def deck_outline(z, y0, y1, inset=0.1, n=60):
    ys = np.linspace(y0, y1, n)
    stbd = [(max(0.0, half_breadth(y, z) - inset), y) for y in ys]
    port = [(-x, y) for x, y in reversed(stbd)]
    return stbd + port

def hull_text(part, text, size, y_c, z_c, side, m, stern=False):
    """the name laid onto the flared hull: each vertex pushed out to the hull's surface"""
    cu = bpy.data.curves.new('_txt', 'FONT')
    cu.body = text; cu.size = size; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.extrude = 0.012
    ob = bpy.data.objects.new('_txt', cu); bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True); bpy.data.curves.remove(cu)
    verts = [v.co.copy() for v in me.vertices]; faces = [list(p.vertices) for p in me.polygons]
    bpy.data.meshes.remove(me)
    bm = part.bm; idx = part.mi(m)
    nv = []
    for v in verts:
        if stern:
            x = v.x; z = z_c + v.y
            y = Y_STERN - 0.02 - (v.z + 0.012)
        else:
            y = y_c + v.x * side; z = z_c + v.y
            x = side * (half_breadth(y, z) + 0.006 + (v.z + 0.012))
        nv.append(bm.verts.new((x, y, z)))
    for f in faces:
        try:
            fc = bm.faces.new([nv[i] for i in f]); fc.material_index = idx
        except ValueError:
            pass

# ---------------------------------------------------------------- doors
def door(M, gcoll, id_, hinge, yaw_deg, w=0.9, h=DOOR_H, kind='ext', m=None):
    """a door leaf (INT_door_<id>, hinged at its origin, the leaf along +x): a weathertight steel
    door (rounded corners, a port light, dog levers both sides) or a cabin door (wood, a lever)"""
    m = m or (M['white'] if kind == 'ext' else M['wood'])
    d = Part(f'INT_door_{id_}', [m], gcoll)
    if kind == 'ext':
        K.rplate(d, 0.02, 0.0, w - 0.02, h, -0.03, 0.03, m, r=0.12, segs=5)
        for sgn in (-1, 1):
            d.box(0.08, sgn * 0.03, h * 0.5 - 0.02, w - 0.08, sgn * 0.045, h * 0.5 + 0.02, m)
            d.box(0.08, sgn * 0.03, h * 0.18 - 0.02, w - 0.08, sgn * 0.045, h * 0.18 + 0.02, m)
            for zz in (0.35, 1.0, 1.65):
                d.cyl(w - 0.1, sgn * 0.05, zz, 0.022, 0.04, M['steel'], axis='Y', segs=8)
                d.tube([(w - 0.1, sgn * 0.07, zz), (w - 0.1 - 0.12, sgn * 0.08, zz - 0.03)], 0.012, M['steel'], 6)
        d.cyl(w / 2, 0.0, h - 0.42, 0.13, 0.075, M['steel'], axis='Y', segs=20, bevel=0.01)
        d.cyl(w / 2, 0.0, h - 0.42, 0.105, 0.08, M['glass'], axis='Y', segs=20)
    else:
        K.rplate(d, 0.02, 0.0, w - 0.02, h, -0.022, 0.022, m, r=0.015, segs=2)
        for sgn in (-1, 1):
            for (z0, z1) in ((0.18, 0.95), (1.08, 1.85)):
                d.box(0.12, sgn * 0.022, z0, w - 0.12, sgn * 0.028, z0 + 0.03, m)
                d.box(0.12, sgn * 0.022, z1 - 0.03, w - 0.12, sgn * 0.028, z1, m)
                d.box(0.12, sgn * 0.022, z0, 0.15, sgn * 0.028, z1, m)
                d.box(w - 0.15, sgn * 0.022, z0, w - 0.12, sgn * 0.028, z1, m)
            d.box(0.04, sgn * 0.022, 0.02, w - 0.04, sgn * 0.026, 0.16, M['in_steel'])
            d.cyl(w - 0.1, sgn * 0.035, 1.0, 0.025, 0.03, M['in_chrome'], axis='Y', segs=10)
            d.tube([(w - 0.1, sgn * 0.05, 1.0), (w - 0.22, sgn * 0.055, 1.0)], 0.01, M['in_chrome'], 6)
    o_ = d.done(sharp=40); o_.location = hinge; o_.rotation_euler = (0, 0, math.radians(yaw_deg))
    return o_

def door_frame(part, a, b, c, w, h0, m, t=T):
    """a ship's door surround on both faces of a wall (rounded corners) and its low coaming"""
    K.window_frame(part, a, b, c, w, h0 + 0.0, h0 + DOOR_H, m, t=t, depth=0.035, w=0.08, rr=0.12, segs=5)
    L, ux, uy, rz = K.wall_dir(a, b)
    part.boxc(a[0] + ux * c, a[1] + uy * c, h0 + 0.04, w + 0.1, t + 0.06, 0.08, m, rz, bevel=0.01)

def windows(part, gl, a, b, holes, m_frame, m_glass, t=T, rr=0.09, depth=0.05, w=0.075, side=0):
    for (c, wd, h0, h1) in holes:
        K.window_frame(part, a, b, c, wd, h0, h1, m_frame, t=t, depth=depth, w=w, rr=rr, side=side)
        K.glass_rrect(gl, a, b, c, wd, h0, h1, m_glass, rr=rr)

# ---------------------------------------------------------------- the build
def build(root):
    C.set_root(root)
    sc = C.fresh_scene('ASSET_tug')
    M, TX = tug_mats.materials()
    made = {}
    hull = build_hull(M); made['hull'] = hull
    col = Part('COL_boat', [M['col']])
    gcoll = C.collection(sc, 'GAME')
    def E(name, loc, rot=(0, 0, 0), **ex):
        return C.empty(name, loc, gcoll, rot, extras=ex)
    def box_node(name, x0_, y0_, z0_, x1_, y1_, z1_, **ex):
        p = Part(name, [M['col']], gcoll); p.box(x0_, y0_, z0_, x1_, y1_, z1_, M['col'])
        o_ = p.done()
        for k, v in ex.items(): o_[k] = v
        return o_
    extra_parts = []
    ctx = SimpleNamespace(M=M, col=col, parts=extra_parts, E=E, gcoll=gcoll, made=made)

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
    for (z, y0_, y1_) in ((DECK, Y_STERN + 0.1, 8.6), (FC, 8.5, 22.6)):
        ys = np.linspace(y0_, y1_, 44)
        for s in (1, -1):
            for i in range(len(ys) - 1):
                xa = s * (half_breadth(ys[i], z) - 0.09); xb = s * (half_breadth(ys[i + 1], z) - 0.09)
                v = [col.bm.verts.new((xa, ys[i], z)), col.bm.verts.new((xb, ys[i + 1], z)),
                     col.bm.verts.new((xb, ys[i + 1], z + 1.15)), col.bm.verts.new((xa, ys[i], z + 1.15))]
                col.bm.faces.new(v)
    col.box(-5.4, Y_STERN - 0.05, DECK, 5.4, Y_STERN + 0.12, DECK + 1.15, M['col'])

    # the cap rail, the fender belt, the transom fender, bulwark stays, freeing ports, the names
    trim = Part('TRIM', [M['red']])
    ys = np.linspace(Y_STERN + 0.05, 22.85, 120)
    for s in (1, -1):
        pts = [(s * (half_breadth(y, sheer(y) - 0.02) - 0.03), y, sheer(y) + 0.04) for y in ys]
        trim.tube(pts, 0.07, M['red'], 10)
        fys = np.linspace(-19.6, 14.0, 70)
        pts = [(s * (half_breadth(y, 2.15) + 0.1), y, 2.15) for y in fys]
        trim.tube(pts, 0.17, M['rubber'], 12)
    trim.tube([(-5.0, Y_STERN - 0.02, sheer(Y_STERN) + 0.04), (5.0, Y_STERN - 0.02, sheer(Y_STERN) + 0.04)], 0.07, M['red'], 10)
    trim.cyl(0, Y_STERN - 0.45, 2.0, 0.45, 8.6, M['rubber'], axis='X', segs=24)
    for s in (1, -1):
        for y in list(np.arange(-19.0, -7.5, 1.5)) + list(np.arange(10.5, 19.0, 1.5)):
            z = DECK if y < 8 else FC
            x = s * (half_breadth(y, z + 0.5) - 0.1)
            with trim.at(x - s * 0.18, y, z, K.FACE['+x' if s > 0 else '-x']):
                K.rplate(trim, -0.015, 0.0, 0.015, 0.95, -0.18, 0.18, M['bulwark'], r=0.01)
            trim.box(x - s * 0.36, y - 0.06, z, x, y + 0.06, z + 0.012, M['bulwark'])
    for s in (1, -1):
        for y in (-17.5, -14.5, -11.5):
            x = s * (half_breadth(y, DECK + 0.15) + 0.01)
            trim.boxc(x, y, DECK + 0.18, 0.1, 1.1, 0.3, M['black'], bevel=0.04)
    for s in (1, -1):
        hull_text(trim, 'ПОЛЯРНИК', 0.85, 15.6, 4.25, s, M['white'])
    hull_text(trim, 'ПОЛЯРНИК', 0.6, 0, 1.65, 1, M['white'], stern=True)
    hull_text(trim, 'МУРМАНСК', 0.42, 0, 0.95, 1, M['white'], stern=True)
    # hawse pipes and the anchors in their pockets (both bows)
    for s in (1, -1):
        y = 17.6; z = 3.4; x = s * (half_breadth(y, z) + 0.02)
        xp = s * (half_breadth(y, z - 0.7) + 0.005)
        trim.boxc(xp - s * 0.04, y, z - 0.75, 0.1, 1.5, 1.7, M['black'], bevel=0.08, segs=2)
        trim.cyl(x + s * 0.02, y, z + 0.1, 0.24, 0.08, M['dark'], axis='X', segs=18, bevel=0.02)
        trim.boxc(xp + s * 0.06, y, z - 0.35, 0.12, 0.16, 0.9, M['black'], bevel=0.03, segs=2)
        trim.boxc(xp + s * 0.09, y, z - 0.88, 0.2, 1.05, 0.22, M['black'], bevel=0.05, segs=2)
        for d in (-1, 1):
            trim.boxc(xp + s * 0.1, y + d * 0.42, z - 0.62, 0.16, 0.22, 0.42, M['black'], bevel=0.04, segs=2)

    # ================================================================ level 1 (main deck): the walls
    x, y0, y1 = DH['x'], DH['y0'], DH['y1']
    dh = Part('DECKHOUSE', [M['white']])
    gl = Part('GLASS', [M['glass']])
    win1 = (DECK + 1.15, DECK + 1.85)
    aft_holes = [(x, 0.9, DECK, DECK + DOOR_H), (x - 2.6, 0.8, *win1), (x + 2.6, 0.8, *win1)]
    side_holes = [(0.1 - y0, 0.9, DECK, DECK + DOOR_H), (-5.3 - y0, 0.8, *win1), (-2.7 - y0, 0.8, *win1)]
    wall(dh, (-x, y0), (x, y0), DECK, L01 - 0.25, M['white'], holes=aft_holes)
    windows(dh, gl, (-x, y0), (x, y0), aft_holes[1:], M['white'], M['glass'])
    door_frame(dh, (-x, y0), (x, y0), x, 0.9, DECK, M['white'])
    for s in (1, -1):
        a_, b_ = (s * x, y0), (s * x, y1)
        wall(dh, a_, b_, DECK, L01 - 0.25, M['white'], holes=side_holes)
        windows(dh, gl, a_, b_, side_holes[1:], M['white'], M['glass'])
        door_frame(dh, a_, b_, 0.1 - y0, 0.9, DECK, M['white'])
    for (a, b, holes) in (((-x, y0), (x, y0), [(x, 0.9)]),
                          ((x, y0), (x, y1), [(0.1 - y0, 0.9)]), ((-x, y0), (-x, y1), [(0.1 - y0, 0.9)]),
                          ((-x + T, MESS[1]), (x - T, MESS[1]), [(x - T, 0.9)]),
                          ((-x + T, CABIN[0]), (x - T, CABIN[0]), [])):
        wall(col, a, b, DECK, L01, M['col'], holes=[(c, w, DECK - 1, DECK + 2.1) for c, w in holes], t=0.2)

    # ================================================================ the 01 deck, level 2
    top = Part('DECK01', [M['deck']])
    def slab(parts, x0_, y0_, x1_, y1_, z, th=0.25):
        # (a deck's top is deck paint; its underside and its edges, seen from below, are white)
        for p_, m_ in parts:
            fs = p_.box(x0_, y0_, z - th, x1_, y1_, z, m_)
            if m_ is M['deck']:
                wi = p_.mi(M['white'])
                for f in fs:
                    if f.normal.z < 0.5: f.material_index = wi
    both = ((top, M['deck']), (col, M['col']))
    f1 = FLIGHT1
    slab(both, -OVER, y0, OVER, f1['y0'], L01)
    slab(both, -OVER, f1['y0'], f1['x0'], y1, L01)
    slab(both, f1['x1'], f1['y0'], OVER, y1, L01)
    slab(both, f1['x0'], f1['y1'], f1['x1'], y1, L01)
    a = AFT_STAIR
    for s in (1, -1):
        xa, xb = sorted((s * a['x1'], s * OVER))
        slab(both, xa, a['y0'] - 0.1, xb, y0, L01)
    # under the overhang: brackets along the deckhouse sides
    for s in (1, -1):
        for yy in np.arange(y0 + 0.5, y1, 2.0):
            with dh.at(s * (x + 0.06), yy, L01 - 0.25, K.FACE['+x' if s > 0 else '-x']):
                bm_ = dh.bm; mi_ = dh.mi(M['white'])
                pts = [(0.0, 0.0), (0.0, -0.5), (0.06, -0.5), (0.64, -0.04), (0.64, 0.0)]
                fv = [bm_.verts.new(dh.P((-0.025, q[0], q[1]))) for q in pts]
                bv = [bm_.verts.new(dh.P((0.025, q[0], q[1]))) for q in pts]
                try:
                    bm_.faces.new(fv).material_index = mi_; bm_.faces.new(list(reversed(bv))).material_index = mi_
                    for k in range(len(pts)):
                        k1 = (k + 1) % len(pts)
                        bm_.faces.new((fv[k], fv[k1], bv[k1], bv[k])).material_index = mi_
                except ValueError:
                    pass
    # level 2: walls, windows, the lobby door (port), the closed cabins
    l2x, l2y0, l2y1 = L2['x'], L2['y0'], L2['y1']
    win2 = (L01 + 1.1, L01 + 1.8)
    l2 = Part('LEVEL2', [M['white']])
    s_holes = {1: [(-0.5 - l2y0, 0.8, *win2), (3.0 - l2y0, 0.8, *win2), (6.5 - l2y0, 0.8, *win2)],
               -1: [(5.1 - l2y0, 0.9, L01, L01 + DOOR_H), (-0.5 - l2y0, 0.8, *win2), (2.6 - l2y0, 0.8, *win2), (7.0 - l2y0, 0.8, *win2)]}
    for s in (1, -1):
        a_, b_ = (s * l2x, l2y0), (s * l2x, l2y1)
        wall(l2, a_, b_, L01, L02 - 0.25, M['white'], holes=s_holes[s])
        windows(l2, gl, a_, b_, [h for h in s_holes[s] if h[2] > L01], M['white'], M['glass'])
        for h in s_holes[s]:
            if h[2] <= L01: door_frame(l2, a_, b_, h[0], h[1], L01, M['white'])
    fa_holes = [(l2x - 2.0, 0.8, *win2), (l2x + 2.0, 0.8, *win2)]
    wall(l2, (-l2x, l2y0), (l2x, l2y0), L01, L02 - 0.25, M['white'], holes=fa_holes)
    windows(l2, gl, (-l2x, l2y0), (l2x, l2y0), fa_holes, M['white'], M['glass'])
    ff_holes = [(l2x - 1.6, 0.8, *win2), (l2x + 1.6, 0.8, *win2)]
    wall(l2, (-l2x, l2y1), (l2x, l2y1), L01, L02 - 0.25, M['white'], holes=ff_holes)
    windows(l2, gl, (-l2x, l2y1), (l2x, l2y1), ff_holes, M['white'], M['glass'])
    # (the closed cabins' windows show a curtain behind the glass)
    curt = Part('CURTAINS', [M['curtain']])
    for s in (1, -1):
        for c, w, h0, h1 in s_holes[s]:
            if h0 > L01:
                yy = l2y0 + c
                if s < 0 and LOBBY['y0'] < yy < LOBBY['y1']: continue
                curt.box(s * (l2x - 0.12), yy - w / 2, h0, s * (l2x - 0.1), yy + w / 2, h1, M['curtain'])
    for c, w, h0, h1 in fa_holes + ff_holes:
        yy = l2y0 + 0.12 if (c, w, h0, h1) in fa_holes else l2y1 - 0.12
        curt.box(-l2x + c - w / 2, yy - 0.01, h0, -l2x + c + w / 2, yy + 0.01, h1, M['curtain'])
    # the lobby's walls (structure: the cabins' sides of them are never seen)
    lb = LOBBY
    wall(l2, (lb['x1'], lb['y0']), (lb['x1'], lb['y1']), L01, L02 - 0.25, M['wall'])
    wall(l2, (lb['x0'], lb['y0']), (lb['x1'], lb['y0']), L01, L02 - 0.25, M['wall'])
    wall(l2, (lb['x0'], lb['y1']), (lb['x1'], lb['y1']), L01, L02 - 0.25, M['wall'])
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
    f2 = FLIGHT2
    slab(both2, -bxx, l2y0 - 0.1, bxx, f2['y1'], L02)
    slab(both2, -bxx, f2['y1'], f2['x0'], BR['y1'] + 0.3, L02)
    slab(both2, f2['x1'], f2['y1'], bxx, BR['y1'] + 0.3, L02)
    slab(both2, f2['x0'], f2['y0'], f2['x1'], BR['y1'] + 0.3, L02)

    # ================================================================ stairs
    st = Part('STAIRS', [M['steel']])
    K.stairs(st, f1['x0'], f1['x1'], f1['y0'], DECK, f1['y1'], L01, M['steel'], M['yellow'], nosing=M['yellow'])
    K.ramp(col, f1['x0'], f1['x1'], f1['y0'] - 0.12, DECK, f1['y1'] + 0.06, L01)
    K.stairs(st, f2['x0'], f2['x1'], f2['y0'], L01, f2['y1'], L02, M['steel'], M['yellow'], nosing=M['yellow'])
    K.ramp(col, f2['x0'], f2['x1'], f2['y0'] + 0.12, L01, f2['y1'] - 0.06, L02)
    K.stairs(st, sd['x0'], sd['x1'], sd['y0'], DECK, sd['y1'], ER, M['steel'], M['yellow'], nosing=M['yellow'])
    K.ramp(col, sd['x0'], sd['x1'], sd['y0'] - 0.06, DECK, sd['y1'] + 0.12, ER)
    for s in (1, -1):
        xa, xb = s * a['x0'], s * a['x1']
        K.stairs(st, a['y0'], a['y1'], xa, DECK, xb, L01, M['steel'], M['yellow'], along='x', nosing=M['yellow'])
        K.ramp(col, a['y0'], a['y1'], xa - s * 0.12, DECK, xb + s * 0.06, L01, along='x')

    # ================================================================ the bridge: its walls
    bx, by0, by1 = BR['x'], BR['y0'], BR['y1']
    brw = Part('BRIDGE', [M['white']])
    win = (L02 + 1.05, BRC - 0.25)
    rake = math.tan(math.radians(14))
    front = Part('BRIDGE_FRONT', [M['white']])
    fglass = Part('GLASS_FRONT', [M['glass']])
    fh = [(0.62 + i * 1.74, 1.42, *win) for i in range(5)]
    wall(front, (-bx, by1), (bx, by1), L02, BRC + 0.15, M['white'], holes=fh)
    windows(front, fglass, (-bx, by1), (bx, by1), fh, M['black'], M['glass'], rr=0.07, depth=0.03, w=0.06)
    for c in (fh[1][0], fh[3][0]):
        fglass.cyl(-bx + c, by1 + 0.02, (win[0] + win[1]) / 2 + 0.05, 0.3, 0.03, M['dark'], axis='Y', segs=28)
        fglass.cyl(-bx + c, by1 + 0.045, (win[0] + win[1]) / 2 + 0.05, 0.05, 0.05, M['steel'], axis='Y', segs=12)
    # the wipers, parked along the bottom of each front window (outside)
    for c, w_, h0, h1 in fh:
        fglass.tube([(-bx + c - 0.55, by1 + 0.07, h0 + 0.08), (-bx + c + 0.1, by1 + 0.07, h0 + 0.08)], 0.008, M['black'], 4)
        fglass.cyl(-bx + c + 0.12, by1 + 0.07, h0 + 0.08, 0.02, 0.03, M['black'], axis='Y', segs=8)
    for p in (front, fglass):
        for v in p.bm.verts:
            v.co.y += (v.co.z - L02) * rake
    side_h = [(5.3 - by0, 0.9, L02, L02 + DOOR_H), (1.6 - by0, 1.2, *win), (3.2 - by0, 1.2, *win), (6.9 - by0, 1.1, *win)]
    for s in (1, -1):
        a_, b_ = (s * bx, by0), (s * bx, by1)
        wall(brw, a_, b_, L02, BRC + 0.15, M['white'], holes=side_h)
        windows(brw, gl, a_, b_, side_h[1:], M['black'], M['glass'], rr=0.07, depth=0.03, w=0.06)
        door_frame(brw, a_, b_, side_h[0][0], 0.9, L02, M['white'])
    aft_h = [(bx + 1.6, 0.9, L02, L02 + DOOR_H), (bx - 2.6, 1.0, *win), (bx + 3.1, 0.8, *win)]
    wall(brw, (-bx, by0), (bx, by0), L02, BRC + 0.15, M['white'], holes=aft_h)
    windows(brw, gl, (-bx, by0), (bx, by0), aft_h[1:], M['black'], M['glass'], rr=0.07, depth=0.03, w=0.06)
    door_frame(brw, (-bx, by0), (bx, by0), aft_h[0][0], 0.9, L02, M['white'])
    brw.box(-bx - 0.18, by0 - 0.05, BRC + 0.15, bx + 0.18, by1 + (BRC + 0.15 - L02) * rake + 0.35, ROOF, M['white'], bevel=0.03)
    # the visor over the front windows, its stays
    vz = BRC + 0.1
    vy = by1 + (vz - L02) * rake
    brw.box(-bx - 0.1, vy, vz - 0.03, bx + 0.1, vy + 0.55, vz, M['white'])
    for xx in (-3.6, -1.2, 1.2, 3.6):
        brw.tube([(xx, vy + 0.5, vz - 0.03), (xx, vy + 0.02, vz - 0.45)], 0.02, M['white'], 6)
    for (a_, b_, holes) in (((bx, by0), (bx, by1), [(5.3 - by0, 0.9)]), ((-bx, by0), (-bx, by1), [(5.3 - by0, 0.9)]),
                            ((-bx, by0), (bx, by0), [(bx + 1.6, 0.9)])):
        wall(col, a_, b_, L02, BRC, None, holes=[(c, w, L02 - 1, L02 + 2.1) for c, w in holes], t=0.2)
    col.box(-bx, by1 - 0.1, L02, bx, by1 + 0.6, BRC, M['col'])
    col.box(-bx - 0.18, by0 - 0.05, BRC + 0.15, bx + 0.18, by1 + 1.0, ROOF, M['col'])
    # wings with railings (a gap aft where the ladder from the 01 deck arrives)
    rail = Part('RAILINGS', [M['white']])
    for s in (1, -1):
        xa, xb = sorted((s * WING['x0'], s * WING['x1']))
        slab(both2, xa, WING['y0'], xb, WING['y1'], L02, th=0.2)
        xo = s * WING['x1']
        K.railing(rail, [(xo, WING['y0']), (xo, WING['y1']), (s * WING['x0'], WING['y1'])], L02, M['white'])
        K.railing(rail, [(s * 4.98, WING['y0']), (xo, WING['y0'])], L02, M['white'])
        K.rail_col(col, [(xo, WING['y0']), (xo, WING['y1']), (s * WING['x0'], WING['y1'])], L02)
        K.rail_col(col, [(s * 4.98, WING['y0']), (xo, WING['y0'])], L02)
        for yy in (WING['y0'] + 0.3, WING['y1'] - 0.3):
            with brw.at(s * WING['x0'], yy, L02 - 0.2, K.FACE['+x' if s > 0 else '-x']):
                bm_ = brw.bm; mi_ = brw.mi(M['white'])
                pts = [(0.0, 0.0), (0.0, -0.6), (0.08, -0.6), (1.7, -0.04), (1.7, 0.0)]
                fv = [bm_.verts.new(brw.P((-0.03, q[0], q[1]))) for q in pts]
                bv = [bm_.verts.new(brw.P((0.03, q[0], q[1]))) for q in pts]
                try:
                    bm_.faces.new(fv).material_index = mi_; bm_.faces.new(list(reversed(bv))).material_index = mi_
                    for k in range(len(pts)):
                        k1 = (k + 1) % len(pts)
                        bm_.faces.new((fv[k], fv[k1], bv[k1], bv[k])).material_index = mi_
                except ValueError:
                    pass
    for s in (1, -1):
        side = [(s * (OVER - 0.05), 8.4), (s * (OVER - 0.05), a['y0'] - 0.1), (s * a['x1'], a['y0'] - 0.1)]
        K.railing(rail, side, L01, M['white']); K.rail_col(col, side, L01)
    K.railing(rail, [(-a['x1'], y0 + 0.05), (a['x1'], y0 + 0.05)], L01, M['white'])
    K.rail_col(col, [(-a['x1'], y0 + 0.05), (a['x1'], y0 + 0.05)], L01)
    rail02 = [(-bx + 0.05, by0), (-bx + 0.05, l2y0 - 0.05), (1.55, l2y0 - 0.05)]
    rail02b = [(2.45, l2y0 - 0.05), (bx - 0.05, l2y0 - 0.05), (bx - 0.05, by0)]
    for r_ in (rail02, rail02b):
        K.railing(rail, r_, L02, M['white']); K.rail_col(col, r_, L02)
    roof_rail = [(-2.2, by0 - 0.1), (-bx, by0 - 0.1), (-bx, by1), (bx, by1), (bx, by0 - 0.1), (-1.5, by0 - 0.1)]
    K.railing(rail, roof_rail, ROOF, M['white']); K.rail_col(col, roof_rail, ROOF)
    o = FLIGHT2
    r2 = [(o['x0'], o['y1'] + 0.05), (o['x0'], o['y0']), (o['x1'], o['y0']), (o['x1'], o['y1'] + 0.05)]
    K.railing(rail, r2, L02, M['in_chrome'], h=0.95, r=0.02); K.rail_col(col, r2, L02, h=1.0, t=0.08)
    o = sd
    r3 = [(o['x1'], o['y0']), (o['x1'], o['y1']), (o['x0'], o['y1']), (o['x0'], o['y0'])]
    K.railing(rail, r3, DECK, M['yellow'], h=0.95); K.rail_col(col, r3, DECK, h=1.0, t=0.08)
    o = f1
    r4 = [(o['x0'], o['y1']), (o['x0'], o['y0']), (o['x1'], o['y0']), (o['x1'], o['y1'])]
    K.railing(rail, r4, L01, M['in_chrome'], h=0.95, r=0.02); K.rail_col(col, r4, L01, h=1.0, t=0.08)

    # ================================================================ the rooms, the bridge, the engine room, the deck
    tug_rooms.build(ctx)
    tug_bridge.build(ctx)
    tug_engine.build(ctx)
    tug_outfit.build(ctx)

    # ================================================================ funnel, mast
    fn = Part('FUNNEL', [M['white']])
    rings = []
    zf = np.linspace(L01, 11.0, 10)
    for z in zf:
        t = (z - L01) / (11.0 - L01)
        w, d, off = 1.15 - 0.12 * t, 1.45 - 0.2 * t, -5.2 - (z - L01) * 0.2
        ring = []
        for k in range(28):
            ang = 2 * math.pi * k / 28
            cx_, cy_ = math.cos(ang), math.sin(ang)
            px = w * np.sign(cx_) * abs(cx_) ** 0.4; py = off + d * np.sign(cy_) * abs(cy_) ** 0.4
            ring.append(fn.bm.verts.new((px, py, z)))
        rings.append(ring)
    for j in range(len(rings) - 1):
        zc = (zf[j] + zf[j + 1]) / 2
        m = M['black'] if zc > 10.3 else (M['red'] if 8.9 < zc < 9.7 else M['white'])
        for k in range(28):
            f = fn.bm.faces.new((rings[j][k], rings[j][(k + 1) % 28], rings[j + 1][(k + 1) % 28], rings[j + 1][k]))
            f.material_index = fn.mi(m)
    # the top: a rim, the grating, two exhaust pipes standing out of it
    top_ring = rings[-1]
    inner = [fn.bm.verts.new((v.co.x * 0.9, -5.2 - (11.0 - L01) * 0.2 + (v.co.y + 5.2 + (11.0 - L01) * 0.2) * 0.9, 10.92)) for v in top_ring]
    for k in range(28):
        fn.bm.faces.new((top_ring[k], top_ring[(k + 1) % 28], inner[(k + 1) % 28], inner[k])).material_index = fn.mi(M['black'])
    fn.bm.faces.new(inner).material_index = fn.mi(M['black'])
    for s in (1, -1):
        fn.cyl(s * 0.4, -6.4, 11.25, 0.18, 1.0, M['black'], segs=16)
        fn.cyl(s * 0.4, -6.4, 11.78, 0.2, 0.06, M['black'], segs=16)
    # the company's mark on both sides: a white disc and a red star
    for s in (1, -1):
        with fn.at(s * 1.12, -5.95, 8.2, K.FACE['+x' if s > 0 else '-x']):
            fn.cyl(0, 0.0, 0, 0.42, 0.02, M['blue'], axis='Y', segs=28)
            star = []
            for k in range(10):
                a_ = math.pi / 2 + k * math.pi / 5
                rr_ = 0.3 if k % 2 == 0 else 0.12
                star.append((math.cos(a_) * rr_, math.sin(a_) * rr_))
            vs = [fn.bm.verts.new(fn.P((px, 0.012, pz))) for px, pz in star]
            ctr = fn.bm.verts.new(fn.P((0, 0.012, 0)))
            for k in range(10):
                fn.bm.faces.new((ctr, vs[k], vs[(k + 1) % 10])).material_index = fn.mi(M['red'])
    col.box(-1.15, -6.7, L01, 1.15, -3.75, 11.0, M['col'])
    mast = Part('MAST', [M['white']])
    mx, my = 0.0, 4.6
    mast.cyl(mx, my, ROOF + 2.0, 0.15, 4.0, M['white'], segs=16, r2=0.1)
    mast.box(mx - 1.4, my - 0.08, ROOF + 2.9, mx + 1.4, my + 0.08, ROOF + 3.0, M['white'], bevel=0.02)
    mast.box(mx - 0.9, my - 0.6, ROOF + 3.5, mx + 0.9, my + 0.6, ROOF + 3.6, M['grey'], bevel=0.02)
    K.railing(mast, [(mx - 0.88, my - 0.58), (mx + 0.88, my - 0.58), (mx + 0.88, my + 0.58), (mx - 0.88, my + 0.58), (mx - 0.88, my - 0.58)], ROOF + 3.6, M['white'], h=0.5, post=0.9, r=0.015)
    K.ladder_rungs(mast, mx, my - 0.2, ROOF, ROOF + 3.5, M['white'], w=0.36)
    mast.cyl(mx, my, ROOF + 4.35, 0.05, 0.4, M['white'], segs=8)
    mast.cyl(mx, my + 0.1, ROOF + 4.6, 0.07, 0.12, M['navwhite'], segs=12)
    for s in (1, -1):
        mast.cyl(mx + s * 1.3, my, ROOF + 3.4, 0.012, 1.4, M['dark'], segs=4)
        mast.cyl(mx + s * 0.6, my, ROOF + 3.3, 0.07, 0.6, M['white'], segs=10)
        mast.sphere(mx + s * 0.6, my, ROOF + 3.62, 0.09, M['white'], segs=12, rings=6)
        for k in range(3):
            mast.cyl(mx + s * (0.4 + k * 0.4), my - 0.08, ROOF + 2.78, 0.04, 0.18, M['navwhite'] if k == 1 else M['dark'], segs=8)
    for s, m in ((1, M['navgreen']), (-1, M['navred'])):
        mast.rbox(s * (WING['x1'] - 0.18), WING['y1'] - 0.28, L02 + 1.05, s * (WING['x1'] - 0.0), WING['y1'] - 0.02, L02 + 1.4, M['black'], r=0.01)
        mast.box(s * (WING['x1'] - 0.15), WING['y1'] - 0.25, L02 + 1.1, s * (WING['x1'] + 0.005), WING['y1'] - 0.05, L02 + 1.35, m)
    mast.box(-0.1, Y_STERN + 0.2, sheer(Y_STERN) + 0.5, 0.1, Y_STERN + 0.35, sheer(Y_STERN) + 0.7, M['navwhite'])
    # the magnetic compass on the bridge roof
    mast.cyl(1.6, 6.2, ROOF + 0.6, 0.14, 1.2, M['white'], segs=16, r2=0.11)
    mast.sphere(1.6, 6.2, ROOF + 1.28, 0.2, M['brass'], segs=16, rings=8, sz=0.6)
    for s in (1, -1):
        mast.sphere(1.6 + s * 0.3, 6.2, ROOF + 1.0, 0.09, M['red'] if s > 0 else M['blue'], segs=12, rings=8)

    # ================================================================ lifebuoys (beside the doors, on the rails)
    gear = Part('GEAR', [M['white']])
    def lifebuoy(cx, cy, cz, axis):
        a_ = 'Y' if axis == 'y' else 'X'
        for k in range(4):
            gear.torus(cx, cy, cz, 0.3, 0.068, M['orange'] if k % 2 == 0 else M['white'], axis=a_, segs=24, rsegs=10, arc=math.pi / 2, a0=k * math.pi / 2)
        # its bracket and the light line looped round it
        if axis == 'y':
            gear.box(cx - 0.05, cy - 0.06, cz + 0.28, cx + 0.05, cy + 0.06, cz + 0.42, M['dark'])
        else:
            gear.box(cx - 0.06, cy - 0.05, cz + 0.28, cx + 0.06, cy + 0.05, cz + 0.42, M['dark'])
    for (cx_, cy_, cz_, ax) in ((OVER - 0.02, -1.5, L01 + 0.7, 'x'), (-OVER + 0.02, -1.5, L01 + 0.7, 'x'),
                                 (WING['x1'] + 0.02, 5.3, L02 + 0.7, 'x'), (-WING['x1'] - 0.02, 5.3, L02 + 0.7, 'x'),
                                 (1.38, y0 - T / 2 - 0.1, DECK + 1.5, 'y')):
        lifebuoy(cx_, cy_, cz_, ax)

    # ================================================================ the game's nodes
    lb = LOBBY
    box_node('ZONE_mess', -x + T, MESS[0] + T, DECK, x - T, MESS[1], L01 - 0.25)
    box_node('ZONE_hall', -x + T, HALL[0], DECK, x - T, HALL[1], L01 - 0.25)
    box_node('ZONE_cabin', -x + T, CABIN[0], DECK, x - T, CABIN[1], L01 - 0.25)
    box_node('ZONE_lobby', lb['x0'], lb['y0'], L01, lb['x1'], lb['y1'], L02 - 0.25)
    box_node('ZONE_bridge', -bx + T, by0 + T, L02, bx - T, by1, BRC)
    box_node('ZONE_engine', -ERM['x'], ERM['y0'], ER, ERM['x'], ERM['y1'], DECK - 0.25)
    box_node('ZONE_engine_stair', sd['x0'], sd['y0'] + 1.0, ER, sd['x1'], sd['y1'], DECK - 0.25)
    lad = Part('LADDERS', [M['steel']])
    for s, nm in ((1, 'wingstbd'), (-1, 'wingport')):
        xa = s * 4.62
        box_node('LAD_' + nm, xa - 0.35, WING['y0'] - 0.55, L01, xa + 0.35, WING['y0'] + 0.02, L02 + 1.0, face=0)
        K.ladder_rungs(lad, xa, WING['y0'] - 0.06, L01, L02 + 1.0, M['steel'])
    box_node('LAD_deck02', 1.6, l2y0 - 0.5, L01, 2.4, l2y0 - 0.1, L02 + 1.0, face=0)
    K.ladder_rungs(lad, 2.0, l2y0 - 0.2, L01, L02 + 1.0, M['steel'])
    box_node('LAD_roof', -2.25, by0 - 0.55, L02, -1.45, by0 - 0.04, ROOF + 1.0, face=0)
    K.ladder_rungs(lad, -1.85, by0 - 0.12, L02, ROOF + 1.0, M['steel'])

    # lamps (extras: colour, power in candela, range in metres, group: what switches it)
    E('LMP_mess_1', (0, -5.0, CEIL1 - 0.14), color=[1.0, 0.8, 0.58], power=9, range=7, group='rooms')
    E('LMP_mess_2', (0, -2.2, CEIL1 - 0.14), color=[1.0, 0.8, 0.58], power=9, range=7, group='rooms')
    E('LMP_hall_1', (0, 2.6, CEIL1 - 0.14), color=[1.0, 0.82, 0.62], power=7, range=6, group='rooms')
    E('LMP_lobby_1', (-1.9, 3.0, CEIL2 - 0.14), color=[1.0, 0.82, 0.62], power=5, range=5, group='rooms')
    E('LMP_bridge_1', (3.2, 1.65, BRC - 0.18), color=[1.0, 0.62, 0.32], power=4, range=5, group='rooms')
    E('LMP_bridge_2', (0, 5.4, BRC - 0.12), color=[1.0, 0.16, 0.08], power=1.2, range=5, group='bridge')
    E('LMP_bridge_3', (-2.6, 7.0, L02 + 1.15), color=[0.45, 0.85, 1.0], power=0.6, range=2.2, group='bridge')
    for i, yy in enumerate((-10, -5.5, -1, 3.5)):
        E(f'LMP_engine_{i + 1}', (0, yy, DECK - 0.3 - 0.34), color=[0.86, 0.93, 1.0], power=12, range=9, group='engine')
    E('LMP_deck_1', (1.6, y0 - 0.25, L01 + 1.25), color=[0.9, 0.95, 1.0], power=55, range=18, group='deck')
    E('LMP_deck_2', (-1.6, y0 - 0.25, L01 + 1.25), color=[0.9, 0.95, 1.0], power=55, range=18, group='deck')
    E('LMP_fore_1', (0, 19.85, FC + 2.9), color=[0.9, 0.95, 1.0], power=60, range=20, group='deck')
    # the deck floodlights (aft, on the 01 deck rail): housings and lenses
    fit = Part('FITTINGS', [M['lampcold']])
    for s in (1, -1):
        with fit.at(s * 1.6, y0 + 0.05, L01 + 1.25, K.FACE['-y']):
            fit.rbox(-0.25, 0.0, -0.17, 0.25, 0.24, 0.17, M['dark'], r=0.03, segs=2)
            fit.box(-0.21, 0.24, -0.13, 0.21, 0.25, 0.13, M['lampcold'])
            for k in range(4):
                fit.box(-0.22, 0.25, -0.12 + k * 0.08, 0.22, 0.26, -0.11 + k * 0.08, M['dark'])
            fit.box(-0.03, -0.1, -0.25, 0.03, 0.05, -0.17, M['dark'])

    # spots: the empty's +y is where you face
    def rotz(deg): return (0, 0, math.radians(deg))
    E('SPOT_spawn', (5.3, 4.5, L02), rotz(-20))
    E('SPOT_wheel', (0, 6.45, L02), rotz(0))
    E('SPOT_searchlight', (2.25, 7.0, L02), rotz(0))
    E('SPOT_radar', (-1.4, 7.0, L02), rotz(0))
    E('SPOT_captain', (-0.9, 5.4, L02), rotz(15))
    E('SPOT_lookout', (-5.3, 5.6, L02), rotz(35))
    E('SPOT_bosun', (-3.85, WINCH_Y - 0.5, DECK), rotz(-90))
    E('SPOT_bosun2', (1.5, -17.4, DECK), rotz(180))
    E('SPOT_cook', (-3.05, -4.3, DECK), rotz(90))
    E('SPOT_cook2', (-0.0, -6.3, DECK), rotz(0))
    E('SPOT_engineer', (-1.6, 5.9, ER), rotz(0))
    E('SPOT_engineer2', (0.0, -6.0, ER), rotz(90))
    E('SPOT_guard_bow', (0.0, 17.5, FC), rotz(0))
    E('SPOT_guard_aft', (-3.0, -15.6, DECK), rotz(180))
    E('SPOT_guard_boat', (3.0, -6.4, L01), rotz(150))
    E('SPOT_kettle', (-3.78, -4.57, DECK + 0.935))
    # patrol paths (the game routes between their points round everything aboard)
    for i, (px, py) in enumerate([(4.0, -8.6), (4.95, -6.5), (4.95, 6.0), (4.95, -6.5), (4.2, -11.5), (3.0, -15.5), (0.0, -17.6), (-3.0, -15.5), (-4.2, -11.5), (-4.95, -6.5), (-4.95, 6.0), (-4.95, -6.5), (-4.0, -8.6)]):
        E(f'PATH_deck_{i}', (px, py, DECK))
    for i, (px, py, pz) in enumerate([(-4.25, 7.0, L01), (-4.25, -2.0, L01), (-3.5, -3.35, L01), (3.5, -3.35, L01), (4.25, -2.0, L01), (4.25, 7.0, L01), (2.6, 9.8, FC), (2.2, 16.0, FC), (-2.2, 16.0, FC), (-2.6, 9.8, FC)]):
        E(f'PATH_patrol_{i}', (px, py, pz))

    # ================================================================ interactables
    wheel = Part('INT_wheel_helm', [M['wood']], gcoll)
    wheel.torus(0, 0, 0, 0.42, 0.028, M['wood'], axis='Y', segs=40, rsegs=10)
    wheel.torus(0, 0, 0, 0.2, 0.018, M['in_brass'], axis='Y', segs=28, rsegs=8)
    for k in range(8):
        t = k * math.pi / 4
        with wheel.at(0, 0, 0, ry=t):
            wheel.cyl(0, 0, 0.24, 0.016, 0.38, M['wood'], segs=10, r2=0.019)
            for (z0_, z1_, r0_, r1_) in ((0.45, 0.48, 0.02, 0.026), (0.48, 0.53, 0.026, 0.022), (0.53, 0.57, 0.022, 0.028), (0.57, 0.6, 0.028, 0.016)):
                wheel.cyl(0, 0, (z0_ + z1_) / 2, r0_, z1_ - z0_, M['wood'], segs=10, r2=r1_, cap=False)
            wheel.sphere(0, 0, 0.6, 0.018, M['wood'], segs=10, rings=6)
    wheel.cyl(0, 0, 0, 0.075, 0.14, M['in_brass'], axis='Y', segs=18, bevel=0.01)
    wheel.cyl(0, -0.08, 0, 0.04, 0.03, M['in_brass'], axis='Y', segs=14)
    wo = wheel.done(smooth=True); wo.location = (0, 6.82, L02 + 1.18)
    th = Part('INT_throttle_main', [M['in_chrome']], gcoll)
    th.cyl(0, 0, 0.15, 0.018, 0.3, M['in_chrome'], segs=10)
    th.cyl(0, 0, 0.32, 0.045, 0.14, M['in_black'], axis='X', segs=14, bevel=0.01)
    th.cyl(0, 0, 0.0, 0.05, 0.05, M['in_dark'], axis='X', segs=14)
    tho = th.done(smooth=True); tho.location = (1.2, 7.7, L02 + 1.0)
    hb = Part('INT_horn_button', [M['red']], gcoll); hb.cyl(0, 0, 0, 0.045, 0.05, M['red'], segs=16, bevel=0.01); hbo = hb.done(smooth=True); hbo.location = (0.55, 7.68, L02 + 1.02)
    js = Part('INT_searchlight_ctrl', [M['black']], gcoll)
    js.cyl(0, 0, 0.0, 0.07, 0.04, M['grey'], segs=14, bevel=0.008)
    js.cyl(0, 0, 0.05, 0.05, 0.03, M['in_rubber'], segs=12, r2=0.02)
    js.cyl(0, 0, 0.1, 0.016, 0.16, M['in_chrome'], segs=10)
    js.cyl(0, 0, 0.2, 0.032, 0.09, M['black'], segs=12, bevel=0.01)
    js.cyl(0, 0.02, 0.23, 0.012, 0.012, M['red'], axis='Y', segs=8)
    jso = js.done(smooth=True); jso.location = (2.25, 7.68, L02 + 1.03)
    rd = Part('INT_radio_bridge', [M['in_dark']], gcoll)
    rd.rbox(-0.24, -0.13, 0, 0.24, 0.13, 0.16, M['in_dark'], r=0.012)
    rd.box(-0.2, -0.135, 0.03, 0.05, -0.13, 0.12, M['screen3'])
    for k in range(3):
        rd.cyl(0.09 + k * 0.05, -0.14, 0.08, 0.015, 0.02, M['in_black'], axis='Y', segs=10)
    rdo = rd.done(sharp=40); rdo.location = (-2.65, 7.8, L02 + 1.05)
    rad = Part('INT_radar_main', [M['screen']], gcoll)
    rad.box(-0.3, -0.015, -0.27, 0.3, 0.015, 0.27, M['screen'])
    rado = rad.done(); rado.location = (-1.4, 7.93, L02 + 1.4); rado.rotation_euler = (math.radians(-15), 0, 0)
    kt = Part('INT_kettle_mess', [M['enamel']], gcoll)
    kt.cyl(0, 0, 0.1, 0.11, 0.2, M['enamel'], segs=20, r2=0.075, bevel=0.01)
    kt.cyl(0, 0, 0.215, 0.05, 0.03, M['black'], segs=12, bevel=0.005)
    kt.tube([(0, -0.09, 0.06), (0, -0.16, 0.15), (0, -0.2, 0.2)], 0.014, M['enamel'], 8)
    kt.tube([(0.0, 0.07, 0.2), (0.0, 0.0, 0.3), (0.0, -0.07, 0.2)], 0.008, M['black'], 6)
    kto = kt.done(smooth=True); kto.location = (-3.78, -4.57, DECK + 0.935)
    mr = Part('INT_radio_mess', [M['wood']], gcoll)
    mr.rbox(-0.21, -0.1, 0, 0.21, 0.1, 0.25, M['wood'], r=0.015)
    mr.cyl(-0.08, -0.105, 0.12, 0.07, 0.01, M['in_black'], axis='Y', segs=16)
    mr.box(0.02, -0.105, 0.14, 0.17, -0.1, 0.2, M['screen3'])
    for k in range(2):
        mr.cyl(0.06 + k * 0.08, -0.11, 0.07, 0.016, 0.02, M['in_black'], axis='Y', segs=10)
    mro = mr.done(sharp=40); mro.location = (3.4, MESS[1] - 0.07 - 0.12, DECK + 1.305)
    for i, nm in enumerate(('engine', 'deck', 'rooms')):
        sw = Part(f'INT_switch_{nm}', [M['in_black']], gcoll)
        sw.rbox(-0.05, -0.03, -0.08, 0.05, 0.03, 0.08, M['in_black'], r=0.008)
        sw.rbox(-0.015, -0.07, -0.01, 0.015, -0.03, 0.06, M['in_chrome'], r=0.006)
        swo = sw.done(sharp=40); swo.location = (-3.0 + i * 0.45, 7.15, ER + 1.4)
    eb = Part('INT_engine_main', [M['in_red']], gcoll)
    eb.cyl(0, 0, 0, 0.065, 0.06, M['red'], axis='Y', segs=18, bevel=0.01)
    eb.cyl(0, 0.03, 0, 0.09, 0.02, M['yellow'], axis='Y', segs=18)
    ebo = eb.done(smooth=True); ebo.location = (-0.6, 7.16, ER + 1.4)
    for i, nm in enumerate(('rpm', 'oil', 'temp', 'volt')):
        gx = -3.0 + i * 0.75
        nd = Part(f'NEEDLE_{nm}', [M['red']], gcoll); nd.box(-0.006, -0.008, -0.02, 0.006, 0.0, 0.1, M['red'])
        ndo = nd.done(); ndo.location = (gx, 7.155, ER + 1.85)
    # the bridge's own rpm gauge on the console, its needle
    cg = Part('CONSOLE_GAUGE', [M['in_black']])
    cg.box(-0.15, 7.94, L02 + 1.05, 0.15, 8.06, L02 + 1.36, M['in_dark'])
    K.gauge(cg, 0.0, 7.94, L02 + 1.2, '-y', 0.12, M['in_black'], M['dial'], None, None)
    extra_parts.append(cg)
    nd = Part('NEEDLE_bridge', [M['red']], gcoll); nd.box(-0.005, -0.008, -0.015, 0.005, 0.0, 0.085, M['red']); ndo = nd.done(); ndo.location = (0.0, 7.895, L02 + 1.2)

    door(M, gcoll, 'messaft', (-0.45, y0, DECK), 0)
    door(M, gcoll, 'mess', (-0.45, MESS[1], DECK), 0, kind='int')
    door(M, gcoll, 'hallstbd', (x, 0.1 - 0.45, DECK), 90)
    door(M, gcoll, 'hallport', (-x, 0.1 + 0.45, DECK), -90)
    door(M, gcoll, 'cabin', (-1.2 - 0.4, CABIN[0], DECK), 0, w=0.8, kind='int')
    door(M, gcoll, 'lobby', (-l2x, 5.1 + 0.45, L01), -90)
    door(M, gcoll, 'bridgeaft', (1.6 - 0.45, by0, L02), 0)
    door(M, gcoll, 'wingstbd', (bx, 5.3 - 0.45, L02), 90)
    door(M, gcoll, 'wingport', (-bx, 5.3 + 0.45, L02), -90)

    # the searchlight on the bridge roof (front centre): yaw pedestal, pitch head, lamp
    sly = E('SL_yaw', (0, 8.0, ROOF))
    base = Part('SL_base', [M['dark']], gcoll)
    base.cyl(0, 0, 0.3, 0.1, 0.6, M['dark'], segs=14); base.cyl(0, 0, 0.05, 0.22, 0.1, M['dark'], segs=18, bevel=0.01)
    for s in (1, -1): base.rbox(s * 0.26 - 0.025, -0.06, 0.45, s * 0.26 + 0.025, 0.06, 0.85, M['dark'], r=0.01)
    pbo = base.done(sharp=40); pbo.parent = sly
    slp = E('SL_pitch', (0, 0, 0.75)); slp.parent = sly
    head = Part('SL_head', [M['dark']], gcoll)
    head.cyl(0, 0.0, 0, 0.23, 0.55, M['dark'], axis='Y', segs=28)
    head.cyl(0, 0.28, 0, 0.245, 0.04, M['chrome'], axis='Y', segs=28)
    head.cyl(0, 0.29, 0, 0.21, 0.02, M['lampcold'], axis='Y', segs=28)
    head.cyl(0, -0.32, 0, 0.16, 0.12, M['dark'], axis='Y', segs=18)
    for k in range(6):
        head.cyl(0, -0.15 + k * 0.06, 0, 0.24, 0.012, M['dark'], axis='Y', segs=28)
    head.tube([(-0.18, -0.1, 0.24), (-0.18, 0.0, 0.32), (0.18, 0.0, 0.32), (0.18, -0.1, 0.24)], 0.012, M['dark'], 6)
    ho = head.done(smooth=True); ho.parent = slp
    sll = E('SL_lamp', (0, 0.32, 0)); sll.parent = slp
    rs = Part('RADAR_scanner', [M['white']], gcoll)
    rs.rbox(-1.2, -0.1, 0.06, 1.2, 0.1, 0.24, M['white'], r=0.04, segs=2)
    rs.cyl(0, 0, 0, 0.09, 0.12, M['dark'], segs=14)
    rso = rs.done(sharp=40); rso.location = (mx, my, ROOF + 3.62)
    hn = Part('HORN', [M['steel']])
    for s in (1, -1):
        hn.cyl(s * 0.2, my + 0.45, ROOF + 2.2, 0.05, 0.7, M['steel'], axis='Y', segs=16, r2=0.15)
        hn.cyl(s * 0.2, my + 0.1, ROOF + 2.2, 0.06, 0.12, M['dark'], axis='Y', segs=12)
    hn.box(-0.3, my - 0.02, ROOF + 2.1, 0.3, my + 0.12, ROOF + 2.14, M['dark'])
    E('SPOT_horn', (0, my + 0.8, ROOF + 2.2))

    # ---- finish
    parts = [main, trim, dh, top, top2, l2, curt, st, brw, front, fglass, gl, rail, fn, mast, gear, lad, hn, fit] + extra_parts
    for p in parts:
        if len(p.bm.verts):
            made[p.name] = p.done(sharp=40)
        else:
            p.bm.free()
    made['col'] = col.done()
    zs = list(np.linspace(-Y_BOW_WL, -Y_STERN, 24))
    hb_ = [round(max(0.0, half_breadth(-z, 0.0)), 3) for z in zs]
    E('BOAT_info', (0, 0, 0), hull=hb_, hullZ=[round(zs[0], 3), round(zs[-1], 3)])
    # the material families into vertex colours (a few materials to draw instead of ninety)
    tug_mats.apply_families([o for o in sc.objects if o.type == 'MESH' and not o.name.startswith(('COL_', 'ZONE_', 'LAD_'))])
    return sc, made

def report(sc):
    objs = [o for o in sc.objects if o.type == 'MESH']
    tot = sum(C.tris(o) for o in objs if not o.name.startswith(('COL_', 'ZONE_', 'LAD_')))
    per = sorted(((o.name, C.tris(o)) for o in objs if not o.name.startswith(('COL_', 'ZONE_', 'LAD_'))), key=lambda t: -t[1])[:14]
    mats = sorted({m.name for o in objs for m in o.data.materials if m})
    return {'tris_visible': tot, 'objects': len(objs), 'col_tris': C.tris(sc.objects['COL_boat']), 'biggest': per, 'materials': len(mats)}

def export(sc):
    path = os.path.join(C.raw_dir(), 'tug.glb')
    size = C.export_glb(sc, path, vcolors=True)
    return path, size

if __name__ == '__main__' or True:
    ROOT_ = globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy')
    sc, made = build(ROOT_)
    result = report(sc)
    if globals().get('EXPORT', True):
        result['export'] = export(sc)
