'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, 'resources', 'app');
const toolsDir = path.join(__dirname, 'resources', 'tools');
const cc = require(path.join(appDir, 'shared', 'core', 'capcut.js'));
const audio = require(path.join(appDir, 'shared', 'core', 'audio.js'));
const whisper = require(path.join(appDir, 'shared', 'core', 'whisper.js'));
const typo = require(path.join(appDir, 'shared', 'core', 'capcut-typo.js'));
const ttf = require(path.join(appDir, 'shared', 'core', 'ttf.js'));
const setup = require(path.join(appDir, 'shared', 'core', 'setup.js'));
const Layout = require(path.join(appDir, 'shared', 'core', 'layout.js'));

async function main() {
  console.log('=== 1. Checking Draft Discovery ===');
  const roots = cc.draftsRoots();
  console.log('Roots:', roots);
  assert(roots.some((r) => /CapCut Drafts/i.test(r)), 'Expected D:\\Capcut\\CapCut Drafts from .capcutrc');

  const drafts = cc.listDrafts();
  console.log('Total drafts found:', drafts.length);
  const opal2 = drafts.find((d) => d.name === 'Opal 2');
  const phamHa = drafts.find((d) => d.name === 'Phạm Hà');
  assert(opal2, 'Opal 2 draft must be found');
  assert(phamHa, 'Phạm Hà draft must be found');
  console.log('Found Opal 2:', opal2.dir);
  console.log('Found Phạm Hà:', phamHa.dir);

  console.log('\n=== 2. Testing Method A + B on "Opal 2" ===');
  const aOpal = cc.analyzeTimelineAudio(opal2.dir);
  aOpal.tracks.forEach((t) => console.log(`  Track #${t.trackIndex} [${t.type}] "${t.name}": role=${t.role}, selected=${t.selected}, audible=${t.audibleCount}/${t.totalSegs}, avgVol=${t.avgVolume.toFixed(2)}`));
  const opalVoice = aOpal.tracks.filter((t) => t.selected);
  const opalBgm = aOpal.tracks.filter((t) => t.role === 'bgm');
  const opalSilent = aOpal.tracks.filter((t) => t.role === 'silent' || t.role === 'muted');
  assert.strictEqual(opalSilent.length, 2, 'Opal 2 tracks #0 and #2 should be silent');
  assert.strictEqual(opalBgm.length, 1, 'Opal 2 track #8 should be classified as BGM');
  assert.strictEqual(opalBgm[0].selected, false, 'BGM track must be unchecked by default');
  assert.strictEqual(opalVoice.length, 1, 'Opal 2 should auto-select 1 voice track (#7)');
  assert(/ElevenLabs_Opal2_voice\.mp3/i.test(opalVoice[0].segments[0].path), 'Selected voice must be ElevenLabs_Opal2_voice.mp3');

  console.log('\n=== 3. Testing Method A + B on "Phạm Hà" ===');
  const aHa = cc.analyzeTimelineAudio(phamHa.dir);
  aHa.tracks.forEach((t) => console.log(`  Track #${t.trackIndex} [${t.type}] "${t.name}": role=${t.role}, selected=${t.selected}, audible=${t.audibleCount}/${t.totalSegs}, avgVol=${t.avgVolume.toFixed(2)}`));
  const haSelectedSegs = aHa.tracks.filter((t) => t.selected).flatMap((t) => t.segments);
  const haSfx = aHa.tracks.filter((t) => t.role === 'sfx');
  const haBgm = aHa.tracks.filter((t) => t.role === 'bgm');
  const haMuted = aHa.tracks.filter((t) => t.role === 'muted');
  assert(haMuted.length >= 1, 'Phạm Hà muted track (#3) must be detected as muted');
  assert.strictEqual(haSfx.length, 2, 'Phạm Hà tracks #9 and #10 must be classified as SFX');
  assert(haSfx.every((t) => !t.selected), 'SFX tracks must be unchecked by default');
  assert.strictEqual(haBgm.length, 1, 'Phạm Hà track #11 must be classified as BGM');
  assert.strictEqual(haBgm[0].selected, false, 'BGM track must be unchecked by default');
  assert(aHa.duplicateCount >= 2, `Expected >=2 PiP duplicates detected on Phạm Hà, got ${aHa.duplicateCount}`);

  console.log('\n=== 4. Testing Master WAV Mixdown (FFmpeg + Float32Array) ===');
  const ffmpeg = path.join(toolsDir, 'ffmpeg', 'ffmpeg.exe');
  const whisperCuda = path.join(toolsDir, 'whisper-cuda', 'whisper-cli.exe');
  const whisperCpu = path.join(toolsDir, 'whisper-cpu', 'whisper-cli.exe');
  const model = path.join(toolsDir, 'models', 'ggml-large-v3-turbo-q5_0.bin');
  assert(fs.existsSync(ffmpeg), 'ffmpeg.exe missing');
  assert(fs.existsSync(whisperCpu), 'whisper-cli.exe (cpu) missing');
  assert(fs.existsSync(model), 'model missing');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autosub-test-'));
  try {
    const wavHa = path.join(tmp, 'ha_master.wav');
    const mixHa = await audio.buildMasterWav(ffmpeg, haSelectedSegs, aHa.projectDuration, wavHa);
    console.log('Phạm Hà Master WAV stats:', mixHa.stats);
    assert(fs.existsSync(wavHa), 'ha_master.wav must exist');
    assert(mixHa.stats.duplicateRemoved >= 2, 'PiP duplicates must be removed during mixdown');
    assert.strictEqual(mixHa.wavData.sampleRate, 16000);
    const maxHa = mixHa.wavData.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert(maxHa > 1000, 'Mixed WAV amplitude must be audible');

    const opalSelectedSegs = opalVoice.flatMap((t) => t.segments);
    const wavOpal = path.join(tmp, 'opal_master.wav');
    const mixOpal = await audio.buildMasterWav(ffmpeg, opalSelectedSegs, aOpal.projectDuration, wavOpal);
    console.log('Opal 2 Master WAV stats:', mixOpal.stats);
    assert(fs.existsSync(wavOpal), 'opal_master.wav must exist');

    console.log('\n=== 5. Testing End-to-End Whisper + Layout + CapCut Typo Segments on "Opal 2" ===');
    const gpu = setup.hasNvidia();
    const bin = (gpu && fs.existsSync(whisperCuda)) ? whisperCuda : whisperCpu;
    console.log('Running whisper with:', bin, gpu ? `(GPU: ${gpu})` : '(CPU)');
    let words;
    try {
      words = await whisper.transcribe({ bin, model, wav: wavOpal, lang: 'en' });
    } catch (e) {
      if (bin !== whisperCpu) {
        console.log('GPU whisper failed, falling back to CPU:', e.message);
        words = await whisper.transcribe({ bin: whisperCpu, model, wav: wavOpal, lang: 'en' });
      } else throw e;
    }
    audio.addLoudness(words, mixOpal.wavData);
    console.log('Recognized words:', words.length, 'Sample:', words.slice(0, 8).map((w) => w.text).join(' '));
    assert(words.length > 20, `Expected >20 words from Opal 2 voiceover, got ${words.length}`);

    const groups = Layout.buildLayout(words, { lang: 'en' });
    const segs = typo.buildSegments(groups, {
      width: aOpal.canvas.width,
      height: aOpal.canvas.height,
      fps: aOpal.canvas.fps,
      fontsDir: path.join(appDir, 'shared', 'fonts'),
      anim: 'auto',
      glow: true
    });
    console.log('Generated phrase groups:', groups.length, 'CapCut text segments:', segs.length);
    assert(groups.length > 3, 'Expected >3 typography groups');
    assert(segs.length >= words.length * 0.9, 'Expected CapCut word segments for recognized words');

    console.log('\n=== 6. Verifying New Animations, Vietnamese Presets, Bundled Fonts & UI ===');
    const fontsDir = path.join(appDir, 'shared', 'fonts');
    const newAnims = ['elastic', 'float', 'wave', 'pulse'];
    for (const animId of newAnims) {
      const animEntry = Array.isArray(typo.ANIMS)
        ? typo.ANIMS.find((a) => a.id === animId)
        : typo.ANIMS[animId];
      assert(animEntry, `Missing animation "${animId}" in typo.ANIMS`);
      const aSegs = typo.buildSegments(groups.slice(0, 2), {
        width: aOpal.canvas.width,
        height: aOpal.canvas.height,
        fps: aOpal.canvas.fps,
        fontsDir,
        anim: animId,
        glow: true
      });
      assert(aSegs.length > 0, `Animation "${animId}" returned 0 segments`);
      const hasKfs = aSegs.some((s) =>
        s.keyframes &&
        typeof s.keyframes === 'object' &&
        Object.values(s.keyframes).some((arr) => Array.isArray(arr) && arr.length > 0)
      );
      assert(hasKfs, `Animation "${animId}" must produce non-empty keyframe segments`);
      console.log(`Anim "${animId}": OK (${aSegs.length} segments)`);
    }

    const viSample = 'Thời gian là vàng — Thẩm mỹ Đẹp';
    const expectedPresets = ['luxury', 'cosmic', 'editorial', 'viral', 'classic'];
    assert(typo.PRESETS, 'typo.PRESETS must exist');
    const collectFontFiles = (val, out = []) => {
      if (typeof val === 'string' && /\.(ttf|otf)$/i.test(val.trim())) out.push(val.trim());
      else if (Array.isArray(val)) val.forEach((v) => collectFontFiles(v, out));
      else if (val && typeof val === 'object') Object.values(val).forEach((v) => collectFontFiles(v, out));
      return out;
    };
    for (const presetId of expectedPresets) {
      const preset = Array.isArray(typo.PRESETS)
        ? typo.PRESETS.find((p) => p.id === presetId)
        : typo.PRESETS[presetId];
      assert(preset, `Missing preset "${presetId}" in typo.PRESETS`);
      const presetFonts = [...new Set(collectFontFiles(preset))];
      assert(presetFonts.length > 0, `Preset "${presetId}" must reference font files`);
      for (const fName of presetFonts) {
        const fPath = path.join(fontsDir, fName);
        assert(fs.existsSync(fPath), `Preset "${presetId}" font missing: ${fPath}`);
        if (presetId !== 'classic') {
          assert(ttf.hasChars(fPath, viSample), `Preset "${presetId}" font failed Vietnamese glyph check: ${fName}`);
        }
      }
      console.log(`Preset "${presetId}": OK (${presetFonts.join(', ')})`);
    }

    const expectedBundledFonts = [
      'Montserrat-Bold.ttf',
      'Montserrat-Black.ttf',
      'DancingScript-Bold.ttf',
      'SVN-Bali Script.ttf',
      'SVN-Blenda Script.ttf',
      'SVN-Gilroy Bold.otf',
      'SVN-Gilroy Heavy.otf',
      'Oswald-Bold.ttf',
      'Anton-Regular.ttf',
      'SVN-Abril Fatface.ttf',
      'Quicksand-Bold.ttf',
      'Lora-BoldItalic.ttf'
    ];
    for (const fName of expectedBundledFonts) {
      const fPath = path.join(fontsDir, fName);
      assert(fs.existsSync(fPath), `Bundled font missing: ${fPath}`);
      assert(ttf.hasChars(fPath, viSample), `Bundled font failed Vietnamese check: ${fName}`);
    }
    console.log(`Bundled 12 new fonts verified (${expectedBundledFonts.length}/${expectedBundledFonts.length} Vietnamese OK)`);

    const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
    assert(!/logo\.png/i.test(html), 'index.html must not reference logo.png');
    assert(/id=["']preset-grid["']/.test(html), 'index.html must contain #preset-grid');
    assert(/id=["']player-vol["']/.test(html), 'index.html must contain #player-vol');
    console.log('UI checks passed: no logo.png, #preset-grid & #player-vol present');

    console.log('\n=== 7. Tách / Gộp cụm chữ & tách từ sau khi nhận dạng ===');
    const lo = { lang: 'en' };
    const g2 = Layout.buildLayout(words, lo);
    const nBefore = g2.length;
    const target = g2.findIndex((g) => g.words.length >= 3);
    assert(target >= 0, 'Need a group with >=3 words to test splitting');
    const origWords = g2[target].words.map((w) => w.text);
    const parts = Layout.splitGroup(g2, target, 1, lo);
    assert(parts && g2.length === nBefore + 1, 'splitGroup must add 1 group');
    assert.deepStrictEqual(parts[0].words.map((w) => w.text).concat(parts[1].words.map((w) => w.text)), origWords, 'split must preserve words');
    assert(parts[0].id !== parts[1].id, 'split groups need unique ids');
    for (let k = 0; k < g2.length - 1; k++) {
      assert(g2[k].end <= g2[k + 1].start + 1e-6, `groups #${k} and #${k + 1} overlap after split`);
      assert(g2[k].start < g2[k].end, `group #${k} has invalid time range`);
    }
    [parts[0], parts[1]].forEach((p) => {
      const lw = p.lines.flatMap((l) => l.words.map((w) => w.text));
      assert.deepStrictEqual(lw, p.words.map((w) => w.text), 'lines must be relayouted after split');
      if (p.span) assert(p.span[0] >= 0 && p.span[1] < p.words.length, 'span must stay inside group');
    });
    const merged = Layout.mergeGroups(g2, target, lo);
    assert(merged && g2.length === nBefore, 'mergeGroups must restore group count');
    assert.deepStrictEqual(merged.words.map((w) => w.text), origWords, 'merge must restore words');
    const tMid = (g2[target].words[1].start + g2[target].words[1].end) / 2;
    const atRes = Layout.splitAtTime(g2, tMid, lo);
    assert(atRes && g2.length === nBefore + 1, 'splitAtTime must split the group under the playhead');
    const segsAfter = typo.buildSegments(g2, {
      width: aOpal.canvas.width, height: aOpal.canvas.height, fps: aOpal.canvas.fps, fontsDir, anim: 'auto', glow: true
    });
    assert(segsAfter.length >= words.length * 0.9, 'segments must still build after split/merge');
    const ws = Layout.splitWordTiming({ text: 'xinchào', start: 1, end: 2, rms: 0.4 }, 'xin chào bạn');
    assert.deepStrictEqual(ws.map((w) => w.text), ['xin', 'chào', 'bạn'], 'splitWordTiming texts');
    assert(Math.abs(ws[0].start - 1) < 1e-9 && Math.abs(ws[2].end - 2) < 1e-9, 'splitWordTiming must keep outer timing');
    for (let k = 1; k < ws.length; k++) assert(ws[k].start >= ws[k - 1].end - 1e-9, 'splitWordTiming must be ordered');
    console.log(`Split/merge OK: ${nBefore} → ${nBefore + 1} → ${nBefore} → ${g2.length} cụm, ${segsAfter.length} segments; splitWordTiming OK`);

    console.log('\n=== 8. Nhiều timeline trong 1 project ===');
    const multi = drafts.filter((d) => d.timelineCount > 1);
    console.log('Drafts with multiple timelines:', multi.length);
    assert(multi.length > 0, 'Expected at least one multi-timeline draft');
    const tlDraft = drafts.find((d) => d.name === '0701') || multi[0];
    const tls = cc.listTimelines(tlDraft.dir, true);
    console.log(`"${tlDraft.name}" timelines:`, tls.map((t) => `${t.name}${t.isMain ? '*' : ''} ${t.duration.toFixed(1)}s ${t.trackCount} tracks`).join(' | '));
    assert(tls.length === tlDraft.timelineCount && tls.length > 1, 'listTimelines count must match timelineCount');
    assert(tls.filter((t) => t.isMain).length === 1, 'Exactly one main timeline');
    const secondary = tls.find((t) => !t.isMain);
    const anMain = cc.analyzeTimelineAudio(tlDraft.dir, tls.find((t) => t.isMain).id);
    const anSec = cc.analyzeTimelineAudio(tlDraft.dir, secondary.id);
    assert.strictEqual(anSec.timelineId, secondary.id, 'analysis must report secondary timeline id');
    assert(/Timelines[\\/]/.test(anSec.contentFile) && anSec.contentFile.includes(secondary.id), 'secondary analysis must read its own draft_content.json');
    console.log(`Main: ${anMain.projectDuration.toFixed(2)}s, ${anMain.tracks.length} tracks · Secondary "${secondary.name}": ${anSec.projectDuration.toFixed(2)}s, ${anSec.tracks.length} tracks`);

    // Ghi thử vào timeline phụ trên BẢN SAO trong thư mục tạm (không đụng project thật)
    const tmpDraft = path.join(tmp, 'tl-copy');
    fs.cpSync(tlDraft.dir, tmpDraft, { recursive: true });
    const mainFile = path.join(tmpDraft, 'Timelines', tls.find((t) => t.isMain).id, 'draft_content.json');
    const rootFile = path.join(tmpDraft, 'draft_content.json');
    const secFile = path.join(tmpDraft, 'Timelines', secondary.id, 'draft_content.json');
    const mainBefore = fs.readFileSync(mainFile, 'utf8');
    const rootBefore = fs.existsSync(rootFile) ? fs.readFileSync(rootFile, 'utf8') : null;
    const textTracksBefore = JSON.parse(fs.readFileSync(secFile, 'utf8')).tracks.filter((t) => t.type === 'text').length;
    const nWritten = cc.addTextTrack(tmpDraft, segsAfter.slice(0, 12), { name: 'Typo', timelineId: secondary.id });
    const secAfter = JSON.parse(fs.readFileSync(secFile, 'utf8'));
    const textTracksAfter = secAfter.tracks.filter((t) => t.type === 'text').length;
    assert(nWritten === 12, 'addTextTrack must write 12 segments');
    assert(textTracksAfter > textTracksBefore, 'secondary timeline must receive new text tracks');
    assert.strictEqual(fs.readFileSync(mainFile, 'utf8'), mainBefore, 'main timeline must stay untouched');
    if (rootBefore !== null) assert.strictEqual(fs.readFileSync(rootFile, 'utf8'), rootBefore, 'root draft_content must stay untouched');
    console.log(`Wrote ${nWritten} segments into secondary timeline copy (${textTracksBefore} → ${textTracksAfter} text tracks), main/root untouched`);

    const html2 = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
    ['timeline-box', 'timelines', 'btn-split-playhead', 'opt-all-tl', 'split-cols', 'split-right', 'btn-reset-layout'].forEach((id) => assert(html2.includes(`id="${id}"`), `index.html must contain #${id}`));
    ['drafts', 'audio-tracks', 'words', 'groups'].forEach((b) => assert(html2.includes(`data-box="${b}"`), `index.html must contain data-box="${b}"`));
    const rendJs = fs.readFileSync(path.join(appDir, 'renderer.js'), 'utf8');
    assert(rendJs.includes('initResizableLayout'), 'renderer.js must define and call initResizableLayout');
    assert(rendJs.includes('Bytedance\\\\CapCut') || rendJs.includes('Bytedance\\CapCut'), 'renderer.js must probe CapCut registry installDir');
    const cssBuf = fs.readFileSync(path.join(appDir, 'app.css'));
    assert(cssBuf.indexOf(Buffer.from([0xef, 0xbb, 0xbf]), 3) < 0, 'app.css must not contain a mid-file BOM');

    // Packaging, branding & Windows portability checks
    const icoBuf = fs.readFileSync(path.join(appDir, 'shared', 'assets', 'app.ico'));
    const logoBuf = fs.readFileSync(path.join(appDir, 'shared', 'assets', 'logo.png'));
    assert(icoBuf.length > 1024 && icoBuf.readUInt16LE(2) === 1, 'app.ico must be a valid Windows ICO file');
    assert(logoBuf.length > 1024 && logoBuf.slice(1, 4).toString('ascii') === 'PNG', 'logo.png must be a valid PNG file');
    const pkgJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    assert.strictEqual(pkgJson.author, 'AutoSub Typo Pro', 'package.json author must be updated');
    const mainJs = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
    assert(mainJs.includes('setAppUserModelId') && mainJs.includes('requestSingleInstanceLock'), 'main.js must configure AppUserModelId and single instance lock');
    const capcutJs = fs.readFileSync(path.join(appDir, 'shared', 'core', 'capcut.js'), 'utf8');
    assert(capcutJs.includes('readCapcutRegistryRoots'), 'capcut.js must auto-detect CapCut custom draft path via Registry');
    const exeBuf = fs.readFileSync(path.join(__dirname, 'AutoSub Typo Pro.exe'));
    assert(exeBuf.includes(Buffer.from('AutoSub Typo Pro for CapCut', 'utf16le')), 'AutoSub Typo Pro.exe must have updated ProductName');
    assert(!exeBuf.includes(Buffer.from('EditorNghiepdu', 'utf16le')), 'AutoSub Typo Pro.exe must not retain old CompanyName');
    console.log('UI & packaging checks passed: layout, icon, exe metadata, CapCut registry portability');

    console.log('\n=== 9. Multi-Ratio Alignment Parity (9:16, 4:3, 16:9, 1:1, 720p, 4K) & Movie Sub ===');
    assert.strictEqual(typo.capcutUnitPx(1080), 5);
    assert.strictEqual(+(typo.capcutUnitPx(1440)).toFixed(4), +(1440 / 216).toFixed(4));
    assert.strictEqual(+(typo.capcutUnitPx(1920)).toFixed(4), +(1920 / 216).toFixed(4));
    const rgbHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const sampleGrp = [{
      id: 'align-g1', start: 1.0, end: 3.0,
      lines: [
        { style: 'base', words: [{ text: 'những', start: 1.0, end: 1.3 }, { text: 'tình', start: 1.3, end: 1.6 }] },
        { style: 'gold', words: [{ text: 'trạng', start: 1.6, end: 2.0 }, { text: 'mụn', start: 2.0, end: 2.5 }] }
      ]
    }];
    const movieMod = require(path.join(appDir, 'shared', 'core', 'srt.js'));
    for (const [W, H] of [[1080, 1920], [1440, 1080], [1920, 1080], [1080, 1080], [720, 1280], [3840, 2160]]) {
      const capUnit = typo.capcutUnitPx(W);
      for (const preset of typo.PRESETS) {
        const pStyles = {};
        Object.keys(preset.styles).forEach((k) => {
          pStyles[k] = { font: typo.fontPath(preset.styles[k].file, fontsDir), color: rgbHex(preset.styles[k].color) };
        });
        const pSegs = typo.buildSegments(sampleGrp, {
          width: W, height: H, fps: 30, yPos: 0.72, scale: 1, fontsDir,
          styles: pStyles, border: preset.border || null, bg: preset.bg || null, glow: true
        });
        const byY = new Map();
        pSegs.forEach((s) => { const k = s.y; if (!byY.has(k)) byY.set(k, []); byY.get(k).push(s); });
        for (const [, line] of byY) {
          line.sort((a, b) => a.x - b.x);
          for (let idx = 1; idx < line.length; idx++) {
            const a = line[idx - 1], b = line[idx];
            const pxA = a.px != null ? a.px : typo.capcutRenderedPx(a.size, W, a.font);
            const pxB = b.px != null ? b.px : typo.capcutRenderedPx(b.size, W, b.font);
            const pad = preset.border ? pxA * (preset.border.width || 0.08) * 0.5 : 0;
            const gap = ((b.x + 1) * W / 2 - ttf.measure(b.font, b.text, pxB) / 2 - pad) - ((a.x + 1) * W / 2 + ttf.measure(a.font, a.text, pxA) / 2 + pad);
            assert(gap > 1, `Word overlap on ${W}x${H} ${preset.id}: gap=${gap.toFixed(1)}px`);
          }
        }
      }
      const mCues = movieMod.groupMovieCues(sampleGrp[0].lines.flatMap((l) => l.words), { width: W, height: H });
      const mSegs = typo.buildMovieSegments(mCues, { width: W, height: H, fontsDir, scale: 1 });
      mSegs.forEach((ms) => ms.text.split('\n').forEach((ln) => {
        const msPx = ms.px != null ? ms.px : typo.capcutRenderedPx(ms.size, W, ms.font);
        assert(ttf.measure(ms.font, ln, msPx) <= W * 0.86, `Movie sub overflow on ${W}x${H}`);
      }));
    }
    assert(rendJs.includes('capcutUnitPx') && rendJs.includes('capcutFontScale'), 'renderer.js drawStage must use capcutUnitPx + capcutFontScale for Preview-CapCut parity');
    // Kiểm tra chuẩn hoá hhea cho các font thấp/cao hơn Montserrat (vd SVN-Gilroy Bold 1.050, SVN-Blenda 1.003)
    const gilroyScale = typo.capcutFontScale(typo.fontPath('SVN-Gilroy Bold.otf', fontsDir));
    const blendaScale = typo.capcutFontScale(typo.fontPath('SVN-Blenda Script.ttf', fontsDir));
    assert(gilroyScale > 1.15 && gilroyScale < 1.17, `Expected SVN-Gilroy scale ~1.161, got ${gilroyScale}`);
    assert(blendaScale > 1.20 && blendaScale < 1.23, `Expected SVN-Blenda scale ~1.215, got ${blendaScale}`);
    console.log('Multi-ratio alignment parity & Movie sub checks passed (6 resolutions x 9 presets, hhea scaling verified)');

    console.log('\n=== 10. Multi-Emphasis Phrases, Smart Vietnamese Segmentation & Undo/Redo ===');
    // Test 10a: Sửa đồng âm tiếng Việt an toàn & giữ nguyên từ ghép + cụm ngữ nghĩa
    const sampleViWords = [
      'Hết', 'sạch', 'lông', 'sau', 'một', 'liều', 'trình', '95%', 'các', 'bạn',
      'Tại', 'Hoàng', 'Hoa', 'Spa', 'Khách', 'hàng', 'cảm', 'nhận', 'hiệu', 'quả', 'rõ',
      'Mà', 'là', 'nằm', 'ở', 'kỹ', 'thuật', 'triệt', 'Biomatic', 'công', 'nghệ', 'hàn', 'băng', 'siêu', 'mắt', 'lạnh',
      'Chỉ', 'còn', '49k', 'Inbook', 'ngay'
    ].map((t, idx) => ({ text: t, start: idx * 0.28, end: idx * 0.28 + 0.24, rms: 0.05 }));
    whisper.fixViHomophones(sampleViWords);
    const fixedText = sampleViWords.map((w) => w.text).join(' ');
    assert(fixedText.includes('liệu trình'), 'fixViHomophones must repair liều trình -> liệu trình');
    assert(fixedText.includes('siêu mát lạnh'), 'fixViHomophones must repair siêu mắt lạnh -> siêu mát lạnh');
    assert(fixedText.includes('Inbox ngay'), 'fixViHomophones must repair Inbook -> Inbox');

    const viGroups = Layout.buildLayout(sampleViWords, { lang: 'vi' });
    const viGroupTexts = viGroups.map((g) => g.words.map((w) => w.text).join(' '));
    console.log('Smart VI groups:', viGroupTexts.join(' | '));
    assert(viGroupTexts.some((t) => t.includes('ở kỹ thuật triệt Biomatic')), 'Must group "ở kỹ thuật triệt Biomatic" without dangling "công"');
    assert(!viGroupTexts.some((t) => /\bcông$/.test(t)), 'Must never split compound "công | nghệ" across groups');
    assert(!viGroupTexts.some((t) => /\bKhách$/.test(t)), 'Must never split compound "Khách | hàng" across groups');

    // Test 10b: Sub Phim Ngang cân dòng không chẻ đôi từ ghép
    const bal = movieMod.balanceTwoLines('công nghệ hàn băng siêu mát lạnh hôm nay', 22);
    const [bLine1, bLine2] = bal.split('\n');
    assert(!(/\bcông$/.test(bLine1) && /^nghệ\b/.test(bLine2)), `balanceTwoLines must not split công|nghệ: ${bal}`);

    // Test 10c: Nhiều dạng nhấn & nhiều cụm từ trong cùng 1 khung + mixed inline styles
    const targetGrp = viGroups.find((g) => g.words.some((w) => w.text === 'Biomatic'));
    Layout.applySpan(targetGrp, 1, 2, 'gold', { lang: 'vi' });     // "kỹ thuật"
    Layout.applySpan(targetGrp, 4, 4, 'script', { lang: 'vi' });   // "Biomatic"
    assert.strictEqual(targetGrp.emphases.length, 2, 'Group must hold 2 independent emphasis spans');
    Layout.toggleWord(targetGrp, 0, false, { lang: 'vi' }, 'blue'); // thêm "ở" = blue => 3 kiểu khác nhau cùng 1 khung!
    assert.strictEqual(targetGrp.emphases.length, 3, 'Group must hold 3 emphasis styles (blue + gold + script)');
    const cosmic = typo.PRESETS.find((p) => p.id === 'cosmic');
    const cStyles = {};
    Object.keys(cosmic.styles).forEach((k) => {
      cStyles[k] = { font: typo.fontPath(cosmic.styles[k].file, fontsDir), color: rgbHex(cosmic.styles[k].color) };
    });
    const mSegs = typo.buildSegments([targetGrp], { width: 1080, height: 1920, fontsDir, styles: cStyles });
    const distinctStyles = new Set(mSegs.map((s) => s.style));
    assert(distinctStyles.has('blue') && distinctStyles.has('gold') && distinctStyles.has('script'), 'buildSegments must emit 3 styles in the same group');
    const splitTest = Layout.splitGroup(viGroups.slice(), viGroups.indexOf(targetGrp), 3, { lang: 'vi' });
    assert(splitTest && splitTest[0].emphases.length === 2 && splitTest[1].emphases.length === 1, 'splitGroup must slice multi-emphases cleanly');
    const mergedBack = Layout.mergeGroups([splitTest[0], splitTest[1]], 0, { lang: 'vi' });
    assert(mergedBack && mergedBack.emphases.length === 3, 'mergeGroups must preserve all 3 emphasis spans');

    // Test 10d: UI Undo/Redo & Brush wiring checks
    ['btn-undo', 'btn-redo', 'emph-toolbar'].forEach((id) => assert(html2.includes(`id="${id}"`), `index.html must contain #${id}`));
    ['pushUndo', 'function undo(', 'function redo(', 'captureSnapshot', 'Layout.applySpan'].forEach((sym) => assert(rendJs.includes(sym), `renderer.js must implement ${sym}`));
    console.log('Multi-emphasis, smart VI segmentation & Undo/Redo checks passed');

    console.log('\nALL VERIFICATION CHECKS PASSED!');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
