import { Scorer } from './Scorer.js';

export class TournamentManager {
  constructor({ players, winCondition, winTarget, nicknames }) {
    this.players = [...players];
    this.winCondition = winCondition;
    this.winTarget = winTarget;
    this.nicknames = { ...(nicknames || {}) };
    this.scores = {};
    this.players.forEach((p) => (this.scores[p] = 100));
    this.currentRound = 0;
    this.phase = 'idle'; // idle | voting | wagering | playing | results
    this.votes = {};
    this.wagers = {};
    this.selectedGame = null;
    this.roundHistory = [];
  }

  startNextRound() {
    this.currentRound++;
    this.phase = 'voting';
    this.votes = {};
    this.wagers = {};
    this.selectedGame = null;
  }

  submitVote(playerId, gameId) {
    this.votes[playerId] = gameId;
  }

  tallyVotes() {
    const counts = {};
    for (const gameId of Object.values(this.votes)) counts[gameId] = (counts[gameId] || 0) + 1;
    const maxCount = Math.max(...Object.values(counts));
    const tied = Object.entries(counts).filter(([, c]) => c === maxCount).map(([g]) => g);
    this.selectedGame = tied[Math.floor(Math.random() * tied.length)];
    return this.selectedGame;
  }

  startWagerPhase() {
    this.phase = 'wagering';
    this.wagers = {};
    this.wagerSubmitted = new Set();
  }

  submitWager(playerId, amount) {
    if (!Scorer.validateWager(amount, this.scores[playerId])) {
      throw new Error(`Invalid wager: ${amount} (current points: ${this.scores[playerId]})`);
    }
    this.wagers[playerId] = amount;
    this.wagerSubmitted.add(playerId);
  }

  allWagersIn() {
    return this.players.every((p) => this.wagerSubmitted.has(p));
  }

  startPlaying() {
    this.phase = 'playing';
  }

  completeRound(placements, gameResults = null) {
    // Ensure all players have a wager entry (default 0)
    for (const p of this.players) {
      if (this.wagers[p] === undefined) this.wagers[p] = 0;
    }
    const roundScores = Scorer.calculateRoundScores(placements, this.wagers, this.currentRound, gameResults);
    for (const [playerId, scoreData] of Object.entries(roundScores)) {
      this.scores[playerId] += scoreData.total;
    }
    this.roundHistory.push({
      round: this.currentRound,
      game: this.selectedGame,
      placements,
      scores: roundScores,
    });
    this.phase = 'results';
    return roundScores;
  }

  isTournamentOver() {
    if (this.winCondition === 'fixedRounds') return this.roundHistory.length >= this.winTarget;
    if (this.winCondition === 'pointThreshold') return Object.values(this.scores).some((s) => s >= this.winTarget);
    return false;
  }

  getStandings() {
    return this.players
      .map((p) => ({ playerId: p, score: this.scores[p] }))
      .sort((a, b) => b.score - a.score);
  }

  getScores() {
    return { ...this.scores };
  }

  getWinner() {
    return this.getStandings()[0].playerId;
  }

  getState() {
    const nicks = this.nicknames || {};
    return {
      currentRound: this.currentRound,
      phase: this.phase,
      scores: this.getScores(),
      standings: this.getStandings().map((s) => ({
        ...s,
        nickname: nicks[s.playerId] || s.playerId.slice(0, 8),
      })),
      nicknames: nicks,
      selectedGame: this.selectedGame,
      winCondition: this.winCondition,
      winTarget: this.winTarget,
      votes: this.phase === 'voting' ? { ...this.votes } : null,
      wagers: this.phase === 'wagering' ? { ...this.wagers } : null,
    };
  }
}
