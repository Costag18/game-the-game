import styles from './TournamentEnd.module.css';

export default function TournamentEnd({ data, onRematch, onLeave }) {
  if (!data) return null;

  const { winner, standings = [] } = data;

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <h2 className={styles.title}>Tournament Over!</h2>

        {winner && (
          <div className={styles.winnerBox}>
            <span className={styles.trophyIcon}>🏆</span>
            <div>
              <span className={styles.winnerLabel}>Winner</span>
              <p className={styles.winnerName}>
                {typeof winner === 'string' ? winner : (winner.nickname ?? winner.playerId?.slice(0, 8))}
              </p>
            </div>
          </div>
        )}

        <h3 className={styles.standingsTitle}>Final Standings</h3>

        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Rank</th>
              <th className={styles.th}>Player</th>
              <th className={styles.th}>Score</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((entry, index) => {
              const playerLabel = entry.nickname ?? entry.playerId?.slice(0, 8);
              return (
                <tr key={entry.playerId} className={styles.row}>
                  <td className={styles.rank}>
                    {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                  </td>
                  <td className={styles.playerName}>{playerLabel}</td>
                  <td className={styles.score}>{entry.score.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className={styles.actions}>
          <button className={styles.btnLeave} onClick={onLeave}>
            Leave
          </button>
          <button className={styles.btnRematch} onClick={onRematch}>
            Rematch
          </button>
        </div>
      </div>
    </div>
  );
}
