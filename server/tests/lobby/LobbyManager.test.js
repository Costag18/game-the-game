import { describe, test, expect, beforeEach } from '@jest/globals';
import { LobbyManager } from '../../src/lobby/LobbyManager.js';

const defaultOptions = {
  name: 'Room',
  maxPlayers: 4,
  isPrivate: false,
  winCondition: 'fixedRounds',
  winTarget: 5,
};

describe('LobbyManager', () => {
  let manager;

  beforeEach(() => {
    manager = new LobbyManager();
  });

  test('createLobby returns lobby with id and hostId', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    expect(lobby.id).toBeDefined();
    expect(lobby.hostId).toBe('host1');
    expect(lobby.name).toBe('Room');
    expect(lobby.players).toContain('host1');
    expect(lobby.status).toBe('waiting');
  });

  test('createLobby sets code to null for public lobby', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    expect(lobby.isPrivate).toBe(false);
    expect(lobby.code).toBeNull();
  });

  test('createLobby generates a code for private lobby', () => {
    const lobby = manager.createLobby('host1', { ...defaultOptions, isPrivate: true });
    expect(lobby.isPrivate).toBe(true);
    expect(lobby.code).toBeTruthy();
  });

  test('joinLobby adds player to lobby', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    const updated = manager.joinLobby(lobby.id, 'player2');
    expect(updated.players).toContain('player2');
    expect(updated.players).toHaveLength(2);
  });

  test('joinLobby throws when lobby not found', () => {
    expect(() => manager.joinLobby('nonexistent', 'player1')).toThrow('Lobby not found');
  });

  test('joinLobby rejects duplicate player', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    expect(() => manager.joinLobby(lobby.id, 'host1')).toThrow('Already in lobby');
  });

  test('joinLobby rejects when lobby is full', () => {
    const lobby = manager.createLobby('host1', { ...defaultOptions, maxPlayers: 2 });
    manager.joinLobby(lobby.id, 'player2');
    expect(() => manager.joinLobby(lobby.id, 'player3')).toThrow('Lobby is full');
  });

  test('joinLobby rejects when game already in progress', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    manager.setStatus(lobby.id, 'in-progress');
    expect(() => manager.joinLobby(lobby.id, 'player2')).toThrow('Game already in progress');
  });

  test('private lobby rejects join with wrong code', () => {
    const lobby = manager.createLobby('host1', { ...defaultOptions, isPrivate: true });
    expect(() => manager.joinLobby(lobby.id, 'player2', 'WRONG1')).toThrow('Invalid code');
  });

  test('private lobby allows join with correct code', () => {
    const lobby = manager.createLobby('host1', { ...defaultOptions, isPrivate: true });
    const updated = manager.joinLobby(lobby.id, 'player2', lobby.code);
    expect(updated.players).toContain('player2');
  });

  test('leaveLobby removes player from lobby', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    manager.joinLobby(lobby.id, 'player2');
    const updated = manager.leaveLobby(lobby.id, 'player2');
    expect(updated.players).not.toContain('player2');
    expect(updated.players).toHaveLength(1);
  });

  test('host leaving transfers host to next player', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    manager.joinLobby(lobby.id, 'player2');
    const updated = manager.leaveLobby(lobby.id, 'host1');
    expect(updated.hostId).toBe('player2');
  });

  test('last player leaving destroys lobby', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    const result = manager.leaveLobby(lobby.id, 'host1');
    expect(result).toBeNull();
    expect(manager.getLobby(lobby.id)).toBeNull();
  });

  test('leaveLobby clears playerToLobby mapping', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    manager.joinLobby(lobby.id, 'player2');
    manager.leaveLobby(lobby.id, 'player2');
    expect(manager.getPlayerLobby('player2')).toBeNull();
  });

  test('listPublicLobbies filters out private lobbies', () => {
    manager.createLobby('host1', defaultOptions);
    manager.createLobby('host2', { ...defaultOptions, isPrivate: true });
    const list = manager.listPublicLobbies();
    expect(list).toHaveLength(1);
    expect(list[0].hostId).toBe('host1');
  });

  test('listPublicLobbies filters out in-progress lobbies', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    manager.setStatus(lobby.id, 'in-progress');
    const list = manager.listPublicLobbies();
    expect(list).toHaveLength(0);
  });

  test('listPublicLobbies returns correct shape', () => {
    manager.createLobby('host1', defaultOptions);
    const list = manager.listPublicLobbies();
    expect(list[0]).toMatchObject({
      id: expect.any(String),
      name: 'Room',
      playerCount: 1,
      maxPlayers: 4,
      hostId: 'host1',
    });
  });

  test('getPlayerLobby returns lobbyId for player in lobby', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    expect(manager.getPlayerLobby('host1')).toBe(lobby.id);
  });

  test('getPlayerLobby returns null for player not in any lobby', () => {
    expect(manager.getPlayerLobby('nobody')).toBeNull();
  });

  test('getLobby returns the lobby by id', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    expect(manager.getLobby(lobby.id)).toBe(lobby);
  });

  test('getLobby returns null for unknown id', () => {
    expect(manager.getLobby('unknown')).toBeNull();
  });

  test('setNickname stores nickname in lobby', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    manager.setNickname('host1', 'CoolHost');
    expect(manager.getLobby(lobby.id).nicknames['host1']).toBe('CoolHost');
  });

  test('leaveLobby removes nickname', () => {
    const lobby = manager.createLobby('host1', defaultOptions);
    manager.joinLobby(lobby.id, 'player2');
    manager.setNickname('player2', 'Cool');
    manager.leaveLobby(lobby.id, 'player2');
    expect(manager.getLobby(lobby.id).nicknames['player2']).toBeUndefined();
  });
});
