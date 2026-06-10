import { useEffect, useRef, useState } from 'react';
import styles from './NimHeist.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [selPile, setSelPile] = useState(null);
  const [count, setCount] = useState(1);
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const { piles = [], isMyTurn, over, totalTokens = 0, lastMove, result } = myMatch;

  // clear any pending selection when it's no longer my turn / the round ends
  useEffect(() => { if (!isMyTurn || over) { setSelPile(null); setCount(1); } }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.pile},${lastMove.count},${lastMove.playerId}` : null;
    if (key && key !== prevMoveKey.current) playSound('cardDeal');
    prevMoveKey.current = key;
  }, [lastMove, playSound]);

  useEffect(() => {
    if (result && result !== prevResult.current) {
      if (result === 'win') { playSound('winRound'); shake('medium'); }
      else if (result === 'loss') { playSound('loseRound'); }
    }
    prevResult.current = result;
  }, [result, playSound, shake]);

  function selectPile(i) {
    if (!isMyTurn || over || piles[i] <= 0) return;
    setSelPile(i);
    setCount(1);
    playSound('click');
  }
  function bump(delta) {
    if (selPile == null) return;
    const max = piles[selPile];
    setCount((c) => Math.max(1, Math.min(max, c + delta)));
    playSound('click');
  }
  function confirm() {
    if (selPile == null) return;
    onAction({ type: 'move', move: { pile: selPile, count } });
    setSelPile(null);
    setCount(1);
  }

  const willEmptyBoard = selPile != null && (totalTokens - count) === 0;

  return (
    <div className={styles.boardWrap}>
      <p className={styles.rule}>
        Take any number of gems from <b>one</b> stack. Whoever grabs the <b>last gem loses!</b>
      </p>

      <div className={styles.piles}>
        {piles.map((n, i) => {
          const dead = n <= 0;
          const selected = selPile === i;
          return (
            <button
              key={i}
              type="button"
              className={`${styles.pileRow} ${selected ? styles.pileSel : ''} ${dead ? styles.pileDead : ''}`}
              disabled={!isMyTurn || over || dead}
              onClick={() => selectPile(i)}
              aria-label={`stack ${i + 1}, ${n} gems`}
            >
              <span className={styles.pileLabel}>Stack {i + 1}</span>
              <span className={styles.gems}>
                {n === 0
                  ? <span className={styles.emptyTag}>empty</span>
                  : Array.from({ length: n }, (_, g) => {
                      const taken = selected && g >= n - count;
                      return <span key={g} className={`${styles.gem} ${taken ? styles.gemTaken : ''}`} />;
                    })}
              </span>
              <span className={styles.pileCount}>{n}</span>
            </button>
          );
        })}
      </div>

      {isMyTurn && !over && (
        <div className={styles.controls}>
          {selPile == null ? (
            <p className={styles.hint}>Tap a stack to raid it.</p>
          ) : (
            <>
              <div className={styles.counter}>
                <button type="button" className={styles.stepBtn} onClick={() => bump(-1)} disabled={count <= 1} aria-label="take fewer">−</button>
                <span className={styles.countNum}>Take {count}</span>
                <button type="button" className={styles.stepBtn} onClick={() => bump(1)} disabled={count >= piles[selPile]} aria-label="take more">+</button>
              </div>
              <button type="button" className={`${styles.confirmBtn} ${willEmptyBoard ? styles.danger : ''}`} onClick={confirm}>
                {willEmptyBoard ? 'Take the LAST gem 💀' : `Raid Stack ${selPile + 1}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function NimHeistGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Wallpoet', sans-serif">
      {(myMatch) => <Board myMatch={myMatch} onAction={onAction} />}
    </PairingShell>
  );
}
