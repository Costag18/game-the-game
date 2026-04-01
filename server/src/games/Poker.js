import { BaseGame } from './BaseGame.js';
import { Deck } from '../utils/Deck.js';

// ---------------------------------------------------------------------------
// Hand evaluation helpers
// ---------------------------------------------------------------------------

// Deck uses rank 1 = Ace, 2-10, 11=J, 12=Q, 13=K
// For straight/high-card comparison we treat Ace as high (14) OR low (1).
function cardValue(rank) {
  return rank === 1 ? 14 : rank; // Ace high by default
}

/**
 * Generate all C(n,k) combinations from an array.
 */
function combinations(arr, k) {
  const result = [];
  function helper(start, combo) {
    if (combo.length === k) { result.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

/**
 * Evaluate a 5-card hand.
 * Returns { rank, description, tiebreakers }
 * rank 0 = Royal Flush (best), 9 = High Card (worst)
 * tiebreakers is an array of values used to compare equal-rank hands.
 */
function evaluate5(cards) {
  // Map ranks to high values
  const vals = cards.map((c) => cardValue(c.rank)).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);

  // Check straight (including A-low: A-2-3-4-5)
  function checkStraight(vs) {
    const uniq = [...new Set(vs)].sort((a, b) => b - a);
    if (uniq.length === 5 && uniq[0] - uniq[4] === 4) return uniq[0]; // returns high card
    // Ace-low straight: A-2-3-4-5 -> values 14,5,4,3,2
    if (uniq.length === 5 && uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) return 5;
    return 0;
  }
  const straightHigh = checkStraight(vals);
  const isStraight = straightHigh > 0;

  // Count frequencies
  const freq = {};
  for (const v of vals) freq[v] = (freq[v] || 0) + 1;
  const counts = Object.values(freq).sort((a, b) => b - a); // e.g. [3,1,1] for three of a kind
  const groups = Object.entries(freq)
    .map(([v, c]) => ({ v: Number(v), c }))
    .sort((a, b) => b.c - a.c || b.v - a.v); // sort by count desc, then value desc

  // Royal Flush: straight flush with high card = Ace (14)
  if (isFlush && isStraight && straightHigh === 14) {
    return { rank: 0, description: 'Royal Flush', tiebreakers: [14] };
  }
  // Straight Flush
  if (isFlush && isStraight) {
    return { rank: 1, description: `Straight Flush, ${rankName(straightHigh)} high`, tiebreakers: [straightHigh] };
  }
  // Four of a Kind
  if (counts[0] === 4) {
    const quad = groups[0].v;
    const kicker = groups[1].v;
    return { rank: 2, description: `Four ${rankName(quad)}s`, tiebreakers: [quad, kicker] };
  }
  // Full House
  if (counts[0] === 3 && counts[1] === 2) {
    const trips = groups[0].v;
    const pair = groups[1].v;
    return { rank: 3, description: `Full House, ${rankName(trips)}s full of ${rankName(pair)}s`, tiebreakers: [trips, pair] };
  }
  // Flush
  if (isFlush) {
    return { rank: 4, description: `Flush, ${rankName(vals[0])} high`, tiebreakers: vals };
  }
  // Straight
  if (isStraight) {
    return { rank: 5, description: `Straight, ${rankName(straightHigh)} high`, tiebreakers: [straightHigh] };
  }
  // Three of a Kind
  if (counts[0] === 3) {
    const trips = groups[0].v;
    const kickers = groups.filter((g) => g.c === 1).map((g) => g.v).sort((a, b) => b - a);
    return { rank: 6, description: `Three ${rankName(trips)}s`, tiebreakers: [trips, ...kickers] };
  }
  // Two Pair
  if (counts[0] === 2 && counts[1] === 2) {
    const highPair = groups[0].v;
    const lowPair = groups[1].v;
    const kicker = groups[2].v;
    return { rank: 7, description: `Two Pair, ${rankName(highPair)}s and ${rankName(lowPair)}s`, tiebreakers: [highPair, lowPair, kicker] };
  }
  // One Pair
  if (counts[0] === 2) {
    const pair = groups[0].v;
    const kickers = groups.filter((g) => g.c === 1).map((g) => g.v).sort((a, b) => b - a);
    return { rank: 8, description: `Pair of ${rankName(pair)}s`, tiebreakers: [pair, ...kickers] };
  }
  // High Card
  return { rank: 9, description: `${rankName(vals[0])} High`, tiebreakers: vals };
}

function rankName(v) {
  const names = { 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten' };
  return names[v] ?? String(v);
}

/**
 * Evaluate the best 5-card hand from up to 7 cards.
 * Returns { rank, description, tiebreakers }
 */
export function evaluateHand(cards) {
  if (cards.length < 5) {
    // Fewer than 5 cards — just evaluate what we have
    const vals = cards.map((c) => cardValue(c.rank)).sort((a, b) => b - a);
    return { rank: 9, description: `${rankName(vals[0] || 0)} High`, tiebreakers: vals };
  }
  const combos = combinations(cards, 5);
  let best = null;
  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!best || compareHands(result, best) < 0) {
      best = result;
    }
  }
  return best;
}

/**
 * Compare two hand evaluation results.
 * Returns negative if a is better (lower rank = better), positive if b is better, 0 if tie.
 */
function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const av = a.tiebreakers[i] ?? 0;
    const bv = b.tiebreakers[i] ?? 0;
    if (av !== bv) return bv - av; // higher tiebreaker is better
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Poker game engine
// ---------------------------------------------------------------------------

const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const HANDS_PER_GAME = 5;

const FSM = {
  initialState: 'waiting',
  transitions: {
    waiting: { start: 'preflop' },
    preflop: { deal: 'flop', finish: 'finished', newhand: 'preflop' },
    flop: { deal: 'turn', finish: 'finished' },
    turn: { deal: 'river', finish: 'finished' },
    river: { showdown: 'showdown', finish: 'finished' },
    showdown: { finish: 'finished', newhand: 'preflop' },
  },
};

export class Poker extends BaseGame {
  constructor(players) {
    super(players, FSM);
    this.deck = new Deck();
    this.holeCards = {};      // playerId -> [card, card]
    this.communityCards = []; // up to 5
    this.chips = {};          // playerId -> chip count
    this.bets = {};           // playerId -> amount bet this round
    this.pot = 0;
    this.folded = new Set();  // playerIds that have folded
    this.dealerIndex = 0;     // index into this.players for the dealer button
    this.currentBet = 0;      // the current bet to match this round
    this.lastRaiser = null;   // playerId of last raiser (to detect full orbit)
    this.actedThisRound = new Set(); // players who have acted this betting round
    this._roundComplete = false;
    this.handNumber = 0;           // current hand (1-based once started)
    this.handResults = [];         // store result of each hand for display
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  startGame() {
    // Initialise chips
    for (const p of this.players) {
      this.chips[p] = STARTING_CHIPS;
    }
    this.handNumber = 0;
    this.handResults = [];
    this.dealerIndex = 0;

    this.transition('start');
    this._startHand();
  }

  _startHand() {
    this.handNumber++;
    this.deck.reset();
    this.holeCards = {};
    this.communityCards = [];
    this.pot = 0;
    this.folded = new Set();
    this.bets = {};
    this.actedThisRound = new Set();
    this.lastRaiser = null;
    this._roundComplete = false;

    for (const p of this.players) {
      this.bets[p] = 0;
    }

    // Auto-fold broke players (0 chips) at hand start
    for (const p of this.players) {
      if (this.chips[p] <= 0) {
        this.folded.add(p);
      }
    }

    // Deal 2 hole cards to each player (even folded, for state consistency)
    for (const p of this.players) {
      this.holeCards[p] = this.deck.dealMultiple(2);
    }

    // Post blinds (only among non-folded players)
    const activePlayers = this._nonFoldedPlayers();
    const n = activePlayers.length;
    if (n <= 1) {
      // Only one player left — they win by default
      if (n === 1) {
        this.chips[activePlayers[0]] += this.pot;
        this.pot = 0;
      }
      this._forceFinish();
      return;
    }

    const sbIdx = this.dealerIndex % n;
    const bbIdx = (this.dealerIndex + 1) % n;
    const sbPlayer = activePlayers[sbIdx];
    const bbPlayer = activePlayers[bbIdx];

    this._postBlind(sbPlayer, SMALL_BLIND);
    this._postBlind(bbPlayer, BIG_BLIND);
    this.currentBet = BIG_BLIND;

    // Mark all-in players (from blind posts) as already acted
    this.actedThisRound = new Set();
    for (const p of activePlayers) {
      if (this.chips[p] <= 0) {
        this.actedThisRound.add(p);
      }
    }

    // First to act preflop = first player with chips after big blind
    let firstActIdx = (bbIdx + 1) % n;
    for (let i = 0; i < n; i++) {
      const idx = (firstActIdx + i) % n;
      if (this.chips[activePlayers[idx]] > 0) {
        firstActIdx = idx;
        break;
      }
    }
    this.setTurnPlayer(activePlayers[firstActIdx]);
  }

  _postBlind(playerId, amount) {
    const actual = Math.min(amount, this.chips[playerId]);
    this.chips[playerId] -= actual;
    this.bets[playerId] = (this.bets[playerId] || 0) + actual;
    this.pot += actual;
  }

  // -------------------------------------------------------------------------
  // Action handling
  // -------------------------------------------------------------------------

  handleAction(playerId, action) {
    const validStates = ['preflop', 'flop', 'turn', 'river'];
    if (!validStates.includes(this.state)) return;
    if (playerId !== this.currentTurnPlayer) return;
    if (this.folded.has(playerId)) return;

    const { type, amount } = action;

    if (type === 'fold') {
      this.folded.add(playerId);
      this.actedThisRound.add(playerId);
      // If only one player left, they win immediately
      const remaining = this._activePlayers().filter((p) => !this.folded.has(p));
      if (remaining.length === 1) {
        this._collectBets();
        this.chips[remaining[0]] += this.pot;
        this.pot = 0;
        this._forceFinish();
        return;
      }
    } else if (type === 'check') {
      // Only valid if currentBet equals what this player has already bet
      if (this.currentBet > (this.bets[playerId] || 0)) return; // must call or raise
      this.actedThisRound.add(playerId);
    } else if (type === 'call') {
      const toCall = this.currentBet - (this.bets[playerId] || 0);
      if (toCall <= 0) return; // nothing to call
      const actual = Math.min(toCall, this.chips[playerId]);
      this.chips[playerId] -= actual;
      this.bets[playerId] = (this.bets[playerId] || 0) + actual;
      this.pot += actual;
      this.actedThisRound.add(playerId);
    } else if (type === 'raise') {
      const raiseTotal = Number(amount);
      if (!raiseTotal || isNaN(raiseTotal)) return;
      const minBet = this.currentBet + BIG_BLIND;
      if (raiseTotal < minBet) return; // raise must be at least min
      const toAdd = raiseTotal - (this.bets[playerId] || 0);
      if (toAdd > this.chips[playerId]) return; // can't afford
      this.chips[playerId] -= toAdd;
      this.bets[playerId] = raiseTotal;
      this.pot += toAdd;
      this.currentBet = raiseTotal;
      this.lastRaiser = playerId;
      // Reset acted set so everyone else must act again
      this.actedThisRound = new Set([playerId]);
    } else {
      return; // unknown action
    }

    // Advance to next player or complete round
    if (this._isBettingRoundComplete()) {
      this._advanceStage();
    } else {
      this._nextActiveTurn();
    }
  }

  _activePlayers() {
    return this.players.filter((p) => this.chips[p] !== undefined);
  }

  _nonFoldedPlayers() {
    return this._activePlayers().filter((p) => !this.folded.has(p));
  }

  _isBettingRoundComplete() {
    const active = this._nonFoldedPlayers();
    if (active.length <= 1) return true;
    for (const p of active) {
      // Must have acted
      if (!this.actedThisRound.has(p)) return false;
      // Must have matched the current bet (or be all-in with 0 chips)
      if (this.chips[p] > 0 && (this.bets[p] || 0) < this.currentBet) return false;
    }
    return true;
  }

  _nextActiveTurn() {
    const active = this._nonFoldedPlayers();
    if (active.length === 0) return;
    const cur = this.currentTurnPlayer;
    const curIdx = active.indexOf(cur);

    // Find next player who can actually act (has chips and hasn't acted)
    for (let i = 1; i <= active.length; i++) {
      const nextIdx = (curIdx + i) % active.length;
      const next = active[nextIdx];
      if (this.chips[next] > 0 && !this.actedThisRound.has(next)) {
        this.currentTurnPlayer = next;
        this.turnIndex = this.players.indexOf(this.currentTurnPlayer);
        return;
      }
    }

    // Everyone has acted or is all-in — round is complete
    // Fallback to next player anyway (isBettingRoundComplete will catch it)
    const nextIdx = (curIdx + 1) % active.length;
    this.currentTurnPlayer = active[nextIdx];
    this.turnIndex = this.players.indexOf(this.currentTurnPlayer);
  }

  _collectBets() {
    for (const p of this.players) {
      this.bets[p] = 0;
    }
    this.currentBet = 0;
    this.lastRaiser = null;
    this.actedThisRound = new Set();
  }

  _advanceStage() {
    this._collectBets();
    const stateMap = {
      preflop: 'deal',   // -> flop
      flop: 'deal',      // -> turn
      turn: 'deal',      // -> river
      river: 'showdown', // -> showdown
    };
    const transitionAction = stateMap[this.state];
    if (!transitionAction) return;

    this.transition(transitionAction);

    if (this.state === 'flop') {
      this.communityCards.push(...this.deck.dealMultiple(3));
      this._startBettingRound();
    } else if (this.state === 'turn') {
      this.communityCards.push(this.deck.deal());
      this._startBettingRound();
    } else if (this.state === 'river') {
      this.communityCards.push(this.deck.deal());
      this._startBettingRound();
    } else if (this.state === 'showdown') {
      this._resolveShowdown();
    }
  }

  _startBettingRound() {
    this.currentBet = 0;
    this.actedThisRound = new Set();
    this.lastRaiser = null;

    const active = this._nonFoldedPlayers();
    if (active.length === 0) return;

    // Mark all-in players (0 chips) as already acted — they can't do anything
    for (const p of active) {
      if (this.chips[p] <= 0) {
        this.actedThisRound.add(p);
      }
    }

    // If everyone is all-in or only one can act, skip straight to next stage
    if (this._isBettingRoundComplete()) {
      this._advanceStage();
      return;
    }

    // First to act post-flop: first non-folded, non-all-in player left of dealer
    const canAct = active.filter((p) => this.chips[p] > 0);
    if (canAct.length === 0) {
      this._advanceStage();
      return;
    }

    const n = active.length;
    const dealerPlayer = this.players[this.dealerIndex % this.players.length];
    let startIdx = (active.indexOf(dealerPlayer) + 1) % n;
    if (active.indexOf(dealerPlayer) === -1) startIdx = 0;

    // Find the first player who can actually act
    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      if (this.chips[active[idx]] > 0) {
        this.currentTurnPlayer = active[idx];
        this.turnIndex = this.players.indexOf(this.currentTurnPlayer);
        return;
      }
    }

    // Fallback — everyone is all-in
    this._advanceStage();
  }

  _resolveShowdown() {
    // Award pot to best hand
    const contenders = this._nonFoldedPlayers();
    let winnerName = null;
    let bestDesc = null;

    if (contenders.length > 0) {
      let best = null;
      let winner = null;
      for (const p of contenders) {
        const allCards = [...(this.holeCards[p] || []), ...this.communityCards];
        const result = evaluateHand(allCards);
        if (!best || compareHands(result, best) < 0) {
          best = result;
          winner = p;
        }
      }
      if (winner) {
        this.chips[winner] += this.pot;
        this.pot = 0;
        winnerName = winner;
        bestDesc = best?.description;
      }
    }

    // Record hand result
    this.handResults.push({
      hand: this.handNumber,
      winner: winnerName,
      handDescription: bestDesc,
      holeCards: Object.fromEntries(
        this.players.map((p) => [p, this.holeCards[p] || []])
      ),
      communityCards: [...this.communityCards],
    });

    this._finishHandOrGame();
  }

  _forceFinish() {
    // Someone won by everyone else folding
    const remaining = this._activePlayers().filter((p) => !this.folded.has(p));
    const winner = remaining[0] || null;

    this.handResults.push({
      hand: this.handNumber,
      winner,
      handDescription: 'All others folded',
      holeCards: Object.fromEntries(
        this.players.map((p) => [p, this.holeCards[p] || []])
      ),
      communityCards: [...this.communityCards],
    });

    this._finishHandOrGame();
  }

  _finishHandOrGame() {
    if (this.handNumber >= HANDS_PER_GAME) {
      this.state = 'finished';
      return;
    }

    // End early if only 1 player has chips (no competition)
    const playersWithChips = this.players.filter((p) => this.chips[p] > 0);
    if (playersWithChips.length <= 1) {
      this.state = 'finished';
      return;
    }

    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.state = 'preflop';
    this._startHand();
  }

  // -------------------------------------------------------------------------
  // State access
  // -------------------------------------------------------------------------

  getStateForPlayer(playerId) {
    const nonFolded = this._nonFoldedPlayers();
    return {
      phase: this.state,
      isBroke: (this.chips[playerId] ?? 0) <= 0,
      myHoleCards: this.holeCards[playerId] || [],
      communityCards: this.communityCards,
      pot: this.pot,
      currentBet: this.currentBet,
      myChips: this.chips[playerId] ?? 0,
      myBet: this.bets[playerId] || 0,
      isMyTurn: this.currentTurnPlayer === playerId && ['preflop', 'flop', 'turn', 'river'].includes(this.state),
      currentTurnPlayer: this.currentTurnPlayer,
      folded: [...this.folded],
      handNumber: this.handNumber,
      totalHands: HANDS_PER_GAME,
      handResults: this.handResults,
      otherPlayers: this.players
        .filter((p) => p !== playerId)
        .map((p) => ({
          playerId: p,
          chips: this.chips[p] ?? 0,
          bet: this.bets[p] || 0,
          folded: this.folded.has(p),
          cardCount: (this.holeCards[p] || []).length,
        })),
      // In showdown/finished reveal all hole cards + hand descriptions
      revealedHands: this.state === 'showdown' || this.state === 'finished'
        ? Object.fromEntries(
            nonFolded.map((p) => {
              const allCards = [...(this.holeCards[p] || []), ...this.communityCards];
              const hand = allCards.length >= 5 ? evaluateHand(allCards) : null;
              return [p, {
                cards: this.holeCards[p] || [],
                handDescription: hand ? hand.description : 'N/A',
              }];
            })
          )
        : {},
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const evaluated = this.players.map((p) => {
      const allCards = [...(this.holeCards[p] || []), ...this.communityCards];
      const handResult = allCards.length >= 5 ? evaluateHand(allCards) : { rank: 99, description: 'N/A', tiebreakers: [] };
      return { playerId: p, handResult, chips: this.chips[p] ?? 0, folded: this.folded.has(p) };
    });

    // Sort: non-folded first by hand rank, then folded players
    evaluated.sort((a, b) => {
      if (a.folded && !b.folded) return 1;
      if (!a.folded && b.folded) return -1;
      if (!a.folded && !b.folded) return compareHands(a.handResult, b.handResult);
      return 0;
    });

    let placement = 1;
    return evaluated.map((e, i) => {
      if (i > 0) {
        const prev = evaluated[i - 1];
        // Tied only if both non-folded (or both folded) with identical hand comparison
        const sameCategory = e.folded === prev.folded;
        const sameHand = !e.folded && !prev.folded && compareHands(e.handResult, prev.handResult) === 0;
        const bothFolded = e.folded && prev.folded;
        if (!(sameCategory && (sameHand || bothFolded))) placement = i + 1;
      }
      return {
        playerId: e.playerId,
        placement,
        handDescription: e.handResult.description,
        handRank: e.handResult.rank,
        chips: e.chips,
        folded: e.folded,
      };
    });
  }
}
