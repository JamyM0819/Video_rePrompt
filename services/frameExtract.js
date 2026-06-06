const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

/**
 * Extract a single JPEG frame from the video at the given timestamp.
 * Uses fast seeking (-ss before -i) and returns the output path.
 */
async function extractFrames(videoPath, scenes, jobId, onProgress) {
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  const framePaths = [];

  for (let i = 0; i < scenes.length; i++) {
    const timestamp = scenes[i].startTime;
    const framePath = path.join(outputDir, `frame_${i}.jpg`);

    // Skip if already extracted
    if (fs.existsSync(framePath)) {
      framePaths.push(framePath);
      if (onProgress) onProgress(i);
      continue;
    }

    await extractOneFrame(videoPath, timestamp, framePath);
    framePaths.push(framePath);
    if (onProgress) onProgress(i);
  }

  return framePaths;
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

module.exports = { extractFrames };
