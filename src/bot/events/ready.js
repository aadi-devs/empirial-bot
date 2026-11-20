const { ActivityType, Events } = require('discord.js');
const { registerCommands } = require('../deployCommands');

async function applyCustomNameStyle(guildId) {
  if (!guildId || !process.env.BOT_TOKEN) return;
  try {
    const payload = {
      nick: 'EMPIRIAL',
      display_name_font_id: 8,       // 8Bit
      display_name_effect_id: 3,     // Neon
      display_name_colors: [16711680] // Red
    };
    await fetch(`https://discord.com/api/v9/guilds/${guildId}/members/@me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${process.env.BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('[Ready] Error applying name style:', err);
  }
}

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
      activities: [{ name: 'custom', type: ActivityType.Custom, state: '◈ EMPIRIAL ━ Made by Victus' }],
      status: 'online'
    });

    // Deploy slash commands immediately to all existing guilds for instant access
    for (const [guildId, guild] of client.guilds.cache) {
      console.log(`[Ready] Deploying commands to: ${guild.name} (${guildId})`);
      await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID, guildId);
      await applyCustomNameStyle(guildId);
    }

    // Also register globally
    await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID);
  }
};
