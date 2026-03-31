import { useState } from 'react';
import styles from './Roulette.module.css';

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

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

export default function Roulette({ gameState, onAction, currentPlayerId }) {
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

      {/* Spin result */}
      {spinResult !== null && spinResult !== undefined && (
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
              <span className={styles.otherName}>{p.playerId}</span>
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
                <span className={styles.resultName}>{p.playerId}</span>
                <span className={styles.resultChips}>{p.chips} chips</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
