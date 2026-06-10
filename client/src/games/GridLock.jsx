import { useEffect, useRef, useState } from 'react';
import styles from './GridLock.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const N = 4;
const BLANK = 0;

function neighbors(idx) {
  const r = Math.floor(idx / N);
  const c = idx % N;
  const out = [];
  if (r > 0) out.push(idx - N);
  if (r < N - 1) out.push(idx + N);
  if (c > 0) out.push(idx - 1);
  if (c < N - 1) out.push(idx + 1);
  return out;
}

export default function GridLockGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [iAcked, setIAcked] = useState(false);
  const [now, setNow] = useState(Date.now());
  const prevPhase = useRef(null);
  const prevSolved = useRef(false);

  const phase = gameState?.phase;

  // ticking clock for the countdown
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  useEffect(() => {
    if (gameState?.mySolved && !prevSolved.current) playSound('winRound');
    prevSolved.current = !!gameState?.mySolved;
  }, [gameState?.mySolved, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Scrambling tiles…</p></div>;

  const {
    myId, myBoard = [], myBlankIndex, myMoves = 0, mySolved, myDone,
    myTilesCorrect = 0, totalTiles = 15, roundEndMs, opponents = [],
    results, acknowledged = [],
  } = gameState;

  const secondsLeft = roundEndMs ? Math.max(0, Math.ceil((roundEndMs - now) / 1000)) : null;
  const allPlayers = [myId, ...opponents.map((o) => o.playerId)];
  const slidable = new Set(myBlankIndex >= 0 ? neighbors(myBlankIndex).map((i) => myBoard[i]) : []);

  function tapTile(idx) {
    if (phase !== 'playing' || myDone) return;
    const tile = myBoard[idx];
    if (tile === BLANK) return;
    if (!slidable.has(tile)) return;
    onAction({ type: 'slide', tile });
    playSound('click');
  }

  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const showBoard = phase === 'playing' || phase === 'reveal';

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>GRID LOCK</h1>
        {phase === 'playing' && secondsLeft != null && (
          <span className={`${styles.timer} ${secondsLeft <= 15 ? styles.timerLow : ''}`}>{secondsLeft}s</span>
        )}
      </div>

      {phase === 'playing' && (
        <p className={styles.hint}>
          {mySolved ? 'Solved! Waiting for the others…' : 'Slide a tile next to the gap to put them in order 1–15.'}
        </p>
      )}

      {showBoard && (
        <>
          {mySolved && <div className={styles.solvedBanner}>✓ SOLVED in {myMoves} moves</div>}
          <div className={`${styles.board} ${mySolved ? styles.boardSolved : ''}`}>
            {myBoard.map((tile, idx) => {
              if (tile === BLANK) return <div key={idx} className={styles.blank} />;
              const canSlide = !mySolved && phase === 'playing' && slidable.has(tile);
              return (
                <button
                  key={idx}
                  className={`${styles.tile} ${canSlide ? styles.tileSlidable : ''} ${tile === idx + 1 ? styles.tilePlaced : ''}`}
                  onClick={() => tapTile(idx)}
                  disabled={!canSlide}
                >
                  {tile}
                </button>
              );
            })}
          </div>
          {phase === 'playing' && (
            <div className={styles.myStats}>
              <span>{myTilesCorrect}/{totalTiles} placed</span>
              <span>{myMoves} moves</span>
            </div>
          )}
        </>
      )}

      {/* opponents progress */}
      {phase === 'playing' && opponents.length > 0 && (
        <div className={styles.oppList}>
          {opponents.map((o) => (
            <div key={o.playerId} className={styles.oppRow}>
              <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
              <div className={styles.oppBar}>
                <div
                  className={styles.oppFill}
                  style={{ width: `${Math.round((o.tilesCorrect / totalTiles) * 100)}%` }}
                />
              </div>
              <span className={styles.oppTag}>{o.solved ? '✓ solved' : `${o.tilesCorrect}/${totalTiles}`}</span>
            </div>
          ))}
        </div>
      )}

      {/* reveal / standings */}
      {(phase === 'reveal' || phase === 'finished') && Array.isArray(results) && (
        <div className={styles.standings}>
          <h2 className={styles.standTitle}>Standings</h2>
          {results.map((r) => (
            <div key={r.playerId} className={`${styles.standRow} ${r.playerId === myId ? styles.standMe : ''}`}>
              <span className={styles.place}>{r.placement}</span>
              <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.standDesc}>{r.handDescription}</span>
            </div>
          ))}
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
