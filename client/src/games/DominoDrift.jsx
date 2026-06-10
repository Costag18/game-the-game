import { useEffect, useRef, useState } from 'react';
import styles from './DominoDrift.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';

function Tile({ tile, onClick, selected, dim }) {
  return (
    <button type="button" className={`${styles.tile} ${selected ? styles.tileSel : ''} ${dim ? styles.tileDim : ''}`} onClick={onClick}>
      <span className={styles.pip}>{tile[0]}</span><span className={styles.tileDiv} /><span className={styles.pip}>{tile[1]}</span>
    </button>
  );
}

export default function DominoDrift({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [sel, setSel] = useState(null);
  const turn = gameState?.currentTurnPlayer;
  const prev = useRef(null);
  useEffect(() => { if (turn !== prev.current) { setSel(null); prev.current = turn; } }, [turn]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Shuffling…</p></div>;
  const { phase, isMyTurn, currentTurnPlayer, myHand = [], playable = [], canDraw, canPass, leftEnd, rightEnd, boneyardCount, players = [], results } = gameState;

  function play(end) { if (sel == null) return; onAction({ type: 'play', tileIndex: sel, end }); playSound('cardDeal'); setSel(null); }
  function tapTile(i) {
    if (!isMyTurn) return;
    const pl = playable[i] || {};
    if (!pl.L && !pl.R) return;
    if (pl.L && pl.R) setSel(i === sel ? null : i);
    else { onAction({ type: 'play', tileIndex: i, end: pl.L ? 'L' : 'R' }); playSound('cardDeal'); setSel(null); }
  }

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>Domino Drift</h1>

      <div className={styles.train}>
        <span className={styles.end}>◀ {leftEnd}</span>
        <span className={styles.trainMid}>train · {boneyardCount} in boneyard</span>
        <span className={styles.end}>{rightEnd} ▶</span>
      </div>

      <div className={styles.opponents}>
        {players.filter((p) => p.playerId !== gameState.myId).map((p) => (
          <div key={p.playerId} className={`${styles.opp} ${p.isCurrent ? styles.oppTurn : ''}`}>
            <PlayerName playerId={p.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.oppCount}>🁢×{p.tileCount}</span>
          </div>
        ))}
      </div>

      {phase === 'playing' && (
        <>
          <p className={styles.turnLine}>{isMyTurn ? 'Your turn' : <>Waiting on <PlayerName playerId={currentTurnPlayer} nicknames={nicknames} avatars={avatars} />…</>}</p>
          <div className={styles.hand}>
            {myHand.map((t, i) => {
              const pl = playable[i] || {};
              return <Tile key={i} tile={t} selected={sel === i} dim={isMyTurn && !pl.L && !pl.R} onClick={() => tapTile(i)} />;
            })}
          </div>
          {sel != null && (
            <div className={styles.endChoice}>
              <button className={styles.endBtn} onClick={() => play('L')}>◀ Left ({leftEnd})</button>
              <button className={styles.endBtn} onClick={() => play('R')}>Right ({rightEnd}) ▶</button>
            </div>
          )}
          {isMyTurn && (
            <div className={styles.actions}>
              {canDraw && <button className={styles.actBtn} onClick={() => { onAction({ type: 'draw' }); playSound('click'); }}>Draw</button>}
              {canPass && <button className={styles.actBtn} onClick={() => onAction({ type: 'pass' })}>Pass</button>}
            </div>
          )}
        </>
      )}

      {phase === 'finished' && results && (
        <div className={styles.results}>
          {results.map((r) => (
            <div key={r.playerId} className={styles.resRow}>
              <span className={styles.rPlace}>{r.placement}</span>
              <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.pips}>{r.pips} pips left</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
