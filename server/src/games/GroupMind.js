import { BaseGame } from './BaseGame.js';
import { pickGroupCategories } from '../utils/partyBank.js';
import { normalizeGuess } from '../utils/guessMatch.js';

const POINTS_PER_MATCH = 100;
const TOTAL_ROUNDS = 5;
// Timers are defined locally (constants.js is a shared file we don't edit).
const WRITE_MS = 35_000;
const REVEAL_MS = 12_000;

/**
 * Group Mind — a write-and-match party game. Each round shows an open category
 * ("Name a pizza topping") and every player privately types ONE short answer,
 * trying to MATCH what others write. At reveal, all answers are normalised with
 * guessMatch.normalizeGuess and bucketed; a player scores +100 for every OTHER
 * player whose answer falls in the SAME bucket as theirs. Scores are cumulative
 * across 5 rounds.
 *
 * Server-authoritative anti-cheat: a player's answer is PRIVATE until reveal —
 * getStateForPlayer never exposes any other player's answer (or the buckets)
 * before the round's reveal. Mid-phase only aggregate submitted counts leak;
 * who wrote what is never disclosed until reveal.
 */
export class GroupMind extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'writing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'writing' },
        writing: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'writing', finish: 'finished' },
      },
    });
    this.scores = {};
    this.matchCounts = {};
    this.roundIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.categories = pickGroupCategories(TOTAL_ROUNDS);
    this.category = '';
    this.answers = {};     // playerId -> raw answer text (this round)
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = null;
    this._writeTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.scores[p] = 0; this.matchCounts[p] = 0; }
    this.transition('start'); // -> onEnterWriting
  }

  // ---------- WRITING ----------
  onEnterWriting() {
    this.roundIndex++;
    this.category = this.categories[this.roundIndex % this.categories.length];
    this.answers = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + WRITE_MS;
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      // Players who never answered count as a blank (matches no one).
      for (const p of this.players) if (this.answers[p] === undefined) this.answers[p] = '';
      this._toReveal();
      this._emitChange();
    }, WRITE_MS);
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'writing') return;
    this._clearAllTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  onEnterReveal() {
    // Bucket every present player's normalised answer. Blank/empty answers each
    // get their own unique bucket so they never match each other (or anyone).
    const buckets = {}; // normKey -> [playerId]
    let blankSeq = 0;
    for (const p of this.players) {
      const raw = this.answers[p] != null ? this.answers[p] : '';
      const norm = normalizeGuess(raw);
      const key = norm ? `=${norm}` : `__blank_${blankSeq++}`;
      (buckets[key] = buckets[key] || []).push(p);
    }
    const awards = {};
    for (const p of this.players) {
      const raw = this.answers[p] != null ? this.answers[p] : '';
      const norm = normalizeGuess(raw);
      const key = norm ? `=${norm}` : null;
      const groupSize = key ? buckets[key].length : 1;
      const matched = Math.max(0, groupSize - 1); // other players in my bucket
      const gained = POINTS_PER_MATCH * matched;
      this.scores[p] = (this.scores[p] || 0) + gained;
      this.matchCounts[p] = (this.matchCounts[p] || 0) + matched;
      awards[p] = { matched, gained };
    }
    // Build the public reveal groups (only at reveal — never before).
    const groups = Object.entries(buckets).map(([key, members]) => {
      const sample = this.answers[members[0]] != null ? this.answers[members[0]] : '';
      const isBlank = key.startsWith('__blank_');
      return {
        label: isBlank ? '(no answer)' : String(sample).trim(),
        normalized: isBlank ? '' : key.slice(1),
        members: [...members],
        matchCount: members.length,
        points: isBlank ? 0 : POINTS_PER_MATCH * Math.max(0, members.length - 1),
      };
    }).sort((a, b) => b.matchCount - a.matchCount);

    this.revealData = {
      category: this.category,
      answers: this.players.map((p) => ({ playerId: p, text: this.answers[p] != null ? this.answers[p] : '' })),
      groups,
      awards,
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearAllTimers();
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterWriting
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'writing' && type === 'submitAnswer') {
      if (this.answers[playerId] !== undefined) return; // locked after first submit
      const t = String(action.text || '').trim().slice(0, 40);
      if (!t) return;
      this.answers[playerId] = t;
      this._checkWriteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkWriteComplete() {
    if (this.state !== 'writing') return;
    if (this.players.every((p) => this.answers[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearAllTimers() {
    for (const k of ['_writeTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    delete this.answers[playerId]; // stop scoring them; they leave no answer behind

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'writing') this._checkWriteComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    return {
      phase: this.state,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      category: this.category,
      scores: { ...this.scores },
      myId: playerId,
      // Only MY own answer is ever echoed back during writing — never anyone else's.
      myAnswer: this.answers[playerId] != null ? this.answers[playerId] : null,
      hasSubmitted: this.answers[playerId] !== undefined,
      submittedCount: Object.keys(this.answers).length,
      playerCount: this.players.length,
      deadline: (this.state === 'writing' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: (this.state === 'reveal' || this.state === 'finished') ? this.revealData : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        matchCount: this.matchCounts[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
