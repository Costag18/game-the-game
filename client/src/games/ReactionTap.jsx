import { useEffect, useRef, useState } from 'react';
import styles from './ReactionTap.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

export default function ReactionTap({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [estimate, setEstimate] = useState(null);
  const [tooSoon, setTooSoon] = useState(false);
  const goLocalRef = useRef(0);
  const ackedRoundRef = useRef(-1);

  const phase = gameState?.phase;
  const round = gameState?.round;

  // Capture local GO time for a display-only reaction estimate; reset per round.
  useEffect(() => {
    if (phase === 'go') goLocalRef.current = performance.now();
    if (phase === 'arming') { setEstimate(null); setTooSoon(false); }
  }, [phase, round]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Loading…</p></div>;
  }

  const {
    totalRounds, hasActed, myResult, roundResults,
    totals = {}, otherPlayers = [], myTotalMs = 0,
  } = gameState;

  function handleTap() {
    if (phase === 'arming') {
      if (hasActed) return;
      setTooSoon(true);
      playSound('wrong');
      shake('light');
      onAction({ type: 'tap' });
    } else if (phase === 'go') {
      if (hasActed) return;
      setEstimate(Math.round(performance.now() - goLocalRef.current));
      playSound('correct');
      shake('light');
      onAction({ type: 'tap' });
    } else if (phase === 'roundEnd') {
      if (ackedRoundRef.current === round) return;
      ackedRoundRef.current = round;
      onAction({ type: 'acknowledge' });
    }
  }

  const panelClass = [
    styles.panel,
    phase === 'arming' && styles.panelWait,
    phase === 'go' && styles.panelGo,
    (phase === 'roundEnd' || phase === 'finished') && styles.panelResult,
    phase === 'waiting' && styles.panelWait,
  ].filter(Boolean).join(' ');

  // standings strip (lower total = better)
  const standings = Object.entries(totals)
    .map(([playerId, ms]) => ({ playerId, ms }))
    .sort((a, b) => a.ms - b.ms);

  return (
    <div className={styles.arena}>
      <div className={styles.header}>
        <h1 className={styles.title}>Reaction Tap</h1>
        <span className={styles.roundLabel}>Round {round}/{totalRounds}</span>
      </div>

      <button
        type="button"
        className={panelClass}
        onPointerDown={handleTap}
        aria-label="reaction panel"
      >
        {phase === 'waiting' && <span className={styles.big}>Get ready…</span>}

        {phase === 'arming' && !tooSoon && (
          <>
            <span className={styles.big}>WAIT</span>
            <span className={styles.sub}>Don’t tap yet!</span>
          </>
        )}
        {phase === 'arming' && tooSoon && (
          <>
            <span className={styles.big}>TOO SOON 😬</span>
            <span className={styles.sub}>You jumped the gun — max penalty this round.</span>
          </>
        )}

        {phase === 'go' && !hasActed && (
          <>
            <span className={styles.big}>GO!</span>
            <span className={styles.sub}>TAP NOW</span>
          </>
        )}
        {phase === 'go' && hasActed && (
          <>
            <span className={styles.big}>{estimate != null ? `${estimate}ms` : 'Tapped!'}</span>
            <span className={styles.sub}>Waiting for others ⏳</span>
          </>
        )}

        {(phase === 'roundEnd' || phase === 'finished') && (
          <div className={styles.results}>
            <h2 className={styles.resultsTitle}>{phase === 'finished' ? 'Final reflexes' : `Round ${round} results`}</h2>
            <div className={styles.resultRows}>
              {(roundResults || []).map((r) => (
                <div key={r.playerId} className={styles.resultRow}>
                  <span className={styles.resultName}>
                    <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                  </span>
                  <span className={styles.resultMs}>
                    {r.foul ? 'FOUL' : r.missed ? 'MISSED' : `${r.ms}ms`}
                  </span>
                </div>
              ))}
            </div>
            {phase === 'roundEnd' && (
              <span className={styles.tapHint}>Tap anywhere to continue →</span>
            )}
          </div>
        )}
      </button>

      {/* Standings strip (always visible) */}
      <div className={styles.standings}>
        {standings.map((s, i) => (
          <div key={s.playerId} className={styles.standCard}>
            <span className={styles.standRank}>{i + 1}</span>
            <span className={styles.standName}>
              <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
            </span>
            <span className={styles.standMs}>{(s.ms / 1000).toFixed(2)}s</span>
          </div>
        ))}
      </div>
    </div>
  );
}
