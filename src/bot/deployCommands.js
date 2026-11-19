const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  }
}

async function registerCommands(token, clientId, guildId = null) {
  const rest = new REST().setToken(token);

  try {
    console.log(`[Commands] Deploying ${commands.length} application commands...`);

    if (guildId) {
      // Instant guild deployment
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`[Commands] Successfully registered commands to guild: ${guildId}`);
    } else {
      // Global deployment
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log(`[Commands] Successfully registered ${commands.length} global application commands.`);
    }
  } catch (error) {
    console.error('[Commands] Error deploying commands:', error);
  }
}

module.exports = {
  commands,
  registerCommands
};
