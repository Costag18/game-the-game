import { useState, useRef, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { usePet } from '../context/PetContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import PetSidebar from './PetSidebar.jsx';
import styles from './PetWithStream.module.css';

const EXPLOSION_COOLDOWN = 60;
const SPOTLIGHT_COOLDOWN = 180;
const WEATHER_COOLDOWN = 120;
const TOMATO_COOLDOWN = 30;
const EXPLOSION_EMOJIS = ['😂', '😮', '👏', '😭', '🔥', '❤️', '💀', '🎉', '💥', '✨', '🎆', '🎇'];
const WEATHER_PARTICLES = { rain: '💧', snow: '❄️', sunny: '☀️', stars: '⭐', hearts: '❤️' };

// --- YouTube IFrame API loader (shared singleton) ---
let ytApiPromise = null;
function loadYouTubeAPI() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') { try { prev(); } catch {} }
      resolve(window.YT);
    };
    if (!document.querySelector('script[data-yt-iframe-api]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.setAttribute('data-yt-iframe-api', '1');
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

export default function PetWithStream({ children, screen }) {
  const { socket } = useSocketContext();
  const { playSound } = useSound();
  const { coins, addCoins } = usePet();
  const [showControls, setShowControls] = useState(false);

  // --- Police bodycam stream sync ---
  const playerContainerRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytReadyRef = useRef(false);
  const currentVideoIdRef = useRef(null);
  const lastRemoteTimeRef = useRef(0);
  const suppressSeekUntilRef = useRef(0);
  const seekWatchdogRef = useRef(null);
  // Tracks the "true" playhead anchor from the server for each video load,
  // so we can re-seek accurately the moment the player actually starts
  // playing — covers the 500ms-2s embed load delay that a startSeconds
  // hint alone can't account for.
  const pendingSyncRef = useRef(null); // { videoId, baseTime, serverTime, paused, deadline }
  const [streamReady, setStreamReady] = useState(false);
  const [streamMuted, setStreamMuted] = useState(true);
  const [streamVolume, setStreamVolume] = useState(60);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeRef = useRef(null);

  // Initialize the YouTube player once
  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI().then((YT) => {
      if (cancelled || !YT || !playerContainerRef.current) return;
      ytPlayerRef.current = new YT.Player(playerContainerRef.current, {
        width: '100%',
        height: '100%',
        videoId: '',
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
        },
        events: {
          onReady: () => {
            ytReadyRef.current = true;
            setStreamReady(true);
            // Ask server for current state (in case we joined mid-tournament)
            try { socket?.emit(EVENTS.BODYCAM_ACTION, { type: 'requestState' }); } catch {}
          },
          onStateChange: (e) => {
            // 0 = ended → ask server to pick a new random video for everyone
            if (e.data === 0 && socket) {
              socket.emit(EVENTS.BODYCAM_ACTION, { type: 'ended' });
            }
            // State 1 = playing. If we have a pending sync anchor from
            // the server, recompute the exact target NOW (the player
            // took hundreds of ms to load), seek locally, AND emit a
            // `seek` action so the server rebroadcasts a fresh
            // authoritative state to everyone. This mirrors exactly
            // what manually pressing ±30 does — which was the only
            // thing that reliably resynced a new joiner.
            if (e.data === 1) {
              const p = pendingSyncRef.current;
              if (p && ytPlayerRef.current) {
                try {
                  const elapsed = p.paused ? 0 : (Date.now() - p.serverTime) / 1000;
                  const target = p.baseTime + elapsed;
                  suppressSeekUntilRef.current = Date.now() + 2500;
                  ytPlayerRef.current.seekTo(target, true);
                  lastRemoteTimeRef.current = target;
                  // Force-rebroadcast through the same path as ±30 so
                  // every client (including us) gets a fresh serverTime
                  // anchor and clock skew is eliminated.
                  if (socket) {
                    socket.emit(EVENTS.BODYCAM_ACTION, { type: 'seek', time: target });
                  }
                } catch {}
                pendingSyncRef.current = null;
              }
            }
          },
          onError: (e) => {
            // 101 / 150 = embedding disabled by owner
            // 100 = video not found, 2 = invalid parameter, 5 = HTML5 error
            // For any of these, auto-skip to the next random video.
            if (!socket) return;
            if ([2, 5, 100, 101, 150].includes(e.data)) {
              socket.emit(EVENTS.BODYCAM_ACTION, { type: 'next' });
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try { ytPlayerRef.current?.destroy?.(); } catch {}
      ytPlayerRef.current = null;
      ytReadyRef.current = false;
      if (seekWatchdogRef.current) clearInterval(seekWatchdogRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply incoming server state to local player
  useEffect(() => {
    if (!socket) return;
    const pendingStateRef = { current: null };
    function applyState(payload) {
      if (!payload || !ytReadyRef.current || !ytPlayerRef.current) {
        // Stash payload for when player becomes ready
        pendingStateRef.current = payload;
        return;
      }
      const { videoId, time, paused, serverTime } = payload;
      const anchorServerTime = serverTime || Date.now();
      const networkDelay = Math.max(0, (Date.now() - anchorServerTime) / 1000);
      // Initial target uses the network delay so far — the onStateChange
      // "playing" handler will re-seek once the player actually starts,
      // which accounts for the extra embed-load time on top of this.
      const target = paused ? time : time + networkDelay;
      lastRemoteTimeRef.current = target;
      // Suppress our own seek-detection briefly so we don't echo the remote seek
      suppressSeekUntilRef.current = Date.now() + 2500;

      if (videoId !== currentVideoIdRef.current) {
        currentVideoIdRef.current = videoId;
        // Store anchor BEFORE loadVideoById so the onStateChange(playing)
        // handler can compute the accurate target once playback begins.
        pendingSyncRef.current = {
          videoId,
          baseTime: time,
          serverTime: anchorServerTime,
          paused,
        };
        try { ytPlayerRef.current.loadVideoById({ videoId, startSeconds: target }); } catch {}
      } else {
        try {
          const cur = ytPlayerRef.current.getCurrentTime?.() ?? 0;
          if (Math.abs(cur - target) > 1.0) {
            ytPlayerRef.current.seekTo(target, true);
          }
        } catch {}
        try {
          if (paused) ytPlayerRef.current.pauseVideo?.();
          else ytPlayerRef.current.playVideo?.();
        } catch {}
      }
    }

    function onState(payload) { applyState(payload); }
    socket.on(EVENTS.BODYCAM_STATE, onState);

    // Flush any pending state once the player is ready
    const flushIv = setInterval(() => {
      if (ytReadyRef.current && pendingStateRef.current) {
        applyState(pendingStateRef.current);
        pendingStateRef.current = null;
      }
    }, 300);

    return () => {
      socket.off(EVENTS.BODYCAM_STATE, onState);
      clearInterval(flushIv);
    };
  }, [socket]);

  // Detect local seeks and broadcast them (user scrubbed the timeline)
  useEffect(() => {
    if (!socket || !streamReady) return;
    const iv = setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player || !ytReadyRef.current) return;
      try {
        const state = player.getPlayerState?.();
        const cur = player.getCurrentTime?.();
        if (typeof cur !== 'number') return;
        // Expected time advances by ~1s per tick when playing
        const expected = lastRemoteTimeRef.current + 1;
        lastRemoteTimeRef.current = cur;
        if (Date.now() < suppressSeekUntilRef.current) return;
        // State 1 = playing, 2 = paused, 3 = buffering
        if (state === 1 && Math.abs(cur - expected) > 2.5) {
          // Local seek detected → broadcast
          socket.emit(EVENTS.BODYCAM_ACTION, { type: 'seek', time: cur });
          suppressSeekUntilRef.current = Date.now() + 1500;
        }
      } catch {}
    }, 1000);
    seekWatchdogRef.current = iv;
    return () => clearInterval(iv);
  }, [socket, streamReady]);

  // Cooldowns
  const [explosionCD, setExplosionCD] = useState(0);
  const [spotlightCD, setSpotlightCD] = useState(0);
  const [weatherCD, setWeatherCD] = useState(0);
  const [tomatoCD, setTomatoCD] = useState(0);

  // Effects
  const [explosionParticles, setExplosionParticles] = useState([]);
  const [spotlights, setSpotlights] = useState([]);
  const [weatherEffect, setWeatherEffect] = useState(null);
  const [tomatoState, setTomatoState] = useState(null); // null | 'flying' | 'splat'

  // Quick gamble
  const [gambleResult, setGambleResult] = useState(null);

  const hideTimerRef = useRef(null);
  const particleId = useRef(0);

  // Unified cooldown ticker
  useEffect(() => {
    const hasAnyCooldown = explosionCD > 0 || spotlightCD > 0 || weatherCD > 0 || tomatoCD > 0;
    if (!hasAnyCooldown) return;
    const iv = setInterval(() => {
      setExplosionCD((c) => Math.max(0, c - 1));
      setSpotlightCD((c) => Math.max(0, c - 1));
      setWeatherCD((c) => Math.max(0, c - 1));
      setTomatoCD((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [explosionCD > 0 || spotlightCD > 0 || weatherCD > 0 || tomatoCD > 0]);

  // --- Socket listeners ---
  useEffect(() => {
    if (!socket) return;

    function onExplosion() {
      const particles = [];
      for (let i = 0; i < 40; i++) {
        particles.push({
          id: ++particleId.current,
          emoji: EXPLOSION_EMOJIS[Math.floor(Math.random() * EXPLOSION_EMOJIS.length)],
          x: 40 + Math.random() * 20,
          y: 40 + Math.random() * 20,
          dx: (Math.random() - 0.5) * 80,
          dy: (Math.random() - 0.5) * 80,
          size: 1.2 + Math.random() * 1.8,
          duration: 1.5 + Math.random() * 1.5,
          delay: Math.random() * 0.3,
        });
      }
      setExplosionParticles((prev) => [...prev, ...particles]);
    }

    function onSpotlight(data) {
      const spotId = ++particleId.current;
      // Find the player's name element in the leaderboard by searching for their nickname
      let rect = null;
      // Look for PlayerName elements — they have data we can search by text content
      const nameElements = document.querySelectorAll('[class*="standingName"], [class*="standingRow"], [class*="playerName"]');
      for (const el of nameElements) {
        if (el.textContent?.includes(data.nickname)) {
          rect = el.getBoundingClientRect();
          break;
        }
      }
      setSpotlights((prev) => [...prev, { id: spotId, playerId: data.playerId, nickname: data.nickname, rect }]);
      setTimeout(() => setSpotlights((prev) => prev.filter((s) => s.id !== spotId)), 5000);
    }

    function onWeather(data) {
      const particles = [];
      const emoji = WEATHER_PARTICLES[data.effect] || '✨';
      for (let i = 0; i < 30; i++) {
        particles.push({
          id: ++particleId.current,
          emoji,
          x: Math.random() * 100,
          delay: Math.random() * 2,
          duration: 2 + Math.random() * 3,
          size: 0.8 + Math.random() * 1,
        });
      }
      setWeatherEffect({ effect: data.effect, particles });
      setTimeout(() => setWeatherEffect(null), 10000);
    }

    function onTomato() {
      setTomatoState('flying');
      // After arc completes (1.2s), show splat + play sound
      setTimeout(() => {
        setTomatoState('splat');
        try { playSound('tomatoSplat'); } catch {}
      }, 1200);
      // Clear after splat fades (another 1.5s)
      setTimeout(() => setTomatoState(null), 2700);
    }

    socket.on(EVENTS.EMOTESPLOSION_BROADCAST, onExplosion);
    socket.on(EVENTS.SPOTLIGHT_BROADCAST, onSpotlight);
    socket.on(EVENTS.WEATHER_BROADCAST, onWeather);
    socket.on(EVENTS.TOMATO_BROADCAST, onTomato);
    return () => {
      socket.off(EVENTS.EMOTESPLOSION_BROADCAST, onExplosion);
      socket.off(EVENTS.SPOTLIGHT_BROADCAST, onSpotlight);
      socket.off(EVENTS.WEATHER_BROADCAST, onWeather);
      socket.off(EVENTS.TOMATO_BROADCAST, onTomato);
    };
  }, [socket]);

  // --- Handlers ---
  function handleExplosion() {
    if (explosionCD > 0 || !socket) return;
    socket.emit(EVENTS.EMOTESPLOSION_SEND);
    setExplosionCD(EXPLOSION_COOLDOWN);
  }

  function handleSpotlight() {
    if (spotlightCD > 0 || !socket) return;
    socket.emit(EVENTS.SPOTLIGHT_SEND);
    setSpotlightCD(SPOTLIGHT_COOLDOWN);
  }

  function handleWeather() {
    if (weatherCD > 0 || !socket) return;
    socket.emit(EVENTS.WEATHER_SEND);
    setWeatherCD(WEATHER_COOLDOWN);
  }

  function handleTomato() {
    if (tomatoCD > 0 || !socket) return;
    socket.emit(EVENTS.TOMATO_SEND);
    setTomatoCD(TOMATO_COOLDOWN);
  }

  function handleGamble() {
    if (gambleResult) return; // wait for previous result to clear
    const won = Math.random() >= 0.5;
    addCoins(won ? 5 : -5);
    setGambleResult(won ? 'win' : 'lose');
    setTimeout(() => setGambleResult(null), 1500);
  }

  function handleBodycamNext() {
    socket?.emit(EVENTS.BODYCAM_ACTION, { type: 'next' });
  }

  function handleBodycamPrev() {
    socket?.emit(EVENTS.BODYCAM_ACTION, { type: 'prev' });
  }

  function handleVolumeToggle() {
    setVolumeOpen((o) => !o);
  }

  function handleVolumeChange(e) {
    const v = Number(e.target.value);
    setStreamVolume(v);
    const player = ytPlayerRef.current;
    if (!player || !ytReadyRef.current) return;
    try {
      if (v === 0) {
        player.mute?.();
        setStreamMuted(true);
      } else {
        player.unMute?.();
        player.setVolume?.(v);
        setStreamMuted(false);
      }
    } catch {}
  }

  function handleVolumeMuteClick() {
    const player = ytPlayerRef.current;
    if (!player || !ytReadyRef.current) return;
    try {
      if (streamMuted) {
        const vol = streamVolume > 0 ? streamVolume : 60;
        player.unMute?.();
        player.setVolume?.(vol);
        setStreamMuted(false);
        if (streamVolume === 0) setStreamVolume(vol);
      } else {
        player.mute?.();
        setStreamMuted(true);
      }
    } catch {}
  }

  // Click-outside to close volume popup
  useEffect(() => {
    if (!volumeOpen) return;
    function onDown(e) {
      if (volumeRef.current && !volumeRef.current.contains(e.target)) {
        setVolumeOpen(false);
      }
    }
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [volumeOpen]);

  function handleBodycamSkip(deltaSec) {
    const player = ytPlayerRef.current;
    if (!player || !ytReadyRef.current || !socket) return;
    try {
      const cur = player.getCurrentTime?.() ?? 0;
      const dur = player.getDuration?.() ?? 0;
      let target = cur + deltaSec;
      if (target < 0) target = 0;
      if (dur > 0 && target > dur - 1) target = Math.max(0, dur - 1);
      socket.emit(EVENTS.BODYCAM_ACTION, { type: 'seek', time: target });
    } catch {}
  }

  function removeParticle(id) {
    setExplosionParticles((prev) => prev.filter((p) => p.id !== id));
  }

  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}`;
  }

  const showLeaderboard = screen === 'gameVote' || screen === 'wagerPhase';

  return (
    <div className={styles.wrapper}>
      <div className={styles.streamBox}>
        <div className={styles.streamFrameWrap}>
          <div ref={playerContainerRef} className={styles.streamFrame} />
          {/* Full overlay blocks all clicks on the YouTube iframe */}
          <div className={styles.streamBlocker} />
        </div>
        <div className={styles.streamControls}>
          <button
            className={styles.ctrlBtn}
            onClick={handleBodycamPrev}
            title="Previous random bodycam video"
          >
            ⏮
          </button>
          <button
            className={styles.ctrlBtn}
            onClick={() => handleBodycamSkip(-30)}
            title="Rewind 30 seconds"
          >
            −30s
          </button>
          <button
            className={styles.ctrlBtn}
            onClick={() => handleBodycamSkip(30)}
            title="Forward 30 seconds"
          >
            +30s
          </button>
          <button
            className={styles.ctrlBtn}
            onClick={handleBodycamNext}
            title="Next random bodycam video"
          >
            ⏭
          </button>
          <div className={styles.volumeWrap} ref={volumeRef}>
            <button
              className={styles.ctrlBtn}
              onClick={handleVolumeToggle}
              title="Volume"
            >
              {streamMuted || streamVolume === 0 ? '🔇' : streamVolume < 40 ? '🔈' : '🔊'}
            </button>
            {volumeOpen && (
              <div className={styles.volumePopup}>
                <button
                  className={styles.volumeMuteBtn}
                  onClick={handleVolumeMuteClick}
                  title={streamMuted ? 'Unmute' : 'Mute'}
                >
                  {streamMuted ? '🔇' : '🔊'}
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={streamMuted ? 0 : streamVolume}
                  onChange={handleVolumeChange}
                  className={styles.volumeSlider}
                />
                <span className={styles.volumeLabel}>
                  {streamMuted ? 0 : streamVolume}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      {children && <div className={styles.extraPanel}>{children}</div>}
      <div className={styles.bottomRow}>
        <div className={styles.petScroll}>
          <PetSidebar />
        </div>
        <div className={styles.buttonStrip}>
          {/* Emotesplosion */}
          <button className={styles.stripBtn} onClick={handleExplosion} disabled={explosionCD > 0}
            title={explosionCD > 0 ? `Wait ${fmt(explosionCD)}` : 'Emotesplosion!'}>
            {explosionCD > 0 ? <span className={styles.stripCooldown}>{fmt(explosionCD)}</span> : <span>💥</span>}
          </button>

          {/* Spotlight — only when leaderboard visible */}
          {showLeaderboard && (
            <button className={styles.stripBtn} onClick={handleSpotlight} disabled={spotlightCD > 0}
              title={spotlightCD > 0 ? `Wait ${fmt(spotlightCD)}` : 'Spotlight!'}>
              {spotlightCD > 0 ? <span className={styles.stripCooldown}>{fmt(spotlightCD)}</span> : <span>🔦</span>}
            </button>
          )}

          {/* Weather Change */}
          <button className={styles.stripBtn} onClick={handleWeather} disabled={weatherCD > 0}
            title={weatherCD > 0 ? `Wait ${fmt(weatherCD)}` : 'Weather Effect!'}>
            {weatherCD > 0 ? <span className={styles.stripCooldown}>{fmt(weatherCD)}</span> : <span>🌧️</span>}
          </button>

          {/* Tomato */}
          <button className={styles.stripBtn} onClick={handleTomato} disabled={tomatoCD > 0}
            title={tomatoCD > 0 ? `Wait ${fmt(tomatoCD)}` : 'Tomato!'}>
            {tomatoCD > 0 ? <span className={styles.stripCooldown}>{fmt(tomatoCD)}</span> : <span>🍅</span>}
          </button>

          {/* Spacer */}
          <div className={styles.stripSpacer} />

          {/* Quick Gamble — buddy coins, always at bottom */}
          <button
            className={`${styles.stripBtn} ${gambleResult === 'win' ? styles.stripBtnWin : ''} ${gambleResult === 'lose' ? styles.stripBtnLose : ''}`}
            onClick={handleGamble}
            disabled={!!gambleResult}
            title="Buddy Coin Flip — 50/50 for ±5 coins"
          >
            {gambleResult === 'win' ? <span>+5</span> :
             gambleResult === 'lose' ? <span>-5</span> :
             <span>🎰</span>}
          </button>
        </div>
      </div>

      {/* Emotesplosion particles */}
      {explosionParticles.map((p) => (
        <span key={p.id} className={styles.explosionParticle} style={{
          left: `${p.x}%`, top: `${p.y}%`, fontSize: `${p.size}rem`,
          '--dx': `${p.dx}vw`, '--dy': `${p.dy}vh`,
          animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s`,
        }} onAnimationEnd={() => removeParticle(p.id)}>{p.emoji}</span>
      ))}

      {/* Spotlight — dim screen + bright oval cutout over player name */}
      {spotlights.map((s) => (
        <div key={s.id} className={styles.spotlightOverlay}
          style={s.rect ? {
            '--spot-x': `${s.rect.left + s.rect.width / 2}px`,
            '--spot-y': `${s.rect.top + s.rect.height / 2}px`,
            '--spot-w': `${Math.max(s.rect.width + 80, 220)}px`,
            '--spot-h': `${s.rect.height + 50}px`,
          } : {}}>
        </div>
      ))}

      {/* Weather particles */}
      {/* Weather overlay + particles */}
      {weatherEffect && (
        <>
          <div className={`${styles.weatherOverlay} ${styles[`weather_${weatherEffect.effect}`] || ''}`} />
          {weatherEffect.particles.map((p) => (
            <span key={p.id}
              className={`${styles.weatherParticle} ${weatherEffect.effect === 'rain' ? styles.weatherStraight : ''}`}
              style={{
                left: `${p.x}%`, fontSize: `${p.size}rem`,
                animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s`,
              }} onAnimationEnd={() => setWeatherEffect((w) => w ? { ...w, particles: w.particles.filter((pp) => pp.id !== p.id) } : null)}>
              {p.emoji}
            </span>
          ))}
        </>
      )}

      {/* Tomato throw animation */}
      {tomatoState === 'flying' && (
        <span className={styles.tomatoFlying}>🍅</span>
      )}
      {tomatoState === 'splat' && (
        <span className={styles.tomatoSplat}>💥</span>
      )}
    </div>
  );
}
