import { useEffect, useRef, useState } from 'react';
import styles from './CopyThat.module.css';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function CopyThatGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [strokes, setStrokes] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);
  const prevRound = useRef(0);

  const phase = gameState?.phase;
  const round = gameState?.roundNumber ?? 0;

  // reset local canvas / flags whenever a new round (or a new phase) begins
  useEffect(() => {
    if (round !== prevRound.current) {
      setStrokes([]); setSubmitted(false); setIAcked(false);
      prevRound.current = round;
    }
  }, [round]);

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'flash') playSound('roundStart');
      if (phase === 'redraw') { setStrokes([]); setSubmitted(false); }
      if (phase === 'reveal') { setIAcked(false); playSound('correct'); }
      prevPhase.current = phase;
    }
  }, [phase, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Loading…</p></div>;

  const {
    totalRounds = 3, scores = {}, myId, reference, referenceName,
    hasSubmitted, submittedCount = 0, playerCount = 0, acknowledged = [], reveal,
  } = gameState;

  function submit() {
    if (submitted || hasSubmitted) return;
    setSubmitted(true);
    onAction({ type: 'submit', strokes });
    playSound('click');
  }
  function ack() {
    if (iAcked) return;
    setIAcked(true);
    onAction({ type: 'acknowledge' });
    playSound('click');
  }

  const orderedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>COPY THAT</h1>
        <span className={styles.meta}>Round {round}/{totalRounds}</span>
      </div>

      {/* ---------- FLASH ---------- */}
      {phase === 'flash' && (
        <div className={styles.phaseBox}>
          <p className={styles.flashLabel}>📸 Memorize this!</p>
          {referenceName && <p className={styles.refName}>{referenceName}</p>}
          <div className={styles.flashCanvas}>
            <DrawingCanvas readOnly strokes={reference?.strokes || []} toolbar={false} />
          </div>
          <p className={styles.hint}>It disappears soon — then you redraw it from memory.</p>
        </div>
      )}

      {/* ---------- REDRAW ---------- */}
      {phase === 'redraw' && (
        <div className={styles.phaseBox}>
          <p className={styles.flashLabel}>✏️ Redraw it from memory!</p>
          <DrawingCanvas
            readOnly={submitted || hasSubmitted}
            strokes={strokes}
            onStroke={(s) => setStrokes((arr) => [...arr, s])}
            onUndo={() => setStrokes((arr) => arr.slice(0, -1))}
            onClear={() => setStrokes([])}
            toolbar={!submitted && !hasSubmitted}
          />
          {submitted || hasSubmitted ? (
            <p className={styles.locked}>✓ Submitted — waiting for others ({submittedCount}/{playerCount})</p>
          ) : (
            <button className={styles.primary} onClick={submit}>Submit Drawing</button>
          )}
        </div>
      )}

      {/* ---------- REVEAL ---------- */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.phaseBox}>
          <p className={styles.flashLabel}>The answer was: <strong>{reveal.referenceName}</strong></p>
          <div className={styles.compareRow}>
            <div className={styles.compareCell}>
              <span className={styles.cellTag}>Reference</span>
              <div className={styles.miniCanvas}>
                <DrawingCanvas readOnly strokes={reveal.reference?.strokes || []} toolbar={false} />
              </div>
            </div>
            <div className={styles.compareCell}>
              <span className={styles.cellTag}>You · {reveal.perPlayer?.[myId]?.percent ?? 0}%</span>
              <div className={styles.miniCanvas}>
                <DrawingCanvas readOnly strokes={reveal.perPlayer?.[myId]?.strokes || []} toolbar={false} />
              </div>
            </div>
          </div>

          <div className={styles.roundList}>
            {Object.entries(reveal.perPlayer || {})
              .sort((a, b) => b[1].score - a[1].score)
              .map(([pid, info]) => (
                <div key={pid} className={styles.roundRow}>
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.pct}>
                    <span className={styles.bar}><span className={styles.barFill} style={{ width: `${info.percent}%` }} /></span>
                    {info.percent}% · +{info.score}
                  </span>
                </div>
              ))}
          </div>

          {phase === 'reveal' && (
            <>
              <button className={styles.primary} onClick={ack} disabled={iAcked}>
                {iAcked ? 'Waiting…' : 'Continue'}
              </button>
              <AckStatus
                players={Object.keys(scores)}
                acknowledged={acknowledged}
                me={myId}
                iActed={iAcked}
                nicknames={nicknames}
                avatars={avatars}
              />
            </>
          )}
        </div>
      )}

      {/* ---------- SCOREBOARD ---------- */}
      <div className={styles.scores}>
        <span className={styles.scoresTitle}>Total similarity</span>
        {orderedScores.map(([pid, sc]) => (
          <div key={pid} className={`${styles.scoreRow} ${pid === myId ? styles.me : ''}`}>
            <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{sc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
