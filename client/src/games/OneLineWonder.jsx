import { useEffect, useRef, useState } from 'react';
import styles from './OneLineWonder.module.css';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const STARS = [1, 2, 3, 4, 5];

export default function OneLineWonderGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  // local single-stroke state for the draw phase
  const [myStroke, setMyStroke] = useState(null);
  const [ratings, setRatings] = useState({});
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;

  // reset per-phase local state
  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'draw') { setMyStroke(null); }
      if (phase === 'rate') { setRatings({}); }
      if (phase === 'reveal') { setIAcked(false); }
      prevPhase.current = phase;
    }
  }, [phase]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Picking a word…</p></div>;

  const {
    word, myId, hasSubmitted, submittedCount, playerCount,
    gallery = [], ratableIds = [], hasRated, ratedCount,
    acknowledged = [], revealOrder, scores = {}, players = [], results,
  } = gameState;

  // ---------- DRAW ----------
  function onStroke(stroke) {
    if (myStroke) return; // already have our one line — lock it
    setMyStroke(stroke);
    playSound('cardDeal');
  }
  function submitDrawing() {
    onAction({ type: 'submitDrawing', strokes: myStroke ? [myStroke] : [] });
  }
  function redo() { setMyStroke(null); }

  // ---------- RATE ----------
  function setStar(target, val) {
    setRatings((r) => ({ ...r, [target]: val }));
    playSound('click');
  }
  const allRated = ratableIds.every((t) => ratings[t]);
  function submitRatings() {
    if (!allRated) return;
    onAction({ type: 'submitRatings', ratings });
  }

  // ---------- REVEAL ----------
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>One-Line Wonder</h1>

      {/* DRAW PHASE */}
      {phase === 'draw' && (
        <div className={styles.drawBox}>
          <p className={styles.wordLine}>Draw <strong>{word}</strong> in ONE unbroken line!</p>
          <p className={styles.hint}>{myStroke ? 'Nice line! Submit it or redo.' : 'One stroke only — lift your pen and you\'re done.'}</p>
          <DrawingCanvas
            readOnly={hasSubmitted || !!myStroke}
            strokes={myStroke ? [myStroke] : []}
            onStroke={onStroke}
            toolbar={!hasSubmitted && !myStroke}
          />
          {!hasSubmitted ? (
            <div className={styles.drawActions}>
              {myStroke && <button className={styles.ghost} onClick={redo}>↺ Redo</button>}
              <button className={styles.primary} onClick={submitDrawing} disabled={!myStroke}>Submit drawing</button>
            </div>
          ) : (
            <p className={styles.locked}>Submitted ✓ — waiting for others ({submittedCount}/{playerCount})</p>
          )}
        </div>
      )}

      {/* RATE PHASE */}
      {phase === 'rate' && (
        <div className={styles.rateBox}>
          <p className={styles.wordLine}>Everyone drew <strong>{word}</strong>. Rate the others!</p>
          {hasRated ? (
            <p className={styles.locked}>Ratings locked ✓ — waiting for others ({ratedCount}/{playerCount})</p>
          ) : (
            <>
              <div className={styles.grid}>
                {gallery.map((g) => (
                  <div key={g.playerId} className={styles.card}>
                    <div className={styles.cardName}>
                      <PlayerName playerId={g.playerId} nicknames={nicknames} avatars={avatars} />
                    </div>
                    <DrawingCanvas readOnly strokes={g.stroke ? [g.stroke] : []} toolbar={false} />
                    <div className={styles.stars}>
                      {STARS.map((n) => (
                        <button
                          key={n}
                          className={`${styles.star} ${ratings[g.playerId] >= n ? styles.starOn : ''}`}
                          onClick={() => setStar(g.playerId, n)}
                          aria-label={`${n} stars`}
                        >★</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button className={styles.primary} onClick={submitRatings} disabled={!allRated}>
                {allRated ? 'Lock ratings' : 'Rate everyone first'}
              </button>
            </>
          )}
        </div>
      )}

      {/* REVEAL + FINISHED */}
      {(phase === 'reveal' || phase === 'finished') && (
        <div className={styles.revealBox}>
          <p className={styles.wordLine}>The word was <strong>{word}</strong></p>
          <div className={styles.grid}>
            {(revealOrder || players).map((pid, idx) => {
              const g = gallery.find((x) => x.playerId === pid);
              return (
                <div key={pid} className={`${styles.card} ${idx === 0 ? styles.winnerCard : ''}`}>
                  <div className={styles.cardName}>
                    {idx === 0 && <span className={styles.crown}>👑</span>}
                    <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                    {pid === myId && <span className={styles.youTag}>(you)</span>}
                  </div>
                  <DrawingCanvas readOnly strokes={g && g.stroke ? [g.stroke] : []} toolbar={false} />
                  <div className={styles.scoreTag}>{scores[pid] || 0} ★</div>
                </div>
              );
            })}
          </div>

          {phase === 'reveal' && (
            <div className={styles.ackArea}>
              {!iAcked && <button className={styles.primary} onClick={ack}>Continue</button>}
              <AckStatus players={players} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </div>
          )}

          {phase === 'finished' && results && (
            <div className={styles.results}>
              {results.map((r) => (
                <div key={r.playerId} className={styles.resultRow}>
                  <span className={styles.place}>{r.placement}</span>
                  <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.resultScore}>{r.handDescription}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
