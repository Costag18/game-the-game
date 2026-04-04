import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './ImageOverlay.module.css';

const BROADCAST_COOLDOWN = 10; // seconds — matches server rate limit
let flyIdCounter = 0;

export default function ImageOverlay({ isOpen, onToggle, onRequestClose }) {
  const { socket } = useSocketContext();
  const [tab, setTab] = useState('ai'); // 'ai' | 'search'
  const [prompt, setPrompt] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [flyingImages, setFlyingImages] = useState([]);
  const cooldownRef = useRef(null);
  const errorTimeoutRef = useRef(null);
  const debounceRef = useRef(null);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) { clearInterval(cooldownRef.current); return; }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown > 0]);

  // Listen for image broadcasts from all players
  useEffect(() => {
    if (!socket) return;
    function onBroadcast(data) {
      const direction = Math.random() > 0.5 ? 'ltr' : 'rtl';
      const top = 15 + Math.random() * 50;
      setFlyingImages((prev) => [...prev, {
        id: ++flyIdCounter,
        url: data.imageUrl,
        nickname: data.nickname,
        direction,
        top,
      }]);
      setGenerating(false);
    }
    socket.on(EVENTS.AI_IMAGE_BROADCAST, onBroadcast);
    return () => socket.off(EVENTS.AI_IMAGE_BROADCAST, onBroadcast);
  }, [socket]);

  // Listen for errors
  useEffect(() => {
    if (!socket) return;
    function onError(data) {
      setGenerating(false);
      setError(data?.error || 'Failed');
      setCooldown(0);
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setError(''), 10000);
    }
    socket.on(EVENTS.AI_IMAGE_ERROR, onError);
    return () => {
      socket.off(EVENTS.AI_IMAGE_ERROR, onError);
      clearTimeout(errorTimeoutRef.current);
    };
  }, [socket]);

  // Debounced search
  useEffect(() => {
    if (tab !== 'search' || !isOpen) return;
    clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const resp = await fetch(`/api/image-search?q=${encodeURIComponent(searchQuery)}`);
        const json = await resp.json();
        setSearchResults(json.results || []);
      } catch { setSearchResults([]); }
      setSearchLoading(false);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, tab, isOpen]);

  const removeFlyingImage = useCallback((id) => {
    setFlyingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  function sendImage(imageUrl) {
    if (cooldown > 0 || !socket) return;
    socket.emit(EVENTS.AI_IMAGE_SEND, { imageUrl });
    setCooldown(BROADCAST_COOLDOWN);
    setError('');
  }

  async function handleGenerate() {
    if (generating || cooldown > 0 || !prompt.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const result = await window.puter?.ai?.txt2img?.(prompt.trim());
      if (!result) throw new Error('Puter.js not available');
      // result is a Blob or base64 depending on model
      let imageUrl;
      if (result instanceof Blob) {
        imageUrl = URL.createObjectURL(result);
      } else if (typeof result === 'string') {
        imageUrl = result.startsWith('data:') ? result : `data:image/png;base64,${result}`;
      } else if (result?.src) {
        imageUrl = result.src;
      } else {
        throw new Error('Unexpected result format');
      }
      sendImage(imageUrl);
      setGenerating(false);
    } catch (err) {
      setGenerating(false);
      setError(err.message || 'AI generation failed');
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setError(''), 10000);
    }
  }

  function handleSearchSelect(img) {
    sendImage(img.url);
    onRequestClose();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (tab === 'ai') handleGenerate();
    }
  }

  return (
    <>
      {/* Trigger button */}
      <button
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`}
        onClick={onToggle}
        title={cooldown > 0 ? `Wait ${cooldown}s` : 'Send an image'}
      >
        {cooldown > 0 ? (
          <span className={styles.cooldownText}>{cooldown}</span>
        ) : (
          <span>🎨</span>
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className={styles.panel}>
          {/* Tabs */}
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === 'ai' ? styles.tabActive : ''}`}
              onClick={() => setTab('ai')}
            >
              AI Generate
            </button>
            <button
              className={`${styles.tab} ${tab === 'search' ? styles.tabActive : ''}`}
              onClick={() => setTab('search')}
            >
              Search Photos
            </button>
          </div>

          {/* AI Generate tab */}
          {tab === 'ai' && (
            <>
              <textarea
                className={styles.promptInput}
                placeholder="Describe an image..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 200))}
                onKeyDown={handleKeyDown}
                maxLength={200}
                autoFocus
                disabled={generating}
              />
              <div className={styles.actions}>
                <span className={styles.charCount}>{prompt.length}/200</span>
                {generating ? (
                  <div className={styles.generating}>
                    <div className={styles.spinner} />
                    Generating...
                  </div>
                ) : (
                  <button
                    className={styles.generateBtn}
                    onClick={handleGenerate}
                    disabled={!prompt.trim() || cooldown > 0}
                  >
                    Generate
                  </button>
                )}
              </div>
            </>
          )}

          {/* Search Photos tab */}
          {tab === 'search' && (
            <>
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Search photos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className={styles.searchGrid}>
                {searchLoading && <div className={styles.searchMsg}>Searching...</div>}
                {!searchLoading && searchQuery && searchResults.length === 0 && (
                  <div className={styles.searchMsg}>No photos found</div>
                )}
                {searchResults.map((img) => (
                  <button
                    key={img.id}
                    className={styles.searchThumb}
                    onClick={() => handleSearchSelect(img)}
                    disabled={cooldown > 0}
                    title={img.alt}
                  >
                    <img src={img.thumb} alt={img.alt} loading="lazy" />
                  </button>
                ))}
              </div>
            </>
          )}

          {error && <div className={styles.errorText}>{error}</div>}
          <div className={styles.attribution}>
            {tab === 'ai' ? 'Powered by Puter AI' : 'Photos by Pexels'}
          </div>
        </div>
      )}

      {/* Flying images */}
      {flyingImages.map((img) => (
        <div
          key={img.id}
          className={`${styles.flyingImage} ${img.direction === 'ltr' ? styles.flyLTR : styles.flyRTL}`}
          style={{ top: `${img.top}%` }}
          onAnimationEnd={() => removeFlyingImage(img.id)}
        >
          <img src={img.url} alt="" className={styles.flyingImg} />
          <span className={styles.flyingName}>{img.nickname}</span>
        </div>
      ))}
    </>
  );
}
