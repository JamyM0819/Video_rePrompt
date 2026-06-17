const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

/**
 * Extract one mp4 clip per shot using codec copy (fast, no re-encode).
 * Returns array of file paths: [outputDir/clip_0.mp4, ...]
 */
async function extractVideoClips(videoPath, scenes, startIdx, jobId, onProgress) {
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = scene.endTime - scene.startTime;
    const outPath = path.join(outputDir, `clip_${startIdx + i}.mp4`);

    await cutClip(videoPath, scene.startTime, Math.max(dur, 0.3), outPath);
    results.push(outPath);
    if (onProgress) onProgress(i);
  }

  return results;
}

function cutClip(videoPath, startTime, duration, outputPath) {
  return new Promise((resolve, reject) => {
    // Re-encode with tight constraints to keep base64 under 20MB API limit.
    // CRF 30, max 480p, no audio (audio analyzed separately), maxrate cap.
    const args = [
      '-ss', formatTimestamp(startTime),
      '-i', videoPath,
      '-t', duration.toFixed(3),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '30',
      '-maxrate', '1500k',
      '-bufsize', '3000k',
      '-vf', 'scale=ceil(iw*min(1,480/ih)/2)*2:ceil(ih*min(1,480/ih)/2)*2',
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
        console.log(`[videoClip] ${path.basename(outputPath)}: ${sizeMB}MB (${duration.toFixed(1)}s)`);
        resolve(outputPath);
      } else {
        reject(new Error(`Video clip failed at ${formatTimestamp(startTime)}: ${stderr.slice(-200)}`));
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

module.exports = { extractVideoClips };
