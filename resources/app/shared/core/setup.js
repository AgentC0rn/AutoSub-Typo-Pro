/*
 * Tự tải công cụ nhận dạng giọng nói lần đầu chạy (Windows):
 *   - whisper.cpp (bản CUDA nếu có card NVIDIA, ngược lại bản CPU)
 *   - ffmpeg (bản LGPL, được phép phân phối kèm sản phẩm thương mại)
 *   - model whisper
 * Lưu tại %APPDATA%\AutoSubTypo -> cập nhật/cài lại plugin không phải tải lại. (Node)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync, spawn } = require('child_process');

const WHISPER_TAG = 'b5454';
const SOURCES = {
  whisperCuda: { url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-win-cuda-11.8.0-x64.zip`, mb: 272 },
  whisperCpu: { url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`, mb: 9 },
  ffmpeg: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip', mb: 73 }
};
const MODELS = {
  fast: { file: 'ggml-large-v3-turbo-q5_0.bin', mb: 547, label: 'Nhanh (large-v3-turbo, 547 MB)' },
  best: { file: 'ggml-large-v3.bin', mb: 2952, label: 'Chính xác nhất (large-v3, 3 GB)' }
};
const MODEL_URL = (f) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${f}`;

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

/** Trạng thái công cụ đã tải trong %APPDATA%\AutoSubTypo. */
function status() {
  const d = toolsDir();
  const modelsDir = path.join(d, 'models');
  const models = fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir).filter((f) => /^ggml-.*\.bin$/i.test(f)) : [];
  return {
    dir: d,
    whisper: findFile(path.join(d, 'whisper'), 'whisper-cli.exe', 3),
    ffmpeg: findFile(path.join(d, 'ffmpeg'), 'ffmpeg.exe', 3),
    model: models.length ? path.join(modelsDir, models[0]) : null
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
 * Tải + cài đủ công cụ còn thiếu.
 * @param {{model?:'fast'|'best', gpu?:boolean, onStep?:(label:string)=>void, onProgress?:(p:number,label:string)=>void}} o
 */
async function install(o) {
  if (process.platform !== 'win32') throw new Error('Bộ tự tải hiện chỉ hỗ trợ Windows.');
  o = o || {};
  const d = toolsDir();
  const dl = path.join(d, 'downloads');
  fs.mkdirSync(dl, { recursive: true });
  const st = status();
  const gpu = o.gpu === undefined ? !!hasNvidia() : o.gpu;
  const jobs = [];
  if (!st.whisper) jobs.push({ key: 'whisper', src: gpu ? SOURCES.whisperCuda : SOURCES.whisperCpu, label: gpu ? 'whisper.cpp (GPU NVIDIA)' : 'whisper.cpp (CPU)', zip: true });
  if (!st.ffmpeg) jobs.push({ key: 'ffmpeg', src: SOURCES.ffmpeg, label: 'ffmpeg', zip: true });
  const m = MODELS[o.model || 'fast'];
  if (!st.model) jobs.push({ key: 'models', src: { url: MODEL_URL(m.file), mb: m.mb }, label: 'model ' + m.file, zip: false, file: m.file });

  const totalMb = jobs.reduce((n, j) => n + j.src.mb, 0) || 1;
  let doneMb = 0;
  for (const j of jobs) {
    const name = j.zip ? j.key + '.zip' : j.file;
    const target = j.zip ? path.join(dl, name) : path.join(d, 'models', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (o.onStep) o.onStep(`Đang tải ${j.label}…`);
    await download(j.src.url, target, (p, got, total) => {
      if (o.onProgress) o.onProgress((doneMb + p * j.src.mb) / totalMb, `Đang tải ${j.label}: ${Math.round(got / 1048576)}/${Math.round(total / 1048576)} MB`);
    });
    if (j.zip) {
      if (o.onStep) o.onStep(`Đang giải nén ${j.label}…`);
      await unzip(target, path.join(d, j.key));
      try { fs.unlinkSync(target); } catch (e) {}
    }
    doneMb += j.src.mb;
  }
  const after = status();
  if (!after.whisper || !after.ffmpeg || !after.model) throw new Error('Cài chưa đủ công cụ — thử bấm tải lại.');
  return Object.assign(after, { gpu });
}

module.exports = { toolsDir, status, install, hasNvidia, download, unzip, MODELS, SOURCES, MODEL_URL };
