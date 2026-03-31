import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { EVENTS } from '../../shared/events.js';
import { LobbyManager } from './lobby/LobbyManager.js';
import { TournamentManager } from './tournament/TournamentManager.js';
import { createGame, isGameRegistered } from './games/registry.js';
import { getEligibleGames } from '../../shared/gameList.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

const lobbyManager = new LobbyManager();
const tournaments = new Map();

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
      socket.join(lobby.id);
      if (typeof callback === 'function') callback({ success: true, lobby });
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  socket.on(EVENTS.JOIN_LOBBY, ({ lobbyId, code }, callback) => {
    try {
      const lobby = lobbyManager.joinLobby(lobbyId, socket.id, code);
      socket.join(lobbyId);
      io.to(lobbyId).emit(EVENTS.PLAYER_JOINED, {
        playerId: socket.id,
        nickname: socket.data.nickname || socket.id,
      });
      io.to(lobbyId).emit(EVENTS.LOBBY_STATE, lobby);
      if (typeof callback === 'function') callback({ success: true, lobby });
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  socket.on(EVENTS.JOIN_BY_CODE, (code, callback) => {
    try {
      const lobby = lobbyManager.findLobbyByCode(code);
      if (!lobby) throw new Error('No lobby found with that code');
      const updated = lobbyManager.joinLobby(lobby.id, socket.id, lobby.code);
      socket.join(lobby.id);
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
    const eligible = getEligibleGames(lobby.players.length);
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
      io.to(lobbyId).emit(EVENTS.VOTE_RESULT, { selectedGame });
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());
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
    const allWagered = lobby.players.every((p) => tm.wagers[p] !== undefined);
    if (allWagered) {
      tm.startPlaying();
      io.to(lobbyId).emit(EVENTS.WAGER_LOCKED, { wagers: { ...tm.wagers } });

      if (isGameRegistered(tm.selectedGame)) {
        const game = createGame(tm.selectedGame, lobby.players);
        tm.activeGame = game;
        game.startGame();
        for (const playerId of lobby.players) {
          const playerSocket = io.sockets.sockets.get(playerId);
          if (playerSocket) {
            playerSocket.emit(EVENTS.GAME_STATE, {
              gameId: tm.selectedGame,
              state: game.getStateForPlayer(playerId),
            });
          }
        }
      } else {
        // Game not yet implemented — random placements
        const shuffled = [...lobby.players].sort(() => Math.random() - 0.5);
        const roundScores = tm.completeRound(shuffled);
        io.to(lobbyId).emit(EVENTS.ROUND_RESULTS, {
          placements: shuffled,
          scores: roundScores,
          standings: tm.getStandings(),
        });
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());

        if (tm.isTournamentOver()) {
          io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, {
            winner: tm.getWinner(),
            standings: tm.getStandings(),
            roundHistory: tm.roundHistory,
          });
          tournaments.delete(lobbyId);
          lobbyManager.setStatus(lobbyId, 'waiting');
        }
      }
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
    for (const playerId of lobby.players) {
      const playerSocket = io.sockets.sockets.get(playerId);
      if (playerSocket) {
        playerSocket.emit(EVENTS.GAME_STATE, {
          gameId: tm.selectedGame,
          state: game.getStateForPlayer(playerId),
        });
      }
    }

    if (game.isComplete()) {
      const results = game.getResults();
      const placements = results.map((r) => r.playerId);
      tm.activeGame = null;
      const roundScores = tm.completeRound(placements);

      io.to(lobbyId).emit(EVENTS.GAME_COMPLETE, { results });
      io.to(lobbyId).emit(EVENTS.ROUND_RESULTS, {
        placements,
        scores: roundScores,
        standings: tm.getStandings(),
      });
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, tm.getState());

      if (tm.isTournamentOver()) {
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, {
          winner: tm.getWinner(),
          standings: tm.getStandings(),
          roundHistory: tm.roundHistory,
        });
        tournaments.delete(lobbyId);
        lobbyManager.setStatus(lobbyId, 'waiting');
      }
    }
  });

  socket.on(EVENTS.DISCONNECT, () => {
    console.log(`Player disconnected: ${socket.id}`);
    handlePlayerLeave(socket);
  });
});

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

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { io, app, httpServer, lobbyManager, tournaments };
