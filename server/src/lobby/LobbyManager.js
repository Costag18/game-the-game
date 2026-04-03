import { v4 as uuidv4 } from 'uuid';

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export class LobbyManager {
  constructor() {
    this.lobbies = new Map();
    this.playerToLobby = new Map();
  }

  createLobby(hostId, options) {
    const id = uuidv4();
    const lobby = {
      id, hostId, name: options.name, maxPlayers: options.maxPlayers,
      isPrivate: options.isPrivate, code: options.isPrivate ? generateCode() : null,
      winCondition: options.winCondition, winTarget: options.winTarget,
      players: [hostId], nicknames: {}, status: 'waiting',
    };
    this.lobbies.set(id, lobby);
    this.playerToLobby.set(hostId, id);
    return lobby;
  }

  joinLobby(lobbyId, playerId, code = null) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new Error('Lobby not found');
    if (lobby.players.includes(playerId)) throw new Error('Already in lobby');
    if (lobby.players.length >= lobby.maxPlayers) throw new Error('Lobby is full');
    if (lobby.status !== 'waiting' && lobby.status !== 'voting' && lobby.status !== 'wagering') throw new Error('Game in progress');
    if (lobby.isPrivate && code !== lobby.code) throw new Error('Invalid code');
    lobby.players.push(playerId);
    this.playerToLobby.set(playerId, lobbyId);
    return lobby;
  }

  leaveLobby(lobbyId, playerId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;
    lobby.players = lobby.players.filter((p) => p !== playerId);
    this.playerToLobby.delete(playerId);
    delete lobby.nicknames[playerId];
    if (lobby.players.length === 0) { this.lobbies.delete(lobbyId); return null; }
    if (lobby.hostId === playerId) lobby.hostId = lobby.players[0];
    return lobby;
  }

  getLobby(lobbyId) { return this.lobbies.get(lobbyId) || null; }
  getPlayerLobby(playerId) { return this.playerToLobby.get(playerId) || null; }

  listPublicLobbies() {
    const list = [];
    for (const lobby of this.lobbies.values()) {
      const joinable = ['waiting', 'voting', 'wagering'].includes(lobby.status);
      if (!lobby.isPrivate && joinable && !lobby.id.startsWith('casino_')) {
        list.push({
          id: lobby.id, name: lobby.name, playerCount: lobby.players.length,
          maxPlayers: lobby.maxPlayers, hostId: lobby.hostId, status: lobby.status,
        });
      }
    }
    return list;
  }

  findLobbyByCode(code) {
    for (const lobby of this.lobbies.values()) {
      if (lobby.isPrivate && lobby.code === code.toUpperCase()) {
        return lobby;
      }
    }
    return null;
  }

  setNickname(playerId, nickname) {
    const lobbyId = this.playerToLobby.get(playerId);
    if (!lobbyId) return;
    const lobby = this.lobbies.get(lobbyId);
    if (lobby) lobby.nicknames[playerId] = nickname;
  }

  setStatus(lobbyId, status) {
    const lobby = this.lobbies.get(lobbyId);
    if (lobby) lobby.status = status;
  }
}
