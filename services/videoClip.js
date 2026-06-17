const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');
const logger = require('../utils/logger');
/**
 * Extract one mp4 clip per shot (re-encode, tight compression).
 * Returns [{ path, duration }, ...].
 */
async function extractVideoClips(videoPath, scenes, startIdx, jobId, onProgress) {
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = Math.max(scene.endTime - scene.startTime, 0.1);
    const outPath = path.join(outputDir, `clip_${startIdx + i}.mp4`);
    await cutClip(videoPath, scene.startTime, dur, outPath);
    results.push({ path: outPath, duration: dur });
    if (onProgress) onProgress(i);
  }

  return results;
}

function cutClip(videoPath, startTime, duration, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-ss', formatTimestamp(startTime),
      '-i', videoPath,
      '-t', duration.toFixed(3),
      '-vf', 'scale=ceil(iw*min(1\\,480/ih)/2)*2:ceil(ih*min(1\\,480/ih)/2)*2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '30',
      '-maxrate', '1500k',
      '-bufsize', '3000k',
      '-an',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ];

    const proc = spawn(config.FFMPEG_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
        logger.info(`[videoClip] ${path.basename(outputPath)}: ${sizeMB}MB (${duration.toFixed(1)}s)`);
        resolve(outputPath);
      } else {
        const err = new Error(`Video clip failed at ${formatTimestamp(startTime)}: ${stderr.slice(-200)}`);
        logger.error(err.message);
        reject(err);
      }
    });

    proc.on('error', reject);
  });
}

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(6, '0')}`;
}

/**
 * Extract lightweight preview clips for the filmstrip (Phase 1).
 * Uses very low quality for speed — human preview only, not sent to API.
 */
async function extractPreviewClips(videoPath, scenes, startIdx, jobId, onProgress) {
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = Math.max(scene.endTime - scene.startTime, 0.1);
    const outPath = path.join(outputDir, `clip_${startIdx + i}.mp4`);

    // Skip if already exists (from previous Phase 2 run)
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      results.push({ path: outPath, duration: dur });
      if (onProgress) onProgress(i);
      continue;
    }

    await new Promise((resolve, reject) => {
      const args = [
        '-ss', formatTimestamp(scene.startTime),
        '-i', videoPath,
        '-t', dur.toFixed(3),
        '-vf', 'scale=320:180:force_original_aspect_ratio=decrease',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '35',
        '-an',
        '-movflags', '+faststart',
        '-y',
        outPath,
      ];

      const proc = spawn(config.FFMPEG_PATH, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
          results.push({ path: outPath, duration: dur });
          resolve();
        } else {
          // Silent fail — preview clips are optional
          logger.warn(`[previewClip] Failed for shot ${startIdx + i}: ${stderr.slice(-100)}`);
          resolve();
        }
      });

      proc.on('error', () => resolve()); // silent fail
    });

    if (onProgress) onProgress(i);
  }

  return results;
}

module.exports = { extractVideoClips, extractPreviewClips };
