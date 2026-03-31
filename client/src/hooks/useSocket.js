import { useEffect, useCallback } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';

export function useSocket(eventName, handler) {
  const { socket } = useSocketContext();
  useEffect(() => {
    if (!socket) return;
    socket.on(eventName, handler);
    return () => socket.off(eventName, handler);
  }, [socket, eventName, handler]);
}

export function useEmit() {
  const { socket } = useSocketContext();
  return useCallback(
    (eventName, data) => { if (socket) socket.emit(eventName, data); },
    [socket]
  );
}
