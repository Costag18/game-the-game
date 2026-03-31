import { BaseGame } from './BaseGame.js';
import { WORDS } from '../utils/words.js';

const MAX_WRONG = 6;

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
    this.wrongCounts = {}; // playerId -> number of wrong guesses
    this.eliminated = [];  // players who have been eliminated (6 wrong)
    this.revealed = [];    // array of booleans, one per letter
  }

  startGame() {
    this.word = WORDS[Math.floor(Math.random() * WORDS.length)];
    this.guessedLetters = new Set();
    this.wrongCounts = {};
    this.eliminated = [];
    this.revealed = new Array(this.word.length).fill(false);

    for (const p of this.players) {
      this.wrongCounts[p] = 0;
    }

    this.transition('start');
    this.setTurnPlayer(this.players[0]);
  }

  _isWordComplete() {
    return this.revealed.every(Boolean);
  }

  _allEliminated() {
    return this.players.every((p) => this.eliminated.includes(p));
  }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return;
    if (this.eliminated.includes(playerId)) return;

    if (action.type === 'guess') {
      const letter = action.letter;
      // Validate: single letter, not already guessed
      if (typeof letter !== 'string' || letter.length !== 1) return;
      const normalLetter = letter.toLowerCase();
      if (!/^[a-z]$/.test(normalLetter)) return;
      if (this.guessedLetters.has(normalLetter)) return;

      this.guessedLetters.add(normalLetter);

      if (this.word.includes(normalLetter)) {
        // Correct guess — reveal all instances
        for (let i = 0; i < this.word.length; i++) {
          if (this.word[i] === normalLetter) {
            this.revealed[i] = true;
          }
        }
        if (this._isWordComplete()) {
          this.transition('finish');
          return;
        }
      } else {
        // Wrong guess
        this.wrongCounts[playerId] = (this.wrongCounts[playerId] || 0) + 1;
        if (this.wrongCounts[playerId] >= MAX_WRONG) {
          this.eliminated.push(playerId);
          this.removePlayer(playerId);
        }

        if (this._allEliminated()) {
          this.transition('finish');
          return;
        }
      }

      // Advance to next active (non-eliminated) player
      if (this.state === 'playing') {
        if (this.activePlayers.length > 0) {
          // nextTurn() already wraps; if current player was just eliminated removePlayer handled it
          if (!this.eliminated.includes(playerId)) {
            this.nextTurn();
          }
          // If player was eliminated, removePlayer already moved currentTurnPlayer
        } else {
          // No active players left
          if (this.state === 'playing') {
            this.transition('finish');
          }
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

    return {
      displayWord,
      word: this.isComplete() ? this.word : undefined, // reveal word when game ends
      guessedLetters: [...this.guessedLetters],
      playerStates,
      currentTurnPlayer: this.currentTurnPlayer,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      myWrongCount: this.wrongCounts[playerId] || 0,
      isEliminated: this.eliminated.includes(playerId),
      phase: this.state,
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const survivors = this.players
      .filter((p) => !this.eliminated.includes(p))
      .map((p) => ({ playerId: p, wrongCount: this.wrongCounts[p] || 0, eliminated: false }))
      .sort((a, b) => a.wrongCount - b.wrongCount);

    // Eliminated players: last eliminated = highest placement (among eliminated)
    const eliminatedOrdered = [...this.eliminated].reverse().map((p) => ({
      playerId: p,
      wrongCount: this.wrongCounts[p] || 0,
      eliminated: true,
    }));

    const all = [...survivors, ...eliminatedOrdered];
    return all.map((entry, i) => ({
      ...entry,
      placement: i + 1,
    }));
  }
}
