// Shared prompt/content data for the party & write-and-vote games (Quiplash Clash,
// Definition Duel, Most Likely To, Awkward Award, Vote Prophet, Mob Rule, Group Mind).
// Prompts are subjective/comedic; the Definition Duel words use real, verifiable definitions.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- Quiplash-style fill-in-the-blank comedy prompts ----
export const QUIP_PROMPTS = [
  'The worst possible thing to say on a first date',
  'A terrible name for a perfume',
  'A rejected flavor of ice cream',
  'The real reason the dinosaurs went extinct',
  'A bad slogan for a funeral home',
  "Something you shouldn't say to your boss",
  'A superpower that would be completely useless',
  "The title of a movie that's guaranteed to flop",
  'A weird thing to bring to a job interview',
  'The worst name for a boat',
  'A surprising new Olympic sport',
  "Something you'd be sad to find in your sandwich",
  'A bad gift for a five-year-old',
  'The most boring theme park ride imaginable',
  'A terrible motivational poster slogan',
  "A new law that would instantly ruin everyone's day",
  'The worst possible last words',
  'An awful name for a rock band',
  "Something a robot would say to take over the world",
  'A really bad excuse for being late',
  'The least appetizing pizza topping',
  'A terrible thing to whisper during a wedding',
  'The worst superhero sidekick',
  'A confusing thing to yell at a sports game',
];

// ---- Definition Duel: real obscure words with accurate definitions ----
export const DEFINITION_WORDS = [
  { word: 'defenestration', definition: 'the act of throwing someone or something out of a window' },
  { word: 'petrichor', definition: 'the pleasant earthy smell of rain falling on dry ground' },
  { word: 'collywobbles', definition: 'stomach pain or queasiness, or a feeling of nervousness' },
  { word: 'lollygag', definition: 'to spend time aimlessly; to dawdle' },
  { word: 'flibbertigibbet', definition: 'a frivolous, flighty, or excessively talkative person' },
  { word: 'widdershins', definition: "in a direction contrary to the sun's course; counterclockwise" },
  { word: 'brouhaha', definition: 'a noisy and overexcited reaction or uproar' },
  { word: 'borborygmus', definition: 'a rumbling noise made by gas moving through the intestines' },
  { word: 'cattywampus', definition: 'askew, awry, or positioned diagonally' },
  { word: 'absquatulate', definition: 'to leave abruptly or to abscond' },
  { word: 'taradiddle', definition: 'a petty lie, or pretentious nonsense' },
  { word: 'ultracrepidarian', definition: 'a person who gives opinions beyond their area of knowledge' },
  { word: 'snollygoster', definition: 'a shrewd, unprincipled person, especially a politician' },
  { word: 'gobbledygook', definition: 'language that is meaningless or made unintelligible by jargon' },
  { word: 'mondegreen', definition: 'a misheard word or phrase that makes a kind of sense' },
  { word: 'bumbershoot', definition: 'an informal word for an umbrella' },
  { word: 'gardyloo', definition: 'an old warning cry used before throwing slops from a window' },
  { word: 'sialoquent', definition: 'tending to spray saliva while speaking' },
  { word: 'pandiculation', definition: 'the act of stretching and yawning, especially on waking' },
  { word: 'gongoozler', definition: 'a person who idly watches activity on canals or waterways' },
  { word: 'quockerwodger', definition: 'a puppet, or a politician acting on behalf of others' },
  { word: 'crepuscular', definition: 'relating to or resembling twilight; active at dusk and dawn' },
  { word: 'velleity', definition: 'a wish or inclination too slight to lead to action' },
  { word: 'nudiustertian', definition: 'relating to the day before yesterday' },
];

// ---- "Most likely to ___" prompts (player-target voting) ----
export const MOST_LIKELY = [
  'become a famous influencer',
  'survive a zombie apocalypse',
  'accidentally start a conga line',
  'forget their own birthday',
  'win the lottery and lose the ticket',
  'talk their way out of a speeding ticket',
  'cry during a cartoon movie',
  'become a contestant on a reality show',
  'get lost in their own neighbourhood',
  'adopt seven cats',
  'fall asleep at a concert',
  'invent something ridiculous and get rich',
  'show up an hour early to everything',
  'name their kid something unpronounceable',
  'eat the last slice without asking',
  'go viral for something embarrassing',
  'become a world-class procrastinator',
  'start a podcast nobody asked for',
  'panic in a mild emergency',
  'befriend a complete stranger in five minutes',
];

// ---- Awkward Award: silly trophy names ----
export const AWKWARD_TROPHIES = [
  'Most Likely to Trip on Flat Ground',
  'The "I Definitely Read the Instructions" Award',
  'Champion of Awkward Silences',
  'Best at Replying "lol" to Serious Texts',
  'The Golden Snooze Button',
  'Most Dramatic Reaction to Spicy Food',
  'The "It Was Like That When I Got Here" Trophy',
  'Reigning Master of the Bad Pun',
  'Most Likely to Lose a Staring Contest with a Wall',
  'The "I Could Totally Beat a Goose" Medal',
  'Best Performance in a Group Photo',
  'The Procrastination Lifetime Achievement Award',
];

// ---- Vote Prophet / Mob Rule: opinion prompts with two fixed sides (no correct answer) ----
export const OPINION_PROMPTS = [
  { prompt: 'Pineapple on pizza?', a: 'Absolutely yes', b: 'A crime' },
  { prompt: 'Best way to eat cereal?', a: 'Milk first', b: 'Cereal first' },
  { prompt: 'Cats or dogs?', a: 'Cats', b: 'Dogs' },
  { prompt: 'The toilet paper roll should go...', a: 'Over', b: 'Under' },
  { prompt: 'Is a hot dog a sandwich?', a: 'Yes', b: 'No' },
  { prompt: 'Better season?', a: 'Summer', b: 'Winter' },
  { prompt: 'Morning person or night owl?', a: 'Morning', b: 'Night' },
  { prompt: 'Texting: punctuation or chaos?', a: 'Proper punctuation', b: 'Pure chaos' },
  { prompt: 'Better superpower?', a: 'Flight', b: 'Invisibility' },
  { prompt: 'Beach or mountains?', a: 'Beach', b: 'Mountains' },
  { prompt: 'Movie nights: theatre or couch?', a: 'Theatre', b: 'Couch' },
  { prompt: 'Sweet or savoury breakfast?', a: 'Sweet', b: 'Savoury' },
  { prompt: 'Would you rather be...', a: 'Always too hot', b: 'Always too cold' },
  { prompt: 'Better game night?', a: 'Board games', b: 'Video games' },
];

// ---- Group Mind: open categories where you try to MATCH others ----
export const GROUP_CATEGORIES = [
  'Name a pizza topping',
  'Name a colour',
  'Name a country',
  'Name a fruit',
  'Name a movie everyone has seen',
  'Name a zoo animal',
  'Name a board game',
  'Name something in a kitchen',
  'Name a superhero',
  'Name a sport',
  'Name an ice cream flavour',
  'Name a day of the week',
  'Name something you pack for a holiday',
  'Name a breakfast food',
  'Name a famous landmark',
  'Name a school subject',
];

function pick(list, n) { return shuffle(list).slice(0, n); }
export function pickQuips(n = 1) { return pick(QUIP_PROMPTS, n); }
export function pickDefinitionWords(n = 1) { return pick(DEFINITION_WORDS, n); }
export function pickMostLikely(n = 1) { return pick(MOST_LIKELY, n); }
export function pickTrophies(n = 1) { return pick(AWKWARD_TROPHIES, n); }
export function pickOpinions(n = 1) { return pick(OPINION_PROMPTS, n); }
export function pickGroupCategories(n = 1) { return pick(GROUP_CATEGORIES, n); }
export { shuffle };
