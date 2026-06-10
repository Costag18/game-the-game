import { useEffect, useRef, useState } from 'react';
import styles from './EchoChamber.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const PAD_COLORS = ['#ff5a5f', '#36c2ff', '#ffd23f', '#3ddc84']; // 0..3
const PAD_NAMES = ['Red', 'Blue', 'Yellow', 'Green'];

export default function EchoChamberGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [flashPad, setFlashPad] = useState(null); // index currently flashing during SHOW
  const [iAcked, setIAcked] = useState(false);
  const [secs, setSecs] = useState(null);
  const flashTimers = useRef([]);
  const prevPhase = useRef(null);
  const prevRound = useRef(0);

  const phase = gameState?.phase;
  const round = gameState?.round;
  const sequence = gameState?.sequence;
  const showTiming = gameState?.showTiming;
  const deadline = gameState?.deadline;

  // --- SHOW: flash the sequence in sync using the server-driven timing --------
  useEffect(() => {
    // clear any scheduled flashes
    flashTimers.current.forEach((t) => clearTimeout(t));
    flashTimers.current = [];
    setFlashPad(null);

    if (phase !== 'show' || !Array.isArray(sequence) || !showTiming) return;

    const { leadMs, flashMs, gapMs } = showTiming;
    // The server emits an absolute startMs in server time, but the client clock may
    // differ — GAME_STATE for 'show' arrives right at the start of the phase, so we
    // schedule the flashes relative to local "now" using the lead-in delay.
    const base = leadMs;
    sequence.forEach((pad, i) => {
      const onAt = base + i * (flashMs + gapMs);
      const offAt = onAt + flashMs;
      flashTimers.current.push(setTimeout(() => { setFlashPad(pad); playSound('click'); }, onAt));
      flashTimers.current.push(setTimeout(() => setFlashPad(null), offAt));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round, JSON.stringify(sequence), JSON.stringify(showTiming)]);

  // reset ack on entering reveal
  useEffect(() => {
    if (phase === prevPhase.current && round === prevRound.current) return;
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    if (phase === 'input' && round !== prevRound.current) playSound('cardFlip');
    prevPhase.current = phase;
    prevRound.current = round;
  }, [phase, round, playSound]);

  // --- countdown to deadline --------------------------------------------------
  useEffect(() => {
    if (deadline == null) { setSecs(null); return; }
    // deadline is in server time; approximate remaining by anchoring to local now
    // on the first tick of this phase (the value is only a display aid).
    const anchorLocal = Date.now();
    const tick = () => {
      const elapsed = Date.now() - anchorLocal;
      // we don't know the exact server remaining, so estimate from phase budget.
      setSecs(Math.max(0, Math.ceil((remainingBudget(gameState) - elapsed) / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round, deadline]);

  useEffect(() => () => flashTimers.current.forEach((t) => clearTimeout(t)), []);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Tuning the echo…</p></div>;
  }

  const {
    padCount = 4, myId, myAlive, myDepth = 0, myTapsEntered = 0, seqLength = 0,
    myDoneThisRound, myFailedThisRound, opponents = [], aliveCount,
    revealedSequence, results, acknowledged = [], maxLength,
  } = gameState;

  const allPlayers = [myId, ...opponents.map((o) => o.playerId)].filter(Boolean);

  function tap(i) {
    if (phase !== 'input' || !myAlive || myDoneThisRound) return;
    playSound('coin');
    onAction({ type: 'tap', pad: i });
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const pads = Array.from({ length: padCount }, (_, i) => i);
  const inputActive = phase === 'input' && myAlive && !myDoneThisRound;

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>ECHO CHAMBER</h1>
        <span className={styles.round}>
          Round {round}{maxLength ? ` / ${maxLength}` : ''} · {aliveCount} alive
        </span>
      </div>

      {/* status banner */}
      {phase === 'show' && <p className={styles.banner}>Watch the sequence… ({seqLength} steps)</p>}
      {phase === 'input' && (
        myFailedThisRound ? (
          <p className={`${styles.banner} ${styles.bad}`}>Wrong pad! You’re out at length {myDepth}.</p>
        ) : myDoneThisRound ? (
          <p className={`${styles.banner} ${styles.good}`}>Nailed it — waiting for others…</p>
        ) : !myAlive ? (
          <p className={`${styles.banner} ${styles.dim}`}>Eliminated — watching the rest.</p>
        ) : (
          <p className={styles.banner}>Repeat it! {myTapsEntered}/{seqLength}{secs != null ? ` · ${secs}s` : ''}</p>
        )
      )}

      {/* PADS */}
      {(phase === 'show' || phase === 'input') && (
        <div className={styles.padGrid}>
          {pads.map((i) => {
            const lit = phase === 'show' && flashPad === i;
            return (
              <button
                key={i}
                className={`${styles.pad} ${lit ? styles.padLit : ''}`}
                style={{
                  '--pad-color': PAD_COLORS[i % PAD_COLORS.length],
                  opacity: phase === 'input' && !inputActive ? 0.4 : 1,
                }}
                disabled={!inputActive}
                onClick={() => tap(i)}
                aria-label={PAD_NAMES[i % PAD_NAMES.length]}
              >
                <span className={styles.padInner} />
              </button>
            );
          })}
        </div>
      )}

      {/* my progress dots during input */}
      {phase === 'input' && myAlive && (
        <div className={styles.progressDots}>
          {Array.from({ length: seqLength }, (_, i) => (
            <span key={i} className={`${styles.dot} ${i < myTapsEntered ? styles.dotOn : ''}`} />
          ))}
        </div>
      )}

      {/* opponents strip (counts only, never their taps) */}
      {(phase === 'show' || phase === 'input') && opponents.length > 0 && (
        <div className={styles.oppStrip}>
          {opponents.map((o) => (
            <div key={o.playerId} className={`${styles.oppChip} ${o.alive ? '' : styles.oppOut}`}>
              <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} size={18} />
              <span className={styles.oppMeta}>
                {o.alive
                  ? (phase === 'input'
                      ? (o.doneThisRound ? '✓' : `${o.tapsEntered}/${seqLength}`)
                      : `d${o.depth}`)
                  : `out @${o.depth}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* REVEAL / FINISHED */}
      {(phase === 'reveal' || phase === 'finished') && (
        <div className={styles.reveal}>
          {Array.isArray(revealedSequence) && (
            <div className={styles.seqReveal}>
              <span className={styles.seqLabel}>The sequence was</span>
              <div className={styles.seqPads}>
                {revealedSequence.map((p, i) => (
                  <span
                    key={i}
                    className={styles.seqPad}
                    style={{ background: PAD_COLORS[p % PAD_COLORS.length] }}
                  >{i + 1}</span>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(results) && (
            <div className={styles.standings}>
              {results.map((r) => (
                <div
                  key={r.playerId}
                  className={`${styles.standRow} ${r.playerId === myId ? styles.standMine : ''}`}
                >
                  <span className={styles.place}>#{r.placement}</span>
                  <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.depthVal}>len {r.depth}</span>
                </div>
              ))}
            </div>
          )}
          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus
                players={allPlayers}
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
    </div>
  );
}

// rough per-phase time budget used only to render a friendly countdown
function remainingBudget(gs) {
  if (!gs) return 0;
  const len = gs.seqLength || 1;
  if (gs.phase === 'input') return 5000 + len * 1200;
  return 0;
}
