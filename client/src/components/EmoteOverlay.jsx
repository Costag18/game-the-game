import { useState, useEffect, useCallback } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import GifOverlay from './GifOverlay.jsx';
import styles from './EmoteOverlay.module.css';

const EMOTES = ['😂', '😮', '👏', '😭', '🔥', '❤️', '💀', '🎉'];
const WOBBLE_CLASSES = ['wobble1', 'wobble2', 'wobble3', 'wobble4'];

let idCounter = 0;

export default function EmoteOverlay() {
  const { socket } = useSocketContext();
  const { playSound } = useSound();
  const [menuOpen, setMenuOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [floaters, setFloaters] = useState([]);

  // Listen for incoming emote broadcasts
  useEffect(() => {
    if (!socket) return;
    function onBroadcast(data) {
      const count = 3 + Math.floor(Math.random() * 4); // 3-6 emojis per reaction
      const newFloaters = [];
      for (let i = 0; i < count; i++) {
        newFloaters.push({
          id: ++idCounter,
          emoji: data.emoji,
          left: 5 + Math.random() * 90,                          // 5-95% from left
          duration: 1.5 + Math.random() * 1.5,                   // 1.5-3s
          wobble: WOBBLE_CLASSES[Math.floor(Math.random() * WOBBLE_CLASSES.length)],
          delay: i * 0.08,                                       // slight stagger
          size: 1.6 + Math.random() * 1.2,                       // 1.6-2.8rem
        });
      }
      setFloaters((prev) => [...prev, ...newFloaters]);
    }
    socket.on(EVENTS.EMOTE_BROADCAST, onBroadcast);
    return () => socket.off(EVENTS.EMOTE_BROADCAST, onBroadcast);
  }, [socket]);

  // Clean up finished floaters
  const removeFloater = useCallback((id) => {
    setFloaters((prev) => prev.filter((f) => f.id !== id));
  }, []);

  function sendEmote(emoji) {
    socket?.emit(EVENTS.EMOTE_SEND, { emoji });
    setMenuOpen(false);
  }

  function toggleEmoteMenu() {
    setMenuOpen((o) => !o);
    setGifOpen(false);
    playSound('menuOpen');
  }

  function toggleGifPanel() {
    setGifOpen((o) => !o);
    setMenuOpen(false);
    playSound('menuOpen');
  }

  return (
    <div className={styles.emoteOverlay}>
      {/* Emote trigger bubble */}
      <button
        className={`${styles.emoteTrigger} ${menuOpen ? styles.emoteTriggerOpen : ''}`}
        onClick={toggleEmoteMenu}
        title="Send an emote"
      >
        😄
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className={styles.emoteMenu}>
          {EMOTES.map((emoji) => (
            <button
              key={emoji}
              className={styles.emoteBtn}
              onClick={() => sendEmote(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* GIF overlay (button + panel + flying GIFs) */}
      <GifOverlay
        isOpen={gifOpen}
        onToggle={toggleGifPanel}
        onRequestClose={() => setGifOpen(false)}
      />

      {/* Floating emojis */}
      {floaters.map((f) => (
        <span
          key={f.id}
          className={`${styles.floatingEmoji} ${styles[f.wobble]}`}
          style={{
            left: `${f.left}%`,
            fontSize: `${f.size}rem`,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
          }}
          onAnimationEnd={() => removeFloater(f.id)}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}
