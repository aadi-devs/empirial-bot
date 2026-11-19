const express = require('express');
const router = express.Router();

// Simple in-memory session token store
const activeTokens = new Set();

function authMiddleware(req, res, next) {
  const token = req.headers['authorization'] || req.cookies?.token;
  if (!token || !activeTokens.has(token.replace('Bearer ', ''))) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  next();
}

router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'empirial123';

  if (!password || password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid password. Check ADMIN_PASSWORD in your .env file.' });
  }

  // Generate simple token
  const token = 'empirial_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  activeTokens.add(token);

  return res.json({
    success: true,
    token,
    message: 'Authenticated successfully'
  });
});

router.get('/status', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token && activeTokens.has(token)) {
    return res.json({ authenticated: true });
  }
  return res.json({ authenticated: false });
});

router.post('/logout', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    activeTokens.delete(token);
  }
  return res.json({ success: true });
});

module.exports = {
  router,
  authMiddleware
};
