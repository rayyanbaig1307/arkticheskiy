// Compresses the GLBs Blender exported (tools/blender/raw/*.glb) into public/models/ with gltfpack:
// meshopt geometry and animation compression (EXT_meshopt_compression), named nodes kept (the game
// finds its INT_, COL_, LMP_... nodes by name), materials kept, extras kept.
//
//   npm run pack            every raw GLB
//   npm run pack -- tug     just tug.glb
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'tools', 'blender', 'raw');
const outDir = join(root, 'public', 'models');
mkdirSync(outDir, { recursive: true });

const want = process.argv.slice(2);
const files = [];
const walk = (d, rel = '') => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'checkpoints') walk(p, join(rel, f)); }
    else if (f.endsWith('.glb')) files.push(join(rel, f));
  }
};
walk(rawDir);

// (gltfpack's own CLI script, run by this node: no shell, so paths with spaces are fine)
const cli = join(root, 'node_modules', 'gltfpack', 'cli.js');
for (const rel of files) {
  const name = rel.replace(/\\/g, '/').replace(/\.glb$/, '');
  if (want.length && !want.some((w) => name.includes(w))) continue;
  const src = join(rawDir, rel), dst = join(outDir, rel);
  mkdirSync(dirname(dst), { recursive: true });
  // -cc: meshopt compression (higher ratio); -kn/-km/-ke: keep named nodes, materials, extras;
  // -vpf: positions as floats (exact collision geometry, no per-mesh dequantization surprises)
  const args = ['-i', src, '-o', dst, '-cc', '-kn', '-km', '-ke', '-vpf'];
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(name, 'FAILED\n', r.stderr || r.stdout); process.exitCode = 1; continue; }
  const a = statSync(src).size, b = statSync(dst).size;
  console.log(`${name.padEnd(28)} ${(a / 1024).toFixed(0).padStart(6)} KB -> ${(b / 1024).toFixed(0).padStart(6)} KB`);
}
