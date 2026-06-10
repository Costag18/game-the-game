// One-off: remove the handful of semantic-duplicate MULTIPLE_CHOICE and THIS_OR_THAT
// entries the text-dedup missed (same question/comparison, reworded). Distinct questions
// that merely share a template (chemical symbol of X, larger vs smaller planet) are kept.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.join(__dirname, '..', 'server', 'src', 'utils', 'triviaBank.js');
const bank = await import(pathToFileURL(BANK).href);

const DROP_MC = new Set([
  'What is the chemical symbol for the element gold?',
  'What is the largest planet in our solar system?',
  'What is the only metal that is liquid at room temperature?',
  'How many chambers does a normal human heart have?',
  'Which is the largest ocean on Earth by surface area?',
  'The Great Barrier Reef lies off the coast of which country?',
  "In which museum does the 'Mona Lisa' hang?",
  'How many players are in a standard soccer (association football) team on the field?',
  'Which language has the most native speakers in the world?',
]);
// TOT matched on full (prompt|a|b) so "Larger by land area?" (Russia/Canada) is NOT touched
const DROP_TOT = new Set([
  'Larger by total area?|Russia|Canada',
  'Heavier animal?|African elephant|Blue whale',
  'Hotter at the surface?|Venus|Mercury',
  'Which planet has a larger diameter?|Mars|Mercury',
  "Which is the most abundant gas in Earth's atmosphere?|Oxygen|Nitrogen",
  'Larger by land area?|Greenland|Australia',
]);

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const arr = (xs) => '[' + xs.map(q).join(', ') + ']';
const fmtMC = (e) => `  { q: ${q(e.q)}, choices: ${arr(e.choices)}, answer: ${e.answer} },`;
const fmtTOT = (e) => `  { prompt: ${q(e.prompt)}, a: ${q(e.a)}, b: ${q(e.b)}, correct: ${q(e.correct)} },`;

const newMC = bank.MULTIPLE_CHOICE.filter((e) => !DROP_MC.has(e.q));
const newTOT = bank.THIS_OR_THAT.filter((e) => !DROP_TOT.has(`${e.prompt}|${e.a}|${e.b}`));

function replaceArrayBody(text, name, lines) {
  const marker = `export const ${name} = [`;
  const start = text.indexOf(marker);
  if (start === -1) throw new Error('not found: ' + name);
  const bodyStart = start + marker.length;
  const close = text.indexOf('\n];', bodyStart);
  if (close === -1) throw new Error('close not found: ' + name);
  return text.slice(0, bodyStart) + '\n' + lines.join('\n') + text.slice(close);
}

let text = fs.readFileSync(BANK, 'utf8');
text = replaceArrayBody(text, 'MULTIPLE_CHOICE', newMC.map(fmtMC));
text = replaceArrayBody(text, 'THIS_OR_THAT', newTOT.map(fmtTOT));
fs.writeFileSync(BANK, text, 'utf8');
console.log('MC:', bank.MULTIPLE_CHOICE.length, '->', newMC.length, '(removed', bank.MULTIPLE_CHOICE.length - newMC.length + ')');
console.log('TOT:', bank.THIS_OR_THAT.length, '->', newTOT.length, '(removed', bank.THIS_OR_THAT.length - newTOT.length + ')');
