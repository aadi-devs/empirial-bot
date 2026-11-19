const { ActivityType, Events } = require('discord.js');
const { registerCommands } = require('../deployCommands');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`\n======================================================`);
    console.log(`👑 EMPIRIAL DISCORD TICKET BOT ONLINE`);
    console.log(`Logged in as: ${client.user.tag} (ID: ${client.user.id})`);
    console.log(`Guilds connected: ${client.guilds.cache.size}`);
    console.log(`======================================================\n`);

    // Set rich presence
    client.user.setPresence({
      activities: [{ name: 'Empirial Tickets | /ticket-panel', type: ActivityType.Watching }],
      status: 'online'
    });

    // Deploy slash commands immediately to all existing guilds for instant access
    for (const [guildId, guild] of client.guilds.cache) {
      console.log(`[Ready] Deploying commands to: ${guild.name} (${guildId})`);
      await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID, guildId);
    }

    // Also register globally
    await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID);
  }
};
