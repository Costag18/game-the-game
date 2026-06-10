import { BaseGame } from './BaseGame.js';
import { pickCaptions, shuffle } from '../utils/partyBank.js';
import { normalizeGuess } from '../utils/guessMatch.js';

const TOTAL_ROUNDS = 4;
const POINTS_PER_VOTE = 100;
const WRITE_MS = 40_000;   // window to write a one-line caption
const VOTE_MS = 25_000;    // window to vote for the funniest caption
const REVEAL_MS = 12_000;  // reveal auto-advance to next image / finish

const HOUSE_CAPTIONS = [
  'Just another Monday.',
  'This is fine.',
  'Nailed it.',
  'No thoughts, head empty.',
  'Living my best life.',
  'Why is nobody talking about this?',
  'I meant to do that.',
  'It is what it is.',
  'Send help.',
  'Vibes immaculate.',
  'Caught in 4K.',
  'Not all heroes wear capes.',
];

/**
 * Caption This — write-and-vote comedy. Over 4 AI-generated scenes, every player
 * writes a one-line caption, then everyone votes for the funniest caption that
 * ISN'T their own. Scoring: +100 per vote your caption receives, summed across
 * all four images.
 *
 * The engine NEVER fetches an image — it only holds the scene text as
 * `imagePrompt`; the CLIENT builds the Pollinations URL from it.
 *
 * Anti-cheat (server-authoritative): during voting the ballot carries NO authorId
 * (captions are anonymous — you can't tell whose is whose); a player may NOT vote
 * for their own caption (server rejects); votes and tallies are hidden until
 * reveal; who-submitted / who-voted is never leaked mid-phase — only aggregate
 * counts. Authors and vote counts are disclosed only at reveal. State advances are
 * timer-driven, so every timer callback pairs with `_emitChange()` (v2.7.0
 * broadcast contract).
 */
export class CaptionThis extends BaseGame {
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
    this.roundVotesWon = {};   // playerId -> total votes received across the game
    this.totalRounds = TOTAL_ROUNDS;
    this.scenes = [];
    this.roundIndex = -1;
    this.scene = null;         // current scene string (imagePrompt)
    this.captions = {};        // playerId -> caption text
    this.votes = {};           // playerId -> optionId
    this.ballot = [];          // [{ optionId, text, authorId }]
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = null;      // epoch-ms for the active phase timer (stable countdown)
    this._writeTimer = null;
    this._voteTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.scores[p] = 0; this.roundVotesWon[p] = 0; }
    this.scenes = pickCaptions(this.totalRounds);
    this.transition('start'); // -> onEnterWriting
  }

  // ---------- WRITING ----------
  onEnterWriting() {
    this.roundIndex++;
    this.scene = this.scenes[this.roundIndex % this.scenes.length];
    this.captions = {};
    this.votes = {};
    this.ballot = [];
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + WRITE_MS;
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      const used = new Set(Object.values(this.captions).map((c) => normalizeGuess(c)));
      for (const p of this.players) {
        if (this.captions[p] === undefined) {
          const hc = HOUSE_CAPTIONS.find((h) => !used.has(normalizeGuess(h))) || `…`;
          used.add(normalizeGuess(hc));
          this.captions[p] = hc;
        }
      }
      this._toVoting();
      this._emitChange();
    }, WRITE_MS);
  }

  _duplicateCaption(text, pid) {
    const norm = normalizeGuess(text);
    if (!norm) return false;
    return Object.entries(this.captions).some(([p, c]) => p !== pid && normalizeGuess(c) === norm);
  }

  // ---------- VOTING ----------
  _toVoting() {
    if (this.state !== 'writing') return;
    this._clearAllTimers();
    this.transition('vote'); // -> onEnterVoting
  }
  onEnterVoting() {
    const opts = Object.entries(this.captions).map(([authorId, text]) => ({ text, authorId }));
    this.ballot = shuffle(opts).map((o, i) => ({ optionId: `opt_${i}`, ...o }));
    this.votes = {};
    this._clearAllTimers();
    this.deadline = Date.now() + VOTE_MS;
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'voting') return;
      for (const p of this.players) if (this.votes[p] === undefined) this._autoVote(p);
      this._toReveal();
      this._emitChange();
    }, VOTE_MS);
  }
  _autoVote(p) {
    const choices = this.ballot.filter((o) => o.authorId !== p);
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
    const awards = {};
    for (const p of this.players) {
      const mine = this.ballot.find((o) => o.authorId === p);
      const votesGot = mine ? (votersByOption[mine.optionId] || []).length : 0;
      const gained = votesGot * POINTS_PER_VOTE;
      this.scores[p] = (this.scores[p] || 0) + gained;
      this.roundVotesWon[p] = (this.roundVotesWon[p] || 0) + votesGot;
      awards[p] = { votes: votesGot, gained };
    }
    this.revealData = {
      scene: this.scene,
      options: this.ballot.map((o) => ({
        optionId: o.optionId,
        text: o.text,
        authorId: o.authorId,
        voters: votersByOption[o.optionId] || [],
        votes: (votersByOption[o.optionId] || []).length,
      })).sort((a, b) => b.votes - a.votes),
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
    if (this.state === 'writing' && type === 'submitCaption') {
      if (this.captions[playerId] !== undefined) return;
      const t = String(action.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!t) return;
      if (this._duplicateCaption(t, playerId)) return;
      this.captions[playerId] = t;
      this._checkWriteComplete();
    } else if (this.state === 'voting' && type === 'castVote') {
      if (this.votes[playerId] !== undefined) return;
      const opt = this.ballot.find((o) => o.optionId === action.optionId);
      if (!opt) return;
      if (opt.authorId === playerId) return; // can't vote your own caption
      this.votes[playerId] = action.optionId;
      this._checkVoteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkWriteComplete() {
    if (this.state !== 'writing') return;
    if (this.players.every((p) => this.captions[p] !== undefined)) this._toVoting();
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
    delete this.votes[playerId];
    // keep captions[leaver] anonymous on the ballot; they simply stop scoring

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
      imagePrompt: this.scene || '',
      deadline: (this.state === 'writing' || this.state === 'voting' || this.state === 'reveal') ? this.deadline : null,
      scores: { ...this.scores },
      myId: playerId,
      myCaption: this.captions[playerId] != null ? this.captions[playerId] : null,
      hasSubmitted: this.captions[playerId] !== undefined,
      submittedCount: Object.keys(this.captions).length,
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
        votesWon: this.roundVotesWon[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
