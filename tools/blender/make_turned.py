# The Turned (Обращённые): the station's people and Object 7's 1962 garrison, after the Guest.
# Built on make_people's builder (MPFB bodies on the game-engine rig, so the Turned's clips play on
# every one of them), then made into what the cold has made them:
#
#   bodies    emaciated (weight and muscle down), the skin frostbitten: grey-blue, mottled with
#             livid patches, dark veins, the fingers, toes, lips, nose and ears blackened (baked
#             into the skin texture through its UVs)
#   eyes      frozen milky white, with a faint cold glow (emissive)
#   the mouth a 'scream' shape key: the jaw dropped past where a jaw goes, the lips drawn back
#   clothes   torn open (the body kept beneath), the hems ragged, frosted white where the snow lay,
#             grimed, blood frozen down the front and the cuffs (baked through the coat's UVs)
#   ice       crystal clusters growing out through the skin and the cloth (hexagonal prisms with
#             pointed tips): the spine, a shoulder, the back of the head, a forearm... weighted to
#             the body where they root, so they move with it
#
#   turned_a   a glaciologist of Gromov's: the station's orange parka
#   turned_b   a woman scientist: a sweater under a navy quilted jacket, long frosted hair
#   turned_c   a soldier of the 1962 garrison: a grey wool greatcoat, an army ushanka, old and dry
#   gromov     the station chief: tall, heavy, half encased in ice (the boss)
#   shade      a 1962 subject in a thin shift (the game draws the Shades as a ghost: the body only)
#
# Their clips (STAGE='anims'): tools/blender/raw/people/turned_anims.glb on the same rig.
#
#   runpy: SCRIPT='make_turned', ARGS={'WANT': ['turned_a'], 'PREVIEW': True} | {'STAGE': 'anims'}
import bpy, bmesh, math, os, importlib, random
from mathutils import Vector, Matrix, Quaternion
from mathutils.kdtree import KDTree
import numpy as np
import common as C
importlib.reload(C)

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.path.join(globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy'), 'tools', 'blender')

def _lib(name, cut="if __name__ == '__main__' or True:"):
    """another asset script's definitions, without running it"""
    src = open(os.path.join(HERE, name + '.py'), encoding='utf-8').read().split(cut)[0]
    ns = {'__name__': name + '_lib', '__file__': os.path.join(HERE, name + '.py')}
    root = C.ROOT
    exec(compile(src, name + '.py', 'exec'), ns)
    C.set_root(root)                    # (its importlib.reload(common) forgets the project folder)
    return ns

sstep = lambda x: (lambda c: c * c * (3 - 2 * c))(np.clip(x, 0, 1))

def vnoise3(P, scale, seed):
    g = np.random.default_rng(seed).random((32, 32, 32)).astype(np.float32)
    q = P / scale
    i = np.floor(q).astype(np.int64); f = (q - i).astype(np.float32)
    f = f * f * (3 - 2 * f)
    def G(dx, dy, dz): return g[(i[:, 0] + dx) % 32, (i[:, 1] + dy) % 32, (i[:, 2] + dz) % 32]
    x0 = G(0, 0, 0) * (1 - f[:, 0]) + G(1, 0, 0) * f[:, 0]; x1 = G(0, 1, 0) * (1 - f[:, 0]) + G(1, 1, 0) * f[:, 0]
    x2 = G(0, 0, 1) * (1 - f[:, 0]) + G(1, 0, 1) * f[:, 0]; x3 = G(0, 1, 1) * (1 - f[:, 0]) + G(1, 1, 1) * f[:, 0]
    y0 = x0 * (1 - f[:, 1]) + x1 * f[:, 1]; y1 = x2 * (1 - f[:, 1]) + x3 * f[:, 1]
    return y0 * (1 - f[:, 2]) + y1 * f[:, 2]

def fbm3(P, scale, seed, oct=4):
    s, a, tot = 0.0, 1.0, 0.0
    for k in range(oct):
        s = s + vnoise3(P, scale / 2 ** k, seed + k) * a; tot += a; a *= 0.5
    return s / tot

# ---------------------------------------------------------------- the cast
def fem(PH, age, h, w, m, prop=0.5):
    d = PH(age, h, w, m, prop); d['gender'] = 0.0; return d

def cast(L):
    pheno, CL, SK = L['pheno'], L['CL'], L['SK']
    return {
        'turned_a': dict(ph=pheno(0.42, 0.62, 0.1, 0.25), skin=SK('middleage_caucasian_male'), hair=CL('short02'), brows=CL('eyebrow001'),
                         clothes=[CL('cortu_cargo_pants'), CL('culturalibre_male_boots')], tint={'pants': (0.09, 0.09, 0.09), 'boots': (0.04, 0.035, 0.03)},
                         coat='orange', hat=None, hairc=(0.55, 0.57, 0.6), iris=(0.8, 0.85, 0.9), role='crew', keep_body=True, gloves=False,
                         ice=[('spine', 26, 0.17, 0.22), ('shoulder_l', 14, 0.1, 0.14), ('cheek_l', 5, 0.025, 0.035)], torn=0.34, blood=0.7, seed=3),
        'turned_b': dict(ph=fem(pheno, 0.34, 0.5, 0.08, 0.2), skin=SK('young_caucasian_female'), hair=CL('long01'), brows=CL('eyebrow011'),
                         clothes=[CL('toigo_wool_pants'), CL('toigo_ankle_boots_female'), CL('toigo_fisherman_sweater')],
                         tint={'pants': (0.07, 0.07, 0.08), 'boots': (0.05, 0.04, 0.035), 'sweater': (0.42, 0.4, 0.36)},
                         coat='navy', hat=None, hairc=(0.62, 0.64, 0.68), iris=(0.8, 0.85, 0.9), role='crew', keep_body=True, gloves=False,
                         ice=[('head_back', 12, 0.09, 0.12), ('forearm_r', 14, 0.08, 0.1), ('spine', 10, 0.1, 0.12)], torn=0.38, blood=0.5, seed=5),
        'turned_c': dict(ph=pheno(0.62, 0.58, 0.0, 0.2), skin=SK('old_caucasian_male'), hair=CL('short01'), brows=CL('eyebrow003'),
                         clothes=[CL('toigo_wool_pants'), CL('culturalibre_hero_boots_1')], tint={'pants': (0.13, 0.12, 0.09), 'boots': (0.03, 0.03, 0.03)},
                         coat='officer', coat_rgb=(0.21, 0.2, 0.16), hat='ushanka_army', hairc=(0.5, 0.5, 0.5), iris=(0.8, 0.85, 0.9), role='crew', keep_body=True, gloves=False,
                         ice=[('chest', 18, 0.13, 0.16), ('spine', 20, 0.15, 0.18), ('thigh_r', 10, 0.09, 0.12)], torn=0.45, blood=0.35, old=True, seed=7),
        'gromov':   dict(ph=pheno(0.56, 1.0, 0.62, 1.0), skin=SK('jartur69_middleage_slavic_male_with_genitals_and_beard'), hair=CL('short03'), brows=CL('eyebrow003'),
                         clothes=[CL('cortu_cargo_pants'), CL('culturalibre_hero_boots_2')], tint={'pants': (0.06, 0.07, 0.1), 'boots': (0.04, 0.035, 0.03)},
                         coat='orange', hat=None, hairc=(0.42, 0.42, 0.44), iris=(0.8, 0.85, 0.9), role='crew', keep_body=True, gloves=False,
                         ice=[('spine', 44, 0.26, 0.34), ('shoulder_l', 26, 0.16, 0.28), ('shoulder_r', 18, 0.13, 0.2), ('chest', 22, 0.15, 0.2),
                              ('head_back', 16, 0.12, 0.2), ('forearm_l', 20, 0.12, 0.18), ('thigh_l', 12, 0.1, 0.14), ('cheek_r', 8, 0.035, 0.05)], torn=0.42, blood=0.9, seed=11),
        'shade':    dict(ph=fem(pheno, 0.28, 0.45, 0.04, 0.1), skin=SK('young_caucasian_female2'), hair=CL('long01'), brows=CL('eyebrow011'),
                         clothes=[CL('toigo_shift_dress')], tint={'dress': (0.62, 0.62, 0.6)}, coat=None, hat=None, hairc=(0.3, 0.3, 0.32),
                         iris=(0.8, 0.85, 0.9), role='crew', keep_body=True, gloves=False, ice=[], torn=0.0, blood=0.15, seed=13, shade=True),
    }

# ---------------------------------------------------------------- baking through a mesh's UVs
def raster(me, S):
    """per texel of an S x S map: the 3D point and normal of the surface it covers (padded past the
    islands' edges), from the mesh's active UVs"""
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tv = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('vertices', tv); tv = tv.reshape(-1, 3)
    tl = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    P = np.zeros((S, S, 3), np.float32); N = np.zeros((S, S, 3), np.float32); V = np.zeros((S, S), bool)
    T = (uv[tl] % 1.0) * S
    for i in range(nt):
        A, B, Cc = T[i]
        x0 = max(int(math.floor(min(A[0], B[0], Cc[0]))), 0); x1 = min(int(math.ceil(max(A[0], B[0], Cc[0]))), S)
        y0 = max(int(math.floor(min(A[1], B[1], Cc[1]))), 0); y1 = min(int(math.ceil(max(A[1], B[1], Cc[1]))), S)
        if x1 <= x0 or y1 <= y0 or (x1 - x0) * (y1 - y0) > S * S // 4: continue
        den = (B[1] - Cc[1]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[1] - Cc[1])
        if abs(den) < 1e-9: continue
        xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        w0 = ((B[1] - Cc[1]) * (xs - Cc[0]) + (Cc[0] - B[0]) * (ys - Cc[1])) / den
        w1 = ((Cc[1] - A[1]) * (xs - Cc[0]) + (A[0] - Cc[0]) * (ys - Cc[1])) / den
        w2 = 1 - w0 - w1
        m = (w0 >= -0.03) & (w1 >= -0.03) & (w2 >= -0.03)
        if not m.any(): continue
        rr, cc = ys[m].astype(int), xs[m].astype(int)
        W = np.stack([w0[m], w1[m], w2[m]], 1).astype(np.float32)
        P[rr, cc] = W @ co[tv[i]]; N[rr, cc] = W @ nr[tv[i]]; V[rr, cc] = True
    for it in range(6):
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sv = np.roll(V, (dy, dx), (0, 1)); take = ~V & sv
            if not take.any(): continue
            P[take] = np.roll(P, (dy, dx), (0, 1))[take]; N[take] = np.roll(N, (dy, dx), (0, 1))[take]
            V |= take
    N /= np.maximum(np.linalg.norm(N, axis=2, keepdims=True), 1e-6)
    return P, N, V

def tex_of(obj):
    for slot in obj.material_slots:
        m = slot.material
        if not (m and m.use_nodes): continue
        p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if p and p.inputs['Base Color'].links:
            stack = [p.inputs['Base Color'].links[0].from_node]
            while stack:
                n = stack.pop()
                if n.type == 'TEX_IMAGE' and n.image: return n.image, m, p
                for inp in n.inputs: stack += [l.from_node for l in inp.links]
    return None, None, None

def img_px(img):
    W, H = img.size
    return np.array(img.pixels[:], np.float32).reshape(H, W, 4)

def set_px(img, px):
    img.pixels.foreach_set(px.astype(np.float32).ravel()); img.update()
    try: img.pack()
    except Exception: pass

# ---------------------------------------------------------------- what the cold does
def frostbite(body, arm, P, LM):
    """the skin texture: grey-blue and livid, dark veins, the extremities blackened"""
    img, mat, bsdf = tex_of(body)
    if img is None: return 'no skin texture'
    px = img_px(img); H, W = px.shape[:2]
    if (H, W) != (1024, 1024):
        img.scale(1024, 1024); px = img_px(img); H, W = 1024, 1024
    Pm, Nm, Vm = raster(body.data, 1024)
    mw3 = np.array(body.matrix_world, np.float32)
    Pf = Pm.reshape(-1, 3) @ mw3[:3, :3].T + mw3[:3, 3]
    seed = P.get('seed', 1)
    lum = px[..., :3].mean(-1).reshape(-1)
    base = np.array([0.7, 0.72, 0.75], np.float32) if not P.get('shade') else np.array([0.76, 0.77, 0.79], np.float32)
    col = (lum / max(1e-3, float(lum[Vm.ravel()].mean())))[:, None] * base[None] * 0.92
    # livid mottling (dark purple-blue blotches) and greenish-grey patches
    mot = fbm3(Pf, 0.12, seed + 1)
    col *= (1 - 0.16 * sstep((mot - 0.45) / 0.25))[:, None] * np.array([[0.96, 0.93, 1.0]])
    pat = sstep((fbm3(Pf, 0.2, seed + 2) - 0.5) / 0.2)
    col = col * (1 - 0.1 * pat)[:, None] + np.array([[0.015, 0.02, 0.01]]) * pat[:, None]
    # veins: a dark blue network (ridged noise), strongest at the temples, the neck, the forearms, the chest
    rid = 1 - np.abs(fbm3(Pf, 0.07, seed + 3, 3) * 2 - 1)
    vein = sstep((rid - 0.93) / 0.04) * sstep((fbm3(Pf, 0.25, seed + 4) - 0.5) / 0.15)
    col = col * (1 - 0.38 * vein)[:, None] + np.array([[0.1, 0.12, 0.22]]) * (0.38 * vein)[:, None]
    # the extremities: fingers, toes, nose, ears, lips, black and purple
    x, y, z = Pf[:, 0], Pf[:, 1], Pf[:, 2]
    dark = np.zeros(len(Pf), np.float32)
    for tip in LM['fingertips']:
        d = np.linalg.norm(Pf - np.array(tip, np.float32), axis=1)
        dark = np.maximum(dark, sstep((0.075 - d) / 0.05))
    for toe in LM['toes']:
        d = np.linalg.norm(Pf - np.array(toe, np.float32), axis=1)
        dark = np.maximum(dark, sstep((0.09 - d) / 0.05))
    for k, r, a in (('nose', 0.014, 0.7), ('earL', 0.028, 0.75), ('earR', 0.028, 0.75), ('mouth', 0.013, 0.9)):
        d = np.linalg.norm(Pf - np.array(LM[k], np.float32), axis=1)
        dark = np.maximum(dark, sstep((r - d) / (r * 0.6)) * a)
    dark *= 0.75 + 0.25 * fbm3(Pf, 0.02, seed + 5)
    col = col * (1 - 0.85 * dark)[:, None] + np.array([[0.07, 0.03, 0.06]]) * (0.85 * dark)[:, None]
    # dark round the eyes (sunken)
    for k, s_ in (('eyeL', 1), ('eyeR', -1)):
        e = np.array(LM[k], np.float32)
        d = np.linalg.norm(Pf - e, axis=1)
        col *= (1 - 0.42 * sstep((0.04 - d) / 0.024))[:, None] * np.array([[0.97, 0.95, 1.0]])
        d = np.linalg.norm((Pf - (e + np.array([s_ * 0.012, 0.012, -0.05], np.float32))) * np.array([1.4, 1, 0.8], np.float32), axis=1)
        col *= (1 - 0.26 * sstep((0.035 - d) / 0.025))[:, None]
    # frost in the creases (fine white sparkle where the noise peaks)
    fr = sstep((vnoise3(Pf, 0.006, seed + 6) - 0.82) / 0.08) * 0.35
    col = col * (1 - fr)[:, None] + np.array([[0.85, 0.9, 0.95]]) * fr[:, None]
    # blood frozen round the mouth and down the chin
    bl = P.get('blood', 0.5) * sstep((0.04 - np.linalg.norm((Pf - np.array(LM['mouth'], np.float32)) * np.array([1, 1, 0.6]), axis=1)) / 0.025) * sstep((fbm3(Pf * np.array([1, 1, 0.3]), 0.02, seed + 7) - 0.4) / 0.15)
    col = col * (1 - 0.8 * bl)[:, None] + np.array([[0.18, 0.02, 0.02]]) * (0.8 * bl)[:, None]
    col = col.reshape(H, W, 3)
    keep = ~Vm
    out = px.copy()
    out[..., :3] = np.where(keep[..., None], px[..., :3] * base[None, None] * 0.9, col)
    set_px(img, np.clip(out, 0, 1))
    if bsdf is not None:
        bsdf.inputs['Roughness'].default_value = 0.62
    return 'ok'

def milky_eyes(sc, P):
    n = 0
    for o in sc.objects:
        if o.type != 'MESH' or 'low-poly' not in o.name.lower(): continue
        img, mat, bsdf = tex_of(o)
        if img is not None:
            px = img_px(img)
            lum = px[..., :3].mean(-1, keepdims=True)
            sat = px[..., :3].max(-1, keepdims=True) - px[..., :3].min(-1, keepdims=True)
            iris = np.clip((sat - 0.05) / 0.1, 0, 1) + np.clip((0.25 - lum) / 0.2, 0, 1)
            iris = np.clip(iris, 0, 1)
            white = np.array([0.82, 0.86, 0.88], np.float32)
            ring = np.array([0.6, 0.68, 0.74], np.float32)
            px[..., :3] = white * (0.85 + 0.15 * lum) * (1 - iris) + ring * (0.8 + 0.3 * lum) * iris
            set_px(img, px)
        if bsdf is not None:
            bsdf.inputs['Emission Color'].default_value = (0.45, 0.75, 0.95, 1)
            bsdf.inputs['Emission Strength'].default_value = 0.35 if not P.get('shade') else 0.8
            bsdf.inputs['Roughness'].default_value = 0.1
        n += 1
    return n

def scream_key(sc, arm, added):
    """the jaw dropped past where a jaw goes, the lips drawn back off the teeth"""
    g = arm['mouth']; M = Vector((g[0], -g[2], g[1]))
    fs = 0.62 + 0.38 * min(1.0, M.z / 1.6)
    chin = M.z - 0.13 * fs
    drop = 0.06 * fs
    def warp(p):
        if abs(p.x) > 0.1 * fs or p.y > M.y + 0.09 or p.z > M.z + 0.03 or p.z < chin - 0.07:
            return p
        q = p.copy()
        if p.z > M.z + 0.002:                                  # the upper lip drawn up and back
            k = max(0.0, 1 - (p.z - M.z) / 0.028) * max(0.0, 1 - abs(p.x) / (0.035 * fs)) * max(0.0, min(1.0, (M.y + 0.03 - p.y) / 0.03))
            q.z += 0.008 * k; q.y += 0.004 * k
            return q
        below = max(0.0, min(1.0, (M.z + 0.003 - p.z) / 0.006))
        side = 0.3 + 0.7 * max(0.0, 1.0 - (abs(p.x) / (0.045 * fs)) ** 2)
        nk = max(0.0, min(1.0, (p.z - (chin - 0.07)) / 0.07))
        back = max(0.0, min(1.0, (M.y + 0.09 - p.y) / 0.06))
        q.z = p.z - drop * below * side * nk * back
        q.y = p.y + 0.02 * below * nk * back
        q.x = p.x * (1 + 0.12 * below * nk * back)
        return q
    n = 0
    for o in sc.objects:
        if o.type != 'MESH' or o in added: continue
        omw, inv = o.matrix_world, o.matrix_world.inverted()
        moved = [(v.index, inv @ warp(omw @ v.co)) for v in o.data.vertices]
        if not any((o.data.vertices[i].co - c).length > 1e-5 for i, c in moved): continue
        if not o.data.shape_keys: o.shape_key_add(name='Basis')
        k = o.shape_key_add(name='scream'); k.value = 0.0
        for i, c in moved: k.data[i].co = c
        n += 1
    return n

def landmarks(body, arm):
    bones = arm.data.bones
    mw = arm.matrix_world
    LM = {}
    g = arm['mouth']; LM['mouth'] = Vector((g[0], -g[2], g[1]))
    for k in ('eyeL', 'eyeR'):
        g = arm[k]; LM[k] = Vector((g[0], -g[2], g[1]))
    co = np.array([body.matrix_world @ v.co for v in body.data.vertices], np.float32)
    eyes = (LM['eyeL'] + LM['eyeR']) / 2
    # the nose tip: the most forward (-y) point of the face between the eyes and the mouth
    m = (np.abs(co[:, 0] - eyes.x) < 0.02) & (co[:, 2] < eyes.z) & (co[:, 2] > LM['mouth'].z)
    LM['nose'] = Vector(co[m][np.argmin(co[m][:, 1])]) if m.any() else eyes + Vector((0, -0.1, -0.04))
    for s, k in ((1, 'earL'), (-1, 'earR')):
        m = (np.abs(co[:, 2] - (eyes.z - 0.01)) < 0.03) & (np.abs(co[:, 1] - (eyes.y + 0.09)) < 0.04)
        side = co[m][:, 0] * s
        LM[k] = Vector(co[m][np.argmax(side)]) if m.any() else eyes + Vector((s * 0.08, 0.09, 0))
    LM['fingertips'] = []
    for sd in ('l', 'r'):
        for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
            b = bones.get(f'{f}_03_{sd}')
            if b: LM['fingertips'].append(tuple(mw @ b.tail_local))
    LM['toes'] = [tuple(mw @ bones[f'ball_{sd}'].tail_local) for sd in ('l', 'r') if f'ball_{sd}' in bones]
    return LM

# ---------------------------------------------------------------- the clothes, torn and frozen
def coat_bake(obj, P, kind, rgb=None):
    """a new texture for a coat: its cloth, frost where snow lay (on what faces up, at the hem and
    cuffs), grime, blood frozen down the front and on the cuffs, darker frayed edges"""
    S = 1024
    Pm, Nm, Vm = raster(obj.data, S)
    Pf = Pm.reshape(-1, 3); Nf = Nm.reshape(-1, 3)
    seed = P.get('seed', 1)
    yy, xx = np.mgrid[0:S, 0:S] / S
    if kind in ('orange', 'navy'):
        cells = 46 if kind == 'orange' else 56
        a = np.abs(((xx * cells + yy * cells) % 1) - 0.5); b = np.abs(((xx * cells - yy * cells) % 1) - 0.5)
        puff = np.clip(np.minimum(a, b) * 4, 0, 1) ** 0.6
        base = np.array((0.8, 0.27, 0.06) if kind == 'orange' else (0.035, 0.045, 0.075), np.float32)
        h = puff
    else:
        k = 0.75 + 0.25 * np.abs(np.sin(xx * math.pi * 90)) * (0.85 + 0.15 * np.sin(yy * math.pi * 140))
        base = np.array(rgb or (0.21, 0.2, 0.16), np.float32)
        h = k; puff = k
    rng = np.random.default_rng(seed)
    n = rng.random((S, S)).astype(np.float32)
    col = base[None, None] * (0.84 + 0.16 * puff[..., None] + 0.08 * n[..., None])
    col = col.reshape(-1, 3)
    up = np.clip(Nf[:, 2], 0, 1)
    z = Pf[:, 2]
    frost = sstep((fbm3(Pf, 0.05, seed + 20) - 0.52) / 0.14) * (0.08 + 0.6 * up) + sstep((0.75 - z) / 0.25) * 0.18
    frost = np.clip(frost * (0.45 if kind == 'officer' else 1.0), 0, 0.6)
    grime = fbm3(Pf, 0.12, seed + 21)
    col *= (0.72 + 0.32 * grime)[:, None]
    blood = P.get('blood', 0.5) * (sstep((-Nf[:, 1] - 0.2) / 0.4) * sstep((z - 0.95) / 0.1) * sstep((1.45 - z) / 0.1) * 0.9
                                   + sstep((np.abs(Pf[:, 0]) - 0.45) / 0.08) * 0.8)
    drip = fbm3(Pf * np.array([1, 1, 0.25], np.float32), 0.03, seed + 22)
    blood = np.clip(blood * sstep((drip - 0.5) / 0.08), 0, 1)
    col = col * (1 - 0.88 * blood)[:, None] + np.array([[0.09, 0.012, 0.008]]) * (0.88 * blood)[:, None]
    col = col * (1 - frost)[:, None] + np.array([[0.8, 0.84, 0.88]]) * frost[:, None]
    col = np.clip(col, 0, 1).reshape(S, S, 3)
    hh = h * 0.7 + n * 0.25 + (frost.reshape(S, S) * 0.3)
    gy, gx = np.gradient(hh)
    nm = np.dstack([-gx * 3, -gy * 3, np.ones_like(hh)]); nm /= np.linalg.norm(nm, axis=2, keepdims=True)
    name = obj.name + '_' + P.get('_name', 'x')
    mat = C.mat_textured('Turned_' + name, base=C.image_tex('Turned_' + name + '_tex', col), normal=C.image_tex('Turned_' + name + '_nrm', (nm * 0.5 + 0.5).astype(np.float32), 'Non-Color'), rough=0.9, normal_strength=0.8)
    obj.data.materials.clear(); obj.data.materials.append(mat)

def tear(obj, P, hem=None):
    """holes torn in the cloth (3D noise: continuous over the seams), the hem left ragged"""
    amt = P.get('torn', 0.3)
    if amt <= 0: return 0
    bm = bmesh.new(); bm.from_mesh(obj.data)
    cs = np.array([f.calc_center_median()[:] for f in bm.faces], np.float32)
    nz = fbm3(cs, 0.09, P.get('seed', 1) + 30)
    kill = nz > np.quantile(nz, 1 - amt * 0.3)
    if hem is not None:
        rag = fbm3(cs * np.array([3, 3, 1], np.float32), 0.04, P.get('seed', 1) + 31)
        kill |= cs[:, 2] < hem + rag * 0.16
    faces = [f for f, k in zip(bm.faces, kill) if k]
    bmesh.ops.delete(bm, geom=faces, context='FACES')
    bm.to_mesh(obj.data); bm.free()
    return len(faces)

def smooth2(H, W, cells, seed):
    """smooth 2D value noise (0..1), `cells` across"""
    g = np.random.default_rng(seed).random((cells + 2, cells + 2)).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    xi, yi = xx / W * cells, yy / H * cells
    x0, y0 = np.floor(xi).astype(int), np.floor(yi).astype(int)
    fx, fy = xi - x0, yi - y0; fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = g[y0, x0], g[y0, x0 + 1], g[y0 + 1, x0], g[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def tint_cloth(sc, P, added):
    """the MakeHuman clothes (trousers, boots, sweater, dress): frosted, grimed, bloodied"""
    n = 0
    for o in sc.objects:
        if o.type != 'MESH' or o in added: continue
        nm = o.name.lower()
        if not any(k in nm for k in ('pants', 'boots', 'sweater', 'dress', 'shoes', 'suit')): continue
        img, mat, bsdf = tex_of(o)
        if img is None: continue
        px = img_px(img)
        H, W = px.shape[:2]
        blot = smooth2(H, W, 18, P.get('seed', 1) + n) * 0.6 + smooth2(H, W, 60, P.get('seed', 1) + n + 50) * 0.4
        px[..., :3] *= (0.75 + 0.3 * blot)[..., None]
        fr = np.clip((blot - 0.62) * 1.6, 0, 0.4)[..., None]
        px[..., :3] = px[..., :3] * (1 - fr) + np.array([0.78, 0.82, 0.86]) * fr
        set_px(img, np.clip(px, 0, 1))
        n += 1
    return n

# ---------------------------------------------------------------- ice growing out of them
ANCHORS = {
    'spine':      (('spine_02', 'spine_03'), (0, 1, 0.1)),
    'chest':      (('spine_03', 'spine_02'), (0, -1, 0.1)),
    'shoulder_l': (('clavicle_l', 'upperarm_l'), (0.4, 0.2, 1)),
    'shoulder_r': (('clavicle_r', 'upperarm_r'), (-0.4, 0.2, 1)),
    'head_back':  (('head',), (0, 1, 0.5)),
    'forearm_l':  (('lowerarm_l',), (0.6, 0.3, 0.3)),
    'forearm_r':  (('lowerarm_r',), (-0.6, 0.3, 0.3)),
    'thigh_l':    (('thigh_l',), (1, 0, 0)),
    'thigh_r':    (('thigh_r',), (-1, 0, 0)),
    'cheek_l':    (('head',), (0.85, -0.45, -0.25)),
    'cheek_r':    (('head',), (-0.85, -0.45, -0.25)),
}

def crystal(bm, base, d, L, r, twist):
    d = d.normalized()
    a = d.orthogonal().normalized(); b = d.cross(a)
    ring0, ring1 = [], []
    for i in range(6):
        ang = twist + i * math.pi / 3
        off = (a * math.cos(ang) + b * math.sin(ang)) * r
        ring0.append(bm.verts.new(base - d * 0.015 + off * 0.85))
        ring1.append(bm.verts.new(base + d * L * 0.72 + off))
    tip = bm.verts.new(base + d * L)
    for i in range(6):
        j = (i + 1) % 6
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
        bm.faces.new((ring1[i], ring1[j], tip))

def ice_growth(sc, body, arm, P):
    spec = P.get('ice') or []
    if not spec: return None
    bm = bmesh.new()
    gi = {g.index: g.name for g in body.vertex_groups}
    mw = body.matrix_world
    verts = body.data.vertices
    bn = set(arm.data.bones.keys())                         # (MakeHuman's helper groups, Left/Right/Mid, weigh 1 too)
    dom = []
    for v in verts:
        best, bw = None, 0
        for g in v.groups:
            if g.weight > bw and gi.get(g.group) in bn: best, bw = gi.get(g.group), g.weight
        dom.append(best)
    rng = random.Random(P.get('seed', 1) * 101)
    roots = []
    for name, count, radius, maxlen in spec:
        bones, want = ANCHORS[name]
        want = Vector(want).normalized()
        cand = [v for v, d in zip(verts, dom) if d in bones and (mw.to_3x3() @ v.normal).normalized().dot(want) > 0.45]
        if not cand: continue
        c0 = mw @ rng.choice(cand).co
        near = [v for v in cand if ((mw @ v.co) - c0).length < radius]
        for k in range(count):
            v = rng.choice(near)
            p = mw @ v.co
            nrm = (mw.to_3x3() @ v.normal).normalized()
            fall = 1 - min(1.0, (p - c0).length / radius) * 0.7
            d = (nrm + want * 0.4 + Vector((rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45), rng.uniform(-0.2, 0.5)))).normalized()
            through = 0.02 if 'head' in bones else 0.07                # (out through the coat, or just the skin)
            L = through + maxlen * fall * rng.uniform(0.25, 1.0)
            r = max(0.004, (L - through * 0.6) * rng.uniform(0.1, 0.16) + 0.004)
            crystal(bm, p, d, L, r, rng.uniform(0, math.pi))
            roots.append((len(bm.verts), v.index))
    me = bpy.data.meshes.new('IceGrowth'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('IceGrowth', me); sc.collection.objects.link(o)
    mat = C.mat('Ice_growth', (0.55, 0.7, 0.82), 0.06, emit=(0.06, 0.16, 0.26), emit_strength=1.0)
    me.materials.append(mat)
    for p_ in me.polygons: p_.use_smooth = False
    # weights: every crystal (13 vertices) the weights of the body vertex it grew from
    for g in body.vertex_groups: o.vertex_groups.new(name=g.name)
    G = {g.name: g for g in o.vertex_groups}
    start = 0
    for end, vi in roots:
        idx = list(range(start, end))
        for g in verts[vi].groups:
            nm = gi.get(g.group)
            if nm in G and nm in bn and g.weight > 1e-3: G[nm].add(idx, g.weight, 'REPLACE')
        start = end
    m = o.modifiers.new('Armature', 'ARMATURE'); m.object = arm
    o.parent = arm; o.matrix_parent_inverse = arm.matrix_world.inverted()
    C.box_uv(me, 0.3)
    return o

# ---------------------------------------------------------------- one of them
def build_one(L, name, P):
    P = dict(P); P['_name'] = name
    sc, arm, added = L['build'](name, P)
    meshes = [o for o in sc.objects if o.type == 'MESH']
    body = max((o for o in meshes if o not in added), key=lambda o: len(o.vertex_groups))
    info = {'body': body.name}
    LM = landmarks(body, arm)
    info['frost'] = frostbite(body, arm, P, LM)
    info['eyes'] = milky_eyes(sc, P)
    info['scream'] = scream_key(sc, arm, added)
    # the coat: torn, re-textured (its skirt ragged at the hem)
    for o in list(added):
        if o.name.startswith('CoatSkirt'):
            zs = [v.co.z for v in o.data.vertices]
            info['torn_skirt'] = tear(o, P, hem=min(zs) + 0.02)
            coat_bake(o, P, P.get('coat'), P.get('coat_rgb'))
        elif o.name.startswith('Coat'):
            info['torn_coat'] = tear(o, P)
            coat_bake(o, P, P.get('coat'), P.get('coat_rgb'))
    info['cloth'] = tint_cloth(sc, P, added)
    if P.get('shade'):
        for o in meshes:
            if o not in added and any(k in o.name.lower() for k in ('dress',)): tear(o, dict(P, torn=0.25))
    ice = ice_growth(sc, body, arm, P)
    if ice: added.append(ice); info['ice_tris'] = C.tris(ice)
    arm['turned'] = name
    arm['big'] = 1 if name == 'gromov' else 0
    info['tris'] = sum(C.tris(o) for o in sc.objects if o.type == 'MESH')
    return sc, arm, added, info

# ---------------------------------------------------------------- their clips
def anims(preview=False, export=True):
    A = _lib('make_anims')
    R, ang, ease, bump, hands, hand_curl, arms_down, legs_walk = A['R'], A['ang'], A['ease'], A['bump'], A['hands'], A['hand_curl'], A['arms_down'], A['legs_walk']
    X = A['X']
    FPS, STEP = 30, 2
    def osc(t, Lc, k, ph=0.0): return math.sin(2 * math.pi * k * t / Lc + ph)
    def jerk(t, at, w=0.07, back=0.6):
        """a twitch: there at once, gone slowly"""
        return ease(t, at, at + w) * (1 - ease(t, at + w + 0.05, at + w + 0.05 + back))
    def claws(pose, curl=0.7):
        hands(pose, curl, 0.5)
        for sd in ('l', 'r'):
            for f in ('index', 'middle', 'ring', 'pinky'):
                pose[f'{f}_01_{sd}'] = ('local', R(X, -12))         # (the first joints bent back: a claw)
    def hunch(pose, k=1.0):
        pose['spine_01'] = ang(pitch=9 * k); pose['spine_02'] = ang(pitch=10 * k); pose['spine_03'] = ang(pitch=8 * k)
        pose['neck_01'] = ang(pitch=-4 * k); pose['head'] = ang(pitch=-6 * k)
        pose['clavicle_l'] = ang(pitch=6 * k, s=1); pose['clavicle_r'] = ang(pitch=6 * k, s=-1)

    def t_idle(t, Lc=6.0):
        pose = {}
        hunch(pose)
        sway = osc(t, Lc, 1)
        pose['pelvis'] = ang(roll=-3 * sway, yaw=2 * osc(t, Lc, 1, 1))
        pose['pelvis_loc'] = (0.025 * sway, 0, -0.03)
        for s, sd in ((1, 'l'), (-1, 'r')):
            load = max(0.0, sway * s)
            pose[f'thigh_{sd}'] = ang(pitch=-4 - 5 * (1 - load), roll=2, s=s); pose[f'calf_{sd}'] = ang(pitch=8 + 10 * (1 - load)); pose[f'foot_{sd}'] = ang(pitch=-4 * (1 - load))
            arms_down(pose, s, out=5, fwd=10 + 3 * osc(t, Lc, 1, s), elbow=22 + 4 * osc(t, Lc, 2, s), twist=10)
        j1, j2, j3 = jerk(t, 1.3), jerk(t, 3.15, 0.05, 0.4), jerk(t, 4.7, 0.06, 0.8)
        pose['neck_01'] = ang(pitch=-6, yaw=10 * j1 - 6 * j3, roll=8)
        pose['head'] = ang(pitch=-8 + 14 * j2, yaw=26 * j1 - 20 * j3, roll=18 + 10 * j2)
        claws(pose, 0.65 + 0.2 * j2)
        return pose

    def t_shamble(t, Lc=1.5):
        """a limping walk: the right leg dragged, the body lurching onto the left"""
        p = (t / Lc) % 1
        pose = {}
        legs_walk(pose, p, 0.7)
        q = (p + 0.5) % 1
        pose['calf_r'] = ang(pitch=4 + 16 * bump(q, 0.74, 0.12))
        pose['foot_r'] = ang(pitch=12 + 8 * bump(q, 0.7, 0.1))
        pose['thigh_r'] = ang(pitch=(-4 - 14 * math.cos(2 * math.pi * q)) * 0.7, yaw=-8, s=-1)
        pose['pelvis'] = ang(yaw=-5 * math.cos(2 * math.pi * p), roll=-7 * math.sin(2 * math.pi * p) - 3, pitch=5)
        pose['pelvis_loc'] = (0.03 * math.sin(2 * math.pi * p), 0, -0.04 - 0.03 * (0.5 + 0.5 * math.cos(4 * math.pi * p)))
        hunch(pose, 1.2)
        for s, sd, ph in ((1, 'l', 0.0), (-1, 'r', 0.5)):
            a = (p + ph + 0.62) % 1
            arms_down(pose, s, out=6, fwd=8 - 9 * math.cos(2 * math.pi * a), elbow=18 + 8 * max(0, -math.cos(2 * math.pi * a)), twist=12)
        pose['neck_01'] = ang(pitch=-8, roll=10 + 5 * math.sin(2 * math.pi * p))
        pose['head'] = ang(pitch=-6 + 6 * math.sin(4 * math.pi * p), roll=14 + 6 * math.sin(2 * math.pi * p + 1), yaw=6 * jerk(t % Lc, 0.9, 0.05, 0.3))
        claws(pose)
        return pose

    def t_run(t, Lc=0.6):
        """the sprint: thrown forward, long strides, the arms reaching and flailing"""
        p = (t / Lc) % 1
        pose = {}
        for s, sd, ph in ((1, 'l', 0.0), (-1, 'r', 0.5)):
            q = (p + ph) % 1
            thigh = -14 - 40 * math.cos(2 * math.pi * q)
            knee = 18 + 95 * bump(q, 0.7, 0.16) + 20 * bump(q, 0.1, 0.08)
            pose[f'thigh_{sd}'] = ang(pitch=thigh, yaw=-3, s=s)
            pose[f'calf_{sd}'] = ang(pitch=knee)
            pose[f'foot_{sd}'] = ang(pitch=-14 * bump(q, 0.05, 0.06) + 20 * bump(q, 0.55, 0.08))
            a = (q + 0.5) % 1
            arms_down(pose, s, out=18 + 10 * math.sin(2 * math.pi * a), fwd=35 - 45 * math.cos(2 * math.pi * a), elbow=30 + 40 * max(0, math.cos(2 * math.pi * a)), twist=8)
        pose['pelvis'] = ang(pitch=18, yaw=-9 * math.cos(2 * math.pi * p), roll=-5 * math.sin(2 * math.pi * p))
        pose['pelvis_loc'] = (0.02 * math.sin(2 * math.pi * p), 0, -0.07 + 0.05 * abs(math.sin(2 * math.pi * p)))
        pose['spine_01'] = ang(pitch=12, yaw=6 * math.cos(2 * math.pi * p)); pose['spine_02'] = ang(pitch=8, yaw=6 * math.cos(2 * math.pi * p)); pose['spine_03'] = ang(pitch=4)
        pose['neck_01'] = ang(pitch=-22, roll=6 * math.sin(2 * math.pi * p)); pose['head'] = ang(pitch=-14 + 6 * math.sin(4 * math.pi * p), roll=8)
        claws(pose, 0.5)
        return pose

    def t_attack(t):
        """the lunge: the arms up and out, a grab, the head driven in to bite, and back"""
        up = ease(t, 0.0, 0.3); grab = ease(t, 0.3, 0.45); bite = ease(t, 0.45, 0.6) * (1 - ease(t, 0.7, 1.0)); back = ease(t, 0.9, 1.3)
        k = up * (1 - back)
        pose = {}
        pose['pelvis'] = ang(pitch=10 + 14 * grab * (1 - back)); pose['pelvis_loc'] = (0, -0.18 * grab * (1 - back), -0.05 - 0.04 * k)
        for s, sd in ((1, 'l'), (-1, 'r')):
            pose[f'thigh_{sd}'] = ang(pitch=(-26 if s > 0 else 14) * k, s=s); pose[f'calf_{sd}'] = ang(pitch=(30 if s > 0 else 12) * k + 6)
            arms_down(pose, s, out=12 + 40 * k - 30 * grab * (1 - back), fwd=10 + 75 * k, elbow=20 + 10 * k + 40 * grab * (1 - back), twist=-20 * k)
        pose['spine_01'] = ang(pitch=8 + 10 * grab * (1 - back)); pose['spine_02'] = ang(pitch=6 + 8 * bite); pose['spine_03'] = ang(pitch=4 + 6 * bite)
        pose['neck_01'] = ang(pitch=-14 * k + 12 * bite); pose['head'] = ang(pitch=-16 * k + 14 * bite, roll=6 * math.sin(t * 40) * bite)
        claws(pose, 0.3 + 0.6 * grab * (1 - back))
        return pose

    def t_scream(t):
        """arms flung back, the spine arched, the head thrown back, then forward and shaking"""
        u = ease(t, 0.0, 0.35) * (1 - ease(t, 1.7, 2.2)); fw = ease(t, 0.5, 0.8) * (1 - ease(t, 1.6, 2.0))
        shake = math.sin(t * 47) * 4 * fw + math.sin(t * 31) * 3 * fw
        pose = {}
        pose['pelvis'] = ang(pitch=-4 * u); pose['pelvis_loc'] = (0, 0, -0.04 * u)
        for s, sd in ((1, 'l'), (-1, 'r')):
            pose[f'thigh_{sd}'] = ang(pitch=-4 * u, roll=6 * u, s=s); pose[f'calf_{sd}'] = ang(pitch=10 * u)
            arms_down(pose, s, out=10 + 45 * u, fwd=-25 * u + 20 * fw, elbow=15 + 25 * u, twist=-15 * u)
        pose['spine_01'] = ang(pitch=-8 * u + 10 * fw); pose['spine_02'] = ang(pitch=-10 * u + 10 * fw); pose['spine_03'] = ang(pitch=-8 * u + 6 * fw)
        pose['neck_01'] = ang(pitch=-20 * u + 18 * fw, yaw=shake * 0.5); pose['head'] = ang(pitch=-25 * u + 22 * fw + shake, roll=shake)
        claws(pose, 0.2 + 0.7 * u)
        return pose

    def t_hurt(t):
        u = ease(t, 0.0, 0.06) * (1 - ease(t, 0.12, 0.5))
        pose = t_idle(1.0)
        pose['spine_02'] = ang(pitch=10 - 16 * u, yaw=10 * u); pose['spine_03'] = ang(pitch=8 - 12 * u)
        pose['head'] = ang(pitch=-6 - 20 * u, roll=18 - 10 * u, yaw=-12 * u)
        pose['pelvis_loc'] = (0, 0.06 * u, -0.03)
        return pose

    def t_death(t):
        kn = ease(t, 0.0, 0.5); fall = ease(t, 0.55, 1.3); st = ease(t, 1.3, 2.2)
        pose = {}
        pose['pelvis'] = ang(pitch=88 * fall, roll=6 * fall)
        pose['pelvis_loc'] = (0.04 * fall, -0.42 * math.sin(fall * math.pi / 2), -0.42 * kn - 0.4 * fall)
        for s, sd in ((1, 'l'), (-1, 'r')):
            pose[f'thigh_{sd}'] = ang(pitch=-8 * kn * (1 - fall), roll=4, s=s)
            pose[f'calf_{sd}'] = ang(pitch=100 * kn * (1 - fall) + 8 * fall)
            pose[f'foot_{sd}'] = ang(pitch=-30 * kn * (1 - fall) + 30 * fall)
            arms_down(pose, s, out=8 + 40 * fall, fwd=20 * kn + 60 * fall, elbow=25 + 30 * fall * (1 if s > 0 else 0.3), twist=10)
        pose['spine_01'] = ang(pitch=12 * kn); pose['spine_02'] = ang(pitch=10 * kn * (1 - fall)); pose['spine_03'] = ang(pitch=8 * kn * (1 - fall))
        pose['neck_01'] = ang(pitch=20 * kn * (1 - fall) - 30 * fall, yaw=30 * fall); pose['head'] = ang(pitch=10 * kn - 20 * fall, yaw=40 * fall, roll=-20 * st)
        claws(pose, 0.4)
        return pose

    def t_crawl(t, Lc=1.4):
        """on all fours, the limbs bent the wrong way: the arms as forelegs, the head up"""
        p = (t / Lc) % 1
        pose = {}
        pose['pelvis'] = ang(pitch=72, roll=4 * math.sin(2 * math.pi * p)); pose['pelvis_loc'] = (0.02 * math.sin(2 * math.pi * p), 0.1, -0.5 + 0.02 * math.sin(4 * math.pi * p))
        for s, sd, ph in ((1, 'l', 0.0), (-1, 'r', 0.5)):
            q = (p + ph) % 1
            pose[f'thigh_{sd}'] = ang(pitch=-80 - 22 * math.cos(2 * math.pi * q), yaw=-10, s=s)
            pose[f'calf_{sd}'] = ang(pitch=110 + 18 * bump(q, 0.7, 0.15))
            pose[f'foot_{sd}'] = ang(pitch=40)
            a = (q + 0.25) % 1
            arms_down(pose, s, out=24, fwd=50 - 26 * math.cos(2 * math.pi * a), elbow=8 + 28 * bump(a, 0.75, 0.12), twist=30)
            pose[f'hand_{sd}'] = ang(pitch=-60, s=s)
        pose['spine_01'] = ang(pitch=6); pose['spine_02'] = ang(pitch=4, yaw=6 * math.cos(2 * math.pi * p)); pose['spine_03'] = ang(pitch=-4)
        pose['neck_01'] = ang(pitch=-40); pose['head'] = ang(pitch=-34, roll=12 + 8 * math.sin(2 * math.pi * p))
        claws(pose, 0.45)
        return pose

    def sit_base(pose, slump=1.0):
        pose['pelvis_loc'] = (0, 0.08, -0.47)
        for s, sd in ((1, 'l'), (-1, 'r')):
            pose[f'thigh_{sd}'] = ang(pitch=-88, roll=3, s=s); pose[f'calf_{sd}'] = ang(pitch=86); pose[f'foot_{sd}'] = ang(pitch=0)
            arms_down(pose, s, out=12, fwd=48, elbow=62, twist=-6)
        pose['spine_01'] = ang(pitch=6 * slump); pose['spine_02'] = ang(pitch=10 * slump); pose['spine_03'] = ang(pitch=10 * slump)
        pose['neck_01'] = ang(pitch=14 * slump); pose['head'] = ang(pitch=18 * slump, roll=6 * slump)
        hands(pose, 0.55)

    def t_sit(t, Lc=4.0):
        """frozen at the table: bowed, still (a tremor now and then)"""
        pose = {}
        sit_base(pose)
        tr = math.sin(t * 2 * math.pi * 11 / Lc) * 0.6 * bump(t / Lc, 0.6, 0.05)
        pose['head'] = ang(pitch=18 + tr, roll=6)
        return pose

    def t_turnhead(t):
        """still at the table, the head turns round much too far, slowly, to look at you"""
        pose = {}
        sit_base(pose)
        u = ease(t, 0.3, 2.2)
        tw = math.sin(t * 50) * 0.8 * (ease(t, 0.3, 0.5) - ease(t, 2.1, 2.3))
        pose['spine_03'] = ang(pitch=10 - 8 * u, yaw=18 * u)
        pose['neck_01'] = ang(pitch=14 - 18 * u, yaw=45 * u + tw)
        pose['head'] = ang(pitch=18 - 22 * u, yaw=75 * u + tw, roll=6 - 20 * u)
        return pose

    def t_wake(t):
        """up from the bench in jerks, into a crouch to run"""
        pose = {}
        sit_base(pose, 1 - ease(t, 0.2, 0.6))
        u1 = ease(t, 0.25, 0.45); u2 = ease(t, 0.8, 1.0); u3 = ease(t, 1.3, 1.7)
        up = 0.4 * u1 + 0.35 * u2 + 0.25 * u3
        pose['pelvis_loc'] = (0, 0.08 * (1 - up), -0.47 * (1 - up) - 0.08 * u3)
        for s, sd in ((1, 'l'), (-1, 'r')):
            pose[f'thigh_{sd}'] = ang(pitch=-88 * (1 - up) - 25 * u3, roll=3, s=s); pose[f'calf_{sd}'] = ang(pitch=86 * (1 - up) + 40 * u3)
            arms_down(pose, s, out=12 + 18 * u2, fwd=48 * (1 - up) + 20 * u3, elbow=62 * (1 - up) + 30, twist=-6)
        pose['spine_01'] = ang(pitch=6 + 14 * u3); pose['spine_02'] = ang(pitch=10 - 6 * u1 + 10 * u3)
        pose['neck_01'] = ang(pitch=14 - 30 * u1); pose['head'] = ang(pitch=18 - 36 * u1 + 8 * math.sin(t * 40) * (u1 - u3), roll=20 * u2 - 10 * u3)
        claws(pose, 0.55 + 0.3 * u3)
        return pose

    def t_feed(t, Lc=3.0):
        """kneeling over what it caught, the head dipping, the hands tearing"""
        pose = {}
        pose['pelvis'] = ang(pitch=20); pose['pelvis_loc'] = (0, -0.08, -0.5)
        for s, sd in ((1, 'l'), (-1, 'r')):
            pose[f'thigh_{sd}'] = ang(pitch=-50 if s > 0 else -20, roll=8, s=s); pose[f'calf_{sd}'] = ang(pitch=120 if s > 0 else 100); pose[f'foot_{sd}'] = ang(pitch=30)
            tr = osc(t, Lc, 3, s * 1.3)
            arms_down(pose, s, out=18, fwd=60 + 12 * tr, elbow=50 + 25 * tr, twist=-10)
        dip = max(0.0, osc(t, Lc, 2))
        pose['spine_01'] = ang(pitch=18); pose['spine_02'] = ang(pitch=16 + 8 * dip); pose['spine_03'] = ang(pitch=10 + 6 * dip)
        pose['neck_01'] = ang(pitch=10 + 14 * dip); pose['head'] = ang(pitch=10 + 20 * dip, roll=12 * osc(t, Lc, 5), yaw=10 * osc(t, Lc, 3, 0.5))
        claws(pose, 0.8)
        return pose

    def t_float(t, Lc=8.0):
        """the Shades: arms hanging, the head tilted, a slow drift with no weight in it"""
        pose = {}
        pose['pelvis_loc'] = (0.02 * osc(t, Lc, 1), 0, 0.03 * osc(t, Lc, 2))
        for s, sd in ((1, 'l'), (-1, 'r')):
            pose[f'thigh_{sd}'] = ang(pitch=4 + 2 * osc(t, Lc, 1, s), s=s); pose[f'calf_{sd}'] = ang(pitch=12); pose[f'foot_{sd}'] = ang(pitch=35)
            arms_down(pose, s, out=4, fwd=4 + 3 * osc(t, Lc, 1, s * 2), elbow=6, twist=4)
        pose['spine_02'] = ang(pitch=4); pose['neck_01'] = ang(pitch=6, roll=10); pose['head'] = ang(pitch=10, roll=22 + 4 * osc(t, Lc, 1))
        hands(pose, 0.15, 0.1)
        return pose

    def t_reach(t):
        """a Shade reaching for you, slowly"""
        u = ease(t, 0.0, 1.6) * (1 - ease(t, 2.6, 3.4))
        pose = t_float(t)
        for s, sd in ((1, 'l'), (-1, 'r')):
            arms_down(pose, s, out=6 + 6 * u, fwd=8 + 72 * u * (1 if s > 0 else 0.8), elbow=6 + 8 * u, twist=-10 * u)
        pose['head'] = ang(pitch=10 - 14 * u, roll=22 - 8 * u)
        return pose

    CLIPS = {
        't_idle': (t_idle, 6.0, True), 't_shamble': (t_shamble, 1.5, True), 't_run': (t_run, 0.6, True), 't_attack': (t_attack, 1.3, False),
        't_scream': (t_scream, 2.2, False), 't_hurt': (t_hurt, 0.5, False), 't_death': (t_death, 2.2, False), 't_crawl': (t_crawl, 1.4, True),
        't_sit': (t_sit, 4.0, True), 't_turnhead': (t_turnhead, 2.6, False), 't_wake': (t_wake, 1.8, False), 't_feed': (t_feed, 3.0, True),
        't_float': (t_float, 8.0, True), 't_reach': (t_reach, 3.4, False),
    }
    sc, arm = A['setup']()
    PB = arm.pose.bones
    REST = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}
    PELVIS_REST = arm.data.bones['pelvis'].head_local.copy()
    for pb in PB: pb.rotation_mode = 'QUATERNION'
    def finish(pose):
        return {k: (REST[k] @ v[1] @ REST[k].inverted() if isinstance(v, tuple) and len(v) == 2 and v[0] == 'local' else v) for k, v in pose.items()}
    def apply(pose):
        for pb in PB:
            q = pose.get(pb.name)
            pb.rotation_quaternion = (REST[pb.name].inverted() @ q @ REST[pb.name]) if q is not None else Quaternion()
            pb.location = (0, 0, 0)
        d = pose.get('pelvis_loc')
        if d is not None: PB['pelvis'].location = REST['pelvis'].inverted() @ Vector(d)
    out = {}
    if preview:
        frames = []
        for name, (fn, Lc, loop) in CLIPS.items():
            if preview is not True and name not in preview: continue
            for i, tt in enumerate((0.25, 0.7)):
                apply(finish(fn(tt * Lc)))
                bpy.context.view_layer.update()
                frames += C.preview(sc, f'turned_{name}_{i}', [('f', (2.4, -3.2, 1.2), (0, 0, 0.8), 45)], res=(240, 320), world_rgb=(0.5, 0.52, 0.55))
        out['previews'] = frames
    arm.animation_data_create()
    for name, (fn, Lc, loop) in CLIPS.items():
        act = bpy.data.actions.new('Turned_' + name)
        arm.animation_data.action = act
        n = round(Lc * FPS)
        fr = list(range(0, n + 1, STEP))
        if fr[-1] != n: fr.append(n)
        for f in fr:
            t = (f % n) / FPS if loop else f / FPS
            apply(finish(fn(t)))
            for pb in PB: pb.keyframe_insert('rotation_quaternion', frame=f)
            PB['pelvis'].keyframe_insert('location', frame=f)
        act.use_fake_user = True
        tr = arm.animation_data.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 0, act)
        arm.animation_data.action = None
    apply({})
    for o in list(sc.objects):
        if o.type in ('MESH', 'EMPTY'): bpy.data.objects.remove(o, do_unlink=True)
    arm['pelvisRest'] = [round(PELVIS_REST.x, 4), round(PELVIS_REST.z, 4), round(-PELVIS_REST.y, 4)]
    if export:
        d = os.path.join(C.raw_dir(), 'people'); os.makedirs(d, exist_ok=True)
        path = os.path.join(d, 'turned_anims.glb')
        if bpy.context.window: bpy.context.window.scene = sc
        for o in sc.objects: o.select_set(o == arm)
        with bpy.context.temp_override(scene=sc):
            bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, use_active_scene=True, export_extras=True, export_yup=True,
                                      export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
                                      export_optimize_animation_size=True, export_skins=False, export_def_bones=False)
        out['export'] = [path, os.path.getsize(path)]
    out['clips'] = list(CLIPS)
    return out

if __name__ == '__main__' or True:
    C.set_root(globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy'))
    if globals().get('STAGE') == 'anims':
        result = anims(preview=globals().get('PREVIEW', False), export=globals().get('EXPORT', True))
    else:
        L = _lib('make_people')
        CAST = cast(L)
        result = {}
        for nm in (globals().get('WANT') or list(CAST)):
            sc, arm, added, info = build_one(L, nm, CAST[nm])
            if globals().get('PREVIEW', False):
                info['previews'] = L['preview'](sc, arm, nm)
                info['previews'] += C.preview(sc, 'person_' + nm, [('back', (1.1, 2.9, 1.4), (0, 0, 1.05), 45)], res=(480, 640), world_rgb=(0.45, 0.47, 0.5))
            if globals().get('EXPORT', True):
                info['export'] = L['export'](sc, nm)
            result[nm] = info
