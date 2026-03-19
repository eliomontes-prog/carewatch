// electron/main.js — CareWatch Desktop App
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell } from 'electron';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd    = app.isPackaged;
const isDev     = !isProd;

// ── Backend server reference (spawned as child process in production) ──
let backendProcess = null;
let mainWindow     = null;
let tray           = null;
let isQuitting     = false;

// ── Window management ────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',  // macOS native look
    backgroundColor: '#F9FAFB',
    icon: resolve(__dirname, 'assets/icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: resolve(__dirname, 'preload.js'),
    },
    show: false, // Show after ready-to-show
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(resolve(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Intercept close — minimize to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === 'darwin') app.dock.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── System Tray ──────────────────────────────────────────────────────
function createTray() {
  const iconPath = resolve(__dirname, 'assets/icon-32.png');
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.resize({ width: 16, height: 16 }));

  tray.setToolTip('CareWatch — Monitoring Active');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open CareWatch',
      click: showWindow,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') app.dock.show();
  }
}

// ── IPC: native notifications from renderer ──────────────────────────
ipcMain.on('show-notification', (_, { title, body, urgency }) => {
  if (Notification.isSupported()) {
    const n = new Notification({
      title,
      body,
      icon: resolve(__dirname, 'assets/icon-256.png'),
      urgency: urgency === 'high' ? 'critical' : 'normal',
      timeoutType: urgency === 'high' ? 'never' : 'default',
    });
    n.on('click', showWindow);
    n.show();
  }
  // Update tray badge with unread count
  if (process.platform === 'darwin') {
    const current = parseInt(app.dock.getBadge() || '0', 10);
    app.dock.setBadge(String(current + 1));
  }
});

ipcMain.on('clear-badge', () => {
  if (process.platform === 'darwin') app.dock.setBadge('');
});

// ── App menu ─────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'CareWatch',
      submenu: [
        { label: 'About CareWatch', role: 'about' },
        { type: 'separator' },
        { label: 'Hide CareWatch', accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others',    accelerator: 'Command+Shift+H', role: 'hideOthers' },
        { type: 'separator' },
        { label: 'Quit CareWatch', accelerator: 'Command+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload',         accelerator: 'Command+R',       role: 'reload' },
        { label: 'Force Reload',   accelerator: 'Command+Shift+R', role: 'forceReload' },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: 'Control+Command+F', role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { isQuitting = true; });
