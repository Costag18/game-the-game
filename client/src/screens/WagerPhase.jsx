import { useState, useCallback } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { GAMES } from '../../../shared/gameList.js';
import CasinoSidebar from '../components/CasinoSidebar.jsx';
import styles from './WagerPhase.module.css';

function Popdown({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.popdown}>
      <button className={styles.popdownToggle} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className={styles.popdownArrow}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className={styles.popdownContent}>{children}</div>}
    </div>
  );
}

function TutorialVideo({ embedUrl, watchUrl, gameName }) {
  const [embedFailed, setEmbedFailed] = useState(false);
  const handleError = useCallback(() => setEmbedFailed(true), []);

  if (embedFailed || !embedUrl) {
    return (
      <a href={watchUrl} target="_blank" rel="noopener noreferrer" className={styles.tutorialLink}>
        Watch how to play {gameName} on YouTube
      </a>
    );
  }

  return (
    <>
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
    </>
  );
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

function WagerTable({ wagerReturns, wager }) {
  const example = wager || 100;
  return (
    <table className={styles.wagerTable}>
      <thead>
        <tr>
          <th>Placement</th>
          <th>Return</th>
          <th>Example ({example} wager)</th>
        </tr>
      </thead>
      <tbody>
        {wagerReturns.map((mult, i) => {
          const net = Math.floor(example * mult) - example;
          const cls = net > 0 ? styles.wagerProfit : net === 0 ? styles.wagerEven : styles.wagerLoss;
          return (
            <tr key={i}>
              <td>{ORDINALS[i] || `#${i + 1}`}</td>
              <td>{mult}x back</td>
              <td className={cls}>
                {net > 0 ? `+${net} profit` : net === 0 ? 'break even' : `${net} loss`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
  const wagerReturns = voteResult?.wagerReturns || [2.0, 1.5, 1.0, 0, 0, 0];

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
    <div className={styles.outerLayout}>
      <div className={styles.container}>
        <div className={styles.panel}>
        <h2 className={styles.title}>Place Your Wager</h2>

        {game && (
          <div className={styles.gameInfo}>
            <span className={styles.gameLabel}>Selected Game</span>
            <span className={styles.gameName}>{game.name}</span>
            <p className={styles.gameDesc}>{game.description}</p>
          </div>
        )}

        {(game?.tutorial || game?.instructions) && (
          <Popdown title="Game Instructions">
            {game.tutorial && (
              <TutorialVideo embedUrl={embedUrl} watchUrl={game.tutorial} gameName={game.name} />
            )}
            {game.instructions && (
              <ul className={styles.instructionsList}>
                {game.instructions.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </Popdown>
        )}

        <Popdown title="How Wagering Works">
          <div className={styles.wagerInfo}>
            <p>Wager up to 50% of your current points each round. Your wager multiplies based on how you place — high risk, high reward!</p>
            <WagerTable wagerReturns={wagerReturns} wager={wager || 100} />
            <p>You also earn base points for your placement regardless of wager.</p>
          </div>
        </Popdown>

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
    <CasinoSidebar socket={socket} myScore={myScore} />
  </div>
  );
}
