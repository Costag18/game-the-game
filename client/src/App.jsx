import { useState, useEffect } from 'react';
import { SocketProvider, useSocketContext } from './context/SocketContext.jsx';
import { PetProvider } from './context/PetContext.jsx';
import { SoundProvider, useSound } from './context/SoundContext.jsx';
import { useTournament } from './hooks/useTournament.js';
import { EVENTS } from '../../shared/events.js';
import MainMenu from './screens/MainMenu.jsx';
import LobbyBrowser from './screens/LobbyBrowser.jsx';
import CreateLobby from './screens/CreateLobby.jsx';
import WaitingRoom from './screens/WaitingRoom.jsx';
import GameVote from './screens/GameVote.jsx';
import WagerPhase from './screens/WagerPhase.jsx';
import RoundResults from './screens/RoundResults.jsx';
import TournamentEnd from './screens/TournamentEnd.jsx';
import CasinoMode from './screens/CasinoMode.jsx';
import PetWithStream from './components/PetWithStream.jsx';
import StockTicker from './components/StockTicker.jsx';
import EmoteOverlay from './components/EmoteOverlay.jsx';
import SettingsGear from './components/SettingsGear.jsx';
import ConfettiOverlay from './components/ConfettiOverlay.jsx';
import TurnOverlay from './components/TurnOverlay.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import BlackjackGame from './games/Blackjack.jsx';
import PokerGame from './games/Poker.jsx';
import UnoGame from './games/Uno.jsx';

import GoFishGame from './games/GoFish.jsx';
import CrazyEightsGame from './games/CrazyEights.jsx';
import RpsGame from './games/RockPaperScissors.jsx';
import LiarsDiceGame from './games/LiarsDice.jsx';
import MemoryMatchGame from './games/MemoryMatch.jsx';
import RouletteGame from './games/Roulette.jsx';
import HangmanGame from './games/Hangman.jsx';
import SpotTheDifferenceGame from './games/SpotTheDifference.jsx';
import BattleshipGame from './games/Battleship.jsx';
import ReactionTapGame from './games/ReactionTap.jsx';
import TypingRaceGame from './games/TypingRace.jsx';
import ScattergoriesGame from './games/Scattergories.jsx';
import BsCheatGame from './games/BsCheat.jsx';
import WavelengthGame from './games/Wavelength.jsx';
import AimTrainerGame from './games/AimTrainer.jsx';
import MastermindGame from './games/Mastermind.jsx';
import PresidentGame from './games/President.jsx';
import SpoonsGame from './games/Spoons.jsx';
import FibbageGame from './games/Fibbage.jsx';
import Connect4Game from './games/Connect4.jsx';
import UltimateTicTacToeGame from './games/UltimateTicTacToe.jsx';
import SkribblGame from './games/Skribbl.jsx';
import TelephonePictionaryGame from './games/TelephonePictionary.jsx';
import OthelloGame from './games/Othello.jsx';
import DotsAndBoxesGame from './games/DotsAndBoxes.jsx';
import GomokuGame from './games/Gomoku.jsx';
import HexGame from './games/Hex.jsx';
import OrderAndChaosGame from './games/OrderAndChaos.jsx';
import NimHeistGame from './games/NimHeist.jsx';
import BuzzerRoyaleGame from './games/BuzzerRoyale.jsx';
import HigherLowerGame from './games/HigherLower.jsx';
import PriceIsWrongGame from './games/PriceIsWrong.jsx';
import TimelineGame from './games/Timeline.jsx';
import GuesstimateGame from './games/Guesstimate.jsx';
import OddOneOutGame from './games/OddOneOut.jsx';
import RankItGame from './games/RankIt.jsx';
import ThisOrThatGame from './games/ThisOrThat.jsx';
import DefinitionDuelGame from './games/DefinitionDuel.jsx';
import QuiplashClashGame from './games/QuiplashClash.jsx';
import CaptionThisGame from './games/CaptionThis.jsx';
import AwkwardAwardGame from './games/AwkwardAward.jsx';
import MostLikelyToGame from './games/MostLikelyTo.jsx';
import VoteProphetGame from './games/VoteProphet.jsx';
import GroupMindGame from './games/GroupMind.jsx';
import MobRuleGame from './games/MobRule.jsx';
import TwoTruthsGame from './games/TwoTruths.jsx';
import SuperlativeShowdownGame from './games/SuperlativeShowdown.jsx';
import SpyfallGame from './games/Spyfall.jsx';
import ChameleonCluesGame from './games/ChameleonClues.jsx';
import TraitorsVaultGame from './games/TraitorsVault.jsx';
import WhisperNetworkGame from './games/WhisperNetwork.jsx';
import SketchImpostorGame from './games/SketchImpostor.jsx';
import TakeSixGame from './games/TakeSix.jsx';
import PressYourLuckPigsGame from './games/PressYourLuckPigs.jsx';
import QwixxGame from './games/Qwixx.jsx';
import YahtzeeGame from './games/Yahtzee.jsx';
import DominoDriftGame from './games/DominoDrift.jsx';
import BingoBrawlGame from './games/BingoBrawl.jsx';
import TwentyFourGame from './games/TwentyFour.jsx';
import TargetLockedGame from './games/TargetLocked.jsx';
import FactorFrenzyGame from './games/FactorFrenzy.jsx';
import GoingOnceGame from './games/GoingOnce.jsx';
import DutchDropGame from './games/DutchDrop.jsx';
import SealedVaultGame from './games/SealedVault.jsx';
import LastBidStandingGame from './games/LastBidStanding.jsx';
import TokenTussleGame from './games/TokenTussle.jsx';
import WhackAPharaohGame from './games/WhackAPharaoh.jsx';
import CoinCascadeGame from './games/CoinCascade.jsx';
import BalloonBrinkmanshipGame from './games/BalloonBrinkmanship.jsx';
import PulseTapGame from './games/PulseTap.jsx';
import BullseyeDropGame from './games/BullseyeDrop.jsx';
import HotPotatoRelayGame from './games/HotPotatoRelay.jsx';
import './assets/styles/theme.css';
import './assets/styles/global.css';

const GAME_COMPONENTS = {
  blackjack: BlackjackGame,
  poker: PokerGame,
  uno: UnoGame,

  goFish: GoFishGame,
  crazyEights: CrazyEightsGame,
  rps: RpsGame,
  liarsDice: LiarsDiceGame,
  memoryMatch: MemoryMatchGame,
  roulette: RouletteGame,
  hangman: HangmanGame,
  spotTheDifference: SpotTheDifferenceGame,
  battleship: BattleshipGame,
  reactionTap: ReactionTapGame,
  typingRace: TypingRaceGame,
  scattergories: ScattergoriesGame,
  bsCheat: BsCheatGame,
  wavelength: WavelengthGame,
  aimTrainer: AimTrainerGame,
  mastermind: MastermindGame,
  president: PresidentGame,
  spoons: SpoonsGame,
  fibbage: FibbageGame,
  connect4: Connect4Game,
  ultimateTTT: UltimateTicTacToeGame,
  skribbl: SkribblGame,
  telephonePictionary: TelephonePictionaryGame,
  othello: OthelloGame,
  dotsAndBoxes: DotsAndBoxesGame,
  gomoku: GomokuGame,
  hex: HexGame,
  orderChaos: OrderAndChaosGame,
  nim: NimHeistGame,
  buzzerRoyale: BuzzerRoyaleGame,
  higherLower: HigherLowerGame,
  priceIsWrong: PriceIsWrongGame,
  timeline: TimelineGame,
  guesstimate: GuesstimateGame,
  oddOneOut: OddOneOutGame,
  rankIt: RankItGame,
  thisOrThat: ThisOrThatGame,
  definitionDuel: DefinitionDuelGame,
  quiplashClash: QuiplashClashGame,
  captionThis: CaptionThisGame,
  awkwardAward: AwkwardAwardGame,
  mostLikelyTo: MostLikelyToGame,
  voteProphet: VoteProphetGame,
  groupMind: GroupMindGame,
  mobRule: MobRuleGame,
  twoTruths: TwoTruthsGame,
  superlativeShowdown: SuperlativeShowdownGame,
  spyfall: SpyfallGame,
  chameleon: ChameleonCluesGame,
  traitorsVault: TraitorsVaultGame,
  whisperNetwork: WhisperNetworkGame,
  sketchImpostor: SketchImpostorGame,
  takeSix: TakeSixGame,
  pressYourLuckPigs: PressYourLuckPigsGame,
  qwixx: QwixxGame,
  yahtzee: YahtzeeGame,
  dominoDrift: DominoDriftGame,
  bingoBrawl: BingoBrawlGame,
  twentyFour: TwentyFourGame,
  targetLocked: TargetLockedGame,
  factorFrenzy: FactorFrenzyGame,
  goingOnce: GoingOnceGame,
  dutchDrop: DutchDropGame,
  sealedVault: SealedVaultGame,
  lastBidStanding: LastBidStandingGame,
  tokenTussle: TokenTussleGame,
  whackAPharaoh: WhackAPharaohGame,
  coinCascade: CoinCascadeGame,
  balloonBrinkmanship: BalloonBrinkmanshipGame,
  pulseTap: PulseTapGame,
  bullseyeDrop: BullseyeDropGame,
  hotPotatoRelay: HotPotatoRelayGame,
};

function GameRouter() {
  const { socket } = useSocketContext();
  const { playSound } = useSound();
  const [screen, setScreen] = useState('menu');
  const [currentLobby, setCurrentLobby] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const tournament = useTournament();

  // Keep-alive: ping server while in an active game/lobby to prevent Render sleep
  useEffect(() => {
    const activeScreens = ['waitingRoom', 'gameVote', 'wagerPhase', 'loadingGame', 'playing', 'roundResults'];
    if (!activeScreens.includes(screen)) return;
    const url = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;
    const ping = () => fetch(`${url}/health`).catch(() => {});
    ping();
    const interval = setInterval(ping, 2 * 60 * 1000); // every 2 min
    return () => clearInterval(interval);
  }, [screen]);

  useEffect(() => {
    if (!socket) return;
    socket.on(EVENTS.ROUND_START, () => { setScreen('gameVote'); playSound('roundStart'); });
    socket.on(EVENTS.VOTE_RESULT, () => { setScreen('wagerPhase'); });
    socket.on(EVENTS.WAGER_LOCKED, () => { setScreen('loadingGame'); playSound('wagerLock'); });
    socket.on(EVENTS.GAME_STATE, () => setScreen((prev) => prev === 'loadingGame' ? 'playing' : prev));
    socket.on(EVENTS.ROUND_RESULTS, () => setScreen('roundResults'));
    socket.on(EVENTS.TOURNAMENT_END, (data) => {
      setScreen('tournamentEnd');
      const winnerId = data?.winner?.playerId || data?.winner;
      if (winnerId === socket.id) {
        playSound('tournamentWin');
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4500);
      } else {
        playSound('tournamentLoss');
      }
    });
    // Social sounds
    socket.on(EVENTS.LOBBY_STATE, () => playSound('playerJoin'));
    socket.on(EVENTS.EMOTE_BROADCAST, () => playSound('emoteSend'));
    socket.on(EVENTS.GIF_BROADCAST, () => playSound('gifSend'));
    return () => {
      socket.off(EVENTS.ROUND_START);
      socket.off(EVENTS.VOTE_RESULT);
      socket.off(EVENTS.WAGER_LOCKED);
      socket.off(EVENTS.GAME_STATE);
      socket.off(EVENTS.ROUND_RESULTS);
      socket.off(EVENTS.TOURNAMENT_END);
      socket.off(EVENTS.LOBBY_STATE);
      socket.off(EVENTS.EMOTE_BROADCAST);
      socket.off(EVENTS.GIF_BROADCAST);
    };
  }, [socket, playSound]);

  function handleJoinLobby(lobby) {
    setCurrentLobby(lobby);
    setScreen('waitingRoom');
  }

  function handleContinueAfterResults() {
    // Show a loading state while waiting for server to start next round
    setScreen('waiting');
    tournament.clearRoundResults();
    socket?.emit(EVENTS.NEXT_ROUND);
  }

  function handleLeave() {
    socket?.emit(EVENTS.LEAVE_LOBBY);
    setCurrentLobby(null);
    setScreen('menu');
  }

  return (
    <>
      {screen === 'menu' && <MainMenu onNavigate={setScreen} />}
      {screen === 'casino' && <CasinoMode onBack={() => setScreen('menu')} />}
      {screen === 'lobbyBrowser' && (
        <LobbyBrowser onNavigate={setScreen} onJoinLobby={handleJoinLobby} />
      )}
      {screen === 'createLobby' && (
        <CreateLobby onNavigate={setScreen} onJoinLobby={handleJoinLobby} />
      )}
      {screen === 'waitingRoom' && currentLobby && (
        <WaitingRoom lobby={currentLobby} onNavigate={setScreen} avatars={currentLobby?.avatars || {}} />
      )}
      {screen === 'gameVote' && (
        <GameVote
          eligibleGames={tournament.eligibleGames}
          tournamentState={tournament.tournamentState}
          nicknames={tournament.tournamentState?.nicknames || currentLobby?.nicknames || tournament.gameState?.nicknames || {}}
          avatars={tournament.tournamentState?.avatars || currentLobby?.avatars || {}}
          onVote={tournament.vote}
        />
      )}
      {screen === 'wagerPhase' && (
        <WagerPhase
          tournamentState={tournament.tournamentState}
          voteResult={tournament.voteResult}
          avatars={tournament.tournamentState?.avatars || {}}
          onSubmitWager={tournament.submitWager}
        />
      )}
      {screen === 'playing' && (() => {
        const gameId = tournament.voteResult?.selectedGame;
        const GameComponent = GAME_COMPONENTS[gameId];
        if (!GameComponent) {
          return (
            <div style={{ color: 'var(--text-primary)', textAlign: 'center', paddingTop: '4rem', background: 'var(--felt-dark, #0f3d1a)', minHeight: '100vh' }}>
              <h2 style={{ fontFamily: 'Georgia', color: '#d4a843' }}>Playing: {gameId}</h2>
              <p style={{ marginTop: '1rem', color: '#b8a88a' }}>Game not yet implemented.</p>
            </div>
          );
        }
        return (
          <>
            <div className="gameMainArea">
              <GameComponent
                gameState={tournament.gameState?.state}
                nicknames={tournament.gameState?.nicknames || {}}
                avatars={tournament.gameState?.avatars || {}}
                onAction={tournament.sendAction}
              />
            </div>
            <div className="petFixedSidebar"><PetWithStream screen="playing" /></div>
          </>
        );
      })()}
      {screen === 'loadingGame' && (
        <div style={{ minHeight: '100vh', width: '100%', background: 'var(--felt-dark, #0f3d1a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--gold, #d4a843)', fontFamily: 'Georgia', fontSize: '1.3rem' }}>Starting game...</p>
        </div>
      )}
      {screen === 'waiting' && (
        <div style={{ minHeight: '100vh', width: '100%', background: 'var(--felt-dark, #0f3d1a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--gold, #d4a843)', fontFamily: 'Georgia', fontSize: '1.3rem' }}>Loading next round...</p>
        </div>
      )}
      {screen === 'roundResults' && (
        <RoundResults
          roundResults={tournament.roundResults}
          onContinue={handleContinueAfterResults}
        />
      )}
      {screen === 'tournamentEnd' && (
        <TournamentEnd
          data={tournament.tournamentEnd}
          onRematch={() => setScreen('waitingRoom')}
          onLeave={handleLeave}
        />
      )}
      {['gameVote', 'wagerPhase', 'playing'].includes(screen) && <EmoteOverlay />}
      {screen !== 'menu' && <SettingsGear />}
      {screen === 'playing' && <TurnOverlay isMyTurn={tournament.gameState?.state?.isMyTurn} />}
      {showConfetti && <ConfettiOverlay />}
      {['playing', 'gameVote', 'wagerPhase'].includes(screen) && <StockTicker />}
    </>
  );
}

function App() {
  return (
    <SocketProvider>
      <SoundProvider>
        <ThemeProvider>
          <PetProvider>
            <GameRouter />
          </PetProvider>
        </ThemeProvider>
      </SoundProvider>
    </SocketProvider>
  );
}

export default App;
// force rebuild Fri Apr  3 07:15:03 EDT 2026
