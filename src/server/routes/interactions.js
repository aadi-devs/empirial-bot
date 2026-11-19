const express = require('express');
const router = express.Router();
const {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  verifyKey
} = require('discord-interactions');
const db = require('../../storage/db');

// Raw body parser for Discord signature verification
router.use(express.raw({ type: 'application/json' }));

router.post('/', async (req, res) => {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const clientPublicKey = process.env.DISCORD_PUBLIC_KEY;

  const rawBody = req.body;
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : JSON.stringify(rawBody);

  // If public key is set, verify cryptographic signature
  if (clientPublicKey && signature && timestamp) {
    const isValid = verifyKey(rawBody, signature, timestamp, clientPublicKey);
    if (!isValid) {
      return res.status(401).send('Bad request signature');
    }
  }

  let interaction;
  try {
    interaction = typeof rawBody === 'string' ? JSON.parse(rawBody) : (Buffer.isBuffer(rawBody) ? JSON.parse(bodyStr) : rawBody);
  } catch (err) {
    return res.status(400).send('Invalid JSON');
  }

  // 1. Handle Discord Ping (Healthcheck for Interactions Endpoint URL verification)
  if (interaction.type === InteractionType.PING) {
    return res.json({ type: InteractionResponseType.PONG });
  }

  // 2. Handle Application Commands (Slash Commands)
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name } = interaction.data;

    if (name === 'ping') {
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '🏓 **Pong from Empirial Bot on Vercel!** Latency is healthy.',
          flags: InteractionResponseFlags.EPHEMERAL
        }
      });
    }

    if (name === 'stats') {
      const stats = db.getStats();
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [
            {
              title: '👑 Empirial Ticket Statistics',
              color: 0x7c3aed,
              fields: [
                { name: 'Total Tickets', value: String(stats.total), inline: true },
                { name: 'Open Tickets', value: String(stats.open), inline: true },
                { name: 'Claimed Tickets', value: String(stats.claimed), inline: true },
                { name: 'Closed Tickets', value: String(stats.closed), inline: true }
              ],
              footer: { text: 'Empirial Support System • Vercel Unified' }
            }
          ]
        }
      });
    }

    if (name === 'ticket-panel') {
      const config = db.getConfig();
      const panel = config.panelConfig || {};

      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [
            {
              title: panel.title || '👑 Empirial Support Tickets',
              description: panel.description || 'Welcome to Empirial Support! Click the button below to open a ticket.',
              color: 0x7c3aed,
              footer: { text: panel.footerText || 'Empirial Support System' }
            }
          ],
          components: [
            {
              type: 1, // ActionRow
              components: [
                {
                  type: 2, // Button
                  custom_id: 'ticket_create_btn',
                  label: panel.buttonText || 'Open Ticket',
                  style: 3, // Success
                  emoji: { name: '🎫' }
                }
              ]
            }
          ]
        }
      });
    }
  }

  // 3. Handle Message Components (Button clicks)
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const { custom_id } = interaction.data;

    if (custom_id === 'ticket_create_btn') {
      // Return a Modal
      return res.json({
        type: InteractionResponseType.MODAL,
        data: {
          custom_id: 'ticket_modal_general',
          title: '👑 Open Empirial Ticket',
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'ticket_subject',
                  label: 'Subject / Reason',
                  style: 1,
                  min_length: 3,
                  max_length: 100,
                  required: true,
                  placeholder: 'Brief summary of your inquiry...'
                }
              ]
            },
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'ticket_description',
                  label: 'Details (Optional)',
                  style: 2,
                  max_length: 1000,
                  required: false,
                  placeholder: 'Describe your issue in detail...'
                }
              ]
            }
          ]
        }
      });
    }
  }

  // Default response
  return res.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: 'Received interaction.',
      flags: InteractionResponseFlags.EPHEMERAL
    }
  });
});

module.exports = router;
