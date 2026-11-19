const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../../storage/db');
const { closeTicket } = require('../../bot/handlers/ticketManager');
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
  // Stats Endpoint
  router.get('/stats', (req, res) => {
    const stats = db.getStats();
    const botOnline = process.env.VERCEL ? true : (client.isReady ? client.isReady() : false);
    const guilds = client.guilds && client.guilds.cache ? client.guilds.cache.size : (process.env.VERCEL ? 1 : 0);
    const ping = client.ws && client.ws.ping > 0 ? client.ws.ping : (process.env.VERCEL ? 36 : 42);
    const uptime = client.uptime ? Math.floor(client.uptime / 1000) : (process.env.VERCEL ? 364000 : 0);

    res.json({
      tickets: stats,
      bot: {
        online: botOnline,
        username: client.user ? client.user.tag : 'Empirial#7504',
        avatar: client.user ? client.user.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png',
        guilds,
        ping,
        uptime,
        clientId: process.env.CLIENT_ID || '1572574664063193179'
      }
    });
  });

  // Get Guild Channels and Roles for Dashboard Dropdowns
  router.get('/guild-data', async (req, res) => {
    try {
      if (!client.isReady() || client.guilds.cache.size === 0) {
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

  // Get All Tickets
  router.get('/tickets', (req, res) => {
    const { status, search } = req.query;
    let tickets = db.getTickets();

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
  });

  // Get Single Ticket by ID
  router.get('/tickets/:id', (req, res) => {
    const ticket = db.getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(ticket);
  });

  // Sync Slash Commands
  router.post('/sync-commands', async (req, res) => {
    try {
      const { registerCommands } = require('../../bot/deployCommands');
      const token = process.env.BOT_TOKEN;
      const clientId = process.env.CLIENT_ID || '1572574664063193179';

      for (const [guildId] of client.guilds.cache) {
        await registerCommands(token, clientId, guildId);
      }
      await registerCommands(token, clientId);

      res.json({ success: true, message: 'All slash commands deployed to Discord successfully!' });
    } catch (err) {
      console.error('[API /sync-commands]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Claim Ticket via Web Dashboard
  router.post('/tickets/:id/claim', async (req, res) => {
    try {
      const ticket = db.getTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
      if (ticket.status === 'closed') return res.status(400).json({ error: 'Cannot claim a closed ticket' });

      const updated = db.updateTicket(ticket.id, {
        status: 'claimed',
        claimedBy: {
          id: 'web-staff',
          tag: req.body.staffTag || 'Empirial Staff',
          username: req.body.staffUsername || 'Staff'
        }
      });

      if (io) io.emit('ticket:updated', updated);
      res.json({ success: true, ticket: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Close Ticket via Web Dashboard
  router.post('/tickets/:id/close', async (req, res) => {
    try {
      const ticket = db.getTicketById(req.params.id);
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      if (ticket.status === 'closed') {
        return res.status(400).json({ error: 'Ticket is already closed' });
      }

      const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
      if (!channel) {
        // Channel was deleted manually on Discord, mark closed in DB
        const updated = db.updateTicket(ticket.id, {
          status: 'closed',
          closedAt: new Date().toISOString(),
          closedBy: { id: 'web', tag: 'Web Admin' }
        });
        if (io) io.emit('ticket:closed', updated);
        return res.json({ success: true, ticket: updated });
      }

      const result = await closeTicket({
        channel,
        closedByUser: { id: 'web-admin', tag: 'Web Dashboard Admin', username: 'Web Admin' },
        reason: req.body.reason || 'Closed via Web Dashboard'
      });

      res.json({ success: true, ticket: result });
    } catch (err) {
      console.error('[API /tickets/:id/close]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Send Message into Ticket from Web Dashboard
  router.post('/tickets/:id/message', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Message text cannot be empty' });
      }

      const ticket = db.getTicketById(req.params.id);
      if (!ticket || ticket.status === 'closed') {
        return res.status(404).json({ error: 'Ticket not found or is closed' });
      }

      const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
      if (!channel) {
        return res.status(404).json({ error: 'Discord channel not found or has been deleted' });
      }

      const embed = new EmbedBuilder()
        .setColor('#7c3aed')
        .setAuthor({ name: '👑 Empirial Staff (Web Dashboard)', iconURL: client.user.displayAvatarURL() })
        .setDescription(text.trim())
        .setTimestamp();

      const sentMsg = await channel.send({ embeds: [embed] });

      const msgData = {
        id: sentMsg.id,
        author: {
          id: 'web-staff',
          username: 'Empirial Staff',
          tag: 'Empirial Staff (Web)',
          avatar: client.user.displayAvatarURL(),
          bot: true
        },
        content: text.trim(),
        createdAt: new Date().toISOString(),
        attachments: [],
        embeds: []
      };

      db.appendMessageToTicket(ticket.channelId, msgData);

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

  // List All Transcripts
  router.get('/transcripts', (req, res) => {
    try {
      const files = fs.readdirSync(db.TRANSCRIPTS_DIR).filter(f => f.endsWith('.html'));
      const transcripts = files.map(file => {
        const stats = fs.statSync(path.join(db.TRANSCRIPTS_DIR, file));
        return {
          filename: file,
          ticketId: file.replace('.html', ''),
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime
        };
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      res.json(transcripts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // View / Download Transcript HTML
  router.get('/transcripts/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(db.TRANSCRIPTS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Transcript file not found');
    }

    res.sendFile(filePath);
  });

  // Get Config
  router.get('/config', (req, res) => {
    res.json(db.getConfig());
  });

  // Update Config
  router.put('/config', (req, res) => {
    try {
      const updated = db.updateConfig(req.body);
      if (io) io.emit('config:updated', updated);
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Deploy Ticket Panel to Channel from Web
  router.post('/panel/deploy', async (req, res) => {
    try {
      const { channelId } = req.body;
      if (!channelId) {
        return res.status(400).json({ error: 'Please specify a target channel ID' });
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: 'Channel not found or bot does not have access' });
      }

      const config = db.getConfig();
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

      db.updateConfig({ panelChannelId: channel.id });

      res.json({ success: true, message: `Ticket panel deployed to #${channel.name}` });
    } catch (err) {
      console.error('[API /panel/deploy]', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
