import { useState } from 'react';
import './assets/styles/global.css';

function App() {
  const [screen, setScreen] = useState('menu');
  return (
    <div className="app">
      <h1>Game The Game</h1>
      <p>Screen: {screen}</p>
    </div>
  );
}

export default App;
