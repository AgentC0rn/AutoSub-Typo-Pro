/* Gọi faster-whisper (PhoWhisper-small-ct2, CPU int8, vad_filter=True) để lấy mốc thời gian TỪNG TỪ. (Node) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./audio.js');

const FW_SCRIPT = path.join(__dirname, 'fw_transcribe.py');
const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;
const UNIT_SUFFIX = /^[%‰°]+[,.;!?…]*$/u;
const NOISE = /^[\[(（].*[\])）]$/; // [Music], (cười), ...

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

/** Sửa nhẹ một số lỗi đồng âm hay gặp ở Whisper/PhoWhisper tiếng Việt (theo ngữ cảnh 2–3 từ). */
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

/** Chuẩn hoá danh sách từ thô thành mảng { text, start, end } tăng nghiêm ngặt, không chồng lấn. */
function finalizeWords(rawWords, opts) {
  const words = rawWords.map(({ text, start, end }) => ({ text, start, end }));
  for (let i = 1; i < words.length; i++) {
    if (words[i].start < words[i - 1].start + 0.04) {
      words[i].start = words[i - 1].start + 0.04;
      if (words[i].end < words[i].start + 0.06) words[i].end = words[i].start + 0.06;
    }
    if (words[i - 1].end > words[i].start) {
      words[i - 1].end = Math.max(words[i - 1].start + 0.04, words[i].start);
    }
  }
  if (!opts || opts.lang !== 'en') fixViHomophones(words);
  return words;
}

/** Chuyển JSON của faster-whisper (seg.words từ word_timestamps=True) thành danh sách từ khớp thời gian phát âm. */
function parseFasterWhisperJson(obj, opts) {
  const segs = (obj && obj.segments) || [];
  const rawWords = [];

  for (const seg of segs) {
    if (!seg) continue;
    const segStart = Number(seg.start) || 0;
    const segEnd = Number(seg.end) || segStart;
    const segDur = Math.max(0.05, segEnd - segStart);
    const segWords = Array.isArray(seg.words) ? seg.words : [];
    const segLogProb = typeof seg.avg_logprob === 'number' ? seg.avg_logprob : 0;

    // Lọc ảo giác ở các mẩu nhiễu siêu ngắn cuối đoạn (vd >12 từ/giây kèm logprob thấp)
    if (segDur <= 0.65 && segWords.length / segDur > 12 && segLogProb < -0.45) continue;

    if (segWords.length) {
      for (const w of segWords) {
        if (!w || typeof w.word !== 'string') continue;
        const raw = w.word.normalize('NFC');
        const t = raw.trim();
        if (!t || t.includes('\uFFFD') || NOISE.test(t)) continue;
        let from = Math.max(0, Number(w.start) || 0);
        let to = Math.max(from + 0.04, Number(w.end) || from + 0.08);
        const last = rawWords[rawWords.length - 1];
        if (last && PUNCT_ONLY.test(t)) { last.text += t; last.end = Math.max(last.end, to); continue; }
        if (last && UNIT_SUFFIX.test(t) && /\d$/.test(last.text)) { last.text += t; last.end = Math.max(last.end, to); continue; }
        if (last && !/^\s/.test(raw) && from - last.end < 0.18) {
          last.text += t;
          last.end = Math.max(last.end, to);
          continue;
        }
        rawWords.push({ text: t, start: from, end: to });
      }
    } else if (seg.text && !NOISE.test(seg.text.trim())) {
      const parts = seg.text.normalize('NFC').trim().split(/\s+/).filter(Boolean);
      const step = parts.length ? segDur / parts.length : 0.1;
      parts.forEach((p, idx) => {
        const s = segStart + idx * step;
        rawWords.push({ text: p, start: s, end: Math.max(s + 0.06, segStart + (idx + 1) * step) });
      });
    }
  }

  return finalizeWords(rawWords, opts);
}

/**
 * @param {{bin:string, model:string, wav:string, lang?:string, prompt?:string, onProgress?:(p:number)=>void}} o
 * @returns {Promise<Array<{text:string,start:number,end:number}>>} thời gian tính từ đầu file wav
 */
async function transcribe(o) {
  if (!o || !o.bin || !fs.existsSync(o.bin)) throw new Error('Không tìm thấy Python runtime cho faster-whisper.');
  if (!o.model || !fs.existsSync(o.model)) throw new Error('Không tìm thấy model PhoWhisper-small-ct2.');
  const cpus = (os.cpus() || []).length || 8;
  const threads = Math.max(4, Math.min(8, Math.floor(cpus / 2) || 4));
  const lang = o.lang || 'vi';
  const outJson = o.wav.replace(/\.wav$/i, '') + '.fw.json';
  const args = ['-u', FW_SCRIPT, '--model', o.model, '--wav', o.wav, '--out', outJson, '--lang', lang, '--threads', String(threads)];
  if (o.prompt) args.push('--prompt', o.prompt);

  const onStderr = (s) => {
    const m = s.match(/progress\s*=\s*(\d+)\s*%/g);
    if (m && o.onProgress) o.onProgress(Math.min(1, parseInt(m[m.length - 1].replace(/\D+/g, ''), 10) / 100));
  };

  try {
    await run(o.bin, args, { onStderr });
    if (!fs.existsSync(outJson)) throw new Error('faster-whisper không tạo được file kết quả JSON.');
    const json = JSON.parse(fs.readFileSync(outJson, 'utf8'));
    return parseFasterWhisperJson(json, { lang });
  } finally {
    try { if (fs.existsSync(outJson)) fs.unlinkSync(outJson); } catch (e) {}
  }
}

module.exports = { transcribe, parseFasterWhisperJson, fixViHomophones };
