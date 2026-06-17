const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

/**
 * Extract one thumbnail JPEG per scene (for filmstrip).
 */
async function extractThumbnails(videoPath, scenes, jobId, onProgress) {
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const paths = [];
  for (let i = 0; i < scenes.length; i++) {
    const fp = path.join(outputDir, `frame_${i}.jpg`);
    await extractOneFrame(videoPath, scenes[i].startTime, fp);
    paths.push(fp);
    if (onProgress) onProgress(i);
  }
  return paths;
}

/**
 * Extract frames per shot for temporal analysis.
 * Always uses ~0.15s interval (dense enough to catch sub-second events),
 * capped at 20 frames max per shot. Returns [{ index, frames, duration }, ...].
 */
async function extractMultiFrames(videoPath, scenes, startIdx, jobId, onProgress, frameCount = 5) {
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  const INTERVAL = 0.15;   // seconds between frames
  const MAX_FRAMES = 20;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const start = scene.startTime;
    const end = Math.max(scene.endTime - 0.05, start + 0.1);
    const dur = end - start;

    const n = Math.min(MAX_FRAMES, Math.max(3, Math.ceil(dur / INTERVAL)));
    const framePaths = [];
    for (let f = 0; f < n; f++) {
      const ts = f === n - 1 ? end : start + (dur / (n - 1)) * f;
      const fout = path.join(outputDir, `f${f}_shot_${startIdx + i}.jpg`);
      await extractOneFrame(videoPath, ts, fout);
      framePaths.push(fout);
    }
    results.push({ index: startIdx + i, frames: framePaths, duration: dur });
    if (onProgress) onProgress(i);
  }

  return results;
}

function extractOneFrame(videoPath, timestamp, outputPath) {
  return new Promise((resolve, reject) => {
    // Format timestamp as HH:MM:SS.mmm for ffmpeg
    const ts = formatTimestamp(timestamp);

    const args = [
      '-ss', ts,
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '8',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease',
      '-y',
      outputPath,
    ];

    const proc = spawn(config.FFMPEG_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        // Retry once without fast seeking (seek after input decode)
        const fallbackArgs = [
          '-i', videoPath,
          '-ss', ts,
          '-vframes', '1',
          '-q:v', '8',
          '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease',
          '-y',
          outputPath,
        ];
        const proc2 = spawn(config.FFMPEG_PATH, fallbackArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr2 = '';
        proc2.stderr.on('data', (d) => { stderr2 += d.toString(); });
        proc2.on('close', (code2) => {
          if (code2 === 0 && fs.existsSync(outputPath)) resolve(outputPath);
          else reject(new Error(`ffmpeg extract failed at ${ts}: ${stderr2.slice(-200)}`));
        });
        proc2.on('error', reject);
      }
    });
    proc.on('error', (err) => {
      // Also try fallback on spawn error
      reject(err);
    });
  });
}

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(6, '0')}`;
}

module.exports = { extractThumbnails, extractMultiFrames };
