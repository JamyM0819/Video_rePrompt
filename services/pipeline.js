const { detectScenes, getVideoDuration } = require('./sceneDetect');
const { extractThumbnails, extractMultiFrames } = require('./frameExtract');
const { describeAllFrames, describeAllShots, describeAllVideoClips } = require('./visionDescribe');
const { extractFullAudio } = require('./audioExtract');
const { transcribeFileTrans, assignToShots } = require('./fileTrans');
const { extractVideoClips, extractPreviewClips } = require('./videoClip');
const config = require('../utils/config');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Phase 1: Detect scenes, then extract all frame thumbnails for preview.
 * Returns sceneData with frame URLs so frontend can show a filmstrip.
 */
async function detectOnly(videoPath, jobId, updateJob, maxShots, minShotDuration) {
  const minDur = minShotDuration != null ? parseFloat(minShotDuration) : null;
  const durMsg = minDur != null ? ` (最短镜头 <=${minDur}s)` : '';
  updateJob(jobId, { status: 'detecting_scenes', logLine: `开始检测镜头切换${durMsg}...` });

  const t0 = Date.now();
  const scenes = await detectScenes(videoPath, jobId, maxShots, minDur);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  updateJob(jobId, { logLine: `检测到 ${scenes.length} 个镜头（耗时 ${elapsed}s）` });

  // Extract all frame thumbnails
  updateJob(jobId, {
    status: 'extracting_thumbs',
    progress: { stage: 'extracting_thumbs', current: 0, total: scenes.length },
    logLine: `抽取 ${scenes.length} 个镜头缩略图...`,
  });

  const framePaths = await extractThumbnails(videoPath, scenes, jobId, (i) => {
    updateJob(jobId, { progress: { stage: 'extracting_thumbs', current: i + 1, total: scenes.length } });
  });

  updateJob(jobId, { logLine: `缩略图抽取完成` });

  const skipAudio_detect = config.AUDIO_PROVIDER === 'none';
  if (!skipAudio_detect) {
    const fullAudioPath = path.join(config.OUTPUT_DIR, jobId, 'full_audio.mp3');
    updateJob(jobId, { logLine: `提取整段音频...` });
    try { await extractFullAudio(videoPath, fullAudioPath); } catch {}
    updateJob(jobId, { logLine: fs.existsSync(fullAudioPath) ? `音频提取完成` : `该视频无音频轨道` });
  }

  // Extract preview video clips for each shot
  const totalShots = scenes.length;
  const clipCount = Math.min(totalShots, 200); // safety cap only for extreme edge cases
  updateJob(jobId, { logLine: `生成 ${clipCount} 个预览视频片段...` });
  await extractPreviewClips(videoPath, scenes.slice(0, clipCount), 0, jobId, () => {});
  updateJob(jobId, { logLine: `预览片段生成完毕` });

  const duration = await getVideoDuration(videoPath).catch(() => null);

  updateJob(jobId, {
    status: 'awaiting_range',
    progress: { stage: 'awaiting_range' },
    logLine: duration
      ? `视频总时长 ${formatDuration(duration)}，请在下方选择要分析的镜头范围`
      : `请在下方选择要分析的镜头范围`,
    sceneData: {
      totalShots: scenes.length,
      duration: duration ? Math.round(duration * 100) / 100 : null,
      thumbBase: `/api/frames/${jobId}/`,
      clipBase: `/api/clips/${jobId}/`,
      previewBase: `/api/preview-clips/${jobId}/`,
      shots: scenes.map((s, i) => ({
        index: i,
        startTime: s.startTime,
        endTime: s.endTime,
        duration: Math.round((s.endTime - s.startTime) * 100) / 100,
      })),
    },
  });
}

/**
 * Phase 2: Analyze selected shot range. Frames already extracted in Phase 1.
 */
async function runRange(videoPath, jobId, updateJob, selectedScenes, videoName, customPrompt, mode) {
  const skipAudio = config.AUDIO_PROVIDER === 'none';
  const isVideo = mode === 'video';

  try {
    const selectedTotal = selectedScenes.length;
    if (selectedTotal === 0) throw new Error('No scenes selected');
    const firstIdx = selectedScenes[0].index;
    const lastIdx = selectedScenes[selectedTotal - 1].index;
    updateJob(jobId, { logLine: `开始处理镜头 ${firstIdx} ~ ${lastIdx}（共 ${selectedTotal} 个）...` });

    const outputDir = path.join(config.OUTPUT_DIR, jobId);

    let framePaths, visualResults, visualDone = 0;
    let visionTimings = null, visionCompletedAt = null;
    const totalVisual = selectedScenes.length;

    if (isVideo) {
      // Split: ≥2s scenes → video clips, <2s → multi-frame images (DashScope 2s minimum)
      const VID_MIN = 2.0;
      const shortItems = [], videoItems = [];
      selectedScenes.forEach((s, i) => {
        ((s.endTime - s.startTime) < VID_MIN ? shortItems : videoItems).push({ scene: s, origIdx: i });
      });

      visualResults = new Array(totalVisual);
      visionTimings = new Array(totalVisual);
      visionCompletedAt = new Array(totalVisual);

      if (videoItems.length > 0) {
        updateJob(jobId, { logLine: `切割 ${videoItems.length} 个视频片段...` });
        const clipData = [];
        for (const vi of videoItems) {
          const clips = await extractVideoClips(videoPath, [vi.scene], selectedScenes[vi.origIdx].index, jobId, () => {});
          clipData.push({ ...clips[0], origIdx: vi.origIdx });
        }
        const clipOut = await describeAllVideoClips(clipData.map(c => ({ path: c.path, duration: c.duration })), (n) => {
          visualDone = n;
          updateJob(jobId, { status: 'analyzing', progress: { stage: 'analyzing', current: visualDone, total: totalVisual } });
        }, customPrompt);
        clipData.forEach((c, i) => {
          visualResults[c.origIdx] = clipOut.results[i];
          if (clipOut.timings) visionTimings[c.origIdx] = clipOut.timings[i];
          if (clipOut.completedAt) visionCompletedAt[c.origIdx] = clipOut.completedAt[i];
        });
      }

      if (shortItems.length > 0) {
        updateJob(jobId, { logLine: `${shortItems.length} 个短镜头使用多帧图片分析...` });
        const shortScenes = shortItems.map(si => si.scene);
        const firstShortIdx = shortItems[0].origIdx;
        const frameSets = await extractMultiFrames(videoPath, shortScenes, selectedScenes[firstShortIdx].index, jobId, () => {}, 5);
        const totalShortFrames = frameSets.reduce((s, fs) => s + fs.frames.length, 0);
        updateJob(jobId, { logLine: `短镜头共 ${totalShortFrames} 帧` });
        const frameOut = await describeAllShots(
          frameSets.map(fs => ({ frames: fs.frames, duration: fs.duration })),
          (n) => { visualDone = (videoItems.length || 0) + n; updateJob(jobId, { status: 'analyzing', progress: { stage: 'analyzing', current: visualDone, total: totalVisual } }); },
          customPrompt
        );
        shortItems.forEach((si, i) => {
          visualResults[si.origIdx] = frameOut.results[i];
          if (frameOut.timings) visionTimings[si.origIdx] = frameOut.timings[i];
          if (frameOut.completedAt) visionCompletedAt[si.origIdx] = frameOut.completedAt[i];
        });
      }

      visualDone = totalVisual;
      framePaths = selectedScenes.map((_, i) => path.join(outputDir, `frame_${selectedScenes[i].index}.jpg`));
    } else {
      framePaths = selectedScenes.map((_, i) => path.join(outputDir, `frame_${selectedScenes[i].index}.jpg`));
      updateJob(jobId, {
        status: 'extracting',
        progress: { stage: 'extracting_frames', current: totalVisual, total: totalVisual },
        logLine: `复用已抽取的 ${totalVisual} 帧${skipAudio ? '' : '，提取音频片段...'}`,
      });
    }

    // ── Start audio early (FileTrans is async, OSS upload fast) ──
    let audioPromise = null;
    if (!skipAudio) {
      let fullAudio = path.join(outputDir, 'full_audio.mp3');
      if (!fs.existsSync(fullAudio)) {
        updateJob(jobId, { logLine: `提取整段音频...` });
        try { await extractFullAudio(videoPath, fullAudio); } catch (e) { logger.warn('[audio] extract failed:', e.message); }
      }
      if (fs.existsSync(fullAudio)) {
        // Check for cached transcription result
        const cacheFile = path.join(outputDir, 'transcription.json');
        let cacheValid = false;
        if (fs.existsSync(cacheFile)) {
          try {
            const audioStat = fs.statSync(fullAudio);
            const cacheStat = fs.statSync(cacheFile);
            // Use cache if audio hasn't changed since last transcription
            if (cacheStat.mtimeMs >= audioStat.mtimeMs) {
              audioPromise = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
              cacheValid = true;
              updateJob(jobId, { logLine: `复用缓存的音频识别结果` });
            }
          } catch {}
        }
        if (!cacheValid) {
          updateJob(jobId, { logLine: `提交整段音频异步识别...` });
          audioPromise = transcribeFileTrans(fullAudio).then(ft => {
            // Cache the result
            try { fs.writeFileSync(cacheFile, JSON.stringify(ft), 'utf-8'); } catch {}
            return ft;
          }).catch(err => {
            logger.error(`[pipeline] FileTrans failed:`, err);
            updateJob(jobId, { logLine: `音频识别失败: ${err.message}` });
            return null;
          });
        }
      }
    }

    // ── Visual analysis ──
    const tVision = Date.now();
    const updateProgress = () => {
      updateJob(jobId, { status: 'analyzing', progress: { stage: 'analyzing', current: visualDone, total: totalVisual } });
    };
    updateProgress();

    if (!isVideo) {
      updateJob(jobId, { logLine: `开始分析 ${totalVisual} 帧...` });
      const visionOut = await describeAllFrames(framePaths, (n) => { visualDone = n; updateProgress(); }, customPrompt);
      visualResults = visionOut?.results || visionOut;
      visionTimings = visionOut?.timings || null;
      visionCompletedAt = visionOut?.completedAt || null;
      visualDone = totalVisual;
    }

    // ── Wait for audio, then assign to shots ──
    let audioResults = null, hasAudio = false;
    let totalAudioTime = null;
    if (audioPromise) {
      const ft = await audioPromise;
      if (ft) {
        totalAudioTime = ft.timing?.totalMs || null;
        updateJob(jobId, { logLine: `音频识别完成：${ft.sentences.length} 句，${ft.wordCount} 词` });
        audioResults = assignToShots(ft.sentences, selectedScenes);
        hasAudio = true;
      } else {
        audioResults = [];
      }
    }
    updateJob(jobId, { logLine: hasAudio ? `音频识别完成` : `准备就绪` });

    updateJob(jobId, { logLine: `分析完成！编译结果中...` });

    const shots = selectedScenes.map((scene, i) => ({
      index: selectedScenes[i].index,
      startTime: scene.startTime, endTime: scene.endTime,
      duration: Math.round((scene.endTime - scene.startTime) * 100) / 100,
      framePath: `/api/frames/${jobId}/${selectedScenes[i].index}`,
      clipPath: isVideo ? `/api/clips/${jobId}/${selectedScenes[i].index}` : null,
      description: visualResults[i] || '[无画面描述]',
      audioDescription: hasAudio && audioResults[i] ? audioResults[i] : undefined,
      visionMs: visionTimings ? visionTimings[i] : undefined,
      completedAt: visionCompletedAt ? visionCompletedAt[i] : undefined,
      audioMs: totalAudioTime,
    }));

    updateJob(jobId, {
      status: 'done',
      progress: { stage: 'done', current: shots.length, total: shots.length },
      logLine: `全部完成！共分析 ${shots.length} 个镜头`,
      results: {
        videoFile: videoName || videoPath.split(/[\\/]/).pop(),
        totalShots: shots.length, shotRange: `${firstIdx}-${lastIdx}`,
        hasAudio, shots,
        mode: isVideo ? 'video' : 'image',
      },
    });
  } catch (err) {
    logger.error(`[pipeline] runRange failed:`, err.message);
    updateJob(jobId, { status: 'error', logLine: `错误: ${err.message}`, error: err.message });
  }
}

function formatDuration(s) {
  if (!s || isNaN(s)) return '?';
  if (s < 60) return Math.round(s) + '秒';
  return Math.floor(s / 60) + '分' + Math.round(s % 60) + '秒';
}

module.exports = { detectOnly, runRange };
