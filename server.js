require('dotenv').config();
const packageJson = require('./package.json');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const Docker = require('dockerode');
const session = require('express-session');
const authService = require('./auth/auth.service');
const security = require('./security.config.js');
const http = require('http');
const https = require('https');

const app = express();
const port = 3003;

async function startServer() {
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const historyPath = path.join(__dirname, 'config', 'history', 'history.json');
  const statePath = path.join(__dirname, 'config', 'state.json');

// Middlewares
// CORS configuration: allow credentials so session cookies are accepted
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
// Parse application/x-www-form-urlencoded (HTML form posts)
app.use(express.urlencoded({ extended: false }));

const isHttps = security.httpsEnabled === true;

app.use(session({
  name: security.sessionName,
  secret: security.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // IMPORTANT:
    // - SameSite=None REQUIRES Secure=true (HTTPS), otherwise browsers drop the cookie
    // - In HTTP (local/Docker), use Lax so cookies are sent
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 60 * 60 * 1000 // 1 hour in milliseconds
  }
}));

// Initialize admin password on startup
authService.ensureAdminPasswordInitialized();

// --- API Routes ---
// Declared before static files to give them priority.

// Authentication routes

// Get current logged user
app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false });
  }
  res.json({ success: true, username: req.session.user.username });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await authService.authenticate(username, password);
    if (!result.success) {
      return res.status(401).json({ success: false, locked: result.locked || false });
    }

    req.session.user = { username };
    req.session.mustChangePassword = !!result.mustChangePassword;

    // Ensure the session is persisted before responding (important in Docker / async IO)
    req.session.save(() => {
      res.json({
        success: true,
        mustChangePassword: result.mustChangePassword,
        noPassword: !!result.noPassword
      });
    });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const username = req.session.user.username;

    await authService.changePassword(username, req.body.newPassword);

    if (req.session) {
      // Ensure the user is authenticated in session before redirecting
      if (!req.session.user) {
        req.session.user = { username };
      }
      req.session.mustChangePassword = false;
      req.session.save(() => {
        // After HTML form POST, redirect to home page
        res.redirect('/');
      });
    } else {
      // Fallback redirect (should not happen with sessions enabled)
      res.redirect('/');
    }
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.get('/api/auth/policy', (req, res) => {
  res.json(security.passwordPolicy);
});

app.get('/api/version', (req, res) => {
  res.json({ version: packageJson.version });
});

// Get map and geolocation configuration
app.get('/api/config/map', (req, res) => {
  res.json({
    success: true,
    config: {
      geolocationApiUrl: '/api/geolocation', // Use internal proxy endpoint
      mapTileUrl: process.env.MAP_TILE_URL || 'https://api.maptiler.com/maps/streets/style.json?key=demo_key'
    }
  });
});

// Proxy endpoint for geolocation to avoid CORS issues
app.get('/api/geolocation', async (req, res) => {
  try {
    const geolocationUrl = process.env.GEOLOCATION_API_URL || 'http://localhost:8000/v1/publicip/ip';
    const response = await fetch(geolocationUrl);
    
    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Geolocation proxy error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch geolocation data',
      details: error.message
    });
  }
});

// Helper to call Gluetun API (GET)
async function fetchGluetunApi(path) {
  const base = (process.env.GLUETUN_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Gluetun API ${path} responded with ${response.status}`);
  return response.json();
}

// Helper to call Gluetun API (PUT)
async function putGluetunApi(path, body) {
  const base = (process.env.GLUETUN_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Gluetun API ${path} responded with ${response.status}`);
  // Some Gluetun PUT endpoints return empty body
  const text = await response.text();
  return text ? JSON.parse(text) : { success: true };
}

// Proxy: Gluetun VPN status (works for both WireGuard and OpenVPN)
app.get('/api/gluetun/vpn-status', async (req, res) => {
  try {
    const data = await fetchGluetunApi('/v1/vpn/status');
    console.log('[Gluetun] vpn-status raw:', JSON.stringify(data));
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('[Gluetun] vpn-status error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy: Gluetun DNS status
app.get('/api/gluetun/dns-status', async (req, res) => {
  try {
    const data = await fetchGluetunApi('/v1/dns/status');
    console.log('[Gluetun] dns-status raw:', JSON.stringify(data));
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('[Gluetun] dns-status error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy: Gluetun port forwarding status
app.get('/api/gluetun/portforwarding', async (req, res) => {
  try {
    const data = await fetchGluetunApi('/v1/portforwarding/status');
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy: Start Gluetun VPN (PUT /v1/vpn/status with {"status":"running"})
app.put('/api/gluetun/vpn-start', async (req, res) => {
  try {
    const data = await putGluetunApi('/v1/vpn/status', { status: 'running' });
    console.log('[Gluetun] vpn-start response:', JSON.stringify(data));
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('[Gluetun] vpn-start error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy: Stop Gluetun VPN (PUT /v1/vpn/status with {"status":"stopped"})
app.put('/api/gluetun/vpn-stop', async (req, res) => {
  try {
    const data = await putGluetunApi('/v1/vpn/status', { status: 'stopped' });
    console.log('[Gluetun] vpn-stop response:', JSON.stringify(data));
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('[Gluetun] vpn-stop error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper: search Gluetun server JSON files for an IP match → returns provider name
async function findProviderByIp(serverIp) {
  const serversDir = process.env.GLUETUN_SERVERS_DIR || '/gluetun-servers';
  try {
    const files = await fs.readdir(serversDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(serversDir, file), 'utf8');
        const data = JSON.parse(raw);

        // Gluetun server files shape: { servers: [ { ips: [...] } ] } or { servers: [ { ip: "..." } ] }
        const servers = data.servers || data.Servers || (Array.isArray(data) ? data : null);
        if (!Array.isArray(servers)) continue;

        const ipOctets3 = serverIp.split('.').slice(0, 3).join('.');
        const found = servers.some(s => {
          const ips = s.ips || s.IPs || (s.ip ? [s.ip] : []);
          return ips.some(ip => ip === serverIp || ip.startsWith(ipOctets3 + '.'));
        });

        if (found) {
          // Provider name = JSON filename without extension (e.g. "protonvpn.json" → "protonvpn")
          return path.basename(file, '.json');
        }
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // serversDir not mounted or not accessible — silently ignore
  }
  return null;
}

// Detect VPN type, server host and provider from wg0.conf (+ Gluetun server JSON files)
app.get('/api/gluetun/vpn-type', async (req, res) => {
  const wireguardDir = process.env.WIREGUARD_DIR;
  if (!wireguardDir) {
    return res.json({ success: false, vpn_type: null, provider: null, error: 'WIREGUARD_DIR not set' });
  }
  try {
    const wg0Path = path.join(wireguardDir, 'wg0.conf');
    const content = await fs.readFile(wg0Path, 'utf8');

    // WireGuard configs contain [Interface] + [Peer] + PrivateKey
    const isWireGuard = content.includes('[Interface]') && content.includes('[Peer]') && content.includes('PrivateKey');
    const vpn_type = isWireGuard ? 'wireguard' : 'openvpn';

    // Extract the VPN server host/IP from config
    let serverHost = null;
    if (isWireGuard) {
      // Endpoint = 185.159.158.1:51820  OR  node.protonvpn.net:51820
      const m = content.match(/^\s*Endpoint\s*=\s*([^\s:\[]+)/mi);
      if (m) serverHost = m[1].trim();
    } else {
      // OpenVPN: remote <host> <port>
      const m = content.match(/^\s*remote\s+([^\s]+)/mi);
      if (m) serverHost = m[1].trim();
    }

    let provider = null;
    const knownProviders = ['protonvpn', 'mullvad', 'nordvpn', 'expressvpn', 'surfshark', 'ipvanish', 'cyberghost', 'hidemyass', 'pia', 'privado'];

    if (serverHost) {
      const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(serverHost);

      if (isIp) {
        // Try to match IP against Gluetun server JSON files
        provider = await findProviderByIp(serverHost);
      }

      // Fallback: extract from hostname keywords
      if (!provider) {
        const hostLower = serverHost.toLowerCase();
        provider = knownProviders.find(p => hostLower.includes(p)) || null;
      }

      // Fallback: use second-level domain of hostname
      if (!provider && !isIp) {
        const parts = serverHost.split('.');
        if (parts.length >= 2) provider = parts[parts.length - 2];
      }
    }

    res.json({ success: true, vpn_type, provider, server_host: serverHost });
  } catch (error) {
    res.json({ success: false, vpn_type: null, provider: null, error: error.message });
  }
});

// Protect sensitive HTML files from direct static access
app.use((req, res, next) => {
  if (req.path === '/change-password.html' || req.path === '/gluetun-switcher.html') {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
  }
  next();
});

// Serve static files FIRST (HTML, CSS, JS, images)
app.use(express.static(__dirname));

// Protect API routes and pages below
app.use((req, res, next) => {
  console.log('[AUTH MIDDLEWARE]', req.method, req.path, 'session user =', req.session && req.session.user);

  // Public auth APIs
  if (req.path.startsWith('/api/auth/login')) return next();
  if (req.path.startsWith('/api/auth/change-password')) return next();
  if (req.path.startsWith('/api/auth/policy')) return next();
  if (req.path === '/api/version') return next();

  // Public pages
  if (req.path === '/login') return next();

  // Force password change flow (HTML only)
  if (req.path === '/change-password.html') {
    if (req.session.user && req.session.mustChangePassword) return next();
    return res.redirect('/login');
  }

  // Protect everything else
  if (!req.session.user) return res.redirect('/login');

  next();
});

// List WireGuard files
app.get('/api/wireguard-files', async (req, res) => {
  const wireguardDir = process.env.WIREGUARD_DIR;
  if (!wireguardDir) {
    return res.status(500).json({
      success: false,
      error: "La variable d'environnement WIREGUARD_DIR n'est pas configurée sur le serveur."
    });
  }

  try {
    const files = await fs.readdir(wireguardDir);
    const confFiles = files
      .filter(file => file.endsWith('.conf') && file !== 'wg0.conf')
      .map(file => ({
        name: file,
        fullPath: path.join(wireguardDir, file)
      }));
    res.json({ success: true, files: confFiles });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Erreur lors de la lecture du répertoire ${wireguardDir}: ${error.message}`
    });
  }
});

// Load location data
app.get('/api/locations', async (req, res) => {
  try {
    // 1. Get wireguard directory and list of files
    const wireguardDir = process.env.WIREGUARD_DIR;
    let availableConfFiles = [];
    if (wireguardDir) {
      try {
        const files = await fs.readdir(wireguardDir);
        availableConfFiles = files.filter(file => file.endsWith('.conf'));
      } catch {
        // If directory doesn't exist, it's fine, no files are available.
        console.log(`WireGuard directory ${wireguardDir} not found, assuming no configs are available.`);
      }
    }

    // 2. Load locations data (respecting development environment)
    const devLocations = path.join(__dirname, 'locations.local.json');
    const prodLocations = path.join(__dirname, 'config', 'locations.json');

    let locationsFile = prodLocations;
    if (process.env.NODE_ENV === 'development') {
      try {
        await fs.access(devLocations);
        locationsFile = devLocations;
      } catch {
        locationsFile = prodLocations;
      }
    }

    const locationsData = JSON.parse(await fs.readFile(locationsFile, 'utf8'));

    // 3. Process and enrich locations
    const enrichedLocations = Object.entries(locationsData).map(([countryCode, data]) => {
      const hasEnoughKeywords = data.keywords && data.keywords.length >= 2;
      let matchingFileName = null;
      let isAvailable = false;

      if (hasEnoughKeywords) {
        // Filename is expected to be based on the first keyword. e.g., "france" -> "france.conf"
        const expectedFileName = `${data.keywords[0]}.conf`;
        const foundFile = availableConfFiles.find(f => f.toLowerCase() === expectedFileName.toLowerCase());
        if (foundFile) {
          matchingFileName = foundFile;
          isAvailable = true;
        }
      }

      return {
        countryCode,
        ...data,
        isAvailable,
        fullPath: isAvailable ? path.join(wireguardDir, matchingFileName) : null,
        fileName: matchingFileName,
      };
    });

    res.json({ success: true, locations: enrichedLocations });

  } catch (error) {
    console.error('Error in /api/locations:', error);
    res.status(500).json({
      success: false,
      error: `Impossible de charger les données de localisation: ${error.message}`
    });
  }
});

// Activate a WireGuard configuration (rename to wg0.conf)
app.post('/api/activate-config', async (req, res) => {
  const { sourcePath } = req.body;
  console.log(`[ACTIVATE] Received request to activate: ${sourcePath}`);
  if (!sourcePath) {
    console.error('[ACTIVATE] Error: sourcePath is missing.');
    return res.status(400).json({ success: false, error: 'Le chemin du fichier source est manquant.' });
  }

  try {
    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error('Le chemin source n\'est pas un fichier valide');
    }

    const wireguardDir = process.env.WIREGUARD_DIR;
    if (!wireguardDir) {
      return res.status(500).json({
        success: false,
        error: "La variable d'environnement WIREGUARD_DIR n'est pas configurée sur le serveur."
      });
    }
    const wg0Path = path.join(wireguardDir, 'wg0.conf');
    const sourceName = path.basename(sourcePath);

    console.log(`[ACTIVATE] Attempting to copy '${sourcePath}' to '${wg0Path}'`);
    await fs.copyFile(sourcePath, wg0Path);
    console.log(`[ACTIVATE] Copy successful.`);
    await fs.writeFile(statePath, JSON.stringify({ activeConfigName: sourceName })); // Save the name of the activated file

    const restartResults = [];
    const containersToRestart = process.env.CONTAINER_TO_RESTART;
    if (containersToRestart) {
      const containerNames = containersToRestart.split(',').map(name => name.trim());
      const restartPromises = containerNames.map(async (containerName) => {
        if (!containerName) return null;
        try {
          const container = docker.getContainer(containerName);
          await container.restart();
          return { containerName, status: 'success' };
        } catch (restartError) {
          let errorMessage = 'Unknown restart error';
          if (restartError && restartError.json && restartError.json.message) {
            errorMessage = restartError.json.message;
          } else if (restartError && restartError.message) {
            errorMessage = restartError.message;
          } else if (restartError) {
            errorMessage = String(restartError);
          }
          return { containerName, status: 'error', message: errorMessage };
        }
      });
      
      const results = await Promise.all(restartPromises);
      restartResults.push(...results.filter(r => r !== null));
    }

    res.json({
      success: true,
      activated: {
        sourceName: sourceName,
      },
      restarts: restartResults
    });
  } catch (error) {
    console.error(`[ACTIVATE] Error during activation:`, error);
    res.status(500).json({
      success: false,
      error: `Erreur lors de l'activation: ${error.message}`
    });
  }
});

// SSH functionality has been removed.

// Routes for configuration paths and folding state have been removed.

// Get information about the active configuration (wg0.conf)
app.get('/api/current-config-info', async (req, res) => {
  const wireguardDir = process.env.WIREGUARD_DIR;
  if (!wireguardDir) {
    return res.status(500).json({
      success: false,
      error: "La variable d'environnement WIREGUARD_DIR n'est pas configurée sur le serveur.",
      reason: 'config_error'
    });
  }
  const wg0Path = path.join(wireguardDir, 'wg0.conf');
  let activeConfigName = 'wg0.conf';
  try {
    const stateData = await fs.readFile(statePath, 'utf8');
    activeConfigName = JSON.parse(stateData).activeConfigName || 'wg0.conf';
  } catch (error) {
    // The state file does not exist yet, this is not a blocking error.
    console.log("State file not found, using default name.");
  }

  try {
    const stats = await fs.stat(wg0Path);
    res.json({
      success: true,
      name: activeConfigName || 'wg0.conf',
      size: stats.size,
      lastModified: stats.mtime,
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      // The wg0.conf file does not exist, which is valid information
      res.json({ success: false, reason: 'not_found' });
    } else {
      res.status(500).json({
        success: false,
        error: `Erreur lors de la lecture de wg0.conf: ${error.message}`,
        reason: 'read_error'
      });
    }
  }
});

// Manage operation history
app.route('/api/operation-history')
  .get(async (req, res) => {
    try {
      const data = await fs.readFile(historyPath, 'utf8');
      res.json(JSON.parse(data));
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.json([]); // The file does not exist, return an empty array
      } else {
        res.status(500).json({ success: false, error: 'Could not read history.' });
      }
    }
  })
  .post(async (req, res) => {
    try {
      await fs.writeFile(historyPath, JSON.stringify(req.body.history, null, 2));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Could not write history.' });
    }
  })
  .delete(async (req, res) => {
    try {
      await fs.unlink(historyPath);
      res.json({ success: true });
    } catch (error) {
      if (error.code !== 'ENOENT') { // Ignore if the file does not exist
        res.status(500).json({ success: false, error: 'Could not delete history.' });
      } else {
        res.json({ success: true });
      }
    }
  });

// ── VPN Status History (last 30 polls, polled every 30s server-side) ──────────
const vpnStatusHistoryPath = path.join(__dirname, 'config', 'vpn-status-history.json');
const VPN_HISTORY_MAX = 30;
const VPN_POLL_INTERVAL_MS = 30000; // 30 seconds

// Load persisted history or start fresh
let vpnStatusHistory = [];
(async () => {
  try {
    const raw = await fs.readFile(vpnStatusHistoryPath, 'utf8');
    vpnStatusHistory = JSON.parse(raw);
  } catch {
    vpnStatusHistory = [];
  }
})();

async function pollVpnStatus() {
  let status = 'unknown';
  try {
    const data = await fetchGluetunApi('/v1/vpn/status');
    // Gluetun ≥ v3.38 uses "outcome" instead of "status"
    const s = (data.outcome || data.status || '').toLowerCase();
    if (s === 'running') status = 'connected';
    else if (s === 'stopped' || s === 'disabled') status = 'disconnected';
    else if (s === 'starting') status = 'paused';
    else status = 'unknown';
  } catch {
    status = 'unknown';
  }

  vpnStatusHistory.push({ status, ts: Date.now() });
  if (vpnStatusHistory.length > VPN_HISTORY_MAX) {
    vpnStatusHistory = vpnStatusHistory.slice(-VPN_HISTORY_MAX);
  }

  // Persist asynchronously (no await — fire and forget)
  fs.writeFile(vpnStatusHistoryPath, JSON.stringify(vpnStatusHistory)).catch(() => {});
}

// Start polling after a short delay (give time for Gluetun to be ready)
setTimeout(() => {
  pollVpnStatus();
  setInterval(pollVpnStatus, VPN_POLL_INTERVAL_MS);
}, 5000);

// GET endpoint — returns the last 30 status polls
app.get('/api/gluetun/vpn-history', (req, res) => {
  res.json({ success: true, history: vpnStatusHistory });
});

// Public login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Authenticated home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'gluetun-switcher.html'));
});

// The express.static middleware serves other files (CSS, JS, images).
// It must be declared AFTER the API routes.
app.use(express.static(__dirname));

// Start the server
app.listen(port, () => {
  console.log(`Web server started on http://localhost:${port}`);
});
}

startServer();
