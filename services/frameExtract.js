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
 * Extract 3 frames per shot (start, middle, end) for temporal analysis.
 * Returns an array of { index, frames: [startPath, midPath, endPath] }.
 */
async function extractThreeFrames(videoPath, scenes, startIdx, jobId, onProgress) {
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = scene.endTime - scene.startTime;
    const start = scene.startTime;
    const mid = start + dur / 2;
    const end = scene.endTime - 0.1; // slightly before end to avoid next shot boundary

    const framePaths = [];
    for (const [label, ts] of [['start', start], ['mid', mid], ['end', Math.max(end, start + 0.05)]]) {
      const fout = path.join(outputDir, `${label}_frame_${startIdx + i}.jpg`);
      await extractOneFrame(videoPath, ts, fout);
      framePaths.push(fout);
    }
    results.push({ index: startIdx + i, frames: framePaths });
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

module.exports = { extractThumbnails, extractThreeFrames };
