import { useState, useEffect, useCallback } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import { displayName } from '../utils/displayName.js';
import styles from './GameVote.module.css';
import voteImg from '../assets/images/votefornext.png';

import previewBlackjack from '../assets/gamepreviews/Blackjack.png';
import previewPoker from '../assets/gamepreviews/ad064bcefa40-no-limit-texas-holdem.png';
import previewUno from '../assets/gamepreviews/uno3.jpg';
import previewGoFish from '../assets/gamepreviews/gofish.jpeg';
import previewCrazyEights from '../assets/gamepreviews/crazyeights800480.png';
import previewRps from '../assets/gamepreviews/rock-paper-scissor-ft.png';
import previewLiarsDice from '../assets/gamepreviews/LiarsDice_25CG_PSG25_09.png';
import previewMemoryMatch from '../assets/gamepreviews/concentration-card-game-1.jpg';
import previewRoulette from '../assets/gamepreviews/roulettet.jpg';
import previewHangman from '../assets/gamepreviews/Hangman_web-1024x682.png';
import previewSpotDiff from '../assets/gamepreviews/spotthedifference.png';

const GAME_PREVIEWS = {
  blackjack: previewBlackjack,
  poker: previewPoker,
  uno: previewUno,
  goFish: previewGoFish,
  crazyEights: previewCrazyEights,
  rps: previewRps,
  liarsDice: previewLiarsDice,
  memoryMatch: previewMemoryMatch,
  roulette: previewRoulette,
  hangman: previewHangman,
  spotTheDifference: previewSpotDiff,
};

function CoinFlipPanel({ socket, myScore }) {
  const [wager, setWager] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null); // { result, won, amount }
  const [animClass, setAnimClass] = useState('');

  const maxWager = Math.floor((myScore || 0) * 0.5);

  useEffect(() => {
    if (!socket) return;
    function onResult(data) {
      // Delay showing result until animation completes
      setTimeout(() => {
        setResult(data);
        setAnimClass(data.result === 'heads' ? styles.coinLandHeads : styles.coinLandTails);
        setSpinning(false);
      }, 1500);
    }
    socket.on(EVENTS.COIN_FLIP_RESULT, onResult);
    return () => socket.off(EVENTS.COIN_FLIP_RESULT, onResult);
  }, [socket]);

  // Clamp wager if score changed
  useEffect(() => {
    if (wager > maxWager) setWager(Math.max(1, maxWager));
  }, [maxWager]);

  function handleFlip(choice) {
    if (spinning || maxWager <= 0) return;
    setSpinning(true);
    setResult(null);
    setAnimClass(styles.coinSpinning);
    socket.emit(EVENTS.COIN_FLIP, { amount: wager, choice });
  }

  const isBroke = maxWager <= 0;

  return (
    <div className={styles.coinPanel}>
      <h3 className={styles.coinTitle}>Coin Flip</h3>
      <p className={styles.coinSubtitle}>Gamble your points while you wait!</p>

      {/* Coin */}
      <div className={styles.coinScene}>
        <div className={`${styles.coin} ${animClass}`}>
          <div className={styles.coinFace + ' ' + styles.coinHeads}>H</div>
          <div className={styles.coinFace + ' ' + styles.coinTails}>T</div>
        </div>
      </div>

      {/* Result */}
      {result && !spinning && (
        <p className={result.won ? styles.coinWin : styles.coinLose}>
          {result.won ? `+${result.amount}` : `-${result.amount}`} — {result.result}!
        </p>
      )}

      {/* Wager slider */}
      {!isBroke ? (
        <>
          <div className={styles.coinWagerRow}>
            <span className={styles.coinWagerLabel}>Wager:</span>
            <span className={styles.coinWagerAmount}>{wager}</span>
          </div>
          <input
            type="range"
            min={1}
            max={maxWager}
            value={wager}
            onChange={(e) => setWager(Number(e.target.value))}
            className={styles.coinSlider}
            disabled={spinning}
          />

          {/* Heads / Tails buttons */}
          <div className={styles.coinButtons}>
            <button
              className={styles.btnHeads}
              onClick={() => handleFlip('heads')}
              disabled={spinning || isBroke}
            >
              Heads
            </button>
            <button
              className={styles.btnTails}
              onClick={() => handleFlip('tails')}
              disabled={spinning || isBroke}
            >
              Tails
            </button>
          </div>
        </>
      ) : (
        <p className={styles.coinBroke}>No points to gamble!</p>
      )}
    </div>
  );
}

export default function GameVote({ eligibleGames, tournamentState, nicknames, onVote }) {
  const { socket } = useSocketContext();
  const [voted, setVoted] = useState(false);
  const [voteCounts, setVoteCounts] = useState({});

  useEffect(() => {
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
  const myScore = tournamentState?.scores?.[socket?.id] ?? 0;

  const roundLabel = winCondition === 'fixedRounds'
    ? `Round ${round} of ${winTarget}`
    : `Round ${round}`;
  const targetLabel = winCondition === 'pointThreshold'
    ? `First to ${winTarget?.toLocaleString()} points`
    : null;

  return (
    <div className={styles.outerLayout}>
      <div className={styles.container}>
        <div className={styles.header}>
          <img src={voteImg} alt="Vote for the Next Game" className={styles.titleImage} />
          <p className={styles.subtitle}>{roundLabel}</p>
          {targetLabel && <p className={styles.subtitle}>{targetLabel}</p>}
        </div>

        {standings.length > 0 && (
          <div className={styles.standings}>
            <p className={styles.standingsTitle}>Leaderboard</p>
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
                {GAME_PREVIEWS[game.id] && (
                  <div className={styles.previewWrapper}>
                    <img
                      src={GAME_PREVIEWS[game.id]}
                      alt={game.name}
                      className={styles.previewImage}
                    />
                    <div className={styles.previewOverlay} />
                  </div>
                )}
                <div className={styles.cardContent}>
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
                </div>
              </button>
            );
          })}
        </div>

        {voted && (
          <p className={styles.waiting}>Waiting for other players...</p>
        )}
      </div>

      <CoinFlipPanel socket={socket} myScore={myScore} />
    </div>
  );
}
