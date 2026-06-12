import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './TraceRace.module.css';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';

const TRACE_COLOR = '#1e88e5';
const TRACE_WIDTH = 10;

// build the faint guide stroke the player traces over (rendered, never submitted)
function guideStroke(path) {
  if (!path || !path.length) return null;
  return { id: 'guide', color: '#9bb7d4', width: 26, tool: 'pen', points: path.map((p) => ({ x: p.x, y: p.y })) };
}

export default function TraceRaceGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [myStrokes, setMyStrokes] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevRound = useRef(null);
  const prevPhase = useRef(null);
  const autoSubmitted = useRef(false);

  const phase = gameState?.phase;
  const round = gameState?.round;
  const drawEndTime = gameState?.drawEndTime;
  const hasSubmittedFlag = gameState?.hasSubmitted;

  // ref mirroring the latest strokes so the countdown closure can auto-submit them
  const myStrokesRef = useRef([]);
  myStrokesRef.current = myStrokes;

  // reset local strokes whenever a new draw round begins
  useEffect(() => {
    if (round !== prevRound.current || (phase === 'drawing' && prevPhase.current !== 'drawing')) {
      if (phase === 'drawing') { setMyStrokes([]); setSubmitted(false); autoSubmitted.current = false; }
      prevRound.current = round;
    }
    prevPhase.current = phase;
  }, [round, phase]);

  // countdown for the drawing phase; ~1s before the deadline auto-submit whatever's been
  // traced (the SAME payload the Submit button sends) so nothing is lost on timeout
  useEffect(() => {
    if (phase !== 'drawing' || !drawEndTime) { setRemaining(null); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((drawEndTime - Date.now()) / 1000));
      setRemaining(rem);
      if (rem <= 1 && !autoSubmitted.current && !hasSubmittedFlag) {
        autoSubmitted.current = true;
        setSubmitted(true);
        onAction({ type: 'submit', strokes: myStrokesRef.current.map((s) => ({ color: s.color, width: s.width, tool: 'pen', points: s.points })) });
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, drawEndTime, hasSubmittedFlag, onAction]);

  const guide = useMemo(() => guideStroke(gameState?.path), [gameState?.path]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Drawing the track…</p></div>;

  const {
    totalRounds, path = [], myRoundDetail, roundScores, scores = {},
    players = [], submittedCount, playerCount, results, myId,
  } = gameState;

  // live-ish coverage hint: % of target points my strokes pass near (client estimate only — server is authoritative)
  const coverageHint = useMemo(() => {
    if (!path.length || !myStrokes.length) return 0;
    const pts = [];
    for (const s of myStrokes) for (const p of s.points) pts.push(p);
    if (!pts.length) return 0;
    let hit = 0;
    for (const tp of path) {
      for (const mp of pts) {
        if (Math.abs(mp.x - tp.x) < 26 && Math.abs(mp.y - tp.y) < 26) { hit++; break; }
      }
    }
    return Math.round((hit / path.length) * 100);
  }, [myStrokes, path]);

  function onStroke(stroke) {
    if (submitted || phase !== 'drawing') return;
    setMyStrokes((prev) => [...prev, { ...stroke, color: TRACE_COLOR, width: TRACE_WIDTH }]);
    playSound('cardDeal');
  }
  function undo() { if (!submitted) setMyStrokes((prev) => prev.slice(0, -1)); }
  function clearAll() { if (!submitted) setMyStrokes([]); }
  function submit() {
    if (submitted) return;
    setSubmitted(true);
    onAction({ type: 'submit', strokes: myStrokes.map((s) => ({ color: s.color, width: s.width, tool: 'pen', points: s.points })) });
    playSound('vote');
  }

  const renderStrokes = guide ? [guide, ...myStrokes] : myStrokes;

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>Trace Race</h1>
      <p className={styles.roundLine}>Round {round} / {totalRounds}</p>

      {phase === 'drawing' && (
        <>
          {remaining != null && (
            <span className={`${styles.timer} ${remaining <= 10 ? styles.timerLow : ''}`}>⏱ {remaining}s</span>
          )}
          <p className={styles.instruct}>Trace the blue track as accurately as you can, then submit!</p>
          <div className={styles.hintBar}>
            <span className={styles.hintLabel}>Coverage</span>
            <div className={styles.hintTrack}><div className={styles.hintFill} style={{ width: `${coverageHint}%` }} /></div>
            <span className={styles.hintPct}>{coverageHint}%</span>
          </div>
          <DrawingCanvas readOnly={submitted} strokes={renderStrokes} onStroke={onStroke} onUndo={undo} onClear={clearAll} toolbar={false} />
          <div className={styles.actions}>
            <button className={styles.ghost} onClick={undo} disabled={submitted || !myStrokes.length}>↶ Undo</button>
            <button className={styles.ghost} onClick={clearAll} disabled={submitted || !myStrokes.length}>🗑️ Clear</button>
            {submitted
              ? <span className={styles.locked}>Submitted ✓ ({submittedCount}/{playerCount})</span>
              : <button className={styles.primary} onClick={submit}>Submit trace</button>}
          </div>
          {submitted && <p className={styles.waiting}>Waiting for the others to finish…</p>}
        </>
      )}

      {phase === 'reveal' && (
        <div className={styles.revealBox}>
          <p className={styles.revealHead}>Round {round} scored!</p>
          {myRoundDetail && (
            <div className={styles.myScoreCard}>
              <span className={styles.bigScore}>+{roundScores?.[myId] ?? 0}</span>
              <span className={styles.detail}>
                Coverage {Math.round((myRoundDetail.coverage || 0) * 100)}% · Spillover {Math.round((myRoundDetail.spilloverRatio || 0) * 100)}%
              </span>
            </div>
          )}
          <div className={styles.board}>
            {[...players].sort((a, b) => (roundScores?.[b] ?? 0) - (roundScores?.[a] ?? 0)).map((p) => (
              <div key={p} className={styles.boardRow}>
                <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} />
                <span className={styles.rRound}>+{roundScores?.[p] ?? 0}</span>
                <span className={styles.rTotal}>{scores[p] ?? 0}</span>
              </div>
            ))}
          </div>
          <p className={styles.waiting}>Next track coming up…</p>
        </div>
      )}

      {phase === 'finished' && results && (
        <div className={styles.finishBox}>
          <p className={styles.finishHead}>🏁 Final standings</p>
          <div className={styles.board}>
            {results.map((r) => (
              <div key={r.playerId} className={`${styles.boardRow} ${r.placement === 1 ? styles.winnerRow : ''}`}>
                <span className={styles.rPlace}>{r.placement}</span>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.rTotal}>{r.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
