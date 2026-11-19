const { SlashCommandBuilder } = require('discord.js');
const db = require('../../storage/db');
const { claimTicket } = require('../handlers/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim this ticket as the active staff handler'),

  async execute(interaction) {
    const ticket = db.getTicketByChannelId(interaction.channel.id);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        content: '❌ This channel is not an active ticket.',
        ephemeral: true
      });
    }

    try {
      await claimTicket({
        channel: interaction.channel,
        staffUser: interaction.user
      });

      await interaction.reply({
        content: `✅ Ticket successfully claimed by <@${interaction.user.id}>!`,
        ephemeral: false
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ ${err.message}`,
        ephemeral: true
      });
    }
  }
};
