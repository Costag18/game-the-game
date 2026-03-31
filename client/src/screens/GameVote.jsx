import { useState, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import { displayName } from '../utils/displayName.js';
import styles from './GameVote.module.css';
import voteImg from '../assets/images/votefornext.png';

export default function GameVote({ eligibleGames, tournamentState, nicknames, onVote }) {
  const { socket } = useSocketContext();
  const [voted, setVoted] = useState(false);
  const [voteCounts, setVoteCounts] = useState({});

  useEffect(() => {
    // Reset vote state when eligible games change (new round)
    setVoted(false);
    setVoteCounts({});
  }, [eligibleGames]);

  useEffect(() => {
    if (!socket) return;
    function onVoteUpdate(data) {
      setVoteCounts(data.votes ?? {});
    }
    socket.on(EVENTS.VOTE_UPDATE, onVoteUpdate);
    return () => socket.off(EVENTS.VOTE_UPDATE, onVoteUpdate);
  }, [socket]);

  function handleVote(gameId) {
    if (voted) return;
    setVoted(true);
    onVote(gameId);
  }

  const round = tournamentState?.currentRound ?? '?';
  const winCondition = tournamentState?.winCondition;
  const winTarget = tournamentState?.winTarget;
  const standings = tournamentState?.standings || [];

  const roundLabel = winCondition === 'fixedRounds'
    ? `Round ${round} of ${winTarget}`
    : `Round ${round}`;
  const targetLabel = winCondition === 'pointThreshold'
    ? `First to ${winTarget?.toLocaleString()} points`
    : null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <img src={voteImg} alt="Vote for the Next Game" className={styles.titleImage} />
        <p className={styles.subtitle}>{roundLabel}</p>
        {targetLabel && <p className={styles.subtitle}>{targetLabel}</p>}
      </div>

      {/* Player standings */}
      {standings.length > 0 && (
        <div className={styles.standings}>
          {standings.map((entry, i) => (
            <div key={entry.playerId} className={styles.standingRow}>
              <span className={styles.standingRank}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
              </span>
              <span className={styles.standingName}>{displayName(entry.playerId, nicknames)}</span>
              <span className={styles.standingScore}>{entry.score} pts</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.grid}>
        {eligibleGames.map((game) => {
          const count = voteCounts[game.id] ?? 0;
          return (
            <button
              key={game.id}
              className={`${styles.card} ${voted ? styles.cardDisabled : ''}`}
              onClick={() => handleVote(game.id)}
              disabled={voted}
            >
              <h3 className={styles.gameName}>{game.name}</h3>
              <p className={styles.gameDesc}>{game.description}</p>
              <div className={styles.cardFooter}>
                <span className={styles.playerRange}>
                  {game.minPlayers}–{game.maxPlayers} players
                </span>
                {count > 0 && (
                  <span className={styles.voteCount}>{count} vote{count !== 1 ? 's' : ''}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {voted && (
        <p className={styles.waiting}>Waiting for other players...</p>
      )}
    </div>
  );
}
