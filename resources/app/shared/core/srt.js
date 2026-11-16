/* Gom từ thành dòng phụ đề ngang thông minh (tránh cắt đôi từ ghép tiếng Việt, cân 1–2 dòng chuẩn phim). */
(function (factory) {
  var m = factory();
  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) module.exports = m;
  else (typeof window !== 'undefined' ? window : globalThis).AutoSubSRT = m;
})(function () {
  'use strict';

  var Vi = (typeof window !== 'undefined' && window.AutoSubViPhrases) ||
    (typeof globalThis !== 'undefined' && globalThis.AutoSubViPhrases) ||
    (typeof require === 'function' ? (function () {
      try { return require('./vi-phrases.js'); }
      catch (e) { try { return require('./shared/core/vi-phrases.js'); } catch (_) { return null; } }
    })() : null);

  var DEFAULTS = { maxChars: 32, maxDur: 3.5, gap: 0.5, minDur: 0.6, twoLines: false, maxLineChars: 36 };

  function balanceTwoLines(text, maxLineChars) {
    var words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 3 || text.length <= maxLineChars) return words.join(' ');
    var bestIdx = -1, bestCost = Infinity;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' ');
      var b = words.slice(i).join(' ');
      var cost = Math.abs(a.length - b.length);
      var prev = words[i - 1], next = words[i];
      if (/[,.!?…;:]$/.test(prev)) cost -= 8;
      if (Vi) {
        if (Vi.isCompoundPair({ text: prev, start: 0, end: 0 }, { text: next, start: 0, end: 0 }, words[i + 1] ? { text: words[i + 1] } : null)) cost += 30;
        if (Vi.isTrailingHead({ text: prev }) && !Vi.endsClause(prev)) cost += 18;
        if (Vi.isLeadingTail({ text: next })) cost += 14;
        if (Vi.isPhraseStarter({ text: next }) && !Vi.isTrailingHead({ text: prev })) cost -= 4;
      }
      if (cost < bestCost) { bestCost = cost; bestIdx = i; }
    }
    if (bestIdx <= 0) return words.join(' ');
    return words.slice(0, bestIdx).join(' ') + '\n' + words.slice(bestIdx).join(' ');
  }

  function joinChars(ws) {
    var n = 0;
    for (var i = 0; i < ws.length; i++) n += ws[i].text.trim().length;
    return n + Math.max(0, ws.length - 1);
  }

  function groupCues(words, opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in opts || {}) if (opts[k] !== undefined) o[k] = opts[k];
    words = (words || []).filter(function (w) { return w && String(w.text).trim(); });

    var cues = [], cur = [];
    function flushSlice(slice) {
      if (!slice.length) return;
      var raw = slice.map(function (w) { return w.text.trim(); }).join(' ');
      var text = o.twoLines ? balanceTwoLines(raw, o.maxLineChars) : raw;
      cues.push({
        start: slice[0].start,
        end: slice[slice.length - 1].end,
        text: text,
        words: slice.map(function (w) { return { text: w.text.trim(), start: w.start, end: w.end }; })
      });
    }

    words.forEach(function (w, idx) {
      if (cur.length) {
        var prev = cur[cur.length - 1];
        var nextChars = joinChars(cur) + 1 + w.text.trim().length;
        var needSplitGap = (w.start - prev.end) > o.gap;
        var needSplitLen = nextChars > o.maxChars || (w.end - cur[0].start) > o.maxDur;
        if (needSplitGap) {
          flushSlice(cur);
          cur = [];
        } else if (needSplitLen) {
          // Tìm điểm ngắt lùi sạch (tránh chẻ đôi từ ghép hoặc bỏ lại hư từ cuối câu)
          var cut = cur.length;
          if (Vi && cur.length >= 3) {
            var nxAfter = words[idx + 1] || null;
            var curPrev = cur[cur.length - 1];
            var badEdge = Vi.isCompoundPair(curPrev, w, nxAfter) || (Vi.isTrailingHead(curPrev) && !Vi.endsClause(curPrev.text));
            if (badEdge) {
              for (var q = cur.length - 1; q >= Math.max(2, cur.length - 3); q--) {
                var a = cur[q - 1], b = cur[q];
                if (!Vi.isCompoundPair(a, b, cur[q + 1] || w) && !(Vi.isTrailingHead(a) && !Vi.endsClause(a.text))) {
                  cut = q;
                  break;
                }
              }
            }
          }
          flushSlice(cur.slice(0, cut));
          cur = cur.slice(cut);
        }
      }
      cur.push(w);
      if (/[.!?…]["'”’)]*$/.test(w.text)) { flushSlice(cur); cur = []; }
    });
    flushSlice(cur);

    cues.forEach(function (c, i) {
      var next = cues[i + 1];
      if (c.end - c.start < o.minDur) c.end = c.start + o.minDur;
      if (next && c.end > next.start - 0.02) c.end = Math.max(c.start + 0.05, next.start - 0.02);
    });
    return cues;
  }

  function groupMovieCues(words, canvas) {
    var landscape = canvas && canvas.width > canvas.height;
    return groupCues(words, {
      maxChars: landscape ? 66 : 42,
      maxLineChars: landscape ? 36 : 24,
      maxDur: 4.5,
      gap: 0.45,
      minDur: 0.7,
      twoLines: true
    });
  }

  function ts(t) {
    var ms = Math.max(0, Math.round(t * 1000));
    var h = Math.floor(ms / 3600000); ms -= h * 3600000;
    var m = Math.floor(ms / 60000); ms -= m * 60000;
    var s = Math.floor(ms / 1000); ms -= s * 1000;
    function p(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(ms, 3);
  }

  function toSrt(cues) {
    return cues.map(function (c, i) {
      return (i + 1) + '\r\n' + ts(c.start) + ' --> ' + ts(c.end) + '\r\n' + String(c.text || '').replace(/\n/g, '\r\n') + '\r\n';
    }).join('\r\n');
  }

  return { DEFAULTS: DEFAULTS, groupCues: groupCues, groupMovieCues: groupMovieCues, balanceTwoLines: balanceTwoLines, toSrt: toSrt, ts: ts };
});
