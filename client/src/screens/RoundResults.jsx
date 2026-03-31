import styles from './RoundResults.module.css';

export default function RoundResults({ roundResults, onContinue }) {
  if (!roundResults) return null;

  const { standings = [], roundDeltas = {} } = roundResults;

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <h2 className={styles.title}>Round Results</h2>

        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Rank</th>
              <th className={styles.th}>Player</th>
              <th className={styles.th}>Score</th>
              <th className={styles.th}>Round</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((entry, index) => {
              const delta = roundDeltas?.[entry.playerId] ?? 0;
              const playerLabel = entry.nickname ?? entry.playerId?.slice(0, 8);
              return (
                <tr key={entry.playerId} className={styles.row}>
                  <td className={styles.rank}>
                    {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                  </td>
                  <td className={styles.playerName}>{playerLabel}</td>
                  <td className={styles.score}>{entry.score.toLocaleString()}</td>
                  <td className={`${styles.delta} ${delta >= 0 ? styles.positive : styles.negative}`}>
                    {delta >= 0 ? `+${delta}` : delta}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <button className={styles.btnContinue} onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
