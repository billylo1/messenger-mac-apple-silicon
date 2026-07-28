// Preload runs before page scripts.
// contextIsolation keeps Node out of the page; we bridge via contextBridge + page inject.

const { contextBridge, ipcRenderer, webFrame } = require('electron');
const fs = require('fs');
const path = require('path');

contextBridge.exposeInMainWorld('messengerDesktop', {
  notify: (payload) => ipcRenderer.send('native-notify', payload),
  setBadge: (count) => ipcRenderer.send('set-badge', count),
});

try {
  const injectPath = path.join(__dirname, 'notification-inject.js');
  const inject = fs.readFileSync(injectPath, 'utf8');
  webFrame.executeJavaScript(inject).catch(() => {});
} catch (err) {
  console.log('[preload] failed to inject notification hooks:', err);
}
