import { useEffect, useRef, useState } from 'react';
import styles from './Yahtzee.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';

const LABELS = {
  ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
  threeKind: '3 of a Kind', fourKind: '4 of a Kind', fullHouse: 'Full House',
  smallStraight: 'Sm. Straight', largeStraight: 'Lg. Straight', yahtzee: 'Yahtzee', chance: 'Chance',
};

export default function Yahtzee({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [keep, setKeep] = useState([false, false, false, false, false]);
  const prevTurn = useRef(null);

  const turn = gameState?.turn;
  useEffect(() => { if (turn !== prevTurn.current) { setKeep([false, false, false, false, false]); prevTurn.current = turn; } }, [turn]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Rolling…</p></div>;
  const { phase, totalTurns, myDice = [0, 0, 0, 0, 0], hasRolled, rollsLeft, maxRolls, categories = [], myCard = {}, previews = {}, myAssigned, scoreboard = [], results } = gameState;

  function roll() {
    const keepIdx = keep.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
    onAction({ type: 'roll', keep: keepIdx });
    playSound('cardDeal');
  }
  function assign(cat) { if (myCard[cat] === undefined && hasRolled) { onAction({ type: 'assign', category: cat }); playSound('correct'); } }
  const locked = myAssigned != null;

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>YAHTZEE</h1>
      <p className={styles.meta}>Turn {turn}/{totalTurns}</p>

      {phase === 'turn' && !locked && (
        <>
          <div className={styles.dice}>
            {myDice.map((d, i) => (
              <button key={i} className={`${styles.die} ${keep[i] ? styles.dieKept : ''}`} onClick={() => hasRolled && setKeep((k) => k.map((v, j) => (j === i ? !v : v)))}>
                {d || '?'}
                {keep[i] && <span className={styles.keepTag}>KEPT</span>}
              </button>
            ))}
          </div>
          <button className={styles.rollBtn} onClick={roll} disabled={rollsLeft <= 0}>
            {hasRolled ? `Re-roll (${rollsLeft} left)` : 'Roll'}
          </button>
          {hasRolled && <p className={styles.hint}>Tap dice to KEEP, then re-roll — or assign below.</p>}
        </>
      )}
      {phase === 'turn' && locked && <p className={styles.waitMsg}>Assigned {LABELS[myAssigned.category]} ({myAssigned.score}). Waiting for others…</p>}

      <div className={styles.card}>
        {categories.map((cat) => {
          const used = myCard[cat] !== undefined;
          return (
            <button key={cat} className={`${styles.catRow} ${used ? styles.catUsed : ''}`} disabled={used || !hasRolled || locked || phase !== 'turn'} onClick={() => assign(cat)}>
              <span className={styles.catName}>{LABELS[cat] || cat}</span>
              <span className={styles.catScore}>{used ? myCard[cat] : (previews[cat] != null ? `+${previews[cat]}` : '–')}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.scoreboard}>
        {(results || scoreboard).map((s) => (
          <div key={s.playerId} className={styles.scoreRow}>
            <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{s.total != null ? s.total : s.score}{results ? ` · #${s.placement}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
