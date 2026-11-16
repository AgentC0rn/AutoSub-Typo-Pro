/*
 * Bộ dàn trang typography — chạy hoàn toàn offline, không cần AI ngoài.
 * Hỗ trợ:
 *   - Ngắt cụm theo khoảng lặng + ngữ nghĩa tiếng Việt (tránh chẻ đôi từ ghép / để hư từ lơ lửng cuối cụm)
 *   - Áp dụng 1 hoặc nhiều dạng nhấn ('script', 'gold', 'blue') cho nhiều từ / cụm từ trong cùng 1 khung
 */
(function (factory) {
  var m = factory();
  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) module.exports = m;
  else (typeof window !== 'undefined' ? window : globalThis).AutoSubLayout = m;
})(function () {
  'use strict';

  var Vi = (typeof window !== 'undefined' && window.AutoSubViPhrases) ||
    (typeof globalThis !== 'undefined' && globalThis.AutoSubViPhrases) ||
    (typeof require === 'function' ? (function () {
      try { return require('./vi-phrases.js'); }
      catch (e) { try { return require('./shared/core/vi-phrases.js'); } catch (_) { return null; } }
    })() : null);

  function toSet(s) { var o = {}; s.split(/\s+/).forEach(function (w) { if (w) o[w] = 1; }); return o; }

  // Hư từ: không bao giờ tự động chọn làm từ nhấn.
  var STOP = {
    vi: toSet('à ạ ơi nhé nha nhỉ hả thì là mà của và với các những một cái con chiếc này kia đó ấy cho để khi nếu ' +
      'nhưng hay hoặc rồi cũng đã đang sẽ được bị có không chưa chẳng rất lắm quá nữa vẫn còn ra vào lên xuống ở tại ' +
      'trong ngoài trên dưới về từ đến tới như vì nên thế vậy đây đấy gì nào ai bạn mình tôi tớ anh chị em nó họ ' +
      'chúng ta mọi người cứ lại đi luôn chỉ mỗi hơn nhất cùng theo bởi do'),
    en: toSet('a an the and or but if then so to of in on at by for with from as is am are was were be been being ' +
      'it its this that these those i you he she we they me him her us them my your our their do does did not no ' +
      'just very really can could will would should have has had what which who when where how there here up out ' +
      'about into than too also only all some any')
  };

  // Ký tự tiếng Việt mà font Romanesco KHÔNG có -> fallback khi o.scriptOK không truyền.
  var SCRIPT_MISSING = 'ơưảạằắẳẵặầấẩẫậẻẽẹềếểễệỉịỏọồốổỗộờớởỡợủụừứửữựỷỹỵƠƯẢẠẰẮẲẴẶẦẤẨẪẬẺẼẸỀẾỂỄỆỈỊỎỌỒỐỔỖỘỜỚỞỠỢỦỤỪỨỬỮỰỶỸỴ';
  function scriptOK(text) {
    text = String(text).normalize ? String(text).normalize('NFC') : String(text);
    for (var i = 0; i < text.length; i++) if (SCRIPT_MISSING.indexOf(text.charAt(i)) >= 0) return false;
    return true;
  }

  var DEFAULTS = {
    lang: 'vi',
    gapSplit: 0.50,     // khoảng lặng lớn (giây) để ép tách phát ngôn; khoảng nghỉ 0.18–0.49s do DP chấm điểm ưu tiên ngắt mềm
    maxWords: 5,        // mục tiêu 1–5 từ / cụm (tối đa mềm tới 6 nếu cần giữ trọn cụm nghĩa)
    maxChars: 25,       // mục tiêu ký tự / cụm (tối đa cứng ~33 để giữ nguyên từ ghép/cụm ngắn)
    lineChars: 11,      // ký tự / dòng chữ thường
    maxLines: 3,
    emphasisRate: 0.6,
    lead: 0.05,
    hold: 0.28
  };

  function norm(t) { return Vi ? Vi.norm(t) : String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
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
  function endsClause(t) { return Vi ? Vi.endsClause(t) : /[.!?…,;:]["'”’)\]]*$/.test(t); }
  function endsSentence(t) { return Vi ? Vi.endsSentence(t) : /[.!?…]["'”’)\]]*$/.test(t); }

  function tight(a, b, o, nextB) {
    if (!a || !b || endsClause(a.text)) return false;
    if (b.start - a.end >= 0.22) return false;
    if (o && o.lang === 'vi' && Vi) {
      if (Vi.isCompoundPair(a, b, nextB)) return true;
    }
    return !!(o && o.lang === 'vi' && !isStop(a, o.lang) && !isStop(b, o.lang) && b.start - a.end < 0.04);
  }
  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b || {}) if (b[k] !== undefined) o[k] = b[k]; return o; }

  /* ---------- 1. Chia cụm thông minh bằng Quy hoạch động theo từng câu ---------- */
  function cutPenalty(U, j, o) {
    var prev = U[j - 1], next = U[j], afterNext = U[j + 1];
    var gap = Math.max(0, next.start - prev.end);
    var cost = 0;

    if (endsClause(prev.text)) cost -= 45;
    if (gap >= 0.18) cost -= 36;
    else if (gap >= 0.10) cost -= 20;
    else if (gap >= 0.05) cost -= 8;

    if (o.lang === 'vi' && Vi) {
      var gapPrev = j >= 2 ? Math.max(0, prev.start - U[j - 2].end) : 0;
      var gapNext = j + 1 < U.length ? Math.max(0, U[j + 1].start - next.end) : 0;
      if (gap >= 0.06 && gap > Math.max(gapPrev, gapNext) * 2.2 + 0.02) cost -= 10;

      if (Vi.isCompoundPair(prev, next, afterNext)) cost += 95;
      else if (!isStop(prev, 'vi') && !isStop(next, 'vi') && gap < 0.03 &&
          !Vi.isClauseBoundaryCap(prev, next, afterNext) && !Vi.isTrailingHead(prev) && !Vi.isPhraseStarter(next)) {
        cost += 14;
      }

      if (Vi.isTrailingHead(prev) && !endsClause(prev.text)) cost += 65;
      if (j >= 2 && Vi.isTrailingHeadCompound && Vi.isTrailingHeadCompound(U[j - 2], prev) && !endsClause(next.text)) cost += 58;
      if (Vi.isLeadingTail(next) && gap < 0.15) cost += 50;
      if (Vi.isClauseBoundaryCap(prev, next, afterNext)) cost -= 28;
      if (Vi.isQuantifierSubject && Vi.isQuantifierSubject(prev, next, afterNext)) cost -= 22;
      if (Vi.isPhraseStarter(next) && !Vi.isTrailingHead(prev) && !Vi.isCompoundPair(prev, next, afterNext)) cost -= 16;
    }
    return cost;
  }

  function chunkPenalty(U, i, j, o) {
    var len = j - i, ws = U.slice(i, j), ch = chars(ws);
    var dur = U[j - 1].end - U[i].start;
    var isLast = (j === U.length);
    var softMax = o.maxChars || 25;
    var cost = 6;

    if (ch > softMax) {
      cost += Math.pow(ch - softMax, 1.55) * 4.2;
    } else if (ch < 9) {
      if (!isLast) cost += (9 - ch) * 2.5;
      else if (ch < 7 && U.length > 2) cost += (7 - ch) * 3;
    }

    if (len === 1 && !endsClause(U[i].text) && ch < 10 && U.length > 1) cost += 38;
    if (len > o.maxWords) cost += (len - o.maxWords) * 14;
    if (dur > 3.2) cost += (dur - 3.2) * 8;
    if (!isLast && dur < 0.35 && len === 1) cost += 12;
    return cost;
  }

  function splitUtteranceDP(U, o) {
    var N = U.length;
    if (N <= 1) return N ? [U] : [];
    var hardMaxChars = Math.max((o.maxChars || 25) + 9, 33);
    var dp = new Array(N + 1);
    var choice = new Array(N + 1);
    dp[N] = 0;

    for (var i = N - 1; i >= 0; i--) {
      var bestCost = Infinity, bestJ = i + 1;
      for (var j = i + 1; j <= N && j <= i + 7; j++) {
        var ch = chars(U.slice(i, j));
        if (j > i + 1 && ch > hardMaxChars) break;
        var edge = chunkPenalty(U, i, j, o) + (j < N ? cutPenalty(U, j, o) : 0);
        var total = edge + dp[j];
        if (total < bestCost) { bestCost = total; bestJ = j; }
      }
      dp[i] = bestCost;
      choice[i] = bestJ;
    }

    var groups = [], idx = 0;
    while (idx < N) {
      var end = choice[idx] || (idx + 1);
      groups.push(U.slice(idx, end));
      idx = end;
    }
    return groups;
  }

  function splitPhrases(words, o) {
    o = merge(DEFAULTS, o);
    words = (words || []).filter(function (w) { return w && String(w.text).trim(); });
    if (!words.length) return [];
    var utts = [], cur = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i], nx = words[i + 1];
      cur.push(w);
      var hardGap = !nx || (nx.start - w.end) > o.gapSplit;
      var hardPunct = endsSentence(w.text);
      if (!nx || hardGap || hardPunct) {
        utts.push(cur);
        cur = [];
      }
    }
    if (cur.length) utts.push(cur);

    var out = [];
    utts.forEach(function (u) {
      splitUtteranceDP(u, o).forEach(function (g) { out.push(g); });
    });
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
      var zL = (typeof w.rms === 'number') ? (w.rms - st.rms.m) / st.rms.sd : 0;
      var zS = (stretch(w) - st.str.m) / st.str.sd;
      var s = 0.6 * zL + 0.5 * zS + 0.25 * Math.min(norm(w.text).length, 8) / 8 + (i === last ? 0.35 : 0);
      scores[i] = s;
      if (!best || s > best.score) best = { idx: i, score: s };
    });
    best.scores = scores;
    return best;
  }

  function compoundSpan(ws, best, o) {
    var idx = best.idx;
    if (o.lang !== 'vi') return [idx, idx];
    var w = ws[idx], lim = o.lineChars + 2, cands = [];
    var nx = ws[idx + 1], pv = ws[idx - 1];
    if (nx && (best.scores[idx + 1] !== undefined || (Vi && Vi.isCompoundPair(w, nx, ws[idx + 2]))) &&
        nx.start - w.end < 0.15 && chars([w, nx]) <= lim) {
      var sr = best.scores[idx + 1] !== undefined ? best.scores[idx + 1] : 0.2;
      cands.push({ span: [idx, idx + 1], s: sr + (Vi && Vi.isCompoundPair(w, nx, ws[idx + 2]) ? 0.4 : 0) });
    }
    if (pv && (best.scores[idx - 1] !== undefined || (Vi && Vi.isCompoundPair(pv, w, ws[idx + 1]))) &&
        w.start - pv.end < 0.15 && chars([pv, w]) <= lim) {
      var sl = best.scores[idx - 1] !== undefined ? best.scores[idx - 1] : 0.2;
      cands.push({ span: [idx - 1, idx], s: sl + (Vi && Vi.isCompoundPair(pv, w, ws[idx + 1]) ? 0.4 : 0) });
    }
    cands.sort(function (a, b) { return b.s - a.s; });
    return cands.length && cands[0].s > 0 ? cands[0].span : [idx, idx];
  }

  /* ---------- 3. Hỗ trợ nhiều từ/cụm nhấn & đa kiểu trong 1 khung ---------- */
  var CYCLE = ['script', 'blue', 'gold'];
  var okScript = function (o, text) { return (o && typeof o.scriptOK === 'function' ? o.scriptOK : scriptOK)(text); };

  function nextStyle(cur, text, o) {
    var i = CYCLE.indexOf(cur);
    for (var k = 1; k <= CYCLE.length; k++) {
      var s = CYCLE[(i + k) % CYCLE.length];
      if (s !== 'script' || okScript(o, text)) return s;
    }
    return 'blue';
  }

  function spanRangeText(ws, a, b) {
    return (ws || []).slice(a, b + 1).map(function (w) { return w.text; }).join(' ');
  }

  function normalizeEmphases(ws, emphases, opts) {
    var n = (ws || []).length;
    if (!n) return [];
    var list = (emphases || []).map(function (e) {
      if (!e) return null;
      var s = Math.max(0, Math.min(n - 1, e.start));
      var d = Math.max(0, Math.min(n - 1, e.end));
      if (s > d) return null;
      var st = CYCLE.indexOf(e.style) >= 0 ? e.style : 'gold';
      if (st === 'script' && !okScript(opts, spanRangeText(ws, s, d))) st = 'gold';
      return { start: s, end: d, style: st };
    }).filter(Boolean).sort(function (a, b) { return a.start - b.start || a.end - b.end; });

    var out = [];
    for (var i = 0; i < list.length; i++) {
      var cur = list[i];
      var last = out[out.length - 1];
      if (!last) { out.push(cur); continue; }
      if (cur.start <= last.end) {
        if (cur.style === last.style) last.end = Math.max(last.end, cur.end);
        else cur.start = last.end + 1;
        if (cur.start <= cur.end && cur.start > last.end) out.push(cur);
      } else if (cur.start === last.end + 1 && cur.style === last.style) {
        last.end = cur.end;
      } else {
        out.push(cur);
      }
    }
    return out;
  }

  function syncGroup(g, opts) {
    if (!g) return g;
    if (!Array.isArray(g.emphases)) {
      g.emphases = g.span ? [{ start: g.span[0], end: g.span[1], style: g.style || 'gold' }] : [];
    }
    g.emphases = normalizeEmphases(g.words, g.emphases, opts);
    var p = g.emphases[0] || null;
    g.span = p ? [p.start, p.end] : null;
    g.style = p ? p.style : null;
    return g;
  }

  function styleAtIndex(emphases, idx) {
    for (var i = 0; i < emphases.length; i++) {
      if (idx >= emphases[i].start && idx <= emphases[i].end) return emphases[i].style;
    }
    return 'base';
  }

  /* ---------- 4. Ngắt dòng (hỗ trợ 1 hoặc nhiều dạng nhấn trong cùng 1 cụm) ---------- */
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
      var d = Math.abs(chars(ws.slice(0, k)) - chars(ws.slice(k))) + (o && tight(ws[k - 1], ws[k], o, ws[k + 1]) ? 8 : 0);
      if (d < bestD) { bestD = d; bestK = k; }
    }
    return [ws.slice(0, bestK), ws.slice(bestK)];
  }

  function mapLineWords(ws, wordsSlice, emphases) {
    return wordsSlice.map(function (w) {
      var idx = ws.indexOf(w);
      return { i: idx, text: w.text, start: w.start, end: w.end, style: styleAtIndex(emphases, idx) };
    });
  }

  function uniformLineStyle(words) {
    if (!words || !words.length) return 'base';
    var st = words[0].style || 'base';
    for (var i = 1; i < words.length; i++) if ((words[i].style || 'base') !== st) return 'base';
    return st;
  }

  function layoutLines(ws, emphasesOrSpan, styleOrOpts, maybeOpts) {
    var o = maybeOpts;
    var emphases;
    if (Array.isArray(emphasesOrSpan)) {
      o = o || styleOrOpts || DEFAULTS;
      emphases = normalizeEmphases(ws, emphasesOrSpan, o);
    } else if (emphasesOrSpan && typeof emphasesOrSpan[0] === 'number') {
      o = o || DEFAULTS;
      var sStyle = typeof styleOrOpts === 'string' ? styleOrOpts : 'blue';
      emphases = normalizeEmphases(ws, [{ start: emphasesOrSpan[0], end: emphasesOrSpan[1], style: sStyle }], o);
    } else {
      o = o || styleOrOpts || DEFAULTS;
      emphases = [];
    }

    var rawLines = [];
    if (emphases.length === 0) {
      balancedLines(ws, o.lineChars, o).forEach(function (l) { rawLines.push({ style: 'base', words: l }); });
    } else if (emphases.length === 1) {
      var sp = emphases[0];
      var before = ws.slice(0, sp.start), em = ws.slice(sp.start, sp.end + 1), after = ws.slice(sp.end + 1);
      var lc = Math.round(o.lineChars * 1.2);
      balancedLines(before, lc, o).forEach(function (l) { rawLines.push({ style: 'base', words: l }); });
      rawLines.push({ style: sp.style, words: em });
      balancedLines(after, lc, o).forEach(function (l) { rawLines.push({ style: 'base', words: l }); });
      while (rawLines.length > o.maxLines) {
        var bi = -1, bc = Infinity;
        for (var i = 0; i < rawLines.length - 1; i++) {
          if (rawLines[i].style !== 'base' || rawLines[i + 1].style !== 'base') continue;
          var c = chars(rawLines[i].words.concat(rawLines[i + 1].words));
          if (c < bc) { bc = c; bi = i; }
        }
        if (bi < 0) break;
        rawLines.splice(bi, 2, { style: 'base', words: rawLines[bi].words.concat(rawLines[bi + 1].words) });
      }
    } else {
      // Nhiều vùng nhấn: tách thành các dải style liên tiếp, rồi gộp thông minh để không vượt maxLines (mỗi từ giữ style riêng)
      var runs = [];
      for (var wi = 0; wi < ws.length; wi++) {
        var wSt = styleAtIndex(emphases, wi);
        var lastRun = runs[runs.length - 1];
        if (lastRun && lastRun.style === wSt) lastRun.words.push(ws[wi]);
        else runs.push({ style: wSt, words: [ws[wi]] });
      }
      var maxRunChars = Math.round(o.lineChars * 1.45);
      runs.forEach(function (r) {
        if (r.style === 'base' && chars(r.words) > maxRunChars) {
          balancedLines(r.words, o.lineChars, o).forEach(function (l) { rawLines.push({ style: 'base', words: l }); });
        } else {
          rawLines.push(r);
        }
      });
      while (rawLines.length > o.maxLines) {
        var bestIdx = 0, bestCost = Infinity;
        for (var k = 0; k < rawLines.length - 1; k++) {
          var A = rawLines[k], B = rawLines[k + 1];
          var mergedChars = chars(A.words.concat(B.words));
          var penalty = mergedChars;
          if (A.style === 'script' || B.style === 'script') penalty += 22;
          if (A.style !== 'base' && B.style !== 'base' && mergedChars > o.lineChars * 1.35) penalty += 14;
          if (mergedChars > o.lineChars * 1.75) penalty += 30;
          if (penalty < bestCost) { bestCost = penalty; bestIdx = k; }
        }
        var mWords = rawLines[bestIdx].words.concat(rawLines[bestIdx + 1].words);
        rawLines.splice(bestIdx, 2, { style: 'mixed', words: mWords });
      }
    }

    return rawLines.map(function (l) {
      var mapped = mapLineWords(ws, l.words, emphases);
      return { style: uniformLineStyle(mapped), words: mapped };
    });
  }

  /* ---------- API ---------- */
  function pickStyle(text, counter, o) {
    if (counter % 2 === 0) return (okScript(o, text) && norm(text).length <= 12) ? 'script' : 'gold';
    return 'blue';
  }
  function spanText(group) {
    return group.span ? spanRangeText(group.words, group.span[0], group.span[1]) : '';
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
      var style = span ? pickStyle(spanRangeText(ws, span[0], span[1]), counter++, o) : null;
      var emphases = span ? [{ start: span[0], end: span[1], style: style }] : [];
      var g = {
        id: 'g' + gi,
        start: 0,
        end: 0,
        words: ws.map(function (w) { return { text: w.text, start: w.start, end: w.end, rms: w.rms }; }),
        emphases: emphases,
        span: span,
        style: style,
        lines: null
      };
      return relayout(g, o);
    });
    return retime(groups, 0, groups.length - 1, o);
  }

  function relayout(group, opts) {
    var o = merge(DEFAULTS, opts);
    syncGroup(group, opts);
    group.lines = layoutLines(group.words, group.emphases, o);
    return group;
  }

  function pickBrushForPhrase(group, start, end, preferredStyle, opts) {
    if (preferredStyle && CYCLE.indexOf(preferredStyle) >= 0) {
      if (preferredStyle === 'script' && !okScript(opts, spanRangeText(group.words, start, end))) return 'gold';
      return preferredStyle;
    }
    var used = {};
    (group.emphases || []).forEach(function (e) { used[e.style] = true; });
    var phrase = spanRangeText(group.words, start, end);
    var cand = okScript(opts, phrase) ? ['script', 'gold', 'blue'] : ['gold', 'blue'];
    for (var i = 0; i < cand.length; i++) if (!used[cand[i]]) return cand[i];
    return cand[group.emphases.length % cand.length];
  }

  /** Áp dụng kiểu nhấn ('script'|'gold'|'blue'|'auto'|'none') lên dải từ [from..to] mà vẫn giữ các vùng nhấn khác. */
  function applySpan(group, from, to, style, opts) {
    syncGroup(group, opts);
    var n = (group.words || []).length;
    if (!n) return group;
    var a = Math.max(0, Math.min(from, to));
    var b = Math.min(n - 1, Math.max(from, to));
    var next = [];
    group.emphases.forEach(function (e) {
      if (e.end < a || e.start > b) {
        next.push({ start: e.start, end: e.end, style: e.style });
        return;
      }
      if (e.start < a) next.push({ start: e.start, end: a - 1, style: e.style });
      if (e.end > b) next.push({ start: b + 1, end: e.end, style: e.style });
    });
    if (style !== 'none') {
      var st = pickBrushForPhrase(group, a, b, style, opts);
      next.push({ start: a, end: b, style: st });
    }
    group.emphases = next;
    return relayout(group, opts);
  }

  /** Bấm 1 từ: bật/tắt nhấn hoặc sơn kiểu brushStyle; Shift+bấm để nối thành cụm từ dài. */
  function toggleWord(group, idx, extend, opts, brushStyle) {
    syncGroup(group, opts);
    var ems = group.emphases;
    if (extend && ems.length) {
      var nearest = ems[0], bestD = Infinity;
      ems.forEach(function (e) {
        var d = idx < e.start ? e.start - idx : (idx > e.end ? idx - e.end : 0);
        if (d < bestD) { bestD = d; nearest = e; }
      });
      var effStyle = (brushStyle && brushStyle !== 'auto' && brushStyle !== 'none') ? brushStyle : nearest.style;
      return applySpan(group, Math.min(nearest.start, idx), Math.max(nearest.end, idx), effStyle, opts);
    }
    if (brushStyle === 'none') return applySpan(group, idx, idx, 'none', opts);

    var hit = null;
    for (var i = 0; i < ems.length; i++) {
      if (idx >= ems[i].start && idx <= ems[i].end) { hit = ems[i]; break; }
    }
    if (brushStyle && brushStyle !== 'auto') {
      var target = (brushStyle === 'script' && !okScript(opts, group.words[idx].text)) ? 'gold' : brushStyle;
      if (hit && hit.style === target) return applySpan(group, idx, idx, 'none', opts);
      return applySpan(group, idx, idx, target, opts);
    }
    if (hit) return applySpan(group, idx, idx, 'none', opts);
    return applySpan(group, idx, idx, 'auto', opts);
  }

  function cycleStyle(group, opts, spanIdx) {
    syncGroup(group, opts);
    if (!group.emphases.length) return group;
    var i = (spanIdx >= 0 && spanIdx < group.emphases.length) ? spanIdx : 0;
    var sp = group.emphases[i];
    sp.style = nextStyle(sp.style, spanRangeText(group.words, sp.start, sp.end), opts);
    return relayout(group, opts);
  }

  function removeSpan(group, opts, spanIdx) {
    syncGroup(group, opts);
    if (!group.emphases.length) return group;
    var i = (spanIdx >= 0 && spanIdx < group.emphases.length) ? spanIdx : 0;
    group.emphases.splice(i, 1);
    return relayout(group, opts);
  }

  /* ---------- Tách / Gộp cụm & tách từ sau khi nhận dạng ---------- */
  var uidSeq = 0;
  function newGroupId() { uidSeq++; return 'g' + Date.now().toString(36) + '_' + uidSeq; }
  function copyCustom(c) { return c ? JSON.parse(JSON.stringify(c)) : undefined; }
  function sliceEmphases(emphases, from, to, shift) {
    var out = [];
    (emphases || []).forEach(function (e) {
      var s0 = Math.max(e.start, from), s1 = Math.min(e.end, to - 1);
      if (s0 <= s1) out.push({ start: s0 - from + (shift || 0), end: s1 - from + (shift || 0), style: e.style });
    });
    return out;
  }

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
      var hardCap = (next && next.words && next.words.length) ? Math.max(start + 0.08, next.words[0].start - o.lead - 0.01) : Infinity;
      var end = Math.min(lastEnd + o.hold, hardCap);
      g.start = start;
      g.end = Math.max(g.start + 0.08, end);
    }
    return groups;
  }

  function splitGroup(groups, gi, at, opts) {
    var g = groups[gi];
    if (!g || !g.words || at <= 0 || at >= g.words.length) return null;
    syncGroup(g, opts);
    var n = g.words.length;
    var a = merge(g, { words: g.words.slice(0, at), emphases: sliceEmphases(g.emphases, 0, at, 0), custom: copyCustom(g.custom) });
    var b = merge(g, { id: newGroupId(), words: g.words.slice(at), emphases: sliceEmphases(g.emphases, at, n, 0), custom: copyCustom(g.custom) });
    if (a.custom === undefined) delete a.custom;
    if (b.custom === undefined) delete b.custom;
    groups.splice(gi, 1, a, b);
    relayout(a, opts);
    relayout(b, opts);
    retime(groups, 0, groups.length - 1, opts);
    return [a, b];
  }

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

  function mergeGroups(groups, gi, opts) {
    var g = groups[gi], h = groups[gi + 1];
    if (!g || !h) return null;
    syncGroup(g, opts);
    syncGroup(h, opts);
    var off = g.words.length;
    var ems = g.emphases.map(function (e) { return { start: e.start, end: e.end, style: e.style }; })
      .concat(sliceEmphases(h.emphases, 0, h.words.length, off));
    var m = merge(g, { words: g.words.concat(h.words), emphases: ems });
    groups.splice(gi, 2, m);
    relayout(m, opts);
    retime(groups, 0, groups.length - 1, opts);
    return m;
  }

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

  var STYLE_ID = { base: 1, script: 2, blue: 3, gold: 4 };
  function toMogrtItems(groups) {
    return groups.map(function (g) {
      var lines = g.lines.slice(0, 3);
      if (g.lines.length > 3) {
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
    DEFAULTS: DEFAULTS, buildLayout: buildLayout, relayout: relayout,
    applySpan: applySpan, toggleWord: toggleWord, cycleStyle: cycleStyle, removeSpan: removeSpan, syncGroup: syncGroup,
    isStop: isStop, splitPhrases: splitPhrases, layoutLines: layoutLines, toMogrtItems: toMogrtItems,
    scriptOK: scriptOK, STYLE_ID: STYLE_ID,
    splitGroup: splitGroup, splitAtTime: splitAtTime, mergeGroups: mergeGroups,
    splitWordTiming: splitWordTiming, retime: retime
  };
});
