import { useEffect, useRef, useState } from 'react';
import styles from './GoingOnce.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function GoingOnceGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const prevPhase = useRef(null);
  const prevPrice = useRef(0);
  const pingedFor = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline ?? null;
  const currentPrice = gameState?.currentPrice ?? 0;

  // Phase transitions: reset local ack + play a beat.
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'lotReveal') { setIAcked(false); playSound('coinWin'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // Bid bump feedback.
  useEffect(() => {
    if (phase === 'auction' && currentPrice > prevPrice.current) playSound('chipBet');
    prevPrice.current = currentPrice;
  }, [currentPrice, phase, playSound]);

  // Live countdown to the SERVER deadline (resets on every raise). Ping the
  // server once if our local clock passes the deadline but it hasn't resolved.
  useEffect(() => {
    if (phase !== 'auction' || deadline == null) { setRemaining(0); return; }
    pingedFor.current = null;
    const tick = () => {
      const ms = Math.max(0, deadline - Date.now());
      setRemaining(ms);
      if (ms <= 0 && pingedFor.current !== deadline) {
        pingedFor.current = deadline;
        onAction({ type: 'ping' });
      }
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [phase, deadline, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Warming up the gavel…</p></div>;

  const {
    lotNumber, totalLots, increment, lotValue, highBidder, iAmHighBidder, myBankroll,
    nextBid, canAfford, players = [], lastSummary, acknowledged = [], myId, results,
  } = gameState;

  const secs = (remaining / 1000).toFixed(1);
  const callText = remaining > 4000 ? 'Going once…' : remaining > 2000 ? 'Going twice…' : 'Last call!';
  const allPlayers = players.map((p) => p.playerId);

  function raise() {
    if (phase !== 'auction' || iAmHighBidder || !canAfford) return;
    onAction({ type: 'raise' });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>GOING ONCE</h1>
        <span className={styles.round}>Lot {lotNumber} / {totalLots}</span>
      </div>

      {phase !== 'finished' && (
        <div className={styles.lotCard}>
          <span className={styles.lotLabel}>This lot is worth</span>
          <span className={styles.lotValue}>{lotValue} pts</span>
        </div>
      )}

      {/* AUCTION */}
      {phase === 'auction' && (
        <>
          <div className={styles.priceBox}>
            <div className={styles.priceRow}>
              <span className={styles.priceLabel}>Current bid</span>
              <span className={styles.price}>{currentPrice}</span>
            </div>
            <div className={styles.bidderRow}>
              {highBidder ? (
                <>High bidder: <PlayerName playerId={highBidder} nicknames={nicknames} avatars={avatars} /></>
              ) : (
                <span className={styles.noBids}>No bids yet — open at {nextBid}</span>
              )}
            </div>
          </div>

          <div className={styles.timer}>
            <div className={styles.timerBar}>
              <div className={styles.timerFill} style={{ width: `${Math.min(100, (remaining / 6000) * 100)}%` }} />
            </div>
            <span className={styles.call}>{callText} <strong>{secs}s</strong></span>
          </div>

          <button
            className={styles.raiseBtn}
            onClick={raise}
            disabled={iAmHighBidder || !canAfford}
          >
            {iAmHighBidder
              ? "You're winning ✋"
              : canAfford
                ? `RAISE to ${nextBid} (+${increment})`
                : 'Out of budget'}
          </button>
          <p className={styles.bankHint}>Your bankroll: <strong>{myBankroll}</strong></p>
        </>
      )}

      {/* LOT REVEAL */}
      {phase === 'lotReveal' && lastSummary && (
        <div className={styles.reveal}>
          {lastSummary.winner ? (
            <p className={styles.soldMsg}>
              SOLD! <PlayerName playerId={lastSummary.winner} nicknames={nicknames} avatars={avatars} />
              {' '}won a {lastSummary.value}-pt lot for {lastSummary.paid}.
            </p>
          ) : (
            <p className={styles.soldMsg}>No bids — the {lastSummary.value}-pt lot goes unsold.</p>
          )}
          {!iAcked && <button className={styles.raiseBtn} onClick={ack}>Next lot →</button>}
          <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {/* FINISHED */}
      {phase === 'finished' && results && (
        <div className={styles.reveal}>
          <h2 className={styles.finTitle}>Final Gavel</h2>
          <div className={styles.scoreboard}>
            {results.map((r) => (
              <div key={r.playerId} className={`${styles.scoreRow} ${r.placement === 1 ? styles.winnerRow : ''}`}>
                <span className={styles.place}>#{r.placement}</span>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{r.wonValue} pts <span className={styles.cash}>· {r.bankroll} left</span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PUBLIC STANDINGS (always visible during play) */}
      {phase !== 'finished' && (
        <div className={styles.standings}>
          {players.map((p) => (
            <div key={p.playerId} className={`${styles.standRow} ${p.isHighBidder ? styles.standHigh : ''}`}>
              <PlayerName playerId={p.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.standStats}>
                <span className={styles.won}>{p.wonValue} pts</span>
                <span className={styles.bank}>💰 {p.bankroll}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
