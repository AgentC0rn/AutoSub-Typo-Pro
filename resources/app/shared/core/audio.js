/* Tìm công cụ đi kèm, giải mã & trộn Âm thanh tổng toàn timeline thành WAV 16kHz mono, đo độ to từng từ. (Node) */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

function onPath(name) {
  const r = spawnSync(IS_WIN ? 'where' : 'which', [name], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return null;
  const first = r.stdout.split(/\r?\n/).find(Boolean);
  return first && fs.existsSync(first) ? first : null;
}

/** Ưu tiên file đi kèm trong <plugin>/bin, sau đó mới tìm trên PATH. */
function findTool(extRoot, baseNames) {
  for (const b of baseNames) {
    const f = path.join(extRoot, 'bin', IS_WIN ? b + '.exe' : b);
    if (fs.existsSync(f)) return f;
  }
  for (const b of baseNames) {
    const f = onPath(IS_WIN ? b + '.exe' : b);
    if (f) return f;
  }
  return null;
}

/** Thứ tự tìm: <plugin>/tools hoặc <plugin>/bin -> %APPDATA%\AutoSubTypo (bộ tự tải) -> PATH. */
function findTools(extRoot) {
  const st = require('./setup.js').status();
  const localPy = [
    path.join(extRoot, 'tools', 'faster-whisper', 'python.exe'),
    path.join(extRoot, 'faster-whisper', 'python.exe'),
    path.join(extRoot, 'bin', 'faster-whisper', 'python.exe')
  ].find((p) => fs.existsSync(p)) || null;
  const local = (names) => {
    for (const b of names) {
      for (const sub of ['bin', 'tools/ffmpeg', 'ffmpeg']) {
        const f = path.join(extRoot, sub, IS_WIN ? b + '.exe' : b);
        if (fs.existsSync(f)) return f;
      }
    }
    return null;
  };
  const fromPath = (names) => { for (const b of names) { const f = onPath(IS_WIN ? b + '.exe' : b); if (f) return f; } return null; };
  const F = ['ffmpeg'];
  return {
    ffmpeg: local(F) || st.ffmpeg || fromPath(F),
    whisper: localPy || st.whisper || fromPath(['python', 'python3'])
  };
}

/** Model CT2: ưu tiên PhoWhisper-small-ct2 trong <plugin>/models hoặc <plugin>/tools/models rồi %APPDATA%\AutoSubTypo\models. */
function findModel(extRoot) {
  const dirs = [
    path.join(extRoot, 'models'),
    path.join(extRoot, 'tools', 'models'),
    path.join(require('./setup.js').toolsDir(), 'models')
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const pref = path.join(dir, 'PhoWhisper-small-ct2');
    if (fs.existsSync(path.join(pref, 'model.bin'))) return pref;
    const sub = fs.readdirSync(dir, { withFileTypes: true })
      .find((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'model.bin')));
    if (sub) return path.join(dir, sub.name);
  }
  return null;
}

function run(cmd, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { const s = d.toString(); err += s; if (err.length > 20000) err = err.slice(-20000); if (onStderr) onStderr(s); });
    p.stdout.on('data', () => {});
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(err) : reject(new Error(path.basename(cmd) + ' lỗi (' + code + '): ' + err.slice(-600))));
  });
}

/** Cắt đoạn [inSec, inSec+durSec] của file nguồn thành WAV 16kHz mono PCM16. */
function extractWav(ffmpeg, src, inSec, durSec, outWav) {
  const args = ['-y', '-v', 'error', '-ss', String(Math.max(0, inSec))];
  if (durSec > 0) args.push('-t', String(durSec));
  args.push('-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav);
  return run(ffmpeg, args);
}

/** Giải mã toàn bộ 1 file nguồn thành WAV 16kHz mono PCM16 (dùng 1 lần cho nhiều đoạn cắt). */
function decodeFullWav(ffmpeg, src, outWav) {
  const args = ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav];
  return run(ffmpeg, args);
}

/** Đọc WAV PCM16 -> { sampleRate, samples: Int16Array } (mono). */
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Không phải WAV: ' + file);
  let off = 12, sampleRate = 16000, channels = 1, bits = 16, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
      break;
    }
    off = body + size + (size % 2);
  }
  if (!data) throw new Error('WAV không có dữ liệu');
  if (bits !== 16 || channels !== 1) throw new Error('Cần WAV mono 16-bit');
  const n = Math.floor(data.length / 2);
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = data.readInt16LE(i * 2);
  return { sampleRate, samples };
}

/** Ghi Int16Array thành file WAV PCM16 mono chuẩn RIFF. */
function writeWav(filePath, int16Samples, sampleRate = 16000) {
  const dataLen = int16Samples.length * 2;
  const buf = Buffer.allocUnsafe(44 + dataLen);
  buf.write('RIFF', 0, 4, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 4, 'ascii');
  buf.write('fmt ', 12, 4, 'ascii');
  buf.writeUInt32LE(16, 16);             // PCM chunk size
  buf.writeUInt16LE(1, 20);              // Audio format = 1 (PCM)
  buf.writeUInt16LE(1, 22);              // Channels = 1 (mono)
  buf.writeUInt32LE(sampleRate, 24);     // Sample rate
  buf.writeUInt32LE(sampleRate * 2, 28); // Byte rate
  buf.writeUInt16LE(2, 32);              // Block align
  buf.writeUInt16LE(16, 34);             // Bits per sample
  buf.write('data', 36, 4, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  const srcBytes = Buffer.from(int16Samples.buffer, int16Samples.byteOffset, dataLen);
  srcBytes.copy(buf, 44);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

/** Khử trùng lặp segment khi nhân đôi clip tách nền (PiP) trên nhiều track khác nhau. */
function deduplicateAudioSegments(segments) {
  const sorted = (segments || []).slice().sort((a, b) => (a.start - b.start) || ((a.trackIndex || 0) - (b.trackIndex || 0)));
  const kept = [];
  for (const s of sorted) {
    if (!s || !s.path) continue;
    const normPath = path.resolve(s.path).toLowerCase();
    const isDup = kept.some((prev) =>
      prev._normPath === normPath &&
      Math.abs(prev.start - s.start) < 0.025 &&
      Math.abs((prev.sourceStart || 0) - (s.sourceStart || 0)) < 0.025
    );
    if (!isDup) {
      kept.push(Object.assign({ _normPath: normPath }, s));
    }
  }
  return kept;
}

/**
 * Tổng hợp Âm thanh tổng (Master Timeline Audio Mixdown):
 * - Giải mã mỗi file nguồn duy nhất 1 lần sang 16kHz mono PCM.
 * - Trộn tất cả các segment được chọn vào 1 mảng Float32Array theo đúng timestamp timeline.
 * - Xuất ra 1 file master_16k.wav duy nhất cho Whisper + Preview.
 */
async function buildMasterWav(ffmpeg, segments, projectDurationSec, outWav, onProgress) {
  const SR = 16000;
  const FADE = 80; // 5ms micro-fade tại mỗi điểm cắt
  const dedupedAll = deduplicateAudioSegments(segments);
  const missingFiles = [];
  const validSegs = [];

  for (const s of dedupedAll) {
    if (fs.existsSync(s.path)) validSegs.push(s);
    else if (!missingFiles.includes(s.path)) missingFiles.push(s.path);
  }
  if (!validSegs.length) {
    throw new Error(missingFiles.length ? `Không tìm thấy file âm thanh: ${missingFiles[0]}` : 'Không có đoạn âm thanh hợp lệ nào được chọn.');
  }

  const maxSegEnd = Math.max(1, ...validSegs.map((s) => s.start + s.duration));
  const durSec = Math.max(projectDurationSec || 0, maxSegEnd);
  const totalSamples = Math.max(SR, Math.ceil(durSec * SR));

  const uniquePaths = [];
  const pathToKey = new Map();
  for (const s of validSegs) {
    const key = path.resolve(s.path).toLowerCase();
    if (!pathToKey.has(key)) {
      pathToKey.set(key, uniquePaths.length);
      uniquePaths.push(s.path);
    }
  }

  const tmpDir = path.dirname(outWav);
  const decodedCache = new Map();
  const tempFiles = [];

  try {
    for (let u = 0; u < uniquePaths.length; u++) {
      const srcPath = uniquePaths[u];
      const key = path.resolve(srcPath).toLowerCase();
      if (onProgress) onProgress(u / (uniquePaths.length + 1), `Giải mã nguồn ${u + 1}/${uniquePaths.length}: ${path.basename(srcPath)}…`);
      const tmpWav = path.join(tmpDir, `_src_${u}.wav`);
      tempFiles.push(tmpWav);
      await decodeFullWav(ffmpeg, srcPath, tmpWav);
      decodedCache.set(key, readWav(tmpWav).samples);
    }

    if (onProgress) onProgress(uniquePaths.length / (uniquePaths.length + 1), `Đang trộn ${validSegs.length} đoạn vào Âm thanh tổng…`);

    const mix = new Float32Array(totalSamples);
    for (const seg of validSegs) {
      const key = path.resolve(seg.path).toLowerCase();
      const srcSamples = decodedCache.get(key);
      if (!srcSamples || !srcSamples.length) continue;

      const dstStart = Math.max(0, Math.floor(seg.start * SR));
      const rawLen = Math.floor(seg.duration * SR);
      const segLen = Math.min(rawLen, totalSamples - dstStart);
      if (segLen <= 0) continue;

      const gain = Math.min(1.8, Math.max(0.25, typeof seg.volume === 'number' ? seg.volume : 1.0));
      const spd = seg.speed && seg.speed > 0 ? seg.speed : 1.0;
      const srcBaseSec = seg.sourceStart || 0;
      const fadeLen = Math.min(FADE, Math.floor(segLen / 4));

      for (let i = 0; i < segLen; i++) {
        const srcIdx = Math.floor((srcBaseSec + (i / SR) * spd) * SR);
        if (srcIdx < 0 || srcIdx >= srcSamples.length) continue;
        let env = 1.0;
        if (fadeLen > 0) {
          if (i < fadeLen) env = i / fadeLen;
          else if (i >= segLen - fadeLen) env = (segLen - 1 - i) / fadeLen;
        }
        mix[dstStart + i] += (srcSamples[srcIdx] / 32768) * gain * env;
      }
    }

    // Chuẩn hoá biên độ an toàn (tránh clipping hoặc quá nhỏ)
    let maxAbs = 0;
    for (let i = 0; i < mix.length; i++) {
      const a = Math.abs(mix[i]);
      if (a > maxAbs) maxAbs = a;
    }
    let normScale = 1.0;
    if (maxAbs > 0.98) normScale = 0.95 / maxAbs;
    else if (maxAbs > 0.005 && maxAbs < 0.25) normScale = Math.min(3.5, 0.7 / maxAbs);

    const outInt16 = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      const v = Math.max(-1, Math.min(1, mix[i] * normScale));
      outInt16[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
    }

    writeWav(outWav, outInt16, SR);

    return {
      wavPath: outWav,
      wavData: { sampleRate: SR, samples: outInt16 },
      stats: {
        totalSegments: (segments || []).length,
        mixedSegments: validSegs.length,
        duplicateRemoved: (segments || []).length - dedupedAll.length,
        uniqueFiles: uniquePaths.length,
        missingFiles,
        durationSec: totalSamples / SR
      }
    };
  } finally {
    for (const tf of tempFiles) {
      try { if (fs.existsSync(tf)) fs.unlinkSync(tf); } catch (e) {}
    }
  }
}

/**
 * Căn chỉnh mốc thời gian đầu/cuối của từng từ bám theo năng lượng sóng âm thực tế trong file WAV 16kHz:
 * - Bắt chính xác điểm bắt đầu bật âm sau khoảng lặng/thở (chống hiện chữ sớm hoặc muộn).
 * - Cắt gọn phần im lặng kéo dài sau từ cuối cụm (chống giữ chữ trễ làm đẩy cụm kế tiếp).
 */
function alignWordsToAudio(words, wav) {
  if (!Array.isArray(words) || !words.length || !wav || !wav.samples || !wav.samples.length) return words;
  const { sampleRate, samples } = wav;
  const stepSec = 0.01;
  const step = Math.max(1, Math.round(sampleRate * stepSec));
  const win = Math.max(step, Math.round(sampleRate * 0.02));
  const nFrames = Math.floor(Math.max(0, samples.length - win) / step) + 1;
  if (nFrames < 5) return words;

  const env = new Float32Array(nFrames);
  const nonZero = [];
  for (let f = 0; f < nFrames; f++) {
    const a = f * step, b = Math.min(samples.length, a + win);
    let sum = 0;
    for (let i = a; i < b; i++) { const v = samples[i] / 32768; sum += v * v; }
    const r = Math.sqrt(sum / Math.max(1, b - a));
    env[f] = r;
    if (r > 0.0005) nonZero.push(r);
  }
  if (!nonZero.length) return words;
  nonZero.sort((a, b) => a - b);
  const p15 = nonZero[Math.floor(nonZero.length * 0.15)] || 0.001;
  const p85 = nonZero[Math.floor(nonZero.length * 0.85)] || 0.05;
  const speechThr = Math.max(0.006, Math.min(p85 * 0.22, p15 * 3.5 + 0.008));

  const toFrame = (t) => Math.max(0, Math.min(nFrames - 1, Math.round(t / stepSec)));
  const minSilentBefore = (f) => {
    let cnt = 0;
    for (let k = Math.max(0, f - 5); k <= Math.min(nFrames - 1, f + 1); k++) if (env[k] < speechThr) cnt++;
    return cnt >= 4;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const next = words[i + 1];
    const fStart = toFrame(w.start);

    // 1. Bám onset phát âm sau khoảng lặng hoặc khi đầu từ đang nằm trong vùng im lặng
    if (env[fStart] < speechThr || minSilentBefore(fStart)) {
      const minT = prev ? prev.start + 0.06 : 0;
      const maxT = next ? Math.min(next.start - 0.04, w.start + 0.24) : w.start + 0.24;
      const lo = toFrame(Math.max(minT, w.start - 0.16));
      const hi = toFrame(maxT);
      let activeFrom = -1;
      for (let f = lo; f <= hi; f++) {
        if (env[f] >= speechThr && (f + 1 > hi || env[f + 1] >= speechThr * 0.7)) {
          activeFrom = f;
          break;
        }
      }
      if (activeFrom >= 0) {
        const snapped = Math.max(minT, activeFrom * stepSec - 0.02);
        w.start = snapped;
        if (w.end < w.start + 0.08) w.end = w.start + 0.08;
      }
    }

    // 2. Cắt gọn khoảng lặng dư ở đuôi từ (đặc biệt trước khoảng nghỉ hoặc câu mới)
    const fEnd = toFrame(w.end);
    const fMinEnd = toFrame(w.start + 0.07);
    if (fEnd > fMinEnd + 2 && env[fEnd] < speechThr * 0.85) {
      let lastAct = -1;
      for (let f = fEnd; f >= fMinEnd; f--) {
        if (env[f] >= speechThr * 0.8) { lastAct = f; break; }
      }
      if (lastAct >= 0) {
        w.end = Math.max(w.start + 0.08, Math.min(w.end, lastAct * stepSec + 0.05));
      }
    }
  }

  for (let i = 1; i < words.length; i++) {
    if (words[i].start < words[i - 1].start + 0.04) words[i].start = words[i - 1].start + 0.04;
    if (words[i - 1].end > words[i].start) words[i - 1].end = Math.max(words[i - 1].start + 0.04, words[i].start);
    if (words[i].end < words[i].start + 0.05) words[i].end = words[i].start + 0.05;
  }
  return words;
}

/** Gắn độ to (dBFS RMS) cho từng từ. Thời gian của từ tính theo đầu file WAV. */
function addLoudness(words, wav) {
  const { sampleRate, samples } = wav;
  for (const w of words) {
    const a = Math.max(0, Math.floor(w.start * sampleRate));
    const b = Math.min(samples.length, Math.ceil(w.end * sampleRate));
    if (b <= a) { w.rms = -90; continue; }
    let sum = 0;
    for (let i = a; i < b; i++) { const v = samples[i] / 32768; sum += v * v; }
    w.rms = 10 * Math.log10(sum / (b - a) + 1e-9);
  }
  return words;
}

module.exports = {
  findTools,
  findTool,
  findModel,
  extractWav,
  decodeFullWav,
  readWav,
  writeWav,
  deduplicateAudioSegments,
  buildMasterWav,
  alignWordsToAudio,
  addLoudness,
  run
};
