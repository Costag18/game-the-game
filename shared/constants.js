export const SCORING = {
  BASE_START: 100,
  BASE_INCREMENT: 50,
  PLACEMENT_MULTIPLIERS: [1.0, 0.7, 0.5, 0.35, 0.25, 0.15],
  MAX_WAGER_PERCENT: 0.5,
  // Wager return multipliers by placement: 1st gets 2x wager back, 2nd 1.5x, 3rd breaks even, 4th+ loses it all
  WAGER_RETURN: [2.0, 1.5, 1.0, 0, 0, 0],
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
