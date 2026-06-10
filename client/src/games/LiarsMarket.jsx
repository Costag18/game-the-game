import { useEffect, useRef, useState } from 'react';
import styles from './LiarsMarket.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const prevResult = useRef(null);
  const prevRoundKey = useRef(null);

  const {
    round = 1, totalRounds = 6, step = 'announce',
    minPrice = 1, maxPrice = 20,
    isMyTurn, over, result,
    iAnnounce, iRespond, price,
    myValue, oppValue, myProfit = 0, oppProfit = 0,
  } = myMatch;

  const [bid, setBid] = useState(Math.min(maxPrice, Math.max(minPrice, myValue || minPrice)));

  // reset the slider to your value whenever a new announce step begins
  useEffect(() => {
    const key = `${round}-${step}`;
    if (key !== prevRoundKey.current) {
      if (step === 'announce' && iAnnounce) setBid(Math.min(maxPrice, Math.max(minPrice, myValue || minPrice)));
      prevRoundKey.current = key;
    }
  }, [round, step, iAnnounce, myValue, minPrice, maxPrice]);

  useEffect(() => {
    if (result && result !== prevResult.current) {
      if (result === 'win') { playSound('winRound'); shake('medium'); }
      else if (result === 'draw') { shake('light'); }
      else if (result === 'loss') { playSound('loseRound'); }
    }
    prevResult.current = result;
  }, [result, playSound, shake]);

  function announce() {
    if (!isMyTurn || over) return;
    playSound('coinCollect');
    onAction({ type: 'move', move: { type: 'announce', price: bid } });
  }
  function respond(buy) {
    if (!isMyTurn || over) return;
    playSound(buy ? 'coinCollect' : 'click');
    onAction({ type: 'move', move: { type: 'respond', buy } });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scoreRow}>
        <div className={styles.score}><span className={styles.scoreLabel}>You</span><span className={styles.scoreVal}>{myProfit >= 0 ? '+' : ''}{myProfit}</span></div>
        <div className={styles.roundPill}>Round {round} / {totalRounds}</div>
        <div className={styles.score}><span className={styles.scoreLabel}>Rival</span><span className={styles.scoreVal}>{oppProfit >= 0 ? '+' : ''}{oppProfit}</span></div>
      </div>

      <div className={styles.secret}>
        <span className={styles.secretLabel}>Your stock's true value</span>
        <span className={styles.secretVal}>{myValue}</span>
      </div>

      {over ? (
        <div className={styles.reveal}>
          <p className={styles.revealLine}>Rival's true value was <strong>{oppValue}</strong></p>
        </div>
      ) : iAnnounce && step === 'announce' ? (
        <div className={styles.panel}>
          <p className={styles.role}>You are the SELLER — name your price (you may bluff)</p>
          <div className={styles.bigPrice}>{bid}</div>
          <input
            className={styles.slider}
            type="range" min={minPrice} max={maxPrice} step={1}
            value={bid} disabled={!isMyTurn}
            onChange={(e) => setBid(Number(e.target.value))}
          />
          <div className={styles.sliderEnds}><span>{minPrice}</span><span>{maxPrice}</span></div>
          <button className={styles.bigBtn} disabled={!isMyTurn} onClick={announce}>Announce {bid}</button>
        </div>
      ) : iRespond && step === 'respond' ? (
        <div className={styles.panel}>
          <p className={styles.role}>The seller asks <span className={styles.askPrice}>{price}</span> per share</p>
          <p className={styles.hint}>Pay {price} and receive their true value — bluff or bargain?</p>
          <div className={styles.choiceRow}>
            <button className={`${styles.choiceBtn} ${styles.buy}`} disabled={!isMyTurn} onClick={() => respond(true)}>BUY ({price})</button>
            <button className={`${styles.choiceBtn} ${styles.pass}`} disabled={!isMyTurn} onClick={() => respond(false)}>PASS</button>
          </div>
        </div>
      ) : (
        <div className={styles.waiting}>
          {step === 'announce'
            ? 'Rival is naming their price…'
            : <>You asked <span className={styles.askPrice}>{price}</span> — rival is deciding…</>}
        </div>
      )}
    </div>
  );
}

export default function LiarsMarketGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Playfair Display', serif">
      {(myMatch) => <Board myMatch={myMatch} onAction={onAction} />}
    </PairingShell>
  );
}
