# Shared helpers for the asset scripts (run inside the live Blender through the connector's
# bl_execute, or headless: blender -b -P <script> -- <root>).
#
# Every asset is built in its own scene (ASSET_<name>), so the user's own scene is never touched.
# Geometry is made with bmesh through the data API (no operators where avoidable). Units are
# metres, Blender's axes: x starboard / right, y forward, z up. glTF export turns that into
# three.js's x right, y up, -z forward.
import bpy, bmesh, math, os
from mathutils import Vector, Matrix, Euler
import numpy as np

ROOT = None   # set by the runner: the project folder

def set_root(path):
    global ROOT
    ROOT = path

def models_dir():
    d = os.path.join(ROOT, 'public', 'models'); os.makedirs(d, exist_ok=True); return d

def raw_dir():
    d = os.path.join(ROOT, 'tools', 'blender', 'raw'); os.makedirs(d, exist_ok=True); return d

def preview_dir():
    d = os.path.join(ROOT, 'tools', 'blender', 'previews'); os.makedirs(d, exist_ok=True); return d

# ---------------------------------------------------------------- scenes
def fresh_scene(name):
    """an empty scene of its own (an old one of the same name is removed with its objects)"""
    old = bpy.data.scenes.get(name)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(name)
    sc.unit_settings.system = 'METRIC'
    sc.render.fps = 30
    if bpy.context.window:
        bpy.context.window.scene = sc
    purge()
    return sc

def purge():
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.armatures, bpy.data.actions, bpy.data.cameras, bpy.data.lights):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)

def collection(sc, name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or sc.collection).children.link(c)
    return c

# ---------------------------------------------------------------- materials
MATS = {}
def mat(name, rgb, rough=0.5, metal=0.0, emit=None, emit_strength=1.0, alpha=1.0):
    """one named Principled material per role (re-used, never .001 copies)"""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit is not None:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    m.diffuse_color = (*rgb, alpha)
    MATS[name] = m
    return m

def image_tex(name, px, colorspace='sRGB'):
    """a Blender image from a numpy (H, W, 3|4) float array in 0..1 (row 0 = bottom)"""
    H, W = px.shape[:2]
    img = bpy.data.images.get(name)
    if img and (img.size[0] != W or img.size[1] != H):
        bpy.data.images.remove(img); img = None
    if img is None:
        img = bpy.data.images.new(name, W, H, alpha=px.shape[2] == 4)
    # (the colour space first: changing it afterwards regenerates a generated image's buffer, black)
    if img.colorspace_settings.name != colorspace:
        img.colorspace_settings.name = colorspace
    if px.shape[2] == 3:
        px = np.concatenate([px, np.ones((H, W, 1), np.float32)], -1)
    img.pixels.foreach_set(px.astype(np.float32).ravel())
    img.update()
    img.pack()
    return img

def mat_textured(name, base=None, normal=None, rough_img=None, rgb=(1, 1, 1), rough=0.5, metal=0.0, normal_strength=1.0):
    m = mat(name, rgb, rough, metal)
    nt = m.node_tree; p = nt.nodes['Principled BSDF']
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE' or n.type == 'NORMAL_MAP': nt.nodes.remove(n)
    if base is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = base
        nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    if rough_img is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = rough_img
        nt.links.new(t.outputs['Color'], p.inputs['Roughness'])
    if normal is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = normal
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    return m

# ---------------------------------------------------------------- geometry
def box_uv(me, k=1 / 3):
    """UVs by box projection (each face onto the plane its normal faces most), 1 unit = 1/k m"""
    uv = me.uv_layers.new(name='UVMap') if not me.uv_layers else me.uv_layers[0]
    for p in me.polygons:
        n = p.normal; ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if az >= ax and az >= ay: u, v = co.x, co.y
            elif ax >= ay: u, v = co.y, co.z
            else: u, v = co.x, co.z
            uv.data[li].uv = (u * k, v * k)

def obj_from_bm(bm, name, material=None, coll=None, smooth=False):
    me = bpy.data.meshes.new(name)
    had_uv = len(bm.loops.layers.uv) > 0
    bm.to_mesh(me); bm.free()
    if not had_uv: box_uv(me)       # (every part gets UVs: a textured material on a mesh without them breaks in three.js)
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    if material is not None:
        me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    return o

def empty(name, loc, coll=None, rot=(0, 0, 0), size=0.25, kind='PLAIN_AXES', extras=None):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = kind; o.empty_display_size = size
    o.location = loc; o.rotation_euler = rot
    (coll or bpy.context.scene.collection).objects.link(o)
    for k, v in (extras or {}).items():
        o[k] = v
    return o

def bm_box(bm, cx, cy, cz, sx, sy, sz, mat_index=0, rot_z=0.0):
    """an axis-aligned box (centre, size) into bm; returns its faces"""
    r = bmesh.ops.create_cube(bm, size=1.0)
    vs = r['verts']
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=vs)
    if rot_z:
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_z, 3, 'Z'))
    bmesh.ops.translate(bm, vec=(cx, cy, cz), verts=vs)
    faces = list({f for v in vs for f in v.link_faces})
    for f in faces: f.material_index = mat_index
    return faces

def bm_box_minmax(bm, x0, y0, z0, x1, y1, z1, mat_index=0):
    return bm_box(bm, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, abs(x1 - x0), abs(y1 - y0), abs(z1 - z0), mat_index)

def bm_cyl(bm, cx, cy, cz, r, depth, axis='Z', segs=16, mat_index=0, r2=None, cap=True):
    res = bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    vs = res['verts']
    if axis == 'X':
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    elif axis == 'Y':
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, vec=(cx, cy, cz), verts=vs)
    faces = list({f for v in vs for f in v.link_faces})
    for f in faces: f.material_index = mat_index
    return faces

def bm_tube(bm, pts, r, segs=10, mat_index=0, closed=False):
    """a tube along a polyline of Vectors (rails, pipes, ropes)"""
    rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        a = t.cross(up).normalized(); b = t.cross(a).normalized()
        ring = []
        for k in range(segs):
            ang = 2 * math.pi * k / segs
            ring.append(bm.verts.new(p + (a * math.cos(ang) + b * math.sin(ang)) * r))
        rings.append(ring)
    faces = []
    for i in range(n - 1):
        for k in range(segs):
            k1 = (k + 1) % segs
            f = bm.faces.new((rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]))
            f.material_index = mat_index; faces.append(f)
    if not closed:
        for ring in (rings[0], rings[-1]):
            try:
                f = bm.faces.new(ring if ring is rings[-1] else list(reversed(ring)))
                f.material_index = mat_index; faces.append(f)
            except ValueError:
                pass
    return faces

def bm_prism(bm, poly2d, z0, z1, mat_index=0):
    """an extruded polygon (x, y list, counter-clockwise) from z0 to z1"""
    bot = [bm.verts.new((x, y, z0)) for x, y in poly2d]
    top = [bm.verts.new((x, y, z1)) for x, y in poly2d]
    faces = [bm.faces.new(list(reversed(bot))), bm.faces.new(top)]
    n = len(poly2d)
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((bot[i], bot[j], top[j], top[i])))
    for f in faces: f.material_index = mat_index
    return faces

def join(objs, name):
    """join objects into the first (data API: bmesh merge keeps material slots)"""
    objs = [o for o in objs if o is not None]
    if not objs: return None
    target = objs[0]
    bm = bmesh.new(); bm.from_mesh(target.data)
    mats = list(target.data.materials)
    for o in objs[1:]:
        offset = len(mats)
        remap = []
        for m in o.data.materials:
            if m in mats: remap.append(mats.index(m))
            else: mats.append(m); remap.append(len(mats) - 1)
        me = o.data.copy()
        me.transform(target.matrix_world.inverted() @ o.matrix_world)
        b2 = bmesh.new(); b2.from_mesh(me)
        for f in b2.faces:
            f.material_index = remap[f.material_index] if remap else 0
        tmp = bpy.data.meshes.new('_tmp'); b2.to_mesh(tmp); b2.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp); bpy.data.meshes.remove(me)
        bpy.data.objects.remove(o, do_unlink=True)
        void = offset
    target.data.materials.clear()
    for m in mats: target.data.materials.append(m)
    bm.to_mesh(target.data); bm.free()
    target.name = name
    return target

def apply_modifiers(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = o.data
    o.modifiers.clear()
    o.data = me
    if old.users == 0: bpy.data.meshes.remove(old)

def apply_one(o, name):
    """apply a single modifier, leaving the others (an Armature above all) on the object"""
    keep = [(m, m.show_viewport) for m in o.modifiers if m.name != name]
    for m, _ in keep: m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = o.data
    o.modifiers.remove(o.modifiers[name])
    for m, v in keep: m.show_viewport = v
    o.data = me
    if old.users == 0: bpy.data.meshes.remove(old)

def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == 'MESH' else 0

# ---------------------------------------------------------------- export
def export_glb(sc, path, objects=None, animations=False, skins=False, morph=False, nla=False, vcolors=False):
    """the scene (or the listed objects) to a GLB, y-up, extras kept, no compression (tools/pack.mjs
    meshopt-compresses it afterwards with gltfpack)"""
    if bpy.context.window:
        bpy.context.window.scene = sc
    for o in sc.objects:
        o.select_set(objects is None or o in objects)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True,
              export_extras=True, export_yup=True, export_cameras=False, export_lights=False,
              export_animations=animations, export_skins=skins, export_morph=morph,
              export_image_format='WEBP', export_image_quality=85, export_materials='EXPORT')
    if vcolors:
        kw.update(export_vertex_color='ACTIVE')
    if animations:
        kw.update(export_animation_mode='NLA_TRACKS' if nla else 'ACTIONS', export_force_sampling=True, export_optimize_animation_size=True)
    with bpy.context.temp_override(scene=sc):
        bpy.ops.export_scene.gltf(**kw)
    return os.path.getsize(path)

# ---------------------------------------------------------------- previews
def preview(sc, name, cams, res=(960, 540), engine='BLENDER_EEVEE', world_rgb=(0.35, 0.4, 0.48), sun=True, samples=16):
    """renders from a list of (tag, location, target, lens) to previews/<name>_<tag>.png"""
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    try: sc.eevee.taa_render_samples = samples
    except Exception: pass
    if not sc.world:
        sc.world = bpy.data.worlds.new(name + '_world')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*world_rgb, 1); bg.inputs['Strength'].default_value = 1.0
    made = []
    cam = bpy.data.objects.new('_pcam', bpy.data.cameras.new('_pcam')); sc.collection.objects.link(cam); sc.camera = cam
    lamp = None
    if sun:
        ld = bpy.data.lights.new('_psun', 'SUN'); ld.energy = 3.0; ld.angle = 0.2
        lamp = bpy.data.objects.new('_psun', ld); sc.collection.objects.link(lamp)
        lamp.rotation_euler = Euler((math.radians(50), 0, math.radians(35)))
    out = []
    for tag, loc, tgt, lens in cams:
        cam.data.lens = lens; cam.data.clip_end = 2000
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(preview_dir(), f'{name}_{tag}.png')
        sc.render.filepath = path
        with bpy.context.temp_override(scene=sc):
            bpy.ops.render.render(write_still=True, scene=sc.name)
        out.append(path)
    bpy.data.objects.remove(cam, do_unlink=True)
    if lamp: bpy.data.objects.remove(lamp, do_unlink=True)
    return out
