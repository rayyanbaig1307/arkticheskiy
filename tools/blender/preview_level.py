# Renders a level from inside: point lights put at its LMP_ lamps for the render (and taken away
# again), cameras at the listed spots.
#   runpy: SCRIPT='preview_level', ARGS={'SCENE': 'ASSET_bunker', 'NAME': 'bunker', 'CAMS': [(tag, loc, target, lens)], 'GROUPS': ['main', 'emerg']}
import bpy, math, os
from mathutils import Vector
import common as C

def run(scene, name, cams, groups=('main', 'emerg', 'cave'), res=(960, 540), ambient=0.015, scale=12.0):
    sc = bpy.data.scenes[scene]
    if bpy.context.window: bpy.context.window.scene = sc
    made = []
    for o in list(sc.objects):
        if o.type == 'EMPTY' and o.name.startswith('LMP_') and o.get('group', 'main') in groups:
            ld = bpy.data.lights.new('_pl', 'POINT')
            ld.energy = float(o.get('power', 20)) * scale
            ld.color = tuple(o.get('color', (1, 0.9, 0.8)))[:3]
            ld.shadow_soft_size = 0.15
            try: ld.use_custom_distance = True; ld.cutoff_distance = float(o.get('range', 10)) * 1.6
            except Exception: pass
            lo = bpy.data.objects.new('_pl', ld); sc.collection.objects.link(lo); lo.location = o.matrix_world.translation
            made.append(lo)
    hidden = []
    for o in sc.objects:
        if o.name.startswith('COL_') and not o.hide_render: o.hide_render = True; hidden.append(o)
    out = C.preview(sc, name, cams, res=res, world_rgb=(ambient, ambient, ambient * 1.1), sun=False, samples=24)
    for lo in made:
        ld = lo.data; bpy.data.objects.remove(lo, do_unlink=True); bpy.data.lights.remove(ld)
    for o in hidden: o.hide_render = False
    return out

C.set_root(globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy'))
result = run(globals()['SCENE'], globals()['NAME'], globals()['CAMS'], tuple(globals().get('GROUPS', ('main', 'emerg', 'cave'))), tuple(globals().get('RES', (960, 540))), globals().get('AMBIENT', 0.015), globals().get('SCALE', 12.0))
