/* AutoSub Typo Pro for CapCut — giao diện Cosmic & bộ tổng hợp Âm thanh tổng (Cách A + Cách B). */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const APP = __dirname;
const SHARED = path.join(APP, 'shared');
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const FONTS = unpacked(path.join(SHARED, 'fonts'));
const core = (m) => require(path.join(SHARED, 'core', m));
const cc = core('capcut.js'), typo = core('capcut-typo.js'), audio = core('audio.js');
const whisper = core('whisper.js'), setup = core('setup.js'), fontsMod = core('fonts.js');
const ttf = core('ttf.js'), sysfonts = core('sysfonts.js');
const Layout = window.AutoSubLayout, SRT = window.AutoSubSRT;

const $ = (s) => document.querySelector(s);
const state = {
  draft: null,
  timelines: [],
  timelineId: null,
  tlCache: new Map(),
  analysis: null,
  tracks: [],
  visualClips: [],
  projectDuration: 0,
  canvas: { width: 1080, height: 1920, fps: 30 },
  words: [],
  groups: [],
  movieCues: [],
  segs: [],
  mode: 'typo',
  brush: 'auto',
  undoStack: [],
  redoStack: [],
  effectStyle: { border: null, bg: null, shadow: true },
  shown: null,
  masterWavPath: null,
  masterAudioUrl: null,
  masterTempDir: null,
  previewSeq: 0,
  previewPromise: null,
  lastMixRes: null,
  audioDirty: true,
  pendingAudioSeek: null,
  playing: false,
  playTime: 0,
  lastFrameTs: 0,
  activeSrc: null,
  activePhoto: null,
  pendingSeek: null,
  stopAt: null
};

/* ---------- Tiện ích & Trạng thái ---------- */
function log(msg, kind) {
  const d = document.createElement('div');
  if (kind) d.className = kind;
  d.textContent = msg;
  $('#log').appendChild(d);
  $('#log').scrollTop = 1e9;
}
function progress(p, label) {
  $('#progress-bar').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
  if (label !== undefined) $('#progress-label').textContent = label;
}
const fmt = (t) => (Number.isFinite(t) ? t : 0).toFixed(1) + 's';
let busyFlag = false;
function busy(on) {
  busyFlag = on;
  refreshButtons();
}
function selectedAudioSegments() {
  return (state.tracks || []).filter((t) => t.selected).flatMap((t) => t.segments || []);
}
function refreshButtons() {
  const tools = toolState();
  const ready = !!(tools.whisper && tools.ffmpeg && tools.model);
  const hasVoiceSegs = selectedAudioSegments().length > 0;
  const hasContent = state.mode === 'movie' ? state.movieCues.length > 0 : state.groups.length > 0;
  $('#btn-listen').disabled = busyFlag || !state.draft || !ready || !hasVoiceSegs;
  $('#btn-layout').disabled = busyFlag || !state.words.length;
  $('#btn-write').disabled = busyFlag || !hasContent;
  $('#btn-setup').disabled = busyFlag;
  const hasTracks = (state.tracks || []).some((t) => t.audibleCount > 0);
  $('#btn-tracks-voice').disabled = busyFlag || !hasTracks;
  $('#btn-tracks-all').disabled = busyFlag || !hasTracks;
  document.querySelectorAll('.tl-chip').forEach((b) => { b.disabled = busyFlag; });
  const split = $('#btn-split-playhead');
  if (split) {
    split.hidden = state.mode === 'movie';
    split.disabled = busyFlag || state.mode === 'movie' || !state.groups.length;
  }
  const emphBar = $('#emph-toolbar');
  if (emphBar) emphBar.hidden = state.mode === 'movie';
  const bUndo = $('#btn-undo'), bRedo = $('#btn-redo');
  if (bUndo) {
    const topU = state.undoStack[state.undoStack.length - 1];
    bUndo.disabled = busyFlag || !topU;
    bUndo.title = topU ? `Hoàn tác: ${topU.label} (Ctrl+Z)` : 'Không có thao tác để hoàn tác (Ctrl+Z)';
  }
  if (bRedo) {
    const topR = state.redoStack[state.redoStack.length - 1];
    bRedo.disabled = busyFlag || !topR;
    bRedo.title = topR ? `Làm lại: ${topR.label} (Ctrl+Y)` : 'Không có thao tác để làm lại (Ctrl+Y)';
  }
  const glowWrap = $('#opt-glow-wrap');
  const subWrap = $('#opt-sub-wrap');
  if (glowWrap) glowWrap.hidden = state.mode === 'movie';
  if (subWrap) subWrap.hidden = state.mode === 'movie';
}

/* ---------- Hoàn tác / Làm lại (Undo / Redo) ---------- */
const MAX_HISTORY = 80;
const deepClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function captureSnapshot() {
  return {
    words: deepClone(state.words),
    groups: deepClone(state.groups),
    movieCues: deepClone(state.movieCues),
    sel: state.sel,
    mode: state.mode,
    global: deepClone(state.global),
    styles: deepClone(state.styles),
    effectStyle: deepClone(state.effectStyle),
    glow: $('#opt-glow') ? !!$('#opt-glow').checked : true
  };
}
function pushUndo(label, presetSnap) {
  const snap = presetSnap || captureSnapshot();
  const sig = JSON.stringify(snap);
  const top = state.undoStack[state.undoStack.length - 1];
  if (top && top._sig === sig) return false;
  state.undoStack.push({ label: label || 'Chỉnh sửa', snap, _sig: sig });
  if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
  state.redoStack = [];
  refreshButtons();
  return true;
}
function applyHistoryEntry(entry) {
  const s = entry.snap;
  state.words = deepClone(s.words) || [];
  state.groups = deepClone(s.groups) || [];
  state.movieCues = deepClone(s.movieCues) || [];
  state.sel = s.sel || null;
  state.global = deepClone(s.global) || state.global;
  state.styles = deepClone(s.styles) || state.styles;
  state.effectStyle = deepClone(s.effectStyle) || { border: null, bg: null, shadow: true };
  if ($('#opt-glow')) $('#opt-glow').checked = s.glow !== false;
  state.mode = s.mode === 'movie' ? 'movie' : 'typo';

  settings.mode = state.mode;
  settings.styles = state.styles;
  settings.effectStyle = state.effectStyle;
  settings.anim = state.global.anim;
  settings.movieAnim = state.global.movieAnim;
  settings.scale = state.global.scale;
  settings.yposTypo = state.global.yPos;
  settings.yposMovie = state.global.movieYPos;
  save();

  const lo = layoutOpts();
  scriptOkCache.clear();
  state.groups.forEach((g) => Layout.syncGroup(g, lo));

  const bTypo = $('#mode-typo'), bMovie = $('#mode-movie');
  if (bTypo) bTypo.classList.toggle('sel', state.mode === 'typo');
  if (bMovie) bMovie.classList.toggle('sel', state.mode === 'movie');
  updateModeUI();
  renderWords();
  renderInspector();
  renderGroups();
  rebuildSegs();
  renderTimelines();
  updateMetrics();
  stashTimeline();
  refreshButtons();
}
function undo() {
  if (busyFlag || !state.undoStack.length) return;
  const entry = state.undoStack.pop();
  const curSnap = captureSnapshot();
  state.redoStack.push({ label: entry.label, snap: curSnap, _sig: JSON.stringify(curSnap) });
  applyHistoryEntry(entry);
  log(`↶ Hoàn tác: ${entry.label}`);
}
function redo() {
  if (busyFlag || !state.redoStack.length) return;
  const entry = state.redoStack.pop();
  const curSnap = captureSnapshot();
  state.undoStack.push({ label: entry.label, snap: curSnap, _sig: JSON.stringify(curSnap) });
  applyHistoryEntry(entry);
  log(`↷ Làm lại: ${entry.label}`);
}
const settings = (() => { try { return JSON.parse(localStorage.getItem('autosub-cc') || '{}'); } catch (e) { return {}; } })();
function save() { try { localStorage.setItem('autosub-cc', JSON.stringify(settings)); } catch (e) {} }

/* ---------- 0. Công cụ ---------- */
const TOOLS_ROOT = path.join(APP, '..');
const BUNDLED = [
  path.join(process.resourcesPath || '', 'tools'),
  path.join(APP, 'vendor', 'tools'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'AutoSub Typo Pro for CapCut', 'resources', 'tools'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'AutoSub Typo for CapCut', 'resources', 'tools')
].find((d) => d && (
  fs.existsSync(path.join(d, 'faster-whisper', 'python.exe')) ||
  fs.existsSync(path.join(d, 'ffmpeg', 'ffmpeg.exe')) ||
  fs.existsSync(path.join(d, 'models', 'PhoWhisper-small-ct2', 'model.bin'))
)) || null;

function bundledTools() {
  if (!BUNDLED) return { whisper: null, ffmpeg: null, model: null };
  const py = path.join(BUNDLED, 'faster-whisper', 'python.exe');
  const fwPkg = path.join(BUNDLED, 'faster-whisper', 'Lib', 'site-packages', 'faster_whisper');
  const modelDir = path.join(BUNDLED, 'models', 'PhoWhisper-small-ct2');
  const ffmpeg = path.join(BUNDLED, 'ffmpeg', 'ffmpeg.exe');
  return {
    whisper: (fs.existsSync(py) && fs.existsSync(fwPkg)) ? py : null,
    ffmpeg: fs.existsSync(ffmpeg) ? ffmpeg : null,
    model: fs.existsSync(path.join(modelDir, 'model.bin')) ? modelDir : null
  };
}
function toolState() {
  const b = bundledTools();
  const t = audio.findTools(TOOLS_ROOT);
  const m = b.model || audio.findModel(TOOLS_ROOT);
  return {
    whisper: b.whisper || t.whisper,
    ffmpeg: b.ffmpeg || t.ffmpeg,
    model: m
  };
}
function updateMetrics() {
  const s = toolState();
  const pill = $('#engine-pill');
  if (s.whisper && s.ffmpeg && s.model) {
    pill.textContent = 'Faster-Whisper · CPU INT8';
  } else {
    pill.textContent = 'Thiếu công cụ';
  }

  if (!state.draft) {
    $('#metric-audio-value').textContent = 'Chưa chọn project';
    $('#metric-audio-sub').textContent = 'Quét toàn bộ track Voice · Lọc BGM & SFX';
  } else {
    const selTracks = state.tracks.filter((t) => t.selected);
    const selSegs = selTracks.reduce((n, t) => n + t.audibleCount, 0);
    const ignored = state.tracks.filter((t) => t.role === 'bgm' || t.role === 'sfx').length;
    $('#metric-audio-value').textContent = `${selTracks.length} Track Voice · ${selSegs} đoạn`;
    $('#metric-audio-sub').textContent = `Tổng ${fmt(state.projectDuration)} · Đã lọc ${ignored} track nhạc/SFX`;
  }

  if (state.words.length) {
    const countText = state.mode === 'movie'
      ? `${state.words.length} từ · ${state.movieCues.length} dòng sub`
      : `${state.words.length} từ · ${state.groups.length} cụm`;
    $('#metric-typo-value').textContent = countText;
    $('#metric-typo-sub').textContent = state.masterAudioUrl
      ? (state.mode === 'movie' ? 'Chế độ Sub Phim Ngang · Audio 16kHz' : 'Đang phát từ Master WAV 16kHz')
      : 'Đã dựng layout chữ';
  } else {
    $('#metric-typo-value').textContent = 'PhoWhisper CPU INT8';
    $('#metric-typo-sub').textContent = s.model ? path.basename(s.model) : 'Chờ nạp model';
  }
}
function renderSetup() {
  const s = toolState();
  $('#setup-status').innerHTML = [
    ['whisper', 'faster-whisper runtime (CPU INT8 + vad_filter)'],
    ['ffmpeg', 'ffmpeg'],
    ['model', 'Model PhoWhisper-small-ct2 (INT8)']
  ].map(([k, l]) => `<li class="${s[k] ? 'ok' : 'miss'}">${s[k] ? '✓' : '○'} ${l}</li>`).join('');
  $('#setup-card').hidden = !!(s.whisper && s.ffmpeg && s.model);
  updateMetrics();
  refreshButtons();
}
async function runSetup() {
  busy(true);
  try {
    const s = toolState();
    await setup.install({
      model: $('#setup-model').value,
      needWhisper: !s.whisper,
      needFfmpeg: !s.ffmpeg,
      needModel: !s.model,
      onStep: (m) => log(m),
      onProgress: (p, l) => progress(p, l)
    });
    progress(1, 'Đã cài xong công cụ');
    log('Đã cài xong faster-whisper + PhoWhisper-small-ct2 (CPU INT8 + VAD).', 'ok');
  } catch (e) { log(e.message, 'err'); }
  finally { busy(false); renderSetup(); }
}

/* ---------- 1. Project CapCut ---------- */
function findDraftCover(d) {
  for (const name of ['draft_cover.jpg', 'draft_cover.jpeg', 'draft_cover.png', 'draft_cover.webp']) {
    const p = path.join(d.dir, name);
    try { if (fs.existsSync(p) && fs.statSync(p).size > 0) return p; } catch (e) {}
  }
  try {
    const metaFile = path.join(d.dir, 'draft_meta_info.json');
    if (fs.existsSync(metaFile)) {
      const m = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^\uFEFF/, ''));
      if (m && m.draft_cover) {
        const resolved = cc.resolveMediaPath(m.draft_cover, d.dir);
        if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).size > 0) return resolved;
      }
    }
  } catch (e) {}
  return '';
}
function renderDrafts() {
  const box = $('#drafts');
  const q = $('#draft-filter').value.trim().toLowerCase();
  const roots = cc.draftsRoots(settings.customRoot);
  $('#drafts-root-info').textContent = roots[0] ? path.basename(roots[0]) || roots[0] : 'Chưa thấy thư mục';
  $('#drafts-root-info').title = roots.join('\n');

  let list = [];
  try { list = cc.listDrafts(settings.customRoot); }
  catch (e) { log('Không đọc được danh sách project CapCut: ' + e.message, 'err'); }
  box.innerHTML = '';
  list.filter((d) => !q || d.name.toLowerCase().includes(q)).forEach((d) => {
    const el = document.createElement('div');
    el.className = 'draft' + (state.draft && state.draft.dir === d.dir ? ' sel' : '');
    const cover = findDraftCover(d);
    el.innerHTML = `<div class="cov"><span class="cov-empty">🎬</span></div><div class="nm"></div><div class="meta"></div>`;
    if (cover) {
      const img = document.createElement('img');
      img.className = 'cov-img';
      img.alt = d.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = `${pathToFileURL(cover).href}?v=${Math.round(d.modified || 0)}`;
      img.addEventListener('error', () => img.remove());
      el.querySelector('.cov').appendChild(img);
    }
    el.querySelector('.nm').textContent = d.name;
    el.querySelector('.meta').textContent = `${fmt(d.duration)} · ${new Date(d.modified).toLocaleDateString('vi-VN')}`;
    if (d.timelineCount > 1) {
      const tb = document.createElement('span');
      tb.className = 'tl-count';
      tb.textContent = `${d.timelineCount} timeline`;
      tb.title = `Project có ${d.timelineCount} timeline — chọn project rồi chọn timeline bên dưới`;
      el.querySelector('.cov').appendChild(tb);
    }
    el.title = d.dir;
    el.addEventListener('click', () => selectDraft(d));
    box.appendChild(el);
  });
}

function ensureSessionTempDir() {
  if (!state.masterTempDir || !fs.existsSync(state.masterTempDir)) {
    state.masterTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autosub-cc-'));
  }
  return state.masterTempDir;
}

function cleanupMasterTemp() {
  state.previewSeq++;
  state.previewPromise = null;
  state.lastMixRes = null;
  state.audioDirty = true;
  if (state.masterTempDir && fs.existsSync(state.masterTempDir)) {
    try { fs.rmSync(state.masterTempDir, { recursive: true, force: true }); } catch (e) {}
  }
  state.masterTempDir = null;
  state.masterWavPath = null;
  state.masterAudioUrl = null;
}

let previewTimer = null;
function schedulePreviewAudio(delayMs = 250) {
  state.audioDirty = true;
  if (previewTimer) clearTimeout(previewTimer);
  const seq = ++state.previewSeq;
  if (delayMs <= 0) {
    state.previewPromise = preparePreviewAudio(seq);
    return state.previewPromise;
  }
  state.previewPromise = new Promise((resolve) => {
    previewTimer = setTimeout(async () => {
      previewTimer = null;
      resolve(await preparePreviewAudio(seq));
    }, delayMs);
  });
  return state.previewPromise;
}

async function preparePreviewAudio(seq, onProgress) {
  const tools = toolState();
  const segs = selectedAudioSegments();
  if (!tools.ffmpeg || !segs.length) {
    if (seq === state.previewSeq) {
      state.lastMixRes = null;
      state.masterWavPath = null;
      state.masterAudioUrl = null;
      state.audioDirty = false;
      const ma = $('#master-audio');
      ma.removeAttribute('src');
      ma.load();
      $('#audio-mode-pill').textContent = segs.length ? 'Thiếu FFmpeg' : 'Không có track tiếng';
    }
    return null;
  }

  $('#audio-mode-pill').textContent = 'Đang nạp âm thanh…';
  const dir = ensureSessionTempDir();
  const outWav = path.join(dir, `master_${seq}.wav`);
  const oldWav = state.masterWavPath;

  const mixRes = await audio.buildMasterWav(
    tools.ffmpeg,
    segs,
    state.projectDuration,
    outWav,
    onProgress
  );

  if (seq !== state.previewSeq) {
    try { if (fs.existsSync(outWav)) fs.unlinkSync(outWav); } catch (e) {}
    return null;
  }

  const ma = $('#master-audio');
  const resumeAt = state.playTime || 0;
  state.masterWavPath = mixRes.wavPath;
  state.masterAudioUrl = pathToFileURL(mixRes.wavPath).href;
  state.lastMixRes = mixRes;
  state.audioDirty = false;
  state.pendingAudioSeek = resumeAt;
  ma.src = state.masterAudioUrl;
  ma.muted = false;
  ma.volume = Math.max(0, Math.min(1, parseInt(($('#player-vol') && $('#player-vol').value) || '100', 10) / 100));
  ma.load();

  if (oldWav && oldWav !== outWav && fs.existsSync(oldWav)) {
    setTimeout(() => { try { fs.unlinkSync(oldWav); } catch (e) {} }, 600);
  }

  $('#audio-mode-pill').textContent = '🔊 Âm thanh tổng 16kHz';
  updateMetrics();
  return mixRes;
}

/* ---------- Nhiều timeline trong 1 project ---------- */
const tlKey = (dir, id) => `${String(dir).toLowerCase()}|${id || 'main'}`;
const trackKey = (t) => `${t.type}:${t.trackIndex}`;
function currentTimeline() {
  return state.timelines.find((t) => (t.id || null) === (state.timelineId || null)) || state.timelines[0] || null;
}
/** Lưu kết quả nhận dạng / typography của timeline hiện tại để chuyển qua lại không mất. */
function stashTimeline() {
  if (!state.draft) return;
  const tl = currentTimeline();
  const sel = {};
  state.tracks.forEach((t) => { sel[trackKey(t)] = !!t.selected; });
  state.tlCache.set(tlKey(state.draft.dir, state.timelineId), {
    dir: state.draft.dir,
    timelineId: state.timelineId,
    name: tl ? tl.name : 'Timeline',
    canvas: Object.assign({}, state.canvas),
    words: state.words,
    groups: state.groups,
    movieCues: state.movieCues,
    trackSel: sel,
    sel: state.sel,
    undoStack: state.undoStack,
    redoStack: state.redoStack
  });
}
function cachedTimelines(dir) {
  return Array.from(state.tlCache.values()).filter((c) => c.dir.toLowerCase() === String(dir).toLowerCase() && c.groups && c.groups.length);
}

function renderTimelines() {
  const box = $('#timeline-box');
  const list = $('#timelines');
  list.innerHTML = '';
  if (!state.draft || state.timelines.length < 2) {
    box.hidden = true;
  } else {
    box.hidden = false;
    $('#timeline-count').textContent = `${state.timelines.length} timeline`;
    state.timelines.forEach((tl) => {
      const active = (tl.id || null) === (state.timelineId || null);
      const cache = state.tlCache.get(tlKey(state.draft.dir, tl.id));
      const groupsN = active ? state.groups.length : (cache && cache.groups ? cache.groups.length : 0);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tl-chip' + (active ? ' sel' : '') + (groupsN ? ' done' : '');
      el.innerHTML = '<span class="tl-name"></span><span class="tl-meta"></span>';
      el.querySelector('.tl-name').textContent = (tl.isMain ? '★ ' : '') + tl.name;
      const bits = [fmt(tl.duration || 0)];
      if (tl.width && tl.height) bits.push(`${tl.width}x${tl.height}`);
      if (groupsN) bits.push(`✓ ${groupsN} cụm`);
      else if (tl.textTracks) bits.push(`${tl.textTracks} track chữ`);
      el.querySelector('.tl-meta').textContent = bits.join(' · ');
      el.title = tl.isMain ? 'Timeline chính (CapCut mở mặc định)' : 'Timeline phụ trong project';
      el.disabled = busyFlag;
      el.addEventListener('click', () => {
        if (active || busyFlag) return;
        selectDraft(state.draft, tl.id);
      });
      list.appendChild(el);
    });
  }
  const done = state.draft ? cachedTimelines(state.draft.dir) : [];
  const curDone = state.groups.length > 0;
  const otherDone = done.filter((c) => (c.timelineId || null) !== (state.timelineId || null)).length;
  const total = otherDone + (curDone ? 1 : 0);
  $('#opt-all-tl-wrap').hidden = total < 2;
  $('#opt-all-tl-label').textContent = `Ghi cả ${total} timeline đã nhận dạng vào project hiện tại`;
}

function selectDraft(d, timelineId) {
  if (busyFlag) { log('Đang xử lý — vui lòng đợi xong rồi mới đổi project / timeline.', 'err'); return; }
  try {
    const sameDraft = state.draft && state.draft.dir === d.dir;
    if (state.draft) stashTimeline();
    const timelines = cc.listTimelines(d.dir, true);
    if (!timelines.length) throw new Error('Không tìm thấy timeline (draft_content.json) trong project.');
    let tl = null;
    const wanted = timelineId !== undefined ? timelineId : (sameDraft ? state.timelineId : undefined);
    if (wanted !== undefined) tl = timelines.find((t) => (t.id || null) === (wanted || null)) || null;
    if (!tl) tl = timelines.find((t) => t.isMain) || timelines[0];

    const analysis = cc.analyzeTimelineAudio(d.dir, tl.id);
    if (!analysis.visualClips.length && !analysis.tracks.some((t) => t.audibleCount > 0)) {
      throw new Error(`${timelines.length > 1 ? `"${tl.name}" ` : 'Project '}chưa có video hay âm thanh trên timeline.`);
    }

    pausePlayback();
    cleanupMasterTemp();
    const ma = $('#master-audio');
    ma.removeAttribute('src');
    ma.load();

    state.draft = d;
    state.timelines = timelines;
    state.timelineId = tl.id || null;
    state.analysis = analysis;
    state.tracks = analysis.tracks;
    state.visualClips = analysis.visualClips;
    state.projectDuration = analysis.projectDuration || tl.duration || d.duration || 1;
    state.canvas = analysis.canvas;
    state.words = [];
    state.groups = [];
    state.movieCues = [];
    state.segs = [];
    state.sel = null;
    state.undoStack = [];
    state.redoStack = [];
    state.playTime = 0;
    state.activeSrc = null;
    state.activePhoto = null;
    state.stopAt = null;

    // Khôi phục kết quả đã nhận dạng trước đó của timeline này (nếu có)
    const cache = state.tlCache.get(tlKey(d.dir, state.timelineId));
    if (cache) {
      state.tracks.forEach((t) => { if (cache.trackSel[trackKey(t)] !== undefined) t.selected = cache.trackSel[trackKey(t)] && t.audibleCount > 0; });
      state.words = cache.words || [];
      state.groups = cache.groups || [];
      state.movieCues = cache.movieCues || (state.words.length ? SRT.groupMovieCues(state.words, state.canvas) : []);
      state.sel = state.groups.some((g) => g.id === cache.sel) ? cache.sel : null;
      state.undoStack = Array.isArray(cache.undoStack) ? cache.undoStack : [];
      state.redoStack = Array.isArray(cache.redoStack) ? cache.redoStack : [];
      const lo = layoutOpts();
      state.groups.forEach((g) => Layout.syncGroup(g, lo));
    }

    renderWords();
    rebuildSegs();
    renderGroups();
    renderInspector();
    renderAudioTracks();
    renderTimelines();
    updateMetrics();

    const stage = $('#stage');
    stage.style.setProperty('--ar', String(state.canvas.width / state.canvas.height));
    $('#stage-empty').hidden = true;
    $('#btn-play').disabled = false;
    $('#scrub').disabled = false;
    $('#dur-total').textContent = `/ ${fmt(state.projectDuration)}`;

    seek(0);
    if (!sameDraft) renderDrafts();

    const voiceTracks = state.tracks.filter((t) => t.selected);
    const voiceSegs = voiceTracks.reduce((n, t) => n + t.audibleCount, 0);
    const bgmCount = state.tracks.filter((t) => t.role === 'bgm').length;
    const sfxCount = state.tracks.filter((t) => t.role === 'sfx').length;
    const silentCount = state.tracks.filter((t) => t.role === 'muted' || t.role === 'silent').length;
    const tlLabel = timelines.length > 1 ? ` · ${tl.name}${tl.isMain ? ' (chính)' : ''} (${timelines.indexOf(tl) + 1}/${timelines.length})` : '';
    log(
      `Đã chọn "${d.name}"${tlLabel} — ${state.canvas.width}x${state.canvas.height}, ${fmt(state.projectDuration)}. ` +
      `Tự chọn ${voiceTracks.length} track Voice (${voiceSegs} đoạn), lọc ${bgmCount} BGM, ${sfxCount} SFX, ${silentCount} track câm.` +
      (analysis.duplicateCount ? ` Phát hiện ${analysis.duplicateCount} đoạn PiP trùng tiếng (sẽ tự khử).` : '') +
      (cache && state.groups.length ? ` Đã khôi phục ${state.groups.length} cụm chữ đã nhận dạng trước đó.` : ''),
      'ok'
    );

    // Tự động tổng hợp Âm thanh tổng ngay khi chọn project để bấm Play nghe được luôn
    schedulePreviewAudio(0).catch((err) => log('Lỗi nạp âm thanh preview: ' + err.message, 'err'));
  } catch (e) { log(e.message, 'err'); }
  refreshButtons();
}

const ROLE_LABEL = {
  voice: 'VOICE',
  bgm: 'BGM',
  sfx: 'SFX',
  muted: 'MUTED',
  silent: 'CÂM'
};

function renderAudioTracks() {
  const box = $('#audio-tracks');
  box.innerHTML = '';
  if (!state.tracks.length) {
    $('#audio-summary').textContent = 'Không tìm thấy track video/audio nào trong timeline.';
    return;
  }

  state.tracks.forEach((t) => {
    const row = document.createElement('label');
    row.className = 'track-row' + (t.selected ? ' checked' : '') + (!t.audibleCount ? ' disabled' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!t.selected;
    cb.disabled = !t.audibleCount;
    cb.addEventListener('change', () => {
      t.selected = cb.checked;
      row.classList.toggle('checked', t.selected);
      updateAudioSummary();
      updateMetrics();
      refreshButtons();
      schedulePreviewAudio(250).catch((err) => log('Lỗi cập nhật âm thanh preview: ' + err.message, 'err'));
    });

    const info = document.createElement('div');
    info.className = 'track-info';
    const nm = document.createElement('div');
    nm.className = 'track-name';
    const firstClip = t.segments[0] ? ` · ${t.segments[0].name}` : '';
    nm.textContent = `Track #${t.trackIndex} (${t.type === 'video' ? 'Video' : 'Audio'}) — ${t.name}${firstClip}`;
    const meta = document.createElement('div');
    meta.className = 'track-meta';
    if (t.audibleCount > 0) {
      meta.textContent = `${t.audibleCount} đoạn có tiếng · Tổng ${fmt(t.totalDuration)} · Vol ${Math.round(t.avgVolume * 100)}%`;
    } else {
      meta.textContent = `${t.totalSegs} đoạn (${t.muted ? 'Track đang Mute' : 'Vol 0% hoặc không có âm thanh'})`;
    }
    info.append(nm, meta);

    const badge = document.createElement('span');
    badge.className = `role-badge ${t.role}`;
    badge.textContent = ROLE_LABEL[t.role] || t.role;

    row.append(cb, info, badge);
    box.appendChild(row);
  });

  updateAudioSummary();
}

function updateAudioSummary() {
  const sel = state.tracks.filter((t) => t.selected);
  const segs = sel.flatMap((t) => t.segments);
  const deduped = audio.deduplicateAudioSegments(segs);
  const dupRemoved = segs.length - deduped.length;
  if (!sel.length) {
    $('#audio-summary').textContent = 'Chưa chọn track nào — hãy tích ít nhất 1 track chứa giọng nói.';
    return;
  }
  $('#audio-summary').textContent =
    `Đang chọn ${sel.length} track (${segs.length} đoạn` +
    (dupRemoved > 0 ? `, tự khử ${dupRemoved} đoạn trùng PiP còn ${deduped.length} đoạn` : '') +
    ') để tổng hợp thành Âm thanh tổng 16kHz.';
}

/* ---------- 2. Tổng hợp Âm thanh tổng & Nhận dạng ---------- */
async function listen() {
  const segs = selectedAudioSegments();
  if (!segs.length) {
    log('Vui lòng chọn ít nhất 1 track có tiếng ở bước 2.', 'err');
    return;
  }
  busy(true);
  pausePlayback();
  try {
    const tools = toolState(), model = tools.model;
    log(`Bắt đầu nhận dạng Âm thanh tổng (faster-whisper · CPU int8 · vad_filter) · model ${path.basename(model)}`);

    let mixRes = null;
    if (state.previewPromise) {
      progress(0.05, 'Đang chờ tổng hợp Âm thanh tổng…');
      mixRes = await state.previewPromise;
    }
    if (state.audioDirty || !mixRes || !state.masterWavPath || !fs.existsSync(state.masterWavPath)) {
      const seq = ++state.previewSeq;
      mixRes = await preparePreviewAudio(seq, (p, label) => progress(p * 0.25, label));
    }
    if (!mixRes || !state.masterWavPath) throw new Error('Không tổng hợp được file Âm thanh tổng.');

    if (mixRes.stats.missingFiles.length) {
      log(`Cảnh báo: bỏ qua ${mixRes.stats.missingFiles.length} file không tồn tại trên đĩa (${mixRes.stats.missingFiles[0]}).`, 'err');
    }
    log(
      `Sử dụng Master Audio: ${mixRes.stats.mixedSegments} đoạn từ ${mixRes.stats.uniqueFiles} file gốc` +
      (mixRes.stats.duplicateRemoved ? ` (đã khử ${mixRes.stats.duplicateRemoved} đoạn trùng PiP)` : '') +
      ` → ${fmt(mixRes.stats.durationSec)}.`,
      'ok'
    );

    const lang = $('#lang').value;
    const ws = await whisper.transcribe({
      bin: tools.whisper,
      model,
      wav: state.masterWavPath,
      lang,
      onProgress: (p) => progress(0.25 + p * 0.75, `Đang nghe Âm thanh tổng… ${Math.round(p * 100)}%`)
    });

    audio.alignWordsToAudio(ws, mixRes.wavData);
    audio.addLoudness(ws, mixRes.wavData);
    if (state.words.length) pushUndo('Nhận dạng lại');
    state.words = ws.sort((a, b) => a.start - b.start);
    progress(1, `Hoàn tất · ${state.words.length} từ`);
    log(`Nhận dạng Âm thanh tổng xong: ${state.words.length} từ.`, 'ok');
    renderWords();
    buildTypo(false);
    stashTimeline();
    renderTimelines();
    updateMetrics();
  } catch (e) {
    log(e.message, 'err');
    progress(0, '');
  } finally {
    busy(false);
  }
}

function renderWords() {
  const box = $('#words');
  box.innerHTML = '';
  state.words.forEach((w) => {
    const s = document.createElement('span');
    s.className = 'wchip';
    s.contentEditable = 'true';
    s.spellcheck = false;
    s.title = `${w.start.toFixed(2)}s · gõ dấu cách để tách thành nhiều từ`;
    s.textContent = w.text;
    s.addEventListener('blur', () => {
      const t = s.textContent.replace(/\s+/g, ' ').trim();
      const idx = state.words.indexOf(w);
      if (idx < 0) return;
      if (!t) {
        pushUndo('Xoá từ "' + w.text + '"');
        state.words.splice(idx, 1);
        renderWords();
        buildTypo(false);
      } else if (t.includes(' ')) {
        pushUndo('Tách từ "' + w.text + '"');
        const parts = Layout.splitWordTiming(w, t);
        state.words.splice(idx, 1, ...parts);
        log(`Đã tách "${w.text}" thành ${parts.length} từ: ${parts.map((p) => p.text).join(' | ')}`, 'ok');
        renderWords();
        buildTypo(false);
      } else if (t !== w.text) {
        pushUndo('Sửa từ "' + w.text + '"');
        w.text = t;
        buildTypo(false);
      }
    });
    s.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); s.blur(); } });
    s.addEventListener('dblclick', () => seek(Math.max(0, w.start - 0.15)));
    box.appendChild(s);
    box.appendChild(document.createTextNode(' '));
  });
}

/* ---------- Font & Kiểu chữ ---------- */
const fontFamilies = new Map();
const fontLoading = new Map();
function familyFor(file) {
  if (!file) return 'sans-serif';
  if (fontFamilies.has(file)) return fontFamilies.get(file);
  const fam = 'UF' + fontFamilies.size;
  fontFamilies.set(file, fam);
  const p = (async () => {
    try {
      const buf = fs.readFileSync(file);
      const f = new FontFace(fam, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      document.fonts.add(await f.load());
    } catch (e) {}
  })();
  fontLoading.set(file, p);
  p.then(() => { state.shown = null; drawStage(currentTime()); });
  return fam;
}

const STYLE_KEYS = [
  ['base', 'Chữ thường'], ['script', 'Viết tay'], ['blue', 'Đậm xanh'], ['gold', 'Đậm vàng']
];
const hexOf = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function defaultStyles() {
  const out = {};
  STYLE_KEYS.forEach(([k]) => {
    const s = typo.STYLE[k];
    out[k] = { font: typo.fontPath(s.file, FONTS), color: hexOf(s.color) };
  });
  return out;
}
function loadStyles() {
  const def = defaultStyles();
  const saved = settings.styles || {};
  STYLE_KEYS.forEach(([k]) => {
    const s = saved[k];
    if (s && s.font && fs.existsSync(s.font)) def[k].font = s.font;
    else if (s && s.font) log(`Font đã chọn cho "${k}" không còn trên máy, dùng font mặc định.`, 'err');
    if (s && /^#[0-9a-f]{6}$/i.test(s.color || '')) def[k].color = s.color;
  });
  return def;
}
state.styles = null;
const styleOpts = () => {
  const o = {};
  STYLE_KEYS.forEach(([k]) => { o[k] = { font: state.styles[k].font, color: rgbOf(state.styles[k].color) }; });
  return o;
};
const fontLabel = (file) => {
  const n = ttf.readNames(file);
  return n ? `${n.family} · ${n.style}` : path.basename(file);
};
const viCache = new Map();
const fontHasVi = (file) => {
  if (!viCache.has(file)) viCache.set(file, ttf.hasChars(file, sysfonts.VI_SAMPLE));
  return viCache.get(file);
};

/* ---------- 4. Thuộc tính Typography & Sub Phim Ngang ---------- */
state.mode = settings.mode === 'movie' ? 'movie' : 'typo';
state.effectStyle = (settings.effectStyle && typeof settings.effectStyle === 'object')
  ? settings.effectStyle
  : { border: null, bg: null, shadow: true };
state.sel = null;
state.global = {
  anim: settings.anim || 'auto',
  movieAnim: settings.movieAnim || 'none',
  scale: settings.scale || 100,
  yPos: settings.yposTypo || settings.ypos || 72,
  movieYPos: settings.yposMovie || 86
};
const activeYPos = () => (state.mode === 'movie' ? state.global.movieYPos : state.global.yPos);
const activeAnim = () => (state.mode === 'movie' ? state.global.movieAnim : state.global.anim);
const selGroup = () => (state.mode === 'movie' ? null : (state.groups.find((g) => g.id === state.sel) || null));
const groupIndex = (g) => state.groups.indexOf(g) + 1;

function saveEffectStyle() {
  settings.effectStyle = state.effectStyle;
  save();
}

function updateModeUI() {
  const subTitle = $('#groups-sub');
  if (subTitle) {
    subTitle.firstChild.textContent = state.mode === 'movie' ? 'Các câu phụ đề ngang ' : 'Các cụm chữ ';
  }
  const hint = $('#groups-hint');
  if (hint) {
    hint.textContent = state.mode === 'movie'
      ? '(chế độ Sub Phim Ngang: mỗi câu là 1 dòng ngang 1–2 hàng ở đáy khung · bấm để xem thử)'
      : '(bấm/kéo từ = nhấn cụm · bấm nhãn = đổi kiểu · ✂/Alt+bấm = tách · Ctrl+Z/Y = hoàn tác)';
  }
}

function setMode(nextMode, recordUndo) {
  const m = nextMode === 'movie' ? 'movie' : 'typo';
  if (recordUndo && m !== state.mode) pushUndo('Đổi chế độ ' + (m === 'movie' ? 'Sub Phim' : 'Typography'));
  state.mode = m;
  settings.mode = state.mode;
  save();
  if (state.mode === 'movie') state.sel = null;
  if (state.words.length && !state.movieCues.length) {
    state.movieCues = SRT.groupMovieCues(state.words, state.canvas);
  }
  const bTypo = $('#mode-typo'), bMovie = $('#mode-movie');
  if (bTypo) bTypo.classList.toggle('sel', state.mode === 'typo');
  if (bMovie) bMovie.classList.toggle('sel', state.mode === 'movie');
  updateModeUI();
  renderInspector();
  renderGroups();
  rebuildSegs();
  updateMetrics();
}

function effStyle(k) {
  const g = selGroup();
  const o = g && g.custom && g.custom.styles && g.custom.styles[k];
  return {
    font: (o && o.font) || state.styles[k].font,
    color: (o && o.color) ? hexOf(o.color) : state.styles[k].color,
    overridden: !!(o && (o.font || o.color))
  };
}
function setStyleValue(k, v) {
  pushUndo(v.font ? 'Đổi font chữ' : 'Đổi màu chữ');
  const g = selGroup();
  if (g) {
    g.custom = g.custom || {};
    g.custom.styles = g.custom.styles || {};
    const cs = g.custom.styles[k] = g.custom.styles[k] || {};
    if (v.font) cs.font = v.font;
    if (v.color) cs.color = rgbOf(v.color);
  } else {
    if (v.font) state.styles[k].font = v.font;
    if (v.color) state.styles[k].color = v.color;
    saveStyles();
    if (v.font && k === 'script') {
      scriptOkCache.clear();
      const lo = layoutOpts();
      state.groups.forEach((x) => Layout.relayout(x, lo));
    }
  }
  afterEdit(!!v.font);
}
function afterEdit(replay) {
  renderInspector();
  renderGroups();
  rebuildSegs();
  const g = selGroup();
  if (g && replay) playGroup(g);
}

function renderInspector() {
  const g = selGroup();
  const isMovie = state.mode === 'movie';
  $('#inspector').classList.toggle('editing', !!g);
  $('#insp-target').textContent = isMovie
    ? 'Chế độ Sub Phim Ngang'
    : (g ? `Đang sửa: Cụm #${groupIndex(g)} · ${fmt(g.start)}–${fmt(g.end)}` : 'Mặc định cho mọi cụm');
  $('#insp-hint').textContent = isMovie
    ? 'Cỡ chữ, vị trí đáy, bộ phối viền/nền và kiểu hiện chữ cho phụ đề phim ngang.'
    : (g ? 'Thay đổi ở đây chỉ áp cho cụm đang chọn. Bấm "← Mặc định chung" để sửa cho tất cả.' : 'Bấm vào 1 cụm ở mục 3 để sửa riêng cụm đó.');
  $('#insp-replay').hidden = !g;
  $('#insp-deselect').hidden = !g;
  $('#insp-clear').hidden = !(g && g.custom);

  const grid = $('#insp-anim');
  grid.innerHTML = '';
  const movieAnims = ['none', 'fade', 'float', 'rise'].map((id) => ({ id, label: typo.ANIMS[id].label }));
  const opts = isMovie ? movieAnims : ((g ? [{ id: 'inherit', label: 'Theo mặc định' }] : []).concat(typo.ANIM_LIST));
  const active = isMovie ? state.global.movieAnim : (g ? ((g.custom && g.custom.anim) || 'inherit') : state.global.anim);
  opts.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'anim-btn' + (a.id === active ? ' sel' : '');
    const demo = a.id === 'auto' ? '✦' : a.id === 'inherit' ? '↺' : a.id === 'none' ? '▬' : 'Aa';
    b.innerHTML = `<span class="demo a-${a.id}"><b>${demo}</b></span><span></span>`;
    b.lastChild.textContent = a.label;
    b.addEventListener('click', () => {
      pushUndo('Đổi animation');
      if (isMovie) {
        state.global.movieAnim = a.id; settings.movieAnim = a.id; save();
      } else if (g) {
        g.custom = g.custom || {};
        if (a.id === 'inherit') delete g.custom.anim; else g.custom.anim = a.id;
      } else { state.global.anim = a.id; settings.anim = a.id; save(); }
      afterEdit(true);
      if (!g) log(`Animation ${isMovie ? 'Sub Phim' : 'mặc định'}: ${a.label}`);
    });
    grid.appendChild(b);
  });

  const sc = g && g.custom && g.custom.scale ? Math.round(g.custom.scale * 100) : state.global.scale;
  const yp = g && g.custom && g.custom.yPos ? Math.round(g.custom.yPos * 100) : activeYPos();
  $('#insp-scale').value = sc; $('#insp-scale-v').textContent = sc + '%';
  $('#insp-ypos').value = yp; $('#insp-ypos-v').textContent = yp + '%';

  renderPresets();

  const box = $('#styles');
  box.innerHTML = '';
  STYLE_KEYS.forEach(([k, label]) => {
    const s = effStyle(k);
    const row = document.createElement('div');
    row.className = 'srow';
    row.innerHTML = `<div class="lbl"></div><button class="pick"><span class="sample"></span><span class="meta"></span><span class="go">Bấm để đổi font ›</span></button><input type="color" title="Bấm để đổi màu" />`;
    const lbl = row.querySelector('.lbl');
    lbl.appendChild(styleTag(k, k === 'base' ? '#eef3ff' : s.color, false));
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = k === 'base' ? 'chữ không nhấn' : 'dùng cho từ nhấn';
    lbl.appendChild(sub);
    row.querySelector('.pick').style.borderLeftColor = s.color;
    const sample = row.querySelector('.sample');
    sample.textContent = k === 'base' ? 'thời gian là' : k === 'script' ? 'lãng phí' : k === 'blue' ? 'dự án' : 'nhanh hơn';
    sample.style.fontFamily = `"${familyFor(s.font)}"`;
    sample.style.color = s.color;
    const meta = row.querySelector('.meta');
    meta.textContent = fontLabel(s.font);
    if (s.overridden) {
      const o = document.createElement('span');
      o.className = 'ovr';
      o.textContent = ' · riêng cụm này';
      meta.appendChild(o);
    }
    if (!fontHasVi(s.font)) {
      const w = document.createElement('span');
      w.className = 'warn';
      w.textContent = k === 'script' ? ' · thiếu dấu → dùng Đậm vàng' : ' · thiếu dấu tiếng Việt';
      meta.appendChild(w);
    }
    row.querySelector('.pick').addEventListener('click', () => openFontPicker(k, label));
    const color = row.querySelector('input');
    color.value = s.color;
    color.addEventListener('input', () => { sample.style.color = color.value; });
    color.addEventListener('change', () => setStyleValue(k, { color: color.value }));
    box.appendChild(row);
  });
}
const renderStyles = () => renderInspector();

function applyPreset(preset) {
  pushUndo('Bộ phối ' + preset.name);
  const g = selGroup();
  const keys = ['base', 'script', 'blue', 'gold'];
  if (g) {
    g.custom = g.custom || {};
    g.custom.styles = g.custom.styles || {};
    keys.forEach((k) => {
      const p = preset.styles[k];
      g.custom.styles[k] = { font: typo.fontPath(p.file, FONTS), color: rgbOf(p.color) };
    });
    afterEdit(true);
    log(`Cụm #${groupIndex(g)}: đã áp dụng bộ phối "${preset.name}".`, 'ok');
  } else {
    keys.forEach((k) => {
      const p = preset.styles[k];
      state.styles[k] = { font: typo.fontPath(p.file, FONTS), color: p.color };
    });
    state.effectStyle = {
      border: preset.border ? Object.assign({}, preset.border) : null,
      bg: preset.bg ? Object.assign({}, preset.bg) : null,
      shadow: preset.shadow !== undefined ? preset.shadow : true
    };
    saveEffectStyle();
    onStylesChanged();
    log(`Đã áp dụng bộ phối "${preset.name}" cho toàn bộ dự án.`, 'ok');
  }
}

function renderPresets() {
  const grid = $('#preset-grid');
  if (!grid || !typo.PRESETS) return;
  grid.innerHTML = '';
  const cur = {
    base: effStyle('base'),
    script: effStyle('script'),
    blue: effStyle('blue'),
    gold: effStyle('gold')
  };
  const normJson = (v) => JSON.stringify(v || null);
  typo.PRESETS.forEach((preset) => {
    const fontsMatch = ['base', 'script', 'blue', 'gold'].every((k) =>
      path.basename(cur[k].font).toLowerCase() === preset.styles[k].file.toLowerCase() &&
      cur[k].color.toLowerCase() === preset.styles[k].color.toLowerCase()
    );
    const fxMatch = selGroup() || (
      normJson(state.effectStyle.border) === normJson(preset.border || null) &&
      normJson(state.effectStyle.bg) === normJson(preset.bg || null)
    );
    const isMatch = fontsMatch && fxMatch;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn' + (isMatch ? ' sel' : '');
    btn.innerHTML = `<div class="preset-top"><span class="preset-name"></span><span class="preset-dots"></span></div><div class="preset-desc"></div>`;
    btn.querySelector('.preset-name').textContent = preset.name;
    btn.querySelector('.preset-desc').textContent = preset.desc;
    const dots = btn.querySelector('.preset-dots');
    ['base', 'script', 'blue', 'gold'].forEach((k) => {
      const dot = document.createElement('span');
      dot.className = 'preset-dot';
      dot.style.background = preset.styles[k].color;
      dots.appendChild(dot);
    });
    const tagText = preset.bg ? 'Hộp nền tối' : preset.border ? 'Viền nét chữ' : (preset.movieDefault ? 'Chuẩn phim' : '');
    if (tagText) {
      const tag = document.createElement('span');
      tag.className = 'preset-tag';
      tag.textContent = tagText;
      btn.appendChild(tag);
    }
    btn.addEventListener('click', () => applyPreset(preset));
    grid.appendChild(btn);
  });
}
function saveStyles() { settings.styles = state.styles; save(); }
function onStylesChanged() {
  saveStyles();
  scriptOkCache.clear();
  const lo = layoutOpts();
  state.groups.forEach((g) => Layout.relayout(g, lo));
  afterEdit(false);
}

function selectGroup(g) {
  state.sel = g ? g.id : null;
  renderGroups();
  renderInspector();
  if (g) playGroup(g);
}
function playGroup(g) {
  if (!state.draft) return;
  seek(Math.max(0, g.start - 0.08));
  state.stopAt = Math.max(g.start + 0.35, g.end - 0.15);
  startPlayback();
}

/* ---------- Bảng chọn font ---------- */
let pickerKey = null, observer = null;
async function openFontPicker(key, label) {
  pickerKey = key;
  const g = selGroup();
  $('#fm-style').textContent = label + (g ? ` (cụm #${groupIndex(g)})` : ' (mặc định)');
  $('#font-modal').hidden = false;
  $('#fm-search').focus();
  if (!state.sysFonts) await scanFonts(false);
  renderFontList();
}
async function scanFonts(force) {
  $('#fm-list').innerHTML = '<div class="fm-empty">Đang đọc font trên máy…</div>';
  if (force) { try { fs.unlinkSync(path.join(process.env.APPDATA, 'AutoSubTypo', 'fontcache.json')); } catch (e) {} }
  state.sysFonts = await sysfonts.scan((d, t) => { $('#fm-count').textContent = `Đang đọc ${d}/${t}…`; });
  fs.readdirSync(FONTS).filter((f) => /\.(ttf|otf)$/i.test(f)).forEach((f) => {
    const file = path.join(FONTS, f), n = ttf.readNames(file);
    if (n && !state.sysFonts.some((x) => (x.ps || '') === n.ps)) state.sysFonts.push(Object.assign({ file, vi: fontHasVi(file) }, n));
  });
}
function renderFontList() {
  const list = $('#fm-list');
  const q = $('#fm-search').value.trim().toLowerCase();
  const onlyVi = $('#fm-vi').checked;
  const sampleText = $('#fm-sample').value || 'Thời gian là vàng';
  const cur = effStyle(pickerKey).font;
  const items = (state.sysFonts || []).filter((f) => (!onlyVi || f.vi) && (!q || `${f.family} ${f.style}`.toLowerCase().includes(q)));
  $('#fm-count').textContent = `${items.length} font`;
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) {
      const el = e.target;
      el.querySelector('.sm').style.fontFamily = `"${familyFor(el._font.file)}", sans-serif`;
      observer.unobserve(el);
    }
  }), { root: list, rootMargin: '300px' });
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<div class="fm-empty">Không có font phù hợp.</div>'; return; }
  const frag = document.createDocumentFragment();
  items.forEach((f) => {
    const el = document.createElement('div');
    el.className = 'fm-item' + (f.file === cur ? ' sel' : '');
    el._font = f;
    el.innerHTML = '<div class="nm"><span></span><span class="novi"></span></div><div class="sm"></div>';
    el.querySelector('.nm span').textContent = `${f.family} · ${f.style}`;
    if (!f.vi) el.querySelector('.novi').textContent = 'thiếu dấu tiếng Việt';
    el.querySelector('.sm').textContent = sampleText;
    el.addEventListener('click', () => {
      const g = selGroup();
      closeFontPicker();
      setStyleValue(pickerKey, { font: f.file });
      log(`${g ? `Cụm #${groupIndex(g)}: ` : ''}đổi font "${$('#fm-style').textContent}" → ${f.family} ${f.style}`, 'ok');
    });
    frag.appendChild(el);
    observer.observe(el);
  });
  list.appendChild(frag);
  const sel = list.querySelector('.sel');
  if (sel) sel.scrollIntoView({ block: 'center' });
}
function closeFontPicker() { $('#font-modal').hidden = true; if (observer) observer.disconnect(); }

/* ---------- 3. Typography ---------- */
const layoutLang = () => {
  const l = $('#lang').value;
  if (l !== 'auto') return l;
  return /[ăâđêôơư]/i.test(state.words.map((w) => w.text).join(' ')) ? 'vi' : 'en';
};
const scriptOkCache = new Map();
function layoutOpts() {
  const file = state.styles.script.font;
  return {
    lang: layoutLang(),
    scriptOK: (text) => {
      if (!scriptOkCache.has(text)) scriptOkCache.set(text, ttf.hasChars(file, text));
      return scriptOkCache.get(text);
    }
  };
}
function buildTypo(recordUndo) {
  if (!state.words.length) return;
  if (recordUndo === true && (state.groups.length || state.movieCues.length)) pushUndo('Dàn lại toàn bộ');
  state.groups = Layout.buildLayout(state.words, layoutOpts());
  state.movieCues = SRT.groupMovieCues(state.words, state.canvas);
  state.sel = null;
  rebuildSegs();
  renderGroups();
  renderInspector();
  updateMetrics();
  renderTimelines();
  if (state.mode === 'movie') {
    log(`Dàn ${state.movieCues.length} câu Sub Phim Ngang.`);
  } else {
    log(`Dàn ${state.groups.length} cụm chữ, ${state.groups.filter((g) => (g.emphases && g.emphases.length) || g.span).length} cụm có từ nhấn.`);
  }
}

/* ---------- Tách / Gộp cụm chữ & sửa chữ / lên xuống dòng ---------- */
let editingGroupId = null;
function syncWordsFromGroups(sourceMode) {
  if (sourceMode === 'movie') {
    state.words = state.movieCues.flatMap((c) => (c.words || []).map((w) => ({ text: w.text, start: w.start, end: w.end, rms: w.rms })));
  } else {
    state.words = state.groups.flatMap((g) => (g.words || []).map((w) => ({ text: w.text, start: w.start, end: w.end, rms: w.rms })));
    if (state.words.length) state.movieCues = SRT.groupMovieCues(state.words, state.canvas);
  }
  renderWords();
}
function moveGroupWordLine(g, lineIdx, dir) {
  const gi = state.groups.indexOf(g);
  if (gi < 0) return;
  const pre = captureSnapshot();
  Layout.moveWordLine(g, lineIdx, dir, layoutOpts());
  pushUndo(`${dir < 0 ? 'Lên dòng' : 'Xuống dòng'} cụm #${gi + 1}`, pre);
  afterStructureEdit(g.id, false);
}
function resetGroupLines(g) {
  const gi = state.groups.indexOf(g);
  if (gi < 0) return;
  const pre = captureSnapshot();
  Layout.resetLines(g, layoutOpts());
  pushUndo(`Chia dòng tự động #${gi + 1}`, pre);
  afterStructureEdit(g.id, false);
}
function saveGroupTextEdit(g, rawText) {
  const gi = state.groups.indexOf(g);
  if (gi < 0) return;
  const pre = captureSnapshot();
  const ok = Layout.editGroupText(g, rawText, layoutOpts());
  if (!ok) {
    log('Cụm chữ phải có ít nhất 1 từ.', 'err');
    return;
  }
  Layout.retime(state.groups, 0, state.groups.length - 1, layoutOpts());
  syncWordsFromGroups('typo');
  editingGroupId = null;
  pushUndo(`Sửa chữ cụm #${gi + 1}`, pre);
  log(`✎ Đã cập nhật cụm #${gi + 1}: "${g.words.map((w) => w.text).join(' ')}"`, 'ok');
  afterStructureEdit(g.id, false);
}
function saveMovieCueEdit(ci, rawText) {
  const c = state.movieCues[ci];
  if (!c) return;
  const lines = String(rawText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    log('Câu phụ đề phải có ít nhất 1 chữ.', 'err');
    return;
  }
  pushUndo(`Sửa sub #${ci + 1}`);
  c.text = lines.join('\n');
  const tokens = c.text.split(/\s+/).filter(Boolean);
  c.words = Layout.alignEditedWords(c.words, tokens).words;
  syncWordsFromGroups('movie');
  editingGroupId = null;
  renderGroups();
  renderInspector();
  rebuildSegs();
  stashTimeline();
  renderTimelines();
  updateMetrics();
  log(`✎ Đã cập nhật Sub #${ci + 1}.`, 'ok');
}
function afterStructureEdit(selId, replay) {
  state.sel = selId || null;
  afterEdit(!!replay);
  renderTimelines();
  updateMetrics();
}
function splitGroupAt(g, at) {
  const gi = state.groups.indexOf(g);
  if (gi < 0 || !g.words || at <= 0 || at >= g.words.length) return log('Không tách được: cụm cần ít nhất 2 từ.', 'err');
  const pre = captureSnapshot();
  const res = Layout.splitGroup(state.groups, gi, at, layoutOpts());
  if (!res) return log('Không tách được: cụm cần ít nhất 2 từ.', 'err');
  pushUndo(`Tách cụm #${gi + 1}`, pre);
  log(`✂ Tách cụm #${gi + 1} → "${res[0].words.map((w) => w.text).join(' ')}" | "${res[1].words.map((w) => w.text).join(' ')}"`, 'ok');
  afterStructureEdit(res[1].id, false);
}
function splitGroupHalf(g) {
  const n = g.words.length;
  if (n < 2) return log('Cụm chỉ có 1 từ — không thể tách thêm.', 'err');
  // Chọn chỗ ngắt cân đối số ký tự nhất
  let best = 1, bestD = Infinity;
  const len = (ws) => ws.reduce((s, w) => s + w.text.length + 1, 0);
  for (let k = 1; k < n; k++) {
    const d = Math.abs(len(g.words.slice(0, k)) - len(g.words.slice(k)));
    if (d < bestD) { bestD = d; best = k; }
  }
  splitGroupAt(g, best);
}
function mergeWithNext(g) {
  const gi = state.groups.indexOf(g);
  if (gi < 0 || gi + 1 >= state.groups.length) return log('Không có cụm phía sau để gộp.', 'err');
  const pre = captureSnapshot();
  const m = Layout.mergeGroups(state.groups, gi, layoutOpts());
  if (!m) return log('Không có cụm phía sau để gộp.', 'err');
  pushUndo(`Gộp cụm #${gi + 1} + #${gi + 2}`, pre);
  log(`⤓ Gộp cụm #${gi + 1} với #${gi + 2} → "${m.words.map((w) => w.text).join(' ')}"`, 'ok');
  afterStructureEdit(m.id, false);
}
function splitAtPlayhead() {
  if (!state.groups.length) return;
  const t = currentTime();
  const pre = captureSnapshot();
  const res = Layout.splitAtTime(state.groups, t, layoutOpts());
  if (!res) return log(`Không có cụm chữ (≥ 2 từ) nào tại ${fmt(t)} để tách.`, 'err');
  pushUndo('Tách tại đầu phát ' + fmt(t), pre);
  log(`✂ Tách tại đầu phát ${fmt(t)} → "${res[0].words.map((w) => w.text).join(' ')}" | "${res[1].words.map((w) => w.text).join(' ')}"`, 'ok');
  afterStructureEdit(res[1].id, false);
}
function typoOpts(canvas, modeOverride) {
  const cv = canvas || state.canvas;
  const m = modeOverride || state.mode;
  const fx = state.effectStyle || {};
  return {
    width: cv.width, height: cv.height, fps: cv.fps, fontsDir: FONTS,
    scale: state.global.scale / 100,
    yPos: (m === 'movie' ? state.global.movieYPos : state.global.yPos) / 100,
    anim: m === 'movie' ? state.global.movieAnim : state.global.anim,
    movieAnim: state.global.movieAnim,
    glow: $('#opt-glow').checked,
    border: fx.border || null,
    bg: fx.bg || null,
    shadow: fx.shadow !== undefined ? fx.shadow : true,
    styles: styleOpts()
  };
}
function rebuildSegs() {
  if (state.mode === 'movie') {
    if (!state.movieCues.length && state.words.length) state.movieCues = SRT.groupMovieCues(state.words, state.canvas);
    state.segs = state.movieCues.length ? typo.buildMovieSegments(state.movieCues, typoOpts(null, 'movie')) : [];
  } else {
    state.segs = state.groups.length ? typo.buildSegments(state.groups, typoOpts(null, 'typo')) : [];
  }
  state.shown = null;
  drawStage(currentTime());
  refreshButtons();
}

const STYLE_LABEL = { base: 'Chữ thường', script: 'Viết tay', gold: 'Đậm vàng', blue: 'Đậm xanh' };
let dragSel = null;
let suppressGroupClick = false;
window.addEventListener('mouseup', (e) => {
  if (!dragSel) return;
  const d = dragSel;
  dragSel = null;
  document.querySelectorAll('.gw.selecting').forEach((n) => n.classList.remove('selecting'));
  const g = state.groups.find((x) => x.id === d.gId);
  if (!g) return;
  suppressGroupClick = true;
  setTimeout(() => { suppressGroupClick = false; }, 0);
  const lo = layoutOpts();
  const a = Math.min(d.start, d.cur), b = Math.max(d.start, d.cur);
  if (a === b) {
    if (e.altKey) { if (a > 0) splitGroupAt(g, a); return; }
    pushUndo('Đổi kiểu nhấn "' + (g.words[a] ? g.words[a].text : '') + '"');
    Layout.toggleWord(g, a, e.shiftKey, lo, state.brush);
  } else {
    const phrase = g.words.slice(a, b + 1).map((w) => w.text).join(' ');
    pushUndo(`Nhấn cụm "${phrase}"`);
    Layout.applySpan(g, a, b, state.brush || 'auto', lo);
  }
  state.sel = g.id;
  afterEdit(true);
});

function styleTag(style, color, clickable, phraseSnippet, onRemove) {
  const t = document.createElement('span');
  t.className = 'stag' + (style ? '' : ' none');
  if (style) {
    t.style.color = color;
    if (style === 'script') t.style.fontStyle = 'italic';
  }
  if (phraseSnippet) {
    const ph = document.createElement('span');
    ph.className = 'phrase';
    ph.textContent = `«${phraseSnippet}»`;
    t.appendChild(ph);
  }
  const label = document.createElement('span');
  label.textContent = style ? STYLE_LABEL[style] : 'Không nhấn';
  t.appendChild(label);
  if (clickable) {
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = '⇄';
    t.appendChild(ic);
  }
  if (onRemove) {
    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '×';
    del.title = 'Bỏ kiểu nhấn này';
    del.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
    t.appendChild(del);
  }
  return t;
}
function updateDragHighlight() {
  document.querySelectorAll('.gw.selecting').forEach((n) => n.classList.remove('selecting'));
  if (!dragSel || !dragSel.cardEl) return;
  const a = Math.min(dragSel.start, dragSel.cur), b = Math.max(dragSel.start, dragSel.cur);
  dragSel.cardEl.querySelectorAll('.gw').forEach((el) => {
    const wi = parseInt(el.dataset.wi, 10);
    if (wi >= a && wi <= b) el.classList.add('selecting');
  });
}
function renderGroups() {
  const box = $('#groups');
  box.innerHTML = '';
  if (state.mode === 'movie') {
    if (!state.movieCues.length && state.words.length) state.movieCues = SRT.groupMovieCues(state.words, state.canvas);
    state.movieCues.forEach((c, ci) => {
      const mId = 'm' + ci;
      const el = document.createElement('div');
      el.className = 'grp';
      el.dataset.id = mId;
      el.title = 'Bấm để xem thử câu phụ đề này · Đúp chuột để sửa chữ / xuống dòng';
      el.addEventListener('click', () => { if (editingGroupId !== mId) playGroup(c); });
      const head = document.createElement('div');
      head.className = 'grp-h';
      const time = document.createElement('span');
      time.textContent = `#${ci + 1} · ${fmt(c.start)} – ${fmt(c.end)}`;
      const acts = document.createElement('div');
      acts.className = 'grp-acts';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'grp-act';
      editBtn.textContent = '✎ Sửa';
      editBtn.title = 'Sửa chữ & xuống dòng (Enter = xuống dòng, Ctrl+Enter = lưu)';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editingGroupId = editingGroupId === mId ? null : mId;
        renderGroups();
      });
      acts.appendChild(editBtn);
      time.appendChild(acts);
      const tag = document.createElement('span');
      tag.className = 'stag';
      tag.style.color = '#a5f3fc';
      tag.textContent = 'Sub ngang';
      head.append(time, tag);
      el.appendChild(head);
      if (editingGroupId === mId) {
        const wrap = document.createElement('div');
        wrap.className = 'grp-edit-wrap';
        wrap.addEventListener('click', (e) => e.stopPropagation());
        const ta = document.createElement('textarea');
        ta.className = 'grp-edit-ta';
        ta.rows = Math.min(4, Math.max(2, c.text.split(/\r?\n/).length + 1));
        ta.value = c.text;
        ta.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveMovieCueEdit(ci, ta.value); }
          else if (e.key === 'Escape') { e.preventDefault(); editingGroupId = null; renderGroups(); }
        });
        const bar = document.createElement('div');
        bar.className = 'grp-edit-bar';
        const hint = document.createElement('span');
        hint.className = 'grp-edit-hint';
        hint.textContent = 'Enter = xuống dòng · Backspace = lên dòng · Ctrl+Enter = lưu · Esc = huỷ';
        const btns = document.createElement('div');
        btns.className = 'grp-edit-btns';
        const bSave = document.createElement('button');
        bSave.type = 'button';
        bSave.className = 'grp-act grp-act-save';
        bSave.textContent = '✓ Lưu';
        bSave.addEventListener('click', () => saveMovieCueEdit(ci, ta.value));
        const bCancel = document.createElement('button');
        bCancel.type = 'button';
        bCancel.className = 'grp-act';
        bCancel.textContent = '✕ Huỷ';
        bCancel.addEventListener('click', () => { editingGroupId = null; renderGroups(); });
        btns.append(bSave, bCancel);
        bar.append(hint, btns);
        wrap.append(ta, bar);
        el.appendChild(wrap);
        setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
      } else {
        const txt = document.createElement('div');
        txt.className = 'movie-cue-txt';
        txt.textContent = c.text;
        txt.addEventListener('dblclick', (e) => { e.stopPropagation(); editingGroupId = mId; renderGroups(); });
        el.appendChild(txt);
      }
      box.appendChild(el);
    });
    return;
  }
  const lo = layoutOpts();
  const animLabel = (id) => (typo.ANIM_LIST.find((a) => a.id === id) || {}).label || id;
  state.groups.forEach((g, gi) => {
    Layout.syncGroup(g, lo);
    const el = document.createElement('div');
    el.className = 'grp' + (g.id === state.sel ? ' selected' : '');
    el.dataset.id = g.id;
    el.title = 'Bấm để chọn cụm này: sửa thuộc tính riêng + xem thử';
    el.addEventListener('click', () => { if (!suppressGroupClick && editingGroupId !== g.id) selectGroup(g); });
    const head = document.createElement('div');
    head.className = 'grp-h';
    const time = document.createElement('span');
    time.textContent = `#${gi + 1} · ${fmt(g.start)} – ${fmt(g.end)}`;
    if (g.custom && Object.keys(g.custom).length) {
      const b = document.createElement('span');
      b.className = 'custom-badge';
      b.textContent = '● tuỳ chỉnh' + (g.custom.anim ? ` · ${animLabel(g.custom.anim)}` : '');
      time.appendChild(b);
    }
    const gs = (k) => {
      const o = g.custom && g.custom.styles && g.custom.styles[k];
      return { font: (o && o.font) || state.styles[k].font, color: (o && o.color) ? hexOf(o.color) : state.styles[k].color };
    };
    const tagbox = document.createElement('div');
    tagbox.className = 'tagbox';
    const ems = g.emphases || [];
    const pills = document.createElement('div');
    pills.className = 'tagpills';
    if (!ems.length) {
      const tag = styleTag(null, null, false);
      tag.title = 'Cụm này chưa có từ nhấn — bấm hoặc kéo qua các từ để nhấn';
      pills.appendChild(tag);
    } else {
      ems.forEach((em, emIdx) => {
        const snippet = ems.length > 1 ? g.words.slice(em.start, em.end + 1).map((w) => w.text).join(' ') : '';
        const tag = styleTag(em.style, gs(em.style).color, true, snippet, () => {
          pushUndo(`Bỏ nhấn #${gi + 1}`);
          Layout.removeSpan(g, lo, emIdx);
          state.sel = g.id;
          afterEdit(true);
        });
        tag.title = 'Bấm để đổi kiểu (Viết tay → Đậm xanh → Đậm vàng) · Bấm × để bỏ nhấn vùng này';
        tag.addEventListener('click', (e) => {
          e.stopPropagation();
          pushUndo(`Đổi kiểu nhấn #${gi + 1}`);
          Layout.cycleStyle(g, lo, emIdx);
          state.sel = g.id;
          afterEdit(true);
        });
        pills.appendChild(tag);
      });
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = ems.length ? 'bấm nhãn = đổi kiểu · kéo từ = thêm cụm nhấn' : 'bấm hoặc kéo qua cụm từ để nhấn';
    tagbox.append(pills, hint);
    const acts = document.createElement('div');
    acts.className = 'grp-acts';
    const mkAct = (label, title, fn, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'grp-act';
      b.textContent = label;
      b.title = title;
      b.disabled = !!disabled;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      acts.appendChild(b);
    };
    mkAct('✎ Sửa', 'Sửa nội dung chữ & ngắt dòng trực tiếp trong cụm này', () => {
      editingGroupId = editingGroupId === g.id ? null : g.id;
      state.sel = g.id;
      renderGroups();
    }, false);
    if (Array.isArray(g.lineBreaks)) {
      mkAct('↺ Dòng', 'Khôi phục tự động chia dòng theo độ rộng', () => resetGroupLines(g), false);
    }
    mkAct('✂ Tách', 'Tách cụm này làm đôi (chỗ ngắt cân đối nhất). Muốn chọn chỗ tách: bấm ✂ giữa các từ hoặc Alt+bấm vào từ', () => splitGroupHalf(g), g.words.length < 2);
    mkAct('⤓ Gộp', 'Gộp cụm này với cụm ngay sau', () => mergeWithNext(g), gi >= state.groups.length - 1);
    time.appendChild(acts);
    head.append(time, tagbox);
    el.appendChild(head);
    if (editingGroupId === g.id) {
      const wrap = document.createElement('div');
      wrap.className = 'grp-edit-wrap';
      wrap.addEventListener('click', (e) => e.stopPropagation());
      const ta = document.createElement('textarea');
      ta.className = 'grp-edit-ta';
      ta.rows = Math.min(5, Math.max(2, g.lines.length + 1));
      ta.value = g.lines.map((ln) => ln.words.map((w) => w.text).join(' ')).join('\n');
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveGroupTextEdit(g, ta.value); }
        else if (e.key === 'Escape') { e.preventDefault(); editingGroupId = null; renderGroups(); }
      });
      const bar = document.createElement('div');
      bar.className = 'grp-edit-bar';
      const eHint = document.createElement('span');
      eHint.className = 'grp-edit-hint';
      eHint.textContent = 'Enter = xuống dòng · Backspace = lên dòng · Ctrl+Enter = lưu · Esc = huỷ';
      const btns = document.createElement('div');
      btns.className = 'grp-edit-btns';
      const bSave = document.createElement('button');
      bSave.type = 'button';
      bSave.className = 'grp-act grp-act-save';
      bSave.textContent = '✓ Lưu';
      bSave.addEventListener('click', () => saveGroupTextEdit(g, ta.value));
      const bCancel = document.createElement('button');
      bCancel.type = 'button';
      bCancel.className = 'grp-act';
      bCancel.textContent = '✕ Huỷ';
      bCancel.addEventListener('click', () => { editingGroupId = null; renderGroups(); });
      btns.append(bSave, bCancel);
      bar.append(eHint, btns);
      wrap.append(ta, bar);
      el.appendChild(wrap);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    } else {
      g.lines.forEach((ln, li) => {
        const d = document.createElement('div');
        d.className = 'gl s-' + ln.style;
        const wordsWrap = document.createElement('span');
        wordsWrap.className = 'gl-words';
        ln.words.forEach((w) => {
          if (w.i > 0) {
            const cut = document.createElement('span');
            cut.className = 'cut';
            cut.textContent = '✂';
            cut.title = `Tách cụm tại đây (trước "${w.text}")`;
            cut.addEventListener('click', (e) => { e.stopPropagation(); splitGroupAt(g, w.i); });
            wordsWrap.appendChild(cut);
          }
          const wst = w.style || ln.style || 'base';
          const s = document.createElement('span');
          s.className = 'gw s-' + wst;
          s.dataset.wi = String(w.i);
          s.textContent = w.text;
          if (wst !== 'base') {
            s.style.color = gs(wst).color;
            if (wst === 'script') s.style.fontFamily = `"${familyFor(gs('script').font)}"`;
          }
          s.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            dragSel = { gId: g.id, cardEl: el, start: w.i, cur: w.i };
            updateDragHighlight();
          });
          s.addEventListener('mouseenter', () => {
            if (dragSel && dragSel.gId === g.id) {
              dragSel.cur = w.i;
              updateDragHighlight();
            }
          });
          s.addEventListener('click', (e) => { e.stopPropagation(); });
          wordsWrap.append(s, document.createTextNode(' '));
        });
        d.appendChild(wordsWrap);
        const canUp = li > 0;
        const canDown = li < g.lines.length - 1 || ln.words.length >= 2;
        if (canUp || canDown) {
          const lActs = document.createElement('span');
          lActs.className = 'gl-acts';
          if (canUp) {
            const bUp = document.createElement('button');
            bUp.type = 'button';
            bUp.className = 'gl-act';
            bUp.textContent = '↑';
            bUp.title = 'Lên dòng: đưa từ đầu của dòng này lên dòng trên';
            bUp.addEventListener('click', (e) => { e.stopPropagation(); moveGroupWordLine(g, li, -1); });
            lActs.appendChild(bUp);
          }
          if (canDown) {
            const bDn = document.createElement('button');
            bDn.type = 'button';
            bDn.className = 'gl-act';
            bDn.textContent = '↓';
            bDn.title = li < g.lines.length - 1 ? 'Xuống dòng: đẩy từ cuối xuống dòng dưới' : 'Xuống dòng: tách từ cuối sang dòng mới';
            bDn.addEventListener('click', (e) => { e.stopPropagation(); moveGroupWordLine(g, li, 1); });
            lActs.appendChild(bDn);
          }
          d.appendChild(lActs);
        }
        el.appendChild(d);
      });
    }
    box.appendChild(el);
  });
  const sel = box.querySelector('.selected');
  if (sel && !isVisibleIn(sel, box)) sel.scrollIntoView({ block: 'nearest' });
}
function isVisibleIn(el, box) {
  const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  return a.top >= b.top && a.bottom <= b.bottom;
}

/* ---------- Xem thử toàn timeline: Master WAV + chuyển clip hình tự động ---------- */
function interp(keys, t) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0 || 1));
    }
  }
  return keys[keys.length - 1][1];
}

function drawStage(t) {
  const host = $('#stage-text');
  const W = state.canvas.width, H = state.canvas.height;
  const sw = $('#stage').clientWidth || 1;
  const k = sw / W;
  // Đồng bộ tuyệt đối với hệ quy chiếu cỡ chữ thực tế của CapCut PC (font_size * W / 216).
  const unitPx = typo.capcutUnitPx ? typo.capcutUnitPx(W) : (W / 216);
  const active = state.segs.filter((s) => t >= s.start && t < s.end);
  const key = active.map((s) => s.lane + s.start).join('|') + sw;
  if (key !== state.shown) {
    host.innerHTML = '';
    active.forEach((s) => {
      const fScale = typo.capcutFontScale ? typo.capcutFontScale(s.font) : 1;
      const renPx = s.px != null ? s.px : (s.size * unitPx * fScale);
      const d = document.createElement('div');
      d.className = 'w' + (s.isMovieSub ? ' movie-sub' : '');
      d.textContent = s.text;
      d.style.fontSize = (renPx * k) + 'px';
      d.style.fontFamily = `"${familyFor(s.font)}", sans-serif`;
      const rgb = s.color.map((v) => Math.round(v * 255)).join(',');
      d.style.color = `rgb(${rgb})`;
      if (s.border && (s.border.width || s.border.color)) {
        const px = Math.max(1, Math.round(renPx * k * (s.border.width || 0.08) * 1.15));
        d.style.webkitTextStroke = `${px}px ${s.border.color || '#000000'}`;
        d.style.paintOrder = 'stroke fill';
      }
      if (s.bg && s.bg.alpha > 0) {
        const bgRgb = rgbOf(s.bg.color || '#000000').map((v) => Math.round(v * 255)).join(',');
        d.style.background = `rgba(${bgRgb},${s.bg.alpha})`;
        d.style.padding = '0.2em 0.55em';
        d.style.borderRadius = ((s.bg.round || 0.35) * 0.9) + 'em';
      }
      d.style.textShadow = (s.glow ? `0 0 .1em rgba(${rgb},.35), ` : '') + (s.shadow ? '0 .06em .16em rgba(0,0,0,.72)' : 'none');
      d._seg = s;
      host.appendChild(d);
    });
    state.shown = key;
    let activeId = null;
    if (state.mode === 'movie') {
      const ci = state.movieCues.findIndex((x) => t >= x.start && t < x.end);
      if (ci >= 0) activeId = 'm' + ci;
    } else {
      const g = state.groups.find((x) => t >= x.start && t < x.end);
      if (g) activeId = g.id;
    }
    document.querySelectorAll('.grp').forEach((el) => el.classList.toggle('active', !!activeId && el.dataset.id === activeId));
  }
  host.childNodes.forEach((d) => {
    const s = d._seg, lt = t - s.start;
    const kf = s.keyframes || {};
    const x = interp(kf.x, lt), y = interp(kf.y, lt), a = interp(kf.alpha, lt), sc = interp(kf.scale, lt);
    const xN = x === null ? s.x : x, yN = y === null ? s.y : y;
    d.style.left = ((xN + 1) / 2 * 100) + '%';
    d.style.top = ((1 - (yN + 1) / 2) * 100) + '%';
    d.style.transform = `translate(-50%, -50%) scale(${sc === null ? 1 : sc})`;
    d.style.opacity = a === null ? 1 : Math.max(0, Math.min(1, a));
  });
  $('#time').textContent = fmt(t);
  const dur = mediaDuration();
  if (dur) $('#scrub').value = Math.round((t / dur) * 1000);
}

function findVisualAt(t) {
  const hits = state.visualClips.filter((c) => c.visible !== false && t >= c.start && t < c.end && fs.existsSync(c.path));
  if (!hits.length) return null;
  const videoHit = hits.find((c) => c.type !== 'photo');
  return videoHit || hits[0];
}

function syncVisualAt(t, isPlaying) {
  const v = $('#video');
  const img = $('#stage-photo');
  const clip = findVisualAt(t);
  if (!clip) {
    if (!v.paused) v.pause();
    img.hidden = true;
    v.hidden = true;
    return;
  }
  if (clip.type === 'photo') {
    if (!v.paused) v.pause();
    v.hidden = true;
    img.hidden = false;
    if (state.activePhoto !== clip.path) {
      state.activePhoto = clip.path;
      img.src = pathToFileURL(clip.path).href;
    }
    return;
  }

  img.hidden = true;
  v.hidden = false;
  v.muted = true; // Âm thanh tổng phát qua #master-audio; nếu chưa tổng hợp WAV thì tắt tiếng hình để tránh giật khi chuyển clip
  const targetTime = Math.max(0, clip.sourceStart + (t - clip.start) * (clip.speed || 1));
  const rate = Math.min(4, Math.max(0.25, clip.speed || 1));

  if (state.activeSrc !== clip.path) {
    state.activeSrc = clip.path;
    state.pendingSeek = targetTime;
    v.src = pathToFileURL(clip.path).href;
    v.playbackRate = rate;
    if (isPlaying) v.play().catch(() => {});
  } else {
    if (Math.abs(v.playbackRate - rate) > 0.02) v.playbackRate = rate;
    if (!isPlaying || Math.abs(v.currentTime - targetTime) > 0.25) {
      if (v.readyState >= 1) v.currentTime = targetTime;
      else state.pendingSeek = targetTime;
    }
    if (isPlaying && v.paused) v.play().catch(() => {});
    else if (!isPlaying && !v.paused) v.pause();
  }
}

const mediaDuration = () => state.projectDuration || (state.draft ? state.draft.duration : 0);
function currentTime() {
  if (state.masterAudioUrl) return $('#master-audio').currentTime || 0;
  return state.playTime || 0;
}

function seek(t) {
  const dur = mediaDuration();
  t = Math.max(0, Math.min(dur || t, t));
  state.playTime = t;
  if (state.masterAudioUrl) {
    const ma = $('#master-audio');
    if (ma.readyState >= 1) ma.currentTime = t;
  }
  syncVisualAt(t, state.playing);
  drawStage(t);
}

async function startPlayback() {
  if (!state.draft) return;
  const draftPath = state.draft.dir;
  state.wantPlay = true;
  if (state.previewPromise && (state.audioDirty || !state.masterAudioUrl)) {
    $('#audio-mode-pill').textContent = '⏳ Đang tổng hợp âm thanh…';
    try { await state.previewPromise; } catch (e) {}
  }
  if (!state.wantPlay || !state.draft || state.draft.dir !== draftPath) return;
  if (currentTime() >= mediaDuration() - 0.05) seek(0);
  state.playing = true;
  state.lastFrameTs = performance.now();
  $('#btn-play').textContent = '❚❚';
  if (state.masterAudioUrl) {
    const ma = $('#master-audio');
    ma.muted = false;
    ma.volume = Math.max(0, Math.min(1, parseInt(($('#player-vol') && $('#player-vol').value) || '100', 10) / 100));
    if (ma.readyState < 1) {
      await new Promise((resolve) => {
        const done = () => { ma.removeEventListener('canplay', done); ma.removeEventListener('error', done); resolve(); };
        ma.addEventListener('canplay', done, { once: true });
        ma.addEventListener('error', done, { once: true });
        setTimeout(done, 1500);
      });
    }
    if (!state.wantPlay || !state.draft || state.draft.dir !== draftPath) {
      pausePlayback();
      return;
    }
    try { await ma.play(); } catch (e) { log('Không phát được âm thanh preview: ' + e.message, 'err'); }
    if (!state.wantPlay || !state.draft || state.draft.dir !== draftPath) {
      if (!ma.paused) ma.pause();
      pausePlayback();
      return;
    }
  }
  syncVisualAt(currentTime(), true);
}

function pausePlayback() {
  state.wantPlay = false;
  state.playing = false;
  state.stopAt = null;
  $('#btn-play').textContent = '▶';
  const ma = $('#master-audio');
  if (!ma.paused) ma.pause();
  const v = $('#video');
  if (!v.paused) v.pause();
  drawStage(currentTime());
}

function loop(now) {
  if (state.playing) {
    let t;
    if (state.masterAudioUrl) {
      const ma = $('#master-audio');
      t = ma.currentTime;
      if (ma.ended || t >= mediaDuration()) {
        pausePlayback();
        seek(0);
        requestAnimationFrame(loop);
        return;
      }
    } else {
      const dt = Math.min(0.1, (now - (state.lastFrameTs || now)) / 1000);
      state.lastFrameTs = now;
      state.playTime = Math.min(mediaDuration(), state.playTime + dt);
      t = state.playTime;
      if (t >= mediaDuration()) {
        pausePlayback();
        seek(0);
        requestAnimationFrame(loop);
        return;
      }
    }
    if (state.stopAt && t >= state.stopAt) {
      pausePlayback();
      requestAnimationFrame(loop);
      return;
    }
    syncVisualAt(t, true);
    drawStage(t);
  }
  requestAnimationFrame(loop);
}

/* ---------- 5. Ghi vào CapCut ---------- */
async function writeToCapCut() {
  const res = $('#write-result');
  res.hidden = false;
  if (cc.isCapCutRunning()) {
    res.className = 'result warn';
    res.innerHTML = 'CapCut đang mở. Hãy <b>đóng hẳn CapCut</b> (cả biểu tượng dưới khay hệ thống) rồi bấm lại "Ghi vào CapCut".';
    return;
  }
  busy(true);
  try {
    stashTimeline();
    const cur = state.tlCache.get(tlKey(state.draft.dir, state.timelineId));
    let jobs = [cur];
    if ($('#opt-all-tl').checked && !$('#opt-all-tl-wrap').hidden) {
      const others = cachedTimelines(state.draft.dir).filter((c) => (c.timelineId || null) !== (state.timelineId || null));
      jobs = jobs.concat(others);
      const order = (c) => { const i = state.timelines.findIndex((t) => (t.id || null) === (c.timelineId || null)); return i < 0 ? 999 : i; };
      jobs.sort((a, b) => order(a) - order(b));
    }
    const isMovie = state.mode === 'movie';
    jobs = jobs.filter((j) => j && (isMovie ? ((j.movieCues && j.movieCues.length) || (j.words && j.words.length)) : (j.groups && j.groups.length)));
    if (!jobs.length) throw new Error(isMovie ? 'Chưa có câu phụ đề nào để ghi.' : 'Chưa có cụm chữ nào để ghi.');

    const dest = state.draft.dir;
    const replaceOld = $('#opt-replace') ? $('#opt-replace').checked : true;
    const replaceNames = ['AutoSub Typo', 'AutoSub Sub Phim', 'AutoSub Phụ đề'];
    const multi = state.timelines.length > 1;
    const summary = [];
    let totalSegs = 0, totalCaps = 0;
    for (const job of jobs) {
      if (isMovie) {
        const cues = (job.movieCues && job.movieCues.length) ? job.movieCues : SRT.groupMovieCues(job.words, job.canvas);
        const segs = typo.buildMovieSegments(cues, typoOpts(job.canvas, 'movie'));
        cc.addTextTrack(dest, segs, { name: 'AutoSub Sub Phim', timelineId: job.timelineId, replace: replaceOld, replaceNames });
        totalSegs += segs.length;
        summary.push(`${job.name}: ${segs.length} dòng sub ngang`);
      } else {
        const segs = typo.buildSegments(job.groups, typoOpts(job.canvas, 'typo'));
        const caps = $('#opt-sub').checked
          ? typo.buildCaptionSegments(SRT.groupCues(job.words), { width: job.canvas.width, height: job.canvas.height, fontsDir: FONTS })
          : [];
        cc.addTextTrack(dest, segs, { name: 'AutoSub Typo', timelineId: job.timelineId, replace: replaceOld, replaceNames });
        if (caps.length) cc.addTextTrack(dest, caps, { name: 'AutoSub Phụ đề', timelineId: job.timelineId, replace: false });
        totalSegs += segs.length;
        totalCaps += caps.length;
        summary.push(`${job.name}: ${segs.length} đoạn chữ${caps.length ? ` + ${caps.length} phụ đề` : ''}`);
      }
    }
    const name = state.draft.name || path.basename(dest);
    res.className = 'result';
    res.innerHTML = isMovie
      ? `Đã ghi thẳng vào project <b></b> (${totalSegs} dòng Sub Phim Ngang).` + (multi ? '<div class="muted small tl-sum"></div>' : '') + ' Mở CapCut để xem ngay.'
      : `Đã ghi thẳng vào project <b></b> với ${totalSegs} đoạn chữ${totalCaps ? ` + ${totalCaps} dòng phụ đề` : ''}.` +
        (multi ? '<div class="muted small tl-sum"></div>' : '') + ' Mở CapCut để xem ngay.';
    res.querySelector('b').textContent = name;
    if (multi) res.querySelector('.tl-sum').textContent = 'Timeline: ' + summary.join(' · ') + ' (trong CapCut chọn đúng timeline để xem).';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Mở CapCut';
    btn.addEventListener('click', openCapCut);
    res.appendChild(btn);
    log(`Đã ghi thẳng vào project "${name}"${multi ? ` — ${summary.join(' · ')}` : ''}.`, 'ok');
    renderTimelines();
    renderDrafts();
  } catch (e) {
    res.className = 'result warn';
    res.textContent = 'Lỗi khi ghi: ' + e.message;
    log(e.stack || e.message, 'err');
  } finally { busy(false); }
}
function openCapCut() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'CapCut', 'Apps', 'CapCut.exe')
  ];
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Bytedance\\CapCut', '/v', 'installDir'], {
      encoding: 'utf8', windowsHide: true, timeout: 2000
    });
    const m = r.status === 0 && r.stdout && r.stdout.match(/installDir\s+REG_\w+\s+(.+)/i);
    if (m && m[1]) candidates.unshift(path.join(m[1].trim(), 'CapCut.exe'));
  } catch (e) {}
  candidates.push(
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'CapCut', 'CapCut.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'CapCut', 'CapCut.exe')
  );
  const exe = candidates.find((p) => p && fs.existsSync(p));
  if (!exe) return log('Không tìm thấy CapCut.exe trên máy — hãy mở CapCut thủ công từ Desktop/Start Menu.', 'err');
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
}

/* ---------- Khởi động ---------- */
async function loadFonts() {
  const list = [
    ['ES SemiBold', 'EncodeSansSemiExpanded-SemiBold.ttf'],
    ['ES Black', 'EncodeSansSemiExpanded-Black.ttf'],
    ['ES Bold', 'EncodeSansSemiExpanded-Bold.ttf'],
    ['AST Romanesco', 'Romanesco-Regular.ttf'],
    ['Montserrat Bold', 'Montserrat-Bold.ttf'],
    ['Montserrat Black', 'Montserrat-Black.ttf'],
    ['Dancing Script Bold', 'DancingScript-Bold.ttf'],
    ['SVN-Bali Script', 'SVN-Bali Script.ttf'],
    ['SVN-Blenda Script', 'SVN-Blenda Script.ttf'],
    ['SVN-Gilroy Bold', 'SVN-Gilroy Bold.otf'],
    ['SVN-Gilroy Heavy', 'SVN-Gilroy Heavy.otf'],
    ['Oswald Bold', 'Oswald-Bold.ttf'],
    ['Anton Regular', 'Anton-Regular.ttf'],
    ['SVN-Abril Fatface', 'SVN-Abril Fatface.ttf'],
    ['Quicksand Bold', 'Quicksand-Bold.ttf'],
    ['Lora Bold Italic', 'Lora-BoldItalic.ttf']
  ];
  await Promise.all(list.map(async ([family, file]) => {
    const p = path.join(FONTS, file);
    if (!fs.existsSync(p)) return;
    try {
      const buf = fs.readFileSync(p);
      const f = new FontFace(family, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      document.fonts.add(await f.load());
    } catch (e) { log(`Không nạp được font ${file}: ${e.message}`, 'err'); }
  }));
}

/* ---------- Kéo đổi kích thước bố cục & lưu trạng thái ---------- */
function initResizableLayout() {
  const cols = $('.cols');
  const right = $('.right');
  const stageEl = $('#stage');
  const boxIds = ['drafts', 'audio-tracks', 'words', 'groups'];
  const redrawStage = () => {
    state.shown = null;
    drawStage(currentTime());
  };
  const ensureLayout = () => {
    settings.layout = settings.layout || {};
    return settings.layout;
  };
  const applyBoxHeight = (el, h) => {
    el.style.maxHeight = h + 'px';
    el.style.height = h + 'px';
  };
  const clearBoxHeight = (el) => {
    el.style.maxHeight = '';
    el.style.height = '';
  };

  const saved = settings.layout;
  if (saved && typeof saved === 'object') {
    if (typeof saved.rightW === 'number' && Number.isFinite(saved.rightW)) {
      cols.style.setProperty('--right-w', saved.rightW + 'px');
    }
    if (typeof saved.stageMaxH === 'number' && Number.isFinite(saved.stageMaxH)) {
      right.style.setProperty('--stage-max-h', saved.stageMaxH + 'px');
    }
    if (saved.boxes && typeof saved.boxes === 'object') {
      boxIds.forEach((id) => {
        const h = saved.boxes[id];
        const el = document.getElementById(id);
        if (el && typeof h === 'number' && Number.isFinite(h)) applyBoxHeight(el, h);
      });
    }
  }

  const splitCols = $('#split-cols');
  if (splitCols) {
    splitCols.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      splitCols.classList.add('dragging');
      document.body.classList.add('resizing-col');
      let latestW = null;
      const onMove = (ev) => {
        const rect = cols.getBoundingClientRect();
        const maxRight = Math.max(280, rect.width - 380);
        latestW = Math.round(Math.max(280, Math.min(maxRight, rect.right - ev.clientX)));
        cols.style.setProperty('--right-w', latestW + 'px');
        redrawStage();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        splitCols.classList.remove('dragging');
        document.body.classList.remove('resizing-col');
        if (latestW !== null) { ensureLayout().rightW = latestW; save(); }
        redrawStage();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    splitCols.addEventListener('dblclick', () => {
      cols.style.removeProperty('--right-w');
      if (settings.layout) { delete settings.layout.rightW; save(); }
      redrawStage();
    });
  }

  const splitRight = $('#split-right');
  if (splitRight) {
    splitRight.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      splitRight.classList.add('dragging');
      document.body.classList.add('resizing-row');
      const wrap = $('.stage-wrap');
      const player = $('.player');
      const playerH = (player ? player.offsetHeight : 34) + 18;
      let latestH = null;
      const onMove = (ev) => {
        const rightRect = right.getBoundingClientRect();
        const wrapTop = wrap ? wrap.getBoundingClientRect().top : rightRect.top;
        const maxH = Math.max(220, rightRect.height - 170);
        latestH = Math.round(Math.max(140, Math.min(maxH, ev.clientY - wrapTop - playerH)));
        right.style.setProperty('--stage-max-h', latestH + 'px');
        redrawStage();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        splitRight.classList.remove('dragging');
        document.body.classList.remove('resizing-row');
        if (latestH !== null) { ensureLayout().stageMaxH = latestH; save(); }
        redrawStage();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    splitRight.addEventListener('dblclick', () => {
      right.style.removeProperty('--stage-max-h');
      if (settings.layout) { delete settings.layout.stageMaxH; save(); }
      redrawStage();
    });
  }

  document.querySelectorAll('.box-resizer[data-box]').forEach((handle) => {
    const boxId = handle.dataset.box;
    const box = document.getElementById(boxId);
    if (!box) return;
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.classList.add('dragging');
      document.body.classList.add('resizing-row');
      const startY = e.clientY;
      const startH = box.getBoundingClientRect().height;
      let latestH = null;
      const onMove = (ev) => {
        latestH = Math.round(Math.max(85, Math.min(780, startH + (ev.clientY - startY))));
        applyBoxHeight(box, latestH);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-row');
        if (latestH !== null) {
          const lo = ensureLayout();
          lo.boxes = lo.boxes || {};
          lo.boxes[boxId] = latestH;
          save();
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('dblclick', () => {
      clearBoxHeight(box);
      if (settings.layout && settings.layout.boxes) {
        delete settings.layout.boxes[boxId];
        save();
      }
    });
  });

  const btnReset = $('#btn-reset-layout');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      cols.style.removeProperty('--right-w');
      right.style.removeProperty('--stage-max-h');
      boxIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) clearBoxHeight(el);
      });
      delete settings.layout;
      save();
      redrawStage();
      log('Đã khôi phục kích thước bố cục mặc định.', 'ok');
    });
  }

  if (stageEl && typeof ResizeObserver !== 'undefined') {
    let lastW = 0;
    new ResizeObserver(() => {
      const w = stageEl.clientWidth;
      if (w && w !== lastW) {
        lastW = w;
        redrawStage();
      }
    }).observe(stageEl);
  }
}

async function init() {
  initResizableLayout();
  await loadFonts();
  const info = await ipcRenderer.invoke('app-info');
  $('#version').textContent = 'v' + info.version;
  try {
    const r = fontsMod.ensureFonts(FONTS);
    if (r.installed.length) log(`Đã cài ${r.installed.length} font chữ vào Windows (hỗ trợ đầy đủ tiếng Việt).`, 'ok');
  } catch (e) { log('Lỗi cài font: ' + e.message, 'err'); }

  if (settings.lang) $('#lang').value = settings.lang;
  state.styles = loadStyles();
  setMode(state.mode);

  $('#mode-typo').addEventListener('click', () => setMode('typo', true));
  $('#mode-movie').addEventListener('click', () => setMode('movie', true));

  document.querySelectorAll('#emph-toolbar .brush-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.brush = btn.dataset.brush || 'auto';
      document.querySelectorAll('#emph-toolbar .brush-btn').forEach((b) => b.classList.toggle('sel', b === btn));
    });
  });

  $('#btn-styles-reset').addEventListener('click', () => {
    pushUndo('Về font & màu gốc');
    const g = selGroup();
    if (g && g.custom) { delete g.custom.styles; log(`Cụm #${groupIndex(g)}: về font & màu mặc định.`); afterEdit(true); return; }
    state.styles = defaultStyles();
    state.effectStyle = { border: null, bg: null, shadow: true };
    saveEffectStyle();
    onStylesChanged();
    log('Đã về font & màu gốc của app.');
  });

  const sliderEdit = (id, key, gKey) => {
    const el = $('#insp-' + id);
    let dragSnap = null;
    const ensureDragSnap = () => { if (!dragSnap) dragSnap = captureSnapshot(); };
    el.addEventListener('pointerdown', ensureDragSnap);
    el.addEventListener('keydown', (e) => {
      if (/^(Arrow|Home|End|Page)/.test(e.key)) ensureDragSnap();
    });
    el.addEventListener('input', () => {
      ensureDragSnap();
      $('#insp-' + id + '-v').textContent = el.value + '%';
      const g = selGroup(), v = parseFloat(el.value);
      if (g) { g.custom = g.custom || {}; g.custom[gKey] = v / 100; }
      else if (id === 'ypos' && state.mode === 'movie') state.global.movieYPos = v;
      else state.global[key] = v;
      rebuildSegs();
    });
    el.addEventListener('change', () => {
      if (dragSnap) {
        pushUndo(id === 'scale' ? 'Chỉnh cỡ chữ' : 'Chỉnh vị trí dọc', dragSnap);
        dragSnap = null;
      }
      const g = selGroup();
      if (!g) {
        if (id === 'scale') settings.scale = state.global.scale;
        else if (state.mode === 'movie') settings.yposMovie = state.global.movieYPos;
        else settings.yposTypo = state.global.yPos;
        save();
      }
      afterEdit(true);
    });
  };
  sliderEdit('scale', 'scale', 'scale');
  sliderEdit('ypos', 'yPos', 'yPos');
  $('#insp-replay').addEventListener('click', () => { const g = selGroup(); if (g) playGroup(g); });
  $('#insp-deselect').addEventListener('click', () => selectGroup(null));
  $('#insp-clear').addEventListener('click', () => {
    const g = selGroup();
    if (g) { pushUndo(`Bỏ tuỳ chỉnh #${groupIndex(g)}`); delete g.custom; log(`Cụm #${groupIndex(g)}: đã bỏ tuỳ chỉnh.`); afterEdit(true); }
  });

  $('#fm-close').addEventListener('click', closeFontPicker);
  $('#font-modal').addEventListener('click', (e) => { if (e.target.id === 'font-modal') closeFontPicker(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#font-modal').hidden) closeFontPicker(); });
  let searchTimer;
  ['#fm-search', '#fm-sample'].forEach((s) => $(s).addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderFontList, 150); }));
  $('#fm-vi').addEventListener('change', renderFontList);
  $('#fm-rescan').addEventListener('click', async () => { await scanFonts(true); renderFontList(); });

  $('#btn-pick-root').addEventListener('click', async () => {
    const dir = await ipcRenderer.invoke('pick-dir', { title: 'Chọn thư mục chứa CapCut Drafts' });
    if (dir) {
      settings.customRoot = dir;
      save();
      log(`Đã thêm thư mục Drafts: ${dir}`, 'ok');
      renderDrafts();
    }
  });

  $('#btn-tracks-voice').addEventListener('click', () => {
    state.tracks.forEach((t) => { t.selected = (t.role === 'voice'); });
    renderAudioTracks();
    updateMetrics();
    refreshButtons();
    schedulePreviewAudio(150).catch((err) => log('Lỗi cập nhật âm thanh preview: ' + err.message, 'err'));
  });
  $('#btn-tracks-all').addEventListener('click', () => {
    state.tracks.forEach((t) => { t.selected = (t.audibleCount > 0); });
    renderAudioTracks();
    updateMetrics();
    refreshButtons();
    schedulePreviewAudio(150).catch((err) => log('Lỗi cập nhật âm thanh preview: ' + err.message, 'err'));
  });

  $('#master-audio').addEventListener('loadedmetadata', () => {
    const ma = $('#master-audio');
    if (state.pendingAudioSeek !== null) {
      ma.currentTime = Math.min(ma.duration || state.pendingAudioSeek, state.pendingAudioSeek);
      state.pendingAudioSeek = null;
    }
  });
  $('#player-vol').addEventListener('input', (e) => {
    const vol = Math.max(0, Math.min(1, parseInt(e.target.value, 10) / 100));
    $('#master-audio').volume = vol;
  });

  $('#video').addEventListener('loadedmetadata', () => {
    const v = $('#video');
    if (state.pendingSeek !== null) {
      v.currentTime = state.pendingSeek;
      state.pendingSeek = null;
    }
    if (state.playing && v.paused) v.play().catch(() => {});
  });

  $('#btn-setup').addEventListener('click', runSetup);
  $('#btn-drafts').addEventListener('click', renderDrafts);
  $('#draft-filter').addEventListener('input', renderDrafts);
  $('#btn-listen').addEventListener('click', listen);
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-layout').addEventListener('click', () => buildTypo(true));
  $('#btn-split-playhead').addEventListener('click', splitAtPlayhead);
  document.addEventListener('keydown', (e) => {
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (busyFlag) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); splitAtPlayhead(); }
      else if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    }
  });
  $('#btn-write').addEventListener('click', writeToCapCut);
  $('#lang').addEventListener('change', () => { settings.lang = $('#lang').value; save(); });
  $('#opt-glow').addEventListener('change', () => {
    const pre = captureSnapshot();
    pre.glow = !$('#opt-glow').checked;
    pushUndo('Bật/tắt phát sáng', pre);
    rebuildSegs();
  });
  $('#btn-play').addEventListener('click', () => {
    state.stopAt = null;
    if (state.playing) pausePlayback();
    else startPlayback();
  });
  $('#scrub').addEventListener('input', (e) => seek((e.target.value / 1000) * mediaDuration()));
  window.addEventListener('resize', () => { state.shown = null; drawStage(currentTime()); });
  window.addEventListener('beforeunload', cleanupMasterTemp);

  renderSetup();
  if (!toolState().model || !toolState().whisper) log('Lần đầu dùng: bấm "Tải & cài công cụ" ở mục 0.');
  renderDrafts();
  initAutoUpdater();
  requestAnimationFrame(loop);
}

/* ---------- 6. Tự động cập nhật từ GitHub Releases ---------- */
function initAutoUpdater() {
  const btnCheck = $('#btn-check-update');
  const modal = $('#update-modal');
  const btnClose = $('#upd-close');
  const btnLater = $('#upd-later');
  const btnStart = $('#upd-start');
  const btnWeb = $('#upd-open-web');
  const progWrap = $('#upd-prog-wrap');
  const progBar = $('#upd-prog-bar');
  const progTxt = $('#upd-prog-txt');
  if (!btnCheck || !modal) return;

  let pendingUpdate = null;
  let downloading = false;

  function closeModal() {
    if (downloading) return;
    modal.hidden = true;
  }

  function showUpdateModal(res) {
    pendingUpdate = res;
    const sizeMb = res.asset && res.asset.size ? ` (${(res.asset.size / 1048576).toFixed(1)} MB)` : '';
    const kindLabel = res.asset ? (res.asset.kind === 'zip' ? 'Cập nhật nhanh' : 'Bộ cài đặt') : 'Tải thủ công';
    $('#upd-ver').textContent = `Phiên bản hiện tại: v${res.currentVersion}  →  Mới nhất: v${res.latestVersion} (${kindLabel}${sizeMb})`;
    $('#upd-notes').textContent = (res.notes && res.notes.trim()) ? res.notes.trim() : 'Bản cập nhật mới đã sẵn sàng trên GitHub Releases.';
    progWrap.hidden = true;
    progBar.style.width = '0%';
    btnStart.disabled = false;
    btnStart.textContent = res.asset ? 'Cập nhật & khởi động lại' : 'Mở trang tải về';
    modal.hidden = false;
  }

  async function runCheck(silent) {
    if (downloading) return;
    if (!silent) {
      btnCheck.disabled = true;
      btnCheck.textContent = '⏳ Đang kiểm tra…';
    }
    try {
      const res = await ipcRenderer.invoke('check-updates');
      if (!res || !res.ok) {
        if (!silent) log('Không kiểm tra được cập nhật: ' + ((res && res.error) || 'Lỗi không xác định'), 'err');
        return;
      }
      if (res.hasUpdate) {
        btnCheck.className = 'pill pill-cyan';
        btnCheck.textContent = `⬆ Có bản v${res.latestVersion}`;
        log(`Phát hiện phiên bản mới v${res.latestVersion} trên GitHub Releases.`, 'ok');
        showUpdateModal(res);
      } else {
        btnCheck.className = 'pill pill-ghost';
        btnCheck.textContent = '🔄 Cập nhật';
        if (!silent) log(`Bạn đang dùng phiên bản mới nhất (v${res.currentVersion}).`, 'ok');
      }
    } catch (e) {
      if (!silent) log('Lỗi kiểm tra cập nhật: ' + e.message, 'err');
    } finally {
      btnCheck.disabled = false;
    }
  }

  ipcRenderer.on('app-just-updated', (_e, ver) => {
    log(`Đã tự động cập nhật OTA thành công lên phiên bản v${ver}!`, 'ok');
  });

  ipcRenderer.on('update-progress', (_e, prog) => {
    if (!prog) return;
    const pct = Math.round((prog.percent || 0) * 100);
    progBar.style.width = pct + '%';
    const gotMb = ((prog.received || 0) / 1048576).toFixed(1);
    const totMb = prog.total ? ((prog.total / 1048576).toFixed(1) + ' MB') : '…';
    progTxt.textContent = `Đang tải bản cập nhật: ${gotMb} / ${totMb} (${pct}%)`;
  });

  btnCheck.addEventListener('click', () => {
    if (pendingUpdate && pendingUpdate.hasUpdate) showUpdateModal(pendingUpdate);
    else runCheck(false);
  });
  btnClose.addEventListener('click', closeModal);
  btnLater.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  btnWeb.addEventListener('click', () => {
    const url = (pendingUpdate && pendingUpdate.htmlUrl) || 'https://github.com/AgentC0rn/AutoSub-Typo-Pro/releases';
    ipcRenderer.invoke('open-external', url);
  });
  btnStart.addEventListener('click', async () => {
    if (!pendingUpdate || downloading) return;
    if (!pendingUpdate.asset) {
      ipcRenderer.invoke('open-external', pendingUpdate.htmlUrl);
      return;
    }
    downloading = true;
    btnStart.disabled = true;
    btnLater.disabled = true;
    btnClose.disabled = true;
    progWrap.hidden = false;
    progTxt.textContent = 'Đang kết nối GitHub để tải bản cập nhật…';
    const r = await ipcRenderer.invoke('install-update', pendingUpdate.asset, pendingUpdate.tagName);
    if (!r || !r.ok) {
      downloading = false;
      btnStart.disabled = false;
      btnLater.disabled = false;
      btnClose.disabled = false;
      progTxt.textContent = 'Lỗi cập nhật: ' + ((r && r.error) || 'Không rõ nguyên nhân');
      log('Cập nhật thất bại: ' + ((r && r.error) || 'Lỗi không xác định'), 'err');
    } else {
      progBar.style.width = '100%';
      progTxt.textContent = 'Đã tải xong! Đang cài đặt và khởi động lại…';
    }
  });

  ipcRenderer.invoke('get-pending-update').then((res) => {
    if (res && res.hasUpdate) {
      pendingUpdate = res;
      btnCheck.className = 'pill pill-cyan';
      btnCheck.textContent = `⬆ Có bản v${res.latestVersion}`;
    }
  }).catch(() => {});
}
init();
