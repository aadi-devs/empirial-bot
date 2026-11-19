const { SlashCommandBuilder } = require('discord.js');
const db = require('../../storage/db');
const { generateTranscript } = require('../handlers/transcriptManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('Generate and download an instant HTML transcript of this ticket'),

  async execute(interaction) {
    const ticket = db.getTicketByChannelId(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({
        content: '❌ This command can only be used inside a ticket channel.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      const result = await generateTranscript(ticket, interaction.channel, interaction.user);

      await interaction.editReply({
        content: `📜 **Instant Transcript Generated** for **${ticket.id.toUpperCase()}** (${result.messagesCount} messages):`,
        files: [result.attachment]
      });
    } catch (err) {
      console.error('[Command transcript]', err);
      await interaction.editReply({
        content: `❌ Failed to generate transcript: ${err.message}`
      });
    }
  }
};
