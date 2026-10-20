# Sculpting with signed distance fields (numpy): primitives, smooth unions and subtractions,
# sampled on a grid and meshed with surface nets. Shared by the creatures and the caves.
#
#   F = Field(lo, hi, cell)          a grid over a box (metres)
#   F.add(E(c, r), k)                smooth union (k: the blend's width)
#   F.cut(RC(a, b, r1, r2), k)       smooth subtraction
#   F.mesh(name)                     a Blender object: the surface where the field is 0, its
#                                    faces looking out of the solid (field < 0 is solid)
#   F.invert()                       solid <-> empty (to make a cave: add the hollows, invert)
#
# A primitive is (sdf(P) -> distances, bbox): only the cells near its box are evaluated.
import math
import numpy as np
import bpy
from mathutils import Euler

def _rot(yaw=0, pitch=0, roll=0):
    return np.array(Euler((math.radians(pitch), math.radians(roll), math.radians(yaw)), 'XYZ').to_matrix(), np.float32)

def E(c, r, yaw=0, pitch=0, roll=0):
    """an ellipsoid at c with semi-axes r (yaw about z, pitch about x, roll about y)"""
    c = np.array(c, np.float32); r = np.array(r, np.float32); R = _rot(yaw, pitch, roll)
    def f(P):
        q = (P - c) @ R
        k0 = np.linalg.norm(q / r, axis=-1); k1 = np.linalg.norm(q / (r * r), axis=-1)
        return k0 * (k0 - 1) / np.maximum(k1, 1e-9)
    m = float(r.max())
    return f, (c - m, c + m)

def B(c, r): return E(c, (r, r, r))

def RC(a, b, r1, r2):
    """a round cone from a (radius r1) to b (radius r2)"""
    a = np.array(a, np.float32); b = np.array(b, np.float32)
    ba = b - a; l2 = float(ba @ ba); rr = r1 - r2; a2 = l2 - rr * rr; il2 = 1.0 / max(l2, 1e-9)
    def f(P):
        pa = P - a
        y = pa @ ba; z = y - l2
        x2 = np.sum((pa * l2 - y[..., None] * ba) ** 2, -1)
        y2 = y * y * l2; z2 = z * z * l2
        k = math.copysign(1.0, rr) * rr * rr * x2
        d1 = np.sqrt(x2 + z2) * il2 - r2
        d2 = np.sqrt(x2 + y2) * il2 - r1
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
        return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))
    m = max(r1, r2)
    return f, (np.minimum(a, b) - m, np.maximum(a, b) + m)

def BOX(c, half, round_=0.0, yaw=0):
    c = np.array(c, np.float32); h = np.array(half, np.float32) - round_; R = _rot(yaw)
    def f(P):
        q = np.abs((P - c) @ R) - h
        return np.linalg.norm(np.maximum(q, 0), axis=-1) + np.minimum(np.max(q, -1), 0) - round_
    m = float(np.linalg.norm(half))
    return f, (c - m, c + m)

def smin(a, b, k):
    if k <= 0: return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k * 0.25

def smax(a, b, k):
    return -smin(-a, -b, k)

class Field:
    def __init__(self, lo, hi, cell, fill=1.0):
        self.lo = np.array(lo, np.float32); self.cell = cell
        self.n = (np.ceil((np.array(hi, np.float32) - self.lo) / cell).astype(int) + 1)
        self.F = np.full(tuple(self.n), fill, np.float32)
        self.axes = [self.lo[i] + np.arange(self.n[i], dtype=np.float32) * cell for i in range(3)]

    def _sub(self, bbox, k):
        b0, b1 = bbox; m = k + 3 * self.cell
        i0 = np.clip(np.floor((np.array(b0) - m - self.lo) / self.cell).astype(int), 0, self.n - 1)
        i1 = np.clip(np.ceil((np.array(b1) + m - self.lo) / self.cell).astype(int) + 1, 1, self.n)
        sub = tuple(slice(int(i0[d]), int(i1[d])) for d in range(3))
        P = np.stack(np.meshgrid(self.axes[0][sub[0]], self.axes[1][sub[1]], self.axes[2][sub[2]], indexing='ij'), -1)
        return sub, P

    def add(self, prim, k=0.0):
        f, bbox = prim
        sub, P = self._sub(bbox, k)
        self.F[sub] = smin(self.F[sub], f(P).astype(np.float32), k)
        return self

    def cut(self, prim, k=0.0):
        f, bbox = prim
        sub, P = self._sub(bbox, k)
        self.F[sub] = smax(self.F[sub], -f(P).astype(np.float32), k)
        return self

    def invert(self):
        self.F = -self.F; return self

    def displace(self, fn):
        """F += fn(P) near the surface (noise: rough ice, rock)"""
        near = np.abs(self.F) < self.cell * 6
        idx = np.nonzero(near)
        P = np.stack([self.axes[d][idx[d]] for d in range(3)], -1)
        self.F[idx] += fn(P).astype(np.float32)
        return self

    def sample(self, p):
        """the field at a point (the nearest grid point; outside the grid: solid)"""
        i = np.round((np.array(p, np.float32) - self.lo) / self.cell).astype(int)
        if np.any(i < 0) or np.any(i >= self.n): return -1.0
        return float(self.F[i[0], i[1], i[2]])

    def points(self):
        """every grid point (N, 3) (for evaluating a material map)"""
        return np.stack(np.meshgrid(*self.axes, indexing='ij'), -1).reshape(-1, 3)

    def mesh(self, name, coll=None):
        verts, quads = surface_nets(self.F, self.lo, self.cell)
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts.tolist(), [], quads.tolist())
        me.validate(); me.update()
        o = bpy.data.objects.new(name, me)
        (coll or bpy.context.scene.collection).objects.link(o)
        return o

def surface_nets(F, lo, h):
    """a quad mesh from a field: one vertex per cell the surface crosses (the mean of its edge
    crossings), one quad per crossed grid edge, wound to face out of the solid (F < 0)"""
    ins = F < 0
    nx, ny, nz = F.shape
    C8 = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]
    def cs(a): return (slice(a[0], nx - 1 + a[0]), slice(a[1], ny - 1 + a[1]), slice(a[2], nz - 1 + a[2]))
    cnt = np.zeros((nx - 1, ny - 1, nz - 1), np.int8)
    for c in C8: cnt += ins[cs(c)]
    act = (cnt > 0) & (cnt < 8)
    nv = int(act.sum())
    idx = np.full(act.shape, -1, np.int64); idx[act] = np.arange(nv)
    cf = [F[cs(c)][act] for c in C8]
    acc = np.zeros((nv, 3), np.float32); num = np.zeros(nv, np.float32)
    for p, q in ((0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)):
        f0, f1 = cf[p], cf[q]
        m = (f0 < 0) != (f1 < 0)
        t = f0[m] / (f0[m] - f1[m])
        cp, cq = np.array(C8[p], np.float32), np.array(C8[q], np.float32)
        acc[m] += cp + t[:, None] * (cq - cp); num[m] += 1
    verts = lo + (np.argwhere(act).astype(np.float32) + acc / np.maximum(num, 1)[:, None]) * h
    quads = []
    for ax, (u, v) in enumerate(((1, 2), (2, 0), (0, 1))):
        s0 = [slice(None)] * 3; s1 = [slice(None)] * 3
        s0[ax] = slice(0, -1); s1[ax] = slice(1, None)
        a = ins[tuple(s0)]
        e = np.argwhere(a != ins[tuple(s1)])
        ok = (e[:, u] >= 1) & (e[:, v] >= 1) & (e[:, u] <= F.shape[u] - 2) & (e[:, v] <= F.shape[v] - 2)
        e = e[ok]
        start_in = a[tuple(e.T)]
        def cell(du, dv):
            c = e.copy(); c[:, u] += du; c[:, v] += dv; return idx[tuple(c.T)]
        q4 = np.stack([cell(-1, -1), cell(0, -1), cell(0, 0), cell(-1, 0)], 1)
        q4[~start_in] = q4[~start_in][:, ::-1]
        quads.append(q4)
    return verts, np.concatenate(quads) if quads else np.zeros((0, 4), np.int64)

def vnoise3(P, scale, seed):
    """smooth 3D value noise (0..1)"""
    g = np.random.default_rng(seed).random((32, 32, 32)).astype(np.float32)
    q = P / scale
    i = np.floor(q).astype(np.int64); f = (q - i).astype(np.float32)
    f = f * f * (3 - 2 * f)
    def G(dx, dy, dz): return g[(i[:, 0] + dx) % 32, (i[:, 1] + dy) % 32, (i[:, 2] + dz) % 32]
    x0 = G(0, 0, 0) * (1 - f[:, 0]) + G(1, 0, 0) * f[:, 0]; x1 = G(0, 1, 0) * (1 - f[:, 0]) + G(1, 1, 0) * f[:, 0]
    x2 = G(0, 0, 1) * (1 - f[:, 0]) + G(1, 0, 1) * f[:, 0]; x3 = G(0, 1, 1) * (1 - f[:, 0]) + G(1, 1, 1) * f[:, 0]
    y0 = x0 * (1 - f[:, 1]) + x1 * f[:, 1]; y1 = x2 * (1 - f[:, 1]) + x3 * f[:, 1]
    return y0 * (1 - f[:, 2]) + y1 * f[:, 2]

def fbm3(P, scale, seed, oct=4):
    s, a, tot = 0.0, 1.0, 0.0
    for k in range(oct):
        s = s + vnoise3(P, scale / 2 ** k, seed + k) * a; tot += a; a *= 0.5
    return s / tot
