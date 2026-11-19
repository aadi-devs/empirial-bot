require('dotenv').config();
const { createDiscordClient } = require('./bot/client');
const { createServer } = require('./server/app');

// Validate critical environment variables
const token = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID || '1572574664063193179';
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'empirial123';

if (!token) {
  console.error('❌ FATAL: BOT_TOKEN is missing in .env file!');
  process.exit(1);
}

// 1. Initialize Discord Client
const tempIo = { emit: () => {} }; // placeholder before server starts
const discordClient = createDiscordClient(tempIo);

// 2. Initialize Web Backend & WebSockets
const { app, server, io } = createServer(discordClient);

// Re-bind io to discord client handlers
const { setSocketIO } = require('./bot/handlers/ticketManager');
setSocketIO(io);

// 3. Start Web Server
server.listen(port, () => {
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;

  console.log(`\n=============================================================`);
  console.log(`👑 EMPIRIAL UNIFIED TICKET BOT & WEB BACKEND`);
  console.log(`=============================================================`);
  console.log(`🌐 Local Web Dashboard: http://localhost:${port}`);
  console.log(`🔑 Web Admin Password:  ${adminPassword}`);
  console.log(`🤖 Bot Client ID:       ${clientId}`);
  console.log(`🔗 Bot Server Invite:   ${inviteUrl}`);
  console.log(`=============================================================\n`);
});

// 4. Start Discord Bot
console.log('[Bot] Connecting to Discord Gateway...');
discordClient.login(token).catch(err => {
  console.error('❌ Failed to login to Discord:', err.message);
  if (err.message.includes('disallowed intents')) {
    console.error('⚠️ Note: Privileged intents might be disabled in Discord Developer Portal.');
  }
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n[System] Gracefully shutting down Empirial bot & server...');
  discordClient.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[System] Unhandled Rejection:', reason);
});
