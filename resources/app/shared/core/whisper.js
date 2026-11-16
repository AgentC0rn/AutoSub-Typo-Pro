/* Gọi whisper.cpp (đi kèm plugin) để lấy mốc thời gian TỪNG TỪ. (Node) */
'use strict';
const fs = require('fs');
const os = require('os');
const { run } = require('./audio.js');

const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;
const NOISE = /^[\[(（].*[\])）]$/;   // [Music], (cười), ...

/** Chuyển JSON của whisper.cpp (chạy với -ml 1 -sow) thành danh sách từ. */
function parseWhisperJson(obj) {
  const segs = (obj && obj.transcription) || [];
  const words = [];
  for (const seg of segs) {
    const raw = seg.text || '';
    const t = raw.trim();
    if (!t || NOISE.test(t)) continue;
    const from = seg.offsets.from / 1000;
    let to = seg.offsets.to / 1000;
    const last = words[words.length - 1];
    if (last && PUNCT_ONLY.test(t)) { last.text += t; last.end = Math.max(last.end, to); continue; }
    // Mảnh dính liền từ trước (không có dấu cách đầu) -> nối vào từ trước.
    if (last && !/^\s/.test(raw) && from - last.end < 0.05) { last.text += t; last.end = Math.max(last.end, to); continue; }
    if (to <= from) to = from + 0.08;
    words.push({ text: t, start: from, end: to });
  }
  // Không để từ chồng thời gian lên nhau.
  for (let i = 1; i < words.length; i++) {
    if (words[i].start < words[i - 1].end) words[i - 1].end = Math.max(words[i - 1].start + 0.04, words[i].start);
  }
  return words;
}

/**
 * @param {{bin:string, model:string, wav:string, lang?:string, onProgress?:(p:number)=>void}} o
 * @returns {Promise<Array<{text:string,start:number,end:number}>>} thời gian tính từ đầu file wav
 */
async function transcribe(o) {
  const base = o.wav.replace(/\.wav$/i, '');
  const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
  const args = ['-m', o.model, '-f', o.wav, '-l', o.lang || 'vi', '-t', String(threads),
    '-ml', '1', '-sow', '-oj', '-of', base, '-pp'];
  await run(o.bin, args, {
    onStderr: (s) => {
      const m = s.match(/progress\s*=\s*(\d+)\s*%/g);
      if (m && o.onProgress) o.onProgress(parseInt(m[m.length - 1].replace(/\D+/g, ''), 10) / 100);
    }
  });
  const json = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  return parseWhisperJson(json);
}

module.exports = { transcribe, parseWhisperJson };
