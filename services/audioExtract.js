const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

/**
 * Extract full audio from video as MP3.
 * Then for each scene, slice out the audio segment.
 * Returns an array of per-shot audio file paths.
 */
async function extractAudioSegments(videoPath, scenes, jobId, onProgress) {
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  const fullAudioPath = path.join(outputDir, 'full_audio.mp3');

  // Step 1: Extract full audio from video
  const result = await extractFullAudio(videoPath, fullAudioPath);

  if (!result) {
    console.log('[audio] No audio track in video, skipping');
    return null;
  }

  if (!fs.existsSync(fullAudioPath)) {
    console.log('[audio] Audio extraction produced no file, skipping');
    return null;
  }

  // Step 1.5: Check if the audio track is silent
  const volume = await checkAudioVolume(fullAudioPath);
  if (volume && volume.max < -70) {
    console.log(`[audio] Audio track is silent (max ${volume.max} dB), skipping`);
    return null;
  }

  // Step 2: For each scene, slice out the audio segment
  const audioPaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const segmentPath = path.join(outputDir, `audio_${i}.mp3`);

    // Skip if already exists
    if (fs.existsSync(segmentPath)) {
      audioPaths.push(segmentPath);
      if (onProgress) onProgress(i);
      continue;
    }

    const startTime = scenes[i].startTime;
    const duration = scenes[i].endTime - scenes[i].startTime;

    await sliceAudio(fullAudioPath, startTime, duration, segmentPath);
    audioPaths.push(segmentPath);
    if (onProgress) onProgress(i);
  }

  return audioPaths;
}

function extractFullAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-vn',                    // no video
      '-acodec', 'libmp3lame',
      '-q:a', '5',              // medium quality MP3
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
        // Video may have no audio track — this is OK, return null
        console.log(`[audio] No audio track or extraction failed (exit ${code}), skipping`);
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      console.log(`[audio] ffmpeg spawn error, skipping audio: ${err.message}`);
      resolve(null);
    });
  });
}

function sliceAudio(audioPath, startTime, duration, outputPath) {
  return new Promise((resolve, reject) => {
    // Clamp duration to at least 0.5s
    const dur = Math.max(duration, 0.5);

    // For MP3 slicing, -ss after -i is more accurate (no fast seek for audio)
    const args = [
      '-i', audioPath,
      '-ss', formatTimestamp(startTime),
      '-t', dur.toString(),
      '-acodec', 'copy',
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
        reject(new Error(`Audio slice failed: ${stderr.slice(-200)}`));
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

module.exports = { extractAudioSegments };

/**
 * Check audio volume levels. Returns { mean, max } in dB, or null on failure.
 */
function checkAudioVolume(audioPath) {
  return new Promise((resolve) => {
    const proc = spawn(config.FFMPEG_PATH, [
      '-i', audioPath,
      '-af', 'volumedetect',
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
      if (meanMatch && maxMatch) {
        resolve({ mean: parseFloat(meanMatch[1]), max: parseFloat(maxMatch[1]) });
      } else {
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
  });
}
