# The Polyarnik's layout (metres, Blender axes: x starboard, y forward, z up; the waterline at
# z = 0) and her hull's lines. Shared by make_tug.py and the room scripts (tug_rooms, tug_bridge,
# tug_engine, tug_outfit).
import math

DECK, L01, L02, ER = 2.5, 5.0, 7.6, -1.6
FC = L01                                       # the forecastle is level with the 01 deck
BRC, ROOF = 10.15, 10.3                        # bridge ceiling, bridge roof
T = 0.12                                       # wall thickness
DH = dict(x=4.3, y0=-7.0, y1=8.5)              # level 1 (main deck)
MESS = (-7.0, -0.5); HALL = (-0.5, 5.5); CABIN = (5.5, 8.5)
OVER = 5.0                                     # the 01 deck overhangs the walkways to x 5.0
L2 = dict(x=3.5, y0=-2.5, y1=8.2)              # level 2 (01 deck)
LOBBY = dict(x0=-3.38, x1=-0.4, y0=0.6, y1=5.6)
BR = dict(x=4.2, y0=0.4, y1=8.4)               # the bridge (02 deck)
WING = dict(x0=4.2, x1=6.0, y0=4.0, y1=6.6)
ERM = dict(x=4.4, y0=-12.5, y1=8.0)            # engine room
FLIGHT1 = dict(x0=-3.0, x1=-1.9, y0=1.0, y1=4.5)       # hall -> lobby, climbing forward
FLIGHT2 = dict(x0=-1.75, x1=-0.6, y0=4.6, y1=1.1)      # lobby -> bridge, climbing aft
STAIR_DN = dict(x0=2.7, x1=3.9, y0=1.0, y1=5.0)        # hall -> engine room, descending forward
AFT_STAIR = dict(x0=0.85, x1=3.4, y0=-8.25, y1=-7.1)   # aft deck -> 01 landing (both sides, climbing outboard)
DOOR_H = 2.0
CEIL1 = L01 - 0.3                              # level 1's ceiling (the underside of its lining)
CEIL2 = L02 - 0.3
WINCH_Y = -9.9                                 # the towing winch's drum (its axis, athwartships)
WINCH_Z = DECK + 1.15
ROLLER_Y = -19.55                              # the stern roller
ROLLER_Z = DECK + 1.0

def smoothstep(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)

# ---------------------------------------------------------------- hull shape
Y_STERN, Y_BOW_WL, Y_BOW_TOP = -20.0, 19.4, 23.0

def sheer(y):
    """the top of the bulwark: a clean step up to the forecastle, then a little spring to the stem"""
    return 3.55 + 2.5 * smoothstep(6.6, 8.6, y) + max(0.0, y - 15.0) ** 1.5 * 0.035

def keel(y):
    if y < -11.0:
        u = (-11.0 - y) / 9.0
        return -4.3 + 3.35 * u ** 1.5                     # the stern cut up to -0.95 at the transom
    if y > 9.4:
        if y <= Y_BOW_WL:
            return max(-4.3, (y - Y_BOW_WL) * math.tan(math.radians(25)))
        return (y - Y_BOW_WL) * math.tan(math.radians(60))
    return -4.3

def hw(y):
    """waterline half-breadth"""
    if y < -12.0: return 5.6 - 0.85 * ((-12.0 - y) / 8.0) ** 1.6
    if y <= 4.0: return 5.6
    if y >= Y_BOW_WL: return 0.0
    t = (y - 4.0) / (Y_BOW_WL - 4.0)
    return 5.6 * (1.0 - t ** 2.3) ** 0.55

def hd(y):
    """half-breadth at the sheer: full amidships, drawn to a point at the stem"""
    if y < -12.0: return 5.82 - 0.55 * ((-12.0 - y) / 8.0) ** 1.6
    if y <= 4.0: return 5.82
    t = min(1.0, (y - 4.0) / (Y_BOW_TOP - 4.0))
    return 5.82 * max(0.0, 1.0 - t ** 2.2) ** 0.62

def fullness(y):
    if y < -12.0: return 7.0 - 3.5 * ((-12.0 - y) / 8.0)
    if y <= 4.0: return 7.0
    return 7.0 - 5.4 * smoothstep(4.0, 17.0, y)

def half_breadth(y, z):
    """the hull's half-breadth at station y, height z (0 below the keel)"""
    zk, zt = keel(y), sheer(y)
    if z < zk: return 0.0
    w0, w1 = hw(y), hd(y)
    if z <= 0.0:
        if w0 <= 0: return 0.0
        u = (z - zk) / (0.0 - zk) if zk < 0 else 1.0
        return w0 * (1.0 - (1.0 - u) ** fullness(y))
    if w0 > 0:
        t = min(1.0, z / max(zt, 1e-3))
        return w0 + (w1 - w0) * t ** 0.8
    t = min(1.0, (z - zk) / max(zt - zk, 1e-3))
    return w1 * t ** 0.7
