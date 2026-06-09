import { useEffect, useRef, useState } from 'react';
import styles from './Wavelength.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const clampPct = (n) => Math.max(0, Math.min(100, n));

export default function Wavelength({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const trackRef = useRef(null);
  const [marker, setMarker] = useState(50);
  const [clue, setClue] = useState('');
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'reveal') setIAcked(false);
      if (phase === 'guessing') setMarker(50);
      if (phase === 'clue') setClue('');
      prevPhase.current = phase;
    }
  }, [phase]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Tuning in…</p></div>;

  const {
    roundsPerGame, subRound, psychicId, amPsychic, spectrum = {}, clueText,
    targetCenter, targetWidth, myGuess, guesses, guessedIds = [],
    totalPoints = {}, lastReveal, acknowledged = [], myId,
  } = gameState;

  const reveal = phase === 'reveal' || phase === 'finished';
  const hasGuessed = myGuess != null;
  const allPlayers = Object.keys(totalPoints);
  const expectedGuessers = allPlayers.filter((p) => p !== psychicId);

  function setFromPointer(e) {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : rect.left);
    setMarker(clampPct(Math.round(((cx - rect.left) / rect.width) * 100)));
  }
  function onTrackDown(e) { if (phase === 'guessing' && !amPsychic && !hasGuessed) { setFromPointer(e); } }
  function onTrackMove(e) { if (e.buttons && phase === 'guessing' && !amPsychic && !hasGuessed) setFromPointer(e); }

  function submitClue() { const c = clue.trim(); if (!c) return; onAction({ type: 'submitClue', clue: c }); playSound('cardDeal'); }
  function lockGuess() { onAction({ type: 'guess', value: marker }); playSound('voteCast'); shake('light'); }
  function ack() { if (iAcked) return; setIAcked(true); onAction({ type: 'acknowledge' }); }

  const showBand = targetCenter != null && targetWidth != null;
  const seg = (lo, hi) => ({ left: `${clampPct(lo)}%`, width: `${clampPct(hi) - clampPct(lo)}%` });

  return (
    <div className={styles.arena}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wavelength</h1>
        <span className={styles.pill}>
          Sub-round {subRound}/{roundsPerGame} · Psychic:{' '}
          <PlayerName playerId={psychicId} nicknames={nicknames} avatars={avatars} />
        </span>
      </div>

      {clueText && <p className={styles.clue}>“{clueText}”</p>}

      {/* spectrum track */}
      <div className={styles.spectrumRow}>
        <span className={styles.spLabel}>{spectrum.left}</span>
        <div
          ref={trackRef}
          className={styles.track}
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
        >
          {/* hidden/revealed band */}
          {showBand && (
            <>
              <div className={`${styles.band} ${styles.bNear}`} style={seg(targetCenter - 3 * targetWidth, targetCenter + 3 * targetWidth)} />
              <div className={`${styles.band} ${styles.bClose}`} style={seg(targetCenter - 2 * targetWidth, targetCenter + 2 * targetWidth)} />
              <div className={`${styles.band} ${styles.bBull}`} style={seg(targetCenter - targetWidth, targetCenter + targetWidth)} />
            </>
          )}
          {/* my live marker while guessing */}
          {phase === 'guessing' && !amPsychic && (
            <div className={styles.marker} style={{ left: `${marker}%` }} />
          )}
          {/* revealed guess markers */}
          {reveal && guesses && Object.entries(guesses).map(([pid, val]) => (
            <div key={pid} className={styles.guessMarker} style={{ left: `${clampPct(val)}%` }} title={pid}>
              <span className={styles.guessDot} />
              <span className={styles.guessName}><PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} /></span>
            </div>
          ))}
        </div>
        <span className={styles.spLabel}>{spectrum.right}</span>
      </div>

      {/* phase-specific controls */}
      {phase === 'clue' && (
        amPsychic ? (
          <div className={styles.psychicClue}>
            <p className={styles.hint}>You see the target. Write a clue (no numbers!) pointing to it.</p>
            <div className={styles.clueRow}>
              <input
                className={styles.clueInput}
                value={clue}
                maxLength={40}
                placeholder="e.g. lukewarm bath…"
                onChange={(e) => setClue(e.target.value)}
              />
              <button className={styles.btn} disabled={!clue.trim()} onClick={submitClue}>Send clue</button>
            </div>
            <span className={styles.counter}>{clue.length}/40</span>
          </div>
        ) : (
          <p className={styles.hint}>🔮 The Psychic is thinking of a clue…</p>
        )
      )}

      {phase === 'guessing' && (
        amPsychic ? (
          <div className={styles.waitBox}>
            <p className={styles.hint}>Waiting for guesses…</p>
            <AckStatus players={expectedGuessers} acknowledged={guessedIds} nicknames={nicknames} avatars={avatars} />
          </div>
        ) : hasGuessed ? (
          <div className={styles.waitBox}>
            <p className={styles.hint}>Locked at <strong>{myGuess}</strong>.</p>
            <AckStatus players={expectedGuessers} acknowledged={guessedIds} me={myId} iActed={hasGuessed} nicknames={nicknames} avatars={avatars} />
          </div>
        ) : (
          <div className={styles.guessControls}>
            <div className={styles.readout}>{marker}</div>
            <button className={styles.btn} onClick={lockGuess}>Lock it in</button>
            <span className={styles.hint}>Drag the bar or tap to place your marker.</span>
          </div>
        )
      )}

      {reveal && lastReveal && (
        <div className={styles.revealBox}>
          <div className={styles.scoreList}>
            {Object.entries(lastReveal.guessPoints || {}).map(([pid, pts]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.pts}>+{pts}</span>
              </div>
            ))}
            <div className={styles.scoreRow}>
              <span className={styles.psyTag}>🔮 <PlayerName playerId={lastReveal.psychicId} nicknames={nicknames} avatars={avatars} /></span>
              <span className={styles.pts}>+{lastReveal.psychicPoints}</span>
            </div>
          </div>
          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.btn} onClick={ack}>Got it →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}

      {/* mini leaderboard */}
      <div className={styles.leaderboard}>
        {allPlayers
          .map((p) => ({ p, s: totalPoints[p] || 0 }))
          .sort((a, b) => b.s - a.s)
          .map(({ p, s }) => (
            <div key={p} className={styles.lbCard}>
              <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} />
              <span className={styles.lbScore}>{s}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
