/* Đọc số đo font TrueType/OpenType (không cần thư viện): bề ngang chữ, ascender/descender. (Node) */
'use strict';
const fs = require('fs');

const cache = {};

function parse(file) {
  if (cache[file]) return cache[file];
  const b = fs.readFileSync(file);
  const n = b.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[b.toString('ascii', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) };
  }
  const need = (t) => { if (!tables[t]) throw new Error(`Font thiếu bảng ${t}: ${file}`); return tables[t].off; };

  const head = need('head');
  const unitsPerEm = b.readUInt16BE(head + 18);
  const hhea = need('hhea');
  const ascender = b.readInt16BE(hhea + 4);
  const descender = b.readInt16BE(hhea + 6);
  const numHMetrics = b.readUInt16BE(hhea + 34);
  const hmtx = need('hmtx');
  const advances = new Array(numHMetrics);
  for (let i = 0; i < numHMetrics; i++) advances[i] = b.readUInt16BE(hmtx + i * 4);

  // cmap: ưu tiên format 12 (Unicode đầy đủ), rồi format 4.
  const cmapOff = need('cmap');
  const nSub = b.readUInt16BE(cmapOff + 2);
  let sub12 = null, sub4 = null;
  for (let i = 0; i < nSub; i++) {
    const r = cmapOff + 4 + i * 8;
    const pid = b.readUInt16BE(r), eid = b.readUInt16BE(r + 2), so = cmapOff + b.readUInt32BE(r + 4);
    const fmt = b.readUInt16BE(so);
    if (pid === 3 || pid === 0) {
      if (fmt === 12) sub12 = so;
      else if (fmt === 4 && (eid === 1 || pid === 0)) sub4 = sub4 || so;
    }
  }
  const map = new Map();
  if (sub12 !== null) {
    const groups = b.readUInt32BE(sub12 + 12);
    for (let g = 0; g < groups; g++) {
      const o = sub12 + 16 + g * 12;
      const s = b.readUInt32BE(o), e = b.readUInt32BE(o + 4), gid = b.readUInt32BE(o + 8);
      for (let c = s; c <= e && c - s < 70000; c++) map.set(c, gid + (c - s));
    }
  } else if (sub4 !== null) {
    const segX2 = b.readUInt16BE(sub4 + 6), seg = segX2 / 2;
    const ends = sub4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let i = 0; i < seg; i++) {
      const e = b.readUInt16BE(ends + i * 2), s = b.readUInt16BE(starts + i * 2);
      const d = b.readInt16BE(deltas + i * 2), ro = b.readUInt16BE(ranges + i * 2);
      for (let c = s; c <= e && c !== 0xffff; c++) {
        let gid;
        if (ro === 0) gid = (c + d) & 0xffff;
        else {
          const p = ranges + i * 2 + ro + (c - s) * 2;
          gid = b.readUInt16BE(p);
          if (gid) gid = (gid + d) & 0xffff;
        }
        map.set(c, gid);
      }
    }
  }
  const font = { file, unitsPerEm, ascender, descender, advances, map };
  cache[file] = font;
  return font;
}

function advanceOf(font, cp) {
  const gid = font.map.get(cp);
  if (gid !== undefined) return font.advances[Math.min(gid, font.advances.length - 1)];
  // Font thiếu glyph tiếng Việt -> trình render/CapCut fallback sang sans-serif (~0.56em).
  const notdef = font.advances[0] || 0;
  return Math.max(notdef, Math.round(font.unitsPerEm * 0.56));
}

/** Bề ngang (px) của chuỗi ở cỡ chữ sizePx; letterSpacingEm cộng thêm sau mỗi ký tự (theo em). */
function measure(file, text, sizePx, letterSpacingEm) {
  const f = parse(file);
  let units = 0, count = 0;
  for (const ch of String(text).normalize('NFC')) { units += advanceOf(f, ch.codePointAt(0)); count++; }
  return (units / f.unitsPerEm) * sizePx + Math.max(0, count - 1) * (letterSpacingEm || 0) * sizePx;
}

/** Chiều cao dòng (px) theo ascender/descender của font. */
function lineHeight(file, sizePx) {
  const f = parse(file);
  return ((f.ascender - f.descender) / f.unitsPerEm) * sizePx;
}

/** Font có đủ glyph cho chuỗi không. */
function covers(file, text) {
  const f = parse(file);
  for (const ch of String(text).normalize('NFC')) { if (ch.trim() && !f.map.get(ch.codePointAt(0))) return false; }
  return true;
}

/**
 * Đọc tên font (bảng 'name') mà không parse cả font — đủ nhanh để quét hàng trăm file.
 * Trả về { family, style, full, ps } hoặc null nếu không đọc được (vd. .ttc, file hỏng).
 */
function readNames(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    const tag = head.toString('ascii', 0, 4);
    if (tag === 'ttcf') return null;                      // bộ sưu tập font: CapCut không chọn từng mặt được
    const n = head.readUInt16BE(4);
    if (!n || n > 100) return null;
    const dir = Buffer.alloc(n * 16);
    fs.readSync(fd, dir, 0, dir.length, 12);
    let off = -1, len = 0;
    for (let i = 0; i < n; i++) {
      if (dir.toString('ascii', i * 16, i * 16 + 4) === 'name') { off = dir.readUInt32BE(i * 16 + 8); len = dir.readUInt32BE(i * 16 + 12); }
    }
    if (off < 0 || len > 2e6) return null;
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, off);
    const count = b.readUInt16BE(2), strOff = b.readUInt16BE(4);
    const best = {};
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12;
      const pid = b.readUInt16BE(r), eid = b.readUInt16BE(r + 2), lang = b.readUInt16BE(r + 4), nid = b.readUInt16BE(r + 6);
      const l = b.readUInt16BE(r + 8), o = strOff + b.readUInt16BE(r + 10);
      if (![1, 2, 4, 6, 16, 17].includes(nid) || o + l > b.length) continue;
      // Ưu tiên Windows/Unicode tiếng Anh (0x409), rồi Unicode bất kỳ, rồi Mac Roman.
      const score = pid === 3 && lang === 0x409 ? 3 : (pid === 3 || pid === 0) ? 2 : pid === 1 && eid === 0 ? 1 : 0;
      if (!score || (best[nid] && best[nid].score >= score)) continue;
      const raw = b.subarray(o, o + l);
      const text = pid === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le');
      best[nid] = { score, text: text.replace(/\0/g, '').trim() };
    }
    const g = (id) => (best[id] && best[id].text) || '';
    const family = g(16) || g(1);
    if (!family) return null;
    return { family, style: g(17) || g(2) || 'Regular', full: g(4) || family, ps: g(6) };
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) {}
  }
}

/** Kiểm tra nhanh font có đủ các ký tự (chỉ đọc bảng cmap, không dựng bảng ánh xạ đầy đủ). */
function hasChars(file, text) {
  let b;
  try { b = fs.readFileSync(file); } catch (e) { return false; }
  try {
    if (b.toString('ascii', 0, 4) === 'ttcf') return false;
    const n = b.readUInt16BE(4);
    let cmap = -1;
    for (let i = 0; i < n; i++) { const o = 12 + i * 16; if (b.toString('ascii', o, o + 4) === 'cmap') cmap = b.readUInt32BE(o + 8); }
    if (cmap < 0) return false;
    const nSub = b.readUInt16BE(cmap + 2);
    let s12 = -1, s4 = -1;
    for (let i = 0; i < nSub; i++) {
      const r = cmap + 4 + i * 8, pid = b.readUInt16BE(r), so = cmap + b.readUInt32BE(r + 4), fmt = b.readUInt16BE(so);
      if (pid === 3 || pid === 0) { if (fmt === 12) s12 = so; else if (fmt === 4 && s4 < 0) s4 = so; }
    }
    const has = (cp) => {
      if (s12 >= 0) {
        const groups = b.readUInt32BE(s12 + 12);
        for (let g = 0; g < groups; g++) {
          const o = s12 + 16 + g * 12;
          if (cp >= b.readUInt32BE(o) && cp <= b.readUInt32BE(o + 4)) return b.readUInt32BE(o + 8) + (cp - b.readUInt32BE(o)) !== 0;
        }
        return false;
      }
      if (s4 < 0 || cp > 0xffff) return false;
      const segX2 = b.readUInt16BE(s4 + 6), ends = s4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let i = 0; i < segX2 / 2; i++) {
        if (cp > b.readUInt16BE(ends + i * 2)) continue;
        const s = b.readUInt16BE(starts + i * 2);
        if (cp < s) return false;
        const d = b.readInt16BE(deltas + i * 2), ro = b.readUInt16BE(ranges + i * 2);
        if (ro === 0) return ((cp + d) & 0xffff) !== 0;
        const gid = b.readUInt16BE(ranges + i * 2 + ro + (cp - s) * 2);
        return gid !== 0;
      }
      return false;
    };
    for (const ch of String(text).normalize('NFC')) { if (ch.trim() && !has(ch.codePointAt(0))) return false; }
    return true;
  } catch (e) { return false; }
}

module.exports = { parse, measure, lineHeight, covers, readNames, hasChars };
