/* Kiểm tra và tự động cập nhật OTA từ GitHub Releases (chạy ở tiến trình chính Electron). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

function parseSemver(ver) {
  const m = String(ver || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 10) || 0, parseInt(m[2], 10) || 0, parseInt(m[3], 10) || 0];
}

function isNewerVersion(remoteTag, currentVersion) {
  const a = parseSemver(remoteTag);
  const b = parseSemver(currentVersion);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function canWriteDir(dir) {
  try {
    const probe = path.join(dir, `.upd-probe-${process.pid}.tmp`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

function requestJson(url, userAgent, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/vnd.github+json'
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub API HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Không đọc được JSON từ GitHub Releases'));
        }
      });
    });
    req.on('error', (e) => reject(new Error('Không kết nối được GitHub: ' + e.message)));
    req.setTimeout(timeoutMs || 15000, () => req.destroy(new Error('Quá thời gian kiểm tra cập nhật')));
  });
}

function pickAsset(release, appDir) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const writable = canWriteDir(appDir);
  if (writable) {
    const zip = assets.find((a) => /^AutoSub-Typo-Pro-Update-.*\.zip$/i.test(a.name || ''));
    if (zip && zip.browser_download_url) {
      return { kind: 'zip', name: zip.name, url: zip.browser_download_url, size: zip.size || 0 };
    }
  }
  const setup = assets.find((a) => /Setup.*\.exe$/i.test(a.name || '') || /\.exe$/i.test(a.name || ''));
  if (setup && setup.browser_download_url) {
    return { kind: 'installer', name: setup.name, url: setup.browser_download_url, size: setup.size || 0 };
  }
  return null;
}

async function checkForUpdates(repo, currentVersion, appDir, timeoutMs) {
  if (!repo || !repo.includes('/')) {
    return { ok: false, error: 'Chưa cấu hình repository GitHub.' };
  }
  try {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const rel = await requestJson(url, `AutoSub-Typo-Pro/${currentVersion}`, timeoutMs || 15000);
    const latestTag = String(rel.tag_name || '').trim();
    const latestVersion = latestTag.replace(/^v/i, '');
    const hasUpdate = isNewerVersion(latestTag, currentVersion);
    const asset = hasUpdate ? pickAsset(rel, appDir) : null;
    return {
      ok: true,
      hasUpdate,
      currentVersion: String(currentVersion).replace(/^v/i, ''),
      latestVersion,
      tagName: latestTag,
      notes: rel.body || '',
      htmlUrl: rel.html_url || `https://github.com/${repo}/releases`,
      asset
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function downloadFile(url, destPath, userAgent, onProgress, opts, redirects) {
  if (typeof opts === 'number') { redirects = opts; opts = {}; }
  opts = opts || {};
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    const signal = opts.signal;
    if (signal && signal.aborted) return reject(new Error('Đã hủy tải cập nhật'));

    const partPath = destPath + '.part';
    try { fs.unlinkSync(partPath); } catch (e) {}
    let settled = false;
    let out = null;

    const cleanupPart = () => { try { fs.unlinkSync(partPath); } catch (e) {} };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (out) { try { out.destroy(); } catch (e) {} }
      cleanupPart();
      reject(err);
    };

    const req = https.get(url, { headers: { 'User-Agent': userAgent } }, (res) => {
      if (signal && signal.aborted) { res.resume(); return fail(new Error('Đã hủy tải cập nhật')); }
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects > 8) return fail(new Error('Quá nhiều chuyển hướng khi tải bản cập nhật'));
        const nextUrl = new URL(res.headers.location, url).toString();
        settled = true;
        return resolve(downloadFile(nextUrl, destPath, userAgent, onProgress, opts, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return fail(new Error(`Tải bản cập nhật thất bại (HTTP ${res.statusCode})`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      out = fs.createWriteStream(partPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress({ percent: total > 0 ? Math.min(1, received / total) : 0, received, total });
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        if (settled) return;
        if (signal && signal.aborted) return fail(new Error('Đã hủy tải cập nhật'));
        if (total > 0 && received < total) {
          return fail(new Error('Tải bản cập nhật bị gián đoạn giữa chừng'));
        }
        try { fs.unlinkSync(destPath); } catch (e) {}
        fs.renameSync(partPath, destPath);
        settled = true;
        resolve(destPath);
      }));
      res.on('error', fail);
      out.on('error', fail);
    });

    if (signal) {
      const onAbort = () => {
        try { req.destroy(); } catch (e) {}
        fail(new Error('Đã hủy tải cập nhật'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('error', (e) => fail(new Error('Lỗi tải bản cập nhật: ' + e.message)));
    req.setTimeout(120000, () => req.destroy(new Error('Hết thời gian chờ tải bản cập nhật')));
  });
}

function verifyMagicBytes(filePath, kind) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(2);
    const read = fs.readSync(fd, buf, 0, 2, 0);
    if (read < 2) throw new Error('File tải về bị rỗng hoặc lỗi');
    if (kind === 'zip' && (buf[0] !== 0x50 || buf[1] !== 0x4b)) {
      throw new Error('File ZIP cập nhật không hợp lệ');
    }
    if (kind === 'installer' && (buf[0] !== 0x4d || buf[1] !== 0x5a)) {
      throw new Error('File cài đặt EXE không hợp lệ');
    }
  } finally {
    fs.closeSync(fd);
  }
}

function applyAndRestart({ filePath, kind, appDir, exePath, pid, targetTag }) {
  if (process.platform !== 'win32') {
    throw new Error('Tự động cập nhật hiện chỉ hỗ trợ Windows.');
  }
  verifyMagicBytes(filePath, kind);
  const tmpDir = os.tmpdir();
  const safeTag = String(targetTag || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const extraArg = safeTag ? ` --ota-target=${safeTag}` : '';
  const isElectronDev = path.basename(exePath).toLowerCase() === 'electron.exe';
  const launchCmd = isElectronDev
    ? `start "" /D "${appDir}" "${exePath}" "${appDir}"${extraArg}`
    : `start "" /D "${path.dirname(exePath)}" "${exePath}"${extraArg}`;

  if (kind === 'installer') {
    const batPath = path.join(tmpDir, `autosub-setup-${pid}.bat`);
    const bat = [
      '@echo off',
      'chcp 65001 >nul',
      'setlocal',
      `set "PID=${pid}"`,
      'set /a TRIES=0',
      ':wait_exit',
      'tasklist /FI "PID eq %PID%" /FO CSV /NH 2>nul | find "\\"%PID%\\"" >nul',
      'if not errorlevel 1 (',
      '  set /a TRIES+=1',
      '  if %TRIES% lss 30 (',
      '    ping -n 2 127.0.0.1 >nul',
      '    goto wait_exit',
      '  )',
      ')',
      `start "" /wait "${filePath}" /SILENT /NORESTART`,
      `del /f /q "${filePath}" >nul 2>&1`,
      launchCmd,
      '(goto) 2>nul & del "%~f0"',
      ''
    ].join('\r\n');
    fs.writeFileSync(batPath, bat, 'utf8');
    const child = spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return;
  }

  const stageDir = path.join(tmpDir, `autosub-stage-${pid}`);
  const batPath = path.join(tmpDir, `autosub-update-${pid}.bat`);
  const zipPs = filePath.replace(/'/g, "''");
  const stagePs = stageDir.replace(/'/g, "''");

  const bat = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal EnableExtensions',
    `set "PID=${pid}"`,
    `set "ZIP=${filePath}"`,
    `set "STAGE=${stageDir}"`,
    `set "APPDIR=${appDir}"`,
    'set /a TRIES=0',
    ':wait_exit',
    'tasklist /FI "PID eq %PID%" /FO CSV /NH 2>nul | find "\\"%PID%\\"" >nul',
    'if not errorlevel 1 (',
    '  set /a TRIES+=1',
    '  if %TRIES% lss 30 (',
    '    ping -n 2 127.0.0.1 >nul',
    '    goto wait_exit',
    '  )',
    ')',
    'if exist "%STAGE%" rmdir /s /q "%STAGE%"',
    'mkdir "%STAGE%"',
    'tar -xf "%ZIP%" -C "%STAGE%" >nul 2>&1',
    'if errorlevel 1 (',
    `  powershell -NoProfile -NonInteractive -Command "Expand-Archive -LiteralPath '${zipPs}' -DestinationPath '${stagePs}' -Force"`,
    ')',
    'set "SRC=%STAGE%"',
    'if exist "%STAGE%\\resources\\app\\package.json" set "SRC=%STAGE%\\resources\\app"',
    'if not exist "%SRC%\\package.json" goto cleanup',
    'robocopy "%SRC%" "%APPDIR%" /E /R:4 /W:1 /NFL /NDL /NJH /NJS >nul',
    ':cleanup',
    'if exist "%STAGE%" rmdir /s /q "%STAGE%"',
    'if exist "%ZIP%" del /f /q "%ZIP%" >nul 2>&1',
    launchCmd,
    '(goto) 2>nul & del "%~f0"',
    ''
  ].join('\r\n');

  fs.writeFileSync(batPath, bat, 'utf8');
  const child = spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

module.exports = {
  parseSemver,
  isNewerVersion,
  checkForUpdates,
  downloadFile,
  applyAndRestart
};
