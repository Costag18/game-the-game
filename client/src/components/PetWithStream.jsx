import { useState, useRef, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import PetSidebar from './PetSidebar.jsx';
import styles from './PetWithStream.module.css';

const STREAM_ID = '5vfaDsMhCF4'; // CBC News 24/7 live
const EXPLOSION_COOLDOWN = 60; // 1 minute
const EXPLOSION_EMOJIS = ['😂', '😮', '👏', '😭', '🔥', '❤️', '💀', '🎉', '💥', '✨', '🎆', '🎇'];

export default function PetWithStream({ children }) {
  const { socket } = useSocketContext();
  const [showControls, setShowControls] = useState(false);
  const [explosionCooldown, setExplosionCooldown] = useState(0);
  const [explosionParticles, setExplosionParticles] = useState([]);
  const hideTimerRef = useRef(null);
  const cooldownRef = useRef(null);
  let particleId = useRef(0);

  // Cooldown timer
  useEffect(() => {
    if (explosionCooldown <= 0) { clearInterval(cooldownRef.current); return; }
    cooldownRef.current = setInterval(() => {
      setExplosionCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [explosionCooldown > 0]);

  // Listen for emotesplosion broadcasts
  useEffect(() => {
    if (!socket) return;
    function onExplosion() {
      const particles = [];
      for (let i = 0; i < 40; i++) {
        particles.push({
          id: ++particleId.current,
          emoji: EXPLOSION_EMOJIS[Math.floor(Math.random() * EXPLOSION_EMOJIS.length)],
          x: 40 + Math.random() * 20, // center-ish
          y: 40 + Math.random() * 20,
          dx: (Math.random() - 0.5) * 80, // spread
          dy: (Math.random() - 0.5) * 80,
          size: 1.2 + Math.random() * 1.8,
          duration: 1.5 + Math.random() * 1.5,
          delay: Math.random() * 0.3,
        });
      }
      setExplosionParticles((prev) => [...prev, ...particles]);
    }
    socket.on(EVENTS.EMOTESPLOSION_BROADCAST, onExplosion);
    return () => socket.off(EVENTS.EMOTESPLOSION_BROADCAST, onExplosion);
  }, [socket]);

  function handleExplosion() {
    if (explosionCooldown > 0 || !socket) return;
    socket.emit(EVENTS.EMOTESPLOSION_SEND);
    setExplosionCooldown(EXPLOSION_COOLDOWN);
  }

  function handleOverlayClick() {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 5000);
  }

  function removeParticle(id) {
    setExplosionParticles((prev) => prev.filter((p) => p.id !== id));
  }

  function formatCooldown(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}`;
  }

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
          <button
            className={styles.stripBtn}
            onClick={handleExplosion}
            disabled={explosionCooldown > 0}
            title={explosionCooldown > 0 ? `Wait ${formatCooldown(explosionCooldown)}` : 'Emotesplosion!'}
          >
            {explosionCooldown > 0 ? (
              <span className={styles.stripCooldown}>{formatCooldown(explosionCooldown)}</span>
            ) : (
              <span>💥</span>
            )}
          </button>
        </div>
      </div>

      {/* Emotesplosion particles */}
      {explosionParticles.map((p) => (
        <span
          key={p.id}
          className={styles.explosionParticle}
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            fontSize: `${p.size}rem`,
            '--dx': `${p.dx}vw`,
            '--dy': `${p.dy}vh`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
          onAnimationEnd={() => removeParticle(p.id)}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
