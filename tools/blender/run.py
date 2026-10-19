# Runs an asset script inside the live Blender (pasted into the connector's bl_execute):
#
#   import runpy; r = runpy.run_path(r'<root>\tools\blender\run.py', init_globals={'SCRIPT': 'make_tug', 'ARGS': {...}}); result = r['result']
#
# ARGS become the script's globals (ROOT, DETAIL, EXPORT, WANT...). The script's `result` comes back.
import sys, os, runpy, importlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import common
importlib.reload(common)
common.set_root(ROOT)
args = dict(globals().get('ARGS') or {})
args.setdefault('ROOT', ROOT)
g = runpy.run_path(os.path.join(HERE, globals().get('SCRIPT', 'make_tug') + '.py'), init_globals=args)
result = g.get('result')
