import { useState, useRef, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import PetSidebar from './PetSidebar.jsx';
import styles from './PetWithStream.module.css';

const STREAM_ID = '5vfaDsMhCF4'; // CBC News 24/7 live
const EXPLOSION_COOLDOWN = 60;
const SPOTLIGHT_COOLDOWN = 180;
const WEATHER_COOLDOWN = 120;
const EXPLOSION_EMOJIS = ['😂', '😮', '👏', '😭', '🔥', '❤️', '💀', '🎉', '💥', '✨', '🎆', '🎇'];
const WEATHER_EMOJIS = { rain: '🌧️', snow: '❄️', confetti: '🎊', stars: '⭐', hearts: '💕' };
const WEATHER_PARTICLES = { rain: '💧', snow: '❄️', confetti: '🎊', stars: '⭐', hearts: '❤️' };

export default function PetWithStream({ children, screen }) {
  const { socket } = useSocketContext();
  const { playSound } = useSound();
  const [showControls, setShowControls] = useState(false);

  // Cooldowns
  const [explosionCD, setExplosionCD] = useState(0);
  const [spotlightCD, setSpotlightCD] = useState(0);
  const [weatherCD, setWeatherCD] = useState(0);

  // Effects
  const [explosionParticles, setExplosionParticles] = useState([]);
  const [spotlights, setSpotlights] = useState([]); // [{playerId, nickname, id}]
  const [weatherEffect, setWeatherEffect] = useState(null); // {effect, particles}

  // Quick gamble
  const [gambleResult, setGambleResult] = useState(null); // 'win' | 'lose' | null
  const [gambleFlipping, setGambleFlipping] = useState(false);

  const hideTimerRef = useRef(null);
  const particleId = useRef(0);

  // Unified cooldown ticker
  useEffect(() => {
    const hasAnyCooldown = explosionCD > 0 || spotlightCD > 0 || weatherCD > 0;
    if (!hasAnyCooldown) return;
    const iv = setInterval(() => {
      setExplosionCD((c) => Math.max(0, c - 1));
      setSpotlightCD((c) => Math.max(0, c - 1));
      setWeatherCD((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [explosionCD > 0 || spotlightCD > 0 || weatherCD > 0]);

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
      const id = ++particleId.current;
      setSpotlights((prev) => [...prev, { id, playerId: data.playerId, nickname: data.nickname }]);
      // Auto-remove after 5s
      setTimeout(() => setSpotlights((prev) => prev.filter((s) => s.id !== id)), 5000);
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
      // Clear after 10s
      setTimeout(() => setWeatherEffect(null), 10000);
    }

    function onCoinResult(data) {
      setGambleFlipping(false);
      setGambleResult(data.won ? 'win' : 'lose');
      setTimeout(() => setGambleResult(null), 2000);
    }

    socket.on(EVENTS.EMOTESPLOSION_BROADCAST, onExplosion);
    socket.on(EVENTS.SPOTLIGHT_BROADCAST, onSpotlight);
    socket.on(EVENTS.WEATHER_BROADCAST, onWeather);
    socket.on(EVENTS.COIN_FLIP_RESULT, onCoinResult);
    return () => {
      socket.off(EVENTS.EMOTESPLOSION_BROADCAST, onExplosion);
      socket.off(EVENTS.SPOTLIGHT_BROADCAST, onSpotlight);
      socket.off(EVENTS.WEATHER_BROADCAST, onWeather);
      socket.off(EVENTS.COIN_FLIP_RESULT, onCoinResult);
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

  function handleGamble() {
    if (gambleFlipping || !socket) return;
    const choice = Math.random() > 0.5 ? 'heads' : 'tails';
    setGambleFlipping(true);
    setGambleResult(null);
    socket.emit(EVENTS.COIN_FLIP, { amount: 5, choice });
  }

  function handleOverlayClick() {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 5000);
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
        <iframe
          src={`https://www.youtube.com/embed/${STREAM_ID}?autoplay=1&mute=1&controls=1&modestbranding=1`}
          title="CBC News Live"
          allow="autoplay; encrypted-media"
          allowFullScreen
          className={styles.streamFrame}
        />
        {!showControls && (
          <div className={styles.streamOverlay} onClick={handleOverlayClick} />
        )}
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

          {/* Spacer to push gamble to bottom */}
          <div className={styles.stripSpacer} />

          {/* Quick Gamble — always at bottom */}
          <button
            className={`${styles.stripBtn} ${gambleResult === 'win' ? styles.stripBtnWin : ''} ${gambleResult === 'lose' ? styles.stripBtnLose : ''}`}
            onClick={handleGamble}
            disabled={gambleFlipping}
            title="Quick Gamble — 5 coins"
          >
            {gambleFlipping ? <span className={styles.stripCooldown}>...</span> :
             gambleResult === 'win' ? <span>💰</span> :
             gambleResult === 'lose' ? <span>💸</span> :
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

      {/* Spotlight overlays */}
      {spotlights.map((s) => (
        <div key={s.id} className={styles.spotlightOverlay}>
          <div className={styles.spotlightBeam} />
          <span className={styles.spotlightName}>🔦 {s.nickname}</span>
        </div>
      ))}

      {/* Weather particles */}
      {weatherEffect && weatherEffect.particles.map((p) => (
        <span key={p.id} className={styles.weatherParticle} style={{
          left: `${p.x}%`, fontSize: `${p.size}rem`,
          animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s`,
        }} onAnimationEnd={() => setWeatherEffect((w) => w ? { ...w, particles: w.particles.filter((pp) => pp.id !== p.id) } : null)}>
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
