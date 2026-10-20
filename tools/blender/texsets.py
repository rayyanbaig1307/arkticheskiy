# More procedural PBR sets (texlib's conventions: seamless tiles sized in metres, base / normal /
# ORM images, made into Principled materials by texlib.pbr), for Object 7 and the station's rooms:
#
#   concrete_wall    Soviet painted concrete: board-formed underneath, a dado painted green to 1.45 m
#                    with a dark band, whitewash above, peeling to the concrete, damp running down
#                    from the ceiling, rust from the fixings, cracks, frost in the low corners. Its v
#                    is height (box UVs: v = z), so the dado lines up when floors sit on whole tiles.
#   concrete_raw     bare board-formed concrete (the shaft, the plant rooms, the vehicle tunnel)
#   concrete_floor   floor paint over concrete: joints every 3 m, worn to grey in the traffic, cracks
#   tiles            white ceramic tiles, grey grout, chipped and stained (the cryo hall, the lab)
#   rime             hoar frost and ice crust (on walls, pipes, the shaft)
#   cave_ice         old glacier ice, deep blue to black, bubbles and dark veins (the Guest's cave)
#   wallpaper        the station's faded Soviet wallpaper: a damask stripe, seams, damp, peeling
#   floorboards      painted floorboards, worn to the wood where people walk
#   blanket          an army blanket, grey wool, two dark stripes
#   paper            yellowed paper (documents, posters' ground)
import numpy as np
from texlib import Grid, ss, mixc, paint, line_dist, streaks_down, lerp, blur, TAU

def concrete_raw(T=3.0, S=1024, seed=61, col=(0.5, 0.49, 0.46)):
    g = Grid(S, T, seed)
    agg = g.noise(0.004, 2, seed=1)
    pores = ss(2.0, 2.8, g.noise(0.0016, 1, seed=2))
    bd = line_dist(g.v, 0.15)
    joint = np.exp(-(bd / 0.0022) ** 2)
    tone = ((np.floor(g.v / 0.15) * 0.618) % 1.0) - 0.5
    grain = g.noise(0.03, 2, aniso=(8, 1), seed=3)            # (the boards' grain printed in the concrete)
    tie = np.exp(-((line_dist(g.u, 0.6, 0.3) ** 2 + line_dist(g.v, 0.6, 0.3) ** 2) / 0.012 ** 2))
    mott = g.noise(0.35, 4, seed=4)
    base = paint(np.ones_like(agg), col) * (1 + 0.05 * agg + 0.06 * tone + 0.03 * grain + 0.06 * mott)[..., None]
    base *= (1 - 0.35 * pores - 0.18 * joint - 0.5 * tie)[..., None]
    # damp and efflorescence: dark streaks down, white salt bloom where they dried
    src = ss(2.4, 3.1, g.noise(0.02, 3, seed=5))
    wob = 0.5 + 0.5 * ss(-1, 1, g.noise(0.01, 2, aniso=(1, 8), seed=6))
    damp = streaks_down(src, int(0.9 / g.px), 0.992, wob)
    base = mixc(base, (0.28, 0.27, 0.25), np.clip(damp * 0.5, 0, 1))
    salt = ss(1.8, 2.6, g.noise(0.06, 3, seed=7)) * ss(0.1, 0.4, damp)
    base = mixc(base, (0.78, 0.77, 0.72), np.clip(salt * 0.6, 0, 1))
    F1, F2, _ = g.cells(5, 5, seed=8)
    crack = np.exp(-((F2 - F1) / 0.012) ** 2) * ss(0.4, 1.4, g.noise(0.25, 2, seed=9))
    base *= (1 - 0.55 * crack)[..., None]
    h = agg * 0.0004 - pores * 0.0012 - joint * 0.0015 + grain * 0.0002 - tie * 0.006 - crack * 0.0015
    rough = 0.88 + 0.05 * agg - 0.15 * np.clip(damp, 0, 1)
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.3, 1), g.zeros()

def concrete_wall(T=4.5, S=1024, seed=67, dado=1.45, dado_col=(0.16, 0.27, 0.23), upper=(0.74, 0.73, 0.68)):
    g, raw, h, rough, metal = concrete_raw(T, S, seed)
    zt = g.v
    m = (zt < dado).astype(np.float32)
    m = blur(m, 0.6)
    pc = paint(m, dado_col) + paint(1 - m, upper)
    band = np.exp(-((zt - dado) / 0.018) ** 2)
    pc = mixc(pc, (0.07, 0.1, 0.09), band * 0.9)
    brush = g.noise(0.002, 2, aniso=(1, 5), seed=11)
    pc *= (1 + 0.035 * brush + 0.04 * g.noise(0.4, 3, seed=12))[..., None]
    # the paint gone: worst low down (boots, damp) and in big flakes up high
    low = ss(0.5, 0.05, zt)
    peel = ss(1.85 - 0.9 * low, 2.35 - 0.8 * low, g.noise(0.05, 4, seed=13))
    flake_edge = ss(0.0, 0.25, peel) * (1 - ss(0.25, 0.6, peel))
    base = mixc(pc, raw, peel)
    base *= (1 - 0.25 * flake_edge)[..., None]
    # damp from the ceiling, rust from the fixings, grime at hand height
    src = ss(2.0, 2.8, g.noise(0.03, 3, seed=14)) * ss(T - 0.9, T - 0.2, zt)
    wob = 0.5 + 0.5 * ss(-1, 1, g.noise(0.012, 2, aniso=(1, 9), seed=15))
    damp = streaks_down(src, int(2.6 / g.px), 0.995, wob)
    base = mixc(base, (0.36, 0.33, 0.27), np.clip(damp * 0.55, 0, 1))
    rust_src = np.exp(-((line_dist(g.u, 1.5, 0.75) ** 2 + (zt - 2.6) ** 2) / 0.012 ** 2))
    rust = streaks_down(rust_src, int(0.8 / g.px), 0.99, wob)
    base = mixc(base, (0.38, 0.18, 0.08), np.clip(rust * 0.7, 0, 1))
    grime = ss(0.6, 2.0, g.noise(0.3, 3, seed=16)) * ss(0.7, 1.1, zt) * ss(1.7, 1.3, zt)
    base *= (1 - 0.12 * grime)[..., None]
    h = h * (0.4 + 0.6 * peel) + (1 - peel) * 0.0004 + brush * 0.00003
    rough = lerp(0.55 + 0.1 * g.noise(0.2, 2, seed=17), rough, peel) - 0.1 * np.clip(damp, 0, 1)
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.2, 1), metal

def concrete_floor(T=3.0, S=1024, seed=71, col=(0.3, 0.13, 0.085)):
    g, raw, h, rough, metal = concrete_raw(T, S, seed, col=(0.46, 0.45, 0.42))
    jd = np.minimum(line_dist(g.u, 3.0), line_dist(g.v, 3.0))
    joint = np.exp(-(jd / 0.004) ** 2)
    walk = ss(-0.4, 1.4, g.noise(0.5, 3, seed=2))
    worn = ss(1.5 - walk * 0.7, 2.3 - walk * 0.5, g.noise(0.025, 4, seed=3))
    pc = paint(np.ones_like(walk), col) * (1 + 0.05 * g.noise(0.3, 3, seed=4))[..., None]
    base = mixc(pc, raw, np.clip(worn * 0.85 + walk * 0.18, 0, 1))
    sc = g.scr(200, 0.3, 0.0008, seed=5)
    base = mixc(base, (0.5, 0.48, 0.45), sc * 0.4)
    base *= (1 - 0.6 * joint)[..., None]
    spill = ss(2.3, 3.0, g.noise(0.15, 3, seed=6))
    base = mixc(base, (0.1, 0.09, 0.08), spill * 0.5)
    h = h * 0.5 - joint * 0.004 - sc * 0.0002
    rough = 0.7 + 0.15 * worn - 0.35 * spill + 0.05 * sc
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.15, 1), g.zeros()

def tiles(T=1.2, S=1024, seed=73, size=0.15, col=(0.8, 0.82, 0.8), grout=(0.42, 0.41, 0.37)):
    g = Grid(S, T, seed)
    du, dv = line_dist(g.u, size), line_dist(g.v, size)
    d = np.minimum(du, dv)
    gr = ss(0.0028, 0.0012, d)
    tid = (np.floor(g.u / size) * 17 + np.floor(g.v / size) * 31) % 97 / 97.0
    tile_tone = 1 + 0.04 * (tid - 0.5)
    glaze = g.noise(0.05, 2, seed=1)
    base = paint(np.ones_like(d), col) * (tile_tone + 0.015 * glaze)[..., None]
    base = mixc(base, grout, gr)
    # chips at the corners and edges, a few missing tiles, rust and damp stains
    chip = ss(2.5, 3.1, g.noise(0.006, 2, seed=2)) * ss(0.012, 0.0, d)
    missing = (tid > 0.965).astype(np.float32)
    base = mixc(base, (0.48, 0.47, 0.44), np.clip(chip + missing, 0, 1))
    src = ss(2.3, 3.0, g.noise(0.03, 3, seed=3))
    wob = 0.5 + 0.5 * ss(-1, 1, g.noise(0.01, 2, aniso=(1, 8), seed=4))
    stain = streaks_down(src, int(0.7 / g.px), 0.99, wob)
    base = mixc(base, (0.5, 0.36, 0.22), np.clip(stain * 0.45, 0, 1))
    grime = ss(0.5, 2.0, g.noise(0.2, 3, seed=5))
    base = mixc(base, (0.55, 0.55, 0.5), grime * 0.25 * (0.3 + gr))
    h = -gr * 0.0018 - chip * 0.001 - missing * 0.006 + glaze * 0.00003
    rough = 0.12 + 0.6 * gr + 0.5 * np.clip(chip + missing, 0, 1) + 0.25 * grime
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.05, 1), g.zeros()

def rime(T=1.5, S=1024, seed=79):
    g = Grid(S, T, seed)
    F1, F2, _ = g.cells(60, 60, seed=1)
    flake = ss(0.0, 0.5, F2 - F1)
    fine = g.noise(0.002, 2, seed=2)
    big = g.noise(0.15, 4, seed=3)
    thick = ss(-0.8, 1.2, big)
    base = paint(np.ones_like(big), (0.82, 0.87, 0.92)) * (0.88 + 0.12 * flake)[..., None]
    base = mixc(base, (0.55, 0.66, 0.76), (1 - thick) * 0.55)          # (thin rime: the blue ice through it)
    sparkle = ss(2.6, 3.2, g.noise(0.0012, 1, seed=4))
    h = thick * 0.006 + flake * 0.0012 + fine * 0.0003
    rough = 0.55 - 0.35 * sparkle - 0.15 * (1 - thick)
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.05, 1), g.zeros()

def cave_ice(T=6.0, S=1024, seed=83):
    g = Grid(S, T, seed)
    depth = g.noise(0.6, 4, seed=1)
    base = mixc(paint(np.ones_like(depth), (0.1, 0.22, 0.32)), (0.02, 0.04, 0.07), ss(-0.5, 1.4, depth))
    layers = 0.5 + 0.5 * np.sin(TAU * (g.v / 0.35 + g.noise(0.4, 2, seed=2) * 0.4))
    base = mixc(base, (0.25, 0.42, 0.55), layers * 0.18)
    bub = ss(2.4, 3.0, g.noise(0.004, 1, seed=3))
    base = mixc(base, (0.6, 0.72, 0.8), bub * 0.5)
    # the Guest's veins: dark threads through the ice
    rid = 1 - np.abs(g.noise(0.12, 3, seed=4))
    vein = ss(0.86, 0.97, rid / (np.abs(rid).max() + 1e-6))
    base = mixc(base, (0.01, 0.0, 0.01), vein * 0.8)
    F1, F2, _ = g.cells(4, 4, seed=5)
    crack = np.exp(-((F2 - F1) / 0.01) ** 2)
    base = mixc(base, (0.55, 0.7, 0.8), crack * 0.6)
    h = g.noise(0.08, 4, seed=6) * 0.01 - crack * 0.004 + bub * 0.0005
    rough = 0.06 + 0.25 * crack + 0.1 * bub
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.03, 1), g.zeros()

def wallpaper(T=1.06, S=1024, seed=89, col=(0.66, 0.6, 0.47), pat=(0.5, 0.38, 0.26)):
    g = Grid(S, T, seed)
    W_ = 0.53                                            # a roll's width: two strips per tile
    x = (g.u % W_) / W_; y = (g.v % 0.265) / 0.265
    # a damask motif: a lozenge of curls in a stripe, stylised (a sum of cosines, thresholded)
    m = (np.cos(TAU * x * 2) * np.cos(TAU * y) + 0.6 * np.cos(TAU * (x * 4 + y * 2)) * np.cos(TAU * (x * 4 - y * 2))) * 0.5
    mot = ss(0.18, 0.3, m) * ss(0.12, 0.18, np.abs(x - 0.5))
    stripe = ss(0.006, 0.0, np.abs(x - 0.06)) + ss(0.006, 0.0, np.abs(x - 0.94))
    base = paint(np.ones_like(x), col)
    base = mixc(base, pat, np.clip(mot * 0.75 + stripe * 0.6, 0, 1))
    fade = ss(-1, 1.5, g.noise(0.4, 3, seed=1))
    base = mixc(base, (0.72, 0.68, 0.58), fade * 0.25)
    seam = np.exp(-(line_dist(g.u, W_) / 0.0012) ** 2)
    lift = ss(1.6, 2.4, g.noise(0.05, 3, seed=2)) * ss(0.02, 0.0, line_dist(g.u, W_))
    src = ss(2.2, 3.0, g.noise(0.04, 3, seed=3)) * ss(T * 0.6, T, g.v)
    wob = 0.5 + 0.5 * ss(-1, 1, g.noise(0.01, 2, aniso=(1, 8), seed=4))
    damp = streaks_down(src, int(0.8 / g.px), 0.993, wob)
    base = mixc(base, (0.45, 0.38, 0.27), np.clip(damp * 0.5, 0, 1))
    base *= (1 - 0.35 * seam - 0.2 * lift)[..., None]
    h = -seam * 0.0003 + lift * 0.0008 + mot * 0.00005
    rough = 0.78 + 0.08 * lift
    return g, np.clip(base, 0, 1), h, rough, g.zeros()

def floorboards(T=2.4, S=1024, seed=97, col=(0.34, 0.15, 0.09)):
    g = Grid(S, T, seed)
    bw = 0.12
    bv = line_dist(g.v, bw)
    gap = np.exp(-(bv / 0.0015) ** 2)
    row = np.floor(g.v / bw)
    end = np.exp(-(line_dist(g.u + row * 0.77, 1.2) / 0.0015) ** 2)
    grain = g.noise(0.002, 2, aniso=(25, 1), seed=1)
    wood = paint(np.ones_like(grain), (0.48, 0.34, 0.2)) * (1 + 0.1 * grain)[..., None]
    walk = ss(-0.3, 1.4, g.noise(0.45, 3, seed=2))
    worn = np.clip(ss(1.2 - walk, 2.0 - walk * 0.7, g.noise(0.04, 4, seed=3)) + walk * 0.3, 0, 1)
    pc = paint(np.ones_like(grain), col) * (1 + 0.05 * g.noise(0.3, 3, seed=4) + 0.04 * ((row * 0.37) % 1))[..., None]
    base = mixc(pc, wood, worn)
    base *= (1 - 0.7 * np.clip(gap + end, 0, 1))[..., None]
    h = -np.clip(gap + end, 0, 1) * 0.002 + grain * 0.00004
    rough = 0.55 + 0.25 * worn
    return g, np.clip(base, 0, 1), h, rough, g.zeros()

def blanket(T=0.8, S=512, seed=101):
    g = Grid(S, T, seed)
    weave = 0.5 + 0.5 * np.sin(g.u / 0.0012) * np.sin(g.v / 0.0012)
    fuzz = g.noise(0.0015, 2, seed=1)
    st = ss(0.025, 0.018, np.abs((g.v % 0.8) - 0.1)) + ss(0.025, 0.018, np.abs((g.v % 0.8) - 0.7))
    base = paint(np.ones_like(fuzz), (0.33, 0.31, 0.28)) * (0.9 + 0.08 * weave + 0.06 * fuzz)[..., None]
    base = mixc(base, (0.1, 0.1, 0.11), np.clip(st, 0, 1) * 0.85)
    h = weave * 0.0003 + fuzz * 0.0002
    return g, np.clip(base, 0, 1), h, np.full_like(fuzz, 0.95), g.zeros()

def paper(T=0.5, S=512, seed=103, col=(0.82, 0.77, 0.62)):
    g = Grid(S, T, seed)
    fib = g.noise(0.0015, 2, seed=1)
    age = ss(-1, 1.8, g.noise(0.12, 3, seed=2))
    base = paint(np.ones_like(fib), col) * (1 + 0.03 * fib)[..., None]
    base = mixc(base, (0.62, 0.52, 0.34), age * 0.35)
    fox = ss(2.4, 3.0, g.noise(0.01, 2, seed=3))
    base = mixc(base, (0.5, 0.36, 0.2), fox * 0.5)
    h = fib * 0.00005
    return g, np.clip(base, 0, 1), h, np.full_like(fib, 0.85), g.zeros()
