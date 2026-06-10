import { BaseGame } from './BaseGame.js';
import { pickQuips, shuffle } from '../utils/partyBank.js';

const WRITE_MS = 45_000;   // window to answer all of your assigned prompts
const VOTE_MS = 15_000;    // window to vote on the current duel
const REVEAL_MS = 12_000;  // reveal auto-advance (authors + duel points)
const DUEL_POINTS = 1000;  // split between the two answers by vote share

/**
 * Quiplash Clash — a head-to-head comedy write-off. We pick ~N fill-in-the-blank
 * prompts and assign each one to EXACTLY TWO players (a duel), via a balanced
 * schedule so everyone writes a fair number of lines. In the WRITING phase every
 * player answers their assigned prompt(s). Then we walk the duels one at a time:
 * for each duel the two anonymous answers are shown side by side and EVERYONE
 * EXCEPT the two authors votes which is funnier. Each duel awards DUEL_POINTS by
 * vote share (a blowout scores more for the winner: 1000 * votesForYou / total).
 * Players accumulate points across all their duels; getResults ranks by total.
 *
 * Anti-cheat (server-authoritative): during voting the two answers carry NO
 * authorId and NO side label tied to identity — a voter can't tell whose answer
 * is whose; an author can't vote in their own duel (server rejects); and tallies
 * stay hidden until reveal. Who-submitted / who-voted is never leaked mid-phase —
 * only aggregate counts. State advances are timer-driven, so every timer callback
 * pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class QuiplashClash extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'writing', 'voting', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'writing' },
        writing: { vote: 'voting', finish: 'finished' },
        voting: { reveal: 'reveal', finish: 'finished' },
        reveal: { finish: 'finished' }, // single reveal at the end of the game
      },
    });
    this.scores = {};
    this.duels = [];            // [{ id, prompt, authors:[p1,p2], answers:{pid:text} }]
    this.answers = {};          // pid -> { duelId -> text } pending writing submissions
    this.assignments = {};      // pid -> [duelId, ...] prompts this player must answer
    this.votes = {};            // duelId -> { voterId -> authorId they voted for }
    this.voteIndex = -1;        // index into this.duels currently being voted
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = null;       // epoch-ms for the active phase timer
    this._writeTimer = null;
    this._voteTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this._buildSchedule();
    this.transition('start'); // -> onEnterWriting
  }

  // Build ~N duels, each a unique pair of players, distributing prompts as evenly
  // as possible (target ~2 duels per player). Pairs are chosen greedily by lowest
  // current load so nobody is overloaded; prompts are drawn once for the game.
  _buildSchedule() {
    const n = this.players.length;
    const numDuels = Math.max(n, 1); // ~one prompt per player → ~2 duels each
    const prompts = pickQuips(numDuels);
    const load = {};
    for (const p of this.players) { load[p] = 0; this.assignments[p] = []; this.answers[p] = {}; }
    const used = new Set(); // pair keys already used, to avoid duplicate matchups
    const pairKey = (a, b) => [a, b].sort().join('|');

    for (let i = 0; i < numDuels; i++) {
      // first author: least-loaded player
      const byLoad = () => shuffle(this.players).sort((a, b) => load[a] - load[b]);
      const order = byLoad();
      const p1 = order[0];
      // second author: least-loaded OTHER player making a not-yet-used pair if possible
      let p2 = null;
      for (const cand of order) {
        if (cand === p1) continue;
        if (!used.has(pairKey(p1, cand))) { p2 = cand; break; }
      }
      if (!p2) { // all pairs with p1 used → just take the least-loaded other player
        p2 = order.find((c) => c !== p1) || p1;
      }
      used.add(pairKey(p1, p2));
      load[p1]++; load[p2]++;
      const duelId = `duel_${i}`;
      this.duels.push({ id: duelId, prompt: prompts[i % prompts.length], authors: [p1, p2], answers: {} });
      this.assignments[p1].push(duelId);
      this.assignments[p2].push(duelId);
      this.votes[duelId] = {};
    }
  }

  // ---------- WRITING ----------
  onEnterWriting() {
    this.acknowledged = new Set();
    this.revealData = null;
    this._clearAllTimers();
    this.deadline = Date.now() + WRITE_MS;
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      this._fillBlankAnswers();
      this._toVoting();
      this._emitChange();
    }, WRITE_MS);
  }

  // A player owes an answer for a duel if they're an author and haven't written one.
  _owedDuels(pid) {
    return (this.assignments[pid] || []).filter((d) => this.answers[pid][d] === undefined);
  }
  _writeComplete() {
    return this.players.every((p) => this._owedDuels(p).length === 0);
  }
  _checkWriteComplete() {
    if (this.state !== 'writing') return;
    if (this._writeComplete()) this._toVoting();
  }
  // On timeout, missing answers become a harmless blank placeholder so the duel
  // still has two sides to vote on.
  _fillBlankAnswers() {
    for (const p of this.players) {
      for (const d of this._owedDuels(p)) this.answers[p][d] = '(no answer)';
    }
  }

  // Move pending writing answers onto the duels, dropping duels that lost an author.
  _toVoting() {
    if (this.state !== 'writing') return;
    for (const duel of this.duels) {
      duel.answers = {};
      for (const a of duel.authors) {
        if (this.answers[a] && this.answers[a][duel.id] !== undefined) duel.answers[a] = this.answers[a][duel.id];
      }
    }
    // Only duels with BOTH authors still present + answered are votable.
    this.duels = this.duels.filter((d) => d.authors.every((a) => this.players.includes(a)) && Object.keys(d.answers).length === 2);
    this._clearAllTimers();
    if (this.duels.length === 0) { this.transition('finish'); return; }
    this.transition('vote'); // -> onEnterVoting
  }

  // ---------- VOTING ----------
  onEnterVoting() {
    this.voteIndex = -1;
    this._nextDuel();
  }
  get currentDuel() {
    return this.voteIndex >= 0 && this.voteIndex < this.duels.length ? this.duels[this.voteIndex] : null;
  }
  // Build the anonymous, shuffled two-option ballot for the current duel. `side`
  // is a stable per-duel label (left/right) decoupled from author identity.
  get currentBallot() {
    const d = this.currentDuel;
    if (!d) return [];
    const order = d._order || (d._order = shuffle([...d.authors]));
    return order.map((authorId, i) => ({ side: i === 0 ? 'left' : 'right', optionId: authorId, text: d.answers[authorId] }));
  }
  _nextDuel() {
    this.voteIndex++;
    if (this.voteIndex >= this.duels.length) { this._toReveal(); return; }
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + VOTE_MS;
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'voting') return;
      this._nextDuel();
      this._emitChange();
    }, VOTE_MS);
  }
  // Eligible voters for a duel = everyone present who is NOT one of its two authors.
  _voters(duel) {
    return this.players.filter((p) => !duel.authors.includes(p));
  }
  _checkVoteComplete() {
    if (this.state !== 'voting') return;
    const d = this.currentDuel;
    if (!d) return;
    const eligible = this._voters(d);
    const tally = this.votes[d.id];
    if (eligible.every((v) => tally[v] !== undefined)) this._nextDuel();
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'voting') return;
    this._clearAllTimers();
    this.transition('reveal'); // -> onEnterReveal
  }
  onEnterReveal() {
    const duelResults = [];
    for (const d of this.duels) {
      const tally = this.votes[d.id] || {};
      const counts = {};
      for (const a of d.authors) counts[a] = 0;
      for (const authorId of Object.values(tally)) if (counts[authorId] !== undefined) counts[authorId]++;
      const total = d.authors.reduce((s, a) => s + counts[a], 0);
      const awards = {};
      for (const a of d.authors) {
        const share = total > 0 ? counts[a] / total : 0.5; // no votes → split evenly
        const gained = Math.round(DUEL_POINTS * share);
        awards[a] = gained;
        this.scores[a] = (this.scores[a] || 0) + gained;
      }
      const winner = counts[d.authors[0]] === counts[d.authors[1]]
        ? null
        : (counts[d.authors[0]] > counts[d.authors[1]] ? d.authors[0] : d.authors[1]);
      duelResults.push({
        id: d.id,
        prompt: d.prompt,
        total,
        answers: d.authors.map((a) => ({ authorId: a, text: d.answers[a], votes: counts[a], gained: awards[a] })),
        winner,
      });
    }
    this.revealData = { duels: duelResults };
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._finish();
      this._emitChange();
    }, REVEAL_MS);
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._finish();
  }
  _finish() {
    if (this.state !== 'reveal') return;
    this._clearAllTimers();
    this.deadline = null;
    this.transition('finish');
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'writing' && type === 'submitAnswer') {
      const duelId = action.duelId;
      if (!(this.assignments[playerId] || []).includes(duelId)) return; // not yours
      if (this.answers[playerId][duelId] !== undefined) return; // one answer per prompt
      const t = String(action.text || '').trim().slice(0, 120);
      if (!t) return;
      this.answers[playerId][duelId] = t;
      this._checkWriteComplete();
    } else if (this.state === 'voting' && type === 'castVote') {
      const d = this.currentDuel;
      if (!d) return;
      if (d.authors.includes(playerId)) return; // can't vote your own duel
      if (this.votes[d.id][playerId] !== undefined) return; // one vote per duel
      if (!d.authors.includes(action.optionId)) return; // must pick a real answer
      this.votes[d.id][playerId] = action.optionId;
      this._checkVoteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearAllTimers() {
    for (const k of ['_writeTimer', '_voteTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    delete this.scores[playerId];
    // strip the leaver from every pending vote tally so barriers don't wait on them
    for (const did of Object.keys(this.votes)) delete this.votes[did][playerId];

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.deadline = null;
      this.state = 'finished';
      this._emitChange();
      return;
    }

    if (this.state === 'writing') {
      // A leaver's duels lose an author and become unvotable; their owed answers
      // simply never matter. Re-check the barrier for the remaining writers.
      this._checkWriteComplete();
    } else if (this.state === 'voting') {
      const d = this.currentDuel;
      // If the leaver was an author of the live duel, it can't be judged fairly —
      // skip to the next duel. Otherwise just re-check the (now smaller) barrier.
      if (d && d.authors.includes(playerId)) { this._nextDuel(); this._emitChange(); return; }
      this._checkVoteComplete();
    } else if (this.state === 'reveal') {
      this._checkRevealComplete();
    }
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    let myPrompts = null;
    if (this.state === 'writing') {
      myPrompts = (this.assignments[playerId] || []).map((duelId) => {
        const d = this.duels.find((x) => x.id === duelId);
        return {
          duelId,
          prompt: d ? d.prompt : '',
          myAnswer: this.answers[playerId] && this.answers[playerId][duelId] !== undefined ? this.answers[playerId][duelId] : null,
        };
      });
    }

    let duel = null;
    if (this.state === 'voting') {
      const d = this.currentDuel;
      if (d) {
        const iAmAuthor = d.authors.includes(playerId);
        const tally = this.votes[d.id] || {};
        const eligible = this._voters(d);
        duel = {
          index: this.voteIndex + 1,
          total: this.duels.length,
          prompt: d.prompt,
          // Anonymous side-by-side answers — no authorId, no identity-linked label.
          options: this.currentBallot.map((o) => ({ side: o.side, optionId: o.optionId, text: o.text })),
          iAmAuthor,                       // authors watch, they can't vote
          myVote: tally[playerId] != null ? tally[playerId] : null,
          votedCount: eligible.filter((v) => tally[v] !== undefined).length,
          voterCount: eligible.length,
        };
      }
    }

    return {
      phase: this.state,
      myId: playerId,
      scores: { ...this.scores },
      playerCount: this.players.length,
      myPrompts,
      submittedCount: this.state === 'writing'
        ? this.players.filter((p) => this._owedDuels(p).length === 0).length
        : 0,
      duel,
      deadline: (this.state === 'writing' || this.state === 'voting' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      // The secret (who wrote what / vote tallies) is exposed ONLY at reveal.
      reveal: revealing ? this.revealData : null,
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
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
