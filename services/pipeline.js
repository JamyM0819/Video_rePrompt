const { detectScenes, getVideoDuration } = require('./sceneDetect');
const { extractThumbnails, extractMultiFrames } = require('./frameExtract');
const { describeAllFrames, describeAllShots, describeAllVideoClips } = require('./visionDescribe');
const { extractAudioSegments } = require('./audioExtract');
const { describeAllAudio } = require('./audioDescribe');
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
async function runRange(videoPath, jobId, updateJob, startShot, endShot, videoName, customPrompt, minShotDuration, mode) {
  const skipAudio = config.AUDIO_PROVIDER === 'none';
  const isVideo = mode === 'video';

  try {
    updateJob(jobId, { logLine: `开始处理镜头 ${startShot + 1} ~ ${endShot + 1}...` });

    const minDur = minShotDuration != null ? parseFloat(minShotDuration) : null;
    const allScenes = await detectScenes(videoPath, jobId, Infinity, minDur);
    const selectedScenes = allScenes.slice(startShot, endShot + 1);

    const outputDir = path.join(config.OUTPUT_DIR, jobId);

    let framePaths, visualResults, visualDone = 0;
    let audioDone = 0;
    const totalVisual = selectedScenes.length;

    if (isVideo) {
      // Split: ≥2s scenes → video clips, <2s → multi-frame images (DashScope 2s minimum)
      const VID_MIN = 2.0;
      const shortItems = [], videoItems = [];
      selectedScenes.forEach((s, i) => {
        ((s.endTime - s.startTime) < VID_MIN ? shortItems : videoItems).push({ scene: s, origIdx: i });
      });

      visualResults = new Array(totalVisual);

      if (videoItems.length > 0) {
        updateJob(jobId, { logLine: `切割 ${videoItems.length} 个视频片段...` });
        const clipData = [];
        for (const vi of videoItems) {
          const clips = await extractVideoClips(videoPath, [vi.scene], startShot + vi.origIdx, jobId, () => {});
          clipData.push({ ...clips[0], origIdx: vi.origIdx });
        }
        const clipResults = await describeAllVideoClips(clipData.map(c => ({ path: c.path, duration: c.duration })), (n) => {
          visualDone = n;
          updateJob(jobId, { status: 'analyzing', progress: { stage: 'analyzing', current: visualDone + audioDone, total: totalVisual } });
        }, customPrompt);
        clipData.forEach((c, i) => { visualResults[c.origIdx] = clipResults[i]; });
      }

      if (shortItems.length > 0) {
        updateJob(jobId, { logLine: `${shortItems.length} 个短镜头使用多帧图片分析...` });
        const shortScenes = shortItems.map(si => si.scene);
        const firstShortIdx = shortItems[0].origIdx;
        const frameSets = await extractMultiFrames(videoPath, shortScenes, startShot + firstShortIdx, jobId, () => {}, 5);
        const totalShortFrames = frameSets.reduce((s, fs) => s + fs.frames.length, 0);
        updateJob(jobId, { logLine: `短镜头共 ${totalShortFrames} 帧` });
        const frameResults = await describeAllShots(
          frameSets.map(fs => ({ frames: fs.frames, duration: fs.duration })),
          (n) => { visualDone = (videoItems.length || 0) + n; updateJob(jobId, { status: 'analyzing', progress: { stage: 'analyzing', current: visualDone + audioDone, total: totalVisual } }); },
          customPrompt
        );
        shortItems.forEach((si, i) => { visualResults[si.origIdx] = frameResults[i]; });
      }

      visualDone = totalVisual;
      framePaths = selectedScenes.map((_, i) => path.join(outputDir, `frame_${startShot + i}.jpg`));
    } else {
      framePaths = selectedScenes.map((_, i) => path.join(outputDir, `frame_${startShot + i}.jpg`));
      updateJob(jobId, {
        status: 'extracting',
        progress: { stage: 'extracting_frames', current: totalVisual, total: totalVisual },
        logLine: `复用已抽取的 ${totalVisual} 帧${skipAudio ? '' : '，提取音频片段...'}`,
      });
    }

    const audioPaths = skipAudio ? null : await extractAudioSegments(videoPath, selectedScenes, jobId, () => {}).catch(err => {
      updateJob(jobId, { logLine: `音频提取失败: ${err.message}` }); return null;
    });

    const hasAudio = !skipAudio && audioPaths && audioPaths.length > 0;
    updateJob(jobId, { logLine: hasAudio ? `音频片段提取完成` : `准备就绪` });

    const totalAudio = hasAudio ? audioPaths.length : 0;
    const ttl = totalVisual + totalAudio;

    const updateProgress = () => {
      updateJob(jobId, { status: 'analyzing', progress: { stage: 'analyzing', current: visualDone + audioDone, total: ttl } });
    };

    // For single-frame mode, the visual analysis hasn't run yet — run it now
    if (!isVideo) {
      updateJob(jobId, { logLine: `开始分析 ${totalVisual} 帧 + ${totalAudio} 个台词...` });
      const visionOut = await describeAllFrames(framePaths, (n) => { visualDone = n; updateProgress(); }, customPrompt);
      visualResults = visionOut?.results || visionOut;
    } else {
      updateProgress();
    }

    const audioOut = hasAudio ? (await describeAllAudio(audioPaths, (n) => { audioDone = n; updateProgress(); }, customPrompt)) : null;
    const audioResults = audioOut?.results || audioOut;

    updateJob(jobId, { logLine: `分析完成！编译结果中...` });

    const shots = selectedScenes.map((scene, i) => ({
      index: startShot + i,
      startTime: scene.startTime, endTime: scene.endTime,
      duration: Math.round((scene.endTime - scene.startTime) * 100) / 100,
      framePath: `/api/frames/${jobId}/${startShot + i}`,
      clipPath: isVideo ? `/api/clips/${jobId}/${startShot + i}` : null,
      description: visualResults[i] || '[无画面描述]',
      audioDescription: hasAudio && audioResults[i] ? audioResults[i] : undefined,
    }));

    updateJob(jobId, {
      status: 'done',
      progress: { stage: 'done', current: shots.length, total: shots.length },
      logLine: `全部完成！共分析 ${shots.length} 个镜头`,
      results: {
        videoFile: videoName || videoPath.split(/[\\/]/).pop(),
        totalShots: shots.length, shotRange: `${startShot + 1}-${endShot + 1}`,
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
