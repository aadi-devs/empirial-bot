const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const db = require('../../storage/db');
const { generateTranscript } = require('./transcriptManager');

// Reference to Socket.IO instance for real-time dashboard updates
let ioInstance = null;

function setSocketIO(io) {
  ioInstance = io;
}

function broadcastEvent(eventName, data) {
  if (ioInstance) {
    ioInstance.emit(eventName, data);
  }
}

/**
 * Ensures or creates the tickets parent category
 */
async function getOrCreateCategory(guild, config) {
  if (config.ticketCategoryId) {
    const existing = guild.channels.cache.get(config.ticketCategoryId);
    if (existing && existing.type === ChannelType.GuildCategory) {
      return existing;
    }
  }

  // Search if a "🎫 TICKETS" category already exists by name
  const found = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && (c.name.includes('TICKETS') || c.name.includes('Tickets'))
  );
  if (found) {
    db.updateConfig({ ticketCategoryId: found.id });
    return found;
  }

  // Otherwise create it
  try {
    const newCategory = await guild.channels.create({
      name: '🎫 EMPIRIAL TICKETS',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        }
      ]
    });
    db.updateConfig({ ticketCategoryId: newCategory.id });
    return newCategory;
  } catch (err) {
    console.error('[TicketManager] Failed to create category:', err);
    return null;
  }
}

/**
 * Creates a new ticket channel and records in database
 */
async function createTicketChannel({ guild, user, categoryId = 'general', subject = 'Support Request', description = '' }) {
  const config = db.getConfig();

  // Check ticket limit
  const openCount = db.countUserOpenTickets(user.id);
  const maxAllowed = config.maxOpenTicketsPerUser || 1;
  if (openCount >= maxAllowed) {
    throw new Error(`You already have ${openCount} open ticket(s). Maximum allowed is ${maxAllowed}. Please close your current ticket before opening another.`);
  }

  const category = await getOrCreateCategory(guild, config);
  const nextNumber = config.ticketCounter || 1;
  const channelName = `ticket-${String(nextNumber).padStart(4, '0')}`;

  // Build permission overwrites
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions
      ]
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  // Add support role if configured
  if (config.supportRoleId) {
    const supportRole = guild.roles.cache.get(config.supportRoleId);
    if (supportRole) {
      permissionOverwrites.push({
        id: supportRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AddReactions
        ]
      });
    }
  }

  // Create channel
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category ? category.id : null,
    topic: `Ticket by ${user.tag} (${user.id}) | Subject: ${subject}`,
    permissionOverwrites
  });

  // Category details
  const categoryMeta = (config.categories || []).find(c => c.id === categoryId) || {
    label: categoryId.toUpperCase(),
    emoji: '🎫'
  };

  // Save to database
  const ticketRecord = db.createTicket({
    channelId: channel.id,
    guildId: guild.id,
    userId: user.id,
    userTag: user.tag || user.username,
    userAvatar: user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null,
    category: `${categoryMeta.emoji} ${categoryMeta.label}`,
    subject,
    description
  });

  // Welcome Embed
  const welcomeEmbed = new EmbedBuilder()
    .setColor('#7c3aed')
    .setTitle(`👑 Empirial Support • ${ticketRecord.id.toUpperCase()}`)
    .setDescription(`Hello <@${user.id}>, welcome to your private support ticket!\n\nOur staff team has been notified and will assist you shortly. Please provide any relevant details, screenshots, or information while you wait.`)
    .addFields(
      { name: '👤 Opened By', value: `<@${user.id}> (${user.tag || user.username})`, inline: true },
      { name: '📂 Category', value: `${categoryMeta.emoji} ${categoryMeta.label}`, inline: true },
      { name: '📋 Subject', value: subject || 'General Support', inline: false }
    )
    .setFooter({ text: 'Empirial Ticket System • Use the buttons below to manage this ticket' })
    .setTimestamp();

  if (description) {
    welcomeEmbed.addFields({ name: '📝 Details', value: description, inline: false });
  }

  // Action Buttons
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_confirm')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel('Claim Ticket')
      .setEmoji('📌')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket_transcript')
      .setLabel('Transcript')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    content: `<@${user.id}>`,
    embeds: [welcomeEmbed],
    components: [actionRow]
  });

  // Broadcast to Web Dashboard
  broadcastEvent('ticket:created', ticketRecord);

  return { channel, ticket: ticketRecord };
}

/**
 * Closes the ticket, generates transcript, logs, and deletes channel
 */
async function closeTicket({ channel, closedByUser, reason = 'No reason provided' }) {
  const ticket = db.getTicketByChannelId(channel.id);
  if (!ticket) {
    throw new Error('This channel is not an active ticket in the database.');
  }

  // Generate transcript
  const transcriptResult = await generateTranscript(ticket, channel, closedByUser);

  // Update in database
  const updatedTicket = db.updateTicket(ticket.id, {
    status: 'closed',
    closedAt: new Date().toISOString(),
    closedBy: {
      id: closedByUser ? closedByUser.id : 'system',
      tag: closedByUser ? (closedByUser.tag || closedByUser.username) : 'System'
    },
    transcriptFile: transcriptResult.fileName
  });

  // Notify inside ticket channel
  const closingEmbed = new EmbedBuilder()
    .setColor('#ef4444')
    .setTitle('🔒 Ticket Closing')
    .setDescription(`This ticket has been marked as closed by <@${closedByUser.id}>.\n\n**Reason:** ${reason}\n\n*This channel will be deleted in 5 seconds. A full transcript has been saved.*`)
    .setFooter({ text: 'Empirial Ticket System' })
    .setTimestamp();

  await channel.send({ embeds: [closingEmbed] });

  // Post to Logs Channel if configured
  const config = db.getConfig();
  if (config.logsChannelId) {
    try {
      const logsChannel = channel.guild.channels.cache.get(config.logsChannelId);
      if (logsChannel && logsChannel.isTextBased()) {
        const logEmbed = new EmbedBuilder()
          .setColor('#7c3aed')
          .setTitle(`📁 Ticket Closed: ${ticket.id.toUpperCase()}`)
          .addFields(
            { name: '👤 Creator', value: `<@${ticket.userId}> (${ticket.userTag})`, inline: true },
            { name: '🔒 Closed By', value: `<@${closedByUser.id}> (${closedByUser.tag || closedByUser.username})`, inline: true },
            { name: '📂 Category', value: ticket.category || 'General', inline: true },
            { name: '📋 Subject', value: ticket.subject || 'Support', inline: false },
            { name: '📝 Reason', value: reason, inline: false },
            { name: '💬 Total Messages', value: String(transcriptResult.messagesCount), inline: true }
          )
          .setFooter({ text: 'Empirial Ticket Logs' })
          .setTimestamp();

        await logsChannel.send({
          embeds: [logEmbed],
          files: [transcriptResult.attachment]
        });
      }
    } catch (logErr) {
      console.error('[TicketManager] Failed to post to log channel:', logErr);
    }
  }

  // Attempt to DM creator the transcript
  try {
    const creatorUser = await channel.client.users.fetch(ticket.userId);
    if (creatorUser) {
      const dmEmbed = new EmbedBuilder()
        .setColor('#7c3aed')
        .setTitle(`👑 Empirial • Ticket ${ticket.id.toUpperCase()} Closed`)
        .setDescription(`Your support ticket on **${channel.guild.name}** has been closed.\n\n**Subject:** ${ticket.subject}\n**Closed By:** ${closedByUser.tag || closedByUser.username}\n**Reason:** ${reason}\n\nAttached below is your full ticket chat transcript for your records. Thank you for reaching out!`)
        .setFooter({ text: 'Empirial Support System' })
        .setTimestamp();

      await creatorUser.send({
        embeds: [dmEmbed],
        files: [transcriptResult.attachment]
      });
    }
  } catch (dmErr) {
    // DMs might be closed for the user
    console.log(`[TicketManager] Could not DM user ${ticket.userId} (DMs might be disabled)`);
  }

  // Broadcast to Web Dashboard
  broadcastEvent('ticket:closed', updatedTicket);

  // Delete channel after 5 seconds
  setTimeout(async () => {
    try {
      await channel.delete(`Ticket ${ticket.id} closed by ${closedByUser.tag || closedByUser.username}`);
    } catch (delErr) {
      console.error('[TicketManager] Could not delete channel:', delErr.message);
    }
  }, 5000);

  return updatedTicket;
}

/**
 * Claims a ticket by staff member
 */
async function claimTicket({ channel, staffUser }) {
  const ticket = db.getTicketByChannelId(channel.id);
  if (!ticket) {
    throw new Error('This channel is not an active ticket in the database.');
  }

  if (ticket.status === 'claimed' && ticket.claimedBy) {
    throw new Error(`This ticket is already claimed by <@${ticket.claimedBy.id}>!`);
  }

  const updatedTicket = db.updateTicket(ticket.id, {
    status: 'claimed',
    claimedBy: {
      id: staffUser.id,
      tag: staffUser.tag || staffUser.username,
      avatar: staffUser.displayAvatarURL ? staffUser.displayAvatarURL({ dynamic: true }) : null
    }
  });

  const claimEmbed = new EmbedBuilder()
    .setColor('#10b981')
    .setTitle('📌 Ticket Claimed')
    .setDescription(`This ticket has been claimed by <@${staffUser.id}>!\nThey will be handling your inquiry from now on.`)
    .setFooter({ text: 'Empirial Support' })
    .setTimestamp();

  await channel.send({ embeds: [claimEmbed] });

  // Broadcast to Web Dashboard
  broadcastEvent('ticket:updated', updatedTicket);

  return updatedTicket;
}

module.exports = {
  setSocketIO,
  getOrCreateCategory,
  createTicketChannel,
  closeTicket,
  claimTicket
};
