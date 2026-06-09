import { useEffect, useRef, useState } from 'react';
import styles from './President.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const RED_SUITS = new Set(['♥', '♦']);
const COUNT_LABEL = { 1: 'Singles', 2: 'Pairs', 3: 'Triples', 4: 'Bombs' };

function Card({ card, selected, onClick, faded }) {
  const red = RED_SUITS.has(card.suit);
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSel : ''} ${faded ? styles.cardFaded : ''}`}
      style={{ color: red ? '#c62828' : '#1a1a1a' }}
      onClick={onClick}
    >
      <span className={styles.cardLabel}>{card.label}</span>
      <span className={styles.cardSuit}>{card.suit}</span>
    </button>
  );
}

export default function President({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [selected, setSelected] = useState([]); // indexes into myHand
  const prevFinishCount = useRef(0);
  const prevMyFinished = useRef(false);

  const phase = gameState?.phase;
  const isMyTurn = gameState?.isMyTurn;
  const myHand = gameState?.myHand || [];
  const finishOrder = gameState?.finishOrder || [];
  const myFinished = gameState?.myFinished;

  // clear selection when it's no longer my turn or the hand changed
  useEffect(() => { setSelected([]); }, [isMyTurn, myHand.length]);

  useEffect(() => {
    if (finishOrder.length > prevFinishCount.current) playSound('coinCollect');
    prevFinishCount.current = finishOrder.length;
  }, [finishOrder.length, playSound]);

  useEffect(() => {
    if (myFinished && !prevMyFinished.current) { playSound('winRound'); shake('heavy'); }
    prevMyFinished.current = myFinished;
  }, [myFinished, playSound, shake]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Dealing…</p></div>;

  const { trickCount, trickTopRank, pile = [], players = [], canPass, canLeadOnly, currentTurnPlayer, myId } = gameState;
  const opponents = players.filter((p) => p.playerId !== myId);

  function toggle(i) {
    setSelected((sel) => {
      if (sel.includes(i)) return sel.filter((x) => x !== i);
      // same-rank grouping: drop any selected card of a different rank
      const rv = myHand[i].rankValue;
      const sameRank = sel.filter((x) => myHand[x].rankValue === rv);
      return [...sameRank, i];
    });
    playSound('click');
  }

  function play() {
    if (!selected.length || !isMyTurn) return;
    onAction({ type: 'play', cardIndexes: selected });
    playSound('cardDeal');
    setSelected([]);
  }
  function pass() {
    if (!canPass) return;
    onAction({ type: 'pass' });
    setSelected([]);
  }

  // client-side legality preview (server is the authority)
  const selRank = selected.length ? myHand[selected[0]].rankValue : 0;
  const sameRank = selected.every((i) => myHand[i].rankValue === selRank);
  const countOk = trickCount === 0 ? selected.length >= 1 && selected.length <= 4 : selected.length === trickCount;
  const rankOk = trickTopRank === 0 || selRank > trickTopRank;
  const canPlay = isMyTurn && selected.length > 0 && sameRank && countOk && rankOk;

  const topPlay = pile[pile.length - 1];

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>President</h1>

      <div className={styles.opponents}>
        {opponents.map((o) => (
          <div key={o.playerId} className={`${styles.oppChip} ${o.playerId === currentTurnPlayer ? styles.oppTurn : ''}`}>
            <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.oppCards}>{o.finished ? '🏁' : `🂠×${o.handCount}`}</span>
            {o.passed && !o.finished && <span className={styles.oppTag}>passed</span>}
            {o.isLeader && !o.finished && <span className={styles.oppLead}>★</span>}
          </div>
        ))}
      </div>

      <div className={styles.pile}>
        {phase === 'finished' ? (
          <p className={styles.bigMsg}>Round over</p>
        ) : trickCount === 0 ? (
          <p className={styles.pileMsg}>{isMyTurn ? 'Your lead — play any group' : 'Fresh trick'}</p>
        ) : (
          <>
            <p className={styles.pileMeta}>{COUNT_LABEL[trickCount] || `${trickCount}-of-a-kind`}</p>
            <div className={styles.pileCards}>
              {topPlay?.cards?.map((c, i) => <Card key={i} card={c} />)}
            </div>
          </>
        )}
      </div>

      {finishOrder.length > 0 && (
        <div className={styles.finishStrip}>
          {finishOrder.map((pid, i) => (
            <span key={pid} className={styles.finishBadge}>
              {i + 1}. <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
            </span>
          ))}
        </div>
      )}

      {!myFinished && phase === 'playing' && (
        <>
          <div className={styles.hand}>
            {myHand.map((c, i) => (
              <Card key={`${c.label}${c.suit}${i}`} card={c} selected={selected.includes(i)} onClick={() => toggle(i)} />
            ))}
          </div>
          <div className={styles.actions}>
            <button className={styles.playBtn} onClick={play} disabled={!canPlay}>
              Play{selected.length ? ` ${selected.length}` : ''}
            </button>
            <button className={styles.passBtn} onClick={pass} disabled={!canPass}>Pass</button>
          </div>
          {isMyTurn && canLeadOnly && <p className={styles.hint}>You lead — Pass is disabled on a fresh trick.</p>}
          {!isMyTurn && <p className={styles.hint}>Waiting for <PlayerName playerId={currentTurnPlayer} nicknames={nicknames} avatars={avatars} />…</p>}
        </>
      )}
      {myFinished && phase === 'playing' && <p className={styles.bigMsg}>You're out — waiting for the round to end…</p>}
    </div>
  );
}
