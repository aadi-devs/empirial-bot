const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot ping and response latency'),

  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPing = interaction.client.ws.ping;

    const embed = new EmbedBuilder()
      .setColor('#7c3aed')
      .setTitle('🏓 Pong!')
      .addFields(
        { name: 'Bot Latency', value: `${roundtrip}ms`, inline: true },
        { name: 'Discord Gateway', value: `${wsPing}ms`, inline: true }
      )
      .setFooter({ text: 'Empirial Ticket Bot' })
      .setTimestamp();

    await interaction.editReply({ content: null, embeds: [embed] });
  }
};
