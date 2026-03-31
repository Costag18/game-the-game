import { useState } from 'react';
import { SocketProvider } from './context/SocketContext.jsx';
import MainMenu from './screens/MainMenu.jsx';
import LobbyBrowser from './screens/LobbyBrowser.jsx';
import CreateLobby from './screens/CreateLobby.jsx';
import WaitingRoom from './screens/WaitingRoom.jsx';
import './assets/styles/theme.css';
import './assets/styles/global.css';

function App() {
  const [screen, setScreen] = useState('menu');
  const [currentLobby, setCurrentLobby] = useState(null);

  function handleJoinLobby(lobby) {
    setCurrentLobby(lobby);
    setScreen('waitingRoom');
  }

  return (
    <SocketProvider>
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
    </SocketProvider>
  );
}

export default App;
