import { useEffect, useRef, useState } from 'react';
import styles from './TypingRace.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

export default function TypingRace({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const taRef = useRef(null);
  const emitTimer = useRef(null);
  const lastSent = useRef('');
  const wasFinished = useRef(false);
  const pinged = useRef(false);
  const [remaining, setRemaining] = useState(null);

  const phase = gameState?.phase;
  const cutoffAt = gameState?.cutoffAt;
  const myFinished = gameState?.myFinished;

  // Local countdown derived from the authoritative cutoffAt; ping once if it hits 0.
  useEffect(() => {
    if (phase !== 'racing' || !cutoffAt) { setRemaining(null); pinged.current = false; return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((cutoffAt - Date.now()) / 1000));
      setRemaining(rem);
      if (rem === 0 && !pinged.current) { pinged.current = true; onAction({ type: 'ping' }); }
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [phase, cutoffAt, onAction]);

  useEffect(() => {
    if (phase === 'racing' && !myFinished && taRef.current) taRef.current.focus();
  }, [phase, myFinished]);

  useEffect(() => {
    if (myFinished && !wasFinished.current) {
      wasFinished.current = true;
      playSound('winRound');
      shake('light');
    }
    if (!myFinished) wasFinished.current = false;
  }, [myFinished, playSound, shake]);

  if (!gameState) {
    return <div className={styles.scroll}><p className={styles.loading}>Unrolling the scroll…</p></div>;
  }

  const { passage = '', myProgress = 0, racers = [], standings } = gameState;

  function handleInput(e) {
    const text = e.target.value;
    if (emitTimer.current) return; // inside throttle window
    lastSent.current = text;
    onAction({ type: 'typed', text });
    emitTimer.current = setTimeout(() => {
      emitTimer.current = null;
      const v = taRef.current ? taRef.current.value : text;
      if (v !== lastSent.current) { lastSent.current = v; onAction({ type: 'typed', text: v }); }
    }, 90);
  }

  // Colour the passage purely from the server's authoritative myProgress.
  const correct = passage.slice(0, myProgress);
  const caret = passage.slice(myProgress, myProgress + 1);
  const ghost = passage.slice(myProgress + 1);

  return (
    <div className={styles.scroll}>
      <div className={styles.header}>
        <h1 className={styles.title}>Typing Race</h1>
        <div className={styles.seal}>
          {phase === 'finished' ? 'Done' : remaining != null ? `${remaining}s` : ''}
        </div>
      </div>

      <div className={styles.passage}>
        <span className={styles.inked}>{correct}</span>
        <span className={styles.caretChar}>{caret || ' '}</span>
        <span className={styles.ghost}>{ghost}</span>
      </div>

      {phase === 'racing' && (
        <textarea
          ref={taRef}
          className={styles.input}
          onChange={handleInput}
          disabled={myFinished}
          placeholder={myFinished ? 'Finished! Waiting for others…' : 'Type the scroll here…'}
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          rows={3}
        />
      )}

      <div className={styles.track}>
        {racers.map((r) => (
          <div key={r.playerId} className={`${styles.lane} ${r.left ? styles.laneLeft : ''}`}>
            <span className={styles.laneName}>
              <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
            </span>
            <div className={styles.rail}>
              <div className={styles.marker} style={{ left: `calc(${r.pct}% - 10px)` }}>
                {r.finished ? '🏁' : '✍️'}
              </div>
            </div>
            <span className={styles.laneWpm}>{r.finished ? '✓' : `${r.wpm} wpm`}</span>
          </div>
        ))}
      </div>

      {phase === 'finished' && standings && (
        <div className={styles.standings}>
          <h2 className={styles.standingsTitle}>Results</h2>
          {standings.map((s) => (
            <div key={s.playerId} className={styles.standRow}>
              <span className={styles.standPlace}>{s.placement}</span>
              <span className={styles.standName}>
                <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
              </span>
              <span className={styles.standDesc}>{s.handDescription}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
