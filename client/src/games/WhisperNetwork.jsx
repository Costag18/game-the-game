import { useEffect, useRef, useState } from 'react';
import styles from './WhisperNetwork.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const PUSH_OPTIONS = [-2, -1, 0, 1, 2];

function useCountdown(deadline) {
  const [secs, setSecs] = useState(null);
  useEffect(() => {
    if (!deadline) { setSecs(null); return; }
    const tick = () => setSecs(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);
  return secs;
}

export default function WhisperNetworkGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [iReady, setIReady] = useState(false);
  const [pick, setPick] = useState(null);            // chosen push this round
  const [guessMap, setGuessMap] = useState({});      // accusation: otherId -> 'RED'|'BLUE'
  const prevPhase = useRef(null);
  const prevRound = useRef(null);

  const phase = gameState?.phase;
  const roundNumber = gameState?.roundNumber;
  const secs = useCountdown(gameState?.deadline);

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'reveal') { setIReady(false); playSound?.('voteCast'); }
      if (phase === 'round') setPick(null);
      if (phase === 'accusation') setGuessMap({});
      if (phase === 'finished') playSound?.('roundWin');
      prevPhase.current = phase;
    }
    // new round -> reset the push picker
    if (phase === 'round' && roundNumber !== prevRound.current) {
      setPick(null);
      prevRound.current = roundNumber;
    }
  }, [phase, roundNumber, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Tuning the network…</p></div>;

  const {
    myId, myFaction, players = [], scores = {}, totalRounds,
    meter = 0, ready = [], hasPushed, myPush, pushedCount, playerCount,
    hasGuessed, guessedCount, reveal,
  } = gameState;

  const others = players.filter((p) => p !== myId);
  const factionLabel = myFaction === 'RED' ? 'RED' : myFaction === 'BLUE' ? 'BLUE' : '—';
  const goal = myFaction === 'RED' ? 'Drive the meter ABOVE zero' : myFaction === 'BLUE' ? 'Drive the meter BELOW zero' : '';

  // meter gauge: clamp display to a sensible range for the needle
  const METER_MAX = 16;
  const clamped = Math.max(-METER_MAX, Math.min(METER_MAX, meter));
  const needlePct = 50 + (clamped / METER_MAX) * 50; // 0..100

  function ready_() {
    if (iReady) return;
    setIReady(true);
    onAction({ type: 'ready' });
    playSound?.('click');
  }
  function submitPush() {
    if (pick === null || hasPushed) return;
    onAction({ type: 'submitPush', push: pick });
    playSound?.('voteCast');
  }
  function setGuess(otherId, faction) {
    setGuessMap((m) => ({ ...m, [otherId]: faction }));
    playSound?.('click');
  }
  function submitGuesses() {
    if (hasGuessed) return;
    onAction({ type: 'submitGuesses', guesses: guessMap });
    playSound?.('voteCast');
  }

  const allGuessed = others.every((o) => guessMap[o]);
  const allPlayers = players;

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>WHISPER NETWORK</h1>
        {phase === 'round' && <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>}
      </div>

      {/* shared meter gauge — visible whenever play is underway */}
      {(phase === 'round' || phase === 'accusation' || phase === 'finished') && (
        <div className={styles.meterWrap}>
          <div className={styles.meterLabels}>
            <span className={styles.blueLabel}>◀ BLUE</span>
            <span className={styles.meterValue}>{meter > 0 ? `+${meter}` : meter}</span>
            <span className={styles.redLabel}>RED ▶</span>
          </div>
          <div className={styles.meterTrack}>
            <div className={styles.meterCenter} />
            <div className={styles.meterNeedle} style={{ left: `${needlePct}%` }} />
          </div>
        </div>
      )}

      {/* REVEAL — private faction card */}
      {phase === 'reveal' && (
        <div className={styles.revealBox}>
          <p className={styles.secretHint}>Your secret faction — don’t reveal it!</p>
          <div className={`${styles.factionCard} ${myFaction === 'RED' ? styles.redCard : styles.blueCard}`}>
            <span className={styles.factionName}>{factionLabel}</span>
            <span className={styles.factionGoal}>{goal}</span>
          </div>
          {!iReady
            ? <button className={styles.primaryBtn} onClick={ready_}>I’m ready →</button>
            : <p className={styles.sub}>Waiting for others… {ready.length}/{playerCount}</p>}
          {secs != null && <p className={styles.timer}>{secs}s</p>}
          <AckStatus players={allPlayers} acknowledged={ready} me={myId} iActed={iReady} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {/* ROUND — secret push selector */}
      {phase === 'round' && (
        hasPushed ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Push locked: {myPush > 0 ? `+${myPush}` : myPush} 🤫</p>
            <p className={styles.sub}>Waiting for others… {pushedCount}/{playerCount}</p>
            {secs != null && <p className={styles.timer}>{secs}s</p>}
          </div>
        ) : (
          <div className={styles.pushBox}>
            <p className={styles.pushPrompt}>Secretly nudge the meter:</p>
            <div className={styles.pushRow}>
              {PUSH_OPTIONS.map((v) => (
                <button
                  key={v}
                  className={`${styles.pushBtn} ${pick === v ? styles.pushSel : ''} ${v < 0 ? styles.pushBlue : v > 0 ? styles.pushRed : styles.pushZero}`}
                  onClick={() => { setPick(v); playSound?.('click'); }}
                >
                  {v > 0 ? `+${v}` : v}
                </button>
              ))}
            </div>
            <p className={styles.pushKey}>negative ◀ BLUE · RED ▶ positive</p>
            <button className={styles.primaryBtn} onClick={submitPush} disabled={pick === null}>Lock in push</button>
            {secs != null && <p className={styles.timer}>{secs}s</p>}
          </div>
        )
      )}

      {/* ACCUSATION — tag every other player */}
      {phase === 'accusation' && (
        hasGuessed ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Accusations submitted ✅</p>
            <p className={styles.sub}>Waiting for others… {guessedCount}/{playerCount}</p>
            {secs != null && <p className={styles.timer}>{secs}s</p>}
          </div>
        ) : (
          <div className={styles.accuseBox}>
            <p className={styles.pushPrompt}>Who’s who? Tag each player’s faction:</p>
            {others.map((o) => (
              <div key={o} className={styles.accuseRow}>
                <PlayerName playerId={o} nicknames={nicknames} avatars={avatars} />
                <div className={styles.tagBtns}>
                  <button
                    className={`${styles.tagBtn} ${styles.tagRed} ${guessMap[o] === 'RED' ? styles.tagSel : ''}`}
                    onClick={() => setGuess(o, 'RED')}
                  >RED</button>
                  <button
                    className={`${styles.tagBtn} ${styles.tagBlue} ${guessMap[o] === 'BLUE' ? styles.tagSel : ''}`}
                    onClick={() => setGuess(o, 'BLUE')}
                  >BLUE</button>
                </div>
              </div>
            ))}
            <button className={styles.primaryBtn} onClick={submitGuesses} disabled={!allGuessed}>
              {allGuessed ? 'Submit accusations' : `Tag all ${others.length} players`}
            </button>
            {secs != null && <p className={styles.timer}>{secs}s</p>}
          </div>
        )
      )}

      {/* FINISHED — full reveal */}
      {phase === 'finished' && reveal && (
        <div className={styles.resultBox}>
          <p className={styles.outcome}>
            {reveal.winningFaction
              ? <>Meter ended {meter > 0 ? `+${meter}` : meter} — <span className={reveal.winningFaction === 'RED' ? styles.redText : styles.blueText}>{reveal.winningFaction} wins!</span></>
              : <>Meter ended at 0 — a perfect stalemate, no faction wins.</>}
          </p>
          <div className={styles.factionGrid}>
            {[...players].sort((a, b) => (scores[b] || 0) - (scores[a] || 0)).map((pid) => {
              const f = reveal.factions[pid];
              const a = reveal.awards?.[pid] || {};
              return (
                <div key={pid} className={`${styles.resultRow} ${f === 'RED' ? styles.redRow : styles.blueRow}`}>
                  <span className={styles.resultWho}>
                    <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                    <span className={styles.factionTag}>{f}</span>
                  </span>
                  <span className={styles.resultScore}>
                    {scores[pid] || 0}
                    <span className={styles.breakdown}>
                      {a.factionPts ? ` · faction +${a.factionPts}` : ''}
                      {a.detectivePts ? ` · ${a.correctGuesses} right +${a.detectivePts}` : ''}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
