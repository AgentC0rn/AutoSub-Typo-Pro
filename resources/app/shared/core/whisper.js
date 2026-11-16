/* Gọi whisper.cpp (đi kèm plugin) để lấy mốc thời gian TỪNG TỪ. (Node) */
'use strict';
const fs = require('fs');
const os = require('os');
const { run } = require('./audio.js');

const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;
const UNIT_SUFFIX = /^[%‰°]+[,.;!?…]*$/u;
const NOISE = /^[\[(（].*[\])）]$/;   // [Music], (cười), ...
const VI_DEFAULT_PROMPT = 'Xin chào quý khách. Đây là phụ đề tiếng Việt chuẩn chính tả, ngắt câu tự nhiên bằng dấu phẩy và dấu chấm.';

function normVi(s) {
  return String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
function matchCase(orig, target) {
  if (!orig) return target;
  if (orig === orig.toUpperCase() && orig !== orig.toLowerCase()) return target.toUpperCase();
  if (/^[\p{Lu}]/u.test(orig)) return target.charAt(0).toUpperCase() + target.slice(1);
  return target;
}
function swapKeepPunct(orig, replBase) {
  return String(orig).replace(/^([^\p{L}\p{N}]*)([\p{L}\p{N}]+)([^\p{L}\p{N}]*)$/u, (_, pre, core, post) => pre + matchCase(core, replBase) + post);
}

/** Sửa nhẹ một số lỗi đồng âm bất khả thi hay gặp ở Whisper tiếng Việt (theo ngữ cảnh 2–3 từ). */
function fixViHomophones(words) {
  for (let i = 0; i < words.length; i++) {
    const cur = normVi(words[i].text);
    const prev = i > 0 ? normVi(words[i - 1].text) : '';
    const next = i + 1 < words.length ? normVi(words[i + 1].text) : '';
    if (cur === 'inbook') {
      words[i].text = swapKeepPunct(words[i].text, 'inbox');
    } else if (cur === 'liều' && next === 'trình') {
      words[i].text = swapKeepPunct(words[i].text, 'liệu');
    } else if (cur === 'năng' && next === 'lông') {
      words[i].text = swapKeepPunct(words[i].text, 'nang');
    } else if (cur === 'mắt' && next === 'lạnh' && /^(siêu|cực|rất|hơi|băng|hàn|máy|cảm|tươi)$/.test(prev)) {
      words[i].text = swapKeepPunct(words[i].text, 'mát');
    } else if (cur === 'yêu' && (next === 'đãi' || next === 'đã') && /^nh[aâ]n$/.test(prev)) {
      words[i - 1].text = swapKeepPunct(words[i - 1].text, 'nhận');
      words[i].text = swapKeepPunct(words[i].text, 'ưu');
      if (next === 'đã' && (i + 2 < words.length && normVi(words[i + 2].text) === 'nha')) {
        words[i + 1].text = swapKeepPunct(words[i + 1].text, 'đãi');
      }
    } else if (cur === 'đã' && next === 'nha' && (prev === 'yêu' || prev === 'ưu')) {
      words[i].text = swapKeepPunct(words[i].text, 'đãi');
    }
  }
  return words;
}

/** Chuyển JSON của whisper.cpp (chạy với -ml 1 -sow) thành danh sách từ. */
function parseWhisperJson(obj, opts) {
  const segs = (obj && obj.transcription) || [];
  const words = [];
  for (const seg of segs) {
    const raw = (seg.text || '').normalize('NFC');
    const t = raw.trim();
    if (!t || NOISE.test(t)) continue;
    const from = seg.offsets.from / 1000;
    let to = seg.offsets.to / 1000;
    const last = words[words.length - 1];
    if (last && PUNCT_ONLY.test(t)) { last.text += t; last.end = Math.max(last.end, to); continue; }
    if (last && UNIT_SUFFIX.test(t) && /\d$/.test(last.text)) { last.text += t; last.end = Math.max(last.end, to); continue; }
    // Mảnh dính liền từ trước (không có dấu cách đầu) -> nối vào từ trước (vd: Bio+matic, 49+k).
    if (last && !/^\s/.test(raw) && from - last.end < 0.15) { last.text += t; last.end = Math.max(last.end, to); continue; }
    if (to <= from) to = from + 0.08;
    words.push({ text: t, start: from, end: to });
  }
  // Không để từ chồng thời gian lên nhau.
  for (let i = 1; i < words.length; i++) {
    if (words[i].start < words[i - 1].end) words[i - 1].end = Math.max(words[i - 1].start + 0.04, words[i].start);
  }
  if (!opts || (opts.lang || 'vi') === 'vi') fixViHomophones(words);
  return words;
}

/**
 * @param {{bin:string, model:string, wav:string, lang?:string, prompt?:string, onProgress?:(p:number)=>void}} o
 * @returns {Promise<Array<{text:string,start:number,end:number}>>} thời gian tính từ đầu file wav
 */
async function transcribe(o) {
  const base = o.wav.replace(/\.wav$/i, '');
  const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
  const lang = o.lang || 'vi';
  const args = ['-m', o.model, '-f', o.wav, '-l', lang, '-t', String(threads),
    '-ml', '1', '-sow', '-sns', '-oj', '-of', base, '-pp'];
  const prompt = o.prompt || (lang === 'vi' ? VI_DEFAULT_PROMPT : '');
  if (prompt) args.push('--prompt', prompt);
  await run(o.bin, args, {
    onStderr: (s) => {
      const m = s.match(/progress\s*=\s*(\d+)\s*%/g);
      if (m && o.onProgress) o.onProgress(parseInt(m[m.length - 1].replace(/\D+/g, ''), 10) / 100);
    }
  });
  const json = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  return parseWhisperJson(json, { lang });
}

module.exports = { transcribe, parseWhisperJson, fixViHomophones };
