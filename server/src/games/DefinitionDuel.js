import { BaseGame } from './BaseGame.js';
import { pickDefinitionWords, shuffle } from '../utils/partyBank.js';
import { normalizeGuess } from '../utils/guessMatch.js';

const POINTS_TRUTH = 1000; // picking the real definition
const POINTS_FOOL = 500; // every player your fake fools
const TOTAL_ROUNDS = 4;
const WRITE_MS = 40_000; // write a fake definition
const VOTE_MS = 30_000; // vote for the truth
const REVEAL_MS = 12_000; // reveal acknowledge auto-advance

// House definitions used to fill in a player who didn't submit a fake before the
// write timer expired (kept generic + plausible-but-wrong, deduped against the
// real definition and other fakes).
const HOUSE_FAKES = [
  'a small ornamental knot used to fasten a cloak',
  'an old-fashioned tool for measuring rainfall',
  'a sudden feeling of unexplained dread',
  'the quiet hum of a crowd before a performance',
  'a type of knot favoured by sailors',
  'a ceremonial dance performed at harvest time',
  'a faint shimmer seen on the horizon at dusk',
  'a word used to call livestock home in the evening',
  'an obsolete unit for measuring distance at sea',
  'the curved part of a staircase banister',
  'a brief lapse of memory while speaking',
  'a decorative fold pressed into a paper fan',
  'a low whistle used to signal a hidden dog',
  'a superstition about leaving doors ajar at night',
  'a regional term for the last sheaf of a crop',
  'the practice of naming a boat after a relative',
];

/**
 * Definition Duel — Balderdash. Each round shows a real obscure WORD only; every
 * player writes a fake-but-plausible definition. The REAL definition is shuffled
 * in with the fakes and shown WITHOUT authorship; players vote for the one they
 * think is true. Server-authoritative anti-cheat: the real definition is never
 * sent to clients before reveal; the voting ballot carries NO authorId and NO
 * kind (truth and fakes are indistinguishable); a player cannot vote for their
 * own fake; fakes are validated server-side (rejected if they equal the real
 * definition or duplicate another player's fake). Who-submitted / who-voted is
 * never leaked mid-phase — only aggregate counts.
 *
 * Scoring (Fibbage-shape): +1000 for picking the TRUE definition; +500 for every
 * player your fake fools.
 */
export class DefinitionDuel extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'writing', 'voting', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'writing' },
        writing: { vote: 'voting', finish: 'finished' },
        voting: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'writing', finish: 'finished' },
      },
    });
    this.scores = {};
    this.foolCounts = {};
    this.foundTruthCounts = {};
    this.roundIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.words = pickDefinitionWords(TOTAL_ROUNDS); // pick ONCE for the whole game
    this.word = null; // { word, definition } for the current round
    this.fakes = {};
    this.votes = {};
    this.ballot = [];
    this.revealData = null;
    this.acknowledged = new Set();
    this._writeTimer = null;
    this._voteTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.scores[p] = 0; this.foolCounts[p] = 0; this.foundTruthCounts[p] = 0; }
    this.transition('start'); // -> onEnterWriting
  }

  // ---------- WRITING ----------
  onEnterWriting() {
    this.roundIndex++;
    this.word = this.words[this.roundIndex % this.words.length];
    this.fakes = {};
    this.votes = {};
    this.ballot = [];
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this._deadline = Date.now() + WRITE_MS;
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      const used = new Set(Object.values(this.fakes).map((f) => normalizeGuess(f)));
      for (const p of this.players) {
        if (this.fakes[p] === undefined) {
          const hf = HOUSE_FAKES.find((h) => !this._matchesTruth(h) && !used.has(normalizeGuess(h)))
            || `a little-known thing #${p.slice(0, 3)}`;
          used.add(normalizeGuess(hf));
          this.fakes[p] = hf;
        }
      }
      this._toVoting();
      this._emitChange();
    }, WRITE_MS);
  }

  _matchesTruth(t) {
    return normalizeGuess(t) === normalizeGuess(this.word.definition);
  }
  _duplicateFake(t, pid) {
    const n = normalizeGuess(t);
    return Object.entries(this.fakes).some(([p, f]) => p !== pid && normalizeGuess(f) === n);
  }

  // ---------- VOTING ----------
  _toVoting() {
    if (this.state !== 'writing') return;
    this._clearAllTimers();
    this.transition('vote'); // -> onEnterVoting
  }
  onEnterVoting() {
    const opts = Object.entries(this.fakes).map(([authorId, text]) => ({ text, kind: 'fake', authorId }));
    opts.push({ text: this.word.definition, kind: 'truth', authorId: null });
    this.ballot = shuffle(opts).map((o, i) => ({ optionId: `opt_${i}`, ...o }));
    this.votes = {};
    this._clearAllTimers();
    this._deadline = Date.now() + VOTE_MS;
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'voting') return;
      for (const p of this.players) if (this.votes[p] === undefined) this._autoVote(p);
      this._toReveal();
      this._emitChange();
    }, VOTE_MS);
  }
  _autoVote(p) {
    const choices = this.ballot.filter((o) => !(o.kind === 'fake' && o.authorId === p));
    if (choices.length) this.votes[p] = choices[Math.floor(Math.random() * choices.length)].optionId;
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'voting') return;
    this._clearAllTimers();
    this.transition('reveal'); // -> onEnterReveal
  }
  onEnterReveal() {
    const votersByOption = {};
    for (const [p, oid] of Object.entries(this.votes)) (votersByOption[oid] = votersByOption[oid] || []).push(p);
    const truthOpt = this.ballot.find((o) => o.kind === 'truth');
    const truthOptionId = truthOpt ? truthOpt.optionId : null;
    const awards = {};
    for (const p of this.players) {
      let gained = 0;
      let found = false;
      if (this.votes[p] === truthOptionId) { gained += POINTS_TRUTH; found = true; this.foundTruthCounts[p] = (this.foundTruthCounts[p] || 0) + 1; }
      const mine = this.ballot.find((o) => o.kind === 'fake' && o.authorId === p);
      const fooled = mine ? (votersByOption[mine.optionId] || []).length : 0;
      gained += POINTS_FOOL * fooled;
      this.foolCounts[p] = (this.foolCounts[p] || 0) + fooled;
      this.scores[p] = (this.scores[p] || 0) + gained;
      awards[p] = { found, fooled, gained };
    }
    this.revealData = {
      word: this.word.word,
      options: this.ballot.map((o) => ({ optionId: o.optionId, text: o.text, kind: o.kind, authorId: o.authorId, voters: votersByOption[o.optionId] || [] })),
      truthOptionId,
      awards,
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
    this._deadline = Date.now() + REVEAL_MS;
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
    if (this.state === 'writing' && type === 'submitFake') {
      if (this.fakes[playerId] !== undefined) return;
      const t = String(action.text || '').trim().slice(0, 140);
      if (!t) return;
      if (this._matchesTruth(t)) return;
      if (this._duplicateFake(t, playerId)) return;
      this.fakes[playerId] = t;
      this._checkWriteComplete();
    } else if (this.state === 'voting' && type === 'castVote') {
      if (this.votes[playerId] !== undefined) return;
      const opt = this.ballot.find((o) => o.optionId === action.optionId);
      if (!opt) return;
      if (opt.kind === 'fake' && opt.authorId === playerId) return;
      this.votes[playerId] = action.optionId;
      this._checkVoteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkWriteComplete() {
    if (this.state !== 'writing') return;
    if (this.players.every((p) => this.fakes[p] !== undefined)) this._toVoting();
  }
  _checkVoteComplete() {
    if (this.state !== 'voting') return;
    if (this.players.every((p) => this.votes[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearAllTimers() {
    for (const k of ['_writeTimer', '_voteTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    // keep fakes[leaver] anonymous on the ballot; they simply stop scoring

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'writing') this._checkWriteComplete();
    else if (this.state === 'voting') this._checkVoteComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    return {
      phase: this.state,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      word: this.word ? this.word.word : '',
      deadline: this._deadline || null,
      scores: { ...this.scores },
      myId: playerId,
      myFake: this.fakes[playerId] != null ? this.fakes[playerId] : null,
      hasSubmitted: this.fakes[playerId] !== undefined,
      submittedCount: Object.keys(this.fakes).length,
      playerCount: this.players.length,
      ballot: this.state === 'voting'
        ? this.ballot.map((o) => ({ optionId: o.optionId, text: o.text, isMine: o.authorId === playerId }))
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
        foolCount: this.foolCounts[playerId] || 0,
        foundTruthCount: this.foundTruthCounts[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
