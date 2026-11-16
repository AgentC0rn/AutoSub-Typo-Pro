/* AutoSub Typo Pro for CapCut — tiến trình chính Electron (hỗ trợ Pre-launch OTA). */
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
let splashWin = null;
let pendingOtaResult = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = (mainWin && !mainWin.isDestroyed()) ? mainWin : (splashWin && !splashWin.isDestroyed() ? splashWin : null);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function appIconPath() {
  const ico = path.join(__dirname, 'shared', 'assets', 'app.ico');
  if (fs.existsSync(ico)) return ico;
  const png = path.join(__dirname, 'shared', 'assets', 'logo.png');
  return fs.existsSync(png) ? png : undefined;
}

function currentVersion() {
  return String(pkg.version || app.getVersion()).replace(/^v/i, '');
}

function parseOtaTargetArg(argv) {
  const hit = (argv || []).find((a) => typeof a === 'string' && a.startsWith('--ota-target='));
  return hit ? hit.slice('--ota-target='.length).trim() : '';
}

function createWindow(justUpdatedVer, onShown) {
  if (mainWin && !mainWin.isDestroyed()) {
    if (onShown) onShown();
    return;
  }
  mainWin = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    show: false,
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

  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (mainWin && !mainWin.isDestroyed()) mainWin.show();
    if (onShown) onShown();
  };

  mainWin.once('ready-to-show', reveal);
  setTimeout(reveal, 1500);
  mainWin.loadFile(path.join(__dirname, 'index.html'));
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  if (justUpdatedVer) {
    mainWin.webContents.once('did-finish-load', () => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('app-just-updated', justUpdatedVer);
      }
    });
  }
  mainWin.on('closed', () => { mainWin = null; });
}

async function downloadAndApplyAsset(asset, targetTag, onProgress, signal) {
  const ver = currentVersion();
  const safeName = path.basename(asset.name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = path.join(os.tmpdir(), safeName);
  await updater.downloadFile(asset.url, destPath, `AutoSub-Typo-Pro/${ver}`, onProgress, { signal });
  updater.applyAndRestart({
    filePath: destPath,
    kind: asset.kind === 'installer' ? 'installer' : 'zip',
    appDir: __dirname,
    exePath: process.execPath,
    pid: process.pid,
    targetTag: targetTag || ''
  });
  setTimeout(() => app.quit(), 250);
}

function sendSplashState(payload) {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents.send('splash-state', payload);
  }
}

function bootWithPrelaunchOta() {
  const ver = currentVersion();
  const otaTarget = parseOtaTargetArg(process.argv);
  if (otaTarget && otaTarget === `v${ver}`) {
    createWindow(ver);
    return;
  }

  splashWin = new BrowserWindow({
    width: 460,
    height: 220,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#090c1d',
    title: 'AutoSub Typo Pro',
    icon: appIconPath(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const skipController = new AbortController();
  let transitioned = false;

  const closeSplash = () => {
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.close();
    }
    splashWin = null;
  };

  const transitionToMain = () => {
    if (transitioned) return;
    transitioned = true;
    skipController.abort();
    ipcMain.removeListener('splash-skip', transitionToMain);
    ipcMain.removeAllListeners('splash-confirm-installer');
    createWindow(null, closeSplash);
  };

  const runSplashInstall = async (res) => {
    sendSplashState({
      version: ver,
      status: `Tìm thấy bản mới v${res.latestVersion} — Đang tải OTA…`,
      sub: 'Đang kết nối GitHub Releases…',
      indeterminate: false,
      percent: 0,
      showInstall: false
    });
    try {
      await downloadAndApplyAsset(res.asset, res.tagName, (prog) => {
        if (transitioned || !prog) return;
        const pct = Math.round((prog.percent || 0) * 100);
        const gotMb = ((prog.received || 0) / 1048576).toFixed(1);
        const totMb = prog.total ? ((prog.total / 1048576).toFixed(1) + ' MB') : '…';
        sendSplashState({
          version: ver,
          status: `Đang tải bản cập nhật v${res.latestVersion} (${pct}%)…`,
          sub: `${gotMb} / ${totMb}`,
          indeterminate: false,
          percent: prog.percent || 0
        });
      }, skipController.signal);
      if (transitioned) return;
      transitioned = true;
      ipcMain.removeListener('splash-skip', transitionToMain);
      sendSplashState({
        version: ver,
        status: `Đang cài đặt v${res.latestVersion} và khởi động lại…`,
        sub: 'Quá trình chỉ mất vài giây…',
        indeterminate: false,
        percent: 1,
        disableSkip: true
      });
    } catch (e) {
      if (transitioned || skipController.signal.aborted) return;
      sendSplashState({
        version: ver,
        status: 'Không thể tải cập nhật tự động',
        sub: e.message,
        indeterminate: false,
        percent: 1
      });
      setTimeout(transitionToMain, 1200);
    }
  };

  splashWin.on('closed', () => {
    splashWin = null;
    if (!transitioned) skipController.abort();
  });
  splashWin.once('ready-to-show', () => {
    if (splashWin && !splashWin.isDestroyed()) splashWin.show();
  });

  ipcMain.once('splash-skip', transitionToMain);

  splashWin.loadFile(path.join(__dirname, 'splash.html'));
  splashWin.webContents.once('did-finish-load', async () => {
    if (transitioned) return;
    sendSplashState({
      version: ver,
      status: 'Đang kiểm tra bản cập nhật OTA…',
      sub: 'Kiểm tra phiên bản mới trên GitHub Releases',
      indeterminate: true
    });

    const res = await updater.checkForUpdates(pkg.repository, ver, __dirname, 4500);
    if (transitioned) return;
    if (!res || !res.ok || !res.hasUpdate || !res.asset) {
      sendSplashState({
        version: ver,
        status: 'Đang khởi chạy ứng dụng…',
        sub: res && !res.ok ? 'Bỏ qua kiểm tra trực tuyến' : `Phiên bản hiện tại v${ver}`,
        indeterminate: false,
        percent: 1
      });
      setTimeout(transitionToMain, 120);
      return;
    }

    pendingOtaResult = res;

    if (otaTarget && otaTarget === res.tagName) {
      sendSplashState({
        version: ver,
        status: `Chưa áp dụng được ${res.tagName}`,
        sub: 'Đang mở phiên bản hiện tại (có thể thử lại trong app)…',
        indeterminate: false,
        percent: 1
      });
      setTimeout(transitionToMain, 1300);
      return;
    }

    if (res.asset.kind === 'zip') {
      await runSplashInstall(res);
      return;
    }

    const sizeMb = res.asset.size ? ` (${(res.asset.size / 1048576).toFixed(0)} MB)` : '';
    sendSplashState({
      version: ver,
      status: `Đã có bản cập nhật mới v${res.latestVersion}`,
      sub: `Gói cài đặt đầy đủ${sizeMb} — chọn tải hoặc bỏ qua`,
      indeterminate: false,
      percent: 0,
      showInstall: true
    });
    ipcMain.once('splash-confirm-installer', () => {
      if (!transitioned) runSplashInstall(res);
    });
  });
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
  version: currentVersion(),
  resources: app.isPackaged ? process.resourcesPath : __dirname,
  packaged: app.isPackaged,
  repo: pkg.repository || ''
}));

ipcMain.handle('get-pending-update', () => pendingOtaResult);

ipcMain.handle('check-updates', async () => {
  const res = await updater.checkForUpdates(pkg.repository, currentVersion(), __dirname, 15000);
  if (res && res.ok) pendingOtaResult = res.hasUpdate ? res : null;
  return res;
});

ipcMain.handle('install-update', async (_e, asset, tagName) => {
  if (!asset || !asset.url || !asset.name) {
    return { ok: false, error: 'Thiếu thông tin file cập nhật.' };
  }
  try {
    await downloadAndApplyAsset(asset, tagName || (pendingOtaResult && pendingOtaResult.tagName) || '', (prog) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('update-progress', prog);
      }
    });
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
  app.whenReady().then(bootWithPrelaunchOta);
}
app.on('window-all-closed', () => app.quit());
