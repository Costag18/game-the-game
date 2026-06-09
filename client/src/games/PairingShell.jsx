import { useEffect, useRef, useState } from 'react';
import shell from './PairingShell.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

function Countdown({ endsAt }) {
  const [secs, setSecs] = useState(null);
  useEffect(() => {
    if (!endsAt) { setSecs(null); return; }
    const tick = () => setSecs(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  if (secs == null) return null;
  return <span className={shell.countdown}>{secs}s</span>;
}

/**
 * Shared chrome for any PairingEngine-backed 1v1 game (Connect 4, Ultimate TTT).
 * Renders the mini-round header, live standings, bye card, fast-finisher "waiting
 * on" barrier, and the mini-round summary. The board is supplied as a render-prop
 * child: children(myMatch) is called only when there's a live board to show.
 */
export default function PairingShell({ gameState, nicknames, avatars, onAction, children }) {
  const { playSound } = useSound();
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const { phase, title, miniRound, totalMiniRounds, myMatch, standings = [], waitingOn = [], myId, lastMiniRound, acknowledged = [] } = gameState;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'miniRoundSummary') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  const allPlayers = standings.map((s) => s.playerId);
  const waitingNames = waitingOn.filter((p) => p !== myId);

  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={shell.shell}>
      <div className={shell.header}>
        <h1 className={shell.title}>{title}</h1>
        <span className={shell.miniRound}>Mini-round {miniRound} / {totalMiniRounds}</span>
      </div>

      {/* live standings */}
      <div className={shell.standings}>
        {standings.map((s) => (
          <div key={s.playerId} className={`${shell.standRow} ${s.playerId === myId ? shell.standMe : ''}`}>
            <span className={shell.standRank}>{s.rank}</span>
            <span className={shell.standName}><PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} /></span>
            <span className={shell.standWins}>{s.displayWins} {s.displayWins === 1 ? 'win' : 'wins'}</span>
          </div>
        ))}
      </div>

      {phase === 'match' && myMatch && myMatch.isBye && (
        <div className={shell.byeCard}>
          <p className={shell.byeBig}>Bye this round 🎟️</p>
          <p className={shell.byeSub}>Free win — sit back while the others battle.</p>
        </div>
      )}

      {phase === 'match' && myMatch && !myMatch.isBye && (
        <div className={shell.matchArea}>
          <div className={shell.matchTop}>
            {myMatch.over ? (
              <span className={`${shell.banner} ${shell[`banner_${myMatch.result}`] || ''}`}>
                {myMatch.result === 'win' ? 'You won! 🎉' : myMatch.result === 'loss' ? 'You lost' : 'Draw'}
              </span>
            ) : (
              <span className={shell.turnInfo}>
                {myMatch.isMyTurn ? 'Your turn' : <>Waiting on <PlayerName playerId={myMatch.opponentId} nicknames={nicknames} avatars={avatars} /></>}
                {myMatch.isMyTurn && <Countdown endsAt={myMatch.turnEndsAt} />}
              </span>
            )}
          </div>

          {children(myMatch)}

          {myMatch.over && waitingNames.length > 0 && (
            <p className={shell.waitOn}>
              Waiting on {waitingNames.map((p, i) => (
                <span key={p}>{i > 0 && ', '}<PlayerName playerId={p} nicknames={nicknames} avatars={avatars} /></span>
              ))}…
            </p>
          )}
        </div>
      )}

      {phase === 'miniRoundSummary' && lastMiniRound && (
        <div className={shell.summary}>
          <h2 className={shell.summaryTitle}>Mini-round {miniRound} results</h2>
          {lastMiniRound.pairings.map((pr, i) => (
            <div key={i} className={shell.pairRow}>
              {pr.isBye ? (
                <span><PlayerName playerId={pr.p1} nicknames={nicknames} avatars={avatars} /> — bye 🎟️</span>
              ) : (
                <span>
                  <PlayerName playerId={pr.p1} nicknames={nicknames} avatars={avatars} /> vs <PlayerName playerId={pr.p2} nicknames={nicknames} avatars={avatars} />
                  {' → '}
                  {pr.draw ? 'Draw' : <><PlayerName playerId={pr.winnerId} nicknames={nicknames} avatars={avatars} /> wins</>}
                </span>
              )}
            </div>
          ))}
          {!iAcked && <button className={shell.contBtn} onClick={ack}>Continue →</button>}
          <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {phase === 'finished' && (
        <div className={shell.summary}>
          <h2 className={shell.summaryTitle}>Final standings</h2>
        </div>
      )}
    </div>
  );
}
