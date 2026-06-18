const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../utils/config');
const logger = require('../utils/logger');
const overrides = require('../utils/overrides');

// Resolve config value: override takes precedence over default
function cfg(key) {
  const v = overrides.get(key);
  return (v != null && v !== '') ? v : config[key];
}

/**
 * Describe a single frame image using vision AI.
 * Supports both DashScope and OpenAI-compatible APIs via config.
 */
async function describeFrame(framePath, customPrompt) {
  const prompt = config.VISION_PROMPT + (customPrompt ? '\n\n【附加要求】' + customPrompt : '');

  try {
    return await callVisionAPI(framePath, prompt);
  } catch (err) {
    logger.error(`[vision] Failed:`, err.message);
    // Retry once
    try {
      await new Promise(r => setTimeout(r, 2000));
      return await callVisionAPI(framePath, prompt);
    } catch (retryErr) {
      logger.error(`[vision] Retry also failed:`, retryErr.message);
      return `[分析失败: ${retryErr.message}]`;
    }
  }
}

function callVisionAPI(framePath, prompt) {
  return new Promise((resolve, reject) => {
    const imageUrl = encodeImage(framePath);
    const payload = JSON.stringify({
      model: cfg('VISION_MODEL'),
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt },
        ],
      }],
      stream: false,
      max_tokens: parseInt(cfg('VISION_MAX_TOKENS')) || 1024,
    });

    const apiUrl = new URL(cfg('VISION_BASE_URL').replace(/\/?$/, '/') + 'chat/completions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };

    // DashScope uses Bearer, OpenAI-compatible also uses Bearer
    const apiKey = cfg('VISION_API_KEY');
    if (apiKey) {
      headers['Authorization'] = 'Bearer ' + apiKey;
    }

    const req = transport.request(apiUrl, {
      method: 'POST',
      headers,
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        try {
          const content = JSON.parse(data)?.choices?.[0]?.message?.content || data;
          resolve(content);
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Vision API timeout')); });
    req.write(payload);
    req.end();
  });
}

function encodeImage(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Frame not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp' };
  const mime = mimeMap[ext] || 'jpeg';
  const data = fs.readFileSync(resolved);
  return `data:image/${mime};base64,${data.toString('base64')}`;
}

/**
 * Describe a shot using 3 frames (start, middle, end) to capture temporal changes.
 */
async function describeShot(frames, durationSec, customPrompt) {
  if (frames.length === 1) return describeFrame(frames[0], customPrompt);

  let prompt = config.VISION_PROMPT;
  const hasDur = durationSec != null && durationSec > 0;
  const durHint = hasDur
    ? (durationSec < 1.0
      ? `注意：这是一个极短的镜头，仅持续 ${durationSec.toFixed(1)} 秒，所有动作都是瞬间发生的快动作，不要描述成缓慢变化。`
      : `该镜头持续 ${durationSec.toFixed(1)} 秒，请按真实时间节奏描述。`)
    : '';
  prompt += `\n\n${durHint}\n输出可直接用于视频生成的视觉提示词。描述这个镜头的完整动态过程。主体动作变化必须写；若面部或身体姿态有清晰情绪则描写。不要以"这个镜头""该片段"等词开头，不要任何评价或分析，只输出描述本身。`;
  if (customPrompt) prompt += '\n\n【附加要求】' + customPrompt;

  try {
    return await callVisionMultiAPI(frames, prompt);
  } catch (err) {
    logger.error(`[vision] Multi-frame failed:`, err.message);
    try {
      await new Promise(r => setTimeout(r, 2000));
      return await callVisionMultiAPI(frames, prompt);
    } catch (retryErr) {
      logger.error(`[vision] Multi-frame retry also failed:`, retryErr.message);
      return `[分析失败: ${retryErr.message}]`;
    }
  }
}

function callVisionMultiAPI(framePaths, prompt) {
  return new Promise((resolve, reject) => {
    const content = framePaths.map(fp => ({
      type: 'image_url',
      image_url: { url: encodeImage(fp) },
    }));
    content.push({ type: 'text', text: prompt });

    const payload = JSON.stringify({
      model: cfg('VISION_MODEL'),
      messages: [{ role: 'user', content }],
      stream: false,
      max_tokens: parseInt(cfg('VISION_MAX_TOKENS')) || 1536,
    });

    const apiUrl = new URL(cfg('VISION_BASE_URL').replace(/\/?$/, '/') + 'chat/completions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    const apiKey = cfg('VISION_API_KEY');
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    const req = transport.request(apiUrl, {
      method: 'POST', headers, timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
        try {
          resolve(JSON.parse(data)?.choices?.[0]?.message?.content || data);
        } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Vision API timeout')); });
    req.write(payload);
    req.end();
  });
}
const VIDEO_PROMPT = [
  '输出可直接用于视频生成的视觉提示词，描述这个连续镜头：',
  '- 人物动作变化过程',
  '- 情绪变化（仅当可清楚看到面部表情或身体情绪信号时才写）',
  '- 镜头运动（若有）',
  '不要以"这个镜头"等词开头，不要任何评价或分析，只输出描述本身。',
].join('\n');

/**
 * Describe a shot using video clip mode (video_url).
 */
async function describeVideoClip(clipPath, durationSec, customPrompt) {
  let prompt = VIDEO_PROMPT;
  if (customPrompt) prompt += '\n\n【附加要求】' + customPrompt;

  // Qwen VL requires at least 4 frames at default fps=2, so ceil(dur×fps) ≥ 4.
  // For short clips, boost fps to guarantee enough frames.
  const minFps = durationSec > 0 ? Math.ceil(4 / durationSec) : 4;
  const fps = Math.max(2, minFps);

  try {
    return await callVideoAPI(clipPath, prompt, fps);
  } catch (err) {
    logger.error(`[vision-video] Failed:`, err.message);
    try {
      await new Promise(r => setTimeout(r, 2000));
      return await callVideoAPI(clipPath, prompt, fps);
    } catch (retryErr) {
      logger.error(`[vision-video] Retry also failed:`, retryErr.message);
      return `[视频分析失败: ${retryErr.message}]`;
    }
  }
}

function callVideoAPI(clipPath, prompt, fps = 2) {
  return new Promise((resolve, reject) => {
    const resolved = path.resolve(clipPath);
    const ext = path.extname(resolved).toLowerCase().replace('.', '');
    const mimeMap = { mp4: 'mp4', webm: 'webm', mov: 'quicktime', avi: 'avi', mkv: 'x-matroska' };
    const mime = mimeMap[ext] || 'mp4';
    const data = fs.readFileSync(resolved);
    const videoUrl = `data:video/${mime};base64,${data.toString('base64')}`;

    logger.info(`[vision-video] Sending clip: ${path.basename(clipPath)} (${(data.length/1024/1024).toFixed(1)}MB, fps=${fps})`);

    const payload = JSON.stringify({
      model: cfg('VISION_MODEL'),
      messages: [{
        role: 'user',
        content: [
          { type: 'video_url', video_url: { url: videoUrl, fps } },
          { type: 'text', text: prompt },
        ],
      }],
      stream: false,
      max_tokens: parseInt(cfg('VISION_MAX_TOKENS')) || 1536,
    });

    const apiUrl = new URL(cfg('VISION_BASE_URL').replace(/\/?$/, '/') + 'chat/completions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    const apiKey = cfg('VISION_API_KEY');
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    const req = transport.request(apiUrl, {
      method: 'POST', headers, timeout: 180000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Video API ${res.statusCode}: ${data.slice(0, 300)}`));
        try {
          resolve(JSON.parse(data)?.choices?.[0]?.message?.content || data);
        } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Video API timeout')); });
    req.write(payload);
    req.end();
  });
}

/**
 * Describe all shots in video mode.
 * clipData is [{ path, duration }, ...]
 */
async function describeAllVideoClips(clipData, onProgress, customPrompt) {
  const results = new Array(clipData.length);
  let done = 0;

  logger.info(`[vision-video] Starting ${clipData.length} video clips...`);

  const workers = [];
  for (let i = 0; i < clipData.length; i++) {
    workers.push((async (idx) => {
      results[idx] = await describeVideoClip(clipData[idx].path, clipData[idx].duration, customPrompt);
      done++;
      logger.info(`[vision-video] Clip ${idx + 1}/${clipData.length}: done (${results[idx].length} chars)`);
      if (onProgress) onProgress(done);
    })(i));
  }
  await Promise.all(workers);

  return results;
}

async function describeAllFrames(framePaths, onProgress, customPrompt) {
  const concurrency = parseInt(cfg('VISION_CONCURRENCY')) || 5;
  const results = new Array(framePaths.length);
  const timings = new Array(framePaths.length);
  const completedAt = new Array(framePaths.length);
  let next = 0;
  let done = 0;

  logger.info(`[vision] Active: ${cfg('VISION_PROVIDER')}/${cfg('VISION_MODEL')} @ ${cfg('VISION_BASE_URL')}`);
  logger.info(`[vision] Starting ${framePaths.length} frames (concurrency=${concurrency})...`);

  const worker = async () => {
    while (next < framePaths.length) {
      const i = next++;
      const t0 = Date.now();
      results[i] = await describeFrame(framePaths[i], customPrompt);
      timings[i] = Date.now() - t0;
      completedAt[i] = Date.now();
      done++;
      logger.info(`[vision] Frame ${i + 1}/${framePaths.length}: done (${results[i].length} chars, ${timings[i]}ms)`);
      if (onProgress) onProgress(done - 1);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, framePaths.length) }, () => worker()));

  return { results, timings, completedAt };
}

/**
 * Batch version of describeShot with concurrency.
 * shotData is [{ frames: [path, ...], duration: number }, ...]
 */
async function describeAllShots(shotData, onProgress, customPrompt) {
  const concurrency = parseInt(cfg('VISION_CONCURRENCY')) || 5;
  const results = new Array(shotData.length);
  let done = 0;
  let next = 0;

  logger.info(`[vision] Starting ${shotData.length} shots (multi-frame, concurrency=${concurrency})...`);

  const worker = async () => {
    while (next < shotData.length) {
      const i = next++;
      const sd = shotData[i];
      results[i] = await describeShot(sd.frames, sd.duration, customPrompt);
      done++;
      logger.info(`[vision] Shot ${i + 1}/${shotData.length}: done (${results[i].length} chars)`);
      if (onProgress) onProgress(done);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, shotData.length) }, () => worker()));
  return results;
}

module.exports = { describeFrame, describeAllFrames, describeShot, describeAllShots, describeVideoClip, describeAllVideoClips };
