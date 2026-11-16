/*
 * Chuyển các cụm chữ (core/layout.js) thành đoạn chữ CapCut, cùng thiết kế với template Premiere:
 * khối chữ quanh 72% chiều cao, mỗi dòng ≤ 82% bề ngang, cụm 3 dòng xếp so le,
 * bóng đổ cho mọi dòng, từ nhấn có màu + phát sáng, chữ hiện theo lời nói (animation "Hiện sang phải"). (Node)
 *
 * Hiệu chỉnh trên CapCut 9.4/9.7 (khung 1080x1920):
 *   - toạ độ x,y chuẩn hoá theo nửa khung, y hướng lên, neo ở tâm chữ
 *   - 1 đơn vị cỡ chữ ≈ min(W,H)/216 px
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
    desc: 'Oswald + Anton + Dancing',
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
  }
];
const OVERLAP = 0.14;   // dòng sau chồng lên dòng trước (theo cỡ chữ dòng sau), như bản Premiere
const REVEAL_TAIL = 0.25;

const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * Kiểu chữ thực dùng = mặc định + tuỳ chỉnh của người dùng (o.styles[style] = { font: đường dẫn file, color: [r,g,b] }).
 * Hệ số "ink" áp cho các font viết tay có nét vươn ra ngoài bề ngang ký tự.
 */
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

/** Đường dẫn font: ưu tiên bản đã cài cho user (ổn định khi cập nhật app), sau đó thư mục fonts kèm app. */
function fontPath(file, appFontsDir) {
  const user = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts', file);
  if (fs.existsSync(user)) return user;
  return path.join(appFontsDir, file);
}

/**
 * @param groups  kết quả Layout.buildLayout
 * @param o { width, height, fontsDir, yPos=0.72, maxWidth=0.82, scale=1, shadow=true, glow=true }
 * @returns đoạn chữ cho capcut.addTextTrack
 */
function buildSegments(groups, o) {
  o = Object.assign({ width: 1080, height: 1920, yPos: 0.72, maxWidth: 0.82, scale: 1, shadow: true, glow: true }, o);
  const W = o.width, H = o.height;
  const unitPx = Math.min(W, H) / 216;
  const maxW = W * o.maxWidth;
  const segs = [];

  groups.forEach((g, gi) => {
    // Tuỳ chỉnh riêng của cụm (như thuộc tính của 1 clip MOGRT) đè lên mặc định.
    const go = groupOpts(o, g, gi);
    // 1. Cỡ chữ từng dòng (co lại nếu vượt khung an toàn).
    const lines = g.lines.map((ln) => {
      const st = styleOf(ln.style, go);
      const file = st.font || fontPath(st.file, o.fontsDir);
      const text = ln.words.map((w) => w.text).join(' ');
      let px = st.px * go.scale;
      const w = ttf.measure(file, text, px) * (st.ink || 1);
      if (w > maxW) px *= maxW / w;
      return { st, file, text, px, w: Math.min(w, maxW), h: px * st.lh, words: ln.words, style: ln.style };
    });

    // 2. Xếp dọc: các dòng chồng nhẹ, cả khối căn giữa quanh yPos.
    let y = 0;
    lines.forEach((l, i) => { if (i > 0) y -= OVERLAP * l.px; l.top = y; y += l.h; });
    const total = y, top = H * go.yPos - total / 2;
    const anim = ANIMS[go.anim] || ANIMS.fade;
    const bw = Math.max(...lines.map((l) => l.w));

    // 3. Mỗi TỪ là 1 đoạn riêng, đặt đúng vị trí trong dòng; hiện đúng lúc được nói bằng keyframe ease.
    let wordIdx = 0;
    lines.forEach((l, i) => {
      const cy = top + l.top + l.h / 2;
      let cx = W / 2;
      if (lines.length === 3 && i === 0) cx -= (bw - l.w) / 2;          // dòng đầu canh trái khối
      if (lines.length === 3 && i === 2) cx += (bw - l.w) / 2;          // dòng cuối canh phải khối
      const adv = ttf.measure(l.file, l.text, l.px);
      const left = cx - adv / 2;
      const yN = -(cy - H / 2) / (H / 2);
      const end = g.end;
      l.words.forEach((w, k) => {
        const prefix = l.words.slice(0, k).map((x) => x.text).join(' ') + (k ? ' ' : '');
        const wx = left + ttf.measure(l.file, prefix, l.px) + ttf.measure(l.file, w.text, l.px) / 2;
        const xN = (wx - W / 2) / (W / 2);
        const start = Math.max(g.start, w.start - LEAD);
        segs.push({
          group: g.id,
          animName: go.anim,
          style: l.style,
          lane: 'W' + (++wordIdx),
          text: w.text,
          font: l.file,
          size: +(l.px / unitPx).toFixed(2),
          color: l.st.color,
          start, end: Math.max(start + 0.2, end),
          x: +xN.toFixed(4),
          y: +yN.toFixed(4),
          shadow: o.shadow,
          glow: o.glow && l.st.glow ? Object.assign({ color: l.st.glow }, GLOW) : null,
          anim: null,
          fadeOut: true, fps: o.fps, inDur: anim.dur,
          keyframes: anim.kf({ x: xN, y: yN, W, H, fps: o.fps || 30, px: l.px })
        });
      });
    });
  });
  return noOverlap(segs);
}

/* ---- Hiệu ứng hiện chữ bằng keyframe ---- */
const LEAD = 0.04;          // hiện sớm hơn tiếng nói một chút
const IN_DUR = 0.32;        // thời gian hiện 1 từ (giây)
const OUT_DUR = 0.15;       // thời gian mờ dần khi cụm kết thúc
const SLIDE_PX = 22;        // trượt nhẹ từ trái sang (px trên khung 1080)
const GLOW = { strength: 0.08, range: 0.08 };  // phát sáng rất nhẹ, không loá

/* Đường cong (t: 0 -> 1). */
const EASE = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (s) => (t) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),   // vượt quá đích rồi về (nảy)
  outElastic: (t) => t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
};

/** Lấy mẫu đường cong thành keyframe dày (mỗi khung hình 1 điểm) -> CapCut nội suy thẳng giữa các điểm vẫn mượt. */
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

/*
 * Các kiểu hiện chữ (tham khảo clip "text animation"). Toạ độ CapCut: x, y chuẩn hoá theo nửa khung, y hướng lên.
 * CapCut không có keyframe làm nhoè -> mô phỏng bằng độ mờ + vị trí + tỉ lệ với đường cong phù hợp.
 */
const ANIMS = {
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

/** Chế độ "Tự động": cụm có từ nhấn dùng kiểu mạnh, cụm thường dùng kiểu nhẹ, xen kẽ để không đơn điệu. */
const AUTO_STRONG = ['pop', 'elastic', 'drop', 'slam', 'whip', 'pulse'];
const AUTO_SOFT = ['fade', 'float', 'rise', 'wave'];
function autoAnim(g, gi) {
  return g.span ? AUTO_STRONG[gi % AUTO_STRONG.length] : AUTO_SOFT[gi % AUTO_SOFT.length];
}

/**
 * Thuộc tính thực của 1 cụm = mặc định (o) + tuỳ chỉnh riêng g.custom:
 *   { styles: { base: {font, color}, ... }, scale, yPos, anim }
 */
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

/** CapCut tự đẩy đoạn chồng thời gian sang track mới -> cắt đuôi đoạn trước cho khít đoạn sau trên cùng lane. */
function noOverlap(segs) {
  const byLane = {};
  segs.forEach((s) => { (byLane[s.lane] = byLane[s.lane] || []).push(s); });
  const out = [];
  Object.keys(byLane).forEach((k) => {
    const list = byLane[k].sort((a, b) => a.start - b.start);
    list.forEach((s, i) => {
      const next = list[i + 1];
      if (next && s.end > next.start - 0.002) s.end = next.start - 0.002;
      if (s.end - s.start < 0.1) return;                       // quá ngắn để hiện -> bỏ
      if (s.anim) s.anim.duration = Math.min(s.anim.duration, s.end - s.start);
      if (s.keyframes) {
        // Từ hiện quá ngắn so với animation -> co animation cho vừa (85% thời gian hiện) thay vì cắt cụt giữa chừng.
        const maxT = Math.max(0, ...Object.values(s.keyframes).map((ks) => (ks.length ? ks[ks.length - 1][0] : 0)));
        const room = (s.end - s.start) * 0.85;
        const f = maxT > room ? room / maxT : 1;
        Object.keys(s.keyframes).forEach((k) => { s.keyframes[k] = s.keyframes[k].map(([t, v]) => [t * f, v]); });
        if (s.inDur) s.inDur *= f;
      }
      // Mờ dần khi cụm kết thúc (ease in-out) thay vì tắt đột ngột.
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

/** Phụ đề thường (chức năng 1) ở đáy khung, 1 lane riêng. */
function buildCaptionSegments(cues, o) {
  o = Object.assign({ width: 1080, height: 1920, yPos: 0.86, px: 46 }, o);
  const unitPx = Math.min(o.width, o.height) / 216;
  const file = styleOf('base', o).font || fontPath(STYLE.base.file, o.fontsDir);
  return noOverlap(cues.map((c) => {
    let px = o.px;
    const w = ttf.measure(file, c.text, px);
    if (w > o.width * 0.9) px *= (o.width * 0.9) / w;
    return {
      lane: 'Sub', text: c.text, font: file, size: +(px / unitPx).toFixed(2), color: [1, 1, 1],
      start: c.start, end: c.end, x: 0, y: +(-(o.height * o.yPos - o.height / 2) / (o.height / 2)).toFixed(4),
      shadow: true, glow: null, anim: null
    };
  }));
}

module.exports = { buildSegments, buildCaptionSegments, easeKeys, styleOf, groupOpts, ANIMS, ANIM_LIST, STYLE, PRESETS, fontPath };
