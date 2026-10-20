# The ice: eight bergs, three floes, exported together to tools/blender/raw/icebergs.glb, one
# object per shape (ICE_<class>_<name>), each centred on its waterline (z = 0) so the game can
# instance it anywhere. Run through tools/blender/run.py.
#
#   tabular   a slab broken off an ice shelf: flat snow top 20 m up, sheer fluted cliffs, strata
#   pinnacle  a towering spire with a lower shoulder (the reference photo's berg)
#   dome      a rounded old berg, worn smooth by the sea
#   wedge     low at one end, a 26 m cliff at the other
#   drydock   two towers and a flooded channel between them
#   bit       a bergy bit: a house-sized chunk
#   growler   two car-sized chunks, almost awash
#   floes     three flat plates of sea ice with snow and a pressure ridge
#
# Method: overlapping primitives -> voxel remesh (one closed skin) -> planar calving cuts (sharp
# facets) -> remesh again -> noise displacement (vertical fluting on the cliffs, strata, small
# chips) -> decimate to budget. Vertex colours: r = snow (up-facing, above the swash), g = cracks
# and dense blue ice (concave places, blue bands), b = cavity (darkening in the hollows).
import bpy, bmesh, math, os
from mathutils import Vector, Matrix
import numpy as np
import importlib
import common as C
importlib.reload(C)

# ---------------------------------------------------------------- noise (numpy value noise)
def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.uint64) * np.uint64(73856093)) ^ (iy.astype(np.uint64) * np.uint64(19349663)) ^ (iz.astype(np.uint64) * np.uint64(83492791)) ^ np.uint64(seed * 2654435761 % 4294967296)
    h = (h ^ (h >> np.uint64(13))) * np.uint64(1274126177)
    h = h ^ (h >> np.uint64(16))
    return (h & np.uint64(0xFFFFFF)).astype(np.float64) / float(0xFFFFFF)

def vnoise(p, seed=0):
    p = np.asarray(p, np.float64)
    i = np.floor(p).astype(np.int64); f = p - i; u = f * f * (3 - 2 * f)
    i = i + 1000000   # (positive for the unsigned hash)
    def h(dx, dy, dz): return _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    x0 = h(0, 0, 0) * (1 - u[:, 0]) + h(1, 0, 0) * u[:, 0]
    x1 = h(0, 1, 0) * (1 - u[:, 0]) + h(1, 1, 0) * u[:, 0]
    x2 = h(0, 0, 1) * (1 - u[:, 0]) + h(1, 0, 1) * u[:, 0]
    x3 = h(0, 1, 1) * (1 - u[:, 0]) + h(1, 1, 1) * u[:, 0]
    y0 = x0 * (1 - u[:, 1]) + x1 * u[:, 1]; y1 = x2 * (1 - u[:, 1]) + x3 * u[:, 1]
    return y0 * (1 - u[:, 2]) + y1 * u[:, 2]

def fbm(p, octaves=4, seed=0, lac=2.03, gain=0.5):
    s = np.zeros(len(p)); a = 0.5; q = np.array(p, np.float64)
    for o in range(octaves):
        s += a * vnoise(q, seed + o * 17); q = q * lac + 3.17; a *= gain
    return s

# ---------------------------------------------------------------- geometry helpers
def bm_add_box(bm, c, s, rot=(0, 0, 0)):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=s, verts=r['verts'])
    m = (Matrix.Rotation(rot[2], 3, 'Z') @ Matrix.Rotation(rot[1], 3, 'Y') @ Matrix.Rotation(rot[0], 3, 'X'))
    bmesh.ops.rotate(bm, verts=r['verts'], cent=(0, 0, 0), matrix=m)
    bmesh.ops.translate(bm, vec=c, verts=r['verts'])

def bm_add_blob(bm, c, s, sub=3):
    r = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    bmesh.ops.scale(bm, vec=s, verts=r['verts'])
    bmesh.ops.translate(bm, vec=c, verts=r['verts'])

def obj(name, bm, coll):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); coll.objects.link(o)
    return o

def remesh(o, voxel):
    m = o.modifiers.new('rm', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = voxel; m.use_smooth_shade = False
    C.apply_modifiers(o)

def cuts(o, planes):
    """calving: slice off everything beyond each plane (point, normal) and cap the hole"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    for co, no in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(o.data); bm.free()

def displace(o, fn):
    """move each vertex along its normal by fn(positions, normals) (numpy, metres)"""
    me = o.data
    me.update()
    n = len(me.vertices)
    co = np.zeros(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.zeros(n * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    d = fn(co, nr)
    co = co + nr * d[:, None]
    me.vertices.foreach_set('co', co.ravel()); me.update()

def decimate(o, tris):
    cur = C.tris(o)
    if cur <= tris: return
    m = o.modifiers.new('dc', 'DECIMATE'); m.ratio = tris / cur; m.use_collapse_triangulate = True
    C.apply_modifiers(o)

def colours(o, seed, snow_line=0.6, blue_bands=0.0):
    """r snow, g cracks/blue ice, b cavity (per vertex, from normals, curvature and noise)"""
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table(); bm.normal_update()
    n = len(bm.verts)
    co = np.array([v.co[:] for v in bm.verts]); nr = np.array([v.normal[:] for v in bm.verts])
    # concavity: how far the neighbours' centroid sits out along the normal (positive = a hollow)
    cav = np.zeros(n)
    for v in bm.verts:
        if not v.link_edges: continue
        c = sum((e.other_vert(v).co for e in v.link_edges), Vector()) / len(v.link_edges)
        cav[v.index] = (c - v.co).dot(v.normal)
    scale = max(1e-3, np.percentile(np.abs(cav), 90))
    cav = np.clip(cav / scale, -1, 1)
    bm.free()
    h = co[:, 2]
    top = np.clip((nr[:, 2] - 0.55) / 0.3, 0, 1)
    nz = fbm(co * np.array([0.08, 0.08, 0.08]), 3, seed)
    snow = top * np.clip((h - snow_line) / 0.8, 0, 1) * np.clip((nz - 0.25) * 3.5, 0, 1)
    band = 0.0
    if blue_bands:
        b = vnoise(co * np.array([0.02, 0.02, 0.35]) + 4.0, seed + 5)
        band = np.clip((b - 0.72) * 6, 0, 1) * blue_bands * (1 - top)
    crack = np.clip(cav * 1.6, 0, 1) * 0.85 + band
    crack = np.clip(crack + np.clip((vnoise(co * 0.5, seed + 9) - 0.82) * 4, 0, 0.4) * (1 - top), 0, 1)
    cavity = np.clip(cav, 0, 1) * 0.7
    if 'Col' in me.color_attributes: me.color_attributes.remove(me.color_attributes['Col'])
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    rgba = np.stack([snow, crack, cavity, np.ones(n)], 1).astype(np.float32)
    attr.data.foreach_set('color', rgba.ravel())
    me.color_attributes.active_color = attr
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(50))

# ---------------------------------------------------------------- the shapes
def cliff_noise(scale, flute=1.0, strata=0.0, seed=0, chip=0.25):
    """the displacement for an ice cliff: vertical fluting, horizontal strata, chips"""
    def fn(co, nr):
        side = 1 - np.abs(nr[:, 2])
        fl = fbm(co * np.array([0.25, 0.25, 0.035]) / scale * 6, 3, seed) - 0.5
        st = (vnoise(np.stack([co[:, 2] * 1.6 / scale * 6, co[:, 0] * 0.02, co[:, 1] * 0.02], 1), seed + 3) - 0.5) if strata else 0
        ch = fbm(co * 0.6 / scale * 6, 3, seed + 7) - 0.5
        return (fl * flute * side * 1.4 + st * strata * side + ch * chip) * scale
    return fn

def support_cuts(o, rng, n, tilt=(0.0, 0.9), keep=(0.55, 0.85), bottom=None, centre=(0, 0, 0)):
    """n calving planes at random azimuths: each slices off the outer part of the berg along its
    normal (tilted up by tilt radians: 0 is a vertical cliff, larger a slope toward the top)"""
    co = np.array([v.co[:] for v in o.data.vertices]) - np.array(centre)
    planes = []
    for k in range(n):
        az = rng.uniform(0, 2 * math.pi); t = rng.uniform(*tilt)
        nrm = np.array([math.cos(az) * math.cos(t), math.sin(az) * math.cos(t), math.sin(t)])
        d = (co @ nrm).max() * rng.uniform(*keep)
        planes.append((tuple(np.array(centre) + nrm * d), tuple(nrm)))
    if bottom is not None:
        planes.append(((0, 0, -bottom), (0, 0, -1)))
    cuts(o, planes)

def warp(o, amp, freq, seed):
    """bend the whole shape (before the cuts): no straight edge survives"""
    me = o.data; n = len(me.vertices)
    co = np.zeros(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    d = np.stack([fbm(co * freq, 3, seed + k * 11) - 0.5 for k in range(3)], 1) * amp * 2
    d[:, 2] *= 0.6
    me.vertices.foreach_set('co', (co + d).ravel()); me.update()

def notch(depth=0.9, width=0.7):
    """the sea wears a notch into the ice at the waterline"""
    return lambda co, nr: -depth * np.exp(-((co[:, 2] - 0.35) / width) ** 2) * (1 - np.abs(nr[:, 2]))

def combine(*fns):
    return lambda co, nr: sum(f(co, nr) for f in fns)

def make_tabular(coll, seed=11):
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bm_add_box(bm, (0, 0, 5), (58, 42, 32))
    bm_add_box(bm, (8, 6, 4), (40, 36, 30), (0, 0, 0.15))
    bm_add_box(bm, (-14, -6, 3), (30, 30, 28), (0, 0, -0.2))
    o = obj('ICE_berg_tabular', bm, coll)
    remesh(o, 1.4)
    warp(o, 3.0, 0.035, seed)
    cuts(o, [((0, 0, 20.0), (0.02, -0.01, 1)), ((0, 0, -11), (0, 0, -1))])
    support_cuts(o, rng, 12, tilt=(-0.15, 0.3), keep=(0.72, 0.94))
    remesh(o, 0.7)
    displace(o, combine(cliff_noise(1.0, flute=1.3, strata=0.5, seed=seed), notch(1.2, 0.8)))
    decimate(o, 11000)
    colours(o, seed, snow_line=8.0, blue_bands=0.6)
    return o

def make_pinnacle(coll, seed=23):
    """the towering, cracked berg of the reference: a jagged peak over a broad shoulder"""
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    # rounded masses leaning together (the cuts then give them facets)
    for c, sc_, rot in (((0, 0, 0), (21, 16, 13), (0, 0, 0.3)), ((-4, 2, 11), (11, 8.5, 21), (0.12, -0.1, 0.5)),
                        ((-8, 4, 25), (5.5, 4.5, 14), (0.25, -0.2, 0.9)), ((9, -5, 7), (10, 9, 11), (0.1, 0.2, -0.3)),
                        ((3, 7, 4), (9, 7, 9), (0, 0, 0.8))):
        r_ = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        bmesh.ops.scale(bm, vec=sc_, verts=r_['verts'])
        m_ = Matrix.Rotation(rot[2], 3, 'Z') @ Matrix.Rotation(rot[1], 3, 'Y') @ Matrix.Rotation(rot[0], 3, 'X')
        bmesh.ops.rotate(bm, verts=r_['verts'], cent=(0, 0, 0), matrix=m_)
        bmesh.ops.translate(bm, vec=c, verts=r_['verts'])
    o = obj('ICE_berg_pinnacle', bm, coll)
    remesh(o, 1.0)
    warp(o, 3.5, 0.04, seed)
    support_cuts(o, rng, 7, tilt=(0.5, 1.2), keep=(0.55, 0.85), centre=(-7, 4, 30))
    support_cuts(o, rng, 7, tilt=(0.25, 0.85), keep=(0.62, 0.88), centre=(-3, 2, 12))
    support_cuts(o, rng, 8, tilt=(-0.2, 0.3), keep=(0.72, 0.92), bottom=9)
    remesh(o, 0.55)
    displace(o, combine(cliff_noise(1.0, flute=1.6, strata=0.2, seed=seed, chip=0.4), notch(1.0, 0.7)))
    decimate(o, 11500)
    colours(o, seed, snow_line=3.0, blue_bands=0.8)
    return o

def make_dome(coll, seed=37):
    bm = bmesh.new()
    bm_add_blob(bm, (0, 0, 0), (19, 16, 18), 3)
    bm_add_blob(bm, (7, 3, 4), (11, 10, 12), 3)
    o = obj('ICE_berg_dome', bm, coll)
    remesh(o, 0.9)
    cuts(o, [((0, 0, -7), (0, 0, -1)), ((-15, 0, 0), (-1, 0.2, 0.3))])
    remesh(o, 0.6)
    displace(o, combine(lambda co, nr: (fbm(co * 0.07, 4, seed) - 0.5) * 3.0 + (fbm(co * 0.4, 3, seed + 1) - 0.5) * 0.5, notch(0.8, 0.9)))
    decimate(o, 7000)
    colours(o, seed, snow_line=4.0, blue_bands=0.4)
    return o

def make_wedge(coll, seed=41):
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bm_add_box(bm, (0, 0, 3), (46, 26, 22))
    bm_add_box(bm, (12, 0, 10), (22, 22, 30))
    o = obj('ICE_berg_wedge', bm, coll)
    remesh(o, 1.1)
    warp(o, 2.5, 0.04, seed)
    cuts(o, [((0, 0, 14), (-0.45, 0.05, 1)), ((0, 0, -8), (0, 0, -1))])
    support_cuts(o, rng, 9, tilt=(-0.15, 0.5), keep=(0.7, 0.93))
    remesh(o, 0.6)
    displace(o, combine(cliff_noise(1.0, flute=1.4, strata=0.6, seed=seed), notch(1.0, 0.8)))
    decimate(o, 9500)
    colours(o, seed, snow_line=3.0, blue_bands=0.6)
    return o

def make_drydock(coll, seed=53):
    """two towers on a low base, the sea washing through the channel between them"""
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bm_add_box(bm, (0, 0, -2), (50, 28, 10))
    bm_add_box(bm, (-15, 0, 12), (17, 22, 32), (0.05, 0, 0.12))
    bm_add_box(bm, (16, 2, 9), (15, 20, 26), (0, -0.06, -0.15))
    o = obj('ICE_berg_drydock', bm, coll)
    remesh(o, 1.0)
    warp(o, 2.8, 0.045, seed)
    cuts(o, [((0, 0, -7), (0, 0, -1)), ((0, 0, 1.2), (0, 0, 1))] if False else [((0, 0, -7), (0, 0, -1))])
    # the towers' tops: up-tilted cuts round each
    support_cuts(o, rng, 5, tilt=(0.55, 1.05), keep=(0.68, 0.88), centre=(-15, 0, 22))
    support_cuts(o, rng, 5, tilt=(0.55, 1.05), keep=(0.68, 0.88), centre=(16, 2, 18))
    support_cuts(o, rng, 6, tilt=(0.0, 0.3), keep=(0.75, 0.92))
    remesh(o, 0.55)
    # the channel: the low middle sits under the waterline
    displace(o, combine(cliff_noise(1.0, flute=1.5, strata=0.4, seed=seed), notch(1.0, 0.8),
                        lambda co, nr: -np.clip(1 - np.abs(co[:, 0] - 0.5) / 6.0, 0, 1) * np.clip(co[:, 2] + 1.0, 0, 3) * (np.abs(nr[:, 2]) > 0.6)))
    decimate(o, 11000)
    colours(o, seed, snow_line=2.0, blue_bands=0.7)
    return o

def make_bit(coll, seed=61):
    bm = bmesh.new()
    bm_add_blob(bm, (0, 0, 0.5), (6, 4.5, 4.5), 2)
    bm_add_box(bm, (1.5, 1, 1), (6, 5, 5), (0.3, 0.2, 0.5))
    o = obj('ICE_bit_a', bm, coll)
    remesh(o, 0.3)
    cuts(o, [((0, 0, 4.2), (0.3, 0.1, 1)), ((5, 0, 0), (1, 0.3, 0.2)), ((0, 0, -2.5), (0, 0, -1))])
    remesh(o, 0.22)
    displace(o, cliff_noise(0.25, flute=1.2, seed=seed, chip=0.5))
    decimate(o, 1800)
    colours(o, seed, snow_line=1.0, blue_bands=0.5)
    return o

def make_growler(coll, name, seed, s=(2.2, 1.7, 1.4)):
    bm = bmesh.new()
    bm_add_blob(bm, (0, 0, -0.2), s, 2)
    bm_add_box(bm, (0.5, 0.3, 0), (s[0] * 1.2, s[1] * 1.0, s[2] * 1.1), (0.4, 0.3, 0.9))
    o = obj(name, bm, coll)
    remesh(o, 0.14)
    cuts(o, [((0, 0, s[2] * 0.75), (0.2, 0.3, 1)), ((s[0] * 0.8, 0, 0), (1, 0.4, 0.2)), ((0, 0, -s[2]), (0, 0, -1))])
    remesh(o, 0.11)
    displace(o, lambda co, nr: (fbm(co * 1.1, 3, seed) - 0.5) * 0.35)
    decimate(o, 650)
    colours(o, seed, snow_line=0.3, blue_bands=0.3)
    return o

def make_floe(coll, name, seed, rx, ry, thick=0.7, ridge=False):
    """a plate of sea ice: an irregular outline, 0.25 m freeboard, broken rounded edges, snow"""
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    N = 26
    ang = np.linspace(0, 2 * np.pi, N, endpoint=False)
    rad = 1 + 0.18 * np.sin(ang * 3 + rng.uniform(0, 6)) + 0.1 * np.sin(ang * 5 + rng.uniform(0, 6)) + rng.uniform(-0.08, 0.08, N)
    pts = [(math.cos(a) * rx * r, math.sin(a) * ry * r) for a, r in zip(ang, rad)]
    top = 0.5; bot = top - thick
    vb = [bm.verts.new((x, y, bot)) for x, y in pts]
    vt = [bm.verts.new((x, y, top)) for x, y in pts]
    bm.faces.new(list(reversed(vb))); bm.faces.new(vt)
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    if ridge:
        # a pressure ridge: a jumble of slabs along a line across the floe
        for k in range(14):
            t = k / 13 - 0.5
            x = t * rx * 1.3; y = 0.25 * ry * math.sin(t * 3) + rng.uniform(-0.6, 0.6)
            bm_add_box(bm, (x, y, top + rng.uniform(0.2, 0.7)), (rng.uniform(0.8, 1.8), rng.uniform(0.4, 1.0), rng.uniform(0.4, 1.0)),
                       (rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(0, 3)))
    o = obj(name, bm, coll)
    remesh(o, 0.16)
    displace(o, lambda co, nr: (fbm(co * np.array([0.35, 0.35, 0.8]), 3, seed) - 0.5) * 0.28 * (1 - np.abs(nr[:, 2]) * 0.6) + (fbm(co * 2.0, 2, seed + 3) - 0.5) * 0.06)
    decimate(o, 1100 if ridge else 750)
    colours(o, seed, snow_line=0.05, blue_bands=0.0)
    return o

def build(root):
    C.set_root(root)
    sc = C.fresh_scene('ASSET_icebergs')
    coll = sc.collection
    mat = bpy.data.materials.get('Ice') or bpy.data.materials.new('Ice')
    mat.use_nodes = True
    nt = mat.node_tree; p = nt.nodes['Principled BSDF']
    for n in list(nt.nodes):
        if n.type == 'VERTEX_COLOR': nt.nodes.remove(n)
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (0.55, 0.78, 0.9, 1); mix.inputs['B'].default_value = (0.92, 0.95, 0.98, 1)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(vc.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Red'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.35
    made = [make_tabular(coll), make_pinnacle(coll), make_dome(coll), make_wedge(coll), make_drydock(coll), make_bit(coll),
            make_growler(coll, 'ICE_growler_a', 71), make_growler(coll, 'ICE_growler_b', 79, (1.6, 1.5, 1.0)),
            make_floe(coll, 'ICE_floe_a', 83, 6.5, 5.0, 1.1), make_floe(coll, 'ICE_floe_b', 89, 11.0, 7.5, 1.2), make_floe(coll, 'ICE_floe_c', 97, 9.0, 8.0, 1.2, ridge=True)]
    for o in made:
        o.data.materials.clear(); o.data.materials.append(mat)
    # far versions of the big pieces (the game swaps to them past ~450 m)
    lods = []
    for o in made:
        if not o.name.startswith(('ICE_berg', 'ICE_bit')): continue
        l = o.copy(); l.data = o.data.copy(); l.name = o.name + '_LOD1'; coll.objects.link(l)
        decimate(l, 2200 if 'berg' in o.name else 500)
        lods.append(l)
    made += lods
    # side by side for the preview (the export puts each back at the origin)
    x = 0
    lay = {}
    for o in made:
        w = o.dimensions.x
        lay[o.name] = (x + w / 2, 0)
        x += w + 8
    return sc, made, lay

if __name__ == '__main__' or True:
    ROOT_ = globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy')
    sc, made, lay = build(ROOT_)
    result = {o.name: [round(v, 1) for v in o.dimensions] + [C.tris(o)] for o in made}
    if globals().get('EXPORT', True):
        path = os.path.join(C.raw_dir(), 'icebergs.glb')
        result['export'] = [path, C.export_glb(sc, path, vcolors=True)]
    if globals().get('PREVIEW', False):
        for o in made: o.location = (lay[o.name][0], 0, 0)
        tot = sum(o.dimensions.x for o in made) + 8 * len(made)
        cams = [('row', (tot / 2, -tot * 0.62, tot * 0.2), (tot / 2, 0, 6), 35), ('big', (60, -95, 30), (60, 0, 8), 35)]
        result['previews'] = C.preview(sc, 'icebergs', cams, res=(1280, 540), world_rgb=(0.3, 0.38, 0.48))
        for o in made: o.location = (0, 0, 0)
