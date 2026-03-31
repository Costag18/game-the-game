export function rollDice(sides = 6) {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollMultiple(count, sides = 6) {
  return Array.from({ length: count }, () => rollDice(sides));
}
