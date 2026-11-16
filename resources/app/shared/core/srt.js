/* Gom từ thành dòng phụ đề và xuất SRT. */
(function (factory) {
  var m = factory();
  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) module.exports = m;
  else (typeof window !== 'undefined' ? window : globalThis).AutoSubSRT = m;
})(function () {
  'use strict';

  var DEFAULTS = { maxChars: 32, maxDur: 3.5, gap: 0.5, minDur: 0.6 };

  function groupCues(words, opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in opts || {}) o[k] = opts[k];
    words = (words || []).filter(function (w) { return w && String(w.text).trim(); });

    var cues = [], cur = [];
    function flush() {
      if (!cur.length) return;
      cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(function (w) { return w.text.trim(); }).join(' ') });
      cur = [];
    }
    words.forEach(function (w, i) {
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
      if (next && c.end > next.start - 0.01) c.end = Math.max(c.start + 0.05, next.start - 0.01);
    });
    return cues;
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
      return (i + 1) + '\r\n' + ts(c.start) + ' --> ' + ts(c.end) + '\r\n' + c.text + '\r\n';
    }).join('\r\n');
  }

  return { DEFAULTS: DEFAULTS, groupCues: groupCues, toSrt: toSrt, ts: ts };
});
