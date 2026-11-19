const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TRANSCRIPTS_DIR)) {
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

// Default Configuration
const DEFAULT_CONFIG = {
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
    buttonText: 'Open Ticket',
    bannerUrl: ''
  },
  categories: [
    {
      id: 'general',
      label: 'General Support',
      emoji: '🛠️',
      description: 'Questions, general help, or questions about Empirial'
    },
    {
      id: 'billing',
      label: 'Billing & Store',
      emoji: '💳',
      description: 'Inquiries about purchases, store items, or payments'
    },
    {
      id: 'report',
      label: 'Report & Appeal',
      emoji: '🚨',
      description: 'Report a rule breaker or submit a punishment appeal'
    },
    {
      id: 'partnership',
      label: 'Partnership & Media',
      emoji: '🤝',
      description: 'Collaborations, sponsorships, and creator inquiries'
    }
  ]
};

// Helper: atomic JSON write
function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

// Read Config
function getConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      writeJsonAtomic(CONFIG_FILE, DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    console.error('[DB] Error reading config:', err);
    return { ...DEFAULT_CONFIG };
  }
}

// Save Config
function updateConfig(newConfig) {
  const current = getConfig();
  const merged = { ...current, ...newConfig };
  writeJsonAtomic(CONFIG_FILE, merged);
  return merged;
}

// Read Tickets
function getTickets() {
  try {
    if (!fs.existsSync(TICKETS_FILE)) {
      writeJsonAtomic(TICKETS_FILE, []);
      return [];
    }
    const raw = fs.readFileSync(TICKETS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[DB] Error reading tickets:', err);
    return [];
  }
}

// Save Tickets
function saveTickets(tickets) {
  writeJsonAtomic(TICKETS_FILE, tickets);
}

// Get Ticket by Channel ID
function getTicketByChannelId(channelId) {
  const tickets = getTickets();
  return tickets.find(t => t.channelId === channelId);
}

// Get Ticket by ID
function getTicketById(ticketId) {
  const tickets = getTickets();
  return tickets.find(t => t.id === ticketId);
}

// Create Ticket
function createTicket(ticketData) {
  const config = getConfig();
  const tickets = getTickets();

  const ticketNumber = config.ticketCounter || 1;
  const formattedNumber = String(ticketNumber).padStart(4, '0');
  const ticketId = `ticket-${formattedNumber}`;

  const newTicket = {
    id: ticketId,
    number: ticketNumber,
    channelId: ticketData.channelId,
    guildId: ticketData.guildId,
    userId: ticketData.userId,
    userTag: ticketData.userTag,
    userAvatar: ticketData.userAvatar || null,
    category: ticketData.category || 'general',
    subject: ticketData.subject || 'No Subject',
    description: ticketData.description || '',
    status: 'open', // open, claimed, closed
    claimedBy: null,
    createdAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
    transcriptFile: null,
    messages: ticketData.messages || []
  };

  tickets.unshift(newTicket);
  saveTickets(tickets);

  // Increment counter
  config.ticketCounter = ticketNumber + 1;
  updateConfig({ ticketCounter: config.ticketCounter });

  return newTicket;
}

// Update Ticket
function updateTicket(ticketId, updates) {
  const tickets = getTickets();
  const index = tickets.findIndex(t => t.id === ticketId || t.channelId === ticketId);
  if (index === -1) return null;

  tickets[index] = { ...tickets[index], ...updates };
  saveTickets(tickets);
  return tickets[index];
}

// Append Message to Ticket
function appendMessageToTicket(channelId, messageData) {
  const tickets = getTickets();
  const index = tickets.findIndex(t => t.channelId === channelId && t.status !== 'closed');
  if (index === -1) return;

  if (!tickets[index].messages) {
    tickets[index].messages = [];
  }

  // Cap stored messages to reasonable limit if needed, e.g. 500
  tickets[index].messages.push(messageData);
  if (tickets[index].messages.length > 500) {
    tickets[index].messages.shift();
  }

  saveTickets(tickets);
}

// Count Open Tickets for User
function countUserOpenTickets(userId) {
  const tickets = getTickets();
  return tickets.filter(t => t.userId === userId && t.status !== 'closed').length;
}

// Get Statistics
function getStats() {
  const tickets = getTickets();
  const total = tickets.length;
  const open = tickets.filter(t => t.status === 'open').length;
  const claimed = tickets.filter(t => t.status === 'claimed').length;
  const closed = tickets.filter(t => t.status === 'closed').length;

  return {
    total,
    open,
    claimed,
    closed,
    active: open + claimed
  };
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
  getStats
};
