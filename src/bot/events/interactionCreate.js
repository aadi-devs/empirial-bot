const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const db = require('../../storage/db');
const {
  createTicketChannel,
  closeTicket,
  claimTicket
} = require('../handlers/ticketManager');
const { generateTranscript } = require('../handlers/transcriptManager');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      // 1. Handle Slash Commands
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        await command.execute(interaction);
        return;
      }

      // 2. Handle Button Clicks
      if (interaction.isButton()) {
        const customId = interaction.customId;

        // Open Ticket Button -> Show Modal
        if (customId === 'ticket_create_btn') {
          return showTicketModal(interaction, 'general');
        }

        // Close Confirm Prompt
        if (customId === 'ticket_close_confirm') {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('ticket_close_execute')
              .setLabel('Yes, Close Ticket')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('🗑️'),
            new ButtonBuilder()
              .setCustomId('ticket_close_cancel')
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
          );

          return interaction.reply({
            content: '⚠️ **Are you sure you want to close this ticket?** A transcript will be archived and this channel deleted.',
            components: [row],
            ephemeral: true
          });
        }

        // Cancel Close
        if (customId === 'ticket_close_cancel') {
          return interaction.update({
            content: '❎ Ticket closure cancelled.',
            components: []
          });
        }

        // Execute Close
        if (customId === 'ticket_close_execute') {
          await interaction.update({
            content: '🔒 Processing ticket closure...',
            components: []
          });

          await closeTicket({
            channel: interaction.channel,
            closedByUser: interaction.user,
            reason: 'Closed via interactive button'
          });
          return;
        }

        // Claim Ticket
        if (customId === 'ticket_claim') {
          try {
            await claimTicket({
              channel: interaction.channel,
              staffUser: interaction.user
            });

            return interaction.reply({
              content: `✅ You have successfully claimed this ticket!`,
              ephemeral: true
            });
          } catch (err) {
            return interaction.reply({
              content: `❌ ${err.message}`,
              ephemeral: true
            });
          }
        }

        // Instant Transcript Button
        if (customId === 'ticket_transcript') {
          const ticket = db.getTicketByChannelId(interaction.channel.id);
          if (!ticket) {
            return interaction.reply({
              content: '❌ Could not find ticket record.',
              ephemeral: true
            });
          }

          await interaction.deferReply({ ephemeral: true });
          const result = await generateTranscript(ticket, interaction.channel, interaction.user);

          return interaction.editReply({
            content: `📜 Here is the current transcript for **${ticket.id.toUpperCase()}**:`,
            files: [result.attachment]
          });
        }
      }

      // 3. Handle Select Menu Category Selection
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket_select_category') {
          const selected = interaction.values[0];
          const categoryId = selected.replace('ticket_cat_', '');
          return showTicketModal(interaction, categoryId);
        }
      }

      // 4. Handle Modal Submissions
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('ticket_modal_')) {
          const categoryId = interaction.customId.replace('ticket_modal_', '');
          const subject = interaction.fields.getTextInputValue('ticket_subject') || 'General Support';
          const description = interaction.fields.getTextInputValue('ticket_description') || '';

          await interaction.deferReply({ ephemeral: true });

          try {
            const { channel, ticket } = await createTicketChannel({
              guild: interaction.guild,
              user: interaction.user,
              categoryId,
              subject,
              description
            });

            return interaction.editReply({
              content: `✅ Your ticket has been created! Please go to <#${channel.id}> to speak with our support team.`
            });
          } catch (err) {
            console.error('[TicketModalSubmit]', err);
            return interaction.editReply({
              content: `❌ Could not create ticket: ${err.message}`
            });
          }
        }
      }
    } catch (err) {
      console.error('[interactionCreate Error]', err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `❌ An unexpected error occurred: ${err.message}`, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: `❌ An unexpected error occurred: ${err.message}`, ephemeral: true }).catch(() => {});
      }
    }
  }
};

/**
 * Helper to display ticket creation modal
 */
async function showTicketModal(interaction, categoryId) {
  const config = db.getConfig();
  const cat = (config.categories || []).find(c => c.id === categoryId) || { label: 'Support' };

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${categoryId}`)
    .setTitle(`👑 ${cat.label} Ticket`);

  const subjectInput = new TextInputBuilder()
    .setCustomId('ticket_subject')
    .setLabel('Subject / Reason')
    .setPlaceholder('Briefly summarize what you need help with...')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('ticket_description')
    .setLabel('Details (Optional)')
    .setPlaceholder('Provide any extra context, account username, or explanation...')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(subjectInput),
    new ActionRowBuilder().addComponents(descriptionInput)
  );

  await interaction.showModal(modal);
}
