import { useState, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import PlayerName from '../components/PlayerName.jsx';
import CasinoSidebar from '../components/CasinoSidebar.jsx';
import PetWithStream from '../components/PetWithStream.jsx';
import styles from './GameVote.module.css';
const voteImg = '/votefornext.png';
const pharaohImg = '/pharoah.png';
const coinsImg = '/coins.png';

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
import previewBattleship from '../assets/gamepreviews/battleship.jpg';
import previewReactionTap from '../assets/gamepreviews/reactionTap.png';
import previewTypingRace from '../assets/gamepreviews/typingrace.png';
import previewScattergories from '../assets/gamepreviews/scattergories.png';
import previewBsCheat from '../assets/gamepreviews/bsCheat.png';
import previewWavelength from '../assets/gamepreviews/wavelength.png';
import previewAimTrainer from '../assets/gamepreviews/aimTrainer.png';
import previewMastermind from '../assets/gamepreviews/mastermind.png';
import previewPresident from '../assets/gamepreviews/president.png';
import previewSpoons from '../assets/gamepreviews/spoons.png';
import previewFibbage from '../assets/gamepreviews/fibbage.png';
import previewConnect4 from '../assets/gamepreviews/connect4.png';
import previewUltimateTTT from '../assets/gamepreviews/ultimateTTT.png';
import previewSkribbl from '../assets/gamepreviews/skribbl.png';
import previewTelephone from '../assets/gamepreviews/telephonePictionary.png';
import previewOthello from '../assets/gamepreviews/othello.png';
import previewDotsAndBoxes from '../assets/gamepreviews/dotsAndBoxes.png';
import previewGomoku from '../assets/gamepreviews/gomoku.png';
import previewHex from '../assets/gamepreviews/hex.png';
import previewOrderChaos from '../assets/gamepreviews/orderChaos.png';
import previewNim from '../assets/gamepreviews/nim.png';
import previewBuzzerRoyale from '../assets/gamepreviews/buzzerRoyale.png';
import previewHigherLower from '../assets/gamepreviews/higherLower.png';
import previewPriceIsWrong from '../assets/gamepreviews/priceIsWrong.png';
import previewTimeline from '../assets/gamepreviews/timeline.png';
import previewGuesstimate from '../assets/gamepreviews/guesstimate.png';
import previewOddOneOut from '../assets/gamepreviews/oddOneOut.png';
import previewRankIt from '../assets/gamepreviews/rankIt.png';
import previewThisOrThat from '../assets/gamepreviews/thisOrThat.png';
import previewDefinitionDuel from '../assets/gamepreviews/definitionDuel.png';
import previewQuiplashClash from '../assets/gamepreviews/quiplashClash.png';
import previewCaptionThis from '../assets/gamepreviews/captionThis.png';
import previewAwkwardAward from '../assets/gamepreviews/awkwardAward.png';
import previewMostLikelyTo from '../assets/gamepreviews/mostLikelyTo.png';
import previewVoteProphet from '../assets/gamepreviews/voteProphet.png';
import previewGroupMind from '../assets/gamepreviews/groupMind.png';
import previewMobRule from '../assets/gamepreviews/mobRule.png';
import previewTwoTruths from '../assets/gamepreviews/twoTruths.png';
import previewSuperlativeShowdown from '../assets/gamepreviews/superlativeShowdown.png';
import previewSpyfall from '../assets/gamepreviews/spyfall.png';
import previewChameleon from '../assets/gamepreviews/chameleon.png';
import previewTraitorsVault from '../assets/gamepreviews/traitorsVault.png';
import previewWhisperNetwork from '../assets/gamepreviews/whisperNetwork.png';
import previewSketchImpostor from '../assets/gamepreviews/sketchImpostor.png';
import previewTakeSix from '../assets/gamepreviews/takeSix.png';
import previewPressYourLuckPigs from '../assets/gamepreviews/pressYourLuckPigs.png';
import previewQwixx from '../assets/gamepreviews/qwixx.png';
import previewYahtzee from '../assets/gamepreviews/yahtzee.png';
import previewDominoDrift from '../assets/gamepreviews/dominoDrift.png';
import previewBingoBrawl from '../assets/gamepreviews/bingoBrawl.png';

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
  battleship: previewBattleship,
  reactionTap: previewReactionTap,
  typingRace: previewTypingRace,
  scattergories: previewScattergories,
  bsCheat: previewBsCheat,
  wavelength: previewWavelength,
  aimTrainer: previewAimTrainer,
  mastermind: previewMastermind,
  president: previewPresident,
  spoons: previewSpoons,
  fibbage: previewFibbage,
  connect4: previewConnect4,
  ultimateTTT: previewUltimateTTT,
  skribbl: previewSkribbl,
  telephonePictionary: previewTelephone,
  othello: previewOthello,
  dotsAndBoxes: previewDotsAndBoxes,
  gomoku: previewGomoku,
  hex: previewHex,
  orderChaos: previewOrderChaos,
  nim: previewNim,
  buzzerRoyale: previewBuzzerRoyale,
  higherLower: previewHigherLower,
  priceIsWrong: previewPriceIsWrong,
  timeline: previewTimeline,
  guesstimate: previewGuesstimate,
  oddOneOut: previewOddOneOut,
  rankIt: previewRankIt,
  thisOrThat: previewThisOrThat,
  definitionDuel: previewDefinitionDuel,
  quiplashClash: previewQuiplashClash,
  captionThis: previewCaptionThis,
  awkwardAward: previewAwkwardAward,
  mostLikelyTo: previewMostLikelyTo,
  voteProphet: previewVoteProphet,
  groupMind: previewGroupMind,
  mobRule: previewMobRule,
  twoTruths: previewTwoTruths,
  superlativeShowdown: previewSuperlativeShowdown,
  spyfall: previewSpyfall,
  chameleon: previewChameleon,
  traitorsVault: previewTraitorsVault,
  whisperNetwork: previewWhisperNetwork,
  sketchImpostor: previewSketchImpostor,
  takeSix: previewTakeSix,
  pressYourLuckPigs: previewPressYourLuckPigs,
  qwixx: previewQwixx,
  yahtzee: previewYahtzee,
  dominoDrift: previewDominoDrift,
  bingoBrawl: previewBingoBrawl,
};

export default function GameVote({ eligibleGames, tournamentState, nicknames, avatars, onVote }) {
  const { socket } = useSocketContext();
  const { playSound } = useSound();
  const [voted, setVoted] = useState(false);
  const [voteCounts, setVoteCounts] = useState({});

  useEffect(() => { setVoted(false); setVoteCounts({}); }, [eligibleGames]);

  useEffect(() => {
    if (!socket) return;
    function onVoteUpdate(data) { setVoteCounts(data.votes ?? {}); }
    socket.on(EVENTS.VOTE_UPDATE, onVoteUpdate);
    return () => socket.off(EVENTS.VOTE_UPDATE, onVoteUpdate);
  }, [socket]);

  function handleVote(gameId) { if (voted) return; setVoted(true); playSound('voteCast'); onVote(gameId); }

  const round = tournamentState?.currentRound ?? '?';
  const winCondition = tournamentState?.winCondition;
  const winTarget = tournamentState?.winTarget;
  const standings = tournamentState?.standings || [];
  const playerCount = standings.length;
  const needsMorePlayers = playerCount < 2;
  const myScore = tournamentState?.scores?.[socket?.id] ?? 0;

  const roundLabel = winCondition === 'fixedRounds' ? `Round ${round} of ${winTarget}` : `Round ${round}`;
  const targetLabel = winCondition === 'pointThreshold' ? `First to ${winTarget?.toLocaleString()} points` : null;

  return (
    <div className={styles.outerLayout}>
      <PetWithStream screen="gameVote" />
      {/* Coins background at top */}
      <div className={styles.coinsBackground}>
        <img src={coinsImg} alt="" className={styles.coinsImage} />
        <div className={styles.coinsGradient} />
      </div>

      <div className={styles.container}>
        <div className={styles.header}>
          <img src={voteImg} alt="Vote for the Next Game" className={styles.titleImage} />
          <p className={styles.subtitle}>{roundLabel}</p>
          {targetLabel && <p className={styles.subtitle}>{targetLabel}</p>}
        </div>

        {standings.length > 0 && (
          <div className={styles.standings}>
            <p className={styles.standingsTitle}>Leaderboard</p>
            <div className={styles.standingsInner}>
              <img src={pharaohImg} alt="" className={styles.pharaohImage} />
              <div className={styles.standingsList}>
                {standings.map((entry, i) => (
                  <div key={entry.playerId} className={styles.standingRow}>
                    <span className={styles.standingRank}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
                    <span className={styles.standingName}><PlayerName playerId={entry.playerId} nicknames={nicknames} avatars={avatars} /></span>
                    <span className={styles.standingScore}>{entry.score} pts</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className={styles.grid}>
          {eligibleGames.map((game) => {
            const count = voteCounts[game.id] ?? 0;
            return (
              <button key={game.id} className={`${styles.card} ${voted || needsMorePlayers ? styles.cardDisabled : ''}`} onClick={() => !needsMorePlayers && handleVote(game.id)} disabled={voted || needsMorePlayers}>
                {GAME_PREVIEWS[game.id] && (
                  <div className={styles.previewWrapper}>
                    <img src={GAME_PREVIEWS[game.id]} alt={game.name} className={styles.previewImage} />
                    <div className={styles.previewOverlay} />
                  </div>
                )}
                <div className={styles.cardContent}>
                  <h3 className={styles.gameName}>{game.name}</h3>
                  <p className={styles.gameDesc}>{game.description}</p>
                  <div className={styles.cardFooter}>
                    <span className={styles.playerRange}>{game.minPlayers}–{game.maxPlayers} players</span>
                    {count > 0 && <span className={styles.voteCount}>{count} vote{count !== 1 ? 's' : ''}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {needsMorePlayers && <p className={styles.waiting}>Waiting for players to join...</p>}
        {voted && !needsMorePlayers && <p className={styles.waiting}>Waiting for other players...</p>}
      </div>

      <CasinoSidebar socket={socket} myScore={myScore} />
    </div>
  );
}
