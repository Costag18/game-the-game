import { useState, useEffect, useRef } from 'react';
import { useSound } from '../context/SoundContext.jsx';
import styles from './TurnOverlay.module.css';

export default function TurnOverlay({ isMyTurn }) {
  const { playSound } = useSound();
  const [visible, setVisible] = useState(false);
  const prevTurn = useRef(false);

  useEffect(() => {
    // Only trigger when isMyTurn transitions from false → true
    if (isMyTurn && !prevTurn.current) {
      setVisible(true);
      playSound('yourTurn');
      const timer = setTimeout(() => setVisible(false), 1800);
      return () => clearTimeout(timer);
    }
    prevTurn.current = isMyTurn;
  }, [isMyTurn, playSound]);

  // Also update ref when turn ends
  useEffect(() => {
    prevTurn.current = isMyTurn;
  }, [isMyTurn]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} onAnimationEnd={() => {}} >
      <div className={styles.banner}>
        <span className={styles.text}>Your Turn</span>
      </div>
    </div>
  );
}
