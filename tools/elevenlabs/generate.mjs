// Records the crew's, the soldiers' and the story's Russian lines with the ElevenLabs API.
//
//   node tools/elevenlabs/generate.mjs              record every line that has no recording yet (or changed)
//   node tools/elevenlabs/generate.mjs --dry        list what would be recorded, the characters and the credits (free)
//   node tools/elevenlabs/generate.mjs --only a,b   only these ids (captain_0, bosun_iceHit, story_radio), speakers (cook)
//                                                   or id prefixes (story_c1_*)
//   node tools/elevenlabs/generate.mjs --skip a,b   leave these out (the same forms as --only)
//   node tools/elevenlabs/generate.mjs --lang en    the English lines (each line's English, by the same voices),
//                                                   into public/audio/vo_en/ (the game's Voices: English)
//   node tools/elevenlabs/generate.mjs --force      record again even when the recording is up to date
//   node tools/elevenlabs/generate.mjs --voices     list the account's voices (free)
//   node tools/elevenlabs/generate.mjs --credits    this month's credits used and left (free)
//
// The API key comes from ELEVENLABS_API_KEY (on Windows the user-level variable is read directly,
// so a terminal opened before `setx` still works). It is never printed or written anywhere.
//
// The lines come from the script, src/characters/Lines.js:
//   LINES[who][i]          -> <who>_<i>        (what each person says in turn)
//   MOMENTS[kind], per who -> <who>_<kind>     (the engine stopped, ice hit, the horn ...)
//   STORY[key]             -> story_<key>      (the run to Station Severny: captain, radio, chief)
// The cast (which ElevenLabs voice speaks for whom), the model and the rate from manifest.json.
// Voices from the Voice Library (those with an "owner") are added to the account's voices the
// first time they're needed (a real run only, never --dry).
//
// Output: public/audio/vo/<id>.mp3 and public/audio/vo/index.json (id -> { file, who, ru, voice,
// model }), read by src/audio/Voices.js. The game finds a recording by its speaker and Russian
// text, so a line edited in Lines.js falls back to the browser's voice until it's recorded again;
// this script sees the change (index.json remembers what each file was made from) and records it.
// A line that only moved (same speaker, voice and text under a new id) is copied, not recorded.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LANG = (() => { const i = process.argv.indexOf('--lang'); return i >= 0 ? process.argv[i + 1] : 'ru'; })();
const OUT = join(ROOT, 'public', 'audio', LANG === 'en' ? 'vo_en' : 'vo');
const API = 'https://api.elevenlabs.io/v1';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const list = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1].split(',') : null; };
const only = list('--only'), skip = list('--skip');
// an id, a speaker, or an id prefix ending in *
const hit = (pats, j) => pats.some((o) => (o.endsWith('*') ? j.id.startsWith(o.slice(0, -1)) : o === j.id || o === j.who));
const DRY = flag('--dry'), FORCE = flag('--force');

const M = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
const { CAST, LINES, MOMENTS, STORY, STORY_CAST } = await import(pathToFileURL(join(ROOT, 'src', 'characters', 'Lines.js')).href);

function apiKey() {
  let k = process.env.ELEVENLABS_API_KEY;
  if (!k && process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('ELEVENLABS_API_KEY','User')"], { encoding: 'utf8' });
    k = r.stdout?.trim();
  }
  if (!k) { console.error('ELEVENLABS_API_KEY is not set.'); process.exit(1); }
  return k;
}

async function call(path, key, { method = 'GET', body, audio = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(API + path, {
      method, headers: { 'xi-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(audio ? { Accept: 'audio/mpeg' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.ok) return audio ? Buffer.from(await r.arrayBuffer()) : r.json();
    const msg = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise((res) => setTimeout(res, 2000 * attempt)); continue; }
    throw new Error(`${r.status} ${msg.slice(0, 300)}`);
  }
}

const credits = async (key) => { const j = await call('/user/subscription', key); return { used: j.character_count, limit: j.character_limit, slots: j.voice_slots_used, slotLimit: j.voice_limit, reset: j.next_character_count_reset_unix }; };
const accountVoices = async (key) => (await call('/voices', key)).voices || [];

// ---------------------------------------------------------------------------------------- read-only
if (flag('--voices') || flag('--credits')) {
  const key = apiKey();
  if (flag('--credits')) { const c = await credits(key); console.log(`Credits: ${c.used} used of ${c.limit} (${c.limit - c.used} left this month). Voice slots: ${c.slots} of ${c.slotLimit}.`); }
  if (flag('--voices')) {
    for (const v of await accountVoices(key)) {
      const L = v.labels || {};
      console.log([v.name.slice(0, 34).padEnd(34), v.voice_id, (v.category || '').padEnd(12), [L.gender, L.age, L.accent, L.descriptive || L.description].filter(Boolean).join(', ')].join('  '));
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------------------- the lines
const lines = [];
for (const [who, list] of Object.entries(LINES)) list.forEach(([ru, en], i) => lines.push({ id: `${who}_${i}`, who, ru, en }));
for (const [kind, m] of Object.entries(MOMENTS)) for (const who of m.who) lines.push({ id: `${who}_${kind}`, who, ru: m.line[0], en: m.line[1] });
for (const [key, [who, ru, en]] of Object.entries(STORY)) lines.push({ id: `story_${key}`, who, ru, en });

const INDEX = join(OUT, 'index.json');
const made = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
const rate = M.creditsPerChar ?? 1;

const jobs = lines.map((l) => {
  const v = M.voices[l.who];
  if (!v) throw new Error(`No voice cast for ${l.who}`);
  // (the English recording keeps the Russian it stands for: the game finds a line by it)
  const text = LANG === 'en' ? l.en : l.ru;
  const want = { who: l.who, ru: l.ru, ...(LANG === 'en' ? { en: l.en, lang: 'en' } : {}), voice: v.id, model: v.model || M.model };
  const same = (m) => m && m.who === want.who && m.ru === want.ru && (LANG !== 'en' || m.en === want.en) && m.voice === want.voice && m.model === want.model;
  const file = join(OUT, `${l.id}.mp3`);
  const fresh = same(made[l.id]) && existsSync(file);
  // the same recording under another id (the line moved in the list): copy it
  const twin = !fresh && Object.entries(made).find(([id, m]) => id !== l.id && same(m) && existsSync(join(OUT, `${id}.mp3`)));
  return { ...l, v, want, file, fresh, twin: twin ? twin[0] : null, stale: !!made[l.id] && !fresh, text, chars: text.length, cost: Math.ceil(text.length * rate) };
});

const picked = jobs.filter((j) => (!only || hit(only, j)) && (!skip || !hit(skip, j)));
const copies = picked.filter((j) => !FORCE && !j.fresh && j.twin);
const todo = picked.filter((j) => FORCE || (!j.fresh && !j.twin));
const est = todo.reduce((a, j) => a + j.cost, 0);
const chars = todo.reduce((a, j) => a + j.chars, 0);
const name = (who) => (CAST[who] || STORY_CAST[who] || { name: who }).name;

console.log(`${todo.length} line(s) to record: ${chars} characters, estimated ${est} credits (${M.model}).${copies.length ? ` ${copies.length} moved line(s) copied for free.` : ''}`);
if (DRY) {
  for (const j of todo) console.log(`  ${String(j.cost).padStart(4)}  ${(j.id + '.mp3').padEnd(24)} ${j.text}${j.stale ? '   (changed since recorded)' : ''}`);
  const by = {};
  for (const j of todo) { const b = (by[j.who] ||= { n: 0, chars: 0, cost: 0 }); b.n++; b.chars += j.chars; b.cost += j.cost; }
  console.log('');
  console.log('By voice:');
  for (const [who, b] of Object.entries(by)) console.log(`  ${name(who).padEnd(26)} ${M.voices[who].name.padEnd(28)} ${String(b.n).padStart(3)} line(s) ${String(b.chars).padStart(5)} chars ${String(b.cost).padStart(6)} credits`);
  try {
    const key = apiKey();
    const c = await credits(key);
    const have = new Set((await accountVoices(key)).map((v) => v.voice_id));
    const add = [...new Set(todo.map((j) => j.who))].filter((w) => !have.has(M.voices[w].id));
    console.log('');
    console.log(`Account: ${c.limit - c.used} credits left this month (${c.used} of ${c.limit} used, resets ${new Date(c.reset * 1000).toISOString().slice(0, 10)}). This run's estimate is ${est}.`);
    if (add.length) console.log(`Voice Library voices to add to the account: ${add.length} (${add.map((w) => M.voices[w].name).join(', ')}); slots ${c.slots} of ${c.slotLimit} used.`);
  } catch (e) { console.log(`(account not checked: ${e.message})`); }
  process.exit(0);
}

const key = apiKey();
const before = await credits(key);
if (before.used + est > before.limit) { console.error(`Not enough credits: ${before.limit - before.used} left, ${est} needed.`); process.exit(1); }

// the Voice Library voices this run needs, added to the account's voices once
const ids = {};
if (todo.length) {
  const have = new Set((await accountVoices(key)).map((v) => v.voice_id));
  // (the ones with a Library owner first: a part that borrows another's voice comes after it)
  for (const who of [...new Set(todo.map((j) => j.who))].sort((a, b) => !!M.voices[b].owner - !!M.voices[a].owner)) {
    const v = M.voices[who];
    ids[who] = v.id;
    if (have.has(v.id)) continue;
    if (!v.owner) throw new Error(`${v.name} (${v.id}) is not in the account and has no Voice Library owner to add it from`);
    const r = await call(`/voices/add/${v.owner}/${v.id}`, key, { method: 'POST', body: { new_name: `${v.name} (Arkticheskiy: ${name(who)})` } });
    ids[who] = r.voice_id || v.id;
    have.add(v.id); have.add(ids[who]);           // (another part may share this voice: it's in the account now)
    console.log(`  added ${v.name} to the account's voices${ids[who] !== v.id ? ` as ${ids[who]} (put that id in manifest.json)` : ''}`);
  }
}

mkdirSync(OUT, { recursive: true });
for (const j of copies) { copyFileSync(join(OUT, `${j.twin}.mp3`), j.file); made[j.id] = { file: `${j.id}.mp3`, ...j.want }; console.log(`  copy  ${j.twin}.mp3 -> ${j.id}.mp3`); }

// A few at a time: the API allows limited concurrency on smaller plans
let done = 0, failed = 0;
const queue = [...todo];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let j; (j = queue.shift());) {
    try {
      const buf = await call(`/text-to-speech/${ids[j.who]}?output_format=${M.format}`, key, {
        method: 'POST', audio: true,
        body: { text: j.text, model_id: j.want.model, voice_settings: { ...M.settings, ...j.v.settings } },
      });
      writeFileSync(j.file, buf);
      made[j.id] = { file: `${j.id}.mp3`, ...j.want };
      console.log(`  ok    ${j.id}.mp3  (${(buf.length / 1024).toFixed(0)} KB)  ${j.text}`);
      done++;
    } catch (e) { console.log(`  FAIL  ${j.id}.mp3  ${e.message}`); failed++; }
  }
}));

// the index the game reads: every line of the script that has an up-to-date recording
const index = {};
for (const j of jobs) {
  const m = made[j.id];
  if (m && existsSync(j.file) && m.ru === j.ru && m.who === j.who && (LANG !== 'en' || m.en === j.en)) index[j.id] = m;
}
writeFileSync(INDEX, JSON.stringify(index, null, 1));

const after = await credits(key);
console.log(`Done: ${done} recorded, ${copies.length} copied, ${failed} failed; ${Object.keys(index).length} of ${jobs.length} lines have a recording. Credits used this run: ${after.used - before.used} (the counter can lag a few minutes; ${after.limit - after.used} left this month).`);
