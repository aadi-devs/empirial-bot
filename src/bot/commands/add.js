const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../storage/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add a user to this ticket channel')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to add to this ticket')
        .setRequired(true)
    ),

  async execute(interaction) {
    const ticket = db.getTicketByChannelId(interaction.channel.id);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        content: '❌ This channel is not an active ticket.',
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('user');

    try {
      await interaction.channel.permissionOverwrites.edit(targetUser.id, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true,
        EmbedLinks: true,
        ReadMessageHistory: true
      });

      await interaction.reply({
        content: `✅ Successfully added <@${targetUser.id}> to this ticket.`,
        ephemeral: false
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Failed to add user: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
