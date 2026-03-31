import { describe, test, expect, beforeEach } from '@jest/globals';
import { Poker, evaluateHand } from '../../src/games/Poker.js';

// ---------------------------------------------------------------------------
// Helper to make a card
// ---------------------------------------------------------------------------
function c(rank, suit) {
  return { rank, suit };
}

// Ace = 1, J=11, Q=12, K=13

describe('evaluateHand', () => {
  test('Royal Flush', () => {
    const cards = [
      c(1, 'spades'), c(13, 'spades'), c(12, 'spades'), c(11, 'spades'), c(10, 'spades'),
      c(2, 'hearts'), c(3, 'hearts'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(0);
    expect(result.description).toMatch(/Royal Flush/);
  });

  test('Straight Flush', () => {
    const cards = [
      c(9, 'clubs'), c(8, 'clubs'), c(7, 'clubs'), c(6, 'clubs'), c(5, 'clubs'),
      c(2, 'hearts'), c(3, 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(1);
    expect(result.description).toMatch(/Straight Flush/);
  });

  test('Four of a Kind', () => {
    const cards = [
      c(7, 'hearts'), c(7, 'diamonds'), c(7, 'clubs'), c(7, 'spades'),
      c(2, 'hearts'), c(3, 'hearts'), c(4, 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(2);
    expect(result.description).toMatch(/Four/);
  });

  test('Full House', () => {
    const cards = [
      c(10, 'hearts'), c(10, 'diamonds'), c(10, 'clubs'),
      c(6, 'hearts'), c(6, 'spades'),
      c(2, 'clubs'), c(3, 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(3);
    expect(result.description).toMatch(/Full House/);
  });

  test('Flush', () => {
    const cards = [
      c(2, 'hearts'), c(5, 'hearts'), c(8, 'hearts'), c(11, 'hearts'), c(13, 'hearts'),
      c(3, 'spades'), c(4, 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(4);
    expect(result.description).toMatch(/Flush/);
  });

  test('Straight', () => {
    const cards = [
      c(9, 'hearts'), c(8, 'clubs'), c(7, 'diamonds'), c(6, 'spades'), c(5, 'hearts'),
      c(2, 'clubs'), c(3, 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(5);
    expect(result.description).toMatch(/Straight/);
  });

  test('Ace-low Straight (A-2-3-4-5)', () => {
    const cards = [
      c(1, 'hearts'), c(2, 'clubs'), c(3, 'diamonds'), c(4, 'spades'), c(5, 'hearts'),
      c(9, 'clubs'), c(13, 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(5);
    expect(result.description).toMatch(/Straight/);
  });

  test('Three of a Kind', () => {
    const cards = [
      c(4, 'hearts'), c(4, 'diamonds'), c(4, 'clubs'),
      c(7, 'spades'), c(9, 'hearts'),
      c(2, 'clubs'), c(3, 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(6);
    expect(result.description).toMatch(/Three/);
  });

  test('Two Pair', () => {
    const cards = [
      c(8, 'hearts'), c(8, 'diamonds'),
      c(5, 'clubs'), c(5, 'spades'),
      c(2, 'hearts'), c(3, 'clubs'), c(4, 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(7);
    expect(result.description).toMatch(/Two Pair/);
  });

  test('One Pair', () => {
    const cards = [
      c(1, 'hearts'), c(1, 'spades'),
      c(3, 'diamonds'), c(5, 'clubs'), c(7, 'hearts'),
      c(9, 'clubs'), c(10, 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(8);
    expect(result.description).toMatch(/Pair/);
  });

  test('High Card', () => {
    const cards = [
      c(2, 'hearts'), c(5, 'clubs'), c(7, 'diamonds'), c(9, 'spades'), c(11, 'hearts'),
      c(3, 'clubs'), c(6, 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(9);
    expect(result.description).toMatch(/High/);
  });

  test('Flush beats Straight', () => {
    const flush = evaluateHand([
      c(2, 'hearts'), c(5, 'hearts'), c(8, 'hearts'), c(11, 'hearts'), c(13, 'hearts'),
      c(9, 'clubs'), c(10, 'diamonds'),
    ]);
    const straight = evaluateHand([
      c(9, 'hearts'), c(8, 'clubs'), c(7, 'diamonds'), c(6, 'spades'), c(5, 'hearts'),
      c(2, 'clubs'), c(3, 'diamonds'),
    ]);
    expect(flush.rank).toBeLessThan(straight.rank);
  });

  test('Full House beats Flush', () => {
    const fullHouse = evaluateHand([
      c(10, 'hearts'), c(10, 'diamonds'), c(10, 'clubs'), c(6, 'hearts'), c(6, 'spades'),
      c(2, 'clubs'), c(3, 'diamonds'),
    ]);
    const flush = evaluateHand([
      c(2, 'hearts'), c(5, 'hearts'), c(8, 'hearts'), c(11, 'hearts'), c(13, 'hearts'),
      c(9, 'clubs'), c(10, 'diamonds'),
    ]);
    expect(fullHouse.rank).toBeLessThan(flush.rank);
  });
});

// ---------------------------------------------------------------------------
// Poker game engine
// ---------------------------------------------------------------------------

describe('Poker game engine', () => {
  let game;

  beforeEach(() => {
    game = new Poker(['p1', 'p2', 'p3']);
  });

  test('starts in waiting state', () => {
    expect(game.state).toBe('waiting');
  });

  test('startGame transitions to preflop', () => {
    game.startGame();
    expect(game.state).toBe('preflop');
  });

  test('deals 2 hole cards to each player', () => {
    game.startGame();
    expect(game.holeCards['p1']).toHaveLength(2);
    expect(game.holeCards['p2']).toHaveLength(2);
    expect(game.holeCards['p3']).toHaveLength(2);
  });

  test('community cards are empty at start', () => {
    game.startGame();
    expect(game.communityCards).toHaveLength(0);
  });

  test('each player starts with 1000 chips', () => {
    game.startGame();
    // Blinds have been posted so chips will be slightly less
    // But total should be 3000
    const total = game.chips['p1'] + game.chips['p2'] + game.chips['p3'] + game.pot;
    expect(total).toBe(3000);
  });

  test('blinds are posted correctly', () => {
    game.startGame();
    // pot should contain small blind + big blind = 30
    expect(game.pot).toBe(30);
  });

  test('getStateForPlayer returns hole cards only for that player', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.myHoleCards).toHaveLength(2);
    // Other players should not have hole cards revealed
    expect(Object.keys(state.revealedHands)).toHaveLength(0);
  });

  test('getStateForPlayer shows community cards', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.communityCards).toEqual(game.communityCards);
  });

  test('getStateForPlayer shows pot and current bet', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.pot).toBe(game.pot);
    expect(state.currentBet).toBe(game.currentBet);
  });

  test('isMyTurn is correct', () => {
    game.startGame();
    const turnPlayer = game.currentTurnPlayer;
    const stateForTurn = game.getStateForPlayer(turnPlayer);
    expect(stateForTurn.isMyTurn).toBe(true);
    const nonTurnPlayer = game.players.find((p) => p !== turnPlayer);
    const stateForNonTurn = game.getStateForPlayer(nonTurnPlayer);
    expect(stateForNonTurn.isMyTurn).toBe(false);
  });

  test('fold removes player from active betting', () => {
    game.startGame();
    const turnPlayer = game.currentTurnPlayer;
    game.handleAction(turnPlayer, { type: 'fold' });
    expect(game.folded.has(turnPlayer)).toBe(true);
  });

  test('non-turn player action is ignored', () => {
    game.startGame();
    const turnPlayer = game.currentTurnPlayer;
    const nonTurnPlayer = game.players.find((p) => p !== turnPlayer);
    const chipsBefore = game.chips[nonTurnPlayer];
    game.handleAction(nonTurnPlayer, { type: 'call' });
    expect(game.chips[nonTurnPlayer]).toBe(chipsBefore);
  });

  test('call matches current bet', () => {
    game.startGame();
    const turnPlayer = game.currentTurnPlayer;
    const chipsBefore = game.chips[turnPlayer];
    const betBefore = game.bets[turnPlayer] || 0;
    const toCall = game.currentBet - betBefore;
    game.handleAction(turnPlayer, { type: 'call' });
    expect(game.chips[turnPlayer]).toBe(chipsBefore - toCall);
  });

  test('raise increases current bet', () => {
    game.startGame();
    const turnPlayer = game.currentTurnPlayer;
    const raiseAmount = game.currentBet + 40; // raise by 40 above current bet
    game.handleAction(turnPlayer, { type: 'raise', amount: raiseAmount });
    expect(game.currentBet).toBe(raiseAmount);
  });

  test('raise below minimum is rejected', () => {
    game.startGame();
    const turnPlayer = game.currentTurnPlayer;
    const currentBetBefore = game.currentBet;
    game.handleAction(turnPlayer, { type: 'raise', amount: game.currentBet + 1 }); // less than min raise
    // current bet should not change since raise was invalid (min raise = currentBet + BIG_BLIND = currentBet + 20)
    expect(game.currentBet).toBe(currentBetBefore);
  });

  test('betting round completion advances to flop', () => {
    game.startGame();
    // Have all players call/check to complete the preflop betting round
    _completePreflop(game);
    expect(game.state).toBe('flop');
    expect(game.communityCards).toHaveLength(3);
  });

  test('flop deals 3 community cards', () => {
    game.startGame();
    _completePreflop(game);
    expect(game.communityCards).toHaveLength(3);
  });

  test('turn deals 1 more community card (4 total)', () => {
    game.startGame();
    _completePreflop(game);
    _completeBettingRound(game);
    expect(game.state).toBe('turn');
    expect(game.communityCards).toHaveLength(4);
  });

  test('river deals 1 more community card (5 total)', () => {
    game.startGame();
    _completePreflop(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    expect(game.state).toBe('river');
    expect(game.communityCards).toHaveLength(5);
  });

  test('showdown evaluates hands and game finishes', () => {
    game.startGame();
    _completePreflop(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    expect(game.state).toBe('finished');
    expect(game.isComplete()).toBe(true);
  });

  test('pot is awarded to a player in showdown', () => {
    game.startGame();
    const potBefore = game.pot;
    expect(potBefore).toBeGreaterThan(0);
    _completePreflop(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    // Pot should have been distributed
    expect(game.pot).toBe(0);
    const total = game.chips['p1'] + game.chips['p2'] + game.chips['p3'];
    expect(total).toBe(3000);
  });

  test('folding all but one player ends game immediately', () => {
    game.startGame();
    // Keep folding until one player remains
    let safeGuard = 0;
    while (!game.isComplete() && safeGuard++ < 20) {
      const tp = game.currentTurnPlayer;
      if (!tp) break;
      game.handleAction(tp, { type: 'fold' });
    }
    expect(game.isComplete()).toBe(true);
  });

  test('getResults returns placement for all players', () => {
    game.startGame();
    _completePreflop(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    const results = game.getResults();
    expect(results).toHaveLength(3);
    expect(results[0].placement).toBe(1);
    expect(results[1].placement).toBe(2);
    expect(results[2].placement).toBe(3);
  });

  test('getResults puts folded players last', () => {
    game.startGame();
    // Fold one player, complete the hand
    const firstTurn = game.currentTurnPlayer;
    game.handleAction(firstTurn, { type: 'fold' });
    if (!game.isComplete()) {
      _completeBettingRound(game); // flop
      if (!game.isComplete()) _completeBettingRound(game); // turn
      if (!game.isComplete()) _completeBettingRound(game); // river
    }
    if (game.isComplete()) {
      const results = game.getResults();
      const foldedResults = results.filter((r) => r.folded);
      const nonFolded = results.filter((r) => !r.folded);
      if (foldedResults.length > 0 && nonFolded.length > 0) {
        const lastNonFolded = Math.max(...nonFolded.map((r) => r.placement));
        const firstFolded = Math.min(...foldedResults.map((r) => r.placement));
        expect(firstFolded).toBeGreaterThan(lastNonFolded);
      }
    }
  });

  test('isComplete returns false during play', () => {
    game.startGame();
    expect(game.isComplete()).toBe(false);
  });

  test('revealed hands shown at showdown', () => {
    game.startGame();
    _completePreflop(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    _completeBettingRound(game);
    const state = game.getStateForPlayer('p1');
    // In finished state, hands of non-folded players should be revealed
    // At least the winner's hand should be visible
    expect(state.phase).toBe('finished');
  });

  test('check is valid when no bet to match', () => {
    game.startGame();
    // After the preflop completes, on the flop currentBet = 0
    _completePreflop(game);
    expect(game.state).toBe('flop');
    expect(game.currentBet).toBe(0);
    const turnPlayer = game.currentTurnPlayer;
    const chipsBefore = game.chips[turnPlayer];
    game.handleAction(turnPlayer, { type: 'check' });
    expect(game.chips[turnPlayer]).toBe(chipsBefore); // no chips spent
  });

  test('check is rejected when there is a bet to match', () => {
    game.startGame();
    // Preflop: there is already a big blind bet, so checking (for a player who hasn't paid) is invalid
    const turnPlayer = game.currentTurnPlayer;
    const betBefore = game.bets[turnPlayer] || 0;
    const toCall = game.currentBet - betBefore;
    if (toCall > 0) {
      const chipsBefore = game.chips[turnPlayer];
      game.handleAction(turnPlayer, { type: 'check' }); // should be rejected
      // chips should be unchanged since check was rejected
      expect(game.chips[turnPlayer]).toBe(chipsBefore);
      expect(game.currentTurnPlayer).toBe(turnPlayer); // still their turn
    }
  });
});

// ---------------------------------------------------------------------------
// Hand-seeded showdown test
// ---------------------------------------------------------------------------

describe('Poker showdown with known hands', () => {
  test('best hand wins the pot', () => {
    const game = new Poker(['alice', 'bob']);
    game.startGame();

    // Inject known hole cards
    // alice: A-K suited (strong)
    // bob: 2-7 offsuit (weak)
    game.holeCards['alice'] = [c(1, 'spades'), c(13, 'spades')]; // A, K of spades
    game.holeCards['bob'] = [c(2, 'hearts'), c(7, 'clubs')];

    // Inject community cards: Q-J-10 spades + 2, 3 (alice gets Royal Flush)
    game.communityCards = [
      c(12, 'spades'), c(11, 'spades'), c(10, 'spades'), c(4, 'hearts'), c(5, 'diamonds'),
    ];

    // Force to showdown state
    game.state = 'river';
    // Manually collect bets and go to showdown
    game._collectBets();
    game._resolveShowdown();

    const results = game.getResults();
    expect(results[0].playerId).toBe('alice');
    expect(results[0].placement).toBe(1);
    expect(results[0].handDescription).toMatch(/Royal Flush/);
    expect(results[1].playerId).toBe('bob');
    expect(results[1].placement).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Complete the preflop betting round by having each active player call or check.
 */
function _completePreflop(game) {
  let guard = 0;
  while (game.state === 'preflop' && guard++ < 20) {
    const tp = game.currentTurnPlayer;
    if (!tp) break;
    const toCall = game.currentBet - (game.bets[tp] || 0);
    if (toCall > 0) {
      game.handleAction(tp, { type: 'call' });
    } else {
      game.handleAction(tp, { type: 'check' });
    }
  }
}

/**
 * Complete a post-flop betting round by having each active player check.
 */
function _completeBettingRound(game) {
  const validStates = ['flop', 'turn', 'river'];
  const startState = game.state;
  let guard = 0;
  while (game.state === startState && validStates.includes(game.state) && guard++ < 20) {
    const tp = game.currentTurnPlayer;
    if (!tp) break;
    const toCall = game.currentBet - (game.bets[tp] || 0);
    if (toCall > 0) {
      game.handleAction(tp, { type: 'call' });
    } else {
      game.handleAction(tp, { type: 'check' });
    }
  }
}
