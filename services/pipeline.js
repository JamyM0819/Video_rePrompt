const { detectScenes, getVideoDuration } = require('./sceneDetect');
const { extractFrames } = require('./frameExtract');
const { describeAllFrames } = require('./visionDescribe');
const { extractAudioSegments } = require('./audioExtract');
const { describeAllAudio } = require('./audioDescribe');
const fs = require('fs');
const path = require('path');

/**
 * Phase 1: Detect scenes, then extract all frame thumbnails for preview.
 * Returns sceneData with frame URLs so frontend can show a filmstrip.
 */
async function detectOnly(videoPath, jobId, updateJob, maxShots, minShotDuration) {
  const minDur = minShotDuration != null ? parseFloat(minShotDuration) : null;
  const durMsg = minDur != null ? ` (最短镜头 ≤${minDur}s)` : '';
  updateJob(jobId, { status: 'detecting_scenes', logLine: `🔍 开始检测镜头切换${durMsg}...` });

  const t0 = Date.now();
  const scenes = await detectScenes(videoPath, jobId, maxShots, minDur);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  updateJob(jobId, { logLine: `✅ 检测到 ${scenes.length} 个镜头（耗时 ${elapsed}s）` });

  // Extract all frame thumbnails
  updateJob(jobId, {
    status: 'extracting_thumbs',
    progress: { stage: 'extracting_thumbs', current: 0, total: scenes.length },
    logLine: `📸 抽取 ${scenes.length} 个镜头缩略图...`,
  });

  const framePaths = await extractFrames(videoPath, scenes, jobId, (i) => {
    updateJob(jobId, { progress: { stage: 'extracting_thumbs', current: i + 1, total: scenes.length } });
  });

  updateJob(jobId, { logLine: `✅ 缩略图抽取完成` });

  const duration = await getVideoDuration(videoPath).catch(() => null);

  updateJob(jobId, {
    status: 'awaiting_range',
    progress: { stage: 'awaiting_range' },
    logLine: duration
      ? `📐 视频总时长 ${formatDuration(duration)}，请在下方选择要分析的镜头范围`
      : `📐 请在下方选择要分析的镜头范围`,
    sceneData: {
      totalShots: scenes.length,
      duration: duration ? Math.round(duration * 100) / 100 : null,
      thumbBase: `/api/frames/${jobId}/`,
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
async function runRange(videoPath, jobId, updateJob, startShot, endShot, videoName, customPrompt, minShotDuration) {
  const skipAudio = require('../utils/config').AUDIO_PROVIDER === 'none';

  try {
    updateJob(jobId, { logLine: `🎬 开始处理镜头 ${startShot + 1} ~ ${endShot + 1}...` });

    const minDur = minShotDuration != null ? parseFloat(minShotDuration) : null;
    const allScenes = await detectScenes(videoPath, jobId, Infinity, minDur);
    const selectedScenes = allScenes.slice(startShot, endShot + 1);

    // Frames are already on disk from Phase 1 — just collect paths
    const path = require('path');
    const config = require('../utils/config');
    const outputDir = path.join(config.OUTPUT_DIR, jobId);
    const framePaths = selectedScenes.map((_, i) => path.join(outputDir, `frame_${startShot + i}.jpg`));

    updateJob(jobId, {
      status: 'extracting',
      progress: { stage: 'extracting_frames', current: selectedScenes.length, total: selectedScenes.length },
      logLine: `📸 复用已抽取的 ${selectedScenes.length} 帧${skipAudio ? '' : '，提取音频片段...'}`,
    });

    const audioPaths = skipAudio ? null : await extractAudioSegments(videoPath, selectedScenes, jobId, () => {}).catch(err => {
      updateJob(jobId, { logLine: `⚠️ 音频提取失败: ${err.message}` }); return null;
    });

    const hasAudio = !skipAudio && audioPaths && audioPaths.length > 0;
    updateJob(jobId, { logLine: hasAudio ? `✅ 音频片段提取完成` : `✅ 准备就绪` });

    // Analyze
    const totalItems = framePaths.length + (hasAudio ? audioPaths.length : 0);
    let visualDone = 0, audioDone = 0;

    const updateProgress = () => {
      updateJob(jobId, { status: 'analyzing', progress: { stage: 'analyzing', current: visualDone + audioDone, total: totalItems } });
    };
    updateProgress();

    updateJob(jobId, { logLine: `🤖 开始分析 ${totalItems} 项（${framePaths.length} 画面 + ${hasAudio ? audioPaths.length : 0} 台词）...` });

    const analysisStart = Date.now();
    const [visionOut, audioOut] = await Promise.all([
      describeAllFrames(framePaths, (n) => { visualDone = n; updateProgress(); }, customPrompt),
      hasAudio ? describeAllAudio(audioPaths, (n) => { audioDone = n; updateProgress(); }, customPrompt) : Promise.resolve(null),
    ]);
    const analysisEnd = Date.now();
    const totalWallMs = analysisEnd - analysisStart;

    const visualResults = visionOut?.results || visionOut;
    const visualTimings = visionOut?.timings || [];
    const visualCompletedAt = visionOut?.completedAt || [];
    const audioResults = audioOut?.results || audioOut;
    const audioTimings = audioOut?.timings || [];
    const audioCompletedAt = audioOut?.completedAt || [];

    updateJob(jobId, { logLine: `✅ 分析完成！编译结果中...` });

    const totalVisionMs = visualTimings.reduce((s, t) => s + t, 0);
    const totalAudioMs = audioTimings.reduce((s, t) => s + t, 0);
    updateJob(jobId, { logLine: `⏱ 总耗时 ${(totalWallMs / 1000).toFixed(0)}s（视觉 ${totalVisionMs / 1000}s / 音频 ${totalAudioMs / 1000}s）` });

    const shots = selectedScenes.map((scene, i) => ({
      index: startShot + i,
      startTime: scene.startTime, endTime: scene.endTime,
      duration: Math.round((scene.endTime - scene.startTime) * 100) / 100,
      framePath: `/api/frames/${jobId}/${startShot + i}`,
      description: visualResults[i] || '[无画面描述]',
      audioDescription: hasAudio && audioResults[i] ? audioResults[i] : undefined,
      visionMs: visualTimings[i] || 0,
      audioMs: audioTimings[i] || 0,
      completedAt: visualCompletedAt[i] || audioCompletedAt[i] || analysisEnd,
    }));

    updateJob(jobId, {
      status: 'done',
      progress: { stage: 'done', current: shots.length, total: shots.length },
      logLine: `🎉 全部完成！共分析 ${shots.length} 个镜头`,
      results: {
        videoFile: videoName || videoPath.split(/[\\/]/).pop(),
        totalShots: shots.length, shotRange: `${startShot + 1}-${endShot + 1}`,
        hasAudio, shots,
        totalWallMs,
      },
    });
  } catch (err) {
    updateJob(jobId, { status: 'error', logLine: `❌ 错误: ${err.message}`, error: err.message });
  }
}

function formatDuration(s) {
  if (!s || isNaN(s)) return '?';
  if (s < 60) return Math.round(s) + '秒';
  return Math.floor(s / 60) + '分' + Math.round(s % 60) + '秒';
}

module.exports = { detectOnly, runRange };
