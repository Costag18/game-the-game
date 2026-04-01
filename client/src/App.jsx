import { useState, useEffect } from 'react';
import { SocketProvider, useSocketContext } from './context/SocketContext.jsx';
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
};

function GameRouter() {
  const { socket } = useSocketContext();
  const [screen, setScreen] = useState('menu');
  const [currentLobby, setCurrentLobby] = useState(null);
  const tournament = useTournament();

  useEffect(() => {
    if (!socket) return;
    socket.on(EVENTS.ROUND_START, () => setScreen('gameVote'));
    socket.on(EVENTS.VOTE_RESULT, () => setScreen('wagerPhase'));
    socket.on(EVENTS.WAGER_LOCKED, () => setScreen('loadingGame'));
    socket.on(EVENTS.GAME_STATE, () => setScreen((prev) => prev === 'loadingGame' ? 'playing' : prev));
    socket.on(EVENTS.ROUND_RESULTS, () => setScreen('roundResults'));
    socket.on(EVENTS.TOURNAMENT_END, () => setScreen('tournamentEnd'));
    return () => {
      socket.off(EVENTS.ROUND_START);
      socket.off(EVENTS.VOTE_RESULT);
      socket.off(EVENTS.WAGER_LOCKED);
      socket.off(EVENTS.GAME_STATE);
      socket.off(EVENTS.ROUND_RESULTS);
      socket.off(EVENTS.TOURNAMENT_END);
    };
  }, [socket]);

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
      {screen === 'lobbyBrowser' && (
        <LobbyBrowser onNavigate={setScreen} onJoinLobby={handleJoinLobby} />
      )}
      {screen === 'createLobby' && (
        <CreateLobby onNavigate={setScreen} onJoinLobby={handleJoinLobby} />
      )}
      {screen === 'waitingRoom' && currentLobby && (
        <WaitingRoom lobby={currentLobby} onNavigate={setScreen} />
      )}
      {screen === 'gameVote' && (
        <GameVote
          eligibleGames={tournament.eligibleGames}
          tournamentState={tournament.tournamentState}
          nicknames={currentLobby?.nicknames || tournament.gameState?.nicknames || {}}
          onVote={tournament.vote}
        />
      )}
      {screen === 'wagerPhase' && (
        <WagerPhase
          tournamentState={tournament.tournamentState}
          voteResult={tournament.voteResult}
          onSubmitWager={tournament.submitWager}
        />
      )}
      {screen === 'playing' && (() => {
        const gameId = tournament.voteResult?.selectedGame;
        const GameComponent = GAME_COMPONENTS[gameId];
        if (!GameComponent) {
          return (
            <div style={{ color: 'white', textAlign: 'center', paddingTop: '4rem', background: '#0f3d1a', minHeight: '100vh' }}>
              <h2 style={{ fontFamily: 'Georgia', color: '#d4a843' }}>Playing: {gameId}</h2>
              <p style={{ marginTop: '1rem', color: '#b8a88a' }}>Game not yet implemented.</p>
            </div>
          );
        }
        return (
          <GameComponent
            gameState={tournament.gameState?.state}
            nicknames={tournament.gameState?.nicknames || {}}
            onAction={tournament.sendAction}
          />
        );
      })()}
      {screen === 'loadingGame' && (
        <div style={{ minHeight: '100vh', background: 'var(--felt-dark, #0f3d1a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--gold, #d4a843)', fontFamily: 'Georgia', fontSize: '1.3rem' }}>Starting game...</p>
        </div>
      )}
      {screen === 'waiting' && (
        <div style={{ minHeight: '100vh', background: 'var(--felt-dark, #0f3d1a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
    </>
  );
}

function App() {
  return (
    <SocketProvider>
      <GameRouter />
    </SocketProvider>
  );
}

export default App;
