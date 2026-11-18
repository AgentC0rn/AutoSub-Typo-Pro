/*
 * Tự tải công cụ nhận dạng giọng nói lần đầu chạy hoặc sau cập nhật OTA (Windows):
 *   - faster-whisper runtime (Python 3.11 embeddable + faster-whisper + ctranslate2 + silero-vad)
 *   - ffmpeg (bản LGPL, được phép phân phối kèm sản phẩm thương mại)
 *   - model PhoWhisper-small-ct2 (INT8 CPU + VAD)
 * Lưu tại %APPDATA%\AutoSubTypo -> cập nhật OTA không phải tải lại nhiều lần. (Node)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync, spawn } = require('child_process');

const REL_BASE = 'https://github.com/AgentC0rn/AutoSub-Typo-Pro/releases/latest/download';
const SOURCES = {
  fasterWhisper: { url: `${REL_BASE}/faster-whisper-runtime-win64.zip`, mb: 115 },
  ffmpeg: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip', mb: 73 }
};
const MODELS = {
  'phowhisper-small-ct2': {
    dir: 'PhoWhisper-small-ct2',
    url: `${REL_BASE}/PhoWhisper-small-ct2-int8.zip`,
    mb: 245,
    label: 'PhoWhisper-small-ct2 (INT8 · CPU + vad_filter)'
  }
};
const MODEL_URL = (k) => (MODELS[k] || MODELS['phowhisper-small-ct2']).url;

function toolsDir() {
  const base = process.platform === 'win32'
    ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : path.join(os.homedir(), 'Library', 'Application Support');
  return path.join(base, 'AutoSubTypo');
}

function hasNvidia() {
  try {
    const r = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim().split(/\r?\n/)[0] : null;
  } catch (e) { return null; }
}

function findFile(dir, name, depth) {
  if (!fs.existsSync(dir) || depth < 0) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { const r = findFile(path.join(dir, e.name), name, depth - 1); if (r) return r; }
  }
  return null;
}

function findCtranslateModelDir(modelsDir) {
  if (!fs.existsSync(modelsDir)) return null;
  const pref = path.join(modelsDir, 'PhoWhisper-small-ct2');
  if (fs.existsSync(path.join(pref, 'model.bin'))) return pref;
  for (const e of fs.readdirSync(modelsDir, { withFileTypes: true })) {
    if (e.isDirectory() && fs.existsSync(path.join(modelsDir, e.name, 'model.bin'))) {
      return path.join(modelsDir, e.name);
    }
  }
  return null;
}

function findPythonFw(dir) {
  const py = findFile(dir, 'python.exe', 2);
  if (!py) return null;
  const fwPkg = path.join(path.dirname(py), 'Lib', 'site-packages', 'faster_whisper');
  return fs.existsSync(fwPkg) ? py : null;
}

/** Trạng thái công cụ đã tải trong %APPDATA%\AutoSubTypo. */
function status() {
  const d = toolsDir();
  return {
    dir: d,
    whisper: findPythonFw(path.join(d, 'faster-whisper')),
    ffmpeg: findFile(path.join(d, 'ffmpeg'), 'ffmpeg.exe', 3),
    model: findCtranslateModelDir(path.join(d, 'models'))
  };
}

/** Tải có theo redirect + tải tiếp phần dở (.part) nếu bị ngắt giữa chừng. */
function download(url, dest, onProgress, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    const part = dest + '.part';
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const headers = { 'User-Agent': 'AutoSubTypo' };
    if (have > 0) headers.Range = `bytes=${have}-`;
    const req = https.get(url, { headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects > 8) return reject(new Error('Quá nhiều chuyển hướng: ' + url));
        const next = new URL(res.headers.location, url).toString();
        return resolve(download(next, dest, onProgress, redirects + 1));
      }
      if (res.statusCode === 416) { res.resume(); fs.renameSync(part, dest); return resolve(dest); } // đã tải đủ
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return reject(new Error(`Tải lỗi HTTP ${res.statusCode}: ${url}`)); }
      const resumed = res.statusCode === 206;
      const total = (resumed ? have : 0) + parseInt(res.headers['content-length'] || '0', 10);
      let got = resumed ? have : 0;
      const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
      res.on('data', (c) => { got += c.length; if (onProgress && total) onProgress(got / total, got, total); });
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        if (total && got < total) return reject(new Error('Mất kết nối khi đang tải — bấm tải lại để tải tiếp.'));
        fs.renameSync(part, dest);
        resolve(dest);
      }));
      res.on('error', reject);
      out.on('error', reject);
    });
    req.on('error', (e) => reject(new Error('Không kết nối được: ' + e.message)));
    req.setTimeout(60000, () => req.destroy(new Error('Hết thời gian chờ mạng')));
  });
}

function unzip(zip, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const cmd = `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error('Giải nén lỗi: ' + err.slice(-300))));
    p.on('error', reject);
  });
}

/**
 * Tải + cài đủ công cụ faster-whisper còn thiếu.
 * @param {{model?:string, needWhisper?:boolean, needFfmpeg?:boolean, needModel?:boolean, onStep?:(label:string)=>void, onProgress?:(p:number,label:string)=>void}} o
 */
async function install(o) {
  if (process.platform !== 'win32') throw new Error('Bộ tự tải hiện chỉ hỗ trợ Windows.');
  o = o || {};
  const d = toolsDir();
  const dl = path.join(d, 'downloads');
  fs.mkdirSync(dl, { recursive: true });
  const st = status();
  const needW = o.needWhisper !== undefined ? o.needWhisper : !st.whisper;
  const needF = o.needFfmpeg !== undefined ? o.needFfmpeg : !st.ffmpeg;
  const needM = o.needModel !== undefined ? o.needModel : !st.model;

  const jobs = [];
  if (needW) jobs.push({ key: 'faster-whisper', destDir: path.join(d, 'faster-whisper'), src: SOURCES.fasterWhisper, label: 'faster-whisper runtime (CPU INT8)' });
  if (needF) jobs.push({ key: 'ffmpeg', destDir: path.join(d, 'ffmpeg'), src: SOURCES.ffmpeg, label: 'ffmpeg' });
  const m = MODELS[o.model] || MODELS['phowhisper-small-ct2'];
  if (needM) jobs.push({ key: 'model', destDir: path.join(d, 'models', m.dir), src: { url: m.url, mb: m.mb }, label: m.label });

  const totalMb = jobs.reduce((n, j) => n + j.src.mb, 0) || 1;
  let doneMb = 0;
  for (const j of jobs) {
    const target = path.join(dl, j.key + '.zip');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (o.onStep) o.onStep(`Đang tải ${j.label}…`);
    await download(j.src.url, target, (p, got, total) => {
      if (o.onProgress) o.onProgress((doneMb + p * j.src.mb) / totalMb, `Đang tải ${j.label}: ${Math.round(got / 1048576)}/${Math.round(total / 1048576)} MB`);
    });
    if (o.onStep) o.onStep(`Đang giải nén ${j.label}…`);
    await unzip(target, j.destDir);
    try { fs.unlinkSync(target); } catch (e) {}
    doneMb += j.src.mb;
  }
  const after = status();
  if ((needW && !after.whisper) || (needF && !after.ffmpeg) || (needM && !after.model)) {
    throw new Error('Cài chưa đủ công cụ — thử bấm tải lại.');
  }
  return Object.assign(after, { gpu: false });
}

module.exports = { toolsDir, status, install, hasNvidia, download, unzip, MODELS, SOURCES, MODEL_URL };
