const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { setSocketIO } = require('./handlers/ticketManager');

function createDiscordClient(io = null) {
  if (io) {
    setSocketIO(io);
  }

  // Determine intents (standard intents that don't crash on unverified bots)
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ];

  // Optional: Add MessageContent if specified in environment
  if (process.env.ENABLE_MESSAGE_CONTENT === 'true') {
    intents.push(GatewayIntentBits.MessageContent);
  }

  const client = new Client({ intents });
  client.commands = new Collection();

  // Load commands
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    }
  }

  // Load events
  const eventsPath = path.join(__dirname, 'events');
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client, io));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client, io));
    }
  }

  return client;
}

module.exports = {
  createDiscordClient
};
