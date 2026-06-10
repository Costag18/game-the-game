// Shared factual data for the trivia/knowledge games (Buzzer Royale, Higher or Lower,
// Price Is Wrong, Guesstimate, Timeline, Odd One Out, Rank It, This or That, Trivia Duel).
// Curated for canonical, stable facts only — no volatile figures (live prices/populations).
// All answers are server-side; clients never receive the answer key for the active question.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- Multiple choice: { q, choices: [4], answer: index } ----
export const MULTIPLE_CHOICE = [
  { q: 'Which planet is the largest in our solar system?', choices: ['Saturn', 'Jupiter', 'Neptune', 'Earth'], answer: 1 },
  { q: 'What is the chemical symbol for gold?', choices: ['Go', 'Gd', 'Au', 'Ag'], answer: 2 },
  { q: 'How many continents are there on Earth?', choices: ['5', '6', '7', '8'], answer: 2 },
  { q: 'Which gas do plants absorb from the atmosphere?', choices: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], answer: 2 },
  { q: 'What is the largest ocean on Earth?', choices: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answer: 3 },
  { q: 'Who painted the Mona Lisa?', choices: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Donatello'], answer: 1 },
  { q: 'How many sides does a hexagon have?', choices: ['5', '6', '7', '8'], answer: 1 },
  { q: 'What is the hardest natural substance on Earth?', choices: ['Gold', 'Iron', 'Diamond', 'Quartz'], answer: 2 },
  { q: 'Which country is home to the kangaroo?', choices: ['Brazil', 'Australia', 'India', 'Kenya'], answer: 1 },
  { q: 'What is the smallest prime number?', choices: ['0', '1', '2', '3'], answer: 2 },
  { q: 'Which organ pumps blood through the body?', choices: ['Liver', 'Lungs', 'Heart', 'Kidney'], answer: 2 },
  { q: 'How many strings does a standard guitar have?', choices: ['4', '5', '6', '7'], answer: 2 },
  { q: 'What is the capital of Japan?', choices: ['Kyoto', 'Osaka', 'Tokyo', 'Seoul'], answer: 2 },
  { q: 'Which metal is liquid at room temperature?', choices: ['Mercury', 'Lead', 'Tin', 'Zinc'], answer: 0 },
  { q: 'What is the freezing point of water in Celsius?', choices: ['0', '32', '100', '-10'], answer: 0 },
  { q: 'Which animal is the largest living mammal?', choices: ['Elephant', 'Blue whale', 'Giraffe', 'Hippo'], answer: 1 },
  { q: 'How many minutes are in a full day?', choices: ['1200', '1440', '1600', '2400'], answer: 1 },
  { q: 'Which planet is known as the Red Planet?', choices: ['Venus', 'Mars', 'Mercury', 'Jupiter'], answer: 1 },
  { q: 'What is the main language spoken in Brazil?', choices: ['Spanish', 'Portuguese', 'French', 'English'], answer: 1 },
  { q: 'Which is the longest river in the world?', choices: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], answer: 1 },
  { q: 'How many colours are in a rainbow?', choices: ['5', '6', '7', '9'], answer: 2 },
  { q: 'What is the chemical symbol for water?', choices: ['CO2', 'H2O', 'O2', 'NaCl'], answer: 1 },
  { q: 'Which is the tallest mountain above sea level?', choices: ['K2', 'Kilimanjaro', 'Everest', 'Denali'], answer: 2 },
  { q: 'How many legs does a spider have?', choices: ['6', '8', '10', '12'], answer: 1 },
  { q: 'What is the largest planet-orbiting body of Earth called?', choices: ['The Sun', 'The Moon', 'Mars', 'Venus'], answer: 1 },
  { q: 'Which country built the Great Pyramid of Giza?', choices: ['Greece', 'Egypt', 'Italy', 'Mexico'], answer: 1 },
  { q: 'What do bees collect from flowers?', choices: ['Pollen', 'Sand', 'Water', 'Sap'], answer: 0 },
  { q: 'How many players are on a standard soccer team on the field?', choices: ['9', '10', '11', '12'], answer: 2 },
  { q: 'Which is a primary colour of light?', choices: ['Green', 'Orange', 'Purple', 'Brown'], answer: 0 },
  { q: 'What is the closest planet to the Sun?', choices: ['Venus', 'Earth', 'Mercury', 'Mars'], answer: 2 },
  { q: 'Which instrument has black and white keys?', choices: ['Violin', 'Piano', 'Flute', 'Drums'], answer: 1 },
  { q: 'How many degrees are in a right angle?', choices: ['45', '90', '180', '360'], answer: 1 },
];

// ---- Quantities: { label, value, unit }. Used by Higher/Lower & Rank It — correct
// RELATIVE order is what matters; values are canonical approximations. ----
export const QUANTITIES = [
  { label: 'Speed of a cheetah (top)', value: 110, unit: 'km/h' },
  { label: 'Speed of a house cat (top)', value: 48, unit: 'km/h' },
  { label: 'Speed of a human sprinter (top)', value: 44, unit: 'km/h' },
  { label: 'Speed of a garden snail', value: 0.05, unit: 'km/h' },
  { label: 'Speed of a peregrine falcon (dive)', value: 320, unit: 'km/h' },
  { label: 'Diameter of Earth', value: 12742, unit: 'km' },
  { label: 'Diameter of the Moon', value: 3474, unit: 'km' },
  { label: 'Diameter of Jupiter', value: 139820, unit: 'km' },
  { label: 'Diameter of Mars', value: 6779, unit: 'km' },
  { label: 'Height of Mount Everest', value: 8849, unit: 'm' },
  { label: 'Height of the Eiffel Tower', value: 330, unit: 'm' },
  { label: 'Height of the Burj Khalifa', value: 828, unit: 'm' },
  { label: 'Height of the Statue of Liberty', value: 93, unit: 'm' },
  { label: 'Number of bones in the human body', value: 206, unit: 'bones' },
  { label: 'Number of teeth in an adult human', value: 32, unit: 'teeth' },
  { label: 'Legs on a spider', value: 8, unit: 'legs' },
  { label: 'Legs on an insect', value: 6, unit: 'legs' },
  { label: 'Days in a leap year', value: 366, unit: 'days' },
  { label: 'Boiling point of water', value: 100, unit: '°C' },
  { label: 'Number of keys on a standard piano', value: 88, unit: 'keys' },
  { label: 'Number of squares on a chessboard', value: 64, unit: 'squares' },
  { label: 'Cards in a standard deck', value: 52, unit: 'cards' },
  { label: 'Players on a basketball team (on court)', value: 5, unit: 'players' },
  { label: 'Wonders of the ancient world', value: 7, unit: 'wonders' },
  { label: 'Strings on a violin', value: 4, unit: 'strings' },
  { label: 'Length of a marathon', value: 42, unit: 'km' },
  { label: 'Number of moons of Mars', value: 2, unit: 'moons' },
  { label: 'Number of planets in the solar system', value: 8, unit: 'planets' },
];

// ---- Numeric facts: { prompt, answer, unit }. Used by Price Is Wrong (closest-without-over)
// and Guesstimate (log-closeness). Stable physical quantities, not market prices. ----
export const NUMERIC_FACTS = [
  { prompt: 'Height of the Eiffel Tower', answer: 330, unit: 'metres' },
  { prompt: 'Number of bones in the adult human body', answer: 206, unit: 'bones' },
  { prompt: 'Boiling point of water', answer: 100, unit: '°C' },
  { prompt: 'Number of keys on a standard piano', answer: 88, unit: 'keys' },
  { prompt: 'Length of a marathon (rounded)', answer: 42, unit: 'km' },
  { prompt: 'Number of squares on a chessboard', answer: 64, unit: 'squares' },
  { prompt: 'Height of Mount Everest', answer: 8849, unit: 'metres' },
  { prompt: 'Number of countries in the United Nations', answer: 193, unit: 'countries' },
  { prompt: 'Number of hearts an octopus has', answer: 3, unit: 'hearts' },
  { prompt: 'Diameter of Earth', answer: 12742, unit: 'km' },
  { prompt: 'Number of teeth in an adult human', answer: 32, unit: 'teeth' },
  { prompt: 'Days it takes the Moon to orbit Earth (rounded)', answer: 27, unit: 'days' },
  { prompt: 'Height of the Burj Khalifa', answer: 828, unit: 'metres' },
  { prompt: 'Number of strings on a standard guitar', answer: 6, unit: 'strings' },
  { prompt: 'Speed of light (rounded)', answer: 300000, unit: 'km/s' },
  { prompt: 'Number of players on a soccer team on the field', answer: 11, unit: 'players' },
  { prompt: 'Number of minutes in a day', answer: 1440, unit: 'minutes' },
  { prompt: 'Freezing point of water in Fahrenheit', answer: 32, unit: '°F' },
];

// ---- Timeline events: { event, year }. Well-known, uncontroversial dates. ----
export const EVENTS = [
  { event: 'First human steps on the Moon', year: 1969 },
  { event: 'The Berlin Wall falls', year: 1989 },
  { event: 'The Titanic sinks', year: 1912 },
  { event: 'End of World War II', year: 1945 },
  { event: 'The first iPhone is released', year: 2007 },
  { event: 'The World Wide Web is invented', year: 1989 },
  { event: 'Declaration of US Independence', year: 1776 },
  { event: 'The French Revolution begins', year: 1789 },
  { event: 'The first powered airplane flight (Wright brothers)', year: 1903 },
  { event: 'The first successful printing press (Gutenberg)', year: 1440 },
  { event: 'Columbus reaches the Americas', year: 1492 },
  { event: 'The Great Fire of London', year: 1666 },
  { event: 'The first modern Olympic Games', year: 1896 },
  { event: 'The discovery of penicillin', year: 1928 },
  { event: 'The fall of the Roman Empire (Western)', year: 476 },
  { event: 'The signing of the Magna Carta', year: 1215 },
  { event: 'The first email is sent', year: 1971 },
  { event: 'The first photograph is taken', year: 1826 },
];

// ---- Odd one out: { items: [4], oddIndex, rule } (one item breaks a hidden rule) ----
export const ODD_ONE_OUT = [
  { items: ['Apple', 'Banana', 'Carrot', 'Cherry'], oddIndex: 2, rule: 'the others are fruits, carrot is a vegetable' },
  { items: ['Dog', 'Shark', 'Whale', 'Dolphin'], oddIndex: 0, rule: 'the others live in the sea' },
  { items: ['Triangle', 'Square', 'Circle', 'Pentagon'], oddIndex: 2, rule: 'the others have straight sides' },
  { items: ['Mercury', 'Venus', 'Moon', 'Mars'], oddIndex: 2, rule: 'the others are planets, the Moon is a satellite' },
  { items: ['Red', 'Green', 'Blue', 'Square'], oddIndex: 3, rule: 'the others are colours' },
  { items: ['Piano', 'Violin', 'Trumpet', 'Drum'], oddIndex: 2, rule: 'the others are not brass instruments' },
  { items: ['2', '4', '7', '8'], oddIndex: 2, rule: 'the others are even numbers' },
  { items: ['Lion', 'Tiger', 'Leopard', 'Wolf'], oddIndex: 3, rule: 'the others are big cats' },
  { items: ['Gold', 'Silver', 'Iron', 'Bronze'], oddIndex: 2, rule: 'the others are Olympic medal metals' },
  { items: ['Spain', 'France', 'Brazil', 'Italy'], oddIndex: 2, rule: 'the others are in Europe' },
  { items: ['Spring', 'Summer', 'Monday', 'Winter'], oddIndex: 2, rule: 'the others are seasons' },
  { items: ['Oak', 'Pine', 'Rose', 'Maple'], oddIndex: 2, rule: 'the others are trees' },
];

// ---- Rank It: { category, ordered: [...] } in the CORRECT order (largest/first to smallest/last) ----
export const RANK_SETS = [
  { category: 'Planets by distance from the Sun (closest first)', ordered: ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter'] },
  { category: 'Largest oceans (biggest first)', ordered: ['Pacific', 'Atlantic', 'Indian', 'Arctic'] },
  { category: 'Fastest animals (fastest first)', ordered: ['Peregrine falcon', 'Cheetah', 'Greyhound', 'House cat', 'Snail'] },
  { category: 'Tallest structures (tallest first)', ordered: ['Burj Khalifa', 'Eiffel Tower', 'Statue of Liberty', 'A giraffe'] },
  { category: 'Chronological order (earliest first)', ordered: ['Roman Empire', 'Magna Carta', 'Columbus 1492', 'Moon landing'] },
  { category: 'Number of sides (fewest first)', ordered: ['Triangle', 'Square', 'Pentagon', 'Hexagon', 'Octagon'] },
  { category: 'Months of the year (in order)', ordered: ['January', 'March', 'June', 'September', 'December'] },
  { category: 'Heaviest land animals (heaviest first)', ordered: ['Elephant', 'Rhino', 'Horse', 'Human', 'Cat'] },
];

// ---- This or That: { prompt, a, b, correct: 'a'|'b' } binary fact ----
export const THIS_OR_THAT = [
  { prompt: 'Larger by land area?', a: 'Russia', b: 'Canada', correct: 'a' },
  { prompt: 'Closer to the Sun?', a: 'Earth', b: 'Mars', correct: 'a' },
  { prompt: 'Faster top speed?', a: 'Cheetah', b: 'Greyhound', correct: 'a' },
  { prompt: 'Taller?', a: 'Eiffel Tower', b: 'Statue of Liberty', correct: 'a' },
  { prompt: 'Heavier?', a: 'Blue whale', b: 'Elephant', correct: 'a' },
  { prompt: 'More legs?', a: 'Spider', b: 'Insect', correct: 'a' },
  { prompt: 'Happened earlier?', a: 'Moon landing', b: 'First iPhone', correct: 'a' },
  { prompt: 'Longer river?', a: 'Nile', b: 'Thames', correct: 'a' },
  { prompt: 'Bigger planet?', a: 'Jupiter', b: 'Earth', correct: 'a' },
  { prompt: 'Hotter?', a: 'Boiling water', b: 'Freezing water', correct: 'a' },
  { prompt: 'More keys?', a: 'Piano', b: 'Guitar', correct: 'a' },
  { prompt: 'Older invention?', a: 'Printing press', b: 'The internet', correct: 'a' },
  { prompt: 'Larger ocean?', a: 'Pacific', b: 'Atlantic', correct: 'a' },
  { prompt: 'More sides?', a: 'Octagon', b: 'Hexagon', correct: 'a' },
  { prompt: 'Bigger country by area?', a: 'Brazil', b: 'France', correct: 'a' },
  { prompt: 'Came first?', a: 'Dinosaurs', b: 'Humans', correct: 'a' },
];

function pick(list, n, exclude = []) {
  const ex = new Set(exclude);
  const pool = shuffle(list.filter((_, i) => !ex.has(i)));
  return pool.slice(0, n);
}

export function pickMultipleChoice(n = 1, exclude = []) { return pick(MULTIPLE_CHOICE, n, exclude); }
export function pickNumericFacts(n = 1, exclude = []) { return pick(NUMERIC_FACTS, n, exclude); }
export function pickEvents(n = 1, exclude = []) { return pick(EVENTS, n, exclude); }
export function pickOddOneOut(n = 1, exclude = []) { return pick(ODD_ONE_OUT, n, exclude); }
export function pickRankSets(n = 1, exclude = []) { return pick(RANK_SETS, n, exclude); }
export function pickThisOrThat(n = 1, exclude = []) { return pick(THIS_OR_THAT, n, exclude); }
export function shuffledQuantities() { return shuffle(QUANTITIES); }
export { shuffle };
