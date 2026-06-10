import { useEffect, useRef, useState } from 'react';
import styles from './LastBidStanding.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function LastBidStandingGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [iAcked, setIAcked] = useState(false);
  const [secsLeft, setSecsLeft] = useState(0);
  const prevPhase = useRef(null);
  const pingedRef = useRef(false);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;
  const hasChosen = gameState?.hasChosen;

  // phase transitions
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'tick') { pingedRef.current = false; }
    if (phase === 'reveal') { setIAcked(false); playSound('coinFlip'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to the server deadline
  useEffect(() => {
    if (phase !== 'tick' || !deadline) { setSecsLeft(0); return; }
    const tick = () => {
      const ms = Math.max(0, deadline - Date.now());
      setSecsLeft(Math.ceil(ms / 1000));
      // local-timer fallback: if the window elapsed and the server hasn't moved on, nudge it
      if (ms <= 0 && !pingedRef.current) { pingedRef.current = true; onAction({ type: 'ping' }); }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, deadline, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Entering the auction house…</p></div>;

  const {
    jackpot, tickCost, tickNumber, myBankroll = 0, mySunk = 0, iAmIn, myChoice,
    players = [], inCount, lockedCount, reveal, winner, acknowledged = [], results,
  } = gameState;

  const canAfford = myBankroll >= tickCost;
  const allIds = players.map((p) => p.playerId);

  function raise() {
    if (!iAmIn || hasChosen || !canAfford) return;
    onAction({ type: 'raise' });
    playSound('chipBet');
  }
  function drop() {
    if (!iAmIn || hasChosen) return;
    onAction({ type: 'drop' });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const isFinal = phase === 'finished' || (phase === 'reveal' && inCount <= 1);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>LAST BID STANDING</h1>
      </div>

      {/* JACKPOT + tick info */}
      <div className={styles.banner}>
        <div className={styles.jackpot}>
          <span className={styles.jackLabel}>JACKPOT</span>
          <span className={styles.jackVal}>{jackpot} pts</span>
        </div>
        <div className={styles.tickInfo}>
          <span className={styles.tickCost}>Each RAISE costs <b>{tickCost}</b> — you pay even if you lose</span>
          {phase === 'tick' && <span className={styles.tickNo}>Tick {tickNumber} · {inCount} still in</span>}
        </div>
      </div>

      {/* MY WALLET */}
      <div className={styles.wallet}>
        <div className={styles.walletCell}>
          <span className={styles.wLabel}>Your bankroll</span>
          <span className={styles.wBig}>{myBankroll}</span>
        </div>
        <div className={styles.walletCell}>
          <span className={styles.wLabel}>You've sunk</span>
          <span className={styles.wSunk}>{mySunk}</span>
        </div>
      </div>

      {/* TICK — decision */}
      {phase === 'tick' && (
        iAmIn ? (
          hasChosen ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>
                {myChoice === 'raise' ? `RAISED — paid ${tickCost} 🪙` : 'DROPPED out'}
              </p>
              <p className={styles.sub}>Waiting on the table… {lockedCount}/{inCount} locked in</p>
            </div>
          ) : (
            <div className={styles.decision}>
              <div className={styles.countdown}>
                <span className={styles.cdNum}>{secsLeft}</span>
                <span className={styles.cdLabel}>seconds to choose</span>
              </div>
              <div className={styles.choices}>
                <button className={styles.raiseBtn} onClick={raise} disabled={!canAfford}>
                  RAISE<span className={styles.btnSub}>pay {tickCost}, stay in</span>
                </button>
                <button className={styles.dropBtn} onClick={drop}>
                  DROP<span className={styles.btnSub}>quit, keep your coins</span>
                </button>
              </div>
              {!canAfford && <p className={styles.broke}>You can't afford another raise — only DROP is left.</p>}
            </div>
          )
        ) : (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>You're out 💸</p>
            <p className={styles.sub}>Watching the last bidders fight it out…</p>
          </div>
        )
      )}

      {/* REVEAL of the tick just resolved */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          {!isFinal && (
            <p className={styles.revHead}>
              Tick {reveal.tickNumber}: {reveal.raisers.length} raised, {reveal.droppers.length} dropped
            </p>
          )}
          {isFinal && winner && (
            <p className={styles.winLine}>
              <PlayerName playerId={winner} nicknames={nicknames} avatars={avatars} /> takes the {jackpot}-point jackpot! 🏆
            </p>
          )}
          {isFinal && !winner && <p className={styles.winLine}>Everyone folded — no jackpot awarded.</p>}
        </div>
      )}

      {/* TABLE — public state, never opponents' pending choices */}
      <div className={styles.table}>
        {players.map((p) => (
          <div
            key={p.playerId}
            className={`${styles.seat} ${p.in ? styles.seatIn : styles.seatOut} ${p.isMe ? styles.seatMe : ''}`}
          >
            <div className={styles.seatTop}>
              <PlayerName playerId={p.playerId} nicknames={nicknames} avatars={avatars} />
              {phase === 'tick' && p.in && (
                <span className={p.locked ? styles.lockChip : styles.thinkChip}>
                  {p.locked ? 'locked' : 'choosing…'}
                </span>
              )}
              {!p.in && <span className={styles.outChip}>OUT</span>}
            </div>
            <div className={styles.seatStats}>
              <span className={styles.seatBank}>{p.bankroll} coins</span>
              <span className={styles.seatSunk}>sunk {p.sunk}</span>
            </div>
          </div>
        ))}
      </div>

      {/* FINAL scoreboard + ack */}
      {phase === 'finished' && results && (
        <div className={styles.scoreboard}>
          {results.map((r) => (
            <div key={r.playerId} className={`${styles.scoreRow} ${r.isWinner ? styles.scoreWin : ''}`}>
              <span className={styles.place}>#{r.placement}</span>
              <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.scoreVal}>{r.isWinner ? `+${jackpot} 🏆` : `sunk ${r.sunk}`}</span>
            </div>
          ))}
        </div>
      )}

      {isFinal && phase === 'reveal' && (
        <div className={styles.ackWrap}>
          {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
          <AckStatus players={allIds} acknowledged={acknowledged} me={gameState.myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </div>
      )}
    </div>
  );
}
