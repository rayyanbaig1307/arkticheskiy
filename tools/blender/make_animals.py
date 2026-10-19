# The animals on the ice: a walrus and an Adélie penguin, each lofted from cross-sections,
# rigged with a small skeleton of their own and animated with keyed clips; exported to
# tools/blender/raw/walrus.glb and penguin.glb (mesh, skin and clips together).
#
#   walrus   3.3 m, lying on the ice: a huge rounded chest, a small head with a broad bristly
#            muzzle and long tusks, fore flippers splayed, hind flippers trailing. Wrinkled
#            cinnamon skin (a generated texture and normal map).
#            clips: idle, breathe, look (head turns), flop (galumphing over the ice), roar
#   penguin  0.72 m Adélie: black back and head, white front, the white eye ring, short beak,
#            pink feet (vertex colours)
#            clips: idle, waddle, flap, slide (on its belly)
#
# Blender axes: the animal faces +y, up +z, standing on z = 0.
import bpy, bmesh, math, os, importlib
from mathutils import Vector, Matrix, Quaternion
import numpy as np
import common as C
importlib.reload(C)

FPS = 30

# ---------------------------------------------------------------- lofting
def loft(bm, sections, n=20, power=2.2, cap=True, uv=None):
    """rings along a path: sections = [(cx, cy, cz, a, b, axis)], axis 'y' (rings in xz) or 'z'
    (rings in xy); a superellipse of half-widths a, b. Returns the rings and per-vertex loft t."""
    rings = []
    for k, (cx, cy, cz, a, b, ax) in enumerate(sections):
        ring = []
        for i in range(n):
            t = 2 * math.pi * i / n
            c, s = math.cos(t), math.sin(t)
            sx = math.copysign(abs(c) ** (2 / power), c); sy = math.copysign(abs(s) ** (2 / power), s)
            if ax == 'y': p = (cx + a * sx, cy, cz + b * sy)
            else: p = (cx + a * sx, cy + b * sy, cz)
            v = bm.verts.new(p); ring.append(v)
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    if cap:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            c = sum((v.co for v in ring), Vector()) / len(ring)
            cv = bm.verts.new(c)
            for i in range(n):
                j = (i + 1) % n
                f = (ring[j], ring[i], cv) if rev else (ring[i], ring[j], cv)
                bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return rings

def subdivide_smooth(o, levels=1):
    m = o.modifiers.new('ss', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    C.apply_modifiers(o)

def make_obj(name, bm, mat, coll):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); coll.objects.link(o)
    me.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return o

def armature(name, coll, bones):
    """bones: [(name, head, tail, parent)]"""
    ad = bpy.data.armatures.new(name)
    ao = bpy.data.objects.new(name, ad); coll.objects.link(ao)
    if bpy.context.window: bpy.context.window.scene = bpy.context.scene
    bpy.context.view_layer.objects.active = ao
    with bpy.context.temp_override(active_object=ao, object=ao):
        bpy.ops.object.mode_set(mode='EDIT')
        eb = ad.edit_bones
        for bn, h, t, par in bones:
            b = eb.new(bn); b.head = h; b.tail = t
            if par: b.parent = eb[par]
        bpy.ops.object.mode_set(mode='OBJECT')
    return ao

def bind(o, arm, weights):
    """weights: {bone: per-vertex weight array}; normalised per vertex"""
    names = list(weights)
    W = np.stack([weights[n] for n in names], 1)
    W = W / np.maximum(W.sum(1, keepdims=True), 1e-6)
    for k, n in enumerate(names):
        g = o.vertex_groups.new(name=n)
        for i in np.nonzero(W[:, k] > 0.002)[0]:
            g.add([int(i)], float(W[i, k]), 'REPLACE')
    m = o.modifiers.new('Armature', 'ARMATURE'); m.object = arm
    o.parent = arm

def ramp(x, a, b):
    return np.clip((x - a) / (b - a), 0, 1)

def key_clips(arm, clips):
    """clips: {name: (fn(t) -> {bone: (quat, loc|None, scale|None)}, length s, loop)}; each to an
    action on its own NLA track"""
    arm.animation_data_create()
    for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
    for name, (fn, L, loop) in clips.items():
        act = bpy.data.actions.new(name)
        arm.animation_data.action = act
        n = round(L * FPS)
        for f in list(range(0, n + 1, 2)) + ([n] if n % 2 else []):
            t = (f % n) / FPS if loop else f / FPS
            pose = fn(t)
            for pb in arm.pose.bones:
                q, l, s = pose.get(pb.name, (None, None, None))
                pb.rotation_quaternion = q if q is not None else Quaternion()
                pb.location = l if l is not None else (0, 0, 0)
                pb.scale = s if s is not None else (1, 1, 1)
                pb.keyframe_insert('rotation_quaternion', frame=f)
                pb.keyframe_insert('location', frame=f)
                pb.keyframe_insert('scale', frame=f)
        act.use_fake_user = True
        tr = arm.animation_data.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 0, act)
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)

def Q(axis, deg):
    return Quaternion(Vector(axis), math.radians(deg))

# local bone axes: a bone's local y runs along it; x is its "roll" axis, set by edit-bone roll 0 →
# for horizontal bones pointing +y, local x = world x (pitch), local z = world z (yaw)

# ---------------------------------------------------------------- the walrus
def walrus_skin():
    """cinnamon-brown wrinkled skin, pinker on the chest, darker on the back; bristly muzzle"""
    S = 512
    rng = np.random.default_rng(5)
    yy, xx = np.mgrid[0:S, 0:S] / S
    def noise(sc, seed):
        g = np.random.default_rng(seed).random((sc + 1, sc + 1))
        xi, yi = xx * sc, yy * sc
        x0, y0 = np.floor(xi).astype(int), np.floor(yi).astype(int)
        fx, fy = xi - x0, yi - y0
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a = g[y0 % sc, x0 % sc]; b = g[y0 % sc, (x0 + 1) % sc]; c = g[(y0 + 1) % sc, x0 % sc]; d = g[(y0 + 1) % sc, (x0 + 1) % sc]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    n = noise(8, 1) * 0.5 + noise(24, 2) * 0.3 + noise(64, 3) * 0.2
    # wrinkles: folds running round the body (u is round, v along)
    # creases: irregular folds running round the body, a few across them, lumpy skin between
    f1 = yy * 22 + noise(6, 4) * 4.0 + noise(20, 6) * 0.8
    crease = np.exp(-(((f1 % 1.0) - 0.5) / 0.07) ** 2)
    f2 = xx * 9 + yy * 6 + noise(5, 5) * 3.0
    crease2 = np.exp(-(((f2 % 1.0) - 0.5) / 0.05) ** 2) * 0.5
    wr = np.clip(crease + crease2, 0, 1)
    h = -wr * 0.8 + n * 0.6
    base = np.array([0.36, 0.2, 0.13])
    pink = np.array([0.5, 0.28, 0.22])
    back = np.array([0.22, 0.13, 0.09])
    belly = np.clip(np.cos((xx - 0.75) * 2 * math.pi) * 0.5 + 0.5, 0, 1)[..., None]   # (u 0.75 is underneath)
    col = base[None, None] * (0.75 + 0.5 * n[..., None])
    col = col * (1 - 0.35 * belly) + pink * 0.35 * belly
    top = np.clip(np.cos((xx - 0.25) * 2 * math.pi), 0, 1)[..., None]
    col = col * (1 - 0.3 * top) + back * 0.3 * top
    col *= (1.0 - 0.1 * wr)[..., None]
    gy, gx = np.gradient(h)
    nm = np.dstack([-gx * 3, -gy * 3, np.ones_like(h)]); nm /= np.linalg.norm(nm, axis=2, keepdims=True)
    return col.astype(np.float32), (nm * 0.5 + 0.5).astype(np.float32)

def build_walrus(coll):
    col, nrm = walrus_skin()
    skin = C.mat_textured('Walrus_Skin', base=C.image_tex('Walrus_Skin_tex', col), normal=C.image_tex('Walrus_Skin_nrm', nrm, 'Non-Color'), rough=0.55, normal_strength=0.6)
    ivory = C.mat('Walrus_Tusk', (0.75, 0.68, 0.52), 0.35)
    eye = C.mat('Walrus_Eye', (0.01, 0.008, 0.006), 0.15)
    # body: chest high and round, the head low and forward, the muzzle broad and flat-fronted
    S = [(0, -1.68, 0.26, 0.1, 0.08, 'y'), (0, -1.45, 0.32, 0.36, 0.26, 'y'), (0, -1.05, 0.42, 0.52, 0.4, 'y'), (0, -0.55, 0.5, 0.64, 0.5, 'y'),
         (0, -0.05, 0.56, 0.72, 0.56, 'y'), (0, 0.35, 0.57, 0.7, 0.55, 'y'), (0, 0.72, 0.56, 0.56, 0.46, 'y'), (0, 1.02, 0.54, 0.42, 0.36, 'y'),
         (0, 1.26, 0.5, 0.36, 0.31, 'y'), (0, 1.46, 0.44, 0.34, 0.27, 'y'), (0, 1.6, 0.4, 0.3, 0.22, 'y'), (0, 1.68, 0.38, 0.2, 0.15, 'y')]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rings = loft(bm, S, n=24, power=2.3)
    # the belly flat on the ice; the muzzle pad
    for v in bm.verts:
        if v.co.z < 0.04: v.co.z = 0.04 + (v.co.z - 0.04) * 0.15
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            u = (math.atan2(co.z - 0.45, co.x) / (2 * math.pi)) % 1.0
            l[uvl].uv = (u, (co.y + 1.7) / 3.4)
    body = make_obj('Walrus_body', bm, skin, coll)
    subdivide_smooth(body, 1)
    parts = [body]
    # flippers: flattened paddles (fore: out to the sides and back; hind: trailing, splayed)
    def paddle(name, root, tip, width, thick, up=Vector((0, 0, 1))):
        bm = bmesh.new()
        d = (Vector(tip) - Vector(root)); L = d.length; d.normalize()
        side = d.cross(up).normalized(); nrm_ = side.cross(d).normalized()
        sec = []
        for k, t in enumerate((0, 0.25, 0.5, 0.75, 0.95, 1.0)):
            w = width * (0.55 + 0.45 * math.sin(min(1, t * 1.15) * math.pi * 0.85)) * (0.4 if t == 1.0 else 1)
            c = Vector(root) + d * L * t
            sec.append((c, w, thick * (1 - 0.5 * t)))
        rings = []
        for c, w, th in sec:
            ring = []
            for i in range(10):
                a = 2 * math.pi * i / 10
                ring.append(bm.verts.new(c + side * math.cos(a) * w + nrm_ * math.sin(a) * th))
            rings.append(ring)
        for k in range(len(rings) - 1):
            for i in range(10):
                j = (i + 1) % 10
                bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            cv = bm.verts.new(sum((v.co for v in ring), Vector()) / 10)
            for i in range(10):
                j = (i + 1) % 10
                bm.faces.new((ring[j], ring[i], cv) if rev else (ring[i], ring[j], cv))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        uv = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            for l in f.loops: l[uv].uv = (0.75, 0.5)
        o = make_obj(name, bm, skin, coll)
        return o
    for s in (1, -1):
        parts.append(paddle(f'fore_{s}', (s * 0.52, 0.48, 0.3), (s * 0.95, 0.2, 0.04), 0.24, 0.075))
        parts.append(paddle(f'hind_{s}', (s * 0.12, -1.5, 0.24), (s * 0.38, -1.95, 0.05), 0.2, 0.06))
    # tusks: long, hanging down and a little forward from under the muzzle
    for s in (1, -1):
        bm = bmesh.new()
        pts = [Vector((s * 0.1, 1.57, 0.3)), Vector((s * 0.115, 1.66, 0.12)), Vector((s * 0.12, 1.69, -0.06)), Vector((s * 0.115, 1.68, -0.2))]
        C.bm_tube(bm, pts, 0.035, 8)
        for i, v in enumerate(bm.verts): pass
        # taper toward the tip
        for v in bm.verts:
            t = max(0.0, min(1.0, (0.3 - v.co.z) / 0.5))
            c = Vector((s * 0.112, 1.65 + 0.03 * t, v.co.z))
            v.co = c + (v.co - c) * (1 - 0.75 * t)
        o = make_obj(f'tusk_{s}', bm, ivory, coll); parts.append(o)
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.03)
        bmesh.ops.translate(bm, vec=(s * 0.28, 1.28, 0.68), verts=bm.verts)
        parts.append(make_obj(f'eye_{s}', bm, eye, coll))
    # the tusks sit in the ice when it lies flat: lift the head a little, so they clear it
    # skeleton
    arm = armature('Walrus', coll, [
        ('hips', (0, -1.0, 0.45), (0, -0.25, 0.5), None),
        ('tail', (0, -1.0, 0.45), (0, -1.65, 0.3), 'hips'),
        ('chest', (0, -0.25, 0.5), (0, 0.55, 0.58), 'hips'),
        ('neck', (0, 0.55, 0.58), (0, 1.0, 0.58), 'chest'),
        ('head', (0, 1.0, 0.58), (0, 1.68, 0.42), 'neck'),
        ('fore.L', (0.52, 0.48, 0.3), (0.95, 0.2, 0.04), 'chest'), ('fore.R', (-0.52, 0.48, 0.3), (-0.95, 0.2, 0.04), 'chest'),
        ('hind.L', (0.12, -1.5, 0.24), (0.38, -1.95, 0.05), 'tail'), ('hind.R', (-0.12, -1.5, 0.24), (-0.38, -1.95, 0.05), 'tail'),
    ])
    o = C.join(parts, 'Walrus_mesh')
    me = o.data
    co = np.array([v.co[:] for v in me.vertices])
    y, x, z = co[:, 1], co[:, 0], co[:, 2]
    fore = (np.abs(x) > 0.62) & (y > -0.2) & (y < 0.7) & (z < 0.35)
    hind = (y < -1.62) & (np.abs(x) > 0.05)
    head_ = ramp(y, 0.85, 1.15)
    neck_ = ramp(y, 0.35, 0.75) * (1 - head_)
    chest_ = ramp(y, -0.6, -0.1) * (1 - ramp(y, 0.35, 0.75))
    tail_ = 1 - ramp(y, -1.35, -0.9)
    hips_ = np.clip(1 - head_ - neck_ - chest_ - tail_, 0, 1)
    W = {'head': head_, 'neck': neck_, 'chest': chest_, 'hips': hips_, 'tail': tail_,
         'fore.L': np.zeros(len(y)), 'fore.R': np.zeros(len(y)), 'hind.L': np.zeros(len(y)), 'hind.R': np.zeros(len(y))}
    for k in W:
        if k.startswith(('fore', 'hind')): continue
        W[k] = np.where(fore | hind, 0, W[k])
    W['fore.L'] = np.where(fore & (x > 0), 1.0, 0.0); W['fore.R'] = np.where(fore & (x < 0), 1.0, 0.0)
    W['chest'] = np.where(fore, np.clip(1 - (np.abs(x) - 0.62) / 0.2, 0, 1) * 0.0 + W['chest'], W['chest'])
    W['hind.L'] = np.where(hind & (x > 0), 1.0, 0.0); W['hind.R'] = np.where(hind & (x < 0), 1.0, 0.0)
    bind(o, arm, W)

    def wal_pose(breath=0.0, head_yaw=0.0, head_pitch=0.0, neck_pitch=0.0, chest_pitch=0.0, fore=0.0, hind=0.0, lift=0.0, tail=0.0):
        s = 1 + breath * 0.035
        return {
            'hips': (Q((1, 0, 0), chest_pitch * 0.3), Vector((0, 0, lift * 0.5)), None),
            'chest': (Q((1, 0, 0), chest_pitch), Vector((0, 0, lift * 0.3)), Vector((s, 1, s))),
            'neck': (Q((0, 0, 1), head_yaw * 0.45) @ Q((1, 0, 0), neck_pitch), None, None),
            'head': (Q((0, 0, 1), head_yaw * 0.55) @ Q((1, 0, 0), head_pitch), None, None),
            'fore.L': (Q((1, 0, 0), fore), None, None), 'fore.R': (Q((1, 0, 0), fore), None, None),
            'hind.L': (Q((0, 0, 1), hind), None, None), 'hind.R': (Q((0, 0, 1), -hind), None, None),
            'tail': (Q((1, 0, 0), tail), None, None),
        }
    sm = lambda t: t * t * (3 - 2 * t)
    ease = lambda t, a, b: sm(max(0.0, min(1.0, (t - a) / (b - a))))
    clips = {
        'idle': (lambda t: wal_pose(breath=math.sin(t * 2 * math.pi / 4.0) * 0.6, head_yaw=4 * math.sin(t * 0.7), head_pitch=3 * math.sin(t * 0.43), hind=4 * math.sin(t * 1.1)), 8.0, True),
        'breathe': (lambda t: wal_pose(breath=math.sin(t * 2 * math.pi / 3.0), neck_pitch=3 * math.sin(t * 2 * math.pi / 3.0), head_pitch=4 * (0.5 + 0.5 * math.sin(t * 2 * math.pi / 3.0))), 6.0, True),
        'look': (lambda t: wal_pose(breath=math.sin(t * 2 * math.pi / 4.0) * 0.5, head_yaw=38 * (ease(t, 0.5, 1.4) - ease(t, 2.4, 3.6)) - 34 * (ease(t, 3.6, 4.4) - ease(t, 5.2, 6.0)), neck_pitch=8 * ease(t, 0.5, 1.4) * (1 - ease(t, 5.2, 6.0))), 6.0, True),
        # galumphing: the chest heaves up on the fore flippers, the hips follow, a wave down the body
        'flop': (lambda t: wal_pose(chest_pitch=7 * math.sin(t * 2 * math.pi / 1.3), lift=0.07 * max(0, math.sin(t * 2 * math.pi / 1.3)), neck_pitch=6 * math.sin(t * 2 * math.pi / 1.3 - 0.8), head_pitch=-6 * math.sin(t * 2 * math.pi / 1.3 - 1.2),
                                         fore=-28 * math.sin(t * 2 * math.pi / 1.3 + 0.6), tail=10 * math.sin(t * 2 * math.pi / 1.3 + 2.0), hind=12 * math.sin(t * 2 * math.pi / 1.3 + 2.0)), 1.3, True),
        # the roar: rearing up, the head thrown back, held, then down again
        'roar': (lambda t: wal_pose(breath=1.0 * ease(t, 0.2, 0.6), chest_pitch=12 * ease(t, 0.2, 0.7) * (1 - ease(t, 2.0, 2.6)), lift=0.12 * ease(t, 0.2, 0.7) * (1 - ease(t, 2.0, 2.6)),
                                         neck_pitch=20 * ease(t, 0.3, 0.8) * (1 - ease(t, 2.0, 2.6)), head_pitch=24 * ease(t, 0.35, 0.9) * (1 - ease(t, 2.0, 2.6)) + 3 * math.sin(t * 19) * ease(t, 0.8, 1.0) * (1 - ease(t, 1.7, 1.9)),
                                         fore=-12 * ease(t, 0.2, 0.7) * (1 - ease(t, 2.0, 2.6))), 2.8, False),
    }
    key_clips(arm, clips)
    return arm, o

# ---------------------------------------------------------------- the penguin
def build_penguin(coll):
    mat = bpy.data.materials.get('Penguin') or bpy.data.materials.new('Penguin')
    mat.use_nodes = True
    nt = mat.node_tree; p = nt.nodes['Principled BSDF']
    for n in list(nt.nodes):
        if n.type == 'VERTEX_COLOR': nt.nodes.remove(n)
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], p.inputs['Base Color']); p.inputs['Roughness'].default_value = 0.55
    S = [(0, 0, 0.03, 0.07, 0.06, 'z'), (0, 0.0, 0.085, 0.13, 0.12, 'z'), (0, 0.0, 0.2, 0.165, 0.155, 'z'), (0, 0.0, 0.31, 0.17, 0.16, 'z'),
         (0, 0.0, 0.41, 0.15, 0.14, 'z'), (0, 0.005, 0.49, 0.115, 0.11, 'z'), (0, 0.012, 0.55, 0.098, 0.1, 'z'), (0, 0.02, 0.61, 0.1, 0.105, 'z'),
         (0, 0.022, 0.67, 0.085, 0.09, 'z'), (0, 0.02, 0.71, 0.05, 0.055, 'z'), (0, 0.018, 0.728, 0.012, 0.012, 'z')]
    bm = bmesh.new()
    loft(bm, S, n=20, power=2.0)
    # the tail: a short wedge at the back, low down
    body = make_obj('Penguin_body', bm, mat, coll)
    subdivide_smooth(body, 1)
    parts = [body]
    def blob(name, c, s, rot=None):
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1)
        bmesh.ops.scale(bm, vec=s, verts=bm.verts)
        if rot: bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
        bmesh.ops.translate(bm, vec=c, verts=bm.verts)
        return make_obj(name, bm, mat, coll)
    # beak (a short wedge forward), the wings (flat paddles), the feet, the tail
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.022, radius2=0.004, depth=0.075)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2 + 0.12, 3, 'X'))
    bmesh.ops.translate(bm, vec=(0, 0.135, 0.628), verts=bm.verts)
    parts.append(make_obj('beak', bm, mat, coll))
    for s in (1, -1):
        parts.append(blob(f'wing_{s}', (s * 0.165, -0.005, 0.32), (0.018, 0.06, 0.13), Matrix.Rotation(s * 0.18, 3, 'Y')))
        parts.append(blob(f'foot_{s}', (s * 0.05, 0.05, 0.012), (0.035, 0.06, 0.012)))
    parts.append(blob('tail', (0, -0.14, 0.07), (0.05, 0.06, 0.02), Matrix.Rotation(-0.5, 3, 'X')))
    o = C.join(parts, 'Penguin_mesh')
    me = o.data
    co = np.array([v.co[:] for v in me.vertices])
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    # colours: black back and head, white front below the throat, the white eye ring, pink feet,
    # black beak with a reddish base
    nr = np.array([v.normal[:] for v in me.vertices])
    front = (nr[:, 1] > -0.05 + 0.25 * np.clip((z - 0.45) / 0.1, 0, 1)) & (z < 0.53) & (np.abs(x) < 0.16)
    col = np.tile(np.array([0.025, 0.025, 0.03]), (len(z), 1))
    col[front] = [0.86, 0.87, 0.88]
    for s in (1, -1):
        e = np.array([s * 0.068, 0.072, 0.635])
        d = np.linalg.norm(co - e, axis=1)
        col[(d > 0.008) & (d < 0.02)] = [0.9, 0.9, 0.92]
        col[d <= 0.008] = [0.02, 0.01, 0.01]
    feet = z < 0.026
    col[feet] = [0.75, 0.35, 0.38]
    beak = (y > 0.1) & (z > 0.6) & (z < 0.66) & (np.abs(x) < 0.03)
    col[beak] = [0.06, 0.03, 0.03]
    wingm = (np.abs(x) > 0.15) & (z > 0.18) & (z < 0.46)
    col[wingm & (nr[:, 1] > 0.3)] = [0.86, 0.87, 0.88]
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.concatenate([col, np.ones((len(z), 1))], 1).astype(np.float32).ravel())
    me.color_attributes.active_color = attr
    arm = armature('Penguin', coll, [
        ('root', (0, 0, 0.0), (0, 0, 0.1), None),
        ('body', (0, 0, 0.1), (0, 0, 0.42), 'root'),
        ('neck', (0, 0, 0.42), (0, 0.01, 0.55), 'body'),
        ('head', (0, 0.01, 0.55), (0, 0.03, 0.73), 'neck'),
        ('wing.L', (0.155, 0, 0.44), (0.18, 0, 0.2), 'body'), ('wing.R', (-0.155, 0, 0.44), (-0.18, 0, 0.2), 'body'),
        ('foot.L', (0.05, 0, 0.08), (0.05, 0.06, 0.0), 'root'), ('foot.R', (-0.05, 0, 0.08), (-0.05, 0.06, 0.0), 'root'),
    ])
    wing = (np.abs(x) > 0.148) & (z > 0.17) & (z < 0.47)
    footm = z < 0.05
    head_ = ramp(z, 0.5, 0.58); neck_ = ramp(z, 0.38, 0.47) * (1 - head_)
    body_ = np.clip(1 - head_ - neck_, 0, 1) * ramp(z, 0.02, 0.12)
    root_ = 1 - ramp(z, 0.02, 0.12)
    W = {'head': head_, 'neck': neck_, 'body': body_, 'root': root_}
    for k in list(W): W[k] = np.where(wing | footm, 0, W[k])
    W['wing.L'] = np.where(wing & (x > 0), 1.0, 0.0); W['wing.R'] = np.where(wing & (x < 0), 1.0, 0.0)
    W['foot.L'] = np.where(footm & (x > 0), 1.0, 0.0); W['foot.R'] = np.where(footm & (x < 0), 1.0, 0.0)
    W['root'] = W['root'] + np.where(footm & (np.abs(x) < 0.01), 1.0, 0.0)
    bind(o, arm, W)

    def pen(body_roll=0, body_pitch=0, head_yaw=0, head_pitch=0, wing=0, wing_flap=0, foot=(0, 0), lift=0.0, root_pitch=0):
        # bones run up: local y = up; pitch about local x, roll about local y? we rotate in bone space
        return {
            'root': (Q((1, 0, 0), root_pitch), Vector((0, lift, 0)), None),
            'body': (Q((0, 0, 1), body_roll) @ Q((1, 0, 0), body_pitch), None, None),
            'head': (Q((0, 1, 0), head_yaw) @ Q((1, 0, 0), head_pitch), None, None),
            'wing.L': (Q((0, 0, 1), -(wing + wing_flap)), None, None), 'wing.R': (Q((0, 0, 1), (wing + wing_flap)), None, None),
            'foot.L': (Q((1, 0, 0), foot[0]), None, None), 'foot.R': (Q((1, 0, 0), foot[1]), None, None),
        }
    sm = lambda t: t * t * (3 - 2 * t)
    ease = lambda t, a, b: sm(max(0.0, min(1.0, (t - a) / (b - a))))
    clips = {
        'idle': (lambda t: pen(body_roll=2 * math.sin(t * 1.3), head_yaw=40 * (ease(t, 0.8, 1.0) - ease(t, 2.0, 2.2)) - 35 * (ease(t, 3.0, 3.15) - ease(t, 4.2, 4.4)), head_pitch=-5 * math.sin(t * 0.9), wing=6), 5.0, True),
        'waddle': (lambda t: pen(body_roll=11 * math.sin(t * 2 * math.pi / 0.55), head_yaw=-4 * math.sin(t * 2 * math.pi / 0.55), wing=22, wing_flap=6 * math.sin(t * 2 * math.pi / 0.55 + 1),
                                 foot=(-25 * max(0, math.sin(t * 2 * math.pi / 0.55)), -25 * max(0, -math.sin(t * 2 * math.pi / 0.55))), lift=0.01 * abs(math.sin(t * 2 * math.pi / 0.55))), 0.55, True),
        'flap': (lambda t: pen(body_pitch=-6, head_pitch=-14, wing=30, wing_flap=38 * math.sin(t * 2 * math.pi * 3.2), body_roll=2 * math.sin(t * 9)), 1.25, True),
        # on its belly: the whole bird tipped forward, feet pushing, wings rowing
        'slide': (lambda t: pen(root_pitch=-78, lift=0.08, head_pitch=55, wing=55, wing_flap=20 * math.sin(t * 2 * math.pi / 0.8),
                                foot=(30 * math.sin(t * 2 * math.pi / 0.8), -30 * math.sin(t * 2 * math.pi / 0.8))), 0.8, True),
    }
    key_clips(arm, clips)
    return arm, o

def export(sc, name, arm, mesh):
    path = os.path.join(C.raw_dir(), f'{name}.glb')
    if bpy.context.window: bpy.context.window.scene = sc
    for o in sc.objects: o.select_set(o in (arm, mesh))
    with bpy.context.temp_override(scene=sc):
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, use_active_scene=True, export_extras=True, export_yup=True,
                                  export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=True,
                                  export_skins=True, export_vertex_color='ACTIVE', export_image_format='WEBP', export_image_quality=85)
    return [path, os.path.getsize(path)]

if __name__ == '__main__' or True:
    C.set_root(globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arctic Tug'))
    result = {}
    for kind in globals().get('WANT') or ['walrus', 'penguin']:
        sc = C.fresh_scene('ASSET_' + kind)
        arm, mesh = (build_walrus if kind == 'walrus' else build_penguin)(sc.collection)
        r = {'tris': C.tris(mesh), 'bones': len(arm.data.bones)}
        if globals().get('PREVIEW', False):
            for tr in arm.animation_data.nla_tracks: tr.mute = True
            far = 5.5 if kind == 'walrus' else 1.4
            h = 0.6 if kind == 'walrus' else 0.38
            r['previews'] = C.preview(sc, kind, [('q', (far * 0.8, far * 0.7, h + far * 0.25), (0, 0, h), 40), ('side', (far * 1.1, 0, h), (0, 0, h), 40)], res=(720, 480), world_rgb=(0.45, 0.47, 0.5))
            for tr in arm.animation_data.nla_tracks: tr.mute = False
        if globals().get('EXPORT', True): r['export'] = export(sc, kind, arm, mesh)
        result[kind] = r
