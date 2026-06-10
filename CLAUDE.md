# Game The Game

## Project Overview

Browser-based multiplayer mini-game tournament platform. Players join lobbies, vote on mini-games, wager points, and compete across rounds to win tournaments. Includes a standalone free-play casino with side betting games, a tamagotchi pet system with its own coin economy, and coin-earning mini-games.

## Tech Stack

- **Frontend:** React 19 (Vite) — `client/`
- **Backend:** Node.js + Express + Socket.IO — `server/`
- **Shared:** Constants, event names, game list, version — `shared/`
- **Fonts:** Cinzel (headings), Raleway (body), Pirata One (display) — Google Fonts
- **APIs:** Klipy (GIF search, free tier) — server-side proxy, key in env var
- **Env:** dotenv for server `.env` loading (gitignored)
- **Deploy:** Render (server) + static client build served by Express in production
- **Uptime:** UptimeRobot pings `/health` every 5 min to prevent Render free plan sleep

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
client/src/components/       — CasinoSidebar, PetSidebar, PetWithStream, EmoteOverlay, GifOverlay, ImageOverlay, PlayerName, StockTicker, SettingsGear, CoinCatchGame, PetMiniGames
client/src/context/          — SocketContext, PetContext (tamagotchi state)
client/src/games/            — React component + CSS module per mini-game
client/src/screens/          — Menu, Lobby, WaitingRoom, GameVote, WagerPhase, Results, CasinoMode
client/src/hooks/            — useSocket, useTournament
client/src/assets/           — styles/, gamepreviews/
client/public/               — Large static images (logo, votefornext, pharaoh, coins)
server/src/games/            — FSM game engine per mini-game
server/src/lobby/            — Room/lobby management
server/src/tournament/       — Round orchestration, scoring (Scorer.js), voting
server/src/utils/            — Deck, dice, timer, shuffle, words helpers
shared/                      — events.js, constants.js, gameList.js, version.js
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

Optional for player removal during simultaneous games:
```js
removePlayer(playerId)         // Override to auto-advance when waiting player leaves
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

## Mini-Games (83)

| Game | Players | Type |
|------|---------|------|
| Blackjack | 2-8 | Turn-based, multi-hand, each player vs dealer |
| Texas Hold'em Poker | 2-8 | Turn-based, 5 hands, all-in support |
| Uno | 2-8 | Turn-based, +2/+4 stacking, consecutive plays |
| Go Fish | 2-6 | Turn-based, card game |
| Crazy Eights | 2-6 | Turn-based, draw 1 per turn |
| Rock Paper Scissors | 2-8 | Simultaneous, 5 rounds |
| Liar's Dice | 2-8 | Turn-based, bluffing (1s are wild) |
| Memory Match | 2-6 | Turn-based, pairs |
| Roulette | 2-8 | Simultaneous, 5 rounds |
| Hangman | 2-8 | Turn-based, 5 words per game |
| Spot the Difference | 2-8 | Simultaneous, 3 rounds |
| Battleship | 2-8 | Turn-based, setup + firing, target selector |
| Reaction Tap | 2-8 | Simultaneous, 5 rounds, timer-driven GO (server-authoritative reflex timing) |
| Typing Race | 2-8 | Simultaneous, single 90s sprint, server-authoritative prefix validation |
| Scattergories | 2-8 | Simultaneous, 3 rounds, letter+categories, unique-answer scoring + peer-challenge |
| BS (Cheat) | 2-8 | Turn-based bluff, claim+challenge window, reveal, finish-order ranking |
| Wavelength | 2-8 | Turn-based, rotating psychic, hidden spectrum band, slider guessing |
| Aim Trainer Duel | 2-8 | Simultaneous, 25s, per-player server-spawned targets, hits+accuracy ranking |
| Mastermind | 2-8 | Simultaneous deduction race, shared hidden code, private boards, black/white feedback |
| President | 2-8 | Turn-based shedding, trick groups, pass-persistence, finish-order ranking |
| Spoons | 3-8 | Real-time pass ring + grab race, internal elimination rounds, reverse-elim ranking |
| Fibbage | 3-8 | Bluff trivia, write fakes + vote for truth, hidden ballot, +1000 truth / +500 per fool |
| Connect 4 | 2-8 | 1v1 board (Pairing Engine Swiss best-of-3), drop discs, 4-in-a-row |
| Ultimate Tic-Tac-Toe | 2-8 | 1v1 board (Pairing Engine), 9 sub-boards, forced-board rule, win 3-in-a-row of boards |
| Skribbl | 2-8 | Draw-and-guess, real-time shared canvas, masked word, server-side guess matching |
| Telephone Pictionary | 3-8 | Lockstep write→draw→guess chains, private per-chain canvases, reveal + vote |
| Othello | 2-8 | 1v1 board (Pairing Engine), 8×8 disc-flip/bracket, most discs wins |
| Dots & Boxes | 2-8 | 1v1 board (Pairing Engine), claim 4th edge → extra turn, most boxes (5×5) |
| Gomoku | 2-8 | 1v1 board (Pairing Engine), 15×15 five-in-a-row |
| Hex | 2-8 | 1v1 board (Pairing Engine), 11×11 connect-your-edges, never draws |
| Order & Chaos | 2-8 | 1v1 board (Pairing Engine), 6×6, Order wants 5-in-a-row, Chaos blocks |
| Nim Heist | 2-8 | 1v1 (Pairing Engine), misère take-away — take the last gem and you lose |
| Buzzer Royale | 2-8 | Multiple-choice buzzer trivia, server arrival-order speed scoring, answer hidden pre-reveal |
| Higher or Lower | 2-8 | Simultaneous higher/lower survival streak on hidden quantities |
| Price Is Wrong | 2-8 | Closest-without-going-over numeric guess, 5 rounds, private guesses |
| Timeline | 2-8 | Place the year of events on a slider, distance scoring, year hidden pre-reveal |
| Guesstimate | 2-8 | Log-closeness numeric estimation, within-a-factor still scores |
| Odd One Out | 2-8 | Tap the rule-breaker, arrival-order speed scoring, rule hidden pre-reveal |
| Rank It | 2-8 | Reorder shuffled items, adjacent-pair accuracy scoring |
| This or That | 2-8 | Binary trivia survival, wrong = eliminated, reverse-elimination ranking |
| Definition Duel | 3-8 | Balderdash — fake definitions for a real word, vote the truth (Fibbage-shaped) |
| Quiplash Clash | 3-8 | Head-to-head prompt duels, room votes funnier, points by vote share |
| Caption This | 3-8 | Caption AI-generated scenes (client Pollinations URL), vote funniest |
| Awkward Award | 3-8 | Write an acceptance reason for a silly trophy pinned to a random nominee, vote |
| Most Likely To | 3-8 | Secret-vote a player per prompt, votes received scored (vote-only) |
| Vote Prophet | 3-8 | Vote your opinion + predict the group plurality, score the prediction |
| Group Mind | 3-8 | Type to MATCH others (server normalize+bucket), score per match |
| Mob Rule | 3-8 | Pick a side for the majority, twist rounds reward the minority |
| Two Truths and a Lie | 3-8 | Rotating storyteller, guess the lie; catcher + fooler scoring |
| Superlative Showdown | 3-8 | Privately rank the lobby, Borda consensus IS the placement |
| Spyfall | 3-8 | Hidden spy among players sharing a location, vote + spy location guess |
| Chameleon Clues | 3-8 | Hidden chameleon lacks the grid word, one-word clues + vote + guess |
| Traitor's Vault | 4-8 | Co-op 5-stage crack with hidden traitors, sabotage counts + eject vote |
| Whisper Network | 4-8 | Two hidden factions tug a shared meter, then tag everyone's side |
| Sketch Impostor | 3-8 | Hidden impostor draws without the word (shared canvas, one stroke/turn), vote |
| Take Six | 3-8 | 6 Nimmt! — simultaneous card pick, ascending row resolution, fewest bullheads wins |
| Press Your Luck Pigs | 2-8 | Push-your-luck dice (Pig) — roll to build a pot, a 1 busts, bank before you lose it |
| Qwixx | 2-8 | Roll-and-write across 4 colour rows (left-to-right only), triangular scoring |
| Yahtzee | 2-8 | Lockstep 5-dice, keep + re-roll, 13-category scorecard, server RNG + scoring |
| Domino Drift | 2-8 | Mexican-Train-lite dominoes, match pips, empty hand wins, pip-sum ranks the rest |
| Bingo Brawl | 2-8 | Real-time 5×5 Bingo, server-called numbers, validated daubs, finish order ranks |
| Twenty-Four | 2-8 | Make 24 from 4 numbers, safe server-side expression evaluator, speed scoring |
| Target Locked | 2-8 | Countdown numbers — closest to target, whole-positive intermediates, server-validated |
| Factor Frenzy | 2-8 | Tap every true divisor of the target, speed + streak, wrong taps penalised |
| Going Once | 2-8 | Live ascending auction, server-validated bankrolls, going-once timer, most value wins |
| Dutch Drop | 2-8 | Descending-price auction, first-to-buy by server arrival, hidden lot value, profit race |
| Sealed Vault | 2-8 | Sealed-bid auction, private bids until reveal, highest pays, most loot wins |
| Last Bid Standing | 3-8 | All-pay attrition, everyone in pays each tick, last standing takes the jackpot (reverse-elim) |
| Token Tussle | 2-8 | Colonel Blotto — secretly split 20 tokens over 5 fronts, most-per-front wins it |
| Whack-a-Pharaoh | 2-8 | Real-time whack-a-mole, server-scheduled pop-ups, live-occupant-validated taps |
| Coin Cascade | 2-8 | 5-lane falling-objects catch, server-tracked basket lane, arrival resolved server-side |
| Balloon Brinkmanship | 2-8 | Simultaneous pump/bank, hidden server burst threshold, 4 rounds |
| Pulse Tap | 2-8 | Rhythm tap, server beat schedule, offset-graded Perfect/Good/Miss + combo |
| Bullseye Drop | 2-8 | Timing darts, server reticle path, radius-at-release scoring |
| Hot Potato Relay | 3-8 | Real-time pass ring with a hidden server fuse, reverse-elimination ranking |
| Echo Chamber | 2-8 | Simon sequence-memory race, server-only sequence, depth ranking |
| Grid Lock | 2-8 | 15-puzzle slide race, server-validated slides, finish order + tiles-correct |
| Nonogram Dash | 2-8 | Picross race, hidden bitmap (clues only sent), solve validated server-side |
| Pair Hunt | 2-8 | SET — claim all-same/all-different trios from a public tableau, server-validated |
| Crack the Vault | 2-8 | Numeric Mastermind race, hidden code, locked/loose feedback, crack order ranks |
| Sudoku Sixer | 2-8 | 6×6 sudoku race, server-generated solution + givens, finish order + correct cells |
| Flash Flood | 2-8 | Flashed-pattern memory race, growing grid, server-only pattern, rounds-banked ranking |
| Sequence Sleuth | 2-8 | Guess the next term, fewer-terms-shown scores more, rule hidden server-side |

## 1v1 Pairing Engine (Swiss layer)

Inherently-1v1 games (Connect 4, more to come) can't natively produce a 1..N round ranking. `server/src/games/PairingEngine.js` solves this once: `class PairingEngine extends BaseGame` wraps N players in a Swiss mini-tournament (K=3 mini-rounds; odd count → one **bye** = free win), runs all pairings **simultaneously** as parallel 1v1 matches, re-pairs by record between mini-rounds, and `getResults()` ranks everyone by (wins → head-to-head → score differential).

- **MatchEngine contract** (a plain object, NOT a BaseGame): `applyMove(pid, move)→bool`, `getView(pid)`, `isOver()`, `winner()`, `isDraw()`, optional `scoreDiff(pid)` (final tiebreak) and `autoMove()` (per-turn-timeout auto-play instead of forfeit). The match owns ONE board; it never touches ranking, byes, timers, the barrier, or leave handling.
- **Thin wrapper** per game: `class Connect4 extends PairingEngine` just passes `matchFactory`, `miniRounds`, `matchTimerSec`, `matchHardCapSec`, `title`. Registered as a normal game; the PairingEngine itself is NOT registered and has no gameList entry.
- **Barrier:** fast finishers wait (`phase` stays `match`, `myMiniRoundDone:true`, `waitingOn` lists unfinished pairings); the engine transitions to `miniRoundSummary` only when ALL pairings resolve.
- **Timers (engine-owned):** per-turn (`autoMove()` if provided, else forfeit the staller), a 90s hard-cap (always forfeits), and a 10s summary ack auto-advance — each pairs with `_emitChange()`.
- **Leave contract:** a leaver forfeits their live match (opponent +1 win), is excluded from future mini-rounds, auto-acked on the summary barrier, and pruned from results; ≤1 player → finish.
- **Client:** `client/src/games/PairingShell.jsx` is the shared chrome (mini-round header, live standings, bye card, "waiting on" barrier, summary + AckStatus). A board component renders inside it via a render-prop: `<PairingShell …>{(myMatch) => <Board myMatch={myMatch} … />}</PairingShell>`.

## Drawing Canvas Infra (draw-and-guess games)

Reusable real-time drawing layer for Skribbl (and future Telephone Pictionary). **Pixels only** — it does NOT own turns, words, scoring, or completion (that stays in the consuming game's FSM).

- **`server/src/utils/CanvasSession.js`** — pure server state + validation for one drawing surface. The game FSM holds `this.canvas = new CanvasSession()`. `addStroke/undo/clear/snapshot/reset/setDrawer`. Sanitizes everything (clamps coords to 800×600 logical space, clamps width 1–64, validates hex color, reissues canonical stroke ids `senderId:seq`, throttles ~30/s, caps points/strokes). Only the active drawer may add/undo/clear.
- **`server/src/utils/wordBank.js`** — 5 categories × 3 difficulties; `pickWord(s)` with exclude-dedup + exhaustion fallback.
- **`server/src/utils/guessMatch.js`** — server-only `normalizeGuess` (case/punct/accents/leading-article), `levenshtein`, `isCorrectGuess` (exact + fuzzy distance-1 gated to word length ≥4), `isCloseGuess`. The word is NEVER sent to a guesser.
- **Socket relay (separate from GAME_ACTION):** `STROKE_SEND/STROKE_BROADCAST`, `CANVAS_UNDO_SEND/CANVAS_UNDO`, `CANVAS_CLEAR_SEND/CANVAS_CLEAR`, `CANVAS_SNAPSHOT` in `shared/events.js`. Handlers in `index.js` duck-type `tm.activeGame.canvas` (no-op for non-drawing games) — high-frequency pixel traffic must NOT flow through the FSM's per-action `GAME_STATE` rebroadcast.
- **Anti-cheat (structural):** word lives only in the FSM; `getStateForPlayer` sends `word` to the drawer only, a masked `_ _ _` length hint to guessers; guess matching is server-side; the drawer can't guess; wrong guesses are never echoed to the room (no chat leak) — only private `myGuessFeedback`.
- **Client:** `client/src/components/DrawingCanvas.jsx` — controlled `<canvas>` (renders exactly the `strokes` array the parent passes), Pointer Events (mouse+touch+stylus, `setPointerCapture`, `touch-action:none`), one `STROKE_SEND` per gesture on pen-up. The **game screen** owns `strokes` state + the 4 canvas listeners and resets on `drawPhase`/step change. Mid-game joins are blocked during play, so snapshots are reserved for reconnect.
- **Telephone Pictionary divergence:** Telephone uses **one `CanvasSession` per chain** (`this.canvases[chainId]`, NOT a single `this.canvas`), because every player draws privately at once. Its stroke relay in `index.js` is a SEPARATE scoped path (guarded by `constructor.name === 'TelephonePictionary'`) that echoes strokes back to the **author's own socket only** (`socket.emit`, never `io.to(room)`) — so no one sees another player's in-progress drawing until reveal. The generic `tm.activeGame.canvas` handlers no-op for it (it has no singular `.canvas`).

## Casino Side Games

Available during voting/wagering phases and in standalone Free Play Casino mode. All server-validated with real tournament points.

- **Coin Flip** — 50/50, 2x or 0x
- **Slots** — 3-reel emoji, pair 1.5x / triple 3x / 777 5x
- **Wheel of Fortune** — 20 segments, 0x to 10x
- **Blackjack Lite** — Quick solo hand vs dealer
- **Chicken Cross** — Cross lanes for escalating multipliers, cash out or get splat. House edge ~8% per lane.

## Sound Effects System

Synthesized audio using Web Audio API — no external sound files needed.

- **Engine:** `client/src/audio/SoundEngine.js` — all sounds are functions generating oscillator/noise tones
- **Context:** `SoundContext` provides `playSound(name)` and `muted`/`toggleMute` to all components
- **Mute toggle:** Inside SettingsGear panel (top-left), accessible from all screens
- **Persistence:** Mute state saved to `localStorage` key `gtg_muted`, survives reload
- **Volume:** Master gain ~12-15%, subtle and non-intrusive
- **Categories:** UI (click, menu), Tournament (round start, vote, wager), Game (cards, dice, coins), Social (emotes, GIFs, join/leave), Outcomes (win/lose round, casino, tournament), Pet (feed, pet, buy, collect)
- **Integration:** Sounds triggered via `useSound()` hook in components and via socket event listeners in `App.jsx`

## Theme System

6 preset color themes selectable from the SettingsGear panel.

- **Context:** `ThemeContext` provides `{ theme, setTheme }`, persists to `localStorage` key `gtg_theme`
- **CSS approach:** `[data-theme="..."]` attribute on `<html>` overrides `:root` CSS variables
- **Themes:** Classic Burgundy (default), Royal Blue, Emerald Table, Midnight Purple, Vegas Noir
- **Variables overridden:** `--gold`, `--gold-dim`, `--gold-light`, `--bg-dark`, `--bg-panel`, `--mahogany`, `--burgundy`, `--text-primary`, `--text-secondary`, `--wood-brown`, `--wood-dark`
- **Scope:** Affects all screens, panels, buttons, text. Game-specific backgrounds (felt, ocean, etc.) are NOT changed — each game keeps its unique visual identity
- **SettingsGear:** Replaces the old standalone MuteButton. 44px gear icon (⚙️) top-left, click to roll out panel with sound toggle + theme swatches. Click-outside-to-close. Gear rotates on hover and when open.

## Screen Shake

CSS-based screen shake on big moments — 3 intensity levels.

- **Hook:** `useScreenShake()` in `client/src/hooks/useScreenShake.js` — returns `shake(intensity)` function
- **CSS:** Keyframes in `global.css` — `shakeLight` (2px, 250ms), `shakeMedium` (4px, 350ms), `shakeHeavy` (6px, 400ms)
- **Mechanism:** Applies class to `<html>` element, auto-removes after animation duration
- **Triggers:** Blackjack bust (medium), Blackjack 21 (heavy), Poker all-in (heavy), Poker showdown (medium), Slots jackpot (heavy), Casino wins (light), Chicken crash (medium), Round win (medium), Tournament win (heavy)

## Animated Card Dealing

Cards slide in sequentially instead of appearing instantly.

- **CSS:** `@keyframes dealCard` in each card game's CSS module — `translateY(-30px) scale(0.8)` → normal
- **Stagger:** Each card gets `animation-delay: ${index * 120}ms` for sequential appearance
- **Smart animation:** Uses `useRef` to track previous card count — only NEW cards animate, existing ones don't re-animate
- **Games:** Blackjack, Poker (hole + community), Uno, GoFish

## Confetti Effect

Canvas-based particle animation on tournament win.

- **Component:** `ConfettiOverlay.jsx` — full-viewport `<canvas>`, `pointer-events: none`
- **Trigger:** Tournament win for the winning player only (detected via `socket.id === winner.playerId`)
- **Duration:** 4 seconds with fade-out in final 30%
- **Particles:** 150 colored rectangles (gold, red, blue, green, yellow, white, orange) with gravity and rotation
- **Cleanup:** Auto-removes from DOM after 4.5 seconds via state in `App.jsx`

## GIF Reactions

Discord-style GIF picker — players search for GIFs and send them flying across everyone's screen.

- **API:** Klipy (free, Tenor/GIPHY alternative). Key stored server-side as `KLIPY_APP_KEY` env var
- **Proxy:** `GET /api/gif-search?q=<query>` — Express route proxies to Klipy, keeps API key secret
- **Socket events:** `GIF_SEND` (client → server with URL) → `GIF_BROADCAST` (server → all in lobby)
- **Security:** Server validates URLs start with `https://static.klipy.com/` or `https://media.klipy.com/`
- **Rate limit:** 12-second server-enforced cooldown per player (`socket.data._lastGif`)
- **UI:** GIF button (bottom-right), opens search panel with 2-column flex grid, thumbnails use `xs` size
- **Animation:** Flying GIF slides horizontally across screen (LTR or RTL randomly), 3.5s, slight arc
- **Panel coordination:** Opening GIF panel closes emote menu and vice versa
- **Components:** `GifOverlay.jsx` + `GifOverlay.module.css` — rendered inside `EmoteOverlay`
- **Default results:** Panel loads "reactions" query on open for instant one-tap sending
- **Env setup:** Local dev uses `server/.env` with dotenv. Production uses Render environment variables

## Image Overlay (AI Generate + Photo Search)

Two-tab panel (🎨 button above GIF button) for sending images flying across everyone's screen.

- **AI Generate tab:** Client sends prompt to server → server calls Pollinations.ai (FLUX) → generates 512x512 image → broadcasts base64 to lobby
- **Search Photos tab:** Client searches Pexels API via server proxy `/api/image-search` → thumbnail grid → click to send flying
- **API:** Pollinations.ai for AI generation (free, no auth), Pexels for photo search (free, 200 req/hr)
- **Global rate limit:** 16-second cooldown across ALL users for Pollinations (1 request per 16s). Client cooldown 18s to prevent bypass
- **Socket events:** `AI_IMAGE_SEND` (client → server with `{ prompt }` or `{ imageUrl }`) → `AI_IMAGE_BROADCAST` (server → all) / `AI_IMAGE_ERROR` (server → requester with `waitSeconds`)
- **Env var:** `PEXELS_API_KEY` — free from pexels.com/api
- **Components:** `ImageOverlay.jsx` + `ImageOverlay.module.css` — rendered inside `EmoteOverlay`
- **Flying animation:** Same LTR/RTL as GIFs (3.5s), sender nickname below
- **Mutual exclusivity:** Opening image panel closes GIF panel and emote menu
- **Enter key disabled** on all AI prompt inputs to prevent accidental submissions

## Profile Photos (AI + Search)

Players set profile photos via AI generation or Pexels search in the SettingsGear panel. Photos appear as circles before player names everywhere.

- **Two tabs:** "AI" (Pollinations server-side generation) and "Search" (Pexels photo search), default is Search
- **Socket events:** `SET_AVATAR` (client → server with `{ prompt }` or `{ avatar: url }`, uses callback) → `AVATAR_UPDATE` (server → lobby broadcast)
- **Storage:** Server: `socket.data.avatar` + `lobby.avatars[playerId]` + `tm.avatars[playerId]`. Client: `localStorage` key `gtg_avatar`
- **Persistence:** On socket connect, client sends saved avatar from localStorage to server via `SET_AVATAR`
- **Data flow:** `avatars` map flows alongside `nicknames` through `TournamentManager.getState()`, all `GAME_STATE` emissions, `ROUND_RESULTS` standings, and `buildTournamentEndPayload()`
- **Display:** `PlayerName` component (`client/src/components/PlayerName.jsx`) renders avatar circle + name. Used in all 5 screen components and all 12 game components
- **Click to expand:** Clicking any avatar opens a modal with 200px full view
- **Fallback:** No avatar → gradient circle with first letter of name

## Sidebar Button Strip

Vertical strip of action buttons on the right side of the pet sidebar (21% width). Desktop landscape only.

- **💥 Emotesplosion:** 40 random emojis burst from center of everyone's screen. 60s cooldown, server-enforced
- **🔦 Spotlight:** Dims screen with radial gradient, bright oval cutout over your name in leaderboard. 3 min cooldown. Only visible on gameVote/wagerPhase screens
- **🌧️ Weather Change:** Server picks random effect (rain/snow/sunny/stars/hearts), 30 particles fall across everyone's screen for 10s with matching colored edge gradient. Rain falls straight, others spin. 2 min cooldown
- **🎰 Quick Gamble:** Client-side 50/50 for ±5 buddy coins. No server involved. Pinned to bottom of strip
- **Socket events:** `EMOTESPLOSION_SEND/BROADCAST`, `SPOTLIGHT_SEND/BROADCAST`, `WEATHER_SEND/BROADCAST`
- **Component:** `PetWithStream.jsx` manages all strip buttons, effects, and the CBC News live stream

## Live Stream

CBC News 24/7 YouTube live stream embedded above Buddy in the pet sidebar.

- **Stream:** YouTube embed of CBC News live (video ID `5vfaDsMhCF4` — may change if stream restarts)
- **Overlay:** Transparent click-interceptor hides YouTube controls by default. Click once to reveal controls for 5 seconds
- **Component:** `PetWithStream.jsx` wraps `PetSidebar` with stream + button strip
- **Layout:** Stream pinned at top, button strip on right (21%), Buddy scrolls below
- **Desktop only:** Hidden on mobile and portrait orientation (`min-width: 960px` + `orientation: landscape`)
- **Sidebar width:** 340px on desktop

## Stock Ticker

Scrolling real-time stock prices at the bottom of the screen during gameplay.

- **Widget:** TradingView ticker tape embed (free, no API key, real-time data)
- **Symbols:** S&P 500, NASDAQ 100, EUR/USD, Bitcoin, Ethereum, Apple, Google, Microsoft, Amazon, Tesla, NVIDIA, Meta, Shopify, Royal Bank, TD Bank
- **Visibility:** Only on `gameVote`, `wagerPhase`, and `playing` screens
- **Height:** 46px fixed at bottom. All bottom-positioned elements (GIF/Image buttons, pet sidebar) offset by 46px
- **Component:** `StockTicker.jsx` + `StockTicker.module.css`

## Pet System (Tamagotchi)

Client-side only, per-session (resets on page reload). Lives in `PetContext`.

- **Stats:** Hunger, Happiness, Energy (decay every 10 seconds)
- **Actions:** Feed (5 coins), Pet (free, 30s cooldown), Sleep (free, 60s cooldown)
- **Shop items:** Bow Tie, Hat, Shades, Crown, Diamond, Trophy, Rocket, Rainbow (10-200 coins)
- **Slot system:** head, neck, eyes, side — multiple items equippable simultaneously
- **Coin mini-games:** Catch Coins (free), Stop the Clock (3 coins), Color Match (free), Treasure Chest (5 coins)
- **Layout:** Left sidebar on desktop (fixed during games), below content on mobile

## Scoring & Wagering

- All players start with 100 points
- Base points escalate: round N = 100 + (N-1) × 50
- Placement multipliers: 1st=100%, 2nd=70%, 3rd=50%, 4th=35%, 5th=25%, 6th+=15%
- Wager up to 50% of current points — multiplier scales by player count:
  - 2 players: 1st 2x / 2nd 0x
  - 4 players: 1st 2x / 2nd 1.5x / 3rd 0.5x / 4th 0x
  - 6+ players: 1st 3x / 2nd 2x / 3rd 1.5x / 4th 1x / 5th 0.5x / 6th+ 0x
- Point threshold mode: gambling can trigger tournament win
- Wager slider auto-clamps when score changes from side gambling

## Critical Patterns & Lessons Learned

### Timer-Driven State Broadcasting
Games with timers (SpotTheDifference, Battleship, Poker reveal, Hangman word-reveal, Blackjack reveal, RPS reveal, LiarsDice challenge, Roulette spinning-ack, MemoryMatch turn) must use `setOnStateChange` callback registered in `index.js`. The callback broadcasts state to all players AND checks `game.isComplete()` for auto-finishing. Without this, clients get stuck when timers expire because `handleAction` is never called. (Adding the missing `setOnStateChange` to Blackjack/RPS/LiarsDice and the missing timers to Roulette/MemoryMatch was part of the v2.7.0 deadlock overhaul.)

### Deadlock Prevention
- All acknowledge/reveal phases need a 10-second auto-advance timer
- Guard state transitions: `if (this.state !== 'expectedState') return;` to prevent double-execution
- Auto-skip broke/eliminated/all-in players (Poker, Roulette, Hangman)
- Client sends a `ping` action if local timer hits 0 and server hasn't transitioned
- Round results have 15-second auto-advance if not all players acknowledge

### Player Leave During Games
- `handlePlayerLeave()` removes player from tournament and active game
- If 1 player remains, tournament ends with them as winner
- If waiting for their vote/wager, auto-advances without them
- **Simultaneous games (RPS, Roulette, SpotTheDifference):** override `removePlayer()` to auto-submit/auto-ack for the leaving player so the game doesn't wait for them
- Results acknowledgment checks `tm.players` not `lobby.players` (lobby may have mid-round joiners)

### Engine Leave/Elimination Contract (v2.7.0 — the big leave/deadlock overhaul)
A 49-agent audit found ~30 distinct mid-game leave/deadlock bugs. Root causes + the contract that fixes them:
- **`BaseGame` now has THREE removal methods.** Do not conflate them:
  - `_removeFromActive(playerId)` — player is out of the turn rotation but STAYS in `this.players` (still scored). Use for in-game **elimination** (Hangman wrong-out, LiarsDice loses-all-dice). Hangman/LiarsDice call this internally — NOT `removePlayer`.
  - `removePlayer(playerId)` — player **left entirely** (disconnect). Prunes `this.players` AND the rotation. Called by `handlePlayerLeave`. Games override it (calling `super.removePlayer` first) to advance the turn off the leaver, re-check ack/round completion, and finish if ≤1 remain.
  - `destroy()` — teardown; games owning timers override to clear them. The orchestration calls `game.destroy?.()` before every `tm.activeGame = null`, so orphaned timers can't fire on a discarded game (this previously double-called `completeRound` → corrupted scores).
- **Root cause #1 — `this.players` was never pruned on leave.** Turn rotation (Uno/GoFish/Poker/Battleship rotate over `this.players`), ack gates (Blackjack reveal, LiarsDice challenge used `this.players.every`), end-conditions (CrazyEights `_isStalemate`, GoFish `_checkGameEnd`, Hangman `_startRound`) and `getResults()` all wait on / include a ghost. Fixed by pruning `this.players` in `BaseGame.removePlayer`.
- **Root cause #2 — timer auto-advances that don't broadcast.** Blackjack/RPS/LiarsDice had internal `setTimeout` advances but never registered `setOnStateChange`, so the advance was invisible (no GAME_STATE, no `isComplete()` recheck). Roulette (spinning-ack) and MemoryMatch (turn) had NO server timer at all. All now wire `setOnStateChange` + `_emitChange`, and Roulette/MemoryMatch got the missing timers.
- **Root cause #3 — orchestration gaps.** Wagering-leave only emitted `WAGER_LOCKED` and NEVER created the game → everyone stuck on `loadingGame` forever (worst bug). Now `startSelectedGame()` (module-level helper, shared with `WAGER_SUBMIT`) is called from the wagering-leave path. Also: results-phase acks are re-checked on leave; `tm._resultsTimer` is cleared on tournament teardown; `advanceAfterResults` is module-level so `handlePlayerLeave` can call it.
- **GoFish stalemate:** because a leaver's cards are deleted, 13 sets can be unreachable. `_checkGameEnd` now also finishes when the deck is empty and no two players share a rank (no productive ask possible).
- Verified with a leave/deadlock harness (fake clock + auto-players): 12 games × {2,3,4 players} × {leave current / leave other}, asserting leaver pruned, turn always on a present player, `getResults` safe + leaver-free, and completion reached.

### Mid-Tournament Joining
- Players can join during voting or wagering phases (blocked during active games)
- Lobby status tracks: waiting → voting → wagering → playing
- New players get 100 starting points, nickname snapshotted from socket.data
- Tournament events delayed 200ms after join so client processes join callback first

### Hidden Information
- `getStateForPlayer()` must NEVER reveal opponent hidden data (ship positions, hole cards, choices)
- Only reveal on game completion or when specific conditions are met (sunk ship, showdown)

### Tie Handling
- `getResults()` must assign same placement number to tied players
- Use `let placement = 1; if (i > 0 && score < prev.score) placement = i + 1;` pattern

### Nicknames
- Snapshotted at tournament start on TournamentManager constructor
- Also captured from socket.data.nickname for players who set name before joining lobby
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

### Spot the Difference Shape Rules
- Symmetric shapes (circle, square, cross, hexagon): no rotation mutations, always rotation 0
- Star: only [0, 180] rotations (point up vs down)
- Square/Diamond: only [0, 45] rotations
- Size differences: 16/28/42px for clear visual distinction

### Keep-Alive (Render Free Plan)
- Server-side self-ping does NOT work — Render ignores internal requests
- Client-side fetch does NOT reliably work — browser throttles background tabs
- **Use UptimeRobot** (external service, free) to ping `/health` every 5 min
- Client pings `/health` every 2 min ONLY during active game screens (lobby, voting, playing)
- Cold start on first visit is acceptable (~30-60s), but mid-game disconnects are not

### Game Layout & Sidebar Sizing
- During gameplay, `.gameMainArea` (the wrapper App.jsx renders the game into) ALREADY applies the pet-sidebar offset on desktop — `margin-left: 340px; width: calc(100% - 340px)` (see `global.css`; 340px matches the desktop sidebar width)
- **A game component's own CSS must NOT re-apply that margin** — doing so double-offsets and pushes the game off-center to the right (the v2.x ReactionTap/TypingRace/Scattergories bug). Just center content inside the wrapper with `max-width` + `margin: 0 auto` (or `align-items: center`), no `margin-left`/`calc(100% - …)`.
- Without `calc`, `width: 100%` + `margin-left` causes overflow off the right edge
- Casino sidebar is 280px fixed on desktop during voting/wagering screens
- Always account for fixed sidebars when calculating main content width

### Solo Host Flow
- Host can start tournament with 1 player (server allows `players.length >= 1`)
- Game vote screen shows all games greyed out with "Waiting for players to join..."
- Games unlock when 2+ players are in the tournament
- Other players can join mid-tournament during voting/wagering phases

### Round Results Auto-Advance
- Results acknowledgment checks `tm.players` not `lobby.players` (lobby may have mid-round joiners)
- 15-second auto-advance timer if not all players acknowledge
- Prevents permanent deadlock from disconnects or stuck clients

### Emote & GIF Overlay Architecture
- `EmoteOverlay` is `position: fixed; inset: 0; overflow: hidden; pointer-events: none` — covers full viewport
- Child buttons/panels use `position: absolute` with `pointer-events: auto`
- `GifOverlay` renders inside `EmoteOverlay` as a sibling component
- Both share coordinated open/close state — only one panel open at a time
- Flying animations (emojis float up, GIFs fly across) use CSS keyframes with `onAnimationEnd` cleanup
- Emote overlay renders on screens: `gameVote`, `wagerPhase`, `playing`

### Environment Variables & API Keys
- API keys (like `KLIPY_APP_KEY`) must NEVER be in client code or committed to git
- Server proxies external API calls to keep keys secret
- Local dev: `server/.env` file (gitignored) loaded via `dotenv/config`
- Production: Render dashboard → Environment Variables
- Server validates all user-submitted URLs against allowlisted CDN domains

### Casino Animation UX
- Bet controls use `visibility: hidden` (not `display: none`) during spinning
- Preserves layout space — no jank from elements appearing/disappearing
- Controls reappear after result lands

### Custom Rounds/Points
- Lobby creation allows custom number input for rounds (1-50) and point threshold (100-99999)
- Preset quick buttons for common values (5/10/15 rounds, 1000/2000/5000 points)
- Server clamps values to safe ranges

## Skip-to-Lobby Vote

Any player can open the SettingsGear (during `gameVote`/`wagerPhase`/`playing`/`roundResults`) and "Vote to skip → Lobby". The vote is **unanimous-gated**: only when EVERY current tournament player has voted does the server abandon the active game + tournament and return everyone to the lobby (waiting room).

- **Events:** `SKIP_VOTE` (client→server, `{vote:bool}` toggle), `SKIP_UPDATE` (server→room, `{voted:[ids], total}`), `RETURN_TO_LOBBY` (server→room) — in `shared/events.js`.
- **Server (`index.js`):** votes tracked on `tm.skipVotes` (Set), reset per game in `startSelectedGame`. The `SKIP_VOTE` handler toggles the voter, prunes departed voters, and when `tm.players.every(p => skipVotes.has(p))` calls `returnToLobby()` — which `destroy()`s the active game, clears `tm._resultsTimer`, `tournaments.delete`s, sets lobby status `'waiting'`, and emits `LOBBY_STATE` + `RETURN_TO_LOBBY`. `handlePlayerLeave` prunes a departed player's vote so a gone player can't block the tally.
- **Client:** `SettingsGear` (given a `screen` prop) shows the toggle + "X/Y voted · all must agree" only on active-game screens; `App.jsx` routes `RETURN_TO_LOBBY` → `waitingRoom`.

## Conventions

- Server is always source of truth — never trust client state
- Each player receives only their own visible game state
- Turn timers: 30s card games, 15s RPS, 45s Spot the Difference, 60s Roulette/Battleship setup
- Auto-action on timeout (stand/pass/random/auto-place)
- Socket.IO rooms for lobby management
- CSS modules per component, casino theme with varied backgrounds per game
- Game vote order randomized server-side each round
- `npm ci --prefer-offline` for faster builds, `--omit=dev` on server in production
- Large images in `client/public/` (not bundled by Vite) — logo 5.5MB, votefornext 1.5MB
- Leaderboard names truncated with ellipsis at 150px max-width
- Delta-time based animations (coin catch game) to be frame-rate independent
- Explicitly bind server to `0.0.0.0` for Render port detection

## Visual & UX Preferences

The owner cares about:
- **Touch device support** — all interactions must work without hover (use tap-to-preview + confirm pattern)
- **Unique visual identity per game** — each game has its own background color and display font
- **Clear feedback** — players should always know what's happening (status text, timers, visual indicators)
- **No clutter** — text in small spaces should be moved outside (e.g., Chicken Cross labels below lanes)
- **Smooth transitions** — no screen jerks on re-renders (don't null out state before server responds)
- **Decorative elements** — pharaoh with gradient fade, coins background with blur+mask, playing card corner decorations on casino cards
- **Responsive layout** — desktop: 3-column (pet | content | casino). Mobile: content full width on top, pet + casino side-by-side below. During games: pet fixed left on desktop, below game on mobile.
- **Fonts** — each game title uses a unique Google Font matching its theme. Body text uses Raleway, headings use Cinzel, game card names use Pirata One. Only titles get unique fonts — all other text uses default for readability.

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
| Reaction Tap | Black Ops One |
| Typing Race | Special Elite (title) / Cutive Mono (passage) |
| Scattergories | Bungee |
| BS (Cheat) | Creepster |
| Wavelength | Audiowide (title) / Quicksand (body) |
| Aim Trainer Duel | Wallpoet |
| Mastermind | Orbitron |
| President | Playfair Display |
| Spoons | Bangers |
| Fibbage | Shrikhand |
| Connect 4 | Fredoka |
| Ultimate Tic-Tac-Toe | Russo One |
| Skribbl | Lilita One |
| Telephone Pictionary | Gochi Hand |
| Othello | Cinzel |
| Dots & Boxes | Fredoka |
| Gomoku | Russo One |
| Hex | Orbitron |
| Order & Chaos | Audiowide |
| Nim Heist | Wallpoet |
| Buzzer Royale | Bungee |
| Higher or Lower | Russo One |
| Price Is Wrong | Shrikhand |
| Timeline | Cinzel |
| Guesstimate | Orbitron |
| Odd One Out | Luckiest Guy |
| Rank It | Audiowide |
| This or That | Black Ops One |
| Definition Duel | Shrikhand |
| Quiplash Clash | Bungee |
| Caption This | Lilita One |
| Awkward Award | Fredoka |
| Most Likely To | Audiowide |
| Vote Prophet | Black Ops One |
| Group Mind | Quicksand |
| Mob Rule | Permanent Marker |
| Two Truths and a Lie | Special Elite |
| Superlative Showdown | Bungee |
| Spyfall | Special Elite |
| Chameleon Clues | Creepster |
| Traitor's Vault | Cinzel |
| Whisper Network | Audiowide |
| Sketch Impostor | Permanent Marker |
| Take Six | Bungee Shade |
| Press Your Luck Pigs | Bangers |
| Qwixx | Fredoka |
| Yahtzee | Bungee |
| Domino Drift | Russo One |
| Bingo Brawl | Luckiest Guy |
| Twenty-Four | Orbitron |
| Target Locked | Wallpoet |
| Factor Frenzy | Russo One |
| Going Once | Cinzel |
| Dutch Drop | Bungee |
| Sealed Vault | Playfair Display |
| Last Bid Standing | Black Ops One |
| Token Tussle | Orbitron |
| Whack-a-Pharaoh | Luckiest Guy |
| Coin Cascade | Fredoka |
| Balloon Brinkmanship | Bangers |
| Pulse Tap | Audiowide |
| Bullseye Drop | Wallpoet |
| Hot Potato Relay | Bungee |
| Echo Chamber | Audiowide |
| Grid Lock | Russo One |
| Nonogram Dash | Orbitron |
| Pair Hunt | Fredoka |
| Crack the Vault | Wallpoet |
| Sudoku Sixer | Cinzel |
| Flash Flood | Bungee |
| Sequence Sleuth | Orbitron |

## Versioning & Commits

- **Version source of truth:** `shared/version.js` exports `VERSION` string (e.g., `'1.2.1'`)
- **Display:** `MainMenu.jsx` imports `VERSION` and renders `v{VERSION}` in the top-right corner
- **Bump dynamically:** Always update `shared/version.js` — patch for fixes, minor for features, major for breaking changes. Never hardcode version strings elsewhere.
- **Every change must**: bump the version in `shared/version.js`, commit, and push to GitHub
- **Commit messages** must end with `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- **Tell the user** the new version number when committing

## CLAUDE.md Self-Maintenance

This file must be kept up to date. **Update CLAUDE.md when:**
- A new game, feature, or system is added (add section + update structure/tables)
- A critical bug fix reveals a new pattern or lesson learned (add to Critical Patterns)
- Project structure changes (new directories, moved files, new shared modules)
- New environment variables or deployment requirements are added
- Conventions or architectural patterns change
- New fonts, dependencies, or third-party APIs are integrated

When updating, preserve existing sections and append — don't remove lessons learned even if they seem obvious now. Future sessions rely on this file for context.
