import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { EVENTS } from '../../shared/events.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

io.on(EVENTS.CONNECTION, (socket) => {
  console.log(`Player connected: ${socket.id}`);
  socket.on(EVENTS.DISCONNECT, (reason) => {
    console.log(`Player disconnected: ${socket.id} (${reason})`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { io, app, httpServer };
