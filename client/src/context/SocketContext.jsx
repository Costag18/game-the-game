import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to same origin in production, localhost in dev
    const url = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;
    const newSocket = io(url, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));
    setSocket(newSocket);

    // Keep-alive: ping server every 2 min to prevent Render from sleeping
    const ping = () => fetch(`${url}/health`).catch(() => {});
    const keepAlive = setInterval(ping, 2 * 60 * 1000);

    // Also ping when tab becomes visible (browser throttles background intervals)
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);

    // Ping immediately on load
    ping();

    return () => {
      clearInterval(keepAlive);
      document.removeEventListener('visibilitychange', onVisible);
      newSocket.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocketContext() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocketContext must be inside SocketProvider');
  return ctx;
}
