// electron/preload.js — secure bridge between renderer and main process
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  // Send native notification through Electron (bypasses browser Notification API limitations)
  showNotification: (opts) => ipcRenderer.send('show-notification', opts),

  // Clear dock badge when user views alerts
  clearBadge: () => ipcRenderer.send('clear-badge'),

  // Platform info
  platform: process.platform,
  isElectron: true,
});
