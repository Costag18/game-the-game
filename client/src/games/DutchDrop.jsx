import { useEffect, useRef, useState } from 'react';
import styles from './DutchDrop.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function DutchDropGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [iAcked, setIAcked] = useState(false);
  const [secs, setSecs] = useState(0);
  const prevPhase = useRef(null);
  const prevPrice = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;
  const currentPrice = gameState?.currentPrice;

  // reset per-phase local UI state
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'auction') playSound('cardFlip');
    if (phase === 'lotReveal') { setIAcked(false); playSound('coin'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // tick down a local countdown to the server deadline (purely cosmetic)
  useEffect(() => {
    if (phase !== 'auction' || !deadline) { setSecs(0); return; }
    let raf;
    const tick = () => {
      setSecs(Math.max(0, (deadline - Date.now()) / 1000));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [phase, deadline]);

  // little blip when the price drops
  useEffect(() => {
    if (phase === 'auction' && prevPrice.current != null && currentPrice != null && currentPrice < prevPrice.current) {
      playSound('click');
    }
    prevPrice.current = currentPrice;
  }, [currentPrice, phase, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Opening the auction house…</p></div>;

  const {
    lotNumber, totalLots, lotName, floorPrice, startPrice,
    myId, myBankroll = 0, myProfit = 0, canAfford,
    players = [], lastLot, acknowledged = [], history,
  } = gameState;

  const allPlayers = players.map((p) => p.playerId);

  function buy() {
    if (phase !== 'auction' || !canAfford) return;
    onAction({ type: 'buy' });
    playSound('coin');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  // price fill bar: how far the price has descended from start toward floor
  const span = Math.max(1, startPrice - floorPrice);
  const dropPct = phase === 'auction' && currentPrice != null
    ? Math.min(100, Math.max(0, ((startPrice - currentPrice) / span) * 100))
    : 0;

  const sortedPlayers = [...players].sort((a, b) => b.profit - a.profit);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>DUTCH DROP</h1>
        <span className={styles.round}>Lot {lotNumber} / {totalLots}</span>
      </div>

      <div className={styles.wallet}>
        <div className={styles.walletItem}>
          <span className={styles.walletLabel}>Bankroll</span>
          <span className={styles.walletBank}>{myBankroll}</span>
        </div>
        <div className={styles.walletItem}>
          <span className={styles.walletLabel}>Profit</span>
          <span className={`${styles.walletProfit} ${myProfit < 0 ? styles.neg : myProfit > 0 ? styles.pos : ''}`}>
            {myProfit > 0 ? '+' : ''}{myProfit}
          </span>
        </div>
      </div>

      {/* AUCTION */}
      {phase === 'auction' && (
        <div className={styles.lotCard}>
          <div className={styles.lotName}>{lotName}</div>
          <div className={styles.askLabel}>Asking price</div>
          <div className={styles.price}>{currentPrice}</div>
          <div className={styles.priceBar}>
            <div className={styles.priceFill} style={{ width: `${dropPct}%` }} />
          </div>
          <div className={styles.tickRow}>
            <span>next drop in {secs.toFixed(1)}s</span>
            <span>floor {floorPrice}</span>
          </div>
          <button
            className={styles.buyBtn}
            onClick={buy}
            disabled={!canAfford}
          >
            {canAfford ? `BUY for ${currentPrice}` : 'Not enough bankroll'}
          </button>
          <p className={styles.hint}>First to buy wins — but the longer you wait, the cheaper it gets… or someone else grabs it.</p>
        </div>
      )}

      {/* LOT REVEAL */}
      {phase === 'lotReveal' && lastLot && (
        <div className={styles.reveal}>
          <div className={styles.revealName}>{lastLot.name}</div>
          {lastLot.passed ? (
            <div className={styles.passed}>PASSED — no buyer</div>
          ) : (
            <div className={styles.soldTo}>
              SOLD to <PlayerName playerId={lastLot.winner} nicknames={nicknames} avatars={avatars} /> for {lastLot.price}
            </div>
          )}
          <div className={styles.valueRow}>
            <span className={styles.valueLabel}>True value</span>
            <span className={styles.valueNum}>{lastLot.value}</span>
          </div>
          {!lastLot.passed && (
            <div className={`${styles.profitTag} ${lastLot.profit < 0 ? styles.neg : lastLot.profit > 0 ? styles.pos : ''}`}>
              {lastLot.profit > 0 ? `Profit +${lastLot.profit}` : lastLot.profit < 0 ? `Loss ${lastLot.profit}` : 'Broke even'}
            </div>
          )}
          {!iAcked && <button className={styles.buyBtn} onClick={ack}>Next lot →</button>}
          <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {/* FINISHED */}
      {phase === 'finished' && (
        <div className={styles.reveal}>
          <h2 className={styles.finTitle}>Auction closed</h2>
          {history && (
            <div className={styles.history}>
              {history.map((h) => (
                <div key={h.lotIndex} className={styles.histRow}>
                  <span className={styles.histName}>{h.name}</span>
                  <span className={styles.histVal}>val {h.value}</span>
                  <span className={styles.histRes}>
                    {h.passed
                      ? 'passed'
                      : <>→ <PlayerName playerId={h.winner} nicknames={nicknames} avatars={avatars} /> @ {h.price} ({h.profit > 0 ? '+' : ''}{h.profit})</>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SCOREBOARD (always visible) */}
      <div className={styles.scoreboard}>
        <div className={styles.scoreHead}>Standings (profit)</div>
        {sortedPlayers.map((p) => (
          <div key={p.playerId} className={`${styles.scoreRow} ${p.playerId === myId ? styles.meRow : ''}`}>
            <PlayerName playerId={p.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreMeta}>
              <span className={styles.scoreBank}>💰{p.bankroll}</span>
              <span className={`${styles.scoreProfit} ${p.profit < 0 ? styles.neg : p.profit > 0 ? styles.pos : ''}`}>
                {p.profit > 0 ? '+' : ''}{p.profit}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
