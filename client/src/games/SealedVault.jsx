import { useEffect, useRef, useState } from 'react';
import styles from './SealedVault.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function SealedVaultGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [amount, setAmount] = useState(0);
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const hasBid = gameState?.hasBid;
  const myBankroll = gameState?.myBankroll ?? 0;
  const deadline = gameState?.deadline ?? null;

  // reset per-phase local UI
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'bidding') { setAmount(0); }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // keep the bid slider clamped to the current bankroll
  useEffect(() => {
    setAmount((a) => Math.max(0, Math.min(a, myBankroll)));
  }, [myBankroll]);

  // live countdown to the server deadline
  useEffect(() => {
    if (phase !== 'bidding' || !deadline) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, deadline]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Polishing the vault…</p></div>;
  }

  const {
    roundNumber, totalRounds, lotName, lotValueRange = { min: 20, max: 80 },
    myBid, iAmActive, players = [], bidCount, activeCount, reveal, acknowledged = [], myId,
  } = gameState;

  const allPlayers = players.map((p) => p.playerId);

  function submitBid() {
    if (hasBid || !iAmActive) return;
    const bid = Math.max(0, Math.min(Math.floor(amount), myBankroll));
    onAction({ type: 'bid', amount: bid });
    playSound('coin');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>SEALED VAULT</h1>
        <span className={styles.round}>Lot {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && (
        <div className={styles.lotCard}>
          <span className={styles.lotIcon}>🔒</span>
          <div className={styles.lotMeta}>
            <span className={styles.lotName}>{lotName}</span>
            <span className={styles.lotHint}>
              Hidden value {lotValueRange.min}–{lotValueRange.max}
            </span>
          </div>
          {phase === 'bidding' && remaining != null && (
            <span className={`${styles.timer} ${remaining <= 5 ? styles.timerHot : ''}`}>{remaining}s</span>
          )}
        </div>
      )}

      {/* BIDDING */}
      {phase === 'bidding' && (
        hasBid || !iAmActive ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>
              {iAmActive ? `Bid sealed: ${myBid} 🤫` : 'Spectating this lot'}
            </p>
            <p className={styles.sub}>Bids in… {bidCount}/{activeCount}</p>
          </div>
        ) : (
          <div className={styles.bidBox}>
            <p className={styles.bankLine}>
              Your bankroll: <strong>{myBankroll}</strong>
            </p>
            <div className={styles.bidValue}>{Math.floor(amount)}</div>
            <input
              className={styles.slider}
              type="range"
              min={0}
              max={myBankroll}
              step={1}
              value={Math.min(amount, myBankroll)}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Bid amount"
            />
            <input
              className={styles.numInput}
              type="number"
              min={0}
              max={myBankroll}
              value={Math.floor(amount)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setAmount(Number.isFinite(v) ? Math.max(0, Math.min(v, myBankroll)) : 0);
              }}
              aria-label="Bid amount (typed)"
            />
            <button className={styles.primaryBtn} onClick={submitBid}>
              Seal bid · {Math.floor(amount)}
            </button>
            <p className={styles.sub}>Highest bidder wins the lot. Pay what you bid. Bid 0 to pass.</p>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.valueReveal}>
            <span className={styles.valueLabel}>{reveal.lotName} was worth</span>
            <span className={styles.valueBig}>{reveal.lotValue}</span>
            {reveal.winnerId ? (
              <span className={styles.winLine}>
                Won by{' '}
                <PlayerName playerId={reveal.winnerId} nicknames={nicknames} avatars={avatars} />
                {' '}for {reveal.winningBid}
                {' '}
                <span className={reveal.lotValue - reveal.paid >= 0 ? styles.profit : styles.lossTag}>
                  ({reveal.lotValue - reveal.paid >= 0 ? '+' : ''}{reveal.lotValue - reveal.paid} net)
                </span>
              </span>
            ) : (
              <span className={styles.winLine}>No bids — lot unsold</span>
            )}
          </div>

          <div className={styles.bidList}>
            {reveal.bids.map((b) => (
              <div key={b.playerId} className={`${styles.bidRow} ${b.isWinner ? styles.bidWinner : ''}`}>
                <PlayerName playerId={b.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.bidAmt}>{b.amount}{b.isWinner && ' 🏆'}</span>
              </div>
            ))}
          </div>

          <div className={styles.scoreboard}>
            <div className={styles.scoreHead}>
              <span>Player</span><span>Loot</span><span>Bank</span>
            </div>
            {[...players].sort((a, b) => (b.wonValue - a.wonValue) || (b.bankroll - a.bankroll)).map((p) => (
              <div key={p.playerId} className={styles.scoreRow}>
                <PlayerName playerId={p.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.lootVal}>{p.wonValue}</span>
                <span className={styles.bankVal}>{p.bankroll}</span>
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
        <p className={styles.finishedNote}>Final vault tally above — richest hoard wins.</p>
      )}
    </div>
  );
}
