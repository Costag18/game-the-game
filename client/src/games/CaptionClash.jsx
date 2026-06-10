import { useEffect, useRef, useState } from 'react';
import styles from './CaptionClash.module.css';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function CaptionClashGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [strokes, setStrokes] = useState([]);
  const [caption, setCaption] = useState('');
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'draw') setStrokes([]);
    if (phase === 'caption') setCaption('');
    if (phase === 'vote') { setPick(null); playSound('voteCast'); }
    if (phase === 'reveal') { setIAcked(false); playSound('roundWin'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Sharpening pencils…</p></div>;

  const {
    prompt, myId, playerCount, scores = {},
    hasDrawn, drawnCount,
    captionTask, hasCaptioned, captionedCount,
    gallery, myVote, votedCount,
    acknowledged = [], reveal, results,
  } = gameState;

  function appendStroke(s) { setStrokes((arr) => [...arr, s]); }
  function undoStroke() { setStrokes((arr) => arr.slice(0, -1)); }
  function clearStrokes() { setStrokes([]); }
  function submitDrawing() {
    if (hasDrawn) return;
    playSound('voteCast');
    onAction({ type: 'submit', strokes });
  }
  function submitCaption() {
    if (hasCaptioned) return;
    const t = caption.trim();
    if (!t) return;
    playSound('voteCast');
    onAction({ type: 'caption', text: t });
  }
  function castVote(pairId) {
    if (myVote) return;
    setPick(pairId);
    playSound('voteCast');
    onAction({ type: 'vote', pairId });
  }
  function ack() { setIAcked(true); onAction({ type: 'acknowledge' }); }

  const orderedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>CAPTION CLASH</h1>

      {/* ---------- DRAW ---------- */}
      {phase === 'draw' && (
        <div className={styles.phaseCol}>
          <div className={styles.promptBox}>Draw: <strong>{prompt}</strong></div>
          {hasDrawn ? (
            <p className={styles.waitMsg}>
              ✏️ Doodle submitted! Waiting for others… ({drawnCount}/{playerCount})
            </p>
          ) : (
            <>
              <DrawingCanvas
                strokes={strokes}
                onStroke={appendStroke}
                onUndo={undoStroke}
                onClear={clearStrokes}
                toolbar
              />
              <button className={styles.primaryBtn} onClick={submitDrawing}>
                Submit doodle
              </button>
              <span className={styles.subtle}>Make it absurd. Others will caption it.</span>
            </>
          )}
        </div>
      )}

      {/* ---------- CAPTION ---------- */}
      {phase === 'caption' && (
        <div className={styles.phaseCol}>
          <div className={styles.promptBox}>Caption this masterpiece 👇</div>
          {captionTask ? (
            <DrawingCanvas readOnly strokes={captionTask.strokes} toolbar={false} />
          ) : (
            <p className={styles.subtle}>No doodle assigned.</p>
          )}
          {hasCaptioned ? (
            <p className={styles.waitMsg}>
              💬 Caption locked in! Waiting for others… ({captionedCount}/{playerCount})
            </p>
          ) : (
            <>
              <input
                className={styles.captionInput}
                value={caption}
                maxLength={100}
                placeholder="Write a funny caption…"
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitCaption(); }}
              />
              <button className={styles.primaryBtn} onClick={submitCaption} disabled={!caption.trim()}>
                Submit caption
              </button>
            </>
          )}
        </div>
      )}

      {/* ---------- VOTE ---------- */}
      {phase === 'vote' && (
        <div className={styles.phaseCol}>
          <div className={styles.promptBox}>Vote the funniest pairing! 🏆</div>
          {myVote ? (
            <p className={styles.waitMsg}>
              🗳️ Vote cast! Waiting for others… ({votedCount}/{playerCount})
            </p>
          ) : (
            <span className={styles.subtle}>You can't vote your own doodle or caption.</span>
          )}
          <div className={styles.gallery}>
            {(gallery || []).map((item) => {
              const selected = (myVote || pick) === item.pairId;
              const disabled = !item.canVote || !!myVote;
              return (
                <div
                  key={item.pairId}
                  className={`${styles.card} ${selected ? styles.cardSel : ''} ${!item.canVote ? styles.cardMine : ''}`}
                >
                  <div className={styles.cardCanvas}>
                    <DrawingCanvas readOnly strokes={item.strokes} toolbar={false} />
                  </div>
                  <p className={styles.cardCaption}>“{item.caption || '…'}”</p>
                  <button
                    className={styles.voteBtn}
                    disabled={disabled}
                    onClick={() => castVote(item.pairId)}
                  >
                    {!item.canVote ? 'Yours' : selected ? '✓ Voted' : 'Vote'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- REVEAL / FINISHED ---------- */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.phaseCol}>
          <div className={styles.promptBox}>The results are in! 🎉</div>
          <div className={styles.gallery}>
            {[...reveal.pairs].sort((a, b) => b.voteCount - a.voteCount).map((p) => (
              <div key={p.pairId} className={styles.card}>
                <div className={styles.cardCanvas}>
                  <DrawingCanvas readOnly strokes={p.strokes} toolbar={false} />
                </div>
                <p className={styles.cardCaption}>“{p.caption || '…'}”</p>
                <div className={styles.credits}>
                  <span className={styles.credit}>🎨 <PlayerName playerId={p.doodleAuthorId} nicknames={nicknames} avatars={avatars} /></span>
                  <span className={styles.credit}>💬 <PlayerName playerId={p.captionAuthorId} nicknames={nicknames} avatars={avatars} /></span>
                </div>
                <div className={styles.voteTally}>{p.voteCount} vote{p.voteCount === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>
          {phase === 'reveal' && (
            <div className={styles.ackWrap}>
              <button className={styles.primaryBtn} onClick={ack} disabled={iAcked}>Continue</button>
              <AckStatus
                players={Object.keys(scores)}
                acknowledged={acknowledged}
                me={myId}
                iActed={iAcked}
                nicknames={nicknames}
                avatars={avatars}
              />
            </div>
          )}
        </div>
      )}

      {/* ---------- SCOREBOARD ---------- */}
      <div className={styles.scores}>
        {(results || orderedScores.map(([pid, sc]) => ({ playerId: pid, score: sc, placement: null }))).map((r) => (
          <div key={r.playerId} className={styles.scoreRow}>
            {r.placement ? <span className={styles.place}>#{r.placement}</span> : null}
            <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{r.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
