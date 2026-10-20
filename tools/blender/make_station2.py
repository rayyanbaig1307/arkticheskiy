# Station Severny, for the horror (СТАНЦИЯ «СЕВЕРНЫЙ»): the station you go into. Exported to
# tools/blender/raw/station.glb (it replaces make_station.py's, which built only the outside).
#
# Kept from make_station.py: the fast ice and its edge, the berth (anchors, crates, the carrier,
# the sign), the gangway, the radio mast, the fuel tanks and drums, the weather mast, the flag,
# the lamp posts along the path. New:
#
#   the island    behind the station: a rocky shore and the ice cap rising to 45 m, a cut in its
#                 south flank where Object 7's old portal stands (its tunnel comes out here), a
#                 road down from it; a line of flags on poles up the cap to the drilling shed
#   buildings     every one with its rooms inside (the level contract, CONTRACTS.md, as in
#                 Object 7: R_ rooms, ZONE_, LMP_, DOOR_, HIDE_, ITEM_, DOC_, USE_, SPAWN_, TRIG_):
#                 the main house (the hall with the duty desk, the vestibule nailed shut from inside,
#                 the corridor, Gromov's room, the bunk room, the radio room barricaded, the
#                 workshop), the mess hut (the three at their table), the lab (its keypad, the cold
#                 room with the cores), the generator hut, the fuel depot's shed in its fence, the
#                 kennel, the banya, the drilling shed on the cap over Shaft 3
#   the rest      a crashed An-2 on the ice, the kennel's cages, the mast's ladder (climbable) and
#                 the feeder's junction box at its top, blood and drifts
#
# Frame: make_station.py's (x along the ice edge, y inland, z up, the sea at z 0).
import bpy, bmesh, math, os, random, importlib
import numpy as np
from mathutils import Vector, Matrix
import common as C
importlib.reload(C)
import texlib as X
importlib.reload(X)
import texsets as TS
importlib.reload(TS)
import kit as K
importlib.reload(K)
import sdf as S
importlib.reload(S)

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.path.join(globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy'), 'tools', 'blender')

def _lib(name, cut="if __name__ == '__main__' or True:"):
    src = open(os.path.join(HERE, name + '.py'), encoding='utf-8').read().split(cut)[0]
    ns = {'__name__': name + '_lib', '__file__': os.path.join(HERE, name + '.py')}
    root = C.ROOT
    exec(compile(src, name + '.py', 'exec'), ns)
    C.set_root(root)
    return ns

ST = None       # make_station's definitions (the shelf, top_z...)
B = None        # make_bunker's kit (the rooms, the doors, the frost, the furniture)

# ---------------------------------------------------------------- the plan: rooms (x0, y0, x1, y1, floor z, height, walls, floor, ceiling, ambience)
FZ = 1.5        # the station's floors (on their plinths, over the snow)
ROOMS = {
    # the main house: a corridor along it, rooms either side; the front (−y) faces the sea
    'mh_hall':   (-8, 82.25, -1.6, 85.3, FZ, 2.7, 'wallpaper', 'boards', 'ceil', 'interior'),
    'mh_vest':   (-1.6, 82.25, 1.6, 85.3, FZ, 2.7, 'panel', 'boards', 'ceil', 'interior'),
    'mh_work':   (1.6, 82.25, 8, 85.3, FZ, 2.7, 'panel', 'boards', 'ceil', 'interior'),
    'mh_cor':    (-8, 85.3, 8, 86.7, FZ, 2.7, 'wallpaper', 'lino', 'ceil', 'interior'),
    'mh_gromov': (-8, 86.7, -3.5, 89.75, FZ, 2.7, 'wallpaper', 'boards', 'ceil', 'interior'),
    'mh_bunks':  (-3.5, 86.7, 1.0, 89.75, FZ, 2.7, 'wallpaper', 'boards', 'ceil', 'interior'),
    'mh_radio':  (1.0, 86.7, 8, 89.75, FZ, 2.7, 'panel', 'lino', 'ceil', 'interior'),
    'mess':      (-26, 71.75, -18, 76.25, FZ, 2.5, 'panel', 'lino', 'ceil', 'interior'),
    'lab':       (16.5, 73.5, 22, 78.5, FZ, 2.6, 'panel', 'lino', 'ceil', 'interior'),
    'lab_cold':  (22, 73.5, 25.5, 78.5, FZ, 2.6, 'panel', 'lino', 'ceil', 'interior'),
    'gen':       (-9, 102, -3, 106, FZ, 2.8, 'plank', 'boards', 'plank', 'interior'),
    'depot':     (-41, 99, -36, 103, FZ, 2.6, 'plank', 'boards', 'plank', 'interior'),
    'kennel':    (-47.5, 80.25, -42.5, 83.75, FZ, 2.4, 'plank', 'boards', 'plank', 'interior'),
    'banya_ch':  (39.5, 76, 41.8, 80, FZ, 2.3, 'logs', 'boards', 'plank', 'interior'),
    'banya_st':  (41.8, 76, 44.5, 80, FZ, 2.3, 'logs', 'boards', 'plank', 'interior'),
}
DRILL_Z = None  # (the cap's height at the drilling shed: set at build)
# doors: (x, y, z, width, height, name, kind, open degrees, lock, label)
DOORS = [
    (0, 82.25, FZ, 1.0, 2.0, 'mh_front', 'wood', 100, 'story', ''),      # (nailed shut from inside)
    (0, 85.3, FZ, 0.9, 2.0, 'mh_inner', 'wood', 100, '', ''),
    (-8, 86.0, FZ, 0.9, 2.0, 'mh_back', 'wood', 100, '', ''),           # (the way in: the back door, its glass broken)
    (-4.6, 85.3, FZ, 0.9, 2.0, 'mh_hall', 'wood', 100, '', ''),
    (4.8, 85.3, FZ, 0.9, 2.0, 'mh_work', 'wood', 100, '', ''),
    (-5.75, 86.7, FZ, 0.9, 2.0, 'mh_gromov', 'wood', 100, '', ''),
    (-1.25, 86.7, FZ, 0.9, 2.0, 'mh_bunks', 'wood', 100, '', ''),
    (4.5, 86.7, FZ, 0.9, 2.0, 'mh_radio', 'wood', 100, 'key_radio', ''),
    (-18, 74.0, FZ, 0.9, 2.0, 'mess', 'wood', 100, '', ''),
    (16.5, 76.0, FZ, 0.9, 2.0, 'lab', 'steel', 100, 'code:0612', ''),
    (22, 76.0, FZ, 0.9, 2.0, 'lab_cold', 'steel', 100, 'keycard_gromov', ''),
    (-6, 102, FZ, 1.0, 2.1, 'gen', 'wood', 100, 'key_generator', ''),
    (-36, 101, FZ, 1.0, 2.0, 'depot', 'wood', 100, '', ''),
    (-42.5, 82, FZ, 0.9, 1.9, 'kennel', 'wood', 100, 'key_kennel', ''),
    (39.5, 78, FZ, 0.8, 1.85, 'banya', 'wood', 100, '', ''),
    (41.8, 78, FZ, 0.75, 1.8, 'banya_steam', 'wood', 100, '', ''),
]
# windows: (x, y, sill z, width, top z)
WINDOWS = [
    (-6.4, 82.25, FZ + 0.9, 1.0, FZ + 2.0), (-3.2, 82.25, FZ + 0.9, 1.0, FZ + 2.0), (3.4, 82.25, FZ + 0.9, 1.0, FZ + 2.0), (6.4, 82.25, FZ + 0.9, 1.0, FZ + 2.0),
    (-5.75, 89.75, FZ + 0.9, 1.0, FZ + 2.0), (-1.25, 89.75, FZ + 0.9, 1.0, FZ + 2.0), (4.5, 89.75, FZ + 0.9, 1.0, FZ + 2.0),
    (-22, 71.75, FZ + 0.9, 0.9, FZ + 1.8), (-22, 76.25, FZ + 0.9, 0.9, FZ + 1.8),
    (19.25, 73.5, FZ + 0.9, 1.0, FZ + 1.9), (19.25, 78.5, FZ + 0.9, 1.0, FZ + 1.9),
    (-6, 106, FZ + 1.2, 0.8, FZ + 1.9),
]
# the buildings round the rooms: (name, x0, y0, x1, y1, height to the eaves, siding, roof kind, rooms)
BUILDINGS = [
    ('mainhouse', -8, 82.25, 8, 89.75, 2.7, 'red', 'gable', ['mh_hall', 'mh_vest', 'mh_work', 'mh_cor', 'mh_gromov', 'mh_bunks', 'mh_radio']),
    ('mess', -26, 71.75, -18, 76.25, 2.5, 'blue', 'flat', ['mess']),
    ('lab', 16.5, 73.5, 25.5, 78.5, 2.6, 'yellow', 'flat', ['lab', 'lab_cold']),
    ('gen', -9, 102, -3, 106, 2.8, 'orange', 'gable', ['gen']),
    ('depot', -41, 99, -36, 103, 2.6, 'plankx', 'gable', ['depot']),
    ('kennel', -47.5, 80.25, -42.5, 83.75, 2.4, 'plankx', 'gable', ['kennel']),
    ('banya', 39.5, 76, 44.5, 80, 2.3, 'logsx', 'gable', ['banya_ch', 'banya_st']),
]

# ---------------------------------------------------------------- the island
SHORE_Y = 126.0
CAP_C = (30.0, 262.0); CAP_R = (190.0, 128.0); CAP_H = 41.0
PORTAL = (-17.0, 145.0, 17.0)        # Object 7's tunnel mouth (x, y, its floor z): make_bunker's tunnel at the bunker's (−37, −77, 5) + (20, 222, 12)
ROAD = [(-17.0, 144.0), (-17.0, 138.0), (-12.0, 128.0), (-6.0, 116.0), (-2.0, 108.0)]
SHAFT = (54.5, 220.5)

def hole(x, y):
    """where the island's surface is left open: the portal's mouth (its rock is a separate lump) and
    Shaft 3 under the drilling shed"""
    return (abs(x - PORTAL[0]) < 5.5 and PORTAL[1] - 2.0 < y < PORTAL[1] + 6.0) or math.hypot(x - SHAFT[0], y - SHAFT[1]) < 2.2

def smooth01(e0, e1, v):
    t = min(1.0, max(0.0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t)

def land_z(x, y):
    """the island's surface (None where it is still the sea ice): the shore rising to a few metres,
    the cap's dome over it, the cut in its south flank for the portal and the road down"""
    if y < SHORE_Y - 4: return None
    shore = 0.9 + 4.2 * smooth01(SHORE_Y, SHORE_Y + 30, y) + (ST['fbm2'](x, y, 31, 14.0, 3) - 0.5) * 1.4 * smooth01(SHORE_Y - 2, SHORE_Y + 10, y)
    u = ((x - CAP_C[0]) / CAP_R[0]) ** 2 + ((y - CAP_C[1]) / CAP_R[1]) ** 2
    dome = CAP_H * max(0.0, 1 - u) ** 0.62 if u < 1 else 0.0
    dome += (ST['fbm2'](x, y, 33, 50.0, 3) - 0.5) * 4.0 * smooth01(0, 8, dome)
    z = shore + dome
    # the cut: a notch from the portal out to the south, its floor the road's
    rd = road_dist(x, y)
    if rd is not None:
        d, rz = rd
        cut = smooth01(9.0, 3.5, d)
        z = z * (1 - cut) + min(z, rz) * cut
        if d < 3.5: z = rz
    if PORTAL[1] - 1.0 < y < PORTAL[1] + 23 and abs(x - PORTAL[0]) < 7: z = max(z, PORTAL[2] + 7.5)       # (the rock over the portal and its tunnel)
    return z

def road_dist(x, y):
    best = None
    for i in range(len(ROAD) - 1):
        (ax, ay), (bx, by) = ROAD[i], ROAD[i + 1]
        dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        px, py = ax + dx * t, ay + dy * t
        d = math.hypot(x - px, y - py)
        if best is None or d < best[0]:
            # the road's height: the portal's floor down to the station's pad
            s = (i + t) / (len(ROAD) - 1)
            best = (d, PORTAL[2] * (1 - smooth01(0.05, 1.0, s)) + 1.05 * smooth01(0.05, 1.0, s))
    return best

def ground(x, y):
    l = land_z(x, y)
    s = ST['top_z'](x, y)[0]
    return s if l is None else max(s, l)

def build_island(M, g):
    """the land: a grid from the shore inland, its vertex colours for the ice shader (snow, cracks,
    the dark of rock where it's steep)"""
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col')
    step = 3.0
    xs = np.arange(-180.0, 240.01, step); ys = np.arange(SHORE_Y - 6, 392.01, step)
    vz = {}
    grid = []
    for x in xs:
        row = []
        for y in ys:
            z = land_z(x, y)
            z = ST['top_z'](x, y)[0] - 0.05 if z is None else z
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            a, b, c, d = grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]
            if hole((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2): continue
            f = bm.faces.new((a, b, c, d))
            n = f.normal if f.normal.z >= 0 else -f.normal
            steep = 1 - n.z
            snow = 1.0 - 0.75 * smooth01(0.25, 0.55, steep)
            cav = 0.25 * smooth01(0.15, 0.5, steep)
            for l in f.loops:
                l[col] = (snow, 0.08 * smooth01(0.2, 0.6, steep), cav, 1.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('ICE_island'); bm.to_mesh(me); bm.free()
    me.materials.append(M['ice'])
    o = bpy.data.objects.new('ICE_island', me); g.objects.link(o)
    for p in me.polygons: p.use_smooth = True
    me.color_attributes.active_color = me.color_attributes['Col']
    # rocks on the shore: lumps of dark stone half in the snow
    rp = K.Part('STATION_rocks', [M['rock']], g)
    rng = random.Random(5)
    for k in range(70):
        x = rng.uniform(-150, 210); y = SHORE_Y + rng.uniform(-2, 22)
        if abs(x - PORTAL[0]) < 14 and y > 120: continue
        r = rng.uniform(0.6, 2.6)
        B['lump'](rp, x, y, ground(x, y) - r * 0.35, r * rng.uniform(0.8, 1.6), r * rng.uniform(0.7, 1.3), r * rng.uniform(0.4, 0.8), M['rock'], segs=9, rings=6, rot=rng.uniform(0, 3))
    rp.done(smooth=True)
    # the collision: the part people walk on (the shore, the road, the cap up to the drilling shed)
    cp = K.Part('COL_island', [M['col']], g)
    step = 4.0
    xs = np.arange(-60.0, 100.01, step); ys = np.arange(SHORE_Y - 6, 250.01, step)
    gr = [[cp.bm.verts.new((x, y, land_z(x, y) if land_z(x, y) is not None else ST['top_z'](x, y)[0] - 0.05)) for y in ys] for x in xs]
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            if hole((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2): continue
            cp.bm.faces.new((gr[i][j], gr[i + 1][j], gr[i + 1][j + 1], gr[i][j + 1]))
    cp.done()
    # the rock over the portal's opening in the island (the hole above is covered)
    px, py, pz = PORTAL
    B['lump'](rp2 := K.Part('STATION_rock_portal', [M['rock']], g), px, py + 4.0, pz + 7.5, 8.0, 5.5, 2.2, M['rock'], segs=12, rings=8)
    rp2.done(smooth=True)

# ---------------------------------------------------------------- materials
def materials():
    X.SETS.clear()
    t = {
        'white': X.get('white', X.white_paint), 'machine': X.get('machine', X.machine_paint),
        'wood': X.get('wood', X.wood, col=(0.5, 0.36, 0.22), dark=(0.3, 0.2, 0.11), seed=8, varnish=0.7),
        'steel': X.get('steel', X.brushed_steel), 'rubber': X.get('rubber', X.rubber),
        'paper': X.get('s_wallpaper', TS.wallpaper), 'boards': X.get('s_boards', TS.floorboards),
        'lino': X.get('s_lino', X.lino, (0.3, 0.2, 0.12)), 'panel': X.get('s_panel', X.wall_panel),
        'ceil': X.get('s_ceil', TS.concrete_wall, dado=-1.0, seed=91, upper=(0.8, 0.79, 0.74)),
        'plank': X.get('s_plank', X.wood, col=(0.42, 0.33, 0.24), dark=(0.26, 0.19, 0.13), seed=21, varnish=0.85, joints=0.14),
        'logs': X.get('s_logs', X.wood, col=(0.45, 0.32, 0.2), dark=(0.28, 0.18, 0.1), seed=23, varnish=0.8),
        'rime': X.get('b_rime', TS.rime), 'craw': X.get('b_craw', TS.concrete_raw), 'blanket': X.get('b_blanket', TS.blanket),
        'docpaper': X.get('b_paper', TS.paper), 'door': X.get('b_door', X.steel_paint, (0.33, 0.38, 0.33), 59, 2.0, 1.0, 0.8, 0.7),
        'rock': X.get('s_rock', TS.concrete_raw, col=(0.16, 0.155, 0.15), seed=97),
    }
    P = X.pbr
    M = {
        'ice': C.mat('Ice_Shelf', (0.85, 0.9, 0.95), 0.4), 'snow': C.mat('Ex_Snow', (0.86, 0.9, 0.95), 0.85),
        'white': P('Ex_White', t['white']), 'red': P('Ex_Station_Red', t['machine'], tint=(0.5, 0.06, 0.02)),
        'blue': P('Ex_Station_Blue', t['machine'], tint=(0.03, 0.13, 0.42)), 'yellow': P('Ex_Station_Yellow', t['machine'], tint=(0.7, 0.45, 0.03)),
        'orange': P('Ex_Station_Orange', t['machine'], tint=(0.75, 0.2, 0.02)), 'dark': P('Ex_Dark', t['machine'], tint=(0.04, 0.045, 0.05)),
        'green': P('Ex_Station_Green', t['machine'], tint=(0.05, 0.14, 0.07)), 'wood': P('Ex_Wood_Raw', t['wood']),
        'steel': P('Ex_Steel', t['steel']), 'rubber': P('Ex_Rubber', t['rubber']),
        'tarp': C.mat('Ex_Tarp', (0.08, 0.16, 0.08), 0.85), 'rock': P('Ex_Rock', t['rock'], normal_strength=1.5),
        'window': C.mat('Lamp_Warm', (1, 0.8, 0.55), 0.4, emit=(1.0, 0.72, 0.42), emit_strength=4.0),
        'win_dark': C.mat('Glass_Window', (0.03, 0.04, 0.05), 0.05, 0.0, alpha=0.35),
        'lampcold': C.mat('Lamp_Cold', (0.9, 0.95, 1), 0.4, emit=(0.85, 0.92, 1.0), emit_strength=8.0),
        'sign_white': C.mat('Ex_Sign_White', (0.88, 0.88, 0.86), 0.5), 'sign_blue': C.mat('Ex_Sign_Blue', (0.0, 0.12, 0.45), 0.5),
        'beacon': C.mat('Lamp_Beacon', (1, 0.1, 0.05), 0.3, emit=(1.0, 0.06, 0.02), emit_strength=20.0),
        'flag_w': C.mat('Ex_Flag_White', (0.88, 0.88, 0.86), 0.85), 'flag_b': C.mat('Ex_Flag_Blue', (0.0, 0.12, 0.5), 0.85), 'flag_r': C.mat('Ex_Flag_Red', (0.65, 0.02, 0.02), 0.85),
        'rope': P('Ex_Rope', X.get('rope', X.rope_braid)),
        'col': C.mat('Collision', (1, 0, 1), 1.0),
        # the rooms (the bunker kit's names)
        'wallpaper': P('S_Wallpaper', t['paper']), 'boards': P('S_Floorboards', t['boards']), 'lino': P('S_Lino', t['lino']),
        'panel': P('S_Panels', t['panel']), 'ceil': P('S_Ceiling', t['ceil']), 'plank': P('S_Planks', t['plank']), 'logs': P('S_Logs', t['logs']),
        'plankx': P('Ex_Planks', t['plank'], tint=(0.7, 0.66, 0.62)), 'logsx': P('Ex_Logs', t['logs'], tint=(0.65, 0.6, 0.55)),
        'rime': P('B_Rime', t['rime']), 'craw': P('B_Concrete', t['craw']), 'blanket': P('B_Blanket', t['blanket']),
        'door': P('B_Door_Steel', t['door']), 'docpaper': P('B_Paper', t['docpaper']),
        'grey': P('B_Paint_Grey', t['machine'], tint=(0.36, 0.38, 0.38)), 'black': P('B_Paint_Black', t['machine'], tint=(0.04, 0.04, 0.045)),
        'cream': P('B_Paint_Cream', t['machine'], tint=(0.7, 0.66, 0.55)), 'olive': P('B_Paint_Olive', t['machine'], tint=(0.22, 0.24, 0.13)),
        'woodfine': P('B_Wood_Fine', X.get('b_woodfine', X.wood, col=(0.32, 0.16, 0.08), dark=(0.16, 0.07, 0.03), seed=19, varnish=0.18)),
        'iron': C.mat('B_Cast_Iron', (0.06, 0.06, 0.065), 0.6, 0.6), 'brass': C.mat('B_Brass', (0.6, 0.45, 0.18), 0.35, 1.0),
        'chrome': C.mat('B_Chrome', (0.75, 0.75, 0.75), 0.2, 1.0), 'glass': C.mat('Glass_Bunker', (0.05, 0.07, 0.08), 0.05, 0.0, alpha=0.25),
        'mattress': C.mat('B_Mattress', (0.42, 0.38, 0.3), 0.95), 'plate': C.mat('B_Enamel_White', (0.82, 0.82, 0.78), 0.25),
        'enamel_green': C.mat('B_Enamel_Green', (0.18, 0.3, 0.22), 0.3), 'text_w': C.mat('B_Text_White', (0.85, 0.84, 0.8), 0.6),
        'text_k': C.mat('B_Text_Black', (0.03, 0.03, 0.03), 0.6), 'chalk': C.mat('B_Chalk', (0.8, 0.8, 0.76), 0.95),
        'lamp_main': C.mat('Lamp_Bunker', (1.0, 0.86, 0.65), 0.4, emit=(1.0, 0.82, 0.58), emit_strength=6.0),
        'lamp_dead': C.mat('Lamp_Dead', (0.5, 0.5, 0.45), 0.3),
        'dial': C.mat('B_Dial', (0.85, 0.83, 0.75), 0.4), 'needle': C.mat('B_Needle', (0.6, 0.04, 0.02), 0.5),
        'bulb_r': C.mat('Lamp_Pilot_Red', (0.8, 0.05, 0.03), 0.3, emit=(1.0, 0.05, 0.02), emit_strength=3.0),
        'bulb_g': C.mat('Lamp_Pilot_Green', (0.05, 0.6, 0.1), 0.3, emit=(0.1, 1.0, 0.2), emit_strength=2.0),
        'blood': C.mat('Decal_Blood', (0.12, 0.01, 0.01), 0.3), 'rug': C.mat('B_Rug', (0.22, 0.05, 0.04), 0.95),
        'cloth_red': C.mat('B_Cloth_Red', (0.45, 0.03, 0.02), 0.9), 'cloth_grey': C.mat('B_Cloth_Grey', (0.22, 0.22, 0.2), 0.95),
        'greatcoat': C.mat('B_Greatcoat', (0.17, 0.16, 0.12), 0.95), 'orangecoat': C.mat('B_Coat_Orange', (0.75, 0.22, 0.04), 0.85),
        'cfloor': P('S_Planks2', t['plank']),
    }
    M['paper'] = M['docpaper']          # (the kit's papers and folders)
    M['cwall'] = M['wallpaper']        # (the kit's default room material)
    return M

# ---------------------------------------------------------------- the buildings' outsides
def exterior(L, st, M, bd):
    """a building's skin round its rooms: the outer half of the walls (with the doors' and the
    windows' holes), the plinth, the roof (gabled or flat, with its snow), trims, a stovepipe"""
    name, x0, y0, x1, y1, h, siding, roof, rooms = bd
    z = FZ
    t = B['WT'] / 2
    sm = M[siding]
    sides = {'s': ((x0, y0 - t / 2), (x1, y0 - t / 2), 'x'), 'n': ((x0, y1 + t / 2), (x1, y1 + t / 2), 'x'),
             'w': ((x0 - t / 2, y0 - t), (x0 - t / 2, y1 + t), 'y'), 'e': ((x1 + t / 2, y0 - t), (x1 + t / 2, y1 + t), 'y')}
    for sd, (a, b, along) in sides.items():
        holes = []
        L_ = math.hypot(b[0] - a[0], b[1] - a[1])
        for d in B['DOORS']:
            on = (along == 'x' and abs(d[1] - (y0 if sd == 's' else y1)) < 0.05 and x0 <= d[0] <= x1) or (along == 'y' and abs(d[0] - (x0 if sd == 'w' else x1)) < 0.05 and y0 <= d[1] <= y1)
            if on and abs(d[2] - z) < 0.1:
                pos = (d[0] - a[0]) if along == 'x' else (d[1] - a[1])
                holes.append((pos, d[3] + 0.12, d[2], d[2] + d[4] + 0.06))
        for w in WINDOWS:
            on = (along == 'x' and abs(w[1] - (y0 if sd == 's' else y1)) < 0.05 and x0 <= w[0] <= x1) or (along == 'y' and abs(w[0] - (x0 if sd == 'w' else x1)) < 0.05 and y0 <= w[1] <= y1)
            if on:
                pos = (w[0] - a[0]) if along == 'x' else (w[1] - a[1])
                holes.append((pos, w[3], w[2], w[4]))
                # the window: a frame, a cross bar, the glass (dark: the power's off)
                cx_, cy_ = (w[0], (y0 if sd == 's' else y1)) if along == 'x' else ((x0 if sd == 'w' else x1), w[1])
                face = {'s': '-y', 'n': '+y', 'w': '-x', 'e': '+x'}[sd]
                with st.at(cx_, cy_, w[2], K.FACE[face]):
                    st.box(-w[3] / 2 - 0.06, t - 0.01, -0.06, w[3] / 2 + 0.06, t + 0.04, 0.0, M['white'])
                    st.box(-w[3] / 2 - 0.06, t - 0.01, w[4] - w[2], w[3] / 2 + 0.06, t + 0.04, w[4] - w[2] + 0.06, M['white'])
                    for sx in (-1, 1):
                        st.box(sx * (w[3] / 2 + 0.03) - 0.03, t - 0.01, 0, sx * (w[3] / 2 + 0.03) + 0.03, t + 0.04, w[4] - w[2], M['white'])
                    st.box(-0.02, -t, 0, 0.02, -t + 0.04, w[4] - w[2], M['white'])
                    st.box(-w[3] / 2, -t, (w[4] - w[2]) * 0.62 - 0.02, w[3] / 2, -t + 0.04, (w[4] - w[2]) * 0.62 + 0.02, M['white'])
                    st.box(-w[3] / 2, -0.012, 0, w[3] / 2, 0.012, w[4] - w[2], M['win_dark'])
        K.wall(st, a, b, z - 0.45, z + h + 0.05, sm, holes, t=t)
        c = L.col('ext_' + name)
        K.wall(c, a, b, z - 0.45, z + h + 0.05, None, holes, t=t)
    # the plinth (boarded in), the steps at each outside door
    st.box(x0 - t - 0.05, y0 - t - 0.05, z - 0.65, x1 + t + 0.05, y1 + t + 0.05, z - 0.3, M['dark'])
    for d in B['DOORS']:
        if abs(d[2] - z) > 0.1: continue
        out = None
        if abs(d[1] - y0) < 0.05 and x0 <= d[0] <= x1: out = (d[0], y0 - t, '-y')
        elif abs(d[1] - y1) < 0.05 and x0 <= d[0] <= x1: out = (d[0], y1 + t, '+y')
        elif abs(d[0] - x0) < 0.05 and y0 <= d[1] <= y1: out = (x0 - t, d[1], '-x')
        elif abs(d[0] - x1) < 0.05 and y0 <= d[1] <= y1: out = (x1 + t, d[1], '+x')
        if not out: continue
        gz = ground(out[0], out[1]) - z
        n = max(1, int(round(-gz / 0.18)))
        rise = -gz / n
        with st.at(out[0], out[1], z, K.FACE[out[2]]):
            for k in range(n):
                st.box(-0.6, k * 0.3, gz - 0.1, 0.6, (k + 1) * 0.3, -k * rise, M['wood'])
            K.cage_lamp(st, 0.0, 0.0, d[4] + 0.25, M['dark'], M['lampcold'], M['dark'], axis='+y', r=0.07)
        cs = L.col('ext_' + name)
        Lr = n * 0.3 + 0.1
        ox, oy, face = out
        if face in ('-y', '+y'):
            sg = -1 if face == '-y' else 1
            K.ramp(cs, ox - 0.6, ox + 0.6, oy, z, oy + sg * Lr, z + gz, along='y')
        else:
            sg = -1 if face == '-x' else 1
            K.ramp(cs, oy - 0.6, oy + 0.6, ox, z, ox + sg * Lr, z + gz, along='x')
    # the roof
    zr = z + h + 0.05
    if roof == 'gable':
        ridge = 1.3 if (y1 - y0) > 4 else 0.9
        along_x = (x1 - x0) >= (y1 - y0)
        bm = st.bm; mi = st.mi(M['dark']); ms = st.mi(M['snow'])
        e = 0.35
        if along_x:
            pts = [(x0 - e, y0 - e - t, zr - 0.1), (x1 + e, y0 - e - t, zr - 0.1), (x1 + e, (y0 + y1) / 2, zr + ridge), (x0 - e, (y0 + y1) / 2, zr + ridge),
                   (x0 - e, y1 + e + t, zr - 0.1), (x1 + e, y1 + e + t, zr - 0.1)]
            v = [bm.verts.new(p) for p in pts]
            for fv in ((v[0], v[1], v[2], v[3]), (v[3], v[2], v[5], v[4])):
                f = bm.faces.new(fv); f.material_index = mi
            # the gable ends (walls up to the ridge)
            for xx in (x0 - t, x1 + t):
                tri = [bm.verts.new((xx, y0 - t, zr)), bm.verts.new((xx, y1 + t, zr)), bm.verts.new((xx, (y0 + y1) / 2, zr + ridge - 0.05))]
                f = bm.faces.new(tri); f.material_index = st.mi(sm)
            # snow lying on it
            for sgn in (-1, 1):
                yy = (y0 + y1) / 2 + sgn * (y1 - y0) / 4
                with st.at((x0 + x1) / 2, yy, zr + ridge / 2 + 0.05, rx=-sgn * math.atan2(ridge, (y1 - y0) / 2 + e)):
                    st.rbox(-(x1 - x0) / 2 - 0.2, -(y1 - y0) / 4 - 0.2, 0, (x1 - x0) / 2 + 0.2, (y1 - y0) / 4 + 0.15, 0.22, M['snow'], r=0.1, segs=2)
        else:
            pts = [(x0 - e - t, y0 - e, zr - 0.1), (x0 - e - t, y1 + e, zr - 0.1), ((x0 + x1) / 2, y1 + e, zr + ridge), ((x0 + x1) / 2, y0 - e, zr + ridge),
                   (x1 + e + t, y0 - e, zr - 0.1), (x1 + e + t, y1 + e, zr - 0.1)]
            v = [bm.verts.new(p) for p in pts]
            for fv in ((v[0], v[1], v[2], v[3]), (v[3], v[2], v[5], v[4])):
                f = bm.faces.new(fv); f.material_index = mi
            for yy in (y0 - t, y1 + t):
                tri = [bm.verts.new((x0 - t, yy, zr)), bm.verts.new((x1 + t, yy, zr)), bm.verts.new(((x0 + x1) / 2, yy, zr + ridge - 0.05))]
                f = bm.faces.new(tri); f.material_index = st.mi(sm)
            for sgn in (-1, 1):
                xx = (x0 + x1) / 2 + sgn * (x1 - x0) / 4
                with st.at(xx, (y0 + y1) / 2, zr + ridge / 2 + 0.05, ry=sgn * math.atan2(ridge, (x1 - x0) / 2 + e)):
                    st.rbox(-(x1 - x0) / 4 - 0.2, -(y1 - y0) / 2 - 0.2, 0, (x1 - x0) / 4 + 0.15, (y1 - y0) / 2 + 0.2, 0.22, M['snow'], r=0.1, segs=2)
    else:
        st.box(x0 - t - 0.2, y0 - t - 0.2, zr, x1 + t + 0.2, y1 + t + 0.2, zr + 0.15, M['white'])
        st.rbox(x0 - t, y0 - t, zr + 0.15, x1 + t - 0.2, y1 + t, zr + 0.42, M['snow'], r=0.18, segs=3)
    st.cyl(x0 + 1.0, (y0 + y1) / 2 + 0.6, zr + 1.4, 0.08, 2.0, M['dark'], segs=10)
    st.cyl(x0 + 1.0, (y0 + y1) / 2 + 0.6, zr + 2.45, 0.15, 0.12, M['dark'], segs=10, r2=0.09)
    # drifts against the walls
    rng = L.rng
    for k in range(int((x1 - x0 + y1 - y0) * 0.8)):
        sd = rng.choice('snwe')
        if sd in 'sn': px = rng.uniform(x0, x1); py = (y0 - t) if sd == 's' else (y1 + t)
        else: py = rng.uniform(y0, y1); px = (x0 - t) if sd == 'w' else (x1 + t)
        if any(abs(px - d[0]) < 1.0 and abs(py - d[1]) < 1.0 for d in B['DOORS']): continue
        r_ = rng.uniform(0.5, 1.4)
        B['lump'](st, px, py, ground(px, py) - r_ * 0.25, r_, r_ * 0.8, r_ * 0.5, M['snow'], segs=10, rings=6)

# ---------------------------------------------------------------- the rooms' insides
def furnish(L, M):
    rng = L.rng
    P = lambda r, small=False: L.part(r, small)
    z = FZ
    # ---- the hall: the duty desk, the barricade the dead piled against the front door, the stove, the table
    p, s = P('mh_hall'), P('mh_hall', True)
    B['desk'](p, M, -6.6, 83.2, z, 0.0, m=M['wood'])
    B['chair'](p, M, -6.6, 83.9, z, math.pi)
    s.box(-7.0, 83.0, z + 0.78, -6.75, 83.3, z + 0.85, M['black']); s.cyl(-6.2, 83.0, z + 0.79, 0.12, 0.25, M['grey'], segs=10)     # telephone, a thermos
    L.E('DOC_ch2_duty_log', (-6.4, 83.3, z + 0.8))
    B['table'](p, M, -5.2, 84.0, -3.0, 84.9, z)
    for xx in (-4.7, -3.6): B['chair'](p, M, xx, 84.3, z, 0.3, fallen=(xx < -4))
    p.cyl(-7.4, 84.8, z + 0.42, 0.3, 0.8, M['iron'], segs=16); p.cyl(-7.4, 84.8, z + 1.9, 0.07, 2.1, M['iron'], segs=10)
    L.E('USE_stove_hall', (-7.4, 84.4, z + 0.6), hint='Печь / Stove', action='stove', heat=1)
    K.picture(s, -4.5, 85.3 - 0.16, z + 1.6, '-y', 0.6, 0.45, M['woodfine'], M['blood'])
    B['blood'](L, 'mh_hall', -4.0, 83.6, z, 1.5)
    # the vestibule: the front door nailed shut, the furniture piled against it
    p, s = P('mh_vest'), P('mh_vest', True)
    for (x, y, w, d, hh, rz) in ((-0.6, 82.8, 1.0, 0.5, 0.9, 0.2), (0.5, 82.9, 0.8, 0.6, 1.3, -0.1), (0.0, 83.3, 1.2, 0.4, 0.5, 0.6)):
        B['crate'](p, M, x, y, z, w, d, hh, rz=rz, m=M['wood'])
    for k in range(6):
        s.box(-0.55 + k * 0.2, 82.38, z + 0.5 + (k % 3) * 0.5, -0.5 + k * 0.2, 82.42, z + 0.58 + (k % 3) * 0.5, M['wood'])           # boards nailed across
    L.E('DOC_ch2_door_main', (0.3, 82.4, z + 1.4))
    for k in range(4):
        K.coat(s, -1.4, 83.0 + k * 0.5, z + 1.75, '+x', M['orangecoat'] if k % 2 else M['greatcoat'], None, 1.0, 0.45)
    # the workshop: the bench, the key board, the vice, the shelves; the fuse in the sweet tin
    p, s = P('mh_work'), P('mh_work', True)
    B['table'](p, M, 2.0, 82.5, 5.5, 83.3, z, top=M['wood'], leg=M['grey'], h=0.9)
    s.cyl(4.6, 82.9, z + 0.95, 0.07, 0.07, M['red'], segs=14)                       # the sweet tin
    L.E('ITEM_work_fuse', (4.6, 82.9, z + 1.0), item='fuse', count=1)
    p.box(2.4, 82.7, z + 0.9, 2.6, 82.95, z + 1.05, M['grey'])                      # the vice
    with s.at(7.85, 84.6, z + 1.4, K.FACE['-x']):
        s.box(-0.35, 0, -0.25, 0.35, 0.02, 0.25, M['woodfine'])
        for k in range(6):
            s.cyl(-0.25 + k * 0.1, 0.03, 0.1, 0.006, 0.04, M['brass'], axis='Y', segs=6)
    L.E('DOC_ch2_key_board', (7.8, 84.6, z + 1.4))
    for k, key in enumerate(('key_generator', 'key_depot', 'key_kennel')):
        L.E(f'ITEM_key_{k + 1}', (7.75, 84.35 + k * 0.1, z + 1.48), item=key, count=1)
    B['shelf_unit'](p, M, 5.6, 7.6, 82.25 + 0.16, z, 2.0, 0.4, '+y', 5, m=M['wood'],
                    stuff=lambda pp, a, b, zz, d, hh, r: [B['crate'](pp, M, a + 0.3 + i * 0.5, d * 0.5, zz, 0.35, 0.3, min(0.25, hh), m=M['olive']) for i in range(int((b - a) / 0.5))], rng=rng)
    L.E('ITEM_work_battery', (6.2, 82.6, z + 1.25), item='battery', count=2)
    # the corridor: coats on hooks, felt boots, a lamp
    p, s = P('mh_cor'), P('mh_cor', True)
    for k in range(5):
        K.coat(s, -7.0 + k * 0.6, 86.7 - 0.16, z + 1.75, '-y', M['orangecoat'] if k % 2 else M['greatcoat'], None, 0.95, 0.45)
    for i, xx in enumerate((-5.0, 2.0, 6.5)):
        K.cage_lamp(s, xx, 86.0, z + 2.7, M['grey'], M['lamp_main'], M['grey'], r=0.07)
        L.lamp(f'mh_cor_{i}', xx, 86.0, z + 2.4, power=14, rng=6, flicker=0.2 if i == 1 else 0.0)
    B['blood'](L, 'mh_cor', -1.0, 86.0, z, 1.2)
    # Gromov's room: his bed, his desk (the journals), the photo of Nadya on the wall (the pass behind it)
    p, s = P('mh_gromov'), P('mh_gromov', True)
    p.box(-7.85, 88.6, z, -5.9, 89.6, z + 0.45, M['wood'])
    p.rbox(-7.8, 88.65, z + 0.45, -5.95, 89.55, z + 0.6, M['mattress'], r=0.04, segs=2)
    p.rbox(-7.0, 88.62, z + 0.58, -5.95, 89.58, z + 0.64, M['blanket'], r=0.03, segs=2)
    B['desk'](p, M, -4.4, 88.9, z, math.pi / 2, m=M['woodfine'])
    B['papers'](s, M, -4.4, 88.9, z + 0.785, rng, 7, 0.2)
    for k in range(4): L.E(f'DOC_ch2_gromov_{k + 1}', (-4.5, 88.6 + k * 0.18, z + 0.8))
    K.picture(s, -8 + 0.16, 88.1, z + 1.55, '+x', 0.25, 0.32, M['woodfine'], M['cream'])
    L.E('DOC_ch2_photo_nadya', (-8 + 0.22, 88.1, z + 1.55))
    L.E('ITEM_gromov_pass', (-8 + 0.2, 88.1, z + 1.35), item='keycard_gromov', count=1)
    B['chair'](p, M, -5.0, 88.9, z, -math.pi / 2)
    B['shelf_unit'](p, M, -7.8, -6.3, 86.7 + 0.16, z, 1.8, 0.3, '+y', 5, m=M['wood'], stuff=lambda pp, a, b, zz, d, hh, r: B['folders'](pp, a, b, zz, d, hh, r, M), rng=rng)
    K.cage_lamp(s, -5.75, 88.2, z + 2.7, M['grey'], M['lamp_main'], M['grey'], r=0.07)
    L.lamp('mh_gromov', -5.75, 88.2, z + 2.4, power=12, rng=6)
    B['locker'](L, 'mh_gromov', -7.85, 87.3, z, '+x', name='mh_gromov')
    # the bunk room: four bunks, lockers, someone's guitar
    p, s = P('mh_bunks'), P('mh_bunks', True)
    for xx in (-2.9, 0.4):
        B['bunk'](p, M, xx, 88.7, z, math.pi / 2, rng)
    B['locker'](L, 'mh_bunks', -1.25, 89.6, z, '-y', name='mh_bunks')
    B['blood'](L, 'mh_bunks', -1.5, 88.0, z, 1.0)
    L.E('ITEM_bunks_vodka', (0.4, 87.8, z + 0.7), item='vodka', count=1)
    # the radio room: the transmitter racks, the desk, the lamp, the counting sheet; barricaded
    p, s = P('mh_radio'), P('mh_radio', True)
    for k in range(3):
        with p.at(2.0 + k * 0.75, 89.75 - 0.16, z, K.FACE['-y']):
            p.box(-0.32, 0, 0, 0.32, 0.55, 1.85, M['grey'])
            B['panel_dials'](p, M, -0.3, 0.3, 0.9, 1.8, rng, 2)
    B['desk'](p, M, 5.6, 89.0, z, math.pi, m=M['wood'])
    s.box(5.2, 88.9, z + 0.78, 5.8, 89.3, z + 0.98, M['grey'])                        # the receiver
    s.cyl(6.0, 89.1, z + 0.79, 0.06, 0.02, M['brass'], segs=10); s.cyl(6.0, 89.1, z + 0.98, 0.01, 0.38, M['brass'], segs=8)
    s.sphere(6.0, 89.02, z + 1.16, 0.1, M['enamel_green'], segs=12, rings=6, sz=0.5)
    for k, d in enumerate(('ch3_markova_1', 'ch3_markova_2', 'ch3_markova_3', 'ch3_markova_count')):
        L.E(f'DOC_{d}', (5.3 + k * 0.15, 88.8, z + 0.8))
    L.E('DOC_ch3_door_radio', (4.5, 86.62, z + 1.4))
    L.E('USE_radio', (5.5, 89.1, z + 1.0), hint='Рация / Radio', action='radio')
    B['chair'](p, M, 5.6, 88.2, z, 0.1)
    B['crate'](p, M, 4.0, 87.2, z, 0.8, 0.5, 0.9, rz=0.3, m=M['olive'])                # (what she pushed against the door)
    # the mess hut: the table, the three at it, the serving hatch, the stove
    p, s = P('mess'), P('mess', True)
    B['table'](p, M, -24.6, 73.4, -20.4, 74.6, z)
    B['bench'](p, M, -24.4, 72.75, -20.6, 73.05, z); B['bench'](p, M, -24.4, 74.95, -20.6, 75.25, z)
    for k in range(5):
        s.cyl(-24.0 + k * 0.85, 73.75, z + 0.77, 0.12, 0.012, M['plate'], segs=16); s.cyl(-24.0 + k * 0.85, 74.25, z + 0.77, 0.12, 0.012, M['plate'], segs=16)
    for k, (x, y, rz) in enumerate(((-23.4, 72.9, 0.0), (-21.7, 72.9, 0.0), (-22.6, 75.1, math.pi))):
        L.E(f'SPAWN_mess_{k + 1}', (x, y, z), (0, 0, rz), kind=('turned_a', 'turned_b', 'turned_a')[k], state='dormant', pose='sit', turnhead=(k == 1))
    p.box(-19.2, 71.9, z, -18.15, 73.4, z + 0.9, M['wood']); s.box(-19.25, 71.9, z + 0.9, -18.15, 73.4, z + 0.94, M['steel'])
    L.E('DOC_ch2_tamara_note', (-18.6, 72.6, z + 0.96))
    p.cyl(-25.4, 75.6, z + 0.4, 0.28, 0.75, M['iron'], segs=14)
    L.E('USE_stove_mess', (-25.4, 75.2, z + 0.6), hint='Печь / Stove', action='stove', heat=1)
    K.cage_lamp(s, -22.0, 74.0, z + 2.5, M['grey'], M['lamp_main'], M['grey'], r=0.07)
    L.lamp('mess', -22.0, 74.0, z + 2.2, power=12, rng=6, flicker=0.3)
    L.E('TRIG_mess', (-22.0, 74.0, z + 1.2), size=[7, 4, 2.4])
    # the lab: benches with the cores and glassware, the analysis, the tape recorder; the cold room
    p, s = P('lab'), P('lab', True)
    B['table'](p, M, 17.0, 74.0, 21.5, 74.8, z, top=M['black'], leg=M['grey'], h=0.9)
    for k in range(6):
        s.cyl(17.4 + k * 0.7, 74.4, z + 1.0, 0.05, 0.2, M['glass'], segs=10)
    L.E('DOC_ch3_lab_analysis', (18.0, 74.5, z + 0.95))
    B['desk'](p, M, 19.0, 77.8, z, math.pi, m=M['wood'])
    with s.at(19.0, 77.8, z + 0.78):
        s.rbox(-0.2, -0.12, 0, 0.2, 0.12, 0.09, M['black'], r=0.01, segs=1)              # the cassette recorder
    L.E('DOC_ch3_tape_shaft3', (19.0, 77.8, z + 0.9))
    L.E('USE_tape', (19.0, 77.8, z + 0.95), hint='Магнитофон / Tape recorder', action='play', tape='tape_shaft3')
    p, s = P('lab_cold'), P('lab_cold', True)
    for k in range(3):
        B['crate'](p, M, 23.0 + (k % 2) * 1.2, 74.2 + k * 1.3, z, 1.0, 0.6, 0.5, label='КЕРН', m=M['grey'])
        for j in range(3):
            s.cyl(22.7 + (k % 2) * 1.2 + j * 0.25, 74.2 + k * 1.3, z + 0.55, 0.05, 0.6, M['rime'], axis='Y', segs=10)
    B['frost'](L, 'lab_cold', 2.0)
    L.E('USE_core', (23.6, 75.5, z + 0.8), hint='Керн / The core', action='core')
    # the generator hut: the diesel, its tank, the panel, the card
    p, s = P('gen'), P('gen', True)
    p.rbox(-8.2, 103.0, z, -5.4, 104.4, z + 0.35, M['dark'], r=0.02)
    p.rbox(-8.0, 103.1, z + 0.35, -6.2, 104.3, z + 1.25, M['green'], r=0.05, segs=2)
    p.rbox(-6.2, 103.2, z + 0.35, -5.5, 104.2, z + 1.05, M['dark'], r=0.04, segs=2)
    p.cyl(-7.1, 103.7, z + 1.4, 0.12, 0.3, M['dark'], segs=10)
    with p.at(-3.0 - 0.16, 104.5, z + 1.0, K.FACE['-x']):
        p.box(-0.5, 0, 0, 0.5, 0.25, 1.2, M['grey'])
        B['panel_dials'](p, M, -0.45, 0.45, 0.3, 1.15, rng, 3)
    L.E('USE_generator', (-6.8, 102.7, z + 0.9), hint='Дизель / Generator', action='generator')
    L.E('DOC_ch2_generator_card', (-3.2, 103.6, z + 1.5))
    K.cage_lamp(s, -6.0, 104.0, z + 2.8, M['grey'], M['lamp_dead'], M['grey'], r=0.07)
    # the depot's shed: jerrycans, the tally board
    p, s = P('depot'), P('depot', True)
    for k in range(6):
        B['crate'](p, M, -40.3 + (k % 3) * 0.5, 99.5 + (k // 3) * 0.5, z, 0.17, 0.35, 0.45, m=M['olive'])
    L.E('ITEM_depot_fuel', (-39.8, 100.0, z + 0.5), item='fuel_can', count=1)
    L.E('DOC_ch2_depot_note', (-36.2, 102.6, z + 1.4))
    # the kennel: its cages inside, the note
    p, s = P('kennel'), P('kennel', True)
    for k in range(3):
        with p.at(-46.8 + k * 1.5, 83.0, z):
            for xx in (-0.6, 0.6): p.box(xx - 0.02, -0.6, 0, xx + 0.02, 0.6, 1.0, M['grey'])
            for k2 in range(8): p.box(-0.6, -0.6, 0.12 * k2, 0.6, -0.58, 0.12 * k2 + 0.02, M['grey'])
    L.E('DOC_ch3_kennel_note', (-42.6, 82.6, z + 1.4))
    B['blood'](L, 'kennel', -45.0, 82.0, z, 1.6)
    # the banya: the changing room's bench, the doctor's bag; the steam room's stove and shelves
    p, s = P('banya_ch'), P('banya_ch', True)
    B['bench'](p, M, 39.7, 76.2, 41.6, 76.6, z)
    s.rbox(40.5, 76.25, z + 0.45, 40.9, 76.55, z + 0.7, M['black'], r=0.04, segs=2)
    L.E('DOC_ch3_ershov_notes', (40.7, 76.4, z + 0.75)); L.E('DOC_ch3_banya_note', (41.7, 78.6, z + 1.5))
    L.E('ITEM_banya_medkit', (40.0, 76.4, z + 0.5), item='medkit', count=1)
    p, s = P('banya_st'), P('banya_st', True)
    for k in range(2):
        p.box(42.3, 76.2 + k * 0.0, z + 0.45 + k * 0.5, 44.35, 77.0 - k * 0.0, z + 0.5 + k * 0.5, M['plank'])
    p.box(43.3, 78.8, z, 44.3, 79.8, z + 0.9, M['iron']); s.box(43.35, 78.85, z + 0.9, 44.25, 79.75, z + 1.15, M['rock'])
    L.E('USE_stove_banya', (43.4, 78.6, z + 0.8), hint='Каменка / The stove', action='stove', heat=1.5)
    for k, (x, y) in enumerate(((42.8, 76.6), (43.8, 76.6))):
        L.E(f'SPAWN_banya_{k + 1}', (x, y, z + 0.5), (0, 0, math.pi), kind='turned_b' if k else 'turned_a', state='dormant', pose='sit')
    L.lamp('banya', 42.0, 78.0, z + 2.1, color=(1, 0.7, 0.45), power=8, rng=5, flicker=0.2)
    # frost in the rooms
    for r_ in ROOMS:
        B['frost'](L, r_, 0.25 if r_.startswith('mh') else 0.45)

# ---------------------------------------------------------------- the rest outside
def outside(L, st, sm, M, g):
    rng = L.rng
    # the kennel's runs: wire cages against its east wall
    for k in range(3):
        with st.at(-42.0 + 0.0, 80.8 + k * 1.1, ground(-42, 81)):
            for xx in (0.0, 1.0): st.box(xx - 0.02, -0.5, 0, xx + 0.02, 0.5, 1.1, M['grey'])
            for zz in (0.02, 1.08): st.box(0.0, -0.5, zz - 0.02, 1.0, 0.5, zz + 0.02, M['grey'])
    # the depot's fence round the tanks, its gate
    fx0, fy0, fx1, fy1 = -42.0, 90.0, -25.0, 104.5
    for (a, b) in (((fx0, fy0), (fx1, fy0)), ((fx1, fy0), (fx1, fy1)), ((fx1, fy1), (fx0, fy1)), ((fx0, fy1), (fx0, fy0))):
        L_, ux, uy, rz = K.wall_dir(a, b)
        n = int(L_ / 2.5)
        for k in range(n + 1):
            px, py = a[0] + ux * L_ * k / n, a[1] + uy * L_ * k / n
            if abs(px - (-28.0)) < 1.6 and abs(py - fy0) < 0.1: continue        # (the gate)
            st.cyl(px, py, ground(px, py) + 0.9, 0.04, 1.8, M['dark'], segs=6)
        for zz in (0.4, 0.9, 1.4, 1.75):
            st.boxc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ground((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) + zz, L_, 0.02, 0.02, M['dark'], rz)
    K.sign(sm, -28.0, fy0 - 0.05, ground(-28, fy0) + 1.9, '-y', 'СКЛАД ГСМ', 0.12, M['red'], M['sign_white'])
    L.E('SPAWN_depot_bear', (-33.0, 94.5, ground(-33, 94.5)), (0, 0, 2.2), kind='bear', state='roam', pose='eat', home=[-33, 96, 14], blood=1.0)
    L.E('TRIG_depot', (-30.0, 92.0, ground(-30, 92) + 1.2), size=[18, 10, 3])
    # the mast's ladder up its east leg, the feeder's box at the top
    mx, my = 30.0, 98.0; mz = ground(mx, my) + 0.2
    K.ladder_rungs(sm, mx + 0.62, my, mz, mz + 27.5, M['dark'], facing='x', w=0.4)
    L.E('LADDER_mast', (mx + 0.75, my, mz), x=mx + 0.75, y=my, **{'from': 0.0, 'to': 27.5})
    sm.box(mx - 0.25, my - 0.25, mz + 26.6, mx + 0.25, my + 0.25, mz + 27.2, M['grey'])
    L.E('USE_feeder', (mx + 0.3, my, mz + 26.9), hint='Фидер / The feeder', action='feeder')
    sm.box(mx - 1.0, my - 1.0, mz + 25.4, mx + 1.0, my + 1.0, mz + 25.5, M['dark'])               # a platform near the top
    L.E('TRIG_mast_top', (mx, my, mz + 26.3), size=[2.4, 2.4, 2.0])
    cp = L.col('mast')
    cp.box(mx - 1.0, my - 1.0, mz + 25.35, mx + 1.0, my + 1.0, mz + 25.5, None)
    # the crashed An-2: a biplane on its belly, one wing torn off, half drifted over
    ax, ay = 78.0, 34.0; az = ground(ax, ay)
    with st.at(ax, ay, az, math.radians(35), ry=math.radians(-8)):
        st.cyl(0, 0, 1.0, 0.85, 9.0, M['green'], axis='Y', segs=16, r2=0.45)                           # the fuselage
        st.rbox(-0.8, 4.0, 0.3, 0.8, 5.6, 1.9, M['green'], r=0.3, segs=3)
        st.cyl(0, 5.7, 1.1, 0.75, 0.5, M['dark'], axis='Y', segs=18)
        for k in range(4):
            a = k * math.pi / 2 + 0.4
            with st.at(0, 6.0, 1.1, ry=a):
                st.box(-0.08, -0.03, 0, 0.08, 0.03, 1.4 * (0.4 if k == 2 else 1.0), M['dark'])
        st.box(-9.0, 2.2, 1.9, 0.6, 3.8, 2.0, M['green']); st.box(-6.0, 2.4, 0.4, 0.6, 3.6, 0.5, M['green'])
        for xx in (-6.0, -3.0): st.cyl(xx, 3.0, 1.2, 0.04, 1.5, M['dark'], segs=6)
        st.box(-1.8, -4.5, 1.0, 1.8, -3.6, 1.1, M['green']); st.box(-0.05, -4.6, 1.0, 0.05, -3.6, 2.3, M['green'])
        st.rbox(-0.5, -1.5, 1.85, 0.5, 1.5, 2.15, M['snow'], r=0.2, segs=2)
    for k in range(10):
        r_ = rng.uniform(0.8, 2.2)
        B['lump'](st, ax + rng.uniform(-5, 5), ay + rng.uniform(-5, 5), az - r_ * 0.3, r_, r_ * 0.8, r_ * 0.4, M['snow'])
    # the flags up the cap to the drilling shed, and the shed itself
    pts = [(10.0, 118.0)] + [(10.0 + (54.5 - 10.0) * (k / 14) + math.sin(k * 0.8) * 6, 118.0 + (213.0 - 118.0) * (k / 14)) for k in range(1, 15)]
    for k, (px, py) in enumerate(pts):
        pz = ground(px, py)
        st.cyl(px, py, pz + 1.0, 0.02, 2.0, M['wood'], segs=6)
        st.box(px, py - 0.01, pz + 1.65, px + 0.35, py + 0.01, pz + 1.95, M['red'] if k % 2 else M['orange'])
    drill(L, st, sm, M, g)
    portal(L, st, sm, M, g)

def drill(L, st, sm, M, g):
    """the drilling shed on the cap: a plank shed over Shaft 3, the rig's derrick through its roof,
    the winch, the console, the hatch open on the dark"""
    global DRILL_Z
    x0, y0, x1, y1 = 50.5, 217.5, 58.5, 223.5
    gz = max(ground(x, y) for x in (x0, x1) for y in (y0, y1))
    DRILL_Z = gz + 0.3
    B['ROOMS']['drill'] = (x0, y0, x1, y1, DRILL_Z, 3.4, 'plank', 'boards', 'plank', 'interior')
    B['DOORS'].append((54.5, 217.5, DRILL_Z, 1.4, 2.4, 'drill', 'wood', 100, '', ''))
    B['shell'](L, 'drill')
    for d in B['DOORS'][-1:]: B['door'](L, d)
    exterior(L, st, M, ('drill', x0, y0, x1, y1, 3.4, 'plankx', 'gable', ['drill']))
    p, s = L.part('drill'), L.part('drill', True)
    z = DRILL_Z
    sx, sy = 54.5, 220.5
    # the hatch: a steel collar round the hole, its lid thrown back, ice round it
    for (a, b) in (((sx - 0.95, sy - 0.95), (sx + 0.95, sy - 0.95)), ((sx - 0.95, sy + 0.95), (sx + 0.95, sy + 0.95)), ((sx - 0.95, sy - 0.95), (sx - 0.95, sy + 0.95)), ((sx + 0.95, sy - 0.95), (sx + 0.95, sy + 0.95))):
        K.wall(p, a, b, z - 6.0, z + 0.35, M['craw'], t=0.3)
    p.box(sx - 0.9, sy + 0.95, z + 0.35, sx + 0.9, sy + 1.05, z + 2.0, M['grey'])                   # the lid, up
    K.ladder_rungs(p, sx, sy + 0.78, z - 6.0, z + 0.3, M['steel'], facing='y', w=0.5)
    K.sign(s, sx, sy - 0.8, z + 0.6, '-y', 'ШАХТА № 3', 0.11, M['yellow'], M['text_k'])
    L.E('LADDER_shaft3_top', (sx, sy + 0.6, z - 6.0), x=sx, y=sy + 0.6, **{'from': -6.0, 'to': 0.3}, bottom='bunker')
    L.E('TRIG_shaft_down', (sx, sy, z - 4.5), size=[1.6, 1.6, 2.5])
    # the hole: the floor of the shed is cut round it (a separate slab ring) and its walls go down
    # the derrick: a lattice tower up through the roof, the drill string, the winch drum
    for (dx, dy) in ((-1.4, -1.4), (1.4, -1.4), (-1.4, 1.4), (1.4, 1.4)):
        p.tube([(sx + dx, sy + dy, z), (sx + dx * 0.35, sy + dy * 0.35, z + 11.0)], 0.06, M['red'], 6)
    for k in range(7):
        zz = z + 1.5 * (k + 1); f = 1 - 0.65 * (zz - z) / 11.0
        for (a, b) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            p.tube([(sx + a[0] * 1.4 * f, sy + a[1] * 1.4 * f, zz), (sx + b[0] * 1.4 * f, sy + b[1] * 1.4 * f, zz)], 0.03, M['red'], 4)
    p.cyl(sx, sy, z + 5.5, 0.07, 11.0, M['steel'], segs=8)
    p.cyl(52.0, 222.5, z + 0.6, 0.45, 1.2, M['grey'], axis='X', segs=18)
    p.box(51.2, 221.8, z, 52.8, 223.2, z + 0.2, M['dark'])
    L.E('DOC_ch4_gromov_last', (52.0, 222.5, z + 1.15))
    with p.at(57.5, 218.6, z, -math.pi / 2):
        p.box(-0.6, -0.4, 0, 0.6, 0.4, 0.95, M['grey'])
        with p.at(0, -0.4, 0.95, rx=math.radians(-25)):
            B['panel_dials'](p, M, -0.55, 0.55, 0.0, 0.45, L.rng, 4)
    L.E('DOC_ch4_drill_log', (57.4, 218.6, z + 1.0))
    K.cage_lamp(s, 54.5, 219.0, z + 3.4, M['grey'], M['lamp_dead'], M['grey'], r=0.08)
    L.E('SPOT_drill_arrive', (sx, sy + 0.6, z + 0.05), (0, 0, math.pi))
    # Orlov: what is left of him, his AK beside it, at the shed's door
    L.E('ITEM_orlov_akm', (55.8, 216.2, ground(55.8, 216.2) + 0.05), item='ammo_762x39', count=1, weapon='akm')
    B['blood'](L, 'drill', 55.5, 216.4, ground(55.5, 216.4), 2.0)
    L.E('TRIG_drill', (54.5, 214.0, ground(54.5, 214) + 1.2), size=[10, 8, 3])

def portal(L, st, sm, M, g):
    """Object 7's old portal in the cut of the cap: a concrete face with the red star and the
    tunnel's mouth (its blast doors are the bunker's, a few metres in)"""
    px, py, pz = PORTAL
    with st.at(px, py, pz):
        st.box(-6.5, -0.6, -0.5, -4.4, 0.6, 7.0, M['craw'])
        st.box(4.4, -0.6, -0.5, 6.5, 0.6, 7.0, M['craw'])
        st.box(-6.5, -0.6, 5.0, 6.5, 0.6, 8.2, M['craw'])
        st.box(-4.4, 0.3, -0.3, 4.4, 6.0, 0.0, M['craw'])                         # (the floor in the mouth)
    B['red_star'](L, 'portal_out', px, py - 0.62, pz + 6.6, '-y', 0.6)
    K.sign(sm, px, py - 0.62, pz + 5.6, '-y', 'ОБЪЕКТ-7', 0.3, M['red'], M['sign_white'])
    c = L.col('portal')
    c.box(px - 6.5, py - 0.6, pz - 0.5, px - 4.4, py + 0.6, pz + 7.0, None)
    c.box(px + 4.4, py - 0.6, pz - 0.5, px + 6.5, py + 0.6, pz + 7.0, None)
    c.box(px - 4.4, py + 0.3, pz - 0.3, px + 4.4, py + 6.0, pz, None)
    L.E('SPOT_portal_out', (px, py - 3.0, pz + 0.1), (0, 0, math.pi))

# ---------------------------------------------------------------- the build
def build(root):
    global ST, B
    C.set_root(root)
    ST = _lib('make_station')
    B = _lib('make_bunker')
    B['ROOMS'].clear(); B['ROOMS'].update(ROOMS)
    B['DOORS'][:] = DOORS
    B['CEIL_HOLES'].clear()
    B['FLOOR_HOLES'] = {'drill': [(53.75, 219.75, 55.25, 221.25)]}
    B['WINDOWS'] = WINDOWS
    sc = C.fresh_scene('ASSET_station')
    M = materials()
    L = B['Level'](sc, M)
    g = L.g
    def E(name, loc, rot=(0, 0, 0), **ex): return C.empty(name, loc, g, rot, extras=ex)
    # the fast ice, as before (make_station's shelf), and its collision with the boxes of what stands on it
    shelf = ST['build_shelf'](M)
    st = K.Part('STATION', [M['white']], g)
    sm = K.Part('STATION_SMALLS', [M['steel']], g)
    # (make_station's outside things: borrowed by running its build into this scene, then keeping
    # all but its old buildings)
    boxes = []
    keep_station_things(st, sm, M, E, boxes)
    build_island(M, g)
    for name in ROOMS: B['shell'](L, name)
    for d in DOORS: B['door'](L, d)
    for bd in BUILDINGS: exterior(L, st, M, bd)
    furnish(L, M)
    outside(L, st, sm, M, g)
    for bd in BUILDINGS + [('drill', 50.5, 217.5, 58.5, 223.5)]:
        boxes.append((bd[1] - 0.3, bd[2] - 0.3, FZ - 1.2, bd[3] + 0.3, bd[4] + 0.3, FZ - 0.3))
    E('BERTH', (0.0, -6.35, 0.0), (0, 0, math.radians(90)))
    xs_ = [float(x) for x in np.arange(-ST['W_HALF'], ST['W_HALF'] + 0.01, 4.0)]
    E('SHELF_info', (0, 0, 0), edge=[round(ST['edge_y'](x), 2) for x in xs_], x0=-ST['W_HALF'], step=4.0, depth=ST['DEPTH'])
    cs = ST['build_collision'](g, M, boxes)
    cs.done()
    for k, p in L.parts.items():
        o = p.done(sharp=35); o['nocast'] = 1 if k.endswith('_s') else 0
    for k, c in L.cols.items(): c.done()
    st.done(sharp=40); sm.done(sharp=40)
    return sc

def keep_station_things(st, sm, M, E, boxes):
    """make_station's things outside (the berth's, the mast, the tanks, the masts, the flag, the
    lamps): its build function's code, without the main house and the huts"""
    src = open(os.path.join(HERE, 'make_station.py'), encoding='utf-8').read()
    a = src.index('    # ---------------------------------------------------------------- the radio mast')
    b = src.index('    # ---------------------------------------------------------------- the berth, the collision')
    body = src[a:b]
    import textwrap
    fn_src = 'def _things(st, sm, M, E, boxes, gcoll, top_z, K, C, math, np, bmesh, Matrix):\n' + body
    ns = {}
    exec(compile(fn_src, 'make_station_things', 'exec'), ns)
    ns['_things'](st, sm, M, E, boxes, st.coll, ST['top_z'], K, C, math, np, bmesh, Matrix)

if __name__ == '__main__' or True:
    ROOT_ = globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy')
    sc = build(ROOT_)
    objs = [o for o in sc.objects if o.type == 'MESH']
    result = {'tris': sum(C.tris(o) for o in objs if not o.name.startswith('COL_')), 'col': sum(C.tris(o) for o in objs if o.name.startswith('COL_')),
              'objects': len(objs), 'empties': len([o for o in sc.objects if o.type == 'EMPTY']), 'drill_z': DRILL_Z}
    if globals().get('EXPORT', True):
        path = os.path.join(C.raw_dir(), 'station.glb')
        result['export'] = (path, C.export_glb(sc, path, vcolors=True))
