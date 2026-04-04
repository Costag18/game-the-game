import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './AiImageOverlay.module.css';

const AI_COOLDOWN = 20; // seconds — matches server rate limit
let flyIdCounter = 0;

export default function AiImageOverlay({ isOpen, onToggle, onRequestClose }) {
  const { socket } = useSocketContext();
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [flyingImages, setFlyingImages] = useState([]);
  const cooldownRef = useRef(null);
  const errorTimeoutRef = useRef(null);
  const genTimeoutRef = useRef(null);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) { clearInterval(cooldownRef.current); return; }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown > 0]);

  // Listen for AI image broadcasts from all players
  useEffect(() => {
    if (!socket) return;
    function onAiBroadcast(data) {
      const direction = Math.random() > 0.5 ? 'ltr' : 'rtl';
      const top = 15 + Math.random() * 50; // 15-65% from top
      setFlyingImages((prev) => [...prev, {
        id: ++flyIdCounter,
        url: data.imageUrl,
        nickname: data.nickname,
        direction,
        top,
      }]);
      clearTimeout(genTimeoutRef.current);
      setGenerating(false);
    }
    socket.on(EVENTS.AI_IMAGE_BROADCAST, onAiBroadcast);
    return () => socket.off(EVENTS.AI_IMAGE_BROADCAST, onAiBroadcast);
  }, [socket]);

  // Listen for errors (only sent to the requesting player)
  useEffect(() => {
    if (!socket) return;
    function onAiError(data) {
      clearTimeout(genTimeoutRef.current);
      setGenerating(false);
      setError(data?.error || 'Generation failed');
      setCooldown(0); // Allow retry on failure
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setError(''), 10000);
    }
    socket.on(EVENTS.AI_IMAGE_ERROR, onAiError);
    return () => {
      socket.off(EVENTS.AI_IMAGE_ERROR, onAiError);
      clearTimeout(errorTimeoutRef.current);
    };
  }, [socket]);

  const removeFlyingImage = useCallback((id) => {
    setFlyingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  function handleGenerate() {
    if (generating || cooldown > 0 || !prompt.trim()) return;
    socket?.emit(EVENTS.AI_IMAGE_SEND, { prompt: prompt.trim() });
    setGenerating(true);
    setError('');
    setCooldown(AI_COOLDOWN);
    // Safety timeout — if no broadcast or error arrives, reset after 90s
    clearTimeout(genTimeoutRef.current);
    genTimeoutRef.current = setTimeout(() => {
      setGenerating(false);
      setError('Generation timed out');
      setCooldown(0);
    }, 90000);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  }

  return (
    <>
      {/* AI trigger button */}
      <button
        className={`${styles.aiTrigger} ${isOpen ? styles.aiTriggerOpen : ''}`}
        onClick={onToggle}
        title={cooldown > 0 ? `Wait ${cooldown}s` : 'Generate AI image'}
      >
        {cooldown > 0 ? (
          <span className={styles.cooldownText}>{cooldown}</span>
        ) : (
          <span>🎨</span>
        )}
      </button>

      {/* Prompt panel */}
      {isOpen && (
        <div className={styles.aiPanel}>
          <textarea
            className={styles.aiPromptInput}
            placeholder="Describe an image..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, 200))}
            onKeyDown={handleKeyDown}
            maxLength={200}
            autoFocus
            disabled={generating}
          />
          {error && <div className={styles.errorText}>{error}</div>}
          <div className={styles.aiActions}>
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
          <div className={styles.aiAttribution}>Powered by FLUX</div>
        </div>
      )}

      {/* Flying AI images across the screen */}
      {flyingImages.map((img) => (
        <div
          key={img.id}
          className={`${styles.flyingAiImage} ${img.direction === 'ltr' ? styles.flyLTR : styles.flyRTL}`}
          style={{ top: `${img.top}%` }}
          onAnimationEnd={() => removeFlyingImage(img.id)}
        >
          <img src={img.url} alt="AI Generated" className={styles.flyingAiImg} />
          <span className={styles.flyingAiName}>{img.nickname}</span>
        </div>
      ))}
    </>
  );
}
