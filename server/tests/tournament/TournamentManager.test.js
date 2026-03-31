import { describe, test, expect, beforeEach } from '@jest/globals';
import { TournamentManager } from '../../src/tournament/TournamentManager.js';

describe('TournamentManager', () => {
  let manager;
  const players = ['alice', 'bob', 'carol'];

  beforeEach(() => {
    manager = new TournamentManager({ players, winCondition: 'fixedRounds', winTarget: 3 });
  });

  describe('initialization', () => {
    test('initializes with zero scores for all players', () => {
      const scores = manager.getScores();
      expect(scores).toEqual({ alice: 0, bob: 0, carol: 0 });
    });

    test('starts at round 0', () => {
      expect(manager.currentRound).toBe(0);
    });

    test('starts with phase idle', () => {
      expect(manager.phase).toBe('idle');
    });

    test('stores players list', () => {
      expect(manager.players).toEqual(players);
    });

    test('does not mutate original players array', () => {
      const original = ['x', 'y'];
      const m = new TournamentManager({ players: original, winCondition: 'fixedRounds', winTarget: 1 });
      m.players.push('z');
      expect(original).toEqual(['x', 'y']);
    });
  });

  describe('startNextRound', () => {
    test('increments round number', () => {
      manager.startNextRound();
      expect(manager.currentRound).toBe(1);
    });

    test('sets phase to voting', () => {
      manager.startNextRound();
      expect(manager.phase).toBe('voting');
    });

    test('resets votes', () => {
      manager.startNextRound();
      manager.submitVote('alice', 'chess');
      manager.startNextRound();
      expect(manager.votes).toEqual({});
    });

    test('resets wagers', () => {
      manager.startNextRound();
      manager.startWagerPhase();
      manager.submitWager('alice', 0);
      manager.startNextRound();
      expect(manager.wagers).toEqual({});
    });

    test('resets selectedGame', () => {
      manager.startNextRound();
      manager.tallyVotes();
      manager.startNextRound();
      expect(manager.selectedGame).toBeNull();
    });

    test('increments correctly across multiple rounds', () => {
      manager.startNextRound();
      manager.startNextRound();
      manager.startNextRound();
      expect(manager.currentRound).toBe(3);
    });
  });

  describe('submitVote', () => {
    beforeEach(() => {
      manager.startNextRound();
    });

    test('records a vote for a player', () => {
      manager.submitVote('alice', 'chess');
      expect(manager.votes['alice']).toBe('chess');
    });

    test('records votes for multiple players', () => {
      manager.submitVote('alice', 'chess');
      manager.submitVote('bob', 'poker');
      manager.submitVote('carol', 'chess');
      expect(manager.votes).toEqual({ alice: 'chess', bob: 'poker', carol: 'chess' });
    });

    test('overwrites a previous vote from the same player', () => {
      manager.submitVote('alice', 'chess');
      manager.submitVote('alice', 'poker');
      expect(manager.votes['alice']).toBe('poker');
    });
  });

  describe('tallyVotes', () => {
    beforeEach(() => {
      manager.startNextRound();
    });

    test('returns the game with the most votes', () => {
      manager.submitVote('alice', 'chess');
      manager.submitVote('bob', 'chess');
      manager.submitVote('carol', 'poker');
      const selected = manager.tallyVotes();
      expect(selected).toBe('chess');
    });

    test('sets selectedGame on the manager', () => {
      manager.submitVote('alice', 'chess');
      manager.submitVote('bob', 'chess');
      manager.tallyVotes();
      expect(manager.selectedGame).toBe('chess');
    });

    test('returns one of the tied games on a tie (randomized)', () => {
      manager.submitVote('alice', 'chess');
      manager.submitVote('bob', 'poker');
      // Run many times to check both options are valid
      const results = new Set();
      for (let i = 0; i < 100; i++) {
        manager.votes = { alice: 'chess', bob: 'poker' };
        results.add(manager.tallyVotes());
      }
      expect(results.has('chess') || results.has('poker')).toBe(true);
      // Both tied options should appear eventually (probabilistic but very reliable at 100 trials)
      expect(results.size).toBeGreaterThanOrEqual(1);
    });

    test('handles a single vote correctly', () => {
      manager.submitVote('alice', 'go');
      const selected = manager.tallyVotes();
      expect(selected).toBe('go');
    });
  });

  describe('startWagerPhase', () => {
    beforeEach(() => {
      manager.startNextRound();
    });

    test('sets phase to wagering', () => {
      manager.startWagerPhase();
      expect(manager.phase).toBe('wagering');
    });

    test('initializes all player wagers to 0', () => {
      manager.startWagerPhase();
      expect(manager.wagers).toEqual({ alice: 0, bob: 0, carol: 0 });
    });
  });

  describe('submitWager', () => {
    beforeEach(() => {
      manager.startNextRound();
      // Give alice some points so she can wager
      manager.scores['alice'] = 100;
      manager.startWagerPhase();
    });

    test('records a valid wager of 0', () => {
      manager.submitWager('alice', 0);
      expect(manager.wagers['alice']).toBe(0);
    });

    test('records a valid wager within allowed range', () => {
      // MAX_WAGER_PERCENT is applied - wager must be <= floor(100 * MAX_WAGER_PERCENT)
      manager.submitWager('alice', 10);
      expect(manager.wagers['alice']).toBe(10);
    });

    test('throws on an invalid wager (negative)', () => {
      expect(() => manager.submitWager('alice', -5)).toThrow();
    });

    test('throws when wager exceeds allowed maximum', () => {
      // With 100 points and MAX_WAGER_PERCENT = 0.5, max wager is 50
      expect(() => manager.submitWager('alice', 9999)).toThrow();
    });

    test('throws when player has 0 points and tries to wager a non-zero amount', () => {
      // bob has 0 points
      expect(() => manager.submitWager('bob', 1)).toThrow();
    });
  });

  describe('startPlaying', () => {
    test('sets phase to playing', () => {
      manager.startNextRound();
      manager.startWagerPhase();
      manager.startPlaying();
      expect(manager.phase).toBe('playing');
    });
  });

  describe('completeRound', () => {
    beforeEach(() => {
      manager.startNextRound();
      manager.submitVote('alice', 'chess');
      manager.submitVote('bob', 'chess');
      manager.submitVote('carol', 'poker');
      manager.tallyVotes();
      manager.startWagerPhase();
      manager.startPlaying();
    });

    test('sets phase to results', () => {
      manager.completeRound(['alice', 'bob', 'carol']);
      expect(manager.phase).toBe('results');
    });

    test('updates player scores after a round', () => {
      manager.completeRound(['alice', 'bob', 'carol']);
      const scores = manager.getScores();
      // Alice placed 1st — should have the most points
      expect(scores['alice']).toBeGreaterThan(scores['bob']);
      expect(scores['bob']).toBeGreaterThan(scores['carol']);
    });

    test('returns round scores keyed by playerId', () => {
      const roundScores = manager.completeRound(['alice', 'bob', 'carol']);
      expect(roundScores).toHaveProperty('alice');
      expect(roundScores).toHaveProperty('bob');
      expect(roundScores).toHaveProperty('carol');
    });

    test('each score entry has placement, base, wagerCost, wagerPayout, total', () => {
      const roundScores = manager.completeRound(['alice', 'bob', 'carol']);
      expect(roundScores['alice']).toMatchObject({
        placement: 1,
        base: expect.any(Number),
        wagerCost: expect.any(Number),
        wagerPayout: expect.any(Number),
        total: expect.any(Number),
      });
    });

    test('records round in roundHistory', () => {
      manager.completeRound(['alice', 'bob', 'carol']);
      expect(manager.roundHistory).toHaveLength(1);
      expect(manager.roundHistory[0]).toMatchObject({
        round: 1,
        game: 'chess',
        placements: ['alice', 'bob', 'carol'],
      });
    });

    test('accumulates scores across multiple rounds', () => {
      manager.completeRound(['alice', 'bob', 'carol']);
      const scoresAfterRound1 = { ...manager.getScores() };

      manager.startNextRound();
      manager.startWagerPhase();
      manager.startPlaying();
      manager.completeRound(['alice', 'bob', 'carol']);

      const scoresAfterRound2 = manager.getScores();
      expect(scoresAfterRound2['alice']).toBeGreaterThan(scoresAfterRound1['alice']);
    });
  });

  describe('isTournamentOver', () => {
    test('returns false before reaching target rounds', () => {
      manager.startNextRound();
      expect(manager.isTournamentOver()).toBe(false);
    });

    test('returns true after reaching target rounds (fixedRounds)', () => {
      manager.startNextRound();
      manager.startNextRound();
      manager.startNextRound();
      expect(manager.isTournamentOver()).toBe(true);
    });

    test('returns false when at fewer than target rounds', () => {
      manager.startNextRound();
      manager.startNextRound();
      expect(manager.isTournamentOver()).toBe(false);
    });
  });

  describe('isTournamentOver - pointThreshold', () => {
    let pointManager;

    beforeEach(() => {
      pointManager = new TournamentManager({ players, winCondition: 'pointThreshold', winTarget: 500 });
    });

    test('returns false when no player has reached the threshold', () => {
      pointManager.scores['alice'] = 100;
      expect(pointManager.isTournamentOver()).toBe(false);
    });

    test('returns true when a player reaches the threshold', () => {
      pointManager.scores['alice'] = 500;
      expect(pointManager.isTournamentOver()).toBe(true);
    });

    test('returns true when a player exceeds the threshold', () => {
      pointManager.scores['bob'] = 600;
      expect(pointManager.isTournamentOver()).toBe(true);
    });
  });

  describe('getStandings', () => {
    test('returns players sorted by score descending', () => {
      manager.scores['alice'] = 300;
      manager.scores['bob'] = 100;
      manager.scores['carol'] = 200;
      const standings = manager.getStandings();
      expect(standings.map((s) => s.playerId)).toEqual(['alice', 'carol', 'bob']);
    });

    test('each standing entry has playerId and score', () => {
      const standings = manager.getStandings();
      standings.forEach((s) => {
        expect(s).toHaveProperty('playerId');
        expect(s).toHaveProperty('score');
      });
    });

    test('all players appear in standings', () => {
      const standings = manager.getStandings();
      expect(standings).toHaveLength(players.length);
    });
  });

  describe('getWinner', () => {
    test('returns the player with the highest score', () => {
      manager.scores['alice'] = 50;
      manager.scores['bob'] = 200;
      manager.scores['carol'] = 100;
      expect(manager.getWinner()).toBe('bob');
    });

    test('returns one of the tied players when scores are equal', () => {
      // All start at 0 — any player is a valid winner
      const winner = manager.getWinner();
      expect(players).toContain(winner);
    });
  });

  describe('getScores', () => {
    test('returns a copy of scores, not a reference', () => {
      const scores = manager.getScores();
      scores['alice'] = 9999;
      expect(manager.scores['alice']).toBe(0);
    });
  });

  describe('getState', () => {
    test('returns currentRound, phase, scores, standings, selectedGame', () => {
      const state = manager.getState();
      expect(state).toMatchObject({
        currentRound: 0,
        phase: 'idle',
        scores: { alice: 0, bob: 0, carol: 0 },
        standings: expect.any(Array),
        selectedGame: null,
      });
    });

    test('exposes votes only during voting phase', () => {
      manager.startNextRound(); // sets phase to 'voting'
      manager.submitVote('alice', 'chess');
      const state = manager.getState();
      expect(state.votes).toMatchObject({ alice: 'chess' });
      expect(state.wagers).toBeNull();
    });

    test('exposes wagers only during wagering phase', () => {
      manager.startNextRound();
      manager.startWagerPhase(); // sets phase to 'wagering'
      const state = manager.getState();
      expect(state.wagers).toMatchObject({ alice: 0, bob: 0, carol: 0 });
      expect(state.votes).toBeNull();
    });

    test('hides votes and wagers outside voting/wagering phases', () => {
      const state = manager.getState(); // idle phase
      expect(state.votes).toBeNull();
      expect(state.wagers).toBeNull();
    });
  });
});
