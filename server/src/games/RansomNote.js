import { BaseGame } from './BaseGame.js';
import { pickWord } from '../utils/wordBank.js';
import { normalizeGuess } from '../utils/guessMatch.js';

const TOTAL_ROUNDS = 3;
const HAND_SIZE = 12;
const MIN_NOTE = 3;
const MAX_NOTE = 5;

const WRITE_MS = 45_000;
const VOTE_MS = 30_000;
const REVEAL_MS = 50_000; // long AFK-safety net — players advance via Continue/ack

// Fixed server emoji pool. Players are dealt a random HAND of HAND_SIZE from this
// and arrange MIN_NOTE..MAX_NOTE of them into a "ransom note" conveying the word.
const EMOJI_POOL = [
  '😀', '😂', '😍', '😎', '😭', '😡', '🤔', '😱', '🥶', '🤯', '😴', '🤢',
  '👍', '👎', '👀', '🙌', '👊', '🙏', '💪', '🖐️', '✌️', '🤞', '👋', '🫶',
  '❤️', '🔥', '💧', '⚡', '🌈', '⭐', '🌙', '☀️', '☁️', '❄️', '💀', '💣',
  '🐶', '🐱', '🐸', '🐵', '🦁', '🐠', '🐝', '🦄', '🐧', '🦋', '🐍', '🐢',
  '🍕', '🍎', '🍌', '🍔', '🍩', '🥑', '🌮', '🍦', '🥕', '🧀', '🍪', '🥚',
  '🚗', '✈️', '🚀', '🚲', '⛵', '🏠', '🏰', '🗼', '🌋', '🏝️', '⛰️', '🌉',
  '⚽', '🏀', '🎸', '🎲', '🎯', '🎤', '🎨', '📷', '🔑', '💡', '⏰', '📚',
  '💰', '💎', '👑', '🎁', '🔔', '⚓', '🧭', '🔫', '🛡️', '🪓', '⚔️', '🧨',
  '👻', '🤖', '👽', '🧙', '🦸', '🤡', '🎃', '☠️', '🧠', '👁️', '🦴', '🩸',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Ransom Note — convey a secret word using EMOJI only (no drawing canvas). Each
 * round a secret word is drawn (pickWord); every player is dealt a private random
 * HAND of emoji and arranges MIN_NOTE..MAX_NOTE of them into a "ransom note" that
 * conveys the word WITHOUT writing it. Then all notes are shown anonymously
 * alongside the revealed word and everyone votes the cleverest (can't vote own).
 * Score = votes received, cumulative across ~3 rounds, ranked DESC, ties shared.
 *
 * Anti-cheat: each player's hand AND note are private until reveal (getStateForPlayer
 * only ever sends a player their OWN hand/note during draw); the secret word is
 * shown only at reveal/vote; the voting gallery is anonymous (no authorId leaked);
 * you cannot vote your own note; per-vote tallies hidden until reveal.
 */
export class RansomNote extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'draw', 'vote', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'draw' },
        draw: { vote: 'vote', finish: 'finished' },
        vote: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'draw', finish: 'finished' },
      },
    });
    this.scores = {};
    this.roundIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.word = null;
    this.usedWords = [];
    this.hands = {};        // pid -> [emoji]
    this.notes = {};        // pid -> [emoji] submitted
    this.votes = {};        // pid -> gallery entryId voted for
    this.gallery = [];      // [{ entryId, authorId, emojis }]
    this.revealData = null;
    this.acknowledged = new Set();
    this._drawStart = 0; // ms timestamp the current draw phase began (for client countdown)
    this._drawTimer = null;
    this._voteTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterDraw
  }

  // ---------- DRAW (compose the ransom note) ----------
  onEnterDraw() {
    this.roundIndex++;
    const picked = pickWord({ exclude: this.usedWords });
    this.word = picked ? picked.word : 'mystery';
    this.usedWords.push(this.word);
    this.hands = {};
    this.notes = {};
    this.votes = {};
    this.gallery = [];
    this.revealData = null;
    this.acknowledged = new Set();
    for (const p of this.players) this.hands[p] = shuffle(EMOJI_POOL).slice(0, HAND_SIZE);
    this._clearAllTimers();
    this._drawStart = Date.now();
    this._drawTimer = setTimeout(() => {
      if (this.state !== 'draw') return;
      for (const p of this.players) {
        if (this.notes[p] === undefined) this.notes[p] = this._autoNote(p);
      }
      this._toVote();
      this._emitChange();
    }, WRITE_MS);
  }

  // Auto-pick the first MIN_NOTE emoji from a player's hand for non-submitters.
  _autoNote(pid) {
    const hand = this.hands[pid] || [];
    return hand.slice(0, MIN_NOTE);
  }

  // Validate a submitted note: all emoji must come from the player's hand (counting
  // multiplicity), length MIN_NOTE..MAX_NOTE, and no raw word text smuggled in.
  _validateNote(pid, emojis) {
    if (!Array.isArray(emojis)) return null;
    if (emojis.length < MIN_NOTE || emojis.length > MAX_NOTE) return null;
    const w = normalizeGuess(this.word);
    const pool = [...(this.hands[pid] || [])];
    const out = [];
    for (const e of emojis) {
      if (typeof e !== 'string') return null;
      // reject the literal word as text smuggled in instead of an emoji
      if (w && normalizeGuess(e) === w) return null;
      const idx = pool.indexOf(e);
      if (idx === -1) return null; // not in hand (or already consumed)
      pool.splice(idx, 1);
      out.push(e);
    }
    return out;
  }

  _toVote() {
    if (this.state !== 'draw') return;
    this._clearAllTimers();
    this.transition('vote'); // -> onEnterVote
  }

  // ---------- VOTE (anonymous gallery) ----------
  onEnterVote() {
    const entries = this.players.map((authorId) => ({ authorId, emojis: this.notes[authorId] || [] }));
    this.gallery = shuffle(entries).map((e, i) => ({ entryId: `note_${i}`, authorId: e.authorId, emojis: e.emojis }));
    this.votes = {};
    this._clearAllTimers();
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'vote') return;
      for (const p of this.players) if (this.votes[p] === undefined) this._autoVote(p);
      this._toReveal();
      this._emitChange();
    }, VOTE_MS);
  }

  _autoVote(p) {
    const choices = this.gallery.filter((e) => e.authorId !== p);
    if (choices.length) this.votes[p] = choices[Math.floor(Math.random() * choices.length)].entryId;
  }

  _toReveal() {
    if (this.state !== 'vote') return;
    this._clearAllTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL (word + authors + tallies) ----------
  onEnterReveal() {
    const votersByEntry = {};
    for (const [p, eid] of Object.entries(this.votes)) (votersByEntry[eid] = votersByEntry[eid] || []).push(p);
    const awards = {};
    for (const entry of this.gallery) {
      const got = (votersByEntry[entry.entryId] || []).length;
      // award votes to the author (author may have already left → skip scoring them)
      if (this.players.includes(entry.authorId)) {
        this.scores[entry.authorId] = (this.scores[entry.authorId] || 0) + got;
      }
      awards[entry.authorId] = (awards[entry.authorId] || 0) + got;
    }
    this.revealData = {
      word: this.word,
      entries: this.gallery.map((e) => ({
        entryId: e.entryId,
        authorId: e.authorId,
        emojis: e.emojis,
        votes: (votersByEntry[e.entryId] || []).length,
        voters: votersByEntry[e.entryId] || [],
      })),
      awards,
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
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
    else this.transition('next'); // -> onEnterDraw
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'draw' && (type === 'submit' || type === 'submitNote')) {
      if (this.notes[playerId] !== undefined) return;
      const note = this._validateNote(playerId, action.emojis);
      if (!note) return;
      this.notes[playerId] = note;
      this._checkDrawComplete();
    } else if (this.state === 'vote' && (type === 'vote' || type === 'castVote')) {
      if (this.votes[playerId] !== undefined) return;
      const entry = this.gallery.find((e) => e.entryId === action.entryId);
      if (!entry) return;
      if (entry.authorId === playerId) return; // can't vote your own note
      this.votes[playerId] = action.entryId;
      this._checkVoteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkDrawComplete() {
    if (this.state !== 'draw') return;
    if (this.players.every((p) => this.notes[p] !== undefined)) this._toVote();
  }
  _checkVoteComplete() {
    if (this.state !== 'vote') return;
    if (this.players.every((p) => this.votes[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearAllTimers() {
    for (const k of ['_drawTimer', '_voteTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    // keep the leaver's note anonymous in the gallery; they simply stop scoring

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'draw') this._checkDrawComplete();
    else if (this.state === 'vote') this._checkVoteComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const inVote = this.state === 'vote';
    return {
      phase: this.state,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      // The secret word: shown to the AUTHOR during draw (it's their own target),
      // and to everyone at vote/reveal. During draw a player sees only their word.
      word: (this.state === 'draw' || this.state === 'vote' || this.state === 'reveal' || this.state === 'finished')
        ? this.word : null,
      scores: { ...this.scores },
      myId: playerId,
      minNote: MIN_NOTE,
      maxNote: MAX_NOTE,
      // deadline for the compose phase — drives the client countdown + timeout auto-submit
      drawEndTime: this.state === 'draw' ? this._drawStart + WRITE_MS : null,
      // hand + my own note are PRIVATE — never another player's
      myHand: this.state === 'draw' ? (this.hands[playerId] || []) : null,
      myNote: this.notes[playerId] != null ? this.notes[playerId] : null,
      hasSubmitted: this.notes[playerId] !== undefined,
      submittedCount: Object.keys(this.notes).length,
      playerCount: this.players.length,
      // anonymous gallery during voting — NO authorId, just emoji notes
      gallery: inVote
        ? this.gallery.map((e) => ({ entryId: e.entryId, emojis: e.emojis, isMine: e.authorId === playerId }))
        : null,
      myVote: this.votes[playerId] != null ? this.votes[playerId] : null,
      votedCount: Object.keys(this.votes).length,
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
        handDescription: `${this.scores[playerId] || 0} votes`,
      };
    });
  }
}
