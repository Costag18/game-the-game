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
