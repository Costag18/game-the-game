import { useState, useCallback } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { GAMES } from '../../../shared/gameList.js';
import styles from './WagerPhase.module.css';

function TutorialVideo({ embedUrl, watchUrl, gameName }) {
  const [embedFailed, setEmbedFailed] = useState(false);

  const handleError = useCallback(() => setEmbedFailed(true), []);

  if (embedFailed || !embedUrl) {
    return (
      <div className={styles.tutorialWrapper}>
        <a href={watchUrl} target="_blank" rel="noopener noreferrer" className={styles.tutorialLink}>
          Watch how to play {gameName} on YouTube
        </a>
      </div>
    );
  }

  return (
    <div className={styles.tutorialWrapper}>
      <span className={styles.tutorialLabel}>How to play:</span>
      <iframe
        className={styles.tutorialVideo}
        src={embedUrl}
        title={`How to play ${gameName}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onError={handleError}
      />
      <a href={watchUrl} target="_blank" rel="noopener noreferrer" className={styles.tutorialLink}>
        Open on YouTube
      </a>
    </div>
  );
}

export default function WagerPhase({ tournamentState, voteResult, onSubmitWager }) {
  const { socket } = useSocketContext();
  const [wagerLocked, setWagerLocked] = useState(false);

  const myId = socket?.id;
  const myScore = tournamentState?.scores?.[myId] ?? 0;
  const maxWager = Math.floor(myScore * 0.5);

  const [wager, setWager] = useState(0);

  const gameId = voteResult?.selectedGame ?? voteResult?.gameId;
  const game = gameId ? GAMES[gameId] : null;

  // Convert YouTube watch URL to embed URL (nocookie for better compatibility)
  function getEmbedUrl(url) {
    if (!url) return null;
    const match = url.match(/(?:watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : null;
  }
  const embedUrl = getEmbedUrl(game?.tutorial);

  function handleLockIn() {
    if (wagerLocked) return;
    setWagerLocked(true);
    onSubmitWager(wager);
  }

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <h2 className={styles.title}>Place Your Wager</h2>

        {game && (
          <div className={styles.gameInfo}>
            <span className={styles.gameLabel}>Selected Game</span>
            <span className={styles.gameName}>{game.name}</span>
            <p className={styles.gameDesc}>{game.description}</p>
            {game.tutorial && (
              <TutorialVideo embedUrl={embedUrl} watchUrl={game.tutorial} gameName={game.name} />
            )}
          </div>
        )}

        <div className={styles.scoreRow}>
          <span className={styles.scoreLabel}>Your Points</span>
          <span className={styles.scoreValue}>{myScore.toLocaleString()}</span>
        </div>

        {!wagerLocked ? (
          <>
            <div className={styles.sliderSection}>
              <div className={styles.sliderHeader}>
                <span className={styles.sliderLabel}>Wager Amount</span>
                <span className={styles.wagerAmount}>{wager.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min={0}
                max={maxWager}
                value={wager}
                onChange={(e) => setWager(Number(e.target.value))}
                className={styles.slider}
                disabled={maxWager === 0}
              />
              <div className={styles.sliderBounds}>
                <span>0</span>
                <span>{maxWager.toLocaleString()} (50%)</span>
              </div>
            </div>

            <button
              className={styles.btnLockIn}
              onClick={handleLockIn}
            >
              Lock In Wager
            </button>
          </>
        ) : (
          <p className={styles.locked}>Wager locked! Waiting for others...</p>
        )}
      </div>
    </div>
  );
}
