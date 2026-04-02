import { useState, useEffect } from 'react';
import { EVENTS } from '../../../shared/events.js';
import styles from '../screens/GameVote.module.css';

const SLOT_ICONS = {
  cherry: '\uD83C\uDF52', lemon: '\uD83C\uDF4B', bar: '\uD83C\uDF7A',
  seven: '7\uFE0F\u20E3', diamond: '\uD83D\uDC8E', bell: '\uD83D\uDD14',
};

function CoinFlipPanel({ socket, myScore }) {
  const [wager, setWager] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [animClass, setAnimClass] = useState('');
  const maxWager = Math.floor((myScore || 0) * 0.5);

  useEffect(() => {
    if (!socket) return;
    function onResult(data) {
      setTimeout(() => { setResult(data); setAnimClass(data.result === 'heads' ? styles.coinLandHeads : styles.coinLandTails); setSpinning(false); }, 1500);
    }
    socket.on(EVENTS.COIN_FLIP_RESULT, onResult);
    return () => socket.off(EVENTS.COIN_FLIP_RESULT, onResult);
  }, [socket]);
  useEffect(() => { if (wager > maxWager) setWager(Math.max(1, maxWager)); }, [maxWager]);

  function handleFlip(choice) {
    if (spinning || maxWager <= 0) return;
    setSpinning(true); setResult(null); setAnimClass(styles.coinSpinning);
    socket.emit(EVENTS.COIN_FLIP, { amount: wager, choice });
  }
  const isBroke = maxWager <= 0;

  return (
    <div className={styles.coinPanel}>
      <h3 className={styles.coinTitle}>Coin Flip</h3>
      <p className={styles.coinSubtitle}>Gamble your points!</p>
      <div className={styles.coinScene}>
        <div className={`${styles.coin} ${animClass}`}>
          <div className={styles.coinFace + ' ' + styles.coinHeads}>H</div>
          <div className={styles.coinFace + ' ' + styles.coinTails}>T</div>
        </div>
      </div>
      {result && !spinning && (
        <p className={result.won ? styles.coinWin : styles.coinLose}>
          {result.won ? `+${result.amount}` : `-${result.amount}`} — {result.result}!
        </p>
      )}
      {!isBroke ? (
        <>
          <div className={styles.coinWagerRow}><span className={styles.coinWagerLabel}>Wager:</span><span className={styles.coinWagerAmount}>{wager}</span></div>
          <input type="range" min={1} max={maxWager} value={wager} onChange={(e) => setWager(Number(e.target.value))} className={styles.coinSlider} disabled={spinning} />
          <div className={styles.coinButtons}>
            <button className={styles.btnHeads} onClick={() => handleFlip('heads')} disabled={spinning}>Heads</button>
            <button className={styles.btnTails} onClick={() => handleFlip('tails')} disabled={spinning}>Tails</button>
          </div>
        </>
      ) : <p className={styles.coinBroke}>No points to gamble!</p>}
    </div>
  );
}

function SlotsPanel({ socket, myScore }) {
  const [wager, setWager] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [displayReels, setDisplayReels] = useState(['cherry', 'lemon', 'bar']);
  const maxWager = Math.floor((myScore || 0) * 0.5);

  useEffect(() => {
    if (!socket) return;
    function onResult(data) {
      setTimeout(() => setDisplayReels((prev) => [data.reels[0], prev[1], prev[2]]), 800);
      setTimeout(() => setDisplayReels((prev) => [prev[0], data.reels[1], prev[2]]), 1200);
      setTimeout(() => { setDisplayReels(data.reels); setResult(data); setSpinning(false); }, 1600);
    }
    socket.on(EVENTS.SLOTS_RESULT, onResult);
    return () => socket.off(EVENTS.SLOTS_RESULT, onResult);
  }, [socket]);
  useEffect(() => { if (wager > maxWager) setWager(Math.max(1, maxWager)); }, [maxWager]);

  function handleSpin() { if (spinning || maxWager <= 0) return; setSpinning(true); setResult(null); socket.emit(EVENTS.SLOTS_SPIN, { amount: wager }); }
  const isBroke = maxWager <= 0;

  return (
    <div className={styles.slotsPanel}>
      <h3 className={styles.slotsTitle}>Slots</h3>
      <div className={styles.slotsWindow}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${styles.slotReel} ${spinning ? styles.slotReelSpin : ''}`}>
            <span className={styles.slotSymbol}>{SLOT_ICONS[spinning ? ['cherry','lemon','bar','seven','diamond','bell'][Math.floor(Math.random()*6)] : displayReels[i]] || '?'}</span>
          </div>
        ))}
      </div>
      {result && !spinning && <p className={result.net >= 0 ? styles.slotsWin : styles.slotsLose}>{result.net >= 0 ? `+${result.net}` : result.net}{result.multiplier >= 3 ? ' JACKPOT!' : result.multiplier > 0 ? ' Winner!' : ''}</p>}
      {!isBroke ? (
        <>
          <div className={styles.coinWagerRow}><span className={styles.coinWagerLabel}>Bet:</span><span className={styles.coinWagerAmount}>{wager}</span></div>
          <input type="range" min={1} max={maxWager} value={wager} onChange={(e) => setWager(Number(e.target.value))} className={styles.coinSlider} disabled={spinning} />
          <button className={styles.btnSpin} onClick={handleSpin} disabled={spinning}>{spinning ? 'Spinning...' : 'SPIN'}</button>
          <p className={styles.slotsOdds}>3x match = 3x (7s = 5x) | Pair = 1.5x</p>
        </>
      ) : <p className={styles.coinBroke}>No points to gamble!</p>}
    </div>
  );
}

const WHEEL_SEGMENTS = [0, 0.5, 1, 0.5, 2, 0.5, 1, 0.5, 3, 0.5, 1, 0.5, 5, 0.5, 1, 0.5, 10, 0.5, 1, 0.5];
const WHEEL_COLORS = WHEEL_SEGMENTS.map((m) => m >= 10 ? '#e53935' : m >= 5 ? '#8e24aa' : m >= 3 ? '#1e88e5' : m >= 2 ? '#43a047' : m >= 1 ? '#d4a843' : '#555');

function WheelPanel({ socket, myScore }) {
  const [wager, setWager] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [rotation, setRotation] = useState(0);
  const maxWager = Math.floor((myScore || 0) * 0.5);
  const segAngle = 360 / WHEEL_SEGMENTS.length;

  useEffect(() => {
    if (!socket) return;
    function onResult(data) {
      const sa = 360 / data.totalSegments;
      const segCenter = data.segmentIndex * sa + sa / 2;
      const targetAngle = -(segCenter + 90);
      setRotation((prev) => { const base = Math.ceil(prev / 360) * 360; return base + 5 * 360 + targetAngle; });
      setTimeout(() => { setResult(data); setSpinning(false); }, 3000);
    }
    socket.on(EVENTS.WHEEL_RESULT, onResult);
    return () => socket.off(EVENTS.WHEEL_RESULT, onResult);
  }, [socket]);
  useEffect(() => { if (wager > maxWager) setWager(Math.max(1, maxWager)); }, [maxWager]);

  function handleSpin() { if (spinning || maxWager <= 0) return; setSpinning(true); setResult(null); socket.emit(EVENTS.WHEEL_SPIN, { amount: wager }); }
  const isBroke = maxWager <= 0;

  return (
    <div className={styles.miniGame}>
      <h3 className={styles.miniTitle}>Wheel of Fortune</h3>
      <div className={styles.wheelScene}>
        <div className={styles.wheelPointer}>&#9660;</div>
        <svg className={styles.wheelSvg} viewBox="0 0 200 200" style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)' : 'none' }}>
          {WHEEL_SEGMENTS.map((m, i) => {
            const s1 = (i * segAngle * Math.PI) / 180, e1 = ((i+1) * segAngle * Math.PI) / 180;
            return <path key={i} d={`M100,100 L${100+95*Math.cos(s1)},${100+95*Math.sin(s1)} A95,95 0 0,1 ${100+95*Math.cos(e1)},${100+95*Math.sin(e1)} Z`} fill={WHEEL_COLORS[i]} stroke="#222" strokeWidth="0.5" />;
          })}
          {WHEEL_SEGMENTS.map((m, i) => {
            const md = (i+0.5)*segAngle, mr = (md*Math.PI)/180, tx = 100+60*Math.cos(mr), ty = 100+60*Math.sin(mr);
            const ta = md > 90 && md < 270 ? md+180 : md;
            return <text key={`t${i}`} x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize="9" fontWeight="700" transform={`rotate(${ta}, ${tx}, ${ty})`}>{m}x</text>;
          })}
        </svg>
      </div>
      {result && !spinning && <p className={result.net >= 0 ? styles.slotsWin : styles.slotsLose}>{result.net >= 0 ? `+${result.net}` : result.net} ({result.multiplier}x)</p>}
      {!isBroke ? (
        <>
          <div className={styles.coinWagerRow}><span className={styles.coinWagerLabel}>Bet:</span><span className={styles.coinWagerAmount}>{wager}</span></div>
          <input type="range" min={1} max={maxWager} value={wager} onChange={(e) => setWager(Number(e.target.value))} className={styles.coinSlider} disabled={spinning} />
          <button className={styles.btnSpin} onClick={handleSpin} disabled={spinning}>{spinning ? 'Spinning...' : 'SPIN'}</button>
        </>
      ) : <p className={styles.coinBroke}>No points to gamble!</p>}
    </div>
  );
}

function BJLitePanel({ socket, myScore }) {
  const [wager, setWager] = useState(10);
  const [gameState, setGameState] = useState(null);
  const maxWager = Math.floor((myScore || 0) * 0.5);

  useEffect(() => { if (!socket) return; const h = (d) => setGameState(d); socket.on(EVENTS.BJ_LITE_RESULT, h); return () => socket.off(EVENTS.BJ_LITE_RESULT, h); }, [socket]);
  useEffect(() => { if (wager > maxWager) setWager(Math.max(1, maxWager)); }, [maxWager]);

  function handleDeal() { if (maxWager <= 0) return; socket.emit(EVENTS.BJ_LITE_START, { amount: wager }); }
  function handleAction(a) { socket.emit(EVENTS.BJ_LITE_ACTION, { action: a }); }
  const isBroke = maxWager <= 0, isPlaying = gameState?.phase === 'playing', isFinished = gameState?.phase === 'finished';

  return (
    <div className={styles.miniGame}>
      <h3 className={styles.miniTitle}>Blackjack</h3>
      {gameState ? (
        <div className={styles.bjArea}>
          <div className={styles.bjHand}><span className={styles.bjLabel}>Dealer</span><div className={styles.bjCards}>{isPlaying ? <><span className={styles.bjCard}>{gameState.dealerShowing}</span><span className={styles.bjCard+' '+styles.bjCardHidden}>?</span></> : gameState.dealerCards?.map((c,i) => <span key={i} className={styles.bjCard}>{c}</span>)}</div>{isFinished && <span className={styles.bjTotal}>{gameState.dealerTotal}</span>}</div>
          <div className={styles.bjHand}><span className={styles.bjLabel}>You</span><div className={styles.bjCards}>{gameState.playerCards?.map((c,i) => <span key={i} className={styles.bjCard}>{c}</span>)}</div><span className={styles.bjTotal}>{gameState.playerTotal}</span></div>
          {isPlaying && <div className={styles.bjActions}><button className={styles.btnHeads} onClick={() => handleAction('hit')}>Hit</button><button className={styles.btnTails} onClick={() => handleAction('stand')}>Stand</button></div>}
          {isFinished && <>
            <p className={gameState.net >= 0 ? styles.slotsWin : (gameState.net < 0 ? styles.slotsLose : styles.coinWagerLabel)}>{gameState.result === 'push' ? 'Push' : gameState.result === 'win' ? `+${gameState.net} Win!` : `${gameState.net} ${gameState.result === 'bust' ? 'Bust!' : 'Lose'}`}</p>
            {maxWager > 0 && <><div className={styles.coinWagerRow}><span className={styles.coinWagerLabel}>Bet:</span><span className={styles.coinWagerAmount}>{wager}</span></div><input type="range" min={1} max={maxWager} value={wager} onChange={(e) => setWager(Number(e.target.value))} className={styles.coinSlider} /></>}
            <button className={styles.btnSpin} onClick={handleDeal} disabled={maxWager<=0}>Deal Again</button>
          </>}
        </div>
      ) : !isBroke ? (
        <><div className={styles.coinWagerRow}><span className={styles.coinWagerLabel}>Bet:</span><span className={styles.coinWagerAmount}>{wager}</span></div><input type="range" min={1} max={maxWager} value={wager} onChange={(e) => setWager(Number(e.target.value))} className={styles.coinSlider} /><button className={styles.btnSpin} onClick={handleDeal}>DEAL</button></>
      ) : <p className={styles.coinBroke}>No points to gamble!</p>}
    </div>
  );
}

const CHICKEN_MULTS = [1.0, 1.2, 1.5, 1.8, 2.2, 2.8, 3.5, 4.5, 6.0];
const ROAD_LANES = 8;

function ChickenPanel({ socket, myScore }) {
  const [wager, setWager] = useState(10);
  const [gameState, setGameState] = useState(null);
  const maxWager = Math.floor((myScore || 0) * 0.5);

  useEffect(() => { if (!socket) return; const h = (d) => setGameState(d); socket.on(EVENTS.CHICKEN_RESULT, h); return () => socket.off(EVENTS.CHICKEN_RESULT, h); }, [socket]);
  useEffect(() => { if (wager > maxWager) setWager(Math.max(1, maxWager)); }, [maxWager]);

  const isBroke = maxWager <= 0, isPlaying = gameState?.phase === 'playing', isFinished = gameState?.phase === 'finished';
  const step = gameState?.step ?? 0;

  return (
    <div className={styles.miniGame}>
      <h3 className={styles.miniTitle}>Chicken Cross</h3>
      <div className={styles.chickenRoad}>
        {/* Lane 0: safe start zone */}
        <div className={[styles.chickenLane, styles.chickenLaneStart, step === 0 && isPlaying ? '' : styles.chickenLaneSafe].filter(Boolean).join(' ')}>
          <span className={styles.chickenLaneMult}>START</span>
          {isPlaying && step === 0 && <span className={styles.chickenHere}>🐔</span>}
        </div>
        {/* Lanes 1-8: risk zones */}
        {Array.from({ length: ROAD_LANES }, (_, i) => {
          const laneIdx = i + 1, crossed = step >= laneIdx;
          const crashed = isFinished && !gameState.alive && gameState.crashStep === laneIdx;
          const here = isPlaying && step === laneIdx;
          return (
            <div key={i} className={[styles.chickenLane, crossed && !crashed ? styles.chickenLaneSafe : '', crashed ? styles.chickenLaneCrash : ''].filter(Boolean).join(' ')}>
              <span className={styles.chickenLaneMult}>{CHICKEN_MULTS[laneIdx]}x</span>
              {crashed && <span className={styles.chickenSplat}>💥</span>}
              {here && <span className={styles.chickenHere}>🐔</span>}
              {crossed && !crashed && !here && <span className={styles.chickenCheck}>✓</span>}
            </div>
          );
        })}
        {isFinished && gameState.alive && step >= ROAD_LANES && <div className={styles.chickenFinish}>🏆</div>}
      </div>
      {isPlaying && (
        <div className={styles.chickenControls}>
          <p className={styles.chickenMultText}>{step === 0 ? 'Ready to cross!' : `${CHICKEN_MULTS[Math.min(step, CHICKEN_MULTS.length-1)]}x`}</p>
          <div className={styles.chickenButtons}>
            <button className={styles.btnChickenCross} onClick={() => socket.emit(EVENTS.CHICKEN_ACTION, { action: 'cross' })}>Cross 🐔</button>
            {step > 0 && <button className={styles.btnChickenCashout} onClick={() => socket.emit(EVENTS.CHICKEN_ACTION, { action: 'cashout' })}>Cash Out</button>}
          </div>
        </div>
      )}
      {isFinished && <>
        <p className={gameState.net >= 0 ? styles.slotsWin : styles.slotsLose}>{gameState.alive ? `+${gameState.net} (${gameState.multiplier}x)` : `${gameState.net} — Splat!`}</p>
        {maxWager > 0 && <><div className={styles.coinWagerRow}><span className={styles.coinWagerLabel}>Bet:</span><span className={styles.coinWagerAmount}>{wager}</span></div><input type="range" min={1} max={maxWager} value={wager} onChange={(e) => setWager(Number(e.target.value))} className={styles.coinSlider} /></>}
        <button className={styles.btnSpin} onClick={() => { if (maxWager > 0) socket.emit(EVENTS.CHICKEN_START, { amount: wager }); }} disabled={maxWager<=0}>Play Again</button>
      </>}
      {!gameState && (!isBroke ? (
        <><div className={styles.coinWagerRow}><span className={styles.coinWagerLabel}>Bet:</span><span className={styles.coinWagerAmount}>{wager}</span></div><input type="range" min={1} max={maxWager} value={wager} onChange={(e) => setWager(Number(e.target.value))} className={styles.coinSlider} /><button className={styles.btnSpin} onClick={() => socket.emit(EVENTS.CHICKEN_START, { amount: wager })}>START</button><p className={styles.slotsOdds}>Cross lanes for bigger multipliers. Cash out or get splat!</p></>
      ) : <p className={styles.coinBroke}>No points to gamble!</p>)}
    </div>
  );
}

export { CoinFlipPanel, SlotsPanel, WheelPanel, BJLitePanel, ChickenPanel };

export default function CasinoSidebar({ socket, myScore }) {
  return (
    <div className={styles.sidebarArea}>
      <CoinFlipPanel socket={socket} myScore={myScore} />
      <SlotsPanel socket={socket} myScore={myScore} />
      <WheelPanel socket={socket} myScore={myScore} />
      <BJLitePanel socket={socket} myScore={myScore} />
      <ChickenPanel socket={socket} myScore={myScore} />
    </div>
  );
}
