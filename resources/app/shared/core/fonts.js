/* Cài bộ font Science Gothic đi kèm vào thư mục font của TÀI KHOẢN người dùng (không cần admin). (Node) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function displayName(file) {
  // ScienceGothic_ExtraCondensed-Black.ttf -> "Science Gothic ExtraCondensed Black"
  return path.basename(file, path.extname(file))
    .replace(/^ScienceGothic/, 'Science Gothic')
    .replace(/[_-]+/g, ' ').trim();
}

function ensureFonts(fontDir) {
  const files = fs.readdirSync(fontDir).filter((f) => /\.(ttf|otf)$/i.test(f));
  const installed = [], skipped = [], failed = [];

  let dest, sysDir = null;
  if (process.platform === 'win32') {
    dest = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts');
    sysDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  } else {
    dest = path.join(os.homedir(), 'Library', 'Fonts');
  }
  fs.mkdirSync(dest, { recursive: true });

  for (const f of files) {
    const target = path.join(dest, f);
    if (fs.existsSync(target) || (sysDir && fs.existsSync(path.join(sysDir, f)))) { skipped.push(f); continue; }
    try {
      fs.copyFileSync(path.join(fontDir, f), target);
      if (process.platform === 'win32') {
        const r = spawnSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
          '/v', displayName(f) + ' (TrueType)', '/t', 'REG_SZ', '/d', target, '/f'], { windowsHide: true });
        if (r.status !== 0) throw new Error('reg add thất bại');
      }
      installed.push(f);
    } catch (e) {
      failed.push(f + ': ' + e.message);
    }
  }
  if (process.platform === 'win32' && installed.length) {
    notifyWindows(installed.map((f) => path.join(dest, f)));
  }
  return { installed, skipped, failed, needRestart: installed.length > 0 };
}

/**
 * Nạp font vào phiên Windows hiện tại + báo cho các app (giống khi bấm "Install" trong Explorer).
 * Chỉ ghi registry thì nhiều app (After Effects/Premiere) chưa thấy font cho tới khi đăng nhập lại.
 */
function notifyWindows(files) {
  const list = files.map((f) => "'" + f.replace(/'/g, "''") + "'").join(',');
  const ps = [
    'Add-Type -Namespace W -Name F -MemberDefinition @"',
    '[DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern int AddFontResourceW(string f);',
    '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeoutW(IntPtr h, uint m, IntPtr w, IntPtr l, uint fl, uint t, out IntPtr r);',
    '"@',
    'foreach ($f in @(' + list + ')) { [void][W.F]::AddFontResourceW($f) }',
    '$r = [IntPtr]::Zero; [void][W.F]::SendMessageTimeoutW([IntPtr]0xffff, 0x001D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$r)'
  ].join('\n');
  try { spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15000 }); } catch (e) {}
}

/** Nạp lại (không cài) — dùng khi font đã có trong thư mục user nhưng app chưa thấy. */
function reloadFonts(fontDir) {
  if (process.platform !== 'win32') return;
  const dest = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts');
  notifyWindows(fs.readdirSync(fontDir).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(dest, f)));
}

module.exports = { ensureFonts, reloadFonts, displayName };
