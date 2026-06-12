import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { RansomNote } from '../src/games/RansomNote.js';

installClock();

function newGame(players) {
  const g = new RansomNote(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const entryId = (g, p) => g.gallery.find((e) => e.authorId === p).entryId;

test('starts in draw, deals private hands + arms a draw timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'draw');
  assert(g.word, 'a secret word was picked');
  for (const p of ['a', 'b', 'c']) eq(g.hands[p].length, 12);
  assert(pendingTimers() >= 1, 'draw timer armed');
});

test('a submitted note is validated (in-hand, length) + stored', () => {
  const g = newGame(['a', 'b', 'c']);
  const hand = g.hands['a'];
  // too short → rejected
  g.handleAction('a', { type: 'submit', emojis: [hand[0], hand[1]] });
  eq(g.notes['a'], undefined);
  // too long (6) → rejected
  g.handleAction('a', { type: 'submit', emojis: hand.slice(0, 6) });
  eq(g.notes['a'], undefined);
  // emoji not in hand → rejected
  g.handleAction('a', { type: 'submit', emojis: [hand[0], hand[1], '🚫🚫NOTINHAND'] });
  eq(g.notes['a'], undefined);
  // valid 3-emoji note → stored
  const good = hand.slice(0, 3);
  g.handleAction('a', { type: 'submit', emojis: good });
  eq(JSON.stringify(g.notes['a']), JSON.stringify(good));
});

test('hand/note are private — another player never sees them in draw', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', emojis: g.hands['a'].slice(0, 4) });
  const sB = g.getStateForPlayer('b');
  // b only ever gets its own hand
  eq(JSON.stringify(sB.myHand), JSON.stringify(g.hands['b']));
  // a's hand + a's note must NOT appear anywhere in b's view
  const blob = JSON.stringify(sB);
  assert(!blob.includes(JSON.stringify(g.hands['a'])), "a's hand not leaked to b");
  assert(!blob.includes(JSON.stringify(g.notes['a'])), "a's note not leaked to b");
  // no anonymous gallery during draw either
  eq(sB.gallery, null);
});

test('all notes submitted advances to vote; gallery is anonymous (no authorId)', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
  eq(g.state, 'vote');
  const s = g.getStateForPlayer('a');
  eq(s.gallery.length, 3);
  for (const e of s.gallery) {
    assert(!('authorId' in e), 'authorId hidden in voting gallery');
    assert(Array.isArray(e.emojis), 'note emojis present');
  }
  assert(s.gallery.some((e) => e.isMine), 'my own note flagged isMine');
  // votes/authors not leaked pre-reveal
  assert(s.reveal == null, 'no reveal data during voting');
});

test('cannot vote your own note', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
  const mine = entryId(g, 'a');
  g.handleAction('a', { type: 'vote', entryId: mine });
  eq(g.votes['a'], undefined);
});

test('scoring: score = votes received; reveal discloses word + authors + voters', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const p of ['a', 'b', 'c', 'd']) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
  const aEntry = entryId(g, 'a');
  // b, c, d all vote a's note → a gets 3 votes; a votes b
  g.handleAction('b', { type: 'vote', entryId: aEntry });
  g.handleAction('c', { type: 'vote', entryId: aEntry });
  g.handleAction('d', { type: 'vote', entryId: aEntry });
  g.handleAction('a', { type: 'vote', entryId: entryId(g, 'b') });
  eq(g.state, 'reveal');
  eq(g.scores['a'], 3);
  eq(g.scores['b'], 1);
  // reveal discloses word, authors, voters
  eq(g.revealData.word, g.word);
  const rev = g.revealData.entries.find((e) => e.entryId === aEntry);
  eq(rev.authorId, 'a');
  eq(rev.votes, 3);
  eq(rev.voters.length, 3);
});

test('word hidden from a guesser... well, word shown at vote/reveal but votes hidden pre-reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
  // during vote: word IS shown (so players can judge), but who-voted-what is NOT
  g.handleAction('a', { type: 'vote', entryId: entryId(g, 'b') });
  const s = g.getStateForPlayer('c');
  eq(s.word, g.word);
  // c hasn't voted; the gallery entries carry no vote counts / voters
  for (const e of s.gallery) {
    assert(!('votes' in e), 'no live vote tally exposed during voting');
    assert(!('voters' in e), 'no live voter list exposed during voting');
  }
});

function playFull(players, voteStrategy) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'draw') {
      for (const p of g.players) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
    } else if (g.state === 'vote') {
      voteStrategy(g);
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const n of [3, 4]) {
  test(`full ${n}-player game finishes; results rank all N, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, n);
    // everyone votes the first player after themselves in the gallery → 'a' tends to win
    const g = playFull(players, (gg) => {
      for (const p of gg.players) {
        const choice = gg.gallery.find((e) => e.authorId !== p);
        gg.handleAction(p, { type: 'vote', entryId: choice.entryId });
      }
    });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    // sorted DESC
    for (let i = 1; i < res.length; i++) assert(res[i].score <= res[i - 1].score, 'sorted desc');
  });
}

test('a tie shares a placement', () => {
  // Nobody votes (auto-vote on timeout is random, so force a deterministic tie:
  // construct a symmetric vote where everyone receives exactly one vote).
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'draw') {
      for (const p of g.players) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
    } else if (g.state === 'vote') {
      // a->b, b->c, c->a : each receives exactly 1 vote → perfect tie
      const ids = Object.fromEntries(g.players.map((p) => [p, entryId(g, p)]));
      g.handleAction('a', { type: 'vote', entryId: ids['b'] });
      g.handleAction('b', { type: 'vote', entryId: ids['c'] });
      g.handleAction('c', { type: 'vote', entryId: ids['a'] });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  assert(res.every((r) => r.placement === 1), 'all tied at placement 1');
});

test('draw barrier advances on the timer (auto-notes for non-submitters)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', emojis: g.hands['a'].slice(0, 3) });
  const before = g.emitCount;
  advance(50_000);
  eq(g.state, 'vote');
  assert(g.notes['b'] && g.notes['c'], 'missing players got auto-notes');
  assert(g.emitCount > before, 'broadcast on draw timeout');
});

test('vote timeout auto-votes everyone and advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
  const before = g.emitCount;
  advance(35_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on vote timeout');
});

test('reveal timeout auto-acks and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'vote', entryId: g.gallery.find((e) => e.authorId !== p).entryId });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(50_000);
  assert(g.state === 'draw' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('leave during draw (last owing) advances to vote; leaver not ranked', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', emojis: g.hands['a'].slice(0, 3) });
  g.handleAction('b', { type: 'submit', emojis: g.hands['b'].slice(0, 3) });
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'vote');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during voting keeps the orphan note in the gallery, advances', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const p of ['a', 'b', 'c', 'd']) g.handleAction(p, { type: 'submit', emojis: g.hands[p].slice(0, 3) });
  const cEntry = entryId(g, 'c');
  g.handleAction('a', { type: 'vote', entryId: cEntry }); // a votes c's note
  g.removePlayer('c'); // c leaves mid-vote
  g.handleAction('b', { type: 'vote', entryId: entryId(g, 'a') });
  g.handleAction('d', { type: 'vote', entryId: entryId(g, 'a') });
  eq(g.state, 'reveal');
  const opt = g.revealData.entries.find((e) => e.entryId === cEntry);
  assert(opt, 'orphan note still in gallery');
  assert(!g.players.includes('c'), 'leaver pruned');
});

test('collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('RansomNote');
