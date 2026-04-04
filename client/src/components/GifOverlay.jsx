import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './GifOverlay.module.css';

const GIF_COOLDOWN = 12; // seconds — matches server rate limit
let flyIdCounter = 0;

export default function GifOverlay({ isOpen, onToggle, onRequestClose }) {
  const { socket } = useSocketContext();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [flyingGifs, setFlyingGifs] = useState([]);
  const debounceRef = useRef(null);
  const cooldownRef = useRef(null);

  // Fetch GIFs from our server proxy
  const fetchGifs = useCallback(async (q) => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/gif-search?q=${encodeURIComponent(q || 'reactions')}`);
      const json = await resp.json();
      setResults(json?.data?.data || []);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, []);

  // Load default GIFs when panel opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      fetchGifs('reactions');
    }
  }, [isOpen, fetchGifs]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    clearTimeout(debounceRef.current);
    if (query.trim().length === 0) {
      fetchGifs('reactions');
      return;
    }
    debounceRef.current = setTimeout(() => fetchGifs(query), 400);
    return () => clearTimeout(debounceRef.current);
  }, [query, isOpen, fetchGifs]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) { clearInterval(cooldownRef.current); return; }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown > 0]);

  // Listen for GIF broadcasts from all players
  useEffect(() => {
    if (!socket) return;
    function onGifBroadcast(data) {
      const direction = Math.random() > 0.5 ? 'ltr' : 'rtl';
      const top = 15 + Math.random() * 50; // 15-65% from top
      setFlyingGifs((prev) => [...prev, {
        id: ++flyIdCounter,
        url: data.url,
        nickname: data.nickname,
        direction,
        top,
      }]);
    }
    socket.on(EVENTS.GIF_BROADCAST, onGifBroadcast);
    return () => socket.off(EVENTS.GIF_BROADCAST, onGifBroadcast);
  }, [socket]);

  const removeFlyingGif = useCallback((id) => {
    setFlyingGifs((prev) => prev.filter((g) => g.id !== id));
  }, []);

  function sendGif(gif) {
    if (cooldown > 0) return;
    // Prefer webp sm, fall back through available formats
    const url = gif?.file?.sm?.webp?.url
      || gif?.file?.sm?.gif?.url
      || gif?.file?.md?.webp?.url
      || gif?.file?.md?.gif?.url
      || gif?.file?.hd?.webp?.url
      || gif?.file?.hd?.gif?.url;
    if (!url) return;
    socket?.emit(EVENTS.GIF_SEND, { url });
    setCooldown(GIF_COOLDOWN);
    onRequestClose();
  }

  // Get thumbnail URL for the grid
  function getThumbUrl(gif) {
    return gif?.file?.xs?.webp?.url
      || gif?.file?.xs?.gif?.url
      || gif?.file?.sm?.webp?.url
      || gif?.file?.sm?.gif?.url
      || '';
  }

  return (
    <>
      {/* GIF trigger button */}
      <button
        className={`${styles.gifTrigger} ${isOpen ? styles.gifTriggerOpen : ''}`}
        onClick={onToggle}
        title={cooldown > 0 ? `Wait ${cooldown}s` : 'Send a GIF'}
        disabled={false}
      >
        {cooldown > 0 ? (
          <span className={styles.cooldownText}>{cooldown}</span>
        ) : (
          <span className={styles.gifLabel}>GIF</span>
        )}
      </button>

      {/* Search panel */}
      {isOpen && (
        <div className={styles.gifPanel}>
          <input
            className={styles.gifSearch}
            type="text"
            placeholder="Search GIFs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className={styles.gifGrid}>
            {loading && results.length === 0 && (
              <div className={styles.gifLoading}>Searching...</div>
            )}
            {!loading && results.length === 0 && (
              <div className={styles.gifLoading}>No GIFs found</div>
            )}
            {results.map((gif) => {
              const thumb = getThumbUrl(gif);
              if (!thumb) return null;
              return (
                <button
                  key={gif.id}
                  className={styles.gifThumbBtn}
                  onClick={() => sendGif(gif)}
                  disabled={cooldown > 0}
                  title={gif.title || 'Send GIF'}
                >
                  <img
                    src={thumb}
                    alt={gif.title || 'GIF'}
                    className={styles.gifThumb}
                    loading="lazy"
                  />
                </button>
              );
            })}
          </div>
          <div className={styles.gifAttribution}>Powered by Klipy</div>
        </div>
      )}

      {/* Flying GIFs across the screen */}
      {flyingGifs.map((g) => (
        <div
          key={g.id}
          className={`${styles.flyingGif} ${g.direction === 'ltr' ? styles.flyLTR : styles.flyRTL}`}
          style={{ top: `${g.top}%` }}
          onAnimationEnd={() => removeFlyingGif(g.id)}
        >
          <img src={g.url} alt="GIF" className={styles.flyingGifImg} />
          <span className={styles.flyingGifName}>{g.nickname}</span>
        </div>
      ))}
    </>
  );
}
