import { useState } from 'react';
import { SocketProvider } from './context/SocketContext.jsx';
import './assets/styles/theme.css';
import './assets/styles/global.css';

function App() {
  const [screen, setScreen] = useState('menu');
  return (
    <SocketProvider>
      <div className="app">
        <h1>Game The Game</h1>
        <p>Screen: {screen}</p>
      </div>
    </SocketProvider>
  );
}

export default App;
