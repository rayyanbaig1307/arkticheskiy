# Station Severny (СТАНЦИЯ СЕВЕРНЫЙ): a polar station on the fast ice, the Polyarnik's
# destination. Built in its own scene, exported to tools/blender/raw/station.glb.
#
# Station frame (Blender): x along the ice edge, y inland (the open water at y < 0), z up; the
# sea at z = 0. The shelf: fast ice 640 x 360 m, its edge 0.6 m above the water (2.5 m of it
# under), snow drifting deeper inland, a straight berth 120 m long in the middle of the edge with
# a trampled path to the station 80 m in: the main house, three huts on sled runners, the radio
# mast with its beacon, fuel tanks and drums, the weather mast, the flag, lamp posts along the
# path, crates and a tracked carrier at the berth, two ice anchors for the mooring lines, the
# gangway (shown when she is moored).
#
# Nodes for the game (src/world/Station.js): BERTH (where the tug lies: its +y is her bow), COL_*
# (collision: the shelf's surface and the buildings), COL_gangway, GANGWAY, ANCHOR_bow /
# ANCHOR_stern (the mooring lines' ends), LMP_<n> (lamps), BEACON, SPOT_chief, FLAG_station.
# The ice's vertex colours follow the bergs': r snow, g cracks, b cavity (world/IceMaterial.js).
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector, Matrix

import importlib, sys
import common as C
importlib.reload(C)
import texlib as X
importlib.reload(X)
import kit as K
importlib.reload(K)

W_HALF, DEPTH = 320.0, 360.0
FREEBOARD, DRAFT = 0.6, 2.5
BERTH_HALF = 60.0

def rng(seed): return np.random.default_rng(seed)

_GRIDS = {}
def vnoise(x, y, seed, scale):
    """smooth value noise (scalar): a random lattice, smoothly blended"""
    g = _GRIDS.get(seed)
    if g is None:
        g = _GRIDS[seed] = np.random.default_rng(seed).random((64, 64))
    fx, fy = x / scale, y / scale
    ix, iy = math.floor(fx), math.floor(fy)
    tx, ty = fx - ix, fy - iy
    sx, sy = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = g[ix % 64, iy % 64]; b = g[(ix + 1) % 64, iy % 64]
    c = g[ix % 64, (iy + 1) % 64]; d = g[(ix + 1) % 64, (iy + 1) % 64]
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy

def fbm2(x, y, seed, scale, oct=3):
    v, a, t = 0.0, 1.0, 0.0
    for i in range(oct):
        v += vnoise(x, y, seed + i * 17, scale / (2 ** i)) * a; t += a; a *= 0.5
    return v / t

def edge_y(x):
    """the ice edge's line: straight along the berth, ragged elsewhere"""
    k = min(1.0, max(0.0, (abs(x) - BERTH_HALF) / 40.0))
    k = k * k * (3 - 2 * k)
    return k * ((fbm2(x, 0.0, 3, 60.0) - 0.5) * 26.0 + (fbm2(x, 7.0, 4, 12.0) - 0.5) * 5.0)

def top_z(x, y):
    """the snow surface: low at the edge, drifted deeper inland, flattened round the station"""
    d = y - edge_y(x)
    z = FREEBOARD + 0.35 * K.smoothstep(0.0, 25.0, d)
    z += (fbm2(x, y, 11, 40.0, 3) - 0.45) * 1.4 * K.smoothstep(8.0, 70.0, d)
    z += (fbm2(x * 0.6, y * 2.2, 12, 9.0, 2) - 0.5) * 0.35 * K.smoothstep(4.0, 30.0, d)      # sastrugi
    # the station's pad and the path
    pad = K.smoothstep(55.0, 45.0, max(abs(x) * 0.8, abs(y - 88.0)))
    path = K.smoothstep(3.5, 2.0, abs(x)) * K.smoothstep(95.0, 70.0, y)
    flat = max(pad, path)
    z = z * (1 - flat) + (FREEBOARD + 0.42 + (fbm2(x, y, 13, 6.0, 1) - 0.5) * 0.06) * flat
    return z, path, pad

def build_shelf(M):
    """the fast ice: the top (a grid clipped to the ragged edge), the edge's face down into the
    water with its wave-cut notch; vertex colours for the ice shader"""
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col')
    STEP = 4.0
    xs = np.arange(-W_HALF, W_HALF + 0.01, STEP)
    ys_n = int(DEPTH / STEP)
    rows = []                 # rows[i] = column of verts for x = xs[i], from the edge inland
    tops = []
    r = rng(5)
    for x in xs:
        e = edge_y(x)
        col_v = []
        col_t = []
        for j in range(ys_n + 1):
            t = j / ys_n
            y = e + (DEPTH - e) * (t ** 1.35)            # (denser near the edge)
            z, path, pad = top_z(x, y)
            col_v.append(bm.verts.new((x, y, z)))
            snow = 1.0 - 0.45 * K.smoothstep(4.0, 0.0, y - e)
            cav = 0.18 * path + (0.1 if pad > 0.5 else 0.0)
            col_t.append((snow, 0.15 * r.random() if y - e < 6 else 0.0, cav))
        rows.append(col_v); tops.append(col_t)
    def face(vs, cs):
        try:
            f = bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = 0
        for l, c in zip(f.loops, cs):
            l[col] = (*c, 1.0)
        return f
    for i in range(len(xs) - 1):
        for j in range(ys_n):
            a, b, c, d = rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]
            face((a, d, c, b), (tops[i][j], tops[i][j + 1], tops[i + 1][j + 1], tops[i + 1][j]))
    # the edge's face: from the snow lip down through the waterline notch to the ice's foot
    prof = [(0.0, 0.0), (0.0, -0.25), (0.15, -0.55), (0.55, -0.85), (0.35, -1.15), (0.0, -1.6), (-0.4, -2.2), (-0.6, -FREEBOARD - DRAFT)]
    edge_rows = []
    for i, x in enumerate(xs):
        v0 = rows[i][0]
        z0 = v0.co.z
        ring = [v0]
        for (inset, dz) in prof[1:]:
            ring.append(bm.verts.new((x, v0.co.y + inset + (r.random() - 0.5) * 0.15, z0 + dz if dz > -1 else dz + FREEBOARD)))
        edge_rows.append(ring)
    for i in range(len(xs) - 1):
        for k in range(len(prof) - 1):
            a, b = edge_rows[i][k], edge_rows[i + 1][k]
            c, d = edge_rows[i + 1][k + 1], edge_rows[i][k + 1]
            notch = 1.0 if 2 <= k <= 4 else 0.0
            cs = [(0.25 if k == 0 else 0.0, 0.25 + 0.3 * notch, 0.5 * notch)] * 4
            face((a, b, c, d), cs)
    # the far sides: plain cliffs (nobody gets there; they close the shape for the reflection)
    for (i0, side) in ((0, -1), (len(xs) - 1, 1)):
        for j in range(ys_n):
            a, b = rows[i0][j], rows[i0][j + 1]
            c = bm.verts.new((b.co.x + side * 0.3, b.co.y, -DRAFT)); d = bm.verts.new((a.co.x + side * 0.3, a.co.y, -DRAFT))
            face((a, b, c, d) if side < 0 else (b, a, d, c), [(0.2, 0.2, 0.1)] * 4)
    for i in range(len(xs) - 1):
        a, b = rows[i][-1], rows[i + 1][-1]
        c = bm.verts.new((b.co.x, b.co.y + 0.3, -DRAFT)); d = bm.verts.new((a.co.x, a.co.y + 0.3, -DRAFT))
        face((b, a, d, c), [(0.2, 0.2, 0.1)] * 4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('ICE_shelf')
    bm.to_mesh(me); bm.free()
    me.materials.append(M['ice'])
    o = bpy.data.objects.new('ICE_shelf', me)
    bpy.context.scene.collection.objects.link(o)
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(50))
    me.color_attributes.active_color = me.color_attributes['Col']
    return o

def build_collision(gcoll, M, extra):
    """the walkable ice near the station (a coarser copy of the top, 200 x 140 m) and the boxes"""
    p = K.Part('COL_station', [M['col']], gcoll)
    STEP = 4.0
    xs = np.arange(-100.0, 100.01, STEP); ys = np.arange(0.0, 140.01, STEP)
    grid = []
    for x in xs:
        e = edge_y(x)
        grid.append([p.bm.verts.new((x, max(y, e), top_z(x, max(y, e))[0])) for y in ys])
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            try: p.bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            except ValueError: pass
    for (x0, y0, z0, x1, y1, z1) in extra:
        p.box(x0, y0, z0, x1, y1, z1, M['col'])
    return p

def hut(p, M, cx, cy, rz, wall_m, L=6.0, W=2.6, H=2.6):
    """a balok: a cabin on sled runners, two windows, a door at one end with steps, a stovepipe"""
    zb = top_z(cx, cy)[0]
    with p.at(cx, cy, zb, rz):
        for s in (-1, 1):
            p.tube([(-L / 2 - 0.5, s * (W / 2 - 0.3), 0.45), (-L / 2 - 0.2, s * (W / 2 - 0.3), 0.1), (L / 2, s * (W / 2 - 0.3), 0.1), (L / 2 + 0.2, s * (W / 2 - 0.3), 0.3)], 0.08, M['dark'], 8)
            for xx in np.linspace(-L / 2 + 0.4, L / 2 - 0.4, 4):
                p.box(xx - 0.05, s * (W / 2 - 0.3) - 0.05, 0.12, xx + 0.05, s * (W / 2 - 0.3) + 0.05, 0.5, M['dark'])
        p.rbox(-L / 2, -W / 2, 0.5, L / 2, W / 2, 0.5 + H, wall_m, r=0.05, segs=2)
        p.rbox(-L / 2 - 0.08, -W / 2 - 0.08, 0.5 + H, L / 2 + 0.08, W / 2 + 0.08, 0.5 + H + 0.12, M['white'], r=0.04)
        # snow on the roof
        p.rbox(-L / 2 + 0.1, -W / 2 + 0.05, 0.5 + H + 0.12, L / 2 - 0.2, W / 2 - 0.05, 0.5 + H + 0.32, M['snow'], r=0.15, segs=3)
        for s in (-1, 1):
            for xx in (-1.3, 1.3):
                with p.at(xx, s * W / 2, 0.5 + 1.55, K.FACE['+y' if s > 0 else '-y']):
                    K.rplate(p, -0.38, -0.3, 0.38, 0.3, 0.0, 0.06, M['white'], r=0.06)
                    K.rplate(p, -0.3, -0.23, 0.3, 0.23, 0.06, 0.065, M['window'], r=0.04)
        with p.at(L / 2, 0, 0.5, K.FACE['+x']):
            K.rplate(p, -0.45, 0.05, 0.45, 1.95, 0.0, 0.05, M['white'], r=0.08)
            p.cyl(0.3, 0.07, 1.0, 0.025, 0.04, M['steel'], axis='Y', segs=8)
            for k in range(3):
                p.box(-0.5, 0.25 + k * 0.25, -0.5 + k * 0.17, 0.5, 0.5 + k * 0.25, -0.45 + k * 0.17, M['wood'])
            K.cage_lamp(p, 0.0, 0.0, 2.15, M['dark'], M['lampcold'], M['dark'], axis='+y', r=0.07)
        p.cyl(-L / 2 + 0.8, W / 4, 0.5 + H + 0.6, 0.08, 1.2, M['dark'], segs=10)
        p.cyl(-L / 2 + 0.8, W / 4, 0.5 + H + 1.25, 0.14, 0.12, M['dark'], segs=10, r2=0.09)
        p.cyl(L / 2 - 0.6, -W / 4, 0.5 + H + 1.4, 0.015, 2.8, M['steel'], segs=6)
    return (cx, cy, rz, L, W, H, zb)

def build(root):
    C.set_root(root)
    sc = C.fresh_scene('ASSET_station')
    X.SETS.clear()
    t = {
        'white': X.get('white', X.white_paint),
        'machine': X.get('machine', X.machine_paint),
        'wood': X.get('wood', X.wood, col=(0.5, 0.36, 0.22), dark=(0.3, 0.2, 0.11), seed=8, varnish=0.7),
        'steel': X.get('steel', X.brushed_steel),
        'rubber': X.get('rubber', X.rubber),
        'rope': X.get('rope', X.rope_braid),
    }
    P = X.pbr
    M = {
        'ice': C.mat('Ice_Shelf', (0.85, 0.9, 0.95), 0.4),
        'snow': C.mat('Ex_Snow', (0.86, 0.9, 0.95), 0.85),
        'white': P('Ex_White', t['white']),
        'red': P('Ex_Station_Red', t['machine'], tint=(0.5, 0.06, 0.02)),
        'blue': P('Ex_Station_Blue', t['machine'], tint=(0.03, 0.13, 0.42)),
        'yellow': P('Ex_Station_Yellow', t['machine'], tint=(0.7, 0.45, 0.03)),
        'orange': P('Ex_Station_Orange', t['machine'], tint=(0.75, 0.2, 0.02)),
        'dark': P('Ex_Dark', t['machine'], tint=(0.04, 0.045, 0.05)),
        'green': P('Ex_Station_Green', t['machine'], tint=(0.05, 0.14, 0.07)),
        'wood': P('Ex_Wood_Raw', t['wood']),
        'steel': P('Ex_Steel', t['steel']),
        'rubber': P('Ex_Rubber', t['rubber']),
        'rope': P('Ex_Rope', t['rope']),
        'tarp': C.mat('Ex_Tarp', (0.08, 0.16, 0.08), 0.85),
        'window': C.mat('Lamp_Warm', (1, 0.8, 0.55), 0.4, emit=(1.0, 0.72, 0.42), emit_strength=4.0),
        'lampcold': C.mat('Lamp_Cold', (0.9, 0.95, 1), 0.4, emit=(0.85, 0.92, 1.0), emit_strength=8.0),
        'beacon': C.mat('Lamp_Beacon', (1, 0.1, 0.05), 0.3, emit=(1.0, 0.06, 0.02), emit_strength=20.0),
        'sign_white': C.mat('Ex_Sign_White', (0.88, 0.88, 0.86), 0.5),
        'sign_blue': C.mat('Ex_Sign_Blue', (0.0, 0.12, 0.45), 0.5),
        'flag_w': C.mat('Ex_Flag_White', (0.88, 0.88, 0.86), 0.85),
        'flag_b': C.mat('Ex_Flag_Blue', (0.0, 0.12, 0.5), 0.85),
        'flag_r': C.mat('Ex_Flag_Red', (0.65, 0.02, 0.02), 0.85),
        'glass': C.mat('Glass', (0.02, 0.03, 0.035), 0.05, 0.0, alpha=0.3),
        'col': C.mat('Collision', (1, 0, 1), 1.0),
    }
    gcoll = C.collection(sc, 'GAME')
    def E(name, loc, rot=(0, 0, 0), **ex):
        return C.empty(name, loc, gcoll, rot, extras=ex)
    shelf = build_shelf(M)
    st = K.Part('STATION', [M['white']])
    sm = K.Part('STATION_SMALLS', [M['steel']])
    boxes = []
    # ---------------------------------------------------------------- the main house
    hx, hy = 0.0, 86.0
    hz = top_z(hx, hy)[0]
    HL, HW, HH = 16.0, 7.5, 3.6
    st.box(hx - HL / 2 - 0.3, hy - HW / 2 - 0.3, hz - 0.3, hx + HL / 2 + 0.3, hy + HW / 2 + 0.3, hz + 0.45, M['dark'])
    st.rbox(hx - HL / 2, hy - HW / 2, hz + 0.45, hx + HL / 2, hy + HW / 2, hz + 0.45 + HH, M['red'], r=0.06, segs=2)
    st.rbox(hx - HL / 2 - 0.15, hy - HW / 2 - 0.15, hz + 0.45 + HH, hx + HL / 2 + 0.15, hy + HW / 2 + 0.15, hz + 0.6 + HH, M['white'], r=0.05)
    st.rbox(hx - HL / 2 + 0.2, hy - HW / 2 + 0.1, hz + 0.6 + HH, hx + HL / 2 - 0.4, hy + HW / 2 - 0.1, hz + 0.95 + HH, M['snow'], r=0.25, segs=3)
    for k in range(8):
        xx = hx - HL / 2 + 1.3 + k * (HL - 2.6) / 7
        if abs(xx - hx) < 1.2: continue
        with st.at(xx, hy - HW / 2, hz + 0.45 + 1.7, K.FACE['-y']):
            K.rplate(st, -0.5, -0.45, 0.5, 0.45, 0.0, 0.07, M['white'], r=0.08)
            K.rplate(st, -0.42, -0.37, 0.42, 0.37, 0.07, 0.075, M['window'], r=0.05)
            st.box(-0.42, 0.075, -0.012, 0.42, 0.08, 0.012, M['white'])
    with st.at(hx, hy - HW / 2, hz + 0.45, K.FACE['-y']):
        K.rplate(st, -0.6, 0.0, 0.6, 2.2, 0.0, 0.08, M['white'], r=0.1)
        st.cyl(0.4, 0.1, 1.05, 0.03, 0.05, M['steel'], axis='Y', segs=8)
        st.box(-1.6, 0.0, 2.45, 1.6, 1.6, 2.55, M['white'])                       # the porch roof
        for s in (-1, 1): st.cyl(s * 1.45, 1.45, 1.2, 0.05, 2.45, M['white'], segs=8)
        for k in range(3):
            st.box(-1.2, 1.6 - k * 0.3, -0.45 + k * 0.15, 1.2, 1.9 - k * 0.3, -0.35 + k * 0.15, M['wood'])
        st.box(-1.2, 0.0, -0.05, 1.2, 1.6, 0.05, M['wood'])
        K.cage_lamp(st, 0.0, 0.0, 2.3, M['dark'], M['lampcold'], M['dark'], axis='+y', r=0.09)
        K.sign(sm, 0.0, -0.02, 3.0, '+y', 'СТАНЦИЯ «СЕВЕРНЫЙ»', 0.17, M['sign_blue'], M['sign_white'], h=0.45)
    boxes.append((hx - HL / 2 - 0.3, hy - HW / 2 - 0.3, hz - 1, hx + HL / 2 + 0.3, hy + HW / 2 + 0.3, hz + 4.5))
    boxes.append((hx - 1.25, hy - HW / 2 - 1.95, hz - 1, hx + 1.25, hy - HW / 2, hz + 0.08))
    E('SPOT_chief', (hx + 0.9, hy - HW / 2 - 2.6, hz + 0.05), (0, 0, math.radians(180)))
    E('LMP_door', (hx, hy - HW / 2 - 0.5, hz + 2.6), color=[0.9, 0.95, 1.0], power=16, range=12)
    # ---------------------------------------------------------------- huts
    for (cx, cy, rz, m) in ((-22.0, 74.0, math.radians(8), M['blue']), (21.0, 76.0, math.radians(-12), M['yellow']), (-6.0, 104.0, math.radians(95), M['orange'])):
        hut(st, M, cx, cy, rz, m)
        c, s = math.cos(rz), math.sin(rz)
        hw, hd = abs(3.3 * c) + abs(1.4 * s), abs(3.3 * s) + abs(1.4 * c)
        zb = top_z(cx, cy)[0]
        boxes.append((cx - hw, cy - hd, zb - 1, cx + hw, cy + hd, zb + 3.5))
    # ---------------------------------------------------------------- the radio mast (28 m), its guys, the beacon
    mx, my = 30.0, 98.0
    mz = top_z(mx, my)[0]
    MH = 28.0
    legs = [(math.cos(a) * 0.55, math.sin(a) * 0.55) for a in (math.pi / 2, math.pi / 2 + 2 * math.pi / 3, math.pi / 2 + 4 * math.pi / 3)]
    st.box(mx - 1.0, my - 1.0, mz - 0.3, mx + 1.0, my + 1.0, mz + 0.2, M['dark'])
    for k, (lx, ly) in enumerate(legs):
        nxt = legs[(k + 1) % 3]
        for sec in range(int(MH / 2.0)):
            z0, z1 = mz + 0.2 + sec * 2.0, mz + 0.2 + (sec + 1) * 2.0
            mm = M['red'] if (sec // 2) % 2 == 0 else M['white']
            st.tube([(mx + lx, my + ly, z0), (mx + lx, my + ly, z1)], 0.045, mm, 6)
            st.tube([(mx + lx, my + ly, z1), (mx + nxt[0], my + nxt[1], z1)], 0.02, mm, 4)
            st.tube([(mx + lx, my + ly, z0), (mx + nxt[0], my + nxt[1], z1)], 0.016, mm, 4)
    st.sphere(mx, my, mz + MH + 0.55, 0.2, M['beacon'], segs=12, rings=8)
    st.cyl(mx, my, mz + MH + 0.3, 0.12, 0.25, M['dark'], segs=10)
    E('BEACON', (mx, my, mz + MH + 0.55))
    for h in (9.0, 18.0, 26.0):
        for k in range(3):
            a = math.pi / 2 + k * 2 * math.pi / 3 + 0.3
            ax, ay = mx + math.cos(a) * 18.0, my + math.sin(a) * 18.0
            az = top_z(ax, ay)[0]
            st.tube([(mx + math.cos(a) * 0.5, my + math.sin(a) * 0.5, mz + h), (ax, ay, az + 0.3)], 0.008, M['dark'], 4)
    for k in range(3):
        a = math.pi / 2 + k * 2 * math.pi / 3 + 0.3
        ax, ay = mx + math.cos(a) * 18.0, my + math.sin(a) * 18.0
        st.box(ax - 0.3, ay - 0.3, top_z(ax, ay)[0] - 0.2, ax + 0.3, ay + 0.3, top_z(ax, ay)[0] + 0.3, M['dark'])
    boxes.append((mx - 1.0, my - 1.0, mz - 1, mx + 1.0, my + 1.0, mz + 4))
    # ---------------------------------------------------------------- fuel: two tanks on skids, drums
    for k, ty in enumerate((96.0, 100.5)):
        tx = -30.0; tz = top_z(tx, ty)[0]
        for s in (-2.2, 2.2):
            st.box(tx + s - 0.15, ty - 1.3, tz, tx + s + 0.15, ty + 1.3, tz + 0.7, M['dark'])
        st.cyl(tx, ty, tz + 1.75, 1.2, 6.2, M['white'], axis='X', segs=28, bevel=0.06)
        for s in (-1, 1): st.cyl(tx + s * 3.1, ty, tz + 1.75, 1.18, 0.12, M['white'], axis='X', segs=28, bevel=0.05)
        st.cyl(tx + 1.5, ty, tz + 3.0, 0.2, 0.2, M['dark'], segs=10)
        if k == 0: K.sign(sm, tx, ty - 1.21, tz + 1.8, '-y', 'ТОПЛИВО', 0.22, M['red'], M['sign_white'])
        boxes.append((tx - 3.4, ty - 1.4, tz - 1, tx + 3.4, ty + 1.4, tz + 3.0))
    for i in range(4):
        for j in range(3):
            dx, dy = -36.5 + i * 0.66, 92.0 + j * 0.66
            dz = top_z(dx, dy)[0]
            m = M['blue'] if (i + j) % 3 else M['red']
            st.cyl(dx, dy, dz + 0.44, 0.29, 0.88, m, segs=16, bevel=0.015)
            st.torus(dx, dy, dz + 0.3, 0.295, 0.012, m, segs=16, rsegs=4)
            st.torus(dx, dy, dz + 0.6, 0.295, 0.012, m, segs=16, rsegs=4)
    boxes.append((-37.0, 91.6, top_z(-36, 92)[0] - 1, -34.0, 93.8, top_z(-36, 92)[0] + 1.0))
    # ---------------------------------------------------------------- the weather mast and its screen
    wx, wy = 12.0, 108.0
    wz = top_z(wx, wy)[0]
    st.cyl(wx, wy, wz + 5.0, 0.07, 10.0, M['white'], segs=10)
    st.box(wx - 0.5, wy - 0.02, wz + 9.6, wx + 0.5, wy + 0.02, wz + 9.65, M['dark'])
    for k in range(3):
        a = k * 2 * math.pi / 3
        st.tube([(wx, wy, wz + 10.1), (wx + math.cos(a) * 0.25, wy + math.sin(a) * 0.25, wz + 10.1)], 0.01, M['dark'], 4)
        st.sphere(wx + math.cos(a) * 0.28, wy + math.sin(a) * 0.28, wz + 10.1, 0.05, M['dark'], segs=8, rings=4)
    st.box(wx + 0.4, wy - 0.03, wz + 9.75, wx + 1.0, wy + 0.03, wz + 9.95, M['dark'])
    sx_, sy_ = wx - 3.0, wy - 2.0
    for (ox, oy) in ((-0.4, -0.3), (0.4, -0.3), (-0.4, 0.3), (0.4, 0.3)):
        st.cyl(sx_ + ox, sy_ + oy, wz + 0.6, 0.03, 1.2, M['white'], segs=6)
    st.rbox(sx_ - 0.45, sy_ - 0.35, wz + 1.2, sx_ + 0.45, sy_ + 0.35, wz + 1.85, M['white'], r=0.02)
    for k in range(6):
        st.box(sx_ - 0.46, sy_ - 0.36, wz + 1.25 + k * 0.1, sx_ + 0.46, sy_ - 0.34, wz + 1.29 + k * 0.1, M['white'])
    st.rbox(sx_ - 0.5, sy_ - 0.4, wz + 1.85, sx_ + 0.5, sy_ + 0.4, wz + 1.95, M['white'], r=0.02)
    # ---------------------------------------------------------------- the flag
    fx, fy = 5.5, 76.0
    fz = top_z(fx, fy)[0]
    st.cyl(fx, fy, fz + 4.5, 0.06, 9.0, M['white'], segs=10, r2=0.04)
    st.sphere(fx, fy, fz + 9.05, 0.08, M['yellow'], segs=10, rings=6)
    fl = K.Part('FLAG_station', [M['flag_w']], gcoll)
    uvl = fl.bm.loops.layers.uv.new('UVMap')
    nu, nv, W_, H_ = 12, 9, 1.8, 1.2
    grid = [[fl.bm.verts.new((0.0, -W_ * i / nu, -H_ * (1 - j / nv))) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            f = fl.bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            f.material_index = fl.mi((M['flag_r'], M['flag_b'], M['flag_w'])[j // 3])
            for l in f.loops:
                l[uvl].uv = (-l.vert.co.y / W_, 1 + l.vert.co.z / H_)
    fo = fl.done(smooth=True)
    fo.location = (fx, fy - 0.05, fz + 8.9)
    # ---------------------------------------------------------------- lamp posts along the path
    for i, py in enumerate((10.0, 26.0, 42.0, 58.0, 72.0)):
        px = 3.0 if i % 2 == 0 else -3.0
        pz = top_z(px, py)[0]
        st.cyl(px, py, pz + 2.6, 0.07, 5.2, M['dark'], segs=10)
        st.cyl(px, py, pz + 0.1, 0.22, 0.2, M['dark'], segs=12)
        st.tube([(px, py, pz + 5.1), (px - math.copysign(0.7, px), py, pz + 5.3)], 0.04, M['dark'], 6)
        hx_ = px - math.copysign(0.75, px)
        st.rbox(hx_ - 0.22, py - 0.12, pz + 5.12, hx_ + 0.22, py + 0.12, pz + 5.32, M['dark'], r=0.03)
        st.box(hx_ - 0.18, py - 0.09, pz + 5.1, hx_ + 0.18, py + 0.09, pz + 5.12, M['lampcold'])
        E(f'LMP_path_{i + 1}', (hx_, py, pz + 4.95), color=[0.86, 0.92, 1.0], power=30, range=22)
        boxes.append((px - 0.15, py - 0.15, pz - 1, px + 0.15, py + 0.15, pz + 5.2))
    # ---------------------------------------------------------------- the berth: anchors, crates, the carrier, the sign
    for (nm, ax, ay) in (('bow', -24.0, 4.5), ('stern', 25.0, 4.5)):
        az = top_z(ax, ay)[0]
        for d in (-0.3, 0.3):
            st.cyl(ax + d, ay, az + 0.35, 0.16, 1.4, M['wood'], segs=10)
        st.box(ax - 0.5, ay - 0.08, az + 0.55, ax + 0.5, ay + 0.08, az + 0.7, M['wood'])
        E('ANCHOR_' + nm, (ax, ay - 0.1, az + 0.62))
        boxes.append((ax - 0.55, ay - 0.25, az - 1, ax + 0.55, ay + 0.25, az + 1.0))
    for (cx, cy, w, l, h, m) in ((-9.0, 7.0, 1.2, 1.2, 1.0, M['wood']), (-10.4, 7.2, 1.2, 1.2, 0.9, M['wood']), (-9.7, 7.1, 1.1, 1.1, 0.8, M['wood']), (-12.5, 9.0, 2.2, 1.4, 1.1, M['tarp'])):
        cz = top_z(cx, cy)[0]
        zb_ = cz + (1.0 if (cx, cy) == (-9.7, 7.1) else 0.0)
        st.box(cx - w / 2, cy - l / 2, zb_, cx + w / 2, cy + l / 2, zb_ + 0.12, M['wood'])
        st.rbox(cx - w / 2 + 0.05, cy - l / 2 + 0.05, zb_ + 0.12, cx + w / 2 - 0.05, cy + l / 2 - 0.05, zb_ + 0.12 + h, m, r=0.03 if m is M['wood'] else 0.2, segs=2)
        boxes.append((cx - w / 2, cy - l / 2, cz - 1, cx + w / 2, cy + l / 2, zb_ + h + 0.12))
    # the tracked carrier (a GTT): a hull on two tracks, the cab
    vx, vy = 12.0, 14.0
    vz = top_z(vx, vy)[0]
    with st.at(vx, vy, vz, math.radians(-25)):
        for s in (-1, 1):
            st.rbox(-3.0, s * 1.3 - 0.35, 0.0, 3.0, s * 1.3 + 0.35, 0.9, M['rubber'], r=0.35, segs=3)
            for k in range(6):
                st.cyl(-2.3 + k * 0.92, s * 1.3, 0.42, 0.33, 0.72, M['dark'], axis='Y', segs=14)
        st.rbox(-3.2, -1.0, 0.6, 3.2, 1.0, 1.7, M['green'], r=0.15, segs=2)
        st.rbox(0.8, -0.95, 1.7, 3.0, 0.95, 2.7, M['green'], r=0.15, segs=2)
        st.box(2.95, -0.8, 1.95, 3.02, 0.8, 2.55, M['glass'])
        st.rbox(-3.0, -0.9, 1.7, 0.6, 0.9, 2.3, M['tarp'], r=0.2, segs=2)
    boxes.append((vx - 3.4, vy - 3.4, vz - 1, vx + 3.4, vy + 3.4, vz + 2.7))
    K.sign(sm, 0.0, 2.0, top_z(0, 2)[0] + 1.2, '-y', 'ПРИЧАЛ', 0.2, M['sign_blue'], M['sign_white'])
    sz_ = top_z(0, 2)[0]
    for s in (-0.6, 0.6): st.cyl(s, 2.05, sz_ + 0.55, 0.04, 1.1, M['dark'], segs=6)
    # ---------------------------------------------------------------- the gangway (shown when she's moored)
    # (station frame with the tug at the berth: her x is our y + 6.35, her y our -x; her deck at
    # z 2.5, her bulwark at y -0.55.) Aft of her deckhouse, where the deck is open to the sky: a
    # short stair across her deck up to a platform over the bulwark, the ramp out and down onto
    # the ice, all in one line.
    gw = K.Part('GANGWAY', [M['steel']], gcoll)
    gx0, gx1 = 8.3, 9.2                       # its width (along the edge: her y -9.2 .. -8.3)
    Z = 3.82                                  # the platform (clear of her cap rail)
    y_st0, y_st1, y_pl1, y_rp1 = -2.65, -1.35, -0.2, 3.7
    for k in range(4):
        t0, t1 = k / 4, (k + 1) / 4
        za = 2.5 + (Z - 2.5) * t1
        gw.box(gx0, y_st0 + (y_st1 - y_st0) * t0, za - 0.04, gx1, y_st0 + (y_st1 - y_st0) * t1, za, M['steel'], bevel=0.004)
    for xx in (gx0, gx1):
        gw.tube([(xx, y_st0, 2.5), (xx, y_st1, Z - 0.05)], 0.03, M['steel'], 6)
    gw.box(gx0, y_st1, Z - 0.08, gx1, y_pl1, Z, M['steel'])
    drop = Z - 0.75
    L_ = math.hypot(y_rp1 - y_pl1, drop); ang = math.atan2(-drop, y_rp1 - y_pl1)
    cy_, cz_ = (y_pl1 + y_rp1) / 2, (Z + 0.75) / 2
    for xx in (gx0, gx1):
        f = gw.boxc(xx, cy_, cz_, 0.05, L_, 0.18, M['steel'])
        vs = list({v for fc in f for v in fc.verts})
        bmesh.ops.rotate(gw.bm, verts=vs, cent=(xx, cy_, cz_), matrix=Matrix.Rotation(ang, 3, 'X'))
    for k in range(13):
        t_ = (k + 0.5) / 13
        yy, zz = y_pl1 + (y_rp1 - y_pl1) * t_, Z - drop * t_
        gw.box(gx0, yy - 0.04, zz - 0.02, gx1, yy + 0.04, zz, M['steel'])
    for xx in (gx0, gx1):
        gw.tube([(xx, y_st0, 3.45), (xx, y_st1, Z + 0.95), (xx, y_pl1, Z + 0.95), (xx, y_rp1 - 0.1, 0.75 + 0.95)], 0.022, M['yellow'], 8)
        for (yy, zz) in ((y_st0, 2.5), (y_st1, Z), (y_pl1, Z), (cy_, cz_), (y_rp1 - 0.1, 0.8)):
            gw.cyl(xx, yy, zz + 0.47, 0.016, 0.95, M['yellow'], segs=6)
    gw.done(sharp=40)
    cg = K.Part('COL_gangway', [M['col']], gcoll)
    K.ramp(cg, gx0, gx1, y_st0 - 0.05, 2.5, y_st1, Z)
    cg.box(gx0, y_st1, Z - 0.15, gx1, y_pl1, Z, M['col'])
    K.ramp(cg, gx0, gx1, y_pl1, Z, y_rp1, 0.75)
    for xx in (gx0 - 0.08, gx1 + 0.08):
        K.wall(cg, (xx, y_st0), (xx, y_rp1), 0.6, 4.9, None, t=0.1)
    cg.done()
    # ---------------------------------------------------------------- the berth, the collision
    E('BERTH', (0.0, -6.35, 0.0), (0, 0, math.radians(90)))
    # the ice edge for the game (the boat stops at it, the radar paints it): y of the edge every 4 m
    xs_ = [float(x) for x in np.arange(-W_HALF, W_HALF + 0.01, 4.0)]
    E('SHELF_info', (0, 0, 0), edge=[round(edge_y(x), 2) for x in xs_], x0=-W_HALF, step=4.0, depth=DEPTH)
    cs = build_collision(gcoll, M, boxes)
    for p in (st, sm, cs):
        if p is cs: p.done()
        else: p.done(sharp=40)
    return sc

def report(sc):
    objs = [o for o in sc.objects if o.type == 'MESH']
    return {'tris': sum(C.tris(o) for o in objs if not o.name.startswith('COL_')), 'objects': len(objs), 'col': sum(C.tris(o) for o in objs if o.name.startswith('COL_'))}

if __name__ == '__main__' or True:
    ROOT_ = globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arctic Tug')
    sc = build(ROOT_)
    result = report(sc)
    if globals().get('EXPORT', True):
        path = os.path.join(C.raw_dir(), 'station.glb')
        result['export'] = (path, C.export_glb(sc, path, vcolors=True))
