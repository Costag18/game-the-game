import { BaseGame } from './BaseGame.js';
import { pickTrophies, shuffle } from '../utils/partyBank.js';

const POINTS_PER_VOTE = 500;
const TOTAL_ROUNDS = 4;
const WRITE_MS = 35_000;
const VOTE_MS = 25_000;
const REVEAL_MS = 12_000;

const HOUSE_REASONS = [
  'I simply have no shame.',
  'Honestly, it was an accident, but I will take the credit.',
  'My therapist said I should embrace it.',
  'I have been training for this my whole life.',
  'Nobody else even tried, so by default it is me.',
  'I peaked in this exact moment and I am at peace with it.',
  'It runs in the family, apparently.',
  'I would like to thank gravity for making this possible.',
];

/**
 * Awkward Award — a write-and-vote party game. Each round a silly TROPHY is
 * announced and every player writes a short ACCEPTANCE REASON ("why I deserve
 * this"). The reasons are then shuffled onto SERVER-RANDOM nominees (a card is a
 * nominee + a reason, NOT necessarily the reason's author), and everyone votes
 * for the best trophy+reason combo. The reason's AUTHOR scores +500 per vote it
 * received.
 *
 * Server-authoritative anti-cheat (mirrors Fibbage):
 *  - During voting the ballot carries NO authorId — players can't tell who wrote
 *    which reason. Reason text is shown but authorship is hidden.
 *  - A player may NOT vote for a card showing their OWN reason (server rejects).
 *  - Vote tallies are hidden until reveal. Who-submitted / who-voted is never
 *    leaked mid-phase — only aggregate counts. Authors + voters are disclosed
 *    only at reveal.
 */
export class AwkwardAward extends BaseGame {
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
    this.voteCounts = {}; // cumulative votes earned across the whole game
    this.roundIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.trophies = pickTrophies(TOTAL_ROUNDS);
    this.trophy = null;
    this.reasons = {}; // playerId -> reason text
    this.votes = {}; // voterId -> optionId
    this.ballot = []; // [{ optionId, nomineeId, authorId, text }]
    this.revealData = null;
    this.acknowledged = new Set();
    this._writeTimer = null;
    this._voteTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  _deadline(ms) { return Date.now() + ms; }

  startGame() {
    for (const p of this.players) { this.scores[p] = 0; this.voteCounts[p] = 0; }
    this.transition('start'); // -> onEnterWriting
  }

  // ---------- WRITING ----------
  onEnterWriting() {
    this.roundIndex++;
    this.trophy = this.trophies[this.roundIndex % this.trophies.length];
    this.reasons = {};
    this.votes = {};
    this.ballot = [];
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.writeDeadline = this._deadline(WRITE_MS);
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      let hi = 0;
      for (const p of this.players) {
        if (this.reasons[p] === undefined) {
          this.reasons[p] = HOUSE_REASONS[hi % HOUSE_REASONS.length];
          hi++;
        }
      }
      this._toVoting();
      this._emitChange();
    }, WRITE_MS);
  }

  // ---------- VOTING ----------
  _toVoting() {
    if (this.state !== 'writing') return;
    this._clearAllTimers();
    this.transition('vote'); // -> onEnterVoting
  }
  onEnterVoting() {
    // Shuffle reasons onto RANDOM nominees. Each present player is a nominee
    // exactly once; the reason placed on them is some player's reason (kept
    // anonymous via a derangement-ish shuffle — never showing the author's name
    // alongside, since the ballot carries no authorId at all).
    const authorIds = Object.keys(this.reasons);
    const reasonTexts = shuffle(authorIds.map((aid) => ({ authorId: aid, text: this.reasons[aid] })));
    const nominees = shuffle([...this.players]);
    const cards = [];
    const count = Math.min(nominees.length, reasonTexts.length);
    for (let i = 0; i < count; i++) {
      cards.push({
        nomineeId: nominees[i],
        authorId: reasonTexts[i].authorId,
        text: reasonTexts[i].text,
      });
    }
    this.ballot = shuffle(cards).map((c, i) => ({ optionId: `opt_${i}`, ...c }));
    this.votes = {};
    this._clearAllTimers();
    this.voteDeadline = this._deadline(VOTE_MS);
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
    let topVotes = -1;
    let winnerOptionId = null;
    for (const o of this.ballot) {
      const voters = votersByOption[o.optionId] || [];
      const got = voters.length;
      // the AUTHOR of the reason scores, regardless of which nominee it landed on
      if (this.players.includes(o.authorId)) {
        this.scores[o.authorId] = (this.scores[o.authorId] || 0) + got * POINTS_PER_VOTE;
        this.voteCounts[o.authorId] = (this.voteCounts[o.authorId] || 0) + got;
        awards[o.authorId] = (awards[o.authorId] || 0) + got * POINTS_PER_VOTE;
      }
      if (got > topVotes) { topVotes = got; winnerOptionId = o.optionId; }
    }
    this.revealData = {
      options: this.ballot.map((o) => ({
        optionId: o.optionId,
        nomineeId: o.nomineeId,
        authorId: o.authorId,
        text: o.text,
        voters: votersByOption[o.optionId] || [],
        votes: (votersByOption[o.optionId] || []).length,
      })),
      winnerOptionId,
      awards,
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.revealDeadline = this._deadline(REVEAL_MS);
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
    if (this.state === 'writing' && type === 'submitReason') {
      if (this.reasons[playerId] !== undefined) return;
      const t = String(action.text || '').trim().slice(0, 140);
      if (!t) return;
      this.reasons[playerId] = t;
      this._checkWriteComplete();
    } else if (this.state === 'voting' && type === 'castVote') {
      if (this.votes[playerId] !== undefined) return;
      const opt = this.ballot.find((o) => o.optionId === action.optionId);
      if (!opt) return;
      if (opt.authorId === playerId) return; // can't vote your own reason
      this.votes[playerId] = action.optionId;
      this._checkVoteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkWriteComplete() {
    if (this.state !== 'writing') return;
    if (this.players.every((p) => this.reasons[p] !== undefined)) this._toVoting();
  }
  _checkVoteComplete() {
    if (this.state !== 'voting') return;
    // everyone who still has at least one card they may vote for must have voted
    if (this.players.every((p) => this.votes[p] !== undefined || !this._canVote(p))) this._toReveal();
  }
  _canVote(p) { return this.ballot.some((o) => o.authorId !== p); }
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
    // keep the leaver's reason anonymous on the ballot; they simply stop scoring

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
      trophy: this.trophy,
      scores: { ...this.scores },
      myId: playerId,
      myReason: this.reasons[playerId] != null ? this.reasons[playerId] : null,
      hasSubmitted: this.reasons[playerId] !== undefined,
      submittedCount: Object.keys(this.reasons).length,
      playerCount: this.players.length,
      deadline:
        this.state === 'writing' ? this.writeDeadline
          : this.state === 'voting' ? this.voteDeadline
            : this.state === 'reveal' ? this.revealDeadline
              : null,
      ballot: this.state === 'voting'
        ? this.ballot.map((o) => ({
          optionId: o.optionId,
          nomineeId: o.nomineeId,
          text: o.text,
          isMine: o.authorId === playerId, // my OWN reason — can't vote it
        }))
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
        voteCount: this.voteCounts[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
