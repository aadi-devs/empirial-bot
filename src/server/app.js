const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { router: authRouter, authMiddleware } = require('./routes/auth');
const createApiRouter = require('./routes/api');

function createServer(discordClient) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Interactions Webhook for Vercel Serverless Discord Bot
  const interactionsRouter = require('./routes/interactions');
  app.use('/api/interactions', interactionsRouter);

  // Middlewares
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static Assets (Dashboard UI)
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // Serve saved transcripts directly for viewer
  const transcriptsDir = path.join(__dirname, '..', '..', 'data', 'transcripts');
  app.use('/raw-transcripts', express.static(transcriptsDir));

  // Auth Routes
  app.use('/api/auth', authRouter);

  // API Routes (with client and io)
  const apiRouter = createApiRouter(discordClient, io);
  app.use('/api', apiRouter);

  // Fallback to index.html for dashboard SPA routes
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/raw-transcripts')) {
      return next();
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Socket.IO Events
  io.on('connection', (socket) => {
    console.log(`[WebSocket] Dashboard client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      // client disconnected
    });
  });

  return { app, server, io };
}

module.exports = {
  createServer
};
