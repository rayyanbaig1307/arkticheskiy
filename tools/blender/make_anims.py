# The crew's and soldiers' animation clips, keyed on MPFB's game-engine rig and written to
# tools/blender/raw/people/anims.glb (an armature and its actions, no mesh). Every person is built on
# the same rig (make_people.py), so the game plays these on all of them (characters/People.js
# retargets the pelvis's height to each body). Adapted from The Ashwood Tapes' make_anims.py; runs in
# a scene of its own.
#
# Poses are rotations in the armature's frame (facing -Y, up +Z, the character's left +X):
#   pitch  about X: + tips an upright bone forward, swings a hanging limb back
#   yaw    about Z: + turns toward the character's left
#   roll   about Y: + leans toward the character's left
# mirrored for the right side. Clips are functions of time, keyed every STEP frames at 30 fps.
#
#   idle        weight shifting, breathing, a look round now and then
#   walk        an ordinary walk (1.14 m/s at timeScale 1)
#   patrol      a slow measured walk, hands clasped behind the back
#   talk        the right hand beats with the words, the head nods
#   rope        hauling on a line hand over hand, leaning back into it
#   wipe        bent over a table, wiping it in circles
#   gauges      checking the gauges: leaning in, a hand up to tap one, nodding
#   guard       at parade rest: feet apart, hands behind the back, eyes moving
#   binoculars  binoculars to the eyes, scanning slowly from side to side
import bpy, os, math, addon_utils, importlib
from mathutils import Quaternion, Vector
import common as C
importlib.reload(C)

FPS, STEP = 30, 2
mod = [m.__name__ for m in addon_utils.modules() if m.__name__.endswith('.mpfb')][0]
addon_utils.enable(mod, default_set=True, persistent=True)
HS = importlib.import_module(mod + '.services.humanservice').HumanService

def setup():
    sc = C.fresh_scene('ASSET_anims')
    info = HS._create_default_human_info_dict()
    info['rig'] = 'game_engine'; info['proxy'] = ''; info['name'] = 'ref'
    s = HS.get_default_deserialization_settings(); s['subdiv_levels'] = 0
    HS.deserialize_from_dict(info, s)
    arm = [o for o in sc.objects if o.type == 'ARMATURE'][0]
    arm.name = 'Rig'
    sc.render.fps = FPS
    return sc, arm

R = lambda ax, deg: Quaternion(ax, math.radians(deg))
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
def ang(pitch=0, yaw=0, roll=0, s=1):
    return R(Z, yaw * s) @ R(Y, roll * s) @ R(X, pitch)
bump = lambda p, c, w: math.exp(-(((p - c + 0.5) % 1 - 0.5) / w) ** 2)
sm = lambda t: t * t * (3 - 2 * t)
clamp = lambda v, a, b: max(a, min(b, v))
def ease(t, a, b): return sm(clamp((t - a) / max(1e-6, b - a), 0, 1))

FINGERS = ['index', 'middle', 'ring', 'pinky']
def hands(pose, curl=0.35, thumb=0.3):
    for s, sd in ((1, 'l'), (-1, 'r')):
        for i, f in enumerate(FINGERS):
            for j in (1, 2, 3):
                bend = (curl * (55 if j == 1 else 70 if j == 2 else 45)) * (1 + 0.12 * i)
                pose[f'{f}_0{j}_{sd}'] = ('local', R(X, bend))
        for j in (1, 2, 3):
            pose[f'thumb_0{j}_{sd}'] = ('local', R(X, thumb * 25))

def hand_curl(pose, sd, curl, thumb=0.4):
    for i, f in enumerate(FINGERS):
        for j in (1, 2, 3):
            pose[f'{f}_0{j}_{sd}'] = ('local', R(X, (curl * (55 if j == 1 else 70 if j == 2 else 45)) * (1 + 0.12 * i)))
    for j in (1, 2, 3):
        pose[f'thumb_0{j}_{sd}'] = ('local', R(X, thumb * 25))

# the rig's rest pose has the elbows already bent this much: a clip's elbow is the bend it shows,
# so the rest's own is taken off first (without that, every arm was carried half raised)
ELBOW_REST = 26

def arms_down(pose, s, out=8, fwd=0, elbow=12, twist=0):
    """from the A-pose rest (arms 42 degrees out) down to the side, swung forward by fwd, the
    forearm bent by elbow (twist turns the upper arm about the vertical first; on this rig a
    negative twist brings a bent forearm round in front of the body)"""
    sd = 'l' if s > 0 else 'r'
    pose[f'upperarm_{sd}'] = R(X, -fwd) @ R(Y, (42 - out) * s) @ R(Z, twist * s)
    pose[f'lowerarm_{sd}'] = ang(pitch=-(elbow - ELBOW_REST), s=s)

def base_stand(t):
    pose = {}
    breathe = math.sin(t * 2 * math.pi / 4.2)
    pose['spine_02'] = ang(pitch=1.0 * breathe)
    pose['spine_03'] = ang(pitch=0.8 * breathe)
    pose['neck_01'] = ang(pitch=4)
    arms_down(pose, 1, out=10 + 1.5 * breathe); arms_down(pose, -1, out=10 + 1.5 * breathe)   # (padded coats: arms a little out)
    pose['clavicle_l'] = ang(roll=1.2 * breathe, s=1); pose['clavicle_r'] = ang(roll=1.2 * breathe, s=-1)
    hands(pose)
    return pose

LM = {}         # body landmarks (armature space), filled in by run()

def yawed(p, deg, about=None):
    """a target turned with the upper body (about the vertical through the pelvis)"""
    c = about or LM['pelvis']
    a = math.radians(deg)
    dx, dy = p[0] - c.x, p[1] - c.y
    return (c.x + dx * math.cos(a) - dy * math.sin(a), c.y + dx * math.sin(a) + dy * math.cos(a), p[2])

def behind_back(pose, dz=0.0):
    """hands clasped behind the back (IK): at the small of the back, elbows out and back"""
    pv = LM['pelvis']
    for s, sd in ((1, 'l'), (-1, 'r')):
        pose['ik_' + sd] = (s * 0.035, pv.y + 0.19, pv.z + 0.08 + dz)
        pose['pole_' + sd] = (s * 0.55, pv.y + 0.45, pv.z + 0.35)
        pose[f'hand_{sd}'] = ang(pitch=30, roll=-30, s=s)
    hands(pose, 0.5, 0.5)

def legs_walk(pose, p, stride=1.0):
    for s, sd, ph in ((1, 'l', 0.0), (-1, 'r', 0.5)):
        q = (p + ph) % 1
        thigh = (-6 - 21 * math.cos(2 * math.pi * q) + 6 * bump(q, 0.85, 0.08)) * stride
        knee = 4 + 14 * bump(q, 0.12, 0.07) + 58 * bump(q, 0.74, 0.12) * (0.6 + 0.4 * stride)
        ankle = -9 * bump(q, 0.0, 0.05) + 18 * bump(q, 0.6, 0.06) - 10 * bump(q, 0.82, 0.09)
        pose[f'thigh_{sd}'] = ang(pitch=thigh, yaw=-2, s=s)
        pose[f'calf_{sd}'] = ang(pitch=knee)
        pose[f'foot_{sd}'] = ang(pitch=ankle)
        pose[f'ball_{sd}'] = ang(pitch=-14 * bump(q, 0.58, 0.06))
    pose['pelvis'] = ang(yaw=-5 * math.cos(2 * math.pi * p), roll=-3 * math.sin(2 * math.pi * p), pitch=3)
    pose['pelvis_loc'] = (0.016 * math.sin(2 * math.pi * p), 0, -0.024 * (0.5 + 0.5 * math.cos(4 * math.pi * p)) + 0.004)

# ---------------------------------------------------------------- the clips
def walk(t, L=32 / FPS):
    p = (t / L) % 1
    pose = {}
    legs_walk(pose, p)
    for s, sd, ph in ((1, 'l', 0.0), (-1, 'r', 0.5)):
        a = (p + ph + 0.5) % 1
        swing = 15 * math.cos(2 * math.pi * a)
        arms_down(pose, s, out=9, fwd=-swing + 2, elbow=10 + 16 * max(0, -math.cos(2 * math.pi * a)))
    pose['spine_01'] = ang(yaw=2.5 * math.cos(2 * math.pi * p), pitch=1)
    pose['spine_02'] = ang(yaw=2.5 * math.cos(2 * math.pi * p), roll=1.5 * math.sin(2 * math.pi * p))
    pose['spine_03'] = ang(yaw=2 * math.cos(2 * math.pi * p), pitch=1)
    pose['neck_01'] = ang(pitch=5, roll=1.5 * math.sin(2 * math.pi * p))
    pose['head'] = ang(pitch=-2)
    hands(pose, 0.4)
    return pose

def patrol(t, L=44 / FPS):
    p = (t / L) % 1
    pose = {}
    legs_walk(pose, p, 0.85)
    behind_back(pose)
    pose['spine_01'] = ang(yaw=1.5 * math.cos(2 * math.pi * p), pitch=-1)
    pose['spine_03'] = ang(pitch=-2)
    look = 20 * math.sin(t * 2 * math.pi / 7.3)
    pose['neck_01'] = ang(pitch=3, yaw=look * 0.4); pose['head'] = ang(yaw=look * 0.6, pitch=-2)
    return pose

def idle(t, L=8.0):
    pose = base_stand(t)
    w = math.sin(t * 2 * math.pi / L)
    pose['pelvis_loc'] = (0.018 * w, 0, -0.008 - 0.004 * abs(w))
    pose['pelvis'] = ang(roll=-1.8 * w)
    for s, sd in ((1, 'l'), (-1, 'r')):
        load = max(0.0, w * s)
        pose[f'thigh_{sd}'] = ang(pitch=-2 - 4 * (1 - load), roll=1.2, s=s)
        pose[f'calf_{sd}'] = ang(pitch=3 + 8 * (1 - load))
        pose[f'foot_{sd}'] = ang(pitch=-3 * (1 - load))
    pose['spine_01'] = ang(roll=1.2 * w)
    look = 12 * (ease(t, 2.2, 3.0) - ease(t, 4.2, 5.0)) - 9 * (ease(t, 5.6, 6.3) - ease(t, 7.0, 7.7))
    pose['neck_01'] = ang(pitch=4, yaw=look * 0.45)
    pose['head'] = ang(yaw=look * 0.55, pitch=-2)
    return pose

def talk(t, L=6.0):
    pose = idle(t * 8 / L, 8.0)
    up = ease(t, 0.3, 0.8) * (1 - ease(t, 5.2, 5.8))
    beat = math.sin(t * 2 * math.pi * 1.7) * 0.5 + math.sin(t * 2 * math.pi * 0.9 + 1) * 0.5
    arms_down(pose, -1, out=7, fwd=15 * up, elbow=12 + up * (50 + 10 * beat), twist=-30 * up)
    pose['hand_r'] = ang(pitch=-8 * up * (0.5 + 0.5 * beat), roll=-6 * up, s=-1)
    up2 = ease(t, 2.0, 2.6) * (1 - ease(t, 3.8, 4.4))
    arms_down(pose, 1, out=8, fwd=12 * up2, elbow=12 + up2 * 38, twist=-20 * up2)
    nod = 3 * math.sin(t * 2 * math.pi * 1.3) * up
    pose['head'] = ang(pitch=-2 + nod, yaw=6 * math.sin(t * 0.9), roll=2 * math.sin(t * 1.3))
    hands(pose, 0.45 + 0.1 * up, 0.45)
    return pose

def rope(t, Lc=1.8):
    """hauling a line hand over hand: the hands reach forward in turn and pull back to the chest"""
    pose = {}
    p = (t / Lc) % 1
    pose['pelvis_loc'] = (0, 0.05, -0.06)
    pose['pelvis'] = ang(pitch=-6)
    for s, sd in ((1, 'l'), (-1, 'r')):
        pose[f'thigh_{sd}'] = ang(pitch=-18 if s > 0 else 8, yaw=-4, s=s)
        pose[f'calf_{sd}'] = ang(pitch=24 if s > 0 else 10)
        pose[f'foot_{sd}'] = ang(pitch=-6)
        q = (p + (0 if s > 0 else 0.5)) % 1
        # forward along the line, then pulled back in close (a quick reach, a long pull)
        reach = math.sin(math.pi * min(1, q / 0.35)) if q < 0.35 else 1 - (q - 0.35) / 0.65
        reach = max(0.0, min(1.0, reach if q < 0.35 else 1 - (q - 0.35) / 0.65))
        ch = LM['chest']
        pose['ik_' + sd] = (s * 0.04, ch.y - 0.28 - 0.38 * reach, ch.z - 0.12 - 0.12 * reach)
        pose['pole_' + sd] = (s * 0.5, ch.y + 0.1, ch.z - 0.55)
        pose[f'hand_{sd}'] = ang(pitch=-10, s=s)
        hand_curl(pose, sd, 0.9, 0.8)
    lean = math.sin(2 * math.pi * p * 2) * 2
    pose['spine_01'] = ang(pitch=-8 + lean); pose['spine_02'] = ang(pitch=-4, yaw=6 * math.sin(2 * math.pi * p)); pose['spine_03'] = ang(pitch=2)
    pose['neck_01'] = ang(pitch=8); pose['head'] = ang(pitch=6)
    return pose

def wipe(t, L=3.0):
    """bent over a table, the right hand wiping in circles, the left leaning on the edge"""
    pose = {}
    a = 2 * math.pi * t / 1.5
    pose['pelvis_loc'] = (0, -0.02, -0.03)
    pose['pelvis'] = ang(pitch=8)
    pose['spine_01'] = ang(pitch=14); pose['spine_02'] = ang(pitch=12, yaw=4 * math.sin(a)); pose['spine_03'] = ang(pitch=8)
    for s, sd in ((1, 'l'), (-1, 'r')):
        pose[f'thigh_{sd}'] = ang(pitch=-4, s=s); pose[f'calf_{sd}'] = ang(pitch=6)
    tz = LM['pelvis'].z - 0.18                    # the table top (a mess table, ~0.78 m)
    pose['ik_l'] = (0.24, LM['pelvis'].y - 0.5, tz); pose['pole_l'] = (0.7, LM['pelvis'].y + 0.2, tz + 0.3)
    pose['ik_r'] = (-0.16 + 0.12 * math.cos(a), LM['pelvis'].y - 0.58 + 0.09 * math.sin(a), tz)
    pose['pole_r'] = (-0.7, LM['pelvis'].y + 0.2, tz + 0.3)
    pose['hand_l'] = ang(pitch=-60, s=1); hand_curl(pose, 'l', 0.15, 0.2)
    pose['hand_r'] = ang(pitch=-60, s=-1); hand_curl(pose, 'r', 0.3, 0.3)
    pose['neck_01'] = ang(pitch=6); pose['head'] = ang(pitch=10, yaw=-8 * math.sin(a * 0.5))
    return pose

def gauges(t, L=6.0):
    pose = base_stand(t)
    lean = ease(t, 0.2, 0.9) * (1 - ease(t, 5.2, 5.9))
    pose['spine_01'] = ang(pitch=5 * lean); pose['spine_02'] = ang(pitch=4 * lean)
    tap = ease(t, 1.4, 1.9) * (1 - ease(t, 3.2, 3.7))
    arms_down(pose, -1, out=12, fwd=20 + 50 * tap, elbow=40 + 60 * tap)
    pose['hand_r'] = ang(pitch=-25 * tap, s=-1)
    for j in (1, 2, 3): pose[f'index_0{j}_r'] = ('local', R(X, 5))
    knock = math.sin(t * 2 * math.pi * 4) * 6 * (ease(t, 2.2, 2.4) - ease(t, 2.9, 3.1))
    pose['lowerarm_r'] = ang(pitch=-(40 + 60 * tap + knock - ELBOW_REST), s=-1)
    look = 15 * math.sin(t * 2 * math.pi / L)
    pose['neck_01'] = ang(pitch=2 + 3 * lean, yaw=look * 0.4); pose['head'] = ang(pitch=-4 + 4 * math.sin(t * 2.3) * lean, yaw=look * 0.6)
    return pose

def guard(t, L=8.0):
    pose = {}
    breathe = math.sin(t * 2 * math.pi / 4.4)
    pose['spine_02'] = ang(pitch=-1 + 0.8 * breathe); pose['spine_03'] = ang(pitch=-2 + 0.6 * breathe)
    for s, sd in ((1, 'l'), (-1, 'r')):
        pose[f'thigh_{sd}'] = ang(pitch=-1, roll=4, s=s); pose[f'calf_{sd}'] = ang(pitch=2); pose[f'foot_{sd}'] = ang(roll=-4, s=s)
    behind_back(pose)
    look = 25 * (ease(t, 1.5, 2.3) - ease(t, 3.4, 4.2)) - 20 * (ease(t, 5.0, 5.8) - ease(t, 6.8, 7.5))
    pose['neck_01'] = ang(pitch=1, yaw=look * 0.4); pose['head'] = ang(pitch=-3, yaw=look * 0.6)
    return pose

def binoculars(t, L=8.0):
    """binoculars at the eyes: both hands up, elbows out, scanning slowly"""
    pose = {}
    scan = 28 * math.sin(t * 2 * math.pi / L)
    breathe = math.sin(t * 2 * math.pi / 4.0)
    yaw = scan * 0.75                            # what the spine and neck add up to
    for s, sd in ((1, 'l'), (-1, 'r')):
        pose[f'thigh_{sd}'] = ang(pitch=-2, roll=3, s=s); pose[f'calf_{sd}'] = ang(pitch=4)
        e = LM['eyes']
        pose['ik_' + sd] = yawed((s * 0.05, e.y - 0.15, e.z - 0.05), yaw)
        pose['pole_' + sd] = yawed((s * 0.6, e.y + 0.05, e.z - 0.45), yaw)
        pose[f'hand_{sd}'] = ang(pitch=10, roll=40, s=s)
        hand_curl(pose, sd, 0.75, 0.6)
    pose['spine_01'] = ang(yaw=scan * 0.25); pose['spine_02'] = ang(yaw=scan * 0.3, pitch=0.6 * breathe); pose['spine_03'] = ang(yaw=scan * 0.25, pitch=-2)
    pose['neck_01'] = ang(yaw=scan * 0.1, pitch=-2); pose['head'] = ang(yaw=scan * 0.1, pitch=-4)
    return pose

CLIPS = {
    'idle': (idle, 8.0, True), 'walk': (walk, 32 / FPS, True), 'patrol': (patrol, 44 / FPS, True), 'talk': (talk, 6.0, True),
    'rope': (rope, 1.8, True), 'wipe': (wipe, 3.0, True), 'gauges': (gauges, 6.0, True), 'guard': (guard, 8.0, True), 'binoculars': (binoculars, 8.0, True),
}

def run(preview=False, export=True):
    sc, arm = setup()
    PB = arm.pose.bones
    bones = arm.data.bones
    LM['pelvis'] = bones['pelvis'].head_local.copy()
    LM['chest'] = bones['spine_03'].head_local.copy()
    LM['eyes'] = bones['head'].head_local.copy() + Vector((0, -0.09, 0.09))
    # IK on the forearms (chain of two: the upper arm and the forearm), targets and poles as empties
    tg = {}
    for sd in ('l', 'r'):
        for kind in ('ik', 'pole'):
            e = bpy.data.objects.new(f'{kind}_{sd}', None); sc.collection.objects.link(e); tg[f'{kind}_{sd}'] = e
        c = PB[f'lowerarm_{sd}'].constraints.new('IK')
        c.target = tg[f'ik_{sd}']; c.pole_target = tg[f'pole_{sd}']; c.chain_count = 2
        c.pole_angle = math.radians(-90); c.use_tail = True
        c.influence = 0.0
    REST = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}
    PELVIS_REST = arm.data.bones['pelvis'].head_local.copy()
    for pb in PB: pb.rotation_mode = 'QUATERNION'
    def finish(pose):
        out = {}
        for k, v in pose.items():
            out[k] = REST[k] @ v[1] @ REST[k].inverted() if isinstance(v, tuple) and v[0] == 'local' else v
        return out
    def apply(pose):
        for sd in ('l', 'r'):
            on = ('ik_' + sd) in pose
            PB[f'lowerarm_{sd}'].constraints[0].influence = 1.0 if on else 0.0
            if on:
                tg['ik_' + sd].location = pose['ik_' + sd]; tg['pole_' + sd].location = pose['pole_' + sd]
        for pb in PB:
            q = pose.get(pb.name)
            pb.rotation_quaternion = (REST[pb.name].inverted() @ q @ REST[pb.name]) if q is not None else Quaternion()
            pb.location = (0, 0, 0)
        d = pose.get('pelvis_loc')
        if d is not None: PB['pelvis'].location = REST['pelvis'].inverted() @ Vector(d)
    out = {}
    if preview:
        # a contact sheet: four frames of each clip, from the front-left
        frames = []
        for name, (fn, L, loop) in CLIPS.items():
            if preview is not True and name not in preview: continue
            for i, tt in enumerate((0.2, 0.7)):
                apply(finish(fn(tt * L)))
                bpy.context.view_layer.update()
                frames += C.preview(sc, f'anim_{name}_{i}', [('f', (2.4, -3.2, 1.2), (0, 0, 0.95), 50)], res=(240, 320), world_rgb=(0.5, 0.52, 0.55))
        out['previews'] = frames
    arm.animation_data_create()
    for name, (fn, L, loop) in CLIPS.items():
        act = bpy.data.actions.new(name)
        arm.animation_data.action = act
        n = round(L * FPS)
        fr = list(range(0, n + 1, STEP))
        if fr[-1] != n: fr.append(n)
        for f in fr:
            t = (f % n) / FPS if loop else f / FPS
            pose = finish(fn(t))
            apply(pose)
            ik = any(k.startswith('ik_') for k in pose)
            if ik:
                # the arms as the IK left them (its result in the bones' own space), then keyed plain
                bpy.context.view_layer.update()
                vis = {}
                for sd in ('l', 'r'):
                    for b in (f'upperarm_{sd}', f'lowerarm_{sd}'):
                        pb = PB[b]
                        vis[b] = arm.convert_space(pose_bone=pb, matrix=pb.matrix, from_space='POSE', to_space='LOCAL').to_quaternion()
                for sd in ('l', 'r'): PB[f'lowerarm_{sd}'].constraints[0].influence = 0.0
                for b, q in vis.items(): PB[b].rotation_quaternion = q
            for pb in PB: pb.keyframe_insert('rotation_quaternion', frame=f)
            PB['pelvis'].keyframe_insert('location', frame=f)
        act.use_fake_user = True
        tr = arm.animation_data.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 0, act)
        arm.animation_data.action = None
    apply({})
    for sd in ('l', 'r'):
        PB[f'lowerarm_{sd}'].constraints.remove(PB[f'lowerarm_{sd}'].constraints[0])
    for o in list(sc.objects):
        if o.type in ('MESH', 'EMPTY'): bpy.data.objects.remove(o, do_unlink=True)
    arm['pelvisRest'] = [round(PELVIS_REST.x, 4), round(PELVIS_REST.z, 4), round(-PELVIS_REST.y, 4)]
    if export:
        d = os.path.join(C.raw_dir(), 'people'); os.makedirs(d, exist_ok=True)
        path = os.path.join(d, 'anims.glb')
        if bpy.context.window: bpy.context.window.scene = sc
        for o in sc.objects: o.select_set(o == arm)
        with bpy.context.temp_override(scene=sc):
            bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, use_active_scene=True, export_extras=True, export_yup=True,
                                      export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
                                      export_optimize_animation_size=True, export_skins=False, export_def_bones=False)
        out['export'] = [path, os.path.getsize(path)]
    out['clips'] = list(CLIPS)
    return out

if __name__ == '__main__' or True:
    C.set_root(globals().get('ROOT', r'C:\Users\black\OneDrive\Desktop\Arkticheskiy'))
    result = run(preview=globals().get('PREVIEW', False), export=globals().get('EXPORT', True))
