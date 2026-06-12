import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const POINTS_TRUTH = 1000;
const POINTS_FOOL = 500;
const TOTAL_ROUNDS = 4;
const FIBBAGE_REVEAL_MS = 12_000;
const WRITE_MS = TIMERS.FIBBAGE_WRITE * 1000;
const VOTE_MS = TIMERS.FIBBAGE_VOTE * 1000;

// Obscure trivia. `answer` is the real answer; `alts` are alternate spellings that
// also count as "the truth" so a fake matching them is rejected as too close.
const PROMPT_BANK = [
  { prompt: 'In 2016, a town in Spain held an election and gave the honorary title of mayor to a local ____.', answer: 'goat', alts: [] },
  { prompt: 'The official state ____ of Texas is the Dutch oven.', answer: 'cooking vessel', alts: ['pot'] },
  { prompt: 'A group of flamingos is officially called a ____.', answer: 'flamboyance', alts: [] },
  { prompt: 'The longest recorded flight of a ____ is just 13 seconds.', answer: 'chicken', alts: [] },
  { prompt: 'In Switzerland it is illegal to own just one ____ because they get lonely.', answer: 'guinea pig', alts: ['guinea pigs'] },
  { prompt: 'The dot over a lowercase i or j is called a ____.', answer: 'tittle', alts: [] },
  { prompt: 'Bubble wrap was originally invented to be used as ____.', answer: 'wallpaper', alts: [] },
  { prompt: 'A ____ has three hearts and blue blood.', answer: 'octopus', alts: ['octopuses', 'octopi'] },
  { prompt: 'The fear of long words is ironically named hippopotomonstrosesqui-pedalio-____.', answer: 'phobia', alts: [] },
  { prompt: 'Honey found in ancient Egyptian tombs was still ____ after 3000 years.', answer: 'edible', alts: ['safe to eat'] },
  { prompt: 'The world record for the most ____ stuffed in a mouth at once is 17.', answer: 'snails', alts: ['snail'] },
  { prompt: 'Astronauts get taller in space because their ____ expand.', answer: 'spines', alts: ['spine'] },
  { prompt: 'A ____ can sleep for up to three years at a time.', answer: 'snail', alts: ['snails'] },
  { prompt: 'The inventor of the frisbee was turned into a ____ after he died.', answer: 'frisbee', alts: [] },
  { prompt: 'Cows have best friends and get stressed when they are ____.', answer: 'separated', alts: ['apart'] },
  { prompt: 'The unicorn is the official national animal of ____.', answer: 'Scotland', alts: [] },
  { prompt: 'There is a species of jellyfish that is biologically ____.', answer: 'immortal', alts: [] },
  { prompt: 'The first product to ever have a barcode scanned was a pack of ____.', answer: 'gum', alts: ['chewing gum'] },
  { prompt: 'A ____ can recognize itself in a mirror, one of the few animals that can.', answer: 'magpie', alts: [] },
  { prompt: 'In the 1800s, doctors prescribed ____ to babies as a teething remedy.', answer: 'heroin', alts: [] },
  { prompt: 'Wombat ____ is cube-shaped.', answer: 'poop', alts: ['droppings', 'scat'] },
  { prompt: 'The shortest war in history lasted about 38 ____.', answer: 'minutes', alts: [] },
  { prompt: 'Nintendo was originally founded in 1889 as a maker of ____.', answer: 'playing cards', alts: ['cards'] },
  { prompt: 'The longest hiccuping spree lasted 68 ____.', answer: 'years', alts: [] },
  { prompt: 'A ____ has no vocal cords and communicates with its tail and body.', answer: 'giraffe', alts: [] },
  { prompt: 'Bananas are slightly ____, which is why they sometimes set off scanners.', answer: 'radioactive', alts: [] },
  { prompt: 'The hashtag symbol is technically called an ____.', answer: 'octothorpe', alts: [] },
  { prompt: 'Sea otters hold ____ while they sleep so they do not drift apart.', answer: 'hands', alts: ['paws'] },
  { prompt: 'The Eiffel Tower can be 15 cm ____ during the summer.', answer: 'taller', alts: ['bigger'] },
  { prompt: 'A ____ is the only mammal that cannot jump.', answer: 'elephant', alts: ['elephants'] },
  { prompt: 'Scotland once banned the playing of ____ because it distracted from archery.', answer: 'golf', alts: [] },
  { prompt: 'The plastic tip at the end of a shoelace is called an ____.', answer: 'aglet', alts: [] },
  { prompt: 'It is illegal to die in the Houses of ____ in the UK (technically).', answer: 'Parliament', alts: [] },
  { prompt: 'A single strand of ____ silk is stronger than steel of the same width.', answer: 'spider', alts: [] },
  { prompt: 'Pineapples take about two ____ to grow.', answer: 'years', alts: [] },
  { prompt: 'The "M" in M&Ms stands for Mars and ____.', answer: 'Murrie', alts: [] },
  { prompt: 'A ____ of crows is called a murder.', answer: 'group', alts: ['flock'] },
  { prompt: 'Venus is the only planet that spins ____.', answer: 'clockwise', alts: ['backwards'] },
  { prompt: 'The average ____ has about 32 muscles in each ear.', answer: 'cat', alts: ['cats'] },
  { prompt: 'A ____ can taste with its entire body, especially its feet.', answer: 'butterfly', alts: ['butterflies'] },
  { prompt: 'Humans share about 50% of their DNA with a ____.', answer: 'banana', alts: ['bananas'] },
  { prompt: 'The hottest chili is measured in Scoville ____.', answer: 'units', alts: [] },
];

const HOUSE_FAKES = ['banana', 'penguin', 'a tiny hat', 'the moon', 'a spoon', 'confetti', 'a llama', 'spaghetti', 'a kazoo', 'glitter', 'a wizard', 'a potato', 'bubbles', 'a rubber duck', 'a disco ball', 'jellybeans'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Fibbage — bluff trivia. Server-authoritative anti-cheat: the truth is never sent
 * to clients before reveal; the voting ballot carries NO authorId and NO kind
 * (truth and fakes are indistinguishable); a player cannot vote for their own fib;
 * and fakes are validated server-side (rejected if they equal the truth/alts or
 * duplicate another player's fake). Who-submitted / who-voted is never leaked
 * mid-phase — only aggregate counts.
 */
export class Fibbage extends BaseGame {
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
    this.promptIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.bank = shuffle(PROMPT_BANK);
    this.prompt = null;
    this.fakes = {};
    this.votes = {};
    this.ballot = [];
    this.revealData = null;
    this.acknowledged = new Set();
    this._writeTimer = null;
    this._voteTimer = null;
    this._revealTimer = null;
    this._writeStartTime = 0;
    this._voteStartTime = 0;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.scores[p] = 0; this.foolCounts[p] = 0; this.foundTruthCounts[p] = 0; }
    this.transition('start'); // -> onEnterWriting
  }

  // ---------- WRITING ----------
  onEnterWriting() {
    this.promptIndex++;
    this.prompt = this.bank[this.promptIndex % this.bank.length];
    this.fakes = {};
    this.votes = {};
    this.ballot = [];
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this._writeStartTime = Date.now();
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      const used = new Set(Object.values(this.fakes).map((f) => f.toLowerCase()));
      for (const p of this.players) {
        if (this.fakes[p] === undefined) {
          const hf = HOUSE_FAKES.find((h) => !this._matchesTruth(h) && !used.has(h.toLowerCase())) || `decoy ${p.slice(0, 3)}`;
          used.add(hf.toLowerCase());
          this.fakes[p] = hf;
        }
      }
      this._toVoting();
      this._emitChange();
    }, WRITE_MS);
  }

  _matchesTruth(t) {
    const lc = String(t).trim().toLowerCase();
    if (lc === String(this.prompt.answer).toLowerCase()) return true;
    return (this.prompt.alts || []).some((a) => a.toLowerCase() === lc);
  }
  _duplicateFake(t, pid) {
    const lc = String(t).trim().toLowerCase();
    return Object.entries(this.fakes).some(([p, f]) => p !== pid && f.toLowerCase() === lc);
  }

  // ---------- VOTING ----------
  _toVoting() {
    if (this.state !== 'writing') return;
    this._clearAllTimers();
    this.transition('vote'); // -> onEnterVoting
  }
  onEnterVoting() {
    const opts = Object.entries(this.fakes).map(([authorId, text]) => ({ text, kind: 'fake', authorId }));
    opts.push({ text: this.prompt.answer, kind: 'truth', authorId: null });
    this.ballot = shuffle(opts).map((o, i) => ({ optionId: `opt_${i}`, ...o }));
    this.votes = {};
    this._clearAllTimers();
    this._voteStartTime = Date.now();
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
      options: this.ballot.map((o) => ({ optionId: o.optionId, text: o.text, kind: o.kind, authorId: o.authorId, voters: votersByOption[o.optionId] || [] })),
      truthOptionId,
      awards,
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, FIBBAGE_REVEAL_MS);
  }
  _advance() {
    if (this.state !== 'reveal') return;
    this._clearAllTimers();
    if (this.promptIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterWriting
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'writing' && type === 'submitFake') {
      if (this.fakes[playerId] !== undefined) return;
      const t = String(action.text || '').trim().slice(0, 80);
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
      promptNumber: this.promptIndex + 1,
      totalRounds: this.totalRounds,
      promptText: this.prompt ? this.prompt.prompt : '',
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
      writeEndTime: this.state === 'writing' && this._writeStartTime ? this._writeStartTime + WRITE_MS : null,
      voteEndTime: this.state === 'voting' && this._voteStartTime ? this._voteStartTime + VOTE_MS : null,
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
