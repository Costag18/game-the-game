import { useEffect, useRef, useState } from 'react';
import styles from './CrackTheVault.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export default function CrackTheVaultGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [entry, setEntry] = useState([]);   // current digits being typed
  const [iAcked, setIAcked] = useState(false);
  const [secsLeft, setSecsLeft] = useState(null);
  const prevPhase = useRef(null);
  const prevGuessCount = useRef(0);

  const phase = gameState?.phase;
  const codeLength = gameState?.codeLength ?? 4;
  const deadline = gameState?.deadline ?? null;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'cracking') { setEntry([]); }
    if (phase === 'reveal') { setIAcked(false); }
    prevPhase.current = phase;
  }, [phase]);

  // countdown to the server deadline
  useEffect(() => {
    if (!deadline) { setSecsLeft(null); return; }
    const tick = () => setSecsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline]);

  // sound feedback when a new feedback row lands
  useEffect(() => {
    const gc = gameState?.myGuessCount ?? 0;
    if (gc > prevGuessCount.current) {
      const last = gameState?.myGuesses?.[gc - 1];
      if (last && last.locked === codeLength) playSound('winRound');
      else playSound('cardFlip');
    }
    prevGuessCount.current = gc;
  }, [gameState?.myGuessCount, gameState?.myGuesses, codeLength, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Spinning the dials…</p></div>;

  const {
    myId, maxGuesses = 12, myGuesses = [], myGuessCount = 0, myCracked, myCrackedRank,
    myOut, myDone, crackedCount = 0, opponents = [], secretCode, results, acknowledged = [],
  } = gameState;

  const allPlayers = [myId, ...opponents.map((o) => o.playerId)];

  function tapDigit(d) {
    if (myDone || phase !== 'cracking') return;
    if (entry.length >= codeLength) return;
    setEntry((e) => [...e, d]);
    playSound('click');
  }
  function backspace() {
    setEntry((e) => e.slice(0, -1));
  }
  function clearEntry() { setEntry([]); }
  function submitGuess() {
    if (entry.length !== codeLength || myDone) return;
    onAction({ type: 'guess', digits: entry });
    setEntry([]);
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const guessesLeft = maxGuesses - myGuessCount;
  const revealing = phase === 'reveal' || phase === 'finished';

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>CRACK THE VAULT</h1>
        {phase === 'cracking' && secsLeft != null && (
          <span className={`${styles.timer} ${secsLeft <= 10 ? styles.timerLow : ''}`}>{secsLeft}s</span>
        )}
      </div>

      {phase === 'cracking' && (
        <p className={styles.sub}>
          One hidden {codeLength}-digit code. <b>Locked</b> = right digit, right slot · <b>Loose</b> = right digit, wrong slot.
          First to {codeLength} locked cracks it.
        </p>
      )}

      {/* CRACKED banner */}
      {phase === 'cracking' && myCracked && (
        <div className={styles.crackedBanner}>
          🔓 VAULT CRACKED — you finished {ordinal(myCrackedRank)}! Waiting for others…
        </div>
      )}
      {phase === 'cracking' && myOut && !myCracked && (
        <div className={styles.outBanner}>🔒 Out of guesses — the vault held. Waiting…</div>
      )}

      {/* Current entry display */}
      {phase === 'cracking' && !myDone && (
        <>
          <div className={styles.dials}>
            {Array.from({ length: codeLength }).map((_, i) => (
              <div key={i} className={`${styles.dial} ${entry[i] != null ? styles.dialSet : ''}`}>
                {entry[i] != null ? entry[i] : '–'}
              </div>
            ))}
          </div>

          <div className={styles.pad}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
              <button key={d} className={styles.key} onClick={() => tapDigit(d)} disabled={entry.length >= codeLength}>{d}</button>
            ))}
            <button className={styles.keyAlt} onClick={backspace} disabled={entry.length === 0}>⌫</button>
            <button className={styles.key} onClick={() => tapDigit(0)} disabled={entry.length >= codeLength}>0</button>
            <button className={styles.keyAlt} onClick={clearEntry} disabled={entry.length === 0}>CLR</button>
          </div>

          <button
            className={styles.submitBtn}
            onClick={submitGuess}
            disabled={entry.length !== codeLength}
          >
            TRY ({guessesLeft} left)
          </button>
        </>
      )}

      {/* Guess history with locked/loose pegs */}
      {(phase === 'cracking' || revealing) && myGuesses.length > 0 && (
        <div className={styles.history}>
          {myGuesses.map((g, i) => (
            <div key={i} className={`${styles.histRow} ${g.locked === codeLength ? styles.histWin : ''}`}>
              <span className={styles.histNum}>{i + 1}</span>
              <span className={styles.histDigits}>
                {g.digits.map((d, j) => <span key={j} className={styles.histDigit}>{d}</span>)}
              </span>
              <span className={styles.pegs}>
                <span className={styles.lockedPeg} title="locked">●×{g.locked}</span>
                <span className={styles.loosePeg} title="loose">○×{g.loose}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Opponents progress */}
      {phase === 'cracking' && opponents.length > 0 && (
        <div className={styles.oppBoard}>
          <div className={styles.oppHead}>Other safecrackers</div>
          {opponents.map((o) => (
            <div key={o.playerId} className={styles.oppRow}>
              <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.oppStat}>
                {o.cracked
                  ? <span className={styles.oppCracked}>🔓 {ordinal(o.crackedRank)}</span>
                  : o.out
                    ? <span className={styles.oppOut}>🔒 out</span>
                    : `${o.guessCount} tr${o.guessCount === 1 ? 'y' : 'ies'}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* REVEAL / FINISHED */}
      {revealing && (
        <div className={styles.reveal}>
          {secretCode && (
            <div className={styles.codeReveal}>
              <span className={styles.codeLabel}>The code was</span>
              <span className={styles.codeDigits}>
                {secretCode.map((d, i) => <span key={i} className={styles.codeDigit}>{d}</span>)}
              </span>
            </div>
          )}
          <div className={styles.standings}>
            {(results || []).map((r) => (
              <div key={r.playerId} className={`${styles.standRow} ${r.placement === 1 ? styles.standWin : ''}`}>
                <span className={styles.place}>{r.placement}</span>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.standDesc}>{r.handDescription}</span>
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
