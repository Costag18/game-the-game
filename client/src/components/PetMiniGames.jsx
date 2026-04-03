import { useState, useEffect, useRef, useCallback } from 'react';
import { usePet } from '../context/PetContext.jsx';
import styles from './PetSidebar.module.css';

// ==================== STOP THE CLOCK ====================
// Number counts up rapidly. Tap to stop as close to target as possible.
// Costs 3 coins to play. Closer = more coins back.

export function StopTheClock() {
  const { coins, addCoins } = usePet();
  const [playing, setPlaying] = useState(false);
  const [value, setValue] = useState(0);
  const [target] = useState(() => Math.floor(Math.random() * 80) + 10);
  const [result, setResult] = useState(null);
  const animRef = useRef(null);
  const startRef = useRef(0);
  const COST = 3;

  function startGame() {
    if (coins < COST) return;
    addCoins(-COST);
    setPlaying(true);
    setResult(null);
    setValue(0);
    startRef.current = Date.now();
  }

  useEffect(() => {
    if (!playing) return;
    function tick() {
      const elapsed = Date.now() - startRef.current;
      setValue(Math.floor((elapsed / 30) % 100));
      animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing]);

  function stop() {
    cancelAnimationFrame(animRef.current);
    setPlaying(false);
    const diff = Math.abs(value - target);
    let reward = 0;
    if (diff === 0) reward = 15;
    else if (diff <= 2) reward = 10;
    else if (diff <= 5) reward = 7;
    else if (diff <= 10) reward = 4;
    else if (diff <= 20) reward = 2;
    if (reward > 0) addCoins(reward);
    setResult({ diff, reward, stopped: value });
  }

  return (
    <div className={styles.miniGameBox}>
      <h4 className={styles.miniGameTitle}>Stop the Clock</h4>
      {!playing && !result && (
        <div className={styles.miniGameMenu}>
          <p className={styles.miniGameDesc}>Stop at <strong>{target}</strong>! (costs {COST}🪙)</p>
          <button className={styles.miniGameBtn} onClick={startGame} disabled={coins < COST}>Play</button>
        </div>
      )}
      {playing && (
        <div className={styles.miniGamePlay}>
          <div className={styles.clockDisplay}>{value}</div>
          <p className={styles.clockTarget}>Target: {target}</p>
          <button className={styles.miniGameBtn} onClick={stop}>STOP!</button>
        </div>
      )}
      {result && (
        <div className={styles.miniGameMenu}>
          <p className={styles.miniGameDesc}>Stopped at {result.stopped} (off by {result.diff})</p>
          <p className={result.reward > 0 ? styles.miniGameWin : styles.miniGameLose}>
            {result.reward > 0 ? `+${result.reward}🪙` : 'No coins'}
          </p>
          <button className={styles.miniGameBtn} onClick={() => setResult(null)}>Again</button>
        </div>
      )}
    </div>
  );
}

// ==================== COLOR MATCH ====================
// Word shows in a random color. Tap ✓ if word matches color, ✗ if not.

const COLORS = [
  { name: 'RED', hex: '#e53935' },
  { name: 'BLUE', hex: '#1e88e5' },
  { name: 'GREEN', hex: '#43a047' },
  { name: 'YELLOW', hex: '#fdd835' },
  { name: 'PURPLE', hex: '#8e24aa' },
];

export function ColorMatch() {
  const { addCoins } = usePet();
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);
  const [word, setWord] = useState(null);
  const [color, setColor] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const TOTAL_ROUNDS = 10;
  const TIME_PER_ROUND = 2000;

  function newRound() {
    const w = COLORS[Math.floor(Math.random() * COLORS.length)];
    // 40% chance of matching, 60% mismatch
    const c = Math.random() < 0.4 ? w : COLORS.filter((x) => x.name !== w.name)[Math.floor(Math.random() * (COLORS.length - 1))];
    setWord(w);
    setColor(c);
    setTimeLeft(TIME_PER_ROUND);
  }

  function start() {
    setPlaying(true);
    setScore(0);
    setRound(0);
    setLastResult(null);
    newRound();
  }

  useEffect(() => {
    if (!playing || !word) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const left = TIME_PER_ROUND - (Date.now() - start);
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        handleAnswer(null); // timeout = wrong
      }
    }, 50);
    return () => clearInterval(timer);
  }, [playing, round]);

  function handleAnswer(isMatch) {
    const correct = word?.name === color?.name;
    const playerCorrect = isMatch === correct;
    if (playerCorrect) setScore((s) => s + 1);

    const nextRound = round + 1;
    if (nextRound >= TOTAL_ROUNDS) {
      const earned = score + (playerCorrect ? 1 : 0);
      addCoins(earned);
      setPlaying(false);
      setLastResult(earned);
    } else {
      setRound(nextRound);
      newRound();
    }
  }

  return (
    <div className={styles.miniGameBox}>
      <h4 className={styles.miniGameTitle}>Color Match</h4>
      {!playing && lastResult === null && (
        <div className={styles.miniGameMenu}>
          <p className={styles.miniGameDesc}>Does the word match its color?</p>
          <button className={styles.miniGameBtn} onClick={start}>Play</button>
        </div>
      )}
      {!playing && lastResult !== null && (
        <div className={styles.miniGameMenu}>
          <p className={styles.miniGameWin}>{lastResult}/{TOTAL_ROUNDS} correct = +{lastResult}🪙</p>
          <button className={styles.miniGameBtn} onClick={() => setLastResult(null)}>Again</button>
        </div>
      )}
      {playing && word && color && (
        <div className={styles.miniGamePlay}>
          <div className={styles.colorWord} style={{ color: color.hex }}>{word.name}</div>
          <div className={styles.colorTimer} style={{ width: `${(timeLeft / TIME_PER_ROUND) * 100}%` }} />
          <div className={styles.colorBtns}>
            <button className={styles.colorYes} onClick={() => handleAnswer(true)}>✓ Match</button>
            <button className={styles.colorNo} onClick={() => handleAnswer(false)}>✗ No</button>
          </div>
          <span className={styles.miniGameDesc}>{round + 1}/{TOTAL_ROUNDS}</span>
        </div>
      )}
    </div>
  );
}

// ==================== TREASURE CHEST ====================
// Pick 1 of 3 chests. Costs 5 coins. One has 15, one has 5, one has 0.

export function TreasureChest() {
  const { coins, addCoins } = usePet();
  const [chests, setChests] = useState(null);
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const COST = 5;

  function start() {
    if (coins < COST) return;
    addCoins(-COST);
    // Randomly assign prizes
    const prizes = [15, 5, 0].sort(() => Math.random() - 0.5);
    setChests(prizes);
    setPicked(null);
    setRevealed(false);
  }

  function pick(idx) {
    if (picked !== null) return;
    setPicked(idx);
    addCoins(chests[idx]);
    setTimeout(() => setRevealed(true), 500);
  }

  return (
    <div className={styles.miniGameBox}>
      <h4 className={styles.miniGameTitle}>Treasure Chest</h4>
      {!chests && (
        <div className={styles.miniGameMenu}>
          <p className={styles.miniGameDesc}>Pick a chest! (costs {COST}🪙)</p>
          <button className={styles.miniGameBtn} onClick={start} disabled={coins < COST}>Play</button>
        </div>
      )}
      {chests && (
        <>
          <div className={styles.chestRow}>
            {chests.map((prize, i) => (
              <button
                key={i}
                className={`${styles.chest} ${picked === i ? styles.chestPicked : ''} ${revealed && picked !== i ? styles.chestRevealed : ''}`}
                onClick={() => pick(i)}
                disabled={picked !== null}
              >
                {(picked === i || revealed) ? (
                  <span className={styles.chestPrize}>{prize > 0 ? `${prize}🪙` : '💨'}</span>
                ) : (
                  <span className={styles.chestIcon}>📦</span>
                )}
              </button>
            ))}
          </div>
          {revealed && (
            <div className={styles.miniGameMenu}>
              <p className={chests[picked] > 0 ? styles.miniGameWin : styles.miniGameLose}>
                {chests[picked] > 0 ? `Won ${chests[picked]}🪙!` : 'Empty!'}
              </p>
              <button className={styles.miniGameBtn} onClick={() => setChests(null)}>Again</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
