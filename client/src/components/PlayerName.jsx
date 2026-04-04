import { displayName } from '../utils/displayName.js';
import styles from './PlayerName.module.css';

export default function PlayerName({ playerId, nicknames, avatars, size = 20 }) {
  const name = displayName(playerId, nicknames);
  const avatar = avatars?.[playerId] || null;
  const initial = name?.[0]?.toUpperCase() || '?';

  return (
    <span className={styles.playerName}>
      {avatar ? (
        <img
          src={avatar}
          alt=""
          className={styles.avatar}
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className={styles.avatarPlaceholder}
          style={{ width: size, height: size, fontSize: size * 0.5 }}
        >
          {initial}
        </span>
      )}
      <span className={styles.name}>{name}</span>
    </span>
  );
}
