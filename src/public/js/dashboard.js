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
    window.location.href = '/login.html';
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
  window.location.href = '/login.html';
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
    'access': 'Access Control & Audit'
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
      window.location.href = '/login.html';
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
    window.location.href = '/login.html';
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