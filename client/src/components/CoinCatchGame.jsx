import { useState, useEffect, useRef, useCallback } from 'react';
import { usePet } from '../context/PetContext.jsx';
import styles from './PetSidebar.module.css';

const GAME_DURATION = 15000;
const SPAWN_INTERVAL = 600;
const FALL_SPEED_PX_PER_MS = 0.15; // Delta-time based, not frame-rate dependent
const COIN_SIZE = 28;

export default function CoinCatchGame() {
  const { addCoins } = usePet();
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [lastScore, setLastScore] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [coins, setCoins] = useState([]);
  const areaRef = useRef(null);
  const animRef = useRef(null);
  const coinsRef = useRef([]);
  const scoreRef = useRef(0);
  const nextId = useRef(0);
  const lastFrameTime = useRef(0);

  const startGame = useCallback(() => {
    setPlaying(true);
    setScore(0);
    setCoins([]);
    scoreRef.current = 0;
    coinsRef.current = [];
    nextId.current = 0;
    lastFrameTime.current = Date.now();
    setTimeLeft(GAME_DURATION / 1000);
  }, []);

  useEffect(() => {
    if (!playing) return;

    const area = areaRef.current;
    if (!area) return;
    const areaW = area.offsetWidth;
    const areaH = area.offsetHeight;

    const startTime = Date.now();
    lastFrameTime.current = startTime;

    const spawnInterval = setInterval(() => {
      if (Date.now() - startTime > GAME_DURATION) return;
      const id = nextId.current++;
      const x = Math.random() * (areaW - COIN_SIZE);
      coinsRef.current.push({ id, x, y: -COIN_SIZE, caught: false });
    }, SPAWN_INTERVAL);

    function animate() {
      const now = Date.now();
      const dt = now - lastFrameTime.current;
      lastFrameTime.current = now;
      const elapsed = now - startTime;
      setTimeLeft(Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000)));

      if (elapsed >= GAME_DURATION) {
        setPlaying(false);
        setLastScore(scoreRef.current);
        addCoins(scoreRef.current);
        cancelAnimationFrame(animRef.current);
        clearInterval(spawnInterval);
        return;
      }

      // Move coins using delta time
      coinsRef.current = coinsRef.current.filter((c) => {
        if (c.caught) return false;
        c.y += FALL_SPEED_PX_PER_MS * dt;
        return c.y < areaH + COIN_SIZE;
      });

      setCoins([...coinsRef.current]);
      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      clearInterval(spawnInterval);
    };
  }, [playing, addCoins]);

  function handleCoinClick(coinId) {
    const coin = coinsRef.current.find((c) => c.id === coinId);
    if (coin && !coin.caught) {
      coin.caught = true;
      scoreRef.current += 1;
      setScore(scoreRef.current);
    }
  }

  return (
    <div className={styles.catchGame}>
      <h4 className={styles.catchTitle}>Catch Coins</h4>

      {!playing ? (
        <div className={styles.catchMenu}>
          {lastScore !== null && (
            <p className={styles.catchResult}>Caught {lastScore} coins!</p>
          )}
          <button className={styles.catchPlayBtn} onClick={startGame}>
            {lastScore !== null ? 'Play Again' : 'Play'}
          </button>
        </div>
      ) : (
        <>
          <div className={styles.catchHeader}>
            <span className={styles.catchScore}>🪙 {score}</span>
            <span className={styles.catchTimer}>{timeLeft}s</span>
          </div>
          <div className={styles.catchArea} ref={areaRef}>
            {coins.map((c) => (
              <div
                key={c.id}
                className={styles.catchCoin}
                style={{ left: c.x - 10, top: c.y - 10 }}
                onPointerDown={(e) => { e.preventDefault(); handleCoinClick(c.id); }}
              >
                🪙
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
