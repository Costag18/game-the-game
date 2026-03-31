import { useState, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './GameVote.module.css';

export default function GameVote({ eligibleGames, tournamentState, onVote }) {
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
  const totalRounds = tournamentState?.totalRounds ?? '?';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Vote for the Next Game</h2>
        <p className={styles.subtitle}>Round {round} of {totalRounds}</p>
      </div>

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
