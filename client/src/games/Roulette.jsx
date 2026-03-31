import { useState, useEffect, useRef } from 'react';
import styles from './Roulette.module.css';
import { displayName } from '../utils/displayName.js';

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Roulette wheel order (European single-zero wheel sequence)
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const SEGMENT_COUNT = WHEEL_ORDER.length; // 37
const SEGMENT_ANGLE = 360 / SEGMENT_COUNT;

function getWheelIndexForNumber(n) {
  return WHEEL_ORDER.indexOf(n);
}

function SpinningWheel({ isSpinning, spinResult }) {
  const wheelRef = useRef(null);
  const prevResultRef = useRef(null);
  const baseRotationRef = useRef(0);

  useEffect(() => {
    if (!wheelRef.current) return;

    if (isSpinning) {
      // CSS class handles the continuous spin animation; clear any prior inline transform
      wheelRef.current.style.transition = 'none';
      wheelRef.current.style.transform = '';
    } else if (spinResult !== null && spinResult !== undefined && spinResult !== prevResultRef.current) {
      // Result arrived — decelerate and land on the winning number
      prevResultRef.current = spinResult;
      const idx = getWheelIndexForNumber(spinResult);
      // Segment centre angle from top (0 = top pointer position)
      const segCentre = idx * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
      // Add several full rotations for dramatic effect
      const fullSpins = 1440; // 4 full rotations
      const targetRotation = baseRotationRef.current + fullSpins + (360 - segCentre);
      baseRotationRef.current = targetRotation;

      wheelRef.current.style.transition = 'transform 3.5s cubic-bezier(0.17, 0.67, 0.12, 1.0)';
      wheelRef.current.style.transform = `rotate(${targetRotation}deg)`;
    }
  }, [isSpinning, spinResult]);

  // Build SVG segments
  const radius = 120;
  const cx = 130;
  const cy = 130;
  const segments = WHEEL_ORDER.map((n, i) => {
    const startAngle = (i * SEGMENT_ANGLE - 90) * (Math.PI / 180);
    const endAngle = ((i + 1) * SEGMENT_ANGLE - 90) * (Math.PI / 180);
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const midAngle = ((i + 0.5) * SEGMENT_ANGLE - 90) * (Math.PI / 180);
    const labelR = radius * 0.72;
    const lx = cx + labelR * Math.cos(midAngle);
    const ly = cy + labelR * Math.sin(midAngle);
    const color = n === 0 ? '#2e7d32' : RED_NUMBERS.has(n) ? '#c62828' : '#212121';
    const isWinner = !isSpinning && spinResult === n;
    return { n, x1, y1, x2, y2, lx, ly, color, midAngle, isWinner };
  });

  return (
    <div className={styles.wheelContainer}>
      {/* Pointer triangle at top */}
      <div className={styles.wheelPointer} />
      <div
        className={`${styles.wheelDisc} ${isSpinning ? styles.wheelSpinning : ''}`}
        ref={wheelRef}
      >
        <svg width="260" height="260" viewBox="0 0 260 260">
          {segments.map(({ n, x1, y1, x2, y2, lx, ly, color, midAngle, isWinner }, i) => (
            <g key={n}>
              <path
                d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`}
                fill={color}
                stroke={isWinner ? '#ffd700' : 'rgba(255,255,255,0.15)'}
                strokeWidth={isWinner ? 2 : 0.5}
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="7"
                fontWeight="bold"
                fill={isWinner ? '#ffd700' : '#fff'}
                transform={`rotate(${(i + 0.5) * SEGMENT_ANGLE + 90}, ${lx}, ${ly})`}
              >
                {n}
              </text>
            </g>
          ))}
          {/* Centre hub */}
          <circle cx={cx} cy={cy} r="18" fill="#1a1a1a" stroke="#ffd700" strokeWidth="2" />
          <circle cx={cx} cy={cy} r="8" fill="#ffd700" />
        </svg>
      </div>
      {/* Winning number overlay */}
      {!isSpinning && spinResult !== null && spinResult !== undefined && (
        <div className={`${styles.wheelResult} ${styles[`spin_${getNumberColor(spinResult)}`]}`}>
          <span className={styles.wheelResultNumber}>{spinResult}</span>
          <span className={styles.wheelResultColor}>{getNumberColor(spinResult).toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}

function getNumberColor(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

function RouletteNumber({ n, highlighted }) {
  const color = getNumberColor(n);
  return (
    <span
      className={`${styles.rouletteNum} ${styles[`num_${color}`]} ${highlighted ? styles.numHighlighted : ''}`}
    >
      {n}
    </span>
  );
}

const BET_TYPES = [
  { type: 'red', label: 'Red', color: '#c62828' },
  { type: 'black', label: 'Black', color: '#212121' },
  { type: 'odd', label: 'Odd', color: '#4a148c' },
  { type: 'even', label: 'Even', color: '#1a237e' },
  { type: 'low', label: '1-18', color: '#1b5e20' },
  { type: 'high', label: '19-36', color: '#e65100' },
];

const CHIP_AMOUNTS = [10, 25, 50, 100, 250, 500];

export default function Roulette({ gameState, onAction, currentPlayerId, nicknames }) {
  const [pendingBets, setPendingBets] = useState([]);
  const [straightNumber, setStraightNumber] = useState('');
  const [betAmount, setBetAmount] = useState(10);

  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    myChips,
    myBets,
    myBetSubmitted,
    spinResult,
    round,
    totalRounds,
    otherPlayers,
    phase,
    history,
  } = gameState;

  const isFinished = phase === 'finished';
  const isBetting = phase === 'betting';
  const isSpinning = phase === 'spinning';

  const totalPending = pendingBets.reduce((s, b) => s + b.amount, 0);
  const canAfford = totalPending < myChips;

  function addBet(type, value) {
    if (myBetSubmitted) return;
    if (betAmount <= 0) return;
    const newBets = [...pendingBets, { type, ...(value !== undefined ? { value } : {}), amount: betAmount }];
    const total = newBets.reduce((s, b) => s + b.amount, 0);
    if (total > myChips) return;
    setPendingBets(newBets);
  }

  function removeBet(index) {
    setPendingBets(pendingBets.filter((_, i) => i !== index));
  }

  function submitBets() {
    if (pendingBets.length === 0) return;
    onAction({ type: 'bet', bets: pendingBets });
    setPendingBets([]);
  }

  function getBetLabel(bet) {
    if (bet.type === 'straight') return `Straight ${bet.value}`;
    const found = BET_TYPES.find((b) => b.type === bet.type);
    return found ? found.label : bet.type;
  }

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Roulette</h1>

      {/* Round indicator */}
      <div className={styles.roundBadge}>
        Round {round} / {totalRounds}
      </div>

      {/* Spinning wheel — shown during spinning phase or when there's a result */}
      {(isSpinning || (spinResult !== null && spinResult !== undefined)) && (
        <SpinningWheel isSpinning={isSpinning} spinResult={isSpinning ? null : spinResult} />
      )}

      {/* Spin result text (only after spin) */}
      {!isSpinning && spinResult !== null && spinResult !== undefined && (
        <div className={`${styles.spinResult} ${styles[`spin_${getNumberColor(spinResult)}`]}`}>
          <span className={styles.spinLabel}>Last spin:</span>
          <span className={styles.spinNumber}>{spinResult}</span>
          <span className={styles.spinColor}>{getNumberColor(spinResult).toUpperCase()}</span>
        </div>
      )}

      {/* Chip counts */}
      <section className={styles.chipsSection}>
        <div className={styles.myChips}>
          <span className={styles.chipsLabel}>Your chips:</span>
          <span className={styles.chipsValue}>{myChips}</span>
        </div>
        <div className={styles.otherChips}>
          {(otherPlayers || []).map((p) => (
            <div key={p.playerId} className={styles.otherChipRow}>
              <span className={styles.otherName}>{displayName(p.playerId, nicknames)}</span>
              <span className={styles.otherChipValue}>{p.chips}</span>
              {p.betSubmitted && <span className={styles.betBadge}>Bet placed</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Betting area */}
      {isBetting && !myBetSubmitted && (
        <section className={styles.bettingSection}>
          <h2 className={styles.sectionTitle}>Place Your Bets</h2>

          {/* Chip amount selector */}
          <div className={styles.chipSelector}>
            <span className={styles.chipSelectorLabel}>Chip amount:</span>
            {CHIP_AMOUNTS.map((amount) => (
              <button
                key={amount}
                className={`${styles.chipBtn} ${betAmount === amount ? styles.chipBtnActive : ''}`}
                onClick={() => setBetAmount(amount)}
              >
                {amount}
              </button>
            ))}
          </div>

          {/* Outside bets */}
          <div className={styles.outsideBets}>
            {BET_TYPES.map(({ type, label, color }) => (
              <button
                key={type}
                className={styles.betTypeBtn}
                style={{ '--bet-color': color }}
                onClick={() => addBet(type)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Straight bet */}
          <div className={styles.straightBetRow}>
            <span className={styles.straightLabel}>Straight (number):</span>
            <input
              type="number"
              min="0"
              max="36"
              className={styles.straightInput}
              value={straightNumber}
              onChange={(e) => setStraightNumber(e.target.value)}
              placeholder="0-36"
            />
            <button
              className={styles.btnStraight}
              onClick={() => {
                const n = parseInt(straightNumber, 10);
                if (!isNaN(n) && n >= 0 && n <= 36) {
                  addBet('straight', n);
                  setStraightNumber('');
                }
              }}
            >
              Add
            </button>
          </div>

          {/* Pending bets */}
          {pendingBets.length > 0 && (
            <div className={styles.pendingBets}>
              <span className={styles.pendingTitle}>Pending bets (total: {totalPending}):</span>
              {pendingBets.map((bet, i) => (
                <div key={i} className={styles.pendingBetRow}>
                  <span>{getBetLabel(bet)}: {bet.amount} chips</span>
                  <button className={styles.btnRemove} onClick={() => removeBet(i)}>x</button>
                </div>
              ))}
              <button
                className={styles.btnSubmit}
                onClick={submitBets}
                disabled={pendingBets.length === 0}
              >
                Submit Bets
              </button>
            </div>
          )}
        </section>
      )}

      {/* Waiting for others / submitted */}
      {isBetting && myBetSubmitted && (
        <div className={styles.waitingMsg}>
          Bets submitted. Waiting for other players...
        </div>
      )}

      {/* History */}
      {(history || []).length > 0 && (
        <section className={styles.historySection}>
          <h2 className={styles.sectionTitle}>Spin History</h2>
          <div className={styles.historyList}>
            {(history || []).map((h) => (
              <div key={h.round} className={styles.historyRow}>
                <span className={styles.historyRound}>Round {h.round}:</span>
                <RouletteNumber n={h.result} highlighted={false} />
                <span className={`${styles.historyColor} ${styles[`spin_${getNumberColor(h.result)}`]}`}>
                  {getNumberColor(h.result).toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Results */}
      {isFinished && (
        <section className={styles.resultsSection}>
          <h2 className={styles.sectionTitle}>Final Results</h2>
          <div className={styles.resultsList}>
            <div className={styles.resultRow}>
              <span className={styles.resultName}>You</span>
              <span className={styles.resultChips}>{myChips} chips</span>
            </div>
            {(otherPlayers || []).map((p) => (
              <div key={p.playerId} className={styles.resultRow}>
                <span className={styles.resultName}>{displayName(p.playerId, nicknames)}</span>
                <span className={styles.resultChips}>{p.chips} chips</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
