import { BaseGame } from './BaseGame.js';
import { WORDS } from '../utils/words.js';

const MAX_WRONG = 6;
const TOTAL_ROUNDS = 5;

export class Hangman extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { finish: 'finished' },
      },
    });
    this.word = '';
    this.guessedLetters = new Set();
    this.wrongCounts = {};
    this.eliminated = [];
    this.revealed = [];
    this.wordGuessWinner = null;
    this.round = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.scores = {}; // playerId -> cumulative score
    this.roundResults = [];
  }

  startGame() {
    for (const p of this.players) {
      this.scores[p] = 0;
    }
    this.round = 0;
    this.roundResults = [];
    this.transition('start');
    this._startRound();
  }

  _startRound() {
    this.round++;
    this.word = WORDS[Math.floor(Math.random() * WORDS.length)];
    this.guessedLetters = new Set();
    this.wrongCounts = {};
    this.eliminated = [];
    this.revealed = new Array(this.word.length).fill(false);
    this.wordGuessWinner = null;

    // Reset active players for new round
    this.activePlayers = [...this.players];

    for (const p of this.players) {
      this.wrongCounts[p] = 0;
    }

    this.setTurnPlayer(this.players[0]);
  }

  _isWordComplete() {
    return this.revealed.every(Boolean);
  }

  _allEliminated() {
    return this.players.every((p) => this.eliminated.includes(p));
  }

  _endRound() {
    // Score: word guesser gets 3 pts, survivors get 2 pts minus wrongCount/3, eliminated get 0
    for (const p of this.players) {
      if (p === this.wordGuessWinner) {
        this.scores[p] += 3;
      } else if (!this.eliminated.includes(p)) {
        this.scores[p] += Math.max(1, 2 - Math.floor((this.wrongCounts[p] || 0) / 3));
      }
    }

    this.roundResults.push({
      round: this.round,
      word: this.word,
      wordGuessed: this._isWordComplete(),
      wordGuessWinner: this.wordGuessWinner,
    });

    // Show the word for a few seconds before advancing
    this.showingWord = true;
    this.revealedWord = this.word;
    this._emitChange();

    if (this._roundTimer) clearTimeout(this._roundTimer);
    this._roundTimer = setTimeout(() => {
      this.showingWord = false;
      if (this.round >= TOTAL_ROUNDS) {
        this.transition('finish');
      } else {
        this._startRound();
      }
      this._emitChange();
    }, 4000);
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (this.eliminated.includes(playerId)) return;

    if (action.type === 'guessWord') {
      const guess = (action.word || '').toLowerCase().trim();
      if (!guess || guess.length === 0) return;

      if (guess === this.word) {
        this.revealed = new Array(this.word.length).fill(true);
        this.wordGuessWinner = playerId;
        this._endRound();
        return;
      } else {
        this.wrongCounts[playerId] = MAX_WRONG;
        if (!this.eliminated.includes(playerId)) {
          this.eliminated.push(playerId);
          this.removePlayer(playerId);
        }
        if (this._allEliminated()) {
          this._endRound();
          return;
        }
        return;
      }
    }

    if (playerId !== this.currentTurnPlayer) return;

    if (action.type === 'guess') {
      const letter = action.letter;
      if (typeof letter !== 'string' || letter.length !== 1) return;
      const normalLetter = letter.toLowerCase();
      if (!/^[a-z]$/.test(normalLetter)) return;
      if (this.guessedLetters.has(normalLetter)) return;

      this.guessedLetters.add(normalLetter);

      if (this.word.includes(normalLetter)) {
        for (let i = 0; i < this.word.length; i++) {
          if (this.word[i] === normalLetter) {
            this.revealed[i] = true;
          }
        }
        if (this._isWordComplete()) {
          this._endRound();
          return;
        }
      } else {
        this.wrongCounts[playerId] = (this.wrongCounts[playerId] || 0) + 1;
        if (this.wrongCounts[playerId] >= MAX_WRONG) {
          this.eliminated.push(playerId);
          this.removePlayer(playerId);
        }
        if (this._allEliminated()) {
          this._endRound();
          return;
        }
      }

      if (this.state === 'playing') {
        if (this.activePlayers.length > 0) {
          if (!this.eliminated.includes(playerId)) {
            this.nextTurn();
          }
        } else {
          this._endRound();
        }
      }
    }
  }

  getStateForPlayer(playerId) {
    const displayWord = this.word.split('').map((letter, i) =>
      this.revealed[i] ? letter : '_'
    );

    const playerStates = this.players.map((p) => ({
      playerId: p,
      wrongCount: this.wrongCounts[p] || 0,
      eliminated: this.eliminated.includes(p),
    }));

    const showWord = this.isComplete() || this.showingWord;

    return {
      displayWord,
      word: showWord ? (this.revealedWord || this.word) : undefined,
      wordGuessed: showWord ? this._isWordComplete() : undefined,
      wordGuessWinner: showWord ? (this.wordGuessWinner || null) : undefined,
      showingWord: !!this.showingWord,
      guessedLetters: [...this.guessedLetters],
      playerStates,
      currentTurnPlayer: this.currentTurnPlayer,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      myWrongCount: this.wrongCounts[playerId] || 0,
      isEliminated: this.eliminated.includes(playerId),
      phase: this.state,
      round: this.round,
      totalRounds: this.totalRounds,
      scores: this.scores,
      roundResults: this.roundResults,
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const entries = this.players.map((p) => ({
      playerId: p,
      score: this.scores[p] || 0,
      totalWrong: this.players.reduce(() => 0, 0), // not meaningful across rounds
    }));

    entries.sort((a, b) => b.score - a.score);

    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.score < entries[i - 1].score) {
        placement = i + 1;
      }
      return {
        ...e,
        placement,
        handDescription: `${e.score} pts`,
      };
    });
  }
}
