const express = require('express');
const router = express.Router();
const db = require('../../storage/db');

// Discord OAuth2 Settings
const CLIENT_ID = process.env.CLIENT_ID || '1572574664063193179';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';

/**
 * Authentication Middleware for protected routes
 */
async function authMiddleware(req, res, next) {
  try {
    const sessionId = req.cookies?.empirial_session ||
      (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null) ||
      req.query?.token ||
      req.query?.session;

    if (!sessionId) {
      return res.status(401).json({ error: 'Unauthorized. Please log in with Discord.', authenticated: false });
    }

    const session = await db.getSession(sessionId);
    if (!session || !session.is_admin) {
      return res.status(403).json({ error: 'Access denied. Administrator privileges required.', authenticated: false });
    }

    req.user = session;
    next();
  } catch (err) {
    console.error('[authMiddleware Error]', err);
    return res.status(401).json({ error: 'Session verification failed.', authenticated: false });
  }
}

/**
 * Check Discord user administrator / staff privileges
 * Checks:
 * 1. Is user owner of any guild named "Empirial" or matching guildId?
 * 2. Does user have ADMINISTRATOR (0x8) or MANAGE_GUILD (0x20) in Empirial?
 * 3. Does user have Server Admin / Manage Guild permissions in their Discord guilds?
 */
function checkAdminPermissions(guilds, targetServerName = 'Empirial') {
  if (!Array.isArray(guilds) || guilds.length === 0) {
    return { isAdmin: false, reason: 'No mutual guilds found' };
  }

  const ADMIN_BIT = 0x8n;
  const MANAGE_GUILD_BIT = 0x20n;

  // First check if there is an exact or case-insensitive match for the server name or Guild ID
  const TARGET_GUILD_ID = process.env.GUILD_ID || '1439121933001035808';
  const empirialGuild = guilds.find(g => 
    g.id === TARGET_GUILD_ID ||
    g.name.includes('Eᴍᴘɪʀɪᴀʟ') ||
    g.name.toLowerCase().includes(targetServerName.toLowerCase()) ||
    targetServerName.toLowerCase().includes(g.name.toLowerCase())
  );

  if (empirialGuild) {
    if (empirialGuild.owner) {
      return { isAdmin: true, role: 'Guild Owner', guild: empirialGuild.name };
    }
    const perms = BigInt(empirialGuild.permissions || 0);
    if ((perms & ADMIN_BIT) === ADMIN_BIT) {
      return { isAdmin: true, role: 'Administrator', guild: empirialGuild.name };
    }
    if ((perms & MANAGE_GUILD_BIT) === MANAGE_GUILD_BIT) {
      return { isAdmin: true, role: 'Manage Server', guild: empirialGuild.name };
    }
  }

  // Check all guilds the user manages
  for (const guild of guilds) {
    if (guild.owner) {
      return { isAdmin: true, role: 'Server Owner', guild: guild.name };
    }
    const perms = BigInt(guild.permissions || 0);
    if ((perms & ADMIN_BIT) === ADMIN_BIT) {
      return { isAdmin: true, role: 'Administrator', guild: guild.name };
    }
    if ((perms & MANAGE_GUILD_BIT) === MANAGE_GUILD_BIT) {
      return { isAdmin: true, role: 'Manage Server', guild: guild.name };
    }
  }

  return { isAdmin: false, reason: 'Missing ADMINISTRATOR or MANAGE_GUILD permission in Empirial' };
}

/**
 * GET /api/auth/me
 * Check current logged-in session status
 */
router.get('/me', async (req, res) => {
  try {
    const sessionId = req.cookies?.empirial_session ||
      (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null) ||
      req.query?.token ||
      req.query?.session;

    if (!sessionId) {
      return res.json({ authenticated: false });
    }

    const session = await db.getSession(sessionId);
    if (!session || !session.is_admin) {
      return res.json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      user: {
        id: session.user_id,
        username: session.username,
        discriminator: session.discriminator,
        avatar: session.avatar,
        roles: session.roles || ['Admin'],
        isAdmin: session.is_admin
      }
    });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});

/**
 * GET /api/auth/status
 * Legacy status check for backward compatibility
 */
router.get('/status', async (req, res) => {
  const sessionId = req.cookies?.empirial_session ||
    (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);

  if (!sessionId) return res.json({ authenticated: false });
  const session = await db.getSession(sessionId);
  return res.json({ authenticated: !!(session && session.is_admin) });
});

/**
 * GET /api/auth/discord/login
 * Initiates Discord OAuth2
 */
router.get('/discord/login', (req, res) => {
  const host = req.get('host') || '';
  let redirectUri;
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    redirectUri = `http://${host}/api/auth/discord/callback`;
  } else {
    // Standard whitelisted redirect URI in Discord Developer Portal
    redirectUri = process.env.DISCORD_REDIRECT_URI || 'https://empirial-bot-nu.vercel.app/api/auth/discord/callback';
  }

  const promptParam = req.query.prompt ? `&prompt=${encodeURIComponent(req.query.prompt)}` : '';

  // If CLIENT_SECRET is present, use standard Authorization Code Grant
  // Otherwise use Implicit Grant (response_type=token) which needs NO client secret
  const responseType = CLIENT_SECRET ? 'code' : 'token';

  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=${responseType}&scope=identify%20guilds${promptParam}`;

  return res.redirect(discordAuthUrl);
});

/**
 * GET /api/auth/discord/callback
 * Handles OAuth2 callback (both Authorization Code and Implicit Token flow)
 */
router.get('/discord/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  // If code is present and CLIENT_SECRET is configured, exchange code directly on backend
  if (code && CLIENT_SECRET) {
    try {
      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const redirectUri = process.env.DISCORD_REDIRECT_URI || `${protocol}://${host}/api/auth/discord/callback`;

      const tokenParams = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      });

      const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to exchange code with Discord');
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      // Process user authentication
      const authResult = await verifyAndCreateSession(accessToken, res);
      return res.redirect(authResult.redirect);
    } catch (err) {
      console.error('[Discord OAuth Callback Error]', err);
      return res.redirect('/login?error=auth_failed');
    }
  }

  // For Implicit Grant (token in hash fragment #access_token=...) or frontend token handling
  // Return a client-side bridge script to read URL hash and POST to /verify-token
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verifying Discord Session...</title>
  <style>
    body { background: #111318; color: #e2e2e8; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .loader { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(190,194,255,0.2); border-top-color: #5865f2; border-radius: 50%; animation: spin 1s infinite linear; margin: 0 auto 16px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>Authenticating with Discord & verifying permissions...</p>
  </div>
  <script>
    (async function() {
      // 1. Check hash for implicit grant
      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const token = hashParams.get('access_token');

      // 2. Check query params for code
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code');

      if (!token && !code) {
        window.location.href = '/login?error=no_token';
        return;
      }

      try {
        const res = await fetch('/api/auth/discord/verify-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token, code })
        });
        const data = await res.json();
        if (data.sessionId) {
          localStorage.setItem('empirial_session', data.sessionId);
        }
        if (data.redirect) {
          window.location.href = data.redirect;
        } else {
          window.location.href = '/login?error=unknown';
        }
      } catch (err) {
        window.location.href = '/login?error=network';
      }
    })();
  </script>
</body>
</html>`);
});

/**
 * Helper to verify Discord user, check permissions, and create Supabase session
 */
async function verifyAndCreateSession(accessToken, res) {
  // 1. Fetch User Profile
  const userRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!userRes.ok) throw new Error('Could not fetch Discord user');
  const user = await userRes.json();

  // 2. Fetch User Guilds
  const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const guilds = guildsRes.ok ? await guildsRes.json() : [];

  // 3. Verify Admin / Staff Permissions
  const permCheck = checkAdminPermissions(guilds, 'Empirial');

  if (!permCheck.isAdmin) {
    // Access Denied! Redirect to restricted page with diagnostics
    const query = new URLSearchParams({
      userId: user.id,
      user: user.username,
      discriminator: user.discriminator || '0',
      avatar: user.avatar || '',
      missing: 'MANAGE_GUILD'
    });
    return {
      success: false,
      redirect: `/access-denied?${query.toString()}`
    };
  }

  // 4. User is an Authorized Admin! Create Supabase Session
  const sessionResult = await db.createSession({
    id: user.id,
    username: user.username,
    discriminator: user.discriminator || '0',
    avatar: user.avatar,
    roles: [permCheck.role || 'Admin'],
    isAdmin: true
  });

  // 5. Set Cookie
  if (res && res.cookie) {
    res.cookie('empirial_session', sessionResult.sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
  }

  return {
    success: true,
    sessionId: sessionResult.sessionId,
    redirect: '/'
  };
}

/**
 * POST /api/auth/discord/verify-token
 * Receives access token from frontend implicit grant or code, validates admin, sets session
 */
router.post('/discord/verify-token', async (req, res) => {
  try {
    const { token, code } = req.body;
    let accessToken = token;

    if (!accessToken && code && CLIENT_SECRET) {
      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const redirectUri = process.env.DISCORD_REDIRECT_URI || `${protocol}://${host}/api/auth/discord/callback`;

      const tokenParams = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      });

      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams
      });

      if (!tokenRes.ok) {
        return res.status(400).json({ error: 'Failed to exchange code', redirect: '/login?error=code_exchange' });
      }

      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing access token', redirect: '/login?error=missing_token' });
    }

    const authResult = await verifyAndCreateSession(accessToken, res);
    return res.json(authResult);
  } catch (err) {
    console.error('[verify-token Error]', err);
    return res.status(500).json({ error: err.message, redirect: '/login?error=server_error' });
  }
});

/**
 * POST /api/auth/logout
 * Log out user by deleting session from Supabase & clearing cookie
 */
router.post('/logout', async (req, res) => {
  try {
    const sessionId = req.cookies?.empirial_session ||
      (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);

    if (sessionId) {
      await db.deleteSession(sessionId);
    }

    res.clearCookie('empirial_session');
    return res.json({ success: true, redirect: '/login' });
  } catch (err) {
    res.clearCookie('empirial_session');
    return res.json({ success: true, redirect: '/login' });
  }
});

module.exports = {
  router,
  authMiddleware
};
