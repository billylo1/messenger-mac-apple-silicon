// Preload runs before page scripts (sandboxed — no Node fs/path).
// Main process injects notification-inject.js into the page world.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('messengerDesktop', {
  notify: (payload) => ipcRenderer.send('native-notify', payload),
  setBadge: (count) => ipcRenderer.send('set-badge', count),
});
