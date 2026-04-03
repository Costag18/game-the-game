import { useState, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import { CoinFlipPanel, SlotsPanel, WheelPanel, BJLitePanel, ChickenPanel } from '../components/CasinoSidebar.jsx';
import PetSidebar from '../components/PetSidebar.jsx';
import styles from './CasinoMode.module.css';

const CARD_DECORATIONS = [
  { tl: '7♦', br: '7♦' },
  { tl: 'Q♠', br: 'Q♠' },
  { tl: 'A♥', br: 'A♥' },
  { tl: 'K♣', br: 'K♣' },
  { tl: 'J♦', br: 'J♦' },
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
      <PetSidebar />
      <div className={styles.gamesGrid}>
        {GAMES.map((g) => (
          <GameCard key={g.key} decoration={g.deco}>
            <g.Component socket={socket} myScore={score} />
          </GameCard>
        ))}
      </div>
    </div>
  );
}
