import { useEffect, useRef, useState } from 'react';
import styles from './Mastermind.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const HEX = { R: '#e53935', O: '#fb8c00', Y: '#fdd835', G: '#43a047', B: '#1e88e5', P: '#8e24aa' };

function Peg({ c, onClick, small }) {
  return (
    <span
      className={`${styles.peg} ${small ? styles.pegSm : ''} ${onClick ? styles.pegBtn : ''}`}
      style={{ background: HEX[c] || '#444' }}
      onClick={onClick}
    >{c}</span>
  );
}

function Feedback({ black, white }) {
  const dots = [];
  for (let i = 0; i < black; i++) dots.push(<span key={`b${i}`} className={styles.fbBlack} />);
  for (let i = 0; i < white; i++) dots.push(<span key={`w${i}`} className={styles.fbWhite} />);
  for (let i = black + white; i < 4; i++) dots.push(<span key={`e${i}`} className={styles.fbEmpty} />);
  return <span className={styles.fb}>{dots}</span>;
}

export default function Mastermind({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [current, setCurrent] = useState([]);
  const [iAcked, setIAcked] = useState(false);
  const [secsLeft, setSecsLeft] = useState(null);
  const prevSolved = useRef(false);
  const prevPhase = useRef(null);
  const pinged = useRef(false);

  const phase = gameState?.phase;
  const roundEndMs = gameState?.roundEndMs;
  const mySolved = gameState?.mySolved;

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
      if (phase === 'playing') { setCurrent([]); pinged.current = false; }
      prevPhase.current = phase;
    }
  }, [phase, playSound]);

  useEffect(() => {
    if (mySolved && !prevSolved.current) { playSound('winRound'); shake('heavy'); }
    prevSolved.current = mySolved;
  }, [mySolved, playSound, shake]);

  useEffect(() => {
    if (phase !== 'playing' || !roundEndMs) { setSecsLeft(null); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((roundEndMs - Date.now()) / 1000));
      setSecsLeft(rem);
      if (rem === 0 && !pinged.current) { pinged.current = true; onAction({ type: 'ping' }); }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, roundEndMs, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Generating the code…</p></div>;

  const {
    colors = [], maxGuesses = 10, myGuesses = [], myGuessCount = 0, myDone,
    myBestBlack = 0, opponents = [], secretCode, results, myId, acknowledged = [],
  } = gameState;

  function pick(c) { if (current.length < 4) { setCurrent((s) => [...s, c]); playSound('click'); } }
  function clearLast() { setCurrent((s) => s.slice(0, -1)); }
  function submit() {
    if (current.length !== 4 || myDone) return;
    onAction({ type: 'guess', pegs: current });
    playSound('cardDeal');
    setCurrent([]);
  }
  function ack() { if (iAcked) return; setIAcked(true); onAction({ type: 'acknowledge' }); }

  const allPlayers = [myId, ...opponents.map((o) => o.playerId)].filter(Boolean);

  return (
    <div className={styles.arena}>
      <div className={styles.header}>
        <h1 className={styles.title}>MASTERMIND</h1>
        {phase === 'playing' && (
          <span className={styles.meta}>Guess {Math.min(myGuessCount + 1, maxGuesses)}/{maxGuesses} · {secsLeft != null ? `${secsLeft}s` : ''}</span>
        )}
      </div>

      {(phase === 'reveal' || phase === 'finished') && secretCode && (
        <div className={styles.secretRow}>
          <span className={styles.secretLabel}>Code:</span>
          {secretCode.map((c, i) => <Peg key={i} c={c} small />)}
        </div>
      )}

      {phase === 'playing' && (
        <>
          <div className={styles.board}>
            {myGuesses.length === 0 && <p className={styles.hint}>Make your first guess ↓</p>}
            {myGuesses.map((g, i) => (
              <div key={i} className={styles.row}>
                <span className={styles.rowNum}>{i + 1}</span>
                {g.pegs.map((c, j) => <Peg key={j} c={c} small />)}
                <Feedback black={g.black} white={g.white} />
              </div>
            ))}
          </div>

          {myDone ? (
            <p className={styles.doneMsg}>{mySolved ? '✅ Cracked! Waiting for others…' : `Out of guesses — best: ${myBestBlack}🅑`}</p>
          ) : (
            <div className={styles.inputArea}>
              <div className={styles.slots}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={styles.slot} style={current[i] ? { background: HEX[current[i]] } : undefined}>{current[i] || ''}</span>
                ))}
              </div>
              <div className={styles.palette}>
                {colors.map((c) => <Peg key={c} c={c} onClick={() => pick(c)} />)}
              </div>
              <div className={styles.actions}>
                <button className={styles.clearBtn} onClick={clearLast} disabled={!current.length}>↩</button>
                <button className={styles.submitBtn} onClick={submit} disabled={current.length !== 4}>Submit</button>
              </div>
            </div>
          )}

          <div className={styles.opponents}>
            {opponents.map((o) => (
              <div key={o.playerId} className={styles.oppChip}>
                <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.oppStat}>{o.solved ? `✅ ${o.guessCount}` : `🔍 ${o.guessCount}`}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {(phase === 'reveal' || phase === 'finished') && results && (
        <div className={styles.revealBox}>
          <div className={styles.resultList}>
            {results.map((r) => (
              <div key={r.playerId} className={styles.resultRow}>
                <span className={styles.rPlace}>{r.placement}</span>
                <span className={styles.rName}><PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} /></span>
                <span className={styles.rDesc}>{r.handDescription}</span>
              </div>
            ))}
          </div>
          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.submitBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
