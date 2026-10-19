# The Polyarnik's rooms on the main deck and the 01 deck: the mess with its galley, the stair hall,
# the stair lobby. Linings (a wood-laminate wainscot to 0.9 m, an aluminium chair rail, cream
# laminate panels above, a dark skirting and a cornice), floors, ceilings, the furniture and the
# clutter of a working tug. Called by make_tug.build() with its context (materials, the collision
# part, the parts list).
import math
import importlib
import kit as K
importlib.reload(K)
from tug_layout import *

def lining(p, M, a, b, z0, z1, holes, wh=0.9, t=0.02, side=1, wains=True):
    """a room's wall lining along a -> b (the room on the left of a -> b when side is 1)"""
    L, ux, uy, rz = K.wall_dir(a, b)
    nx, ny = -uy * side, ux * side
    if wains:
        K.wall(p, a, b, z0, z0 + wh, M['wains'], holes, t)
        K.wall(p, a, b, z0 + wh, z1, M['wall'], holes, t)
    else:
        K.wall(p, a, b, z0, z1, M['wall'], holes, t)
    def runs(z):
        cuts = sorted((c - w / 2 - 0.08, c + w / 2 + 0.08) for c, w, h0, h1 in holes if h0 - 0.08 <= z <= h1 + 0.08)
        out, s = [], 0.0
        for a_, b_ in cuts:
            if a_ > s + 0.02: out.append((s, a_))
            s = max(s, b_)
        if s < L - 0.02: out.append((s, L))
        return out
    def strip(z, h, d, m, bev=0.003):
        for (s0, s1) in runs(z):
            mid = (s0 + s1) / 2
            cx = a[0] + ux * mid + nx * (t / 2 + d / 2); cy = a[1] + uy * mid + ny * (t / 2 + d / 2)
            p.boxc(cx, cy, z, s1 - s0, d, h, m, rz, bevel=bev)
    if wains: strip(z0 + wh, 0.032, 0.014, M['in_steel'])            # the chair rail
    strip(z0 + 0.05, 0.1, 0.012, M['in_dark'], 0.002)                  # skirting
    strip(z1 - 0.025, 0.05, 0.022, M['wall'])                          # cornice

def door_architrave(p, M, a, b, c, w, z0, h, m, side=1, t=0.02):
    """the trim round a door opening on one face of a lining"""
    L, ux, uy, rz = K.wall_dir(a, b)
    nx, ny = -uy * side, ux * side
    for (s, zc, sw, sh) in ((c - w / 2 - 0.035, z0 + h / 2 + 0.035, 0.07, h + 0.07), (c + w / 2 + 0.035, z0 + h / 2 + 0.035, 0.07, h + 0.07), (c, z0 + h + 0.035, w, 0.07)):
        p.boxc(a[0] + ux * s + nx * (t / 2 + 0.008), a[1] + uy * s + ny * (t / 2 + 0.008), zc, sw, 0.016, sh, m, rz, bevel=0.004, segs=2)

def curtains(p, M, x, y, z0, z1, face, w, m):
    """two gathered curtains and a rod at a window (centre x, y on the wall's inner face)"""
    with p.at(x, y, 0, K.FACE[face]):
        p.cyl(0, 0.07, z1 + 0.06, 0.009, w + 0.5, M['in_brass'], axis='X', segs=8)
        for s in (-1, 1):
            xc = s * (w / 2 + 0.06)
            for k in range(4):
                xx = xc + s * (k - 1.5) * 0.045
                p.cyl(xx, 0.07 + 0.012 * (k % 2), (z0 + z1) / 2 - 0.05, 0.03, z1 - z0 + 0.25, m, segs=8)

def tea_glass(p, M, x, y, z):
    """a glass of tea in its brass holder (podstakannik)"""
    p.cyl(x, y, z + 0.045, 0.03, 0.09, M['tea'], segs=10)
    p.cyl(x, y, z + 0.022, 0.034, 0.045, M['in_brass'], segs=12, r2=0.031)
    p.cyl(x, y, z + 0.003, 0.028, 0.006, M['in_brass'], segs=12)
    p.tube([(x + 0.033, y, z + 0.06), (x + 0.058, y, z + 0.052), (x + 0.058, y, z + 0.02), (x + 0.033, y, z + 0.012)], 0.005, M['in_brass'], 5)

def mug(p, M, x, y, z, m):
    p.cyl(x, y, z + 0.05, 0.04, 0.1, m, segs=12)
    p.cyl(x, y, z + 0.098, 0.034, 0.004, M['in_dark'], segs=12)
    p.torus(x + 0.045, y, z + 0.055, 0.025, 0.007, m, axis='Y', segs=10, rsegs=4, arc=math.pi * 1.2, a0=-math.pi * 0.6)

def plate(p, M, x, y, z, r=0.12):
    p.cyl(x, y, z + 0.006, r, 0.012, M['ceramic'], segs=18, r2=r * 0.75)

def bench(p, M, s, y0, y1, z):
    """a built-in mess bench (one side of the table): a wood base, a vinyl seat and back"""
    xf, xb = s * 0.85, s * 1.27
    a, b = sorted((xf + s * 0.03, xb)); p.box(a, y0, z, b, y1, z + 0.08, M['in_dark'])
    a, b = sorted((xf, xb)); p.rbox(a, y0, z + 0.08, b, y1, z + 0.37, M['wood'], r=0.01)
    a, b = sorted((xf - s * 0.02, s * 1.18))
    n = 3
    for k in range(n):
        ya = y0 + (y1 - y0) * k / n + 0.01; yb = y0 + (y1 - y0) * (k + 1) / n - 0.01
        K.cushion(p, a, ya, z + 0.37, b, yb, z + 0.47, M['vinyl'], r=0.035)
        c0, c1 = sorted((s * 1.11, s * 1.2))
        K.cushion(p, c0, ya, z + 0.5, c1, yb, z + 0.93, M['vinyl'], r=0.03)
    a, b = sorted((s * 1.2, s * 1.27)); p.box(a, y0, z + 0.37, b, y1, z + 0.97, M['wood'])
    a, b = sorted((s * 1.17, s * 1.29)); p.rbox(a, y0 - 0.01, z + 0.97, b, y1 + 0.01, z + 1.0, M['wood'], r=0.01)
    for yy in (y0, y1):
        a, b = sorted((xf, s * 1.29)); p.rbox(a, yy - 0.025 if yy == y0 else yy - 0.005, z + 0.37, b, yy + 0.005 if yy == y0 else yy + 0.025, z + 0.62, M['wood'], r=0.01)

def mess_table(p, M, x0, x1, y0, y1, z):
    top = z + 0.76
    p.rbox(x0, y0, top - 0.035, x1, y1, top, M['wood'], r=0.014, segs=3)
    p.box(x0 + 0.035, y0 + 0.035, top, x1 - 0.035, y1 - 0.035, top + 0.002, M['oilcloth'])
    for (a, b, c, d) in ((x0, y0, x0 + 0.03, y1), (x1 - 0.03, y0, x1, y1), (x0, y0, x1, y0 + 0.03), (x0, y1 - 0.03, x1, y1)):
        p.rbox(a, b, top - 0.005, c, d, top + 0.02, M['wood'], r=0.008, segs=2)
    p.box(x0 + 0.06, y0 + 0.06, top - 0.12, x1 - 0.06, y1 - 0.06, top - 0.035, M['wood'])
    for yy in (y0 + 0.6, y1 - 0.6):
        p.cyl((x0 + x1) / 2, yy, z + 0.33, 0.045, 0.62, M['in_dark'], segs=14)
        p.cyl((x0 + x1) / 2, yy, z + 0.012, 0.17, 0.024, M['in_dark'], segs=18, bevel=0.006)
        p.box(x0 + 0.15, yy - 0.04, top - 0.16, x1 - 0.15, yy + 0.04, top - 0.12, M['in_dark'])
        for k in range(4):
            a = k * math.pi / 2 + math.pi / 4
            p.cyl((x0 + x1) / 2 + math.cos(a) * 0.12, yy + math.sin(a) * 0.12, z + 0.026, 0.014, 0.008, M['in_steel'], segs=6)

def stove(p, M, w, depth, z_top=0.88):
    """a marine electric range in the local frame (wall y 0, front y depth): enamel body, a black
    top with four hotplates inside a fiddle rail, the oven door, the knobs, a splashback"""
    hw = w / 2
    p.box(-hw + 0.02, 0, 0, hw - 0.02, depth - 0.06, 0.08, M['in_black'])
    p.rbox(-hw, 0, 0.08, hw, depth, z_top, M['in_enamel'], r=0.012)
    p.rbox(-hw - 0.005, 0, z_top, hw + 0.005, depth + 0.01, z_top + 0.035, M['in_black'], r=0.006)
    for (hx, hy) in ((-0.3, 0.18), (0.3, 0.18), (-0.3, 0.44), (0.3, 0.44)):
        p.cyl(hx, hy, z_top + 0.042, 0.11, 0.014, M['in_dark'], segs=22, bevel=0.003)
        p.torus(hx, hy, z_top + 0.05, 0.075, 0.004, M['in_steel'], segs=18, rsegs=4)
    rail = [(-hw + 0.02, 0.05), (-hw + 0.02, depth - 0.02), (hw - 0.02, depth - 0.02), (hw - 0.02, 0.05)]
    p.tube([(x, y, z_top + 0.1) for x, y in rail], 0.008, M['in_chrome'], 6)
    for (x, y) in rail:
        p.cyl(x, y, z_top + 0.07, 0.006, 0.07, M['in_chrome'], segs=6)
    for yy in (0.16, 0.42):
        p.tube([(-hw + 0.02, yy, z_top + 0.1), (hw - 0.02, yy, z_top + 0.1)], 0.006, M['in_chrome'], 6)
    # the oven door (dark glass, a chrome bar handle) and the knob panel
    p.rbox(-hw + 0.06, depth, 0.16, hw - 0.06, depth + 0.02, 0.62, M['in_enamel'], r=0.01)
    p.box(-hw + 0.16, depth + 0.02, 0.26, hw - 0.16, depth + 0.024, 0.52, M['in_black'])
    p.cyl(0, depth + 0.07, 0.58, 0.012, w - 0.3, M['in_chrome'], axis='X', segs=8)
    for s in (-1, 1):
        p.cyl(s * (hw - 0.17), depth + 0.045, 0.58, 0.008, 0.05, M['in_chrome'], axis='Y', segs=6)
    p.box(-hw + 0.02, depth, 0.66, hw - 0.02, depth + 0.012, 0.84, M['in_steel'])
    for k in range(6):
        kx = -hw + 0.15 + k * (w - 0.3) / 5
        p.cyl(kx, depth + 0.03, 0.75, 0.022, 0.03, M['in_black'], axis='Y', segs=10, bevel=0.004)
    p.box(-hw - 0.05, 0, z_top + 0.035, hw + 0.05, 0.012, z_top + 0.62, M['in_steel'])

def hood(p, M, w, z0, z1, d0, d1):
    """the extractor hood over the stove (local frame), its duct to the ceiling"""
    hw = w / 2
    bm = p.bm; mi = p.mi(M['in_steel'])
    pts = [(-hw, 0, z0), (hw, 0, z0), (hw, d0, z0), (-hw, d0, z0), (-hw + 0.08, 0, z1), (hw - 0.08, 0, z1), (hw - 0.08, d1, z1), (-hw + 0.08, d1, z1)]
    v = [bm.verts.new(p.P(q)) for q in pts]
    for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        fc = bm.faces.new([v[i] for i in f]); fc.material_index = mi
    p.box(-hw + 0.03, 0.02, z0 - 0.012, hw - 0.03, d0 - 0.03, z0, M['in_dark'])
    for k in range(9):
        xx = -hw + 0.08 + k * (w - 0.16) / 8
        p.box(xx - 0.004, 0.04, z0 - 0.016, xx + 0.004, d0 - 0.05, z0 - 0.01, M['in_steel'])
    p.box(-0.16, 0.0, z1, 0.16, 0.26, CEIL1 - DECK + 0.01, M['in_steel'])

def sink_unit(p, M, w, depth, z_top, bx0, bx1):
    """a base cabinet with a steel worktop round a sink basin (bx0..bx1 along the unit), the tap"""
    K.cabinet(p, -w / 2, w / 2, 0, z_top, depth, M['wood'], M['wood'], M['in_chrome'], doors=2)
    by0, by1 = 0.12, depth - 0.1
    T_ = 0.03
    for (a, b, c, d) in ((-w / 2 - 0.01, 0, bx0, depth + 0.025), (bx1, 0, w / 2 + 0.01, depth + 0.025), (bx0, 0, bx1, by0), (bx0, by1, bx1, depth + 0.025)):
        p.box(a, b, z_top, c, d, z_top + T_, M['in_steel'], bevel=0.004)
    p.box(bx0, by0, z_top - 0.18, bx1, by1, z_top - 0.17, M['in_steel'])
    for (a, b, c, d) in ((bx0, by0, bx0 + 0.008, by1), (bx1 - 0.008, by0, bx1, by1), (bx0, by0, bx1, by0 + 0.008), (bx0, by1 - 0.008, bx1, by1)):
        p.box(a, b, z_top - 0.18, c, d, z_top + T_, M['in_steel'])
    p.cyl((bx0 + bx1) / 2, (by0 + by1) / 2, z_top - 0.168, 0.025, 0.004, M['in_dark'], segs=10)
    tx = (bx0 + bx1) / 2
    p.cyl(tx, 0.06, z_top + T_ + 0.02, 0.025, 0.04, M['in_chrome'], segs=10)
    p.tube([(tx, 0.06, z_top + T_ + 0.03), (tx, 0.06, z_top + 0.3), (tx, 0.12, z_top + 0.36), (tx, 0.25, z_top + 0.3), (tx, 0.27, z_top + 0.22)], 0.011, M['in_chrome'], 8)
    for s in (-1, 1):
        p.cyl(tx + s * 0.09, 0.06, z_top + T_ + 0.05, 0.022, 0.03, M['in_chrome'], segs=8)
    # a dish rack on the drainer
    rx0 = bx1 + 0.04
    for k in range(6):
        plate_x = rx0 + 0.04 + k * 0.035
        if plate_x > w / 2 - 0.06: break
        p.cyl(plate_x, depth * 0.5, z_top + T_ + 0.11, 0.1, 0.008, M['ceramic'], axis='X', segs=14)
    p.box(rx0, depth * 0.5 - 0.13, z_top + T_, min(w / 2 - 0.03, rx0 + 0.28), depth * 0.5 + 0.13, z_top + T_ + 0.012, M['in_chrome'])

def urn(p, M, x, y, z):
    """the hot-water urn (a samovar's working cousin)"""
    p.cyl(x, y, z + 0.03, 0.13, 0.06, M['in_chrome'], segs=16, r2=0.11)
    p.cyl(x, y, z + 0.24, 0.14, 0.36, M['in_chrome'], segs=18)
    p.cyl(x, y, z + 0.44, 0.14, 0.04, M['in_chrome'], segs=18, r2=0.1)
    p.cyl(x, y, z + 0.47, 0.03, 0.04, M['in_black'], segs=10)
    p.tube([(x + 0.14, y, z + 0.12), (x + 0.2, y, z + 0.12), (x + 0.22, y, z + 0.09)], 0.012, M['in_chrome'], 6)
    p.box(x + 0.19, y - 0.01, z + 0.13, x + 0.21, y + 0.01, z + 0.17, M['in_black'])
    for s in (-1, 1):
        p.box(x - 0.01, y + s * 0.14, z + 0.38, x + 0.01, y + s * 0.17, z + 0.4, M['in_black'])

def build(ctx):
    M, col, parts = ctx.M, ctx.col, ctx.parts
    x, y0, y1 = DH['x'], DH['y0'], DH['y1']
    xi = x - T / 2 - 0.01                       # the linings' centre line (inside the outer walls)
    rm = K.Part('ROOMS', [M['wall']])           # linings, floors, ceilings
    fu = K.Part('FURNITURE', [M['wood']])       # what stands in them
    sm = K.Part('SMALLS', [M['in_brass']])      # the small things (no shadows needed)
    parts += [rm, fu, sm]
    win1 = (DECK + 1.15, DECK + 1.85)
    door = (DECK, DECK + DOOR_H)
    z0, z1 = DECK + 0.02, CEIL1
    yi0 = y0 + T / 2 + 0.01                     # the aft wall's lining
    mf = MESS[1] - 0.05 - 0.02                  # the mess side of the mess / hall bulkhead (its lining)
    ha = MESS[1] + 0.05 + 0.02                  # the hall side
    hf = HALL[1] - 0.05 - 0.02                  # the hall side of the hall / cabin bulkhead
    # ---------------------------------------------------------------- bulkheads (cores)
    for yy, holes in ((MESS[1], [(x, 0.9, *door)]), (HALL[1], [(x - 1.2, 0.8, *door)])):
        K.wall(rm, (-x + T / 2, yy), (x - T / 2, yy), DECK, L01 - 0.25, M['wall'], holes=holes, t=0.1)
    # ---------------------------------------------------------------- the mess: linings
    lining(rm, M, (xi, yi0), (xi, mf), z0, z1, [(-5.3 - yi0, 0.8, *win1), (-2.7 - yi0, 0.8, *win1)])
    lining(rm, M, (-xi, mf), (-xi, yi0), z0, z1, [(mf + 2.7, 0.8, *win1), (mf + 5.3, 0.8, *win1)])
    lining(rm, M, (-xi, yi0), (xi, yi0), z0, z1, [(xi, 0.9, *door), (xi - 2.6, 0.8, *win1), (xi + 2.6, 0.8, *win1)])
    lining(rm, M, (xi, mf), (-xi, mf), z0, z1, [(xi, 0.9, *door)])
    door_architrave(rm, M, (xi, mf), (-xi, mf), xi, 0.9, DECK, DOOR_H, M['wood'])
    door_architrave(rm, M, (-xi, ha), (xi, ha), xi, 0.9, DECK, DOOR_H, M['wood'])
    # the hall
    lining(rm, M, (xi, ha), (xi, hf), z0, z1, [(0.1 - ha, 0.9, *door)])
    lining(rm, M, (-xi, hf), (-xi, ha), z0, z1, [(hf - 0.1, 0.9, *door)])
    lining(rm, M, (-xi, ha), (xi, ha), z0, z1, [(xi, 0.9, *door)])
    lining(rm, M, (xi, hf), (-xi, hf), z0, z1, [(xi + 1.2, 0.8, *door)])
    door_architrave(rm, M, (xi, hf), (-xi, hf), xi + 1.2, 0.8, DECK, DOOR_H, M['wood'])
    # floors and ceilings
    sd, f1 = STAIR_DN, FLIGHT1
    rm.box(-xi, yi0, DECK, xi, mf, DECK + 0.02, M['floor'])
    for (a, b, c, d) in ((-xi, ha, sd['x0'], hf), (sd['x0'], ha, xi, sd['y0']), (sd['x1'], sd['y0'], xi, hf), (sd['x0'], sd['y1'], sd['x1'], hf)):
        rm.box(a, b, DECK, c, d, DECK + 0.02, M['rubf'])
    for (a0, b0, a1, b1) in ((-xi, yi0, xi, f1['y0']), (-xi, f1['y0'], f1['x0'], hf), (f1['x1'], f1['y0'], xi, hf), (f1['x0'], f1['y1'], f1['x1'], hf)):
        rm.box(a0, b0, CEIL1, a1, b1, CEIL1 + 0.05, M['ceiling'])
    # ---------------------------------------------------------------- the galley (port side)
    wx = -xi + 0.01
    D = 0.6
    with fu.at(wx, -6.45, DECK, K.FACE['+x']):
        K.cabinet(fu, -0.4, 0.4, 0, 2.1, D, M['wood'], M['wood'], M['in_chrome'], doors=1, drawers=0)
        fu.box(-0.4, 0, 2.1, 0.4, D, CEIL1 - DECK, M['wall'])
    with fu.at(wx, -5.5, DECK, K.FACE['+x']):
        sink_unit(fu, M, 1.1, D, 0.88, -0.32, 0.18)
    with fu.at(wx, -4.27, DECK, K.FACE['+x']):
        stove(fu, M, 1.3, D)
        hood(fu, M, 1.25, 1.62, 2.05, 0.6, 0.3)
        K.cage_lamp(fu, 0.0, 0.42, 1.6, M['in_steel'], M['lamp'], M['in_steel'], axis='Z', r=0.04)
    with fu.at(wx, -2.9, DECK, K.FACE['+x']):
        K.cabinet(fu, -0.7, 0.7, 0, 0.88, D, M['wood'], M['wood'], M['in_chrome'], doors=2, drawers=1, top=M['in_steel'])
    # (on the counter: the urn, a bread board and a loaf, mugs; a spice shelf over it)
    urn(sm, M, -3.95, -3.3, DECK + 0.91)
    sm.rbox(-4.05, -2.75, DECK + 0.91, -3.75, -2.4, DECK + 0.93, M['wood'], r=0.006)
    sm.rbox(-3.98, -2.7, DECK + 0.93, -3.82, -2.46, DECK + 1.02, M['bread'], r=0.04, segs=3)
    for i, yy in enumerate((-3.75, -3.62)):
        mug(sm, M, -3.72, yy, DECK + 0.91, M['ceramic'] if i else M['enamel'])
    with K.at_all((fu, sm), wx, -3.38, DECK + 1.45, K.FACE['+x']):
        fu.box(-0.2, 0, 0, 0.2, 0.22, 0.02, M['wood'])
        fu.box(-0.2, 0, 0.3, 0.2, 0.22, 0.32, M['wood'])
        for s in (-1, 1): fu.box(s * 0.2 - 0.01, 0, 0, s * 0.2 + 0.01, 0.22, 0.32, M['wood'])
        for k in range(4):
            sm.cyl(-0.14 + k * 0.095, 0.11, 0.02 + 0.06, 0.03, 0.12, M['in_glass'] if k % 2 else M['ceramic'], segs=10)
    col.box(-x, -6.9, DECK, -3.55, -2.15, DECK + 1.0, M['col'])
    col.box(-x, -6.9, DECK, -3.55, -6.0, CEIL1, M['col'])
    # ---------------------------------------------------------------- the mess table and benches
    mess_table(fu, M, -0.55, 0.55, -5.8, -1.8, DECK)
    for s in (1, -1):
        bench(fu, M, s, -5.8, -1.8, DECK)
    col.box(-1.3, -5.85, DECK, 1.3, -1.75, DECK + 1.0, M['col'])
    for i, (tx, ty) in enumerate(((-0.32, -5.2), (0.3, -4.6), (-0.3, -3.3), (0.32, -2.5))):
        plate(sm, M, tx, ty, DECK + 0.78)
        tea_glass(sm, M, tx + (0.17 if tx < 0 else -0.17), ty + 0.12, DECK + 0.78)
    sm.cyl(0.0, -3.95, DECK + 0.78 + 0.05, 0.14, 0.1, M['wood'], segs=16, r2=0.16)          # the bread basket
    for k in range(3):
        sm.rbox(-0.08 + k * 0.05, -4.02 + k * 0.03, DECK + 0.84, -0.0 + k * 0.05, -3.88 + k * 0.03, DECK + 0.89, M['bread'], r=0.02, segs=2)
    sm.cyl(0.05, -4.6, DECK + 0.78 + 0.06, 0.07, 0.12, M['enamel'], segs=14, r2=0.06)          # the teapot
    sm.tube([(0.12, -4.6, DECK + 0.84), (0.18, -4.6, DECK + 0.9), (0.2, -4.6, DECK + 0.93)], 0.011, M['enamel'], 6)
    for k, m in enumerate((M['ceramic'], M['in_dark'])):
        sm.cyl(-0.05 + k * 0.05, -3.45, DECK + 0.82, 0.016, 0.07, m, segs=8)
    # ---------------------------------------------------------------- starboard: fridge, settee, small table
    with fu.at(xi - 0.01, -6.45, DECK, K.FACE['-x']):
        fu.rbox(-0.4, 0, 0.02, 0.4, 0.64, 1.82, M['in_enamel'], r=0.035, segs=3)
        fu.box(-0.38, 0.62, 1.2, 0.38, 0.645, 1.205, M['in_dark'])
        fu.cyl(-0.3, 0.68, 1.45, 0.012, 0.5, M['in_chrome'], segs=8)
        fu.cyl(-0.3, 0.68, 0.75, 0.012, 0.4, M['in_chrome'], segs=8)
        for zz in (1.2, 1.7, 0.55, 0.95):
            fu.box(-0.31, 0.64, zz - 0.01, -0.29, 0.68, zz + 0.01, M['in_chrome'])
        fu.box(0.12, 0.64, 1.55, 0.3, 0.645, 1.6, M['in_chrome'])
    col.box(3.55, -6.9, DECK, x, -5.95, DECK + 1.9, M['col'])
    sy0, sy1 = -5.8, -3.25
    sx0 = 3.66
    fu.box(sx0 + 0.03, sy0, DECK, xi - 0.01, sy1, DECK + 0.08, M['in_dark'])
    fu.rbox(sx0, sy0, DECK + 0.08, xi - 0.01, sy1, DECK + 0.37, M['wood'], r=0.01)
    for k in range(3):
        ya = sy0 + (sy1 - sy0) * k / 3 + 0.01; yb = sy0 + (sy1 - sy0) * (k + 1) / 3 - 0.01
        K.cushion(fu, sx0 - 0.02, ya, DECK + 0.37, xi - 0.1, yb, DECK + 0.47, M['vinyl'], r=0.035)
        K.cushion(fu, xi - 0.12, ya, DECK + 0.5, xi - 0.02, yb, DECK + 0.92, M['vinyl'], r=0.03)
    for yy in (sy0, sy1):
        fu.rbox(sx0, yy - 0.02, DECK + 0.37, xi - 0.01, yy + 0.02, DECK + 0.6, M['wood'], r=0.01)
    col.box(sx0 - 0.05, sy0, DECK, x, sy1, DECK + 0.95, M['col'])
    fu.rbox(2.85, -5.15, DECK + 0.7, 3.55, -3.85, DECK + 0.74, M['wood'], r=0.012, segs=3)
    fu.cyl(3.2, -4.5, DECK + 0.36, 0.04, 0.68, M['in_dark'], segs=12)
    fu.cyl(3.2, -4.5, DECK + 0.012, 0.16, 0.024, M['in_dark'], segs=16, bevel=0.006)
    col.box(2.8, -5.2, DECK, 3.6, -3.8, DECK + 0.76, M['col'])
    # a chess game on it, a glass of tea
    sm.box(3.0, -4.75, DECK + 0.74, 3.4, -4.35, DECK + 0.75, M['wood_dark'])
    for i in range(8):
        for j in range(8):
            if (i + j) % 2: sm.box(3.0 + i * 0.05, -4.75 + j * 0.05, DECK + 0.75, 3.05 + i * 0.05, -4.7 + j * 0.05, DECK + 0.752, M['wood'])
    for k in range(9):
        px, py = 3.03 + (k * 37 % 8) * 0.05, -4.72 + (k * 53 % 8) * 0.05
        sm.cyl(px, py, DECK + 0.77, 0.012, 0.04, M['in_black'] if k % 2 else M['ceramic'], segs=8)
    tea_glass(sm, M, 3.0, -3.98, DECK + 0.74)
    # radiators (under the windows that have nothing in front of them)
    with fu.at(xi - 0.01, -2.7, DECK, K.FACE['-x']):
        K.radiator(fu, -0.38, 0.38, 0.28, 0.75, M['in_enamel'])
    for xx in (-2.6, 2.6):
        with fu.at(xx, yi0 + 0.01, DECK, K.FACE['+y']):
            K.radiator(fu, -0.38, 0.38, 0.28, 0.75, M['in_enamel'])
    # curtains at every mess window
    for (cx_, cy_, face) in ((xi - 0.01, -5.3, '-x'), (xi - 0.01, -2.7, '-x'), (-xi + 0.01, -5.3, '+x'), (-xi + 0.01, -2.7, '+x'), (-2.6, yi0 + 0.01, '+y'), (2.6, yi0 + 0.01, '+y')):
        curtains(sm, M, cx_, cy_, win1[0], win1[1], face, 0.8, M['curtain'])
    # ---------------------------------------------------------------- the mess's walls: things on them
    # forward bulkhead (faces aft): the notice board, a picture, the clock, the TV, the radio shelf
    with K.at_all((fu, sm), -2.3, mf - 0.01, DECK + 1.5, K.FACE['-y']):
        fu.rbox(-0.5, 0, -0.35, 0.5, 0.025, 0.35, M['wood'], r=0.008)
        fu.box(-0.47, 0.025, -0.32, 0.47, 0.03, 0.32, M['cork'])
        for k in range(6):
            px, pz = -0.38 + (k % 3) * 0.3, 0.12 - (k // 3) * 0.3
            sm.box(px - 0.1, 0.03, pz - 0.13, px + 0.1, 0.033, pz + 0.1, M['paper'] if k % 3 else M['paper2'])
            sm.cyl(px, 0.04, pz + 0.07, 0.008, 0.012, M['sign_red'], axis='Y', segs=6)
    K.picture(fu, -0.95, mf - 0.01, DECK + 1.6, '-y', 0.55, 0.38, M['wood_dark'], M['picture'])
    K.clock(sm, 1.0, mf - 0.01, DECK + 1.78, '-y', 0.13, M['in_black'], M['dial'], M['in_black'])
    with fu.at(2.25, mf - 0.01, DECK + 1.55, K.FACE['-y']):
        fu.box(-0.08, 0, -0.06, 0.08, 0.08, 0.06, M['in_dark'])
        fu.rbox(-0.36, 0.08, -0.23, 0.36, 0.13, 0.23, M['in_black'], r=0.012)
        fu.box(-0.33, 0.13, -0.2, 0.33, 0.132, 0.2, M['tv'])
    with fu.at(3.4, mf - 0.01, DECK + 1.28, K.FACE['-y']):
        fu.rbox(-0.42, 0, 0, 0.42, 0.3, 0.025, M['wood'], r=0.006)
        for s in (-1, 1): fu.box(s * 0.36 - 0.01, 0, -0.15, s * 0.36 + 0.01, 0.02, 0.0, M['in_dark'])
    with fu.at(-3.6, mf - 0.01, DECK + 1.5, K.FACE['-y']):
        K.box_panel(fu, -0.2, 0.2, -0.18, 0.18, 0.12, M['in_enamel'], M['in_enamel'], M['in_chrome'])
        fu.box(-0.03, 0.126, -0.08, 0.03, 0.128, 0.08, M['sign_red'])
        fu.box(-0.08, 0.126, -0.03, 0.08, 0.128, 0.03, M['sign_red'])
    # aft wall (faces forward): coats on their hooks, the extinguisher
    with fu.at(1.1, yi0 + 0.01, DECK + 1.75, K.FACE['+y']):
        fu.rbox(-0.4, 0, -0.04, 0.4, 0.02, 0.04, M['wood'], r=0.006)
        for k in range(4):
            fu.tube([(-0.3 + k * 0.2, 0.01, 0.0), (-0.3 + k * 0.2, 0.07, 0.01), (-0.3 + k * 0.2, 0.08, 0.05)], 0.007, M['in_chrome'], 5)
    K.coat(sm, 0.9, yi0 + 0.01, DECK + 1.74, '+y', M['cloth'])
    K.coat(sm, 1.3, yi0 + 0.01, DECK + 1.74, '+y', M['cloth2'], length=0.8, w=0.46)
    K.extinguisher(fu, -0.95, yi0 + 0.01, DECK, '+y', M['in_red'], M['in_black'], M['in_chrome'])
    K.sign(sm, -0.95, yi0 + 0.015, DECK + 1.55, '+y', 'ОГНЕТУШИТЕЛЬ', 0.035, M['sign_red'], M['sign_white'])
    K.sign(sm, -0.75, ha + 0.01, DECK + 1.62, '+y', 'СТОЛОВАЯ', 0.05, M['sign_blue'], M['sign_white'])
    K.sign(sm, -2.1, mf - 0.01, DECK + 2.05, '-y', 'КАМБУЗ', 0.045, M['sign_blue'], M['sign_white'])
    # the ceiling: two fittings, two vent grilles, a smoke detector
    for yy in (-5.0, -2.2):
        K.fluoro(fu, 0, yy, CEIL1, 1.25, 0.34, M['in_lgrey'], M['diffuser'])
    for (gx, gy) in ((2.3, -4.0), (-2.3, -4.0)):
        K.ceiling_grille(fu, gx, gy, CEIL1, 0.45, 0.25, M['in_lgrey'], M['in_black'])
    fu.cyl(0.0, -3.6, CEIL1 - 0.02, 0.06, 0.04, M['in_enamel'], segs=14, bevel=0.008)
    fu.cyl(0.0, -3.6, CEIL1 - 0.042, 0.008, 0.004, M['led_r'], segs=6)
    # ---------------------------------------------------------------- the hall
    # coats by the starboard door, boots under them
    with fu.at(2.6, ha + 0.01, DECK + 1.75, K.FACE['+y']):
        fu.rbox(-0.5, 0, -0.04, 0.5, 0.02, 0.04, M['wood'], r=0.006)
        for k in range(5):
            fu.tube([(-0.4 + k * 0.2, 0.01, 0.0), (-0.4 + k * 0.2, 0.07, 0.01), (-0.4 + k * 0.2, 0.08, 0.05)], 0.007, M['in_chrome'], 5)
    for k, (cx_, m, ln) in enumerate(((2.25, M['cloth'], 1.0), (2.65, M['cloth2'], 0.85), (3.0, M['cloth'], 0.95))):
        K.coat(sm, cx_, ha + 0.01, DECK + 1.74, '+y', m, length=ln)
    for k in range(3):
        bx = 2.2 + k * 0.32
        for s in (0, 0.13):
            sm.rbox(bx + s, ha + 0.05, DECK + 0.02, bx + s + 0.11, ha + 0.33, DECK + 0.1, M['in_rubber'], r=0.03, segs=2)
            sm.rbox(bx + s, ha + 0.05, DECK + 0.02, bx + s + 0.11, ha + 0.16, DECK + 0.38, M['in_rubber'], r=0.03, segs=2)
    # the lifejacket locker (port wall, by the stair), the hose cabinet, the notice board
    with fu.at(-xi + 0.01, 2.9, DECK + 0.55, K.FACE['+x']):
        fu.rbox(-0.55, 0, 0, 0.55, 0.3, 0.75, M['in_red'], r=0.02)
        fu.box(-0.5, 0.3, 0.05, 0.5, 0.305, 0.7, M['in_red'])
        K.text_flat(fu, 'СПАСАТЕЛЬНЫЕ', 0.06, M['sign_white'], y=0.307)
        with fu.at(0, 0, -0.1):
            K.text_flat(fu, 'ЖИЛЕТЫ', 0.07, M['sign_white'], y=0.307)
        fu.box(-0.12, 0.305, 0.55, 0.12, 0.31, 0.62, M['in_chrome'])
    col.box(-x, 2.3, DECK, -3.85, 3.5, DECK + 1.4, M['col'])
    with K.at_all((fu, sm), 1.95, hf - 0.01, DECK + 0.6, K.FACE['-y']):
        fu.rbox(-0.35, 0, 0, 0.35, 0.22, 0.85, M['in_red'], r=0.02)
        fu.box(-0.3, 0.22, 0.05, 0.3, 0.225, 0.8, M['in_red'])
        fu.box(-0.22, 0.225, 0.38, 0.22, 0.228, 0.72, M['in_glass'])
        sm.torus(0, 0.11, 0.55, 0.15, 0.03, M['in_rubber'], axis='Y', segs=18, rsegs=6)
        K.text_flat(fu, 'ПК', 0.1, M['sign_white'], y=0.228)
    with K.at_all((fu, sm), 0.6, hf - 0.01, DECK + 1.5, K.FACE['-y']):
        fu.rbox(-0.6, 0, -0.35, 0.6, 0.025, 0.35, M['wood'], r=0.008)
        fu.box(-0.57, 0.025, -0.32, 0.57, 0.03, 0.32, M['cork'])
        for k in range(7):
            px, pz = -0.45 + (k % 4) * 0.3, 0.12 - (k // 4) * 0.3
            sm.box(px - 0.1, 0.03, pz - 0.13, px + 0.1, 0.033, pz + 0.12, M['paper'] if k % 2 else M['paper2'])
    K.picture(fu, -2.6, ha + 0.01, DECK + 1.5, '+y', 0.6, 0.45, M['in_chrome'], M['paper2'])
    K.sign(sm, -2.6, ha + 0.02, DECK + 1.82, '+y', 'ПЛАН ЭВАКУАЦИИ', 0.03, M['sign_green'], M['sign_white'])
    K.sign(sm, 3.3, hf - 0.02, DECK + 1.95, '-y', 'МАШИННОЕ ОТДЕЛЕНИЕ', 0.04, M['sign_yellow'], M['in_black'])
    with sm.at(-0.9, ha + 0.01, DECK + 1.35, K.FACE['+y']):
        sm.rbox(-0.09, 0, -0.14, 0.09, 0.07, 0.14, M['in_lgrey'], r=0.01)
        sm.rbox(-0.075, 0.07, -0.1, -0.03, 0.1, 0.1, M['in_black'], r=0.01)
        sm.tube([(-0.05, 0.08, -0.1), (-0.04, 0.12, -0.25), (0.0, 0.1, -0.18), (0.03, 0.08, -0.12)], 0.004, M['in_black'], 4)
    for (sx_, sy_, face) in ((xi - 0.01, 0.1, '-x'), (-xi + 0.01, 0.1, '+x')):
        K.sign(sm, sx_, sy_, DECK + 2.12, face, 'ВЫХОД', 0.05, M['sign_green'], M['sign_white'], w=0.36, h=0.11)
        with sm.at(sx_, sy_ + 0.75, DECK + 1.4, K.FACE[face]):
            sm.rbox(-0.06, 0, -0.06, 0.06, 0.04, 0.06, M['sign_red'], r=0.006)
            sm.box(-0.035, 0.04, -0.035, 0.035, 0.042, 0.035, M['sign_white'])
    K.fluoro(fu, 0, 2.6, CEIL1, 1.25, 0.34, M['in_lgrey'], M['diffuser'])
    K.cable_tray(fu, 0.9, ha + 0.1, 0.9, hf - 0.1, CEIL1, M['in_lgrey'], M['in_black'], w=0.25, n=5, cable_cols=[M['in_black'], M['in_dark'], M['sign_red']])
    K.extinguisher(fu, -2.5, hf - 0.01, DECK, '-y', M['in_red'], M['in_black'], M['in_chrome'])
    # ---------------------------------------------------------------- the lobby (01 deck)
    lb, f2 = LOBBY, FLIGHT2
    lz0, lz1 = L01 + 0.02, CEIL2
    lx0 = -L2['x'] + T / 2 + 0.01
    lxe = lb['x1'] - 0.06 - 0.01
    ly0, ly1 = lb['y0'] + 0.07, lb['y1'] - 0.07
    lining(rm, M, (lx0, ly1), (lx0, ly0), lz0, lz1, [(ly1 - 5.1, 0.9, L01, L01 + DOOR_H), (ly1 - 2.6, 0.8, L01 + 1.1, L01 + 1.8)])
    lining(rm, M, (lx0, ly0), (lxe, ly0), lz0, lz1, [])
    lining(rm, M, (lxe, ly0), (lxe, ly1), lz0, lz1, [])
    lining(rm, M, (lxe, ly1), (lx0, ly1), lz0, lz1, [])
    rm.box(lx0, f2['y0'], L01, lxe, ly1, L01 + 0.02, M['rubf'])
    rm.box(lx0, ly0, L01, f1['x0'], f2['y0'], L01 + 0.02, M['rubf'])
    rm.box(f1['x1'], ly0, L01, lxe, f2['y0'], L01 + 0.02, M['rubf'])
    for (a0, b0, a1, b1) in ((lx0, ly0, f2['x0'], ly1), (f2['x1'], ly0, lxe, ly1), (f2['x0'], f2['y0'], f2['x1'], ly1)):
        rm.box(a0, b0, CEIL2, a1, b1, CEIL2 + 0.05, M['ceiling'])
    K.fluoro(fu, -1.9, 3.0, CEIL2, 1.0, 0.3, M['in_lgrey'], M['diffuser'])
    K.extinguisher(fu, lx0 + 0.01, 4.3, L01, '+x', M['in_red'], M['in_black'], M['in_chrome'])
    K.sign(sm, -1.15, ly1 - 0.01, L01 + 2.0, '-y', 'ХОДОВОЙ МОСТИК', 0.04, M['sign_blue'], M['sign_white'])
    K.picture(fu, lxe - 0.01, 1.6, L01 + 1.55, '-x', 0.5, 0.36, M['wood_dark'], M['picture2'])
    curtains(sm, M, lx0 + 0.01, 2.6, L01 + 1.1, L01 + 1.8, '+x', 0.8, M['curtain_b'])
    return rm, fu, sm
