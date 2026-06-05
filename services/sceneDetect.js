const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

/**
 * Run PySceneDetect to get scene start/end timestamps.
 * Returns: [{ startTime, endTime }] in seconds.
 */
async function detectScenes(videoPath, jobId, maxShots) {
  const limit = maxShots || config.MAX_SHOTS;
  const outputDir = path.join(config.OUTPUT_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  const csvPath = path.join(outputDir, 'scenes.csv');
  // PySceneDetect 0.7+ syntax: global -i video, then commands with their own options
  const args = [
    '-m', 'scenedetect',
    '-i', videoPath,
    '-q',
    'detect-content',
    'list-scenes',
    '-o', outputDir,
    '-f', 'scenes.csv',
    '-q',
  ];

  try {
    await runPython(args);
    if (fs.existsSync(csvPath)) {
      return parseSceneCSV(csvPath, limit);
    }
  } catch (err) {
    console.error('[sceneDetect] PySceneDetect failed:', err.message);
  }

  // Fallback 1: ffmpeg scdet filter
  try {
    console.log('[sceneDetect] Falling back to ffmpeg scdet...');
    const scenes = await detectWithFFmpeg(videoPath);
    if (scenes.length > 0) return mergeShortScenes(scenes, limit);
  } catch (err) {
    console.error('[sceneDetect] ffmpeg scdet failed:', err.message);
  }

  // Fallback 2: uniform sampling
  console.log('[sceneDetect] Falling back to uniform sampling...');
  return uniformSample(videoPath, limit);
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.PYTHON_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python exit ${code}: ${stderr.slice(0, 300)}`));
    });
    proc.on('error', reject);
  });
}

function parseSceneCSV(csvPath, maxShots) {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.trim().split('\n');
  const scenes = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const parts = line.split(',');
    const startTime = parseFloat(parts[3]);
    const endTime = parseFloat(parts[6]);
    if (!isNaN(startTime) && !isNaN(endTime)) {
      scenes.push({ startTime, endTime });
    }
  }

  return mergeShortScenes(scenes, maxShots);
}

/**
 * ffmpeg scene detection via scdet filter.
 * Parses stderr for lines like: "lavfi.scdet.n=..." containing timestamps.
 */
function detectWithFFmpeg(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-filter:v', 'scdet=threshold=10',
      '-f', 'null', '-',
    ];
    const proc = spawn(config.FFMPEG_PATH, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      // scdet always returns non-zero because it stops at scenes; parse output anyway
      const scenes = [];
      const re = /lavfi\.scdet\.time=([\d.]+)/g;
      let match;
      const times = [];
      while ((match = re.exec(stderr)) !== null) {
        times.push(parseFloat(match[1]));
      }

      if (times.length === 0) {
        resolve([]);
        return;
      }

      // Each detection is a scene start; add end as start of next scene
      times.sort((a, b) => a - b);
      for (let i = 0; i < times.length; i++) {
        scenes.push({
          startTime: times[i],
          endTime: times[i + 1] || null, // last scene end unknown
        });
      }

      resolve(scenes);
    });
    proc.on('error', reject);
  });
}

/**
 * Get video duration via ffprobe, then generate uniform-interval timestamps.
 */
async function uniformSample(videoPath, maxShots) {
  let duration;
  try {
    duration = await getVideoDuration(videoPath);
  } catch (err) {
    console.error('[sceneDetect] getVideoDuration failed:', err.message);
    // Last resort: try ffmpeg to get duration
    try {
      duration = await getDurationFromFFmpeg(videoPath);
    } catch (err2) {
      console.error('[sceneDetect] ffmpeg duration also failed:', err2.message);
      // Give up, return a single frame at time 0
      return [{ startTime: 0, endTime: 1 }];
    }
  }

  const interval = config.FALLBACK_INTERVAL;
  const scenes = [];

  const actualInterval = Math.max(interval, duration / maxShots);
  for (let t = 0; t < duration; t += actualInterval) {
    const endTime = Math.min(t + actualInterval, duration);
    scenes.push({ startTime: Math.round(t * 100) / 100, endTime: Math.round(endTime * 100) / 100 });
  }

  return scenes;
}

/** Fallback duration extraction via ffmpeg */
function getDurationFromFFmpeg(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.FFMPEG_PATH, [
      '-i', videoPath,
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (match) {
        const h = parseInt(match[1]), m = parseInt(match[2]), s = parseFloat(match[3]);
        resolve(h * 3600 + m * 60 + s);
      } else {
        reject(new Error('Could not parse duration from ffmpeg output'));
      }
    });
    proc.on('error', reject);
  });
}

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath,
    ];
    const proc = spawn(config.FFPROBE_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || `exit code ${code}`;
        // Check for common issues
        if (detail.includes('Invalid data found')) {
          return reject(new Error(`视频文件格式无效或已损坏: ${detail.slice(0, 200)}`));
        }
        if (detail.includes('No such file')) {
          return reject(new Error(`视频文件不存在: ${videoPath}`));
        }
        return reject(new Error(`ffprobe 解析失败: ${detail.slice(0, 200)}`));
      }
      const duration = parseFloat(stdout.trim());
      if (isNaN(duration)) {
        return reject(new Error('无法获取视频时长：ffprobe 返回了无效数据'));
      }
      resolve(duration);
    });
    proc.on('error', (err) => {
      reject(new Error(`无法启动 ffprobe: ${err.message}`));
    });
  });
}

/** Merge scenes shorter than MIN_SHOT_DURATION into neighbors */
function mergeShortScenes(scenes, maxShots) {
  if (scenes.length <= 1) return scenes;

  const merged = [];
  let current = { ...scenes[0] };

  for (let i = 1; i < scenes.length; i++) {
    const dur = current.endTime - current.startTime;
    if (dur < config.MIN_SHOT_DURATION && merged.length > 0) {
      merged[merged.length - 1].endTime = current.endTime;
    } else if (dur < config.MIN_SHOT_DURATION) {
      current.endTime = scenes[i].endTime;
      continue;
    } else {
      merged.push(current);
    }
    current = { ...scenes[i] };
  }

  merged.push(current);

  // Cap at maxShots: keep first N scenes
  if (merged.length > maxShots) {
    return merged.slice(0, maxShots);
  }

  return merged;
}

module.exports = { detectScenes, getVideoDuration };
