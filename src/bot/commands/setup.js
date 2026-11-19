const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../../storage/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure ticket system roles, channels, and categories')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(option =>
      option.setName('support-role')
        .setDescription('Role that has permission to view and respond to tickets')
        .setRequired(false)
    )
    .addChannelOption(option =>
      option.setName('logs-channel')
        .setDescription('Channel where closed ticket logs and transcripts are sent')
        .setRequired(false)
    )
    .addChannelOption(option =>
      option.setName('category')
        .setDescription('Category where new ticket channels will be created')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    ),

  async execute(interaction) {
    const supportRole = interaction.options.getRole('support-role');
    const logsChannel = interaction.options.getChannel('logs-channel');
    const category = interaction.options.getChannel('category');

    const updates = {};
    if (supportRole) updates.supportRoleId = supportRole.id;
    if (logsChannel) updates.logsChannelId = logsChannel.id;
    if (category) updates.ticketCategoryId = category.id;

    const newConfig = db.updateConfig(updates);

    const embed = new EmbedBuilder()
      .setColor('#10b981')
      .setTitle('⚙️ Empirial Ticket System Configuration')
      .setDescription('Ticket settings updated successfully!')
      .addFields(
        {
          name: '🛡️ Support Role',
          value: newConfig.supportRoleId ? `<@&${newConfig.supportRoleId}>` : '*Not Set (defaults to Server Admins)*',
          inline: true
        },
        {
          name: '📁 Logs Channel',
          value: newConfig.logsChannelId ? `<#${newConfig.logsChannelId}>` : '*Not Set*',
          inline: true
        },
        {
          name: '📂 Ticket Category',
          value: newConfig.ticketCategoryId ? `<#${newConfig.ticketCategoryId}>` : '*Auto-creates "🎫 EMPIRIAL TICKETS"*',
          inline: true
        }
      )
      .setFooter({ text: 'You can also manage settings via the Web Dashboard at http://localhost:3000' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
