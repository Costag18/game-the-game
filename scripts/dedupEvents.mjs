// One-off: remove semantic-duplicate EVENTS entries that the text-based dedup missed
// (the expansion re-worded events already in the bank). Keeps the original concise entry
// of each pair; same-year-but-DISTINCT events (e.g. 1914 WWI vs Panama Canal) are untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.join(__dirname, '..', 'server', 'src', 'utils', 'triviaBank.js');

const DROP = new Set([
  'Mount Vesuvius erupts and buries Pompeii',
  'Norman conquest of England at the Battle of Hastings',
  'King John seals Magna Carta at Runnymede',
  'The Black Death plague reaches and ravages Europe',
  'Constantinople falls to the Ottomans under Mehmed II',
  'Christopher Columbus makes his first transatlantic landfall in the Americas',
  'The Spanish Armada is defeated by England',
  'The United States Declaration of Independence is adopted',
  'The storming of the Bastille begins the French Revolution',
  'Alexander Graham Bell is granted the patent for the telephone',
  'Wright brothers make the first powered airplane flight at Kitty Hawk',
  'The RMS Titanic sinks on its maiden voyage',
  'Alexander Fleming discovers penicillin',
  'Watson and Crick describe the double-helix structure of DNA',
  'The Soviet Union launches Sputnik 1, the first artificial satellite',
  'Christiaan Barnard performs the first human heart transplant',
  'Apollo 11 lands the first humans on the Moon',
  'The first email is sent over ARPANET using the @ symbol',
  'The first Star Wars film is released in cinemas',
  'The Chernobyl nuclear disaster occurs',
  'Tim Berners-Lee writes the first proposal for the World Wide Web at CERN',
  'The Hubble Space Telescope is launched into orbit',
  'Apple releases the first iPhone',
]);

const lines = fs.readFileSync(BANK, 'utf8').split('\n');
const re = /^\s*\{ event: '(.+?)', year: -?\d+ \},?\s*$/;
let removed = 0;
const kept = lines.filter((ln) => {
  const m = ln.match(re);
  if (m && DROP.has(m[1].replace(/\\'/g, "'"))) { removed++; return false; }
  return true;
});
fs.writeFileSync(BANK, kept.join('\n'), 'utf8');
console.log('removed', removed, 'duplicate events (expected', DROP.size + ')');
