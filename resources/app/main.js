/* AutoSub Typo Pro for CapCut — tiến trình chính Electron. */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pkg = require('./package.json');
const updater = require(path.join(__dirname, 'shared', 'core', 'updater.js'));

if (process.platform === 'win32') {
  app.setAppUserModelId('com.autosub.typo.pro');
}

let mainWin = null;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

function appIconPath() {
  const ico = path.join(__dirname, 'shared', 'assets', 'app.ico');
  if (fs.existsSync(ico)) return ico;
  const png = path.join(__dirname, 'shared', 'assets', 'logo.png');
  return fs.existsSync(png) ? png : undefined;
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#090c1d',
    title: 'AutoSub Typo Pro for CapCut',
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // cho phép <video> & <audio> phát file cục bộ của project CapCut
    }
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWin.on('closed', () => { mainWin = null; });
}

ipcMain.handle('pick-file', async (_e, opts) => {
  const r = await dialog.showOpenDialog(opts || {});
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pick-dir', async (_e, opts) => {
  const r = await dialog.showOpenDialog(Object.assign({ properties: ['openDirectory'] }, opts || {}));
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('app-info', () => ({
  version: pkg.version || app.getVersion(),
  resources: app.isPackaged ? process.resourcesPath : __dirname,
  packaged: app.isPackaged,
  repo: pkg.repository || ''
}));

ipcMain.handle('check-updates', async () => {
  const currentVersion = pkg.version || app.getVersion();
  return updater.checkForUpdates(pkg.repository, currentVersion, __dirname);
});

ipcMain.handle('install-update', async (_e, asset) => {
  if (!asset || !asset.url || !asset.name) {
    return { ok: false, error: 'Thiếu thông tin file cập nhật.' };
  }
  const currentVersion = pkg.version || app.getVersion();
  const safeName = path.basename(asset.name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = path.join(os.tmpdir(), safeName);
  try {
    await updater.downloadFile(asset.url, destPath, `AutoSub-Typo-Pro/${currentVersion}`, (prog) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('update-progress', prog);
      }
    });
    updater.applyAndRestart({
      filePath: destPath,
      kind: asset.kind === 'installer' ? 'installer' : 'zip',
      appDir: __dirname,
      exePath: process.execPath,
      pid: process.pid
    });
    setTimeout(() => app.quit(), 250);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url);
  }
  return false;
});

if (gotLock) {
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());
