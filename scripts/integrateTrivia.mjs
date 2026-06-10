// Integrates a batch of NEW, fact-checked trivia entries into server/src/utils/triviaBank.js.
// Reads scripts/_newTrivia.json ({ MULTIPLE_CHOICE:[...], QUANTITIES:[...], ... }), dedups
// against the EXISTING bank (imported live) and within the batch, re-validates each entry's
// structure, formats them in the file's existing single-quoted style, and splices them in
// before each array's closing `];`. Idempotent-ish: re-running won't add duplicates.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BANK_PATH = path.join(__dirname, '..', 'server', 'src', 'utils', 'triviaBank.js');
const NEW_PATH = path.join(__dirname, '_newTrivia.json');

const bank = await import(pathToFileURL(BANK_PATH).href);
const incoming = JSON.parse(fs.readFileSync(NEW_PATH, 'utf8'));

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
function key(cat, e) {
  if (cat === 'MULTIPLE_CHOICE') return 'mc:' + norm(e.q);
  if (cat === 'QUANTITIES') return 'q:' + norm(e.label);
  if (cat === 'NUMERIC_FACTS') return 'nf:' + norm(e.prompt);
  if (cat === 'EVENTS') return 'ev:' + norm(e.event);
  if (cat === 'ODD_ONE_OUT') return 'oo:' + (e.items || []).map(norm).sort().join('|');
  if (cat === 'RANK_SETS') return 'rk:' + norm(e.category);
  if (cat === 'THIS_OR_THAT') return 'tt:' + [norm(e.a), norm(e.b)].sort().join('|') + ':' + norm(e.prompt);
  return JSON.stringify(e);
}

// structural validators — defensive against any malformed entry slipping through
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string' && v.trim() !== '';
const VALID = {
  MULTIPLE_CHOICE: (e) => str(e.q) && Array.isArray(e.choices) && e.choices.length === 4 && e.choices.every(str) && Number.isInteger(e.answer) && e.answer >= 0 && e.answer <= 3,
  QUANTITIES: (e) => str(e.label) && num(e.value) && typeof e.unit === 'string',
  NUMERIC_FACTS: (e) => str(e.prompt) && num(e.answer) && typeof e.unit === 'string',
  EVENTS: (e) => str(e.event) && Number.isInteger(e.year),
  ODD_ONE_OUT: (e) => Array.isArray(e.items) && e.items.length === 4 && e.items.every(str) && Number.isInteger(e.oddIndex) && e.oddIndex >= 0 && e.oddIndex <= 3 && str(e.rule),
  RANK_SETS: (e) => str(e.category) && Array.isArray(e.ordered) && e.ordered.length >= 3 && e.ordered.every(str),
  THIS_OR_THAT: (e) => str(e.prompt) && str(e.a) && str(e.b) && (e.correct === 'a' || e.correct === 'b'),
};

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const arr = (xs) => '[' + xs.map(q).join(', ') + ']';
const FMT = {
  MULTIPLE_CHOICE: (e) => `  { q: ${q(e.q)}, choices: ${arr(e.choices)}, answer: ${e.answer} },`,
  QUANTITIES: (e) => `  { label: ${q(e.label)}, value: ${e.value}, unit: ${q(e.unit)} },`,
  NUMERIC_FACTS: (e) => `  { prompt: ${q(e.prompt)}, answer: ${e.answer}, unit: ${q(e.unit)} },`,
  EVENTS: (e) => `  { event: ${q(e.event)}, year: ${e.year} },`,
  ODD_ONE_OUT: (e) => `  { items: ${arr(e.items)}, oddIndex: ${e.oddIndex}, rule: ${q(e.rule)} },`,
  RANK_SETS: (e) => `  { category: ${q(e.category)}, ordered: ${arr(e.ordered)} },`,
  THIS_OR_THAT: (e) => `  { prompt: ${q(e.prompt)}, a: ${q(e.a)}, b: ${q(e.b)}, correct: ${q(e.correct)} },`,
};

let text = fs.readFileSync(BANK_PATH, 'utf8');
const report = {};

for (const cat of Object.keys(FMT)) {
  const existing = bank[cat] || [];
  const seen = new Set(existing.map((e) => key(cat, e)));
  const incomingList = Array.isArray(incoming[cat]) ? incoming[cat] : [];
  const fresh = [];
  let dropDup = 0, dropBad = 0;
  for (const e of incomingList) {
    if (!VALID[cat](e)) { dropBad++; continue; }
    const k = key(cat, e);
    if (seen.has(k)) { dropDup++; continue; }
    seen.add(k);
    fresh.push(e);
  }
  report[cat] = { added: fresh.length, dropDup, dropBad, before: existing.length, after: existing.length + fresh.length };
  if (!fresh.length) continue;

  // splice formatted lines in before this array's closing `];`
  const marker = `export const ${cat} = [`;
  const start = text.indexOf(marker);
  if (start === -1) throw new Error('array not found: ' + cat);
  const close = text.indexOf('\n];', start);
  if (close === -1) throw new Error('array close not found: ' + cat);
  const lines = fresh.map(FMT[cat]).join('\n');
  text = text.slice(0, close) + '\n' + lines + text.slice(close);
}

fs.writeFileSync(BANK_PATH, text, 'utf8');
console.log(JSON.stringify(report, null, 2));
const totalAdded = Object.values(report).reduce((s, r) => s + r.added, 0);
console.log('TOTAL ADDED:', totalAdded);
