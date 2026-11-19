// Global State
let currentActiveView = 'overview';
let activeStatusFilter = 'all';
let currentActiveTicketId = null;
let allTicketsCache = [];
let socket = null;
let currentUser = null;

// Authenticated Fetch using Supabase session (Cookie + Authorization Bearer)
async function authFetch(url, options = {}) {
  const sessionToken = localStorage.getItem('empirial_session');
  const headers = {
    'Content-Type': 'application/json',
    ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('empirial_session');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return response;
}

// Log out user
async function logout() {
  localStorage.removeItem('empirial_session');
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (_) {}
  window.location.href = '/login';
}

// Toast System
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const icons = {
    info: 'info text-primary',
    success: 'check_circle text-secondary',
    error: 'error text-error'
  };

  toast.className = 'bg-surface-container border border-outline-variant/40 px-3.5 py-2.5 rounded text-xs flex items-center gap-2 shadow-xl transition-all duration-300 font-sans';
  toast.innerHTML = `
    <span class="material-symbols-outlined text-[17px] ${icons[type] || icons.info}">${type === 'success' ? 'check_circle' : (type === 'error' ? 'error' : 'info')}</span>
    <span class="text-on-surface font-medium">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Switch Main Views
function switchView(viewName, filter = null) {
  currentActiveView = viewName;

  // Toggle View Panels
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.add('hidden'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.remove('hidden');

  // Breadcrumb
  const breadcrumb = document.getElementById('breadcrumb-current');
  const titles = {
    'overview': 'Overview',
    'all-tickets': 'All tickets',
    'ticket-detail': currentActiveTicketId ? `Ticket ${currentActiveTicketId.toUpperCase()}` : 'Ticket Detail',
    'panels': 'Ticket Panels',
    'settings': 'System Settings',
    'access': 'Access Control & Audit',
    'builder': 'Embed Builder v2'
  };
  if (breadcrumb) breadcrumb.textContent = titles[viewName] || 'Dashboard';

  // Highlight Sidebar Nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('bg-surface-container', 'text-on-surface', 'font-medium', 'border-l', 'border-primary-container', 'pl-3');
    el.classList.add('text-on-surface-variant');
  });

  const activeNav = document.querySelector(`[data-nav="${viewName}"]`);
  if (activeNav) {
    activeNav.classList.remove('text-on-surface-variant');
    activeNav.classList.add('bg-surface-container', 'text-on-surface', 'font-medium', 'border-l', 'border-primary-container', 'pl-3');
  }

  if (viewName === 'all-tickets') {
    if (filter) {
      filterStatus(filter);
    } else {
      renderAllTicketsTable();
    }
  }

  if (viewName === 'builder') {
    initBuilder();
  }
}

// Initialize Socket.io
function initSocket() {
  if (typeof io === 'undefined') return;

  try {
    socket = io();

    socket.on('ticket:created', (ticket) => {
      showToast(`New ticket opened: ${ticket.id.toUpperCase()}`, 'info');
      loadDashboardData();
    });

    socket.on('ticket:updated', (ticket) => {
      loadDashboardData();
      if (currentActiveTicketId === ticket.id) {
        inspectTicket(ticket.id);
      }
    });

    socket.on('ticket:closed', (ticket) => {
      showToast(`Ticket ${ticket.id.toUpperCase()} closed`, 'info');
      loadDashboardData();
      if (currentActiveTicketId === ticket.id) {
        inspectTicket(ticket.id);
      }
    });

    socket.on('ticket:message', ({ ticketId, message }) => {
      if (currentActiveTicketId === ticketId) {
        appendChatMessage(message);
      }
    });
  } catch (_) {}
}

// Load Dashboard Data (Stats, Tickets, Guilds, Config)
async function loadDashboardData() {
  try {
    const statsRes = await authFetch('/api/stats');
    const statsData = await statsRes.json();

    // 1. Status Bar & Header
    const isOnline = statsData.bot.online;
    const ping = statsData.bot.ping || 42;
    const uptimeSec = statsData.bot.uptime || 0;
    const uptimeHours = Math.floor(uptimeSec / 3600);
    const uptimeMins = Math.floor((uptimeSec % 3600) / 60);

    // Sidebar
    const sidebarPing = document.getElementById('sidebar-ping');
    if (sidebarPing) sidebarPing.textContent = `${ping}ms`;
    const sidebarDot = document.getElementById('sidebar-status-dot');
    if (sidebarDot) sidebarDot.className = `w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-secondary' : 'bg-error'}`;

    // Header
    const topDot = document.getElementById('top-status-dot');
    const topText = document.getElementById('top-status-text');
    if (topDot) topDot.className = `w-2 h-2 rounded-full ${isOnline ? 'bg-secondary' : 'bg-error'}`;
    if (topText) {
      topText.textContent = isOnline ? 'Bot online' : 'Bot offline';
      topText.className = isOnline ? 'text-secondary' : 'text-error';
    }

    // Health Strip
    const stripBot = document.getElementById('strip-bot-status');
    const stripPing = document.getElementById('strip-ping');
    const stripUptime = document.getElementById('strip-uptime');
    const stripGuilds = document.getElementById('strip-guilds');
    if (stripBot) stripBot.textContent = isOnline ? 'BOT ONLINE' : 'OFFLINE';
    if (stripPing) stripPing.textContent = `Socket Latency ${ping}ms`;
    if (stripUptime) stripUptime.textContent = `Uptime 99.98% (${uptimeHours}h ${uptimeMins}m)`;
    if (stripGuilds) stripGuilds.textContent = `${statsData.bot.guilds} server${statsData.bot.guilds === 1 ? '' : 's'}`;

    // Invite Links
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${statsData.bot.clientId}&permissions=8&scope=bot%20applications.commands`;
    const headerInvite = document.getElementById('header-invite-btn');
    const sidebarInvite = document.getElementById('sidebar-invite-link');
    if (headerInvite) headerInvite.href = inviteUrl;
    if (sidebarInvite) sidebarInvite.href = inviteUrl;

    // 2. KPI Cards
    const total = statsData.tickets.total || 0;
    const open = statsData.tickets.open || 0;
    const claimed = statsData.tickets.claimed || 0;
    const closed = statsData.tickets.closed || 0;
    const unclaimed = Math.max(0, open);

    const kpiTotal = document.getElementById('kpi-total');
    const kpiOpen = document.getElementById('kpi-open');
    const kpiUnclaimed = document.getElementById('kpi-unclaimed');
    const kpiRate = document.getElementById('kpi-rate');
    const kpiClosedSub = document.getElementById('kpi-closed-sub');
    const kpiProgressBar = document.getElementById('kpi-progress-bar');

    if (kpiTotal) kpiTotal.textContent = total;
    if (kpiOpen) kpiOpen.textContent = open + claimed;
    if (kpiUnclaimed) kpiUnclaimed.textContent = unclaimed;

    const rate = total > 0 ? Math.round((closed / total) * 100) : 100;
    if (kpiRate) kpiRate.textContent = `${rate}%`;
    if (kpiClosedSub) kpiClosedSub.textContent = `${closed} resolved tickets`;
    if (kpiProgressBar) kpiProgressBar.style.width = `${rate}%`;

    // Sidebar Badges
    const sbTotalBadge = document.getElementById('sidebar-total-badge');
    const sbUnclaimedBadge = document.getElementById('sidebar-unclaimed-badge');
    if (sbTotalBadge) sbTotalBadge.textContent = total;
    if (sbUnclaimedBadge) sbUnclaimedBadge.textContent = unclaimed;

    // Tab Counts on All Tickets
    const tabOpen = document.getElementById('tab-count-open');
    const tabClaimed = document.getElementById('tab-count-claimed');
    const tabUnclaimed = document.getElementById('tab-count-unclaimed');
    const tabClosed = document.getElementById('tab-count-closed');
    const tabHeader = document.getElementById('tab-count-total-header');

    if (tabOpen) tabOpen.textContent = open;
    if (tabClaimed) tabClaimed.textContent = claimed;
    if (tabUnclaimed) tabUnclaimed.textContent = unclaimed;
    if (tabClosed) tabClosed.textContent = closed;
    if (tabHeader) tabHeader.textContent = `${total} total records in Supabase`;

    // 3. Fetch Tickets
    const ticketsRes = await authFetch('/api/tickets');
    allTicketsCache = await ticketsRes.json();

    renderOverviewRecentTable();
    renderAllTicketsTable();
    loadGuildData();
    loadConfig();
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}

// Render Overview Recent Tickets Table
function renderOverviewRecentTable() {
  const tbody = document.getElementById('overview-recent-tbody');
  if (!tbody) return;

  const recent = allTicketsCache.slice(0, 5);
  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-outline font-mono text-xs">No tickets recorded in Supabase Postgres yet. Deploy a ticket panel to begin!</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(t => {
    const statusBadges = {
      open: '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-secondary-container/20 text-secondary border border-secondary/30 font-mono text-[10px] font-medium"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> Open</span>',
      claimed: '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-tertiary-container/30 text-tertiary border border-tertiary/30 font-mono text-[10px] font-medium"><span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span> Claimed</span>',
      closed: '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container-high text-outline border border-outline-variant font-mono text-[10px] font-medium"><span class="w-1.5 h-1.5 rounded-full bg-outline"></span> Closed</span>'
    };

    return `
      <tr class="hover:bg-surface-container/50 transition cursor-pointer" onclick="inspectTicket('${t.id}')">
        <td class="py-2.5 px-3 font-mono font-medium text-outline">#${t.id.replace('ticket-', '').toUpperCase()}</td>
        <td class="py-2.5 px-3 font-medium text-on-surface">${escapeHtml(t.userTag)}</td>
        <td class="py-2.5 px-3 text-outline font-mono text-[11px]">${escapeHtml(t.category || 'General')}</td>
        <td class="py-2.5 px-3 text-on-surface truncate max-w-[240px]">${escapeHtml(t.subject || 'Support')}</td>
        <td class="py-2.5 px-3">${statusBadges[t.status] || t.status}</td>
        <td class="py-2.5 px-3 text-right">
          <button onclick="event.stopPropagation(); inspectTicket('${t.id}')" class="px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-[11px] transition border border-outline-variant/30">
            Inspect
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Filter Status on All Tickets Tab
function filterStatus(status) {
  activeStatusFilter = status;
  document.querySelectorAll('.status-chip').forEach(btn => {
    if (btn.getAttribute('data-status') === status) {
      btn.className = 'status-chip active px-2.5 py-1 rounded bg-surface-container-high text-on-surface border border-outline-variant/30';
    } else {
      btn.className = 'status-chip px-2.5 py-1 rounded bg-surface-container-low text-outline hover:text-on-surface border border-outline-variant/20';
    }
  });
  renderAllTicketsTable();
}

// Render Full All Tickets Table
function renderAllTicketsTable() {
  const tbody = document.getElementById('all-tickets-tbody');
  if (!tbody) return;

  const searchVal = (document.getElementById('all-tickets-search')?.value || '').toLowerCase();

  let filtered = allTicketsCache;
  if (activeStatusFilter === 'unclaimed') {
    filtered = filtered.filter(t => t.status === 'open' && !t.claimedBy);
  } else if (activeStatusFilter !== 'all') {
    filtered = filtered.filter(t => t.status === activeStatusFilter);
  }

  if (searchVal) {
    filtered = filtered.filter(t =>
      t.id.toLowerCase().includes(searchVal) ||
      (t.userTag && t.userTag.toLowerCase().includes(searchVal)) ||
      (t.subject && t.subject.toLowerCase().includes(searchVal)) ||
      (t.category && t.category.toLowerCase().includes(searchVal))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-16 text-outline font-mono text-xs">No tickets matching current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const statusBadges = {
      open: '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary-container/20 text-secondary border border-secondary/30 font-mono text-[10px] font-medium"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> Open</span>',
      claimed: '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-tertiary-container/30 text-tertiary border border-tertiary/30 font-mono text-[10px] font-medium"><span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span> Claimed</span>',
      closed: '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-outline border border-outline-variant font-mono text-[10px] font-medium"><span class="w-1.5 h-1.5 rounded-full bg-outline"></span> Closed</span>'
    };

    const claimedStr = t.claimedBy ? escapeHtml(t.claimedBy.tag || t.claimedBy.username) : '<span class="text-outline">Unassigned</span>';
    const dateStr = new Date(t.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const avatar = t.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png';

    return `
      <tr class="hover:bg-surface-container-low transition cursor-pointer" onclick="inspectTicket('${t.id}')">
        <td class="py-3 px-4 font-mono font-medium text-outline">#${t.id.replace('ticket-', '').toUpperCase()}</td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-2">
            <img class="w-6 h-6 rounded-full bg-surface-container-high object-cover shrink-0" src="${avatar}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="flex flex-col min-w-0">
              <span class="font-medium text-on-surface truncate">${escapeHtml(t.userTag)}</span>
              <span class="font-mono text-[10px] text-outline truncate">${t.userId || ''}</span>
            </div>
          </div>
        </td>
        <td class="py-3 px-4 text-outline font-mono text-[11px]">${escapeHtml(t.category || 'General')}</td>
        <td class="py-3 px-4 min-w-0 max-w-[280px]">
          <div class="text-on-surface font-medium truncate">${escapeHtml(t.subject || 'Support')}</div>
          <div class="text-outline text-[11px] truncate">${escapeHtml(t.description || 'Ticket created in Empirial')}</div>
        </td>
        <td class="py-3 px-4 text-on-surface text-[11px] font-mono">${claimedStr}</td>
        <td class="py-3 px-4">${statusBadges[t.status] || t.status}</td>
        <td class="py-3 px-4 text-outline font-mono text-[11px]">${dateStr}</td>
        <td class="py-3 px-4 text-right space-x-1.5">
          <button onclick="event.stopPropagation(); inspectTicket('${t.id}')" class="px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface font-mono text-[11px] transition border border-outline-variant/30">
            View
          </button>
          ${t.transcriptFile ? `
            <a href="/raw-transcripts/${t.transcriptFile}" target="_blank" onclick="event.stopPropagation();" class="inline-block px-2 py-1 rounded bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface text-[10px] font-mono transition border border-outline-variant/30" title="View Transcript">
              HTML
            </a>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

// Export Tickets as JSON
function exportTickets() {
  if (!allTicketsCache || allTicketsCache.length === 0) {
    return showToast('No ticket records available to export.', 'info');
  }
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allTicketsCache, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  dlAnchorElem.setAttribute("download", `empirial_tickets_export_${Date.now()}.json`);
  dlAnchorElem.click();
  showToast('Exported tickets to JSON file', 'success');
}

// Inspect Ticket (Switches to Detail View)
async function inspectTicket(ticketId) {
  currentActiveTicketId = ticketId;
  switchView('ticket-detail');

  try {
    const res = await authFetch(`/api/tickets/${ticketId}`);
    const ticket = await res.json();

    // Populate Headers
    const detailId = document.getElementById('detail-ticket-id');
    const detailSub = document.getElementById('detail-ticket-subject');
    const detailBy = document.getElementById('detail-opened-by');
    const detailCh = document.getElementById('detail-channel-name');

    if (detailId) detailId.textContent = `#${ticket.id.replace('ticket-', '').toUpperCase()}`;
    if (detailSub) detailSub.textContent = ticket.subject || 'Support Request';
    if (detailBy) detailBy.textContent = `Opened by @${ticket.userTag}`;
    if (detailCh) detailCh.textContent = `#${ticket.channelId ? 'ticket-' + ticket.id.replace('ticket-', '') : 'channel'}`;

    // Populate Rail Inspector
    const railId = document.getElementById('rail-ticket-id');
    const railCh = document.getElementById('rail-channel-id');
    const railSt = document.getElementById('rail-status');
    const railCat = document.getElementById('rail-category');
    const railCr = document.getElementById('rail-created');

    if (railId) railId.textContent = `#${ticket.id.replace('ticket-', '').toUpperCase()}`;
    if (railCh) railCh.textContent = ticket.channelId || '--';
    if (railSt) {
      railSt.textContent = ticket.status.toUpperCase();
      railSt.className = ticket.status === 'open' ? 'text-secondary font-semibold' : (ticket.status === 'claimed' ? 'text-tertiary font-semibold' : 'text-outline font-semibold');
    }
    if (railCat) railCat.textContent = ticket.category || 'General';
    if (railCr) railCr.textContent = new Date(ticket.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Opened by user card
    const railAv = document.getElementById('rail-user-avatar');
    const railName = document.getElementById('rail-user-name');
    const railUid = document.getElementById('rail-user-id');
    if (railAv) railAv.src = ticket.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    if (railName) railName.textContent = `@${ticket.userTag || 'Discord User'}`;
    if (railUid) railUid.textContent = ticket.userId || 'Snowflake ID';

    // Staff Assigned card
    const railStaff = document.getElementById('rail-staff-name');
    const staffText = ticket.claimedBy ? (ticket.claimedBy.tag || ticket.claimedBy.username) : 'Unassigned';
    if (railStaff) railStaff.textContent = staffText;

    // Actions
    const closeBtn = document.getElementById('detail-close-btn');
    const claimBtn = document.getElementById('detail-claim-btn');
    const transcriptBtn = document.getElementById('detail-transcript-btn');

    if (ticket.status === 'closed') {
      if (closeBtn) closeBtn.classList.add('hidden');
      if (claimBtn) claimBtn.classList.add('hidden');
    } else {
      if (closeBtn) closeBtn.classList.remove('hidden');
      if (claimBtn) claimBtn.classList.remove('hidden');
    }

    if (ticket.transcriptFile && transcriptBtn) {
      transcriptBtn.href = `/raw-transcripts/${ticket.transcriptFile}`;
      transcriptBtn.classList.remove('hidden');
    } else if (transcriptBtn) {
      transcriptBtn.href = '#';
      transcriptBtn.classList.add('hidden');
    }

    // Render Chat Messages
    const container = document.getElementById('detail-messages-container');
    if (!container) return;
    container.innerHTML = '';

    if (!ticket.messages || ticket.messages.length === 0) {
      container.innerHTML = `
        <div class="text-center py-16 text-outline space-y-2 select-none font-mono">
          <span class="material-symbols-outlined text-4xl text-outline-variant">chat_bubble_outline</span>
          <p class="text-xs">No chat messages recorded yet in this ticket.</p>
        </div>
      `;
    } else {
      ticket.messages.forEach(msg => appendChatMessage(msg));
    }
  } catch (err) {
    showToast(`Error opening ticket: ${err.message}`, 'error');
  }
}

// Append Chat Message into Transcript View
function appendChatMessage(msg) {
  const container = document.getElementById('detail-messages-container');
  if (!container) return;

  const isStaff = msg.author.bot || msg.author.id === 'web-staff';
  const avatar = msg.author.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
  const authorName = escapeHtml(msg.author.username || msg.author.tag || 'User');
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msgDiv = document.createElement('div');
  msgDiv.className = 'group flex gap-3 px-3 py-2 rounded hover:bg-surface-container transition-colors';
  msgDiv.innerHTML = `
    <img class="w-8 h-8 rounded-full object-cover shrink-0 select-none shadow-sm mt-0.5" src="${avatar}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 mb-1">
        <span class="font-medium text-xs text-on-surface">${authorName}</span>
        ${isStaff ? '<span class="bg-primary-container text-white text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold tracking-wider">STAFF</span>' : ''}
        <span class="text-[11px] font-mono text-outline">${time}</span>
      </div>
      <p class="text-xs text-on-surface-variant leading-relaxed break-words font-sans">
        ${escapeHtml(msg.content)}
      </p>
    </div>
  `;

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

// Send Staff Reply to Discord
async function sendStaffMessage() {
  const input = document.getElementById('detail-reply-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !currentActiveTicketId) return;

  try {
    input.value = '';
    const res = await authFetch(`/api/tickets/${currentActiveTicketId}/message`, {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast('Reply dispatched to Discord channel!', 'success');
  } catch (err) {
    showToast(`Failed to send message: ${err.message}`, 'error');
  }
}

// Claim Ticket
async function claimActiveTicket() {
  if (!currentActiveTicketId) return;
  try {
    const res = await authFetch(`/api/tickets/${currentActiveTicketId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ staffTag: 'Empirial Staff', staffUsername: 'Staff' })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Ticket claimed successfully!`, 'success');
    inspectTicket(currentActiveTicketId);
  } catch (err) {
    showToast(`Could not claim ticket: ${err.message}`, 'error');
  }
}

// Close Ticket
async function closeActiveTicket() {
  if (!currentActiveTicketId) return;
  if (!confirm(`Are you sure you want to close ${currentActiveTicketId.toUpperCase()}? An HTML transcript will be archived in Supabase.`)) return;

  try {
    const res = await authFetch(`/api/tickets/${currentActiveTicketId}/close`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Closed by Staff via Web Dashboard' })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Ticket ${currentActiveTicketId.toUpperCase()} closed and archived!`, 'success');
    inspectTicket(currentActiveTicketId);
    loadDashboardData();
  } catch (err) {
    showToast(`Failed to close ticket: ${err.message}`, 'error');
  }
}

// Sync Slash Commands
async function syncCommands() {
  try {
    showToast('Deploying slash commands to Discord...', 'info');
    const res = await authFetch('/api/sync-commands', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast('Slash commands synchronized with Discord!', 'success');
  } catch (err) {
    showToast(`Sync failed: ${err.message}`, 'error');
  }
}

// Load Guild Channels & Roles for Dropdowns
async function loadGuildData() {
  try {
    const res = await authFetch('/api/guild-data');
    const data = await res.json();

    const panelTargetSelect = document.getElementById('panel-target-channel');
    const configCategorySelect = document.getElementById('config-category');
    const configRoleSelect = document.getElementById('config-role');
    const configLogsSelect = document.getElementById('config-logs');

    if (!data.hasGuilds || data.guilds.length === 0) return;

    const guild = data.guilds[0];

    // Panel Target Channel
    if (panelTargetSelect) {
      panelTargetSelect.innerHTML = '<option value="">Select a channel from Empirial...</option>';
      guild.channels.forEach(ch => {
        panelTargetSelect.innerHTML += `<option value="${ch.id}">#${ch.name}</option>`;
      });
    }

    // Categories
    if (configCategorySelect) {
      configCategorySelect.innerHTML = '<option value="">Auto-create "🎫 EMPIRIAL TICKETS"</option>';
      guild.categories.forEach(cat => {
        configCategorySelect.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
      });
    }

    // Roles
    if (configRoleSelect) {
      configRoleSelect.innerHTML = '<option value="">Server Admins Only</option>';
      guild.roles.forEach(role => {
        configRoleSelect.innerHTML += `<option value="${role.id}">@${role.name}</option>`;
      });
    }

    // Logs
    if (configLogsSelect) {
      configLogsSelect.innerHTML = '<option value="">Disabled (No log channel)</option>';
      guild.channels.forEach(ch => {
        configLogsSelect.innerHTML += `<option value="${ch.id}">#${ch.name}</option>`;
      });
    }
  } catch (err) {
    console.warn('Could not load guild data:', err);
  }
}

// Load Config
async function loadConfig() {
  try {
    const res = await authFetch('/api/config');
    const config = await res.json();

    if (config.ticketCategoryId && document.getElementById('config-category')) document.getElementById('config-category').value = config.ticketCategoryId;
    if (config.supportRoleId && document.getElementById('config-role')) document.getElementById('config-role').value = config.supportRoleId;
    if (config.logsChannelId && document.getElementById('config-logs')) document.getElementById('config-logs').value = config.logsChannelId;
    if (config.maxOpenTicketsPerUser && document.getElementById('config-limit')) document.getElementById('config-limit').value = config.maxOpenTicketsPerUser;

    const panel = config.panelConfig || {};
    if (panel.title && document.getElementById('panel-title-input')) document.getElementById('panel-title-input').value = panel.title;
    if (panel.description && document.getElementById('panel-desc-input')) document.getElementById('panel-desc-input').value = panel.description;
    if (panel.color) {
      if (document.getElementById('panel-color-picker')) document.getElementById('panel-color-picker').value = panel.color;
      if (document.getElementById('panel-color-text')) document.getElementById('panel-color-text').value = panel.color;
    }
    if (panel.buttonText && document.getElementById('panel-btn-text')) document.getElementById('panel-btn-text').value = panel.buttonText;

    updatePanelPreview();
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

// Update Embed Preview
function updatePanelPreview() {
  const title = document.getElementById('panel-title-input')?.value || '👑 Empirial Support Tickets';
  const desc = document.getElementById('panel-desc-input')?.value || 'Select a category to open a ticket.';
  const color = document.getElementById('panel-color-text')?.value || '#5865f2';
  const btn = document.getElementById('panel-btn-text')?.value || 'Open Ticket';

  const previewTitle = document.getElementById('preview-panel-title');
  const previewDesc = document.getElementById('preview-panel-desc');
  const previewBtn = document.getElementById('preview-panel-btn');
  const previewCard = document.getElementById('preview-panel-card');

  if (previewTitle) previewTitle.textContent = title;
  if (previewDesc) previewDesc.textContent = desc;
  if (previewBtn) previewBtn.innerHTML = `<span>✉️</span><span>${escapeHtml(btn)}</span>`;
  if (previewCard) previewCard.style.borderLeftColor = color;
}

// Deploy Panel to Discord
async function deployPanelToDiscord() {
  const channelId = document.getElementById('panel-target-channel')?.value;
  if (!channelId) {
    return showToast('Please select a target channel first!', 'error');
  }

  try {
    const res = await authFetch('/api/panel/deploy', {
      method: 'POST',
      body: JSON.stringify({ channelId })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast('Ticket panel dispatched successfully to Discord!', 'success');
  } catch (err) {
    showToast(`Failed to deploy panel: ${err.message}`, 'error');
  }
}

// Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const sessionToken = localStorage.getItem('empirial_session');
    const headers = sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {};
    const res = await fetch('/api/auth/me', { headers, credentials: 'include' });
    const data = await res.json();
    if (!data.authenticated || !data.user || !data.user.isAdmin) {
      localStorage.removeItem('empirial_session');
      window.location.href = '/login';
      return;
    }

    currentUser = data.user;

    // Update user info in sidebar
    const nameEl = document.getElementById('sidebar-user-name');
    const roleEl = document.getElementById('sidebar-user-role');
    const avatarEl = document.getElementById('sidebar-user-avatar');
    if (nameEl) nameEl.textContent = `@${data.user.username}`;
    if (roleEl) roleEl.textContent = (data.user.roles && data.user.roles[0]) || 'Administrator';
    if (avatarEl && data.user.avatar) {
      avatarEl.src = `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png`;
    }

    initSocket();
    loadDashboardData();
  } catch (err) {
    window.location.href = '/login';
  }

  // Search input on All tickets
  document.getElementById('all-tickets-search')?.addEventListener('input', () => {
    renderAllTicketsTable();
  });

  // Global search (Ctrl+K or input)
  document.getElementById('global-search-input')?.addEventListener('input', (e) => {
    switchView('all-tickets');
    const targetSearch = document.getElementById('all-tickets-search');
    if (targetSearch) targetSearch.value = e.target.value;
    renderAllTicketsTable();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.getElementById('global-search-input')?.focus();
    }
  });

  // Chat reply input on Enter key
  document.getElementById('detail-reply-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendStaffMessage();
  });

  // Live Embed Preview Listeners
  ['panel-title-input', 'panel-desc-input', 'panel-color-text', 'panel-btn-text'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updatePanelPreview);
  });

  document.getElementById('panel-color-picker')?.addEventListener('input', (e) => {
    document.getElementById('panel-color-text').value = e.target.value;
    updatePanelPreview();
  });

  document.getElementById('panel-color-text')?.addEventListener('input', (e) => {
    document.getElementById('panel-color-picker').value = e.target.value;
    updatePanelPreview();
  });

  // System Config Form Submit
  document.getElementById('system-config-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      ticketCategoryId: document.getElementById('config-category').value || null,
      supportRoleId: document.getElementById('config-role').value || null,
      logsChannelId: document.getElementById('config-logs').value || null,
      maxOpenTicketsPerUser: parseInt(document.getElementById('config-limit').value) || 1,
      panelConfig: {
        title: document.getElementById('panel-title-input').value,
        description: document.getElementById('panel-desc-input').value,
        color: document.getElementById('panel-color-text').value,
        buttonText: document.getElementById('panel-btn-text').value
      }
    };

    try {
      const res = await authFetch('/api/config', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      showToast('Configuration saved to Supabase!', 'success');
    } catch (err) {
      showToast(`Failed to save config: ${err.message}`, 'error');
    }
  });
});

// =====================================================================
// DISCOHOOK V2 EMBED BUILDER ENGINE & LIVE PREVIEW CONTROLLER
// =====================================================================

let builderInitialized = false;
let builderChannelsCache = [];

// Default Discohook v2 Template (Exact replica from reference screenshots)
const defaultDiscohookState = {
  messageTitle: "Message 1 - Hey, welcome to <:discohook:736648398081622016> **Discohoo...",
  profile: {
    username: "Discohook",
    avatarUrl: ""
  },
  thread: {
    name: ""
  },
  attachmentUrl: "",
  items: [
    {
      id: "content_1",
      type: "content",
      collapsed: false,
      content: "Hey, welcome to <:discohook:736648398081622016> **Discohook**! The easiest way to personalize your Discord server.\n\nThere's more info below if you want to read it. When you're ready, create a new message in the editor (on the left), or you can play around with the default message.\n\n--",
      accessory: null
    },
    {
      id: "container_1",
      type: "container",
      collapsed: false,
      sidebarColor: "#37373d",
      spoiler: false,
      texts: [
        {
          id: "text_1_1",
          collapsed: false,
          content: "### What is this?",
          accessory: null
        },
        {
          id: "text_1_2",
          collapsed: false,
          content: "At its core, Discohook is a simple message designer. You can use it to send fully customizable messages to your Discord server with the use of [webhooks](https://support.discord.com/hc/en-us/articles/228383668).\n\n**Discohook Utils - complementary bot**\n\nYou can [invite our bot here](https://discord.com). In case you recognize that name, Discohook merged with Discohook Utils in 2024. If you have Discobot in your server, invite Discohook Utils instead for all future use.",
          accessory: null
        }
      ]
    },
    {
      id: "container_2",
      type: "container",
      collapsed: false,
      sidebarColor: "#37373d",
      spoiler: false,
      texts: [
        {
          id: "text_2_1",
          collapsed: false,
          content: "### Get started",
          accessory: null
        },
        {
          id: "text_2_2",
          collapsed: false,
          content: "- To send your first webhook message, click **Add Webhook** at the top left of the editor.\n- You'll be prompted to put in the URL of a webhook you have already created, or make a new one on the spot with **Create Webhook**.\n  - If you create a new webhook with this button, you'll be able to add buttons to your message as well.\n- Finish up by clicking **Add Webhook** inside the prompt.\n  - You should now see your webhook name & avatar at the top of the editor. If you would like to edit this webhook, click the pencil icon. To change the name/avatar for just one message, use the **Profile** section of the editor.\n- Now click **Send**. Choose which messages you would like to send with your webhook (they are all selected by default).",
          accessory: null
        }
      ]
    },
    {
      id: "row_1",
      type: "row",
      collapsed: false,
      components: [
        {
          id: "comp_1",
          type: "link_button",
          label: "Support Server",
          style: "link",
          url: "https://discord.gg",
          emoji: "",
          disabled: false
        },
        {
          id: "comp_2",
          type: "link_button",
          label: "Invite Bot",
          style: "link",
          url: "https://discord.com",
          emoji: "",
          disabled: false
        }
      ]
    }
  ]
};

// Active Working State
let builderState = JSON.parse(JSON.stringify(defaultDiscohookState));

// Initialize Builder View
async function initBuilder() {
  if (!builderInitialized) {
    builderInitialized = true;
    setupBuilderClickOutside();
    initPickerBoxEvents();
  }

  // Load Channels from Bot Gateway
  await loadBuilderChannels();

  // Initial Render
  renderBuilderTree();
  renderBuilderPreview();
}

// Load Guild Channels for Builder Dropdown
async function loadBuilderChannels() {
  const select = document.getElementById('builder-channel-select');
  if (!select) return;

  try {
    const res = await authFetch('/api/guild-data');
    const data = await res.json();

    select.innerHTML = '';
    builderChannelsCache = [];

    if (data.hasGuilds && data.guilds && data.guilds.length > 0) {
      data.guilds.forEach(guild => {
        if (guild.channels && guild.channels.length > 0) {
          const optGroup = document.createElement('optgroup');
          optGroup.label = guild.name;

          guild.channels.forEach(ch => {
            const opt = document.createElement('option');
            opt.value = ch.id;
            opt.textContent = `#${ch.name}`;
            optGroup.appendChild(opt);
            builderChannelsCache.push({ id: ch.id, name: ch.name, guildName: guild.name });
          });

          select.appendChild(optGroup);
        }
      });

      if (select.options.length > 0) {
        select.selectedIndex = 0;
        updatePreviewHeaderChannel();
      }
    } else {
      select.innerHTML = '<option value="" disabled>No text channels available</option>';
    }
  } catch (err) {
    console.warn('[Builder] Failed to load channels:', err);
    select.innerHTML = '<option value="" disabled>Failed to load channels</option>';
  }

  select.onchange = updatePreviewHeaderChannel;
}

function updatePreviewHeaderChannel() {
  const select = document.getElementById('builder-channel-select');
  const header = document.getElementById('preview-header-channel');
  if (select && header && select.selectedOptions[0]) {
    const text = select.selectedOptions[0].textContent.replace('#', '');
    header.textContent = text;
  }
}

// Global click outside to close menus
function setupBuilderClickOutside() {
  document.addEventListener('click', (e) => {
    // Close Custom Color Picker if clicking outside
    const picker = document.getElementById('discohook-color-picker-popover');
    if (picker && !picker.classList.contains('hidden')) {
      if (!picker.contains(e.target) && !e.target.closest('[id^="color-swatch-box-"]')) {
        picker.classList.add('hidden');
      }
    }

    const addMenu = document.getElementById('add-menu-popover');
    const addBtn = document.getElementById('btn-add-main');
    if (addMenu && !addMenu.classList.contains('hidden')) {
      if (!addMenu.contains(e.target) && !addBtn.contains(e.target)) {
        addMenu.classList.add('hidden');
      }
    }

    // Close any open accessory popovers
    document.querySelectorAll('.accessory-dropdown-menu').forEach(menu => {
      if (!menu.contains(e.target) && !e.target.closest('.btn-accessory-trigger')) {
        menu.classList.add('hidden');
      }
    });

    // Close any open component popovers
    document.querySelectorAll('.component-dropdown-menu').forEach(menu => {
      if (!menu.contains(e.target) && !e.target.closest('.btn-component-trigger')) {
        menu.classList.add('hidden');
      }
    });
  });
}

// Discord Markdown Parser
function parseDiscordMarkdown(text) {
  if (!text) return '';
  let str = escapeHtml(text);

  // Multi-line code blocks: ```code```
  str = str.replace(/```(?:([a-zA-Z0-9_+-]+)?\n)?([\s\S]*?)```/g, '<pre class="bg-[#1e1f22] p-2.5 rounded text-xs font-mono border border-[#2b2d31] my-1.5 overflow-x-auto text-[#dbdee1]"><code>$2</code></pre>');

  // Inline code: `code`
  str = str.replace(/`([^`\n]+)`/g, '<code class="bg-[#1e1f22] px-1 py-0.5 rounded text-xs font-mono text-[#dbdee1] border border-[#2b2d31]">$1</code>');

  // Spoilers: ||text||
  str = str.replace(/\|\|([\s\S]*?)\|\|/g, '<span class="bg-[#202225] text-transparent hover:text-white rounded px-1 cursor-pointer transition-all select-none hover:bg-[#2b2d31]" title="Spoiler" onclick="this.classList.toggle(\'text-transparent\')">$1</span>');

  // Headers: ###, ##, #
  str = str.replace(/^###\s+(.*)$/gm, '<h3 class="font-bold text-[16px] text-white mt-1 mb-0.5 leading-snug">$1</h3>');
  str = str.replace(/^##\s+(.*)$/gm, '<h2 class="font-bold text-[18px] text-white mt-1.5 mb-1 leading-snug">$1</h2>');
  str = str.replace(/^#\s+(.*)$/gm, '<h1 class="font-extrabold text-[20px] text-white mt-2 mb-1 leading-snug">$1</h1>');

  // Blockquotes: > text
  str = str.replace(/^>\s+(.*)$/gm, '<div class="border-l-4 border-[#4e5058] pl-2 text-[#dbdee1] my-1">$1</div>');

  // Discord bullet lists:
  // Nested sub-bullets (2+ spaces or tab followed by - or *)
  str = str.replace(/^(\s{2,}|\t)[-\*]\s+(.*)$/gm, '<div class="pl-4 flex items-start gap-1.5 my-0.5"><span class="text-[#949ba4] select-none text-[10px] mt-0.5">◦</span><span>$2</span></div>');
  // Top-level bullets (- or *)
  str = str.replace(/^[-\*]\s+(.*)$/gm, '<div class="pl-2 flex items-start gap-1.5 my-0.5"><span class="text-white select-none text-[12px] leading-none mt-1">•</span><span>$1</span></div>');

  // Bold & Italic: ***text***
  str = str.replace(/\*\*\*([^\*]+)\*\*\*/g, '<strong class="font-bold text-white"><em class="italic">$1</em></strong>');

  // Bold: **text**
  str = str.replace(/\*\*([^\*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>');

  // Italics: *text* or _text_
  str = str.replace(/\*([^\*]+)\*/g, '<em class="italic">$1</em>');
  str = str.replace(/_([^_]+)_/g, '<em class="italic">$1</em>');

  // Underline: __text__
  str = str.replace(/__([^_]+)__/g, '<u class="underline underline-offset-2">$1</u>');

  // Strikethrough: ~~text~~
  str = str.replace(/~~([^~]+)~~/g, '<s class="line-through text-[#949ba4]">$1</s>');

  // Links: [text](url)
  str = str.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[#00a8fc] hover:underline">$1</a>');

  // Custom Discord emojis: <:name:id>
  str = str.replace(/&lt;:([a-zA-Z0-9_]+):(\d+)&gt;/g, '<span class="inline-flex items-center text-xs bg-[#2b2d31] text-primary px-1.5 py-0.5 rounded border border-[#383a40] select-none font-mono">:$1:</span>');

  // Line breaks
  str = str.replace(/\n/g, '<br>');

  return str;
}

// Render the Left-hand Discohook v2 Tree Editor
function renderBuilderTree() {
  const treeContainer = document.getElementById('builder-tree');
  if (!treeContainer) return;

  // Calculate Total Characters
  let totalChars = 0;
  builderState.items.forEach(item => {
    if (item.type === 'content' && item.content) {
      totalChars += item.content.length;
    } else if (item.type === 'container' && item.texts) {
      item.texts.forEach(t => {
        if (t.content) totalChars += t.content.length;
      });
    }
  });

  const totalCharsEl = document.getElementById('builder-total-chars');
  if (totalCharsEl) {
    totalCharsEl.textContent = totalChars;
    totalCharsEl.className = totalChars > 4000 ? 'font-mono text-error font-bold' : 'font-mono text-[#dbdee1]';
  }

  // Update Title
  const titlePreview = document.getElementById('builder-message-title-preview');
  if (titlePreview) {
    titlePreview.textContent = builderState.messageTitle || 'Message 1';
  }

  // Update Profile Inputs
  const usernameInput = document.getElementById('builder-profile-username');
  const avatarInput = document.getElementById('builder-profile-avatar');
  if (usernameInput) usernameInput.value = builderState.profile.username || '';
  if (avatarInput) avatarInput.value = builderState.profile.avatarUrl || '';

  treeContainer.innerHTML = '';

  // Render Items
  builderState.items.forEach((item, index) => {
    if (item.type === 'content') {
      treeContainer.appendChild(createContentTreeItem(item, index));
    } else if (item.type === 'container') {
      treeContainer.appendChild(createContainerTreeItem(item, index));
    } else if (item.type === 'row') {
      treeContainer.appendChild(createRowTreeItem(item, index));
    } else if (item.type === 'separator') {
      treeContainer.appendChild(createSeparatorTreeItem(item, index));
    }
  });
}

// 1. Content Item Component (Top-level Text)
function createContentTreeItem(item, index) {
  const div = document.createElement('div');
  div.className = 'bg-[#2b2d31] rounded-md p-3 border border-[#383a40] space-y-2.5 font-sans';
  div.id = `item-${item.id}`;

  const firstLine = (item.content || '').split('\n')[0].substring(0, 40) || 'Text block';

  div.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 cursor-pointer select-none" onclick="toggleItemCollapse('${item.id}')">
        <span class="material-symbols-outlined text-[18px] text-[#949ba4] transition-transform ${item.collapsed ? '' : 'rotate-180'}">expand_more</span>
        <span class="font-medium text-xs text-white truncate max-w-[280px]">Text ${index + 1} - ${escapeHtml(firstLine)}...</span>
      </div>
      <div class="flex items-center gap-1">
        ${index > 0 ? `<button onclick="moveItem('${item.id}', -1)" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Move Up"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_up</span></button>` : ''}
        ${index < builderState.items.length - 1 ? `<button onclick="moveItem('${item.id}', 1)" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Move Down"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_down</span></button>` : ''}
        <button onclick="duplicateItem('${item.id}')" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Duplicate"><span class="material-symbols-outlined text-[16px]">content_copy</span></button>
        <button onclick="deleteItem('${item.id}')" class="p-1 text-[#949ba4] hover:text-rose-400 rounded hover:bg-[#35373c]" title="Delete"><span class="material-symbols-outlined text-[16px]">delete</span></button>
      </div>
    </div>

    <div class="${item.collapsed ? 'hidden' : 'space-y-2'} pt-1">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-semibold text-[#dbdee1]">Content*</span>
        <span class="italic text-[11px] text-[#949ba4] font-mono">${(item.content || '').length}/4000</span>
      </div>

      <textarea class="w-full h-24 bg-[#1e1f22] border border-[#383a40] rounded p-2.5 text-xs text-white placeholder-[#80848e] focus:border-[#5865f2] outline-none resize-y font-sans" placeholder="Message content..." oninput="updateItemContent('${item.id}', this.value)">${escapeHtml(item.content || '')}</textarea>

      <!-- Accessory Area -->
      <div class="pt-1">
        <label class="block text-[11px] font-medium text-[#949ba4] mb-1.5">Accessory</label>
        ${item.accessory ? renderAccessoryDetails(item.id, null, item.accessory) : renderAddAccessoryButton(item.id, null)}
      </div>
    </div>
  `;

  return div;
}

// 2. Container Item Component (Components v2 / Embed)
function createContainerTreeItem(item, index) {
  const div = document.createElement('div');
  const sidebarColor = item.sidebarColor || '#37373d';
  div.className = 'bg-[#2b2d31] rounded-md p-3 border border-[#383a40] space-y-3 font-sans transition-all';
  div.style.borderLeft = `4px solid ${sidebarColor}`;
  div.id = `item-${item.id}`;

  const firstText = item.texts && item.texts[0] ? (item.texts[0].content || '').split('\n')[0].substring(0, 35) : 'Container';

  let textsHtml = '';
  if (item.texts && item.texts.length > 0) {
    textsHtml = item.texts.map((t, tIndex) => `
      <div class="bg-[#232428] rounded p-2.5 border border-[#313338] space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 cursor-pointer select-none" onclick="toggleContainerTextCollapse('${item.id}', '${t.id}')">
            <span class="material-symbols-outlined text-[16px] text-[#949ba4] transition-transform ${t.collapsed ? '' : 'rotate-180'}">expand_more</span>
            <span class="font-medium text-xs text-white truncate max-w-[240px]">Text ${tIndex + 1} - ${escapeHtml(t.content.split('\n')[0].substring(0, 30))}</span>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="duplicateContainerText('${item.id}', '${t.id}')" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Duplicate"><span class="material-symbols-outlined text-[15px]">content_copy</span></button>
            <button onclick="deleteContainerText('${item.id}', '${t.id}')" class="p-1 text-[#949ba4] hover:text-rose-400 rounded hover:bg-[#35373c]" title="Delete"><span class="material-symbols-outlined text-[15px]">delete</span></button>
          </div>
        </div>

        <div class="${t.collapsed ? 'hidden' : 'space-y-2'} pt-1">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-[#dbdee1]">Content*</span>
            <span class="italic text-[11px] text-[#949ba4] font-mono">${(t.content || '').length}/4000</span>
          </div>
          <textarea class="w-full h-20 bg-[#1e1f22] border border-[#383a40] rounded p-2 text-xs text-white placeholder-[#80848e] focus:border-[#5865f2] outline-none resize-y font-sans" placeholder="Container markdown content..." oninput="updateContainerText('${item.id}', '${t.id}', this.value)">${escapeHtml(t.content || '')}</textarea>

          <div class="pt-1">
            <label class="block text-[11px] font-medium text-[#949ba4] mb-1">Accessory</label>
            ${t.accessory ? renderAccessoryDetails(item.id, t.id, t.accessory) : renderAddAccessoryButton(item.id, t.id)}
          </div>
        </div>
      </div>
    `).join('');
  }

  div.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 cursor-pointer select-none" onclick="toggleItemCollapse('${item.id}')">
        <span class="material-symbols-outlined text-[18px] text-[#949ba4] transition-transform ${item.collapsed ? '' : 'rotate-180'}">expand_more</span>
        <span class="font-medium text-xs text-white truncate max-w-[280px]">Container ${index + 1} - ${escapeHtml(firstText)}</span>
      </div>
      <div class="flex items-center gap-1">
        ${index > 0 ? `<button onclick="moveItem('${item.id}', -1)" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Move Up"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_up</span></button>` : ''}
        ${index < builderState.items.length - 1 ? `<button onclick="moveItem('${item.id}', 1)" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Move Down"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_down</span></button>` : ''}
        <button onclick="duplicateItem('${item.id}')" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Duplicate"><span class="material-symbols-outlined text-[16px]">content_copy</span></button>
        <button onclick="deleteItem('${item.id}')" class="p-1 text-[#949ba4] hover:text-rose-400 rounded hover:bg-[#35373c]" title="Delete"><span class="material-symbols-outlined text-[16px]">delete</span></button>
      </div>
    </div>

    <div class="${item.collapsed ? 'hidden' : 'space-y-3'} pt-1">
      <!-- Mark as spoiler -->
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" ${item.spoiler ? 'checked' : ''} onchange="updateContainerSpoiler('${item.id}', this.checked)" class="w-4 h-4 rounded bg-[#1e1f22] border-[#383a40] text-[#5865f2] focus:ring-0">
        <span class="text-xs text-[#dbdee1]">Mark as spoiler</span>
      </label>

      <!-- Sidebar Colour Input & Swatch (Exact screenshot match) -->
      <div>
        <label class="block text-[11px] font-medium text-[#dbdee1] mb-1">Sidebar Colour</label>
        <div class="flex items-center gap-2">
          <input type="text" id="color-hex-input-${item.id}" value="${sidebarColor}" class="flex-1 bg-[#1e1f22] border border-[#383a40] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-[#5865f2] outline-none uppercase font-semibold" oninput="updateContainerColor('${item.id}', this.value)">
          <div id="color-swatch-box-${item.id}" onclick="openCustomColorPicker('${item.id}', event)" class="w-7 h-7 rounded overflow-hidden shrink-0 border border-[#383a40] cursor-pointer shadow-sm hover:scale-105 transition-transform" style="background-color: ${sidebarColor};" title="Click to open Discohook Color Picker"></div>
        </div>
      </div>

      <!-- Nested Text Blocks -->
      <div class="space-y-2 pt-1">
        ${textsHtml}
      </div>

      <!-- Add Text Button inside Container -->
      <button onclick="addContainerText('${item.id}')" class="w-full py-1.5 rounded bg-[#232428] hover:bg-[#313338] border border-[#383a40]/60 text-xs text-[#b5bac1] hover:text-white transition-colors flex items-center justify-center gap-1.5">
        <span class="material-symbols-outlined text-[15px]">add</span>
        <span>Add Text to Container</span>
      </button>
    </div>
  `;

  return div;
}

// 3. Action Row Item Component
function createRowTreeItem(item, index) {
  const div = document.createElement('div');
  div.className = 'bg-[#2b2d31] rounded-md p-3 border border-[#383a40] space-y-2.5 font-sans';
  div.id = `item-${item.id}`;

  const compsHtml = (item.components || []).map((c, cIndex) => `
    <div class="bg-[#232428] rounded p-2.5 border border-[#313338] space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 cursor-pointer select-none" onclick="toggleComponentCollapse('${item.id}', '${c.id}')">
          <span class="material-symbols-outlined text-[15px] text-[#949ba4]">${c.type === 'link_button' ? 'open_in_new' : 'smart_button'}</span>
          <span class="font-medium text-xs text-white truncate max-w-[200px]">${escapeHtml(c.label || 'Button')}</span>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="duplicateRowComponent('${item.id}', '${c.id}')" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Duplicate"><span class="material-symbols-outlined text-[15px]">content_copy</span></button>
          <button onclick="deleteRowComponent('${item.id}', '${c.id}')" class="p-1 text-[#949ba4] hover:text-rose-400 rounded hover:bg-[#35373c]" title="Delete"><span class="material-symbols-outlined text-[15px]">delete</span></button>
        </div>
      </div>

      <div class="${c.collapsed ? 'hidden' : 'space-y-2'} pt-1">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] font-medium text-[#949ba4] mb-0.5">Label</label>
            <input type="text" value="${escapeHtml(c.label || '')}" class="w-full bg-[#1e1f22] border border-[#383a40] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#5865f2]" oninput="updateRowComponent('${item.id}', '${c.id}', 'label', this.value)">
          </div>
          <div>
            <label class="block text-[10px] font-medium text-[#949ba4] mb-0.5">Style</label>
            <select class="w-full bg-[#1e1f22] border border-[#383a40] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#5865f2]" onchange="updateRowComponent('${item.id}', '${c.id}', 'style', this.value)">
              <option value="link" ${c.style === 'link' ? 'selected' : ''}>Link (External)</option>
              <option value="primary" ${c.style === 'primary' ? 'selected' : ''}>Primary (Blurple)</option>
              <option value="secondary" ${c.style === 'secondary' ? 'selected' : ''}>Secondary (Grey)</option>
              <option value="success" ${c.style === 'success' ? 'selected' : ''}>Success (Green)</option>
              <option value="danger" ${c.style === 'danger' ? 'selected' : ''}>Danger (Red)</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-[10px] font-medium text-[#949ba4] mb-0.5">${c.style === 'link' || c.type === 'link_button' ? 'URL (https://...)' : 'Custom ID'}</label>
          <input type="${c.style === 'link' || c.type === 'link_button' ? 'url' : 'text'}" value="${escapeHtml(c.url || c.customId || '')}" placeholder="${c.style === 'link' || c.type === 'link_button' ? 'https://discord.gg' : 'btn_action_id'}" class="w-full bg-[#1e1f22] border border-[#383a40] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#5865f2]" oninput="updateRowComponent('${item.id}', '${c.id}', '${c.style === 'link' || c.type === 'link_button' ? 'url' : 'customId'}', this.value)">
        </div>

        <div class="flex items-center justify-between pt-1">
          <div class="flex items-center gap-1.5">
            <label class="text-[10px] font-medium text-[#949ba4]">Emoji:</label>
            <input type="text" value="${escapeHtml(c.emoji || '')}" placeholder="↗" class="w-12 bg-[#1e1f22] border border-[#383a40] rounded px-1.5 py-0.5 text-xs text-white text-center outline-none focus:border-[#5865f2]" oninput="updateRowComponent('${item.id}', '${c.id}', 'emoji', this.value)">
          </div>
          <label class="flex items-center gap-1.5 cursor-pointer text-[11px] text-[#949ba4]">
            <input type="checkbox" ${c.disabled ? 'checked' : ''} onchange="updateRowComponent('${item.id}', '${c.id}', 'disabled', this.checked)" class="w-3.5 h-3.5 rounded bg-[#1e1f22] border-[#383a40] text-[#5865f2]">
            <span>Disabled</span>
          </label>
        </div>
      </div>
    </div>
  `).join('');

  div.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 cursor-pointer select-none" onclick="toggleItemCollapse('${item.id}')">
        <span class="material-symbols-outlined text-[18px] text-[#949ba4] transition-transform ${item.collapsed ? '' : 'rotate-180'}">expand_more</span>
        <span class="font-medium text-xs text-white truncate max-w-[280px]">Row ${index + 1}</span>
      </div>
      <div class="flex items-center gap-1">
        ${index > 0 ? `<button onclick="moveItem('${item.id}', -1)" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Move Up"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_up</span></button>` : ''}
        ${index < builderState.items.length - 1 ? `<button onclick="moveItem('${item.id}', 1)" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Move Down"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_down</span></button>` : ''}
        <button onclick="duplicateItem('${item.id}')" class="p-1 text-[#949ba4] hover:text-white rounded hover:bg-[#35373c]" title="Duplicate"><span class="material-symbols-outlined text-[16px]">content_copy</span></button>
        <button onclick="deleteItem('${item.id}')" class="p-1 text-[#949ba4] hover:text-rose-400 rounded hover:bg-[#35373c]" title="Delete"><span class="material-symbols-outlined text-[16px]">delete</span></button>
      </div>
    </div>

    <div class="${item.collapsed ? 'hidden' : 'space-y-2.5'} pt-1">
      <div class="space-y-2">
        ${compsHtml}
      </div>

      <!-- Add Component Dropdown -->
      <div class="relative pt-1">
        <button onclick="toggleComponentMenu('${item.id}')" class="btn-component-trigger h-7 px-3 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-medium transition-colors flex items-center gap-1">
          <span>Add Component</span>
          <span class="material-symbols-outlined text-[15px]">expand_more</span>
        </button>

        <!-- Dropdown Popover (Exact Screenshot Match) -->
        <div id="comp-menu-${item.id}" class="component-dropdown-menu hidden absolute left-0 top-8 w-40 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl z-30 py-1 font-sans text-xs">
          <button onclick="addRowComponent('${item.id}', 'button'); toggleComponentMenu('${item.id}');" class="w-full flex items-center gap-2.5 px-3 py-2 text-[#dbdee1] hover:bg-[#232428] hover:text-white transition-colors text-left">
            <span class="material-symbols-outlined text-[15px] text-[#949ba4]">smart_button</span>
            <span>Button</span>
          </button>
          <button onclick="addRowComponent('${item.id}', 'link_button'); toggleComponentMenu('${item.id}');" class="w-full flex items-center gap-2.5 px-3 py-2 text-[#dbdee1] hover:bg-[#232428] hover:text-white transition-colors text-left">
            <span class="material-symbols-outlined text-[15px] text-[#949ba4]">open_in_new</span>
            <span>Link Button</span>
          </button>
        </div>
      </div>
    </div>
  `;

  return div;
}

// 4. Separator Item
function createSeparatorTreeItem(item, index) {
  const div = document.createElement('div');
  div.className = 'bg-[#2b2d31] rounded-md p-2.5 border border-[#383a40] flex items-center justify-between text-xs text-[#949ba4]';
  div.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-[16px]">horizontal_rule</span>
      <span>Separator Divider</span>
    </div>
    <button onclick="deleteItem('${item.id}')" class="text-[#949ba4] hover:text-rose-400 p-1 rounded hover:bg-[#35373c]"><span class="material-symbols-outlined text-[16px]">delete</span></button>
  `;
  return div;
}

// Accessory Helpers
function renderAddAccessoryButton(itemId, subTextId) {
  const targetKey = subTextId ? `${itemId}_${subTextId}` : itemId;
  return `
    <div class="relative">
      <button onclick="toggleAccessoryMenu('${targetKey}')" class="btn-accessory-trigger h-7 px-3 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-medium transition-colors flex items-center gap-1 shadow-sm">
        <span>Add Accessory</span>
        <span class="material-symbols-outlined text-[15px]">expand_more</span>
      </button>

      <!-- Accessory Dropdown Popover (Exact Discohook match: Button, Link Button, Thumbnail) -->
      <div id="acc-menu-${targetKey}" class="accessory-dropdown-menu hidden absolute left-0 top-8 w-40 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl z-30 py-1 font-sans text-xs">
        <button onclick="setAccessory('${itemId}', '${subTextId || ''}', 'button'); toggleAccessoryMenu('${targetKey}');" class="w-full flex items-center gap-2.5 px-3 py-2 text-[#dbdee1] hover:bg-[#232428] hover:text-white transition-colors text-left">
          <span class="material-symbols-outlined text-[15px] text-[#949ba4]">smart_button</span>
          <span>Button</span>
        </button>
        <button onclick="setAccessory('${itemId}', '${subTextId || ''}', 'link_button'); toggleAccessoryMenu('${targetKey}');" class="w-full flex items-center gap-2.5 px-3 py-2 text-[#dbdee1] hover:bg-[#232428] hover:text-white transition-colors text-left">
          <span class="material-symbols-outlined text-[15px] text-[#949ba4]">open_in_new</span>
          <span>Link Button</span>
        </button>
        <button onclick="setAccessory('${itemId}', '${subTextId || ''}', 'thumbnail'); toggleAccessoryMenu('${targetKey}');" class="w-full flex items-center gap-2.5 px-3 py-2 text-[#dbdee1] hover:bg-[#232428] hover:text-white transition-colors text-left">
          <span class="material-symbols-outlined text-[15px] text-[#949ba4]">image</span>
          <span>Thumbnail</span>
        </button>
      </div>
    </div>
  `;
}

function renderAccessoryDetails(itemId, subTextId, accessory) {
  const isThumbnail = accessory.type === 'thumbnail';
  return `
    <div class="bg-[#1e1f22] border border-[#383a40] rounded p-2.5 space-y-2">
      <div class="flex items-center justify-between">
        <span class="font-mono text-[10px] uppercase font-bold text-[#5865f2] bg-[#5865f2]/10 px-1.5 py-0.5 rounded">${accessory.type}</span>
        <button onclick="removeAccessory('${itemId}', '${subTextId || ''}')" class="text-[#949ba4] hover:text-rose-400 p-1"><span class="material-symbols-outlined text-[15px]">delete</span></button>
      </div>

      ${isThumbnail ? `
        <div>
          <label class="block text-[10px] text-[#949ba4] mb-0.5">Thumbnail Image URL</label>
          <input type="url" value="${escapeHtml(accessory.url || '')}" placeholder="https://cdn.discordapp.com/..." class="w-full bg-[#111214] border border-[#383a40] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#5865f2]" oninput="updateAccessoryField('${itemId}', '${subTextId || ''}', 'url', this.value)">
        </div>
      ` : `
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] text-[#949ba4] mb-0.5">Button Label</label>
            <input type="text" value="${escapeHtml(accessory.label || '')}" class="w-full bg-[#111214] border border-[#383a40] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#5865f2]" oninput="updateAccessoryField('${itemId}', '${subTextId || ''}', 'label', this.value)">
          </div>
          <div>
            <label class="block text-[10px] text-[#949ba4] mb-0.5">${accessory.type === 'link_button' ? 'Link URL' : 'Custom ID'}</label>
            <input type="text" value="${escapeHtml(accessory.url || accessory.customId || '')}" class="w-full bg-[#111214] border border-[#383a40] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#5865f2]" oninput="updateAccessoryField('${itemId}', '${subTextId || ''}', '${accessory.type === 'link_button' ? 'url' : 'customId'}', this.value)">
          </div>
        </div>
      `}
    </div>
  `;
}

// =====================================================================
// RENDER DISCORD LIVE PREVIEW (Pixel-perfect Client Dark Mode)
// =====================================================================
function renderBuilderPreview() {
  const botAvatar = document.getElementById('preview-bot-avatar');
  const botName = document.getElementById('preview-bot-name');
  const topContent = document.getElementById('preview-top-content');
  const containersList = document.getElementById('preview-containers-list');
  const rowsList = document.getElementById('preview-rows-list');

  if (!topContent || !containersList || !rowsList) return;

  // 1. Bot Profile
  if (botName) {
    botName.textContent = builderState.profile.username || (currentUser ? currentUser.username : 'Empirial');
  }

  if (botAvatar) {
    if (builderState.profile.avatarUrl) {
      botAvatar.src = builderState.profile.avatarUrl;
    } else if (currentUser && currentUser.avatar) {
      botAvatar.src = `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png`;
    } else {
      botAvatar.src = 'https://cdn.discordapp.com/embed/avatars/4.png';
    }
  }

  // 2. Top-level Content Text Blocks
  topContent.innerHTML = '';
  let hasTopContent = false;

  builderState.items.forEach(item => {
    if (item.type === 'content' && item.content && item.content.trim()) {
      hasTopContent = true;
      const p = document.createElement('div');
      p.className = 'space-y-1.5';
      p.innerHTML = parseDiscordMarkdown(item.content);

      if (item.accessory) {
        if (item.accessory.type === 'thumbnail' && item.accessory.url) {
          p.innerHTML += `<div class="pt-2"><img src="${escapeHtml(item.accessory.url)}" class="w-16 h-16 rounded object-cover border border-[#2b2d31]"></div>`;
        } else if (item.accessory.type === 'link_button' || item.accessory.type === 'button') {
          p.innerHTML += `
            <div class="pt-2">
              <button class="px-3.5 py-1.5 rounded-[3px] text-xs font-medium bg-[#4e5058] hover:bg-[#6d6f78] text-white flex items-center gap-1.5 cursor-pointer">
                <span>${escapeHtml(item.accessory.label || 'Action')}</span>
                ${item.accessory.type === 'link_button' ? '<span class="text-[11px]">↗</span>' : ''}
              </button>
            </div>
          `;
        }
      }

      topContent.appendChild(p);
    }
  });

  topContent.style.display = hasTopContent ? 'block' : 'none';

  // 3. Containers (Components v2 / Embeds)
  containersList.innerHTML = '';

  builderState.items.forEach(item => {
    if (item.type === 'container') {
      const card = document.createElement('div');
      const sidebarColor = item.sidebarColor || '#58b9ff';
      card.className = 'bg-[#2b2d31] rounded-[4px] p-3 text-[14px] leading-relaxed relative overflow-hidden transition-all space-y-2';
      card.style.borderLeft = `4px solid ${sidebarColor}`;

      // Thumbnail float
      let thumbnailHtml = '';
      if (item.texts) {
        for (const t of item.texts) {
          if (t.accessory && t.accessory.type === 'thumbnail' && t.accessory.url) {
            thumbnailHtml = `<img src="${escapeHtml(t.accessory.url)}" class="w-16 h-16 rounded object-cover float-right ml-3 mb-1 border border-[#1e1f22]/50 shadow-sm" alt="Thumbnail">`;
            break;
          }
        }
      }

      let innerTextsHtml = '';
      if (item.texts && item.texts.length > 0) {
        innerTextsHtml = item.texts.map(t => {
          let html = parseDiscordMarkdown(t.content || '');
          if (t.accessory && (t.accessory.type === 'link_button' || t.accessory.type === 'button')) {
            html += `
              <div class="pt-1.5">
                <button class="px-3.5 py-1 rounded-[3px] text-xs font-medium bg-[#4e5058] hover:bg-[#6d6f78] text-white flex items-center gap-1.5 cursor-pointer">
                  <span>${escapeHtml(t.accessory.label || 'Action')}</span>
                  ${t.accessory.type === 'link_button' ? '<span class="text-[11px]">↗</span>' : ''}
                </button>
              </div>
            `;
          }
          return `<div class="space-y-1">${html}</div>`;
        }).join('');
      }

      if (item.spoiler) {
        card.innerHTML = `
          <div class="cursor-pointer select-none filter blur-[5px] hover:blur-none transition-all" title="Click to view spoiler" onclick="this.classList.toggle('blur-[5px]')">
            ${thumbnailHtml}
            ${innerTextsHtml}
          </div>
        `;
      } else {
        card.innerHTML = `
          ${thumbnailHtml}
          ${innerTextsHtml}
        `;
      }

      containersList.appendChild(card);
    }
  });

  // 4. Action Rows (Buttons)
  rowsList.innerHTML = '';

  builderState.items.forEach(item => {
    if (item.type === 'row' && item.components && item.components.length > 0) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'flex flex-wrap gap-2 pt-1';

      item.components.forEach(comp => {
        const btn = document.createElement('button');
        
        const styleClasses = {
          link: 'bg-[#4e5058] hover:bg-[#6d6f78] text-white',
          secondary: 'bg-[#4e5058] hover:bg-[#6d6f78] text-white',
          primary: 'bg-[#5865f2] hover:bg-[#4752c4] text-white',
          success: 'bg-[#248046] hover:bg-[#1a6334] text-white',
          danger: 'bg-[#da373c] hover:bg-[#a12828] text-white'
        };

        const chosenStyle = comp.style || (comp.type === 'link_button' ? 'link' : 'primary');
        btn.className = `px-4 py-1.5 rounded-[3px] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none ${styleClasses[chosenStyle] || styleClasses.primary} ${comp.disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
        
        let labelHtml = '';
        if (comp.emoji) {
          labelHtml += `<span class="emoji text-xs">${escapeHtml(comp.emoji)}</span>`;
        }
        labelHtml += `<span>${escapeHtml(comp.label || 'Button')}</span>`;

        if (comp.type === 'link_button' || chosenStyle === 'link') {
          labelHtml += '<span class="text-[11px] leading-none ml-0.5">↗</span>';
        }

        btn.innerHTML = labelHtml;
        rowDiv.appendChild(btn);
      });

      rowsList.appendChild(rowDiv);
    }
  });
}

// =====================================================================
// TREE INTERACTION HANDLERS (Mutations & Re-renders)
// =====================================================================

function toggleAddMenu() {
  const popover = document.getElementById('add-menu-popover');
  if (popover) popover.classList.toggle('hidden');
}

function toggleAccessoryMenu(key) {
  const popover = document.getElementById(`acc-menu-${key}`);
  if (popover) popover.classList.toggle('hidden');
}

function toggleComponentMenu(rowId) {
  const popover = document.getElementById(`comp-menu-${rowId}`);
  if (popover) popover.classList.toggle('hidden');
}

function toggleMessageSettings() {
  const body = document.getElementById('msg-settings-body');
  const chevron = document.getElementById('msg-settings-chevron');
  if (body) body.classList.toggle('hidden');
  if (chevron) chevron.classList.toggle('rotate-180');
}

function toggleSubSection(name) {
  const section = document.getElementById(`section-${name}`);
  const chevron = document.getElementById(`chevron-${name}`);
  if (section) section.classList.toggle('hidden');
  if (chevron) chevron.classList.toggle('rotate-90');
}

function updateProfileSettings() {
  const username = document.getElementById('builder-profile-username')?.value;
  const avatar = document.getElementById('builder-profile-avatar')?.value;
  builderState.profile.username = username || '';
  builderState.profile.avatarUrl = avatar || '';
  renderBuilderPreview();
}

function promptRenameMessageTitle() {
  const current = builderState.messageTitle || '';
  const newTitle = prompt('Enter a title for this message:', current);
  if (newTitle !== null) {
    builderState.messageTitle = newTitle.trim();
    renderBuilderTree();
  }
}

function addBuilderItem(type) {
  const id = `item_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  if (type === 'content') {
    builderState.items.push({
      id,
      type: 'content',
      collapsed: false,
      content: '',
      accessory: null
    });
  } else if (type === 'container') {
    builderState.items.push({
      id,
      type: 'container',
      collapsed: false,
      sidebarColor: '#37373d',
      spoiler: false,
      texts: [
        {
          id: `text_${Date.now()}`,
          collapsed: false,
          content: '### New Container Header\nAdd your container description here...',
          accessory: null
        }
      ]
    });
  } else if (type === 'row') {
    builderState.items.push({
      id,
      type: 'row',
      collapsed: false,
      components: [
        {
          id: `comp_${Date.now()}`,
          type: 'link_button',
          label: 'Link Button',
          style: 'link',
          url: 'https://discord.com',
          emoji: '↗',
          disabled: false
        }
      ]
    });
  } else if (type === 'separator') {
    builderState.items.push({
      id,
      type: 'separator'
    });
  }

  renderBuilderTree();
  renderBuilderPreview();
}

function duplicateItem(id) {
  const index = builderState.items.findIndex(i => i.id === id);
  if (index !== -1) {
    const clone = JSON.parse(JSON.stringify(builderState.items[index]));
    clone.id = `item_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    builderState.items.splice(index + 1, 0, clone);
    renderBuilderTree();
    renderBuilderPreview();
  }
}

function deleteItem(id) {
  builderState.items = builderState.items.filter(i => i.id !== id);
  renderBuilderTree();
  renderBuilderPreview();
}

function moveItem(id, direction) {
  const index = builderState.items.findIndex(i => i.id === id);
  if (index === -1) return;
  const target = index + direction;
  if (target < 0 || target >= builderState.items.length) return;

  const temp = builderState.items[index];
  builderState.items[index] = builderState.items[target];
  builderState.items[target] = temp;

  renderBuilderTree();
  renderBuilderPreview();
}

function toggleItemCollapse(id) {
  const item = builderState.items.find(i => i.id === id);
  if (item) {
    item.collapsed = !item.collapsed;
    renderBuilderTree();
  }
}

function updateItemContent(id, value) {
  const item = builderState.items.find(i => i.id === id);
  if (item) {
    item.content = value;
    // update character counters dynamically
    renderBuilderPreview();
    
    // Update local counter inside item without full tree rebuild
    const el = document.getElementById(`item-${id}`);
    if (el) {
      const counter = el.querySelector('.char-count');
      if (counter) counter.textContent = `${value.length}/4000`;
    }

    // Update global counter
    let totalChars = 0;
    builderState.items.forEach(i => {
      if (i.type === 'content' && i.content) totalChars += i.content.length;
      else if (i.type === 'container' && i.texts) i.texts.forEach(t => totalChars += (t.content || '').length);
    });
    const totalCharsEl = document.getElementById('builder-total-chars');
    if (totalCharsEl) totalCharsEl.textContent = totalChars;
  }
}

// Container Text Operations
function addContainerText(containerId) {
  const container = builderState.items.find(i => i.id === containerId);
  if (container && container.texts) {
    container.texts.push({
      id: `text_${Date.now()}`,
      collapsed: false,
      content: 'New paragraph or bullet point...',
      accessory: null
    });
    renderBuilderTree();
    renderBuilderPreview();
  }
}

function duplicateContainerText(containerId, textId) {
  const container = builderState.items.find(i => i.id === containerId);
  if (container && container.texts) {
    const tIndex = container.texts.findIndex(t => t.id === textId);
    if (tIndex !== -1) {
      const clone = JSON.parse(JSON.stringify(container.texts[tIndex]));
      clone.id = `text_${Date.now()}`;
      container.texts.splice(tIndex + 1, 0, clone);
      renderBuilderTree();
      renderBuilderPreview();
    }
  }
}

function deleteContainerText(containerId, textId) {
  const container = builderState.items.find(i => i.id === containerId);
  if (container && container.texts) {
    container.texts = container.texts.filter(t => t.id !== textId);
    renderBuilderTree();
    renderBuilderPreview();
  }
}

function toggleContainerTextCollapse(containerId, textId) {
  const container = builderState.items.find(i => i.id === containerId);
  if (container && container.texts) {
    const t = container.texts.find(x => x.id === textId);
    if (t) {
      t.collapsed = !t.collapsed;
      renderBuilderTree();
    }
  }
}

function updateContainerText(containerId, textId, value) {
  const container = builderState.items.find(i => i.id === containerId);
  if (container && container.texts) {
    const t = container.texts.find(x => x.id === textId);
    if (t) {
      t.content = value;
      renderBuilderPreview();

      let totalChars = 0;
      builderState.items.forEach(i => {
        if (i.type === 'content' && i.content) totalChars += i.content.length;
        else if (i.type === 'container' && i.texts) i.texts.forEach(tx => totalChars += (tx.content || '').length);
      });
      const totalCharsEl = document.getElementById('builder-total-chars');
      if (totalCharsEl) totalCharsEl.textContent = totalChars;
    }
  }
}

function updateContainerColor(containerId, color) {
  const container = builderState.items.find(i => i.id === containerId);
  if (container) {
    if (!color.startsWith('#') && /^[0-9A-Fa-f]{3,6}$/.test(color)) {
      color = `#${color}`;
    }
    container.sidebarColor = color;
    
    // Update container left border in tree
    const cardEl = document.getElementById(`item-${containerId}`);
    if (cardEl) cardEl.style.borderLeft = `4px solid ${color}`;
    
    // Update container color swatch box in tree
    const swatchEl = document.getElementById(`color-swatch-box-${containerId}`);
    if (swatchEl) swatchEl.style.backgroundColor = color;

    // Update hex input in tree
    const hexInput = document.getElementById(`color-hex-input-${containerId}`);
    if (hexInput && hexInput !== document.activeElement) hexInput.value = color;

    renderBuilderPreview();
  }
}

// =====================================================================
// DISCOHOOK CUSTOM COLOR PICKER LOGIC (Hex 37373D as Primary Default)
// =====================================================================

const DEFAULT_DISCOHOOK_COLOR = '#37373D';
let activeColorPickerContainerId = null;
let pickerHue = 240;
let pickerSat = 0.10;
let pickerVal = 0.24;
let isDraggingPickerBox = false;

function hexToRgb(hex) {
  if (!hex) return { r: 55, g: 55, b: 61 };
  hex = hex.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  const num = parseInt(hex, 16);
  if (isNaN(num) || hex.length !== 6) return { r: 55, g: 55, b: 61 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHex(r, g, b) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s, v };
}

function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor((h / 60) % 6);
  const f = (h / 60) - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

// Open Color Picker for a specific container
function openCustomColorPicker(containerId, event) {
  if (event) event.stopPropagation();
  activeColorPickerContainerId = containerId;

  const container = builderState.items.find(i => i.id === containerId);
  const currentColor = (container && container.sidebarColor) ? container.sidebarColor : DEFAULT_DISCOHOOK_COLOR;

  // Set internal HSV state from current color
  const rgb = hexToRgb(currentColor);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  pickerHue = hsv.h;
  pickerSat = hsv.s;
  pickerVal = hsv.v;

  syncColorPickerUi(currentColor);

  // Position the popover right next to or below the trigger
  const popover = document.getElementById('discohook-color-picker-popover');
  if (popover && event && event.currentTarget) {
    const rect = event.currentTarget.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left - 210;

    if (top + 380 > window.innerHeight) {
      top = Math.max(10, rect.top - 380);
    }
    if (left < 10) left = 10;
    if (left + 300 > window.innerWidth) left = window.innerWidth - 310;

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.classList.remove('hidden');
  }
}

function syncColorPickerUi(hexColor) {
  const cleanHex = hexColor.replace('#', '').toUpperCase();
  const rgb = hexToRgb(cleanHex);

  // 1. Box background color to pure Hue
  const box = document.getElementById('dh-picker-box');
  if (box) box.style.backgroundColor = `hsl(${Math.round(pickerHue)}, 100%, 50%)`;

  // 2. Position the dot indicator
  const dot = document.getElementById('dh-picker-dot');
  if (dot) {
    dot.style.left = `${(pickerSat * 100).toFixed(1)}%`;
    dot.style.top = `${((1 - pickerVal) * 100).toFixed(1)}%`;
  }

  // 3. Hue slider thumb
  const hueSlider = document.getElementById('dh-hue-slider');
  const hueThumb = document.getElementById('dh-hue-thumb');
  if (hueSlider) hueSlider.value = Math.round(pickerHue);
  if (hueThumb) hueThumb.style.left = `${((pickerHue / 360) * 100).toFixed(1)}%`;

  // 4. Input values
  const inputHex = document.getElementById('dh-input-hex');
  const inputR = document.getElementById('dh-input-r');
  const inputG = document.getElementById('dh-input-g');
  const inputB = document.getElementById('dh-input-b');

  if (inputHex && inputHex !== document.activeElement) inputHex.value = cleanHex;
  if (inputR && inputR !== document.activeElement) inputR.value = rgb.r;
  if (inputG && inputG !== document.activeElement) inputG.value = rgb.g;
  if (inputB && inputB !== document.activeElement) inputB.value = rgb.b;

  // 5. Highlight active swatch if matching
  document.querySelectorAll('.dh-swatch').forEach(btn => {
    const title = btn.getAttribute('title') || '';
    if (title.toUpperCase().includes(cleanHex)) {
      btn.classList.add('ring-2', 'ring-white/80', 'border', 'border-white/40');
    } else {
      btn.classList.remove('ring-2', 'ring-white/80', 'border', 'border-white/40');
    }
  });
}

// When dragging inside 2D box
function initPickerBoxEvents() {
  const box = document.getElementById('dh-picker-box');
  if (!box) return;

  function updateFromBox(e) {
    const rect = box.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    pickerSat = x / rect.width;
    pickerVal = 1 - (y / rect.height);

    const rgb = hsvToRgb(pickerHue, pickerSat, pickerVal);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

    if (activeColorPickerContainerId) {
      applyColorToContainer(activeColorPickerContainerId, hex);
    }
    syncColorPickerUi(hex);
  }

  box.addEventListener('mousedown', (e) => {
    isDraggingPickerBox = true;
    updateFromBox(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingPickerBox) {
      updateFromBox(e);
    }
  });

  window.addEventListener('mouseup', () => {
    isDraggingPickerBox = false;
  });
}

// Hue slider change
function handleHueSliderInput(val) {
  pickerHue = parseFloat(val);
  const rgb = hsvToRgb(pickerHue, pickerSat, pickerVal);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

  if (activeColorPickerContainerId) {
    applyColorToContainer(activeColorPickerContainerId, hex);
  }
  syncColorPickerUi(hex);
}

// Hex input change in picker
function handlePickerHexChange(val) {
  let clean = val.replace('#', '').trim();
  if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
  if (clean.length !== 6) return;

  const hex = `#${clean.toUpperCase()}`;
  const rgb = hexToRgb(hex);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  pickerHue = hsv.h;
  pickerSat = hsv.s;
  pickerVal = hsv.v;

  if (activeColorPickerContainerId) {
    applyColorToContainer(activeColorPickerContainerId, hex);
  }
  syncColorPickerUi(hex);
}

// RGB input changes in picker
function handlePickerRgbChange() {
  const r = parseInt(document.getElementById('dh-input-r')?.value) || 0;
  const g = parseInt(document.getElementById('dh-input-g')?.value) || 0;
  const b = parseInt(document.getElementById('dh-input-b')?.value) || 0;

  const hex = rgbToHex(r, g, b);
  const hsv = rgbToHsv(r, g, b);
  pickerHue = hsv.h;
  pickerSat = hsv.s;
  pickerVal = hsv.v;

  if (activeColorPickerContainerId) {
    applyColorToContainer(activeColorPickerContainerId, hex);
  }
  syncColorPickerUi(hex);
}

// Palette swatch clicked
function setPickerColor(hex) {
  const rgb = hexToRgb(hex);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  pickerHue = hsv.h;
  pickerSat = hsv.s;
  pickerVal = hsv.v;

  if (activeColorPickerContainerId) {
    applyColorToContainer(activeColorPickerContainerId, hex);
  }
  syncColorPickerUi(hex);
}

// Reset button clicked -> sets to main default #37373D!
function resetPickerToDefault() {
  setPickerColor(DEFAULT_DISCOHOOK_COLOR);
}

// Apply color update to container, card left border, swatch, input, and live preview
function applyColorToContainer(containerId, color) {
  const container = builderState.items.find(i => i.id === containerId);
  if (container) {
    container.sidebarColor = color;
    
    // Card border
    const cardEl = document.getElementById(`item-${containerId}`);
    if (cardEl) cardEl.style.borderLeft = `4px solid ${color}`;

    // Swatch box
    const swatchEl = document.getElementById(`color-swatch-box-${containerId}`);
    if (swatchEl) swatchEl.style.backgroundColor = color;

    // Hex input
    const hexInput = document.getElementById(`color-hex-input-${containerId}`);
    if (hexInput && hexInput !== document.activeElement) hexInput.value = color;

    renderBuilderPreview();
  }
}

function updateContainerSpoiler(containerId, isSpoiler) {
  const container = builderState.items.find(i => i.id === containerId);
  if (container) {
    container.spoiler = isSpoiler;
    renderBuilderPreview();
  }
}

// Accessory Management
function setAccessory(itemId, subTextId, type) {
  const accessory = {
    type,
    url: '',
    label: type === 'thumbnail' ? '' : 'Button',
    style: type === 'link_button' ? 'link' : 'primary',
    customId: `btn_${Date.now()}`
  };

  if (subTextId) {
    const container = builderState.items.find(i => i.id === itemId);
    if (container && container.texts) {
      const t = container.texts.find(x => x.id === subTextId);
      if (t) t.accessory = accessory;
    }
  } else {
    const item = builderState.items.find(i => i.id === itemId);
    if (item) item.accessory = accessory;
  }

  renderBuilderTree();
  renderBuilderPreview();
}

function removeAccessory(itemId, subTextId) {
  if (subTextId) {
    const container = builderState.items.find(i => i.id === itemId);
    if (container && container.texts) {
      const t = container.texts.find(x => x.id === subTextId);
      if (t) t.accessory = null;
    }
  } else {
    const item = builderState.items.find(i => i.id === itemId);
    if (item) item.accessory = null;
  }

  renderBuilderTree();
  renderBuilderPreview();
}

function updateAccessoryField(itemId, subTextId, field, value) {
  let accessory = null;
  if (subTextId) {
    const container = builderState.items.find(i => i.id === itemId);
    const t = container && container.texts ? container.texts.find(x => x.id === subTextId) : null;
    if (t) accessory = t.accessory;
  } else {
    const item = builderState.items.find(i => i.id === itemId);
    if (item) accessory = item.accessory;
  }

  if (accessory) {
    accessory[field] = value;
    renderBuilderPreview();
  }
}

// Row Components Management
function addRowComponent(rowId, type) {
  const row = builderState.items.find(i => i.id === rowId);
  if (row) {
    if (!row.components) row.components = [];
    if (row.components.length >= 5) {
      showToast('Discord limits Action Rows to a maximum of 5 buttons.', 'error');
      return;
    }

    row.components.push({
      id: `comp_${Date.now()}`,
      type,
      label: type === 'link_button' ? 'Link Button' : 'Button',
      style: type === 'link_button' ? 'link' : 'primary',
      url: type === 'link_button' ? 'https://discord.com' : '',
      customId: `btn_${Date.now()}`,
      emoji: type === 'link_button' ? '↗' : '',
      disabled: false,
      collapsed: false
    });

    renderBuilderTree();
    renderBuilderPreview();
  }
}

function duplicateRowComponent(rowId, compId) {
  const row = builderState.items.find(i => i.id === rowId);
  if (row && row.components) {
    if (row.components.length >= 5) {
      showToast('Discord limits Action Rows to a maximum of 5 buttons.', 'error');
      return;
    }
    const index = row.components.findIndex(c => c.id === compId);
    if (index !== -1) {
      const clone = JSON.parse(JSON.stringify(row.components[index]));
      clone.id = `comp_${Date.now()}`;
      row.components.splice(index + 1, 0, clone);
      renderBuilderTree();
      renderBuilderPreview();
    }
  }
}

function deleteRowComponent(rowId, compId) {
  const row = builderState.items.find(i => i.id === rowId);
  if (row && row.components) {
    row.components = row.components.filter(c => c.id !== compId);
    renderBuilderTree();
    renderBuilderPreview();
  }
}

function toggleComponentCollapse(rowId, compId) {
  const row = builderState.items.find(i => i.id === rowId);
  if (row && row.components) {
    const c = row.components.find(x => x.id === compId);
    if (c) {
      c.collapsed = !c.collapsed;
      renderBuilderTree();
    }
  }
}

function updateRowComponent(rowId, compId, field, value) {
  const row = builderState.items.find(i => i.id === rowId);
  if (row && row.components) {
    const c = row.components.find(x => x.id === compId);
    if (c) {
      c[field] = value;
      if (field === 'style' && value === 'link') {
        c.type = 'link_button';
      }
      renderBuilderPreview();
    }
  }
}

// Global Controls
function resetBuilderSample() {
  if (confirm('Reset editor to the Discohook v2 default sample template?')) {
    builderState = JSON.parse(JSON.stringify(defaultDiscohookState));
    renderBuilderTree();
    renderBuilderPreview();
    showToast('Reset to Discohook v2 sample template', 'info');
  }
}

function clearEntireMessage() {
  if (confirm('Clear the entire editor message?')) {
    builderState = {
      messageTitle: 'New Message',
      profile: { username: '', avatarUrl: '' },
      thread: { name: '' },
      attachmentUrl: '',
      items: []
    };
    renderBuilderTree();
    renderBuilderPreview();
    showToast('Message cleared', 'info');
  }
}

function duplicateEntireMessage() {
  showToast('Message cloned into active draft', 'info');
}

// Send Message to Discord Channel via Bot
async function sendBuilderMessage() {
  const channelSelect = document.getElementById('builder-channel-select');
  const channelId = channelSelect?.value;

  if (!channelId) {
    showToast('Please select a target Discord channel first!', 'error');
    return;
  }

  const sendBtn = document.getElementById('builder-send-btn');
  const originalHtml = sendBtn.innerHTML;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Sending...</span>';

  // Construct Send Payload
  const topContents = builderState.items
    .filter(i => i.type === 'content' && i.content && i.content.trim())
    .map(i => i.content.trim());

  const containers = builderState.items
    .filter(i => i.type === 'container')
    .map(c => ({
      sidebarColor: c.sidebarColor || '#58b9ff',
      spoiler: !!c.spoiler,
      texts: (c.texts || []).map(t => ({
        content: t.content || '',
        accessory: t.accessory
      }))
    }));

  const rows = builderState.items
    .filter(i => i.type === 'row' && i.components && i.components.length > 0)
    .map(r => ({
      components: r.components.map(comp => ({
        type: comp.type,
        label: comp.label,
        style: comp.style,
        url: comp.url,
        customId: comp.customId,
        emoji: comp.emoji,
        disabled: !!comp.disabled
      }))
    }));

  const payload = {
    channelId,
    message: {
      profile: builderState.profile,
      content: topContents.join('\n\n'),
      containers,
      rows
    }
  };

  try {
    const res = await authFetch('/api/builder/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Dispatched to #${data.channelName || 'channel'}!`, 'success');
  } catch (err) {
    showToast(`Dispatch failed: ${err.message}`, 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalHtml;
  }
}

// JSON Modal Controls
function openJsonModal() {
  const modal = document.getElementById('json-modal');
  const textarea = document.getElementById('json-modal-textarea');
  if (modal && textarea) {
    textarea.value = JSON.stringify(builderState, null, 2);
    modal.classList.remove('hidden');
  }
}

function closeJsonModal() {
  const modal = document.getElementById('json-modal');
  if (modal) modal.classList.add('hidden');
}

function copyJsonToClipboard() {
  const textarea = document.getElementById('json-modal-textarea');
  if (textarea) {
    navigator.clipboard.writeText(textarea.value).then(() => {
      showToast('Discohook JSON copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Could not access clipboard', 'error');
    });
  }
}

function applyImportedJson() {
  const textarea = document.getElementById('json-modal-textarea');
  if (!textarea) return;

  try {
    const parsed = JSON.parse(textarea.value);
    
    // Validate / adapt
    if (parsed.items && Array.isArray(parsed.items)) {
      builderState = parsed;
    } else if (parsed.content || parsed.embeds) {
      // Standard Discord / Discohook payload format conversion
      const items = [];
      if (parsed.content) {
        items.push({
          id: `content_${Date.now()}`,
          type: 'content',
          content: parsed.content,
          accessory: null
        });
      }
      if (Array.isArray(parsed.embeds)) {
        parsed.embeds.forEach((e, idx) => {
          let hexColor = '#37373d';
          if (e.color) {
            hexColor = '#' + e.color.toString(16).padStart(6, '0');
          }
          items.push({
            id: `container_${idx}_${Date.now()}`,
            type: 'container',
            sidebarColor: hexColor,
            spoiler: false,
            texts: [
              {
                id: `text_${idx}_1`,
                content: (e.title ? `### ${e.title}\n` : '') + (e.description || ''),
                accessory: e.thumbnail && e.thumbnail.url ? { type: 'thumbnail', url: e.thumbnail.url } : null
              }
            ]
          });
        });
      }
      builderState.items = items;
      if (parsed.username) builderState.profile.username = parsed.username;
      if (parsed.avatar_url) builderState.profile.avatarUrl = parsed.avatar_url;
    } else {
      throw new Error('Unrecognized JSON structure');
    }

    renderBuilderTree();
    renderBuilderPreview();
    closeJsonModal();
    showToast('Imported JSON successfully applied!', 'success');
  } catch (err) {
    showToast(`Invalid JSON: ${err.message}`, 'error');
  }
}
