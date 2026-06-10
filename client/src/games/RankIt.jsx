import { useEffect, useRef, useState } from 'react';
import styles from './RankIt.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function RankItGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [order, setOrder] = useState([]);     // local working order of items
  const [selected, setSelected] = useState(null); // index tapped for swap
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const locked = gameState?.locked;
  const items = gameState?.items;

  // (re)seed the local order whenever a new ranking round's items arrive
  useEffect(() => {
    if (phase !== 'ranking' || !Array.isArray(items)) return;
    setOrder((prev) => {
      const same = prev.length === items.length && prev.every((x) => items.includes(x));
      return same ? prev : [...items];
    });
  }, [phase, items]);

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'ranking') { setSelected(null); }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to the server deadline
  const deadline = gameState?.deadline;
  useEffect(() => {
    if (phase !== 'ranking' || !deadline) { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, deadline]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Lining things up…</p></div>;

  const {
    roundNumber, totalRounds, category, scores = {}, myId,
    submittedCount, playerCount, reveal, acknowledged = [],
  } = gameState;
  const allPlayers = Object.keys(scores);

  function move(i, dir) {
    if (locked) return;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setSelected(null);
    playSound('click');
  }
  function tap(i) {
    if (locked) return;
    if (selected === null) { setSelected(i); return; }
    if (selected === i) { setSelected(null); return; }
    const next = [...order];
    [next[i], next[selected]] = [next[selected], next[i]]; // swap the two tapped rows
    setOrder(next);
    setSelected(null);
    playSound('click');
  }
  function submit() {
    if (locked || !order.length) return;
    onAction({ type: 'submitOrder', order });
    playSound('voteCast');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>RANK IT</h1>
        <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && <p className={styles.category}>{category}</p>}

      {/* RANKING */}
      {phase === 'ranking' && (
        locked ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Order locked in ✅</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.rankBox}>
            <p className={styles.hint}>Tap two rows to swap, or use the arrows. Best at top.</p>
            <ol className={styles.list}>
              {order.map((item, i) => (
                <li
                  key={item}
                  className={`${styles.row} ${selected === i ? styles.rowSel : ''}`}
                  onClick={() => tap(i)}
                >
                  <span className={styles.rank}>{i + 1}</span>
                  <span className={styles.itemText}>{item}</span>
                  <span className={styles.arrows}>
                    <button
                      className={styles.arrowBtn}
                      disabled={i === 0}
                      onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                      aria-label="Move up"
                    >▲</button>
                    <button
                      className={styles.arrowBtn}
                      disabled={i === order.length - 1}
                      onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                      aria-label="Move down"
                    >▼</button>
                  </span>
                </li>
              ))}
            </ol>
            <button className={styles.primaryBtn} onClick={submit}>Lock in order</button>
            {remaining > 0 && <p className={styles.timer}>{remaining}s left</p>}
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.compareRow}>
            <div className={styles.col}>
              <p className={styles.colHead}>Correct order</p>
              <ol className={styles.list}>
                {reveal.correctOrder.map((item, i) => (
                  <li key={item} className={`${styles.row} ${styles.rowTruth}`}>
                    <span className={styles.rank}>{i + 1}</span>
                    <span className={styles.itemText}>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
            {reveal.awards[myId] && (
              <div className={styles.col}>
                <p className={styles.colHead}>
                  Your order — {reveal.awards[myId].correctPairs}/{reveal.maxPairs} pairs
                  {' '}<span className={styles.gain}>(+{reveal.awards[myId].gained})</span>
                </p>
                <ol className={styles.list}>
                  {reveal.awards[myId].ordering.map((item, i) => {
                    const right = reveal.correctOrder[i] === item;
                    return (
                      <li key={item} className={`${styles.row} ${right ? styles.rowRight : styles.rowWrong}`}>
                        <span className={styles.rank}>{i + 1}</span>
                        <span className={styles.itemText}>{item}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>
                  {sc}{reveal.awards[pid]?.gained ? ` (+${reveal.awards[pid].gained})` : ''}
                </span>
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
    </div>
  );
}
