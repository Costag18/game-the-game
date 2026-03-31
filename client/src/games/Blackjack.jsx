import styles from './Blackjack.module.css';

const RANK_NAMES = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
};

const SUIT_SYMBOLS = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

function getRankName(rank) {
  return RANK_NAMES[rank] ?? String(rank);
}

function Card({ card, hidden = false }) {
  if (hidden) {
    return <div className={`${styles.card} ${styles.cardHidden}`}>?</div>;
  }
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <div className={`${styles.card} ${isRed ? styles.cardRed : styles.cardBlack}`}>
      <span className={styles.cardRank}>{getRankName(card.rank)}</span>
      <span className={styles.cardSuit}>{SUIT_SYMBOLS[card.suit]}</span>
    </div>
  );
}

function Hand({ cards, label, total, showHoleCard = true }) {
  return (
    <div className={styles.handSection}>
      <h3 className={styles.handLabel}>{label}</h3>
      <div className={styles.cardRow}>
        {cards.map((card, i) => (
          <Card key={i} card={card} hidden={!showHoleCard && i === 1} />
        ))}
      </div>
      {total !== null && total !== undefined && (
        <p className={styles.handTotal}>Total: {total}</p>
      )}
    </div>
  );
}

export default function Blackjack({ gameState, onAction }) {
  if (!gameState) {
    return <div className={styles.table}><p className={styles.waiting}>Waiting for game to start...</p></div>;
  }

  const {
    myHand,
    myTotal,
    dealerShowing,
    dealerTotal,
    otherPlayers,
    isMyTurn,
    busted,
    stood,
    phase,
  } = gameState;

  const isFinished = phase === 'finished';

  function getStatusText() {
    if (isFinished) return 'Game Over';
    if (phase === 'dealerTurn') return "Dealer's turn...";
    if (busted) return 'You busted!';
    if (stood) return 'You stood. Waiting for others...';
    if (isMyTurn) return 'Your turn';
    return 'Waiting for your turn...';
  }

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Blackjack</h1>

      {/* Dealer section */}
      <section className={styles.dealerSection}>
        <Hand
          cards={dealerShowing || []}
          label="Dealer"
          total={dealerTotal}
          showHoleCard={isFinished}
        />
        {!isFinished && (
          <div className={`${styles.card} ${styles.cardHidden}`}>?</div>
        )}
      </section>

      {/* Other players */}
      {otherPlayers && otherPlayers.length > 0 && (
        <section className={styles.othersSection}>
          <h3 className={styles.sectionHeading}>Other Players</h3>
          <div className={styles.otherPlayersList}>
            {otherPlayers.map((p) => (
              <div key={p.playerId} className={styles.otherPlayer}>
                <span className={styles.otherPlayerId}>{p.playerId}</span>
                <span className={styles.otherCardCount}>{p.cardCount} cards</span>
                {p.busted && <span className={styles.badgeBusted}>Busted</span>}
                {p.stood && !p.busted && <span className={styles.badgeStood}>Stood</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Player's own hand */}
      <section className={styles.playerSection}>
        <Hand cards={myHand || []} label="Your Hand" total={myTotal} showHoleCard />
        <p className={styles.statusText}>{getStatusText()}</p>

        {isMyTurn && !busted && !stood && (
          <div className={styles.actionButtons}>
            <button
              className={styles.btnHit}
              onClick={() => onAction({ type: 'hit' })}
            >
              Hit
            </button>
            <button
              className={styles.btnStand}
              onClick={() => onAction({ type: 'stand' })}
            >
              Stand
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
