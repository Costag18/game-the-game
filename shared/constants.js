export const SCORING = {
  BASE_START: 100,
  BASE_INCREMENT: 50,
  PLACEMENT_MULTIPLIERS: [1.0, 0.7, 0.5, 0.35, 0.25, 0.15],
  MAX_WAGER_PERCENT: 0.5,
  // Wager return multipliers by player count → placement array
  // Break-even shifts to the middle so there's always risk
  WAGER_RETURN_BY_PLAYERS: {
    2: [2.0, 0],
    3: [2.0, 1.0, 0],
    4: [2.0, 1.5, 0.5, 0],
    5: [2.5, 1.5, 1.0, 0.5, 0],
    6: [3.0, 2.0, 1.5, 1.0, 0.5, 0],
    7: [3.0, 2.0, 1.5, 1.0, 0.5, 0, 0],
    8: [3.0, 2.0, 1.5, 1.0, 0.5, 0, 0, 0],
  },
};

export const TIMERS = {
  CARD_GAME: 30,
  RPS: 15,
  ROULETTE: 60,
  VOTE: 20,
  WAGER: 30,
  RECONNECT_GRACE: 45,
};

export const LOBBY = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  WIN_CONDITIONS: {
    FIXED_ROUNDS: 'fixedRounds',
    POINT_THRESHOLD: 'pointThreshold',
  },
  ROUND_OPTIONS: [5, 10, 15],
  THRESHOLD_OPTIONS: [1000, 2000, 5000],
};
