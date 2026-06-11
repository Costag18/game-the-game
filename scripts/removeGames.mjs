// One-off: cleanly remove a set of games from all registration points + delete their files.
// Removes from registry.js, shared/gameList.js, client App.jsx (GAME_COMPONENTS),
// client GameVote.jsx (GAME_PREVIEWS) — including the associated import lines — then
// deletes the orphaned engine/client/test/preview files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const IDS = ['dutchDrop', 'sealedVault', 'crackTheVault', 'targetLocked', 'flashFlood', 'sequenceSleuth', 'gomoku', 'superlativeShowdown', 'voteProphet', 'oneLineWonder'];

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, t) => fs.writeFileSync(path.join(ROOT, p), t, 'utf8');
const filesToDelete = new Set();

function removeImportOf(text, symbol) {
  // remove a line like: import { Symbol } from '...';  OR  import Symbol from '...';
  const lines = text.split('\n');
  let importPath = null;
  const kept = lines.filter((ln) => {
    const m = ln.match(/^import\s+(?:\{\s*(\w+)\s*\}|(\w+))\s+from\s+'([^']+)';\s*$/);
    if (m && (m[1] === symbol || m[2] === symbol)) { importPath = m[3]; return false; }
    return true;
  });
  return { text: kept.join('\n'), importPath };
}

// ---- registry.js ----
let reg = read('server/src/games/registry.js');
for (const id of IDS) {
  const m = reg.match(new RegExp(`\\n\\s*registerGame\\('${id}',\\s*(\\w+)\\);`));
  if (!m) { console.log('registry: no registerGame for', id); continue; }
  const cls = m[1];
  reg = reg.replace(m[0], '');
  const r = removeImportOf(reg, cls); reg = r.text;
  if (r.importPath) filesToDelete.add(path.join('server/src/games', path.basename(r.importPath)));
  // 1v1 games have a companion <Cls>Match.js
  const matchFile = `server/src/games/${cls}Match.js`;
  if (fs.existsSync(path.join(ROOT, matchFile))) filesToDelete.add(matchFile);
}
write('server/src/games/registry.js', reg);

// ---- shared/gameList.js (remove the multi-line block) ----
let gl = read('shared/gameList.js');
for (const id of IDS) {
  const lines = gl.split('\n');
  const start = lines.findIndex((ln) => ln.match(new RegExp(`^  ${id}:\\s*\\{\\s*$`)));
  if (start === -1) { console.log('gameList: no entry for', id); continue; }
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) { if (lines[i].match(/^  \},\s*$/)) { end = i; break; } }
  if (end === -1) { console.log('gameList: no block end for', id); continue; }
  lines.splice(start, end - start + 1);
  gl = lines.join('\n');
}
write('shared/gameList.js', gl);

// ---- client App.jsx (GAME_COMPONENTS) ----
let app = read('client/src/App.jsx');
for (const id of IDS) {
  const m = app.match(new RegExp(`\\n\\s*${id}:\\s*(\\w+),`));
  if (!m) { console.log('App: no GAME_COMPONENTS for', id); continue; }
  const comp = m[1];
  app = app.replace(m[0], '');
  const r = removeImportOf(app, comp); app = r.text;
  if (r.importPath) filesToDelete.add(path.join('client/src', r.importPath.replace(/^\.\//, '')));
}
write('client/src/App.jsx', app);

// ---- client GameVote.jsx (GAME_PREVIEWS) ----
let gv = read('client/src/screens/GameVote.jsx');
for (const id of IDS) {
  const m = gv.match(new RegExp(`\\n\\s*${id}:\\s*(\\w+),`));
  if (!m) { console.log('GameVote: no GAME_PREVIEWS for', id); continue; }
  const pv = m[1];
  gv = gv.replace(m[0], '');
  const r = removeImportOf(gv, pv); gv = r.text;
  if (r.importPath) filesToDelete.add(path.join('client/src/screens', r.importPath).replace(/\\/g, '/'));
}
write('client/src/screens/GameVote.jsx', gv);

// derive client css + server test paths
for (const f of [...filesToDelete]) {
  if (f.endsWith('.jsx')) filesToDelete.add(f.replace(/\.jsx$/, '.module.css'));
}
for (const id of IDS) {
  const t = `server/test/${id}.test.mjs`;
  if (fs.existsSync(path.join(ROOT, t))) filesToDelete.add(t);
}

let deleted = 0;
for (const f of filesToDelete) {
  const abs = path.join(ROOT, f);
  if (fs.existsSync(abs)) { fs.rmSync(abs); deleted++; console.log('deleted', f); }
  else console.log('(skip, not found)', f);
}
console.log(`\nRemoved ${IDS.length} games from 4 registration files; deleted ${deleted} files.`);
