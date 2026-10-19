# The Polyarnik's wheelhouse: the wraparound console with its instruments (radar, the electronic
# chart, the autopilot, the engine telegraph, the VHF, the switch panels), the overhead repeaters
# above the windows, the helm pedestal, the captain's chair, the chart table, the aft bulkhead's
# lockers. The things you use (wheel, throttle, horn, searchlight joystick, radar screen, radio)
# are INT_ nodes made in make_tug.py; their places here are kept.
import math
import importlib
import kit as K
importlib.reload(K)
import tug_rooms as R
importlib.reload(R)
from tug_layout import *

RAKE = math.tan(math.radians(14))
CY0, CY1 = 7.45, 8.25                         # the console's front and back
ZT = L02 + 0.85                               # its desk's front edge
DESK_A = math.atan2(0.2, 0.5)                 # the desk slopes up 0.2 m over 0.5 m

def desk_z(y):
    return ZT + (y - CY0) * (0.2 / 0.5)

def front_y(z):
    """the inner face of the raked front at height z"""
    return BR['y1'] - 0.06 + (z - L02) * RAKE

def panel_screen(p, M, x0, x1, z0, z1, y, m_screen, bezel=0.03):
    p.rbox(x0, y - 0.02, z0, x1, y + 0.02, z1, M['in_black'], r=0.008)
    p.box(x0 + bezel, y - 0.022, z0 + bezel, x1 - bezel, y - 0.02, z1 - bezel, m_screen)

def button_row(p, M, x0, x1, z, y, n, cols):
    for k in range(n):
        xx = x0 + (x1 - x0) * (k + 0.5) / n
        p.rbox(xx - 0.016, y - 0.012, z - 0.012, xx + 0.016, y, z + 0.012, cols[k % len(cols)], r=0.004, segs=1)

def knob(p, M, x, y, z, r=0.018, axis='Y'):
    p.cyl(x, y, z, r, 0.022, M['in_black'], axis=axis, segs=12, bevel=0.003)

def chair(p, M, x, y, z, yaw=0.0, high=True):
    """the captain's chair: a pedestal on a floor plate, a foot ring, the seat, the back, arms"""
    with p.at(x, y, z, yaw):
        p.cyl(0, 0, 0.015, 0.26, 0.03, M['in_dark'], segs=20, bevel=0.008)
        h = 0.72 if high else 0.45
        p.cyl(0, 0, h / 2, 0.055, h, M['in_chrome'], segs=14)
        if high:
            p.torus(0, 0, 0.32, 0.26, 0.014, M['in_chrome'], segs=24, rsegs=6)
            for k in range(3):
                a = k * 2 * math.pi / 3
                p.tube([(0, 0, 0.32), (math.cos(a) * 0.26, math.sin(a) * 0.26, 0.32)], 0.01, M['in_chrome'], 5)
        p.rbox(-0.27, -0.27, h, 0.27, 0.27, h + 0.05, M['in_dark'], r=0.01)
        K.cushion(p, -0.26, -0.25, h + 0.05, 0.26, 0.27, h + 0.14, M['vinyl_dk'], r=0.04)
        K.cushion(p, -0.25, -0.33, h + 0.12, 0.25, -0.22, h + 0.72, M['vinyl_dk'], r=0.045)
        K.cushion(p, -0.19, -0.33, h + 0.74, 0.19, -0.24, h + 0.88, M['vinyl_dk'], r=0.035)
        for s in (-1, 1):
            p.rbox(s * 0.3 - 0.035, -0.2, h + 0.28, s * 0.3 + 0.035, 0.22, h + 0.33, M['vinyl_dk'], r=0.015)
            p.box(s * 0.29 - 0.012, -0.12, h + 0.05, s * 0.29 + 0.012, -0.08, h + 0.28, M['in_chrome'])
            p.box(s * 0.29 - 0.012, 0.12, h + 0.05, s * 0.29 + 0.012, 0.16, h + 0.28, M['in_chrome'])

def build(ctx):
    M, col, parts = ctx.M, ctx.col, ctx.parts
    bx, by0, by1 = BR['x'], BR['y0'], BR['y1']
    f2 = FLIGHT2
    bz = L02
    br = K.Part('BRIDGE_IN', [M['in_black']])
    bs = K.Part('BRIDGE_SMALLS', [M['in_black']])
    fl = K.Part('BRIDGE_FRONT_IN', [M['wall']])
    parts += [br, bs, fl]
    both = (br, bs)
    # ---------------------------------------------------------------- floor, linings, ceiling
    xi = bx - T / 2 - 0.01
    for (a0, b0, a1, b1) in ((-xi, by0 + 0.07, xi, f2['y1']), (-xi, f2['y1'], f2['x0'], by1 - 0.06), (f2['x1'], f2['y1'], xi, by1 - 0.06), (f2['x0'], f2['y0'], f2['x1'], by1 - 0.06)):
        br.box(a0, b0, bz, a1, b1, bz + 0.02, M['lino_g'])
    br.box(-xi, by0 + 0.07, BRC - 0.02, xi, by1 + 0.6, BRC + 0.03, M['ceiling'])
    win = (bz + 1.05, BRC - 0.25)
    side_h = [(5.3 - by0, 0.9, bz, bz + DOOR_H), (1.6 - by0, 1.2, *win), (3.2 - by0, 1.2, *win), (6.9 - by0, 1.1, *win)]
    yi0 = by0 + T / 2 + 0.01
    yend = by1 - 0.08
    for s in (1, -1):
        if s > 0:
            a, b = (xi, yi0), (xi, yend)
            holes = [(by0 + c - yi0, w, h0, h1) for c, w, h0, h1 in side_h]
        else:
            a, b = (-xi, yend), (-xi, yi0)
            holes = [(yend - (by0 + c), w, h0, h1) for c, w, h0, h1 in side_h]
        R.lining(br, M, a, b, bz + 0.02, BRC - 0.02, holes, wains=False)
    aft_h = [(bx + 1.6, 0.9, bz, bz + DOOR_H), (bx - 2.6, 1.0, *win), (bx + 3.1, 0.8, *win)]
    R.lining(br, M, (-xi, yi0), (xi, yi0), bz + 0.02, BRC - 0.02, [(c - (bx - xi), w, h0, h1) for c, w, h0, h1 in aft_h], wains=False)
    # the raked front's lining (built upright, then raked like the front itself)
    fh = [(0.62 + i * 1.74 - 0.13, 1.42, *win) for i in range(5)]
    K.wall(fl, (-bx + 0.13, by1 - 0.075), (bx - 0.13, by1 - 0.075), bz + 0.02, BRC - 0.02, M['wall'], holes=fh, t=0.02)
    for v in fl.bm.verts:
        v.co.y += (v.co.z - L02) * RAKE
    # a deckhead handrail, the sun blinds rolled up at each front window, the wiper motors
    br.tube([(-3.8, 7.6, BRC - 0.12), (3.8, 7.6, BRC - 0.12)], 0.016, M['in_chrome'], 8)
    for xx in (-3.0, 0.0, 3.0):
        br.tube([(xx, 7.6, BRC - 0.12), (xx, 7.6, BRC - 0.02)], 0.01, M['in_chrome'], 6)
    for i in range(5):
        xc = -bx + 0.62 + i * 1.74
        br.cyl(xc, front_y(BRC - 0.08) - 0.07, BRC - 0.08, 0.035, 1.38, M['in_dark'], axis='X', segs=10)
        br.rbox(xc - 0.06, front_y(BRC - 0.3) - 0.1, BRC - 0.36, xc + 0.06, front_y(BRC - 0.3) - 0.01, BRC - 0.24, M['in_dark'], r=0.01)
    # ceiling lights: a white fitting aft, red night lights forward
    K.fluoro(br, 0.0, 3.0, BRC - 0.02, 1.0, 0.3, M['in_lgrey'], M['diffuser'])
    for (lx, ly) in ((-2.4, 6.6), (2.4, 6.6), (0.0, 5.4)):
        br.cyl(lx, ly, BRC - 0.035, 0.07, 0.03, M['in_dark'], segs=14)
        br.cyl(lx, ly, BRC - 0.052, 0.05, 0.008, M['lampred'], segs=14)
    br.cyl(3.2, 1.65, BRC - 0.08, 0.12, 0.1, M['in_dark'], segs=14)
    # ---------------------------------------------------------------- the console
    br.rbox(-3.5, CY0 + 0.02, bz, 3.5, CY1, ZT, M['in_lgrey'], r=0.015)
    br.box(-3.48, CY0 + 0.05, bz, 3.48, CY1 - 0.02, bz + 0.08, M['in_black'])
    for k in range(7):
        xx = -3.0 + k * 1.0
        br.box(xx - 0.005, CY0 + 0.015, bz + 0.12, xx + 0.005, CY0 + 0.025, ZT - 0.03, M['in_dark'])
    for xx in (-2.5, -0.5, 1.5):
        with br.at(xx, CY0 + 0.02, 0, K.FACE['-y']):
            K.grille(br, -0.25, 0.25, bz + 0.15, bz + 0.3, M['in_dark'], depth=0.01)
    # the sloped desk, and the filler behind it under the instrument risers
    bm = br.bm; mi = br.mi(M['in_lgrey'])
    dz0, dz1 = ZT, desk_z(7.95)
    v = [bm.verts.new(q) for q in ((-3.5, CY0, dz0), (3.5, CY0, dz0), (3.5, 7.95, dz1), (-3.5, 7.95, dz1), (-3.5, CY0, dz0 - 0.06), (3.5, CY0, dz0 - 0.06), (3.5, 7.95, dz1 - 0.06), (-3.5, 7.95, dz1 - 0.06))]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (3, 2, 6, 7), (0, 3, 7, 4), (1, 5, 6, 2)):
        fc = bm.faces.new([v[i] for i in f]); fc.material_index = mi
    br.box(-3.5, 7.9, ZT, 3.5, CY1, dz1, M['in_lgrey'])
    br.tube([(-3.5, CY0 - 0.06, ZT - 0.03), (3.5, CY0 - 0.06, ZT - 0.03)], 0.018, M['in_chrome'], 8)
    for xx in (-3.2, -1.0, 1.0, 3.2):
        br.tube([(xx, CY0 + 0.02, ZT - 0.03), (xx, CY0 - 0.06, ZT - 0.03)], 0.012, M['in_chrome'], 6)
    ang = math.radians(-18)
    for (x0, x1) in ((-3.5, -2.0), (-0.85, -0.25), (0.25, 1.5), (2.95, 3.5)):
        with br.at((x0 + x1) / 2, 8.05, dz1, rx=ang):
            br.rbox(-(x1 - x0) / 2, -0.06, 0, (x1 - x0) / 2, 0.06, 0.62, M['in_lgrey'], r=0.012)
    col.box(-3.5, CY0, bz, 3.5, CY1, bz + 1.08, M['col'])
    # the radar's hood (the INT_radar_main screen leans back in it at (-1.4, 7.93))
    br.rbox(-1.88, 8.06, dz1 - 0.08, -0.92, 8.25, bz + 1.8, M['in_black'], r=0.02)
    for xx in (-1.88, -1.0):
        br.box(xx, 7.82, bz + 1.06, xx + 0.08, 8.07, bz + 1.76, M['in_black'], bevel=0.008)
    br.rbox(-1.88, 7.8, bz + 1.71, -0.92, 8.07, bz + 1.78, M['in_black'], r=0.012)
    for xx in (-1.7, -1.58, -1.22, -1.1):
        knob(bs, M, xx, 7.84, bz + 1.1)
    # the electronic chart (right), its trackball on the desk
    br.rbox(1.6, 7.95, dz1 - 0.02, 2.9, 8.2, bz + 1.58, M['in_black'], r=0.015)
    br.box(1.7, 7.93, bz + 1.12, 2.8, 7.95, bz + 1.49, M['screen2'])
    with K.at_all(both, 2.55, 7.72, desk_z(7.72), rx=DESK_A):
        bs.rbox(-0.15, -0.11, 0, 0.15, 0.11, 0.04, M['in_dark'], r=0.01)
        bs.sphere(0, 0.02, 0.045, 0.03, M['in_black'], segs=10, rings=6)
    # the autopilot (left riser): an amber display and its buttons and dial
    with K.at_all(both, -2.75, 8.0, dz1 + 0.05, rx=ang):
        panel_screen(br, M, -0.4, 0.4, 0.22, 0.44, -0.075, M['screen3'])
        button_row(bs, M, -0.35, 0.35, 0.14, -0.06, 6, [M['in_black'], M['in_black'], M['led_g'], M['in_black']])
        knob(bs, M, 0.0, -0.07, 0.05, r=0.04)
    # the gyro repeater, the rudder indicator, the sonar screen (centre risers)
    with K.at_all(both, -0.55, 8.0, dz1 + 0.05, rx=ang):
        K.gauge(bs, 0.0, -0.06, 0.36, '-y', 0.1, M['in_black'], M['dial'], M['in_glass'], M['sign_red'])
    with K.at_all(both, 0.85, 8.0, dz1 + 0.05, rx=ang):
        K.gauge(bs, -0.3, -0.06, 0.36, '-y', 0.1, M['in_black'], M['dial'], M['in_glass'], M['sign_red'], a=-0.3)
        panel_screen(br, M, 0.05, 0.6, 0.2, 0.5, -0.075, M['screen'])
    # the right riser: the echo sounder and the GPS, a switch panel
    with K.at_all(both, 3.22, 8.0, dz1 + 0.05, rx=ang):
        panel_screen(br, M, -0.25, 0.25, 0.3, 0.55, -0.075, M['screen3'])
        for r_ in range(2):
            button_row(bs, M, -0.24, 0.24, 0.12 + r_ * 0.08, -0.06, 5, [M['in_black'], M['led_g'], M['in_black'], M['led_a']])
    # the engine telegraph head (its main lever is INT_throttle_main)
    bs.rbox(0.95, 7.48, ZT - 0.02, 1.45, 7.95, ZT + 0.16, M['in_dark'], r=0.02)
    for k in range(5):
        bs.box(0.98 + k * 0.1, 7.5, ZT + 0.16, 1.0 + k * 0.1, 7.93, ZT + 0.165, M['sign_white'])
    # switch panels with their lamps along the desk, the VHF block, the horn's and joystick's bases
    for k in range(12):
        xx = -3.25 + k * 0.55
        if -0.4 < xx < 0.4 or 0.8 < xx < 1.6 or -2.05 < xx < -0.9 or 1.6 < xx < 2.95 or xx < -1.95: continue
        with K.at_all(both, xx, 7.65, desk_z(7.65), rx=DESK_A):
            bs.rbox(-0.1, -0.1, 0, 0.1, 0.1, 0.02, M['in_dark'], r=0.006)
            for j in range(3):
                bs.cyl(-0.06 + j * 0.06, 0, 0.03, 0.012, 0.02, M['led_g'] if (k + j) % 4 == 0 else (M['led_a'] if (k + j) % 5 == 0 else M['in_black']), segs=8)
    br.rbox(-3.3, 7.58, ZT - 0.02, -2.0, 8.0, ZT + 0.2, M['in_grey'], r=0.012)
    bs.rbox(-2.4, 7.62, ZT + 0.2, -2.15, 7.75, ZT + 0.25, M['in_black'], r=0.02)               # the VHF handset
    bs.tube([(-2.28, 7.7, ZT + 0.21), (-2.4, 7.64, ZT + 0.14), (-2.55, 7.7, ZT + 0.18), (-2.62, 7.78, ZT + 0.2)], 0.004, M['in_black'], 4)
    bs.cyl(0.55, 7.68, (desk_z(7.68) + L02 + 1.0) / 2, 0.07, L02 + 1.0 - desk_z(7.68) + 0.02, M['in_dark'], segs=14)
    bs.cyl(2.25, 7.68, (desk_z(7.68) + L02 + 1.012) / 2, 0.1, L02 + 1.012 - desk_z(7.68) + 0.02, M['in_dark'], segs=16)
    with K.at_all(both, -0.6, 7.62, desk_z(7.62), rx=DESK_A):           # binoculars
        for s in (-1, 1):
            bs.cyl(s * 0.035, 0, 0.03, 0.028, 0.15, M['in_black'], axis='Y', segs=10)
        bs.box(-0.03, -0.02, 0.02, 0.03, 0.02, 0.05, M['in_black'])
    # ---------------------------------------------------------------- the overhead panel
    for i in range(4):
        xc = -2.4 + i * 1.6
        zc = BRC - 0.2
        with K.at_all(both, xc, front_y(zc) - 0.12, zc, rx=math.radians(25)):
            br.rbox(-0.32, -0.05, -0.16, 0.32, 0.05, 0.16, M['in_black'], r=0.015)
            K.gauge(bs, -0.15, -0.05, 0.0, '-y', 0.1, M['in_dark'], M['dial'], M['in_glass'], M['sign_red'], a=0.4 * (i - 1.5))
            K.gauge(bs, 0.15, -0.05, 0.0, '-y', 0.1, M['in_dark'], M['dial'], M['in_glass'], M['sign_red'], a=-0.6 + i * 0.5)
    # clocks on the aft bulkhead (ship's time, Moscow time), the clinometer on a mullion
    K.clock(bs, -3.35, yi0 + 0.01, bz + 1.85, '+y', 0.12, M['in_brass'], M['dial'], M['in_black'])
    K.clock(bs, -3.75, yi0 + 0.01, bz + 1.45, '+y', 0.1, M['in_brass'], M['dial'], M['in_black'])
    xm = -bx + 0.62 + 2.5 * 1.74
    with bs.at(xm, front_y(bz + 1.6) - 0.03, bz + 1.6, K.FACE['-y']):
        bs.cyl(0, 0.01, 0, 0.11, 0.02, M['in_brass'], axis='Y', segs=24)
        bs.cyl(0, 0.022, 0, 0.095, 0.004, M['dial'], axis='Y', segs=24)
        bs.tube([(0, 0.026, 0.0), (0.02, 0.026, -0.08)], 0.004, M['in_black'], 4)
    # ---------------------------------------------------------------- the helm pedestal (the wheel is INT_wheel_helm)
    br.rbox(-0.22, 6.86, bz, 0.22, 7.22, bz + 0.98, M['in_lgrey'], r=0.03, segs=3)
    br.rbox(-0.25, 6.83, bz, 0.25, 7.25, bz + 0.06, M['in_dark'], r=0.01)
    br.cyl(0, 7.04, bz + 1.02, 0.17, 0.08, M['in_dark'], segs=24, bevel=0.01)
    br.cyl(0, 7.04, bz + 1.08, 0.14, 0.04, M['in_brass'], segs=24, bevel=0.006)
    bs.cyl(0, 7.04, bz + 1.102, 0.12, 0.004, M['dial'], segs=24)
    bs.sphere(0, 7.04, bz + 1.1, 0.12, M['in_glass'], segs=16, rings=6, sz=0.35)
    br.cyl(0, 6.92, bz + 1.18, 0.07, 0.12, M['in_dark'], axis='Y', segs=16)
    col.box(-0.25, 6.83, bz, 0.25, 7.25, bz + 1.0, M['col'])
    # ---------------------------------------------------------------- the captain's chair, the mate's
    chair(br, M, -1.6, 6.3, bz)
    col.box(-1.95, 5.95, bz, -1.25, 6.65, bz + 1.3, M['col'])
    chair(br, M, 1.75, 6.2, bz)
    col.box(1.4, 5.85, bz, 2.1, 6.55, bz + 1.3, M['col'])
    # ---------------------------------------------------------------- the chart table (aft, starboard)
    with br.at(3.2, 1.0, bz, 0.0):
        K.cabinet(br, -0.8, 0.8, 0, 0.92, 1.25, M['wood'], M['wood'], M['in_brass'], doors=0, drawers=4, drawer_h=0.19, top=M['wood'])
    br.box(2.48, 1.08, bz + 0.955, 3.92, 2.22, bz + 0.957, M['chart'])
    for (px, py, w_, h_) in ((2.7, 1.35, 0.5, 0.35), (3.3, 1.8, 0.45, 0.3)):
        bs.box(px - w_ / 2, py - h_ / 2, bz + 0.958, px + w_ / 2, py + h_ / 2, bz + 0.96, M['paper'])
    bs.box(2.9, 1.5, bz + 0.961, 3.5, 1.56, bz + 0.966, M['in_glass'])
    bs.tube([(3.55, 1.3, bz + 0.97), (3.62, 1.36, bz + 1.05), (3.69, 1.3, bz + 0.97)], 0.004, M['in_chrome'], 4)
    bs.cyl(3.75, 2.0, bz + 0.98, 0.07, 0.04, M['in_dark'], segs=12)
    bs.tube([(3.75, 2.0, bz + 1.0), (3.78, 2.05, bz + 1.35), (3.6, 2.0, bz + 1.45)], 0.01, M['in_dark'], 6)
    bs.cyl(3.55, 2.0, bz + 1.42, 0.05, 0.08, M['in_dark'], axis='X', segs=12, r2=0.07)
    bs.rbox(2.6, 2.0, bz + 0.96, 2.95, 2.25, bz + 0.99, M['sign_red'], r=0.005)
    R.mug(bs, M, 3.55, 1.55, bz + 0.96, M['enamel'])
    col.box(2.4, 1.0, bz, 4.0, 2.3, bz + 0.95, M['col'])
    # a shelf between the starboard windows: the Navtex and the GPS
    with br.at(xi - 0.01, 4.3, bz + 1.45, K.FACE['-x']):
        br.box(-0.42, 0, 0, 0.42, 0.3, 0.025, M['wood'])
        for (x0_, x1_, m) in ((-0.4, -0.02, M['screen3']), (0.02, 0.4, M['screen'])):
            br.rbox(x0_, 0.02, 0.025, x1_, 0.27, 0.25, M['in_black'], r=0.01)
            br.box(x0_ + 0.04, 0.27, 0.07, x1_ - 0.04, 0.272, 0.2, m)
    # ---------------------------------------------------------------- the aft bulkhead: lifejackets, a locker
    with K.at_all(both, -3.0, yi0 + 0.01, bz, K.FACE['+y']):
        K.cabinet(br, -0.5, 0.5, 0, 1.0, 0.45, M['in_lgrey'], M['in_lgrey'], M['in_chrome'], doors=2, drawers=0, top=M['in_lgrey'])
        for k in range(3):
            bs.rbox(-0.4 + k * 0.28, 0.1, 1.04, -0.18 + k * 0.28, 0.4, 1.36, M['cloth2'], r=0.06, segs=2)
    col.box(-3.55, yi0, bz, -2.45, yi0 + 0.5, bz + 1.4, M['col'])
    K.extinguisher(br, -1.2, yi0 + 0.01, bz, '+y', M['in_red'], M['in_black'], M['in_chrome'])
    K.sign(bs, -1.6, yi0 + 0.015, bz + 1.95, '+y', 'ХОДОВОЙ МОСТИК', 0.04, M['sign_blue'], M['sign_white'])
    return br, bs, fl
