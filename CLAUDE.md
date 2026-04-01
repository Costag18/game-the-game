# Game The Game

## Project Overview

Browser-based multiplayer mini-game tournament platform. Players join lobbies, vote on mini-games, wager points, and compete across rounds to win tournaments.

## Tech Stack

- **Frontend:** React (Vite) — `client/`
- **Backend:** Node.js + Express + Socket.IO — `server/`
- **State:** Redis (ioredis)
- **Shared:** Constants and event names — `shared/`

## Architecture

Server-authoritative. All game logic runs server-side. Clients send actions, server validates and broadcasts filtered state per player. Each mini-game is an FSM implementing a shared engine interface.

## Key Commands

```bash
# Client
cd client && npm install && npm run dev

# Server
cd server && npm install && npm run dev

# Redis (must be running)
redis-server
```

## Project Structure

```
client/src/components/   — Shared UI (scoreboard, timer, chat)
client/src/games/        — React component per mini-game
client/src/screens/      — Menu, Lobby, WaitingRoom, Results
client/src/hooks/        — useSocket, useGameState, useTournament
server/src/games/        — FSM game engine per mini-game
server/src/lobby/        — Room/lobby management
server/src/tournament/   — Round orchestration, scoring, voting
server/src/utils/        — Deck, dice, timer, shuffle helpers
shared/                  — Event names, constants, types
```

## Game Engine Interface

Every mini-game server module must implement:

```js
startGame(players)
handleAction(playerId, action)
getStateForPlayer(playerId)
isComplete()
getResults()
```

## Mini-Games (11)

Blackjack (2-8), Poker/Texas Hold'em (2-8), Uno (2-8), Go Fish (2-6), Crazy Eights (2-6), Rock-Paper-Scissors (2), Liar's Dice (2-8), Memory Match (2-6), Roulette (2-8), Hangman (2-8)

## Scoring

- Base points escalate: round N = 100 + (N-1) * 50
- Placement multipliers: 1st=100%, 2nd=70%, 3rd=50%, 4th=35%, 5th=25%, 6th+=15%
- Wagering: 0-50% of current points, pot split 50/30/20 to top 3

## Conventions

- Server is always source of truth — never trust client state
- Each player receives only their own visible game state
- Turn timers: 30s for card games, 15s for RPS, 60s for roulette bets
- Auto-action on timeout (stand/pass/random)
- 30-60 second disconnection grace period with full state resync on reconnect
- Socket.IO rooms for lobby management
- Clean up rooms when all players leave or on inactivity timeout
- Casino/felt table visual theme: green felt, gold accents, wood trim, serif headings

## Design Spec

Full design document: `docs/superpowers/specs/2026-03-30-game-the-game-design.md`
