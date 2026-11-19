const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../storage/db');
const { closeTicket } = require('../handlers/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close the current ticket channel and archive transcript')
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for closing this ticket')
        .setRequired(false)
    ),

  async execute(interaction) {
    const ticket = db.getTicketByChannelId(interaction.channel.id);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        content: '❌ This channel is not an active ticket.',
        ephemeral: true
      });
    }

    const reason = interaction.options.getString('reason') || 'No reason specified';

    await interaction.reply({
      content: '🔒 Closing ticket and preparing transcript...',
      ephemeral: false
    });

    try {
      await closeTicket({
        channel: interaction.channel,
        closedByUser: interaction.user,
        reason
      });
    } catch (err) {
      console.error('[Command close]', err);
      await interaction.followUp({
        content: `❌ Error closing ticket: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
