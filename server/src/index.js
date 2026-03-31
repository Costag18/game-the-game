import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { EVENTS } from '../../shared/events.js';
import { LobbyManager } from './lobby/LobbyManager.js';

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

  socket.on(EVENTS.SET_NICKNAME, (nickname) => {
    socket.data.nickname = nickname;
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    if (lobbyId) {
      lobbyManager.setNickname(socket.id, nickname);
      const lobby = lobbyManager.getLobby(lobbyId);
      io.to(lobbyId).emit(EVENTS.LOBBY_STATE, lobby);
    }
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

  socket.on(EVENTS.LEAVE_LOBBY, () => {
    handlePlayerLeave(socket);
  });

  socket.on(EVENTS.CHAT_SEND, (message) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    if (lobbyId) {
      io.to(lobbyId).emit(EVENTS.CHAT_MESSAGE, {
        playerId: socket.id,
        nickname: socket.data.nickname || socket.id,
        message,
        timestamp: Date.now(),
      });
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
