import { useState, useEffect, useRef } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import { CoinFlipPanel, SlotsPanel, WheelPanel, BJLitePanel, ChickenPanel } from '../components/CasinoSidebar.jsx';
import PetSidebar from '../components/PetSidebar.jsx';
import { usePet } from '../context/PetContext.jsx';
import styles from './CasinoMode.module.css';

const CARD_DECORATIONS = [
  { tl: '7♦', br: '7♦' },
  { tl: 'Q♠', br: 'Q♠' },
  { tl: 'A♥', br: 'A♥' },
  { tl: 'K♣', br: 'K♣' },
  { tl: 'J♦', br: 'J♦' },
  { tl: '10♥', br: '10♥' },
];

const GAMES = [
  { key: 'coinflip', label: 'Coin Flip', Component: CoinFlipPanel, deco: 0 },
  { key: 'slots', label: 'Slots', Component: SlotsPanel, deco: 1 },
  { key: 'wheel', label: 'Wheel of Fortune', Component: WheelPanel, deco: 2 },
  { key: 'blackjack', label: 'Blackjack', Component: BJLitePanel, deco: 3 },
  { key: 'chicken', label: 'Chicken Cross', Component: ChickenPanel, deco: 4 },
];

function GameCard({ children, decoration }) {
  const { tl, br } = CARD_DECORATIONS[decoration] || CARD_DECORATIONS[0];
  return (
    <div className={styles.gameCard}>
      <span className={styles.cardCornerTL}>{tl}</span>
      <span className={styles.cardCornerTR}>{tl}</span>
      <div className={styles.gameCardInner}>
        {children}
      </div>
      <span className={styles.cardCornerBL}>{br}</span>
      <span className={styles.cardCornerBR}>{br}</span>
    </div>
  );
}

const PET_FACES = { happy: '😊', neutral: '😐', sad: '😢' };
const SLOT_LABELS = { head: '🎩 Head', neck: '👔 Neck', eyes: '👓 Eyes', side: '✨ Side' };

function BuddyCustomizer() {
  const { mood, equipped, shopItems, equip, setMoodOverride, moodOverride } = usePet();

  const headItem = shopItems.find((i) => i.id === equipped?.head);
  const neckItem = shopItems.find((i) => i.id === equipped?.neck);
  const eyesItem = shopItems.find((i) => i.id === equipped?.eyes);
  const sideItem = shopItems.find((i) => i.id === equipped?.side);

  // Group items by slot
  const slots = {};
  for (const item of shopItems) {
    if (!slots[item.slot]) slots[item.slot] = [];
    slots[item.slot].push(item);
  }

  return (
    <div className={styles.customizer}>
      <h3 className={styles.customizerTitle}>Customize Buddy</h3>
      <div className={styles.customizerPreview}>
        {headItem?.id === 'rainbow' && <span className={styles.cAccessoryRainbow}>{headItem.emoji}</span>}
        {headItem?.id === 'sparkles' && <span className={styles.cAccessorySparkles}>{headItem.emoji}</span>}
        {headItem?.id === 'helmet' && <span className={styles.cAccessoryHelmet}>{headItem.emoji}</span>}
        {headItem && !['rainbow', 'sparkles', 'helmet'].includes(headItem.id) && <span className={styles.cAccessoryTop}>{headItem.emoji}</span>}
        {eyesItem && <span className={styles.cAccessoryEyes}>{eyesItem.emoji}</span>}
        <span className={styles.cFace}>{PET_FACES[mood]}</span>
        {neckItem && <span className={styles.cAccessoryNeck}>{neckItem.emoji}</span>}
        {sideItem && <span className={styles.cAccessorySide}>{sideItem.emoji}</span>}
      </div>
      <div className={styles.customizerMood}>
        <span className={styles.customizerSlotLabel}>Mood</span>
        <div className={styles.customizerItems}>
          {[
            { id: null, emoji: '🔄', label: 'Auto' },
            { id: 'happy', emoji: '😊', label: 'Happy' },
            { id: 'neutral', emoji: '😐', label: 'Neutral' },
            { id: 'sad', emoji: '😢', label: 'Sad' },
          ].map((m) => (
            <button
              key={m.id || 'auto'}
              className={`${styles.customizerItem} ${moodOverride === m.id ? styles.customizerItemActive : (!moodOverride && !m.id ? styles.customizerItemActive : '')}`}
              onClick={() => setMoodOverride(m.id)}
              title={m.label}
            >
              {m.emoji}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.customizerHint}>All items unlocked — try them on!</p>
      {Object.entries(slots).map(([slot, items]) => (
        <div key={slot} className={styles.customizerSlot}>
          <span className={styles.customizerSlotLabel}>{SLOT_LABELS[slot] || slot}</span>
          <div className={styles.customizerItems}>
            <button
              className={`${styles.customizerItem} ${!equipped?.[slot] ? styles.customizerItemActive : ''}`}
              onClick={() => equip(equipped?.[slot] || items[0]?.id)}
            >
              ❌
            </button>
            {items.map((item) => (
              <button
                key={item.id}
                className={`${styles.customizerItem} ${equipped?.[slot] === item.id ? styles.customizerItemActive : ''}`}
                onClick={() => equip(item.id)}
                title={item.name}
              >
                {item.emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const AI_COOLDOWN = 20;

function ImageGenerator({ socket }) {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) { clearInterval(cooldownRef.current); return; }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown > 0]);

  useEffect(() => {
    if (!socket) return;
    function onBroadcast(data) {
      if (data.imageUrl) {
        setImage(data.imageUrl);
        setGenerating(false);
      }
    }
    function onError(data) {
      setError(data?.error || 'Generation failed');
      setGenerating(false);
      setCooldown(0);
    }
    socket.on(EVENTS.AI_IMAGE_BROADCAST, onBroadcast);
    socket.on(EVENTS.AI_IMAGE_ERROR, onError);
    return () => {
      socket.off(EVENTS.AI_IMAGE_BROADCAST, onBroadcast);
      socket.off(EVENTS.AI_IMAGE_ERROR, onError);
    };
  }, [socket]);

  function handleGenerate() {
    if (generating || cooldown > 0 || !prompt.trim()) return;
    socket?.emit(EVENTS.AI_IMAGE_SEND, { prompt: prompt.trim() });
    setGenerating(true);
    setError('');
    setImage(null);
    setCooldown(AI_COOLDOWN);
  }

  return (
    <div className={styles.imageGen}>
      <h3 className={styles.imageGenTitle}>AI Image Generator</h3>
      <div className={styles.imageGenPreview}>
        {generating ? (
          <div className={styles.imageGenSpinner}>Generating...</div>
        ) : image ? (
          <img src={image} alt="Generated" className={styles.imageGenImg} />
        ) : (
          <div className={styles.imageGenPlaceholder}>🎨</div>
        )}
      </div>
      {error && <p className={styles.imageGenError}>{error}</p>}
      <div className={styles.imageGenForm}>
        <input
          className={styles.imageGenInput}
          type="text"
          placeholder="Describe an image..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 200))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate(); }}
          maxLength={200}
          disabled={generating}
        />
        <button
          className={styles.imageGenBtn}
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating || cooldown > 0}
        >
          {cooldown > 0 ? cooldown : 'Generate'}
        </button>
      </div>
      <p className={styles.imageGenAttribution}>Powered by Pollinations AI</p>
    </div>
  );
}

export default function CasinoMode({ onBack }) {
  const { socket } = useSocketContext();
  const [score, setScore] = useState(null);

  useEffect(() => {
    if (!socket) return;
    socket.emit(EVENTS.CASINO_JOIN);
    function onCasinoState(data) { setScore(data.score); }
    function onTournamentState(data) {
      const myScore = data.scores?.[socket.id];
      if (myScore != null) setScore(myScore);
    }
    socket.on(EVENTS.CASINO_STATE, onCasinoState);
    socket.on(EVENTS.TOURNAMENT_STATE, onTournamentState);
    return () => {
      socket.off(EVENTS.CASINO_STATE, onCasinoState);
      socket.off(EVENTS.TOURNAMENT_STATE, onTournamentState);
    };
  }, [socket]);

  if (score === null) {
    return (
      <div className={styles.container}>
        <p className={styles.loading}>Loading casino...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>&larr; Back</button>
        <h1 className={styles.title}>Free Play Casino</h1>
        <div className={styles.scoreBox}>
          <span className={styles.scoreLabel}>Balance</span>
          <span className={styles.scoreValue}>{score.toLocaleString()}</span>
        </div>
      </div>
      <div className={styles.gamesGrid}>
        <GameCard decoration={0}>
          <BuddyCustomizer />
        </GameCard>
        <GameCard decoration={5}>
          <ImageGenerator socket={socket} />
        </GameCard>
        {GAMES.map((g) => (
          <GameCard key={g.key} decoration={g.deco}>
            <g.Component socket={socket} myScore={score} />
          </GameCard>
        ))}
      </div>
    </div>
  );
}
