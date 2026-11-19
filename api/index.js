require('dotenv').config();
const { createDiscordClient } = require('../src/bot/client');
const { createServer } = require('../src/server/app');

let appInstance = null;

module.exports = (req, res) => {
  if (!appInstance) {
    const discordClient = createDiscordClient();
    if (process.env.BOT_TOKEN) {
      discordClient.login(process.env.BOT_TOKEN).catch(() => {});
    }
    const { app } = createServer(discordClient);
    appInstance = app;
  }
  return appInstance(req, res);
};
