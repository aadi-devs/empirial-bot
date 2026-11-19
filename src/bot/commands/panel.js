const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const db = require('../../storage/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Deploy the interactive ticket creation panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Target channel to send the ticket panel to (defaults to current)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const config = await db.getConfig();
    const panel = config.panelConfig || {};

    const embed = new EmbedBuilder()
      .setColor(panel.color || '#7c3aed')
      .setTitle(panel.title || '👑 Empirial Support Tickets')
      .setDescription(panel.description || 'Welcome to the Empirial Support Center. Click the button below or choose a category to create a private ticket.')
      .setFooter({ text: panel.footerText || 'Empirial Support System • Private & Secure' })
      .setTimestamp();

    if (panel.bannerUrl && panel.bannerUrl.startsWith('http')) {
      embed.setImage(panel.bannerUrl);
    }

    // Build Category Select Menu
    const categories = config.categories || [];
    const selectOptions = categories.map(cat =>
      new StringSelectMenuOptionBuilder()
        .setLabel(cat.label)
        .setValue(`ticket_cat_${cat.id}`)
        .setDescription(cat.description || `Open a ${cat.label} ticket`)
        .setEmoji(cat.emoji || '🎫')
    );

    const rows = [];

    // Dropdown row
    if (selectOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_select_category')
        .setPlaceholder('📂 Select Ticket Category...')
        .addOptions(selectOptions);

      rows.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    // General button row
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_create_btn')
        .setLabel(panel.buttonText || 'Open Ticket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Success)
    );
    rows.push(buttonRow);

    await targetChannel.send({
      embeds: [embed],
      components: rows
    });

    // Update config with panel channel ID
    await db.updateConfig({ panelChannelId: targetChannel.id });

    await interaction.reply({
      content: `✅ Ticket panel successfully deployed to <#${targetChannel.id}>!`,
      ephemeral: true
    });
  }
};
