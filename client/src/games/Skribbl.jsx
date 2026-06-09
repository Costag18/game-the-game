import { useEffect, useRef, useState } from 'react';
import styles from './Skribbl.module.css';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import PlayerName from '../components/PlayerName.jsx';
import { useSocketContext } from '../context/SocketContext.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { EVENTS } from '../../../shared/events.js';

export default function Skribbl({ gameState, onAction, nicknames, avatars }) {
  const { socket } = useSocketContext();
  const { playSound } = useSound();
  const [strokes, setStrokes] = useState([]);
  const [guess, setGuess] = useState('');
  const prevPhase = useRef(null);
  const prevSolvedCount = useRef(0);

  const phase = gameState?.phase;
  const isDrawer = gameState?.isDrawer;
  const drawPhase = gameState?.drawPhase;

  // reset canvas when a new drawing phase starts (new drawer / new turn)
  useEffect(() => {
    if (drawPhase !== prevPhase.current) { setStrokes([]); setGuess(''); prevPhase.current = drawPhase; }
  }, [drawPhase]);

  // live canvas listeners
  useEffect(() => {
    if (!socket) return;
    const onSnap = (d) => setStrokes(d?.strokes || []);
    const onBroadcast = (d) => { if (d?.stroke) setStrokes((s) => [...s, d.stroke]); };
    const onUndo = (d) => setStrokes((s) => s.filter((x) => x.id !== d?.strokeId));
    const onClear = () => setStrokes([]);
    socket.on(EVENTS.CANVAS_SNAPSHOT, onSnap);
    socket.on(EVENTS.STROKE_BROADCAST, onBroadcast);
    socket.on(EVENTS.CANVAS_UNDO, onUndo);
    socket.on(EVENTS.CANVAS_CLEAR, onClear);
    return () => {
      socket.off(EVENTS.CANVAS_SNAPSHOT, onSnap);
      socket.off(EVENTS.STROKE_BROADCAST, onBroadcast);
      socket.off(EVENTS.CANVAS_UNDO, onUndo);
      socket.off(EVENTS.CANVAS_CLEAR, onClear);
    };
  }, [socket]);

  const solved = gameState?.solved || [];
  useEffect(() => {
    if (solved.length > prevSolvedCount.current) playSound('correct');
    prevSolvedCount.current = solved.length;
  }, [solved.length, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Picking a word…</p></div>;

  const { word, maskedWord, scores = {}, drawerId, turnNumber, totalTurns, iSolved, myGuessFeedback, myId } = gameState;

  function emitStroke(stroke) { socket?.emit(EVENTS.STROKE_SEND, { stroke }); }
  function emitUndo() { socket?.emit(EVENTS.CANVAS_UNDO_SEND); }
  function emitClear() { socket?.emit(EVENTS.CANVAS_CLEAR_SEND); }
  function submitGuess() {
    const t = guess.trim();
    if (!t || iSolved) return;
    onAction({ type: 'guess', text: t });
    setGuess('');
  }

  const orderedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>SKRIBBL</h1>
        <span className={styles.meta}>Turn {turnNumber}/{totalTurns}</span>
      </div>

      <div className={styles.drawerLine}>
        {isDrawer ? <>You are drawing:</> : <><PlayerName playerId={drawerId} nicknames={nicknames} avatars={avatars} /> is drawing</>}
      </div>

      {/* word / hint */}
      <div className={styles.wordBox}>
        {phase === 'reveal' || phase === 'finished'
          ? <span className={styles.theWord}>The word was: <strong>{word}</strong></span>
          : isDrawer
            ? <span className={styles.theWord}>{word}</span>
            : <span className={styles.blanks}>{maskedWord.split('').map((ch, i) => <span key={i} className={styles.blank}>{ch === '_' ? '_' : ch}</span>)}</span>}
      </div>

      <DrawingCanvas
        readOnly={!isDrawer || phase !== 'drawing'}
        strokes={strokes}
        onStroke={emitStroke}
        onUndo={emitUndo}
        onClear={emitClear}
        toolbar={isDrawer && phase === 'drawing'}
      />

      {/* guess box for guessers */}
      {!isDrawer && phase === 'drawing' && (
        iSolved ? (
          <p className={styles.solvedMsg}>✅ You got it! Waiting for others…</p>
        ) : (
          <div className={styles.guessRow}>
            <input
              className={styles.guessInput}
              value={guess}
              maxLength={40}
              placeholder="Type your guess…"
              onChange={(e) => setGuess(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitGuess(); }}
            />
            <button className={styles.guessBtn} onClick={submitGuess}>Guess</button>
            {myGuessFeedback === 'close' && <span className={styles.closeTag}>So close!</span>}
          </div>
        )
      )}

      {/* scoreboard */}
      <div className={styles.scores}>
        {orderedScores.map(([pid, sc]) => (
          <div key={pid} className={`${styles.scoreRow} ${solved.includes(pid) ? styles.scoreSolved : ''}`}>
            <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{sc}{pid === drawerId ? ' ✏️' : solved.includes(pid) ? ' ✅' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
