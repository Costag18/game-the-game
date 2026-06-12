import { useEffect, useRef, useState } from 'react';
import styles from './SketchImpostor.module.css';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function SketchImpostor({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [iAcked, setIAcked] = useState(false);
  const [vote, setVote] = useState(null);
  const [guess, setGuess] = useState('');
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);
  const autoSubmitted = useRef(false);
  // keep the latest local input reachable from the countdown closure
  const voteRef = useRef(null);
  voteRef.current = vote;
  const guessRef = useRef('');
  guessRef.current = guess;

  const phase = gameState?.phase;
  const myVote = gameState?.myVote;
  const myRoleEarly = gameState?.myRole;
  const deadline = phase === 'voting' ? gameState?.voteEndTime
    : phase === 'impostorGuess' ? gameState?.guessEndTime
    : null;

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'reveal') setIAcked(false);
      if (phase === 'voting') { setVote(null); autoSubmitted.current = false; }
      if (phase === 'impostorGuess') autoSubmitted.current = false;
      prevPhase.current = phase;
    }
  }, [phase]);

  // countdown + auto-submit the held vote / typed guess ~1s before the deadline so nothing is lost on timeout
  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(rem);
      if (rem > 1 || autoSubmitted.current) return;
      if (phase === 'voting' && !myVote) {
        if (voteRef.current) { autoSubmitted.current = true; onAction({ type: 'vote', target: voteRef.current }); }
      } else if (phase === 'impostorGuess' && myRoleEarly === 'impostor') {
        const t = guessRef.current.trim();
        if (t) { autoSubmitted.current = true; onAction({ type: 'guessWord', text: t }); }
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, phase, myVote, myRoleEarly, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Picking a word…</p></div>;

  const {
    myRole, word, strokes = [], currentDrawer, isMyTurn, turnsLeft, acknowledged = [],
    players = [], impostorId, accused, impostorWordGuess, scores = {}, results, myId,
  } = gameState;
  const isImpostor = myRole === 'impostor';

  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }
  function sendStroke(stroke) { onAction({ type: 'drawStroke', stroke }); playSound('cardDeal'); }
  function castVote() { if (vote) { onAction({ type: 'vote', target: vote }); } }
  function sendGuess() { const t = guess.trim(); if (t) onAction({ type: 'guessWord', text: t }); }

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>Sketch Impostor</h1>

      {phase === 'reveal' && (
        <div className={styles.roleBox}>
          {isImpostor ? (
            <>
              <p className={styles.impostorTag}>🤫 You are the IMPOSTOR</p>
              <p className={styles.roleSub}>You don't know the word — draw something convincing and blend in!</p>
            </>
          ) : (
            <>
              <p className={styles.artistTag}>🎨 You are an Artist</p>
              <p className={styles.theWord}>The word is: <strong>{word}</strong></p>
            </>
          )}
          {!iAcked && <button className={styles.primary} onClick={ack}>Ready</button>}
          <AckStatus players={players} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {phase === 'drawing' && (
        <>
          <p className={styles.turnLine}>
            {isMyTurn ? 'Your turn — draw ONE stroke' : <>Watching <PlayerName playerId={currentDrawer} nicknames={nicknames} avatars={avatars} /> draw…</>}
            <span className={styles.turnsLeft}> · {turnsLeft} strokes left</span>
          </p>
          {!isImpostor && <p className={styles.wordHint}>Word: <strong>{word}</strong></p>}
          {isImpostor && <p className={styles.wordHint}>You're faking it — no word!</p>}
          <DrawingCanvas readOnly={!isMyTurn} strokes={strokes} onStroke={sendStroke} toolbar={isMyTurn} />
          {isMyTurn && <button className={styles.skip} onClick={() => onAction({ type: 'skipStroke' })}>Skip my stroke</button>}
        </>
      )}

      {phase === 'voting' && (
        <div className={styles.voteBox}>
          <DrawingCanvas readOnly strokes={strokes} toolbar={false} />
          <p className={styles.votePrompt}>Who is the impostor?{remaining != null && <span className={styles.countdown}> · {remaining}s</span>}</p>
          <div className={styles.voteGrid}>
            {players.filter((p) => p !== myId).map((p) => (
              <button key={p} className={`${styles.voteBtn} ${vote === p ? styles.voteSel : ''}`} onClick={() => setVote(p)}>
                <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} />
              </button>
            ))}
          </div>
          {gameState.myVote ? <p className={styles.locked}>Vote locked ✓ ({gameState.votedCount}/{players.length})</p>
            : <button className={styles.primary} onClick={castVote} disabled={!vote}>Lock vote</button>}
        </div>
      )}

      {phase === 'impostorGuess' && (
        isImpostor ? (
          <div className={styles.guessBox}>
            <p className={styles.caught}>You were caught! Name the word to steal the win:{remaining != null && <span className={styles.countdown}> · {remaining}s</span>}</p>
            <input className={styles.input} value={guess} maxLength={60} onChange={(e) => setGuess(e.target.value)} placeholder="The word was…" />
            <button className={styles.primary} onClick={sendGuess} disabled={!guess.trim()}>Guess</button>
          </div>
        ) : <p className={styles.waiting}>The impostor was caught — they're guessing the word…</p>
      )}

      {phase === 'finished' && results && (
        <div className={styles.finishBox}>
          <DrawingCanvas readOnly strokes={strokes} toolbar={false} />
          <p className={styles.reveal}>The impostor was <PlayerName playerId={impostorId} nicknames={nicknames} avatars={avatars} /> · the word was <strong>{word}</strong></p>
          {impostorWordGuess && <p className={styles.reveal}>Impostor guessed: "{impostorWordGuess}"</p>}
          <div className={styles.scores}>
            {results.map((r) => (
              <div key={r.playerId} className={styles.scoreRow}>
                <span className={styles.rPlace}>{r.placement}</span>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.rTag}>{r.handDescription} · {r.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
