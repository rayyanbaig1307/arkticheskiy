# Object 7 (ОБЪЕКТ-7): the 1962 facility under Severny's ice cap. Exported to
# tools/blender/raw/bunker.glb, its own level (src/levels/Level.js loads it).
#
# Frame (Blender): x east, y north, z up; floor 1 at z 0, floor 2 at z -4.5 (whole tiles of the
# painted-concrete texture, so the green dado lines up everywhere). BUNKER_info's extras give its
# place in the station's frame (the drilling shed's shaft comes down into the fan room).
#
#   floor 1  the fan room under Shaft 3, the guard post, corridor A: the kitchen and the canteen,
#            the barracks, the washroom, the commandant's office, the archive; to the south the
#            exchange, the armoury, the infirmary, the stairs; west, the garage and the vehicle
#            tunnel up to the old portal on the cap's flank
#   floor 2  corridor B under it: the cryo hall, Shtern's lab, the pump room, the store, the
#            reactor hall; east, Sector G's blast door and the ice cave of the Guest
#
# Nodes for the game (the level contract, CONTRACTS.md):
#   R_<room>, R_<room>_s     a room's geometry (the _s part: small things, no shadows)
#   COL_<room>               its collision (hidden)
#   ZONE_<room>              an empty at the room's centre: extras size [x, y, z], ambience, floor
#   LMP_<name>               lamps: color, power, range, flicker, group ('main' needs the power on,
#                            'emerg' the red emergency lamps, always on)
#   DOOR_<name>              a door leaf, origin on its hinge: open (deg), kind, lock, label
#   BLAST_<name>             a blast door: kind, lock
#   HIDE_<name>              a hiding place (a locker): the eye inside it, facing out
#   ITEM_<n>                 a pickup's place: item (a suggestion the story may change), count
#   DOC_<id>                 where a document lies (its id from src/story/Documents.js)
#   USE_<name>               something to use: hint, action
#   SPAWN_<n>                a creature's place: kind, state, pose
#   TRIG_<name>              a trigger box: size
#   LADDER_<name>            a climb: from, to (z), x, y
#   PILLAR_<n>               the cave's three ice pillars (the thermite's targets)
#   GUEST_*                  the Guest's parts (the game animates them)
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

F1, F2 = 0.0, -4.5
WT = 0.3                         # wall thickness (each room builds its half)
STATION_OFFSET = (20.0, 222.0, 12.0)   # where the bunker's origin sits in the station's frame (inside the ice cap)

# ---------------------------------------------------------------- the plan
# name: (x0, y0, x1, y1, floor z, height, walls, floor, ceiling, ambience)
ROOMS = {
    'fan':       (30, -4, 38, 4, F1, 4.5, 'craw', 'cfloor', 'craw', 'bunker'),
    'guard':     (26, -5.3, 30, -1.3, F1, 3.0, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'corA':      (-30, -1.3, 30, 1.3, F1, 3.0, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'kitchen':   (22, 1.3, 30, 7.3, F1, 3.2, 'tiles', 'cfloor', 'cceil', 'bunker'),
    'canteen':   (8, 1.3, 22, 9.3, F1, 3.4, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'barracks':  (-8, 1.3, 8, 9.3, F1, 3.0, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'wash':      (-14, 1.3, -8, 6.3, F1, 3.0, 'tiles', 'cfloor', 'cceil', 'bunker'),
    'office':    (-22, 1.3, -14, 7.3, F1, 3.2, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'archive':   (-30, 1.3, -22, 9.3, F1, 3.0, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'exchange':  (8, -7.3, 18, -1.3, F1, 3.0, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'armory':    (-2, -6.3, 8, -1.3, F1, 3.0, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'infirmary': (-14, -7.3, -2, -1.3, F1, 3.0, 'tiles', 'cfloor', 'cceil', 'bunker'),
    'stairs':    (18, -9.3, 24, -1.3, F2, 7.5, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'garage':    (-44, -7, -30, 5, F1, 5.0, 'craw', 'cfloor', 'craw', 'bunker'),
    'corB':      (-2, -1.3, 28, 1.3, F2, 3.0, 'cwall', 'cfloor', 'cceil', 'bunker'),
    'cryo':      (2, 1.3, 16, 11.3, F2, 3.9, 'tiles', 'cfloor', 'cceil', 'bunker'),
    'lab':       (16, 1.3, 24, 8.3, F2, 3.6, 'tiles', 'cfloor', 'cceil', 'bunker'),
    'pump':      (0, -8, 8, -1.3, F2, 3.6, 'craw', 'cfloor', 'craw', 'bunker'),
    'store':     (8, -7, 18, -1.3, F2, 3.0, 'craw', 'cfloor', 'craw', 'bunker'),
    'reactor':   (-16, -9, -2, 9, F2, 3.9, 'craw', 'cfloor', 'craw', 'bunker'),
}
# openings left in a room's ceiling: (x0, y0, x1, y1)
CEIL_HOLES = {
    'fan': [(33.7, 0.7, 35.3, 2.3)],
}
# doors: (x, y, z of the floor, width, height, name, kind, open degrees, lock, label)
# a door on a wall along x has its y on that wall; along y, its x
DOORS = [
    (30, 0.0, F1, 2.0, 2.6, 'fan', 'opening', 0, '', ''),
    (28, -1.3, F1, 0.9, 2.05, 'guard', 'steel', 100, '', 'ПОСТ № 1'),
    (25.5, 1.3, F1, 0.9, 2.05, 'kitchen', 'steel', 100, '', 'КУХНЯ'),
    (22, 6.6, F1, 0.9, 2.05, 'kitchen_canteen', 'wood', 100, '', ''),
    (15, 1.3, F1, 1.6, 2.3, 'canteen', 'double', 95, '', 'СТОЛОВАЯ'),
    (0, 1.3, F1, 0.9, 2.05, 'barracks', 'wood', 100, '', 'КАЗАРМА'),
    (-11, 1.3, F1, 0.9, 2.05, 'wash', 'wood', 100, '', 'УМЫВАЛЬНАЯ'),
    (-18, 1.3, F1, 0.9, 2.1, 'office', 'wood_fine', 100, '', 'НАЧАЛЬНИК ОБЪЕКТА'),
    (-26, 1.3, F1, 0.9, 2.05, 'archive', 'steel', 100, '', 'АРХИВ'),
    (-22, 4.3, F1, 0.9, 2.05, 'office_archive', 'wood', 100, '', ''),
    (13, -1.3, F1, 0.9, 2.05, 'exchange', 'steel', 100, '', 'УЗЕЛ СВЯЗИ'),
    (3, -1.3, F1, 0.9, 2.05, 'armory', 'cage', 100, 'key_armory', 'ОРУЖЕЙНАЯ'),
    (-8, -1.3, F1, 0.9, 2.05, 'infirmary', 'wood', 100, '', 'МЕДПУНКТ'),
    (19.3, -1.3, F1, 1.3, 2.2, 'stairs1', 'opening', 0, '', 'ЛЕСТНИЦА'),
    (22.7, -1.3, F2, 1.3, 2.2, 'stairs2', 'opening', 0, '', ''),
    (-30, 0.0, F1, 2.6, 2.8, 'garage', 'opening', 0, '', 'ГАРАЖ'),
    (-37, -7, F1, 6.6, 4.4, 'tunnel', 'opening', 0, '', ''),
    (9, 1.3, F2, 1.4, 2.3, 'cryo', 'double', 95, 'power', ''),
    (20, 1.3, F2, 0.9, 2.05, 'lab', 'steel', 100, '', 'ЛАБОРАТОРИЯ № 2'),
    (4, -1.3, F2, 0.9, 2.05, 'pump', 'steel', 100, '', 'НАСОСНАЯ'),
    (13, -1.3, F2, 0.9, 2.05, 'store', 'steel', 100, '', 'СКЛАД'),
    (-2, 0.0, F2, 2.0, 2.6, 'reactor', 'double_steel', 90, '', 'РЕАКТОРНЫЙ ЗАЛ'),
    (28, 0.0, F2, 2.4, 2.6, 'sectorG', 'opening', 0, '', ''),
]

def door_on(room, d):
    """the side of `room`'s rectangle a door lies on, and its position along that side (the door
    must stand on the room's floor or within its height: the stairwell spans both floors)"""
    x0, y0, x1, y1, fz, h = ROOMS[room][:6]
    x, y, z = d[0], d[1], d[2]
    if not (fz - 0.1 <= z <= fz + h - 1.0): return None
    for side, (fixed, along) in {'s': (y0, 'x'), 'n': (y1, 'x'), 'w': (x0, 'y'), 'e': (x1, 'y')}.items():
        if along == 'x' and abs(y - fixed) < 0.05 and x0 - 0.01 <= x <= x1 + 0.01: return side, x - x0
        if along == 'y' and abs(x - fixed) < 0.05 and y0 - 0.01 <= y <= y1 + 0.01: return side, y - y0
    return None

# ---------------------------------------------------------------- materials
def materials():
    X.SETS.clear()
    t = {
        'cwall': X.get('b_cwall', TS.concrete_wall), 'craw': X.get('b_craw', TS.concrete_raw), 'cfloor': X.get('b_cfloor', TS.concrete_floor),
        'cceil': X.get('b_cceil', TS.concrete_wall, dado=-1.0, seed=71),
        'tiles': X.get('b_tiles', TS.tiles), 'rime': X.get('b_rime', TS.rime), 'cave': X.get('b_cave', TS.cave_ice),
        'wood': X.get('b_wood', X.wood, col=(0.36, 0.22, 0.12), dark=(0.2, 0.11, 0.05), seed=17, varnish=0.35),
        'woodfine': X.get('b_woodfine', X.wood, col=(0.32, 0.16, 0.08), dark=(0.16, 0.07, 0.03), seed=19, varnish=0.18),
        'machine': X.get('b_machine', X.machine_paint), 'steel': X.get('b_steel', X.brushed_steel),
        'door': X.get('b_door', X.steel_paint, (0.33, 0.38, 0.33), 59, 2.0, 1.0, 0.8, 0.7),
        'blanket': X.get('b_blanket', TS.blanket), 'paper': X.get('b_paper', TS.paper),
        'rubber': X.get('b_rubber', X.rubber), 'lino': X.get('b_lino', X.lino, (0.25, 0.1, 0.06)),
    }
    P = X.pbr
    M = {
        'cwall': P('B_Concrete_Painted', t['cwall']), 'craw': P('B_Concrete', t['craw']), 'cfloor': P('B_Floor', t['cfloor']), 'cceil': P('B_Ceiling', t['cceil']),
        'tiles': P('B_Tiles', t['tiles']), 'rime': P('B_Rime', t['rime']), 'cave': P('B_CaveIce', t['cave'], normal_strength=1.5),
        'wood': P('B_Wood', t['wood']), 'woodfine': P('B_Wood_Fine', t['woodfine']),
        'door': P('B_Door_Steel', t['door']), 'blanket': P('B_Blanket', t['blanket']), 'paper': P('B_Paper', t['paper']),
        'green': P('B_Paint_Green', t['machine'], tint=(0.16, 0.26, 0.2)), 'grey': P('B_Paint_Grey', t['machine'], tint=(0.36, 0.38, 0.38)),
        'cream': P('B_Paint_Cream', t['machine'], tint=(0.7, 0.66, 0.55)), 'red': P('B_Paint_Red', t['machine'], tint=(0.55, 0.05, 0.03)),
        'yellow': P('B_Paint_Yellow', t['machine'], tint=(0.75, 0.55, 0.05)), 'black': P('B_Paint_Black', t['machine'], tint=(0.04, 0.04, 0.045)),
        'white': P('B_Paint_White', t['machine'], tint=(0.8, 0.8, 0.78)), 'blue': P('B_Paint_Blue', t['machine'], tint=(0.1, 0.18, 0.32)),
        'olive': P('B_Paint_Olive', t['machine'], tint=(0.22, 0.24, 0.13)),
        'steel': P('B_Steel', t['steel']), 'rubber': P('B_Rubber', t['rubber']), 'lino': P('B_Lino', t['lino']),
        'iron': C.mat('B_Cast_Iron', (0.06, 0.06, 0.065), 0.6, 0.6),
        'brass': C.mat('B_Brass', (0.6, 0.45, 0.18), 0.35, 1.0),
        'chrome': C.mat('B_Chrome', (0.75, 0.75, 0.75), 0.2, 1.0),
        'glass': C.mat('Glass_Bunker', (0.05, 0.07, 0.08), 0.05, 0.0, alpha=0.25),
        'podglass': C.mat('Glass_Frost', (0.62, 0.72, 0.78), 0.35, 0.0, alpha=0.55),
        'frozen': C.mat('B_Frozen_Body', (0.22, 0.26, 0.3), 0.45),
        'cloth_red': C.mat('B_Cloth_Red', (0.45, 0.03, 0.02), 0.9), 'rug': C.mat('B_Rug', (0.18, 0.025, 0.02), 0.95), 'cloth_grey': C.mat('B_Cloth_Grey', (0.22, 0.22, 0.2), 0.95),
        'greatcoat': C.mat('B_Greatcoat', (0.17, 0.16, 0.12), 0.95), 'mattress': C.mat('B_Mattress', (0.42, 0.38, 0.3), 0.95),
        'plate': C.mat('B_Enamel_White', (0.82, 0.82, 0.78), 0.25), 'enamel_green': C.mat('B_Enamel_Green', (0.18, 0.3, 0.22), 0.3),
        'text_w': C.mat('B_Text_White', (0.85, 0.84, 0.8), 0.6), 'text_k': C.mat('B_Text_Black', (0.03, 0.03, 0.03), 0.6),
        'text_r': C.mat('B_Text_Red', (0.6, 0.03, 0.02), 0.6), 'chalk': C.mat('B_Chalk', (0.8, 0.8, 0.76), 0.95),
        'board': C.mat('B_Blackboard', (0.04, 0.06, 0.05), 0.85),
        'lamp_main': C.mat('Lamp_Bunker', (1.0, 0.86, 0.65), 0.4, emit=(1.0, 0.82, 0.58), emit_strength=6.0),
        'lamp_emerg': C.mat('Lamp_Emergency', (1.0, 0.1, 0.05), 0.4, emit=(1.0, 0.08, 0.03), emit_strength=6.0),
        'lamp_dead': C.mat('Lamp_Dead', (0.5, 0.5, 0.45), 0.3, alpha=1.0),
        'dial': C.mat('B_Dial', (0.85, 0.83, 0.75), 0.4), 'needle': C.mat('B_Needle', (0.6, 0.04, 0.02), 0.5),
        'bulb_r': C.mat('Lamp_Pilot_Red', (0.8, 0.05, 0.03), 0.3, emit=(1.0, 0.05, 0.02), emit_strength=3.0),
        'bulb_g': C.mat('Lamp_Pilot_Green', (0.05, 0.6, 0.1), 0.3, emit=(0.1, 1.0, 0.2), emit_strength=2.0),
        'blood': C.mat('Decal_Blood', (0.12, 0.01, 0.01), 0.3),
        'guest': C.mat('Guest_Flesh', (0.02, 0.003, 0.006), 0.16, emit=(0.12, 0.0, 0.02), emit_strength=0.4),
        'col': C.mat('Collision', (1, 0, 1), 1.0),
    }
    return M

# ---------------------------------------------------------------- shells
class Level:
    def __init__(self, sc, M):
        self.sc = sc; self.M = M
        self.g = C.collection(sc, 'GAME')
        self.parts = {}; self.cols = {}
        self.rng = random.Random(7)
    def part(self, room, small=False):
        k = room + ('_s' if small else '')
        if k not in self.parts: self.parts[k] = K.Part('R_' + k, [self.M['cwall']])
        return self.parts[k]
    def col(self, room):
        if room not in self.cols: self.cols[room] = K.Part('COL_' + room, [self.M['col']], self.g)
        return self.cols[room]
    def E(self, name, loc, rot=(0, 0, 0), **ex):
        return C.empty(name, loc, self.g, rot, extras=ex)
    def lamp(self, name, x, y, z, color=(1.0, 0.84, 0.62), power=40, rng=9, flicker=0.0, group='main'):
        return self.E('LMP_' + name, (x, y, z), color=list(color), power=power, range=rng, flicker=flicker, group=group)

def shell(L, name):
    """a room's half of its walls (with the doors' holes), its floor and ceiling (with any opening
    left in it), a skirting, and their collision"""
    x0, y0, x1, y1, z, h, wm, fm, cm, amb = ROOMS[name]
    M = L.M; p = L.part(name); c = L.col(name)
    t = WT / 2
    holes = {'s': [], 'n': [], 'w': [], 'e': []}
    for d in DOORS:
        r = door_on(name, d)
        if r:
            frame = 0.0 if d[6] == 'opening' else 0.12
            holes[r[0]].append((r[1], d[3] + frame, d[2], d[2] + d[4] + frame / 2))
    for w in globals().get('WINDOWS', []):           # (x, y, sill z, width, top z): windows (the station's rooms)
        r = door_on(name, (w[0], w[1], ROOMS[name][4]))
        if r: holes[r[0]].append((r[1], w[3], w[2], w[4]))
    sides = {'s': ((x0, y0 + t / 2), (x1, y0 + t / 2)), 'n': ((x0, y1 - t / 2), (x1, y1 - t / 2)),
             'w': ((x0 + t / 2, y0), (x0 + t / 2, y1)), 'e': ((x1 - t / 2, y0), (x1 - t / 2, y1))}
    for sd, (a, b) in sides.items():
        K.wall(p, a, b, z, z + h, M[wm], holes[sd], t=t)
        K.wall(c, a, b, z, z + h, None, holes[sd], t=t)
        if wm != 'craw':
            K.wall(p, a, b, z, z + 0.1, M['black'] if wm == 'cwall' else M['grey'], [(cc, w, h0 - 0.01, h0 + 0.5) for (cc, w, h0, h1) in holes[sd]], t=t + 0.02)
    frects = [(x0, y0, x1, y1)]
    for (hx0, hy0, hx1, hy1) in globals().get('FLOOR_HOLES', {}).get(name, []):
        frects = [(x0, y0, x1, hy0), (x0, hy1, x1, y1), (x0, hy0, hx0, hy1), (hx1, hy0, x1, hy1)]
    for (a0, b0, a1, b1) in frects:
        if a1 - a0 > 0.01 and b1 - b0 > 0.01:
            p.box(a0, b0, z - 0.3, a1, b1, z, M[fm]); c.box(a0, b0, z - 0.3, a1, b1, z, None)
    rects = [(x0, y0, x1, y1)]
    for (hx0, hy0, hx1, hy1) in CEIL_HOLES.get(name, []):
        rects = [(x0, y0, x1, hy0), (x0, hy1, x1, y1), (x0, hy0, hx0, hy1), (hx1, hy0, x1, hy1)]
    for (a0, b0, a1, b1) in rects:
        if a1 - a0 > 0.01 and b1 - b0 > 0.01:
            p.box(a0, b0, z + h, a1, b1, z + h + 0.3, M[cm]); c.box(a0, b0, z + h, a1, b1, z + h + 0.3, None)
    L.E('ZONE_' + name, ((x0 + x1) / 2, (y0 + y1) / 2, z + h / 2), size=[x1 - x0, y1 - y0, h], ambience=amb, floor=z)

def door(L, d):
    """the door in its frame: a hinged leaf (its own object, origin on the hinge), a pair of them,
    a mesh gate; or a plain opening"""
    x, y, z, w, h, name, kind, deg, lock, label = d
    M = L.M
    on = [(r, door_on(r, d)) for r in ROOMS if door_on(r, d)]
    if not on: return
    along_x = on[0][1][0] in 'sn'
    room = on[0][0]
    if kind != 'opening':
        p = L.part(room)
        rz = 0.0 if along_x else math.pi / 2
        with p.at(x, y, z, rz):
            fw = 0.07
            for sx in (-1, 1):
                p.box(sx * (w / 2 + fw / 2) - fw / 2, -WT / 2 - 0.03, 0, sx * (w / 2 + fw / 2) + fw / 2, WT / 2 + 0.03, h + fw, M['grey'])
            p.box(-w / 2 - fw, -WT / 2 - 0.03, h, w / 2 + fw, WT / 2 + 0.03, h + fw, M['grey'])
            p.box(-w / 2, -WT / 2, -0.01, w / 2, WT / 2, 0.02, M['steel'])
        leaves = [(-w / 2, 1, w)] if kind not in ('double', 'double_steel') else [(-w / 2, 1, w / 2), (w / 2, -1, w / 2)]
        for i, (hx, sgn, lw) in enumerate(leaves):
            dn = 'DOOR_' + name + ('' if len(leaves) == 1 else f'_{i + 1}')
            mat = {'wood': M['wood'], 'wood_fine': M['woodfine'], 'cage': M['grey']}.get(kind, M['door'])
            lp = K.Part(dn, [mat], L.g)
            th = 0.05
            x0_, x1_ = (0.0, lw * sgn) if sgn > 0 else (lw * sgn, 0.0)
            if kind == 'cage':
                for zz in (0.02, h * 0.5, h - 0.06):
                    lp.box(x0_, -0.02, zz, x1_, 0.02, zz + 0.04, mat)
                for xx in (x0_ + 0.01, x1_ - 0.01):
                    lp.box(xx - 0.02, -0.02, 0.02, xx + 0.02, 0.02, h - 0.02, mat)
                nb = int(lw / 0.1)
                for k in range(1, nb):
                    xx = x0_ + k * (x1_ - x0_) / nb
                    lp.box(xx - 0.008, -0.008, 0.02, xx + 0.008, 0.008, h - 0.02, mat)
            else:
                lp.rbox(x0_ + 0.004, -th / 2, 0.01, x1_ - 0.004, th / 2, h - 0.01, mat, r=0.006, segs=1)
                if kind in ('steel', 'double_steel'):
                    for zz in (0.35, h * 0.5, h - 0.35):
                        lp.box(x0_ + 0.06, th / 2, zz - 0.025, x1_ - 0.06, th / 2 + 0.012, zz + 0.025, mat)
                        lp.box(x0_ + 0.06, -th / 2 - 0.012, zz - 0.025, x1_ - 0.06, -th / 2, zz + 0.025, mat)
                    for k in range(int(lw / 0.12)):
                        for zz in (0.06, h - 0.06):
                            lp.cyl(x0_ + 0.06 + k * 0.12, th / 2 + 0.006, zz, 0.008, 0.012, M['steel'], axis='Y', segs=6)
                if kind in ('double', 'double_steel'):
                    cx_ = (x0_ + x1_) / 2
                    lp.cyl(cx_, 0, h * 0.68, 0.14, th + 0.02, M['grey'], axis='Y', segs=20)
                    lp.cyl(cx_, 0, h * 0.68, 0.11, th + 0.03, M['glass'], axis='Y', segs=20)
                if kind in ('wood', 'wood_fine'):
                    for (za, zb) in ((0.15, h * 0.45), (h * 0.55, h - 0.15)):
                        for sy in (th / 2, -th / 2 - 0.006):
                            lp.box(x0_ + 0.1, sy, za, x1_ - 0.1, sy + 0.006, zb, mat)
            hx2 = (lw - 0.08) * sgn
            for sy in (1, -1):
                lp.tube([(hx2, sy * th / 2, 1.02), (hx2, sy * (th / 2 + 0.05), 1.02), (hx2 - sgn * 0.13, sy * (th / 2 + 0.05), 1.02)], 0.011, M['steel'], 6)
                lp.cyl(hx2, sy * (th / 2 + 0.004), 1.02, 0.03, 0.008, M['steel'], axis='Y', segs=10)
            o = lp.done(sharp=40)
            o.location = (x + hx, y, z) if along_x else (x, y + hx, z)
            o.rotation_euler = (0, 0, rz)
            o['open'] = deg * sgn; o['kind'] = kind; o['lock'] = lock; o['label'] = label; o['width'] = lw; o['height'] = h
    if label:
        cor = next((r for r, (sd, _) in on if r.startswith('cor')), None)
        if cor:
            sp = L.part(cor, True)
            sd = door_on(cor, d)[0]
            face = {'s': '+y', 'n': '-y', 'w': '+x', 'e': '-x'}[sd]
            off = {'s': WT / 2 + 0.01, 'n': -WT / 2 - 0.01, 'w': WT / 2 + 0.01, 'e': -WT / 2 - 0.01}[sd]
            K.sign(sp, x if along_x else x + off, y + off if along_x else y, z + h + 0.32, face, label, 0.09, M['white'], M['text_k'])

# ---------------------------------------------------------------- common fittings
def corridor_dress(L, name):
    x0, y0, x1, y1, z, h = ROOMS[name][:6]
    M = L.M; p = L.part(name); s = L.part(name, True)
    zc = z + h
    # pipes along the north side, cable trays along the south, brackets every 2 m
    for k, (r, m, dz) in enumerate(((0.085, M['green'], -0.22), (0.06, M['red'], -0.42), (0.05, M['grey'], -0.58))):
        yy = y1 - WT / 2 - 0.16 - k * 0.02
        K.pipe(p, [(x0 + 0.2, yy, zc + dz), (x1 - 0.2, yy, zc + dz)], r, m, segs=10)
        for xx in np.arange(x0 + 1.0, x1 - 0.5, 2.0):
            p.box(xx - 0.02, y1 - WT / 2 - 0.02, zc + dz - r - 0.02, xx + 0.02, yy + 0.02, zc + dz - r, M['grey'])
    K.cable_tray(s, x0 + 0.2, y0 + WT / 2 + 0.25, x1 - 0.2, y0 + WT / 2 + 0.25, zc - 0.05, M['grey'], M['black'], w=0.28, n=6)
    # lamps: caged bulkhead lamps on the ceiling every 5 m (a few dead), the light points every 10
    for i, xx in enumerate(np.arange(x0 + 2.5, x1 - 1.0, 5.0)):
        dead = L.rng.random() < 0.25
        K.cage_lamp(s, xx, 0.0, zc, M['grey'], M['lamp_dead'] if dead else M['lamp_main'], M['grey'], axis='Z', r=0.08)
        if i % 2 == 0 and not dead:
            L.lamp(f'{name}_{i}', xx, 0.0, zc - 0.3, power=28, rng=10, flicker=0.15 if L.rng.random() < 0.3 else 0.0)
    # red emergency lamps over the doors' side every 10 m (always on: the facility's own last power)
    for i, xx in enumerate(np.arange(x0 + 6.0, x1 - 1.0, 12.0)):
        K.cage_lamp(s, xx, y0 + WT / 2, zc - 0.5, M['grey'], M['lamp_emerg'], M['grey'], axis='+y', r=0.06)
        L.lamp(f'{name}_emerg{i}', xx, y0 + WT / 2 + 0.3, zc - 0.6, color=(1.0, 0.12, 0.05), power=6, rng=7, group='emerg')
    frost(L, name)

def lump(part, cx, cy, cz, rx, ry, rz, m, segs=10, rings=6, rot=0.0):
    """an ellipsoid (a drift, a lump of ice), turned about z"""
    bm = part.bm
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    vs = res['verts']
    bmesh.ops.scale(bm, vec=(rx, ry, rz), verts=vs)
    if rot: bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'))
    bmesh.ops.translate(bm, vec=(cx, cy, cz), verts=vs)
    faces = list({f for v in vs for f in v.link_faces})
    for f in faces: f.material_index = part.mi(m)
    part._xf(faces)
    return faces

def frost(L, name, amount=1.0):
    """ice: drifts and lumps along the foot of the walls (half sunk in the floor), icicles off the
    pipes and the ceiling, frozen drips down the walls"""
    x0, y0, x1, y1, z, h = ROOMS[name][:6]
    M = L.M; s = L.part(name, True); rng = L.rng
    t = WT / 2
    def along(a, b, inward):
        L_, ux, uy, rz = K.wall_dir(a, b)
        n = int(L_ / 0.5)
        for k in range(n):
            if rng.random() > 0.7 * amount: continue
            u = (k + rng.random()) * L_ / n
            px, py = a[0] + ux * u, a[1] + uy * u
            ww, dd, hh = rng.uniform(0.25, 0.7), rng.uniform(0.08, 0.22), rng.uniform(0.05, 0.16)
            lump(s, px + inward[0] * dd * 0.3, py + inward[1] * dd * 0.3, z - hh * 0.25, ww, dd, hh, M['rime'], rot=rz)
            if rng.random() < 0.35:                                      # (a second, smaller one on it)
                lump(s, px + inward[0] * dd * 0.2 + ux * ww * 0.3, py + inward[1] * dd * 0.2 + uy * ww * 0.3, z + hh * 0.4, ww * 0.5, dd * 0.6, hh * 0.6, M['rime'], rot=rz)
    along((x0 + t, y0 + t), (x1 - t, y0 + t), (0, 1)); along((x0 + t, y1 - t), (x1 - t, y1 - t), (0, -1))
    along((x0 + t, y0 + t), (x0 + t, y1 - t), (1, 0)); along((x1 - t, y0 + t), (x1 - t, y1 - t), (-1, 0))
    # icicles: off the ceiling's edges and the pipes, in clusters
    n = int((x1 - x0) * (y1 - y0) * 0.12 * amount)
    for k in range(n):
        if rng.random() < 0.55:
            px = rng.uniform(x0 + 0.3, x1 - 0.3); py = y1 - t - 0.16; ztop = z + h - 0.3
        else:
            px = rng.uniform(x0 + 0.3, x1 - 0.3); py = rng.uniform(y0 + 0.3, y1 - 0.3); ztop = z + h
        for j in range(rng.randint(1, 4)):
            ln = rng.uniform(0.05, 0.4) ** 1.3
            s.cyl(px + rng.uniform(-0.08, 0.08), py + rng.uniform(-0.03, 0.03), ztop - ln / 2, 0.002, ln, M['rime'], segs=6, r2=rng.uniform(0.01, 0.026))
    # frozen drips down the walls: a run of lumps from the ceiling, thinning as it falls
    for k in range(int(((x1 - x0) + (y1 - y0)) * 0.1 * amount)):
        wall = rng.choice('snwe')
        if wall in 'sn':
            px = rng.uniform(x0 + 0.5, x1 - 0.5); py = (y0 + t) if wall == 's' else (y1 - t); ax = (1, 0)
        else:
            py = rng.uniform(y0 + 0.5, y1 - 0.5); px = (x0 + t) if wall == 'w' else (x1 - t); ax = (0, 1)
        hh = rng.uniform(0.6, h - 0.3); w0 = rng.uniform(0.08, 0.22); zz = z + h - 0.05
        steps = int(hh / 0.12)
        for j in range(steps):
            f = 1 - j / steps
            ww = w0 * (0.35 + 0.65 * f) * rng.uniform(0.8, 1.15)
            lump(s, px + ax[0] * rng.uniform(-0.02, 0.02), py + ax[1] * rng.uniform(-0.02, 0.02), zz - j * 0.12, ww if ax[0] else 0.018, ww if ax[1] else 0.018, 0.09, M['rime'], segs=8, rings=5)

def poster(L, room, x, y, z, face, lines, w, h, ground, ink, border=None, size=0.07):
    s = L.part(room, True)
    with s.at(x, y, z, K.FACE[face]):
        s.box(-w / 2, 0, -h / 2, w / 2, 0.004, h / 2, ground)
        if border is not None:
            s.box(-w / 2 + 0.02, 0.0042, -h / 2 + 0.02, w / 2 - 0.02, 0.0045, -h / 2 + 0.035, border)
            s.box(-w / 2 + 0.02, 0.0042, h / 2 - 0.035, w / 2 - 0.02, 0.0045, h / 2 - 0.02, border)
        n = len(lines)
        for i, (txt, sz, m) in enumerate(lines):
            zz = (n - 1) / 2 * size * 1.6 - i * size * 1.6 if sz is None else ((n - 1) / 2 - i) * (sz * 1.5)
            with s.at(0, 0, zz):
                K.text_flat(s, txt, sz or size, m or ink, y=0.005)

def red_star(L, room, x, y, z, face, r=0.22):
    s = L.part(room, True)
    with s.at(x, y, z, K.FACE[face]):
        pts = []
        for k in range(10):
            a = math.pi / 2 + k * math.pi / 5
            rr = r if k % 2 == 0 else r * 0.4
            pts.append((math.cos(a) * rr, math.sin(a) * rr))
        bm = s.bm; mi = s.mi(L.M['red'])
        fr = [bm.verts.new(s.P((px, 0.03, pz))) for px, pz in pts]
        bk = [bm.verts.new(s.P((px, 0.0, pz))) for px, pz in pts]
        c = bm.verts.new(s.P((0, 0.06, 0)))
        for k in range(10):
            k1 = (k + 1) % 10
            f = bm.faces.new((fr[k], fr[k1], c)); f.material_index = mi
            f = bm.faces.new((bk[k], bk[k1], fr[k1], fr[k])); f.material_index = mi

# ---------------------------------------------------------------- furniture
def table(p, M, x0, y0, x1, y1, z, top=None, leg=None, h=0.76):
    p.rbox(x0, y0, z + h - 0.04, x1, y1, z + h, top or M['wood'], r=0.01, segs=1)
    for (lx, ly) in ((x0 + 0.06, y0 + 0.06), (x1 - 0.06, y0 + 0.06), (x0 + 0.06, y1 - 0.06), (x1 - 0.06, y1 - 0.06)):
        p.box(lx - 0.025, ly - 0.025, z, lx + 0.025, ly + 0.025, z + h - 0.04, leg or M['wood'])
    if x1 - x0 > y1 - y0:
        p.box(x0 + 0.06, (y0 + y1) / 2 - 0.015, z + 0.15, x1 - 0.06, (y0 + y1) / 2 + 0.015, z + 0.19, leg or M['wood'])

def bench(p, M, x0, y0, x1, y1, z, h=0.45):
    p.rbox(x0, y0, z + h - 0.04, x1, y1, z + h, M['wood'], r=0.008, segs=1)
    for lx in (x0 + 0.08, x1 - 0.08):
        p.box(lx - 0.02, y0 + 0.03, z, lx + 0.02, y1 - 0.03, z + h - 0.04, M['wood'])

def chair(p, M, x, y, z, rz=0.0, m=None, fallen=False):
    m = m or M['wood']
    with p.at(x, y, z, rz, rx=(math.pi / 2 if fallen else 0.0)):
        zz = 0.0 if not fallen else 0.2
        p.rbox(-0.21, -0.2, 0.43, 0.21, 0.2, 0.46, m, r=0.006, segs=1)
        for (lx, ly) in ((-0.18, -0.17), (0.18, -0.17), (-0.18, 0.17), (0.18, 0.17)):
            p.box(lx - 0.016, ly - 0.016, 0, lx + 0.016, ly + 0.016, 0.43, m)
        for lx in (-0.18, 0.18):
            p.box(lx - 0.016, 0.17 - 0.016, 0.46, lx + 0.016, 0.17 + 0.016, 0.92, m)
        p.rbox(-0.2, 0.15, 0.68, 0.2, 0.19, 0.9, m, r=0.006, segs=1)

def bunk(p, M, x, y, z, rz, rng):
    """a two-tier army bunk: a steel tube frame, mattresses, grey blankets, pillows"""
    with p.at(x, y, z, rz):
        L_, W_ = 1.95, 0.8
        for (lx, ly) in ((-L_ / 2, -W_ / 2), (L_ / 2, -W_ / 2), (-L_ / 2, W_ / 2), (L_ / 2, W_ / 2)):
            p.cyl(lx, ly, 0.85, 0.02, 1.7, M['blue'], segs=8)
        for zz in (0.38, 1.28):
            for ly in (-W_ / 2, W_ / 2): p.cyl(0, ly, zz, 0.016, L_, M['blue'], axis='X', segs=8)
            for lx in (-L_ / 2, L_ / 2): p.cyl(lx, 0, zz, 0.016, W_, M['blue'], axis='Y', segs=8)
            p.box(-L_ / 2, -W_ / 2, zz - 0.01, L_ / 2, W_ / 2, zz, M['grey'])
            p.rbox(-L_ / 2 + 0.03, -W_ / 2 + 0.03, zz, L_ / 2 - 0.03, W_ / 2 - 0.03, zz + 0.12, M['mattress'], r=0.04, segs=2)
            if rng.random() < 0.8:
                # the blanket, tucked, its fold, and the pillow
                p.rbox(-L_ / 2 + 0.25, -W_ / 2 + 0.01, zz + 0.1, L_ / 2 - 0.02, W_ / 2 - 0.01, zz + 0.15, M['blanket'], r=0.03, segs=2)
                p.rbox(-L_ / 2 + 0.05, -W_ / 2 + 0.08, zz + 0.12, -L_ / 2 + 0.42, W_ / 2 - 0.08, zz + 0.22, M['plate'], r=0.05, segs=2)
        p.box(L_ / 2 - 0.02, -W_ / 2, 0.38, L_ / 2 + 0.02, W_ / 2, 0.9, M['blue'])

def locker(L, room, x, y, z, face, name=None, open_=False):
    """a tall steel locker (a HIDE_ place when named), its louvres, the door's handle"""
    p = L.part(room); M = L.M
    with p.at(x, y, z, K.FACE[face]):
        p.rbox(-0.3, 0, 0, 0.3, 0.5, 1.9, M['olive'], r=0.008, segs=1)
        p.box(-0.29, 0.5, 0.02, 0.29, 0.51, 1.88, M['olive'])
        for k in range(5):
            p.box(-0.15, 0.511, 1.55 + k * 0.05, 0.15, 0.516, 1.57 + k * 0.05, M['black'])
        p.box(0.2, 0.511, 0.95, 0.23, 0.53, 1.1, M['steel'])
    if name:
        a = K.FACE[face]
        ex, ey = x + math.sin(-a) * 0.25, y + math.cos(a) * 0.25
        L.E('HIDE_' + name, (ex, ey, z + 1.55), (0, 0, a), room=room)

def shelf_unit(p, M, x0, x1, y, z, h, depth, face, n=5, m=None, stuff=None, rng=None):
    with p.at(x0 if face in ('+y', '-y') else y, y if face in ('+y', '-y') else x0, z, K.FACE[face]):
        L_ = x1 - x0
        m = m or M['grey']
        for xx in (0, L_):
            p.box(-xx - 0.02, 0, 0, -xx + 0.02, depth, h, m)
        for k in range(n):
            zz = 0.1 + k * (h - 0.15) / (n - 1)
            p.box(-L_, 0, zz, 0, depth, zz + 0.02, m)
            if stuff and k < n - 1:
                stuff(p, -L_, 0, zz + 0.02, depth, (h - 0.15) / (n - 1) - 0.05, rng)

def folders(p, x0, x1, z, depth, hh, rng, M):
    xx = x0 + 0.04
    while xx < x1 - 0.06:
        w = rng.uniform(0.04, 0.09)
        if rng.random() < 0.12: xx += w; continue
        hh_ = hh * rng.uniform(0.7, 0.98)
        m = rng.choice((M['cream'], M['grey'], M['paper'], M['olive']))
        lean = 0.0 if rng.random() < 0.85 else rng.uniform(-0.25, 0.25)
        with p.at(xx + w / 2, depth * 0.5, z, ry=lean):
            p.box(-w / 2, -depth * 0.42, 0, w / 2, depth * 0.42, hh_, m)
        xx += w + 0.004

def crate(p, M, x, y, z, w, d, h, rz=0.0, label=None, m=None):
    with p.at(x, y, z, rz):
        p.box(-w / 2, -d / 2, 0, w / 2, d / 2, h, m or M['olive'], bevel=0.008)
        for zz in (0.04, h - 0.04):
            p.box(-w / 2 - 0.006, -d / 2 - 0.006, zz - 0.025, w / 2 + 0.006, d / 2 + 0.006, zz + 0.025, m or M['olive'])
        if label:
            with p.at(0, d / 2, h * 0.55):
                K.text_flat(p, label, min(0.07, h * 0.2), M['text_k'], y=0.002)

def panel_dials(p, M, x0, x1, z0, z1, rng, n=4):
    """an instrument panel face (local frame, the wall at y = 0): gauges, pilot lamps, switches"""
    p.box(x0, 0, z0, x1, 0.03, z1, M['grey'])
    W_ = x1 - x0
    for i in range(n):
        gx = x0 + W_ * (i + 0.5) / n
        K.gauge(p, gx, 0.03, z1 - 0.18, '+y', 0.07, M['black'], M['dial'], M['glass'], M['needle'], a=rng.uniform(-2, 2))
        p.cyl(gx - 0.05, 0.035, z1 - 0.36, 0.014, 0.02, rng.choice((M['bulb_r'], M['bulb_g'], M['lamp_dead'])), axis='Y', segs=8)
        p.cyl(gx + 0.05, 0.035, z1 - 0.36, 0.014, 0.02, rng.choice((M['bulb_r'], M['lamp_dead'])), axis='Y', segs=8)
        p.box(gx - 0.012, 0.03, z1 - 0.5, gx + 0.012, 0.07, z1 - 0.47, M['black'])

def desk(p, M, x, y, z, rz, m=None, drawers=True):
    m = m or M['wood']
    with p.at(x, y, z, rz):
        p.rbox(-0.65, -0.35, 0.74, 0.65, 0.35, 0.78, m, r=0.01, segs=1)
        p.box(-0.63, -0.33, 0, -0.2, 0.33, 0.74, m)
        if drawers:
            for k in range(3):
                p.rbox(-0.61, -0.335, 0.08 + k * 0.22, -0.22, -0.32, 0.27 + k * 0.22, m, r=0.004, segs=1)
                p.cyl(-0.415, -0.34, 0.2 + k * 0.22, 0.008, 0.02, M['brass'], axis='Y', segs=8)
        for (lx, ly) in ((0.6, -0.3), (0.6, 0.3)):
            p.box(lx - 0.025, ly - 0.025, 0, lx + 0.025, ly + 0.025, 0.74, m)
        p.box(-0.2, 0.31, 0.3, 0.6, 0.33, 0.72, m)

def papers(p, M, x, y, z, rng, n=6, spread=0.3):
    for k in range(n):
        with p.at(x + rng.uniform(-spread, spread), y + rng.uniform(-spread, spread), z + 0.001 * k, rng.uniform(0, math.pi)):
            p.box(-0.105, -0.148, 0, 0.105, 0.148, 0.002, M['paper'])

def body_silhouette(p, M, x, y, z, rz, pose='stand', m=None, scale=1.0):
    """a frozen person, simple (inside frosted glass, in the ice: the shape is enough)"""
    m = m or M['frozen']
    with p.at(x, y, z, rz):
        s = scale
        if pose == 'stand':
            p.sphere(0, 0, 1.62 * s, 0.11 * s, m, segs=10, rings=7, sz=1.15)
            p.cyl(0, 0, 1.47 * s, 0.05 * s, 0.12 * s, m, segs=8)
            p.tube([(0, 0, 1.4 * s), (0, 0.01, 1.1 * s), (0, 0, 0.95 * s)], 0.15 * s, m, 10)
            for sx in (-1, 1):
                p.tube([(sx * 0.18 * s, 0, 1.38 * s), (sx * 0.22 * s, 0.02, 1.08 * s), (sx * 0.2 * s, 0.05, 0.82 * s)], 0.045 * s, m, 7)
                p.tube([(sx * 0.09 * s, 0, 0.92 * s), (sx * 0.1 * s, 0.02, 0.5 * s), (sx * 0.1 * s, 0, 0.08 * s)], 0.065 * s, m, 7)
        else:   # reaching out of the ice: a head, shoulders, an arm
            p.sphere(0, 0.05, 0.25 * s, 0.11 * s, m, segs=10, rings=7, sz=1.1)
            p.tube([(-0.2 * s, -0.05, 0.05 * s), (0, 0, 0.1 * s), (0.2 * s, -0.05, 0.05 * s)], 0.08 * s, m, 8)
            p.tube([(0.2 * s, -0.05, 0.05 * s), (0.35 * s, 0.2, 0.25 * s), (0.42 * s, 0.4, 0.45 * s)], 0.04 * s, m, 7)

# ---------------------------------------------------------------- the rooms
def r_fan(L):
    """the fan room under Shaft 3: the shaft's mouth in the ceiling, the ladder down, the great
    fan in its duct (stopped), louvres, ice blown in"""
    x0, y0, x1, y1, z, h = ROOMS['fan'][:6]
    M = L.M; p = L.part('fan'); s = L.part('fan', True); c = L.col('fan')
    sx, sy = 34.5, 1.5
    # the shaft: a square concrete flue 1.6 m inside, rising 14 m (the game fades the rest)
    for (a, b) in (((sx - 0.95, sy - 0.95), (sx + 0.95, sy - 0.95)), ((sx - 0.95, sy + 0.95), (sx + 0.95, sy + 0.95)), ((sx - 0.95, sy - 0.95), (sx - 0.95, sy + 0.95)), ((sx + 0.95, sy - 0.95), (sx + 0.95, sy + 0.95))):
        K.wall(p, a, b, z + h, z + h + 14, M['craw'], t=0.3)
    K.ladder_rungs(p, sx, sy + 0.78, z, z + h + 13.5, M['steel'], facing='y', w=0.5)
    L.E('LADDER_shaft3', (sx, sy + 0.6, z), x=sx, y=sy + 0.6, **{'from': z, 'to': z + h + 13.5}, top='surface')
    s.box(sx - 0.95, sy - 0.95, z + h + 13.9, sx + 0.95, sy + 0.95, z + h + 14.0, M['rime'])
    K.sign(s, sx, sy - 0.8, z + h + 0.9, '+y', 'ШАХТА № 3', 0.12, M['yellow'], M['text_k'])
    # the hole in the ceiling (cut by covering: the ceiling slab is split round it)
    # (the shell already made a whole ceiling: the shaft walls sit on it; the game needs it open,
    # so the ceiling over the shaft is left out of the collision: see shell_fan_ceiling)
    # the fan: a 2.4 m duct ring in the east wall, the blades, the motor
    fx, fz = x1 - WT / 2 - 0.5, z + 2.1
    p.torus(fx, -1.5, fz, 1.2, 0.12, M['grey'], axis='X', segs=32, rsegs=8)
    p.cyl(fx + 0.2, -1.5, fz, 1.2, 0.9, M['grey'], axis='X', segs=32, cap=False)
    p.cyl(fx - 0.1, -1.5, fz, 0.28, 0.5, M['black'], axis='X', segs=16)
    for k in range(6):
        a = k * math.pi / 3 + 0.2
        with p.at(fx - 0.1, -1.5, fz, rx=a):
            p.box(-0.04, -0.12, 0.25, 0.04, 0.12, 1.12, M['grey'], bevel=0.01)
    for zz in (fz - 1.25, fz + 1.25):
        p.box(fx - 0.3, -2.8, zz - 0.06, fx + 0.3, -0.2, zz + 0.06, M['grey'])
    s.box(fx - 0.05, -2.75, fz - 1.15, fx + 0.04, -0.25, fz + 1.15, M['rime'])          # (ice in the duct)
    K.sign(s, x1 - WT / 2, 1.6, z + 3.4, '-x', 'ВЕНТИЛЯЦИЯ', 0.09, M['white'], M['text_k'], sub='ВЕНТИЛЯТОР В-3')
    # a duct across the ceiling, a control box, the fan's switch (dead)
    p.box(x0 + 0.5, -3.2, z + h - 0.9, x1 - 1.6, -2.2, z + h - 0.2, M['grey'], bevel=0.02)
    with p.at(x0 + WT / 2, -2.4, z + 1.2, K.FACE['+x']):
        K.box_panel(p, -0.3, 0.3, 0, 0.6, 0.18, M['grey'], M['grey'], M['steel'])
    L.lamp('fan_1', 33.0, -1.0, z + h - 0.4, power=20, rng=8, flicker=0.4)
    K.cage_lamp(s, 33.0, -1.0, z + h, M['grey'], M['lamp_main'], M['grey'])
    frost(L, 'fan', 1.6)
    # snow and ice blown down the shaft, a heap under it
    for k in range(18):
        r_ = L.rng.uniform(0.15, 0.5)
        s.sphere(sx + L.rng.uniform(-0.8, 0.8), sy + L.rng.uniform(-0.8, 0.5), z + r_ * 0.3, r_, M['rime'], segs=10, rings=6, sz=0.35)
    L.E('SPOT_bunker_arrive', (sx, sy, z + 0.05), (0, 0, math.pi))
    L.E('TRIG_bunker_arrive', (sx - 1.5, 0, z + 1.2), size=[3, 4, 2.4])

def r_guard(L):
    x0, y0, x1, y1, z, h = ROOMS['guard'][:6]
    M = L.M; p = L.part('guard'); s = L.part('guard', True)
    desk(p, M, 28.0, -4.2, z, 0.0)
    chair(p, M, 28.2, -3.4, z, math.pi + 0.3)
    s.box(27.6, -4.4, z + 0.78, 27.9, -4.2, z + 0.86, M['black'])                       # a field telephone
    s.cyl(27.75, -4.3, z + 0.9, 0.025, 0.25, M['black'], axis='X', segs=8)
    with p.at(x0 + WT / 2, -3.3, z, K.FACE['+x']):
        # the rifle rack: empty but for one
        p.box(-0.8, 0, 0.1, 0.8, 0.25, 0.14, M['wood'])
        p.box(-0.8, 0, 1.15, 0.8, 0.08, 1.25, M['wood'])
        for k in range(6):
            p.box(-0.7 + k * 0.28 - 0.02, 0.08, 1.15, -0.7 + k * 0.28 + 0.02, 0.18, 1.25, M['wood'])
    K.sign(s, x1 - WT / 2 - 0.01, -3.0, z + 2.2, '-x', 'ПОСТ № 1', 0.1, M['red'], M['text_w'])
    poster(L, 'guard', x1 - WT / 2 - 0.01, -4.3, z + 1.5, '-x', [('ПРИКАЗ № 41', 0.045, M['text_k']), ('НАЧАЛЬНИКА ОБЪЕКТА', 0.03, M['text_k']), ('· · ·', 0.03, M['text_k'])], 0.3, 0.42, M['paper'], M['text_k'])
    L.E('DOC_ch4_order_41', (x1 - WT / 2 - 0.05, -4.3, z + 1.5))
    L.lamp('guard_1', 28, -3.3, z + h - 0.3, power=14, rng=6)
    K.cage_lamp(s, 28, -3.3, z + h, M['grey'], M['lamp_main'], M['grey'])
    L.E('ITEM_guard_1', (27.4, -4.2, z + 0.8), item='battery', count=1)
    frost(L, 'guard', 0.8)

def r_corA(L):
    corridor_dress(L, 'corA')
    M = L.M; z = F1
    red_star(L, 'corA', 15.0, 1.3 - WT / 2 - 0.01, z + 2.95, '-y', 0.2)
    red_star(L, 'corA', -18.0, 1.3 - WT / 2 - 0.01, z + 2.75, '-y', 0.16)
    poster(L, 'corA', 3.5, 1.3 - WT / 2 - 0.012, z + 1.65, '-y', [('ЧТО УСЛЫШАЛ ЗДЕСЬ —', 0.06, M['text_w']), ('ОСТАВЬ ЗДЕСЬ!', 0.08, M['text_w'])], 0.7, 0.9, M['red'], M['text_w'], border=M['black'])
    L.E('DOC_ch4_poster_secrecy', (3.5, 1.3 - WT / 2 - 0.05, z + 1.65))
    poster(L, 'corA', -19.6, 1.3 - WT / 2 - 0.012, z + 1.6, '-y', [('12 АПРЕЛЯ 1961', 0.07, M['red']), ('ЧЕЛОВЕК В КОСМОСЕ!', 0.05, M['text_k']), ('СЛАВА ЮРИЮ ГАГАРИНУ!', 0.035, M['text_k'])], 0.65, 0.9, M['paper'], M['text_k'], border=M['red'])
    s = L.part('corA', True)
    with s.at(-19.6, 1.3 - WT / 2 - 0.014, z + 1.85, K.FACE['-y']):
        s.sphere(0, 0.0, 0.0, 0.11, M['red'], segs=14, rings=8, sz=1.0)                    # (the helmet: СССР)
        K.text_flat(s, 'СССР', 0.035, M['text_w'], y=0.1)
    L.E('DOC_ch4_poster_gagarin', (-19.6, 1.3 - WT / 2 - 0.05, z + 1.6))
    K.sign(s, 29.7 - WT / 2, 0.0, z + 2.3, '-x', 'ОБЪЕКТ-7', 0.14, M['red'], M['text_w'], sub='СЕКТОР «А»')
    K.sign(s, -29.7 + WT / 2, -0.6, z + 2.3, '+x', 'ВЫХОД НА ПОВЕРХНОСТЬ', 0.08, M['green'], M['text_w'], sub='ЧЕРЕЗ ГАРАЖ')
    # what was left in the corridor: a fallen chair, papers, a dropped cap, frozen blood
    chair(L.part('corA'), M, 9.5, -0.4, z, 0.6, fallen=True)
    papers(s, M, 10.5, 0.2, z, L.rng, 8, 0.6)
    papers(s, M, -6.0, -0.3, z, L.rng, 5, 0.4)
    blood(L, 'corA', -2.0, 0.4, z, 1.2)
    blood(L, 'corA', 17.0, -0.6, z, 0.8)
    L.E('SPAWN_corA_1', (-12.0, 0.0, z), kind='turned_c', state='wander', points=[[-25, 0], [5, 0]])
    L.E('TRIG_corA_canteen', (15.0, 0.0, z + 1.2), size=[3, 2.6, 2.4])

def blood(L, room, x, y, z, size, wall=None):
    s = L.part(room, True); rng = L.rng
    for k in range(int(5 + size * 6)):
        r_ = size * rng.uniform(0.05, 0.25)
        dx, dy = rng.gauss(0, size * 0.3), rng.gauss(0, size * 0.3)
        s.cyl(x + dx, y + dy, z + 0.002 + k * 0.0002, r_, 0.003, L.M['blood'], segs=10)

def r_kitchen(L):
    x0, y0, x1, y1, z, h = ROOMS['kitchen'][:6]
    M = L.M; p = L.part('kitchen'); s = L.part('kitchen', True)
    # the range: a long cast-iron stove, its hotplates, the flue
    p.rbox(23.0, y1 - WT / 2 - 0.9, z, 27.5, y1 - WT / 2, z + 0.85, M['iron'], r=0.02, segs=2)
    for k in range(4):
        s.cyl(23.6 + k * 1.1, y1 - WT / 2 - 0.45, z + 0.86, 0.22, 0.02, M['black'], segs=20)
    for k, xx in enumerate((23.6, 24.8, 26.2)):
        s.cyl(xx, y1 - WT / 2 - 0.45, z + 1.05, 0.2 + 0.05 * k, 0.36, M['grey'], segs=18, cap=True)       # pots
    p.box(25.0, y1 - WT / 2 - 0.5, z + 0.85, 25.4, y1 - WT / 2 - 0.1, z + h, M['iron'])
    # the sink, the shelves of tins, the meat store (its door: a place to hide)
    p.box(x1 - WT / 2 - 0.7, 2.0, z + 0.8, x1 - WT / 2, 3.4, z + 0.9, M['steel'])
    def tins(pp, a, b, zz, depth, hh, rng):
        xx = a + 0.05
        while xx < b - 0.08:
            r_ = rng.uniform(0.04, 0.06)
            pp.cyl(xx + r_, depth * 0.5, zz + hh * 0.3, r_, hh * 0.6, rng.choice((M['grey'], M['red'], M['green'], M['cream'])), segs=10)
            xx += r_ * 2 + 0.01
    shelf_unit(p, M, 2.4, 4.2, x1 - WT / 2, z, 1.9, 0.35, '-x', 5, stuff=tins, rng=L.rng)
    locker(L, 'kitchen', 23.5, y0 + WT / 2, z, '+y', name='kitchen')
    table(p, M, 23.5, 3.0, 26.5, 4.0, z, top=M['steel'], leg=M['grey'], h=0.85)
    s.cyl(24.0, 3.5, z + 0.95, 0.15, 0.2, M['plate'], segs=16)
    K.fluoro(s, 26.0, 4.3, z + h, 1.2, 0.25, M['grey'], M['lamp_main'], along='x')
    L.lamp('kitchen_1', 26.0, 4.3, z + h - 0.3, power=16, rng=7, flicker=0.3)
    frost(L, 'kitchen', 1.0)

def r_canteen(L):
    """the canteen: as they left it (plates on the tables, spoons in the plates), the banner over
    the serving line, the garrison's dead at one table"""
    x0, y0, x1, y1, z, h = ROOMS['canteen'][:6]
    M = L.M; p = L.part('canteen'); s = L.part('canteen', True); rng = L.rng
    for row, yy in enumerate((3.4, 5.6, 7.8)):
        for col_, (xa, xb) in enumerate(((9.2, 12.6), (13.4, 16.8))):
            table(p, M, xa, yy - 0.4, xb, yy + 0.4, z)
            bench(p, M, xa + 0.1, yy - 0.9, xb - 0.1, yy - 0.62, z)
            bench(p, M, xa + 0.1, yy + 0.62, xb - 0.1, yy + 0.9, z)
            for k in range(4):
                for sgn in (-1, 1):
                    if rng.random() < 0.15: continue
                    px, py = xa + 0.45 + k * 0.82, yy + sgn * 0.22
                    s.cyl(px, py, z + 0.77, 0.12, 0.012, M['plate'], segs=16)
                    s.cyl(px, py, z + 0.784, 0.085, 0.004, M['rime'] if rng.random() < 0.5 else M['cream'], segs=14)     # (soup, frozen)
                    with s.at(px + 0.06, py, z + 0.79, rng.uniform(-0.5, 0.5)):
                        s.box(-0.004, -0.09, 0, 0.004, 0.02, 0.004, M['chrome']); s.sphere(0, 0.04, 0.003, 0.02, M['chrome'], segs=8, rings=4, sz=0.3)
                    if rng.random() < 0.5:
                        s.cyl(px - 0.16, py - sgn * 0.08, z + 0.81, 0.04, 0.09, M['enamel_green'], segs=12)
            s.cyl((xa + xb) / 2, yy, z + 0.82, 0.07, 0.1, M['chrome'], segs=12)        # (the bread tin)
    # the serving line along the east wall, its hatch to the kitchen
    p.rbox(x1 - WT / 2 - 0.8, 2.2, z, x1 - WT / 2, 6.0, z + 0.95, M['grey'], r=0.01, segs=1)
    s.box(x1 - WT / 2 - 0.85, 2.2, z + 0.95, x1 - WT / 2, 6.0, z + 0.98, M['steel'])
    for k in range(3):
        s.cyl(x1 - WT / 2 - 0.4, 2.8 + k * 1.3, z + 1.1, 0.18, 0.25, M['steel'], segs=16)
    poster(L, 'canteen', x1 - WT / 2 - 0.012, 4.1, z + 2.55, '-x', [('НЫНЕШНЕЕ ПОКОЛЕНИЕ СОВЕТСКИХ ЛЮДЕЙ', 0.085, M['text_w']), ('БУДЕТ ЖИТЬ ПРИ КОММУНИЗМЕ!', 0.11, M['text_w'])], 4.6, 0.62, M['cloth_red'], M['text_w'])
    with s.at(x1 - WT / 2 - 0.016, 5.2, z + 2.02, K.FACE['-x']):
        K.text_flat(s, 'ДОЖИВЁМ?', 0.12, M['chalk'], y=0.0)
    L.E('DOC_ch4_poster_slogan', (x1 - WT / 2 - 0.05, 4.1, z + 2.4))
    K.picture(s, x0 + WT / 2, 5.3, z + 2.0, '+x', 0.8, 1.0, M['woodfine'], M['black'])        # (a portrait, its face gone dark)
    K.clock(s, (x0 + x1) / 2, y1 - WT / 2, z + 2.6, '-y', 0.18, M['black'], M['dial'], M['black'])
    for i, (xx, yy) in enumerate(((10.9, 5.6), (15.1, 5.6), (12.0, 7.8))):
        K.fluoro(s, xx, yy - 1.1, z + h, 1.2, 0.25, M['grey'], M['lamp_main'] if i != 2 else M['lamp_dead'], along='x')
        if i != 2: L.lamp(f'canteen_{i}', xx, yy - 1.1, z + h - 0.3, power=24, rng=9, flicker=0.1)
    # the garrison's dead at the far table (the game's Turned: sitting, one turns its head)
    for k, (px, sgn) in enumerate(((13.85, -1), (14.67, 1), (15.5, -1), (16.3, 1))):
        L.E(f'SPAWN_canteen_{k + 1}', (px, 7.8 + sgn * 0.76, z), (0, 0, 0.0 if sgn < 0 else math.pi), kind='turned_c', state='dormant', pose='sit', turnhead=(k == 1))
    frost(L, 'canteen', 1.2)
    L.E('ITEM_canteen_1', (x1 - WT / 2 - 0.4, 5.4, z + 1.0), item='ammo_762x39', count=1)

def r_barracks(L):
    x0, y0, x1, y1, z, h = ROOMS['barracks'][:6]
    M = L.M; p = L.part('barracks'); s = L.part('barracks', True); rng = L.rng
    for k in range(5):
        bunk(p, M, x0 + 1.6 + k * 2.6, y1 - WT / 2 - 1.05, z, math.pi / 2, rng)
    for xx in (-6.2, -3.6, 3.2, 5.8):
        bunk(p, M, xx, y0 + WT / 2 + 2.3, z, math.pi / 2, rng)
    for k in range(8):
        locker(L, 'barracks', x1 - WT / 2 - 0.02, y0 + WT / 2 + 0.6 + k * 0.62, z, '-x', name=(f'barracks_{k + 1}' if k in (1, 4, 6) else None))
    # the stove (a burzhuika), its pipe up through the ceiling, the table, the chess game
    p.cyl(-0.5, 5.3, z + 0.4, 0.28, 0.75, M['iron'], segs=16)
    p.cyl(-0.5, 5.3, z + 1.95, 0.07, 2.3, M['iron'], segs=10)
    table(p, M, 1.2, 4.8, 2.6, 5.8, z)
    s.box(1.65, 5.05, z + 0.765, 2.05, 5.45, z + 0.785, M['woodfine'])
    for k in range(10):
        s.cyl(1.7 + (k % 5) * 0.08, 5.1 + (k // 5) * 0.3, z + 0.8, 0.013, 0.04, M['plate'] if k < 5 else M['black'], segs=8)
    chair(p, M, 1.5, 4.4, z, 0.2); chair(p, M, 2.4, 6.2, z, math.pi + 0.4)
    for k in range(6):
        with s.at(x0 + 1.0 + k * 2.4, y1 - WT / 2 - 2.2, z):
            s.box(-0.07, -0.05, 0, 0.07, 0.25, 0.3, M['black']); s.box(0.1, -0.05, 0, 0.24, 0.25, 0.28, M['black'])   # boots
    L.E('DOC_ch4_gusev_letter', (x0 + 1.6 + 2 * 2.6, y1 - WT / 2 - 1.05, z + 0.55), hint='under the mattress')
    for i, xx in enumerate((-4.0, 4.0)):
        K.cage_lamp(s, xx, 5.3, z + h, M['grey'], M['lamp_main'], M['grey'])
        L.lamp(f'barracks_{i}', xx, 5.3, z + h - 0.3, power=18, rng=8, flicker=0.25)
    L.E('SPAWN_barracks_1', (-3.0, 4.0, z), kind='turned_c', state='wander', points=[[-6, 4], [5, 4], [5, 7]])
    L.E('ITEM_barracks_1', (x0 + 1.6, y1 - WT / 2 - 1.05, z + 1.45), item='ammo_762x54', count=1)
    frost(L, 'barracks', 0.9)

def r_wash(L):
    x0, y0, x1, y1, z, h = ROOMS['wash'][:6]
    M = L.M; p = L.part('wash'); s = L.part('wash', True)
    p.box(x0 + 0.4, y1 - WT / 2 - 0.5, z + 0.7, x1 - 0.4, y1 - WT / 2, z + 0.85, M['steel'])
    for k in range(5):
        xx = x0 + 0.9 + k * 1.05
        s.cyl(xx, y1 - WT / 2 - 0.05, z + 1.05, 0.012, 0.15, M['chrome'], axis='Y', segs=8)
        s.box(xx - 0.25, y1 - WT / 2 - 0.02, z + 1.3, xx + 0.25, y1 - WT / 2, z + 1.8, M['black'])        # mirrors (dark)
        s.cyl(xx, y1 - WT / 2 - 0.3, z + 0.86, 0.16, 0.02, M['rime'], segs=12)                            # (ice in the trough)
    for k in range(3):
        xx = x0 + 0.8 + k * 1.3
        p.box(xx + 0.6, y0 + WT / 2, z, xx + 0.64, y0 + 1.6, z + 1.9, M['green'])
        p.box(xx - 0.15, y0 + WT / 2 + 0.6, z, xx + 0.15, y0 + WT / 2 + 1.0, z + 0.4, M['plate'])
    K.cage_lamp(s, -11.0, 3.8, z + h, M['grey'], M['lamp_dead'], M['grey'])
    frost(L, 'wash', 1.4)

def r_office(L):
    """the commandant's office: his desk, the safe, the map of the facility, the portrait, the flag"""
    x0, y0, x1, y1, z, h = ROOMS['office'][:6]
    M = L.M; p = L.part('office'); s = L.part('office', True); rng = L.rng
    # wood panelling to 1.2 m
    for (a, b) in (((x0 + WT / 2 + 0.02, y1 - WT / 2 - 0.02), (x1 - WT / 2 - 0.02, y1 - WT / 2 - 0.02)), ((x1 - WT / 2 - 0.02, y0 + WT / 2), (x1 - WT / 2 - 0.02, y1 - WT / 2))):
        K.wall(p, a, b, z + 0.1, z + 1.2, M['woodfine'], t=0.03)
    p.box(x0 + 1.0, 2.2, z + 0.002, x1 - 1.0, 6.2, z + 0.012, M['rug'])                         # the rug
    for (a0, b0, a1, b1) in ((x0 + 1.15, 2.35, x1 - 1.15, 2.45), (x0 + 1.15, 5.95, x1 - 1.15, 6.05), (x0 + 1.15, 2.35, x0 + 1.25, 6.05), (x1 - 1.25, 2.35, x1 - 1.15, 6.05)):
        s.box(a0, b0, z + 0.012, a1, b1, z + 0.014, M['yellow'])
    desk(p, M, -18.0, 5.6, z, math.pi, m=M['woodfine'])
    chair(p, M, -18.0, 6.35, z, math.pi, m=M['woodfine'])
    s.box(-18.5, 5.4, z + 0.78, -18.2, 5.7, z + 0.85, M['black'])                               # the telephone
    s.cyl(-17.4, 5.7, z + 0.79, 0.07, 0.02, M['brass'], segs=12); s.cyl(-17.4, 5.7, z + 1.0, 0.012, 0.4, M['brass'], segs=8)
    s.sphere(-17.4, 5.62, z + 1.18, 0.12, M['enamel_green'], segs=14, rings=7, sz=0.5)            # the green lamp
    papers(s, M, -18.0, 5.5, z + 0.785, rng, 7, 0.25)
    L.E('DOC_ch4_order_63', (-17.9, 5.5, z + 0.8))
    # the safe (code 1204): a heavy box with its dial and handle
    with p.at(x0 + WT / 2, 2.4, z, K.FACE['+x']):
        p.rbox(-0.4, 0, 0, 0.4, 0.65, 1.1, M['olive'], r=0.015, segs=2)
        p.box(-0.36, 0.65, 0.05, 0.36, 0.67, 1.05, M['olive'])
        p.cyl(0.1, 0.69, 0.7, 0.08, 0.03, M['chrome'], axis='Y', segs=24)
        p.cyl(0.1, 0.71, 0.7, 0.02, 0.03, M['black'], axis='Y', segs=8)
        p.tube([(-0.2, 0.67, 0.55), (-0.2, 0.76, 0.55), (-0.2, 0.76, 0.75)], 0.015, M['chrome'], 6)
    L.E('USE_safe', (x0 + WT / 2 + 0.7, 2.5, z + 0.7), hint='Сейф', action='safe', code='1204')
    # the map of Object 7 on the wall, the portrait, the flag in its stand, the bookcase, the coat
    with s.at((x0 + x1) / 2, y1 - WT / 2 - 0.03, z + 1.75, K.FACE['-y']):
        s.box(-0.9, 0, -0.55, 0.9, 0.01, 0.55, M['paper'])
        for (ax, az, bx, bz) in ((-0.8, 0.1, 0.8, 0.1), (-0.8, -0.3, 0.6, -0.3), (0.5, 0.1, 0.5, -0.3), (-0.3, 0.1, -0.3, 0.4), (0.2, 0.1, 0.2, 0.4)):
            with s.at((ax + bx) / 2, 0.012, (az + bz) / 2):
                s.box(-abs(bx - ax) / 2 - 0.01, 0, -abs(bz - az) / 2 - 0.01, abs(bx - ax) / 2 + 0.01, 0.002, abs(bz - az) / 2 + 0.01, M['text_k'])
        with s.at(0, 0, 0.45):
            K.text_flat(s, 'СХЕМА ОБЪЕКТА-7', 0.045, M['text_k'], y=0.012)
    K.picture(s, -18.0, y1 - WT / 2 - 0.03, z + 2.65, '-y', 0.5, 0.62, M['woodfine'], M['black'])
    s.cyl(x1 - 0.6, y1 - 0.6, z + 1.2, 0.015, 2.4, M['brass'], segs=8)
    s.box(x1 - 0.6, y1 - 0.62, z + 1.6, x1 - 0.6 + 0.9, y1 - 0.59, z + 2.3, M['cloth_red'])
    shelf_unit(p, M, 3.2, 5.6, x1 - WT / 2, z, 2.1, 0.32, '-x', 6, m=M['woodfine'], stuff=lambda pp, a, b, zz, d, hh, r: folders(pp, a, b, zz, d, hh, r, M), rng=rng)
    K.coat(s, x1 - WT / 2 - 0.2, 1.9, z + 1.8, '-x', M['greatcoat'], None, 1.1, 0.5)
    for (xx, yy) in ((-20.0, 4.0), (-16.0, 4.0)):
        K.fluoro(s, xx, yy, z + h, 1.2, 0.25, M['grey'], M['lamp_main'], along='y')
    L.lamp('office_1', -18.0, 4.0, z + h - 0.3, power=18, rng=7)
    locker(L, 'office', x0 + WT / 2, 6.3, z, '+x', name='office')
    frost(L, 'office', 0.6)

def r_archive(L):
    x0, y0, x1, y1, z, h = ROOMS['archive'][:6]
    M = L.M; p = L.part('archive'); s = L.part('archive', True); rng = L.rng
    stuff = lambda pp, a, b, zz, d, hh, r: folders(pp, a, b, zz, d, hh, r, M)
    for k in range(3):
        yy = 3.4 + k * 1.9
        shelf_unit(p, M, x0 + 0.8, x0 + 5.2, yy, z, 2.4, 0.4, '+y', 6, stuff=stuff, rng=rng)
    # the card index: a cabinet of small drawers
    with p.at(x1 - WT / 2, 2.4, z, K.FACE['-x']):
        p.box(-0.6, 0, 0, 0.6, 0.45, 1.3, M['woodfine'])
        for i in range(6):
            for j in range(5):
                p.rbox(-0.57 + i * 0.19, 0.45, 0.1 + j * 0.24, -0.4 + i * 0.19, 0.47, 0.3 + j * 0.24, M['woodfine'], r=0.004, segs=1)
                p.cyl(-0.485 + i * 0.19, 0.48, 0.2 + j * 0.24, 0.008, 0.02, M['brass'], axis='Y', segs=6)
    L.E('DOC_ch4_archive_card', (x1 - WT / 2 - 0.5, 2.4, z + 1.0))
    # the reading table: file 63/7-G, the reel-to-reel recorder with Sokolov's reel
    table(p, M, x1 - 2.6, 6.6, x1 - 0.8, 7.6, z)
    with s.at(x1 - 1.4, 7.1, z + 0.76):
        s.rbox(-0.25, -0.18, 0, 0.25, 0.18, 0.14, M['grey'], r=0.01, segs=1)
        for sx in (-0.12, 0.12):
            s.cyl(sx, 0.0, 0.15, 0.1, 0.01, M['black'], segs=20); s.cyl(sx, 0.0, 0.16, 0.025, 0.012, M['chrome'], segs=10)
        s.box(-0.2, -0.17, 0.14, 0.2, -0.12, 0.145, M['chrome'])
    L.E('USE_reel', (x1 - 1.4, 7.1, z + 0.95), hint='Магнитофон', action='play', tape='tape_sokolov')
    papers(s, M, x1 - 2.1, 7.0, z + 0.765, rng, 5, 0.2)
    L.E('DOC_ch4_guest_report', (x1 - 2.2, 7.0, z + 0.78)); L.E('DOC_ch4_anabiosis_report', (x1 - 1.9, 7.2, z + 0.78))
    chair(p, M, x1 - 1.7, 6.2, z, 0.0)
    for (xx, yy) in ((-27.0, 5.3), (-24.0, 5.3)):
        K.cage_lamp(s, xx, yy, z + h, M['grey'], M['lamp_main'], M['grey'])
    L.lamp('archive_1', -25.5, 5.3, z + h - 0.3, power=16, rng=7, flicker=0.5)
    frost(L, 'archive', 0.8)

def r_exchange(L):
    x0, y0, x1, y1, z, h = ROOMS['exchange'][:6]
    M = L.M; p = L.part('exchange'); s = L.part('exchange', True); rng = L.rng
    # the telephone exchange: a switchboard of jacks and cords, the radio racks
    with p.at(13.0, y0 + WT / 2, z, K.FACE['+y']):
        p.box(-1.4, 0, 0, 1.4, 0.5, 0.75, M['woodfine'])
        p.box(-1.4, 0, 0.75, 1.4, 0.18, 1.7, M['woodfine'])
        for i in range(18):
            for j in range(6):
                p.cyl(-1.3 + i * 0.15, 0.18, 0.9 + j * 0.13, 0.012, 0.01, M['black'], axis='Y', segs=6)
        for k in range(10):
            a = (-1.3 + rng.random() * 2.6, 0.2, 0.9 + rng.random() * 0.65)
            s.tube([a, (a[0] + rng.uniform(-0.2, 0.2), 0.45, 0.78), (rng.uniform(-1.2, 1.2), 0.35, 0.76)], 0.005, M['black'], 4)
    for k in range(3):
        with p.at(x0 + 1.0 + k * 0.7, y1 - WT / 2, z, K.FACE['-y']):
            p.box(-0.3, 0, 0, 0.3, 0.5, 1.9, M['grey'])
            panel_dials(p, M, -0.28, 0.28, 0.9, 1.85, rng, 2)
    chair(p, M, 13.0, y0 + 1.2, z, 0.0)
    K.cage_lamp(s, 13.0, -4.3, z + h, M['grey'], M['lamp_main'], M['grey'])
    L.lamp('exchange_1', 13.0, -4.3, z + h - 0.3, power=14, rng=7, flicker=0.2)
    frost(L, 'exchange', 0.7)

def r_armory(L):
    x0, y0, x1, y1, z, h = ROOMS['armory'][:6]
    M = L.M; p = L.part('armory'); s = L.part('armory', True); rng = L.rng
    for k in range(2):
        with p.at(x0 + WT / 2, -3.0 - k * 2.0, z, K.FACE['+x']):
            p.box(-0.9, 0, 0.1, 0.9, 0.3, 0.16, M['wood']); p.box(-0.9, 0, 1.2, 0.9, 0.1, 1.3, M['wood'])
    for i in range(4):
        crate(p, M, 2.0 + i * 1.3, y0 + WT / 2 + 0.6, z, 1.0, 0.6, 0.45, label='7,62×39' if i % 2 else '7,62×54R')
        if i % 2: crate(p, M, 2.0 + i * 1.3, y0 + WT / 2 + 0.6, z + 0.45, 1.0, 0.6, 0.4)
    crate(p, M, 6.5, -3.0, z, 0.8, 0.5, 0.35, label='ОГНЕОПАСНО', m=M['red'])
    for k, it in enumerate(('ammo_762x39', 'ammo_762x54', 'ammo_9x18', 'flare')):
        L.E(f'ITEM_armory_{k + 1}', (2.0 + k * 1.3, y0 + WT / 2 + 0.6, z + 0.92), item=it, count=1)
    K.cage_lamp(s, 3.0, -3.8, z + h, M['grey'], M['lamp_main'], M['grey'])
    L.lamp('armory_1', 3.0, -3.8, z + h - 0.3, power=14, rng=7)
    frost(L, 'armory', 0.6)

def r_infirmary(L):
    x0, y0, x1, y1, z, h = ROOMS['infirmary'][:6]
    M = L.M; p = L.part('infirmary'); s = L.part('infirmary', True); rng = L.rng
    for k in range(3):
        with p.at(x0 + 1.4 + k * 2.6, y0 + WT / 2 + 1.1, z, math.pi / 2):
            p.rbox(-0.95, -0.42, 0.55, 0.95, 0.42, 0.65, M['mattress'], r=0.04, segs=2)
            for (lx, ly) in ((-0.9, -0.4), (0.9, -0.4), (-0.9, 0.4), (0.9, 0.4)):
                p.cyl(lx, ly, 0.3, 0.018, 0.6, M['white'], segs=8)
            p.box(-0.95, -0.42, 0.5, 0.95, 0.42, 0.55, M['white'])
            p.box(-0.97, -0.42, 0.5, -0.93, 0.42, 1.0, M['white'])
            if k == 1: p.rbox(-0.5, -0.4, 0.65, 0.95, 0.4, 0.7, M['plate'], r=0.03, segs=2)          # (a sheet over something)
    with p.at(x1 - WT / 2, -4.3, z, K.FACE['-x']):
        p.box(-0.6, 0, 0, 0.6, 0.4, 1.9, M['white'])
        for k in range(4):
            s.box(-0.55, 0.4, 0.15 + k * 0.45, 0.55, 0.405, 0.55 + k * 0.45, M['glass'])
    L.E('ITEM_infirmary_1', (x1 - WT / 2 - 0.35, -4.3, z + 1.1), item='medkit', count=1)
    L.E('ITEM_infirmary_2', (x0 + 1.4, y0 + WT / 2 + 1.1, z + 0.7), item='bandage', count=2)
    desk(p, M, -4.5, -6.3, z, 0.0, m=M['white'], drawers=True)
    for (xx, yy) in ((-11.0, -4.3), (-6.0, -4.3)):
        K.fluoro(s, xx, yy, z + h, 1.2, 0.25, M['grey'], M['lamp_main'], along='x')
    L.lamp('infirmary_1', -8.5, -4.3, z + h - 0.3, power=16, rng=8, flicker=0.6)
    frost(L, 'infirmary', 0.8)

def r_stairs(L):
    """two flights down from floor 1 to floor 2, a landing between, rails"""
    x0, y0, x1, y1, z, h = ROOMS['stairs'][:6]
    M = L.M; p = L.part('stairs'); s = L.part('stairs', True); c = L.col('stairs')
    zm = (F1 + F2) / 2
    # the top platform (floor 1) at the door, the landing at the far end
    p.box(18.3, -2.3, F1 - 0.3, 20.3, -1.3, F1, M['cfloor']); c.box(18.3, -2.3, F1 - 0.3, 20.3, -1.3, F1, None)
    p.box(18.3, -9.15, zm - 0.3, 23.7, -7.7, zm, M['cfloor']); c.box(18.3, -9.15, zm - 0.3, 23.7, -7.7, zm, None)
    K.stairs(p, 18.4, 20.2, -2.3, F1, -7.7, zm, M['cfloor'], rail_m=M['grey'])
    K.ramp(c, 18.4, 20.2, -2.3, F1, -7.7, zm)
    K.stairs(p, 21.8, 23.6, -7.7, zm, -2.0, F2, M['cfloor'], rail_m=M['grey'])
    K.ramp(c, 21.8, 23.6, -7.7, zm, -2.0, F2)
    # the solid core between the flights (a wall) and the upper floor's slab over the lower flight
    p.box(20.3, -7.7, F2, 21.7, -1.3, F1 + 1.1, M['cwall']); c.box(20.3, -7.7, F2, 21.7, -1.3, F1 + 1.1, None)
    p.box(21.7, -2.4, F1 - 0.3, 23.7, -1.3, F1 + 0.05, M['cwall'])
    K.sign(s, 20.25, -2.0, F1 + 1.7, '-x', 'ЭТАЖ 1', 0.1, M['white'], M['text_k'])
    K.sign(s, 21.75, -2.2, F2 + 1.7, '+x', 'ЭТАЖ 2', 0.1, M['white'], M['text_k'])
    for (yy, zz) in ((-5.0, F1 + 3.0), (-8.4, zm + 2.6), (-4.5, F2 + 2.9)):
        K.cage_lamp(s, 21.0 if zz != zm + 2.6 else 21.0, yy, zz, M['grey'], M['lamp_emerg'], M['grey'], axis='Z', r=0.07)
    L.lamp('stairs_1', 21.0, -8.4, zm + 2.3, color=(1.0, 0.12, 0.05), power=8, rng=8, group='emerg')
    frost(L, 'stairs', 1.0)

def r_garage(L):
    """the garage: a GAZ-63 left on blocks, fuel drums, the bench; the tunnel's mouth south"""
    x0, y0, x1, y1, z, h = ROOMS['garage'][:6]
    M = L.M; p = L.part('garage'); s = L.part('garage', True); rng = L.rng
    gx, gy = -38.0, 1.0
    with p.at(gx, gy, z, math.pi / 2):
        for (wx, wy) in ((-1.6, -0.85), (-1.6, 0.85), (1.2, -0.85), (1.2, 0.85), (2.2, -0.85), (2.2, 0.85)):
            p.cyl(wx, wy, 0.5, 0.5, 0.28, M['rubber'], axis='Y', segs=20)
            p.cyl(wx, wy * 1.02, 0.5, 0.25, 0.3, M['olive'], axis='Y', segs=14)
        p.box(-2.4, -0.55, 0.65, 2.9, 0.55, 0.85, M['black'])                               # the frame
        p.rbox(-2.5, -0.85, 0.9, -1.0, 0.85, 1.75, M['olive'], r=0.12, segs=3)                # the bonnet
        p.rbox(-1.0, -1.0, 0.9, 0.2, 1.0, 2.35, M['olive'], r=0.06, segs=2)                   # the cab
        p.box(-1.02, -0.85, 1.75, -0.98, 0.85, 2.2, M['glass'])
        for sy in (-1.0, 1.0):
            p.rbox(-2.0, sy * 1.05 - 0.1, 0.95, -1.2, sy * 1.05 + 0.1, 1.25, M['olive'], r=0.08, segs=2)     # the mudguards
        p.box(0.3, -1.1, 1.0, 3.2, 1.1, 1.1, M['wood'])                                        # the bed
        for sy in (-1.1, 1.1): p.box(0.3, sy - 0.03, 1.1, 3.2, sy + 0.03, 1.6, M['wood'])
        p.rbox(0.35, -1.12, 1.6, 3.15, 1.12, 2.5, M['cloth_grey'], r=0.4, segs=3)              # the tarp
        p.cyl(-2.55, -0.55, 1.2, 0.09, 0.06, M['lamp_dead'], axis='X', segs=12); p.cyl(-2.55, 0.55, 1.2, 0.09, 0.06, M['lamp_dead'], axis='X', segs=12)
    for k in range(9):
        dx, dy = -43.0 + (k % 3) * 0.66, -6.0 + (k // 3) * 0.66
        s.cyl(dx, dy, z + 0.44, 0.29, 0.88, M['red'] if k % 4 else M['blue'], segs=16)
    table(p, M, -32.5, 3.6, -30.8, 4.6, z, top=M['steel'], leg=M['grey'], h=0.9)
    with p.at(-31.6, y1 - WT / 2, z, K.FACE['-y']):
        p.box(-1.0, 0, 1.2, 1.0, 0.03, 2.2, M['wood'])                                         # the tool board
    L.E('ITEM_garage_1', (-31.6, 4.1, z + 0.95), item='flare', count=2)
    for (xx, yy) in ((-40.0, -2.0), (-34.0, -2.0)):
        K.cage_lamp(s, xx, yy, z + h, M['grey'], M['lamp_main'], M['grey'])
    L.lamp('garage_1', -37.0, -2.0, z + h - 0.4, power=24, rng=11, flicker=0.2)
    frost(L, 'garage', 1.2)

def tunnel(L):
    """the vehicle tunnel: 70 m south and up 5 m to the old portal on the cap's flank, its blast
    doors (the way out, when the power is on)"""
    M = L.M; p = L.part('tunnel'); s = L.part('tunnel', True); c = L.col('tunnel')
    xa, xb, y0, y1 = -40.5, -33.5, -7.0, -77.0
    z0, z1 = F1, F1 + 5.0
    H = 4.6
    n = 28
    for i in range(n):
        ya, yb = y0 + (y1 - y0) * i / n, y0 + (y1 - y0) * (i + 1) / n
        za, zb = z0 + (z1 - z0) * i / n, z0 + (z1 - z0) * (i + 1) / n
        bm = p.bm; mi = p.mi(M['craw']); mf = p.mi(M['cfloor'])
        # floor
        v = [bm.verts.new(q) for q in ((xa, ya, za), (xb, ya, za), (xb, yb, zb), (xa, yb, zb))]
        f = bm.faces.new(v); f.material_index = mf
        # an arch: walls rising 2.8 m then a vault (12 segments)
        prof = [(xa, 0.0), (xa, 2.8)] + [((xa + xb) / 2 - math.cos(math.pi * k / 10) * (xb - xa) / 2, 2.8 + math.sin(math.pi * k / 10) * (H - 2.8)) for k in range(1, 10)] + [(xb, 2.8), (xb, 0.0)]
        ra = [bm.verts.new((px, ya, za + pz)) for px, pz in prof]
        rb = [bm.verts.new((px, yb, zb + pz)) for px, pz in prof]
        for k in range(len(prof) - 1):
            f = bm.faces.new((ra[k], ra[k + 1], rb[k + 1], rb[k])); f.material_index = mi
        K.ramp(c, xa, xb, ya, za, yb, zb)
        for x_ in (xa, xb):
            K.wall(c, (x_, ya), (x_, yb), min(za, zb), max(za, zb) + 3.5, None, t=0.2)
        if i % 4 == 2:
            yy, zz = (ya + yb) / 2, (za + zb) / 2
            K.cage_lamp(s, (xa + xb) / 2, yy, zz + H, M['grey'], M['lamp_main'] if i % 8 == 2 else M['lamp_dead'], M['grey'], r=0.08)
            if i % 8 == 2: L.lamp(f'tunnel_{i}', (xa + xb) / 2, yy, zz + H - 0.4, power=20, rng=12, flicker=0.3)
        # (frozen ruts in the floor, ice on the walls)
        if i % 2 == 0:
            for x_ in (xa + 0.35, xb - 0.35):
                lump(s, x_, (ya + yb) / 2, (za + zb) / 2, 0.35, abs(yb - ya) * 0.6, 0.12, M['rime'])
    # the portal's blast doors: two leaves 3.5 m wide each, ribbed, the hazard stripes on the frame
    pz = z1
    for k, sgn in enumerate((-1, 1)):
        lp = K.Part(f'BLAST_portal_{k + 1}', [M['door']], L.g)
        lp.box(0, -0.25, 0, sgn * 3.5, 0.25, 4.2, M['door'], bevel=0.02)
        for zz in np.arange(0.4, 4.0, 0.6):
            lp.box(0.1 * sgn, -0.32, zz - 0.06, sgn * 3.4, -0.25, zz + 0.06, M['door'])
        lp.cyl(sgn * 2.8, -0.35, 2.0, 0.35, 0.08, M['steel'], axis='Y', segs=24)
        o = lp.done(sharp=40)
        o.location = ((xa + xb) / 2 - sgn * 3.5, y1 - 0.3, pz); o['kind'] = 'blast'; o['lock'] = 'power'; o['open'] = 85 * sgn
    s.box(xa - 0.5, y1 - 0.6, pz + 4.2, xb + 0.5, y1, pz + 4.6, M['yellow'])
    for k in range(12):
        s.boxc(xa - 0.3 + k * 0.7, y1 - 0.62, pz + 4.4, 0.25, 0.02, 0.4, M['black'], rz=0.0)
    K.sign(s, (xa + xb) / 2, y1 + 0.3, pz + 3.6 + 0.6, '+y', 'ВЫХОД НА ПОВЕРХНОСТЬ', 0.1, M['green'], M['text_w'])
    L.E('ZONE_tunnel', ((xa + xb) / 2, (y0 + y1) / 2, (z0 + z1) / 2 + 2), size=[xb - xa, abs(y1 - y0), 7], ambience='bunker', floor=z0)
    L.E('USE_portal', ((xa + xb) / 2, y1 + 1.0, pz + 1.2), hint='Гермоворота', action='portal')
    L.E('SPOT_portal_out', ((xa + xb) / 2, y1 - 3.0, pz + 0.1), (0, 0, math.pi))

def r_corB(L):
    corridor_dress(L, 'corB')
    frost(L, 'corB', 1.6)
    M = L.M; s = L.part('corB', True); z = F2
    K.sign(s, -1.7 + WT / 2, 0.8, z + 2.3, '+x', 'ОБЪЕКТ-7', 0.12, M['red'], M['text_w'], sub='СЕКТОР «Б»')
    blood(L, 'corB', 6.0, 0.2, z, 1.4)
    L.E('SPAWN_corB_shade_1', (12.0, 0.0, z), kind='shade', state='wander')
    L.E('TRIG_corB_cryo', (9.0, 0.0, z + 1.2), size=[3, 2.6, 2.4])

def r_cryo(L):
    """the cryo hall: rows of glass pods on steel bases, frozen people in some, others broken
    open and empty; the console; the medical officer's desk; the records cabinet"""
    x0, y0, x1, y1, z, h = ROOMS['cryo'][:6]
    M = L.M; p = L.part('cryo'); s = L.part('cryo', True); rng = L.rng
    pods = []
    for i in range(4):
        for j in range(3):
            px, py = 4.3 + i * 3.2, 4.0 + j * 2.6
            pods.append((px, py))
            broken = (i, j) in ((1, 1), (3, 0), (0, 2))
            p.cyl(px, py, z + 0.15, 0.6, 0.3, M['grey'], segs=24, bevel=0.02)
            p.cyl(px, py, z + 2.55, 0.6, 0.3, M['grey'], segs=24, bevel=0.02)
            for k in range(4):
                a = k * math.pi / 2 + 0.6
                p.cyl(px + math.cos(a) * 0.52, py + math.sin(a) * 0.52, z + 1.35, 0.025, 2.1, M['steel'], segs=8)
            if not broken:
                s.cyl(px, py, z + 1.35, 0.47, 2.1, M['podglass'], segs=24, cap=False)
                body_silhouette(s, M, px, py, z + 0.3, rng.uniform(-0.3, 0.3) + math.pi, 'stand', scale=0.95)
                if rng.random() < 0.6:
                    for q in range(5):
                        a_ = rng.uniform(0, math.tau)
                        lump(s, px + math.cos(a_) * 0.43, py + math.sin(a_) * 0.43, z + rng.uniform(0.5, 2.2), 0.08, 0.08, rng.uniform(0.15, 0.5), M['rime'], segs=8, rings=5)
            else:
                for k in range(10):
                    a = rng.random() * math.tau
                    r_ = rng.uniform(0.5, 1.4)
                    with s.at(px + math.cos(a) * r_, py + math.sin(a) * r_, z + 0.005, rng.random() * math.tau):
                        s.box(-rng.uniform(0.05, 0.18), -0.04, 0, rng.uniform(0.05, 0.18), 0.04, 0.008, M['podglass'])
                s.cyl(px, py, z + 0.5, 0.47, 0.5, M['podglass'], segs=24, cap=False)      # (the stump of the glass)
            K.pipe(p, [(px, py + 0.4, z + 2.7), (px, py + 0.4, z + 3.6), (px, y1 - WT / 2 - 0.3, z + 3.6)], 0.04, M['steel'])
            K.sign(s, px, py - 0.61, z + 2.55, '-y', f'№ {i * 3 + j + 1}', 0.05, M['grey'], M['text_w'], w=0.2, h=0.09)
    for k, (px, py) in enumerate(pods):
        if k in (2, 7): L.E(f'SPAWN_cryo_{k}', (px, py, z + 0.3), kind='turned_a' if k == 2 else 'turned_b', state='dormant', pose='stand_frozen')
    # the console under the far wall, its dials
    with p.at(9.0, y1 - WT / 2, z, K.FACE['-y']):
        p.box(-2.0, 0, 0, 2.0, 0.7, 0.85, M['grey'])
        with p.at(0, 0.0, 0.85):
            p.box(-2.0, 0, 0, 2.0, 0.25, 0.6, M['grey'])
        with p.at(0, 0.26, 0.85):
            panel_dials(p, M, -1.9, 1.9, 0.0, 0.58, rng, 8)
    K.sign(s, 9.0, y1 - WT / 2 - 0.02, z + 3.2, '-y', 'НА ОКЛИК ПО ИМЕНИ НЕ ОТВЕЧАТЬ', 0.09, M['red'], M['text_w'])
    K.sign(L.part('corB', True), 9.0, 1.3 - WT / 2 - 0.02, F2 + 2.75, '-y', 'КРИОЗАЛ', 0.11, M['white'], M['text_k'], sub='ПО СТЕКЛУ КАМЕР НЕ СТУЧАТЬ')
    L.E('DOC_ch4_sign_cryo', (9.0, 1.3 - WT / 2 - 0.05, F2 + 2.7))
    # the medical officer's desk (Belyaeva's diaries) and the records cabinet (the subjects' files)
    desk(p, M, x0 + 1.2, y1 - WT / 2 - 0.6, z, math.pi, m=M['white'])
    papers(s, M, x0 + 1.2, y1 - WT / 2 - 0.6, z + 0.785, rng, 6, 0.2)
    for k in range(3): L.E(f'DOC_ch4_belyaeva_{k + 1}', (x0 + 1.0 + k * 0.2, y1 - WT / 2 - 0.6, z + 0.8))
    with p.at(x1 - WT / 2, 3.0, z, K.FACE['-x']):
        p.box(-0.5, 0, 0, 0.5, 0.6, 1.35, M['olive'])
        for k in range(4):
            p.rbox(-0.47, 0.6, 0.06 + k * 0.32, 0.47, 0.62, 0.34 + k * 0.32, M['olive'], r=0.004, segs=1)
            p.box(-0.08, 0.62, 0.2 + k * 0.32, 0.08, 0.64, 0.23 + k * 0.32, M['chrome'])
    L.E('DOC_ch4_subject_14', (x1 - WT / 2 - 0.65, 3.0, z + 1.0)); L.E('DOC_ch4_subject_22', (x1 - WT / 2 - 0.65, 3.2, z + 1.0))
    for (xx, yy) in ((5.5, 5.3), (12.5, 5.3), (9.0, 9.3)):
        K.fluoro(s, xx, yy, z + h, 1.2, 0.25, M['grey'], M['lamp_main'], along='x')
    L.lamp('cryo_1', 9.0, 6.3, z + h - 0.4, color=(0.75, 0.88, 1.0), power=30, rng=12, flicker=0.2)
    L.lamp('cryo_emerg', x0 + 1.0, y1 - 1.0, z + 2.8, color=(1.0, 0.12, 0.05), power=6, rng=8, group='emerg')
    frost(L, 'cryo', 2.0)
    L.E('TRIG_cryo_names', (9.0, 6.0, z + 1.2), size=[12, 9, 2.4])

def r_lab(L):
    x0, y0, x1, y1, z, h = ROOMS['lab'][:6]
    M = L.M; p = L.part('lab'); s = L.part('lab', True); rng = L.rng
    for k in range(2):
        yy = 3.4 + k * 2.6
        table(p, M, 17.0, yy - 0.45, 23.0, yy + 0.45, z, top=M['black'], leg=M['white'], h=0.9)
        for j in range(9):
            px = 17.4 + j * 0.62 + rng.uniform(-0.1, 0.1)
            kind = rng.random()
            if kind < 0.4:
                s.cyl(px, yy, z + 0.98, 0.04, 0.16, M['glass'], segs=10)
            elif kind < 0.7:
                s.sphere(px, yy, z + 0.97, 0.06, M['glass'], segs=10, rings=6); s.cyl(px, yy, z + 1.07, 0.015, 0.1, M['glass'], segs=8)
            elif kind < 0.85:
                s.cyl(px, yy, z + 1.0, 0.07, 0.2, M['glass'], segs=12); s.cyl(px, yy, z + 0.97, 0.06, 0.12, M['guest'], segs=10)     # (something dark in a jar)
    # the fume hood, the blackboard, the core sample case
    with p.at(x1 - WT / 2, 4.5, z, K.FACE['-x']):
        p.box(-0.9, 0, 0, 0.9, 0.7, 0.9, M['white']); p.box(-0.9, 0, 0.9, 0.9, 0.7, 2.2, M['white'])
        p.box(-0.85, 0.66, 1.0, 0.85, 0.7, 1.8, M['glass'])
    with s.at((x0 + x1) / 2, y1 - WT / 2, z + 1.6, K.FACE['-y']):
        s.box(-1.6, 0, -0.6, 1.6, 0.03, 0.6, M['board'])
        for i, ln in enumerate(('T = −196 °C', 'ρ(t) ~ e^(−λt)', 'ОБРАЗЕЦ «Г»: ПУЛЬС 4/мин', 'ТЕПЛЕЕ ОКРУЖАЮЩЕГО ЛЬДА НА 3,1°')):
            with s.at(-0.2, 0, 0.42 - i * 0.26):
                K.text_flat(s, ln, 0.06, M['chalk'], y=0.031)
    crate(p, M, 17.4, y1 - WT / 2 - 0.5, z, 1.2, 0.5, 0.5, label='КЕРН', m=M['grey'])
    K.fluoro(s, 20.0, 4.7, z + h, 1.2, 0.25, M['grey'], M['lamp_main'], along='x')
    L.lamp('lab_1', 20.0, 4.7, z + h - 0.3, power=18, rng=8, flicker=0.4)
    locker(L, 'lab', x0 + WT / 2, 6.8, z, '+x', name='lab')
    frost(L, 'lab', 1.2)
    L.E('ITEM_lab_1', (17.5, 3.4, z + 0.95), item='battery', count=1)

def r_pump(L):
    x0, y0, x1, y1, z, h = ROOMS['pump'][:6]
    M = L.M; p = L.part('pump'); s = L.part('pump', True); rng = L.rng
    for k in range(3):
        px = 1.5 + k * 2.4
        p.box(px - 0.7, -6.5, z, px + 0.7, -4.6, z + 0.3, M['craw'])
        p.cyl(px - 0.2, -5.55, z + 0.75, 0.38, 0.9, M['blue'], axis='Y', segs=20, bevel=0.03)
        p.cyl(px - 0.2, -5.55, z + 0.75, 0.2, 1.5, M['steel'], axis='Y', segs=12)
        p.rbox(px - 0.65, -5.95, z + 0.3, px + 0.25, -5.15, z + 1.05, M['green'], r=0.06, segs=2)
        K.pipe(p, [(px - 0.2, -4.6, z + 0.75), (px - 0.2, -3.0, z + 0.75), (px - 0.2, -3.0, z + h - 0.5), (px - 0.2, y1 - WT / 2 - 0.3, z + h - 0.5)], 0.11, M['green'], flanges=(1,))
        K.valve(p, px - 0.2, -3.6, z + 0.75, 'Y', 0.1, M['grey'], M['red'])
        K.gauge(s, px + 0.35, -4.7, z + 1.3, '+y', 0.08, M['black'], M['dial'], M['glass'], M['needle'], a=rng.uniform(-2.3, -1.8))
    K.sign(s, x0 + WT / 2, -4.0, z + 2.4, '+x', 'НАСОСЫ ОХЛАЖДЕНИЯ', 0.09, M['yellow'], M['text_k'], sub='КОНТУР II')
    K.cage_lamp(s, 4.0, -4.6, z + h, M['grey'], M['lamp_main'], M['grey'])
    L.lamp('pump_1', 4.0, -4.6, z + h - 0.3, power=16, rng=8)
    frost(L, 'pump', 1.6)

def r_store(L):
    x0, y0, x1, y1, z, h = ROOMS['store'][:6]
    M = L.M; p = L.part('store'); s = L.part('store', True); rng = L.rng
    for k in range(10):
        crate(p, M, 9.0 + (k % 5) * 1.7, -6.0 + (k // 5) * 1.4, z, rng.uniform(0.8, 1.2), rng.uniform(0.6, 0.9), rng.uniform(0.5, 0.9), rz=rng.uniform(-0.2, 0.2), label=rng.choice(('ОБЪЕКТ-7', 'НЕ КАНТОВАТЬ', 'ПРОДОВОЛЬСТВИЕ', None)))
    L.E('ITEM_store_1', (12.4, -6.0, z + 1.0), item='flare', count=1)
    L.E('ITEM_store_2', (15.8, -4.6, z + 1.0), item='ammo_9x18', count=1)
    K.cage_lamp(s, 13.0, -4.3, z + h, M['grey'], M['lamp_dead'], M['grey'])
    frost(L, 'store', 1.4)

def r_reactor(L):
    """the reactor hall: the vessel in its shield ring, the drives on top, the pipes to the heat
    exchangers; the switchboard with the three breakers (I, II, III) and the control desk"""
    x0, y0, x1, y1, z, h = ROOMS['reactor'][:6]
    M = L.M; p = L.part('reactor'); s = L.part('reactor', True); rng = L.rng
    rx, ry = -9.0, 0.0
    p.cyl(rx, ry, z + 0.5, 3.2, 1.0, M['craw'], segs=40, bevel=0.04)
    p.cyl(rx, ry, z + 2.4, 2.1, 2.8, M['grey'], segs=36, bevel=0.05)
    p.cyl(rx, ry, z + 3.85, 2.2, 0.1, M['grey'], segs=36)
    for k in range(12):
        a = k * math.tau / 12
        p.cyl(rx + math.cos(a) * 1.2, ry + math.sin(a) * 1.2, z + 4.0, 0.09, 0.3, M['yellow'], segs=10)
    p.cyl(rx, ry, z + 4.0, 0.3, 0.3, M['yellow'], segs=14)
    for k in range(3):
        a = k * math.tau / 3 + 0.4
        K.pipe(p, [(rx + math.cos(a) * 2.1, ry + math.sin(a) * 2.1, z + 2.0), (rx + math.cos(a) * 4.0, ry + math.sin(a) * 4.0, z + 2.0), (rx + math.cos(a) * 4.0, ry + math.sin(a) * 4.0, z + h - 0.3)], 0.18, M['steel'], flanges=(1,))
    # the control rod drives standing on the lid, a catwalk round the vessel, the crane rail, stripes
    for k in range(19):
        a = k * math.tau / 19; rr = 0.55 + 0.9 * (k % 3) / 2
        p.cyl(rx + math.cos(a) * rr, ry + math.sin(a) * rr, z + 4.0 + 0.3, 0.06, 0.9, M['steel'], segs=8)
        p.cyl(rx + math.cos(a) * rr, ry + math.sin(a) * rr, z + 4.0 + 0.78, 0.075, 0.06, M['black'], segs=8)
    for k in range(24):
        a = k * math.tau / 24
        p.box(rx + math.cos(a) * 2.25 - 0.04, ry + math.sin(a) * 2.25 - 0.04, z + 1.0, rx + math.cos(a) * 2.25 + 0.04, ry + math.sin(a) * 2.25 + 0.04, z + 2.2, M['grey'])
    p.torus(rx, ry, z + 2.2, 2.6, 0.03, M['yellow'], segs=40, rsegs=6)
    p.torus(rx, ry, z + 1.65, 2.6, 0.022, M['yellow'], segs=40, rsegs=6)
    for k in range(10):
        a = k * math.tau / 10
        p.cyl(rx + math.cos(a) * 2.6, ry + math.sin(a) * 2.6, z + 1.6, 0.025, 1.2, M['yellow'], segs=6)
    for k in range(32):
        a = k * math.tau / 32
        with s.at(rx + math.cos(a) * 3.35, ry + math.sin(a) * 3.35, z + 0.002, a):
            s.box(-0.15, -0.3, 0, 0.15, 0.3, 0.004, M['yellow'] if k % 2 else M['black'])
    for yy in (-3.5, 3.5):
        p.box(x0 + WT / 2, yy - 0.15, z + h - 0.35, x1 - WT / 2, yy + 0.15, z + h - 0.15, M['yellow'])
    p.box(-11.5, -3.6, z + h - 0.7, -10.5, 3.6, z + h - 0.35, M['yellow'])
    for k in range(4):
        K.pipe(p, [(x1 - WT / 2 - 0.25 - k * 0.3, y0 + 0.6, z + h - 0.3), (x1 - WT / 2 - 0.25 - k * 0.3, y1 - 0.6, z + h - 0.3)], 0.09 + 0.03 * (k % 2), (M['green'], M['red'], M['grey'], M['blue'])[k])
    with s.at(-9.0, y1 - WT / 2 - 0.02, z + 2.6, K.FACE['-y']):
        s.cyl(0, 0.004, 0, 0.42, 0.006, M['yellow'], axis='Y', segs=32)
        for k in range(3):
            a = k * math.tau / 3 + math.pi / 2
            bm = s.bm; mi = s.mi(M['black'])
            pts = [(0, 0)] + [(math.cos(a + d) * 0.36, math.sin(a + d) * 0.36) for d in np.linspace(-0.5, 0.5, 6)]
            vs = [bm.verts.new(s.P((px_, 0.008, pz_))) for px_, pz_ in pts]
            f = bm.faces.new(vs); f.material_index = mi
        s.cyl(0, 0.009, 0, 0.07, 0.004, M['black'], axis='Y', segs=16)
    for k, (yy, label, ii) in enumerate(((-6.6, 'I', 1), (-4.4, 'II', 2), (-2.2, 'III', 3))):
        with p.at(x0 + WT / 2, yy, z, K.FACE['+x']):
            p.box(-0.9, 0, 0.2, 0.9, 0.45, 2.4, M['grey'])
            p.box(-0.85, 0.45, 1.0, 0.85, 0.47, 2.3, M['grey'])
            with p.at(0, 0.47, 2.1):
                K.text_flat(p, label, 0.18, M['text_w'], y=0.003)
        # the breaker's handle: its own object (the game throws it), hinged at the bottom
        bp = K.Part(f'USE_breaker_{ii}', [M['red']], L.g)
        bp.box(-0.04, 0, 0, 0.04, 0.06, 0.55, M['black'])
        bp.cyl(0, 0.04, 0.55, 0.06, 0.2, M['red'], axis='X', segs=12)
        o = bp.done(sharp=40)
        o.location = (x0 + WT / 2 + 0.5, yy, z + 1.1); o.rotation_euler = (math.radians(-35), 0, math.radians(-90))
        o['hint'] = f'Рубильник {label}'; o['action'] = 'breaker'; o['breaker'] = ii
    poster(L, 'reactor', x0 + WT / 2 + 0.02, -4.4, z + 3.2, '+x', [('РЕАКТОРНЫЙ ЗАЛ', 0.1, M['text_k']), ('ОСТОРОЖНО! РАДИАЦИЯ!', 0.07, M['text_k']), ('ВКЛЮЧАТЬ СТРОГО ПО ИНСТРУКЦИИ', 0.05, M['text_k'])], 2.4, 0.6, M['yellow'], M['text_k'], border=M['black'])
    L.E('DOC_ch4_sign_reactor', (x0 + WT / 2 + 0.05, -4.4, z + 3.2))
    L.E('DOC_ch4_zubov_note', (x0 + WT / 2 + 0.5, -5.5, z + 1.6))
    # the control desk facing the vessel
    with p.at(-4.0, 6.5, z, math.pi):
        p.box(-2.0, -0.4, 0, 2.0, 0.4, 0.8, M['grey'])
        with p.at(0, -0.4, 0.8, rx=math.radians(-20)):
            panel_dials(p, M, -1.9, 1.9, 0.0, 0.55, rng, 7)
    chair(p, M, -4.0, 5.6, z, math.pi + 0.2, m=M['grey'])
    for (xx, yy) in ((-12.5, -5.0), (-12.5, 5.0), (-5.5, -5.0), (-5.5, 5.0)):
        K.cage_lamp(s, xx, yy, z + h, M['grey'], M['lamp_main'], M['grey'], r=0.1)
    L.lamp('reactor_1', -9.0, -5.0, z + h - 0.4, power=40, rng=14, group='main')
    L.lamp('reactor_2', -9.0, 5.0, z + h - 0.4, power=40, rng=14, group='main')
    L.lamp('reactor_emerg', x0 + 1.0, -4.4, z + 3.0, color=(1.0, 0.12, 0.05), power=10, rng=9, group='emerg')
    frost(L, 'reactor', 1.4)

def sector_g(L):
    """Sector G's blast door at the end of corridor B (a heavy hinged slab with its wheel), the
    hazard stripes round it, the sign"""
    M = L.M; z = F2
    s = L.part('corB', True)
    gx = 28.0 - WT / 2
    bp = K.Part('BLAST_sectorG', [M['door']], L.g)
    W_, H_, T_ = 2.8, 2.9, 0.4
    bp.rbox(0, -T_, 0, W_, 0, H_, M['door'], r=0.04, segs=2)
    for zz in np.arange(0.35, H_, 0.5):
        bp.box(0.1, 0, zz - 0.05, W_ - 0.1, 0.06, zz + 0.05, M['door'])
    for xx in (0.25, W_ - 0.25):
        bp.box(xx - 0.06, 0, 0.1, xx + 0.06, 0.07, H_ - 0.1, M['door'])
    bp.torus(W_ * 0.62, 0.16, 1.45, 0.42, 0.035, M['red'], axis='Y', segs=24, rsegs=6)
    for k in range(4):
        a = k * math.pi / 2 + 0.3
        bp.tube([(W_ * 0.62, 0.16, 1.45), (W_ * 0.62 + math.cos(a) * 0.42, 0.16, 1.45 + math.sin(a) * 0.42)], 0.022, M['red'], 6)
    bp.cyl(W_ * 0.62, 0.09, 1.45, 0.08, 0.14, M['steel'], axis='Y', segs=14)
    for k in range(3):
        bp.cyl(0.05, 0.05, 0.4 + k * 1.05, 0.09, 0.3, M['steel'], segs=12)        # (the hinges)
    o = bp.done(sharp=40)
    # (built along +x from its hinge, its wheel on +y; turned so +x runs north along the wall and +y
    # faces west, into the corridor)
    o.location = (gx, -W_ / 2, z); o.rotation_euler = (0, 0, math.pi / 2)
    o['kind'] = 'blast'; o['lock'] = 'power'; o['open'] = -100; o['width'] = W_; o['height'] = H_
    for k in range(14):
        t_ = k / 13
        s.boxc(gx - 0.03, -1.45 + 2.9 * t_, z + 2.75, 0.02, 0.18, 0.22, M['yellow'] if k % 2 == 0 else M['black'])
    for sgn in (-1, 1):
        for k in range(10):
            s.boxc(gx - 0.03, sgn * 1.45, z + 0.15 + k * 0.27, 0.02, 0.2, 0.2, M['yellow'] if k % 2 == 0 else M['black'])
    poster(L, 'corB', gx - 0.05, 0.0, z + 3.0 - 0.12, '-x', [('СЕКТОР «Г»', 0.08, M['text_w']), ('ВХОД ВОСПРЕЩЁН!', 0.06, M['text_w'])], 1.2, 0.26, M['red'], M['text_w'])
    L.E('DOC_ch4_sign_sector', (gx - 0.1, 0.0, z + 2.85))
    L.E('USE_sectorG', (gx - 1.0, 0.0, z + 1.2), hint='Гермоворота', action='sectorG')

def smooth_path(pts, n=6):
    """a Catmull-Rom curve through the points (n samples a span)"""
    P = [np.array(p, np.float32) for p in pts]
    if len(P) < 3: return [tuple(p) for p in P]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n; t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)))
    out.append(tuple(P[-2]))
    return out

def frozen_dead(L, places, rng):
    """the dead in the Guest's wall: each sculpted on its own fine grid (a skull with its jaw
    hanging open and its eyes sunk, a neck, shoulders and a chest, arms reaching out of the ice,
    hands with fingers), facing out of the wall, frosted; all in one object"""
    M = L.M
    objs = []
    for k, (q, n) in enumerate(places):
        up = np.array((0, 0, 1), np.float32)
        side = np.cross(up, n); side /= np.linalg.norm(side) + 1e-9
        fwd = n
        tilt = rng.uniform(-0.35, 0.35)
        sc_ = 1.15
        def P_(f, s_, u):                       # (forward out of the ice, sideways, up) to the world
            return q + (fwd * f + side * s_ + up * u) * sc_
        F = S.Field(q - 1.15, q + 1.15, 0.032, fill=1.0)
        head = P_(0.16, tilt * 0.1, 0.5)
        F.add(S.E(head, (0.095, 0.095, 0.12)), 0.0)
        F.add(S.E(P_(0.2, tilt * 0.1, 0.42), (0.07, 0.07, 0.06)), 0.03)                      # the jaw
        F.add(S.RC(P_(0.08, 0, 0.38), P_(0.04, 0, 0.26), 0.05, 0.06), 0.03)                   # the neck
        F.add(S.E(P_(0.0, 0, 0.12), (0.21, 0.12, 0.17), yaw=math.degrees(math.atan2(side[1], side[0]))), 0.06)     # the chest
        F.add(S.RC(P_(-0.05, 0, 0.0), P_(-0.12, 0, -0.35), 0.15, 0.13), 0.06)                # the belly, going into the ice
        for sgn in (-1, 1):
            sh = P_(0.0, sgn * 0.2, 0.22)
            reach = rng.uniform(0.25, 0.75); lift = rng.uniform(-0.15, 0.5)
            el_ = sh + fwd * reach * 0.5 + side * sgn * rng.uniform(0.0, 0.15) + up * lift * 0.5
            wr = el_ + fwd * reach * 0.45 + side * sgn * rng.uniform(-0.1, 0.1) + up * (lift * 0.5 + rng.uniform(-0.05, 0.15))
            F.add(S.RC(sh, el_, 0.05, 0.042), 0.03)
            F.add(S.RC(el_, wr, 0.04, 0.03), 0.02)
            hd = wr + (wr - el_) / (np.linalg.norm(wr - el_) + 1e-6) * 0.06
            F.add(S.E(hd, (0.045, 0.045, 0.02)), 0.015)
            dirh = (wr - el_) / (np.linalg.norm(wr - el_) + 1e-6)
            for fi in range(4):                                      # (fingers, clawing)
                off = side * sgn * (fi - 1.5) * 0.017
                tip = hd + dirh * 0.08 + off + up * (-0.02 * fi * 0.3) - fwd * 0.01
                F.add(S.RC(hd + off, tip, 0.009, 0.006), 0.006)
        # the face: the mouth open (a dark hole), the sockets sunk
        F.cut(S.E(P_(0.24, tilt * 0.1, 0.43), (0.022, 0.03, 0.04)), 0.01)
        for sgn in (-1, 1):
            F.cut(S.B(P_(0.245, sgn * 0.035 + tilt * 0.1, 0.52), 0.022), 0.012)
        F.displace(lambda P: (S.vnoise3(P, 0.04, 70 + k) - 0.5) * 0.012)        # (frost-roughened)
        o = F.mesh(f'_dead{k}')
        m = o.modifiers.new('dc', 'DECIMATE'); m.ratio = min(1.0, 1600 / max(1, C.tris(o)))
        C.apply_modifiers(o)
        o.data.materials.append(M['frozen']); o.data.materials.append(M['rime'])
        for poly in o.data.polygons:
            poly.use_smooth = True
            if poly.normal.z > 0.55 and rng.random() < 0.7: poly.material_index = 1          # (frost on what faces up)
        objs.append(o)
    if not objs: return None
    dead = C.join(objs, 'R_cave_dead')
    C.box_uv(dead.data, 1 / 0.6)
    return dead

def cave(L):
    """the ice cave: a hollow in old glacier ice, its floor lower than the facility's; the Guest on
    its east wall (the frozen dead coming out of the ice, the dark mass among them, its veins over
    the floor and up the walls); three ice pillars holding the roof"""
    M = L.M
    z = F2
    F = S.Field((27.0, -16, z - 3.0), (64, 15, z + 11.5), 0.12, fill=1.0)
    # the hollow: a passage from the door, then the cave (big ellipsoids, a lower floor)
    F.add(S.RC((27.0, 0.0, z + 1.3), (35.0, 0.5, z + 0.9), 1.45, 2.0), 0.5)
    for (c, r) in (((42, 0, z + 2.5), (8.5, 9.5, 5.5)), ((50, -3, z + 3.0), (8.0, 9.0, 6.5)), ((55, 4, z + 2.0), (6.5, 6.0, 5.0)), ((46, 7, z + 1.5), (6, 4.5, 4))):
        F.add(S.E(c, r), 2.0)
    F.invert()                          # (solid = the ice round the hollow)
    F.add(S.BOX((46, 0, z - 2.8), (19, 16, 1.2)), 0.8)
    F.displace(lambda P: (S.fbm3(P, 1.6, 41, 3) - 0.5) * 0.45 + (S.vnoise3(P, 0.25, 42) - 0.5) * 0.05)
    rng = L.rng
    centre = np.array((49.0, 0.0, z + 2.0), np.float32)
    def surf(o, d, far=20.0, step=0.1):
        """march from o along d to where the ice begins"""
        d = np.array(d, np.float32); d /= np.linalg.norm(d)
        q = np.array(o, np.float32)
        for k in range(int(far / step)):
            q = q + d * step
            if F.sample(q) < 0: return q
        return None
    # the frozen dead on the east wall (their places now; their bodies are sculpted finely below)
    bodies = []
    for k in range(70):
        az = math.radians(rng.uniform(-55, 55) if k > 20 else rng.uniform(-28, 28)); el = math.radians(rng.uniform(-18, 38))
        d = (math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))
        q = surf(centre, d)
        if q is None: continue
        if any(np.linalg.norm(q - b[0]) < 0.85 for b in bodies) or len(bodies) >= 46: continue
        bodies.append((q, -np.array(d, np.float32)))
    heart = surf(centre, (1.0, 0.0, 0.18))
    F.displace(lambda P: (S.vnoise3(P, 0.08, 43) - 0.5) * 0.015)        # (a fine grain on everything)
    o = F.mesh('R_cave')
    m = o.modifiers.new('dc', 'DECIMATE'); m.ratio = min(1.0, 70000 / max(1, C.tris(o)))
    C.apply_modifiers(o)
    me = o.data
    me.materials.append(M['cave']); me.materials.append(M['frozen'])
    for poly in me.polygons: poly.use_smooth = True
    dead = frozen_dead(L, bodies, rng)
    C.box_uv(me)
    L.E('ZONE_cave', (46, 0, z + 3), size=[38, 30, 14], ambience='cave', floor=z - 1.6)
    co = o.copy(); co.data = o.data.copy(); co.name = 'COL_cave'
    L.g.objects.link(co)
    m = co.modifiers.new('dc', 'DECIMATE'); m.ratio = 0.25
    C.apply_modifiers(co)
    co.data.materials.clear(); co.data.materials.append(M['col'])
    # the Guest: the dark mass among the dead (a lumpy heart: the game makes it pulse), its veins
    hq = heart if heart is not None else np.array((58.0, 0.0, z + 2.6), np.float32)
    gp = K.Part('GUEST_heart', [M['guest']], L.g)
    for k in range(26):
        a_ = rng.uniform(0, math.tau); r_ = rng.uniform(0, 1) ** 0.6
        gp.sphere(hq[0] + 0.2 + rng.uniform(-0.4, 0.2), hq[1] + math.cos(a_) * r_ * 1.6, hq[2] + math.sin(a_) * r_ * 1.2, rng.uniform(0.25, 0.7) * (1.2 - r_ * 0.5), M['guest'], segs=14, rings=9, sz=rng.uniform(0.7, 1.3))
    ho = gp.done(smooth=True)
    L.E('GUEST_centre', tuple(hq - np.array((0.8, 0, 0), np.float32)))
    vp = K.Part('GUEST_veins', [M['guest']], L.g)
    floor_z = lambda x, y: (lambda q: q[2] + 0.03 if q is not None else z - 1.55)(surf((x, y, z + 2.0), (0, 0, -1), far=6.0, step=0.05))
    for k in range(26):
        a = math.pi + rng.uniform(-1.3, 1.3)
        # down the wall from the heart (along its surface), then out across the floor
        hd = hq - centre; hd /= np.linalg.norm(hd)
        az0 = math.atan2(hd[1], hd[0]) + rng.uniform(-0.12, 0.12); el0 = math.asin(max(-1.0, min(1.0, float(hd[2]))))
        pts = []
        for el in np.linspace(el0 - 0.05, -0.32, 6):
            q = surf(centre, (math.cos(az0) * math.cos(el), math.sin(az0) * math.cos(el), math.sin(el)))
            if q is not None: pts.append(tuple(q - (q - centre) / np.linalg.norm(q - centre) * 0.05))
            az0 += rng.uniform(-0.05, 0.05)
        if not pts: continue
        x_, y_ = pts[-1][0] - 0.4, pts[-1][1]
        for j in range(9):
            a += rng.uniform(-0.35, 0.35)
            x_ += math.cos(a) * rng.uniform(0.7, 1.4); y_ += math.sin(a) * rng.uniform(0.7, 1.4)
            pts.append((x_, y_, floor_z(x_, y_)))
        vp.tube(smooth_path(pts), rng.uniform(0.035, 0.09), M['guest'], 7)
    for k in range(14):                                     # (and up the walls, among the dead)
        az = math.radians(rng.uniform(-60, 60)); pts = []
        for j in range(7):
            el = math.radians(-10 + j * 9 + rng.uniform(-3, 3))
            q = surf(centre, (math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
            if q is None: break
            pts.append(tuple(q - (q - centre) / np.linalg.norm(q - centre) * 0.04))
            az += math.radians(rng.uniform(-6, 6))
        if len(pts) > 2: vp.tube(smooth_path(pts), rng.uniform(0.03, 0.06), M['guest'], 7)
    vp.done(smooth=True)
    # the three pillars: twisted columns of ice from the floor to the roof (the thermite's targets)
    for k, (px, py) in enumerate(((43.5, -5.0), (48.5, 5.5), (52.0, -1.5))):
        top = surf((px, py, z + 1.0), (0, 0, 1), far=12.0, step=0.1)
        bot = surf((px, py, z + 1.0), (0, 0, -1), far=6.0, step=0.05)
        zt = (top[2] if top is not None else z + 8.0) + 0.6; zb = (bot[2] if bot is not None else z - 1.6) - 0.4
        pp = K.Part(f'PILLAR_{k + 1}', [M['cave']], L.g)
        n_ = 10
        for j in range(n_):
            t_ = j / (n_ - 1)
            r_ = 0.95 + 0.6 * (abs(t_ - 0.5) * 2) ** 2.2
            pp.sphere(px + math.sin(t_ * 5.1 + k) * 0.22, py + math.cos(t_ * 4.3 + k) * 0.22, zb + (zt - zb) * t_, r_, M['cave'], segs=16, rings=10, sz=(zt - zb) / n_ / r_ * 1.25)
        o2 = pp.done(smooth=True)
        o2['target'] = 'thermite'
        L.E(f'USE_pillar_{k + 1}', (px - 1.1, py, (bot[2] if bot is not None else z - 1.6) + 1.0), hint='Ледяная колонна', action='thermite', pillar=k + 1)
        cp = K.Part(f'COL_pillar_{k + 1}', [M['col']], L.g)
        cp.cyl(px, py, (zt + zb) / 2, 1.0, zt - zb, None, segs=10)
        cp.done()
    L.E('SPAWN_gromov', (50.0, 0.0, floor_z(50.0, 0.0)), kind='gromov', state='dormant', pose='stand')
    L.E('TRIG_cave_enter', (36.0, 0.0, z + 0.5), size=[3, 6, 3])
    for k, (xx, yy, zz) in enumerate(((40, 0, z + 4), (52, -4, z + 5), (56, 5, z + 4))):
        L.lamp(f'cave_glow_{k}', xx, yy, zz, color=(0.35, 0.55, 0.9), power=6, rng=12, group='cave')

# ---------------------------------------------------------------- the build
def build():
    sc = C.fresh_scene('ASSET_bunker')
    M = materials()
    L = Level(sc, M)
    for name in ROOMS: shell(L, name)
    for d in DOORS: door(L, d)
    for fn in (r_fan, r_guard, r_corA, r_kitchen, r_canteen, r_barracks, r_wash, r_office, r_archive, r_exchange, r_armory, r_infirmary, r_stairs, r_garage, tunnel,
               r_corB, r_cryo, r_lab, r_pump, r_store, r_reactor, sector_g, cave):
        fn(L)
    # the fan room's ceiling has to open into the shaft: drop the slab's collision there
    L.E('BUNKER_info', (0, 0, 0), station=list(STATION_OFFSET), floors=[F1, F2])
    out = []
    for k, p in L.parts.items():
        small = k.endswith('_s')
        o = p.done(sharp=35)
        o['nocast'] = 1 if small else 0
        out.append(o)
    for k, c in L.cols.items(): c.done()
    return sc, L

def export(sc):
    path = os.path.join(C.raw_dir(), 'bunker.glb')
    return [path, C.export_glb(sc, path)]

if __name__ == '__main__' or True:
    C.set_root(globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy'))
    sc, L = build()
    objs = [o for o in sc.objects if o.type == 'MESH']
    result = {'tris': sum(C.tris(o) for o in objs if not o.name.startswith('COL_')), 'col': sum(C.tris(o) for o in objs if o.name.startswith('COL_')),
              'objects': len(objs), 'empties': len([o for o in sc.objects if o.type == 'EMPTY'])}
    if globals().get('PREVIEW', False):
        result['previews'] = C.preview(sc, 'bunker', globals().get('VIEWS', [('top', (0, 0, 80), (0, 0.1, 0), 22)]), res=(1200, 700), world_rgb=(0.2, 0.2, 0.22))
    if globals().get('EXPORT', True): result['export'] = export(sc)
