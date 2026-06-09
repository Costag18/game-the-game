// Word bank for draw-and-guess games. Lowercase single tokens or short phrases.
export const WORD_BANK = {
  animals: {
    easy: ['cat', 'dog', 'fish', 'cow', 'pig', 'duck', 'bee', 'frog', 'bird', 'snake', 'bear', 'lion'],
    medium: ['penguin', 'octopus', 'giraffe', 'dolphin', 'kangaroo', 'hedgehog', 'squirrel', 'flamingo', 'raccoon', 'peacock'],
    hard: ['platypus', 'chameleon', 'narwhal', 'armadillo', 'pelican', 'sloth', 'walrus', 'lemur', 'tapir', 'meerkat'],
  },
  food: {
    easy: ['pizza', 'apple', 'cake', 'egg', 'banana', 'bread', 'cheese', 'donut', 'carrot', 'cookie'],
    medium: ['hamburger', 'spaghetti', 'pancakes', 'popcorn', 'cupcake', 'pretzel', 'sushi', 'taco', 'waffle', 'ice cream'],
    hard: ['croissant', 'lasagna', 'guacamole', 'cappuccino', 'macaron', 'quesadilla', 'dumpling', 'omelette', 'baguette', 'risotto'],
  },
  objects: {
    easy: ['ball', 'cup', 'book', 'key', 'chair', 'clock', 'phone', 'spoon', 'hat', 'shoe', 'door', 'lamp'],
    medium: ['umbrella', 'scissors', 'guitar', 'camera', 'backpack', 'telescope', 'toothbrush', 'helmet', 'anchor', 'compass'],
    hard: ['typewriter', 'chandelier', 'metronome', 'binoculars', 'harmonica', 'periscope', 'gramophone', 'kaleidoscope', 'abacus', 'sundial'],
  },
  actions: {
    easy: ['run', 'jump', 'sleep', 'swim', 'cry', 'sing', 'dance', 'eat', 'read', 'wave', 'kick', 'clap'],
    medium: ['juggle', 'sneeze', 'whisper', 'tiptoe', 'salute', 'stretch', 'snore', 'yawn', 'shiver', 'wink'],
    hard: ['somersault', 'pirouette', 'levitate', 'eavesdrop', 'photosynthesis', 'meditate', 'hibernate', 'tightrope', 'moonwalk', 'cartwheel'],
  },
  places: {
    easy: ['house', 'beach', 'park', 'school', 'farm', 'castle', 'bridge', 'cave', 'island', 'tent'],
    medium: ['lighthouse', 'volcano', 'pyramid', 'igloo', 'windmill', 'aquarium', 'stadium', 'treehouse', 'observatory', 'waterfall'],
    hard: ['amphitheater', 'planetarium', 'monastery', 'submarine', 'skyscraper', 'colosseum', 'greenhouse', 'aqueduct', 'catacombs', 'fjord'],
  },
};

export const CATEGORIES = Object.keys(WORD_BANK);
export const DIFFICULTIES = ['easy', 'medium', 'hard'];

function buildPool({ category = null, difficulty = null } = {}) {
  const cats = category && WORD_BANK[category] ? [category] : CATEGORIES;
  const diffs = difficulty && DIFFICULTIES.includes(difficulty) ? [difficulty] : DIFFICULTIES;
  const pool = [];
  for (const c of cats) for (const d of diffs) for (const word of WORD_BANK[c][d]) pool.push({ word, category: c, difficulty: d });
  return pool;
}

export function pickWords(count = 1, { category = null, difficulty = null, exclude = [] } = {}) {
  const used = new Set(exclude.map((w) => String(w).toLowerCase()));
  let pool = buildPool({ category, difficulty }).filter((e) => !used.has(e.word.toLowerCase()));
  // shuffle
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = pool.slice(0, count);
  // exhaustion fallback: allow repeats from the full pool if we couldn't find enough distinct
  if (out.length < count) {
    const full = buildPool({ category, difficulty });
    while (out.length < count && full.length) out.push(full[Math.floor(Math.random() * full.length)]);
  }
  return out;
}

export function pickWord(opts = {}) { return pickWords(1, opts)[0]; }
