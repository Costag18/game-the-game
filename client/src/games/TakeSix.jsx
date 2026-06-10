import { useEffect, useRef, useState } from 'react';
import styles from './TakeSix.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';

function Card({ value, bullhead, onClick, selected, small }) {
  return (
    <button type="button" className={`${styles.card} ${small ? styles.cardSm : ''} ${selected ? styles.cardSel : ''} ${onClick ? styles.cardBtn : ''}`} onClick={onClick}>
      <span className={styles.cardVal}>{value}</span>
      <span className={styles.cardBull}>{'🐂'.repeat(Math.min(bullhead, 3))}{bullhead > 3 ? `×${bullhead}` : ''}</span>
    </button>
  );
}

export default function TakeSix({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [sel, setSel] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'choosing') { setSel(null); }
      if (phase === 'reveal') setIAcked(false);
      prevPhase.current = phase;
    }
  }, [phase]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Dealing…</p></div>;
  const { round, totalRounds, rows = [], myHand = [], hasPicked, pickedCount, players = [], resolution, results } = gameState;

  function confirm() { if (sel == null || hasPicked) return; onAction({ type: 'playCard', card: sel }); playSound('cardDeal'); setSel(null); }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const scoreboard = [...players].sort((a, b) => (a.score || 0) - (b.score || 0));

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>TAKE SIX</h1>
      <p className={styles.meta}>Round {round}/{totalRounds} · fewest 🐂 wins</p>

      <div className={styles.rows}>
        {rows.map((r, i) => (
          <div key={i} className={styles.row}>
            {r.cards.map((c, j) => <Card key={j} value={c.value} bullhead={c.bullhead} small />)}
            <span className={styles.rowPenalty}>{r.penalty}🐂</span>
          </div>
        ))}
      </div>

      {phase === 'choosing' && (
        hasPicked ? <p className={styles.waiting}>Card locked 🔒 — {pickedCount}/{players.length} in</p> : (
          <>
            <p className={styles.pickHint}>Pick a card to play</p>
            <div className={styles.hand}>
              {myHand.map((c) => <Card key={c.value} value={c.value} bullhead={c.bullhead} selected={sel === c.value} onClick={() => setSel(c.value)} />)}
            </div>
            <button className={styles.playBtn} onClick={confirm} disabled={sel == null}>Play {sel != null ? sel : ''}</button>
          </>
        )
      )}

      {phase === 'reveal' && resolution && (
        <div className={styles.reveal}>
          <p className={styles.revealTitle}>Cards resolved (low → high):</p>
          {resolution.steps.map((st, i) => (
            <div key={i} className={styles.step}>
              <PlayerName playerId={st.playerId} nicknames={nicknames} avatars={avatars} /> played <strong>{st.card}</strong>
              {st.action === 'append' ? ' → placed' : st.action === 'sixth' ? ` → took the row (+${st.gained}🐂)` : ` → too low, took a row (+${st.gained}🐂)`}
            </div>
          ))}
          {!iAcked && <button className={styles.playBtn} onClick={ack}>Continue →</button>}
        </div>
      )}

      <div className={styles.scoreboard}>
        {(results || scoreboard).map((s) => (
          <div key={s.playerId} className={styles.scoreRow}>
            <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{s.score || 0}🐂{results ? ` · #${s.placement}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
