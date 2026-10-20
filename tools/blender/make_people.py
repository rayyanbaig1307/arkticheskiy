# The Polyarnik's people: five crew and four soldiers, built with MPFB (MakeHuman CC0 bodies and
# assets) on MPFB's game-engine rig, dressed for the Arctic, exported one GLB each to
# tools/blender/raw/people/<name>.glb (their animation clips come from make_anims.py, on the same rig).
#
# Adapted from The Ashwood Tapes' make_people.py, but safe for the live Blender session: each
# person is built in a scene of their own (ASSET_person), nothing outside it is touched.
#
# Winter gear is modelled here:
#   coat     grown from the body itself: the torso and arms are copied, pushed out along their
#            normals (padding) and keep the body's bone weights, so the coat bends exactly as the
#            body does. Long coats get a skirt to the knee. The body under the coat is removed
#            (nothing pokes through). Quilted navy, an orange work parka, a black officer's
#            greatcoat, or the soldiers' winter camouflage (generated textures).
#   gloves   the hands, grown a few millimetres (they curl with the fingers)
#   hats     the ushanka (a fur crown, the turned-up front, ear flaps down, a cockade) or a knit cap
#   belt     the soldiers' belt with a buckle; a scarf for some
#
#   runpy: SCRIPT='make_people', ARGS={'WANT': ['captain']}
import bpy, bmesh, math, os, addon_utils, importlib, random
from mathutils import Vector, Matrix
import numpy as np
import common as C
importlib.reload(C)

mod = [m.__name__ for m in addon_utils.modules() if m.__name__.endswith('.mpfb')][0]
addon_utils.enable(mod, default_set=True, persistent=True)
HS = importlib.import_module(mod + '.services.humanservice').HumanService
TS = importlib.import_module(mod + '.services.targetservice').TargetService
ES = importlib.import_module(mod + '.services.exportservice').ExportService

def pheno(age, h, w, m, prop=0.5, race=(0.03, 0.94, 0.03)):
    return {'gender': 1.0, 'age': age, 'height': h, 'weight': w, 'muscle': m, 'proportions': prop, 'race': {'asian': race[0], 'caucasian': race[1], 'african': race[2]}}

CL = lambda n: f'{n}/{n}.mhclo'
SK = lambda n: f'{n}/{n}.mhmat'
# coat kinds: navy (quilted), orange (work parka), officer (black greatcoat to the knee), camo (soldiers)
PEOPLE = {
    'captain':  dict(ph=pheno(0.78, 0.62, 0.55, 0.45), skin=SK('jartur69_old_slavic_male_with_genitals_and_beard'), hair=CL('short03'), brows=CL('eyebrow003'),
                     clothes=[CL('toigo_wool_pants'), CL('culturalibre_male_boots')], tint={'pants': (0.03, 0.03, 0.04), 'boots': (0.03, 0.03, 0.03)},
                     coat='officer', hat='ushanka_black', scarf=None, hairc=(0.6, 0.6, 0.58), iris=(0.35, 0.42, 0.5), role='crew'),
    'bosun':    dict(ph=pheno(0.55, 0.55, 0.72, 0.7), skin=SK('jartur69_middleage_slavic_male_with_genitals_and_beard'), hair=CL('short02'), brows=CL('eyebrow001'),
                     clothes=[CL('cortu_cargo_pants'), CL('culturalibre_hero_boots_2')], tint={'pants': (0.06, 0.08, 0.14), 'boots': (0.04, 0.035, 0.03)},
                     coat='orange', hat='ushanka_grey', scarf=None, hairc=(0.2, 0.14, 0.08), iris=(0.3, 0.25, 0.15), role='crew'),
    'deckhand': dict(ph=pheno(0.3, 0.6, 0.4, 0.55), skin=SK('young_caucasian_male2'), hair=CL('short04'), brows=CL('eyebrow002'),
                     clothes=[CL('cortu_cargo_pants'), CL('culturalibre_male_boots')], tint={'pants': (0.08, 0.08, 0.07), 'boots': (0.03, 0.03, 0.03)},
                     coat='navy', hat='knit_black', scarf=None, hairc=(0.35, 0.25, 0.13), iris=(0.4, 0.5, 0.55), role='crew'),
    'engineer': dict(ph=pheno(0.5, 0.5, 0.6, 0.55), skin=SK('middleage_caucasian_male'), hair=CL('short01'), brows=CL('eyebrow003'),
                     clothes=[CL('male_worksuit01'), CL('culturalibre_male_boots')], tint={'worksuit': (0.07, 0.12, 0.28), 'boots': (0.04, 0.04, 0.04)},
                     coat=None, hat='knit_blue', scarf=None, hairc=(0.12, 0.09, 0.06), iris=(0.25, 0.2, 0.12), role='crew'),
    'cook':     dict(ph=pheno(0.68, 0.45, 0.85, 0.4), skin=SK('middleage_caucasian_male'), hair=CL('short03'), brows=CL('eyebrow001'),
                     clothes=[CL('toigo_fisherman_sweater'), CL('toigo_wool_pants'), CL('shoes02')], tint={'sweater': (0.55, 0.5, 0.42), 'pants': (0.1, 0.1, 0.11), 'shoes': (0.05, 0.05, 0.05)},
                     coat=None, hat='cook', apron=True, scarf=None, hairc=(0.45, 0.43, 0.4), iris=(0.3, 0.38, 0.4), role='crew'),
    'soldier1': dict(ph=pheno(0.45, 0.62, 0.5, 0.65), skin=SK('middleage_caucasian_male'), hair=CL('short01'), brows=CL('eyebrow002'),
                     clothes=[CL('cortu_cargo_pants'), CL('culturalibre_hero_boots_1')], tint={'boots': (0.03, 0.03, 0.03)}, camo_pants=True,
                     coat='camo', hat='ushanka_army', belt=True, scarf=None, hairc=(0.2, 0.15, 0.1), iris=(0.3, 0.38, 0.4), role='soldier'),
    'soldier2': dict(ph=pheno(0.25, 0.66, 0.42, 0.6), skin=SK('young_caucasian_male'), hair=CL('short01'), brows=CL('eyebrow001'),
                     clothes=[CL('cortu_cargo_pants'), CL('culturalibre_hero_boots_1')], tint={'boots': (0.03, 0.03, 0.03)}, camo_pants=True,
                     coat='camo', hat='ushanka_army', belt=True, scarf=None, hairc=(0.4, 0.3, 0.16), iris=(0.45, 0.55, 0.62), role='soldier'),
    'soldier3': dict(ph=pheno(0.3, 0.55, 0.5, 0.6, race=(0.25, 0.72, 0.03)), skin=SK('young_caucasian_male2'), hair=CL('short01'), brows=CL('eyebrow002'),
                     clothes=[CL('cortu_cargo_pants'), CL('culturalibre_hero_boots_1')], tint={'boots': (0.03, 0.03, 0.03)}, camo_pants=True,
                     coat='camo', hat='ushanka_army', belt=True, scarf=None, hairc=(0.06, 0.05, 0.04), iris=(0.2, 0.14, 0.08), role='soldier'),
    'soldier4': dict(ph=pheno(0.28, 0.7, 0.45, 0.7), skin=SK('toigo_light_skin_male_freckles'), hair=CL('short01'), brows=CL('eyebrow001'),
                     clothes=[CL('cortu_cargo_pants'), CL('culturalibre_hero_boots_1')], tint={'boots': (0.03, 0.03, 0.03)}, camo_pants=True,
                     coat='camo', hat='ushanka_army', belt=True, scarf=None, hairc=(0.35, 0.18, 0.08), iris=(0.36, 0.3, 0.18), role='soldier'),
}

# ---------------------------------------------------------------- textures
def tex_mat(name, px, rough=0.9, normal=None, nstrength=1.0):
    img = C.image_tex(name + '_tex', px.astype(np.float32))
    nimg = C.image_tex(name + '_nrm', normal.astype(np.float32), 'Non-Color') if normal is not None else None
    return C.mat_textured(name, base=img, normal=nimg, rough=rough, normal_strength=nstrength)

def height_to_normal(h, k=2.0):
    gy, gx = np.gradient(h)
    n = np.dstack([-gx * k, -gy * k, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5

def quilt(rgb, size=512, cells=18, seed=1):
    """padded cloth: diamond stitching, puffed between the seams, a little fabric noise"""
    yy, xx = np.mgrid[0:size, 0:size] / size * cells
    a = np.abs(((xx + yy) % 1) - 0.5); b = np.abs(((xx - yy) % 1) - 0.5)
    seam = np.minimum(a, b)
    puff = np.clip(seam * 4, 0, 1) ** 0.6
    rng = np.random.default_rng(seed)
    n = rng.random((size, size)) * 0.08
    col = np.array(rgb)[None, None] * (0.7 + 0.3 * puff[..., None] + n[..., None])
    return col, height_to_normal(puff + n * 0.5, 3.0)

def camo(size=512, seed=7):
    """Russian 'Digital Flora'-style pixel camouflage: blobs of green, olive, sand and brown"""
    rng = np.random.default_rng(seed)
    cols = np.array([[0.09, 0.12, 0.06], [0.16, 0.18, 0.09], [0.26, 0.24, 0.15], [0.12, 0.09, 0.05]])
    px = 8
    g = size // px
    out = np.zeros((g, g), np.int32)
    for layer, (k, th) in enumerate(((2, 0.5), (3, 0.55), (1, 0.62))):
        f = np.zeros((g, g))
        for _ in range(4):
            sc = rng.integers(3, 9)
            low = rng.random((g // sc + 2, g // sc + 2))
            f += np.kron(low, np.ones((sc, sc)))[:g, :g]
        f /= f.max()
        out[f > th + rng.uniform(-0.05, 0.05)] = k
    col = cols[out]
    col = np.kron(col, np.ones((px, px, 1)))
    col *= 0.9 + 0.1 * rng.random((size, size, 1))
    h = rng.random((size, size)) * 0.3
    return col, height_to_normal(h, 1.5)

def fur(rgb, size=256, seed=3):
    rng = np.random.default_rng(seed)
    n = rng.random((size, size))
    streak = np.cumsum(rng.random((size, size)) - 0.5, axis=0)
    streak = (streak - streak.min()) / (np.ptp(streak) + 1e-6)
    v = 0.6 + 0.25 * n + 0.25 * streak
    return np.array(rgb)[None, None] * v[..., None], height_to_normal(n * 0.8 + streak * 0.6, 4.0)

def knit(rgb, size=256):
    yy, xx = np.mgrid[0:size, 0:size]
    k = 0.75 + 0.25 * np.abs(np.sin(xx / size * math.pi * 32)) * (0.85 + 0.15 * np.sin(yy / size * math.pi * 56))
    return np.array(rgb)[None, None] * k[..., None], height_to_normal(k, 2.0)

def solid(name, rgb, rough=0.9, metal=0.0):
    return C.mat(name, rgb, rough, metal)

# ---------------------------------------------------------------- helpers on the built human
def build(name, P):
    sc = C.fresh_scene('ASSET_person')
    info = HS._create_default_human_info_dict()
    info['phenotype'].update(P['ph'])
    info.update({'skin_mhmat': P['skin'], 'skin_material_type': 'MAKESKIN', 'eyes': 'low-poly/low-poly.mhclo', 'eyes_material_type': 'MAKESKIN',
                 'eyebrows': P['brows'], 'eyelashes': 'eyelashes01/eyelashes01.mhclo', 'teeth': 'teeth_base/teeth_base.mhclo', 'tongue': '',
                 'hair': P['hair'], 'proxy': '',
                 'clothes': P['clothes'], 'clothes_material_type': 'MAKESKIN', 'rig': 'game_engine', 'alternative_materials': {}, 'name': name})
    st = HS.get_default_deserialization_settings(); st['subdiv_levels'] = 0; st['material_instances'] = 'NEVER'
    basemesh = HS.deserialize_from_dict(info, st)
    TS.bake_targets(basemesh)
    arm = [o for o in sc.objects if o.type == 'ARMATURE'][0]
    arm.name = 'Rig'
    mw = basemesh.matrix_world

    def group(obj, gname):
        g = obj.vertex_groups.get(gname)
        if not g: return []
        return [v.index for v in obj.data.vertices if any(gg.group == g.index for gg in v.groups)]
    avg = lambda idx: sum((mw @ basemesh.data.vertices[i].co for i in idx), Vector()) / max(1, len(idx))
    M = avg(group(basemesh, 'lips'))
    EL, ER = avg(group(basemesh, 'helper-l-eye')), avg(group(basemesh, 'helper-r-eye'))
    bodyset = set(group(basemesh, 'body'))
    headv = [mw @ basemesh.data.vertices[i].co for i in group(basemesh, 'head') if i in bodyset]
    skull = [p for p in headv if p.z > EL.z - 0.035]
    lo = Vector((min(p.x for p in skull), min(p.y for p in skull), min(p.z for p in skull)))
    hi = Vector((max(p.x for p in skull), max(p.y for p in skull), max(p.z for p in skull)))
    HC, HR = (lo + hi) / 2, (hi - lo) / 2
    allv = [mw @ basemesh.data.vertices[i].co for i in bodyset]
    height = max(p.z for p in allv)

    for o in sc.objects:
        if o.type == 'MESH':
            for m in list(o.modifiers):
                if m.type == 'MASK' and m.vertex_group != 'body':
                    o.modifiers.remove(m)
    ES.bake_modifiers_remove_helpers(basemesh, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)
    for o in sc.objects:
        if o.type == 'MESH':
            for m in list(o.modifiers):
                if m.type == 'SUBSURF': o.modifiers.remove(m)
            if o.data.shape_keys: o.shape_key_clear()
    meshes = [o for o in sc.objects if o.type == 'MESH']
    # the body is the base mesh MPFB returned (the clothes are named after the person too, and a
    # dense pair of boots can outnumber the body's vertices)
    body = basemesh if basemesh.name in sc.objects else max(meshes, key=lambda o: len(o.vertex_groups))
    for o in meshes:
        if o == body or any(k in o.name.lower() for k in ('low-poly', 'teeth', 'eyebrow', 'eyelash')): continue
        t = C.tris(o)
        budget = 3500 if P['hair'] and P['hair'].split('/')[0] in o.name else 2800
        if t > budget:
            m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = budget / t; m.use_collapse_triangulate = True
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
                bpy.ops.object.modifier_apply(modifier=m.name)

    def bone_parent(obj, bone):
        obj.parent = arm; obj.parent_type = 'BONE'; obj.parent_bone = bone
        b = arm.data.bones[bone]
        # (keep the object where it is: parent inverse of the bone's rest tail matrix)
        mtx = arm.matrix_world @ b.matrix_local @ Matrix.Translation((0, b.length, 0))
        obj.matrix_parent_inverse = mtx.inverted()

    def mk(bm, oname, mat, smooth=True):
        me = bpy.data.meshes.new(oname); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(oname, me); sc.collection.objects.link(o)
        me.materials.append(mat)
        for p in me.polygons: p.use_smooth = smooth
        return o

    def solidify(o, t):
        m = o.modifiers.new('sol', 'SOLIDIFY'); m.thickness = t; m.offset = 1
        C.apply_modifiers(o)

    def uv_cyl(o, scale=1.0, cx=0.0, cy=0.0):
        me = o.data
        if not me.uv_layers: me.uv_layers.new()
        uv = me.uv_layers.active.data
        for p in me.polygons:
            for li in p.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                uv[li].uv = ((math.atan2(v.y - cy, v.x - cx) / (2 * math.pi) + 0.5) * scale * 3, v.z * scale)

    added = []
    bones = {b.name: b for b in arm.data.bones}
    pel = arm.matrix_world @ bones['pelvis'].head_local
    knee = arm.matrix_world @ bones['calf_l'].head_local
    neck = arm.matrix_world @ bones['neck_01'].head_local
    ez = (EL.z + ER.z) / 2

    # ---- weights helpers: each body vertex's dominant bone, and its weight for a set of bones
    gi = {g.index: g.name for g in body.vertex_groups}
    def dominant(v):
        best, bw = None, 0
        for g in v.groups:
            n = gi.get(g.group)
            if n in bones and g.weight > bw: best, bw = n, g.weight
        return best
    def wsum(v, names):
        return sum(g.weight for g in v.groups if gi.get(g.group, '') in names)
    HANDS = {n for n in bones if n.startswith(('hand_', 'index', 'middle', 'ring', 'pinky', 'thumb'))}
    UPPER = {'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'neck_01'}

    # ---- the coat: the body's torso and arms copied, padded out, weights kept
    def coat(kind):
        hem = pel.z - 0.02
        sel = set()
        for v in body.data.vertices:
            d = dominant(v); p = body.matrix_world @ v.co
            if wsum(v, HANDS) > 0.3: continue
            if d in UPPER or (d in ('thigh_l', 'thigh_r') and p.z > hem):
                if d == 'neck_01' and p.z > neck.z + 0.04: continue
                sel.add(v.index)
        cobj = body.copy(); cobj.data = body.data.copy(); cobj.name = 'Coat'
        sc.collection.objects.link(cobj)
        bm = bmesh.new(); bm.from_mesh(cobj.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in sel], context='VERTS')
        bm.normal_update()
        for v in bm.verts:
            p = v.co
            arm_part = abs(p.x) > 0.24
            t = 0.032 if arm_part else 0.05
            if kind == 'officer': t *= 0.75
            v.co = p + v.normal * t
        # puff the collar up a little round the neck
        bm.to_mesh(cobj.data); bm.free()
        # the coat's cloth
        if kind == 'navy': col, nrm = quilt((0.03, 0.04, 0.07), seed=2); mat = tex_mat('Coat_navy', col, 0.85, nrm, 0.8)
        elif kind == 'orange': col, nrm = quilt((0.85, 0.28, 0.05), cells=14, seed=3); mat = tex_mat('Coat_orange', col, 0.7, nrm, 0.7)
        elif kind == 'officer': col, nrm = knit((0.025, 0.027, 0.035)); mat = tex_mat('Coat_officer', col, 0.75, nrm, 0.4)
        else: col, nrm = camo(seed=hash(name) % 97); mat = tex_mat('Coat_camo', col, 0.85, nrm, 0.6)
        cobj.data.materials.clear(); cobj.data.materials.append(mat)
        for p in cobj.data.polygons: p.use_smooth = True
        t_ = C.tris(cobj)
        if t_ > 5200:
            dm = cobj.modifiers.new('dec', 'DECIMATE'); dm.ratio = 5200 / t_; dm.use_collapse_triangulate = True
            C.apply_one(cobj, 'dec')
        added.append(cobj)
        # remove the body under it (a margin kept at the neck, the cuffs and the hem)
        bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
        hidden = set()
        for v in body.data.vertices:
            if v.index not in sel: continue
            p = body.matrix_world @ v.co
            if wsum(v, HANDS) > 0.01 or p.z > neck.z - 0.02 or p.z < hem + 0.06: continue
            if dominant(v) in ('lowerarm_l', 'lowerarm_r') and wsum(v, HANDS) > 0: continue
            hidden.add(v.index)
        if not P.get('keep_body'):          # (the Turned keep it: their coats are torn open)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.index in hidden for v in f.verts)], context='FACES')
        bm.to_mesh(body.data); bm.free()
        # the coat below the waist: a skirt from the hem, to the upper thigh (jackets), above the
        # knee (the soldiers' parka) or to the knee (the officer's greatcoat), weighted to hips and thighs
        if True:
            bottom = {'officer': knee.z + 0.0, 'camo': knee.z + 0.16}.get(kind, pel.z - 0.27)
            top = hem + 0.05
            sv = [body.matrix_world @ v.co for v in body.data.vertices]
            ring = [p for p in allv if abs(p.z - top) < 0.03 and abs(p.x - pel.x) < 0.25 and abs(p.y - pel.y) < 0.22]
            rx = max(abs(p.x - pel.x) for p in ring) + 0.045; ry = max(abs(p.y - pel.y) for p in ring) + 0.05
            bm = bmesh.new(); N, R = 28, 8; rows = []
            for j in range(R + 1):
                t = j / R; z = top + (bottom - top) * t; fl = 1 + (0.3 if kind == 'officer' else 0.14) * t * t
                rows.append([bm.verts.new((pel.x + math.cos(2 * math.pi * i / N) * rx * fl, pel.y + math.sin(2 * math.pi * i / N) * ry * fl, z)) for i in range(N)])
            for j in range(R):
                for i in range(N):
                    if j >= R // 2 and i == N // 4: continue      # (the back vent: -y is the front)
                    bm.faces.new((rows[j][i], rows[j][(i + 1) % N], rows[j + 1][(i + 1) % N], rows[j + 1][i]))
            sk = mk(bm, 'CoatSkirt', mat); uv_cyl(sk, 0.35, pel.x, pel.y); solidify(sk, 0.012)
            # weights: the hips and thighs by height and side
            for gname in ('pelvis', 'thigh_l', 'thigh_r'): sk.vertex_groups.new(name=gname)
            for v in sk.data.vertices:
                t = min(1, max(0, (top - v.co.z) / max(0.01, top - bottom)))
                side = v.co.x - pel.x
                sk.vertex_groups['pelvis'].add([v.index], 1 - t * 0.8, 'REPLACE')
                tw = t * 0.8 * min(1, abs(side) / 0.08 + 0.3)
                sk.vertex_groups['thigh_l' if side > 0 else 'thigh_r'].add([v.index], tw, 'REPLACE')
            m = sk.modifiers.new('Armature', 'ARMATURE'); m.object = arm
            sk.parent = arm; sk.matrix_parent_inverse = arm.matrix_world.inverted()
            added.append(sk)
        return mat

    # ---- gloves: the hands grown a few millimetres
    def gloves(rgb):
        sel = {v.index for v in body.data.vertices if wsum(v, HANDS) > 0.08}
        if not sel: return
        g = body.copy(); g.data = body.data.copy(); g.name = 'Gloves'; sc.collection.objects.link(g)
        bm = bmesh.new(); bm.from_mesh(g.data); bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in sel], context='VERTS')
        bm.normal_update()
        for v in bm.verts: v.co = v.co + v.normal * 0.006
        bm.to_mesh(g.data); bm.free()
        g.data.materials.clear(); g.data.materials.append(solid('Gloves', rgb, 0.7))
        added.append(g)
        inner = {v.index for v in body.data.vertices if wsum(v, HANDS) > 0.85}
        bm = bmesh.new(); bm.from_mesh(body.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.index in inner for v in f.verts)], context='FACES')
        bm.to_mesh(body.data); bm.free()

    # ---- hats (parented to the head bone)
    def dome(oname, mat, grow, front, back, squash=1.0):
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=14, radius=1.0)
        for v in bm.verts:
            v.co = Vector((HC.x + v.co.x * HR.x * grow, HC.y + v.co.y * HR.y * grow, HC.z + v.co.z * HR.z * grow * squash))
        cut = lambda y: front + (back - front) * (y - (HC.y - HR.y)) / (2 * HR.y)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut(v.co.y)], context='VERTS')
        o = mk(bm, oname, mat); uv_cyl(o, 3, HC.x, HC.y); solidify(o, 0.008)
        return o

    def ushanka(kind):
        furc = {'ushanka_black': (0.025, 0.022, 0.02), 'ushanka_grey': (0.22, 0.2, 0.18), 'ushanka_army': (0.12, 0.12, 0.09)}[kind]
        col, nrm = fur(furc, seed=len(kind)); fm = tex_mat('Fur_' + kind, col, 1.0, nrm, 1.2)
        parts = []
        crown = dome('hat_crown', fm, 1.2, ez + 0.07, ez + 0.0, 1.05); parts.append(crown)
        # the turned-up brim round the head
        bm = bmesh.new()
        res = bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=1, radius2=1, depth=1)
        for v in bm.verts:
            a = math.atan2(v.co.y, v.co.x); front = -math.sin(a)   # (+1 at the front: -y)
            r = 1.27 + 0.04 * max(0, front)
            zc = ez + 0.055 - 0.025 * (1 - max(0, front)) + v.co.z * (0.045 + 0.04 * max(0, front))
            v.co = Vector((HC.x + math.cos(a) * HR.x * r, HC.y + math.sin(a) * HR.y * r, zc))
        brim = mk(bm, 'hat_brim', fm); uv_cyl(brim, 3, HC.x, HC.y); solidify(brim, 0.03); parts.append(brim)
        # ear flaps, down over the ears to the jaw
        for s in (-1, 1):
            bm = bmesh.new()
            x = HC.x + s * HR.x * 1.24
            pts = [(-0.06, ez + 0.06), (0.07, ez + 0.05), (0.06, ez - 0.07), (0.0, ez - 0.11), (-0.05, ez - 0.06)]
            vs = [bm.verts.new((x, HC.y + dy, z)) for dy, z in pts]
            bm.faces.new(vs)
            f = mk(bm, f'hat_flap{s}', fm); uv_cyl(f, 3, HC.x, HC.y); solidify(f, 0.025); parts.append(f)
        # the back flap
        bm = bmesh.new()
        vs = []
        for k in range(9):
            a = math.pi * (0.15 + 0.7 * k / 8)
            for z in (ez + 0.05, ez - 0.05):
                vs.append(bm.verts.new((HC.x + math.cos(a) * HR.x * 1.22, HC.y + math.sin(a) * HR.y * 1.22, z)))
        for k in range(8):
            bm.faces.new((vs[k * 2], vs[k * 2 + 2], vs[k * 2 + 3], vs[k * 2 + 1]))
        bf = mk(bm, 'hat_back', fm); uv_cyl(bf, 3, HC.x, HC.y); solidify(bf, 0.02); parts.append(bf)
        # the cockade on the front
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.018, radius2=0.018, depth=0.006)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
        bmesh.ops.translate(bm, vec=(HC.x, HC.y - HR.y * 1.34, ez + 0.085), verts=bm.verts)
        ck = mk(bm, 'hat_badge', solid('Badge_' + kind, (0.7, 0.5, 0.12) if kind != 'ushanka_army' else (0.55, 0.05, 0.03), 0.3, 1.0 if kind != 'ushanka_army' else 0.2))
        parts.append(ck)
        for o in parts: bone_parent(o, 'head')
        added.extend(parts)

    def knit_cap(rgb, cook=False):
        col, nrm = knit(rgb); km = tex_mat('Knit_' + ('cook' if cook else str(rgb)), col, 0.95, nrm, 0.8)
        if cook:
            o = dome('cap', km, 1.12, ez + 0.06, ez + 0.03, 1.35)
        else:
            o = dome('cap', km, 1.1, ez + 0.05, ez + 0.0, 1.12)
            bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=1, radius2=1, depth=1)
            for v in bm.verts:
                a = math.atan2(v.co.y, v.co.x); y = HC.y + math.sin(a) * HR.y * 1.13
                z0 = ez + 0.05 + (ez - (ez + 0.05)) * (y - (HC.y - HR.y)) / (2 * HR.y)
                v.co = Vector((HC.x + math.cos(a) * HR.x * 1.13, y, z0 + 0.015 + v.co.z * 0.035))
            cuff = mk(bm, 'cap_cuff', km); uv_cyl(cuff, 3, HC.x, HC.y)
            bone_parent(cuff, 'head'); added.append(cuff)
        bone_parent(o, 'head'); added.append(o)

    def belt():
        z = pel.z + 0.1
        ring = [p for p in allv if abs(p.z - z) < 0.025 and abs(p.x - pel.x) < 0.25 and abs(p.y - pel.y) < 0.22]
        rx = max(abs(p.x - pel.x) for p in ring) + 0.065; ry = max(abs(p.y - pel.y) for p in ring) + 0.07
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=1, radius2=1, depth=1)
        for v in bm.verts:
            a = math.atan2(v.co.y, v.co.x)
            v.co = Vector((pel.x + math.cos(a) * rx, pel.y + math.sin(a) * ry, z + v.co.z * 0.05))
        b = mk(bm, 'belt', solid('Belt', (0.04, 0.035, 0.03), 0.5)); solidify(b, 0.008)
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=(0.07, 0.015, 0.055), verts=bm.verts); bmesh.ops.translate(bm, vec=(pel.x, pel.y - ry - 0.008, z), verts=bm.verts)
        bk = mk(bm, 'buckle', solid('Buckle', (0.55, 0.45, 0.2), 0.35, 1.0))
        bone_parent(b, 'spine_01'); bone_parent(bk, 'spine_01'); added.extend([b, bk])

    def scarf(rgb):
        z = neck.z + 0.01
        ring = [p for p in allv if abs(p.z - z) < 0.02 and abs(p.x - neck.x) < 0.12]
        r = max(math.hypot(p.x - neck.x, p.y - neck.y) for p in ring) + 0.035 if ring else 0.08
        col, nrm = knit(rgb); km = tex_mat('Scarf', col, 0.95, nrm, 0.8)
        bm = bmesh.new()
        res = bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=1, radius2=1, depth=1)
        for v in bm.verts:
            a = math.atan2(v.co.y, v.co.x)
            v.co = Vector((neck.x + math.cos(a) * r, neck.y + math.sin(a) * r * 0.95, z - 0.01 + v.co.z * 0.065))
        s = mk(bm, 'scarf', km); uv_cyl(s, 3, neck.x, neck.y); solidify(s, 0.018)
        bone_parent(s, 'spine_03'); added.append(s)

    # ---- the cook's apron
    def apron():
        foot = arm.matrix_world @ bones['calf_l'].head_local
        top = pel.z + 0.06; bottom = foot.z + 0.12
        ring = [p for p in allv if abs(p.z - top) < 0.03 and abs(p.x) < 0.24 and abs(p.y - pel.y) < 0.22]
        rx = max(abs(p.x) for p in ring) + 0.05; ry = max(abs(p.y - pel.y) for p in ring) + 0.06
        bm = bmesh.new(); N, Rn = 20, 8; rows = []
        for j in range(Rn + 1):
            t = j / Rn; z = top + (bottom - top) * t; fl = 1 + 0.15 * t * t
            rows.append([bm.verts.new((math.cos(a) * rx * fl, pel.y + math.sin(a) * ry * fl, z)) for a in np.linspace(math.pi * 1.08, math.pi * 1.92, N + 1)])
        for j in range(Rn):
            for i in range(N):
                bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
        o = mk(bm, 'apron', solid('Apron', (0.82, 0.8, 0.76), 0.9)); uv_cyl(o, 2, 0, pel.y); solidify(o, 0.004)
        for gname in ('pelvis', 'thigh_l', 'thigh_r'): o.vertex_groups.new(name=gname)
        for v in o.data.vertices:
            t = min(1, max(0, (top - v.co.z) / (top - bottom)))
            o.vertex_groups['pelvis'].add([v.index], 1 - t * 0.85, 'REPLACE')
            o.vertex_groups['thigh_l' if v.co.x > 0 else 'thigh_r'].add([v.index], t * 0.85, 'REPLACE')
        m = o.modifiers.new('Armature', 'ARMATURE'); m.object = arm; o.parent = arm; o.matrix_parent_inverse = arm.matrix_world.inverted()
        added.append(o)

    if P.get('coat'): coat(P['coat'])
    if (P.get('coat') or P['role'] == 'soldier') and P.get('gloves', True): gloves((0.02, 0.02, 0.022) if P['coat'] != 'orange' else (0.1, 0.08, 0.05))
    hat = P.get('hat')
    if hat and hat.startswith('ushanka'): ushanka(hat)
    elif hat == 'knit_black': knit_cap((0.03, 0.03, 0.035))
    elif hat == 'knit_blue': knit_cap((0.04, 0.07, 0.16))
    elif hat == 'cook': knit_cap((0.85, 0.84, 0.8), cook=True)
    if P.get('belt'): belt()
    if P.get('scarf'): scarf(P['scarf'])
    if P.get('apron'): apron()
    # the body (most of it is under the clothes by now) down to a budget, its armature kept
    tb = C.tris(body)
    if tb > 11000:
        dm = body.modifiers.new('dec', 'DECIMATE'); dm.ratio = 11000 / tb; dm.use_collapse_triangulate = True
        if P.get('keep_body') and body.vertex_groups.get('head'):
            # (the whole body kept under a torn coat: the face must not pay for it. Decimate keeps
            # the weighted vertices when its group is inverted)
            dm.vertex_group = 'head'; dm.invert_vertex_group = True; dm.vertex_group_factor = 1.0
        C.apply_one(body, 'dec')

    # ---- the face: 'talk' (a little jaw drop) for lip flap
    fs = 0.62 + 0.38 * min(1.0, M.z / 1.6)
    drop = 0.016 * fs; widen = 1.04
    chin = M.z - 0.13 * fs
    def warp(p):
        if abs(p.x) > 0.09 * fs or p.y > M.y + 0.08 or p.z > M.z + 0.012 or p.z < chin - 0.06:
            return p
        below = max(0.0, min(1.0, (M.z + 0.003 - p.z) / 0.006))
        side = 0.35 + 0.65 * max(0.0, 1.0 - (abs(p.x) / (0.03 * widen * fs)) ** 2)
        nk = max(0.0, min(1.0, (p.z - (chin - 0.06)) / 0.06))
        back = max(0.0, min(1.0, (M.y + 0.08 - p.y) / 0.05))
        q = p.copy(); q.z = p.z - drop * below * side * nk * back; q.y = p.y + 0.012 * below * nk * back * (drop / (0.085 * fs))
        return q
    for o in sc.objects:
        if o.type != 'MESH' or o in added: continue
        omw, inv = o.matrix_world, o.matrix_world.inverted()
        moved = [(v.index, inv @ warp(omw @ v.co)) for v in o.data.vertices]
        if not any((o.data.vertices[i].co - c).length > 1e-5 for i, c in moved): continue
        o.shape_key_add(name='Basis'); k = o.shape_key_add(name='talk'); k.value = 0.0
        for i, c in moved: k.data[i].co = c

    # ---- textures: sizes, then paint (hair, eyes, clothes tints, camo trousers)
    for img in bpy.data.images:
        if img.size[0] > 0 and not img.name.endswith(('_tex', '_nrm')):
            cap = 1024 if ('skin' in img.name.lower() or 'diffuse' in img.name.lower()) else 512
            if max(img.size) > cap:
                s_ = cap / max(img.size); img.scale(int(img.size[0] * s_), int(img.size[1] * s_))
    def tex_of(obj):
        for slot in obj.material_slots:
            m = slot.material
            if not (m and m.use_nodes): continue
            p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if p and p.inputs['Base Color'].links:
                stack = [p.inputs['Base Color'].links[0].from_node]
                while stack:
                    n = stack.pop()
                    if n.type == 'TEX_IMAGE' and n.image: return n.image
                    for inp in n.inputs: stack += [l.from_node for l in inp.links]
        return None
    camo_img = None
    for o in sc.objects:
        if o.type != 'MESH' or o in added: continue
        n = o.name.lower(); t = tex_of(o)
        if not t: continue
        hp = np.array(t.pixels[:], dtype=np.float32).reshape(-1, 4)
        if 'low-poly' in n:
            sat = hp[:, :3].max(1) - hp[:, :3].min(1)
            k = np.clip((sat - 0.06) / 0.12, 0, 1)[:, None]
            lum = hp[:, :3].mean(1, keepdims=True)
            hp[:, :3] = hp[:, :3] * (1 - k) + np.array(P['iris']) * (0.6 + 1.6 * lum) * k
        elif P['hair'] and P['hair'].split('/')[0] in o.name:
            hp[:, :3] = hp[:, :3].mean(1, keepdims=True) * np.array(P['hairc']) * 2.4
        elif P.get('camo_pants') and 'pants' in n:
            W, H = t.size
            col, _ = camo(size=max(W, H), seed=11)
            col = col[:H, :W].reshape(-1, 3)
            l = hp[:, :3].mean(1, keepdims=True); m_ = max(1e-3, float(l.mean()))
            hp[:, :3] = col * np.clip(l / m_, 0.5, 1.4)
        else:
            for k_, tint in P.get('tint', {}).items():
                if k_ in n:
                    l = hp[:, :3].mean(1, keepdims=True); m_ = max(1e-3, float(l[hp[:, 3] > 0.5].mean()) if (hp[:, 3] > 0.5).any() else float(l.mean()))
                    hp[:, :3] = np.clip(l / m_, 0, 2.2) * np.array(tint) * 1.25
        t.pixels[:] = hp.ravel(); t.update()

    g = lambda v: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]
    arm['eyeL'] = g(EL); arm['eyeR'] = g(ER); arm['mouth'] = g(M); arm['person'] = name; arm['height'] = round(height, 3); arm['role'] = P['role']
    pr = bones['pelvis'].head_local
    arm['pelvisRest'] = [round(pr.x, 4), round(pr.z, 4), round(-pr.y, 4)]
    return sc, arm, added

def export(sc, name):
    d = os.path.join(C.raw_dir(), 'people'); os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f'{name}.glb')
    C.export_glb(sc, path, skins=True, morph=True)
    return path

def preview(sc, arm, name):
    """arms down, front and three-quarter (EEVEE, one sun)"""
    for s, sd in ((1, 'l'), (-1, 'r')):
        pb = arm.pose.bones[f'upperarm_{sd}']; pb.rotation_mode = 'QUATERNION'
        rest = arm.data.bones[pb.name].matrix_local.to_quaternion()
        from mathutils import Quaternion
        pb.rotation_quaternion = rest.inverted() @ Quaternion((0, 1, 0), math.radians(33 * s)) @ rest
    out = C.preview(sc, 'person_' + name, [('front', (0.0, -3.4, 1.05), (0, 0, 0.95), 50), ('three', (1.7, -2.7, 1.35), (0, 0, 0.95), 50), ('face', (0.3, -1.0, 1.65), (0, 0, 1.55), 50)], res=(480, 640), world_rgb=(0.45, 0.47, 0.5))
    for pb in arm.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0)
    return out

if __name__ == '__main__' or True:
    ROOT_ = globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy')
    C.set_root(ROOT_)
    want = globals().get('WANT') or list(PEOPLE)
    result = {}
    for nm in want:
        sc, arm, added = build(nm, PEOPLE[nm])
        r = {'tris': sum(C.tris(o) for o in sc.objects if o.type == 'MESH'), 'height': arm['height'], 'added': [o.name for o in added]}
        if globals().get('PREVIEW', False): r['previews'] = preview(sc, arm, nm)
        if globals().get('EXPORT', True): r['export'] = export(sc, nm)
        result[nm] = r
