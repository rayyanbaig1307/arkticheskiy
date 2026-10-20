# The polar bear (белый медведь): an adult male, 2.5 m nose to tail, 1.3 m at the shoulder.
# Exported to tools/blender/raw/bear.glb (mesh, skin and clips), packed to public/models/bear.glb.
#
# The body is sculpted as a signed distance field, not lofted: a primitive for every mass of the
# anatomy (the deep chest, the long neck, the small long head with its Roman nose, the heavy legs
# and the huge in-turned paws, the rump as high as the withers), smooth-unioned with a blend width
# per joint, meshed with surface nets, voxel-remeshed into even quads and relaxed. Then, found by ray casts on that surface, the landmarks (the eyes, the nose leather, the
# mouth line, the toes) and numpy detail along the normals: the eye sockets, the nostrils, the
# philtrum, the ear cups, fur clumps and the shag of the belly and the backs of the forelegs.
# Reduced to a game budget, the mouth is cut open along the lip line (the jaw really opens: a
# cavity behind it, black lips, yellowed teeth, a blue-black tongue), black skin on the nose, the
# lips, the eyelids and the pads, wet dark eyes, five curved claws on each paw.
#
# The coat is baked for this mesh's own UVs: a strand pattern drawn along the fur's lie (line
# integral convolution of noise along the flow: from the nose back over the body, down the legs),
# clumps from 3D noise (continuous over the seams), and colour by region: cream, yellower on the
# back and the rump, grey round the face, dirty on the feet. Its normal map comes from the strands.
# Vertex colours: r = fur length (for the game's shell fur), g = blood (the muzzle, the chest, the
# forepaws of a bear that has been feeding: the game sets how much).
#
# A skeleton of 29 bones (every bone rolled so its local x is the world's x: a positive turn about
# x lifts a horizontal bone's tip and swings a hanging bone forward), heat-weighted, the muzzle's
# weights split exactly at the lip line. Clips keyed in code: idle, sniff_air, sniff_ground, walk,
# stalk, trot, charge, rear, swipe, bite, roar, lunge (the jump scare), hurt, death, eat.
#
# Blender axes: the bear faces +y (three.js -z), up +z, standing on z = 0.
import bpy, bmesh, math, os, importlib
from mathutils import Vector, Matrix, Quaternion, Euler
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
import numpy as np
import common as C
importlib.reload(C)

FPS = 30
TEX = int(globals().get('TEX', 2048))
SM = lambda t: t * t * (3 - 2 * t)

def ease(t, a, b): return SM(max(0.0, min(1.0, (t - a) / (b - a))))
def sstep(x): x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)
def Q(axis, deg): return Quaternion(Vector(axis), math.radians(deg))
def osc(t, L, k, ph=0.0): return math.sin(2 * math.pi * k * t / L + ph)
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

# ---------------------------------------------------------------- the form: a signed distance field
# Every mass of the anatomy is a primitive (ellipsoids and round cones) joined by a smooth union
# whose blend width is chosen per joint: wide where muscle and fur flow together (the legs into
# the trunk), narrow where a form must stay distinct (the neck from the skull, the toes, the
# ears). Sampled on a 1 cm grid, meshed with surface nets.
GRID = 0.01
PRIMS = []      # (kind, params, blend, bbox)

def _rot(yaw=0, pitch=0, roll=0):
    return np.array(Euler((math.radians(pitch), math.radians(roll), math.radians(yaw)), 'XYZ').to_matrix(), np.float32)

def E(c, r, k, yaw=0, pitch=0, roll=0):
    """an ellipsoid at c, semi-axes r (turned: yaw about z, pitch about x, roll about y)"""
    m = max(r)
    PRIMS.append(('ell', (np.array(c, np.float32), np.array(r, np.float32), _rot(yaw, pitch, roll)), k, (np.array(c) - m, np.array(c) + m)))

def RC(a, b, r1, r2, k):
    """a round cone from a (radius r1) to b (radius r2)"""
    a, b = np.array(a, np.float32), np.array(b, np.float32); m = max(r1, r2)
    PRIMS.append(('rc', (a, b, r1, r2), k, (np.minimum(a, b) - m, np.maximum(a, b) + m)))

def B(c, r, k): E(c, (r, r, r), k)

def sd_ell(P, c, r, R):
    q = (P - c) @ R
    k0 = np.linalg.norm(q / r, axis=-1); k1 = np.linalg.norm(q / (r * r), axis=-1)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)

def sd_rc(P, a, b, r1, r2):
    ba = b - a; l2 = float(ba @ ba); rr = r1 - r2; a2 = l2 - rr * rr; il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba; z = y - l2
    x2 = np.sum((pa * l2 - y[..., None] * ba) ** 2, -1)
    y2 = y * y * l2; z2 = z * z * l2
    k = math.copysign(1.0, rr) * rr * rr * x2
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))

def smin(a, b, k):
    if k <= 0: return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k * 0.25

def toe_ring(s, cx, cy, z, spread, rx, ry, turn):
    """five toes round the front of a paw (turned in by `turn` degrees: polar bears toe in)"""
    out = []
    for k in range(5):
        a = (k - 2) * spread - s * math.radians(turn)
        out.append((s, k, a, (cx + math.sin(a) * rx, cy + math.cos(a) * ry, z)))
    return out

FORE_TOES = [t for s in (1, -1) for t in toe_ring(s, s * 0.24, 0.62, 0.05, 0.36, 0.105, 0.13, 8)]
HIND_TOES = [t for s in (1, -1) for t in toe_ring(s, s * 0.25, -0.5, 0.042, 0.33, 0.085, 0.08, 5)]

def bear_form():
    PRIMS.clear()
    # the trunk: the chest deep and forward, the belly and its hanging fur, the rump as high as the withers
    E((0, 0.36, 0.86), (0.29, 0.42, 0.36), 0.0)
    E((0, -0.12, 0.84), (0.31, 0.5, 0.35), 0.16)
    E((0, -0.66, 0.92), (0.29, 0.38, 0.33), 0.16)
    E((0, 0.46, 1.02), (0.2, 0.26, 0.17), 0.14)                    # the withers, over the shoulder blades
    E((0, -0.12, 0.6), (0.23, 0.46, 0.14), 0.14)                   # the belly's fur hanging
    E((0, 0.5, 0.62), (0.2, 0.2, 0.16), 0.14)                      # the brisket
    # the neck: long, broad at the shoulders, tapering to the head
    RC((0, 0.6, 0.96), (0, 1.06, 1.02), 0.25, 0.145, 0.14)
    # the head: the skull, the cheeks, the long snout with its Roman nose, the nose pad, the lower jaw
    E((0, 1.16, 1.05), (0.135, 0.15, 0.125), 0.08)
    for s in (1, -1):
        E((s * 0.085, 1.2, 1.0), (0.07, 0.11, 0.085), 0.05)
    RC((0, 1.24, 1.05), (0, 1.5, 1.0), 0.1, 0.058, 0.07)
    E((0, 1.535, 1.0), (0.048, 0.035, 0.037), 0.025)
    RC((0, 1.2, 0.965), (0, 1.48, 0.955), 0.075, 0.042, 0.04)
    for s in (1, -1):
        E((s * 0.1, 1.1, 1.16), (0.044, 0.024, 0.038), 0.035, yaw=s * 25, roll=s * -15)  # the ears: small, round, on the sides
    # the forelegs: the upper arm under the shoulder, the forearm, the wrist, the broad paw turned in
    for s in (1, -1):
        RC((s * 0.21, 0.56, 0.86), (s * 0.245, 0.45, 0.5), 0.16, 0.125, 0.14)
        RC((s * 0.245, 0.45, 0.5), (s * 0.24, 0.54, 0.15), 0.12, 0.088, 0.06)
        E((s * 0.25, 0.41, 0.3), (0.085, 0.08, 0.17), 0.07)         # the long fur behind the forearm
        E((s * 0.24, 0.62, 0.065), (0.125, 0.165, 0.065), 0.06, yaw=s * 8)
    for s, k, a, c in FORE_TOES: B(c, 0.04, 0.03)
    # the hind legs: the heavy thigh, the shin back to the hock, the long plantigrade foot
    for s in (1, -1):
        RC((s * 0.18, -0.74, 0.86), (s * 0.25, -0.52, 0.48), 0.22, 0.14, 0.14)
        E((s * 0.2, -0.86, 0.66), (0.15, 0.16, 0.24), 0.12)          # the hams behind the thigh
        RC((s * 0.25, -0.52, 0.48), (s * 0.255, -0.76, 0.15), 0.13, 0.085, 0.07)
        E((s * 0.26, -0.72, 0.35), (0.09, 0.08, 0.14), 0.06)         # the fur behind the shin
        E((s * 0.25, -0.62, 0.058), (0.115, 0.2, 0.058), 0.06, yaw=s * 5)
        B((s * 0.255, -0.78, 0.1), 0.075, 0.05)
    for s, k, a, c in HIND_TOES: B(c, 0.036, 0.028)
    E((0, -1.07, 0.97), (0.055, 0.06, 0.05), 0.04)                 # the stub of a tail
    return PRIMS

def sdf_grid():
    lo = np.array([-0.52, -1.28, -0.03], np.float32); hi = np.array([0.52, 1.7, 1.45], np.float32)
    n = (np.ceil((hi - lo) / GRID).astype(int) + 1)
    F = np.full(tuple(n), 1.0, np.float32)
    axes = [lo[i] + np.arange(n[i], dtype=np.float32) * GRID for i in range(3)]
    for kind, prm, k, (b0, b1) in PRIMS:
        m = k + 0.04
        i0 = np.clip(np.floor((b0 - m - lo) / GRID).astype(int), 0, n - 1)
        i1 = np.clip(np.ceil((b1 + m - lo) / GRID).astype(int) + 1, 1, n)
        sub = tuple(slice(int(i0[d]), int(i1[d])) for d in range(3))
        P = np.stack(np.meshgrid(axes[0][sub[0]], axes[1][sub[1]], axes[2][sub[2]], indexing='ij'), -1)
        d = sd_ell(P, *prm) if kind == 'ell' else sd_rc(P, *prm)
        F[sub] = smin(F[sub], d.astype(np.float32), k)
    return F, lo

def surface_nets(F, lo, h):
    """a quad mesh from the field: one vertex per cell the surface crosses (the mean of its edge
    crossings), one quad per crossed grid edge, wound to face out"""
    ins = F < 0
    nx, ny, nz = F.shape
    C8 = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]
    def cs(a): return (slice(a[0], nx - 1 + a[0]), slice(a[1], ny - 1 + a[1]), slice(a[2], nz - 1 + a[2]))
    cnt = np.zeros((nx - 1, ny - 1, nz - 1), np.int8)
    for c in C8: cnt += ins[cs(c)]
    act = (cnt > 0) & (cnt < 8)
    nv = int(act.sum())
    idx = np.full(act.shape, -1, np.int64); idx[act] = np.arange(nv)
    cf = [F[cs(c)][act] for c in C8]
    acc = np.zeros((nv, 3), np.float32); num = np.zeros(nv, np.float32)
    for p, q in ((0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)):
        f0, f1 = cf[p], cf[q]
        m = (f0 < 0) != (f1 < 0)
        t = f0[m] / (f0[m] - f1[m])
        cp, cq = np.array(C8[p], np.float32), np.array(C8[q], np.float32)
        acc[m] += cp + t[:, None] * (cq - cp); num[m] += 1
    verts = lo + (np.argwhere(act).astype(np.float32) + acc / num[:, None]) * h
    quads = []
    for ax, (u, v) in enumerate(((1, 2), (2, 0), (0, 1))):
        s0 = [slice(None)] * 3; s1 = [slice(None)] * 3
        s0[ax] = slice(0, -1); s1[ax] = slice(1, None)
        a = ins[tuple(s0)]
        e = np.argwhere(a != ins[tuple(s1)])
        ok = (e[:, u] >= 1) & (e[:, v] >= 1) & (e[:, u] <= F.shape[u] - 2) & (e[:, v] <= F.shape[v] - 2)
        e = e[ok]
        start_in = a[tuple(e.T)]
        def cell(du, dv):
            c = e.copy(); c[:, u] += du; c[:, v] += dv; return idx[tuple(c.T)]
        q4 = np.stack([cell(-1, -1), cell(0, -1), cell(0, 0), cell(-1, 0)], 1)
        q4[~start_in] = q4[~start_in][:, ::-1]
        quads.append(q4)
    return verts, np.concatenate(quads)

def sdf_mesh(name):
    bear_form()
    F, lo = sdf_grid()
    verts, quads = surface_nets(F, lo, GRID)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], quads.tolist())
    me.validate(); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    return o

def vnoise3(P, scale, seed):
    """smooth 3D value noise (0..1) at points P (N, 3)"""
    g = np.random.default_rng(seed).random((32, 32, 32)).astype(np.float32)
    q = P / scale
    i = np.floor(q).astype(np.int64); f = (q - i).astype(np.float32)
    f = f * f * (3 - 2 * f)
    def G(dx, dy, dz): return g[(i[:, 0] + dx) % 32, (i[:, 1] + dy) % 32, (i[:, 2] + dz) % 32]
    x0 = G(0, 0, 0) * (1 - f[:, 0]) + G(1, 0, 0) * f[:, 0]
    x1 = G(0, 1, 0) * (1 - f[:, 0]) + G(1, 1, 0) * f[:, 0]
    x2 = G(0, 0, 1) * (1 - f[:, 0]) + G(1, 0, 1) * f[:, 0]
    x3 = G(0, 1, 1) * (1 - f[:, 0]) + G(1, 1, 1) * f[:, 0]
    y0 = x0 * (1 - f[:, 1]) + x1 * f[:, 1]; y1 = x2 * (1 - f[:, 1]) + x3 * f[:, 1]
    return y0 * (1 - f[:, 2]) + y1 * f[:, 2]

def get_co(me):
    a = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', a); return a.reshape(-1, 3)
def get_nr(me):
    a = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('normal', a); return a.reshape(-1, 3)

def raw_body():
    o = sdf_mesh('Bear_body')
    m = o.modifiers.new('rm', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = 0.011; m.use_smooth_shade = True
    C.apply_modifiers(o)
    m = o.modifiers.new('sm', 'SMOOTH'); m.factor = 0.5; m.iterations = 4
    C.apply_modifiers(o)
    return o

# ---------------------------------------------------------------- landmarks (ray casts on the surface)
def bvh_of(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    t = BVHTree.FromBMesh(bm); bm.free(); return t

def ray(t, org, d):
    d = Vector(d).normalized()
    hit, n, i, dist = t.ray_cast(Vector(org), d)
    if hit is None: raise RuntimeError(f'the ray missed: from {tuple(org)} along {tuple(d)}')
    return hit, n

def landmarks(o):
    t = bvh_of(o); L = {}
    best = None
    for z in np.arange(0.98, 1.08, 0.004):                         # the nose: the muzzle's most forward point
        p, n = ray(t, (0, 1.42, float(z)), Y)
        if best is None or p.y > best[0].y: best = (p, n)
    L['nose'] = best[0]
    L['zf'] = L['nose'].z - 0.042                                   # the mouth line at the front, under the nose
    L['yf'] = ray(t, (0, 1.42, L['zf']), Y)[0].y
    L['yc'] = 1.27                                                  # the mouth's corners (a bear's gape is deep)
    L['slope'] = 0.08                                               # the line drops this much per metre back
    ys, xs = [], []
    for y in np.arange(L['yc'] - 0.06, L['yf'] - 0.003, 0.006):
        ys.append(float(y)); xs.append(ray(t, (0, float(y), zlip(L, y) + 0.003), X)[0].x)
    L['side_y'], L['side_x'] = ys, xs
    for s, side in ((1, 'R'), (-1, 'L')):
        L['eye' + side] = ray(t, (0, 1.27, 1.06), (s * 0.75, 0.25, 0.6))
        L['ear' + side] = (Vector((s * 0.1, 1.106, 1.17)), Vector((s * 0.34, 0.94, 0)))
    L['claws'] = []
    for kind, toes, ln in (('fore', FORE_TOES, 0.058), ('hind', HIND_TOES, 0.042)):
        for s, k, a, c in toes:
            p, n = ray(t, c, (math.sin(a) * 0.5, 1, -0.32))
            L['claws'].append((kind, s, p, n, Vector((math.sin(a) * 0.25, 1, -0.5)).normalized(), ln))
    return L

def zlip(L, y): return L['zf'] - (L['yf'] - y) * L['slope']
def side_x(L, y): return float(np.interp(y, L['side_y'], L['side_x']))

def sculpt(o, L):
    """the face's and the coat's detail, along the normals of the dense mesh"""
    me = o.data
    co = get_co(me); nr = get_nr(me)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    d = np.zeros(len(co), np.float32)
    head = sstep((y - 1.0) / 0.15)
    # fur clumps and tufts, broad on the body and fine on the face
    d += ((vnoise3(co, 0.075, 1) - 0.5) * 0.024 + (vnoise3(co, 0.03, 2) - 0.5) * 0.01) * (1 - 0.85 * head)
    # the belly's shag and the feathering behind the forelegs: streaks hanging down
    streak = vnoise3(co * np.array([4, 4, 0.7], np.float32), 0.05, 3)
    belly = sstep((0.7 - z) / 0.15) * (np.abs(y) < 0.75) * sstep((-nr[:, 2] - 0.2) / 0.4)
    behind = sstep((-nr[:, 1] - 0.3) / 0.4) * sstep((np.abs(x) - 0.14) / 0.05) * sstep((0.6 - z) / 0.1) * sstep((z - 0.16) / 0.08) * (np.abs(y - 0.45) < 0.25)
    d += (belly + behind) * (streak - 0.25) * 0.045
    # the eye sockets, a little brow above them
    for side in ('R', 'L'):
        e, en = L['eye' + side]
        r = np.linalg.norm(co - np.array(e, np.float32), axis=1)
        d -= np.exp(-(r / 0.026) ** 2) * 0.011
        above = (z > e.z + 0.012)
        d += np.exp(-((r - 0.032) / 0.01) ** 2) * 0.004 * above
        # the ear cups: the front of each ear hollowed
        a, an = L['ear' + side]
        r = np.linalg.norm(co - np.array(a, np.float32), axis=1)
        front = sstep((nr[:, 1] * 0.9 + nr[:, 2] * 0.1 - 0.15) / 0.4)
        d -= np.clip(1 - r / 0.04, 0, 1) * front * 0.014
    # the nose leather: the pad pushed forward a touch, the nostrils, the philtrum down to the lip
    nose = np.array(L['nose'], np.float32)
    r = np.linalg.norm(co - nose, axis=1)
    d += np.exp(-(r / 0.03) ** 2) * 0.004
    for s in (1, -1):
        r = np.linalg.norm(co - (nose + np.array([s * 0.02, -0.006, -0.004], np.float32)), axis=1)
        d -= np.exp(-(r / 0.008) ** 2) * 0.009
    phil = np.exp(-(x / 0.004) ** 2) * (y > L['yf'] - 0.03) * (z > L['zf']) * (z < nose[2] - 0.012)
    d -= phil * 0.003
    # the mouth line: the lips rolled in a little before the cut
    zl = L['zf'] - (L['yf'] - y) * L['slope']
    lipband = np.exp(-((z - zl) / 0.005) ** 2) * (y > L['yc'] - 0.02)
    d -= lipband * 0.004
    co += nr * d[:, None]
    me.vertices.foreach_set('co', co.ravel()); me.update()

def decimate(o, target):
    """down to `target` triangles, keeping the detail where it is looked at: the face fully, the
    paws and the ears partly (Decimate keeps weighted vertices when its group is inverted)"""
    me = o.data
    co = get_co(me)
    w = np.maximum(sstep((co[:, 1] - 1.02) / 0.12), 0.55 * sstep((0.16 - co[:, 2]) / 0.06))
    g = o.vertex_groups.new(name='_keep')
    for i in np.nonzero(w > 0.01)[0]: g.add([int(i)], float(w[i]), 'REPLACE')
    m = o.modifiers.new('dc', 'DECIMATE'); m.vertex_group = '_keep'; m.invert_vertex_group = True; m.vertex_group_factor = 1.0
    ratio = target / max(1, C.tris(o))
    for it in range(4):                                             # the group skews the count: home in on the target
        m.ratio = min(1.0, ratio)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = o.evaluated_get(dg); n = sum(len(p.vertices) - 2 for p in ev.to_mesh().polygons); ev.to_mesh_clear()
        ratio *= target / max(1, n)
    C.apply_modifiers(o)
    o.vertex_groups.remove(o.vertex_groups['_keep'])

def cut_mouth(o, L):
    """the lips: the muzzle split along the mouth line from corner to corner. Returns, per vertex,
    whether it belongs to the lower jaw"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    pno = Vector((0, -L['slope'], 1)).normalized()
    pco = Vector((0, L['yf'], L['zf']))
    faces = [f for f in bm.faces if f.calc_center_median().y > L['yc'] - 0.01 and abs((f.calc_center_median() - pco).dot(pno)) < 0.04]
    geom = list(set(faces) | {e for f in faces for e in f.edges} | {v for f in faces for v in f.verts})
    ret = bmesh.ops.bisect_plane(bm, geom=geom, dist=0.0002, plane_co=pco, plane_no=pno)
    cut = [e for e in ret['geom_cut'] if isinstance(e, bmesh.types.BMEdge)
           and all(v.co.y > L['yc'] + 0.004 and abs((v.co - pco).dot(pno)) < 0.0005 for v in e.verts)]
    bmesh.ops.split_edges(bm, edges=cut)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.verts.index_update()
    lower = np.zeros(len(bm.verts), bool)
    for v in bm.verts:
        if not v.link_faces: continue
        c = sum((f.calc_center_median() for f in v.link_faces), Vector()) / len(v.link_faces)
        lower[v.index] = (c - pco).dot(pno) < 0
    bm.to_mesh(o.data); bm.free()
    o.data.update()
    return lower, len(cut)

def skin_faces(o, L):
    """black skin: the nose leather, the lips, the eyelids, the pads under the feet (material 1)"""
    me = o.data
    nose = Vector(L['nose'])
    eyes = [L['eyeR'][0], L['eyeL'][0]]
    pno = Vector((0, -L['slope'], 1)).normalized(); pco = Vector((0, L['yf'], L['zf']))
    n = 0
    for p in me.polygons:
        c = p.center; nn = p.normal
        skin = False
        if (c - nose).length < 0.042 and nn.y * 0.8 + nn.z * 0.4 > 0.25 and c.z > L['zf'] + 0.012: skin = True
        if c.y > L['yc'] - 0.008 and abs((c - pco).dot(pno)) < 0.008: skin = True
        if any((c - e).length < 0.019 for e in eyes): skin = True
        if c.z < 0.03 and nn.z < -0.6: skin = True
        if skin: p.material_index = 1; n += 1
    return n

def smart_uv(o):
    for ob in bpy.context.view_layer.objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    try:
        with bpy.context.temp_override(active_object=o, object=o, selected_objects=[o], selected_editable_objects=[o], edit_object=o):
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
            bpy.ops.object.mode_set(mode='OBJECT')
        return 'smart'
    except Exception as ex:
        try: bpy.ops.object.mode_set(mode='OBJECT')
        except Exception: pass
        C.box_uv(o.data, 1.0)
        return 'box: ' + str(ex)[:120]

# ---------------------------------------------------------------- the coat, baked for these UVs
def flow3(P, N):
    """the fur's lie: back from the nose over the body, slanting down the flanks, down the legs"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    legw = sstep((0.62 - z) / 0.2) * sstep((np.abs(x) - 0.12) / 0.06)
    one = np.ones_like(x)
    f = np.stack([0 * one, -one, -0.45 * one], 1) * (1 - legw)[:, None] + np.stack([0 * one, -0.15 * one, -one], 1) * legw[:, None]
    f -= N * np.sum(f * N, 1, keepdims=True)
    ln = np.linalg.norm(f, axis=1, keepdims=True)
    alt = np.cross(N, np.array([[1, 0, 0]], np.float32))            # where the lie is undefined (the nose's front)
    f = np.where(ln > 0.15, f / np.maximum(ln, 1e-6), alt / np.maximum(np.linalg.norm(alt, axis=1, keepdims=True), 1e-6))
    return f.astype(np.float32)

def bake_coat(me, S):
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tv = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('vertices', tv); tv = tv.reshape(-1, 3)
    tl = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    co = get_co(me); nr = get_nr(me)
    P = np.zeros((S, S, 3), np.float32); N = np.zeros((S, S, 3), np.float32); F = np.full((S, S), -1, np.int32)
    T = uv[tl] * S                                                   # (nt, 3, 2) in pixels
    for i in range(nt):
        A, B, Cc = T[i]
        x0 = max(int(math.floor(min(A[0], B[0], Cc[0]))), 0); x1 = min(int(math.ceil(max(A[0], B[0], Cc[0]))), S)
        y0 = max(int(math.floor(min(A[1], B[1], Cc[1]))), 0); y1 = min(int(math.ceil(max(A[1], B[1], Cc[1]))), S)
        if x1 <= x0 or y1 <= y0: continue
        den = (B[1] - Cc[1]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[1] - Cc[1])
        if abs(den) < 1e-9: continue
        xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        w0 = ((B[1] - Cc[1]) * (xs - Cc[0]) + (Cc[0] - B[0]) * (ys - Cc[1])) / den
        w1 = ((Cc[1] - A[1]) * (xs - Cc[0]) + (A[0] - Cc[0]) * (ys - Cc[1])) / den
        w2 = 1 - w0 - w1
        m = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not m.any(): continue
        rr, cc = ys[m].astype(int), xs[m].astype(int)
        W = np.stack([w0[m], w1[m], w2[m]], 1).astype(np.float32)
        P[rr, cc] = W @ co[tv[i]]
        N[rr, cc] = W @ nr[tv[i]]
        F[rr, cc] = i
    valid = F >= 0
    for it in range(10):                                             # pad the islands outward
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sv = np.roll(valid, (dy, dx), (0, 1)); take = ~valid & sv
            if not take.any(): continue
            P[take] = np.roll(P, (dy, dx), (0, 1))[take]; N[take] = np.roll(N, (dy, dx), (0, 1))[take]; F[take] = np.roll(F, (dy, dx), (0, 1))[take]
            valid |= take
    F = np.maximum(F, 0)
    Pf = P.reshape(-1, 3); Nf = N.reshape(-1, 3); Nf /= np.maximum(np.linalg.norm(Nf, axis=1, keepdims=True), 1e-6)
    # the lie in UV space: per triangle dP/du and dP/dv, then each texel's 3D direction solved into (du, dv)
    p0, p1, p2 = co[tv[:, 0]], co[tv[:, 1]], co[tv[:, 2]]
    t0, t1, t2 = uv[tl[:, 0]], uv[tl[:, 1]], uv[tl[:, 2]]
    E1, E2 = p1 - p0, p2 - p0; D1, D2 = t1 - t0, t2 - t0
    det = D1[:, 0] * D2[:, 1] - D1[:, 1] * D2[:, 0]
    det = np.where(np.abs(det) < 1e-12, 1e-12, det)
    Tu = (E1 * D2[:, 1:2] - E2 * D1[:, 1:2]) / det[:, None]
    Tv = (E2 * D1[:, 0:1] - E1 * D2[:, 0:1]) / det[:, None]
    f = flow3(Pf, Nf)
    Ff = F.ravel()
    tu, tv_ = Tu[Ff], Tv[Ff]
    g11 = np.sum(tu * tu, 1); g12 = np.sum(tu * tv_, 1); g22 = np.sum(tv_ * tv_, 1)
    r1 = np.sum(tu * f, 1); r2 = np.sum(tv_ * f, 1)
    gd = g11 * g22 - g12 * g12; gd = np.where(np.abs(gd) < 1e-12, 1e-12, gd)
    a = (g22 * r1 - g12 * r2) / gd; b = (g11 * r2 - g12 * r1) / gd
    ln = np.maximum(np.hypot(a, b), 1e-9)
    du, dv = (a / ln).reshape(S, S).astype(np.float32), (b / ln).reshape(S, S).astype(np.float32)
    # strands: noise smeared along the lie (fine hairs and coarser locks)
    rng = np.random.default_rng(7)
    rows, cols = np.mgrid[0:S, 0:S].astype(np.float32)
    def lic(noise, steps, step):
        acc = np.zeros((S, S), np.float32); ws = 0.0
        for k in range(-steps, steps + 1):
            w = 0.5 + 0.5 * math.cos(math.pi * k / (steps + 1))
            cc = np.rint(cols + du * k * step).astype(np.int32) % S
            rr = np.rint(rows + dv * k * step).astype(np.int32) % S
            acc += noise[rr, cc] * w; ws += w
        acc /= ws
        return (acc - acc.mean()) / max(acc.std(), 1e-6)
    fine = lic(rng.random((S, S)).astype(np.float32), 9, 1.2)
    coarse_n = rng.random((S // 4, S // 4)).astype(np.float32)
    coarse_n = np.kron(coarse_n, np.ones((4, 4), np.float32))
    coarse = lic(coarse_n, 10, 3.0)
    clump = vnoise3(Pf, 0.045, 11).reshape(S, S) - 0.5
    h = np.clip(0.5 + fine * 0.16 + coarse * 0.14 + clump * 0.55, 0, 1)
    gy, gx = np.gradient(h)
    k = 2.6
    nm = np.dstack([-gx * k, -gy * k, np.ones_like(h)]); nm /= np.linalg.norm(nm, axis=2, keepdims=True)
    # colour by region (sRGB): cream; the back and the rump yellower; the face greyer and the muzzle
    # darker with the black skin showing through its short fur; the ear cups grey; the feet dirty
    x, y, z = Pf[:, 0], Pf[:, 1], Pf[:, 2]
    nz = Nf[:, 2]
    col = np.tile(np.array([[0.9, 0.87, 0.78]], np.float32), (S * S, 1))
    def mix(c, w): return col * (1 - w)[:, None] + np.array(c, np.float32)[None] * w[:, None]
    col = mix((0.88, 0.8, 0.6), (sstep((z - 0.85) / 0.35) * sstep((0.4 - y) / 0.8) * 0.75 + sstep((-nz - 0.2) / 0.5) * sstep((0.75 - z) / 0.3) * 0.35).astype(np.float32))
    col = mix((0.8, 0.79, 0.76), sstep((y - 1.12) / 0.12).astype(np.float32) * 0.7)
    col = mix((0.56, 0.54, 0.52), sstep((y - 1.44) / 0.1).astype(np.float32) * 0.8)
    col = mix((0.62, 0.6, 0.58), (sstep((z - 1.13) / 0.04) * sstep((y - 1.04) / 0.03) * sstep((1.2 - y) / 0.03) * sstep((Nf[:, 1] - 0.1) / 0.4)).astype(np.float32))
    col = mix((0.7, 0.66, 0.58), (sstep((0.24 - z) / 0.2) * 0.7).astype(np.float32))
    col = mix((0.5, 0.47, 0.42), (sstep((0.07 - z) / 0.05) * 0.7).astype(np.float32))
    col *= (1 - 0.07 * vnoise3(Pf, 0.25, 12))[:, None]
    col *= (0.7 + 0.42 * h.reshape(-1))[:, None]
    col = np.clip(col, 0, 1).reshape(S, S, 3)
    return col, (nm * 0.5 + 0.5).astype(np.float32)

def materials(me):
    col, nrm = bake_coat(me, TEX)
    M = {}
    M['coat'] = C.mat_textured('Bear_Coat', base=C.image_tex('Bear_Coat_tex', col), normal=C.image_tex('Bear_Coat_nrm', nrm, 'Non-Color'), rough=0.86, normal_strength=1.0)
    M['skin'] = C.mat('Bear_Skin', (0.018, 0.016, 0.016), 0.34)
    M['eye'] = C.mat('Bear_Eye', (0.03, 0.015, 0.008), 0.06)
    M['claw'] = C.mat('Bear_Claw', (0.045, 0.038, 0.034), 0.38)
    M['mouth'] = C.mat('Bear_Mouth', (0.13, 0.035, 0.04), 0.5)
    M['tongue'] = C.mat('Bear_Tongue', (0.1, 0.07, 0.12), 0.32)
    M['teeth'] = C.mat('Bear_Teeth', (0.74, 0.67, 0.5), 0.3)
    return M

# ---------------------------------------------------------------- the parts
def new_obj(name, bm, mat):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return o

def ellipsoid(name, c, radii, mat, segs=16, flip=False):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(6, segs // 2), radius=1)
    bmesh.ops.scale(bm, vec=radii, verts=bm.verts); bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    if flip: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return new_obj(name, bm, mat)

def claw(name, base, d, length, mat):
    """a curved claw: laterally flattened, tapering, bending down to the point"""
    bm = bmesh.new()
    d = Vector(d).normalized()
    pts = [Vector(base) + d * length * t + Vector((0, 0, -0.45 * length * t * t)) for t in (0, 0.3, 0.6, 0.85, 1.0)]
    rings = []
    for k, p in enumerate(pts):
        r = 0.0115 * (1 - 0.9 * (k / 4) ** 1.2)
        tg = (pts[min(k + 1, 4)] - pts[max(k - 1, 0)]).normalized()
        a = tg.cross(Vector((0, 0, 1))).normalized(); b = a.cross(tg).normalized()
        rings.append([bm.verts.new(p + (a * math.cos(2 * math.pi * i / 8) * 0.75 + b * math.sin(2 * math.pi * i / 8) * 1.25) * r) for i in range(8)])
    for k in range(4):
        for i in range(8):
            j = (i + 1) % 8
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    tip = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.004)
    for i in range(8): bm.faces.new((rings[-1][i], rings[-1][(i + 1) % 8], tip))
    return new_obj(name, bm, mat)

def tooth(name, base, L, up, r, mat, lean=(0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=7, radius1=r, radius2=r * 0.12, depth=L)
    bmesh.ops.translate(bm, vec=(0, 0, L / 2), verts=bm.verts)          # base at 0, point at +L
    rot = Matrix.Rotation(math.pi if up else 0.0, 3, 'X') @ Matrix.Rotation(lean[0], 3, 'Y') @ Matrix.Rotation(lean[1], 3, 'X')
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, vec=base, verts=bm.verts)
    return new_obj(name, bm, mat)

def mouth_parts(L, M):
    """returns [(object, 'head' | 'jaw' | 'split')]: the cavity (its faces turned inward, so from
    outside the open mouth shows its far wall), the tongue, the teeth"""
    out = []
    yc, yf = L['yc'], L['yf']
    ym = (yc + yf) / 2 - 0.012
    zm = zlip(L, ym)
    out.append((ellipsoid('Bear_mouth', (0, ym, zm), (side_x(L, ym) - 0.008, (yf - yc) / 2 - 0.002, 0.022), M['mouth'], 20, flip=True), 'split'))
    out.append((ellipsoid('Bear_tongue', (0, ym - 0.012, zm - 0.016), (0.03, (yf - yc) / 2 - 0.032, 0.009), M['tongue'], 14), 'jaw'))
    def at(y, inset): return side_x(L, y) - inset
    for up in (True, False):
        zz = lambda y: zlip(L, y) + (0.004 if up else -0.004)
        jaw = 'head' if up else 'jaw'
        for s in (1, -1):
            # the canines (the lower ones sit just in front of the upper)
            yy = yf - (0.046 if up else 0.03)
            out.append((tooth('Bear_tooth', (s * at(yy, 0.011), yy, zz(yy)), 0.03 if up else 0.024, up, 0.0068, M['teeth'], (s * -0.12 if up else s * 0.12, 0.1 if up else -0.1)), jaw))
            # the incisors across the front
            for k, xx in enumerate((0.007, 0.016, 0.025)):
                yy = yf - 0.012 - (xx / 0.03) ** 2 * 0.012 - (0.0 if up else 0.005)
                out.append((tooth('Bear_tooth', (s * xx, yy, zz(yy)), 0.011 + 0.002 * k, up, 0.0036, M['teeth']), jaw))
            # premolars and molars along the sides
            for k, back in enumerate((0.075, 0.1, 0.13, 0.16)):
                yy = yf - back
                if yy < yc + 0.01: continue
                out.append((tooth('Bear_tooth', (s * at(yy, 0.014), yy, zz(yy)), 0.008 + 0.002 * k, up, 0.005 + 0.0008 * k, M['teeth']), jaw))
    return out

# ---------------------------------------------------------------- the skeleton
BONES = [
    ('root', (0, -0.2, 0.0), (0, 0.3, 0.0), None),
    ('hips', (0, -0.62, 0.92), (0, -0.2, 0.9), 'root'),
    ('spine', (0, -0.2, 0.9), (0, 0.25, 0.92), 'hips'),
    ('chest', (0, 0.25, 0.92), (0, 0.6, 0.97), 'spine'),
    ('neck1', (0, 0.6, 0.97), (0, 0.84, 1.0), 'chest'),
    ('neck2', (0, 0.84, 1.0), (0, 1.04, 1.03), 'neck1'),
    ('head', (0, 1.04, 1.03), (0, 1.5, 1.0), 'neck2'),
    ('jaw', (0, 1.17, 0.98), (0, 1.5, 0.95), 'head'),
    ('ear.R', (0.1, 1.1, 1.14), (0.11, 1.1, 1.22), 'head'), ('ear.L', (-0.1, 1.1, 1.14), (-0.11, 1.1, 1.22), 'head'),
    ('tail', (0, -1.0, 0.95), (0, -1.13, 0.95), 'hips'),
]
for s, L in ((1, 'R'), (-1, 'L')):                                  # (the bear faces +y: its right is +x)
    BONES += [
        (f'shoulder.{L}', (s * 0.14, 0.52, 0.98), (s * 0.21, 0.56, 0.86), 'chest'),
        (f'upperarm.{L}', (s * 0.21, 0.56, 0.86), (s * 0.245, 0.45, 0.5), f'shoulder.{L}'),
        (f'forearm.{L}', (s * 0.245, 0.45, 0.5), (s * 0.24, 0.54, 0.14), f'upperarm.{L}'),
        (f'hand.{L}', (s * 0.24, 0.54, 0.14), (s * 0.24, 0.66, 0.05), f'forearm.{L}'),
        (f'fingers.{L}', (s * 0.24, 0.66, 0.05), (s * 0.24, 0.79, 0.04), f'hand.{L}'),
        (f'thigh.{L}', (s * 0.19, -0.72, 0.84), (s * 0.245, -0.52, 0.5), 'hips'),
        (f'shin.{L}', (s * 0.245, -0.52, 0.5), (s * 0.255, -0.78, 0.14), f'thigh.{L}'),
        (f'foot.{L}', (s * 0.255, -0.78, 0.14), (s * 0.25, -0.55, 0.05), f'shin.{L}'),
        (f'toes.{L}', (s * 0.25, -0.55, 0.05), (s * 0.25, -0.4, 0.04), f'foot.{L}'),
    ]

def make_armature(coll):
    ad = bpy.data.armatures.new('Bear')
    ao = bpy.data.objects.new('Bear', ad); coll.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    with bpy.context.temp_override(active_object=ao, object=ao, selected_objects=[ao], selected_editable_objects=[ao]):
        bpy.ops.object.mode_set(mode='EDIT')
        eb = ad.edit_bones
        for bn, h, t, par in BONES:
            b = eb.new(bn); b.head = h; b.tail = t
            if par: b.parent = eb[par]; b.use_connect = False
        for b in eb:
            dd = (b.tail - b.head).normalized()
            zz = Vector((1, 0, 0)).cross(dd)
            if zz.length > 1e-3: b.align_roll(zz.normalized())       # local x = world x
            if b.name == 'root': b.use_deform = False
        bpy.ops.object.mode_set(mode='OBJECT')
    return ao

def bind_auto(mesh, arm):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    mesh.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    with bpy.context.temp_override(active_object=arm, object=arm, selected_objects=[mesh, arm], selected_editable_objects=[mesh, arm]):
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    w = {g.index: 0 for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        for g in v.groups:
            if g.weight > 0.01: w[g.group] += 1
    return {mesh.vertex_groups[i].name: n for i, n in w.items()}

def set_weights(o, i, wd):
    names = {g.name: g for g in o.vertex_groups}
    v = o.data.vertices[i]
    for g in list(v.groups):
        nm = o.vertex_groups[g.group].name
        if nm not in wd: o.vertex_groups[g.group].remove([i])
    tot = sum(wd.values()) or 1
    for nm, w in wd.items(): names[nm].add([i], w / tot, 'REPLACE')

def split_muzzle(o, lower, L):
    """the jaw's weights from the cut: along the slit, below it the lower jaw and above it the head
    alone; behind the mouth's corners a blend across the line (the cheek stretches as the jaw
    drops), fading in from the hinge under the ear"""
    me = o.data
    pno = Vector((0, -L['slope'], 1)).normalized(); pco = Vector((0, L['yf'], L['zf']))
    n = 0
    for v in me.vertices:
        y = v.co.y
        if y < 1.13: continue
        below = -(v.co - pco).dot(pno)
        hinge = float(sstep((y - 1.15) / 0.12))
        if y > L['yc']: wj = (1.0 if lower[v.index] else 0.0) * hinge
        else: wj = float(sstep((below + 0.02) / 0.045)) * hinge
        if wj > 1e-3:
            old = {o.vertex_groups[g.group].name: g.weight for g in v.groups if o.vertex_groups[g.group].name != 'jaw'}
            if y > 1.2: old = {'head': 1.0}
            tot = sum(old.values()) or 1
            wd = {k: w / tot * (1 - wj) for k, w in old.items() if w / tot * (1 - wj) > 1e-3}
            wd['jaw'] = wj
            set_weights(o, v.index, wd); n += 1
        elif y > 1.2:
            set_weights(o, v.index, {'head': 1.0}); n += 1
    return n

def weight_part(part, body, kd, bw, how, L):
    """a part's vertex groups in the body's order (so the join keeps them), weighted rigidly"""
    for g in body.vertex_groups: part.vertex_groups.new(name=g.name)
    G = {g.name: g for g in part.vertex_groups}
    if how in ('head', 'jaw'):
        G[how].add(list(range(len(part.data.vertices))), 1.0, 'REPLACE'); return
    if how == 'split':                                              # the cavity: its floor follows the jaw
        for v in part.data.vertices:
            wj = float(np.clip((zlip(L, v.co.y) - v.co.z) / 0.012 + 0.5, 0, 1))
            if wj < 1: G['head'].add([v.index], 1 - wj, 'REPLACE')
            if wj > 0: G['jaw'].add([v.index], wj, 'REPLACE')
        return
    # 'near': the weights of the body where the part sits (the claws)
    c = Vector(np.mean([v.co[:] for v in part.data.vertices], 0))
    _, idx, _ = kd.find(c)
    for nm, w in bw[idx].items(): G[nm].add(list(range(len(part.data.vertices))), w, 'REPLACE')

# ---------------------------------------------------------------- the clips
def pose_fn(**k):
    """a pose from named joint angles (degrees) and the root's offsets (metres)"""
    out = {}
    def put(b, q, loc=None): out[b] = (q, loc)
    put('root', Q(Z, k.get('yaw', 0)) @ Q(Y, k.get('roll', 0)) @ Q(X, k.get('pitch', 0)), Vector((k.get('sway', 0), k.get('fwd', 0), k.get('lift', 0))))
    put('hips', Q(X, k.get('hips', 0)) @ Q(Y, k.get('hroll', 0)))
    put('spine', Q(X, k.get('spine', 0)) @ Q(Z, k.get('spine_yaw', 0)))
    put('chest', Q(X, k.get('chest', 0)) @ Q(Y, k.get('croll', 0)))
    nk, lk = k.get('neck', 0), k.get('look', 0)
    put('neck1', Q(Z, lk * 0.3) @ Q(X, nk * 0.5))
    put('neck2', Q(Z, lk * 0.3) @ Q(X, nk * 0.5))
    put('head', Q(Z, lk * 0.4) @ Q(X, k.get('head', 0)) @ Q(Y, k.get('tilt', 0)))
    put('jaw', Q(X, -k.get('jaw', 0)))
    put('ear.L', Q(X, k.get('ears', 0))); put('ear.R', Q(X, k.get('ears', 0)))
    put('tail', Q(X, k.get('tail', 0)))
    for L in ('L', 'R'):
        f = k.get('front' + L, (0, 0, 0, 0))     # upper arm swing, elbow, wrist, toes
        h = k.get('hind' + L, (0, 0, 0, 0))      # thigh swing, stifle, hock, toes
        put(f'shoulder.{L}', Q(X, f[0] * 0.3))
        put(f'upperarm.{L}', Q(X, f[0]) @ Q(Z, k.get('side' + L, 0)))
        put(f'forearm.{L}', Q(X, f[1]))
        put(f'hand.{L}', Q(X, f[2]))
        put(f'fingers.{L}', Q(X, f[3]))
        put(f'thigh.{L}', Q(X, h[0]))
        put(f'shin.{L}', Q(X, h[1]))
        put(f'foot.{L}', Q(X, h[2]))
        put(f'toes.{L}', Q(X, h[3]))
    return out

def gait(t, L, offs, A, duty, lift=1.0, bounce=0.02, sway=0.02, bob=4, lookamp=5, wave=2, wavek=2):
    """a gait from each leg's phase offset: stance (the paw planted, sweeping back, kept flat) and
    swing (folded, lifted, brought forward)"""
    ph = t / L
    k = {}
    for leg, off in offs.items():
        p = (ph + off) % 1.0
        if p < duty: u = p / duty; sw = A * (1 - 2 * u); fold = 0.0
        else: u = (p - duty) / (1 - duty); sw = A * (-1 + 2 * SM(u)); fold = math.sin(u * math.pi)
        if leg[0] == 'f':
            up = sw; fo = 4 + 50 * fold * lift
            k['front' + leg[1]] = (up, fo, -(up + fo) - 40 * fold * lift, -15 * fold * lift)
        else:
            th = sw * 0.9; sh = -4 - 45 * fold * lift
            k['hind' + leg[1]] = (th, sh, -(th + sh) - 20 * fold * lift, 10 * fold * lift)
    w = 2 * math.pi * ph
    k.update(lift=bounce * math.sin(2 * w), sway=sway * math.sin(w), head=bob * math.sin(2 * w + 0.6), look=lookamp * math.sin(w),
             spine=wave * math.sin(wavek * w + 1.2), hroll=3 * math.sin(w), croll=-3 * math.sin(w + 0.5))
    return k

WALK = {'hL': 0.0, 'fL': 0.25, 'hR': 0.5, 'fR': 0.75}
TROT = {'fL': 0.0, 'hR': 0.0, 'fR': 0.5, 'hL': 0.5}
GALLOP = {'hL': 0.0, 'hR': 0.1, 'fL': 0.5, 'fR': 0.6}

# nominal ground speeds (m/s) of the gait clips, for the game to match the playback rate
SPEEDS = {'walk': 0.85, 'stalk': 0.5, 'trot': 1.9, 'charge': 5.5}

def clips():
    out = {}
    def idle(t):
        br = osc(t, 8, 3)
        return pose_fn(spine=br * 1.0, chest=br * 1.4, look=14 * osc(t, 8, 1) + 5 * osc(t, 8, 3, 1), head=-4 + 3 * osc(t, 8, 2, 0.5),
                       ears=-4 + 8 * max(0.0, osc(t, 8, 5)) ** 8, sway=0.01 * osc(t, 8, 1, 2), neck=-8 + 2 * osc(t, 8, 1), jaw=1.5 + br)
    out['idle'] = (idle, 8.0, True)
    out['sniff_air'] = (lambda t: pose_fn(neck=20, head=20 + 2.5 * osc(t, 4, 14), look=16 * osc(t, 4, 1), jaw=3, ears=-6, chest=3, tilt=6 * osc(t, 4, 1, 1)), 4.0, True)
    out['sniff_ground'] = (lambda t: pose_fn(neck=-36 + 4 * osc(t, 4, 2), head=-20 + 3 * osc(t, 4, 12), look=14 * osc(t, 4, 1), jaw=2, ears=-4,
                                             frontL=(6, 6, -12, 0), frontR=(6, 6, -12, 0), chest=-4), 4.0, True)
    out['walk'] = (lambda t: pose_fn(**{**gait(t, 1.1, WALK, 24, 0.62, 1.0, 0.015, 0.025, 3, 6, 2), 'neck': -10}), 1.1, True)
    out['stalk'] = (lambda t: pose_fn(**{**gait(t, 1.6, WALK, 20, 0.66, 0.8, 0.01, 0.015, 1.5, 2, 1.5), 'neck': -22, 'head': 12, 'ears': 10, 'chest': -3}), 1.6, True)
    out['trot'] = (lambda t: pose_fn(**{**gait(t, 0.7, TROT, 28, 0.5, 1.2, 0.035, 0.02, 4, 4, 3), 'neck': -6}), 0.7, True)
    def charge(t):
        k = gait(t, 0.5, GALLOP, 34, 0.4, 1.4, 0.07, 0.0, 6, 0, 10, wavek=1)
        k.update(neck=-8, ears=24, jaw=8, pitch=4 * osc(t, 0.5, 1))
        return pose_fn(**k)
    out['charge'] = (charge, 0.5, True)
    def rear(t):
        # up on the hind legs, the threat display: the hips tip the body up, the legs stay under it
        u = ease(t, 0.0, 0.9) * (1 - ease(t, 2.6, 3.4))
        jo = ease(t, 0.9, 1.2) * (1 - ease(t, 2.2, 2.6))
        hp = 64 * u; th = -hp + 6 * u; sh = -10 * u
        return pose_fn(lift=0.17 * u, hips=hp, spine=-4 * u, chest=-6 * u, neck=-30 * u, head=-18 * u + 4 * math.sin(t * 20) * jo,
                       frontL=(-40 * u, 55 * u, -45 * u, -10 * u), frontR=(-36 * u, 60 * u, -50 * u, -10 * u),
                       hindL=(th, sh, -(hp + th + sh), 0), hindR=(th, sh, -(hp + th + sh), 0), jaw=22 * jo, ears=18 * u, tail=20 * u)
    out['rear'] = (rear, 3.4, False)
    def swipe(t):
        a = ease(t, 0.0, 0.28) * (1 - ease(t, 0.28, 0.5))
        b = ease(t, 0.28, 0.45) * (1 - ease(t, 0.65, 1.1))
        e = a + b * 0.6
        return pose_fn(hips=18 * e, lift=0.05 * e, chest=-6 * a + 6 * b, croll=-14 * b, look=18 * b, head=-8 * b, jaw=20 * b, ears=22,
                       frontR=(75 * a + 30 * b, 70 * a + 10 * b, -40 * a, -10 * a), sideR=40 * b, frontL=(20 * e, 30 * e, -20 * e, 0),
                       hindL=(-18 * e, 0, 0, 0), hindR=(-18 * e, 0, 0, 0))
    out['swipe'] = (swipe, 1.1, False)
    def bite(t):
        u = ease(t, 0.0, 0.18) * (1 - ease(t, 0.35, 0.75))
        snap = ease(t, 0.18, 0.28) * (1 - ease(t, 0.4, 0.75))
        return pose_fn(fwd=0.12 * u, chest=-6 * u, neck=6 * u, head=-10 * u + 12 * snap, jaw=34 * (ease(t, 0.0, 0.14) - ease(t, 0.18, 0.26)) + 4 * u,
                       frontL=(-12 * u, 8 * u, 4 * u, 0), frontR=(-12 * u, 8 * u, 4 * u, 0), hindL=(-8 * u, 0, 8 * u, 0), hindR=(-8 * u, 0, 8 * u, 0), ears=24 * u)
    out['bite'] = (bite, 0.8, False)
    def roar(t):
        u = ease(t, 0.0, 0.45) * (1 - ease(t, 1.9, 2.5))
        return pose_fn(chest=-5 * u, hips=-3 * u, neck=-14 * u, head=16 * u + 2.5 * math.sin(t * 38) * u, jaw=34 * u, ears=26 * u, lift=-0.03 * u,
                       frontL=(-8 * u, 10 * u, -2 * u, 0), frontR=(-8 * u, 10 * u, -2 * u, 0))
    out['roar'] = (roar, 2.5, False)
    def lunge(t):
        # the jump scare: up, and down on whoever is in front with both paws and the jaws open
        a = ease(t, 0.0, 0.22); b = ease(t, 0.22, 0.42); c = ease(t, 0.75, 1.4)
        hp = (34 * a - 46 * b) * (1 - c)
        th = -hp; sh = -8 * a * (1 - c)
        return pose_fn(hips=hp, fwd=0.85 * b * (1 - c), lift=(0.08 * a - 0.06 * b) * (1 - c), neck=(-6 * a + 10 * b) * (1 - c),
                       head=(-10 * a + 6 * b + 3 * math.sin(t * 40) * b) * (1 - c), jaw=(10 * a + 32 * b) * (1 - ease(t, 0.9, 1.3)), ears=26 * (1 - c),
                       frontL=((60 * a - 35 * b) * (1 - c), (60 * a - 50 * b) * (1 - c), (-30 * a + 20 * b) * (1 - c), 0),
                       frontR=((56 * a - 32 * b) * (1 - c), (64 * a - 52 * b) * (1 - c), (-30 * a + 20 * b) * (1 - c), 0),
                       hindL=(th, sh, -(hp + th + sh), 0), hindR=(th, sh, -(hp + th + sh), 0))
    out['lunge'] = (lunge, 1.4, False)
    def hurt(t):
        u = ease(t, 0.0, 0.07) * (1 - ease(t, 0.15, 0.6))
        return pose_fn(yaw=8 * u, croll=12 * u, look=-26 * u, head=-10 * u, jaw=16 * u, ears=30 * u, sway=0.05 * u, lift=-0.03 * u)
    out['hurt'] = (hurt, 0.6, False)
    def death(t):
        b = ease(t, 0.0, 0.6); f = ease(t, 0.45, 1.5); s = ease(t, 1.5, 2.4)
        return pose_fn(roll=86 * f, lift=-0.12 * b * (1 - f) + 0.34 * f, sway=-0.05 * f, neck=-14 * b, look=-28 * f, head=-8 * b - 6 * s, jaw=8 * f + 4 * s, ears=10 * f,
                       frontR=(-10 * b + 30 * f, 40 * b, -30 * b, 0), frontL=(-10 * b - 12 * f, 40 * b - 30 * f, -30 * b + 10 * f, 0),
                       hindR=(10 * b + 20 * f, -30 * b, 20 * b, 0), hindL=(10 * b - 20 * f, -30 * b + 20 * f, 20 * b, 0), tail=10 * f)
    out['death'] = (death, 2.4, False)
    out['eat'] = (lambda t: pose_fn(neck=-40 + 5 * osc(t, 3, 2), head=-24 + 10 * max(0.0, osc(t, 3, 3)), look=10 * osc(t, 3, 1), jaw=16 * max(0.0, osc(t, 3, 6)),
                                    frontL=(14, 18, -32, 0), frontR=(18, 22, -40, 0), chest=-6, hips=2, ears=4), 3.0, True)
    return out

def key_clips(arm, clipset):
    arm.animation_data_create()
    for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
    for name, (fn, L, loop) in clipset.items():
        act = bpy.data.actions.new('Bear_' + name)
        arm.animation_data.action = act
        n = round(L * FPS)
        for f in list(range(0, n + 1, 2)) + ([n] if n % 2 else []):
            t = (f % n) / FPS if loop else f / FPS
            pose = fn(t)
            for pb in arm.pose.bones:
                q, l = pose.get(pb.name, (None, None))
                pb.rotation_quaternion = q if q is not None else Quaternion()
                pb.location = l if l is not None else (0, 0, 0)
                pb.keyframe_insert('rotation_quaternion', frame=f)
                if pb.name == 'root': pb.keyframe_insert('location', frame=f)
        act.use_fake_user = True
        tr = arm.animation_data.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 0, act)
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0)

# ---------------------------------------------------------------- the build
def build(stage):
    sc = C.fresh_scene('ASSET_bear')
    coll = sc.collection
    info = {}
    body = raw_body()
    info['dense_tris'] = C.tris(body)
    L = landmarks(body)
    info['nose'] = [round(v, 3) for v in L['nose']]; info['yf'] = round(L['yf'], 3); info['zf'] = round(L['zf'], 3)
    if stage == 'form':
        for p in body.data.polygons: p.use_smooth = True
        return sc, None, body, info
    sculpt(body, L)
    decimate(body, int(globals().get('TRIS', 34000)))
    lower, info['lip_edges'] = cut_mouth(body, L)
    me = body.data
    for p in me.polygons: p.use_smooth = True
    info['uv'] = smart_uv(body)
    M = materials(me)
    me.materials.clear(); me.materials.append(M['coat']); me.materials.append(M['skin'])
    info['skin_faces'] = skin_faces(body, L)
    # vertex colours: r fur length, g blood
    co = get_co(me); nr = get_nr(me)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    face = sstep((y - 1.18) / 0.22)
    length = 0.6 + 0.3 * sstep((0.68 - z) / 0.35) - 0.5 * face
    length += 0.3 * sstep((-nr[:, 1] - 0.3) / 0.4) * (z < 0.6) * (z > 0.15)
    length *= 1 - 0.85 * sstep((0.06 - z) / 0.04)
    length *= 1 - 0.9 * np.exp(-(np.linalg.norm(co - np.array(L['nose'], np.float32), axis=1) / 0.05) ** 2)
    blot = vnoise3(co, 0.05, 21) * 0.6 + vnoise3(co, 0.018, 22) * 0.4
    blood = sstep((y - 1.3) / 0.12) * sstep((1.04 - z) / 0.06) * 1.2 \
        + sstep((y - 0.55) / 0.15) * sstep((0.98 - y) / 0.1) * sstep((0.92 - z) / 0.2) * sstep(1 - np.abs(x) / 0.26) * 0.9 \
        + sstep((y - 0.42) / 0.1) * sstep((0.22 - z) / 0.12) * 0.8
    blood = np.clip(blood * sstep((blot - 0.38) / 0.2), 0, 1)
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.stack([np.clip(length, 0, 1), blood, np.zeros_like(z), np.ones_like(z)], 1).astype(np.float32).ravel())
    me.color_attributes.active_color = attr
    # the parts
    parts = []
    for side in ('R', 'L'):
        e, en = L['eye' + side]
        parts.append((ellipsoid('Bear_eye', e - en * 0.008, (0.0155, 0.0155, 0.0145), M['eye'], 14), 'head'))
    for kind, s, p, n, d, ln in L['claws']:
        parts.append((claw('Bear_claw', p - n * 0.004, d, ln, M['claw']), 'near'))
    parts += mouth_parts(L, M)
    if stage == 'parts':
        return sc, None, body, info
    arm = make_armature(coll)
    info['weights'] = bind_auto(body, arm)
    info['muzzle_split'] = split_muzzle(body, lower, L)
    kd = KDTree(len(me.vertices))
    for v in me.vertices: kd.insert(v.co, v.index)
    kd.balance()
    bw = [{body.vertex_groups[g.group].name: g.weight for g in v.groups if g.weight > 1e-3} for v in me.vertices]
    for o, how in parts: weight_part(o, body, kd, bw, how, L)
    mesh = C.join([body] + [o for o, _ in parts], 'Bear_mesh')
    if not any(m.type == 'ARMATURE' for m in mesh.modifiers):
        m = mesh.modifiers.new('Armature', 'ARMATURE'); m.object = arm
    key_clips(arm, clips())
    info['tris'] = C.tris(mesh)
    return sc, arm, mesh, info

def pose_preview(sc, arm, clip, frame):
    for tr in arm.animation_data.nla_tracks: tr.mute = True
    st = [tr for tr in arm.animation_data.nla_tracks if tr.name == clip][0].strips[0]
    arm.animation_data.action = st.action
    if hasattr(arm.animation_data, 'action_slot') and getattr(st, 'action_slot', None) is not None:
        arm.animation_data.action_slot = st.action_slot
    sc.frame_set(frame)

def export(sc, arm, mesh):
    path = os.path.join(C.raw_dir(), 'bear.glb')
    if bpy.context.window: bpy.context.window.scene = sc
    for o in sc.objects: o.select_set(o in (arm, mesh))
    for tr in arm.animation_data.nla_tracks: tr.mute = False
    arm.animation_data.action = None
    sc.frame_set(0)
    with bpy.context.temp_override(scene=sc):
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, use_active_scene=True, export_extras=True, export_yup=True,
                                  export_cameras=False, export_lights=False,
                                  export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=True,
                                  export_skins=True, export_vertex_color='ACTIVE', export_image_format='WEBP', export_image_quality=88)
    return [path, os.path.getsize(path)]

STAGE = globals().get('STAGE', 'all')
C.set_root(globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy'))
sc, arm, mesh, info = build(STAGE)
result = dict(info)
result['dims'] = [round(v, 3) for v in mesh.dimensions]
VIEWS = [('q', (3.0, 2.9, 1.5), (0, 0.15, 0.72), 40), ('side', (4.4, 0.15, 0.85), (0, 0.15, 0.72), 40),
         ('face', (0.78, 2.12, 1.26), (0, 1.33, 1.03), 50), ('front', (0.0, 3.6, 1.0), (0, 0.6, 0.8), 45)]
if globals().get('PREVIEW', False):
    if arm:
        for tr in arm.animation_data.nla_tracks: tr.mute = True
    result['previews'] = C.preview(sc, 'bear_' + STAGE, VIEWS, res=(900, 600), world_rgb=(0.42, 0.45, 0.5))
    for clip, frame, view in globals().get('POSES', []):
        pose_preview(sc, arm, clip, frame)
        v = [vv for vv in VIEWS if vv[0] == view][0]
        result['previews'] += C.preview(sc, f'bear_{clip}{frame}', [(view,) + v[1:]], res=(900, 600), world_rgb=(0.42, 0.45, 0.5))
    if arm:
        arm.animation_data.action = None
        for tr in arm.animation_data.nla_tracks: tr.mute = False
        sc.frame_set(0)
if arm and globals().get('EXPORT', True): result['export'] = export(sc, arm, mesh)
