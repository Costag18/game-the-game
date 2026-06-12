import { useEffect, useRef, useState, useMemo } from 'react';
import styles from './ExquisiteCorpse.module.css';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const CANVAS_W = 800;

/** translate a stroke's y by `dy` (returns a new stroke). */
function shiftStroke(stroke, dy) {
  return { ...stroke, points: stroke.points.map((p) => ({ x: p.x, y: p.y + dy })) };
}

export default function ExquisiteCorpseGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [strokes, setStrokes] = useState([]); // band-LOCAL coords (top of canvas = sliver origin)
  const [iSubmitted, setISubmitted] = useState(false);
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);
  const prevSubmitted = useRef(0);
  const autoSubmitted = useRef(false);

  const phase = gameState?.phase;
  const myBand = gameState?.myBand;
  const sliverH = gameState?.sliverH ?? 40;
  const sliverAbove = gameState?.sliverAbove || null;
  const hasSubmittedFlag = gameState?.hasSubmitted;
  const drawEndTime = gameState?.drawEndTime;
  const voteEndTime = gameState?.voteEndTime;

  // local->full coordinate offset: local y 0 == (yStart - sliverH) in full canvas
  const originY = myBand ? Math.max(0, myBand.yStart - (myBand.index === 0 ? 0 : sliverH)) : 0;
  const topInset = myBand && myBand.index === 0 ? 0 : sliverH; // drawable starts below the sliver
  const bandH = myBand ? myBand.yEnd - myBand.yStart : 0;
  const localH = bandH + topInset; // canvas logical height for my band view

  // refs mirroring latest local input so the countdown closure can auto-submit it
  const strokesRef = useRef([]);
  const originYRef = useRef(0);
  strokesRef.current = strokes;
  originYRef.current = originY;

  // reset local strokes when a fresh draw phase starts
  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'draw') { setStrokes([]); setISubmitted(false); }
      if (phase === 'reveal') setIAcked(false);
      autoSubmitted.current = false; // reset the timeout latch on every phase entry
      prevPhase.current = phase;
    }
  }, [phase]);

  // countdown for the active timed phase; ~1s before the deadline auto-submit the SAME
  // action the phase's button dispatches so nothing drawn is lost on timeout
  const endTime = phase === 'draw' ? drawEndTime : phase === 'vote' ? voteEndTime : null;
  useEffect(() => {
    if (!endTime) { setRemaining(null); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRemaining(rem);
      if (rem <= 1 && !autoSubmitted.current) {
        autoSubmitted.current = true;
        // only the DRAW phase holds local input (the strokes); replicate submitDrawing().
        // VOTE has no draft worth auto-sending (server auto-votes non-voters), so skip it.
        if (phase === 'draw' && !hasSubmittedFlag) {
          const full = strokesRef.current.map((s) => shiftStroke(s, originYRef.current));
          onAction({ type: 'submit', strokes: full });
          setISubmitted(true);
        }
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [endTime, phase, hasSubmittedFlag, onAction]);

  // little ping when another band lands
  const submittedCount = gameState?.submittedCount || 0;
  useEffect(() => {
    if (submittedCount > prevSubmitted.current) playSound?.('click');
    prevSubmitted.current = submittedCount;
  }, [submittedCount, playSound]);

  // the read-only sliver strokes, translated into band-local space (sit at the very top)
  const sliverLocalStrokes = useMemo(() => {
    if (!sliverAbove || topInset === 0) return [];
    // sliverAbove strokes are full-canvas; the displayed strip is [sliverAbove.yStart, sliverAbove.yEnd]
    // map full y -> local y by subtracting originY
    return sliverAbove.strokes.map((s) => shiftStroke(s, -originY));
  }, [sliverAbove, originY, topInset]);

  // combine: read-only sliver underneath the player's editable strokes
  const renderStrokes = useMemo(() => [...sliverLocalStrokes, ...strokes], [sliverLocalStrokes, strokes]);

  if (!gameState) return <div className={styles.arena}><p className={styles.status}>Splitting the canvas…</p></div>;

  const { prompt, composite, bandOrder, myVote, votedCount, scores = {}, acknowledged = [], results, myId, playerCount } = gameState;

  function addStroke(localStroke) {
    if (phase !== 'draw' || iSubmitted) return;
    setStrokes((s) => [...s, localStroke]);
  }
  function clearMine() { setStrokes([]); }
  function undoMine() { setStrokes((s) => s.slice(0, -1)); }

  function submitDrawing() {
    if (iSubmitted) return;
    // translate local strokes back to full-canvas coords; server re-clamps into the band
    const full = strokes.map((s) => shiftStroke(s, originY));
    onAction({ type: 'submit', strokes: full });
    setISubmitted(true);
    playSound?.('click');
  }
  function castVote(target) {
    if (myVote || target === myId) return;
    onAction({ type: 'vote', target });
    playSound?.('voteCast');
  }
  function ack() {
    if (iAcked) return;
    setIAcked(true);
    onAction({ type: 'acknowledge' });
  }

  // ---------- DRAW ----------
  if (phase === 'draw') {
    const submitted = iSubmitted || gameState.hasSubmitted;
    return (
      <div className={styles.arena}>
        <h1 className={styles.title}>Exquisite Corpse</h1>
        {remaining != null && (
          <span className={`${styles.timer} ${remaining <= 10 ? styles.timerLow : ''}`}>⏱ {remaining}s</span>
        )}
        <p className={styles.prompt}>Together, draw <strong>{prompt}</strong></p>
        <p className={styles.bandTag}>
          You are band {myBand ? myBand.index + 1 : '?'} of {playerCount}.
          {myBand && myBand.index > 0 ? ' Connect to the sliver up top.' : ' You\'re the head — start it off!'}
        </p>

        <div className={styles.bandFrame}>
          {topInset > 0 && <div className={styles.sliverLabel}>↑ band above — connect here</div>}
          <div className={styles.sliverDivider} style={{ top: `${(topInset / localH) * 100}%` }} />
          <DrawingCanvas
            readOnly={submitted}
            strokes={renderStrokes}
            onStroke={addStroke}
            onUndo={undoMine}
            onClear={clearMine}
            logicalWidth={CANVAS_W}
            logicalHeight={localH}
            toolbar={!submitted}
          />
        </div>

        {submitted ? (
          <p className={styles.status}>✅ Band submitted. {gameState.submittedCount}/{playerCount} done — waiting…</p>
        ) : (
          <button className={styles.bigBtn} onClick={submitDrawing}>Submit my band</button>
        )}
      </div>
    );
  }

  // ---------- VOTE ----------
  if (phase === 'vote') {
    return (
      <div className={styles.arena}>
        <h1 className={styles.title}>Vote the Best Band</h1>
        {remaining != null && (
          <span className={`${styles.timer} ${remaining <= 10 ? styles.timerLow : ''}`}>⏱ {remaining}s</span>
        )}
        <p className={styles.prompt}>The monster is assembled — but the pieces are hidden until the reveal!</p>
        <p className={styles.bandTag}>Pick the band you think is the best (you can't pick your own).</p>
        <div className={styles.voteGrid}>
          {(bandOrder || []).map((author, i) => {
            const mine = author === myId;
            const picked = myVote === author;
            return (
              <button
                key={author}
                className={`${styles.voteCard} ${picked ? styles.voteCardSel : ''} ${mine ? styles.voteCardMine : ''}`}
                disabled={mine || !!myVote}
                onClick={() => castVote(author)}
              >
                <span className={styles.bandNum}>Band {i + 1}</span>
                <PlayerName playerId={author} nicknames={nicknames} avatars={avatars} />
                {mine && <span className={styles.youTag}>your band</span>}
                {picked && <span className={styles.pickTag}>✓ your pick</span>}
              </button>
            );
          })}
        </div>
        <p className={styles.status}>
          {myVote ? 'Vote locked — ' : 'Tap a band — '}{votedCount}/{playerCount} voted
        </p>
      </div>
    );
  }

  // ---------- REVEAL / FINISHED ----------
  const comp = composite || [];
  const totalH = comp.length ? comp[comp.length - 1].yEnd : 600;
  const scoreRows = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>{phase === 'finished' ? 'The Creature!' : 'Reveal!'}</h1>
      <p className={styles.prompt}>{prompt}</p>

      <div className={styles.compositeWrap} style={{ aspectRatio: `${CANVAS_W} / ${totalH}` }}>
        <DrawingCanvas
          readOnly
          strokes={comp.flatMap((b) => b.strokes)}
          logicalWidth={CANVAS_W}
          logicalHeight={totalH}
          toolbar={false}
        />
        <div className={styles.bandLines}>
          {comp.map((b) => (
            <div
              key={b.authorId}
              className={styles.bandRow}
              style={{ top: `${(b.yStart / totalH) * 100}%`, height: `${((b.yEnd - b.yStart) / totalH) * 100}%` }}
            >
              <span className={styles.bandCredit}>
                <PlayerName playerId={b.authorId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.bandVotes}>{b.votes} ▲</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.scores}>
        {scoreRows.map(([pid, sc]) => {
          const r = results?.find((x) => x.playerId === pid);
          return (
            <div key={pid} className={styles.scoreRow}>
              {r && <span className={styles.place}>#{r.placement}</span>}
              <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
              <span className={styles.scoreVal}>{sc} pts</span>
            </div>
          );
        })}
      </div>

      {phase === 'reveal' && (
        <>
          <button className={styles.bigBtn} onClick={ack} disabled={iAcked}>
            {iAcked ? 'Waiting…' : 'Continue'}
          </button>
          <AckStatus
            players={gameState.bandOrder || Object.keys(scores)}
            acknowledged={acknowledged}
            me={myId}
            iActed={iAcked}
            nicknames={nicknames}
            avatars={avatars}
          />
        </>
      )}
    </div>
  );
}
