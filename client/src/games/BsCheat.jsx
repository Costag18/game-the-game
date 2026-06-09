import { useEffect, useRef, useState } from 'react';
import styles from './BsCheat.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const RANK_NAME = { 1: 'Aces', 11: 'Jacks', 12: 'Queens', 13: 'Kings' };
const rankName = (r) => RANK_NAME[r] || `${r}s`;
const RANK_SHORT = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const rankShort = (r) => RANK_SHORT[r] || String(r);
const SUIT = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const isRed = (s) => s === 'hearts' || s === 'diamonds';

function Card({ card, selected, onClick }) {
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSel : ''} ${isRed(card.suit) ? styles.red : ''}`}
      onClick={onClick}
    >
      <span className={styles.cardRank}>{rankShort(card.rank)}</span>
      <span className={styles.cardSuit}>{SUIT[card.suit]}</span>
    </button>
  );
}

export default function BsCheat({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [selected, setSelected] = useState([]);
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const isMyTurn = gameState?.isMyTurn;
  const revealResult = gameState?.revealResult;

  useEffect(() => {
    if (!(phase === 'playing' && isMyTurn)) setSelected([]);
  }, [phase, isMyTurn]);

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'reveal') { shake('medium'); setIAcked(false); }
      prevPhase.current = phase;
    }
  }, [phase, shake]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Dealing…</p></div>;

  const {
    myHand = [], requiredRank, pileCount = 0, currentTurnPlayer,
    pendingPlay, canCallBS, finished, finishOrder = [], otherPlayers = [],
    myId, acknowledged = [],
  } = gameState;

  // Players who still need to acknowledge the reveal = present, non-finished players.
  const ackPlayers = [
    ...(finished ? [] : [myId]),
    ...otherPlayers.filter((o) => !o.finished).map((o) => o.playerId),
  ].filter(Boolean);

  function toggle(i) {
    setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : (s.length < 4 ? [...s, i] : s)));
    playSound('click');
  }
  function play() {
    if (selected.length < 1 || selected.length > 4) return;
    onAction({ type: 'place', cards: selected });
    playSound('cardDeal');
    setSelected([]);
  }
  function callBS() { onAction({ type: 'callBS' }); shake('light'); }
  function ack() { if (iAcked) return; setIAcked(true); onAction({ type: 'acknowledge' }); }

  return (
    <div className={styles.arena}>
      <div className={styles.header}>
        <h1 className={styles.title}>BS (Cheat)</h1>
        <span className={styles.pile}>🂠 Pile: {pileCount}</span>
      </div>

      <div className={styles.opponents}>
        {otherPlayers.map((o) => (
          <div
            key={o.playerId}
            className={`${styles.oppChip} ${o.playerId === currentTurnPlayer ? styles.oppTurn : ''} ${o.finished ? styles.oppDone : ''}`}
          >
            <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.oppCount}>{o.finished ? '✓ out' : `${o.handCount}🂠`}</span>
          </div>
        ))}
      </div>

      <div className={styles.center}>
        {phase === 'playing' && (
          <p className={styles.banner}>
            {isMyTurn
              ? <>Your turn — claim <strong>{rankName(requiredRank)}</strong></>
              : <><PlayerName playerId={currentTurnPlayer} nicknames={nicknames} avatars={avatars} /> is claiming <strong>{rankName(requiredRank)}</strong></>}
          </p>
        )}

        {phase === 'challengeWindow' && pendingPlay && (
          <div className={styles.challengeBox}>
            <p className={styles.announce}>
              <PlayerName playerId={pendingPlay.playerId} nicknames={nicknames} avatars={avatars} /> played{' '}
              <strong>{pendingPlay.claimedCount}</strong> as <strong>{rankName(pendingPlay.claimedRank)}</strong>
            </p>
            {canCallBS
              ? <button className={styles.bsBtn} onClick={callBS}>CALL BS! 🚨</button>
              : <p className={styles.subtle}>Waiting…</p>}
          </div>
        )}

        {phase === 'reveal' && revealResult && (
          <div className={styles.revealBox}>
            <div className={styles.revealCards}>
              {revealResult.revealedCards.map((c, i) => <Card key={i} card={c} />)}
            </div>
            <p className={`${styles.verdict} ${revealResult.liar ? styles.bad : styles.good}`}>
              {revealResult.liar
                ? <><PlayerName playerId={revealResult.playerId} nicknames={nicknames} avatars={avatars} /> LIED — takes {revealResult.pileSize} cards!</>
                : <>Clean! <PlayerName playerId={revealResult.challenger} nicknames={nicknames} avatars={avatars} /> was wrong — takes {revealResult.pileSize}</>}
            </p>
            {!iAcked && <button className={styles.playBtn} onClick={ack}>Got it →</button>}
            <AckStatus players={ackPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
          </div>
        )}

        {phase === 'finished' && (
          <div className={styles.finishedBox}>
            <h2 className={styles.gameOver}>Game over</h2>
            <ol className={styles.ranks}>
              {finishOrder.map((pid) => (
                <li key={pid}><PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} /> — escaped</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {finished ? (
        <p className={styles.escaped}>🎉 You escaped!</p>
      ) : phase !== 'finished' && (
        <>
          <div className={styles.hand}>
            {myHand.map((c, i) => (
              <Card
                key={i}
                card={c}
                selected={selected.includes(i)}
                onClick={() => phase === 'playing' && isMyTurn && toggle(i)}
              />
            ))}
          </div>
          {phase === 'playing' && isMyTurn && (
            <button className={styles.playBtn} disabled={selected.length < 1} onClick={play}>
              Play {selected.length || ''} as {rankName(requiredRank)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
