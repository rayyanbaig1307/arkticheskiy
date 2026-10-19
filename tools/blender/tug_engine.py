# The Polyarnik's engine room (z -1.6 .. 2.2, x +-4.4, y -12.5 .. 8.0): two six-cylinder main
# diesels on their seatings with gearboxes and shafts aft, turbochargers and lagged uptakes forward;
# a generator set, the auxiliary boiler, pumps, starting-air bottles and the compressor; pipework
# in its colours with flanges and valves, cable trays, the vent trunk, caged lights; the main
# switchboard, the control console (its switches, start button and needles are INT_ / NEEDLE_
# nodes from make_tug.py at their old places), a workbench, drums. Checker plate floors, framed
# and painted bulkheads, a beamed deckhead.
import math
import importlib
import kit as K
importlib.reload(K)
from tug_layout import *

EX, EY0, EY1 = ERM['x'], ERM['y0'], ERM['y1']
CEIL = DECK - 0.3

def lagged(p, M, pts, r, band=0.6):
    """an insulated pipe (exhaust, steam): cloth lagging with steel bands"""
    out = K.pipe(p, pts, r, M['lagging'], bend=r * 2.2, segs=14)
    L = 0.0
    for i in range(1, len(out)):
        a, b = out[i - 1], out[i]
        d = (b - a); l = d.length
        if l < 1e-6: continue
        n = int((L + l) / band) - int(L / band)
        for k in range(n):
            t = ((int(L / band) + k + 1) * band - L) / l
            c = a + d * t
            dd = d.normalized()
            K.flange(p, c, dd, r * 1.04, 0.012, M['in_dark'], bolts=0)
        L += l

def engine(p, ps, M, col, s):
    """a main engine on the side s (+1 starboard, -1 port), its gearbox and shaft"""
    cx = s * 2.2
    zb = ER
    io = -s                                   # the inboard side's sign
    # seating girders, the bedplate
    for d in (-0.62, 0.62):
        p.box(cx + d - 0.08, -9.7, zb, cx + d + 0.08, -2.5, zb + 0.18, M['in_dark'])
    p.rbox(cx - 0.95, -9.6, zb + 0.18, cx + 0.95, -2.6, zb + 0.42, M['in_dark'], r=0.02)
    # the crankcase, its inspection doors on both sides
    p.rbox(cx - 0.8, -9.35, zb + 0.42, cx + 0.8, -2.8, zb + 1.45, M['in_engine'], r=0.04, segs=2)
    for k in range(6):
        yy = -8.5 + k * 1.0
        for sd in (-1, 1):
            with K.at_all((p, ps), cx + sd * 0.8, yy, zb + 0.92, K.FACE['+x' if sd > 0 else '-x']):
                K.rplate(p, -0.24, -0.22, 0.24, 0.22, 0.0, 0.022, M['in_engine'], r=0.09)
                K.bolts_round(ps, 0, 0, 0.022, 0.2, 0.18, 10, 0.012, M['in_dark'])
                ps.tube([(-0.08, 0.03, 0.0), (-0.08, 0.06, 0.0), (0.08, 0.06, 0.0), (0.08, 0.03, 0.0)], 0.01, M['in_steel'], 5)
    # the cylinder block, six heads and their rocker covers, indicator cocks
    p.rbox(cx - 0.62, -9.05, zb + 1.45, cx + 0.62, -3.0, zb + 2.05, M['in_engine'], r=0.03)
    for k in range(6):
        yy = -8.5 + k * 1.0
        p.rbox(cx - 0.5, yy - 0.43, zb + 2.05, cx + 0.5, yy + 0.43, zb + 2.3, M['in_engine'], r=0.03)
        p.rbox(cx - 0.36, yy - 0.34, zb + 2.3, cx + 0.36, yy + 0.34, zb + 2.46, M['in_grey'], r=0.06, segs=3)
        for (bx_, by_) in ((-0.3, -0.36), (0.3, -0.36), (-0.3, 0.36), (0.3, 0.36)):
            ps.cyl(cx + bx_, yy + by_, zb + 2.32, 0.022, 0.04, M['in_steel'], segs=6)
        ps.cyl(cx + s * 0.52, yy, zb + 2.15, 0.02, 0.12, M['in_steel'], axis='X', segs=8)
        ps.cyl(cx + s * 0.6, yy, zb + 2.15, 0.03, 0.03, M['in_black'], axis='X', segs=8)
        # the fuel pump on the inboard side, its injection pipe up to the head
        p.rbox(cx + io * 0.62 - 0.08, yy - 0.12, zb + 1.35, cx + io * 0.62 + 0.08, yy + 0.12, zb + 1.7, M['in_grey'], r=0.015)
        ps.tube([(cx + io * 0.62, yy, zb + 1.7), (cx + io * 0.62, yy, zb + 1.85), (cx + io * 0.45, yy + 0.05, zb + 2.0), (cx + io * 0.3, yy + 0.05, zb + 2.2)], 0.011, M['in_steel'], 5)
    p.tube([(cx + io * 0.72, -8.9, zb + 1.5), (cx + io * 0.72, -3.1, zb + 1.5)], 0.03, M['in_brown'], 8)
    # the exhaust manifold along the outboard side, lagged, its branches from each head
    lagged(p, M, [(cx + s * 0.78, -8.95, zb + 2.0), (cx + s * 0.78, -2.75, zb + 2.0)], 0.17)
    for k in range(6):
        yy = -8.5 + k * 1.0
        p.cyl(cx + s * 0.58, yy, zb + 2.08, 0.08, 0.2, M['lagging'], axis='X', segs=10)
    # the turbocharger at the forward end: turbine (lagged), compressor, intake silencer
    tz = zb + 2.05
    p.cyl(cx + s * 0.3, -2.25, tz, 0.3, 0.42, M['lagging'], axis='X', segs=20)
    p.cyl(cx - s * 0.12, -2.25, tz, 0.27, 0.32, M['in_lgrey'], axis='X', segs=20, bevel=0.02)
    p.torus(cx - s * 0.12, -2.25, tz, 0.27, 0.06, M['in_lgrey'], axis='X', segs=20, rsegs=8)
    p.cyl(cx - s * 0.5, -2.25, tz, 0.24, 0.38, M['in_grey'], axis='X', segs=20, bevel=0.02)
    for k in range(10):
        ps.cyl(cx - s * (0.36 + k * 0.03), -2.25, tz, 0.245, 0.008, M['in_dark'], axis='X', segs=20)
    p.tube([(cx + s * 0.3, -2.25, tz - 0.3), (cx + s * 0.3, -2.4, zb + 1.85), (cx + s * 0.78, -2.65, zb + 2.0)], 0.13, M['lagging'], 12)
    # charge air: compressor -> cooler (inboard) -> the inlet manifold
    p.rbox(cx + io * 0.85 - 0.2, -3.25, zb + 1.45, cx + io * 0.85 + 0.2, -2.45, zb + 2.0, M['in_lgrey'], r=0.03)
    K.pipe(p, [(cx - s * 0.12, -2.25, tz + 0.25), (cx - s * 0.12, -2.25, tz + 0.42), (cx + io * 0.85, -2.85, tz + 0.42), (cx + io * 0.85, -2.85, zb + 2.0)], 0.1, M['in_lgrey'], flange_m=M['in_dark'], flanges=(0, 3))
    p.tube([(cx + io * 0.68, -3.25, zb + 1.85), (cx + io * 0.68, -9.0, zb + 1.85)], 0.09, M['in_engine'], 12)
    # the uptake: from the turbine up, over and through the deckhead toward the funnel
    lagged(p, M, [(cx + s * 0.3, -2.25, tz + 0.3), (cx + s * 0.3, -2.25, CEIL - 0.45), (s * 0.65, -3.9, CEIL - 0.45), (s * 0.65, -3.9, CEIL + 0.3)], 0.2)
    # the flywheel and its guard, the turning gear, the gearbox, the shaft and its bearing
    p.cyl(cx, -9.8, zb + 0.95, 0.62, 0.36, M['in_dark'], axis='Y', segs=28, bevel=0.02)
    for a in range(12):
        ang = a * math.pi / 6
        ps.cyl(cx + math.cos(ang) * 0.55, -9.6, zb + 0.95 + math.sin(ang) * 0.55, 0.025, 0.04, M['in_steel'], axis='Y', segs=6)
    p.rbox(cx - 0.18, -10.0, zb + 1.5, cx + 0.18, -9.6, zb + 1.75, M['in_yellow'], r=0.02)
    p.rbox(cx - 0.7, -11.15, zb + 0.18, cx + 0.7, -9.98, zb + 1.55, M['in_engine'], r=0.05, segs=2)
    for k in range(4):
        yy = -10.95 + k * 0.3
        for sd in (-1, 1):
            p.box(cx + sd * 0.7 - 0.02, yy - 0.02, zb + 0.3, cx + sd * 0.7 + 0.02 * sd, yy + 0.02, zb + 1.45, M['in_engine'])
    p.cyl(cx, -11.32, zb + 0.75, 0.3, 0.12, M['in_steel'], axis='Y', segs=22, bevel=0.01)
    for a in range(8):
        ang = a * math.pi / 4
        ps.cyl(cx + math.cos(ang) * 0.24, -11.25, zb + 0.75 + math.sin(ang) * 0.24, 0.022, 0.05, M['in_dark'], axis='Y', segs=6)
    p.cyl(cx, (-11.38 + EY0) / 2, zb + 0.75, 0.13, -11.38 - EY0, M['in_steel'], axis='Y', segs=18)
    p.rbox(cx - 0.3, -12.1, zb, cx + 0.3, -11.7, zb + 0.62, M['in_dark'], r=0.02)
    p.cyl(cx, -11.9, zb + 0.75, 0.24, 0.4, M['in_dark'], axis='Y', segs=18)
    col.box(cx - 0.95, -11.2, zb, cx + 0.95, -2.0, zb + 2.55, M['col'])
    col.box(cx - 0.3, EY0, zb, cx + 0.3, -11.2, zb + 0.95, M['col'])
    # the lube oil filters (twin, inboard), the cooling water pump, the local gauge board
    for d in (-0.13, 0.13):
        p.cyl(cx + io * 0.95, -5.5 + d, zb + 1.0, 0.1, 0.45, M['in_grey'], segs=14, bevel=0.015)
    p.box(cx + io * 0.85, -5.7, zb + 0.75, cx + io * 0.82, -5.3, zb + 0.8, M['in_dark'])
    ps.tube([(cx + io * 0.95, -5.5, zb + 1.25), (cx + io * 0.95, -5.5, zb + 1.32), (cx + io * 1.1, -5.5, zb + 1.32)], 0.01, M['in_red'], 4)
    p.cyl(cx + io * 0.55, -2.5, zb + 0.6, 0.2, 0.25, M['in_engine'], axis='Y', segs=18, bevel=0.02)
    with K.at_all((p, ps), cx + io * 0.81, -3.4, zb + 1.2, K.FACE['+x' if io > 0 else '-x']):
        p.rbox(-0.3, 0, -0.18, 0.3, 0.05, 0.18, M['in_dark'], r=0.01)
        for k in range(3):
            K.gauge(ps, -0.19 + k * 0.19, 0.05, 0.02, '+y', 0.075, M['in_black'], M['dial'], M['in_glass'], M['in_red'], a=-0.8 + k * 0.7)
    # the handrail round the engine top (yellow), stanchions
    p.tube([(cx + io * 1.1, -9.3, zb + 1.0), (cx + io * 1.1, -3.6, zb + 1.0)], 0.022, M['in_yellow'], 8)
    for yy in (-9.3, -6.45, -3.6):
        p.cyl(cx + io * 1.1, yy, zb + 0.5, 0.02, 1.0, M['in_yellow'], segs=8)

def build(ctx):
    M, col, parts = ctx.M, ctx.col, ctx.parts
    er = K.Part('ENGINE_ROOM', [M['erwall']])
    ma = K.Part('MACHINERY', [M['in_engine']])
    ps = K.Part('MACHINERY_SMALLS', [M['in_steel']])
    pp = K.Part('PIPEWORK', [M['in_green']])
    parts += [er, ma, ps, pp]
    zb = ER
    sd = STAIR_DN
    # ---------------------------------------------------------------- the space: floor, bulkheads, deckhead
    er.box(-EX, EY0, zb - 0.1, EX, EY1, zb, M['checker'])
    for s in (1, -1):
        er.box(s * 3.3 if s > 0 else -EX, -9.6, zb + 0.001, EX if s > 0 else -3.3, -3.0, zb + 0.004, M['grate'])
    for s in (1, -1):
        er.box(s * EX, EY0, zb, s * (EX + 0.1), EY1, CEIL + 0.05, M['erwall'])
    er.box(-EX, EY0 - 0.1, zb, EX, EY0, CEIL + 0.05, M['erwall'])
    er.box(-EX, EY1, zb, EX, EY1 + 0.1, CEIL + 0.05, M['erwall'])
    er.box(-EX, EY0, CEIL, EX, EY1, CEIL + 0.05, M['in_lgrey'])
    # frames on the sides every 0.6 m (a deep web every 3 m), a stringer; beams under the deckhead
    for s in (1, -1):
        for k, yy in enumerate([EY0 + 0.3 + i * 0.6 for i in range(int((EY1 - EY0 - 0.3) / 0.6))]):
            web = (k % 5 == 0)
            d = 0.28 if web else 0.13
            er.box(s * EX - s * d if s > 0 else -EX, yy - 0.02, zb, s * EX if s > 0 else -EX + d, yy + 0.02, CEIL, M['erwall'])
            if web: er.box(s * EX - s * (d + 0.08) if s > 0 else -EX + d, yy - 0.06, zb, s * EX - s * d if s > 0 else -EX + d + 0.08, yy + 0.06, CEIL, M['erwall'])
        er.box(s * EX - s * 0.2 if s > 0 else -EX, EY0, zb + 2.05, s * EX if s > 0 else -EX + 0.2, EY1, zb + 2.09, M['erwall'])
    for yy in [EY0 + 0.3 + i * 0.6 for i in range(int((EY1 - EY0 - 0.3) / 0.6))]:
        er.box(-EX, yy - 0.03, CEIL - 0.16, EX, yy + 0.03, CEIL, M['in_lgrey'])
    col.box(-EX - 0.1, EY0, zb - 0.2, EX + 0.1, EY1, zb, M['col'])
    for s in (1, -1):
        col.box(s * (EX - 0.15) if s > 0 else -EX - 0.2, EY0, zb, s * (EX + 0.2) if s > 0 else -EX + 0.15, EY1, DECK, M['col'])
    col.box(-EX, EY0 - 0.2, zb, EX, EY0 + 0.05, DECK, M['col'])
    col.box(-EX, EY1 - 0.05, zb, EX, EY1 + 0.2, DECK, M['col'])
    # ---------------------------------------------------------------- the main engines
    for s in (1, -1):
        engine(ma, ps, M, col, s)
    # ---------------------------------------------------------------- the generator set (starboard, forward)
    gx0, gx1, gy0, gy1 = 2.5, 4.15, -1.45, 0.9
    ma.box(gx0, gy0, zb, gx1, gy1, zb + 0.2, M['in_dark'], bevel=0.01)
    gc = (gx0 + gx1) / 2
    ma.rbox(gc - 0.45, gy0 + 0.1, zb + 0.2, gc + 0.45, -0.1, zb + 1.05, M['in_engine'], r=0.03)
    for k in range(4):
        yy = gy0 + 0.25 + k * 0.3
        ma.rbox(gc - 0.32, yy - 0.13, zb + 1.05, gc + 0.32, yy + 0.13, zb + 1.2, M['in_engine'], r=0.02)
    ma.rbox(gc - 0.25, gy0 + 0.15, zb + 1.2, gc + 0.25, -0.15, zb + 1.3, M['in_grey'], r=0.04, segs=2)
    ma.cyl(gc, 0.3, zb + 0.7, 0.42, 0.75, M['in_lgrey'], axis='Y', segs=24, bevel=0.03)
    for k in range(10):
        ps.box(gc - 0.43, 0.0 + k * 0.07, zb + 0.66, gc - 0.41, 0.04 + k * 0.07, zb + 0.74, M['in_dark'])
    ma.rbox(gc - 0.2, 0.05, zb + 1.1, gc + 0.2, 0.55, zb + 1.35, M['in_grey'], r=0.02)
    ps.box(gc - 0.12, 0.06, zb + 1.18, gc + 0.12, 0.055, zb + 1.3, M['sign_white'])
    lagged(pp, M, [(gc - 0.3, gy0 + 0.6, zb + 1.1), (gc - 0.55, gy0 + 0.6, zb + 1.35), (gc - 0.55, gy0 + 0.6, CEIL + 0.2)], 0.09)
    col.box(gx0, gy0 - 0.05, zb, EX, gy1 + 0.05, zb + 1.4, M['col'])
    # ---------------------------------------------------------------- the auxiliary boiler (starboard, aft)
    bxc, byc, br_ = 3.62, -11.7, 0.55
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        ma.cyl(bxc + math.cos(ang) * 0.4, byc + math.sin(ang) * 0.4, zb + 0.15, 0.05, 0.3, M['in_dark'], segs=8)
    ma.cyl(bxc, byc, zb + 1.45, br_, 2.3, M['in_lgrey'], segs=28, bevel=0.03)
    for k in range(5):
        ma.torus(bxc, byc, zb + 0.5 + k * 0.48, br_ + 0.004, 0.008, M['in_dark'], segs=28, rsegs=4)
    ma.sphere(bxc, byc, zb + 2.6, br_ * 0.98, M['in_lgrey'], segs=24, rings=10, sz=0.35)
    # its burner on the front, the fan, the sight port, the gauges, the level glass
    with K.at_all((ma, ps), bxc, byc + br_ - 0.02, zb, K.FACE['+y']):
        ma.rbox(-0.25, 0, 0.45, 0.25, 0.4, 0.95, M['in_red'], r=0.03)
        ma.cyl(0.0, 0.42, 0.7, 0.16, 0.12, M['in_dark'], axis='Y', segs=16)
        ma.cyl(0.38, 0.2, 0.7, 0.13, 0.3, M['in_blue'], axis='X', segs=16, bevel=0.015)
        ps.cyl(-0.12, 0.41, 0.85, 0.03, 0.02, M['screen3'], axis='Y', segs=10)
        K.gauge(ps, -0.18, 0.05, 1.75, '+y', 0.08, M['in_black'], M['dial'], M['in_glass'], M['in_red'], a=0.3)
        K.gauge(ps, 0.18, 0.05, 1.75, '+y', 0.08, M['in_black'], M['dial'], M['in_glass'], M['in_red'], a=-0.5)
        ps.cyl(0.0, 0.08, 1.35, 0.02, 0.5, M['in_glass'], segs=8)
        ps.box(-0.03, 0.04, 1.08, 0.03, 0.1, 1.12, M['in_brass']); ps.box(-0.03, 0.04, 1.58, 0.03, 0.1, 1.62, M['in_brass'])
        K.sign(ps, 0.0, 0.03, 2.2, '+y', 'КОТЕЛ', 0.05, M['sign_yellow'], M['in_black'])
    lagged(pp, M, [(bxc, byc, zb + 2.75), (bxc, byc, CEIL - 0.3), (bxc - 0.6, byc + 0.6, CEIL - 0.3), (bxc - 0.6, byc + 0.6, CEIL + 0.2)], 0.11)
    K.valve(pp, bxc + 0.25, byc, zb + 2.75, 'Z', 0.04, M['in_red'], M['in_red'], up='Z')
    col.box(bxc - br_ - 0.1, byc - br_, zb, EX, byc + br_ + 0.42, zb + 2.8, M['col'])
    # ---------------------------------------------------------------- pumps between the shafts (aft)
    for (px, mcol) in ((-0.75, M['in_green']), (0.75, M['in_red'])):
        ma.box(px - 0.35, -12.3, zb, px + 0.35, -11.0, zb + 0.15, M['in_dark'], bevel=0.01)
        ma.cyl(px, -11.35, zb + 0.45, 0.2, 0.55, M['in_blue'], axis='Y', segs=18, bevel=0.02)
        for k in range(8):
            ps.box(px - 0.205, -11.6 + k * 0.06, zb + 0.43, px - 0.195, -11.57 + k * 0.06, zb + 0.47, M['in_dark'])
        ma.cyl(px, -11.9, zb + 0.45, 0.22, 0.2, mcol, axis='Y', segs=18, bevel=0.02)
        ma.cyl(px, -12.08, zb + 0.45, 0.12, 0.16, mcol, axis='Y', segs=14)
        K.pipe(pp, [(px, -11.9, zb + 0.67), (px, -11.9, zb + 1.2), (px, -12.3, zb + 1.6), (px, -12.3, CEIL - 0.25)], 0.07, mcol, flange_m=mcol, flanges=(0, 1))
        K.valve(pp, px, -11.9, zb + 1.0, 'Z', 0.06, mcol, M['in_red'], up='X' if px > 0 else '-X')
    col.box(-1.15, EY0, zb, 1.15, -10.95, zb + 0.9, M['col'])
    # ---------------------------------------------------------------- drums (port, aft), the daily tank (port wall)
    for k, m in enumerate((M['in_blue'], M['in_red'], M['in_blue'])):
        dx = -3.85 + k * 0.42 if k < 2 else -3.65
        dy = -12.1 if k < 2 else -11.55
        ma.cyl(dx, dy, zb + 0.45, 0.29, 0.88, m, segs=20, bevel=0.015)
        for zz in (0.3, 0.6):
            ma.torus(dx, dy, zb + zz, 0.295, 0.012, m, segs=20, rsegs=4)
        ps.cyl(dx + 0.12, dy + 0.1, zb + 0.9, 0.035, 0.02, M['in_dark'], segs=8)
    ps.cyl(-3.0, -12.1, zb + 0.15, 0.18, 0.3, M['in_lgrey'], segs=14, r2=0.15)
    col.box(-EX, EY0, zb, -3.3, -11.2, zb + 0.95, M['col'])
    ma.rbox(-EX + 0.02, -9.2, zb + 2.1, -EX + 0.62, -6.6, CEIL - 0.25, M['in_brown'], r=0.02)
    ps.cyl(-EX + 0.66, -7.9, zb + 2.6, 0.016, 0.7, M['in_glass'], segs=8)
    K.sign(ps, -EX + 0.63, -8.6, zb + 3.0, '+x', 'ТОПЛИВО', 0.05, M['sign_yellow'], M['in_black'])
    # ---------------------------------------------------------------- pipework along the sides
    runs = [(0.25, 0.07, M['in_green'], 'sea water'), (0.65, 0.05, M['in_brown'], 'fuel'), (1.05, 0.06, M['in_blue'], 'fresh water'),
            (1.5, 0.045, M['in_yellow'], 'lube oil'), (2.75, 0.08, M['in_red'], 'fire main')]
    for s in (1, -1):
        xw = s * (EX - 0.22)
        for i, (zz, r, m, _) in enumerate(runs):
            if s < 0 and zz > 2.5: continue
            y_a, y_b = EY0 + 0.4, EY1 - 0.4
            if s > 0 and zz < 1.4: y_b = gy0 - 0.25      # (round the generator: the low runs stop short)
            if s > 0 and zz < 2.5: y_b = min(y_b, 6.3)     # (and the air bottles)
            if s < 0 and zz > 0.5 and zz < 1.4: y_b = -0.7  # (and the switchboard)
            if s < 0 and zz < 0.5: y_b = 4.7               # (and the fire pump)
            K.pipe(pp, [(xw - s * i * 0.02, y_a, zb + zz), (xw - s * i * 0.02, y_b, zb + zz)], r, m, flange_m=m, flanges=(0, -1))
            for yy in [y_a + 1.2 * k for k in range(int((y_b - y_a) / 1.2) + 1)]:
                pp.box(xw - s * i * 0.02 - 0.02, yy - 0.015, zb + zz - r - 0.03, xw + s * 0.2, yy + 0.015, zb + zz - r, M['in_dark'])
            for yy in [y_a + 3.0 + 4.5 * k for k in range(int((y_b - y_a - 3.0) / 4.5) + 1)]:
                if s > 0 and gy0 - 0.5 < yy < gy1 + 0.5: continue
                K.valve(pp, xw - s * i * 0.02, yy, zb + zz, 'Y', r * 0.9, m, M['in_red'], stem=0.16, up='-X' if s > 0 else 'X')
        # drops from the runs to the engines' sides (sea water to the coolers, fuel to the pumps)
        for yy in (-7.0, -4.0):
            K.pipe(pp, [(xw, yy, zb + 0.25), (xw - s * 0.4, yy, zb + 0.25), (s * 3.05, yy, zb + 0.25), (s * 3.05, yy, zb + 0.6)], 0.05, M['in_green'], flange_m=M['in_green'], flanges=(3,))
    # the vent trunk along the starboard deckhead, its outlets; cable trays both sides
    vt = 0.42
    er.box(EX - 0.35 - vt, -10.6, CEIL - 0.42, EX - 0.35, 6.0, CEIL - 0.02, M['in_lgrey'], bevel=0.01)
    for yy in (-9.5, -6.0, -2.5, 1.5, 4.5):
        with er.at(EX - 0.35 - vt / 2, yy, CEIL - 0.42, rx=-math.pi / 2):
            K.grille(er, -0.18, 0.18, -0.12, 0.12, M['in_dark'], depth=0.01)
    for s in (1, -1):
        K.cable_tray(pp, s * 2.5, EY0 + 0.5, s * 2.5, EY1 - 0.5, CEIL - 0.17, M['in_lgrey'], M['in_black'], w=0.3, n=8,
                     cable_cols=[M['in_black'], M['in_dark'], M['in_black'], M['in_red']])
    # lights: caged fluorescent fittings along the centre line (the LMP_engine lamps)
    for yy in (-10.0, -5.5, -1.0, 3.5):
        ps.rbox(-0.65, yy - 0.08, CEIL - 0.22, 0.65, yy + 0.08, CEIL - 0.16, M['in_lgrey'], r=0.015)
        ps.cyl(0, yy, CEIL - 0.25, 0.04, 1.2, M['lampengine'], axis='X', segs=10)
        for k in range(5):
            xx = -0.55 + k * 0.275
            ps.tube([(xx, yy - 0.08, CEIL - 0.22), (xx, yy - 0.06, CEIL - 0.31), (xx, yy + 0.06, CEIL - 0.31), (xx, yy + 0.08, CEIL - 0.22)], 0.005, M['in_dark'], 4)
        ps.tube([(-0.6, yy - 0.06, CEIL - 0.31), (0.6, yy - 0.06, CEIL - 0.31)], 0.005, M['in_dark'], 4)
        ps.tube([(-0.6, yy + 0.06, CEIL - 0.31), (0.6, yy + 0.06, CEIL - 0.31)], 0.005, M['in_dark'], 4)
    # ---------------------------------------------------------------- the main switchboard (port wall)
    sw0, sw1 = -0.5, 4.5
    for k in range(5):
        y_a, y_b = sw0 + k * 1.0, sw0 + (k + 1) * 1.0
        with K.at_all((er, ps), -EX + 0.01, (y_a + y_b) / 2, zb, K.FACE['+x']):
            er.rbox(-0.49, 0, 0, 0.49, 0.55, 2.1, M['in_lgrey'], r=0.01)
            er.box(-0.48, 0.55, 0.05, 0.48, 0.56, 0.1, M['in_dark'])
            for j in range(3):
                K.gauge(ps, -0.3 + j * 0.3, 0.56, 1.75, '+y', 0.07, M['in_black'], M['dial'], M['in_glass'], M['in_red'], a=-0.9 + (j + k) * 0.35)
            for j in range(4):
                for i in range(2):
                    ps.rbox(-0.36 + j * 0.24, 0.56, 0.95 + i * 0.35, -0.24 + j * 0.24, 0.6, 1.2 + i * 0.35, M['in_black'], r=0.01)
                    ps.box(-0.32 + j * 0.24, 0.6, 1.05 + i * 0.35, -0.28 + j * 0.24, 0.66, 1.1 + i * 0.35, M['in_dark'])
            for j in range(5):
                ps.cyl(-0.36 + j * 0.18, 0.565, 1.5, 0.018, 0.02, [M['led_g'], M['in_black'], M['led_a'], M['in_black'], M['led_r']][(j + k) % 5], axis='Y', segs=8)
            ps.box(-0.25, 0.56, 1.95, 0.25, 0.565, 2.02, M['sign_white'])
            ps.box(0.38, 0.56, 0.4, 0.42, 0.62, 0.7, M['in_chrome'])
    K.sign(ps, -EX + 0.57, 2.0, zb + 2.17, '+x', 'ГРЩ', 0.08, M['sign_white'], M['in_black'], w=0.3)
    col.box(-EX, sw0, zb, -EX + 0.62, sw1, zb + 2.1, M['col'])
    # ---------------------------------------------------------------- the fire pump (port, forward)
    ma.box(-4.25, 5.0, zb, -3.2, 5.7, zb + 0.15, M['in_dark'], bevel=0.01)
    ma.cyl(-3.95, 5.35, zb + 0.45, 0.2, 0.5, M['in_blue'], axis='X', segs=18, bevel=0.02)
    ma.cyl(-3.45, 5.35, zb + 0.45, 0.24, 0.24, M['in_red'], axis='X', segs=18, bevel=0.02)
    K.pipe(pp, [(-3.45, 5.35, zb + 0.69), (-3.45, 5.35, zb + 1.3), (-3.45, 7.7, zb + 1.3), (-3.45, 7.7, CEIL - 0.3)], 0.07, M['in_red'], flange_m=M['in_red'], flanges=(0,))
    K.valve(pp, -3.45, 6.2, zb + 1.3, 'Y', 0.06, M['in_red'], M['in_red'], up='Z')
    K.sign(ps, -EX + 0.14, 5.35, zb + 1.6, '+x', 'ПОЖАРНЫЙ НАСОС', 0.04, M['sign_red'], M['sign_white'])
    col.box(-EX, 4.95, zb, -3.15, 5.75, zb + 0.75, M['col'])
    # ---------------------------------------------------------------- starting air: compressor and bottles (starboard, forward)
    for k, yy in enumerate((6.85, 7.45)):
        ma.cyl(4.1, yy, zb + 0.95, 0.24, 1.7, M['in_red'], segs=20, bevel=0.06)
        ma.sphere(4.1, yy, zb + 1.8, 0.235, M['in_red'], segs=18, rings=8, sz=0.4)
        K.valve(pp, 4.1, yy, zb + 1.95, 'Z', 0.03, M['in_red'], M['in_red'], up='Z', stem=0.1)
        K.gauge(ps, 4.1 - 0.24, yy, zb + 1.5, '-x', 0.06, M['in_black'], M['dial'], M['in_glass'], M['in_red'])
    ma.box(3.0, 6.75, zb, 3.75, 7.75, zb + 0.15, M['in_dark'], bevel=0.01)
    ma.cyl(3.37, 7.0, zb + 0.5, 0.2, 0.55, M['in_blue'], axis='Y', segs=16, bevel=0.02)
    ma.rbox(3.12, 7.3, zb + 0.15, 3.62, 7.7, zb + 0.7, M['in_lgrey'], r=0.03)
    for k in range(6):
        ma.cyl(3.37, 7.5, zb + 0.72 + k * 0.03, 0.17, 0.012, M['in_lgrey'], segs=16)
    K.pipe(pp, [(3.37, 7.5, zb + 0.9), (3.37, 7.5, zb + 1.6), (3.85, 7.15, zb + 1.6), (3.95, 7.15, zb + 1.6)], 0.025, M['in_lgrey'])
    col.box(2.95, 6.6, zb, EX, 7.95, zb + 2.0, M['col'])
    # ---------------------------------------------------------------- the workbench (forward bulkhead, starboard)
    with K.at_all((ma, ps), 1.75, EY1 - 0.01, zb, K.FACE['-y']):
        K.cabinet(ma, -0.8, 0.8, 0, 0.88, 0.65, M['in_lgrey'], M['in_lgrey'], M['in_chrome'], doors=2, drawers=2, drawer_h=0.14, top=M['wood'], top_t=0.05)
        # the vice
        ma.rbox(0.45, 0.4, 0.93, 0.65, 0.62, 1.03, M['in_blue'], r=0.01)
        ma.rbox(0.45, 0.62, 0.93, 0.65, 0.7, 1.05, M['in_blue'], r=0.01)
        ma.cyl(0.55, 0.82, 0.99, 0.015, 0.25, M['in_steel'], axis='Y', segs=8)
        ma.cyl(0.55, 0.95, 0.99, 0.01, 0.2, M['in_steel'], axis='X', segs=6)
        # the tool board and its tools
        ma.box(-0.8, 0, 1.15, 0.8, 0.02, 2.0, M['wood'])
        for k in range(7):
            tx = -0.65 + k * 0.21
            ps.box(tx - 0.02, 0.02, 1.35 + (k % 3) * 0.12, tx + 0.02, 0.035, 1.7 + (k % 3) * 0.12, M['in_steel'] if k % 2 else M['in_red'])
            ps.cyl(tx, 0.03, 1.75 + (k % 3) * 0.12, 0.035, 0.015, M['in_steel'], axis='Y', segs=8)
        for k in range(3):
            ps.torus(-0.3 + k * 0.3, 0.04, 1.25, 0.06, 0.008, M['in_steel'], axis='Y', segs=12, rsegs=4)
        ps.rbox(-0.6, 0.15, 0.93, -0.25, 0.4, 1.05, M['in_red'], r=0.01)
        ps.box(0.0, 0.2, 0.93, 0.25, 0.45, 0.94, M['paper'])
    col.box(0.9, EY1 - 0.7, zb, 2.6, EY1, zb + 1.0, M['col'])
    # ---------------------------------------------------------------- the control console (forward, port)
    er.rbox(-3.6, 6.4, zb, 0.6, 7.2, zb + 0.95, M['in_lgrey'], r=0.015)
    er.box(-3.58, 6.42, zb, 0.58, 7.15, zb + 0.08, M['in_dark'])
    er.rbox(-3.62, 6.38, zb + 0.95, 0.62, 7.22, zb + 1.0, M['in_dark'], r=0.01)
    er.rbox(-3.6, 7.2, zb, 0.6, 7.38, zb + 2.15, M['in_lgrey'], r=0.015)
    er.box(-3.5, 7.19, zb + 1.2, 0.5, 7.2, zb + 2.05, M['in_dark'])
    for (lx, lab) in ((-3.0, 'ЭЛ'), (-2.55, 'ПАЛ'), (-2.1, 'КАЮТ')):
        ps.box(lx - 0.1, 7.181, zb + 1.55, lx + 0.1, 7.19, zb + 1.62, M['dial'])
    ps.box(-0.75, 7.181, zb + 1.25, -0.45, 7.19, zb + 1.32, M['sign_yellow'])
    for k in range(8):
        ps.cyl(-3.2 + k * 0.42, 7.185, zb + 2.0, 0.025, 0.02, [M['led_g'], M['led_a'], M['in_black'], M['led_g']][k % 4], axis='Y', segs=10)
    ps.rbox(-1.6, 6.6, zb + 1.0, -1.1, 6.95, zb + 1.02, M['sign_blue'], r=0.004)
    for i in range(4):
        K.gauge(ps, -3.0 + i * 0.75, 7.2, zb + 1.85, '-y', 0.14, M['in_black'], M['dial'], None, M['in_red'] if False else None)
    with ps.at(-0.2, 7.18, zb + 1.5, K.FACE['-y']):
        ps.rbox(-0.09, 0, -0.14, 0.09, 0.07, 0.14, M['in_black'], r=0.01)
        ps.rbox(-0.075, 0.07, -0.1, -0.03, 0.1, 0.1, M['in_black'], r=0.01)
    col.box(-3.6, 6.4, zb, 0.6, 7.38, zb + 2.15, M['col'])
    # ---------------------------------------------------------------- signs, extinguishers
    K.sign(ps, 0.0, EY1 - 0.01, zb + 2.6, '-y', 'НЕ КУРИТЬ!', 0.07, M['sign_red'], M['sign_white'])
    K.sign(ps, EX - 0.14, -6.0, zb + 2.6, '-x', 'ОСТОРОЖНО! ГОРЯЧИЕ ПОВЕРХНОСТИ', 0.04, M['sign_yellow'], M['in_black'])
    K.sign(ps, -EX + 0.14, -4.0, zb + 2.6, '+x', 'РАБОТАТЬ В НАУШНИКАХ', 0.04, M['sign_blue'], M['sign_white'])
    K.extinguisher(ma, 0.77, EY1 - 0.01, zb, '-y', M['in_red'], M['in_black'], M['in_chrome'], h=0.7, r=0.11)
    K.extinguisher(ma, -1.5, EY0 + 0.01, zb, '+y', M['in_red'], M['in_black'], M['in_chrome'], h=0.7, r=0.11)
    # the stair's landing: a yellow-striped edge
    for k in range(6):
        ps.box(sd['x0'] + k * 0.2, sd['y1'] + 0.05, zb + 0.001, sd['x0'] + k * 0.2 + 0.1, sd['y1'] + 0.12, zb + 0.004, M['in_yellow'])
    return er, ma, ps, pp
