import { useEffect, useRef, useState } from 'react';
import styles from './Timeline.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

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

export default function TimelineGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [year, setYear] = useState(1900);
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const locked = gameState?.locked;
  const deadline = gameState?.deadline;
  const secs = useCountdown(deadline);

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'guessing') setYear(1900);
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Loading the timeline…</p></div>;

  const {
    qNumber, total, eventText, yearMin = 1400, yearMax = 2025,
    submittedCount, playerCount, scores = {}, results, trueYear, myGuess,
    acknowledged = [], myId,
  } = gameState;

  function lockYear() {
    if (locked) return;
    onAction({ type: 'submitYear', year });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const allPlayers = Object.keys(scores);
  const span = yearMax - yearMin;
  const pctFor = (y) => `${((Math.max(yearMin, Math.min(yearMax, y)) - yearMin) / span) * 100}%`;
  const fmtYear = (y) => (y == null ? '' : y < 0 ? `${-y} BC` : `${y}`);
  // typed entry: a magnitude + BC/AD era, kept in sync with the slider via the signed `year`
  const era = year < 0 ? 'BC' : 'AD';
  const mag = Math.abs(year);
  const maxMag = Math.max(Math.abs(yearMin), Math.abs(yearMax));
  function setFromInput(rawMag, rawEra) {
    const m = Math.max(0, Math.floor(Number(rawMag) || 0));
    const signed = rawEra === 'BC' ? -m : m;
    setYear(Math.max(yearMin, Math.min(yearMax, signed)));
  }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>TIMELINE</h1>
        <span className={styles.round}>Event {qNumber} / {total}</span>
      </div>

      {phase !== 'finished' && (
        <div className={styles.eventCard}>
          <span className={styles.eventLabel}>When did this happen?</span>
          <p className={styles.eventText}>{eventText}</p>
        </div>
      )}

      {secs != null && phase !== 'finished' && (
        <div className={styles.timer}>{secs}s</div>
      )}

      {/* GUESSING */}
      {phase === 'guessing' && (
        locked ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Year locked: <span className={styles.lockYear}>{fmtYear(myGuess)}</span></p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.guessBox}>
            <div className={styles.readout}>{fmtYear(year)}</div>
            <div className={styles.typeRow}>
              <span className={styles.typeLabel}>Type:</span>
              <input
                className={styles.yearInput}
                type="number"
                inputMode="numeric"
                value={mag}
                min={0}
                max={maxMag}
                step={1}
                onChange={(e) => setFromInput(e.target.value, era)}
                aria-label="Type a year"
              />
              <button
                type="button"
                className={`${styles.eraBtn} ${era === 'BC' ? styles.eraBc : styles.eraAd}`}
                onClick={() => setFromInput(mag, era === 'BC' ? 'AD' : 'BC')}
                aria-label="Toggle BC or AD"
              >{era}</button>
            </div>
            <input
              className={styles.slider}
              type="range"
              min={yearMin}
              max={yearMax}
              step={1}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
            <div className={styles.scaleRow}>
              <span>{fmtYear(yearMin)}</span>
              <span>{fmtYear(yearMax)}</span>
            </div>
            <button className={styles.primaryBtn} onClick={lockYear}>Lock in {fmtYear(year)}</button>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && results && (
        <div className={styles.reveal}>
          {trueYear != null && (
            <div className={styles.trueBanner}>
              Answer: <span className={styles.trueYear}>{fmtYear(trueYear)}</span>
            </div>
          )}

          <div className={styles.track}>
            <div className={styles.trackBar} />
            <div className={styles.trueMarker} style={{ left: pctFor(trueYear) }} title={fmtYear(trueYear)}>
              <span className={styles.trueFlag}>{fmtYear(trueYear)}</span>
            </div>
            {results.filter((r) => !r.missed).map((r) => (
              <div
                key={r.playerId}
                className={`${styles.guessMarker} ${r.playerId === myId ? styles.mineMarker : ''}`}
                style={{ left: pctFor(r.guess) }}
                title={fmtYear(r.guess)}
              />
            ))}
            <div className={styles.trackEnds}>
              <span>{fmtYear(yearMin)}</span>
              <span>{fmtYear(yearMax)}</span>
            </div>
          </div>

          <div className={styles.results}>
            {results.map((r) => (
              <div key={r.playerId} className={`${styles.resRow} ${r.playerId === myId ? styles.resMine : ''}`}>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.resGuess}>
                  {r.missed ? 'no guess' : `${fmtYear(r.guess)} (${r.distance === 0 ? 'exact!' : `${r.distance} yr off`})`}
                </span>
                <span className={styles.resPts}>+{r.points}</span>
              </div>
            ))}
          </div>

          <div className={styles.scoreboard}>
            <span className={styles.boardTitle}>Total Scores</span>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc}</span>
              </div>
            ))}
          </div>

          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
