import { useEffect, useRef, useState } from 'react';
import styles from './Spyfall.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

function useCountdown(deadline) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export default function SpyfallGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [pick, setPick] = useState(null);      // suspect id during voting
  const [locPick, setLocPick] = useState(null); // location during spyGuess
  const [iReady, setIReady] = useState(false);
  const prevPhase = useRef(null);
  const pickRef = useRef(null);
  const locPickRef = useRef(null);
  const autoSubmitted = useRef(false);
  pickRef.current = pick;
  locPickRef.current = locPick;

  const phase = gameState?.phase;
  const isInputPhase = phase === 'voting' || phase === 'spyGuess';
  const secs = useCountdown(isInputPhase ? gameState?.deadline : null);

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'reveal') { setIReady(false); playSound('roundStart'); }
    if (phase === 'voting') { setPick(null); autoSubmitted.current = false; }
    if (phase === 'spyGuess') { setLocPick(null); autoSubmitted.current = false; }
    if (phase === 'finished') playSound('voteCast');
    prevPhase.current = phase;
  }, [phase, playSound]);

  // Auto-submit the current selection just before the deadline so it isn't lost
  useEffect(() => {
    if (secs == null || secs > 1 || autoSubmitted.current) return;
    if (phase === 'voting' && pickRef.current && !gameState?.hasVoted) {
      autoSubmitted.current = true;
      onAction({ type: 'castVote', suspectId: pickRef.current });
    }
    if (phase === 'spyGuess' && gameState?.iAmGuessing && locPickRef.current && !gameState?.spyGuessSubmitted) {
      autoSubmitted.current = true;
      onAction({ type: 'guessLocation', location: locPickRef.current });
    }
  }, [secs, phase]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Infiltrating…</p></div>;

  const {
    myId, players = [], isSpy, location, myRole, locationOptions = [],
    ready = [], myVote, hasVoted, votedCount, playerCount,
    iAmGuessing, spyGuessSubmitted, outcome,
    finishedAcks = [], iAcked = false,
  } = gameState;

  function ready_() { if (!iReady) { setIReady(true); onAction({ type: 'ready' }); playSound('click'); } }
  function confirmVote() { if (!pick || hasVoted) return; onAction({ type: 'castVote', suspectId: pick }); playSound('voteCast'); }
  function confirmGuess() { if (!locPick || spyGuessSubmitted) return; onAction({ type: 'guessLocation', location: locPick }); playSound('click'); }
  function ackFinished() { if (!iAcked) { onAction({ type: 'acknowledge' }); playSound('click'); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>SPYFALL</h1>
        {secs != null && phase !== 'finished' && <span className={styles.timer}>{secs}s</span>}
      </div>

      {/* ---------- REVEAL: private role card ---------- */}
      {phase === 'reveal' && (
        <div className={styles.revealWrap}>
          <div className={`${styles.card} ${isSpy ? styles.cardSpy : ''}`}>
            {isSpy ? (
              <>
                <div className={styles.cardKicker}>Your secret</div>
                <div className={styles.spyTitle}>YOU ARE THE SPY</div>
                <p className={styles.cardHint}>You don’t know the location. Blend in, listen, and figure out where everyone is.</p>
              </>
            ) : (
              <>
                <div className={styles.cardKicker}>Location</div>
                <div className={styles.locName}>{location}</div>
                <div className={styles.cardKicker}>Your role</div>
                <div className={styles.roleName}>{myRole}</div>
                <p className={styles.cardHint}>Ask and answer questions to expose the spy — without giving the location away.</p>
              </>
            )}
          </div>
          {!iReady
            ? <button className={styles.primaryBtn} onClick={ready_}>I’m ready</button>
            : <p className={styles.sub}>Waiting for everyone to be ready…</p>}
          <AckStatus players={players} acknowledged={ready} me={myId} iActed={iReady} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {/* ---------- VOTING: discussion + secret vote ---------- */}
      {phase === 'voting' && (
        <div className={styles.voteWrap}>
          <p className={styles.prompt}>Discuss, then secretly vote for who you think is the spy.</p>
          {hasVoted ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>Vote locked in ✅</p>
              <p className={styles.sub}>Votes in… {votedCount}/{playerCount}</p>
            </div>
          ) : (
            <>
              <div className={styles.grid}>
                {players.filter((p) => p !== myId).map((p) => (
                  <button
                    key={p}
                    className={`${styles.suspect} ${pick === p ? styles.suspectSel : ''}`}
                    onClick={() => setPick(p)}
                  >
                    <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} size={28} />
                  </button>
                ))}
              </div>
              <button className={styles.primaryBtn} onClick={confirmVote} disabled={!pick}>Accuse the spy</button>
            </>
          )}
        </div>
      )}

      {/* ---------- SPY GUESS ---------- */}
      {phase === 'spyGuess' && (
        iAmGuessing ? (
          <div className={styles.guessWrap}>
            <p className={styles.prompt}>You’re the spy — guess the location to steal the win!</p>
            {spyGuessSubmitted ? (
              <p className={styles.sub}>Guess locked in… revealing soon.</p>
            ) : (
              <>
                <div className={styles.locGrid}>
                  {locationOptions.map((loc) => (
                    <button
                      key={loc}
                      className={`${styles.locOption} ${locPick === loc ? styles.locSel : ''}`}
                      onClick={() => setLocPick(loc)}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
                <button className={styles.primaryBtn} onClick={confirmGuess} disabled={!locPick}>Lock in guess</button>
              </>
            )}
          </div>
        ) : (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>The spy is making their final guess…</p>
            <p className={styles.sub}>Hold tight.</p>
          </div>
        )
      )}

      {/* ---------- FINISHED: full reveal ---------- */}
      {phase === 'finished' && outcome && (
        <div className={styles.finishWrap}>
          <div className={`${styles.banner} ${outcome.spyWins ? styles.bannerSpy : styles.bannerGroup}`}>
            {outcome.spyWins ? 'THE SPY WINS' : 'THE GROUP WINS'}
          </div>

          <div className={styles.summary}>
            <div className={styles.sumRow}><span>Location</span><strong>{outcome.location}</strong></div>
            <div className={styles.sumRow}>
              <span>The spy was</span>
              <strong><PlayerName playerId={outcome.spyId} nicknames={nicknames} avatars={avatars} size={24} /></strong>
            </div>
            <div className={styles.sumRow}>
              <span>Accused</span>
              <strong>
                {outcome.accusedId
                  ? <PlayerName playerId={outcome.accusedId} nicknames={nicknames} avatars={avatars} size={24} />
                  : 'No one (tie / no votes)'}
                {outcome.spyCaught ? ' — caught! ✅' : ' — got away 🕵️'}
              </strong>
            </div>
            <div className={styles.sumRow}>
              <span>Spy’s guess</span>
              <strong>{outcome.spyGuess || 'no guess'}{outcome.spyGuessedRight ? ' — correct! 🎯' : ''}</strong>
            </div>
          </div>

          <div className={styles.scoreboard}>
            {Object.entries(outcome.scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <span className={styles.scoreWho}>
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  {pid === outcome.spyId && <span className={styles.spyTag}> SPY</span>}
                </span>
                <span className={styles.scoreVal}>{sc}</span>
              </div>
            ))}
          </div>

          {!iAcked
            ? <button className={styles.primaryBtn} onClick={ackFinished}>Continue →</button>
            : <p className={styles.sub}>Waiting for everyone…</p>}
          <AckStatus players={players} acknowledged={finishedAcks} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </div>
      )}
    </div>
  );
}
