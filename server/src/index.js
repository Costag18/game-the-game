import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import { EVENTS } from '../../shared/events.js';
import { LobbyManager } from './lobby/LobbyManager.js';
import { TournamentManager } from './tournament/TournamentManager.js';
import { Scorer } from './tournament/Scorer.js';
import { createGame, isGameRegistered } from './games/registry.js';
import { getEligibleGames } from '../../shared/gameList.js';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

const isProduction = process.env.NODE_ENV === 'production';

const io = new Server(httpServer, {
  cors: isProduction ? {} : {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

const lobbyManager = new LobbyManager();
const tournaments = new Map();

// Serve built React app in production
if (isProduction) {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

io.on(EVENTS.CONNECTION, (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on(EVENTS.SET_NICKNAME, (data, callback) => {
    const nickname = typeof data === 'string' ? data : data?.nickname;
    if (!nickname || typeof nickname !== 'string' || nickname.trim().length === 0) {
      if (typeof callback === 'function') callback({ error: 'Nickname is required' });
      return;
    }
    socket.data.nickname = nickname.trim();
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    if (lobbyId) {
      lobbyManager.setNickname(socket.id, nickname.trim());
      const lobby = lobbyManager.getLobby(lobbyId);
      io.to(lobbyId).emit(EVENTS.LOBBY_STATE, lobby);
    }
    if (typeof callback === 'function') callback({ success: true });
  });

  socket.on(EVENTS.LIST_LOBBIES, (callback) => {
    const lobbies = lobbyManager.listPublicLobbies();
    if (typeof callback === 'function') callback(lobbies);
  });

  socket.on(EVENTS.CREATE_LOBBY, (options, callback) => {
    try {
      const lobby = lobbyManager.createLobby(socket.id, options);
      if (socket.data.nickname) {
        lobbyManager.setNickname(socket.id, socket.data.nickname);
      }
      socket.join(lobby.id);
      if (typeof callback === 'function') callback({ success: true, lobby: lobbyManager.getLobby(lobby.id) });
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  socket.on(EVENTS.JOIN_LOBBY, ({ lobbyId, code }, callback) => {
    try {
      const lobby = lobbyManager.joinLobby(lobbyId, socket.id, code);
      if (socket.data.nickname) {
        lobbyManager.setNickname(socket.id, socket.data.nickname);
      }
      socket.join(lobbyId);
      const updated = lobbyManager.getLobby(lobbyId);
      io.to(lobbyId).emit(EVENTS.PLAYER_JOINED, {
        playerId: socket.id,
        nickname: socket.data.nickname || socket.id,
      });
      io.to(lobbyId).emit(EVENTS.LOBBY_STATE, updated);
      if (typeof callback === 'function') callback({ success: true, lobby: updated });
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  socket.on(EVENTS.JOIN_BY_CODE, (code, callback) => {
    try {
      const lobby = lobbyManager.findLobbyByCode(code);
      if (!lobby) throw new Error('No lobby found with that code');
      lobbyManager.joinLobby(lobby.id, socket.id, lobby.code);
      if (socket.data.nickname) {
        lobbyManager.setNickname(socket.id, socket.data.nickname);
      }
      socket.join(lobby.id);
      const updated = lobbyManager.getLobby(lobby.id);
      io.to(lobby.id).emit(EVENTS.PLAYER_JOINED, {
        playerId: socket.id,
        nickname: socket.data.nickname || socket.id,
      });
      io.to(lobby.id).emit(EVENTS.LOBBY_STATE, updated);
      if (typeof callback === 'function') callback({ success: true, lobby: updated });
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  socket.on(EVENTS.LEAVE_LOBBY, () => {
    handlePlayerLeave(socket);
  });

  socket.on(EVENTS.CHAT_SEND, (data) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    if (!lobbyId) return;
    const text = typeof data === 'string' ? data : data?.message;
    if (!text || !text.trim()) return;
    io.to(lobbyId).emit(EVENTS.CHAT_MESSAGE, {
      playerId: socket.id,
      nickname: socket.data.nickname || socket.id,
      message: text.trim(),
      timestamp: Date.now(),
    });
  });

  // --- Tournament Events ---

  socket.on(EVENTS.START_TOURNAMENT, () => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby || lobby.hostId !== socket.id) return;
    if (lobby.players.length < 2) return;

    lobbyManager.setStatus(lobbyId, 'playing');

    const tm = new TournamentManager({
      players: [...lobby.players],
      winCondition: lobby.winCondition,
      winTarget: lobby.winTarget,
    });
    tournaments.set(lobbyId, tm);

    tm.startNextRound();
    const eligible = shuffle(getEligibleGames(lobby.players.length));
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
    io.to(lobbyId).emit(EVENTS.ROUND_START, {
      round: tm.currentRound,
      eligibleGames: eligible,
    });
  });

  socket.on(EVENTS.VOTE_GAME, (gameId) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;

    tm.submitVote(socket.id, gameId);
    io.to(lobbyId).emit(EVENTS.VOTE_UPDATE, { votes: { ...tm.votes } });

    const lobby = lobbyManager.getLobby(lobbyId);
    if (Object.keys(tm.votes).length >= lobby.players.length) {
      const selectedGame = tm.tallyVotes();
      tm.startWagerPhase();
      io.to(lobbyId).emit(EVENTS.VOTE_RESULT, {
        selectedGame,
        playerCount: lobby.players.length,
        wagerReturns: Scorer.getWagerReturnTable(lobby.players.length),
      });
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
    }
  });

  socket.on(EVENTS.COIN_FLIP, ({ amount, choice }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;
    const lobby = lobbyManager.getLobby(lobbyId);

    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;
    if (choice !== 'heads' && choice !== 'tails') return;

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === choice;
    tm.scores[socket.id] += won ? amount : -amount;

    socket.emit(EVENTS.COIN_FLIP_RESULT, {
      result,
      won,
      amount,
      newScore: tm.scores[socket.id],
    });
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());

    // Check if gambling triggered a point threshold win
    if (tm.isTournamentOver()) {
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
      tournaments.delete(lobbyId);
      lobbyManager.setStatus(lobbyId, 'waiting');
    }
  });

  socket.on(EVENTS.SLOTS_SPIN, ({ amount }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;
    const lobby = lobbyManager.getLobby(lobbyId);

    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;

    const SYMBOLS = ['cherry', 'lemon', 'bar', 'seven', 'diamond', 'bell'];
    const reels = [
      SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
    ];

    let multiplier = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      multiplier = reels[0] === 'seven' ? 5 : 3;
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
      multiplier = 1.5;
    }

    const payout = Math.floor(amount * multiplier);
    tm.scores[socket.id] += payout - amount;

    socket.emit(EVENTS.SLOTS_RESULT, {
      reels,
      multiplier,
      wager: amount,
      payout,
      net: payout - amount,
      newScore: tm.scores[socket.id],
    });
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());

    // Check if gambling triggered a point threshold win
    if (tm.isTournamentOver()) {
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
      tournaments.delete(lobbyId);
      lobbyManager.setStatus(lobbyId, 'waiting');
    }
  });

  // --- Plinko ---
  socket.on(EVENTS.PLINKO_DROP, ({ amount }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;
    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;
    const lobby = lobbyManager.getLobby(lobbyId);

    // Simulate ball bouncing through 8 rows of pegs (left/right each row)
    const path = [];
    let offset = 0; // tracks how far right from center
    for (let row = 0; row < 8; row++) {
      const goRight = Math.random() < 0.5;
      offset += goRight ? 1 : -1;
      path.push(goRight ? 'R' : 'L');
    }
    // offset ranges from -8 to +8, map to slot 0-8
    const position = Math.min(8, Math.max(0, Math.round((offset + 8) / 2)));
    const PLINKO_MULTIPLIERS = [5, 2, 1.5, 1, 0.3, 1, 1.5, 2, 5];
    const multiplier = PLINKO_MULTIPLIERS[position];
    const payout = Math.floor(amount * multiplier);
    tm.scores[socket.id] += payout - amount;

    socket.emit(EVENTS.PLINKO_RESULT, {
      path, slot: position, multiplier, wager: amount, payout,
      net: payout - amount, newScore: tm.scores[socket.id],
    });
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
    if (tm.isTournamentOver()) {
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
      tournaments.delete(lobbyId);
      lobbyManager.setStatus(lobbyId, 'waiting');
    }
  });

  // --- Wheel of Fortune ---
  socket.on(EVENTS.WHEEL_SPIN, ({ amount }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;
    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;
    const lobby = lobbyManager.getLobby(lobbyId);

    const WHEEL_SEGMENTS = [0, 0.5, 1, 0.5, 2, 0.5, 1, 0.5, 3, 0.5, 1, 0.5, 5, 0.5, 1, 0.5, 10, 0.5, 1, 0.5];
    const segmentIndex = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
    const multiplier = WHEEL_SEGMENTS[segmentIndex];
    const payout = Math.floor(amount * multiplier);
    tm.scores[socket.id] += payout - amount;

    socket.emit(EVENTS.WHEEL_RESULT, {
      segmentIndex, multiplier, totalSegments: WHEEL_SEGMENTS.length,
      segments: WHEEL_SEGMENTS, wager: amount, payout,
      net: payout - amount, newScore: tm.scores[socket.id],
    });
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
    if (tm.isTournamentOver()) {
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
      tournaments.delete(lobbyId);
      lobbyManager.setStatus(lobbyId, 'waiting');
    }
  });

  // --- Blackjack Lite ---
  socket.on(EVENTS.BJ_LITE_START, ({ amount }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;
    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;

    // Deal cards (simple deck: 1-13, suit doesn't matter for BJ)
    function drawCard() { return Math.floor(Math.random() * 13) + 1; }
    function cardValue(c) { if (c === 1) return 11; if (c >= 10) return 10; return c; }
    function handTotal(cards) {
      let total = cards.reduce((s, c) => s + cardValue(c), 0);
      let aces = cards.filter((c) => c === 1).length;
      while (total > 21 && aces > 0) { total -= 10; aces--; }
      return total;
    }
    function cardName(c) {
      const names = {1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K'};
      return names[c] || String(c);
    }

    const playerCards = [drawCard(), drawCard()];
    const dealerCards = [drawCard(), drawCard()];

    // Store the hand in a temporary map on the tournament
    if (!tm._bjLiteHands) tm._bjLiteHands = {};
    tm._bjLiteHands[socket.id] = {
      playerCards, dealerCards, wager: amount, drawCard, handTotal, cardName, finished: false,
    };

    socket.emit(EVENTS.BJ_LITE_RESULT, {
      phase: 'playing',
      playerCards: playerCards.map(cardName),
      playerTotal: handTotal(playerCards),
      dealerShowing: cardName(dealerCards[0]),
      wager: amount,
    });
  });

  socket.on(EVENTS.BJ_LITE_ACTION, ({ action }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;
    if (!tm._bjLiteHands?.[socket.id]) return;
    const lobby = lobbyManager.getLobby(lobbyId);

    const hand = tm._bjLiteHands[socket.id];
    if (hand.finished) return;
    const { playerCards, dealerCards, wager, drawCard, handTotal, cardName } = hand;

    if (action === 'hit') {
      playerCards.push(drawCard());
      if (handTotal(playerCards) > 21) {
        // Bust
        hand.finished = true;
        tm.scores[socket.id] -= wager;
        socket.emit(EVENTS.BJ_LITE_RESULT, {
          phase: 'finished',
          playerCards: playerCards.map(cardName),
          playerTotal: handTotal(playerCards),
          dealerCards: dealerCards.map(cardName),
          dealerTotal: handTotal(dealerCards),
          result: 'bust', net: -wager, newScore: tm.scores[socket.id],
        });
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
        delete tm._bjLiteHands[socket.id];
        if (tm.isTournamentOver()) {
          io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
          tournaments.delete(lobbyId);
          lobbyManager.setStatus(lobbyId, 'waiting');
        }
        return;
      }
      socket.emit(EVENTS.BJ_LITE_RESULT, {
        phase: 'playing',
        playerCards: playerCards.map(cardName),
        playerTotal: handTotal(playerCards),
        dealerShowing: cardName(dealerCards[0]),
        wager,
      });
    } else if (action === 'stand') {
      // Dealer plays
      while (handTotal(dealerCards) < 17) dealerCards.push(drawCard());
      const pTotal = handTotal(playerCards);
      const dTotal = handTotal(dealerCards);
      hand.finished = true;

      let result, net;
      if (dTotal > 21 || pTotal > dTotal) {
        result = 'win'; net = wager;
      } else if (pTotal === dTotal) {
        result = 'push'; net = 0;
      } else {
        result = 'lose'; net = -wager;
      }
      tm.scores[socket.id] += net;

      socket.emit(EVENTS.BJ_LITE_RESULT, {
        phase: 'finished',
        playerCards: playerCards.map(cardName),
        playerTotal: pTotal,
        dealerCards: dealerCards.map(cardName),
        dealerTotal: dTotal,
        result, net, newScore: tm.scores[socket.id],
      });
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
      delete tm._bjLiteHands[socket.id];
      if (tm.isTournamentOver()) {
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
        tournaments.delete(lobbyId);
        lobbyManager.setStatus(lobbyId, 'waiting');
      }
    }
  });

  // --- Chicken Cross ---
  socket.on(EVENTS.CHICKEN_START, ({ amount }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;
    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;

    // Start a chicken run — store state on tournament
    if (!tm._chickenGames) tm._chickenGames = {};
    // Each lane has an independent chance of crashing. Later lanes are riskier.
    // Lane survival odds: ~90%, 85%, 80%, 70%, 60%, 50%, 40%, 30%
    // crashStep = 9 means survived all lanes (possible to reach 6x)
    const LANE_SURVIVE = [0.90, 0.85, 0.80, 0.70, 0.60, 0.50, 0.40, 0.30];
    let crashStep = 9; // default: survive everything
    for (let i = 0; i < LANE_SURVIVE.length; i++) {
      if (Math.random() > LANE_SURVIVE[i]) {
        crashStep = i + 1;
        break;
      }
    }
    tm._chickenGames[socket.id] = { wager: amount, step: 0, crashStep, alive: true };

    socket.emit(EVENTS.CHICKEN_RESULT, {
      phase: 'playing', step: 0, multiplier: 1.0, wager: amount, alive: true,
    });
  });

  socket.on(EVENTS.CHICKEN_ACTION, ({ action }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'voting') return;
    if (!tm._chickenGames?.[socket.id]) return;
    const lobby = lobbyManager.getLobby(lobbyId);

    const game = tm._chickenGames[socket.id];
    if (!game.alive) return;

    // Multiplier per step: 1.2x, 1.5x, 1.8x, 2.2x, 2.8x, 3.5x, 4.5x, 6x
    const MULTIPLIERS = [1.0, 1.2, 1.5, 1.8, 2.2, 2.8, 3.5, 4.5, 6.0];

    if (action === 'cross') {
      game.step++;
      if (game.step >= game.crashStep) {
        // Hit! Lose wager
        game.alive = false;
        tm.scores[socket.id] -= game.wager;
        socket.emit(EVENTS.CHICKEN_RESULT, {
          phase: 'finished', step: game.step, multiplier: 0,
          wager: game.wager, net: -game.wager, alive: false,
          crashStep: game.crashStep, newScore: tm.scores[socket.id],
        });
        delete tm._chickenGames[socket.id];
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
        if (tm.isTournamentOver()) {
          io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
          tournaments.delete(lobbyId);
          lobbyManager.setStatus(lobbyId, 'waiting');
        }
      } else {
        // Safe! Send updated state
        const mult = MULTIPLIERS[Math.min(game.step, MULTIPLIERS.length - 1)];
        socket.emit(EVENTS.CHICKEN_RESULT, {
          phase: 'playing', step: game.step, multiplier: mult,
          wager: game.wager, alive: true,
        });
      }
    } else if (action === 'cashout') {
      // Cash out at current multiplier
      const mult = MULTIPLIERS[Math.min(game.step, MULTIPLIERS.length - 1)];
      const payout = Math.floor(game.wager * mult);
      const net = payout - game.wager;
      tm.scores[socket.id] += net;
      socket.emit(EVENTS.CHICKEN_RESULT, {
        phase: 'finished', step: game.step, multiplier: mult,
        wager: game.wager, payout, net, alive: true,
        newScore: tm.scores[socket.id],
      });
      delete tm._chickenGames[socket.id];
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
      if (tm.isTournamentOver()) {
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
        tournaments.delete(lobbyId);
        lobbyManager.setStatus(lobbyId, 'waiting');
      }
    }
  });

  socket.on(EVENTS.WAGER_SUBMIT, (amount) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'wagering') return;

    try {
      tm.submitWager(socket.id, amount);
    } catch (err) {
      socket.emit(EVENTS.GAME_ERROR, { message: err.message });
      return;
    }

    const lobby = lobbyManager.getLobby(lobbyId);
    if (tm.allWagersIn()) {
      tm.startPlaying();
      io.to(lobbyId).emit(EVENTS.WAGER_LOCKED, { wagers: { ...tm.wagers } });

      if (isGameRegistered(tm.selectedGame)) {
        const game = createGame(tm.selectedGame, lobby.players);
        tm.activeGame = game;

        // Set up timer-driven state broadcast for games that need it
        if (typeof game.setOnStateChange === 'function') {
          game.setOnStateChange(() => {
            const currentLobby = lobbyManager.getLobby(lobbyId);
            if (!currentLobby) return;
            const nicks = currentLobby.nicknames || {};
            for (const pid of currentLobby.players) {
              const ps = io.sockets.sockets.get(pid);
              if (ps) {
                ps.emit(EVENTS.GAME_STATE, {
                  gameId: tm.selectedGame,
                  state: game.getStateForPlayer(pid),
                  nicknames: nicks,
                });
              }
            }
            // Check if game completed from timer
            if (game.isComplete()) {
              const results = game.getResults();
              const placements = results.map((r) => r.playerId);
              tm.activeGame = null;
              const roundScores = tm.completeRound(placements, results);
              io.to(lobbyId).emit(EVENTS.GAME_COMPLETE, { results });
              io.to(lobbyId).emit(EVENTS.ROUND_RESULTS, {
                placements,
                scores: roundScores,
                gameId: tm.selectedGame,
                standings: tm.getStandings().map((s) => ({
                  ...s,
                  nickname: currentLobby.nicknames?.[s.playerId] || s.playerId.slice(0, 8),
                })),
                gameResults: results,
              });
              io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
            }
          });
        }

        game.startGame();

        // Check if game completed immediately (e.g., roulette all players broke)
        if (game.isComplete()) {
          const results = game.getResults();
          const placements = results.map((r) => r.playerId);
          tm.activeGame = null;
          const roundScores = tm.completeRound(placements, results);

          io.to(lobbyId).emit(EVENTS.GAME_COMPLETE, { results });
          io.to(lobbyId).emit(EVENTS.ROUND_RESULTS, {
            placements,
            scores: roundScores,
            gameId: tm.selectedGame,
            standings: tm.getStandings().map((s) => ({
              ...s,
              nickname: lobby.nicknames?.[s.playerId] || s.playerId.slice(0, 8),
            })),
            gameResults: results,
          });
          io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
        } else {
          const nicknames = lobby.nicknames || {};
          for (const playerId of lobby.players) {
            const playerSocket = io.sockets.sockets.get(playerId);
            if (playerSocket) {
              playerSocket.emit(EVENTS.GAME_STATE, {
                gameId: tm.selectedGame,
                state: game.getStateForPlayer(playerId),
                nicknames,
              });
            }
          }
        }
      } else {
        // Game not yet implemented — random placements
        const shuffled = [...lobby.players].sort(() => Math.random() - 0.5);
        const roundScores = tm.completeRound(shuffled);
        io.to(lobbyId).emit(EVENTS.ROUND_RESULTS, {
          placements: shuffled,
          scores: roundScores,
          gameId: tm.selectedGame,
          standings: tm.getStandings().map((s) => ({
            ...s,
            nickname: lobby.nicknames?.[s.playerId] || s.playerId.slice(0, 8),
          })),
          gameResults: null,
        });
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());

        if (tm.isTournamentOver()) {
          io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
          tournaments.delete(lobbyId);
          lobbyManager.setStatus(lobbyId, 'waiting');
        }
      }
    }
  });

  socket.on(EVENTS.NEXT_ROUND, () => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || tm.phase !== 'results') return;
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return;

    // Track who has acknowledged
    if (!tm.resultsAcknowledged) tm.resultsAcknowledged = new Set();
    tm.resultsAcknowledged.add(socket.id);

    // Wait for all players
    if (!lobby.players.every((p) => tm.resultsAcknowledged.has(p))) return;
    tm.resultsAcknowledged = null;

    if (tm.isTournamentOver()) {
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
      tournaments.delete(lobbyId);
      lobbyManager.setStatus(lobbyId, 'waiting');
    } else {
      tm.startNextRound();
      const eligible = getEligibleGames(lobby.players.length);
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
      io.to(lobbyId).emit(EVENTS.ROUND_START, {
        round: tm.currentRound,
        eligibleGames: eligible,
      });
    }
  });

  socket.on(EVENTS.GAME_ACTION, (action) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || !tm.activeGame) return;

    const game = tm.activeGame;
    try {
      game.handleAction(socket.id, action);
    } catch (err) {
      socket.emit(EVENTS.GAME_ERROR, { message: err.message });
      return;
    }

    const lobby = lobbyManager.getLobby(lobbyId);
    const nicknames = lobby.nicknames || {};
    for (const playerId of lobby.players) {
      const playerSocket = io.sockets.sockets.get(playerId);
      if (playerSocket) {
        playerSocket.emit(EVENTS.GAME_STATE, {
          gameId: tm.selectedGame,
          state: game.getStateForPlayer(playerId),
          nicknames,
        });
      }
    }

    if (game.isComplete()) {
      const results = game.getResults();
      const placements = results.map((r) => r.playerId);
      tm.activeGame = null;
      const roundScores = tm.completeRound(placements, results);

      io.to(lobbyId).emit(EVENTS.GAME_COMPLETE, { results });

      // Delay round results for games with reveals (e.g., Hangman word reveal)
      const revealDelay = tm.selectedGame === 'hangman' ? 5000 : 0;
      const emitRoundEnd = () => {
        io.to(lobbyId).emit(EVENTS.ROUND_RESULTS, {
          placements,
          scores: roundScores,
          gameId: tm.selectedGame,
          standings: tm.getStandings().map((s) => ({
            ...s,
            nickname: lobby.nicknames?.[s.playerId] || s.playerId.slice(0, 8),
          })),
          gameResults: results,
        });
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
      };

      if (revealDelay > 0) {
        setTimeout(emitRoundEnd, revealDelay);
      } else {
        emitRoundEnd();
      }
    }
  });

  socket.on(EVENTS.DISCONNECT, () => {
    console.log(`Player disconnected: ${socket.id}`);
    handlePlayerLeave(socket);
  });
});

function buildTournamentEndPayload(tm, lobby) {
  return {
    winner: lobby.nicknames?.[tm.getWinner()] || tm.getWinner().slice(0, 8),
    standings: tm.getStandings().map((s) => ({
      ...s,
      nickname: lobby.nicknames?.[s.playerId] || s.playerId.slice(0, 8),
    })),
    roundHistory: tm.roundHistory,
  };
}

function handlePlayerLeave(socket) {
  const lobbyId = lobbyManager.getPlayerLobby(socket.id);
  if (!lobbyId) return;
  const lobby = lobbyManager.leaveLobby(lobbyId, socket.id);
  socket.leave(lobbyId);
  if (lobby) {
    io.to(lobbyId).emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
    io.to(lobbyId).emit(EVENTS.LOBBY_STATE, lobby);
  }
}

// Catch-all: serve React app for any non-API route in production
if (isProduction) {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { io, app, httpServer, lobbyManager, tournaments };
