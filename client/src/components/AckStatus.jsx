import PlayerName from './PlayerName.jsx';
import styles from './AckStatus.module.css';

/**
 * Shared "who are we waiting on" indicator for reveal/round-end acknowledge phases.
 * Shows that YOU pressed continue, and names the players who still haven't.
 *
 * props:
 *  - players: ids who need to acknowledge (the relevant active set)
 *  - acknowledged: ids who already acknowledged (from server state)
 *  - me: my own player id (so I can be marked ready immediately)
 *  - iActed: true once I've clicked locally (instant feedback before the round-trip)
 */
export default function AckStatus({ players = [], acknowledged = [], me, iActed, nicknames, avatars }) {
  const ackedSet = new Set(acknowledged);
  if (iActed && me) ackedSet.add(me);
  const waiting = players.filter((p) => !ackedSet.has(p));
  const youReady = (iActed && !!me) || (me && ackedSet.has(me));

  return (
    <div className={styles.wrap}>
      {youReady && <span className={styles.ready}>✓ You’re ready</span>}
      {waiting.length === 0 ? (
        <span className={styles.done}>Everyone’s ready — moving on…</span>
      ) : (
        <span className={styles.waiting}>
          Waiting for{' '}
          {waiting.map((p, i) => (
            <span key={p} className={styles.who}>
              <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} />
              {i < waiting.length - 1 ? ', ' : ''}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
