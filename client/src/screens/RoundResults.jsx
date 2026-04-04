import { useState, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { useSound } from '../context/SoundContext.jsx';
import PlayerName from '../components/PlayerName.jsx';
import styles from './RoundResults.module.css';

function getGameDetail(gameResult, gameId) {
  if (!gameResult) return '';
  if (gameResult.handDescription) return gameResult.handDescription;
  if (gameResult.handTotal != null) return `Total: ${gameResult.handTotal}`;
  if (gameResult.wins != null) return `${gameResult.wins} win${gameResult.wins !== 1 ? 's' : ''}`;
  if (gameResult.completedSets != null) return `${gameResult.completedSets} sets`;
  if (gameResult.pairsCollected != null) return `${gameResult.pairsCollected} pairs`;
  if (gameResult.score != null) return `Score: ${gameResult.score}`;
  if (gameResult.chips != null) return `${gameResult.chips} chips`;
  if (gameResult.cardCount != null) return `${gameResult.cardCount} cards`;
  if (gameResult.remainingCards != null) return `${gameResult.remainingCards} left`;
  if (gameResult.wrongCount != null) return `${gameResult.wrongCount} wrong`;
  return '';
}

export default function RoundResults({ roundResults, onContinue }) {
  const { socket } = useSocketContext();
  const { playSound } = useSound();
  const [acked, setAcked] = useState(false);

  // Play win/lose sound when results arrive
  useEffect(() => {
    if (!roundResults?.standings?.length || !socket) return;
    const myIdx = roundResults.standings.findIndex((e) => e.playerId === socket.id);
    if (myIdx === 0) playSound('winRound');
    else if (myIdx > 0) playSound('loseRound');
  }, [roundResults, socket, playSound]);

  if (!roundResults) {
    return (
      <div className={styles.container}>
        <div className={styles.panel}>
          <h2 className={styles.title}>Calculating Results...</h2>
        </div>
      </div>
    );
  }

  const { standings = [], scores = {}, gameResults = null, gameId = null } = roundResults;

  const avatars = Object.fromEntries(standings.map(s => [s.playerId, s.avatar]));
  const nicknames = Object.fromEntries(standings.map(s => [s.playerId, s.nickname]));

  const gameResultMap = {};
  if (gameResults && Array.isArray(gameResults)) {
    for (const r of gameResults) {
      gameResultMap[r.playerId] = r;
    }
  }

  // Show detail column if any player has game-specific info
  const hasDetails = Object.values(gameResultMap).some((r) => getGameDetail(r, gameId));

  // Winner is first in standings
  const winner = standings[0];
  const winnerDelta = scores?.[winner?.playerId]?.total ?? 0;

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <h2 className={styles.title}>Round Results</h2>

        {/* Winner banner */}
        {winner && (
          <div className={styles.winnerBanner}>
            <span className={styles.winnerTrophy}>🏆</span>
            <div className={styles.winnerInfo}>
              <span className={styles.winnerName}><PlayerName playerId={winner.playerId} nicknames={nicknames} avatars={avatars} /></span>
              <span className={styles.winnerDetail}>
                {getGameDetail(gameResultMap[winner.playerId], gameId)}
                {winnerDelta > 0 ? ` — +${winnerDelta} pts` : ''}
              </span>
            </div>
          </div>
        )}

        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Rank</th>
              <th className={styles.th}>Player</th>
              {hasDetails && <th className={styles.th}>Detail</th>}
              <th className={styles.th}>Score</th>
              <th className={styles.thRight}>Round</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((entry, index) => {
              const roundScore = scores?.[entry.playerId];
              const delta = roundScore?.total ?? 0;
              const wagerNet = roundScore?.wagerNet ?? 0;
              const gameResult = gameResultMap[entry.playerId];
              const detail = getGameDetail(gameResult, gameId);

              return (
                <tr key={entry.playerId} className={styles.row}>
                  <td className={styles.rank}>
                    {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                  </td>
                  <td className={styles.playerName}><PlayerName playerId={entry.playerId} nicknames={nicknames} avatars={avatars} /></td>
                  {hasDetails && <td className={styles.detail}>{detail}</td>}
                  <td className={styles.score}>{entry.score.toLocaleString()}</td>
                  <td className={`${styles.delta} ${delta >= 0 ? styles.positive : styles.negative}`}>
                    {delta >= 0 ? `+${delta}` : delta}
                    {wagerNet !== 0 && (
                      <span className={styles.wagerDelta}>
                        {' '}({wagerNet >= 0 ? `+${wagerNet}` : wagerNet} wager)
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!acked ? (
          <button className={styles.btnContinue} onClick={() => { setAcked(true); onContinue(); }}>
            Continue
          </button>
        ) : (
          <p className={styles.waitingText}>Waiting for other players...</p>
        )}
      </div>
    </div>
  );
}
