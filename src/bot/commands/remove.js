const { SlashCommandBuilder } = require('discord.js');
const db = require('../../storage/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a user from this ticket channel')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to remove from this ticket')
        .setRequired(true)
    ),

  async execute(interaction) {
    const ticket = await db.getTicketByChannelId(interaction.channel.id);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        content: '❌ This channel is not an active ticket.',
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('user');

    if (targetUser.id === ticket.userId) {
      return interaction.reply({
        content: '❌ You cannot remove the ticket creator from their own ticket.',
        ephemeral: true
      });
    }

    try {
      await interaction.channel.permissionOverwrites.delete(targetUser.id);
      await interaction.reply({
        content: `✅ Successfully removed <@${targetUser.id}> from this ticket.`,
        ephemeral: false
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Failed to remove user: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
