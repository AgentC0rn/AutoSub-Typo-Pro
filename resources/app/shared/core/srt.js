/* Gom từ thành dòng phụ đề ngang (hỗ trợ cả SRT và Sub Phim 1–2 dòng cân đối). */
(function (factory) {
  var m = factory();
  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) module.exports = m;
  else (typeof window !== 'undefined' ? window : globalThis).AutoSubSRT = m;
})(function () {
  'use strict';

  var DEFAULTS = { maxChars: 32, maxDur: 3.5, gap: 0.5, minDur: 0.6, twoLines: false, maxLineChars: 36 };

  function balanceTwoLines(text, maxLineChars) {
    var words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 3 || text.length <= maxLineChars) return words.join(' ');
    var bestIdx = -1, bestDiff = Infinity;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' ');
      var b = words.slice(i).join(' ');
      var diff = Math.abs(a.length - b.length);
      if (/[,.!?…;:]$/.test(words[i - 1])) diff -= 6;
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    if (bestIdx <= 0) return words.join(' ');
    return words.slice(0, bestIdx).join(' ') + '\n' + words.slice(bestIdx).join(' ');
  }

  function groupCues(words, opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in opts || {}) if (opts[k] !== undefined) o[k] = opts[k];
    words = (words || []).filter(function (w) { return w && String(w.text).trim(); });

    var cues = [], cur = [];
    function flush() {
      if (!cur.length) return;
      var raw = cur.map(function (w) { return w.text.trim(); }).join(' ');
      var text = o.twoLines ? balanceTwoLines(raw, o.maxLineChars) : raw;
      cues.push({
        start: cur[0].start,
        end: cur[cur.length - 1].end,
        text: text,
        words: cur.map(function (w) { return { text: w.text.trim(), start: w.start, end: w.end }; })
      });
      cur = [];
    }
    words.forEach(function (w) {
      if (cur.length) {
        var text = cur.map(function (x) { return x.text; }).join(' ') + ' ' + w.text;
        var prev = cur[cur.length - 1];
        if (text.length > o.maxChars || w.end - cur[0].start > o.maxDur || w.start - prev.end > o.gap) flush();
      }
      cur.push(w);
      if (/[.!?…]["'”’)]*$/.test(w.text)) flush();
    });
    flush();

    // Kéo dài cue quá ngắn, không để chồng lên cue sau.
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
