# The Polyarnik's materials: textured (tools/blender/texlib.py) for every large surface and
# every painted thing, flat for the small bright ones (lamps, screens, glass).
#
# Names are read by the game (src/boat/BoatModel.js): "In_" materials are the rooms' insides (kept
# out of the sea's reflection and the moon's shadow pass), "Lamp_", "Screen_" and "Glass" are
# emissive or transparent.
#
# Families: the tinted versions of a texture set (machinery paint in eight colours) and the plain
# small-part colours all become one material each at export (apply_families), the colour moving
# into the faces' vertex colours, so the game draws a handful of materials instead of ninety.
import importlib
import bpy
import common as C
import texlib as X
importlib.reload(C); importlib.reload(X)

FAM = {}        # material name -> (its family's material, linear rgb)
FAMNAME = {'machine': 'Machine', 'white': 'White', 'wood': 'Wood', 'vinyl': 'Vinyl'}

def materials(hull_fn=None):
    X.SETS.clear(); FAM.clear()
    t = {
        'wall': X.get('wall_panel', X.wall_panel),
        'wains': X.get('wainscot', X.wood, ring_m=0.004, col=(0.42, 0.25, 0.13), dark=(0.26, 0.14, 0.07), T=3.0, seed=6, varnish=0.38, joints=1.0),
        'wood': X.get('wood', X.wood),
        'ceil': X.get('ceiling', X.ceiling),
        'lino': X.get('lino', X.lino),
        'lino_g': X.get('lino_grey', X.lino, col=(0.16, 0.18, 0.18), seed=12),
        'rubf': X.get('rubber_floor', X.studded_rubber),
        'checker': X.get('checker', X.checker_plate),
        'grating': X.get('grating', X.grating),
        'erwall': X.get('er_wall', X.steel_paint, col=(0.62, 0.65, 0.61), seed=21),
        'machine': X.get('machine', X.machine_paint),
        'deck': X.get('deck', X.deck_paint),
        'white': X.get('white', X.white_paint),
        'vinyl': X.get('vinyl', X.vinyl),
        'oil': X.get('oilcloth', X.oilcloth),
        'steel': X.get('steel', X.brushed_steel),
        'rubber': X.get('rubber', X.rubber),
        'rope': X.get('rope', X.rope_braid),
    }
    fams = {}
    setname = {id(v): k for k, v in t.items()}
    def P(name, tex, tint=None, **kw):
        m = X.pbr(name, tex, tint=tint, **kw)
        if tint is not None:
            pre = name.split('_')[0]
            key = (pre, setname[id(tex)])
            if key not in fams:
                fams[key] = X.pbr(pre + '_' + FAMNAME.get(key[1], key[1].title()), tex)
            FAM[name] = (fams[key], tuple(tint))
        return m
    def F(name, rgb, rough, metal=0.0):
        m = C.mat(name, rgb, rough, metal)
        pre = 'In' if name.startswith('In_') else 'Ex'
        kind = 'Metal' if metal > 0.5 else ('Gloss' if rough < 0.45 else 'Matte')
        key = (pre, 'flat_' + kind)
        if key not in fams:
            fams[key] = C.mat(pre + '_Flat_' + kind, (1, 1, 1), {'Metal': 0.25, 'Gloss': 0.3, 'Matte': 0.85}[kind], 1.0 if kind == 'Metal' else 0.0)
        FAM[name] = (fams[key], tuple(rgb))
        return m
    M = {}
    # ---- outside
    M['white'] = P('Ex_White', t['white'])
    M['bulwark'] = P('Ex_Bulwark', t['white'], tint=(0.55, 0.57, 0.56))
    M['red'] = P('Ex_Red', t['machine'], tint=(0.42, 0.015, 0.012))
    M['deck'] = P('Ex_Deck', t['deck'])
    M['steel'] = P('Ex_Steel', t['steel'])
    M['dark'] = P('Ex_Dark', t['machine'], tint=(0.045, 0.05, 0.055))
    M['black'] = P('Ex_Black', t['machine'], tint=(0.018, 0.018, 0.02))
    M['rubber'] = P('Ex_Rubber', t['rubber'])
    M['engine'] = P('Ex_Green', t['machine'], tint=(0.04, 0.12, 0.075))
    M['yellow'] = P('Ex_Yellow', t['machine'], tint=(0.68, 0.42, 0.01))
    M['orange'] = P('Ex_Orange', t['machine'], tint=(0.85, 0.16, 0.01))
    M['grey'] = P('Ex_Grey', t['machine'], tint=(0.26, 0.27, 0.28))
    M['blue'] = P('Ex_Blue', t['machine'], tint=(0.012, 0.085, 0.36))
    M['rope'] = P('Ex_Rope', t['rope'])
    M['chrome'] = F('Ex_Chrome', (0.8, 0.8, 0.82), 0.18, 1.0)
    M['brass'] = F('Ex_Brass', (0.72, 0.5, 0.2), 0.32, 1.0)
    M['glass'] = C.mat('Glass', (0.02, 0.03, 0.035), 0.05, 0.0, alpha=0.3)
    M['flag_w'] = F('Ex_Flag_White', (0.88, 0.88, 0.86), 0.85)
    M['flag_b'] = F('Ex_Flag_Blue', (0.0, 0.12, 0.5), 0.85)
    M['flag_r'] = F('Ex_Flag_Red', (0.65, 0.02, 0.02), 0.85)
    # ---- inside
    M['wall'] = P('In_Wall', t['wall'])
    M['wains'] = P('In_Wainscot', t['wains'])
    M['ceiling'] = P('In_Ceiling', t['ceil'])
    M['floor'] = P('In_Lino', t['lino'])
    M['lino_g'] = P('In_Lino_Grey', t['lino_g'])
    M['rubf'] = P('In_Rubber_Floor', t['rubf'])
    M['wood'] = P('In_Wood', t['wood'])
    M['wood_dark'] = P('In_Wood_Dark', t['wood'], tint=(0.45, 0.32, 0.24))
    M['vinyl'] = P('In_Vinyl', t['vinyl'])
    M['vinyl_dk'] = P('In_Vinyl_Black', t['vinyl'], tint=(0.16, 0.16, 0.17))
    M['oilcloth'] = P('In_Oilcloth', t['oil'])
    M['in_steel'] = P('In_Steel', t['steel'])
    M['erwall'] = P('In_ER_Wall', t['erwall'])
    M['checker'] = P('In_Checker', t['checker'])
    M['grate'] = P('In_Grating', t['grating'])
    M['in_engine'] = P('In_Engine', t['machine'], tint=(0.05, 0.16, 0.1))
    M['in_grey'] = P('In_Machine_Grey', t['machine'], tint=(0.3, 0.31, 0.32))
    M['in_lgrey'] = P('In_Machine_Light', t['machine'], tint=(0.55, 0.57, 0.56))
    M['in_blue'] = P('In_Machine_Blue', t['machine'], tint=(0.02, 0.1, 0.32))
    M['in_red'] = P('In_Machine_Red', t['machine'], tint=(0.45, 0.02, 0.015))
    M['in_yellow'] = P('In_Machine_Yellow', t['machine'], tint=(0.68, 0.42, 0.01))
    M['in_dark'] = P('In_Machine_Dark', t['machine'], tint=(0.05, 0.055, 0.06))
    M['in_black'] = P('In_Black', t['machine'], tint=(0.02, 0.02, 0.022))
    M['in_enamel'] = P('In_Enamel_White', t['machine'], tint=(0.8, 0.8, 0.78))
    M['in_brown'] = P('In_Pipe_Brown', t['machine'], tint=(0.2, 0.08, 0.03))
    M['in_green'] = P('In_Pipe_Green', t['machine'], tint=(0.04, 0.22, 0.06))
    M['in_rubber'] = P('In_Rubber', t['rubber'])
    M['in_rope'] = P('In_Rope', t['rope'])
    M['lagging'] = C.mat('In_Lagging', (0.62, 0.62, 0.6), 0.62, 0.55)
    M['in_chrome'] = F('In_Chrome', (0.8, 0.8, 0.82), 0.16, 1.0)
    M['in_brass'] = F('In_Brass', (0.72, 0.5, 0.2), 0.3, 1.0)
    M['in_copper'] = F('In_Copper', (0.75, 0.38, 0.22), 0.35, 1.0)
    M['in_glass'] = C.mat('Glass_Inside', (0.03, 0.035, 0.04), 0.05, 0.0, alpha=0.25)
    M['dial'] = F('In_Dial', (0.85, 0.84, 0.78), 0.35)
    M['paper'] = F('In_Paper', (0.78, 0.76, 0.68), 0.9)
    M['paper2'] = F('In_Paper_Blue', (0.45, 0.55, 0.65), 0.9)
    M['chart'] = F('In_Chart_Paper', (0.75, 0.72, 0.6), 0.9)
    M['cork'] = F('In_Cork', (0.35, 0.24, 0.12), 0.9)
    M['curtain'] = F('In_Curtain', (0.45, 0.32, 0.18), 0.9)
    M['curtain_b'] = F('In_Curtain_Blue', (0.08, 0.13, 0.25), 0.9)
    M['cloth'] = F('In_Cloth_Coat', (0.06, 0.07, 0.06), 0.95)
    M['cloth2'] = F('In_Cloth_Orange', (0.75, 0.2, 0.03), 0.8)
    M['fur'] = F('In_Fur', (0.18, 0.13, 0.09), 1.0)
    M['ceramic'] = F('In_Ceramic', (0.85, 0.85, 0.82), 0.15)
    M['tea'] = C.mat('In_Tea_Glass', (0.35, 0.12, 0.03), 0.05, 0.0, alpha=0.6)
    M['bread'] = F('In_Bread', (0.55, 0.32, 0.14), 0.85)
    M['picture'] = F('In_Picture', (0.25, 0.32, 0.38), 0.6)
    M['picture2'] = F('In_Picture_Warm', (0.5, 0.36, 0.22), 0.6)
    M['sign_green'] = F('In_Sign_Green', (0.0, 0.32, 0.12), 0.5)
    M['sign_red'] = F('In_Sign_Red', (0.55, 0.02, 0.015), 0.5)
    M['sign_white'] = F('In_Sign_White', (0.85, 0.85, 0.82), 0.5)
    M['sign_yellow'] = F('In_Sign_Yellow', (0.8, 0.55, 0.0), 0.5)
    M['sign_blue'] = F('In_Sign_Blue', (0.0, 0.12, 0.45), 0.5)
    M['ex_sign_white'] = F('Ex_Sign_White', (0.85, 0.85, 0.82), 0.5)
    M['ex_sign_red'] = F('Ex_Sign_Red', (0.55, 0.02, 0.015), 0.5)
    # ---- lights, screens
    M['lamp'] = C.mat('Lamp_Warm', (1, 0.8, 0.55), 0.4, emit=(1.0, 0.72, 0.42), emit_strength=6.0)
    M['diffuser'] = C.mat('Lamp_Warm_Diffuser', (0.95, 0.92, 0.85), 0.4, emit=(1.0, 0.78, 0.52), emit_strength=4.0)
    M['lampcold'] = C.mat('Lamp_Cold', (0.9, 0.95, 1), 0.4, emit=(0.85, 0.92, 1.0), emit_strength=8.0)
    M['lampengine'] = C.mat('Lamp_Engine', (0.9, 0.95, 1), 0.4, emit=(0.85, 0.92, 1.0), emit_strength=8.0)
    M['lampred'] = C.mat('Lamp_Night_Red', (0.6, 0.05, 0.03), 0.4, emit=(1.0, 0.08, 0.03), emit_strength=2.0)
    M['navred'] = C.mat('Lamp_NavRed', (1, 0.1, 0.05), 0.3, emit=(1.0, 0.05, 0.02), emit_strength=14.0)
    M['navgreen'] = C.mat('Lamp_NavGreen', (0.1, 1, 0.3), 0.3, emit=(0.05, 1.0, 0.25), emit_strength=14.0)
    M['navwhite'] = C.mat('Lamp_NavWhite', (1, 1, 1), 0.3, emit=(1.0, 0.95, 0.85), emit_strength=14.0)
    M['led_g'] = C.mat('Lamp_LED_Green', (0.1, 0.8, 0.2), 0.3, emit=(0.1, 1.0, 0.25), emit_strength=3.0)
    M['led_r'] = C.mat('Lamp_LED_Red', (0.8, 0.1, 0.05), 0.3, emit=(1.0, 0.1, 0.04), emit_strength=3.0)
    M['led_a'] = C.mat('Lamp_LED_Amber', (0.8, 0.5, 0.05), 0.3, emit=(1.0, 0.55, 0.05), emit_strength=3.0)
    M['screen'] = C.mat('Screen_Radar', (0.0, 0.05, 0.02), 0.2, emit=(0.05, 0.6, 0.2), emit_strength=1.5)
    M['screen2'] = C.mat('Screen_Chart', (0.02, 0.04, 0.08), 0.2, emit=(0.1, 0.25, 0.5), emit_strength=0.8)
    M['screen3'] = C.mat('Screen_Amber', (0.04, 0.02, 0.0), 0.2, emit=(0.9, 0.5, 0.1), emit_strength=0.6)
    M['tv'] = F('In_Screen_TV', (0.01, 0.012, 0.015), 0.1)
    M['enamel'] = F('In_Enamel_Red', (0.5, 0.03, 0.02), 0.25)
    M['col'] = C.mat('Collision', (1, 0, 1), 1.0)
    return M, t

def apply_families(objs):
    """fold every family member into its family's material: the faces keep their colour in a
    vertex colour (white elsewhere), and unused material slots go"""
    for o in objs:
        if o.type != 'MESH': continue
        me = o.data
        if 'Col' not in me.color_attributes:
            me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        ca = me.color_attributes['Col']
        me.color_attributes.active_color = ca
        mats = list(me.materials)
        remap = {}
        for i, m in enumerate(mats):
            if m is not None and m.name in FAM:
                fam, rgb = FAM[m.name]
                if fam.name not in [x.name for x in me.materials if x]:
                    me.materials.append(fam)
                j = [x.name if x else None for x in me.materials].index(fam.name)
                remap[i] = (j, rgb)
        cols = [1.0] * (len(me.loops) * 4)
        for p in me.polygons:
            if p.material_index in remap:
                j, rgb = remap[p.material_index]
                p.material_index = j
                for li in p.loop_indices:
                    cols[li * 4:li * 4 + 3] = rgb
        ca.data.foreach_set('color', cols)
        # drop the slots nothing uses any more
        used = {p.material_index for p in me.polygons}
        keep = [i for i in range(len(me.materials)) if i in used]
        if len(keep) < len(me.materials):
            newi = {old: k for k, old in enumerate(keep)}
            idx = [newi[p.material_index] for p in me.polygons]
            kept = [me.materials[i] for i in keep]
            me.materials.clear()
            for m in kept: me.materials.append(m)
            me.polygons.foreach_set('material_index', idx)
