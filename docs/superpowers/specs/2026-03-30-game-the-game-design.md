# Game The Game - Design Specification

## Overview

A browser-based multiplayer mini-game collection where players compete in tournaments across 11 different mini-games. Players join lobbies, vote on which game to play each round, wager points, and accumulate scores to win the tournament.

## Core Concepts

- **Online multiplayer** via Socket.IO
- **Server-authoritative** — all game logic runs server-side
- **Tournament progression** — players vote/pick mini-games, points accumulate across rounds
- **Flexible lobby size** — host decides player count
- **Casino/felt table aesthetic** — green felt, gold accents, wood trim

## Tech Stack

- **Frontend:** React SPA (Vite)
- **Backend:** Node.js + Express + Socket.IO
- **State Store:** Redis (game state, sessions, rooms)
- **Shared:** Constants, event names, types shared between client/server

No ORM, no database beyond Redis.

## Architecture

```
┌─────────────┐     Socket.IO      ┌──────────────────┐      ┌───────┐
│  React SPA  │ <────────────────> │   Node.js Server │ <──> │ Redis │
│  (Vite)     │                    │                  │      └───────┘
│             │                    │  ├─ Lobby Manager │
│  - Lobby UI │                    │  ├─ Tournament Mgr│
│  - Game UIs │                    │  ├─ Game Engines  │
│  - Scoreboard│                   │  │   (FSM-based)  │
└─────────────┘                    │  └─ Score Tracker │
                                   └──────────────────┘
```

### Key Principles

- **Server is source of truth.** Clients send actions, server validates and broadcasts results.
- **Personalized state views.** Server sends each player only the information they're allowed to see (own hand, not others').
- **FSM per game.** Each mini-game is modeled as a finite state machine with explicit states and transitions.
- **Disconnection handling.** 30-60 second grace period, seat held, full state resync on reconnect, auto-action on timeout.
- **Turn timers.** Server-side timers prevent AFK blocking.

### Game Engine Interface

Every mini-game implements this shared interface:

```
startGame(players)           // Initialize game with player list
handleAction(playerId, action) // Process a player's move
getStateForPlayer(playerId)  // Return filtered view for this player
isComplete()                 // Check if game has ended
getResults()                 // Return final scores/rankings
```

## Lobby System

### Flow

1. Player connects → main menu
2. **Create lobby** — Host configures: name, public/private (code join), max players, win condition (fixed rounds or point threshold), target value
3. **Browse/join** — Players see public lobbies or enter private code
4. **Waiting room** — Chat, see who's joined, host starts when ready (min 2 players)

### Implementation

- Socket.IO rooms as lobbies
- Server-side validation on all join requests
- Public rooms listed, private rooms require code
- Room cleanup on all players leaving or inactivity timeout

## Tournament System

### Flow

1. Host starts tournament → round 1 begins
2. **Game voting** — Players see eligible mini-games (filtered by player count). Each votes. Ties broken randomly.
3. **Wager phase** — Players optionally bet 0-50% of accumulated points. Pot collected.
4. **Play mini-game** — Game runs to completion with turn timers
5. **Scoring** — Base points (escalating) + wager pot distributed by placement
6. **Repeat** until win condition met
7. **Tournament end** — Final standings, winner celebration, rematch option

### Tournament Manager

Separate from game engines. It only knows how to:
- Collect votes and select a game
- Instantiate the appropriate game engine
- Wait for game completion
- Accumulate scores
- Check win conditions

## Scoring System

### Base Points (Escalating)

| Round | Base Points |
|-------|-------------|
| 1     | 100         |
| 2     | 150         |
| 3     | 200         |
| N     | 100 + (N-1) * 50 |

### Placement Multipliers

| Place | % of Base |
|-------|-----------|
| 1st   | 100%      |
| 2nd   | 70%       |
| 3rd   | 50%       |
| 4th   | 35%       |
| 5th   | 25%       |
| 6th+  | 15%       |

### Wagering

- Available from round 2 onward (start with 0 points)
- Bet 0-50% of current points
- Pot distribution: 1st = 50%, 2nd = 30%, 3rd = 20%, 4th+ = nothing
- Server validates wager amounts

### Win Conditions (Host Picks)

- **Fixed rounds:** 5, 10, or 15 rounds. Most points wins.
- **Point threshold:** 1000, 2000, or 5000 points. First to reach wins.
- **Tiebreaker:** Sudden death — one randomly picked mini-game.

## Mini-Games

### Game Roster (11 games)

| Game | Players | Description |
|------|---------|-------------|
| **Blackjack** | 2-8 | All players vs AI dealer. Closest to 21 without busting ranks highest among players. |
| **Poker (Texas Hold'em)** | 2-8 | Standard Texas Hold'em. Last standing or best hand at showdown wins. Uses tournament chips (not real wager points). |
| **Uno** | 2-8 | Standard rules. First to empty hand = 1st. Others ranked by remaining card point values. |
| **War** | 2 | Classic War. Each player flips top card, highest takes both. First to take all cards wins, or most cards after 26 flips (half deck). |
| **Go Fish** | 2-6 | Most completed sets when deck/hands run out wins. |
| **Crazy Eights** | 2-6 | First to empty hand wins. Others ranked by remaining card values. |
| **Rock-Paper-Scissors** | 2 | Best of 5 rounds. |
| **Liar's Dice** | 2-8 | Bluffing dice game. Last player with dice wins. |
| **Memory Match** | 2-6 | Shared board of 24 face-down cards (12 pairs). Players take turns flipping two cards. Match = keep the pair and go again. Most pairs wins. |
| **Roulette** | 2-8 | All players place bets on the same spin. Highest net winnings ranks 1st. |
| **Hangman** | 2-8 | Competitive. Server picks a word. Players take turns guessing one letter each (round-robin). Wrong guesses add to that player's personal gallows. Last player not hanged wins, or fewest wrong guesses when word is solved. |

### Turn Timers

- Card games: 30 seconds per action
- RPS: 15 seconds
- Roulette: 60 seconds for bet placement
- Auto-action on timeout: stand, pass, or random selection

### Player Count Filtering

Games incompatible with the current lobby size are grayed out during voting. War and RPS only appear for 2-player lobbies.

## Visual Design

### Casino/Felt Table Theme

- **Background:** Dark green felt texture on game screens
- **Borders/panels:** Rich wood trim
- **Accents:** Gold for buttons, highlights, scores
- **Menus/lobby:** Dark mahogany/burgundy
- **Cards:** Classic white with red/black suits
- **Dice:** Ivory with black pips
- **Typography:** Serif headings (elegant casino), clean sans-serif for body/game text

### Key Screens

1. **Main Menu** — Logo, Play (browse lobbies), Create Lobby, How to Play
2. **Lobby Browser** — Public game list, join-by-code, player counts shown
3. **Waiting Room** — Player avatars around felt table, chat panel, host controls
4. **Game Vote** — Grid of mini-game cards (casino chip style), vote tally, countdown timer
5. **Wager Phase** — Chip slider for bet amount, current standings visible
6. **Game Screen** — Unique layout per game. Shared elements: player list sidebar, turn indicator, timer bar, point totals
7. **Round Results** — Animated scoreboard, point +/- animations, wager payouts
8. **Tournament End** — Winner spotlight, final standings, confetti, rematch button

### Responsive

Desktop-first, playable on tablet and mobile. Game elements scale down proportionally.

## Project Structure

```
game-the-game/
├── client/                  # React SPA (Vite)
│   ├── src/
│   │   ├── components/      # Shared UI (scoreboard, timer, chat)
│   │   ├── games/           # One folder per mini-game component
│   │   ├── screens/         # Menu, Lobby, WaitingRoom, Results
│   │   ├── hooks/           # useSocket, useGameState, useTournament
│   │   ├── assets/          # Card images, felt textures, sounds
│   │   └── App.jsx
│   └── package.json
├── server/                  # Node.js + Express + Socket.IO
│   ├── src/
│   │   ├── games/           # One module per mini-game (FSM engine)
│   │   ├── lobby/           # Room management, join/leave
│   │   ├── tournament/      # Round orchestration, scoring, voting
│   │   ├── utils/           # Deck, dice, timer, shuffle helpers
│   │   └── index.js
│   └── package.json
├── shared/                  # Shared constants, event names, types
├── docs/
└── CLAUDE.md
```

### Dependencies

**Client:** react, vite, socket.io-client, css modules
**Server:** express, socket.io, ioredis, uuid
