const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { TRANSCRIPTS_DIR } = require('../../storage/db');

/**
 * Escapes HTML characters safely
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Basic markdown parser for Discord chat
 */
function formatDiscordText(text) {
  if (!text) return '';
  let formatted = escapeHtml(text);

  // Code blocks ```code```
  formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code `code`
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold **bold**
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italics *italic* or _italic_
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
  // Underline __underline__
  formatted = formatted.replace(/__([^_]+)__/g, '<u>$1</u>');
  // Strikethrough ~~strike~~
  formatted = formatted.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Mentions <@!123456789>
  formatted = formatted.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@User</span>');
  formatted = formatted.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention">@Role</span>');
  formatted = formatted.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#Channel</span>');
  // Newlines
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

/**
 * Generates an HTML transcript from channel messages or stored ticket messages
 */
async function generateTranscript(ticket, channel, closedByUser = null) {
  let messages = [];

  // If channel is available, fetch messages directly from Discord channel
  if (channel && channel.messages) {
    try {
      const fetched = await channel.messages.fetch({ limit: 100 });
      // Sort oldest to newest
      messages = Array.from(fetched.values()).reverse().map(msg => {
        return {
          id: msg.id,
          author: {
            id: msg.author.id,
            username: msg.author.username,
            tag: msg.author.tag,
            avatar: msg.author.displayAvatarURL({ dynamic: true, size: 64 }),
            bot: msg.author.bot
          },
          content: msg.content,
          createdAt: msg.createdAt.toISOString(),
          attachments: msg.attachments.map(a => ({
            name: a.name,
            url: a.url,
            contentType: a.contentType || ''
          })),
          embeds: msg.embeds.map(e => ({
            title: e.title || '',
            description: e.description || '',
            color: e.hexColor || '#7c3aed',
            fields: e.fields || [],
            footer: e.footer ? e.footer.text : ''
          }))
        };
      });
    } catch (err) {
      console.warn('[Transcript] Could not fetch live channel messages, using cached messages:', err.message);
      messages = ticket.messages || [];
    }
  } else {
    messages = ticket.messages || [];
  }

  const generatedAt = new Date().toLocaleString('en-US', { timeZoneName: 'short' });
  const ticketId = ticket.id || `ticket-${ticket.number || 'unknown'}`;
  const subject = escapeHtml(ticket.subject || 'General Ticket');
  const userTag = escapeHtml(ticket.userTag || 'Unknown User');
  const closer = closedByUser ? escapeHtml(closedByUser.tag || closedByUser.username || 'Staff') : 'Staff';

  // Build HTML document
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ticketId} - Empirial Ticket Transcript</title>
  <style>
    :root {
      --bg-primary: #1e1f22;
      --bg-secondary: #2b2d31;
      --bg-tertiary: #111214;
      --text-normal: #dbdee1;
      --text-muted: #949ba4;
      --text-header: #f2f3f5;
      --accent: #7c3aed;
      --accent-hover: #6d28d9;
      --gold: #f59e0b;
      --border: #35363c;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg-tertiary);
      color: var(--text-normal);
      font-family: 'gg sans', 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.4;
      padding: 24px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: var(--bg-primary);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .header {
      background: linear-gradient(135deg, #18191c 0%, #2b1055 100%);
      padding: 24px 28px;
      border-bottom: 2px solid var(--accent);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-info h1 {
      font-size: 22px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      font-size: 11px;
      text-transform: uppercase;
      padding: 4px 8px;
      border-radius: 6px;
      background: rgba(124, 58, 237, 0.3);
      color: #c4b5fd;
      border: 1px solid #7c3aed;
      font-weight: 700;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      padding: 18px 28px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .meta-item strong {
      color: var(--text-muted);
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .meta-item span {
      color: var(--text-header);
      font-weight: 600;
    }
    .messages-container {
      padding: 20px 24px;
      min-height: 400px;
    }
    .message-group {
      display: flex;
      gap: 16px;
      padding: 10px 12px;
      border-radius: 8px;
      transition: background 0.15s ease;
      margin-bottom: 6px;
    }
    .message-group:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #313338;
      object-fit: cover;
    }
    .message-body {
      flex: 1;
      overflow: hidden;
    }
    .message-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .username {
      font-weight: 600;
      color: var(--text-header);
    }
    .bot-tag {
      background: #5865f2;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 5px;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .timestamp {
      color: var(--text-muted);
      font-size: 12px;
    }
    .message-content {
      color: var(--text-normal);
      word-break: break-word;
      line-height: 1.45;
    }
    .mention {
      background: rgba(88, 101, 242, 0.25);
      color: #c9cdfb;
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: 500;
    }
    pre code {
      display: block;
      background: #111214;
      padding: 10px;
      border-radius: 6px;
      border: 1px solid #232428;
      margin: 6px 0;
      font-family: Consolas, monospace;
      font-size: 13px;
      overflow-x: auto;
    }
    code {
      background: #2b2d31;
      padding: 2px 4px;
      border-radius: 4px;
      font-family: Consolas, monospace;
      font-size: 13px;
    }
    /* Embeds */
    .discord-embed {
      border-left: 4px solid var(--accent);
      background: var(--bg-secondary);
      border-radius: 4px;
      padding: 12px 16px;
      margin-top: 8px;
      max-width: 520px;
    }
    .embed-title {
      font-weight: 700;
      color: #fff;
      margin-bottom: 6px;
      font-size: 14px;
    }
    .embed-description {
      color: var(--text-normal);
      font-size: 13px;
      white-space: pre-wrap;
    }
    .attachment-img {
      max-width: 400px;
      max-height: 300px;
      border-radius: 6px;
      margin-top: 8px;
      display: block;
    }
    .footer {
      text-align: center;
      padding: 16px;
      color: var(--text-muted);
      font-size: 12px;
      border-top: 1px solid var(--border);
      background: var(--bg-secondary);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-info">
        <h1>👑 Empirial Ticket System</h1>
        <p style="color: #a78bfa; font-size: 13px; margin-top: 4px;">Self-Hosted Archive</p>
      </div>
      <div>
        <span class="badge">${ticketId}</span>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-item">
        <strong>Subject</strong>
        <span>${subject}</span>
      </div>
      <div class="meta-item">
        <strong>Created By</strong>
        <span>${userTag}</span>
      </div>
      <div class="meta-item">
        <strong>Category</strong>
        <span>${escapeHtml(ticket.category || 'General')}</span>
      </div>
      <div class="meta-item">
        <strong>Closed By</strong>
        <span>${closer}</span>
      </div>
      <div class="meta-item">
        <strong>Total Messages</strong>
        <span>${messages.length}</span>
      </div>
      <div class="meta-item">
        <strong>Archived At</strong>
        <span>${escapeHtml(generatedAt)}</span>
      </div>
    </div>

    <div class="messages-container">
      ${messages.length === 0 ? '<div style="text-align:center; padding: 40px; color: var(--text-muted);">No messages were recorded in this ticket.</div>' : ''}
      ${messages.map(msg => {
        const authorName = escapeHtml(msg.author.username || 'User');
        const avatar = msg.author.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
        const isBot = msg.author.bot;
        const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

        const embedsHtml = (msg.embeds || []).map(e => `
          <div class="discord-embed" style="border-left-color: ${e.color || '#7c3aed'};">
            ${e.title ? `<div class="embed-title">${escapeHtml(e.title)}</div>` : ''}
            ${e.description ? `<div class="embed-description">${formatDiscordText(e.description)}</div>` : ''}
          </div>
        `).join('');

        const attachmentsHtml = (msg.attachments || []).map(att => {
          const isImg = att.contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(att.name);
          if (isImg) {
            return `<a href="${att.url}" target="_blank"><img class="attachment-img" src="${att.url}" alt="${escapeHtml(att.name)}"></a>`;
          }
          return `<div style="margin-top: 6px;"><a href="${att.url}" target="_blank" style="color: #5865f2; text-decoration: underline;">📎 ${escapeHtml(att.name)}</a></div>`;
        }).join('');

        return `
          <div class="message-group">
            <img class="avatar" src="${avatar}" alt="${authorName}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="message-body">
              <div class="message-header">
                <span class="username">${authorName}</span>
                ${isBot ? '<span class="bot-tag">BOT</span>' : ''}
                <span class="timestamp">${time}</span>
              </div>
              <div class="message-content">
                ${formatDiscordText(msg.content)}
              </div>
              ${attachmentsHtml}
              ${embedsHtml}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="footer">
      Generated automatically by <strong>Empirial Ticket Bot</strong> • Self-Hosted Local Archive
    </div>
  </div>
</body>
</html>`;

  // Save HTML file in data/transcripts
  const fileName = `${ticketId}.html`;
  const filePath = path.join(TRANSCRIPTS_DIR, fileName);
  fs.writeFileSync(filePath, html, 'utf-8');

  // Create Discord AttachmentBuilder
  const attachment = new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: fileName });

  return {
    fileName,
    filePath,
    attachment,
    messagesCount: messages.length
  };
}

module.exports = {
  generateTranscript
};
