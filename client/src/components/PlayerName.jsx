import { useState } from 'react';
import { displayName } from '../utils/displayName.js';
import styles from './PlayerName.module.css';

export default function PlayerName({ playerId, nicknames, avatars, size = 20 }) {
  const [expanded, setExpanded] = useState(false);
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
          style={{ width: size, height: size, cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
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
      {expanded && avatar && (
        <div className={styles.expandedOverlay} onClick={() => setExpanded(false)}>
          <div className={styles.expandedCard} onClick={(e) => e.stopPropagation()}>
            <img src={avatar} alt="" className={styles.expandedImg} />
            <span className={styles.expandedName}>{name}</span>
            <button className={styles.expandedClose} onClick={() => setExpanded(false)}>✕</button>
          </div>
        </div>
      )}
    </span>
  );
}
