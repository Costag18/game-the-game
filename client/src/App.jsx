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
import './assets/styles/theme.css';
import './assets/styles/global.css';

function GameRouter() {
  const { socket } = useSocketContext();
  const [screen, setScreen] = useState('menu');
  const [currentLobby, setCurrentLobby] = useState(null);
  const tournament = useTournament();

  useEffect(() => {
    if (!socket) return;
    socket.on(EVENTS.ROUND_START, () => setScreen('gameVote'));
    socket.on(EVENTS.VOTE_RESULT, () => setScreen('wagerPhase'));
    socket.on(EVENTS.WAGER_LOCKED, () => setScreen('playing'));
    socket.on(EVENTS.ROUND_RESULTS, () => setScreen('roundResults'));
    socket.on(EVENTS.TOURNAMENT_END, () => setScreen('tournamentEnd'));
    return () => {
      socket.off(EVENTS.ROUND_START);
      socket.off(EVENTS.VOTE_RESULT);
      socket.off(EVENTS.WAGER_LOCKED);
      socket.off(EVENTS.ROUND_RESULTS);
      socket.off(EVENTS.TOURNAMENT_END);
    };
  }, [socket]);

  function handleJoinLobby(lobby) {
    setCurrentLobby(lobby);
    setScreen('waitingRoom');
  }

  function handleContinueAfterResults() {
    tournament.clearRoundResults();
    // Server will emit ROUND_START for next round or TOURNAMENT_END
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
      {screen === 'playing' && (
        <div style={{ color: 'white', textAlign: 'center', paddingTop: '4rem', background: '#0f3d1a', minHeight: '100vh' }}>
          <h2 style={{ fontFamily: 'Georgia', color: '#d4a843' }}>Playing: {tournament.voteResult?.selectedGame}</h2>
          <p style={{ marginTop: '1rem', color: '#b8a88a' }}>Game UI will render here once game engines are implemented.</p>
          <p style={{ marginTop: '0.5rem', color: '#b8a88a' }}>Unimplemented games resolve with random placements.</p>
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
