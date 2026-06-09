import { useEffect, useRef, useState } from 'react';
import styles from './Scattergories.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function Scattergories({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState({});
  const [remaining, setRemaining] = useState(null);
  const roundRef = useRef(-1);
  const ackedRound = useRef(-1);
  const pinged = useRef(false);

  const phase = gameState?.phase;
  const round = gameState?.round;
  const writeEndTime = gameState?.writeEndTime;

  // reset draft when a new writing round starts
  useEffect(() => {
    if (phase === 'writing' && round !== roundRef.current) {
      roundRef.current = round;
      setDraft({});
      pinged.current = false;
    }
  }, [phase, round]);

  // countdown from writeEndTime
  useEffect(() => {
    if (phase !== 'writing' || !writeEndTime) { setRemaining(null); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((writeEndTime - Date.now()) / 1000));
      setRemaining(rem);
      if (rem === 0 && !pinged.current) { pinged.current = true; onAction({ type: 'ping' }); }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, writeEndTime, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Loading…</p></div>;

  const {
    letter, categories = [], totalRounds, hasSubmitted, submittedCount = 0,
    totalPlayers = 0, roundResult, reportsView = {}, scores = {}, myId, otherPlayers = [],
  } = gameState;

  const allPlayers = [myId, ...otherPlayers.map((o) => o.playerId)];

  function submitAnswers() {
    onAction({ type: 'submit', answers: draft });
    playSound('click');
  }
  function ack() {
    if (ackedRound.current === round) return;
    ackedRound.current = round;
    onAction({ type: 'acknowledge' });
    playSound('click');
  }

  return (
    <div className={styles.arena}>
      <div className={styles.header}>
        <h1 className={styles.title}>Scattergories</h1>
        <span className={styles.roundLabel}>Round {round}/{totalRounds}</span>
      </div>

      {(phase === 'writing') && (
        <>
          <div className={styles.letterRow}>
            <span className={styles.letterLabel}>Your letter</span>
            <span className={styles.letterBadge}>{letter}</span>
            {remaining != null && (
              <span className={`${styles.timer} ${remaining <= 10 ? styles.timerLow : ''}`}>{remaining}s</span>
            )}
          </div>

          {!hasSubmitted ? (
            <>
              <div className={styles.catList}>
                {categories.map((cat, c) => (
                  <label key={c} className={styles.catRow}>
                    <span className={styles.catLabel}>{cat}</span>
                    <input
                      className={styles.catInput}
                      value={draft[c] || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))}
                      placeholder={`${letter}…`}
                      inputMode="text"
                      autoCapitalize="words"
                      autoComplete="off"
                      maxLength={40}
                    />
                  </label>
                ))}
              </div>
              <button className={styles.submitBtn} onClick={submitAnswers}>Submit answers</button>
            </>
          ) : (
            <p className={styles.waiting}>Locked in! Waiting for others… ({submittedCount}/{totalPlayers})</p>
          )}
        </>
      )}

      {(phase === 'reveal' || phase === 'finished') && roundResult && (
        <div className={styles.revealWrap}>
          <div className={styles.revealLetter}>Letter: <strong>{roundResult.letter}</strong></div>
          {phase === 'reveal' && (
            <p className={styles.reportHint}>🚩 Tap a rival’s answer to flag it as fake — if everyone else agrees, it’s removed.</p>
          )}
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.catHead}>Category</th>
                  {allPlayers.map((pid) => (
                    <th key={pid} className={styles.playerHead}>
                      <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(roundResult.categories || categories).map((cat, c) => (
                  <tr key={c}>
                    <td className={styles.catCell}>{cat}</td>
                    {allPlayers.map((pid) => {
                      const cell = roundResult.perPlayer?.[pid]?.[c] || { text: '', status: 'empty' };
                      const rv = reportsView?.[pid]?.[String(c)];
                      const canReport = phase === 'reveal' && pid !== myId && !!cell.text && cell.status !== 'challenged';
                      return (
                        <td
                          key={pid}
                          className={[
                            styles.answerCell, styles['st_' + cell.status],
                            canReport ? styles.reportable : '',
                            rv && rv.mine ? styles.reportedByMe : '',
                          ].filter(Boolean).join(' ')}
                          onClick={canReport ? () => onAction({ type: 'report', targetPlayer: pid, categoryIndex: c }) : undefined}
                          title={canReport ? 'Flag as fake' : undefined}
                        >
                          <span className={styles.cellText}>{cell.text || '—'}</span>
                          {rv && rv.count > 0 && <span className={styles.flag}>🚩{rv.count}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.scoreStrip}>
            {allPlayers
              .map((pid) => ({ pid, score: scores[pid] || 0 }))
              .sort((a, b) => b.score - a.score)
              .map(({ pid, score }) => (
                <div key={pid} className={styles.scoreCard}>
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.scoreVal}>{score}</span>
                </div>
              ))}
          </div>

          {phase === 'reveal' && (
            <button className={styles.submitBtn} onClick={ack}>Continue →</button>
          )}
        </div>
      )}
    </div>
  );
}
