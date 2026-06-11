// One-off: add a batch of canonical ANCIENT events (thousands of years ago) to the
// EVENTS bank for Timeline, then the slider floor is widened to reach them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.join(__dirname, '..', 'server', 'src', 'utils', 'triviaBank.js');
const bank = await import(pathToFileURL(BANK).href);

const NEW = [
  { event: 'The wheel is invented in Mesopotamia', year: -3500 },
  { event: 'Writing (cuneiform) is invented in Sumer', year: -3200 },
  { event: 'Construction of Stonehenge begins in England', year: -3000 },
  { event: 'The Great Pyramid of Giza is built', year: -2560 },
  { event: 'Hammurabi establishes his famous code of laws in Babylon', year: -1754 },
  { event: 'The earliest known bathtub is built at the Palace of Knossos on Crete', year: -1500 },
  { event: 'Tutankhamun is buried in the Valley of the Kings', year: -1323 },
  { event: 'The first coins are minted in the kingdom of Lydia', year: -600 },
  { event: 'The philosopher Confucius is born in China', year: -551 },
  { event: 'The Parthenon in Athens is completed', year: -438 },
  { event: 'The Library of Alexandria is founded in Egypt', year: -283 },
  { event: 'Construction of the Great Wall of China begins under Qin Shi Huang', year: -221 },
  { event: 'Hannibal crosses the Alps to attack Rome', year: -218 },
  { event: "The Terracotta Army is created for China's first emperor", year: -210 },
  { event: 'The Rosetta Stone is carved in Egypt', year: -196 },
  { event: 'Cleopatra becomes ruler of Egypt', year: -51 },
  { event: 'The Colosseum in Rome is completed', year: 80 },
  { event: 'The Pantheon in Rome is rebuilt by the emperor Hadrian', year: 126 },
];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const seen = new Set(bank.EVENTS.map((e) => norm(e.event)));
const add = NEW.filter((e) => !seen.has(norm(e.event)));
const merged = [...bank.EVENTS, ...add];

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const lines = merged.map((e) => `  { event: ${q(e.event)}, year: ${e.year} },`);

let t = fs.readFileSync(BANK, 'utf8');
const marker = 'export const EVENTS = [';
const start = t.indexOf(marker);
const bodyStart = start + marker.length;
const close = t.indexOf('\n];', bodyStart);
t = t.slice(0, bodyStart) + '\n' + lines.join('\n') + t.slice(close);
fs.writeFileSync(BANK, t, 'utf8');

const ys = merged.map((e) => e.year).sort((a, b) => a - b);
console.log('added', add.length, 'ancient events; EVENTS now', merged.length, '| min year', ys[0], 'max', ys[ys.length - 1]);
