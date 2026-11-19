const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mrbpnqtinsrylpsbtuqn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yYnBucXRpbnNyeWxwc2J0dXFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwOTIyMDcsImV4cCI6MjExMDY2ODIwN30.MQToSFIu7cmQK37BvF_D7GswktM3-7oBL3qB5b4WB1w';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// Transcripts local cache directory for fast file serving
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'empirial_data') : path.join(__dirname, '..', '..', 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
try {
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  }
} catch (_) {}

// Default Configuration Fallback
const DEFAULT_CONFIG = {
  id: 'default',
  serverName: process.env.SERVER_NAME || 'Empirial',
  ticketCategoryId: null,
  supportRoleId: null,
  adminRoleId: null,
  logsChannelId: null,
  panelChannelId: null,
  ticketCounter: 1,
  maxOpenTicketsPerUser: 1,
  panelConfig: {
    title: '👑 Empirial Support Tickets',
    description: 'Welcome to the **Empirial** Support Center.\n\nNeed assistance, want to report an issue, or have a billing inquiry? Select the appropriate category below to create a private ticket. Our staff team will be with you shortly.',
    color: '#7c3aed',
    footerText: 'Empirial Support System • Private & Secure',
    buttonText: 'Open Ticket'
  },
  categories: [
    { id: 'general', label: 'General Support', emoji: '🛠️', description: 'Questions, general help, or questions about Empirial' },
    { id: 'billing', label: 'Billing & Store', emoji: '💳', description: 'Inquiries about purchases, store items, or payments' },
    { id: 'report', label: 'Report & Appeal', emoji: '🚨', description: 'Report a rule breaker or submit a punishment appeal' },
    { id: 'partnership', label: 'Partnership & Media', emoji: '🤝', description: 'Collaborations, sponsorships, and creator inquiries' }
  ]
};

// Map DB row to Config Object
function mapConfigRow(row) {
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    id: row.id || 'default',
    guildId: row.guild_id || null,
    serverName: row.server_name || 'Empirial',
    ticketCategoryId: row.ticket_category_id || null,
    supportRoleId: row.support_role_id || null,
    adminRoleId: row.admin_role_id || null,
    logsChannelId: row.logs_channel_id || null,
    panelChannelId: row.panel_channel_id || null,
    ticketCounter: row.ticket_counter || 1,
    maxOpenTicketsPerUser: row.max_open_tickets_per_user || 1,
    panelConfig: row.panel_config || DEFAULT_CONFIG.panelConfig,
    categories: row.categories || DEFAULT_CONFIG.categories
  };
}

// Map DB row to Ticket Object
function mapTicketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    userTag: row.user_tag,
    userAvatar: row.user_avatar,
    category: row.category,
    subject: row.subject,
    description: row.description,
    status: row.status,
    claimedBy: row.claimed_by,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    transcriptFile: row.transcript_file,
    messages: row.messages || []
  };
}

/**
 * Fetch Configuration from Supabase
 */
async function getConfig() {
  try {
    const { data, error } = await supabase
      .from('guild_config')
      .select('*')
      .eq('id', 'default')
      .single();

    if (error || !data) {
      return { ...DEFAULT_CONFIG };
    }
    return mapConfigRow(data);
  } catch (err) {
    console.error('[Supabase DB] Error reading config:', err);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Update Configuration in Supabase
 */
async function updateConfig(newConfig) {
  try {
    const current = await getConfig();
    const merged = { ...current, ...newConfig };

    const updatePayload = {
      guild_id: merged.guildId,
      server_name: merged.serverName,
      ticket_category_id: merged.ticketCategoryId,
      support_role_id: merged.supportRoleId,
      admin_role_id: merged.adminRoleId,
      logs_channel_id: merged.logsChannelId,
      panel_channel_id: merged.panelChannelId,
      ticket_counter: merged.ticketCounter,
      max_open_tickets_per_user: merged.maxOpenTicketsPerUser,
      panel_config: merged.panelConfig,
      categories: merged.categories,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('guild_config')
      .update(updatePayload)
      .eq('id', 'default')
      .select()
      .single();

    if (error) {
      console.error('[Supabase DB] Failed to update config:', error);
      return merged;
    }
    return mapConfigRow(data);
  } catch (err) {
    console.error('[Supabase DB] Update config error:', err);
    return { ...DEFAULT_CONFIG, ...newConfig };
  }
}

/**
 * Fetch all tickets
 */
async function getTickets() {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }
    return data.map(mapTicketRow);
  } catch (err) {
    console.error('[Supabase DB] Error fetching tickets:', err);
    return [];
  }
}

/**
 * Fetch ticket by ID or Channel ID
 */
async function getTicketById(ticketId) {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .or(`id.eq.${ticketId},channel_id.eq.${ticketId}`)
      .limit(1)
      .single();

    if (error || !data) return null;
    return mapTicketRow(data);
  } catch (err) {
    return null;
  }
}

/**
 * Fetch ticket by channel ID
 */
async function getTicketByChannelId(channelId) {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('channel_id', channelId)
      .limit(1)
      .single();

    if (error || !data) return null;
    return mapTicketRow(data);
  } catch (err) {
    return null;
  }
}

/**
 * Create a new ticket in Supabase
 */
async function createTicket(ticketData) {
  try {
    const config = await getConfig();
    const nextNumber = config.ticketCounter || 1;
    const formattedNumber = String(nextNumber).padStart(4, '0');
    const ticketId = `ticket-${formattedNumber}`;

    const insertPayload = {
      id: ticketId,
      number: nextNumber,
      channel_id: ticketData.channelId,
      guild_id: ticketData.guildId || null,
      user_id: ticketData.userId,
      user_tag: ticketData.userTag,
      user_avatar: ticketData.userAvatar || null,
      category: ticketData.category || 'General',
      subject: ticketData.subject || 'Support',
      description: ticketData.description || '',
      status: 'open',
      claimed_by: null,
      created_at: new Date().toISOString(),
      closed_at: null,
      closed_by: null,
      transcript_file: null,
      messages: ticketData.messages || []
    };

    const { data, error } = await supabase
      .from('tickets')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error('[Supabase DB] Error creating ticket:', error);
      throw error;
    }

    // Increment ticket counter in config
    await updateConfig({ ticketCounter: nextNumber + 1 });

    return mapTicketRow(data);
  } catch (err) {
    console.error('[Supabase DB] Create ticket failure:', err);
    throw err;
  }
}

/**
 * Update ticket in Supabase
 */
async function updateTicket(ticketId, updates) {
  try {
    const payload = {};
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.claimedBy !== undefined) payload.claimed_by = updates.claimedBy;
    if (updates.closedAt !== undefined) payload.closed_at = updates.closedAt;
    if (updates.closedBy !== undefined) payload.closed_by = updates.closedBy;
    if (updates.transcriptFile !== undefined) payload.transcript_file = updates.transcriptFile;
    if (updates.messages !== undefined) payload.messages = updates.messages;

    const { data, error } = await supabase
      .from('tickets')
      .update(payload)
      .or(`id.eq.${ticketId},channel_id.eq.${ticketId}`)
      .select()
      .single();

    if (error) {
      console.error('[Supabase DB] Error updating ticket:', error);
      return null;
    }
    return mapTicketRow(data);
  } catch (err) {
    console.error('[Supabase DB] Update ticket failure:', err);
    return null;
  }
}

/**
 * Append message to ticket in Supabase
 */
async function appendMessageToTicket(channelId, messageData) {
  try {
    const ticket = await getTicketByChannelId(channelId);
    if (!ticket || ticket.status === 'closed') return;

    const messages = ticket.messages || [];
    messages.push(messageData);
    if (messages.length > 300) messages.shift(); // keep last 300 messages per ticket

    await supabase
      .from('tickets')
      .update({ messages })
      .eq('channel_id', channelId);
  } catch (err) {
    console.error('[Supabase DB] Append message error:', err);
  }
}

/**
 * Count open tickets for a specific user
 */
async function countUserOpenTickets(userId) {
  try {
    const { count, error } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('status', 'closed');

    if (error) return 0;
    return count || 0;
  } catch (err) {
    return 0;
  }
}

/**
 * Fetch real statistics directly from Supabase (ZERO simulated/guessed values!)
 */
async function getStats() {
  try {
    // Real counts
    const { count: total } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true });

    const { count: open } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open');

    const { count: claimed } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'claimed');

    const { count: closed } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'closed');

    const totalCount = total || 0;
    const openCount = open || 0;
    const claimedCount = claimed || 0;
    const closedCount = closed || 0;
    const activeCount = openCount + claimedCount;

    return {
      total: totalCount,
      open: openCount,
      claimed: claimedCount,
      closed: closedCount,
      active: activeCount,
      unclaimed: openCount
    };
  } catch (err) {
    console.error('[Supabase DB] Get stats error:', err);
    return { total: 0, open: 0, claimed: 0, closed: 0, active: 0, unclaimed: 0 };
  }
}

/**
 * Save persistent HTML Transcript in Supabase
 */
async function saveTranscript(ticketId, filename, htmlContent, messagesCount) {
  try {
    // 1. Save in Supabase
    await supabase.from('transcripts').upsert({
      id: ticketId,
      ticket_id: ticketId,
      filename,
      html_content: htmlContent,
      messages_count: messagesCount,
      created_at: new Date().toISOString()
    });

    // 2. Also cache locally in /tmp or data/transcripts for fast sendFile
    const localPath = path.join(TRANSCRIPTS_DIR, filename);
    fs.writeFileSync(localPath, htmlContent, 'utf-8');
  } catch (err) {
    console.error('[Supabase DB] Save transcript error:', err);
  }
}

/**
 * Fetch all saved transcripts from Supabase
 */
async function getTranscripts() {
  try {
    const { data, error } = await supabase
      .from('transcripts')
      .select('id, ticket_id, filename, messages_count, created_at, html_content')
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return data.map(t => ({
      ticketId: t.ticket_id,
      filename: t.filename,
      messagesCount: t.messages_count,
      createdAt: t.created_at,
      size: Buffer.byteLength(t.html_content || '', 'utf8')
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Fetch single transcript HTML from Supabase
 */
async function getTranscriptContent(filename) {
  try {
    const { data, error } = await supabase
      .from('transcripts')
      .select('html_content')
      .eq('filename', filename)
      .limit(1)
      .single();

    if (error || !data) return null;
    return data.html_content;
  } catch (err) {
    return null;
  }
}

/**
 * Session Management for Discord OAuth2 Admins
 */
async function createSession(sessionData) {
  try {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    const sessionId = 'emp_sesh_' + Math.random().toString(36).substring(2) + Date.now().toString(36);

    await supabase.from('admin_sessions').insert({
      id: sessionId,
      user_id: sessionData.id,
      username: sessionData.username,
      discriminator: sessionData.discriminator || '0',
      avatar: sessionData.avatar,
      roles: sessionData.roles || [],
      is_admin: sessionData.isAdmin || false,
      created_at: new Date().toISOString(),
      expires_at: expiresAt
    });

    return { sessionId, expiresAt };
  } catch (err) {
    console.error('[Supabase DB] Error creating session:', err);
    throw err;
  }
}

async function getSession(sessionId) {
  if (!sessionId) return null;
  try {
    const { data, error } = await supabase
      .from('admin_sessions')
      .select('*')
      .eq('id', sessionId)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .single();

    if (error || !data) return null;
    return data;
  } catch (err) {
    return null;
  }
}

async function deleteSession(sessionId) {
  if (!sessionId) return;
  try {
    await supabase.from('admin_sessions').delete().eq('id', sessionId);
  } catch (_) {}
}

module.exports = {
  TRANSCRIPTS_DIR,
  getConfig,
  updateConfig,
  getTickets,
  getTicketById,
  getTicketByChannelId,
  createTicket,
  updateTicket,
  appendMessageToTicket,
  countUserOpenTickets,
  getStats,
  saveTranscript,
  getTranscripts,
  getTranscriptContent,
  createSession,
  getSession,
  deleteSession
};
