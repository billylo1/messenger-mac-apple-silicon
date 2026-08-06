const { app, BrowserWindow, shell, Menu, session, dialog, net, Notification, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { initialize: initAptabase, trackEvent } = require('@aptabase/electron/main');
const path = require('path');
const fs = require('fs');

const CURRENT_VERSION = app.getVersion();
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const GITHUB_REPO_URL = 'https://github.com/billylo1/messenger-mac-apple-silicon';
const UPSTREAM_REPO_URL = 'https://github.com/stefanminch/messenger-mac';

// Aptabase (self-hosted) — must initialize before app.whenReady()
initAptabase('A-SH-4674667238', {
  host: 'https://aptabase.evergreen-labs.org'
});

// Set app data path explicitly
app.setPath('userData', path.join(app.getPath('appData'), 'MessengerApp'));

let mainWindow;
let isQuitting = false;
let lastNotifyKey = '';
let lastNotifyAt = 0;
let updateCheckSilent = true;
let updatePromptOpen = false;
let updaterConfigured = false;
let userAcceptedDownload = false;

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showNativeNotification({ title, body, silent = false }) {
  if (!Notification.isSupported()) {
    console.log('[notify] Electron Notification not supported on this system');
    return null;
  }

  try {
    const notification = new Notification({
      title: title || 'Messenger',
      body: body || '',
      silent: !!silent
    });
    notification.on('click', () => focusMainWindow());
    notification.on('failed', (_e, err) => {
      console.log('[notify] failed:', err);
    });
    notification.show();
    return notification;
  } catch (err) {
    console.log('[notify] error:', err);
    return null;
  }
}

// macOS only prompts for notification access when UNUserNotificationCenter
// receives a request — Electron does that on Notification.show(). Call once
// so the app appears in System Settings → Notifications.
function requestMacNotificationPermission() {
  if (process.platform !== 'darwin') return;
  if (!Notification.isSupported()) return;
  if (settings.hasRequestedNotificationPermission) return;

  settings.hasRequestedNotificationPermission = true;
  saveSettings(settings);

  // Packaged+signed builds can show the system Allow prompt. Dev/unsigned
  // builds typically fail silently — still attempt so Test Notification works
  // the same path.
  console.log('[notify] requesting macOS notification permission');
  showNativeNotification({
    title: 'Messenger for Mac',
    body: 'Allow notifications to get alerts when new messages arrive.'
  });
}

function setupNotificationBridge() {
  ipcMain.on('native-notify', (_event, payload = {}) => {
    const source = payload.source || 'unknown';
    console.log('[notify] ipc from', source, payload.title, (payload.body || '').slice(0, 80));

    // Skip while the user is actively looking at the app
    if (mainWindow && mainWindow.isFocused() && !mainWindow.isMinimized()) {
      console.log('[notify] skipped (window focused)');
      return;
    }

    const title = payload.title || 'Messenger';
    const body = payload.body || '';
    const key = `${payload.tag || ''}|${title}|${body}`;
    const now = Date.now();
    if (key === lastNotifyKey && now - lastNotifyAt < 2000) {
      console.log('[notify] skipped (dedupe)');
      return;
    }
    lastNotifyKey = key;
    lastNotifyAt = now;

    showNativeNotification({
      title,
      body,
      silent: !!payload.silent
    });
  });

  ipcMain.on('set-badge', (_event, count) => {
    const n = Number(count) || 0;
    app.setBadgeCount(n > 0 ? n : 0);
  });
}

function setupPermissionHandlers(ses) {
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allow = [
      'notifications',
      'media',
      'mediaKeySystem',
      'pointerLock',
      'fullscreen',
      'clipboard-sanitized-write'
    ].includes(permission);
    callback(allow);
  });

  ses.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'notifications') return true;
    return true;
  });
}

const NOTIFICATION_INJECT = fs.readFileSync(path.join(__dirname, 'notification-inject.js'), 'utf8');

function injectNotificationHooks(webContents) {
  if (!webContents || webContents.isDestroyed()) return;

  const run = (frame) => {
    if (!frame || frame.isDestroyed?.()) return;
    frame.executeJavaScript(NOTIFICATION_INJECT, true).catch(() => {});
  };

  try {
    run(webContents.mainFrame);
    for (const frame of webContents.mainFrame.framesInSubtree || []) {
      run(frame);
    }
  } catch (err) {
    webContents.executeJavaScript(NOTIFICATION_INJECT, true).catch(() => {});
  }
}

function setPageVisibility(hidden) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Messenger suppresses alerts while the page looks focused/visible.
  // Spoof hidden + hasFocus when the window is blurred/minimized.
  const script = `
    (function() {
      try {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: function() { return ${hidden ? 'true' : 'false'}; }
        });
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: function() { return '${hidden ? 'hidden' : 'visible'}'; }
        });
        document.hasFocus = function() { return ${hidden ? 'false' : 'true'}; };
        document.dispatchEvent(new Event('visibilitychange'));
        try {
          window.dispatchEvent(new Event(${hidden ? "'blur'" : "'focus'"}));
        } catch (e) {}
      } catch (e) {}
    })();
  `;
  mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
}

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

function trackDailyUsage() {
  const today = new Date().toISOString().split('T')[0];
  if (settings.lastPingDate === today) return;

  if (!settings.installId) {
    settings.installId = generateInstallId();
  }
  settings.lastPingDate = today;
  saveSettings(settings);

  const dailyPing = net.request({
    method: 'GET',
    url: `https://api.counterapi.dev/v1/messenger-mac/daily-${today}/up`
  });
  dailyPing.on('error', () => {});
  dailyPing.end();

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

function setupAutoUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // We don't publish .blockmap files on GitHub releases — force a full zip download.
  autoUpdater.disableDifferentialDownload = true;
  // Surface updater internals in Console.app / stdout for packaged debugging
  autoUpdater.logger = {
    info: (...args) => console.log('[updater]', ...args),
    warn: (...args) => console.log('[updater:warn]', ...args),
    error: (...args) => console.log('[updater:error]', ...args),
    debug: (...args) => console.log('[updater:debug]', ...args)
  };

  autoUpdater.on('update-available', (info) => {
    if (updatePromptOpen) return;
    updatePromptOpen = true;
    const version = info.version || 'new';
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `A new version (v${version}) is available!`,
      detail: `You have v${CURRENT_VERSION}. Download and install the update?`,
      buttons: ['Update', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      updatePromptOpen = false;
      if (response !== 0) return;

      userAcceptedDownload = true;
      console.log('[updater] user accepted download for', version);

      // Immediate feedback — the zip is ~90MB and otherwise looks hung
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(0);
      }
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Downloading Update',
        message: `Downloading v${version}…`,
        detail: 'This may take a minute. The dock icon shows download progress. You will be asked to restart when it is ready.',
        buttons: ['OK']
      });

      autoUpdater.downloadUpdate().catch((err) => {
        console.log('[updater] download failed:', err);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setProgressBar(-1);
        }
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Update Failed',
          message: 'Could not download the update.',
          detail: String(err && err.message ? err.message : err)
        });
        userAcceptedDownload = false;
      });
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const fraction = Math.max(0, Math.min(1, (progress.percent || 0) / 100));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(fraction);
    }
    if (progress.percent && Math.floor(progress.percent) % 10 === 0) {
      console.log(
        `[updater] download ${progress.percent.toFixed(0)}% ` +
        `(${Math.round((progress.transferred || 0) / 1e6)}/${Math.round((progress.total || 0) / 1e6)} MB)`
      );
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (!updateCheckSilent) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No Updates',
        message: 'You\'re up to date!',
        detail: `Version ${CURRENT_VERSION} is the latest.`
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info.version || 'new';
    console.log('[updater] downloaded', version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Version v${version} has been downloaded.`,
      detail: 'Restart Messenger for Mac to install the update.',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.log('[updater] error:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
    // Always show errors after the user opted into a download; otherwise only
    // for manual "Check for Updates..." (silent startup checks stay quiet).
    if (userAcceptedDownload || !updateCheckSilent) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Update Failed',
        message: userAcceptedDownload
          ? 'Could not download or install the update.'
          : 'Could not check for updates.',
        detail: String(err && err.message ? err.message : err)
      });
      userAcceptedDownload = false;
    }
  });
}

function checkForUpdates(silent = false) {
  updateCheckSilent = !!silent;

  if (!app.isPackaged) {
    if (!silent) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Updates',
        message: 'Self-update is only available in installed builds.',
        detail: `You are running a development build (v${CURRENT_VERSION}).`
      });
    }
    return;
  }

  setupAutoUpdater();
  autoUpdater.checkForUpdates().catch((err) => {
    console.log('[updater] check failed:', err);
    if (!silent) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: String(err && err.message ? err.message : err)
      });
    }
  });
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
        <div class="feature"><span class="feature-icon">🔔</span><span>Native Notifications - Alerts for new messages</span></div>
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
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep Messenger's realtime connection alive in the background so
      // new-message events (and thus notifications) still arrive.
      backgroundThrottling: false
    }
  });

  // Keep our window title; document.title still updates for unread badges.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
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

  // Re-inject into main + child frames (Messenger may create fbsbx iframes later)
  mainWindow.webContents.on('dom-ready', () => {
    injectNotificationHooks(mainWindow.webContents);
  });
  mainWindow.webContents.on('did-frame-finish-load', (_event, isMainFrame) => {
    injectNotificationHooks(mainWindow.webContents);
    if (isMainFrame) {
      // Ensure visibility matches window state after navigations
      setPageVisibility(!(mainWindow.isFocused() && !mainWindow.isMinimized()));
    }
  });
  mainWindow.webContents.on('frame-created', (_event, details) => {
    const frame = details && details.frame;
    if (!frame) return;
    frame.executeJavaScript(NOTIFICATION_INJECT, true).catch(() => {});
  });

  // Apply sidebar state when page finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => applySidebarState(), 1000);
  });

  // Spoof Page Visibility so Messenger raises notifications when unfocused
  mainWindow.on('blur', () => setPageVisibility(true));
  mainWindow.on('focus', () => setPageVisibility(false));
  mainWindow.on('minimize', () => setPageVisibility(true));
  mainWindow.on('restore', () => {
    if (mainWindow.isFocused()) setPageVisibility(false);
  });

  // Red close button / Cmd+W: minimize instead of destroying the window,
  // so Messenger stays loaded and resumes instantly. Real quit is via
  // menu Quit or Cmd+Q (isQuitting).
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.minimize();
      setPageVisibility(true);
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
        {
          label: 'Test Notification',
          click: () => {
            if (!Notification.isSupported()) {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Notifications',
                message: 'Notifications are not supported on this system.'
              });
              return;
            }
            // Force a fresh permission attempt if the user is debugging alerts
            settings.hasRequestedNotificationPermission = true;
            saveSettings(settings);
            const n = showNativeNotification({
              title: 'Messenger for Mac',
              body: 'Native notifications are working.'
            });
            if (n) {
              n.on('failed', (_e, err) => {
                dialog.showMessageBox(mainWindow, {
                  type: 'warning',
                  title: 'Notification Failed',
                  message: 'macOS rejected the notification.',
                  detail: String(err || '') + '\n\nCheck System Settings → Notifications → MessengerApp. Signed builds are required for reliable alerts.'
                });
              });
            }
          }
        },
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

  // Native About panel — Credits.html (bundled) provides a clickable GitHub link;
  // unpackaged/dev falls back to the URL in the credits text field.
  // Native About panel — Credits.html (bundled) has the disclaimer + repo links.
  // Unpackaged/dev uses the credits string (no copyright line — avoids duplication).
  const aboutOptions = {
    applicationName: 'Messenger for Mac',
    applicationVersion: CURRENT_VERSION,
    version: CURRENT_VERSION
  };
  if (!app.isPackaged) {
    aboutOptions.credits =
      'Open-source, unofficial utility. Not affiliated with Meta.\n\n' +
      `This fork: ${GITHUB_REPO_URL}\n` +
      `Original by Stefan Minch: ${UPSTREAM_REPO_URL}`;
  }
  app.setAboutPanelOptions(aboutOptions);

  setupPermissionHandlers(session.defaultSession);
  setupNotificationBridge();

  createMenu();
  createWindow();

  // Ask macOS for notification access (triggers the system Allow prompt).
  // Delay past the first-run welcome window so dialogs don't stack.
  const permissionDelay = settings.hasSeenWelcome ? 1500 : 4500;
  setTimeout(() => requestMacNotificationPermission(), permissionDelay);

  // Show welcome window on first launch
  if (!settings.hasSeenWelcome) {
    setTimeout(() => showWelcomeWindow(), 1500);
  }

  trackDailyUsage();

  // Check for updates silently on startup (packaged builds only)
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
    setPageVisibility(false);
  });
});

// Clear dock badge on quit
app.on('will-quit', () => {
  app.setBadgeCount(0);
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
