import { describe, test, expect, beforeEach } from '@jest/globals';
import { Deck } from '../../src/utils/Deck.js';

describe('Deck', () => {
  let deck;

  beforeEach(() => {
    deck = new Deck();
  });

  test('starts with 52 cards', () => {
    expect(deck.remaining()).toBe(52);
  });

  test('each card has a suit and rank', () => {
    const validSuits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const validRanks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    for (const card of deck.cards) {
      expect(validSuits).toContain(card.suit);
      expect(validRanks).toContain(card.rank);
    }
  });

  test('has all 52 unique suit+rank combinations', () => {
    const keys = deck.cards.map(c => `${c.suit}-${c.rank}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(52);
  });

  test('deal removes one card and returns it', () => {
    const card = deck.deal();
    expect(card).not.toBeNull();
    expect(card).toHaveProperty('suit');
    expect(card).toHaveProperty('rank');
    expect(deck.remaining()).toBe(51);
  });

  test('deal from empty deck returns null', () => {
    for (let i = 0; i < 52; i++) deck.deal();
    expect(deck.deal()).toBeNull();
    expect(deck.remaining()).toBe(0);
  });

  test('dealMultiple returns the correct count of cards', () => {
    const hand = deck.dealMultiple(5);
    expect(hand).toHaveLength(5);
    expect(deck.remaining()).toBe(47);
  });

  test('dealMultiple stops at available cards when count exceeds remaining', () => {
    const hand = deck.dealMultiple(60);
    expect(hand).toHaveLength(52);
    expect(deck.remaining()).toBe(0);
  });

  test('shuffle changes card order (probabilistically)', () => {
    const before = deck.cards.map(c => `${c.suit}-${c.rank}`).join(',');
    deck.shuffle();
    const after = deck.cards.map(c => `${c.suit}-${c.rank}`).join(',');
    // It's astronomically unlikely for 52 cards to shuffle to the same order
    expect(before).not.toBe(after);
  });

  test('shuffle returns the deck for chaining', () => {
    expect(deck.shuffle()).toBe(deck);
  });

  test('shuffle does not change the count', () => {
    deck.shuffle();
    expect(deck.remaining()).toBe(52);
  });

  test('reset restores deck to 52 cards after dealing', () => {
    deck.dealMultiple(10);
    expect(deck.remaining()).toBe(42);
    deck.reset();
    expect(deck.remaining()).toBe(52);
  });

  test('reset restores all 52 unique combinations', () => {
    deck.dealMultiple(10);
    deck.reset();
    const keys = deck.cards.map(c => `${c.suit}-${c.rank}`);
    expect(new Set(keys).size).toBe(52);
  });
});
