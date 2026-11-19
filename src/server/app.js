const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
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
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static Assets (Dashboard UI)
  const rootPublicDir = path.join(__dirname, '..', '..', 'public');
  const srcPublicDir = path.join(__dirname, '..', 'public');
  const publicDir = fs.existsSync(rootPublicDir) ? rootPublicDir : srcPublicDir;

  // Professional Clean URLs
  app.get('/login', (req, res) => {
    res.sendFile(path.join(publicDir, 'login.html'));
  });

  app.get('/access-denied', (req, res) => {
    res.sendFile(path.join(publicDir, 'access-denied.html'));
  });

  app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Redirect legacy .html to clean URLs
  app.get('/login.html', (req, res) => {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    res.redirect(301, `/login${query}`);
  });

  app.get('/access-denied.html', (req, res) => {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    res.redirect(301, `/access-denied${query}`);
  });

  app.get('/index.html', (req, res) => {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    res.redirect(301, `/${query}`);
  });

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
