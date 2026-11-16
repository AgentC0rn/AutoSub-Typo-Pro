/*
 * Đọc / ghi draft CapCut PC (hỗ trợ đa thư mục gốc, CapCut 9.x nested Timelines,
 * và bộ phân tích Âm thanh tổng kết hợp Cách A + Cách B).
 * Nguyên tắc an toàn: luôn ghi vào BẢN SAO project (cloneDraft) và yêu cầu CapCut đã đóng. (Node)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SAMPLES = path.join(__dirname, '..', 'capcut', 'samples');
const US = 1e6; // CapCut tính thời gian bằng micro giây

const fwd = (p) => p.replace(/\\/g, '/');
const uuid = () => crypto.randomUUID().toUpperCase();
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o), 'utf8');
const sample = (name) => readJson(path.join(SAMPLES, name + '.json'));

function defaultDraftsRoot() {
  return path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'
  );
}

function readCapcutRcRoot() {
  try {
    const rcPath = path.join(os.homedir(), '.capcutrc');
    if (fs.existsSync(rcPath)) {
      const rc = readJson(rcPath);
      if (rc && typeof rc.drafts === 'string' && rc.drafts.trim()) {
        return path.normalize(rc.drafts.trim());
      }
    }
  } catch (e) {}
  return null;
}

function readCapcutRegistryRoots() {
  if (process.platform !== 'win32') return [];
  const found = [];
  try {
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Bytedance\\CapCut\\GlobalSettings\\History'], {
      encoding: 'utf8', windowsHide: true, timeout: 2500
    });
    if (r.status === 0 && r.stdout) {
      for (const line of r.stdout.split(/\r?\n/)) {
        const m = line.match(/^\s*(?:currentCustomDraftPath|oldCustomDraftPathList)\s+REG_\w+\s+(.+)$/i);
        if (!m) continue;
        for (const p of m[1].split('\\0')) {
          const clean = p.trim();
          if (clean) found.push(path.normalize(clean));
        }
      }
    }
  } catch (e) {}
  return found;
}

/** Danh sách thư mục gốc chứa CapCut Drafts (ưu tiên customRoot -> .capcutrc -> Registry CapCut -> mặc định Windows). */
function draftsRoots(customRoot) {
  const candidates = [customRoot, readCapcutRcRoot(), ...readCapcutRegistryRoots(), defaultDraftsRoot()].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const dir of candidates) {
    try {
      const resolved = path.resolve(dir);
      const key = resolved.toLowerCase();
      if (!seen.has(key) && fs.existsSync(resolved)) {
        seen.add(key);
        out.push(resolved);
      }
    } catch (e) {}
  }
  return out;
}

function draftsRoot(customRoot) {
  const roots = draftsRoots(customRoot);
  return roots[0] || defaultDraftsRoot();
}

function isCapCutRunning() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq CapCut.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
  return /CapCut\.exe/i.test(r.stdout || '');
}

/**
 * Các file draft_content.json cần đọc/ghi: CapCut 9 có nhiều timeline — trình phát đọc
 * Timelines/<main_timeline_id>/draft_content.json; file ở gốc là bản của timeline chính.
 */
function mainTimelineId(dir) {
  const pj = path.join(dir, 'Timelines', 'project.json');
  if (!fs.existsSync(pj)) return null;
  try { return readJson(pj).main_timeline_id || null; } catch (e) { return null; }
}

/**
 * timelineId (tuỳ chọn): timeline cần đọc/ghi. Bỏ trống hoặc = timeline chính → file của timeline chính
 * + bản sao ở gốc. Timeline phụ → chỉ Timelines/<id>/draft_content.json.
 */
function contentFiles(dir, timelineId) {
  const files = [];
  const main = mainTimelineId(dir);
  if (timelineId && timelineId !== main) {
    const f = path.join(dir, 'Timelines', timelineId, 'draft_content.json');
    return fs.existsSync(f) ? [f] : [];
  }
  if (main) {
    const f = path.join(dir, 'Timelines', main, 'draft_content.json');
    if (fs.existsSync(f)) files.push(f);
  }
  const rootContent = path.join(dir, 'draft_content.json');
  if (fs.existsSync(rootContent)) files.push(rootContent);
  return files;
}

/** Số timeline (chưa bị xoá) trong project — chỉ đọc project.json nên rất nhanh. */
function timelineCount(dir) {
  const pj = path.join(dir, 'Timelines', 'project.json');
  if (!fs.existsSync(pj)) return 1;
  try {
    const n = (readJson(pj).timelines || []).filter((t) => t && t.id && !t.is_marked_delete).length;
    return Math.max(1, n);
  } catch (e) { return 1; }
}

/**
 * Danh sách timeline của project (CapCut 9.x: Timelines/project.json).
 * withStats=true: đọc thêm thời lượng, khung hình, số track của từng timeline.
 */
function listTimelines(dir, withStats) {
  const out = [];
  const pj = path.join(dir, 'Timelines', 'project.json');
  if (fs.existsSync(pj)) {
    try {
      const p = readJson(pj);
      const main = p.main_timeline_id;
      (p.timelines || []).forEach((t, i) => {
        if (!t || !t.id || t.is_marked_delete) return;
        const file = path.join(dir, 'Timelines', t.id, 'draft_content.json');
        if (!fs.existsSync(file)) return;
        out.push({
          id: t.id,
          name: t.name || `Timeline ${String(i + 1).padStart(2, '0')}`,
          isMain: t.id === main,
          file,
          order: i
        });
      });
    } catch (e) {}
  }
  if (!out.length) {
    const rootContent = path.join(dir, 'draft_content.json');
    if (fs.existsSync(rootContent)) out.push({ id: null, name: 'Timeline chính', isMain: true, file: rootContent, order: 0 });
  }
  if (withStats) {
    out.forEach((t) => {
      try {
        const c = readJson(t.file);
        t.duration = (c.duration || 0) / US;
        t.width = (c.canvas_config && c.canvas_config.width) || 0;
        t.height = (c.canvas_config && c.canvas_config.height) || 0;
        t.trackCount = (c.tracks || []).length;
        t.textTracks = (c.tracks || []).filter((x) => x.type === 'text').length;
      } catch (e) { t.duration = 0; t.trackCount = 0; t.textTracks = 0; }
    });
  }
  return out;
}

function hasDraftContent(dir) {
  return contentFiles(dir).length > 0;
}

/** Danh sách project CapCut từ mọi thư mục gốc (mới nhất trước). */
function listDrafts(customRoot) {
  const roots = draftsRoots(customRoot);
  const byDir = new Map();

  for (const rootDir of roots) {
    const metaMap = new Map();
    const rootFile = path.join(rootDir, 'root_meta_info.json');
    if (fs.existsSync(rootFile)) {
      try {
        const root = readJson(rootFile);
        for (const d of (root.all_draft_store || [])) {
          if (!d || !d.draft_fold_path) continue;
          const resolved = path.resolve(d.draft_fold_path);
          metaMap.set(resolved.toLowerCase(), d);
          if (fs.existsSync(resolved) && hasDraftContent(resolved)) {
            addDraftEntry(resolved, d, rootDir);
          }
        }
      } catch (e) {}
    }

    // Quét thêm thư mục con trực tiếp phòng trường hợp draft chưa được ghi vào root_meta_info.json
    try {
      for (const ent of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        const fullDir = path.resolve(path.join(rootDir, ent.name));
        const key = fullDir.toLowerCase();
        if (byDir.has(key) || !hasDraftContent(fullDir)) continue;
        addDraftEntry(fullDir, metaMap.get(key) || null, rootDir);
      }
    } catch (e) {}
  }

  function addDraftEntry(dir, meta, rootDir) {
    const key = dir.toLowerCase();
    if (byDir.has(key)) return;
    let videos = [];
    let contentDur = 0;
    try {
      const cFile = contentFiles(dir)[0];
      if (cFile) {
        const c = readJson(cFile);
        contentDur = (c.duration || 0) / US;
        videos = ((c.materials && c.materials.videos) || [])
          .filter((v) => v.path && v.type === 'video')
          .map((v) => v.path);
      }
    } catch (e) {}

    let mtime = 0;
    try { mtime = fs.statSync(dir).mtimeMs; } catch (e) {}
    const modified = meta && meta.tm_draft_modified ? meta.tm_draft_modified / 1000 : mtime;
    const duration = meta && meta.tm_duration ? meta.tm_duration / US : contentDur;

    byDir.set(key, {
      id: (meta && meta.draft_id) || path.basename(dir),
      name: (meta && meta.draft_name) || path.basename(dir),
      dir,
      rootDir,
      modified,
      duration,
      videos,
      timelineCount: timelineCount(dir)
    });
  }

  return Array.from(byDir.values()).sort((a, b) => b.modified - a.modified);
}

/**
 * Các đoạn video trên track video chính (giữ tương thích API cũ).
 */
function videoClips(draftDir, timelineId) {
  const cFile = contentFiles(draftDir, timelineId)[0];
  if (!cFile) return [];
  const c = readJson(cFile);
  const vids = {};
  ((c.materials && c.materials.videos) || []).forEach((v) => { vids[v.id] = v; });
  const track = (c.tracks || []).find((t) => t.type === 'video');
  if (!track) return [];
  return (track.segments || []).filter((s) => vids[s.material_id] && vids[s.material_id].path).map((s) => ({
    path: vids[s.material_id].path,
    start: s.target_timerange.start / US,
    duration: s.target_timerange.duration / US,
    sourceStart: s.source_timerange ? s.source_timerange.start / US : 0,
    speed: s.speed || 1
  }));
}

/**
 * Phân tích Âm thanh tổng của cả project (Kết hợp Cách A + Cách B):
 * - Cách A: Quét TẤT CẢ track video & audio trên timeline hiện hành, lọc bỏ track Mute, segment volume = 0, ảnh, video không có tiếng.
 * - Cách B: Tự phân loại track thành 'voice' (tự bật), 'bgm' (tự tắt), 'sfx' (tự tắt) kèm danh sách để người dùng chủ động bật/tắt.
 */
function analyzeTimelineAudio(draftDir, timelineId) {
  const files = contentFiles(draftDir, timelineId);
  if (!files.length) throw new Error('Không tìm thấy file timeline (draft_content.json).');
  const c = readJson(files[0]);

  const videos = {};
  ((c.materials && c.materials.videos) || []).forEach((v) => { videos[v.id] = v; });
  const audios = {};
  ((c.materials && c.materials.audios) || []).forEach((a) => { audios[a.id] = a; });
  const speeds = {};
  ((c.materials && c.materials.speeds) || []).forEach((s) => { speeds[s.id] = s; });

  const projectDuration = (c.duration || 0) / US;
  const audioTracks = [];
  const visualClips = [];
  let maxEnd = projectDuration;

  (c.tracks || []).forEach((track, trackIndex) => {
    if (track.type !== 'video' && track.type !== 'audio') return;
    const trackMuted = ((track.attribute || 0) & 1) !== 0;
    const rawSegs = track.segments || [];
    const audibleSegments = [];
    let silentCount = 0;

    rawSegs.forEach((s, segIndex) => {
      if (!s || !s.target_timerange) return;
      const start = (s.target_timerange.start || 0) / US;
      const duration = (s.target_timerange.duration || 0) / US;
      if (duration <= 0.01) return;
      if (start + duration > maxEnd) maxEnd = start + duration;

      const mat = track.type === 'video' ? videos[s.material_id] : audios[s.material_id];
      if (!mat || !mat.path) return;

      let speed = (typeof s.speed === 'number' && s.speed > 0) ? s.speed : 1;
      if (speed === 1 && Array.isArray(s.extra_material_refs)) {
        for (const refId of s.extra_material_refs) {
          if (speeds[refId] && typeof speeds[refId].speed === 'number' && speeds[refId].speed > 0) {
            speed = speeds[refId].speed;
            break;
          }
        }
      }
      const sourceStart = s.source_timerange ? (s.source_timerange.start || 0) / US : 0;
      const volume = typeof s.volume === 'number' ? s.volume : 1;

      if (track.type === 'video') {
        visualClips.push({
          id: s.id,
          trackIndex,
          trackName: track.name || '',
          type: mat.type || 'video',
          name: mat.material_name || path.basename(mat.path),
          path: mat.path,
          start,
          duration,
          end: start + duration,
          sourceStart,
          speed,
          visible: s.visible !== false
        });
      }

      // Cách A: Lọc nguồn câm / không có audio
      const isSilent =
        trackMuted ||
        volume <= 0.01 ||
        mat.type === 'photo' ||
        (track.type === 'video' && mat.has_audio === false);

      if (isSilent) {
        silentCount++;
        return;
      }

      audibleSegments.push({
        id: s.id,
        trackIndex,
        segIndex,
        trackType: track.type,
        trackName: track.name || '',
        materialType: mat.type || '',
        categoryName: mat.category_name || '',
        name: mat.material_name || mat.name || path.basename(mat.path),
        path: mat.path,
        start,
        duration,
        end: start + duration,
        sourceStart,
        speed,
        volume
      });
    });

    const totalSegs = rawSegs.length;
    const totalDur = audibleSegments.reduce((acc, x) => acc + x.duration, 0);
    const avgVol = audibleSegments.length
      ? audibleSegments.reduce((acc, x) => acc + x.volume, 0) / audibleSegments.length
      : 0;
    const maxSegDur = audibleSegments.length
      ? Math.max(...audibleSegments.map((x) => x.duration))
      : 0;

    audioTracks.push({
      trackId: track.id || `track_${trackIndex}`,
      trackIndex,
      type: track.type,
      name: track.name || (track.type === 'video' ? `Video #${trackIndex}` : `Audio #${trackIndex}`),
      muted: trackMuted,
      totalSegs,
      silentCount,
      audibleCount: audibleSegments.length,
      totalDuration: totalDur,
      avgVolume: avgVol,
      maxSegDuration: maxSegDur,
      segments: audibleSegments,
      role: 'silent',
      selected: false
    });
  });

  // Cách B: Phân loại thông minh Voice / BGM / SFX
  const maxAudibleVol = Math.max(0, ...audioTracks.map((t) => (t.audibleCount ? t.avgVolume : 0)));
  const effProjectDur = Math.max(maxEnd, 1);

  for (const t of audioTracks) {
    if (!t.audibleCount) {
      t.role = t.muted ? 'muted' : 'silent';
      t.selected = false;
      continue;
    }

    const nameL = t.name.toLowerCase();
    const hasSoundMat = t.segments.some((s) => s.materialType === 'sound' || /[/\\]cache[/\\]music[/\\]/i.test(s.path));
    const looksLikeSfxName = /\b(sfx|effect|sound|hiệu ứng|hieu ung)\b/i.test(nameL);
    const looksLikeShortSfx = t.type === 'audio' && t.audibleCount >= 3 && t.maxSegDuration < 3.0;

    if (hasSoundMat || looksLikeSfxName || looksLikeShortSfx) {
      t.role = 'sfx';
      t.selected = false;
      continue;
    }

    const looksLikeBgmName = /\b(bgm|music|nhạc|nhac|background|beat|instrument)\b/i.test(nameL);
    const looksLikeMusicPath = t.segments.some((s) => /[/\\](nhạc|nhac|bgm|music)[/\\]/i.test(s.path));
    const looksLikeQuietLongBgm =
      t.type === 'audio' &&
      t.totalDuration >= effProjectDur * 0.6 &&
      t.avgVolume <= 0.38 &&
      maxAudibleVol >= 0.6;

    if (looksLikeBgmName || looksLikeMusicPath || looksLikeQuietLongBgm) {
      t.role = 'bgm';
      t.selected = false;
      continue;
    }

    t.role = 'voice';
    t.selected = true;
  }

  // Fallback: Nếu không có track nào được gắn nhãn voice nhưng có track audible (không phải muted/silent)
  if (!audioTracks.some((t) => t.selected)) {
    const candidates = audioTracks
      .filter((t) => t.audibleCount > 0 && t.role !== 'sfx')
      .sort((a, b) => b.avgVolume - a.avgVolume);
    const pick = candidates[0] || audioTracks.find((t) => t.audibleCount > 0);
    if (pick) {
      pick.role = 'voice';
      pick.selected = true;
    }
  }

  // Phát hiện & thống kê các segment bị trùng lặp (vd: clip tách nền PiP ở Track 2 lặp lại Track 0)
  const seenKey = [];
  let duplicateCount = 0;
  for (const t of audioTracks) {
    if (!t.selected) continue;
    for (const s of t.segments) {
      const normPath = path.resolve(s.path).toLowerCase();
      const isDup = seenKey.some((k) =>
        k.path === normPath &&
        Math.abs(k.start - s.start) < 0.025 &&
        Math.abs(k.sourceStart - s.sourceStart) < 0.025
      );
      if (isDup) {
        s.isDuplicate = true;
        duplicateCount++;
      } else {
        s.isDuplicate = false;
        seenKey.push({ path: normPath, start: s.start, sourceStart: s.sourceStart });
      }
    }
  }

  visualClips.sort((a, b) => a.start - b.start || a.trackIndex - b.trackIndex);

  return {
    projectDuration: effProjectDur,
    canvas: {
      width: (c.canvas_config && c.canvas_config.width) || 1080,
      height: (c.canvas_config && c.canvas_config.height) || 1920,
      fps: c.fps || 30
    },
    tracks: audioTracks,
    visualClips,
    duplicateCount,
    timelineId: timelineId || mainTimelineId(draftDir),
    contentFile: files[0]
  };
}

/** Xoá file tạm/sao lưu (template*.tmp, *.bak) ở gốc draft và trong Timelines/<id>/. */
function cleanTemp(dir) {
  const dirs = [dir];
  const tl = path.join(dir, 'Timelines');
  if (fs.existsSync(tl)) fs.readdirSync(tl, { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) dirs.push(path.join(tl, e.name)); });
  dirs.forEach((d) => fs.readdirSync(d).forEach((f) => {
    if (/^template.*\.tmp$/i.test(f) || /^draft_content\.json\.bak$/i.test(f)) { try { fs.unlinkSync(path.join(d, f)); } catch (e) {} }
  }));
}

function updateRootMetaAdd(rootDir, entry) {
  const rootFile = path.join(rootDir, 'root_meta_info.json');
  if (!fs.existsSync(rootFile)) return;
  try {
    const rm = readJson(rootFile);
    rm.all_draft_store = [entry].concat((rm.all_draft_store || []).filter((d) => d.draft_id !== entry.draft_id));
    if (Array.isArray(rm.draft_ids)) {
      if (!rm.draft_ids.includes(entry.draft_id)) rm.draft_ids.push(entry.draft_id);
    } else if (typeof rm.draft_ids === 'number') {
      rm.draft_ids += 1;
    }
    if (!fs.existsSync(rootFile + '.autosub.bak')) {
      try { fs.copyFileSync(rootFile, rootFile + '.autosub.bak'); } catch (e) {}
    }
    writeJson(rootFile, rm);
  } catch (e) {}
}

function updateRootMetaRemove(rootDir, dir) {
  const rootFile = path.join(rootDir, 'root_meta_info.json');
  if (!fs.existsSync(rootFile)) return;
  try {
    const rm = readJson(rootFile);
    const entry = (rm.all_draft_store || []).find((d) => d.draft_fold_path && path.resolve(d.draft_fold_path) === path.resolve(dir));
    rm.all_draft_store = (rm.all_draft_store || []).filter((d) => d !== entry);
    if (entry && Array.isArray(rm.draft_ids)) rm.draft_ids = rm.draft_ids.filter((i) => i !== entry.draft_id);
    writeJson(rootFile, rm);
  } catch (e) {}
}

/** Xoá hẳn 1 project (thư mục + mục trong danh sách). Chỉ dùng cho project do AutoSub tạo. */
function removeDraft(dir) {
  const parentRoot = path.dirname(path.resolve(dir));
  updateRootMetaRemove(parentRoot, dir);
  const defRoot = defaultDraftsRoot();
  if (path.resolve(defRoot).toLowerCase() !== path.resolve(parentRoot).toLowerCase()) {
    updateRootMetaRemove(defRoot, dir);
  }
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Sao chép project thành project mới (id mới) và đăng ký vào danh sách project của CapCut. */
function cloneDraft(srcDir, newName) {
  const parentRoot = path.dirname(path.resolve(srcDir));
  const root = fs.existsSync(parentRoot) ? parentRoot : draftsRoot();
  let safe = newName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'AutoSub';
  let dest = path.join(root, safe), k = 2;
  while (fs.existsSync(dest)) { dest = path.join(root, `${safe} (${k++})`); }
  safe = path.basename(dest);
  fs.cpSync(srcDir, dest, { recursive: true });

  // Xoá file .locked nếu project gốc đang giữ lock
  try { fs.rmSync(path.join(dest, '.locked'), { force: true }); } catch (e) {}

  const newId = uuid();
  const metaFile = path.join(dest, 'draft_meta_info.json');
  if (fs.existsSync(metaFile)) {
    const meta = readJson(metaFile);
    meta.draft_id = newId;
    meta.draft_name = safe;
    meta.draft_fold_path = fwd(dest);
    meta.draft_root_path = fwd(root);
    writeJson(metaFile, meta);
  }

  cleanTemp(dest);

  let srcEntry = null;
  const parentRootFile = path.join(root, 'root_meta_info.json');
  if (fs.existsSync(parentRootFile)) {
    try {
      const rm = readJson(parentRootFile);
      srcEntry = (rm.all_draft_store || []).find((d) => d.draft_fold_path && path.resolve(d.draft_fold_path) === path.resolve(srcDir));
    } catch (e) {}
  }

  const entry = Object.assign({}, srcEntry || {}, {
    draft_id: newId,
    draft_name: safe,
    draft_fold_path: fwd(dest),
    draft_json_file: fwd(dest) + '/draft_content.json',
    draft_cover: fwd(dest) + '/draft_cover.jpg',
    draft_root_path: fwd(root),
    tm_draft_create: Date.now() * 1000,
    tm_draft_modified: Date.now() * 1000
  });

  updateRootMetaAdd(root, entry);
  const defRoot = defaultDraftsRoot();
  if (path.resolve(defRoot).toLowerCase() !== path.resolve(root).toLowerCase()) {
    updateRootMetaAdd(defRoot, entry);
  }
  return dest;
}

/*
 * Keyframe CapCut (mẫu lấy từ CapCut 9.7): mỗi thuộc tính một danh sách keyframe "Line".
 * kf = { alpha: [[t, v]...], x: [...], y: [...], scale: [...] }  (t: giây tính từ đầu đoạn)
 */
const KF_TYPE = { alpha: 'KFTypeGlobalAlpha', x: 'KFTypePositionX', y: 'KFTypePositionY', scale: 'KFTypeScaleX' };
function buildKeyframes(kf) {
  if (!kf) return [];
  return Object.keys(kf).filter((k) => KF_TYPE[k] && kf[k] && kf[k].length).map((k) => ({
    id: uuid(),
    material_id: '',
    property_type: KF_TYPE[k],
    keyframe_list: kf[k].map(([t, v]) => ({
      id: uuid(), curveType: 'Line', time_offset: Math.max(0, Math.round(t * US)),
      left_control: { x: 0.0, y: 0.0 }, right_control: { x: 0.0, y: 0.0 },
      values: [+v.toFixed(5)], string_value: '', graphID: ''
    }))
  }));
}

function hexToRgb01(hex) {
  const m = String(hex || '#000000').trim().match(/^#?([0-9a-f]{6})/i);
  if (!m) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
}

function touchDraftMeta(draftDir) {
  const nowUs = Date.now() * 1000;
  const metaFile = path.join(draftDir, 'draft_meta_info.json');
  if (fs.existsSync(metaFile)) {
    try {
      const meta = readJson(metaFile);
      meta.tm_draft_modified = nowUs;
      writeJson(metaFile, meta);
    } catch (e) {}
  }
  const parentRoot = path.dirname(path.resolve(draftDir));
  const roots = [parentRoot, defaultDraftsRoot()];
  const seen = new Set();
  for (const r of roots) {
    const key = path.resolve(r).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rootFile = path.join(r, 'root_meta_info.json');
    if (!fs.existsSync(rootFile)) continue;
    try {
      const rm = readJson(rootFile);
      const entry = (rm.all_draft_store || []).find((d) => d.draft_fold_path && path.resolve(d.draft_fold_path).toLowerCase() === path.resolve(draftDir).toLowerCase());
      if (entry) {
        entry.tm_draft_modified = nowUs;
        rm.all_draft_store = [entry].concat((rm.all_draft_store || []).filter((d) => d !== entry));
        writeJson(rootFile, rm);
      }
    } catch (e) {}
  }
}

function removeTracksByNames(c, names) {
  if (!Array.isArray(c.tracks) || !names || !names.length) return;
  const nameSet = new Set(names.map((n) => String(n).toLowerCase()));
  const removedSegs = [];
  c.tracks = c.tracks.filter((t) => {
    const tName = String(t && t.name || '').toLowerCase();
    const match = t && t.type === 'text' && (nameSet.has(tName) || [...nameSet].some((p) => tName === p || tName.startsWith(p + ' ')));
    if (match && Array.isArray(t.segments)) removedSegs.push(...t.segments);
    return !match;
  });
  if (!removedSegs.length) return;
  const stillMat = new Set();
  const stillExtra = new Set();
  for (const t of c.tracks) {
    for (const s of (t.segments || [])) {
      if (s.material_id) stillMat.add(s.material_id);
      for (const eid of (s.extra_material_refs || [])) stillExtra.add(eid);
    }
  }
  const dropMat = new Set(removedSegs.map((s) => s.material_id).filter((id) => id && !stillMat.has(id)));
  const dropExtra = new Set(removedSegs.flatMap((s) => s.extra_material_refs || []).filter((id) => id && !stillExtra.has(id)));
  if (c.materials) {
    if (Array.isArray(c.materials.texts)) c.materials.texts = c.materials.texts.filter((m) => !dropMat.has(m.id));
    if (Array.isArray(c.materials.material_animations)) c.materials.material_animations = c.materials.material_animations.filter((m) => !dropExtra.has(m.id));
    if (Array.isArray(c.materials.effects)) c.materials.effects = c.materials.effects.filter((m) => !dropExtra.has(m.id));
  }
}

/*
 * Ghi 1 track chữ vào timeline (hỗ trợ cả Timelines/<main_id>/draft_content.json và root draft_content.json).
 */
function addTextTrack(draftDir, segs, opts) {
  opts = opts || {};
  const files = contentFiles(draftDir, opts.timelineId);
  if (!files.length) throw new Error('Không tìm thấy draft_content.json của timeline cần ghi trong project.');
  const c = readJson(files[0]);
  const tMat = sample('text_material'), tSeg = sample('text_segment');
  const tAnim = sample('animation_material'), tGlow = sample('glow_effect');
  c.materials.texts = c.materials.texts || [];
  c.materials.material_animations = c.materials.material_animations || [];
  c.materials.effects = c.materials.effects || [];

  if (opts.replace) {
    const names = Array.isArray(opts.replaceNames) && opts.replaceNames.length ? opts.replaceNames : [opts.name || 'AutoSub'];
    removeTracksByNames(c, names);
  }

  const maxIdx = Math.max(14000, ...(c.tracks || []).flatMap((t) => (t.segments || []).map((s) => s.render_index || 0)));
  const textTracksBefore = (c.tracks || []).filter((t) => t.type === 'text').length;
  const lanes = {};
  const laneTrack = (lane) => {
    if (!lanes[lane]) {
      lanes[lane] = { id: uuid(), type: 'text', flag: 0, attribute: 0, name: (opts.name || 'AutoSub') + (lane ? ' ' + lane : ''), is_default_name: false, segments: [] };
    }
    return lanes[lane];
  };

  segs.forEach((s, i) => {
    // CapCut content.styles[].range tính theo UTF-16 code unit (chuỗi JS .length).
    const len = String(s.text || '').length;
    const style = {
      fill: { alpha: 1.0, content: { render_type: 'solid', solid: { alpha: 1.0, color: s.color || [1, 1, 1] } } },
      font: { id: '', path: fwd(s.font) },
      range: [0, len],
      size: s.size,
      useLetterColor: true
    };
    const shObj = s.shadow && typeof s.shadow === 'object' ? s.shadow : null;
    const hasShadow = !!s.shadow;
    const sAlpha = shObj && shObj.alpha !== undefined ? shObj.alpha : 0.65;
    const sDist = shObj && shObj.distance !== undefined ? shObj.distance : 4;
    const sSmooth = shObj && shObj.smoothing !== undefined ? shObj.smoothing : 0.6;
    const sColor = (shObj && shObj.color) || '#000000';
    if (hasShadow) {
      style.shadows = [{
        thickness_projection_angle: -90,
        thickness_projection_enable: false,
        diffuse: +(Math.max(0.02, sSmooth * 0.2)).toFixed(3),
        alpha: sAlpha,
        distance: sDist,
        content: { render_type: 'solid', solid: { color: hexToRgb01(sColor) } },
        angle: -90,
        thickness_projection_distance: 0
      }];
    }
    let checkFlag = 7;
    const hasBorder = !!(s.border && (s.border.width || s.border.color));
    if (hasBorder) {
      const bColor = s.border.color || '#000000';
      const bWidth = s.border.width || 0.08;
      style.strokes = [{
        content: { render_type: 'solid', solid: { color: hexToRgb01(bColor) } },
        width: bWidth,
        mode: 0
      }];
      checkFlag |= 40;
    }
    const hasBg = !!(s.bg && s.bg.alpha > 0);
    if (hasBg) {
      checkFlag |= 16;
    }

    const mat = JSON.parse(JSON.stringify(tMat));
    Object.assign(mat, {
      id: uuid(),
      content: JSON.stringify({ text: s.text, styles: [style] }),
      font_path: fwd(s.font), font_size: s.size, font_name: '', font_title: 'none', font_id: '', font_resource_id: '',
      text_color: '#' + (s.color || [1, 1, 1]).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase(),
      letter_spacing: s.letterSpacing || 0,
      has_shadow: hasShadow, shadow_color: hasShadow ? sColor : '', shadow_alpha: sAlpha, shadow_distance: sDist, shadow_angle: -90, shadow_smoothing: sSmooth,
      has_border: hasBorder,
      border_color: hasBorder ? (s.border.color || '#000000') : '',
      border_width: hasBorder ? (s.border.width || 0.08) : 0.08,
      border_alpha: hasBorder && s.border.alpha !== undefined ? s.border.alpha : 1.0,
      has_text_shadow_config: hasBg,
      background_color: hasBg ? (s.bg.color || '#000000') : '',
      background_alpha: hasBg ? (s.bg.alpha !== undefined ? s.bg.alpha : 0.62) : 1.0,
      background_style: hasBg ? (s.bg.style !== undefined ? s.bg.style : 1) : 0,
      background_round_radius: hasBg ? (s.bg.round !== undefined ? s.bg.round : 0.35) : 0.0,
      background_width: 0.14,
      background_height: 0.14,
      line_max_width: s.lineMaxWidth || 1.0, alignment: 1, typesetting: 0, is_rich_text: false, fonts: [], check_flag: checkFlag,
      use_effect_default_color: false,
      words: { start_time: [], end_time: [], text: [] }, current_words: { start_time: [], end_time: [], text: [] }
    });
    c.materials.texts.push(mat);

    const refs = [];
    const anim = JSON.parse(JSON.stringify(tAnim));
    anim.id = uuid();
    if (s.anim && anim.animations && anim.animations[0]) {
      anim.animations[0].duration = Math.round(Math.max(0.1, s.anim.duration) * US);
      anim.animations[0].start = 0;
    } else anim.animations = [];
    c.materials.material_animations.push(anim);
    refs.push(anim.id);

    if (s.glow) {
      const g = JSON.parse(JSON.stringify(tGlow));
      g.id = uuid();
      g.bloom_params = Object.assign({}, g.bloom_params, { color: s.glow.color, strength: s.glow.strength || 0.35, range: s.glow.range || 0.25 });
      c.materials.effects.push(g);
      refs.push(g.id);
    }

    const seg = JSON.parse(JSON.stringify(tSeg));
    Object.assign(seg, {
      id: uuid(),
      material_id: mat.id,
      extra_material_refs: refs,
      target_timerange: { start: Math.round(s.start * US), duration: Math.max(33333, Math.round((s.end - s.start) * US)) },
      render_index: maxIdx + 1 + i,
      track_render_index: textTracksBefore + 1 + Object.keys(lanes).indexOf(String(s.lane || 0))
    });
    seg.clip = Object.assign({}, seg.clip, {
      transform: { x: s.x || 0, y: s.y || 0 },
      scale: { x: s.scale || 1, y: s.scale || 1 },
      alpha: 1.0
    });
    seg.uniform_scale = { on: true, value: s.scale || 1 };
    seg.common_keyframes = buildKeyframes(s.keyframes);
    laneTrack(String(s.lane || 0)).segments.push(seg);
  });

  const newTracks = Object.keys(lanes).sort().map((k) => lanes[k]);
  newTracks.forEach((t, k) => t.segments.forEach((s) => { s.track_render_index = textTracksBefore + 1 + k; }));
  c.tracks.push(...newTracks);
  const all = newTracks.flatMap((t) => t.segments);
  c.duration = Math.max(c.duration || 0, ...all.map((s) => s.target_timerange.start + s.target_timerange.duration));
  files.forEach((f) => {
    if (!fs.existsSync(f + '.autosub.bak')) fs.copyFileSync(f, f + '.autosub.bak');
    writeJson(f, c);
  });
  if (opts.touchMeta !== false) touchDraftMeta(draftDir);
  cleanTemp(draftDir);
  return all.length;
}

module.exports = {
  draftsRoots,
  draftsRoot,
  listDrafts,
  videoClips,
  analyzeTimelineAudio,
  cloneDraft,
  removeDraft,
  addTextTrack,
  touchDraftMeta,
  contentFiles,
  listTimelines,
  timelineCount,
  mainTimelineId,
  isCapCutRunning,
  readJson
};
