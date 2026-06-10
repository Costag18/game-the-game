import { BaseGame } from './BaseGame.js';
import { pickOpinions } from '../utils/partyBank.js';

const POINTS_WIN = 500;
const TOTAL_ROUNDS = 5;
const PICK_MS = 25_000;
const REVEAL_MS = 10_000;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Mob Rule — read the room. Each round shows an opinion prompt with two fixed
 * sides (a/b) and an ANNOUNCED reward rule: a NORMAL round rewards the MAJORITY
 * side; a TWIST round rewards the MINORITY side. The reward rule is shown BEFORE
 * picking. Every player secretly picks a or b; at reveal the rewarded side's
 * voters each earn +500 (on an exact tie, nobody scores). Scores are cumulative.
 *
 * Server-authoritative anti-cheat: individual picks are NEVER sent to clients
 * before reveal (only an aggregate submitted count + your own pick). Who-picked-
 * what is hidden mid-phase. Cumulative scores may be visible (like Fibbage).
 */
export class MobRule extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'picking', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'picking' },
        picking: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'picking', finish: 'finished' },
      },
    });
    this.scores = {};
    this.roundIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    // One opinion + one twist-flag per round, chosen ONCE at startGame.
    this.rounds = [];
    this.prompt = null;
    this.isTwist = false;
    this.picks = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._pickTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    // Pick all opinion prompts ONCE for the whole game.
    const opinions = pickOpinions(this.totalRounds);
    // Flag 1-2 of the rounds as TWIST (minority wins), the rest NORMAL.
    const twistCount = 1 + Math.floor(Math.random() * 2); // 1 or 2
    const twistSlots = new Set(shuffle([...Array(this.totalRounds).keys()]).slice(0, twistCount));
    this.rounds = opinions.map((op, i) => ({
      prompt: op.prompt,
      a: op.a,
      b: op.b,
      isTwist: twistSlots.has(i),
    }));
    this.transition('start'); // -> onEnterPicking
  }

  // ---------- PICKING ----------
  onEnterPicking() {
    this.roundIndex++;
    const r = this.rounds[this.roundIndex % this.rounds.length];
    this.prompt = r;
    this.isTwist = r.isTwist;
    this.picks = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this._pickTimer = setTimeout(() => {
      if (this.state !== 'picking') return;
      // Auto-pick a random side for anyone who never picked.
      for (const p of this.players) {
        if (this.picks[p] === undefined) this.picks[p] = Math.random() < 0.5 ? 'a' : 'b';
      }
      this._toReveal();
      this._emitChange();
    }, PICK_MS);
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'picking') return;
    this._clearAllTimers();
    this.transition('reveal'); // -> onEnterReveal
  }
  onEnterReveal() {
    const countA = this.players.filter((p) => this.picks[p] === 'a').length;
    const countB = this.players.filter((p) => this.picks[p] === 'b').length;

    // Which side is rewarded? Normal → larger side; twist → smaller side.
    // On an exact tie (countA === countB) nobody scores.
    let rewardedSide = null;
    if (countA !== countB) {
      const majority = countA > countB ? 'a' : 'b';
      const minority = countA > countB ? 'b' : 'a';
      rewardedSide = this.isTwist ? minority : majority;
    }

    const awards = {};
    for (const p of this.players) {
      let gained = 0;
      const won = rewardedSide !== null && this.picks[p] === rewardedSide;
      if (won) { gained = POINTS_WIN; this.scores[p] = (this.scores[p] || 0) + gained; }
      awards[p] = { side: this.picks[p] || null, won, gained };
    }

    this.revealData = {
      isTwist: this.isTwist,
      countA,
      countB,
      rewardedSide, // 'a' | 'b' | null (tie)
      tie: rewardedSide === null,
      picks: { ...this.picks }, // who picked what — only disclosed AT reveal
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
    else this.transition('next'); // -> onEnterPicking
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'picking' && type === 'pickSide') {
      if (this.picks[playerId] !== undefined) return;
      const side = action.side;
      if (side !== 'a' && side !== 'b') return;
      this.picks[playerId] = side;
      this._checkPickComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkPickComplete() {
    if (this.state !== 'picking') return;
    if (this.players.every((p) => this.picks[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearAllTimers() {
    for (const k of ['_pickTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.picks[playerId];
    this.acknowledged.delete(playerId);
    delete this.scores[playerId];

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'picking') this._checkPickComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    return {
      phase: this.state,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      promptText: this.prompt ? this.prompt.prompt : '',
      sideA: this.prompt ? this.prompt.a : '',
      sideB: this.prompt ? this.prompt.b : '',
      isTwist: this.isTwist,
      rewardLabel: this.isTwist ? 'TWIST: MINORITY WINS' : 'MAJORITY WINS',
      scores: { ...this.scores },
      myId: playerId,
      myPick: this.picks[playerId] != null ? this.picks[playerId] : null,
      hasPicked: this.picks[playerId] !== undefined,
      pickedCount: Object.keys(this.picks).length,
      playerCount: this.players.length,
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
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
