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
    this.wordGuessWinner = null;

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
    if (this.eliminated.includes(playerId)) return;

    // Full word guess — any player can attempt on any turn
    if (action.type === 'guessWord') {
      const guess = (action.word || '').toLowerCase().trim();
      if (!guess || guess.length === 0) return;

      if (guess === this.word) {
        // Correct! Reveal all letters, this player wins
        this.revealed = new Array(this.word.length).fill(true);
        this.wordGuessWinner = playerId;
        this.transition('finish');
        return;
      } else {
        // Wrong! Player is eliminated
        this.wrongCounts[playerId] = MAX_WRONG;
        if (!this.eliminated.includes(playerId)) {
          this.eliminated.push(playerId);
          this.removePlayer(playerId);
        }

        if (this._allEliminated()) {
          this.transition('finish');
          return;
        }

        // If it was their turn, the turn already moved via removePlayer
        return;
      }
    }

    // Letter guess — only on your turn
    if (playerId !== this.currentTurnPlayer) return;

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
      word: this.isComplete() ? this.word : undefined,
      wordGuessed: this.isComplete() ? this._isWordComplete() : undefined,
      wordGuessWinner: this.isComplete() ? (this.wordGuessWinner || null) : undefined,
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
    // If someone guessed the word, they're first
    const survivors = this.players
      .filter((p) => !this.eliminated.includes(p))
      .map((p) => ({ playerId: p, wrongCount: this.wrongCounts[p] || 0, eliminated: false }))
      .sort((a, b) => {
        // Word guess winner always first
        if (a.playerId === this.wordGuessWinner) return -1;
        if (b.playerId === this.wordGuessWinner) return 1;
        return a.wrongCount - b.wrongCount;
      });

    const eliminatedOrdered = [...this.eliminated].reverse().map((p) => ({
      playerId: p,
      wrongCount: this.wrongCounts[p] || 0,
      eliminated: true,
    }));

    const all = [...survivors, ...eliminatedOrdered];
    let placement = 1;
    return all.map((entry, i) => {
      if (i > 0) {
        const prev = all[i - 1];
        // Tied if both non-eliminated with same wrongCount (and neither is the word guesser)
        const tied = !entry.eliminated && !prev.eliminated
          && entry.wrongCount === prev.wrongCount
          && entry.playerId !== this.wordGuessWinner && prev.playerId !== this.wordGuessWinner;
        if (!tied) placement = i + 1;
      }
      return { ...entry, placement };
    });
  }
}
