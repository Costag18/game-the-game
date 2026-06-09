import { test, assert, eq, report } from './helpers.mjs';
import { normalizeGuess, levenshtein, isCorrectGuess, isCloseGuess } from '../src/utils/guessMatch.js';
import { pickWords, pickWord, CATEGORIES, WORD_BANK } from '../src/utils/wordBank.js';
import { CanvasSession } from '../src/utils/CanvasSession.js';

// ---------- guessMatch ----------
test('normalizeGuess: case, punctuation, accents, leading article', () => {
  eq(normalizeGuess('  Cat! '), 'cat');
  eq(normalizeGuess('The Elephant'), 'elephant');
  eq(normalizeGuess('café'), 'cafe');
  eq(normalizeGuess('a   spoon'), 'spoon');
});

test('exact and fuzzy correctness with the length gate', () => {
  eq(isCorrectGuess('Cat!', 'cat').correct, true); // exact after normalize
  eq(isCorrectGuess('ellephant', 'elephant').correct, true); // dist 1, len>=4
  eq(isCorrectGuess('cot', 'cat').correct, false); // len 3 → fuzzy off
  eq(isCorrectGuess('elefant', 'elephant').correct, false); // dist 2 > maxDistance 1
});

test('levenshtein basics + isCloseGuess', () => {
  eq(levenshtein('kitten', 'sitting'), 3);
  eq(isCloseGuess('elefant', 'elephant'), true); // dist 2
  eq(isCloseGuess('cat', 'cat'), false);
});

// ---------- wordBank ----------
test('pickWords: count, distinctness, exclude, category filter', () => {
  const five = pickWords(5);
  eq(five.length, 5);
  eq(new Set(five.map((w) => w.word)).size, 5);
  const onlyAnimals = pickWords(4, { category: 'animals' });
  assert(onlyAnimals.every((w) => w.category === 'animals'), 'category filtered');
  const ex = WORD_BANK.food.easy[0];
  const picked = pickWords(8, { category: 'food', exclude: [ex] });
  assert(!picked.some((w) => w.word === ex), 'excluded word not picked');
  assert(pickWord().word, 'pickWord returns one');
});

test('pickWords near exhaustion never throws and returns count', () => {
  const all = pickWords(50, { category: 'animals', difficulty: 'easy' }); // more than the pool
  eq(all.length, 50); // exhaustion fallback allows repeats
});

// ---------- CanvasSession ----------
function stroke(points = [{ x: 10, y: 10 }, { x: 20, y: 20 }]) { return { color: '#ff0000', width: 5, tool: 'pen', points }; }

test('only the drawer may add strokes; ids are reissued canonically', () => {
  const cv = new CanvasSession();
  cv.setDrawer('a');
  eq(cv.addStroke('b', stroke()).ok, false); // not the drawer
  const r = cv.addStroke('a', { ...stroke(), id: 'spoofed:99' }, 1000);
  eq(r.ok, true);
  eq(r.stroke.id, 'a:0'); // client id ignored
});

test('throttle drops sub-33ms strokes; caps and clamps inputs', () => {
  const cv = new CanvasSession();
  cv.setDrawer('a');
  eq(cv.addStroke('a', stroke(), 1000).ok, true);
  eq(cv.addStroke('a', stroke(), 1010).ok, false); // < 33ms
  const r = cv.addStroke('a', { color: 'red', width: 9999, tool: 'pen', points: [{ x: 99999, y: -5 }] }, 2000);
  eq(r.ok, true);
  eq(r.stroke.color, '#000000'); // bad color defaulted
  eq(r.stroke.width, 64); // clamped
  eq(r.stroke.points[0].x, 800); eq(r.stroke.points[0].y, 0); // clamped to bounds
});

test('undo pops the drawer own last stroke; clear wipes; seq stays monotonic', () => {
  const cv = new CanvasSession();
  cv.setDrawer('a');
  cv.addStroke('a', stroke(), 1000);
  const s2 = cv.addStroke('a', stroke(), 2000);
  const u = cv.undo('a');
  eq(u.ok, true); eq(u.strokeId, s2.stroke.id);
  eq(cv.snapshot().strokes.length, 1);
  cv.clear('a');
  eq(cv.snapshot().strokes.length, 0);
  const after = cv.addStroke('a', stroke(), 3000);
  assert(after.stroke.id !== 'a:0', 'seq did not reset after clear');
});

test('eraser strokes ignore color and use destination-out semantics', () => {
  const cv = new CanvasSession();
  cv.setDrawer('a');
  const r = cv.addStroke('a', { color: '#123456', width: 10, tool: 'eraser', points: [{ x: 5, y: 5 }] }, 1000);
  eq(r.stroke.tool, 'eraser');
  eq(r.stroke.color, '#ffffff');
});

report('DrawingInfra');
