const db = require('../../storage/db');

module.exports = {
  name: 'messageCreate',
  async execute(message, client, io) {
    // Ignore bots or system messages if not in ticket
    if (!message.guild || message.channel.isDMBased()) return;

    const ticket = db.getTicketByChannelId(message.channel.id);
    if (!ticket || ticket.status === 'closed') return;

    // Cache message in database
    const messageData = {
      id: message.id,
      author: {
        id: message.author.id,
        username: message.author.username,
        tag: message.author.tag || message.author.username,
        avatar: message.author.displayAvatarURL ? message.author.displayAvatarURL({ dynamic: true, size: 64 }) : null,
        bot: message.author.bot
      },
      content: message.content || '',
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map(a => ({
        name: a.name,
        url: a.url,
        contentType: a.contentType || ''
      })),
      embeds: message.embeds.map(e => ({
        title: e.title || '',
        description: e.description || '',
        color: e.hexColor || '#7c3aed'
      }))
    };

    db.appendMessageToTicket(message.channel.id, messageData);

    // Broadcast to web dashboard
    if (io) {
      io.emit('ticket:message', {
        ticketId: ticket.id,
        channelId: message.channel.id,
        message: messageData
      });
    }
  }
};
