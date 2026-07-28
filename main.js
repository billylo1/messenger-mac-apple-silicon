const { app, BrowserWindow, shell, Menu, session, dialog, net } = require('electron');
const { initialize: initAptabase, trackEvent } = require('@aptabase/electron/main');
const path = require('path');
const fs = require('fs');

const CURRENT_VERSION = app.getVersion();
const GITHUB_REPO = 'billylo1/messenger-mac-apple-silicon';

// Aptabase (self-hosted) — must initialize before app.whenReady()
initAptabase('A-SH-4674667238', {
  host: 'https://aptabase.evergreen-labs.org'
});

// Set app data path explicitly
app.setPath('userData', path.join(app.getPath('appData'), 'MessengerApp'));

let mainWindow;
let isQuitting = false;

// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// Generate unique install ID
function generateInstallId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Load settings
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {}
  return { sidebarVisible: true, hasSeenWelcome: false, installId: generateInstallId(), lastPingDate: null };
}

// Save settings
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (e) {}
}

let settings = loadSettings();

// Check for updates and track usage
function checkForUpdates(silent = false) {
  const request = net.request({
    method: 'GET',
    url: `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
  });

  request.setHeader('User-Agent', `MessengerApp/${CURRENT_VERSION}`);

  request.on('response', (response) => {
    let data = '';
    response.on('data', (chunk) => { data += chunk; });
    response.on('end', () => {
      try {
        const release = JSON.parse(data);
        const latestVersion = release.tag_name.replace('v', '');

        if (latestVersion !== CURRENT_VERSION) {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `A new version (v${latestVersion}) is available!`,
            detail: `You have v${CURRENT_VERSION}. Would you like to download the update?`,
            buttons: ['Download', 'Later'],
            defaultId: 0
          }).then(({ response }) => {
            if (response === 0) {
              shell.openExternal(release.html_url);
            }
          });
        } else if (!silent) {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'No Updates',
            message: 'You\'re up to date!',
            detail: `Version ${CURRENT_VERSION} is the latest.`
          });
        }
      } catch (e) {}
    });
  });

  request.on('error', () => {});
  request.end();

  // Track unique daily active users (per-day counter for history)
  const today = new Date().toISOString().split('T')[0];
  if (settings.lastPingDate !== today) {
    if (!settings.installId) {
      settings.installId = generateInstallId();
    }
    settings.lastPingDate = today;
    saveSettings(settings);

    // Ping daily counter (e.g., daily-2025-12-26)
    const dailyPing = net.request({
      method: 'GET',
      url: `https://api.counterapi.dev/v1/messenger-mac/daily-${today}/up`
    });
    dailyPing.on('error', () => {});
    dailyPing.end();

    // Also ping total unique users (first time only)
    if (!settings.countedAsUser) {
      settings.countedAsUser = true;
      saveSettings(settings);
      const totalPing = net.request({
        method: 'GET',
        url: 'https://api.counterapi.dev/v1/messenger-mac/total-users/up'
      });
      totalPing.on('error', () => {});
      totalPing.end();
    }
  }
}

// Show welcome window on first launch
function showWelcomeWindow() {
  const welcomeWindow = new BrowserWindow({
    width: 500,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const welcomeHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #0084ff 0%, #0062cc 100%);
          color: white;
          padding: 40px 30px 30px;
          -webkit-app-region: drag;
          user-select: none;
        }
        h1 { font-size: 24px; margin-bottom: 8px; }
        .subtitle { opacity: 0.9; margin-bottom: 25px; font-size: 14px; }
        .section { background: rgba(255,255,255,0.15); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
        .section-title { font-weight: 600; margin-bottom: 10px; font-size: 14px; }
        .shortcut { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 13px; }
        .key { background: rgba(255,255,255,0.25); padding: 4px 10px; border-radius: 6px; font-family: monospace; font-size: 12px; }
        .feature { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
        .feature-icon { font-size: 18px; }
        button {
          -webkit-app-region: no-drag;
          background: white;
          color: #0084ff;
          border: none;
          padding: 12px 32px;
          border-radius: 20px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          display: block;
          margin: 20px auto 0;
        }
        button:hover { background: #f0f0f0; }
      </style>
    </head>
    <body>
      <h1>Welcome to Messenger for Mac</h1>
      <p class="subtitle">Here are some features to help you get started</p>

      <div class="section">
        <div class="section-title">Keyboard Shortcuts</div>
        <div class="shortcut"><span>New Message</span><span class="key">Cmd + N</span></div>
        <div class="shortcut"><span>Switch Conversations</span><span class="key">Cmd + 1-9</span></div>
        <div class="shortcut"><span>Toggle Sidebar</span><span class="key">Cmd + Shift + S</span></div>
      </div>

      <div class="section">
        <div class="section-title">Features</div>
        <div class="feature"><span class="feature-icon">⚡</span><span>Power Saving - Auto-throttles when in background</span></div>
        <div class="feature"><span class="feature-icon">💾</span><span>Persistent Login - Stay signed in between sessions</span></div>
        <div class="feature"><span class="feature-icon">🎨</span><span>Sidebar visibility is remembered across restarts</span></div>
      </div>

      <button onclick="window.close()">Get Started</button>
    </body>
    </html>
  `;

  welcomeWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(welcomeHTML));

  welcomeWindow.on('closed', () => {
    settings.hasSeenWelcome = true;
    saveSettings(settings);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    title: 'Messenger for Mac',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Log file path
  const logFile = path.join(app.getPath('userData'), 'cookies.log');
  const log = (msg) => {
    const line = `${new Date().toISOString()} - ${msg}\n`;
    fs.appendFileSync(logFile, line);
  };

  // Convert session cookies to persistent cookies
  session.defaultSession.cookies.on('changed', (event, cookie, cause, removed) => {
    const isFacebookDomain = cookie.domain.includes('facebook.com') || cookie.domain.includes('messenger.com');
    log(`Cookie: ${cookie.name} | domain: ${cookie.domain} | session: ${cookie.session} | removed: ${removed}`);

    if (!removed && cookie.session && isFacebookDomain) {
      // Make session cookie persistent (expire in 1 year)
      const persistentCookie = {
        url: `https://${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite || 'no_restriction',
        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      };
      log(`Converting to persistent: ${cookie.name}`);
      session.defaultSession.cookies.set(persistentCookie).catch(err => log(`Cookie error: ${err}`));
    }
  });

  // Load Facebook Messenger
  mainWindow.loadURL('https://www.messenger.com');

  // Apply sidebar state when page finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => applySidebarState(), 1000);
  });

  // Power saving: throttle when window is hidden/minimized/unfocused
  mainWindow.on('blur', () => {
    mainWindow.webContents.setBackgroundThrottling(true);
  });

  mainWindow.on('focus', () => {
    mainWindow.webContents.setBackgroundThrottling(false);
  });

  mainWindow.on('minimize', () => {
    mainWindow.webContents.setBackgroundThrottling(true);
  });

  mainWindow.on('restore', () => {
    mainWindow.webContents.setBackgroundThrottling(false);
  });

  // Red close button / Cmd+W: minimize instead of destroying the window,
  // so Messenger stays loaded and resumes instantly. Real quit is via
  // menu Quit or Cmd+Q (isQuitting).
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.minimize();
    }
  });

  // Check if URL is a Messenger/Facebook redirect link and extract real URL
  function getExternalUrl(url) {
    try {
      const parsed = new URL(url);
      // Handle l.messenger.com and l.facebook.com redirect links
      if (parsed.hostname === 'l.messenger.com' || parsed.hostname === 'l.facebook.com') {
        const realUrl = parsed.searchParams.get('u');
        if (realUrl) return realUrl;
      }
    } catch (e) {}
    return null;
  }

  // Check if URL should stay in app
  function isInternalUrl(url) {
    return url.includes('messenger.com') && !url.includes('l.messenger.com');
  }

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getExternalUrl(url);
    if (externalUrl) {
      shell.openExternal(externalUrl);
      return { action: 'deny' };
    }
    if (!isInternalUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Handle navigation to external sites
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const externalUrl = getExternalUrl(url);
    if (externalUrl) {
      event.preventDefault();
      shell.openExternal(externalUrl);
      return;
    }
    if (!isInternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Toggle left sidebar visibility
function toggleLeftSidebar() {
  if (!mainWindow) return;
  settings.sidebarVisible = !settings.sidebarVisible;
  saveSettings(settings);
  applySidebarState();
}

// Apply sidebar visibility state
function applySidebarState() {
  if (!mainWindow) return;
  const visible = settings.sidebarVisible;
  mainWindow.webContents.executeJavaScript(`
    (function() {
      const sidebar = document.querySelector('[aria-label="Inbox switcher"]');
      if (sidebar) {
        sidebar.style.display = ${visible} ? '' : 'none';
      }
    })();
  `).catch(() => {});
}

// Create new message
function createNewMessage() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(`
    (function() {
      // Find and click the new message/compose button
      const newMessageBtn = document.querySelector('[aria-label="New message"]') ||
                           document.querySelector('[aria-label="Start a new message"]') ||
                           document.querySelector('[aria-label="Compose"]');
      if (newMessageBtn) {
        newMessageBtn.click();
      }
    })();
  `).catch(() => {});
}

// Switch to nth conversation
function switchToConversation(n) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(`
    (function() {
      // Find all conversation rows and click the link inside
      const rows = document.querySelectorAll('[role="row"]');
      const conversationLinks = [];

      rows.forEach(row => {
        const link = row.querySelector('a[role="link"][href*="/t/"]');
        if (link) {
          conversationLinks.push(link);
        }
      });

      if (conversationLinks[${n}]) {
        conversationLinks[${n}].click();
      }
    })();
  `).catch(() => {});
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Option+I' }
      ]
    },
    {
      label: 'Conversations',
      submenu: [
        { label: 'New Message', accelerator: 'CmdOrCtrl+N', click: () => createNewMessage() },
        { type: 'separator' },
        { label: 'Conversation 1', accelerator: 'CmdOrCtrl+1', click: () => switchToConversation(0) },
        { label: 'Conversation 2', accelerator: 'CmdOrCtrl+2', click: () => switchToConversation(1) },
        { label: 'Conversation 3', accelerator: 'CmdOrCtrl+3', click: () => switchToConversation(2) },
        { label: 'Conversation 4', accelerator: 'CmdOrCtrl+4', click: () => switchToConversation(3) },
        { label: 'Conversation 5', accelerator: 'CmdOrCtrl+5', click: () => switchToConversation(4) },
        { label: 'Conversation 6', accelerator: 'CmdOrCtrl+6', click: () => switchToConversation(5) },
        { label: 'Conversation 7', accelerator: 'CmdOrCtrl+7', click: () => switchToConversation(6) },
        { label: 'Conversation 8', accelerator: 'CmdOrCtrl+8', click: () => switchToConversation(7) },
        { label: 'Conversation 9', accelerator: 'CmdOrCtrl+9', click: () => switchToConversation(8) }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Shift+S', click: () => toggleLeftSidebar() },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: () => showWelcomeWindow() },
        { type: 'separator' },
        { label: 'Check for Updates...', click: () => checkForUpdates(false) }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  trackEvent('app_started');

  createMenu();
  createWindow();

  // Show welcome window on first launch
  if (!settings.hasSeenWelcome) {
    setTimeout(() => showWelcomeWindow(), 1500);
  }

  // Check for updates silently on startup
  setTimeout(() => checkForUpdates(true), 5000);

  app.on('activate', () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Flush cookies before quitting; allow the close handler to destroy the window
app.on('before-quit', async () => {
  isQuitting = true;
  await session.defaultSession.cookies.flushStore();
});
