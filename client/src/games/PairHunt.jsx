import { useEffect, useRef, useState } from 'react';
import styles from './PairHunt.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const SHAPES = { circle: 'circle', square: 'square', triangle: 'triangle' };
const COLORS = { r: '#e8534b', g: '#3fae6b', b: '#4c7df0' };

// Render one SET card as a stack of `count` glyphs with the right shape/colour/fill.
function CardFace({ card }) {
  const color = COLORS[card.color] || '#ccc';
  const glyphs = [];
  for (let i = 0; i < card.count; i++) {
    glyphs.push(<Glyph key={i} shape={card.shape} color={color} fill={card.fill} />);
  }
  return <div className={styles.cardFace}>{glyphs}</div>;
}

function Glyph({ shape, color, fill }) {
  // fill: solid (filled), striped (semi), empty (outline only)
  const fillColor = fill === 'solid' ? color : fill === 'striped' ? `${color}55` : 'transparent';
  const stroke = color;
  const sw = 3;
  if (shape === 'circle') {
    return (
      <svg viewBox="0 0 40 40" className={styles.glyph} aria-hidden>
        <circle cx="20" cy="20" r="15" fill={fillColor} stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }
  if (shape === 'square') {
    return (
      <svg viewBox="0 0 40 40" className={styles.glyph} aria-hidden>
        <rect x="6" y="6" width="28" height="28" rx="4" fill={fillColor} stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" className={styles.glyph} aria-hidden>
      <polygon points="20,5 35,34 5,34" fill={fillColor} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
    </svg>
  );
}

export default function PairHuntGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [selected, setSelected] = useState([]);
  const [iAcked, setIAcked] = useState(false);
  const [flash, setFlash] = useState(null); // 'ok' | 'bad' | null
  const [remaining, setRemaining] = useState(0);
  const prevPhase = useRef(null);
  const prevClaimAt = useRef(0);
  const prevCount = useRef(0);

  const phase = gameState?.phase;
  const tableau = gameState?.tableau || [];
  const lastClaim = gameState?.lastClaim || null;
  const myLockUntilMs = gameState?.myLockUntilMs || null;
  const roundEndMs = gameState?.roundEndMs || null;

  // phase transitions: reset local UI
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'playing') { setSelected([]); setIAcked(false); }
    if (phase === 'reveal') { setIAcked(false); playSound('roundWin'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // flash on a fresh claim result coming back from the server
  useEffect(() => {
    if (!lastClaim || lastClaim.at === prevClaimAt.current) return;
    prevClaimAt.current = lastClaim.at;
    setFlash(lastClaim.ok ? 'ok' : 'bad');
    setSelected([]);
    playSound(lastClaim.ok ? 'coin' : 'lose');
    const id = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(id);
  }, [lastClaim, playSound]);

  // drop selections that fell off the board after a refill
  useEffect(() => {
    setSelected((sel) => sel.filter((id) => tableau.some((c) => c.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.deckRemaining, tableau.length]);

  // countdown ticker (drives a ping if the server hasn't advanced)
  useEffect(() => {
    if (phase !== 'playing' || !roundEndMs) { setRemaining(0); return; }
    const tick = () => {
      const ms = Math.max(0, roundEndMs - Date.now());
      setRemaining(Math.ceil(ms / 1000));
      if (ms <= 0) onAction({ type: 'ping' });
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, roundEndMs, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Shuffling the deck…</p></div>;

  const {
    myId, myCount = 0, deckRemaining = 0, scoreboard = [], acknowledged = [], results,
  } = gameState;

  const locked = myLockUntilMs && myLockUntilMs > Date.now();
  const allPlayers = scoreboard.map((s) => s.playerId);

  function toggle(id) {
    if (phase !== 'playing' || locked) return;
    setSelected((sel) => {
      if (sel.includes(id)) return sel.filter((x) => x !== id);
      if (sel.length >= 3) return sel; // cap at 3
      const next = [...sel, id];
      playSound('click');
      if (next.length === 3) {
        onAction({ type: 'claim', cardIds: next });
      }
      return next;
    });
  }

  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={`${styles.arena} ${flash === 'ok' ? styles.flashOk : ''} ${flash === 'bad' ? styles.flashBad : ''}`}>
      <div className={styles.head}>
        <h1 className={styles.title}>PAIR HUNT</h1>
        {phase === 'playing' && (
          <div className={styles.meta}>
            <span className={styles.timer}>{remaining}s</span>
            <span className={styles.deck}>Deck {deckRemaining}</span>
            <span className={styles.mine}>You: {myCount}</span>
          </div>
        )}
      </div>

      {phase === 'playing' && (
        <>
          <p className={styles.hint}>
            Tap 3 cards that form a <b>SET</b>: every attribute all-same or all-different.
          </p>
          {locked && <p className={styles.locked}>Bad claim — locked out briefly…</p>}
          <div className={styles.grid}>
            {tableau.map((c) => (
              <button
                key={c.id}
                className={`${styles.card} ${selected.includes(c.id) ? styles.cardSel : ''}`}
                onClick={() => toggle(c.id)}
                disabled={locked}
                aria-pressed={selected.includes(c.id)}
              >
                <CardFace card={c} />
              </button>
            ))}
          </div>
          <Scoreboard scoreboard={scoreboard} myId={myId} nicknames={nicknames} avatars={avatars} />
        </>
      )}

      {(phase === 'reveal' || phase === 'finished') && (
        <div className={styles.reveal}>
          <h2 className={styles.over}>Hunt over!</h2>
          <div className={styles.finalBoard}>
            {(results || scoreboard).map((r, i) => (
              <div key={r.playerId} className={`${styles.finalRow} ${r.playerId === myId ? styles.finalMine : ''}`}>
                <span className={styles.place}>{r.placement ? `#${r.placement}` : `#${i + 1}`}</span>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.finalCount}>
                  {(r.count ?? 0)} SET{(r.count ?? 0) === 1 ? '' : 's'}
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

function Scoreboard({ scoreboard, myId, nicknames, avatars }) {
  return (
    <div className={styles.scoreboard}>
      {scoreboard.map((s) => (
        <div key={s.playerId} className={`${styles.scoreRow} ${s.playerId === myId ? styles.scoreMine : ''}`}>
          <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
          <span className={styles.scoreVal}>{s.count}</span>
        </div>
      ))}
    </div>
  );
}
