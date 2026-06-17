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
    const args = [
      '-ss', formatTimestamp(startTime),
      '-i', videoPath,
      '-t', duration.toFixed(3),
      '-c', 'copy',        // no re-encode
      '-avoid_negative_ts', 'make_zero',
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
        resolve(outputPath);
      } else {
        // Fallback: re-encode the clip
        const fallbackArgs = [
          '-i', videoPath,
          '-ss', formatTimestamp(startTime),
          '-t', duration.toFixed(3),
          '-c:v', 'libx264', '-preset', 'ultrafast',
          '-c:a', 'aac',
          '-y',
          outputPath,
        ];
        const p2 = spawn(config.FFMPEG_PATH, fallbackArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let e2 = '';
        p2.stderr.on('data', (d) => { e2 += d.toString(); });
        p2.on('close', (c2) => {
          if (c2 === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) resolve(outputPath);
          else reject(new Error(`Video clip failed at ${formatTimestamp(startTime)}: ${e2.slice(-200)}`));
        });
        p2.on('error', reject);
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
