# Game The Game

## Project Overview

Browser-based multiplayer mini-game tournament platform. Players join lobbies, vote on mini-games, wager points, and compete across rounds to win tournaments. Includes a standalone free-play casino with side betting games.

## Tech Stack

- **Frontend:** React 19 (Vite) — `client/`
- **Backend:** Node.js + Express + Socket.IO — `server/`
- **Shared:** Constants, event names, game list — `shared/`
- **Fonts:** Cinzel (headings), Raleway (body), Pirata One (display) — Google Fonts
- **Deploy:** Render (server) + static client build served by Express in production

## Architecture

Server-authoritative. All game logic runs server-side. Clients send actions via Socket.IO, server validates and broadcasts filtered state per player. Each mini-game is an FSM extending `BaseGame`. Timer-driven state changes use `setOnStateChange` callback for broadcasting.

## Key Commands

```bash
# Client
cd client && npm install && npm run dev

# Server
cd server && npm install && npm run dev
# Production: npm start
```

## Project Structure

```
client/src/components/       — Shared UI (CasinoSidebar, scoreboard, chat)
client/src/games/            — React component + CSS module per mini-game
client/src/screens/          — Menu, Lobby, WaitingRoom, GameVote, WagerPhase, Results, CasinoMode
client/src/hooks/            — useSocket, useTournament
client/src/assets/           — styles/, images/, gamepreviews/
server/src/games/            — FSM game engine per mini-game
server/src/lobby/            — Room/lobby management
server/src/tournament/       — Round orchestration, scoring (Scorer.js), voting
server/src/utils/            — Deck, dice, timer, shuffle, words helpers
shared/                      — events.js, constants.js, gameList.js
```

## Game Engine Interface

Every mini-game server module must extend `BaseGame` and implement:

```js
startGame()                    // Initialize state, call transition('start')
handleAction(playerId, action) // Process player actions, validate, advance state
getStateForPlayer(playerId)    // Return filtered state (hide opponent info)
isComplete()                   // Check if game is finished
getResults()                   // Return [{playerId, placement, ...}] sorted
```

Optional for timer-driven games:
```js
setOnStateChange(callback)     // Register broadcast callback for timer events
_emitChange()                  // Call the callback to broadcast state
```

## Adding a New Game

1. Create `server/src/games/YourGame.js` extending BaseGame
2. Add to `shared/gameList.js` with id, name, minPlayers, maxPlayers, turnTimer, description, tutorial/instructions
3. Add timer constant to `shared/constants.js` if needed
4. Register in `server/src/games/registry.js`
5. Create `client/src/games/YourGame.jsx` + `.module.css`
6. Add preview image to `client/src/assets/gamepreviews/`
7. Import and add to `GAME_COMPONENTS` in `client/src/App.jsx`
8. Import preview and add to `GAME_PREVIEWS` in `client/src/screens/GameVote.jsx`

## Mini-Games (12)

| Game | Players | Type |
|------|---------|------|
| Blackjack | 2-8 | Turn-based, multi-hand |
| Texas Hold'em Poker | 2-8 | Turn-based, 5 hands |
| Uno | 2-8 | Turn-based, card game |
| Go Fish | 2-6 | Turn-based, card game |
| Crazy Eights | 2-6 | Turn-based, card game |
| Rock Paper Scissors | 2 | Simultaneous, best of 5 |
| Liar's Dice | 2-8 | Turn-based, bluffing (1s are wild) |
| Memory Match | 2-6 | Turn-based, pairs |
| Roulette | 2-8 | Simultaneous, 5 rounds |
| Hangman | 2-8 | Turn-based, word guessing |
| Spot the Difference | 2-8 | Simultaneous, 3 rounds |
| Battleship | 2 | Turn-based, setup + firing |

## Casino Side Games

Available during voting/wagering phases and in standalone Free Play Casino mode. All server-validated with real tournament points.

- **Coin Flip** — 50/50, 2x or 0x
- **Slots** — 3-reel emoji, pair 1.5x / triple 3x / 777 5x
- **Wheel of Fortune** — 20 segments, 0x to 10x
- **Blackjack Lite** — Quick solo hand vs dealer
- **Chicken Cross** — Cross lanes for escalating multipliers, cash out or get splat

## Scoring & Wagering

- All players start with 100 points
- Base points escalate: round N = 100 + (N-1) × 50
- Placement multipliers: 1st=100%, 2nd=70%, 3rd=50%, 4th=35%, 5th=25%, 6th+=15%
- Wager up to 50% of current points — multiplier scales by player count:
  - 2 players: 1st 2x / 2nd 0x
  - 4 players: 1st 2x / 2nd 1.5x / 3rd 0.5x / 4th 0x
  - 6+ players: 1st 3x / 2nd 2x / 3rd 1.5x / 4th 1x / 5th 0.5x / 6th+ 0x
- Point threshold mode: gambling can trigger tournament win

## Critical Patterns & Lessons Learned

### Timer-Driven State Broadcasting
Games with timers (SpotTheDifference, Battleship, Poker reveal) must use `setOnStateChange` callback registered in `index.js`. The callback broadcasts state to all players AND checks `game.isComplete()` for auto-finishing. Without this, clients get stuck when timers expire because `handleAction` is never called.

### Deadlock Prevention
- All acknowledge/reveal phases need a 10-second auto-advance timer
- Guard state transitions: `if (this.state !== 'expectedState') return;` to prevent double-execution
- Auto-skip broke/eliminated/all-in players (Poker, Roulette, Hangman)
- Client sends a `ping` action if local timer hits 0 and server hasn't transitioned

### Hidden Information
- `getStateForPlayer()` must NEVER reveal opponent hidden data (ship positions, hole cards, choices)
- Only reveal on game completion or when specific conditions are met (sunk ship, showdown)

### Tie Handling
- `getResults()` must assign same placement number to tied players
- Use `let placement = 1; if (i > 0 && score < prev.score) placement = i + 1;` pattern

### Nicknames
- Snapshotted at tournament start on TournamentManager constructor
- Included in every `getState()` call — no stale data
- Client uses `entry.nickname` from standings, falls back to `displayName()` utility

### Race Conditions
- Client uses `loadingGame` intermediate screen between WAGER_LOCKED and first GAME_STATE
- GAME_STATE listener only transitions from `loadingGame` to `playing`, not from other screens

### JSON Serialization
- Object keys become strings after Socket.IO transmission — always check both `obj[num]` and `obj[String(num)]`

### Casino Session Cleanup
- Free Play Casino creates a fake lobby + tournament mapped to the player's socket ID
- **CRITICAL:** Must call `cleanupCasinoSession()` when player creates/joins a real lobby, otherwise all events route to the dead casino tournament and the game freezes
- Gambling scores are clamped to 0 minimum via `adjustScore()` helper — negative scores break wager validation

### Gambling During Tournament
- Casino sidebar games work during both `voting` and `wagering` phases
- All gambling is server-validated with real tournament points
- `isTournamentOver()` checked after every gamble — can trigger instant win in point threshold mode

### Tournament End Timing (fixedRounds)
- `isTournamentOver()` for fixedRounds checks `roundHistory.length >= winTarget`, NOT `currentRound`
- `currentRound` is incremented by `startNextRound()` before the round plays, so checking it causes premature tournament end when gambling during voting

### Player Disconnect Mid-Game
- `handlePlayerLeave()` removes player from tournament and active game
- If 1 player remains, tournament ends with them as winner
- If waiting for their vote/wager, auto-advances without them
- Active game broadcasts updated state and checks completion

### Poker-Specific Lessons
- FSM must allow `reveal` transition from ALL betting states (preflop/flop/turn/river), not just showdown — folding triggers `_forceFinish()` → `transition('reveal')` from any state
- After fold, advance turn using full player list position, not the non-folded list (folded player has indexOf -1)
- All-in: unmatched bets returned via `totalInvested` tracking — winner can only win what they put in from each player
- All-in for less than minimum raise is allowed (short-stack rule)

### Blackjack Rules
- Multiplayer blackjack: each player independently vs dealer (not "top scorer wins")
- Blackjack (21 on 2 cards) = 3pts, Beat dealer = 2pts, Push = 1pt, Bust/Lose = 0pts

### Crazy Eights / Uno Empty Deck
- Draw only 1 card per turn (not loop until playable)
- When draw pile empty: reshuffle discard pile (minus top card) back in
- If reshuffle impossible (discard has 1 card) and no player can play: stalemate → game ends

### Keep-Alive (Render Free Plan)
- Server-side self-ping does NOT work — Render ignores internal requests
- Client-side fetch to `/health` every 5 min DOES work — counts as external traffic
- Keep-alive is in `client/src/context/SocketContext.jsx`

## Conventions

- Server is always source of truth — never trust client state
- Each player receives only their own visible game state
- Turn timers: 30s card games, 15s RPS, 45s Spot the Difference, 60s Roulette/Battleship setup
- Auto-action on timeout (stand/pass/random/auto-place)
- Socket.IO rooms for lobby management
- CSS modules per component, casino theme with varied backgrounds per game
- Game vote order randomized server-side each round
- `npm ci` for faster builds, `--omit=dev` on server in production

## Visual & UX Preferences

The owner cares about:
- **Touch device support** — all interactions must work without hover (use tap-to-preview + confirm pattern)
- **Unique visual identity per game** — each game has its own background color and display font
- **Clear feedback** — players should always know what's happening (status text, timers, visual indicators)
- **No clutter** — text in small spaces should be moved outside (e.g., Chicken Cross labels below lanes)
- **Smooth transitions** — no screen jerks on re-renders (don't null out state before server responds)
- **Decorative elements** — pharaoh with gradient fade, coins background with blur+mask, playing card corner decorations on casino cards
- **Fonts** — each game title uses a unique Google Font matching its theme. Body text uses Raleway, headings use Cinzel, game card names use Pirata One

## Fonts Per Game

| Game | Font |
|------|------|
| Blackjack | Cinzel |
| Poker | Fascinate Inline |
| Uno | Bungee Shade |
| Go Fish | Luckiest Guy |
| Crazy Eights | Permanent Marker |
| Rock Paper Scissors | Black Ops One |
| Liar's Dice | Creepster |
| Memory Match | Orbitron |
| Roulette | Cinzel |
| Hangman | Fredericka the Great |
| Spot the Difference | Special Elite |
| Battleship | Archivo Black |
