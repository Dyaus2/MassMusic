// MassMusic desktop app: runs the server inside Electron and shows the UI in its own window.
import { app, BrowserWindow, Menu, nativeTheme, shell, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 4545; // fixed: the Spotify redirect URI uses it
process.env.PORT = String(PORT);
// keep the library in the user's app-data folder (the packaged app's own folder is read-only)
process.env.MASSMUSIC_DATA ||= path.join(app.getPath('userData'), 'data');

const APP_URL = `http://localhost:${PORT}`;
const ICON = path.join(import.meta.dirname, 'icon.png');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

// Present as plain Chrome so sites (YouTube) treat the window like a normal browser
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|massmusic)\/\S+/gi, '');
nativeTheme.themeSource = 'dark';
Menu.setApplicationMenu(null);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    try {
      await startOrReuseServer();
    } catch (e) {
      dialog.showErrorBox('MassMusic could not start', String(e?.message || e));
      app.quit();
      return;
    }
    win = createWindow();
  });
}

async function startOrReuseServer() {
  const { startServer } = await import('../server/index.js');
  try {
    await startServer();
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    // Another MassMusic (e.g. MassMusic.bat) is already running on this port: just use it
    const ok = await fetch(`http://127.0.0.1:${PORT}/api/settings`).then((r) => r.ok).catch(() => false);
    if (!ok) throw new Error(`Port ${PORT} is used by another program. Close it and try again.`);
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { width: 1400, height: 900 };
  }
}

function saveState(win) {
  try {
    const maximized = win.isMaximized();
    const b = maximized ? loadState() : win.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized }));
  } catch { /* not important */ }
}

const isAppUrl = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
const isSpotifyLogin = (u) => /^https:\/\/([a-z0-9-]+\.)*spotify\.com\//.test(u);

function createWindow() {
  const state = loadState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    title: 'MassMusic',
    icon: ICON,
    backgroundColor: '#050506',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveState(win));

  // Links to YouTube, Spotify pages, the developer dashboard... open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Stay on the app; only the Spotify login page may open inside the window
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url) || isSpotifyLogin(url)) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r') { win.webContents.reload(); e.preventDefault(); }
    if (input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  win.loadURL(APP_URL);
  return win;
}
