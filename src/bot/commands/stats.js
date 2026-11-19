const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../storage/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Display overall ticket statistics and activity for Empirial'),

  async execute(interaction) {
    const stats = db.getStats();

    const embed = new EmbedBuilder()
      .setColor('#7c3aed')
      .setTitle('📊 Empirial Ticket Statistics')
      .addFields(
        { name: '📂 Total Tickets', value: `${stats.total}`, inline: true },
        { name: '🟢 Open Tickets', value: `${stats.open}`, inline: true },
        { name: '📌 Claimed Tickets', value: `${stats.claimed}`, inline: true },
        { name: '🔒 Closed Tickets', value: `${stats.closed}`, inline: true },
        { name: '⚡ Active Tickets', value: `${stats.active}`, inline: true },
        { name: '🖥️ Web Dashboard', value: '[Localhost Dashboard](http://localhost:3000)', inline: true }
      )
      .setFooter({ text: 'Empirial Ticket System' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
