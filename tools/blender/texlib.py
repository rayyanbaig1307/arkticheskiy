# Procedural PBR texture sets for the Polyarnik (numpy, run inside Blender's Python).
#
# Each set tiles with no seam: the noise is white noise filtered in the frequency domain (so it is
# periodic by construction), and cells, seams and lugs are laid out on whole periods of the tile.
# A set is sized in metres (its tile) and comes as three images:
#
#   <name>_base   base colour, sRGB
#   <name>_nrm    normal map, OpenGL (+Y up), non-colour
#   <name>_orm    R 1, G roughness, B metalness (glTF's metallicRoughness), non-colour
#
# pbr() makes the Principled material that reads them; its 'tile' property tells the box-mapped
# UVs of every part how many metres one repeat covers (common.box_uv).
#
# Image rows run bottom-up in Blender: row index = v. Arrays here are (rows, cols) = (v, u).
import numpy as np
import bpy

TAU = 2 * np.pi

# ---------------------------------------------------------------- noise and shapes
def _blur_f(H, W, su, sv):
    fy = np.fft.fftfreq(H)[:, None]
    fx = np.fft.rfftfreq(W)[None, :]
    return np.exp(-2 * np.pi ** 2 * ((su * fx) ** 2 + (sv * fy) ** 2)).astype(np.float32)

def blur(a, su, sv=None):
    """periodic gaussian blur; sigma in pixels along u (columns) and v (rows)"""
    sv = su if sv is None else sv
    H, W = a.shape
    return np.fft.irfft2(np.fft.rfft2(a) * _blur_f(H, W, su, sv), s=(H, W)).astype(np.float32)

def white(H, W, seed):
    return np.random.default_rng(seed).standard_normal((H, W)).astype(np.float32)

def fbm(H, W, sigma, seed, octaves=4, gain=0.5, aniso=(1.0, 1.0)):
    """fractal noise, zero mean, std about 1; sigma (pixels) is the coarsest octave's blur"""
    out = np.zeros((H, W), np.float32); amp = 1.0; tot = 0.0
    for i in range(octaves):
        s = sigma / 2 ** i
        n = blur(white(H, W, seed * 131 + i * 7), max(0.35, s * aniso[0]), max(0.35, s * aniso[1]))
        n /= n.std() + 1e-8
        out += n * amp; tot += amp * amp; amp *= gain
    return out / np.sqrt(tot)

def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def lerp(a, b, t):
    return a + (b - a) * t

def line_dist(c, period, offset=0.0):
    """distance (same units as c) to the nearest of a family of lines every `period`"""
    q = (c - offset) / period
    return np.abs(q - np.round(q)) * period

def worley(H, W, cy, cx, seed):
    """periodic cellular noise on a jittered cy x cx grid: F1, F2 (cell units) and the cell id"""
    r = np.random.default_rng(seed)
    jit = r.random((cy, cx, 2)).astype(np.float32)
    Y = ((np.arange(H, dtype=np.float32) + 0.5) / H * cy)[:, None] * np.ones((1, W), np.float32)
    X = ((np.arange(W, dtype=np.float32) + 0.5) / W * cx)[None, :] * np.ones((H, 1), np.float32)
    iy, ix = np.floor(Y).astype(np.int32), np.floor(X).astype(np.int32)
    F1 = np.full((H, W), 9.0, np.float32); F2 = np.full((H, W), 9.0, np.float32); ID = np.zeros((H, W), np.int32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ny, nx = iy + dy, ix + dx
            my, mx = ny % cy, nx % cx
            py = ny + jit[my, mx, 0]; px = nx + jit[my, mx, 1]
            d = np.hypot(Y - py, X - px)
            closer = d < F1
            F2 = np.where(closer, F1, np.minimum(F2, d))
            ID = np.where(closer, my * cx + mx, ID)
            F1 = np.where(closer, d, F1)
    return F1, F2, ID

def scratches(H, W, n, length_px, width_px, seed, angle=None, spread=np.pi):
    """thin random strokes (wrapping round the tile): a 0..1 mask"""
    r = np.random.default_rng(seed)
    out = np.zeros((H, W), np.float32)
    for _ in range(n):
        L = length_px * (0.4 + r.random() * 0.9)
        a = (angle if angle is not None else 0.0) + (r.random() - 0.5) * spread
        ca, sa = np.cos(a), np.sin(a)
        cx, cy = r.random() * W, r.random() * H
        hw = int(abs(ca) * L / 2 + width_px * 3 + 2), int(abs(sa) * L / 2 + width_px * 3 + 2)
        xs = np.arange(int(cx) - hw[0], int(cx) + hw[0] + 1)
        ys = np.arange(int(cy) - hw[1], int(cy) + hw[1] + 1)
        X, Y = np.meshgrid(xs - cx, ys - cy)
        t = np.clip(X * ca + Y * sa, -L / 2, L / 2)
        d = np.hypot(X - t * ca, Y - t * sa)
        taper = 1 - (np.abs(t) / (L / 2)) ** 2
        val = np.exp(-(d / max(width_px, 0.3)) ** 2) * taper * (0.4 + 0.6 * r.random())
        out[np.ix_(ys % H, xs % W)] = np.maximum(out[np.ix_(ys % H, xs % W)], val.astype(np.float32))
    return out

def streaks_down(mask, rows, decay=0.97, wobble=None):
    """runs from every spot of `mask` downwards (towards row 0) over `rows` pixels, fading"""
    out = mask.copy(); acc = mask.copy(); w = 1.0
    for k in range(1, rows):
        w *= decay
        acc = np.roll(acc, -1, axis=0)
        out = np.maximum(out, acc * w)
    if wobble is not None:
        out *= wobble
    return out

def normal_from_height(h, px_m, strength=1.0):
    """height (metres) to an OpenGL normal map (0..1)"""
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * (0.5 / px_m) * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * (0.5 / px_m) * strength
    n = np.dstack([-gx, -gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return (n * 0.5 + 0.5).astype(np.float32)

def rgb(c):
    return np.array(c, np.float32)[None, None, :]

def paint(mask, col):
    """mask (H, W) times a colour -> (H, W, 3)"""
    return mask[..., None] * rgb(col)

def mixc(base, col, t):
    """blend an (H, W, 3) image toward a colour (or image) by t (H, W)"""
    c = rgb(col) if not isinstance(col, np.ndarray) or col.ndim == 1 else col
    return base + (c - base) * t[..., None]

class Grid:
    """a square tile of S pixels covering T metres: u (columns) and v (rows) in metres"""
    def __init__(self, S, T, seed, H=None):
        self.S = S; self.H = H or S; self.T = T; self.px = T / S; self.seed = seed
        self.u = ((np.arange(S, dtype=np.float32) + 0.5) * self.px)[None, :] * np.ones((self.H, 1), np.float32)
        self.v = ((np.arange(self.H, dtype=np.float32) + 0.5) * self.px)[:, None] * np.ones((1, S), np.float32)
    def noise(self, sigma_m, octaves=4, gain=0.5, aniso=(1, 1), seed=0):
        return fbm(self.H, self.S, sigma_m / self.px, self.seed * 977 + seed, octaves, gain, aniso)
    def zeros(self):
        return np.zeros((self.H, self.S), np.float32)
    def scr(self, n, length_m, width_m, seed=0, angle=None, spread=np.pi):
        return scratches(self.H, self.S, n, length_m / self.px, width_m / self.px, self.seed * 31 + seed, angle, spread)
    def cells(self, n_v, n_u, seed=0):
        return worley(self.H, self.S, n_v, n_u, self.seed * 53 + seed)

# ---------------------------------------------------------------- the sets
# each returns (grid, base (H, W, 3) sRGB 0..1, height (H, W) metres, rough, metal)

def wall_panel():
    """cabin linings: cream laminate panels a metre wide, joined by aluminium H-strips"""
    g = Grid(1024, 3.0, 1)
    du = line_dist(g.u, 1.0)
    strip = ss(0.0105, 0.0085, du)
    groove = np.exp(-((du - 0.011) / 0.0012) ** 2)
    pid = np.floor(g.u / 1.0).astype(int) % 3
    tint = np.array([1.0, 0.975, 1.012])[pid]
    peel = g.noise(0.0015, 2) * 0.00008
    grime = ss(0.2, 1.6, g.noise(0.35, 4, seed=2))
    smudge = ss(1.6, 2.8, g.noise(0.06, 3, seed=3)) * 0.4
    base = paint(tint, (0.80, 0.76, 0.63)) * (1 - 0.07 * grime - 0.05 * smudge)[..., None]
    base = mixc(base, (0.63, 0.64, 0.65), strip)
    base *= (1 - 0.55 * groove)[..., None]
    h = peel * (1 - strip) + strip * 0.0012 - groove * 0.0008
    rough = 0.42 + 0.05 * g.noise(0.2, 2, seed=4) + 0.08 * smudge
    rough = lerp(rough, 0.38, strip)
    metal = strip * 0.9
    return g, base, h, rough, metal

def wood(ring_m=0.0055, col=(0.62, 0.44, 0.27), dark=(0.42, 0.26, 0.14), T=1.5, S=1024, seed=5, varnish=0.32, joints=None):
    """flat-sawn wood, grain along u: rings bent by slow noise, pores, figure, colour drift"""
    g = Grid(S, T, seed)
    ring_m = T / round(T / ring_m)
    bend = g.noise(0.3, 3, aniso=(5, 1), seed=1) * 0.012 + g.noise(0.05, 2, aniso=(6, 1), seed=2) * 0.0018
    r = (g.v + bend) / ring_m
    ring = (0.5 + 0.5 * np.cos(TAU * r)) ** 3
    fibre = g.noise(0.0012, 2, aniso=(30, 1), seed=3)
    pores = ss(1.6, 2.6, g.noise(0.0007, 1, aniso=(12, 1), seed=4))
    drift = g.noise(0.4, 3, seed=5)
    t = np.clip(ring * 0.75 + fibre * 0.08 + drift * 0.08, 0, 1)
    base = mixc(paint(np.ones_like(t), col), dark, t)
    base *= (1 + 0.06 * drift)[..., None]
    base *= (1 - 0.35 * pores)[..., None]
    h = -pores * 0.00012 + fibre * 0.00002
    if joints:
        dj = line_dist(g.u, joints)
        j = np.exp(-(dj / 0.0009) ** 2)
        base *= (1 - 0.7 * j)[..., None]; h -= j * 0.0006
    wear = ss(1.0, 2.4, g.noise(0.12, 3, seed=6))
    sc = g.scr(60, 0.08, 0.0004, seed=7)
    base = mixc(base, (col[0] * 1.15, col[1] * 1.1, col[2] * 1.05), sc * 0.6)
    rough = varnish + 0.12 * wear + 0.25 * sc + 0.03 * g.noise(0.05, 2, seed=8)
    metal = g.zeros()
    return g, np.clip(base, 0, 1), h, rough, metal

def ceiling():
    """perforated ceiling panels 0.6 m square on an aluminium T-bar grid"""
    g = Grid(1024, 1.2, 9)
    du, dv = line_dist(g.u, 0.6), line_dist(g.v, 0.6)
    d = np.minimum(du, dv)
    bar = ss(0.0095, 0.0075, d)
    hu, hv = line_dist(g.u, 0.012, 0.006), line_dist(g.v, 0.012, 0.006)
    hole = ss(0.0021, 0.0013, np.hypot(hu, hv))
    border = ss(0.02, 0.035, d)                       # no holes near the panel edges
    hole *= border
    grime = ss(0.4, 1.8, g.noise(0.2, 3, seed=1))
    base = paint(np.ones_like(d), (0.86, 0.86, 0.83)) * (1 - 0.05 * grime)[..., None]
    base *= (1 - 0.55 * hole)[..., None]
    base = mixc(base, (0.78, 0.79, 0.8), bar)
    h = -hole * 0.0006 - np.exp(-((d - 0.0098) / 0.0012) ** 2) * 0.0015
    rough = 0.7 - 0.25 * bar
    metal = bar * 0.8
    return g, base, h, rough, metal

def lino(col=(0.36, 0.14, 0.085), seed=11, T=3.0):
    """sheet linoleum: marbled, welded seams every 1.5 m, worn dull along the traffic, scratched"""
    g = Grid(1024, T, seed)
    marble = g.noise(0.05, 4, aniso=(3, 1), seed=1)
    fleck = ss(2.0, 3.0, g.noise(0.002, 1, seed=2))
    du = line_dist(g.u, 1.5)
    seam = np.exp(-(du / 0.0018) ** 2)
    wear = ss(-0.3, 1.5, g.noise(0.5, 3, seed=3))
    sc = g.scr(220, 0.12, 0.0005, seed=4)
    base = paint(np.ones_like(marble), col) * (1 + 0.07 * marble)[..., None]
    base = mixc(base, (col[0] * 1.6, col[1] * 1.5, col[2] * 1.4), fleck * 0.5)
    base = mixc(base, (col[0] * 1.25, col[1] * 1.2, col[2] * 1.15), wear * 0.35)
    base = mixc(base, (col[0] * 0.55, col[1] * 0.55, col[2] * 0.55), seam * 0.8)
    base = mixc(base, (col[0] * 1.5, col[1] * 1.45, col[2] * 1.4), sc * 0.45)
    h = -seam * 0.0004 + g.noise(0.003, 2, seed=5) * 0.00003
    rough = 0.3 + 0.28 * wear + 0.2 * sc
    return g, np.clip(base, 0, 1), h, rough, g.zeros()

def studded_rubber():
    """raised-disc rubber flooring (the hall, the lobby, the bridge)"""
    g = Grid(1024, 1.0, 13)
    p = 0.05
    du, dv = line_dist(g.u, p, p / 2), line_dist(g.v, p, p / 2)
    rr = np.hypot(du, dv)
    stud = ss(0.0135, 0.0115, rr)
    dirt = ss(0.0, 1.8, g.noise(0.25, 3, seed=1))
    base = paint(np.ones_like(rr), (0.13, 0.135, 0.14)) * (1 + 0.1 * g.noise(0.1, 3, seed=2))[..., None]
    base = mixc(base, (0.2, 0.2, 0.19), stud * 0.35 * (1 - dirt))
    base = mixc(base, (0.09, 0.085, 0.08), (1 - stud) * dirt * 0.6)
    h = stud * 0.0012
    rough = 0.82 - stud * 0.22 + dirt * 0.05
    return g, np.clip(base, 0, 1), h, rough, g.zeros()

def checker_plate():
    """steel diamond plate 1.2 m square floor plates: lugs, countersunk screws, oil, rust in the joins"""
    g = Grid(1024, 1.2, 17)
    p = 0.03
    U, V = g.u / p, g.v / p
    cu, cv = np.floor(U), np.floor(V)
    lu, lv = U - cu - 0.5, V - cv - 0.5
    a = np.where(((cu + cv) % 2) == 0, 1.0, -1.0)
    x = (lu + a * lv) * 0.7071; y = (-a * lu + lv) * 0.7071
    d = np.hypot(np.maximum(np.abs(x) - 0.3, 0), y)
    lug = ss(0.12, 0.06, d)
    dj = np.minimum(line_dist(g.u, 1.2), line_dist(g.v, 1.2))
    joint = ss(0.0028, 0.0012, dj)
    # countersunk screws 30 mm in from each corner and mid-edge of every plate
    ou, ov = line_dist(g.u, 0.6), line_dist(g.v, 0.6)
    edge = (line_dist(g.u, 1.2) < 0.05) | (line_dist(g.v, 1.2) < 0.05)
    screw = ss(0.0075, 0.0055, np.hypot(ou - 0.03, ov - 0.03)) * edge
    oil = ss(0.6, 1.8, g.noise(0.18, 4, seed=1))
    rust = ss(0.5, 0.0, dj / 0.02) * ss(0.2, 1.2, g.noise(0.02, 3, seed=2))
    wearlug = lug * ss(-0.6, 1.0, g.noise(0.3, 3, seed=3))
    base = paint(np.ones_like(d), (0.40, 0.40, 0.395)) * (1 + 0.06 * g.noise(0.08, 3, seed=4))[..., None]
    base = mixc(base, (0.62, 0.62, 0.6), wearlug * 0.7)
    base = mixc(base, (0.12, 0.11, 0.1), oil * 0.65 * (1 - wearlug * 0.5))
    base = mixc(base, (0.33, 0.17, 0.08), rust * 0.85)
    base = mixc(base, (0.05, 0.05, 0.05), joint)
    base = mixc(base, (0.3, 0.3, 0.3), screw * 0.6)
    h = lug * 0.0016 - joint * 0.002 - screw * 0.0006
    rough = 0.52 - 0.18 * wearlug - 0.25 * oil + 0.35 * rust + 0.2 * joint
    metal = np.clip(1 - rust - joint * 0.6, 0, 1) * 0.95
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.08, 1), metal

def grating():
    """galvanised steel bar grating: bearing bars every 33 mm, cross rods every 100 mm"""
    g = Grid(512, 0.6, 19)
    db = line_dist(g.u, 0.6 / 18)
    bar = ss(0.004, 0.0026, db)
    dr = line_dist(g.v, 0.1)
    rod = ss(0.0045, 0.003, dr)
    solid = np.maximum(bar, rod)
    spang = g.cells(30, 30, 1)[0]
    base = paint(np.ones_like(db), (0.48, 0.49, 0.49)) * (0.9 + 0.2 * spang)[..., None]
    base = mixc(base, (0.012, 0.012, 0.012), 1 - solid)
    h = bar * 0.004 + rod * 0.002
    rough = lerp(1.0, 0.42, solid)
    metal = solid * 0.9
    return g, np.clip(base, 0, 1), h, rough, metal

def steel_paint(col, seed, T=3.0, welds=1.5, rusty=1.0, drips=1.0, S=1024):
    """painted steel plating (the engine room's bulkheads, the outside of the deckhouse): weld
    seams, paint runs, rust coming through and running down"""
    g = Grid(S, T, seed)
    du, dv = line_dist(g.u, welds), line_dist(g.v, welds)
    weld = np.exp(-(du / 0.003) ** 2) + np.exp(-(dv / 0.003) ** 2)
    weld = np.clip(weld, 0, 1)
    ripple = 0.5 + 0.5 * np.sin(g.u / 0.002) * np.sin(g.v / 0.002)
    peel = g.noise(0.002, 2, seed=1) * 0.00006
    mott = g.noise(0.4, 4, seed=2)
    spot = ss(2.75, 3.3, g.noise(0.012, 3, seed=3)) * rusty
    spot = np.maximum(spot, ss(2.5, 3.2, g.noise(0.01, 2, seed=4)) * weld * rusty)
    wob = 0.5 + 0.5 * ss(-1, 1, g.noise(0.01, 2, aniso=(1, 8), seed=5))
    longk = ss(0.5, 1.5, g.noise(0.05, 2, seed=8))
    run = streaks_down(spot, int(0.3 / g.px), 0.988, wob) * drips * (0.35 + 0.65 * longk)
    dirt = ss(0.0, 2.0, g.noise(0.25, 4, seed=6))
    base = paint(np.ones_like(mott), col) * (1 + 0.04 * mott)[..., None]
    base = mixc(base, (col[0] * 0.8, col[1] * 0.8, col[2] * 0.78), dirt * 0.25)
    base = mixc(base, (0.42, 0.24, 0.12), np.clip(run * 0.45, 0, 1))
    base = mixc(base, (0.30, 0.15, 0.07), spot)
    base = mixc(base, (col[0] * 0.85, col[1] * 0.85, col[2] * 0.85), weld * 0.4)
    h = peel + weld * 0.0008 * (0.6 + 0.4 * ripple) + spot * 0.0004 * g.noise(0.002, 1, seed=7)
    rough = 0.5 + 0.08 * mott + 0.3 * spot + 0.1 * run + 0.08 * dirt
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.1, 1), g.zeros()

def machine_paint(col=(0.9, 0.9, 0.9), seed=23, T=2.0, oily=1.0):
    """enamel on machinery: oil and grime, paint worn through to steel in spots, fine scratches
    (white by default: tinted per material by the colour factor)"""
    g = Grid(1024, T, seed)
    mott = g.noise(0.3, 4, seed=1)
    oil = ss(1.5, 2.8, g.noise(0.12, 4, seed=2)) * oily * 0.6
    drip = streaks_down(ss(2.8, 3.3, g.noise(0.015, 2, seed=3)) * oily, int(0.2 / g.px), 0.985) * 0.5
    chip = ss(2.4, 3.0, g.noise(0.006, 3, seed=4))
    sc = g.scr(140, 0.05, 0.00035, seed=5)
    base = paint(np.ones_like(mott), col) * (1 + 0.05 * mott)[..., None]
    base *= (1 - 0.55 * np.clip(oil + drip, 0, 1))[..., None]
    base = mixc(base, (0.55, 0.55, 0.54), np.clip(chip + sc * 0.7, 0, 1))
    h = g.noise(0.002, 2, seed=6) * 0.00005 - chip * 0.0003
    rough = 0.42 + 0.06 * mott - 0.2 * np.clip(oil + drip, 0, 1) + 0.05 * sc
    metal = np.clip(chip + sc * 0.6, 0, 1)
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.08, 1), metal

def deck_paint():
    """the weather decks: green non-slip paint, plate seams 1.5 x 3 m, walked to grey primer, rust"""
    g = Grid(1024, 3.0, 29)
    du, dv = line_dist(g.u, 1.5), line_dist(g.v, 3.0)
    seam = np.clip(np.exp(-(du / 0.004) ** 2) + np.exp(-(dv / 0.004) ** 2), 0, 1)
    grit = np.random.default_rng(3).random((g.H, g.S)).astype(np.float32)
    grit = blur(grit, 0.6)
    walk = ss(0.2, 1.6, g.noise(0.35, 4, seed=1))
    bare = ss(1.4, 2.2, g.noise(0.08, 4, seed=2)) * walk
    near = ss(0.03, 0.0, np.minimum(du, dv))
    rust = np.clip(ss(1.3, 2.4, g.noise(0.02, 3, seed=3)) * (near * 0.8 + 0.25 * bare + 0.15), 0, 1)
    rust = np.maximum(rust, ss(2.6, 3.2, g.noise(0.01, 2, seed=4)))
    sc = g.scr(160, 0.25, 0.0008, seed=5)
    base = paint(np.ones_like(grit), (0.22, 0.31, 0.23)) * (1 + 0.06 * g.noise(0.4, 3, seed=6) + 0.08 * (grit - 0.5))[..., None]
    base = mixc(base, (0.36, 0.40, 0.36), walk * 0.35)
    base = mixc(base, (0.43, 0.43, 0.41), bare * 0.8)
    base = mixc(base, (0.36, 0.38, 0.36), sc * 0.5)
    base = mixc(base, (0.33, 0.17, 0.08), rust * 0.9)
    base = mixc(base, (0.1, 0.12, 0.1), seam * 0.5)
    h = (grit - 0.5) * 0.00025 * (1 - bare) - seam * 0.0012 - bare * 0.00015
    rough = 0.82 - 0.12 * bare + 0.08 * rust
    return g, np.clip(base, 0, 1), h, np.clip(rough, 0.1, 1), g.zeros()

def white_paint():
    """outside white paint (the deckhouse, the bridge, the funnel): rust streaks, soot, salt"""
    return steel_paint((0.86, 0.86, 0.83), 31, T=4.0, welds=2.0, rusty=0.45, drips=0.55)

def vinyl(col=(0.38, 0.12, 0.08)):
    """leatherette upholstery: pebbled grain, creased and worn shiny"""
    g = Grid(512, 0.5, 37)
    F1, F2, _ = g.cells(160, 160, 1)
    peb = ss(0.0, 0.35, F2 - F1)
    crease = ss(1.8, 2.8, g.noise(0.01, 2, aniso=(6, 1), seed=2))
    wear = ss(0.0, 1.6, g.noise(0.12, 3, seed=3))
    base = paint(np.ones_like(peb), col) * (0.92 + 0.12 * peb)[..., None]
    base = mixc(base, (col[0] * 1.3, col[1] * 1.25, col[2] * 1.2), wear * 0.3)
    base *= (1 - 0.25 * crease)[..., None]
    h = peb * 0.00025 - crease * 0.0004
    rough = 0.55 - 0.12 * wear - 0.08 * peb
    return g, np.clip(base, 0, 1), h, rough, g.zeros()

def oilcloth():
    """the mess table's oilcloth: red gingham, a little wrinkled and worn"""
    g = Grid(512, 0.48, 41)
    cu = (np.floor(g.u / 0.024) % 2).astype(np.float32); cv = (np.floor(g.v / 0.024) % 2).astype(np.float32)
    red = (0.66, 0.08, 0.07); white_ = (0.9, 0.88, 0.83)
    k = (cu + cv) / 2
    base = mixc(paint(np.ones_like(k), white_), red, k)
    weave = 0.5 + 0.5 * np.sin(g.u / 0.0006) * np.sin(g.v / 0.0006)
    wear = ss(0.6, 2.0, g.noise(0.06, 3, seed=1))
    base = mixc(base, (0.82, 0.78, 0.72), wear * 0.35)
    base *= (0.96 + 0.04 * weave)[..., None]
    h = g.noise(0.03, 3, seed=2) * 0.0003
    rough = 0.36 + 0.25 * wear
    return g, np.clip(base, 0, 1), h, rough, g.zeros()

def brushed_steel():
    g = Grid(512, 1.0, 43)
    br = g.noise(0.0008, 2, aniso=(40, 1), seed=1)
    smear = ss(0.4, 2.0, g.noise(0.08, 3, seed=2))
    base = paint(np.ones_like(br), (0.62, 0.62, 0.6)) * (1 + 0.04 * br)[..., None]
    base *= (1 - 0.2 * smear)[..., None]
    h = br * 0.00001
    rough = 0.3 + 0.04 * br + 0.15 * smear
    return g, np.clip(base, 0, 1), h, rough, np.full_like(br, 1.0)

def rubber():
    g = Grid(512, 2.0, 47)
    sc = g.scr(120, 0.15, 0.002, seed=1, angle=0.0, spread=0.6)
    grey = ss(0.6, 2.0, g.noise(0.08, 3, seed=2))
    base = paint(np.ones_like(sc), (0.055, 0.055, 0.055))
    base = mixc(base, (0.17, 0.17, 0.165), np.clip(sc * 0.6 + grey * 0.4, 0, 1))
    h = -sc * 0.001 + g.noise(0.01, 3, seed=3) * 0.0003
    rough = 0.86 - 0.1 * sc
    return g, np.clip(base, 0, 1), h, rough, g.zeros()

def rope_braid():
    """a 12-strand polyester towline: diagonal strands in two directions (u along the rope)"""
    S = 256
    g = Grid(S, 0.24, 53)
    U = g.u / 0.24 * 6; V = g.v / 0.24
    a = np.cos(TAU * (U + V * 3)); b = np.cos(TAU * (U - V * 3))
    over = np.where(((np.floor(U * 2 + V * 6) + np.floor(U * 2 - V * 6)) % 2) == 0, a, b)
    strand = np.clip(0.5 + 0.5 * over, 0, 1) ** 0.7
    fuzz = g.noise(0.002, 2, seed=1)
    dirt = ss(0.0, 1.8, g.noise(0.06, 3, seed=2))
    base = paint(np.ones_like(strand), (0.86, 0.52, 0.18)) * (0.55 + 0.45 * strand)[..., None]
    base *= (1 + 0.06 * fuzz)[..., None]
    base = mixc(base, (0.25, 0.2, 0.15), dirt * 0.45)
    h = strand * 0.004 + fuzz * 0.0001
    rough = 0.82 + 0.06 * fuzz
    return g, np.clip(base, 0, 1), h, rough, g.zeros()

# ---------------------------------------------------------------- the hull (not tiled: its own UVs)
HULL_U = (-20.5, 23.5)       # metres along (y) the hull UV's u spans
HULL_V = (-4.5, 6.5)         # metres up (z) its v spans

def hull(half_breadth, sheer):
    """the hull's colours for its own UV layout (u = y along, v = z up): blue topsides, black
    boot-top, red bottom; the ice belt scraped to primer, bare steel and rust (worst at the bow);
    rust running from the hawse pipes and the freeing ports; the plating welds and dents"""
    W, H = 2048, 512
    px = (HULL_U[1] - HULL_U[0]) / W
    y = (HULL_U[0] + (np.arange(W, dtype=np.float32) + 0.5) * px)[None, :] * np.ones((H, 1), np.float32)
    z = (HULL_V[0] + (np.arange(H, dtype=np.float32) + 0.5) * ((HULL_V[1] - HULL_V[0]) / H))[:, None] * np.ones((1, W), np.float32)
    N = lambda s, o=4, an=(1, 1), sd=0: fbm(H, W, s / px, 600 + sd, o, 0.5, an)
    # the plating (as before): strakes every 1.8 m, staggered butts every 5.4 m, frames every 0.6 m
    def ridge(d, w):
        f = np.abs(d - np.round(d)); return np.exp(-(f / w) ** 2)
    strake = ridge((z + 0.4) / 1.8, 0.012 / 1.8 * 30)
    stag = np.where((np.floor((z + 0.4) / 1.8) % 2) == 0, ridge((y + 1.3) / 5.4, 0.035), ridge((y + 4.0) / 5.4, 0.035))
    frames_ = 0.5 - 0.5 * np.cos(TAU * (y / 0.6))
    belt = ((z > -1.2) & (z < 1.6)).astype(np.float32)
    hgt = (strake + stag) * 0.0035 - frames_ * 0.0012 * (1 + belt * 0.3)
    hgt += ridge((z - 1.6) / 1.0, 0.02) * 0.004
    hgt += N(0.35, 3, sd=1) * 0.0004
    # colours by height
    blue, black, red = (0.10, 0.30, 0.62), (0.06, 0.06, 0.065), (0.55, 0.14, 0.1)
    c_top = paint(np.ones_like(y), blue)
    base = np.where((z > 0.5)[..., None], c_top, np.where((z > -0.4)[..., None], paint(np.ones_like(y), black), paint(np.ones_like(y), red)))
    base = base * (1 + 0.05 * N(0.8, 4, sd=2))[..., None]
    # the ice belt: scraped (horizontal scores), paint lost in patches, worst forward and at the waterline
    fwd = np.clip((y + 6) / 22.0, 0, 1) ** 1.2 * 0.85 + 0.15
    band = ss(-1.6, -0.6, z) * ss(2.2, 1.0, z)
    score = ss(0.4, 2.2, N(0.02, 3, an=(25, 1), sd=3))
    loss = ss(0.6 - fwd * 1.2, 1.8 - fwd * 1.0, N(0.25, 5, an=(4, 1), sd=4)) * band
    loss = np.clip(loss + score * band * fwd * 0.6, 0, 1)
    rustk = ss(0.0, 1.5, N(0.08, 4, sd=5))
    primer = (0.22, 0.24, 0.24); steel = (0.42, 0.42, 0.41); rust = (0.34, 0.15, 0.07)
    under = mixc(mixc(paint(np.ones_like(y), primer), steel, score * 0.6), rust, rustk * 0.8)
    base = mixc(base, under, loss)
    # rust running down from the hawse pipes, the freeing ports, the fender belt; discharges
    src = np.zeros((H, W), np.float32)
    def spot(yc, zc, ry, rz, k=1.0):
        nonlocal src
        src = np.maximum(src, k * np.exp(-(((y - yc) / ry) ** 2 + ((z - zc) / rz) ** 2)))
    spot(17.6, 2.65, 0.35, 0.18, 1.0)
    for yc in (-17.5, -14.5, -11.5): spot(yc, 2.55, 0.5, 0.08, 0.8)
    for yc in (-5.0, 2.5, 9.0): spot(yc, 1.05, 0.12, 0.12, 0.7)
    belt_line = np.exp(-((z - 1.95) / 0.06) ** 2) * ss(0.6, 2.0, N(0.15, 3, sd=6))
    src = np.maximum(src, belt_line * 0.6)
    src = np.maximum(src, ss(2.5, 3.2, N(0.02, 3, sd=7)) * (z > 0.3) * 0.6)
    wob = 0.5 + 0.5 * ss(-1, 1.2, N(0.04, 3, an=(1, 10), sd=8))
    run = streaks_down(src, int(2.2 / ((HULL_V[1] - HULL_V[0]) / H)), 0.985, wob)
    base = mixc(base, (0.36, 0.17, 0.08), np.clip(run * 0.7, 0, 1) * (z > -0.4))
    # a greenish-brown slime line just above the boot-top, salt and soot dulling the topsides
    slime = np.exp(-((z - 0.55) / 0.12) ** 2) * ss(-0.5, 1.0, N(0.3, 3, sd=9))
    base = mixc(base, (0.16, 0.18, 0.12), slime * 0.5)
    salt = ss(0.5, 2.0, N(0.5, 4, sd=10)) * (z > 0.5)
    base = mixc(base, (0.55, 0.6, 0.66), salt * 0.18)
    rough = np.where(z > 0.5, 0.42, np.where(z > -0.4, 0.5, 0.7)).astype(np.float32)
    rough = rough + 0.35 * loss * (0.6 + 0.4 * rustk) + 0.15 * run + 0.1 * salt
    metal = loss * score * 0.6
    nrm = normal_from_height(hgt, px * 1.0, 1.0)
    return base, nrm, np.clip(rough, 0.08, 1), metal

# ---------------------------------------------------------------- to Blender
def srgb_ok(x):
    return np.clip(x, 0, 1).astype(np.float32)

def _img(name, px, colorspace):
    H, W = px.shape[:2]
    img = bpy.data.images.get(name)
    if img and (img.size[0] != W or img.size[1] != H):
        bpy.data.images.remove(img); img = None
    if img is None:
        img = bpy.data.images.new(name, W, H, alpha=False)
    if img.colorspace_settings.name != colorspace:
        img.colorspace_settings.name = colorspace
    if px.shape[2] == 3:
        px = np.concatenate([px, np.ones((H, W, 1), np.float32)], -1)
    img.pixels.foreach_set(np.clip(px, 0, 1).astype(np.float32).ravel())
    img.update(); img.pack()
    return img

def to_images(name, base, h_or_nrm, rough, metal, px_m=None):
    nrm = h_or_nrm if h_or_nrm.ndim == 3 else normal_from_height(h_or_nrm, px_m)
    orm = np.dstack([np.ones_like(rough), np.clip(rough, 0, 1), np.clip(metal, 0, 1)])
    return (_img(name + '_base', srgb_ok(base), 'sRGB'), _img(name + '_nrm', nrm, 'Non-Color'), _img(name + '_orm', orm.astype(np.float32), 'Non-Color'))

SETS = {}

def get(name, fn, *a, **k):
    """build (once per run) a texture set's images: returns (images, tile metres)"""
    if name in SETS: return SETS[name]
    g, base, h, rough, metal = fn(*a, **k)
    SETS[name] = (to_images('TX_' + name, base, h, rough, metal, g.px), g.T)
    return SETS[name]

def pbr(name, tex, tint=None, normal_strength=1.0, emit=None, emit_strength=1.0):
    """a Principled material reading a texture set (and a colour factor, if tinted)"""
    (ib, inn, io), T = tex
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL': nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled'); p.location = (300, 0)
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    tb = nt.nodes.new('ShaderNodeTexImage'); tb.image = ib; tb.location = (-500, 300)
    if tint is not None:
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.location = (-150, 300)
        mx.inputs[0].default_value = 1.0
        nt.links.new(tb.outputs['Color'], mx.inputs[6])
        mx.inputs[7].default_value = (*tint, 1.0)
        nt.links.new(mx.outputs[2], p.inputs['Base Color'])
    else:
        nt.links.new(tb.outputs['Color'], p.inputs['Base Color'])
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = io; to.location = (-500, 0)
    sep = nt.nodes.new('ShaderNodeSeparateColor'); sep.location = (-200, 0)
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], p.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], p.inputs['Metallic'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = inn; tn.location = (-500, -300)
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-200, -300); nm.inputs['Strength'].default_value = normal_strength
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    if emit is not None:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = emit_strength
    m['tile'] = float(T)
    tcol = tint or (0.8, 0.8, 0.8)
    m.diffuse_color = (*tcol, 1)
    return m

def contact_sheet(names, path, cell=256):
    """the base colours (top) and normal maps (bottom) of some sets side by side, for a look"""
    cols = []
    for n in names:
        (ib, inn, io), T = SETS[n]
        row = []
        for img in (ib, inn, io):
            W, H = img.size
            a = np.array(img.pixels[:], np.float32).reshape(H, W, 4)
            sy, sx = max(1, H // cell), max(1, W // cell)
            row.append(a[::sy, ::sx][:cell, :cell])
        cols.append(np.concatenate(row, 0))
    sheet = np.concatenate(cols, 1)
    H, W = sheet.shape[:2]
    out = bpy.data.images.get('_sheet')
    if out: bpy.data.images.remove(out)
    out = bpy.data.images.new('_sheet', W, H, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = path; out.file_format = 'PNG'; out.save()
    bpy.data.images.remove(out)
    return path
