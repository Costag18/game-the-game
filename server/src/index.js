import 'dotenv/config';
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

function adjustScore(tm, playerId, delta) {
  tm.scores[playerId] = Math.max(0, (tm.scores[playerId] || 0) + delta);
  return tm.scores[playerId];
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

// --- Klipy GIF search proxy (keeps API key server-side) ---
const KLIPY_APP_KEY = process.env.KLIPY_APP_KEY || '';
app.get('/api/gif-search', async (req, res) => {
  const q = (req.query.q || 'reactions').slice(0, 100);
  if (!KLIPY_APP_KEY) return res.json({ result: true, data: { data: [] } });
  try {
    const url = `https://api.klipy.com/api/v1/${KLIPY_APP_KEY}/gifs/search?q=${encodeURIComponent(q)}&per_page=24&content_filter=high&customer_id=server`;
    const resp = await fetch(url);
    const json = await resp.json();
    res.json(json);
  } catch (err) {
    console.error('Klipy proxy error:', err.message);
    res.json({ result: false, data: { data: [] } });
  }
});

function cleanupCasinoSession(playerId) {
  const casinoId = `casino_${playerId}`;
  tournaments.delete(casinoId);
  lobbyManager.lobbies.delete(casinoId);
  if (lobbyManager.playerToLobby.get(playerId) === casinoId) {
    lobbyManager.playerToLobby.delete(playerId);
  }
}

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
      cleanupCasinoSession(socket.id);
      // Clamp custom win targets to safe ranges
      if (options.winCondition === 'fixedRounds') {
        options.winTarget = Math.max(1, Math.min(50, Number(options.winTarget) || 5));
      } else if (options.winCondition === 'pointThreshold') {
        options.winTarget = Math.max(100, Math.min(99999, Number(options.winTarget) || 1000));
      }
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
      cleanupCasinoSession(socket.id);
      const lobby = lobbyManager.joinLobby(lobbyId, socket.id, code);
      if (socket.data.nickname) {
        lobbyManager.setNickname(socket.id, socket.data.nickname);
      }
      socket.join(lobbyId);

      // If tournament is active (voting/wagering), add player to it
      const tm = tournaments.get(lobbyId);
      if (tm && (tm.phase === 'voting' || tm.phase === 'wagering')) {
        if (!tm.players.includes(socket.id)) {
          tm.players.push(socket.id);
          tm.scores[socket.id] = 100;
          const nick = socket.data.nickname || socket.id.slice(0, 8);
          tm.nicknames[socket.id] = nick;
          // Delay tournament events so client processes join callback first
          setTimeout(() => {
            if (tm.phase === 'voting') {
              const eligible = shuffle(getEligibleGames(lobby.players.length));
              // Broadcast to ALL players so host also gets updated eligible games
              io.to(lobbyId).emit(EVENTS.ROUND_START, { round: tm.currentRound, eligibleGames: eligible });
            } else if (tm.phase === 'wagering') {
              socket.emit(EVENTS.VOTE_RESULT, {
                selectedGame: tm.selectedGame,
                playerCount: tm.players.length,
                wagerReturns: Scorer.getWagerReturnTable(tm.players.length),
              });
            }
            io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
          }, 200);
        }
      }

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

  // --- Emote Reactions ---
  socket.on(EVENTS.EMOTE_SEND, (data) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    if (!lobbyId) return;
    const emoji = data?.emoji;
    if (!emoji || typeof emoji !== 'string') return;
    // Rate-limit: 500ms between emotes per player
    const now = Date.now();
    if (socket.data._lastEmote && now - socket.data._lastEmote < 500) return;
    socket.data._lastEmote = now;
    io.to(lobbyId).emit(EVENTS.EMOTE_BROADCAST, {
      emoji,
      playerId: socket.id,
      nickname: socket.data.nickname || socket.id,
    });
  });

  // --- GIF Reactions ---
  socket.on(EVENTS.GIF_SEND, (data) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    if (!lobbyId) return;
    const url = data?.url;
    if (!url || typeof url !== 'string') return;
    // Only allow Klipy CDN URLs
    if (!url.startsWith('https://media.klipy.com/') && !url.startsWith('https://static.klipy.com/')) return;
    // Rate-limit: 12 seconds between GIFs per player
    const now = Date.now();
    if (socket.data._lastGif && now - socket.data._lastGif < 12000) return;
    socket.data._lastGif = now;
    io.to(lobbyId).emit(EVENTS.GIF_BROADCAST, {
      url,
      playerId: socket.id,
      nickname: socket.data.nickname || socket.id,
    });
  });

  // --- AI Image Generation ---
  socket.on(EVENTS.AI_IMAGE_SEND, async (data) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    if (!lobbyId) return;
    const prompt = data?.prompt;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) return;
    const sanitized = prompt.trim().slice(0, 200);
    // Rate-limit: 30 seconds between AI image requests per player
    const now = Date.now();
    if (socket.data._lastAiImage && now - socket.data._lastAiImage < 20000) return;
    socket.data._lastAiImage = now;

    try {
      // Step 1: Enqueue the generation request
      const hfToken = process.env.HF_TOKEN || '';
      const headers = { 'Content-Type': 'application/json' };
      if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;

      const enqueueResp = await fetch('https://evalstate-flux1-schnell.hf.space/gradio_api/call/infer', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: [sanitized, 0, true, 512, 512, 4],
        }),
      });

      if (!enqueueResp.ok) {
        const errBody = await enqueueResp.text().catch(() => '');
        console.error('[AI Image] Enqueue failed:', enqueueResp.status, errBody);
        socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Image generation service unavailable' });
        socket.data._lastAiImage = 0; // Reset cooldown on failure
        return;
      }

      const { event_id } = await enqueueResp.json();
      if (!event_id) {
        socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Failed to queue image generation' });
        socket.data._lastAiImage = 0;
        return;
      }

      // Step 2: Poll for result via SSE endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const resultResp = await fetch(
        `https://evalstate-flux1-schnell.hf.space/gradio_api/call/infer/${event_id}`,
        { headers, signal: controller.signal }
      );
      clearTimeout(timeout);

      const text = await resultResp.text();
      // Parse SSE — find the "complete" event's data line
      const lines = text.split('\n');
      let resultData = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('event: complete')) {
          // Next line is "data: ..."
          const dataLine = lines[i + 1];
          if (dataLine && dataLine.startsWith('data: ')) {
            resultData = JSON.parse(dataLine.slice(6));
          }
          break;
        }
        if (lines[i].startsWith('event: error')) {
          let errMsg = 'Generation failed';
          const dataLine = lines[i + 1];
          if (dataLine && dataLine.startsWith('data: ')) {
            try { errMsg = JSON.parse(dataLine.slice(6)) || errMsg; } catch {}
          }
          console.error('[AI Image] HF Space error:', errMsg);
          socket.emit(EVENTS.AI_IMAGE_ERROR, { error: typeof errMsg === 'string' ? errMsg : 'Generation failed' });
          socket.data._lastAiImage = 0;
          return;
        }
      }

      if (!resultData || !resultData[0]?.url) {
        socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'No image in response' });
        socket.data._lastAiImage = 0;
        return;
      }

      // Step 3: Fetch the generated image file and convert to base64
      const imageUrl = resultData[0].url;
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) {
        socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Failed to retrieve generated image' });
        socket.data._lastAiImage = 0;
        return;
      }
      const arrayBuf = await imgResp.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString('base64');
      const dataUrl = `data:image/webp;base64,${base64}`;

      // Step 4: Broadcast to everyone in the lobby
      io.to(lobbyId).emit(EVENTS.AI_IMAGE_BROADCAST, {
        imageUrl: dataUrl,
        nickname: socket.data.nickname || socket.id,
      });
    } catch (err) {
      console.error('[AI Image] Error:', err.message || err);
      socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Image generation timed out or failed' });
      socket.data._lastAiImage = 0;
    }
  });

  // --- Tournament Events ---

  socket.on(EVENTS.START_TOURNAMENT, () => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby || lobby.hostId !== socket.id) return;
    if (lobby.players.length < 1) return;

    lobbyManager.setStatus(lobbyId, 'playing');

    // Ensure all player nicknames are captured (some may have set nickname before joining lobby)
    for (const pid of lobby.players) {
      if (!lobby.nicknames[pid]) {
        const playerSocket = io.sockets.sockets.get(pid);
        if (playerSocket?.data?.nickname) {
          lobby.nicknames[pid] = playerSocket.data.nickname;
        }
      }
    }

    const tm = new TournamentManager({
      players: [...lobby.players],
      winCondition: lobby.winCondition,
      winTarget: lobby.winTarget,
      nicknames: lobby.nicknames,
    });
    tournaments.set(lobbyId, tm);

    tm.startNextRound();
    lobbyManager.setStatus(lobbyId, 'voting');
    const eligible = shuffle(getEligibleGames(lobby.players.length));
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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
      lobbyManager.setStatus(lobbyId, 'wagering');
      io.to(lobbyId).emit(EVENTS.VOTE_RESULT, {
        selectedGame,
        playerCount: lobby.players.length,
        wagerReturns: Scorer.getWagerReturnTable(lobby.players.length),
      });
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
    }
  });

  socket.on(EVENTS.COIN_FLIP, ({ amount, choice }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || (tm.phase !== 'voting' && tm.phase !== 'wagering')) return;
    const lobby = lobbyManager.getLobby(lobbyId);

    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;
    if (choice !== 'heads' && choice !== 'tails') return;

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === choice;
    adjustScore(tm, socket.id, won ? amount : -amount);

    socket.emit(EVENTS.COIN_FLIP_RESULT, {
      result,
      won,
      amount,
      newScore: tm.scores[socket.id],
    });
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));

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
    if (!tm || (tm.phase !== 'voting' && tm.phase !== 'wagering')) return;
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
    adjustScore(tm, socket.id, payout - amount);

    socket.emit(EVENTS.SLOTS_RESULT, {
      reels,
      multiplier,
      wager: amount,
      payout,
      net: payout - amount,
      newScore: tm.scores[socket.id],
    });
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));

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
    if (!tm || (tm.phase !== 'voting' && tm.phase !== 'wagering')) return;
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
    adjustScore(tm, socket.id, payout - amount);

    socket.emit(EVENTS.PLINKO_RESULT, {
      path, slot: position, multiplier, wager: amount, payout,
      net: payout - amount, newScore: tm.scores[socket.id],
    });
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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
    if (!tm || (tm.phase !== 'voting' && tm.phase !== 'wagering')) return;
    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;
    const lobby = lobbyManager.getLobby(lobbyId);

    const WHEEL_SEGMENTS = [0, 0.5, 1, 0.5, 2, 0.5, 1, 0.5, 3, 0.5, 1, 0.5, 5, 0.5, 1, 0.5, 10, 0.5, 1, 0.5];
    const segmentIndex = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
    const multiplier = WHEEL_SEGMENTS[segmentIndex];
    const payout = Math.floor(amount * multiplier);
    adjustScore(tm, socket.id, payout - amount);

    socket.emit(EVENTS.WHEEL_RESULT, {
      segmentIndex, multiplier, totalSegments: WHEEL_SEGMENTS.length,
      segments: WHEEL_SEGMENTS, wager: amount, payout,
      net: payout - amount, newScore: tm.scores[socket.id],
    });
    io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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
    if (!tm || (tm.phase !== 'voting' && tm.phase !== 'wagering')) return;
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
    if (!tm || (tm.phase !== 'voting' && tm.phase !== 'wagering')) return;
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
        adjustScore(tm, socket.id, -wager);
        socket.emit(EVENTS.BJ_LITE_RESULT, {
          phase: 'finished',
          playerCards: playerCards.map(cardName),
          playerTotal: handTotal(playerCards),
          dealerCards: dealerCards.map(cardName),
          dealerTotal: handTotal(dealerCards),
          result: 'bust', net: -wager, newScore: tm.scores[socket.id],
        });
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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
      adjustScore(tm, socket.id, net);

      socket.emit(EVENTS.BJ_LITE_RESULT, {
        phase: 'finished',
        playerCards: playerCards.map(cardName),
        playerTotal: pTotal,
        dealerCards: dealerCards.map(cardName),
        dealerTotal: dTotal,
        result, net, newScore: tm.scores[socket.id],
      });
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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
    if (!tm || (tm.phase !== 'voting' && tm.phase !== 'wagering')) return;
    const score = tm.scores[socket.id] ?? 0;
    if (!amount || amount <= 0 || amount > Math.floor(score * 0.5)) return;

    // Start a chicken run — store state on tournament
    if (!tm._chickenGames) tm._chickenGames = {};
    // Each lane has an independent chance of crashing. Later lanes are riskier.
    // Player starts at step 0 (safe start lane), first cross goes to step 1.
    // crashStep = 9 means survived all lanes (possible to reach 6x)
    // Exponential risk/reward — early lanes safe, late lanes dangerous.
    // Each lane's conditional EV ≈ 0.92 (house edge ~8%).
    const LANE_SURVIVE = [0.84, 0.84, 0.79, 0.76, 0.78, 0.66, 0.64, 0.53, 0.50, 0.48];
    let crashStep = 11;
    for (let i = 0; i < LANE_SURVIVE.length; i++) {
      if (Math.random() > LANE_SURVIVE[i]) {
        crashStep = i + 1; // crash on lane 1-8
        break;
      }
    }
    // Start at step 0 (safe zone) — first cross moves to step 1
    tm._chickenGames[socket.id] = { wager: amount, step: 0, crashStep, alive: true };

    socket.emit(EVENTS.CHICKEN_RESULT, {
      phase: 'playing', step: 0, multiplier: 1.0, wager: amount, alive: true,
    });
  });

  socket.on(EVENTS.CHICKEN_ACTION, ({ action }) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    const tm = tournaments.get(lobbyId);
    if (!tm || (tm.phase !== 'voting' && tm.phase !== 'wagering')) return;
    if (!tm._chickenGames?.[socket.id]) return;
    const lobby = lobbyManager.getLobby(lobbyId);

    const game = tm._chickenGames[socket.id];
    if (!game.alive) return;

    // Exponential multipliers: safe early (1.1x), huge late (25x)
    const MULTIPLIERS = [1.0, 1.1, 1.2, 1.4, 1.7, 2.0, 2.8, 4.0, 7.0, 13, 25];

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
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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
      adjustScore(tm, socket.id, net);
      socket.emit(EVENTS.CHICKEN_RESULT, {
        phase: 'finished', step: game.step, multiplier: mult,
        wager: game.wager, payout, net, alive: true,
        newScore: tm.scores[socket.id],
      });
      delete tm._chickenGames[socket.id];
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
      if (tm.isTournamentOver()) {
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
        tournaments.delete(lobbyId);
        lobbyManager.setStatus(lobbyId, 'waiting');
      }
    }
  });

  // --- Free Play Casino ---

  socket.on(EVENTS.CASINO_JOIN, () => {
    const casinoLobbyId = `casino_${socket.id}`;
    // Clean up any existing casino session
    cleanupCasinoSession(socket.id);
    // Create a fake tournament for solo casino play
    const tm = new TournamentManager({
      players: [socket.id],
      winCondition: 'pointThreshold',
      winTarget: 999999,
    });
    tm.scores[socket.id] = 1000;
    tm.phase = 'voting'; // allow gambling
    tournaments.set(casinoLobbyId, tm);
    // Map this player to the casino "lobby" so gambling handlers can find it
    lobbyManager.playerToLobby.set(socket.id, casinoLobbyId);
    lobbyManager.lobbies.set(casinoLobbyId, {
      id: casinoLobbyId, players: [socket.id], nicknames: {}, status: 'playing',
    });
    socket.join(casinoLobbyId);
    socket.emit(EVENTS.CASINO_STATE, { score: tm.scores[socket.id] });
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
      lobbyManager.setStatus(lobbyId, 'playing');
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
              io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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
          io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));

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

    // Start auto-advance timer on first ack
    if (!tm._resultsTimer) {
      tm._resultsTimer = setTimeout(() => {
        if (tm.phase !== 'results') return;
        // Force advance — auto-ack everyone
        tm.resultsAcknowledged = null;
        tm._resultsTimer = null;
        advanceAfterResults(lobbyId, tm, lobby);
      }, 15000);
    }

    // Wait for all tournament players
    if (!tm.players.every((p) => tm.resultsAcknowledged.has(p))) return;
    if (tm._resultsTimer) { clearTimeout(tm._resultsTimer); tm._resultsTimer = null; }
    tm.resultsAcknowledged = null;
    advanceAfterResults(lobbyId, tm, lobby);
  });

  function advanceAfterResults(lobbyId, tm, lobby) {
    if (tm.isTournamentOver()) {
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
      tournaments.delete(lobbyId);
      lobbyManager.setStatus(lobbyId, 'waiting');
    } else {
      tm.startNextRound();
      lobbyManager.setStatus(lobbyId, 'voting');
      const eligible = shuffle(getEligibleGames(lobby.players.length));
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
      io.to(lobbyId).emit(EVENTS.ROUND_START, {
        round: tm.currentRound,
        eligibleGames: eligible,
      });
    }
  }

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
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
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

function getTournamentState(tm) {
  return tm.getState();
}

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

  // Clean up casino session
  cleanupCasinoSession(socket.id);

  // Handle mid-tournament leave
  const tm = tournaments.get(lobbyId);
  if (tm) {
    // Remove from tournament player list
    tm.players = tm.players.filter((p) => p !== socket.id);

    // If an active game exists, remove from it
    if (tm.activeGame) {
      try {
        tm.activeGame.removePlayer?.(socket.id);
      } catch (e) { /* ignore */ }
    }

    const lobby = lobbyManager.getLobby(lobbyId);

    // If only 1 or 0 players remain, end the tournament
    if (tm.players.length <= 1) {
      if (tm.players.length === 1 && lobby) {
        io.to(lobbyId).emit(EVENTS.TOURNAMENT_END, buildTournamentEndPayload(tm, lobby));
      }
      tournaments.delete(lobbyId);
      if (lobby) lobbyManager.setStatus(lobbyId, 'waiting');
    } else {
      // Broadcast updated state to remaining players
      io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));

      // If waiting for this player's vote/wager, check if we can advance
      if (tm.phase === 'voting' && lobby) {
        if (Object.keys(tm.votes).length >= tm.players.length) {
          const selectedGame = tm.tallyVotes();
          tm.startWagerPhase();
          io.to(lobbyId).emit(EVENTS.VOTE_RESULT, {
            selectedGame,
            playerCount: tm.players.length,
            wagerReturns: Scorer.getWagerReturnTable(tm.players.length),
          });
          io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
        }
      } else if (tm.phase === 'wagering') {
        // Remove their wager requirement
        tm.wagerSubmitted?.delete(socket.id);
        if (tm.allWagersIn()) {
          // Trigger game start logic (simplified — emit wager locked)
          tm.startPlaying();
          io.to(lobbyId).emit(EVENTS.WAGER_LOCKED, { wagers: { ...tm.wagers } });
        }
      }

      // If active game, broadcast new state and check completion
      if (tm.activeGame) {
        if (lobby) {
          const nicknames = lobby.nicknames || {};
          for (const pid of tm.players) {
            const ps = io.sockets.sockets.get(pid);
            if (ps) {
              ps.emit(EVENTS.GAME_STATE, {
                gameId: tm.selectedGame,
                state: tm.activeGame.getStateForPlayer(pid),
                nicknames,
              });
            }
          }
        }
        if (tm.activeGame.isComplete()) {
          const results = tm.activeGame.getResults();
          const placements = results.map((r) => r.playerId);
          tm.activeGame = null;
          const roundScores = tm.completeRound(placements, results);
          io.to(lobbyId).emit(EVENTS.GAME_COMPLETE, { results });
          io.to(lobbyId).emit(EVENTS.ROUND_RESULTS, {
            placements, scores: roundScores, gameId: tm.selectedGame,
            standings: tm.getStandings().map((s) => ({
              ...s, nickname: lobby?.nicknames?.[s.playerId] || s.playerId.slice(0, 8),
            })),
            gameResults: results,
          });
          io.to(lobbyId).emit(EVENTS.TOURNAMENT_STATE, getTournamentState(tm));
        }
      }
    }
  }

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
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

export { io, app, httpServer, lobbyManager, tournaments };
