/*
 * Chuyển các cụm chữ (core/layout.js) hoặc phụ đề ngang (core/srt.js) thành đoạn chữ CapCut.
 *
 * Hiệu chỉnh trên CapCut 9.4/9.7/9.8:
 *   - toạ độ x,y chuẩn hoá theo nửa khung, y hướng lên, neo ở tâm chữ
 *   - 1 đơn vị cỡ chữ CapCut (font_size) = W / 216 px (tỉ lệ theo bề ngang canvas W, áp dụng chung 9:16, 4:3, 16:9, 1:1)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ttf = require('./ttf.js');

const STYLE = {
  base:   { file: 'Montserrat-Bold.ttf', px: 96, color: [0.961, 0.969, 0.988], lh: 0.96, glow: null },
  script: { file: 'DancingScript-Bold.ttf', px: 168, color: [0.965, 0.784, 0.373], lh: 0.86, ink: 1.12, glow: '#F6C85F' },
  blue:   { file: 'Montserrat-Black.ttf', px: 114, color: [0.220, 0.741, 0.973], lh: 0.96, glow: '#38BDF8' },
  gold:   { file: 'Montserrat-Black.ttf', px: 114, color: [0.984, 0.749, 0.141], lh: 0.96, glow: '#FBBF24' }
};

const PRESETS = [
  {
    id: 'luxury',
    name: 'Luxury Spa & Wellness',
    desc: 'Montserrat + Dancing Script',
    styles: {
      base:   { file: 'Montserrat-Bold.ttf', color: '#f5f7fa' },
      script: { file: 'DancingScript-Bold.ttf', color: '#f6c85f' },
      blue:   { file: 'Montserrat-Black.ttf', color: '#38bdf8' },
      gold:   { file: 'Montserrat-Black.ttf', color: '#fbbf24' }
    }
  },
  {
    id: 'cosmic',
    name: 'Cosmic Cyber Neon',
    desc: 'SVN-Gilroy + Blenda Script',
    styles: {
      base:   { file: 'SVN-Gilroy Bold.otf', color: '#eef3ff' },
      script: { file: 'SVN-Blenda Script.ttf', color: '#ff6b8b' },
      blue:   { file: 'SVN-Gilroy Heavy.otf', color: '#00e5ff' },
      gold:   { file: 'SVN-Gilroy Heavy.otf', color: '#ffe066' }
    }
  },
  {
    id: 'editorial',
    name: 'Editorial Magazine',
    desc: 'Quicksand + Bali + Abril',
    styles: {
      base:   { file: 'Quicksand-Bold.ttf', color: '#fffdf7' },
      script: { file: 'SVN-Bali Script.ttf', color: '#f4a261' },
      blue:   { file: 'Lora-BoldItalic.ttf', color: '#67e8f9' },
      gold:   { file: 'SVN-Abril Fatface.ttf', color: '#fde047' }
    }
  },
  {
    id: 'viral',
    name: 'Viral TikTok / Reels',
    desc: 'Oswald + Anton + Viền đen đậm',
    border: { color: '#000000', width: 0.08 },
    styles: {
      base:   { file: 'Oswald-Bold.ttf', color: '#ffffff' },
      script: { file: 'DancingScript-Bold.ttf', color: '#ff4d8d' },
      blue:   { file: 'Anton-Regular.ttf', color: '#22d3ee' },
      gold:   { file: 'Anton-Regular.ttf', color: '#facc15' }
    }
  },
  {
    id: 'classic',
    name: 'Classic Premiere',
    desc: 'Encode Sans + Romanesco',
    styles: {
      base:   { file: 'EncodeSansSemiExpanded-SemiBold.ttf', color: '#f3f3f3' },
      script: { file: 'Romanesco-Regular.ttf', color: '#f4c454' },
      blue:   { file: 'EncodeSansSemiExpanded-Black.ttf', color: '#36a9f0' },
      gold:   { file: 'EncodeSansSemiExpanded-Black.ttf', color: '#f4c454' }
    }
  },
  {
    id: 'netflix-cinema',
    name: 'Netflix Cinema Sub',
    desc: 'Trắng ngà sạch · Bóng đổ mềm chuẩn phim',
    movieDefault: true,
    shadow: { alpha: 0.78, distance: 4, smoothing: 0.72 },
    styles: {
      base:   { file: 'SVN-Gilroy Bold.otf', color: '#f5f5f0' },
      script: { file: 'Lora-BoldItalic.ttf', color: '#fde68a' },
      blue:   { file: 'Montserrat-Bold.ttf', color: '#bae6fd' },
      gold:   { file: 'Montserrat-Bold.ttf', color: '#fde68a' }
    }
  },
  {
    id: 'criterion-pill',
    name: 'Hộp Nền Tối (YouTube / DVD)',
    desc: 'Nền đen mờ bo góc · Dễ đọc trên mọi cảnh sáng',
    bg: { color: '#000000', alpha: 0.62, style: 1, round: 0.35 },
    styles: {
      base:   { file: 'EncodeSansSemiExpanded-SemiBold.ttf', color: '#ffffff' },
      script: { file: 'Lora-BoldItalic.ttf', color: '#fde047' },
      blue:   { file: 'EncodeSansSemiExpanded-Bold.ttf', color: '#7dd3fc' },
      gold:   { file: 'EncodeSansSemiExpanded-Bold.ttf', color: '#fde047' }
    }
  },
  {
    id: 'hormozi-punch',
    name: 'CapCut Viral Viền Đậm',
    desc: 'Viền đen dày + Vàng Neon (Alex Hormozi)',
    border: { color: '#000000', width: 0.11 },
    styles: {
      base:   { file: 'Montserrat-Black.ttf', color: '#ffffff' },
      script: { file: 'Anton-Regular.ttf', color: '#facc15' },
      blue:   { file: 'Montserrat-Black.ttf', color: '#00e5ff' },
      gold:   { file: 'Montserrat-Black.ttf', color: '#facc15' }
    }
  },
  {
    id: 'golden-cinema',
    name: 'Phim Điện Ảnh Vàng Cổ Điển',
    desc: 'Chữ vàng ấm + Viền mảnh (Hong Kong / Retro)',
    border: { color: '#000000', width: 0.065 },
    styles: {
      base:   { file: 'Montserrat-Bold.ttf', color: '#fde047' },
      script: { file: 'Lora-BoldItalic.ttf', color: '#fffbeb' },
      blue:   { file: 'Montserrat-Bold.ttf', color: '#fef08a' },
      gold:   { file: 'Montserrat-Black.ttf', color: '#facc15' }
    }
  }
];

const OVERLAP = 0.10;
const OVERLAP_BORDER = 0.06;
const LEAD = 0.04;
const IN_DUR = 0.32;
const OUT_DUR = 0.15;
const GLOW = { strength: 0.08, range: 0.08 };

/** 1 đơn vị font_size trong CapCut PC tương đương W / 216 px trên canvas. */
function capcutUnitPx(W) {
  return Math.max(1, W || 1080) / 216;
}
/** Tỉ lệ quy chiếu theo cạnh ngắn 1080 để giữ kích thước chữ nhất quán ở 720p/1080p/1440p/4K. */
function refScale(W, H) {
  return Math.min(W || 1080, H || 1920) / 1080;
}

const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

function styleOf(name, o) {
  const def = STYLE[name] || STYLE.base;
  const ov = (o.styles && o.styles[name]) || {};
  const st = Object.assign({}, def, ov.color ? { color: ov.color } : {});
  if (ov.font) {
    st.font = ov.font;
    st.ink = /romanesco|dancing|bali|blenda|script/i.test(path.basename(ov.font)) ? (def.ink || 1.12) : 1;
  }
  if (def.glow) st.glow = toHex(st.color);
  return st;
}

function fontPath(file, appFontsDir) {
  const user = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts', file);
  if (fs.existsSync(user)) return user;
  return path.join(appFontsDir, file);
}

function buildSegments(groups, o) {
  o = Object.assign({ width: 1080, height: 1920, yPos: 0.72, maxWidth: 0.82, scale: 1, shadow: true, glow: true }, o);
  const W = o.width, H = o.height;
  const unitPx = capcutUnitPx(W);
  const baseScale = refScale(W, H);
  const maxW = W * o.maxWidth;
  const segs = [];

  groups.forEach((g, gi) => {
    const go = groupOpts(o, g, gi);
    const strokeGapEm = go.border ? (go.border.width || 0.08) * 1.15 : 0;
    const extraGapEm = strokeGapEm + 0.025;
    const overlap = go.border ? OVERLAP_BORDER : OVERLAP;

    const lines = g.lines.map((ln) => {
      const st = styleOf(ln.style, go);
      const file = st.font || fontPath(st.file, o.fontsDir);
      const spaceEm = Math.max(0.24, ttf.measure(file, ' ', 1));
      const wordEm = ln.words.map((w) => ttf.measure(file, w.text, 1));
      const gapEm = spaceEm + extraGapEm;
      const totalEm = wordEm.reduce((acc, v) => acc + v, 0) + Math.max(0, ln.words.length - 1) * gapEm;
      let px = st.px * baseScale * go.scale;
      const estW = totalEm * px * (st.ink || 1);
      if (estW > maxW) px *= maxW / estW;
      const size = +(px / unitPx).toFixed(2);
      const exactPx = size * unitPx;
      const wordWidths = wordEm.map((em) => em * exactPx);
      const lineAdvW = totalEm * exactPx;
      return {
        st, file, text: ln.words.map((w) => w.text).join(' '),
        px: exactPx, size,
        w: Math.min(lineAdvW * (st.ink || 1), maxW),
        advW: lineAdvW,
        wordWidths,
        gapPx: gapEm * exactPx,
        h: exactPx * st.lh,
        words: ln.words,
        style: ln.style
      };
    });

    let y = 0;
    lines.forEach((l, i) => { if (i > 0) y -= overlap * l.px; l.top = y; y += l.h; });
    const total = y, top = H * go.yPos - total / 2;
    const anim = ANIMS[go.anim] || ANIMS.fade;
    const bw = Math.max(...lines.map((l) => l.w));

    let wordIdx = 0;
    lines.forEach((l, i) => {
      const cy = top + l.top + l.h / 2;
      let cx = W / 2;
      if (lines.length === 3 && i === 0) cx -= (bw - l.w) / 2;
      if (lines.length === 3 && i === 2) cx += (bw - l.w) / 2;
      let curX = cx - l.advW / 2;
      const yN = -(cy - H / 2) / (H / 2);
      const end = g.end;
      l.words.forEach((w, k) => {
        const wWidth = l.wordWidths[k];
        const wx = curX + wWidth / 2;
        curX += wWidth + l.gapPx;
        const xN = (wx - W / 2) / (W / 2);
        const start = Math.max(g.start, w.start - LEAD);
        segs.push({
          group: g.id,
          animName: go.anim,
          style: l.style,
          lane: 'W' + (++wordIdx),
          text: w.text,
          font: l.file,
          size: l.size,
          color: l.st.color,
          start, end: Math.max(start + 0.2, end),
          x: +xN.toFixed(4),
          y: +yN.toFixed(4),
          shadow: go.shadow,
          border: go.border || null,
          bg: go.bg || null,
          glow: o.glow && l.st.glow ? Object.assign({ color: l.st.glow }, GLOW) : null,
          anim: null,
          fadeOut: anim.dur > 0, fps: o.fps, inDur: anim.dur,
          keyframes: anim.kf({ x: xN, y: yN, W, H, fps: o.fps || 30, px: l.px })
        });
      });
    });
  });
  return noOverlap(segs);
}

const EASE = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (s) => (t) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outElastic: (t) => t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
};

function easeKeys(from, to, dur, fps, fn) {
  const f = fn || EASE.inOut;
  const n = Math.max(2, Math.round(dur * (fps || 30)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([t * dur, from + (to - from) * f(t)]);
  }
  return out;
}

const ANIMS = {
  none: {
    label: 'Cắt gọn (kiểu Phim)', dur: 0,
    kf: () => ({})
  },
  fade: {
    label: 'Mờ + trượt trái', dur: 0.32,
    kf: (c) => ({ alpha: easeKeys(0, 1, 0.32, c.fps), x: easeKeys(c.x - 22 / (c.W / 2), c.x, 0.32, c.fps) })
  },
  drop: {
    label: 'Rơi nảy', dur: 0.45,
    kf: (c) => ({
      alpha: easeKeys(0, 1, 0.12, c.fps, EASE.outCubic),
      y: easeKeys(c.y + (c.px * 0.9) / (c.H / 2), c.y, 0.45, c.fps, EASE.outBack(2.2))
    })
  },
  whip: {
    label: 'Trượt nhanh từ phải', dur: 0.38,
    kf: (c) => ({
      alpha: easeKeys(0, 1, 0.1, c.fps, EASE.outCubic),
      x: easeKeys(c.x + 260 / (c.W / 2), c.x, 0.38, c.fps, EASE.outBack(1.2))
    })
  },
  pop: {
    label: 'Bật phóng to', dur: 0.4,
    kf: (c) => ({ alpha: easeKeys(0, 1, 0.12, c.fps, EASE.outCubic), scale: easeKeys(0.35, 1, 0.4, c.fps, EASE.outBack(2.4)) })
  },
  slam: {
    label: 'Đập vào', dur: 0.3,
    kf: (c) => ({ alpha: easeKeys(0, 1, 0.1, c.fps, EASE.outCubic), scale: easeKeys(2.2, 1, 0.3, c.fps, EASE.outQuart) })
  },
  rise: {
    label: 'Trồi lên', dur: 0.4,
    kf: (c) => ({ alpha: easeKeys(0, 1, 0.3, c.fps, EASE.outCubic), y: easeKeys(c.y - (c.px * 0.6) / (c.H / 2), c.y, 0.4, c.fps, EASE.outCubic) })
  },
  elastic: {
    label: 'Nảy đàn hồi', dur: 0.52,
    kf: (c) => ({ alpha: easeKeys(0, 1, 0.12, c.fps, EASE.outCubic), scale: easeKeys(0.45, 1, 0.52, c.fps, EASE.outElastic) })
  },
  float: {
    label: 'Lướt êm Cinema', dur: 0.45,
    kf: (c) => ({
      alpha: easeKeys(0, 1, 0.32, c.fps, EASE.outCubic),
      scale: easeKeys(1.28, 1, 0.45, c.fps, EASE.outExpo),
      y: easeKeys(c.y - (c.px * 0.35) / (c.H / 2), c.y, 0.45, c.fps, EASE.outCubic)
    })
  },
  wave: {
    label: 'Lượn sóng', dur: 0.42,
    kf: (c) => ({
      alpha: easeKeys(0, 1, 0.16, c.fps, EASE.outCubic),
      x: easeKeys(c.x - 80 / (c.W / 2), c.x, 0.42, c.fps, EASE.outBack(1.4)),
      y: easeKeys(c.y - (c.px * 0.5) / (c.H / 2), c.y, 0.42, c.fps, EASE.outBack(1.8))
    })
  },
  pulse: {
    label: 'Nháy Neon', dur: 0.38,
    kf: (c) => ({
      alpha: [[0, 0], [0.06, 0.95], [0.12, 0.25], [0.19, 1], [0.38, 1]],
      scale: easeKeys(0.75, 1, 0.38, c.fps, EASE.outBack(2.0))
    })
  }
};
const ANIM_LIST = [{ id: 'auto', label: 'Tự động (đa dạng)' }].concat(Object.keys(ANIMS).map((id) => ({ id, label: ANIMS[id].label })));

const AUTO_STRONG = ['pop', 'elastic', 'drop', 'slam', 'whip', 'pulse'];
const AUTO_SOFT = ['fade', 'float', 'rise', 'wave'];
function autoAnim(g, gi) {
  return g.span ? AUTO_STRONG[gi % AUTO_STRONG.length] : AUTO_SOFT[gi % AUTO_SOFT.length];
}

function groupOpts(o, g, gi) {
  const c = g.custom || {};
  const styles = {};
  Object.keys(Object.assign({}, o.styles || {}, c.styles || {})).forEach((k) => {
    styles[k] = Object.assign({}, (o.styles || {})[k], (c.styles || {})[k]);
  });
  let anim = c.anim || o.anim || 'fade';
  if (anim === 'auto') anim = autoAnim(g, gi);
  return Object.assign({}, o, {
    styles,
    scale: c.scale || o.scale || 1,
    yPos: c.yPos || o.yPos,
    anim
  });
}

function noOverlap(segs) {
  const byLane = {};
  segs.forEach((s) => { (byLane[s.lane] = byLane[s.lane] || []).push(s); });
  const out = [];
  Object.keys(byLane).forEach((k) => {
    const list = byLane[k].sort((a, b) => a.start - b.start);
    list.forEach((s, i) => {
      const next = list[i + 1];
      if (next && s.end > next.start - 0.002) s.end = next.start - 0.002;
      if (s.end - s.start < 0.1) return;
      if (s.anim) s.anim.duration = Math.min(s.anim.duration, s.end - s.start);
      if (s.keyframes) {
        const maxT = Math.max(0, ...Object.values(s.keyframes).map((ks) => (ks.length ? ks[ks.length - 1][0] : 0)));
        const room = (s.end - s.start) * 0.85;
        const f = maxT > room ? room / maxT : 1;
        Object.keys(s.keyframes).forEach((k) => { s.keyframes[k] = s.keyframes[k].map(([t, v]) => [t * f, v]); });
        if (s.inDur) s.inDur *= f;
      }
      const d = s.end - s.start;
      if (s.fadeOut && s.keyframes && s.keyframes.alpha && d > (s.inDur || IN_DUR) + OUT_DUR + 0.02) {
        s.keyframes.alpha = s.keyframes.alpha.concat(easeKeys(1, 0, OUT_DUR, s.fps).map(([t, v]) => [d - OUT_DUR + t, v]));
      }
      delete s.fadeOut; delete s.fps; delete s.inDur;
      out.push(s);
    });
  });
  return out.sort((a, b) => a.start - b.start);
}

/** Chế độ Sub Phim Ngang: 1 cue = 1 khối phụ đề ngang căn giữa, hỗ trợ 1-2 dòng, viền & hộp nền kiểu phim/Netflix. */
function buildMovieSegments(cues, o) {
  o = Object.assign({ width: 1080, height: 1920, yPos: 0.86, scale: 1, shadow: true, anim: 'none', fps: 30 }, o);
  const W = o.width, H = o.height;
  const unitPx = capcutUnitPx(W);
  const baseScale = refScale(W, H);
  const st = styleOf('base', o);
  const file = st.font || fontPath(STYLE.base.file, o.fontsDir);
  const basePx = (W > H ? 52 : 48) * baseScale * (o.scale || 1);
  const maxW = W * 0.86;
  const safeMaxW = maxW * 0.96;
  const yN = +(-(H * o.yPos - H / 2) / (H / 2)).toFixed(4);
  const animKind = o.movieAnim || (o.anim === 'none' || o.anim === 'fade' || o.anim === 'rise' || o.anim === 'float' ? o.anim : 'none');

  return noOverlap((cues || []).map((c) => {
    const rawLines = String(c.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const text = rawLines.join('\n');
    let px = basePx;
    rawLines.forEach((ln) => {
      const w = ttf.measure(file, ln, px);
      if (w > safeMaxW) px = Math.min(px, px * (safeMaxW / w));
    });
    const dur = Math.max(0.2, c.end - c.start);
    let keyframes = null;
    if (animKind === 'fade') {
      const fd = Math.min(0.22, dur * 0.3);
      keyframes = { alpha: easeKeys(0, 1, fd, o.fps, EASE.outCubic) };
    } else if (animKind === 'rise' || animKind === 'float') {
      const fd = Math.min(0.28, dur * 0.35);
      keyframes = {
        alpha: easeKeys(0, 1, fd, o.fps, EASE.outCubic),
        y: easeKeys(yN - (px * 0.35) / (H / 2), yN, fd, o.fps, EASE.outCubic)
      };
    }
    return {
      lane: 'MovieSub',
      isMovieSub: true,
      text,
      font: file,
      size: +(px / unitPx).toFixed(2),
      color: st.color,
      start: c.start,
      end: c.end,
      x: 0,
      y: yN,
      lineMaxWidth: 0.86,
      shadow: o.shadow !== false ? (typeof o.shadow === 'object' ? o.shadow : true) : false,
      border: o.border || null,
      bg: o.bg || null,
      glow: null,
      anim: null,
      fadeOut: animKind !== 'none',
      fps: o.fps,
      inDur: 0.2,
      keyframes
    };
  }));
}

/** Phụ đề thường (tùy chọn phụ đi kèm ở đáy khung). */
function buildCaptionSegments(cues, o) {
  o = Object.assign({ width: 1080, height: 1920, yPos: 0.86, px: 46 }, o);
  const unitPx = capcutUnitPx(o.width);
  const baseScale = refScale(o.width, o.height);
  const file = styleOf('base', o).font || fontPath(STYLE.base.file, o.fontsDir);
  return noOverlap(cues.map((c) => {
    let px = o.px * baseScale;
    const w = ttf.measure(file, c.text, px);
    if (w > o.width * 0.9) px *= (o.width * 0.9) / w;
    return {
      lane: 'Sub', text: c.text, font: file, size: +(px / unitPx).toFixed(2), color: [1, 1, 1],
      start: c.start, end: c.end, x: 0, y: +(-(o.height * o.yPos - o.height / 2) / (o.height / 2)).toFixed(4),
      shadow: true, glow: null, anim: null
    };
  }));
}

module.exports = {
  buildSegments,
  buildMovieSegments,
  buildCaptionSegments,
  capcutUnitPx,
  refScale,
  easeKeys,
  styleOf,
  groupOpts,
  ANIMS,
  ANIM_LIST,
  STYLE,
  PRESETS,
  fontPath
};
