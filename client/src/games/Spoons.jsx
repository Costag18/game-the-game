import { useEffect, useRef, useState } from 'react';
import styles from './Spoons.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const RED = new Set(['♥', '♦']);

function Card({ card, faceDown, incoming, onClick, tappable }) {
  if (faceDown) {
    return <button type="button" className={`${styles.card} ${styles.cardBack} ${tappable ? styles.tappable : ''}`} onClick={onClick}>🂠</button>;
  }
  const red = RED.has(card.suit);
  return (
    <button
      type="button"
      className={`${styles.card} ${incoming ? styles.cardIncoming : ''} ${tappable ? styles.tappable : ''}`}
      style={{ color: red ? '#c62828' : '#1a1a1a' }}
      onClick={onClick}
    >
      <span className={styles.cardRank}>{card.rank}</span>
      <span className={styles.cardSuit}>{card.suit}</span>
    </button>
  );
}

export default function Spoons({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'grab') { shake('medium'); playSound('roundStart'); }
    if (phase === 'roundEnd') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, shake, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Shuffling…</p></div>;

  const {
    myId, myHand = [], myNextCard, canTake, isDealer, seats = [], roundNumber, totalRounds,
    spoonsRemaining, grabTriggeredBy, iHaveGrabbed, lastRoundSummary, acknowledged = [],
  } = gameState;

  const survivorIds = seats.map((s) => s.playerId);

  function passCard(i) {
    if (!canTake) return;
    onAction({ type: 'takeAndDiscard', cardIndex: i });
    playSound('cardDeal');
  }
  function grab() { if (!iHaveGrabbed) { onAction({ type: 'grab' }); playSound('coinFlip'); shake('heavy'); } }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  // prospective 5-card hand: the incoming card (or a face-down draw) tacked on at index 4
  const fifth = canTake ? (myNextCard || { faceDown: true }) : null;

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>SPOONS</h1>
      <p className={styles.sub}>Round {roundNumber} / {totalRounds}</p>

      {/* opponent ring */}
      <div className={styles.seats}>
        {seats.filter((s) => s.playerId !== myId).map((s) => (
          <div key={s.playerId} className={`${styles.seat} ${s.playerId === grabTriggeredBy ? styles.seatTrigger : ''}`}>
            <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.seatMeta}>
              🂠×{s.handCount}
              {phase === 'passing' && s.incomingCount > 0 && <span className={styles.inBadge}>+{s.incomingCount}</span>}
              {phase !== 'passing' && (s.hasGrabbed ? ' ✅' : ' …')}
            </span>
          </div>
        ))}
      </div>

      {phase === 'passing' && (
        <div className={styles.passArea}>
          <p className={styles.hint}>
            {canTake
              ? (myNextCard ? 'Tap a card to keep the rest and pass it on' : isDealer ? 'Draw is ready — tap a card to discard' : 'A card is coming…')
              : 'Waiting for a card to reach you…'}
          </p>
          <div className={styles.hand}>
            {myHand.map((c, i) => (
              <Card key={`h${i}`} card={c} tappable={canTake} onClick={() => passCard(i)} />
            ))}
            {fifth && (
              <Card
                card={fifth.faceDown ? null : fifth}
                faceDown={fifth.faceDown}
                incoming={!fifth.faceDown}
                tappable={canTake}
                onClick={() => passCard(myHand.length)}
              />
            )}
          </div>
        </div>
      )}

      {phase === 'grab' && (
        <div className={styles.grabArea}>
          <h2 className={styles.grabTitle}>🥄 GRAB!</h2>
          <p className={styles.spoonCount}>{spoonsRemaining} spoon{spoonsRemaining !== 1 ? 's' : ''} left</p>
          <button className={styles.grabBtn} onClick={grab} disabled={iHaveGrabbed}>
            {iHaveGrabbed ? 'Got one! 🥄' : 'TAP TO GRAB'}
          </button>
          {grabTriggeredBy && (
            <p className={styles.triggerNote}>
              <PlayerName playerId={grabTriggeredBy} nicknames={nicknames} avatars={avatars} /> went for it!
            </p>
          )}
        </div>
      )}

      {(phase === 'roundEnd' || phase === 'finished') && lastRoundSummary && (
        <div className={styles.endArea}>
          <p className={styles.elimLine}>
            <PlayerName playerId={lastRoundSummary.eliminated} nicknames={nicknames} avatars={avatars} /> is out! 🥄
          </p>
          <p className={styles.elimMeta}>Four of a kind: {lastRoundSummary.fourOfAKindRank}</p>
          {phase === 'roundEnd' && (
            <>
              {!iAcked && <button className={styles.contBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={survivorIds} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
