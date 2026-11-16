/*
 * Quét font đã cài trên máy người dùng (Windows): thư mục font hệ thống + font cài riêng cho user.
 * Mỗi font: { file, family, style, full, ps, vi (đủ dấu tiếng Việt), size, mtime }.
 * Kết quả được lưu cache (%APPDATA%\AutoSubTypo\fontcache.json) theo đường dẫn + thời gian sửa + dung lượng. (Node)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ttf = require('./ttf.js');

const VI_SAMPLE = 'ăâđêôơưàảãạằắẳẵặầấẩẫậèẻẽẹềếểễệìỉĩịòỏõọồốổỗộờớởỡợùủũụừứửữựỳỷỹỵĂÂĐÊÔƠƯ';
const CACHE_VERSION = 2;

function fontDirs() {
  const win = process.env.WINDIR || 'C:\\Windows';
  return [
    path.join(win, 'Fonts'),
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')
  ].filter((d) => fs.existsSync(d));
}

function cacheFile() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'AutoSubTypo', 'fontcache.json');
}

function loadCache() {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    return c.version === CACHE_VERSION ? c.fonts : {};
  } catch (e) { return {}; }
}
function saveCache(map) {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify({ version: CACHE_VERSION, fonts: map }));
  } catch (e) {}
}

/**
 * Quét font. Chạy theo từng lô và nhường luồng (await) để giao diện không bị đứng.
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<Array>} danh sách font, sắp theo họ font rồi kiểu
 */
async function scan(onProgress) {
  const files = [];
  for (const d of fontDirs()) {
    for (const f of fs.readdirSync(d)) if (/\.(ttf|otf)$/i.test(f)) files.push(path.join(d, f));
  }
  const cache = loadCache();
  const next = {};
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let st;
    try { st = fs.statSync(file); } catch (e) { continue; }
    const key = file.toLowerCase();
    let info = cache[key];
    if (!info || info.size !== st.size || info.mtime !== st.mtimeMs) {
      const names = ttf.readNames(file);
      info = names ? Object.assign(names, { vi: ttf.hasChars(file, VI_SAMPLE), size: st.size, mtime: st.mtimeMs }) : { bad: true, size: st.size, mtime: st.mtimeMs };
    }
    next[key] = info;
    if (!info.bad) out.push(Object.assign({ file }, info));
    if (i % 25 === 0) {
      if (onProgress) onProgress(i, files.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  saveCache(next);
  if (onProgress) onProgress(files.length, files.length);
  // Bỏ trùng (cùng font cài cả cho máy và cho user): giữ bản đầu tiên.
  const seen = new Set();
  return out
    .filter((f) => { const k = (f.ps || f.full).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
}

module.exports = { scan, fontDirs, VI_SAMPLE };
