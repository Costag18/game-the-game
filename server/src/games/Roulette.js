import { BaseGame } from './BaseGame.js';

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const TOTAL_ROUNDS = 5;

export class Roulette extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'betting', 'spinning', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'betting' },
        betting: { spin: 'spinning' },
        spinning: { nextRound: 'betting', finish: 'finished' },
      },
    });
    this.chips = {};       // playerId -> chip count
    this.bets = {};        // playerId -> array of bet objects
    this.betSubmitted = {}; // playerId -> bool
    this.spinResult = null;
    this.round = 0;
    this.history = [];     // array of { round, result, payouts }
    this.acknowledged = new Set();
  }

  startGame() {
    this.chips = {};
    this.bets = {};
    this.betSubmitted = {};
    this.spinResult = null;
    this.round = 0;
    this.history = [];

    for (const p of this.players) {
      this.chips[p] = 1000;
      this.bets[p] = [];
      this.betSubmitted[p] = false;
    }

    this.transition('start');
    this.round = 1;
    this._autoSkipBrokePlayers();
  }

  _autoSkipBrokePlayers() {
    // Auto-submit empty bets for players with 0 chips
    for (const p of this.players) {
      if (this.chips[p] <= 0 && !this.betSubmitted[p]) {
        this.bets[p] = [];
        this.betSubmitted[p] = true;
      }
    }
    // If all players are broke, end the game
    const allBroke = this.players.every((p) => this.chips[p] <= 0);
    if (allBroke) {
      this.state = 'finished';
      return;
    }
    // If all submitted (everyone broke or mix), trigger spin
    const allSubmitted = this.players.every((p) => this.betSubmitted[p]);
    if (allSubmitted) {
      this._spin();
    }
  }

  _totalBetAmount(bets) {
    return bets.reduce((sum, b) => sum + b.amount, 0);
  }

  _validateBets(playerId, bets) {
    if (!Array.isArray(bets) || bets.length === 0) return false;
    for (const bet of bets) {
      if (!bet || typeof bet.amount !== 'number' || bet.amount <= 0) return false;
      const validTypes = ['straight', 'red', 'black', 'odd', 'even', 'low', 'high'];
      if (!validTypes.includes(bet.type)) return false;
      if (bet.type === 'straight') {
        if (typeof bet.value !== 'number' || bet.value < 0 || bet.value > 36) return false;
      }
    }
    const total = this._totalBetAmount(bets);
    return total <= this.chips[playerId];
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;

    if (this.state === 'betting') {
      if (this.betSubmitted[playerId]) return;
      if (this.chips[playerId] <= 0) return;

      if (action.type === 'bet') {
        const { bets } = action;
        if (!this._validateBets(playerId, bets)) return;
        this.bets[playerId] = bets;
        this.betSubmitted[playerId] = true;

        const allSubmitted = this.players.every((p) => this.betSubmitted[p]);
        if (allSubmitted) {
          this._spin();
        }
      }
    } else if (this.state === 'spinning') {
      if (action.type === 'acknowledge') {
        this.acknowledged.add(playerId);
        const allAcked = this.players.every((p) => this.acknowledged.has(p));
        if (allAcked) {
          this._advanceAfterSpin();
        }
      }
    }
  }

  _spin() {
    this.transition('spin');
    this.spinResult = Math.floor(Math.random() * 37); // 0–36
    const result = this.spinResult;
    const payouts = {};

    for (const p of this.players) {
      const betList = this.bets[p] || [];
      let netChange = -this._totalBetAmount(betList); // deduct all bets
      for (const bet of betList) {
        const payout = this._calculatePayout(bet, result);
        netChange += payout;
      }
      this.chips[p] = Math.max(0, this.chips[p] + netChange);
      payouts[p] = netChange;
    }

    this.history.push({ round: this.round, result, payouts });
    this.acknowledged = new Set();

    // Auto-acknowledge for broke players — they don't need to click through
    for (const p of this.players) {
      if (this.chips[p] <= 0) {
        this.acknowledged.add(p);
      }
    }

    // If all players are now broke, everyone auto-acked
    if (this.players.every((p) => this.acknowledged.has(p))) {
      this._advanceAfterSpin();
    }
  }

  _advanceAfterSpin() {
    // End if all rounds played
    if (this.round >= TOTAL_ROUNDS) {
      this.transition('finish');
      return;
    }

    // End early if at most one player has chips (no competition left)
    const playersWithChips = this.players.filter((p) => this.chips[p] > 0);
    if (playersWithChips.length <= 1) {
      this.transition('finish');
      return;
    }

    this.round++;
    this.spinResult = null;
    for (const p of this.players) {
      this.bets[p] = [];
      this.betSubmitted[p] = false;
    }
    this.transition('nextRound');
    this._autoSkipBrokePlayers();
  }

  _calculatePayout(bet, result) {
    // Returns total return (including original stake) if win, or 0 if loss
    const { type, value, amount } = bet;
    switch (type) {
      case 'straight':
        return result === value ? amount * 36 : 0; // 35:1 + original = 36x
      case 'red':
        return result !== 0 && RED_NUMBERS.has(result) ? amount * 2 : 0;
      case 'black':
        return result !== 0 && !RED_NUMBERS.has(result) ? amount * 2 : 0;
      case 'odd':
        return result !== 0 && result % 2 !== 0 ? amount * 2 : 0;
      case 'even':
        return result !== 0 && result % 2 === 0 ? amount * 2 : 0;
      case 'low': // 1-18
        return result >= 1 && result <= 18 ? amount * 2 : 0;
      case 'high': // 19-36
        return result >= 19 && result <= 36 ? amount * 2 : 0;
      default:
        return 0;
    }
  }

  getStateForPlayer(playerId) {
    const otherPlayers = this.players
      .filter((p) => p !== playerId)
      .map((p) => ({
        playerId: p,
        chips: this.chips[p],
        betSubmitted: this.betSubmitted[p],
      }));

    return {
      myChips: this.chips[playerId] || 0,
      isBroke: (this.chips[playerId] || 0) <= 0,
      myBets: this.bets[playerId] || [],
      myBetSubmitted: this.betSubmitted[playerId] || false,
      spinResult: this.state === 'spinning' || this.state === 'finished'
        ? this.spinResult
        : null,
      round: this.round,
      totalRounds: TOTAL_ROUNDS,
      otherPlayers,
      phase: this.state,
      history: this.history,
    };
  }

  removePlayer(playerId) {
    super.removePlayer(playerId);
    this.players = this.players.filter((p) => p !== playerId);
    if (this.players.length <= 1) {
      this.state = 'finished';
      return;
    }
    // Auto-submit bet if waiting
    if (this.state === 'betting' && !this.betSubmitted[playerId]) {
      this.betSubmitted[playerId] = true;
      this._autoSkipBrokePlayers();
    }
    // Auto-ack if in spinning
    if (this.state === 'spinning') {
      this.acknowledged.add(playerId);
      if (this.players.every((p) => this.acknowledged.has(p))) {
        this._advanceAfterSpin();
      }
    }
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const scores = this.players.map((p) => ({
      playerId: p,
      chips: this.chips[p] || 0,
    }));
    scores.sort((a, b) => b.chips - a.chips);

    // Handle ties — players with equal chips get the same placement
    let placement = 1;
    return scores.map((s, i) => {
      if (i > 0 && s.chips < scores[i - 1].chips) {
        placement = i + 1;
      }
      return {
        playerId: s.playerId,
        placement,
        chips: s.chips,
      };
    });
  }
}
