/* Gọi whisper.cpp (đi kèm plugin) để lấy mốc thời gian TỪNG TỪ. (Node) */
'use strict';
const fs = require('fs');
const os = require('os');
const { run } = require('./audio.js');

const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;
const SPECIAL_TOK = /^\[_.*\]$/;
const UNIT_SUFFIX = /^[%‰°]+[,.;!?…]*$/u;
const NOISE = /^[\[(（].*[\])）]$/;   // [Music], (cười), ...
const VI_DEFAULT_PROMPT = 'Xin chào quý khách. Đây là phụ đề tiếng Việt chuẩn chính tả, ngắt câu tự nhiên bằng dấu phẩy và dấu chấm.';
const DTW_ONSET_SHIFT = 0.075; // t_dtw thường rơi giữa âm tiết (~75ms sau điểm bắt đầu phát âm)
const DTW_TAIL_PAD = 0.11;     // đệm đuôi âm tiết sau token t_dtw cuối cùng

/** Chọn preset DTW phù hợp với model whisper.cpp đang dùng (khớp tham số -dtw của whisper-cli). */
function dtwPresetForModel(modelPath) {
  const b = (modelPath || '').toLowerCase();
  if (/large[-_. ]*v3[-_. ]*turbo|turbo/.test(b)) return 'large.v3.turbo';
  if (/large[-_. ]*v3/.test(b)) return 'large.v3';
  if (/large[-_. ]*v2/.test(b)) return 'large.v2';
  if (/large[-_. ]*v1|ggml-large(?:-q\d.*)?\.bin/.test(b)) return 'large.v1';
  if (/medium\.en/.test(b)) return 'medium.en';
  if (/medium/.test(b)) return 'medium';
  if (/small\.en/.test(b)) return 'small.en';
  if (/small/.test(b)) return 'small';
  if (/base\.en/.test(b)) return 'base.en';
  if (/base/.test(b)) return 'base';
  if (/tiny\.en/.test(b)) return 'tiny.en';
  if (/tiny/.test(b)) return 'tiny';
  return '';
}

function segDtwTimes(seg) {
  const toks = (seg && seg.tokens) || [];
  const all = [];
  const letters = [];
  for (const tk of toks) {
    if (!tk || typeof tk.t_dtw !== 'number' || tk.t_dtw <= 0) continue;
    const txt = String(tk.text || '').trim();
    if (!txt || SPECIAL_TOK.test(txt)) continue;
    const tSec = tk.t_dtw / 100;
    all.push(tSec);
    if (!PUNCT_ONLY.test(txt)) letters.push(tSec);
  }
  return letters.length ? letters : all;
}

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

/** Chuyển JSON của whisper.cpp (-ojf kèm -dtw, hoặc -oj) thành danh sách từ khớp thời gian phát âm. */
function parseWhisperJson(obj, opts) {
  const segs = (obj && obj.transcription) || [];
  const rawWords = [];
  for (const seg of segs) {
    const raw = (seg.text || '').normalize('NFC');
    const t = raw.trim();
    if (!t || NOISE.test(t)) continue;
    const offFrom = seg.offsets.from / 1000;
    const offTo = seg.offsets.to / 1000;
    const dtws = segDtwTimes(seg);
    let from = offFrom;
    let to = offTo;
    if (dtws.length) {
      const df = dtws[0];
      const dl = dtws[dtws.length - 1];
      // Chỉ dùng DTW khi nằm trong vùng hợp lý quanh đoạn (tránh outlier cá biệt)
      if (Math.abs(df - offFrom) < 1.2 && Math.abs(dl - offTo) < 1.2) {
        from = Math.max(0, df - DTW_ONSET_SHIFT);
        to = Math.max(from + 0.08, dl + DTW_TAIL_PAD);
      }
    }
    const last = rawWords[rawWords.length - 1];
    if (last && PUNCT_ONLY.test(t)) { last.text += t; last.end = Math.max(last.end, to); continue; }
    if (last && UNIT_SUFFIX.test(t) && /\d$/.test(last.text)) { last.text += t; last.end = Math.max(last.end, to); continue; }
    // Mảnh dính liền từ trước (không có dấu cách đầu) -> nối vào từ trước (vd: Bio+matic, 49+k).
    if (last && !/^\s/.test(raw) && Math.abs(offFrom - last.offEnd) < 0.15 && from - last.end < 0.22) {
      last.text += t;
      last.end = Math.max(last.end, to);
      last.offEnd = Math.max(last.offEnd, offTo);
      continue;
    }
    if (to <= from) to = from + 0.08;
    rawWords.push({ text: t, start: from, end: to, offEnd: offTo });
  }
  const words = rawWords.map(({ text, start, end }) => ({ text, start, end }));
  // Giữ thứ tự tăng nghiêm ngặt & tránh từ bị nén về 0ms khi 2 token sát nhau.
  for (let i = 1; i < words.length; i++) {
    if (words[i].start < words[i - 1].start + 0.04) {
      words[i].start = words[i - 1].start + 0.04;
      if (words[i].end < words[i].start + 0.06) words[i].end = words[i].start + 0.06;
    }
    if (words[i - 1].end > words[i].start) {
      words[i - 1].end = Math.max(words[i - 1].start + 0.04, words[i].start);
    }
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
  const prompt = o.prompt || (lang === 'vi' ? VI_DEFAULT_PROMPT : '');
  const dtw = dtwPresetForModel(o.model);
  const baseArgs = ['-m', o.model, '-f', o.wav, '-l', lang, '-t', String(threads),
    '-ml', '1', '-sow', '-sns', '-of', base, '-pp'];
  if (prompt) baseArgs.push('--prompt', prompt);

  const onStderr = (s) => {
    const m = s.match(/progress\s*=\s*(\d+)\s*%/g);
    if (m && o.onProgress) o.onProgress(parseInt(m[m.length - 1].replace(/\D+/g, ''), 10) / 100);
  };

  if (dtw) {
    try {
      await run(o.bin, baseArgs.concat(['-nfa', '-dtw', dtw, '-ojf']), { onStderr });
      const json = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
      return parseWhisperJson(json, { lang });
    } catch (e) {
      // Dự phòng nếu bản model/binary không nhận preset DTW
    }
  }
  await run(o.bin, baseArgs.concat(['-oj']), { onStderr });
  const json = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  return parseWhisperJson(json, { lang });
}

module.exports = { transcribe, parseWhisperJson, fixViHomophones, dtwPresetForModel };
