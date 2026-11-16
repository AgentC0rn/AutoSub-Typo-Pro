/*
 * Bộ dàn trang typography — chạy hoàn toàn offline, không cần AI ngoài.
 * Vào: danh sách từ [{text, start, end, rms?}] (giây, theo timeline).
 * Ra:  các cụm chữ (group), mỗi cụm 1–3 dòng; dòng chứa từ nhấn có style riêng.
 *
 * Style (giống video mẫu):
 *   base   – Encode Sans SemiExpanded SemiBold, hiện xám rồi sáng lên trắng
 *   script – Romanesco (chữ viết tay), vàng gold + glow — chỉ khi font có đủ ký tự
 *   blue   – Encode Sans SemiExpanded Black, xanh teal → xanh dương + glow
 *   gold   – Encode Sans SemiExpanded Black, vàng gold + glow (thay script khi thiếu dấu)
 */
(function (factory) {
  var m = factory();
  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) module.exports = m;
  else (typeof window !== 'undefined' ? window : globalThis).AutoSubLayout = m;
})(function () {
  'use strict';

  function toSet(s) { var o = {}; s.split(/\s+/).forEach(function (w) { if (w) o[w] = 1; }); return o; }

  // Hư từ: không bao giờ được chọn làm từ nhấn.
  var STOP = {
    vi: toSet('à ạ ơi nhé nha nhỉ hả thì là mà của và với các những một cái con chiếc này kia đó ấy cho để khi nếu ' +
      'nhưng hay hoặc rồi cũng đã đang sẽ được bị có không chưa chẳng rất lắm quá nữa vẫn còn ra vào lên xuống ở tại ' +
      'trong ngoài trên dưới về từ đến tới như vì nên thế vậy đây đấy gì nào ai bạn mình tôi tớ anh chị em nó họ ' +
      'chúng ta mọi người thì cứ lại đi luôn chỉ mỗi hơn nhất cùng theo bởi do'),
    en: toSet('a an the and or but if then so to of in on at by for with from as is am are was were be been being ' +
      'it its this that these those i you he she we they me him her us them my your our their do does did not no ' +
      'just very really can could will would should have has had what which who when where how there here up out ' +
      'about into than too also only all some any')
  };

  // Ký tự tiếng Việt mà font Romanesco KHÔNG có -> từ chứa chúng không dùng style script.
  var SCRIPT_MISSING = 'ơưảạằắẳẵặầấẩẫậẻẽẹềếểễệỉịỏọồốổỗộờớởỡợủụừứửữựỷỹỵƠƯẢẠẰẮẲẴẶẦẤẨẪẬẺẼẸỀẾỂỄỆỈỊỎỌỒỐỔỖỘỜỚỞỠỢỦỤỪỨỬỮỰỶỸỴ';
  function scriptOK(text) {
    text = String(text).normalize ? String(text).normalize('NFC') : String(text);
    for (var i = 0; i < text.length; i++) if (SCRIPT_MISSING.indexOf(text.charAt(i)) >= 0) return false;
    return true;
  }

  var DEFAULTS = {
    lang: 'vi',
    gapSplit: 0.3,      // khoảng lặng (giây) để ngắt cụm
    maxWords: 5,        // video mẫu: 1–5 từ / cụm
    maxChars: 24,       // tối đa ký tự / cụm
    lineChars: 11,      // ký tự / dòng chữ thường (font SemiExpanded khá rộng)
    maxLines: 3,
    emphasisRate: 0.6,  // ~60% số cụm có từ nhấn
    lead: 0.04,         // cụm xuất hiện sớm hơn từ đầu tiên một chút
    hold: 0.45          // giữ chữ sau từ cuối trước khi xoá
  };

  function norm(t) { return String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
  function isStop(w, lang) {
    var n = norm(w.text);
    if (!n) return true;
    return !!((STOP[lang] && STOP[lang][n]) || STOP.en[n]);
  }
  function chars(ws) {
    var n = 0;
    for (var i = 0; i < ws.length; i++) n += ws[i].text.length;
    return n + Math.max(0, ws.length - 1);
  }
  function endsClause(t) { return /[.!?…,;:]["'”’)\]]*$/.test(t); }
  // 2 từ nội dung liền nhau (tiếng Việt) -> có thể là từ ghép, tránh tách.
  // (Không dựa vào khoảng lặng vì âm tiết tiếng Việt được nói đều nhau.)
  function tight(a, b, o) {
    return !!(a && b && o.lang === 'vi' && !isStop(a, o.lang) && !isStop(b, o.lang) &&
      !endsClause(a.text) && b.start - a.end < 0.25);
  }
  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b || {}) if (b[k] !== undefined) o[k] = b[k]; return o; }

  /* ---------- 1. Chia cụm ---------- */
  function splitPhrases(words, o) {
    var out = [], cur = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i], nx = words[i + 1];
      cur.push(w);
      var hard = !nx || endsClause(w.text) || (nx.start - w.end) > o.gapSplit;
      var soft = !hard && (cur.length >= o.maxWords || chars(cur.concat([nx])) > o.maxChars);
      // Tránh để 1 từ mồ côi cuối câu: nếu từ kế tiếp kết thúc câu thì cho cụm dài thêm 1 từ.
      if (soft && endsClause(nx.text) && chars(cur.concat([nx])) <= o.maxChars + 8 &&
          (words[i + 2] ? words[i + 2].start - nx.end : 1) >= 0) soft = false;
      // Không cắt giữa 2 từ nội dung (dễ là từ ghép: "dự | án", "lãng | phí").
      // Quay lui tìm chỗ ngắt tự nhiên: ngay trước một hư từ ("thì", "là", "của"…).
      if (soft && o.lang === 'vi' && !isStop(nx, o.lang)) {
        var j = -1;
        for (var q = cur.length - 1; q >= 2; q--) if (isStop(cur[q], o.lang) && !tight(cur[q - 1], cur[q], o)) { j = q; break; }
        if (j > 0) { out.push(cur.slice(0, j)); cur = cur.slice(j); continue; }
        if (chars(cur.concat([nx])) <= o.maxChars + 6 && cur.length < o.maxWords + 1) continue; // cho dài thêm 1 từ
      }
      if (hard || soft) { out.push(cur); cur = []; }
    }
    return out;
  }

  /* ---------- 2. Chấm điểm từ nhấn ---------- */
  function stats(arr) {
    if (!arr.length) return { m: 0, sd: 1 };
    var m = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    var v = arr.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / arr.length;
    return { m: m, sd: Math.sqrt(v) || 1 };
  }

  function stretch(w) { return (w.end - w.start) / Math.max(1, norm(w.text).length); }

  function scorePhrase(ws, o, st) {
    var content = [];
    ws.forEach(function (w, i) { if (!isStop(w, o.lang)) content.push(i); });
    if (!content.length) return null;
    var last = content[content.length - 1], best = null, scores = {};
    content.forEach(function (i) {
      var w = ws[i];
      var zL = (typeof w.rms === 'number') ? (w.rms - st.rms.m) / st.rms.sd : 0;  // nói to hơn
      var zS = (stretch(w) - st.str.m) / st.str.sd;                              // nói kéo dài hơn
      var s = 0.6 * zL + 0.5 * zS + 0.25 * Math.min(norm(w.text).length, 8) / 8 + (i === last ? 0.35 : 0);
      scores[i] = s;
      if (!best || s > best.score) best = { idx: i, score: s };
    });
    best.scores = scores;
    return best;
  }

  // Tiếng Việt: từ ghép 2 âm tiết ("dự án", "lãng phí") -> nhấn cả cụm.
  // Nối sang bên (trước/sau) có điểm nhấn cao hơn, chỉ khi bên đó cũng được nói nhấn (điểm > 0).
  function compoundSpan(ws, best, o) {
    var idx = best.idx;
    if (o.lang !== 'vi') return [idx, idx];
    var w = ws[idx], lim = o.lineChars + 2, cands = [];
    var nx = ws[idx + 1], pv = ws[idx - 1];
    if (nx && best.scores[idx + 1] !== undefined && nx.start - w.end < 0.15 && chars([w, nx]) <= lim)
      cands.push({ span: [idx, idx + 1], s: best.scores[idx + 1] });
    if (pv && best.scores[idx - 1] !== undefined && w.start - pv.end < 0.15 && chars([pv, w]) <= lim)
      cands.push({ span: [idx - 1, idx], s: best.scores[idx - 1] });
    cands.sort(function (a, b) { return b.s - a.s; });
    return cands.length && cands[0].s > 0 ? cands[0].span : [idx, idx];
  }

  /* ---------- 3. Ngắt dòng ---------- */
  function greedyLines(ws, maxC) {
    var lines = [], cur = [];
    ws.forEach(function (w) {
      if (cur.length && chars(cur.concat([w])) > maxC) { lines.push(cur); cur = []; }
      cur.push(w);
    });
    if (cur.length) lines.push(cur);
    return lines;
  }

  function balancedLines(ws, maxC, o) {
    if (!ws.length) return [];
    if (chars(ws) <= maxC || ws.length < 2) return [ws];
    if (chars(ws) > maxC * 2.2) return greedyLines(ws, maxC);
    var bestK = 1, bestD = Infinity;
    for (var k = 1; k < ws.length; k++) {
      var d = Math.abs(chars(ws.slice(0, k)) - chars(ws.slice(k))) + (o && tight(ws[k - 1], ws[k], o) ? 8 : 0);
      if (d < bestD) { bestD = d; bestK = k; }
    }
    return [ws.slice(0, bestK), ws.slice(bestK)];
  }

  function layoutLines(ws, span, style, o) {
    var lines;
    if (!span) {
      lines = balancedLines(ws, o.lineChars, o).map(function (l) { return { style: 'base', words: l }; });
    } else {
      var before = ws.slice(0, span[0]), em = ws.slice(span[0], span[1] + 1), after = ws.slice(span[1] + 1);
      lines = [];
      var lc = Math.round(o.lineChars * 1.2); // dòng phụ cạnh từ nhấn được dài hơn chút, tránh từ lẻ
      balancedLines(before, lc, o).forEach(function (l) { lines.push({ style: 'base', words: l }); });
      lines.push({ style: style, words: em });
      balancedLines(after, lc, o).forEach(function (l) { lines.push({ style: 'base', words: l }); });
      // Quá số dòng -> gộp các dòng thường liền kề ngắn nhất.
      while (lines.length > o.maxLines) {
        var bi = -1, bc = Infinity;
        for (var i = 0; i < lines.length - 1; i++) {
          if (lines[i].style !== 'base' || lines[i + 1].style !== 'base') continue;
          var c = chars(lines[i].words.concat(lines[i + 1].words));
          if (c < bc) { bc = c; bi = i; }
        }
        if (bi < 0) break;
        lines.splice(bi, 2, { style: 'base', words: lines[bi].words.concat(lines[bi + 1].words) });
      }
    }
    return lines.map(function (l) {
      return {
        style: l.style,
        words: l.words.map(function (w) { return { i: ws.indexOf(w), text: w.text, start: w.start, end: w.end }; })
      };
    });
  }

  /* ---------- API ---------- */
  // Xen kẽ chữ viết tay vàng và chữ đậm xanh như video mẫu; script thiếu dấu -> chữ đậm vàng.
  // o.scriptOK(text): kiểm tra theo font viết tay người dùng chọn (mặc định: bảng ký tự thiếu của Romanesco).
  var okScript = function (o, text) { return (o && typeof o.scriptOK === 'function' ? o.scriptOK : scriptOK)(text); };
  function pickStyle(text, counter, o) {
    if (counter % 2 === 0) return (okScript(o, text) && norm(text).length <= 12) ? 'script' : 'gold';
    return 'blue';
  }
  var CYCLE = ['script', 'blue', 'gold'];
  function nextStyle(cur, text, o) {
    var i = CYCLE.indexOf(cur);
    for (var k = 1; k <= CYCLE.length; k++) {
      var s = CYCLE[(i + k) % CYCLE.length];
      if (s !== 'script' || okScript(o, text)) return s;
    }
    return 'blue';
  }
  function spanText(group) {
    return group.span ? group.words.slice(group.span[0], group.span[1] + 1).map(function (w) { return w.text; }).join(' ') : '';
  }

  function buildLayout(words, opts) {
    var o = merge(DEFAULTS, opts);
    words = (words || []).filter(function (w) { return w && String(w.text).trim(); });
    var phrases = splitPhrases(words, o);

    var content = words.filter(function (w) { return !isStop(w, o.lang); });
    var st = {
      rms: stats(content.filter(function (w) { return typeof w.rms === 'number'; }).map(function (w) { return w.rms; })),
      str: stats(content.map(stretch))
    };

    var bests = phrases.map(function (ws) { return scorePhrase(ws, o, st); });
    var ranked = bests.map(function (b, i) { return { i: i, s: b ? b.score : -Infinity }; })
      .filter(function (x) { return x.s > -Infinity; })
      .sort(function (a, b) { return b.s - a.s; });
    var quota = Math.round(o.emphasisRate * phrases.length), chosen = {};
    ranked.slice(0, quota).forEach(function (x) { if (x.s > -0.3) chosen[x.i] = true; });

    var counter = 0;
    var groups = phrases.map(function (ws, gi) {
      var span = chosen[gi] ? compoundSpan(ws, bests[gi], o) : null;
      var style = span ? pickStyle(ws.slice(span[0], span[1] + 1).map(function (w) { return w.text; }).join(' '), counter++, o) : null;
      return {
        id: 'g' + gi,
        start: 0,
        end: 0,
        words: ws.map(function (w) { return { text: w.text, start: w.start, end: w.end, rms: w.rms }; }),
        span: span,
        style: style,
        lines: layoutLines(ws, span, style, o)
      };
    });
    return retime(groups, 0, groups.length - 1, o);
  }

  function relayout(group, opts) {
    var o = merge(DEFAULTS, opts);
    if (group.span && group.style === 'script' && !okScript(opts, spanText(group))) group.style = 'gold';
    group.lines = layoutLines(group.words, group.span, group.style || 'blue', o);
    return group;
  }

  /** Bấm 1 từ: bật/tắt nhấn. extend=true (Shift) để nối thêm từ liền kề vào cụm nhấn. */
  function toggleWord(group, idx, extend, opts) {
    var s = group.span;
    if (extend && s && (idx === s[0] - 1 || idx === s[1] + 1)) {
      group.span = [Math.min(s[0], idx), Math.max(s[1], idx)];
    } else if (s && idx >= s[0] && idx <= s[1]) {
      group.span = null;
    } else {
      group.span = [idx, idx];
    }
    if (group.span && !group.style) group.style = okScript(opts, spanText(group)) ? 'script' : 'blue';
    return relayout(group, opts);
  }

  function cycleStyle(group, opts) {
    if (!group.span) return group;
    group.style = nextStyle(group.style, spanText(group), opts);
    return relayout(group, opts);
  }

  /* ---------- Tách / Gộp cụm & tách từ sau khi nhận dạng ---------- */
  var uidSeq = 0;
  function newGroupId() { uidSeq++; return 'g' + Date.now().toString(36) + '_' + uidSeq; }
  function copyCustom(c) { return c ? JSON.parse(JSON.stringify(c)) : undefined; }
  function spanPart(span, from, to) {
    if (!span) return null;
    var s0 = Math.max(span[0], from), s1 = Math.min(span[1], to - 1);
    return s0 <= s1 ? [s0 - from, s1 - from] : null;
  }

  /** Tính lại thời gian xuất hiện/biến mất cho các cụm (không chồng lấn giữa cụm kề nhau). */
  function retime(groups, from, to, opts) {
    var o = merge(DEFAULTS, opts);
    var lo = Math.max(0, from == null ? 0 : from);
    var hi = Math.min(groups.length - 1, to == null ? groups.length - 1 : to);
    for (var k = lo; k <= hi; k++) {
      var g = groups[k], ws = g.words, prev = groups[k - 1], next = groups[k + 1];
      if (!ws || !ws.length) continue;
      var start = Math.max(0, ws[0].start - o.lead);
      if (prev && typeof prev.end === 'number') start = Math.max(start, prev.end);
      var lastEnd = ws[ws.length - 1].end;
      var end = lastEnd + o.hold;
      if (next && next.words && next.words.length) end = Math.min(end, next.words[0].start - o.lead - 0.02);
      g.start = start;
      g.end = Math.max(g.start + 0.04, Math.max(end, lastEnd));
    }
    return groups;
  }

  /**
   * Tách cụm groups[gi] thành 2 cụm, cụm sau bắt đầu từ từ thứ `at` (1..n-1).
   * Sửa trực tiếp mảng groups, trả về [cụmTrước, cụmSau] hoặc null nếu không tách được.
   */
  function splitGroup(groups, gi, at, opts) {
    var g = groups[gi];
    if (!g || !g.words || at <= 0 || at >= g.words.length) return null;
    var n = g.words.length;
    var a = merge(g, { words: g.words.slice(0, at), span: spanPart(g.span, 0, at), custom: copyCustom(g.custom) });
    var b = merge(g, { id: newGroupId(), words: g.words.slice(at), span: spanPart(g.span, at, n), custom: copyCustom(g.custom) });
    if (!a.span) a.style = null;
    if (!b.span) b.style = null;
    if (a.custom === undefined) delete a.custom;
    if (b.custom === undefined) delete b.custom;
    groups.splice(gi, 1, a, b);
    relayout(a, opts);
    relayout(b, opts);
    retime(groups, 0, groups.length - 1, opts);
    return [a, b];
  }

  /** Tách cụm đang chứa thời điểm t ngay trước từ đầu tiên bắt đầu từ t trở đi. */
  function splitAtTime(groups, t, opts) {
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      if (t < g.start || t > g.end || !g.words || g.words.length < 2) continue;
      var at = -1;
      for (var k = 1; k < g.words.length; k++) {
        var mid = (g.words[k - 1].end + g.words[k].start) / 2;
        if (t <= mid) { at = k; break; }
      }
      if (at < 0) at = g.words.length - 1;
      return splitGroup(groups, gi, at, opts);
    }
    return null;
  }

  /** Gộp cụm groups[gi] với cụm ngay sau. Trả về cụm đã gộp hoặc null. */
  function mergeGroups(groups, gi, opts) {
    var g = groups[gi], h = groups[gi + 1];
    if (!g || !h) return null;
    var off = g.words.length;
    var span = g.span ? g.span.slice() : (h.span ? [h.span[0] + off, h.span[1] + off] : null);
    var style = g.span ? g.style : (h.span ? h.style : null);
    var m = merge(g, { words: g.words.concat(h.words), span: span, style: style });
    groups.splice(gi, 2, m);
    relayout(m, opts);
    retime(groups, 0, groups.length - 1, opts);
    return m;
  }

  /**
   * Tách 1 từ nhận dạng thành nhiều từ (vd "xinchào" sửa thành "xin chào"):
   * chia thời gian của từ gốc theo tỉ lệ số ký tự.
   */
  function splitWordTiming(w, text) {
    var parts = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (parts.length <= 1) return [merge(w, { text: parts[0] || '' })];
    var total = parts.reduce(function (s, p) { return s + Math.max(1, p.length); }, 0);
    var dur = Math.max(0.02 * parts.length, w.end - w.start), t = w.start;
    return parts.map(function (p, i) {
      var d = dur * Math.max(1, p.length) / total;
      var o = merge(w, { text: p, start: t, end: i === parts.length - 1 ? w.start + dur : t + d });
      t += d;
      return o;
    });
  }

  /**
   * Chuyển các cụm thành dữ liệu cho MOGRT "AutoSub Typo Group":
   * 3 dòng chữ, 3 style (1 Base, 2 Gold, 3 Teal), chuỗi timing tương đối với đầu clip.
   */
  // Phải khớp thứ tự Dropdown trong template: Base, Script Gold, Bold Blue, Bold Gold.
  var STYLE_ID = { base: 1, script: 2, blue: 3, gold: 4 };
  function toMogrtItems(groups) {
    return groups.map(function (g) {
      var lines = g.lines.slice(0, 3);
      if (g.lines.length > 3) {
        // An toàn: gộp phần dư vào dòng cuối.
        lines[2] = { style: lines[2].style, words: [].concat.apply([], g.lines.slice(2).map(function (l) { return l.words; })) };
      }
      var texts = [], styles = [], rows = [];
      for (var i = 0; i < 3; i++) {
        var l = lines[i];
        texts.push(l ? l.words.map(function (w) { return w.text; }).join(' ') : ' ');
        styles.push(l ? STYLE_ID[l.style] || 1 : 1);
        rows.push(l ? l.words.map(function (w) { return Math.max(0, w.start - g.start).toFixed(3); }).join(',') : '');
      }
      return { start: +g.start.toFixed(3), end: +g.end.toFixed(3), texts: texts, styles: styles, timing: rows.join('|') };
    });
  }

  return {
    DEFAULTS: DEFAULTS, buildLayout: buildLayout, relayout: relayout, toggleWord: toggleWord,
    cycleStyle: cycleStyle, isStop: isStop, splitPhrases: splitPhrases, toMogrtItems: toMogrtItems,
    scriptOK: scriptOK, STYLE_ID: STYLE_ID,
    splitGroup: splitGroup, splitAtTime: splitAtTime, mergeGroups: mergeGroups,
    splitWordTiming: splitWordTiming, retime: retime
  };
});
