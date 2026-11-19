# 👑 Empirial Discord Ticket Bot & Unified Vercel Dashboard

A powerful, all-in-one Discord ticket bot and web management panel designed specifically for the **Empirial** Discord server. Built with Node.js, Discord.js v14, Express, Supabase Postgres, and Discord OAuth2 RBAC authentication.

- **GitHub Repository**: [https://github.com/aadi-devs/empirial-bot](https://github.com/aadi-devs/empirial-bot)
- **Live Vercel Production**: [https://empirial-bot-nu.vercel.app](https://empirial-bot-nu.vercel.app)
- **Database**: Supabase Postgres (Zero mock/simulated values)
- **Auth**: Discord OAuth2 with Server Administrator / Manage Guild verification

Runs unified on **Vercel Serverless** and locally with Node.js.

---

## 🌟 Key Features

### 🤖 Discord Ticket Bot
- **Interactive Ticket Panel (`/ticket-panel`)**: Send a rich embed with interactive category dropdowns and a quick "Open Ticket" button.
- **Smart Channel Creation**: Automatically generates private ticket channels under `🎫 EMPIRIAL TICKETS` category (`ticket-0001`, `ticket-0002`...).
- **Private Permission Management**: Isolates ticket rooms so only the ticket creator, bot, and configured Support Staff roles have access. `@everyone` is denied view permissions.
- **In-Ticket Control Panel**:
  - 🔒 **Close Ticket**: Confirms closure, generates an offline & online HTML transcript, saves to database, and deletes the channel after 5 seconds.
  - 📌 **Claim Ticket**: Marks the ticket as claimed by the clicking staff member.
  - 📜 **Instant Transcript**: Downloads the current conversation transcript right inside Discord.
- **Automatic HTML Transcripts**: Saves full chat transcripts (with embeds, avatars, timestamps, and attachment links) both as downloadable HTML and viewable on the web dashboard.
- **Direct Message Delivery**: Sends the ticket creator a copy of their chat transcript via Discord DM when closed.
- **Slash Commands**:
  - `/ticket-panel [channel]`: Deploy the ticket panel to any channel.
  - `/close [reason]`: Close current ticket and archive transcript.
  - `/claim`: Claim ticket as active staff member.
  - `/add [user]`: Add another user or helper to the ticket.
  - `/remove [user]`: Remove a user from the ticket.
  - `/transcript`: Download immediate HTML transcript of current ticket.
  - `/setup [support-role] [logs-channel] [category]`: Configure server settings.
  - `/stats`: View ticket stats directly in Discord.
  - `/ping`: Check bot latency and gateway ping.

---

### 🌐 Self-Hosted Web Dashboard (No External Hosting Needed)
- **Localhost URL**: `http://localhost:3000`
- **Protected Access**: Secure login with admin password (default: `empirial123`, customizable in `.env`).
- **Live Overview**: Real-time KPI counters (Active Tickets, Closed Tickets, Total Tickets, Connected Guilds, Bot Latency & Status).
- **Interactive Ticket Manager**:
  - Filter tickets by status (All, Open, Claimed, Closed).
  - Search tickets by ID, user, or topic.
  - **Live Chat Modal**: View ticket messages in real time!
  - **Web Staff Reply**: Type a message in the web dashboard and dispatch it directly into the Discord ticket channel!
  - **Remote Close**: Close any ticket directly from the browser.
- **Transcripts Archive**:
  - Browse all past ticket conversations.
  - One-click browser preview with Discord-style theme.
  - Download raw standalone HTML files.
- **Live Embed Customizer & Deployer**:
  - Customize ticket panel title, description, color, button text, and footer.
  - Deploy the panel to any text channel in your Discord server with 1 click!

---

## 🚀 Quick Start Guide

### 1. Invite the Bot to Your Server
Click this official OAuth2 invite link to add your bot to the **Empirial** server:
```
https://discord.com/oauth2/authorize?client_id=1572574664063193179&permissions=8&scope=bot%20applications.commands
```

### 2. Start the Bot & Web Server
Simply run the startup script:
- Double-click **`start.bat`** in Windows Explorer, OR
- Run in PowerShell/Terminal:
  ```powershell
  npm start
  ```

### 3. Open the Web Dashboard
Open your browser and navigate to:
```
http://localhost:3000
```
- **Password:** `empirial123` (change anytime in `.env`)

---

## ⚙️ Configuration (`.env`)
```ini
# Empirial Discord Bot Configuration
BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
CLIENT_ID=1572574664063193179

# Web Dashboard Configuration (Self-Hosted)
PORT=3000
ADMIN_PASSWORD=empirial123
SERVER_NAME=Empirial
```

---

## 📁 Directory Structure
```
c:\Imprial Bot\
├── .env                       # Bot token, client ID, port, admin password
├── package.json               # Node.js dependencies
├── start.bat                  # One-click Windows starter script
├── README.md                  # Complete documentation
├── data/
│   ├── config.json            # Persisted Discord configuration
│   ├── tickets.json           # All ticket records and message caches
│   └── transcripts/           # Saved HTML transcripts
└── src/
    ├── index.js               # Unified server entry point
    ├── bot/                   # Discord.js bot client, slash commands, events, handlers
    ├── server/                # Express & Socket.io web backend and API
    ├── storage/               # Local JSON database engine
    └── public/                # Modern glassmorphism web dashboard UI
```
