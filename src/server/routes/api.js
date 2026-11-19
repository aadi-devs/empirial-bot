const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../../storage/db');
const { closeTicket } = require('../../bot/handlers/ticketManager');
const { authMiddleware } = require('./auth');
const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

module.exports = function(client, io) {
  // Public Stats Endpoint (Real Supabase Counts Only)
  router.get('/stats', async (req, res) => {
    try {
      const stats = await db.getStats();
      const botOnline = client && client.isReady ? client.isReady() : false;
      const guildsCount = client && client.guilds && client.guilds.cache ? client.guilds.cache.size : 0;
      const ping = client && client.ws && client.ws.ping > 0 ? client.ws.ping : 0;
      const uptime = client && client.uptime ? Math.floor(client.uptime / 1000) : 0;

      res.json({
        tickets: stats,
        bot: {
          online: botOnline,
          username: client && client.user ? client.user.tag : 'Empirial',
          avatar: client && client.user ? client.user.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png',
          guilds: guildsCount,
          ping,
          uptime,
          clientId: process.env.CLIENT_ID || '1572574664063193179'
        }
      });
    } catch (err) {
      console.error('[API /stats]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get Guild Channels and Roles for Dashboard Configuration Dropdowns
  router.get('/guild-data', authMiddleware, async (req, res) => {
    try {
      if (!client || !client.isReady || !client.isReady() || client.guilds.cache.size === 0) {
        return res.json({
          hasGuilds: false,
          guilds: [],
          message: 'Bot is not yet in any Discord servers. Please invite the bot first!'
        });
      }

      const guildsData = client.guilds.cache.map(guild => {
        const textChannels = guild.channels.cache
          .filter(c => c.type === ChannelType.GuildText)
          .map(c => ({ id: c.id, name: c.name }));

        const categories = guild.channels.cache
          .filter(c => c.type === ChannelType.GuildCategory)
          .map(c => ({ id: c.id, name: c.name }));

        const roles = guild.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

        return {
          id: guild.id,
          name: guild.name,
          icon: guild.iconURL(),
          channels: textChannels,
          categories,
          roles
        };
      });

      res.json({
        hasGuilds: true,
        guilds: guildsData
      });
    } catch (err) {
      console.error('[API /guild-data]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get All Tickets (From Supabase Database)
  router.get('/tickets', authMiddleware, async (req, res) => {
    try {
      const { status, search } = req.query;
      let tickets = await db.getTickets();

      if (status && status !== 'all') {
        tickets = tickets.filter(t => t.status === status);
      }

      if (search) {
        const q = search.toLowerCase();
        tickets = tickets.filter(t =>
          (t.id && t.id.toLowerCase().includes(q)) ||
          (t.userTag && t.userTag.toLowerCase().includes(q)) ||
          (t.subject && t.subject.toLowerCase().includes(q)) ||
          (t.category && t.category.toLowerCase().includes(q))
        );
      }

      res.json(tickets);
    } catch (err) {
      console.error('[API /tickets]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get Single Ticket by ID
  router.get('/tickets/:id', authMiddleware, async (req, res) => {
    try {
      const ticket = await db.getTicketById(req.params.id);
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }
      res.json(ticket);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sync Slash Commands
  router.post('/sync-commands', authMiddleware, async (req, res) => {
    try {
      const { registerCommands } = require('../../bot/deployCommands');
      const token = process.env.BOT_TOKEN;
      const clientId = process.env.CLIENT_ID || '1572574664063193179';

      if (client && client.guilds && client.guilds.cache) {
        for (const [guildId] of client.guilds.cache) {
          await registerCommands(token, clientId, guildId);
        }
      }
      await registerCommands(token, clientId);

      res.json({ success: true, message: 'All slash commands deployed to Discord successfully!' });
    } catch (err) {
      console.error('[API /sync-commands]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Claim Ticket via Web Dashboard
  router.post('/tickets/:id/claim', authMiddleware, async (req, res) => {
    try {
      const ticket = await db.getTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
      if (ticket.status === 'closed') return res.status(400).json({ error: 'Cannot claim a closed ticket' });

      const staffTag = req.user ? (req.user.username + (req.user.discriminator && req.user.discriminator !== '0' ? '#' + req.user.discriminator : '')) : (req.body.staffTag || 'Empirial Staff');
      const staffId = req.user ? req.user.user_id : 'web-staff';
      const avatarUrl = req.user && req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.user_id}/${req.user.avatar}.png` : null;

      const updated = await db.updateTicket(ticket.id, {
        status: 'claimed',
        claimedBy: {
          id: staffId,
          tag: staffTag,
          avatar: avatarUrl
        }
      });

      if (io) io.emit('ticket:updated', updated);
      res.json({ success: true, ticket: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Close Ticket via Web Dashboard
  router.post('/tickets/:id/close', authMiddleware, async (req, res) => {
    try {
      const ticket = await db.getTicketById(req.params.id);
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      if (ticket.status === 'closed') {
        return res.status(400).json({ error: 'Ticket is already closed' });
      }

      const closedByUser = {
        id: req.user ? req.user.user_id : 'web-admin',
        tag: req.user ? req.user.username : 'Web Dashboard Admin',
        username: req.user ? req.user.username : 'Web Admin'
      };

      const channel = client && client.channels && client.channels.cache ? client.channels.cache.get(ticket.channelId) : null;

      if (!channel) {
        // Channel was deleted on Discord or bot is in serverless mode, mark closed in Supabase
        const updated = await db.updateTicket(ticket.id, {
          status: 'closed',
          closedAt: new Date().toISOString(),
          closedBy: closedByUser
        });
        if (io) io.emit('ticket:closed', updated);
        return res.json({ success: true, ticket: updated });
      }

      const result = await closeTicket({
        channel,
        closedByUser,
        reason: req.body.reason || 'Closed via Web Dashboard'
      });

      res.json({ success: true, ticket: result });
    } catch (err) {
      console.error('[API /tickets/:id/close]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Send Message into Ticket from Web Dashboard
  router.post('/tickets/:id/message', authMiddleware, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Message text cannot be empty' });
      }

      const ticket = await db.getTicketById(req.params.id);
      if (!ticket || ticket.status === 'closed') {
        return res.status(404).json({ error: 'Ticket not found or is closed' });
      }

      const authorName = req.user ? req.user.username : 'Empirial Staff';
      const authorAvatar = req.user && req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.user_id}/${req.user.avatar}.png` : (client && client.user ? client.user.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png');

      const channel = client && client.channels && client.channels.cache ? client.channels.cache.get(ticket.channelId) : null;
      if (channel) {
        const embed = new EmbedBuilder()
          .setColor('#7c3aed')
          .setAuthor({ name: `👑 ${authorName} (Empirial Staff)`, iconURL: authorAvatar })
          .setDescription(text.trim())
          .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
      }

      const msgData = {
        id: 'web-' + Date.now(),
        author: {
          id: req.user ? req.user.user_id : 'web-staff',
          username: authorName,
          tag: authorName + ' (Web)',
          avatar: authorAvatar,
          bot: false
        },
        content: text.trim(),
        createdAt: new Date().toISOString(),
        attachments: [],
        embeds: []
      };

      await db.appendMessageToTicket(ticket.channelId, msgData);

      if (io) {
        io.emit('ticket:message', {
          ticketId: ticket.id,
          channelId: ticket.channelId,
          message: msgData
        });
      }

      res.json({ success: true, message: msgData });
    } catch (err) {
      console.error('[API /tickets/:id/message]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // List All Transcripts (From Supabase Database)
  router.get('/transcripts', authMiddleware, async (req, res) => {
    try {
      const transcripts = await db.getTranscripts();
      res.json(transcripts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // View / Download Transcript HTML
  router.get('/transcripts/:filename', async (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const content = await db.getTranscriptContent(filename);
      if (content) {
        res.setHeader('Content-Type', 'text/html');
        return res.send(content);
      }

      // Fallback to local disk if present
      const localPath = path.join(db.TRANSCRIPTS_DIR, filename);
      if (fs.existsSync(localPath)) {
        return res.sendFile(localPath);
      }

      res.status(404).send('Transcript file not found');
    } catch (err) {
      res.status(500).send('Error retrieving transcript');
    }
  });

  // Get Config
  router.get('/config', authMiddleware, async (req, res) => {
    try {
      const config = await db.getConfig();
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update Config
  router.put('/config', authMiddleware, async (req, res) => {
    try {
      const updated = await db.updateConfig(req.body);
      if (io) io.emit('config:updated', updated);
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Deploy Ticket Panel to Channel from Web
  router.post('/panel/deploy', authMiddleware, async (req, res) => {
    try {
      const { channelId } = req.body;
      if (!channelId) {
        return res.status(400).json({ error: 'Please specify a target channel ID' });
      }

      if (!client || !client.isReady || !client.isReady()) {
        return res.status(503).json({ error: 'Bot Discord Gateway client is not connected to Discord right now.' });
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: 'Channel not found or bot does not have access' });
      }

      const config = await db.getConfig();
      const panel = config.panelConfig || {};

      const embed = new EmbedBuilder()
        .setColor(panel.color || '#7c3aed')
        .setTitle(panel.title || '👑 Empirial Support Tickets')
        .setDescription(panel.description || 'Welcome to the Empirial Support Center. Select a category below to create a private ticket.')
        .setFooter({ text: panel.footerText || 'Empirial Support System • Private & Secure' })
        .setTimestamp();

      if (panel.bannerUrl && panel.bannerUrl.startsWith('http')) {
        embed.setImage(panel.bannerUrl);
      }

      const categories = config.categories || [];
      const selectOptions = categories.map(cat =>
        new StringSelectMenuOptionBuilder()
          .setLabel(cat.label)
          .setValue(`ticket_cat_${cat.id}`)
          .setDescription(cat.description || `Open a ${cat.label} ticket`)
          .setEmoji(cat.emoji || '🎫')
      );

      const rows = [];
      if (selectOptions.length > 0) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('ticket_select_category')
          .setPlaceholder('📂 Select Ticket Category...')
          .addOptions(selectOptions);

        rows.push(new ActionRowBuilder().addComponents(selectMenu));
      }

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_create_btn')
          .setLabel(panel.buttonText || 'Open Ticket')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Success)
      );
      rows.push(buttonRow);

      await channel.send({
        embeds: [embed],
        components: rows
      });

      await db.updateConfig({ panelChannelId: channel.id });

      res.json({ success: true, message: `Ticket panel deployed to #${channel.name}` });
    } catch (err) {
      console.error('[API /panel/deploy]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ========================================================
  // DISCOHOOK V2 CUSTOM EMBED BUILDER DISPATCH ENDPOINT
  // ========================================================
  router.post('/builder/send', authMiddleware, async (req, res) => {
    try {
      const { channelId, message } = req.body;
      if (!channelId) {
        return res.status(400).json({ error: 'Please choose a target Discord channel' });
      }

      if (!message) {
        return res.status(400).json({ error: 'Message payload is empty' });
      }

      if (!client || !client.isReady || !client.isReady()) {
        return res.status(503).json({ error: 'Discord Bot gateway client is currently offline or reconnecting.' });
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: 'Channel not found or bot lacks permissions to view and send in this channel.' });
      }

      // Build Discord.js Embeds from Containers
      const embeds = [];
      const containers = Array.isArray(message.containers) ? message.containers : [];

      for (const container of containers) {
        const embed = new EmbedBuilder();
        
        // Color
        if (container.sidebarColor) {
          try {
            embed.setColor(container.sidebarColor);
          } catch (_) {
            embed.setColor('#58b9ff');
          }
        } else {
          embed.setColor('#58b9ff');
        }

        // Texts inside container
        const texts = Array.isArray(container.texts) ? container.texts : [];
        const textParts = [];

        for (const t of texts) {
          if (t && t.content && t.content.trim()) {
            textParts.push(t.content.trim());
          }
          // Check for thumbnail accessory
          if (t && t.accessory && t.accessory.type === 'thumbnail' && t.accessory.url) {
            try {
              embed.setThumbnail(t.accessory.url);
            } catch (_) {}
          }
        }

        let description = textParts.join('\n\n');
        if (container.spoiler && description) {
          description = `||${description}||`;
        }

        if (description) {
          embed.setDescription(description);
          embeds.push(embed);
        }
      }

      // Build Action Rows and Buttons
      const actionRows = [];
      const rows = Array.isArray(message.rows) ? message.rows : [];

      for (const r of rows) {
        const components = Array.isArray(r.components) ? r.components : [];
        if (components.length === 0) continue;

        const actionRow = new ActionRowBuilder();
        let addedCount = 0;

        for (const comp of components) {
          if (addedCount >= 5) break; // Discord allows max 5 buttons per ActionRow
          const btn = new ButtonBuilder();
          
          btn.setLabel(comp.label ? comp.label.substring(0, 80) : 'Action');
          
          if (comp.emoji && comp.emoji.trim()) {
            try {
              btn.setEmoji(comp.emoji.trim());
            } catch (_) {}
          }

          if (comp.disabled) {
            btn.setDisabled(true);
          }

          if (comp.type === 'link_button' || comp.style === 'link' || (comp.url && comp.url.startsWith('http'))) {
            btn.setStyle(ButtonStyle.Link);
            btn.setURL(comp.url || 'https://discord.com');
          } else {
            const styleMap = {
              primary: ButtonStyle.Primary,
              secondary: ButtonStyle.Secondary,
              success: ButtonStyle.Success,
              danger: ButtonStyle.Danger
            };
            btn.setStyle(styleMap[comp.style] || ButtonStyle.Primary);
            btn.setCustomId(comp.customId || `builder_btn_${Date.now()}_${Math.random().toString(36).substring(7)}`);
          }

          actionRow.addComponents(btn);
          addedCount++;
        }

        if (addedCount > 0) {
          actionRows.push(actionRow);
        }
      }

      const mainContent = (message.content && message.content.trim()) ? message.content.trim() : null;

      if (!mainContent && embeds.length === 0 && actionRows.length === 0) {
        return res.status(400).json({ error: 'Cannot send an empty message. Please add content, a container, or buttons.' });
      }

      const profile = message.profile || {};
      let sentMsg = null;

      // Try sending with Webhook if custom profile name/avatar was set
      if ((profile.username || profile.avatarUrl) && channel.createWebhook) {
        try {
          const webhook = await channel.createWebhook({
            name: (profile.username || 'Empirial').substring(0, 32),
            avatar: profile.avatarUrl || undefined
          });

          sentMsg = await webhook.send({
            content: mainContent || undefined,
            embeds: embeds.length > 0 ? embeds : undefined,
            components: actionRows.length > 0 ? actionRows : undefined
          });

          // Clean up webhook after short delay
          setTimeout(() => webhook.delete().catch(() => {}), 15000);
        } catch (webhookErr) {
          console.warn('[Builder] Webhook creation failed, falling back to bot channel.send:', webhookErr.message);
        }
      }

      // Default fallback: send directly through bot client
      if (!sentMsg) {
        sentMsg = await channel.send({
          content: mainContent || undefined,
          embeds: embeds.length > 0 ? embeds : undefined,
          components: actionRows.length > 0 ? actionRows : undefined
        });
      }

      const messageUrl = `https://discord.com/channels/${channel.guildId || '@me'}/${channel.id}/${sentMsg.id}`;

      res.json({
        success: true,
        messageId: sentMsg.id,
        channelId: channel.id,
        channelName: channel.name,
        url: messageUrl
      });
    } catch (err) {
      console.error('[API /builder/send]', err);
      res.status(500).json({ error: err.message || 'Failed to dispatch message to Discord' });
    }
  });

  return router;
};
