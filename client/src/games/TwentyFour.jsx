import { useEffect, useRef, useState } from 'react';
import styles from './TwentyFour.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const REJECT_MSG = {
  bad: 'That’s not a valid expression — use only the numbers, + − × ÷ and ( ).',
  numbers: 'Use each of the four numbers exactly once.',
  value: 'That doesn’t equal 24 — keep trying!',
};

function Countdown({ deadline }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return <span className={styles.timer}>{left}s</span>;
}

export default function TwentyFourGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [expr, setExpr] = useState('');
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);
  const prevDeal = useRef(null);

  const phase = gameState?.phase;
  const dealNumber = gameState?.dealNumber;

  useEffect(() => {
    if (phase !== prevPhase.current || dealNumber !== prevDeal.current) {
      if (phase === 'deal') setExpr('');
      if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
      prevPhase.current = phase;
      prevDeal.current = dealNumber;
    }
  }, [phase, dealNumber, playSound]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Dealing the numbers…</p></div>;
  }

  const {
    totalDeals, target = 24, numbers = [], scores = {}, myId,
    mySolved, myExpr, myGained, myReject, solvedCount, playerCount,
    deadline, acknowledged = [], reveal,
  } = gameState;

  const allPlayers = Object.keys(scores);

  function append(tok) {
    setExpr((e) => e + tok);
    playSound('click');
  }
  function backspace() { setExpr((e) => e.slice(0, -1)); }
  function clearExpr() { setExpr(''); }
  function submit() {
    const t = expr.trim();
    if (!t || mySolved) return;
    onAction({ type: 'submit', expression: t });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>TWENTY&middot;FOUR</h1>
        <span className={styles.round}>Deal {dealNumber} / {totalDeals}</span>
        {(phase === 'deal' || phase === 'reveal') && <Countdown deadline={deadline} />}
      </div>

      {phase !== 'finished' && (
        <p className={styles.goal}>Make <strong>{target}</strong> using each number once</p>
      )}

      {/* the four number tiles (shown in deal + reveal) */}
      {(phase === 'deal' || phase === 'reveal') && (
        <div className={styles.tiles}>
          {(phase === 'reveal' && reveal ? reveal.numbers : numbers).map((n, i) => (
            <div key={i} className={styles.tile}>{n}</div>
          ))}
        </div>
      )}

      {/* DEAL */}
      {phase === 'deal' && (
        mySolved ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Solved it! {myExpr} = {target} ✅</p>
            <p className={styles.sub}>+{myGained} pts • waiting for others… {solvedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.builder}>
            <input
              className={styles.input}
              value={expr}
              maxLength={60}
              inputMode="text"
              placeholder="e.g. (3+3)*4*1"
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              autoFocus
            />
            <div className={styles.pad}>
              {numbers.map((n, i) => (
                <button key={i} className={styles.padNum} onClick={() => append(String(n))}>{n}</button>
              ))}
              <button className={styles.padOp} onClick={() => append('+')}>+</button>
              <button className={styles.padOp} onClick={() => append('-')}>−</button>
              <button className={styles.padOp} onClick={() => append('*')}>×</button>
              <button className={styles.padOp} onClick={() => append('/')}>÷</button>
              <button className={styles.padOp} onClick={() => append('(')}>(</button>
              <button className={styles.padOp} onClick={() => append(')')}>)</button>
              <button className={styles.padDel} onClick={backspace}>⌫</button>
              <button className={styles.padDel} onClick={clearExpr}>Clear</button>
            </div>
            <button className={styles.primaryBtn} onClick={submit} disabled={!expr.trim()}>Submit = {target}</button>
            {myReject && <p className={styles.reject}>{REJECT_MSG[myReject] || 'Not quite — try again.'}</p>}
            <p className={styles.sub}>Solved so far: {solvedCount}/{playerCount}</p>
          </div>
        )
      )}

      {/* REVEAL / FINISHED */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.solutionBox}>
            <span className={styles.solLabel}>One solution</span>
            <span className={styles.solExpr}>{reveal.solution} = {target}</span>
          </div>
          <div className={styles.solveList}>
            {reveal.solvedOrder.length === 0 ? (
              <p className={styles.nobody}>Nobody cracked this one!</p>
            ) : (
              reveal.solvedOrder.map((r) => (
                <div key={r.playerId} className={styles.solveRow}>
                  <span className={styles.solveRank}>#{r.rank + 1}</span>
                  <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.solveExpr}>{r.expr}</span>
                  <span className={styles.solveGain}>+{r.gained}</span>
                </div>
              ))
            )}
          </div>
          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc}</span>
              </div>
            ))}
          </div>
          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
          {phase === 'finished' && <p className={styles.finishMsg}>Final scores — nicely done!</p>}
        </div>
      )}
    </div>
  );
}
