import { useEffect, useRef, useState } from 'react';
import styles from './MobRule.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function MobRuleGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);
  const prevRound = useRef(null);

  const phase = gameState?.phase;
  const roundNumber = gameState?.roundNumber;
  const myPick = gameState?.myPick;
  const hasPicked = gameState?.hasPicked;

  useEffect(() => {
    if (phase === prevPhase.current && roundNumber === prevRound.current) return;
    if (phase === 'picking') setPick(null);
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
    prevRound.current = roundNumber;
  }, [phase, roundNumber, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Reading the room…</p></div>;

  const {
    totalRounds, promptText, sideA, sideB, isTwist, rewardLabel,
    scores = {}, myId, pickedCount, playerCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);

  function choose(side) {
    if (hasPicked) return;
    setPick(side);
    onAction({ type: 'pickSide', side });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const lockedSide = myPick || pick;

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>MOB RULE</h1>
        <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && (
        <div className={`${styles.banner} ${isTwist ? styles.bannerTwist : styles.bannerNormal}`}>
          {isTwist ? '🔀 ' : '👥 '}{rewardLabel}
        </div>
      )}

      {phase !== 'finished' && <p className={styles.prompt}>{promptText}</p>}

      {/* PICKING */}
      {phase === 'picking' && (
        hasPicked ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Locked in: <strong>{lockedSide === 'a' ? sideA : sideB}</strong> 🤫</p>
            <p className={styles.sub}>Waiting for others… {pickedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.sides}>
            <button
              className={`${styles.sideBtn} ${styles.sideA} ${pick === 'a' ? styles.sideSel : ''}`}
              onClick={() => choose('a')}
            >
              {sideA}
            </button>
            <span className={styles.vs}>VS</span>
            <button
              className={`${styles.sideBtn} ${styles.sideB} ${pick === 'b' ? styles.sideSel : ''}`}
              onClick={() => choose('b')}
            >
              {sideB}
            </button>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.split}>
            <div className={`${styles.splitSide} ${reveal.rewardedSide === 'a' ? styles.splitWin : ''}`}>
              <div className={styles.splitLabel}>{sideA}</div>
              <div className={styles.splitCount}>{reveal.countA}</div>
              <div className={styles.splitVoters}>
                {Object.entries(reveal.picks).filter(([, s]) => s === 'a').map(([pid]) => (
                  <span key={pid} className={styles.voterChip}>
                    <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  </span>
                ))}
              </div>
            </div>
            <div className={`${styles.splitSide} ${reveal.rewardedSide === 'b' ? styles.splitWin : ''}`}>
              <div className={styles.splitLabel}>{sideB}</div>
              <div className={styles.splitCount}>{reveal.countB}</div>
              <div className={styles.splitVoters}>
                {Object.entries(reveal.picks).filter(([, s]) => s === 'b').map(([pid]) => (
                  <span key={pid} className={styles.voterChip}>
                    <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  </span>
                ))}
              </div>
            </div>
          </div>

          <p className={styles.outcome}>
            {reveal.tie
              ? '🤝 Dead even — nobody scores!'
              : `${reveal.isTwist ? 'TWIST! The MINORITY' : 'The MAJORITY'} side wins +500`}
          </p>

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={`${styles.scoreRow} ${reveal.awards[pid]?.won ? styles.scoreWon : ''}`}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc}{reveal.awards[pid]?.gained ? ` (+${reveal.awards[pid].gained})` : ''}</span>
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

      {phase === 'finished' && (
        <p className={styles.waitMsg}>Final tally is in — tallying the mob…</p>
      )}
    </div>
  );
}
