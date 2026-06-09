// Server-only guess matching for draw-and-guess games. The secret word lives in
// the game FSM and is passed in here; it never crosses the wire to a guesser.

export function normalizeGuess(text) {
  let s = String(text == null ? '' : text).toLowerCase().trim();
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip accents
  s = s.replace(/[^a-z0-9\s]/g, ''); // strip punctuation
  s = s.replace(/\s+/g, ' ').trim(); // collapse whitespace
  s = s.replace(/^(a|an|the)\s+/, ''); // drop a leading article
  return s;
}

export function levenshtein(a, b, cap = 99) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  let cur = new Array(lb + 1);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

export function isCorrectGuess(guess, secretWord, { fuzzy = true, maxDistance = 1 } = {}) {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(secretWord);
  if (!g || !w) return { correct: false, exact: false, distance: Infinity };
  if (g === w) return { correct: true, exact: true, distance: 0 };
  if (fuzzy && w.length >= 4) {
    const d = levenshtein(g, w, maxDistance + 1);
    if (d <= maxDistance) return { correct: true, exact: false, distance: d };
    return { correct: false, exact: false, distance: d };
  }
  return { correct: false, exact: false, distance: levenshtein(g, w, 3) };
}

export function isCloseGuess(guess, secretWord) {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(secretWord);
  if (!g || !w || g === w) return false;
  const d = levenshtein(g, w, 3);
  return d >= 1 && d <= 2;
}
